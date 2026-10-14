/** Local media preparation and completed-output import tests. No provider clients or credentials. */
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

const env = () => process.env;
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

test('music: local composition, mastering, loop, manifest and page', () => {
  const dir = studio('owls');
  const c = music(['check'], dir);
  assert.equal(c.ok, true);
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

  const raw = join(dir, 'music/theme/raw.wav');
  assert.equal(spawnSync('ffmpeg', ['-v','error','-f','lavfi','-i','sine=frequency=440:duration=16','-y',raw]).status,0);
  const m = music(['master', 'theme', '--in', raw, '--lufs', '-14', '--tp', '-1'], dir);
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
  assert.equal(entry.rights, null);
  assert.match(entry.lyrics, /Night owls never sleep/);
  const pub = music(['publish', 'theme', '--no-deploy'], dir);
  assert.equal(pub.ok, true, JSON.stringify(pub));
  assert.deepEqual(pub.built, ['theme']);
  assert.ok(existsSync(join(dir, 'site/dist/music/theme/theme.mp3')));
  assert.equal(existsSync(join(dir, 'site/dist/music/theme/theme-master.wav')), false);

});
