import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, landmarkProgress, marchLandmark, movesTo, movesBetween, W, H, MOVES, STRIDE, TOUCH, LIVE, idx, rowOf, colOf, wrapC } from '../src/HillClimb-world.ts';
import { newRun, runState, touching, touchedOrder, livePair, gradeFor, gradeSquares } from '../src/HillClimb-run.ts';
import type { Run } from '../src/HillClimb-run.ts';
import type { World } from '../src/HillClimb-world.ts';

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

/** The page's own move, so these tests walk on exactly the squares a player can. */
const step = (here: number, dr: number, dc: number) =>
  idx(Math.max(0, Math.min(H - 1, rowOf(here) + dr * STRIDE)), wrapC(colOf(here) + dc * STRIDE));

/** Head for a landmark and stop the moment it is touched. Returns false if the
 *  budget ran out on the way.
 *
 *  The square aimed at is chosen once and held. Re-choosing the nearest square
 *  every step sounds better and is not: the ice cap has ends at both poles, and
 *  a walk between them flips its mind and paces on the spot forever. */
function walkTo(run: Run, cells: Set<number>, budget = MOVES) {
  const from = run.path[run.path.length - 1];
  let target = -1, best = Infinity;
  for (const cell of cells) {
    const d = movesBetween(from, cell);
    if (d < best) { best = d; target = cell; }
  }
  while (run.path.length - 1 < budget) {
    const here = run.path[run.path.length - 1];
    if (touching(cells, here)) return true;
    let dc = colOf(target) - colOf(here);
    if (dc > W / 2) dc -= W;
    if (dc < -W / 2) dc += W;
    const dr = rowOf(target) - rowOf(here);
    // Each axis marches until it is inside the touch radius and then stops.
    // Holding a diagonal all the way in cannot work: a move is five squares on
    // both axes at once, so a walk that will not straighten up at the end
    // steps over its own target for ever.
    const next = step(here, Math.abs(dr) <= TOUCH ? 0 : Math.sign(dr), Math.abs(dc) <= TOUCH ? 0 : Math.sign(dc));
    if (next === here) return touching(cells, next);
    run.path.push(next);
  }
  return touching(cells, run.path[run.path.length - 1]);
}

/** Follow the generator's deterministic route through enough distinct regions
 * to complete a whole challenge. */
function walkChallenge(run: Run, goal: World['goals'][number], budget = MOVES) {
  const trip = marchLandmark(run.path[run.path.length - 1], goal, run.path);
  run.path = trip.path.slice(0, budget + 1);
  return landmarkProgress(goal, run.path).complete;
}

test('a move is a whole stride, so every landmark must be landable beside', () => {
  // The squares a walk can stop on sit on a lattice STRIDE apart. A tolerance
  // below half a stride leaves landmarks no route can ever reach — which is
  // exactly what made the second landmark impossible to complete.
  assert.ok(TOUCH >= Math.floor(STRIDE / 2), 'TOUCH must cover half a stride');
  for (const w of worlds) {
    for (const goal of w.goals) {
      const run = newRun(w);
      // Budget is not the question here — whether any route can ever land
      // close enough is. The move budget is checked separately.
      assert.ok(walkTo(run, goal.cells, MOVES * 8), w.day + ': ' + goal.name + ' cannot be reached at all');
    }
  }
});

test('daily challenges are allowed to run beyond the move budget', () => {
  let demanding = 0;
  for (const day of SAMPLE) for (const drop of ['', 'aaaaaa', 'bbbbbb', 'cccccc', 'dddddd']) {
    const w = generateWorld(day, drop);
    assert.equal(w.rungs, w.goals.length);
    let history = [w.spawn], from = w.spawn, cost = 0;
    for (const goal of w.goals) {
      const trip = marchLandmark(from, goal, history);
      cost += trip.cost;
      from = trip.at;
      history = trip.path;
    }
    if (cost > MOVES) demanding++;
  }
  assert.ok(demanding >= SAMPLE.length * 3, 'too many daily ladders still fit inside 28 moves');
});

