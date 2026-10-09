/**
 * `homie-studio port check <game> --url <site>` — a port is done when this
 * passes. It runs the tests people's hands taught us, on the real play page
 * (the sandboxed frame, the room, the relay), with at most two browsers open:
 *
 *   owner-desk   keys: hold one direction 5 s → one straight line the pressed
 *                way, camera yaw change under 10°; hold another 5 s; then
 *                alternate directions for 10 s → every press goes the pressed
 *                way within 600 ms. (Board games: every key and every swipe is
 *                the move the game applies.)
 *   owner-phone  the same with REAL touch (CDP Input.dispatchTouchEvent) on an
 *                emulated Android Chrome (Pixel 7, DPR 2.625), plus how much of
 *                the screen the UI covers (≤ 12%, nothing opaque in the middle).
 *   owner-iphone the same on WebKit with the iPhone 15 profile (Playwright's
 *                WebKit, touch through its protocol), when installed.
 *   round        two fresh browsers (a computer and a phone) press Play, meet in
 *                the same public room and both see a round finish with both of
 *                them in the results.
 *   life         a computer hosts, a phone plays; the host's browser is killed
 *                (SIGKILL, the whole process tree): the phone must take over the
 *                SAME round within 5 s; then a late joiner arrives mid-round and
 *                is seated in a bot's place with the world on its first frames.
 *   tv           the big screen (/<game>/tv): a spectator with no body, the join
 *                QR, a picture that is not black, frames moving.
 *   audio/errors audio running after the first input; no uncaught errors.
 *
 * The game must call exposePort() (from @homie-rocks/studio/port, or HomiePort in a
 * static game). Receipts and screenshots go to games/<id>/.port/check-<stamp>/.
 * Exit 0 only when every row passed.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeArgs, findChrome, isLoopbackUrl, noChrome } from './chrome.mjs';
import { reachSite, siteRefusal } from './net.mjs';

const GPU = [
  ...chromeArgs(), '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check',
];
const TAG = 'homie-studio-check';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (p, ms, v = null) => Promise.race([Promise.resolve(p).catch(() => v), sleep(ms).then(() => v)]);
const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const ALL = ['owner-desk', 'owner-phone', 'owner-iphone', 'round', 'life', 'tv'];

/* ------------------------------------------------------------------ judging */

/** A row's ground displacement → screen (x right, y down) using the row's own camera basis. */
function toScreen(r0, dx, dy) {
  const rx = r0[3], ry = r0[4], ux = r0[5], uy = r0[6];
  return { x: dx * rx + dy * ry, y: -(dx * ux + dy * uy) };
}
const angDeg = (v, u) => { const a = Math.atan2(v.y, v.x) - Math.atan2(u[1], u[0]); return Math.abs(((a * 180) / Math.PI + 540) % 360 - 180); };
function yawDeg(a, b) {
  const d = a[5] * b[5] + a[6] * b[6]; const la = Math.hypot(a[5], a[6]) || 1; const lb = Math.hypot(b[5], b[6]) || 1;
  return (Math.acos(Math.max(-1, Math.min(1, d / (la * lb)))) * 180) / Math.PI;
}
/** A server room keeps its authority and advances; a browser room must promote a host. */
export function roomContinued(before, after, serverHosted) {
  return serverHosted
    ? after?.hosted === 'server' && after?.role === 'replica' && Number.isFinite(before?.tick) && after?.tick > before.tick && after?.frames > before.frames
    : after?.role === 'host';
}

/** Compare two observations on the same browser clock, including time spent taking screenshots. */
export function roundClockContinued(before, after) {
  return !before?.round || !after?.round || before.round.n !== after.round.n
    || Math.abs((before.round.leftMs - after.round.leftMs) - (after.observedAt - before.observedAt)) < 6000;
}

/** A wall can leave too little runway; retry the same hold after moving away, never excuse steering faults. */
export function needsRunway(res) {
  return !res.ok && (res.why === 'barely moved' || res.why?.startsWith('blocked at once'))
    && res.yawChangeDeg < 10 && (res.dirErrDeg === null || res.dirErrDeg < 15);
}

const finite = (r) => r && Number.isFinite(r[1]) && Number.isFinite(r[2]);
/** A frame the player steers (the probe's `busy` says when a knockback, a stun or a respawn has the body). */
const steerable = (r) => finite(r) && !r[8];

/**
 * One held direction: straight, the pressed way, the camera still. `side`: only the horizontal matters (gravity owns y).
 * Only the free run is judged: once the body stops making progress the pressed way (a wall, the arena's edge),
 * sliding along the obstacle is contact, not a wrong turn.
 */
