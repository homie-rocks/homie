/** Generated standard entries load room engines only when their object is used.
 * Custom subclasses retain their own exports and do not use this adapter. */
export class Table {
  constructor(ctx,env) {
    this.ready=ctx.blockConcurrencyWhile(async()=>{this.room=new (await import('./table.mjs')).Table(ctx,env);});
  }
  async fetch(request) {await this.ready;return this.room.fetch(request);}
  async alarm() {await this.ready;return this.room.alarm();}
}
export class Lobby {
  constructor(ctx,env) {
    this.ready=ctx.blockConcurrencyWhile(async()=>{this.lobby=new (await import('./lobby.mjs')).Lobby(ctx,env);});
  }
  async fetch(request) {await this.ready;return this.lobby.fetch(request);}
}
