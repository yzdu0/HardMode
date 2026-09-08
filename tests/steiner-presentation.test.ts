import test from 'node:test';
import assert from 'node:assert/strict';
import { roadConnections, RouteHistory } from '../src/steiner-presentation.ts';

test('road joins form reciprocal cardinal branches, never diagonal shortcuts', () => {
  const route = new Set(['1,1', '0,1', '1,2', '2,1', '1,0', '0,0']);
  const joins = roadConnections(3, route);
  assert.equal(joins.get('1,1'), 15);
  assert.equal(joins.get('1,2'), 8);
  assert.equal(joins.get('2,1'), 1);
  assert.equal(roadConnections(3, new Set(['0,0', '1,1'])).get('0,0'), 0);
});

test('road joins mark only enabled wrapping seams', () => {
  const route = new Set(['0,0', '0,2', '2,0']);
  assert.equal(roadConnections(3, route).get('0,0'), 0);
  assert.equal(roadConnections(3, route, true).get('0,0'), 8);
  assert.equal(roadConnections(3, route, true, true).get('0,0'), 9);
  assert.equal(roadConnections(3, route, true, true).get('2,0'), 4);
});

test('Undo restores a whole stroke and Clear without changing earlier snapshots', () => {
  const h = new RouteHistory(), route = new Set<string>();
  h.begin(route); route.add('1,1'); route.add('1,2'); h.commit(route);
  h.begin(route); route.clear(); h.commit(route);
  assert.deepEqual(h.undo(), new Set(['1,1', '1,2']));
  assert.deepEqual(h.undo(), new Set());
  assert.equal(h.available, false);
});

test('no-op gestures are ignored and board changes discard history', () => {
  const h = new RouteHistory(), route = new Set(['1,1']);
  h.begin(route); h.commit(route);
  assert.equal(h.available, false);
  h.begin(route); route.add('1,2'); h.commit(route);
  assert.equal(h.available, true);
  h.reset();
  assert.equal(h.undo(), undefined);
  h.begin(route); h.reset(); h.commit(new Set());
  assert.equal(h.available, false);
});

test('repeated gesture starts retain the original snapshot and history is bounded', () => {
  const h = new RouteHistory(), route = new Set<string>();
  h.begin(route); route.add('0,0'); h.begin(route); route.add('0,1'); h.commit(route);
  assert.deepEqual(h.undo(), new Set());
  for (let i = 0; i < 80; i++) { h.begin(route); route.add(String(i)); h.commit(route); }
  let count = 0;
  while (h.undo()) count++;
  assert.equal(count, 64);
});
