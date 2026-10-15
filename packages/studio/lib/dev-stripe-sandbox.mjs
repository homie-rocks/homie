import {SHOP_EVENTS} from '../worker/stripe-events.mjs';
/** Local acceptance adapter. Stripe's CLI retains its credentials and forwards
 * genuine sandbox events. Never deploy this adapter: the desktop is test-only. */
import { spawn } from 'node:child_process';
import { redactStripe } from '../worker/stripe.mjs';
import { stripeProcess } from './stripe-connect.mjs';
export async function startStripeSandbox({ origin, profile, restrictedKey }) {
  const target = new URL(origin);
  if (target.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(target.hostname)) throw new Error('Sandbox acceptance requires loopback');
  if (profile !== 'homie-636e9d423df0184d0af88019') throw new Error('Acceptance uses only the Homie sandbox CLI profile');
  if (!/^rk_test_[A-Za-z0-9]+$/.test(restrictedKey ?? '')) throw new Error('Inject a Dashboard-made sandbox restricted key privately through stdin');
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
  const childEnv={...process.env};for(const k of Object.keys(childEnv))if(k.startsWith('STRIPE_'))delete childEnv[k];
  const listener=spawn('stripe',['--project-name',profile,'listen','--events',SHOP_EVENTS.join(','),'--forward-to',`${target.origin}/api/shop/hook`],{env:childEnv,stdio:['ignore','pipe','pipe']});
  const close=async()=>{listener.kill();};
  try {
    const secret=await new Promise((resolve,reject)=>{
      let buffer='';const timer=setTimeout(()=>reject(new Error('Stripe listener did not become ready')),30000);
      const collect=b=>{buffer=(buffer+b).slice(-16000);const match=/whsec_[A-Za-z0-9]+/.exec(buffer);if(match){clearTimeout(timer);resolve(match[0]);}};
      listener.stdout.on('data',collect);listener.stderr.on('data',collect);
      listener.on('error',()=>{clearTimeout(timer);reject(new Error('Stripe listener failed'));});
      listener.on('exit',()=>{clearTimeout(timer);reject(new Error('Stripe listener exited: '+redactStripe(buffer).slice(-1200)));});
    });
    return {bindings:{STRIPE_KEY:restrictedKey,STRIPE_WEBHOOK_SECRET:secret},call,close};
  }catch(e){await close();throw e;}
}
