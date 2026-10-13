import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {physicsKit} from './physics-rules-kit.mjs';
import {virtualTime} from './virtual-time.mjs';
import {predictionShaper} from './prediction-shaper.mjs';
import {NetRoom} from '../worker/room.mjs';
for(const loss of [0,.08])test(`physics prediction: two views, 150ms each way, loss ${loss}, settles exactly`,async t=>{
 const root=mkdtempSync('/tmp/homie-physics-prediction-');t.after(()=>rmSync(root,{recursive:true,force:true}));
 const {L,compiled,openRoom}=await physicsKit(root);
 const clock=virtualTime(t),shape=predictionShaper({delay:300,loss,seed:480});
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
 const views=['Ada','Bo'].map(name=>{const view=openRoom({net:{config:{v:1,url:'ws://relay/arena/__net?room=r',room:'r',device:'desk',want:'play',name},WebSocketImpl:Socket,post:null}});probes.push(globalThis.__homieNet.probe.prediction);return view;});
 t.after(()=>{views.forEach(v=>v.close());clearInterval(beat);host.stop();});
 await clock.wait(2500);assert.ok(views.every(v=>v.me));
 for(let k=0;k<8;k++){views.forEach((v,i)=>v.input({ax:k%2?-.5:.5,ay:i?.3:0,jump:k%3===0}));await clock.wait(250);views.forEach(v=>v.me);}
 views.forEach(v=>v.input({ax:0,ay:0,jump:false}));await clock.wait(5000);
 for(const v of views){const p=v.me.pos,row=host.core.save().ents.find(e=>e[0]===v.me.id);assert.deepEqual(p,{x:row[7][0],y:row[7][1],z:row[7][2]});}
 assert.equal(host.core.stats.errors,0,host.core.stats.lastError);assert.equal(host.core.stats.budgetStops,0);
 t.diagnostic(JSON.stringify({stats:host.core.stats,prediction:probes.map(p=>p())}));
});
