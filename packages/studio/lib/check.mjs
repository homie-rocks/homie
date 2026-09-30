/**
 * `homie-studio check <game> --url <site>` — the promise, measured: two fresh
 * browsers (separate Chrome processes and profiles, one a computer and one a
 * phone) press Play, land in the SAME public room, play, and both see the round
 * finish. Exit 0 only when all of that happened. Uses this Mac's Chrome through
 * puppeteer-core, on the GPU (a software renderer fakes a stuck game).
 *
 * `report` (optional; the open progress feed, lib/progress.mjs) hears each step as it goes green or red, gets a
 * small picture of the computer's view, and can ask the check to stop: then the browsers close and the result
 * says `stopped`. Without it the check is exactly what it was.
 *
 * UNDER LOAD (a busy computer, another project's browsers): Chrome gets 150 s to start, a page 90 s to open and a
 * seat 90 s. A browser that stalls for 10 s is let go by the relay and comes back with its seat token; the round it
 * was away for lists its body as a bot, so that round cannot prove anything and the check waits for the next one
 * (up to `rounds` rounds). A person the game lists as a bot while it keeps their seat (an idle player driven by
 * the game's autopilot) is still that person. When no round counts, the result says which seat was missing from
 * each finished round and whether that browser lost its connection, instead of only "no round finished".
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOFTWARE_GL, chromeArgs, findChrome, measureFrames, noChrome } from './chrome.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The steps a progress feed shows for this check, in order. */
/** Chrome's own start, on a loaded computer (a cold start there took over a minute). */
export const LAUNCH_TIMEOUT_MS = 150_000;

export const CHECK_STEPS = [
  ['computer-seated', 'A computer gets a seat'],
  ['phone-seated', 'A phone gets a seat'],
  ['same-room', 'Both in the same public room'],
  ['round', 'They finish a round together'],
];

class Stopped extends Error {}

/**
 * WHICH FINISHED ROUND PROVES THE TWO BROWSERS PLAYED TOGETHER. `browsers`: each `{ kind, seats, seen }`, where
 * `seats` is every seat it held (a Set) and `seen` the rounds it saw finish after both were seated (a Map from
 * `n:endsAt` to `{ n, endsAt, results, ms }`). A round counts when both saw it and each has a row carrying one of
 * its seats, whatever the row's `bot` says (a game may hand an idle person's body to its autopilot and still keep
 * their seat on the row: that is still the person). A round seen by both without one of them is a miss, kept in
 * `missed` with who was missing and the rows, so the check can say why. Returns the round that counts, or null.
 */
export function judgeRounds(browsers, missed = new Map()) {
  const mine = new Set(browsers.flatMap((b) => [...b.seats]));
  for (const [key, r] of browsers[0]?.seen ?? []) {
    if (missed.has(key) || !browsers.every((b) => b.seen.has(key))) continue;
    const absent = browsers.filter((b) => !(r.results ?? []).some((row) => b.seats.has(row?.seat))).map((b) => b.kind);
    if (!absent.length) return { ...r, key, overMs: browsers.map((b) => b.seen.get(key).ms), people: r.results.filter((row) => !row?.bot || mine.has(row?.seat)).length };
    missed.set(key, { n: r.n, missing: absent, rows: (r.results ?? []).slice(0, 12).map((row) => ({ seat: row?.seat ?? null, name: row?.name ?? null, bot: Boolean(row?.bot) })) });
  }
  return null;
}

