import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {physicsKit} from './physics-rules-kit.mjs';
import {virtualTime} from './virtual-time.mjs';
import {predictionShaper} from './prediction-shaper.mjs';
import {NetRoom} from '../worker/room.mjs';
for(const {loss,delay,seed,measure} of [{loss:0,delay:300,seed:480},{loss:.08,delay:300,seed:480},{loss:.02,delay:160,seed:48101,measure:true}])test(`physics prediction: two views, ${delay/2}ms each way, loss ${loss}, seed ${seed}${measure?', zero warps':''}, settles exactly`,async t=>{
 const root=mkdtempSync('/tmp/homie-physics-prediction-');t.after(()=>rmSync(root,{recursive:true,force:true}));
 const {L,compiled,openRoom}=await physicsKit(root);
 const clock=virtualTime(t),shaper=predictionShaper({delay,loss,seed});
 const dropped={in:0,snap:0};
 const shape=(message,link)=>{const ms=shaper(message,link);if(ms===null)dropped[message.t]++;return ms;};
 const relay=new NetRoom({code:'r',rules:true,maxPlayers:8,tickHz:20});
 const host=L.H.createHost({game:'arena',compiled,random:()=>.37,send:(m,text)=>relay.hostFrame(m,text),clock:{now:()=>Date.now(),setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:h=>clearTimeout(h)}});
 relay.setServerHost(host);const beat=setInterval(()=>relay.tick(),250);
 let link=0;
 class Socket {
  constructor(){this.readyState=0;this.bufferedAmount=0;this.link=link++;this.h=relay.attach({send:text=>{const delay=shape(JSON.parse(text),this.link);if(delay!==null)setTimeout(()=>{if(this.readyState===1)this.onmessage?.({data:text});},delay);},close:()=>this.close(),buffered:()=>0});setTimeout(()=>{this.readyState=1;this.onopen?.({});},0);}
  send(text){const delay=shape(JSON.parse(text),this.link);if(delay!==null)setTimeout(()=>this.h.onMessage(text),delay);}
  close(){if(this.readyState===3)return;this.readyState=3;this.h.onClose();}
 }
 const probes=[];
 let reads=0;
 const views=['Ada','Bo'].map(name=>{let view;view=openRoom({...measure?{predict:{runner(){if(view?.me){view.each('runner',()=>reads++);view.get(view.me.id);}}}}:{},net:{config:{v:1,url:'ws://relay/arena/__net?room=r',room:'r',device:'desk',want:'play',name},WebSocketImpl:Socket,post:null}});probes.push(globalThis.__homieNet.probe.prediction);return view;});
 t.after(()=>{views.forEach(v=>v.close());clearInterval(beat);host.stop();});
 await clock.wait(2500);assert.ok(views.every(v=>v.me));
 const warps=[],previous=views.map(v=>({...v.me.pos})),travel=views.map(()=>0);let frames=0;
 const frame=async ms=>{
  for(let left=ms;left>0;){
   const dt=Math.min(left,16);views.forEach(v=>v.pump());await clock.wait(dt);
   views.forEach((v,i)=>{
    const p=v.me.pos,before=previous[i];
    const horizontal=Math.hypot(p.x-before.x,p.y-before.y);
    const distance=Math.hypot(p.x-before.x,p.y-before.y,p.z-before.z);
    // The held axes cap horizontal speed; maxSpeed bounds jumping/falling.
    // Allow 5 cm for tick phase and quantization, below one full running tick.
    if(horizontal>5*Math.hypot(.5,.3)*dt/1000+.05||distance>30*dt/1000+.05)
     warps.push({frame:frames,i,before,p:{...p},prediction:probes[i]()});
    travel[i]+=horizontal;previous[i]={...p};
   });
   frames++;left-=dt;
  }
 };
 const wait=measure?frame:ms=>clock.wait(ms);
 for(let k=0;k<(measure?40:8);k++){views.forEach((v,i)=>v.input({ax:k%2?-.5:.5,ay:i?.3:0,jump:k%3===0}));await wait(250);views.forEach(v=>v.me);}
 views.forEach(v=>v.input({ax:0,ay:0,jump:false}));await wait(5000);
 for(const v of views){const p=v.me.pos,row=host.core.save().ents.find(e=>e[0]===v.me.id);assert.deepEqual(p,{x:row[7][0],y:row[7][1],z:row[7][2]});}
 if(measure){assert.ok(dropped.in>0&&dropped.snap>0,'seed drops both input frames and snapshots');assert.ok(travel.every(m=>m>5),'both bodies actually traverse the physics world');assert.ok(reads>100,'predictor room reads execute during physics replay');assert.ok(frames>900);assert.equal(warps.length,0,JSON.stringify(warps.slice(0,5)));for(const probe of probes)assert.ok(probe().applications.length>0,'physics input receives application ticks');}
 assert.equal(host.core.stats.errors,0,host.core.stats.lastError);assert.equal(host.core.stats.budgetStops,0);
 t.diagnostic(JSON.stringify({stats:host.core.stats,prediction:probes.map(p=>p())}));
});
