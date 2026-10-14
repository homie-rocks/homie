import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {stripeProcess} from './node_modules/@homie-rocks/studio/lib/stripe-connect.mjs';
const origin='http://127.0.0.1:17851',out='../evidence/parent-final/';
const cli=async(method,path,params={})=>{const args=['--project-name','Homie sandbox',method,path,'--stripe-version','2025-03-31.basil'];for(const[k,v]of Object.entries(params))args.push('-d',`${k}=${v}`);const r=await stripeProcess(args);const b=JSON.parse(r.stdout);assert.ok(r.code===0&&!b.error,'Sandbox API request succeeded');return b;};
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const open=await cli('get','/v1/checkout/sessions',{limit:100});for(const s of open.data)if(s.status==='open'&&s.metadata?.origin===origin&&s.metadata?.game==='tune')await cli('post',`/v1/checkout/sessions/${s.id}/expire`);await wait(2000);
 const phone=await browser.newPage();await phone.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await phone.goto(origin+'/tune/open');
 await phone.waitForSelector('iframe');let f;for(let i=0;i<50;i++){f=phone.frames().find(x=>x.url().includes('/__game/'));if(f&&await f.$('#book'))break;await wait(200);}
 await f.waitForFunction(()=>document.querySelector('#connection')?.textContent==='Workshop connected');
 await f.select('#slot','pm');let bought;phone.on('response',async r=>{if(r.url().includes('/api/shop/buy'))bought=await r.json();});await f.click('#book');
 for(let i=0;i<100&&!bought;i++)await wait(250);assert.equal(bought?.ok,true);const session=bought.url.match(/cs_test_[A-Za-z0-9]+/)[0];
 await f.waitForFunction(()=>document.querySelector('#receipt')?.textContent.includes('Awaiting payment'));await phone.screenshot({path:out+'final-pack-phone-held.png'});
 await wait(2000);const checkout=(await browser.pages()).find(p=>p.url().startsWith('https://checkout.stripe.com/'));if(checkout){await checkout.setViewport({width:390,height:844});await checkout.screenshot({path:out+'final-pack-stripe-checkout.png'});}
 await cli('get',`/v1/payment_pages/${session}`);const pm=await cli('post','/v1/payment_methods',{type:'card','card[token]':'tok_visa','billing_details[email]':'stripe@example.com','billing_details[name]':'Jenny Rosen','billing_details[address][line1]':'354 Oyster Point Blvd','billing_details[address][postal_code]':'94080','billing_details[address][city]':'South San Francisco','billing_details[address][state]':'CA','billing_details[address][country]':'US'});
 await cli('post',`/v1/payment_pages/${session}/confirm`,{payment_method:pm.id,expected_amount:6500});
 await f.waitForFunction(()=>document.querySelector('#receipt')?.textContent.includes('Confirmed · paid'),{timeout:30000});await phone.screenshot({path:out+'final-pack-phone-paid.png'});
 const wall=await browser.newPage();await wall.setViewport({width:1440,height:900});await wall.goto(origin+'/tune/tv');await wall.waitForSelector('iframe');await wait(3000);await wall.screenshot({path:out+'final-pack-wall-paid.png'});
 const actual=await cli('get',`/v1/checkout/sessions/${session}`);assert.equal(actual.payment_status,'paid');assert.equal(actual.livemode,false);
 await cli('post','/v1/refunds',{payment_intent:actual.payment_intent});await f.waitForFunction(()=>document.querySelector('#receipt')?.textContent.includes('Released'),{timeout:30000});await phone.screenshot({path:out+'final-pack-phone-refunded.png'});
 writeFileSync(out+'final-pack-payment.json',JSON.stringify({profile:'Homie sandbox',session,booking:bought.booking,paid:true,refundReleased:true,hostedCheckoutCaptured:Boolean(checkout)},null,2));console.log('PASS final pack: phone hold, actual Stripe Checkout payment, wall confirmation, refund release');
}finally{await browser.close();}
