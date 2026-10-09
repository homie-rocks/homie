/**
 * `homie-studio shoot`: frames on a clock the command steps, and a two-client seat smoke check (lib/shoot.mjs).
 *
 *   - the virtual clock itself, run in a bare JavaScript context: before the freeze it is the real clock; after it
 *     nothing moves until a step, and a step moves performance.now, Date, timers and animation frames by exactly
 *     the step, in order;
 *   - the smoke verdict, from clients whose faults are known (no seat, two rooms, alone offline, one seat twice);
 *   - the whole command against a stub site in a real Chrome (skipped where there is none): every frame is one step
 *     of the game's clock however long the computer took, which is the point of it.
 * Run: node --test packages/studio/test/shoot.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { findChrome } from '../lib/chrome.mjs';
import { VIRTUAL_CLOCK, judgeSmoke, shoot } from '../lib/shoot.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-shoot-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const real = (ms) => new Promise((r) => setTimeout(r, ms));

test('the virtual clock: real until frozen, then time, timers and animation frames move only by the step', async (t) => {
  // The clock's own real-time pump is an interval that lives as long as its page: here, until the test ends.
  const pumps = [];
  t.after(() => { for (const id of pumps) clearInterval(id); });
  const win = { setTimeout, setInterval: (...a) => { const id = setInterval(...a); pumps.push(id); return id; }, clearTimeout, clearInterval, performance: { now: () => performance.now() }, Date, document: {}, requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 5) };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(VIRTUAL_CLOCK, ctx);
  vm.runInContext(`
    globalThis.frames = 0; globalThis.ticks = 0; globalThis.order = [];
    const loop = (t) => { frames++; globalThis.lastT = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    setInterval(() => { ticks++; }, 10);
  `, ctx);
  await real(80);
  assert.ok(win.frames > 0 && win.ticks > 0, 'before the freeze the page runs on the real clock');
  const clock = win.__homieClock;
  const t0 = clock.freeze();
  const [f0, k0] = [win.frames, win.ticks];
  const d0 = vm.runInContext('Date.now()', ctx);
  await real(80);
  // The fault a recorder meets: the wall clock runs on and the game's loop with it. Frozen, nothing moves.
  assert.deepEqual([win.frames - f0, win.ticks - k0, win.performance.now() - t0, vm.runInContext('Date.now()', ctx) - d0], [0, 0, 0, 0]);
  vm.runInContext(`setTimeout(() => order.push('late'), 30); setTimeout(() => order.push('early'), 10); setTimeout(() => order.push('never'), 500);`, ctx);
  for (let i = 0; i < 3; i++) clock.step(20);
  assert.equal(win.frames - f0, 3, 'one animation frame a step');
  assert.equal(win.lastT - t0, 60, 'and it is handed the stepped time');
  assert.equal(win.performance.now() - t0, 60);
  assert.equal(vm.runInContext('new Date().getTime()', ctx) - d0, 60, 'Date moves with it');
  assert.deepEqual([...win.order], ['early', 'late'], 'timers fire in time order, and only the due ones');
  assert.ok(win.ticks - k0 >= 5 && win.ticks - k0 <= 7, `a 10 ms interval over 60 ms of stepped time: ${win.ticks - k0}`);
  assert.equal(clock.stats().steps, 3);
});

test('freezing drains overdue real-time timers before the stepped interval begins', () => {
  let now = 0;
  const win = { setTimeout: () => 1, setInterval: () => 2, clearTimeout() {}, clearInterval() {}, performance: { now: () => now }, Date, document: {}, requestAnimationFrame() {} };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(VIRTUAL_CLOCK, ctx);
  vm.runInContext('globalThis.ticks = 0; setInterval(() => ticks++, 10);', ctx);
  // The host did not schedule its pump while the page's real time advanced.
  now = 85;
  win.__homieClock.freeze();
  const baseline = win.ticks;
  assert.equal(baseline, 8);
  win.__homieClock.step(60);
  assert.equal(win.ticks - baseline, 6, 'only the six intervals in the captured time belong to the take');
});

test('the two-client smoke verdict: no seat, two rooms, alone offline and one seat twice all fail by name', () => {
  const c = (kind, seat, extra = {}) => ({ kind, seated: seat === null ? null : { room: 'shoot-a', seat, role: seat === 0 ? 'host' : 'replica' }, net: { connected: true, offline: false }, ...extra });
  assert.deepEqual(judgeSmoke([c('computer', 0), c('phone', 1)]), { ok: true, verdict: 'PASS', room: 'shoot-a', seats: [0, 1] });
  assert.match(judgeSmoke([c('computer', 0), c('phone', null)]).why, /the phone never got a seat/);
  assert.match(judgeSmoke([c('computer', 0), { ...c('phone', 1), seated: { room: 'shoot-b', seat: 1, role: 'host' } }]).why, /different rooms \(shoot-a, shoot-b\)/);
  // The fault: a starved client falls back to hosting alone; its own page still shows a seat.
  const alone = judgeSmoke([c('computer', 0), c('phone', 0, { net: { connected: false, offline: true } })]);
  assert.equal(alone.ok, false);
  assert.match(alone.why, /the phone has a seat on its own page but is playing alone offline/);
  assert.match(judgeSmoke([c('computer', 0), c('phone', 0)]).why, /both clients report seat 0/);
  // A page that exposes no connection state: the seats count, and the socket is said to be unmeasured.
  assert.match(judgeSmoke([c('computer', 0), c('phone', 1, { net: null })]).note, /the phone exposes no connection state/);
});

/** A stub site: a play page with a shell that seats each visitor, and a game frame that moves a box by its own clock. */
function stubSite() {
  let seat = 0;
  const game = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#102040}canvas{display:block}</style><canvas width="640" height="360"></canvas><script>
    const t0 = performance.now(); let frames = 0; const rows = [];
    const c = document.querySelector('canvas'); const g = c.getContext('2d');
    const loop = () => { frames++; const x = (performance.now() - t0) * 0.1; rows.push([performance.now(), x, 50, 1, 0, 0, -1, 0, 0]); if (rows.length > 600) rows.shift();
      g.fillStyle = '#102040'; g.fillRect(0, 0, 640, 360); g.fillStyle = '#ffcc55'; g.fillRect(x % 600, 40, 30, 30); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    window.__homiePort = { view: 'top', rows: (s = 0) => rows.filter((r) => r[0] >= s), now: () => performance.now(), info: () => ({ frames, round: { n: 1, phase: 'live', leftMs: 60000 }, extra: { drawCalls: 7, triangles: 120 } }) };
    window.__homieNet = { connected: true, offline: false };
  </script>`;
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (u.pathname === '/g/play') {
      const mine = seat++;
      res.end(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}iframe{border:0;width:100vw;height:100vh;display:block}</style><iframe class="game" src="/g/__game/"></iframe><script>
        window.__shell = { room: ${JSON.stringify(u.searchParams.get('room'))}, seat: ${mine}, stats: { role: ${mine === 0 ? '"host"' : '"replica"'} }, arrival: { phase: 'done', liftedMs: 12, by: 'game' } };
      </script>`);
    } else if (u.pathname === '/g/__game/') res.end(game);
    else { res.statusCode = 404; res.end('no'); }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) })));
}

