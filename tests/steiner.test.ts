import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import {
  generateSteiner, fallbackSteiner, greedyNetworkCost, spanningNetworkCost, boardGraph,
  STEINER_FAMILIES, STEINER_MIN_GAP,
} from '../src/steiner-levels.ts';
import type { SteinerBoard } from '../src/steiner-levels.ts';
import { solveSteinerExact } from '../src/steiner-solver.ts';

const fingerprint = (b: SteinerBoard) => JSON.stringify({
  N: b.N, terms: b.terms, walls: [...b.walls], special: [...b.special],
  portals: b.portalPairs, wrap: b.wrap, target: b.target, kind: b.kind,
});

// Independent exhaustive enumeration: no shared graph builder or solver logic.
function bruteForce(N: number, terms: number[][], walls: Set<string>,
    special: Map<string, { type: string }>, portals: Record<string, number[][]>, wrap?: boolean) {
  const keys = terms.map(p => p.join(','));
  const optional: string[] = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const key = [r, c].join(',');
    if (!walls.has(key) && !keys.includes(key)) optional.push(key);
  }
  let best = Infinity;
  for (let mask = 0; mask < 2 ** optional.length; mask++) {
    const network = new Set(keys);
    let cost = 0;
    optional.forEach((key, i) => {
      if (mask & (1 << i)) {
        network.add(key);
        cost += special.get(key)?.type === 'bonus' ? 0 : special.get(key)?.type === 'penalty' ? 3 : 1;
      }
    });
    if (cost >= best) continue;
    const seen = new Set([keys[0]]), queue = [keys[0]];
    for (const key of queue) {
      const [r, c] = key.split(',').map(Number);
      const sideways = wrap ? [[r, (c + 1) % N], [r, (c + N - 1) % N]] : [[r, c + 1], [r, c - 1]];
      const neighbors = [[r + 1, c], [r - 1, c], ...sideways].map(p => p.join(','));
      for (const pair of Object.values(portals)) {
        const [a, b] = pair.map(p => p.join(','));
        if (key === a) neighbors.push(b);
        if (key === b) neighbors.push(a);
      }
      for (const v of neighbors) if (network.has(v) && !seen.has(v)) { seen.add(v); queue.push(v); }
    }
    if (keys.every(k => seen.has(k))) best = cost;
  }
  return Number.isFinite(best) ? best : NaN;
}

// The solver prunes against a heuristic upper bound, so this has to cover boards
// where that bound is loose as well as tight.
test('exact target matches exhaustive search with walls, free cells, thorns and portals', () => {
  for (let seed = 0; seed < 160; seed++) {
    const N = seed % 4 === 0 ? 4 : 3;
    const terms = N === 4 ? [[0, 0], [0, 3], [3, 3]] : [[0, 0], [0, 2], [2, 2]];
    const walls = new Set<string>();
    const special = new Map<string, { type: string }>();
    const portals: Record<string, number[][]> = seed % 3 === 0 ? { A: [[1, 0], [2, 1]] } : {};
    const wrap = seed % 5 < 2;
    let state = seed + 1;
    const roll = () => { state = Math.imul(state, 1664525) + 1013904223; return (state >>> 16) % 4; };
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const key = r + ',' + c;
      if (terms.some(t => t.join(',') === key)) continue;
      if (Object.values(portals).some(pair => pair.some(p => p.join(',') === key))) continue;
      const value = roll();
      if (value === 0) walls.add(key);
      if (value === 1) special.set(key, { type: 'bonus' });
      if (value === 2) special.set(key, { type: 'penalty' });
    }
    for (const pair of Object.values(portals)) for (const p of pair) special.set(p.join(','), { type: 'portal' });
    assert.equal(solveSteinerExact(N, terms, walls, special, portals, wrap),
      bruteForce(N, terms, walls, special, portals, wrap), 'case ' + seed);
  }
});

const naiveGap = (b: SteinerBoard) =>
  Math.min(greedyNetworkCost(b), spanningNetworkCost(b)) - b.target;

test('wrap joins only left/right neighbors and never crosses a wall', () => {
  const horizontal = [[1, 0], [1, 2]];
  assert.equal(solveSteinerExact(3, horizontal, new Set(), new Map(), {}, true), 0);
  assert.equal(solveSteinerExact(3, horizontal, new Set(), new Map(), {}, false), 1);
  assert.equal(solveSteinerExact(3, [[0, 1], [2, 1]], new Set(), new Map(), {}, true), 1);
  const b: SteinerBoard = {
    N: 3, terms: [[0, 0], [2, 2]], termSet: new Set(['0,0', '2,2']),
    walls: new Set(['1,2']), special: new Map(), portalPairs: {}, wrap: true, target: 0, kind: 'test',
  };
  const graph = boardGraph(b);
  const index = (r: number, c: number) => graph.cells.findIndex(p => p[0] === r && p[1] === c);
  assert(graph.adjacent[index(0, 0)].includes(index(0, 2)));
  assert(!graph.adjacent[index(0, 0)].includes(index(2, 0)));
  assert.deepEqual(graph.adjacent[index(1, 0)].sort(), [index(0, 0), index(2, 0), index(1, 1)].sort());
});

