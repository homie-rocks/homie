/** Experimental MCP Events design sketch (2026-10-14 snapshot).
 * Keep draft method names, envelopes, schemas and provisional codes here.
 * https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/13e0a59749cde947374aaa8e3a65f0b424468d5a/docs/design-sketch-proposal.md
 */
export const eventsCapability={events:{listChanged:true}};
export const eventMethods=new Set(['events/list','events/poll','events/stream','events/subscribe','events/unsubscribe']);
const messages={[-32602]:'InvalidParams',[-32023]:'NotFound',[-32024]:'Forbidden',[-32025]:'ResourceExhausted',[-32026]:'Unsupported',[-32027]:'CallbackEndpointError'};
export class EventsError extends Error {
  constructor(code,data){super(messages[code]);this.code=code;this.data=data;}
}
export const invalid=()=>{throw new EventsError(-32602);};
export function eventError(error){return error instanceof EventsError?{code:error.code,message:error.message,...(error.data?{data:error.data}:{})}:{code:-32603,message:'Internal error'};}
export function eventDescriptor(name,feed){return {name,description:feed.description??`Studio ${feed.event} events; untrusted data`,delivery:['poll','push','webhook'],inputSchema:{type:'object',properties:{},additionalProperties:false},payloadSchema:{type:'object'}};}
export function occurrence(name,event,cursor){return {eventId:event.id,name,timestamp:new Date(event.at).toISOString(),data:event.data,...(cursor===undefined?{}:{cursor})};}
export const cursorOf=(name,seq)=>'v1:'+name+':'+seq;
export function cursorPosition(name,cursor){if(cursor==null)return null;if(typeof cursor!=='string'||!cursor.startsWith('v1:'+name+':'))invalid();const value=cursor.slice(name.length+4);if(!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value)))invalid();return Number(value);}
export function validateEventParams(params,{list=false}={}){
  if(!params||typeof params!=='object'||Array.isArray(params))invalid();
  if(list){if(params.cursor!=null)invalid();return;}
  if(typeof params.name!=='string'||!params.name)invalid();
  if(params.arguments!==undefined&&(!params.arguments||typeof params.arguments!=='object'||Array.isArray(params.arguments)||Object.keys(params.arguments).length))invalid();
  cursorPosition(params.name,params.cursor);
  for(const key of ['maxAgeMs','maxEvents','ttlMs'])if(params[key]!==undefined&&!(key==='ttlMs'&&params[key]===null)&&(!Number.isSafeInteger(params[key])||params[key]<(key==='maxEvents'?1:0)))invalid();
}
export function callbackUrl(value){let url;try{url=new URL(value);}catch{invalid();}if(url.protocol!=='https:'||url.username||url.password||url.hash)invalid();return url.href;}
export function signingSecret(value){if(typeof value!=='string'||!/^whsec_(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))invalid();let raw;try{raw=atob(value.slice(6));}catch{invalid();}if(raw.length<24||raw.length>64||btoa(raw)!==value.slice(6))invalid();return value;}
export const notification=(type,params,id)=>({jsonrpc:'2.0',method:'notifications/events/'+type,params:{...params,...(id===undefined?{}:{_meta:{'io.modelcontextprotocol/subscriptionId':id}})}});
export const sseFrame=value=>new TextEncoder().encode('event: message\ndata: '+JSON.stringify(value)+'\n\n');
export const streamResult=id=>({jsonrpc:'2.0',id,result:{_meta:{}}});
export const control=(type,fields)=>({type,...fields});
export const subscriptionResult=(sub,cursor,truncated,deliveryStatus)=>({id:sub.id,refreshBefore:new Date(sub.expires).toISOString(),cursor,truncated,...(deliveryStatus?{deliveryStatus}:{})});
export const subscriptionHeaders=id=>({'X-MCP-Subscription-Id':id});
