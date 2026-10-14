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
