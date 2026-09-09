import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateWorld, components, centreOf, windDir, windName, movesBetween, dxWrap,
  BIOMES, B, W, H, MOVES, STRIDE, SIGHT, LIVE, goalValue, ladderValue, march,
  idx, rowOf, colOf, latOf,
} from '../src/HillClimb-world.ts';

const days = (n: number, from = '2026-09-09') => {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
};
const SAMPLE = days(40);
// Never `SAMPLE.map(generateWorld)`: map hands the callback an index, and
// generateWorld's second argument is the drop seed.
const worlds = SAMPLE.map(d => generateWorld(d));
const isLandBiome = (b: number) => !BIOMES[b].water;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

test('the same date always draws the same planet', () => {
  const a = generateWorld('2026-03-14');
  const b = generateWorld('2026-03-14');
  assert.deepEqual([...a.biome], [...b.biome]);
  assert.equal(a.spawn, b.spawn);
  assert.equal(a.summit, b.summit);
  assert.deepEqual(a.goals.map(g => g.id), b.goals.map(g => g.id));
  assert.deepEqual(a.goals.map(g => [...g.cells]), b.goals.map(g => [...g.cells]));
});

test('consecutive days are different planets', () => {
  for (let i = 1; i < worlds.length; i++) {
    const same = [...worlds[i].biome].every((b, k) => b === worlds[i - 1].biome[k]);
    assert.ok(!same, SAMPLE[i] + ' repeated the day before it');
  }
});

test('height and sea level agree everywhere', () => {
  for (const w of worlds) {
    for (let i = 0; i < W * H; i++) {
      if (w.land[i]) assert.ok(w.metres[i] >= 0 && w.depth[i] === 0);
      // A square sitting exactly on the sea-level line has depth 0 and is
      // still water; only the height has to be flattened.
      else assert.ok(w.metres[i] === 0 && w.depth[i] >= 0 && w.depth[i] <= 1);
      assert.ok(w.land[i] === (isLandBiome(w.biome[i]) ? 1 : 0));
    }
  }
});

test('every world is one-third land', () => {
  for (const w of worlds) {
    const land = [...w.land].reduce((a: number, b) => a + b, 0) / (W * H);
    assert.ok(land > 0.32 && land < 0.34, SAMPLE[worlds.indexOf(w)] + ' is ' + land + ' land');
  }
});

test('the summit is the highest ground on the planet', () => {
  for (const w of worlds) {
    assert.equal(w.metres[w.summit], w.summitM);
    for (let i = 0; i < W * H; i++) assert.ok(w.metres[i] <= w.summitM);
    assert.ok(w.summitM > 1000, 'a planet with nothing to climb');
  }
});

test('the poles are cold and the equator is not', () => {
  for (const w of worlds) {
    const band = (lo: number, hi: number) => {
      const out: number[] = [];
      for (let r = 0; r < H; r++) {
        const a = Math.abs(latOf(r));
        if (a >= lo && a < hi) for (let c = 0; c < W; c++) out.push(w.tempC[idx(r, c)]);
      }
      return mean(out);
    };
    assert.ok(band(0, 15) > 20, 'the tropics should be warm');
    assert.ok(band(75, 90) < -10, 'the poles should not be');
    assert.ok(band(0, 15) > band(35, 50) && band(35, 50) > band(75, 90));
  }
});

test('biomes land where the climate puts them', () => {
  const latsOf = (pick: number[]) => {
    const out: number[] = [];
    for (const w of worlds) for (let i = 0; i < W * H; i++) if (pick.includes(w.biome[i])) out.push(Math.abs(latOf(rowOf(i))));
    return out;
  };
  const rain = latsOf([B.rainforest]);
  const ice = latsOf([B.icecap]);
  const desert = latsOf([B.desert]);
  assert.ok(rain.length > 200 && mean(rain) < 22, 'rainforest belongs on the equator');
  assert.ok(ice.length > 200 && Math.min(...ice) > 55, 'ice caps belong at the poles');
  // Deserts sit under the subtropical highs and in rain shadows, so the spread
  // is wide — but the middle of it is nowhere near either pole or the equator.
  assert.ok(desert.length > 200 && mean(desert) > 10 && mean(desert) < 45);
});

test('rain falls hardest on the windward side of the ranges', () => {
  // Walk each row into the wind from every summit-ish square: the ground the
  // air crossed before it climbed should, on average, be wetter than the
  // ground just behind the crest.
  let windward = 0, lee = 0, pairs = 0;
  for (const w of worlds) for (let r = 0; r < H; r++) {
    const dir = windDir(latOf(r));
    for (let c = 0; c < W; c++) {
      const i = idx(r, c);
      if (!w.land[i] || w.metres[i] < 1500) continue;
      const up = idx(r, ((c - dir * 4) % W + W) % W);
      const down = idx(r, ((c + dir * 4) % W + W) % W);
      if (!w.land[up] || !w.land[down]) continue;
      windward += w.rain[up]; lee += w.rain[down]; pairs++;
    }
  }
  assert.ok(pairs > 200, 'not enough mountains to judge');
  assert.ok(windward / pairs > lee / pairs + 0.05,
    'expected a rain shadow: windward ' + (windward / pairs).toFixed(3) + ' vs lee ' + (lee / pairs).toFixed(3));
});

