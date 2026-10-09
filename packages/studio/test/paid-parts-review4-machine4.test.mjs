/** Review 4: the machine-payment front door, attacked through the Worker's real route with the real Stripe SDK
 *  talking to a stand-in, and the upstream mppx client building credentials. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Challenge, Credential, Receipt } from 'mppx';
import { Mppx, stripe as stripeClientMethod } from 'mppx/client';
import { seller, LIVE_KEY, TEST_KEY } from './paid-parts-review4-seller.mjs';
import { sale$, PP } from './paid-parts-review4-harness.mjs';
import { offer, sync } from './paid-parts-review4-common.mjs';

const URL_ = 'https://seller.example/api/purchases/resource';
const say = (...a) => console.log('#', ...a);
async function setup(name, opts = {}) {
  const w = await seller(name, opts);
  const part = await (await fetch('https://seller.example/parts/camera/0.1.0/part.json')).json();
  const body = (claim = 'b'.repeat(64), extra = {}) => ({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'a'.repeat(64), claim, quote: null, ...extra });
  const quote = await sale$.quoteHash(part, 1, null, (await (await fetch('https://seller.example/parts/catalog.json')).json()).parts[0].releases.find((r) => r.version === '0.1.0').offer);
  const post = (b, headers = {}) => fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ ...b, quote: b.quote ?? quote }) });
  let n = 0;
  const spt = (max = 1000, o = {}) => { const t = `spt_${name}_${++n}`; w.st.spts.set(t, { max, currency: 'usd', ...o }); return t; };
  const challengeOf = async (r) => Challenge.fromResponseList(r).find((c) => c.method === 'stripe');
  const cred = (challenge, token) => Credential.serialize({ challenge, payload: { spt: token } });
  const charges = () => w.st.reqs.filter((r) => r.method === 'POST' && r.path === '/v1/payment_intents' && r.form.confirm !== 'false').length;
  const money = () => [...w.st.pis.values()].filter((p) => p.spt || p.tx).length;
  return { w, part, body, quote, post, spt, challengeOf, cred, charges, money };
}
const text = async (r) => `${r.status} ${(await r.clone().text()).slice(0, 160)}`;

test('A1 happy path through the real route: challenge, SPT credential, files + proof + receipt in one exchange', async () => {
  const s = await setup('a1'); try {
    const r1 = await s.post(s.body()); assert.equal(r1.status, 402);
    const ch = await s.challengeOf(r1);
    const paid = await s.post(s.body(), { authorization: s.cred(ch, s.spt()) });
    assert.equal(paid.status, 200, await text(paid));
    const receipt = Receipt.fromResponse(paid); const j = await paid.json();
    say('A1 receipt', JSON.stringify(receipt), '| files', j.files.length, '| proof', Boolean(j.proof), '| stripe version header', s.w.st.reqs.find((r) => r.path === '/v1/payment_intents' && r.form.confirm !== 'false').version, '| idem', s.w.st.reqs.find((r) => r.path === '/v1/payment_intents' && r.form.confirm !== 'false').idem.slice(0, 30));
    say('A1 PI form', JSON.stringify(s.w.st.reqs.find((r) => r.path === '/v1/payment_intents' && r.form.confirm !== 'false').form));
    assert.equal(s.money(), 1);
  } finally { await s.w.close(); }
});

test('A2 a first credential that fails (malformed) must not brick the order for the valid one', async () => {
  const s = await setup('a2'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    const bad = await s.post(s.body(), { authorization: 'Payment dGhpcyBpcyBnYXJiYWdl' });
    const good = await s.post(s.body(), { authorization: s.cred(ch, s.spt()) });
    say('A2 garbage credential:', await text(bad), '| then valid credential:', await text(good), '| charged', s.money());
    assert.equal(good.status, 200);
  } finally { await s.w.close(); }
});

test('A3 a declined token, then a new approved token for the same order', async () => {
  const s = await setup('a3'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    const declined = await s.post(s.body(), { authorization: s.cred(ch, s.spt(500)) }); // wallet limit below price: Stripe refuses
    const ch2 = await s.challengeOf(declined.status === 402 ? declined : await s.post(s.body()));
    const good = await s.post(s.body(), { authorization: s.cred(ch2, s.spt()) });
    say('A3 declined:', await text(declined), '| new token:', await text(good), '| charged', s.money());
    assert.equal(good.status, 200);
  } finally { await s.w.close(); }
});

test('A4 the person takes longer than the challenge lifetime to approve in the wallet', async (t) => {
  const s = await setup('a4'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    say('A4 challenge lifetime seconds', Math.round((new Date(ch.expires) - Date.now()) / 1000));
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    t.mock.timers.tick(6 * 60_000);
    const late = await s.post(s.body(), { authorization: s.cred(ch, s.spt()) });
    const ch2 = await s.challengeOf(late.status === 402 ? late : await s.post(s.body()));
    const good = await s.post(s.body(), { authorization: s.cred(ch2, s.spt()) });
    t.mock.timers.reset();
    say('A4 expired challenge:', await text(late), '| fresh challenge + token:', await text(good), '| charged', s.money());
    assert.equal(good.status, 200);
  } finally { await s.w.close(); }
});

test('A5 any Authorization header pins the order (Bearer from a proxy or a buggy client)', async () => {
  const s = await setup('a5'); try {
    const first = await s.post(s.body(), { authorization: 'Bearer something' });
    const ch = await s.challengeOf(first.status === 402 ? first : await s.post(s.body()));
    const good = await s.post(s.body(), { authorization: s.cred(ch, s.spt()) });
    say('A5 bearer first:', await text(first), '| then valid:', await text(good));
    assert.equal(good.status, 200);
  } finally { await s.w.close(); }
});

test('A6 an open machine order is a price lock: paid at the old price after reprice, withdrawal and retirement', async () => {
  const s = await setup('a6'); try {
    const first = await s.post(s.body()); assert.equal(first.status, 402);
    await offer(s.w, { amount: '2500' }); await s.w.republish(); const synced = await sync(s.w);
    const cat = (await (await fetch('https://seller.example/parts/catalog.json')).json()).parts[0];
    const again = await s.post(s.body()); const ch = again.headers.has("www-authenticate") ? await s.challengeOf(again) : null;
    const paid = ch ? await s.post(s.body(), { authorization: s.cred(ch, s.spt(1000)) }) : again;
    say('A6 offer now', cat.releases[0].offer.amount, '| sync', JSON.stringify(synced), '| old claim re-challenged at', ch?.request.amount, '| paid:', await text(paid), '| charged amount', [...s.w.st.pis.values()].map((p) => p.amount));
    // retirement
    const s2body = s.body('c'.repeat(64));
    const fresh = await s.post({ ...s2body, quote: await sale$.quoteHash(s.part, 1, null, cat.releases[0].offer) }); assert.equal(fresh.status, 402);
    const retired = await PP.retireResource(s.w.env, 'part', 'camera');
    const afterRetire = await s.post({ ...s2body, quote: await sale$.quoteHash(s.part, 1, null, cat.releases[0].offer) });
    const ch3 = afterRetire.headers.has('www-authenticate') ? await s.challengeOf(afterRetire) : null;
    const paid3 = ch3 ? await s.post({ ...s2body, quote: await sale$.quoteHash(s.part, 1, null, cat.releases[0].offer) }, { authorization: s.cred(ch3, s.spt(2500)) }) : afterRetire;
    say('A6 retired', JSON.stringify(retired).slice(0, 60), '| open order after retirement:', await text(paid3));
    assert.notEqual(paid.status, 200, 'old price honoured after reprice for an unpaid order');
  } finally { await s.w.close(); }
});

test('A7 credential for one order used on another; tampered amount; forged HMAC; replay; double spend', async () => {
  const s = await setup('a7'); try {
    const A = s.body('1'.repeat(64)); const B = s.body('2'.repeat(64));
    const chA = await s.challengeOf(await s.post(A)); const chB = await s.challengeOf(await s.post(B));
    const tA = s.spt(); const cross = await s.post(B, { authorization: s.cred(chA, tA) });
    say('A7 credential of order A on order B:', await text(cross), '| charged', s.money());
    assert.notEqual(cross.status, 200); assert.equal(s.money(), 0);
    // tamper: same challenge, amount lowered
    const C = s.body('3'.repeat(64)); const chC = await s.challengeOf(await s.post(C));
    const tampered = { ...chC, request: { ...chC.request, amount: '50' } };
    const low = await s.post(C, { authorization: s.cred(tampered, s.spt()) });
    say('A7 tampered amount:', await text(low), '| charged', s.money());
    assert.notEqual(low.status, 200); assert.equal(s.money(), 0);
    // forged id
    const D = s.body('4'.repeat(64)); const chD = await s.challengeOf(await s.post(D));
    const forged = await s.post(D, { authorization: s.cred({ ...chD, id: 'A'.repeat(43) }, s.spt()) });
    say('A7 forged challenge id:', await text(forged)); assert.notEqual(forged.status, 200);
    // replay + concurrency on a clean order
    const E = s.body('5'.repeat(64)); const chE = await s.challengeOf(await s.post(E)); const tE = s.spt(); const credE = s.cred(chE, tE);
    const [x, y, z] = await Promise.all([s.post(E, { authorization: credE }), s.post(E, { authorization: credE }), s.post(E, { authorization: credE })]);
    const replay = await s.post(E, { authorization: credE });
    say('A7 three concurrent identical paid requests:', x.status, y.status, z.status, '| replay:', replay.status, '| money moved', s.money(), '| PI posts', s.charges());
    assert.equal(s.money(), 1);
    // the used token on a new order
    const F = s.body('6'.repeat(64)); const chF = await s.challengeOf(await s.post(F));
    const reuse = await s.post(F, { authorization: s.cred(chF, tE) });
    say('A7 spent token on a new order:', await text(reuse)); assert.notEqual(reuse.status, 200); assert.equal(s.money(), 1);
  } finally { await s.w.close(); }
});

test('A8 test mode refuses payment before owner approval', async () => {
  const s = await setup('a8', { key: TEST_KEY }); try {
    const refused = await s.post(s.body());
    assert.equal(refused.status, 403);
    assert.equal(s.money(), 0);
    assert.equal(refused.headers.has('www-authenticate'), false);
    await PP.authorizePurchaseTest(s.w.env, s.w.order().id);
    const challenge = await s.challengeOf(await s.post(s.body()));
    const paid = await s.post(s.body(), { authorization: s.cred(challenge, s.spt()) });
    assert.equal(paid.status, 200, await paid.clone().text());
  } finally { await s.w.close(); }
});

test('A9 live order, shop switched to a test key, and back', async () => {
  const s = await setup('a9'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    const paid = await s.post(s.body(), { authorization: s.cred(ch, s.spt()) }); assert.equal(paid.status, 200);
    s.w.env.STRIPE_KEY = TEST_KEY; s.w.env.PURCHASE_MACHINE_PAYMENTS = JSON.stringify({ test: { profile: 'p' }, live: { profile: 'p' } });
    const cross = await s.post(s.body());
    say('A9 live order under a test key:', await text(cross));
    assert.notEqual(cross.status, 200);
  } finally { await s.w.close(); }
});

test('A10 the payment succeeds at Stripe but the order write fails once: the buyer is delivered, not charged twice', async () => {
  const s = await setup('a10'); try {
    const ch = await s.challengeOf(await s.post(s.body())); const token = s.spt(); const credential = s.cred(ch, token);
    const batch = s.w.env.DB.batch; let failed = 0;
    s.w.env.DB.batch = async (list) => { if (!failed && s.w.st.pis.size === 1) { failed++; throw new Error('D1_ERROR: transient'); } return batch(list); };
    const first = await s.post(s.body(), { authorization: credential });
    const second = await s.post(s.body(), { authorization: credential });
    const third = await s.post(s.body(), { authorization: credential });
    say('A10 first (write failed after charge):', await text(first), '| retry:', second.status, '| retry 2:', third.status, '| money moved', s.money(), '| order', s.w.order().status);
    assert.equal(first.status, 503, 'an uncertain charge must not issue another payment challenge');
    assert.equal(first.headers.has('www-authenticate'), false);
    assert.equal(s.money(), 1);
    assert.ok([second.status, third.status].includes(200));
  } finally { await s.w.close(); }
});

test('A11 Stripe answers requires_action or processing', async () => {
  const s = await setup('a11'); try {
    s.w.st.piStatus = 'processing';
    const ch = await s.challengeOf(await s.post(s.body()));
    const r = await s.post(s.body(), { authorization: s.cred(ch, s.spt()) });
    say('A11 PaymentIntent processing:', await text(r), '| order', s.w.order().status, '| money objects', s.money());
    const pi = [...s.w.st.pis.values()][0];
    const ev = await s.w.event('payment_intent.succeeded', { id: pi.id, object: 'payment_intent', amount: pi.amount, currency: pi.currency, livemode: true, metadata: pi.metadata });
    const after = await s.post(s.body());
    say('A11 then payment_intent.succeeded webhook:', ev.slice(0, 60), '| same claim, no credential:', after.status, '| order', s.w.order().status);
    assert.equal(after.status, 200);
  } finally { await s.w.close(); }
});

test('A12 unauthenticated requests create order rows before any payment', async () => {
  const s = await setup('a12'); try {
    for (let i = 0; i < 50; i++) await s.post(s.body(i.toString(16).padStart(64, '0')));
    const rows = s.w.sql.prepare("SELECT COUNT(*) AS n FROM purchase_orders").get().n; const meta = s.w.sql.prepare('SELECT COUNT(*) AS n FROM meta').get().n;
    say('A12 50 unpaid POSTs ->', rows, 'purchase_orders rows,', meta, 'meta rows; expiry of machine orders:', s.w.sql.prepare("SELECT COUNT(*) AS n FROM purchase_orders WHERE status = 'started'").get().n, 'still started after sync', JSON.stringify(await sync(s.w)));
  } finally { await s.w.close(); }
});
