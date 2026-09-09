/* HardMode — Hillclimb.
 *
 * One planet a day, and twenty-eight steps to learn it. The world is generated
 * from the date alone, so everybody walks the same ground, and it is generated
 * in the order a real one is made: height first, then the sea, then the ocean
 * currents, then the winds that carry rain inland, and only then the biomes
 * that fall out of the temperature and the rainfall at each square.
 *
 * Nothing here is a simulation — it is the shape of the thing, not the physics.
 * But the shape is enough for the map to be readable: rainforest sits on the
 * equator, deserts sit under the subtropical highs and in the rain shadows of
 * mountains, cold currents chill one coast of an ocean while warm ones soften
 * the other, and the poles ice over. A player who knows how Earth is laid out
 * can reason about where the mountains are before they see them, which is the
 * whole game. */

export const HILLCLIMB_REVISION = 'world-2';

// The world is a cylinder: east and west wrap, north and south are the poles.
// Two degrees of latitude to the row: fine enough for a coastline to have
// inlets and for a range to have a pass through it, coarse enough to stay
// legible at four pixels a square.
export const W = 160;
export const H = 92;

// A move is a day's travel, and the budget reaches about five-sixths of the way
// round the planet — enough to cross an ocean and come back, never enough to
// see all of it. The sight radius keeps consecutive stops overlapping, so the
// trail you leave is a continuous corridor rather than a string of islands.
export const MOVES = 28;
export const STRIDE = 5;
export const SIGHT = 8;

// How many landmarks a day's budget is expected to allow. Scores are measured
// against this, and the pool below runs deeper so that there is always another
// one waiting behind the pair on offer.
export const GOALS_MAX = 4;

// How many are live at once. The choice is always between exactly two: the
// next one on the natural route, and the one past it — so taking the further
// one first is a real gamble rather than a menu.
export const LIVE = 2;

// How near counts as standing on a landmark. This is not generosity: a move
// covers STRIDE squares, so the squares any walk can stop on form a lattice
// STRIDE apart, and the nearest lattice point to an arbitrary square is up to
// half a stride away on each axis. A tighter radius would leave landmarks that
// no route on the board could ever land beside.
export const TOUCH = Math.floor(STRIDE / 2);

export interface BiomeDef {
  id: string;
  name: string;
  water?: boolean;
  colour: string;   // light themes
  dark: string;     // dark and terminal themes
}

/* The palette is the site's: pale, bright, and flat. Relief is drawn by
   shading these with altitude at paint time rather than by adding more
   greens, so the map stays readable at five pixels a square. */
export const BIOMES: BiomeDef[] = [
  { id: 'ocean',      name: 'open ocean',        water: true, colour: '#8cc0e8', dark: '#16324a' },
  { id: 'shallow',    name: 'shallow sea',       water: true, colour: '#b6dcf4', dark: '#1d4763' },
  { id: 'seaice',     name: 'sea ice',           water: true, colour: '#e2eef6', dark: '#48606f' },
  { id: 'icecap',     name: 'ice cap',                        colour: '#f7fafc', dark: '#dbe4ea' },
  { id: 'snowline',   name: 'snowfield',                      colour: '#ffffff', dark: '#f0f5f8' },
  { id: 'alpine',     name: 'bare mountain',                  colour: '#c8c1b6', dark: '#7b7268' },
  { id: 'tundra',     name: 'tundra',                         colour: '#ccd5ba', dark: '#59654c' },
  { id: 'taiga',      name: 'boreal forest',                  colour: '#7ba97f', dark: '#2f5b3c' },
  { id: 'forest',     name: 'temperate forest',               colour: '#9ccb7a', dark: '#3f7038' },
  { id: 'grassland',  name: 'grassland',                      colour: '#dbeaa8', dark: '#66763a' },
  { id: 'shrubland',  name: 'shrubland',                      colour: '#ddd49a', dark: '#6d6534' },
  { id: 'desert',     name: 'desert',                         colour: '#f5e7b3', dark: '#7a6835' },
  { id: 'savannah',   name: 'savannah',                       colour: '#edd58c', dark: '#7a6a2e' },
  { id: 'monsoon',    name: 'seasonal forest',                colour: '#6fb35f', dark: '#33652f' },
  { id: 'rainforest', name: 'rainforest',                     colour: '#3d8f55', dark: '#21522f' },
];

