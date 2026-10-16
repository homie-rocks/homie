// Recovery after deliberate server pauses. Retain whole-run ana4/sstall results too.
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {loadModule} from '/Users/ryan/Studios/homie-arcade-rules/tests/lib/rules.mjs';
const L=await loadModule('games/tiny-platformer/src/level.ts');
const spawn=(x,y)=>L.SPAWNS.some(([a,b])=>Math.abs(x-a)<1.2&&Math.abs(y-b)<1.5);
const dist=(a,b)=>Math.hypot(a[1]-b[1],a[2]-b[2]);
for(const file of process.argv.slice(2)){
 const r=JSON.parse(gunzipSync(readFileSync(file))),F=r.frames,S=r.seen??[],rows=[];
 for(const e of r.events??[]){
  if(e.what!=='stall')continue;
  const back=r.origin+e.back,end=back+10000,own=F.filter(f=>f[0]>=e.back&&f[0]<e.back+10000);
  let ownPath=0,ownJumps=0,seenJumps=0,firstMotion=null,freezes=[];
  for(let i=1;i<own.length;i++){
   const a=own[i-1],b=own[i],d=dist(a,b);ownPath+=d;
   const x=a[6],y=b[6],placed=y?.moved||(x&&y&&(x.diedAt!==y.diedAt||x.round!==y.round))||spawn(b[1],b[2]);
   if(d>1.5&&!placed&&b[0]-a[0]<200)ownJumps++;
  }
  let still=null;
  const finish=(last)=>{
   if(still===null)return;
   const start=Math.max(back,S[still][0]),stop=Math.min(end,last[0]);
   if(stop-start>=700){const fs=F.filter(f=>f[0]+r.origin>=start&&f[0]+r.origin<=stop);let path=0;for(let k=1;k<fs.length;k++)path+=dist(fs[k-1],fs[k]);if(path>1)freezes.push({ms:Math.round(stop-start),ownerPath:+path.toFixed(2)});}
   still=null;
  };
  for(let i=1;i<S.length;i++){
   const a=S[i-1],b=S[i],d=dist(a,b);
   if(b[0]>=back&&b[0]<end){if(d>.02&&firstMotion===null)firstMotion=Math.max(0,b[0]-back);if(d>3&&!spawn(b[1],b[2])&&b[0]-a[0]<60)seenJumps++;}
   if(d===0){if(still===null)still=i-1;}else finish(a);
  }
  if(S.length)finish(S.at(-1));
  rows.push({stallMs:e.ms,ownerPath:+ownPath.toFixed(2),observerFirstMotionMs:firstMotion===null?null:Math.round(firstMotion),ownNonPlacementJumpsOver1_5:ownJumps,observerNonSpawnJumpsOver3:seenJumps,postResumeMovingOwnerFreezes:freezes});
 }
 console.log(file.split('/').pop(),JSON.stringify(rows));
}
