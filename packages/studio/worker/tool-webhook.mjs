import {allowed,services} from './mcp-tools.mjs';
import {rateLimit,audit,callsPerMinute} from './mcp-store.mjs';
import {CfWorkerJsonSchemaValidator} from '@modelcontextprotocol/server/validators/cf-worker';
/** HMAC-SHA256(timestamp + '.' + delivery id + '.' + exact request body). */
export async function toolWebhook(request,env,{cat,definitions}) {
  const name=new URL(request.url).pathname.split('/').pop(),tool=definitions.find(t=>t.name===name&&t.webhook);
  const fail=(status)=>Response.json({ok:false},{status});
  if(!tool||request.method!=='POST')return fail(404);
  if(tool.price)return Response.json({ok:false,error:'Use /mcp to approve and pay for this tool'},{status:402});
  const timestamp=request.headers.get('x-studio-timestamp')??'',delivery=request.headers.get('x-studio-delivery')??'',signature=request.headers.get('x-studio-signature')??'';
  if(!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300||!/^[a-zA-Z0-9_-]{8,100}$/.test(delivery)||!/^[a-f0-9]{64}$/.test(signature))return fail(401);
  const secret=env[tool.webhook.secret];if(typeof secret!=='string'||secret.length<32)return fail(503);
  const body=await request.text();if(body.length>65536)return fail(413);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(signature.match(/../g),b=>parseInt(b,16));
  if(!await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(`${timestamp}.${delivery}.${body}`)))return fail(401);
  const person=await env.DB.prepare('SELECT id,name,owner,guest FROM players WHERE id=?1').bind(tool.webhook.person).first();
  const caller={id:person?.id,owner:person?.owner===1,client:'webhook:'+name};let outcome='denied';
  try{
    if(!person||person.guest||!await allowed(tool.audience,caller,env))return fail(403);
    const limit=callsPerMinute(cat);
    if(!await rateLimit(env,caller.client,limit)){outcome='limited';return fail(429);}
    const value=JSON.parse(body),validate=new CfWorkerJsonSchemaValidator().getValidator(tool.inputSchema);
    if(!validate(value).valid){outcome='invalid';return fail(400);}
    const result=await env.DB.prepare('INSERT OR IGNORE INTO mcp_kv(key,value,expires) VALUES(?1,?2,?3)').bind(`delivery:${name}:${delivery}`,'true',Math.floor(Date.now()/1000)+600).run();
    if(!result.meta.changes){outcome='replay';return fail(409);}
    await tool.handler(value,services(env,cat,new URL(request.url).origin,caller,tool.namespace??tool.name,tool));outcome='ok';return Response.json({ok:true});
  }catch{outcome='error';return fail(400);}finally{await audit(env,caller,name,outcome);}
}
