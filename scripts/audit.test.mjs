/**
 * The leak audit (scripts/audit.mjs) against scratch repositories: it passes clean
 * content, fails every kind of leak it names, finds a leak in an old commit that a later
 * commit removed, checks remotes, and never prints a private term.
 *
 * People: anybody may author, commit and merge under their own name and address, a
 * maintainer whose name is a private term included; a commit message may carry the person
 * trailers (Signed-off-by, Co-authored-by and the rest) with any name and address. An
 * address or a private name in the prose of a message still fails, a private path still
 * fails in an identity, a message and a file, and a private name still fails in a file.
 *
 * Leaks are assembled from pieces at run time, so this file holds none of them, and every
 * private term here is a made-up stand-in.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditRepo, parseTerms, personTrailer, PERSON_TRAILERS, report } from './audit.mjs';

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
const places = (r) => fails(r).map((f) => `${f.check}:${f.where}`).sort();

/** An empty commit on a scratch repository, by `author` (and `committer`, when it is somebody else), with this message. */
function commitAs(r, author, message, committer = author) {
  const who = { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: committer.name, GIT_COMMITTER_EMAIL: committer.email };
  execFileSync('git', ['-C', r.dir, 'commit', '-q', '--allow-empty', '-m', message], { env: { ...process.env, ...who } });
}
const LAST = { history: 'HEAD~1..HEAD' };
const person = (name, local, host = 'example.org') => ({ name, email: J(local, '@', host), line: `${name} <${J(local, '@', host)}>` });
const ADA = person('Ada', 'ada');
/** GitHub's own committer, on a commit its merge button or its web editor makes. */
const WEB = person('GitHub', 'noreply', 'github.com');

/**
 * Stand-ins for the maintainers' private terms, never a real one: a maintainer's own name, a private folder (kits
 * stands in for it), and a private host.
 */
const OWNER_NAME = J('zq', 'xw', 'vy');
const OWNER = person(`${OWNER_NAME[0].toUpperCase()}${OWNER_NAME.slice(1)} Example`, OWNER_NAME);
const HOUSE_HOST = J('kits', '-box.', 'example.net');
const HOUSE_TERMS = () => parseTerms(JSON.stringify({ v: 1, terms: [
  { kind: 'name', re: OWNER_NAME, flags: 'i' },
  { kind: 'private folder', re: '(^|[\\s`\'"(/])(kits)/[A-Za-z0-9_.-]', flags: '' },
  { kind: 'house host', re: HOUSE_HOST.replace(/\./g, '\\.') },
] }));
const withTerms = (extra = {}) => ({ terms: HOUSE_TERMS(), termsGiven: true, ...extra });

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

