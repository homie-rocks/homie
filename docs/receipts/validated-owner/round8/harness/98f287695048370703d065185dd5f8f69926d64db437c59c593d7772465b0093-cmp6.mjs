/**
 * Tiny Platformer Party, measured in real Chrome on one build: run it against the server-rules build and against a
 * control copy of main, and lay the two JSON files side by side (reviews/server-rules/tiny-platformer.md).
 *
 *   node scripts/compare-platformer.mjs --base http://127.0.0.1:8796 --tag rules [--only controls,lag150,...]
 *   node scripts/compare-platformer.mjs --base http://127.0.0.1:8797 --tag main --cwd /tmp/arcade-main-control
 *
 * Sections: controls, lag0, lag150, lag300, pause, reload, restart, rounds; and feel, feel150 (many presses from
 * standing still: key to first drawn movement, distances, jump height and air time).
 * Loss rows: jitter, loss40, loss60, loss80, loss150; lag300 includes 5% loss. --skip-presses separates the
 * network trace from feel trials. hangPress checks the first 150 ms press after a ten-second hang;
 * --hang-valid 3 repeats on the same room, retaining rejected catches and every accepted outcome.
 *
 * THE PLAYER UNDER TEST is always the second browser in: on the browser-host build the first is the host (it judges
 * its own body with no delay), so the second is what every other player gets. `--host` measures the first instead.
 * It is driven by an autopilot here (real key events, twenty decisions a second): run at the nearest gold, jump at
 * walls and onto monsters, which is how a person plays it.
 */
import { pairBarrier } from './barrier.mjs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, openSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openPlayer, attach, shell, probe, instrument, sleep } from './browser.mjs';
import { loadModule } from '/Users/ryan/Studios/homie-arcade-rules/tests/lib/rules.mjs';

const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? true : fallback; };
const base = arg('base'), tag = arg('tag'), cwd = arg('cwd', process.cwd());
const port = Number(new URL(base).port);
const out = arg('out', 'reviews/server-rules/data/tiny-platformer');
const only = String(arg('only') ?? 'controls,lag0,lag150,lag300,pause,reload,restart,rounds').split(',');
const asHost = process.argv.includes('--host');
const GAME = 'tiny-platformer';
mkdirSync(join(out, 'shots'), { recursive: true });
const file = join(out, `${tag}.json`);
const receipt = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const save = () => writeFileSync(file, `${JSON.stringify({ ...receipt, tag, base, at: new Date().toISOString() }, null, 2)}\n`);
const stats = (a) => { const v = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); const q = (p) => v.length ? Math.round(v[Math.min(v.length - 1, Math.floor(p * v.length))] * 10) / 10 : null; return { n: v.length, min: q(0), median: q(0.5), p90: q(0.9), max: v.length ? Math.round(v[v.length - 1] * 10) / 10 : null }; };
const LEVEL = await loadModule('games/tiny-platformer/src/level.ts');
const solid = (tx, ty) => { const i = tx + ty * LEVEL.TW; return i >= 0 && i < LEVEL.TILES.length && LEVEL.TILES[i] !== 0; };
const overlap = (x1, y1, x2, y2) => !((x1 + 31 / 32) < x2 || (x2 + 31 / 32) < x1 || (y1 + 31 / 32) < y2 || (y2 + 31 / 32) < y1);