test("the planet is the day's, and the drop is the player's", () => {
  const base = generateWorld('2026-09-09');
  const drops = ['aaaaaa', 'bbbbbb', 'cccccc', 'dddddd', 'eeeeee', 'ffffff'].map(d => generateWorld('2026-09-09', d));
  for (const w of drops) {
    // Same ground for everyone, down to the square. That is the shared thing.
    assert.deepEqual([...w.biome], [...base.biome]);
    assert.equal(w.summit, base.summit);
    // A different landing, and a chain built around it.
    assert.equal(w.land[w.spawn], 1);
    const away = movesBetween(w.spawn, w.summit);
    assert.ok(away >= 9 && away <= 20, 'a drop ' + away + ' moves from the summit is not a comparable day');
  }
  assert.ok(new Set(drops.map(w => w.spawn)).size >= 4, 'drops should land in different places');
  // The same drop always lands in the same place, or a reload would move you.
  assert.equal(generateWorld('2026-09-09', 'aaaaaa').spawn, drops[0].spawn);
});

test('multi-place challenges need distinct regions', () => {
  const w = worlds.find(world => world.goals.some(goal => (goal.required || 1) > 1));
  const goal = w.goals.find(item => (item.required || 1) > 1);
  const first = goal.regions[0];
  const run = newRun(w);
  assert.ok(walkTo(run, first, MOVES * 8));
  const partial = landmarkProgress(goal, run.path);
  assert.equal(partial.visited, 1);
  assert.equal(partial.complete, false);
  assert.ok(walkChallenge(run, goal, MOVES * 8));
  assert.ok(landmarkProgress(goal, run.path).complete);
});

test('exactly two landmarks are on offer, all the way down', () => {
  for (const w of worlds) {
    const had = new Set<number>();
    // Every day must be able to offer a full pair for each of its rungs; only
    // the very tail of the pool is allowed to thin out.
    for (let n = 0; n < w.goals.length; n++) {
      assert.equal(livePair(w, had).length, Math.min(LIVE, w.goals.length - n),
        w.day + ': wrong number on offer at challenge ' + (n + 1));
      had.add(livePair(w, had)[0]);
    }
  }
});

test('a landmark that has not come up yet is scenery, not a find', () => {
  // Standing on the third one before either of the first two is reached
  // collects nothing: it was never on the table. The square has to be clear of
  // the two that are, or reaching one of those promotes the third on the spot
  // and the walk fairly takes both.
  let checked = 0;
  for (const w of worlds) {
    if (w.goals.length <= LIVE) continue;
    // The drop must not be sitting on one of the two either, or reaching that
    // one promotes the third before the walk has taken a step.
    if (touching(w.goals[0].cells, w.spawn) || touching(w.goals[1].cells, w.spawn)) continue;
    const apart = [...w.goals[LIVE].cells].find(i =>
      !touching(w.goals[0].cells, i) && !touching(w.goals[1].cells, i));
    if (apart === undefined) continue;
    checked++;
    assert.deepEqual(touchedOrder(w, [w.spawn, apart]).filter(g => g === LIVE), [],
      w.day + ': a landmark not yet offered was credited');
  }
  assert.ok(checked > 10, 'only checked ' + checked + ' worlds');
});

test('a newly unlocked landmark counts if it was visited earlier', () => {
  const w = planted(worlds[0], 3);
  const locked = w.goals[2].centre;
  const unlocksIt = w.goals[0].centre;

  // The third landmark is scenery at the first stop. Reaching the first goal
  // then opens a slot for it, at which point the earlier visit should count
  // without making the player walk back.
  assert.deepEqual(touchedOrder(w, [w.spawn, locked]), []);
  assert.deepEqual(touchedOrder(w, [w.spawn, locked, unlocksIt]), [0, 2]);
});

