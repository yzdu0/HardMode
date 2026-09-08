export type Cell = [number, number];
export type Special = { type: 'bonus' | 'penalty' | 'portal'; pid?: string };
export interface SteinerBoard {
  N: number;
  terms: Cell[];
  termSet: Set<string>;
  walls: Set<string>;
  special: Map<string, Special>;
  portalPairs: Record<string, Cell[]>;
  // Horizontal wrapping is required before vertical wrapping can be enabled.
  wrap: boolean;
  wrapVertical: boolean;
  kind: string;
  target: number;
}
// Bumped whenever the level pool changes, so saved runs never mix generations.
export const STEINER_REVISION = 'challenge-5';
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
  if (b.wrap) for (let r = 0; r < b.N; r++) {
    const u = indices.get(key([r, 0])), v = indices.get(key([r, b.N - 1]));
    if (u !== undefined && v !== undefined) { adjacent[u].push(v); adjacent[v].push(u); }
  }
  if (b.wrapVertical) for (let c = 0; c < b.N; c++) {
    const u = indices.get(key([0, c])), v = indices.get(key([b.N - 1, c]));
    if (u !== undefined && v !== undefined) { adjacent[u].push(v); adjacent[v].push(u); }
  }
  for (const [a, z] of Object.values(b.portalPairs)) {
    const u = indices.get(key(a))!, v = indices.get(key(z))!;
    adjacent[u].push(v); adjacent[v].push(u);
  }
  return { cells, costs, adjacent, terminals: b.terms.map(cell => indices.get(key(cell))!) };
}

