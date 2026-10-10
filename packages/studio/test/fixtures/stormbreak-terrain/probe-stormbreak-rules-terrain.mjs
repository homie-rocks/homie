/** Installed-runtime probe: Stormbreak's solid ramps versus the documented height tile. */
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),rules=resolve('node_modules/@homie-rocks/studio/rules');
const source=`
import assert from 'node:assert/strict';
import {defineRules,defineMove,f,compileRules,compileMap} from ${JSON.stringify(join(rules,'rules.ts'))};
import {createCore} from ${JSON.stringify(join(rules,'core.ts'))};
import {moveBody} from ${JSON.stringify(join(root,'games/stormbreak/src/combat.ts'))};
import {terrain,terrainRay as oldRay} from ${JSON.stringify(join(root,'games/stormbreak/src/arena.ts'))};
const ramp=terrain.find(t=>t.x===0&&t.z===11&&t.ramp==='north');
assert(ramp);
const tile={at:[ramp.x-ramp.w/2,ramp.z-ramp.d/2,0],size:[ramp.w,ramp.d],heights:[ramp.h,ramp.h,0,0]};
const body={shape:'capsule',radius:.42,height:1.8,maxSpeed:6.4};
const def=defineRules({contract:2,space:{dims:3},
 move:defineMove({runner(b,input,ctx){ctx.world.sweep(b,{x:input.ax*ctx.dt,y:0,z:0});}}),
 entities:{runner:{player:true,input:{ax:f.i8()},body}},
 shared:{rayDistance:f.fix({init:-1})},
 room:{rounds:{seconds:120,breakSeconds:8},join(){return{kind:'runner',at:{x:-4,y:7,z:0}};},
 start(world){const hit=world.ray({x:-4,y:7,z:1},{x:1,y:0,z:0},8);world.shared.rayDistance=hit?hit.dist:-1;}}
});
const map=compileMap({bounds:{min:[-48,-48,0],max:[48,48,30]},heightTiles:[tile],boxes:[],spots:{start:[[-4,7,0]]}});
const c=compileRules(def,{map,seats:1}),core=createCore(c);
core.seatJoin({seat:0,driver:'person',owner:'terrain-probe'});core.step();
const old={x:-4,y:0,z:7,vy:0,grounded:true};
for(let i=0;i<20;i++){core.step(new Map([[0,{values:{ax:4}}]]));moveBody(old,4,0,.05,[]);}
assert.equal(core.stats.errors,0,core.stats.lastError);
const save=core.save(),runner=save.ents.find(e=>e[11]===0);
const referenceRay=oldRay({x:-4,y:1,z:7},{x:1,y:0,z:0});
assert(old.x<-2.5,'Reference must stop outside the ramp side');
assert(runner[7][0]>-.1,'Height tile permits entering the solid ramp from its side');
assert.equal(referenceRay,1.5);
assert.equal(save.shared[0],-1,'Horizontal ray under the tile misses its solid side');
console.log(JSON.stringify({toolkit:'0.44.1',scope:'Direct real core and unchanged Stormbreak helper; not a latency or full-game test.',ramp,tile,
 movement:{reference:{x:old.x,height:old.y},toolkit:{x:runner[7][0],height:runner[7][2]},errors:core.stats.errors},
 horizontalRay:{origin:{x:-4,y:7,z:1},direction:{x:1,y:0,z:0},referenceDistance:referenceRay,toolkitDistance:save.shared[0]},
 conclusion:'The supported height tile preserves the top triangles but has no solid sides. Movement and shots enter the existing solid ramp. Axis-aligned boxes cannot preserve its sloping volume exactly.'},null,2));
`;
const dir=await mkdtemp(join(tmpdir(),'stormbreak-terrain-'));
try{const file=join(dir,'probe.mjs');const result=await build({stdin:{contents:source,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});await writeFile(file,result.outputFiles[0].text);await import(pathToFileURL(file).href);}finally{await rm(dir,{recursive:true,force:true});}
