/**
 * The playtest skill: its pixel measures on pictures whose answers are known (black, flat, busy, a
 * hole where nothing drew, a panel over the middle), the video skill's delivery QA on files whose
 * faults are known, and the blind-review brief made from a run's report. A full run against a live
 * studio is `node playtest.mjs run <game> --url <site>` (it needs a running site and Chrome); set
 * HOMIE_PLAYTEST_URL=<site> and HOMIE_PLAYTEST_STUDIO=<studio folder> to include one here.
 * Run: node --test plugins/homie/test/playtest.test.mjs   (needs ffmpeg)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { actionProfile, connectionNote, contextOf, judgeFirst, judgeMove, judgeScores, judgeUi, pairMismatch, readinessOf, renderCost, reportMd, reviewLine, stateOf, weakest, UI_CAVEAT } from '../skills/playtest/scripts/lib/judge.mjs';
import { decode, motion, stats, uiCover } from '../skills/playtest/scripts/lib/pixels.mjs';
import { DNS_CODES, LOCAL_INSTEAD, classifyNetError, preflight } from '../skills/playtest/scripts/lib/preflight.mjs';
// The far side of the seam: the studio's own classification of the same failures (check, perf, shoot, port check).
import * as studioNet from '../../../packages/studio/lib/net.mjs';
import { qa } from '../skills/video/scripts/qa.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAYTEST = join(HERE, '..', 'skills', 'playtest', 'scripts', 'playtest.mjs');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-playtest-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const ffmpeg = (...args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
const png = (name, src, vf = null) => { const f = join(scratch, `${name}.png`); ffmpeg('-f', 'lavfi', '-i', src, ...(vf ? ['-vf', vf] : []), '-frames:v', '1', f); return f; };

test('playtest pixels: black, flat, busy, holes and motion are told apart', () => {
  const black = stats(decode(png('black', 'color=c=black:s=640x400')));
  assert.equal(black.black, true);
  const navy = stats(decode(png('navy', 'color=c=0x0b1020:s=640x400')));
  assert.equal(navy.black, false, 'a dark navy backdrop is not black');
  assert.equal(navy.flat, true);
  assert.equal(navy.flatBlackShare, 0, 'and it is not a hole');
  assert.ok(navy.flatDarkShare > 0.9, 'but it is a flat dark backdrop');
  const busy = stats(decode(png('busy', 'testsrc2=s=640x400')));
  assert.equal(busy.black || busy.flat, false);
  assert.ok(busy.edges > 0.05 && busy.sd > 30, JSON.stringify(busy));
  const holed = stats(decode(png('holed', 'testsrc2=s=640x400', 'drawbox=x=0:y=0:w=320:h=200:c=black:t=fill')));
  assert.ok(holed.flatBlackShare > 0.2 && holed.flatBlackShare < 0.3, `a quarter of the frame is a hole: ${holed.flatBlackShare}`);
  const a = decode(png('m1', 'testsrc2=s=640x400:d=2', 'select=eq(n\\,0)'));
  const b = decode(png('m2', 'testsrc2=s=640x400:r=25:d=2', 'select=eq(n\\,40)'));
  assert.equal(motion(a, a), 0);
  assert.ok(motion(a, b) > 0.001);
});

test('playtest ui cover: what stays when the background flips is UI', () => {
  // A 390x844 phone: a 130x130 opaque panel in the middle third and a translucent chip at the bottom.
  const onBlack = decode(png('ui-b', 'color=c=black:s=390x844', 'drawbox=x=130:y=350:w=130:h=130:c=0x335577:t=fill,drawbox=x=10:y=800:w=120:h=30:c=0x7f7f7f@0.5:t=fill'), 390);
  const onWhite = decode(png('ui-w', 'color=c=white:s=390x844', 'drawbox=x=130:y=350:w=130:h=130:c=0x335577:t=fill,drawbox=x=10:y=800:w=120:h=30:c=0x7f7f7f@0.5:t=fill'), 390);
  const c = uiCover(onBlack, onWhite);
  const panel = (130 * 130) / (390 * 844); const chip = (120 * 30) / (390 * 844);
  assert.ok(Math.abs(c.opaque - panel) < 0.005, `opaque ${c.opaque} vs ${panel.toFixed(3)}`);
  assert.ok(Math.abs(c.cover - (panel + chip)) < 0.006, `cover ${c.cover} vs ${(panel + chip).toFixed(3)}`);
  assert.ok(Math.abs(c.centreOpaque - (130 * 130) / (130 * 281)) < 0.03, `centre ${c.centreOpaque}`);
  const none = uiCover(decode(png('n-b', 'color=c=black:s=390x844'), 390), decode(png('n-w', 'color=c=white:s=390x844'), 390));
  assert.deepEqual(none, { cover: 0, opaque: 0, centreOpaque: 0 });
});

test('video qa: a file that plays everywhere passes; the faults a phone meets are named', () => {
  const good = join(scratch, 'good.mp4');
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-af', 'volume=12dB', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709', '-c:a', 'aac', '-movflags', '+faststart', good);
  const g = qa(good);
  assert.equal(g.ok, true, JSON.stringify(g.fails));
  assert.equal(g.faststart, true);
  assert.equal(g.shape, '16:9');
  const bad = join(scratch, 'bad.mp4');
  ffmpeg('-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', bad);
  const b = qa(bad);
  assert.equal(b.ok, false);
  assert.ok(b.fails.some((f) => /yuv420p/.test(f)));
  assert.ok(b.fails.some((f) => /faststart/.test(f)));
  assert.ok(b.fails.some((f) => /half of it is black/.test(f)));
  assert.ok(b.warnings.some((w) => /no sound/.test(w)));
});

test('playtest review: the brief carries the pictures and every row, and asks a fresh reviewer for the verdict JSON', () => {
  const run = join(scratch, 'run');
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'report.json'), JSON.stringify({ v: 1, game: 'gem', url: 'http://127.0.0.1:8787', rows: [{ name: 'first desk', verdict: 'PASS' }, { name: 'sound', verdict: 'FAIL', why: 'the game made no Web Audio context' }], weak: [] }));
  writeFileSync(join(run, 'sheet-desk.png'), 'x');
  const r = spawnSync(process.execPath, [PLAYTEST, 'review', run, '--json'], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true, r.stdout + r.stderr);
  const brief = readFileSync(join(run, 'REVIEW.md'), 'utf8');
  assert.match(brief, /# Blind review: gem/);
  assert.match(brief, /http:\/\/127\.0\.0\.1:8787\/gem\/play/);
  assert.match(brief, /sheet-desk\.png/);
  assert.match(brief, /FAIL sound: the game made no Web Audio context/);
  assert.match(brief, /"wouldPlayAgain"/);
  assert.doesNotMatch(brief, /\{\{[A-Z]+\}\}/, 'no placeholder left');
  assert.match(spawnSync(process.execPath, [PLAYTEST, 'run', 'gem', '--url', 'http://127.0.0.1:9', '--json'], { encoding: 'utf8', cwd: scratch }).stdout, /does not answer/);
});

test('playtest run against a live studio (only when HOMIE_PLAYTEST_URL is set)', { skip: !process.env.HOMIE_PLAYTEST_URL }, () => {
  const r = spawnSync(process.execPath, [PLAYTEST, 'run', process.env.HOMIE_PLAYTEST_GAME ?? 'gem', '--url', process.env.HOMIE_PLAYTEST_URL, '--only', 'first,look,ui', '--seconds', '8', '--json'], { cwd: process.env.HOMIE_PLAYTEST_STUDIO, encoding: 'utf8', timeout: 8 * 60_000 });
  const j = JSON.parse(r.stdout);
  assert.ok(j.rows?.length >= 5, r.stdout);
  assert.ok(existsSync(join(j.out, 'REPORT.md')));
});

/* ------------------------------------------------------------------------------------------------------------------
 * The instruments' own faults and limits. Each test injects the fault and reads the classification: "could not
 * measure" must never come out as "measured, and fine", nor as a failure of the game.
 */

