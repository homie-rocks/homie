import {oauthStorage} from './mcp-store.mjs';
/** A hashed bearer, bound to this origin and exact tool names; re-read on every dispatch. */
export async function tokenCaller(request,env) {
 const token=/^Bearer (homie_owner_[a-f0-9]{64})$/.exec(request.headers.get('authorization')??'')?.[1];if(!token)return null;
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
 const id=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
 const row=await oauthStorage(env.DB).get('connector:'+id,'json');
 if(!row||row.origin!==new URL(request.url).origin||row.expires<=Date.now()/1000)return null;
 return {id:'connector:'+id,owner:true,client:'owner-connector',connection:'connector:'+id,tools:row.tools};
}
export function toolInScope(caller,name){return !caller.tools||caller.tools.includes(name);}
