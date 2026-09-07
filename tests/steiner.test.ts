import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { generateSteiner, fallbackSteiner, greedyNetworkCost } from '../src/steiner-levels.ts';
import type { SteinerBoard } from '../src/steiner-levels.ts';
import { solveSteinerExact } from '../src/steiner-solver.ts';

const fingerprint = (b: SteinerBoard) => JSON.stringify({
  N: b.N, terms: b.terms, walls: [...b.walls], special: [...b.special],
  portals: b.portalPairs, par: b.par, kind: b.kind,
});

// Independent exhaustive enumeration: no shared graph builder or solver logic.
function bruteForce(N: number, terms: number[][], walls: Set<string>,
    special: Map<string, { type: string }>, portals: Record<string, number[][]>) {
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
      const neighbors = [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]].map(p => p.join(','));
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

test('exact par matches exhaustive search with walls, free cells, thorns and portals', () => {
  for (let seed = 0; seed < 120; seed++) {
    const terms = [[0, 0], [0, 2], [2, 2]];
    const walls = new Set<string>();
    const special = new Map<string, { type: string }>();
    const portals: Record<string, number[][]> = seed % 3 === 0 ? { A: [[1, 0], [2, 1]] } : {};
    let state = seed + 1;
    for (const key of ['0,1', '1,1', '1,2', '2,0']) {
      state = Math.imul(state, 1664525) + 1013904223;
      const value = (state >>> 16) % 4;
      if (value === 0) walls.add(key);
      if (value === 1) special.set(key, { type: 'bonus' });
      if (value === 2) special.set(key, { type: 'penalty' });
    }
    for (const pair of Object.values(portals)) for (const p of pair) special.set(p.join(','), { type: 'portal' });
    assert.equal(solveSteinerExact(3, terms, walls, special, portals),
      bruteForce(3, terms, walls, special, portals), 'case ' + seed);
  }
});

function assertChallenge(b: SteinerBoard) {
  assert.equal(b.N, 13);
  assert.equal(b.terms.length, 7);
  assert.equal(b.termSet.size, 7);
  assert(Number.isFinite(b.par) && b.par >= 28);
  assert(greedyNetworkCost(b) >= b.par + 2, 'nearest-seed strategy should miss par');
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
  assert.equal(b.par, solveSteinerExact(b.N, b.terms, b.walls, b.special, b.portalPairs));
}

test('the safety fallback is itself a verified challenge', () => {
  assertChallenge(fallbackSteiner(solveSteinerExact));
});

test('all 90 archive days are valid, challenging and varied', () => {
  const kinds = new Set<string>(), unique = new Set<string>();
  let maxMs = 0;
  for (let day = 0; day < 90; day++) {
    const date = new Date(Date.UTC(2026, 8, 8 - day)).toISOString().slice(0, 10);
    const start = performance.now();
    const b = generateSteiner(date, solveSteinerExact);
    maxMs = Math.max(maxMs, performance.now() - start);
    assertChallenge(b);
    kinds.add(b.kind); unique.add(fingerprint(b));
    assert.equal(fingerprint(generateSteiner(date, solveSteinerExact)), fingerprint(b));
  }
  assert.equal(kinds.size, 5);
  assert(unique.size >= 85, 'avoid repeated fallback boards');
  console.log('Archive: ' + unique.size + ' distinct boards; slowest generation ' + Math.round(maxMs) + ' ms');
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
