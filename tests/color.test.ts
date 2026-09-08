import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import {
  generateColorGraph, chromaticNumber, isConnected, countColourings, COLOR_FAMILIES,
} from '../src/color-levels.ts';
import type { ColorGraph } from '../src/color-levels.ts';

const fingerprint = (g: ColorGraph) => JSON.stringify({
  kind: g.kind, n: g.n, chi: g.chi,
  edges: g.edges.map(([u, v]) => (u < v ? [u, v] : [v, u])).sort(),
  pos: g.pos.map(p => p.map(x => Math.round(x * 100))),
  labels: g.labels || null, locked: g.locked || null, clauses: g.clauses || null,
});

// Independent greedy check: any colouring the solver claims exists must exist.
function canColorWith(g: ColorGraph, k: number) {
  const adj: number[][] = Array.from({ length: g.n }, () => []);
  g.edges.forEach(([u, v]) => { adj[u].push(v); adj[v].push(u); });
  const paint = new Array(g.n).fill(-1);
  const step = (v: number): boolean => {
    if (v === g.n) return true;
    for (let c = 0; c < k; c++) {
      if (adj[v].some(w => paint[w] === c)) continue;
      paint[v] = c;
      if (step(v + 1)) return true;
      paint[v] = -1;
    }
    return false;
  };
  return step(0);
}

// Independent count: every assignment, keeping proper ones that use exactly k
// colours, then dividing out the k! ways of renaming the colours.
function bruteCount(n: number, edges: number[][], k: number) {
  const factorial = (m: number): number => (m <= 1 ? 1 : m * factorial(m - 1));
  const paint = new Array(n).fill(0);
  let total = 0;
  const step = (i: number) => {
    if (i === n) {
      if (new Set(paint).size !== k) return;
      if (edges.some(([u, v]) => paint[u] === paint[v])) return;
      total++;
      return;
    }
    for (let c = 0; c < k; c++) { paint[i] = c; step(i + 1); }
  };
  step(0);
  return total / factorial(k);
}

test('the colouring count agrees with brute force and ignores colour swaps', () => {
  // Brute force costs k^n, so keep the graphs small and lean on volume instead.
  for (let seed = 1; seed <= 80; seed++) {
    const n = 4 + (seed % 3);
    let state = seed;
    const roll = () => { state = Math.imul(state, 1664525) + 1013904223; return (state >>> 16) % 100; };
    const edges: number[][] = [];
    for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) if (roll() < 40) edges.push([u, v]);
    for (let k = 1; k <= n; k++) {
      assert.equal(countColourings(n, edges, k).count, bruteCount(n, edges, k),
        'seed ' + seed + ' with ' + k + ' colours');
    }
  }
  // Hand-worked shapes.
  const k4 = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  assert.equal(countColourings(4, k4, 4).count, 1, 'K4 has one 4-colouring up to swaps');
  assert.equal(countColourings(4, k4, 3).count, 0, 'K4 cannot be 3-coloured');
  assert.equal(countColourings(5, [], 1).count, 1, 'five loose dots, all one colour');
  assert.equal(countColourings(3, [[0, 1], [1, 2]], 2).count, 1, 'a path splits one way');
  // Below the chromatic number there is nothing to count.
  assert.equal(countColourings(3, [[0, 1], [1, 2], [0, 2]], 2).count, 0);
});

test('every daily graph has a countable bonus answer', () => {
  let biggest = 0, slowest = 0;
  for (let day = 0; day < 90; day++) {
    const date = new Date(Date.UTC(2026, 8, 8 - day)).toISOString().slice(0, 10);
    const g = generateColorGraph(date, stubSudoku);
    if (g.kind === 'sudoku') continue;   // 36 dots: the answer is not worth guessing
    const start = performance.now();
    const { count, capped } = countColourings(g.n, g.edges, g.chi);
    slowest = Math.max(slowest, performance.now() - start);
    // The palette opens at chi, so this is the number players actually face.
    assert(!capped, date + ' overruns the counting cap at its opening palette');
    assert(count > 0, date + ' claims an optimum it cannot achieve');
    biggest = Math.max(biggest, count);
  }
  assert(slowest < 250, 'slowest count took ' + Math.round(slowest) + 'ms');
  console.log('Bonus count: largest daily answer ' + biggest
    + ', slowest ' + Math.round(slowest) + ' ms');
});

