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
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROMES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The steps a progress feed shows for this check, in order. */
export const CHECK_STEPS = [
  ['computer-seated', 'A computer gets a seat'],
  ['phone-seated', 'A phone gets a seat'],
  ['same-room', 'Both in the same public room'],
  ['round', 'They finish a round together'],
];

class Stopped extends Error {}

export async function check({ url, game, roundTimeoutMs = 150_000, shots = null, userAgentTag = 'homie-studio-check', log = () => {}, report = null }) {
  if (!url || !game) throw new Error('usage: homie-studio check <game> --url <site url>');
  const chrome = CHROMES.find((p) => existsSync(p));
  if (!chrome) return { ok: false, command: 'check', why: 'no Chrome found (set CHROME_PATH)' };
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
        executablePath: chrome, headless: true, userDataDir: profile,
        args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check'],
      });
      browsers.push(browser);
      const page = await browser.newPage();
      await page.setViewport(kind.viewport);
      const ua = await browser.userAgent();
      await page.setUserAgent(`${ua} ${userAgentTag}`);
      const t0 = Date.now();
      await page.goto(play, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      players.push({ kind: kind.name, page, t0 });
      log(`${kind.name} opened ${play}`);
    }
    // Seated: the shell knows its room and the game reported a seat.
    const seated = await Promise.all(players.map(async (p) => {
      const deadline = Date.now() + 45_000;
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
      step(`${p.kind}-seated`, 'fail', { note: 'no seat within 45 s' });
      return null;
    }));
    if (seated.some((s) => !s)) return { ok: false, command: 'check', why: 'a browser never got a seat within 45 s', seated };
    const sameRoom = seated[0].room === seated[1].room;
    log(`seated: ${seated.map((s, i) => `${kinds[i].name} room ${s.room} seat ${s.seat} ${s.role}`).join('; ')}`);
    step('same-room', sameRoom ? 'pass' : 'fail', { note: sameRoom ? `room ${seated[0].room}` : `rooms ${seated[0].room} and ${seated[1].room}` });
    if (!sameRoom) return { ok: false, command: 'check', why: `the two browsers landed in different rooms (${seated[0].room}, ${seated[1].room})`, seated };
    step('round', 'running');
    // Play: the computer holds keys, the phone drags from the lower left.
    const playing = (async () => {
      const keys = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
      for (let i = 0; Date.now() - started < roundTimeoutMs && i < 400; i++) {
        const k = keys[i % keys.length];
        await players[0].page.keyboard.down(k).catch(() => {});
        await sleep(600);
        await players[0].page.keyboard.up(k).catch(() => {});
        const vp = kinds[1].viewport;
        await players[1].page.touchscreen.touchStart(vp.width * 0.2, vp.height * 0.8).catch(() => {});
        await players[1].page.touchscreen.touchMove(vp.width * 0.2 + (i % 2 ? 60 : -60), vp.height * 0.8 - 40).catch(() => {});
        await sleep(300);
        await players[1].page.touchscreen.touchEnd().catch(() => {});
        if (players.every((p) => p.over) || report?.stopped?.()) break;
      }
    })();
    if (shots) for (const [i, p] of players.entries()) await p.page.screenshot({ path: join(shots, `${kinds[i].name}-playing.png`) }).catch(() => {});
    await sleep(1500);
    await picture('Playing: computer and phone in one room');
    // Only a round that finishes AFTER both browsers were seated, with BOTH of them in its results, counts: an
    // idle room remembers its last round for a while, and that stale result proves nothing.
    const bothSeated = Math.max(...players.map((p) => p.seatedAt));
    const seats = players.map((p) => p.seat);
    const over = await Promise.all(players.map(async (p) => {
      const deadline = Date.now() + roundTimeoutMs;
      while (Date.now() < deadline) {
        const r = await p.page.evaluate((after, want) => {
          const s = window.__shell;
          const hit = (s?.results ?? []).find((x) => x.at > after && want.every((seat) => x.results.some((row) => row.seat === seat)));
          return hit ? { n: hit.n, endsAt: hit.endsAt, results: hit.results, room: s.room } : null;
        }, bothSeated, seats).catch(() => null);
        if (r) { p.over = true; return { ...r, ms: Date.now() - p.t0 }; }
        halt();
        await sleep(500);
      }
      return null;
    }));
    await playing.catch(() => {});
    if (shots) for (const [i, p] of players.entries()) await p.page.screenshot({ path: join(shots, `${kinds[i].name}-round-over.png`) }).catch(() => {});
    if (over.some((o) => !o)) { step('round', 'fail', { note: 'no round finished in time' }); return { ok: false, command: 'check', why: 'a browser did not see a round finish in time', seated, over }; }
    const humans = over[0].results.filter((r) => !r.bot).length;
    const sameRound = over[0].n === over[1].n && over[0].endsAt === over[1].endsAt && over[0].room === over[1].room;
    step('round', sameRound && humans >= 2 ? 'pass' : 'fail', { ms: Math.max(...over.map((o) => o.ms)), note: `round ${over[0].n}: ${humans} people, ${over[0].results.length - humans} bots` });
    await picture(`Round ${over[0].n} finished with both; the next one is on`);
    return {
      ok: sameRoom && sameRound && humans >= 2,
      command: 'check',
      play,
      room: seated[0].room,
      seats: seated.map((s, i) => ({ browser: kinds[i].name, seat: s.seat, role: s.role, seatedMs: s.ms })),
      round: { n: over[0].n, humans, bots: over[0].results.length - humans, results: over[0].results, overMs: over.map((o) => o.ms) },
      why: !sameRound ? 'the two browsers saw different rounds finish' : humans >= 2 ? undefined : `the round's results list ${humans} human(s); both browsers should be in it`,
      totalMs: Date.now() - started,
    };
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
    for (const [id] of CHECK_STEPS) { try { if (['pending', 'running'].includes(report?.state?.(id))) step(id, 'skip', { note: 'stopped' }); } catch { /* fine */ } }
    return { ok: false, command: 'check', stopped: true, why: 'stopped by the person', play, totalMs: Date.now() - started };
  } finally {
    for (const b of browsers) await b.close().catch(() => {});
    for (const p of profiles) rmSync(p, { recursive: true, force: true });
  }
}
