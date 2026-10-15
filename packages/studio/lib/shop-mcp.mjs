/** Pure, batched Stripe plan. The owner's AI supplies public API reads; no Stripe transport here. */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {readShop, SHOP_HOOK_EVENTS} from './shop.mjs';
import {readStudio, siteUrl} from './studio.mjs';
import {reconcilePaymentLinks} from './shop-links.mjs';
import {fullerReason, LINKS_STRIPE_VERSION} from '../worker/shop-links.mjs';
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const readKey = (path, params) => JSON.stringify([path,Object.fromEntries(Object.entries(params).sort(([a],[b])=>a.localeCompare(b)))]);
export async function shopMcpPlan(root, {observations = [], mode = 'test', url, slots, verify = false} = {}) {
  const checked=readShop(root);
  if(!checked.ok || checked.absent) return {ok:false,why:'Create and check shop.json first.'};
  if(!['test','live'].includes(mode))throw new Error('Choose test or live mode');
  const reason=fullerReason(checked.shop);
  if(reason)return {ok:false,why:reason+' Adjust those settings to use Payment Links; no key is required.'};
  const studio=readStudio(root), address=url??siteUrl(root);
  if(!address)return {ok:false,needs:'site',why:'Supply the local test URL, or deploy the studio before planning its public checkout links.'};
  const site=new URL(address).origin;
  const local=new URL(site).protocol==='http:';
  if(local && (mode!=='test' || !/^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(new URL(site).hostname)))throw new Error('Local checkout requires a private HTTP address and test mode');
  if(!local && new URL(site).protocol!=='https:')throw new Error('Use the studio HTTPS address');
  const bookingSlots=slots??(existsSync(join(root,'.studio','booking-slots.json'))?JSON.parse(readFileSync(join(root,'.studio','booking-slots.json'),'utf8')):[]);
  const slug=local?'local-'+createHash('sha256').update(root).digest('hex').slice(0,16):studio.slug;
  // Reject secrets before persisting observations. Webhook creation is never part of this plan.
  if(/(?:whsec_|[rs]k_(?:test|live)_)/.test(JSON.stringify(observations)))throw new Error('Supply only public catalog reads, never credentials or webhook creation responses');
  const api=async(method,path,params={},idempotency)=>{
    let found=observations.findLast(o=>(o.method??'GET')===method && readKey(o.path,o.params??{})===readKey(path,params));
    if(method==='GET'&&path.split('/').length>=4&&!path.endsWith('/search')) {
      const written=observations.findLast(o=>o.method==='POST'&&o.body?.id===path.split('/').at(-1));
      if(written&&observations.indexOf(written)>observations.indexOf(found)) {
        const lines=written.body.line_items??found?.body?.line_items;
        found={...written,body:{...written.body,...(lines?{line_items:Array.isArray(lines)?{data:lines.map(l=>({...l,price:typeof l.price==='string'?{id:l.price}:l.price}))}:lines}:{})}};
      }
    }
    if(!found)throw {next:{method,path,params,...(idempotency?{idempotency}:{})}};
    const body=found.body;
    if(!body || body.error || body.livemode !== undefined && body.livemode !== (mode==='live') || body.data?.some(o=>o.livemode !== undefined && o.livemode !== (mode==='live')))throw new Error('Stripe read has an error or wrong mode');
    return body;
  };
  const base={command:verify?'shop verify':'shop plan',mode,site,apiVersion:LINKS_STRIPE_VERSION,
    webhook:{method:'POST',path:'/v1/webhook_endpoints',private:true,params:{url:`${site}/api/shop/hook`,enabled_events:SHOP_HOOK_EVENTS,api_version:LINKS_STRIPE_VERSION,metadata:{homie:'shop-v1'},description:'Studio shop'}}};
  let saved;try{saved=JSON.parse(readFileSync(join(root,'.studio','stripe-mcp.json'),'utf8'));}catch{}
  const knownLinks=saved?.result?.site===site&&saved.result.mode===mode?[...(saved.result.config.items??[]),...(saved.result.config.menus??[]),...(saved.result.config.slots??[])].map(l=>l.id):[];
  for(const observation of observations) {
    const body=observation.body;
    if(/^plink_[A-Za-z0-9]+$/.test(body?.id??'')&&body.metadata?.homie==='shop-links-v1'&&body.metadata.studio===slug&&body.metadata.origin===site)knownLinks.push(body.id);
  }
  try {
    const catalog=await reconcilePaymentLinks({api,shop:checked.shop,slug,site,mode,bookingSlots,verifyObjects:true,scoped:true,knownLinks,knownPortal:saved?.result?.site===site&&saved.result.mode===mode?saved.result.config.portalId:undefined});
    if(checked.shop.items.some(item=>item.interval) && !/^https:\/\/billing\.stripe\.com\//.test(catalog.config.portal??''))throw new Error('Invalid Stripe portal URL');
    const result={...base,ok:true,verified:true,verifiedAt:new Date().toISOString(),...catalog,local, fingerprint:hash({shop:checked.shop,bookingSlots,site,mode,catalog})};
    return result;
  } catch(e) {
    if(!e.next&&!e.operations)throw e;
    const operations=e.operations??[e.next];
    return {...base,ok:!verify,verified:false,operations,next:operations[0],instructions:'Perform every independent operation in this batch through Stripe MCP. Append {method,path,params,body} for reads AND writes and replan to resolve dependencies. Keep observations for this setup; never create a webhook through MCP.'};
  }
}
export async function saveMcpVerification(root, options) {
  const result=await shopMcpPlan(root,{...options,verify:true});
  if(result.verified) {
    if(result.local) {
      const {saveLocalStripe}=await import('./shop-listen.mjs');
      saveLocalStripe(root,{STRIPE_CHECKOUT_MODE:'links',STRIPE_SHOP_LINKS:'base64:'+Buffer.from(JSON.stringify(result.config)).toString('base64')});
    }
    mkdirSync(join(root,'.studio'),{recursive:true});
    writeFileSync(join(root,'.studio','stripe-mcp.json'),JSON.stringify({options:{account:options.account,mode:result.mode,slots:options.slots??[],url:result.site},source:hash({shop:readShop(root).shop,slots:options.slots??[]}),result:{verified:true,verifiedAt:result.verifiedAt,local:result.local,site:result.site,mode:result.mode,config:result.config}},null,2));
  }
  return result;
}

/** Public verified configuration is tied to the current shop and origin, never to stored API responses. */
export function verifiedMcpConfig(root) {
  const file=join(root,'.studio','stripe-mcp.json');if(!existsSync(file))return null;
  const saved=JSON.parse(readFileSync(file,'utf8'));
  const slots=existsSync(join(root,'.studio','booking-slots.json'))?JSON.parse(readFileSync(join(root,'.studio','booking-slots.json'),'utf8')):saved.options?.slots??[];
  if(!saved.result?.verified || saved.result.local || saved.source!==hash({shop:readShop(root).shop,slots}) || saved.result.site!==new URL(siteUrl(root)).origin)throw new Error('Shop configuration changed; verify through stripe_shop_plan before deploying or installing its webhook.');
  return saved;
}