export function judgeHold(rows, dir, a, b, size, view) {
  const seg = rows.filter((r) => r[0] >= a && r[0] <= b + 40 && steerable(r));
  const busyFrames = rows.filter((r) => r[0] >= a && r[0] <= b + 40 && finite(r) && r[8]).length;
  if (seg.length < 8) return { ok: false, dir, busyFrames, why: busyFrames ? `the body was busy (knocked back, stunned, respawning) for ${busyFrames} frames of the hold` : `too few samples (${seg.length}): no body on the probe?` };
  const u = DIRV[dir]; const r0 = seg[0];
  const side = view === 'side';
  const tiIdx = Math.max(0, seg.findIndex((r) => r[0] >= a + 400));
  const ti = seg[tiIdx] ?? r0;
  const along = (r) => { const d = toScreen(r0, r[1] - ti[1], r[2] - ti[2]); return side ? d.x * u[0] : d.x * u[0] + d.y * u[1]; };
  // Where progress the pressed way stops for good (250 ms without gaining 2% of a body): the free run ends there.
  let best = 0; let bestT = ti[0]; let contact = null;
  for (let i = tiIdx; i < seg.length; i++) {
    const r = seg[i]; const p = along(r);
    if (p > best + size * 0.02) { best = p; bestT = r[0]; }
    else if (r[0] - bestT > 250 && best > size) { contact = bestT; break; }
  }
  const free = seg.filter((r) => contact === null || r[0] <= contact);
  const last = free[free.length - 1] ?? r0;
  const tot = toScreen(r0, last[1] - ti[1], last[2] - ti[2]);
  const travel = side ? Math.abs(tot.x) : Math.hypot(tot.x, tot.y);
  let moving = 0, wrong = 0, off = 0, prev = null, maxYaw = 0;
  const minSpeed = Math.max(size * 0.5, 1e-3);
  for (const r of seg) maxYaw = Math.max(maxYaw, yawDeg(r0, r));
  for (const r of free) {
    if (r[0] < ti[0]) { prev = r; continue; }
    const d = toScreen(r0, r[1] - ti[1], r[2] - ti[2]);
    if (!side) off = Math.max(off, Math.abs(d.x * -u[1] + d.y * u[0]));
    if (prev && r[0] > prev[0]) {
      const v = toScreen(r0, r[1] - prev[1], r[2] - prev[2]);
      const dt = (r[0] - prev[0]) / 1000;
      const sp = (side ? Math.abs(v.x) : Math.hypot(v.x, v.y)) / dt;
      if (sp > minSpeed) { moving += 1; if (side ? Math.sign(v.x) !== u[0] : angDeg(v, u) > 25) wrong += 1; }
    }
    prev = r;
  }
  const dirErr = travel > 0 ? (side ? (Math.sign(tot.x) === u[0] ? 0 : 180) : angDeg(tot, u)) : null;
  const res = {
    dir, samples: seg.length, freeRunMs: Math.round((contact ?? last[0]) - a), contactMs: contact === null ? null : Math.round(contact - a),
    travel: +travel.toFixed(2), travelBodies: +(travel / size).toFixed(1), dirErrDeg: dirErr === null ? null : +dirErr.toFixed(1),
    offLine: +off.toFixed(2), offLineShare: travel ? +(off / travel).toFixed(3) : null, movingFrames: moving, wrongFrames: wrong, yawChangeDeg: +maxYaw.toFixed(2),
  };
  res.ok = res.yawChangeDeg < 10 && travel > size * 2 && dirErr !== null && dirErr < 15 && (moving ? wrong / moving : 1) < 0.1 && (side || off <= Math.max(size * 1.5, travel * 0.12));
  if (!res.ok) {
    res.why = res.yawChangeDeg >= 10 ? 'the camera turned by itself' : travel <= size * 2 ? (contact !== null && contact - a < 900 ? 'blocked at once (it started against something); move the spawn or run again' : 'barely moved') : dirErr === null || dirErr >= 15 ? 'went the wrong way' : 'not a straight line';
    // The path on screen (x right, y down, in bodies from the start), every ~50 ms, to see what happened.
    let lastT = -Infinity;
    res.path = seg.filter((r) => { if (r[0] - lastT < 50) return false; lastT = r[0]; return true; })
      .map((r) => { const d = toScreen(r0, r[1] - r0[1], r[2] - r0[2]); return [Math.round(r[0] - a), +(d.x / size).toFixed(2), +(d.y / size).toFixed(2)]; });
  }
  return res;
}

/**
 * Alternating presses: each goes the pressed way within 600 ms, and keeps going that way.
 * A maze (view 'maze') keeps its buffered turns: a turn into a wall waits for the next opening while the body goes
 * on, so a press there only fails if the body then moves AGAINST the pressed way. A reversal is always open in a
 * corridor, so it must still answer within 600 ms.
 */
export function judgePresses(rows, presses, size, view) {
  const maze = view === 'maze';
  const side = view === 'side';
  const minSpeed = Math.max(size * 0.5, 1e-3);
  const out = presses.map((p) => {
    const seg = rows.filter((r) => r[0] >= p.a && r[0] <= p.b + 60 && steerable(r));
    if (seg.length < 4) return rows.some((r) => r[0] >= p.a && r[0] <= p.b && finite(r) && r[8]) ? { dir: p.dir, ok: false, blocked: true, busy: true } : { dir: p.dir, ok: false, why: 'no samples' };
    // The first post-input frame can already show the response. Keep its preceding drawn pose.
    const before = rows.filter((r) => r[0] < p.a).at(-1);
    if (before && steerable(before)) seg.unshift(before);
    const u = DIRV[p.dir]; const r0 = seg[0];
    let matchAt = null, after = 0, afterOk = 0, maxYaw = 0, peakAlong = 0, contact = false;
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1], b = seg[i]; const dt = (b[0] - a[0]) / 1000; if (dt <= 0) continue;
      maxYaw = Math.max(maxYaw, yawDeg(r0, b));
      const v = toScreen(r0, b[1] - a[1], b[2] - a[2]);
      const sp = (side ? Math.abs(v.x) : Math.hypot(v.x, v.y)) / dt;
      const alongSp = (side ? v.x * u[0] : v.x * u[0] + v.y * u[1]) / dt;
      // After it got going the pressed way, a drop to under a third of its best speed that way is something in
      // the way (a wall it slides along, a ledge): contact, not the controls. The hold row judges curves.
      if (matchAt !== null && peakAlong > minSpeed * 2 && alongSp < peakAlong * 0.33) contact = true;
      if (contact || sp <= minSpeed) continue;
      const good = side ? Math.sign(v.x) === u[0] : angDeg(v, u) <= 30;
      if (good && matchAt === null) matchAt = Math.round(b[0] - p.a);
      if (matchAt !== null) { after += 1; if (good) afterOk += 1; peakAlong = Math.max(peakAlong, alongSp); }
    }
    const share = after ? afterOk / after : 0;
    if (maze && matchAt === null) {
      // No turn yet: queued behind a wall (fine) unless it moved against the pressed way, or it was a reversal.
      let against = false; let prevDir = null;
      for (let i = 1; i < seg.length; i++) {
        const a = seg[i - 1], b = seg[i]; const dt = (b[0] - a[0]) / 1000; if (dt <= 0) continue;
        const v = toScreen(r0, b[1] - a[1], b[2] - a[2]); const sp = Math.hypot(v.x, v.y) / dt;
        if (sp <= minSpeed) continue;
        if (prevDir === null) prevDir = v;
        if (angDeg(v, [-u[0], -u[1]]) <= 30 && i > seg.length / 3) against = true;
      }
      const reversal = prevDir && angDeg(prevDir, [-u[0], -u[1]]) <= 30;
      return { dir: p.dir, matchMs: null, afterShare: 0, yawDeg: +maxYaw.toFixed(1), blocked: !against && !reversal, queued: !against && !reversal, ok: false };
    }
    // A press that moved nothing at all ran into something (a wall, a platform edge): blocked, not wrong.
    const moved = seg.some((b, i) => i > 0 && b[0] > seg[i - 1][0] && ((side ? Math.abs(toScreen(r0, b[1] - seg[i - 1][1], b[2] - seg[i - 1][2]).x) : Math.hypot(toScreen(r0, b[1] - seg[i - 1][1], b[2] - seg[i - 1][2]).x, toScreen(r0, b[1] - seg[i - 1][1], b[2] - seg[i - 1][2]).y)) / ((b[0] - seg[i - 1][0]) / 1000)) > minSpeed);
    // In a maze a queued turn may happen later (when the opening arrives); only a reversal must answer in 600 ms.
    let limit = 600;
    if (maze) {
      const first = seg.find((b, i) => i > 0 && Math.hypot(toScreen(r0, b[1] - seg[i - 1][1], b[2] - seg[i - 1][2]).x, toScreen(r0, b[1] - seg[i - 1][1], b[2] - seg[i - 1][2]).y) > 0);
      const i0 = first ? seg.indexOf(first) : -1;
      const v0 = i0 > 0 ? toScreen(r0, seg[i0][1] - seg[i0 - 1][1], seg[i0][2] - seg[i0 - 1][2]) : null;
      if (!(v0 && angDeg(v0, [-u[0], -u[1]]) <= 30)) limit = Infinity;
    }
    return { dir: p.dir, matchMs: matchAt, afterShare: +share.toFixed(2), yawDeg: +maxYaw.toFixed(1), blocked: !moved, contact, ok: moved && matchAt !== null && matchAt < limit && share >= 0.8 && maxYaw < 10 };
  });
  const movedRows = out.filter((x) => !x.blocked);
  const passed = movedRows.filter((x) => x.ok).length;
  const blocked = out.length - movedRows.length;
  return { presses: out.length, blocked, passed, ok: movedRows.length >= Math.ceil(out.length * 0.7) && passed >= Math.ceil(movedRows.length * 0.9) && out.every((x) => x.yawDeg === undefined || x.yawDeg < 10), wrongWay: movedRows.filter((x) => !x.ok).map((x) => x.dir), rows: out };
}

