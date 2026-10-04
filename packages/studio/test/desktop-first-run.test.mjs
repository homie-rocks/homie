/**
 * A first run in the Claude desktop app (0.30.1), from one filmed on 2026-10-03: the app asks before every Homie
 * tool and can hide a request behind a card, the deploy plan's card stayed on "Loading", twenty single edits to
 * one file ran a first build into the app's per-turn tool limit, and a second studio's setup card led with the
 * first one. What is Homie's to fix is checked here: the words the extension gives the model (only where
 * HOMIE_STUDIO_EXTENSION=1 says it runs in the desktop app), the cards in a real browser through a stand-in host
 * (test/card-host.mjs), file_edit's several replacements in one call, and setup_status for a studio not made yet.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromeArgs, findChrome } from '../lib/chrome.mjs';
import { cardHost, mcpServer } from './card-host.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const REPO = join(PKG, '..', '..');
const SKILLS = join(REPO, 'plugins', 'homie', 'skills');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-first-run-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
// The stand-in host's requests give up after this long (and the process may end once they have).
process.env.HOMIE_MCP_TEST_WAIT_MS ??= '45000';
const HOME = join(scratch, 'home');
mkdirSync(HOME, { recursive: true });

/** A `homie-studio mcp` server as a host starts it; `extension: true` is the desktop extension's own environment. */
async function server(studios, { extension = false, client = 'test' } = {}) {
  const env = { HOME, HOMIE_MCP_WAIT_MS: '20000', HOMIE_STUDIO_EXTENSION: extension ? '1' : '' };
  const s = mcpServer(process.execPath, [CLI, 'mcp', '--studios', studios, '--no-install', '--homie', 'https://homie.test'], { cwd: scratch, env });
  const init = (await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: client, version: '1' } })).result;
  const call = async (name, args = {}) => (await s.request('tools/call', { name, arguments: args })).result;
  return { ...s, init, call };
}