// A reading of the game's state, as the browser side hands it over (the probe's round and last row, the shell's cover).
const reading = ({ phase = 'live', n = 3, leftMs = 31_000, busy = 0, x = 100, y = 50, extra = {}, cover = 'done' } = {}) => stateOf({ at: 1, port: { round: phase ? { n, phase, leftMs } : null, busy, x, y, extra }, shell: { round: null, arrival: cover ? { phase: cover } : null } });

test('a stuck screenshot decoder is stopped and reported as blocked, not waited on and not a game failure', () => {
  // The fault: a decoder that never finishes (one sat for minutes while the game drew fine behind it).
  const stuck = join(scratch, 'stuck-decoder.sh');
  writeFileSync(stuck, '#!/bin/sh\nexec sleep 60\n');
  chmodSync(stuck, 0o755);
  const t0 = Date.now();
  assert.throws(() => decode(png('for-stuck', 'testsrc2=s=64x64'), 64, { timeoutMs: 500, bin: stuck }), (e) => e.blocked === true && e.name === 'DecodeBlocked' && /did not finish/.test(e.message) && /not measured/.test(e.message));
  assert.ok(Date.now() - t0 < 10_000, 'bounded: the controller got its turn back');
  // No decoder at all is the same kind of thing: the instrument cannot see, so nothing is judged.
  assert.throws(() => decode(Buffer.from('x'), 64, { bin: join(scratch, 'no-such-decoder') }), (e) => e.blocked === true);
  // A picture that really is broken is still an ordinary error (not "blocked"): the two are told apart.
  assert.throws(() => decode(Buffer.from('not a png'), 64), (e) => !e.blocked && /could not decode/.test(e.message));
});

