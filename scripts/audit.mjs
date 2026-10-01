#!/usr/bin/env node
/**
 * The leak audit: nothing private goes into this public repository, in a file or in
 * a commit. CI runs it on every pull request; maintainers run it before they push.
 *
 *   node scripts/audit.mjs                     the tracked tree at HEAD
 *   node scripts/audit.mjs --ref <rev>         the tree at <rev>
 *   node scripts/audit.mjs --working-tree      what the next commit would hold: tracked and new files, from disk
 *   node scripts/audit.mjs --history [<range>] every commit in <range> (default: all of them):
 *                                              each commit's tree, author, committer and message
 *   options:
 *     --terms <file|->      the maintainers' private terms (JSON, see below); the environment
 *                           variable HOMIE_AUDIT_TERMS may hold the same JSON instead
 *     --require-terms       fail when no private terms were given (CI on this repository's
 *                           own branches, where the secret is available)
 *     --identity <name>     every audited commit is by <name>, with no email address (the
 *                           maintainers' own commits; a contributor's commit carries theirs)
 *     --report <file>       also write the report to a file
 *
 * It FAILS on, in any file or commit message:
 *   - home and machine paths (/Users/…, /home/…, C:\Users, /private/tmp, /var/folders)
 *     and home-relative paths (~/…);
 *   - email addresses, except the security contact (and, in a commit message, a
 *     contributor's own Signed-off-by line);
 *   - secret shapes: keys, tokens, JWTs, bearer values, 32-hex ids, UUIDs and workers.dev
 *     hosts (a test's made-up values are listed below);
 *   - the old npm scope @homie/ (the npm org "homie" is someone else's), a path to a
 *     package folder this repository does not have, a private commit id;
 *   - words of a private build process (lanes, benches, worktrees, critics, HQ), except
 *     where a file uses one in its ordinary sense (ALLOWED_WORDS);
 *   - a placeholder or TODO left in a file;
 *   - symlinks, submodules, binaries and secret-bearing files (.env, keys, .npmrc);
 *   - the maintainers' private terms: names, private projects and paths, internal tool
 *     and product names. They are never written in this repository: CI reads them from a
 *     repository secret, a maintainer pipes them in, and a finding names only the term's
 *     number and kind, never the term.
 * Words a reviewer should still see (TV as a device class, a game's camera) are INFO.
 *
 * Private terms JSON: { "v": 1, "terms": [{ "kind": "name", "re": "<regex source>", "flags": "i" }, ...] }.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The one address this repository may carry: the security contact (SECURITY.md). */
export const SECURITY_CONTACT = 'security@homie.rocks';

/** The public repository: the only remote a clone that is audited may have. */
export const PUBLIC_REMOTE = /^(?:https:\/\/github\.com\/|git@github\.com:)homie-rocks\/homie(?:\.git)?$/;

/** Made-up values the tests use on purpose (a stand-in wrangler plays the account). */
const FIXTURES = {
  workersDev: new Set(['test-studio.acct.workers.dev']),
  uuid: /^(1{8}-1{4}-1{4}-1{4}-1{12}|2{8}-2{4}-2{4}-2{4}-2{12})$/,
};

/**
 * A word the audit fails anywhere, used by one file in its ordinary sense. A match
 * there is an INFO row with the reason; the same word in any other file fails.
 */
export const ALLOWED_WORDS = {
  'packages/geom/src/laneride.ts': { words: ['lane'], why: "a road lane: the rider's offset from the centre line, and its public `lane` field" },
  'packages/geom/src/route.ts': { words: ['lane'], why: 'road lane markings, which ribbonGeo and dashedRibbon draw' },
  'packages/props/src/Landform.ts': { words: ['bench'], why: 'a bench in the geological sense: a terrace cut into a ridge flank (and the variable that shapes it)' },
};

/**
 * The audit's own source and its test spell out the patterns they look for, so the
 * built-in word and path checks skip them. Everything else (secrets, email addresses,
 * the private terms, file kinds) still applies to both.
 */
export const SELF = { 'scripts/audit.mjs': ['paths', 'process', 'placeholders', 'scope'], 'scripts/audit.test.mjs': ['paths', 'process', 'placeholders', 'scope', 'secrets', 'email'] };