/** The toolkit linked into a studio as npm install would leave it (no network in tests). */
function link(root) {
  mkdirSync(join(root, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(root, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(root, 'node_modules', 'esbuild'));
}

const SAID = /Always allow/;
const KEYS = /Cmd\+Return on a Mac \(Ctrl\+Enter on Windows\)/;

test('in the Claude desktop app the model is told, once, what the app asks the person; nowhere else', async () => {
  const studios = join(scratch, 'told');
  const s = await server(studios, { extension: true, client: 'claude-ai' });
  try {
    // As it connects, in the guide it reads first, and in whatever opens a new studio.
    for (const [where, text] of [
      ['the server\'s instructions', s.init.instructions],
      ['the studio-setup guide', (await s.call('studio_guide', { topic: 'studio-setup' })).content[0].text],
      ['the game guide', (await s.call('studio_guide', { topic: 'game' })).content[0].text],
      ['setup status before a studio', (await s.call('setup_status')).content[0].text],
      ['the new studio', (await s.call('studio_scaffold', { name: 'Night Owls' })).content[0].text],
    ]) {
      assert.match(text, SAID, `${where} names Always allow`);
      assert.match(text, KEYS, `${where} names the key that answers a request nobody can see`);
      assert.match(text, /ONCE in a chat[\s\S]*skip it if you already said it/, `${where} says it is said once`);
      assert.match(text, /write one short line of text before your next tool call/, `${where} keeps a card and the next request apart`);
    }
    assert.match(s.init.instructions, /never ahead/, 'the checklist is still there');
    // Past a new studio's first minutes the setup card stops carrying it (the guides and the instructions still do).
    assert.ok(!(await s.call('game_plan', { id: 'moon-relay', name: 'Moon Relay' })).isError);
    const later = await s.call('setup_status');
    assert.equal(later.structuredContent.checklist.find((x) => x.state === 'now').n, 5);
    assert.doesNotMatch(later.content[0].text, SAID);
    // A reference file is the guide's own text, as it is.
    assert.doesNotMatch((await s.call('studio_guide', { topic: 'plan', file: 'INTERVIEW.md' })).content[0].text, SAID);
  } finally { await s.close(); }

  // The same server anywhere else (Claude Code, Codex, Grok, any MCP client, and the desktop app's own client name
  // without the extension's environment): not a word of it, because it is not true there.
  for (const client of ['claude-code', 'codex', 'grok', 'claude-ai']) {
    const plain = await server(join(scratch, `plain-${client}`), { client });
    try {
      const texts = [
        plain.init.instructions,
        (await plain.call('studio_guide', { topic: 'studio-setup' })).content[0].text,
        (await plain.call('setup_status')).content[0].text,
        (await plain.call('studio_scaffold', { name: 'Night Owls' })).content[0].text,
      ];
      for (const t of texts) { assert.doesNotMatch(t, SAID, client); assert.doesNotMatch(t, /Cmd\+Return|desktop app: it asks/, client); }
      assert.match(texts[1], /call the tool of the same job/, 'the note every local client gets is still there');
    } finally { await plain.close(); }
  }
});

test('the desktop section of the README, the install steps and the install screen say it; the shared guides never do', () => {
  const readme = readFileSync(join(REPO, 'README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('## In the Claude desktop app: one chat'), readme.indexOf('## From the Claude app on a phone'));
  assert.match(section, /\*\*\s*Always allow\s*\*\*/);
  assert.match(section, /a request is waiting out of sight/);
  assert.equal(readme.split('Always allow').length - 1, 1, 'only in the desktop section');
  const install = readFileSync(join(REPO, 'desktop', 'README.md'), 'utf8');
  assert.match(install, /Choose \*\*Always allow\*\*/);
  assert.match(install, /a\s+request is waiting out of sight/);
  const manifest = JSON.parse(readFileSync(join(REPO, 'desktop', 'manifest.json'), 'utf8'));
  assert.match(manifest.long_description, /choose Always allow/);
  assert.equal(manifest.server.mcp_config.env.HOMIE_STUDIO_EXTENSION, '1', 'how the server knows it runs in the desktop app');
  // The guides are read in Claude Code, Codex and Grok too, where nothing asks before every tool.
  for (const d of readdirSync(SKILLS, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    assert.doesNotMatch(readFileSync(join(SKILLS, d.name, 'SKILL.md'), 'utf8'), /Always allow|Cmd\+Return/, `${d.name}/SKILL.md`);
  }
});

test('file_edit takes every change to a file in one call, all or none; the guides ask for few, large edits', async () => {
  const studios = join(scratch, 'edits');
  const s = await server(studios);
  try {
    assert.ok(!(await s.call('studio_scaffold', { name: 'Night Owls' })).isError);
    const root = join(studios, 'night-owls');
    const file = 'posts/2026-10-03-night-owls.md';
    const text = '---\ntitle: Hello\nsummary: A game is coming.\n---\n\nGems are gold. Gems are round.\nRivals bump you.\n';
    assert.ok(!(await s.call('file_write', { path: file, content: text })).isError);
    const tool = (await s.request('tools/list', {})).result.tools.find((t) => t.name === 'file_edit');
    assert.deepEqual(tool.inputSchema.required, ['path']);
    assert.equal(tool.inputSchema.properties.edits.type, 'array');
    assert.match(tool.description, /ONE call/);

    // Three changes, one call (one request for the person to allow, not three).
    const many = await s.call('file_edit', { path: file, edits: [
      { old: 'title: Hello', new: 'title: Night Owls' },
      { old: 'Gems', new: 'Moons', all: true },
      { old: 'Rivals bump you.', new: 'Owls bump you.' },
    ] });
    assert.ok(!many.isError, many.content[0].text);
    assert.match(many.content[0].text, /4 places, 3 edits in one call/);
    const after = readFileSync(join(root, file), 'utf8');
    assert.equal(after, text.replace('title: Hello', 'title: Night Owls').replaceAll('Gems', 'Moons').replace('Rivals bump you.', 'Owls bump you.'));

    // A miss anywhere changes nothing, and says which edit it was.
    const miss = await s.call('file_edit', { path: file, edits: [{ old: 'Moons are gold.', new: 'Moons are silver.' }, { old: 'not in the file', new: 'x' }, { old: 'Owls', new: 'Bats' }] });
    assert.equal(miss.isError, true);
    assert.match(miss.content[0].text, /edit 2 of 3 \("not in the file"\)[\s\S]*nothing was changed/);
    assert.equal(readFileSync(join(root, file), 'utf8'), after, 'the file is as it was');
    const twice = await s.call('file_edit', { path: file, edits: [{ old: 'Moons', new: 'Stars' }, { old: 'Owls bump you.', new: 'x' }] });
    assert.match(twice.content[0].text, /edit 1 of 2[\s\S]*2 times/);
    assert.equal(readFileSync(join(root, file), 'utf8'), after);

    // One change, as before; and neither shape is refused with the shape to use.
    const one = await s.call('file_edit', { path: file, old: 'Owls bump you.', new: 'Owls nudge you.' });
    assert.ok(!one.isError, one.content[0].text);
    assert.match(one.content[0].text, /\(1 place\)/);
    assert.equal((await s.call('file_edit', { path: file })).isError, true);

    // The words that led to twenty single edits now ask for one.
    link(root);
    const made = await s.call('game_make', { id: 'moon-relay', name: 'Moon Relay' });
    assert.ok(!made.isError, made.content[0].text);
    assert.match(made.content[0].text, /ONE file_edit with an edits list \(never a call per change/);
    const guide = (await s.call('studio_guide', { topic: 'game' })).content[0].text;
    assert.match(guide, /make every change it needs in ONE file_edit/);
    assert.match(guide, /few, large\s+edits/);
    assert.doesNotMatch(guide, /in small steps:/);
    assert.match(s.init.instructions, /one file_edit carries every change to a file in its edits list/);
    assert.match((await s.call('game_plan', { id: 'owl-post', name: 'Owl Post' })).content[0].text, /fill CODEX\.md in one call/);
  } finally { await s.close(); }
});

test('setup_status for a studio that is not made yet is that studio\'s checklist, never another studio\'s', async () => {
  const studios = join(scratch, 'second');
  const s = await server(studios);
  try {
    assert.ok(!(await s.call('studio_scaffold', { name: 'Paper Comets' })).isError);
  } finally { await s.close(); }
  // A new chat (a new server): one studio is in the folder, and the person asks for another.
  const again = await server(studios);
  try {
    const unnamed = await again.call('setup_status');
    assert.equal(unnamed.structuredContent.current.name, 'Paper Comets', 'with no name, the only studio there is');
    const fresh = await again.call('setup_status', { studio: 'Night Owls' });
    assert.ok(!fresh.isError, fresh.content[0].text);
    assert.equal(fresh.structuredContent.current, null);
    assert.equal(fresh.structuredContent.wanted, 'Night Owls');
    assert.equal(fresh.structuredContent.checklist.find((x) => x.state === 'now').n, 1, 'the studio is the next step');
    assert.match(fresh.content[0].text, /^No studio called "Night Owls" yet/);
    assert.match(fresh.content[0].text, /New studio: Night Owls/);
    assert.doesNotMatch(fresh.content[0].text, /Studio: Paper Comets/);
    assert.match(again.init.instructions, /for a studio that is not made yet, pass its name as studio/);
    // Once it is made, its name is its own studio; an existing one is still found by its name or folder.
    assert.ok(!(await again.call('studio_scaffold', { name: 'Night Owls' })).isError);
    assert.equal((await again.call('setup_status', { studio: 'Night Owls' })).structuredContent.current.name, 'Night Owls');
    assert.equal((await again.call('setup_status', { studio: 'paper-comets' })).structuredContent.current.name, 'Paper Comets');
    assert.equal((await again.call('setup_status', { studio: 'Paper Comets' })).structuredContent.wanted, null);
  } finally { await again.close(); }
});

test('the deploy plan\'s card shows the plan, and no card stays on "Loading" once its tool answered', { skip: !findChrome() && 'no Chrome on this machine' }, async () => {
  const studios = join(scratch, 'plan');
  const s = await server(studios);
  let host;
  try {
    const puppeteer = (await import('puppeteer-core')).default;
    assert.ok(!(await s.call('studio_scaffold', { name: 'Night Owls' })).isError);
    link(join(studios, 'night-owls'));
    const tool = (await s.request('tools/list', {})).result.tools.find((t) => t.name === 'studio_deploy');
    assert.equal(tool._meta.ui.resourceUri, 'ui://homie-studio/build', 'the app draws the build card for every studio_deploy call');
    const plan = await s.call('studio_deploy', { plan: true });
    assert.ok(!plan.isError, plan.content[0].text);
    assert.match(plan.content[0].text, /What going online does for Night Owls/);
    host = await cardHost({ puppeteer, chrome: findChrome(), args: chromeArgs(), server: s, uri: 'ui://homie-studio/build', result: plan });
    const shown = await host.text();
    assert.doesNotMatch(shown, /Loading/, 'the card filled');
    assert.match(shown, /Night Owls/);
    assert.match(shown, /Worker/);
    assert.match(shown, /D1 database/);
    assert.match(shown, /Free/);
    assert.equal(await host.card.evaluate(() => document.querySelectorAll('.skel').length), 0, 'no grey skeleton is left');
    assert.deepEqual(host.errors, []);
    await host.close(); host = null;

    // Any other answer that is not the card's own (a job still running, say): its words, never the skeleton.
    const job = { content: [{ type: 'text', text: 'The studio\'s toolkit is still being installed (npm install, job j_1; usually 20 to 60 s).' }], structuredContent: { kind: 'job', job: 'j_1', label: 'npm install', state: 'running', seconds: 12 } };
    const words = { content: [{ type: 'text', text: 'Stopped the studio\'s site here.' }], structuredContent: { kind: 'preview', stopped: [1] } };
    host = await cardHost({ puppeteer, chrome: findChrome(), args: chromeArgs(), server: s, uri: 'ui://homie-studio/build', result: job });
    const other = await host.text();
    assert.doesNotMatch(other, /Loading/);
    assert.match(other, /npm install is still running \(12 s so far\)/);
    assert.equal(await host.card.evaluate(() => document.querySelectorAll('.skel').length), 0);
    assert.deepEqual(host.errors, []);
    await host.close(); host = null;
    host = await cardHost({ puppeteer, chrome: findChrome(), args: chromeArgs(), server: s, uri: 'ui://homie-studio/build', result: words });
    assert.match(await host.text(), /Stopped the studio's site here\./);
    assert.doesNotMatch(await host.text(), /Loading/);
    await host.close(); host = null;

    // The setup card of a studio that is not made yet is headed by its own name.
    const wanted = await s.call('setup_status', { studio: 'Quiet Moons' });
    host = await cardHost({ puppeteer, chrome: findChrome(), args: chromeArgs(), server: s, uri: 'ui://homie-studio/setup', result: wanted });
    assert.equal(await host.card.evaluate(() => document.querySelector('h1').textContent), 'Quiet Moons');
    assert.match(await host.text(), /New studio[\s\S]*Not made yet/);
    assert.deepEqual(host.errors, []);
  } finally { if (host) await host.close(); await s.close(); }
});
