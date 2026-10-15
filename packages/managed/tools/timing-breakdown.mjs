import {readFileSync,writeFileSync} from 'node:fs';
const [samplesFile,summaryFile,out]=process.argv.slice(2),rows=JSON.parse(readFileSync(samplesFile)),pairs=JSON.parse(readFileSync(summaryFile)).pairs.filter(p=>!p.cold);
const median=x=>{x.sort((a,b)=>a-b);return x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2};const results=[];
for(const endpoint of [...new Set(pairs.map(p=>p.endpoint))])for(const kind of ['managed','plain']){
 const matching=pairs.filter(p=>p.endpoint===endpoint),r=matching.map(p=>rows.find(r=>r.round===p.round&&r.endpoint===endpoint&&r.kind===kind));
 results.push({endpoint,kind,n:r.length,clientMs:median(r.map(r=>r.ms)),workerMs:median(r.map(r=>Number(r.workerMs))),...(kind==='managed'?{dispatchMs:median(r.map(r=>Number(r.dispatchMs))),routeMs:median(r.map(r=>Number(r.routeMs))),handoffMs:median(r.map(r=>Number(r.dispatchMs)-Number(r.routeMs)-Number(r.workerMs)))}:{})});
}
writeFileSync(out,JSON.stringify({caveat:'Matched warm pairs only. Runtime clocks advance with I/O; handler headers exclude client transfer time. Handoff is an elapsed-duration residual, not a provider span.',results},null,2)+'\n');console.log(results);
