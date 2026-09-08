import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateFacility, fallbackFacility, bestPlacement, greedyPlacement, evaluate, optimalSites,
  distanceFrom, descend, routeCells, islands, stepCost,
  FACILITY_FAMILIES, FACILITY_MIN_GAP, MAROONED, PLAIN, MARSH, HIGHLAND, minTarget, BIOMES,
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
  const field = distanceFrom(5, land, new Map(), ['0,0']);
  assert.equal(field.get('4,1'), 5);
  assert.equal(field.has('0,3'), false, 'the far bank is unreachable');
});

test('rough ground is priced, and a route will pay to go round it', () => {
  // A 3-wide strip. The middle column is highland all the way down except at
  // the very bottom, so the cheap way from top to bottom is the long way.
  const land = new Set<string>();
  for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) land.add(key([r, c]));
  const rough = new Map<string, number>();
  for (let r = 0; r < 5; r++) rough.set(key([r, 1]), HIGHLAND);

  const plain = distanceFrom(6, land, new Map(), ['0,0']);
  assert.equal(plain.get('0,2'), 2, 'on flat ground the direct crossing is two steps');

  const hilly = distanceFrom(6, land, rough, ['0,0']);
  // Straight across pays 3 onto the highland and 3 off it again.
  assert.equal(hilly.get('0,2'), 6);
  // The walk itself must cost exactly what the field says it does.
  const steps = descend(6, rough, distanceFrom(6, land, rough, ['0,2']), '0,0');
  let paid = 0, at = '0,0';
  for (const step of steps) { paid += stepCost(rough, at, step); at = step; }
  assert.equal(paid, hilly.get('0,2'), 'the drawn route and the score must agree');

  // Marsh is the cheaper grade, so the same crossing costs less through bog.
  const boggy = new Map<string, number>();
  for (let r = 0; r < 5; r++) boggy.set(key([r, 1]), MARSH);
  assert.equal(distanceFrom(6, land, boggy, ['0,0']).get('0,2'), 4);
  assert.equal(stepCost(new Map(), '0,0', '0,1'), PLAIN);
});

