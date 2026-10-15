import worker from '../../studio/worker/index.mjs';
import {instrument} from '../probe.mjs';
import {DurableObject} from 'cloudflare:workers';
import {connect} from 'cloudflare:sockets';
export {Table,Lobby,Gate,Concentrator} from '../../studio/worker/index.mjs';
export class OwnerRoom extends DurableObject {
 instance=crypto.randomUUID();
 async fetch(r){const u=new URL(r.url);
  if(u.pathname==='/delay'){await this.ctx.storage.put('pending',true);await new Promise(r=>setTimeout(r,30000));await this.ctx.storage.put('finished',true);return new Response('finished')}
  if(u.pathname==='/ordinary'){const pair=new WebSocketPair();pair[1].accept();pair[1].addEventListener('message',e=>pair[1].send(e.data));return new Response(null,{status:101,webSocket:pair[0]})}
  if(u.pathname==='/alarm'){await this.ctx.storage.setAlarm(Date.now()+500);return new Response('armed')}
  if(u.pathname==='/fetch'){console.log(JSON.stringify({event:'fixture-egress',kind:'do',target:new URL(u.searchParams.get('target')).hostname}));return fetch(u.searchParams.get('target'),{headers:{'x-homie-tenant':'victim'}});}
  if(u.pathname==='/tcp'){try{const s=connect({hostname:'127.0.0.1',port:80});await s.opened;await s.close();return new Response('connected')}catch(e){return new Response(String(e))}}
  if(u.pathname==='/ws'){const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);return new Response(null,{status:101,webSocket:pair[0]})}
  return Response.json({instance:this.instance,alarms:await this.ctx.storage.get('alarms')??0,n:await this.ctx.storage.get('n')??0,pending:await this.ctx.storage.get('pending')??false,finished:await this.ctx.storage.get('finished')??false,alarm:await this.ctx.storage.getAlarm()});
 }
 async alarm(){await this.ctx.storage.put('alarms',(await this.ctx.storage.get('alarms')??0)+1);await this.ctx.storage.setAlarm(Date.now()+500)}
 async webSocketMessage(ws,m){await this.ctx.storage.put('n',(await this.ctx.storage.get('n')??0)+1);ws.send(m)}
}
const measured=instrument(worker);
export default {
 async fetch(r,env,ctx){const u=new URL(r.url);
  if(u.pathname==='/probe/echo')return Response.json({tenant:r.headers.get('x-homie-tenant')});
  if(u.pathname==='/probe/worker-fetch'){console.log(JSON.stringify({event:'fixture-egress',kind:'worker',target:new URL(u.searchParams.get('target')).hostname}));return fetch(u.searchParams.get('target'),{headers:{'x-homie-tenant':'victim'}});
  }
  if(u.pathname==='/probe/bindings')return Response.json({bindings:Object.keys(env),props:ctx.props,cf:!!r.cf});
  if(u.pathname.startsWith('/probe/owner/')){u.pathname=u.pathname.replace('/probe/owner','');return env.OWNER.getByName(u.searchParams.get('object')??'custom').fetch(new Request(u,r))}
  if(u.pathname.startsWith('/probe/gate/')){u.pathname='/__diagnostics';return env.GATE.getByName('gate').fetch(new Request(u,r))}
  if(u.pathname.startsWith('/probe/concentrator/')){u.pathname='/__diagnostics';return env.CONCENTRATOR.getByName('concentrator').fetch(new Request(u,r))}
  return measured.fetch(r,env,ctx);
 },
 async scheduled(e,env,ctx){return measured.scheduled(e,env,ctx)}
};