/**
 * THE BIG SCREEN'S ROW, from what was read off it. `f`: { probe (the game's probe answered), seat, hasBody, qr (a
 * join QR is on the page), framesBefore, framesAfter, luma, loopback (the site is this computer's own address) }.
 *
 * The join QR is judged only where it can exist. The play page leaves the join card out on a loopback preview on
 * purpose (a code for 127.0.0.1 brings no other phone in), so there its absence is `qr: 'not applicable'`, said in
 * the row, and never a failure; on an address another phone can reach it is required. A local pass therefore says
 * nothing about the live QR: that is checked against the deployed site.
 */
export function judgeTv(f) {
  const qrRequired = !f.loopback;
  const drawing = (f.framesAfter ?? 0) > (f.framesBefore ?? 0);
  const why = !f.probe ? 'no game probe on the big screen'
    : f.seat !== null && f.seat !== undefined ? 'the big screen took a seat'
    : f.hasBody ? 'the big screen reports a body of its own'
    : qrRequired && !f.qr ? 'no join QR on the big screen'
    : !drawing ? 'the big screen is not drawing (its frame counter did not move)'
    : f.luma !== null && f.luma !== undefined && f.luma <= 6 ? 'the big screen picture is black'
    : undefined;
  return {
    ok: !why, why,
    qr: qrRequired ? Boolean(f.qr) : 'not applicable',
    ...(qrRequired ? {} : { qrNote: `the join QR was not checked: this is a loopback preview, where the page hides the join card on purpose${f.qr ? ' (one was on the page all the same)' : ''}. Check the big screen on the deployed address before release: there the QR is required` }),
  };
}

/* ------------------------------------------------------------------ browsers */

function descendants(pid) {
  const kids = (spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' }).stdout ?? '').split('\n').filter(Boolean).map(Number);
  return kids.flatMap((k) => [k, ...descendants(k)]);
}

async function chrome(puppeteer, kind, exe) {
  const dir = mkdtempSync(join(tmpdir(), 'homie-port-check-'));
  const vp = kind === 'phone' ? { width: 412, height: 915 } : kind === 'tv' ? { width: 1280, height: 720 } : { width: 1280, height: 800 };
  // 150 s for Chrome to start: on a loaded computer a cold start has taken over a minute.
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: dir, timeout: 150_000, protocolTimeout: 120_000, args: [...GPU, `--window-size=${vp.width},${vp.height}`] });
  const page = (await browser.pages())[0] ?? await browser.newPage();
  if (kind === 'phone') await page.emulate({ viewport: { ...vp, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }, userAgent: `${ANDROID_UA} ${TAG}` });
  else { await page.setViewport({ ...vp, deviceScaleFactor: 1 }); await page.setUserAgent(`${await browser.userAgent()} ${TAG}`); }
  const cdp = await page.createCDPSession();
  const h = {
    engine: 'chrome', kind, browser, page, vp, pid: browser.process()?.pid ?? null, errors: [], badResponses: [],
    touch: (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ ...p, radiusX: 11, radiusY: 11, force: 1 })) }),
    touchAll: true,
    async close() { await T(browser.close(), 10_000); try { browser.process()?.kill('SIGKILL'); } catch { /* gone */ } rmSync(dir, { recursive: true, force: true }); },
  };
  page.on('pageerror', (e) => h.errors.push(`pageerror: ${String(e?.message ?? e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') h.errors.push(`console: ${m.text().slice(0, 300)}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) h.badResponses.push(`${r.status()} ${r.url().slice(0, 160)}`); });
  return h;
}

async function webkit(pw) {
  const browser = await pw.webkit.launch({ headless: true, timeout: 150_000 });
  const dev = pw.devices['iPhone 15'];
  const ctx = await browser.newContext({ ...dev, userAgent: `${dev.userAgent} ${TAG}` });
  const page = await ctx.newPage();
  const impl = page._connection.toImpl(page);
  const sess = (impl.delegate ?? impl._delegate)._pageProxySession;
  const h = {
    engine: 'webkit', kind: 'phone', browser, page, vp: dev.viewport, pid: null, errors: [], badResponses: [],
    touch: (type, pts) => sess.send('Input.dispatchTouchEvent', { type, touchPoints: pts }),
    touchAll: false,
    async close() { await T(browser.close(), 10_000); },
  };
  page.on('pageerror', (e) => h.errors.push(`pageerror: ${String(e?.message ?? e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') h.errors.push(`console: ${m.text().slice(0, 300)}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) h.badResponses.push(`${r.status()} ${r.url().slice(0, 160)}`); });
  return h;
}

const frameOf = (h) => h.page.frames().find((f) => f.url().includes('/__game/')) ?? null;
async function inFrame(h, src, v = null) { const f = frameOf(h); return f ? T(f.evaluate(src), 10_000, v) : v; }
const shell = (h) => T(h.page.evaluate(() => { const s = window.__shell; return s ? { room: s.room, seat: s.seat, role: s.stats?.role ?? null, results: s.results ?? [], facts: s.facts ? { counts: s.facts.counts } : null } : null; }), 8000, null);
const info = (h) => inFrame(h, '(() => { const p = window.__homiePort; if (!p) return null; const i = p.info(); i.observedAt = performance.now(); const n = window.__homieNet; i.net = n ? { snapHzIn: n.stats().snapHzIn, snapHzOut: n.stats().snapHzOut, rtt: n.stats().rtt, promotions: n.stats().promotions } : null; i.hosted = n?.probe?.hosted?.() ?? null; i.tick = n?.probe?.tick?.() ?? null; i.v = p.view; i.size = p.size; i.keys = p.keys; i.thumb = p.thumb; return i; })()');
const rowsSince = (h, t) => inFrame(h, `(window.__homiePort ? window.__homiePort.rows(${Number(t) || 0}) : [])`, []);
const frameNow = (h) => inFrame(h, '(window.__homiePort ? window.__homiePort.now() : performance.now())', 0);