// Node-weighted Dijkstra from every source at once. Cells already in `owned`
// cost nothing, which is what makes "grow the network I have" routing cheap.
function reach(costs: number[], adjacent: number[][], sources: Iterable<number>, owned: Set<number>) {
  const n = costs.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const hd: number[] = [], hn: number[] = [];
  const push = (d: number, v: number) => {
    hd.push(d); hn.push(v);
    for (let i = hd.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      [hd[p], hd[i]] = [hd[i], hd[p]]; [hn[p], hn[i]] = [hn[i], hn[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = hn[0], ld = hd.pop()!, ln = hn.pop()!;
    if (hd.length) {
      hd[0] = ld; hn[0] = ln;
      for (let i = 0;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let m = i;
        if (l < hd.length && hd[l] < hd[m]) m = l;
        if (r < hd.length && hd[r] < hd[m]) m = r;
        if (m === i) break;
        [hd[m], hd[i]] = [hd[i], hd[m]]; [hn[m], hn[i]] = [hn[i], hn[m]];
        i = m;
      }
    }
    return top;
  };
  for (const s of sources) { dist[s] = 0; push(0, s); }
  while (hd.length) {
    const u = pop();
    if (done[u]) continue;
    done[u] = 1;
    for (const v of adjacent[u]) {
      const next = dist[u] + (owned.has(v) ? 0 : costs[v]);
      if (next < dist[v]) { dist[v] = next; prev[v] = u; push(next, v); }
    }
  }
  return { dist, prev };
}

const total = (costs: number[], network: Set<number>) => [...network].reduce((sum, v) => sum + costs[v], 0);

// First plausible human approach: repeatedly attach the nearest remaining seed.
// Try every starting seed so difficulty isn't tied to one unlucky start.
export function greedyNetworkCost(b: SteinerBoard): number {
  const { costs, adjacent, terminals } = boardGraph(b);
  let best = Infinity;
  for (const start of terminals) {
    const network = new Set([start]);
    let stuck = false;
    while (!stuck && !terminals.every(t => network.has(t))) {
      const { dist, prev } = reach(costs, adjacent, network, network);
      let target = -1;
      for (const t of terminals) if (!network.has(t) && (target < 0 || dist[t] < dist[target])) target = t;
      if (target < 0 || !Number.isFinite(dist[target])) { stuck = true; break; }
      while (!network.has(target)) { network.add(target); target = prev[target]; }
    }
    if (!stuck) best = Math.min(best, total(costs, network));
  }
  return best;
}

// Second plausible approach: link the seed pairs cheapest-first like a minimum
// spanning tree, keeping whatever cells those routes happen to share.
export function spanningNetworkCost(b: SteinerBoard): number {
  const { costs, adjacent, terminals } = boardGraph(b);
  const nothing = new Set<number>();
  const runs = terminals.map(t => reach(costs, adjacent, [t], nothing));
  const parent = terminals.map((_, i) => i);
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const links: [number, number, number][] = [];
  for (let i = 0; i < terminals.length; i++) for (let j = i + 1; j < terminals.length; j++)
    links.push([runs[i].dist[terminals[j]], i, j]);
  links.sort((a, z) => a[0] - z[0]);
  const network = new Set(terminals);
  let joined = 0;
  for (const [length, i, j] of links) {
    if (!Number.isFinite(length)) break;
    if (find(i) === find(j)) continue;
    parent[find(i)] = find(j); joined++;
    for (let v = terminals[j]; v >= 0 && v !== terminals[i]; v = runs[i].prev[v]) network.add(v);
  }
  return joined === terminals.length - 1 ? total(costs, network) : Infinity;
}

export const naiveNetworkCost = (b: SteinerBoard) => Math.min(greedyNetworkCost(b), spanningNetworkCost(b));

export type ExactSolver = (N: number, terms: Cell[], walls: Set<string>, special: Map<string, Special>, portals: Record<string, Cell[]>, wrap?: boolean, wrapVertical?: boolean) => number;

// ---------------------------------------------------------------------------
// Board drafting helpers shared by every family.
// ---------------------------------------------------------------------------
function draft(N: number, int: (n: number) => number) {
  const walls = new Set<string>();
  const special = new Map<string, Special>();
  const portalPairs: Record<string, Cell[]> = {};
  const mid = (N - 1) / 2;
  const d = {
    N, mid, walls, special, portalPairs, int,
    // Chebyshev radius from the centre: how families talk about rings and bands.
    ring: ([r, c]: Cell) => Math.max(Math.abs(r - mid), Math.abs(c - mid)),
    inside: ([r, c]: Cell) => r >= 0 && c >= 0 && r < N && c < N,
    isWall: (cell: Cell) => walls.has(key(cell)),
    block(cell: Cell) {
      if (!d.inside(cell)) return;
      walls.add(key(cell)); special.delete(key(cell));
    },
    carve(cell: Cell) { walls.delete(key(cell)); },
    mark(cell: Cell, type: Special['type']) {
      if (d.inside(cell) && !walls.has(key(cell))) special.set(key(cell), { type });
    },
    plain: (cell: Cell) => !walls.has(key(cell)) && !special.has(key(cell)),
    all(test: (cell: Cell) => boolean) {
      const out: Cell[] = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (test([r, c])) out.push([r, c]);
      return out;
    },
    pick<T>(list: T[]): T | null { return list.length ? list[int(list.length)] : null; },
    shuffle<T>(list: T[]) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    },
    scatter(type: Special['type'], count: number, test: (cell: Cell) => boolean) {
      const pool = d.all(cell => d.plain(cell) && test(cell));
      for (let i = 0; i < count && pool.length; i++) d.mark(pool.splice(int(pool.length), 1)[0], type);
    },
  };
  return d;
}
type Draft = ReturnType<typeof draft>;
type Region = (cell: Cell) => boolean;

interface Family {
  kind: string;
  N: number;
  apart: number;   // minimum Manhattan gap between seeds
  spores: number;  // free cells sprinkled after the seeds land
  thorns: number;  // cost-three cells sprinkled after the seeds land
  rubble: number;  // loose stones that bend otherwise straight routes
  // Whether the seam ever makes sense here. Ring-shaped families say no: a
  // shortcut round the edge would undo the very thing they are built around.
  seam: boolean;
  minTarget: number;
  build: (d: Draft, wrap: boolean) => Region[] | null;
}

// Doorways are few and always priced — one free, the next costly — so every
// crossing is a decision that the rest of the network has to live with.
function priceDoors(d: Draft, doors: Cell[]) {
  const phase = d.int(2);
  doors.forEach((cell, i) => d.mark(cell, (i + phase) % 2 ? 'penalty' : 'bonus'));
}

const FAMILIES: Family[] = [
  {
    // Cheap seam crossings compete with interior junctions and a north/south
    // portal. These tolls use ordinary thorns: no extra symbol or hidden rule.
    kind: 'switchyard', N: 13, apart: 3, spores: 5, thorns: 5, rubble: 4, seam: true, minTarget: 28,
    build(d) {
      for (const c of [4, 8]) {
        const doors = [2 + d.int(3), 8 + d.int(3)];
        for (let r = 1; r < d.N - 1; r++) {
          if (doors.includes(r)) d.mark([r, c], 'penalty');
          else d.block([r, c]);
        }
        d.mark([doors[0], c], 'bonus');
      }
      for (let r = 0; r < d.N; r++) {
        d.mark([r, 0], 'penalty'); d.mark([r, d.N - 1], 'penalty');
      }
      for (const r of [2 + d.int(2), 9 + d.int(2)]) {
        d.mark([r, 0], 'bonus'); d.mark([r, d.N - 1], 'bonus');
      }
      const ends: Cell[] = [[1, 6], [11, 6]];
      d.portalPairs.A = ends;
      ends.forEach(cell => d.special.set(key(cell), { type: 'portal', pid: 'A' }));
      return [
        cell => cell[0] < 3 && cell[1] < 4,
        cell => cell[0] < 3 && cell[1] > 8,
        cell => cell[0] > 9 && cell[1] < 4,
        cell => cell[0] > 9 && cell[1] > 8,
        cell => cell[0] > 4 && cell[0] < 8 && cell[1] < 3,
        cell => cell[0] > 4 && cell[0] < 8 && cell[1] > 9,
        cell => d.ring(cell) <= 1,
      ];
    },
  },
  {
    // A single coil wound from the rim to the core, then punched through in
    // eight places. The holes turn one forced corridor into a web of laps.
    kind: 'spiral', N: 15, apart: 4, spores: 5, thorns: 10, rubble: 8, seam: false, minTarget: 36,
    build(d) {
      const arm: Cell[] = [];
      let top = 2, left = 2, bottom = d.N - 3, right = d.N - 3;
      while (bottom - top >= 2) {
        for (let c = left; c <= right; c++) arm.push([top, c]);
        for (let r = top + 1; r <= bottom; r++) arm.push([r, right]);
        for (let c = right - 1; c >= left; c--) arm.push([bottom, c]);
        for (let r = bottom - 1; r >= top + 2; r--) arm.push([r, left]);
        top += 2; left += 2; bottom -= 2; right -= 2;
      }
      arm.forEach(cell => d.block(cell));
      const stride = Math.floor(arm.length / 6), doors: Cell[] = [];
      for (let i = 0; i < 6; i++) {
        const cell = arm[i * stride + d.int(stride)];
        if (d.isWall(cell)) { d.carve(cell); doors.push(cell); }
      }
      priceDoors(d, doors);
      return [
        cell => d.ring(cell) === 0,
        cell => d.ring(cell) === 2 && cell[0] < d.mid,
        cell => d.ring(cell) === 2 && cell[0] > d.mid,
        cell => d.ring(cell) === 4 && cell[1] < d.mid,
        cell => d.ring(cell) >= 6 && cell[0] <= d.mid && cell[1] >= d.mid,
        cell => d.ring(cell) >= 6 && cell[0] > d.mid && cell[1] < d.mid,
      ];
    },
  },
  {
    // Sixteen square pillars leave a plaid of one-cell lanes. Two lanes each way
    // are bramble and one is clear moss, so the straightest route is rarely the
    // cheapest; a few dropped stones break the remaining symmetry.
    kind: 'pillars', N: 13, apart: 4, spores: 3, thorns: 5, rubble: 8, seam: true, minTarget: 36,
    build(d) {
      for (let r = 1; r < d.N - 1; r += 3) for (let c = 1; c < d.N - 1; c += 3)
        for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) d.block([r + dr, c + dc]);
      const rows = d.shuffle([0, 3, 6, 9, 12]), cols = d.shuffle([0, 3, 6, 9, 12]);
      const paint = (lane: number, axis: number, type: Special['type']) => {
        for (let i = 0; i < d.N; i++) d.mark(axis ? [i, lane] : [lane, i], type);
      };
      for (const axis of [0, 1]) {
        const lanes = axis ? cols : rows;
        paint(lanes[1], axis, 'penalty'); paint(lanes[2], axis, 'penalty');
      }
      // Clear lanes go last so their crossings stay free where they meet bramble.
      paint(rows[0], 0, 'bonus'); paint(cols[0], 1, 'bonus');
      return [
        cell => cell[0] < 4 && cell[1] < 4,
        cell => cell[0] < 4 && cell[1] > 8,
        cell => cell[0] > 8 && cell[1] < 4,
        cell => cell[0] > 8 && cell[1] > 8,
        cell => d.ring(cell) <= 1,
        cell => Math.abs(cell[0] - d.mid) <= 1 && cell[1] < 3,
        cell => Math.abs(cell[0] - d.mid) <= 1 && cell[1] > 9,
      ];
    },
  },
  {
    // Two closed rings with two doorways each, and the doorways of the inner
    // ring never face those of the outer one, so every crossing is a detour.
    kind: 'atoll', N: 15, apart: 4, spores: 7, thorns: 12, rubble: 6, seam: false, minTarget: 34,
    build(d) {
      const sides = d.shuffle([0, 1, 2, 3]);
      const doors: Cell[] = [];
      [5, 2].forEach((radius, r10) => {
        d.all(cell => d.ring(cell) === radius).forEach(cell => d.block(cell));
        for (const side of sides.slice(r10 * 2, r10 * 2 + 2)) {
          const off = d.mid - radius + 1 + d.int(2 * radius - 1);
          const cell: Cell = side === 0 ? [d.mid - radius, off] : side === 1 ? [d.mid + radius, off]
            : side === 2 ? [off, d.mid - radius] : [off, d.mid + radius];
          d.carve(cell); doors.push(cell);
        }
      });
      priceDoors(d, doors);
      return [
        cell => d.ring(cell) <= 1,
        cell => d.ring(cell) >= 3 && d.ring(cell) <= 4 && cell[0] < d.mid && cell[1] < d.mid,
        cell => d.ring(cell) >= 3 && d.ring(cell) <= 4 && cell[0] < d.mid && cell[1] > d.mid,
        cell => d.ring(cell) >= 3 && d.ring(cell) <= 4 && cell[0] > d.mid,
        cell => d.ring(cell) >= 6 && cell[0] < d.mid,
        cell => d.ring(cell) >= 6 && cell[0] > d.mid && cell[1] < d.mid,
        cell => d.ring(cell) >= 6 && cell[0] > d.mid && cell[1] > d.mid,
      ];
    },
  },
  {
    // Loose islands of rock in open water, stitched by one or two portal pairs. The
    // jumps are free; reaching them is not, and only some of them earn a detour.
    kind: 'archipelago', N: 15, apart: 4, spores: 8, thorns: 16, rubble: 0, seam: true, minTarget: 30,
    build(d, wrap) {
      for (let i = 0; i < 10; i++) {
        let cell: Cell = [1 + d.int(d.N - 2), 1 + d.int(d.N - 2)];
        for (let step = 4 + d.int(4); step > 0; step--) {
          d.block(cell);
          const [dr, dc] = directions[d.int(4)];
          const next: Cell = [cell[0] + dr, cell[1] + dc];
          if (!d.inside(next)) break;
          cell = next;
        }
      }
      const ports: Region[] = [
        cell => cell[0] < 4 && cell[1] < 4, cell => cell[0] > 10 && cell[1] > 10,
        cell => cell[0] < 4 && cell[1] > 10, cell => cell[0] > 10 && cell[1] < 4,
        cell => Math.abs(cell[0] - d.mid) <= 2 && cell[1] < 3,
        cell => Math.abs(cell[0] - d.mid) <= 2 && cell[1] > 11,
      ];
      for (const [i, pid] of (wrap ? ['A'] : ['A', 'B']).entries()) {
        const ends = [ports[i * 2], ports[i * 2 + 1]].map(zone => d.pick(d.all(cell => d.plain(cell) && zone(cell))));
        if (ends.some(cell => !cell)) return null;
        d.portalPairs[pid] = ends as Cell[];
        (ends as Cell[]).forEach(cell => d.special.set(key(cell), { type: 'portal', pid }));
      }
      return [
        cell => cell[0] < 4 && cell[1] < 5,
        cell => cell[0] < 4 && cell[1] > 9,
        cell => cell[0] > 10 && cell[1] < 5,
        cell => cell[0] > 10 && cell[1] > 9,
        cell => d.ring(cell) <= 2,
        cell => cell[0] > 4 && cell[0] < 10 && cell[1] < 3,
      ];
    },
  },
  {
    // No rock at all: broad diagonal bands of bramble, cut by four clean fords.
    // Crossing anywhere else costs six, so the puzzle is which fords to share.
    kind: 'brambles', N: 13, apart: 3, spores: 3, thorns: 0, rubble: 6, seam: true, minTarget: 28,
    build(d) {
      const phase = d.int(4);
      d.all(([r, c]) => (r + c + phase) % 4 < 2).forEach(cell => d.mark(cell, 'penalty'));
      const lanes: [number, number][] = [];
      for (let tries = 0; tries < 60 && lanes.length < 3; tries++) {
        const axis = d.int(2), line = 2 + d.int(d.N - 4);
        if (lanes.every(([a, x]) => a !== axis || Math.abs(x - line) >= 4)) lanes.push([axis, line]);
      }
      if (lanes.length < 3) return null;
      for (const [axis, line] of lanes) for (let i = 0; i < d.N; i++) {
        const cell: Cell = axis ? [i, line] : [line, i];
        if (d.special.has(key(cell))) d.mark(cell, 'bonus');
      }
      return [
        cell => cell[0] < 3 && cell[1] < 3,
        cell => cell[0] < 3 && cell[1] > 9,
        cell => cell[0] > 9 && cell[1] < 3,
        cell => cell[0] > 9 && cell[1] > 9,
        cell => cell[0] < 2 && cell[1] > 4 && cell[1] < 8,
        cell => cell[0] > 10 && cell[1] > 4 && cell[1] < 8,
        cell => cell[1] < 2 && cell[0] > 4 && cell[0] < 8,
        cell => cell[1] > 10 && cell[0] > 4 && cell[0] < 8,
      ];
    },
  },
  {
    // A great rock cross splits the board into four wedges. The ring road round
    // the rim is solid bramble, so the four doorways carry the whole network.
    kind: 'saltire', N: 13, apart: 3, spores: 5, thorns: 6, rubble: 5, seam: true, minTarget: 30,
    build(d) {
      const arms: Cell[] = [];
      for (let i = 1; i < d.N - 1; i++) { arms.push([i, i], [i, d.N - 1 - i]); }
      arms.forEach(cell => d.block(cell));
      for (let i = 0; i < d.N; i++)
        for (const cell of [[0, i], [d.N - 1, i], [i, 0], [i, d.N - 1]] as Cell[]) d.mark(cell, 'penalty');
      const doors: Cell[] = [];
      for (const cell of d.shuffle(arms.slice())) {
        if (doors.length === 3) break;
        if (doors.every(x => Math.abs(x[0] - cell[0]) + Math.abs(x[1] - cell[1]) >= 4)) {
          d.carve(cell); doors.push(cell);
        }
      }
      // A hole at the crossing links all four wedges at once — for a price.
      if (d.int(2)) { d.carve([d.mid, d.mid]); d.mark([d.mid, d.mid], 'penalty'); }
      priceDoors(d, doors);
      return [
        cell => cell[0] < cell[1] && cell[0] < d.N - 1 - cell[1] && cell[1] < d.mid,
        cell => cell[0] < cell[1] && cell[0] < d.N - 1 - cell[1] && cell[1] > d.mid,
        cell => cell[0] > cell[1] && cell[0] > d.N - 1 - cell[1] && cell[1] < d.mid,
        cell => cell[0] > cell[1] && cell[0] > d.N - 1 - cell[1] && cell[1] > d.mid,
        cell => cell[1] < cell[0] && cell[1] < d.N - 1 - cell[0],
        cell => cell[1] > cell[0] && cell[1] > d.N - 1 - cell[0],
      ];
    },
  },
  {
    // Nine walled chambers with exactly one doorway per wall. Eight seeds sit in
    // the outer chambers; the empty middle hall is the obvious trunk, and often
    // the wrong one.
    kind: 'vaults', N: 13, apart: 3, spores: 5, thorns: 9, rubble: 9, seam: true, minTarget: 30,
    build(d) {
      const cuts = [3, 9], spans: [number, number][] = [[0, 2], [4, 8], [10, 12]];
      for (const x of cuts) for (let i = 0; i < d.N; i++) { d.block([x, i]); d.block([i, x]); }
      // Outer segments always get a doorway, so no chamber is ever sealed. The
      // middle hall gets exactly two, which makes it a shortcut worth fighting
      // over rather than the free trunk it would be with a door on every side.
      const doors: Cell[] = [];
      const walls: [number, number][] = [];
      for (const x of cuts) for (const axis of [0, 1]) {
        walls.push([x, axis]);
        for (const [a, z] of [spans[0], spans[2]]) {
          const off = a + d.int(z - a + 1);
          const door: Cell = axis ? [off, x] : [x, off];
          d.carve(door); doors.push(door);
        }
      }
      for (const [x, axis] of walls) {
        const off = spans[1][0] + d.int(spans[1][1] - spans[1][0] + 1);
        const door: Cell = axis ? [off, x] : [x, off];
        d.carve(door); doors.push(door);
      }
      priceDoors(d, d.shuffle(doors));
      const rooms: Region[] = [];
      for (const [r0, r1] of spans) for (const [c0, c1] of spans)
        if (!(r0 === 4 && c0 === 4)) rooms.push(cell =>
          cell[0] >= r0 && cell[0] <= r1 && cell[1] >= c0 && cell[1] <= c1);
      return rooms;
    },
  },
];

export const STEINER_FAMILIES = FAMILIES.map(family => family.kind);

// A board plus the stones the search is still allowed to move.
interface Sketch { b: SteinerBoard; loose: string[] }

function candidate(seed: string, family: Family, wantsWrap?: boolean, wrapVertical = false): Sketch | null {
  const rng = random(seed);
  const int = (n: number) => Math.floor(rng() * n);
  const d = draft(family.N, int);
  // Decided before anything is drawn, so the seam is part of the puzzle rather
  // than an afterthought bolted onto a board that was laid out without it.
  const wrap = family.seam && (wantsWrap ?? int(4) !== 0);
  const regions = family.build(d, wrap);
  if (!regions) return null;
  // Loose stones never land on a doorway or portal, which are always priced.
  const loose: string[] = [];
  for (let i = 0; i < family.rubble; i++) {
    const stone = d.pick(d.all(cell => d.plain(cell) && d.ring(cell) > 0));
    if (stone) { d.block(stone); loose.push(key(stone)); }
  }
  // One seed per region keeps them spread across the family's structure.
  const terms: Cell[] = [];
  for (const region of regions) {
    // A seed burns away whatever spore or thorn shared its cell; portals stay put.
    const choices = d.all(cell => !d.isWall(cell) && d.special.get(key(cell))?.type !== 'portal' &&
      region(cell) && terms.every(t => {
        const dc = Math.abs(t[1] - cell[1]);
        const dr = Math.abs(t[0] - cell[0]);
        return (wrapVertical ? Math.min(dr, d.N - dr) : dr) + (wrap ? Math.min(dc, d.N - dc) : dc) >= family.apart;
      }));
    if (!choices.length) return null;
    const spot = choices[int(choices.length)];
    d.special.delete(key(spot));
    terms.push(spot);
  }
  const termSet = new Set(terms.map(key));
  const bare = (cell: Cell) => !termSet.has(key(cell));
  d.scatter('penalty', family.thorns, bare);
  d.scatter('bonus', family.spores, bare);
  const b: SteinerBoard = {
    N: family.N, terms, termSet, walls: d.walls, special: d.special,
    portalPairs: d.portalPairs, wrap, wrapVertical, kind: family.kind, target: 0,
  };
  return linked(b) ? { b, loose } : null;
}

// Every seed reachable from the first one across open ground and portals.
function linked(b: SteinerBoard) {
  const { adjacent, terminals } = boardGraph(b);
  const seen = new Set([terminals[0]]), queue = [terminals[0]];
  for (const u of queue) for (const v of adjacent[u]) if (!seen.has(v)) { seen.add(v); queue.push(v); }
  return terminals.every(t => seen.has(t));
}

// Local search on the cost field: move, re-price, add or drop one spore or
// thorn at a time, keeping every nudge that does not narrow the gap between the
// target and the naive strategies. Walking plateaus matters as much as climbing:
// most single changes are neutral. Rock never moves, so the family's silhouette
// survives untouched.
function sharpen(b: SteinerBoard, loose: string[], solve: ExactSolver, seed: string, fuel: { left: number }, minTarget: number) {
  const rng = random(seed);
  const int = (n: number) => Math.floor(rng() * n);
  const vacant = () => {
    for (let tries = 0; tries < 40; tries++) {
      const k = key([int(b.N), int(b.N)]);
      if (!b.walls.has(k) && !b.termSet.has(k) && !b.special.has(k)) return k;
    }
    return null;
  };
  const measure = () => {
    const optimum = solve(b.N, b.terms, b.walls, b.special, b.portalPairs, b.wrap, b.wrapVertical);
    return { optimum, gap: naiveNetworkCost(b) - optimum };
  };
  let gap = measure().gap;
  let peak = gap, keep = new Map(b.special), keepTarget = b.target, keepWalls = new Set(b.walls);
  for (; fuel.left > 0; fuel.left--) {
    // Shifting a loose stone rewires the routes themselves, which shakes far
    // more boards loose than re-costing ground ever does.
    if (loose.length && int(3) === 0) {
      const i = int(loose.length), from = loose[i], spot = vacant();
      if (!spot) continue;
      b.walls.delete(from); b.walls.add(spot); loose[i] = spot;
      const optimum = linked(b) ? solve(b.N, b.terms, b.walls, b.special, b.portalPairs, b.wrap, b.wrapVertical) : NaN;
      const next = Number.isFinite(optimum) ? naiveNetworkCost(b) - optimum : -Infinity;
      if (Number.isFinite(optimum) && optimum >= minTarget && next >= gap) {
        gap = next; b.target = optimum;
        if (gap > peak) { peak = gap; keep = new Map(b.special); keepTarget = optimum; keepWalls = new Set(b.walls); }
      } else { b.walls.delete(spot); b.walls.add(from); loose[i] = from; }
      continue;
    }
    const cells = [...b.special.keys()].filter(k => b.special.get(k)!.type !== 'portal');
    const move = int(4);
    let undo: (() => void) | null = null;
    if (move === 3 || !cells.length) {
      const spot = vacant();
      if (spot) {
        b.special.set(spot, { type: int(2) ? 'bonus' : 'penalty' });
        undo = () => b.special.delete(spot);
      }
    } else {
      const from = cells[int(cells.length)], was = b.special.get(from)!;
      b.special.delete(from);
      undo = () => { b.special.delete(from); b.special.set(from, was); };
      if (move === 0) {
        const spot = vacant();
        if (spot) {
          b.special.set(spot, was);
          undo = () => { b.special.delete(spot); b.special.set(from, was); };
        } else undo();
      } else if (move === 1) {
        b.special.set(from, { type: was.type === 'bonus' ? 'penalty' : 'bonus' });
      }
      // move === 2 simply drops the cell back to ordinary ground.
    }
    if (!undo) continue;
    const { optimum, gap: next } = measure();
    if (!Number.isFinite(optimum) || optimum < minTarget || next < gap) { undo(); continue; }
    gap = next; b.target = optimum;
    if (gap > peak) { peak = gap; keep = new Map(b.special); keepTarget = optimum; keepWalls = new Set(b.walls); }
  }
  if (peak > gap) {
    b.special.clear();
    for (const [k, v] of keep) b.special.set(k, v);
    b.walls.clear();
    for (const k of keepWalls) b.walls.add(k);
    b.target = keepTarget;
  }
  return peak;
}

const cache = new Map<string, SteinerBoard>();

// One day's whole search is capped, so a stubborn architecture costs the player
// no more waiting than a cooperative one. Scouting spells are short: it is
// cheaper to glance at eight boards than to grind one that will not yield.
const SEARCH_FUEL = 130, SCOUT_SPELL = 14;

function minimumTarget(b: SteinerBoard, family: Family) {
  return Math.max(b.wrapVertical ? 24 : 28, family.minTarget - (b.wrapVertical ? 8 : b.wrap ? 4 : 0));
}

function forge(sketch: Sketch, family: Family, solve: ExactSolver, seed: string,
    fuel: { left: number }, length: number): number {
  const b = sketch.b;
  const minTarget = minimumTarget(b, family);
  b.target = solve(b.N, b.terms, b.walls, b.special, b.portalPairs, b.wrap, b.wrapVertical);
  if (!Number.isFinite(b.target) || b.target < minTarget) return -Infinity;
  const spell = { left: Math.min(length, fuel.left) };
  const spent = spell.left;
  const gap = sharpen(b, sketch.loose, solve, seed, spell, minTarget);
  fuel.left -= spent - spell.left;
  return gap;
}

// Every naive line of play must overspend by at least this much; once one
// overspends by the second figure the day's search stops looking.
export const STEINER_MIN_GAP = 2;
const STEINER_GOOD_GAP = 3;

const spares = new Map<string, SteinerBoard>();
// A verified challenge is safer than an easy open-grid fallback or a blank app.
export function fallbackSteiner(solve: ExactSolver, wrap = false, wrapVertical = false): SteinerBoard {
  const topology = `${wrap}|${wrapVertical}`;
  if (spares.has(topology)) return spares.get(topology)!;
  let spare: SteinerBoard | null = null;
  let backup: SteinerBoard | null = null;
  const pool = wrap ? FAMILIES.filter(f => f.seam) : FAMILIES;
  for (let attempt = 0; attempt < 40 && !spare; attempt++) {
    const family = pool[attempt % pool.length];
    const seed = `${STEINER_REVISION}|spare|${attempt}`;
    const sketch = candidate(seed, family, wrap, wrapVertical);
    if (!sketch) continue;
    const gap = forge(sketch, family, solve, seed, { left: SEARCH_FUEL }, SEARCH_FUEL);
    if (gap >= STEINER_GOOD_GAP) spare = sketch.b;
    else if (gap >= STEINER_MIN_GAP && !backup) backup = sketch.b;
  }
  const chosen = spare || backup;
  if (!chosen) throw new Error('No verified Steiner fallback for this topology');
  spares.set(topology, chosen);
  return chosen;
}

// Separate seed keeps topology independent of board-search retries and layout choices.
export function topologyForDate(date: string) {
  const rng = random(`${STEINER_REVISION}|topology|${date}`);
  const wrap = rng() < 0.4;
  const wrapVertical = rng() < 0.5 && wrap;
  return { wrap, wrapVertical };
}

export function generateSteiner(date: string, solve: ExactSolver): SteinerBoard {
  if (cache.has(date)) return cache.get(date)!;
  const rng = random(`${STEINER_REVISION}|${date}`);
  // Decide topology per day, before screening, so easier-to-forge flat boards
  // cannot silently crowd wrapping boards out of the published pool.
  const { wrap: wantsWrap, wrapVertical } = topologyForDate(date);
  const pool = wantsWrap ? FAMILIES.filter(f => f.seam) : FAMILIES;
  const first = Math.floor(rng() * pool.length);
  const fuel = { left: SEARCH_FUEL };
  let pick: Sketch | null = null, pickFamily: Family | null = null, gap = -Infinity;
  for (let attempt = 0; attempt < 8 && fuel.left > 0; attempt++) {
    // Four looks at the day's own architecture, then the neighbouring ones.
    const family = pool[attempt < 4 ? first : (first + 1 + attempt - 4) % pool.length];
    const seed = `${STEINER_REVISION}|${date}|${attempt}`;
    const sketch = candidate(seed, family, wantsWrap, wrapVertical);
    if (!sketch) continue;
    const found = forge(sketch, family, solve, seed, fuel, SCOUT_SPELL);
    if (found <= gap) continue;
    gap = found; pick = sketch; pickFamily = family;
    if (gap >= STEINER_GOOD_GAP) break;
  }
  // Whatever fuel the scouting left goes into the most promising board.
  if (pick && gap < STEINER_GOOD_GAP && fuel.left > 0)
    gap = sharpen(pick.b, pick.loose, solve, `${STEINER_REVISION}|${date}|hone`, fuel,
      minimumTarget(pick.b, pickFamily!));
  // Never hand out the best failed draft: restart with a different architecture
  // and a small bounded search until a board actually clears the difficulty bar.
  for (let retry = 0; gap < STEINER_MIN_GAP && retry < 64; retry++) {
    const family = pool[(first + retry) % pool.length];
    const seed = `${STEINER_REVISION}|${date}|retry|${retry}`;
    const sketch = candidate(seed, family, wantsWrap, wrapVertical);
    if (!sketch) continue;
    const found = forge(sketch, family, solve, seed, { left: SCOUT_SPELL }, SCOUT_SPELL);
    if (found > gap) { gap = found; pick = sketch; }
  }
  const chosen = pick && gap >= STEINER_MIN_GAP ? pick.b : fallbackSteiner(solve, wantsWrap, wrapVertical);
  cache.set(date, chosen);
  return chosen;
}
