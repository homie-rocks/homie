import { selling } from './extensions.mjs';
import { partsIndex } from './parts.mjs';
const CORS = { 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };
export function productDescription(p, origin) {
  const sale = p.sale;
  const digits = sale ? new Intl.NumberFormat('en', { style: 'currency', currency: sale.currency }).resolvedOptions().maximumFractionDigits : 2;
  return { '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.summary, url: `${origin}/parts/${p.id}/`, ...(p.preview?.image ? { image: new URL(`${p.url}${p.preview.image}`, origin).href } : {}), ...(sale ? { offers: { '@type': 'Offer', price: (sale.amount / 10 ** digits).toFixed(digits), priceCurrency: sale.currency.toUpperCase(), url: `${origin}/parts/${p.id}/`, availability: p.releases?.some((r) => r.onSale) ? 'https://schema.org/InStock' : 'https://schema.org/Discontinued', ...(sale.billing !== 'one-time' ? { priceSpecification: { '@type': 'UnitPriceSpecification', price: (sale.amount / 10 ** digits).toFixed(digits), priceCurrency: sale.currency.toUpperCase(), billingDuration: ({day:'P1D',week:'P1W',month:'P1M',year:'P1Y'})[sale.billing], unitText: sale.scope } } : {}), description: `${sale.billing}; per ${sale.scope}; ${sale.refund}` } } : { offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: `${origin}/parts/${p.id}/` } }) };
}

export function entryDescription(p,cat,url,capabilities) { return {
    product: productDescription(p, url.origin),
    purchase: { methods: (cat.shop?.purchasesTill ?? cat.shop?.till) !== 'stripe-managed' && p.sale?.amount > 0 && p.sale?.billing === 'one-time' && p.sale?.currency === 'usd' && !p.sale?.automaticTax && p.sale?.taxBehavior !== 'exclusive' ? Object.entries(capabilities.machine).filter(([, enabled]) => enabled).map(([method]) => method) : [], hostedCheckout: { url: `${url.origin}/api/purchases/intent`, label: 'Hosted Checkout fallback' }, http: `${url.origin}/api/purchases/resource`, mcp: `${url.origin}/api/purchases/mcp`, keys: `${url.origin}/purchases/keys.json` },
}; }
export async function discoveryRoutes(request, env, url, { catalogueOf }) {
const path=url.pathname;
  if (path === '/purchases/keys.json') return selling.purchaseRoutes(request, env, url, {});
  if (path === '/openapi.json') {

    return selling.purchaseDiscovery(env, url.origin, await catalogueOf());
  }
  const read = request.method === 'GET' || request.method === 'HEAD';
  if (path === '/.well-known/api-catalog') {
    if (!read) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    const headers = { 'content-type': 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"', link: `<${url.origin}/.well-known/api-catalog>; rel="api-catalog"`, ...CORS };
    const index = await partsIndex(env, url.origin);
    const item = [{ href: `${url.origin}/parts/catalog.json`, type: 'application/json', title: 'Resources' }];
    if (index.parts.some((p) => p.releases?.some((r) => r.onSale))) {
      item.push({ href: `${url.origin}/api/purchases/mcp`, title: 'Purchases over MCP' });
      if (env.PURCHASE_SIGNING_KEYS) item.push({ href: `${url.origin}/purchases/keys.json`, type: 'application/jwk-set+json', title: 'Purchase verification keys' });
    }
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ linkset: [{ anchor: `${url.origin}/.well-known/api-catalog`, 'service-desc': [{ href: `${url.origin}/openapi.json`, type: 'application/vnd.oai.openapi+json' }], item }] }), { headers });
  }
return null;
}
