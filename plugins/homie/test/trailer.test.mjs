/**
 * The frame-by-frame recorder (record-fixed.mjs), its virtual clock (clock.js), the sound player's capture
 * log (sound.js), the offline mix (lib/remix.mjs) and `video.mjs trailer`, against a small page on this
 * computer that is deliberately too slow to film in real time (every frame waits 45 ms on a request) and that keeps
 * time five ways at once: requestAnimationFrame, performance.now, Date.now, setInterval/setTimeout, a CSS
 * animation and a Web Animation. The page writes what its own clocks say into the capture log each frame,
 * so the test reads the page's time from the page, not from the recorder.
 * Needs ffmpeg and Chrome. Run: node --test plugins/homie/test/trailer.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MIX_RATE, eventScores, remix } from '../skills/video/scripts/lib/remix.mjs';
import { mixMono, voice, wavBytes } from '../skills/sound/scripts/lib/synth.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..');
const SCRIPTS = join(PLUGIN, 'skills', 'video', 'scripts');
const VIDEO = join(SCRIPTS, 'video.mjs');
const PLAYER = join(PLUGIN, 'skills', 'sound', 'scripts', 'player', 'sound.js');
const STUDIO_PKG = join(PLUGIN, '..', '..', 'packages', 'studio');
const REPO_NM = join(PLUGIN, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-trailer-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
const HAVE_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
let HAVE_PUPPETEER = true; try { createRequire(join(REPO_NM, 'x.js')).resolve('puppeteer-core'); } catch { HAVE_PUPPETEER = false; }
const SKIP = !HAVE_FFMPEG ? 'ffmpeg and ffprobe are not installed on this machine: the recorder was NOT checked' : !CHROME || !HAVE_PUPPETEER ? 'no Chrome (or no puppeteer-core) on this machine: the recorder was NOT checked' : false;

function studio(name) {
  const dir = join(scratch, name);
  const r = spawnSync(process.execPath, [join(STUDIO_PKG, 'bin', 'homie-studio.mjs'), 'new', dir, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(STUDIO_PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  for (const p of ['esbuild', 'puppeteer-core']) symlinkSync(join(REPO_NM, p), join(dir, 'node_modules', p));
  return dir;
}

/**
 * The page. Its "game": a countdown on setInterval, a callout that a setTimeout shows and a CSS animation fades
 * in 400 ms, a bar a CSS animation slides, a dot a Web Animation moves, a blip every half second, one boom with a
 * flash at 2.5 s, and looping music. Every frame it pushes a `note` onto the capture log with what its clocks read.
 */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#10131c;color:#fff;font:700 64px system-ui;overflow:hidden}
