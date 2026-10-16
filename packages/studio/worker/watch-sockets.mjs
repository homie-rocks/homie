/** The public watch socket has no simulation state. Keep its authenticated
 * request in DO storage and a small attachment on the socket; listeners are
 * rebuilt after hibernation without trusting anything supplied by the client.
 */
import {isQa} from './stats.mjs';
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
      watchState: socket.deserializeAttachment()?.watchState,
      rememberWatch: watchState => socket.serializeAttachment({...socket.deserializeAttachment(),watchState}),
      rememberGate: gate => socket.serializeAttachment({...socket.deserializeAttachment(),gate}),
      send: text => socket.send(text),
      close: (code, reason) => socket.close(code, reason),
      addEventListener: (event, fn) => listeners.set(event, fn),
    };
  }
  async accept(socket, request) {
    const id = crypto.randomUUID();
    const ip = request.headers.get('cf-connecting-ip');
    // A digest retains per-address admission limits without persisting raw addresses.
    const address = ip ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip)))].map(n => n.toString(16).padStart(2, '0')).join('') : null;
    await this.ctx.storage.put('watch:' + id, {url: request.url, headers: [...(address ? [['cf-connecting-ip', address]] : []),...(isQa(request)?[['user-agent','homie-house-qa']]:[])]});
    socket.serializeAttachment({v: 1, id});
    this.ctx.acceptWebSocket(socket, [new URL(request.url).pathname==='/__watch'?'watch':'net']);
    return Object.assign(this.transport(socket), {address});
  }
  async prune() {
    const live=new Set((this.ctx.getWebSockets?.()??[]).filter(socket=>socket.readyState!==3).map(socket=>'watch:'+socket.deserializeAttachment()?.id));
    for(const key of (await this.ctx.storage.list?.({prefix:'watch:'})??new Map()).keys())if(!live.has(key))await this.ctx.storage.delete(key);
  }
  async restore(connect) {
    const sockets = this.ctx.getWebSockets?.() ?? [];
    const requests = await this.ctx.storage.list?.({prefix: 'watch:'}) ?? new Map();
    const live = new Set(sockets.map(socket => 'watch:' + socket.deserializeAttachment()?.id));
    for (const key of requests.keys()) if (!live.has(key)) await this.ctx.storage.delete(key);
    for (const socket of sockets) {
      const attachment = socket.deserializeAttachment();
      const request = attachment?.v === 1 && requests.get('watch:' + attachment.id);
      if (!request) { socket.close(1011, 'watch state missing'); continue; }
      // Migrate older request records without retaining their raw user agent.
      const headers=new Headers(request.headers);
      const ip=headers.get('cf-connecting-ip');
      if(ip&&!/^[a-f0-9]{64}$/.test(ip))headers.set('cf-connecting-ip',[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip)))].map(n=>n.toString(16).padStart(2,'0')).join(''));
      const minimal=[...(headers.has('cf-connecting-ip')?[['cf-connecting-ip',headers.get('cf-connecting-ip')]]:[]),...(isQa({headers})?[['user-agent','homie-house-qa']]:[])];
      if(JSON.stringify(request.headers)!==JSON.stringify(minimal)){request.headers=minimal;await this.ctx.storage.put('watch:'+attachment.id,request);}
      try {
        const response = await connect(new Request(request.url, {headers: request.headers}), this.transport(socket),attachment);
        if (response != null) { socket.close(1012, 'room restore rejected'); await this.close(socket, null, false); }
      } catch { socket.close(1011, 'room restore failed'); await this.close(socket, null, false); }
    }
  }
  message(socket, data) { this.listeners.get(socket)?.get('message')?.({data}); }
  async close(socket, error = null, reply = true) {
    if (reply) { try { socket.close(1000, 'closed'); } catch { /* already closed */ } }
    const listeners = this.listeners.get(socket);
    this.listeners.delete(socket);
    try { listeners?.get(error ? 'error' : 'close')?.(error ? {error} : {}); }
    finally {
      const attachment = socket.deserializeAttachment();
      if (attachment?.v === 1) await this.ctx.storage.delete('watch:' + attachment.id);
    }
  }
}
