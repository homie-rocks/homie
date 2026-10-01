#!/usr/bin/env node
/**
 * video.mjs — trailers, music videos and cutscenes for a Homie studio: generated
 * footage from fal through the creator's own account (priced, capped, receipted),
 * real gameplay captured from the studio's own game, cut on the music's beat grid,
 * checked for sync, reviewed on contact sheets, delivered 16:9 and 9:16, and
 * published as a video page on the studio's site.
 *
 *   check                                        fal key (a free check), ffmpeg, Chrome, the studio
 *   budget <slug> --cap <usd>                    the most the person agreed to spend on this video
 *   price --model <id> --input <file.json>       what one call costs, from fal's own pricing (free)
 *   gen <slug> --model <id> --input <file.json> --out <path> [--dry-run] [--yes]
 *                                                ONE paid fal call; "@file:<path>" inputs are uploaded first
 *   grid <slug> --song <music slug|file> [--bpm] the song's beats, bars and (from the music skill) sung words
 *   slice <slug> --from <s> --to <s> --out <path.wav> [--song …]    a cut of the song, e.g. a shot's audio reference
 *   lag <slug> --base <clip.mp4> --ref <cut.wav> how far a generated clip's own sound sits from its reference
 *   capture <slug> --game <id> --url <site> [--seconds 60] [--view tv|play] [--scale 0.67] [--fps 30]
 *                                         real gameplay (capture-game.mjs); --scale renders a heavy game smaller
 *   edl <slug> --length <s> [--song <slug>] [--bed-from-bar <k>] [--title "…"] [--end "…"]   an edit, cut on bars
 *   card <slug> --name <title|end> --text "…" [--sub "…"]    a title or end card, 16:9 and 9:16
 *   cut <slug> [--edl work/edl.json]             the 16:9 and 9:16 deliveries, loudness to -14 LUFS, a poster
 *   film init <slug> | film render <slug> [--mode h|v] [--from s --to s]   the draw-over + kinetic type renderer
 *   sheet <slug> --in <mp4> [--every 1]          a contact sheet to look at before anyone else does
 *   words <slug> --in <mp4>                      every sung word's frame, labelled (music videos)
 *   sync <slug> --in <mp4> [--at t1,t2,…]        sound onset vs picture change at each cut or hit, in frames
 *   add <slug> --title "…" [--kind trailer|music-video|cutscene] [--for-game <id>] [--for-song <slug>] [--publish]
 *   publish <slug>                               media to R2 when the studio has it, rebuild, redeploy, check the page
 *
 * --json prints the result. Nothing prints a key.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beatsOf, decodeMono, energyOnsets, lagBetween, loudness, need, probe, run } from '../../music/scripts/lib/audio.mjs';
import { SLUG, checkBudget, getEntry, readJson, receipt, rel, requireStudio, setBudget, upsertEntry, writeJson } from '../../music/scripts/lib/studio.mjs';
import { publishEntry } from '../../music/scripts/music.mjs';
import { chromePath, htmlToPng, launch, loadPuppeteer } from './lib/browser.mjs';
import { checkKey, falKey, priceOf, run as falRun } from './lib/fal.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flags = new Map();
const pos = [];
const BOOL = new Set(['json', 'yes', 'dry-run', 'publish', 'no-deploy', 'no-game-audio']);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split(/=(.*)/s, 2);
    if (v !== undefined) flags.set(k, v);
    else if (!BOOL.has(k) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags.set(k, argv[++i]);
    else flags.set(k, true);
  } else pos.push(a);
}
const asJson = flags.has('json');
const say = (line) => { if (!asJson) process.stderr.write(`${line}\n`); };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function jobDir(root, slug) {
  if (!SLUG.test(String(slug ?? ''))) throw new Error('name the video with a slug: lowercase letters, digits and hyphens (it becomes /videos/<slug>/)');
  const dir = join(root, 'videos', slug);
  mkdirSync(join(dir, 'work'), { recursive: true });
  return dir;
}
const inJob = (dir, p) => resolve(dir, String(p));
/** Does the studio have storage (an R2 bucket it made with `homie-studio storage add`)? */
function hasStorage(root) {
  const cf = readJson(join(root, 'studio.json'), {}).cloudflare ?? {};
  return Boolean(cf.r2 && (cf.created ?? []).includes(`r2:${cf.r2}`));
}
/**
 * The video bitrate cap for a delivery. With no storage the site serves each file itself, and a file may be at
 * most 25 MiB, so a cut is held to about 23 MiB whatever its length (with 192 kbit/s of sound); with storage, 12 Mbit/s.
 */
function deliveryKbps(seconds, storage) {
  if (storage) return 12000;
  return Math.max(800, Math.min(12000, Math.floor(((23 * 1048576 * 8) / Math.max(1, seconds)) / 1000) - 200));
}
function ff(args, what) {
  const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.code !== 0) throw new Error(`${what} failed: ${r.stderr.trim().split('\n').slice(-2).join(' ')}`);
  return r;
}

/* ---------------------------------------------------------------- check / budget / price / gen */

async function check() {
  const out = { ok: true, command: 'check', ffmpeg: need('ffmpeg') && need('ffprobe'), chrome: chromePath() };
  out.fal = falKey() ? await checkKey() : { ok: false, why: 'FAL_KEY is not set (only generated footage needs it; trailers from gameplay do not)' };
  let root = null;
  try { root = requireStudio(); out.studio = { ok: true, root, puppeteer: Boolean(loadPuppeteer(root)) }; } catch (error) { out.studio = { ok: false, why: error.message }; }
  if (!out.ffmpeg) { out.ok = false; out.why = 'ffmpeg is not installed (macOS: `brew install ffmpeg`; the person approves the install)'; }
  if (!out.chrome) { out.ok = false; out.why = [out.why, 'no Chrome found (set CHROME_PATH)'].filter(Boolean).join('; '); }
  return out;
}

function budget(root) {
  const cap = Number(flags.get('cap'));
  if (!(cap > 0)) throw new Error('--cap <US dollars>: the most the person agreed to spend on this video');
  return { ok: true, command: 'budget', slug: pos[1], budget: setBudget(jobDir(root, pos[1]), { provider: 'fal', unit: 'usd', cap, approvedBy: flags.get('by') ?? 'the person, in chat', note: flags.get('note') ?? null }) };
}

