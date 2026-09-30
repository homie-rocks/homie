/**
 * The video skill's script against a stand-in fal (fixtures/fake-fal.mjs): live
 * pricing, a budget that refuses, one approved call with its receipt written the
 * moment it is accepted, a resume that never pays twice, uploads, the beat grid,
 * the lag check, an edit cut on bars from a gameplay capture, cards, both
 * deliveries at -14 LUFS, the sync check, a contact sheet, the draw-over film and
 * the video page. No account, no money. Needs ffmpeg and Chrome.
 * Run: node --test plugins/homie/test/video.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startFakeFal } from './fixtures/fake-fal.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..');
const VIDEO = join(PLUGIN, 'skills', 'video', 'scripts', 'video.mjs');
const STUDIO_PKG = join(PLUGIN, '..', '..', 'packages', 'studio');
const REPO_NM = join(PLUGIN, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-video-test-')));
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
const ffmpeg = (...args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };

test('video: priced, capped and receipted fal calls; a resume never pays twice; grid, lag, an edit on bars from gameplay, both cuts, sync, sheet, film, page', async () => {
  const fal = await startFakeFal();
  const env = { ...process.env, FAL_KEY: 'test-key', FAL_QUEUE_URL: fal.base, FAL_API_URL: fal.base, FAL_STORAGE_URL: fal.base };
  const video = (args, cwd, extra = {}) => new Promise((ok) => {
    const p = spawn(process.execPath, [VIDEO, ...args, '--json'], { cwd, env: { ...env, ...extra } });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => { try { ok(JSON.parse(out)); } catch { ok({ ok: false, why: `no JSON: ${out} ${err}` }); } });
  });
  try {
    const dir = studio('owls');
    const c = await video(['check'], dir);
    assert.equal(c.fal.ok, true, JSON.stringify(c));
    assert.equal((await video(['check'], dir, { FAL_KEY: 'wrong' })).fal.ok, false, 'a wrong key is caught for free');

    writeFileSync(join(dir, 'still.json'), JSON.stringify({ prompt: 'a paper owl', image_size: { width: 1024, height: 576 } }));
    assert.equal((await video(['price', '--model', 'fal-ai/flux/dev', '--input', join(dir, 'still.json')], dir)).usd, 0.025);
    writeFileSync(join(dir, 'clip.json'), JSON.stringify({ prompt: 'the owl sings @Audio1', image_urls: ['@file:../../still.png'], audio_urls: ['@file:work/ref.wav'], resolution: '480p', duration: '5', aspect_ratio: '16:9' }));
    const p = await video(['price', '--model', 'bytedance/seedance-2.5/reference-to-video', '--input', join(dir, 'clip.json')], dir);
    assert.equal(p.usd, 1.1025, '5 s at 480p is priced from fal\'s own unit price before anything is sent');
    writeFileSync(join(dir, 'auto.json'), JSON.stringify({ prompt: 'x', resolution: '720p', duration: 'auto' }));
    assert.match((await video(['price', '--model', 'bytedance/seedance-2.5/reference-to-video', '--input', join(dir, 'auto.json')], dir)).why, /explicit duration/, 'an unpriceable input is refused, not guessed');

    // The song (a click track at 120 BPM) and a cut of it as the clip's audio reference.
    mkdirSync(join(dir, 'music', 'theme'), { recursive: true });
    ffmpeg('-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*55*t)*exp(-25*mod(t,0.5))+0.2*sin(2*PI*660*t)*exp(-9*mod(t+0.25,0.5))':s=48000:d=20:c=stereo", '-c:a', 'libmp3lame', '-b:a', '192k', join(dir, 'music/theme/theme.mp3'));
    writeFileSync(join(dir, 'music/manifest.json'), JSON.stringify({ v: 1, items: [{ slug: 'theme', title: 'Theme', published: true, files: [{ role: 'audio', path: 'music/theme/theme.mp3' }] }] }));
    const g = await video(['grid', 'owl-mv', '--song', 'theme'], dir);
    assert.ok(Math.abs(g.bpm - 120) < 0.6, `grid at ${g.bpm} BPM`);
    assert.ok(Math.abs(g.barSeconds - 2) < 0.02);
    const sl = await video(['slice', 'owl-mv', '--from', '0', '--to', '5', '--out', 'work/ref.wav'], dir);
    assert.equal(sl.ok, true);
    ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=1024x576:d=1', '-frames:v', '1', join(dir, 'still.png'));

    assert.match((await video(['gen', 'owl-mv', '--model', 'bytedance/seedance-2.5/reference-to-video', '--input', join(dir, 'clip.json'), '--out', 'work/bases/s01.mp4', '--yes'], dir)).why, /no budget set/);
    await video(['budget', 'owl-mv', '--cap', '1.00'], dir);
    assert.match((await video(['gen', 'owl-mv', '--model', 'bytedance/seedance-2.5/reference-to-video', '--input', join(dir, 'clip.json'), '--out', 'work/bases/s01.mp4', '--yes'], dir)).why, /REFUSED: US\$0\.00 spent \+ US\$1\.10 .* cap of US\$1\.00/);
    await video(['budget', 'owl-mv', '--cap', '3'], dir);
    const ask = await video(['gen', 'owl-mv', '--model', 'bytedance/seedance-2.5/reference-to-video', '--input', join(dir, 'clip.json'), '--out', 'work/bases/s01.mp4'], dir);
    assert.equal(ask.needs, 'approval');
    assert.equal(fal.stats.submits, 0, 'nothing was sent before approval');
    const made = await video(['gen', 'owl-mv', '--model', 'bytedance/seedance-2.5/reference-to-video', '--input', join(dir, 'clip.json'), '--out', 'work/bases/s01.mp4', '--yes'], dir);
    assert.equal(made.ok, true, JSON.stringify(made));
    assert.equal(fal.stats.submits, 1);
    assert.equal(fal.stats.uploads, 2, 'the still and the audio reference were uploaded');
    assert.match(fal.stats.lastInput.audio_urls[0], /\/files\/u\d$/, '@file: became an uploaded URL');
    assert.equal(made.spent, 1.1025);
    const rcpt = readFileSync(join(dir, 'videos/receipts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual([rcpt.length, rcpt[0].cost, rcpt[0].requestId], [1, 1.1025, 'req-1']);
    // A crash after the submit: the output is gone but the request is kept. The rerun polls; it does not pay again.
    unlinkSync(join(dir, 'videos/owl-mv/work/bases/s01.mp4'));
    const resumed = await video(['gen', 'owl-mv', '--model', 'bytedance/seedance-2.5/reference-to-video', '--input', join(dir, 'clip.json'), '--out', 'work/bases/s01.mp4', '--yes'], dir);
    assert.equal(resumed.ok, true);
    assert.equal(fal.stats.submits, 1, 'resumed, not resubmitted');
    assert.equal(JSON.parse(readFileSync(join(dir, 'videos/owl-mv/budget.json'), 'utf8')).spent, 1.1025, 'and not charged twice in the ledger');

    const lag = await video(['lag', 'owl-mv', '--base', join(dir, 'videos/owl-mv/work/bases/s01.mp4'), '--ref', join(dir, 'videos/owl-mv/work/ref.wav')], dir);
    assert.equal(lag.ok, true, JSON.stringify(lag));
    assert.ok(Math.abs(lag.lagMs) <= 42 && lag.peak >= 8);

    // The film: frames of the generated clip under the draw-over, with the song's words (none here) and beats.
    const fi = await video(['film', 'init', 'owl-mv'], dir);
    assert.ok(fi.wrote.includes('film/look.js'));
    assert.equal((await video(['film', 'frames', 'owl-mv', '--base', join(dir, 'videos/owl-mv/work/bases/s01.mp4'), '--id', 'shot-01'], dir)).frames, 96);
    const shots = JSON.parse(readFileSync(join(dir, 'videos/owl-mv/film/shots.json'), 'utf8'));
    shots.length = 2; shots.audio = 'work/ref.wav'; shots.shots = [{ at: 0, dur: 2, base: 'work/frames/shot-01', focus: [0.5, 0.5], type: 'big', side: 'left' }];
    writeFileSync(join(dir, 'videos/owl-mv/film/shots.json'), JSON.stringify(shots));
    const fr = await video(['film', 'render', 'owl-mv'], dir);
    assert.equal(fr.ok, true, JSON.stringify(fr));
    assert.ok(Math.abs(fr.seconds - 2) < 0.1);

    // A trailer: a "capture" (a moving, colour-shifting picture with a beep on every beat), an edit on bars, cards, cuts.
    const capDir = join(dir, 'videos/owl-trailer/work/capture');
    mkdirSync(capDir, { recursive: true });
    ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=24', '-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*880*t)*lt(mod(t,0.5),0.05)':s=48000:d=24:c=stereo", '-vf', 'hue=h=t*45', '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(capDir, 'capture.mp4'));
    writeFileSync(join(capDir, 'capture.json'), JSON.stringify({ audio: { peakDb: -6 }, honesty: 'Recorded from the game running in a live public room.' }));
    for (const [name, text] of [['title', 'OWL RUSH'], ['end', 'Play free']]) assert.equal((await video(['card', 'owl-trailer', '--name', name, '--text', text, '--sub', 'night owls'], dir)).files.length, 2);
    const e = await video(['edl', 'owl-trailer', '--length', '10', '--song', 'theme', '--title', 'OWL RUSH'], dir);
    assert.equal(e.ok, true, JSON.stringify(e));
    assert.deepEqual([e.title, e.shots, e.end], [2, 2, 4], 'at 120 BPM: a one-bar title, two one-bar shots, the rest on the end card');
    for (const t of e.cuts) assert.ok(Math.abs(t / 2 - Math.round(t / 2)) < 1e-6, `cut ${t} is on a bar line`);
    const cut = await video(['cut', 'owl-trailer'], dir);
    assert.equal(cut.ok, true, JSON.stringify(cut));
    assert.deepEqual([cut.outputs['16x9'].width, cut.outputs['16x9'].height, cut.outputs['9x16'].width, cut.outputs['9x16'].height], [1920, 1080, 1080, 1920]);
    assert.ok(Math.abs(cut.outputs['16x9'].loudness.lufs + 14) <= 1, `delivered at ${cut.outputs['16x9'].loudness.lufs} LUFS`);
    const s = await video(['sync', 'owl-trailer'], dir);
    assert.equal(s.ok, true, JSON.stringify(s.rows));
    assert.ok(s.judged >= 2, 'the cuts were judged');
    const sh = await video(['sheet', 'owl-trailer', '--in', join(dir, 'videos/owl-trailer/owl-trailer.mp4')], dir);
    assert.ok(existsSync(join(dir, sh.file)));
    const a = await video(['add', 'owl-trailer', '--title', 'Owl Rush trailer', '--for-song', 'theme', '--kind', 'trailer', '--publish'], dir);
    assert.equal(a.ok, true, JSON.stringify(a));
    const entry = JSON.parse(readFileSync(join(dir, 'videos/manifest.json'), 'utf8')).items[0];
    assert.deepEqual(entry.files.map((f) => f.role), ['video', 'vertical', 'poster']);
    assert.match(entry.honesty, /live public room/);
    const pub = await video(['publish', 'owl-trailer', '--no-deploy'], dir);
    assert.equal(pub.ok, true, JSON.stringify(pub));
    assert.deepEqual(pub.built, ['owl-trailer']);
    assert.ok(existsSync(join(dir, 'site/dist/videos/owl-trailer/owl-trailer.mp4')));
  } finally { await fal.close(); }
});
