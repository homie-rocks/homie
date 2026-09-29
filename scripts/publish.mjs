#!/usr/bin/env node
/**
 * Publish this repository's packages to npm: every workspace whose version is not on
 * the registry yet, in dependency order. This is what .github/workflows/publish.yml
 * runs on a release; it publishes with trusted publishing (OIDC, no token) and
 * provenance.
 *
 *   node scripts/publish.mjs --check      verify, and print what a release would publish (reads npm)
 *   node scripts/publish.mjs --dry-run    npm publish --dry-run for each package that would go out
 *   node scripts/publish.mjs              publish (GitHub Actions only)
 *
 * The rules it checks before anything goes out (a failure publishes nothing):
 *   - every package is public, Apache-2.0, has `files`, and its folder has LICENSE and NOTICE;
 *   - no dependency names a Homie package under another scope;
 *   - every @homie-rocks dependency is an EXACT version (x.y.z), and it is the version of
 *     that package in this repository, so one commit always names one consistent set;
 *   - in GitHub Actions, every package already exists on npm. Trusted publishing can only
 *     publish a new VERSION: npm lets a package name a trusted publisher only once the
 *     package exists. A brand-new package is published once by a maintainer, who then
 *     registers this workflow as its trusted publisher; from then on it releases here.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const DRY = args.includes('--dry-run');
const EXACT = /^\d+\.\d+\.\d+$/;
const inCI = process.env.GITHUB_ACTIONS === 'true';

const fail = (msg) => { process.stderr.write(`publish: ${msg}\n`); process.exit(1); };
const npm = (argv, opts = {}) => spawnSync('npm', argv, { cwd: ROOT, encoding: 'utf8', ...opts });

// 1. The packages, and the rules.
const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const pkgs = new Map();
for (const dir of root.workspaces) {
  const pj = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
  if (!pj.private) pkgs.set(pj.name, { dir, pj });
}
const errors = [];
for (const [name, { dir, pj }] of pkgs) {
  if (!name.startsWith('@homie-rocks/')) errors.push(`${dir}: ${name} is not in the @homie-rocks scope`);
  if (pj.license !== 'Apache-2.0') errors.push(`${name}: license is ${pj.license}, not Apache-2.0`);
  if (!Array.isArray(pj.files) || !pj.files.length) errors.push(`${name}: no files allowlist`);
  for (const f of ['LICENSE', 'NOTICE']) if (!existsSync(join(ROOT, dir, f))) errors.push(`${name}: ${dir}/${f} is missing`);
  if (!EXACT.test(pj.version)) errors.push(`${name}: version ${pj.version} is not x.y.z`);
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [dep, spec] of Object.entries(pj[field] ?? {})) {
      if (/^@homie\//.test(dep)) errors.push(`${name}: ${field} names ${dep}, a scope this repository does not publish`);
      if (!dep.startsWith('@homie-rocks/')) continue;
      if (!pkgs.has(dep)) errors.push(`${name}: ${field} names ${dep}, which is not in this repository`);
      else if (spec !== pkgs.get(dep).pj.version) errors.push(`${name}: ${field} ${dep}@${spec} must be exactly ${pkgs.get(dep).pj.version}`);
    }
  }
}
if (errors.length) fail(`nothing was published:\n  ${errors.join('\n  ')}`);

// 2. Dependency order.
const order = [];
const seen = new Set();
const visit = (name, stack = []) => {
  if (seen.has(name)) return;
  if (stack.includes(name)) fail(`dependency cycle: ${[...stack, name].join(' -> ')}`);
  for (const dep of Object.keys(pkgs.get(name).pj.dependencies ?? {})) if (pkgs.has(dep)) visit(dep, [...stack, name]);
  seen.add(name);
  order.push(name);
};
for (const name of [...pkgs.keys()].sort()) visit(name);

// 3. What the registry already has.
const onNpm = (spec) => {
  const r = npm(['view', spec, 'version', '--json', '--prefer-online']);
  if (r.status === 0) return true;
  if (/E404|404 Not Found|is not in this registry/.test(r.stderr + r.stdout)) return false;
  return fail(`npm view ${spec} failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
};
const plan = order.map((name) => {
  const { dir, pj } = pkgs.get(name);
  const exists = onNpm(name);
  return { name, dir, version: pj.version, exists, published: exists && onNpm(`${name}@${pj.version}`) };
});
for (const p of plan) process.stdout.write(`${p.published ? 'on npm     ' : p.exists ? 'NEW VERSION' : 'NEW PACKAGE'} ${p.name}@${p.version}\n`);
const todo = plan.filter((p) => !p.published);
process.stdout.write(`${todo.length} to publish, ${plan.length - todo.length} already on npm\n`);
if (CHECK) process.exit(0);

// 4. Publish.
if (!inCI && !DRY) fail('releases are published by .github/workflows/publish.yml. Locally, use --check or --dry-run.');
const brandNew = todo.filter((p) => !p.exists);
if (inCI && !DRY && brandNew.length) {
  fail(`nothing was published: ${brandNew.map((p) => p.name).join(', ')} ${brandNew.length === 1 ? 'is' : 'are'} not on npm yet. `
    + 'Trusted publishing can only add versions to a package that exists: a maintainer publishes its first version once, '
    + 'then registers this workflow as its trusted publisher (repository homie-rocks/homie, workflow publish.yml, environment npm).');
}
for (const p of todo) {
  const argv = ['publish', '--workspace', p.dir, '--access', 'public'];
  if (inCI) argv.push('--provenance');
  if (DRY) argv.push('--dry-run');
  process.stdout.write(`\n$ npm ${argv.join(' ')}\n`);
  const r = npm(argv, { stdio: 'inherit' });
  if (r.status !== 0) fail(`${p.name}@${p.version} did not publish; the packages before it did. Run the release again: published versions are skipped.`);
}
