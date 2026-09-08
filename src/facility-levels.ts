/* HardMode — Facility Location.
 *
 * A bright island world: half to four-fifths of the board is sea. A handful of
 * towns sit on the land, and you get a fixed number of depots to drop. Every
 * town then walks to its nearest depot, over land only, and the score is the
 * total of those walks. Lower is better; the target is the exact optimum.
 *
 * Travel over land is what makes the map matter. A depot two cells away across
 * a channel is useless, so the coastline — not the picture — is the puzzle. */

export type Cell = [number, number];

export interface FacilityBoard {
  N: number;
  land: Set<string>;      // every walkable cell; everything else is sea
  rough: Map<string, number>;  // land that costs more than plain ground to cross
  towns: Cell[];
  townSet: Set<string>;
  slots: number;          // depots you may place
  kind: string;           // the map family, shown on the board
  target: number;         // exact minimum total travel
  greedy: number;         // what dropping depots one at a time scores
}

// Bumped whenever the level pool changes, so saved runs never mix generations.
export const FACILITY_REVISION = 'relief-1';

// What it costs to cross a step of ground. Marsh and highland are the only two
// grades: enough to bend a route without needing a key to read the map.
export const PLAIN = 1, MARSH = 2, HIGHLAND = 3;

// A town cut off from every depot scores this rather than infinity, so totals
// stay comparable while still being far worse than any journey on the board —
// which, on rough ground, can run to several hundred.
export const MAROONED = 9999;

// A world rather than a diagram: at this size an island has an interior, a
// channel has a length, and where exactly a depot sits starts to matter.
const N_DEFAULT = 28;
const key = ([r, c]: Cell): string => `${r},${c}`;
const parse = (k: string): Cell => { const i = k.indexOf(','); return [+k.slice(0, i), +k.slice(i + 1)]; };
const inside = (N: number, r: number, c: number) => r >= 0 && c >= 0 && r < N && c < N;

