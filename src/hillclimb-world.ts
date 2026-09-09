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

export const HILLCLIMB_REVISION = 'world-4';

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

// Where ground stops counting as warm and starts counting as cold, in annual
// mean °C. It is the line the two rainfall scales are split at.
const COLD = 6;

/* The domain warp on the height field: how far a square may be dragged before
   it is read, how much of that the calmest ground still gets, and how tightly
   the drag itself varies. The last matters most. A drag that changes more
   slowly than the terrain only slides continents about; it is the drag varying
   faster than what it moves that folds a coast back on itself. */
const WARP_PUSH = 40;
const WARP_FLOOR = 0.25;
const WARP_SCALE = 8;

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
export function march(from: number, cells: Set<number>): { cost: number; at: number } {
  let target = from, best = Infinity;
  for (const cell of cells) {
    const d = movesBetween(from, cell);
    if (d < best) { best = d; target = cell; }
  }
  let at = from, cost = 0;
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
    cost++;
  }
  return { cost, at };
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
  for (let o = 0; o < octaves; o++) { layers.push(lattice(rnd, base << o)); norm += Math.pow(0.5, o); }
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
  const shape = noiseOf(rnd, 3, 7);
  const crease = noiseOf(rnd, 4, 6);
  const drift = random('hillclimb-warp-' + HILLCLIMB_REVISION + '-' + day);
  const pushX = noiseOf(drift, WARP_SCALE, 3);
  const pushY = noiseOf(drift, WARP_SCALE, 3);
  const pushHard = noiseOf(drift, 2, 2);

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
    base[i] = noiseAt(shape, read, c + dc);
    ridge[i] = noiseAt(crease, read, c + dc, true);
  }
  const sea = quantile(base, 0.60);   // four squares of land in every ten

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
  const wobble = field(rnd, 3, 2, false);
  // Climate does not run in straight lines. One broad, slow field bends the
  // latitude every band is measured against, by up to seven degrees either
  // way — so the tree line, the rainforest belt and the deserts all wander
  // together, the way they do on a real map, instead of every biome changing
  // along the same ruled row.
  const bend = field(rnd, 2, 3, false);
  const bentLat = (r: number, i: number) => latOf(r) + (bend[i] - 0.5) * 19;
  // Weather answers to the height of a region, not of a square. Taking the
  // lapse rate off the raw map made every crinkle in a warped coastline its
  // own climate, and the biomes came out as mosaic rather than as belts.
  const upland = spreadOverLand(Float32Array.from(metres), land, 4);
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
        t -= (upland[i] / 1000) * 6.3;                 // lapse rate
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
  /* Ranked within temperature class, not against all land at once.
   *
   * Cold air carries little water, so cold ground is dry ground: rank the
   * whole world together and the polar half of the land fills the bottom of
   * the scale, leaving the warm half too wet to be desert however parched it
   * is. Deserts came out at a third the share of the ice, which is the wrong
   * way round for a planet. Ranked apart, "dry" means dry for somewhere that
   * temperature, which is what the words are supposed to mean. */
  const damp = spreadOverLand(humid, land, 3);
  const chilly = new Uint8Array(W * H);
  const temperate = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!land[i]) continue;
    if (tempC[i] <= COLD) chilly[i] = 1; else temperate[i] = 1;
  }
  const rainCold = rankOverLand(damp, chilly);
  const rain = rankOverLand(damp, temperate);

  // ---- biomes ----
  const biome = new Uint8Array(W * H);
  for (let i = 0; i < biome.length; i++) {
    const t = tempC[i];
    if (!land[i]) {
      // Water this cold, averaged over a year, is water with a lid on it.
      biome[i] = t <= -12 ? B.seaice : depth[i] < 0.12 ? B.shallow : B.ocean;
      continue;
    }
    const m = rain[i], h = metres[i];
    // Above the treeline is a matter of height and cold together, which is why
    // bare rock starts near sea level in the far north and needs four thousand
    // metres on the equator.
    // Permanent snow is a summit, not a latitude: it wants real height as well
    // as real cold, or half of every polar continent comes out white.
    if (t <= -12 && h >= 1600) biome[i] = B.snowline;
    else if (t <= 0.5 && h >= 900) biome[i] = B.alpine;
    else if (t <= -13) biome[i] = B.icecap;
    else if (t <= -2) biome[i] = B.tundra;
    else if (t <= COLD) biome[i] = rainCold[i] >= 0.42 ? B.taiga : B.tundra;
    else if (t <= 19) biome[i] = m >= 0.62 ? B.forest : m >= 0.42 ? B.grassland : m >= 0.24 ? B.shrubland : B.desert;
    else biome[i] = m >= 0.70 ? B.rainforest : m >= 0.52 ? B.monsoon : m >= 0.30 ? B.savannah : B.desert;
  }

  // ---- the two things worth walking to ----
  let summit = -1, summitM = -1;
  for (let i = 0; i < metres.length; i++) if (land[i] && metres[i] > summitM) { summitM = metres[i]; summit = i; }

  const counts = new Map<number, number>();
  for (let i = 0; i < biome.length; i++) if (land[i]) counts.set(biome[i], (counts.get(biome[i]) || 0) + 1);
  const checklist = [...counts.entries()].filter(([, n]) => n >= 10).map(([b]) => b).sort((a, b) => a - b);

  const terrain: Terrain = { land, biome, metres, depth, summit, summitM };
  // The landmarks do not depend on where anybody lands, so they are worked out
  // once and the drop is chosen with them in view.
  const marks = candidates(terrain);
  const spawn = pickSpawn(dice, land, biome, summit, marks);
  const { goals, rungs } = pickGoals(dice, marks, spawn, summit);

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

