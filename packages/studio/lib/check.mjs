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
 *
 * THREE THINGS THAT ARE NOT THE SAME, each reported on its own:
 *   seated     the shell has a room, a seat and a role (`seats[].seatedMs`)
 *   ready      the play page's loading cover has lifted, so the game is what is on screen (`readiness[]`, from the
 *              page's `window.__shell.arrival`). A seated browser drawing 60 frames a second can still be showing
 *              "Loading the world…": the "playing" picture is only taken, and only named so, once the cover is gone.
 *   connected  the socket held from the seat to the results (`connection[]`, `uninterrupted`). A round that both
 *              browsers finished is `ok`; whether one of them reconnected on the way is said beside it, not folded in.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOFTWARE_GL, chromeArgs, findChrome, measureFrames, noChrome } from './chrome.mjs';
import { reachSite, siteRefusal } from './net.mjs';

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

/** How long a seated browser is given for its loading cover to lift (the shell lifts it itself 30 s after the page opened). */
export const READY_TIMEOUT_MS = 35_000;

/**
 * Is the game on screen? `arrival` is the play page's `window.__shell.arrival` ({ phase, liftedMs, by }) or null.
 *   ready: true   the cover lifted (`by`: 'game' when the game said it was playable, else the helper or the shell)
 *   ready: false  still covered after the wait: a picture taken now shows the loading card, not the game
 *   ready: null   this page reports no arrival state (an older shell, `?arrive=0`): not known, and said so
 */
export function arrivalReadiness(arrival, { waitedMs = null } = {}) {
  if (!arrival || typeof arrival !== 'object') return { ready: null, by: null, liftedMs: null, waitedMs, why: 'this page reports no arrival state: whether the game was on screen is not known' };
  if (arrival.phase === 'done') return { ready: true, by: arrival.by ?? null, liftedMs: Number.isFinite(arrival.liftedMs) ? arrival.liftedMs : null, waitedMs };
  return { ready: false, by: null, liftedMs: null, waitedMs, why: `the loading cover was still up${waitedMs !== null ? ` ${Math.round(waitedMs / 1000)} s after the seat` : ''}${arrival.step ? ` ("${String(arrival.step).slice(0, 60)}")` : ''}: seated and drawing is not ready` };
}

/*
 * THE LINK (netplay revision 9, NETPLAY.md section 22). The helper says where a browser stands with its room in one
 * word: `window.__homieNet.link` in the game's frame, and the play page keeps the last change it was told as
 * `window.__shell.link` = { state, why, hosting }. (`__shell.link` is ALSO the room's invite address, a string,
 * until the first change arrives: `linkOf` reads either and takes only a state it knows.)
 *
 * A browser that is `reconnecting`, `alone`, `offline` or `closed` is not in its room: whatever is sampled there (a
 * frame, a press, a round that "finished" on a browser hosting by itself) is not two people playing together, and
 * is labelled, never judged as play.
 */
export const LINK_STATES = ['connecting', 'online', 'reconnecting', 'alone', 'offline', 'closed'];
export const CUT_OFF = ['reconnecting', 'alone', 'offline', 'closed'];
/** The link's state from whatever a page gave (the helper's word, the shell's { state }), or null: not said. */
export function linkOf(v) {
  const state = typeof v === 'string' ? v : v && typeof v === 'object' ? v.state : null;
  return LINK_STATES.includes(state) ? state : null;
}

/**
 * The arrival's facts for a probe, from the play page's `window.__shell.arrival`: who was to say the game is
 * playable (`mode`: 'auto' the helper, 'game' the game itself, 'seat' an older helper), who gave it the screen
 * (`by`), when the cover lifted, and when the GAME ITSELF said it was ready (`explicitMs`, the page's clock; null:
 * it never did), with how long after an automatic lift that was (`lateMs`). Null when the page reports none.
 */