// Stable numeric seed: never use function names, which bundlers can rename.
function random(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function neighbours(N: number, k: string): string[] {
  const [r, c] = parse(k);
  const out: string[] = [];
  if (r > 0) out.push(`${r - 1},${c}`);
  if (r < N - 1) out.push(`${r + 1},${c}`);
  if (c > 0) out.push(`${r},${c - 1}`);
  if (c < N - 1) out.push(`${r},${c + 1}`);
  return out;
}

// Crossing between two cells costs whatever the rougher of the two costs, so a
// step is priced the same in both directions and a depot on a town is still 0.
export const stepCost = (rough: Map<string, number>, a: string, b: string) =>
  Math.max(rough.get(a) ?? PLAIN, rough.get(b) ?? PLAIN);

/**
 * Cheapest walk over land from any number of starting cells at once.
 *
 * Steps cost 1, 2 or 3, so a row of buckets ordered by distance is already a
 * priority queue: the next cell to settle is simply the next bucket with
 * anything in it, and no comparison is ever made.
 */
export function distanceFrom(
  N: number, land: Set<string>, rough: Map<string, number>, sources: Iterable<string>,
): Map<string, number> {
  const dist = new Map<string, number>();
  const buckets: string[][] = [];
  const offer = (k: string, d: number) => {
    const seen = dist.get(k);
    if (seen !== undefined && seen <= d) return;
    dist.set(k, d);
    (buckets[d] ||= []).push(k);
  };
  for (const s of sources) if (land.has(s)) offer(s, 0);
  for (let d = 0; d < buckets.length; d++) {
    const here = buckets[d];
    if (!here) continue;
    for (const k of here) {
      if (dist.get(k) !== d) continue;              // a cheaper way here turned up later
      for (const next of neighbours(N, k)) {
        if (land.has(next)) offer(next, d + stepCost(rough, k, next));
      }
    }
  }
  return dist;
}

/** Score a placement: how far each town walks, and whether it gets there. */
export function evaluate(board: FacilityBoard, placed: Iterable<string>) {
  const field = distanceFrom(board.N, board.land, board.rough, placed);
  const per = board.towns.map(t => field.has(key(t)) ? field.get(key(t))! : MAROONED);
  return { per, field, total: per.reduce((a, b) => a + b, 0), served: per.map(d => d < MAROONED) };
}

/** Walk one cell down a distance field to its source, listing the steps taken. */
export function descend(
  N: number, rough: Map<string, number>, field: Map<string, number>, from: string,
): string[] {
  const steps: string[] = [];
  let here = from, left = field.get(from);
  while (left !== undefined && left > 0) {
    // A neighbour whose own distance plus the step onto it accounts for the
    // whole of what is left lies on a cheapest route; the first found will do.
    const next = neighbours(N, here).find(nk => {
      const d = field.get(nk);
      return d !== undefined && d + stepCost(rough, here, nk) === left;
    });
    if (next === undefined) break;
    steps.push(next);
    here = next;
    left = field.get(next);
  }
  return steps;
}

/** The cells each town actually walks over, for drawing the routes it pays for. */
export function routeCells(board: FacilityBoard, placed: Iterable<string>): Set<string> {
  const field = distanceFrom(board.N, board.land, board.rough, placed);
  const on = new Set<string>();
  for (const town of board.towns) {
    for (const cell of descend(board.N, board.rough, field, key(town))) on.add(cell);
  }
  return on;
}

// ---------- map families ----------
// Each paints land onto an empty board; fitWater then trims or grows the
// coastline until the sea covers between half and four-fifths of it.

function blob(land: Set<string>, N: number, cr: number, cc: number, radius: number, rnd: () => number) {
  const span = Math.ceil(radius) + 1;
  for (let r = Math.round(cr) - span; r <= Math.round(cr) + span; r++) {
    for (let c = Math.round(cc) - span; c <= Math.round(cc) + span; c++) {
      if (!inside(N, r, c)) continue;
      const d = Math.hypot(r - cr, c - cc);
      // A ragged rim reads as a coast; a clean circle reads as a logo.
      if (d <= radius - 0.35 || (d <= radius + 0.6 && rnd() < 0.55)) land.add(key([r, c]));
    }
  }
}

// Each family also says how much of its board should end up as sea: an
// archipelago that fills in until it is half land is just a continent.
// `relief` is [ridges, bogs]: how many highland spines and marshes the family
// wears, before scaling for the size of the board.
type Painted = { land: Set<string>; kind: string; water: [number, number]; relief: [number, number] };
type Painter = (rnd: () => number, N: number) => Painted;

// Sizes below are given in twelfths of the board, so a family keeps its
// character whatever resolution the world is drawn at.
const unit = (N: number) => N / 12;

const paintArchipelago: Painter = (rnd, N) => {
  const land = new Set<string>();
  const u = unit(N);
  const isles = Math.round((4 + rnd() * 4) * u);
  for (let i = 0; i < isles; i++) {
    blob(land, N, 1 + rnd() * (N - 2), 1 + rnd() * (N - 2), (1.1 + rnd() * 1.3) * u, rnd);
  }
  return { land, kind: 'archipelago', water: [0.68, 0.80], relief: [0, 2] };
};

const paintStrait: Painter = (rnd, N) => {
  const land = new Set<string>();
  const mid = (N - 1) / 2;
  const u = unit(N);
  const lean = (rnd() - 0.5) * 2 * u;                   // the channel need not be central
  blob(land, N, mid + (rnd() - 0.5) * 3 * u, N * 0.12, (3.4 + rnd() * 0.8) * u, rnd);
  blob(land, N, mid + (rnd() - 0.5) * 3 * u, N * 0.88, (3.4 + rnd() * 0.8) * u, rnd);
  // Stepping stones make crossing the channel tempting, rarely worth it.
  for (let i = 0, stones = Math.round((1 + rnd() * 2) * u); i < stones; i++) {
    blob(land, N, rnd() * N, mid + lean, (0.8 + rnd() * 0.5) * u, rnd);
  }
  // Then cut the channel back open: two coasts that have grown together are
  // one continent, and the crossing is the whole point of the family.
  const gate = Math.round(mid + lean), width = Math.max(1, Math.round(1.5 * u));
  for (let r = 0; r < N; r++) for (let d = -width; d <= width; d++) {
    if (inside(N, r, gate + d) && !(rnd() < 0.16 && d === 0)) land.delete(key([r, gate + d]));
  }
  return { land, kind: 'twin coasts', water: [0.52, 0.66], relief: [1, 1] };
};

const paintFjords: Painter = (rnd, N) => {
  const land = new Set<string>();
  const mid = (N - 1) / 2;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (Math.hypot(r - mid, c - mid) <= N * 0.47) land.add(key([r, c]));
  }
  const u = unit(N);
  for (let i = 0, cuts = Math.round((3 + rnd() * 3) * u); i < cuts; i++) {
    const fromTop = rnd() < 0.5;
    const step = fromTop ? 1 : -1;
    const wide = Math.max(1, Math.round(u));
    let r = fromTop ? 0 : N - 1, c = 1 + Math.floor(rnd() * (N - 2));
    for (let s = 0, len = Math.floor(N * (0.5 + rnd() * 0.45)); s < len; s++) {
      if (!inside(N, r, c)) break;
      for (let d = 0; d < wide; d++) land.delete(key([r, c + d]));
      if (rnd() < 0.4) land.delete(key([r, c + wide]));
      r += step;
      if (rnd() < 0.4) c += rnd() < 0.5 ? 1 : -1;
    }
  }
  return { land, kind: 'fjords', water: [0.50, 0.62], relief: [2, 0] };
};

