/** Real Workers runtime: no credentials or external network. Miniflare is a required dev dependency. */
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

for (const compatibilityDate of ['2025-01-01', '2026-06-01']) test(`statement send and changed shop APIs in workerd (${compatibilityDate})`, {
  timeout: 30000,
}, async () => {
  const bundled = await build({ bundle: true, write: false, format: 'esm', platform: 'browser', stdin: {
    resolveDir: fileURLToPath(new URL('../worker/', import.meta.url)),
    contents: `import { sendStatements } from './referrals.mjs';
      import { productIdOf, stripeCall } from './stripe.mjs';
      import { money } from './shop-rules.mjs';
      import { migrationNeeded, newOrderId } from './shop-store.mjs';
      export default { async fetch(request, env) {
        const id = await productIdOf('studio', 'item with spaces');
        const stripe = await stripeCall({ STRIPE_KEY: 'rk_test_' + 'a'.repeat(32) }, 'GET', '/v1/checkout/sessions/test', { expand: ['payment_intent.latest_charge'] }, { timeout: 2000 });
        return Response.json({ id, order: newOrderId(), money: money(5120, 'bhd'), stripe,
          migration: await migrationNeeded(env),
          send: await sendStatements(env, 'https://seller.example', { referrals: { rate: 1 } }, '2026-09') });
      } };`,
  } });
  let redirect = '', requests = [], delivered = [];
  const mf = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: { name: 'shop-test', compatibilityDate,
    manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: bundled.outputFiles[0].text } } },
    env: { DB: { type: 'd1', id: 'shop-test' } },
  }, dev: { outboundService: { type: 'fetcher', handler: async (req) => {
      const url = new URL(req.url);
      requests.push(req.url);
      if (url.hostname === 'api.stripe.com') return Response.json({ id: 'test', expanded: url.searchParams.get('expand[0]') });
      assert.equal(url.hostname, 'referrer.example');
      if (url.pathname.includes('well-known')) {
        if (redirect === 'manifest') return new Response(null, { status: 302, headers: { location: 'https://unexpected.example/' } });
        return Response.json({ referrals: { statements: 'https://referrer.example/receive' } });
      }
      if (redirect === 'post') return new Response(null, { status: 307, headers: { location: 'https://unexpected.example/' } });
      delivered.push(await req.json());
      return Response.json({ ok: true });
    } } } }],
  });
  try {
    const db = await mf.getD1Database('DB');
    for (const file of ['0001_studio.sql', '0008_studio_shop.sql', '0010_shop_reservations.sql', '0011_shop_statements.sql', '0012_shop_lines.sql']) {
      const sql = readFileSync(new URL(`../../../template/site/migrations/${file}`, import.meta.url), 'utf8');
      for (const statement of sql.replace(/^--.*$/gm, '').split(';').filter((s) => s.trim())) await db.prepare(statement).run();
    }
    await db.prepare("INSERT INTO referral_lines (order_id, via, net, rate, share, currency, state, period, hold_until, created_at) VALUES ('order', 'referrer.example', 100, 1, 100, 'usd', 'owed', '2026-09', 1, 1)").run();
    for (redirect of ['', 'manifest', 'post']) {
      requests = []; delivered = [];
      await db.prepare("INSERT INTO meta (key, value) VALUES ('referral-send:https://seller.example|2026-09', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ cursor: '', attempts: 3 })).run();
      const res = await mf.dispatchFetch('https://seller.example/test');
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.match(body.id, /^homie_studio_item_[a-f0-9]{64}$/);
      assert.match(body.order, /^ord_[A-Za-z0-9]{20}$/);
      assert.equal(body.stripe.expanded, 'payment_intent.latest_charge');
      assert.equal(body.migration, null);
      assert.equal(body.send.sent.length, 1, JSON.stringify(body.send));
      assert.equal(body.send.sent[0].ok, !redirect, JSON.stringify(body.send));
      assert.equal(delivered.length, redirect ? 0 : 1);
      if (!redirect) {
        assert.equal(delivered[0].statement.totals.due, 100);
        assert.ok(delivered[0].sig);
      }
      assert.ok(requests.every((url) => !url.includes('unexpected')));
      if (redirect === 'manifest') assert.ok(!requests.some((url) => url.endsWith('/receive')));
    }
  } finally { await mf.dispose(); }
});

