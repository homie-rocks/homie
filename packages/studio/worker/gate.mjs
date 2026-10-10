import { stageTimings } from '../rules/timing.mjs';
import { scheduledView, snapshotEncoder, snapshotText } from '../rules/interest.mjs';

const parsedFrames = new WeakMap();
function parseFrame(event) {
  let rows = parsedFrames.get(event);
  if (!rows) { rows = JSON.parse(event.data); parsedFrames.set(event, rows); }
  return rows;
}
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
    if (row[0] === 'views') { for (const [id, seat] of row[1]) yield ['view', id, row[2], seat, row[3], row[4]]; }
    else if (row[0] === 'fan') { for (const id of row[1]) yield ['data', id, row[2]]; }
    else yield row;
  }
}
export function batchLink(socket, { setTimer = setTimeout, clearTimer = clearTimeout, delay = 1, receipts = false, maxBytes = 4 * 1024 * 1024, onWritable = () => {} } = {}) {
  let queue = [], views = new Map(), strings = new Set(), timer = null, closed = false, bytes = 0, sequence = 0, pending = 0, sentAt = 0;
  const timing = stageTimings();
  const stats = { frames: 0, rows: 0, bytes: 0, peakQueueBytes: 0, coalesced: 0, ackMs: 0, maxAckMs: 0 };
  const close = () => { closed = true; queue = []; views.clear(); strings.clear(); bytes = 0; if (timer !== null) clearTimer(timer); timer = null; };
  const fail = (reason) => { close(); try { socket.close(1011, reason); } catch {} };
  const schedule = () => { if (!closed && !pending && (queue.length || views.size) && timer === null) timer = setTimer(flush, delay); };
  const flush = () => {
    if (timer !== null) clearTimer(timer); timer = null;
    if (closed || pending || !queue.length && !views.size) return;
    const rows = []; let last = null;
    for (const row of queue) {
      if (row[0] === 'data' && last && (last[0] === 'data' || last[0] === 'fan') && last[2] === row[2]) {
        if (last[0] === 'data') { last[0] = 'fan'; last[1] = [last[1]]; }
        last[1].push(row[1]);
      } else { last = row.slice(); rows.push(last); }
    }
    const groups = new Map();
    for (const row of views.values()) {
      let group = groups.get(row[2]);
      if (!group) { group = ['views', [], row[2], row[4], row[5]]; groups.set(row[2], group); rows.push(group); }
      group[1].push([row[1], row[3]]);
    }
    queue = []; views.clear(); strings.clear(); bytes = 0;
    if (receipts) { pending = ++sequence; sentAt = Date.now(); rows.push(['receipt', pending]); }
    const encodeAt = timing.now();
    const text = JSON.stringify(rows);
    timing.record('encode', encodeAt);
    if (text.length > maxBytes) { fail('room link frame limit'); return; }
    stats.frames++; stats.rows += rows.length; stats.bytes += text.length;
    const sendAt = timing.now();
    try { socket.send(text); timing.record('send', sendAt); onWritable(); } catch { fail('room link send failed'); }
  };
  if (receipts) socket.addEventListener('message', event => {
    try {
      const rows = parseFrame(event);
      if (!Array.isArray(rows)) return;
      for (const row of rows) {
        if (row[0] === 'ack' && row[1] === pending) { stats.ackMs = Date.now() - sentAt; stats.maxAckMs = Math.max(stats.maxAckMs, stats.ackMs); pending = 0; schedule(); onWritable(); }
        if (row[0] === 'receipt') socket.send(JSON.stringify([['ack', row[1]]]));
      }
    } catch { /* the session reports malformed frames */ }
  });
  return {
    send(row) {
      if (closed) return;
      // Snapshots are absolute here; Gate encoders run only when they deliver.
      // Replace unsent state, never an input, command, admission or departure.
      if (row[0] === 'view') {
        if (views.has(row[1])) stats.coalesced++;
        views.set(row[1], row); schedule(); return;
      }
      // Fan-out payload strings are shared in memory and on the wire.
      const size = row[0] === 'data' ? 48 + (strings.has(row[2]) ? 0 : row[2].length) : JSON.stringify(row).length;
      if (row[0] === 'data') strings.add(row[2]);
      if (bytes + size > maxBytes) { fail('room link queue limit'); return; }
      queue.push(row); bytes += size; stats.peakQueueBytes = Math.max(bytes, stats.peakQueueBytes);
      schedule();
    },
    flush, close, buffered: () => bytes,
    facts: () => ({ ...stats, timing: timing.facts(), queueRows: queue.length, pendingViews: views.size, queueBytes: bytes, inFlight: pending ? 1 : 0 }),
    disconnect() { close(); socket.close(1012, 'room link restarted'); }
  };
}

