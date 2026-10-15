import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import puppeteer from 'puppeteer-core';
import {findChrome,chromeArgs} from '../lib/chrome.mjs';
import {recordsPage} from '../worker/records-page.mjs';
import worker from '../worker/index.mjs';
const meta={id:'form',name:'Form',kind:'app',roles:{customer:{signIn:false,can:[]}},surfaces:{phone:'customer',wall:'customer'},records:{persist:true,collections:{}},words:{},netplay:{}};
// Cold Chrome startup belongs to suite setup, not the first app's 15-second
// readiness deadline. Keep Puppeteer's existing 30-second launch bound and give
// every test a fresh context. Register cancellation before launch: a late launch
// must never outlive a failed hook and keep the shard alive until its watchdog.
const browserLifetime=new AbortController();
let browser;
after(async()=>{try{await browser?.close();}finally{browserLifetime.abort();}});
before(async()=>{
 browser=await puppeteer.launch({executablePath:findChrome(),headless:true,dumpio:true,args:[...chromeArgs(),'--disable-gpu','--disable-webgl'],signal:browserLifetime.signal});
},{timeout:30000});
async function fixture(t,html,shop=null){
 const cat={studio:{name:'Test'},games:[meta]},env={ASSETS:{fetch:async req=>new URL(req.url).pathname.endsWith('index.html')?new Response(html,{headers:{'content-type':'text/html'}}):Response.json(cat)}};
 let loads=0;
 const server=createServer(async(req,res)=>{try{const origin=`http://localhost:${server.address().port}`;if(req.url==='/frame'){res.end('<iframe style="width:100vw;height:100vh;border:0" sandbox="allow-scripts allow-modals" src="/form/__game/"></iframe>');return;}if(req.url.startsWith('/form/__game/'))loads++;const r=req.url==='/records-with-shop'?recordsPage(meta,new URL(origin+'/form/play'),cat,shop):await worker.fetch(new Request(origin+req.url),env,{waitUntil:p=>p.catch(()=>{})});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));}catch(e){res.writeHead(500);res.end(e.message);}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const context=browser.createBrowserContext();t.after(async()=>{await (await context).close();});
 const page=await (await context).newPage();await page.setViewport({width:390,height:844});return {page,origin:`http://localhost:${server.address().port}`,loads:()=>loads};
}
test('sandboxed app storage is usable and WebGL fallback does not cover the headline',{timeout:15000},async t=>{
 const {page,origin}=await fixture(t,'<!doctype html><head></head><body><h1 style="position:absolute;top:80px">Our fittings</h1><canvas></canvas><script>localStorage.setItem("draft","one");sessionStorage.setItem("draft","two");document.body.dataset.storage=localStorage.getItem("draft")+sessionStorage.getItem("draft");</script></body>');
 await page.goto(origin+'/frame');const frame=page.frames().find(f=>f.url().includes('/__game/'));await frame.waitForSelector('[data-webgl-fallback]',{timeout:1000});
 assert.equal(await frame.$eval('body',el=>el.dataset.storage),'onetwo');
 const overlaps=await frame.evaluate(()=>{const a=document.querySelector('h1').getBoundingClientRect(),b=document.querySelector('[data-webgl-fallback]').getBoundingClientRect();return a.top<b.bottom&&a.bottom>b.top&&a.left<b.right&&a.right>b.left;});assert.equal(overlaps,false);
});
test('records-only app opens one frame without a room or map and reaches readiness',{timeout:15000},async t=>{
 const {page,origin,loads}=await fixture(t,'<!doctype html><h1>Fitting bookings</h1><form><input><button>Save</button></form><ul></ul>');
 await page.goto(origin+'/form/open?room=records-check');
 await page.waitForFunction(()=>window.__shell?.arrival?.phase==='done'&&window.__shell?.link?.state==='online',{timeout:1500});
 assert.equal(loads(),1);assert.equal(await page.frames().find(f=>f.url().includes('/__game/')).$eval('h1',el=>el.textContent),'Fitting bookings');
});
test('check auto-answers real dialogs and observes real sound and haptic calls',{timeout:15000},async t=>{
 const {observeEffects,answerDialogs}=await import('../lib/app-ready.mjs');const {proveAppNeeds}=await import('../lib/app-needs.mjs');
 const {page,origin}=await fixture(t,`<!doctype html><button id="fit">Fit board</button><output id="done"></output><script>document.querySelector('button').onclick=()=>{{const audio=new AudioContext();const tone=audio.createOscillator();tone.connect(audio.destination);tone.start();tone.stop(audio.currentTime+.01);navigator.vibrate(10);document.querySelector('output').textContent='Fitted';}};</script>`);
 const dialogs=[];answerDialogs(page,'tablet',dialogs);await page.evaluateOnNewDocument(observeEffects);await page.goto(origin+'/frame');await page.evaluate(()=>{confirm('Fit this board?');alert('Fitted');});const frame=page.frames().find(f=>f.url().includes('/__game/'));
 const [need]=await proveAppNeeds({plan:{needs:[{id:'fit',statement:'Confirm fitting with a sound and haptic',steps:[{surface:'tablet',selector:'#fit',click:true}],assertions:[{surface:'tablet',selector:'#done',text:'Fitted'},{surface:'tablet',effect:'sound',name:'audio'},{surface:'tablet',effect:'haptic',name:'vibrate'}]}]},surfaces:[{name:'tablet',frame,page}]});
 assert.equal(need.status,'met',need.why);assert.deepEqual(dialogs.map(d=>d.type),['confirm','alert']);
});

