import {timingSafeEqual} from 'node:crypto';
import {oauthStorage} from './mcp-store.mjs';
import {studioOrigin} from './studios-client.mjs';
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','pragma':'no-cache',...(status===401?{'www-authenticate':'Basic realm="studio"'}:{})}});
export async function boundedBody(request,maxBytes=65536) {
 const reader=request.body?.getReader();if(!reader)return '';
 const chunks=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw new Error('Request size exceeded');chunks.push(value);}}
 catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
 const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}return new TextDecoder('utf-8',{fatal:true}).decode(body);
}
function registration(cat,id){
 const entries=cat.studio?.mcp?.studios?.inbound??{};
 const rule=Object.hasOwn(entries,id)?entries[id]:null;
 if(!rule||rule.enabled===false||!Array.isArray(rule.tools))return null;
 try{return {...rule,origin:studioOrigin(rule.origin)};}catch{return null;}
}
/** RFC 6749 client credentials at the studio's existing token endpoint. */
export async function studioToken(request,env,cat) {
 if(request.method!=='POST')return null;
 let form;try{form=new URLSearchParams(await boundedBody(request.clone(),8192));}catch{return json({error:'invalid_request'},400);}
 if(form.get('grant_type')!=='client_credentials')return null;
 const origin=new URL(request.url).origin;
 if(!origin.startsWith('https:')||form.getAll('resource').length!==1||form.get('resource')!==origin+'/mcp')return json({error:'invalid_target'},400);
 if(form.has('scope')&&form.get('scope')!=='studio')return json({error:'invalid_scope'},400);
 let id,secret;
 try{const raw=atob(/^Basic (.+)$/.exec(request.headers.get('authorization')??'')[1]),split=raw.indexOf(':');if(split<0)throw Error();id=decodeURIComponent(raw.slice(0,split));secret=decodeURIComponent(raw.slice(split+1));}catch{return json({error:'invalid_client'},401);}
 const rule=registration(cat,id),expected=rule&&env[rule.secret];
 if(typeof expected!=='string'||expected.length<32||!timingSafeEqual(new TextEncoder().encode(await hash(expected)),new TextEncoder().encode(await hash(secret))))return json({error:'invalid_client'},401);
 const token='homie_studio_'+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const record={client:id,origin:rule.origin,resource:origin+'/mcp',credential:await hash(expected),expires:Math.floor(Date.now()/1000)+300};
 await oauthStorage(env.DB).put('studio-token:'+await hash(token),JSON.stringify(record),{expiration:record.expires});
 return json({access_token:token,token_type:'Bearer',expires_in:300,scope:'studio'});
}
/** Re-read the receiver's allowlist and credential on every tool dispatch. */
export async function studioCaller(request,env,cat) {
 const token=/^Bearer (homie_studio_[a-f0-9]{64})$/.exec(request.headers.get('authorization')??'')?.[1];if(!token)return null;
 const record=await oauthStorage(env.DB).get('studio-token:'+await hash(token),'json');
 if(!record||record.expires<=Date.now()/1000||record.resource!==new URL(request.url).origin+'/mcp')return null;
 const rule=registration(cat,record.client),secret=rule&&env[rule.secret];
 if(!rule||rule.origin!==record.origin||typeof secret!=='string'||await hash(secret)!==record.credential)return null;
 let handle;try{const raw=request.headers.get('x-studio-acting-for');if(raw!==null){handle=decodeURIComponent(raw);if(!handle.length||handle.length>128)return null;}}catch{return null;}
 return {id:'studio:'+await hash(JSON.stringify([rule.origin,handle??null])),owner:false,roles:{},client:record.client,tools:rule.tools,
  studio:{origin:rule.origin,verified:true,method:'oauth-client-credentials'},...(handle===undefined?{}:{actingFor:{handle,verified:false,assertedBy:rule.origin}})};
}
