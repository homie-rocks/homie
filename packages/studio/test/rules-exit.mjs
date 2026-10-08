#!/usr/bin/env node
/**
 * rules-exit.mjs — the exit run for a server-hosted game, against a running site (not a test file: run it by hand).
 *
 *   node packages/studio/test/rules-exit.mjs --url http://127.0.0.1:8787 --game coin-dash [--minutes 2] [--bots 8]
 *
 * It does, from outside the room, what rooms-plan.md asks of slice 1 and can be done without Cloudflare itself:
 *
 *   1  two real browsers (headless Chrome, as `homie-studio check` drives them) land in one room and play. Neither is
 *      ever the host: the server is.
 *   2  a third player is a changed client: a socket that sends what only a host may say (a snapshot, a round with
 *      results, shared state, a roster) and input that claims a score and a teleport. Nothing it says may change
 *      what the two browsers see, the round's results, or its own body beyond the body's top speed.
 *   3  one browser's tab is closed mid-round. The other keeps receiving a tick every tick, and the round finishes.
 *   4  the round's results reach the browser that stayed, with every score the server's.
 *   5  `--bots` headless players for `--minutes`: the share of the room's ticks each received, and the gaps between
 *      snapshots, measured by the bots themselves (the room's own clock cannot time a tick from inside).
 *
 * Against a local site the numbers of step 5 say how the local runtime keeps a beat, and nothing about Cloudflare:
 * local objects share one process. The same command with a deployed site's address is the real measurement (T1).
 * Prints one JSON report; exits 1 when a step that must hold did not.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeArgs, findChrome, noChrome } from '../lib/chrome.mjs';
import { botClient, chaseCoins, socketUrl } from './bot-client.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const base = String(opt('--url', 'http://127.0.0.1:8787')).replace(/\/+$/, '');
const game = opt('--game', 'coin-dash');
const minutes = Number(opt('--minutes', '2'));
const botCount = Number(opt('--bots', '8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { url: base, game, at: new Date().toISOString(), steps: [] };
const step = (id, ok, facts) => { report.steps.push({ id, ok, ...facts }); process.stderr.write(`${ok ? 'PASS' : 'FAIL'} ${id}${facts?.note ? `: ${facts.note}` : ''}\n`); return ok; };

/** What a game's frame says of its room, read through the probes the view library publishes. */
const gameFrame = (page) => page.frames().find((f) => /\/__game\//.test(f.url())) ?? null;
const read = async (page) => {
  const f = gameFrame(page);
  if (!f) return null;
  return f.evaluate(() => {
    const n = window.__homieNet;
    if (!n) return null;
    const p = n.probe ?? {};
    const call = (name) => { try { return typeof p[name] === 'function' ? p[name]() : null; } catch { return null; } };
    return { role: n.role, seat: n.seat, host: n.host, link: n.link, status: call('status'), tick: call('tick'), score: call('score'), self: call('self'), scores: call('scores'), round: n.round, roster: n.roster, hosted: call('hosted') };
  }).catch(() => null);
};
const until = async (fn, ms, every = 250) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(every); } };

