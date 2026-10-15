import {Agent} from 'undici';
const dispatcher=new Agent({connect:{lookup:(hostname,opts,callback)=>callback(null,opts.all?[{address:'104.21.34.86',family:4}]:'104.21.34.86',4)}});
import {writeFileSync} from 'node:fs';
const rows=[];
const cases={page:['/cafe/open'],asset:['/test.js'],records:['/cafe/api/app/records/notes'],mcp:['/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'speed',version:'1'}}})}],seat:['/race/api/lobby']};
for(let run=0;run<28;run++){
 for(const [route,[path,options]] of Object.entries(cases))for(const variant of run%2?['after','before']:['before','after']){
  const start=performance.now();const response=await fetch(`https://hm-speed-0540-${variant}.ryan-d2f.workers.dev${path}`,{dispatcher,...options,signal:AbortSignal.timeout(30000)});const ms=performance.now()-start;
  const text=await response.text();if(response.status!==200)throw Error(route+' '+response.status+' '+text.slice(0,300));
  if(run>=3)rows.push({run:run-3,variant,route,status:response.status,ttfbMs:ms,ray:response.headers.get('cf-ray')});
 }
 writeFileSync('speed-pinned.json',JSON.stringify(rows,null,2));console.log('round',run);
}
const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
const summary=Object.fromEntries(Object.keys(cases).map(route=>[route,Object.fromEntries(['before','after'].map(variant=>[variant,Math.round(100*median(rows.filter(r=>r.route===route&&r.variant===variant).map(r=>r.ttfbMs)))/100]))]));
writeFileSync('speed-summary.json',JSON.stringify(summary,null,2));console.log(summary);

await dispatcher.close();
