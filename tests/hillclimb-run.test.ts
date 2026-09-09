import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, movesTo, movesBetween, W, H, MOVES, STRIDE, TOUCH, LIVE, idx, rowOf, colOf, wrapC, B } from '../src/hillclimb-world.ts';
import { newRun, runState, touching, touchedOrder, livePair } from '../src/hillclimb-run.ts';
import type { Run } from '../src/hillclimb-run.ts';
import type { World } from '../src/hillclimb-world.ts';

const days = (n: number, from = '2026-09-09') => {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
};
const SAMPLE = days(40);
const worlds = SAMPLE.map(generateWorld);

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

test('the day is scored out of a number the budget can actually reach', () => {
  // The generator chains the landmarks along a route it has checked fits, so
  // taking them in the order they come on offer always clears the day.
  for (const w of worlds) {
    assert.ok(w.rungs >= 1 && w.rungs <= w.goals.length);
    const run = newRun(w);
    let got = 0;
    for (const goal of w.goals.slice(0, w.rungs)) {
      if (!walkTo(run, goal.cells, MOVES)) break;
      run.pressedOn = ++got;
    }
    assert.equal(got, w.rungs,
      w.day + ': only ' + got + ' of ' + w.rungs + ' rungs reachable in ' + MOVES + ' moves');
    // Brushing one of the pool's deeper entries on the way is a bonus, not a
    // bug — the ladder half of the score simply tops out.
    assert.ok(runState(w, run).kept >= w.rungs);
  }
});

test('always taking the nearer of the two is almost always right', () => {
  // Almost, and deliberately not always: if the near one were unconditionally
  // correct there would be no decision in the pair. But a day where the
  // obvious route cannot clear the rungs has to be the rare one.
  let cleared = 0;
  const sample = days(90);
  for (const day of sample) {
    const w = generateWorld(day);
    const run = newRun(w);
    let got = 0;
    while (got < w.rungs) {
      const live = livePair(w, new Set(runState(w, run).found));
      if (!live.length) break;
      const here = run.path[run.path.length - 1];
      const near = live.reduce((a, b) => (movesTo(here, w.goals[b].cells) < movesTo(here, w.goals[a].cells) ? b : a));
      if (!walkTo(run, w.goals[near].cells, MOVES)) break;
      run.pressedOn = ++got;
    }
    if (got >= w.rungs) cleared++;
  }
  assert.ok(cleared >= sample.length * 0.85,
    'the near option cleared the day only ' + cleared + ' times in ' + sample.length);
});

test('exactly two landmarks are on offer, all the way down', () => {
  for (const w of worlds) {
    const had = new Set<number>();
    // Every day must be able to offer a full pair for each of its rungs; only
    // the very tail of the pool is allowed to thin out.
    for (let n = 0; n < w.rungs; n++) {
      assert.equal(livePair(w, had).length, LIVE,
        w.day + ': only ' + livePair(w, had).length + ' on offer at rung ' + (n + 1));
      had.add(livePair(w, had)[0]);
    }
  }
});

test('a landmark that has not come up yet is scenery, not a find', () => {
  const w = worlds.find(x => x.goals.length > LIVE);
  // Standing on the third one before either of the first two is reached
  // collects nothing: it was never on the table.
  const deep = [...w.goals[LIVE].cells][0];
  assert.deepEqual(touchedOrder(w, [w.spawn, deep]).filter(g => g === LIVE), []);
});

test('the ice cap counts at whichever pole you walk to', () => {
  let checked = 0;
  for (const w of worlds) {
    const cap = w.goals.find(g => g.id === 'icecap');
    if (!cap) continue;
    checked++;
    // Whatever ice cap the day has, all of it belongs to the goal — so the
    // nearest ice on the planet is never ice that fails to count.
    for (let i = 0; i < W * H; i++) {
      if (w.biome[i] === B.icecap) assert.ok(cap.cells.has(i), w.day + ': ice cap square left out of the goal');
    }
    const run = newRun(w);
    assert.ok(walkTo(run, cap.cells), w.day + ': could not reach the ice cap');
  }
  assert.ok(checked > 2, 'not enough ice cap days in the sample');
});

test('either of the two on offer may be taken first', () => {
  const w = worlds.find(x => x.goals.length >= 3 && x.rungs >= 2);
  for (const first of [0, 1]) {
    const run = newRun(w);
    assert.ok(walkTo(run, w.goals[first].cells, MOVES * 8));
    const now = runState(w, run);
    assert.deepEqual(now.found, [first], 'taking the ' + (first ? 'far' : 'near') + ' one first should count');
    // …and the pair refills from behind, so there are still two to choose from.
    assert.deepEqual(now.live, [first === 0 ? 1 : 0, 2].sort((a, b) => a - b));
  }
});

