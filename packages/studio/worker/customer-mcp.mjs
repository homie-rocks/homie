import {byClaim} from './purchase-store.mjs';
import {canonicalJson} from './referrals.mjs';
import {purchaseResponse} from './purchase-response.mjs';
import {machineResource} from './purchase-machine.mjs';
import {purchaseSchema} from './purchase-mcp.mjs';
import {purchaseRoutes} from './purchase-routes.mjs';
import {listOffers,resourceKind} from './resource-kinds.mjs';
import {customerOffer,serviceTerms} from './customer-resources.mjs';
import {quoteCart} from './customer-shop.mjs';
import {shopRoutes} from './shop.mjs';
import {object} from './mcp-tools.mjs';
import {withToolIdentity} from './tool-identity.mjs';
import {digest} from './purchase-crypto.mjs';
const str={type:'string'};
const cartSchema=object({lines:{type:'array',minItems:1,items:object({item:str,quantity:{type:'integer',minimum:1},amount:{type:'integer',minimum:0}},['item'])},game:str},['lines']);
export async function customerShop(env,cat,origin,caller,path,args) {
  const url=new URL(path,origin),post=args!==undefined;
  const request=withToolIdentity(new Request(url,{method:post?'POST':'GET',headers:{origin,'content-type':'application/json'},...(post?{body:JSON.stringify(args)}:{})}),caller);
  const response=await shopRoutes(request,env,{},url,{catalogueOf:async()=>cat});
  if(!response)return {ok:false,error:'Shop unavailable'};
  const data=await response.json();
  const cookies=response.headers.getSetCookie?.()??[response.headers.get('set-cookie')].filter(Boolean);
  return {...data,...(cookies.length?{account:{cookies}}:{})};
}
export function customerTools(env,cat,origin) {
  return [
    {name:'studio_catalogue',description:'Browse the public shop, paid parts and app goods. Prices use the studio’s currency minor units.',audience:'public',inputSchema:object(),handler:async(_args,ctx)=>({shop:await customerShop(env,cat,origin,ctx.caller,'/api/shop'),resources:await listOffers(env,origin)})},
    {name:'studio_cart',description:'Quote a cart for agent payment. Retain the returned private account cookies to use guest purchases. Approve this immutable offerVersion before purchase.',audience:'public',inputSchema:cartSchema,handler:(args,ctx)=>quoteCart(env,cat,origin,ctx.caller,args,ctx.request)},
    {name:'studio_checkout',description:'Open the studio’s Stripe checkout for a person to approve. Uses the same cart, account, order and refund as the website.',audience:'public',inputSchema:cartSchema,handler:(args,ctx)=>customerShop(env,cat,origin,ctx.caller,'/api/shop/buy',args)},
    {name:'studio_purchase',description:'Buy an approved offer with the MCP payment binding. Generate private random 32-byte hex buyer and claim values; retain the claim for retries. For x402 use the returned HTTP resource address.',audience:'public',inputSchema:{...purchaseSchema,properties:{...purchaseSchema.properties,checkout:{type:'boolean'}}},protocol:true,handler:async(args,ctx)=>{if(args.checkout&&args.kind==='cart'){const resource=await resourceKind('cart').get(env,args.resource,args.version);if(!resource)throw new Error('Cart unavailable');const result=await customerShop(env,cat,origin,{...ctx.caller,id:resource.player},'/api/shop/buy',{lines:resource.lines.map(l=>({item:l.item.id,quantity:l.quantity,amount:l.amount}))});return {content:[{type:'text',text:JSON.stringify(result)}],...(result.ok?{}:{isError:true})};}return buy(env,cat,origin,args,ctx.paymentExtra);}},
    {name:'studio_customer_refund',description:'Request a refund for your shop order under the studio refund policy.',audience:'signed-in',inputSchema:object({order:str,line:str},['order']),handler:(args,ctx)=>customerShop(env,cat,origin,ctx.caller,'/api/shop/refund',args)},
    {name:'studio_purchase_refund',description:'Request a resource or service refund with the original private purchase claim.',audience:'public',inputSchema:object({claim:{type:'string',pattern:'^[a-f0-9]{64}$'}},['claim']),handler:async({claim})=>{const url=new URL('/api/purchases/refund',origin);const response=await purchaseRoutes(new Request(url,{method:'POST',headers:{authorization:'Bearer '+claim,'content-type':'application/json'},body:'{}'}),env,url,cat);return response.json();}},
    {name:'studio_my_orders',description:'Your web-shop orders and grants.',audience:'signed-in',inputSchema:object(),handler:(_args,ctx)=>customerShop(env,cat,origin,ctx.caller,'/api/shop/mine')},
  ];
}
async function buy(env,cat,origin,args,extra) {
  const url=new URL('/api/purchases/resource',origin);
  if(args.checkout) {
    const target=new URL('/api/purchases/intent',origin);
    const request=new Request(target,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...args,claimHash:await digest(args.claim)})});
    const response=await purchaseRoutes(request,env,target,cat);
    return {content:[{type:'text',text:await response.text()}],...(response.ok?{}:{isError:true})};
  }
  let delivery;
  const result=await machineResource(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)}),env,url,cat,{mcpInput:args,extra:{_meta:extra?._meta},setDelivery:value=>{delivery=value;}});
  if(result instanceof Response)return {isError:true,content:[{type:'text',text:await result.text()}]};
  return delivery?(await (await purchaseResponse(delivery,env,{mcp:true,envelope:{jsonrpc:'2.0',id:null,result}})).json()).result:result;
}
export async function paidTool(env,cat,origin,tool,input,context,extra) {
  const {_payment:payment,...args}=input;
  let quote;
  const previous=payment?.claim && /^[a-f0-9]{64}$/.test(payment.claim)?await byClaim(env,await digest(payment.claim)):null;
  if(previous) {
    const saved=await env.DB.prepare('SELECT state FROM service_results WHERE order_id=?1').bind(previous.id).first();
    if(saved && ['refunded','refund-pending'].includes(saved.state)) {
      const {serviceResult}=await import('./service-run.mjs');
      const {refundOrder}=await import('./purchase-office.mjs');
      const data=await serviceResult(env,previous.id,()=>{throw new Error('Already failed');},()=>refundOrder(env,previous,{by:'service-failure'}));
      return {isError:true,content:[{type:'text',text:JSON.stringify(data)}]};
    }
  }
  if(previous && ['paid','fulfilled','disputed'].includes(previous.status)) {
    const manifest=JSON.parse(previous.manifest);
    if(previous.resource_kind!=='service'||manifest.tool!==tool.name||canonicalJson(manifest.args)!==canonicalJson(args))throw new Error('Request differs from paid service');
    quote={kind:'service',resource:manifest.id,version:manifest.version,offerVersion:previous.offer_version,offer:JSON.parse(previous.offer)};
  } else quote=await customerOffer(env,'service',{name:tool.description,tool:tool.name,args,sale:serviceTerms(tool.price)});
  if(!payment?.offerVersion) return {content:[{type:'text',text:JSON.stringify({quote, next:'Approve offerVersion, then repeat this call with _payment: {buyer, claim, offerVersion}. Set checkout:true for human approval.',http:origin+'/api/purchases/resource'})}]};
  if(payment.offerVersion!==quote.offerVersion)throw new Error('Service or arguments changed; approve a fresh quote');
  const result=await buy(env,cat,origin,{...quote,buyer:payment.buyer,claim:payment.claim,offerVersion:payment.offerVersion,checkout:payment.checkout},extra);
  if(result.isError||payment.checkout)return result;
  const grant=JSON.parse(result.content[0].text),id=grant.order;
  if(!id)throw new Error('Payment has no order');
  const {serviceResult}=await import('./service-run.mjs');
  const {refundOrder}=await import('./purchase-office.mjs');
  const data=await serviceResult(env,id,()=>tool.handler(args,Object.freeze({...context,purchase:Object.freeze({id})})),async()=>refundOrder(env,await byClaim(env,await digest(payment.claim)),{by:'service-failure'}));
  return {...result,...(['refunded','refund-pending'].includes(data.state)?{isError:true}:{}),content:[{type:'text',text:JSON.stringify(data)}]};
}