const paintAtoll: Painter = (rnd, N) => {
  const land = new Set<string>();
  const cr = (N - 1) / 2 + (rnd() - 0.5), cc = (N - 1) / 2 + (rnd() - 0.5);
  const u = unit(N);
  const R = N * 0.36 + rnd() * 0.9 * u;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const d = Math.hypot(r - cr, c - cc);
    if (d <= R + 0.7 * u && d >= R - 1.4 * u) land.add(key([r, c]));
  }
  // Break the ring, or every atoll is the same puzzle turned round.
  const bite = Math.round(1.4 * u);
  for (let i = 0, gaps = 1 + Math.floor(rnd() * 2); i < gaps; i++) {
    const a = rnd() * Math.PI * 2;
    const gr = Math.round(cr + Math.cos(a) * R), gc = Math.round(cc + Math.sin(a) * R);
    for (let dr = -bite; dr <= bite; dr++) for (let dc = -bite; dc <= bite; dc++) land.delete(key([gr + dr, gc + dc]));
  }
  if (rnd() < 0.7) blob(land, N, cr, cc, 0.9 * u, rnd);
  return { land, kind: 'atoll', water: [0.62, 0.78], relief: [0, 2] };
};

const paintDelta: Painter = (rnd, N) => {
  const land = new Set<string>();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) land.add(key([r, c]));
  const u = unit(N);
  const carve = (r0: number, c0: number, len: number, widen: number): Cell => {
    let r = r0, c = c0;
    const wide = Math.max(2, Math.round(2 * u));
    for (let s = 0; s < len && inside(N, r, c); s++) {
      for (let d = 0; d < wide; d++) land.delete(key([r, c + d]));
      if (rnd() < widen) land.delete(key([r, c - 1]));
      r += 1;
      if (rnd() < 0.5) c += rnd() < 0.5 ? 1 : -1;
    }
    return [r, c];
  };
  const [r, c] = carve(0, 2 + Math.floor(rnd() * (N - 4)), Math.floor(N * 0.45), 0.4);
  const arms = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < arms; i++) carve(r, c + Math.round((i - (arms - 1) / 2) * 2.5 * u), N, 0.25);
  return { land, kind: 'river delta', water: [0.50, 0.65], relief: [0, 3] };
};

