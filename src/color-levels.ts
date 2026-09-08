export type Edge = [number, number];
export type Point = [number, number];
export interface ColorGraph {
  n: number;
  edges: Edge[];
  pos: Point[];
  chi: number;
  kind: string;
  labels?: string[] | null;
  locked?: number[] | null;
  clauses?: string[][] | null;
  extraEdges?: Edge[];
  hideEdges?: boolean;
}
// Bumped whenever the level pool changes, so saved runs never mix generations.
export const COLOR_REVISION = 'challenge-2';
// The drawing surface every layout has to sit inside, and the node radius the
// renderer uses once a graph passes twelve vertices.
const BOX = 340, EDGE_R = 15;

export function edgeKey(u: number, v: number) { return u < v ? u + '-' + v : v + '-' + u; }

export function shuffled<T>(list: T[], rng: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function neighbours(n: number, edges: number[][]) {
  const adj: number[][] = Array.from({ length: n }, () => []);
  edges.forEach(([u, v]) => { adj[u].push(v); adj[v].push(u); });
  return adj;
}

export function isConnected(n: number, edges: number[][]) {
  const adj = neighbours(n, edges);
  const seen = new Set([0]), queue = [0];
  for (const v of queue) for (const w of adj[v]) if (!seen.has(w)) { seen.add(w); queue.push(w); }
  return seen.size === n;
}

export function chromaticNumber(n: number, edges: number[][]) {
  const adj = neighbours(n, edges);
  const order = [...Array(n).keys()].sort((a, b) => adj[b].length - adj[a].length);
  const colourable = (k: number) => {
    const paint = new Array(n).fill(-1);
    const step = (i: number): boolean => {
      if (i === n) return true;
      const v = order[i];
      // Symmetry break: never open colour c+1 before colour c has been used.
      let ceiling = 0;
      for (let j = 0; j < i; j++) ceiling = Math.max(ceiling, paint[order[j]] + 1);
      for (let c = 0; c < Math.min(k, ceiling + 1); c++) {
        if (adj[v].every(w => paint[w] !== c)) {
          paint[v] = c;
          if (step(i + 1)) return true;
          paint[v] = -1;
        }
      }
      return false;
    };
    return step(0);
  };
  for (let k = 1; k <= n; k++) if (colourable(k)) return k;
  return n;
}

// How many genuinely different ways there are to colour the graph with exactly
// k colours. Two colourings that put the same dots together are one answer
// however the colours are shuffled, so what is really counted is partitions of
// the dots into exactly k non-empty independent sets.
//
// Walking the "restricted growth" canonical form does that for free: dots are
// visited in a fixed order, and a dot may only open colour c once colours
// 0..c-1 are all in use. Every partition is then reached by exactly one path.
export const COUNT_CAP = 100000;
export function countColourings(n: number, edges: number[][], k: number, cap = COUNT_CAP) {
  if (k < 1 || k > n) return { count: 0, capped: false };
  const adj = neighbours(n, edges);
  // Busiest dots first: the branches that cannot work die sooner that way.
  const order = [...Array(n).keys()].sort((a, b) => adj[b].length - adj[a].length || a - b);
  const paint = new Array(n).fill(-1);
  let count = 0, capped = false;
  const step = (i: number, used: number) => {
    if (i === n) {
      if (used === k && ++count >= cap) capped = true;
      return;
    }
    // Even one fresh colour per remaining dot could not reach k.
    if (used + (n - i) < k) return;
    const v = order[i];
    const top = Math.min(used, k - 1);
    for (let c = 0; c <= top; c++) {
      if (adj[v].some(w => paint[w] === c)) continue;
      paint[v] = c;
      step(i + 1, c === used ? used + 1 : used);
      paint[v] = -1;
      if (capped) return;
    }
  };
  step(0, 0);
  return { count, capped };
}

// Two vertices drawn closer than this overlap once the renderer inflates them.
const CLEAR = 2 * EDGE_R + 14;
function spacedOut(pos: Point[]) {
  for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++)
    if (Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]) < CLEAR) return false;
  return true;
}

const row = (xs: number[], y: number): Point[] => xs.map(x => [x, y]);
const spread = (count: number, from: number, to: number) =>
  count === 1 ? [(from + to) / 2] : [...Array(count).keys()].map(i => from + (i * (to - from)) / (count - 1));

