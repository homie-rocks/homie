import {eventCaller,checkEvent,eventStart,pollEvents} from './mcp-events.mjs';
import {eventError,notification,sseFrame,streamResult,cursorOf} from './mcp-events-wire.mjs';

/** Connection-scoped push subscriptions hosted by the existing per-connection Lobby. */
export class McpEventStreams {
  constructor(env,ctx){this.env=env;this.ctx=ctx;this.streams=new Set();}
  close(stream){if(stream.closed)return;stream.closed=true;clearInterval(stream.timer);stream.resume?.();try{stream.controller.close();}catch{}this.streams.delete(stream);if(stream.registryKey)this.ctx.waitUntil(this.env.DB.prepare('DELETE FROM mcp_kv WHERE key=?1').bind(stream.registryKey).run().catch(()=>{}));}
  async write(stream,value,authorize){
    if(stream.closed)return false;
    if(stream.controller.desiredSize<=0)await new Promise(resolve=>{stream.resume=resolve;});
    if(stream.closed)return false;
    if(authorize)await authorize();
    try{stream.controller.enqueue(sseFrame(value));return true;}catch{this.close(stream);return false;}
  }
  wake(input){for(const stream of this.streams){if(input.cat)stream.cat=input.cat;this.pump(stream);}}
  pump(stream){if(stream.busy||stream.closed)return;stream.busy=true;this.ctx.waitUntil(this.deliver(stream).catch(()=>this.close(stream)).finally(()=>{stream.busy=false;}));}
  async open(input){
    try{
      const caller=await eventCaller(this.env,input.connection);await checkEvent(this.env,input.cat,caller,input.params);
      const start=await eventStart(this.env,input.params);
      const registryKey='mcp-event-stream:'+input.connection+':'+crypto.randomUUID();
      await this.env.DB.prepare('INSERT INTO mcp_kv(key,value,expires) VALUES(?1,?2,?3)').bind(registryKey,JSON.stringify({connection:input.connection}),Date.now()+60000).run();
      const stream={...input,registryKey,cursor:cursorOf(input.params.name,start.after),closed:false,busy:false};
      const body=new ReadableStream({start:controller=>{stream.controller=controller;controller.enqueue(sseFrame(notification('active',{cursor:stream.cursor,truncated:start.truncated},stream.id)));},pull:()=>{const resume=stream.resume;stream.resume=null;resume?.();},cancel:()=>this.close(stream)});
      this.streams.add(stream);
      // Heartbeats also recheck authorization, catch missed wakes and renew discovery.
      stream.timer=setInterval(()=>this.pump(stream),15000);
      this.pump(stream);
      return new Response(body,{headers:{'content-type':'text/event-stream','cache-control':'no-store'}});
    }catch(error){return Response.json({jsonrpc:'2.0',id:input.id,error:eventError(error)});}
  }
  async deliver(stream){
    try{
      let more=true;
      while(more&&!stream.closed){
        const caller=await eventCaller(this.env,stream.connection);
        const start=await eventStart(this.env,{name:stream.params.name,cursor:stream.cursor});
        if(start.truncated){stream.cursor=cursorOf(stream.params.name,start.after);await this.write(stream,notification('active',{cursor:stream.cursor,truncated:true},stream.id));}
        const page=await pollEvents(this.env,stream.cat,caller,{...stream.params,maxAgeMs:undefined,cursor:stream.cursor});
        for(const event of page.events){
          await checkEvent(this.env,stream.cat,await eventCaller(this.env,stream.connection),stream.params);
          if(!await this.write(stream,notification('event',event,stream.id),async()=>checkEvent(this.env,stream.cat,await eventCaller(this.env,stream.connection),stream.params)))return;
          stream.cursor=event.cursor;
        }
        stream.cursor=page.cursor;more=page.hasMore;
      }
      await this.env.DB.prepare('UPDATE mcp_kv SET expires=?2 WHERE key=?1').bind(stream.registryKey,Date.now()+60000).run();
      await this.write(stream,notification('heartbeat',{cursor:stream.cursor},stream.id));
    }catch(error){
      const details=eventError(error);
      if([-32023,-32024,-32026].includes(details.code)){
        await this.write(stream,notification('terminated',{error:details},stream.id));await this.write(stream,streamResult(stream.id));this.close(stream);
      }else await this.write(stream,notification('error',{error:details},stream.id));
    }
  }
}
