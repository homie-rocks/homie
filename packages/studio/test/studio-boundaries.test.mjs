import {test} from 'node:test';
import assert from 'node:assert/strict';
import {studioOrigin,studiosClient,studioResult} from '../worker/studios-client.mjs';
import {services} from '../worker/mcp-tools.mjs';
test('studio limits aggregate asserted handles and anonymous callers have an address key',async()=>{
 const keys=[],env={LIMIT:{limit:async({key})=>{keys.push(key);return true;}}},cat={studio:{mcp:{rateLimits:{calls:{binding:'LIMIT',tools:['test']}}}}};
 for(const id of ['alice','bob'])await services(env,cat,'https://b.example',{id,studio:{origin:'https://a.example'}},'test',{name:'test'}).rateLimit('calls');
 assert.equal(keys[0],keys[1]);assert.equal(JSON.parse(keys[0])[1],'studio:https://a.example');
 await services(env,cat,'https://b.example',{clientAddressKey:'public:192.0.2.1'},'test',{name:'test'}).rateLimit('calls');
 assert.equal(JSON.parse(keys[2])[1],'public:192.0.2.1');
});
test('unsafe origins are refused and unknown destinations never silently become anonymous',async()=>{
 for(const host of ['127.0.0.1','[::1]','[::ffff:127.0.0.1]','169.254.169.254','2130706433','0x7f000001','localhost','a.localhost','a.local','a.internal','a.example:8443'])assert.throws(()=>studioOrigin('https://'+host),host);
 const c=studiosClient({}, {}, {name:'test'});await assert.rejects(()=>c.listTools('https://unknown.example'),/configured/i);
});
test('remote results retain provenance and explicit untrusted marker',()=>{
 const r=studioResult({structuredContent:{kind:'untrusted-tool-data',data:{x:1}}},{origin:'https://a.example',authenticated:true});
 assert.equal(r.untrusted,true);assert.deepEqual(r.source,{origin:'https://a.example',authenticated:true});
});