function inputOf(file) {
  const j = readJson(resolve(String(file ?? '')), null);
  if (!j) throw new Error(`--input <file.json>: the model's input (read its schema on fal's model page or with the fal MCP get_model_schema)`);
  return j;
}

async function price() {
  const model = String(flags.get('model') ?? '');
  if (!model) throw new Error('--model <fal endpoint id>');
  const p = await priceOf(model, inputOf(flags.get('input')));
  return { ok: true, command: 'price', ...p };
}

async function gen(root) {
  const slug = pos[1];
  const dir = jobDir(root, slug);
  const model = String(flags.get('model') ?? '');
  if (!model) throw new Error('--model <fal endpoint id>');
  if (!flags.get('out')) throw new Error('--out <path in this video\'s folder, e.g. work/bases/s01.mp4>');
  const input = inputOf(flags.get('input'));
  const out = inJob(dir, flags.get('out'));
  if (!out.startsWith(`${dir}/`)) throw new Error('--out must stay inside the video\'s folder');
  if (existsSync(out)) return { ok: true, command: 'gen', slug, already: rel(root, out) };
  const p = await priceOf(model, input);
  const resuming = existsSync(`${out}.request`);
  if (flags.has('dry-run')) return { ok: true, command: 'gen', dryRun: true, slug, price: p };
  if (!resuming) {
    const b = checkBudget(dir, p.usd, { provider: 'fal', unit: 'usd' });
    if (!flags.has('yes')) return { ok: false, command: 'gen', needs: 'approval', slug, price: p, budget: { cap: b.cap, spent: b.spent }, why: `This call costs about US$${p.usd.toFixed(2)} (${p.basis}, ${p.unitPrice} per ${p.unit}); US$${b.spent.toFixed(2)} of US$${b.cap.toFixed(2)} spent so far. Run it with --yes once that is fine.` };
  }
  const r = await falRun(model, input, {
    out, base: dir, uploads: join(dir, 'work', 'uploads.json'), price: p, log: say,
    onAccepted: async (q) => { receipt(root, dir, { provider: 'fal', model, requestId: q.request_id, cost: p.usd, unit: 'usd', units: p.units, unitName: p.unit, basis: p.basis, artifact: rel(root, out) }); },
  });
  const facts = extname(out) === '.mp4' ? probe(out) : null;
  return { ok: true, command: 'gen', slug, files: r.files.map((f) => rel(root, f)), requestId: r.requestId, usd: p.usd, seconds: facts?.duration ?? null, spent: readJson(join(dir, 'budget.json'), {}).spent };
}

/* ---------------------------------------------------------------- the song: grid, slices, lag */

function songFile(root, song) {
  if (!song) return null;
  if (existsSync(resolve(String(song)))) return { file: resolve(String(song)), entry: null };
  const e = getEntry(root, 'music', String(song));
  if (!e) throw new Error(`no song "${song}" in music/manifest.json (or give a file path)`);
  const audio = (e.files ?? []).find((f) => f.role === 'audio');
  if (!audio?.path || !existsSync(join(root, audio.path))) throw new Error(`the song "${song}" has no audio file on this computer`);
  return { file: join(root, audio.path), entry: e, dir: join(root, 'music', String(song)) };
}

/** Sung words with their times, from the music skill's render (the model's own word stamps), shifted to the mastered file. */
function wordsOf(root, song) {
  if (!song?.dir) return [];
  const r = readJson(join(song.dir, 'render.json'), null);
  const w = r ? readJson(join(song.dir, 'work', `render-${r.n}.json`), null) : null;
  // Directions in {…} and section names in […] are in the stamps too, a word at a time: skip whole spans.
  const out = []; let inside = null;
  for (const x of w?.words ?? []) {
    const t = String(x.word ?? '').trim();
    if (!t) continue;
    if (!inside && (t.startsWith('{') || t.startsWith('['))) inside = t[0] === '{' ? '}' : ']';
    if (inside) { if (t.endsWith(inside)) inside = null; continue; }
    out.push({ w: t, s: x.start_ms / 1000, e: x.end_ms / 1000 });
  }
  return out;
}

function grid(root) {
  const slug = pos[1];
  const dir = jobDir(root, slug);
  const song = songFile(root, flags.get('song'));
  if (!song) throw new Error('--song <music slug or audio file>');
  const plan = song.dir ? readJson(join(song.dir, 'plan.json'), null) : null;
  const bpm = flags.has('bpm') ? Number(flags.get('bpm')) : plan?.bpm ?? null;
  const g = beatsOf(song.file, { bpm });
  const beat = 60 / g.bpm;
  const bpb = plan?.beatsPerBar ?? 4;
  const offset = ((g.phase % beat) + beat) % beat;
  const bars = [];
  for (let t = offset; t < g.duration - 0.01; t += beat * bpb) bars.push(+t.toFixed(4));
  // The model's word stamps can sit a few frames off what is heard (measured: 50 to 80 ms late on plosives): move
  // each word to the strongest vocal-band onset from 100 ms before to 40 ms after its stamp, so the type pops on
  // the consonant. A word with no onset there keeps its stamp.
  const words = wordsOf(root, song);
  let snapped = 0;
  if (words.length) {
    const sr = 22050;
    const x = decodeMono(song.file, { rate: sr, filter: 'highpass=f=250,lowpass=f=3500' });
    const on = energyOnsets(x, sr);
    for (const w of words) {
      let bi = -1; let bv = 0;
      for (let i = Math.max(0, Math.round((w.s - 0.1 - on.offset) * on.rate)); i <= Math.min(on.env.length - 1, Math.round((w.s + 0.04 - on.offset) * on.rate)); i++) if (on.env[i] > bv) { bv = on.env[i]; bi = i; }
      if (bi >= 0 && bv > 0.12) { const t = +(bi / on.rate + on.offset).toFixed(3); w.stamp = w.s; w.s = t; snapped++; }
    }
  }
  const out = { song: rel(root, song.file), songSlug: song.entry?.slug ?? null, bpm: g.bpm, beat, beatsPerBar: bpb, offset: +offset.toFixed(4), confidence: g.confidence, duration: g.duration, beats: g.beats, bars, words, wordsSnapped: snapped, sections: plan ? plan.lyrics.map((s) => ({ name: s.section, bar: s.startBar, at: +(offset + s.startBar * beat * bpb).toFixed(3), lines: s.lines })) : [] };
  writeJson(join(dir, 'grid.json'), out);
  return { ok: true, command: 'grid', slug, bpm: out.bpm, bars: bars.length, barSeconds: +(beat * bpb).toFixed(4), offset: out.offset, confidence: out.confidence, words: out.words.length, wordsSnapped: snapped, file: rel(root, join(dir, 'grid.json')) };
}

