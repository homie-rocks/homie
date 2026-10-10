/** Real-time LOCAL load experiment. No deployment. Deliberately outside the
 * deterministic release gate; invoked by test:rules:extended. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import puppeteer from 'puppeteer-core';
import { Gate, Concentrator, multiplexSession, roomLayout } from '../worker/gate.mjs';
import { NetRoom } from '../worker/room.mjs';
import { snapshotDecoder } from '../rules/interest.mjs';
import { writeGame, loadGame } from './rules-kit.mjs';
import { findChrome, chromeArgs } from '../lib/chrome.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function pair() {
  const make = () => ({ listeners: new Map(), dead: false, accept() {}, addEventListener(t, f) { const l = this.listeners.get(t) ?? []; l.push(f); this.listeners.set(t, l); }, emit(t, e) { for (const f of this.listeners.get(t) ?? []) f(e); }, send(data) { if (this.dead) throw new Error('closed'); this.other.emit('message', { data }); }, close() { if (this.dead) return; this.dead = this.other.dead = true; this.emit('close', {}); this.other.emit('close', {}); } });
  const a = make(), b = make(); a.other = b; b.other = a; return [a,b];
}
export async function crowdLocal({ seats = 300, seconds = 15, browsers = 4 } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'homie-crowd-local-'));
  const gates = new Map(), concentrators = new Map(), links = [], clients = [], contexts = [], tickTimes = [];
  let host, browser, server, sockets, beat, collecting = false, bytes = 0, peakHeap = 0, peakRSS = 0, fatal = null;
  const layout = roomLayout(seats), browserReceipts = new Map();
  let room = new NetRoom({ code:'crowd', rules:true, maxPlayers:seats, tickHz:20, perIp:0 });
  const clientCode = `import {snapshotDecoder} from '/codec.js';
    const decoder=snapshotDecoder();let token=null,socket,epoch=0,tick=0,seat=null,seed=901;
    window.receipt={joined:0,snapshots:0,seat:null,tick:0};
    function open(){socket=new WebSocket(location.origin.replace('http','ws')+'/net?browser=1');
      socket.onopen=()=>socket.send(JSON.stringify({t:'hello',v:1,rev:12,rules:true,want:'play',device:'desk',name:'Browser',token}));
      socket.onclose=()=>setTimeout(open,100);
      socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.t==='welcome'){token=m.token;seat=m.seat;epoch=m.e;decoder.reset();window.receipt.joined++;window.receipt.seat=seat;}
        const s=m.t==='snap'?decoder.decode(m):m.t==='welcome'&&m.snap?decoder.decode(m.snap):null;
        if(s){epoch=s.e;tick=s.k;window.receipt.snapshots++;window.receipt.tick=tick;window.receipt.epoch=epoch;window.receipt.own=s.d[1].some(e=>e[9]===seat);const c=document.querySelector('canvas').getContext('2d');c.clearRect(0,0,400,400);for(const e of s.d[1]){c.fillStyle=e[9]===seat?'red':'blue';c.fillRect(e[3][0]*3+10,e[3][1]*3+10,4,4);}}};}open();
    setInterval(()=>{if(socket?.readyState===1){seed=(Math.imul(seed,1664525)+1013904223)>>>0;socket.send(JSON.stringify({t:'in',e:epoch,k:tick,s:[[1,seed%2?127:-127]],r:0}));}},50);
    setInterval(()=>{if(socket?.readyState===1)socket.send(JSON.stringify({t:'ping',c:Date.now()}));},1000);
    setInterval(()=>{fetch('/receipt',{method:'POST',body:JSON.stringify(window.receipt)}).catch(()=>{});},500);`;
  try {
    const game = writeGame(scratch, 'crowd', {
      rules: `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';export default defineRules({contract:2,space:{dims:2},move,entities:{runner:{player:true,fields:{steps:f.u32()},input:{ax:f.i8()},body:{shape:'circle',radius:.4,maxSpeed:2},tick(w,s){s.steps+=1;}}},room:{rounds:{seconds:600,breakSeconds:1},bots:{keep:0},join(c,p){return {kind:'runner',at:{x:(p.seat%20)*4,y:Math.floor(p.seat/20)*4,z:0}}}}});`,
      move: `import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){b.vel={x:i.ax/127*2,y:0,z:0};b.pos=c.math.add(b.pos,c.math.scale(b.vel,c.dt));}});`,
    });
    const L = await loadGame(scratch,game);
    const compiled = L.R.compileRules(L.def,{ seats,map:L.R.compileMap({bounds:{min:[-100,-100],max:[300,300]}}),settings:L.R.roomSettings({view:{radiusM:12,precisionM:.01,nearM:4,farHz:5},budget:{tick:5_000_000}}).settings });
    const start = (restore) => {
      let tickStart=null;
      const clock = { now:Date.now,setTimer:setTimeout,clearTimer:clearTimeout };
      host = L.H.createHost({game:'crowd',compiled,clock,random:()=>.375,onTick:()=>{tickStart=performance.now();},...(restore?{restore,restoreEpoch:host.epoch+1}:{}),send:(m,text)=>{room.hostFrame(m,text);if(m.t==='snap'&&tickStart!==null){if(collecting)tickTimes.push(performance.now()-tickStart);tickStart=null;}}});
      room.setServerHost(host);
    };
    start();
    const env = { TABLE:{idFromName:n=>n,get:()=>({fetch:async()=>{const [a,b]=pair();links.push(a);multiplexSession(b,async(req,socket)=>{const h=room.attach({send:text=>socket.send(text),close:(c,r)=>socket.close(c,r),buffered:()=>0,ip:'local-carrier'});socket.addEventListener('message',e=>h.onMessage(e.data));socket.addEventListener('close',()=>h.onClose());});return {webSocket:a};}})} };
    env.CONCENTRATOR={idFromName:n=>n,get:name=>({fetch:async req=>{let c=concentrators.get(name);if(!c){c=new Concentrator({},env);concentrators.set(name,c);}const [a,b]=pair();links.push(a);multiplexSession(b,(r,s)=>c.connect(r,s));return {webSocket:a};}})};
    server=createServer((req,res)=>{if(req.url==='/receipt'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{const receipt=JSON.parse(body);if(receipt.seat!==null)browserReceipts.set(receipt.seat,{...receipt,receivedAt:Date.now()});res.writeHead(204);res.end();});return;}res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript':'text/html');res.end(req.url==='/codec.js'?readFileSync(new URL('../rules/interest.mjs',import.meta.url),'utf8'):req.url==='/client.js'?clientCode:'<canvas width="400" height="400"></canvas><script type="module" src="/client.js"></script>');});
    sockets=new WebSocketServer({server});let index=0;
    sockets.on('connection',async(socket)=>{
      const gateIndex=index++%layout.gates;
      let gate=gates.get(gateIndex);if(!gate){gate=new Gate({},env);gates.set(gateIndex,gate);}
      const queued=[];const hold=data=>queued.push(String(data));socket.on('message',hold);
      const transport={send:text=>{if(collecting)bytes+=Buffer.byteLength(text);socket.send(text);},close:(c,r)=>socket.close(c,r),addEventListener:(t,f)=>socket.on(t,t==='message'?data=>f({data:String(data)}):f)};
      await gate.connect(new Request(`https://table/__net?game=crowd&room=crowd&max=${seats}&gate=${gateIndex}&gates=${layout.gates}`),transport);
      socket.off('message',hold);for(const data of queued)socket.emit('message',Buffer.from(data));
    });
    server.listen({port:0,host:'127.0.0.1',backlog:4096});await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
    function simulated(n) {
      const c={token:null,seat:null,latest:null,joined:0,decoder:snapshotDecoder(),seed:901+n,stopped:false,closes:[],errors:[]};
      c.open=()=>{if(c.stopped)return;const ws=c.ws=new WebSocket(origin.replace('http','ws')+'/net');ws.on('error',error=>{c.errors.push({socket:error.message});});ws.on('open',()=>ws.send(JSON.stringify({t:'hello',v:1,rev:12,rules:true,want:'play',device:'desk',name:`Sim${n}`,token:c.token})));ws.on('close',(code,reason)=>{c.closes.push([code,String(reason)]);if(!c.stopped)setTimeout(c.open,100+(n*137)%2000);});ws.on('message',text=>{const m=JSON.parse(text);if(m.t==='error')c.errors.push(m);if(m.t==='welcome'){if(c.seat!==null&&m.seat!==c.seat)fatal=new Error(`seat changed for Sim${n}: ${c.seat} to ${m.seat}`);c.seat=m.seat;c.token=m.token;c.joined++;c.decoder.reset();}const s=m.t==='snap'?c.decoder.decode(m):m.t==='welcome'&&m.snap?c.decoder.decode(m.snap):null;if(s)c.latest=s;});};c.open();return c;
    }
    if(browsers){browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});for(let n=0;n<browsers;n++){const context=await browser.createBrowserContext();contexts.push(context);const page=await context.newPage();await page.goto(origin);}}
    beat=setInterval(()=>{room.tick();for(const c of clients)if(c.ws.readyState===1){c.seed=(Math.imul(c.seed,1664525)+1013904223)>>>0;c.ws.send(JSON.stringify({t:'in',e:c.latest?.e??host.epoch,k:c.latest?.k??host.tick,s:[[1,c.seed%2?127:-127]],r:0}));if(host.tick%20===0)c.ws.send(JSON.stringify({t:'ping',c:Date.now()}));}const m=process.memoryUsage();peakHeap=Math.max(peakHeap,m.heapUsed);peakRSS=Math.max(peakRSS,m.rss);},50);
    for(let n=0;n<seats-browsers;n++){clients.push(simulated(n));if(n%20===19){const admitted=Date.now()+30000;while(clients.slice(-20).some(c=>!c.joined)&&Date.now()<admitted)await sleep(20);}if(n%100===99)console.error(JSON.stringify({phase:'joining',started:n+1,people:host.people}));}
    const deadline=Date.now()+60000;while(host.people!==seats&&Date.now()<deadline)await sleep(50);assert.equal(host.people,seats,JSON.stringify({people:host.people,clients:clients.filter(c=>c.seat===null||c.closes.length).slice(0,8).map(c=>({seat:c.seat,joined:c.joined,closes:c.closes.slice(-3),errors:c.errors.slice(-3)}))}));
    console.error(JSON.stringify({phase:'joined',people:host.people}));
    await sleep(1000);collecting=true;
    const round=host.core.snapshot()[0]; assert.equal(round[1],1);
    const begin=performance.now(),firstTick=host.tick;await sleep(seconds*1000/3);
    const steady={seconds:(performance.now()-begin)/1000,bytesPerPlayerSecond:bytes/seats/((performance.now()-begin)/1000)};
    // Abrupt Gate link loss: all its clients must resume their original seats.
    const gate=gates.get(0);const beforeGate=clients.reduce((n,c)=>n+c.joined,0);const gateLost=performance.now();gate.link.disconnect();console.error(JSON.stringify({phase:'gate-lost',people:host.people}));
    await sleep(seconds*1000/3);assert.ok(clients.reduce((n,c)=>n+c.joined,0)>beforeGate);
    const gateDeadline=Date.now()+60000;while(host.people!==seats&&Date.now()<gateDeadline)await sleep(50);
    assert.equal(host.people,seats,'all seats return after Gate death');const gateRecoveryCheckedMs=performance.now()-gateLost;console.error(JSON.stringify({phase:'gate-returned',people:host.people}));
    // Churn uses the same resume credentials, never allocates a second body.
    for(const c of clients.slice(0,Math.ceil(seats*.05)))c.ws.close();
    await sleep(500);
    const churnDeadline=Date.now()+60000;while(host.people!==seats&&Date.now()<churnDeadline)await sleep(50);
    assert.equal(host.people,seats,'all seats return after churn');console.error(JSON.stringify({phase:'churn-returned',people:host.people}));
    const restartAt=performance.now(),saved=host.save(),net=room.saved(),epoch=host.epoch;host.stop();for(const link of links)link.close();room=new NetRoom({code:'crowd',rules:true,maxPlayers:seats,tickHz:20,perIp:0});room.restore({...net,durable:true});start(saved);console.error(JSON.stringify({phase:'rules-restarted',people:host.people}));
    await sleep(seconds*1000/3);
    const restoreDeadline=Date.now()+60000;while((host.people!==seats||clients.some(c=>c.latest?.e!==host.epoch))&&Date.now()<restoreDeadline)await sleep(50);
    assert.ok(host.epoch>epoch);assert.equal(host.people,seats,'all seats return after rules restart');assert.equal(host.core.snapshot()[0][0],round[0],'same round after both failures');assert.equal(host.core.stats.errors,0);
    const rulesRecoveryCheckedMs=performance.now()-restartAt;
    for(const c of clients)assert.ok(c.latest?.d[1].some(e=>e[9]===c.seat),`Sim owns seat ${c.seat} after recovery`);
    if(fatal)throw fatal;collecting=false;const elapsed=(performance.now()-begin)/1000;
    const pages=[...browserReceipts.values()];assert.equal(pages.length,browsers);assert.ok(pages.every(p=>Date.now()-p.receivedAt<5000),'browser receipts are live after recovery');
    assert.ok(pages.every(p=>p.snapshots>10&&p.seat!==null&&p.epoch===host.epoch&&p.own));
    tickTimes.sort((a,b)=>a-b);
    return {local:true,cloudflare:false,seats,browsers,layout,seconds:elapsed,steady,observedTickHz:(host.tick-firstTick)/elapsed,gateRecoveryCheckedMs,rulesRecoveryCheckedMs,bytesPerPlayerSecond:bytes/seats/elapsed,tickMs:{p50:tickTimes[Math.floor(tickTimes.length*.5)],p95:tickTimes[Math.floor(tickTimes.length*.95)],max:tickTimes.at(-1)},peakHeapBytes:peakHeap,peakRSSBytes:peakRSS,gateRecovery:true,rulesRecovery:true,churn:Math.ceil(seats*.05),pages};
  } catch (error) { console.error(error); throw error; } finally {
    collecting=false;clearInterval(beat);for(const c of clients){c.stopped=true;c.ws?.terminate();}host?.stop();if(browser){await Promise.race([browser.close(),sleep(5000)]);browser.process()?.kill();}for(const link of links)link.close();for(const socket of sockets?.clients??[])socket.terminate();sockets?.close();server?.close();rmSync(scratch,{recursive:true,force:true});
  }
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(JSON.stringify(await crowdLocal({seats:Number(process.argv[2]??300),seconds:Number(process.argv[3]??15)})));
