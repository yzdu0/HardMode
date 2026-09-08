import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import {
  GRAPHLE_N, TREEDLE_N, GRAPHLE_PAIRS, TREEDLE_PAIRS,
  graphleSize, graphlePairs, TREEDLE_LOOKALIKES, TREEDLE_MAX_CLASS, TREEDLE_TARGETS,
  graphleEdges, treedleEdges, graphleProps, treedleProps,
  graphleFingerprint, treedleFingerprint,
  generateGraphleTarget, generateTreedleTarget, treeMaskFromPrufer,
} from '../src/guess-levels.ts';

const dates = [...Array(90).keys()].map(day =>
  new Date(Date.UTC(2026, 8, 8 - day)).toISOString().slice(0, 10));

// Every labelled tree on eight dots, the same way.
function treedleCensus() {
  const size = new Map<string, number>();
  const code = new Array(TREEDLE_N - 2).fill(0);
  const total = TREEDLE_N ** (TREEDLE_N - 2);
  for (let n = 0; n < total; n++) {
    let rest = n;
    for (let i = 0; i < code.length; i++) { code[i] = rest % TREEDLE_N; rest = (rest / TREEDLE_N) | 0; }
    const key = treedleFingerprint(treedleProps(treedleEdges(treeMaskFromPrufer(code))));
    size.set(key, (size.get(key) || 0) + 1);
  }
  return { size, total };
}

let treedle: { size: Map<string, number>; total: number };

test('the Treedle shortlist is exactly the most confusable shapes', () => {
  treedle = treedleCensus();
  assert.equal(treedle.size.size, 23, 'there are 23 tree shapes on eight dots');
  const keys = [...treedle.size.keys()];
  const vec = (k: string) => k.split('|').map(Number);
  const lookalikes = (k: string) => keys.filter(other => other !== k &&
    vec(k).filter((x, i) => Math.abs(x - vec(other)[i]) <= 1).length >= 4).length;
  const wanted = keys.filter(k =>
    lookalikes(k) >= TREEDLE_LOOKALIKES && treedle.size.get(k)! <= TREEDLE_MAX_CLASS);
  assert.deepEqual([...TREEDLE_TARGETS].sort(), [...wanted].sort(),
    'TREEDLE_TARGETS has drifted from the census');
  // The giveaway shapes must be gone: a straight line and a star are readable
  // from a single guess.
  assert(!TREEDLE_TARGETS.includes('2|7|2|84|4'), 'the straight line is too obvious');
  assert(!TREEDLE_TARGETS.includes('7|2|7|49|7'), 'the star is too obvious');
});

test('Graphle uses only connected, varied 7–8 vertex targets', () => {
  const seen = new Set<string>(), sizes = new Set<number>();
  for (const date of dates) {
    const n = graphleSize(date), mask = generateGraphleTarget(date);
    assert(n === 7 || n === 8);
    assert.equal(generateGraphleTarget(date), mask);
    const pairs = graphlePairs(n), edges = graphleEdges(mask, n), props = graphleProps(edges, n);
    assert.equal(pairs.length, n * (n - 1) / 2);
    assert(mask >= 0 && mask < 2 ** pairs.length);
    assert.equal(new Set(edges.flat()).size, n, 'every vertex is used');
    assert(props.e >= n + 2 && props.e <= n + 6);
    assert(props.diam >= 2 && props.diam <= 4);
    assert(props.chi >= 3 && props.chi <= 4);
    assert(props.tri >= 2 && props.tri <= 9);
    assert(props.cyc >= 6 && props.cyc <= 100);
    seen.add(n + ':' + mask); sizes.add(n);
  }
  assert.equal(seen.size, 90);
  assert.equal(sizes.size, 2);
});

test('every 7–8 vertex edge round-trips including the highest mask bit', () => {
  for (const n of [7, 8]) for (const [i, pair] of graphlePairs(n).entries()) {
    assert.deepEqual(graphleEdges(1 << i, n), [pair]);
  }
});

test('Graphle size and target survive production minification', async () => {
  const result = await build({ configFile: false, logLevel: 'silent',
    build: { write: false, minify: true, lib: { entry: 'src/guess-levels.ts', formats: ['es'] } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const chunk = output.find(item => item.type === 'chunk')!;
  const compiled = await import('data:text/javascript;base64,' + Buffer.from(chunk.code).toString('base64'));
  for (const date of dates.slice(0, 10)) {
    assert.equal(compiled.graphleSize(date), graphleSize(date));
    assert.equal(compiled.generateGraphleTarget(date), generateGraphleTarget(date));
  }
});

test('daily Treedle targets avoid the shapes a single guess gives away', () => {
  const winners: number[] = [];
  const seen = new Set<number>(), shapes = new Set<string>();
  for (const date of dates) {
    const mask = generateTreedleTarget(date);
    assert.equal(generateTreedleTarget(date), mask, 'same day, same target');
    seen.add(mask);
    const edges = treedleEdges(mask);
    assert.equal(edges.length, TREEDLE_N - 1, 'a target must be a tree');
    const props = treedleProps(edges);
    assert(Number.isFinite(props.diam), 'a tree is connected');
    const key = treedleFingerprint(props);
    assert(TREEDLE_TARGETS.includes(key), date + ' fell back to an unlisted shape ' + key);
    shapes.add(key);
    winners.push(treedle.size.get(key)!);
  }
  assert(seen.size >= 80, 'days should not keep repeating the same tree');
  assert(shapes.size >= 8, 'only ' + shapes.size + ' distinct shapes across 90 days');
  const mean = winners.reduce((a, z) => a + z, 0) / winners.length;
  // Uniformly random targets average about 20200 winning trees (1 tree in 13).
  assert(mean <= TREEDLE_MAX_CLASS, 'mean winning trees per day is ' + mean.toFixed(0));
  console.log('Treedle: ' + seen.size + ' distinct targets; a guess wins by luck on average 1 tree in '
    + Math.round(treedle.total / mean) + ' (was 1 in 13)');
});

test('the five scored numbers match hand-worked shapes', () => {
  const path: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]];
  assert.deepEqual(treedleProps(path), { leaf: 2, diam: 7, maxd: 2, w: 84, alpha: 4 });
  const star: [number, number][] = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7]];
  assert.deepEqual(treedleProps(star), { leaf: 7, diam: 2, maxd: 7, w: 49, alpha: 7 });
  const triangle: [number, number][] = [[0, 1], [1, 2], [0, 2]];
  const t = graphleProps(triangle);
  assert.equal(t.tri, 1);
  assert.equal(t.cyc, 1);
  assert.equal(t.chi, 3);
  assert.equal(t.diam, Infinity); // dots 4-6 are unlinked
  const complete: [number, number][] = GRAPHLE_PAIRS.map(([u, v]) => [u, v] as [number, number]);
  assert.deepEqual(graphleProps(complete),
    { e: 28, chi: 8, tri: 56, cyc: 8018, diam: 1 });
});
