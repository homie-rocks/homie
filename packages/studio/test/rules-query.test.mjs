import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {esbuildOf,PKG} from './rules-kit.mjs';
const dir=mkdtempSync(join(tmpdir(),'homie-queries-'));
test.after(()=>rmSync(dir,{recursive:true,force:true}));
const esbuild=await esbuildOf();
const built=await esbuild.build({stdin:{contents:`export {rayQuery} from './rules/query.ts';export {compileMap,compileRules,defineRules,defineMove} from './rules/rules.ts';export {G} from './rules/guard.ts';`,resolveDir:PKG},bundle:true,platform:'node',format:'esm',write:false});
const file=join(dir,'query.mjs');writeFileSync(file,built.outputFiles[0].text);
const {rayQuery,compileMap,compileRules,defineRules,defineMove,G}=await import(pathToFileURL(file));
for(const dims of [2,3])test(`ray geometry ${dims}D: all entries, embedded origins and camera clearance`,()=>{
 const map=compileMap({bounds:{min:[-20,-20,-20],max:[20,20,20]},boxes:[{min:[3,-1,0],max:[4,1,2]},{min:[7,-1,0],max:[8,1,2]}],circles:[{at:[11,0,0],r:1}]});
 const cast=(p,o={})=>rayQuery(map,[],dims,p,{x:1,y:0,z:0},15,o,undefined,true);
 assert.equal(rayQuery(map,[],dims,{x:0,y:0,z:1},{x:1,y:0,z:0},100)[0].dist,3);
 const hits=cast({x:0,y:0,z:1});assert.deepEqual(hits.map(h=>h.dist),[3,7,10]);
 assert.equal(cast({x:3.5,y:0,z:1})[0].dist,0);
 assert.equal(cast({x:11,y:0,z:1})[0].dist,0);
 assert.ok(Math.abs(cast({x:0,y:0,z:1},{radius:.3,shape:'box'})[0].dist-2.7)<1e-6);
 assert.equal(cast({x:0,y:0,z:1},{layer:'absent'}).length,0);
 assert.equal(cast({x:0,y:0,z:1},{entitiesOnly:true}).length,0);
 for(const o of [{ignore:Array(17).fill('e')},{where:Object.fromEntries(Array.from({length:17},(_,i)=>['f'+i,0]))},{radius:-1},{shape:'cone'}])assert.throws(()=>cast({x:0,y:0,z:1},o));
 G.left=1;try{assert.throws(()=>cast({x:0,y:0,z:1}),/budget/i);}finally{G.left=Infinity;}
});
test('query parts refuse malformed or unbounded declarations',()=>{
 const def=query=>defineRules({contract:2,space:{dims:3},move:defineMove({runner(){}}),entities:{runner:{player:true,body:{shape:'capsule',radius:.42,height:1.8,maxSpeed:4},query}},room:{join(){return{kind:'runner',at:{x:0,y:0,z:0}};}}});
 for(const query of [{tags:Array(17).fill('target')},{layer:''},{parts:{head:{shape:'capsule',radius:1,height:.1}}},{parts:{head:{shape:'box',radius:NaN}}}])assert.throws(()=>compileRules(def(query),{map:compileMap({bounds:{min:[-20,-20,0],max:[20,20,20]}})}),/query/);
});