export const B: Record<string, number> = {};
BIOMES.forEach((b, i) => { B[b.id] = i; });

export const idx = (r: number, c: number) => r * W + c;
export const rowOf = (i: number) => Math.floor(i / W);
export const colOf = (i: number) => i % W;
export const wrapC = (c: number) => ((c % W) + W) % W;
/** North pole at row 0, south pole at row H-1. */
export const latOf = (r: number) => 90 - 180 * ((r + 0.5) / H);

/** Shortest east-west separation on a cylinder. */
export const dxWrap = (a: number, b: number) => {
  const d = Math.abs(a - b);
  return Math.min(d, W - d);
};
/** How many moves apart two squares are, at this stride. */
export const movesBetween = (a: number, b: number) =>
  Math.ceil(Math.max(dxWrap(colOf(a), colOf(b)), Math.abs(rowOf(a) - rowOf(b))) / STRIDE);

/** How many moves to the nearest part of a landmark. Never the distance to its
 *  middle: a polar cap wraps the whole world and a desert can be a hundred
 *  squares across, so the middle of one says almost nothing about the walk. */
export function movesTo(from: number, cells: Iterable<number>): number {
  let best = Infinity;
  for (const cell of cells) {
    const d = movesBetween(from, cell);
    if (d < best) { best = d; if (!best) break; }
  }
  return best;
}

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

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ---------- noise ----------
   Value noise on a lattice that is periodic east-west, so the map joins itself
   at the seam with no visible edge. The vertical lattice is clamped instead:
   the poles are the top and bottom of the world, not a wrap. */

interface Lattice { v: Float32Array; lx: number; ly: number }

function lattice(rnd: () => number, lx: number): Lattice {
  const ly = Math.max(2, Math.round((lx * H) / W) + 1);
  const v = new Float32Array(lx * ly);
  for (let i = 0; i < v.length; i++) v[i] = rnd();
  return { v, lx, ly };
}

function sample(l: Lattice, r: number, c: number): number {
  const fx = (c / W) * l.lx;
  const fy = (r / (H - 1)) * (l.ly - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = smooth(fx - x0), ty = smooth(fy - y0);
  const xa = ((x0 % l.lx) + l.lx) % l.lx, xb = (xa + 1) % l.lx;
  const ya = Math.min(Math.max(y0, 0), l.ly - 1), yb = Math.min(ya + 1, l.ly - 1);
  const v00 = l.v[ya * l.lx + xa], v10 = l.v[ya * l.lx + xb];
  const v01 = l.v[yb * l.lx + xa], v11 = l.v[yb * l.lx + xb];
  const top = v00 + (v10 - v00) * tx;
  const bot = v01 + (v11 - v01) * tx;
  return top + (bot - top) * ty;
}

/** Layered noise, coarse to fine. `ridged` folds each octave about its middle,
 *  which turns round blobs into the long creases that read as ranges. */
function field(rnd: () => number, base: number, octaves: number, ridged: boolean): Float32Array {
  const layers: Lattice[] = [];
  for (let o = 0; o < octaves; o++) layers.push(lattice(rnd, base << o));
  const out = new Float32Array(W * H);
  let norm = 0;
  for (let o = 0; o < octaves; o++) norm += Math.pow(0.5, o);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    let sum = 0;
    for (let o = 0; o < octaves; o++) {
      const n = sample(layers[o], r, c);
      sum += Math.pow(0.5, o) * (ridged ? 1 - Math.abs(2 * n - 1) : n);
    }
    out[idx(r, c)] = sum / norm;
  }
  return out;
}

