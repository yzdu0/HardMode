import { chromaticNumber } from './color-levels.ts';

export type Edge = [number, number];
// Bumped whenever the target pool changes, so saved runs never mix generations.
export const GUESS_REVISION = 'challenge-2';

export const GRAPHLE_N = 6, TREEDLE_N = 8;
const pairsOf = (n: number) => {
  const pairs: Edge[] = [];
  for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) pairs.push([u, v]);
  return pairs;
};
// Fixed pair order: these index the bits of every guess and target mask.
export const GRAPHLE_PAIRS = pairsOf(GRAPHLE_N);
export const TREEDLE_PAIRS = pairsOf(TREEDLE_N);

const edgesFromMask = (mask: number, pairs: Edge[]) =>
  pairs.filter((_, i) => mask & (1 << i)).map(([u, v]) => [u, v] as Edge);
export const graphleEdges = (mask: number) => edgesFromMask(mask, GRAPHLE_PAIRS);
export const treedleEdges = (mask: number) => edgesFromMask(mask, TREEDLE_PAIRS);

function neighbours(n: number, edges: number[][]) {
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  edges.forEach(([u, v]) => { adj[u].add(v); adj[v].add(u); });
  return adj;
}

// Longest shortest path; Infinity when some dot cannot be reached at all.
function diameter(n: number, edges: number[][]) {
  const adj = neighbours(n, edges);
  let far = 0;
  for (let s = 0; s < n; s++) {
    const dist = new Array(n).fill(-1);
    dist[s] = 0;
    const queue = [s];
    for (const u of queue) for (const w of adj[u]) if (dist[w] < 0) { dist[w] = dist[u] + 1; queue.push(w); }
    for (let t = 0; t < n; t++) {
      if (dist[t] < 0) return Infinity;
      far = Math.max(far, dist[t]);
    }
  }
  return far;
}

function countTriangles(n: number, edges: number[][]) {
  const adj = neighbours(n, edges);
  let total = 0;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    if (!adj[a].has(b)) continue;
    for (let c = b + 1; c < n; c++) if (adj[a].has(c) && adj[b].has(c)) total++;
  }
  return total;
}

// Distinct simple cycles of three dots or more. Each cycle is pinned to its
// lowest dot and walked in one direction only, so rotations and reflections of
// the same loop are counted once.
function countCycles(n: number, edges: number[][]) {
  const adj = neighbours(n, edges);
  let total = 0;
  for (let low = 0; low < n; low++) {
    const walk = (end: number, seen: number, length: number) => {
      for (let next = low + 1; next < n; next++) {
        if (!adj[end].has(next) || (seen & (1 << next))) continue;
        if (length + 1 >= 3 && adj[next].has(low)) total++;
        walk(next, seen | (1 << next), length + 1);
      }
    };
    walk(low, 1 << low, 1);
  }
  return total / 2; // each loop is walked once in each direction
}

export interface GraphleProps { e: number; chi: number; tri: number; cyc: number; diam: number }
export function graphleProps(edges: number[][]): GraphleProps {
  return {
    e: edges.length,
    chi: chromaticNumber(GRAPHLE_N, edges),
    tri: countTriangles(GRAPHLE_N, edges),
    cyc: countCycles(GRAPHLE_N, edges),
    diam: diameter(GRAPHLE_N, edges),
  };
}

function degrees(n: number, edges: number[][]) {
  const deg = new Array(n).fill(0);
  edges.forEach(([u, v]) => { deg[u]++; deg[v]++; });
  return deg;
}

// Sum of the distance between every pair of dots (the Wiener index).
function totalDistance(n: number, edges: number[][]) {
  const adj = neighbours(n, edges);
  let sum = 0;
  for (let s = 0; s < n; s++) {
    const dist = new Array(n).fill(-1);
    dist[s] = 0;
    const queue = [s];
    for (const u of queue) for (const w of adj[u]) if (dist[w] < 0) { dist[w] = dist[u] + 1; queue.push(w); }
    for (let t = s + 1; t < n; t++) {
      if (dist[t] < 0) return Infinity;
      sum += dist[t];
    }
  }
  return sum;
}

// Largest set of dots with no link between any two of them.
function independence(n: number, edges: number[][]) {
  const adj = neighbours(n, edges);
  let best = 0;
  const size = (m: number) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };
  for (let m = 0; m < (1 << n); m++) {
    if (size(m) <= best) continue;
    let free = true;
    for (let i = 0; i < n && free; i++) {
      if (!(m & (1 << i))) continue;
      for (let j = i + 1; j < n; j++) if ((m & (1 << j)) && adj[i].has(j)) { free = false; break; }
    }
    if (free) best = size(m);
  }
  return best;
}

export interface TreedleProps { leaf: number; diam: number; maxd: number; w: number; alpha: number }
export function treedleProps(edges: number[][]): TreedleProps {
  const deg = degrees(TREEDLE_N, edges);
  return {
    leaf: deg.filter(d => d === 1).length,
    diam: diameter(TREEDLE_N, edges),
    maxd: Math.max(...deg),
    w: totalDistance(TREEDLE_N, edges),
    alpha: independence(TREEDLE_N, edges),
  };
}

