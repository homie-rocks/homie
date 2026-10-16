import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signBytes,verifyBytes} from '../worker/studios-keys.mjs';
// Public test-only key: RFC 8032 section 7.1, TEST 1 (never a deployed credential).
// https://www.rfc-editor.org/rfc/rfc8032#section-7.1
const jwk={kty:'OKP',crv:'Ed25519',kid:'rfc8032-test-1',
 d:Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60','hex').toString('base64url'),
 x:Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex').toString('base64url')};
const env={STUDIO_SIGNING_KEY:JSON.stringify(jwk)};
test('Ed25519 matches RFC 8032 TEST 1 and Standard Webhooks exact message framing',async()=>{
 const {d,...publicJwk}=jwk,key=await crypto.subtle.importKey('jwk',publicJwk,'Ed25519',false,['verify']);
 const rfcSignature=Buffer.from('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b','hex').toString('base64');
 assert.equal((await signBytes(env,'')).signature,rfcSignature);assert.equal(await verifyBytes(key,rfcSignature,''),true);
 // Exact minified message from the spec's "Verifying webhook authenticity" example.
 // The spec's example header has no published key, so this fixed expected signature
 // was independently computed using Node/OpenSSL with the RFC test key above.
 // https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
 const message='msg_2KWPBgLlAfxdpx2AI54pPJ85f4W.1674087231.{"type":"contact.created","timestamp":"2022-11-03T20:26:10.344522Z","data":{"id":"1f81eb52-5198-4599-803e-771906343485"}}';
 const signature='pbpYBMlty2hExn4zt0UTGb6BaP2Vq5AfyzjB9GGV3x/wCJKd8UjOCf8Qhaji6TKY9C5eNMnlF0GG4udaO6B7Ag==';
 assert.equal((await signBytes(env,message)).signature,signature);assert.equal(await verifyBytes(key,signature,message),true);
 for(const changed of [message+' ',message.replace('1674087231','1674087232'),message.replace('msg_','other_')])assert.equal(await verifyBytes(key,signature,changed),false);
});
