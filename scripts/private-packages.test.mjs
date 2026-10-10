import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const read = f => JSON.parse(readFileSync(new URL(f, root), 'utf8'));
const packages = read('package.json').workspaces.map(dir => ({ dir, pj: read(`${dir}/package.json`) }));
const privateNames = new Set(packages.filter(p => p.pj.private).map(p => p.pj.name));
test('public packages cannot depend on a workspace awaiting first publication', () => {
  for (const { pj } of packages.filter(p => !p.pj.private)) {
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const name of Object.keys(pj[field] ?? {})) assert.ok(!privateNames.has(name), `${pj.name} ${field} must not require unpublished ${name}`);
    }
  }
});
test('the actual CI publisher releases studio without looking up or publishing private workspaces', () => {
  const dir = mkdtempSync(join(tmpdir(), 'homie-private-release-'));
  try {
    mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'bin'));
    copyFileSync(new URL('publish.mjs', import.meta.url), join(dir, 'scripts/publish.mjs'));
    const deferred = packages.filter(p => p.pj.private);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['studio', ...deferred.map((_, i) => `private${i}`)] }));
    const studio = { name: '@homie-rocks/studio', version: '99.0.0', license: 'Apache-2.0', files: ['dist'] };
    for (const [folder, pj] of [['studio', studio], ...deferred.map((p, i) => [`private${i}`, p.pj])]) {
      mkdirSync(join(dir, folder)); writeFileSync(join(dir, folder, 'package.json'), JSON.stringify(pj));
      for (const file of ['LICENSE', 'NOTICE']) writeFileSync(join(dir, folder, file), 'fixture');
    }
    writeFileSync(join(dir, 'bin/npm'), `#!${process.execPath}\nconst a=process.argv.slice(2), fs=require('node:fs');fs.appendFileSync('calls',JSON.stringify(a)+'\\n');if(a[0]==='view'){if(a[1]==='@homie-rocks/studio')console.log('"98.0.0"');else{console.error('E404');process.exitCode=1;}}else if(a[0]==='publish'){fs.appendFileSync('published',a[a.indexOf('--workspace')+1]+'\\n');}else throw Error('Unexpected npm '+a);\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: join(dir, 'bin') + delimiter + process.env.PATH, GITHUB_ACTIONS: 'true' };
    const result = spawnSync(process.execPath, ['scripts/publish.mjs'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(readFileSync(join(dir, 'published'), 'utf8'), 'studio\n');
    const calls = readFileSync(join(dir, 'calls'), 'utf8');
    for (const name of privateNames) assert.ok(!calls.includes(name), `${name} must never reach npm`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
