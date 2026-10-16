import {readOnlyEnv} from './read-only.mjs';
/** Streams use independent namespaces so subscribers never warm matchmaking state. */
export class AppRecordHub {
  constructor(ctx, env) { this.ctx=ctx; this.env=readOnlyEnv(env); }
  async records(){const {AppRecordStreams}=await import('./app-streams.mjs');return this.streams??=new AppRecordStreams(this.env,this.ctx);}
  async fetch(request) {
    const streams=await this.records();
    if(request.headers.get('upgrade')?.toLowerCase()==='websocket'){
      const meta=JSON.parse(request.headers.get('x-homie-app-meta')||'{}');
      const page=request.headers.get('x-homie-live-page')||request.url;
      return streams.open({meta,url:page,headers:Object.fromEntries(request.headers),collections:new URL(request.url).searchParams.getAll('collection')});
    }
    const input=await request.json();
    return input.op==='open'?streams.open(input):streams.wake(input.meta);
  }
  webSocketMessage(){}
  async webSocketClose(socket){return (await this.records()).closeSocket(socket);}
  async webSocketError(socket){return (await this.records()).closeSocket(socket);}
}
export class EventHub {
  constructor(ctx, env) { this.ctx=ctx; this.env=readOnlyEnv(env); }
  async fetch(request) {
    const {EventStreams}=await import('./event-resources.mjs');
    this.streams??=new EventStreams(this.env,this.ctx);
    return this.streams.fetch(request);
  }
}
