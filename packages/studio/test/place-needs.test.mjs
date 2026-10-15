import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proveAppNeeds} from '../lib/app-needs.mjs';
test('needs race browser actions and restart through the supplied dev controller',async()=>{
 let started=0,restarted=0;let release;const barrier=new Promise(r=>release=r);
 const surfaces=['phone','phone-two'].map(name=>({name,page:{bringToFront:async()=>{}},frame:{waitForSelector:async()=>{},click:async()=>{if(++started===2)release();await barrier;}}}));
 const [result]=await proveAppNeeds({surfaces,restart:async()=>{restarted++;},plan:{needs:[{id:'race',statement:'Two visitors race and restart',steps:[{concurrent:[{surface:'phone',selector:'button',click:true},{surface:'phone-two',selector:'button',click:true}]},{restart:true}],assertions:[{mcp:{tool:'state'},equals:{taken:1}}]}]},headless:async()=>({taken:1})});
 assert.equal(result.status,'met',result.why);assert.equal(started,2);assert.equal(restarted,1);
});

test('forced disabled click reaches server refusal; two browser contexts race; workflow works without WebGL',{timeout:60000},async t=>{
 const {default:puppeteer}=await import('puppeteer-core');const {findChrome,chromeArgs}=await import('../lib/chrome.mjs');
 const {createServer}=await import('node:http');const {once}=await import('node:events');const {database}=await import('./place-database.mjs');const {appToolsRoute}=await import('../worker/app-tools.mjs');
 const DB=database(t),meta={id:'place',kind:'app',roles:{customer:{can:[],signIn:false}},surfaces:{phone:'customer'}};
 const tool={name:'reserve',audience:'public',inputSchema:{type:'object',properties:{},additionalProperties:false},handler:(_,ctx)=>ctx.database.put('seat','taken',{version:0})};
 const server=createServer(async(req,res)=>{
  if(req.method==='POST'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const url=new URL(`http://localhost:${server.address().port}/place/api/app/tools`);
   const answer=await appToolsRoute(new Request(url,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}),{DB},meta,url,{games:[meta]},[tool]);res.writeHead(answer.status,{'content-type':'application/json'});res.end(await answer.text());return;
  }
  res.end(`<!doctype html><button disabled>Reserve</button><output id="result"></output><output id="graphics"></output><script>
   document.querySelector('#graphics').textContent=document.createElement('canvas').getContext('webgl')?'3D':'fallback';
   document.querySelector('button').onclick=async()=>{const r=await fetch('/reserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'reserve',input:{}})});const v=await r.json();document.querySelector('#result').textContent=v.data.ok?'booked':'full';};</script>`);
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});t.after(()=>browser.close());
 const surfaces=[];for(const name of ['phone','phone-two']){const context=await browser.createBrowserContext(),page=await context.newPage();await page.goto(`http://localhost:${server.address().port}`);surfaces.push({name,page,frame:page.mainFrame()});}
 const results=await proveAppNeeds({surfaces,ready:async s=>{s.frame=s.page.mainFrame();},headless:async()=>({seats:DB.sql.prepare('SELECT count(*) n FROM tool_data').get().n}),plan:{needs:[
  {id:'race',statement:'Only one browser takes the last seat',steps:[{concurrent:surfaces.map(s=>({surface:s.name,selector:'button',forceClick:true}))}],assertions:[{mcp:{tool:'count'},equals:{seats:1},waitMs:2000}]},
  {id:'refuse',statement:'The server refuses even when the UI is bypassed',steps:[{surface:'phone',selector:'button',forceClick:true}],assertions:[{surface:'phone',selector:'#result',text:'full'}]},
  {id:'fallback',statement:'No WebGL still leaves a usable booking control',steps:[{surface:'phone',capabilities:{webgl:false}},{surface:'phone',selector:'button',forceClick:true}],assertions:[{surface:'phone',selector:'#graphics',text:'fallback'},{surface:'phone',selector:'#result',text:'full'}]}
 ]}});
 assert.ok(results.every(r=>r.status==='met'),JSON.stringify(results));
});

test('local restart requests need this dev credential and wait for its acknowledgement',async t=>{
 const {mkdtempSync,rmSync,writeFileSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createLocalCredential}=await import('../lib/local-test.mjs');const {requestDevRestart,takeDevRestart,acknowledgeDevRestart}=await import('../lib/dev-restart.mjs');
 const root=mkdtempSync(join(tmpdir(),'place-restart-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const secret=createLocalCredential(root);
 writeFileSync(join(root,'.studio','restart-request.json'),JSON.stringify({secret:'wrong',id:'fake'}));assert.equal(takeDevRestart(root,secret),null);
 await assert.rejects(()=>requestDevRestart(root,'https://place.test',{timeout:10}),/local dev/);
 const waiting=requestDevRestart(root,'http://localhost:8787',{timeout:1000});
 const id=takeDevRestart(root,secret);assert.ok(id);acknowledgeDevRestart(root,'another-run');
 acknowledgeDevRestart(root,id);await waiting;
 await assert.rejects(()=>requestDevRestart(root,'http://localhost:8787',{timeout:10}),/acknowledge/);
});
