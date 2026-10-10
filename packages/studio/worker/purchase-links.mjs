/** Public Payment Link configuration, installed by the owner's existing CLI authorization. */
import { paymentLinkURL, linkConfig } from './shop-links.mjs';
import { canonicalJson } from './referrals.mjs';
export function purchaseLinks(env) {
  try { const c = JSON.parse(env.PURCHASE_LINKS ?? 'null'); return c?.v === 1 && c.mode === linkConfig(env)?.mode && Array.isArray(c.offers) ? c : null; } catch { return null; }
}
export function purchaseLink(env, o) {
  return purchaseLinks(env)?.offers.find((link) => (link.quantity ?? 1) === o.quantity && link.kind === o.resource_kind && link.resource === (o.resource_kind==='service'?JSON.parse(o.manifest).tool:o.resource_id) && link.version === JSON.parse(o.manifest).version && link.offer === canonicalJson(JSON.parse(o.offer)) && paymentLinkURL(link.url));
}
