import { loadGame } from '/Users/ryan/Studios/homie-arcade-rules/tests/lib/rules.mjs';
import {cpSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const studio='/Users/ryan/Studios/homie-arcade-rules';
const dir=mkdtempSync('/tmp/owner-contact-baseline-');cpSync(studio+'/games/tiny-platformer',dir,{recursive:true});
writeFileSync(dir+'/src/rules.ts',execFileSync('git',['show','9240a05:games/tiny-platformer/src/rules.ts'],{cwd:studio}));
const current=await loadGame('tiny-platformer'),old=await loadGame('tiny-platformer',{dir});rmSync(dir,{recursive:true,force:true});
const results={};
for(const [label,g] of [['oldContact',old],['allPaths',current]]){
 const init=g.room({people:8});init.core.setPolicy({bots:'off'});init.step();const save=init.save();
 for(const row of save.ents.filter(e=>e[11]>=0)){const kind=g.compiled.kinds[row[2]],fields=g.L.P.unpackFields(kind.fields,row[17],2);fields.safeUntil=10000;row[17]=g.L.P.packFields(kind.fields,fields,2);}
 const oracle=g.room({restore:structuredClone(save)}),reports=new Map();
 for(let seat=0;seat<8;seat++)reports.set(seat,{values:{l:0,r:1,j:0},reports:[]});
 for(let n=0;n<8;n++){
  oracle.step(Object.fromEntries(Array.from({length:8},(_,i)=>[i,{l:0,r:1,j:0}])));
  for(const row of oracle.save().ents.filter(e=>e[11]>=0)){const seat=row[11],e=oracle.body(seat),base=save.ents.find(r=>r[11]===seat);reports.get(seat).reports.push({tick:oracle.tick,base:save.tick,r:base[3],pos:e.pos,vel:e.vel,heading:g.L.P.unpackVec(row[9],2),values:{l:0,r:1,j:0}});}
 }
 const ms=[],cpu=[];let peak=0,held=0,errors=0;
 for(let n=0;n<120;n++){
  const room=g.room({restore:structuredClone(save)});
  for(let j=0;j<8;j++)room.core.step(new Map(Array.from({length:8},(_,i)=>[i,{values:{l:0,r:0,j:0},reports:[]}])));
  const before=performance.now(),used=process.cpuUsage();room.core.step(reports);const dt=performance.now()-before,spent=process.cpuUsage(used);
  if(n>=20){ms.push(dt);cpu.push((spent.user+spent.system)/1000);}peak=Math.max(peak,room.stats().maxTickUnits);held+=room.stats().held;errors+=room.stats().errors;
 }
 ms.sort((a,b)=>a-b);cpu.sort((a,b)=>a-b);results[label]={medianCpuMs:cpu[50],p95CpuMs:cpu[95],medianMs:ms[50],p95Ms:ms[95],maxMs:ms.at(-1),peakTickUnits:peak,held,errors};
}
writeFileSync('/tmp/owner-followup/host-cost.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
