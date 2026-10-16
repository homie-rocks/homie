import {test} from 'node:test';
import assert from 'node:assert/strict';
import {services} from '../worker/mcp-tools.mjs';

test('self secret capability follows the runtime origin without allowing other origins or redirects',async t=>{
  const secret='private-proof-credential';
  const cat={games:[],studio:{mcp:{secrets:{API_TOKEN:{origin:'self',tools:['sync']}}}}};
  const make=(origin,owner=true,name='sync')=>services({API_TOKEN:secret},cat,origin,{id:'person',owner},name,{name});
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    calls++;assert.equal(url.origin,'https://new-studio.example');
    assert.equal(init.redirect,'error');assert.equal(init.headers.get('authorization'),'Bearer '+secret);
    return new Response('done');
  });
  assert.equal(await (await make('https://new-studio.example').fetchWithSecret('API_TOKEN','/api/sync')).text(),'done');
  await make('https://new-studio.example',false).fetchWithSecret('API_TOKEN','https://new-studio.example/api/sync');
  for(const url of ['https://outside.example/api','//outside.example/api','http://new-studio.example/api','https://user:pass@new-studio.example/api']) {
    await assert.rejects(make('https://new-studio.example').fetchWithSecret('API_TOKEN',url),/refused/);
  }
  await assert.rejects(make('http://localhost:8787').fetchWithSecret('API_TOKEN','/api'),/refused/);
  await assert.rejects(make('https://new-studio.example',false,'other').fetchWithSecret('API_TOKEN','/api'),/refused/);
  assert.equal(calls,2);
});