test('records-only shell sends booking checkout and returns the booking to the frame',{timeout:15000},async t=>{
 const {page,origin}=await fixture(t,`<!doctype html><button id="book">Hold and pay</button><output></output><script>
 window.addEventListener('message',e=>{if(e.data?.t==='homie-shop'&&e.data.q==='booking')document.querySelector('output').textContent=e.data.booking||e.data.error;});
 document.querySelector('button').onclick=()=>parent.postMessage({t:'homie-shop',q:'booking',op:'checkout',lines:[{item:'tune',quantity:1}],booking:{collection:'bookings',slot:'morning'}},'*');
 </script>`,{policy:{},open:true});
 let request;
 await page.setRequestInterception(true);
 page.on('request',r=>{
  if(r.url().includes('/api/shop/buy')){request=JSON.parse(r.postData());return r.respond({status:200,contentType:'application/json',body:JSON.stringify({ok:true,booking:'ord_test'})});}
  if(r.url().includes('/api/player/owns'))return r.respond({status:200,contentType:'application/json',body:'{"owns":[]}'});
  return r.continue();
 });
 await page.goto(origin+'/records-with-shop');
 // Click only once the shell has finished arriving, so the bridge is listening on a busy runner.
 await page.waitForFunction(()=>window.__shell?.arrival?.phase==='done',{timeout:10000});
 const frame=page.frames().find(f=>f.url().includes('/__game/'));await frame.waitForSelector('#book');await frame.click('#book');
 await frame.waitForFunction(()=>document.querySelector('output').textContent==='ord_test',{timeout:10000});
 assert.deepEqual(request.booking,{collection:'bookings',slot:'morning'});assert.equal(request.game,'form');
 assert.equal(await page.evaluate(()=>window.__shell.arrival.phase),'done');
});

