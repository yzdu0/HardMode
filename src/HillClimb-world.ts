/* HardMode — HillClimb.
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

const RIDGE_SWITCH_DAY = '2026-09-11';
const LEGACY_WORLD_REVISION = 'world-5';
const RIDGE_WORLD_REVISION = 'world-9';
const LEGACY_RUN_REVISION = 'world-5-challenges-1';
const RIDGE_RUN_REVISION = 'world-6-polar-frequency-1-challenges-1';
const HILLCLIMB_SEED = 'HillClimb'.toLowerCase();

/** Saved runs and player drops follow the terrain revision for their date. */
export function hillClimbRevision(day: string): string {
  return day < RIDGE_SWITCH_DAY ? LEGACY_RUN_REVISION : RIDGE_RUN_REVISION;
}

function worldRevision(day: string): string {
  return day < RIDGE_SWITCH_DAY ? LEGACY_WORLD_REVISION : RIDGE_WORLD_REVISION;
}

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

// How many are live at once. The choice is always between exactly two: the
// next one on the natural route, and the one past it — so taking the further
// one first is a real gamble rather than a menu.
export const LIVE = 2;

// What counts as an island for the purpose of an archipelago. The floor is
// what matters: without one, most of the islands in a day's archipelago were
// single squares, too small to stand on meaningfully or to carry a biome.
const ISLE_MIN = 4;
const ISLE_MAX = 90;
const ISLE_APART = 34;

// Where ground stops counting as warm and starts counting as cold, in annual
// mean °C. It is the line the two rainfall scales are split at.
const COLD = 6;

/* The domain warp on the height field: how far a square may be dragged before
   it is read, how much of that the calmest ground still gets, and how tightly
   the drag itself varies. The last matters most. A drag that changes more
   slowly than the terrain only slides continents about; it is the drag varying
   faster than what it moves that folds a coast back on itself. */
const WARP_PUSH = 20;
const WARP_FLOOR = 0;
const WARP_SCALE = 8;
const TERRAIN_FREQUENCY = 1.5;

// A small correction for the independent-ridge worlds. The noise sampler has
// less room to vary beside its clamped north and south edges, which otherwise
// leaves the polar rows a little more land-heavy than the rest of the planet.
const POLAR_BIAS_FROM = 50;
const POLAR_LAND_BIAS = 0.1;

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
  { id: 'seaice',     name: 'sea ice',           water: true, colour: '#d3e4ef', dark: '#3d5566' },
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

/** Standing on a landmark, or within TOUCH squares of it. See TOUCH: the
 *  tolerance is what makes every square on the board landable-beside. */
export function touching(cells: Set<number>, stop: number): boolean {
  const r = rowOf(stop), c = colOf(stop);
  for (let dr = -TOUCH; dr <= TOUCH; dr++) {
    const rr = r + dr;
    if (rr < 0 || rr >= H) continue;
    for (let dc = -TOUCH; dc <= TOUCH; dc++) if (cells.has(idx(rr, wrapC(c + dc)))) return true;
  }
  return false;
}

/** One move of the stride, eight ways, clamped at the poles and wrapped east
 *  to west. The same rule the page moves the player by. */
export const stepTo = (from: number, dr: number, dc: number) =>
  idx(Math.max(0, Math.min(H - 1, rowOf(from) + dr * STRIDE)), wrapC(colOf(from) + dc * STRIDE));

/**
 * Walk at a landmark and see what it costs and where it leaves you.
 *
 * Not the distance to its nearest square, which is what it used to be costed
 * at: a landmark holds every instance of its kind, so a walk aimed at the
 * nearest one often touches a different one on the way and stops somewhere the
 * straight-line figure never predicted. Costing the chain by actually walking
 * it is the only way the budget and the board agree.
 */