/**
 * The landmarks this planet has to offer, one entry per kind.
 *
 * Every entry holds *every* instance of its kind on the world, not the nearest
 * or the largest one. A player standing in boreal forest has reached the boreal
 * forest, and it should not matter which patch of it they are standing in; the
 * same goes for a desert, an archipelago or an inland sea. Distances are then
 * measured to the nearest square of the union, so the goal is always the
 * closest instance without the player having to be told which one.
 */
function candidates(t: Terrain): Candidate[] {
  const found: Candidate[] = [];
  const landComps = components(i => t.land[i] === 1);
  const seaComps = components(i => t.land[i] === 0);

  /** Every square of these biomes, if the planet has enough of them between
   *  them to be worth naming. A scatter of three squares is not a desert. */
  const belt = (ids: number[], min: number): number[] | null => {
    const cells: number[] = [];
    for (let i = 0; i < W * H; i++) if (t.land[i] && ids.includes(t.biome[i])) cells.push(i);
    return cells.length >= min ? cells : null;
  };
  const add = (id: string, name: string, hint: string, cells: number[] | null) => {
    if (cells && cells.length) found.push({ id, name, hint, cells });
  };

  // Archipelagos: every cluster of three or more small islands sitting close
  // together, all of them counting as the same find.
  const isles = landComps.filter(g => g.length <= 18);
  const used = new Set<number>();
  const archipelago: number[] = [];
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
      archipelago.push(...group.flatMap(g => isles[g]));
    }
  }
  add('archipelago', 'an archipelago',
    'Three or more small islands within sight of each other. Look offshore, never inland.', archipelago);

  // Inland seas: any water with no way out to the ocean.
  const openSea = seaComps.reduce((a, b) => (b.length > a.length ? b : a), [] as number[]);
  add('inlandsea', 'an inland sea',
    'Water with no way out to the ocean. It will be ringed by land on every side.',
    seaComps.filter(g => g !== openSea && g.length >= 12).flat());

  // Volcanic islands: small, and far taller than an island that size should be.
  const volcanic: number[] = [];
  for (const g of landComps) {
    if (g.length > 70) continue;
    let peak = 0;
    for (const i of g) if (t.metres[i] > peak) peak = t.metres[i];
    if (peak < 1900) continue;
    volcanic.push(...g.filter(i => t.metres[i] >= peak * 0.55));
  }
  add('volcano', 'a volcanic island',
    'One island on its own, rising far more steeply than its size suggests.', volcanic);

  add('desert', 'a desert',
    'Under the subtropical highs, a quarter of the way to the pole, or in the dry lee of a range.',
    belt([B.desert], 120));
  add('rainforest', 'a rainforest',
    'On the equator, where the trade winds meet, or on any coast the wind hits first.',
    belt([B.rainforest], 90));
  add('range', 'a mountain range',
    'Bare rock and snow above the treeline. Once you are on high ground, stay on it.',
    belt([B.alpine, B.snowline], 40));
  add('icecap', 'the ice cap',
    'Straight for a pole, either one. The cold is not the problem; the distance is.',
    belt([B.icecap], 60));
  add('taiga', 'boreal forest',
    'The cold forest belt, between the tundra and the temperate ground below it.',
    belt([B.taiga], 140));
  add('savannah', 'a savannah',
    'Between the rainforest and the desert: hot ground with a wet season and a dry one.',
    belt([B.savannah], 120));
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

