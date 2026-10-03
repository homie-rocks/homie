/**
 * `homie-studio shop` — a studio's shop from the studio folder (@homie-rocks/studio 0.24.0; worker/shop.mjs has the
 * rules, shop/SHOP.md the guide, shop/SELLING.md the owner's plain words).
 *
 *   homie-studio shop                       is it selling, and if not, what is missing (the live site's office view)
 *   homie-studio shop init [--supporter] [--currency usd] [--price 500] [--managed]
 *                                           writes shop.json (a $5 Supporter pack with --supporter) and SELLING.md
 *   homie-studio shop check                 shop.json against the kit's rules (no randomness, real money, the cap…)
 *   homie-studio shop connect [--managed] [--live]   a page on THIS computer (127.0.0.1, one use, ten minutes) where the owner
 *                                           pastes the studio's restricted Stripe key and webhook signing secret; they
 *                                           go straight to the Worker secrets STRIPE_KEY and STRIPE_WEBHOOK_SECRET on
 *                                           Wrangler's standard input: never a chat, a file, an argument or a log.
 *                                           The page also offers Stripe Managed Payments in plain words. Test keys
 *                                           only, unless --live (then live keys only).
 *   homie-studio shop disconnect            removes both secrets (the shop closes at once)
 *   homie-studio shop orders                the latest orders (never a card or an email)
 *   homie-studio shop refund <order> [--reason requested_by_customer|duplicate|fraudulent] [--note "<why>"]
 *                                           ASKS the owner (a one-tap link): the AI never refunds by itself
 *   homie-studio shop statements [--period YYYY-MM] [--send]   the signed referral statements this studio owes
 *
 * The proof of ownership is the studio's own Cloudflare login, as for the office.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askedFor, withKey } from './office.mjs';
import { runner } from './cloudflare.mjs';
import { listGames, readStudio, siteUrl } from './studio.mjs';
import { SHOP_FILE, audienceOf, checkShop, money } from '../worker/shop-rules.mjs';
import { KEY_SHAPE, WEBHOOK_SECRET_SHAPE, apiBase, modeOf } from '../worker/stripe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELLING = join(HERE, '..', 'shop', 'SELLING.md');
/** The events the webhook endpoint listens to (the owner ticks these in Stripe). */
export const HOOK_EVENTS = Object.freeze([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired',
  'charge.refunded', 'refund.created', 'refund.updated', 'charge.dispute.created', 'charge.dispute.closed',
]);
/** The restricted key's permissions, as Stripe's key page names them. Nothing else. */
export const KEY_PERMISSIONS = Object.freeze([
  ['Checkout Sessions', 'Write', 'open Stripe\'s checkout page for one item'],
  ['Charges', 'Write', 'refunds (Stripe keeps refunds under Charges)'],
  ['PaymentIntents', 'Read', 'which payment an order was'],
  ['Disputes', 'Read', 'see a dispute; you answer it in Stripe'],
]);

/** shop.json read and checked with the studio's games and audience: { ok, shop, errors, warnings, file }. */
export function readShop(root) {
  const file = join(root, SHOP_FILE);
  if (!existsSync(file)) return { ok: true, shop: null, errors: [], warnings: [], file, absent: true };
  let raw = null;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { return { ok: false, shop: null, errors: [{ at: '', message: `shop.json is not JSON: ${error.message}` }], warnings: [], file }; }
  const games = listGames(root).map((g) => g.id);
  const studio = readStudio(root);
  return { ...checkShop(raw, { games, audience: audienceOf(studio) }), file };
}

/** The build's half: the checked shop for games.json, or a thrown error that says what to fix (nothing is published). */
export function shopForBuild(root, { log = () => {} } = {}) {
  const r = readShop(root);
  if (r.absent) return null;
  if (!r.ok) throw new Error(`shop.json breaks the shop's rules, so the build stops (nothing is sold that the kit refuses):\n${r.errors.map((e) => `  ${e.at || 'shop.json'}: ${e.message}`).join('\n')}`);
  for (const w of r.warnings) log(`shop.json ${w.at}: ${w.message}`);
  return r.shop;
}

