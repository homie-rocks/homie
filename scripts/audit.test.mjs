/**
 * The leak audit (scripts/audit.mjs) against scratch repositories: it passes clean
 * content, fails every kind of leak it names, finds a leak in an old commit that a later
 * commit removed, checks commit identity and remotes, and never prints a private term.
 * Leaks are assembled from pieces at run time, so this file holds none of them.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditRepo, parseTerms, report } from './audit.mjs';

const AUDIT = join(dirname(fileURLToPath(import.meta.url)), 'audit.mjs');
const J = (...parts) => parts.join('');
const IDENT = { GIT_AUTHOR_NAME: 'Homie', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: 'Homie', GIT_COMMITTER_EMAIL: '' };

function repo(files, { remote = 'https://github.com/homie-rocks/homie.git' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-test-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, ...IDENT } });
  git('init', '-q', '-b', 'main');
  if (remote) git('remote', 'add', 'origin', remote);
  const commit = (fs, msg = 'A change') => {
    for (const [p, text] of Object.entries(fs)) {
      if (text === null) { rmSync(join(dir, p)); continue; }
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), text);
    }
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', msg);
    return git('rev-parse', 'HEAD').trim();
  };
  commit(files);
  return { dir, git, commit, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const fails = (r) => r.findings.filter((f) => f.level === 'fail');
const checks = (r) => [...new Set(fails(r).map((f) => f.check))].sort();

test('clean content passes; the security contact and a made-up test host are INFO', () => {
  const r = repo({ 'packages/a/README.md': '# a\nReport problems to security@homie.rocks.\n', 'packages/a/test/x.mjs': "const host = 'test-studio.acct.workers.dev';\n" });
  try {
    const out = auditRepo(r.dir);
    assert.deepEqual(fails(out), []);
    assert.ok(report(out, { history: null }).clean);
  } finally { r.done(); }
});

test('every built-in kind of leak fails', () => {
  const r = repo({
    'packages/a/src/home.ts': `const p = '${J('/Us', 'ers/someone/x')}';\n`,
    'packages/a/src/mail.ts': `// ${J('someone', '@', 'example.org')}\n`,
    'packages/a/src/key.ts': `const k = '${J('AKIA', 'ABCDEFGHIJKLMNOP')}';\n`,
    'packages/a/src/scope.ts': `import x from '${J('@homie', '/render/x.js')}';\n`,
    'packages/a/src/other.ts': `// see ${J('packages/', 'secretpkg/src/x.ts')}\n`,
    'packages/a/src/words.ts': `// the ${J('la', 'ne')} that built this\n`,
    'packages/a/src/todo.ts': `// ${J('TO', 'DO')}: later\n`,
    'packages/a/.env': 'X=1\n',
  });
  try {
    const out = auditRepo(r.dir);
    assert.deepEqual(checks(out), ['email', 'files', 'paths', 'placeholders', 'process', 'scope', 'secrets']);
  } finally { r.done(); }
});

test('private terms: a hit names the number and kind, and the report never prints the term', () => {
  const secret = J('zq', 'xw', 'vy');
  const r = repo({ 'packages/a/README.md': `Made by ${secret} at home.\n` });
  try {
    const terms = parseTerms(JSON.stringify({ v: 1, terms: [{ kind: 'name', re: secret, flags: 'i' }] }));
    const out = auditRepo(r.dir, { terms, termsGiven: true });
    assert.deepEqual(checks(out), ['private']);
    const text = report(out, { history: null }).text;
    assert.match(text, /private term #1 \(name\)/);
    assert.ok(!text.toLowerCase().includes(secret), 'the term is never printed');
    const cli = spawnSync(process.execPath, [AUDIT, '--repo', r.dir, '--terms', '-'], { input: JSON.stringify({ v: 1, terms: [{ kind: 'name', re: secret }] }), encoding: 'utf8' });
    assert.equal(cli.status, 1);
    assert.ok(!cli.stdout.toLowerCase().includes(secret) && !cli.stderr.toLowerCase().includes(secret));
  } finally { r.done(); }
});

test('a finding that quotes its line masks home folders, addresses and private terms in it', () => {
  const secret = J('zq', 'xw', 'vy');
  const r = repo({ 'packages/a/src/x.ts': `// ${J('TO', 'DO')} ask ${secret} at ${J('/Us', 'ers/', secret, '/x')} or ${J('ada', '@', 'example.org')}\n` });
  try {
    const terms = parseTerms(JSON.stringify({ v: 1, terms: [{ kind: 'name', re: secret }] }));
    const text = report(auditRepo(r.dir, { terms, termsGiven: true }), { history: null }).text;
    assert.ok(!text.toLowerCase().includes(secret));
    assert.ok(!text.includes(J('ada', '@')));
  } finally { r.done(); }
});

test('history: a leak an old commit added and a later one removed is still found, with its commit', () => {
  const r = repo({ 'packages/a/README.md': '# a\n' });
  try {
    const bad = r.commit({ 'packages/a/notes.md': `${J('/Us', 'ers/someone/x')}\n` });
    r.commit({ 'packages/a/notes.md': null });
    assert.deepEqual(fails(auditRepo(r.dir)), [], 'the tree at HEAD is clean');
    const out = auditRepo(r.dir, { history: '' });
    assert.deepEqual([...out.failedCommits], [bad]);
  } finally { r.done(); }
});

test('history: identity, commit messages and remotes', () => {
  const r = repo({ 'packages/a/README.md': '# a\n' }, { remote: `https://github.com/${J('some', 'one')}/private.git` });
  try {
    const who = { GIT_AUTHOR_NAME: 'Someone', GIT_AUTHOR_EMAIL: J('someone', '@', 'example.org'), GIT_COMMITTER_NAME: 'Someone', GIT_COMMITTER_EMAIL: J('someone', '@', 'example.org') };
    execFileSync('git', ['-C', r.dir, 'commit', '-q', '--allow-empty', '-m', `Fix it\n\nSee ${J('/Us', 'ers/someone/x')}`], { env: { ...process.env, ...who } });
    const out = auditRepo(r.dir, { history: '', identity: 'Homie' });
    const where = fails(out).map((f) => `${f.check}:${f.where}`);
    assert.ok(where.includes('git:identity'));
    assert.ok(where.includes('paths:message:3'));
    assert.ok(where.includes('git:remote origin'));
  } finally { r.done(); }
});

test("a contributor's sign-off may carry their address; without --identity nobody has to be Homie", () => {
  const r = repo({ 'packages/a/README.md': '# a\n' });
  try {
    const addr = J('ada', '@', 'example.org');
    const who = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: addr, GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: addr };
    execFileSync('git', ['-C', r.dir, 'commit', '-q', '--allow-empty', '-m', `Fix a typo\n\nSigned-off-by: Ada <${addr}>`], { env: { ...process.env, ...who } });
    assert.deepEqual(fails(auditRepo(r.dir, { history: 'HEAD~1..HEAD' })), []);
  } finally { r.done(); }
});

test('--working-tree reads what the next commit would hold, new files included', () => {
  const r = repo({ 'packages/a/README.md': '# a\n' });
  try {
    writeFileSync(join(r.dir, 'packages/a/new.md'), `${J('/Us', 'ers/someone/x')}\n`);
    assert.deepEqual(fails(auditRepo(r.dir)), []);
    assert.deepEqual(checks(auditRepo(r.dir, { workingTree: true })), ['paths']);
  } finally { r.done(); }
});

test('--require-terms fails when no private terms were given', () => {
  const r = repo({ 'packages/a/README.md': '# a\n' });
  try {
    const cli = spawnSync(process.execPath, [AUDIT, '--repo', r.dir, '--require-terms'], { encoding: 'utf8', env: { ...process.env, HOMIE_AUDIT_TERMS: '' } });
    assert.equal(cli.status, 1);
    assert.match(cli.stdout, /NOT GIVEN/);
  } finally { r.done(); }
});
