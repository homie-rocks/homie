import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import outbound from '../outbound-spike.mjs';
const code=`import {DurableObject} from 'cloudflare:workers';
import {connect} from 'cloudflare:sockets';
export class Tenant extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.boot=crypto.randomUUID()}
 async fetch(r){const u=new URL(r.url),p=u.pathname;
 if(p==='/fetch')return fetch(u.searchParams.get('target'),{headers:{'x-homie-tenant':'victim'}});
 if(p==='/tcp'){try{const s=connect({hostname:u.searchParams.get('target')||'127.0.0.1',port:80});await s.opened;return new Response(await new Response(s.readable).text())}catch(e){return new Response(String(e))}}
 if(p==='/alarm'){try{await this.ctx.storage.setAlarm(Date.now()+1000);return new Response('armed')}catch(e){return new Response(String(e),{status:501})}}
 if(p==='/ws'||p==='/hibernate'){try{const pair=new WebSocketPair();if(p==='/hibernate')this.ctx.acceptWebSocket(pair[1]);else{pair[1].accept();pair[1].addEventListener('message',e=>pair[1].send(e.data));}return new Response(null,{status:101,webSocket:pair[0]})}catch(e){return new Response(String(e),{status:501})}}
 if(p==='/pending'){await this.ctx.storage.put('pending',true);return fetch('https://delay.invalid/')}
 if(p==='/status')return Response.json({n:await this.ctx.storage.get('n')??0,alarms:await this.ctx.storage.get('alarms')??0,pending:await this.ctx.storage.get('pending')??false});
 const n=(await this.ctx.storage.get('n')??0)+1;await this.ctx.storage.put('n',n);return Response.json({n});}
 async alarm(){await this.ctx.storage.put('alarms',(await this.ctx.storage.get('alarms')??0)+1)}
 webSocketMessage(ws,m){ws.send(JSON.stringify({echo:m,boot:this.boot}))}
}`;
export class Egress extends WorkerEntrypoint {
 async fetch(r){
  const u=new URL(r.url),tenant=this.ctx.props.tenant;
  if(u.hostname==='delay.invalid'){await new Promise(r=>setTimeout(r,20000));return new Response('finished')}
  return outbound.fetch(r,{tenant,CONTROL_HOSTS:[this.env.CONTROL_HOST]});
 }
 async connect(socket){const info=await socket.opened;const w=socket.writable.getWriter();await w.write(new TextEncoder().encode(JSON.stringify({intercepted:'connect',tenant:this.ctx.props.tenant,address:info.localAddress,denied:true})));await w.close();}
}
export class Supervisor extends DurableObject {
 async fetch(r){const p=new URL(r.url).pathname;
  if(p==='/abort'){await this.ctx.storage.put('stopped',true);this.ctx.facets.abort('tenant',new Error('operator stopped'));return new Response('aborted')}
  if(p==='/resume'){await this.ctx.storage.put('stopped',false);return new Response('resumed')}
  if(p==='/delete'){this.ctx.facets.delete('tenant');return new Response('deleted')}
  if(await this.ctx.storage.get('stopped'))return new Response('stopped',{status:410});
  const facet=this.ctx.facets.get('tenant',()=>({class:this.env.LOADER.get('r3-v1',()=>({compatibilityDate:'2026-10-15',compatibilityFlags:['global_fetch_strictly_public'],mainModule:'tenant.js',modules:{'tenant.js':code},globalOutbound:this.ctx.exports.Egress({props:{tenant:'ordinary-studio'}})})).getDurableObjectClass('Tenant')}));
  try{return await facet.fetch(r)}catch(e){return new Response(String(e),{status:500})}
 }
}
export default {fetch(r,env){return env.SUPERVISOR.getByName(new URL(r.url).searchParams.get('case')||'probe-v2').fetch(r)}};
