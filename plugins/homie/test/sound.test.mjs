/**
 * The sound skill's script, end to end, on this computer only (nothing to pay, nothing sent):
 * an effect set at its loudness classes, a score with stems and seamless loops cut to the sample,
 * a mix that refuses the expressions that fail silently, the analyzer's warnings, the files wired
 * into a game, the manifest entry, and the in-game player in a real browser.
 * Run: node --test plugins/homie/test/sound.test.mjs   (needs ffmpeg; the player test needs Chrome)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fft } from '../skills/music/scripts/lib/audio.mjs';
import { measure, steadyTone, warnings } from '../skills/sound/scripts/lib/measure.mjs';
import { INSTRUMENTS, loop, render, seamWarning } from '../skills/sound/scripts/lib/score.mjs';
import { LEVELS } from '../skills/sound/scripts/lib/sfx.mjs';
import { RATE, drum, hzOf, hzOfMidi, mixMono, pluck, voice, wavBytes } from '../skills/sound/scripts/lib/synth.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..');
const SOUND = join(PLUGIN, 'skills', 'sound', 'scripts', 'sound.mjs');
const STUDIO_PKG = join(PLUGIN, '..', '..', 'packages', 'studio');
const REPO_NM = join(PLUGIN, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-sound-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const sound = (args, cwd) => {
  const r = spawnSync(process.execPath, [SOUND, ...args, '--json'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(r.stdout); } catch { throw new Error(`no JSON from sound ${args.join(' ')}: ${r.stdout}${r.stderr}`); }
};

function studio(name) {
  const dir = join(scratch, name);
  const r = spawnSync(process.execPath, [join(STUDIO_PKG, 'bin', 'homie-studio.mjs'), 'new', dir, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(STUDIO_PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  const g = spawnSync(process.execPath, [join(STUDIO_PKG, 'bin', 'homie-studio.mjs'), 'game', 'new', 'gem', '--from', 'gem-rush', '--name', 'Gem Test', '--json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(g.status, 0, g.stdout + g.stderr);
  return dir;
}

const SCORE = {
  title: 'Owl Theme', bpm: 120, key: 'A minor',
  instruments: {
    lead: { preset: 'pulse-lead', db: -9, stepsPerBeat: 2, echo: { beats: 0.75, feedback: 0.3, mix: 0.2 } },
    bass: { preset: 'saw-bass', db: -10, duck: 0.3 },
    pad: { preset: 'pad', db: -17 },
    drums: { preset: 'kit', db: -7 },
  },
  sections: [
    { name: 'calm', bars: 2, chords: 'Am F', play: { pad: 'chords', drums: 'hats' } },
    { name: 'main', bars: 4, chords: 'Am F C G', play: { lead: 'A4 . C5 . E5 - D5 C5 | B4 . G4 . B4*2 C5 D5', bass: 'root8', pad: 'chords', drums: 'four+fill' } },
  ],
  arrangement: ['calm', 'main'],
  loops: ['calm', 'main'],
};

test('sound: an effect set at its loudness classes, deterministic, every file starting at once', () => {
  const dir = studio('sfx');
  const c = sound(['check'], dir);
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.studio.games[0], 'gem');
  const p = sound(['presets'], dir);
  assert.ok(Object.keys(p.effects).length >= 25 && p.instruments['pulse-lead'] && p.grooves.includes('four'));

  const r = sound(['sfx', 'owl-sfx', '--kit', 'arcade', '--for-game', 'gem'], dir);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(String(r.warnings), /^none/, `the arcade kit passes its own checks: ${JSON.stringify(r.warnings)}`);
  const info = JSON.parse(readFileSync(join(dir, 'music', 'owl-sfx', 'sfx.json'), 'utf8'));
  assert.equal(info.effects.length, 12);
  for (const e of info.effects) {
    assert.equal(e.files.length, ['win', 'lose', 'go', 'countdown', 'powerup'].includes(e.name) ? 1 : 3, `${e.name}: signals get one take, repeated sounds three`);
    for (const f of e.files) {
      assert.ok(existsSync(join(dir, f.file)) && existsSync(join(dir, f.ogg)), `${f.file} and its Ogg exist`);
      assert.ok(Math.abs(f.loudestDb - LEVELS[f.level]) < 0.6, `${f.file} sits at its class (${f.loudestDb} vs ${LEVELS[f.level]})`);
      assert.ok(f.peakDb <= -0.9, `${f.file} peaks under -1 dBFS (${f.peakDb})`);
    }
  }
  assert.ok(existsSync(join(dir, 'music', 'owl-sfx', 'owl-sfx.mp3')) && existsSync(join(dir, 'music', 'owl-sfx', 'owl-sfx-reel.png')));
  const first = readFileSync(join(dir, 'music', 'owl-sfx', 'sfx', 'jump-1.wav'));
  sound(['sfx', 'owl-sfx', '--kit', 'arcade', '--for-game', 'gem'], dir);
  assert.deepEqual(readFileSync(join(dir, 'music', 'owl-sfx', 'sfx', 'jump-1.wav')), first, 'the same spec renders the same bytes');

  writeFileSync(join(dir, 'fx.json'), JSON.stringify({ variants: 2, effects: [{ name: 'stomp', preset: 'land', pitch: -3, level: 'big' }, { name: 'nope', preset: 'no-such' }] }));
  const bad = sound(['sfx', 'mine', '--spec', join(dir, 'fx.json')], dir);
  assert.equal(bad.ok, false);
  assert.match(bad.why, /no preset "no-such"/);
});

test('sound: a score renders a master, stems and seamless loops cut to the sample, and its bar grid', () => {
  const dir = studio('score');
  mkdirSync(join(dir, 'music'), { recursive: true });
  writeFileSync(join(dir, 'music', 'owl.json'), JSON.stringify(SCORE));
  const r = sound(['score', 'owl-theme', '--spec', 'music/owl.json'], dir);
  assert.equal(r.ok, true, JSON.stringify(r));
  const job = join(dir, 'music', 'owl-theme');
  for (const f of ['owl-theme.mp3', 'owl-theme-master.wav', 'plan.json', 'master.json', 'score.json', 'stems/lead.wav', 'stems/drums.wav', 'stems/reverb.wav']) assert.ok(existsSync(join(job, f)), f);
  const bar = 2; // 4 beats at 120 bpm
  for (const [name, bars] of [['calm', 2], ['main', 4]]) {
    const wav = join(job, `owl-theme-${name}-loop-${bars}bars.wav`);
    assert.equal((statSync(wav).size - 44) / 4, bars * bar * 48000, `${name}: exactly ${bars} bars of samples`);
    const j = JSON.parse(readFileSync(wav.replace(/\.wav$/, '.json'), 'utf8'));
    assert.ok(j.seam <= 1, `${name} loops without a seam (${j.seam})`);
    assert.ok(existsSync(wav.replace(/\.wav$/, '.ogg')));
  }
  const plan = JSON.parse(readFileSync(join(job, 'plan.json'), 'utf8'));
  assert.deepEqual(plan.sections.map((s) => [s.name, s.startMs]), [['calm', 0], ['main', 4000]]);
  const master = JSON.parse(readFileSync(join(job, 'master.json'), 'utf8'));
  assert.ok(Math.abs(master.mp3.lufs + 14) < 1.2, `about -14 LUFS (${master.mp3.lufs})`);
  assert.ok(master.mp3.truePeak <= -0.5, `true peak ${master.mp3.truePeak}`);

  const wrong = structuredClone(SCORE);
  wrong.sections[1].play.lead = 'A4 . C5 . E5 - D5 | B4 . G4 . B4*2 C5 D5';
  writeFileSync(join(dir, 'music', 'wrong.json'), JSON.stringify(wrong));
  const w = sound(['score', 'wrong', '--spec', 'music/wrong.json'], dir);
  assert.equal(w.ok, false);
  assert.match(w.why, /section "main", lead: bar 1 has 7 steps, a bar here is 8/);
});

test('sound: a mix sums at the levels written and refuses the expressions that fail silently', () => {
  const dir = studio('mix');
  const job = join(dir, 'music', 'bed');
  mkdirSync(job, { recursive: true });
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-ac', '2', '-ar', '48000', join(job, 'tone.wav')]);
  const mix = (parts, master) => { writeFileSync(join(job, 'mix.json'), JSON.stringify({ parts, master })); return sound(['mix', 'bed'], dir); };
  const ok = mix([{ file: 'music/bed/tone.wav', db: -6 }, { expr: ['0.2*sin(6.28318*220*t)*exp(-max(0,t-0.5)*3)', '0.2*sin(6.28318*221*t)*exp(-max(0,t-0.5)*3)'], seconds: 2, at: 0.5 }, { effect: 'coin', at: 1 }], { lufs: -16 });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.ok(Math.abs(ok.loudness.lufs + 16) < 1, `brought to -16 LUFS (${ok.loudness.lufs})`);
  assert.match(mix([{ expr: 'gte(t,1)*0.5*sin(6.28318*440*t)*(t>=1)', seconds: 2 }]).why, /no comparison operators: use gte/);
  assert.match(mix([{ expr: '0*sin(t)', seconds: 1 }]).why, /rendered silence/);
  assert.match(mix([{ expr: "0.5*sin('1')", seconds: 1 }]).why, /quotes/);
  assert.match(mix([{ expr: '0.5*sin(t)' }]).why, /needs "seconds"/);
});

test('sound: the analyzer says what a person will hear wrong', () => {
  const dir = studio('analyze');
  const f = (name, src, extra = []) => { const p = join(dir, name); spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', src, ...extra, '-ar', '48000', p]); return p; };
  const low = sound(['analyze', f('low.wav', 'sine=f=70:d=2'), '--kind', 'music'], dir);
  assert.ok(low.warnings.some((w) => /phone speaker/.test(w)), JSON.stringify(low.warnings));
  const hot = sound(['analyze', f('hot.wav', 'aevalsrc=exprs=1.4*sin(6.28318*440*t):d=1', ['-c:a', 'pcm_f32le'])], dir);
  assert.ok(hot.clippedSamples > 0 || hot.warnings.some((w) => /clip|true peak/.test(w)), JSON.stringify(hot.warnings));
  const dc = sound(['analyze', f('dc.wav', 'aevalsrc=exprs=0.3+0.2*sin(6.28318*440*t):d=1'), '--kind', 'sfx'], dir);
  assert.ok(dc.warnings.some((w) => /DC offset/.test(w)), JSON.stringify(dc.warnings));
  const late = sound(['analyze', f('late.wav', 'aevalsrc=exprs=gte(t\\,0.08)*0.5*sin(6.28318*880*t):d=0.3'), '--kind', 'sfx'], dir);
  assert.ok(late.warnings.some((w) => /starts \d+ ms late/.test(w)), JSON.stringify(late));
});

test('sound: wired into a game, listed in the manifest, and the player starts on the first touch in a real browser', async () => {
  const dir = studio('wire');
  mkdirSync(join(dir, 'music'), { recursive: true });
  writeFileSync(join(dir, 'music', 'owl.json'), JSON.stringify(SCORE));
  assert.equal(sound(['sfx', 'owl-sfx', '--only', 'jump,coin,win', '--for-game', 'gem'], dir).ok, true);
  assert.equal(sound(['score', 'owl-theme', '--spec', 'music/owl.json'], dir).ok, true);
  const w = sound(['wire', 'owl-sfx', 'owl-theme', '--game', 'gem'], dir);
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.equal(w.mode, 'bundle');
  assert.deepEqual(w.sfx.sort(), ['coin', 'jump', 'win']);
  assert.deepEqual(w.music['owl-theme'], ['calm', 'main']);
  const assets = join(dir, 'games', 'gem', 'public', 'sound');
  const manifest = JSON.parse(readFileSync(join(assets, 'sound.json'), 'utf8'));
  assert.deepEqual(manifest.music['owl-theme'].loops.calm, ['owl-theme-calm-loop-2bars.ogg', 'owl-theme-calm-loop-2bars.wav'], 'Ogg first, WAV as the fallback');
  assert.ok(existsSync(join(dir, 'games', 'gem', 'src', 'sound.js')) && existsSync(join(dir, 'games', 'gem', 'src', 'sound.d.ts')), 'the player and its types');

  const a = sound(['add', 'owl-theme', '--title', 'Owl Theme', '--for-game', 'gem', '--publish'], dir);
  assert.equal(a.kind, 'score');
  const s = sound(['add', 'owl-sfx', '--title', 'Owl effects', '--publish'], dir);
  assert.equal(s.kind, 'sfx');
  const items = JSON.parse(readFileSync(join(dir, 'music', 'manifest.json'), 'utf8')).items;
  const theme = items.find((x) => x.slug === 'owl-theme');
  assert.match(theme.credits, /Synthesized/);
  assert.equal(theme.files.filter((f) => f.role === 'loop').length, 2);
  assert.equal(items.find((x) => x.slug === 'owl-sfx').for.game, 'gem');

  // The player, in Chrome: nothing before a gesture; after one, music on its first loop and effects that play.
  const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
  let puppeteer = null; try { const m = createRequire(join(REPO_NM, 'x.js'))('puppeteer-core'); puppeteer = m.default ?? m; } catch { /* */ }
  if (!chrome || !puppeteer) return;
  const root = join(dir, 'games', 'gem');
  writeFileSync(join(root, 'public', 'test.html'), '<!doctype html><body><script type="module">import { createSound } from "./player.js"; window.sound = createSound({ base: "sound/" }); window.sound.music("owl-theme");</script>');
  writeFileSync(join(root, 'public', 'player.js'), readFileSync(join(root, 'src', 'sound.js')));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
  const server = createServer((req, res) => { const p = join(root, 'public', decodeURIComponent(req.url.split('?')[0])); if (!existsSync(p)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const profile = mkdtempSync(join(tmpdir(), 'homie-sound-player-'));
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: profile, args: ['--mute-audio', '--no-first-run'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/test.html`);
    await page.waitForFunction(() => window.sound && window.sound.state().loaded >= 5, { timeout: 20_000 });
    const before = await page.evaluate(() => window.sound.state());
    assert.equal(before.running, false, 'no sound before a gesture');
    await page.mouse.click(10, 10);
    await page.waitForFunction(() => window.sound.state().music, { timeout: 10_000 });
    const after = await page.evaluate(() => { window.sound.play('coin'); window.sound.play('nope'); return { ...window.sound.state(), plays: window.__homieSound.stats.plays.map((p) => p.name) }; });
    assert.equal(after.running, true);
    assert.equal(after.music.section, 'calm', 'the theme starts on its first loop');
    assert.deepEqual(after.missing, ['nope'], 'an unknown effect is named, never silent');
    assert.ok(after.plays.includes('coin'));
    assert.deepEqual(after.errors, []);
  } finally {
    await browser?.close().catch(() => {});
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

/** The frequency of the strongest partial in a mono buffer between `from` and `to` seconds (a 32768-point Hann FFT: bins 1.46 Hz apart, the peak refined between bins). */
function peakHz(buf, from = 0.1, to = null) {
  const N = 32768;
  const a = Math.round(from * RATE);
  const b = Math.min(buf.length, to === null ? a + N : Math.round(to * RATE));
  const re = new Float64Array(N); const im = new Float64Array(N);
  for (let i = 0; i < N && a + i < b; i++) re[i] = buf[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (b - a - 1)));
  fft(re, im);
  let best = 1; let bp = 0;
  const p = (k) => re[k] * re[k] + im[k] * im[k];
  for (let k = 2; k < N / 2 - 1; k++) if (p(k) > bp) { bp = p(k); best = k; }
  const l = Math.log(p(best - 1) + 1e-30); const c = Math.log(bp + 1e-30); const r = Math.log(p(best + 1) + 1e-30);
  return (best + 0.5 * (l - r) / (l - 2 * c + r)) * RATE / N;
}

test('sound: a number is hertz, a MIDI note is said out loud, and a bass note sounds where it was written', () => {
  // The defect: a preset turned its MIDI note into hertz, and the voice read a number of 127 or less as MIDI again.
  // A2 (110 Hz) came out as MIDI 110 = 4698.6 Hz; B2 (123.47 Hz) as 10.2 kHz. Every bass note is under 127 Hz.
  assert.equal(hzOf(110), 110, 'a number is hertz');
  assert.equal(hzOf(60), 60, 'and stays hertz under 127');
  assert.ok(Math.abs(hzOf('A2') - 110) < 1e-9 && Math.abs(hzOfMidi(45) - 110) < 1e-9);
  assert.throws(() => hzOf(0), /not a frequency/);
  assert.throws(() => voice({ freq: 110, midi: 45 }), /not both/);
  assert.throws(() => voice({ midi: 'A2' }), /not a MIDI note/);

  const near = (hz, want, what) => assert.ok(Math.abs(hz - want) < 1.5, `${what}: the peak is at ${hz.toFixed(2)} Hz, wanted ${want}`);
  const held = { gate: 1.2, env: { a: 0.005, d: 0.1, s: 0.9, r: 0.05 } };
  near(peakHz(voice({ wave: 'sine', freq: 110, ...held })), 110, 'freq: 110');
  near(peakHz(voice({ wave: 'sine', freq: 'A2', ...held })), 110, 'freq: "A2"');
  near(peakHz(voice({ wave: 'sine', midi: 45, ...held })), 110, 'midi: 45');
  near(peakHz(voice({ wave: 'sine', freq: 123.47, ...held })), 123.47, 'freq: 123.47 (B2)');
  near(peakHz(voice({ wave: 'sine', midi: 110, ...held })), 4698.64, 'midi: 110 is the high note, when it is asked for');
  // A plucked string's loudest partial is one of its harmonics: it has to be a whole multiple of 110 (4698.6 is not).
  const pl = peakHz(pluck({ freq: 110, gate: 1.2 })) / (RATE / Math.round(RATE / 110));
  assert.ok(Math.abs(pl - Math.round(pl)) < 0.03 && pl < 30, `a plucked 110 rings on a harmonic of 110 (x${pl.toFixed(3)})`);
  // A slide target follows the same rule: 220 Hz down to 110 Hz ends at 110, and a MIDI target is toMidi.
  near(peakHz(voice({ wave: 'sine', freq: 220, slide: { to: 110, time: 0.2 }, ...held }), 0.4), 110, 'slide to 110');
  near(peakHz(voice({ wave: 'sine', freq: 220, slide: { toMidi: 47, time: 0.2 }, ...held }), 0.4), 123.47, 'slide toMidi 47');
  assert.throws(() => voice({ freq: 220, slide: { to: 110, toMidi: 45 } }), /not both/);
  // The synthesized tom falls to 110 Hz (its slide target was read as MIDI 110 and it rose to 4.7 kHz instead).
  assert.ok(peakHz(drum('tom'), 0.2, 0.34) < 200, `the tom ends low (${peakHz(drum('tom'), 0.2, 0.34).toFixed(0)} Hz)`);

  // Every bass preset, from the note the score hands it: A2 and B2.
  for (const [name, def] of Object.entries(INSTRUMENTS)) {
    if (def.role !== 'bass') continue;
    near(peakHz(def.play(45, 1.2, 1)), 110, `${name} A2`);
    near(peakHz(def.play(47, 1.2, 1)), 123.47, `${name} B2`);
  }
  // And through a whole score: a bass line on the roots of Am and Bm is A2 then B2, with nothing up at 4.7 or 10.2 kHz.
  const r = render({ bpm: 120, instruments: { bass: { preset: 'triangle-bass', db: -6, reverb: 0 } }, sections: [{ name: 'a', bars: 2, chords: 'Am Bm', play: { bass: 'root' } }] }, { tail: 0 });
  near(peakHz(r.stems.bass.L, 0.2, 0.85), 110, 'score, bar 1 (Am)');
  near(peakHz(r.stems.bass.L, 2.2, 2.85), 123.47, 'score, bar 2 (Bm)');
});

test('sound: a steady hum is called one, with its level and how much of the time it is there; a melody\'s brief high partial is not', () => {
  const dir = join(scratch, 'hum'); mkdirSync(dir, { recursive: true });
  // (a) a hum: a 1 kHz tone under eight seconds of quiet noise, there the whole time.
  const hum = join(dir, 'hum.wav');
  const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=8:c=pink:a=0.05:r=48000:seed=4', '-f', 'lavfi', '-i', 'sine=f=1000:d=8:r=48000', '-filter_complex', '[1:a]volume=1.6[t];[0:a][t]amix=inputs=2:normalize=0', '-ac', '2', hum]);
  assert.equal(made.status, 0, String(made.stderr));
  const a = measure(hum);
  const tone = steadyTone(a);
  assert.ok(tone && Math.abs(tone.hz - 1000) < 15, `the hum is found: ${JSON.stringify(a.narrowTones)}`);
  assert.ok(tone.presentShare > 0.95 && tone.levelDb > -30 && tone.levelDb < -10 && tone.energyShare > 0.3, JSON.stringify(tone));
  const wa = warnings(a, 'capture').find((w) => /steady tone/.test(w));
  assert.match(wa, /steady tone at \d+(\.\d+)? Hz: there \d+% of the time at -?[\d.]+ dBFS \([\d.]+% of the energy\)/, 'the warning carries the level, the share and the persistence');

  // (b) a melody, sixteen seconds, whose top carries a narrow partial near 10.2 kHz for two short stretches.
  const notes = ['A4', 'C5', 'E5', 'D5', 'C5', 'B4', 'G4', 'A4', 'E5', 'D5', 'B4', 'C5', 'A4', 'G4', 'B4', 'A4'];
  const parts = notes.map((n, i) => ({ at: i, buf: voice({ wave: 'triangle', freq: n, gate: 0.9, env: { a: 0.01, d: 0.1, s: 0.8, r: 0.08 }, gain: 0.4 }) }));
  for (const at of [3, 11]) parts.push({ at, buf: voice({ wave: 'sine', freq: 10230.54, gate: 0.9, env: { a: 0.01, d: 0.1, s: 0.9, r: 0.05 }, gain: 0.15 }) });
  const tune = join(dir, 'tune.wav');
  writeFileSync(tune, wavBytes(mixMono(parts)));
  const b = measure(tune);
  const partial = b.narrowTones.find((t) => Math.abs(t.hz - 10230) < 20);
  assert.ok(partial && partial.prominenceDb > 25, `the partial is narrow and prominent, as before: ${JSON.stringify(b.narrowTones)}`);
  assert.ok(partial.presentShare > 0.05 && partial.presentShare < 0.2, `and it is there about an eighth of the time (${partial.presentShare})`);
  assert.equal(steadyTone(b), null, `nothing in a melody is a steady tone: ${JSON.stringify(b.narrowTones)}`);
  assert.equal(warnings(b, 'capture').some((w) => /steady tone/.test(w)), false);
  // A tone nobody can hear is prominent too (nothing else is near it): the level floor keeps it out.
  assert.equal(steadyTone({ narrowTones: [{ hz: 9000, prominenceDb: 40, levelDb: -75, energyShare: 0, presentShare: 1 }] }), null);
});

test('sound: a loop stays seamless through the master\'s limiter, and one that does not repeat is a warning, never an empty list', () => {
  // Limited after the cut, these loops had a step of gain at the wrap (seams of 5 to 15); a plucked string on the
  // bar line was called a seam when it is the music; at 140 bpm a bar is not a whole number of samples.
  const one = (preset, pat, bpm, extra = {}) => ({ bpm, instruments: { a: { preset, db: -6, ...extra } }, sections: [{ name: 'main', bars: 2, chords: 'Am Bm', play: { a: pat } }] });
  for (const [preset, pat, bpm, extra] of [['soft-lead', 'root8', 128, { legato: 1.5 }], ['square-bass', 'chords', 96, { legato: 1.5 }], ['pluck', 'chords', 140, {}], ['saw-lead', 'octaves', 128, {}]]) {
    const lp = loop(one(preset, pat, bpm, extra), 'main', { gain: 3, ceilingDb: -1.2 });
    assert.ok(lp.seam <= 1, `${preset} ${pat} at ${bpm}: seam ${lp.seam}`);
    assert.equal(lp.mix.L.length, Math.round(2 * (240 / bpm) * RATE), 'and the loop is still exactly its bars');
    let peak = 0; for (const v of lp.mix.L) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak <= 10 ** (-1.2 / 20) + 1e-3, `held under the ceiling (${peak})`);
  }
  assert.equal(seamWarning('main', 0.4), null);
  assert.match(seamWarning('main', 2.57), /loop "main": seam 2\.57 is over 1/);

  // A pad held three times as long as its one-bar section cannot repeat: the report has to say so in its warnings.
  const dir = studio('seam');
  mkdirSync(join(dir, 'music'), { recursive: true });
  writeFileSync(join(dir, 'music', 'long.json'), JSON.stringify({ bpm: 240, room: 0.95, instruments: { pad: { preset: 'pad', db: -6, reverb: 0.9, legato: 3 } }, sections: [{ name: 'main', bars: 1, chords: 'Am', play: { pad: 'chords' } }], loops: ['main'] }));
  const r = sound(['score', 'long', '--spec', 'music/long.json'], dir);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.loopsSeamless, false);
  assert.ok(r.warnings.some((w) => /loop "main": seam [\d.]+ is over 1/.test(w)), `the seam is in the warnings: ${JSON.stringify(r.warnings)}`);
  assert.match(r.loops[0], /OVER 1: NOT SEAMLESS/);
  const saved = JSON.parse(readFileSync(join(dir, 'music', 'long', 'render.json'), 'utf8'));
  assert.ok(saved.warnings.some((w) => /seam/.test(w)), 'and in the saved render report');
  const plain = spawnSync(process.execPath, [SOUND, 'score', 'long', '--spec', 'music/long.json'], { cwd: dir, encoding: 'utf8' });
  assert.match(plain.stdout, /NOT SEAMLESS/, 'the terminal summary says it too');
});