test('guest app frames permit Web Share and a real postcard download',{timeout:15000},async t=>{
 const {mkdtempSync,readFileSync,rmSync,existsSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'homie-postcard-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const {page,origin}=await fixture(t,'<!doctype html><button id="save">Save postcard</button><script>document.querySelector("button").onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["Greetings!"],{type:"text/plain"}));a.download="postcard.txt";a.click();};</script>');
 const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,browserContextId:page.browserContext().id});
 await page.goto(origin+'/form/open');await page.waitForFunction(()=>window.__shell?.arrival?.phase==='done');
 const frame=page.frames().find(f=>f.url().includes('/__game/'));
 assert.ok(await page.$eval('iframe',el=>el.allow.split(';').map(x=>x.trim()).includes('web-share *')));
 if(await frame.evaluate(()=>document.featurePolicy.features().includes('web-share'))) assert.equal(await frame.evaluate(()=>document.featurePolicy.allowsFeature('web-share')),true);
 await frame.click('#save');
 for(let i=0;i<30&&!existsSync(join(dir,'postcard.txt'));i++)await new Promise(r=>setTimeout(r,100));
 assert.equal(readFileSync(join(dir,'postcard.txt'),'utf8'),'Greetings!');
});

test('a decorative app hero lets the containing page scroll',{timeout:15000},async t=>{
 const {layout}=await import('../worker/site.mjs');
 const {page,origin}=await fixture(t,'<!doctype html><div style="height:2000px">Postcards</div>');
 await page.goto(origin+'/form/open');
 await page.setContent(await layout({studio:{name:'Test'},games:[]},{title:'Hero',main:`<style>.hero{height:700px}.hero iframe{width:100%;height:700px}footer{height:2000px}</style><section class="hero"><div class="hero-media"><iframe src="${origin}/form/open"></iframe></div></section><footer>More about us</footer>`}).text());
 await page.waitForSelector('iframe');await page.mouse.move(195,350);await page.mouse.wheel({deltaY:600});
 await page.waitForFunction(()=>window.scrollY>100,{timeout:1500});
 assert.ok(await page.evaluate(()=>window.scrollY)>100);
});

test('records-only preferences survive reload and stay scoped to the app frame',{timeout:15000},async t=>{
 const {page,origin}=await fixture(t,`<!doctype html><button>Keep team</button><output></output><script>
 addEventListener('message',e=>{if(e.data?.t==='homie-prefs')document.querySelector('output').textContent=JSON.stringify(e.data);});
 document.querySelector('button').onclick=()=>parent.postMessage({t:'homie-net',what:'prefs',n:1,op:'set',k:'team',v:'Saltwater Otters'},'*');
 parent.postMessage({t:'homie-net',what:'prefs',n:2,op:'all'},'*');
 </script>`);
 await page.goto(origin+'/form/open');let frame=page.frames().find(f=>f.url().includes('/__game/'));
 assert.equal(await frame.evaluate(()=>window.HOMIE_NET.prefs),true);assert.equal(await frame.evaluate(()=>window.HOMIE_NET.kind),'app');
 await frame.click('button');await frame.waitForFunction(()=>document.querySelector('output').textContent.includes('kept'));
 await page.reload();frame=page.frames().find(f=>f.url().includes('/__game/'));await frame.waitForFunction(()=>document.querySelector('output').textContent.includes('Saltwater Otters'));
 await page.evaluate(()=>window.postMessage({t:'homie-net',what:'prefs',n:3,op:'set',k:'team',v:'forged'},'*'));
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('homie-prefs.form')).team),'Saltwater Otters');
});

test('supported app context returns a public self address without access tokens',async t=>{
 const {page,origin}=await fixture(t,`<!doctype html><output></output><script>
 addEventListener('message',e=>{if(e.source===parent&&e.data.type==='homie-app-context')document.querySelector('output').textContent=JSON.stringify(e.data.context);});
 parent.postMessage({type:'homie-app-context'},'*');</script>`);
 await page.goto(origin+'/form/open?room=main');const frame=page.frames().find(f=>f.url().includes('/__game/'));
 await frame.waitForFunction(()=>document.querySelector('output').textContent,{timeout:2000});
 const context=JSON.parse(await frame.$eval('output',e=>e.textContent));assert.equal(context.app,'form');assert.equal(context.url,origin+'/form/open');assert.equal(context.origin,origin);
});
