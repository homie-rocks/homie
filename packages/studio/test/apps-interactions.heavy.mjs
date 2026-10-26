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

test('needs follow a payment popup and retain the original phone',async t=>{
 const {proveAppNeeds}=await import('../lib/app-needs.mjs');const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const shots=mkdtempSync(join(tmpdir(),'homie-popup-'));t.after(()=>rmSync(shots,{recursive:true,force:true}));
 const b=await browser(t),p=await b.newPage();await p.setContent('<a id="give" target="_blank" href="about:blank">Give</a><p id="phone">My gift</p>');
 p.on('popup',async popup=>{await popup.setContent('<h1 id="checkout">Pay securely</h1>');});
 const result=await proveAppNeeds({plan:{needs:[{id:'give',statement:'Give on phone',steps:[{surface:'phone',selector:'#give',click:true,popup:'checkout'}],assertions:[{surface:'checkout',selector:'#checkout',text:'Pay securely'},{surface:'phone',selector:'#phone',text:'My gift'}]}]},surfaces:[{name:'phone',page:p,frame:p.mainFrame()}],shots});
 assert.equal(result[0].status,'met',result[0].why);assert.equal(await p.$eval('#phone',e=>e.innerText),'My gift');assert.equal(result[0].captures.length,2);
});