const paintIsthmus: Painter = (rnd, N) => {
  const land = new Set<string>();
  // Corner to corner, so the chain crosses the whole board instead of lying in
  // a band along one side with open ocean either way.
  const corners: Cell[] = [[0, 0], [0, N - 1], [N - 1, 0], [N - 1, N - 1]];
  const from = corners[Math.floor(rnd() * 4)];
  const to = corners.reduce((far, c) =>
    Math.hypot(c[0] - from[0], c[1] - from[1]) > Math.hypot(far[0] - from[0], far[1] - from[1]) ? c : far, from);
  const u = unit(N);
  const steps = Math.round((7 + rnd() * 3) * u);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sway = Math.sin(t * Math.PI) * (rnd() - 0.5) * N * 0.45;
    const r = from[0] + (to[0] - from[0]) * t + sway;
    const c = from[1] + (to[1] - from[1]) * t - sway;
    blob(land, N, Math.max(0, Math.min(N - 1, r)), Math.max(0, Math.min(N - 1, c)), (1.0 + rnd() * 0.7) * u, rnd);
  }
  return { land, kind: 'isthmus', water: [0.66, 0.80], relief: [2, 0] };
};

const paintLakes: Painter = (rnd, N) => {
  const land = new Set<string>();
  const u = unit(N), mid = (N - 1) / 2;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (Math.hypot(r - mid, c - mid) <= N * 0.48) land.add(key([r, c]));
  }
  // Inland seas cut nothing off, but every route has to decide which way round.
  for (let i = 0, lakes = 3 + Math.floor(rnd() * 3); i < lakes; i++) {
    const cr = 2 + rnd() * (N - 4), cc = 2 + rnd() * (N - 4);
    const R = (1.6 + rnd() * 1.9) * u;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (Math.hypot(r - cr, c - cc) <= R) land.delete(key([r, c]));
    }
  }
  return { land, kind: 'great lakes', water: [0.50, 0.64], relief: [1, 2] };
};

const paintCapes: Painter = (rnd, N) => {
  const land = new Set<string>();
  const u = unit(N), mid = (N - 1) / 2;
  blob(land, N, mid, mid, N * 0.17, rnd);
  const arms = 4 + Math.floor(rnd() * 3);
  const turn = rnd() * Math.PI;
  for (let i = 0; i < arms; i++) {
    const a = (2 * Math.PI * i) / arms + turn;
    // Each headland leaves the middle and wanders; the sea between two of them
    // is often a shorter way round than the land is.
    let r = mid, c = mid, drift = 0;
    for (let step = 0, len = Math.round(N * (0.34 + rnd() * 0.3)); step < len; step++) {
      drift += (rnd() - 0.5) * 0.25;
      r += Math.cos(a + drift); c += Math.sin(a + drift);
      if (!inside(N, Math.round(r), Math.round(c))) break;
      blob(land, N, r, c, (0.85 + rnd() * 0.5) * u, rnd);
    }
  }
  return { land, kind: 'capes', water: [0.58, 0.72], relief: [2, 1] };
};

const paintBarrier: Painter = (rnd, N) => {
  const land = new Set<string>();
  const u = unit(N);
  const west = rnd() < 0.5;                       // which side the mainland is on
  const shore = west ? N * 0.28 : N * 0.72;
  const swell = 1.2 + rnd() * 1.4, phase = rnd() * Math.PI * 2;
  for (let r = 0; r < N; r++) {
    const wave = Math.sin((r / N) * Math.PI * swell + phase) * 2.2 * u;
    for (let c = 0; c < N; c++) {
      if (west ? c < shore + wave : c > shore - wave) land.add(key([r, c]));
    }
  }
  // A broken reef offshore, and the lagoon it holds in.
  const reef = west ? shore + 5 * u : shore - 5 * u;
  for (let r = 0; r < N; r++) {
    if (rnd() < 0.2) continue;                    // a gap the sea comes through
    blob(land, N, r, reef + Math.sin(r / 2.5 + phase) * 1.1 * u, 0.75 * u, rnd);
  }
  return { land, kind: 'barrier coast', water: [0.55, 0.68], relief: [0, 2] };
};

