/** Shop validation and the studio's editable policies. Pure: shared by the build and Worker. */
export const SHOP_FILE = 'shop.json';
/** Implemented payment adapters; item kinds do not select a billing integration. */
export const TILLS = Object.freeze(['stripe', 'stripe-managed', 'off']);
export const POLICY_PRESETS = Object.freeze({
  protective: Object.freeze({ withdrawalAcknowledgement: true, childAge: 13, adultAge: 18, requireAccount: true, ageQuestion: true, children: 'deny', teens: 'parent',
    kidsStudio: false, kidsServer: false, beginnerAdvantages: false, kidsAdvantages: false,
    repeatPurchases: false, refundUsedItems: false, televisionCheckout: false }),
  'adults-only': Object.freeze({ withdrawalAcknowledgement: true, childAge: 13, adultAge: 18, requireAccount: true, ageQuestion: true, children: 'deny', teens: 'deny',
    kidsStudio: false, kidsServer: false, beginnerAdvantages: false, kidsAdvantages: false,
    repeatPurchases: false, refundUsedItems: false, televisionCheckout: false }),
  custom: Object.freeze({ withdrawalAcknowledgement: false, childAge: 13, adultAge: 18, requireAccount: false, ageQuestion: false, children: 'allow', teens: 'allow',
    kidsStudio: true, kidsServer: true, beginnerAdvantages: true, kidsAdvantages: true,
    repeatPurchases: true, refundUsedItems: true, televisionCheckout: true }),
});
export const ITEM_ID = /^[^\u0000-\u001f\u007f]+$/;
export const ENTITLEMENT_KEY = /^[^\u0000-\u001f\u007f]+$/;
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TAX_CODE = /^txcd_\d{8}$/;
const CURRENCY = /^[a-z]{3}$/;
// Stripe currency units, special cases and settlement-currency minimums, fetched 2026-10-08:
// https://docs.stripe.com/currencies#zero-decimal
// https://docs.stripe.com/currencies#special-cases
// https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts
// Free Checkout orders: https://docs.stripe.com/payments/checkout/no-cost-orders (fetched 2026-10-08).
// Actual minimums after conversion and payment-method maximums are enforced by Stripe at checkout.
export const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
export const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);
export const currencyScale = (currency) => ZERO_DECIMAL.has(String(currency).toLowerCase()) ? 1 : THREE_DECIMAL.has(String(currency).toLowerCase()) ? 1000 : 100;
// No three-decimal divisibility refusal: https://docs.stripe.com/currencies does not document one (2026-10-08).
export const amountStep = (currency) => ['isk', 'ugx'].includes(String(currency).toLowerCase()) ? 100 : 1;
const MINIMUMS = { usd: 50, aed: 200, ars: 50, aud: 50, brl: 50, cad: 50, chf: 50, cop: 50, czk: 1500, dkk: 250, eur: 50, gbp: 30, hkd: 400, huf: 17500, idr: 50, ils: 50, inr: 50, jpy: 50, krw: 50, mxn: 1000, myr: 200, nok: 300, nzd: 50, php: 50, pln: 200, ron: 200, rub: 50, sek: 300, sgd: 50, thb: 1000, zar: 50 };
export const minimumCharge = (currency) => MINIMUMS[currency] ?? amountStep(currency);
/** Parse the buyer's decimal text without rounding a fractional currency unit. */
export function parseAmount(value, scale = 100) {
  const digits = Math.log10(scale);
  if (!new RegExp(`^\\d+(?:\\.\\d{0,${digits}})?$`).test(String(value))) return NaN;
  const parts = String(value).split('.');
  if (scale === 1 && parts[1] && Number(parts[1]) !== 0) return NaN;
  const n = Number(BigInt(parts[0]) * BigInt(scale) + (scale === 1 ? 0n : BigInt((parts[1] || '').padEnd(digits, '0'))));
  return Number.isSafeInteger(n) ? n : NaN;
}
export function amountError(amount, currency) {
  if (!Number.isSafeInteger(amount) || amount < 0) return 'Stripe amounts must be nonnegative whole numbers of its currency unit, within JavaScript safe integer arithmetic.';
  if (amount % amountStep(currency)) return `Stripe requires ${currency.toUpperCase()} amounts divisible by ${amountStep(currency)} in its API minor units.`;

  return null;
}

