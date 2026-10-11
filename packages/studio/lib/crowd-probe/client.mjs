/**
 * One simulated player, as the load probe plays it: says hello as the toolkit's client does (rules, coasting),
 * decodes every snapshot, steers across the arena with a slow weave at ten inputs a second stamped a few ticks
 * ahead, follows the room's word on how early those arrive, and names the tick it holds. No socket and no clock of
 * its own: whoever runs it (the in-Cloudflare probe, a test) hands it messages and the time.
 */
import { snapshotDecoder } from '../../rules/interest.mjs';

/** Counts by whole milliseconds, mergeable across players and across the Workers that ran them. */
export class Tally {
  constructor(bins = {}) { this.bins = bins; }
  add(ms) { if (Number.isFinite(ms) && ms >= 0) { const k = Math.min(60000, Math.round(ms)); this.bins[k] = (this.bins[k] ?? 0) + 1; } }
  merge(other) { for (const [k, n] of Object.entries(other?.bins ?? other ?? {})) this.bins[k] = (this.bins[k] ?? 0) + n; return this; }
  json() {
    const keys = Object.keys(this.bins).map(Number).sort((a, b) => a - b), count = keys.reduce((a, k) => a + this.bins[k], 0);
    const at = (q) => { let n = 0; for (const k of keys) { n += this.bins[k]; if (n >= Math.ceil(count * q)) return k; } return null; };
    return { count, p50: count ? at(0.5) : null, p95: count ? at(0.95) : null, p99: count ? at(0.99) : null, max: keys.at(-1) ?? 0 };
  }
}

export function crowdClient({ index, game, send, tallies, period = 50, lead = 3 }) {
  const decoder = snapshotDecoder(), pending = new Map();
  const c = { index, seat: null, epoch: null, k: 0, at: 0, r: 0, own: null, lead, lastSent: 0, nextInput: 0, nextPing: 0, early: [], leadAt: 0,
    measuring: false, frames: 0, firstTick: null, firstAt: null, lastTick: null, lastAt: null, down: 0, up: 0, inputs: 0, reports: 0, late: 0,
    undecodable: 0, ownMissing: 0, maxGap: 0, welcomed: null, first: null, began: null, errors: [], closed: null, rawTick: undefined };
  const say = (m, now) => { const text = JSON.stringify(m); if (c.measuring) c.up += text.length; send(text, now); };
  return {
    c,
    open(now) {
      c.began = now; c.nextPing = now + (index % 20) * 100; c.nextInput = now + (index % 10) * 10;
      say({ t: 'hello', rules: true, v: 1, rev: 12, token: null, name: `Probe ${index}`, device: 'desk', want: 'play', canHost: false, coast: 1, game, max: 1000 }, now);
    },
    measure() { c.measuring = true; pending.clear(); c.firstTick = c.firstAt = null; c.frames = 0; c.down = c.up = c.inputs = c.reports = c.late = 0; c.maxGap = 0; },
    message(text, now) {
      if (c.measuring) c.down += text.length;
      let m; try { m = JSON.parse(text); } catch { c.errors.push('decode'); return; }
      if (m.t === 'welcome') { c.seat = m.seat; c.welcomed = now - c.began; if (m.full || c.seat === null) c.errors.push('unseated'); if (m.snap) this.snapshot(m.snap, now); }
      else if (m.t === 'snap') this.snapshot(m, now);
      else if (m.t === 'seat') c.seat = m.seat;
      else if (m.t === 'err' || m.t === 'error') c.errors.push(`${m.code ?? m.t}: ${String(m.message ?? '').slice(0, 80)}`);
    },
    snapshot(raw, now) {
      c.rawTick = raw.k;
      const snap = decoder.decode(raw);
      if (!snap) { c.undecodable += 1; return; }
      const own = snap.d[1].find((e) => e[9] === c.seat && e[10] !== 1);
      if (!own) { c.ownMissing += 1; return; }
      if (c.first === null) c.first = now - c.began;
      if (c.epoch !== snap.e) { pending.clear(); c.lastSent = 0; c.epoch = snap.e; }
      const gap = c.at ? now - c.at : 0;
      c.k = snap.k; c.at = now; c.own = own; c.r = own[2];
      if (c.measuring) { c.firstTick ??= snap.k; c.firstAt ??= now; c.lastTick = snap.k; c.lastAt = now; c.frames += 1; c.maxGap = Math.max(c.maxGap, gap); tallies.gaps.add(gap); }
      const control = snap.c?.find((row) => row[0] === c.seat);
      if (!control) return;
      if (control[3] !== -128 && control[3] !== undefined) {
        const early = control[3] / 16;
        if (c.measuring) {
          c.reports += 1; if (early <= 0) c.late += 1;
          // From the tick this player held when it stamped an input to the tick that input reached the rules:
          // what the room, the Gate and both ways of the connection took, whatever lead the player keeps.
          tallies.loops.add((c.lead - early) * period);
        }
        c.early.push(early); if (c.early.length > 40) c.early.shift();
        if (c.early.length >= 20 && now - c.leadAt > 2000) {
          const low = c.early.slice().sort((a, b) => a - b)[Math.floor(c.early.length / 20)];
          if (low < 0.5 && c.lead < 12) c.lead += 1; else if (low > 1.5 && c.lead > 1) c.lead -= 1;
          c.leadAt = now; c.early.length = 0;
        }
      }
      for (const [tick, at] of pending) {
        if (tick > control[2]) break;
        pending.delete(tick);
        if (c.measuring && tick === control[2]) tallies.ack.add(now - at);
      }
    },
    /** Call every ten milliseconds or so. */
    tick(now) {
      if (c.closed) return;
      if (now >= c.nextPing) { say({ t: 'ping', c: Math.round(now), hid: false, ...(c.rawTick !== undefined ? { g: c.rawTick } : {}) }, now); c.nextPing = now + 2000; }
      if (!c.own || now - c.at > 2000 || now < c.nextInput) return;
      c.nextInput += 100; if (c.nextInput <= now) c.nextInput = now + 100;
      const k = Math.max(c.lastSent + 1, c.k + Math.min(10, Math.floor((now - c.at) / period)) + c.lead), y = c.own[3][1], east = Boolean(c.own[7][1]);
      say({ t: 'in', e: c.epoch, k, s: [[0, east ? 127 : -127, y > 55 ? -35 : y < -55 ? 35 : Math.round(Math.sin(now / 3100 + index) * 35)]], r: c.r, g: c.rawTick }, now);
      if (c.measuring) c.inputs += 1;
      pending.set(k, now); c.lastSent = k;
      for (const [tick, at] of pending) { if (now - at <= 5000) break; pending.delete(tick); }
    },
    close(code, reason) { c.closed = [code, String(reason ?? '')]; },
    facts() {
      const span = c.lastAt > c.firstAt ? c.lastAt - c.firstAt : 0;
      return { i: index, seat: c.seat, firstStateMs: c.first, welcomeMs: c.welcomed, closed: c.closed, lead: c.lead, frames: c.frames, maxStateGapMs: c.maxGap,
        tickHz: span ? (c.lastTick - c.firstTick) * 1000 / span : null, deliveredHz: span ? (c.frames - 1) * 1000 / span : null,
        downBytes: c.down, upBytes: c.up, inputs: c.inputs, reports: c.reports, late: c.late, undecodable: c.undecodable, ownMissing: c.ownMissing, errors: c.errors.slice(0, 8), fresh: c.at ? true : false };
    },
  };
}