type Rng = () => number;
interface ColorFamily {
  kind: string;
  wants: number;                       // the chromatic number worth aiming for
  build: (rng: Rng) => ColorGraph | null;
}

// ---------------------------------------------------------------------------
// MAP — districts of a country. Sharing a border means sharing an edge. One
// diagonal per block keeps the drawing planar, so four colours always suffice
// and the puzzle is whether three do.
// ---------------------------------------------------------------------------
function buildMap(rng: Rng): ColorGraph | null {
  const shapes: [number, number][] = [[3, 4], [4, 4], [4, 3]];
  const [R, C] = shapes[Math.floor(rng() * shapes.length)];
  const n = R * C;
  const pos: Point[] = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) pos.push([
    46 + (c * (BOX - 92)) / (C - 1) + (rng() - 0.5) * 12,
    46 + (r * (BOX - 92)) / (R - 1) + (rng() - 0.5) * 12,
  ]);
  const set = new Set<string>();
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const i = r * C + c;
    if (c + 1 < C) set.add(edgeKey(i, i + 1));
    if (r + 1 < R) set.add(edgeKey(i, i + C));
  }
  // A diagonal in most blocks: triangulated districts are what force a fourth
  // colour, and a sparse grid on its own never would.
  for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) {
    if (rng() < 0.25) continue;
    const a = r * C + c;
    set.add(rng() < 0.5 ? edgeKey(a, a + C + 1) : edgeKey(a + 1, a + C));
  }
  const edges = [...set].map(s => s.split('-').map(Number) as Edge);
  if (!spacedOut(pos) || !isConnected(n, edges)) return null;
  return { n, edges, pos, chi: chromaticNumber(n, edges), kind: 'map', labels: null };
}

// ---------------------------------------------------------------------------
// TIMETABLE — each dot is an exam, each edge a shared student. Exams are drawn
// left to right in start order; the busiest overlap sets the answer.
// ---------------------------------------------------------------------------
function buildTimetable(rng: Rng): ColorGraph | null {
  const n = 10 + Math.floor(rng() * 3);
  // An exam timetable is an interval graph, so its answer is exactly the
  // busiest moment of the day. Resample until that moment holds four exams:
  // three is a give-away and five leaves no room to lay the graph out.
  let spans: [number, number][] = [];
  for (let tries = 0; tries < 50; tries++) {
    spans = [];
    for (let i = 0; i < n; i++) { const start = rng() * 8; spans.push([start, start + 1.6 + rng() * 3]); }
    const moments = spans.flatMap(s => s).sort((a, z) => a - z);
    const busiest = Math.max(...moments.map(at => spans.filter(s => s[0] <= at && at < s[1]).length));
    if (busiest === 4) break;
    spans = [];
  }
  if (!spans.length) return null;
  const set = new Set<string>();
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
    if (spans[i][0] < spans[j][1] && spans[j][0] < spans[i][1]) set.add(edgeKey(i, j));
  const edges = [...set].map(s => s.split('-').map(Number) as Edge);
  if (!isConnected(n, edges)) return null;
  // Lay each exam in the first free lane, the way a real timetable is built.
  const lane = new Array(n).fill(-1);
  for (const [, i] of spans.map((s, i) => [(s[0] + s[1]) / 2, i]).sort((a, z) => a[0] - z[0])) {
    const taken = new Set<number>();
    for (let j = 0; j < n; j++)
      if (j !== i && lane[j] >= 0 && spans[i][0] < spans[j][1] && spans[j][0] < spans[i][1]) taken.add(lane[j]);
    let free = 0;
    while (taken.has(free)) free++;
    lane[i] = free;
  }
  const lanes = Math.max(...lane) + 1;
  const pos: Point[] = spans.map((s, i) => [
    40 + (((s[0] + s[1]) / 2) / 10) * (BOX - 80),
    lanes === 1 ? BOX / 2 : 48 + (lane[i] * (BOX - 96)) / (lanes - 1),
  ]);
  if (!spacedOut(pos)) return null;
  return { n, edges, pos, chi: chromaticNumber(n, edges), kind: 'timetable', labels: null };
}

