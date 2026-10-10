import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const [name, args, studio, plugin] of [
  ['next patches from main', [], '2.0.1', '3.0.1'],
  ['explicit slots with a version shared by both packages', ['1.0.2', '1.0.1'], '1.0.2', '1.0.1'],
]) test(`renumber release: ${name}`, () => {
  const root = mkdtempSync(join(tmpdir(), 'homie-renumber-'));
  const put = (file, value, options) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), value, options);
  };
  const json = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
  try {
    const manifests = ['packages/studio/package.json', '.claude-plugin/marketplace.json', 'plugins/homie/plugin.json', 'plugins/homie/.claude-plugin/plugin.json', 'plugins/homie/.codex-plugin/plugin.json', 'plugins/homie/.grok-plugin/plugin.json'];
    for (const file of manifests) put(file, JSON.stringify({ version: '1.0.1' }));
    put('packages/studio/worker/version.mjs', "export const STUDIO_VERSION_TAG = '1.0.1';\n");
    const released = '\n## [0.9.0]\n\nPublished bytes mentioning 1.0.1 stay untouched.\n';
    put('CHANGELOG.md', '# Changelog\n\n## [1.0.1]\n\n**Plugin 1.0.1**\n\nBased on main studio 1.0.1.\n' + released);
    put('packages/studio/lib/template-history.json', JSON.stringify({ versions: { '0.9.0': { frozen: true }, '1.0.1': { pending: true } } }));
    for (const script of ['template.mjs', 'studio-template-history.mjs', 'changelog.mjs']) {
      put(`scripts/${script}`, `import { appendFileSync } from 'node:fs'; appendFileSync('generators', ${JSON.stringify(script + '\n')});`);
    }
    copyFileSync(new URL('renumber-release.mjs', import.meta.url), join(root, 'scripts/renumber-release.mjs'));
    put('bin/git', `#!${process.execPath}\nconst ref=process.argv.at(-1);console.log(JSON.stringify(ref.endsWith('template-history.json')?{versions:{'0.9.0':{frozen:true}}}:{version:ref.includes('packages/studio/')?'2.0.0':'3.0.0'}));\n`, { mode: 0o755 });
    put('bin/npm', `#!${process.execPath}\nrequire('node:fs').writeFileSync('npm-args',JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, ['scripts/renumber-release.mjs', ...args], { cwd: root, env: { ...process.env, PATH: join(root, 'bin') + delimiter + process.env.PATH }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const file of manifests) assert.equal(json(file).version, file.startsWith('packages/studio/') ? studio : plugin, file);
    assert.ok(readFileSync(join(root, 'packages/studio/worker/version.mjs'), 'utf8').includes(`'${studio}'`));
    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    assert.ok(changelog.includes(`## [${studio}]`));
    assert.ok(changelog.includes(`**Plugin ${plugin}**`));
    assert.ok(changelog.endsWith(released));
    assert.ok(changelog.includes('Based on main studio 1.0.1.'), 'base version in upgrade notes must not be renumbered');
    assert.deepEqual(json('packages/studio/lib/template-history.json'), { versions: { '0.9.0': { frozen: true } } });
    assert.equal(readFileSync(join(root, 'generators'), 'utf8'), 'template.mjs\nstudio-template-history.mjs\nchangelog.mjs\n');
    assert.deepEqual(json('npm-args'), ['install', '--package-lock-only', '--ignore-scripts']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
