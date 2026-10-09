import { machineCapabilities } from './payment-capabilities.mjs';
import { listOffers } from './resource-kinds.mjs';
export async function purchaseDiscovery(env, origin, catalogue = {}) {
  const { generateProxy } = await import('mppx/discovery');
  const capabilities = await machineCapabilities(env);
  const routes = [];
  for (const resource of await listOffers(env,origin)) {
    const offer = resource.offer;
    const eligible = (catalogue.shop?.purchasesTill ?? catalogue.shop?.till) !== 'stripe-managed' && offer.amount > 0 && offer.billing === 'one-time' && offer.currency === 'usd' && !offer.automaticTax && offer.taxBehavior !== 'exclusive';
    const offers = eligible ? Object.entries(capabilities.machine).filter(([, enabled]) => enabled).map(([method]) => ({ method: method === 'card' ? 'stripe' : method === 'base' ? 'evm' : method, intent: 'charge', amount: String(method === 'card' ? offer.amount : offer.amount * 10000), currency: 'usd' })) : [];
    routes.push({ method: 'POST', path: `/api/purchases/resource/${resource.kind}/${resource.id}/${resource.version}`, summary: `Buy ${resource.name} ${resource.version}. Challenges expire after five minutes. A new purchase requires a fresh private claim.`, payment: offers.length ? { offers } : null,
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['kind','resource','version','buyer','claim','offerVersion'],
        properties: {
          kind: {type:'string',const:resource.kind}, resource: {type:'string',const:resource.id}, version: {type:'string',const:resource.version},
          buyer:{type:'string',pattern:'^[a-f0-9]{64}$',description:'Private random buyer identifier (32 bytes, hex).'},
          claim:{type:'string',pattern:'^[a-f0-9]{64}$',description:'Private random secret for this purchase (32 bytes, hex). Keep it for retries and downloads.'},
          offerVersion:{type:'string',const:resource.offerVersion},quantity:{type:'integer',minimum:1,default:1},game:{type:'string',description:'Game identifier required for a game-scoped offer.'},
        },
      } } } },
    });
  }
  const doc=generateProxy({info:{title:'Studio purchases',version:'1'},routes});doc.servers=[{url:origin}];
  doc.paths['/api/purchases/intent'] = { post: { summary: 'Create a hosted Checkout fallback; open the returned seller URL to accept terms and complete Turnstile.', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['kind','resource','version','buyer','claimHash','offerVersion'], properties: { kind: {type:'string'}, resource: {type:'string'}, version: {type:'string'}, buyer: {type:'string',pattern:'^[a-f0-9]{64}$'}, claimHash: {type:'string', description:'SHA-256 of the private random claim, hex'}, offerVersion: {type:'string'}, quantity: {type:'integer',minimum:1}, game: {type:'string'} } } } } }, responses: { '200': {description:'Order and hosted checkout URL'}, '409': {description:'Offer changed'} } } };
  return Response.json(doc,{headers:{'cache-control':'no-store'}});
}
