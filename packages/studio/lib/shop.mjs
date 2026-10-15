import {givingItems} from './giving-preset.mjs';
import { paidReleases } from './parts-upload.mjs';
/** Shop authoring and owner operations. Stripe setup uses one App approval; credentials travel only over private stdin. */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askedFor, withKey } from './office.mjs';
import { runner } from './cloudflare.mjs';
import { listExperiences as listGames, readStudio, siteUrl } from './studio.mjs';
import { SHOP_FILE, audienceOf, checkShop, defaultTaxCode, money } from '../worker/shop-rules.mjs';
import {
  redactStripe,
} from '../worker/stripe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELLING = join(HERE, '..', 'shop', 'SELLING.md');
/** The events the webhook endpoint listens to (the owner ticks these in Stripe). */
export const HOOK_EVENTS = Object.freeze([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired',
  'payment_intent.succeeded', 'invoice.paid', 'invoice_payment.paid', 'invoice.payment_failed', 'customer.subscription.updated', 'customer.subscription.deleted', 'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed', 'charge.dispute.created', 'charge.dispute.closed',
]);
export const SHOP_HOOK_EVENTS = Object.freeze([
  'invoice.paid', 'invoice.payment_failed', 'customer.subscription.updated', 'customer.subscription.deleted',
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired',
  'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed', 'charge.dispute.created', 'charge.dispute.closed',
]);
/** shop.json read and checked with the studio's games and audience: { ok, shop, errors, warnings, file }. */
export function readShop(root) {
  const file = join(root, SHOP_FILE);
  if (!existsSync(file)) return { ok: true, shop: null, errors: [], warnings: [], file, absent: true };
  let raw = null;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { return { ok: false, shop: null, errors: [{ at: '', message: `shop.json is not JSON: ${error.message}` }], warnings: [], file }; }
  const games = listGames(root).map((g) => g.id);
  const studio = readStudio(root);
  return { ...checkShop(raw, { games, audience: audienceOf(studio), studioName: studio.name }), file };
}

/** The build's half: the checked shop for games.json, or a thrown error that says what to fix (nothing is published). */
export function shopForBuild(root, { log = () => {} } = {}) {
  const r = readShop(root);
  if (r.absent) return null;
  if (!r.ok) throw new Error(`shop.json conflicts with the studio settings or payment requirements, so the build stops (check the studio settings and payment requirements):\n${r.errors.map((e) => `  ${e.at || 'shop.json'}: ${e.message}`).join('\n')}`);
  for (const w of r.warnings) log(`shop.json ${w.at}: ${w.message}`);
  return r.shop;
}

export function shopCheck(root) {
  const r = readShop(root);
  if (r.absent) return { ok: true, command: 'shop check', absent: true, message: 'No shop.json: this studio sells nothing (homie-studio shop init writes one).' };
  return { ok: r.ok, command: 'shop check', policy: r.shop?.policy, capPerPlayerMonth: r.shop?.capPerPlayerMonth, refundDays: r.shop?.refundDays, errors: r.errors, warnings: r.warnings, items: r.shop?.items.map((i) => `${i.id} (${i.kind}, ${i.price === 'choose' ? 'pay what you want' : money(i.price, r.shop.currency)})`) ?? [], till: r.shop?.till ?? null, why: r.ok ? undefined : `shop.json: ${r.errors.map((e) => `${e.at}: ${e.message}`).join('; ')}` };
}

/** The Supporter pack the kit suggests first: a badge on the profile and in rooms; the studio can replace or edit it. */
export function supporterItem({ price = 500, days = 365, name = 'Supporter' } = {}) {
  return { id: 'supporter', kind: 'supporter', name, price, days, gives: ['badge:supporter'], badge: 'Supporter', blurb: 'A Supporter badge on your account and beside your name in rooms, for a year. It changes nothing about how any game plays.' };
}