export function shopCheck(root) {
  const r = readShop(root);
  if (r.absent) return { ok: true, command: 'shop check', absent: true, message: 'No shop.json: this studio sells nothing (homie-studio shop init writes one).' };
  return { ok: r.ok, command: 'shop check', errors: r.errors, warnings: r.warnings, items: r.shop?.items.map((i) => `${i.id} (${i.kind}, ${i.kind === 'tip' ? 'pay what you want' : money(i.price, r.shop.currency)})`) ?? [], till: r.shop?.till ?? null, why: r.ok ? undefined : `shop.json: ${r.errors.map((e) => `${e.at}: ${e.message}`).join('; ')}` };
}

/** The Supporter pack the kit suggests first: deterministic, never pay-to-win, a badge on the profile and in rooms. */
export function supporterItem({ price = 500, days = 365, name = 'Supporter' } = {}) {
  return { id: 'supporter', kind: 'supporter', name, price, days, gives: ['badge:supporter'], badge: 'Supporter', blurb: 'A Supporter badge on your account and beside your name in rooms, for a year. It changes nothing about how any game plays.' };
}

export function shopInit(root, { supporter = false, currency = 'usd', price = 500, managed = false } = {}) {
  const file = join(root, SHOP_FILE);
  if (existsSync(file)) return { ok: false, command: 'shop init', why: 'shop.json is here already: change it, then homie-studio shop check' };
  const studio = readStudio(root);
  if (audienceOf(studio) === 'kids') return { ok: false, command: 'shop init', why: 'studio.json says "audience": "kids": a studio made for children sells nothing in its games' };
  const shop = {
    till: managed ? 'stripe-managed' : 'stripe', currency: String(currency).toLowerCase(), refundDays: 14, capPerPlayerMonth: 5000,
    items: supporter ? [supporterItem({ price: Math.floor(Number(price)) || 500 })] : [],
    referrals: { rate: 0.1, windowDays: 30, capPerPlayer: 1000, holdDays: 30, minimumInvoice: 2500, accept: ['stripe-invoice'] },
  };
  const r = checkShop(shop, { games: listGames(root).map((g) => g.id) });
  if (!r.ok) return { ok: false, command: 'shop init', why: r.errors.map((e) => e.message).join('; ') };
  writeFileSync(file, `${JSON.stringify(shop, null, 2)}\n`);
  const wrote = [SHOP_FILE];
  if (!existsSync(join(root, 'SELLING.md')) && existsSync(SELLING)) { writeFileSync(join(root, 'SELLING.md'), readFileSync(SELLING, 'utf8')); wrote.push('SELLING.md'); }
  return { ok: true, command: 'shop init', wrote, till: shop.till, items: shop.items.map((i) => i.id), next: ['homie-studio shop check', 'npm run deploy (the shop stays closed until the key is in)', 'homie-studio shop connect (the owner pastes a restricted key into a page on this computer)'] };
}

/** The office's view of the live shop: open or what is missing, the last 30 days, links to Stripe. */
export async function shopStatus(root, { url } = {}) {
  const r = await withKey(root, url, (call) => call('/_studio/api/shop'));
  if (!r.ok) return { ok: false, command: 'shop', why: r.message ?? r.why ?? 'the studio did not answer' };
  const local = readShop(root);
  return { ok: true, command: 'shop', ready: r.ready, mode: r.mode, missing: r.missing, totals: r.totals, stripe: r.stripe, hook: r.hook, till: r.shop?.till ?? null, items: r.shop?.items ?? [], local: { ok: local.ok, absent: Boolean(local.absent), errors: local.errors } };
}

