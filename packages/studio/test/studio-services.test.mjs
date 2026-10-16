import {test} from 'node:test';
import assert from 'node:assert/strict';
import {services} from '../worker/mcp-tools.mjs';
import {useRoutes} from '../worker/custom-routes.mjs';
import {toolIdentity} from '../worker/tool-identity.mjs';
const caller={id:'friend',owner:false,client:'phone',roles:{}};
test('own routes receive the friend identity without credentials or network forwarding',async t=>{
 t.after(()=>useRoutes(null));
 useRoutes(request=>Response.json({identity:toolIdentity(request),authorization:request.headers.get('authorization')}));
 const ctx=services({}, {games:[]}, 'https://studio.example',caller,'test');
 const result=await (await ctx.fetchSelf('/api/friend',{method:'POST',body:'{}'})).json();
 assert.equal(result.identity.id,'friend');assert.equal(result.identity.owner,false);assert.equal(result.authorization,null);
 for(const path of ['https://evil.example/api','//evil.example/api'])await assert.rejects(()=>ctx.fetchSelf(path),/origin/);
 await assert.rejects(()=>ctx.fetchSelf('/api',{headers:{authorization:'Bearer fake'}}),/credentials/);
});
test('shared rate limits use a declared binding and stable namespace plus caller key',async()=>{
 const seen=[];const env={FRIENDS:{limit:async input=>{seen.push(input.key);return {success:seen.length<2};}}};
 const cat={games:[],studio:{mcp:{rateLimits:{friends:{binding:'FRIENDS',tools:['a','b']}}}}};
 const a=services(env,cat,'https://studio.example',caller,'a',{name:'a'});
 const b=services(env,cat,'https://studio.example',caller,'b',{name:'b'});
 assert.deepEqual(await a.rateLimit('friends'),{success:true});assert.deepEqual(await b.rateLimit('friends'),{success:false});
 assert.equal(seen[0],seen[1]);
 await assert.rejects(()=>services(env,cat,'https://studio.example',caller,'c',{name:'c'}).rateLimit('friends'),/not declared/);
 await assert.rejects(()=>services(env,cat,'https://studio.example',{id:null},'a',{name:'a'}).rateLimit('friends'),/key required/);
});
