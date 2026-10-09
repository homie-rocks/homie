#!/usr/bin/env node
// Bootstrap a private workspace from clean, merged main without changing the checkout.
// npm login (with a maintainer account) is required; npm's 2FA prompts stay on the terminal.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(readFileSync(join(root, p), 'utf8'));
const run = (bin, args, capture = false) => {
  const r = spawnSync(bin, args, { cwd: root, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed${capture ? ': ' + r.stderr : ''}`);
  return r.stdout?.trim();
};
const folder = process.argv[2];
if (!folder || !/^[a-z-]+$/.test(folder)) throw new Error('usage: node scripts/first-publish-private.mjs <workspace folder>');
const dir = `packages/${folder}`;
if (!read('package.json').workspaces.includes(dir)) throw new Error('Not a workspace');
const pj = read(`${dir}/package.json`);
if (pj.private !== true) throw new Error('Use scripts/first-publish.sh for public packages');
if (run('git', ['status', '--porcelain'], true)) throw new Error('Use a clean checkout of merged main');
run('git', ['fetch', 'origin', 'main', '--tags']);
if (run('git', ['rev-parse', 'HEAD'], true) !== run('git', ['rev-parse', 'origin/main'], true)) throw new Error('Use merged origin/main');
run('git', ['clean', '-q', '-f', '-d', '-X', '--', 'packages']);
run('npm', ['ci']);
run('npm', ['run', 'build']);
const scratch = mkdtempSync(join(tmpdir(), 'homie-first-publish-'));
try {
  const packed = JSON.parse(run('npm', ['pack', '--workspace', dir, '--pack-destination', scratch, '--json'], true));
  run('tar', ['-xzf', join(scratch, packed[0].filename), '-C', scratch]);
  const manifest = join(scratch, 'package', 'package.json');
  const publicPackage = JSON.parse(readFileSync(manifest, 'utf8'));
  delete publicPackage.private;
  writeFileSync(manifest, JSON.stringify(publicPackage, null, 2) + '\n');
  // The packed files are already built. Do not run workspace build scripts in the temporary tarball.
  const args = ['-y', 'npm@11', 'publish', join(scratch, 'package'), '--access', 'public', '--ignore-scripts'];
  run('npx', [...args, '--dry-run']);
  run('npx', args);
  run('npx', ['-y', 'npm@11', 'trust', 'github', pj.name, '--file', 'publish.yml', '--repo', 'homie-rocks/homie', '--env', 'npm', '--allow-publish', '--yes']);
  run('npx', ['-y', 'npm@11', 'access', 'set', 'mfa=publish', pj.name]);
  console.log(`Published ${pj.name}@${pj.version}. Remove private from ${dir}/package.json, regenerate package-lock.json, and review publish --check --strict before merging that follow-up.`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
