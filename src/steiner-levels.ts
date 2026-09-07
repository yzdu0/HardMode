export type Cell = [number, number];
export type Special = { type: 'bonus' | 'penalty' | 'portal'; pid?: string };
export interface SteinerBoard {
  N: number;
  terms: Cell[];
  termSet: Set<string>;
  walls: Set<string>;
  special: Map<string, Special>;
  portalPairs: Record<string, Cell[]>;
  kind: string;
  par: number;
}
export const STEINER_REVISION = 'challenge-1';
const key = ([r, c]: Cell) => `${r},${c}`;
const directions: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

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

export function boardGraph(b: SteinerBoard) {
  const cells: Cell[] = [];
  const indices = new Map<string, number>();
  for (let r = 0; r < b.N; r++) for (let c = 0; c < b.N; c++) {
    if (!b.walls.has(key([r, c]))) {
      indices.set(key([r, c]), cells.length);
      cells.push([r, c]);
    }
  }
  const costs = cells.map(cell => b.termSet.has(key(cell)) ? 0 :
    b.special.get(key(cell))?.type === 'bonus' ? 0 : b.special.get(key(cell))?.type === 'penalty' ? 3 : 1);
  const adjacent = cells.map(([r, c]) => directions.map(([dr, dc]) => indices.get(key([r + dr, c + dc])))
    .filter((i): i is number => i !== undefined));
  for (const [a, z] of Object.values(b.portalPairs)) {
    const u = indices.get(key(a))!, v = indices.get(key(z))!;
    adjacent[u].push(v); adjacent[v].push(u);
  }
  return { cells, costs, adjacent, terminals: b.terms.map(cell => indices.get(key(cell))!) };
}

// A plausible human approach: repeatedly attach the nearest remaining seed.
// Try every starting seed so the difficulty screen isn't tied to one bad start.
export function greedyNetworkCost(b: SteinerBoard): number {
  const { costs, adjacent, terminals } = boardGraph(b);
  let best = Infinity;
  for (const start of terminals) {
    const network = new Set([start]);
    while (!terminals.every(t => network.has(t))) {
      const dist = costs.map(() => Infinity);
      const prev = costs.map(() => -1);
      const visited = costs.map(() => false);
      for (const v of network) dist[v] = 0;
      let target = -1;
      for (let step = 0; step < costs.length; step++) {
        let u = -1;
        for (let v = 0; v < costs.length; v++) if (!visited[v] && (u < 0 || dist[v] < dist[u])) u = v;
        if (u < 0 || !Number.isFinite(dist[u])) break;
        visited[u] = true;
        if (terminals.includes(u) && !network.has(u)) { target = u; break; }
        for (const v of adjacent[u]) {
          const next = dist[u] + (network.has(v) ? 0 : costs[v]);
          if (next < dist[v]) { dist[v] = next; prev[v] = u; }
        }
      }
      if (target < 0) return Infinity;
      while (!network.has(target)) { network.add(target); target = prev[target]; }
    }
    best = Math.min(best, [...network].reduce((sum, v) => sum + costs[v], 0));
  }
  return best;
}

const families = ['switchbacks', 'crossroads', 'courtyards', 'fault lines', 'thorn lanes'];