// A wrapping row's two ends are neighbours, so a wall built to divide the board
// only divides it if the seam does not quietly reconnect the two halves.
function seamIsLive(b: SteinerBoard) {
  const open = (r: number, c: number) => !b.walls.has([r, c].join(','));
  for (let r = 0; r < b.N; r++) if (open(r, 0) && open(r, b.N - 1)) return true;
  return false;
}

function assertChallenge(b: SteinerBoard) {
  assert(b.N === 13 || b.N === 15, 'board size ' + b.N);
  assert(b.terms.length >= 4, 'every level needs at least four seeds');
  assert.equal(b.termSet.size, b.terms.length, 'seeds must not overlap');
  assert(STEINER_FAMILIES.includes(b.kind), 'unknown family ' + b.kind);
  assert(Number.isFinite(b.target) && b.target >= 28, 'target ' + b.target);
  for (const [r, c] of b.terms) {
    assert(r >= 0 && c >= 0 && r < b.N && c < b.N);
    assert(!b.walls.has([r, c].join(',')));
    assert(!b.special.has([r, c].join(',')));
  }
  for (const key of b.special.keys()) assert(!b.walls.has(key));
  for (const [pid, pair] of Object.entries(b.portalPairs)) {
    assert.equal(pair.length, 2);
    for (const p of pair) assert.deepEqual(b.special.get(p.join(',')), { type: 'portal', pid });
  }
  // The local search rewrites walls and terrain as it goes; the stored target
  // has to still be the optimum for the board it finally hands over.
  assert.equal(typeof b.wrap, 'boolean');
  if (b.wrap) assert(seamIsLive(b), 'a wrapping board needs at least one open seam row');
  assert.equal(b.target, solveSteinerExact(b.N, b.terms, b.walls, b.special, b.portalPairs, b.wrap));
  assert(naiveGap(b) >= STEINER_MIN_GAP, 'every board must meet its difficulty threshold');
}

test('the safety fallback is itself a verified challenge', () => {
  for (const wrap of [false, true]) {
    const b = fallbackSteiner(solveSteinerExact, wrap);
    assertChallenge(b);
    assert.equal(b.wrap, wrap, 'fallback must preserve the scheduled topology');
    assert(naiveGap(b) >= STEINER_MIN_GAP);
  }
});

test('all 90 archive days are valid, challenging and varied', () => {
  const kinds = new Map<string, number>(), unique = new Set<string>();
  const gaps: number[] = [], seeds = new Set<number>(), sizes = new Set<number>();
  let wrapped = 0;
  let maxMs = 0;
  for (let day = 0; day < 90; day++) {
    const date = new Date(Date.UTC(2026, 8, 8 - day)).toISOString().slice(0, 10);
    const start = performance.now();
    const b = generateSteiner(date, solveSteinerExact);
    maxMs = Math.max(maxMs, performance.now() - start);
    assertChallenge(b);
    kinds.set(b.kind, (kinds.get(b.kind) || 0) + 1);
    unique.add(fingerprint(b));
    gaps.push(naiveGap(b));
    seeds.add(b.terms.length); sizes.add(b.N);
    if (b.wrap) wrapped++;
    assert.equal(fingerprint(generateSteiner(date, solveSteinerExact)), fingerprint(b));
  }
  console.log({ kinds: [...kinds], unique: unique.size, wrapped, minGap: Math.min(...gaps), maxMs });
  assert.equal(kinds.size, STEINER_FAMILIES.length, 'every family should show up in 90 days');
  assert.equal(unique.size, 90, 'no day may reuse another day\'s board');
  assert(seeds.size >= 3 && Math.min(...seeds) >= 4, 'seed counts should vary and never drop below four');
  assert.equal(sizes.size, 2, 'both board sizes should appear');
  assert.equal(wrapped, 45, 'exactly half of the archive should wrap');
  // Both naive strategies must overspend on every daily board.
  const hard = gaps.filter(gap => gap >= STEINER_MIN_GAP).length;
  assert.equal(hard, 90, 'every day must beat both naive strategies by ' + STEINER_MIN_GAP);
  const median = gaps.slice().sort((a, z) => a - z)[45];
  assert(median >= STEINER_MIN_GAP + 1, 'median naive overspend ' + median);
  console.log('Archive: ' + unique.size + ' distinct boards, ' + kinds.size + ' families ('
    + [...kinds].map(([k, n]) => k + ' ' + n).join(', ') + '); ' + wrapped + ' wrap; median overspend '
    + median + '; slowest generation ' + Math.round(maxMs) + ' ms');
});

test('minification leaves daily boards unchanged', async () => {
  const result = await build({
    configFile: false, logLevel: 'silent',
    build: {
      write: false, minify: true,
      lib: { entry: 'src/steiner-levels.ts', formats: ['es'] },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const chunk = output.find(item => item.type === 'chunk')!;
  const compiled = await import('data:text/javascript;base64,' + Buffer.from(chunk.code).toString('base64'));
  for (const date of ['2026-09-08', '2026-09-07', '2026-09-06', '2026-09-04', '2026-08-16']) {
    assert.equal(fingerprint(compiled.generateSteiner(date, solveSteinerExact)),
      fingerprint(generateSteiner(date, solveSteinerExact)));
  }
});