export function march(from: number, cells: Set<number>): { cost: number; at: number; path: number[] } {
  let target = from, best = Infinity;
  for (const cell of cells) {
    const d = movesBetween(from, cell);
    if (d < best) { best = d; target = cell; }
  }
  let at = from, cost = 0;
  const path = [from];
  while (!touching(cells, at) && cost <= MOVES * 2) {
    let dc = colOf(target) - colOf(at);
    if (dc > W / 2) dc -= W;
    if (dc < -W / 2) dc += W;
    const dr = rowOf(target) - rowOf(at);
    // Each axis marches until it is inside the touch radius and then stops. A
    // diagonal held all the way in steps over its own target for ever, because
    // a move is a whole stride on both axes at once.
    const next = stepTo(at, Math.abs(dr) <= TOUCH ? 0 : Math.sign(dr), Math.abs(dc) <= TOUCH ? 0 : Math.sign(dc));
    if (next === at) break;
    at = next;
    path.push(at);
    cost++;
  }
  return { cost, at, path };
}

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

interface Lattice { v: Float32Array; lx: number; ly: number; oy: number }

/**
 * One layer's lattice, with a random vertical phase and a spare row to slide
 * into. Without the phase every layer puts a lattice row exactly on the north
 * pole, the equator and the south pole of every planet: a row sitting on a
 * lattice row is read straight out of it while a row between two is an average
 * of them, an average is narrower than what it averages, and a sea level set
 * by percentile turns that into a standing surplus of land at those three
 * latitudes. Sliding each layer independently makes them cancel.
 */
function lattice(rnd: () => number, lx: number): Lattice {
  const ly = Math.max(3, Math.round((lx * H) / W) + 2);
  const v = new Float32Array(lx * ly);
  for (let i = 0; i < v.length; i++) v[i] = rnd();
  return { v, lx, ly, oy: rnd() };
}

function sample(l: Lattice, r: number, c: number): number {
  const fx = (c / W) * l.lx;
  const fy = (r / (H - 1)) * (l.ly - 2) + l.oy;
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

/** A stack of lattices, coarse to fine: the thing a layered-noise value is
 *  read out of. Kept apart from reading it so that the point being read can be
 *  moved, which is what the warp below does. */
export interface Noise { layers: Lattice[]; norm: number }

export function noiseOf(rnd: () => number, base: number, octaves: number): Noise {
  const layers: Lattice[] = [];
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const frequency = Math.max(1, Math.round(base * Math.pow(2, o)));
    layers.push(lattice(rnd, frequency));
    norm += Math.pow(0.5, o);
  }
  return { layers, norm };
}

/** Read layered noise at a point. Fractional and out-of-range coordinates are
 *  fine: east and west wrap, and the poles clamp. `ridged` folds each octave
 *  about its middle, which turns round blobs into creases that read as ranges.
 *  `depth` reads only the coarsest octaves, for the fields that steer rather
 *  than decorate. */
export function noiseAt(n: Noise, r: number, c: number, ridged = false, depth = 0): number {
  const octaves = depth > 0 ? Math.min(depth, n.layers.length) : n.layers.length;
  let sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const a = Math.pow(0.5, o);
    const v = sample(n.layers[o], r, c);
    sum += a * (ridged ? 1 - Math.abs(2 * v - 1) : v);
    norm += a;
  }
  return sum / norm;
}

/** Layered noise over the whole map, read straight. */
function field(rnd: () => number, base: number, octaves: number, ridged: boolean): Float32Array {
  const n = noiseOf(rnd, base, octaves);
  const out = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) out[idx(r, c)] = noiseAt(n, r, c, ridged);
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

/** Average a field over the land within a short reach, wrapping east to west.
 *  Rain arrives as a per-square figure off a per-square slope, and a crinkled
 *  coastline makes that flicker; a climate is a region, so it is smoothed to
 *  one before anything is decided from it. */
function spreadOverLand(values: Float32Array, land: Uint8Array, reach: number): Float32Array {
  const out = new Float32Array(values.length);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = idx(r, c);
    if (!land[i]) continue;
    let sum = 0, n = 0;
    for (let dr = -reach; dr <= reach; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= H) continue;
      for (let dc = -reach; dc <= reach; dc++) {
        const j = idx(rr, wrapC(c + dc));
        if (land[j]) { sum += values[j]; n++; }
      }
    }
    out[i] = sum / n;
  }
  return out;
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
const baseTemp = (lat: number) => 33 - 54 * Math.pow(Math.abs(lat) / 90, 1.8);

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

