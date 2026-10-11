/** Load clients live on worker threads; every snapshot is decoded, no per-frame diagnostic re-encoding. */
import { parentPort, workerData } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import WebSocket from 'ws';
import { snapshotDecoder } from '../rules/interest.mjs';

export class Histogram {
  bins = new Uint32Array(60001);
  count = 0;
  max = 0;
  add(ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.bins[Math.min(60000, Math.round(ms))]++;
    this.count++;
    this.max = Math.max(this.max, ms);
  }
  merge(h) {
    for (let i = 0; i < this.bins.length; i++) this.bins[i] += h.bins[i];
    this.count += h.count;
    this.max = Math.max(this.max, h.max);
  }
  json() {
    const p = (q) => {
      let n = 0;
      for (let i = 0; i < this.bins.length; i++) {
        n += this.bins[i];
        if (n >= Math.ceil(this.count * q)) return this.count ? i : null;
      }
      return null;
    };
    return {
      count: this.count,
      p50: p(0.5),
      p95: p(0.95),
      p99: p(0.99),
      max: this.max
    };
  }
}
export function createLoad({
  origin,
  game,
  room,
  index = 0,
  workers = 1,
  lead = 3,
  compress = true,
  onProblem = () => {}
}) {
  const clients = [],
    errors = new Map(),
    first = new Histogram(),
    welcome = new Histogram(),
    ack = new Histogram(),
    gaps = new Histogram();
  // Snapshots that said how early this player's input was, and how many said late.
  let lateAcks = 0,
    onTime = 0;
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let measuring = false,
    rampCancelled = false,
    stopping = false,
    epoch = null,
    totalUp = 0,
    totalDown = 0,
    up = 0,
    down = 0,
    sent = 0,
    inputFrames = 0,
    received = 0,
    skipped = 0,
    expired = 0,
    disconnects = 0,
    peakLag = 0,
    badLag = 0,
    stopReason = null;
  let timer,
    expected = performance.now();
  const problem = (type, value) => {
    const key = `${type}: ${String(value).slice(0, 300)}`;
    if (errors.has(key)) errors.set(key, errors.get(key) + 1);
    else if (errors.size < 100) {
      errors.set(key, 1);
      onProblem(key);
    }
  };
  function send(c, m) {
    if (c.ws?.readyState !== 1) return;
    if (c.ws.bufferedAmount > 262144) {
      stopReason ??= 'driver send backlog';
      return;
    }
    const text = JSON.stringify(m),
      bytes = Buffer.byteLength(text);
    c.ws.send(text);
    totalUp += bytes;
    if (measuring) {
      up += bytes;
      sent++;
      if (m.t === 'in') inputFrames++;
      c.up += bytes;
    }
  }
  function snapshot(c, raw) {
    c.rawSnapshots++;
    c.rawTick = raw.k;
    const snap = c.decoder.decode(raw);
    if (!snap) {
      c.decodeMiss++;
      return;
    }
    const own = snap.d[1].find((e) => e[9] === c.seat && e[10] !== 1);
    if (!own) {
      c.ownMissing++;
      return;
    }
    const now = performance.now();
    epoch ??= snap.e;
    if (epoch !== snap.e) stopReason ??= 'room restarted';
    if (c.first === null) {
      c.first = now;
      first.add(now - c.began);
    }
    if (c.epoch !== snap.e) {
      c.pending.clear();
      c.lastSent = 0;
      c.epoch = snap.e;
    }
    const gap = c.at ? now - c.at : 0;
    c.maxStateGapMs = Math.max(c.maxStateGapMs, gap);
    c.k = snap.k;
    c.at = now;
    c.own = own;
    c.r = own[2];
    c.snapshots++;
    if (measuring) {
      c.firstTick ??= snap.k;
      c.firstAt ??= now;
      c.lastTick = snap.k;
      c.lastAt = now;
      c.frames++;
      gaps.add(gap);
    }
    const control = snap.c?.find((row) => row[0] === c.seat);
    // The room says how early this player's inputs arrive, in sixteenths of a
    // tick (the smallest since its last snapshot). The toolkit's client steers
    // its clock by that; this probe moves its whole-tick lead: one more when
    // an input in the last second was under half a tick early, one fewer when
    // every input in the last three seconds was more than two early.
    if (control && control[3] !== -128 && control[3] !== undefined) {
      const early = control[3] / 16;
      if (measuring) { if (early <= 0) lateAcks++; onTime++; }
      c.minEarly = Math.min(c.minEarly ?? Infinity, early);
      c.leadSamples = (c.leadSamples ?? 0) + 1;
      if (early < 0.5 && now - (c.leadAt ?? 0) > 1000 && c.lead < 12) { c.lead++; c.leadAt = now; c.minEarly = Infinity; c.leadSamples = 0; }
      else if (c.leadSamples >= 30 && now - (c.leadAt ?? 0) > 3000) { if (c.minEarly > 2 && c.lead > 1) c.lead--; c.leadAt = now; c.minEarly = Infinity; c.leadSamples = 0; }
    }
    if (control)
      for (const [tick, at] of c.pending) {
        if (tick > control[2]) break;
        c.pending.delete(tick);
        if (measuring) {
          if (tick === control[2]) ack.add(now - at);
          else skipped++;
        }
      }
  }
  async function connect(i, reused) {
    const c = {
      i,
      key: reused?.key ?? randomBytes(18).toString('base64url'),
      seat: null,
      token: reused?.token ?? null,
      priorSeat: reused?.seat ?? null,
      first: null,
      lead,
      began: performance.now(),
      decoder: snapshotDecoder(),
      pending: new Map(),
      epoch: null,
      k: 0,
      r: 0,
      at: 0,
      lastSent: 0,
      firstTick: null,
      firstAt: null,
      lastTick: null,
      lastAt: null,
      frames: 0,
      up: 0,
      down: 0,
      snapshots: 0,
      rawSnapshots: 0,
      decodeMiss: 0,
      ownMissing: 0,
      maxStateGapMs: 0,
      own: null,
      nextPing: performance.now() + (i % 20) * 100,
      nextInput: performance.now() + (i % 10) * 10
    };
    clients.push(c);
    try {
      const response = await fetch(
        `${origin}/${game}/__game/?room=${encodeURIComponent(room)}&device=desk&want=play&b=${c.key}`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (!response.ok) throw Error(`bootstrap HTTP ${response.status}`);
      const match = (await response.text()).match(
        /window\.HOMIE_NET=(\{[^<]+\})<\/script>/
      );
      if (!match) throw Error('No HOMIE_NET bootstrap');
      const cfg = JSON.parse(match[1]);
      if (cfg.room !== undefined && cfg.room !== room)
        throw Error('bootstrap changed the requested room');
      c.ws = new WebSocket(cfg.url, {
        origin: 'null',
        handshakeTimeout: 15000,
        // A browser always offers compression; a driver that refuses it asks
        // one uplink for several times the bytes real players would cost it.
        perMessageDeflate: compress
      });
      c.ws.on('open', () => {
        c.helloAt = performance.now();
        c.compressed = /permessage-deflate/.test(c.ws.extensions ?? '');
        send(c, {
          t: 'hello',
          rules: true,
          v: 1,
          rev: 12,
          token: c.token,
          name: `Load ${i}`,
          device: 'desk',
          want: 'play',
          canHost: false,
          // As the toolkit's client (0.46.2): this decoder coasts a body it was not sent.
          coast: 1,
          game,
          max: 1000,
          ...(cfg.ver ? { ver: cfg.ver } : {})
        });
      });
      c.ws.on('message', (data) => {
        totalDown += data.length;
        if (measuring) {
          down += data.length;
          received++;
          c.down += data.length;
        }
        let m;
        try {
          m = JSON.parse(data.toString());
        } catch {
          problem('decode', i);
          return;
        }
        if (m.t === 'welcome') {
          c.token = m.token;
          c.seat = m.seat;
          welcome.add(performance.now() - c.began);
          if (m.full || c.seat === null) problem('unseated', i);
          if (m.snap) snapshot(c, m.snap);
        } else if (m.t === 'snap') snapshot(c, m);
        else if (m.t === 'seat') c.seat = m.seat;
        else if (m.t === 'err' || m.t === 'error') {
          problem(m.code ?? m.t, m.message);
          if (
            ['room-over', 'host-fault', 'host-failed', 'closed'].includes(
              m.code
            )
          )
            stopReason ??= `server ${m.code}`;
        }
      });
      c.ws.on('error', (e) => problem('socket', e.message));
      c.ws.on('unexpected-response', (_req, res) => {
        problem('upgrade', res.statusCode);
        res.resume();
        c.ws.terminate();
      });
      c.ws.on('close', (code, reason) => {
        c.closeCode = code;
        c.closeReason = String(reason);
        c.closedAt = performance.now();
        if (!stopping && !c.retired) {
          disconnects++;
          problem('close', `${code} ${reason}`);
        }
      });
    } catch (e) {
      problem('connect', e.message);
    }
  }
  // Stagger sends into 10 ms slices. No catch-up burst after a held timer.
  timer = setInterval(() => {
    const now = performance.now(),
      lag = Math.max(0, now - expected - 10);
    expected = now;
    peakLag = Math.max(peakLag, lag);
    badLag = lag > 2000 ? badLag + 1 : 0;
    if (badLag >= 3) stopReason ??= 'driver event loop stalled';
    for (const c of clients) {
      if (c.retired || c.ws?.readyState !== 1) continue;
      if (now >= c.nextPing) {
        send(c, { t: 'ping', c: Date.now(), hid: false });
        c.nextPing = now + 2000;
      }
      if (c.own && now - c.at > 5000 && !c.staleReported) {
        c.staleReported = true;
        problem('stale snapshot', 'own state absent for more than 5 seconds');
      }
      if (!c.own || now - c.at > 2000 || now < c.nextInput) continue;
      c.nextInput += 100;
      if (c.nextInput <= now) c.nextInput = now + 100;
      const k = Math.max(
          c.lastSent + 1,
          c.k + Math.min(10, Math.floor((now - c.at) / 50)) + c.lead
        ),
        y = c.own[3][1],
        east = Boolean(c.own[7][1]);
      send(c, {
        t: 'in',
        e: c.epoch,
        k,
        s: [
          [
            0,
            east ? 127 : -127,
            y > 55
              ? -35
              : y < -55
                ? 35
                : Math.round(Math.sin(now / 3100 + c.i) * 35)
          ]
        ],
        r: c.r,
        // The newest tick this socket holds, as the toolkit's own client says it.
        ...(c.rawTick !== undefined ? { g: c.rawTick } : {})
      });
      c.pending.set(k, now);
      c.lastSent = k;
      for (const [tick, at] of c.pending) {
        if (now - at <= 5000) break;
        c.pending.delete(tick);
        if (measuring) expired++;
      }
    }
  }, 10);
  const summary = () => ({
    worker: index,
    attempted: clients.length,
    connected: clients.filter((c) => c.ws?.readyState === 1).length,
    joined: clients.filter((c) => !c.retired && c.first !== null).length,
    fresh: clients.filter(
      (c) =>
        !c.retired &&
        c.ws?.readyState === 1 &&
        c.own &&
        performance.now() - c.at < 2000
    ).length,
    stopReason,
    epoch,
    inputFrames,
    disconnects,
    loopP99Ms: loop.percentile(99) / 1e6,
    peakTimerLagMs: peakLag,
    upBytes: up,
    downBytes: down,
    upFrames: sent,
    downFrames: received,
    // Bytes off the wire (after TLS, before inflation) for sockets still open.
    wireDownBytes: clients.reduce(
      (a, c) =>
        a + Math.max(0, (c.ws?._socket?.bytesRead ?? 0) - (c.wire0 ?? 0)),
      0
    ),
    compressed: clients.filter((c) => c.compressed).length
  });
  return {
    connect,
    summary,
    cancelRamp() {
      rampCancelled = true;
    },
    async ramp(n, rampMs) {
      await new Promise((r) => setTimeout(r, index * rampMs));
      const pending = new Set();
      for (let i = index; i < n && !stopping && !rampCancelled; i += workers) {
        while (pending.size >= Math.max(1, Math.floor(8 / workers)))
          await Promise.race(pending);
        if (rampCancelled || stopping) break;
        const task = connect(i).finally(() => pending.delete(task));
        pending.add(task);
        await new Promise((r) => setTimeout(r, rampMs * workers));
      }
      await Promise.all(pending);
    },
    start() {
      measuring = true;
      for (const c of clients) {
        c.wire0 = c.ws?._socket?.bytesRead ?? 0;
        c.pending.clear();
        c.firstTick = null;
        c.firstAt = null;
        c.frames = 0;
      }
    },
    async churn(count) {
      const leaving = clients.filter(
        (c) =>
          c.i < count &&
          !c.retired &&
          c.first !== null &&
          c.ws?.readyState === 1
      );
      for (const c of leaving) {
        c.retired = true;
        c.ws.close(1000, 'churn');
      }
      await new Promise((r) => setTimeout(r, 1000));
      await Promise.all(leaving.map((c) => connect(c.i, c)));
      return leaving.length;
    },
    async finish() {
      const end = summary();
      measuring = false;
      stopping = true;
      clearInterval(timer);
      loop.disable();
      for (const c of clients) c.ws?.close(1000, 'load step complete');
      await new Promise((r) => setTimeout(r, 250));
      for (const c of clients) if (c.ws?.readyState !== 3) c.ws?.terminate();
      return {
        ...end,
        errors: [...errors].map(([text, count]) => ({ text, count })),
        histograms: { first, welcome, ack, gaps },
        inputReports: onTime,
        inputReportsLate: lateAcks,
        leadTicks: clients.filter((c) => !c.retired).map((c) => c.lead),
        ackSkipped: skipped,
        ackExpired: expired,
        totalUp,
        totalDown,
        players: clients.map((c) => ({
          i: c.i,
          seat: c.seat,
          epoch: c.epoch,
          priorSeat: c.priorSeat,
          sameSeat: c.priorSeat === null ? null : c.seat === c.priorSeat,
          retired: Boolean(c.retired),
          firstStateMs: c.first === null ? null : c.first - c.began,
          helloAfterMs: c.helloAt ? c.helloAt - c.began : null,
          closeCode: c.closeCode,
          closeReason: c.closeReason,
          maxStateGapMs: c.maxStateGapMs,
          rawSnapshots: c.rawSnapshots,
          decodeMiss: c.decodeMiss,
          ownMissing: c.ownMissing,
          frames: c.frames,
          tickHz:
            c.lastAt > c.firstAt
              ? ((c.lastTick - c.firstTick) * 1000) / (c.lastAt - c.firstAt)
              : null,
          deliveredHz:
            c.lastAt > c.firstAt
              ? ((c.frames - 1) * 1000) / (c.lastAt - c.firstAt)
              : null,
          upBytes: c.up,
          downBytes: c.down
        }))
      };
    }
  };
}
if (parentPort) {
  const load = createLoad({
    ...workerData,
    onProblem: (text) => parentPort.postMessage({ event: 'error', text })
  });
  parentPort.on('message', async ({ id, op, args = [] }) => {
    try {
      const value = await load[op](...args);
      parentPort.postMessage({ id, value });
    } catch (e) {
      parentPort.postMessage({ id, error: e.stack });
    }
  });
}
