/**
 * `homie-studio shop catalog` (@homie-rocks/studio 0.24.3): the shop's items as Products, each with its Price, in the
 * studio's OWN Stripe, made by the owner's AI through Stripe's own MCP server (`stripe_api_read`, `stripe_api_write`)
 * after the owner connected it with Stripe's sign-in page. No key on this computer makes them.
 *
 *   homie-studio shop catalog                 what the catalog should hold, and the one read to make first
 *   homie-studio shop catalog --have <file>   Stripe's answer to that read (a file, or - for standard input): the
 *                                             exact writes still needed, or "in sync" (then shop.json `catalog`
 *                                             records the mode, test or live, so the Worker's checkouts name them)
 *
 * Each item is one Product with an id of our choosing, the same in a sandbox and in live mode:
 * `homie_<studio slug>_<item id>` (worker/stripe.mjs productIdOf), its name, blurb, a tax code (video games,
 * downloaded: what Managed Payments needs, and what Stripe Tax should know), metadata naming the studio and the item,
 * and a default Price of exactly shop.json's amount (a tip has no fixed price: its Product only). A changed price is a
 * new Price made the default; an item gone from shop.json is archived (`active: false`), never deleted. Products this
 * studio did not make are never named.
 *
 * shop.json stays the truth for money: the Worker charges shop.json's checked price and names the Product only so that
 * Stripe's Dashboard, its reports and its MCP see sales by product.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readStudio } from './studio.mjs';
import { readShop } from './shop.mjs';
import { defaultTaxCode, money } from '../worker/shop-rules.mjs';
import { productIdOf, redactStripe } from '../worker/stripe.mjs';

const MARK = 'shop-v1';

/** The Products the catalog should hold, from the checked shop.json. */
export async function wantedProducts(shop, slug) {
  return Promise.all((shop?.items ?? []).map(async (it) => {
    const id = await productIdOf(slug, it.id);
    return {
      id, item: it.id, name: it.name, description: it.blurb ?? null, tax_code: it.taxCode ?? (shop.till === 'stripe-managed' ? defaultTaxCode(it) : null),
      // Stripe metadata values: 500 characters. https://docs.stripe.com/metadata (fetched 2026-10-08).
      metadata: { homie: MARK, homie_studio: String(slug), homie_item: it.id.length <= 500 ? it.id : id },
      price: it.price === 'choose' ? null : { currency: shop.currency, unit_amount: it.price, tax_behavior: 'exclusive' },
      shown: it.price === 'choose' ? `pay what you want, ${money(it.min, shop.currency)}${it.max === null ? ' or more' : ` to ${money(it.max, shop.currency)}`}` : money(it.price, shop.currency),
    };
  }));
}

/**
 * Every Product in whatever Stripe answered: a list object ({ object: 'list', data }), an array, an MCP result
 * ({ content: [{ type: 'text', text }] }), or several of these. Anything else is ignored.
 */
export function productsIn(value, out = [], depth = 0) {
  if (depth > 8 || value === null || value === undefined) return out;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.startsWith('{') || t.startsWith('[')) { try { productsIn(JSON.parse(t), out, depth + 1); } catch { /* not JSON */ } }
    return out;
  }
  if (Array.isArray(value)) { for (const v of value) productsIn(v, out, depth + 1); return out; }
  if (typeof value !== 'object') return out;
  if (value.object === 'product' && typeof value.id === 'string') { out.push(value); return out; }
  for (const k of ['data', 'content', 'text', 'result', 'results', 'structuredContent']) if (k in value) productsIn(value[k], out, depth + 1);
  return out;
}

