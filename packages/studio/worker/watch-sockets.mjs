/** The public watch socket has no simulation state. Keep its authenticated
 * request in DO storage and a small attachment on the socket; listeners are
 * rebuilt after hibernation without trusting anything supplied by the client.
 */
export class WatchSockets {
  constructor(ctx) {
    this.ctx = ctx;
    this.listeners = new Map();
    if (ctx.setWebSocketAutoResponse && typeof WebSocketRequestResponsePair !== 'undefined') {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('homie-ping', 'homie-pong'));
    }
  }
  transport(socket) {
    const listeners = new Map();
    this.listeners.set(socket, listeners);
    return {
      accept() {},
      lastPing: () => this.ctx.getWebSocketAutoResponseTimestamp?.(socket)?.getTime?.() ?? 0,
      remember: clientId => socket.serializeAttachment({...socket.deserializeAttachment(),clientId}),
      send: text => socket.send(text),
      close: (code, reason) => socket.close(code, reason),
      addEventListener: (event, fn) => listeners.set(event, fn),
    };
  }
  async accept(socket, request) {
    const id = crypto.randomUUID();
    await this.ctx.storage.put('watch:' + id, {url: request.url, headers: ['cf-connecting-ip','user-agent'].flatMap(name => request.headers.has(name) ? [[name,request.headers.get(name)]] : [])});
    socket.serializeAttachment({v: 1, id});
    this.ctx.acceptWebSocket(socket, [new URL(request.url).pathname==='/__watch'?'watch':'net']);
    return this.transport(socket);
  }
  async restore(connect) {
    const sockets = this.ctx.getWebSockets?.() ?? [];
    if (!sockets.length) return;
    const requests = await this.ctx.storage.list({prefix: 'watch:'});
    for (const socket of sockets) {
      const attachment = socket.deserializeAttachment();
      const request = attachment?.v === 1 && requests.get('watch:' + attachment.id);
      if (!request) { socket.close(1011, 'watch state missing'); continue; }
      await connect(new Request(request.url, {headers: request.headers}), this.transport(socket),attachment);
    }
  }
  message(socket, data) { this.listeners.get(socket)?.get('message')?.({data}); }
  async close(socket, error = null) {
    const listeners = this.listeners.get(socket);
    this.listeners.delete(socket);
    try { listeners?.get(error ? 'error' : 'close')?.(error ? {error} : {}); }
    finally {
      const attachment = socket.deserializeAttachment();
      if (attachment?.v === 1) await this.ctx.storage.delete('watch:' + attachment.id);
    }
  }
}
