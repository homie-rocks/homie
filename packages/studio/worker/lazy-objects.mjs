/** Generated standard entries load room engines only when their object is used.
 * Custom subclasses retain their own exports and do not use this adapter. */
export class Table {
  constructor(ctx,env) {
    this.ready=ctx.blockConcurrencyWhile(async()=>{this.room=new (await import('./table.mjs')).Table(ctx,env);});
  }
  async fetch(request) {await this.ready;return this.room.fetch(request);}
  async alarm() {await this.ready;return this.room.alarm();}
  async webSocketMessage(...args) {await this.ready;return this.room.webSocketMessage(...args);}
  async webSocketClose(...args) {await this.ready;return this.room.webSocketClose(...args);}
  async webSocketError(...args) {await this.ready;return this.room.webSocketError(...args);}
}
export class Lobby {
  constructor(ctx,env) {
    this.ready=ctx.blockConcurrencyWhile(async()=>{this.lobby=new (await import('./lobby.mjs')).Lobby(ctx,env);});
  }
  async fetch(request) {await this.ready;return this.lobby.fetch(request);}
  async alarm() {await this.ready;return this.lobby.alarm();}
  async webSocketMessage(...args) {await this.ready;return this.lobby.webSocketMessage(...args);}
  async webSocketClose(...args) {await this.ready;return this.lobby.webSocketClose(...args);}
  async webSocketError(...args) {await this.ready;return this.lobby.webSocketError(...args);}
}

export class Gate {
  constructor(ctx,env) {
    this.ready=ctx.blockConcurrencyWhile(async()=>{this.gate=new (await import('./gate.mjs')).Gate(ctx,env);});
  }
  async fetch(request) {await this.ready;return this.gate.fetch(request);}
  async webSocketMessage(...args) {await this.ready;return this.gate.webSocketMessage(...args);}
  async webSocketClose(...args) {await this.ready;return this.gate.webSocketClose(...args);}
  async webSocketError(...args) {await this.ready;return this.gate.webSocketError(...args);}
}
export class Concentrator extends Gate {}

export class AppRecordHub {
  constructor(ctx,env) {
    this.ready=ctx.blockConcurrencyWhile(async()=>{this.hub=new (await import('./stream-objects.mjs')).AppRecordHub(ctx,env);});
  }
  async fetch(request) {await this.ready;return this.hub.fetch(request);}
  async webSocketMessage(...args) {await this.ready;return this.hub.webSocketMessage(...args);}
  async webSocketClose(...args) {await this.ready;return this.hub.webSocketClose(...args);}
  async webSocketError(...args) {await this.ready;return this.hub.webSocketError(...args);}
}
export class EventHub {
  constructor(ctx,env) {
    this.ready=ctx.blockConcurrencyWhile(async()=>{this.hub=new (await import('./stream-objects.mjs')).EventHub(ctx,env);});
  }
  async fetch(request) {await this.ready;return this.hub.fetch(request);}
}
