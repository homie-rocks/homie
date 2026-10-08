// Standalone measured comparison; intentionally outside npm test.
import assert from 'node:assert/strict';
import { init, measure } from './comparison-scene.mjs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { mkdtemp, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
const here=fileURLToPath(new URL('.',import.meta.url));
const reference=new Map();
await init();for(const engine of ['navcat','recast']){const result=measure(engine);reference.set(engine,result);const again=measure(engine);assert.equal(again.tileHash,result.tileHash);assert.equal(again.positionHash,result.positionHash);console.log(JSON.stringify({runtime:'Node',...result}));}
if(process.env.CHROME_PATH){
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,args:['--no-sandbox'],headless:true});
try{
  const bundled=await build({entryPoints:[join(here,'comparison-scene.mjs')],bundle:true,platform:'browser',format:'iife',globalName:'comparison',write:false});
  const page=await browser.newPage();await page.addScriptTag({content:bundled.outputFiles[0].text});
  for(const engine of ['navcat','recast'])console.log(JSON.stringify({runtime:await browser.version(),...await page.evaluate(async engine=>{await comparison.init();return comparison.measure(engine);},engine)}));
}finally{await browser.close();}
}
const dir=await mkdtemp(join(tmpdir(),'nav-compare-'));
const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
let child;
try{
  const source=`import { init, make } from './comparison-scene.mjs'; import factory from '@recast-navigation/wasm/wasm'; import wasm from './recast.wasm'; let scene; let ready=false; export default { async fetch(request) { const url=new URL(request.url); if(!ready){await init(()=>factory({instantiateWasm(imports,success){const instance=new WebAssembly.Instance(wasm,imports);success(instance,wasm);return instance.exports;}}));ready=true;} const action=url.searchParams.get('action');let result={};if(action==='new'){scene?.dispose();scene=make(url.searchParams.get('engine'));}else if(action==='bake')result=scene.bake();else if(action==='prepare')scene.prepare();else if(action==='paths')scene.paths(Number(url.searchParams.get('count')));else if(action==='step')scene.step(Number(url.searchParams.get('count')));else if(action==='result')result=scene.result();return Response.json(result);}};`;
  await build({stdin:{contents:source,resolveDir:here,sourcefile:'worker.mjs'},bundle:true,platform:'browser',format:'esm',external:['./recast.wasm'],outfile:join(dir,'worker.js')});
  await copyFile(new URL('../../../../node_modules/@recast-navigation/wasm/dist/recast-navigation.wasm.wasm',import.meta.url),join(dir,'recast.wasm'));
  await writeFile(join(dir,'config.capnp'),`using Workerd = import "/workerd/workerd.capnp"; const config :Workerd.Config = (services=[(name="main",worker=(modules=[(name="worker.js",esModule=embed "worker.js"),(name="recast.wasm",wasm=embed "recast.wasm")],compatibilityDate="2026-10-07"))],sockets=[(name="http",address="127.0.0.1:${port}",http=(),service="main")]);`);
  child=spawn(fileURLToPath(new URL('../../../../node_modules/.bin/workerd',import.meta.url)),['serve',join(dir,'config.capnp')],{stdio:['ignore','pipe','pipe']});child.stderr.on('data',b=>process.stderr.write(b));
  const request=async(action,engine='',count=1)=>{const response=await fetch(`http://127.0.0.1:${port}/?action=${action}&engine=${engine}&count=${count}`);if(!response.ok)throw Error(await response.text());return response.json();};
  for(let i=0;i<100;i++){try{await request('ping');break;}catch{await new Promise(resolve=>setTimeout(resolve,20));}}
  for(const engine of ['navcat','recast']){
    await request('new',engine);const times=[];
    for(let i=0;i<4;i++){const t=performance.now();await request('bake');if(i)times.push(performance.now()-t);}
    await request('prepare');await request('paths','',100);await request('step','',30);
    let t=performance.now();await request('paths','',1000);const query=(performance.now()-t)/1000;
    const steps=[];for(let i=0;i<12;i++){t=performance.now();await request('step','',10);steps.push((performance.now()-t)/10);}steps.sort((a,b)=>a-b);
    const result=await request('result');assert.equal(result.tileHash,reference.get(engine).tileHash);assert.equal(result.positionHash,reference.get(engine).positionHash);
    console.log(JSON.stringify({runtime:'workerd (host wall time including HTTP)',engine,bakeMinMs:Math.min(...times),bakeMaxMs:Math.max(...times),queryMs:query,stepMedianMs:steps[6],stepP95Ms:steps[11],...result}));
  }
}finally{if(child){child.kill();await new Promise(resolve=>child.once('exit',resolve));}await rm(dir,{recursive:true,force:true});}