/** Round a decimal rate times integer money exactly, including exponent notation. */
export function referralShare(amount, rate) {
  const [digits, exponent = '0'] = String(rate).toLowerCase().split('e');
  const [whole, fraction = ''] = digits.split('.');
  const scale = fraction.length - Number(exponent);
  let numerator = BigInt(whole + fraction), denominator = 1n;
  if (scale > 0) denominator = 10n ** BigInt(scale); else numerator *= 10n ** BigInt(-scale);
  const share = Number((2n * BigInt(amount) * numerator + denominator) / (2n * denominator));
  if (!Number.isSafeInteger(share)) throw new RangeError('Referral share exceeds safe integer arithmetic');
  return share;
}

/** Checkout wording is shared by validation and the request path. */
export function checkoutMessage(shop, studio = 'this studio', parent = false) {
  return `${parent ? "This is for your child's account. " : ''}Delivered at once to the player's account on ${studio}. ${shop.policy.withdrawalAcknowledgement ? 'By paying you ask for it now, which ends the 14-day withdrawal right;' : 'Your statutory rights still apply.'} ${shop.refundDays === null ? (shop.policy.withdrawalAcknowledgement ? 'ask the studio about refunds.' : 'Ask the studio about refunds.') : `${shop.policy.refundUsedItems ? 'an item' : 'an unused item'} can still be refunded within ${shop.refundDays} days.`}`;
}

