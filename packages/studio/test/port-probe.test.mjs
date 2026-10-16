import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {PKG,esbuildOf} from './rules-kit.mjs';

test('replacing a port probe retires its sampler and exposes fresh metadata',async t=>{
 const priorWindow=globalThis.window,priorRaf=globalThis.requestAnimationFrame;let queue=[];
 globalThis.window={addEventListener(){}};globalThis.requestAnimationFrame=fn=>queue.push(fn);
 t.after(()=>{if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow;if(priorRaf===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=priorRaf;});
 const esbuild=await esbuildOf();const built=await esbuild.build({entryPoints:[join(PKG,'port/probe.ts')],bundle:true,platform:'node',format:'esm',write:false});
 const {exposePort}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 let firstReads=0,secondReads=0,value=1;const first=exposePort(null,{view:'side',self:()=>{firstReads++;return{x:1,y:2};}});
 const frame=()=>{const callbacks=queue;queue=[];for(const fn of callbacks)fn();};frame();assert.equal(firstReads,1);
 const extra=Object.assign(Object.create({inherited:()=>99}),{value:()=>value});
 const second=exposePort(null,{view:'side',self:()=>{secondReads++;return{x:3,y:4};},extra});
 for(let n=0;n<10;n++)frame();
 assert.equal(firstReads,1);assert.equal(first.rows().length,1);assert.equal(secondReads,10);assert.equal(second.rows().length,10);assert.equal(queue.length,1);
 assert.deepEqual(second.info().extra,{value:1});value=2;extra.added=()=>3;assert.deepEqual(second.info().extra,{value:2,added:3});
});
