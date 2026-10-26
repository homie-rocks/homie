/**
 * Fast default-suite versions of four security guards whose full checks live in the heavy suite
 * (servers.heavy.mjs, studio.heavy.mjs, watch.heavy.mjs, standalone.heavy.mjs). Each calls the guarding function
 * directly: an in-memory D1, a stand-in wrangler, a stand-in packager; no game build.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { accessOf, ticketAllows, ticketFor, ticketSub } from '../worker/office.mjs';
import { passCreate, passOf, passRefusal, passRevoke } from '../worker/agents.mjs';
import { SERVERS_MIGRATION } from '../worker/servers.mjs';
import { standaloneBuild, standaloneDir } from '../lib/standalone.mjs';
import { standaloneLines } from '../lib/standalone-cli.mjs';
import { browserRulesGame } from './browser-rules-game.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-guards-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/** A D1 stand-in with the tables the pass and ticket guards read: meta (the office key) and agent_passes. */
function db() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  sql.exec(/CREATE TABLE IF NOT EXISTS agent_passes \([\s\S]*?\n\)[^;]*;/.exec(SERVERS_MIGRATION)[0]);
  const stmt = (query, args = []) => ({
    query, bind: (...a) => stmt(query, a),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: r.changes } }; },
  });
  return { sql, prepare: (q) => stmt(q), batch: async (list) => Promise.all(list.map((s) => (/^SELECT/i.test(s.query) ? s.all() : s.run()))) };
}

