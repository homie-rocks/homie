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
import { frameSegments } from '../skills/video/scripts/lib/frames.mjs';
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

const HAVE_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

test('video: an edit\'s cuts are counted in frames, each on the frame nearest its beat', () => {
  // 1.875 s (a bar at 128 bpm) is 56.25 frames at 30 fps. Nine of them, each trimmed by its duration, are nine
  // segments of 56 frames: the last cut two frames early and the film a quarter of a second short of its music.
  const segs = frameSegments(Array.from({ length: 9 }, () => ({ dur: 1.875 })), 30);
  assert.deepEqual(segs.map((s) => s.startFrame), [0, 56, 113, 169, 225, 281, 338, 394, 450]);
  assert.deepEqual(segs.map((s) => s.frames), [56, 57, 56, 56, 56, 57, 56, 56, 56]);
  assert.equal(segs.reduce((a, s) => a + s.frames, 0), 506, 'the whole edit is the nearest frame to 16.875 s');
  for (const s of segs) assert.ok(Math.abs(s.startFrame - s.at * 30) <= 0.5, 'no cut is more than half a frame from where it was asked for');
  // Durations already rounded to milliseconds (what an edl holds) land on the same frames.
  assert.deepEqual(frameSegments([{ dur: 1.5 }, { dur: 0.469 }, { dur: 0.469 }, { dur: 0.469 }, { dur: 2.5 }], 30).map((s) => s.frames), [45, 14, 14, 14, 75]);
});

test('video: a cut from a full-range capture is limited-range BT.709 yuv420p, tagged, with every cut on its frame', { skip: HAVE_FFMPEG ? false : 'ffmpeg and ffprobe are not installed on this machine: the cut was NOT checked' }, () => {
  const dir = studio('frames');
  const job = join(dir, 'videos', 'beat');
  mkdirSync(join(job, 'work'), { recursive: true });
  // A stand-in capture as the recorder used to write them: full range (what a JPEG frame is), ffprobe says yuvj420p.
  // Its grey level steps every four seconds, so the picture says which part of the source a frame came from.
  const cap = join(job, 'work', 'cap.mp4');
  ffmpeg('-f', 'lavfi', '-i', "nullsrc=s=320x180:r=30:d=37,geq=lum='40+20*floor(T/4)':cb=128:cr=128,format=yuv420p,setparams=range=pc", '-f', 'lavfi', '-i', 'sine=f=440:d=37:r=48000', '-ac', '2',
    '-color_range', 'pc', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-c:a', 'aac', cap);
  const probeV = (file, entries) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', `stream=${entries}`, '-of', 'json', file], { encoding: 'utf8' }).stdout).streams[0];
  assert.equal(probeV(cap, 'pix_fmt').pix_fmt, 'yuvj420p', 'the stand-in is full range, like a capture made of JPEG frames');
  // Nine shots of one bar at 128 bpm, each from the middle of its own grey step; no cards (no browser needed).
  const edl = { fps: 30, length: 16.875, bed: null, gameAudio: { gainDb: 0 }, segments: Array.from({ length: 9 }, (_, k) => ({ type: 'clip', src: 'work/cap.mp4', in: 4 * k + 0.5, dur: 1.875 })) };
  writeFileSync(join(job, 'work', 'edl.json'), JSON.stringify(edl));
  const r = spawnSync(process.execPath, [VIDEO, 'cut', 'beat', '--json'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.frames, 506);
  assert.deepEqual(out.cuts.map((c) => c.frame), [56, 113, 169, 225, 281, 338, 394, 450]);
  assert.ok(out.cuts.every((c) => Math.abs(c.offFrames) <= 0.5));
  for (const name of ['beat.mp4', 'beat-vertical.mp4']) {
    const file = join(job, name);
    const v = probeV(file, 'nb_read_packets,pix_fmt,color_range,color_primaries,color_transfer,color_space,r_frame_rate');
    assert.deepEqual([v.pix_fmt, v.color_range, v.color_primaries, v.color_transfer, v.color_space, v.r_frame_rate], ['yuv420p', 'tv', 'bt709', 'bt709', 'bt709', '30/1'], name);
    assert.equal(Number(v.nb_read_packets), 506, `${name}: every frame of the edit, no more`);
    // Every frame's timestamp is its number over 30: nothing inherited from the source.
    const pts = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim().split('\n').map(Number).sort((a, b) => a - b);
    assert.ok(pts.every((t, k) => Math.abs(t - k / 30) < 1e-3), `${name}: frame k is at k/30 s`);
  }
  // The picture itself: the luma of the middle of each frame of the 16:9 file, straight from the file (no range change).
  const raw = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(job, 'beat.mp4'), '-vf', 'crop=iw/4:ih/4,scale=8:8', '-pix_fmt', 'yuv420p', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 }).stdout;
  const per = 8 * 8 * 1.5;
  const luma = Array.from({ length: raw.length / per }, (_, k) => { let s = 0; for (let i = 0; i < 64; i++) s += raw[k * per + i]; return s / 64; });
  assert.equal(luma.length, 506);
  const changes = []; for (let k = 1; k < luma.length; k++) if (Math.abs(luma[k] - luma[k - 1]) > 6) changes.push(k);
  assert.deepEqual(changes, [56, 113, 169, 225, 281, 338, 394, 450], 'the picture changes on exactly the frames the edit names');
  // Full-range 40 is limited-range 50 (16 + 40 * 219 / 255): the levels were converted, not just relabelled.
  assert.ok(Math.abs(luma[10] - 50.4) < 2.5, `the first shot's grey is ${luma[10].toFixed(1)}, limited range`);
  assert.ok(Math.abs(luma[500] - (16 + 200 * 219 / 255)) < 2.5, `the last shot's grey is ${luma[500].toFixed(1)}`);
  // The game's own sound is as long as the picture, to the frame.
  const a = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'json', join(job, 'beat.mp4')], { encoding: 'utf8' }).stdout).streams[0];
  assert.ok(Math.abs(Number(a.duration) - 506 / 30) < 0.05, `sound ${a.duration} s for ${(506 / 30).toFixed(3)} s of picture`);
});
