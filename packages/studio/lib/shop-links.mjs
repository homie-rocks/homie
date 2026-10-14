/** Reconcile through the owner's official Stripe CLI session; never export its credentials. */
import { createHash, randomUUID } from 'node:crypto';
import { productIdOf, WEBHOOK_SECRET_SHAPE } from '../worker/stripe.mjs';
import { defaultTaxCode } from '../worker/shop-rules.mjs';
import { LINKS_STRIPE_VERSION, linkSettings, paymentLinkURL } from '../worker/shop-links.mjs';
import { HOOK_EVENTS, SHOP_HOOK_EVENTS } from './shop.mjs';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (a, b) => Object.keys(a ?? {}).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => a?.[k] === v);
export async function syncPaymentLinks({ root, api, shop, slug, site, mode, w, receipt, saveReceipt, bookingSlots = [] }) {
  const list = async (path, params = {}) => {
    const all = []; let cursor;
    do {
      const p = await api('GET', path, { ...params, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      if (!Array.isArray(p.data)) throw new Error('Incomplete Stripe list');
      all.push(...p.data);
      const next = p.has_more ? p.data.at(-1)?.id : null;
      if (p.has_more && (!next || next === cursor)) throw new Error('Incomplete Stripe pagination');
      cursor = next;
    } while (cursor);
    return all;
  };
  const secrets = await w(['secret', 'list']);
  if (secrets.code !== 0) return { ok: false, needs: 'cloudflare', why: 'Connect Cloudflare and deploy the studio, then run shop connect again.' };
  const names = JSON.parse(secrets.stdout ?? secrets.out);
  const has = (name) => names.some((s) => s.name === name);
  const products = await list('/v1/products');
  const prices = await list('/v1/prices');
  const links = await list('/v1/payment_links');
  const own = (o) => o.metadata?.homie === 'shop-links-v1' && o.metadata?.studio === slug && o.metadata?.origin === site;
  const config = { v: 1, mode, settings: linkSettings(shop), items: [] };
  const catalogPrices = new Map();
  const keepPrices = new Set(), keepLinks = new Set(), keepProducts = new Set();
  for (const item of shop.items) {
    const id = await productIdOf(slug, item.id);
    keepProducts.add(id);
    const metadata = { homie: 'shop-links-v1', studio: slug, origin: site };
    const fields = { name: item.name, description: item.blurb ?? '', tax_code: item.taxCode ?? defaultTaxCode(item), metadata, active: true };
    let product = products.find((p) => p.id === id);
    if (!product) product = await api('POST', '/v1/products', { id, ...fields }, `product-${hash(id)}`);
    else if (!same(product.metadata, metadata) || product.name !== fields.name || (product.description ?? '') !== fields.description || (product.tax_code?.id ?? product.tax_code) !== fields.tax_code || !product.active) await api('POST', `/v1/products/${id}`, fields);
    // Omit an unset minimum: Stripe applies its settlement-currency floor itself.
    // https://docs.stripe.com/api/prices/create#create_price-custom_unit_amount-minimum
    const priceFields = { product: id, currency: shop.currency, ...(item.interval ? { recurring: { interval: item.interval } } : {}), tax_behavior: 'exclusive', ...(item.price === 'choose'
      ? { custom_unit_amount: { enabled: true, ...(item.min > 0 ? { minimum: item.min } : {}), ...(item.max !== null ? { maximum: item.max } : {}) } }
      : { unit_amount: item.price }) };
    const revision = hash(priceFields);
    let price = prices.find((p) => own(p) && p.product === id && p.metadata?.revision === revision);
    if (!price) price = await api('POST', '/v1/prices', { ...priceFields, metadata: { ...metadata, revision } }, `price-${hash({ priceFields, metadata })}`);
    if (!price.active) await api('POST', `/v1/prices/${price.id}`, { active: true });
    keepPrices.add(price.id);
    catalogPrices.set(item.id, price.id);
    if ((product.default_price?.id ?? product.default_price) !== price.id) await api('POST', `/v1/products/${id}`, { default_price: price.id });
    if (item.price === 0) continue; // Free orders never leave the studio.
    const params = { line_items: [{ price: price.id, quantity: 1, ...(item.price !== 'choose' ? { adjustable_quantity: { enabled: shop.policy.repeatPurchases, minimum: 1, maximum: 999999 } } : {}) }],
      after_completion: { type: 'redirect', redirect: { url: `${site}/shop/thanks?session_id={CHECKOUT_SESSION_ID}` } },
      ...(shop.till === 'stripe-managed' ? { managed_payments: { enabled: true } } : { automatic_tax: { enabled: shop.automaticTax } }),
      ...(item.interval ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
    };
    const linkRevision = hash({ params, item, policy: shop.policy });
    let link = links.find((p) => own(p) && p.metadata?.revision === linkRevision);
    if (!link) link = await api('POST', '/v1/payment_links', { ...params, metadata: { ...metadata, revision: linkRevision } }, `link-${linkRevision}`);
    if (!link.active) await api('POST', `/v1/payment_links/${link.id}`, { active: true });
    if (!paymentLinkURL(link.url) || !/^plink_\w+$/.test(link.id)) throw new Error('Invalid Payment Link');
    keepLinks.add(link.id);
    config.items.push({ item: item.id, id: link.id, url: link.url, price: price.id, revision: linkRevision });
  }
  // Menus use paid invoice snapshots: Checkout events omit their line items.
  // Stripe allows 20 Payment Link lines; split larger catalogues into menus.
  config.menus = [];
  const menuItems = shop.items.filter(i => typeof i.price === 'number' && i.price > 0 && !i.interval);
  const metadata = { homie: 'shop-links-v1', studio: slug, origin: site };
  for (let offset = 0; offset < menuItems.length; offset += 20) {
    const items = menuItems.slice(offset, offset + 20);
    if (items.length < 2) continue;
    const params = { line_items: items.map(i => ({price:catalogPrices.get(i.id),quantity:1,adjustable_quantity:{enabled:true,minimum:0,maximum:999999}})),
      invoice_creation:{enabled:true,invoice_data:{metadata}},
      after_completion:{type:'redirect',redirect:{url:`${site}/shop/thanks?session_id={CHECKOUT_SESSION_ID}`}},
      automatic_tax:{enabled:shop.automaticTax}, payment_intent_data:{metadata} };
    const revision=hash(params);
    let link=links.find(p=>own(p)&&p.metadata?.revision===revision);
    if(!link)link=await api('POST','/v1/payment_links',{...params,metadata:{...metadata,revision}},`menu-${revision}`);
    if(!link.active)await api('POST',`/v1/payment_links/${link.id}`,{active:true});
    keepLinks.add(link.id);
    config.menus.push({id:link.id,url:link.url,revision,items:items.map(i=>({item:i.id,price:catalogPrices.get(i.id)}))});
  }
  config.slots=[];
  for(const slot of bookingSlots) {
    if(!['app','collection','slots','slot','item'].every(k=>typeof slot[k]==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(slot[k])) || !Number.isSafeInteger(slot.capacity) || slot.capacity<0)throw new Error('Invalid booking slot manifest');
    const item=shop.items.find(i=>i.id===slot.item);
    if(!item || item.interval || item.price==='choose')throw new Error('Bookings require a fixed one-time service price');
    if(!item.price || !slot.capacity || slot.active===false)continue;
    const identity=hash({app:slot.app,collection:slot.collection,slots:slot.slots,slot:slot.slot});
    const params={line_items:[{price:catalogPrices.get(item.id),quantity:1}],payment_method_types:['card'],
      restrictions:{completed_sessions:{limit:slot.capacity}},after_completion:{type:'redirect',redirect:{url:`${site}/shop/thanks?session_id={CHECKOUT_SESSION_ID}`}}};
    let link=links.find(p=>own(p)&&p.metadata?.slot===identity);
    // Reuse the link and its lifetime completion count when capacity changes.
    if(!link)link=await api('POST','/v1/payment_links',{...params,metadata:{...metadata,slot:identity,revision:identity}},`slot-${identity}`);
    else {
      const count=link.restrictions?.completed_sessions?.count??0;
      link=await api('POST',`/v1/payment_links/${link.id}`,{restrictions:params.restrictions,active:count<slot.capacity});
    }
    keepLinks.add(link.id);
    config.slots.push({...slot,id:link.id,url:link.url,price:catalogPrices.get(item.id),revision:identity,active:link.active,count:link.restrictions?.completed_sessions?.count??0});
  }
  if(shop.items.some(i=>i.interval)) {
    const portals=await list('/v1/billing_portal/configurations');
    let portal=portals.find(p=>own(p));
    const params={features:{subscription_cancel:{enabled:true},payment_method_update:{enabled:true},invoice_history:{enabled:true}},login_page:{enabled:true},business_profile:{headline:'Manage your membership or giving'},default_return_url:`${site}/shop/`,metadata};
    portal=await api('POST',portal?`/v1/billing_portal/configurations/${portal.id}`:'/v1/billing_portal/configurations',params);
    config.portal=portal.login_page?.url;
  }
  const purchases = root ? await (await import('./purchase-links.mjs')).syncPurchaseLinks({ root, api, slug, site, mode, list, till: shop.purchasesTill ?? shop.till }) : null;
  const purchaseSecrets = {};
  if (purchases?.config.offers.length && !has('PURCHASE_SIGNING_KEYS')) {
    const { generateKeyPair, exportJWK } = await import('jose');
    const pair = await generateKeyPair('Ed25519', { extractable: true });
    purchaseSecrets.PURCHASE_SIGNING_KEYS = JSON.stringify([await exportJWK(pair.privateKey)]);
  }
  const events = purchases?.config.offers.length ? HOOK_EVENTS : SHOP_HOOK_EVENTS;
  const endpoints = await list('/v1/webhook_endpoints');
  const url = `${site}/api/shop/hook`;
  const current = endpoints.find((e) => e.id === receipt?.endpoint && e.url === url && e.status === 'enabled' && events.every((event) => e.enabled_events?.includes(event)));
  let endpoint = current, secret;
  if (!endpoint || !has('STRIPE_WEBHOOK_SECRET')) {
    const pending = receipt?.url === url && receipt?.pending ? receipt.pending : randomUUID();
    saveReceipt({ ...receipt, pending, mode, url }); // Retry the same private creation response; never persist the secret.
    endpoint = await api('POST', '/v1/webhook_endpoints', { url, enabled_events: [...events], api_version: LINKS_STRIPE_VERSION, metadata: { homie: 'shop-v1' }, description: 'Studio shop' }, `webhook-${pending}`);
    if (!WEBHOOK_SECRET_SHAPE.test(endpoint.secret ?? '')) throw new Error('Missing signing secret');
    secret = endpoint.secret;
  }
  const fingerprint = hash({config, purchases:purchases?.config});
  const unchanged = current && !secret && receipt?.fingerprint === fingerprint && has('STRIPE_SHOP_LINKS') && !has('STRIPE_KEY');
  if (!unchanged) {
    const saved = await w(['secret', 'bulk'], { input: JSON.stringify({ STRIPE_SHOP_LINKS: JSON.stringify(config), ...purchaseSecrets, ...(purchases && (purchases.config.offers.length || has('PURCHASE_LINKS')) ? { PURCHASE_LINKS: JSON.stringify(purchases.config) } : {}), ...(secret ? { STRIPE_WEBHOOK_SECRET: secret } : {}) }) });
    if (saved.code !== 0) return { ok: false, needs: 'cloudflare', why: 'Cloudflare could not save the shop connection. Run shop connect again; existing webhooks remain active.' };
    // Explicitly running connect selects keyless; manual selects the existing keyed checkout.
    if (has('STRIPE_KEY') && (await w(['secret', 'delete', 'STRIPE_KEY'], { input: 'y\n' })).code !== 0) return { ok: false, needs: 'cloudflare', why: 'The links are ready; run shop connect again to finish removing the old checkout credential.' };
    saveReceipt({ mode, endpoint: endpoint.id, url, fingerprint, keyless: true });
  }
  await purchases?.retire();
  // Retire only after the replacement configuration and signing secret are installed.
  for (const link of links.filter((p) => own(p) && p.active && !keepLinks.has(p.id))) await api('POST', `/v1/payment_links/${link.id}`, { active: false });
  for (const price of prices.filter((p) => own(p) && p.active && !keepPrices.has(p.id))) await api('POST', `/v1/prices/${price.id}`, { active: false });
  for (const product of products.filter((p) => own(p) && p.active && !keepProducts.has(p.id))) await api('POST', `/v1/products/${product.id}`, { active: false });
  for (const e of endpoints.filter((e) => e.id !== endpoint.id && e.url === url && e.metadata?.homie === 'shop-v1' && e.status !== 'disabled')) await api('POST', `/v1/webhook_endpoints/${e.id}`, { disabled: true });
  return { ok: true, command: 'shop connect', mode, keyless: true, saved: !unchanged, alreadyConnected: Boolean(unchanged), webhook: { id: endpoint.id, url }, verifiedPurchase: false,
    message: 'Your shop uses Stripe Payment Links. No Stripe API key is stored in the Worker.',
    next: ['Verify a purchase, its signed webhook and item grant; refund in Stripe or ask your connected AI, then verify removal.'] };
}