test('the chromatic number agrees with brute-force search on small graphs', () => {
  for (let seed = 0; seed < 200; seed++) {
    const n = 5 + (seed % 4);
    let state = seed + 1;
    const roll = () => { state = Math.imul(state, 1664525) + 1013904223; return (state >>> 16) % 100; };
    const edges: [number, number][] = [];
    for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) if (roll() < 45) edges.push([u, v]);
    if (!isConnected(n, edges)) continue;
    const chi = chromaticNumber(n, edges);
    const g = { n, edges, pos: [], chi, kind: 'test' } as ColorGraph;
    assert(canColorWith(g, chi), 'claimed ' + chi + ' colours but none exists, case ' + seed);
    assert(!canColorWith(g, chi - 1), 'chi ' + chi + ' is not minimal, case ' + seed);
  }
});

// A stand-in for the host's sudoku board: same shape and the same handful of
// extra rivalries, but none of the digit machinery.
function stubSudoku(rng: () => number): ColorGraph {
  const n = 36, edges: [number, number][] = [];
  const at = (r: number, c: number) => r * 6 + c;
  const seen = new Set<string>();
  const link = (u: number, v: number) => {
    const key = u < v ? u + '-' + v : v + '-' + u;
    if (u === v || seen.has(key)) return;
    seen.add(key); edges.push([u, v]);
  };
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    for (let k = c + 1; k < 6; k++) link(at(r, c), at(r, k));
    for (let k = r + 1; k < 6; k++) link(at(r, c), at(k, c));
  }
  for (let i = 0; i < 4; i++) {
    const u = Math.floor(rng() * 36), v = Math.floor(rng() * 36);
    if (Math.floor(u / 6) !== Math.floor(v / 6) && u % 6 !== v % 6) link(u, v);
  }
  const pos = [...Array(36).keys()].map(i => [42 + (i % 6) * 51.2, 42 + Math.floor(i / 6) * 51.2] as [number, number]);
  return { n, edges, pos, chi: 6, kind: 'sudoku', hideEdges: true };
}

function assertChallenge(g: ColorGraph) {
  assert(COLOR_FAMILIES.includes(g.kind), 'unknown family ' + g.kind);
  assert.equal(g.pos.length, g.n, 'every vertex needs a position');
  assert(isConnected(g.n, g.edges), 'graph must be connected');
  for (const [u, v] of g.edges) {
    assert(u !== v && u >= 0 && v >= 0 && u < g.n && v < g.n, 'bad edge ' + u + '-' + v);
  }
  const seen = new Set(g.edges.map(([u, v]) => (u < v ? u + '-' + v : v + '-' + u)));
  assert.equal(seen.size, g.edges.length, 'duplicate edges');
  if (g.kind === 'sudoku') { assert.equal(g.chi, 6); return; }
  assert(g.n >= 9 && g.n <= 20, 'vertex count ' + g.n);
  // The whole puzzle is finding an optimal colouring, so the stated optimum has
  // to be exactly right — too low is unsolvable, too high is a giveaway.
  assert.equal(g.chi, chromaticNumber(g.n, g.edges), g.kind + ' states the wrong optimum');
  assert(g.chi >= 3 && g.chi <= 4, g.kind + ' optimum ' + g.chi);
  // Every layout has to fit the drawing box with room for the vertex circles.
  for (const [x, y] of g.pos) assert(x >= 20 && x <= 320 && y >= 20 && y <= 320, 'vertex off-canvas');
  for (let i = 0; i < g.n; i++) for (let j = i + 1; j < g.n; j++)
    assert(Math.hypot(g.pos[i][0] - g.pos[j][0], g.pos[i][1] - g.pos[j][1]) >= 44,
      g.kind + ' draws two vertices on top of each other');
}