export async function shopOrders(root, { url } = {}) {
  const r = await withKey(root, url, (call) => call('/_studio/api/shop'));
  if (!r.ok) return { ok: false, command: 'shop orders', why: r.message ?? r.why ?? 'the studio did not answer' };
  return { ok: true, command: 'shop orders', orders: (r.orders ?? []).map((o) => ({ id: o.id, at: new Date(o.createdAt).toISOString(), item: o.item, name: o.name, shown: o.shown, status: o.status, mode: o.mode, player: o.player?.name ?? null, via: o.via, stripe: o.stripe })) };
}

/** The AI proposes a refund: an ask the owner confirms with one tap (an office key can never refund by itself). */
export async function shopRefund(root, order, { url, reason, note } = {}) {
  if (!/^ord_[A-Za-z0-9]{20}$/.test(String(order ?? ''))) return { ok: false, command: 'shop refund', why: 'name the order: homie-studio shop refund ord_… (homie-studio shop orders lists them)' };
  const r = await withKey(root, url, (call) => call('/_studio/api/shop/refund', { order, ...(reason ? { reason } : {}), ...(note ? { note } : {}) }));
  return askedFor(root, url, r, 'shop refund');
}

export async function shopStatements(root, { url, period, send = false } = {}) {
  const r = await withKey(root, url, (call) => (send ? call('/_studio/api/shop/statements/send', { ...(period ? { period } : {}) }) : call(`/_studio/api/shop/statements${period ? `?period=${encodeURIComponent(period)}` : ''}`)));
  if (!r.ok) return { ok: false, command: 'shop statements', why: r.message ?? r.why ?? 'the studio did not answer' };
  return { ok: true, command: 'shop statements', period: r.period, ...(send ? { sent: r.sent } : { statements: r.statements }) };
}