export async function check({ url, game, roundTimeoutMs = 150_000, rounds = 3, shots = null, userAgentTag = 'homie-studio-check', log = () => {}, report = null }) {
  if (!url || !game) throw new Error('usage: homie-studio check <game> --url <site url>');
  const chrome = findChrome();
  if (!chrome) return { ok: false, command: 'check', why: noChrome() };
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; } catch { return { ok: false, command: 'check', why: 'puppeteer-core is not installed (it comes with @homie-rocks/studio; run npm install)' }; }
  const base = String(url).replace(/\/+$/, '');
  const play = `${base}/${game}/play`;
  if (shots) mkdirSync(shots, { recursive: true });
  const profiles = [];
  const browsers = [];
  const started = Date.now();
  const kinds = [
    { name: 'computer', viewport: { width: 1280, height: 800 } },
    { name: 'phone', viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ];
  const players = [];
  // The playing loop runs until this is false: the round is settled, or the check ends in any way (finally).
  let playingOn = true;
  const step = (id, state, opts = {}) => { try { report?.check?.(id, state, { label: CHECK_STEPS.find(([k]) => k === id)?.[1], ...opts }); } catch { /* a feed never breaks a check */ } };
  const halt = () => { if (report?.stopped?.()) throw new Stopped('stopped by the person'); };
  // The computer's view, small (480 px wide), for the feed's preview.
  const picture = async (caption) => {
    if (!report?.preview || !players[0]) return;
    try {
      const vp = kinds[0].viewport;
      const b64 = await players[0].page.screenshot({ type: 'jpeg', quality: 62, clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 480 / vp.width }, encoding: 'base64' });
      report.preview({ url: play, image: `data:image/jpeg;base64,${b64}`, caption });
    } catch { /* no picture this time */ }
  };
  for (const [id] of CHECK_STEPS) step(id, 'pending');
  try {
    halt();
    step('computer-seated', 'running');
    step('phone-seated', 'running');
    for (const kind of kinds) {
      const profile = mkdtempSync(join(tmpdir(), 'homie-studio-check-'));
      profiles.push(profile);
      const browser = await puppeteer.launch({
        executablePath: chrome, headless: true, userDataDir: profile, timeout: LAUNCH_TIMEOUT_MS, protocolTimeout: 180_000,
        args: [...chromeArgs(), '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check'],
      });
      browsers.push(browser);
      const page = await browser.newPage();
      await page.setViewport(kind.viewport);
      const ua = await browser.userAgent();
      await page.setUserAgent(`${ua} ${userAgentTag}`);
      const t0 = Date.now();
      await page.goto(play, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      players.push({ kind: kind.name, page, t0 });
      log(`${kind.name} opened ${play}`);
    }
    // Seated: the shell knows its room and the game reported a seat.
    const seated = await Promise.all(players.map(async (p) => {
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        const s = await p.page.evaluate(() => { const s = window.__shell; return s ? { room: s.room, seat: s.seat, role: s.stats?.role ?? null, players: s.facts?.counts?.players ?? null } : null; }).catch(() => null);
        if (s?.room && s.seat !== null && s.seat !== undefined && s.role) {
          p.seatedAt = Date.now(); p.seat = s.seat;
          step(`${p.kind}-seated`, 'pass', { ms: Date.now() - p.t0, note: `seat ${s.seat}, ${s.role}` });
          return { ...s, ms: Date.now() - p.t0 };
        }
        halt();
        await sleep(250);
      }
      step(`${p.kind}-seated`, 'fail', { note: 'no seat within 90 s' });
      return null;
    }));
    if (seated.some((s) => !s)) return { ok: false, command: 'check', why: 'a browser never got a seat within 90 s', seated };
    const sameRoom = seated[0].room === seated[1].room;
    log(`seated: ${seated.map((s, i) => `${kinds[i].name} room ${s.room} seat ${s.seat} ${s.role}`).join('; ')}`);
    step('same-room', sameRoom ? 'pass' : 'fail', { note: sameRoom ? `room ${seated[0].room}` : `rooms ${seated[0].room} and ${seated[1].room}` });
    if (!sameRoom) return { ok: false, command: 'check', why: `the two browsers landed in different rooms (${seated[0].room}, ${seated[1].room})`, seated };
    step('round', 'running');
    // Play: the computer holds keys; the phone drags from the lower left (a stick) and swipes across the bottom
    // middle (a wheel, a slider). A game that hands an untouched player to its autopilot, or lets an idle one go,
    // sees a hand on both. It plays until the check is over, through as many rounds as that takes.
    const playing = (async () => {
      const keys = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
      const vp = kinds[1].viewport;
      for (let i = 0; playingOn && i < 5000; i++) {
        const k = keys[i % keys.length];
        await players[0].page.keyboard.down(k).catch(() => {});
        await sleep(600);
        await players[0].page.keyboard.up(k).catch(() => {});
        const [x, y, dx, dy] = i % 3 === 2 ? [vp.width * 0.5, vp.height * 0.86, i % 2 ? 70 : -70, 0] : [vp.width * 0.2, vp.height * 0.8, i % 2 ? 60 : -60, -40];
        await players[1].page.touchscreen.touchStart(x, y).catch(() => {});
        await players[1].page.touchscreen.touchMove(x + dx, y + dy).catch(() => {});
        await sleep(300);
        await players[1].page.touchscreen.touchEnd().catch(() => {});
        if (report?.stopped?.()) break;
      }
    })();
    if (shots) for (const [i, p] of players.entries()) await p.page.screenshot({ path: join(shots, `${kinds[i].name}-playing.png`) }).catch(() => {});
    await sleep(1500);
    await picture('Playing: computer and phone in one room');
    // How fast each browser draws the game while it plays (reported, never judged: a VM without a GPU draws
    // with SwiftShader, which is not a person's frame rate).
    const frames = await Promise.all(players.map((p) => measureFrames(p.page)));
    const software = frames.some((f) => f.renderer && SOFTWARE_GL.test(f.renderer));
    const drawn = frames.map((f, i) => `${kinds[i].name} ${f.fps ?? '?'} fps`).join(', ');
    log(`drawing: ${drawn}${frames[0]?.renderer ? ` (${frames[0].renderer})` : ''}`);
    // Only a round that finishes AFTER both browsers were seated, seen by both, with BOTH of them in its results,
    // counts: an idle room remembers its last round for a while, and that stale result proves nothing. A browser is
    // in a round when a row carries a seat it held (a reconnect keeps its seat; a game may still mark an idle
    // person's row as a bot, and that is still the person). A round finished without one of them is a miss: its
    // cause is kept, and the check waits for the next round, up to `rounds` of them.
    const bothSeated = Math.max(...players.map((p) => p.seatedAt));
    for (const p of players) { p.seats = new Set([p.seat]); p.reconnects = null; p.reconnects0 = null; p.closed = null; p.seen = new Map(); }
    const t1 = Date.now();
    const budget = roundTimeoutMs * Math.max(1, rounds);
    const missed = new Map();
    let hit = null;
    while (!hit && Date.now() - t1 < budget && missed.size < Math.max(1, rounds)) {
      for (const p of players) {
        const s = await p.page.evaluate(() => {
          const sh = window.__shell;
          return sh ? { seat: sh.seat, room: sh.room, closed: sh.closed, reconnects: sh.stats?.reconnects ?? null, results: (sh.results ?? []).map((x) => ({ n: x.n, endsAt: x.endsAt, at: x.at, results: x.results })) } : null;
        }).catch(() => null);
        if (!s) continue;
        if (Number.isInteger(s.seat)) p.seats.add(s.seat);
        if (Number.isFinite(s.reconnects)) { p.reconnects0 ??= s.reconnects; p.reconnects = s.reconnects; }
        if (s.closed) p.closed = s.closed;
        for (const r of s.results) if (r.at > bothSeated && Array.isArray(r.results) && !p.seen.has(`${r.n}:${r.endsAt}`)) p.seen.set(`${r.n}:${r.endsAt}`, { ...r, room: s.room, ms: Date.now() - p.t0 });
      }
      const before = missed.size;
      hit = judgeRounds(players, missed);
      for (const m of [...missed.values()].slice(before)) log(`round ${m.n} finished without the ${m.missing.join(' and the ')}: waiting for the next one`);
      if (hit) break;
      halt();
      await sleep(700);
    }
    playingOn = false;
    await playing.catch(() => {});
    if (shots) for (const [i, p] of players.entries()) await p.page.screenshot({ path: join(shots, `${kinds[i].name}-round-over.png`) }).catch(() => {});
    const connection = players.map((p) => ({ browser: p.kind, seats: [...p.seats], reconnects: p.reconnects !== null && p.reconnects0 !== null ? p.reconnects - p.reconnects0 : null, closed: p.closed }));
    const load = { perCore: +(loadavg()[0] / Math.max(1, cpus().length)).toFixed(2), average: +loadavg()[0].toFixed(1), cores: cpus().length };
    if (!hit) {
      const misses = [...missed.values()];
      const dropped = connection.filter((c) => c.reconnects > 0).map((c) => `the ${c.browser} lost its connection ${c.reconnects} time${c.reconnects === 1 ? '' : 's'}`);
      const why = misses.length
        ? `${misses.length} round${misses.length === 1 ? '' : 's'} finished, and none had both browsers in it: ${misses.map((m) => `round ${m.n} left out the ${m.missing.join(' and the ')}`).join('; ')}.${dropped.length ? ` ${dropped.join(', ')} (a browser silent for 10 s is let go by the relay and its body plays as a bot until it is back).` : ' The game listed that seat\'s body as a bot with no seat: it may hand an idle player to a bot.'}${load.perCore > 1.5 ? ` This computer is busy (load ${load.average} on ${load.cores} cores): run the check again when it is quieter.` : ''}`
        : `no round finished within ${Math.round(budget / 1000)} s of both browsers being seated${load.perCore > 1.5 ? ` (this computer is busy: load ${load.average} on ${load.cores} cores)` : ''}`;
      step('round', 'fail', { note: misses.length ? `${misses.length} round(s) without both` : 'no round finished in time' });
      return { ok: false, command: 'check', why, play, room: seated[0].room, seated, missed: misses, connection, load, totalMs: Date.now() - started };
    }
    const humans = hit.people;
    step('round', humans >= 2 ? 'pass' : 'fail', { ms: Math.max(...hit.overMs), note: `round ${hit.n}: ${humans} people, ${hit.results.length - humans} bot${hit.results.length - humans === 1 ? '' : 's'}${missed.size ? ` (after ${missed.size} round(s) without both)` : ''}; ${drawn}${software ? ' (software GL: not measurable here)' : ''}` });
    await picture(`Round ${hit.n} finished with both; the next one is on`);
    return {
      ok: sameRoom && humans >= 2,
      command: 'check',
      play,
      room: seated[0].room,
      seats: seated.map((s, i) => ({ browser: kinds[i].name, seat: s.seat, role: s.role, seatedMs: s.ms })),
      round: { n: hit.n, humans, bots: hit.results.length - humans, results: hit.results, overMs: hit.overMs },
      ...(missed.size ? { missed: [...missed.values()] } : {}),
      connection,
      frames: frames.map((f, i) => ({ browser: kinds[i].name, fps: f.fps, renderer: f.renderer })),
      ...(software ? { software: 'This machine has no GPU (WebGL is SwiftShader): seats, rooms and rounds are measured; the frame rate is not a person\'s.' } : {}),
      why: humans >= 2 ? undefined : `the round's results list ${humans} person(s); both browsers should be in it`,
      totalMs: Date.now() - started,
    };
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
    for (const [id] of CHECK_STEPS) { try { if (['pending', 'running'].includes(report?.state?.(id))) step(id, 'skip', { note: 'stopped' }); } catch { /* fine */ } }
    return { ok: false, command: 'check', stopped: true, why: 'stopped by the person', play, totalMs: Date.now() - started };
  } finally {
    playingOn = false;
    for (const b of browsers) await b.close().catch(() => {});
    for (const p of profiles) rmSync(p, { recursive: true, force: true });
  }
}
