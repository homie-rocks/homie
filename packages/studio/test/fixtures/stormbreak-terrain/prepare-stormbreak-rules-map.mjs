/** Prepare, without activating, the exact top surfaces of Stormbreak's current arena.
 * This candidate is NOT equivalent solid geometry: see the terrain probe.
 * Build-time baking is legitimate; no browser/authority collision workaround lives here.
 */
import * as esbuild from 'esbuild';
import {prepareRules} from '../node_modules/@homie-rocks/studio/lib/rules-build.mjs';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),dir=await mkdtemp(join(tmpdir(),'stormbreak-map-'));
const out=resolve(process.argv[2]??'.checks/stormbreak-rules-map');
try {
 const source=`
 export {terrain} from ${JSON.stringify(resolve('games/stormbreak/src/arena.ts'))};
 export {landscapeData} from ${JSON.stringify(resolve('games/stormbreak/src/landscape.ts'))};
 export {courierGroundData} from ${JSON.stringify(resolve('games/stormbreak/src/courier-ground-data.ts'))};
 export {COURIER} from ${JSON.stringify(resolve('games/stormbreak/src/courier-site.ts'))};
 export {spawnPose} from ${JSON.stringify(resolve('games/stormbreak/src/spawn.ts'))};
 export {compileMap,compileRules,defineRules,defineMove,f} from ${JSON.stringify(resolve('node_modules/@homie-rocks/studio/rules/rules.ts'))};
 export {createCore} from ${JSON.stringify(resolve('node_modules/@homie-rocks/studio/rules/core.ts'))};
 `;
 const result=await esbuild.build({stdin:{contents:source,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
 const path=join(dir,'data.mjs');await writeFile(path,result.outputFiles[0].text);
 const {terrain,landscapeData,courierGroundData,COURIER,spawnPose,compileMap,compileRules,defineRules,defineMove,f,createCore}=await import(pathToFileURL(path).href);
 const counts=[];
 function tiles(name,data,offset){
  const {nx,nz,x0,z0,step,heights:h}=data,used=new Set(),tiles=[];let active=0,nonplanar=0,maxMergeError=0,exteriorCells=0;
  const exterior=(x,z)=>x0+offset.x+x*step>=48||x0+offset.x+(x+1)*step<=-48||z0+offset.z+z*step>=48||z0+offset.z+(z+1)*step<=-48;
  const heights=(x,z)=>{const i=x+z*nx;return[h[i],h[i+1],h[i+nx],h[i+nx+1]];};
  // Merge coplanar adjacent cells only, with a 1e-12 m arithmetic tolerance.
  // This preserves source triangles; it does not resample or smooth the terrain.
  const fits=(x,z,ox,oz,base,gx,gz)=>{
   if(x>=nx-1||z>=nz-1||used.has(x+z*nx)||exterior(x,z))return false;
   return heights(x,z).every((v,i)=>Math.abs(v-(base+gx*(x-ox+i%2)+gz*(z-oz+Math.floor(i/2))))<=1e-12);
  };
  for(let z=0;z<nz-1;z++)for(let x=0;x<nx-1;x++){
   const hs=heights(x,z);if(!hs.some(n=>n!==0))continue;if(exterior(x,z)){exteriorCells++;continue;}active++;
   if(Math.abs(hs[0]+hs[3]-hs[1]-hs[2])>1e-12)nonplanar++;
  }
  for(let z=0;z<nz-1;z++)for(let x=0;x<nx-1;x++){
   if(used.has(x+z*nx)||exterior(x,z))continue;
   const hs=heights(x,z);if(!hs.some(n=>n!==0))continue;
   let w=1,d=1;
   const gx=hs[1]-hs[0],gz=hs[2]-hs[0];
   if(Math.abs(hs[3]-(hs[0]+gx+gz))<=1e-12){
    while(fits(x+w,z,x,z,hs[0],gx,gz))w++;
    while(z+d<nz-1&&Array.from({length:w},(_,i)=>i).every(i=>fits(x+i,z+d,x,z,hs[0],gx,gz)))d++;
   }
   if(w>1||d>1)for(let dz=0;dz<=d;dz++)for(let dx=0;dx<=w;dx++)maxMergeError=Math.max(maxMergeError,Math.abs(h[x+dx+(z+dz)*nx]-(hs[0]+gx*dx+gz*dz)));
   for(let dz=0;dz<d;dz++)for(let dx=0;dx<w;dx++)used.add(x+dx+(z+dz)*nx);
   tiles.push({at:[x0+offset.x+x*step,z0+offset.z+z*step,0],size:[step*w,step*d],heights:w>1||d>1?[hs[0],h[x+w+z*nx],h[x+(z+d)*nx],h[x+w+(z+d)*nx]]:hs});
  }
  counts.push({name,exteriorCells,activeCells:active,nonplanarCells:nonplanar,tilesAfterCoplanarMerge:tiles.length,maxMergeErrorM:maxMergeError});return tiles;
 }
 const boxes=terrain.filter(t=>!t.ramp).map(t=>({min:[t.x-t.w/2,t.z-t.d/2,t.base??0],max:[t.x+t.w/2,t.z+t.d/2,t.h]}));
 const heightTiles=[...terrain.filter(t=>t.ramp).map(t=>({at:[t.x-t.w/2,t.z-t.d/2,0],size:[t.w,t.d],heights:t.ramp==='north'?[t.h,t.h,0,0]:[0,0,t.h,t.h]})),...tiles('landscape',landscapeData,{x:0,z:0}),...tiles('courier',courierGroundData,COURIER)];
 const starts=Array.from({length:8},(_,i)=>{const p=spawnPose(i);return[p.x,p.z,p.y];});
 const candidate={bounds:{min:[-48,-48,0],max:[48,48,40]},boxes,heightTiles,spots:{start:starts}};
 const report={toolkit:'0.44.1',status:'candidate only: open-sided height tiles do not preserve solid terrain',counts,boxes:boxes.length,ramps:terrain.filter(t=>t.ramp).length,shapes:boxes.length+heightTiles.length,compile:null,movement:[]};
 try{
  const map=compileMap(candidate);report.compile='passed';
  for(const seats of [1,6]){
   const def=defineRules({contract:2,space:{dims:3},move:defineMove({runner(b,input,ctx){ctx.world.sweep(b,{x:input.ax*ctx.dt,y:0,z:0});}}),entities:{runner:{player:true,input:{ax:f.i8()},body:{shape:'capsule',radius:.42,height:1.8,maxSpeed:6.4}}},room:{rounds:{seconds:120,breakSeconds:8},join(ctx,p){return{kind:'runner',at:ctx.map.spots('start')[p.seat]};}}});
   const compiled=compileRules(def,{map,seats}),core=createCore(compiled);
   for(let seat=0;seat<seats;seat++)core.seatJoin({seat,owner:'map-'+seat,driver:'person'});
   core.step(new Map(Array.from({length:seats},(_,seat)=>[seat,{values:{ax:4}}])));
   report.movement.push({seats,stats:{...core.stats},tick:core.tick});
  }
 }catch(error){report.compile=String(error);}
 await mkdir(out,{recursive:true});
 await mkdir(join(out,'src'),{recursive:true});await mkdir(join(out,'map'),{recursive:true});
 await writeFile(join(out,'map/main.json'),JSON.stringify(candidate));
 await writeFile(join(out,'src/rules.ts'),`import {defineRules,defineMove,f} from '@homie-rocks/studio/rules';
export default defineRules({
 contract:2,space:{dims:3},map:'./map',
 move:defineMove({runner(body,input,ctx){ctx.world.sweep(body,{x:input.ax/127*6.4*ctx.dt,y:0,z:0});}}),
 entities:{runner:{player:true,input:{ax:f.i8()},body:{shape:'capsule',radius:.42,height:1.8,maxSpeed:6.4}}},
 room:{rounds:{seconds:120,breakSeconds:8},join(){return{kind:'runner',at:{x:32,y:0,z:0}};}}
});
`);
 await writeFile(join(out,'src/view.ts'),`import type rules from './rules';
import {openRoom} from '@homie-rocks/studio/rules/view';
const room=openRoom<typeof rules>();
room.input({ax:0});
`);
 const messages=[];
 try {await prepareRules(esbuild,root,{id:'stormbreak-terrain-probe',dir:out,entry:'src/view.ts',players:{max:1},room:{host:'server'}},{log:line=>messages.push(line)});report.guardedBuild={passed:true,messages};}
 catch(error){report.guardedBuild={passed:false,messages,error:String(error)};}
 await writeFile(join(out,'candidate-map.json'),JSON.stringify(candidate));await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await rm(dir,{recursive:true,force:true});}
