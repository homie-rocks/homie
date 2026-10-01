/**
 * The plugin's manifests agree with each other and with what is in the folder: the
 * Claude Code and Codex marketplaces list the same plugin at the same path, its two
 * plugin manifests (Claude Code, and the agent-plugins one Codex reads) say the same
 * name, version and description, both MCP configurations point at the Homie MCP
 * server, and every skill folder has a SKILL.md whose name is the folder's and whose
 * relative references exist. `claude plugin validate` checks each file's shape; this
 * checks that they say the same thing.
 *
 * Run: node --test plugins/homie/test/manifests.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(PLUGIN, '..', '..');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const MCP_URL = 'https://homie.rocks/mcp';

test('both marketplaces list the homie plugin at ./plugins/homie, at the plugin\'s version', () => {
  const claude = json(join(ROOT, '.claude-plugin', 'marketplace.json'));
  const codex = json(join(ROOT, '.agents', 'plugins', 'marketplace.json'));
  const plugin = json(join(PLUGIN, '.claude-plugin', 'plugin.json'));
  assert.equal(claude.name, 'homie');
  assert.equal(codex.name, 'homie');
  const c = claude.plugins.find((p) => p.name === 'homie');
  const x = codex.plugins.find((p) => p.name === 'homie');
  assert.ok(c && x, 'each marketplace lists the homie plugin');
  assert.equal(c.source, './plugins/homie');
  assert.deepEqual(x.source, { source: 'local', path: './plugins/homie' });
  assert.equal(c.version, plugin.version, 'the Claude Code marketplace entry names the plugin\'s version');
  assert.equal(c.license, plugin.license);
});

test('the Claude Code and Codex plugin manifests agree', () => {
  const claude = json(join(PLUGIN, '.claude-plugin', 'plugin.json'));
  const codex = json(join(PLUGIN, 'plugin.json'));
  for (const k of ['name', 'version', 'description', 'homepage', 'repository', 'license', 'keywords', 'author']) {
    assert.deepEqual(codex[k], claude[k], `plugin.json and .claude-plugin/plugin.json agree on ${k}`);
  }
  assert.match(claude.version, /^\d+\.\d+\.\d+$/);
  assert.equal(claude.license, 'Apache-2.0');
});

test('the .codex-plugin manifest agrees with plugin.json, and its paths and icon exist', () => {
  const standard = json(join(PLUGIN, 'plugin.json'));
  const codex = json(join(PLUGIN, '.codex-plugin', 'plugin.json'));
  for (const k of ['name', 'version', 'description', 'homepage', 'repository', 'license', 'keywords', 'author']) {
    assert.deepEqual(codex[k], standard[k], `.codex-plugin/plugin.json and plugin.json agree on ${k}`);
  }
  const { composerIcon, logo, ...rest } = codex.interface;
  assert.deepEqual(rest, standard.extensions['com.openai'].interface, 'the same interface as plugin.json\'s com.openai extension');
  for (const p of [codex.skills, codex.mcpServers, composerIcon, logo]) {
    assert.ok(existsSync(join(PLUGIN, p)), `.codex-plugin/plugin.json names ${p}, which exists`);
  }
  assert.equal(json(join(PLUGIN, codex.mcpServers)).mcpServers.homie.url, MCP_URL);
});

test('both MCP configurations point at the Homie MCP server', () => {
  const claude = json(join(PLUGIN, '.mcp.json'));
  const codex = json(join(PLUGIN, 'mcp.json'));
  assert.equal(claude.mcpServers.homie.url, MCP_URL);
  assert.equal(codex.mcpServers.homie.url, MCP_URL);
  assert.equal(json(join(PLUGIN, '.claude-plugin', 'plugin.json')).mcpServers, './.mcp.json');
});

test('every skill has a SKILL.md named for its folder, and its relative references exist', () => {
  const skills = readdirSync(join(PLUGIN, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(skills.length > 0);
  for (const skill of skills) {
    const file = join(PLUGIN, 'skills', skill, 'SKILL.md');
    assert.ok(existsSync(file), `skills/${skill}/SKILL.md`);
    const text = readFileSync(file, 'utf8');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(front, `skills/${skill}/SKILL.md starts with frontmatter`);
    assert.match(front[1], new RegExp(`^name: ${skill}$`, 'm'), `skills/${skill}: name is the folder's`);
    assert.match(front[1], /^description: .{40,}/m, `skills/${skill}: has a description`);
    for (const line of text.split('\n')) {
      // A reference is this skill's own file, or another skill's when the line names that skill (`port` skill: `references/X.md`).
      const owners = [skill, ...[...line.matchAll(/`([a-z-]+)` skill/g)].map((m) => m[1])];
      for (const [, ref] of line.matchAll(/`((?:references|scripts)\/[A-Za-z0-9_./-]+\.[a-z]+)`/g)) {
        assert.ok(owners.some((o) => existsSync(join(PLUGIN, 'skills', o, ref))), `skills/${skill}/SKILL.md names ${ref}, which exists`);
      }
    }
  }
});
