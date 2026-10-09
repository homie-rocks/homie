/** Real timers and Chrome paints; application-frame shaping on real WebSockets, with a seeded jitter/loss stream. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { WebSocketServer } from 'ws';
import { findChrome, chromeArgs } from '../lib/chrome.mjs';
import { viewPlugin } from '../lib/rules-build.mjs';
import { NetRoom } from '../worker/room.mjs';
import { PKG, esbuildOf, loadGame, writeGame, prepareRuntimeFixture } from './rules-kit.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const source = `import {defineRules, f} from '@homie-rocks/studio/rules'; import {move} from './move';
export default defineRules({ contract:2, space:{dims:2}, move,
shapes:{commands:{bump:{}},effects:{hit:{},answer:{n:f.u16()}}},
entities:{runner:{player:true,fields:{actions:f.u16()},input:{ax:f.i8(),ay:f.i8(),fire:f.press()},motion:{push:f.ticks()},body:{shape:'circle',radius:.5,maxSpeed:6},
tick(world,self){if(self.input.fire){self.actions+=1;world.emit('answer',self.id,{n:self.actions});}},
commands:{bump(world,self){self.motion.push=world.ticks(.4);world.emit('hit',self.id,{});}}}},
room:{bots:{keep:0},join(ctx,p){return {kind:'runner',at:{x:p.seat*10,y:p.seat*10,z:0}}}},map:'./map'});`;
const move = `import {defineMove} from '@homie-rocks/studio/rules'; export const move=defineMove({runner(b,i,c){
b.vel={x:i.ax/127*6,y:i.ay/127*6,z:0}; if(b.motion.push>0){b.motion.push-=1;b.vel={x:0,y:12,z:0};}
c.map.sweep(b,c.math.scale(b.vel,c.dt));}});`;
const q = (v, p) => [...v].sort((a,b)=>a-b)[Math.floor((v.length-1)*p)] ?? 0;

test('Chrome prediction: delay, jitter and loss at all supported tick rates and both hosts', { timeout: 1800000 }, async t => {
  if (!findChrome()) return t.skip('Set CHROME_PATH for the real Chrome feel matrix');
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-prediction-')));
  const browser = await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});
  const esbuild = await esbuildOf(), receipts=[];
  try {
    for (const hz of (process.env.ROOMS_FEEL_ACTIONS ? [20] : [20,30,60])) for (const mode of (process.env.ROOMS_FEEL_ACTIONS ? ['server'] : ['server','browser'])) {
      if(process.env.ROOMS_FEEL_FILTER && !process.env.ROOMS_FEEL_FILTER.includes(`${hz}-${mode}`))continue;
      const id=`prediction-${hz}-${mode}`, dir=writeGame(scratch,id,{rules:source,move});
      mkdirSync(join(dir,'map'));writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-1000,-1000],max:[1000,1000]}}));
      const game={id,dir,players:{max:2},room:{host:mode,tickHz:hz}};
      const rules=await prepareRuntimeFixture(esbuild,scratch,game), L=await loadGame(scratch,dir,id);
      const compiled=L.R.compileRules(L.def,{map:L.R.compileMap(rules.map),settings:rules.settings,seats:2});
      const entry=join(scratch,id+'.ts'), output=join(scratch,id+'.js');
      writeFileSync(entry,`export {openRoom} from ${JSON.stringify(join(PKG,'rules/view.ts'))};`);
      await esbuild.build({stdin:{contents:`import 'homie:game';export {openRoom} from ${JSON.stringify(entry)};`,resolveDir:scratch},bundle:true,format:'esm',outfile:output,plugins:[viewPlugin(game,rules,entry)],logLevel:'silent'});
      const bundle=readFileSync(output);
      for (const delay of (process.env.ROOMS_FEEL_ACTIONS ? [90] : hz === 20 && mode === 'server' ? [50,90,150,300] : [50,150,300])) for (const loss of (delay === 90 ? [0] : [0.02,0.10])) await t.test(`${delay}ms ${loss*100}% ${hz}Hz ${mode}`,async caseTest=>{
        if(process.env.ROOMS_FEEL_FILTER && delay!==Number(process.env.ROOMS_FEEL_DELAY ?? 300))return caseTest.skip('focused development run');
        let rng=417; const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
        const timers=new Set(), contexts=[];
        function shape(text,send){
          const m=JSON.parse(text), shaped=['in','snap'].includes(m.t);
          if(shaped&&random()<loss)return;
          const ms=delay/2*(shaped&&delay!==90?0.75+random()*0.5:1);
          const timer=setTimeout(()=>{timers.delete(timer);send(text)},ms);timers.add(timer);
        }
        const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/view.js'?'text/javascript':'text/html');res.end(req.url==='/view.js'?bundle:'<canvas width="800" height="600"></canvas><script type="module">import {openRoom} from "/view.js";window.openRoom=openRoom;</script>')});
        const sockets=new WebSocketServer({server}), relay=new NetRoom({code:'r',rules:true,maxPlayers:2,tickHz:hz});
        sockets.on('connection',socket=>{
          const wire=relay.attach({send:text=>shape(text,x=>{if(socket.readyState===1)socket.send(x)}),close:(c,w)=>socket.close(c,w),buffered:()=>socket.bufferedAmount});
          socket.on('message',text=>shape(String(text),x=>wire.onMessage(x)));socket.on('close',()=>wire.onClose());
        });
        let host=null;
        if(mode==='server'){host=L.H.createHost({game:id,compiled,send:m=>relay.hostFrame(m),random:()=>.37,clock:{now:Date.now,setTimer:setTimeout,clearTimer:clearTimeout}});relay.setServerHost(host);}
        const beat=setInterval(()=>relay.tick(),250);server.listen(0,'127.0.0.1');await once(server,'listening');
        try{
          const pages=[];
          for(let n=0;n<2;n++){
            const context=await browser.createBrowserContext();contexts.push(context);const page=await context.newPage();pages.push(page);
            await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction('window.openRoom');
            await page.evaluate(n=>{
              window.room=openRoom({screenBasis:n===1?()=>({right:[1,0],up:[0,-1]}):undefined,net:{config:{v:1,url:location.origin.replace('http','ws')+'/socket',room:'r',device:'desk',want:'play',name:'P'+n},post:null}});
              window.answers=[];room.on('answer',e=>answers.push({n:e.n,at:Date.now()}));
              window.samples=[];window.latencies=[];window.latencyFrames=[];window.pendingPaint=null;window.dx=0;
              const ctx=document.querySelector('canvas').getContext('2d');
              function frame(t){if(window.latePaint && ++window.paintN%2===0){const until=performance.now()+window.latePaint;while(performance.now()<until){}}room.input({ax:dx,ay:0});const me=room.me;const at=performance.now();
                let other=null;room.each('runner',e=>{if(!e.mine)other=e.pos.x});
                if(me){ctx.clearRect(0,0,800,600);ctx.fillRect(400+me.pos.x%300,300+me.pos.y%250,12,12);
                  if(pendingPaint)pendingPaint.frames++;
                  if(pendingPaint&&Math.abs(me.pos.x-pendingPaint.x)>0.00001){latencyFrames.push(pendingPaint.frames);latencies.push(performance.now()-pendingPaint.at);pendingPaint=null;}
                  samples.push({t,at,x:me.pos.x,y:me.pos.y,other,prediction:__homieNet.probe.prediction()});}
                requestAnimationFrame(frame);
              }requestAnimationFrame(frame);
              window.change=()=>{const me=room.me;samples=[];dx=127;pendingPaint={x:me.pos.x,at:performance.now(),frames:0};room.input({ax:127,ay:0});};
            },n);
            // Two cases deliberately run alternating callbacks late, as a busy software renderer does.
            if (n === 1 && mode === 'server' && delay === 50 && ((hz === 20 && loss === 0.02) || (hz === 30 && loss === 0.1))) await page.evaluate(ms=>{window.latePaint=ms;window.paintN=0;}, hz === 20 ? 12 : 21);
            await page.waitForFunction('room.me && room.status === "playing"',{timeout:15000});
          }
          await sleep(12000);
          const startup = await pages[1].evaluate(()=>__homieNet.probe.prediction());
          for(const page of pages) await page.evaluate(()=>change());
          await sleep(12000);
          const ordinary=await pages[1].evaluate(()=>({latencies,latencyFrames,samples,prediction:__homieNet.probe.prediction()}));
          const portBefore = await pages[1].evaluate(()=>__homiePort.rows().at(-1));
          await pages[1].evaluate(()=>room.command('bump'));await sleep(1800);
          const after=await pages[1].evaluate(()=>({prediction:__homieNet.probe.prediction(),y:room.me.pos.y,samples:samples.slice()}));
          const portAfter = await pages[1].evaluate(()=>__homiePort.rows().at(-1));
          const screenDown = -((portAfter[1]-portBefore[1])*portBefore[5] + (portAfter[2]-portBefore[2])*portBefore[6]);
          assert.ok(screenDown > 1, 'a downward push in a Y-down canvas is reported downward by the rules probe');
          const pushed=after.samples.filter(s=>s.t>=ordinary.samples.at(-1).t);
          // The pose uses performance.now(), not rAF's earlier frame timestamp. Judge its speed on
          // the same clock: a late callback can sample 29 ms of movement in a nominal 16.7 ms frame.
          const pushSteps=pushed.slice(1).map((s,i)=>({distance:Math.hypot(s.x-pushed[i].x,s.y-pushed[i].y),ms:s.at-pushed[i].at, frameMs:s.t-pushed[i].t, before:{x:pushed[i].x,y:pushed[i].y,prediction:pushed[i].prediction}, after:{x:s.x,y:s.y,prediction:s.prediction}}));
          const deltas=ordinary.samples.slice(1).map((s,i)=>s.x-ordinary.samples[i].x);
          const others=ordinary.samples.slice(1).map((s,i)=>s.other-ordinary.samples[i].other);
          const gaps=ordinary.samples.slice(1).map((s,i)=>s.t-ordinary.samples[i].t);
          if(process.env.ROOMS_FEEL_FILTER || deltas.some(x=>x<-.01))writeFileSync(`/tmp/prediction-${hz}-${mode}-${loss}.json`,JSON.stringify(ordinary));
          const row={startupRebases:startup.rebases,rebases:ordinary.prediction.rebases-startup.rebases,delay,loss:loss*100,hz,host:mode,inputFrames:q(ordinary.latencyFrames,.95),inputMs:q(ordinary.latencies,.95),frameMs:q(gaps,.95),corrections:ordinary.prediction.count,ordinaryCatches:ordinary.prediction.catches,maxCorrectionM:ordinary.prediction.max,backwards:deltas.filter(x=>x<-.01).length,minStepM:Math.min(...deltas),otherStepP95M:q(others,.95),otherMinStepM:Math.min(...others),otherMaxStepM:Math.max(...others),otherBackwards:others.filter(x=>x<-.01).length,otherHeldPercent:100*others.filter(x=>Math.abs(x)<.00001).length/others.length,catches:after.prediction.catches,snaps:after.prediction.snaps,pushMaxStepM:Math.max(...pushSteps.map(s=>s.distance))};
          if(delay===90){
            const sent=await pages[0].evaluate(async()=>{
              const stamps=[];
              for(let i=0;i<30;i++){stamps.push(Date.now());room.input({ax:dx,ay:0,fire:true});await new Promise(r=>setTimeout(r,177));}
              return stamps;
            });
            await sleep(600);
            const own=await pages[0].evaluate(()=>answers),other=await pages[1].evaluate(()=>answers);
            const times=list=>list.map(e=>e.at-sent[e.n-1]).filter(Number.isFinite);
            const a=times(own),b=times(other);
            assert.equal(a.length,30);assert.equal(b.length,30);
            Object.assign(row,{actionOwnP50:q(a,.5),actionOwnP95:q(a,.95),actionOtherP50:q(b,.5),actionOtherP95:q(b,.95)});
            assert.ok(row.actionOwnP50<170&&row.actionOwnP95<220,JSON.stringify(row));
            assert.ok(row.actionOtherP50<280&&row.actionOtherP95<350,JSON.stringify(row));
          }
          receipts.push(row);t.diagnostic(JSON.stringify(row));
          if(process.env.ROOMS_FEEL_RECEIPT)writeFileSync(process.env.ROOMS_FEEL_RECEIPT,JSON.stringify(receipts,null,2)+'\n');
          assert.ok(ordinary.latencies.length,'input reached a drawn frame');
          assert.equal(row.inputFrames,1,'movement responds on the first drawing frame after input');
          assert.ok(row.inputMs <= Math.max(35,row.frameMs+10),`input took ${row.inputMs}ms against frame ${row.frameMs}ms`);
          assert.equal(row.backwards,0,'steady movement does not rubber-band: '+JSON.stringify(row));
          assert.equal(row.rebases,0,'the calibrated clock stays steady');
          assert.equal(row.snaps,0,'ordinary corrections and an unseen push do not teleport');
          assert.ok(after.y>12,'the authoritative collision wins');
          assert.ok(pushSteps.every(s=>s.distance<=21*s.ms/1000+.05),'the unseen push follows a continuous path: '+JSON.stringify({ ...row, failed: pushSteps.filter(s=>s.distance>21*s.ms/1000+.05).slice(0,5) }));
        }finally{
          for(const c of contexts)await c.close();host?.stop();clearInterval(beat);for(const timer of timers)clearTimeout(timer);
          for(const s of sockets.clients)s.terminate();sockets.close();server.closeAllConnections();await new Promise(r=>server.close(r));
        }
      });
    }
    if(process.env.ROOMS_FEEL_RECEIPT)writeFileSync(process.env.ROOMS_FEEL_RECEIPT,JSON.stringify(receipts,null,2)+'\n');
  }finally{await browser.close();rmSync(scratch,{recursive:true,force:true});}
});
