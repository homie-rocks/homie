/** Isolated toolkit capability probe; does not register a game or alter Stormbreak. */
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const toolkit=resolve('node_modules/@homie-rocks/studio/rules');
const source=`
import assert from 'node:assert/strict';
import {defineRules,defineMove,f,compileRules,compileMap} from ${JSON.stringify(join(toolkit,'rules.ts'))};
import {createCore} from ${JSON.stringify(join(toolkit,'core.ts'))};

// Feet coordinates, metres. A capsule moves toward a 1m square cover body.
const move=defineMove({runner(body,input,ctx){ctx.map.sweep(body,{x:input.ax*ctx.dt,y:0,z:0});}});
function run(mode){
 const rules=defineRules({contract:2,space:{dims:3},move,
  entities:{
   runner:{player:true,input:{ax:f.i8()},body:{shape:'capsule',radius:.4,height:1.8,maxSpeed:4},
    tick(world,self){if(mode==='entity-handler')world.sweep(self,{x:4*world.dt,y:0,z:0});}},
   cover:{body:{shape:'box',radius:.5,height:2.6,maxSpeed:0}}
  },
  room:{rounds:{seconds:120,breakSeconds:8},join(){return{kind:'runner',at:{x:-2,y:0,z:0}};},
   start(world){if(mode!=='static')world.spawn('cover',{x:0,y:0,z:0});}}
 });
 const map=compileMap({bounds:{min:[-10,-10,0],max:[10,10,10]},
  boxes:mode==='static'?[{min:[-.5,-.5,0],max:[.5,.5,2.6]}]:[],spots:{start:[[-2,0,0]]}});
 const compiled=compileRules(rules,{map,seats:1});
 const core=createCore(compiled);
 core.seatJoin({seat:0,driver:'person',owner:'probe'});
 core.step();
 for(let i=0;i<20;i++)core.step(new Map([[0,{values:{ax:mode==='entity-handler'?0:4}}]]));
 assert.equal(core.stats.errors,0,core.stats.lastError);
 const saved=core.save(),runner=saved.ents.find(e=>e[11]===0);
 return{mode,x:runner[7][0],entities:saved.ents.length,errors:core.stats.errors,ticks:core.tick};
}
const dynamic=run('dynamic'),fixed=run('static'),handler=run('entity-handler');
assert(dynamic.x>1,'Expected map-only movement to pass through the dynamic cover');
assert(fixed.x<-.89&&fixed.x>-.92,'Static map must stop the same capsule');
assert(handler.x<-.89&&handler.x>-.92,'Entity-handler sweep must see dynamic cover');
console.log(JSON.stringify({toolkit:'0.43.0',scope:'Direct real core test, not a browser latency trial. Same movement API used by prediction.',dynamic,fixed,handler,
 conclusion:'defineMove/map.sweep misses live entity cover; world.sweep sees it but is unavailable to predicted move.'},null,2));
`;
const dir=await mkdtemp(join(tmpdir(),'stormbreak-cover-'));
try{
 const file=join(dir,'probe.mjs');
 const result=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
 await writeFile(file,result.outputFiles[0].text);
 await import(pathToFileURL(file).href);
}finally{await rm(dir,{recursive:true,force:true});}