#bar{position:absolute;top:40px;left:0;width:60px;height:60px;background:#ffcf5a;animation:slide 2s linear infinite}
@keyframes slide{from{left:0px}to{left:300px}}
#call{position:absolute;top:140px;left:40px;opacity:0}
#call.on{animation:fade .4s linear forwards}
@keyframes fade{from{opacity:1}to{opacity:0}}
#dot{position:absolute;top:240px;left:0;width:40px;height:40px;border-radius:50%;background:#6cf}
#count{position:absolute;right:40px;top:40px}
#flash{position:absolute;inset:0;background:#fff;opacity:0}
</style></head><body><div id="bar"></div><div id="call">GO!</div><div id="dot"></div><div id="count">0</div><div id="flash"></div>
<script type="module">
import { createSound } from './player.js';
const sound = createSound({ base: 'sound/' });
window.sound = sound;
const cap = window.__homieSoundCapture;
const note = (o) => { if (cap) cap.events.push({ t: performance.now(), type: 'note', ...o }); };
await sound.ready;
const T0 = performance.now(); const D0 = Date.now();
sound.music('theme');
let ticks = 0;
setInterval(() => { ticks++; document.getElementById('count').textContent = String(ticks); }, 100);
setInterval(() => { sound.play('blip', { jitter: 0 }); note({ what: 'blip', at: performance.now() - T0 }); }, 500);
setTimeout(() => { document.getElementById('call').classList.add('on'); note({ what: 'callout', at: performance.now() - T0 }); }, 1000);
setTimeout(() => { sound.play('boom', { jitter: 0, pan: -0.5 }); sound.duck(0.3, 0.5); document.getElementById('flash').style.opacity = '1'; setTimeout(() => { document.getElementById('flash').style.opacity = '0'; }, 300); note({ what: 'boom', at: performance.now() - T0 }); }, 2500);
const dot = document.getElementById('dot').animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(600px)' }], { duration: 3000, fill: 'forwards' });
let n = 0;
const frame = (ts) => {
  { const x = new XMLHttpRequest(); x.open('GET', 'slow', false); x.send(); } // a frame that takes 45 ms of the wall's time to draw
  note({ what: 'frame', n: n++, ts, now: performance.now() - T0, date: Date.now() - D0, ticks,
    left: parseFloat(getComputedStyle(document.getElementById('bar')).left), opacity: parseFloat(getComputedStyle(document.getElementById('call')).opacity),
    dot: new DOMMatrix(getComputedStyle(document.getElementById('dot')).transform).m41 });
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
window.READY = true;
</script></body></html>`;
function site(dir) {
  mkdirSync(join(dir, 'sound'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), PAGE);
  copyFileSync(PLAYER, join(dir, 'player.js'));
  const env = { a: 0.002, d: 0.05, s: 0, r: 0.01 };
  writeFileSync(join(dir, 'sound', 'blip.wav'), wavBytes(voice({ wave: 'square', freq: 1200, env, gain: 0.5 })));
  writeFileSync(join(dir, 'sound', 'boom.wav'), wavBytes(voice({ wave: 'sine', freq: 180, slide: { to: 60, time: 0.2 }, env: { a: 0.002, d: 0.4 }, gain: 0.9 })));
  // One bar at 120 bpm (2 s): a low note on each beat.
  writeFileSync(join(dir, 'sound', 'theme.wav'), wavBytes(mixMono([0, 0.5, 1, 1.5].map((at) => ({ at, buf: voice({ wave: 'triangle', freq: 220, gate: 0.3, env: { a: 0.005, d: 0.1, s: 0.6, r: 0.05 }, gain: 0.4, length: 0.5 }) })))));
  writeFileSync(join(dir, 'sound', 'sound.json'), JSON.stringify({ v: 1, sfx: { blip: [['blip.wav']], boom: [['boom.wav']] }, music: { theme: { bpm: 120, beatsPerBar: 4, barSeconds: 2, loops: { main: ['theme.wav'] } } } }));
}
async function serve(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.wav': 'audio/wav' };
  const server = createServer((req, res) => {
    // "slow" answers 45 ms later: the page asks for it, and waits, in every frame (a synchronous request), so that
    // drawing a frame costs real time whatever the page's own clock says.
    if (new URL(req.url, 'http://x').pathname === '/slow') { setTimeout(() => { res.writeHead(204); res.end(); }, 45); return; }
    let f = join(dir, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!f.startsWith(dir) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[extname(f)] ?? (extname(f) ? 'application/octet-stream' : types['.html']) }); // a file with no extension is a page
    res.end(readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
const runNode = (args, cwd) => new Promise((ok) => {
  const p = spawn(process.execPath, args, { cwd });
  let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  // video.mjs --json prints one pretty object; the recorder prints one line of JSON last.
  p.on('close', () => { try { ok(JSON.parse(out)); } catch { try { ok(JSON.parse(out.trim().split('\n').pop())); } catch { ok({ ok: false, why: `no JSON: ${out} ${err.slice(-3000)}` }); } } });
});
const streams = (file) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,nb_read_packets,pix_fmt,color_range,color_primaries,color_transfer,color_space:format=duration', '-of', 'json', file], { encoding: 'utf8' }).stdout);
/** RMS of a 16-bit stereo WAV between two seconds. */
function rmsOf(file, from, to) {
  const b = readFileSync(file);
  const a = 44 + Math.round(from * MIX_RATE) * 4; const z = Math.min(b.length - 4, 44 + Math.round(to * MIX_RATE) * 4);
  let s = 0; let n = 0;
  for (let i = a; i < z; i += 4) { const v = b.readInt16LE(i) / 32768; s += v * v; n++; }
  return Math.sqrt(s / Math.max(1, n));
}

test('remix: the capture log mixed again: a start, a rate, a pan, a loop, a stop, a duck and the faders', () => {
  const tone = (n, v) => ({ L: new Float32Array(n).fill(v), R: new Float32Array(n).fill(v), channels: 1 });
  const files = { blip: tone(4800, 0.5), bed: tone(48000, 0.25) };
  const events = [
    { t: 0, type: 'levels', master: 1, sfx: 1, music: 0.5, muted: false },
    { t: -1, type: 'start', id: 1, bus: 'music', name: 'theme/main', url: 'bed', gain: 1, rate: 1, pan: 0, loop: true, delay: 0, fadeIn: 0, bar: 2 },
    { t: 1, type: 'start', id: 2, bus: 'sfx', name: 'blip', url: 'blip', gain: 1, rate: 2, pan: 0, loop: false, delay: 0, fadeIn: 0 },
    { t: 2, type: 'start', id: 3, bus: 'sfx', name: 'blip', url: 'blip', gain: 1, rate: 1, pan: -1, loop: false, delay: 0.5, fadeIn: 0 },
    { t: 3, type: 'duck', to: 0.2, seconds: 0.5 },
    { t: 4, type: 'stop', id: 1, delay: 0, fade: 0, curve: 'cut' },
    { t: 4.2, type: 'start', id: 4, bus: 'sfx', name: 'gone', url: 'nowhere', gain: 1, rate: 1, pan: 0, loop: false, delay: 0, fadeIn: 0 },
    { t: 4.3, type: 'drop', name: 'blip', why: 'locked' },
  ];
  const m = remix(events, { seconds: 5, fileFor: (u) => (files[u] ? u : null), decode: (f) => files[f] });
  const at = (buf, s) => buf[Math.round(s * MIX_RATE)];
  // The loop that began a second before the film is already playing in its first frame, at the music fader.
  assert.ok(Math.abs(at(m.music.L, 0.5) - 0.125) < 1e-3, `music at 0.5 s is ${at(m.music.L, 0.5)}`);
  assert.ok(Math.abs(at(m.music.L, 3.4) - 0.125 * 0.2) < 2e-3, 'ducked to a fifth');
  assert.ok(Math.abs(at(m.music.L, 3.95) - 0.125) < 0.02, 'and back');
  assert.equal(at(m.music.L, 4.01), 0, 'cut when it was stopped');
  // At twice the rate a tenth of a second of file lasts a twentieth.
  assert.ok(Math.abs(at(m.sfx.L, 1.02) - 0.5) < 1e-6 && at(m.sfx.L, 1.06) === 0);
  // Panned hard left, half a second after it was asked for: a mono file goes wholly to the left.
  assert.ok(at(m.sfx.L, 2.52) > 0.49 && Math.abs(at(m.sfx.R, 2.52)) < 1e-6 && at(m.sfx.L, 2.4) === 0);
  assert.deepEqual([m.report.placed, m.report.dropped, m.report.missing], [3, 1, ['nowhere']]);
  assert.ok(Math.abs(at(m.mix.L, 1.02) - (0.5 + 0.125)) < 1e-3, 'the mix is the two buses');
  // The editor's scores: one rare sound outweighs a common one.
  const many = [...Array.from({ length: 16 }, (_, k) => ({ t: k * 0.25, type: 'start', bus: 'sfx', name: 'step', gain: 1 })), { t: 6.05, type: 'start', bus: 'sfx', name: 'win', gain: 1 }, { t: 6, type: 'start', bus: 'music', name: 'theme/main', gain: 1 }];
  const sc = eventScores(many, 8);
  assert.ok(sc.scores[60] > sc.scores[0] * 3.5 && sc.names[60].includes('win'), 'a win counts for more than a step, and music is not a highlight');
});

test('record-fixed: a page too slow for real time, filmed frame by frame; every clock in it moves 1/30 s a frame; the sound comes back from the log', { skip: SKIP }, async () => {
  const web = join(scratch, 'site-a'); site(web);
  const srv = await serve(web);
  try {
    const dir = studio('fixed'); // the recorder finds puppeteer-core from the studio it is run in
    const out = join(dir, 'videos', 'take', 'work', 'capture');
    const r = await runNode([join(SCRIPTS, 'record-fixed.mjs'), '--url', `${srv.url}/index.html`, '--out', out, '--seconds', '4', '--fps', '30', '--width', '640', '--height', '360', '--settle', '0.5', '--wait-for', 'window.READY === true', '--no-pace', '--min-free-gb', '1'], dir);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.frames, 120, 'four seconds at 30 fps is 120 frames, exactly');
    assert.equal(r.heldFrames, 0);
    // The page waits 45 ms in every frame: in real time that is 22 frames a second at best, and a real-time recorder holds the rest.
    assert.ok(r.realSeconds > 4, `it took longer than the film lasts to render (${r.realSeconds} s)`);
    const j = JSON.parse(readFileSync(join(out, 'capture.json'), 'utf8'));
    assert.match(j.honesty, /frame by frame/);
    assert.ok(j.clock.virtual.includes('setInterval') && j.clock.notVirtual.includes('the network'), 'the result says what is and is not on the clock');
    const s = streams(join(out, 'capture.mp4'));
    const v = s.streams.find((x) => x.codec_type === 'video');
    assert.deepEqual([v.width, v.height, v.r_frame_rate, Number(v.nb_read_packets), v.pix_fmt, v.color_range, v.color_primaries, v.color_transfer, v.color_space], [640, 360, '30/1', 120, 'yuv420p', 'tv', 'bt709', 'bt709', 'bt709']);
    assert.ok(s.streams.some((x) => x.codec_type === 'audio'), 'the film has a sound track');

    const log = JSON.parse(readFileSync(join(out, 'events.json'), 'utf8'));
    const frames = log.events.filter((e) => e.type === 'note' && e.what === 'frame' && e.t >= 0);
    assert.ok(frames.length >= 118, `the page drew a frame for every frame of film (${frames.length})`);
    const step = 1000 / 30;
    for (let k = 1; k < frames.length; k++) {
      const a = frames[k - 1]; const b = frames[k];
      assert.ok(Math.abs(b.now - a.now - step) < 1e-6, `performance.now moved 1/30 s between frames ${a.n} and ${b.n} (${b.now - a.now} ms)`);
      assert.ok(Math.abs(b.ts - a.ts - step) < 1e-6, 'and so did the time requestAnimationFrame hands over');
      assert.ok(Math.abs(b.date - b.now) <= 1.01, `Date.now agrees with performance.now (${b.date} vs ${b.now})`);
      assert.ok(b.ticks === Math.floor((b.now + 0.01) / 100) || b.ticks === Math.floor((b.now - 0.01) / 100), `setInterval(100) has fired ${b.ticks} times at ${b.now.toFixed(1)} ms`);
    }
    // The CSS animation: 300 px every 2 s, read back from the page each frame.
    const bar = frames.filter((f) => f.now > 200);
    const phase = ((bar[0].left / 300) * 2000 - bar[0].now + 4000) % 2000;
    for (const f of bar) { const want = (((f.now + phase) % 2000) / 2000) * 300; const d = Math.min(Math.abs(f.left - want), 300 - Math.abs(f.left - want)); assert.ok(d < 1.5, `the sliding bar is at ${f.left} px at ${f.now.toFixed(0)} ms, wanted ${want.toFixed(1)}`); }
    // The Web Animation: 600 px in 3 s, then it stays at its end (fill: forwards).
    for (const f of frames.filter((x) => x.now > 300)) assert.ok(Math.abs(f.dot - Math.min(600, (f.now + (frames[0].dot / 600) * 3000 - frames[0].now) / 3000 * 600)) < 3, `the dot is at ${f.dot} px at ${f.now.toFixed(0)} ms`);
    // The callout: shown by a setTimeout at 1 s, faded by a CSS animation in 400 ms. With only some clocks virtual it is
    // over between two frames; here it is in twelve of them, each a little fainter.
    const call = log.events.find((e) => e.what === 'callout');
    assert.ok(Math.abs(call.at - 1000) < 1e-6, `the timeout fired at its own time (${call.at} ms)`);
    const fading = frames.filter((f) => f.opacity > 0.02 && f.opacity < 0.999);
    assert.ok(fading.length >= 10 && fading.length <= 13, `the fade is in ${fading.length} frames`);
    for (let k = 1; k < fading.length; k++) assert.ok(fading[k].opacity < fading[k - 1].opacity, 'fainter each frame');
    for (const f of fading) assert.ok(Math.abs(f.opacity - (1 - (f.now - 1000) / 400)) < 0.09, `opacity ${f.opacity} at ${f.now.toFixed(0)} ms`);
    assert.ok(frames.filter((f) => f.now > 1450).every((f) => f.opacity === 0), 'and gone after it');

    // The sound log: a blip every half second of the PAGE's time, the boom at 2.5 s, the music on its own bus.
    const starts = log.events.filter((e) => e.type === 'start');
    const blips = starts.filter((e) => e.name === 'blip' && e.t >= 0);
    assert.ok(blips.length >= 7, `${blips.length} blips in four seconds`);
    for (let k = 1; k < blips.length; k++) assert.ok(Math.abs(blips[k].t - blips[k - 1].t - 0.5) < 1e-3, 'half a second apart on the film\'s clock');
    const boom = starts.find((e) => e.name === 'boom');
    assert.ok(boom && boom.pan === -0.5 && /\/sound\/boom\.wav$/.test(boom.url), JSON.stringify(boom));
    const tune = starts.find((e) => e.bus === 'music');
    assert.ok(tune && tune.loop === true && tune.bar === 2 && tune.name === 'theme/main', JSON.stringify(tune));
    assert.ok(log.events.some((e) => e.type === 'duck' && e.to === 0.3) && log.events.some((e) => e.type === 'levels'));
    // The mix: each blip is in sfx.wav where the log says, and there is quiet just before it.
    assert.deepEqual([j.audio.rebuilt, j.audio.missing], [true, []]);
    assert.ok(j.audio.placed >= 9);
    for (const b of blips.filter((x) => x.t > 0.1 && x.t < 3.8 && Math.abs(x.t - boom.t) > 0.45)) {
      assert.ok(rmsOf(join(out, 'sfx.wav'), b.t + 0.002, b.t + 0.03) > 0.05, `a blip sounds at ${b.t} s`);
      assert.ok(rmsOf(join(out, 'sfx.wav'), b.t - 0.04, b.t - 0.005) < 0.01, `and not just before ${b.t} s`);
    }
    assert.ok(rmsOf(join(out, 'sfx.wav'), boom.t + 0.01, boom.t + 0.15) > 0.1, 'the boom is where it was played');
    assert.ok(rmsOf(join(out, 'music.wav'), 0.5, 3.5) > 0.02, 'the music is on its own bus');
    const beforeDuck = rmsOf(join(out, 'music.wav'), boom.t - 0.5, boom.t); const ducked = rmsOf(join(out, 'music.wav'), boom.t + 0.1, boom.t + 0.5);
    assert.ok(ducked < beforeDuck * 0.6, `the music ducks under the boom (${beforeDuck.toFixed(3)} to ${ducked.toFixed(3)})`);
  } finally { srv.close(); }
});

test('record-fixed: steps run on the film\'s clock, a step it does not have is refused by name, and a silent page says it is silent', { skip: SKIP }, async () => {
  const web = join(scratch, 'site-b'); mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<!doctype html><body style="margin:0;background:#123"><button id="go" style="font-size:40px;margin:40px">Go</button><p id="k"></p><script>let c = 0; const T = performance.now(); document.getElementById("go").onclick = () => { c++; window.CLICKED = performance.now() - T; document.body.style.background = "#a31"; }; addEventListener("keydown", (e) => { document.getElementById("k").textContent += e.key; window.KEY = performance.now() - T; });</script>');
  const srv = await serve(web);
  try {
    const stepsFile = join(scratch, 'steps.json');
    writeFileSync(stepsFile, JSON.stringify({ tail: 0.5, steps: [{ wait: 500, caption: 'Wait' }, { click: '#go', caption: 'Press Go' }, { waitFor: { js: 'window.CLICKED > 0' } }, { key: 'x', hold: 100 }, { waitFor: { text: 'x' } }] }));
    const dir = studio('fixed-steps');
    const out = join(dir, 'videos', 'take', 'work', 'capture');
    const r = await runNode([join(SCRIPTS, 'record-fixed.mjs'), '--url', `${srv.url}/index.html`, '--out', out, '--steps', stepsFile, '--seconds', '10', '--width', '640', '--height', '360', '--settle', '0.2', '--no-pace', '--min-free-gb', '1'], dir);
    assert.equal(r.ok, true, JSON.stringify(r));
    const j = JSON.parse(readFileSync(join(out, 'capture.json'), 'utf8'));
    assert.deepEqual(j.steps.map((s) => [s.do, Boolean(s.failed)]), [['wait', false], ['click', false], ['waitFor', false], ['key', false], ['waitFor', false]]);
    assert.ok(Math.abs(j.steps[1].at - 0.5) < 0.04, `the click began half a second of film in (${j.steps[1].at})`);
    assert.ok(r.seconds < 3, `the film ends half a second after the last step, not at --seconds (${r.seconds} s)`);
    assert.equal(r.audio, null);
    assert.ok(r.warnings.some((w) => /logged no sound: the film is silent/.test(w)), JSON.stringify(r.warnings));
    assert.match(readFileSync(join(out, 'captions.vtt'), 'utf8'), /00:00:00\.500 --> [\d:.]+\nPress Go/);
    writeFileSync(stepsFile, JSON.stringify({ steps: [{ scroll: 300 }] }));
    const bad = spawnSync(process.execPath, [join(SCRIPTS, 'record-fixed.mjs'), '--url', `${srv.url}/index.html`, '--out', out, '--steps', stepsFile, '--min-free-gb', '1'], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /"scroll" is not a step of the frame-by-frame recorder/);
  } finally { srv.close(); }
});

test('record-fixed: a game in a sandboxed frame is on the same clock, and keys and a click reach it', { skip: SKIP }, async () => {
  // The record test's own site: /demo/play holds the game in a sandboxed /demo/__game/ frame, as a studio's pages do.
  const srv = await serve(join(HERE, 'fixtures', 'record-site'));
  try {
    const dir = studio('fixed-frame');
    const out = join(dir, 'videos', 'take', 'work', 'capture');
    const stepsFile = join(scratch, 'frame-steps.json');
    // The square moves 0.006 of the screen in each of ITS frames while a key is held: 0.7 s of film is 21 frames, 0.126.
    writeFileSync(stepsFile, JSON.stringify({ tail: 0.3, steps: [
      { waitFor: { frame: 'game', js: 'window.__demo && window.__demo.frames > 5' } },
      { key: 'ArrowRight', hold: 700, frame: 'game' },
      { waitFor: { frame: 'game', js: 'Math.abs(window.__demo.x - 0.5 - 0.126) < 0.013' }, timeout: 500 },
      { click: { frame: 'game', selector: 'canvas' } },
      { waitFor: { frame: 'game', js: 'window.__demo.clicks >= 1 && window.__demo.keys === 1' }, timeout: 500 },
    ] }));
    const r = await runNode([join(SCRIPTS, 'record-fixed.mjs'), '--url', `${srv.url}/demo/play`, '--out', out, '--steps', stepsFile, '--frame', 'game', '--seconds', '10', '--width', '640', '--height', '360', '--settle', '0.3', '--no-pace', '--min-free-gb', '1'], dir);
    assert.equal(r.ok, true, JSON.stringify(r));
    const j = JSON.parse(readFileSync(join(out, 'capture.json'), 'utf8'));
    assert.deepEqual(j.steps.map((s) => Boolean(s.failed)), [false, false, false, false, false], JSON.stringify(j.steps));
    assert.equal(Number(streams(join(out, 'capture.mp4')).streams[0].nb_read_packets), r.frames);
  } finally { srv.close(); }
});

test('trailer: one command films the game frame by frame, picks the shots from what it played, and delivers 16:9, 1:1 and 9:16', { skip: SKIP }, async () => {
  const web = join(scratch, 'site-c'); site(web);
  const srv = await serve(web);
  try {
    const dir = studio('trailer');
    const r = await runNode([VIDEO, 'trailer', 'demo-trailer', '--game', 'demo', '--url', srv.url, '--page', '/index.html', '--seconds', '10', '--length', '7', '--settle', '0.5', '--wait-for', 'window.READY === true', '--scale', '0.34', '--no-pace', '--min-free-gb', '1', '--end', 'Play free', '--sub', 'night owls', '--json'], dir);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual([r.capture.frames, r.capture.heldFrames], [300, 0]);
    assert.ok(r.capture.audio.rebuilt && r.capture.audio.missing === 0);
    // The music's bar is 2 s: a shot is a bar, the cuts are on its bar lines, and it runs on under them as the bed.
    assert.deepEqual([r.edit.shots, r.edit.shotSeconds, r.edit.end], [2, 2, 3]);
    assert.match(r.edit.picked, /what the game played/);
    assert.match(String(r.edit.bed), /own music/);
    assert.ok(r.edit.shotsPlayed.some((s) => s.played.boom === 1), `one of the shots is the one with the boom: ${JSON.stringify(r.edit.shotsPlayed)}`);
    assert.deepEqual(r.cuts.map((c) => c.frame), [60, 120]);
    const edl = JSON.parse(readFileSync(join(dir, r.edit.file), 'utf8'));
    assert.equal(edl.gameAudio.file, 'work/capture/sfx.wav', 'the effects are cut with the picture');
    assert.equal(edl.bed.file, 'work/capture/music.wav');
    assert.ok(Math.abs((edl.bed.from - 0) % 2) < 0.06 || Math.abs((edl.bed.from % 2) - 2) < 0.06 || edl.bed.from < 2, `the bed starts on a bar line of the game's music (${edl.bed.from})`);
    const want = { '16x9': [1920, 1080, 'demo-trailer.mp4'], '1x1': [1080, 1080, 'demo-trailer-square.mp4'], '9x16': [1080, 1920, 'demo-trailer-vertical.mp4'] };
    assert.deepEqual(Object.keys(r.outputs).sort(), ['16x9', '1x1', '9x16']);
    for (const [tag, [w, h, name]] of Object.entries(want)) {
      const file = join(dir, 'videos', 'demo-trailer', name);
      assert.ok(existsSync(file), name);
      const s = streams(file);
      const v = s.streams.find((x) => x.codec_type === 'video');
      assert.deepEqual([v.width, v.height, v.r_frame_rate, Number(v.nb_read_packets), v.pix_fmt, v.color_range, v.color_primaries], [w, h, '30/1', 210, 'yuv420p', 'tv', 'bt709'], tag);
      assert.ok(s.streams.some((x) => x.codec_type === 'audio'), `${tag} has sound`);
      assert.ok(Math.abs(r.outputs[tag].loudness.lufs + 14) < 2.5, `${tag} is near -14 LUFS (${r.outputs[tag].loudness.lufs})`);
    }
    for (const tag of ['16x9', '1x1', '9x16']) assert.ok(existsSync(join(dir, 'videos', 'demo-trailer', 'work', `card-end-${tag}.png`)), `the end card at ${tag}`);
    // --keep-capture edits the film already made: no second recording, another length.
    const again = await runNode([VIDEO, 'trailer', 'demo-trailer', '--game', 'demo', '--keep-capture', '--length', '5', '--end', 'Play free', '--json'], dir);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.deepEqual([again.edit.shots, again.frames], [1, 150]);
    // `homie-studio trailer <id>` is the same command: it finds the video skill's script and hands the words over.
    const cli = await runNode([join(STUDIO_PKG, 'bin', 'homie-studio.mjs'), 'trailer', 'demo', '--keep-capture', '--length', '5', '--end', 'Play free', '--json'], dir);
    assert.deepEqual([cli.ok, cli.command, cli.slug, cli.game, cli.frames], [true, 'trailer', 'demo-trailer', 'demo', 150], JSON.stringify(cli).slice(0, 600));
    const usage = await runNode([join(STUDIO_PKG, 'bin', 'homie-studio.mjs'), 'trailer', '--json'], dir);
    assert.match(usage.why, /usage: homie-studio trailer <game id>/);
  } finally { srv.close(); }
});