async function open(h, url) {
  await T(h.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }), 65_000);
  const t0 = Date.now();
  // Seated, probe up, and a body (or a board) on the probe.
  while (Date.now() - t0 < 60_000) {
    const s = await shell(h);
    const i = await info(h);
    if (s?.room && i && i.seat !== null && i.seat !== undefined && (i.frames ?? 0) > 5) {
      if (i.view === 'board' || (await rowsSince(h, 0)).some(finite)) return { ok: true, ms: Date.now() - t0, shell: s, info: i };
    }
    await sleep(300);
  }
  const s = await shell(h);
  return { ok: false, ms: Date.now() - t0, why: frameOf(h) ? 'the game never reported a body on window.__homiePort (call exposePort with self)' : 'no game frame', shell: s, info: await info(h) };
}

async function focusGame(h) {
  await T(h.page.evaluate(() => { const f = document.querySelector('iframe.game'); f?.focus(); try { f?.contentWindow?.focus(); } catch { /* opaque */ } }), 3000);
  await inFrame(h, '(() => { try { window.focus(); (document.querySelector("canvas") || document.body)?.focus?.(); } catch (e) {} return true; })()');
}

/* ------------------------------------------------------------------ input */

async function holdKey(h, code, ms, ready) { await h.page.keyboard.down(code); if (ready) await ready(); await sleep(ms); await h.page.keyboard.up(code); }

function thumbAt(h, i) { const t = i?.thumb ?? [0.24, 0.74]; return [Math.round(h.vp.width * t[0]), Math.round(h.vp.height * t[1])]; }
async function touchDrag(h, from, dir, reach, holdMs, ready) {
  const [x0, y0] = from; const u = DIRV[dir];
  await h.touch('touchStart', [{ id: 1, x: x0, y: y0 }]);
  for (let k = 1; k <= 8; k++) { await h.touch('touchMove', [{ id: 1, x: Math.round(x0 + (u[0] * reach * k) / 8), y: Math.round(y0 + (u[1] * reach * k) / 8) }]); await sleep(12); }
  if (ready) await ready();
  const end = Date.now() + holdMs;
  let w = 0;
  while (Date.now() < end) {
    w += 1;
    const wob = (w % 2 ? 1.5 : -1.5);
    await h.touch('touchMove', [{ id: 1, x: Math.round(x0 + u[0] * reach + (u[1] ? wob : 0)), y: Math.round(y0 + u[1] * reach + (u[0] ? wob : 0)) }]);
    await sleep(25);
  }
  await h.touch('touchEnd', h.touchAll ? [] : [{ id: 1, x: Math.round(x0 + u[0] * reach), y: Math.round(y0 + u[1] * reach) }]);
}
/** Timestamp real input delivery, then keep it held until four frames can judge its direction.
 * The response limit stays 600 ms; slow automation delivery and the thumb's ramp are not game latency. */
export async function measuredPress(h, how, code, from, dir) {
  await inFrame(h, `(() => {
    if (!window.__homieCheckInput) {
      const state = window.__homieCheckInput = {};
      addEventListener('keydown', e => { if (state.code === e.code && state.key === null) state.key = performance.now(); }, true);
      addEventListener('touchmove', () => { state.touch = performance.now(); }, { capture: true, passive: true });
    }
    Object.assign(window.__homieCheckInput, { code: ${JSON.stringify(code)}, key: null, touch: null });
  })()`);
  let a = null, b = null;
  const ready = async () => {
    a = await inFrame(h, `window.__homieCheckInput.${how === 'keys' ? 'key' : 'touch'}`);
    if (!Number.isFinite(a)) throw new Error('the game frame did not receive the measured input');
    await sleep(420);
    const until = Date.now() + 3000;
    while (Date.now() < until && (await rowsSince(h, a)).length < 4) await sleep(50);
    b = await frameNow(h);
  };
  if (how === 'keys') await holdKey(h, code, 0, ready);
  else await touchDrag(h, from, dir, 70, 0, ready);
  return { dir, a, b };
}

async function swipe(h, dir) {
  const x0 = Math.round(h.vp.width * 0.5); const y0 = Math.round(h.vp.height * 0.55); const u = DIRV[dir]; const reach = Math.round(Math.min(h.vp.width, h.vp.height) * 0.3);
  await h.touch('touchStart', [{ id: 2, x: x0, y: y0 }]);
  for (let k = 1; k <= 6; k++) { await h.touch('touchMove', [{ id: 2, x: Math.round(x0 + (u[0] * reach * k) / 6), y: Math.round(y0 + (u[1] * reach * k) / 6) }]); await sleep(16); }
  await h.touch('touchEnd', h.touchAll ? [] : [{ id: 2, x: Math.round(x0 + u[0] * reach), y: Math.round(y0 + u[1] * reach) }]);
}

/* ------------------------------------------------------------ the owner tests */

const UI_COVER = `(() => {
  const W = innerWidth, H = innerHeight, S = 8, gw = Math.ceil(W / S), gh = Math.ceil(H / S); const grid = new Uint8Array(gw * gh); const centre = [];
  const alpha = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return 0; const p = m[1].split(/[ ,\\/]+/).filter(Boolean); return p.length >= 4 ? parseFloat(p[3]) : 1; };
  const eff = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= parseFloat(cs.opacity); } return o; };
  let world = []; try { const sel = window.__homiePort && window.__homiePort.world; if (sel) world = [...document.querySelectorAll(sel)]; } catch (e) {}
  for (const el of document.querySelectorAll('body *')) {
    if (el.tagName === 'CANVAS' && el.getBoundingClientRect().width > 0.5 * W) continue;
    if (world.some((w) => w === el || w.contains(el))) continue;
    if (['SCRIPT', 'STYLE', 'IFRAME'].includes(el.tagName)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || r.left >= W || r.top >= H) continue;
    const cs = getComputedStyle(el); const bg = alpha(cs.backgroundColor); const img = cs.backgroundImage !== 'none';
    let text = false; for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) text = true;
    const border = parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > 0.04;
    if (!(bg > 0.04 || img || text || border || el.tagName === 'IMG' || el.tagName === 'svg')) continue;
    const o = eff(el); if (o < 0.05) continue;
    if (r.width * r.height > 0.4 * W * H && bg < 0.3 && !img) continue;
    const x0 = Math.max(0, Math.floor(r.left / S)), x1 = Math.min(gw, Math.ceil(r.right / S)), y0 = Math.max(0, Math.floor(r.top / S)), y1 = Math.min(gh, Math.ceil(r.bottom / S));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid[y * gw + x] = 1;
    if (r.right > W / 3 && r.left < 2 * W / 3 && r.bottom > H / 3 && r.top < 2 * H / 3 && (bg * o > 0.6 || img)) centre.push({ tag: el.tagName, cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
  }
  let n = 0; for (const v of grid) n += v;
  return { cover: +(n / grid.length).toFixed(3), opaqueCentre: centre.slice(0, 8) };
})()`;