export function shopInit(root, { supporter = false, giving = false, currency = null, price = 500, managed = false } = {}) {
  const file = join(root, SHOP_FILE);
  if (existsSync(file)) return { ok: false, command: 'shop init', why: 'shop.json is here already: change it, then homie-studio shop check' };
  const studio = readStudio(root);
  if (giving && !currency && !studio.currency) return { ok: false, command: 'shop init', why: 'Set studio.json currency or give --currency for gifts.' };
  const shop = {
    ...(giving ? { giving: { receiptText: '' } } : {}),
    till: managed ? 'stripe-managed' : 'stripe', currency: String(currency ?? studio.currency ?? 'usd').toLowerCase(),
    items: giving ? givingItems() : supporter ? [supporterItem({ price: Number(price) })] : [],
  };
  const r = checkShop(shop, { games: listGames(root).map((g) => g.id) });
  if (!r.ok) return { ok: false, command: 'shop init', why: r.errors.map((e) => e.message).join('; ') };
  writeFileSync(file, `${JSON.stringify(shop, null, 2)}\n`);
  const wrote = [SHOP_FILE];
  if (!existsSync(join(root, 'SELLING.md')) && existsSync(SELLING)) { writeFileSync(join(root, 'SELLING.md'), readFileSync(SELLING, 'utf8')); wrote.push('SELLING.md'); }
  return { ok: true, command: 'shop init', wrote, till: shop.till, items: shop.items.map((i) => i.id), next: ['homie-studio shop check', 'npm run deploy (paid sales wait for the Stripe connection)', 'homie-studio shop connect (approve Stripe in your browser; the result names any remaining step)'] };
}

/** The office's view of the live shop: open or what is missing, the last 30 days, links to Stripe. */
export async function shopStatus(root, { url } = {}) {
  const r = await withKey(root, url, (call) => call('/_studio/api/shop'));
  if (!r.ok) return { ok: false, command: 'shop', why: r.message ?? r.why ?? 'the studio did not answer' };
  const local = readShop(root);
  const { stripeConnectionInfo } = await import('./stripe-connect.mjs');
  const connection = r.mode === 'test' ? stripeConnectionInfo(root) : null;
  const missing = [...(r.missing ?? []), ...(connection?.expired ? [{ id: 'stripe-expired', words: 'Stripe test credentials have expired. Run homie-studio shop connect --renew and approve Stripe again.' }] : [])];
  return { ok: true, command: 'shop', ready: r.ready && !connection?.expired, mode: r.mode, missing, connection, purchases: r.purchases, totals: r.totals, stripe: r.stripe, hook: r.hook, till: r.shop?.till ?? null, items: r.shop?.items ?? [], local: { ok: local.ok, absent: Boolean(local.absent), errors: local.errors } };
}

export async function shopOrders(root, { url } = {}) {
  const r = await withKey(root, url, (call) => call('/_studio/api/shop'));
  if (!r.ok) return { ok: false, command: 'shop orders', why: r.message ?? r.why ?? 'the studio did not answer' };
  return { ok: true, command: 'shop orders', orders: (r.orders ?? []).map((o) => ({ id: o.id, at: new Date(o.createdAt).toISOString(), item: o.item, name: o.name, shown: o.shown, status: o.status, mode: o.mode, player: o.player?.name ?? null, stripe: o.stripe, manualRefund: o.manualRefund ?? null })) };
}

/** The AI proposes a refund: an ask the owner confirms with one tap (an office key can never refund by itself). */
export async function shopRefund(root, order, { url, reason, note, manualTransaction } = {}) {
  if (!/^ord_[A-Za-z0-9]{20}$/.test(String(order ?? ''))) return { ok: false, command: 'shop refund', why: 'name the order: homie-studio shop refund ord_… (homie-studio shop orders lists them)' };
  const r = await withKey(root, url, (call) => call('/_studio/api/shop/refund', { order, ...(manualTransaction ? {manualTransaction} : {}), ...(reason ? { reason } : {}), ...(note ? { note } : {}) }));
  return askedFor(root, url, r, 'shop refund');
}