/** Words of a private build process. */
const PROCESS_WORDS = [/\blanes?\b/i, /\bbench\b/i, /\bworktrees?\b/i, /\bcritic'?s?\b/i, /\bHQ\b/];

const SECRET_SHAPES = [
  ['aws-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['github-token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['openai-style-key', /\bsk-(proj-|ant-)?[A-Za-z0-9_-]{20,}/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/],
  ['bearer', /\bBearer\s+(?!\$\{|<)[A-Za-z0-9._~+/-]{16,}/],
  ['cloudflare-id-shape (32 hex)', /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/],
  ['api-token-assignment', /\b(api[_-]?key|api[_-]?token|secret|password|CLOUDFLARE_API_TOKEN)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/*
 * MCP's own method names (tools/list, tools/call, resources/templates/list, notifications/tools/list_changed and the
 * rest) are protocol words, not paths. They come out of a line before the private terms read it, so a private folder
 * that shares a word with them never fails a line that only names the protocol; a path into such a folder still does.
 */
export const MCP_METHOD = /(?<![\w./-])(?:notifications\/)?(?:tools|resources|resources\/templates|prompts|completion|logging|sampling|roots|elicitation)\/(?:list|call|read|get|subscribe|unsubscribe|list_changed|updated|complete|setLevel|createMessage)(?![\w.-])/g;
/** A line as a report may show it: home folders, email addresses and every private term masked. */
const sanitizer = (terms) => (line) => {
  let out = line.replace(/(\/Users\/|\/home\/|[A-Z]:\\Users\\)[^/\\\s'"`]+/g, '$1***').replace(EMAIL, '***@***');
  for (const t of terms) out = out.replace(new RegExp(t.re.source, `${t.re.flags.replace('g', '')}g`), '***');
  return out;
};
const mask = (s) => (s.length <= 4 ? '****' : `${s.slice(0, 2)}${'*'.repeat(Math.min(12, s.length - 2))}`);
const global = (re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);

/** Read the private terms: { v: 1, terms: [{ kind, re, flags }] } -> [{ n, kind, re }]. */
export function parseTerms(text) {
  if (!text || !text.trim()) return [];
  const doc = JSON.parse(text);
  if (doc?.v !== 1 || !Array.isArray(doc.terms)) throw new Error('private terms: expected { "v": 1, "terms": [...] }');
  return doc.terms.map((t, i) => ({ n: i + 1, kind: String(t.kind ?? 'private'), re: new RegExp(t.re, (t.flags ?? 'i').replace('g', '')) }));
}

/**
 * The checks of one text (a file, or a commit message when `path` is null).
 * `ctx`: { terms, openPackages: Set, allowed: ALLOWED_WORDS }. Each finding is
 * { check, level: 'fail'|'info', where, what }.
 */
export function auditText(path, text, ctx) {
  const out = [];
  const lines = text.split('\n');
  const isMessage = path === null;
  const clean = sanitizer(ctx.terms);
  const excerpt = (line) => clean(line.trim()).slice(0, 140);
  const where = (i) => (isMessage ? `message:${i + 1}` : `${path}:${i + 1}`);
  const skip = new Set(isMessage ? [] : SELF[path] ?? []);
  const hit = (check, level, i, what) => { if (!(skip.has(check) && level === 'fail')) out.push({ check, level, where: where(i), what }); };
  const each = (re, fn) => { const g = global(re); lines.forEach((line, i) => { for (const m of line.matchAll(g)) fn(i, line, m[0]); }); };
  const allowedHere = (m) => (!isMessage && (ctx.allowed[path]?.words ?? []).some((w) => [m.toLowerCase(), m.toLowerCase().replace(/s$/, '')].includes(w.toLowerCase())));

  // Home and machine paths.
  each(/\/Users\/|\/home\/[a-z]|[A-Z]:\\Users|\/private\/tmp\/|\/var\/folders\//, (i, line) => hit('paths', 'fail', i, `home or machine path: ${excerpt(line)}`));
  each(/~\/[A-Za-z.][^\s`'")]*/, (i, line, m) => {
    if (/^~\/\.homie[\\`'".,;:)]*$/.test(m)) hit('paths', 'info', i, `${m}: the product's runtime folder, named only to say a studio never needs it`);
    else if (/^~\/studios\//.test(m)) hit('paths', 'info', i, `${m}: an example folder in the CLI's own help text`);
    else hit('paths', 'fail', i, `a home-relative path: ${clean(m)}`);
  });

  // Email addresses.
  each(EMAIL, (i, line, m) => {
    if (m.toLowerCase() === SECURITY_CONTACT) hit('email', 'info', i, `${m} (the security contact)`);
    else if (isMessage && ctx.signoffs && /^\s*Signed-off-by:/i.test(line)) hit('email', 'info', i, `a contributor's sign-off (${mask(m)})`);
    else hit('email', 'fail', i, `an email address (${mask(m)})`);
  });

  // Secret shapes.
  for (const [kind, re] of SECRET_SHAPES) each(re, (i) => hit('secrets', 'fail', i, `${kind} shape (value not printed)`));
  each(/[a-z0-9-]+(\.[a-z0-9-]+)+\.workers\.dev/i, (i, line, m) => {
    if (FIXTURES.workersDev.has(m.toLowerCase())) hit('secrets', 'info', i, `${m}: a made-up host in a test's stand-in wrangler`);
    else hit('secrets', 'fail', i, `a workers.dev host (${mask(m)})`);
  });
  each(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, (i, line, m) => {
    if (FIXTURES.uuid.test(m)) hit('secrets', 'info', i, `${m}: a made-up D1 id in a test`);
    else hit('secrets', 'fail', i, `a UUID (${mask(m)})`);
  });

  // Scope, package paths, commit ids, the private netplay build's folders.
  if (!isMessage) {
    each(/@homie\/[a-z]/, (i, line) => hit('scope', 'fail', i, `old scope @homie/: ${excerpt(line)}`));
    each(/(^|[\s`'"(])(contract|dev|demo|evidence)\/[A-Za-z0-9_.-]+/, (i, line, m) => hit('paths', 'fail', i, `${clean(m.trim())} (a folder of a private build): ${excerpt(line)}`));
  }
  const open = [...ctx.openPackages].map(esc).join('|') || 'studio';
  each(new RegExp(`\\bpackages\\/(?!(${open})(?![a-z0-9-]))[a-z0-9-]+`), (i, line, m) => hit('paths', 'fail', i, `${clean(m)}: not a package of this repository: ${excerpt(line)}`));
  each(/\bcommit [0-9a-f]{7,40}\b/, (i, line, m) => hit('paths', 'fail', i, `a private commit id (${m})`));

  // Words of a private build process.
  for (const re of PROCESS_WORDS) {
    each(re, (i, line, m) => (allowedHere(m)
      ? hit('process', 'info', i, `"${m}" allowed here (${ctx.allowed[path].why})`)
      : hit('process', 'fail', i, `build-process word "${m}": ${excerpt(line)}`)));
  }

  // Placeholders (a placeholder starts with a letter, so `a << 8 | b >>> 0` is not one).
  if (!isMessage) each(/<<(?=[A-Za-z])[^<>]*>>|\bPLACEHOLDER\b|\bTODO\b|\bFIXME\b/, (i, line) => hit('placeholders', 'fail', i, excerpt(line)));

  // The device-class words a reviewer should see in context.
  if (!isMessage) each(/\b(TV|tv|television|camera|speakers?|lights?|microphone)\b/, (i, line, m) => hit('context', 'info', i, `"${m}": ${excerpt(line)}`));

  // The maintainers' private terms: the number and kind only, never the term.
  for (const t of ctx.terms) lines.forEach((line, i) => { if (t.re.test(line.replace(MCP_METHOD, ''))) hit('private', 'fail', i, `private term #${t.n} (${t.kind})`); });
  return out;
}

/** The checks of one file's bytes: kind, encoding, size. */
function auditBlob(path, mode, buf) {
  const out = [];
  const base = path.split('/').pop();
  if (mode === '120000') out.push({ check: 'files', level: 'fail', where: path, what: 'a symlink' });
  if (mode === '160000') out.push({ check: 'files', level: 'fail', where: path, what: 'a submodule' });
  if (/^\.env/i.test(base) || /\.(pem|key|p12|pfx)$/i.test(base) || /^id_(rsa|ed25519)/.test(base) || base === '.DS_Store' || base === '.npmrc') out.push({ check: 'files', level: 'fail', where: path, what: 'a file of a secret-bearing kind' });
  if (buf === null) return { out, text: null };
  const text = buf.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(buf) !== 0 || text.includes('\u0000')) {
    out.push({ check: 'files', level: 'fail', where: path, what: 'not UTF-8 text (binaries stay out of this repository)' });
    return { out, text: null };
  }
  if (buf.length > 256 * 1024) out.push({ check: 'files', level: 'info', where: path, what: `${buf.length} bytes` });
  return { out, text };
}

/** Read blobs by id through one `git cat-file --batch` per call. */
function catBlobs(repo, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const buf = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], { input: `${ids.join('\n')}\n`, maxBuffer: 1 << 30 });
  let at = 0;
  for (const id of ids) {
    const nl = buf.indexOf(10, at);
    const [, type, size] = buf.subarray(at, nl).toString().split(' ');
    const n = Number(size);
    out.set(id, type === 'blob' ? buf.subarray(nl + 1, nl + 1 + n) : null);
    at = nl + 1 + n + 1;
  }
  return out;
}

/** The working tree, as a pseudo-commit. */
const WORKING_TREE = 'the working tree';
const gitText = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });

/**
 * The working tree as the next commit would hold it: tracked and new (not ignored)
 * files, read from disk. Their `id` is a marker; `buf` is the bytes.
 */
function workingTreeEntries(repo) {
  const paths = [...new Set(gitText(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))];
  const out = [];
  for (const path of paths.sort()) {
    const full = join(repo, path);
    if (!existsSync(full) && !lstatSafe(full)) continue; // deleted, not yet committed
    const st = lstatSync(full);
    if (st.isDirectory()) { out.push({ mode: '160000', id: `working-tree:${path}`, path }); continue; }
    out.push({ mode: st.isSymbolicLink() ? '120000' : '100644', id: `working-tree:${path}`, path, buf: st.isSymbolicLink() ? null : readFileSync(full) });
  }
  return out;
}
const lstatSafe = (p) => { try { return lstatSync(p); } catch { return null; } };

/** A tree's entries: [{ mode, id, path }]. */
function treeEntries(repo, rev) {
  if (rev === WORKING_TREE) return workingTreeEntries(repo);
  return gitText(repo, ['ls-tree', '-r', '-z', '--full-tree', rev]).split('\0').filter(Boolean).map((row) => {
    const [meta, path] = row.split('\t');
    const [mode, , id] = meta.split(' ');
    return { mode, id, path };
  });
}

/**
 * Audit a repository: one tree (`ref`), or every commit in `range` (`history`).
 * Findings are cached per (path, blob), so a file that never changes is read once.
 */
export function auditRepo(repo, { ref = 'HEAD', history = null, workingTree = false, terms = [], identity = null, termsGiven = false } = {}) {
  const commits = history !== null
    ? gitText(repo, ['rev-list', '--reverse', '--topo-order', ...(history ? [history] : ['--all'])]).split('\n').filter(Boolean)
    : workingTree ? [WORKING_TREE] : [gitText(repo, ['rev-parse', `${ref}^{commit}`]).trim()];
  // A path to a package folder is public when the newest audited tree has that folder.
  const tip = commits[commits.length - 1];
  const openPackages = new Set(tip ? treeEntries(repo, tip).filter((e) => e.path.startsWith('packages/')).map((e) => e.path.split('/')[1]) : []);
  const ctx = { terms, openPackages, allowed: ALLOWED_WORDS, signoffs: !identity };
  const findings = [];
  const cache = new Map();
  const failedCommits = new Set();
  let files = 0;
  for (const c of commits) {
    const entries = treeEntries(repo, c);
    files = entries.length;
    const todo = entries.filter((e) => !cache.has(`${e.id}\t${e.path}`));
    const blobs = c === WORKING_TREE ? new Map(todo.map((e) => [e.id, e.buf])) : catBlobs(repo, [...new Set(todo.filter((e) => e.mode !== '160000').map((e) => e.id))]);
    for (const e of todo) {
      const { out, text } = auditBlob(e.path, e.mode, e.mode === '160000' || e.mode === '120000' ? null : blobs.get(e.id));
      if (text !== null) out.push(...auditText(e.path, text, ctx));
      cache.set(`${e.id}\t${e.path}`, out);
    }
    for (const e of entries) {
      for (const f of cache.get(`${e.id}\t${e.path}`)) {
        if (f.level === 'fail') failedCommits.add(c);
        findings.push({ ...f, commit: c, key: `${e.id}\t${e.path}` });
      }
    }
    if (history !== null) {
      const [an, ae, cn, ce, ...body] = gitText(repo, ['show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce%x00%B', c]).split('\0');
      const msg = body.join('\0');
      const meta = [];
      if (identity && (an !== identity || cn !== identity)) meta.push({ check: 'git', level: 'fail', where: 'identity', what: `not by ${identity} (${mask(an)} / ${mask(cn)})` });
      if (identity && (ae || ce)) meta.push({ check: 'git', level: 'fail', where: 'identity', what: 'an author or committer email is set' });
      for (const t of terms) if (t.re.test(`${an}\n${ae}\n${cn}\n${ce}`)) meta.push({ check: 'private', level: 'fail', where: 'identity', what: `private term #${t.n} (${t.kind})` });
      meta.push(...auditText(null, msg, ctx));
      for (const f of meta) { if (f.level === 'fail') failedCommits.add(c); findings.push({ ...f, commit: c, key: `commit ${c}` }); }
    }
  }
  const remotes = [];
  for (const r of gitText(repo, ['remote']).split('\n').filter(Boolean)) {
    const url = gitText(repo, ['remote', 'get-url', r]).trim();
    remotes.push(r);
    if (!PUBLIC_REMOTE.test(url)) findings.push({ check: 'git', level: 'fail', where: `remote ${r}`, what: 'not the public repository', commit: null, key: `remote ${r}` });
  }
  return { commits, failedCommits, findings, files, remotes, terms: terms.length, termsGiven, openPackages };
}

const TITLES = {
  files: 'Files: no symlinks, submodules, binaries or secret-bearing files',
  paths: 'Home, machine and private paths; package folders this repository does not have; private commit ids',
  email: `Email addresses (only ${SECURITY_CONTACT})`,
  secrets: 'Tokens, keys, account ids, UUIDs, workers.dev hosts',
  scope: 'npm scope: @homie-rocks/ only, never @homie/',
  process: 'Words of a private build process',
  placeholders: 'No placeholder or TODO left',
  private: "The maintainers' private terms (number and kind only)",
  git: 'Git: commit identity, and no remote but the public repository',
  context: 'Words a reviewer should see in context (INFO only)',
};

/** The report: one section per check, each finding once (with how many commits carry it). */
export function report(result, { history }) {
  const failed = result.findings.filter((f) => f.level === 'fail');
  const lines = [];
  const scope = history !== null ? `${result.commits.length} commit(s), ${result.failedCommits.size} with a finding`
    : result.commits[0] === WORKING_TREE ? `the working tree (${result.files} files: tracked and new)` : `the tree at ${result.commits[0].slice(0, 12)} (${result.files} files)`;
  lines.push(`LEAK AUDIT — ${failed.length ? 'FAILED' : 'CLEAN'}: ${scope}`);
  lines.push(result.termsGiven ? `private terms: ${result.terms} (read from the maintainers; never printed)` : 'private terms: NOT GIVEN — only the public checks ran (set HOMIE_AUDIT_TERMS or pass --terms)');
  lines.push(`remotes: ${result.remotes.length ? result.remotes.join(', ') : 'none'}`);
  lines.push('');
  for (const [check, title] of Object.entries(TITLES)) {
    const rows = new Map();
    for (const f of result.findings.filter((x) => x.check === check)) {
      const k = `${f.level}\t${f.where}\t${f.what}`;
      const row = rows.get(k) ?? { ...f, commits: new Set() };
      if (f.commit) row.commits.add(f.commit);
      rows.set(k, row);
    }
    const fails = [...rows.values()].filter((r) => r.level === 'fail');
    const infos = [...rows.values()].filter((r) => r.level === 'info');
    lines.push(`[${fails.length ? 'FAIL' : 'PASS'}] ${title}`);
    const n = (r) => (history !== null && r.commits.size > 1 ? ` (${r.commits.size} commits, first ${[...r.commits][0].slice(0, 12)})` : history !== null && r.commits.size === 1 ? ` (${[...r.commits][0].slice(0, 12)})` : '');
    for (const r of fails) lines.push(`   FAIL ${r.where}: ${r.what}${n(r)}`);
    if (check !== 'context') for (const r of infos) lines.push(`   info ${r.where}: ${r.what}`);
    else if (infos.length) lines.push(`   info ${infos.length} rows (TV is a device class in the netplay protocol, a camera is a game's own view)`);
    lines.push('');
  }
  return { clean: failed.length === 0, text: `${lines.join('\n')}\n` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const history = args.includes('--history') ? (opt('--history') && !opt('--history').startsWith('--') ? opt('--history') : '') : null;
  const termsArg = opt('--terms');
  const termsText = termsArg === '-' ? readFileSync(0, 'utf8') : termsArg ? readFileSync(termsArg, 'utf8') : (process.env.HOMIE_AUDIT_TERMS ?? '');
  const terms = parseTerms(termsText);
  const repo = opt('--repo') ?? ROOT;
  const result = auditRepo(repo, { ref: opt('--ref') ?? 'HEAD', history, workingTree: args.includes('--working-tree'), terms, identity: opt('--identity') ?? null, termsGiven: terms.length > 0 });
  const { clean, text } = report(result, { history });
  if (opt('--report')) writeFileSync(opt('--report'), text);
  process.stdout.write(text);
  if (args.includes('--require-terms') && !terms.length) { process.stderr.write('audit: --require-terms, and no private terms were given\n'); process.exit(1); }
  process.exit(clean ? 0 : 1);
}
