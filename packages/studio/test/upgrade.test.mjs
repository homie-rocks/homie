/**
 * @homie-rocks/studio 0.9.0: `homie-studio upgrade` brings a studio made on an older template up to this one's,
 * and never touches what the studio made its own.
 *
 *   - an AGENTS.md section the studio never changed (its text is exactly an older template's) takes the new text;
 *     a section the studio changed, or wrote itself, is kept byte for byte; a new one goes in after its neighbour;
 *   - a missing README, D1 migration or .gitignore line is added; the pin moves to this version;
 *   - nothing is written without --apply, and a second run finds nothing to do;
 *   - the history of template fingerprints knows this version's template (a test fails until it is regenerated).
 * The fixture is the AGENTS.md @homie-rocks/studio 0.7.0 wrote for a studio called Night Owls.
 * Run: node --test packages/studio/test/upgrade.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { studioFiles } from '../lib/scaffold.mjs';
import { STAND_IN, lineDiff, pinnedVersion, readHistory, sections, templatePrint } from '../lib/upgrade.mjs';
import { STUDIO_VERSION } from '../lib/version.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const OLD_AGENTS = readFileSync(join(PKG, 'test', 'fixtures', 'studio-0.7.0', 'AGENTS.md'), 'utf8');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-upgrade-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const out = (r) => JSON.parse(r.stdout);
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const json = (dir, rel) => JSON.parse(read(dir, rel));
const save = (dir, rel, v) => writeFileSync(join(dir, rel), typeof v === 'string' ? v : `${JSON.stringify(v, null, 2)}\n`);

/** A Night Owls studio as 0.7.0 left it, with a section of its own and its own words in Rules. */
function oldStudio(name) {
  const dir = join(scratch, name);
  assert.equal(run(['new', dir, '--name', 'Night Owls', '--homie', 'https://homie.rocks', '--no-install'], scratch).status, 0);
  const own = '## This studio: Night Owls\n\nOur games are about owls. Keep every game under 3 MB.\n';
  save(dir, 'AGENTS.md', `${OLD_AGENTS.replace('- Nothing in this studio needs `~/.homie` or a Homie box.', '- Nothing in this studio needs `~/.homie` or a Homie box.\n- Owls only: no other birds.')}\n${own}`);
  const pkg = json(dir, 'package.json');
  pkg.devDependencies['@homie-rocks/studio'] = 'https://homie.rocks/npm/homie-studio-0.7.0.tgz';
  delete pkg.scripts.check;
  save(dir, 'package.json', pkg);
  const s = json(dir, 'studio.json');
  s.homie.studio = '0.7.0';
  save(dir, 'studio.json', s);
  save(dir, '.gitignore', read(dir, '.gitignore').replace('# Screenshots from check and look runs.\n.checks/\n', ''));
  unlinkSync(join(dir, 'site/README.md'));
  unlinkSync(join(dir, 'HANDOFF.md'));
  unlinkSync(join(dir, 'site/migrations/0002_studio_stats.sql'));
  unlinkSync(join(dir, 'site/migrations/0005_studio_office.sql'));
  save(dir, 'site/src/worker.mjs', "// Our own wrapper.\nexport { default, Table, Lobby } from '@homie-rocks/studio/worker';\n");
  return { dir, own };
}

