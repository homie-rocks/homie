/** Dynamic Worker/Facet outbound capability. Only the supervisor supplies props. */
import {WorkerEntrypoint} from 'cloudflare:workers';
import outbound from './outbound.mjs';
export class Egress extends WorkerEntrypoint {
 fetch(request){return outbound.fetch(request,{CONTROL_HOSTS:this.env.CONTROL_HOSTS,tenant:this.ctx.props.tenant});}
 async connect(socket){
  // No raw TCP is authorized for managed tenants. Closing this intercepted socket
  // never opens a network connection to its requested destination.
  await socket.close();
 }
}
