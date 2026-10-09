import test from 'node:test';
import assert from 'node:assert/strict';
import { deferredPackages } from './publish-plan.mjs';
const row = (name, exists = true, published = false) => ({ name, exists, published });
test('a new navigation package does not hold back the independent studio release', () => {
  const plan = [row('nav', false), row('studio')];
  const deferred = deferredPackages(plan, new Map(plan.map((p) => [p.name, { pj: {} }])));
  assert.deepEqual([...deferred.keys()], ['nav']);
  assert.match(deferred.get('nav'), /maintainer/);
});
test('deferred publication follows transitive, peer and optional dependencies in any order', () => {
  const plan = [row('app'), row('helpers'), row('nav', false), row('studio')];
  const packages = new Map([['app', { pj: { optionalDependencies: { helpers: '0.1.0' } } }], ['helpers', { pj: { peerDependencies: { nav: '0.1.0' } } }], ['nav', { pj: {} }], ['studio', { pj: {} }]]);
  assert.deepEqual([...deferredPackages(plan, packages).keys()].sort(), ['app', 'helpers', 'nav']);
});
test('once the maintainer bootstraps navigation, its next version and consumers can release', () => {
  const plan = [row('nav'), row('app')];
  const packages = new Map([['nav', { pj: {} }], ['app', { pj: { dependencies: { nav: '0.1.1' } } }]]);
  assert.equal(deferredPackages(plan, packages).size, 0);
});

test('release command reports bootstrap during check and publishes only the independent package', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, delimiter } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'homie-publish-plan-'));
  try {
    mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'bin'));
    for (const file of ['publish.mjs', 'publish-plan.mjs']) copyFileSync(new URL(file, import.meta.url), join(root, 'scripts', file));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['nav', 'studio'] }));
    for (const name of ['nav', 'studio']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'package.json'), JSON.stringify({ name: `@homie-rocks/${name}`, version: '0.1.0', license: 'Apache-2.0', files: ['dist'] }));
      for (const file of ['LICENSE', 'NOTICE']) writeFileSync(join(root, name, file), 'test');
    }
    writeFileSync(join(root, 'bin', 'npm'), `#!${process.execPath}\nconst a=process.argv.slice(2);if(a[0]==='view'){if(a[1]==='@homie-rocks/studio'){console.log('"0.0.1"');}else{console.error('E404');process.exitCode=1;}}else if(a[0]==='publish'){require('node:fs').appendFileSync('published',a[a.indexOf('--workspace')+1]+'\\n');}else{throw Error('Unexpected npm '+a);}\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: join(root, 'bin') + delimiter + process.env.PATH, GITHUB_ACTIONS: 'true' };
    const check = spawnSync(process.execPath, ['scripts/publish.mjs', '--check'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /DEFERRED\s+@homie-rocks\/nav: first publication by a maintainer required/);
    assert.match(check.stdout, /1 to publish, 0 already on npm, 1 deferred/);
    const release = spawnSync(process.execPath, ['scripts/publish.mjs'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(release.status, 0, release.stderr);
    assert.equal(readFileSync(join(root, 'published'), 'utf8'), 'studio\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
