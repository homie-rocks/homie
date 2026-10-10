/** Real workerd binding/socket smoke; load/recovery runs live in extended. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

test('workerd routes 20 Gates through concentrators, preserves order and reconnects after Gate eviction', async () => {
  const bundle = await build({ stdin: { contents: `
    import {Gate as BaseGate,Concentrator,gateFor,acceptMultiplex} from './gate.mjs';
    export {Concentrator};
    export class Gate extends BaseGate {fetch(req){if(new URL(req.url).searchParams.has('kill')){setTimeout(()=>this.ctx.abort('test Gate death'),10);return new Response(null,{status:204});}return super.fetch(req);}}
    export class EchoTable { fetch(req){ return acceptMultiplex(req,async (request,socket)=>{socket.addEventListener('message',e=>socket.send(e.data));}); } }
    export default {fetch(request,env){const url=new URL(request.url);url.searchParams.set('game','g');url.searchParams.set('room','r');if(url.searchParams.has('shard')){const shard=url.searchParams.get('shard');url.searchParams.set('gate',shard);url.searchParams.set('gates','20');return env.GATE.get(env.GATE.idFromName('g/r/'+shard)).fetch(new Request(url,request));}return gateFor(env,'g','r',1280,'browser-key').fetch(new Request(url,request));}};
  `, resolveDir: dirname(fileURLToPath(new URL('../worker/gate.mjs', import.meta.url))) }, bundle:true, format:'esm', platform:'browser', write:false });
  const exports = Object.fromEntries(['Gate','Concentrator','EchoTable'].map(name=>[name,{type:'durable-object',storage:'sqlite'}]));
  const env = Object.fromEntries([['GATE','Gate'],['CONCENTRATOR','Concentrator'],['TABLE','EchoTable']].map(([name,exportName])=>[name,{type:'durable-object',worker:'gates',exportName}]));
  const mf = new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'gates',compatibilityDate:'2026-10-07',manifest:{mainModule:'entry.mjs',modules:{'entry.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},exports,env}}]});
  let socket; const crowd=[];
  try {
    const res = await mf.dispatchFetch('https://local/__net',{headers:{Upgrade:'websocket'}});
    assert.equal(res.status,101);socket=res.webSocket;socket.accept();
    const received=[];
    const done=new Promise((resolve,reject)=>{socket.addEventListener('message',e=>{received.push(e.data);if(received.length===3)resolve();});socket.addEventListener('error',reject);socket.addEventListener('close',()=>{if(received.length!==3)reject(new Error('link closed before ordered delivery'));});});
    for(const text of ['input-1','command-2','input-3'])socket.send(text);
    await done;assert.deepEqual(received,['input-1','command-2','input-3']);
    for(let shard=0;shard<20;shard++){
      const response=await mf.dispatchFetch(`https://local/__net?shard=${shard}`,{headers:{Upgrade:'websocket'}});
      assert.equal(response.status,101);const peer=response.webSocket;peer.accept();crowd.push(peer);
    }
    const echo=(peer,text)=>new Promise((resolve,reject)=>{const message=e=>{peer.removeEventListener('message',message);try{assert.equal(e.data,text);resolve();}catch(error){reject(error);}};peer.addEventListener('message',message);peer.send(text);});
    await Promise.all(crowd.map((peer,i)=>echo(peer,`seeded-${i}`)));
    const closed=new Promise(resolve=>crowd[0].addEventListener('close',resolve));
    assert.equal((await mf.dispatchFetch('https://local/__net?shard=0&kill=1')).status,204);await closed;
    await echo(crowd[19],'unaffected-command');
    const back=await mf.dispatchFetch('https://local/__net?shard=0',{headers:{Upgrade:'websocket'}});
    back.webSocket.accept();crowd.push(back.webSocket);await echo(back.webSocket,'reconnected-command');
  } finally {socket?.close();for(const peer of crowd)try{peer.close();}catch{}await mf.dispose();}
});

test('public Worker, real Table storage and Gates admit above 32 and preserve seats across both object failures', async () => {
  const capacity=process.env.RULES_EXTENDED==='1'?1000:300, count=process.env.RULES_EXTENDED==='1'?1000:40;
  const bundle = await build({stdin:{resolveDir:dirname(fileURLToPath(new URL('../worker/index.mjs',import.meta.url))),contents:`
    import worker,{Table as BaseTable,Lobby,Gate as BaseGate,Concentrator,hostRules} from './index.mjs';
    import {defineRules,defineMove,roomSettings} from '../rules/rules.ts';
    export {Lobby,Concentrator};
    const rules=defineRules({contract:2,space:{dims:2},move:defineMove({runner(){}}),entities:{runner:{player:true,body:{shape:'circle',radius:.4,maxSpeed:1}}},room:{rounds:{seconds:600,breakSeconds:1},join(c,p){return {kind:'runner',at:{x:p.seat*2,y:0,z:0}}}}});
    hostRules({crowd:{rules,seats:${capacity},build:'test-build',stateHash:'test-state',map:{bounds:{min:[-10,-10],max:[${capacity*3},10]}},settings:roomSettings({tickHz:1,view:{radiusM:4},budget:{tick:5000000}}).settings}});
    const cat={studio:{name:'Local test'},games:[{id:'crowd',name:'Crowd',players:{min:1,max:${capacity}},netplay:{version:'test-build'},room:{host:'server',contract:2,tickHz:1}}]};
    const assets={fetch:async request=>new URL(request.url).pathname==='/games.json'?Response.json(cat):new Response('',{status:404})};
    const configured=env=>({...env,ASSETS:assets,HOMIE_ROOM_LOG:'0'});
    export class Table extends BaseTable {constructor(ctx,env){super(ctx,configured(env));}say(line){if(line.ev==='host-ended')console.log(JSON.stringify(line));}fetch(req){if(new URL(req.url).pathname==='/test-abort'){this.saveRoom(this.hostRt.save());setTimeout(()=>this.ctx.abort('test rules restart'),1);return new Response(null,{status:204});}return super.fetch(req);}}
    export class Gate extends BaseGate {fetch(req){if(new URL(req.url).pathname==='/test-abort'){setTimeout(()=>this.ctx.abort('test Gate death'),1);return new Response(null,{status:204});}return super.fetch(req);}}
    export default {fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/test-abort'){const binding=u.searchParams.get('table')?env.TABLE:env.GATE;const key=u.searchParams.get('table')?'crowd/pub-1':u.searchParams.get('key');return binding.get(binding.idFromName(key)).fetch(request);}return worker.fetch(request,configured(env),ctx);}};
  `},bundle:true,write:false,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
  const classes=['Table','Lobby','Gate','Concentrator'];
  const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'rooms',compatibilityDate:'2026-10-07',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'entry.mjs',modules:{'entry.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},exports:Object.fromEntries(classes.map(name=>[name,{type:'durable-object',storage:'sqlite'}])),env:Object.fromEntries(classes.map(name=>[name.toUpperCase(),{type:'durable-object',worker:'rooms',exportName:name}]))}}]});
  const peers=[];
  const heartbeat=setInterval(()=>{for(const p of peers)try{p.send(JSON.stringify({t:'ping',c:Date.now()}));}catch{}},1000);
  const shard=key=>{let hash=2166136261;for(const c of key)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;return hash%Math.ceil(capacity/64);};
  const closedPeers=[];
  const open=async(key,token=null)=>{
    const response=await mf.dispatchFetch(`https://studio.test/crowd/__net?room=pub-1&b=${key}&gv=test-build`,{headers:{Upgrade:'websocket','cf-connecting-ip':'203.0.113.1'}});
    assert.equal(response.status,101);const ws=response.webSocket;ws.accept();
    const result=await new Promise((resolve,reject)=>{ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.t==='welcome')resolve({ws,welcome:m});else if(m.t==='error')reject(new Error(JSON.stringify(m)));});ws.addEventListener('close',()=>reject(new Error('closed before welcome')));ws.send(JSON.stringify({t:'hello',v:1,rev:12,rules:true,want:'play',token}));});
    result.ws.addEventListener('close',e=>closedPeers.push({key,code:e.code,reason:e.reason}));
    peers.push(result.ws);return {...result,key,gate:shard(key)};
  };
  try {
    let holders=[];
    for(let i=0;i<count;i+=20){
      holders.push(...await Promise.all(Array.from({length:Math.min(20,count-i)},(_,j)=>open(`seeded_browser_${String(i+j).padStart(4,'0')}`))));
      if(count===1000&&holders.length%100===0)console.log(JSON.stringify({phase:'workerd-admission',players:holders.length,closed:closedPeers.length}));
    }
    assert.equal(new Set(holders.map(p=>p.welcome.seat)).size,count,JSON.stringify(closedPeers));
    assert.equal(closedPeers.length,0,JSON.stringify(closedPeers));
    assert.ok(holders.every(p=>p.welcome.max===capacity&&p.welcome.role==='replica'));
    for(const failure of ['gate','table']){
      const gate=holders[0].gate, affected=failure==='table'?holders:holders.filter(p=>p.gate===gate);
      const closed=Promise.all(affected.map(p=>new Promise(resolve=>p.ws.addEventListener('close',resolve))));
      const query=failure==='table'?'table=1':`key=crowd/pub-1/${gate}`;
      assert.equal((await mf.dispatchFetch(`https://studio.test/test-abort?${query}`)).status,204);await closed;
      const back=new Map();
      for(let i=0;i<affected.length;i+=20)await Promise.all(affected.slice(i,i+20).map(async p=>{const next=await open(p.key,p.welcome.token);assert.equal(next.welcome.seat,p.welcome.seat);back.set(p.key,next);}));
      holders=holders.map(p=>back.get(p.key)??p);
      if(count===1000)console.log(JSON.stringify({phase:'workerd-recovered',failure,players:affected.length}));
    }
      console.log(JSON.stringify({local:true,workerd:true,capacity,clients:count,gateRecovery:true,rulesRecovery:true}));
  } finally {clearInterval(heartbeat);for(const p of peers)try{p.close();}catch{}await mf.dispose();}
});
