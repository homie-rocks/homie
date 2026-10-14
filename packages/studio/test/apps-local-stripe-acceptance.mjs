/** Manual acceptance: HOMIE_STRIPE_PROFILE=<approved sandbox> node --test this-file.
 * Uses the documented local connection and the real dev server, never a checkout stand-in. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,symlinkSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import puppeteer from 'puppeteer-core';
import {newStudio} from '../lib/scaffold.mjs';
import {newApp} from '../lib/studio.mjs';
import {shopConnectLocal} from '../lib/shop-local.mjs';
import {stripeProcess} from '../lib/stripe-connect.mjs';
import {findChrome,chromeArgs} from '../lib/chrome.mjs';
import {lanAddresses} from '../lib/dev.mjs';
import {formEncode} from '../worker/stripe.mjs';
const profile=process.env.HOMIE_STRIPE_PROFILE;
test('real Stripe checkout returns to local dev and delivers its app event',{skip:!profile,timeout:240000},async t=>{
 const root=mkdtempSync(join(tmpdir(),'homie-words-stripe-'));
 const children=[];let config;
 const api=async(method,path,params={})=>{const args=['--project-name',profile,method.toLowerCase(),path];for(const [k,v] of formEncode(params))args.push('-d',`${k}=${v}`);const r=await stripeProcess(args);const value=JSON.parse(r.stdout);if(r.code||value.error)throw Error(value.error?.message??'Stripe failed');return value;};
 t.after(async()=>{
  for(const child of children.reverse()){if(child.exitCode!==null||child.signalCode!==null)continue;const ended=once(child,'exit');child.kill('SIGTERM');await ended;}
  if(config)for(const link of config.items)await api('POST',`/v1/payment_links/${link.id}`,{active:false});
  rmSync(root,{recursive:true,force:true});
 });
 newStudio(root,{name:'Pantry acceptance',kind:'cause',install:false});symlinkSync(new URL('../../../node_modules',import.meta.url).pathname,join(root,'node_modules'));
 await newApp(root,'pantry',{from:'giving'});
 const appFile=join(root,'apps/pantry/app.json'),app=JSON.parse(readFileSync(appFile,'utf8'));
 app.records={persist:true,collections:{gifts:{fields:{amount:{type:'number',required:true},reference:{type:'string',required:true}}}}};
 app.roles.customer.can=['read:gifts'];app.roles.staff.can=['read:gifts','create:gifts'];
 writeFileSync(appFile,JSON.stringify(app));
 writeFileSync(join(root,'shop.json'),JSON.stringify({till:'stripe',currency:'cad',giving:{receiptText:'Thank you for setting a place.'},items:[{id:'gift',kind:'donation',name:'Pantry gift',price:2000}]}));
 mkdirSync(join(root,'functions'),{recursive:true});
 writeFileSync(join(root,'functions/gifts.ts'),`import {defineFunction} from '@homie-rocks/studio/functions';export default defineFunction<{order:string,amount:number,reference:string}>({name:'gifts',event:'order.paid',handler:async(e,c)=>{await c.records({app:'pantry',role:'staff',collection:'gifts',id:e.data.order,operation:'create',data:{amount:e.data.amount,reference:e.data.reference}});}});`);
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const ip=lanAddresses()[0];assert.ok(ip,'Wi-Fi/LAN address required');const origin=`http://${ip}:${port}`;
 await shopConnectLocal(root,{profile,url:origin});
 config=JSON.parse(Buffer.from(/STRIPE_SHOP_LINKS=base64:(.+)/.exec(readFileSync(join(root,'.dev.vars'),'utf8'))[1],'base64'));
 const listener=spawn('stripe',['--project-name',profile,'listen','--all-snapshot','--forward-to',`http://localhost:${port}/api/shop/hook`],{stdio:['ignore','pipe','pipe']});children.push(listener);
 const secret=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Stripe listener not ready')),30000);const collect=b=>{const match=/whsec_[A-Za-z0-9]+/.exec(String(b));if(match){clearTimeout(timer);resolve(match[0]);}};listener.stdout.on('data',collect);listener.stderr.on('data',collect);listener.on('error',reject);listener.on('exit',()=>{clearTimeout(timer);reject(Error('Stripe listener exited before readiness'));});});
 writeFileSync(join(root,'.dev.vars'),readFileSync(join(root,'.dev.vars'),'utf8')+`STRIPE_WEBHOOK_SECRET=${secret}\n`);
 const dev=spawn(process.execPath,[new URL('../bin/homie-studio.mjs',import.meta.url).pathname,'dev','--lan','--port',String(port),'--no-local-ai'],{cwd:root,stdio:['ignore','pipe','pipe']});children.push(dev);let logs='';for(const stream of [dev.stdout,dev.stderr])stream.on('data',c=>{logs=(logs+c).slice(-2000);});
 const wait=async fn=>{const until=Date.now()+90000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,250));}throw Error('Acceptance timed out');};
 await wait(()=>fetch(origin+'/shop/',{signal:AbortSignal.timeout(1000)}).then(r=>r.ok).catch(()=>false));
 const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});t.after(()=>browser.close());const page=await browser.newPage();await page.setViewport({width:390,height:844});await page.goto(origin+'/shop/');
 const order=await page.evaluate(async()=>{const r=await fetch('/api/shop/buy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({item:'gift',game:'pantry',reference:'meal-table'})});return r.json();});assert.equal(order.ok,true,JSON.stringify(order));
 const checkout=await browser.newPage();await checkout.goto(order.url,{waitUntil:'networkidle2'});
 let session;await wait(async()=>{session=(await api('GET','/v1/checkout/sessions',{payment_link:config.items[0].id,limit:100})).data.find(s=>s.client_reference_id===order.order);return !!session;});
 await api('GET',`/v1/payment_pages/${session.id}`);
 const pm=await api('POST','/v1/payment_methods',{type:'card',card:{token:'tok_visa'},billing_details:{email:'stripe@example.com',name:'Jenny Rosen',address:{line1:'354 Oyster Point Blvd',postal_code:'94080',city:'South San Francisco',state:'CA',country:'US'}}});
 await api('POST',`/v1/payment_pages/${session.id}/confirm`,{payment_method:pm.id,expected_amount:session.amount_total});
 // Open the exact provider return address in the guest's browser context.
 assert.equal(new URL(session.success_url).origin,origin);
 await checkout.goto(session.success_url.replace('{CHECKOUT_SESSION_ID}',session.id));
 await checkout.waitForFunction(()=>document.querySelector('[data-thanks-title]')?.textContent==='Thank you for your gift',{timeout:60000});
 assert.equal(await checkout.$eval('[data-shop-thanks] a.btn',e=>e.textContent),'Back to Pantry acceptance');
 let gifts;await wait(async()=>{gifts=await fetch(origin+'/pantry/api/app/records/gifts').then(r=>r.json());return gifts.records?.length===1;});
 assert.deepEqual(gifts.records[0].data,{amount:2000,reference:'meal-table'});
 console.log('PASS real test Checkout, signed CLI webhook, Wi-Fi guest thank-you page and referenced app gift');
});