test('shoot against a stub site: two clients seated in one private room, then frames one clock step apart', { skip: findChrome() ? false : 'no Chrome on this machine', timeout: 240_000 }, async () => {
  const site = await stubSite();
  try {
    const out = join(scratch, 'frames');
    const r = await shoot({ url: site.url, game: 'g', frames: 6, fps: 30, out, timeoutMs: 200_000 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual([r.smoke.verdict, r.smoke.seats.length, r.smoke.room], ['PASS', 2, r.room]);
    assert.match(r.room, /^shoot-/, 'a private room: no stranger and no earlier round in the pictures');
    assert.equal(r.ready.ready, true);
    assert.equal(r.frames, 6);
    const rec = JSON.parse(readFileSync(join(out, 'shoot.json'), 'utf8'));
    assert.equal(rec.rows.length, 6);
    for (const row of rec.rows) assert.ok(existsSync(join(out, row.file)), row.file);
    // The claim: each frame is exactly 1/30 s of the game's own clock later than the last, whatever the wall clock
    // did (this computer may be busy; the box moves 0.1 units a millisecond of ITS time).
    for (let i = 1; i < rec.rows.length; i++) {
      assert.ok(Math.abs((rec.rows[i].x - rec.rows[i - 1].x) - 100 / 30) < 0.01, `frame ${i + 1} moved ${rec.rows[i].x - rec.rows[i - 1].x}, not one step`);
      assert.ok(Math.abs((rec.rows[i].clockMs - rec.rows[i - 1].clockMs) - 1000 / 30) < 0.01);
    }
    assert.deepEqual([rec.rows[0].phase, rec.rows[0].drawCalls, rec.rows[0].triangles], ['live', 7, 120], 'the state and renderer counters the game exposes ride with each frame');
    assert.ok(!readFileSync(join(out, 'frame-0001.png')).equals(readFileSync(join(out, 'frame-0006.png'))), 'the pictures differ: the box moved');
    assert.match(r.limits, /NOT stepped: the room's socket/);
  } finally { await site.close(); }
});