/** The value at which `share` of the field lies below. Used to fix the sea
 *  level, so every day has roughly the same amount of land however the noise
 *  happened to come out. */
function quantile(data: ArrayLike<number>, share: number): number {
  const sorted = Float64Array.from(data as ArrayLike<number>);
  sorted.sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

/** Rank each land value against the others and rewrite it as 0..1. Rainfall
 *  totals swing wildly between one world and the next; ranking them means a
 *  dry planet still has its wet quarter and its dry quarter, and the biome
 *  thresholds below can be fixed numbers rather than a chase. */
function rankOverLand(values: Float32Array, land: Uint8Array): Float32Array {
  const order: number[] = [];
  for (let i = 0; i < values.length; i++) if (land[i]) order.push(i);
  order.sort((a, b) => values[a] - values[b]);
  const out = new Float32Array(values.length);
  const n = Math.max(1, order.length - 1);
  order.forEach((i, rank) => { out[i] = rank / n; });
  return out;
}

/* ---------- climate ---------- */

/** Which way the air travels at this latitude. Trade winds and polar
 *  easterlies run west; the mid-latitude westerlies run east. It is the reason
 *  a coast can be soaked on one side of a continent and parched on the other. */
export function windDir(lat: number): -1 | 1 {
  const a = Math.abs(lat);
  return a < 30 || a >= 60 ? -1 : 1;
}

/** The named wind, for the readout. */
export function windName(lat: number): string {
  const a = Math.abs(lat);
  return a < 30 ? 'trade winds' : a < 60 ? 'westerlies' : 'polar easterlies';
}

/** Sunshine minus latitude. Roughly Earth's sea-level profile. */
const baseTemp = (lat: number) => 33 - 62 * Math.pow(Math.abs(lat) / 90, 1.35);

/** Rainfall before the land has had its say: wet on the equator where the
 *  trades converge, dry under the subtropical highs, wet again where the
 *  westerlies pile storms into the mid-latitudes, dry over the poles. */
function zonalRain(lat: number): number {
  const a = Math.abs(lat);
  const itcz = 1.15 * Math.exp(-Math.pow(lat / 10, 2));
  const storm = 0.55 * Math.exp(-Math.pow((a - 50) / 17, 2));
  const horse = 1 - 0.62 * Math.exp(-Math.pow((a - 27) / 10, 2));
  const polar = 1 - 0.45 * clamp01((a - 68) / 22);
  return (0.42 + itcz + storm) * horse * polar;
}

/**
 * A crude gyre. Every ocean basin turns, which means warm water runs poleward
 * up one side of it and cold water runs back down the other; on Earth that is
 * the Gulf Stream against the Benguela. Here a square simply asks how far the
 * land is to its east and to its west: ocean hugging a western shore is on the
 * poleward-flowing side and runs warm, ocean hugging an eastern shore runs
 * cold. Nothing spins, but the coasts end up on the right sides.
 */
function currents(land: Uint8Array): Float32Array {
  const warmth = new Float32Array(W * H);
  for (let r = 0; r < H; r++) {
    const lat = latOf(r);
    // Strongest where the real gyres are, fading at the equator and the poles.
    const band = Math.exp(-Math.pow((Math.abs(lat) - 38) / 24, 2));
    if (band < 0.03) continue;
    for (let c = 0; c < W; c++) {
      const i = idx(r, c);
      if (land[i]) continue;
      let east = W, west = W;
      for (let d = 1; d <= W / 2; d++) {
        if (east === W && land[idx(r, wrapC(c + d))]) east = d;
        if (west === W && land[idx(r, wrapC(c - d))]) west = d;
        if (east < W && west < W) break;
      }
      if (east === W && west === W) continue;          // an unbroken ocean row
      // Positive when the near shore is to the west — the warm side.
      const side = (east - west) / (east + west);
      warmth[i] = 6.5 * band * side;
    }
  }
  return warmth;
}

export interface World {
  day: string;
  metres: Int16Array;        // height above sea level; 0 everywhere at sea
  depth: Float32Array;       // 0..1 below sea level, 0 on land
  tempC: Float32Array;
  rain: Float32Array;        // 0..1, ranked over land
  biome: Uint8Array;
  land: Uint8Array;
  summit: number;            // cell index of the highest ground
  summitM: number;
  spawn: number;
  goals: Landmark[];         // the day's pool, in the order it comes on offer
  rungs: number;             // how many of them the budget is built to allow
  checklist: number[];       // land biomes present in useful quantity
}

export interface Landmark {
  id: string;
  name: string;      // "an archipelago"
  hint: string;      // one line of guidance, shown when the rung is offered
  cells: Set<number>;
  centre: number;
}

/**
 * The day's planet, and a place on it to be dropped.
 *
 * The ground comes from the date alone, so everybody is walking the same world
 * and can compare what they found on it. Where you are dropped comes from
 * `drop` instead — a per-player value — so no two people start in the same
 * place, and the day is a world to explore rather than a route to memorise.
 *
 * The landmark chain is built from wherever that drop lands, not from a fixed
 * point, or its move budget would only hold for one starting square.
 */
export function generateWorld(day: string, drop = ''): World {
  const rnd = random('hillclimb-' + HILLCLIMB_REVISION + '-' + day);
  const dice = random('hillclimb-drop-' + HILLCLIMB_REVISION + '-' + day + '-' + drop);

  // ---- height ----
  // One broad field decides where the continents are; a ridged field creases
  // them into ranges, and only bites where the ground is already high, so
  // ranges run through the middle of a landmass rather than out to sea.
  const base = field(rnd, 3, 7, false);
  const ridge = field(rnd, 4, 6, true);
  const sea = quantile(base, 0.68);

  const metres = new Int16Array(W * H);
  const depth = new Float32Array(W * H);
  const land = new Uint8Array(W * H);
  for (let i = 0; i < base.length; i++) {
    if (base[i] <= sea) {
      depth[i] = clamp01((sea - base[i]) / Math.max(1e-6, sea));
      continue;
    }
    land[i] = 1;
    const above = (base[i] - sea) / Math.max(1e-6, 1 - sea);
    const relief = clamp01(above * (0.42 + 1.5 * ridge[i]));
    metres[i] = Math.round(7700 * Math.pow(relief, 1.55));
  }

  // ---- temperature ----
  const warmth = currents(land);
  const tempC = new Float32Array(W * H);
  const wobble = field(rnd, 5, 4, false);
  // Climate does not run in straight lines. One broad, slow field bends the
  // latitude every band is measured against, by up to seven degrees either
  // way — so the tree line, the rainforest belt and the deserts all wander
  // together, the way they do on a real map, instead of every biome changing
  // along the same ruled row.
  const bend = field(rnd, 2, 5, false);
  const bentLat = (r: number, i: number) => latOf(r) + (bend[i] - 0.5) * 19;
  for (let r = 0; r < H; r++) {
    const dir = windDir(latOf(r));
    for (let c = 0; c < W; c++) {
      const i = idx(r, c);
      let t = baseTemp(bentLat(r, i)) + (wobble[i] - 0.5) * 8;
      if (!land[i]) {
        t += warmth[i];
      } else {
        // A coast takes its weather from the water upwind of it, and the
        // further inland you go the less of that reaches you.
        for (let d = 1; d <= 7; d++) {
          const j = idx(r, wrapC(c - dir * d));
          if (!land[j]) { t += warmth[j] * (1 - d / 8) * 0.8; break; }
        }
        t -= (metres[i] / 1000) * 6.3;                 // lapse rate
      }
      tempC[i] = t;
    }
  }

  // ---- rain ----
  // Air walks the row in the direction the wind blows, twice round so it
  // arrives at the seam already carrying whatever it picked up. It takes water
  // up over the sea and drops it over land — hardest where the ground climbs,
  // which is what puts a desert behind every range.
  const humid = new Float32Array(W * H);
  for (let r = 0; r < H; r++) {
    const dir = windDir(latOf(r));
    let m = 0.5;
    let prevM = 0;
    for (let step = 0; step < 2 * W; step++) {
      const c = wrapC(dir > 0 ? step : -step);
      const i = idx(r, c);
      if (!land[i]) {
        const evap = 0.10 + 0.010 * Math.max(0, tempC[i]);
        m += (1 - m) * evap;
        prevM = 0;
      } else {
        const rise = Math.max(0, metres[i] - prevM) / 1000;
        const fall = m * clamp01(0.07 + 0.42 * rise);
        m = Math.max(0, m - fall) * 0.988;
        prevM = metres[i];
      }
      // Only the second lap is recorded; the first is there to charge the air.
      if (step >= W) humid[i] = m * zonalRain(bentLat(r, i));
    }
  }
  const rain = rankOverLand(humid, land);

  // ---- biomes ----
  const biome = new Uint8Array(W * H);
  for (let i = 0; i < biome.length; i++) {
    const t = tempC[i];
    if (!land[i]) {
      // Water this cold, averaged over a year, is water with a lid on it.
      biome[i] = t <= -8 ? B.seaice : depth[i] < 0.12 ? B.shallow : B.ocean;
      continue;
    }
    const m = rain[i], h = metres[i];
    // Above the treeline is a matter of height and cold together, which is why
    // bare rock starts near sea level in the far north and needs four thousand
    // metres on the equator.
    if (t <= -9 && h >= 800) biome[i] = B.snowline;
    else if (t <= 0.5 && h >= 700) biome[i] = B.alpine;
    else if (t <= -13) biome[i] = B.icecap;
    else if (t <= -2) biome[i] = B.tundra;
    else if (t <= 6) biome[i] = m >= 0.40 ? B.taiga : B.tundra;
    else if (t <= 19) biome[i] = m >= 0.66 ? B.forest : m >= 0.40 ? B.grassland : m >= 0.20 ? B.shrubland : B.desert;
    else biome[i] = m >= 0.74 ? B.rainforest : m >= 0.54 ? B.monsoon : m >= 0.28 ? B.savannah : B.desert;
  }

  // ---- the two things worth walking to ----
  let summit = -1, summitM = -1;
  for (let i = 0; i < metres.length; i++) if (land[i] && metres[i] > summitM) { summitM = metres[i]; summit = i; }

  const counts = new Map<number, number>();
  for (let i = 0; i < biome.length; i++) if (land[i]) counts.set(biome[i], (counts.get(biome[i]) || 0) + 1);
  const checklist = [...counts.entries()].filter(([, n]) => n >= 10).map(([b]) => b).sort((a, b) => a - b);

  const spawn = pickSpawn(dice, land, biome, summit);
  const { goals, rungs } = pickGoals(dice, { land, biome, metres, depth, summit, summitM }, spawn);

  return { day, metres, depth, tempC, rain, biome, land, summit, summitM, spawn, goals, rungs, checklist };
}

/* ---------- features ---------- */

/** Every connected run of squares the test accepts, four-connected, with the
 *  east-west wrap honoured so a continent split by the seam stays one thing. */
export function components(test: (i: number) => boolean): number[][] {
  const seen = new Uint8Array(W * H);
  const out: number[][] = [];
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || !test(start)) continue;
    const group: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      group.push(i);
      const r = rowOf(i), c = colOf(i);
      const around = [
        r > 0 ? idx(r - 1, c) : -1,
        r < H - 1 ? idx(r + 1, c) : -1,
        idx(r, wrapC(c - 1)),
        idx(r, wrapC(c + 1)),
      ];
      for (const j of around) if (j >= 0 && !seen[j] && test(j)) { seen[j] = 1; stack.push(j); }
    }
    out.push(group);
  }
  return out;
}

