import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PKG,esbuildOf} from './rules-kit.mjs';
const esbuild=await esbuildOf();
const built=await esbuild.build({stdin:{contents:"export {indexMap,nearbyMap} from './rules/map-index.ts'; export {G} from './rules/guard.ts';",resolveDir:PKG},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const {indexMap,nearbyMap,G}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const map={bounds:{min:{x:-2,y:-2,z:-2},max:{x:72,y:72,z:2}},boxes:Array.from({length:64},(_,i)=>({min:{x:i,y:i+2,z:0},max:{x:i+.5,y:i+2.5,z:1}})),circles:[]};
indexMap(map);

test('a long empty spatial query does not allocate temporary iterators while visiting bounds',()=>{
 const iterator=Array.prototype[Symbol.iterator];let iterators=0;
 Array.prototype[Symbol.iterator]=function(){iterators++;return iterator.call(this);};
 let result,units;
 try {G.left=100000;result=nearbyMap(map,{x:-1,y:-1,z:0},{x:71,y:71,z:0},.1,1,2);units=100000-G.left;}
 finally {Array.prototype[Symbol.iterator]=iterator;G.left=Infinity;}
 assert.equal(result.boxes.length,0,'the diagonal passes between the boxes');
 assert.equal(units,948,'every visited bound remains charged');
 assert.ok(iterators===0,`query created ${iterators} array iterators`);
});
for(const dims of [2,3])for(const sign of [-1,1])test(`indexed slab query retains its exact candidate with ${dims} dimensions and direction ${sign}`,()=>{
 G.left=Infinity;
 const result=nearbyMap(map,{x:sign<0?70:-1,y:10,z:.5},{x:sign*71,y:0,z:0},.1,1,dims);
 assert.deepEqual(result.boxes,[map.boxes[8]]);
});
