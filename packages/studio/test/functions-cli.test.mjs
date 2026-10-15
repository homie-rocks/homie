import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newStudio} from '../lib/scaffold.mjs';
import {writeLocal} from '../lib/studio.mjs';
import {functionCommand} from '../lib/functions-cli.mjs';
test('functions runs reads the deployed owner connection, forwards filters, and closes on error',async t=>{
 const root=mkdtempSync(join(tmpdir(),'functions-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));newStudio(root,{name:'Cleanup',install:false});writeLocal(root,{url:'https://cleanup.example'});
 let closed=0,request,site;const connect=async(_,url)=>{site=url.origin;return {callTool:async args=>{request=args;return {content:[{type:'text',text:'{"runs":[]}'}]};},close:async()=>closed++};};
 const result=await functionCommand(root,'runs',['functions','runs','cleanup'],new Map([['errors',true],['before','101']]),{connect});
 assert.equal(result.ok,true);assert.equal(site,'https://cleanup.example');assert.equal(request.name,'studio_function_runs');assert.deepEqual(request.arguments,{name:'cleanup',errors:true,before:101});assert.equal(closed,1);
 await assert.rejects(functionCommand(root,'runs',['functions','runs'],new Map(),{connect:async()=>({callTool:async()=>{throw new Error('connection revoked');},close:async()=>closed++})}),/revoked/);assert.equal(closed,2);
});

test('MCP startup fetch retries a brief Cloudflare 1042 with notice and preserves the request body',async()=>{
 const {startupFetch}=await import('../lib/tools-cli.mjs');const messages=[],bodies=[];let calls=0;
 const call=startupFetch({log:line=>messages.push(line),sleep:async()=>{},fetch:async req=>{bodies.push(await req.text());return ++calls<3?new Response('error code: 1042',{status:500}):Response.json({ok:true});}});
 const response=await call(new Request('https://place.example/mcp',{method:'POST',body:'{"method":"initialize"}'}));
 assert.equal(response.status,200);assert.equal(calls,3);assert.deepEqual(bodies,Array(3).fill('{"method":"initialize"}'));assert.equal(messages.length,2);
 let ordinary=0;assert.equal((await startupFetch({sleep:async()=>assert.fail('no retry'),fetch:async()=>{ordinary++;return new Response('bad arguments',{status:400});}})('https://place.example/mcp')).status,400);assert.equal(ordinary,1);
});