const numeric = (value) => typeof value === 'number' ? value : typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : NaN;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const oneLine = (v, max = Infinity) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** "2026-11-01" or an ISO time: its ms, or null. */
function dateOf(v) {
  if (v === undefined || v === null || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : NaN;
}

/** A badge's words from an entitlement key: badge:supporter → Supporter. */
export function badgeWord(key, item = null) {
  const given = oneLine(item?.badge);
  if (given) return given;
  const word = String(key ?? '').replace(/^badge:/, '').replace(/[-_.:]+/g, ' ').trim();
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : '';
}

/**
 * Check a shop.json. `{ ok, shop, errors, warnings }`: `shop` is the public, normalised shop the Worker sells from
 * (nothing secret is ever in shop.json). `games`: the studio's game ids, when known (the build), to check `game`.
 * `audience`: studio.json "audience" (the studio policy decides whether a kids studio sells).
 */
export function checkShop(raw, { games = null, audience = 'general', studioName = 'this studio' } = {}) {
  const errors = [];
  const warnings = [];
  const err = (at, message) => errors.push({ at, message });
  if (!isObj(raw)) return { ok: false, shop: null, errors: [{ at: '', message: 'shop.json is a JSON object: { "till": "stripe", "currency": "usd", "items": [...] }' }], warnings };
  const preset = raw.policy?.preset ?? 'custom';
  if (!Object.hasOwn(POLICY_PRESETS, preset)) err('policy.preset', 'choose protective, adults-only or custom');
  if (raw.policy !== undefined && !isObj(raw.policy)) err('policy', 'policy is an object with a named preset and editable rules');
  const policy = { preset, ...(Object.hasOwn(POLICY_PRESETS, preset) ? POLICY_PRESETS[preset] : POLICY_PRESETS.custom) };
  for (const key of Object.keys(POLICY_PRESETS.protective)) {
    if (raw.policy?.[key] === undefined) continue;
    const value = raw.policy[key];
    if (['childAge', 'adultAge'].includes(key)) {
      if (!Number.isSafeInteger(value) || value < 0) err(`policy.${key}`, 'use a nonnegative whole age in years');
      else policy[key] = value;
      continue;
    }
    if (['children', 'teens'].includes(key) ? !['deny', 'parent', 'allow'].includes(value) : typeof value !== 'boolean') err(`policy.${key}`, 'use a boolean, or deny / parent / allow for children and teens');
    else policy[key] = value;
  }
  if (policy.childAge >= policy.adultAge) err('policy.adultAge', 'adultAge must be greater than childAge');
  const till = raw.till === undefined ? 'stripe' : String(raw.till);
  if (!TILLS.includes(till)) err('till', 'till is "stripe" (your own Stripe: you are the seller), "stripe-managed" (Stripe Managed Payments: Stripe is the seller of record and files the tax, for 3.5% more) or "off"');
  const currency = raw.currency === undefined ? 'usd' : String(raw.currency).toLowerCase();
  if (!CURRENCY.test(currency)) err('currency', 'currency is a three-letter code such as "usd", "cad", "eur" or "gbp"');
  const optionalNumber = (value, at, { integer = true } = {}) => {
    if (value === undefined || value === null) return null;
    value = numeric(value); // Decimal numeric strings remain accepted; booleans and containers do not.
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !at.endsWith('Days') && !Number.isSafeInteger(value))) err(at, `write a nonnegative ${integer && !at.endsWith('Days') ? 'whole number of minor units (for example 2500, not 2500.7)' : 'finite number'}, or omit the setting.${integer && !at.endsWith('Days') ? ' Amounts are never rounded.' : ''}`);
    if (at.endsWith('Days') && value !== null && (!Number.isSafeInteger(Math.round(value * 86400000)) || !Number.isSafeInteger(Math.round(value * 86400000) + Date.now()) || !Number.isFinite(new Date(Math.round(value * 86400000) + Date.now()).getTime()))) err(at, 'duration rounded to milliseconds must remain within safe arithmetic and the JavaScript timestamp range');
    return value;
  };
  // Stripe permits 30 minutes to 24 hours; 24 hours is its default.
  // https://docs.stripe.com/api/checkout/sessions/create#create_checkout_session-expires_at
  const checkoutMinutes = numeric(raw.checkoutMinutes ?? 1440);
  if (!Number.isSafeInteger(checkoutMinutes * 60) || checkoutMinutes < 30 || checkoutMinutes > 1440) err('checkoutMinutes', 'Stripe accepts 30 to 1440 minutes (24 hours), in whole seconds.');
  const requestBytes = optionalNumber(raw.requestBytes, 'requestBytes');
  const refundDays = optionalNumber(raw.refundDays, 'refundDays');
  const cap = optionalNumber(raw.capPerPlayerMonth, 'capPerPlayerMonth');
  // 600 new buyers per hour allows a school or venue to arrive together without disabling flood protection.
  const guestBuyersPerAddressPerHour = numeric(raw.guestBuyersPerAddressPerHour ?? 600);
  if (!Number.isSafeInteger(guestBuyersPerAddressPerHour) || guestBuyersPerAddressPerHour < 1) err('guestBuyersPerAddressPerHour', 'use a positive whole number for new guest flood protection');
  const purchaseAttemptsPerMinute = numeric(raw.purchaseAttemptsPerMinute ?? 6);
  // A school or venue can share an address; its aggregate bucket must allow many independent accounts.
  const purchaseAttemptsPerAddressPerMinute = numeric(raw.purchaseAttemptsPerAddressPerMinute ?? 600);
  if (!Number.isSafeInteger(purchaseAttemptsPerAddressPerMinute) || purchaseAttemptsPerAddressPerMinute < 1) err('purchaseAttemptsPerAddressPerMinute', 'use a positive whole number for address flood protection');
  if (!Number.isSafeInteger(purchaseAttemptsPerMinute) || purchaseAttemptsPerMinute < 1) err('purchaseAttemptsPerMinute', 'use a positive whole number for the studio account rate limit');

  for (const key of ['automaticTax', 'referralNewPlayersOnly']) if (raw[key] !== undefined && typeof raw[key] !== 'boolean') err(key, 'use a boolean');
  const items = [];
  const list = Array.isArray(raw.items) ? raw.items : [];
  if (raw.items !== undefined && !Array.isArray(raw.items)) err('items', 'items is a list');
  const seen = new Set();
  list.forEach((it, i) => {
    const at = `items[${i}]`;
    if (!isObj(it)) { err(at, 'an item is an object'); return; }
    const id = String(it.id ?? '');
    if (!id.trim() || !ITEM_ID.test(id)) err(`${at}.id`, 'id is nonempty text without control characters');
    else if (seen.has(id)) err(`${at}.id`, `two items are called "${id}"`);
    seen.add(id);
    const kind = String(it.kind ?? 'item');
    const name = oneLine(it.name);
    if (!name) err(`${at}.name`, 'an item needs a name the buyer reads');
    const blurb = oneLine(it.blurb ?? it.description);
    // Stripe Product text constraints: https://docs.stripe.com/api/products/create
    if ([...name].length > 5000) err(`${at}.name`, 'Stripe product names allow at most 5000 characters. Shorten the name.');
    if ([...blurb].length > 40000) err(`${at}.blurb`, 'Stripe product descriptions allow at most 40000 characters. Shorten the description.');
    let price = null; let min = null; let max = null;
    const chosen = it.price === 'choose' || kind === 'tip' && it.price === undefined;
    if (chosen) {
      min = numeric(it.min ?? 0); max = optionalNumber(it.max, `${at}.max`);
      const why = amountError(min, currency);
      if (why) err(`${at}.min`, why);
      if (max !== null && (max < min || amountError(max, currency))) err(`${at}.max`, 'the studio tip maximum must be at least its minimum and use valid Stripe currency units');
    } else {
      const why = amountError(numeric(it.price), currency);
      if (why) err(`${at}.price`, why);
      else price = numeric(it.price);
    }
    const charge = chosen ? min : price;
    if (currencyScale(currency) === 1000 && charge % 10) warnings.push({ at: `${at}.price`, message: 'This three-decimal amount uses the smallest minor unit. Confirm support with your Stripe payment method; Stripe decides acceptance (https://docs.stripe.com/currencies).' });
    if (charge > 0 && charge < minimumCharge(currency)) warnings.push({ at: `${at}.price`, message: `Stripe's minimum for settlement in ${currency.toUpperCase()} is ${money(minimumCharge(currency), currency)}. Your settlement currency and payment method determine the actual minimum at checkout.` });
    if (cap !== null && price !== null && price > cap) warnings.push({ at: `${at}.price`, message: 'This price exceeds the studio capPerPlayerMonth setting; raise or remove that setting to allow a purchase.' });
    const gives = Array.isArray(it.gives) ? it.gives.map(String) : [];
    if (it.gives !== undefined && !Array.isArray(it.gives)) err(`${at}.gives`, 'gives is a list of entitlement keys the game reads: ["skin:ember"]');
    for (const g of gives) {
      if (!g.trim() || !ENTITLEMENT_KEY.test(g)) err(`${at}.gives`, `"${oneLine(g, 40)}" is not a key: use nonempty text without control characters`);
    }
    let days = null;
    if (it.days !== undefined && it.days !== null) {
      days = numeric(it.days);
      if (!(days >= 0 && Number.isFinite(days) && Number.isSafeInteger(Math.round(days * 86400000)) && Number.isSafeInteger(Math.round(days * 86400000) + Date.now()) && Number.isFinite(new Date(Math.round(days * 86400000) + Date.now()).getTime()))) { err(`${at}.days`, 'days is a nonnegative duration with whole milliseconds within safe arithmetic and the JavaScript timestamp range (omit for forever)'); days = null; }
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
    const badge = gives.find((g) => g.startsWith('badge:'));
    for (const key of Object.keys(it)) {
      if (!['id', 'kind', 'name', 'blurb', 'description', 'price', 'min', 'max', 'gives', 'badge', 'days', 'starts', 'ends', 'game', 'taxCode', 'advantage'].includes(key)) warnings.push({ at: `${at}.${key}`, message: 'This field is not published by the shop. Describe any buyer-facing meaning in blurb so buyers can read it.' });
    }
    items.push({
      id, kind, name, ...(blurb ? { blurb } : {}),
      ...(chosen ? { price: 'choose', min, max } : { price }),
      gives, ...(badge ? { badge: badgeWord(badge, it) } : {}),
      ...(days !== null ? { days } : {}), ...(Number.isFinite(starts) ? { starts: new Date(starts).toISOString() } : {}), ...(Number.isFinite(ends) ? { ends: new Date(ends).toISOString() } : {}),
      ...(it.game ? { game: String(it.game) } : {}), ...(it.taxCode ? { taxCode: String(it.taxCode) } : {}),
      advantage,
    });
  });

  let referrals = null;
  if (raw.referrals !== undefined && raw.referrals !== null && raw.referrals !== 0 && raw.referrals !== false) {
    const r = raw.referrals;
    if (!isObj(r)) err('referrals', 'referrals is { "rate": 0.10, "windowDays": 30, "capPerPlayer": 1000, "holdDays": 30, "minimumInvoice": 2500 } (or leave it out: nobody is paid for sending players)');
    else {
      const rate = optionalNumber(r.rate ?? 0, 'referrals.rate', { integer: false });
      const windowDays = optionalNumber(r.windowDays, 'referrals.windowDays');
      const capPerPlayer = optionalNumber(r.capPerPlayer, 'referrals.capPerPlayer');
      const holdDays = optionalNumber(r.holdDays, 'referrals.holdDays');
      const minimumInvoice = optionalNumber(r.minimumInvoice, 'referrals.minimumInvoice');
      const accept = Array.isArray(r.accept) ? r.accept.map(String) : [];
      const billing = r.billingEmail === undefined ? null : String(r.billingEmail);
      if (billing !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing)) err('referrals.billingEmail', 'billingEmail is where referrers send their invoices (an address the studio reads)');
      referrals = { rate, windowDays, capPerPlayer, holdDays, minimumInvoice, basis: 'pre-tax', accept, ...(billing ? { billingEmail: billing } : {}) };
    }
  }

  // Where `homie-studio shop catalog` made the items' Products in Stripe (0.24.3): the Worker's checkouts then name them.
  let catalog = [];
  if (raw.catalog !== undefined && raw.catalog !== null) {
    if (!Array.isArray(raw.catalog) || raw.catalog.some((m) => m !== 'test' && m !== 'live')) err('catalog', 'catalog lists where the items are Products in Stripe: ["test"], ["test", "live"] (homie-studio shop catalog writes it)');
    else catalog = [...new Set(raw.catalog)].sort();
  }

  const kids = audience === 'kids' && !policy.kidsStudio;
  const finalTill = kids ? 'off' : TILLS.includes(till) ? till : 'off';
  if (kids && till !== 'off') warnings.push({ at: 'till', message: 'studio.json says "audience": "kids": the studio sells nothing in its games (the till is off under policy.kidsStudio).' });
  const shop = {
    v: 1, policy, purchasesTill: TILLS.includes(raw.purchasesTill ?? till) ? (raw.purchasesTill ?? till) : 'off', ...(/^https:\/\/billing\.stripe\.com\/p\/login\/[A-Za-z0-9_]+$/.test(raw.purchasesPortalLogin ?? '') ? { purchasesPortalLogin: raw.purchasesPortalLogin } : {}), checkoutMinutes, requestBytes, automaticTax: raw.automaticTax === true, referralNewPlayersOnly: raw.referralNewPlayersOnly === true, guestBuyersPerAddressPerHour, purchaseAttemptsPerMinute, purchaseAttemptsPerAddressPerMinute, till: finalTill, currency: CURRENCY.test(currency) ? currency : 'usd', refundDays, capPerPlayerMonth: cap, items, referrals,
    open: finalTill !== 'off' && items.length > 0, ...(kids ? { audience: 'kids' } : {}), ...(catalog.length ? { catalog } : {}),
  };
  // https://docs.stripe.com/api/checkout/sessions/create#create_checkout_session-custom_text-submit-message
  if ([...checkoutMessage(shop, studioName, true)].length > 1200) err('studio.name / refundDays', 'Stripe submit messages allow at most 1200 characters. Shorten the studio name or refund wording.');
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
export function bandOf(year, now = new Date(), policy = POLICY_PRESETS.custom) {
  const y = (typeof year === 'number' || typeof year === 'string' && /^\d+$/.test(year)) ? Number(year) : NaN;
  const thisYear = now.getUTCFullYear();
  if (!(Number.isSafeInteger(y) && y >= 0 && y <= thisYear)) return null;
  // The youngest a person born that year can be: a year of birth alone never makes a child look older.
  const age = thisYear - y - 1;
  return age < policy.childAge ? 'child' : age < policy.adultAge ? 'teen' : 'adult';
}

