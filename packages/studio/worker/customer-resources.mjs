/** Carts and services are resource adapters over the existing purchase lifecycle. */
import {registerResourceKind} from './resource-kinds.mjs';
import {quoteHash,legalTerms} from './parts-sale.mjs';
import {digest,manifestHash} from './purchase-crypto.mjs';
import {offerVersion} from './purchase-core.mjs';
import {canonicalJson} from './referrals.mjs';
import {serviceTerms} from './service-terms.mjs';
export {serviceTerms} from './service-terms.mjs';
export async function customerOffer(env,kind,resource) {
  const id=(await digest(canonicalJson(resource))).slice(0,48);
  const manifest={...resource,id,version:'1.0.0',files:[],license:'Studio terms'};
  await env.DB.prepare('INSERT OR IGNORE INTO customer_offers(id,kind,manifest) VALUES(?1,?2,?3)').bind(id,kind,JSON.stringify(manifest)).run();
  const offer=await offerVersion({kind,id,release:manifest.version,manifest:await manifestHash(manifest)},manifest.sale);
  return {kind,resource:id,version:manifest.version,offerVersion:offer.version,offer:manifest.sale};
}
for(const kind of ['cart','service']) registerResourceKind(kind,{
  list:async()=>[],
  async get(env,id,version){if(version!=='1.0.0')return null;const row=await env.DB.prepare('SELECT manifest FROM customer_offers WHERE id=?1 AND kind=?2').bind(id,kind).first();return row?JSON.parse(row.manifest):null;},
  async listed(env,id,version,origin){
    const resource=await this.get(env,id,version);if(!resource)return null;
    if(kind==='service'){
      const tools=await (await import('./index.mjs')).getStudioTools();
      const tool=tools.find(t=>t.name===resource.tool);
      if(!tool?.price||canonicalJson(serviceTerms(tool.price))!==canonicalJson(resource.sale))return null;
    } else {
      const response=await env.ASSETS.fetch(new Request(origin+'/games.json'));if(!response.ok)return null;
      const cat=await response.json();const {shopOf}=await import('./shop.mjs'),shop=shopOf(cat);
      if(!shop||shop.capPerPlayerMonth!==null||canonicalJson(shop)!==canonicalJson(resource.shop))return null;
      for(const line of resource.lines){const item=shop.items.find(i=>i.id===line.item.id);if(!item||canonicalJson(item)!==canonicalJson(line.item))return null;}
      try {
        const {quoteCart}=await import('./customer-shop.mjs');
        const fresh=await quoteCart(env,cat,origin,{id:resource.player,owner:false},{lines:resource.lines.map(l=>({item:l.item.id,quantity:l.quantity,amount:l.amount}))});
        if(fresh.resource!==id)return null;
      } catch {return null;}
    }
    return {resource,offer:resource.sale};
  },
  quote:quoteHash,terms:legalTerms,termsUrl:()=>'/shop/refunds/',readFile:async()=>null,
  covers:async(_env,_origin,bought,wanted)=>bought.id===wanted.id&&bought.version===wanted.version,
  validate(resource,selection){const s=resource.sale;return [!Number.isSafeInteger(s.amount)||s.amount<0?'Invalid amount':null,!/^[a-z]{3}$/.test(s.currency)?'Invalid currency':null,selection&&(selection.quantity!==1||selection.game!==null)?'A quoted cart or service is purchased once':null].filter(Boolean);},
  async fulfill(env,origin,order){if(kind==='cart')return (await import('./customer-shop.mjs')).fulfillCart(env,origin,order);},
});
