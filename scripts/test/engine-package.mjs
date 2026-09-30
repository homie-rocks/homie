/**
 * The contract every engine package keeps, run by each package's own test
 * (packages/<name>/test/package.test.mjs) after `npm run build`:
 *
 *   - it is @homie-rocks/<folder>, Apache-2.0, ESM, with this repository's LICENSE and NOTICE;
 *   - its exports map is `./<Module>.js` -> dist (types beside it), and its npm files are
 *     dist, src, README.md, LICENSE and NOTICE;
 *   - every src module was built, and loads in Node through the package's own name, the
 *     way a game imports it; a module with no runtime exports declares only types;
 *   - every package its source imports is declared (dependencies or peerDependencies),
 *     every @homie-rocks dependency is pinned to the exact version in this repository,
 *     and tsconfig.json references each one, so `tsc --build` builds them first.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));
const jsonc = (p) => ts.parseConfigFileTextToJson(p, read(p)).config;

/** Every .ts file under a folder, as paths relative to it. */
function tsFiles(dir, rel = '') {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...tsFiles(dir, path));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(path);
  }
  return out.sort();
}

/** The package a bare specifier names (`@scope/name/sub.js` -> `@scope/name`), or null for a relative or node: one. */
function packageOf(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || builtinModules.includes(spec.split('/')[0])) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The workspace versions of every @homie-rocks package in this repository. */
function workspaceVersions() {
  const versions = new Map();
  for (const dir of json(join(ROOT, 'package.json')).workspaces) {
    const pj = json(join(ROOT, dir, 'package.json'));
    versions.set(pj.name, pj.version);
  }
  return versions;
}

/** Does a .d.ts declare only types (nothing that exists at run time)? */
function typeOnly(dts) {
  const sf = ts.createSourceFile('x.d.ts', dts, ts.ScriptTarget.ES2022, false, ts.ScriptKind.TS);
  return sf.statements.every((s) => ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)
    || ts.isImportDeclaration(s) || (ts.isExportDeclaration(s) && (s.isTypeOnly || !s.exportClause || (ts.isNamedExports(s.exportClause) && s.exportClause.elements.length === 0))));
}

export function testEnginePackage(packageUrl) {
  const dir = fileURLToPath(packageUrl);
  const folder = basename(dir.replace(/\/$/, ''));
  const pj = json(join(dir, 'package.json'));
  const name = `@homie-rocks/${folder}`;
  const src = tsFiles(join(dir, 'src'));

  test(`${name}: name, licence, module type, exports map and npm files`, () => {
    assert.equal(pj.name, name);
    assert.equal(pj.license, 'Apache-2.0');
    assert.equal(pj.type, 'module');
    assert.match(pj.version, /^\d+\.\d+\.\d+$/);
    assert.equal(pj.private, undefined, 'an engine package is published');
    assert.deepEqual(pj.exports, { './package.json': './package.json', './*.js': { types: './dist/*.d.ts', default: './dist/*.js' } });
    assert.deepEqual(pj.files, ['dist', 'src/**/*.ts', 'README.md', 'LICENSE', 'NOTICE']);
    assert.equal(pj.repository?.url, 'git+https://github.com/homie-rocks/homie.git');
    assert.equal(pj.repository?.directory, `packages/${folder}`);
    assert.equal(read(join(dir, 'LICENSE')), read(join(ROOT, 'LICENSE')), 'LICENSE is the repository\'s Apache-2.0 text');
    assert.equal(read(join(dir, 'NOTICE')), read(join(ROOT, 'NOTICE')), 'NOTICE is the repository\'s');
    const readme = read(join(dir, 'README.md'));
    assert.ok(readme.includes(name), 'README.md names the package');
    assert.ok(src.length > 0, 'src/ has modules');
  });

  test(`${name}: every src module is built, and loads in Node by the package's own name`, async () => {
    const dist = join(dir, 'dist');
    assert.ok(existsSync(dist), 'dist/ exists: run `npm run build` first (npm test does)');
    let loaded = 0;
    for (const file of src) {
      const mod = file.replace(/\.ts$/, '');
      const js = join(dist, `${mod}.js`);
      const dts = join(dist, `${mod}.d.ts`);
      assert.ok(existsSync(js), `dist/${mod}.js was built from src/${file}`);
      assert.ok(existsSync(dts), `dist/${mod}.d.ts was built from src/${file}`);
      assert.ok(statSync(js).mtimeMs >= statSync(join(dir, 'src', file)).mtimeMs - 1000, `dist/${mod}.js is older than src/${file}: rebuild`);
      const exports = await import(`${name}/${mod}.js`);
      if (Object.keys(exports).length === 0) assert.ok(typeOnly(read(dts)), `${name}/${mod}.js has no runtime exports, so its .d.ts must declare only types`);
      loaded++;
    }
    assert.equal(loaded, src.length);
  });

  test(`${name}: every import is declared, internal pins are exact, and tsconfig references them`, () => {
    const versions = workspaceVersions();
    const declared = { ...pj.peerDependencies, ...pj.dependencies };
    const missing = new Set();
    const used = new Set();
    for (const file of src) {
      const text = read(join(dir, 'src', file));
      for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
        const pkg = packageOf(fileName);
        if (!pkg || pkg === name) continue;
        used.add(pkg);
        if (!(pkg in declared)) missing.add(`${pkg} (src/${file})`);
      }
    }
    assert.deepEqual([...missing], [], 'imported but not in dependencies or peerDependencies');
    const refs = new Set((jsonc(join(dir, 'tsconfig.json')).references ?? []).map((r) => `@homie-rocks/${basename(r.path)}`));
    for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
      for (const [dep, spec] of Object.entries(pj[field] ?? {})) {
        assert.ok(!dep.startsWith('@homie/'), `${field} names ${dep}: the scope is @homie-rocks`);
        if (!dep.startsWith('@homie-rocks/')) continue;
        assert.ok(versions.has(dep), `${field} names ${dep}, which is not in this repository`);
        assert.equal(spec, versions.get(dep), `${field} ${dep} is pinned exactly to this repository's version`);
        if (field !== 'devDependencies' || used.has(dep)) assert.ok(refs.has(dep), `tsconfig.json references ../${dep.split('/')[1]} (${field})`);
      }
    }
    for (const dep of used) if (dep.startsWith('@homie-rocks/')) assert.ok(dep in (pj.dependencies ?? {}), `${dep} is imported, so it is a dependency (not only a peer)`);
  });
}

export const repositoryRoot = ROOT;
export const relativeToRoot = (p) => relative(ROOT, p);
