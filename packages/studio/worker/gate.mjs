import {WatchSockets} from './watch-sockets.mjs';
import {relayChannel,readRelay} from './relay-channel.mjs';
import { STUDIO_BUILD } from './build-id.mjs';
import { stageTimings } from '../rules/timing.mjs';
import { crowdView, crowdWorlds, scheduledView, snapshotEncoder, snapshotText } from '../rules/interest.mjs';
import { worldSink, worldSource } from './world-wire.mjs';

const parsedFrames = new WeakMap();
const sharedSnapshotText = new WeakMap();
function batchText(rows) {
  return '[' + rows.map(row => {
    // A world's block of numbers is base64, which needs no escaping: it is joined on, not walked 50 times a tick.
    if (row[0] === 'world' && typeof row[5] === 'string') return JSON.stringify(row.slice(0, 5)).slice(0, -1) + ',"' + row[5] + '"]';
    if (row[0] !== 'views' && row[0] !== 'world') return JSON.stringify(row);
    // All downstream links share this immutable state. Serialize it once in
    // this isolate, rather than once for every Gate fed by a Concentrator.
    let state = sharedSnapshotText.get(row[2]);
    if (state === undefined) { state = JSON.stringify(row[2]); sharedSnapshotText.set(row[2], state); }
    return '[' + JSON.stringify(row[0]) + ',' + JSON.stringify(row[1]) + ',' + state + ',' + JSON.stringify([row[3], row[4]]).slice(1, -1) + ']';
  }).join(',') + ']';
}
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
export {GATE_PLAYERS,gatePlayers,roomLayout,nextGate,gateFor,diagnosticsOf} from './gate-routing.mjs';
import {diagnosticsOf} from './gate-routing.mjs';

