/**
 * @homie-rocks/studio 0.30.2: a first run in Codex and in Grok Build, from running the same first sentence there
 * ("set up a game studio called X and make a multiplayer game") on 2026-10-04.
 *
 *   - a missing connector never blocks: `setup status --connector no` blocks nothing, says a shell makes the studio,
 *     and its fix names the toolkit's own `new`;
 *   - the connector's name: another MCP server named `homie` in the app's own config.toml is said plainly, with the
 *     command that adds Homie's connector under its own name, and nothing of that server's command is read out;
 *   - Homie's holds: a row in Codex and Grok Build only, on when the plugin's hooks left their mark just now, off
 *     otherwise, with how to turn them on; the mark is the one the plugin's hooks write;
 *   - `demo` with no network answers with the arcade's standing first pick and says it did not reach the arcade;
 *   - a note to Homie from Grok says Grok, not "another app".
 *
 * Every folder here is a scratch one, and the values that look like a token are built at run time (the repository's
 * leak audit reads this file).
 * Run: node --test packages/studio/test/first-run-apps.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEMO_FALLBACK, demoGames, formatDemo } from '../lib/demo.mjs';
import { CONNECTOR_NAME, HOLDS_FRESH_MS, connectorClash, formatStatus, holdsMark, sessionApp, setupStatus } from '../lib/doctor.mjs';
import { APP_LABEL, FEEDBACK_APPS, appOf, cleanNote, withLine } from '../lib/feedback.mjs';
import { mark, marksDir } from '../../../plugins/homie/hooks/codex.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-first-run-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const reachable = async () => new Response('{}', { status: 405 });
const exec = async (cmd, args) => (`${cmd} ${args.join(' ')}` === 'git --version' ? { code: 0, stdout: '', stderr: '' } : { code: 127, stdout: '', stderr: 'not found' });
/** A person's home folder with nothing in it, and a folder to work in. */
function place(name) {
  const home = join(scratch, name, 'home');
  const cwd = join(scratch, name, 'studios');
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { home, cwd, marks: join(home, '.cache', 'homie-studio', 'holds') };
}
const status = (p, more = {}, env = {}) => setupStatus({ cwd: p.cwd, env: { HOME: p.home, ...env }, platform: 'darwin', exec, fetchFn: reachable, chrome: () => '/x/chrome', node: '22.22.0', homie: 'https://homie.test', ...more });
const row = (r, id) => r.rows.find((x) => x.id === id);

