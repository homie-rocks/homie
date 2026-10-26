import {test} from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {findChrome,chromeArgs} from '../lib/chrome.mjs';
import {playPage} from '../worker/pages.mjs';
import {actInApp} from '../lib/app-ready.mjs';
import {JOIN_AREA_FRAME_JS} from '../worker/join-area.mjs';
test('TV status and tee sheet reserve the join card at HD, full HD and 4K',async()=>{
 const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});
 try {const page=await browser.newPage();
 for(const [width,height] of [[1920,1080],[1280,720],[3840,2160]]) {
 await page.setViewport({width,height});
 const response=playPage({studio:{name:'Golf'},games:[]},{id:'golf',name:'Golf',kind:'app'},{screen:true,joinUrl:'https://golf.example/'+ 'long-address/'.repeat(30),qr:'<svg></svg>'});
 await page.setContent(await response.text());
 const app=`<script>${JOIN_AREA_FRAME_JS}</script><style>body{margin:0}#status{position:fixed;right:20px;bottom:calc(var(--homie-join-inset-bottom,0px) + 20px);width:200px;height:80px}#tees{position:fixed;bottom:20px;left:20px;right:calc(var(--homie-join-inset-right,0px) + 20px);height:60px}</style><aside id="status">Status</aside><footer id="tees">Tee sheet</footer>`;
 await page.evaluate(app=>{document.querySelectorAll('[data-arrive]').forEach(e=>e.remove());document.querySelector('iframe').srcdoc=app;},app);
 const frame=page.frames().find(f=>f!==page.mainFrame());
 await frame.waitForFunction(()=>document.body.classList.contains('homie-join-visible'));
 const card=await page.$eval('[data-join]',e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};});
 const result=await frame.evaluate(card=>({active:document.body.classList.contains('homie-join-visible'),width:card.width,height:card.height,clear:['status','tees'].every(id=>{const b=document.getElementById(id).getBoundingClientRect();return b.right<=card.left||b.bottom<=card.top||b.left>=card.right||b.top>=card.bottom;})}),card);
 assert.equal(result.active,true);assert.ok(result.width<=480&&result.height<=280);assert.equal(result.clear,true,JSON.stringify({width,height,result}));
 await page.$eval('[data-join]',e=>e.hidden=true);await frame.waitForFunction(()=>!document.body.classList.contains('homie-join-visible'));
 assert.equal(await frame.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--homie-join-inset-bottom')),'0px');
 }
 }finally{await browser.close();}
});
test('covered click reports its blocker before dispatch',async()=>{
 const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});
 try{const page=await browser.newPage();await page.setContent('<button id="book">Book</button><div id="cover" style="position:fixed;inset:0">Loading</div>');let dispatched=false;
 await assert.rejects(actInApp({name:'phone',frame:page.mainFrame()},'#book',async frame=>{dispatched=true;await frame.click('#book');}),/covered.*#cover/);
 assert.equal(dispatched,false);await page.$eval('#cover',e=>e.remove());await actInApp({name:'phone',frame:page.mainFrame()},'#book',async frame=>frame.click('#book'));
 }finally{await browser.close();}
});
test('forced WebGL failure leaves text navigation usable and fallback outside it',async()=>{
 const {forceWebglFailure}=await import('../lib/app-ready.mjs');
 const {appGraphicsFallback}=await import('../worker/app-graphics.mjs');
 const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});
 try{const page=await browser.newPage();await page.evaluateOnNewDocument(forceWebglFailure);
 await page.goto('data:text/html,<main><nav><button id="book">Book</button></nav><section><canvas></canvas></section><output></output></main>');
 await page.evaluate(()=>{document.querySelector('button').onclick=()=>document.querySelector('output').textContent='Booked';});
 await page.evaluate(appGraphicsFallback);
 assert.equal(await page.evaluate(()=>document.createElement('canvas').getContext('webgl2')),null);
 await actInApp({name:'phone',frame:page.mainFrame()},'#book',f=>f.click('#book'));
 assert.equal(await page.$eval('output',e=>e.textContent),'Booked');
 assert.equal(await page.$eval('[data-webgl-fallback]',e=>getComputedStyle(e).position),'static');
 }finally{await browser.close();}
});
test('shell overlay covering a sandbox frame is reported before its click',async()=>{
 const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});
 try{const page=await browser.newPage();await page.setContent('<iframe sandbox="allow-scripts" srcdoc="<button id=book>Book</button>"></iframe><div id="shell-cover" style="position:fixed;inset:0"></div>');
 const frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForSelector('#book');
 await assert.rejects(actInApp({name:'phone',frame},'#book',f=>f.click('#book')),/covered.*#shell-cover/);
 }finally{await browser.close();}
});
