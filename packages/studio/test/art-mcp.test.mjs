/**
 * The art tools and cards of the local MCP (lib/art-tools.mjs, mcp/ui/{style,decision,cast,lineup,rights}.js): the
 * tools are listed with their cards, decision_set answers a locked change with its blast radius and changes nothing
 * until confirm, the cards are served whole; and, where this computer has Chrome, the style board card is pressed in a
 * real browser through a stand-in host (test/card-host.mjs): Lock is the person's, recorded, and the model is told.
 * Run: node --test packages/studio/test/art-mcp.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cardHost, mcpServer } from './card-host.mjs';
import { findChrome, chromeArgs } from '../lib/chrome.mjs';
import { readDecisions } from '../lib/decisions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const SKILLS = join(PKG, '..', '..', 'plugins', 'homie', 'skills');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-art-mcp-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function studio(name) {
  const dir = join(scratch, name);
  const run = (...a) => spawnSync(process.execPath, [CLI, ...a, '--json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(spawnSync(process.execPath, [CLI, 'new', dir, '--name', 'Fox Den', '--homie', 'https://homie.test', '--no-install', '--json'], { encoding: 'utf8' }).status, 0);
  assert.equal(run('codex', 'new', 'fox-grove', '--name', 'Fox Grove').status, 0);
  assert.equal(run('style', 'init', 'fox-grove', '--prompt', 'a cozy low-poly forest where foxes gather berries').status, 0);
  return dir;
}

async function server(dir) {
  const s = mcpServer(process.execPath, [CLI, 'mcp', '--studios', scratch, '--no-install', '--skills', SKILLS], { cwd: dir });
  await s.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  return s;
}
const call = async (s, name, args) => (await s.request('tools/call', { name, arguments: args })).result;

test('art tools: listed with their cards; a locked change shows its blast radius first and changes only on confirm', async () => {
  const dir = studio('tools');
  const s = await server(dir);
  try {
    const tools = (await s.request('tools/list', {})).result.tools;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const [name, card] of [['style_explore', 'style'], ['style_board', 'style'], ['decision_set', 'decision'], ['assets_plan', 'cast'], ['assets_find', 'cast'], ['asset_add', 'cast'], ['asset_make', 'lineup'], ['asset_lineup', 'lineup'], ['asset_rights', 'rights']]) {
      assert.ok(byName[name], `${name} is listed`);
      assert.equal(byName[name]._meta.ui.resourceUri, `ui://homie-studio/${card}`);
    }
    assert.ok(byName.asset_check, 'asset_check is listed');
    assert.match(byName.asset_make.description, /OWN fal account/);
    const board = await call(s, 'style_board', { game: 'fox-grove' });
    assert.equal(board.structuredContent.kind, 'style');
    assert.match(board.content[0].text, /Look: flat low-poly/);
    const lock = await call(s, 'decision_set', { game: 'fox-grove', decision: 'style.palette', lock: true, words: 'keep that palette', by: 'person' });
    assert.equal(lock.structuredContent.record.state, 'locked');
    const refused = await call(s, 'decision_set', { game: 'fox-grove', decision: 'style.palette', value: 'neon-dusk' });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /locked/);
    const pending = await call(s, 'decision_set', { game: 'fox-grove', decision: 'style.palette', value: 'neon-dusk', unlock: true, reason: 'the person wants neon' });
    assert.equal(pending.structuredContent.pending, true);
    assert.match(pending.content[0].text, /Not changed yet/);
    assert.equal(readDecisions(dir, 'fox-grove').decisions['style.palette'].value.name, 'autumn-grove');
    const done = await call(s, 'decision_set', { game: 'fox-grove', decision: 'style.palette', value: 'neon-dusk', unlock: true, reason: 'the person wants neon', confirm: true, by: 'person' });
    assert.equal(done.isError, undefined);
    assert.equal(readDecisions(dir, 'fox-grove').decisions['style.palette'].value.name, 'neon-dusk');
    const steer = await call(s, 'decision_set', { game: 'fox-grove', decision: 'style.camera', steer: 'closer', by: 'person' });
    assert.match(steer.content[0].text, /style\.camera: High three-quarter, \d+(\.\d+)? m away \(steered\)/);
    for (const uri of ['style', 'decision', 'cast', 'lineup', 'rights']) {
      const r = await s.request('resources/read', { uri: `ui://homie-studio/${uri}` });
      assert.match(r.result.contents[0].text, /<script>/, `${uri} card served`);
    }
  } finally { await s.close(); }
});

test('the style board card in a browser: Lock is the person\'s, recorded, and the model is told', { skip: !findChrome() && 'no Chrome on this machine' }, async () => {
  const dir = studio('card');
  const s = await server(dir);
  let host = null;
  try {
    const result = await call(s, 'style_board', { game: 'fox-grove' });
    const puppeteer = (await import('puppeteer-core')).default;
    host = await cardHost({ puppeteer, chrome: findChrome(), args: chromeArgs(), server: s, uri: 'ui://homie-studio/style', result });
    assert.match(await host.text(), /STYLE BOARD[\s\S]*Fox Grove[\s\S]*No board yet/i);
    // The first Lock in the list is the render style's.
    await host.press(/^Lock$/);
    await host.settle(1500);
    assert.equal(readDecisions(dir, 'fox-grove').decisions['style.render'].state, 'locked');
    assert.equal(readDecisions(dir, 'fox-grove').decisions['style.render'].by, 'person');
    assert.ok((await host.calls()).some((c) => c.name === 'decision_set' && c.arguments.lock === true && c.arguments.by === 'person'));
    assert.ok((await host.told()).some((t) => /The person locked style\.render/.test(t)));
    assert.match(await host.text(), /1 of 10 locked/);
    assert.deepEqual(host.errors, []);
  } finally { await host?.close(); await s.close(); }
});