export interface TerrainClimate {
  metres: Int16Array;
  depth: Float32Array;
  land: Uint8Array;
  tempC: Float32Array;
  rain: Float32Array;
  biome: Uint8Array;
}

/** Run HillClimb's climate and biome assignment over an already-made terrain. */
function climateForTerrain(
  rnd: () => number,
  metres: Int16Array,
  depth: Float32Array,
  land: Uint8Array,
): Pick<TerrainClimate, 'tempC' | 'rain' | 'biome'> {
  const warmth = currents(land);
  const tempC = new Float32Array(W * H);
  const wobble = field(rnd, 3, 2, false);
  const bend = field(rnd, 2, 3, false);
  const bentLat = (r: number, i: number) => latOf(r) + (bend[i] - 0.5) * 19;
  const upland = spreadOverLand(Float32Array.from(metres), land, 4);
  for (let r = 0; r < H; r++) {
    const dir = windDir(latOf(r));
    for (let c = 0; c < W; c++) {
      const i = idx(r, c);
      let t = baseTemp(bentLat(r, i)) + (wobble[i] - 0.5) * 8;
      if (!land[i]) {
        t += warmth[i];
      } else {
        for (let d = 1; d <= 7; d++) {
          const j = idx(r, wrapC(c - dir * d));
          if (!land[j]) { t += warmth[j] * (1 - d / 8) * 0.8; break; }
        }
        t -= (upland[i] / 1000) * 6.3;
      }
      tempC[i] = t;
    }
  }

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
      if (step >= W) humid[i] = m * zonalRain(bentLat(r, i));
    }
  }

  const damp = spreadOverLand(humid, land, 3);
  const chilly = new Uint8Array(W * H);
  const temperate = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!land[i]) continue;
    if (tempC[i] <= COLD) chilly[i] = 1; else temperate[i] = 1;
  }
  const rainCold = rankOverLand(damp, chilly);
  const rain = rankOverLand(damp, temperate);

  const biome = new Uint8Array(W * H);
  for (let i = 0; i < biome.length; i++) {
    const t = tempC[i];
    if (!land[i]) {
      biome[i] = t <= -12 ? B.seaice : depth[i] < 0.12 ? B.shallow : B.ocean;
      continue;
    }
    const m = rain[i], h = metres[i];
    if (t <= -11 && h >= 1400) biome[i] = B.snowline;
    else if (t <= 0.5 && h >= 900) biome[i] = B.alpine;
    else if (t <= -12) biome[i] = B.icecap;
    else if (t <= -2) biome[i] = B.tundra;
    else if (t <= COLD) biome[i] = rainCold[i] >= 0.42 ? B.taiga : B.tundra;
    else if (t <= 19) biome[i] = m >= 0.62 ? B.forest : m >= 0.42 ? B.grassland : m >= 0.24 ? B.shrubland : B.desert;
    else biome[i] = m >= 0.70 ? B.rainforest : m >= 0.52 ? B.monsoon : m >= 0.30 ? B.savannah : B.desert;
  }
  return { tempC, rain, biome };
}

/**
 * Offline/test seam for supplying a signed elevation map instead of noise.
 * Positive cells are land in metres; zero and negative cells are water.
 */
export function climateFromHeightMap(day: string, elevation: ArrayLike<number>): TerrainClimate {
  if (elevation.length !== W * H) throw new RangeError(`height map must contain ${W * H} cells`);
  const metres = new Int16Array(W * H);
  const depth = new Float32Array(W * H);
  const land = new Uint8Array(W * H);
  let deepest = 1;
  for (let i = 0; i < elevation.length; i++) deepest = Math.max(deepest, -elevation[i]);
  for (let i = 0; i < elevation.length; i++) {
    const h = elevation[i];
    if (!Number.isFinite(h)) throw new TypeError(`height map cell ${i} is not finite`);
    if (h > 0) {
      land[i] = 1;
      metres[i] = Math.min(32767, Math.round(h));
    } else {
      depth[i] = clamp01(-h / deepest);
    }
  }
  const climate = climateForTerrain(random(`${HILLCLIMB_SEED}-height-map-${worldRevision(day)}-${day}`), metres, depth, land);
  return { metres, depth, land, ...climate };
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
  rungs: number;             // number of optional challenges in today's ladder
}

