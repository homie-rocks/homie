import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from './s2s-fixture.mjs';
import {studioToken,studioCaller,setStudioPolicy} from '../worker/studios-auth.mjs';
import {signAssertion,publicKeys} from '../worker/studios-keys.mjs';
import {allowed} from '../worker/mcp-tools.mjs';
export async function keyEnv(){const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);return {STUDIO_SIGNING_KEY:JSON.stringify({...await crypto.subtle.exportKey('jwk',pair.privateKey),kid:crypto.randomUUID()})};}
test('origin proof, deny by default, replay, audience, handles, rotation and immediate denial',async t=>{
 const sender=await keyEnv(),env={DB:database(t)},cat={studio:{mcp:{studios:{inbound:{concierge:{origin:'https://a.example',tools:['book']}}}}}};
 let keys=publicKeys(sender),fetches=0;const options={fetchFn:async req=>{assert.equal(req.url,'https://a.example/.well-known/jwks.json');fetches++;return Response.json(keys);}};
 const request=async(audience='https://b.example/oauth/token')=>new Request('https://b.example/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'client_credentials',client_id:'https://a.example',client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',client_assertion:await signAssertion(sender,'https://a.example',audience),resource:'https://b.example/mcp',scope:'studio'})});
 assert.equal((await studioToken(await request(),env,cat,options)).status,401);assert.equal(fetches,0);
 await setStudioPolicy(env,'https://a.example',true);
 assert.equal((await studioToken(await request('https://evil.example'),env,cat,options)).status,401);
 const req=await request(),response=await studioToken(req.clone(),env,cat,options);assert.equal(response.status,200);
 assert.equal((await studioToken(req,env,cat,options)).status,401);
 const token=await response.json(),call=(handle='Alex')=>new Request('https://b.example/mcp/auth',{headers:{authorization:'Bearer '+token.access_token,'x-studio-asserted-handle':handle}});
 const caller=await studioCaller(call(),env,cat);assert.equal(caller.studio.verified,true);assert.deepEqual(caller.actingFor,{assertedHandle:'Alex',verified:false,assertedBy:'https://a.example'});
 assert.equal(await allowed('signed-in',caller,env),false);assert.equal(await studioCaller(call('Alex%20Admin'),env,cat),null);
 const rotated=await keyEnv();keys={keys:[...keys.keys,...publicKeys(rotated).keys]};sender.STUDIO_SIGNING_KEY=rotated.STUDIO_SIGNING_KEY;
 env.DB.sql.exec("UPDATE mcp_kv SET value=json_set(value,'$.at',0) WHERE key LIKE 'studio-jwks:%'");
 assert.equal((await studioToken(await request(),env,cat,options)).status,200);assert.equal(fetches,2);
 await setStudioPolicy(env,'https://a.example',false);assert.equal(await studioCaller(call(),env,cat),null);
});
