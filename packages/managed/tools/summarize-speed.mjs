import {readFileSync,writeFileSync} from 'node:fs';
const rows=JSON.parse(readFileSync(process.argv[2]));const pairs=[],excluded=[];
for(const m of rows.filter(x=>x.kind==='managed')){const p=rows.find(x=>x.kind==='plain'&&x.round===m.round&&x.endpoint===m.endpoint);if(m.status!==200||p?.status!==200||!m.colo||p.colo!==m.colo||m.first!==p.first){excluded.push({round:m.round,endpoint:m.endpoint,managedColo:m.colo,plainColo:p?.colo,managedFirst:m.first,plainFirst:p?.first});continue}pairs.push({endpoint:m.endpoint,round:m.round,colo:m.colo,cold:m.first==='true',managedMs:m.ms,plainMs:p.ms,managedRay:m.ray,plainRay:p.ray});}
const median=x=>{const a=x.slice().sort((a,b)=>a-b);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2};const summary=[];
for(const endpoint of [...new Set(rows.map(r=>r.endpoint))])for(const cold of [false,true]){const found=pairs.filter(p=>p.endpoint===endpoint&&p.cold===cold);summary.push({endpoint,cold,n:found.length,colos:[...new Set(found.map(p=>p.colo))],managedMs:found.length?median(found.map(p=>p.managedMs)):null,plainMs:found.length?median(found.map(p=>p.plainMs)):null})}
let seed=13904;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
for(const row of summary.filter(s=>s.n)){
 const delta=pairs.filter(p=>p.endpoint===row.endpoint&&p.cold===row.cold).map(p=>p.managedMs-p.plainMs);
 row.medianPairedDeltaMs=median(delta);
 const estimates=Array.from({length:5000},()=>median(Array.from({length:delta.length},()=>delta[Math.floor(random()*delta.length)]))).sort((a,b)=>a-b);
 row.pairedMedianBootstrap95Ms=[estimates[125],estimates[4875]];
}
const firstSamples=rows.filter(r=>r.first==='true');writeFileSync(process.argv[3],JSON.stringify({summary,pairs,excluded,firstSamples,bootstrap:{samples:5000,seed:13904,caveat:'Pairs may be temporally correlated; descriptive interval, not an SLA.'}},null,2)+'\n');console.log(summary);console.log('Isolate-first samples:',firstSamples.length);
