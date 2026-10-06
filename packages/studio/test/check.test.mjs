/**
 * @homie-rocks/studio 0.9.0: which finished round `homie-studio check` counts, when a busy computer drops a
 * browser or a game hands an idle person to its autopilot (a racing game's first two-browser check on a busy
 * computer: both browsers seated in one room, and no round ever had both of them in its results).
 *
 *   - a round counts when both browsers saw it and each has a row with a seat it held, whatever the row's `bot`
 *     says: a person the game drives for them is still that person;
 *   - a round without one of them is a miss, kept with who was missing, and the check waits for the next;
 *   - a round only one browser saw proves nothing yet.
 * The browsers themselves need Chrome (`homie-studio check` against `homie-studio dev`); this is the judgement.
 * Run: node --test packages/studio/test/check.test.mjs
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECK_STEPS, LAUNCH_TIMEOUT_MS, arrivalReadiness, connectionSummary, judgeRounds } from '../lib/check.mjs';
import { isLoopbackUrl } from '../lib/chrome.mjs';
import { judgeTv } from '../lib/port-check.mjs';

const round = (n, rows) => ({ n, endsAt: 1000 * n, results: rows, ms: 5000 * n });
const seen = (...rounds) => new Map(rounds.map((r) => [`${r.n}:${r.endsAt}`, r]));
const bots = (k) => Array.from({ length: k }, (_, i) => ({ slot: 10 + i, seat: null, name: `Bot ${i}`, bot: true, score: 0 }));

test('a round with both seats counts, even when the game lists an idle person as a bot', () => {
  const r1 = round(1, [{ slot: 0, seat: 0, name: 'Brass Badger', bot: false }, { slot: 5, seat: 1, name: 'Cosmic Pilot', bot: true }, ...bots(6)]);
  const hit = judgeRounds([{ kind: 'computer', seats: new Set([0]), seen: seen(r1) }, { kind: 'phone', seats: new Set([1]), seen: seen(r1) }]);
  assert.equal(hit.n, 1);
  assert.equal(hit.people, 2, 'the phone\'s row keeps its seat: that is the person, driven by the game\'s autopilot');
  assert.deepEqual(hit.overMs, [5000, 5000]);
});

test('a round without one of them is a miss with its reason, and the next round with both counts', () => {
  // Round 1: the phone was let go (its body a bot, no seat on its row). Round 2: it is back, on the same seat.
  const r1 = round(1, [{ slot: 0, seat: 0, bot: false }, { slot: 5, seat: null, name: 'Racer 5', bot: true }, ...bots(6)]);
  const r2 = round(2, [{ slot: 5, seat: 1, bot: false }, { slot: 0, seat: 0, bot: false }, ...bots(6)]);
  const missed = new Map();
  const phone = { kind: 'phone', seats: new Set([1]), seen: seen(r1) };
  const computer = { kind: 'computer', seats: new Set([0]), seen: seen(r1) };
  assert.equal(judgeRounds([computer, phone], missed), null);
  assert.deepEqual([...missed.values()].map((m) => [m.n, m.missing]), [[1, ['phone']]]);
  assert.deepEqual(missed.get('1:1000').rows[1], { seat: null, name: 'Racer 5', bot: true }, 'what the round listed, for the report');
  computer.seen = seen(r1, r2);
  assert.equal(judgeRounds([computer, phone], missed), null, 'a round only the computer has seen yet proves nothing');
  phone.seen = seen(r1, r2);
  const hit = judgeRounds([computer, phone], missed);
  assert.equal(hit.n, 2);
  assert.equal(hit.people, 2);
  assert.equal(missed.size, 1, 'the miss is judged once');
});

test('a browser that came back on another seat is still in the round', () => {
  const r = round(3, [{ slot: 0, seat: 0, bot: false }, { slot: 2, seat: 4, bot: false }, ...bots(2)]);
  const hit = judgeRounds([{ kind: 'computer', seats: new Set([0]), seen: seen(r) }, { kind: 'phone', seats: new Set([1, 4]), seen: seen(r) }]);
  assert.equal(hit?.n, 3);
});

test('load tolerance: Chrome gets 150 s to start; the steps a progress feed shows are unchanged', () => {
  assert.equal(LAUNCH_TIMEOUT_MS, 150_000);
  assert.deepEqual(CHECK_STEPS.map(([id]) => id), ['computer-seated', 'phone-seated', 'same-room', 'round']);
});

test('seated is not ready: a browser still behind the loading cover is said to be, and an unknown is not a yes', () => {
  // The fault: the check has a seat and 60 frames a second while the page still says "Loading the world…".
  const covered = arrivalReadiness({ phase: 'game', step: 'Loading the world…', liftedMs: null, by: null }, { waitedMs: 35_000 });
  assert.equal(covered.ready, false);
  assert.match(covered.why, /loading cover was still up 35 s after the seat \("Loading the world…"\)/);
  assert.match(covered.why, /seated and drawing is not ready/);
  assert.deepEqual(arrivalReadiness({ phase: 'done', liftedMs: 2140, by: 'game' }, { waitedMs: 900 }), { ready: true, by: 'game', liftedMs: 2140, waitedMs: 900 });
  // A page with no arrival state (an older shell, ?arrive=0): not known, which is neither ready nor not.
  const unknown = arrivalReadiness(null);
  assert.equal(unknown.ready, null);
  assert.match(unknown.why, /not known/);
});

test('a finished round says whether the connection held: reconnects beside completion, unknown never read as held', () => {
  // The fault: ok=true with one phone reconnect on the way, visible only in the receipt.
  const s = connectionSummary([{ browser: 'computer', reconnects: 0 }, { browser: 'phone', reconnects: 1 }]);
  assert.deepEqual([s.reconnects, s.uninterrupted], [1, false]);
  assert.match(s.note, /the phone reconnected 1 time during the check: the round finished, the connection did not hold throughout/);
  assert.match(s.note, /one run does not say why/);
  assert.deepEqual((({ reconnects, uninterrupted }) => [reconnects, uninterrupted])(connectionSummary([{ browser: 'computer', reconnects: 0 }, { browser: 'phone', reconnects: 0 }])), [0, true]);
  assert.equal(connectionSummary([{ browser: 'computer', reconnects: null }, { browser: 'phone', reconnects: 0 }]).uninterrupted, null);
  assert.equal(connectionSummary([]).uninterrupted, null);
});

test('the big screen: a join QR is not applicable on a loopback preview and required on a reachable address', () => {
  for (const u of ['http://127.0.0.1:8787', 'http://localhost:8787/', 'http://studio.localhost:8787', 'http://[::1]:8787']) assert.equal(isLoopbackUrl(u), true, u);
  for (const u of ['https://studio.example', 'http://192.168.1.20:8787', 'nonsense']) assert.equal(isLoopbackUrl(u), false, u);
  const screen = { probe: true, seat: null, hasBody: false, qr: false, framesBefore: 40, framesAfter: 190, luma: 60 };
  // The fault: a local preview, where the page leaves the join card out on purpose.
  const local = judgeTv({ ...screen, loopback: true });
  assert.equal(local.ok, true);
  assert.equal(local.qr, 'not applicable');
  assert.match(local.qrNote, /loopback preview/);
  assert.match(local.qrNote, /deployed address before release: there the QR is required/);
  // The same screen on an address a phone can reach: the QR is owed.
  const live = judgeTv({ ...screen, loopback: false });
  assert.deepEqual([live.ok, live.why, live.qr], [false, 'no join QR on the big screen', false]);
  assert.deepEqual((({ ok, qr }) => [ok, qr])(judgeTv({ ...screen, qr: true, loopback: false })), [true, true]);
  // Everything else the row checks still fails a local preview.
  assert.equal(judgeTv({ ...screen, loopback: true, seat: 2 }).why, 'the big screen took a seat');
  assert.equal(judgeTv({ ...screen, loopback: true, hasBody: true }).why, 'the big screen reports a body of its own');
  assert.equal(judgeTv({ ...screen, loopback: true, luma: 2 }).why, 'the big screen picture is black');
  assert.match(judgeTv({ ...screen, loopback: true, framesAfter: 40 }).why, /not drawing/);
});

test('nothing listening on this computer: check and shoot say "does not answer: start the site" before any browser opens, in perf\'s and port check\'s words', async (t) => {
  const { check } = await import('../lib/check.mjs');
  const { shoot } = await import('../lib/shoot.mjs');
  const { reachSite, siteRefusal } = await import('../lib/net.mjs');
  // Port 9 (discard) on this computer: nothing answers there.
  const base = 'http://127.0.0.1:9';
  const said = siteRefusal(await reachSite(base, { path: '/gem/play' }), { command: 'check', play: `${base}/gem/play` });
  assert.equal(said.preflight, 'local');
  const started = Date.now();
  const c = await check({ url: base, game: 'gem' });
  if (/no Chrome|puppeteer-core/i.test(c.why ?? '')) { t.skip('no Chrome on this machine: the preflight is never reached'); return; }
  assert.deepEqual([c.ok, c.command, c.preflight, c.why], [false, 'check', 'local', said.why]);
  assert.match(c.why, /^http:\/\/127\.0\.0\.1:9\/gem\/play does not answer: start the site \(npm run dev, as a background task that outlives this command\) or check the address$/);
  const s = await shoot({ url: base, game: 'gem', frames: 1, out: join(tmpdir(), 'homie-shoot-never') });
  assert.deepEqual([s.ok, s.command, s.preflight, s.why], [false, 'shoot', 'local', said.why]);
  assert.ok(Date.now() - started < 30_000, 'said at once: no browser was started to find it out');
});