export interface Landmark {
  id: string;
  name: string;
  hint: string;      // explains what counts without revealing where to go
  cells: Set<number>;
  centre: number;
  regions?: Set<number>[]; // distinct places that can count towards the challenge
  required?: number;       // how many distinct regions must be visited
}

export interface LandmarkProgress {
  visited: number;
  required: number;
  complete: boolean;
}

/** Progress is counted by distinct regions, not by the number of squares
 * crossed inside one region. Older and test landmarks without `regions` keep
 * the original single-destination behaviour. */
export function landmarkProgress(goal: Landmark, path: number[]): LandmarkProgress {
  const regions = goal.regions?.length ? goal.regions : [goal.cells];
  const required = Math.min(goal.required ?? 1, regions.length);
  let visited = 0;
  for (const region of regions) {
    if (path.some(stop => touching(region, stop))) visited++;
  }
  return { visited, required, complete: visited >= required };
}

/** A deterministic greedy walk through enough distinct regions to complete a
 * challenge. This is used to order the daily challenge list and by tests, not
 * to promise that the player can clear it inside the move budget. */
export function marchLandmark(from: number, goal: Landmark, history: number[] = [from]) {
  const regions = goal.regions?.length ? goal.regions : [goal.cells];
  const required = Math.min(goal.required ?? 1, regions.length);
  const path = history.length ? [...history] : [from];
  let at = from, cost = 0;
  const reached = () => regions.map(region => path.some(stop => touching(region, stop)));
  while (reached().filter(Boolean).length < required) {
    const done = reached();
    const options = regions
      .map((region, i) => ({ region, i, trip: march(at, region) }))
      .filter(option => !done[option.i]);
    if (!options.length) break;
    const chosen = options.reduce((a, b) => b.trip.cost < a.trip.cost ? b : a);
    path.push(...chosen.trip.path.slice(1));
    at = chosen.trip.at;
    cost += chosen.trip.cost;
  }
  return { cost, at, path };
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
  const independentRidges = day >= RIDGE_SWITCH_DAY;
  const terrainRevision = worldRevision(day);
  const runRevision = hillClimbRevision(day);
  const rnd = random(HILLCLIMB_SEED + '-' + terrainRevision + '-' + day);
  const dice = random(HILLCLIMB_SEED + '-drop-' + runRevision + '-' + day + '-' + drop);

  // ---- height ----
  // One broad field decides where the continents are. From 11 September 2026,
  // a separate ridged field places ranges without favouring the already-high
  // parts of a continent. Only the narrow shoreline fades the ridges out,
  // avoiding a wall at the exact edge of the water while still allowing
  // coastal ranges. Earlier maps retain their original crease-weighted relief.
  //
  // Both are read at a moved point rather than where they sit. That is the
  // warp: two more fields say how far to drag each square before reading it,
  // and because the drag varies faster than the terrain it is dragging, the
  // field folds over itself. Coasts come out marbled rather than rounded,
  // headlands trail off into island chains, and inlets cut back on themselves.
  // A third, very broad field scales how hard the drag pulls, so one part of a
  // planet shatters into archipelago while another keeps a clean continental
  // shore. Both layers are dragged by the same amount, or the ranges would
  // stop following the coasts they belong to.
  const frequency = independentRidges ? TERRAIN_FREQUENCY : 1;
  const shape = noiseOf(rnd, 3 * frequency, 7);
  const crease = noiseOf(rnd, 4 * frequency, 6);
  const drift = random(HILLCLIMB_SEED + '-warp-' + terrainRevision + '-' + day);
  const pushX = noiseOf(drift, WARP_SCALE * frequency, 3);
  const pushY = noiseOf(drift, WARP_SCALE * frequency, 3);
  const pushHard = noiseOf(drift, 2 * frequency, 2);

  const base = new Float32Array(W * H);
  const ridge = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = idx(r, c);
    const reach = WARP_PUSH * (WARP_FLOOR + (1 - WARP_FLOOR) * noiseAt(pushHard, r, c));
    const dc = (noiseAt(pushX, r, c) - 0.5) * 2 * reach;
    const dr = (noiseAt(pushY, r, c) - 0.5) * 2 * reach;
    // The drag slides along a pole rather than through it. Left unclamped, a
    // square dragged past the top reads a blend of the first two lattice rows
    // at a weight that means nothing, and the correction above then widens a
    // spread that was never narrowed: land piles up at both ends of the map.
    const read = Math.max(0, Math.min(H - 1, r + dr));
    const poleward = clamp01((Math.abs(latOf(r)) - POLAR_BIAS_FROM) / (90 - POLAR_BIAS_FROM));
    const polarBias = independentRidges ? POLAR_LAND_BIAS * poleward * poleward : 0;
    base[i] = noiseAt(shape, read, c + dc) - polarBias;
    ridge[i] = noiseAt(crease, read, c + dc, true);
  }
  const sea = quantile(base, 0.67);   // one square of land in every three

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
    const relief = independentRidges
      ? clamp01(0.55 * above + 0.72 * clamp01(above / 0.12) * Math.pow(ridge[i], 2.1))
      : clamp01(above * (0.42 + 1.5 * ridge[i]));
    metres[i] = Math.round(7700 * Math.pow(relief, 1.55));
  }

  // ---- temperature, rain and biomes ----
  const { tempC, rain, biome } = climateForTerrain(rnd, metres, depth, land);

  // ---- the two things worth walking to ----
  let summit = -1, summitM = -1;
  for (let i = 0; i < metres.length; i++) if (land[i] && metres[i] > summitM) { summitM = metres[i]; summit = i; }

  const terrain: Terrain = { land, biome, metres, depth, summit, summitM };
  // The landmarks do not depend on where anybody lands, so they are worked out
  // once and the drop is chosen with them in view.
  const marks = candidates(terrain);
  const spawn = pickSpawn(dice, land, biome, summit, marks);
  const { goals, rungs } = pickGoals(dice, marks, spawn, summit);

  return { day, metres, depth, tempC, rain, biome, land, summit, summitM, spawn, goals, rungs };
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