export const FACILITY_FAMILIES: Painter[] = [
  paintArchipelago, paintStrait, paintFjords, paintAtoll, paintDelta, paintIsthmus,
  paintLakes, paintCapes, paintBarrier,
];

// ---------- relief ----------
// Terrain is laid on afterwards, over whatever coastline the family drew: a
// spine of highland that a route would rather go round, and marshes on the low
// wet ground near the water.

function ridge(land: Set<string>, rough: Map<string, number>, N: number, rnd: () => number) {
  const cells = [...land];
  if (!cells.length) return;
  let [r, c] = parse(cells[Math.floor(rnd() * cells.length)]);
  let a = rnd() * Math.PI * 2;
  const thick = rnd() < 0.4 ? 1 : 0;
  for (let step = 0, len = Math.round(N * (0.3 + rnd() * 0.4)); step < len; step++) {
    a += (rnd() - 0.5) * 0.5;
    r += Math.cos(a); c += Math.sin(a);
    for (let dr = -thick; dr <= thick; dr++) for (let dc = -thick; dc <= thick; dc++) {
      const k = key([Math.round(r) + dr, Math.round(c) + dc]);
      if (land.has(k)) rough.set(k, HIGHLAND);
    }
  }
}

function bog(land: Set<string>, rough: Map<string, number>, N: number, rnd: () => number) {
  // Marsh wants a shoreline, so start from land that has water within a step.
  const shore = [...land].filter(k => neighbours(N, k).some(nk => !land.has(nk)) ||
    neighbours(N, k).length < 4);
  const seed = (shore.length ? shore : [...land])[Math.floor(rnd() * (shore.length || land.size))];
  if (!seed) return;
  const [cr, cc] = parse(seed);
  const R = (0.9 + rnd() * 1.1) * unit(N);
  for (let r = Math.round(cr - R) - 1; r <= cr + R + 1; r++) {
    for (let c = Math.round(cc - R) - 1; c <= cc + R + 1; c++) {
      const k = key([r, c]);
      if (!land.has(k) || rough.has(k)) continue;
      const d = Math.hypot(r - cr, c - cc);
      if (d <= R - 0.4 || (d <= R + 0.6 && rnd() < 0.5)) rough.set(k, MARSH);
    }
  }
}

// Terrain is a feature of the map, not the map itself: past about a third of
// the land it stops reading as marsh and hills and just becomes the ground.
const RELIEF_CAP = 0.36;

function roughen(land: Set<string>, N: number, rnd: () => number, relief: [number, number]) {
  const rough = new Map<string, number>();
  const u = unit(N), cap = land.size * RELIEF_CAP;
  for (let i = 0, n = Math.round(relief[0] * u); i < n && rough.size < cap; i++) ridge(land, rough, N, rnd);
  for (let i = 0, n = Math.round(relief[1] * u); i < n && rough.size < cap; i++) bog(land, rough, N, rnd);
  return rough;
}


