import {CfWorkerJsonSchemaValidator} from '@modelcontextprotocol/server/validators/cf-worker';
import {allowed,services} from './mcp-tools.mjs';
import {appAccess} from './app-records.mjs';
import {localSession} from './local-test.mjs';
import {players} from './players.mjs';
import {isOwner,sameOrigin} from './office.mjs';
import {audit,callsPerMinute,rateLimit} from './mcp-store.mjs';
const validator=new CfWorkerJsonSchemaValidator();
export async function invokeAppTool(tool,input,context){
 if(!validator.getValidator(tool.inputSchema)(input).valid)throw Object.assign(new Error('Input does not match the tool schema'),{status:400});
 return tool.handler(input,context);
}
export async function appCaller(request,env,meta,url){
 const access=await appAccess(request,env,meta,url);
 if(!access.ok)throw Object.assign(new Error(access.error),{status:access.status});
 const session=await localSession(request,env);
 if(session?.app===meta.id)return {id:`local-test-${session.app}-${session.role}`,owner:!session.remoteTest&&session.role==='owner',client:null,localTest:true,...(session.remoteTest?{remoteTest:true}:{}),roles:{[meta.id]:[session.role]},testApp:meta.id,testScope:session.scope};
 const person=await players.of(request,env);
 const owner=await isOwner(request,env);
 const roles={};
 if(person&&!person.guest){for(const row of (await env.DB.prepare('SELECT app,role FROM app_roles WHERE player=?1').bind(person.id).all()).results)(roles[row.app]??=[]).push(row.role);}
 return {id:owner?(person?.id??'browser-owner'):person&&!person.guest?person.id:null,owner,client:null,roles};
}
/** Same-origin shell transport; body fields never supply an identity or a role. */
export async function appToolsRoute(request,env,meta,url,cat,definitions){
 const fail=(status,error)=>Response.json({ok:false,error},{status});
 if(request.method!=='POST')return fail(405,'POST required');
 if(!sameOrigin(request,url))return fail(403,'same origin required');
 let caller,tool,outcome='error';
 try{
  caller=await appCaller(request,env,meta,url);
  const reader=request.body?.getReader();let size=0,text='';const decoder=new TextDecoder();
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>12288){await reader.cancel();return fail(413,'body too large');}text+=decoder.decode(value,{stream:true});}
  const body=JSON.parse(text+decoder.decode());
  tool=definitions.find(t=>t.name===body.name&&(!t.kind||t.kind==='tool'));
  if(!tool||!await allowed(tool.audience,caller,env)){outcome='denied';return fail(403,'Permission denied or unknown tool');}
  if(tool.price)return fail(402,'Use MCP to approve payment for this tool');
  if(!await rateLimit(env,caller.id??`public:${request.headers.get('cf-connecting-ip')??'local'}`,callsPerMinute(cat)))return fail(429,'Rate limit reached');
  const namespace=(tool.namespace??tool.name)+(caller.testScope?':check:'+caller.testScope:'');
  await env.DB.prepare('INSERT OR IGNORE INTO app_tool_namespaces(app,namespace) VALUES(?1,?2)').bind(meta.id+(caller.testScope?':check:'+caller.testScope:''),namespace).run();
  const data=await invokeAppTool(tool,body.input??{},services(env,cat,url.origin,caller,namespace,tool));
  outcome='ok';return Response.json({ok:true,data});
 }catch(error){return fail(error.status??(error instanceof SyntaxError?400:500),error.status||error.name==='StudioOperationError'?error.message:'Tool request failed');}
 finally{if(caller)await audit(env,caller,tool?.name??'unknown-tool',outcome);}
}