export function* expandBatch(rows) {
  for (const row of rows) {
    if (row[0] === 'views') { for (const [id, seat] of row[1]) yield ['view', id, row[2], seat, row[3], row[4]]; }
    else if (row[0] === 'fan') { for (const id of row[1]) yield row.length > 3 ? ['data', id, row[2], row[3]] : ['data', id, row[2]]; }
    else yield row;
  }
}
export function batchLink(socket, { setTimer = setTimeout, clearTimer = clearTimeout, delay = 1, receipts = false, maxFrames = 4, maxBytes = 4 * 1024 * 1024, onWritable = () => {}, autoReceipt = true, now = Date.now, world = null, onAck = () => {} } = {}) {
  let queue = [], views = new Map(), strings = new Set(), timer = null, closed = false, bytes = 0, sequence = 0, inFlightBytes = 0, blockedByBytes = false, receipt = 0, receiptAt = 0, stamp = null, lastSentAt = -Infinity;
  const pending = new Map();
  const timing = stageTimings();
  const stats = { frames: 0, rows: 0, bytes: 0, peakQueueBytes: 0, coalesced: 0, ackMs: 0, maxAckMs: 0, rttMs: 0 };
  const close = () => { closed = true; queue = []; views.clear(); strings.clear(); pending.clear(); inFlightBytes = 0; bytes = 0; if (timer !== null) clearTimer(timer); timer = null; };
  const fail = (reason) => { close(); try { socket.close(1011, reason); } catch { /* The peer already closed; local shutdown still runs. */ } };
  const schedule = () => { if (!closed && (receipt || pending.size < maxFrames && !blockedByBytes && (queue.length || views.size)) && timer === null) timer = setTimer(flush, delay > 1 ? Math.max(0, lastSentAt + delay - now()) : delay); };
  const flush = () => {
    if (timer !== null) clearTimer(timer); timer = null;
    if (closed) return;
    if (pending.size >= maxFrames || blockedByBytes) {
      if (receipt) { try { socket.send(JSON.stringify([['ack', receipt, now() - receiptAt]])); receipt = 0; } catch { fail('room link send failed'); } }
      return;
    }
    if (!queue.length && !views.size && !receipt) return;
    const rows = []; let last = null, worldSeq = 0;
    const hasPayload = queue.length || views.size;
    // The receipt waits for this link's next scheduled frame; say how long,
    // so the sender's receipt latency measures transit, not the cadence.
    if (receipt) rows.push(['ack', receipt, now() - receiptAt, ...(stamp ? [[stamp[0], stamp[1], now()]] : [])]);
    for (const row of queue) {
      if (row[0] === 'data' && last && (last[0] === 'data' || last[0] === 'fan') && last[2] === row[2] && last[3] === row[3]) {
        if (last[0] === 'data') { last[0] = 'fan'; last[1] = [last[1]]; }
        last[1].push(row[1]);
      } else { last = row.slice(); rows.push(last); }
    }
    const groups = new Map();
    for (const row of views.values()) {
      // The room's side says how a world travels (worker/world-wire.mjs): a block of numbers and what changed.
      if (row[0] === 'world') { const sent = world?.(row); if (sent) { rows.push(sent.row); worldSeq = sent.seq; } else rows.push(row); continue; }
      let group = groups.get(row[2]);
      if (!group) { group = ['views', [], row[2], row[4], row[5]]; groups.set(row[2], group); rows.push(group); }
      group[1].push([row[1], row[3]]);
    }
    if (receipts && hasPayload) rows.push(['receipt', sequence + 1, now()]);
    const encodeAt = timing.now();
    const text = batchText(rows);
    timing.record('encode', encodeAt);
    const size = text.length;
    if (size > maxBytes) { fail('room link frame limit'); return; }
    if (receipts && inFlightBytes + size > maxBytes) { blockedByBytes = true; return; }
    queue = []; views.clear(); strings.clear(); bytes = 0; receipt = 0;
    if (receipts && hasPayload) { pending.set(++sequence, { at: now(), bytes: size }); inFlightBytes += size; }
    stats.frames++; stats.rows += rows.length; stats.bytes += size;
    const sendAt = timing.now();
    try { lastSentAt = now(); socket.send(text); if (worldSeq) world.sent(worldSeq); timing.record('send', sendAt); onWritable(); } catch { fail('room link send failed'); }
  };
  if (receipts) socket.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    try {
      const rows = parseFrame(event);
      if (!Array.isArray(rows)) return;
      for (const row of rows) {
        if (row[0] === 'ack' && pending.has(row[1])) {
          const frame = pending.get(row[1]);
          stats.ackMs = Math.max(0, now() - frame.at - (Number(row[2]) || 0)); stats.rttMs = Math.max(stats.ackMs, stats.rttMs * 0.95); onAck(Number(row[2]) || 0, Array.isArray(row[3]) ? row[3] : null); stats.maxAckMs = Math.max(stats.maxAckMs, stats.ackMs);
          for (const [seq, held] of pending) if (seq <= row[1]) { pending.delete(seq); inFlightBytes -= held.bytes; } blockedByBytes = false; schedule(); onWritable();
        }
        if (autoReceipt && row[0] === 'receipt') socket.send(JSON.stringify([['ack',row[1]]]));
      }
    } catch { /* the session reports malformed frames */ }
  });
  return {
    send(row) {
      if (closed) return;
      if (row[0] === 'close') views.delete(row[1]);
      // Snapshots are absolute here; Gate encoders run only when they deliver.
      // Replace unsent state, never an input, command, admission or departure.
      if (row[0] === 'view' || row[0] === 'world') {
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
    /** Rows were handled: owe their receipt on this link's next frame. `inMs`
     * aligns that frame (a Gate sends its tick's inputs just before the next tick). */
    consumed(rows, inMs = null) {
      for (const row of rows) if (row[0] === 'receipt' && row[1] > receipt) { if (!receipt) receiptAt = now(); receipt = row[1]; stamp = Number.isFinite(row[2]) ? [row[2], now()] : null; }
      if (inMs !== null && !closed) { if (timer !== null) clearTimer(timer); timer = setTimer(flush, Math.max(0, inMs)); }
      else schedule();
    },
    reset() { pending.clear(); sequence=0; receipt=0; inFlightBytes=0; blockedByBytes=false; schedule(); },
    flush, close, forget: id => views.delete(id), buffered: () => bytes,
    /** This link's recent round trip, ms: the newest receipt's, or a larger recent one fading out. */
    rtt: () => stats.rttMs,
    facts: () => ({ ...stats, timing: timing.facts(), queueRows: queue.length, pendingViews: views.size, queueBytes: bytes, inFlight: pending.size, inFlightBytes }),
    disconnect() { close(); socket.close(1012, 'room link restarted'); }
  };
}

/** Adapt one upstream socket into the same transport the Table accepts locally. */
export function multiplexSession(socket, connect, { onMetrics = () => {}, delay = 60, source = worldSource(), onCount = () => {}, receipts = true, lastPing = () => 0, resume = () => null, remember = () => {} } = {}) {
  // Eight frames may be unacknowledged: 400 ms of 20 Hz worlds. Past that the newest world replaces an unsent one.
  // This link's Gate has every world up to `synced`, and holds the players in these seats.
  let synced = 0; const seats = new Map();
  const world = Object.assign((row) => { const w = source.encode(row[2]); return w ? { row: ['world', '*', source.header(w, synced, seats.values()), row[3], row[4], w.block], seq: w.seq } : null; }, { sent(seq) { synced = seq; } });
  const out = batchLink(socket, { receipts, delay, maxFrames: 8, autoReceipt: false, world, onWritable: () => scheduleAdmission() }), clients = new Map();
  let chain = Promise.resolve(), closed = false;
  const group = { snapshot(snap, settings, hz) { out.send(['world', '*', snap, settings, hz]); out.flush(); }, subscribe(id, seat) { seats.set(id, seat); out.send(['seat', id, seat]); }, facts: () => out.facts() };
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
  // What this Gate has sent the room: frames, the rows in them (a row is a player's message, mostly) and their size.
  const heard = { frames: 0, rows: 0, bytes: 0 };
  const transportFacts = () => ({ ...out.facts(), in: { ...heard }, admissions: admissions.length, attaching });
  const shutdown = () => {
    if (closed) return;
    closed = true; out.close();
    if (admissionTimer !== null) clearTimeout(admissionTimer);
    for (const admit of admissions.splice(0)) admit.cancel();
    for (const client of clients.values()) client.emit('close', {});
    clients.clear(); seats.clear(); onCount(0);
  };
  socket.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    chain = chain.then(async () => {
      if (closed) return;
      const rows = parseFrame(event);
      if (!Array.isArray(rows)) throw new Error('invalid multiplex batch');
      heard.frames += 1; heard.rows += rows.length; heard.bytes += event.data.length;
      for (const [op, id, value, ip, agent] of expandBatch(rows)) {
        if (op === 'resync') { synced=0; continue; }
        if (op === 'metrics') { onMetrics(id, value); continue; }
        if (op === 'open') {
          if (clients.has(id)) throw new Error('duplicate multiplex client');
          const handlers = new Map();
          const client = {
            accept() {},
            resume: resume(id),
            lastPing: () => lastPing(id),
            remember(clientId) { remember(id, clientId, value, ip, agent); },
            addEventListener(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
            emit(name, event) { for (const fn of handlers.get(name) ?? []) fn(event); },
            send(text) { out.send(['data', id, text]); },
            snapshot(snap, seat, settings, hz) { out.send(['view', id, snap, seat, settings, hz]); },
            snapshotGroup: group,
            subscribe(seat) { group.subscribe(id, seat); },
            buffered: () => out.buffered(),
            transportFacts,
            close(code, reason) { out.send(['close', id, code, reason]); clients.delete(id); seats.delete(id); onCount(clients.size); client.emit('close', {}); },
          };
          clients.set(id, client); onCount(clients.size);
          client.ready = new Promise((resolve, reject) => {
            const admit = async () => {
              if (closed || !clients.has(id)) { resolve(); return; }
              try { await connect(new Request(value, { headers: { Upgrade: 'websocket', ...(ip ? { 'cf-connecting-ip': ip } : {}), ...(agent ? { 'user-agent': agent } : {}) } }), client); client.attached = true; resolve(); }
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
            const deliver = () => {
              client.queued--;
              if (closed || !clients.has(id)) return;
              if (op === 'data') client.emit('message', { data: value, receivedAt: ip });
              else { out.forget(id); client.emit('close', {}); clients.delete(id); seats.delete(id); onCount(clients.size); }
            };
            if (client.attached && client.queued === 1) { deliver(); continue; }
            const task = client.ready = client.ready.then(deliver);
            pending.add(task); task.then(() => pending.delete(task), () => { pending.delete(task); client.close(1011, 'client message failed'); });
          }
        }
      }
      out.consumed(rows);
      if (admissions.length && !attaching) { if (admissionTimer !== null) clearTimeout(admissionTimer); pump(); }
    }).catch(error => { console.log(JSON.stringify({ ev: 'room-link-failed', stage: 'receive', error: String(error?.message ?? error).slice(0,160) })); shutdown(); try { socket.close(1011, 'room link failed'); } catch { /* The peer already closed; local shutdown still runs. */ } });
  });
  socket.addEventListener('close', shutdown);
  socket.addEventListener('error', shutdown);
  return { group, shutdown, flush:out.flush, reset() { synced=0;out.reset();for(const [id,seat] of seats)out.send(['seat',id,seat]); }, settled: async () => { await chain; await Promise.allSettled([...pending]); } };
}
export function acceptMultiplex(request, connect, options) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept(); multiplexSession(server, connect, options);
  return new Response(null, { status: 101, webSocket: client });
}

/** How often one player is sent the world, from what that player says it has.
 *
 * A socket to a slow player has no back-pressure a Worker can read, so a Gate
 * that writes every tick to a link that carries fewer leaves that player
 * seconds behind for good: every frame arrives, each one later than the last.
 * A client names the newest tick it holds (`g`, on its inputs and pings).
 *
 * Being behind is not the reason to send less: a connection that stalls for a
 * second and then delivers what it held catches up by itself, and sending it
 * less only makes it worse (0.46.2 paced all 600 players of a healthy room
 * when their one home link hiccuped). The reason is being behind and NOT
 * catching up: more than a second behind on two reports half a second apart,
 * the second not a quarter of a second nearer than the first. Then this
 * player's rate halves, down to one a second, and halves again while that
 * stays so. Within half a second of the room, the rate doubles back, a step a
 * second. Each frame is a delta
 * from the last one SENT, so a skipped tick costs nothing later, and the
 * player's own body is in every frame. A client that names nothing is sent
 * every tick, as before.
 */
export function deliveryPace(hz = 20) {
  let interval = 1, sent = -Infinity, changedAt = -Infinity, lag = null, behind = null;
  const most = Math.max(1, Math.round(hz));
  return {
    /** The client holds tick `tick`; the room is at `world`. `now` in ms. */
    report(tick, world, now) {
      if (!Number.isFinite(tick) || !Number.isFinite(world)) return;
      // A new room epoch restarts its ticks: a tick from the old one says nothing.
      lag = tick > world ? null : world - tick;
      if (lag === null) { behind = null; return; }
      if (lag <= hz / 2) { behind = null; if (interval > 1 && now - changedAt >= 1000) { interval = Math.max(1, interval / 2); changedAt = now; } return; }
      if (lag <= hz) { behind = null; return; }
      if (behind === null) { behind = { lag, at: now }; return; }
      if (now - behind.at < 500) return;
      // Catching up means a quarter of a second nearer in half a second; anything less is a link that cannot keep this rate.
      if (lag > behind.lag - hz / 4 && now - changedAt >= 500 && interval < most) { interval = Math.min(most, interval * 2); changedAt = now; }
      behind = { lag, at: now };
    },
    due(tick) { return tick < sent || tick - sent >= interval; },
    sent(tick) { sent = tick; },
    facts: () => ({ interval, lag }),
  };
}
const REPORTED_TICK = /^\{"t":"(?:in|ping)".{0,400}?"g":(\d{1,12})[,}]/;
/** A client built with 0.46.2 moves a body it was not sent along its last velocity: it says so in its hello. */
const COASTS = /^\{"t":"hello".{0,2000}?"coast":1[,}]/;

const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;

export class Gate {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.clients = new Map(); this.admissions = new Map(); this.sequence = 0; this.link = null; this.opening = null; this.timing = stageTimings(); this.metricsAt = 0; this.window = this.freshWindow(); this.worldTick = null; this.behind = new Set(); this.idle = null;
    this.relayEpoch = crypto.randomUUID();
    this.watchSockets = new WatchSockets(ctx);
    ctx.blockConcurrencyWhile?.(async () => {
      await this.watchSockets.restore(async (request, transport, attachment) => {
        transport.gateState = attachment.gate;
        await this.connect(request, transport);
      });
    });
  }
  freshWindow() { return { worlds: 0, frames: 0, bytes: 0, skipped: 0, inputs: 0, worldAge: [], tickFrom: null, tickFromAt: 0, tickAt: 0, gapMax: 0, gaps: [0, 0, 0], late: 0, busy: 0 }; }
  /** This Gate's own lateness: a timer every 20 ms, and how long past it each one came. A Gate that is out of time is late to its own timer. */
  watchLoop() {
    if (this.loopTimer) return;
    let due = Date.now() + 20;
    this.loopTimer = setInterval(() => {
      const now = Date.now(), late = Math.max(0, now - due); due = now + 20;
      this.window.late = Math.max(this.window.late, late); if (late > 20) this.window.busy += 1;
      // Diagnostics need a clock only while worlds are being delivered. An
      // idle audience must not keep fifty diagnostic callbacks a second alive.
      if (!this.link || !this.clients.size || now - (this.worldAt ?? 0) > 1000) { clearInterval(this.loopTimer); this.loopTimer = null; }
    }, 20);
    this.loopTimer?.unref?.();
  }
  /** `[sent, received, answered]`: this Gate's clock when its frame left, the room's when it read it and when it answered. */
  roomClock([sent, received, answered]) {
    const now = Date.now(), offset = ((received - sent) + (answered - now)) / 2, delay = (now - sent) - (answered - received);
    if (![offset, delay].every(Number.isFinite)) return;
    // The exchange with the least delay is the truest reading of the offset; forget it slowly.
    if (!this.clock || delay <= this.clock.delayMs || now - this.clock.at > 10_000) this.clock = { offsetMs: Math.round(offset), delayMs: Math.round(delay), heldMs: Math.round(answered - received), at: now };
  }
  async upstream(url) {
    if (this.link) return this.link;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const name = `${url.searchParams.get('game')}/${url.searchParams.get('room')}`;
      // One ordered channel from each Gate to the room. A relay between them
      // (0.45.0's Concentrator) parsed and re-sent every world for eight Gates
      // and was the first object to fall behind; sixteen channels of one frame
      // a tick each way are cheaper for the room than two of hundreds.
      const target = new URL(url); target.pathname = '/__multiplex';
      let socket;
      if ((url.searchParams.get('relay') === '1' || url.searchParams.get('host') === 'server')) {
        target.pathname = '/__relay';
        socket = relayChannel(this.ctx, data => this.env.TABLE.get(this.env.TABLE.idFromName(name)).fetch(target, {method:'POST',headers:{'x-homie-relay-epoch':this.relayEpoch},body:data}));
        this.relaySocket = socket;
      } else {
        const response = await this.env.TABLE.get(this.env.TABLE.idFromName(name)).fetch(new Request(target, { headers: { Upgrade: 'websocket' } }));
        if (!response.webSocket) throw new Error('room link refused');
        socket = response.webSocket; socket.accept();
      }
      // What players send leaves this Gate as one frame at most every 50 ms: at once when the channel has been
      // quiet, else with whatever arrived since the last. The room's one thread is spent by the message, so a
      // Gate costs it one a tick each way. (Timing that frame to land just before the room's tick was tried twice
      // and failed twice on Cloudflare: the round trip to the room varies by more than the window it aims for.)
      const link = batchLink(socket, { receipts: socket !== this.relaySocket, delay: 50, maxFrames: 8, autoReceipt: false, onAck: (waited, clock) => { if (clock) this.roomClock(clock); } });
      let sink = worldSink(), worldReady = false;
      socket.addEventListener('reset',()=>{link.reset();sink=worldSink();worldReady=false;this.worlds=null;for(const client of this.clients.values()){client.snapEncoder=null;client.crowd=null;}link.send(['resync']);});
      const lost = (event = {}) => {
        if (this.link !== link) return;
        console.log(JSON.stringify({ ev: 'room-link-lost', room: name, gate: url.searchParams.get('gate'), layer: 'gate', code: event.code ?? null, reason: event.reason ?? null, error: event.error?.message ?? null, clients: this.clients.size, transport: link.facts() }));
        this.link = null; this.worlds = null; link.close();
        for (const timer of this.admissions.values()) clearTimeout(timer); this.admissions.clear();
        for (const client of this.clients.values()) { try { client.close(1012, 'room link restarted'); } catch { /* The peer already closed; local shutdown still runs. */ } }
        this.clients.clear();
      };
      const drop = (id, client) => { this.clients.delete(id); link.send(['close', id]); try { client.close(1011, 'client connection ended'); } catch { /* The peer already closed; local shutdown still runs. */ } };
      socket.addEventListener('message', event => {
        if (typeof event.data !== 'string') return;
        try {
          const rows = parseFrame(event); let hz = null;
          for (const row of rows) {
            if(row[0]==='link-close'){lost({code:row[1],reason:row[2]});return;}
            if (row[0] === 'world') { hz = row[4]; if(row[2].w && !worldReady && !row[2].w.ids){link.send(['resync']);continue;} worldReady=true; const snap = row[2].w ? sink.decode(row[2], row[5]) : row[2]; this.deliver(snap, row[3], row[4], drop); continue; }
            for (const [op, id, value, reason, settings, rate] of expandBatch([row])) {
              const client = this.clients.get(id);
              if (op === 'seat') { if (client) { client.seat = value; client.subscribed = true; client.rememberGate?.({...client.gateState,seat:value,subscribed:true}); } }
              else if (op === 'view') { if (client) this.deliverOne(id, client, value, reason, settings, rate, drop); }
              else if (op === 'data') { try { client?.send(value); } catch { if (client) drop(id, client); } }
              else if (op === 'close') { this.clients.delete(id); try { client?.close(value, reason); } catch { /* The peer already closed; local shutdown still runs. */ } }
            }
          }
          link.consumed(rows);
          if(socket===this.relaySocket)for(const [id,client] of this.clients){
            const ping=client.lastPing?.()??0;
            if(ping>(client.forwardedPing??0)){client.forwardedPing=ping;link.send(['data',id,JSON.stringify({t:'ping',c:ping})]);}
          }
          if (hz && Date.now() - this.metricsAt >= 1000) this.publishMetrics(url, link);
        } catch (error) { lost({ error, reason: 'invalid room frame' }); try { socket.close(1011, 'room link failed'); } catch { /* The peer already closed; local shutdown still runs. */ } }
      });
      socket.addEventListener('close', lost); socket.addEventListener('error', lost);
      // A Gate nobody is on gives its channel back after ten seconds: an open channel keeps the room and this Gate in
      // memory (and billed) with nothing to carry. The next player to arrive opens another, as the first did.
      this.rest = () => {
        if (this.link !== link || this.clients.size) return;
        this.link = null; this.worlds = null; link.close();
        try { socket.close(1000, 'no players'); } catch { /* gone */ }
      };
      this.link = link; if(socket===this.relaySocket)this.openRelay(url,socket); return link;
    })();
    try { return await this.opening; } finally { this.opening = null; }
  }
  /** One world from the room: every player this Gate holds gets their own view of it. */
  deliver(snap, settings, hz, drop) {
    const w = this.window, now = Date.now(); w.worlds++;
    if (w.tickFrom === null) { w.tickFrom = this.worldTick ?? snap.k; w.tickFromAt = this.worldAt ?? now; }
    if (this.worldAt) { const gap = now - this.worldAt; w.gapMax = Math.max(w.gapMax, gap); if (gap > 75) w.gaps[0] += 1; if (gap > 150) w.gaps[1] += 1; if (gap > 300) w.gaps[2] += 1; }
    this.worldTick = snap.k; this.worldAt = now; w.tickAt = now;
    this.watchLoop();
    // By this Gate's clock, corrected for what the room's clock is measured to differ by.
    if (Number.isFinite(snap.st)) w.worldAge.push(Math.max(0, now - snap.st + (this.clock?.offsetMs ?? 0)));
    for (const [id, client] of this.clients) if (client.subscribed) this.deliverOne(id, client, snap, client.seat, settings, hz, drop);
  }
  deliverOne(id, client, snap, seat, settings, hz, drop) {
    try {
      if (client.snapshot) { client.snapshot(snap, seat, settings, hz); return; }
      client.pace ??= deliveryPace(hz);
      if (!client.pace.due(snap.k)) { this.window.skipped++; return; }
      if (client.coasts) {
        // A client that coasts (0.46.2) takes the crowd path: what does not depend on the player is done once a world.
        const at = this.timing.now();
        // A room's view settings are its game's, fixed for the life of the link.
        this.worlds ??= crowdWorlds(settings ?? {});
        client.crowd ??= crowdView(this.worlds, settings ?? {}, hz);
        const text = client.crowd(snap, seat);
        this.timing.record('encode', at);
        client.send(text); client.pace.sent(snap.k);
        this.window.frames++; this.window.bytes += text.length;
        return;
      }
      const viewAt = this.timing.now();
      client.viewSchedule ??= scheduledView(settings, hz);
      // This encoder sits after coalescing on an ordered WebSocket. A
      // fresh connection/epoch gets a keyframe; subsequent deltas cannot
      // lose a predecessor, so do not repeat a full interest set each second.
      client.snapEncoder ??= snapshotEncoder(Infinity, true);
      const selected = client.viewSchedule(snap, seat);
      this.timing.record('view', viewAt);
      const encodeAt = this.timing.now();
      const text = snapshotText({ t: 'snap', from: null, ...client.snapEncoder.encode(selected, seat) });
      this.timing.record('encode', encodeAt);
      const sendAt = this.timing.now();
      client.send(text); client.pace.sent(snap.k);
      this.window.frames++; this.window.bytes += text.length;
      this.timing.record('send', sendAt);
    } catch { drop(id, client); }
  }
  async connect(request, server) {
    const link = await this.upstream(new URL(request.url));
    const id = server.gateState?.id ?? (server.rememberGate ? crypto.randomUUID() : String(++this.sequence));
    if (server.gateState) Object.assign(server, server.gateState);
    server.gateState ??= {id,opened:false};
    server.rememberGate?.(server.gateState);
    this.clients.set(id, server); clearTimeout(this.idle); this.idle = null;
    let opened = server.gateState?.opened === true;
    const deadline = setTimeout(() => {
      this.admissions.delete(id);
      if (!opened && this.clients.delete(id)) { try { server.close(4000, 'no-hello'); } catch { /* The peer already closed; local shutdown still runs. */ } }
    }, 5000);
    deadline?.unref?.(); if (opened) clearTimeout(deadline); else this.admissions.set(id, deadline);
    server.addEventListener('message', event => {
      if (!this.clients.has(id) || typeof event.data !== 'string') return;
      // No legal public frame exceeds the largest checkpoint allowance
      // (128 KiB). Reject it before it exhausts a shared relay's budget.
      // The Table still enforces each message kind's smaller byte caps.
      if (event.data.length > 128 * 1024) {
        clearTimeout(deadline); this.admissions.delete(id); this.clients.delete(id);
        if (opened) link.send(['close', id]);
        try { server.close(1009, 'message too large'); } catch { /* The peer already closed; local shutdown still runs. */ }
        return;
      }
      if (!opened) {
        opened = true; clearTimeout(deadline); this.admissions.delete(id);
        server.coasts = COASTS.test(event.data);
        server.gateState = {id,opened:true,coasts:server.coasts};
        server.rememberGate?.(server.gateState);
        // Logical creation and the first frame share a batch: admission time at
        // the Table excludes the public handshake and relay transit.
        link.send(['open', id, request.url, request.headers.get('cf-connecting-ip'), request.headers.get('user-agent')]);
      }
      const now = Date.now();
      const said = REPORTED_TICK.exec(event.data);
      if (said && server.pace && this.worldTick !== null) {
        server.pace.report(Number(said[1]), this.worldTick, now);
        // Counted, never acted on: players more than a second behind at this moment. Many at once on one Gate is a
        // connection they share or something upstream of them all; each is still paced by their own reports alone
        // (a full shared link is cured by sending each of them less, and nothing else cures it).
        if ((server.pace.facts().lag ?? 0) > 20) this.behind.add(id); else this.behind.delete(id);
      }
      this.window.inputs++;
      // Only the public Gate stamps ingress; a player cannot supply it inside their JSON.
      link.send(['data', id, event.data, Number.isFinite(event.receivedAt) ? event.receivedAt : now]);
    });
    const left = () => { this.behind.delete(id); clearTimeout(deadline); this.admissions.delete(id); if (this.clients.delete(id) && opened) link.send(['close', id]); if (!this.clients.size && !this.idle) { this.idle = setTimeout(() => { this.idle = null; this.rest?.(); }, 10_000); this.idle?.unref?.(); } };
    server.addEventListener('close', left); server.addEventListener('error', left);
  }
  /** What this Gate did in the last second, for whoever is measuring the room. */
  gateFacts(link, now = Date.now()) {
    const w = this.window, seconds = Math.max(0.001, (now - (this.metricsAt || now - 1000)) / 1000);
    const subscribed = [...this.clients.values()].filter(c => c.subscribed);
    const paces = subscribed.map(c => c.pace?.facts()).filter(Boolean);
    const lags = paces.map(p => p.lag).filter(Number.isFinite).sort((a, b) => a - b), ages = w.worldAge.sort((a, b) => a - b);
    return {
      ...link.facts(), view: this.timing.facts(), clients: this.clients.size, subscribed: subscribed.length, tick: this.worldTick,
      // Per second: worlds received from the room, and frames written to each player on average.
      worldHz: Math.round(w.worlds / seconds * 100) / 100,
      deliveredHz: subscribed.length ? Math.round(w.frames / seconds / subscribed.length * 100) / 100 : null,
      bytesPerSecond: Math.round(w.bytes / seconds), inputsPerSecond: Math.round(w.inputs / seconds), skipped: w.skipped,
      // Room stamp to this Gate writing it to players, ms (both are Cloudflare's clock at the start of an event).
      worldAgeMs: { p50: percentile(ages, 0.5), p95: percentile(ages, 0.95), max: ages.at(-1) ?? null },
      // Of this second's worlds: how many were over 100, 200 and 400 ms old when this Gate wrote them, and how many came
      // more than 75, 150 and 300 ms after the one before (a world is due every 50).
      worldsOld: { n: ages.length, over100: ages.filter(a => a > 100).length, over200: ages.filter(a => a > 200).length, over400: ages.filter(a => a > 400).length },
      worldGaps: { over75: w.gaps[0], over150: w.gaps[1], over300: w.gaps[2] },
      // How far behind the room players say they are, in ticks, and how many are being sent fewer frames for it.
      clientLagTicks: { reporting: lags.length, p50: percentile(lags, 0.5), p95: percentile(lags, 0.95), max: lags.at(-1) ?? null },
      paced: paces.filter(p => p.interval > 1).length, behind: this.behind.size,
      coasting: subscribed.filter(c => c.coasts).length,
      // Ticks the room's worlds advanced a second, by THIS Gate's clock: the room's own clock cannot see itself run late.
      roomTickHz: w.tickFrom !== null && w.tickAt > w.tickFromAt ? Math.round((this.worldTick - w.tickFrom) / (w.tickAt - w.tickFromAt) * 100000) / 100 : null,
      worldGapMs: w.gapMax,
      // The room's clock less this Gate's, and the channel's delay, from stamps exchanged on the channel (as NTP does).
      roomClock: this.clock ?? null,
      // The worst this Gate's own 20 ms timer came late in the second, and how many of the fifty came over 20 ms late.
      loopLateMs: w.late, loopLateTimers: w.busy,
    };
  }
  publishMetrics(url, link) {
    const now = Date.now(), facts = this.gateFacts(link, now);
    this.metricsAt = now; this.window = this.freshWindow();
    if (!this.env.GATE || this.metricsPending) return;
    this.metricsPending = true;
    const work = diagnosticsOf(this.env, url.searchParams.get('game'), url.searchParams.get('room')).fetch('https://diagnostics/__diagnostics', {
      method: 'POST', body: JSON.stringify({ kind: 'gate', id: `gate/${url.searchParams.get('gate')}`, at: now, ...facts }),
    }).then(r => r.body?.cancel?.()).catch(error => console.warn("Gate diagnostic publication failed:",error.message)).finally(() => { this.metricsPending = false; });
    this.ctx.waitUntil?.(work);
  }
  /** The room's diagnostics, kept by an object that is neither the room nor a
   * Gate with players: the room and its Gates each post a second's facts here,
   * and a reader is answered from the copy. Measuring a room costs it nothing,
   * and a room too busy to answer still has its last word (and its age) read.
   */
  async diagnosticsFetch(request, url) {
    if (request.method === 'POST') {
      const value = await request.json();
      if (value.kind === 'gate') { this.gateDiagnostics ??= new Map(); this.gateDiagnostics.set(value.id, value); }
      else this.diagnostics = value;
      return new Response(null, { status: 204 });
    }
    const at = Date.now();
    for (const [id, value] of this.gateDiagnostics ?? []) if (at - value.at > 15_000) this.gateDiagnostics.delete(id);
    const gates = [...(this.gateDiagnostics?.values() ?? [])].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    return Response.json({ toolkit: STUDIO_BUILD, room: url.searchParams.get('room'), ...this.diagnostics, gates, diagnostics: { cached: true, at: this.diagnostics?.st ?? null, ageMs: this.diagnostics ? at - this.diagnostics.st : null } });
  }
  openRelay(url,socket) {
    if(this.readingRelay){this.relayAgain=true;return;}
    const target=new URL(url);target.pathname='/__relay-stream';
    const key=`${url.searchParams.get('game')}/${url.searchParams.get('room')}`;
    this.readingRelay=(async()=>{
      const response=await this.env.TABLE.get(this.env.TABLE.idFromName(key)).fetch(target,{headers:{'x-homie-relay-epoch':this.relayEpoch}});
      const epoch=response.headers.get('x-homie-relay-epoch');
      if(this.remoteRelayEpoch!==epoch){this.remoteRelayEpoch=epoch;socket.emit('reset',{});}
      await readRelay(response,socket);
    })().catch(error=>socket.emit('error',{error})).finally(()=>{
      this.readingRelay=null;
      if(this.relayAgain&&this.link){this.relayAgain=false;this.openRelay(url,socket);}
    });
    this.ctx.waitUntil(this.readingRelay);
  }
  webSocketMessage(socket, message) { this.watchSockets.message(socket,message); }
  webSocketClose(socket) { return this.watchSockets.close(socket); }
  webSocketError(socket,error) { return this.watchSockets.close(socket,error); }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__diagnostics') return this.diagnosticsFetch(request, url);
    if (url.pathname === '/__relay-presence') {
      return Response.json([...this.clients].map(([id,client])=>[id,client.lastPing?.()??0]));
    }
    if (url.pathname === '/__relay-wake') {
      if(this.link)this.openRelay(url,this.relaySocket);else await this.upstream(url);
      return new Response(null,{status:204});
    }
    if (url.pathname === '/__multiplex') return acceptMultiplex(request, (req, socket) => this.connect(req, socket));
    const [client, server] = Object.values(new WebSocketPair());
    const transport = (url.searchParams.get('relay') === '1' || url.searchParams.get('host') === 'server') && this.ctx.acceptWebSocket ? await this.watchSockets.accept(server, request) : server;
    transport.accept();
    await this.connect(request, transport);
    return new Response(null, { status: 101, webSocket: client });
  }
}
/** The object that keeps one room's diagnostics (a Gate by class, never one with players). */

/** Kept so a studio deployed with 0.45.0's Concentrator binding still loads; nothing opens one. */
export class Concentrator extends Gate {}
