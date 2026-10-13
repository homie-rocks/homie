/** Real mesh across runtimes; still not the rules/prediction acceptance proof. */
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { initPhysics } from '@homie-rocks/physics/Engine.js';
import { bakePhysicsMesh } from '../packages/studio/lib/physics-mesh.mjs';
import { findChrome, chromeArgs } from '../packages/studio/lib/chrome.mjs';
import { physicsFixture } from './ported-physics-fixture.mjs';

if(!process.argv[2])throw new Error('usage: node scripts/probe-ported-physics-runtimes.mjs /path/to/octree-arena');
const directory=mkdtempSync('/tmp/homie-048-runtimes-');
const root=fileURLToPath(new URL('../',import.meta.url));
cpSync(resolve(process.argv[2]),join(directory,'game'),{recursive:true});
const mesh=await bakePhysicsMesh(join(directory,'game/examples/models/gltf/collision-world.glb'));
writeFileSync(join(directory,'mesh.json'),JSON.stringify(mesh));
await initPhysics();
const node=await physicsFixture(mesh);
const fixture=JSON.stringify(join(root,'scripts/ported-physics-fixture.mjs'));
const common=`import {physicsFixture} from ${fixture};const mesh=${JSON.stringify(mesh)};`;
await build({stdin:{contents:`import {initPhysics} from '@homie-rocks/physics/Engine.js';${common}globalThis.probe=(async()=>{await initPhysics();return physicsFixture(mesh);})();`,resolveDir:root},bundle:true,format:'iife',platform:'browser',target:'es2022',outfile:join(directory,'browser.js'),logLevel:'silent'});
await build({stdin:{contents:`import {initPhysics} from '@homie-rocks/physics/Worker.js';import wasm from './rapier.wasm';${common}export default {async fetch(){await initPhysics(wasm);return Response.json(await physicsFixture(mesh));}};`,resolveDir:root},bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],target:'es2022',outfile:join(directory,'worker.js'),external:['./rapier.wasm'],logLevel:'silent'});
const require=createRequire(new URL('../packages/physics/package.json',import.meta.url));
cpSync(require.resolve('@homie-rocks/physics/vendor/rapier.wasm'),join(directory,'rapier.wasm'));
writeFileSync(join(directory,'config.capnp'),`using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services = [(name = "main", worker = (
  modules = [(name = "worker.js", esModule = embed "worker.js"), (name = "rapier.wasm", wasm = embed "rapier.wasm")],
  compatibilityDate = "2026-10-06"
 ))],
 sockets = [(name = "http", address = "127.0.0.1:0", http = (), service = "main")]
);`);
let browser,worker,server;
try {
  server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/browser.js'?'text/javascript':'text/html');res.end(req.url==='/browser.js'?readFileSync(join(directory,'browser.js')):'<script src="/browser.js"></script>');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const chrome=await page.evaluate(()=>globalThis.probe);
  assert.deepEqual(chrome,node,'Chrome full snapshot hashes and body positions');
  worker=spawn(require('workerd').default,['serve',join(directory,'config.capnp'),'--control-fd=1'],{stdio:['ignore','pipe','pipe']});
  let stderr='';worker.stderr.on('data',d=>stderr+=d);
  const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`workerd startup: ${stderr}`)),15000);
    let buffer='';
    worker.stdout.on('data',d=>{buffer+=d;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){const event=JSON.parse(line);if(event.port){clearTimeout(timer);resolve(event.port);}}});
    worker.once('error',e=>{clearTimeout(timer);reject(e);});
    worker.once('exit',()=>{clearTimeout(timer);reject(new Error(stderr));});
  });
  const response=await fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(60000)});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),node,'workerd full snapshot hashes and body positions');
  const receipt={directory,triangles:mesh.indices.length/3,players:8,roomHz:20,substepHz:300,ticks:200,restoredTicks:196,
    runtimes:['Node','Chrome','workerd'],equal:true,...node,
    limitations:['No guarded rules bridge or metering','No real multiplayer prediction trial']};
  writeFileSync(join(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({...receipt,hashes:`${node.hashes.length} equal SHA-256 hashes; full list in receipt.json`},null,2));
} finally {
  await browser?.close();
  if(worker&&worker.exitCode===null&&worker.signalCode===null){const done=once(worker,'exit');worker.kill();await done;}
  if(server)await new Promise(resolve=>server.close(resolve));
}