test('private folder terms: MCP method names are protocol words, a path into the folder still fails', () => {
  // A private-folder term of the maintainers' shape, for folders that share their names with MCP's words.
  const terms = parseTerms(JSON.stringify({ v: 1, terms: [{ kind: 'private folder', re: '(^|[\\s`\'"(/])(tools|templates|kits)/[A-Za-z0-9_.-]', flags: '' }] }));
  const protocol = repo({ 'packages/a/server.mjs': "case 'tools/list': case 'tools/call': case 'resources/templates/list':\nsend({ method: 'notifications/tools/list_changed' });\n" });
  // (kits stands in for a private folder here, so this file never names a real one.)
  const leak = repo({ 'packages/a/README.md': 'Built with kits/export/x.mjs and kits/list.mjs.\n' });
  try {
    assert.deepEqual(checks(auditRepo(protocol.dir, { terms, termsGiven: true })), [], 'MCP method names pass');
    assert.deepEqual(checks(auditRepo(leak.dir, { terms, termsGiven: true })), ['private'], 'a path into the folder still fails');
  } finally { protocol.done(); leak.done(); }
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

test('history: --identity, commit messages and remotes', () => {
  const r = repo({ 'packages/a/README.md': '# a\n' }, { remote: `https://github.com/${J('some', 'one')}/private.git` });
  try {
    const who = { GIT_AUTHOR_NAME: 'Someone', GIT_AUTHOR_EMAIL: J('someone', '@', 'example.org'), GIT_COMMITTER_NAME: 'Someone', GIT_COMMITTER_EMAIL: J('someone', '@', 'example.org') };
    execFileSync('git', ['-C', r.dir, 'commit', '-q', '--allow-empty', '-m', `Fix it\n\nSee ${J('/Us', 'ers/someone/x')}`], { env: { ...process.env, ...who } });
    const out = auditRepo(r.dir, { history: '', identity: 'Homie' });
    const where = fails(out).map((f) => `${f.check}:${f.where}`);
    assert.ok(where.includes('git:identity'));
    assert.ok(where.includes('paths:message:3'));
    assert.ok(where.includes('git:remote origin'));
    // --identity is for an export made under one name: there a trailer's address fails as any other does.
    commitAs(r, { name: 'Homie', email: '' }, `Fix it\n\nSigned-off-by: ${ADA.line}`);
    assert.deepEqual(places(auditRepo(r.dir, { ...LAST, identity: 'Homie' })).filter((p) => !p.startsWith('git:remote')), ['email:message:3']);
    assert.deepEqual(places(auditRepo(r.dir, LAST)).filter((p) => !p.startsWith('git:remote')), [], 'and without --identity it is the person\'s own');
  } finally { r.done(); }
});

test('a contributor authors and commits under their own name and address, and signs off', () => {
  const r = repo({ 'packages/a/README.md': '# a\n' });
  try {
    commitAs(r, ADA, `Fix a typo\n\nSigned-off-by: ${ADA.line}`);
    const out = auditRepo(r.dir, withTerms(LAST));
    assert.deepEqual(fails(out), []);
    assert.deepEqual(out.findings.filter((f) => f.where === 'message:3').map((f) => `${f.level} ${f.check}`), ['info email'], 'the sign-off is an INFO row');
    assert.match(report(out, LAST).text, /info message:3: a Signed-off-by trailer, the person's own \(ad\*+\)/);
    // The same commit with no private terms at all (a pull request from a fork): still clean.
    assert.deepEqual(fails(auditRepo(r.dir, LAST)), []);
  } finally { r.done(); }
});

test('a maintainer whose own name is a private term authors, commits, signs off and merges', () => {
  const r = repo({ 'packages/a/README.md': '# a\n' });
  try {
    // Their own commit, pushed.
    commitAs(r, OWNER, `Fix the build\n\nSigned-off-by: ${OWNER.line}`);
    assert.deepEqual(fails(auditRepo(r.dir, withTerms(LAST))), [], 'author and committer');
    // GitHub's merge button, pressed by them: a merge commit by them, committed by GitHub, signed off for them.
    commitAs(r, OWNER, `Merge pull request #12 from someone/fix-a-typo\n\nFix a typo\n\nSigned-off-by: ${OWNER.line}`, WEB);
    assert.deepEqual(fails(auditRepo(r.dir, withTerms(LAST))), [], 'a merge commit');
    // A squash merge: the contributor is the author, GitHub commits, and the message is every commit's message
    // with the co-authors under it and the maintainer's sign-off last.
    const squash = ['Fix two typos (#12)', '', '* Fix a typo', '', `Signed-off-by: ${ADA.line}`, '', '* Fix another', '', `Signed-off-by: ${ADA.line}`, '', '---------', '',
      `Co-authored-by: ${person('Bo', 'bo').line}`, `Signed-off-by: ${OWNER.line}`].join('\n');
    commitAs(r, ADA, squash, WEB);
    const out = auditRepo(r.dir, withTerms(LAST));
    assert.deepEqual(fails(out), [], 'a squash merge');
    assert.equal(out.findings.filter((f) => f.level === 'info' && f.check === 'email').length, 4, 'each trailer is an INFO row');
    // Rebase and merge: the contributor's commit, committed by the maintainer.
    commitAs(r, ADA, `Fix a typo\n\nSigned-off-by: ${ADA.line}`, OWNER);
    assert.deepEqual(fails(auditRepo(r.dir, withTerms(LAST))), [], 'a rebase merge');
    // The whole history, as CI audits a push: clean, and the report never prints the name.
    const all = auditRepo(r.dir, withTerms({ history: '' }));
    assert.deepEqual(fails(all), []);
    assert.ok(!report(all, { history: '' }).text.toLowerCase().includes(OWNER_NAME));
  } finally { r.done(); }
});

test('a revert passes: its message names a commit of this repository; any other commit id still fails', () => {
  const r = repo({ 'packages/a/README.md': '# a\n' });
  try {
    const undone = r.commit({ 'packages/a/notes.md': 'A note.\n' }, 'Add a note');
    // GitHub's Revert button: the maintainer is the author, GitHub commits, and the sign-off is theirs.
    commitAs(r, OWNER, `Revert "Add a note"\n\nThis reverts ${J('com', 'mit ')}${undone}.\n\nSigned-off-by: ${OWNER.line}`, WEB);
    const out = auditRepo(r.dir, withTerms(LAST));
    assert.deepEqual(fails(out), []);
    assert.ok(out.findings.some((f) => f.level === 'info' && f.where === 'message:3' && / a commit of this repository$/.test(f.what)));
    // An id this repository does not have is some other repository's, and so is any id in a file.
    commitAs(r, ADA, `Port the fix\n\nFrom ${J('com', 'mit ')}${'0123456789abcdef'.repeat(2).slice(0, 12)}.\n\nSigned-off-by: ${ADA.line}`);
    assert.deepEqual(places(auditRepo(r.dir, withTerms(LAST))), ['paths:message:3']);
    r.commit({ 'packages/a/notes.md': `Undone by ${J('com', 'mit ')}${undone}.\n` });
    assert.deepEqual(places(auditRepo(r.dir, withTerms())), ['paths:packages/a/notes.md:1']);
  } finally { r.done(); }
});

test('a Co-authored-by trailer passes with any name and address, and so does every other person trailer', () => {
  const r = repo({ 'packages/a/README.md': '# a\n' });
  try {
    const ai = person('Some Model 4.5', 'noreply', 'example.com');
    // An AI tool's co-author line (in its own letter case), GitHub's, and one that names a maintainer.
    commitAs(r, ADA, ['Draw the road', '', `Co-Authored-By: ${ai.line}`, `Co-authored-by: ${OWNER.line}`, `Co-authored-by: ${person('Copilot', '175728472+Copilot', 'users.noreply.github.com').line}`, `Signed-off-by: ${ADA.line}`].join('\n'));
    const out = auditRepo(r.dir, withTerms(LAST));
    assert.deepEqual(fails(out), []);
    assert.equal(out.findings.filter((f) => f.level === 'info' && /^a Co-authored-by trailer/.test(f.what)).length, 3);
    // Every person trailer, with a name that is also a build-process word (a person may be called that).
    assert.deepEqual(PERSON_TRAILERS, ['Signed-off-by', 'Co-authored-by', 'Reviewed-by', 'Acked-by', 'Tested-by', 'Reported-by', 'Helped-by']);
    const lane = person(J('La', 'ne'), 'penny');
    commitAs(r, ADA, ['Draw the road', '', ...PERSON_TRAILERS.map((k) => `${k}: ${lane.line}`)].join('\n'));
    assert.deepEqual(fails(auditRepo(r.dir, withTerms(LAST))), []);
    assert.equal(personTrailer(`  reviewed-BY:  ${ADA.line}  `), 'Reviewed-by', 'any letter case, alone on its line');
  } finally { r.done(); }
});

test('an address or a private name in the prose of a commit message still fails, and prose after a trailer key is prose', () => {
  const r = repo({ 'packages/a/README.md': '# a\n' });
  try {
    const bo = person('Bo', 'bo');
    commitAs(r, ADA, ['Fix a typo', '',
      `Thanks to ${ADA.email} for the report.`, //                3: an address in the body
      `${OWNER_NAME} asked for this.`, //                          4: a private name in the body
      `Reported-by: ${ADA.line} and ${bo.line}`, //                5: two people on one line is prose
      `Reported-by: ${ADA.line}, who wrote to ${OWNER_NAME}`, //   6: words after the address
      `Signed-off-by: ${OWNER.name}`, //                           7: no address: not a trailer
      `Cc: ${bo.line}`, //                                         8: not a person trailer
      `See Signed-off-by: ${bo.line}`, //                          9: the key does not start the line
      `Signed-off-by: ${ADA.line}`].join('\n'));
    assert.deepEqual(places(auditRepo(r.dir, withTerms(LAST))), ['email:message:3', 'email:message:5', 'email:message:5', 'email:message:6', 'email:message:8', 'email:message:9',
      'private:message:4', 'private:message:6', 'private:message:7']);
    // Without the private terms (a fork's pull request) the addresses still fail.
    assert.deepEqual(places(auditRepo(r.dir, LAST)), ['email:message:3', 'email:message:5', 'email:message:5', 'email:message:6', 'email:message:8', 'email:message:9']);
    // A build-process word in the prose still fails too; only a person's name on their own trailer may be one.
    commitAs(r, ADA, `Fix the ${J('la', 'ne')}\n\nSigned-off-by: ${ADA.line}`);
    assert.deepEqual(places(auditRepo(r.dir, withTerms(LAST))), ['process:message:1']);
  } finally { r.done(); }
});

test('a private path still fails in a commit\'s identity, in its message and in a file, and a private host in an address', () => {
  const path = J('kits', '/export/x.mjs');
  const r = repo({ 'packages/a/README.md': `Built with ${path}.\n` });
  try {
    assert.deepEqual(places(auditRepo(r.dir, withTerms())), ['private:packages/a/README.md:1'], 'in a file');
    r.commit({ 'packages/a/README.md': '# a\n' });
    // In the identity: as an author's name, and as a committer's address at a private host.
    commitAs(r, { name: `Builder ${path}`, email: ADA.email }, `Fix a typo\n\nSigned-off-by: ${ADA.line}`, ADA);
    assert.deepEqual(places(auditRepo(r.dir, withTerms(LAST))), ['private:identity']);
    commitAs(r, ADA, `Fix a typo\n\nSigned-off-by: ${ADA.line}`, person('Builder', 'builder', HOUSE_HOST));
    const host = auditRepo(r.dir, withTerms(LAST));
    assert.deepEqual(places(host), ['private:identity']);
    assert.match(report(host, LAST).text, /FAIL identity: private term #3 \(house host\)/);
    // In the message: in its prose, and on a trailer (a trailer's line is checked for everything but its person).
    commitAs(r, ADA, ['Fix a typo', '', `Built with ${path}.`, `See ${J('/Us', 'ers/someone/x')}.`, '', `Co-authored-by: ${path} <${ADA.email}>`, `Co-authored-by: ${person('Builder', 'builder', HOUSE_HOST).line}`, `Signed-off-by: ${ADA.line}`].join('\n'));
    assert.deepEqual(places(auditRepo(r.dir, withTerms(LAST))), ['paths:message:4', 'private:message:3', 'private:message:6', 'private:message:7']);
  } finally { r.done(); }
});

test('a maintainer\'s own name still fails in a file, while the same name authors the commit that is audited', () => {
  const r = repo({ 'packages/a/README.md': '# a\n' });
  try {
    r.commit({ 'packages/a/AUTHORS.md': `Made by ${OWNER.name}.\n`, 'packages/a/package.json': `{ "author": "${OWNER.line}" }\n` });
    commitAs(r, OWNER, `Add the authors\n\nSigned-off-by: ${OWNER.line}`);
    const out = auditRepo(r.dir, withTerms(LAST));
    assert.deepEqual(places(out), ['email:packages/a/package.json:1', 'private:packages/a/AUTHORS.md:1', 'private:packages/a/package.json:1'], 'the files fail; the identity and the sign-off do not');
    const text = report(out, LAST).text;
    assert.match(text, /FAIL packages\/a\/AUTHORS\.md:1: private term #1 \(name\)/);
    assert.ok(!text.toLowerCase().includes(OWNER_NAME), 'the name is never printed');
  } finally { r.done(); }
});

test('a private term is a person when it says so, or when it says nothing and its kind is name', () => {
  const terms = (list) => parseTerms(JSON.stringify({ v: 1, terms: list }));
  assert.deepEqual(terms([{ kind: 'name', re: 'a' }, { kind: 'private folder', re: 'b' }, { kind: 'friend', re: 'c', person: true }, { kind: 'name', re: 'd', person: false }, { re: 'e' }]).map((t) => t.person), [true, false, true, false, false]);
  const r = repo({ 'packages/a/README.md': '# a\n' });
  try {
    commitAs(r, OWNER, `Fix the build\n\nSigned-off-by: ${OWNER.line}`);
    const audit = (term) => places(auditRepo(r.dir, { ...LAST, terms: terms([{ re: OWNER_NAME, ...term }]), termsGiven: true }));
    assert.deepEqual(audit({ kind: 'friend', person: true }), [], 'a person under another kind');
    assert.deepEqual(audit({ kind: 'name', person: false }), ['private:identity', 'private:message:3'], 'a name that says it is not a person');
    assert.deepEqual(audit({ kind: 'internal name' }), ['private:identity', 'private:message:3'], 'any other kind');
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
