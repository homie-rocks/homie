import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, PerspectiveCamera } from 'three';
import { ViewHistory } from './ViewHistory.ts';

test('alternating cameras retain their own previous transforms', () => {
  const history = new ViewHistory();
  const a = new PerspectiveCamera(), b = new PerspectiveCamera(), out = new Matrix4();
  const pose = x => new Matrix4().makeTranslation(x, 0, 0);
  history.sample(a, pose(1), out, false);
  assert.deepEqual(out.elements, pose(1).elements);
  history.sample(b, pose(100), out, false);
  assert.deepEqual(out.elements, pose(100).elements);
  history.sample(a, pose(2), out, false);
  assert.deepEqual(out.elements, pose(1).elements);
  history.sample(b, pose(102), out, false);
  assert.deepEqual(out.elements, pose(100).elements);
  history.sample(a, pose(3), out, false);
  assert.deepEqual(out.elements, pose(2).elements);
});

test('held views seed themselves without resetting other views; invalidation resets all', () => {
  const history = new ViewHistory();
  const a = new PerspectiveCamera(), b = new PerspectiveCamera(), out = new Matrix4();
  const pose = x => new Matrix4().makeTranslation(x, 0, 0);
  history.sample(a, pose(1), out, false);
  history.sample(b, pose(10), out, false);
  history.sample(a, pose(50), out, true);
  assert.deepEqual(out.elements, pose(50).elements);
  history.sample(b, pose(11), out, false);
  assert.deepEqual(out.elements, pose(10).elements);
  history.sample(a, pose(51), out, false);
  assert.deepEqual(out.elements, pose(50).elements);
  history.reset();
  history.sample(a, pose(80), out, false);
  assert.deepEqual(out.elements, pose(80).elements);
  history.sample(b, pose(90), out, false);
  assert.deepEqual(out.elements, pose(90).elements);
});
