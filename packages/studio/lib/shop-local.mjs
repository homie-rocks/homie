/** Real Stripe test links, delivered by the owner's Stripe CLI listener. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {stripeProcess} from './stripe-connect.mjs';
import {syncPaymentLinks} from './shop-links.mjs';
import {checkShop} from '../worker/shop-rules.mjs';
import {formEncode,redactStripe} from '../worker/stripe.mjs';
export async function shopConnectLocal(root,{url,profile,exec=stripeProcess}={}) {
 const origin=new URL(url??'http://localhost:8787');
 if(origin.protocol!=='http:' || !/^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(origin.hostname))throw new Error('Local Stripe needs an HTTP localhost or Wi-Fi address');
 if(!profile)throw new Error('Name the existing Stripe sandbox CLI profile with --profile');
 const checked=checkShop(JSON.parse(readFileSync(join(root,'shop.json'),'utf8')));
 if(!checked.ok)throw new Error('Fix shop.json before connecting Stripe');
 const api=async(method,path,params={},idempotency)=>{
  const args=['--project-name',profile,method.toLowerCase(),path];
  for(const [k,v] of formEncode(params))args.push('-d',`${k}=${v}`);
  if(idempotency)args.push('--idempotency',idempotency);
  const r=await exec(args,{cwd:root});let body;try{body=JSON.parse(r.stdout);}catch{}
  if(r.code!==0||body?.error||!body)throw new Error('Stripe test request failed: '+redactStripe(body?.error?.message??r.stderr??'no response').slice(0,500));
  if(body.livemode===true||body.data?.some(o=>o.livemode===true))throw new Error('Local checkout refuses live Stripe objects');
  return body;
 };
 const slug='local-'+createHash('sha256').update(root).digest('hex').slice(0,16);
 const r=await syncPaymentLinks({api,shop:checked.shop,slug,site:origin.origin,mode:'test',local:true});
 const file=join(root,'.dev.vars');let vars=existsSync(file)?readFileSync(file,'utf8'):'';
 vars=vars.replace(/^STRIPE_(?:SHOP_LINKS|CHECKOUT_MODE)=.*\n?/gm,'');
 vars+=`\nSTRIPE_CHECKOUT_MODE=links\nSTRIPE_SHOP_LINKS=base64:${Buffer.from(JSON.stringify(r.config)).toString('base64')}\n`;
 writeFileSync(file,vars,{mode:0o600});
 return {ok:true,command:'shop connect',local:true,mode:'test',url:origin.origin,message:'Test Payment Links saved to root .dev.vars.',next:[`stripe --project-name ${profile} listen --forward-to http://localhost:${origin.port||80}/api/shop/hook`,'Put the listener signing secret in root .dev.vars as STRIPE_WEBHOOK_SECRET, then start/restart homie-studio dev --lan. Keep the listener running.','Open the same Wi-Fi address on phones; complete Stripe test checkout and verify the paid order and app event.']};
}
