/** Local acceptance adapter. Stripe's CLI retains its credentials and forwards
 * genuine sandbox events. Never deploy this adapter: the desktop is test-only. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { redactStripe } from '../worker/stripe.mjs';
import { stripeProcess } from './stripe-connect.mjs';
export async function startStripeSandbox({ origin, profile }) {
  const target = new URL(origin);
  if (target.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(target.hostname)) throw new Error('Sandbox acceptance requires loopback');
  if (!profile || typeof profile !== 'string') throw new Error('An explicit Stripe sandbox profile is required');
  const call = async (method,path,params=new URLSearchParams(),idempotency) => {
    const args=['--project-name',profile,method.toLowerCase(),path,'--stripe-version','2025-03-31.basil'];
    if(method.toUpperCase()==='DELETE')args.push('--confirm');
    for(const [k,v] of params)args.push('-d',`${k}=${v}`);
    if(idempotency)args.push('--idempotency',idempotency);
    const r=await stripeProcess(args);let body;try{body=JSON.parse(r.stdout);}catch{}
    if(r.code!==0 || body?.error || !body) throw new Error('Stripe sandbox request failed: '+redactStripe(body?.error?.message ?? r.stderr ?? 'no response').slice(0,600));
    return body;
  };
  // A mode-bearing object verifies test context without reading any credential.
  const probe=await call('GET','/v1/prices',new URLSearchParams({limit:'1'}));
  if(probe.data?.some(p=>p.livemode))throw new Error('Sandbox adapter refuses live data');
  const key=`rk_test_${randomBytes(24).toString('hex')}`;
  const server=createServer(async(req,res)=>{
    const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(req.headers.authorization!==`Bearer ${key}`)return send({error:{message:'Unauthorized sandbox adapter'}},401);
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      if(!url.pathname.startsWith('/v1/')||!['GET','POST','DELETE'].includes(req.method))return send({},404);
      let body='';for await(const chunk of req){body+=chunk;if(body.length>262144)return send({},413);}
      const data=await call(req.method,url.pathname,req.method==='GET'?url.searchParams:new URLSearchParams(body),req.headers['idempotency-key']);
      if(data.livemode===true)throw new Error('Live object refused');
      send(data);
    }catch{send({error:{message:'Stripe sandbox adapter request failed'}},502);}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const childEnv={...process.env};for(const k of Object.keys(childEnv))if(k.startsWith('STRIPE_'))delete childEnv[k];
  const listener=spawn('stripe',['--project-name',profile,'listen','--events','payment_link.updated,checkout.session.completed,checkout.session.expired,invoice.paid,invoice.payment_failed,customer.subscription.updated,customer.subscription.deleted,charge.refunded,refund.created,refund.updated','--forward-to',`${target.origin}/api/shop/hook`],{env:childEnv,stdio:['ignore','pipe','pipe']});
  const close=async()=>{listener.kill();await new Promise(r=>server.close(r));};
  try {
    const secret=await new Promise((resolve,reject)=>{
      let buffer='';const timer=setTimeout(()=>reject(new Error('Stripe listener did not become ready')),30000);
      const collect=b=>{buffer=(buffer+b).slice(-16000);const match=/whsec_[A-Za-z0-9]+/.exec(buffer);if(match){clearTimeout(timer);resolve(match[0]);}};
      listener.stdout.on('data',collect);listener.stderr.on('data',collect);
      listener.on('error',()=>{clearTimeout(timer);reject(new Error('Stripe listener failed'));});
      listener.on('exit',()=>{clearTimeout(timer);reject(new Error('Stripe listener exited: '+redactStripe(buffer).slice(-1200)));});
    });
    return {bindings:{STRIPE_CHECKOUT_MODE: 'sessions', STRIPE_KEY:key,STRIPE_WEBHOOK_SECRET:secret,STRIPE_API_BASE:`http://127.0.0.1:${server.address().port}`},call,close};
  }catch(e){await close();throw e;}
}

/** Local keyless acceptance: only links and the listener's signing secret reach
 * the Worker. Object sync uses the approved CLI directly, never an API adapter. */
export async function startKeylessStripeSandbox({origin,profile,shop,bookingSlots=[],name='keyless-dev'}) {
  const {syncPaymentLinks}=await import('./shop-links.mjs');
  const {checkShop}=await import('../worker/shop-rules.mjs');
  const {formEncode}=await import('../worker/stripe.mjs');
  const checked=checkShop(shop);
  if(!checked.ok)throw new Error('Check shop.json before sandbox setup');
  const sandbox=await startStripeSandbox({origin,profile});
  let links,endpoint;
  const api=(method,path,params={},idempotency)=>sandbox.call(method,path,formEncode(params),idempotency);
  const synchronize=async bookingSlots=>{
    const result=await syncPaymentLinks({api,shop:checked.shop,slug:name,site:`https://${name}.example.com`,mode:'test',bookingSlots,
      w:async(args,opts)=>{if(args[1]==='list')return{code:0,stdout:'[]'};if(args[1]==='bulk')links=JSON.parse(opts.input).STRIPE_SHOP_LINKS;return{code:0};},saveReceipt:r=>{endpoint=r.endpoint??endpoint;}});
    if(!result.ok)throw Error('Sandbox Payment Link sync failed');
    if(endpoint)await api('POST',`/v1/webhook_endpoints/${endpoint}`,{disabled:true});
    return {links:JSON.parse(links),bindings:{STRIPE_CHECKOUT_MODE:'links',STRIPE_SHOP_LINKS:'base64:'+Buffer.from(links).toString('base64'),STRIPE_WEBHOOK_SECRET:sandbox.bindings.STRIPE_WEBHOOK_SECRET}};
  };
  try {
    const client={...await synchronize(bookingSlots),call:api,
      sync:async slots=>{Object.assign(client,await synchronize(slots));return client;},
      close:async()=>{try{const config=JSON.parse(links);for(const link of [...config.items,...config.menus,...config.slots])await api('POST',`/v1/payment_links/${link.id}`,{active:false});}finally{await sandbox.close();}}};
    return client;
  }catch(e){await sandbox.close();throw e;}
}
