import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateFacility, fallbackFacility, bestPlacement, greedyPlacement, evaluate, optimalSites,
  distanceFrom, routeCells, islands, FACILITY_FAMILIES, FACILITY_MIN_GAP, MAROONED,
} from '../src/facility-levels.ts';
import type { FacilityBoard } from '../src/facility-levels.ts';

const key = ([r, c]: number[]) => `${r},${c}`;
const days = (n: number, from = '2026-09-08') => {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); }
  return out;
};

// Independent exhaustive search: every subset of sites, scored from scratch.
function bruteForce(dist: number[][], k: number) {
  const total = dist[0].length;
  let best = Infinity;
  const walk = (from: number, chosen: number[]) => {
    if (chosen.length === k) {
      let sum = 0;
      for (const row of dist) sum += Math.min(...chosen.map(s => row[s]));
      best = Math.min(best, sum);
      return;
    }
    for (let s = from; s < total; s++) walk(s + 1, [...chosen, s]);
  };
  walk(0, []);
  return best;
}

// A tiny deterministic generator, so the table tests do not lean on the levels.
function table(seed: number, towns: number, sites: number) {
  let h = seed * 2654435761 % 2147483647;
  const next = () => (h = (h * 48271) % 2147483647) / 2147483647;
  return Array.from({ length: towns }, () => Array.from({ length: sites }, () => Math.floor(next() * 12)));
}

test('bestPlacement matches exhaustive search on random tables', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const towns = 2 + (seed % 5);
    const sites = 4 + (seed % 7);
    const k = 1 + (seed % 3);
    const dist = table(seed, towns, sites);
    assert.equal(bestPlacement(dist, k).cost, bruteForce(dist, k),
      `seed ${seed}: ${towns} towns, ${sites} sites, k=${k}`);
  }
});

test('bestPlacement reports sites that actually score its cost', () => {
  for (let seed = 200; seed < 240; seed++) {
    const dist = table(seed, 4, 9);
    const { cost, sites } = bestPlacement(dist, 3);
    let sum = 0;
    for (const row of dist) sum += Math.min(...sites.map(s => row[s]));
    assert.equal(sum, cost, `seed ${seed}`);
  }
});

test('greedy never beats the exact optimum', () => {
  for (let seed = 300; seed < 360; seed++) {
    const dist = table(seed, 5, 10);
    assert.ok(greedyPlacement(dist, 3).cost >= bestPlacement(dist, 3).cost, `seed ${seed}`);
  }
});

test('distanceFrom walks only over land', () => {
  // Two land strips either side of a full-height channel: nothing crosses.
  const land = new Set<string>();
  for (let r = 0; r < 5; r++) for (const c of [0, 1, 3, 4]) land.add(key([r, c]));
  const field = distanceFrom(5, land, ['0,0']);
  assert.equal(field.get('4,1'), 5);
  assert.equal(field.has('0,3'), false, 'the far bank is unreachable');
});

test('generated boards are playable and correctly scored', () => {
  for (const day of days(45)) {
    const b = generateFacility(day);
    const water = (b.N * b.N - b.land.size) / (b.N * b.N);
    assert.ok(water >= 0.5 && water <= 0.8, `${day}: ${(water * 100).toFixed(0)}% water`);
    assert.ok(b.slots >= 3 && b.slots <= 5, `${day}: ${b.slots} depots`);
    assert.ok(b.towns.length > b.slots, `${day}: ${b.towns.length} towns for ${b.slots} depots`);
    // A world, not a diagram: the map has to be big enough to have an inside.
    assert.ok(b.N >= 20, `${day}: ${b.N}x${b.N} board`);
    assert.ok(b.target >= b.N * 0.9, `${day}: target ${b.target} on a ${b.N} board`);
    for (const t of b.towns) assert.ok(b.land.has(key(t)), `${day}: a town is in the sea`);
    assert.equal(new Set(b.towns.map(key)).size, b.towns.length, `${day}: duplicate towns`);

    // The target has to be reachable by an actual placement.
    const best = optimalSites(b);
    assert.ok(best.length <= b.slots, `${day}: optimum uses more depots than allowed`);
    const scored = evaluate(b, best);
    assert.equal(scored.total, b.target, `${day}: optimal placement does not score the target`);
    assert.ok(scored.served.every(Boolean), `${day}: the optimum strands a town`);
    assert.ok(b.target > 0, `${day}: target of zero`);
  }
});

test('every board is beyond one-depot-at-a-time greedy', () => {
  for (const day of days(45)) {
    const b = generateFacility(day);
    assert.ok(b.greedy - b.target >= FACILITY_MIN_GAP, `${day}: greedy gap ${b.greedy - b.target}`);
  }
});

test('no placement anywhere on the board beats the target', () => {
  // Full re-derivation for a handful of days, ignoring the generator's own maths.
  for (const day of days(6)) {
    const b = generateFacility(day);
    const sites = [...b.land];
    const dist = b.towns.map(t => {
      const field = distanceFrom(b.N, b.land, [key(t)]);
      return sites.map(s => field.has(s) ? field.get(s)! : MAROONED);
    });
    assert.equal(bestPlacement(dist, b.slots).cost, b.target, day);
  }
});

test('boards are stable for a date and differ between dates', () => {
  const print = (b: FacilityBoard) => JSON.stringify({
    land: [...b.land].sort(), towns: b.towns, slots: b.slots, kind: b.kind, target: b.target,
  });
  const seen = new Map<string, string>();
  for (const day of days(30)) {
    const a = print(generateFacility(day));
    assert.equal(a, print(generateFacility(day)), `${day} is not deterministic`);
    assert.equal(seen.has(a), false, `${day} repeats ${seen.get(a)}`);
    seen.set(a, day);
  }
});

test('every map family turns up, and each keeps its own character', () => {
  const kinds = new Set(days(120).map(d => generateFacility(d).kind));
  assert.equal(kinds.size, FACILITY_FAMILIES.length, [...kinds].join(', '));
});

test('routes are real walks from each town to its nearest depot', () => {
  for (const day of days(20)) {
    const b = generateFacility(day);
    const placed = optimalSites(b);
    const on = routeCells(b, placed);
    for (const cell of on) assert.ok(b.land.has(cell), `${day}: a route crosses water`);
    // Every step walked is a step paid for, and the town itself is not a step.
    const paid = evaluate(b, placed).total;
    assert.ok(on.size <= paid, `${day}: ${on.size} route cells for ${paid} travel`);
  }
});

test('towns only ever settle islands a depot can reach', () => {
  for (const day of days(30)) {
    const b = generateFacility(day);
    const lived = islands(b.N, b.land).filter(g => g.some(k => b.townSet.has(k)));
    assert.ok(lived.length <= b.slots, `${day}: ${lived.length} inhabited islands, ${b.slots} depots`);
  }
});

test('the fallback board is a valid puzzle in its own right', () => {
  const b = fallbackFacility();
  assert.ok(b.target > 0);
  assert.equal(evaluate(b, optimalSites(b)).total, b.target);
  assert.ok(b.towns.every(t => b.land.has(key(t))));
});