const room = `exit-${Date.now().toString(36)}`;
const chrome = findChrome();
if (!chrome) { process.stderr.write(`${noChrome()}\n`); process.exit(2); }
const puppeteer = (await import('puppeteer-core')).default;
const profiles = [];
const browsers = [];
let failed = false;
try {
  /* ---------------------------------------------------------------- 1: two browsers, one room, the server is host */
  const pages = [];
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]) {
    const profile = mkdtempSync(join(tmpdir(), 'homie-rules-exit-'));
    profiles.push(profile);
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: profile, args: [...chromeArgs(), '--no-first-run', '--no-default-browser-check'] });
    browsers.push(browser);
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.goto(`${base}/${game}/play?room=${room}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    pages.push(page);
  }
  const seated = await Promise.all(pages.map((p) => until(async () => { const s = await read(p); return s && s.status === 'playing' && Number.isInteger(s.seat) ? s : null; }, 60_000)));
  failed = !step('two-browsers-one-room', seated.every(Boolean) && seated[0].seat !== seated[1].seat, { note: seated.every(Boolean) ? `seats ${seated[0].seat} and ${seated[1].seat} in room ${room}` : 'a browser never reached "playing"' }) || failed;
  if (failed) throw new Error('no room to test');
  failed = !step('no-browser-hosts', seated.every((s) => s.role === 'replica' && s.host?.id === 'server' && s.hosted === 'server'), { note: `roles ${seated.map((s) => s.role).join(', ')}; host ${JSON.stringify(seated[0].host)}` }) || failed;
  // The computer holds right for a second: its own body goes at once, at the runner's speed and no faster.
  const a0 = await read(pages[0]);
  await pages[0].keyboard.down('KeyD');
  await sleep(1000);
  const a1 = await read(pages[0]);
  await pages[0].keyboard.up('KeyD');
  const ranM = a1.self.x - a0.self.x;
  failed = !step('own-body-answers-input', ranM > 3 && ranM < 7.5 && a1.tick > a0.tick, { note: `holding right for 1 s moved the computer's body ${ranM.toFixed(2)} m (the runner's speed is 6 m/s) while the room went from tick ${a0.tick} to ${a1.tick}` }) || failed;
  // Then both play: the computer holds keys in turn, the phone drags a thumb.
  let playing = true;
  const hands = (async () => {
    const keys = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
    for (let i = 0; playing; i += 1) {
      await pages[0].keyboard.down(keys[i % 4]).catch(() => {});
      await sleep(700);
      await pages[0].keyboard.up(keys[i % 4]).catch(() => {});
      if (!pages[1].isClosed()) { await pages[1].touchscreen.touchStart(80, 680).catch(() => {}); await pages[1].touchscreen.touchMove(80 + (i % 2 ? 60 : -60), 640).catch(() => {}); await sleep(250); await pages[1].touchscreen.touchEnd().catch(() => {}); }
    }
  })();

  /* ---------------------------------------------------------------- 2: a changed client */
  const url = await socketUrl(base, game, room);
  const mallory = botClient({ url, name: 'Mallory' });
  await mallory.ready;
  await until(() => mallory.me(), 5000);
  const mine = mallory.me();
  const forged = { n: 1, phase: 'over', startedAt: 0, endsAt: Date.now() + 5000, results: [{ slot: mallory.seat, seat: mallory.seat, name: 'Mallory', score: 999, bot: false, place: 1 }] };
  const before = { rounds: mallory.rounds.length, score: mine.fields[0] };
  for (let i = 0; i < 20; i += 1) {
    mallory.forge({ t: 'snap', k: mallory.snap.k + 100000, st: Date.now(), e: mallory.epoch, d: [[9, 0, 0], []], c: [] });
    mallory.forge({ t: 'round', round: forged });
    mallory.forge({ t: 'state', k: 'shared', d: [999] });
    mallory.forge({ t: 'state', k: 'scores', d: { [mallory.seat]: 999 } });
    mallory.forge({ t: 'roster', slots: [{ slot: mallory.seat, seat: mallory.seat, name: 'Mallory the Winner', bot: false }] });
    mallory.forge({ t: 'ckpt', k: 1, st: Date.now(), d: { scores: { [mallory.seat]: 999 } } });
    mallory.forge({ t: 'ev', k: 'fx', d: [mallory.snap.k, [[0, mine.id, []]]] });
    // Input that claims a score, and a place 40 m away: only the declared input fields and a speed-capped claim are read.
    mallory.forge({ t: 'in', e: mallory.epoch, k: mallory.snap.k + 2, s: [[0, 127, 127, mine.pos.x + 40, mine.pos.y + 40, 0, 900, 900, 0, 1, 0, 0, 999, 999, 999]], r: mine.r, score: 999, fields: [999], d: { score: 999 } });
    await sleep(50);
  }
  await sleep(500);
  const seen = await read(pages[0]);
  const after = mallory.me();
  const jump = Math.hypot(after.pos.x - mine.pos.x, after.pos.y - mine.pos.y);
  const cheated = [];
  if ((seen.scores ?? []).some((s) => s.score >= 999)) cheated.push('a browser shows a forged score');
  if (seen.round?.phase !== 'live' || (seen.round?.results ?? []).some((r) => r.score >= 999)) cheated.push('a browser took the forged round');
  if ((seen.roster ?? []).some((s) => /Winner/.test(s.name))) cheated.push('a browser took the forged roster');
  if (after.fields[0] >= 999 || after.fields[0] > before.score + 3) cheated.push(`the forger's score went from ${before.score} to ${after.fields[0]}`);
  if (jump > 6 * 1.6 + 1) cheated.push(`the forger's body jumped ${jump.toFixed(1)} m in 1.5 s`);
  if (mallory.rounds.length !== before.rounds) cheated.push('the forged round was echoed');
  failed = !step('forged-frames-change-nothing', cheated.length === 0, { note: cheated.length ? cheated.join('; ') : `160 forged frames; the forger's score stayed ${after.fields[0]}, its body moved ${jump.toFixed(2)} m (held to 6 m/s), the browsers' round is still live with no forged score, name or result`, tick: seen.tick }) || failed;

  /* ---------------------------------------------------------------- 3: one tab closes, the others carry on */
  const t0 = await read(pages[0]);
  await pages[1].close();
  await sleep(4000);
  const t1 = await read(pages[0]);
  const ran = t1.tick - t0.tick;
  failed = !step('closing-a-tab-interrupts-nobody', ran >= 70 && ran <= 90 && t1.status === 'playing', { note: `after the phone's tab closed the computer saw ${ran} ticks in 4 s and is ${t1.status}` }) || failed;

  /* ---------------------------------------------------------------- 4: the round finishes, with the server's results */
  const over = await until(async () => { const s = await read(pages[0]); return s?.round?.phase === 'over' && Array.isArray(s.round.results) ? s : null; }, 90_000, 500);
  playing = false;
  await hands;
  const results = over?.round?.results ?? [];
  const serverSays = mallory.rounds.at(-1)?.results ?? [];
  const same = JSON.stringify(results) === JSON.stringify(serverSays);
  failed = !step('round-finished-with-the-servers-results', Boolean(over) && results.length >= 4 && same && results.every((r) => r.score < 999), { note: over ? `round ${over.round.n}: ${results.map((r) => `${r.name} ${r.score}${r.bot ? ' (bot)' : ''}`).join(', ')}; the same list reached the browser and the socket` : 'no results within 90 s', results }) || failed;
  mallory.close();
  await pages[0].close();

  /* ---------------------------------------------------------------- 5: the room's beat, measured by headless players */
  if (botCount > 0 && minutes > 0) {
    const beatRoom = `beat-${Date.now().toString(36)}`;
    const beatUrl = await socketUrl(base, game, beatRoom);
    const bots = [];
    for (let i = 0; i < botCount; i += 1) { const b = botClient({ url: beatUrl, name: `Bot ${i + 1}`, steer: chaseCoins() }); await b.ready; bots.push(b); }
    process.stderr.write(`${botCount} headless players in room ${beatRoom} for ${minutes} min…\n`);
    await sleep(minutes * 60_000);
    const rows = bots.map((b) => b.report());
    for (const b of bots) b.close();
    const share = Math.min(...rows.map((r) => r.share));
    const under = Math.min(...rows.map((r) => r.gapsUnder));
    report.beat = { room: beatRoom, bots: botCount, minutes, worstShare: share, worstGapsUnder: under, worstP99: Math.max(...rows.map((r) => r.gapMs.p99)), rows };
    failed = !step('the-room-keeps-its-beat', share >= 0.995 && under >= 0.99, { note: `${botCount} players for ${minutes} min: each received at least ${(share * 100).toFixed(2)}% of the ticks due (the line is 99.5%), and at least ${(under * 100).toFixed(2)}% of snapshot gaps were under ${rows[0].limitMs} ms (the line is 99%); the worst 99th percentile gap was ${report.beat.worstP99} ms` }) || failed;
  }
} catch (error) {
  failed = true;
  report.error = String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ');
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  for (const p of profiles) rmSync(p, { recursive: true, force: true });
}
report.ok = !failed;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(failed ? 1 : 0);