// Saved MCP responses can wrap a Stripe refusal in text or structured content.
function catalogError(value, depth = 0) {
  if (depth > 8 || value == null) return null;
  if (typeof value === 'string') {
    try { return catalogError(JSON.parse(value), depth + 1); } catch { return null; }
  }
  if (typeof value !== 'object') return null;
  if (typeof value.error?.message === 'string') return value.error.message;
  if (value.isError === true) return (value.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
  for (const child of Array.isArray(value) ? value : ['data', 'content', 'text', 'result', 'results', 'structuredContent'].map((k) => value[k])) {
    const error = catalogError(child, depth + 1);
    if (error) return error;
  }
  return null;
}

const taxCodeOf = (p) => (typeof p?.tax_code === 'string' ? p.tax_code : p?.tax_code?.id ?? null);

/** The plan: the read first, then (with what Stripe answered) the writes still needed. */
export async function catalogPlan(root, { have = null, mode = null, record = true } = {}) {
  const r = readShop(root);
  if (r.absent) return { ok: false, command: 'shop catalog', why: 'no shop.json: homie-studio shop init writes one first' };
  if (!r.ok) return { ok: false, command: 'shop catalog', why: `shop.json conflicts with the studio settings or payment requirements (homie-studio shop check): ${r.errors.map((e) => `${e.at}: ${e.message}`).join('; ')}` };
  const studio = readStudio(root);
  const slug = studio.slug;
  if (!slug) return { ok: false, command: 'shop catalog', why: 'studio.json has no slug: the catalog\'s Product ids are made from it' };
  const wanted = await wantedProducts(r.shop, slug);
  const read = {
    tool: 'stripe_api_read', method: 'GET', path: '/v1/products', params: { limit: 100, expand: ['data.default_price'] },
    then: 'Save exactly what it answers (every page, while has_more) to a file in the scratch folder, then run: npx --no-install homie-studio shop catalog --have <that file>',
  };
  const summary = wanted.map((w) => ({ id: w.id, item: w.item, name: w.name, price: w.shown, tax_code: w.tax_code }));
  if (have === null || have === undefined) {
    return {
      ok: true, command: 'shop catalog', step: 'read', products: summary, read,
      next: [
        'With Stripe\'s MCP connected to the studio\'s SANDBOX (never live until the owner says so), make the read above with stripe_api_read.',
        'Then: npx --no-install homie-studio shop catalog --have <the saved answer>: it says exactly which writes are still needed.',
      ],
    };
  }
  const error = catalogError(have);
  if (error) return { ok: false, command: 'shop catalog', why: `Stripe said: “${redactStripe(error).slice(0, 400)}” (GET /v1/products). Read the catalog again after resolving it.` };
  const products = productsIn(have);
  const ours = products.filter((p) => p.metadata?.homie_studio === String(slug) || wanted.some((w) => w.id === p.id));
  const modes = [...new Set(ours.map((p) => (p.livemode ? 'live' : 'test')))];
  if (modes.length > 1) return { ok: false, command: 'shop catalog', why: 'that answer mixes test and live Products: read one environment at a time' };
  const where = mode ?? modes[0] ?? (products[0] ? (products[0].livemode ? 'live' : 'test') : null);
  const writes = [];
  let unknownPrices = 0;
  for (const w of wanted) {
    const p = products.find((x) => x.id === w.id);
    const meta = Object.fromEntries(Object.entries(w.metadata));
    if (!p) {
      writes.push({
        tool: 'stripe_api_write', method: 'POST', path: '/v1/products', why: `make ${w.name} (${w.shown})`,
        params: { id: w.id, name: w.name, ...(w.description ? { description: w.description } : {}), ...(w.tax_code ? { tax_code: w.tax_code } : {}), metadata: meta, ...(w.price ? { default_price_data: w.price } : {}) },
      });
      continue;
    }
    const change = {};
    if (p.name !== w.name) change.name = w.name;
    if ((p.description ?? null) !== (w.description ?? null) && w.description) change.description = w.description;
    if (taxCodeOf(p) !== w.tax_code) change.tax_code = w.tax_code;
    if (p.active === false) change.active = true;
    if (Object.entries(meta).some(([k, v]) => p.metadata?.[k] !== v)) change.metadata = meta;
    if (Object.keys(change).length) writes.push({ tool: 'stripe_api_write', method: 'POST', path: `/v1/products/${w.id}`, why: `bring ${w.name} back in line with shop.json (${Object.keys(change).join(', ')})`, params: change });
    if (!w.price) continue;
    const dp = p.default_price;
    if (typeof dp === 'string') { unknownPrices += 1; continue; }
    const same = dp && dp.unit_amount === w.price.unit_amount && dp.currency === w.price.currency && dp.active !== false && (!dp.tax_behavior || dp.tax_behavior === 'exclusive' || dp.tax_behavior === 'unspecified');
    if (!same) {
      writes.push({
        tool: 'stripe_api_write', method: 'POST', path: '/v1/prices', why: `${w.name}'s price as shop.json says: ${w.shown}`,
        params: { product: w.id, ...w.price, lookup_key: `${w.id}_${w.price.currency}`, transfer_lookup_key: true, metadata: meta },
      });
      writes.push({
        tool: 'stripe_api_write', method: 'POST', path: `/v1/products/${w.id}`, why: `make that price ${w.name}'s default`,
        params: { default_price: '<the id (price_…) of the Price the call before made>' },
      });
    }
  }
  for (const p of ours) {
    if (wanted.some((w) => w.id === p.id) || p.active === false) continue;
    writes.push({ tool: 'stripe_api_write', method: 'POST', path: `/v1/products/${p.id}`, why: `${p.name ?? p.id} is no longer in shop.json: archive it (never delete; past sales keep their product)`, params: { active: false } });
  }
  const inSync = writes.length === 0 && unknownPrices === 0;
  let recorded = false;
  if (inSync && where && record && wanted.length) {
    const raw = JSON.parse(readFileSync(r.file, 'utf8'));
    const now = Array.isArray(raw.catalog) ? raw.catalog : [];
    if (!now.includes(where)) {
      raw.catalog = [...new Set([...now, where])].sort();
      writeFileSync(r.file, `${JSON.stringify(raw, null, 2)}\n`);
      recorded = true;
    }
  }
  return {
    ok: true, command: 'shop catalog', step: inSync ? 'done' : 'write', mode: where, inSync, products: summary, writes,
    ...(unknownPrices ? { read: { ...read, why: `${unknownPrices} Product(s) came back without their default price expanded: read again with expand data.default_price` } } : {}),
    ...(recorded ? { recorded: `shop.json "catalog" now includes "${where}": commit it, deploy, and the checkouts name these Products` } : {}),
    next: inSync
      ? [where === 'live' ? 'The live catalog matches shop.json.' : 'The sandbox catalog matches shop.json.', ...(recorded ? ['Commit shop.json and deploy (npm run deploy).'] : [])]
      : ['Make each write in order with stripe_api_write (the human-confirmation link Stripe may give is the owner\'s to open).', 'Then read again and run --have again: it says "in sync" when nothing is left.'],
  };
}

export function catalogLines(r) {
  const lines = [];
  if (!r.ok) return [r.why];
  if (r.step === 'read') {
    lines.push('The catalog shop.json asks for (one Product an item, the same ids in the sandbox and live):');
    for (const p of r.products) lines.push(`  ${p.id}  ${p.name}  ${p.price}  (tax code ${p.tax_code})`);
    lines.push(`First read what Stripe holds: ${r.read.tool} ${r.read.method} ${r.read.path} ${JSON.stringify(r.read.params)}`, ...r.next.map((n) => `  ${n}`));
    return lines;
  }
  lines.push(r.inSync ? `In sync: the ${r.mode ?? ''} catalog in Stripe matches shop.json.`.replace('  ', ' ') : `${r.writes.length} write(s) still needed${r.mode ? ` (${r.mode})` : ''}:`);
  for (const w of r.writes) lines.push(`  ${w.tool} ${w.method} ${w.path} ${JSON.stringify(w.params)}  # ${w.why}`);
  if (r.read) lines.push(`  ${r.read.why}`);
  if (r.recorded) lines.push(r.recorded);
  lines.push(...r.next);
  return lines;
}