// How much a feature is worth asking for. The ice cap is on every world and
// sits in the one place nobody has to search for, so it is the last resort;
// an archipelago or a lone volcano is the day worth playing.
const GOAL_WEIGHT: Record<string, number> = {
  archipelago: 6, volcano: 6, inlandsea: 5, range: 4,
  desert: 3, rainforest: 3, savannah: 2, taiga: 2, icecap: 1,
};

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
function pickGoals(
  rnd: () => number, marks: Candidate[], spawn: number, summit: number,
): { goals: Landmark[]; rungs: number } {
  // candidates() already returns one entry per kind, holding every instance of
  // it on the planet, so there is nothing to choose between here.
  const left: Landmark[] = marks.map(c => ({ ...c, cells: new Set(c.cells), centre: centreOf(c.cells) }));
  if (!left.length) return { goals: [summitGoal(summit)], rungs: 1 };

  const ladder: Landmark[] = [];
  let from = spawn;
  let spent = 0;
  let rungs = 0;
  while (ladder.length < GOALS_MAX + LIVE && left.length) {
    // Costed by walking at each of them from where the last leg actually
    // finished, so the budget is a route somebody could really take.
    const trip = new Map<Landmark, { cost: number; at: number }>(left.map(g => [g, march(from, g.cells)]));
    const reach = (g: Landmark) => trip.get(g).cost;
    // What the budget reaches is what the day is scored out of: a chain nobody
    // could finish even by spending every move on it would be scored out of a
    // number no one can hit. Which also fixes what the top is worth — clearing
    // it means the whole budget went on landmarks and none of it on climbing.
    let affordable = left.filter(g => spent + reach(g) <= MOVES);
    if (affordable.length && ladder.length < GOALS_MAX) rungs = ladder.length + 1;
    // Past the budget, or past the number a day is scored out of, the chain
    // carries on nearest-first anyway: those entries are the ones standing
    // behind the pair on offer, so the choice never thins to a single option.
    if (!affordable.length) affordable = [left.reduce((a, b) => (reach(b) < reach(a) ? b : a))];
    // A rung far enough to be a walk, near enough to leave room for another.
    // Under MIN_LEG it is not a walk at all, so those are dropped rather than
    // fallen back to; only a world with nothing else left will offer one, and
    // that beats offering nothing.
    const worth = affordable.filter(g => reach(g) >= MIN_LEG);
    const usable = worth.length ? worth : affordable;
    const fair = usable.filter(g => reach(g) >= 4 && reach(g) <= 11);
    const pool = fair.length ? fair : [usable.reduce((a, b) => (reach(b) < reach(a) ? b : a))];
    const weights = pool.map(g => GOAL_WEIGHT[g.id] ?? 2);
    let roll = rnd() * weights.reduce((a, b) => a + b, 0);
    let chosen = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) { roll -= weights[i]; if (roll < 0) { chosen = pool[i]; break; } }
    ladder.push(chosen);
    left.splice(left.indexOf(chosen), 1);
    spent += reach(chosen);
    from = trip.get(chosen).at;      // where that walk actually finishes
  }
  // A rung has to have a full pair standing behind it, or the last one on the
  // list would be offered on its own.
  return { goals: ladder, rungs: Math.max(1, Math.min(rungs, ladder.length - LIVE + 1)) };
}

/** What a rung is worth, and what the whole ladder is worth. Later rungs count
 *  for more, which is what makes pressing on tempting and losing one hurt. */
export const goalValue = (rung: number) => rung + 1;
export const ladderValue = (n: number) => (n * (n + 1)) / 2;   // 1 + 2 + … + n
