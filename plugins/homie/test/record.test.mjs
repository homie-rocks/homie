/**
 * The video skill's page recorder (record-page.mjs, `video.mjs record`) against a small site on this computer
 * (fixtures/record-site: a landing with a Play button and a name field, a play page, and a canvas game in a
 * sandboxed /__game/ frame that moves with the arrow keys, changes colour on a click or a tap, and beeps through
 * WebAudio): the steps run in real time; every input reaches the frame it was meant for; the film is exactly as long
 * as the recording at a constant frame rate, made of frames the page drew (held, never interpolated); captions land
 * at the seconds their steps ran; a phone is a 9:16 film with touch; a step that fails is named, and the take is
 * kept. Needs ffmpeg and Chrome. Run: node --test plugins/homie/test/record.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..');
const SCRIPTS = join(PLUGIN, 'skills', 'video', 'scripts');
const VIDEO = join(SCRIPTS, 'video.mjs');
const SITE = join(HERE, 'fixtures', 'record-site');
const STUDIO_PKG = join(PLUGIN, '..', '..', 'packages', 'studio');
const REPO_NM = join(PLUGIN, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-record-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function studio(name) {
  const dir = join(scratch, name);
  const r = spawnSync(process.execPath, [join(STUDIO_PKG, 'bin', 'homie-studio.mjs'), 'new', dir, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
  symlinkSync(STUDIO_PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  for (const p of ['esbuild', 'puppeteer-core']) symlinkSync(join(REPO_NM, p), join(dir, 'node_modules', p));
  symlinkSync(join(STUDIO_PKG, 'bin', 'homie-studio.mjs'), join(dir, 'node_modules', '.bin', 'homie-studio'));
  return dir;
}

/** The fixture site; a file with no extension is a page (/demo/play). */
async function serve() {
  const server = createServer((req, res) => {
    let f = join(SITE, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!f.startsWith(SITE) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': `${extname(f) === '.json' ? 'application/json' : 'text/html'}; charset=utf-8` });
    res.end(readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const video = (args, cwd) => new Promise((ok) => {
  const p = spawn(process.execPath, [VIDEO, ...args, '--json'], { cwd });
  let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', () => { try { ok(JSON.parse(out)); } catch { ok({ ok: false, why: `no JSON: ${out} ${err.slice(-2000)}` }); } });
});
const probe = (file) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout);
  return { width: j.streams[0].width, height: j.streams[0].height, rate: j.streams[0].r_frame_rate, frames: Number(j.streams[0].nb_read_frames), duration: Number(j.format.duration) };
};

test('record: a computer, scripted: typing, scrolling, Play, keys and a click reach the game; real time, honest frames, captions on the steps\' seconds', async () => {
  const site = await serve();
  try {
    const dir = studio('computer');
    const r = await video(['record', 'demo', '--steps', join(SITE, 'demo.steps.json'), '--url', site.url], dir);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.file, 'videos/demo/work/record/recording.mp4');
    assert.equal(r.steps, 10);
    // Delivered: the game's own frame received the key presses and the click (its last waitFor proved the game saw them).
    assert.ok(r.inputs.game.keys >= 3, JSON.stringify(r.inputs));
    assert.ok(r.inputs.game.pointers >= 1);
    const j = JSON.parse(readFileSync(join(dir, r.json), 'utf8'));
    // Each input step says what its own frame received while it ran.
    assert.deepEqual(j.steps[1].received, { keys: 3, pointers: 1, touches: 0 }, 'the name field got a click and three letters');
    assert.equal(j.steps[4].received, 'another page opened', 'Play opened the play page');
    assert.deepEqual(j.steps[6].received, { keys: 1, pointers: 0, touches: 0 });
    assert.deepEqual(j.steps[7].received, { keys: 2, pointers: 0, touches: 0 });
    assert.deepEqual(j.steps[8].received, { keys: 0, pointers: 1, touches: 0 });
    assert.deepEqual(j.steps.map((s) => s.do), ['wait', 'type', 'scroll', 'scroll', 'click', 'waitFor', 'key', 'keys', 'click', 'waitFor']);
    assert.ok(j.steps.every((s, i) => !s.failed && (i === 0 || s.at >= j.steps[i - 1].at)), 'every step ran, in order, at its own second');
    // Real time: the film lasts as long as the steps took, plus the tail; nothing sped up.
    const ran = j.steps.at(-1).at + j.steps.at(-1).took + 1;
    assert.ok(Math.abs(r.seconds - ran) < 0.6, `the film (${r.seconds} s) lasts as long as the recording (${ran.toFixed(2)} s)`);
    // Honest frames: a constant 30 fps, every output frame one the page drew or a held one, counted.
    const p = probe(join(dir, r.file));
    assert.deepEqual([p.width, p.height, p.rate], [1920, 1080, '30/1']);
    assert.equal(p.frames, j.outputFrames);
    assert.equal(j.outputFrames, j.distinctFramesUsed + j.heldFrames, 'each output frame is a painted frame or a held one: nothing else');
    assert.ok(j.paintedFrames >= j.distinctFramesUsed);
    assert.match(j.honesty, /never invented/);
    assert.match(j.honesty, /cursor/);
    // Captions at the seconds their steps ran.
    const vtt = readFileSync(join(dir, r.captions), 'utf8');
    const cues = [...vtt.matchAll(/(\d\d):(\d\d):(\d\d\.\d{3}) --> [\d:.]+\n(.+)/g)].map((m) => [Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]), m[4]]);
    assert.deepEqual(cues.map((c) => c[1]), ['The landing', 'A name', 'Press Play', 'Move']);
    assert.ok(Math.abs(cues[2][0] - j.steps[4].at) < 0.01, 'the "Press Play" caption starts as the click starts');
    // The sound, when this machine's Chrome made any: a steady beep lands within a few frames of its key press.
    if (j.audio?.peakDb != null) {
      const sd = spawnSync('ffmpeg', ['-v', 'info', '-i', join(dir, r.file), '-map', '0:a', '-af', 'silencedetect=n=-40dB:d=0.03', '-f', 'null', '-'], { encoding: 'utf8' });
      const onsets = [...sd.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
      const second = j.steps[7].at; // the "keys" step: its first press (the game's AudioContext is warm by then)
      const near = onsets.find((t) => t >= second - 0.05 && t <= second + 0.5);
      assert.ok(near !== undefined && near - second < 0.15, `a beep within 150 ms of the press at ${second} s (onsets ${onsets.join(', ')})`);
    }
    // `add` takes the recording as it is, with its own honesty line.
    const a = await video(['add', 'demo', '--file', r.file, '--kind', 'clip', '--title', 'Demo Dash walkthrough'], dir);
    assert.equal(a.ok, true, JSON.stringify(a));
    const entry = JSON.parse(readFileSync(join(dir, 'videos/manifest.json'), 'utf8')).items[0];
    assert.match(entry.honesty, /Recorded in real time/);
    assert.equal(entry.made.provider, 'recording');
  } finally { site.close(); }
});

test('record: a phone is a 9:16 film with touch: a tap on Play, a tap and a held drag in the game', async () => {
  const site = await serve();
  try {
    const dir = studio('phone');
    writeFileSync(join(dir, 'phone.json'), JSON.stringify({
      path: '/', device: 'phone', tail: 0.5, steps: [
        { click: 'a[data-play]' },
        { waitFor: { frame: 'game', js: 'window.__demo && window.__demo.frames > 5' } },
        { tap: { frame: 'game', selector: 'canvas' } },
        { drag: { frame: 'game', selector: 'canvas', offset: [0.5, 0.7], to: [80, 0], ms: 300, hold: 200 } },
        { waitFor: { frame: 'game', js: 'window.__demo.clicks >= 2' } },
      ],
    }));
    const r = await video(['record', 'demo', '--steps', join(dir, 'phone.json'), '--url', site.url, '--name', 'phone'], dir);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.file, 'videos/demo/work/record-phone/recording.mp4');
    assert.ok(r.inputs.game.touches >= 2, JSON.stringify(r.inputs));
    const p = probe(join(dir, r.file));
    assert.deepEqual([p.width, p.height], [1080, 1920]);
  } finally { site.close(); }
});