function slice(root) {
  const slug = pos[1];
  const dir = jobDir(root, slug);
  const g = readJson(join(dir, 'grid.json'), null);
  const song = flags.get('song') ? songFile(root, flags.get('song')).file : g ? join(root, g.song) : null;
  if (!song) throw new Error('grid the song first, or --song');
  const from = Number(flags.get('from')); const to = Number(flags.get('to'));
  if (!(to > from)) throw new Error('--from <s> --to <s>');
  const out = inJob(dir, flags.get('out') ?? `work/audio/${from.toFixed(2)}-${to.toFixed(2)}.wav`);
  mkdirSync(dirname(out), { recursive: true });
  ff(['-ss', from.toFixed(4), '-t', (to - from).toFixed(4), '-i', song, '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', out], 'the slice');
  return { ok: true, command: 'slice', file: rel(root, out), seconds: +(to - from).toFixed(3) };
}

function lag(root) {
  const base = resolve(String(flags.get('base') ?? '')); const ref = resolve(String(flags.get('ref') ?? ''));
  if (!existsSync(base) || !existsSync(ref)) throw new Error('--base <generated clip.mp4> --ref <the audio reference it was given>');
  const sr = 16000;
  const a = decodeMono(ref, { rate: sr }); const b = decodeMono(base, { rate: sr });
  const l = lagBetween(a, b, sr);
  const frames = l.lagS * 24;
  // lagS < 0: the clip's sound (and so its lips) runs AHEAD of the reference, e.g. a model that dropped a quiet lead-in.
  const baseStart = +(l.lagS).toFixed(3);
  return { ok: Math.abs(l.lagS) <= 0.042 && l.peak >= 8, command: 'lag', base: rel(root, base), lagMs: Math.round(l.lagS * 1000), lagFramesAt24: +frames.toFixed(2), peak: l.peak, baseStart,
    verdict: l.peak < 8 ? 'no clear match: the clip\'s sound is not the reference (regenerate with the audio reference, or check the file)' : Math.abs(l.lagS) <= 0.042 ? 'in sync (within one frame)' : `the clip's sound is ${Math.abs(Math.round(l.lagS * 1000))} ms ${l.lagS < 0 ? 'ahead of' : 'behind'} its reference: set this shot's "baseStart" to ${baseStart} (add it to any baseStart it already has) so its lips land on the song` };
}

/* ---------------------------------------------------------------- capture / edl / cards / cut */

function capture(root) {
  const slug = pos[1];
  const dir = jobDir(root, slug);
  const url = flags.get('url') ?? readJson(join(root, 'studio.json'), {}).cloudflare?.url;
  if (!url) throw new Error('--url <site>: http://127.0.0.1:8787 while `npm run dev` runs, or the live site');
  const out = join(dir, 'work', 'capture');
  const args = [join(HERE, 'capture-game.mjs'), '--url', String(url), '--game', String(flags.get('game') ?? ''), '--seconds', String(flags.get('seconds') ?? 60), '--out', out, '--view', String(flags.get('view') ?? 'tv')];
  // A heavy game paints more frames on a smaller page (--scale), scaled up to the film's size when it is encoded.
  for (const k of ['scale', 'fps']) if (flags.has(k)) args.push(`--${k}`, String(flags.get(k)));
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 20 * 60_000 });
  let j = null; try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* */ }
  if (r.status !== 0 || !j?.ok) throw new Error('the capture failed (its log is above)');
  return { ok: true, command: 'capture', slug, file: rel(root, j.file), seconds: j.seconds, sourceFps: j.sourceFps, heldFrames: j.heldFrames, audio: j.audio, ...(j.advice ? { advice: j.advice } : {}) };
}

/**
 * Motion per tenth of a second (the mean change of a small grey thumbnail between frames), the
 * thumbnails themselves, and where in the frame things change (for a push-in toward the action).
 */
const TW = 96; const TH = 54;
function motionOf(file) {
  const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `fps=10,scale=${TW}:${TH},format=gray`, '-f', 'rawvideo', '-']);
  const px = TW * TH; const n = Math.floor(r.stdout.length / px);
  const m = new Float32Array(n);
  for (let i = 1; i < n; i++) { let s = 0; for (let k = 0; k < px; k++) s += Math.abs(r.stdout[i * px + k] - r.stdout[(i - 1) * px + k]); m[i] = s / px; }
  const thumb = (i) => r.stdout.subarray(Math.min(n - 1, Math.max(0, i)) * px, (Math.min(n - 1, Math.max(0, i)) + 1) * px);
  /** The centre of change between frames a..b (0..1 in each axis), or the middle when nothing moves. */
  const focus = (a, b) => {
    let sx = 0; let sy = 0; let sw = 0;
    for (let i = Math.max(1, a); i < Math.min(n, b); i++) {
      for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
        const d = Math.abs(r.stdout[i * px + y * TW + x] - r.stdout[(i - 1) * px + y * TW + x]);
        if (d > 6) { sx += x * d; sy += y * d; sw += d; }
      }
    }
    return sw ? [+(sx / sw / TW).toFixed(3), +(sy / sw / TH).toFixed(3)] : [0.5, 0.5];
  };
  const differ = (i, j) => { const a = thumb(i); const b = thumb(j); let d = 0; for (let k = 0; k < px; k++) d += Math.abs(a[k] - b[k]); return d / px; };
  return { m, n, focus, differ };
}