test('missing and released payments grant once and refund in workerd', { timeout: 30000 }, async () => {
  const { createHmac } = await import('node:crypto');
  const secret = 'whsec_' + 'test'.repeat(8);
  const cat = { studio: { name: 'Test studio' }, shop: { till: 'stripe', currency: 'usd', items: [{ id: 'badge', kind: 'supporter', name: 'Badge', price: 500, gives: ['badge:test'] }] } };
  const bundled = await build({ bundle: true, write: false, format: 'esm', platform: 'browser', stdin: {
    resolveDir: fileURLToPath(new URL('../worker/', import.meta.url)),
    contents: `import { shopRoutes, shopOf, reconcileOrders, performRelease, performRefund } from './shop.mjs';
      import { spentThisMonth, shopDataOf } from './shop-store.mjs';
      const cat = ${JSON.stringify(cat)};
      export default { async fetch(request, env) {
        env.STRIPE_KEY = 'rk_test_' + 'a'.repeat(32);
        env.STRIPE_WEBHOOK_SECRET = ${JSON.stringify(secret)};
        const url = new URL(request.url), shop = shopOf(cat), order = url.searchParams.get('order');
        if (url.pathname === '/reconcile') { await reconcileOrders(env, shop, 'pl_bbbbbbbbbbbbbbbbbbbbbb'); return Response.json({ ok: true }); }
        if (url.pathname === '/release') return Response.json(await performRelease(env, { order, by: 'account pl_owner' }));
        if (url.pathname === '/refund') return Response.json(await performRefund(env, cat, { order, reason: 'requested_by_customer' }));
        if (url.pathname === '/account') return Response.json({ ...await shopDataOf(env, 'pl_bbbbbbbbbbbbbbbbbbbbbb'), spent: await spentThisMonth(env, 'pl_bbbbbbbbbbbbbbbbbbbbbb') });
        return shopRoutes(request, env, {}, url, { catalogueOf: async () => cat });
      } };`,
  } });
  let missing = true;
  const expired = [];
  const mf = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: { name: 'late-payment', compatibilityDate: '2025-01-01',
    manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: bundled.outputFiles[0].text } } },
    env: { DB: { type: 'd1', id: 'late-payment' } },
  }, dev: { outboundService: { type: 'fetcher', handler: async (request) => {
    const url = new URL(request.url);
    assert.equal(url.hostname, 'api.stripe.com');
    if (url.pathname.endsWith('/expire')) { expired.push(url.pathname); return Response.json({ status: 'expired' }); }
    if (url.pathname === '/v1/refunds') return Response.json({ id: 're_test', status: 'succeeded' });
    if (missing) return Response.json({ error: { code: 'resource_missing' } }, { status: 404 });
    return Response.json({ id: url.pathname.split('/').pop(), status: 'open' });
  } } } }] });
  try {
    const db = await mf.getD1Database('DB');
    for (const file of ['0001_studio.sql', '0008_studio_shop.sql', '0010_shop_reservations.sql', '0011_shop_statements.sql', '0012_shop_lines.sql']) {
      const sql = readFileSync(new URL(`../../../template/site/migrations/${file}`, import.meta.url), 'utf8');
      for (const statement of sql.replace(/^--.*$/gm, '').split(';').filter((s) => s.trim())) await db.prepare(statement).run();
    }
    const get = async (path) => (await mf.dispatchFetch(`https://studio.example${path}`)).json();
    for (const state of ['missing', 'released']) {
      const order = `ord_${state.padEnd(20, '0')}`, session = `cs_test_${state}`;
      await db.prepare("INSERT INTO shop_orders (id, player, item, amount, currency, till, mode, status, session, created_at, updated_at, expires_at) VALUES (?, 'pl_bbbbbbbbbbbbbbbbbbbbbb', 'badge', 500, 'usd', 'stripe', 'test', 'processing', ?, 1, 1, 1)").bind(order, session).run();
      await db.prepare("INSERT INTO shop_order_lines (id, order_id, position, item, quantity, unit_amount, amount) VALUES (?, ?, 0, 'badge', 1, 500, 500)").bind(order + '_0', order).run();
      if (state === 'missing') await get('/reconcile');
      else { missing = false; assert.equal((await get(`/release?order=${order}`)).ok, true); }
      assert.equal((await db.prepare('SELECT status FROM shop_orders WHERE id = ?').bind(order).first()).status, state);
      const account = await get('/account');
      assert.equal(account.spent, 0);
      assert.equal(account.orders.find((o) => o.id === order).status, 'processing');
      assert.ok(account.orders.every((o) => !('note' in o)));
      const send = async (id) => {
        const t = Math.floor(Date.now() / 1000);
        const body = JSON.stringify({ id, type: state === 'missing' ? 'checkout.session.async_payment_succeeded' : 'checkout.session.completed', livemode: false,
          data: { object: { id: session, metadata: { order }, client_reference_id: 'pl_bbbbbbbbbbbbbbbbbbbbbb', currency: 'usd', amount_subtotal: 500, payment_status: 'paid', payment_intent: `pi_${state}` } } });
        const signature = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
        const response = await mf.dispatchFetch('https://studio.example/api/shop/hook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${signature}` }, body });
        assert.equal(response.status, 200);
        return response.json();
      };
      assert.equal((await send(`evt_${state}`)).did, 'paid');
      assert.equal((await send(`evt_${state}`)).duplicate, true);
      assert.equal((await send(`evt_${state}_again`)).did, 'already');
      const paid = await get('/account');
      assert.equal(paid.spent, 500);
      assert.equal(paid.owns.length, 1);
      assert.equal((await get(`/refund?order=${order}`)).ok, true);
      const refunded = await get('/account');
      assert.equal(refunded.spent, 0);
      assert.equal(refunded.owns.length, 0);
    }
    assert.equal(expired.length, 1);
  } finally { await mf.dispose(); }
});