async function ownerTests(h, how, log) {
  const i = await info(h);
  const view = i?.v ?? 'top';
  const size = Number(i?.size) || 1;
  const keys = i?.keys ?? { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  const out = { view, size, how };
  await focusGame(h);
  await sleep(600);
  if (view === 'board') {
    // Every press / swipe is the move the game applies.
    const seq = ['left', 'up', 'right', 'down', 'left', 'down', 'right', 'up', 'left', 'right'];
    const rows = [];
    for (const dir of seq) {
      const before = await info(h);
      if (how === 'keys') await holdKey(h, keys[dir], 60); else await swipe(h, dir);
      let after = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 1200) { after = await info(h); if ((after?.moves ?? 0) > (before?.moves ?? 0)) break; await sleep(60); }
      rows.push({ dir, applied: after?.lastMove ?? null, moved: (after?.moves ?? 0) > (before?.moves ?? 0), ms: Date.now() - t0 });
      await sleep(250);
    }
    const passed = rows.filter((r) => r.moved && r.applied === r.dir).length;
    out.board = { presses: rows.length, passed, rows };
    out.ok = passed >= Math.ceil(rows.length * 0.9);
    if (!out.ok) out.why = `${rows.length - passed} of ${rows.length} ${how === 'keys' ? 'key presses' : 'swipes'} were not applied as the pressed direction (probe lastMove/moves)`;
    return out;
  }
  const holds = view === 'side' ? ['right', 'left'] : ['down', 'left'];
  out.holds = [];
  for (const dir of holds) {
    const hold = async () => {
      const a = await frameNow(h);
      if (how === 'keys') await holdKey(h, keys[dir], 5000); else await touchDrag(h, thumbAt(h, i), dir, 70, 5000);
      const b = await frameNow(h);
      await sleep(250);
      return judgeHold(await rowsSince(h, a - 50), dir, a, b, size, view);
    };
    let res = await hold();
    if (needsRunway(res)) {
      const first = res;
      const away = { up: 'down', down: 'up', left: 'right', right: 'left' }[dir];
      log(`  ${h.engine}-${h.kind} ${how} hold ${dir}: ${first.why}; move ${away} and retry the same hold`);
      if (how === 'keys') await holdKey(h, keys[away], 1100); else await touchDrag(h, thumbAt(h, i), away, 70, 1100);
      await sleep(400);
      res = { ...await hold(), runwayRetry: first };
    }
    out.holds.push(res);
    log(`  ${h.engine}-${h.kind} ${how} hold ${dir}: ${res.ok ? 'ok' : `FAIL (${res.why})`} travel ${res.travelBodies} bodies, yaw ${res.yawChangeDeg}°`);
    await sleep(400);
  }
  // Back toward the middle before the alternating presses (the holds ended against a wall); not judged.
  for (const dir of view === 'side' ? ['right'] : ['up', 'right']) {
    if (how === 'keys') await holdKey(h, keys[dir], 1100); else await touchDrag(h, thumbAt(h, i), dir, 70, 1100);
  }
  await sleep(300);
  const alt = view === 'side' ? ['left', 'right'] : ['down', 'up', 'left', 'right'];
  const presses = [];
  const a0 = await frameNow(h);
  const until = Date.now() + 10_000;
  for (let k = 0; k < alt.length || Date.now() < until; k++) {
    const dir = alt[k % alt.length];
    presses.push(await measuredPress(h, how, keys[dir], thumbAt(h, i), dir));
    await sleep(170);
  }
  await sleep(200);
  out.alternate = judgePresses(await rowsSince(h, a0 - 50), presses, size, view);
  log(`  ${h.engine}-${h.kind} ${how} alternate: ${out.alternate.passed}/${out.alternate.presses - out.alternate.blocked} moving presses went the pressed way (${out.alternate.blocked} blocked)`);
  out.ok = out.holds.every((x) => x.ok) && out.alternate.ok;
  if (!out.ok) out.why = [...out.holds.filter((x) => !x.ok).map((x) => `hold ${x.dir}: ${x.why}`), out.alternate.ok ? null : `alternate: ${out.alternate.wrongWay.length} presses went the wrong way (${out.alternate.wrongWay.join(', ')}), ${out.alternate.blocked} of ${out.alternate.presses} moved nothing`].filter(Boolean).join('; ');
  return out;
}

/* ------------------------------------------------------------------ the check */

/** What a progress feed calls each port check row. */
export const PORT_CHECK_LABELS = {
  'owner-desk': 'Moves on a computer', 'owner-phone': 'Moves on a phone', 'owner-iphone': 'Moves on an iPhone (WebKit)',
  audio: 'Sound starts on the first touch', sandbox: 'Runs in the sandbox', 'ui-cover': 'UI stays out of the middle',
  round: 'Two browsers finish a round', 'host-kill': 'The host leaves, the round goes on', 'late-join': 'A late joiner takes a bot\'s seat',
  tv: 'The big screen watches', errors: 'No errors in the game',
};

/**
 * `report` (optional; the open progress feed, lib/progress.mjs) hears each row as it runs, passes or fails, gets a
 * small picture after each screenshot, and can ask the check to stop between rows. Without it nothing changes.
 */
