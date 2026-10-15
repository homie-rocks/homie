/** Emergency storage-preserving replacement, deployed ONLY over a recorded test script. */
import {DurableObject} from 'cloudflare:workers';
class Stopped extends DurableObject {
 constructor(ctx,env){super(ctx,env);ctx.blockConcurrencyWhile(async()=>{await ctx.storage.deleteAlarm();for(const ws of ctx.getWebSockets())ws.close(1008,'tenant stopped');});}
 async fetch(){return Response.json({stopped:true,alarms:await this.ctx.storage.get('alarms')??0,n:await this.ctx.storage.get('n')??0})}
 async alarm(){await this.ctx.storage.deleteAlarm()}
 webSocketMessage(ws){ws.close(1008,'tenant stopped')}
 webSocketClose(){}
 webSocketError(){}
}
export class Table extends Stopped {} export class Lobby extends Stopped {} export class Gate extends Stopped {} export class Concentrator extends Stopped {} export class OwnerRoom extends Stopped {}
export default {fetch(r,env){if(new URL(r.url).pathname==='/probe/owner/status')return env.OWNER.getByName('custom').fetch(r);return new Response('tenant stopped',{status:410})}};
export class ExtraRoom extends Stopped {}