function edl(root) {
  const slug = pos[1];
  const dir = jobDir(root, slug);
  const length = Number(flags.get('length') ?? 30);
  if (!(length >= 5 && length <= 180)) throw new Error('--length 5..180 seconds');
  const cap = inJob(dir, flags.get('capture') ?? 'work/capture/capture.mp4');
  if (!existsSync(cap)) throw new Error(`no capture at ${rel(root, cap)}: run capture first`);
  const capInfo = readJson(join(dirname(cap), 'capture.json'), {});
  const song = flags.get('song') ? songFile(root, flags.get('song')) : null;
  let bar = 2; let bedFrom = 0; let bpm = null;
  if (song) {
    const plan = song.dir ? readJson(join(song.dir, 'plan.json'), null) : null;
    const g = beatsOf(song.file, { bpm: plan?.bpm ?? null });
    bpm = g.bpm; const beat = 60 / g.bpm; bar = beat * (plan?.beatsPerBar ?? 4);
    const offset = ((g.phase % beat) + beat) % beat;
    bedFrom = offset + Number(flags.get('bed-from-bar') ?? 0) * bar;
    const dur = probe(song.file).duration;
    if (bedFrom + length > dur + 0.05) throw new Error(`the song is ${dur.toFixed(1)} s; from bar ${flags.get('bed-from-bar') ?? 0} it cannot carry ${length} s (pick an earlier bar or a shorter cut)`);
  }
  // A shot is one bar (two beats when a bar is long); the title holds one bar, the end card what is left (at least 2.5 s).
  const shot = bar > 2.6 ? bar / 2 : bar;
  const titleDur = flags.get('title') ? Math.max(bar, 1.5) : 0;
  const endMin = Math.max(2.5, bar);
  const nClips = Math.max(1, Math.floor((length - titleDur - endMin) / shot + 1e-6));
  const endDur = +(length - titleDur - nClips * shot).toFixed(4);
  const mo = motionOf(cap);
  const motion = mo.m;
  const capDur = probe(cap).duration;
  const settle = Math.min(2, capDur / 10);
  const win = Math.round(shot * 10);
  const scores = [];
  for (let s = Math.round(settle * 10); s + win <= motion.length; s++) { let v = 0; for (let k = s; k < s + win; k++) v += motion[k]; scores.push({ at: s / 10, v: v / win }); }
  if (!scores.length) throw new Error('the capture is shorter than one shot');
  // The busiest windows that do not overlap and do not look like a shot already picked (a cut between two
  // near-identical pictures reads as a jump, not a cut), then shown in the order they happened.
  const picked = [];
  const mid = (at) => Math.round(at * 10 + win / 2);
  for (const c of [...scores].sort((x, y) => y.v - x.v)) {
    if (picked.length >= nClips) break;
    if (picked.some((p) => Math.abs(p.at - c.at) < shot + 0.5)) continue;
    if (picked.some((p) => mo.differ(mid(p.at), mid(c.at)) < 4)) continue;
    picked.push(c);
  }
  for (const c of [...scores].sort((x, y) => y.v - x.v)) { if (picked.length >= nClips) break; if (!picked.some((p) => Math.abs(p.at - c.at) < shot + 0.5)) picked.push(c); }
  while (picked.length < nClips) picked.push({ at: settle + ((picked.length * shot) % Math.max(shot, capDur - shot - settle)), v: 0 });
  picked.sort((x, y) => x.at - y.at);
  // A push-in toward where the action is: a camera move on the real footage (a crop that grows), nothing added.
  const push = flags.has('push') ? Number(flags.get('push')) : 1.25;
  const segments = [];
  if (titleDur) segments.push({ type: 'card', src: 'work/card-title', dur: +titleDur.toFixed(4) });
  for (const p of picked.slice(0, nClips)) segments.push({ type: 'clip', src: rel(dir, cap), in: +p.at.toFixed(3), dur: +shot.toFixed(4), motion: +p.v.toFixed(2), ...(push > 1 ? { push: +push.toFixed(3), focus: mo.focus(Math.round(p.at * 10), Math.round(p.at * 10) + win) } : {}) });
  segments.push({ type: 'card', src: 'work/card-end', dur: endDur });
  const out = {
    fps: 30, length, bpm, bar: +bar.toFixed(4),
    bed: song ? { file: rel(dir, song.file), from: +bedFrom.toFixed(4), fadeOut: Math.min(1.5, endDur), gainDb: 0 } : null,
    gameAudio: capInfo.audio?.peakDb != null && !flags.has('no-game-audio') ? { gainDb: song ? -8 : 0 } : null,
    segments,
    honesty: capInfo.honesty ?? null,
  };
  writeJson(join(dir, 'work', 'edl.json'), out);
  const cuts = []; let t = 0; for (const s of segments.slice(0, -1)) { t += s.dur; cuts.push(+t.toFixed(3)); }
  return { ok: true, command: 'edl', slug, file: rel(root, join(dir, 'work', 'edl.json')), shots: nClips, shotSeconds: +shot.toFixed(3), title: titleDur, end: endDur, cuts, bed: out.bed, gameAudio: out.gameAudio };
}

function cardHtml({ text, sub, small, w, h, bg = '#07080d', ink = '#f2f4fa', accent = '#ffcf5a' }) {
  const v = h > w;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${w}px;height:${h}px;background:${bg};color:${ink};font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:${v ? 90 : 80}px}