// Sample a few candidates and keep the best: cheaper than sorting, and the
// randomness keeps coastlines from turning out identically smooth every time.
function pickBest<T>(rnd: () => number, pool: T[], tries: number, score: (item: T) => number): T | null {
  if (!pool.length) return null;
  let best = pool[Math.floor(rnd() * pool.length)];
  let bestScore = score(best);
  for (let i = 1; i < tries; i++) {
    const c = pool[Math.floor(rnd() * pool.length)];
    const s = score(c);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return best;
}

/** Erode or flood the coast until the sea covers the wanted share of the board. */
function fitWater(land: Set<string>, N: number, rnd: () => number, lo: number, hi: number) {
  const total = N * N;
  // Off-board counts as sea, so erosion eats the edges first and the map ends
  // up an island rather than a rectangle with holes.
  const seaAround = (k: string) => 4 - neighbours(N, k).filter(nk => land.has(nk)).length;
  const landAround = (k: string) => neighbours(N, k).filter(nk => land.has(nk)).length;
  let guard = total * 4;
  while ((total - land.size) / total < lo && guard-- > 0) {
    const pick = pickBest(rnd, [...land], 6, seaAround);
    if (pick === null) break;
    land.delete(pick);
  }
  guard = total * 4;
  while ((total - land.size) / total > hi && guard-- > 0) {
    const shore = new Set<string>();
    for (const k of land) for (const nk of neighbours(N, k)) if (!land.has(nk)) shore.add(nk);
    const pick = pickBest(rnd, [...shore], 6, landAround);
    if (pick === null) break;
    land.add(pick);
  }
}

// A map with every island crowded into one corner wastes most of the board, so
// the coastline has to reach across it in both directions.
function wellSpread(N: number, land: Set<string>): boolean {
  let top = N, bottom = -1, left = N, right = -1;
  for (const k of land) {
    const [r, c] = parse(k);
    if (r < top) top = r;
    if (r > bottom) bottom = r;
    if (c < left) left = c;
    if (c > right) right = c;
  }
  const reach = Math.ceil(N * 0.7) - 1;
  return bottom - top >= reach && right - left >= reach;
}

/** Land masses, largest first. */
export function islands(N: number, land: Set<string>): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const start of land) {
    if (seen.has(start)) continue;
    const group: string[] = [];
    const queue = [start];
    seen.add(start);
    for (let i = 0; i < queue.length; i++) {
      group.push(queue[i]);
      for (const nk of neighbours(N, queue[i])) {
        if (land.has(nk) && !seen.has(nk)) { seen.add(nk); queue.push(nk); }
      }
    }
    out.push(group);
  }
  return out.sort((a, b) => b.length - a.length);
}

// One town per island first — an island nobody lives on is scenery — then keep
// adding whichever free cell sits farthest from the towns already placed.
function scatter(groups: string[][], count: number, rnd: () => number, jitter: number): string[] {
  const towns: string[] = [];
  for (const g of groups) if (towns.length < count) towns.push(g[Math.floor(rnd() * g.length)]);
  const pool = groups.flat();
  const apart = (a: string, b: string) => {
    const [ar, ac] = parse(a), [br, bc] = parse(b);
    return Math.abs(ar - br) + Math.abs(ac - bc);
  };
  while (towns.length < count) {
    let best: string | null = null, bestScore = -1;
    for (const k of pool) {
      if (towns.includes(k)) continue;
      let near = Infinity;
      for (const t of towns) near = Math.min(near, apart(k, t));
      const s = near + rnd() * jitter;   // so identical gaps do not always pick the same cell
      if (s > bestScore) { bestScore = s; best = k; }
    }
    if (best === null) break;
    towns.push(best);
  }
  return towns;
}

// ---------- the exact optimum ----------

/**
 * Exact k-median over a distance table of [town][site].
 *
 * Enumerating sites is hopeless once a map has hundreds of land cells, but the
 * towns are always few. Any placement splits the towns into groups by which
 * depot they walk to, so the answer is the cheapest way of partitioning the
 * towns into `k` groups, where a group costs whatever its own best single site
 * costs. That is a subset DP over the towns: exponential in a handful, and
 * flat in the size of the board.
 */
