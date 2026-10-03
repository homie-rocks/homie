/**
 * THE SHOP'S RULES (@homie-rocks/studio 0.24.0): what a studio's shop.json may sell, checked the same way by the
 * build, `homie-studio shop check` and the Worker (shop/SHOP.md is the guide). Pure: no Node, no Worker APIs.
 *
 * The kit's kids and fairness rules live HERE, not in docs, so a studio cannot switch them off by editing a file:
 *
 *   - real-money prices only, in one currency; no gems, coins or any currency of the studio's own (version 1);
 *   - nothing random: an item that names chance, odds, random, a crate, a box, a mystery, loot, a gacha, a spin or a
 *     roll (in its kind, id, name, words or fields) is refused, and the kit has no loot-box primitive;
 *   - no countdown offers: a countdown, timer or "hurry" field is refused (a season pass may END on a date; the kit
 *     shows the date, never a clock);
 *   - an item that gives a play advantage (`"advantage": true`) is never offered, nor counted as owned, on a beginner
 *     or kids server;
 *   - a monthly cap per player that a studio may lower, never raise past the ceiling or remove;
 *   - a refund window for unused items of at least 14 days;
 *   - a studio made for children (`studio.json "audience": "kids"`) sells nothing: its till is off.
 *
 * Who may buy (an adult account; 13-17 through a parent's own checkout; under 13 never) is enforced by the Worker
 * (worker/shop.mjs); a kids server shows no shop; a television never sells (it shows a code to buy on a phone).
 */

export const SHOP_FILE = 'shop.json';
/** The tills this version ships. `link` (another merchant of record) and gems come later, one at a time. */
export const TILLS = Object.freeze(['stripe', 'stripe-managed', 'off']);
/** What an item can be. All directly priced, all deterministic. */
export const KINDS = Object.freeze(['cosmetic', 'supporter', 'pass', 'unlock', 'tip']);
const LATER = Object.freeze({
  gems: 'gems are not in version 1: price items in real money (a studio\'s own currency brings the EU consumer authorities\' currency rules)',
  coins: 'a currency of the studio\'s own is not in version 1: price items in real money',
  currency: 'a currency of the studio\'s own is not in version 1: price items in real money',
  subscription: 'subscriptions come in a later version (terms before billing, express consent, and one-click cancel)',
  service: 'paid services (an AI filling a spot) come in a later version',
});
/** The template's ceiling on what one player may spend here in a month, in the currency's minor units (US$50). */
export const CAP_CEILING = 5000;
export const REFUND_DAYS_MIN = 14;
export const REFUND_DAYS_MAX = 60;
/** Below this an item mostly pays fees: the fixed 30 cents and a never-returned dispute fee. A warning, not a refusal. */
export const PRICE_FLOOR_WARN = 300;
/** The most a single item may cost (US$500): a shop in a game, not a till for anything. */
export const PRICE_MAX = 50_000;
export const ITEMS_MAX = 60;
export const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const ENTITLEMENT_KEY = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TAX_CODE = /^txcd_\d{8}$/;
const CURRENCY = /^[a-z]{3}$/;
/** Currencies without minor units: the cap and the floor would read 100x too high, so they are refused in v1. */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);