type Candidate = {
  id: string;
  name: string;
  hint: string;
  cells: number[];
  regions: number[][];
  required: number;
};

/**
 * The landmarks this planet has to offer, one entry per kind.
 *
 * Most entries are multi-place challenges. Their regions stay separate so
 * revisiting one patch does not count as exploring two, while `cells` keeps a
 * union for map outlines and broad distance checks.
 */
function candidates(t: Terrain): Candidate[] {
  const found: Candidate[] = [];
  const landComps = components(i => t.land[i] === 1);
  const seaComps = components(i => t.land[i] === 0);

  const patches = (ids: number[], min: number) =>
    components(i => t.land[i] === 1 && ids.includes(t.biome[i])).filter(group => group.length >= min);
  const add = (id: string, name: string, hint: string, regions: number[][], required = 1) => {
    if (regions.length >= required) found.push({ id, name, hint, regions, required, cells: regions.flat() });
  };

  const continents = landComps.filter(group => group.length >= 120);
  add('continents', 'visit 3 continents',
    'Three separate large landmasses count. Small islands do not.', continents, 3);

  // An archipelago challenge keeps its islands separate, so landing on three
  // of them is meaningfully different from reaching the nearest cluster.
  const isles = landComps.filter(g => g.length <= ISLE_MAX);
  const used = new Set<number>();
  const archipelago: number[][] = [];
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
      archipelago.push(...group.map(g => isles[g]));
    }
  }
  add('archipelago', 'land on 3 islands',
    'Three separate islands in an archipelago count. Returning to one island does not.', archipelago, 3);

  // Inland seas: any water with no way out to the ocean.
  const openSea = seaComps.reduce((a, b) => (b.length > a.length ? b : a), [] as number[]);
  add('inlandsea', 'find an inland sea',
    'Reach a body of water that is fully enclosed by land.',
    seaComps.filter(g => g !== openSea && g.length >= 12));

  // Volcanic islands: small, and far taller than an island that size should be.
  const volcanic: number[][] = [];
  for (const g of landComps) {
    if (g.length > 70) continue;
    let peak = 0;
    for (const i of g) if (t.metres[i] > peak) peak = t.metres[i];
    if (peak < 1900) continue;
    volcanic.push(g.filter(i => t.metres[i] >= peak * 0.55));
  }
  add('volcano', 'climb a volcanic island',
    'Reach the high ground of a small, steep island.', volcanic);

  // Peninsula tips have nearby water in at least three cardinal directions,
  // but must belong to a substantial landmass rather than an ordinary island.
  const mainland = new Uint8Array(W * H);
  for (const group of continents) for (const i of group) mainland[i] = 1;
  const peninsulaCells = new Set<number>();
  const waterWithin = (r: number, c: number, dr: number, dc: number) => {
    for (let d = 2; d <= 7; d++) {
      const rr = r + dr * d;
      if (rr < 0 || rr >= H) return false;
      if (!t.land[idx(rr, wrapC(c + dc * d))]) return true;
    }
    return false;
  };
  for (let r = 1; r < H - 1; r++) for (let c = 0; c < W; c++) {
    const i = idx(r, c);
    if (!mainland[i]) continue;
    const wetSides = [[-1, 0], [1, 0], [0, -1], [0, 1]]
      .filter(([dr, dc]) => waterWithin(r, c, dr, dc)).length;
    if (wetSides >= 3) peninsulaCells.add(i);
  }
  add('peninsula', 'reach a peninsula',
    'Reach a narrow piece of a continent with sea on three sides.',
    components(i => peninsulaCells.has(i)).filter(group => group.length >= 2));

  add('jungles', 'visit 2 jungles',
    'Two separate rainforest regions count. Crossing the same jungle twice does not.',
    patches([B.rainforest], 18), 2);
  add('deserts', 'visit 2 deserts',
    'Two separate desert regions count. Each must be large enough to be more than a dry patch.',
    patches([B.desert], 24), 2);
  add('ranges', 'cross 2 mountain ranges',
    'Two separate regions of alpine rock or snow count.',
    patches([B.alpine, B.snowline], 20), 2);
  add('icecaps', 'reach both ice caps',
    'The northern and southern land ice count separately.',
    patches([B.icecap], 24), 2);
  add('taigas', 'visit 2 boreal forests',
    'Two separate regions of cold forest count.',
    patches([B.taiga], 24), 2);
  add('savannahs', 'visit 2 savannahs',
    'Two separate regions of savannah count.',
    patches([B.savannah], 24), 2);
  return found;
}

