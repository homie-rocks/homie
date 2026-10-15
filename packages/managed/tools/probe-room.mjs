import WebSocket from 'ws';import {writeFileSync} from 'node:fs';
const base=process.argv[2]||'https://hm-test-dispatch.ryan-d2f.workers.dev';const out=process.argv[3];
const room=Date.now();const rows=[],clients=[];let tick=0;const heartbeat=setInterval(()=>{for(const ws of clients)if(ws.readyState===1){ws.send(JSON.stringify({t:'ping',c:Date.now(),hid:false}));ws.send(JSON.stringify({t:'snap',k:++tick,st:Date.now(),d:{score:tick}}));}},250);const save=()=>writeFileSync(out,JSON.stringify(rows,(k,v)=>k==='token'?'[redacted]':v,2)+'\n');
for(let i=0;i<2;i++){
 const ws=new WebSocket(base.replace('https','wss')+(process.argv[4]||('/race/__net?room=r3-proof-'+room)));const row={client:i,frames:[]};rows.push(row);clients.push(ws);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No welcome')),15000);ws.on('upgrade',res=>{row.ray=res.headers['cf-ray'];row.colo=row.ray?.split('-').at(-1)});ws.on('error',reject);ws.on('unexpected-response',(req,res)=>reject(Error('socket HTTP '+res.statusCode)));
 ws.on('open',()=>ws.send(JSON.stringify({t:'hello',v:1,rev:8,name:'Managed probe '+i,device:'desk',want:'play',canHost:true})));
 ws.on('message',m=>{let f;try{f=JSON.parse(String(m))}catch{return}row.frames.push(f);save();if(f.t==='welcome'){clearTimeout(timer);resolve()}});
 });
}
await new Promise(r=>setTimeout(r,500));
clients[0].send(JSON.stringify({t:'round',round:{n:1,phase:'live',startedAt:Date.now(),endsAt:Date.now()+1200}}));
clients[0].send(JSON.stringify({t:'state',k:'score',d:{player:0,score:1}}));
await new Promise(r=>setTimeout(r,1300));clients[0].send(JSON.stringify({t:'round',round:{n:1,phase:'over',results:[{seat:0,score:1},{seat:1,score:0}]}}));
await new Promise(r=>setTimeout(r,500));clearInterval(heartbeat);for(const ws of clients)ws.close();save();console.log(rows.map(r=>({client:r.client,frames:r.frames.map(f=>f.t),rounds:r.frames.filter(f=>f.t==='round')})));
