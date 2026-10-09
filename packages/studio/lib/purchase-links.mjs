/** Uses the shop's authorized Stripe API transport; no API credential goes to the Worker. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sharedPartsOf, readPart, packedDir } from './parts.mjs';
import { canonicalJson } from '../worker/referrals.mjs';
import { paymentLinkURL } from '../worker/shop-links.mjs';
const hash = (v) => createHash('sha256').update(canonicalJson(v)).digest('hex');
export async function syncPurchaseLinks({ root, api, slug, site, mode, list, till }) {
  const file = join(root, 'parts', 'offers.json');
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const offers = sharedPartsOf(root).flatMap(({id, versions, part}) => versions.flatMap((version) => {
    const p = readPart(packedDir(root,id,version)), config = settings[id], selected = config?.releases?.[version];
    return p.sale && config?.active !== false && selected?.active !== false && (version === versions.at(-1) || selected?.keepOnSale === true) ? [{kind:'part',resource:id,version,name:part.name,sale:{...p.sale,...config?.price}}] : [];
  }));
  const configured = offers.flatMap(o => {
    const quantities = settings[o.resource]?.quantities ?? [1];
    if (!Array.isArray(quantities) || !quantities.length || quantities.some(q=>!Number.isSafeInteger(q) || q<1 || !Number.isSafeInteger(q*o.sale.amount))) throw new Error(`Invalid Payment Link quantities for ${o.resource}`);
    return [...new Set(quantities)].map(quantity=>({...o,quantity}));
  });
  const links = (await list('/v1/payment_links')).filter((l) => l.metadata?.homie === 'purchase-links-v1' && l.metadata?.studio === slug && l.metadata?.origin === site);
  const config = {v:1,mode,offers:[]}, keep = new Set();
  for (const o of configured) {
    const revision = hash({o,till});
    let link = links.find((l)=>l.metadata?.revision === revision);
    if (!link) {
      const metadata = {homie:'purchase-links-v1',studio:slug,origin:site,revision};
      const product = (await list('/v1/products')).find(p=>p.metadata?.homie === 'purchase-links-v1' && p.metadata?.studio === slug && p.metadata?.origin === site && p.metadata?.revision === revision) ?? await api('POST','/v1/products',{name:`${o.name} ${o.version}`, ...(o.sale.taxCode ? {tax_code:o.sale.taxCode}:{}),metadata},`purchase-product-${revision}`);
      const price = (await list('/v1/prices')).find(p=>p.product === product.id && p.metadata?.revision === revision) ?? await api('POST','/v1/prices',{product:product.id,currency:o.sale.currency,unit_amount:o.sale.amount,...(o.sale.taxBehavior ? {tax_behavior:o.sale.taxBehavior}:{}),...(o.sale.billing !== 'one-time' ? {recurring:{interval:o.sale.billing}}:{}),metadata},`purchase-price-${revision}`);
      link = await api('POST','/v1/payment_links',{line_items:[{price:price.id,quantity:o.quantity}],metadata,
        ...(o.sale.billing === 'one-time' ? {payment_intent_data:{metadata}}:{subscription_data:{metadata}}),
        ...(till === 'stripe-managed' ? {managed_payments:{enabled:true}} : {automatic_tax:{enabled:o.sale.automaticTax === true},...(o.sale.taxIdCollection?{tax_id_collection:{enabled:true}}:{}),...(o.sale.billing === 'one-time' && o.sale.invoiceCreation?{invoice_creation:{enabled:true}}:{}),...(o.sale.adaptivePricing === undefined?{}:{adaptive_pricing:{enabled:o.sale.adaptivePricing}})}),
        ...(o.sale.billing === 'one-time' && o.sale.customerCreation?{customer_creation:'always'}:{}),allow_promotion_codes:o.sale.promotionCodes === true,
        after_completion:{type:'redirect',redirect:{url:`${site}/purchases/thanks`}}},`purchase-link-${revision}`);
    }
    if (!paymentLinkURL(link.url)) throw new Error('Stripe returned an invalid Payment Link');
    if (!link.active) await api('POST',`/v1/payment_links/${link.id}`,{active:true});
    keep.add(link.id);
    config.offers.push({kind:o.kind,resource:o.resource,version:o.version,quantity:o.quantity,offer:canonicalJson(o.sale),id:link.id,url:link.url,revision});
  }
  return { config, retire:async()=>{ for (const l of links) if(l.active && !keep.has(l.id)) await api('POST',`/v1/payment_links/${l.id}`,{active:false}); } };
}
