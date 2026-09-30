/**
 * The music skill's script, end to end, against a stand-in ElevenLabs CLI
 * (fixtures/fake-elevenlabs.mjs): no account, no network, no credits.
 * Run: node --test plugins/homie/test/music.test.mjs   (needs ffmpeg)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..');
const MUSIC = join(PLUGIN, 'skills', 'music', 'scripts', 'music.mjs');
const STUDIO_PKG = join(PLUGIN, '..', '..', 'packages', 'studio');
const REPO_NM = join(PLUGIN, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-music-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const fake = join(scratch, 'bin', 'elevenlabs');
mkdirSync(dirname(fake), { recursive: true });
writeFileSync(fake, `#!/bin/sh\nexec "${process.execPath}" "${join(HERE, 'fixtures', 'fake-elevenlabs.mjs')}" "$@"\n`);
chmodSync(fake, 0o755);
const STATE = join(scratch, 'el-state.json');
const env = (extra = {}) => ({ ...process.env, ELEVENLABS_CLI: fake, FAKE_EL_STATE: STATE, ELEVENLABS_API_KEY: '', ...extra });
const music = (args, cwd, extra) => {
  const r = spawnSync(process.execPath, [MUSIC, ...args, '--json'], { cwd, encoding: 'utf8', env: env(extra) });
  try { return JSON.parse(r.stdout); } catch { throw new Error(`no JSON from music ${args.join(' ')}: ${r.stdout}${r.stderr}`); }
};

/** A studio as `homie-studio new` makes it, with this monorepo's @homie-rocks/studio linked in. */
function studio(name) {
  const dir = join(scratch, name);
  const r = spawnSync(process.execPath, [join(STUDIO_PKG, 'bin', 'homie-studio.mjs'), 'new', dir, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
  symlinkSync(STUDIO_PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  symlinkSync(join(STUDIO_PKG, 'bin', 'homie-studio.mjs'), join(dir, 'node_modules', '.bin', 'homie-studio'));
  return dir;
}

const SPEC = {
  title: 'Night Owls Theme', bpm: 120, key: 'A minor',
  styles: ['driving synth-pop', 'punchy drums', 'warm female lead vocal, clear diction'], avoid: ['rap'],
  sections: [
    { name: 'Intro', bars: 2, instrumental: true, styles: ['filtered arpeggio'] },
    { name: 'Hook', bars: 4, lines: ['Night owls never sleep', 'We light the city up'] },
    { name: 'Outro', bars: 2, instrumental: true },
  ],
};

test('music: check, quote, a bar-exact plan, a budget that refuses, one approved render, the lyric check, master, a seamless loop, the manifest and the page', () => {
  const dir = studio('owls');
  const c = music(['check'], dir);
  assert.equal(c.road, 'cli');
  assert.equal(c.plan.tier, 'creator');
  assert.equal(c.rights.commercial, true);
  assert.equal(c.studio.pages.ok, true, 'this studio package has song pages');
  const signedOut = music(['check'], dir, { FAKE_EL_SIGNED_OUT: '1' });
  assert.equal(signedOut.ok, false);
  assert.match(signedOut.why, /elevenlabs auth login/);
  assert.equal(music(['check'], dir, { FAKE_EL_TIER: 'free', FAKE_EL_STATE: join(scratch, 'free.json') }).rights.commercial, false, 'a free plan has no commercial licence');

  const q = music(['quote', '--seconds', '30', '--budget', '480'], dir);
  assert.equal(q.credits.music, 825);
  assert.equal(q.longestWithinBudget, 17, 'a 480-credit budget buys about 17 s');

  writeFileSync(join(dir, 'spec.json'), JSON.stringify(SPEC));
  const p = music(['plan', 'theme', '--spec', join(dir, 'spec.json')], dir);
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual([p.seconds, p.bars, p.vocals], [16, 8, true]);
  assert.deepEqual(p.sections.map((s) => s.ms), [4000, 8000, 4000], 'every section is whole bars at 120 BPM');
  const plan = JSON.parse(readFileSync(join(dir, 'music/theme/plan.json'), 'utf8'));
  assert.match(plan.composition_plan.chunks[0].positive_styles.join('|'), /120 BPM\|A minor/);
  assert.ok(plan.composition_plan.chunks[0].negative_styles.includes('vocals'), 'an instrumental section says so');
  const tooShort = music(['plan', 'bad', '--spec', join(dir, 'bad.json')], dir);
  assert.equal(tooShort.ok, false);
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ ...SPEC, sections: [{ name: 'Blip', bars: 1, instrumental: true }] }));
  assert.match(music(['plan', 'bad', '--spec', join(dir, 'bad.json')], dir).why, /3000 ms or more/);

  assert.match(music(['render', 'theme', '--yes'], dir).why, /no budget set/, 'nothing is rendered without a budget');
  music(['budget', 'theme', '--cap', '300'], dir);
  assert.match(music(['render', 'theme', '--yes'], dir).why, /REFUSED: .* would pass the cap of 300 credits/);
  music(['budget', 'theme', '--cap', '480'], dir);
  const ask = music(['render', 'theme'], dir);
  assert.equal(ask.needs, 'approval', 'without --yes it asks');
  assert.equal(ask.quote.music, 440);
  const dry = music(['render', 'theme', '--dry-run'], dir);
  assert.equal(dry.ok, true);
  assert.equal(dry.sent, false);
  const before = JSON.parse(readFileSync(STATE, 'utf8')).used;
  const r = music(['render', 'theme', '--yes'], dir);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.creditsMeasured, 440, 'the cost is measured off the account');
  assert.equal(JSON.parse(readFileSync(STATE, 'utf8')).used - before, 440);
  assert.ok(Math.abs(r.seconds - 16) < 0.15, `rendered ${r.seconds} s`);
  assert.equal(r.songId, 'fake-song-1');
  const budget = JSON.parse(readFileSync(join(dir, 'music/theme/budget.json'), 'utf8'));
  assert.equal(budget.spent, 440);
  const receipts = readFileSync(join(dir, 'music/receipts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(receipts.at(-1).cost, 440);
  assert.equal(receipts.at(-1).rights.commercial, true);

  const ok = music(['lyrics', 'theme'], dir);
  assert.equal(ok.ok, true, JSON.stringify(ok.lines));
  const miss = music(['lyrics', 'theme'], dir, { FAKE_EL_DROP_LINE: 'city' });
  assert.equal(miss.ok, false);
  assert.deepEqual(miss.missing, ['We light the city up'], 'an unsung line is caught');

  const m = music(['master', 'theme', '--lufs', '-14', '--tp', '-1'], dir);
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.ok(Math.abs(m.master.lufs + 14) <= 1, `master at ${m.master.lufs} LUFS`);
  assert.ok(m.mp3.truePeak <= -0.4, `mp3 true peak ${m.mp3.truePeak}`);

  const l = music(['loop', 'theme', '--bars', '4', '--from-bar', '2'], dir);
  assert.equal(l.ok, true, JSON.stringify(l));
  assert.equal(l.samples, 4 * 2 * 48000, 'four bars at 120 BPM, to the sample');
  assert.ok(l.seam.ok, 'the wrap is no louder than the music\'s own steps');
  assert.ok(l.gridPhaseLoopedMs <= 30, `looped three times, the beat stays on the grid (${l.gridPhaseLoopedMs} ms)`);

  const a = music(['add', 'theme', '--title', 'Night Owls Theme', '--blurb', 'The studio theme.', '--publish'], dir);
  assert.equal(a.ok, true);
  const entry = JSON.parse(readFileSync(join(dir, 'music/manifest.json'), 'utf8')).items[0];
  assert.equal(entry.slug, 'theme');
  assert.deepEqual(entry.files.map((f) => f.role).sort(), ['audio', 'loop', 'loop', 'master']);
  assert.equal(entry.files.find((f) => f.role === 'master').public, false);
  assert.equal(entry.rights.commercial, true);
  assert.match(entry.lyrics, /Night owls never sleep/);
  const pub = music(['publish', 'theme', '--no-deploy'], dir);
  assert.equal(pub.ok, true, JSON.stringify(pub));
  assert.deepEqual(pub.built, ['theme']);
  assert.ok(existsSync(join(dir, 'site/dist/music/theme/theme.mp3')));
  assert.equal(existsSync(join(dir, 'site/dist/music/theme/theme-master.wav')), false);

  // The account's balance can lag a render: the quote holds the budget until reconcile reads the real number.
  music(['budget', 'theme', '--cap', '2000'], dir);
  const lagged = music(['render', 'theme', '--yes'], dir, { FAKE_EL_LAG_READS: '50', MUSIC_SETTLE_MS: '5' });
  assert.equal(lagged.ok, true, JSON.stringify(lagged));
  assert.equal(lagged.creditsMeasured, null);
  assert.match(lagged.note, /reconcile/);
  let b = JSON.parse(readFileSync(join(dir, 'music/theme/budget.json'), 'utf8'));
  assert.equal(b.calls.at(-1).pending, true);
  assert.equal(b.calls.at(-1).cost, 440, 'a pending render counts its quote against the cap, never 0');
  writeFileSync(STATE, JSON.stringify({ ...JSON.parse(readFileSync(STATE, 'utf8')), lagLeft: 0, used: JSON.parse(readFileSync(STATE, 'utf8')).used + 5 }));
  const rec = music(['reconcile', 'theme'], dir);
  assert.equal(rec.ok, true, JSON.stringify(rec));
  assert.equal(rec.measured, 445, 'the real number, once the account shows it');
  b = JSON.parse(readFileSync(join(dir, 'music/theme/budget.json'), 'utf8'));
  assert.equal(b.calls.at(-1).pending, false);
  writeFileSync(join(dir, 'music/theme/work/render-9.pending'), '{}');
  assert.match(music(['render', 'theme', '--yes'], dir).why, /may have been billed/, 'a render that never came back is not silently paid for twice');
});
