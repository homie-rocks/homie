import {test} from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {findChrome,chromeArgs} from '../lib/chrome.mjs';
import {header,gameLanding} from '../worker/site.mjs';
import {thanksPage} from '../worker/shop-page.mjs';
import {playPage} from '../worker/pages.mjs';
const app={id:'pantry',kind:'app',name:'Meal table',words:{open:'Open place'},players:{max:32}};
const cat={studio:{name:'River Pantry',kind:'cause'},games:[app],site:{pages:['/about/']},shop:{giving:{},items:[]}};
async function browser(t){const b=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});t.after(()=>b.close());return b;}
test('cause menu names its pages, shop and app',async t=>{
 const b=await browser(t),p=await b.newPage();await p.setContent(header(cat));
 assert.deepEqual(await p.$$eval('nav a',els=>els.map(e=>e.innerText)),['About','Give','Meal table']);
});
test('website action is independent of the app open word',async t=>{
 const b=await browser(t),p=await b.newPage();await p.setContent(await gameLanding(cat,app).text());
 assert.equal(await p.$eval('a.play',e=>e.innerText),'Open Meal table');
});
test('giving thank you returns to the named organisation',async t=>{
 const b=await browser(t),p=await b.newPage();await p.setContent(await thanksPage(cat,{giving:{receiptText:'Your gift sets another place.'}}).text());
 assert.equal(await p.$eval('[data-shop-thanks] a.btn',e=>e.innerText),'Back to River Pantry');
});
test('app sharing is above a phone tab bar and uses the app name',async t=>{
 const b=await browser(t),p=await b.newPage();await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await p.setRequestInterception(true);p.on('request',r=>r.respond({status:200,contentType:'text/html',body:'<p>App</p>'}));
 await p.setContent(await playPage(cat,app,{room:'pub-5',server:{id:'public',name:'Quick play',badge:'Open'}}).text());
 await p.evaluate(()=>{window.__homieArrival?.finish?.();});
 const text=await p.$eval('[data-share-toggle]',e=>e.textContent);
 assert.ok(text.includes('Meal table'),text);
 const rect=await p.$eval('[data-share-toggle]',e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom};});
 assert.ok(rect.bottom<760,JSON.stringify(rect));
});

test('gathering check-in records contain only the chosen task and status',async t=>{
 const {build}=await import('esbuild');const {readFileSync}=await import('node:fs');
 const entry=new URL('../app-starters/gathering/src/view.ts',import.meta.url).pathname;
 const bundle=await build({entryPoints:[entry],bundle:true,write:false,format:'iife',plugins:[{name:'local-records',setup(b){
 b.onResolve({filter:/^@homie-rocks\/studio\//},args=>({path:args.path,namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path.endsWith('/links')?'export const randomId=()=>"checkin"':args.path.endsWith('/apps')?'export const createAppRecords=()=>({list:async()=>window.rows||[],create:async(data,id)=>{window.rows=[{id,data}];},update:async()=>{}})':'export const openRoom=()=>({net:{params:{},link:"online",playable(){},on(){}},command(){},on(){}})',loader:'js'}));
 }}]});
 const b=await browser(t),p=await b.newPage();await p.setContent(readFileSync(new URL('../app-starters/gathering/index.html',import.meta.url),'utf8'));await p.addScriptTag({content:bundle.outputFiles[0].text});
 await p.waitForFunction(()=>!document.querySelector('[data-action]').disabled);
 await p.select('#choice','Packing');await p.click('[data-action]');
 await p.waitForFunction(()=>window.rows?.length===1);
 assert.deepEqual(await p.evaluate(()=>window.rows[0].data),{choice:'Packing',status:'Checked in'});
 assert.deepEqual(await p.$$eval('#choice option',es=>es.map(e=>e.innerText)),['Welcome desk','Packing','Deliveries']);
 assert.equal(await p.$eval('[data-count]',e=>e.innerText),'1');
});

test('app style starts with illustration and attributes AI refinements to the AI',async t=>{
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {initDecisions,readDecisions,steerDecision}=await import('../lib/decisions.mjs');
 const root=mkdtempSync(join(tmpdir(),'homie-app-style-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'apps/pantry'),{recursive:true});writeFileSync(join(root,'studio.json'),JSON.stringify(cat.studio));writeFileSync(join(root,'apps/pantry/app.json'),JSON.stringify(app));
 initDecisions(root,'pantry');assert.equal(readDecisions(root,'pantry').decisions['style.render'].value,'illustrated');
 const r=steerDecision(root,'pantry','style.palette','warmer',{by:'ai'});assert.equal(r.record.by,'ai');assert.equal(r.record.state,'auto');
});

test('needs follow a payment popup and retain the original phone',async t=>{
 const {proveAppNeeds}=await import('../lib/app-needs.mjs');const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const shots=mkdtempSync(join(tmpdir(),'homie-popup-'));t.after(()=>rmSync(shots,{recursive:true,force:true}));
 const b=await browser(t),p=await b.newPage();await p.setContent('<a id="give" target="_blank" href="about:blank">Give</a><p id="phone">My gift</p>');
 p.on('popup',async popup=>{await popup.setContent('<h1 id="checkout">Pay securely</h1>');});
 const result=await proveAppNeeds({plan:{needs:[{id:'give',statement:'Give on phone',steps:[{surface:'phone',selector:'#give',click:true,popup:'checkout'}],assertions:[{surface:'checkout',selector:'#checkout',text:'Pay securely'},{surface:'phone',selector:'#phone',text:'My gift'}]}]},surfaces:[{name:'phone',page:p,frame:p.mainFrame()}],shots});
 assert.equal(result[0].status,'met',result[0].why);assert.equal(await p.$eval('#phone',e=>e.innerText),'My gift');assert.equal(result[0].captures.length,2);
});

test('home page action also owns its website wording',async t=>{
 const {homePage}=await import('../worker/site.mjs');const b=await browser(t),p=await b.newPage();await p.setContent(await homePage(cat).text());
 const labels=await p.$$eval('a[data-play]',els=>els.map(e=>e.innerText));assert.ok(labels.length);for(const label of labels)assert.equal(label,'Open Meal table');
});

test('confirmed gift page gives receipt instructions once',async t=>{
 const {SHOP_JS}=await import('../worker/shop-page.mjs');const b=await browser(t),p=await b.newPage();
 await p.setContent(await thanksPage(cat,{giving:{}},{session:'cs_paid'}).text());
 await p.evaluate(()=>{window.fetch=async()=>({ok:true,json:async()=>({ok:true,status:'paid'})});});await p.addScriptTag({content:SHOP_JS});
 await p.waitForFunction(()=>document.querySelector('[data-thanks-title]').textContent==='Thank you for your gift');
 const visible=await p.$eval('[data-shop-thanks]',e=>e.innerText);assert.equal(visible.split('Your receipt comes from Stripe by email.').length-1,1);
});

test('app arrival and wall captions describe opening the app',async t=>{
 const {watchPage}=await import('../worker/pages.mjs');const b=await browser(t),p=await b.newPage();await p.setRequestInterception(true);p.on('request',r=>r.respond({status:200,contentType:'application/json',body:'{}'}));
 await p.setContent(await playPage(cat,app,{room:'pub-5'}).text());
 assert.equal(await p.$eval('[data-arrive-step]',e=>e.textContent),'Opening the app…');
 await p.setContent(await watchPage(cat,app,{room:'pub-5'}).text());
 assert.equal(await p.$eval('[data-room-label]',e=>e.innerText),'Meal table');
 assert.doesNotMatch(await p.$eval('body',e=>e.innerText),/Room 5|Quick play|people here|Play/);
});