test('no connector, with a shell: nothing blocks, and the row says the studio is made with the toolkit\'s own command', async () => {
  const p = place('no-connector');
  const r = await status(p, { connector: 'no' });
  assert.deepEqual(r.blocking, [], 'a missing connector is never a blocker');
  const c = row(r, 'connector');
  assert.equal(c.state, 'act');
  assert.equal(c.need, 'recommended', 'the connector is no longer required to make a studio');
  assert.match(c.detail, /not in this session; a studio is still made, checked, deployed and listed with the studio's own commands/);
  assert.match(c.unlocks, /a session with a shell makes, deploys and lists a studio without it/);
  assert.match(c.fix.say, /npx -y @homie-rocks\/studio@\d+\.\d+\.\d+ new <folder> --name "<Name>" makes the studio/, 'the fix names the one package address');
  assert.match(c.fix.say, /grok plugin install homie-rocks\/homie#plugins\/homie/, 'and how each app gets the connector, Grok Build included');
  assert.equal(c.clash, undefined);
  // Listing needs the directory, which this computer reaches; the connector is not what lists a game.
  assert.equal(r.features.find((f) => /List games/.test(f.feature)).state, 'ready');
  assert.equal(row(r, 'holds'), undefined, 'no app was named, so nothing is said about hooks');
});

test('the connector\'s name is taken: another MCP server named homie in Codex\'s config.toml is said plainly, and never read out', async () => {
  const p = place('clash-codex');
  const hidden = ['node', 'bridge', 'made-up', 'token'].join('-');
  mkdirSync(join(p.home, '.codex'), { recursive: true });
  writeFileSync(join(p.home, '.codex', 'config.toml'), [
    'model = "some-model"', '',
    '[mcp_servers.other]', 'url = "https://example.test/mcp"', '',
    '[mcp_servers.homie]', `command = "/opt/other/${hidden}"`, `args = ["${hidden}-arg"]`, '',
    '[mcp_servers.homie.env]', `OTHER_VALUE = "${hidden}-value"`, '',
  ].join('\n'));
  const r = await status(p, { connector: 'no', client: 'codex' });
  const c = row(r, 'connector');
  assert.equal(c.state, 'act');
  assert.deepEqual(c.clash, { app: 'codex', server: 'homie', kind: 'a local command', where: "config.toml in Codex's home folder", as: CONNECTOR_NAME });
  assert.match(c.detail, /another MCP server named homie \(a local command\) is set up in Codex/);
  assert.equal(c.fix.who, 'ai');
  assert.equal(c.fix.run, 'codex mcp add homie-rocks --url https://homie.test/mcp', 'Homie\'s connector under its own name, at this directory');
  assert.match(c.fix.say, /leaves the other server as it is/);
  assert.match(c.fix.say, /Until then your AI goes on with the studio's own commands/);
  assert.deepEqual(r.blocking, []);
  assert.ok(r.next.some((n) => n.id === 'connector' && n.run === c.fix.run));
  const printed = JSON.stringify(r) + formatStatus(r);
  assert.ok(!printed.includes(hidden), 'the other server\'s command, arguments and environment are never read out');
  assert.ok(!/[^_]__/.test(CONNECTOR_NAME) && !CONNECTOR_NAME.includes('_'), 'no underscore: Grok\'s hook matcher reads the server name up to the first one');

  // The AI says its Homie tools are here: nothing to report, whatever the file holds.
  assert.equal(row(await status(p, { connector: 'yes', client: 'codex' }), 'connector').clash, undefined);
  // The same file, with nobody saying which app this is: it is not read.
  assert.equal(row(await status(p, { connector: 'no' }), 'connector').clash, undefined);
  // Codex's own environment names the app when the AI does not.
  assert.equal(row(await status(p, { connector: 'no' }, { CODEX_SANDBOX: 'seatbelt' }), 'connector').clash?.app, 'codex');
  // CODEX_HOME moves Codex's home folder.
  const moved = join(scratch, 'clash-codex', 'elsewhere');
  mkdirSync(moved, { recursive: true });
  writeFileSync(join(moved, 'config.toml'), '[mcp_servers.homie]\nurl = "https://homie.rocks/mcp"\n');
  assert.equal(row(await status(p, { connector: 'no', client: 'codex' }, { CODEX_HOME: moved }), 'connector').clash, undefined, 'a homie entry at Homie\'s own address is Homie\'s connector');
});

test('the connector\'s name in Grok: this folder\'s own config and the home folder\'s, an address that is not Homie\'s, and Homie\'s own', () => {
  const p = place('clash-grok');
  assert.equal(connectorClash({ app: 'grok', env: { HOME: p.home }, cwd: p.cwd }), null, 'no file, no report');
  mkdirSync(join(p.home, '.grok'), { recursive: true });
  writeFileSync(join(p.home, '.grok', 'config.toml'), '[cli]\n\n[mcp_servers."homie"]\nurl = "https://elsewhere.test/mcp/" # another one\n\n[plugins]\n');
  assert.deepEqual(connectorClash({ app: 'grok', env: { HOME: p.home }, cwd: p.cwd }), { app: 'grok', name: 'Grok', where: "config.toml in Grok's home folder", kind: 'another address' });
  // This folder's own entry is read first, and Homie's own address there is the connector itself.
  mkdirSync(join(p.cwd, '.grok'), { recursive: true });
  writeFileSync(join(p.cwd, '.grok', 'config.toml'), '[mcp_servers.homie]\nurl = "https://homie.rocks/mcp"\n');
  assert.equal(connectorClash({ app: 'grok', env: { HOME: p.home }, cwd: p.cwd }), null);
  writeFileSync(join(p.cwd, '.grok', 'config.toml'), '[mcp_servers.homie]\ncommand = "node"\n');
  assert.equal(connectorClash({ app: 'grok', env: { HOME: p.home }, cwd: p.cwd }).where, `this folder's ${['.grok', 'config.toml'].join('/')}`);
  // A local directory (the tests' own) is Homie's address too; Claude Code keeps a plugin's servers apart, so it is never read.
  writeFileSync(join(p.cwd, '.grok', 'config.toml'), '[mcp_servers.homie]\nurl = "https://homie.test/mcp"\n');
  assert.equal(connectorClash({ app: 'grok', env: { HOME: p.home }, cwd: p.cwd, directory: 'https://homie.test/' }), null);
  assert.equal(connectorClash({ app: 'claude', env: { HOME: p.home }, cwd: p.cwd }), null);
});

test('which app: the one the AI names, else what the app\'s own environment shows, else nobody\'s guess', () => {
  assert.equal(sessionApp(null, {}), null);
  assert.equal(sessionApp('grok', {}), 'grok');
  assert.equal(sessionApp('Grok-Bot', { CLAUDECODE: '1' }), 'grok', 'what the AI says wins');
  assert.equal(sessionApp(null, { HOMIE_CLIENT: 'codex' }), 'codex');
  assert.equal(sessionApp(null, { CLAUDECODE: '1' }), 'claude');
  for (const k of ['CODEX_THREAD_ID', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_CI']) assert.equal(sessionApp(null, { [k]: '1' }), 'codex', k);
  assert.equal(sessionApp('someone-else', {}), null);
});

test('Homie\'s holds: off with no mark, on with the mark the plugin\'s hooks leave, off again when it is old; only in Codex and Grok Build', async () => {
  const p = place('holds');
  const t0 = Date.UTC(2026, 9, 4, 3, 0, 0);
  // Never run: off, with how to turn them on, as a thing to do now that blocks nothing.
  let r = await status(p, { client: 'codex', connector: 'yes', nowMs: t0 });
  assert.deepEqual(r.rows.map((x) => x.id).slice(0, 3), ['node', 'connector', 'holds'], 'the row sits with the connector');
  let h = row(r, 'holds');
  assert.equal(h.on, false);
  assert.equal(h.state, 'act');
  assert.equal(h.app, 'codex');
  assert.match(h.detail, /^off: Homie's hooks have not run in Codex on this computer$/);
  assert.match(h.fix.say, /open \/hooks and trust Homie's three hooks: Codex runs no plugin's hooks until you do/);
  assert.match(h.fix.say, /Until then nothing is held, so your AI asks you before each of those itself/);
  assert.match(h.unlocks, /"proceed <code>" before a production deploy/);
  assert.deepEqual(r.blocking, []);
  assert.ok(r.next.some((n) => n.id === 'holds'));
  assert.match(formatStatus(r), /→ Homie's holds +\(recommended\) off: /);

  // The hooks ran: the plugin's own `mark`, in the folder the toolkit reads (the same default on both sides).
  assert.equal(marksDir({}).endsWith(join('.cache', 'homie-studio', 'holds')), true);
  assert.equal(await mark('codex', 'pre', { dir: p.marks, now: t0 - 4000 }), true);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(p.marks, 'codex.json'), 'utf8'))).sort(), ['app', 'at', 'event', 'v'], 'the app, the time and the hook: no folder, no session, no call');
  assert.deepEqual(holdsMark('codex', { env: { HOME: p.home }, now: t0 }), { at: t0 - 4000, event: 'pre', ageMs: 4000 });
  r = await status(p, { client: 'codex', connector: 'yes', nowMs: t0 });
  h = row(r, 'holds');
  assert.equal(h.on, true);
  assert.equal(h.state, 'ok');
  assert.equal(h.fix, null);
  assert.equal(h.detail, "on: Homie's hooks ran in Codex 4 s ago");
  assert.equal(h.seen.event, 'pre');
  assert.ok(!r.next.some((n) => n.id === 'holds'));

  // Codex's hooks say nothing about Grok's: Grok has its own mark. Grok runs a plugin's hooks once the plugin is
  // trusted, so off is the person's to fix there too, with the command that does it; nothing says Grok runs none.
  r = await status(p, { client: 'grok', connector: 'yes', nowMs: t0 });
  h = row(r, 'holds');
  assert.equal(h.on, false);
  assert.equal(h.state, 'act');
  assert.equal(h.detail, "off: Homie's hooks have not run in Grok on this computer");
  assert.match(h.fix.say, /^Grok runs a plugin's hooks only once the plugin is trusted/);
  assert.match(h.fix.say, /grok plugin install homie-rocks\/homie#plugins\/homie --trust/);
  assert.match(h.fix.say, /Until then nothing is held, so your AI asks you before each of those itself/);
  assert.doesNotMatch(JSON.stringify(h), /runs no plugin's hooks|1\.0\.41|Nothing to do on your side/);
  assert.ok(r.next.some((n) => n.id === 'holds'));
  // Grok's hooks leave the mark as Codex's do, and the row reads it the same way.
  await mark('grok', 'prompt', { dir: p.marks, now: t0 - 4000 });
  h = row(await status(p, { client: 'grok', connector: 'yes', nowMs: t0 }), 'holds');
  assert.deepEqual([h.on, h.state, h.fix, h.detail], [true, 'ok', null, "on: Homie's hooks ran in Grok 4 s ago"]);

  // An old mark is not "now": hooks that stopped running (trust taken back, a changed hook) read as off.
  h = row(await status(p, { client: 'codex', connector: 'yes', nowMs: t0 + HOLDS_FRESH_MS + 60_000 }), 'holds');
  assert.equal(h.on, false);
  assert.match(h.detail, /^off: Homie's hooks last ran in Codex 11 min ago, and not for this session's calls$/);

  // HOMIE_HOLDS_MARKS moves the folder; a mark that is not one is no mark.
  const other = join(scratch, 'holds', 'other-marks');
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, 'codex.json'), 'not json');
  assert.equal(holdsMark('codex', { env: { HOME: p.home, HOMIE_HOLDS_MARKS: other }, now: t0 }), null);
  assert.equal(holdsMark('../codex', { env: { HOME: p.home }, now: t0 }), null);

  // Claude Code has its mod, and an app nobody named has no row at all.
  assert.equal(row(await status(p, { connector: 'yes', nowMs: t0 }, { CLAUDECODE: '1' }), 'holds'), undefined);
  assert.equal(row(await status(p, { connector: 'yes', nowMs: t0 }), 'holds'), undefined);
});

test('the command line: setup status --client codex --connector no, as an AI in Codex runs it before a studio exists', () => {
  const p = place('cli');
  const r = spawnSync(process.execPath, [CLI, 'setup', 'status', '--connector', 'no', '--client', 'codex', '--homie', 'http://127.0.0.1:9', '--json'], {
    cwd: p.cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: p.home },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.deepEqual(out.blocking, []);
  assert.equal(out.rows.find((x) => x.id === 'holds').on, false);
  assert.equal(out.rows.find((x) => x.id === 'connector').state, 'act');
  const usage = readFileSync(CLI, 'utf8').split('*/')[0];
  assert.match(usage, /homie-studio setup status \[--connector yes\|no\] \[--client claude\|codex\|grok\]/);
});

test('demo with no network: the arcade\'s standing first pick, said as not reached, and still a link to give', async () => {
  const offline = () => { const e = new TypeError('fetch failed'); e.cause = Object.assign(new Error('getaddrinfo ENOTFOUND arcade.homie.rocks'), { code: 'ENOTFOUND' }); return e; };
  const down = await demoGames({ fetchFn: async () => { throw offline(); } });
  assert.equal(down.ok, true);
  assert.equal(down.reached, false);
  assert.equal(down.pick.play, DEMO_FALLBACK.play);
  assert.equal(down.pick.play, 'https://arcade.homie.rocks/asteroids-arena/play', 'the address the studio-setup skill names');
  assert.match(down.note, /this session could not reach the arcade just now \(could not look up arcade\.homie\.rocks \(ENOTFOUND\)\)/);
  assert.match(down.note, /opens in the person's own browser all the same/);
  assert.match(formatDemo(down), /Play: https:\/\/arcade\.homie\.rocks\/asteroids-arena\/play/);
  // The arcade answered, with an error: that is the arcade's, and nothing is promised about the link.
  const refused = await demoGames({ fetchFn: async () => new Response('no', { status: 503 }) });
  assert.equal(refused.reached, false);
  assert.match(refused.note, /the arcade did not give its list just now \(.*answered 503\)/);
  assert.doesNotMatch(refused.note, /all the same/);
  // Reached: no note.
  const site = 'https://arcade.test';
  const up = await demoGames({ studio: site, fetchFn: async (url) => new Response(JSON.stringify(String(url).endsWith('/api/rooms') ? { rooms: [] } : { name: 'Homie Arcade', games: [{ id: 'bone-burglar', name: 'Bone Burglar', play: `${site}/bone-burglar/play` }] })) });
  assert.equal(up.reached, true);
  assert.equal(up.note, undefined);
});

test('a note to Homie from Grok says Grok', () => {
  assert.ok(FEEDBACK_APPS.includes('grok'));
  assert.equal(APP_LABEL.grok, 'Grok');
  assert.equal(appOf({ name: 'grok-build', version: '1.0.41' }), 'grok');
  assert.equal(appOf({ name: 'Grok' }), 'grok');
  assert.equal(appOf({ name: 'codex-mcp-client' }), 'codex');
  assert.equal(appOf({ name: 'claude-code' }), 'claude-code');
  assert.equal(appOf({ name: 'something-else' }), 'other');
  const c = cleanNote({ kind: 'confusing', text: 'The first step stopped before anything was made.', step: 'studio-setup', app: 'grok', offered: true });
  assert.equal(c.ok, true);
  assert.equal(c.note.app, 'grok');
  assert.match(withLine(c.note), /the step \(studio-setup\) · Grok · that Claude offered it/);
});