test('challenge regions stay distinct and their union is outlined', () => {
  let checked = 0;
  for (const w of worlds) {
    for (const goal of w.goals) {
      if (!goal.regions || goal.regions.length < 2) continue;
      checked++;
      assert.ok(goal.required >= 1 && goal.required <= goal.regions.length);
      for (const region of goal.regions) for (const i of region) assert.ok(goal.cells.has(i));
    }
  }
  assert.ok(checked > 80, 'only checked ' + checked + ' multi-place challenges');
});

test('a landmark kind is offered once, holding all of itself', () => {
  for (const w of worlds) {
    assert.equal(new Set(w.goals.map(g => g.id)).size, w.goals.length, w.day + ' offered a kind twice');
  }
});

test('no landmark is underfoot at the drop', () => {
  for (const w of worlds) {
    // A starting continent may count as progress, but it must never complete
    // the first challenge before the player has moved.
    assert.equal(landmarkProgress(w.goals[0], [w.spawn]).complete, false,
      w.day + ': ' + w.goals[0].name + ' was complete at the drop');
  }
});

test('both ice caps are required when that challenge appears', () => {
  let checked = 0;
  for (const w of worlds) {
    const cap = w.goals.find(g => g.id === 'icecaps');
    if (!cap) continue;
    checked++;
    assert.equal(cap.required, 2);
    assert.ok(cap.regions.length >= 2);
    const one = [cap.regions[0].values().next().value];
    assert.equal(landmarkProgress(cap, one).complete, false);
    const both = [cap.regions[0].values().next().value, cap.regions[1].values().next().value];
    assert.equal(landmarkProgress(cap, both).complete, true);
  }
  assert.ok(checked > 2, 'not enough ice cap days in the sample');
});

/* Collection and scoring are about rules rather than geography, so they run on
   a world with landmarks planted a known distance apart along the drop's own
   row. Two of the day's real landmarks can sit close enough that one walk
   brushes both, which is a nice thing in play and a poor thing to assert. */
function planted(w: World, n: number): World {
  const r = rowOf(w.spawn);
  return {
    ...w,
    rungs: n,
    goals: Array.from({ length: n }, (_, k) => {
      const cell = idx(r, wrapC(colOf(w.spawn) + 10 * (k + 1)));
      return { id: 'p' + k, name: 'landmark ' + k, hint: 'planted for the test', cells: new Set([cell]), centre: cell };
    }),
  };
}

test('either of the two on offer may be taken first, and the pair refills', () => {
  const w = worlds.find(x => x.goals.length >= 3 && x.rungs >= 2);
  for (const first of [0, 1]) {
    const run = newRun(w);
    assert.ok(walkChallenge(run, w.goals[first], MOVES * 8));
    const now = runState(w, run);
    // Either one can be gone after, and the walk always ends up holding it.
    // Not necessarily holding it *first*: a landmark covers every instance of
    // its kind, so heading for the far one often crosses the near one on the
    // way, and collecting both is the reward for the route rather than a fault.
    assert.ok(now.found.includes(first),
      'going after the ' + (first ? 'far' : 'near') + ' one should count');
    // What has to hold is that the pair refills from behind and never offers
    // something already in hand.
    assert.equal(now.live.length, LIVE);
    for (const g of now.live) assert.ok(!now.found.includes(g));
  }
});

test('a landmark reached is a landmark kept — there is nothing to lose', () => {
  const w = planted(worlds[0], 3);
  const run = newRun(w);
  assert.ok(walkTo(run, w.goals[0].cells, MOVES));
  assert.equal(runState(w, run).found.length, 1);
  // Wandering off after it, and running out of moves, changes nothing.
  walkTo(run, w.goals[2].cells, MOVES);
  run.stopped = true;
  assert.ok(runState(w, run).found.includes(0), 'a landmark should never be taken back');
});