/** The middle of a group, taken the long way round so a group straddling the
 *  seam does not average out to a point on the far side of the world. */
export function centreOf(group: number[]): number {
  const anchor = colOf(group[0]);
  let sr = 0, sc = 0;
  for (const i of group) {
    sr += rowOf(i);
    let d = colOf(i) - anchor;
    if (d > W / 2) d -= W;
    if (d < -W / 2) d += W;
    sc += d;
  }
  const r = Math.round(sr / group.length);
  const c = wrapC(Math.round(anchor + sc / group.length));
  // The average of a ring is its hole, so fall back to the nearest member.
  let best = group[0], bestD = Infinity;
  for (const i of group) {
    const d = Math.pow(rowOf(i) - r, 2) + Math.pow(dxWrap(colOf(i), c), 2);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

interface Terrain {
  land: Uint8Array; biome: Uint8Array; metres: Int16Array; depth: Float32Array;
  summit: number; summitM: number;
}

type Candidate = { id: string; name: string; hint: string; cells: number[] };

function candidates(t: Terrain): Candidate[] {
  const found: Candidate[] = [];
  const landComps = components(i => t.land[i] === 1);
  const seaComps = components(i => t.land[i] === 0);
  const biomeComp = (ids: number[], min: number) =>
    components(i => t.land[i] === 1 && ids.includes(t.biome[i])).filter(g => g.length >= min);

  // An archipelago: three or more small islands sitting close together.
  const isles = landComps.filter(g => g.length <= 18);
  const used = new Set<number>();
  for (let a = 0; a < isles.length; a++) {
    if (used.has(a)) continue;
    const group = [a];
    const ca = centreOf(isles[a]);
    for (let b = 0; b < isles.length; b++) {
      if (b === a || used.has(b)) continue;
      const cb = centreOf(isles[b]);
      if (dxWrap(colOf(ca), colOf(cb)) <= 10 && Math.abs(rowOf(ca) - rowOf(cb)) <= 8) group.push(b);
    }
    if (group.length >= 3) {
      group.forEach(g => used.add(g));
      found.push({
        id: 'archipelago', name: 'an archipelago',
        hint: 'Three or more small islands within sight of each other. Look offshore, never inland.',
        cells: group.flatMap(g => isles[g]),
      });
    }
  }

  // An inland sea: water with no way out to the ocean.
  const openSea = seaComps.reduce((a, b) => (b.length > a.length ? b : a), [] as number[]);
  for (const g of seaComps) {
    if (g === openSea || g.length < 12) continue;
    found.push({
      id: 'inlandsea', name: 'an inland sea',
      hint: 'Water with no way out to the ocean. It will be ringed by land on every side.',
      cells: g,
    });
  }

  // A volcanic island: small, and far taller than an island that size should be.
  for (const g of landComps) {
    if (g.length > 70) continue;
    let peak = 0, at = g[0];
    for (const i of g) if (t.metres[i] > peak) { peak = t.metres[i]; at = i; }
    if (peak < 1900) continue;
    found.push({
      id: 'volcano', name: 'a volcanic island',
      hint: 'One island on its own, rising far more steeply than its size suggests.',
      cells: g.filter(i => t.metres[i] >= peak * 0.55),
    });
  }

  for (const g of biomeComp([B.desert], 70)) found.push({
    id: 'desert', name: 'a great desert',
    hint: 'Under the subtropical highs, a quarter of the way to the pole, or in the dry lee of a range.',
    cells: g,
  });
  for (const g of biomeComp([B.rainforest], 55)) found.push({
    id: 'rainforest', name: 'a rainforest',
    hint: 'On the equator, where the trade winds meet, or on any coast the wind hits first.',
    cells: g,
  });
  for (const g of biomeComp([B.alpine, B.snowline], 18)) found.push({
    id: 'range', name: 'a mountain range',
    hint: 'Bare rock and snow above the treeline. Once you are on high ground, stay on it.',
    cells: g,
  });
  // Both ends of the world at once, and every last square of it. Split into a
  // northern goal and a southern one, the day would regularly send a player to
  // the far pole while ice they could see from the drop counted for nothing;
  // and dropping the small outlying patches would do the same in miniature.
  const caps: number[] = [];
  for (let i = 0; i < W * H; i++) if (t.land[i] && t.biome[i] === B.icecap) caps.push(i);
  if (caps.length >= 30) found.push({
    id: 'icecap', name: 'the ice cap',
    hint: 'Straight for a pole, either one. The cold is not the problem; the distance is.',
    cells: caps,
  });
  for (const g of biomeComp([B.taiga], 90)) found.push({
    id: 'taiga', name: 'the boreal forest',
    hint: 'The cold forest belt, between the tundra and the temperate ground below it.',
    cells: g,
  });
  for (const g of biomeComp([B.savannah], 80)) found.push({
    id: 'savannah', name: 'a savannah',
    hint: 'Between the rainforest and the desert: hot ground with a wet season and a dry one.',
    cells: g,
  });
  return found;
}

// How far from the summit a drop may be, in moves. Since the drop is now the
// one thing that differs between players, it has to be the thing that differs
// least in difficulty: everybody starts a real journey from the high ground,
// and nobody starts on its doorstep or on the far side of the planet from it.
const DROP_NEAR = 9, DROP_FAR = 20;

/** Somewhere to be dropped: land, out of the ice, on a coast where possible,
 *  and a comparable journey from the summit however the dice fall. */
function pickSpawn(rnd: () => number, land: Uint8Array, biome: Uint8Array, summit: number): number {
  const coastal: number[] = [], inland: number[] = [], anywhere: number[] = [];
  for (let r = 2; r < H - 2; r++) {
    if (Math.abs(latOf(r)) > 62) continue;
    for (let c = 0; c < W; c++) {
      const i = idx(r, c);
      if (!land[i] || biome[i] === B.icecap || biome[i] === B.snowline) continue;
      anywhere.push(i);
      const away = movesBetween(i, summit);
      if (away < DROP_NEAR || away > DROP_FAR) continue;
      const shore = !land[idx(r - 1, c)] || !land[idx(r + 1, c)] ||
        !land[idx(r, wrapC(c - 1))] || !land[idx(r, wrapC(c + 1))];
      (shore ? coastal : inland).push(i);
    }
  }
  // A coast if the world has one at the right range, inland if not, and on a
  // world where nothing at all sits in the band, anywhere on it will do.
  const pool = coastal.length >= 20 ? coastal : inland.length ? inland : coastal.length ? coastal : anywhere;
  if (!pool.length) return summit;               // a world with no usable land
  return pool[Math.floor(rnd() * pool.length)];
}

// How much a feature is worth asking for. The ice cap is on every world and
// sits in the one place nobody has to search for, so it is the last resort;
// an archipelago or a lone volcano is the day worth playing.
const GOAL_WEIGHT: Record<string, number> = {
  archipelago: 6, volcano: 6, inlandsea: 5, range: 4,
  desert: 3, rainforest: 3, savannah: 2, taiga: 2, icecap: 1,
};

/** The summit as a landmark of last resort, for a world so bare that nothing
 *  else on it is worth naming. */
function summitGoal(t: Terrain): Landmark {
  const cells = new Set<number>();
  const sr = rowOf(t.summit), sc = colOf(t.summit);
  for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
    const r = sr + dr;
    if (r >= 0 && r < H) cells.add(idx(r, wrapC(sc + dc)));
  }
  return {
    id: 'summit', name: 'the roof of the world',
    hint: 'The highest ground anywhere. Follow the rising land and keep following it.',
    cells, centre: t.summit,
  };
}

/**
 * The day's landmarks, in the order they come on offer.
 *
 * They are chained nearest-ish first, each a fair walk on from the one before,
 * and every one a different kind of feature — kinds are drawn by weight, so an
 * archipelago comes up long before the ice cap does. Two of the chain are live
 * at any moment, which is what makes the order a decision: the near one now,
 * or the far one while there are still moves to spend on it.
 *
 * `rungs` is how far down the chain the move budget actually reaches, and it
 * is what a day is scored out of. The pool runs a little past it so there is
 * always a second option standing behind the first.
 */
function pickGoals(rnd: () => number, t: Terrain, spawn: number): { goals: Landmark[]; rungs: number } {
  // One instance per kind — the one nearest the drop — so a world with nine
  // desert patches does not become nine chances of drawing "a great desert".
  const byKind = new Map<string, Landmark>();
  for (const c of candidates(t)) {
    const here: Landmark = { ...c, cells: new Set(c.cells), centre: centreOf(c.cells) };
    const held = byKind.get(here.id);
    if (!held || movesTo(spawn, here.cells) < movesTo(spawn, held.cells)) byKind.set(here.id, here);
  }
  const left = [...byKind.values()];
  if (!left.length) return { goals: [summitGoal(t)], rungs: 1 };

  const ladder: Landmark[] = [];
  let from = spawn;
  let spent = 0;
  let rungs = 0;
  while (ladder.length < GOALS_MAX + LIVE && left.length) {
    const reach = (g: Landmark) => movesTo(from, g.cells);
    // What the budget reaches is what the day is scored out of: a chain nobody
    // could finish even by spending every move on it would be scored out of a
    // number no one can hit. Which also fixes what the top is worth — clearing
    // it means the whole budget went on landmarks and none of it on climbing.
    // A move of slack for each leg already walked. The chain is costed as if
    // the walk finishes standing on the near edge of every landmark, but
    // reaching one only means coming within TOUCH of it, and stopping a couple
    // of squares short can cost a move on the leg after.
    let affordable = left.filter(g => spent + reach(g) <= MOVES - ladder.length);
    if (affordable.length && ladder.length < GOALS_MAX) rungs = ladder.length + 1;
    // Past the budget, or past the number a day is scored out of, the chain
    // carries on nearest-first anyway: those entries are the ones standing
    // behind the pair on offer, so the choice never thins to a single option.
    if (!affordable.length) affordable = [left.reduce((a, b) => (movesTo(from, b.cells) < movesTo(from, a.cells) ? b : a))];
    // A rung far enough to be a walk, near enough to leave room for another.
    const fair = affordable.filter(g => reach(g) >= 4 && reach(g) <= 11);
    const pool = fair.length ? fair : [affordable.reduce((a, b) => (reach(b) < reach(a) ? b : a))];
    const weights = pool.map(g => GOAL_WEIGHT[g.id] ?? 2);
    let roll = rnd() * weights.reduce((a, b) => a + b, 0);
    let chosen = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) { roll -= weights[i]; if (roll < 0) { chosen = pool[i]; break; } }
    ladder.push(chosen);
    left.splice(left.indexOf(chosen), 1);
    spent += reach(chosen);
    // Carry on from the square the walk would actually arrive at — the near
    // edge of the landmark, not its middle. Budgeting from the middle of a
    // continent-sized desert quietly hands the next leg moves nobody has.
    from = [...chosen.cells].reduce((a, b) => (movesBetween(from, b) < movesBetween(from, a) ? b : a));
  }
  // A rung has to have a full pair standing behind it, or the last one on the
  // list would be offered on its own.
  return { goals: ladder, rungs: Math.max(1, Math.min(rungs, ladder.length - LIVE + 1)) };
}

/** What a rung is worth, and what the whole ladder is worth. Later rungs count
 *  for more, which is what makes pressing on tempting and losing one hurt. */
export const goalValue = (rung: number) => rung + 1;
export const ladderValue = (n: number) => (n * (n + 1)) / 2;   // 1 + 2 + … + n
