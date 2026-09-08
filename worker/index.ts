/* HardMode — anonymous daily result stats.
 *
 * The site itself is static; this only handles /api/*. Everything it stores is
 * a random per-device id, a date, a game and a score bucket — no accounts, no
 * personal data, nothing that identifies a player.
 *
 * The whole thing is optional. With no STATS binding the endpoints report that
 * they are switched off and the page quietly hides its results panel, so the
 * site works exactly as before until a database is attached. */

// Minimal shapes for the two bindings used, so this typechecks without pulling
// in the full Cloudflare types package.
interface D1Result<T> { results: T[] }
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T>(): Promise<D1Result<T>>;
}
interface D1Database {
  prepare(query: string): D1Statement;
  exec(query: string): Promise<unknown>;
}
interface Env {
  STATS?: D1Database;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

// Treedle is retired from the site but stays here: its rows are already stored,
// and a client left open on an old tab should not have its result refused.
export const GAMES = ["steiner", "color", "graphle", "facility", "hillclimb", "treedle"] as const;
export type Game = (typeof GAMES)[number];

// What a finished puzzle is worth, per game. Anything outside these sets is a
// client that has drifted from the server, so it is rejected rather than stored.
export const BUCKETS: Record<Game, readonly string[]> = {
  steiner: ["0", "1", "2", "3+"],          // cost over the target
  color: ["3", "2", "1"],                   // stars
  graphle: ["1", "2", "3", "4", "5", "6", "X"],
  facility: ["0", "1", "2", "3+"],          // travel over the target
  hillclimb: ["A", "B", "C", "D"],          // grade for the day's expedition
  treedle: ["1", "2", "3", "4", "5", "6", "X"],
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PLAYER = /^[a-z0-9]{8,40}$/;
const ARCHIVE_DAYS = 90;

const dayNumber = (day: string) => Math.floor(Date.parse(day + "T00:00:00Z") / 86400000);

export interface ResultRow { day: string; game: Game; player: string; bucket: string }

/** Validate a submission: either a row to store, or a reason to refuse it. */
export function readResult(body: unknown, today: string): { row?: ResultRow; why?: string } {
  if (!body || typeof body !== "object") return { why: "expected an object" };
  const { day, game, player, bucket } = body as Record<string, unknown>;
  if (typeof day !== "string" || !DAY.test(day)) return { why: "bad day" };
  if (typeof game !== "string" || !(GAMES as readonly string[]).includes(game)) return { why: "bad game" };
  if (typeof player !== "string" || !PLAYER.test(player)) return { why: "bad player" };
  if (typeof bucket !== "string" || !BUCKETS[game as Game].includes(bucket)) return { why: "bad bucket" };
  // Only days the archive actually offers, give or take the date line. A board
  // is picked by the player's own calendar while the server keeps UTC, so
  // between the two midnights anyone east of UTC is a day ahead of the server
  // and anyone west of it a day behind. Both are playing today where they
  // stand, so a day either side of the window still counts.
  const age = dayNumber(today) - dayNumber(day);
  if (!Number.isFinite(age) || age < -1 || age > ARCHIVE_DAYS) return { why: "day out of range" };
  return { row: { day, game: game as Game, player, bucket } };
}

/** Fold the raw rows into per-game totals the page can draw directly.
 *  The bucket keys carry no display order — integer-like keys get reordered by
 *  the language — so the page keeps its own list of which order to draw. */
export function tally(rows: { game: string; bucket: string; n: number }[]) {
  const games: Record<string, { total: number; buckets: Record<string, number> }> = {};
  for (const game of GAMES) {
    games[game] = { total: 0, buckets: Object.fromEntries(BUCKETS[game].map(b => [b, 0])) };
  }
  for (const { game, bucket, n } of rows) {
    const slot = games[game];
    if (!slot || !(bucket in slot.buckets)) continue;   // a bucket we retired
    slot.buckets[bucket] += n;
    slot.total += n;
  }
  return games;
}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });

// The table is created on the first request an isolate serves, so attaching a
// database is the only setup step; there is no migration to remember.
let prepared: Promise<unknown> | null = null;
function ready(db: D1Database) {
  if (!prepared) {
    prepared = db.exec(
      "CREATE TABLE IF NOT EXISTS results (day TEXT NOT NULL, game TEXT NOT NULL, " +
      "player TEXT NOT NULL, bucket TEXT NOT NULL, PRIMARY KEY (day, game, player))"
    ).catch((err) => { prepared = null; throw err; });
  }
  return prepared;
}

const today = () => new Date().toISOString().slice(0, 10);

const statsKey = (origin: string, day: string) =>
  new Request(new URL("/api/stats?date=" + day, origin).toString());
const edgeCache = () => (caches as unknown as { default: Cache }).default;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      // Static assets normally answer before the worker runs; this is the
      // fallback for anything that slips through.
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }
    if (!env.STATS) return json({ enabled: false }, { status: 200 });

    if (url.pathname === "/api/result" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, { status: 400 }); }
      const parsed = readResult(body, today());
      if (!parsed.row) return json({ error: parsed.why }, { status: 400 });
      const { day, game, player, bucket } = parsed.row;
      await ready(env.STATS);
      // First result for this player and day wins; later ones are ignored.
      await env.STATS.prepare(
        "INSERT OR IGNORE INTO results (day, game, player, bucket) VALUES (?, ?, ?, ?)"
      ).bind(day, game, player, bucket).run();
      // Drop the cached tally for that day, or a player who has just finished
      // would read a minute-old histogram that does not include them.
      await edgeCache().delete(statsKey(url.origin, day));
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      const day = url.searchParams.get("date") || "";
      if (!DAY.test(day)) return json({ error: "bad day" }, { status: 400 });
      // A popular day would otherwise run the same GROUP BY for every visitor.
      const key = statsKey(url.origin, day);
      const cache = edgeCache();
      const hit = await cache.match(key);
      if (hit) return hit;
      await ready(env.STATS);
      const { results } = await env.STATS.prepare(
        "SELECT game, bucket, COUNT(*) AS n FROM results WHERE day = ? GROUP BY game, bucket"
      ).bind(day).all<{ game: string; bucket: string; n: number }>();
      // s-maxage only, deliberately: shared caches may hold this for a minute,
      // but the browser must not. A player who has just finished re-reads this
      // immediately, and a privately cached copy would never include them.
      const fresh = json({ enabled: true, date: day, games: tally(results) },
        { headers: { "cache-control": "public, max-age=0, s-maxage=60" } });
      await cache.put(key, fresh.clone());
      return fresh;
    }

    return json({ error: "not found" }, { status: 404 });
  },
};