export const graphleFingerprint = (p: GraphleProps) => [p.e, p.chi, p.tri, p.cyc, p.diam].join('|');
export const treedleFingerprint = (p: TreedleProps) => [p.leaf, p.diam, p.maxd, p.w, p.alpha].join('|');

// ---------------------------------------------------------------------------
// Choosing a target
//
// Both games are won by matching five numbers, not the exact wiring, so the
// real measure of a day's difficulty is how many drawings share the target's
// five numbers. Left to chance that is far too many: a uniformly random
// Graphle target is matched by about 750 of the 32768 graphs (one guess in 44
// wins outright), and a random Treedle target by one tree in 13.
//
// Both lists below are derived, not invented — the tests recompute them by
// exhaustive enumeration and fail if these fall out of step.
// ---------------------------------------------------------------------------

// Graphle fingerprints matched by between 30 and 240 of the 32768 graphs:
// tight enough that a guess has to be deliberate, loose enough that the
// fingerprint is still reachable once the feedback has narrowed it down.
export const GRAPHLE_BAND: [number, number] = [30, 240];
export const GRAPHLE_TARGETS = [
  '10|3|3|24|2', '10|4|5|21|2', '10|4|6|19|3', '10|4|7|22|2', '10|4|7|22|3',
  '10|3|4|22|2', '11|3|6|36|2', '11|3|6|38|2', '11|4|7|37|2', '11|4|8|30|2',
  '5|2|0|0|3',
  '11|4|8|32|2', '11|4|6|39|2', '11|5|10|37|2', '6|3|1|1|2', '7|3|0|3|2',
  '7|3|1|2|3', '7|3|2|2|2', '7|3|2|3|2', '8|2|0|7|3', '8|3|2|7|2',
  '8|3|3|4|2', '8|3|3|4|3', '8|4|4|7|2', '9|3|2|12|2', '9|3|2|14|2',
  '9|3|3|12|3', '9|3|4|11|2', '9|3|4|13|2', '9|4|4|12|2', '9|4|5|8|2',
];

// Treedle shapes worth using, on two counts. First, at least ten of the other
// 22 shapes score four tiles or more against them, so a guess comes back
// ambiguous rather than decisive — that drops the straight line, the star and
// the near-stars, each of which reads off a single guess. Second, no more than
// 10080 of the 262144 labelled trees carry the shape, so blind guessing wins
// about one time in 41 rather than one in 13.
export const TREEDLE_LOOKALIKES = 10;
export const TREEDLE_MAX_CLASS = 10080;
export const TREEDLE_TARGETS = [
  '4|5|4|71|5', '4|5|3|74|5', '5|4|4|63|5', '5|4|4|62|5', '5|4|4|66|6',
  '5|4|3|65|5', '4|4|4|64|4', '4|4|3|67|5', '5|4|5|59|5',
];

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

export function generateGraphleTarget(date: string): number {
  const rng = random(`${GUESS_REVISION}|graphle|${date}`);
  const wanted = new Set(GRAPHLE_TARGETS);
  let fallback = 0;
  for (let attempt = 0; attempt < 4000; attempt++) {
    const mask = Math.floor(rng() * (1 << GRAPHLE_PAIRS.length));
    const props = graphleProps(graphleEdges(mask));
    if (props.e < 5 || props.e > 11 || !Number.isFinite(props.diam)) continue;
    if (wanted.has(graphleFingerprint(props))) return mask;
    if (!fallback) fallback = mask;
  }
  return fallback;
}

// Uniformly random labelled tree, via its Prüfer sequence.
export function treeMaskFromPrufer(code: number[]): number {
  const deg = new Array(TREEDLE_N).fill(1);
  code.forEach(v => deg[v]++);
  const bit = new Map<string, number>();
  TREEDLE_PAIRS.forEach(([u, v], i) => bit.set(u + '-' + v, i));
  let mask = 0;
  const link = (a: number, b: number) => { mask |= 1 << bit.get(Math.min(a, b) + '-' + Math.max(a, b))!; };
  for (const v of code) {
    let leaf = -1;
    for (let i = 0; i < TREEDLE_N; i++) if (deg[i] === 1) { leaf = i; break; }
    link(leaf, v);
    deg[leaf]--; deg[v]--;
  }
  const rest: number[] = [];
  for (let i = 0; i < TREEDLE_N; i++) if (deg[i] === 1) rest.push(i);
  link(rest[0], rest[1]);
  return mask;
}

export function randomTreeMask(rng: () => number): number {
  const code: number[] = [];
  for (let i = 0; i < TREEDLE_N - 2; i++) code.push(Math.floor(rng() * TREEDLE_N));
  return treeMaskFromPrufer(code);
}

export function generateTreedleTarget(date: string): number {
  const rng = random(`${GUESS_REVISION}|treedle|${date}`);
  const wanted = new Set(TREEDLE_TARGETS);
  let fallback = 0;
  for (let attempt = 0; attempt < 4000; attempt++) {
    const mask = randomTreeMask(rng);
    if (wanted.has(treedleFingerprint(treedleProps(treedleEdges(mask))))) return mask;
    if (!fallback) fallback = mask;
  }
  return fallback;
}
