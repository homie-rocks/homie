import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
test('opted-in guest app serves a direct install surface, manifest and service worker',async()=>{
 const meta={id:'guest',kind:'app',name:'Guest',roles:{customer:{signIn:false,can:[]}},surfaces:{phone:'customer'},records:{persist:true,collections:{}},web:{manifest:{name:'Guest app',short_name:'Guest',icons:[]},serviceWorker:'sw.js'}};
 const cat={studio:{name:'Place'},games:[meta]};const assets=new Map([['/games.json',JSON.stringify(cat)],['/games/guest/index.html','<!doctype html><head></head><body><h1>Guest app</h1></body>'],['/games/guest/sw.js','self.addEventListener("fetch",()=>{});']]);
 const env={ASSETS:{fetch:async req=>new Response(assets.get(new URL(req.url).pathname)??'',{status:assets.has(new URL(req.url).pathname)?200:404})}};
 const get=path=>worker.fetch(new Request('https://place.example'+path),env,{waitUntil:()=>{}});
 const page=await get('/guest/install');assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes('<h1>Guest app</h1>'));assert.equal(html.includes('<iframe'),false);assert.equal(page.headers.get('content-security-policy')?.includes('sandbox'),false);
 const manifest=await get('/guest/manifest.webmanifest');assert.equal(manifest.status,200);assert.deepEqual(await manifest.json(),{name:'Guest app',short_name:'Guest',icons:[],id:'/guest/',start_url:'/guest/install',scope:'/guest/',display:'standalone'});
 const sw=await get('/guest/service-worker.js');assert.equal(sw.status,200);assert.equal(sw.headers.get('service-worker-allowed'),'/guest/');assert.ok((await sw.text()).includes('addEventListener'));
});