test('the drop is somewhere a person could start from', () => {
  for (const w of worlds) {
    assert.equal(w.land[w.spawn], 1);
    assert.ok(Math.abs(latOf(rowOf(w.spawn))) <= 62);
    assert.notEqual(w.biome[w.spawn], B.icecap);
    assert.notEqual(w.biome[w.spawn], B.snowline);
    assert.ok(movesBetween(w.spawn, w.summit) >= 7, 'the summit should not be a stroll');
  }
});

test('every rung of the ladder exists and is a different kind of thing', () => {
  for (const w of worlds) {
    assert.ok(w.goals.length >= 1);
    assert.equal(new Set(w.goals.map(g => g.id)).size, w.goals.length, w.day + ' repeated a kind');
    for (const g of w.goals) {
      assert.ok(g.cells.size > 0, w.day + ' has an empty landmark');
      for (const i of g.cells) assert.ok(Number.isInteger(i) && i >= 0 && i < W * H);
      assert.ok(g.cells.has(g.centre));
      assert.ok(g.name.length > 3 && g.hint.length > 20);
    }
  }
});

test('the landmark ladder is not capped at four', () => {
  assert.ok(worlds.some(w => w.rungs > 4), 'no sampled day offered more than four landmarks');
});

test('the rungs a day is scored out of fit inside one budget', () => {
  for (const w of worlds) {
    // Rung by rung from the drop, walked rather than measured in straight
    // lines: a player who spent every move on landmarks and nothing else could
    // finish them. The pool past `rungs` is deliberately out of reach; it is
    // only there so the pair on offer never thins to one.
    let moves = 0, from = w.spawn;
    for (const g of w.goals.slice(0, w.rungs)) {
      const trip = march(from, g.cells);
      moves += trip.cost;
      from = trip.at;
    }
    assert.ok(moves <= MOVES, w.day + ' needs ' + moves + ' moves for ' + w.rungs + ' rungs');
  }
});

test('later rungs are worth more, and the ladder adds up', () => {
  assert.equal(goalValue(0), 1);
  assert.equal(goalValue(3), 4);
  for (let n = 0; n <= 12; n++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += goalValue(k);
    assert.equal(ladderValue(n), sum, 'ladder of ' + n);
  }
  assert.ok(ladderValue(2) / ladderValue(4) < 0.5, 'stopping halfway should not be half the points');
});

test('several kinds of landmark come up across a season', () => {
  const kinds = new Set(days(120).flatMap(d => generateWorld(d).goals.map(g => g.id)));
  assert.ok(kinds.size >= 5, 'only saw ' + [...kinds].join(', '));
});

test('east and west join up', () => {
  // A patch straddling column 0 is one thing, not two.
  const seam = new Set([idx(4, 0), idx(4, 1), idx(4, W - 1), idx(4, W - 2)]);
  const groups = components(i => seam.has(i));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 4);
  // And the poles do not.
  const poles = new Set([idx(0, 5), idx(H - 1, 5)]);
  assert.equal(components(i => poles.has(i)).length, 2);
});

test('a group straddling the seam has its centre on the group', () => {
  const seam = [idx(10, W - 2), idx(10, W - 1), idx(10, 0), idx(10, 1)];
  const c = centreOf(seam);
  assert.ok(seam.includes(c), 'centre landed at ' + colOf(c) + ', outside the group');
});

test('distances measure the short way round', () => {
  assert.equal(dxWrap(1, W - 1), 2);
  assert.equal(dxWrap(0, W / 2), W / 2);
  assert.equal(movesBetween(idx(0, 0), idx(0, STRIDE)), 1);
  assert.equal(movesBetween(idx(0, 0), idx(STRIDE, W - STRIDE)), 1);   // one diagonal move, wrapped
  assert.equal(movesBetween(idx(3, 4), idx(3, 4)), 0);
});

test('the wind bands are the ones a planet actually has', () => {
  assert.equal(windDir(0), -1); assert.equal(windName(0), 'trade winds');
  assert.equal(windDir(45), 1); assert.equal(windName(45), 'westerlies');
  assert.equal(windDir(-45), 1);
  assert.equal(windDir(75), -1); assert.equal(windName(-75), 'polar easterlies');
});

test('what you can see from one stop is a disc, and it wraps', () => {
  // The reveal in the page walks the same offsets; this pins the shape.
  const from = idx(20, 0);
  const seen = new Set<number>();
  for (let dr = -SIGHT; dr <= SIGHT; dr++) for (let dc = -SIGHT; dc <= SIGHT; dc++) {
    if (dr * dr + dc * dc > SIGHT * SIGHT + SIGHT) continue;
    const r = rowOf(from) + dr;
    if (r >= 0 && r < H) seen.add(idx(r, ((colOf(from) + dc) % W + W) % W));
  }
  assert.ok(seen.has(idx(20, W - SIGHT)), 'sight should cross the seam');
  assert.ok(!seen.has(idx(20 - SIGHT, colOf(from) - SIGHT + W)), 'the corners are outside the disc');
  assert.ok(seen.size > 80 && seen.size < (2 * SIGHT + 1) ** 2);
});
