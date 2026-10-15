import {readFileSync,writeFileSync} from 'node:fs';
import WebSocket from 'ws';
const [dir,out]=process.argv.slice(2),base='https://hm-test-dispatch.ryan-d2f.workers.dev';
const secret=readFileSync(dir+'/operator-token','utf8');
const evidence={started:new Date().toISOString(),sockets:[]},sockets=[];
const save=()=>writeFileSync(out,JSON.stringify(evidence,null,2)+'\n');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(path){const at=Date.now();try{const r=await fetch(base+path,{signal:AbortSignal.timeout(40000)});return {at,done:Date.now(),status:r.status,body:await r.text(),ray:r.headers.get('cf-ray')};}catch(e){return {at,done:Date.now(),error:String(e)}}}
async function operator(path,body){const at=Date.now();const r=await fetch(base+'/__operator/'+path,{method:path==='route'?'PUT':'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Operator '+r.status);return {at,done:Date.now(),status:r.status};}
async function socket(path,message){
 const row={path};evidence.sockets.push(row);const ws=new WebSocket(base.replace('https:','wss:')+path);sockets.push(ws);
 ws.on('close',code=>{row.closed=Date.now();row.code=code;save()});ws.on('error',e=>{row.error=String(e);save()});
 await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('Socket open timeout')),10000);ws.once('open',()=>{row.opened=Date.now();clearTimeout(timer);yes()});ws.once('error',no)});
 await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('Socket echo timeout')),10000);ws.once('message',()=>{row.messageAt=Date.now();clearTimeout(timer);yes()});ws.send(message)});
 return ws;
}
try{
 await operator('route',{tenant:'hm-test-inlet',routes:[{hostname:new URL(base).hostname,prefix:'/'}]});await sleep(2200);
 const hello=JSON.stringify({t:'hello',v:1,rev:8,name:'Supervisor probe',want:'play',device:'desk',canHost:true});
 await socket('/probe/owner/ws','stored-counter');await socket('/probe/owner/ordinary','ordinary-echo');
 await socket('/race/__net?room=kill-r4',hello);
 const other=await socket('/other/probe/owner/ws','other-kept');
 evidence.toolkit=[];for(const p of ['/race/api/lobby','/probe/gate/status','/probe/concentrator/status'])evidence.toolkit.push(await get(p));
 evidence.armed=await get('/probe/owner/alarm');await sleep(1200);evidence.before=await get('/probe/owner/status');
 const delayed=get('/probe/owner/delay').then(r=>{evidence.inflight=r;save()});await sleep(600);
 evidence.kill=await operator('kill',{tenant:'hm-test-inlet'});save();
 evidence.route=[];
 for(let i=0;i<30;i++){const r=await get('/probe/echo');evidence.route.push(r);save();if(r.status===404)break;await sleep(100)}
 await sleep(5500);
 evidence.other=await get('/other/probe/owner/status');
 evidence.otherEcho=await new Promise(resolve=>{const t=setTimeout(()=>resolve(false),2000);other.once('message',()=>{clearTimeout(t);resolve(true)});other.send('still-alive')});
 evidence.closedWithinWindow=evidence.sockets.map(r=>({path:r.path,ms:r.closed?r.closed-evidence.kill.at:null}));
 await operator('route',{tenant:'hm-test-inlet',routes:[{hostname:new URL(base).hostname,prefix:'/'}]});await sleep(2200);
 evidence.after=await get('/probe/owner/status');await sleep(1500);evidence.later=await get('/probe/owner/status');
 await delayed;save();
}finally{for(const ws of sockets)ws.terminate();save();}
console.log(JSON.stringify({kill:evidence.kill,sockets:evidence.closedWithinWindow,inflight:evidence.inflight,after:evidence.after,later:evidence.later,otherEcho:evidence.otherEcho},null,2));
