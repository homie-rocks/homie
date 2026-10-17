/**
 * What measure.mjs (local workerd) and cloudflare.mjs (a real deploy) share: the room Worker, built from a studio
 * that holds the Gem Rush starter and from one toolkit checkout, and the scripted phone.
 *
 * The phone says on the wire exactly what the toolkit's client says: hello, a held-input keepalive every 250 ms
 * while the room plays (none while it rests, none from a hidden page), and a ping every two seconds: the clock
 * ping, or the edge-answered `homie-ping` while the room is between rounds or resting.
 */
import { build } from 'esbuild';
import { join } from 'node:path';

/** The room Worker. `instrument`: count constructions and the time any timer was pending (local runs only). */
export async function roomWorker({ studio, toolkit, instrument = false }) {
  const worker = join(toolkit, 'packages/studio/worker/index.mjs');
  const entry = `
import {Table as BaseTable, Lobby, hostRules} from '${worker}';
import rules from '${join(studio, 'site/src/rules/index.mjs')}';
hostRules(rules);
export {Lobby};
const stats = { constructed: 0, events: 0, timerFires: 0, heldMs: 0, heldSince: null, pending: new Set() };
${instrument ? `
const st = globalThis.setTimeout, si = globalThis.setInterval, ct = globalThis.clearTimeout, ci = globalThis.clearInterval;
const add = (h) => { if (!stats.pending.size) stats.heldSince = Date.now(); stats.pending.add(h); };
const del = (h) => { if (stats.pending.delete(h) && !stats.pending.size) { stats.heldMs += Date.now() - stats.heldSince; stats.heldSince = null; } };
globalThis.setTimeout = (fn, ms, ...a) => { const h = st(() => { del(h); stats.timerFires++; fn(...a); }, ms); add(h); return h; };
globalThis.setInterval = (fn, ms, ...a) => { const h = si(() => { stats.timerFires++; fn(...a); }, ms); add(h); return h; };
globalThis.clearTimeout = (h) => { del(h); ct(h); };
globalThis.clearInterval = (h) => { del(h); ci(h); };` : ''}
const games = { games: [{ id: 'gem-rush', name: 'Gem Rush', players: { min: 1, max: 8 }, room: { host: 'server', contract: 2, tickHz: 20 } }] };
const assets = { fetch: async (r) => new URL(r.url).pathname === '/games.json' ? Response.json(games) : new Response('', { status: 404 }) };
export class Table extends BaseTable {
  constructor(ctx, env) { stats.constructed++; super(ctx, { ...env, ASSETS: assets, HOMIE_ROOM_LOG: '0' }); }
  async fetch(r) { stats.events++; return super.fetch(r); }
  async webSocketMessage(...a) { stats.events++; return super.webSocketMessage(...a); }
  async webSocketClose(...a) { stats.events++; return super.webSocketClose(...a); }
  async alarm() { stats.events++; return super.alarm(); }
}
export default { fetch(request, env) {
  const u = new URL(request.url);
  if (u.pathname === '/stats') return Response.json({ constructed: stats.constructed, events: stats.events, timerFires: stats.timerFires, pending: stats.pending.size, heldMs: stats.heldMs + (stats.heldSince === null ? 0 : Date.now() - stats.heldSince) });
  if (u.pathname !== '/__net') return new Response('rooms', { status: 200 });
  const room = (u.searchParams.get('room') ?? 'one').replace(/[^a-z0-9-]/g, '');
  const build = rules['gem-rush'].build;
  // What the studio's Worker sends a room for a socket of this game (worker/routes.mjs).
  const target = 'https://table/__net?relay=1&game=gem-rush&room=' + room + '&max=8&rules=1&hz=20&host=server&cur=' + build + '&gv=' + build + '&b=' + (u.searchParams.get('b') ?? '');
  return env.TABLE.get(env.TABLE.idFromName('gem-rush/' + room)).fetch(new Request(target, request));
} };
`;
  const out = await build({ stdin: { contents: entry, resolveDir: join(toolkit, 'packages/studio/worker') }, bundle: true, write: false, format: 'esm', platform: 'browser', mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], nodePaths: [join(toolkit, 'packages/studio/node_modules'), join(toolkit, 'node_modules')], logLevel: 'error' });
  return out.outputFiles[0].text;
}

/**
 * One phone. `open()` resolves an open socket (addEventListener, send, close). `mode`: 'idle' (page open, nobody
 * touching it), 'hidden' (page in the background) or 'play' (steering all the time).
 */