// ---------------------------------------------------------------------------
// FREQUENCIES — masts scattered across a region. Two masts within range of each
// other interfere, so they need different channels. No tidy structure to lean
// on: this one is read off the picture.
// ---------------------------------------------------------------------------
function buildFrequencies(rng: Rng): ColorGraph | null {
  const n = 12 + Math.floor(rng() * 3);
  const pos: Point[] = [];
  for (let dart = 0; dart < 900 && pos.length < n; dart++) {
    const spot: Point = [44 + rng() * (BOX - 88), 44 + rng() * (BOX - 88)];
    if (pos.every(p => Math.hypot(p[0] - spot[0], p[1] - spot[1]) >= CLEAR)) pos.push(spot);
  }
  if (pos.length < n) return null;
  // Range is set by the density we want rather than picked blind: sort the
  // pairs and let the shortest links in until the graph is as busy as intended.
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
    pairs.push([Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]), i, j]);
  pairs.sort((a, z) => a[0] - z[0]);
  const range = pairs[Math.min(pairs.length - 1, Math.round(2.2 * n) - 1)][0];
  const edges = pairs.filter(([d]) => d <= range).map(([, u, v]) => [u, v] as Edge);
  if (!isConnected(n, edges)) return null;
  return { n, edges, pos, chi: chromaticNumber(n, edges), kind: 'frequencies', labels: null };
}

// ---------------------------------------------------------------------------
// TRIANGLE-FREE — Mycielski's construction: an odd ring, a mirror of every ring
// node wired to that node's neighbours, and one hub joined to all the mirrors.
// There is not a single triangle anywhere, yet three colours are provably not
// enough. Every "find the clique" instinct fails here.
// ---------------------------------------------------------------------------
function buildTriangleFree(rng: Rng): ColorGraph | null {
  const m = rng() < 0.5 ? 5 : 7;
  const n = 2 * m + 1, hub = 2 * m;
  const set = new Set<string>();
  for (let i = 0; i < m; i++) {
    set.add(edgeKey(i, (i + 1) % m));                     // the ring
    set.add(edgeKey(m + i, (i + 1) % m));                 // mirror to ring neighbours
    set.add(edgeKey(m + i, (i + m - 1) % m));
    set.add(edgeKey(m + i, hub));                         // hub to every mirror
  }
  // Dropping a link or two keeps the daily shape from repeating; the chromatic
  // check downstream throws away any that stopped being a four-colour puzzle.
  const trimmed = shuffled([...set], rng).slice(0, Math.floor(rng() * 3));
  trimmed.forEach(key => set.delete(key));
  const edges = [...set].map(s => s.split('-').map(Number) as Edge);
  const turn = rng() * Math.PI * 2;
  const pos: Point[] = [];
  const ring = (count: number, radius: number, index: number) => {
    const a = turn + (2 * Math.PI * index) / count;
    return [BOX / 2 + radius * Math.cos(a), BOX / 2 + radius * Math.sin(a)] as Point;
  };
  for (let i = 0; i < m; i++) pos.push(ring(m, 138, i));
  for (let i = 0; i < m; i++) pos.push(ring(m, m === 5 ? 78 : 82, i + 0.5));
  pos.push([BOX / 2, BOX / 2]);
  if (!spacedOut(pos) || !isConnected(n, edges)) return null;
  return { n, edges, pos, chi: chromaticNumber(n, edges), kind: 'triangle-free', labels: null };
}