/* ------------------------------------------------------------------ the key, from a page on this computer */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The one page the owner uses: what to make in Stripe, what Managed Payments costs and does, two fields, one button. */
export function connectPage({ nonce, site, studio, till = 'stripe', test = true }) {
  const dash = `https://dashboard.stripe.com${test ? '/test' : ''}`;
  const perms = KEY_PERMISSIONS.map(([n, level, why]) => `<li><b>${esc(n)}</b>: ${esc(level)} <small>(${esc(why)})</small></li>`).join('');
  const events = HOOK_EVENTS.map((e) => `<code>${esc(e)}</code>`).join(', ');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Connect your shop to Stripe</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2.5rem auto;padding:0 1rem;color:#1b1b1b}h1{font-size:1.6rem}h2{font-size:1.1rem;margin-top:1.8rem}input[type=password]{width:100%;box-sizing:border-box;font:inherit;padding:.6rem;border:1px solid #999;border-radius:8px}label{display:block;margin:.8rem 0 .3rem;font-weight:600}fieldset{border:1px solid #ccc;border-radius:10px;padding:.6rem 1rem}fieldset label{font-weight:400;display:flex;gap:.6rem;align-items:flex-start}button{margin-top:1.2rem;font:inherit;font-weight:700;padding:.7rem 1.3rem;border:0;border-radius:8px;background:#1b1b1b;color:#fff}small{color:#555}code{font-size:.85em;background:#f2f2f2;padding:0 .25em;border-radius:4px}ol li,ul li{margin:.25rem 0}.box{background:#f6f6f2;border-radius:10px;padding:.8rem 1rem}</style>
<h1>Connect ${esc(studio)}'s shop to your Stripe</h1>
<p>Money goes straight from players to <b>your own Stripe account</b>. Homie never sees it and takes no cut. What you paste here goes from this page to your studio's Worker as two secrets, and nowhere else: not to the chat, not to a file, not to a log.</p>
<p class="box">${test ? '<b>Test mode first.</b> Use your Stripe account in test mode (the keys start with <code>rk_test_</code>): nothing real is charged, and test cards work. Switch to live keys only when the house is ready to sell.' : '<b>Live mode.</b> Real cards, real money.'}</p>
<h2>1. In Stripe: a restricted key</h2>
<ol><li>Open <a href="${dash}/apikeys" target="_blank" rel="noopener">Developers → API keys</a> and press <b>Create restricted key</b>.</li>
<li>Name it "${esc(studio)} shop" and give it exactly these permissions (leave everything else at None):<ul>${perms}</ul></li>
<li>Create it and copy the key (it starts with <code>rk_</code>).</li></ol>
<h2>2. In Stripe: where Stripe tells your shop about payments</h2>
<ol><li>Open <a href="${dash}/workbench/webhooks" target="_blank" rel="noopener">Webhooks</a> and press <b>Create an event destination</b> (Your account, a Webhook endpoint).</li>
<li>Endpoint URL: <code>${esc(site)}/api/shop/hook</code></li>
<li>Events: ${events}</li>
<li>Create it, press <b>Reveal</b> on the signing secret, and copy it (it starts with <code>whsec_</code>).</li></ol>
<form method="post" action="/key"><input type="hidden" name="n" value="${esc(nonce)}">
<h2>3. Paste both here</h2>
<label for="key">Restricted key</label><input id="key" name="key" type="password" autocomplete="off" placeholder="rk_test_…" required>
<label for="hook">Webhook signing secret</label><input id="hook" name="hook" type="password" autocomplete="off" placeholder="whsec_…" required>
<h2>4. Who is the seller?</h2>
<fieldset>
<label><input type="radio" name="till" value="stripe"${till !== 'stripe-managed' ? ' checked' : ''}> <span><b>You are</b> (standard Stripe). Stripe takes its usual card fee (in the US 2.9% + 30¢ a sale; in Canada 2.9% + CA$0.30). Stripe Tax is on: it works out and collects sales tax and VAT where you have told Stripe you are registered (0.5% a sale there). Registering and filing are yours, and some countries (the EU, the UK) expect a foreign seller to register from the first sale.</span></label>
<label><input type="radio" name="till" value="stripe-managed"${till === 'stripe-managed' ? ' checked' : ''}> <span><b>Stripe is</b> (Stripe Managed Payments). <b>3.5% more</b> a sale, on top of the card fee. Stripe becomes the seller of record: it registers for, collects, files and pays sales tax and VAT in 80+ countries, runs fraud checks, answers card disputes for you and handles buyers' payment questions. Statements read <code>LINK.COM*</code>. You still cover the money of a lost dispute, and Stripe may refund a buyer within 60 days. Turn it on in Stripe first (<a href="${dash}/settings/managed-payments" target="_blank" rel="noopener">Managed Payments</a>, after Stripe's eligibility review; Canada and the US are among the countries it serves).</span></label>
</fieldset>
<button>Save to my Worker</button></form>
<p><small>This page works once and closes in ten minutes. You can change the seller later in shop.json ("till"). This is not legal or tax advice: an accountant can tell you where you must register.</small></p>`;
}

/**
 * `homie-studio shop connect`: the page above on 127.0.0.1 (one use, ten minutes). The key and the secret go straight
 * to `wrangler secret put` on its standard input. The command never prints them; it checks only their shape (and,
 * when `verify` is on, that Stripe accepts the key with one read).
 */
export async function shopConnect(root, { managed = null, live = false, log = () => {}, port = 0, wait = 10 * 60_000, verify = true, fetcher = fetch } = {}) {
  const studio = readStudio(root);
  const site = siteUrl(root) ?? 'https://<your studio>';
  const env = studio.cloudflare?.accountId ? { CLOUDFLARE_ACCOUNT_ID: studio.cloudflare.accountId } : {};
  const w = runner(root, env);
  const shopNow = readShop(root);
  const till = managed === true ? 'stripe-managed' : managed === false ? 'stripe' : shopNow.shop?.till ?? 'stripe';
  const nonce = randomBytes(16).toString('hex');
  const page = connectPage({ nonce, site, studio: studio.name ?? 'Your studio', till, test: !live });
  return await new Promise((done) => {
    let finished = false;
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === `/${nonce}`) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end(page); return; }
      if (req.method === 'POST' && req.url === '/key') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
        req.on('end', async () => {
          const form = new URLSearchParams(body);
          const key = String(form.get('key') ?? '').trim();
          const hook = String(form.get('hook') ?? '').trim();
          const chosen = form.get('till') === 'stripe-managed' ? 'stripe-managed' : 'stripe';
          const say = (status, text) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(text); };
          if (form.get('n') !== nonce || finished) { say(403, 'This page was used already.'); return; }
          if (/^sk_live_/.test(key)) { say(400, 'That is a full secret key. The shop takes only a RESTRICTED key (rk_…) with the four permissions on the page. Go back and make one.'); return; }
          if (!KEY_SHAPE.test(key) || !/^rk_/.test(key)) { say(400, 'That does not look like a restricted key (rk_test_… or rk_live_…). Go back and try again.'); return; }
          // Test mode unless the owner's AI ran it with --live on purpose: a live key on the test page is refused.
          if (modeOf(key) !== (live ? 'live' : 'test')) { say(400, live ? 'This page takes a LIVE restricted key (rk_live_…).' : 'This page is for TEST mode: paste a test key (rk_test_…). Live keys go in only when the shop is ready to sell for real (shop connect --live).'); return; }
          if (!WEBHOOK_SECRET_SHAPE.test(hook)) { say(400, 'That does not look like a webhook signing secret (whsec_…). Go back and try again.'); return; }
          finished = true;
          // One read with the key, so a typo is caught here and not at the first sale. It never leaves this computer
          // except to Stripe itself.
          if (verify) {
            let ok = false;
            try {
              const r = await fetcher(`${apiBase(process.env)}/v1/checkout/sessions?limit=1`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
              ok = r.ok;
            } catch { ok = false; }
            if (!ok) { finished = false; say(400, 'Stripe did not accept that key for reading checkouts. Check its permissions (Checkout Sessions: Write) and that it is the account you mean, then go back and paste it again.'); return; }
          }
          const a = w(['secret', 'put', 'STRIPE_KEY'], { input: `${key}\n` });
          const b = a.code === 0 ? w(['secret', 'put', 'STRIPE_WEBHOOK_SECRET'], { input: `${hook}\n` }) : { code: 1 };
          const okay = a.code === 0 && b.code === 0;
          let tillNote = '';
          if (okay && shopNow.shop && !shopNow.absent && chosen !== shopNow.shop.till) {
            try {
              const raw = JSON.parse(readFileSync(shopNow.file, 'utf8'));
              raw.till = chosen;
              writeFileSync(shopNow.file, `${JSON.stringify(raw, null, 2)}\n`);
              tillNote = ` shop.json now says "till": "${chosen}" (deploy to use it).`;
            } catch { tillNote = ''; }
          }
          say(okay ? 200 : 500, okay ? `Saved to your Worker (${modeOf(key)} mode). You can close this page.` : 'Wrangler could not save it (is this computer signed in to Cloudflare? npx wrangler login). Nothing was kept.');
          server.close();
          done(okay
            ? { ok: true, command: 'shop connect', saved: true, mode: modeOf(key), till: chosen, message: `Saved as the Worker secrets STRIPE_KEY and STRIPE_WEBHOOK_SECRET (never shown), ${modeOf(key)} mode, seller: ${chosen === 'stripe-managed' ? 'Stripe (Managed Payments)' : 'the studio'}.${tillNote} homie-studio shop says whether anything else is missing.` }
            : { ok: false, command: 'shop connect', why: 'wrangler secret put failed (sign in with npx wrangler login, then run this again)' });
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(port, '127.0.0.1', () => {
      const link = `http://127.0.0.1:${server.address().port}/${nonce}`;
      log(`Open this page on this computer; the owner pastes the key there (never in a chat): ${link}`);
    });
    setTimeout(() => { if (!finished) { finished = true; server.close(); done({ ok: false, command: 'shop connect', why: 'nothing was saved in ten minutes; run it again when ready' }); } }, wait).unref?.();
  });
}

