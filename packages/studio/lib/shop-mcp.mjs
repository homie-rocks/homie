/** Pure, incremental Stripe plan. The owner's AI supplies public API reads; no Stripe transport here. */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {readShop, SHOP_HOOK_EVENTS} from './shop.mjs';
import {readStudio, siteUrl} from './studio.mjs';
import {reconcilePaymentLinks} from './shop-links.mjs';
import {fullerReason, LINKS_STRIPE_VERSION} from '../worker/shop-links.mjs';
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const readKey = (path, params) => JSON.stringify([path,params]);
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
    if(method!=='GET')throw {next:{method,path,params,...(idempotency?{idempotency}:{}),retry:'Read fresh before retrying; updates set desired fields and are idempotent.'}};
    const found=observations.find(o=>readKey(o.path,o.params??{})===readKey(path,params));
    if(!found)throw {next:{method,path,params}};
    const body=found.body;
    if(!body || body.error || body.livemode !== undefined && body.livemode !== (mode==='live') || body.data?.some(o=>o.livemode !== undefined && o.livemode !== (mode==='live')))throw new Error('Stripe read has an error or wrong mode');
    return body;
  };
  const base={command:verify?'shop verify':'shop plan',mode,site,apiVersion:LINKS_STRIPE_VERSION,
    webhook:{method:'POST',path:'/v1/webhook_endpoints',private:true,params:{url:`${site}/api/shop/hook`,enabled_events:SHOP_HOOK_EVENTS,api_version:LINKS_STRIPE_VERSION,metadata:{homie:'shop-v1'},description:'Studio shop'}}};
  try {
    const catalog=await reconcilePaymentLinks({api,shop:checked.shop,slug,site,mode,bookingSlots,verifyObjects:true});
    if(checked.shop.items.some(item=>item.interval) && !/^https:\/\/billing\.stripe\.com\//.test(catalog.config.portal??''))throw new Error('Invalid Stripe portal URL');
    const result={...base,ok:true,verified:true,verifiedAt:new Date().toISOString(),...catalog,local, fingerprint:hash({shop:checked.shop,bookingSlots,site,mode,catalog})};
    return result;
  } catch(e) {
    if(!e.next)throw e;
    return {...base,ok:!verify,verified:false,next:e.next,instructions:e.next.method==='GET'?'Read through Stripe MCP; append {path,params,body} to observations, including every pagination page.':'Perform this exact operation through Stripe MCP. Then discard observations and read fresh before planning again. Do not create the webhook through MCP.'};
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
    writeFileSync(join(root,'.studio','stripe-mcp.json'),JSON.stringify({options,result},null,2));
  }
  return result;
}