export function bestPlacement(dist: number[][], k: number): { cost: number; sites: number[] } {
  const towns = dist.length;
  if (!towns) return { cost: 0, sites: [] };
  const total = dist[0].length;
  if (!total || k <= 0) return { cost: towns * MAROONED, sites: [] };
  const parts = Math.min(k, towns);
  const full = (1 << towns) - 1;

  // The best single site for every possible group of towns.
  const groupCost = new Float64Array(full + 1).fill(Infinity);
  const groupSite = new Int32Array(full + 1).fill(-1);
  for (let s = 0; s < total; s++) {
    // Walking the subsets in order lets each one extend a smaller one it
    // already knows, so no group is ever added up from scratch.
    const sum = new Float64Array(full + 1);
    for (let mask = 1; mask <= full; mask++) {
      const low = mask & -mask;
      sum[mask] = sum[mask ^ low] + dist[31 - Math.clz32(low)][s];
      if (sum[mask] < groupCost[mask]) { groupCost[mask] = sum[mask]; groupSite[mask] = s; }
    }
  }

  // Then the cheapest split of all the towns into that many groups. Splitting
  // never costs more, so exactly `parts` groups is also the best of any fewer.
  let table = groupCost;
  let from: Int32Array[] = [];
  for (let round = 2; round <= parts; round++) {
    const next = new Float64Array(full + 1).fill(Infinity);
    const pick = new Int32Array(full + 1).fill(0);
    for (let mask = 1; mask <= full; mask++) {
      // Pin the lowest town to the group being split off, so each partition is
      // built exactly once instead of once per ordering of its groups.
      const low = mask & -mask;
      for (let rest = (mask - 1) & mask; ; rest = (rest - 1) & mask) {
        const group = mask ^ rest;
        if (group & low) {
          const c = groupCost[group] + (rest ? table[rest] : 0);
          if (c < next[mask]) { next[mask] = c; pick[mask] = group; }
        }
        if (rest === 0) break;
      }
    }
    table = next;
    from.push(pick);
  }

  const sites: number[] = [];
  let mask = full;
  for (let round = from.length - 1; round >= 0 && mask; round--) {
    const group = from[round][mask];
    sites.push(groupSite[group]);
    mask ^= group;
  }
  if (mask) sites.push(groupSite[mask]);
  return { cost: table[full], sites: [...new Set(sites)].filter(i => i >= 0) };
}

/** Depots dropped one at a time, each wherever it helps most right now. */
export function greedyPlacement(dist: number[][], k: number): { cost: number; sites: number[] } {
  const towns = dist.length;
  if (!towns) return { cost: 0, sites: [] };
  const total = dist[0].length;
  const near = new Float64Array(towns).fill(MAROONED);
  const sites: number[] = [];
  for (let round = 0; round < k && round < total; round++) {
    let pick = -1, pickCost = Infinity;
    for (let s = 0; s < total; s++) {
      if (sites.includes(s)) continue;
      let sum = 0;
      for (let t = 0; t < towns; t++) sum += Math.min(near[t], dist[t][s]);
      if (sum < pickCost) { pickCost = sum; pick = s; }
    }
    if (pick < 0) break;
    for (let t = 0; t < towns; t++) near[t] = Math.min(near[t], dist[t][pick]);
    sites.push(pick);
  }
  let cost = 0;
  for (let t = 0; t < towns; t++) cost += near[t];
  return { cost, sites };
}

// Every land cell some town can actually reach, with the walk from each town.
function reachTable(N: number, land: Set<string>, rough: Map<string, number>, towns: Cell[]) {
  const fields = towns.map(t => distanceFrom(N, land, rough, [key(t)]));
  const sites = [...land].filter(k => fields.some(f => f.has(k)));
  const dist = fields.map(f => sites.map(s => f.has(s) ? f.get(s)! : MAROONED));
  return { sites, dist };
}

/** How many depots the exact answer really uses — the rest are spares. */
export function optimalSites(board: FacilityBoard): string[] {
  const { sites, dist } = reachTable(board.N, board.land, board.rough, board.towns);
  return bestPlacement(dist, board.slots).sites.map(i => sites[i]);
}

// A level is only worth playing if dropping depots one at a time gets it wrong.
export const FACILITY_MIN_GAP = 2;
// Distances grow with the board, so what counts as a substantial answer does too.
export const minTarget = (N: number) => Math.round(N * 0.9);

