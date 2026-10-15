// Content-addressed setup shared by serial test processes within one CI shard.
// Only pristine fixture builds are reused; rebuilding/mutating an existing site
// always executes the CLI. Tests own copies, never the cached directory.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readlinkSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const owned = !process.env.HOMIE_TEST_FIXTURES;
const cache = process.env.HOMIE_TEST_FIXTURES || mkdtempSync(join(tmpdir(), 'homie-fixtures-'));
if (owned) after(() => rmSync(cache, { recursive: true, force: true }));
const ignored = new Set(['node_modules', '.git', '.studio', 'dist', 'test', 'test-results']);
function digest(dir, hash, relative = '', inputs = false) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    if (inputs ? join(relative, entry.name) === 'site/dist' : ignored.has(entry.name)) continue;
    const name = join(relative, entry.name), path = join(dir, entry.name);
    if (entry.isSymbolicLink()) hash.update(name).update(readlinkSync(path));
    else if (entry.isDirectory()) digest(path, hash, name, inputs);
    else hash.update(name).update(readFileSync(path));
  }
  return hash;
}
let sourceKey;
function version() {
  if (!sourceKey) {
    const hash = createHash('sha256').update(process.version).update(readFileSync(join(repo, 'package-lock.json')));
    // Templates plus every package implementation: cache reuse cannot hide a code change.
    digest(join(repo, 'packages'), hash);
    digest(join(repo, 'template'), hash);
    sourceKey = hash.digest('hex');
  }
  return sourceKey;
}
const copy = (from, to) => cpSync(from, to, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true,
  filter: path => !['node_modules', '.git'].includes(path.split('/').at(-1)) });
export function fixtureRun(cli, args, cwd, options = {}) {
  const execute = () => spawnSync(process.execPath, [cli, ...args, '--json'], { cwd, encoding: 'utf8', ...options });
  const isNew = args[0] === 'new' && args.includes('--no-install');
  const target = isNew ? resolve(cwd, args[1]) : cwd;
  const pristineBuild = args.length === 1 && args[0] === 'build' && !existsSync(join(cwd, 'site/dist'));
  // New/refusal tests and all subsequent builds exercise the real command.
  if ((!isNew && !pristineBuild) || (isNew && existsSync(target))) return execute();
  const hash = createHash('sha256').update(version()).update(readFileSync(cli)).update(JSON.stringify(options)).update(JSON.stringify(isNew ? [args[0], ...args.slice(2)] : args));
  if (!isNew) digest(cwd, hash, '', true);
  const key = join(cache, hash.digest('hex'));
  const resultFile = join(key, 'result.json');
  if (existsSync(resultFile)) {
    const { result, original, git } = JSON.parse(readFileSync(resultFile));
    copy(join(key, 'studio'), target);
    if (isNew && git) {
      const initialized = spawnSync('git', ['init', '-q', target], { encoding: 'utf8' });
      if (initialized.status !== 0) throw new Error(initialized.stderr);
    }
    return { ...result, stdout: result.stdout.replaceAll(original, target), stderr: result.stderr.replaceAll(original, target) };
  }
  const result = execute();
  if (result.status === 0) {
    mkdirSync(key, { recursive: true });
    copy(target, join(key, 'studio'));
    writeFileSync(resultFile, JSON.stringify({ original: target, git: isNew && existsSync(join(target, '.git')), result: { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr } }));
  }
  return result;
}