test('a controller with something left on its event loop still exits after its report, with its failure code', () => {
  // The fault: a handle nobody cleared (here an interval; in the field it was never identified).
  const script = join(scratch, 'hang.mjs');
  writeFileSync(script, `import { finish, within } from ${JSON.stringify(join(HERE, '..', 'skills', 'playtest', 'scripts', 'lib', 'exit.mjs'))};
setInterval(() => {}, 1000);
process.stdout.write('report written\\n');
process.exitCode = Number(process.argv[2]);
let cleaned = false;
await within(new Promise(() => {}), 50);          // a race whose loser is cleared leaves nothing behind either
await finish({ cleanup: async () => { cleaned = true; process.stdout.write('browsers closed\\n'); }, graceMs: 2000 });
`);
  for (const code of [1, 0]) {
    const r = spawnSync(process.execPath, [script, String(code)], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(r.error, undefined, 'it exited by itself (no timeout kill)');
    assert.equal(r.status, code, 'the exit code the run earned is kept');
    assert.match(r.stdout, /report written\nbrowsers closed\n/);
  }
  // A cleanup that never ends is bounded too.
  const slow = join(scratch, 'hang2.mjs');
  writeFileSync(slow, `import { finish } from ${JSON.stringify(join(HERE, '..', 'skills', 'playtest', 'scripts', 'lib', 'exit.mjs'))};\nprocess.exitCode = 1;\nawait finish({ cleanup: () => new Promise(() => {}), graceMs: 300 });\n`);
  assert.equal(spawnSync(process.execPath, [slow], { encoding: 'utf8', timeout: 20_000 }).status, 1);
});

test('one classification of a name that cannot be looked up: the studio\'s commands and this skill\'s script agree, code for code and word for word', async () => {
  // ACROSS THE SEAM: the script cannot import the studio's lib/net.mjs (it runs against whatever is installed), so
  // the two are held together here with the real code of both sides and the same errors.
  assert.deepEqual(DNS_CODES, studioNet.DNS_CODES, 'the same codes mean "this computer could not look the name up"');
  assert.equal(LOCAL_INSTEAD, studioNet.LOCAL_INSTEAD, 'the same way round it');
  const err = (code) => new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ${code} play.example.com`), { code }) });
  for (const code of DNS_CODES) {
    const mine = classifyNetError(err(code), 'play.example.com');
    const reach = await studioNet.reachSite('https://play.example.com', { fetchFn: async () => { throw err(code); }, env: {}, execArgv: [] });
    assert.deepEqual([mine.kind, reach.preflight], ['dns', 'dns'], code);
    // What each command prints: `siteRefusal` is the studio's (check, perf, shoot, port check); the script's own
    // prints BLOCKED and its `why`. The same sentence, to the letter.
    for (const command of ['check', 'perf', 'shoot', 'port check']) {
      const said = studioNet.siteRefusal(reach, { command, play: 'https://play.example.com/gem/play' });
      assert.deepEqual([said.verdict, said.blocked, said.preflight, said.command], ['BLOCKED', true, 'dns', command]);
      assert.equal(said.why, `BLOCKED ${mine.why}`, `${command} and the playtest script say one thing for ${code}`);
    }
    assert.doesNotMatch(mine.why, /does not answer|is down|broken/, 'never the site or the game');
  }
  // A deploy's read-back names the same kind for the same error (lib/cloudflare.mjs readLiveSite reads whyFailed).
  assert.equal(studioNet.whyFailed(err('ESERVFAIL'), 'https://play.example.com', { env: {}, execArgv: [] }).preflight, 'dns');
  // Nothing listening on this computer is the other thing on both sides: start the site, in the same words.
  const refused = () => new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
  const local = studioNet.siteRefusal(await studioNet.reachSite('http://127.0.0.1:9', { fetchFn: async () => { throw refused(); } }), { command: 'check', play: 'http://127.0.0.1:9/gem/play' });
  const mineLocal = await preflight('http://127.0.0.1:9/gem/play', { fetcher: async () => { throw refused(); } });
  assert.deepEqual([local.preflight, local.verdict, mineLocal.kind, mineLocal.verdict], ['local', undefined, 'refused', 'FAIL']);
  for (const why of [local.why, mineLocal.why]) assert.match(why, /does not answer.*start the site \(npm run dev, as a background task that outlives this command\) or check the address/);
});

test('a name Node cannot resolve is a blocked network preflight with local testing offered, never a game failure', async () => {
  // The fault: this process's resolver fails for a public name (a browser on the same computer may still open it).
  const lookup = async () => { const e = new Error('getaddrinfo ENOTFOUND studio.example'); e.code = 'ENOTFOUND'; throw e; };
  let fetched = false;
  const r = await preflight('https://studio.example/gem/play', { lookup, fetcher: async () => { fetched = true; return { ok: true }; } });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'dns');
  assert.equal(r.verdict, 'BLOCKED');
  assert.match(r.why, /network preflight/);
  assert.match(r.why, /says nothing about the site or the game/);
  assert.match(r.why, /127\.0\.0\.1:8787/, 'the way round it: the local site');
  assert.equal(fetched, false);
  // Node's fetch wraps the code in a cause: still found.
  const wrapped = new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'EAI_AGAIN' }) });
  assert.equal(classifyNetError(wrapped, 'studio.example').verdict, 'BLOCKED');
  // Nothing listening and a 404 are answers about the address: FAIL, and worded as the site not answering.
  const refused = await preflight('http://127.0.0.1:9/gem/play', { fetcher: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); } });
  assert.deepEqual([refused.kind, refused.verdict], ['refused', 'FAIL']);
  assert.match(refused.why, /does not answer/);
  assert.deepEqual((({ kind, verdict }) => [kind, verdict])(await preflight('http://127.0.0.1:9/gem/play', { fetcher: async () => ({ ok: false, status: 404 }) })), ['http', 'FAIL']);
  assert.equal((await preflight('http://127.0.0.1:9/gem/play', { fetcher: async () => ({ ok: true }) })).ok, true);
  // The whole command, with the real resolver and a name that can never resolve (.invalid is reserved for that).
  const run = spawnSync(process.execPath, [PLAYTEST, 'run', 'gem', '--url', 'http://homie-playtest.invalid', '--json'], { encoding: 'utf8', cwd: scratch, timeout: 60_000 });
  const j = JSON.parse(run.stdout);
  assert.equal(run.status, 1, 'nothing was measured: a non-zero exit');
  assert.equal(j.verdict, 'BLOCKED');
  assert.match(j.why, /^BLOCKED network preflight/);
});

test('first picture: a loading screen that paints at once is not the first gameplay', () => {
  // The fault: the page paints its loading card at 35 ms; the game is on screen at 4.2 s.
  const samples = [
    { ms: 35, seated: false, picture: true, cover: 'up', heartbeat: false },
    { ms: 900, seated: true, picture: true, cover: 'up', heartbeat: false },
    { ms: 3000, seated: true, picture: true, cover: 'up', heartbeat: true },
    { ms: 4200, seated: true, picture: true, cover: 'lifted', heartbeat: true },
  ];
  const r = readinessOf(samples);
  assert.deepEqual([r.firstPaintMs, r.seatedMs, r.coverLiftedMs, r.heartbeatMs, r.firstGameplayMs, r.readiness], [35, 900, 4200, 3000, 4200, 'arrival']);
  assert.equal(judgeFirst(r).verdict, 'PASS');
  // The cover never lifts: the early paint does not rescue the row.
  const stuck = readinessOf(samples.slice(0, 3));
  assert.equal(stuck.firstGameplayMs, null);
  const j = judgeFirst(stuck);
  assert.equal(j.verdict, 'FAIL');
  assert.match(j.why, /loading cover never lifted/);
  assert.match(j.why, /was the loading card, not the game/);
  // A slow game is named by its gameplay time, with the paint time beside it.
  assert.match(judgeFirst(readinessOf([{ ms: 40, seated: true, picture: true, cover: 'up', heartbeat: false }, { ms: 12_000, seated: true, picture: true, cover: 'lifted', heartbeat: true }])).why, /first picture of the game came at 12\.0 s .*first painted at 0\.0 s/);
  // A page with no arrival state: measured, and said to be unverified.
  const old = readinessOf([{ ms: 500, seated: true, picture: true, cover: null, heartbeat: true }]);
  assert.equal(old.readiness, 'unverified');
  assert.match(judgeFirst(old).note, /reports no arrival state/);
});

test('first move: a wall, a round break and a dead body are not unresponsive controls', () => {
  const live = reading({ x: 878, y: 120 });
  // The fault: the body starts against the right wall and the probe presses right.
  const wall = judgeMove([{ dir: 'right', moved: false, ms: null, before: live, after: live }, { dir: 'left', moved: true, ms: 233, before: live, after: reading({ x: 850, y: 120 }) }]);
  assert.equal(wall.verdict, 'WARN');
  assert.equal(wall.controlMs, 233);
  assert.match(wall.why, /pressing right from \(878, 120\) moved nothing, pressing left moved the body in 233 ms/);
  assert.match(wall.why, /not called unresponsive controls/);
  assert.match(wall.why, /does not prove right works/);
  assert.deepEqual(wall.attempts.map((a) => [a.dir, a.moved, a.at]), [['right', false, { x: 878, y: 120 }], ['left', true, { x: 878, y: 120 }]], 'both presses are kept, with where the body was');
  assert.match(wall.attempts[0].before, /round 3 live, 31 s left, body free at \(878, 120\)/, 'phase, time left and pose at the press');
  // The fault: one second left; the press runs into the results break.
  const over = reading({ phase: 'over', leftMs: 6000 });
  const brk = judgeMove([{ dir: 'right', moved: false, ms: null, before: reading({ leftMs: 900 }), after: over }, { dir: 'left', moved: false, ms: null, before: over, after: over }]);
  assert.equal(brk.verdict, 'BLOCKED');
  assert.match(brk.why, /not measured/);
  assert.match(brk.why, /round 3 was over/);
  // The fault: the local body is dead (the game says so through `busy`), all wait long.
  const dead = reading({ busy: 1 });
  const none = judgeMove([], { waited: { ok: false, ms: 25_000, state: dead } });
  assert.equal(none.verdict, 'BLOCKED');
  assert.match(none.why, /no press was made/);
  assert.match(none.why, /not the player's to steer/);
  // A real failure stays one: live, free, both ways, nothing.
  const broken = judgeMove([{ dir: 'right', moved: false, ms: null, before: live, after: live }, { dir: 'left', moved: false, ms: null, before: live, after: live }]);
  assert.equal(broken.verdict, 'FAIL');
  assert.match(broken.why, /no press moved the body/);
  assert.equal(judgeMove([{ dir: 'right', moved: true, ms: 180, before: live, after: live }]).verdict, 'PASS');
  assert.equal(judgeMove([{ dir: 'right', moved: true, ms: 2200, before: live, after: live }]).verdict, 'FAIL', 'slow is still slow');
  // What a game exposes decides what can be told apart.
  assert.equal(contextOf(reading({ extra: { alive: false } })).kind, 'spectating');
  assert.equal(contextOf(reading({ cover: 'game' })).kind, 'loading');
  assert.equal(contextOf(stateOf({ at: 1, port: null, shell: null })).kind, 'unknown');
});

test('ui coverage: a results screen is labelled and not judged as play; a pair across a round break is rejected', () => {
  const cov = { cover: 0.52, opaque: 0.5, centreOpaque: 1 };
  // The fault: the round ended before the capture; the frame shows the results card.
  const over = reading({ phase: 'over', leftMs: 8000 });
  const res = judgeUi(cov, { before: over, after: over, thumb: 'held' });
  assert.equal(res.verdict, 'N/A');
  assert.equal(res.screen, 'results screen');
  assert.match(res.why, /not active play/);
  assert.match(res.why, /Active-play coverage was not measured/);
  // The fault: the black frame is live play, the white frame is the results card.
  const live = reading({ extra: { mode: 'auto', loadout: 'rifle' } });
  const mixed = judgeUi(cov, { before: live, after: over });
  assert.equal(mixed.verdict, 'BLOCKED');
  assert.match(mixed.why, /round phase live → over/);
  assert.equal(pairMismatch(live, reading({ extra: { mode: 'manual', loadout: 'rifle' } })), 'control mode auto → manual');
  assert.equal(pairMismatch(live, live), null);
  // Active play is judged, with the state it was in; the same cover as a spectator is not.
  const play = judgeUi(cov, { before: live, after: live, thumb: 'held' });
  assert.equal(play.verdict, 'FAIL');
  assert.equal(play.screen, 'active play');
  assert.match(play.state, /mode auto, loadout rifle/);
  assert.equal(judgeUi({ cover: 0.08, opaque: 0.02, centreOpaque: 0 }, { before: live, after: live, thumb: 'held' }).verdict, 'PASS');
  assert.equal(judgeUi(cov, { before: reading({ extra: { alive: false } }), after: reading({ extra: { alive: false } }) }).screen, 'spectator view');
  // A game that exposes nothing is still measured, and the row says it cannot tell which screen it saw.
  const blind = stateOf({ at: 1, port: null, shell: null });
  const unk = judgeUi({ cover: 0.05, opaque: 0, centreOpaque: 0 }, { before: blind, after: blind, thumb: 'up' });
  assert.equal(unk.verdict, 'PASS');
  assert.match(unk.qualifier, /exposes no round phase/);
  assert.match(unk.qualifier, /thumb lifted/);
});

test('scores: a shared total is not a ranking, a bot win is a gap, and a conclusion says which inputs were used', () => {
  const pressed = { moves: 30, primary: { declared: true, how: 'fire: the left mouse button', pressed: 9, missed: 0 } };
  const guessed = { moves: 30, primary: { declared: false, how: 'the space bar (a guess: game.json declares no playtest.primary)', pressed: 9, missed: 0 } };
  // The fault: a cooperative game reports the crew's total on every row.
  const coop = judgeScores({ me: { score: 40 }, them: { score: 40 }, rows: [{ score: 40 }, { score: 40 }, { score: 40, bot: true }], scoring: 'together', actions: pressed });
  assert.match(coop.comparison, /^not applicable/);
  assert.equal(coop.scoring, 'together');
  assert.deepEqual(coop.notes, [], 'no "input does not matter", no "everyone tied"');
  // The same rows in a competitive game are worth a note.
  const rivals = judgeScores({ me: { score: 40 }, them: { score: 40 }, rows: [{ score: 40 }, { score: 40 }], actions: pressed });
  assert.ok(rivals.notes.some((n) => /pressed nothing scored 40/.test(n)));
  assert.ok(rivals.notes.some((n) => /every player finished on the same score/.test(n)));
  // The fault: a shooter whose fire button the script never presses; both people on zero, a bot on 21.
  const shooter = judgeScores({ me: { score: 0 }, them: { score: 0 }, rows: [{ score: 0 }, { score: 0 }, { score: 21, bot: true }], actions: guessed });
  const idle = shooter.notes.find((n) => /pressed nothing/.test(n));
  assert.match(idle, /declares no primary action/);
  assert.match(idle, /not evidence that input does not matter/);
  assert.equal(shooter.primaryExercised, false);
  const bot = shooter.notes.find((n) => /a bot outscored/.test(n));
  assert.match(bot, /21 to 0 in this one scripted round \(a gap of 21\)/);
  assert.match(bot, /not proof that people cannot win/);
  assert.match(bot, /a few more times/);
  assert.ok(!shooter.notes.some((n) => /people cannot win against the bots/.test(n)), 'no absolute claim from one run');
  // A declared action that never found its control on screen was not exercised either.
  const missed = judgeScores({ me: { score: 1 }, them: { score: 3 }, rows: [{ score: 1 }, { score: 3 }], actions: { moves: 9, primary: { declared: true, how: 'fire: a tap on the game\'s control [data-fire]', pressed: 0, missed: 7 } } });
  assert.match(missed.notes[0], /was never pressed in this round \(7 tries found no control on screen\)/);
});

test('action profiles: game.json declares the primary action; an undeclared one is marked a guess', () => {
  const g = { playtest: { primary: { label: 'fire', computer: { mouse: 'left' }, phone: { selector: '[data-action=fire]' } } } };
  assert.deepEqual((({ declared, kind, button, at }) => ({ declared, kind, button, at }))(actionProfile(g, 'desk')), { declared: true, kind: 'mouse', button: 'left', at: [0.5, 0.5] });
  const phone = actionProfile(g, 'phone-landscape');
  assert.deepEqual([phone.declared, phone.kind, phone.selector], [true, 'selector', '[data-action=fire]']);
  assert.match(phone.how, /fire: a tap on the game's control/);
  assert.deepEqual((({ declared, kind, key }) => ({ declared, kind, key }))(actionProfile({ playtest: { primary: { computer: { key: 'KeyF' } } } }, 'desk')), { declared: true, kind: 'key', key: 'KeyF' });
  assert.deepEqual(actionProfile({ playtest: { primary: { phone: { region: [0.7, 0.7, 0.2, 0.2] } } } }, 'phone').region, [0.7, 0.7, 0.2, 0.2]);
  const none = actionProfile({}, 'desk');
  assert.deepEqual([none.declared, none.key], [false, 'Space']);
  assert.match(none.how, /a guess/);
  assert.equal(actionProfile({}, 'phone').declared, false);
  const bad = actionProfile({ playtest: { primary: { computer: { mouse: 'thumb' } } } }, 'desk');
  assert.equal(bad.declared, false);
  assert.match(bad.problem, /is not one of/);
});

test('a finished round and an uninterrupted connection are reported apart', () => {
  // The fault: both browsers finished the round; the phone reconnected once on the way.
  const dropped = connectionNote([{ browser: 'computer', reconnects: 0 }, { browser: 'phone', reconnects: 1 }]);
  assert.deepEqual([dropped.reconnects, dropped.uninterrupted], [1, false]);
  assert.match(dropped.note, /the round finished, and the connection did not hold throughout: the phone reconnected 1 time/);
  assert.deepEqual((({ reconnects, uninterrupted }) => [reconnects, uninterrupted])(connectionNote([{ browser: 'computer', reconnects: 0 }, { browser: 'phone', reconnects: 0 }])), [0, true]);
  // Not reported is not "held".
  assert.equal(connectionNote([{ browser: 'computer', reconnects: 0 }, { browser: 'phone', reconnects: null }]).uninterrupted, null);
  assert.equal(connectionNote(undefined).uninterrupted, null);
});

test('measured renderer cost: read when the game exposes it, absent (never zero) when it does not', () => {
  assert.deepEqual(renderCost([{ drawCalls: 212, triangles: 105_442 }, { drawCalls: 213, triangles: 119_148 }, { drawCalls: 190, triangles: 99_000 }]), { samples: 3, drawCalls: { median: 212, max: 213 }, triangles: { median: 105_442, max: 119_148 } });
  assert.equal(renderCost([{ drawCalls: undefined, triangles: undefined }, null]), null);
});

test('the report a person reads: DOM-coverage caveat beside the UI row, N/A not weak, blocked rows weak, the review named', () => {
  const rows = [
    { name: 'ui phone', verdict: 'PASS', cover: 0.015, screen: 'active play', state: 'round 3 live, 20 s left, body free at (1, 2)', note: UI_CAVEAT },
    { name: 'ui phone-landscape', verdict: 'N/A', why: 'this is the results screen, not active play', screen: 'results screen' },
    { name: 'move phone', verdict: 'BLOCKED', why: 'no press was made', attempts: [] },
    { name: 'play', verdict: 'WARN', why: 'x', comparison: 'not applicable: shared total', actions: 'direction holds 30; fire: 0 pressed' },
    { name: 'round', verdict: 'WARN', why: 'the phone reconnected 1 time', connection: 'the round finished, and the connection did not hold throughout' },
  ];
  const weak = weakest(rows);
  assert.deepEqual(weak.map((w) => w.split(':')[0]), ['BLOCKED move phone', 'WARN round', 'WARN play']);
  const md = reportMd({ game: 'gem', url: 'http://127.0.0.1:8787', at: 'now', seconds: 1, probe: true, rows, weak });
  assert.match(md, /\*\*ui phone\*\* \(PASS\): screen measured: active play\. .*DOM coverage only/);
  assert.match(md, /drawn inside the canvas were NOT checked for coverage or overlap/);
  assert.match(md, /BLOCKED: could not be measured \(never a pass\)/);
  assert.match(md, /Score comparison: not applicable: shared total/);
  assert.match(md, /Completion and connection are separate/);
  assert.match(md, /## Review\n\nBLOCKED review: no review has been recorded/);
  assert.match(reportMd({ game: 'gem', url: 'u', at: 'now', seconds: 1, probe: true, rows, weak }, { kind: 'local', reason: 'the host refused the transfer', score: 61 }), /WARN review: local fallback, NOT independent .*because the host refused the transfer.* Overall 61\/100/);
  assert.equal(reviewLine({ kind: 'independent', by: 'a fresh subagent' }).verdict, 'DONE');
  assert.equal(reviewLine({ kind: 'none', reason: 'not approved' }).verdict, 'BLOCKED');
});

test('the review step: one approval question naming every file and the destination, a local fallback, and a record of which ran', () => {
  const run = join(scratch, 'run2');
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'report.json'), JSON.stringify({ v: 1, game: 'gem', url: 'http://127.0.0.1:8787', at: 'now', seconds: 5, probe: true, rows: [{ name: 'first desk', verdict: 'PASS' }], weak: [] }));
  for (const f of ['sheet-desk.png', 'phone-ui-on-black.png', 'phone-ui-on-white.png']) writeFileSync(join(run, f), 'x');
  const cli = (...args) => { const r = spawnSync(process.execPath, [PLAYTEST, ...args, '--json'], { encoding: 'utf8', timeout: 30_000 }); return { status: r.status, j: JSON.parse(r.stdout) }; };
  const { j } = cli('review', run, '--to', 'a second coding agent run from the terminal');
  assert.deepEqual(j.sends, ['REVIEW.md', 'report.json', 'sheet-desk.png', 'phone-ui-on-black.png', 'phone-ui-on-white.png']);
  for (const f of j.sends) assert.ok(j.approval.includes(`- ${f} (`), `the question names ${f}`);
  assert.ok(j.approval.includes(run) && j.approval.includes('a second coding agent run from the terminal'), 'and the folder and the destination');
  assert.match(j.approval, /One yes covers this report folder and this reviewer/);
  assert.match(j.approval, /Say "local" instead and nothing leaves this session/);
  assert.match(j.ifRefused, /do not retry it in other words/);
  assert.deepEqual(JSON.parse(readFileSync(join(run, 'review-request.json'), 'utf8')).files.map((f) => f.file), j.sends);
  // Before any review: the report says none ran, as BLOCKED.
  assert.match(cli('report', run).j.review, /^BLOCKED review/);
  // The fallback sends nothing and says what it is.
  const local = cli('review', run, '--local').j;
  assert.match(local.sends, /^nothing/);
  const brief = readFileSync(join(run, 'REVIEW-LOCAL.md'), 'utf8');
  assert.match(brief, /# Local review \(NOT independent\): gem/);
  assert.match(brief, /must never be reported as one/);
  assert.match(brief, /"wouldPlayAgain"/, 'the same rubric');
  assert.doesNotMatch(brief, /\{\{[A-Z]+\}\}/);
  // A review that ran needs its verdict; "none" needs its reason; each is written into the report.
  assert.equal(cli('reviewed', run, '--kind', 'local', '--reason', 'the host refused the transfer').status, 1, 'no VERDICT.json yet');
  assert.equal(cli('reviewed', run, '--kind', 'none').status, 1, 'no reason given');
  assert.match(cli('reviewed', run, '--kind', 'none', '--reason', 'the host refused the transfer').j.review, /^BLOCKED review: no review ran \(the host refused the transfer\)/);
  assert.match(readFileSync(join(run, 'REPORT.md'), 'utf8'), /BLOCKED review: no review ran \(the host refused the transfer\)\. A missing review is not a passed one/);
  writeFileSync(join(run, 'VERDICT.json'), JSON.stringify({ score: 58, review: 'local' }));
  const rec = cli('reviewed', run, '--kind', 'local', '--reason', 'the host refused the transfer').j;
  assert.match(rec.review, /^WARN review: local fallback, NOT independent/);
  assert.match(rec.review, /Overall 58\/100/);
  assert.equal(cli('report', run).j.reviewKind, 'local');
  assert.match(cli('reviewed', run, '--kind', 'independent', '--by', 'a fresh subagent').j.review, /^Review: independent/);
});