// ---------------------------------------------------------------------------
// PROPAGATION CHAIN — a planted puzzle. The clique at the top fixes which
// colour is which; the middle row touches all-but-one colour and is therefore
// forced; the bottom row is where the real branching happens.
// ---------------------------------------------------------------------------
function buildPropagation(rng: Rng): ColorGraph | null {
  const k = 4, forcedCount = 3, choiceCount = 4;
  const n = k + forcedCount + choiceCount;
  const plant: number[] = [];
  for (let i = 0; i < k; i++) plant.push(i);
  const forced: number[] = [], choice: number[] = [];
  for (let i = 0; i < forcedCount; i++) { const c = Math.floor(rng() * k); forced.push(c); plant.push(c); }
  for (let i = 0; i < choiceCount; i++) { const c = Math.floor(rng() * k); choice.push(c); plant.push(c); }
  const set = new Set<string>();
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) set.add(edgeKey(i, j));
  const atForced = (t: number) => k + t, atChoice = (t: number) => k + forcedCount + t;
  // A forced node meets every colour of the clique except its own: one option left.
  for (let t = 0; t < forcedCount; t++)
    for (let c = 0; c < k; c++) if (c !== forced[t]) set.add(edgeKey(atForced(t), c));
  // A choice node meets only some of them, so it genuinely branches.
  for (let t = 0; t < choiceCount; t++) {
    const others = shuffled([...Array(k).keys()].filter(c => c !== choice[t]), rng);
    for (let d = 0; d < 1 + Math.floor(rng() * (k - 1)); d++) set.add(edgeKey(atChoice(t), others[d]));
  }
  for (let t = 1; t < forcedCount; t++)
    if (forced[t - 1] !== forced[t]) set.add(edgeKey(atForced(t - 1), atForced(t)));
  let extra = 3 + Math.floor(rng() * 3);
  for (let guard = 0; extra > 0 && guard < 200; guard++) {
    const u = k + Math.floor(rng() * (n - k)), v = k + Math.floor(rng() * (n - k));
    if (u === v || plant[u] === plant[v] || set.has(edgeKey(u, v))) continue;
    set.add(edgeKey(u, v)); extra--;
  }
  const edges = [...set].map(s => s.split('-').map(Number) as Edge);
  const pos: Point[] = [
    ...row(spread(k, 52, BOX - 52), 58),
    ...row(spread(forcedCount, 66, BOX - 66), 170),
    ...row(spread(choiceCount, 48, BOX - 48), 282),
  ];
  if (!spacedOut(pos) || !isConnected(n, edges)) return null;
  // The clique needs k colours and the planting achieves them: chi is exactly k.
  return { n, edges, pos, chi: k, kind: 'propagation chain', labels: null };
}

// ---------------------------------------------------------------------------
// SAT REDUCTION — two clauses over three variables, compiled into a graph.
// Colouring it IS solving the formula. Each clause becomes a five-node fuse
// that only burns through when one of its literals is true.
// ---------------------------------------------------------------------------
const SAT_TRUE = 0, SAT_FALSE = 1, SAT_BASE = 2, SAT_VARS = 3;
function buildSat(rng: Rng): ColorGraph | null {
  const assign = [rng() < 0.5, rng() < 0.5, rng() < 0.5];
  const literal = (v: number, negated: boolean) => SAT_VARS + 2 * v + (negated ? 1 : 0);
  const name = (v: number, negated: boolean) => (negated ? '!' : '') + 'x' + (v + 1);
  // Both clauses must be satisfied by the planted assignment, and neither may
  // be a tautology, or "make it true" would stop meaning anything.
  const draw = () => {
    for (let tries = 0; tries < 60; tries++) {
      const picks = shuffled([0, 1, 2], rng).map(v => ({ v, negated: rng() < 0.5 }));
      const tautology = picks.some((a, i) => picks.some((z, j) => j > i && a.v === z.v && a.negated !== z.negated));
      if (!tautology && picks.some(({ v, negated }) => assign[v] !== negated)) return picks;
    }
    return null;
  };
  const clauses = [draw(), draw()];
  if (clauses.some(c => !c)) return null;
  const set = new Set<string>();
  const link = (u: number, v: number) => set.add(edgeKey(u, v));
  link(SAT_TRUE, SAT_FALSE); link(SAT_FALSE, SAT_BASE); link(SAT_TRUE, SAT_BASE);
  for (let v = 0; v < SAT_VARS; v++) {
    link(literal(v, false), literal(v, true));
    link(literal(v, false), SAT_BASE); link(literal(v, true), SAT_BASE);
  }
  const firstFuse = SAT_VARS + 2 * SAT_VARS;
  clauses.forEach((clause, ci) => {
    const [a, b, c] = clause!.map(({ v, negated }) => literal(v, negated));
    const p = firstFuse + ci * 5, q = p + 1, r = p + 2, s = p + 3, t = p + 4;
    link(p, a); link(p, b); link(p, SAT_TRUE);
    link(q, p); link(q, a);
    link(r, q); link(r, b);
    link(s, r); link(s, c);
    link(t, s); link(t, SAT_FALSE); link(t, SAT_BASE);
  });
  const n = firstFuse + 10;
  const pos: Point[] = [
    [96, 40], [244, 40], [170, 92],
    ...row(spread(6, 34, BOX - 34), 158),
    ...row(spread(5, 44, BOX - 44), 236),
    ...row(spread(5, 44, BOX - 44), 306),
  ];
  const labels = ['T', 'F', 'B'];
  for (let v = 0; v < SAT_VARS; v++) labels.push(name(v, false), name(v, true));
  for (let ci = 0; ci < 2; ci++) for (const step of ['p', 'q', 'r', 's', 't']) labels.push(step + (ci + 1));
  const locked = new Array(n).fill(-1);
  locked[SAT_TRUE] = 0; locked[SAT_FALSE] = 1; locked[SAT_BASE] = 2;
  return {
    n, edges: [...set].map(s => s.split('-').map(Number) as Edge), pos,
    chi: 3, kind: 'sat reduction', labels, locked,
    clauses: clauses.map(clause => clause!.map(({ v, negated }) => name(v, negated))),
  };
}