/** In the game's frame: one way to read either build, in tiles, and a log of every drawn frame. */
function helpers(gold) {
  const info = () => window.__homiePort.info();
  const room = window.__room, opts = window.__roomOpts;
  const T = 32;
  window.__me = () => { if (room) { const b = opts.local(); return b && room.mySeat() !== null ? { x: b.x / T, y: b.y / T } : null; } return info().extra.corner ?? null; };
  window.__others = () => room ? room.view().filter((b) => b.bot || b.seat !== room.mySeat()).map((b) => ({ slot: b.slot, bot: b.bot, name: b.name, x: b.x / T, y: b.y / T, score: b.score })) : info().extra.others;
  window.__runners = () => room ? room.view().map((b) => ({ slot: b.slot, bot: b.bot, name: b.name, score: b.score, mine: !b.bot && b.seat === room.mySeat() })) : info().extra.runners.map((b) => ({ slot: b.slot, bot: b.bot, name: b.name, score: b.score, mine: !b.bot && b.seat === info().seat }));
  /** The monsters and gold on screen, including the live replica interpolation. */
  window.__mons = () => {
    if (!room) return info().extra.monsters;
    // platformer.js: drawnMonsters() uses the same sampled pair as room.view().
    // room.fast() alone is the newest snapshot, not what a replica draws.
    const sample = room.hosting ? null : room.net.sample();
    const b = sample?.b.d.w ?? room.fast(), a = sample?.a.d.w ?? b;
    const alpha = sample?.alpha ?? 1, o = [];
    if (b) for (let n = 0; 1 + n * 3 + 2 < b.length; n++) {
      const i = 1 + n * 3;
      if (b[i+2]) o.push({i:n,x:(a[i+2]?a[i]+(b[i]-a[i])*alpha:b[i])/T,y:(a[i+2]?a[i+1]+(b[i+1]-a[i+1])*alpha:b[i+1])/T});
    }
    return o;
  };
  window.__goldMask = () => { if (room) { const w = room.fast(); return w ? w[0] : 0; } return info().extra.goldMask; };
  /** The score the HUD shows for me (the same HUD in both builds). */
  window.__myScore = () => { const el = document.querySelector('.hp-board .me'); const m = el && /(\d+)\s*$/.exec(el.textContent); return m ? Number(m[1]) : null; };
  window.__phase = () => { const r = info().round; return r ? { n: r.n, phase: r.phase, leftMs: r.leftMs } : null; };
  window.__results = () => (room ? room.round?.results ?? null : info().extra.results);
  window.__sceneClock = () => { const x=info().extra; return [x.tick ?? null,x.viewTick ?? null]; };
  window.__state = () => ({ me: window.__me(), mons: window.__mons(), gold: window.__goldMask(), score: window.__myScore(), phase: window.__phase() });
  // Every drawn frame: where I am, what is on screen, my score on the HUD.
  window.__frames = [];
  window.__keys = [];
  // pt5: what the canvas really painted for my runner (the white-outlined box), in tiles
  window.__paint = null; { const sr = CanvasRenderingContext2D.prototype.strokeRect; CanvasRenderingContext2D.prototype.strokeRect = function (x, y, w, h) { if (this.lineWidth === 2 && /^#fff/i.test(String(this.strokeStyle))) window.__paint = [(x - 1) / 32, (y - 1) / 32, performance.now()]; return sr.call(this, x, y, w, h); }; }
  const loop = () => {
    const me = window.__me();
    if (me) { const f = window.__frames; f.push([(window.__homieMeasureNow?.() ?? performance.now()), me.x, me.y, window.__myScore(), window.__goldMask(), window.__mons().map((m) => [m.i, m.x, m.y]), info().extra.draw ? { ...info().extra.draw, diedAt: info().extra.body?.diedAt, round: info().round?.n } : null, window.__paint, [info().extra.tick ?? null, info().extra.viewTick ?? null]]); if (f.length > 30000) f.splice(0, 5000); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.addEventListener('keydown', (e) => { if (!e.repeat) window.__keys.push([performance.now(), e.code, 1]); }, true);
  window.addEventListener('keyup', (e) => { window.__keys.push([performance.now(), e.code, 0]); }, true);
  window.__gold = gold;
}

function tracker() { const Base = window.WebSocket; window.__socks = []; window.WebSocket = class extends Base { constructor(...a) { if (window.__offline) { super('ws://127.0.0.1:9/offline'); } else super(...a); window.__socks.push(this); } }; }
async function open(chrome, room, o = {}) {
  const p = await openPlayer(chrome, { base, game: GAME, room, ...o, init: instrument, extraInit: tracker });
  if (o.seat !== false) await ready(p);
  return p;
}
async function ready(p) {
  await p.frame.waitForFunction(() => window.__homiePort?.info?.().round && (window.__room ? window.__room.mySeat() !== null && window.__roomOpts.local() : window.__homiePort.info().extra.corner), { timeout: 60_000 });
  await p.frame.evaluate(helpers, LEVEL.GOLD);
  await p.page.mouse.click(Math.round(p.viewport.width * 0.5), Math.round(p.viewport.height * 0.35)).catch(() => {});
}
const fr = (p, fn, a) => p.frame.evaluate(fn, a);
const newRoom = (what) => `cmp-${String(tag).slice(0, 10)}-${what.slice(0, 6)}-${Date.now().toString(36)}`;
async function liveWith(p, ms) { for (;;) { const r = await fr(p, () => window.__phase()); if (r?.phase === 'live' && r.leftMs > ms) return r; await sleep(250); } }
/** The pair: `first` joins first (the host on the browser-host build); `me` is the one measured. */
async function pair(chrome, what, lag = null, viewport = 'computer') {
  const room = newRoom(what);
  if (process.argv.includes('--solo')) { const me = await open(chrome, room, { lag, viewport }); return { me, other: me }; }   // one window: a quick look, not a measurement against main
  if (asHost) { const me = await open(chrome, room, { lag, viewport }); const other = await open(chrome, room); return { me, other }; }
  const other = await open(chrome, room); const me = await open(chrome, room, { lag, viewport });
  return { me, other };
}

/* ------------------------------------------------------------------ the autopilot: a person's way of playing, in real keys */
function pilot(p, seed = 1) {
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const held = { ArrowLeft: false, ArrowRight: false, Space: false };
  const set = async (code, down) => { if (held[code] === down) return; held[code] = down; if (down) await p.page.keyboard.down(code); else await p.page.keyboard.up(code); };
  const brain = { target: -1, chosen: -99, dir: 1, check: null, flee: 0 };
  return {
    async step(now) {
      const st = await fr(p, () => window.__state()).catch(() => null);
      if (!st?.me) return;
      const b = st.me, t = now / 1000;
      const golds = LEVEL.GOLD.map((g, i) => ({ ...g, i })).filter((g) => st.gold & (1 << g.i));
      if (brain.target < 0 || !(st.gold & (1 << brain.target)) || t - brain.chosen > 4) {
        let best = -1, bd = Infinity;
        for (const g of golds) { const d = Math.abs(g.x - b.x) + Math.max(0, b.y - g.y) * 2 + Math.max(0, g.y - b.y) * 0.5 + rnd() * 6.25; if (d < bd) { bd = d; best = g.i; } }
        brain.target = best; brain.chosen = t;
      }
      if (!brain.check || t - brain.check.t > 1.5) {
        if (brain.check && Math.abs(b.x - brain.check.x) + Math.abs(b.y - brain.check.y) < 1) { brain.flee = t + 1 + rnd(); brain.dir = rnd() < 0.5 ? -1 : 1; brain.target = -1; }
        brain.check = { t, x: b.x, y: b.y };
      }
      let dir = brain.dir, jump = false;
      const tx = Math.floor(b.x + 0.5), ty = Math.floor(b.y + 0.5), g = brain.target >= 0 ? LEVEL.GOLD[brain.target] : null;
      if (t >= brain.flee && g) { const dx = g.x - b.x; dir = Math.abs(dx) > 1 / 3 ? (dx > 0 ? 1 : -1) : 0; if (g.y < b.y - 1 && Math.abs(dx) < 4) jump = rnd() < 0.6; }
      if (dir && solid(tx + dir, ty)) jump = true;
      if (dir && !solid(tx + dir, ty + 1) && !solid(tx + dir, ty + 2) && rnd() < 0.3) jump = true;
      for (const m of st.mons) if (Math.abs(m.y - b.y) < 1 && (m.x - b.x) * (dir || 1) > 0 && Math.abs(m.x - b.x) < 3) jump = true;
      await set('ArrowLeft', dir < 0); await set('ArrowRight', dir > 0); await set('Space', jump);
    },
    async release() { for (const k of Object.keys(held)) await set(k, false); },
  };
}


/** pt6: a runner that walks into monsters from the side when one is on its row with a clear path; otherwise plays as the autopilot does. */
function kamiPilot(p) {
  const base = pilot(p, 17);
  const held = { ArrowLeft: false, ArrowRight: false, Space: false };
  const set = async (code, down) => { if (held[code] === down) return; held[code] = down; if (down) await p.page.keyboard.down(code); else await p.page.keyboard.up(code); };
  let hunting = false;
  return {
    async step(now) {
      const st = await fr(p, () => window.__state()).catch(() => null);
      if (!st?.me) return;
      const b = st.me, ty = Math.floor(b.y + 0.5);
      const clear = (m) => { const a = Math.floor(Math.min(m.x, b.x) + 0.5), z = Math.floor(Math.max(m.x, b.x) + 0.5); for (let x = a; x <= z; x++) if (solid(x, ty) || !solid(x, ty + 1)) return false; return true; };
      const m = st.mons.filter((m) => Math.abs(m.y - b.y) < 0.6 && Math.abs(m.x - b.x) < 14 && clear(m)).sort((m, n) => Math.abs(m.x - b.x) - Math.abs(n.x - b.x))[0];
      if (m) {
        if (!hunting) { hunting = true; await base.release(); }
        const dir = m.x > b.x ? 1 : -1;
        await set('Space', false); await set('ArrowLeft', dir < 0); await set('ArrowRight', dir > 0);
      } else {
        if (hunting) { hunting = false; for (const k of Object.keys(held)) await set(k, false); }
        await base.step(now);
      }
    },
    async release() { for (const k of Object.keys(held)) await set(k, false); await base.release(); },
  };
}

/** What a recorded session shows: pickups, stomps and catches as they looked on the player's own screen. */
function analyse(frames, keys, delay = 0) {
  // A catch comes back from whoever judged it a round trip after the touch was on screen.
  const WINDOW = 550 + 2 * delay;
  const res = { seconds: frames.length ? (frames[frames.length - 1][0] - frames[0][0]) / 1000 : 0, frames: frames.length };
  const goldGone = [], goldScore = [], stompGone = [];
  const odd = [];
  let catches = 0, ghostCatches = 0, screenStompCaught = 0, screenStompOk = 0, screenSideCaught = 0, snaps = 0, jerks = 0, backSteps = 0;
  const lastTouch = new Map(), goldPending = new Map(), stompPending = new Map();
  let lastMonsterTouch = -1e9, lastSide = -1e9, lastStompLook = -1e9;
  for (let k = 1; k < frames.length; k += 1) {
    const [t, x, y, score, gold, mons] = frames[k], [pt, px, py, pscore, pgold] = frames[k - 1];
    const dyv = y - py;
    // Gold: the first frame my box is on a piece the screen shows, until the screen stops showing it and the HUD counts it.
    for (let i = 0; i < 8; i += 1) {
      const g = LEVEL.GOLD[i], shownNow = Boolean(gold & (1 << i));
      if (shownNow && overlap(x, y, g.x, g.y) && !goldPending.has(i)) goldPending.set(i, { t, score: pscore, counted: false });
      const pend = goldPending.get(i);
      if (pend) {
        if (!pend.gone && !shownNow) { pend.gone = t; goldGone.push(t - pend.t); }
        if (!pend.counted && score !== null && pend.score !== null && score > pend.score) { pend.counted = true; goldScore.push(t - pend.t); }
        if ((pend.gone && pend.counted) || t - pend.t > 2500) goldPending.delete(i);
      }
    }
    // Monsters: how a touch looked (from above and falling, or from the side), and what came of it.
    for (const [i, mx, my] of mons) {
      if (!overlap(x, y, mx, my)) continue;
      lastMonsterTouch = t;
      if (!stompPending.has(i)) { const looksStomp = dyv > 0 && my - y > 0.5; stompPending.set(i, { t, looksStomp }); if (looksStomp) lastStompLook = t; else lastSide = t; }
    }
    for (const [i, pend] of stompPending) {
      const there = mons.some((m) => m[0] === i);
      if (!there) { if (pend.looksStomp) { screenStompOk += 1; stompGone.push(t - pend.t); } stompPending.delete(i); }
      else if (t - pend.t > 1500) stompPending.delete(i);
    }
    // A catch: I am suddenly somewhere else (a spawn point).
    const jump = Math.abs(x - px) + Math.abs(y - py);
    // A jerk: one drawn frame moved my runner further than the game can (0.25 of a tile sideways, 1 down, 0.42 up at 60 frames a second).
    if (jump <= 3 && t - pt < 25 && (Math.abs(x - px) > 0.45 || y - py > 1.3 || py - y > 0.7)) { jerks += 1; if (odd.length < 8) odd.push({ what: 'jerk', atS: Math.round((t - frames[0][0]) / 100) / 10, from: [Math.round(px * 100) / 100, Math.round(py * 100) / 100], to: [Math.round(x * 100) / 100, Math.round(y * 100) / 100] }); }
    if (jump <= 3 && t - pt < 25 && k > 1 && (x - px) * (px - frames[k - 2][1]) < -0.0004) backSteps += 1;
    if (jump > 3 && t - pt < 200) {
      const onSpawn = LEVEL.SPAWNS.some((sp) => Math.abs(sp[0] - x) < 1.2 && Math.abs(sp[1] - y) < 1.5);
      if (onSpawn) {
        catches += 1;
        if (t - lastMonsterTouch > WINDOW) ghostCatches += 1;
        else if (t - lastStompLook < WINDOW && t - lastSide > WINDOW) screenStompCaught += 1;
        else screenSideCaught += 1;
        stompPending.clear();
      } else { snaps += 1; if (odd.length < 8) odd.push({ what: 'jump', atS: Math.round((t - frames[0][0]) / 100) / 10, from: [Math.round(px * 100) / 100, Math.round(py * 100) / 100], to: [Math.round(x * 100) / 100, Math.round(y * 100) / 100], next: frames[k + 1] ? [Math.round(frames[k + 1][1] * 100) / 100, Math.round(frames[k + 1][2] * 100) / 100] : null }); }
    }
  }
  // Against a held direction after the original acceleration has had time to reverse inertia.
  let keyIndex = 0, left = false, right = false, direction = 0, directionAt = 0;
  let againstHeldKey = 0;
  const againstExamples = [];
  for (let i = 1; i < frames.length; i += 1) {
    const [t, x, y] = frames[i], [pt, px, py] = frames[i-1];
    while (keyIndex < keys.length && keys[keyIndex][0] <= pt) {
      const [kt, code, down] = keys[keyIndex++];
      if (code === 'ArrowLeft' || code === 'KeyA') left = Boolean(down);
      if (code === 'ArrowRight' || code === 'KeyD') right = Boolean(down);
      const next = Number(right) - Number(left);
      if (next !== direction) { direction = next; directionAt = kt; }
    }
    if (direction && pt - directionAt > 550 && t - pt < 25 && (x-px)*direction < -0.01 && Math.abs(x-px)+Math.abs(y-py) <= 3) {
      againstHeldKey++;
      if (againstExamples.length < 12) againstExamples.push({ atS: (t-frames[0][0])/1000, dx: x-px, dy: y-py, direction });
    }
  }
  res.againstHeldKey = againstHeldKey; res.againstExamples = againstExamples;
  // Keys: from the key going down to the first drawn frame in which my runner has moved the right way.
  const runMs = [], jumpMs = [];
  for (const [t, code, down] of keys) {
    if (!down) continue;
    const i = frames.findIndex((f) => f[0] >= t); if (i < 3 || i + 20 >= frames.length) continue;
    const before = frames[i - 1], still = Math.abs(frames[i - 1][1] - frames[i - 3][1]) < 1e-6 && Math.abs(frames[i - 1][2] - frames[i - 3][2]) < 1e-6;
    if (!still) continue;                                   // only from standing on the ground
    const tx = Math.floor(before[1] + 0.5), ty = Math.floor(before[2] + 0.5);
    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      const d = code === 'ArrowLeft' ? -1 : 1;
      if (solid(tx + d, ty)) continue;
      const j = frames.slice(i, i + 20).find((f) => (f[1] - before[1]) * d > 1e-4);
      if (j) runMs.push(j[0] - t);
    } else if (code === 'Space') {
      if (solid(tx, ty - 1)) continue;
      const j = frames.slice(i, i + 20).find((f) => before[2] - f[2] > 1e-4);
      if (j) jumpMs.push(j[0] - t);
    }
  }
  Object.assign(res, {
    runFeedbackMs: stats(runMs), jumpFeedbackMs: stats(jumpMs),
    goldVanishesMs: stats(goldGone), goldOnHudMs: stats(goldScore), stompedMonsterVanishesMs: stats(stompGone),
    catches, catchesWithNoMonsterOnScreen: ghostCatches, landedOnItOnScreenButCaught: screenStompCaught, caughtFromTheSide: screenSideCaught, landedOnItAndStomped: screenStompOk,
    unexplainedJumpsOfMyRunner: snaps, drawnJerks: jerks, drawnBackSteps: backSteps, firstOddFrames: odd,
  });
  return res;
}

/** Does my runner answer its keys: right for 350 ms, then left for 500 ms; any drawn movement counts (a wall may stop one of them). */
async function answers(p) {
  const n0 = await fr(p, () => window.__frames.length).catch(() => 0);
  await p.page.keyboard.down('ArrowRight'); await sleep(350); await p.page.keyboard.up('ArrowRight'); await p.page.keyboard.down('ArrowLeft'); await sleep(500); await p.page.keyboard.up('ArrowLeft');
  const f = await fr(p, (n) => window.__frames.slice(n).map((r) => r[1]), n0).catch(() => []);
  return f.length > 1 && Math.max(...f) - Math.min(...f) > 0.05;
}
async function settle(p) { for (let i = 0; i < 80; i += 1) { const a = await fr(p, () => window.__me()); await sleep(60); const b = await fr(p, () => window.__me()); if (a && b && a.x === b.x && a.y === b.y) return b; } return fr(p, () => window.__me());
}
/** One measured press from standing still on clear ground: what it did and how soon the screen showed it. */
async function trial(p, code, kind, holdMs) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const a = await settle(p); if (!a) continue;
      const tx = Math.floor(a.x + 0.5), ty = Math.floor(a.y + 0.5), d = kind === 'left' ? -1 : 1;
      // A place where the move can be seen: floor and no wall for four tiles ahead, or headroom for the whole jump.
      const clear = kind === 'jump' ? [1, 2, 3, 4, 5, 6].every((k) => !solid(tx, ty - k)) && a.x === tx : [1, 2, 3, 4].every((k) => !solid(tx + d * k, ty) && solid(tx + d * k, ty + 1));
      if (!clear) { const away = ['ArrowLeft', 'ArrowRight'][Math.floor(Math.random() * 2)]; await p.page.keyboard.down(away); await sleep(250 + Math.random() * 500); await p.page.keyboard.up(away); if (Math.random() < 0.4) { await p.page.keyboard.down('Space'); await sleep(60); await p.page.keyboard.up('Space'); } continue; }
      const n0 = await fr(p, () => window.__frames.length);
      await p.page.keyboard.down(code); await sleep(holdMs); await p.page.keyboard.up(code);
      await sleep(kind === 'jump' ? 1100 : 500);
      const f = await fr(p, (n) => ({ frames: window.__frames.slice(n), keys: window.__keys.slice(-2) }), n0);
      if (f.frames.some((r, i) => i > 0 && Math.abs(r[1] - f.frames[i - 1][1]) + Math.abs(r[2] - f.frames[i - 1][2]) > 3)) continue;   // caught by a monster mid-trial: again
      const t0 = f.keys.find((k) => k[2] === 1)?.[0] ?? f.frames[0][0];
      const moved = kind === 'jump' ? f.frames.find((r) => a.y - r[2] > 1e-4) : f.frames.find((r) => (r[1] - a.x) * d > 1e-4);
      const end = f.frames[f.frames.length - 1];
      return { code, kind, feedbackMs: moved ? Math.round((moved[0] - t0) * 10) / 10 : null, ...(kind === 'jump' ? { heightTiles: Math.round((a.y - Math.min(...f.frames.map((r) => r[2]))) * 1000) / 1000, airSeconds: Math.round(f.frames.filter((r) => a.y - r[2] > 0.03).length / 60 * 100) / 100 } : { distanceTiles: Math.round((end[1] - a.x) * d * 1000) / 1000 }) };
    }
    return { code, kind, failed: 'no clear ground found for the trial' };
  }

/* ------------------------------------------------------------------ every control */
async function controls(chrome) {
  const res = { keys: [], touch: [], tv: null };
  const { me: p, other } = await pair(chrome, 'keys');
  await liveWith(p, 60_000);
  for (const [code, kind] of [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['KeyA', 'left'], ['KeyD', 'right'], ['Space', 'jump'], ['ArrowUp', 'jump'], ['KeyW', 'jump']]) {
    res.keys.push(await trial(p, code, kind, kind === 'jump' ? 60 : 200));
  }
  // A short tap: 30 ms of a run key.
  res.taps = []; for (const [code, kind] of [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowRight', 'right'], ['ArrowLeft', 'left']]) res.taps.push(await trial(p, code, kind, 30));
  await p.page.screenshot({ path: join(out, 'shots', `${tag}-computer.png`) });
  res.errors = [...p.errors, ...other.errors];
  await p.ctx.close();

  // A phone: the stick under the left thumb, the JUMP button, and a tap anywhere else.
  const ph = await open(chrome, (await shell(other)).room, { viewport: 'phone' });
  await liveWith(ph, 20_000);
  const t = ph.page.touchscreen;
  // The stick: where the thumb lands, dragged a thumb's width. What it does is read from the drawn frames while it is held: the fastest the runner went, and which way.
  const drag = async (dx) => { await sleep(500); const n0 = await fr(ph, () => window.__frames.length); await t.touchStart(100, 600); for (let i = 1; i <= 5; i += 1) { await sleep(20); await t.touchMove(100 + dx * i / 5, 600); } await sleep(700); await t.touchEnd(); const f = await fr(ph, (n) => window.__frames.slice(n), n0); let best = 0; for (let i = 1; i < f.length; i += 1) { const v = (f[i][1] - f[i - 1][1]) / ((f[i][0] - f[i - 1][0]) / 1000); if (Math.abs(v) < 16 && Math.abs(v) > Math.abs(best)) best = v; } return Math.round(best * 10) / 10; };
  const hop = async (x, y) => { await sleep(700); const n0 = await fr(ph, () => window.__frames.length); await t.touchStart(x, y); await sleep(50); await t.touchEnd(); await sleep(900); const f = await fr(ph, (n) => window.__frames.slice(n), n0); if (!f.length) return null; const y0 = f[0][2]; const caught = f.some((r, i) => i > 0 && Math.abs(r[1] - f[i - 1][1]) + Math.abs(r[2] - f[i - 1][2]) > 3); return { rose: Math.round((y0 - Math.min(...f.map((r) => r[2]))) * 100) / 100, caught }; };
  for (let i = 0; i < 3; i += 1) { res.touch.push({ what: 'stick right', topSpeedTilesPerSecond: await drag(70) }); res.touch.push({ what: 'stick left', topSpeedTilesPerSecond: await drag(-70) }); }
  const button = await ph.frame.evaluate(() => { const b = [...document.querySelectorAll('*')].find((el) => el.textContent === 'JUMP' && el.children.length === 0); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  res.jumpButton = button;
  for (let i = 0; i < 3; i += 1) { if (button) res.touch.push({ what: 'JUMP button', roseTiles: await hop(button.x, button.y) }); res.touch.push({ what: 'tap on the right side', roseTiles: await hop(300, 420) }); }
  await ph.page.screenshot({ path: join(out, 'shots', `${tag}-phone.png`) });
  const tv = await openPlayer(chrome, { base, game: GAME, room: (await shell(other)).room, path: 'tv', viewport: 'tv', seat: false, init: instrument });
  await sleep(2500);
  const s = await shell(tv);
  res.tv = { seat: s.seat, role: s.role, runners: await tv.frame.evaluate(() => (window.__room ? window.__room.view().length : window.__homiePort.info().extra.runners.length)).catch(() => null), errors: tv.errors };
  await tv.page.screenshot({ path: join(out, 'shots', `${tag}-tv.png`) });
  res.errors.push(...ph.errors);
  await tv.ctx.close(); await ph.ctx.close(); await other.ctx.close();
  return res;
}

/* ------------------------------------------------------------------ the feel, with enough presses to compare: no lag, or `--feel-lag 150` */
async function feel(chrome, delay = 0) {
  const { me, other } = await pair(chrome, `feel${delay}`, delay ? { delay, loss: 0 } : null);
  await liveWith(me, 100_000);
  const runs = [], jumps = [], taps30 = [], taps80 = [], taps120 = [];
  for (let i = 0; i < 24; i += 1) runs.push(await trial(me, i % 2 ? 'ArrowLeft' : 'ArrowRight', i % 2 ? 'left' : 'right', 150));
  for (let i = 0; i < 12; i += 1) jumps.push(await trial(me, 'Space', 'jump', 60));
  for (let i = 0; i < 8; i += 1) taps30.push(await trial(me, i % 2 ? 'ArrowLeft' : 'ArrowRight', i % 2 ? 'left' : 'right', 30));
  for (let i = 0; i < 8; i += 1) taps80.push(await trial(me, i % 2 ? 'ArrowLeft' : 'ArrowRight', i % 2 ? 'left' : 'right', 80));
  for (let i = 0; i < 8; i += 1) taps120.push(await trial(me, i % 2 ? 'ArrowLeft' : 'ArrowRight', i % 2 ? 'left' : 'right', 120));
  const ok = (a) => a.filter((x) => !x.failed);
  const res = { delayMs: delay,
    runKeyFeedbackMs: stats(ok(runs).map((x) => x.feedbackMs)), jumpKeyFeedbackMs: stats(ok(jumps).map((x) => x.feedbackMs)),
    run150msTiles: stats(ok(runs).map((x) => x.distanceTiles * 1000)), jumpHeightTiles: stats(ok(jumps).map((x) => x.heightTiles * 1000)), jumpAirSeconds: stats(ok(jumps).map((x) => x.airSeconds * 1000)),
    tap30msTiles: ok(taps30).map((x) => x.distanceTiles), tap80msTiles: ok(taps80).map((x) => x.distanceTiles), tap120msTiles: ok(taps120).map((x) => x.distanceTiles),
    trialsThatFoundNoGround: [...runs, ...jumps, ...taps30, ...taps80, ...taps120].filter((x) => x.failed).length, errors: [...me.errors, ...other.errors] };
  await me.ctx.close(); if (other !== me) await other.ctx.close();
  return res;
}

/* ------------------------------------------------------------------ a lagged player on the autopilot */
async function lag(chrome, delay, loss, seconds = Number(arg('seconds', 100)), jitter = 0) {
  const { me, other } = await pair(chrome, `lag${delay}`, { delay, loss, jitter, lsHold: Number(arg('ls-hold', 0)), lsEvery: Number(arg('ls-every', 0)), drift: Number(arg('drift', 1)) });
  await liveWith(me, 60_000);
  const role = (await probe(me)).role;
  const cpu = Number(arg('cpu', 0)); if (cpu > 1) { const c = await me.page.createCDPSession(); await c.send('Emulation.setCPUThrottlingRate', { rate: cpu }); me.cdp = c; }
  // First, presses from standing still: how soon the player's own runner answers.
  const presses = [];
  for (const [code, kind] of (process.argv.includes('--skip-presses') ? [] : [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['Space', 'jump'], ['ArrowRight', 'right'], ['ArrowLeft', 'left'], ['Space', 'jump'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['Space', 'jump']])) presses.push(await trial(me, code, kind, kind === 'jump' ? 60 : 150));
  await liveWith(me, Math.min(seconds + 8, 100) * 1000);
  const ap = process.argv.includes('--kami') ? kamiPilot(me) : pilot(me, 11);
  const crowd = []; for (let i = 0; i < Number(arg('crowd', 0)); i += 1) crowd.push(await open(chrome, (await shell(other)).room, { lag: { delay: 40 + 40 * i, loss: 0.01, jitter: 20 } }));
  let crowdOn = crowd.length > 0; const crowdRun = Promise.all(crowd.map(async (c, i) => { const pl = pilot(c, 100 + i); while (crowdOn) { await pl.step(Date.now()).catch(() => {}); await sleep(60); } await pl.release().catch(() => {}); }));
  await fr(me, () => { window.__frames.length = 0; window.__keys.length = 0; });
  const mySeat = (await probe(me)).seat;
  const third = process.argv.includes('--obs3') ? await open(chrome, (await shell(other)).room) : null; const watcher = third ?? other;
  await fr(watcher, (seat) => { window.__seenMe = []; const loop = () => { const o = (window.__others() || []).find((r) => !r.bot && r.slot === seat); if (o) { window.__seenMe.push([performance.timeOrigin + (window.__homieMeasureNow?.() ?? performance.now()), o.x, o.y, (window.__mons() || []).map((m) => [m.i, Math.round(m.x * 100) / 100, Math.round(m.y * 100) / 100]), o.score, window.__sceneClock()]); if (window.__seenMe.length > 40000) window.__seenMe.splice(0, 5000); } requestAnimationFrame(loop); }; requestAnimationFrame(loop); }, mySeat);
  await pairBarrier('shape');
  await fr(me,()=>{window.__frames.length=0;}); await fr(watcher,()=>{window.__seenMe.length=0;});
  const t0 = Date.now();
  const events = []; const bgEvery = Number(arg('bg-every', 0)), bgMs = Number(arg('bg-ms', 0)), rcEvery = Number(arg('rc-every', 0)), rcMs = Number(arg('rc-ms', 0)); let nextBg = bgEvery * 1000, nextRc = rcEvery * 1000; const stallEvery = Number(arg('stall-every', 0)), stallMs = Number(arg('stall-ms', 0)), stallPids = String(arg('stall-pids', '')).split(',').filter(Boolean).map(Number); let nextStall = stallEvery * 1000;
  const hostStall = process.argv.includes('--stall-host') ? await other.page.createCDPSession() : null;
  while (Date.now() - t0 < seconds * 1000) {
    const el = Date.now() - t0;
    if (bgEvery && el > nextBg) { nextBg += bgEvery * 1000; await ap.release(); const how = arg('bg-how', 'tab'); const t = await fr(me, () => performance.now());
      if (how === 'freeze') { const c = me.cdp ?? await me.page.createCDPSession(); me.cdp = c; await c.send('Page.setWebLifecycleState', { state: 'frozen' }); await sleep(bgMs); await c.send('Page.setWebLifecycleState', { state: 'active' }); }
      else { const other = await me.ctx.newPage(); await other.goto('about:blank'); await other.bringToFront(); const vis = await me.page.evaluate(() => document.visibilityState); await sleep(bgMs); await me.page.bringToFront(); await other.close(); events.push({ vis }); }
      events.push({ what: 'bg', how, at: t, ms: bgMs, back: await fr(me, () => performance.now()) }); }
    if (stallEvery && el > nextStall) {
      nextStall += stallEvery * 1000;
      const t = await fr(me, () => performance.now());
      if (hostStall) await hostStall.send('Page.setWebLifecycleState', {state:'frozen'});
      for (const pid of stallPids) try { process.kill(pid, 'SIGSTOP'); } catch {}
      const resume = async () => {
        for (const pid of stallPids) try { process.kill(pid, 'SIGCONT'); } catch {}
        if (hostStall) await hostStall.send('Page.setWebLifecycleState', {state:'active'});
      };
      const resumeTimer = setTimeout(() => resume().catch(()=>{}), stallMs), tEnd = Date.now()+stallMs;
      try { while (Date.now()<tEnd) { await ap.step(Date.now()-t0); await sleep(45); } }
      finally { clearTimeout(resumeTimer); await resume(); }
      events.push({what:'stall',target:hostStall?'browser-authority':'worker-runtime',at:t,ms:stallMs,back:await fr(me,()=>performance.now())});
    }
    if (rcEvery && el > nextRc) { nextRc += rcEvery * 1000; const t = await fr(me, () => performance.now()); const s0 = await fr(me, () => window.__myScore());
      await Promise.all(me.page.frames().map((f) => f.evaluate(() => { window.__offline = true; for (const s of window.__socks ?? []) try { s.close(); } catch {} }).catch(() => {})));
      const tEnd = Date.now() + rcMs; while (Date.now() < tEnd) { await ap.step(Date.now() - t0); await sleep(45); }
      await Promise.all(me.page.frames().map((f) => f.evaluate(() => { window.__offline = false; }).catch(() => {})));
      let back = null; const d = Date.now() + 30000; while (Date.now() < d) { const pr = await probe(me); if (pr?.link === 'online' && pr.seat !== null) { back = Date.now() - tEnd; break; } await sleep(50); }
      events.push({ what: 'reconnect', at: t, ms: rcMs, backMsAfterNetwork: back, scoreBefore: s0, scoreAfter: await fr(me, () => window.__myScore()), reconnects: (await probe(me))?.reconnects, back: await fr(me, () => performance.now()) }); }
    await ap.step(Date.now() - t0); await sleep(45);
  }
  await ap.release(); crowdOn = false; await crowdRun;
  await sleep(600 + 2 * delay);
  const rec0 = await fr(me, () => ({ frames: window.__frames, keys: window.__keys, wire: window.__wire, score: window.__myScore(), told: window.__room ? null : window.__homiePort.info().extra.prediction, kit: window.__room ? null : window.__homieNet?.probe?.prediction?.() ?? null }));
  const seen = await fr(watcher, () => window.__seenMe ?? []).catch(() => []); if (third) await third.ctx.close(); const origin = await fr(me, () => performance.timeOrigin);
  const rec = { ...rec0, seen, origin, events, cpu, load: (await import('node:os')).loadavg().map((x) => +x.toFixed(1)) };
  writeFileSync(join(out, `${tag}-lag${delay}-loss${loss}-jitter${jitter}-frames.json.gz`), (await import('node:zlib')).gzipSync(JSON.stringify(rec)));
  const mine = (await fr(other, () => window.__runners())).find((r) => !r.bot && !r.mine);
  const feedback = (kind) => stats(presses.filter((x) => (kind === 'jump') === (x.kind === 'jump')).map((x) => x.feedbackMs));
  const an = analyse(rec.frames, rec.keys, delay); delete an.runFeedbackMs; delete an.jumpFeedbackMs;
  const res = { gpu: chrome.gpu, delayMs: delay, loss, jitterMs: jitter, role, wire: rec.wire, runKeyFeedbackMs: feedback('run'), jumpKeyFeedbackMs: feedback('jump'), jumpHeightTiles: stats(presses.filter((x) => x.kind === 'jump').map((x) => x.heightTiles)), jumpAirSeconds: stats(presses.filter((x) => x.kind === 'jump').map((x) => x.airSeconds * 100)).median / 100, pressesThatFoundNoGround: presses.filter((x) => x.failed).length,
    // Server rules only: my runner as first predicted against where the server then had it, tick by tick. (The browser host never corrected a player: it took each browser's word for where it was.)
    events, cpu, load: rec.load, prediction: rec.told ? { ticks: rec.told.ticks, wrongTicks: rec.told.wrong, placements: rec.told.placements, corrections: rec.told.corrections, correctionsOverHalfATile: rec.told.overHalfATile, worstTiles: Math.round(rec.told.worst * 100) / 100, last: rec.told.last, room: rec.kit ? { replaysThatMovedMe: rec.kit.count, largestTiles: Math.round(rec.kit.max * 100) / 100, catchUps: rec.kit.catches, snaps: rec.kit.snaps, clockResets: rec.kit.rebases, lateInputLeadTicks: Math.round(rec.kit.lead * 100) / 100 } : null } : null,
    scoreOnMyHud: rec.score, scoreOnTheOtherScreen: mine?.score ?? null, ...an, errors: [...me.errors, ...other.errors] };
  res.crowd = crowd.length ? { n: crowd.length, errors: crowd.flatMap((c) => c.errors), runners: await fr(me, () => window.__runners().length) } : undefined; for (const c of crowd) await c.ctx.close();
  await me.ctx.close(); if (other !== me) await other.ctx.close();
  return res;
}

async function hangPress(chrome) {
  const { me, other } = await pair(chrome, 'hang');
  const attempts = [];
  try {
    for(let repeat=0;repeat<8;repeat++) {
      await liveWith(me, 20000);
      let a, direction;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        a = await settle(me);
        const tx = Math.floor(a.x + 0.5), ty = Math.floor(a.y + 0.5);
        direction = [1, -1].find(d => [1, 2, 3, 4].every(k => !solid(tx+d*k, ty) && solid(tx+d*k, ty+1)));
        if (direction) break;
        await answers(me);
      }
      if (!direction) throw new Error('No clear ground for hang press');
      await fr(me, () => { const start = performance.now(); while (performance.now() - start < 10000) {} });
      const start = await fr(me, () => ({ me: window.__me(), n: window.__frames.length, kit: window.__homieNet?.probe?.prediction?.() ?? null }));
      const code = direction > 0 ? 'ArrowRight' : 'ArrowLeft';
      await me.page.keyboard.down(code); await sleep(150); await me.page.keyboard.up(code);
      await sleep(900);
      const rec = await fr(me, n => ({ frames: window.__frames.slice(n), keys: window.__keys.slice(-2) }), start.n);
      const end = rec.frames.at(-1);
      const unchanged = Math.abs(a.x-start.me.x)+Math.abs(a.y-start.me.y)<.01;
      const caughtDuringPress = rec.frames.some((f,i)=>Math.abs(f[1]-(i ? rec.frames[i-1][1] : start.me.x))+Math.abs(f[2]-(i ? rec.frames[i-1][2] : start.me.y))>3);
      const row = { beforeHang:a, start:start.me, distanceTiles:(end[1]-start.me.x)*direction, maxDistanceTiles:Math.max(...rec.frames.map(f=>(f[1]-start.me.x)*direction)), valid:unchanged&&!caughtDuringPress, beforePressKit:start.kit, afterPressKit:await fr(me,()=>window.__homieNet?.probe?.prediction?.() ?? null), probeAfter:await probe(me), errors:me.errors, ...rec };
      attempts.push(row);
      if(row.valid && attempts.filter(a=>a.valid).length>=Number(arg('hang-valid',1)))return { distanceTiles:row.distanceTiles, attempts };
    }
    return { failed:'Caught or moved during every hang trial', attempts };
  } finally { await me.ctx.close(); await other.ctx.close(); }
}

/* ------------------------------------------------------------------ one browser stops for ten seconds */
async function pause(chrome) {
  const res = {};
  for (const which of ['first', 'second']) {
    const room = newRoom(`pause-${which}`);
    const a = await open(chrome, room), b = await open(chrome, room);
    await liveWith(a, 60_000);
    const frozen = which === 'first' ? a : b, other = which === 'first' ? b : a;
    const role = (await probe(frozen)).role, otherRole = (await probe(other)).role;
    const ap = pilot(other, 5);
    // What the other player sees of the bots and monsters, as it changes.
    await fr(other, () => { window.__seen = []; let last = ''; const loop = () => { const k = JSON.stringify([window.__others().filter((o) => o.bot).map((o) => [Math.round(o.x * 4), Math.round(o.y * 4)]), window.__mons().map((m) => Math.round(m.x * 8))]); if (k !== last) { last = k; window.__seen.push(Date.now()); } requestAnimationFrame(loop); }; loop(); }).catch(() => {});
    await sleep(1500);
    const theHeld = () => fr(other, () => { const o = window.__others().find((x) => !x.bot); return o ? { x: Math.round(o.x * 100) / 100, y: Math.round(o.y * 100) / 100, score: o.score } : null; }).catch(() => null);
    const heldBefore = await theHeld();
    const t0 = Date.now();
    // Its page stops dead for ten seconds (the main thread is held: a hung tab, a phone that went to sleep with the socket open).
    const hang = frozen.frame.evaluate(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* held */ } }).catch(() => {});
    await fr(other, () => { window.__frames.length = 0; window.__keys.length = 0; });
    while (Date.now() - t0 < 10_000) { await ap.step(Date.now() - t0); await sleep(45); }
    await ap.release();
    const heldAfter = await theHeld();
    await hang;
    const t1 = Date.now();
    const rec = await fr(other, () => ({ frames: window.__frames, keys: window.__keys, seen: window.__seen ?? [] }));
    await sleep(3500);
    const gapIn = (from, to) => { const ts = rec.seen.filter((t) => t >= from && t <= to); let gap = 0, prev = from; for (const t of [...ts, to]) { gap = Math.max(gap, t - prev); prev = t; } return { changes: ts.length, longestStillMs: gap }; };
    const after = await fr(frozen, () => ({ me: window.__me(), phase: window.__phase() })).catch((e) => ({ error: String(e) }));
    const pa = await probe(frozen), po = await probe(other);
    const plays = await answers(frozen);
    const an = analyse(rec.frames, rec.keys);
    res[which] = {
      stoppedRole: role, otherRole,
      monstersAndBotsOnTheOtherScreenWhileStopped: gapIn(t0, t1),
      otherPlayer: { runFeedbackMs: an.runFeedbackMs, jumpFeedbackMs: an.jumpFeedbackMs, goldOnHudMs: an.goldOnHudMs, unexplainedJumpsOfMyRunner: an.unexplainedJumpsOfMyRunner },
      stoppedRoleAfter: pa?.role, otherRoleAfter: po.role, reconnects: [pa?.reconnects, po.reconnects],
      stoppedPlaysAgain: plays, stoppedRunnerOnTheOtherScreen: { before: heldBefore, after: heldAfter, movedTiles: heldBefore && heldAfter ? Math.round((Math.abs(heldAfter.x - heldBefore.x) + Math.abs(heldAfter.y - heldBefore.y)) * 100) / 100 : null },
      errors: [...a.errors, ...b.errors].filter((e) => !/Back-Forward Cache/.test(e)),
    };
    await a.ctx.close(); await b.ctx.close();
  }
  return res;
}

/* ------------------------------------------------------------------ a reload in the middle of a round */
async function reload(chrome) {
  const res = {};
  for (const which of ['first', 'second']) {
    const room = newRoom(`reload-${which}`);
    const a = await open(chrome, room), b = await open(chrome, room);
    await liveWith(a, 60_000);
    const me = which === 'first' ? a : b, other = which === 'first' ? b : a;
    const ap = pilot(me, 3);
    const t0 = Date.now(); while (Date.now() - t0 < 25_000) { await ap.step(Date.now() - t0); await sleep(45); } await ap.release();
    await sleep(1500);
    const before = { me: await fr(me, () => window.__me()), score: await fr(me, () => window.__myScore()), runners: await fr(other, () => window.__runners()), role: (await probe(me)).role };
    const seenBefore = before.runners.find((r) => !r.bot && !r.mine)?.score;
    const t1 = Date.now();
    await me.page.reload({ waitUntil: 'domcontentloaded' });
    await attach(me); await ready(me);
    const backInMs = Date.now() - t1;
    await sleep(1500);
    const after = { me: await fr(me, () => window.__me()), score: await fr(me, () => window.__myScore()), runners: await fr(other, () => window.__runners()), role: (await probe(me)).role };
    const plays = await answers(me);
    res[which] = { roleBefore: before.role, roleAfter: after.role, otherRoleAfter: (await probe(other)).role, backInMs, scoreBefore: before.score, scoreAfter: after.score, scoreKept: after.score >= before.score, scoreOnOtherScreenBefore: seenBefore, runnersBefore: before.runners.length, runnersAfter: after.runners.length, movedTilesWhileAway: Math.round((Math.abs(after.me.x - before.me.x) + Math.abs(after.me.y - before.me.y)) * 100) / 100, playsAgain: plays, errors: [...a.errors, ...b.errors].filter((e) => !/WebSocket|ERR_/.test(e)) };
    await a.ctx.close(); await b.ctx.close();
  }
  return res;
}

/* ------------------------------------------------------------------ the dev server is killed and started again mid-round */
async function restart(chrome) {
  const room = newRoom('restart');
  const a = await open(chrome, room), b = await open(chrome, room);
  await liveWith(a, 80_000);
  const ap = pilot(a, 7);
  const t00 = Date.now(); while (Date.now() - t00 < 25_000) { await ap.step(Date.now() - t00); await sleep(45); } await ap.release();
  await sleep(1500);
  const before = { me: await fr(a, () => window.__me()), score: await fr(a, () => window.__myScore()), runners: await fr(a, () => window.__runners()), phase: await fr(a, () => window.__phase()), roles: [(await probe(a)).role, (await probe(b)).role] };
  const run = promisify(execFile);
  const t0 = Date.now();
  await run('npx', ['--no-install', 'homie-studio', 'dev', '--stop'], { cwd }).catch((e) => ({ stdout: String(e) }));
  const downAt = Date.now();
  await sleep(3000);
  const log = openSync(join('/tmp/claude-501', `arcade-${tag}-dev-restarted.log`), 'a');
  const child = spawn('npx', ['--no-install', 'homie-studio', 'dev', '--port', String(port), '--no-local-ai'], { cwd, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  let upAt = 0;
  for (let i = 0; i < 240 && !upAt; i += 1) { try { const r = await fetch(`${base}/api/games`); if (r.ok) upAt = Date.now(); } catch { /* not yet */ } if (!upAt) await sleep(250); }
  // No reload from here: the pages find the room again by themselves, or they do not. (If the play page reloads its game frame by itself, the helpers are put back.)
  let framesReloaded = 0;
  const back = async (p) => { const d = Date.now() + 60_000; while (Date.now() < d) { p.frame = p.page.frames().find((f) => /\/__game\//.test(f.url())) ?? p.frame; const s = await probe(p); if (s?.link === 'online' && s.seat !== null && s.round) { if (!(await fr(p, () => typeof window.__me === 'function').catch(() => false))) { framesReloaded += 1; await ready(p); } const me = await fr(p, () => window.__me()).catch(() => null); if (me) return Date.now(); } await sleep(200); } return 0; };
  const [backA, backB] = await Promise.all([back(a), back(b)]);
  const atBack = await fr(a, () => ({ me: window.__me(), score: window.__myScore() })).catch(() => null);
  await sleep(2500);
  const after = { me: await fr(a, () => window.__me()), score: await fr(a, () => window.__myScore()), runners: await fr(a, () => window.__runners()), phase: await fr(a, () => window.__phase()), roles: [(await probe(a))?.role, (await probe(b))?.role] };
  const plays = await answers(a);
  const total = (rows) => rows.reduce((s, r) => s + r.score, 0);
  const res = {
    serverPid: child.pid, downForMs: upAt - downAt, pagesBackMs: [backA && backA - upAt, backB && backB - upAt], reloadNeeded: !(backA && backB), gameFramesReloadedByThePage: framesReloaded,
    roundBefore: before.phase, roundAfter: after.phase, sameRound: before.phase.n === after.phase?.n && after.phase?.phase === 'live',
    clockHeldMs: after.phase ? Math.round((after.phase.leftMs + (Date.now() - t0) - before.phase.leftMs)) : null,
    myScoreBefore: before.score, myScoreAfter: after.score, myScoreKept: after.score !== null && after.score >= before.score,
    allScoresBefore: total(before.runners), allScoresAfter: total(after.runners), scoresKept: total(after.runners) >= total(before.runners),
    movedTilesWhileDown: after.me ? Math.round((Math.abs(after.me.x - before.me.x) + Math.abs(after.me.y - before.me.y)) * 100) / 100 : null,
    rolesBefore: before.roles, rolesAfter: after.roles, playsAgain: plays, movedTilesWhenThePageWasBack: atBack?.me ? Math.round((Math.abs(atBack.me.x - before.me.x) + Math.abs(atBack.me.y - before.me.y)) * 100) / 100 : null,
    reconnects: [(await probe(a)).reconnects, (await probe(b)).reconnects],
  };
  await a.ctx.close(); await b.ctx.close();
  return res;
}

/* ------------------------------------------------------------------ three rounds, start to results */
async function rounds(chrome) {
  const room = newRoom('rounds');
  const a = await open(chrome, room), b = await open(chrome, room, { viewport: 'phone' });
  const res = { rounds: [], roles: [(await probe(a)).role, (await probe(b)).role] };
  const ap = pilot(a, 21);
  let phase = '', n0 = 0, shot = false;
  const firstN = (await fr(a, () => window.__phase())).n;
  const t00 = Date.now();
  for (;;) {
    const r = await fr(a, () => window.__phase());
    if (!r) { await sleep(100); continue; }
    const k = `${r.n}:${r.phase}`;
    if (k !== phase) {
      phase = k;
      if (r.phase === 'live' && r.n > firstN) {
        await ap.release();
        await sleep(300);
        // A round has just started: everyone at 0 on a spawn point, every monster and all the gold back.
        const [ma, mb, ra, rb, st] = [await fr(a, () => window.__me()), await fr(b, () => window.__me()), await fr(a, () => window.__runners()), await fr(b, () => window.__runners()), await fr(a, () => window.__state())];
        const onSpawn = (m) => m && LEVEL.SPAWNS.some((sp) => Math.abs(sp[0] - m.x) < 2 && m.y - sp[1] > -1 && m.y - sp[1] < 14);   // on it, or falling from it
        res.rounds.push({ n: r.n, leftMsAtStart: r.leftMs, everyoneAtZero: ra.every((x) => x.score === 0) && rb.every((x) => x.score === 0), bothOnSpawnPoints: onSpawn(ma) && onSpawn(mb), monstersOnScreen: st.mons.length, goldOnScreen: [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => st.gold & (1 << i)).length, myHudScore: st.score });
        await fr(a, () => { window.__frames.length = 0; window.__keys.length = 0; });
        shot = false; n0 = r.n;
      }
      if (r.phase === 'over' && n0 === r.n) {
        await ap.release();
        await sleep(1200);
        const row = res.rounds.find((x) => x.n === r.n);
        const [ra, rb, runners, rec, hud] = [await fr(a, () => window.__results()), await fr(b, () => window.__results()), await fr(a, () => window.__runners()), await fr(a, () => ({ frames: window.__frames, keys: window.__keys })), await fr(a, () => ({ card: document.querySelector('.hp-results')?.innerText ?? '', board: document.querySelector('.hp-board')?.innerText ?? '', clock: document.querySelector('.hp-clock')?.innerText ?? '' }))];
        const order = (rows) => rows.slice().sort((x, y) => y.score - x.score || Number(x.bot) - Number(y.bot) || x.slot - y.slot).map((x) => [x.name, x.score, x.bot]);
        const an = analyse(rec.frames, rec.keys);
        Object.assign(row, {
          results: order(ra ?? []), sameOnBothScreens: JSON.stringify(order(ra ?? [])) === JSON.stringify(order(rb ?? [])),
          resultsMatchScores: (ra ?? []).every((x) => runners.find((y) => y.slot === x.slot)?.score === x.score),
          resultsCard: hud.card.replace(/\n/g, ' | '), clock: hud.clock,
          myPoints: runners.find((x) => x.mine)?.score ?? null, catches: an.catches, goldTaken: an.goldOnHudMs.n, stomps: an.landedOnItAndStomped,
        });
        await a.page.screenshot({ path: join(out, 'shots', `${tag}-results-computer.png`) });
        await b.page.screenshot({ path: join(out, 'shots', `${tag}-results-phone.png`) });
        if (res.rounds.filter((x) => x.results).length >= 3) break;
      }
    }
    if (r.phase === 'live' && n0 === r.n) {
      await ap.step(Date.now() - t00);
      if (!shot && r.leftMs < 100_000) { shot = true; await a.page.screenshot({ path: join(out, 'shots', `${tag}-playing-computer.png`) }); await b.page.screenshot({ path: join(out, 'shots', `${tag}-playing-phone.png`) }); }
      await sleep(45);
    } else await sleep(100);
  }
  const pa = await probe(a), pb = await probe(b);
  res.sound = { computer: pa.fx, phone: pb.fx };
  res.reconnects = [pa.reconnects, pb.reconnects];
  res.errors = [...a.errors, ...b.errors];
  await a.ctx.close(); await b.ctx.close();
  return res;
}


/* ------------------------------------------------------------------ pt6: forged reports through the real client */
function forgeHook() {
  window.__forgeMode = null; window.__forgeN = 0; window.__forgeSample = null; window.__forgeAcc = 0;
  window.__forge = (data) => {
    if (typeof data !== 'string' || !window.__forgeMode) return data;
    let m; try { m = JSON.parse(data); } catch { return data; }
    if (m.t !== 'in' || !Array.isArray(m.s)) return data;
    const mode = window.__forgeMode; window.__forgeN++;
    for (const row of m.s) {
      if (!Array.isArray(row) || row.length < 14) continue;
      if (mode === 'teleport') row[4] += 3;                         // three tiles to the right
      else if (mode === 'wall') row[5] += 0.6;                      // sunk into the floor
      else if (mode === 'speed') { row[4] += 0.12 * (window.__forgeAcc += 1) / Math.max(1, m.s.length); row[7] *= 1.5; }  // faster than the run speed
      else if (mode === 'tol') row[4] += 0.0019;                    // just inside the float tolerance, every report
      else if (mode === 'future') row[0] += 40;                     // two seconds ahead
      else if (mode === 'past') { m.k -= 40; }                      // two seconds behind
      else if (mode === 'velonly') row[7] *= 2;                     // honest position, doubled velocity
    }
    if (!window.__forgeSample) window.__forgeSample = JSON.stringify(m).slice(0, 400);
    return JSON.stringify(m);
  };
}
async function forge(chrome) {
  const { me, other } = await pair(chrome, 'forge');
  await liveWith(me, 80_000);
  for (const f of me.page.frames()) await f.evaluate(forgeHook).catch(() => {});
  const mySeat = (await probe(me)).seat;
  await fr(other, (seat) => { window.__seenMe = []; const loop = () => { const o = (window.__others() || []).find((r) => !r.bot && r.slot === seat); if (o) window.__seenMe.push([performance.timeOrigin + (window.__homieMeasureNow?.() ?? performance.now()), o.x, o.y, [], o.score]); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }, mySeat);
  await fr(me, () => { window.__frames.length = 0; window.__keys.length = 0; });
  const ap = pilot(me, 13); const t0 = Date.now(); const windows = [];
  const modes = String(arg('modes', 'teleport,wall,speed,tol,velonly,future,past')).split(',');
  const setMode = (m) => Promise.all(me.page.frames().map((f) => f.evaluate((x) => { if ('__forgeMode' in window) { window.__forgeMode = x; window.__forgeAcc = 0; } }, m).catch(() => {})));
  const drive = async (ms) => { const e = Date.now() + ms; while (Date.now() < e) { await ap.step(Date.now() - t0); await sleep(45); } };
  await drive(4000);
  for (const mode of modes) {
    const a = await fr(me, () => performance.now()), sc = await fr(me, () => window.__myScore());
    await setMode(mode); await drive(4000); await setMode(null);
    const b = await fr(me, () => performance.now());
    await drive(5000);
    windows.push({ mode, at: a, end: b, scoreBefore: sc, scoreAfter: await fr(me, () => window.__myScore()) });
  }
  await ap.release(); await sleep(800);
  const samples = await Promise.all(me.page.frames().map((f) => f.evaluate(() => ('__forgeN' in window) ? { n: window.__forgeN, sample: window.__forgeSample } : null).catch(() => null)));
  const rec = await fr(me, () => ({ frames: window.__frames, keys: window.__keys, wire: window.__wire, origin: performance.timeOrigin }));
  const seen = await fr(other, () => window.__seenMe ?? []);
  writeFileSync(join(out, `${tag}-forge-frames.json.gz`), (await import('node:zlib')).gzipSync(JSON.stringify({ ...rec, seen, windows })));
  const pr = await probe(me);
  const res = { windows, samples: samples.filter(Boolean), reconnects: pr?.reconnects, link: pr?.link, errors: [...me.errors, ...other.errors].slice(0, 10) };
  await me.ctx.close(); await other.ctx.close();
  return res;
}

const chrome = await launch();
try {
  const sections = { forge: () => forge(chrome), shape: () => lag(chrome, Number(arg('delay', 0)), Number(arg('loss', 0)), Number(arg('seconds', 42)), Number(arg('jitter', 0))), hangPress: () => hangPress(chrome), feel: () => feel(chrome, 0), feel150: () => feel(chrome, 150), controls: () => controls(chrome), lag0: () => lag(chrome, 0, 0), jitter: () => lag(chrome, 80, 0, Number(arg('seconds', 100)), 60), loss40: () => lag(chrome, 40, 0.005), loss60: () => lag(chrome, 60, 0.01), loss80: () => lag(chrome, 80, 0.02), loss150: () => lag(chrome, 150, 0.05), loss150three: () => lag(chrome, 150, 0.03), lag150: () => lag(chrome, 150, 0), lag300: () => lag(chrome, 300, 0.05), lag300steady: () => lag(chrome, 300, 0), pause: () => pause(chrome), reload: () => reload(chrome), restart: () => restart(chrome), rounds: () => rounds(chrome) };
  for (const name of only) {
    const t = Date.now();
    receipt[asHost ? `${name}AsHost` : name] = await sections[name]();
    save();
    console.log(`${tag} ${name}: ${Math.round((Date.now() - t) / 100) / 10} s`);
    console.log(JSON.stringify(receipt[asHost ? `${name}AsHost` : name]).slice(0, 2200));
  }
} finally { await chrome.close(); }

// All receipts are written and our browser is closed; do not retain a stale CDP timeout.
process.exit(0);