test('agent passes: stored hashed, a forged or tampered secret is nobody, scope and humans-only refuse, revoke and expiry end it', async () => {
  const env = { DB: db() };
  const made = await passCreate(env, { label: 'Claude', game: 'owl-run', days: 7 });
  assert.match(made.secret, /^hap_[a-f0-9]{10}_[A-Za-z0-9_-]{40}$/);
  const row = env.DB.sql.prepare('SELECT * FROM agent_passes WHERE id = ?').get(made.pass.id);
  assert.equal(row.hash, createHash('sha256').update(made.secret).digest('hex'));
  assert.ok(!JSON.stringify(row).includes(made.secret), 'the secret itself is never stored');
  assert.equal((await passOf(env, made.secret)).id, made.pass.id);
  const last = made.secret.at(-1);
  assert.equal(await passOf(env, made.secret.slice(0, -1) + (last === 'A' ? 'B' : 'A')), null, 'a tampered secret is nobody');
  assert.equal(await passOf(env, `hap_${made.pass.id}_${'x'.repeat(40)}`), null, 'a forged secret for a real id is nobody');
  // Scope: a pass for one game is refused in another; a humans-only server refuses every AI.
  assert.equal(passRefusal(made.pass, { game: 'owl-run', server: 'people-only', policy: { kind: 'humans-only' } }).error, 'agents-off');
  assert.equal(passRefusal(made.pass, { game: 'vale', server: 'public', policy: { kind: 'open' } }).error, 'agent-scope');
  assert.equal(passRefusal(made.pass, { game: 'owl-run', server: 'public', policy: { kind: 'open' }, launch: 'private' }), null);
  assert.equal(passRefusal(null, { game: 'owl-run', server: 'public', policy: { kind: 'open' } }).error, 'agent-pass', 'no pass, no AI seat');
  const guest = await passCreate(env, { label: 'Guest', kind: 'guest', game: 'owl-run' });
  assert.equal(passRefusal(guest.pass, { game: 'owl-run', server: 'public', policy: { kind: 'open' }, launch: 'private' }).error, 'not-open');
  assert.equal((await passCreate(env, { label: 'Spot', kind: 'service' })).error, 'service');
  // Revoked, and separately expired: both are nobody.
  await passRevoke(env, made.pass.id);
  assert.equal(await passOf(env, made.secret), null, 'a revoked pass is nobody');
  env.DB.sql.prepare('UPDATE agent_passes SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, guest.pass.id);
  const expired = await passOf(env, guest.secret);
  assert.ok(!expired || !expired.live, 'an expired pass is not live');
});

test('tickets: signed for one game and one holder; a forged, foreign or expired ticket names nobody', async () => {
  const env = { DB: db() };
  const t = await ticketFor(env, 'owl-run', 'a-abcdef1234');
  assert.equal(await ticketSub(env, 'owl-run', t), 'a-abcdef1234');
  assert.equal(await ticketSub(env, 'vale', t), null, 'another game\'s ticket');
  const [exp, sub, mac] = t.split('.');
  assert.equal(await ticketSub(env, 'owl-run', `${exp}.o.${mac}`), null, 'a holder swapped into a signed ticket');
  assert.equal(await ticketSub(env, 'owl-run', `${exp}.${sub}.${'0'.repeat(32)}`), null, 'a made-up signature');
  assert.equal(await ticketSub(env, 'owl-run', await ticketFor(env, 'owl-run', 'o', -1000)), null, 'an expired ticket');
  assert.equal(await ticketSub({ DB: db() }, 'owl-run', t), null, 'another studio\'s ticket');
});

test('a private game\'s door (play and watch): only whoever may play it; a stranger, a guest AI or a forged ticket is shut out', async () => {
  const env = { DB: db() };
  const stranger = new Request('https://owls.example/night-vault/watch?room=pub-1');
  assert.deepEqual(await accessOf(stranger, env, 'night-vault', 'private'), { ok: false, sub: null, owner: false });
  assert.equal((await accessOf(stranger, env, 'night-vault', 'public')).ok, true);
  // The frame and socket doors go by the ticket: the owner's opens, nobody else's.
  assert.equal(await ticketAllows(env, await ticketSub(env, 'night-vault', await ticketFor(env, 'night-vault', 'o')), 'private'), true);
  assert.equal(await ticketAllows(env, await ticketSub(env, 'night-vault', null), 'private'), false, 'no ticket');
  assert.equal(await ticketAllows(env, await ticketSub(env, 'night-vault', await ticketFor(env, 'owl-run', 'o')), 'private'), false, 'the owner\'s ticket for another game');
  assert.equal(await ticketAllows(env, 'i-ABCD2345', 'private'), false, 'an invite does not open a private game');
  const guest = await passCreate(env, { label: 'Guest', kind: 'guest' });
  const owner = await passCreate(env, { label: 'Mine' });
  assert.equal(await ticketAllows(env, `a-${guest.pass.id}`, 'private'), false, 'a guest AI');
  assert.equal(await ticketAllows(env, `a-${owner.pass.id}`, 'private'), true, 'the owner\'s own AI');
  await passRevoke(env, owner.pass.id);
  assert.equal(await ticketAllows(env, `a-${owner.pass.id}`, 'private'), false, 'a revoked AI');
});

test('deploy never touches a Worker or D1 this studio did not create; signed out asks for a login', () => {
  const dir = join(scratch, 'deploys');
  const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0' } });
  assert.equal(run(['new', dir, '--name', 'Test Studio', '--homie', 'https://homie.test', '--no-install'], scratch).status, 0);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  const bin = join(dir, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  const fake = (script) => { writeFileSync(join(bin, 'wrangler'), `#!/bin/sh\n${script}\n`); chmodSync(join(bin, 'wrangler'), 0o755); };
  const deploy = () => JSON.parse(run(['deploy'], dir).stdout);
  const signedIn = `queues) if [ "$2" = info ]; then echo "Queue does not exist" >&2; exit 1; fi; echo created;;
    whoami) echo '{"loggedIn":true,"authType":"OAuth Token","accounts":[{"id":"acc1","name":"Test"}]}';;`;
  fake(`case "$1" in whoami) echo '{"loggedIn":false}';; esac; exit 0`);
  const out = deploy();
  assert.equal(out.needs, 'cloudflare-login');
  assert.match(out.why, /npx wrangler login/);
  fake(`case "$1" in ${signedIn}
    versions) echo '[{"id":"v1"}]'; exit 0;;
    *) echo "unexpected: $*" >&2; exit 9;;
  esac`);
  const worker = deploy();
  assert.equal(worker.ok, false);
  assert.match(worker.why, /already exists on this Cloudflare account and this studio did not create it/);
  fake(`case "$1" in ${signedIn}
    versions) echo 'This Worker does not exist on your account. [code: 10007]' >&2; exit 1;;
    d1) echo '[{"uuid":"11111111-1111-1111-1111-111111111111","name":"test-studio-db"}]';;
    *) echo "unexpected: $*" >&2; exit 9;;
  esac`);
  const d1 = deploy();
  assert.equal(d1.ok, false);
  assert.match(d1.why, /D1 database named "test-studio-db" already exists/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8')).cloudflare.created, [], 'nothing recorded as created');
});

/** The packager, npm and the started app, played by a stand-in (as in standalone.heavy.mjs): what the signer did is in `plan`. */
function standIns(plan = {}) {
  const calls = [];
  const exec = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, env: opts.env ?? null, cwd: opts.cwd ?? null });
    const said = (o) => ({ code: o.ok === false ? 1 : 0, stdout: `${JSON.stringify(o)}\n`, stderr: '' });
    if (/npm(\.cmd)?$/.test(cmd) && args[0] === 'install') {
      if (plan.npm === 'fails') return { code: 1, stdout: '', stderr: 'npm error network' };
      const pkg = JSON.parse(readFileSync(join(opts.cwd, 'package.json'), 'utf8'));
      for (const name of Object.keys(pkg.devDependencies ?? {})) { mkdirSync(join(opts.cwd, 'node_modules', ...name.split('/')), { recursive: true }); writeFileSync(join(opts.cwd, 'node_modules', ...name.split('/'), 'package.json'), '{}'); }
      if (plan.npm !== 'interrupted') writeFileSync(join(opts.cwd, 'node_modules', '.package-lock.json'), '{}');
      return { code: 0, stdout: 'added', stderr: '' };
    }
    if (String(args[0]).endsWith('pack.mjs')) {
      const [, platform, arch, kind] = args;
      const os = { darwin: 'mac', win32: 'windows', linux: 'linux' }[platform];
      const how = plan[os] ?? 'ok';
      if (how === 'missing-module' && calls.filter((c) => String(c.args[0]).endsWith('pack.mjs') && c.args[1] === platform).length === 1) return { code: 1, stdout: '', stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'galactus' imported from packager.js" };
      if (how === 'fails') return said({ ok: false, why: 'the packager broke' });
      const out = join(opts.cwd, 'out', os, kind);
      rmSync(out, { recursive: true, force: true });
      const meta = JSON.parse(readFileSync(join(opts.cwd, 'electron', 'package.json'), 'utf8'));
      const app = os === 'mac' ? join(out, `${meta.fileName}.app`) : out;
      const exe = os === 'mac' ? join(app, 'Contents', 'MacOS', meta.fileName) : join(out, os === 'windows' ? `${meta.name}.exe` : meta.name);
      if (how !== 'lies') { mkdirSync(dirname(exe), { recursive: true }); writeFileSync(exe, 'program'); }
      const identity = opts.env?.HOMIE_APPLE_IDENTITY;
      return said({ ok: true, platform, arch, kind, path: out, app, exe, electron: '44.6.0', signed: Boolean(identity) && plan.signature !== 'bad', adhoc: identity === '-', notarizeAsked: Boolean(identity && identity !== '-' && opts.env?.HOMIE_APPLE_NOTARY_PROFILE), notarized: plan.stapled === true, checks: plan.signature === 'bad' ? { signature: false, signatureSays: 'code object is not signed at all' } : {} });
    }
    if (args[0] === '--smoke=5000') return plan.start === 'fails' ? { code: 1, stdout: '', stderr: 'cannot open display' } : said({ smoke: 1, ok: plan.start !== 'dirty', loaded: plan.start !== 'blank', origin: 'app://game', failed: plan.start === 'dirty' ? ['404 app://game/game/missing.png'] : [], errors: [] });
    return { code: 127, stdout: '', stderr: '' };
  };
  return { exec, calls, packs: () => calls.filter((c) => String(c.args[0]).endsWith('pack.mjs')), installs: () => calls.filter((c) => c.args[0] === 'install') };
}

test('standalone: a release that could not be signed and notarized is said as UNSIGNED and is not ok; a debug build never takes a release\'s place', async () => {
  const root = join(scratch, 'signing');
  assert.equal(spawnSync(process.execPath, [CLI, 'new', root, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install', '--json'], { cwd: scratch, encoding: 'utf8' }).status, 0);
  browserRulesGame(root, 'gem', 'Gem Rush');
  const file = join(root, 'games', 'gem', 'game.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), standalone: { appId: 'com.example.gem', version: '2.0.0', build: 5 } }, null, 2));
  // A stand-in for the site's build of the game (the copy is made from it; nothing here is about its contents).
  mkdirSync(join(root, 'site', 'dist', 'games', 'gem'), { recursive: true });
  writeFileSync(join(root, 'site', 'dist', 'games', 'gem', 'index.html'), '<!doctype html><html><head></head><body></body></html>');
  const base = { home: join(scratch, 'nobody'), buildSite: false, platform: 'darwin', for: 'mac' };
  const dir = standaloneDir(root, 'gem');
  let r = await standaloneBuild(root, 'gem', { ...base, env: {}, exec: standIns().exec });
  assert.equal(r.ok, true, r.why);
  // A release with no identity: built, UNSIGNED, not ok.
  r = await standaloneBuild(root, 'gem', { ...base, release: true, env: {}, exec: standIns().exec });
  assert.deepEqual([r.ok, r.targets[0].state, r.targets[0].unsigned, r.unsigned], [false, 'built', true, ['mac']]);
  assert.match(r.why, /built UNSIGNED, which no store takes: mac/);
  assert.match(standaloneLines(r).join('\n'), /BUILT, UNSIGNED \(no store takes it\)/);
  // A later debug build leaves the release, and what it was, alone.
  r = await standaloneBuild(root, 'gem', { ...base, build: 9, env: {}, exec: standIns().exec });
  const record = JSON.parse(readFileSync(join(dir, 'built.json'), 'utf8')).targets.mac;
  assert.deepEqual([record.debug.build, record.release.build, record.release.unsigned], [9, 5, true]);
  assert.ok(existsSync(join(dir, 'out', 'mac', 'release', 'Gem Rush.app')), 'the release is not deleted');
  // Signed but not notarized, notarized but not stapled, a signature that does not verify, ad hoc: none ok.
  for (const [env, plan, words] of [
    [{ HOMIE_APPLE_IDENTITY: 'Developer ID Application: X' }, {}, /NOT NOTARIZED/],
    [{ HOMIE_APPLE_IDENTITY: 'Developer ID Application: X', HOMIE_APPLE_NOTARY_PROFILE: 'p' }, {}, /NOT CONFIRMED NOTARIZED/],
    [{ HOMIE_APPLE_IDENTITY: 'Developer ID Application: X' }, { signature: 'bad' }, /UNSIGNED: the signer ran and codesign does not verify/],
    [{ HOMIE_APPLE_IDENTITY: '-' }, {}, /signed AD HOC[^\n]*Not a release/],
  ]) {
    r = await standaloneBuild(root, 'gem', { ...base, release: true, env, exec: standIns(plan).exec });
    assert.deepEqual([r.ok, r.targets[0].unsigned], [false, true], String(words));
    assert.match(r.targets[0].notes.join('\n'), words);
  }
  r = await standaloneBuild(root, 'gem', { ...base, release: true, env: { HOMIE_APPLE_IDENTITY: 'Developer ID Application: X', HOMIE_APPLE_NOTARY_PROFILE: 'p', HOMIE_APPLE_TEAM: 'T' }, exec: standIns({ stapled: true }).exec });
  assert.deepEqual([r.ok, r.unsigned], [true, []], 'signed, notarized and stapled is the one release that is ok');
});