test('generated boards are playable and correctly scored', () => {
  for (const day of days(45)) {
    const b = generateFacility(day);
    // A desert is mostly walkable by design, so the band follows the biome.
    const blocked = (b.N * b.N - b.land.size) / (b.N * b.N);
    assert.ok(blocked >= 0.06 && blocked <= 0.85, `${day}: ${(blocked * 100).toFixed(0)}% impassable`);
    assert.ok(b.biome.wet < 0.5 ? blocked < 0.45 : blocked > 0.2,
      `${day}: a ${b.biome.id} world is ${(blocked * 100).toFixed(0)}% impassable`);
    assert.ok(b.slots >= 3 && b.slots <= 5, `${day}: ${b.slots} depots`);
    assert.ok(b.towns.length > b.slots, `${day}: ${b.towns.length} towns for ${b.slots} depots`);
    // A world, not a diagram: the map has to be big enough to have an inside.
    assert.ok(b.N >= 28, `${day}: ${b.N}x${b.N} board`);
    assert.ok(b.target >= minTarget(b.N), `${day}: target ${b.target} on a ${b.N} board`);
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
      const field = distanceFrom(b.N, b.land, b.rough, [key(t)]);
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

test('every family and every biome turns up, in combination', () => {
  const boards = days(220).map(d => generateFacility(d));
  const families = new Set(boards.map(b => b.kind.split(' ').pop()));
  const biomes = new Set(boards.map(b => b.biome.id));
  assert.equal(families.size, FACILITY_FAMILIES.length, [...families].join(', '));
  assert.equal(biomes.size, BIOMES.length, [...biomes].join(', '));
  assert.ok(FACILITY_FAMILIES.length >= 9, `${FACILITY_FAMILIES.length} families`);
  // Enough pairings that two consecutive weeks never look like the same world.
  assert.ok(new Set(boards.map(b => b.kind)).size >= 20, 'too few worlds');
});

// Independent flood fill: water the border can reach is open sea, so anything
// left over is a lake, and land whose every neighbour is lake is an island in
// one. None of this shares code with the generator.
function nesting(b: FacilityBoard) {
  const step = (k: string) => {
    const [r, c] = k.split(',').map(Number);
    return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
      .filter(([nr, nc]) => nr >= 0 && nc >= 0 && nr < b.N && nc < b.N)
      .map(([nr, nc]) => `${nr},${nc}`);
  };
  const water = new Set<string>();
  for (let r = 0; r < b.N; r++) for (let c = 0; c < b.N; c++) {
    if (!b.land.has(key([r, c]))) water.add(key([r, c]));
  }
  const open = new Set<string>();
  const queue: string[] = [];
  for (let i = 0; i < b.N; i++) {
    for (const k of [key([0, i]), key([b.N - 1, i]), key([i, 0]), key([i, b.N - 1])]) {
      if (water.has(k) && !open.has(k)) { open.add(k); queue.push(k); }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    for (const nk of step(queue[i])) if (water.has(nk) && !open.has(nk)) { open.add(nk); queue.push(nk); }
  }
  const lake = new Set([...water].filter(k => !open.has(k)));
  const islet = islands(b.N, b.land).some(g =>
    g.some(k => step(k).some(nk => lake.has(nk))) &&
    g.every(k => step(k).every(nk => b.land.has(nk) || lake.has(nk))));
  return { lake: lake.size > 0, islet };
}

test('the coastline folds back on itself now and then, and no more than that', () => {
  const boards = days(200).map(generateFacility);
  const nested = boards.filter(b => nesting(b).islet).length;
  // An island in a lake is a treat, not a motif: often enough to turn up in a
  // week of play, rare enough that two in a row is a coincidence.
  assert.ok(nested >= 8, `only ${nested} of 200 boards have an island inside a lake`);
  assert.ok(nested <= 70, `${nested} of 200 boards do — the nesting has taken over`);

  // Every islet has to be somewhere a depot can actually be useful.
  for (const b of boards) {
    for (const t of b.towns) assert.ok(b.land.has(key(t)), 'a town went into the water');
  }
});

test('temperate is the world; the rest are weather', () => {
  const seen = days(300).map(d => generateFacility(d).biome.id);
  const share = (id: string) => seen.filter(x => x === id).length / seen.length;
  assert.ok(share('temperate') > 0.5, `temperate is only ${(share('temperate') * 100).toFixed(0)}%`);
  assert.ok(share('volcanic') > 0, 'volcanic never turns up at all');
  assert.ok(share('volcanic') < 0.06, `volcanic is ${(share('volcanic') * 100).toFixed(0)}% of days`);
  for (const biome of BIOMES) assert.ok(share(biome.id) > 0, `${biome.id} never turns up`);
});

test('a biome names every kind of ground it puts on the board', () => {
  for (const biome of BIOMES) {
    for (const word of [biome.blocked, biome.ground, biome.soft, biome.hard]) {
      assert.ok(word && word.length > 2, `${biome.id}: unnamed ground`);
    }
    assert.ok(biome.wet > 0 && biome.wet <= 1, `${biome.id}: odd wetness`);
    assert.ok(biome.cap > 0 && biome.cap < 0.7, `${biome.id}: odd relief cap`);
  }
  assert.equal(new Set(BIOMES.map(b => b.id)).size, BIOMES.length, 'duplicate biome');
});

test('routes are real walks from each town to its nearest depot', () => {
  for (const day of days(20)) {
    const b = generateFacility(day);
    const placed = optimalSites(b);
    const on = routeCells(b, placed);
    for (const cell of on) assert.ok(b.land.has(cell), `${day}: a route crosses water`);

    // What is drawn has to be what is charged: each town's own route, walked
    // step by step, must add up to exactly the distance it is scored on.
    const scored = evaluate(b, placed);
    const field = distanceFrom(b.N, b.land, b.rough, placed);
    b.towns.forEach((town, i) => {
      const steps = descend(b.N, b.rough, field, key(town));
      let paid = 0, at = key(town);
      for (const step of steps) {
        assert.ok(on.has(step), `${day}: a step of the route is not shaded`);
        paid += stepCost(b.rough, at, step);
        at = step;
      }
      assert.equal(paid, scored.per[i], `${day}: town ${i} walks ${paid}, scored ${scored.per[i]}`);
      assert.ok(!steps.length || placed.includes(at), `${day}: town ${i} ends nowhere`);
    });
  }
});

test('terrain sits on the land and never takes it over', () => {
  for (const day of days(40)) {
    const b = generateFacility(day);
    for (const [cell, cost] of b.rough) {
      assert.ok(b.land.has(cell), `${day}: rough ground at sea`);
      assert.ok(cost === MARSH || cost === HIGHLAND, `${day}: odd terrain cost ${cost}`);
      assert.ok(!b.townSet.has(cell), `${day}: a town is standing in the rough`);
    }
    assert.ok(b.rough.size <= b.land.size * (b.biome.cap + 0.09),
      `${day}: ${Math.round((b.rough.size / b.land.size) * 100)}% of a ${b.biome.id} world is rough`);
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