const FAMILIES: ColorFamily[] = [
  { kind: 'map', wants: 4, build: buildMap },
  { kind: 'timetable', wants: 4, build: buildTimetable },
  { kind: 'frequencies', wants: 4, build: buildFrequencies },
  { kind: 'triangle-free', wants: 4, build: buildTriangleFree },
  { kind: 'propagation chain', wants: 4, build: buildPropagation },
  { kind: 'sat reduction', wants: 3, build: buildSat },
];
// The sudoku board is built by the host, which owns the digit machinery.
export const COLOR_FAMILIES = [...FAMILIES.map(family => family.kind), 'sudoku'];

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

// A graph is worth a day only if it is big enough to plan, busy enough to trap
// a careless painter, and needs every colour the family was aiming for.
function worthy(g: ColorGraph, wants: number, exact: boolean) {
  if (g.n < 9 || g.n > 20) return false;
  if (g.edges.length < Math.round(1.5 * g.n) || g.edges.length > Math.round(2.8 * g.n)) return false;
  return exact ? g.chi === wants : g.chi >= wants - 1 && g.chi <= 4;
}

export type SudokuBuilder = (rng: () => number) => ColorGraph | null;

export function generateColorGraph(date: string, buildSudoku: SudokuBuilder): ColorGraph {
  const rng = random(`${COLOR_REVISION}|${date}`);
  const first = Math.floor(rng() * COLOR_FAMILIES.length);
  let backup: ColorGraph | null = null;
  for (let attempt = 0; attempt < 96; attempt++) {
    const kind = COLOR_FAMILIES[(first + Math.floor(attempt / 16)) % COLOR_FAMILIES.length];
    const stream = random(`${COLOR_REVISION}|${date}|${kind}|${attempt}`);
    if (kind === 'sudoku') {
      const board = buildSudoku(stream);
      if (board && isConnected(board.n, board.edges)) return board;
      continue;
    }
    const family = FAMILIES.find(f => f.kind === kind)!;
    const g = family.build(stream);
    if (!g) continue;
    // The first pass insists on the family's own target; later ones settle.
    if (worthy(g, family.wants, true)) return g;
    if (!backup && worthy(g, family.wants, false)) backup = g;
  }
  if (backup) return backup;
  // Safety net: a fixed triangulated map that is known to need four colours.
  const pos: Point[] = [];
  for (let i = 0; i < 12; i++) pos.push([52 + (i % 4) * 78, 60 + Math.floor(i / 4) * 110]);
  const edges: Edge[] = [
    [0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7], [8, 9], [9, 10], [10, 11],
    [0, 4], [1, 5], [2, 6], [3, 7], [4, 8], [5, 9], [6, 10], [7, 11],
    [0, 5], [1, 6], [2, 7], [4, 9], [5, 10], [6, 11],
  ];
  return { n: 12, edges, pos, chi: chromaticNumber(12, edges), kind: 'map', labels: null };
}
