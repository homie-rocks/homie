import assert from 'node:assert/strict';
import {snapshotDecoder} from '../../../rules/interest.mjs';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const WebSocket=require('ws');
const [base,expected,game='direct',output=game+'.json',count='2']=process.argv.slice(2);
if(!base||!expected||!['direct','gated'].includes(game))throw Error('Usage: node probe.mjs <fixture-url> <PROOF_VERSION> [direct|gated] [output.json]');
for(let n=0;n<120;n++){if(await (await fetch(base+'/proof-version')).text()===expected)break;if(n===119)throw Error('version did not converge');await new Promise(r=>setTimeout(r,1000));}
const peers=[],events=[],rays=[];let room='proof-'+Date.now();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const status=async()=>{const r=await fetch(base+'/proof-status?key='+game+'/'+room);const table=await r.json();if(game==='gated'){const g=await fetch(base+'/proof-status?kind=GATE&key='+game+'/'+room+'/0');table.gate=await g.json();}return table;};
try {
 for(let n=0;n<120;n++){const current=await status();if(current.version===expected&&(game!=='gated'||current.gate?.version===expected))break;if(n===119)throw Error('object version did not converge');console.error(JSON.stringify({preflight:n,expected,table:current.version,gate:current.gate?.version}));room='proof-'+Date.now();await sleep(1000);}
 const heartbeat=setInterval(()=>{for(const p of peers)if(p.ws.readyState===1)p.ws.send('homie-ping');},2000);
 try {
 for(let start=0;start<Number(count);start+=16)await Promise.all(Array.from({length:Math.min(16,Number(count)-start)},async(_,j)=>{const i=start+j;
 const ws=new WebSocket(base.replace('https:','wss:')+'/'+game+'/__net?room='+room+'&gv=proof&b=proof-player-'+i);
 const p={ws,welcome:0,closed:0,frames:[],pongs:0,decoder:snapshotDecoder(),ownSnapshots:0,undecodable:0};peers.push(p);
 ws.on('upgrade',r=>rays.push(r.headers['cf-ray']));
 ws.on('close',(code,reason)=>{p.closed++;events.push({close:code,reason:String(reason)});});
 ws.on('error',e=>events.push({error:e.message}));
 ws.on('message',raw=>{if(String(raw)==='homie-pong'){p.pongs++;return;}const m=JSON.parse(raw);p.frames.push(m);if(m.t==='snap'){const snap=p.decoder.decode(m);if(!snap)p.undecodable++;else if(snap.d[1].some(row=>row[9]===p.seat))p.ownSnapshots++;}if(m.t==='welcome'){p.welcome++;p.id=m.id;p.seat=m.seat;}if(m.t==='round')events.push({at:Date.now(),player:i,round:m.round});});
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);ws.once('unexpected-response',(_req,res)=>{res.resume();reject(new Error('HTTP '+res.statusCode));});setTimeout(()=>reject(new Error('upgrade timeout')),15000).unref();});
 ws.send(JSON.stringify({t:'hello',v:1,rev:12,rules:true,want:'play',coast:1}));
 }));
  for(let i=0;i<300&&!peers.every(p=>p.frames.some(m=>m.t==='round'&&m.round.phase==='over'));i++)await sleep(100);
  assert.ok(peers.every(p=>p.frames.some(m=>m.t==='round'&&m.round.phase==='over')),'wait for the break before measuring hibernation');
  const before=await status();
  await sleep(40000);
  const after=await status();
  for(let i=0;i<400&&!peers.every(p=>p.frames.some(m=>m.t==='round'&&m.round.n>=2&&m.round.phase==='live'));i++)await sleep(100);
  const continued=await status();
  const result={game,room,rays,before,after,continued,peers:peers.map(({welcome,closed,pongs,id,seat,frames,ownSnapshots,undecodable})=>({welcome,closed,pongs,id,seat,ownSnapshots,undecodable,snaps:frames.filter(m=>m.t==='snap').length,errors:frames.filter(m=>m.t==='error')})),events};
  writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  assert.equal(before.version,expected);assert.equal(after.version,expected);assert.notEqual(before.boot,after.boot);assert.equal(before.tick,after.tick);assert.equal(after.timer,false);assert.ok(continued.tick>after.tick);assert.ok(continued.round.n>=2);
  if(game==='gated'){assert.equal(before.gate.version,expected);assert.equal(after.gate.version,expected);assert.notEqual(before.gate.boot,after.gate.boot);}
  for(const p of result.peers){assert.equal(p.welcome,1);assert.equal(p.closed,0);assert.equal(p.errors.length,0);assert.equal(p.undecodable,0);assert.ok(p.ownSnapshots>1);}
 }finally{clearInterval(heartbeat);}
}finally{for(const p of peers)p.ws.close();}
