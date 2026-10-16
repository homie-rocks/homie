// One owned headless browser; never attach to a desktop or another job's browser.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {loadavg,platform,arch} from 'node:os';
import puppeteer from 'puppeteer-core';
import {findChrome,chromeArgs} from '../packages/studio/lib/chrome.mjs';
import {launchWithDeadline,ciLaunchOptions} from './chrome-launch-options.mjs';
if(loadavg()[0]>20)throw new Error('Load above 20; defer browser work');
const root=resolve('packages/studio/parts'),out=resolve(process.env.PARTS_EVIDENCE || '/tmp/homie-parts-checklist-map');mkdirSync(out,{recursive:true});
const server=createServer((req,res)=>{try {const file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+sep))throw new Error();const bytes=readFileSync(file);res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json'})[extname(file)]||'text/plain');res.end(bytes);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try {
 browser=await launchWithDeadline(opts=>puppeteer.launch(opts),ciLaunchOptions({executablePath:findChrome(),headless:true,args:chromeArgs()}));
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const base=`http://127.0.0.1:${server.address().port}`;
 await page.goto(base+'/owner-action-checklist/preview/index.html');await page.waitForSelector('li button');
 assert.equal(await page.$$eval('li button',b=>b.length),4);
 await page.click('li button');await page.waitForFunction(()=>document.querySelector('li button').textContent==='Undo');await page.click('li button');await page.waitForFunction(()=>document.querySelector('li button').disabled);
 assert.equal(await page.$eval('li [role=status]',e=>e.textContent),'Restored the previous state.');
 await page.click('li:nth-child(2) button');assert.equal(await page.$eval('li:nth-child(2) button',e=>e.textContent),'Done');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:out+'/checklist-phone.png',fullPage:true});
 const uncertain=await page.evaluate(async()=>{
  const {mountChecklist}=await import('/owner-action-checklist/src/index.mjs');
  const root=document.createElement('section');document.body.append(root);let calls=0,reject;
  const item={id:'pending',revision:'r1',title:'<img src=x onerror=alert(1)>',consequence:'Reserve the room.',confirmLabel:'Confirm'};
  const ui=mountChecklist(root,{list:async()=>[item],execute:()=>{calls++;return new Promise((_r,no)=>{reject=no;});}});await ui.ready;
  root.querySelector('button').click();root.querySelector('button').click();const during=calls;
  reject(new Error('connection lost'));await new Promise(r=>setTimeout(r,0));await ui.refresh();
  const result={during,disabled:root.querySelector('button').disabled,injected:!!root.querySelector('img')};ui.dispose();root.remove();return result;
 });assert.deepEqual(uncertain,{during:1,disabled:true,injected:false});
 await page.goto(base+'/terrain-route-map/preview/index.html');await page.waitForFunction(()=>window.map);
 const cdp=await page.createCDPSession();await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.focus('canvas');const before=await page.evaluate(()=>map.camera.position.toArray());await page.keyboard.press('ArrowLeft');assert.notDeepEqual(await page.evaluate(()=>map.camera.position.toArray()),before);
 await page.click('.terrain-controls button:nth-child(3)');
 // Exercise actual two-finger touchscreen pinch through CDP, then validate its camera effect.
 const radius=await page.evaluate(()=>map.camera.position.length());
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:140,y:400},{x:240,y:400}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:110,y:400},{x:270,y:400}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.notEqual(await page.evaluate(()=>map.camera.position.length()),radius);
 const perf=await page.evaluate(async()=>{
  const frames=[],work=[];let previous=performance.now();
  const original=map.renderer.render.bind(map.renderer);map.renderer.render=(...args)=>{const start=performance.now();original(...args);work.push(performance.now()-start);};
  for(let i=0;i<120;i++)await new Promise(resolve=>requestAnimationFrame(now=>{frames.push(now-previous);previous=now;map.command('right');resolve();}));
  map.renderer.render=original; frames.shift(); const stats=a=>{a.sort((a,b)=>a-b);return {p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)};};
  const gl=map.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  return {frameMs:stats(frames),renderCpuMs:stats(work),triangles:map.renderer.info.render.triangles,drawCalls:map.renderer.info.render.calls,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
 });
 await page.evaluate(()=>map.command('reset'));await new Promise(r=>setTimeout(r,100));
 await page.screenshot({path:out+'/terrain-phone.png'});
 const idleStart=await page.evaluate(()=>map.renderer.info.render.frame);await new Promise(r=>setTimeout(r,250));assert.equal(await page.evaluate(()=>map.renderer.info.render.frame),idleStart);
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});await page.focus('canvas');await page.keyboard.press('Home');await new Promise(r=>setTimeout(r,100));await page.screenshot({path:out+'/terrain-tv.png'});
 await page.evaluate(()=>map.dispose());assert.equal(await page.$('canvas'),null);assert.deepEqual(errors,[]);
 const receipt={at:new Date().toISOString(),platform:platform(),arch:arch(),chrome:await browser.version(),cpuThrottle:4,viewport:'390x844 DPR 1',load:loadavg(),...perf,screenshots:['checklist-phone.png','terrain-phone.png','terrain-tv.png'],checks:['duplicate tap blocked','uncertain revision locked','text-only labels','confirm/undo','irreversible action','no phone overflow','keyboard camera','camera buttons','two-finger pinch','idle zero frames','TV viewport','dispose','no page errors']};
 writeFileSync(out+'/receipt.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));console.log(out);
} finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
