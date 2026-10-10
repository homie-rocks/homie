/** Trusted, ordered multiplex links. Public authentication stays at the Worker;
 * only bindings can open these endpoints. A lost link closes its downstream
 * sockets: clients resume with their existing seat tokens and a fresh keyframe.
 * Inputs and commands are batched together, never overwritten or reordered.
 */
export function roomLayout(seats) {
  const gates = Math.ceil(seats / 64);
  return { gates, concentrators: gates > 8 ? Math.ceil(gates / 8) : 0 };
}
export function gateFor(env, game, room, seats, key) {
  const layout = roomLayout(seats);
  // One logical Gate is embedded in the Table for a small room. Same relay,
  // admission and delivery protocol; no extra Durable Object or seat clamp.
  if (layout.gates === 1) return env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`));
  let hash = 2166136261;
  for (const c of key || crypto.randomUUID()) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  const index = hash % layout.gates;
  return { fetch(request) {
    const url = new URL(request.url);
    url.searchParams.set('gate', String(index));
    url.searchParams.set('gates', String(layout.gates));
    return env.GATE.get(env.GATE.idFromName(`${game}/${room}/${index}`)).fetch(new Request(url, request));
  } };
}

export function* expandBatch(rows) {
  for (const row of rows) {
    if (row[0] === 'fan') { for (const id of row[1]) yield ['data', id, row[2]]; }
    else yield row;
  }
}
export function batchLink(socket, { setTimer = setTimeout, clearTimer = clearTimeout, delay = 5 } = {}) {
  let queue = [], timer = null, closed = false;
  const flush = () => {
    timer = null;
    if (closed || !queue.length) return;
    const rows = []; let last = null;
    for (const row of queue) {
      if (row[0] === 'data' && last && (last[0] === 'data' || last[0] === 'fan') && last[2] === row[2]) {
        if (last[0] === 'data') { last[0] = 'fan'; last[1] = [last[1]]; }
        last[1].push(row[1]);
      } else { last = row.slice(); rows.push(last); }
    }
    queue = [];
    try { socket.send(JSON.stringify(rows)); } catch { close(); try { socket.close(1011, 'room link send failed'); } catch {} }
  };
  const close = () => { closed = true; queue = []; if (timer !== null) clearTimer(timer); timer = null; };
  return { send(row) { if (closed) return; queue.push(row); if (queue.length >= 128) { if (timer !== null) clearTimer(timer); flush(); } else if (timer === null) timer = setTimer(flush, delay); }, flush, close, disconnect() { close(); socket.close(1012, 'room link restarted'); } };
}

/** Adapt one upstream socket into the same transport the Table accepts locally. */
export function multiplexSession(socket, connect) {
  const out = batchLink(socket), clients = new Map();
  let chain = Promise.resolve(), closed = false;
  const shutdown = () => {
    if (closed) return;
    closed = true; out.close();
    for (const client of clients.values()) client.emit('close', {});
    clients.clear();
  };
  socket.addEventListener('message', event => {
    chain = chain.then(async () => {
      if (closed) return;
      const rows = JSON.parse(event.data);
      if (!Array.isArray(rows)) throw new Error('invalid multiplex batch');
      for (const [op, id, value, ip, agent] of expandBatch(rows)) {
        if (op === 'open') {
          if (clients.has(id)) throw new Error('duplicate multiplex client');
          const handlers = new Map();
          const client = {
            accept() {},
            addEventListener(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
            emit(name, event) { for (const fn of handlers.get(name) ?? []) fn(event); },
            send(text) { out.send(['data', id, text]); },
            close(code, reason) { out.send(['close', id, code, reason]); clients.delete(id); client.emit('close', {}); },
          };
          clients.set(id, client);
          await connect(new Request(value, { headers: { Upgrade: 'websocket', ...(ip ? { 'cf-connecting-ip': ip } : {}), ...(agent ? { 'user-agent': agent } : {}) } }), client);
        } else if (op === 'data') clients.get(id)?.emit('message', { data: value });
        else if (op === 'close') { clients.get(id)?.emit('close', {}); clients.delete(id); }
      }
    }).catch(() => { shutdown(); try { socket.close(1011, 'room link failed'); } catch {} });
  });
  socket.addEventListener('close', shutdown);
  socket.addEventListener('error', shutdown);
  return { shutdown, settled: () => chain };
}
export function acceptMultiplex(request, connect) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept(); multiplexSession(server, connect);
  return new Response(null, { status: 101, webSocket: client });
}

export class Gate {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.clients = new Map(); this.sequence = 0; this.link = null; this.opening = null; }
  async upstream(url) {
    if (this.link) return this.link;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const name = `${url.searchParams.get('game')}/${url.searchParams.get('room')}`;
      const gates = Number(url.searchParams.get('gates'));
      const useConcentrator = !(this instanceof Concentrator) && gates > 8;
      const binding = useConcentrator ? this.env.CONCENTRATOR : this.env.TABLE;
      const key = useConcentrator ? `${name}/${Math.floor(Number(url.searchParams.get('gate')) / 8)}` : name;
      const target = new URL(url); target.pathname = '/__multiplex';
      const response = await binding.get(binding.idFromName(key)).fetch(new Request(target, { headers: { Upgrade: 'websocket' } }));
      if (!response.webSocket) throw new Error('room link refused');
      const socket = response.webSocket; socket.accept();
      const link = batchLink(socket);
      const lost = () => {
        if (this.link !== link) return;
        this.link = null; link.close();
        for (const client of this.clients.values()) { try { client.close(1012, 'room link restarted'); } catch {} }
        this.clients.clear();
      };
      socket.addEventListener('message', event => {
        try { for (const [op, id, value, reason] of expandBatch(JSON.parse(event.data))) {
          const client = this.clients.get(id);
          if (op === 'data') {
            try { client?.send(value); } catch {
              this.clients.delete(id); link.send(['close', id]);
              try { client?.close(1011, 'client connection ended'); } catch {}
            }
          } else if (op === 'close') {
            this.clients.delete(id); try { client?.close(value, reason); } catch {}
          }
        } } catch { lost(); try { socket.close(1011, 'room link failed'); } catch {} }
      });
      socket.addEventListener('close', lost); socket.addEventListener('error', lost);
      this.link = link; return link;
    })();
    try { return await this.opening; } finally { this.opening = null; }
  }
  async connect(request, server) {
    const link = await this.upstream(new URL(request.url));
    const id = String(++this.sequence);
    this.clients.set(id, server);
    link.send(['open', id, request.url, request.headers.get('cf-connecting-ip'), request.headers.get('user-agent')]);
    server.addEventListener('message', event => { if (typeof event.data === 'string') link.send(['data', id, event.data]); });
    const left = () => { if (this.clients.delete(id)) link.send(['close', id]); };
    server.addEventListener('close', left); server.addEventListener('error', left);
  }
  async fetch(request) {
    if (new URL(request.url).pathname === '/__multiplex') return acceptMultiplex(request, (req, socket) => this.connect(req, socket));
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    await this.connect(request, server);
    return new Response(null, { status: 101, webSocket: client });
  }
}
export class Concentrator extends Gate {}
