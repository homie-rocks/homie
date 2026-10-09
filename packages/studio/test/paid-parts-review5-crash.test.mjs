/** Review 5, step 3: stop the process at every boundary of a paid request through the Worker's real route, restart,
 *  reconcile (cron), and require: money moved at most once; money moved => fulfilled (the claim gets a grant) or
 *  refunded; no money => no access; the owner can see the order. Then the same with the files gone (must refund). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { card, base, say, text, orders, jobs, settlements, cron, office, netCard, cardCharges } from './paid-parts-review5-kit.mjs';

const rails = {
  card: { make: (n) => card(n), claim: 'b'.repeat(64), pay: async (s) => { const r1 = await s.post(s.body()); const ch = await s.challengeOf(r1); const headers = { authorization: s.cred(ch, s.spt()) }; return () => s.post(s.body(), headers); }, moved: (s) => cardCharges(s.w).length, net: (s) => netCard(s.w) },
  base: { make: (n) => base(n), claim: 'd'.repeat(64), pay: async (s) => { const r1 = await s.post(s.body()); const headers = await s.sign(r1); return () => s.post(s.body(), headers); }, moved: (s) => s.C.moved(), net: (s) => s.C.moved() - s.w.st.refunds.length },
};
const attempt = async (fn) => { try { return await text(await fn()); } catch (e) { return `THREW ${e.message}`; } };
async function judge(s, R, label) {
  const o = orders(s.w)[0]; const moved = R.moved(s); const net = R.net(s);
  const g = o ? await s.grant(R.claim).catch((e) => ({ status: `THREW ${e.message}` })) : { status: 'no-order' };
  const off = await office(s.w).catch((e) => ({ error: e.message }));
  const visible = Boolean(off.orders?.some((x) => x.id === o?.id));
  const pending = `${jobs(s.w).map((j) => j.state).join(',')}|${settlements(s.w).map((x) => x.state).join(',')}`;
  let bad = null;
  if (moved > 1) bad = `money moved ${moved} times`;
  else if (net === 1 && g.status !== 200) bad = `paid and not delivered (order ${o?.status}, grant ${g.status})`;
  else if (net === 0 && g.status === 200) bad = 'delivered without payment';
  else if (moved === 1 && net === 0 && o?.status !== 'refunded') bad = `refunded at the provider but order is ${o?.status}`;
  else if (moved === 1 && !visible) bad = 'money moved and the owner cannot see the order';
  const line = `${label}: order ${o?.status ?? 'none'} moved ${moved} net ${net} grant ${g.status} ownerSees ${visible} [${pending}]${bad ? '  <<< ' + bad : ''}`;
  return { bad, line, o };
}

for (const rail of ['card', 'base']) test(`C1 ${rail}: kill at every boundary of the paid request, restart, cron only`, { timeout: 900000 }, async () => {
  const R = rails[rail]; const bad = [];
  for (let n = 1; n <= 60; n++) {
    const s = await R.make(`c1${rail}${n}`); try {
      const pay = await R.pay(s);
      s.K.at = s.K.n + n; const first = await attempt(pay);
      if (!s.K.dead) { say(`C1 ${rail} boundaries in a paid request: ${n - 1}`); break; }
      const at = s.K.diedAt; s.K.revive();
      const c = await cron(s.w, 3);
      const j = await judge(s, R, `C1 ${rail} kill#${n} after [${at}] -> cron ${c.join('/')}`);
      say(j.line); if (j.bad) bad.push(j.line);
      // now the buyer comes back with the same credential
      const again = await attempt(pay); const j2 = await judge(s, R, `C1 ${rail} kill#${n}   buyer retries: ${again.slice(0, 90)}`);
      say(j2.line); if (j2.bad) bad.push(j2.line);
    } finally { s.K.restore(); await s.w.close(); }
  }
  assert.deepEqual(bad, []);
});

for (const rail of ['card', 'base']) test(`C2 ${rail}: kill at every boundary, restart, the buyer retries first (no cron yet), then cron`, { timeout: 900000 }, async () => {
  const R = rails[rail]; const bad = [];
  for (let n = 1; n <= 60; n++) {
    const s = await R.make(`c2${rail}${n}`); try {
      const pay = await R.pay(s);
      s.K.at = s.K.n + n; await attempt(pay);
      if (!s.K.dead) break;
      const at = s.K.diedAt; s.K.revive();
      const again = await attempt(pay);
      const again2 = await attempt(pay);
      const j = await judge(s, R, `C2 ${rail} kill#${n} after [${at}] -> retry: ${again.slice(0, 70)} | retry2: ${again2.slice(0, 40)}`);
      say(j.line); if (j.bad) bad.push(j.line);
      await cron(s.w, 2); const j2 = await judge(s, R, `C2 ${rail} kill#${n}   then cron`); if (j2.bad) { say(j2.line); bad.push(j2.line); }
    } finally { s.K.restore(); await s.w.close(); }
  }
  assert.deepEqual(bad, []);
});

for (const rail of ['card', 'base']) test(`C3 ${rail}: kill at every boundary, files gone before restart: retains payment until storage is restored`, { timeout: 900000 }, async () => {
  const R = rails[rail]; const bad = [];
  for (let n = 1; n <= 60; n++) {
    const s = await R.make(`c3${rail}${n}`); try {
      const pay = await R.pay(s);
      s.K.at = s.K.n + n; await attempt(pay);
      if (!s.K.dead) break;
      const at = s.K.diedAt; s.K.revive();
      const o0 = orders(s.w)[0];
      if (o0?.status === 'fulfilled') { continue; } // delivered before the files went: not this test
      const kept = new Map(s.w.objects); for (const k of [...s.w.objects.keys()]) if (k.startsWith('paid-parts/files/')) s.w.objects.delete(k);
      const gone = kept.size - s.w.objects.size;
      const c = await cron(s.w, 3);
      const o = orders(s.w)[0]; const moved = R.moved(s); const refunds = s.w.st.refunds.length;
      let b = null;
      if (moved === 1 && !(o.status === 'paid' && refunds === 0)) b = `money moved, files gone, order ${o.status}, refunds ${refunds}`;
      if (moved === 0 && refunds) b = `refund without payment`;
      if (refunds > 1) b = `refunded ${refunds} times`;
      const line = `C3 ${rail} kill#${n} after [${at}] files removed ${gone} -> cron ${c.join('/')}: order ${o?.status} moved ${moved} refunds ${refunds} [${jobs(s.w).map((x) => x.state + (x.error ? '!' + x.error.slice(0, 50) : '')).join(',')}|${settlements(s.w).map((x) => x.state).join(',')}]${b ? '  <<< ' + b : ''}`;
      say(line); if (b) bad.push(line);
      for (const [k,v] of kept) s.w.objects.set(k,v);
      await cron(s.w, 2);
      if (moved === 1) assert.equal((await s.grant(R.claim)).status, 200);
    } finally { s.K.restore(); await s.w.close(); }
  }
  assert.deepEqual(bad, []);
});

for (const rail of ['card', 'base']) test(`C4 ${rail}: crash after settlement, then kill the RECOVERY at every boundary, restart, cron again`, { timeout: 900000 }, async () => {
  const R = rails[rail]; const bad = [];
  // find the boundary right after the money moved
  const probe = await R.make(`c4${rail}p`); let moneyAt = 0;
  try { const pay = await R.pay(probe); const n0 = probe.K.n; await pay(); const t = probe.K.trace.slice(n0); moneyAt = (rail === 'card' ? t.findLastIndex((x) => /net POST .*\/v1\/payment_intents$/.test(x)) : t.findIndex((x) => /x402\/settle/.test(x))) + 1; } finally { probe.K.restore(); await probe.w.close(); }
  say(`C4 ${rail}: money moves at boundary ${moneyAt}`);
  for (const filesGone of [false, true]) for (let m = 1; m <= 40; m++) {
    const s = await R.make(`c4${rail}${filesGone ? 'g' : 'k'}${m}`); try {
      const pay = await R.pay(s);
      s.K.at = s.K.n + moneyAt; await attempt(pay); assert.ok(s.K.dead); s.K.revive();
      if (filesGone) for (const k of [...s.w.objects.keys()]) if (k.startsWith('paid-parts/files/')) s.w.objects.delete(k);
      s.K.at = s.K.n + m; const c1 = await cron(s.w, 1);
      if (!s.K.dead) { say(`C4 ${rail} filesGone=${filesGone}: recovery has ${m - 1} boundaries`); break; }
      const at = s.K.diedAt; s.K.revive();
      const c2 = await cron(s.w, 3);
      const o = orders(s.w)[0]; const moved = R.moved(s); const refunds = s.w.st.refunds.length;
      let b = null;
      if (moved !== 1) b = `money moved ${moved} times`;
      else if (filesGone && !(o.status === 'paid' && refunds === 0)) b = `files gone: order ${o.status}, refunds ${refunds}`;
      else if (!filesGone) { const g = await s.grant(R.claim); if (g.status !== 200 || refunds) b = `files present: order ${o.status}, grant ${g.status}, refunds ${refunds}`; }
      const line = `C4 ${rail} filesGone=${filesGone} recovery kill#${m} after [${at}] -> cron ${c2.join('/')}: order ${o.status} moved ${moved} refunds ${refunds} [${jobs(s.w).map((x) => x.state).join(',')}|${settlements(s.w).map((x) => x.state).join(',')}]${b ? '  <<< ' + b : ''}`;
      say(line); if (b) bad.push(line);
    } finally { s.K.restore(); await s.w.close(); }
  }
  assert.deepEqual(bad, []);
});
