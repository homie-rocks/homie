import {CfWorkerJsonSchemaValidator} from '@modelcontextprotocol/server/validators/cf-worker';
import {signControl} from './office.mjs';
import {allowed} from './mcp-tools.mjs';
/** A tool must declare each external event and its schema; it cannot impersonate player input. */
export async function sendToolEvent(env,caller,definition,{game,room,event,data}) {
  const declaration=definition.events?.[event];
  if(!declaration||declaration.game!==game||!/^external:[a-z][a-z0-9_-]{0,40}$/.test(event)||!/^[A-Za-z0-9_-]{1,32}$/.test(room))throw new Error('event not declared');
  if(!await allowed(declaration.audience??'owner',caller,env))throw new Error('event permission denied');
  if(!new CfWorkerJsonSchemaValidator().getValidator(declaration.schema)(data).valid)throw new Error('event input invalid');
  if(JSON.stringify(data).length>8192)throw new Error('event too large');
  const ctl=await signControl(env,{op:'mcp-event',game,room,args:{event,data,person:caller.id}});
  const response=await env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`)).fetch(`https://table/__mcp-event?game=${game}&room=${room}`,{method:'POST',body:JSON.stringify(ctl)});
  const result=await response.json();if(!response.ok)throw new Error('room refused event');return result;
}