function candidate(seed: string, family: number): SteinerBoard | null {
  const rng = random(seed), N = 13;
  const int = (n: number) => Math.floor(rng() * n);
  const walls = new Set<string>();
  const special = new Map<string, Special>();
  const gates: Cell[] = [];
  const block = (r: number, c: number) => walls.add(key([r, c]));
  // Every barrier offers multiple routes; these are network puzzles, not mazes
  // with a single forced corridor. Open borders provide expensive alternatives.
  if (family === 0 || family === 3) {
    for (const c of [4, 8]) {
      const a = 2 + int(3), z = 8 + int(3);
      for (let r = 1; r < N - 1; r++) {
        if (r === a || r === z) gates.push([r, c]); else block(r, c);
        if (family === 3 && r !== a && r !== z) block(r, c + 1);
      }
    }
  } else if (family === 1) {
    const gaps = [2 + int(2), 9 + int(2)];
    for (let i = 1; i < N - 1; i++) {
      if (gaps.includes(i)) { gates.push([6, i], [i, 6]); }
      else { block(6, i); block(i, 6); }
    }
  } else if (family === 2) {
    for (const [r, c] of [[3, 3], [3, 8], [8, 3], [8, 8]]) {
      for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) block(r + dr, c + dc);
    }
  } else {
    for (const r of [3, 6, 9]) {
      for (let c = 1; c < N - 1; c++) {
        if (c === 2 + r % 3 || c === 9 - r % 2) continue;
        special.set(key([r, c]), { type: 'penalty' });
      }
    }
  }

  // Seeds occupy six outer regions plus the centre, preventing a lucky cluster.
  const regions: Cell[] = [[0, 0], [0, 5], [0, 10], [10, 0], [10, 5], [10, 10], [5, 5]];
  const terms: Cell[] = [];
  for (const [r0, c0] of regions) {
    const choices: Cell[] = [];
    for (let r = r0; r < r0 + 3; r++) for (let c = c0; c < c0 + 3; c++) {
      if (walls.has(key([r, c])) || special.has(key([r, c]))) continue;
      if (terms.every(([tr, tc]) => Math.abs(tr - r) + Math.abs(tc - c) >= 4)) choices.push([r, c]);
    }
    if (!choices.length) return null;
    terms.push(choices[int(choices.length)]);
  }
  const termSet = new Set(terms.map(key));
  // Small obstacles break straight routes without hiding the larger structure.
  for (let i = 0; i < (family === 2 ? 16 : 7); i++) {
    const r = 1 + int(N - 2), c = 1 + int(N - 2), k = key([r, c]);
    if (!termSet.has(k) && !special.has(k) && !gates.some(cell => key(cell) === k)) block(r, c);
  }
  const take = (type: 'bonus' | 'penalty', count: number) => {
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const cell: Cell = [int(N), int(N)], k = key(cell);
        if (walls.has(k) || termSet.has(k) || special.has(k)) continue;
        special.set(k, { type }); break;
      }
    }
  };
  take('bonus', 8); take('penalty', family === 4 ? 0 : 10);
  // One costly gate and one free gate tempt different, globally competing trunks.
  gates.forEach((cell, i) => {
    if (!termSet.has(key(cell)) && !walls.has(key(cell))) special.set(key(cell), { type: i % 2 ? 'bonus' : 'penalty' });
  });
  const portalPairs: Record<string, Cell[]> = {};
  if (family === 3) {
    for (const [i, pid] of ['A', 'B'].entries()) {
      const ends: Cell[] = [];
      for (const side of [0, 1]) {
        const choices: Cell[] = [];
        for (let r = i === 0 ? 1 : 7; r <= (i === 0 ? 5 : 11); r++) {
          for (let c = side === 0 ? 1 : 10; c <= (side === 0 ? 3 : 11); c++) {
            const cell: Cell = [r, c], k = key(cell);
            if (!walls.has(k) && !termSet.has(k) && !special.has(k) &&
                terms.every(([tr, tc]) => Math.abs(tr - r) + Math.abs(tc - c) >= 3)) choices.push(cell);
          }
        }
        if (!choices.length) return null;
        ends.push(choices[int(choices.length)]);
      }
      portalPairs[pid] = ends;
      ends.forEach(cell => special.set(key(cell), { type: 'portal', pid }));
    }
  }
  const b: SteinerBoard = { N, terms, termSet, walls, special, portalPairs, kind: families[family], par: 0 };
  const { adjacent, terminals } = boardGraph(b);
  const seen = new Set([terminals[0]]), queue = [terminals[0]];
  for (const u of queue) for (const v of adjacent[u]) if (!seen.has(v)) { seen.add(v); queue.push(v); }
  return terminals.every(t => seen.has(t)) ? b : null;
}

export type ExactSolver = (N: number, terms: Cell[], walls: Set<string>, special: Map<string, Special>, portals: Record<string, Cell[]>) => number;
const cache = new Map<string, SteinerBoard>();

export function fallbackSteiner(solve: ExactSolver): SteinerBoard {
  const board = candidate('challenge-1|2026-09-03|2', 3)!;
  board.par = solve(board.N, board.terms, board.walls, board.special, board.portalPairs);
  return board;
}

export function generateSteiner(date: string, solve: ExactSolver): SteinerBoard {
  if (cache.has(date)) return cache.get(date)!;
  const rng = random(`${STEINER_REVISION}|${date}`);
  const family = Math.floor(rng() * families.length);
  let best: SteinerBoard | null = null, bestScore = -Infinity;
  for (let attempt = 0; attempt < 64; attempt++) {
    // If the initial layout yields no strong puzzle, try other architectures.
    const attemptFamily = attempt < 32 ? family : (family + 1 + Math.floor((attempt - 32) / 8)) % families.length;
    const b = candidate(`${STEINER_REVISION}|${date}|${attempt}`, attemptFamily);
    if (!b) continue;
    b.par = solve(b.N, b.terms, b.walls, b.special, b.portalPairs);
    if (!Number.isFinite(b.par) || b.par < 28) continue;
    const gap = greedyNetworkCost(b) - b.par;
    if (gap < 2) continue;
    const score = gap * 10 + b.par / 100;
    if (score > bestScore) { best = b; bestScore = score; }
    // Even the best of seven nearest-seed starts misses par by at least 3.
    if (gap >= 3) break;
  }
  // A verified challenge is safer than an easy open-grid fallback or a blank app.
  if (!best) {
    best = fallbackSteiner(solve);
  }
  cache.set(date, best);
  return best;
}
