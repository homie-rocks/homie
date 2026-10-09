/** The shipped rules/move, real Chrome paints and real WebSocket timers. Delay is added RTT; loss drops application frames. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { WebSocketServer } from 'ws';
import { findChrome, chromeArgs } from '../lib/chrome.mjs';
import { viewPlugin } from '../lib/rules-build.mjs';
import { NetRoom } from '../worker/room.mjs';
import { PKG, esbuildOf, loadGame, prepareRuntimeFixture } from './rules-kit.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const quantile = (values, p) => [...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)] ?? 0;

test('shipped starters: predicted 3D pose through delay and loss in two Chrome clients', {timeout:900000}, async t => {
  const scratch=realpathSync(mkdtempSync(join(tmpdir(),'homie-3d-feel-'))), receipts=[];
  const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});
  try {
    const esbuild=await esbuildOf();
    for(const id of ['gem-rush-3d','hero-rush-3d','ember-vale']) {
      if(process.env.ROOMS_3D_FEEL_GAME && process.env.ROOMS_3D_FEEL_GAME!==id) continue;
      const dir=join(PKG,'starters',id), game={id,dir,players:{max:8},room:{host:'server'}};
      const rules=await prepareRuntimeFixture(esbuild,scratch,game), L=await loadGame(scratch,dir,id);
      const compiled=L.R.compileRules(L.def,{map:L.R.compileMap(rules.map),tune:rules.tune,settings:rules.settings,seats:8});
      const entry=join(scratch,id+'.ts'), output=join(scratch,id+'.js');
      writeFileSync(entry,`export {openRoom} from ${JSON.stringify(join(PKG,'rules/view.ts'))};`);
      await esbuild.build({stdin:{contents:`import 'homie:game';export {openRoom} from ${JSON.stringify(entry)};`,resolveDir:scratch},bundle:true,format:'esm',outfile:output,plugins:[viewPlugin(game,rules,entry)],logLevel:'silent'});
      const bundle=readFileSync(output);
      for(const delay of [50,150,300]) for(const loss of [.02,.10]) await t.test(`${id} ${delay}ms ${loss*100}%`,async()=>{
        if(process.env.ROOMS_3D_FEEL_DELAY && delay!==Number(process.env.ROOMS_3D_FEEL_DELAY))return;
        let rng=417;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
        const timers=new Set(), contexts=[];
        function shape(text,send){const m=JSON.parse(text), shaped=['in','snap'].includes(m.t);if(shaped&&random()<loss)return;const timer=setTimeout(()=>{timers.delete(timer);send(text)},delay/2*(.75+random()*.5));timers.add(timer);}
        const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/view.js'?'text/javascript':'text/html');res.end(req.url==='/view.js'?bundle:'<canvas width="800" height="600"></canvas><script type="module">import {openRoom} from "/view.js";window.openRoom=openRoom;</script>')});
        const sockets=new WebSocketServer({server}), relay=new NetRoom({code:'r',rules:true,maxPlayers:8,tickHz:20});
        sockets.on('connection',socket=>{const wire=relay.attach({send:text=>shape(text,x=>{if(socket.readyState===1)socket.send(x)}),close:(c,w)=>socket.close(c,w),buffered:()=>socket.bufferedAmount});socket.on('message',text=>shape(String(text),x=>wire.onMessage(x)));socket.on('close',()=>wire.onClose());});
        const host=L.H.createHost({game:id,compiled,send:m=>relay.hostFrame(m),random:()=>.37,clock:{now:Date.now,setTimer:setTimeout,clearTimer:clearTimeout}});relay.setServerHost(host);
        const beat=setInterval(()=>relay.tick(),250);server.listen(0,'127.0.0.1');await once(server,'listening');
        try {
          const pages=[];
          for(let n=0;n<2;n++) {
            const context=await browser.createBrowserContext();contexts.push(context);const page=await context.newPage();pages.push(page);
            await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction('window.openRoom');
            await page.evaluate(({n,id})=>{
              window.room=openRoom({net:{config:{v:1,url:location.origin.replace('http','ws')+'/socket',room:'r',device:'desk',want:'play',name:'P'+n},post:null}});
              window.samples=[];window.responses=[];window.pressed=[];window.started=0;window.pending=null;window.lastLeg=-1;window.ax=0;window.ay=0;
              const ctx=document.querySelector('canvas').getContext('2d');
              function frame(t){
                if(started)room.input({ax,ay});
                const me=room.me;if(me){
                  if(pending){pending.frames++;if(Math.hypot(me.pos.x-pending.x,me.pos.y-pending.y,me.pos.z-pending.z)>.000001){responses.push({frames:pending.frames,ms:performance.now()-pending.at});pending=null;}}
                  let other=null;room.each(id==='ember-vale'?'hero':'runner',e=>{if(e.driver==='person'&&!e.mine)other={pos:e.pos,heading:e.heading,grounded:e.grounded};});
                  if(started)samples.push({t,at:performance.now(),pos:me.pos,heading:me.heading,grounded:me.grounded,other});
                  ctx.clearRect(0,0,800,600);ctx.fillStyle='#3b9061';ctx.fillRect(me.pos.x*25,me.pos.y*25-me.pos.z*30,12,12);
                }requestAnimationFrame(frame);
              }requestAnimationFrame(frame);
              window.begin=()=>{
                samples=[];responses=[];started=performance.now();lastLeg=-1;
                const change=()=>{const a=(++lastLeg)%4*Math.PI/2;ax=Math.round(Math.cos(a)*100);ay=Math.round(Math.sin(a)*100);const b=room.me;
                  if(b)pending={at:performance.now(),x:b.pos.x,y:b.pos.y,z:b.pos.z,frames:0};
                  room.input({ax,ay,jump:id==='hero-rush-3d',wave:id==='gem-rush-3d',strike:id==='ember-vale',swing:id==='hero-rush-3d'});
                };change();setInterval(change,900);
              };
            },{n,id});
            await page.waitForFunction('room.me && room.status === "playing"',{timeout:15000});
          }
          await sleep(12000);const startup=await pages[1].evaluate(()=>__homieNet.probe.prediction());
          for(const p of pages)await p.evaluate(()=>begin());await sleep(12000);
          const results=await Promise.all(pages.map(p=>p.evaluate(()=>({samples,responses,prediction:__homieNet.probe.prediction()}))));
          const r=results[1], gaps=r.samples.slice(1).map((s,i)=>s.t-r.samples[i].t);
          const steps=r.samples.slice(1).map((s,i)=>({distance:Math.hypot(s.pos.x-r.samples[i].pos.x,s.pos.y-r.samples[i].pos.y,s.pos.z-r.samples[i].pos.z),ms:s.at-r.samples[i].at}));
          const heights=r.samples.map(s=>s.pos.z), remote=r.samples.filter(s=>s.other), landings=r.samples.slice(1).filter((s,i)=>s.grounded&&!r.samples[i].grounded).length;
          const row={id,delay,loss:loss*100,responses:r.responses,inputFrames:quantile(r.responses.map(x=>x.frames),.95),inputMs:quantile(r.responses.map(x=>x.ms),.95),frameP95Ms:quantile(gaps,.95),fps:1000/quantile(gaps,.5),corrections:r.prediction.count,maxCorrectionM:r.prediction.max,snaps:r.prediction.snaps,rebases:r.prediction.rebases-startup.rebases,maxStepM:Math.max(...steps.map(s=>s.distance)),peakM:Math.max(...heights),landings,remoteSamples:remote.length,remotePeakM:Math.max(...remote.map(s=>s.other.pos.z)),host:host.facts()};
          receipts.push(row);t.diagnostic(JSON.stringify(row));if(process.env.ROOMS_3D_FEEL_RECEIPT)writeFileSync(process.env.ROOMS_3D_FEEL_RECEIPT,JSON.stringify(receipts,null,2));
          assert.ok(r.responses.length>=10);assert.equal(row.inputFrames,1,'first drawing frame responds');assert.equal(row.snaps,0,'ordinary corrections are eased');assert.equal(row.rebases,0,'steady calibrated clock');
          assert.ok(steps.every(s=>s.distance<=32*s.ms/1000+.10),'continuous position through movement, knockback and landing: '+JSON.stringify(row));
          assert.ok(remote.length>100,'other person has interpolated poses');
          for(const s of r.samples)assert.ok(Math.abs(Math.hypot(s.heading.x,s.heading.y,s.heading.z)-1)<.001,'facing remains a unit direction');
          if(id==='hero-rush-3d'){assert.ok(row.peakM>.8);assert.ok(landings>=5);assert.ok(row.remotePeakM>.5);}
        } finally {
          for(const c of contexts)await c.close();host.stop();clearInterval(beat);for(const timer of timers)clearTimeout(timer);
          for(const s of sockets.clients)s.terminate();sockets.close();server.closeAllConnections();await new Promise(r=>server.close(r));
        }
      });
    }
  } finally {await browser.close();rmSync(scratch,{recursive:true,force:true});}
});
