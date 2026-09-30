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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decode, motion, stats, uiCover } from '../skills/playtest/scripts/lib/pixels.mjs';
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