export function phone(open, i, mode) {
  const p = { i, mode, ws: null, seat: null, token: null, idlePing: false, resting: false, phase: null, e: 0, k: 0, kAt: 0, r: 0, seq: 0, snaps: 0, sent: 0, edge: 0, timers: [] };
  p.connect = async () => {
    const ws = await open(i); p.ws = ws; p.resting = false;
    const welcomed = new Promise((resolve, reject) => {
      ws.addEventListener('message', (ev) => {
        if (ev.data === 'homie-pong') return;
        const m = JSON.parse(ev.data);
        if (m.t === 'welcome') { p.seat = m.seat; p.token = m.token; p.idlePing = m.idlePing === true; resolve(); }
        else if (m.t === 'error') reject(new Error(JSON.stringify(m)));
        else if (m.t === 'snap') { p.snaps++; if (Number.isFinite(m.e)) p.e = m.e; p.k = m.k; p.kAt = Date.now(); const row = m.c?.find((x) => x[0] === p.seat); if (row) p.r = row[1]; }
        else if (m.t === 'round') p.phase = m.round?.phase ?? p.phase;
        else if (m.t === 'rest') p.resting = m.on === true;
        else if (m.t === 'probe') { ws.send(JSON.stringify({ t: 'probeAck', n: m.n })); p.sent++; }
      });
      ws.addEventListener('close', () => reject(new Error('closed before welcome')));
    });
    ws.send(JSON.stringify({ t: 'hello', v: 1, rev: 12, rules: true, coast: 1, rest: 1, token: p.token, name: `Phone ${i}`, device: 'phone', want: 'play', canHost: false, game: 'gem-rush', max: 8 }));
    await welcomed;
  };
  p.start = () => {
    p.timers.push(setInterval(() => {
      if (!p.ws || p.mode === 'hidden' || (p.mode === 'idle' && p.resting)) return;
      const t = (Date.now() / 50) | 0;
      const ax = p.mode === 'play' ? Math.round(100 * Math.sin(t / 7)) : 0, ay = p.mode === 'play' ? Math.round(100 * Math.cos(t / 5)) : 0;
      // Stamped as the view stamps it: the tick it reckons the room is on now, a little ahead.
      const k = p.k + Math.floor((Date.now() - p.kAt) / 50) + 2;
      try { p.ws.send(JSON.stringify({ t: 'in', e: p.e, k, s: [[0, ax, ay, 0, -471, ++p.seq, 0]], r: p.r })); p.sent++; } catch { /* reconnecting */ }
    }, 250));
    p.timers.push(setInterval(() => {
      if (!p.ws) return;
      try {
        if (p.idlePing && (p.resting || p.phase !== 'live')) { p.ws.send('homie-ping'); p.edge++; }
        else { p.ws.send(JSON.stringify({ t: 'ping', c: Date.now(), hid: p.mode === 'hidden' })); p.sent++; }
      } catch { /* reconnecting */ }
    }, 2000));
  };
  p.stop = () => { for (const t of p.timers) clearInterval(t); p.timers = []; try { p.ws?.close(1000, 'done'); } catch { /* gone */ } };
  return p;
}

export const SCENARIOS = [
  { room: 'idle-1', name: 'one phone, page open, nobody touching it', phones: 1, mode: 'idle' },
  { room: 'idle-4', name: 'four phones, pages open, nobody touching them', phones: 4, mode: 'idle' },
  { room: 'hidden-1', name: 'one phone, page in the background', phones: 1, mode: 'hidden' },
  { room: 'play-1', name: 'one phone playing the whole time', phones: 1, mode: 'play' },
];

/** After the idle stretch: phone 0 drops its socket and comes back with its token, then everyone plays. */
export async function wake(phones, ms = 20_000) {
  const sleep = (t) => new Promise((r) => setTimeout(r, t));
  const p0 = phones[0], seatBefore = p0.seat;
  p0.ws.close(4000, 'phone slept'); p0.ws = null;
  await sleep(500);
  await p0.connect();
  for (const p of phones) p.mode = 'play';
  const at = Date.now(), snaps = phones.map((p) => p.snaps);
  let firstSnapshotMs = null;
  while (Date.now() - at < ms) { await sleep(50); if (firstSnapshotMs === null && phones.every((p, i) => p.snaps > snaps[i])) firstSnapshotMs = Date.now() - at; }
  return {
    seatKept: p0.seat === seatBefore,
    firstSnapshotMs,
    snapshotsPerPhonePerSecond: Math.round(100 * phones.reduce((a, p, i) => a + p.snaps - snaps[i], 0) / phones.length / ((Date.now() - at) / 1000)) / 100,
    resting: phones.some((p) => p.resting),
  };
}