test('record: a step that fails is named, the take is kept, and the result is not ok', async () => {
  const site = await serve();
  try {
    const dir = studio('failing');
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ path: '/', tail: 0.3, steps: [{ wait: 300 }, { waitFor: '#never', timeout: 800 }, { click: 'a[data-play]' }] }));
    const r = await video(['record', 'demo', '--steps', join(dir, 'bad.json'), '--url', site.url], dir);
    assert.equal(r.ok, false);
    assert.equal(r.failed.step, 2);
    assert.equal(r.failed.do, 'waitFor');
    assert.match(r.failed.why, /#never|Waiting|timeout/i);
    assert.ok(existsSync(join(dir, r.file)), 'what was recorded is kept, to look at');
    const j = JSON.parse(readFileSync(join(dir, r.json), 'utf8'));
    assert.equal(j.steps.length, 2, 'it stops at the failed step');
  } finally { site.close(); }
});

test('record: no frame is ever made up: the frame code has no interpolation or blending anywhere', () => {
  for (const f of ['lib/frames.mjs', 'record-page.mjs', 'capture-game.mjs']) {
    const src = readFileSync(join(SCRIPTS, f), 'utf8');
    assert.doesNotMatch(src, /minterpolate|tblend|framerate=|tmix|blend=/, `${f} never interpolates or blends frames`);
  }
});
