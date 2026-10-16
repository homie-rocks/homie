// A phone in real Chrome: touch stick + JUMP button by CDP touch events, CPU throttled, for N seconds, against a computer player.
// node phone.mjs --base URL --tag T [--cpu 4] [--seconds 180] [--delay 60 --loss 0.01 --jitter 20]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openPlayer, instrument, sleep, probe } from '/private/tmp/claude-501/-Users-ryan--homie-workspace-homie--claude-worktrees-dev-feedback-toolkit-3293de/28857d96-0d6d-42cb-ac18-64d8c7896e73/scratchpad/pt6/tp/browser.mjs';
import { loadModule } from '/Users/ryan/Studios/homie-arcade-rules/tests/lib/rules.mjs';
const arg = (n, f = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : f; };
const base = arg('base'), tag = arg('tag'), cpu = Number(arg('cpu', 4)), seconds = Number(arg('seconds', 180));
const lag = { delay: Number(arg('delay', 60)), loss: Number(arg('loss', 0.01)), jitter: Number(arg('jitter', 20)) };
const out = arg('out', '/private/tmp/claude-501/-Users-ryan--homie-workspace-homie--claude-worktrees-dev-feedback-toolkit-3293de/28857d96-0d6d-42cb-ac18-64d8c7896e73/scratchpad/pt6/tp/runs');
const L = await loadModule('games/tiny-platformer/src/level.ts');
const solid = (tx, ty) => { const i = tx + ty * L.TW; return i >= 0 && i < L.TILES.length && L.TILES[i] !== 0; };
function helpers() {
  const info = () => window.__homiePort.info(); const room = window.__room, opts = window.__roomOpts; const T = 32;
  window.__me = () => { if (room) { const b = opts.local(); return b && room.mySeat() !== null ? { x: b.x / T, y: b.y / T } : null; } return info().extra.corner ?? null; };
  window.__mons = () => { if (room) { const w = room.fast(); const o = []; if (w) for (let n = 0; 1 + n * 3 + 2 < w.length; n += 1) if (w[1 + n * 3 + 2]) o.push({ i: n, x: w[1 + n * 3] / T, y: w[1 + n * 3 + 1] / T }); return o; } return info().extra.monsters; };
  window.__goldMask = () => { if (room) { const w = room.fast(); return w ? w[0] : 0; } return info().extra.goldMask; };
  window.__myScore = () => { const el = document.querySelector('.hp-board .me'); const m = el && /(\d+)\s*$/.exec(el.textContent); return m ? Number(m[1]) : null; };
  window.__phase = () => { const r = info().round; return r ? { n: r.n, phase: r.phase, leftMs: r.leftMs } : null; };
  window.__state = () => ({ me: window.__me(), mons: window.__mons(), gold: window.__goldMask(), score: window.__myScore(), phase: window.__phase() });
  window.__frames = []; window.__touches = [];
  const loop = () => { const me = window.__me(); if (me) { const f = window.__frames; f.push([performance.now(), me.x, me.y, window.__myScore(), window.__goldMask(), [], info().extra.draw ? { ...info().extra.draw, diedAt: info().extra.body?.diedAt, round: info().round?.n } : null]); if (f.length > 40000) f.splice(0, 5000); } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  for (const t of ['touchstart', 'touchend']) window.addEventListener(t, (e) => window.__touches.push([performance.now(), t, e.touches.length]), true);
}
const chrome = await launch();
const room = `perf-${tag.slice(0,12)}-${Date.now().toString(36)}`;
const res = { tag, base, cpu, seconds, lag };
try {
  const other = await openPlayer(chrome, { base, game: 'tiny-platformer', room, init: instrument });
  const ph = await openPlayer(chrome, { base, game: 'tiny-platformer', room, viewport: 'phone', lag, init: instrument });
  await ph.frame.waitForFunction(() => window.__homiePort?.info?.().round && (window.__room ? window.__room.mySeat() !== null && window.__roomOpts.local() : window.__homiePort.info().extra.corner), { timeout: 60000 });
  await ph.frame.evaluate(helpers);
  const cdp = await ph.page.createCDPSession();
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', {samplingInterval:131072,stackDepth:16,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
  const button = await ph.frame.evaluate(() => { const b = [...document.querySelectorAll('*')].find((el) => el.textContent === 'JUMP' && el.children.length === 0); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  // the frame offset inside the page
  const off = await ph.page.evaluate(() => { const f = document.querySelector('iframe'); const r = f ? f.getBoundingClientRect() : { x: 0, y: 0 }; return { x: r.x, y: r.y }; });
  res.jumpButton = button; res.frameOffset = off;
  const SX = 100, SY = 600;
  let stick = null, jump = null; // {x,y}
  const pts = () => [...(stick ? [{ x: stick.x, y: stick.y, id: 1, radiusX: 12, radiusY: 12, force: 1 }] : []), ...(jump ? [{ x: jump.x, y: jump.y, id: 2, radiusX: 12, radiusY: 12, force: 1 }] : [])];
  const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts() });
  let dir = 0;
  const setDir = async (d) => { if (d === dir) return; dir = d; if (d === 0) { if (stick) { stick = null; await send('touchEnd'); } return; } if (!stick) { stick = { x: SX, y: SY }; await send('touchStart'); for (let i = 1; i <= 3; i++) { stick = { x: SX + d * 70 * i / 3, y: SY }; await send('touchMove'); } } else { stick = { x: SX + d * 70, y: SY }; await send('touchMove'); } };
  const tapJump = async () => { if (jump || !button) return; jump = { x: button.x + off.x, y: button.y + off.y }; await send('touchStart'); await sleep(70); jump = null; await send('touchEnd'); };
  let s = 7 >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const brain = { target: -1, chosen: -99, dir: 1, check: null, flee: 0 };
  await ph.frame.evaluate(() => { window.__frames.length = 0; });
  const t0 = Date.now(); let steps = 0, jumps = 0;
  while (Date.now() - t0 < seconds * 1000) {
    const st = await ph.frame.evaluate(() => window.__state()).catch(() => null);
    if (st?.me) {
      const b = st.me, t = (Date.now() - t0) / 1000;
      const golds = L.GOLD.map((g, i) => ({ ...g, i })).filter((g) => st.gold & (1 << g.i));
      if (brain.target < 0 || !(st.gold & (1 << brain.target)) || t - brain.chosen > 4) { let best = -1, bd = Infinity; for (const g of golds) { const d = Math.abs(g.x - b.x) + Math.max(0, b.y - g.y) * 2 + Math.max(0, g.y - b.y) * 0.5 + rnd() * 6.25; if (d < bd) { bd = d; best = g.i; } } brain.target = best; brain.chosen = t; }
      if (!brain.check || t - brain.check.t > 1.5) { if (brain.check && Math.abs(b.x - brain.check.x) + Math.abs(b.y - brain.check.y) < 1) { brain.flee = t + 1 + rnd(); brain.dir = rnd() < 0.5 ? -1 : 1; brain.target = -1; } brain.check = { t, x: b.x, y: b.y }; }
      let d = brain.dir, j = false; const tx = Math.floor(b.x + 0.5), ty = Math.floor(b.y + 0.5), g = brain.target >= 0 ? L.GOLD[brain.target] : null;
      if (t >= brain.flee && g) { const dx = g.x - b.x; d = Math.abs(dx) > 1 / 3 ? (dx > 0 ? 1 : -1) : 0; if (g.y < b.y - 1 && Math.abs(dx) < 4) j = rnd() < 0.6; }
      if (d && solid(tx + d, ty)) j = true;
      if (d && !solid(tx + d, ty + 1) && !solid(tx + d, ty + 2) && rnd() < 0.3) j = true;
      for (const m of st.mons) if (Math.abs(m.y - b.y) < 1 && (m.x - b.x) * (d || 1) > 0 && Math.abs(m.x - b.x) < 3) j = true;
      await setDir(d); if (j) { jumps++; await tapJump(); }
      steps++;
    }
    await sleep(60);
  }
  await setDir(0);
  await sleep(500);
  const rec = await ph.frame.evaluate(() => ({ frames: window.__frames, touches: window.__touches.length, wire: window.__wire, score: window.__myScore() }));
  const pr = await probe(ph);
  Object.assign(res, { steps, jumps, touches: rec.touches, score: rec.score, link: pr?.link, reconnects: pr?.reconnects, errors: [...ph.errors, ...other.errors], load: (await import('node:os')).loadavg().map((x) => +x.toFixed(1)) });
  writeFileSync(join(out, `${tag}-frames.json`), JSON.stringify({ ...rec, cpu, load: res.load }));
  await ph.page.screenshot({ path: join(out, `${tag}-phone.png`) });
  const heap=await cdp.send('HeapProfiler.stopSampling');writeFileSync(join(out, `${tag}-heap.json`),JSON.stringify(heap.profile));
  const profile=await cdp.send('Profiler.stop');writeFileSync(join(out, `${tag}-profile.json`),JSON.stringify(profile.profile));
  await ph.ctx.close(); await other.ctx.close();
} finally { await chrome.close(); }
writeFileSync(join(out, `${tag}.json`), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
process.exit(0);
