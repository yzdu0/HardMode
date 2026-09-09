import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { readResult, tally, GAMES, BUCKETS } from '../worker/index.ts';

const TODAY = '2026-09-08';
const ok = (over: Record<string, unknown> = {}) =>
  ({ day: TODAY, game: 'graphle', player: 'abcd1234efgh', bucket: '3', ...over });

test('the old lowercase HillClimb URL redirects to its canonical casing', async () => {
  const home = await worker.fetch(new Request('https://nphard.app/hillclimb/'), {});
  assert.equal(home.status, 308);
  assert.equal(home.headers.get('location'), 'https://nphard.app/HillClimb/');

  const subpage = await worker.fetch(new Request('https://nphard.app/hillclimb/world/?date=2026-09-09'), {});
  assert.equal(subpage.status, 308);
  assert.equal(subpage.headers.get('location'), 'https://nphard.app/HillClimb/world/?date=2026-09-09');
});

test('a well-formed result is accepted', () => {
  const { row, why } = readResult(ok(), TODAY);
  assert.equal(why, undefined);
  assert.deepEqual(row, { day: TODAY, game: 'graphle', player: 'abcd1234efgh', bucket: '3' });
});

test('every game accepts exactly its own buckets and no others', () => {
  for (const game of GAMES) {
    if (game === 'HillClimb') continue;
    for (const bucket of BUCKETS[game]) {
      assert(readResult(ok({ game, bucket }), TODAY).row, game + ' should accept ' + bucket);
    }
    // A bucket belonging to a different game must not slip through.
    const foreign = GAMES.flatMap(g => [...BUCKETS[g]]).filter(b => !BUCKETS[game].includes(b));
    for (const bucket of new Set(foreign)) {
      assert.equal(readResult(ok({ game, bucket }), TODAY).row, undefined,
        game + ' should refuse ' + bucket);
    }
  }
});

test('HillClimb stores exact scores rather than grades', () => {
  for (const bucket of ['0', '1', '55', '115', '244']) {
    assert(readResult(ok({ game: 'HillClimb', bucket }), TODAY).row, 'score ' + bucket + ' should be accepted');
  }
  for (const bucket of ['S', 'A', '-1', '01', '245', '999', '55.5']) {
    assert.equal(readResult(ok({ game: 'HillClimb', bucket }), TODAY).row, undefined,
      bucket + ' is not an exact valid score');
  }
});

test('HillClimb accepts only today and the three previous local days', () => {
  const shift = (days: number) =>
    new Date(Date.parse(TODAY + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  for (const daysAgo of [0, 1, 2, 3]) {
    assert(readResult(ok({ game: 'HillClimb', bucket: '82', day: shift(-daysAgo) }), TODAY).row,
      daysAgo + ' days ago should be playable');
  }
  // The server permits one additional UTC day for players west of the date
  // line, whose local third-prior day is already four dates behind UTC.
  assert.equal(readResult(ok({ game: 'HillClimb', bucket: '82', day: shift(-5) }), TODAY).row, undefined);
});

test('malformed submissions are refused rather than stored', () => {
  const bad: [unknown, string][] = [
    [null, 'null body'],
    ['a string', 'non-object'],
    [ok({ day: 'yesterday' }), 'unparseable day'],
    [ok({ day: '2026-9-8' }), 'unpadded day'],
    [ok({ game: 'sudoku' }), 'unknown game'],
    [ok({ player: 'SHOUTY' }), 'player with capitals'],
    [ok({ player: 'short' }), 'player too short'],
    [ok({ player: 'x'.repeat(41) }), 'player too long'],
    [ok({ player: 'abcd1234-efgh' }), 'player with punctuation'],
    [ok({ bucket: '7' }), 'bucket past the guess limit'],
    [ok({ bucket: 3 }), 'numeric bucket'],
  ];
  for (const [body, why] of bad) {
    const out = readResult(body, TODAY);
    assert.equal(out.row, undefined, 'accepted ' + why);
    assert(typeof out.why === 'string' && out.why.length, 'no reason given for ' + why);
  }
});

test('only days the archive still offers are accepted', () => {
  const shift = (days: number) =>
    new Date(Date.parse(TODAY + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  assert(readResult(ok({ day: shift(0) }), TODAY).row, 'today');
  assert(readResult(ok({ day: shift(-89) }), TODAY).row, 'the oldest archive day');
  assert.equal(readResult(ok({ day: shift(2) }), TODAY).row, undefined, 'the day after tomorrow');
  assert.equal(readResult(ok({ day: shift(-91) }), TODAY).row, undefined, 'fallen out of the archive');
});

test('a player east of the date line is still playing today', () => {
  // The board a player is given comes from their own calendar, and the server
  // keeps time in UTC. Between UTC midnight and their own, anyone ahead of UTC
  // is on a date the server has not reached — and anyone behind it is on one
  // the server has already left. Both are today where they are standing.
  const shift = (days: number) =>
    new Date(Date.parse(TODAY + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  assert(readResult(ok({ day: shift(1) }), TODAY).row, 'a day ahead of UTC, as in New Zealand');
  assert(readResult(ok({ day: shift(-90) }), TODAY).row, 'a day behind UTC, as in Hawaii');
});

test('the tally covers every game and ignores rows it cannot place', () => {
  const games = tally([
    { game: 'graphle', bucket: '3', n: 5 },
    { game: 'graphle', bucket: 'X', n: 2 },
    { game: 'steiner', bucket: '0', n: 4 },
    { game: 'HillClimb', bucket: '117', n: 3 },
    { game: 'HillClimb', bucket: '82', n: 2 },
    { game: 'HillClimb', bucket: 'A', n: 9 }, // legacy grade: its exact score is unknowable
    { game: 'graphle', bucket: '9', n: 99 },   // a bucket that no longer exists
    { game: 'chess', bucket: '1', n: 99 },     // a game that never did
  ]);
  assert.deepEqual(Object.keys(games).sort(), [...GAMES].sort(), 'every game gets a slot');
  assert.equal(games.graphle.total, 7, 'unknown buckets must not inflate the total');
  assert.deepEqual(games.graphle.buckets, { '1': 0, '2': 0, '3': 5, '4': 0, '5': 0, '6': 0, X: 2 });
  assert.equal(games.steiner.total, 4);
  assert.equal(games.facility.total, 0, 'a game nobody finished still reports zero');
  assert.equal(games.HillClimb.total, 5, 'only exact HillClimb scores belong in its distribution');
  assert.deepEqual(games.HillClimb.buckets, { '82': 2, '117': 3 });
  // Every declared bucket is present, so the page never has to guess a shape.
  // Membership, not order: integer-like keys are reordered by the language, so
  // the payload cannot carry display order and the page supplies its own.
  for (const game of GAMES) {
    if (game === 'HillClimb') continue;
    assert.deepEqual(Object.keys(games[game].buckets).sort(), [...BUCKETS[game]].sort());
  }
});