export function arrivalFacts(arrival) {
  if (!arrival || typeof arrival !== 'object') return null;
  const n = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  return { mode: ['auto', 'game', 'seat'].includes(arrival.mode) ? arrival.mode : null, by: typeof arrival.by === 'string' ? arrival.by : null, liftedMs: n(arrival.liftedMs), explicitMs: n(arrival.explicitMs), lateMs: n(arrival.lateMs) };
}

/**
 * Completion and connection, apart. `connection`: [{ browser, reconnects (null when the page did not say) }].
 * Returns { reconnects, uninterrupted: true | false | null, note }: one run establishes no cause either way.
 */
export function connectionSummary(connection) {
  const rows = Array.isArray(connection) ? connection : [];
  const dropped = rows.filter((c) => c.reconnects > 0);
  const unknown = rows.filter((c) => !Number.isFinite(c.reconnects));
  // The link states a browser was seen in besides `online` (`cutOff`): a browser seen knocking again or playing
  // alone was interrupted whether or not its counter moved (and when an older page reports no counter at all).
  const cut = rows.filter((c) => (c.cutOff ?? []).length && !(c.reconnects > 0));
  const cutNote = cut.map((c) => `the ${c.browser} was seen cut off from the room (${c.cutOff.join(', ')})`);
  if (dropped.length || cut.length) return { reconnects: dropped.length ? dropped.reduce((s, c) => s + c.reconnects, 0) : null, uninterrupted: false, note: `${[...dropped.map((c) => `the ${c.browser} reconnected ${c.reconnects} time${c.reconnects === 1 ? '' : 's'}${(c.cutOff ?? []).length ? ` (seen ${c.cutOff.join(', ')})` : ''}`), ...cutNote].join(', ')} during the check: the round finished, the connection did not hold throughout. Run it again; one run does not say why` };
  if (!rows.length || unknown.length) return { reconnects: null, uninterrupted: null, note: `reconnects were not reported${unknown.length ? ` by the ${unknown.map((c) => c.browser).join(' and the ')}` : ''}: whether the connection held is not known` };
  return { reconnects: 0, uninterrupted: true, note: 'no reconnects: both connections held from the seat to the results' };
}

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
  // One preflight from this process, in the same words as perf, shoot and port check (lib/net.mjs siteRefusal).
  // Nothing listening on this computer stops here. Anything else this process was told (a name it cannot look up,
  // no connection, an error answer) does NOT: a browser may still open a site Node.js cannot (its own DNS, a
  // firewall that answers a script and a browser differently), and this check drives browsers. If they cannot open
  // it either, that refusal (for a lookup: BLOCKED, this computer's network, local testing offered) is the report.
  const cannotAsk = siteRefusal(await reachSite(base, { path: `/${game}/play`, timeout: 15_000 }), { command: 'check', play });
  if (cannotAsk?.preflight === 'local') return cannotAsk;
  let appMeta = null;
  try { appMeta = (await (await fetch(`${base}/api/games`)).json()).games?.find((g) => g.id === game && g.kind === 'app'); } catch { /* browser preflight below still names failures */ }
  if (appMeta) return checkApp({ url: base, game, meta: appMeta, shots, log, report, puppeteer, chrome });
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
      // And a small PNG, kept as raw pixels beside the feed for Claude Code's Homie mod (lib/thumb.mjs).
      const png = await players[0].page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 160 / vp.width } }).catch(() => null);
      report.preview({ url: play, image: `data:image/jpeg;base64,${b64}`, caption, ...(png ? { png: Buffer.from(png) } : {}) });
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
      try { await page.goto(play, { waitUntil: 'domcontentloaded', timeout: 90_000 }); } catch (error) {
        if (cannotAsk) return { ...cannotAsk, play, why: `${cannotAsk.why} (The ${kind.name} browser could not open it either: ${String(error?.message ?? error).split('\n')[0].slice(0, 120)}.)` };
        throw error;
      }
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
    // Ready is not seated: wait for each page's loading cover to lift before the picture called "playing". A browser
    // still covered when the wait ends gets its picture under another name (-loading.png), so nobody reads a loading
    // card as gameplay, and `readiness` says so. The check's verdict stays about seats and the round.
    const readiness = await Promise.all(players.map(async (p, i) => {
      const t = Date.now(); let arrival = null;
      const read = () => p.page.evaluate(() => { const a = window.__shell?.arrival; return a ? { phase: a.phase, step: a.step, liftedMs: a.liftedMs, by: a.by } : null; }).catch(() => null);
      while (Date.now() - t < READY_TIMEOUT_MS) {
        arrival = await read();
        if (!arrival || arrival.phase === 'done') break;
        if (report?.stopped?.()) break;
        await sleep(250);
      }
      const r = { browser: kinds[i].name, ...arrivalReadiness(arrival, { waitedMs: Date.now() - t }) };
      if (shots) { r.shot = `${kinds[i].name}-${r.ready === false ? 'loading' : 'playing'}.png`; await p.page.screenshot({ path: join(shots, r.shot) }).catch(() => { r.shot = null; }); }
      if (r.ready === false) log(`${kinds[i].name}: ${r.why}`);
      return r;
    }));
    halt();
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
    for (const p of players) { p.seats = new Set([p.seat]); p.reconnects = null; p.reconnects0 = null; p.closed = null; p.seen = new Map(); p.cutOff = new Set(); }
    const t1 = Date.now();
    const budget = roundTimeoutMs * Math.max(1, rounds);
    const missed = new Map();
    let hit = null;
    while (!hit && Date.now() - t1 < budget && missed.size < Math.max(1, rounds)) {
      for (const p of players) {
        const s = await p.page.evaluate(() => {
          const sh = window.__shell;
          return sh ? { seat: sh.seat, room: sh.room, closed: sh.closed, reconnects: sh.stats?.reconnects ?? null, link: sh.link ?? null, results: (sh.results ?? []).map((x) => ({ n: x.n, endsAt: x.endsAt, at: x.at, results: x.results })) } : null;
        }).catch(() => null);
        if (!s) continue;
        if (Number.isInteger(s.seat)) p.seats.add(s.seat);
        if (Number.isFinite(s.reconnects)) { p.reconnects0 ??= s.reconnects; p.reconnects = s.reconnects; }
        if (s.closed) p.closed = s.closed;
        // Where it stands with its room right now (the helper's link, as the page was told): anything but in the room is kept.
        if (CUT_OFF.includes(linkOf(s.link))) p.cutOff.add(linkOf(s.link));
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
    const connection = players.map((p) => ({ browser: p.kind, seats: [...p.seats], reconnects: p.reconnects !== null && p.reconnects0 !== null ? p.reconnects - p.reconnects0 : null, closed: p.closed, ...(p.cutOff.size ? { cutOff: [...p.cutOff] } : {}) }));
    const load = { perCore: +(loadavg()[0] / Math.max(1, cpus().length)).toFixed(2), average: +loadavg()[0].toFixed(1), cores: cpus().length };
    if (!hit) {
      const misses = [...missed.values()];
      const dropped = connection.filter((c) => c.reconnects > 0 || c.cutOff).map((c) => (c.reconnects > 0 ? `the ${c.browser} lost its connection ${c.reconnects} time${c.reconnects === 1 ? '' : 's'}${c.cutOff ? ` (seen ${c.cutOff.join(', ')})` : ''}` : `the ${c.browser} was seen cut off from the room (${c.cutOff.join(', ')})`));
      const why = misses.length
        ? `${misses.length} round${misses.length === 1 ? '' : 's'} finished, and none had both browsers in it: ${misses.map((m) => `round ${m.n} left out the ${m.missing.join(' and the ')}`).join('; ')}.${dropped.length ? ` ${dropped.join(', ')} (a browser silent for 10 s is let go by the relay and its body plays as a bot until it is back).` : ' The game listed that seat\'s body as a bot with no seat: it may hand an idle player to a bot.'}${load.perCore > 1.5 ? ` This computer is busy (load ${load.average} on ${load.cores} cores): run the check again when it is quieter.` : ''}`
        : `no round finished within ${Math.round(budget / 1000)} s of both browsers being seated${load.perCore > 1.5 ? ` (this computer is busy: load ${load.average} on ${load.cores} cores)` : ''}`;
      step('round', 'fail', { note: misses.length ? `${misses.length} round(s) without both` : 'no round finished in time' });
      return { ok: false, command: 'check', why, play, room: seated[0].room, seated, readiness, missed: misses, connection, ...connectionSummary(connection), load, totalMs: Date.now() - started };
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
      readiness,
      connection,
      // Completion (ok) and connection, apart: `uninterrupted` is false when a browser reconnected on the way.
      ...connectionSummary(connection),
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

/** Apps prove a real action crossing surfaces and a reconnect, without inventing a round. */
export async function checkApp({ url, game, meta, shots = null, log = () => {}, report = null, puppeteer, chrome }) {
  const proof = meta.check;
  if (!proof || typeof proof.action !== 'string' || typeof proof.observe !== 'string') return { ok: false, command: 'check', kind: 'app', why: 'app.json check needs action and observe CSS selectors for a real shared action' };
  if (shots) mkdirSync(shots, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'homie-app-check-'));
  let browser;
  const surfaces = [];
  const room = `check-${Date.now().toString(36)}`;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: profile, timeout: LAUNCH_TIMEOUT_MS, args: chromeArgs() });
    for (const [name, width, height, path] of [['wall', 1280, 720, 'tv'], ['phone', 390, 844, 'open'], ['phone-two', 390, 844, 'open']]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width, height, isMobile: name !== 'wall', hasTouch: name !== 'wall' });
      await page.goto(`${url}/${game}/${path}?room=${room}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.waitForFunction(() => window.__shell?.link?.state === 'online', { timeout: 90_000 });
      const frame = page.frames().find((f) => /\/__game\//.test(f.url()));
      if (!frame) throw new Error(`${name} never loaded the app`);
      await frame.waitForSelector(proof.observe, { timeout: 30_000 });
      surfaces.push({ name, page, frame });
      log(`${name} connected to ${room}`);
    }
    const textOf = (f) => f.$eval(proof.observe, (e) => e.textContent);
    const actor = surfaces[1];
    await actor.frame.waitForFunction((selector) => { const el = document.querySelector(selector); return el && !el.disabled && !el.hidden; }, {}, proof.action);
    const before = await textOf(actor.frame);
    await actor.frame.click(proof.action);
    await actor.frame.waitForFunction((selector, was) => document.querySelector(selector)?.textContent !== was, {}, proof.observe, before);
    const after = await textOf(actor.frame);
    for (const s of surfaces) await s.frame.waitForFunction((selector, wanted) => document.querySelector(selector)?.textContent === wanted, {}, proof.observe, after);
    // The actor reloads with its ticket and room. The other screens remain live.
    await actor.page.reload({ waitUntil: 'domcontentloaded' });
    await actor.page.waitForFunction(() => window.__shell?.link?.state === 'online', { timeout: 90_000 });
    actor.frame = actor.page.frames().find((f) => /\/__game\//.test(f.url()));
    await actor.frame.waitForFunction((selector, wanted) => document.querySelector(selector)?.textContent === wanted, {}, proof.observe, after);
    const rooms = await Promise.all(surfaces.map((s) => s.page.evaluate(() => window.__shell.room)));
    if (rooms.some((r) => r !== room)) throw new Error('surfaces did not retain the same room');
    if (shots) for (const s of surfaces) await s.page.screenshot({ path: join(shots, `${s.name}.jpg`), type: 'jpeg', quality: 65 });
    report?.check?.('app-action', 'pass', { note: 'action reached wall and both phones; reconnect retained it' });
    return { ok: true, command: 'check', kind: 'app', room, surfaces: surfaces.map((s) => s.name), action: proof.action, before, after, reconnect: true };
  } catch (error) { return { ok: false, command: 'check', kind: 'app', why: error.message }; }
  finally { await browser?.close().catch(() => {}); rmSync(profile, { recursive: true, force: true }); }
}