h1{margin:0;font-size:${v ? 118 : 132}px;line-height:.95;letter-spacing:-.03em;font-weight:900;max-width:${v ? 900 : 1600}px}
p{margin:${v ? 44 : 36}px 0 0;font-size:${v ? 46 : 44}px;color:${accent};font-weight:700;letter-spacing:.01em}
small{position:absolute;left:0;right:0;bottom:${v ? 120 : 56}px;font-size:${v ? 26 : 22}px;opacity:.55}
</style></head><body><div class="c"><h1>${esc(text)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${small ? `<small>${esc(small)}</small>` : ''}</body></html>`;
}

async function card(root) {
  const slug = pos[1];
  const dir = jobDir(root, slug);
  const name = String(flags.get('name') ?? 'title');
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('--name title|end|<word>');
  const text = String(flags.get('text') ?? '');
  if (!text) throw new Error('--text "<the words on the card>"');
  const files = [];
  for (const [w, h, tag] of [[1920, 1080, '16x9'], [1080, 1920, '9x16']]) {
    const out = join(dir, 'work', `card-${name}-${tag}.png`);
    await htmlToPng(root, cardHtml({ text, sub: flags.get('sub') ?? '', small: flags.get('small') ?? '', w, h }), out, { width: w, height: h });
    files.push(rel(root, out));
  }
  return { ok: true, command: 'card', slug, files };
}

async function cut(root) {
  const slug = pos[1];
  const dir = jobDir(root, slug);
  const e = readJson(inJob(dir, flags.get('edl') ?? 'work/edl.json'), null);
  if (!e) throw new Error('no edl: run edl first (or --edl <file>)');
  const fps = e.fps ?? 30;
  const total = e.segments.reduce((a, s) => a + s.dur, 0);
  const outs = {};
  for (const [W, H, tag] of [[1920, 1080, '16x9'], [1080, 1920, '9x16']]) {
    const inputs = []; const chains = []; const labels = [];
    const clipInput = new Map();
    e.segments.forEach((s, i) => {
      if (s.type === 'card') {
        const png = inJob(dir, `${s.src}-${tag}.png`);
        if (!existsSync(png)) throw new Error(`card ${s.src}-${tag}.png is missing: run card first`);
        inputs.push('-loop', '1', '-framerate', String(fps), '-t', s.dur.toFixed(4), '-i', png);
        const k = inputs.filter((x) => x === '-i').length - 1;
        chains.push(`[${k}:v]scale=${W}:${H},setsar=1,fps=${fps},trim=duration=${s.dur.toFixed(4)},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
      } else {
        const src = inJob(dir, s.src);
        if (!clipInput.has(src)) { inputs.push('-i', src); clipInput.set(src, inputs.filter((x) => x === '-i').length - 1); }
        const k = clipInput.get(src);
        let trim = `trim=start=${s.in.toFixed(4)}:duration=${s.dur.toFixed(4)},setpts=PTS-STARTPTS,fps=${fps}`;
        if (s.push > 1) {
          // zoom from 1 to s.push over the shot, centred on s.focus (kept inside the frame); upscaled first so the crop moves smoothly.
          const frames = Math.max(1, Math.round(s.dur * fps));
          const [fx, fy] = s.focus ?? [0.5, 0.5];
          const z = `(1+${(s.push - 1).toFixed(4)}*on/${frames})`;
          trim += `,scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2,zoompan=z='${z}':x='max(0,min(iw-iw/zoom,${fx}*iw-iw/zoom/2))':y='max(0,min(ih-ih/zoom,${fy}*ih-ih/zoom/2))':d=1:s=1920x1080:fps=${fps}`;
        }
        if (tag === '16x9') chains.push(`[${k}:v]${trim},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${i}]`);
        else chains.push(`[${k}:v]${trim},split[a${i}][b${i}];[a${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=28:2,eq=brightness=-0.18[bg${i}];[b${i}]scale=${W}:-2[fg${i}];[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v${i}]`);
      }
      labels.push(`[v${i}]`);
    });
    const vgraph = `${chains.join(';')};${labels.join('')}concat=n=${labels.length}:v=1:a=0[vout]`;
    // Sound: the bed, and the game's own sound under it for the clips (silence under the cards).
    const aParts = []; let aMix = null;
    let nIn = inputs.filter((x) => x === '-i').length;
    if (e.bed) {
      inputs.push('-i', inJob(dir, e.bed.file));
      aParts.push(`[${nIn}:a]atrim=start=${e.bed.from.toFixed(4)}:duration=${total.toFixed(4)},asetpts=PTS-STARTPTS,aresample=48000,volume=${e.bed.gainDb ?? 0}dB,afade=t=out:st=${Math.max(0, total - (e.bed.fadeOut ?? 1)).toFixed(3)}:d=${(e.bed.fadeOut ?? 1).toFixed(3)}[bed]`);
      nIn++;
    }
    if (e.gameAudio) {
      const pieces = [];
      e.segments.forEach((s, i) => {
        if (s.type === 'clip' && clipInput.has(inJob(dir, s.src))) pieces.push(`[${clipInput.get(inJob(dir, s.src))}:a]atrim=start=${s.in.toFixed(4)}:duration=${s.dur.toFixed(4)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[g${i}]`);
        else pieces.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${s.dur.toFixed(4)}[g${i}]`);
      });
      aParts.push(...pieces, `${e.segments.map((_, i) => `[g${i}]`).join('')}concat=n=${e.segments.length}:v=0:a=1,volume=${e.gameAudio.gainDb ?? 0}dB[game]`);
    }
    if (e.bed && e.gameAudio) aMix = '[bed][game]amix=inputs=2:normalize=0:duration=first[aout]';
    else if (e.bed) aMix = '[bed]anull[aout]';
    else if (e.gameAudio) aMix = '[game]anull[aout]';
    const graph = [vgraph, ...aParts, ...(aMix ? [aMix] : [])].join(';');
    const tmp = join(dir, 'work', `cut-${tag}-premix.mp4`);
    ff([...inputs, '-filter_complex', graph, '-map', '[vout]', ...(aMix ? ['-map', '[aout]', '-c:a', 'pcm_s16le'] : []), '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-r', String(fps), '-t', total.toFixed(4), '-f', 'mov', tmp], `the ${tag} edit`);
    const final = join(dir, tag === '16x9' ? `${slug}.mp4` : `${slug}-vertical.mp4`);
    const kbps = deliveryKbps(total, hasStorage(root));
    const vflags = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart'];
    let meas = null;
    if (aMix) {
      // Two-pass loudness to -14 LUFS integrated, -1 dBTP: what the video page and the social sites play at.
      const m = run('ffmpeg', ['-hide_banner', '-i', tmp, '-vn', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']).stderr;
      try { meas = JSON.parse(m.slice(m.lastIndexOf('{'), m.lastIndexOf('}') + 1)); } catch { meas = null; }
      const ln = meas ? `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true` : 'loudnorm=I=-14:TP=-1.5:LRA=11';
      ff(['-i', tmp, '-map', '0:v', '-map', '0:a', ...vflags, '-af', `${ln},aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', final], `the ${tag} delivery`);
    } else ff(['-i', tmp, '-map', '0:v', ...vflags, final], `the ${tag} delivery`);
    rmSync(tmp, { force: true });
    const f = probe(final);
    outs[tag] = { file: rel(root, final), seconds: f.duration, width: f.video?.width, height: f.video?.height, loudness: aMix ? loudness(final) : null, bytes: statSync(final).size, maxKbps: kbps };
  }
  // A poster: the middle of the busiest clip.
  const clips = e.segments.map((s, i) => ({ ...s, i })).filter((s) => s.type === 'clip');
  const best = clips.sort((a, b) => (b.motion ?? 0) - (a.motion ?? 0))[0];
  let posterAt = 0.5; let t = 0;
  for (const s of e.segments) { if (best && s === e.segments[best.i]) { posterAt = t + s.dur / 2; break; } t += s.dur; }
  const poster = join(dir, 'poster.jpg');
  ff(['-ss', posterAt.toFixed(3), '-i', join(root, outs['16x9'].file), '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', poster], 'the poster');
  writeJson(join(dir, 'cut.json'), { at: new Date().toISOString(), edl: e, outputs: outs, poster: rel(root, poster) });
  return { ok: Math.abs(outs['16x9'].seconds - total) < 0.1 && Math.abs(outs['9x16'].seconds - total) < 0.1, command: 'cut', slug, seconds: +total.toFixed(3), outputs: outs, poster: rel(root, poster) };
}