test('upgrade shows what the new template adds, and changes nothing until --apply', () => {
  const { dir } = oldStudio('plan');
  const before = new Map(['AGENTS.md', 'package.json', 'studio.json', '.gitignore'].map((f) => [f, read(dir, f)]));
  const plan = out(run(['upgrade'], dir));
  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.equal(plan.applied, false);
  assert.equal(plan.from, '0.7.0');
  assert.equal(plan.to, STUDIO_VERSION);
  const what = plan.changes.map((c) => `${c.kind} ${c.file}${c.section ? ` ${c.section}` : ''}`);
  assert.deepEqual(what.sort(), [
    'add-file HANDOFF.md',
    'add-file site/README.md',
    'add-file site/migrations/0002_studio_stats.sql',
    'add-file site/migrations/0005_studio_office.sql',
    'add-lines .gitignore',
    'add-section AGENTS.md ## Continuing a build from the Claude app',
    'add-section AGENTS.md ## Running live games (the back office)',
    'add-section AGENTS.md ## The Game Codex and progress',
    'pin package.json',
    'scripts package.json',
    'update-section AGENTS.md ## Commands (all through the pinned CLI in node_modules)',
    'update-section AGENTS.md ## Layout',
    'update-section AGENTS.md ## Making games',
    'update-section AGENTS.md ## The site',
    'version studio.json',
  ].sort());
  assert.deepEqual(plan.changes.find((c) => c.kind === 'add-lines').lines, ['# Screenshots from check and look runs.', '.checks/'], 'a missing line comes with its comment');
  assert.deepEqual(plan.changes.find((c) => c.kind === 'pin').to, `https://homie.rocks/npm/homie-studio-${STUDIO_VERSION}.tgz`, 'the same kind of pin, this version');
  assert.deepEqual(plan.changes.find((c) => c.kind === 'scripts').scripts, { check: 'homie-studio check' });
  assert.deepEqual(plan.kept.map((k) => `${k.file}${k.section ? ` ${k.section}` : ''}`).sort(), ['AGENTS.md ## Rules', 'site/src/worker.mjs'], 'the studio\'s own words are kept');
  for (const [f, text] of before) assert.equal(read(dir, f), text, `${f} is untouched without --apply`);
  assert.equal(existsSync(join(dir, 'site/README.md')), false);
  // The words a person reads: a plan, the diffs, and the one command that applies it.
  const human = spawnSync(process.execPath, [CLI, 'upgrade', '--diff'], { cwd: dir, encoding: 'utf8' }).stdout;
  assert.match(human, /Nothing is changed until --apply/);
  assert.match(human, /~ AGENTS\.md +section "## Making games": the template's newer text \(the studio never changed it\)/);
  assert.match(human, /\+ - The play page's small room button/);
  assert.match(human, /= AGENTS\.md +section "## Rules": changed by the studio/);
  assert.match(human, /- - Owls only: no other birds\./, '--diff shows the studio\'s own lines against the template\'s');
  assert.match(human, /npx --no-install homie-studio upgrade --apply/);
});

test('--apply takes the template\'s new text where the studio never changed it, and keeps every word of its own', () => {
  const { dir, own } = oldStudio('apply');
  const oldRules = sections(read(dir, 'AGENTS.md')).find((s) => s.heading === '## Rules').text;
  const r = out(run(['upgrade', '--apply'], dir));
  assert.equal(r.applied, true, JSON.stringify(r));
  assert.equal(r.skipped.length, 0);
  const now = read(dir, 'AGENTS.md');
  const want = studioFiles({ name: 'Night Owls', slug: 'night-owls', homie: 'https://homie.rocks' });
  const mine = sections(now);
  for (const t of sections(want['AGENTS.md'])) {
    const s = mine.find((x) => x.heading === t.heading);
    if (t.heading === '## Rules') assert.equal(s.text, oldRules, 'the studio\'s Rules, byte for byte');
    else assert.equal(s.text.trimEnd(), t.text.trimEnd(), `${t.heading} is the template's`);
  }
  assert.ok(now.endsWith(own), 'its own section stays where it was, last');
  assert.deepEqual(mine.map((s) => s.heading), [...sections(want['AGENTS.md']).map((s) => s.heading), '## This studio: Night Owls']);
  assert.equal(read(dir, 'site/README.md'), want['site/README.md']);
  assert.equal(read(dir, 'site/migrations/0002_studio_stats.sql'), want['site/migrations/0002_studio_stats.sql']);
  assert.match(read(dir, '.gitignore'), /\n# Screenshots from check and look runs\.\n\.checks\/\n$/);
  assert.equal(json(dir, 'package.json').devDependencies['@homie-rocks/studio'], `https://homie.rocks/npm/homie-studio-${STUDIO_VERSION}.tgz`);
  assert.equal(json(dir, 'package.json').scripts.check, 'homie-studio check');
  assert.equal(json(dir, 'studio.json').homie.studio, STUDIO_VERSION);
  assert.equal(read(dir, 'site/src/worker.mjs'), "// Our own wrapper.\nexport { default, Table, Lobby } from '@homie-rocks/studio/worker';\n", 'the studio\'s own Worker is never replaced');
  assert.ok(r.next.some((n) => /npm install/.test(n)), 'a new pin says to install it');
  // Nothing more to do; the studio's own words are still only reported.
  const again = out(run(['upgrade'], dir));
  assert.deepEqual(again.changes, []);
  assert.deepEqual(again.kept.map((k) => k.section ?? k.file).sort(), ['## Rules', 'site/src/worker.mjs']);
});

test('the pin: a newer studio is refused, a link to a checkout is left as it is', () => {
  const { dir } = oldStudio('pins');
  const pkg = json(dir, 'package.json');
  pkg.devDependencies['@homie-rocks/studio'] = 'https://homie.rocks/npm/homie-studio-99.0.0.tgz';
  save(dir, 'package.json', pkg);
  const newer = out(run(['upgrade'], dir));
  assert.equal(newer.ok, false);
  assert.match(newer.why, /pins @homie-rocks\/studio 99\.0\.0, newer than this/);
  pkg.devDependencies['@homie-rocks/studio'] = 'file:../homie/packages/studio';
  save(dir, 'package.json', pkg);
  const linked = out(run(['upgrade'], dir));
  assert.equal(linked.changes.some((c) => c.kind === 'pin'), false);
  assert.ok(linked.kept.some((k) => k.file === 'package.json'));
  assert.equal(pinnedVersion('npm:@homie-rocks/studio@0.7.0'), '0.7.0');
  assert.equal(pinnedVersion('0.8.0'), '0.8.0');
  assert.equal(pinnedVersion('^0.8.0'), null, 'a range is not a pin');
});

test('the history knows this version\'s template (run node scripts/studio-template-history.mjs after changing it)', () => {
  const history = readHistory();
  const entry = history.versions?.[STUDIO_VERSION];
  assert.ok(entry, `lib/template-history.json has no ${STUDIO_VERSION}: run node scripts/studio-template-history.mjs`);
  const now = templatePrint(studioFiles({ ...STAND_IN, homie: 'https://homie.rocks' }));
  const has = (v, h) => [v].flat().includes(h);
  for (const [f, h] of Object.entries(now.files)) assert.ok(has(entry.files[f], h), `${f} changed since the history was made: run node scripts/studio-template-history.mjs`);
  for (const [s, h] of Object.entries(now.sections['AGENTS.md'])) assert.ok(has(entry.sections['AGENTS.md'][s], h), `AGENTS.md "${s}" changed since the history was made: run node scripts/studio-template-history.mjs`);
  // The fixture is exactly 0.7.0's, so the test above is a real upgrade from a real template.
  const fixture = templatePrint({ ...studioFiles({ ...STAND_IN, homie: 'https://homie.rocks' }), 'AGENTS.md': OLD_AGENTS.split('Night Owls').join(STAND_IN.name).split('night-owls').join(STAND_IN.slug) });
  for (const [s, h] of Object.entries(fixture.sections['AGENTS.md'])) assert.ok(has(history.versions['0.7.0'].sections['AGENTS.md'][s], h), `the 0.7.0 fixture's "${s}"`);
});

test('a line diff keeps the lines both have and marks the rest', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nB\nc'), ['  a', '- b', '+ B', '  c']);
  assert.deepEqual(lineDiff('1\n2\n3\n4\n5\n6\n7\n8', '1\n2\n3\n4\n5\n6\n7\nX', { context: 1 }), ['  …', '  7', '- 8', '+ X']);
});
