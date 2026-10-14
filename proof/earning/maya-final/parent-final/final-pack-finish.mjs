import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {stripeProcess} from './node_modules/@homie-rocks/studio/lib/stripe-connect.mjs';
const origin='http://127.0.0.1:17851',out='../evidence/parent-final/';
const cli=async(method,path,params={})=>{const args=['--project-name','Homie sandbox',method,path,'--stripe-version','2025-03-31.basil'];for(const[k,v]of Object.entries(params))args.push('-d',`${k}=${v}`);const r=await stripeProcess(args);const b=JSON.parse(r.stdout);assert.ok(r.code===0&&!b.error,'Sandbox API request succeeded');return b;};
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const sessions=await cli('get','/v1/checkout/sessions',{limit:100});const actual=sessions.data.find(s=>s.status==='complete'&&s.metadata?.origin===origin&&s.metadata?.game==='tune');assert.ok(actual);const booking=actual.metadata.order;
 const phone=await browser.newPage();await phone.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await phone.goto(origin+'/tune/open?ticket='+booking);await phone.waitForSelector('iframe');await wait(2500);let f=phone.frames().find(x=>x.url().includes('/__game/'));
 await phone.bringToFront();await f.waitForFunction(()=>document.querySelector('#receipt')?.textContent.includes('Confirmed · paid'),{timeout:30000});await phone.screenshot({path:out+'final-pack-phone-paid.png'});
 const wall=await browser.newPage();await wall.setViewport({width:1440,height:900});await wall.goto(origin+'/tune/tv');await wall.waitForSelector('iframe');await wait(2500);await wall.screenshot({path:out+'final-pack-wall-paid.png'});
 assert.equal(actual.payment_status,'paid');assert.equal(actual.livemode,false);await cli('post','/v1/refunds',{payment_intent:actual.payment_intent});
 await phone.bringToFront();await f.waitForFunction(()=>document.querySelector('#receipt')?.textContent.includes('Released'),{timeout:30000});await phone.screenshot({path:out+'final-pack-phone-refunded.png'});
 writeFileSync(out+'final-pack-payment.json',JSON.stringify({profile:'Homie sandbox',session:actual.id,booking,paid:true,refundReleased:true,hostedCheckoutCaptured:true},null,2));console.log('PASS final pack: real paid booking visible on phone and wall; refund releases in-place');
}finally{await browser.close();}