// The shortest a leg of the chain may be. A landmark you are already standing
// in is not a landmark to go and find, and now that a kind covers every one of
// its instances the nearest is often underfoot.
const MIN_LEG = 3;

// How far from the summit a drop may be, in moves. Since the drop is now the
// one thing that differs between players, it has to be the thing that differs
// least in difficulty: everybody starts a real journey from the high ground,
// and nobody starts on its doorstep or on the far side of the planet from it.
const DROP_NEAR = 9, DROP_FAR = 20;

/** Moves from every square to the nearest square of `cells`. One pass, so the
 *  drop can ask about all of a planet's landmarks without walking each one. */
function spreadFrom(cells: Iterable<number>): Uint8Array {
  const away = new Uint8Array(W * H).fill(255);
  let edge: number[] = [];
  for (const i of cells) if (away[i] === 255) { away[i] = 0; edge.push(i); }
  for (let d = 1; edge.length; d++) {
    const next: number[] = [];
    for (const i of edge) {
      const r = rowOf(i), c = colOf(i);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        if (rr < 0 || rr >= H) continue;
        const j = idx(rr, wrapC(c + dc));
        if (away[j] === 255) { away[j] = Math.min(254, d); next.push(j); }
      }
    }
    edge = next;
  }
  return away;
}

/** Somewhere to be dropped: land, out of the ice, on a coast where possible, a
 *  comparable journey from the summit however the dice fall, and with real
 *  ground between it and the landmarks. A drop standing in two of the day's
 *  three landmarks has nothing left to go and find. */