/** Paid randomness, in any wording a shop file might use. Whole words, so "Jukebox" is fine and "Mystery Box" is not. */
const RANDOM_WORDS = /\b(?:chance|chances|odds|random|randomi[sz]ed|randomly|crates?|box|boxes|lootbox(?:es)?|loot|mystery|gacha|spins?|roll|rolls|lottery|raffle|sweepstakes?|jackpot|surprise|blind ?bag|drop ?rate|pity)\b/i;
/** Fields that only exist to make an item random. */
const RANDOM_FIELDS = new Set(['odds', 'chance', 'chances', 'random', 'pool', 'drops', 'droptable', 'loottable', 'weights', 'rarityweights', 'probability', 'probabilities']);
/** Fields that only exist to pressure: a clock on an offer. */
const PRESSURE_FIELDS = new Set(['countdown', 'timer', 'hurry', 'limitedtime', 'flash', 'flashsale', 'expiresin', 'urgency', 'scarcity', 'onlyleft']);
const CURRENCY_KEYS = /^(?:gems?|coins?|currency|credits?|points|tokens|bucks|diamonds|crystals|vbucks|robux):/i;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const oneLine = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Every string in a value, with the key path it sits at (to name where a forbidden word is). */
function strings(v, at = '', out = []) {
  if (typeof v === 'string') out.push([at, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${at}[${i}]`, out));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) { out.push([`${at}${at ? '.' : ''}${k}`, k]); strings(x, `${at}${at ? '.' : ''}${k}`, out); }
  return out;
}
/** Every key in a value, lower-cased, with its path. */
function keys(v, at = '', out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => keys(x, `${at}[${i}]`, out));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) { const p = `${at}${at ? '.' : ''}${k}`; out.push([p, k.toLowerCase().replace(/[^a-z]/g, '')]); keys(x, p, out); }
  return out;
}

/** "2026-11-01" or an ISO time: its ms, or null. */
function dateOf(v) {
  if (v === undefined || v === null || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : NaN;
}

/** A badge's words from an entitlement key: badge:supporter → Supporter. */
export function badgeWord(key, item = null) {
  const given = oneLine(item?.badge, 16);
  if (given) return given;
  const word = String(key ?? '').replace(/^badge:/, '').replace(/[-_.:]+/g, ' ').trim();
  return word ? word.charAt(0).toUpperCase() + word.slice(1, 16) : '';
}

/**
 * Check a shop.json. `{ ok, shop, errors, warnings }`: `shop` is the public, normalised shop the Worker sells from
 * (nothing secret is ever in shop.json). `games`: the studio's game ids, when known (the build), to check `game`.
 * `audience`: studio.json "audience" ("kids" closes the till, whatever shop.json says).
 */
export function checkShop(raw, { games = null, audience = 'general' } = {}) {
  const errors = [];
  const warnings = [];
  const err = (at, message) => errors.push({ at, message });
  if (!isObj(raw)) return { ok: false, shop: null, errors: [{ at: '', message: 'shop.json is a JSON object: { "till": "stripe", "currency": "usd", "items": [...] }' }], warnings };
  // Randomness and pressure anywhere in the file, before anything else: the kit has no way to sell either.
  for (const [at, text] of strings(raw)) {
    if (RANDOM_WORDS.test(text)) err(at, `"${oneLine(text, 40)}" names paid randomness (chance, odds, random, a crate, a box, a mystery, loot…). The kit sells only items the buyer can see, at a fixed price.`);
  }
  for (const [at, k] of keys(raw)) {
    if (RANDOM_FIELDS.has(k)) err(at, 'a field for odds, drops or a random pool: the kit never sells paid randomness');
    if (PRESSURE_FIELDS.has(k)) err(at, 'a countdown, timer or "hurry" field: the kit never shows a clock on an offer (a pass may end on a date; the date is shown, not a countdown)');
  }
  const till = raw.till === undefined ? 'stripe' : String(raw.till);
  if (till === 'link') err('till', 'the "link" till (another merchant of record) comes in a later version: use "stripe" or "stripe-managed"');
  else if (!TILLS.includes(till)) err('till', 'till is "stripe" (your own Stripe: you are the seller), "stripe-managed" (Stripe Managed Payments: Stripe is the seller of record and files the tax, for 3.5% more) or "off"');
  const currency = raw.currency === undefined ? 'usd' : String(raw.currency).toLowerCase();
  if (!CURRENCY.test(currency)) err('currency', 'currency is a three-letter code such as "usd", "cad", "eur" or "gbp"');
  else if (ZERO_DECIMAL.has(currency)) err('currency', `${currency.toUpperCase()} has no minor units; version 1 sells in a currency with cents (usd, cad, eur, gbp, aud…)`);
  let refundDays = raw.refundDays === undefined ? REFUND_DAYS_MIN : Math.floor(Number(raw.refundDays));
  if (!(refundDays >= REFUND_DAYS_MIN && refundDays <= REFUND_DAYS_MAX)) { err('refundDays', `refundDays is ${REFUND_DAYS_MIN} to ${REFUND_DAYS_MAX}: a player can always get an unused item refunded for at least 14 days`); refundDays = REFUND_DAYS_MIN; }
  let cap = raw.capPerPlayerMonth === undefined ? CAP_CEILING : Math.floor(Number(raw.capPerPlayerMonth));
  if (!(cap >= 100 && cap <= CAP_CEILING)) { err('capPerPlayerMonth', `capPerPlayerMonth is what one player may spend here in a month, in cents: 100 to ${CAP_CEILING} (US$50). A studio may lower it, never remove it.`); cap = CAP_CEILING; }
  if (raw.supportHomie !== undefined && Number(raw.supportHomie) !== 0) err('supportHomie', 'a voluntary "support Homie" share comes in a later version; leave it out (0 is the default, and Homie takes no cut)');
  if (raw.gems !== undefined || raw.coins !== undefined) err('gems', LATER.gems);

  const items = [];
  const list = Array.isArray(raw.items) ? raw.items : [];
  if (raw.items !== undefined && !Array.isArray(raw.items)) err('items', 'items is a list');
  if (list.length > ITEMS_MAX) err('items', `at most ${ITEMS_MAX} items`);
  const seen = new Set();
  list.slice(0, ITEMS_MAX).forEach((it, i) => {
    const at = `items[${i}]`;
    if (!isObj(it)) { err(at, 'an item is an object'); return; }
    const id = String(it.id ?? '');
    if (!ITEM_ID.test(id)) err(`${at}.id`, 'id is 1 to 40 lowercase letters, digits or -');
    else if (seen.has(id)) err(`${at}.id`, `two items are called "${id}"`);
    seen.add(id);
    const kind = String(it.kind ?? '');
    if (LATER[kind]) { err(`${at}.kind`, LATER[kind]); return; }
    if (!KINDS.includes(kind)) { err(`${at}.kind`, `kind is one of ${KINDS.join(', ')}`); return; }
    const name = oneLine(it.name, 60);
    if (!name) err(`${at}.name`, 'an item needs a name the buyer reads');
    const blurb = oneLine(it.blurb ?? it.description, 200);
    let price = null; let min = null; let max = null;
    if (kind === 'tip') {
      if (it.price !== 'choose' && it.price !== undefined) err(`${at}.price`, 'a tip\'s price is "choose" (pay what you want between min and max)');
      min = Math.floor(Number(it.min ?? 200)); max = Math.floor(Number(it.max ?? 5000));
      if (!(min >= 100 && max >= min && max <= PRICE_MAX)) err(`${at}.min`, 'a tip has min and max in cents (min at least 100, max at most 50000)');
    } else {
      if (typeof it.price !== 'number' || !Number.isInteger(it.price)) err(`${at}.price`, 'price is a whole number of cents in the shop\'s currency (500 is $5.00): real money only, never gems or points');
      else if (!(it.price >= 50 && it.price <= PRICE_MAX)) err(`${at}.price`, 'price is 50 to 50000 cents');
      else { price = it.price; if (price < PRICE_FLOOR_WARN) warnings.push({ at: `${at}.price`, message: `${name || id} costs under ${PRICE_FLOOR_WARN / 100} ${currency.toUpperCase()}: fees (about 30 cents a sale, and a dispute fee that is never returned) eat most of it. Bundle it with something.` }); }
    }
    if (price !== null && price > cap) err(`${at}.price`, `costs more than the monthly cap (${cap} cents): nobody could buy it`);
    const gives = Array.isArray(it.gives) ? it.gives.map(String) : [];
    if (it.gives !== undefined && !Array.isArray(it.gives)) err(`${at}.gives`, 'gives is a list of entitlement keys the game reads: ["skin:ember"]');
    if (kind !== 'tip' && !gives.length) err(`${at}.gives`, 'an item gives something: the keys the game reads with shop.has("skin:ember")');
    if (gives.length > 8) err(`${at}.gives`, 'at most 8 keys an item');
    for (const g of gives) {
      if (!ENTITLEMENT_KEY.test(g)) err(`${at}.gives`, `"${oneLine(g, 40)}" is not a key: lowercase letters, digits and _ . : - (skin:ember, badge:supporter)`);
      else if (CURRENCY_KEYS.test(g)) err(`${at}.gives`, `"${g}" is a currency: version 1 sells items, never gems, coins or points`);
    }
    let days = null;
    if (it.days !== undefined && it.days !== null) {
      days = Math.floor(Number(it.days));
      if (!(days >= 1 && days <= 3650)) { err(`${at}.days`, 'days is how long it lasts, 1 to 3650 (leave it out for ever)'); days = null; }
    }
    const starts = dateOf(it.starts);
    const ends = dateOf(it.ends);
    if (Number.isNaN(starts)) err(`${at}.starts`, 'starts is a date: "2026-11-01"');
    if (Number.isNaN(ends)) err(`${at}.ends`, 'ends is a date: "2027-01-31"');
    if (Number.isFinite(starts) && Number.isFinite(ends) && ends <= starts) err(`${at}.ends`, 'ends after it starts');
    if (it.game !== undefined && it.game !== null) {
      if (!GAME_ID.test(String(it.game))) err(`${at}.game`, 'game is one of the studio\'s game ids (leave it out for the whole studio)');
      else if (Array.isArray(games) && !games.includes(String(it.game))) err(`${at}.game`, `there is no game "${it.game}" in games/`);
    }
    if (it.taxCode !== undefined && !TAX_CODE.test(String(it.taxCode))) err(`${at}.taxCode`, 'taxCode is a Stripe product tax code such as "txcd_10000000"');
    const advantage = it.advantage === true;
    if (advantage && kind === 'supporter') err(`${at}.advantage`, 'a supporter pack never changes how the game plays');
    const badge = gives.find((g) => g.startsWith('badge:'));
    items.push({
      id, kind, name, ...(blurb ? { blurb } : {}),
      ...(kind === 'tip' ? { price: 'choose', min, max } : { price }),
      gives, ...(badge ? { badge: badgeWord(badge, it) } : {}),
      ...(days ? { days } : {}), ...(Number.isFinite(starts) ? { starts: new Date(starts).toISOString() } : {}), ...(Number.isFinite(ends) ? { ends: new Date(ends).toISOString() } : {}),
      ...(it.game ? { game: String(it.game) } : {}), ...(it.taxCode ? { taxCode: String(it.taxCode) } : {}),
      ...(advantage ? { advantage: true } : {}),
    });
  });

  let referrals = null;
  if (raw.referrals !== undefined && raw.referrals !== null && raw.referrals !== 0 && raw.referrals !== false) {
    const r = raw.referrals;
    if (!isObj(r)) err('referrals', 'referrals is { "rate": 0.10, "windowDays": 30, "capPerPlayer": 1000, "holdDays": 30, "minimumInvoice": 2500 } (or leave it out: nobody is paid for sending players)');
    else {
      const rate = Number(r.rate ?? 0.10);
      const windowDays = Math.floor(Number(r.windowDays ?? 30));
      const capPerPlayer = Math.floor(Number(r.capPerPlayer ?? 1000));
      const holdDays = Math.floor(Number(r.holdDays ?? 30));
      const minimumInvoice = Math.floor(Number(r.minimumInvoice ?? 2500));
      if (!(rate >= 0 && rate <= 0.5)) err('referrals.rate', 'rate is a share of the pre-tax price, 0 to 0.5 (0.10 is 10%)');
      if (!(windowDays >= 1 && windowDays <= 90)) err('referrals.windowDays', 'windowDays is 1 to 90');
      if (!(capPerPlayer >= 0 && capPerPlayer <= 10_000)) err('referrals.capPerPlayer', 'capPerPlayer is 0 to 10000 cents');
      if (!(holdDays >= refundDays && holdDays <= 120)) err('referrals.holdDays', `holdDays is ${refundDays} (the refund window) to 120, so a refund never follows a payout`);
      if (!(minimumInvoice >= 0 && minimumInvoice <= 100_000)) err('referrals.minimumInvoice', 'minimumInvoice is 0 to 100000 cents');
      const accept = Array.isArray(r.accept) ? r.accept.map(String).filter((x) => ['stripe-invoice', 'paypal', 'wise', 'gift-codes'].includes(x)) : ['stripe-invoice'];
      const billing = r.billingEmail === undefined ? null : String(r.billingEmail);
      if (billing !== null && !/^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/.test(billing)) err('referrals.billingEmail', 'billingEmail is where referrers send their invoices (an address the studio reads)');
      referrals = { rate: Math.round(rate * 1000) / 1000, windowDays, capPerPlayer, holdDays, minimumInvoice, basis: 'pre-tax', accept, ...(billing ? { billingEmail: billing } : {}) };
    }
  }

  // Where `homie-studio shop catalog` made the items' Products in Stripe (0.24.3): the Worker's checkouts then name them.
  let catalog = [];
  if (raw.catalog !== undefined && raw.catalog !== null) {
    if (!Array.isArray(raw.catalog) || raw.catalog.some((m) => m !== 'test' && m !== 'live')) err('catalog', 'catalog lists where the items are Products in Stripe: ["test"], ["test", "live"] (homie-studio shop catalog writes it)');
    else catalog = [...new Set(raw.catalog)].sort();
  }

  const kids = audience === 'kids';
  const finalTill = kids ? 'off' : TILLS.includes(till) ? till : 'off';
  if (kids && till !== 'off') warnings.push({ at: 'till', message: 'studio.json says "audience": "kids": the studio sells nothing in its games (the till is off whatever shop.json says).' });
  const shop = {
    v: 1, till: finalTill, currency: CURRENCY.test(currency) ? currency : 'usd', refundDays, capPerPlayerMonth: cap, items, referrals,
    open: finalTill !== 'off' && items.length > 0, ...(kids ? { audience: 'kids' } : {}), ...(catalog.length ? { catalog } : {}),
  };
  return { ok: errors.length === 0, shop, errors, warnings };
}

/**
 * The Stripe product tax code an item gets when shop.json names none: video games, downloaded, permanent rights
 * (txcd_10201000), or limited rights for an item that lasts a number of days or ends on a date (txcd_10201001).
 * Managed Payments needs one of its eligible codes on every product; these two are.
 */
export function defaultTaxCode(item) {
  return item?.taxCode ?? (item?.days || item?.ends ? 'txcd_10201001' : 'txcd_10201000');
}

/** studio.json "audience": "general" (the default), "teens" or "kids". */
export function audienceOf(studio) {
  const a = studio?.audience;
  return a === 'kids' || a === 'teens' ? a : 'general';
}

/* ------------------------------------------------------------------ who may buy */

/** The neutral age question's answer as a band (never stored as a date): child (under 13), teen (13-17), adult. */
export function bandOf(year, now = new Date()) {
  const y = Math.floor(Number(year));
  const thisYear = now.getUTCFullYear();
  if (!(y >= 1900 && y <= thisYear)) return null;
  // The youngest a person born that year can be: a year of birth alone never makes a child look older.
  const age = thisYear - y - 1;
  return age < 13 ? 'child' : age < 18 ? 'teen' : 'adult';
}

/**
 * How this player may get an item, the one place the kids rules decide it:
 *   'closed'        the shop is not open (no till, no key, a kids studio)
 *   'kids'          a kids server: nothing is shown at all
 *   'beginner'      an item with a play advantage, on a beginner server: not offered there
 *   'owned'         they have it (and it lasts)
 *   'make-an-account'  a guest (a purchase would be lost with a cookie)
 *   'age-question'  the account has not answered the neutral age question (spending is off until it says adult)
 *   'no'            under 13: never
 *   'ask-a-parent'  13-17: a link a parent opens on their own device and pays in their own name
 *   'checkout'      an adult: Stripe's own page, one purchase at a time
 *   'not-yet' / 'over'  a season pass before it starts or after it ends
 *   'cap'           this month's cap is reached
 */
export function wayFor(item, { open = true, kids = false, beginner = false, player = null, band = null, owned = false, spent = 0, cap = CAP_CEILING, now = Date.now() } = {}) {
  if (!open) return 'closed';
  if (kids) return 'kids';
  if (item.advantage && beginner) return 'beginner';
  if (owned && item.kind !== 'tip') return 'owned';
  if (item.starts && Date.parse(item.starts) > now) return 'not-yet';
  if (item.ends && Date.parse(item.ends) <= now) return 'over';
  if (!player || player.guest) return 'make-an-account';
  if (!band) return 'age-question';
  if (band === 'child') return 'no';
  const price = item.kind === 'tip' ? item.min : item.price;
  if (spent + price > cap) return 'cap';
  if (band === 'teen') return 'ask-a-parent';
  return 'checkout';
}

/** The public face of a shop (for the directory manifest and the shop page): never a secret, never a person. */
export function publicShop(shop) {
  if (!shop) return null;
  return { till: shop.till, currency: shop.currency, refundDays: shop.refundDays, capPerPlayerMonth: shop.capPerPlayerMonth, open: Boolean(shop.open), items: shop.items.length, ...(shop.referrals ? { referrals: shop.referrals } : {}) };
}

/** A price for people: 500 usd → "$5.00", 300 eur → "€3.00", 1250 cad → "CA$12.50". */
export function money(cents, currency = 'usd') {
  const c = String(currency).toUpperCase();
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, currencyDisplay: 'symbol' }).format(Number(cents) / 100); } catch { return `${(Number(cents) / 100).toFixed(2)} ${c}`; }
}