/** Adapt one upstream socket into the same transport the Table accepts locally. */
export function multiplexSession(socket, connect, { onMetrics = () => {} } = {}) {
  const out = batchLink(socket, { receipts: true, onWritable: () => scheduleAdmission() }), clients = new Map();
  let chain = Promise.resolve(), closed = false;
  const pending = new Set(), admissions = [];
  let attaching = 0, admissionTimer = null;
  const pump = () => {
    admissionTimer = null;
    if (closed) return;
    // A welcome contains the peer list. Bound simultaneous welcome creation,
    // leaving space for existing players' reliable traffic while a link drains.
    while (admissions.length && attaching < 8 && out.buffered() < 512 * 1024) {
      const admit = admissions.shift(); attaching++;
      Promise.resolve().then(admit).finally(() => { attaching--; scheduleAdmission(); });
    }
    if (admissions.length) scheduleAdmission();
  };
  const scheduleAdmission = () => {
    if (!closed && admissions.length && attaching < 8 && out.buffered() < 512 * 1024 && admissionTimer === null) admissionTimer = setTimeout(pump, 1);
  };
  const transportFacts = () => ({ ...out.facts(), admissions: admissions.length, attaching });
  const shutdown = () => {
    if (closed) return;
    closed = true; out.close();
    if (admissionTimer !== null) clearTimeout(admissionTimer);
    for (const admit of admissions.splice(0)) admit.cancel();
    for (const client of clients.values()) client.emit('close', {});
    clients.clear();
  };
  socket.addEventListener('message', event => {
    chain = chain.then(async () => {
      if (closed) return;
      const rows = parseFrame(event);
      if (!Array.isArray(rows)) throw new Error('invalid multiplex batch');
      for (const [op, id, value, ip, agent] of expandBatch(rows)) {
        if (op === 'metrics') { onMetrics(id, value); continue; }
        if (op === 'open') {
          if (clients.has(id)) throw new Error('duplicate multiplex client');
          const handlers = new Map();
          const client = {
            accept() {},
            addEventListener(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
            emit(name, event) { for (const fn of handlers.get(name) ?? []) fn(event); },
            send(text) { out.send(['data', id, text]); },
            snapshot(snap, seat, settings, hz) { out.send(['view', id, snap, seat, settings, hz]); },
            buffered: () => out.buffered(),
            transportFacts,
            close(code, reason) { out.send(['close', id, code, reason]); clients.delete(id); client.emit('close', {}); },
          };
          clients.set(id, client);
          client.ready = new Promise((resolve, reject) => {
            const admit = async () => {
              if (closed || !clients.has(id)) { resolve(); return; }
              try { await connect(new Request(value, { headers: { Upgrade: 'websocket', ...(ip ? { 'cf-connecting-ip': ip } : {}), ...(agent ? { 'user-agent': agent } : {}) } }), client); resolve(); }
              catch (error) { reject(error); }
            };
            admit.cancel = resolve; admissions.push(admit);
          });
          scheduleAdmission();
          const ready = client.ready; pending.add(ready);
          ready.then(() => { pending.delete(ready); if (closed || !clients.has(id)) client.emit('close', {}); }, () => { pending.delete(ready); client.close(1011, 'admission failed'); });
        } else if (op === 'data' || op === 'close') {
          const client = clients.get(id);
          if (client) {
            client.queued = (client.queued ?? 0) + 1;
            if (client.queued > 256) { client.close(1013, 'client queue limit'); continue; }
            const task = client.ready = client.ready.then(() => {
              client.queued--;
              if (closed || !clients.has(id)) return;
              if (op === 'data') client.emit('message', { data: value });
              else { client.emit('close', {}); clients.delete(id); }
            });
            pending.add(task); task.then(() => pending.delete(task), () => { pending.delete(task); client.close(1011, 'client message failed'); });
          }
        }
      }
      if (admissions.length && !attaching) { if (admissionTimer !== null) clearTimeout(admissionTimer); pump(); }
    }).catch(error => { console.log(JSON.stringify({ ev: 'room-link-failed', stage: 'receive', error: String(error?.message ?? error).slice(0,160) })); shutdown(); try { socket.close(1011, 'room link failed'); } catch {} });
  });
  socket.addEventListener('close', shutdown);
  socket.addEventListener('error', shutdown);
  return { shutdown, settled: async () => { await chain; await Promise.allSettled([...pending]); } };
}
export function acceptMultiplex(request, connect, options) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept(); multiplexSession(server, connect, options);
  return new Response(null, { status: 101, webSocket: client });
}

