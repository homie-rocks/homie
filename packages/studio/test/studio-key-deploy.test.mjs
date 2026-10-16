import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ensureStudioSigningKey} from '../lib/studios-keys.mjs';
test('deploy provisions a private key only on stdin, preserves existing keys, and redacts failures',async()=>{
 let calls=0,stored;
 const w=async(args,opts)=>{calls++;if(args[1]==='list')return {code:0,stdout:JSON.stringify(stored?[{name:'STUDIO_SIGNING_KEY'}]:[])};assert.deepEqual(args,['secret','bulk']);stored=JSON.parse(opts.input);return {code:0};};
 await ensureStudioSigningKey({},w);assert.equal(calls,0);
 assert.equal(await ensureStudioSigningKey({mcp:{studios:{}}},w),undefined);
 const key=JSON.parse(stored.STUDIO_SIGNING_KEY);assert.equal(key.crv,'Ed25519');assert.ok(key.d);assert.ok(key.kid);
 await ensureStudioSigningKey({mcp:{studios:{}}},w);assert.equal(calls,3);
 await assert.rejects(()=>ensureStudioSigningKey({mcp:{studios:{}}},async args=>args[1]==='list'?{code:0,stdout:'[]'}:{code:1,out:'private-key-must-never-leak'}),error=>!error.message.includes('private-key-must-never-leak'));
});