export function generateFacility(dateKey: string): FacilityBoard {
  const N = N_DEFAULT;
  // The family is fixed by the date, so a day has one identity however many
  // attempts it takes to find a board on it worth playing.
  const chooser = random(`${FACILITY_REVISION}|family|${dateKey}`);
  const painter = FACILITY_FAMILIES[Math.floor(chooser() * FACILITY_FAMILIES.length)];
  let fallback: FacilityBoard | null = null;

  for (let attempt = 0; attempt < 220; attempt++) {
    const rnd = random(`${FACILITY_REVISION}|${dateKey}|${attempt}`);
    const { land, kind, water, relief } = painter(rnd, N);
    fitWater(land, N, rnd, water[0], water[1]);
    const groups = islands(N, land).filter(g => g.length >= 2);
    if (!groups.length || groups[0].length < N) continue;
    if (!wellSpread(N, land)) continue;

    const slots = 3 + Math.floor(rnd() * 3);                       // 3..5 depots
    // Never strand a town: an island with people on it needs a depot of its own,
    // so the map can only use as many inhabited islands as there are depots.
    // Where the sea does divide the board, settle both sides of it — otherwise
    // the channel is scenery and the map may as well have been one continent.
    const roomy = groups.filter(g => g.length >= N / 2).length;
    const isles = Math.min(roomy >= 2 ? 2 + Math.floor(rnd() * 2) : 1, slots, groups.length);
    const lived = groups.slice(0, isles);
    const townCount = Math.min(9, slots + 3 + Math.floor(rnd() * 2));
    if (lived.reduce((a, g) => a + g.length, 0) < townCount * 3) continue;

    const townKeys = scatter(lived, townCount, rnd, unit(N));
    if (townKeys.length < townCount) continue;
    const towns = townKeys.map(parse);

    const rough = roughen(land, N, rnd, relief);
    // Settlements stand on ordinary ground: a town in a marsh only makes its
    // own first step expensive, which reads as a bug rather than as terrain.
    for (const k of townKeys) rough.delete(k);
    if (rough.size > land.size * 0.45) continue;      // a safety net on the cap above

    const { sites, dist } = reachTable(N, land, rough, towns);
    if (sites.length < slots) continue;
    const exact = bestPlacement(dist, slots);
    if (!Number.isFinite(exact.cost) || exact.cost >= MAROONED) continue;
    const greedy = greedyPlacement(dist, slots).cost;

    const board: FacilityBoard = {
      N, land, rough, towns, townSet: new Set(townKeys), slots, kind,
      target: exact.cost, greedy,
    };
    if (exact.cost < minTarget(N)) continue;
    if (!fallback) fallback = board;
    if (greedy - exact.cost >= FACILITY_MIN_GAP) return board;
    // Later attempts settle for any board with a real answer on it rather than
    // hand back a map nobody drew.
    if (attempt > 170) return board;
  }
  return fallback ?? fallbackFacility();
}

/** A hand-built board, used only if generation somehow finds nothing at all. */
export function fallbackFacility(): FacilityBoard {
  const N = N_DEFAULT;
  const land = new Set<string>();
  for (let r = 2; r <= 9; r++) for (let c = 2; c <= 9; c++) {
    if (c === 5 && r !== 6) continue;              // a channel with one crossing
    land.add(key([r, c]));
  }
  const towns: Cell[] = [[2, 2], [9, 3], [2, 9], [9, 9], [5, 7]];
  const townSet = new Set(towns.map(key));
  const rough = new Map<string, number>();
  const slots = 2;
  const { sites, dist } = reachTable(N, land, rough, towns);
  const exact = bestPlacement(dist, slots);
  return {
    N, land, rough, towns, townSet, slots, kind: 'channel',
    target: exact.cost, greedy: greedyPlacement(dist, slots).cost,
  };
}