test('standing where two landmarks meet collects both', () => {
  const w = worlds[0];
  const shared = new Set([idx(30, 30), idx(30, 31)]);
  const fake: World = { ...w, rungs: 2, goals: [
    { id: 'a', name: 'a', hint: 'x'.repeat(30), cells: shared, centre: idx(30, 30) },
    { id: 'b', name: 'b', hint: 'x'.repeat(30), cells: shared, centre: idx(30, 31) },
  ] };
  assert.deepEqual(touchedOrder(fake, [w.spawn, idx(30, 30)]), [0, 1]);
  assert.equal(runState(fake, { path: [w.spawn, idx(30, 30)], stopped: false }).found.length, 2);
});

test('the climb is worth more than everything else put together', () => {
  const w = planted(worlds[0], 4);
  // A run that reaches every landmark but never leaves sea level must score
  // below one that climbs to the summit and finds nothing.
  const flat = newRun(w);
  for (const goal of w.goals) walkTo(flat, goal.cells, MOVES);
  flat.stopped = true;
  const climber: Run = { path: [w.spawn, w.summit], stopped: true };
  assert.equal(runState(w, flat).found.length, w.goals.length);
  assert.ok(runState(w, climber).score > runState(w, flat).score,
    'the summit should beat a clean sweep of the bonuses');
});

test('score rises with every landmark, and a full sweep tops the bonus', () => {
  const w = planted(worlds[0], 4);
  const scores: number[] = [];
  for (let n = 0; n <= w.goals.length; n++) {
    const run = newRun(w);
    for (let g = 0; g < n; g++) walkTo(run, w.goals[g].cells, MOVES);
    run.stopped = true;
    scores.push(runState(w, run).score);
  }
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] > scores[i - 1], 'landmark ' + i + ' added nothing');
  // And each one pays more than the one before it. Measured on the landmark
  // bonus itself, independent of the height crossed along the way.
  const paid: number[] = [];
  for (let n = 0; n <= w.goals.length; n++) {
    const run = newRun(w);
    for (let g = 0; g < n; g++) walkTo(run, w.goals[g].cells, MOVES);
    paid.push(runState(w, run).landmarkBonus);
  }
  assert.deepEqual(paid, [0, 5, 15, 30, 50], 'challenges should add +5, +10, +15, +20');
  for (let i = 2; i < paid.length; i++) {
    assert.ok(paid[i] - paid[i - 1] > paid[i - 1] - paid[i - 2],
      'landmark ' + i + ' paid no more than the one before');
  }
});

test('touching is a square of the right size', () => {
  const cells = new Set([idx(40, 40)]);
  assert.ok(touching(cells, idx(40, 40)));
  assert.ok(touching(cells, idx(40 + TOUCH, 40 - TOUCH)));
  assert.ok(!touching(cells, idx(40 + TOUCH + 1, 40)));
  assert.ok(touching(new Set([idx(40, 0)]), idx(40, W - TOUCH)), 'and it wraps');
});

test('grades use the published score thresholds', () => {
  assert.equal(gradeFor(59), 'D');
  assert.equal(gradeFor(60), 'C');
  assert.equal(gradeFor(89), 'C');
  assert.equal(gradeFor(90), 'B');
  assert.equal(gradeFor(119), 'B');
  assert.equal(gradeFor(120), 'A');
  assert.equal(gradeFor(139), 'A');
  assert.equal(gradeFor(140), 'S');
});

test('the share bar fills one square per grade', () => {
  assert.equal(gradeSquares('D'), '🟩⬜⬜⬜⬜');
  assert.equal(gradeSquares('C'), '🟩🟩⬜⬜⬜');
  assert.equal(gradeSquares('B'), '🟩🟩🟩⬜⬜');
  assert.equal(gradeSquares('A'), '🟩🟩🟩🟩⬜');
  assert.equal(gradeSquares('S'), '🟩🟩🟩🟩🟩');
});
