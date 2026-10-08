/**
 * What the rules tests share (not a test file itself): a game's rules loaded the way the build loads them (checked,
 * guarded, linked, then imported with the runtime as one instance), small games written on the spot, a clock a test
 * moves, and a relay with a host runtime wired as the Table wires them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardRules, problemLine } from '../lib/rules-guard.mjs';
import { loadRules } from '../lib/rules-build.mjs';
import { NetRoom } from '../worker/room.mjs';

export const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_NM = join(PKG, '..', '..', 'node_modules');
let esbuildP = null;
export const esbuildOf = () => (esbuildP ??= import(join(REPO_NM, 'esbuild', 'lib', 'main.js')).then((m) => m.default));

/** A game folder's rules, through the wall, as the runtime loads them: { def, R, H, C, W, P, M, code }. Throws with the refused lines. */
export async function loadGame(scratch, dir, id = 'game') {
  const esbuild = await esbuildOf();
  const g = await guardRules(esbuild, dirname(dir), dir);
  if (!g.ok) throw new Error(`refused:\n${g.problems.map(problemLine).join('\n')}`);
  return { ...(await loadRules(esbuild, scratch, id, g.code)), code: g.code };
}

/** A game written on the spot: `rules` (and `move`) are the text of its files. Returns its folder. */
export function writeGame(scratch, name, { rules, move = null }) {
  const dir = join(scratch, name);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'rules.ts'), rules);
  if (move) writeFileSync(join(dir, 'src', 'move.ts'), move);
  return dir;
}

export const COIN_DASH = join(PKG, 'starters', 'coin-dash');
export const COIN_MAP = { bounds: { min: [-12, -7], max: [12, 7] }, boxes: [{ min: [-1, -0.5], max: [1, 0.5] }], spots: { start: [[-10, 5], [10, -5], [-10, -5], [10, 5]], coins: [[-8, 2.5], [8, -2.5], [0, 2.5], [0, -2.5], [-3, 4.5], [3, -4.5]] } };

/** A clock a test moves. Timers run in order as it advances. */
export function fakeClock(start = 1_000_000) {
  const c = {
    t: start, timers: [], seq: 0,
    now: () => c.t,
    setTimer(fn, ms) { c.seq += 1; c.timers.push({ id: c.seq, at: c.t + Math.max(0, ms), fn }); return c.seq; },
    clearTimer(id) { c.timers = c.timers.filter((x) => x.id !== id); },
    /** Move the clock on `ms`, running every timer that comes due on the way. */
    advance(ms) {
      const until = c.t + ms;
      for (;;) {
        const next = c.timers.filter((x) => x.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!next) break;
        c.timers = c.timers.filter((x) => x !== next);
        c.t = Math.max(c.t, next.at);
        next.fn();
      }
      c.t = until;
    },
  };
  return c;
}

/** A host runtime by itself: every frame it sends is kept, newest snapshot first to hand. */
export function hostRig(L, compiled, opts = {}) {
  const clock = opts.clock ?? fakeClock();
  const sent = [];
  const ended = [];
  const lines = [];
  let n = 0;
  const host = L.H.createHost({ game: 'test', compiled, clock, send: (m) => sent.push(m), log: (l) => lines.push(l), random: () => { n += 1; return ((n * 7919) % 1000) / 1000; }, onEnd: (why, facts) => ended.push({ why, ...facts }), ...opts.host });
  const snap = () => sent.filter((m) => m.t === 'snap').at(-1) ?? null;
  return {
    host, clock, sent, ended, lines, snap,
    /** The newest snapshot's entities of a kind (by index in the rules), as { id, r, pos, fields, motion, seat, driver, away }. */
    ents(kind = null) {
      return (snap()?.d?.[1] ?? []).filter((w) => kind === null || w[1] === kind).map((w) => ({ id: w[0], kind: w[1], r: w[2], pos: { x: w[3][0], y: w[3][1] }, fields: w[7], motion: w[8], seat: w[9], driver: w[10] === undefined ? undefined : ['person', 'bot', 'ai'][w[10]], away: w[11] === 1 }));
    },
    row(seat) { return (snap()?.c ?? []).find((r) => r[0] === seat) ?? null; },
    join(seat, name = `P${seat}`, extra = {}) { host.frame({ t: 'join', peer: { id: `c${seat}`, seat, name, occ: seat + 1, ...extra } }); },
    /** Run `count` ticks, the clock moving one period before each. */
    ticks(count = 1) { for (let i = 0; i < count; i += 1) { clock.t += 1000 / compiled.settings.tickHz; host.tickNow(); } },
  };
}

/** A relay and a host runtime, wired as the Table wires them, on a clock the test moves. `conn()` is one socket. */
export function roomRig(L, compiled, { maxPlayers = 8, roomOpts = {} } = {}) {
  const clock = fakeClock();
  const lines = [];
  const events = [];
  const room = new NetRoom({ code: 'r', maxPlayers, now: clock.now, log: (l) => lines.push(l), ...roomOpts });
  let host = null;
  const start = () => {
    host = L.H.createHost({ game: 'test', compiled, clock, send: (m, text) => room.hostFrame(m, text), log: (l) => lines.push(l), random: () => 0.25, onPause: () => events.push('pause'), onResume: () => events.push('resume'), onEnd: (why) => events.push(`end:${why}`) });
    room.setServerHost(host);
    return host;
  };
  room.onForget = () => { host?.stop(); events.push('forgotten'); };
  start();
  const conns = new Set();
  const conn = (word = {}) => {
    const c = { sent: [], closed: null, ...word, send(x) { c.sent.push(JSON.parse(x)); }, close(code, why) { c.closed = [code, why]; }, buffered: () => 0 };
    const h = room.attach(c);
    c.say = (m) => h.onMessage(JSON.stringify(m));
    c.hello = (name, extra = {}) => { c.say({ t: 'hello', v: 1, rev: 10, name, device: 'desk', want: 'play', canHost: true, ...extra }); return c.sent.find((m) => m.t === 'welcome') ?? c.sent.find((m) => m.t === 'error') ?? null; };
    c.drop = () => { conns.delete(c); h.onClose('close'); };
    c.of = (t) => c.sent.filter((m) => m.t === t);
    conns.add(c);
    return c;
  };
  return {
    room, clock, lines, events, conn, start,
    get host() { return host; },
    /** Time passes: the room's clock, the relay's 250 ms beat, and every open socket's ping (a silent socket is closed after 10 s). */
    run(ms) {
      for (let left = ms; left > 0; left -= 50) {
        clock.advance(Math.min(50, left));
        if (Math.round(clock.t) % 2000 === 0) for (const c of conns) if (!c.closed) c.say({ t: 'ping', c: clock.t });
        if (Math.round(clock.t) % 250 === 0) room.tick();
      }
    },
  };
}
