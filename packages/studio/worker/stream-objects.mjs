import {readOnlyEnv} from './read-only.mjs';
/** Streams use independent namespaces so subscribers never warm matchmaking state. */
export class AppRecordHub {
  constructor(ctx, env) { this.ctx=ctx; this.env=readOnlyEnv(env); }
  async fetch(request) {
    const {AppRecordStreams}=await import('./app-streams.mjs');
    this.streams??=new AppRecordStreams(this.env,this.ctx);
    const input=await request.json();
    return input.op==='open'?this.streams.open(input):this.streams.wake(input.meta);
  }
}
export class EventHub {
  constructor(ctx, env) { this.ctx=ctx; this.env=readOnlyEnv(env); }
  async fetch(request) {
    const {EventStreams}=await import('./event-resources.mjs');
    this.streams??=new EventStreams(this.env,this.ctx);
    return this.streams.fetch(request);
  }
}
