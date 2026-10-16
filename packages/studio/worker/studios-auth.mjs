import {decode,originKey,verifyBytes} from './studios-keys.mjs';
import {oauthStorage,audit} from './mcp-store.mjs';
import {studioOrigin} from './studios-client.mjs';
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','pragma':'no-cache',...(status===401?{'www-authenticate':'Bearer'}:{})}});
export async function boundedBody(request,maxBytes=65536) {
 const reader=request.body?.getReader();if(!reader)return '';
 const chunks=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw new Error('Request size exceeded');chunks.push(value);}}
 catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
 const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}return new TextDecoder('utf-8',{fatal:true}).decode(body);
}
export function studioRegistration(cat,origin){
 for(const rule of Object.values(cat.studio?.mcp?.studios?.inbound??{})){
  try{if(studioOrigin(rule.origin,{allowPrivate:rule.allowPrivate===true})===origin&&rule.enabled!==false)return rule;}catch{/* Invalid configuration is denied. */}
 }
 return null;
}
export async function setStudioPolicy(env,origin,allow){
 origin=studioOrigin(origin,{allowPrivate:true});
 await oauthStorage(env.DB).put('studio-policy:'+origin,JSON.stringify({allow:allow===true}));
}
export async function studioPolicy(env,cat,origin){
 const rule=studioRegistration(cat,origin);
 return rule&&(await oauthStorage(env.DB).get('studio-policy:'+origin,'json'))?.allow===true?rule:null;
}
/** RFC 7523 client authentication. Only the claimed origin's HTTPS JWKS can prove it. */
export async function studioToken(request,env,cat,options={}) {
 if(request.method!=='POST')return null;
 let form;try{form=new URLSearchParams(await boundedBody(request.clone(),8192));}catch{return json({error:'invalid_request'},400);}
 if(form.get('grant_type')!=='client_credentials')return null;
 const receiver=new URL(request.url).origin;
 if(!receiver.startsWith('https:')||form.getAll('resource').length!==1||form.get('resource')!==receiver+'/mcp')return json({error:'invalid_target'},400);
 if(form.has('scope')&&form.get('scope')!=='studio')return json({error:'invalid_scope'},400);
 let origin,stage='assertion';
 try{
  for(const name of ['client_assertion','client_assertion_type','client_id'])if(form.getAll(name).length!==1)throw Error();
  if(form.get('client_assertion_type')!=='urn:ietf:params:oauth:client-assertion-type:jwt-bearer')throw Error();
  const parts=form.get('client_assertion').split('.');if(parts.length!==3)throw Error();
  const header=decode(parts[0]),claims=decode(parts[1]);origin=claims.iss;
  stage='policy';
  const rule=await studioPolicy(env,cat,origin);if(!rule)throw Error();
  stage='claims';
  if(studioOrigin(origin,{allowPrivate:rule.allowPrivate===true})!==origin||form.get('client_id')!==origin||claims.sub!==origin||claims.aud!==receiver+'/oauth/token'||header.alg!=='EdDSA'||header.jku||header.jwk||header.crit)throw Error();
  const now=Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(claims.exp)||!Number.isSafeInteger(claims.iat)||claims.iat>now+30||claims.iat<now-300||claims.exp<=now||claims.exp>claims.iat+300||claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>now)||typeof claims.jti!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(claims.jti))throw Error();
  stage='key discovery';
  const key=await originKey(env,origin,header.kid,{...options,allowPrivate:rule.allowPrivate===true});
  stage='signature';
  if(!await verifyBytes(key,parts[2],parts.slice(0,2).join('.')))throw Error();
  stage='replay';
  const used=await env.DB.prepare('INSERT OR IGNORE INTO mcp_kv(key,value,expires) VALUES(?1,?2,?3) RETURNING key').bind('studio-jti:'+await hash(JSON.stringify([origin,claims.jti])),'1',claims.exp).first();if(!used)throw Error();
 }catch{
  await audit(env,{client:typeof origin==='string'?origin.slice(0,2048):null},'studio-auth','denied:'+stage);
  return json({error:'invalid_client',error_description:'Studio authentication failed'},401);
 }
 const token='homie_studio_'+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const record={origin,resource:receiver+'/mcp',expires:Math.floor(Date.now()/1000)+300};
 await oauthStorage(env.DB).put('studio-token:'+await hash(token),JSON.stringify(record),{expiration:record.expires});
 return json({access_token:token,token_type:'Bearer',expires_in:300,scope:'studio'});
}
/** Live D1 policy is re-read on every dispatch; handles only separate booking ownership. */
export async function studioCaller(request,env,cat) {
 const token=/^Bearer (homie_studio_[a-f0-9]{64})$/.exec(request.headers.get('authorization')??'')?.[1];if(!token)return null;
 const record=await oauthStorage(env.DB).get('studio-token:'+await hash(token),'json');
 if(!record||record.expires<=Date.now()/1000||record.resource!==new URL(request.url).origin+'/mcp')return null;
 const rule=await studioPolicy(env,cat,record.origin);if(!rule)return null;
 let assertedHandle;try{const raw=request.headers.get('x-studio-asserted-handle');if(raw!==null){assertedHandle=decodeURIComponent(raw);if(!/^[A-Za-z0-9._@-]{1,128}$/.test(assertedHandle))return null;}}catch{return null;}
 return {id:'studio:'+await hash(JSON.stringify([record.origin,assertedHandle??null])),owner:false,roles:{},client:record.origin,tools:rule.tools??[],
  studio:{origin:record.origin,verified:true,method:'private_key_jwt'},...(assertedHandle===undefined?{}:{actingFor:{assertedHandle,verified:false,assertedBy:record.origin}})};
}
