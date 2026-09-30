#!/usr/bin/env node
/**
 * A stand-in for the official `elevenlabs` CLI, for tests: the same commands and
 * answer shapes the music skill uses, no network, no account. State (credits
 * used) lives in FAKE_EL_STATE. A render is a click track at the plan's tempo,
 * made with ffmpeg; the "transcript" is the plan's lyrics, minus the line
 * FAKE_EL_DROP_LINE names (to prove the lyric check catches an unsung line).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const has = (a) => args.includes(a);
const val = (a) => { const i = args.indexOf(a); return i >= 0 ? args[i + 1] : null; };
const STATE = process.env.FAKE_EL_STATE ?? join(tmpdir(), 'fake-el-state.json');
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { used: 1000, limit: 100000, tier: process.env.FAKE_EL_TIER ?? 'creator', lastPlan: null };
const save = () => writeFileSync(STATE, JSON.stringify(state));
if (!existsSync(STATE)) save();
const out = (x) => process.stdout.write(typeof x === 'string' ? x : `${JSON.stringify(x, null, 2)}\n`);

if (has('--version')) { out('elevenlabs 0.0.0-fake\n'); process.exit(0); }
const cmd = args.filter((a) => !a.startsWith('-')).slice(0, 3).join(' ');
if (cmd.startsWith('auth status')) { out({ backend: 'fake', schemes: [{ logged_in: process.env.FAKE_EL_SIGNED_OUT ? false : true, scheme: 'OAuth' }] }); process.exit(0); }
if (cmd.startsWith('user subscription get')) {
  // FAKE_EL_LAG_READS: the account reports a render's cost only after that many more reads (the real balance lags).
  let shown = state.used;
  if (state.lagLeft > 0) { state.lagLeft -= 1; shown = state.shownUsed; save(); }
  out({ tier: state.tier, status: 'active', character_count: shown, character_limit: state.limit, next_character_count_reset_unix: 1893456000, can_extend_character_limit: false, allowed_to_extend_character_limit: false });
  process.exit(0);
}
if (cmd.startsWith('music compose_detailed')) {
  const body = JSON.parse(readFileSync(0, 'utf8'));
  if (has('--dry-run')) { out({ body, dry_run: true, method: 'POST', query_params: [['output_format', val('--output-format')]], url: 'https://api.elevenlabs.io/v1/music/detailed' }); process.exit(0); }
  const chunks = body.composition_plan?.chunks ?? [];
  const ms = chunks.length ? chunks.reduce((a, c) => a + c.duration_ms, 0) : body.music_length_ms;
  const bpm = Number(/(\d+(?:\.\d+)?) BPM/.exec(JSON.stringify(chunks[0]?.positive_styles ?? []))?.[1] ?? 120);
  const period = 60 / bpm;
  const f = join(tmpdir(), `fake-el-${process.pid}.mp3`);
  const expr = `0.7*sin(2*PI*55*t)*exp(-25*mod(t,${period}))+0.15*sin(2*PI*330*t)*exp(-6*mod(t+${period / 2},${period}))`;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=48000:d=${ms / 1000}:c=stereo`, '-c:a', 'libmp3lame', '-b:a', '192k', f]);
  if (r.status !== 0) { process.stderr.write('ffmpeg failed\n'); process.exit(1); }
  const audio = readFileSync(f); rmSync(f);
  state.shownUsed = state.used; state.lagLeft = Number(process.env.FAKE_EL_LAG_READS ?? 0);
  state.used += Math.ceil((ms / 1000) * 27.5); state.lastPlan = chunks; save();
  const words = [];
  let t = 0;
  for (const c of chunks) { for (const line of c.text.split('\n').slice(1)) { if (line.startsWith('{')) continue; for (const w of line.split(/\s+/)) { words.push({ word: w, start_ms: t, end_ms: t + 300 }); t += 350; } } t = Math.max(t, 0); }
  const json = JSON.stringify({ composition_plan: body.composition_plan ?? null, song_metadata: { title: 'fake' }, words_timestamps: words });
  const B = 'fakeboundary';
  const parts = Buffer.concat([Buffer.from(`--${B}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${B}\r\nContent-Type: audio/mpeg\r\n\r\n`), audio, Buffer.from(`\r\n--${B}--\r\n`)]);
  // A pipe takes 64 KB at a time: exit only once the whole answer is written.
  process.stdout.write(Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\ncontent-type: multipart/mixed; boundary=${B}\r\nsong-id: fake-song-1\r\n\r\n`), parts]), () => process.exit(0));
  await new Promise(() => {});
}
if (cmd.startsWith('speech-to-text convert')) {
  const lines = (state.lastPlan ?? []).flatMap((c) => c.text.split('\n').slice(1)).filter((l) => l && !l.startsWith('{'));
  const drop = process.env.FAKE_EL_DROP_LINE;
  const words = []; let t = 0.2;
  for (const line of lines) {
    if (drop && line.includes(drop)) { words.push({ text: 'mm', type: 'word', start: t, end: t + 0.3 }); t += 1; continue; }
    for (const w of line.split(/\s+/)) { words.push({ text: w, type: 'word', start: t, end: t + 0.3 }); words.push({ text: ' ', type: 'spacing', start: t + 0.3, end: t + 0.35 }); t += 0.35; }
  }
  state.used += 3; save();
  out({ language_code: 'eng', text: words.filter((w) => w.type === 'word').map((w) => w.text).join(' '), words, transcription_id: 'fake-stt-1' });
  process.exit(0);
}
process.stderr.write(`fake elevenlabs: unknown command ${args.join(' ')}\n`);
process.exit(2);
