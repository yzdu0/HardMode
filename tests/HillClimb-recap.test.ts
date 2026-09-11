import test from 'node:test';
import assert from 'node:assert/strict';
import { H, W, idx } from '../src/HillClimb-world.ts';
import { newRun, runState } from '../src/HillClimb-run.ts';
import { climbSparkline, dailyLink, linkedDay, recapFor, shareResult } from '../src/HillClimb-recap.ts';
import type { World } from '../src/HillClimb-world.ts';

function fixture(): World {
  const metres = new Int16Array(W * H);
  metres[idx(40, 0)] = 200;
  metres[idx(40, 6)] = 1000;
  metres[idx(40, 10)] = 400;
  metres[idx(40, 156)] = 3901;
  return {
    day: '2026-09-11', metres, depth: new Float32Array(W * H),
    tempC: new Float32Array(W * H), rain: new Float32Array(W * H),
    biome: new Uint8Array(W * H), land: new Uint8Array(W * H),
    summit: idx(40, 156), summitM: 3901, spawn: idx(40, 0), rungs: 1,
    goals: [{ id: 'desert', name: 'a desert', hint: '', centre: idx(40, 5), cells: new Set([idx(40, 5)]) }],
  };
}

test('recap matches scored heights, reports the first high and records challenge moments', () => {
  const world = fixture();
  const run = { ...newRun(world), stopped: true, path: [world.spawn, idx(40, 5), idx(40, 10)] };
  const recap = recapFor(world, run);
  assert.deepEqual(recap.heights, [200, 1000, 400]);
  assert.equal(recap.heights[recap.bestMove], runState(world, run).best);
  assert.equal(recap.bestMove, 1);
  assert.deepEqual(recap.moments, [[], ['a desert'], []]);
  assert.equal(recap.closest, 4, 'the summit distance uses the short way around the seam');
  assert.equal(recap.insight, 'You came within 4 squares of the summit.');
  assert.deepEqual(recapFor(world, JSON.parse(JSON.stringify(run))), recap);
});

test('recap recognises a summit within the scoring radius, even off the stop lattice', () => {
  const world = fixture();
  const run = { ...newRun(world), stopped: true, path: [world.spawn, idx(40, 155)] };
  const recap = recapFor(world, run);
  assert.equal(recap.bestMove, 1);
  assert.equal(recap.insight, 'You reached the highest ground on the planet.');
});

test('partially completed challenges only outline their unvisited regions', () => {
  const world = fixture();
  const visited = new Set([idx(40, 5)]), missed = new Set([idx(20, 80)]);
  world.goals[0] = { ...world.goals[0], required: 2, regions: [visited, missed], cells: new Set([...visited, ...missed]) };
  const run = { ...newRun(world), stopped: true, path: [world.spawn, idx(40, 5)] };
  assert.equal(runState(world, run).found.length, 0);
  assert.deepEqual(recapFor(world, run).missed, [missed]);
});

test('share includes the date, grade squares, journey and challenge link without map spoilers', () => {
  const world = fixture();
  const run = { ...newRun(world), stopped: true, path: [world.spawn, idx(40, 5), idx(40, 10)] };
  const state = runState(world, run);
  const text = shareResult(world, run, state);
  assert.equal(text.split('\n')[1], `${state.score} 🟩⬜⬜⬜⬜`);
  assert.ok(text.includes('My climb ▂█▄'));
  assert.ok(text.includes('1,000 m climbed, 2 moves'));
  assert.ok(text.includes('1/1 challenges'));
  assert.ok(text.endsWith(dailyLink(world.day)));
  assert.ok(!text.includes('3,901'));
  assert.ok(!text.includes('desert'));
  assert.ok(!text.includes('summit'));
  assert.equal(new URL(dailyLink(world.day)).searchParams.get('date'), world.day);
});

test('immediate stops and all-sea journeys produce usable recaps and share traces', () => {
  const world = fixture();
  world.metres.fill(0);
  world.summitM = 0;
  const run = { ...newRun(world), stopped: true };
  const recap = recapFor(world, run);
  assert.equal(recap.bestMove, 0);
  assert.equal(climbSparkline(recap.heights), '▁');
  assert.equal(climbSparkline([0, 0, 0]), '▁▁▁');
  assert.ok(!shareResult(world, run, runState(world, run)).includes('NaN'));
});

test('dated links respect the available archive and reject invalid calendar dates', () => {
  assert.equal(linkedDay('2026-09-08', '2026-09-08', '2026-09-11'), '2026-09-08');
  assert.equal(linkedDay('2026-09-11', '2026-09-08', '2026-09-11'), '2026-09-11');
  for (const value of [null, '', '2026-09-07', '2026-09-12', '2026-9-10', '<script>']) {
    assert.equal(linkedDay(value, '2026-09-08', '2026-09-11'), null);
  }
  assert.equal(linkedDay('2026-02-30', '2026-01-01', '2026-09-11'), null);
  assert.equal(linkedDay('2024-02-29', '2024-01-01', '2026-09-11'), '2024-02-29');
});
