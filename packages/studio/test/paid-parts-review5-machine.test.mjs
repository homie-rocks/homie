/** Review 5, step 6: the state machine as the one writer (orderFact) actually enforces it, against the documented table. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { card, say } from './paid-parts-review5-kit.mjs';
const core = await import('../worker/purchase-core.mjs');
test('M1 every fact from every state through orderFact', async () => {
  const s = await card('m1'); try {
    await (await s.post(s.body())).text(); const id = s.w.sql.prepare('SELECT id FROM purchase_orders').get().id;
    const facts = ['payment', ...core.states.filter((x) => x !== 'started'), 'started'];
    const table = {}; const diffs = [];
    for (const renewal of [false, true]) for (const from of core.states) { table[from] = {}; for (const fact of facts) {
      s.w.sql.prepare('UPDATE purchase_orders SET status = ?, payment = NULL, paid_at = NULL WHERE id = ?').run(from, id);
      let to; try { await core.orderFact(s.w.env, id, fact, {}, { renewal }).run(); to = s.w.sql.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(id).status; } catch (e) { to = `THROWS`; }
      table[from][fact] = to;
      assert.equal(to, core.factState(from, fact, {renewal}));
      const target = fact === 'payment' ? 'paid' : fact; const documented = from === target || core.transitions[from].includes(target) || (renewal && from === 'refunded' && target === 'paid');
      const moved = to === target && from !== target;
      if (to !== 'THROWS' && documented !== (moved || from === target)) diffs.push(`${from} --${fact}${renewal ? '(renewal)' : ''}--> ${to} (table says ${documented ? 'allowed' : 'illegal'})`);
    }
      if (!renewal) say(`M1 ${from.padEnd(9)}:`, Object.entries(table[from]).map(([f, t]) => `${f}->${t === from ? '=' : t}`).join('  ')); }
    say('M1 where the writer and the documented table differ:', diffs);
    say('M1 illegal transitions raise an error:', false, '(the SQL CASE keeps the old status and reports nothing)');
  } finally { s.K.restore(); await s.w.close(); }
});