/* ---------------------------------------------------------------- the draw-over film */

function serve(dir) {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.svg': 'image/svg+xml' };
  const server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = join(dir, p);
    if (!f.startsWith(dir) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(f).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

async function film(root) {
  const sub = pos[1]; const slug = pos[2];
  const dir = jobDir(root, slug);
  const filmDir = join(dir, 'film');
  if (sub === 'init') {
    mkdirSync(filmDir, { recursive: true });
    const tpl = join(HERE, 'drawover');
    const wrote = [];
    for (const f of readdirSync(tpl)) { if (!existsSync(join(filmDir, f))) { copyFileSync(join(tpl, f), join(filmDir, f)); wrote.push(`film/${f}`); } }
    return { ok: true, command: 'film init', slug, wrote, next: 'Edit film/shots.json (one entry per shot on the bar grid) and film/look.js (the look), then `film render`. Bases are extracted with `frames`.' };
  }
  if (sub === 'frames') {
    const base = resolve(String(flags.get('base') ?? ''));
    if (!existsSync(base)) throw new Error('--base <generated clip.mp4>');
    const id = String(flags.get('id') ?? base.split('/').pop().replace(/\.[a-z0-9]+$/i, ''));
    const out = join(dir, 'work', 'frames', id);
    rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
    ff(['-i', base, '-vf', 'fps=24', '-q:v', '3', join(out, 'f%05d.jpg')], 'frame extraction');
    return { ok: true, command: 'film frames', id, frames: readdirSync(out).length, dir: rel(root, out) };
  }
  if (sub !== 'render') throw new Error('film init <slug> | film frames <slug> --base <clip> | film render <slug>');
  const mode = flags.get('mode') === 'v' ? 'v' : 'h';
  const [W, H] = mode === 'v' ? [1080, 1920] : [1920, 1080];
  const shots = readJson(join(filmDir, 'shots.json'), null);
  if (!shots) throw new Error('no film/shots.json: run film init first');
  const fps = shots.fps ?? 24;
  const from = Number(flags.get('from') ?? 0); const to = Number(flags.get('to') ?? shots.length);
  const frames = join(dir, 'work', `film-${mode}`);
  rmSync(frames, { recursive: true, force: true }); mkdirSync(frames, { recursive: true });
  const { server, port } = await serve(dir);
  const { browser, close } = await launch(root, { width: W, height: H });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/film/index.html?mode=${mode}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.READY === true || window.FAIL, { timeout: 120_000 });
    const failed = await page.evaluate(() => window.FAIL);
    if (failed) throw new Error(`the film page failed: ${failed}`);
    const n0 = Math.round(from * fps); const n1 = Math.round(to * fps);
    for (let n = n0; n < n1; n++) {
      const url = await page.evaluate((t) => window.renderAt(t), n / fps);
      writeFileSync(join(frames, `f${String(n - n0).padStart(5, '0')}.jpg`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      if ((n - n0) % (fps * 5) === 0) say(`film ${mode}: ${((n - n0) / fps).toFixed(0)} s of ${(to - from).toFixed(0)}`);
    }
    if (errs.length) say(`page errors: ${errs.slice(0, 3).join(' | ')}`);
  } finally { await close(); server.close(); }
  const audio = shots.audio ? inJob(dir, shots.audio) : null;
  const out = join(dir, 'work', `film-${mode}.mp4`);
  // A drawn, boiling print costs a lot of bits; the cap keeps the delivery servable (25 MiB a file with no storage).
  const kbps = deliveryKbps(to - from, hasStorage(root));
  ff(['-framerate', String(fps), '-i', join(frames, 'f%05d.jpg'), ...(audio ? ['-ss', from.toFixed(4), '-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest'] : []),
    '-vf', 'format=rgb24,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', out], 'the film encode');
  rmSync(frames, { recursive: true, force: true });
  return { ok: true, command: 'film render', slug, mode, file: rel(root, out), seconds: probe(out).duration, bytes: statSync(out).size, maxKbps: kbps };
}

/* ---------------------------------------------------------------- review: sheets, words, sync */

function stillsAt(file, times, width) {
  const tmp = join(dirname(file), `.stills-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  const out = [];
  times.forEach((t, i) => {
    const f = join(tmp, `${String(i).padStart(4, '0')}.jpg`);
    const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', Math.max(0, t).toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', f]);
    out.push(r.code === 0 && existsSync(f) ? `data:image/jpeg;base64,${readFileSync(f).toString('base64')}` : null);
  });
  rmSync(tmp, { recursive: true, force: true });
  return out;
}

async function sheetOf(root, file, cells, out, { cols = 6, cellW = 300, title = '' } = {}) {
  const imgs = stillsAt(file, cells.map((c) => c.t), cellW);
  const f = probe(file);
  const aspect = f.video ? f.video.height / f.video.width : 9 / 16;
  const cellH = Math.round(cellW * aspect);
  const rows = Math.ceil(cells.length / cols);
  const W = cols * (cellW + 8) + 8; const Hh = rows * (cellH + 30) + 44;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#15161b;color:#ddd;font:14px ui-monospace,Menlo,monospace}
h1{font-size:15px;margin:10px 10px 8px;color:#ffd166}.g{display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:8px;padding:0 8px}
figure{margin:0}img{width:${cellW}px;height:${cellH}px;object-fit:cover;display:block;background:#000}figcaption{height:22px;line-height:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style></head>
<body><h1>${esc(title)}</h1><div class="g">${cells.map((c, i) => `<figure>${imgs[i] ? `<img src="${imgs[i]}">` : '<div style="height:' + cellH + 'px"></div>'}<figcaption>${esc(c.label)}</figcaption></figure>`).join('')}</div></body></html>`;
  await htmlToPng(root, html, out, { width: W, height: Hh });
  return out;
}

async function sheet(root) {
  const slug = pos[1];
  const dir = jobDir(root, slug);
  const file = resolve(String(flags.get('in') ?? join(dir, `${slug}.mp4`)));
  if (!existsSync(file)) throw new Error('--in <video file>');
  const every = Number(flags.get('every') ?? 1);
  const d = probe(file).duration;
  const cells = []; for (let t = 0.02; t < d; t += every) cells.push({ t, label: `${t.toFixed(2)} s` });
  const out = join(dir, 'work', `sheet-${file.split('/').pop().replace(/\.[a-z0-9]+$/i, '')}.png`);
  await sheetOf(root, file, cells, out, { cols: probe(file).video?.height > probe(file).video?.width ? 10 : 6, cellW: probe(file).video?.height > probe(file).video?.width ? 160 : 300, title: `${rel(root, file)} · every ${every} s` });
  return { ok: true, command: 'sheet', file: rel(root, out), frames: cells.length, look: 'Open the PNG and look at every cell before anyone else sees the video.' };
}

async function words(root) {
  const slug = pos[1];
  const dir = jobDir(root, slug);
  const file = resolve(String(flags.get('in') ?? ''));
  const g = readJson(join(dir, 'grid.json'), null);
  if (!existsSync(file) || !g) throw new Error('--in <video>, after grid (the sung words come from the song the music skill made)');
  const shift = Number(flags.get('offset') ?? 0); // where the song starts in this video
  const ws = g.words.filter((w) => w.s + shift < probe(file).duration);
  if (!ws.length) throw new Error('no sung words with times for this song (an instrumental, or a song not made with the music skill)');
  const cells = ws.map((w) => ({ t: w.s + shift + 0.04, label: `${(w.s + shift).toFixed(2)} ${w.w}` }));
  const out = join(dir, 'work', 'words.png');
  await sheetOf(root, file, cells, out, { cols: 8, cellW: 220, title: 'Every sung word, at its onset: the mouth and the lyric type must match the word' });
  return { ok: true, command: 'words', file: rel(root, out), words: cells.length };
}

/** Sound onset vs picture change near each expected hit: both should land on the same frame. */
function sync(root) {
  const slug = pos[1];
  const dir = jobDir(root, slug);
  const file = resolve(String(flags.get('in') ?? join(dir, `${slug}.mp4`)));
  if (!existsSync(file)) throw new Error('--in <video file>');
  let at = flags.get('at') ? String(flags.get('at')).split(',').map(Number) : null;
  if (!at) {
    const e = readJson(join(dir, 'work', 'edl.json'), null);
    if (!e) throw new Error('--at t1,t2,… (or cut from an edl)');
    at = []; let t = 0; for (const s of e.segments.slice(0, -1)) { t += s.dur; at.push(t); }
  }
  const f = probe(file);
  const fps = f.video?.fps ?? 30;
  const sr = 22050;
  const x = decodeMono(file, { rate: sr });
  const on = energyOnsets(x, sr);
  const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `scale=96:54,format=gray`, '-f', 'rawvideo', '-']);
  const px = 96 * 54; const nF = Math.floor(r.stdout.length / px);
  const diff = new Float32Array(nF);
  for (let i = 1; i < nF; i++) { let s = 0; for (let k = 0; k < px; k++) s += Math.abs(r.stdout[i * px + k] - r.stdout[(i - 1) * px + k]); diff[i] = s / px; }
  // Only an onset within two frames of the hit is the hit's sound: a pickup note just before a downbeat is music, not lag.
  const near = 2 / fps + 0.01;
  const rows = at.map((t) => {
    let bestI = -1; let bestV = -1;
    for (let i = Math.max(0, Math.round((t - near - on.offset) * on.rate)); i <= Math.min(on.env.length - 1, Math.round((t + near - on.offset) * on.rate)); i++) if (on.env[i] > bestV) { bestV = on.env[i]; bestI = i; }
    const sound = bestI >= 0 && bestV > 0.2 ? bestI / on.rate + on.offset : null;
    const f0 = Math.round(t * fps);
    let pk = -1; let pv = -1;
    for (let i = Math.max(1, f0 - 5); i <= Math.min(nF - 1, f0 + 5); i++) if (diff[i] > pv) { pv = diff[i]; pk = i; }
    const soundFrame = sound === null ? null : Math.round(sound * fps);
    const clearCut = pv > 3;
    return { at: +t.toFixed(3), expectedFrame: f0, soundAt: sound === null ? null : +sound.toFixed(3), soundFrame, pictureFrame: clearCut ? pk : null, offsetFrames: soundFrame === null || !clearCut ? null : pk - soundFrame, cutOnFrame: clearCut ? Math.abs(pk - f0) <= 1 : null, soundStrength: +bestV.toFixed(2), pictureChange: +pv.toFixed(1) };
  });
  const judged = rows.filter((x) => x.offsetFrames !== null);
  const bad = judged.filter((x) => Math.abs(x.offsetFrames) > 1);
  const offCut = rows.filter((x) => x.cutOnFrame === false);
  return { ok: bad.length === 0 && offCut.length === 0, command: 'sync', file: rel(root, file), fps, judged: judged.length, of: rows.length, outOfSync: bad.length, cutsOffTheirFrame: offCut.length, rows, rule: 'a cut or hit is in sync when the picture changes within one frame of a sound onset within two frames of it; a hit with no onset that close (a rest, or a pickup note before the bar) or no clear picture change is listed, not judged. Never move a cut off its bar to satisfy this check: fix the edit or the music instead' };
}

/* ---------------------------------------------------------------- add / publish */

function add(root) {
  const slug = pos[1];
  const dir = jobDir(root, slug);
  const title = flags.get('title');
  if (!title) throw new Error('--title "<title>"');
  const main = join(dir, `${slug}.mp4`);
  const src = flags.get('file') ? resolve(String(flags.get('file'))) : null;
  if (src && src !== main) copyFileSync(src, main);
  if (!existsSync(main)) throw new Error(`videos/${slug}/${slug}.mp4 is missing: cut it first (or --file <the finished 16:9 file>)`);
  const vertical = flags.get('vertical') ? resolve(String(flags.get('vertical'))) : join(dir, `${slug}-vertical.mp4`);
  if (flags.get('vertical') && vertical !== join(dir, `${slug}-vertical.mp4`)) copyFileSync(vertical, join(dir, `${slug}-vertical.mp4`));
  const files = [{ role: 'video', path: rel(root, main), type: 'video/mp4', bytes: statSync(main).size }];
  if (existsSync(join(dir, `${slug}-vertical.mp4`))) files.push({ role: 'vertical', path: rel(root, join(dir, `${slug}-vertical.mp4`)), type: 'video/mp4', bytes: statSync(join(dir, `${slug}-vertical.mp4`)).size });
  if (!existsSync(join(dir, 'poster.jpg'))) ff(['-ss', '1', '-i', main, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', join(dir, 'poster.jpg')], 'the poster');
  files.push({ role: 'poster', path: rel(root, join(dir, 'poster.jpg')), type: 'image/jpeg' });
  if (existsSync(join(dir, 'captions.vtt'))) files.push({ role: 'captions', path: rel(root, join(dir, 'captions.vtt')), type: 'text/vtt' });
  const budget = readJson(join(dir, 'budget.json'), null);
  const cutInfo = readJson(join(dir, 'cut.json'), null);
  const kind = String(flags.get('kind') ?? (flags.has('for-song') ? 'music-video' : 'trailer'));
  const models = [...new Set((budget?.calls ?? []).map((c) => c.model))];
  const song = flags.has('for-song') ? getEntry(root, 'music', String(flags.get('for-song'))) : null;
  const entry = {
    slug, kind, title: String(title), blurb: flags.get('blurb') ?? '', published: flags.has('publish'), duration: probe(main).duration, files,
    credits: flags.get('credits') ?? ([models.length ? `Generated footage: ${models.join(', ')} on fal.` : null, song?.credits ?? null].filter(Boolean).join(' ') || null),
    honesty: flags.get('honesty') ?? cutInfo?.edl?.honesty ?? null,
    rights: budget ? { provider: 'fal', models, commercial: null } : null,
    ...(flags.has('for-game') || flags.has('for-song') ? { for: { ...(flags.has('for-game') ? { game: String(flags.get('for-game')) } : {}), ...(flags.has('for-song') ? { song: String(flags.get('for-song')) } : {}) } } : {}),
    made: { at: new Date().toISOString(), provider: models.length ? 'fal' : 'capture', receipt: budget ? rel(root, join(dir, 'budget.json')) : null, spentUsd: budget?.spent ?? 0 },
  };
  upsertEntry(root, 'videos', entry);
  return { ok: true, command: 'add', slug, published: entry.published, files: files.map((f) => `${f.role} ${f.path}`), manifest: 'videos/manifest.json' };
}

/* ---------------------------------------------------------------- main */

function print(r) {
  if (asJson) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); return; }
  if (r.ok === false && r.why) { process.stdout.write(`video: ${r.why}\n`); return; }
  const L = [];
  switch (r.command) {
    case 'check': L.push(`fal: ${r.fal.ok ? 'key accepted' : r.fal.why}`, `ffmpeg: ${r.ffmpeg ? 'yes' : 'NO'}; Chrome: ${r.chrome ?? 'NO'}`, `Studio: ${r.studio.ok ? `${r.studio.root}${r.studio.puppeteer ? '' : ' (no puppeteer-core: npm install)'}` : r.studio.why}`); break;
    case 'price': L.push(`${r.model}: US$${r.usd.toFixed(4)} (${r.basis}; ${r.unitPrice} per ${r.unit})`); break;
    case 'gen': L.push(r.already ? `already made: ${r.already}` : r.dryRun ? `dry run: US$${r.price.usd.toFixed(4)} (${r.price.basis}); nothing sent` : `made ${r.files.join(', ')} for US$${r.usd.toFixed(2)}; this video has spent US$${Number(r.spent).toFixed(2)}`); break;
    case 'grid': L.push(`${r.bpm} BPM (confidence ${r.confidence}), bars of ${r.barSeconds} s from ${r.offset} s; ${r.bars} bars, ${r.words} sung words. ${r.file}`); break;
    case 'lag': L.push(`${r.base}: ${r.lagMs} ms (${r.lagFramesAt24} frames at 24 fps), peak ${r.peak}: ${r.verdict}`); break;
    case 'capture': L.push(`captured ${r.seconds} s (${r.sourceFps} fps from the page, ${r.heldFrames} held) to ${r.file}; ${r.audio ? `game sound ${r.audio.seconds} s, peak ${r.audio.peakDb} dB` : 'the game made no sound'}`); if (r.advice) L.push(`  note: ${r.advice}`); break;
    case 'edl': L.push(`${r.shots} shots of ${r.shotSeconds} s${r.title ? `, title ${r.title} s` : ''}, end card ${r.end} s; cuts at ${r.cuts.join(', ')}. ${r.file}`); break;
    case 'cut': L.push(`${r.seconds} s: ${r.outputs['16x9'].file} (${r.outputs['16x9'].loudness?.lufs ?? '-'} LUFS), ${r.outputs['9x16'].file}; poster ${r.poster}`); break;
    case 'sync': L.push(`${r.ok ? 'in sync' : 'OUT OF SYNC'}: ${r.judged} of ${r.of} hits judged, ${r.outOfSync} off by more than a frame`, ...r.rows.map((x) => `  ${x.at}s sound ${x.soundAt ?? '-'} picture f${x.pictureFrame} offset ${x.offsetFrames ?? '-'}`)); break;
    default: L.push(JSON.stringify(r, null, 2));
  }
  process.stdout.write(`${L.join('\n')}\n`);
}

async function main() {
  const cmd = pos[0];
  if (!cmd || cmd === 'help' || flags.has('help')) {
    process.stdout.write(`${readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].split('\n').slice(2).map((l) => l.replace(/^ \* ?/, '')).join('\n')}\n`);
    return null;
  }
  if (cmd === 'check') return check();
  if (cmd === 'price') return price();
  const root = requireStudio();
  switch (cmd) {
    case 'budget': return budget(root);
    case 'gen': return gen(root);
    case 'grid': return grid(root);
    case 'slice': return slice(root);
    case 'lag': return lag(root);
    case 'capture': return capture(root);
    case 'edl': return edl(root);
    case 'card': return card(root);
    case 'cut': return cut(root);
    case 'film': return film(root);
    case 'sheet': return sheet(root);
    case 'words': return words(root);
    case 'sync': return sync(root);
    case 'add': return add(root);
    case 'publish': return publishEntry(root, 'videos', pos[1], { deploy: !flags.has('no-deploy') });
    default: return { ok: false, command: cmd, why: `unknown command "${cmd}" (video.mjs help)` };
  }
}

try {
  const r = await main();
  if (r) { print(r); if (r.ok === false) process.exitCode = 1; }
} catch (error) {
  print({ ok: false, why: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
