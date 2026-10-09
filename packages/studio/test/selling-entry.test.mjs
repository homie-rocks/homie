import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {wranglerConfig} from '../lib/scaffold.mjs';
test('an ordinary studio imports no payment modules or SDKs and adds no compatibility flag', async () => {
  const built = await build({entryPoints:[new URL('../worker/index.mjs',import.meta.url).pathname],bundle:true,format:'esm',platform:'browser',write:false,metafile:true,minify:true});
  assert.doesNotMatch(Object.keys(built.metafile.inputs).join('\n'), /mppx|viem|\/purchase-|\/payment-|\/selling\//);
  const ordinary = JSON.parse(wranglerConfig({worker:'ordinary',name:'Ordinary',d1:'ordinary'}).replace(/^\s*\/\/.*$/gm,''));
  assert.ok(!ordinary.compatibility_flags.includes('nodejs_compat'));
  assert.equal(ordinary.triggers,undefined);
  const selling = JSON.parse(wranglerConfig({worker:'selling',name:'Selling',d1:'selling',paidParts:true}).replace(/^\s*\/\/.*$/gm,''));
  assert.equal(selling.alias['@homie-rocks/studio/worker'],'@homie-rocks/studio/worker/selling');
  assert.ok(selling.compatibility_flags.includes('nodejs_compat'));
});

test('the selling bundle uses the shared shop, office and parts implementation once', async () => {
  const built = await build({entryPoints:[new URL('../worker/selling/index.mjs',import.meta.url).pathname],bundle:true,format:'esm',platform:'node',write:false,metafile:true});
  const inputs = Object.keys(built.metafile.inputs);
  for (const file of ['index','shop','office','parts','shop-page','shop-rules','stripe']) {
    assert.equal(inputs.filter((path) => path.endsWith(`/worker/${file}.mjs`)).length,1,file);
    if (file !== 'index') assert.equal(inputs.filter((path) => path.endsWith(`/selling/${file}.mjs`)).length,0,file);
  }
});


test('the ordinary entry leaves purchase discovery unregistered', async () => {
  const { partsRoutes } = await import('../worker/parts.mjs');
  for (const path of ['/openapi.json','/.well-known/api-catalog','/purchases/keys.json']) {
    const url = new URL(path,'https://studio.example');
    assert.equal(await partsRoutes(new Request(url), {}, url, {catalogueOf:()=>assert.fail('purchase discovery is disabled')}),null);
  }
});