test('the triangle-free family really has no triangles and still needs four colours', () => {
  let found = 0;
  for (let day = 0; day < 200; day++) {
    const date = new Date(Date.UTC(2026, 8, 8 - day)).toISOString().slice(0, 10);
    const g = generateColorGraph(date, stubSudoku);
    if (g.kind !== 'triangle-free') continue;
    found++;
    const adj: Set<number>[] = Array.from({ length: g.n }, () => new Set<number>());
    g.edges.forEach(([u, v]) => { adj[u].add(v); adj[v].add(u); });
    for (const [u, v] of g.edges) for (const w of adj[u])
      assert(!adj[v].has(w), 'triangle ' + u + '-' + v + '-' + w + ' on ' + date);
    assert.equal(g.chi, 4);
  }
  assert(found >= 10, 'only ' + found + ' triangle-free days in 200');
});

test('the sat reduction is solvable exactly when its formula is', () => {
  for (let day = 0; day < 200; day++) {
    const date = new Date(Date.UTC(2026, 8, 8 - day)).toISOString().slice(0, 10);
    const g = generateColorGraph(date, stubSudoku);
    if (g.kind !== 'sat reduction') continue;
    assert.equal(g.chi, 3);
    assert.equal(g.clauses!.length, 2);
    for (const clause of g.clauses!) {
      assert.equal(clause.length, 3);
      // A clause containing a variable and its negation would be free to satisfy.
      const bare = clause.map(name => name.replace('!', ''));
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++)
        assert(!(bare[i] === bare[j] && clause[i] !== clause[j]), 'tautological clause on ' + date);
    }
    // Three colours must genuinely suffice, and the locked palette must survive.
    assert(canColorWith(g, 3), 'unsatisfiable gadget on ' + date);
    assert.deepEqual(g.locked!.slice(0, 3), [0, 1, 2]);
    assert(g.locked!.slice(3).every(v => v === -1));
  }
});

test('all 90 archive days are valid, challenging and varied', () => {
  const kinds = new Map<string, number>(), unique = new Set<string>();
  const sizes = new Set<number>();
  let maxMs = 0;
  for (let day = 0; day < 90; day++) {
    const date = new Date(Date.UTC(2026, 8, 8 - day)).toISOString().slice(0, 10);
    const start = performance.now();
    const g = generateColorGraph(date, stubSudoku);
    maxMs = Math.max(maxMs, performance.now() - start);
    assertChallenge(g);
    kinds.set(g.kind, (kinds.get(g.kind) || 0) + 1);
    unique.add(fingerprint(g));
    sizes.add(g.n);
    assert.equal(fingerprint(generateColorGraph(date, stubSudoku)), fingerprint(g));
  }
  assert.equal(kinds.size, COLOR_FAMILIES.length, 'every family should show up in 90 days');
  assert(unique.size >= 89, 'days should not reuse each other\'s graphs');
  assert(sizes.size >= 5, 'graph sizes should vary across the archive');
  // Four colours is the hard case; three only shows up where the family means it.
  const four = [...kinds].filter(([kind]) => kind !== 'sat reduction' && kind !== 'sudoku');
  assert(four.length >= 4, 'most families should be four-colour families');
  console.log('Archive: ' + unique.size + ' distinct graphs, ' + kinds.size + ' families ('
    + [...kinds].map(([k, n]) => k + ' ' + n).join(', ') + '); slowest ' + Math.round(maxMs) + ' ms');
});

test('minification leaves daily graphs unchanged', async () => {
  const result = await build({
    configFile: false, logLevel: 'silent',
    build: { write: false, minify: true, lib: { entry: 'src/color-levels.ts', formats: ['es'] } },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const chunk = output.find(item => item.type === 'chunk')!;
  const compiled = await import('data:text/javascript;base64,' + Buffer.from(chunk.code).toString('base64'));
  for (const date of ['2026-09-08', '2026-09-07', '2026-09-06', '2026-09-04', '2026-08-16']) {
    assert.equal(fingerprint(compiled.generateColorGraph(date, stubSudoku)),
      fingerprint(generateColorGraph(date, stubSudoku)));
  }
});