export class Gate {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.clients = new Map(); this.admissions = new Map(); this.sequence = 0; this.link = null; this.opening = null; this.timing = stageTimings(); this.metricsAt = 0; }
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
      const link = batchLink(socket, { receipts: true });
      const lost = (event = {}) => {
        if (this.link !== link) return;
        console.log(JSON.stringify({ ev: 'room-link-lost', room: name, gate: url.searchParams.get('gate'), layer: this instanceof Concentrator ? 'concentrator' : 'gate', code: event.code ?? null, reason: event.reason ?? null, error: event.error?.message ?? null, clients: this.clients.size, transport: link.facts() }));
        this.link = null; link.close();
        for (const timer of this.admissions.values()) clearTimeout(timer); this.admissions.clear();
        for (const client of this.clients.values()) { try { client.close(1012, 'room link restarted'); } catch {} }
        this.clients.clear();
      };
      socket.addEventListener('message', event => {
        try { for (const [op, id, value, reason, settings, hz] of expandBatch(parseFrame(event))) {
          const client = this.clients.get(id);
          if (op === 'view' && client) {
            try {
            if (client.snapshot) client.snapshot(value, reason, settings, hz);
            else {
              const viewAt = this.timing.now();
              client.viewSchedule ??= scheduledView(settings, hz);
              // This encoder sits after coalescing on an ordered WebSocket. A
              // fresh connection/epoch gets a keyframe; subsequent deltas cannot
              // lose a predecessor, so do not repeat a full interest set each second.
              client.snapEncoder ??= snapshotEncoder(Infinity, true);
              client.send(snapshotText({ t: 'snap', from: null, ...client.snapEncoder.encode(client.viewSchedule(value, reason), reason) }));
              this.timing.record('viewEncodeSend', viewAt);
            }
            } catch { this.clients.delete(id); link.send(['close', id]); try { client.close(1011, 'client connection ended'); } catch {} }
          } else if (op === 'data') {
            try { client?.send(value); } catch {
              this.clients.delete(id); link.send(['close', id]);
              try { client?.close(1011, 'client connection ended'); } catch {}
            }
          } else if (op === 'close') {
            this.clients.delete(id); try { client?.close(value, reason); } catch {}
          }
        } } catch (error) { lost({error,reason:'invalid room frame'}); try { socket.close(1011, 'room link failed'); } catch {} }
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
    let opened = false;
    const deadline = setTimeout(() => {
      this.admissions.delete(id);
      if (!opened && this.clients.delete(id)) { try { server.close(4000, 'no-hello'); } catch {} }
    }, 5000);
    deadline?.unref?.(); this.admissions.set(id, deadline);
    server.addEventListener('message', event => {
      if (!this.clients.has(id) || typeof event.data !== 'string') return;
      if (!opened) {
        opened = true; clearTimeout(deadline); this.admissions.delete(id);
        // Logical creation and the first frame share a batch: admission time at
        // the Table excludes the public handshake and relay transit.
        link.send(['open', id, request.url, request.headers.get('cf-connecting-ip'), request.headers.get('user-agent')]);
      }
      link.send(['data', id, event.data]);
      if (Date.now() - this.metricsAt >= 1000) {
        this.metricsAt = Date.now(); const url = new URL(request.url);
        link.send(['metrics', `${this instanceof Concentrator ? 'concentrator' : 'gate'}/${this instanceof Concentrator ? Math.floor(Number(url.searchParams.get('gate')) / 8) : url.searchParams.get('gate')}`, { ...link.facts(), view: this.timing.facts(), clients: this.clients.size }]);
      }
    });
    const left = () => { clearTimeout(deadline); this.admissions.delete(id); if (this.clients.delete(id) && opened) link.send(['close', id]); };
    server.addEventListener('close', left); server.addEventListener('error', left);
  }
  async fetch(request) {
    if (new URL(request.url).pathname === '/__multiplex') return acceptMultiplex(request, (req, socket) => this.connect(req, socket), { onMetrics: (id, facts) => this.link?.send(['metrics', id, facts]) });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    await this.connect(request, server);
    return new Response(null, { status: 101, webSocket: client });
  }
}
export class Concentrator extends Gate {}
