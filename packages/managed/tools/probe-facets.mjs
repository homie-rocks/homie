import {writeFileSync} from 'node:fs';
import WebSocket from 'ws';
const base='https://hm-test-facets-r3.ryan-d2f.workers.dev',out=process.argv[2];
const rows=[];const save=()=>writeFileSync(out,JSON.stringify(rows,null,2)+'\n');
async function get(path){const at=performance.now();const r=await fetch(base+path,{signal:AbortSignal.timeout(30000)});const row={path,status:r.status,body:await r.text(),ms:Math.round(performance.now()-at),ray:r.headers.get('cf-ray'),colo:r.headers.get('cf-ray')?.split('-').at(-1)};rows.push(row);save();return row;}
await get('/delete');await get('/resume');await get('/');await get('/');
for(const target of ['https://hm-test-facets-r3.ryan-d2f.workers.dev/','http://127.0.0.1/','https://public.example/'])await get('/fetch?target='+encodeURIComponent(target));
await get('/tcp');await get('/alarm?case=alarm');await new Promise(r=>setTimeout(r,1500));await get('/status?case=alarm');
const sockets=[];
for(const path of ['/ws?case=ws','/hibernate?case=hibernate']){
 const at=performance.now();await new Promise(resolve=>{
 const ws=new WebSocket(base.replace('https','wss')+path);const row={path};rows.push(row);
 const timer=setTimeout(()=>{row.timeout=true;ws.terminate();save();resolve()},5000);
 ws.on('error',e=>{row.error=e.message;clearTimeout(timer);save();resolve()});
 ws.on('unexpected-response',async(req,res)=>{row.status=res.statusCode;row.ray=res.headers['cf-ray'];row.body='';for await(const chunk of res)row.body+=chunk;clearTimeout(timer);save();resolve()});
 ws.on('open',()=>{row.openMs=Math.round(performance.now()-at);sockets.push({ws,row});ws.send('facet-echo')});
 ws.on('message',m=>{row.echo=String(m);clearTimeout(timer);save();resolve()});
 ws.on('close',(code,reason)=>{row.close={code,reason:String(reason),at:Date.now()};save()});
 });
}
const pending=get('/pending');
for(let i=0;i<20;i++){const r=await get('/status');if(JSON.parse(r.body).pending)break;await new Promise(r=>setTimeout(r,100))}
const killAt=Date.now();await get('/abort');await pending;
await new Promise(r=>setTimeout(r,1000));for(const {ws,row}of sockets){await get('/abort?case='+ (row.path.includes('hibernate')?'hibernate':'ws'));row.killToCloseMs=row.close?row.close.at-killAt:null;row.stillOpen=ws.readyState===1;ws.close()}
await get('/status');await get('/resume');await get('/status');await get('/delete');await get('/status');save();console.log(JSON.stringify(rows,null,2));