/** Where Stripe sends the shop's events, on the studio's live site. */
export const hookUrlOf = (site) => `${String(site).replace(/\/+$/, '')}/api/shop/hook`;

/** Stop new purchases while keeping signed in-flight fulfilment available. */
export function shopDisconnect(root) {
  const studio = readStudio(root);
  const w = runner(root, studio.cloudflare?.accountId ? { CLOUDFLARE_ACCOUNT_ID: studio.cloudflare.accountId } : {});
  const result = w(['secret', 'delete', 'STRIPE_KEY'], { input: 'y\n' });
  return result.code === 0 ? { ok: true, command: 'shop disconnect', message: 'New checkout is closed. Reconnect by approving the Homie Stripe App.' }
    : { ok: false, command: 'shop disconnect', why: 'Cloudflare could not disconnect Stripe. No credentials were printed.' };
}

/** Lines for a person (the CLI's print). */
export function shopLines(r) {
  const lines = [];
  if (r.command === 'shop') {
    lines.push(r.ready ? `The shop is open${r.mode === 'test' ? ' in TEST MODE (no real money)' : ', live'} (till: ${r.till}).` : 'The shop is not selling yet:');
    for (const m of r.missing ?? []) lines.push(`  - ${m.words}`);
    if (r.connection) lines.push(`Stripe connected ${r.connection.connectedAt}. Reconnect: ${r.connection.renew}`);
    if (r.totals) lines.push(`Last 30 days: ${r.totals.sales} sales, ${money(r.totals.paid, r.totals.currency)} before tax and fees; ${r.totals.refunds} refunded; ${r.totals.disputes} disputed.`);
    lines.push(`Webhook endpoint for Stripe: ${r.hook}`, `Payouts: ${r.stripe?.payouts}`);
    if (r.local && !r.local.ok) lines.push(`shop.json here: ${r.local.errors.map((e) => e.message).join('; ')}`);
  } else if (r.command === 'shop orders') {
    for (const o of r.orders) lines.push(`${o.id}  ${o.at.slice(0, 16)}  ${o.name} ${o.shown}  ${o.status}${o.mode === 'test' ? ' (test)' : ''}  ${o.player ?? '(deleted account)'}`);
    if (!r.orders.length) lines.push('No orders yet.');
  } else if (r.command === 'shop check') {
    if (r.absent) lines.push(r.message);
    else {
      lines.push(r.ok ? `shop.json matches the studio settings: ${r.items.join(', ') || 'no items yet'} (till: ${r.till}).` : 'shop.json conflicts with the studio settings or payment requirements:');
      if (r.policy) lines.push(`Studio policy: ${r.policy.preset}; edit policy in shop.json. Monthly cap: ${r.capPerPlayerMonth ?? 'not set'}; refund days: ${r.refundDays ?? 'not set'}.`);
      for (const e of r.errors ?? []) lines.push(`  ${e.at}: ${e.message}`);
      for (const w of r.warnings ?? []) lines.push(`  note ${w.at}: ${w.message}`);
    }
  } else if (r.command === 'shop init') {
    lines.push(`Wrote ${r.wrote.join(', ')} (till: ${r.till}${r.items.length ? `; ${r.items.join(', ')}` : ''}). Next:`, ...r.next.map((n) => `  ${n}`));
  } else { lines.push(r.message ?? r.why ?? (r.alreadyConnected ? 'Stripe test credentials are already installed.' : '')); for (const step of r.next ?? []) lines.push(step); if (r.fallback) lines.push(`Optional fallback, only if chosen: ${r.fallback}`); }
  return lines;
}

// Public entry point: browser pairing by default; the local key page is explicitly opt-in.
export { shopConnect } from './stripe-connect.mjs';
