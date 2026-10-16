import {oauthStorage} from './mcp-store.mjs';
import {studioOrigin,boundedStudioFetch} from './studios-client.mjs';
const bytes=text=>new TextEncoder().encode(text);
export const base64=value=>btoa(String.fromCharCode(...new Uint8Array(value)));
export const unbase64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const encode=value=>base64(bytes(JSON.stringify(value))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export const decode=value=>JSON.parse(new TextDecoder().decode(unbase64(value.replaceAll('-','+').replaceAll('_','/'))));
export function publicKeys(env){
 const current=JSON.parse(env.STUDIO_SIGNING_KEY??'null');
 const keys=[current,...JSON.parse(env.STUDIO_PREVIOUS_PUBLIC_KEYS??'[]')].filter(Boolean);
 return {keys:keys.map(({kty,crv,x,kid})=>({kty,crv,x,kid,alg:'EdDSA',use:'sig'}))};
}
export async function signBytes(env,text){
 const jwk=JSON.parse(env.STUDIO_SIGNING_KEY??'null');
 if(!jwk?.kid||jwk.crv!=='Ed25519'||!jwk.d)throw new Error('Studio signing key unavailable');
 const key=await crypto.subtle.importKey('jwk',{...jwk,alg:'EdDSA'},'Ed25519',false,['sign']);
 return {kid:jwk.kid,signature:base64(await crypto.subtle.sign('Ed25519',key,bytes(text)))};
}
export async function signAssertion(env,origin,audience){
 const jwk=JSON.parse(env.STUDIO_SIGNING_KEY??'null'),now=Math.floor(Date.now()/1000);
 const text=encode({alg:'EdDSA',typ:'JWT',kid:jwk?.kid})+'.'+encode({iss:origin,sub:origin,aud:audience,iat:now,exp:now+60,jti:crypto.randomUUID()});
 return text+'.'+(await signBytes(env,text)).signature.replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
/** D1 cache is cross-invocation; unknown kid refreshes once, with a short negative-cache bound. */
export async function originKey(env,origin,kid,{fetchFn=globalThis.fetch.bind(globalThis),allowPrivate=false}={}){
 origin=studioOrigin(origin,{allowPrivate});
 if(typeof kid!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(kid))throw new Error('Invalid key id');
 const store=oauthStorage(env.DB),cacheKey='studio-jwks:'+origin,now=Date.now();
 let cached=await store.get(cacheKey,'json');
 if(!cached||cached.until<=now||!cached.keys.some(k=>k.kid===kid)&&now-cached.at>=1000){
  const fetch=boundedStudioFetch(origin,AbortSignal.timeout(5000),{fetchFn,maxBytes:32768});
  const response=await fetch(origin+'/.well-known/jwks.json');if(!response.ok)throw new Error('Studio keys unavailable');
  const jwks=await response.json();
  if(!Array.isArray(jwks.keys)||jwks.keys.length>8||jwks.keys.some(k=>k.d))throw new Error('Invalid studio keys');
  cached={keys:jwks.keys,at:now,until:now+300000};await store.put(cacheKey,JSON.stringify(cached),{expirationTtl:300});
 }
 const matches=cached.keys.filter(k=>k.kid===kid&&k.kty==='OKP'&&k.crv==='Ed25519'&&(!k.alg||k.alg==='EdDSA')&&(!k.use||k.use==='sig'));
 if(matches.length!==1)throw new Error('Unknown studio key');
 return crypto.subtle.importKey('jwk',matches[0],'Ed25519',false,['verify']);
}
export async function verifyBytes(key,signature,text){return crypto.subtle.verify('Ed25519',key,unbase64(signature.replaceAll('-','+').replaceAll('_','/')),bytes(text));}
