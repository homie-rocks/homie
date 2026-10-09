import { test } from 'node:test';
import assert from 'node:assert/strict';
import { states, transition, offerVersion, entitlement } from '../worker/purchase-core.mjs';
const allowed = { started: ['paid','refunded','expired','failed','lapsed'], paid: ['fulfilled','refunded','disputed','lapsed','lost'], fulfilled: ['refunded','disputed','lapsed','lost'], refunded: [], disputed: ['paid','fulfilled','refunded','lapsed','lost'], lapsed: ['paid','refunded','disputed'], expired: ['paid','refunded'], failed: ['paid','refunded'], lost: ['paid','refunded'] };
for (const from of states) for (const to of states) test(`purchase transition ${from} to ${to}`, () => {
  if (from === to || allowed[from].includes(to)) assert.equal(transition(from, to), to);
  else assert.throws(() => transition(from, to), /Illegal purchase transition/);
});
test('offer versions freeze every term and entitlement uses the purchased version', async () => {
  const a = await offerVersion({ kind: 'part', id: 'camera', release: '1.0.0' }, { amount: 1000, currency: 'usd', updates: 'all' });
  const b = await offerVersion(a.resource, { ...a.terms, updates: 'none' });
  assert.notEqual(a.version, b.version);
  const order = { id: 'order', buyer: 'buyer', offerVersion: a.version, state: 'fulfilled' };
  assert.equal(entitlement(order, a).terms.updates, 'all');
  assert.throws(() => entitlement(order, b));
});
test('a different paid subscription invoice can restore a refunded period', () => {
  assert.equal(transition('refunded', 'paid', { renewal: true }), 'paid');
  assert.throws(() => transition('refunded', 'paid'));
});