export async function portCheck({ url, game, root, only = null, shots = null, log = () => {}, roundTimeoutMs = 240_000, report = null }) {
  if (!url || !game) throw new Error('usage: homie-studio port check <game> --url <site>');
  const base = String(url).replace(/\/+$/, '');
  const want = new Set((only ? String(only).split(',') : ALL).map((s) => s.trim()).filter(Boolean));
  const exe = findChrome();
  if (!exe) return { ok: false, command: 'port check', why: noChrome() };
  const req = createRequire(join(root ?? process.cwd(), 'package.json'));
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; } catch { try { puppeteer = req('puppeteer-core'); } catch { return { ok: false, command: 'port check', why: 'puppeteer-core is missing (it comes with @homie-rocks/studio: npm install)' }; } }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const out = shots ?? (root ? join(root, 'games', game, '.port', `check-${stamp}`) : mkdtempSync(join(tmpdir(), 'homie-port-check-out-')));
  mkdirSync(out, { recursive: true });
  if (root) { try { writeFileSync(join(root, 'games', game, '.port', '.gitignore'), '*\n'); } catch { /* fine */ } }
  const rows = [];
  const tell = (name, state, note) => { try { report?.check?.(name, state, { label: PORT_CHECK_LABELS[name] ?? name, ...(note ? { note } : {}) }); } catch { /* a feed never breaks a check */ } };
  const row = (name, ok, detail) => { rows.push({ name, ok, ...detail }); log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'} ${name}${detail?.why ? `: ${detail.why}` : ''}`); tell(name, ok === null ? 'skip' : ok ? 'pass' : 'fail', detail?.why); };
  const open_ = [];
  const launch = async (kind) => { const h = await chrome(puppeteer, kind, exe); open_.push(h); return h; };
  const close = async (h) => { const i = open_.indexOf(h); if (i >= 0) open_.splice(i, 1); await h.close(); };
  const shot = async (h, name) => {
    await T(h.page.screenshot({ path: join(out, `${name}.png`) }), 15_000);
    if (report?.preview && h.vp) {
      const b64 = await T(h.page.screenshot({ type: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: h.vp.width, height: h.vp.height, scale: Math.min(1, 480 / h.vp.width) }, encoding: 'base64' }), 15_000, null);
      // And a small PNG, kept as raw pixels beside the feed for Claude Code's Homie mod (lib/thumb.mjs).
      const png = b64 ? await T(h.page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: h.vp.width, height: h.vp.height, scale: Math.min(1, 160 / h.vp.width) } }), 15_000, null) : null;
      if (b64) { try { report.preview({ url: `${base}/${game}/play`, image: `data:image/jpeg;base64,${b64}`, caption: PORT_CHECK_LABELS[name.replace(/-(?:before|after|playing|over|\d+)$/, '')] ?? name, ...(png ? { png: Buffer.from(png) } : {}) }); } catch { /* too big: no picture */ } }
    }
  };
  const privateRoom = (tag) => `chk-${stamp.slice(-6)}-${tag}`.slice(0, 32);
  const errorsSeen = [];
  let stoppedAt = null;
  const collect = (h) => { for (const e of h.errors) errorsSeen.push(`${h.engine}-${h.kind}: ${e}`); for (const r of h.badResponses) errorsSeen.push(`${h.engine}-${h.kind}: HTTP ${r}`); };
  const started = Date.now();
  // The site must answer before each row: a dev server that died mid-check made every later row fail as "no game
  // frame", which reads like a broken game. Say what it is and stop.
  const alive = async () => {
    try { const r = await fetch(`${base}/${game}/play`, { signal: AbortSignal.timeout(8000) }); return r.ok; } catch { return false; }
  };
  const gate = async (name) => {
    if (report?.stopped?.()) { row(name, null, { why: 'stopped by the person' }); stoppedAt ??= name; return false; }
    tell(name, 'running');
    if (await alive()) return true;
    // Why, from this process's own preflight (lib/net.mjs): a public address this computer's Node cannot look up is
    // the network, with local testing offered; only this computer's own address is "is the dev server running?".
    const reach = await reachSite(base, { path: `/${game}/play`, timeout: 8000 });
    row(name, false, { why: !reach.ok && reach.preflight !== 'local' && reach.preflight !== 'site' ? `${reach.why} ${reach.instead ?? ''}`.trim() : `${base} stopped answering: is the dev server still running? (restart it as a background task that outlives this command, then rerun the check)` });
    return false;
  };
  if (!(await alive())) {
    // The same classification and sentence as check, perf and shoot (lib/net.mjs siteRefusal): a name this computer
    // cannot look up is BLOCKED with local testing offered, never "does not answer: start the site".
    const reach = await reachSite(base, { path: `/${game}/play`, timeout: 8000 });
    const refusal = siteRefusal(reach, { command: 'port check', play: `${base}/${game}/play` }) ?? { ok: false, command: 'port check', why: `${base}/${game}/play does not answer: start the site first (npm run dev, kept running in the background) or check the address` };
    const result = { ...refusal, game, url: base };
    writeFileSync(join(out, 'receipt.json'), `${JSON.stringify(result, null, 1)}\n`);
    return result;
  }
  try {
    /* ---- owner tests, a computer on keys (alone in a private room: bots only) */
    if (want.has('owner-desk') && await gate('owner-desk')) {
      try {
        const h = await launch('desk');
        const o = await open(h, `${base}/${game}/play?room=${privateRoom('desk')}&name=Check`);
        if (!o.ok) row('owner-desk', false, { why: o.why, seated: o });
        else {
          const res = await ownerTests(h, 'keys', log);
          const after = await info(h);
          await shot(h, 'desk-playing');
          const audio = after?.audio ?? null;
          row('owner-desk', res.ok, { ...res, seatedMs: o.ms, fps: after?.fps ?? null });
          if (audio) {
            const ctxs = audio.contexts ?? [];
            row('audio', ctxs.length ? ctxs.every((s) => s === 'running') : null, { contexts: ctxs, refusedMedia: audio.refusedMedia, why: ctxs.length ? (ctxs.every((s) => s === 'running') ? undefined : 'an AudioContext is still suspended after the first keys') : 'no Web Audio in this game (media elements only, or silent)' });
          }
          row('sandbox', true, { sandbox: after?.sandbox ?? null });
        }
        collect(h); await close(h);
      } catch (e) {
        row('owner-desk', false, { why: `the check itself hit an error: ${String(e?.message ?? e).split('\n')[0]}` });
        for (const h of [...open_]) { collect(h); await close(h).catch(() => {}); }
      }
    }

    /* ---- owner tests with real touch: Android Chrome, then iPhone WebKit */
    if (want.has('owner-phone') && await gate('owner-phone')) {
      try {
        const h = await launch('phone');
        const o = await open(h, `${base}/${game}/play?room=${privateRoom('phone')}&name=Thumb`);
        if (!o.ok) row('owner-phone', false, { why: o.why, seated: o });
        else {
          await sleep(800);
          const cover = await inFrame(h, UI_COVER);
          const res = await ownerTests(h, 'touch', log);
          const after = await info(h);
          await shot(h, 'phone-playing');
          row('owner-phone', res.ok, { ...res, seatedMs: o.ms, fps: after?.fps ?? null });
          row('ui-cover', cover ? cover.cover <= 0.12 && !cover.opaqueCentre.length : null, { ...(cover ?? {}), why: cover && (cover.cover > 0.12 || cover.opaqueCentre.length) ? `UI covers ${Math.round(cover.cover * 100)}% of a phone${cover.opaqueCentre.length ? ' and something opaque sits in the middle' : ''}` : undefined });
        }
        collect(h); await close(h);
      } catch (e) {
        row('owner-phone', false, { why: `the check itself hit an error: ${String(e?.message ?? e).split('\n')[0]}` });
        for (const h of [...open_]) { collect(h); await close(h).catch(() => {}); }
      }
    }
    if (want.has('owner-iphone') && await gate('owner-iphone')) {
      try {
        let pw = null;
        try { pw = req('playwright-core'); } catch { /* not installed */ }
        if (!pw) row('owner-iphone', null, { why: 'WebKit is not installed: npm i -D playwright-core@1.58.2 && npx playwright-core install webkit, then run the check again' });
        else {
          let h = null;
          try { h = await webkit(pw); open_.push(h); } catch (e) { row('owner-iphone', null, { why: `WebKit did not start (${String(e.message ?? e).split('\n')[0]}): npx playwright-core install webkit` }); }
          if (h) {
            const o = await open(h, `${base}/${game}/play?room=${privateRoom('iphone')}&name=Pocket`);
            if (!o.ok) row('owner-iphone', false, { why: o.why, seated: o });
            else {
              const res = await ownerTests(h, 'touch', log);
              const after = await info(h);
              await shot(h, 'iphone-playing');
              row('owner-iphone', res.ok, { ...res, seatedMs: o.ms, fps: after?.fps ?? null });
            }
            collect(h); await close(h);
          }
        }
      } catch (e) {
        row('owner-iphone', false, { why: `the check itself hit an error: ${String(e?.message ?? e).split('\n')[0]}` });
        for (const h of [...open_]) { collect(h); await close(h).catch(() => {}); }
      }
    }

    /* ---- two fresh browsers meet through the lobby and finish a round */
    if (want.has('round') && await gate('round')) {
      try {
        const A = await launch('desk');
        const B = await launch('phone');
        const [oa, ob] = [await open(A, `${base}/${game}/play?name=Desk`), await open(B, `${base}/${game}/play?name=Phone`)];
        if (!oa.ok || !ob.ok) row('round', false, { why: `a browser was never seated (${!oa.ok ? `computer: ${oa.why}` : ''} ${!ob.ok ? `phone: ${ob.why}` : ''})` });
        else if (oa.shell.room !== ob.shell.room) row('round', false, { why: `the two browsers landed in different rooms (${oa.shell.room}, ${ob.shell.room})` });
        else {
          const seats = [oa.shell.seat, ob.shell.seat];
          const bothAt = Date.now();
          const i0 = await info(A);
          const keys = i0?.keys ?? { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
          let over = null; let k = 0;
          await focusGame(A);
          await shot(A, 'round-desk'); await shot(B, 'round-phone');
          const deadline = Date.now() + roundTimeoutMs;
          while (Date.now() < deadline && !over) {
            const dir = ['right', 'down', 'left', 'up'][k++ % 4];
            if (i0?.v === 'board') { await holdKey(A, keys[dir], 60); await swipe(B, dir); await sleep(300); }
            else { await holdKey(A, keys[dir], 500); await touchDrag(B, thumbAt(B, i0), ['left', 'up', 'right', 'down'][k % 4], 60, 400); }
            const [sa, sb] = [await shell(A), await shell(B)];
            const hit = (s) => (s?.results ?? []).find((x) => x.at > bothAt && seats.every((seat) => x.results.some((r) => r.seat === seat)));
            const ha = hit(sa); const hb = hit(sb);
            if (ha && hb) over = { a: ha, b: hb };
          }
          await shot(A, 'round-over-desk'); await shot(B, 'round-over-phone');
          if (!over) row('round', false, { why: 'no round finished with both browsers in the results in time', room: oa.shell.room });
          else {
            const same = over.a.n === over.b.n && over.a.endsAt === over.b.endsAt;
            const humans = over.a.results.filter((r) => !r.bot).length;
            row('round', same && humans >= 2, { room: oa.shell.room, n: over.a.n, humans, bots: over.a.results.length - humans, results: over.a.results, seatedMs: [oa.ms, ob.ms], ms: Date.now() - bothAt, why: !same ? 'the two browsers saw different rounds' : humans < 2 ? 'the results do not list both people' : undefined });
          }
        }
        collect(A); collect(B); await close(A); await close(B);
      } catch (e) {
        row('round', false, { why: `the check itself hit an error: ${String(e?.message ?? e).split('\n')[0]}` });
        for (const h of [...open_]) { collect(h); await close(h).catch(() => {}); }
      }
    }

    /* ---- the host dies mid-round; then a late joiner takes a bot's place */
    if (want.has('life') && await gate('life')) {
      try {
        const room = privateRoom('life');
        const A = await launch('desk');
        const oa = await open(A, `${base}/${game}/play?room=${room}&name=Host`);
        const B = await launch('phone');
        const ob = await open(B, `${base}/${game}/play?room=${room}&name=Stays`);
        if (!oa.ok || !ob.ok) { row('host-kill', false, { why: 'a browser was never seated' }); row('late-join', null, { why: 'skipped: no room' }); collect(A); collect(B); await close(A); await close(B); }
        else {
          await sleep(3000);
          const ia = await info(A); let ib = await info(B);
          const serverHosted = ia?.hosted === 'server' && ib?.hosted === 'server';
          if (ia?.role !== 'host' && !serverHosted) row('host-kill', null, { why: `the first browser was not the host (it was ${ia?.role}); skipped`, ia: ia?.role, ib: ib?.role });
          else {
            await shot(B, 'life-before');
            // Screenshot encoding may span a round on a software renderer. Observe the room we actually leave.
            ib = await info(B);
            const pids = A.pid ? [A.pid, ...descendants(A.pid)] : [];
            const killAt = Date.now();
            for (const p of pids) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
            open_.splice(open_.indexOf(A), 1);
            collect(A);
            void A.close();
            let promoted = null; let ibAfter = null;
            while (Date.now() - killAt < 15_000) { ibAfter = await info(B); if (roomContinued(ib, ibAfter, serverHosted)) { promoted = Date.now() - killAt; break; } await sleep(100); }
            await sleep(1500);
            const ib2 = await info(B);
            const sameRound = ib?.round && ib2?.round && (ib2.round.n === ib.round.n || (ib.round.phase === 'over' || ib.round.leftMs < 3000));
            const clockOk = roundClockContinued(ib, ib2);
            const running = (ib2?.frames ?? 0) > (ibAfter?.frames ?? 0) && (ib2?.net?.snapHzOut ?? 0) >= 0;
            await shot(B, 'life-after-kill');
            row('host-kill', Boolean(promoted !== null && promoted <= 5000 && sameRound && clockOk && running), { hosted: serverHosted ? 'server' : 'browser', promotedMs: serverHosted ? null : promoted, continuedMs: serverHosted ? promoted : null, roundBefore: ib?.round ?? null, roundAfter: ib2?.round ?? null, why: promoted === null ? (serverHosted ? 'the server room stopped after a browser left' : 'nobody took over as host within 15 s') : promoted > 5000 ? `the phone took over after ${promoted} ms (over 5 s)` : !sameRound ? 'the round did not continue (a new round started)' : !clockOk ? 'the round clock jumped at the takeover' : undefined });
            // Late joiner into the same, running room.
            const C = await launch('desk');
            const joinAt = Date.now();
            const oc = await open(C, `${base}/${game}/play?room=${room}&name=Late`);
            await sleep(1500);
            const ic = await info(C); const ib3 = await info(B);
            const slots = ic?.slots ?? [];
            const humans = slots.filter((s) => !s.bot).length;
            const before = ib2?.slots ?? [];
            const tookBot = before.some((s) => s.bot) ? slots.length === before.length : true;
            const snapIn = ic?.net?.snapHzIn ?? 0;
            const clockSkew = ic?.round && ib3?.round ? Math.abs(ic.round.leftMs - ib3.round.leftMs) : null;
            // The joiner must steer its body at once, not only hold a seat: a short press moves it.
            let steers = null;
            if (ic?.v !== 'board' && oc.ok) {
              await focusGame(C);
              const keysC = ic?.keys ?? { right: 'ArrowRight', left: 'ArrowLeft' };
              const r0 = (await rowsSince(C, 0)).filter(finite).pop();
              await holdKey(C, keysC.right, 700);
              await holdKey(C, keysC.left, 700);
              const moved = (await rowsSince(C, 0)).filter(finite);
              const far = r0 ? Math.max(0, ...moved.map((r) => Math.hypot(r[1] - r0[1], r[2] - r0[2]))) : 0;
              steers = far > (Number(ic?.size) || 1) * 0.5;
            }
            await shot(C, 'late-joiner');
            const ok = oc.ok && ic?.seat !== null && ic?.round && ib3?.round && ic.round.n === ib3.round.n && humans >= 2 && tookBot && snapIn > 5 && (clockSkew === null || clockSkew < 2500) && steers !== false;
            row('late-join', Boolean(ok), { seatedMs: oc.ms, sinceJoinMs: Date.now() - joinAt, role: ic?.role, seat: ic?.seat, round: ic?.round, hostRound: ib3?.round, humans, bodies: slots.length, bodiesBefore: before.length, tookBot, steers, snapHzIn: snapIn, clockSkewMs: clockSkew,
              why: !oc.ok ? oc.why : ic?.round?.n !== ib3?.round?.n ? 'the late joiner is in a different round' : humans < 2 ? 'the late joiner is not one of the people in the roster' : !tookBot ? 'the late joiner added a body instead of taking a bot\'s place' : steers === false ? 'the late joiner has a seat but its keys do not move its body' : snapIn <= 5 ? 'no world is flowing to the late joiner' : clockSkew !== null && clockSkew >= 2500 ? `the late joiner's clock is ${clockSkew} ms off the host's` : undefined });
            collect(C); await close(C);
          }
          collect(B); await close(B);
          if (open_.includes(A)) { collect(A); await close(A); }
        }
      } catch (e) {
        row('host-kill', false, { why: `the check itself hit an error: ${String(e?.message ?? e).split('\n')[0]}` });
        for (const h of [...open_]) { collect(h); await close(h).catch(() => {}); }
      }
    }

    /* ---- the big screen */
    if (want.has('tv') && await gate('tv')) {
      try {
        const h = await launch('tv');
        await T(h.page.goto(`${base}/${game}/tv`, { waitUntil: 'domcontentloaded', timeout: 60_000 }), 65_000);
        let i = null; const t0 = Date.now();
        while (Date.now() - t0 < 30_000) { i = await info(h); if (i && (i.frames ?? 0) > 30) break; await sleep(400); }
        await sleep(2500);
        const i2 = await info(h);
        const s = await shell(h);
        const qr = await T(h.page.evaluate(() => Boolean(document.querySelector('[data-join] svg'))), 5000, false);
        const png = await T(h.page.screenshot({ path: join(out, 'tv.png') }), 15_000);
        const lum = png ? await lumaOf(h) : null;
        const me = (await rowsSince(h, 0)).some(finite);
        const tv = judgeTv({ probe: Boolean(i2 && s), seat: s?.seat ?? null, hasBody: me, qr, framesBefore: i?.frames ?? 0, framesAfter: i2?.frames ?? 0, luma: lum, loopback: isLoopbackUrl(base) });
        row('tv', tv.ok, { role: i2?.role, seat: s?.seat ?? null, hasBody: me, qr: tv.qr, ...(tv.qrNote ? { qrNote: tv.qrNote } : {}), frames: i2?.frames ?? null, luma: lum, why: tv.why });
        collect(h); await close(h);
      } catch (e) {
        row('tv', false, { why: `the check itself hit an error: ${String(e?.message ?? e).split('\n')[0]}` });
        for (const h of [...open_]) { collect(h); await close(h).catch(() => {}); }
      }
    }

    /* ---- errors across every browser */
    const fatal = errorsSeen.filter((e) => /pageerror/.test(e));
    row('errors', fatal.length === 0, { count: errorsSeen.length, fatal: fatal.slice(0, 12), other: errorsSeen.filter((e) => !/pageerror/.test(e)).slice(0, 12), why: fatal.length ? `${fatal.length} uncaught error(s) in the game` : undefined });
  } finally {
    for (const h of [...open_]) await h.close().catch(() => {});
  }
  const failed = rows.filter((r) => r.ok === false);
  const skipped = rows.filter((r) => r.ok === null);
  const result = { ok: failed.length === 0 && rows.length > 0 && !stoppedAt, command: 'port check', game, url: base, out, totalMs: Date.now() - started, ...(stoppedAt ? { stopped: true, why: `stopped by the person (before ${stoppedAt})` } : {}), passed: rows.filter((r) => r.ok === true).map((r) => r.name), failed: failed.map((r) => `${r.name}: ${r.why ?? 'failed'}`), skipped: skipped.map((r) => `${r.name}: ${r.why ?? ''}`), rows };
  writeFileSync(join(out, 'receipt.json'), `${JSON.stringify(result, null, 1)}\n`);
  return result;
}

/** Mean luma of the page as the screenshot sees it (0-255), from a small downscaled capture. */
async function lumaOf(h) {
  try {
    // The game's picture only: the left 60% and top 75%, away from the join card.
    const buf = await h.page.screenshot({ type: 'jpeg', quality: 40, clip: { x: 0, y: 0, width: Math.round(h.vp.width * 0.6), height: Math.round(h.vp.height * 0.75) }, encoding: 'base64' });
    return await h.page.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/jpeg;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 64, 36);
      const d = g.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return Math.round(s / (d.length / 4));
    }, buf);
  } catch { return null; }
}