/* The state machine is about decisions, not geography, so it is tested on a
   world with landmarks planted a known distance apart along the drop's own
   row. Two of the day's real landmarks can sit close enough that one walk
   brushes both, which is a nice thing to happen in play and a poor thing to
   assert against. */
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

test('one landmark is on offer until another is taken on', () => {
  const w = planted(worlds[0], 3);      // three, so there is still one to press on to
  const run = newRun(w);
  walkTo(run, w.goals[0].cells);
  let now = runState(w, run);
  assert.equal(now.reached, 1);
  assert.ok(now.awaiting, 'reaching one should put the choice on the table');

  // Banking closes the list: ground wandered over afterwards does not count.
  const bankedRun: Run = { ...run, path: [...run.path], banked: true };
  walkTo(bankedRun, w.goals[1].cells, MOVES);
  assert.equal(runState(w, bankedRun).kept, 1, 'a banked run should not keep collecting');

  // Pressing on opens it again, and the next one is credited.
  run.pressedOn = 1;
  assert.ok(!runState(w, run).awaiting, 'pressing on clears the choice');
  assert.ok(walkTo(run, w.goals[1].cells, MOVES), 'second landmark unreachable');
  now = runState(w, run);
  assert.equal(now.reached, 2, 'the second landmark did not register');
  assert.equal(now.kept, 2);
  assert.ok(now.awaiting, 'and the choice comes back');
});

test('pressing on and running out costs the last one, and only the last one', () => {
  const w = planted(worlds[0], 3);
  const run = newRun(w);
  walkTo(run, w.goals[0].cells);
  run.pressedOn = 1;
  run.stopped = true;                       // ended still hunting the next
  const now = runState(w, run);
  assert.ok(now.struck);
  assert.equal(now.reached, 1);
  assert.equal(now.kept, 0);

  const safe: Run = { ...run, banked: true };
  assert.ok(!runState(w, safe).struck, 'banking should protect what is in hand');
  assert.equal(runState(w, safe).kept, 1);
});

test('reaching one on the very last move is never struck off', () => {
  const w = planted(worlds[0], 2);
  const run = newRun(w);
  walkTo(run, w.goals[0].cells);
  run.stopped = true;                       // no choice was ever offered
  const now = runState(w, run);
  assert.ok(!now.struck);
  assert.equal(now.kept, 1);
});

test('clearing the whole list is never a strike', () => {
  const w = planted(worlds[0], 3);
  const run = newRun(w);
  let got = 0;
  for (const goal of w.goals) { assert.ok(walkTo(run, goal.cells, MOVES)); run.pressedOn = ++got; }
  run.pressedOn = w.goals.length - 1;       // the last press-on that was offered
  run.stopped = true;
  const now = runState(w, run);
  assert.equal(now.reached, w.goals.length);
  assert.ok(now.complete && !now.struck && !now.awaiting);
  assert.equal(now.kept, w.goals.length);
});

test('score rises with every landmark, and a full sweep tops the ladder', () => {
  const w = planted(worlds[0], 4);
  const scores: number[] = [];
  for (let n = 0; n <= w.goals.length; n++) {
    const run = newRun(w);
    let got = 0;
    for (let g = 0; g < n; g++) { walkTo(run, w.goals[g].cells, MOVES); run.pressedOn = ++got; }
    run.banked = true; run.stopped = true;
    scores.push(runState(w, run).score);
  }
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] > scores[i - 1], 'landmark ' + i + ' added nothing');
  assert.equal(runState(w, { ...newRun(w), stopped: true }).kept, 0);
});

test('standing where two landmarks meet collects both, once taken on', () => {
  const w = worlds[0];
  const shared = new Set([idx(30, 30), idx(30, 31)]);
  const fake: World = { ...w, goals: [
    { id: 'a', name: 'a', hint: 'x'.repeat(30), cells: shared, centre: idx(30, 30) },
    { id: 'b', name: 'b', hint: 'x'.repeat(30), cells: shared, centre: idx(30, 31) },
  ] };
  const run: Run = { path: [w.spawn, idx(30, 30)], banked: false, pressedOn: 1, stopped: false };
  assert.deepEqual(touchedOrder(fake, run.path), [0, 1]);
  assert.equal(runState(fake, run).reached, 2);
});

test('touching is a square of the right size', () => {
  const cells = new Set([idx(40, 40)]);
  assert.ok(touching(cells, idx(40, 40)));
  assert.ok(touching(cells, idx(40 + TOUCH, 40 - TOUCH)));
  assert.ok(!touching(cells, idx(40 + TOUCH + 1, 40)));
  assert.ok(touching(new Set([idx(40, 0)]), idx(40, W - TOUCH)), 'and it wraps');
});