export function shopDisconnect(root) {
  const studio = readStudio(root);
  const w = runner(root, studio.cloudflare?.accountId ? { CLOUDFLARE_ACCOUNT_ID: studio.cloudflare.accountId } : {});
  const a = w(['secret', 'delete', 'STRIPE_KEY'], { input: 'y\n' });
  const b = w(['secret', 'delete', 'STRIPE_WEBHOOK_SECRET'], { input: 'y\n' });
  return a.code === 0 || b.code === 0 ? { ok: true, command: 'shop disconnect', message: 'The Stripe key and webhook secret are gone from the Worker: the shop is closed. Delete the restricted key in Stripe too (Developers → API keys).' } : { ok: false, command: 'shop disconnect', why: a.out.trim().split('\n').slice(-2).join(' ') };
}

/** Lines for a person (the CLI's print). */
export function shopLines(r) {
  const lines = [];
  if (r.command === 'shop') {
    lines.push(r.ready ? `The shop is open${r.mode === 'test' ? ' in TEST MODE (no real money)' : ', live'} (till: ${r.till}).` : 'The shop is not selling yet:');
    for (const m of r.missing ?? []) lines.push(`  - ${m.words}`);
    if (r.totals) lines.push(`Last 30 days: ${r.totals.sales} sales, ${money(r.totals.paid, r.totals.currency)} before tax and fees; ${r.totals.refunds} refunded; ${r.totals.disputes} disputed.`);
    lines.push(`Webhook endpoint for Stripe: ${r.hook}`, `Payouts: ${r.stripe?.payouts}`);
    if (r.local && !r.local.ok) lines.push(`shop.json here: ${r.local.errors.map((e) => e.message).join('; ')}`);
  } else if (r.command === 'shop orders') {
    for (const o of r.orders) lines.push(`${o.id}  ${o.at.slice(0, 16)}  ${o.name} ${o.shown}  ${o.status}${o.mode === 'test' ? ' (test)' : ''}  ${o.player ?? '(deleted account)'}${o.via ? `  via ${o.via}` : ''}`);
    if (!r.orders.length) lines.push('No orders yet.');
  } else if (r.command === 'shop check') {
    if (r.absent) lines.push(r.message);
    else {
      lines.push(r.ok ? `shop.json follows the rules: ${r.items.join(', ') || 'no items yet'} (till: ${r.till}).` : 'shop.json breaks the rules:');
      for (const e of r.errors ?? []) lines.push(`  ${e.at}: ${e.message}`);
      for (const w of r.warnings ?? []) lines.push(`  note ${w.at}: ${w.message}`);
    }
  } else if (r.command === 'shop init') {
    lines.push(`Wrote ${r.wrote.join(', ')} (till: ${r.till}${r.items.length ? `; ${r.items.join(', ')}` : ''}). Next:`, ...r.next.map((n) => `  ${n}`));
  } else if (r.command === 'shop statements') {
    if (r.sent) for (const s of r.sent) lines.push(`${s.via}: ${s.ok ? 'sent' : `not sent (${s.why ?? s.status})`}`);
    else for (const s of r.statements ?? []) lines.push(`${s.statement.referrer}: due ${money(s.statement.totals.due, s.statement.currency)} (${s.statement.lines.length} line(s)), signed`);
    if (!(r.sent ?? r.statements ?? []).length) lines.push(`No referral statements for ${r.period}.`);
  } else lines.push(r.message ?? '');
  return lines;
}
