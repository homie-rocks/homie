import {test} from 'node:test';import assert from 'node:assert/strict';
import {synthetic} from '../synthetic.mjs';import {health} from '../provider.mjs';
const preview='https://hm-s2-dispatch.ryan-d2f.workers.dev';
test('edge probes use manual redirects and the expected test origin',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(options.redirect,'manual');assert.equal(new URL(url).origin,preview);calls.push(url);return Response.json(url.endsWith('/mcp')?{result:{}}:url.includes('/api/games')?{studio:{build:{commit:'a'.repeat(40)}}}:{ok:true,order:'synthetic',booking:'synthetic'});});
 assert.equal((await synthetic(preview)).synthetic,true);assert.equal((await health(preview,'a'.repeat(40))).ok,true);assert.equal(calls.length,4);
});
test('preview redirects cannot send a booking to another origin',async t=>{
 t.mock.method(globalThis,'fetch',async url=>url.endsWith('/mcp')?Response.json({result:{}}):new Response(null,{status:307,headers:{location:'https://example.invalid'}}));
 await assert.rejects(synthetic(preview),/redirect rejected/);
});