function pickSpawn(
  rnd: () => number, land: Uint8Array, biome: Uint8Array, summit: number, marks: Candidate[],
): number {
  const reach = marks.map(m => spreadFrom(m.cells));
  const worthLeaving = (i: number) =>
    reach.filter(away => Math.ceil(away[i] / STRIDE) >= MIN_LEG).length >= Math.min(2, marks.length);
  const coastal: number[] = [], inland: number[] = [], anywhere: number[] = [];
  for (let r = 2; r < H - 2; r++) {
    if (Math.abs(latOf(r)) > 62) continue;
    for (let c = 0; c < W; c++) {
      const i = idx(r, c);
      if (!land[i] || biome[i] === B.icecap || biome[i] === B.snowline) continue;
      anywhere.push(i);
      const away = movesBetween(i, summit);
      if (away < DROP_NEAR || away > DROP_FAR || !worthLeaving(i)) continue;
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

// Rare geographic features are favoured when they exist. Common biome
// challenges still fill out the daily choice, but no longer amount to touching
// the nearest square of a biome that covers half a latitude band.
const GOAL_WEIGHT: Record<string, number> = {
  continents: 8, peninsula: 8, archipelago: 7, volcano: 7, inlandsea: 6,
  jungles: 4, deserts: 4, ranges: 4, icecaps: 3, savannahs: 3, taigas: 3,
};
const MAX_CHALLENGES = 7;

/** The summit as a landmark of last resort, for a world so bare that nothing
 *  else on it is worth naming. */
function summitGoal(summit: number): Landmark {
  const cells = new Set<number>();
  const sr = rowOf(summit), sc = colOf(summit);
  for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
    const r = sr + dr;
    if (r >= 0 && r < H) cells.add(idx(r, wrapC(sc + dc)));
  }
  return {
    id: 'summit', name: 'the roof of the world',
    hint: 'The highest ground anywhere. Follow the rising land and keep following it.',
    cells, centre: summit,
  };
}

/**
 * The day's landmarks, in the order they come on offer.
 *
 * They are chained roughly nearest first, but are not guaranteed to fit into
 * 28 moves. These are difficult optional bonuses, and a full sweep is meant to
 * be exceptional. Two are live at a time, so the player still chooses which
 * challenge is worth pursuing without receiving a list of map locations.
 */
function pickGoals(
  rnd: () => number, marks: Candidate[], spawn: number, summit: number,
): { goals: Landmark[]; rungs: number } {
  const left: Landmark[] = marks.map(c => ({
    ...c,
    cells: new Set(c.cells),
    regions: c.regions.map(region => new Set(region)),
    centre: centreOf(c.cells),
  }));
  if (!left.length) return { goals: [summitGoal(summit)], rungs: 1 };

  const ladder: Landmark[] = [];
  let from = spawn;
  let history = [spawn];
  while (left.length && ladder.length < MAX_CHALLENGES) {
    const trip = new Map<Landmark, ReturnType<typeof marchLandmark>>(
      left.map(g => [g, marchLandmark(from, g, history)]),
    );
    const reach = (g: Landmark) => trip.get(g).cost;
    const worth = left.filter(g => reach(g) >= MIN_LEG);
    const usable = worth.length ? worth : left;
    const fair = usable.filter(g => reach(g) >= 4 && reach(g) <= 18);
    const pool = fair.length ? fair : [usable.reduce((a, b) => (reach(b) < reach(a) ? b : a))];
    const weights = pool.map(g => GOAL_WEIGHT[g.id] ?? 2);
    let roll = rnd() * weights.reduce((a, b) => a + b, 0);
    let chosen = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) { roll -= weights[i]; if (roll < 0) { chosen = pool[i]; break; } }
    ladder.push(chosen);
    left.splice(left.indexOf(chosen), 1);
    const walked = trip.get(chosen);
    from = walked.at;
    history = walked.path;
  }
  return { goals: ladder, rungs: ladder.length };
}

/** What a rung is worth, and what the whole ladder is worth. Later rungs count
 *  for more, which is what makes pressing on tempting and losing one hurt. */
export const goalValue = (rung: number) => rung + 1;
export const ladderValue = (n: number) => (n * (n + 1)) / 2;   // 1 + 2 + … + n
