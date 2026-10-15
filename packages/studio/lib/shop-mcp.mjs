import {canonicalJson} from '../worker/canonical-json.mjs';
/** Pure, batched Stripe plan. The owner's AI supplies public API reads; no Stripe transport here. */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {readShop, SHOP_HOOK_EVENTS} from './shop.mjs';
import {readStudio, siteUrl} from './studio.mjs';
import {reconcilePaymentLinks} from './shop-links.mjs';
import {fullerReason, linkSettings, LINKS_STRIPE_VERSION} from '../worker/shop-links.mjs';
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const readKey = (path, params) => canonicalJson([path,params]);
const slotsOf=(root,slots)=>slots??(existsSync(join(root,'.studio','booking-slots.json'))?JSON.parse(readFileSync(join(root,'.studio','booking-slots.json'),'utf8')):[]);
export async function shopMcpPlan(root, {observations = [], mode = 'test', url, slots, verify = false, refresh = false, account} = {}) {
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
  const bookingSlots=slotsOf(root,slots);
  const slug=local?'local-'+createHash('sha256').update(root).digest('hex').slice(0,16):studio.slug;
  // Reject secrets before persisting observations. Webhook creation is never part of this plan.
  if(/(?:whsec_|[rs]k_(?:test|live)_)/.test(JSON.stringify(observations)))throw new Error('Supply only public catalog reads, never credentials or webhook creation responses');
  let saved;try{saved=JSON.parse(readFileSync(join(root,'.studio','stripe-mcp.json'),'utf8'));}catch{}
  const cacheFile=join(root,'.studio','stripe-mcp-observations.json');
  let cache;try{cache=JSON.parse(readFileSync(cacheFile,'utf8'));}catch{}
  const source=hash({shop:checked.shop,slots:bookingSlots});
  const reusable=!refresh && cache?.site===site && cache.mode===mode && (!account || cache.account===account);
  const legacy=!refresh && saved?.result?.site===site && saved.result.mode===mode && (!account || saved.options?.account===account);
  let prior=reusable?cache.observations:legacy?saved.options?.observations??[]:[];
  // Catalogue edits retain product/price discovery, but refresh mutable slot counts and writes.
  const legacySourceMatches=legacy && (saved.source===source || saved.result.fingerprint===hash({shop:checked.shop,bookingSlots,site,mode,catalog:{config:saved.result.config,retire:saved.result.retire??[]}}));
  if(reusable && cache.source!==source || !reusable && legacy && !legacySourceMatches)prior=prior.filter(o=>/\/v1\/(products|prices)(\/|$)/.test(o.path));
  observations=[...prior,...observations];
  if(/(?:whsec_|[rs]k_(?:test|live)_)/.test(JSON.stringify(observations)))throw new Error('Supply only public catalog reads, never credentials or webhook creation responses');
  // Latest response per operation, bounded by operations rather than replanning attempts.
  const latest=new Map();
  for(const o of observations){const key=canonicalJson([o.method??'GET',o.path,o.params??{}]);latest.delete(key);latest.set(key,o);}
  observations=[...latest.values()];
  const observedAt=refresh?new Date().toISOString():reusable?cache.observedAt:legacy?saved.result.verifiedAt??new Date().toISOString():new Date().toISOString();
  mkdirSync(join(root,'.studio'),{recursive:true});
  writeFileSync(cacheFile,JSON.stringify({site,mode,account:account??cache?.account??saved?.options?.account,source,observedAt,observations}));
  const api=async(method,path,params={},idempotency)=>{
    let found=observations.findLast(o=>(o.method??'GET')===method && readKey(o.path,o.params??{})===readKey(path,params));
    // Upgrade old list reads to the scoped searches, and hydrate old link lists
    // from the expanded reads already saved by 0.51.6.
    if(!found && method==='GET' && /\/v1\/(products|prices)\/search$/.test(path) && !params.page)
      found=observations.findLast(o=>(o.method??'GET')==='GET' && o.path===path.replace('/search','') && o.body?.has_more===false);
    if(!found && method==='GET' && path==='/v1/payment_links' && !params.starting_after) {
      const old=observations.findLast(o=>(o.method??'GET')==='GET' && o.path===path && o.body?.has_more===false);
      if(old) {
        const data=old.body.data.map(l=>observations.findLast(o=>o.path===`${path}/${l.id}`)?.body??l);
        if(data.every(l=>l.line_items?.data))found={...old,body:{...old.body,data}};
      }
    }
    if(method==='GET'&&path.split('/').length>=4&&!path.endsWith('/search')) {
      const written=observations.findLast(o=>o.method==='POST'&&o.body?.id===path.split('/').at(-1));
      if(written&&observations.indexOf(written)>observations.indexOf(found)) {
        const lines=written.body.line_items??found?.body?.line_items;
        found={...written,body:{...written.body,...(lines?{line_items:Array.isArray(lines)?{data:lines.map(l=>({...l,price:typeof l.price==='string'?{id:l.price}:l.price}))}:lines}:{})}};
      }
    }
    if (!found && method==='POST' && path==='/v1/products' && params.id) {
      const existing=observations.findLast(o=>(o.method??'GET')==='GET' && o.path===`/v1/products/${params.id}`);
      if (!existing) throw {next:{method:'GET',path:`/v1/products/${params.id}`,params:{expand:['default_price']}}};
      if (existing.body?.id===params.id) return existing.body;
      if (existing.body?.error?.code!=='resource_missing') throw new Error('Stripe product lookup failed; resolve the read before creating a product');
    }
    if(!found)throw {next:{method,path,params,...(idempotency?{idempotency}:{})}};
    let body=found.body;
    if(method==='GET' && Array.isArray(body?.data) && !params.starting_after && !params.page && !body.has_more) {
      const kind=path.split('/')[2], rows=new Map(body.data.map(o=>[o.id,o]));
      for(const o of observations.slice(observations.indexOf(found)+1))if(o.method==='POST' || (o.method??'GET')==='GET' && /^\/v1\/products\/[^/]+$/.test(o.path) && o.body?.id) {
        if(o.path.split('/')[2]===kind && o.body?.id)rows.set(o.body.id,o.body);
        if(kind==='prices' && o.body?.default_price?.id)rows.set(o.body.default_price.id,o.body.default_price);
      }
      body={...body,data:[...rows.values()]};
    }
    if(!body || body.error || body.livemode !== undefined && body.livemode !== (mode==='live') || body.data?.some(o=>o.livemode !== undefined && o.livemode !== (mode==='live')))throw new Error('Stripe read has an error or wrong mode');
    return body;
  };
  const base={command:verify?'shop verify':'shop plan',mode,site,apiVersion:LINKS_STRIPE_VERSION,
    webhook:{method:'POST',path:'/v1/webhook_endpoints',private:true,params:{url:`${site}/api/shop/hook`,enabled_events:SHOP_HOOK_EVENTS,api_version:LINKS_STRIPE_VERSION,metadata:{homie:'shop-v1'},description:'Studio shop'}}};
  try {
    const catalog=await reconcilePaymentLinks({api,shop:checked.shop,slug,site,mode,bookingSlots,verifyObjects:true,scoped:true,knownPortal:saved?.result?.site===site&&saved.result.mode===mode&&(!account||saved.options?.account===account)?saved.result.config?.portalId:undefined});
    if(checked.shop.items.some(item=>item.interval) && !/^https:\/\/billing\.stripe\.com\//.test(catalog.config.portal??''))throw new Error('Invalid Stripe portal URL');
    const result={...base,ok:true,verified:true,verifiedAt:observedAt,...catalog,local, fingerprint:hash({shop:checked.shop,bookingSlots,site,mode,catalog})};
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
    const slots=slotsOf(root,options.slots);
    if(options.slots!==undefined)writeFileSync(join(root,'.studio','booking-slots.json'),JSON.stringify(slots));
    writeFileSync(join(root,'.studio','stripe-mcp.json'),JSON.stringify({options:{account:options.account??JSON.parse(readFileSync(join(root,'.studio','stripe-mcp-observations.json'),'utf8')).account,mode:result.mode,slots,url:result.site},source:hash({shop:readShop(root).shop,slots}),sourceConfig:{shop:readShop(root).shop,slots},result:{verified:true,verifiedAt:result.verifiedAt,local:result.local,site:result.site,mode:result.mode,config:result.config}},null,2));
  }
  return result;
}

/** Public verified configuration is tied to the current shop and origin, never to stored API responses. */
export function verifiedMcpConfig(root) {
  const file=join(root,'.studio','stripe-mcp.json');if(!existsSync(file))return null;
  const saved=JSON.parse(readFileSync(file,'utf8'));
  if(!saved.result?.verified || saved.result.local)return null; // Local builds read .dev.vars, never production bindings.
  const slots=existsSync(join(root,'.studio','booking-slots.json'))?JSON.parse(readFileSync(join(root,'.studio','booking-slots.json'),'utf8')):saved.options?.slots??[];
  const shop=readShop(root).shop, source=hash({shop,slots}), site=new URL(siteUrl(root)).origin;
  const legacyFingerprint=hash({shop,bookingSlots:slots,site,mode:saved.result.mode,catalog:{config:saved.result.config,retire:saved.result.retire??[]}});
  if(!saved.source && saved.result.fingerprint===legacyFingerprint) {
    saved.source=source;saved.sourceConfig={shop,slots};
    writeFileSync(file,JSON.stringify(saved,null,2));
  }
  if(saved.source!==source || saved.result.site!==site) {
    const changes=[];
    if(saved.result.site!==site)changes.push('site URL');
    const previous=saved.sourceConfig?.shop;
    if(previous)for(const key of new Set([...Object.keys(previous),...Object.keys(shop??{})])) {
      if(canonicalJson(previous[key]??null)!==canonicalJson(shop?.[key]??null))changes.push(`shop.${key}`);
    }
    else {
      let before;try{before=JSON.parse(saved.result.config?.settings);}catch{}
      const after=JSON.parse(linkSettings(shop));
      if(before)for(const key of new Set([...Object.keys(before),...Object.keys(after)])) {
        if(canonicalJson(before[key]??null)!==canonicalJson(after[key]??null))changes.push(`shop.${key}`);
      }
      else changes.push('shop settings');
      const receipt=saved.options?.observations?.find(o=>o.body?.custom_text?.submit?.message)?.body.custom_text.submit.message;
      if(receipt!==(shop.giving?.receiptText||undefined))changes.push('shop.giving.receiptText');
    }
    if(canonicalJson(saved.sourceConfig?.slots??saved.options?.slots??[])!==canonicalJson(slots))changes.push('booking slots');
    throw new Error(`Shop configuration changed: ${changes.join(', ')||'shop settings (saved verification differs)'}. Run stripe_shop_plan with verify:true before deploying or installing its webhook.`);
  }
  return saved;
}

/** Unfinished public plans also publish a closed setup, even before first verification. */
export function publicMcpSetup(root) {
  for(const name of ['stripe-mcp.json','stripe-mcp-observations.json']) {
    const file=join(root,'.studio',name);
    if(!existsSync(file))continue;
    const saved=JSON.parse(readFileSync(file,'utf8'));
    return !saved.result?.local && !(saved.site??saved.result?.site??saved.options?.url??'').startsWith('http:');
  }
  return false;
}

/** Record a batch from the official plugin and return the next dependency batch. */
export async function recordShopObservations(root, options = {}) {
  if(!Array.isArray(options.observations) || !options.observations.length)throw new Error('Supply observations: [{method,path,params,body}] from Stripe’s official plugin.');
  return shopMcpPlan(root, options);
}