/**
 * How this player may get an item under the studio policy (descriptions below use protective):
 *   'closed'        the shop is not open (no till, no key, a kids studio)
 *   'kids'          a kids server: nothing is shown at all
 *   'beginner'      an item with a play advantage, on a beginner server: not offered there
 *   'owned'         they have it (and it lasts)
 *   'make-an-account'  a guest (a purchase would be lost with a cookie)
 *   'age-question'  the studio requires an age band before checkout
 *   'no'            the studio denies this age band
 *   'ask-a-parent'  13-17: a link a parent opens on their own device and pays in their own name
 *   'checkout'      Stripe's own page, with the requested cart
 *   'not-yet' / 'over'  a season pass before it starts or after it ends
 *   'cap'           this month's cap is reached
 */
export function wayFor(item, { open = true, kids = false, beginner = false, player = null, band = null, owned = false, spent = 0, cap = null, policy = POLICY_PRESETS.custom, now = Date.now() } = {}) {
  if (!open) return 'closed';
  if (kids && !policy.kidsServer) return 'kids';
  if (item.advantage && ((beginner && !policy.beginnerAdvantages) || (kids && !policy.kidsAdvantages))) return 'beginner';
  if (owned && item.kind !== 'tip' && !policy.repeatPurchases) return 'owned';
  if (item.starts && Date.parse(item.starts) > now) return 'not-yet';
  if (item.ends && Date.parse(item.ends) <= now) return 'over';
  if (policy.requireAccount && (!player || player.guest)) return 'make-an-account';
  if (policy.ageQuestion && !band) return 'age-question';
  if ((band === 'child' && policy.children === 'deny') || (band === 'teen' && policy.teens === 'deny')) return 'no';
  const price = item.price === 'choose' ? item.min : item.price;
  if (price > 0 && cap !== null && spent + price > cap) return 'cap';
  if ((band === 'teen' && policy.teens === 'parent') || (band === 'child' && policy.children === 'parent')) return 'ask-a-parent';
  return 'checkout';
}

/** The public face of a shop (for the directory manifest and the shop page): never a secret, never a person. */
export function publicShop(shop) {
  if (!shop) return null;
  return { policy: shop.policy, till: shop.till, currency: shop.currency, refundDays: shop.refundDays, capPerPlayerMonth: shop.capPerPlayerMonth, open: Boolean(shop.open), items: shop.items.length, ...(shop.referrals ? { referrals: shop.referrals } : {}) };
}

/** A price for people: 500 usd → "$5.00", 300 eur → "€3.00", 1250 cad → "CA$12.50". */
export function money(cents, currency = 'usd') {
  const c = String(currency).toUpperCase();
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, currencyDisplay: 'symbol', minimumFractionDigits: currencyScale(currency) === 1 || amountStep(currency) === 100 ? 0 : Math.log10(currencyScale(currency)), maximumFractionDigits: currencyScale(currency) === 1 || amountStep(currency) === 100 ? 0 : Math.log10(currencyScale(currency)) }).format(Number(cents) / currencyScale(currency)); } catch { return `${(Number(cents) / currencyScale(currency)).toFixed(2)} ${c}`; }
}
