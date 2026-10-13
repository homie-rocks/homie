/** CPU timings are a published calibration receipt, never a release verdict. */
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {build} from 'esbuild';
import {initPhysics} from '@homie-rocks/physics/Engine.js';
import {createWorld} from '@homie-rocks/physics/World.js';
import {bakePhysicsMesh} from '../packages/studio/lib/physics-mesh.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=mkdtempSync('/tmp/homie-physics-calibration-');
const mesh=await bakePhysicsMesh(join(root,'packages/studio/test/fixtures/physics-arena/level.glb'));
await initPhysics();const world=createWorld({up:'z',fixedDt:1/300,bounds:null});
world.createBody({type:'static',colliders:[{shape:{kind:'mesh',vertices:Float32Array.from(mesh.vertices),indices:Uint32Array.from(mesh.indices)}}]});
const outfile=join(dir,'kernel.mjs');await build({stdin:{contents:`export {moveContext} from ${JSON.stringify(join(root,'packages/studio/rules/math.ts'))};export {G} from ${JSON.stringify(join(root,'packages/studio/rules/guard.ts'))};export {compileMap} from ${JSON.stringify(join(root,'packages/studio/rules/rules.ts'))};`,resolveDir:root},bundle:true,format:'esm',platform:'node',outfile,logLevel:'silent'});
const {moveContext,G,compileMap}=await import(pathToFileURL(outfile));
// Kernel has primitive/height-tile worlds, not arbitrary meshes. Compare its
// equivalent operations on a single box, explicitly not the GLB geometry.
const map=compileMap({bounds:{min:[-100,-100,-100],max:[100,100,100]},boxes:[{min:[-20,-20,-2],max:[20,20,0]}]});
const ctx=moveContext({tick:()=>1,tickHz:20,tune:{},map,name:'calibration',spots:{},radius:()=>.35,shape:()=>({shape:'capsule',radius:.35,height:1.35}),dims:3});
const shape={kind:'capsule',radius:.35,halfHeight:.325},p={x:0,y:0,z:2},d={x:.02,y:0,z:-.03};
function measure(fn){for(let n=0;n<2000;n++)fn(n);const samples=[];let units=0;for(let round=0;round<9;round++){G.left=1e12;const before=process.cpuUsage();for(let n=0;n<10000;n++)fn(n);const cpu=process.cpuUsage(before);samples.push((cpu.user+cpu.system)*1000/10000);units=(1e12-G.left)/10000;}samples.sort((a,b)=>a-b);return{medianNs:samples[4],p90Ns:samples[8],units};}
const body=()=>({pos:{...p},vel:{x:0,y:0,z:0},grounded:false});
const table=[
 {operation:'capsule cast',physics:measure(n=>world.castCapsule({...p,x:(n%17)-8},d,.35,1.35)),kernel:measure(()=>ctx.map.sweep(body(),d))},
 {operation:'ray',physics:measure(n=>world.raycast({...p,x:(n%17)-8},{x:0,y:0,z:-1},5)),kernel:measure(()=>ctx.map.ray(p,{x:0,y:0,z:-1},5))},
 {operation:'overlap',physics:measure(n=>world.overlaps(shape,{...p,x:(n%17)-8})),kernel:measure(()=>ctx.map.overlaps(body()))},
 {operation:'step (static level, 1/300 s)',physics:measure(()=>world.step(1/300)),kernel:null},
];
world.dispose();
const receipt={date:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,triangles:mesh.indices.length/3,method:'9 batches of 10,000 calls after 2,000 warmup; process.cpuUsage; median and maximum batch; kernel equivalent operations on a box (no arbitrary-mesh equivalent)',table};
const out=process.argv[2]??join(dir,'receipt.json');writeFileSync(out,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
