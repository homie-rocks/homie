/**
 * The plugin's manifests agree with each other and with what is in the folder: the
 * Claude Code and Codex marketplaces list the same plugin at the same path, its plugin
 * manifests (Claude Code, Codex, Grok, and the agent-plugins one) say the same
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

test('the Grok plugin manifest agrees with plugin.json, and its skills, MCP server and hooks exist', () => {
  const standard = json(join(PLUGIN, 'plugin.json'));
  const grok = json(join(PLUGIN, '.grok-plugin', 'plugin.json'));
  for (const k of ['name', 'version', 'description', 'homepage', 'repository', 'license', 'keywords', 'author']) {
    assert.deepEqual(grok[k], standard[k], `.grok-plugin/plugin.json and plugin.json agree on ${k}`);
  }
  for (const p of [grok.skills, grok.mcpServers, grok.hooks]) {
    assert.ok(existsSync(join(PLUGIN, p)), `.grok-plugin/plugin.json names ${p}, which exists`);
  }
  assert.equal(json(join(PLUGIN, grok.mcpServers)).mcpServers.homie.url, MCP_URL);
  const hooks = json(join(PLUGIN, grok.hooks));
  const commands = JSON.stringify(hooks.hooks);
  assert.match(commands, /hooks\/grok\.mjs/);
  assert.match(readFileSync(join(PLUGIN, 'hooks', 'grok.mjs'), 'utf8'), /from '\.\/lib\/holds\.mjs'|from '\.\/codex\.mjs'/);
  assert.match(readFileSync(join(PLUGIN, 'hooks', 'lib', 'holds.mjs'), 'utf8'), /hooks\/grok\.mjs/);
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

test('a command an agent would need is named in the guide it reads, and the name is one the code really takes', () => {
  // ACROSS THE SEAM: a guide's words on one side, the command's own dispatch on the other. A creator's agent never
  // guesses a command: it reads the guide (or, with no terminal, hands the same words to the studio_run tool).
  const skill = (name) => readFileSync(join(PLUGIN, 'skills', name, 'SKILL.md'), 'utf8');
  const code = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
  const cli = code('packages', 'studio', 'bin', 'homie-studio.mjs');
  const rows = [
    ['game', /homie-studio shoot <id> --preview/, cli, /cmd === 'shoot'[\s\S]{0,400}flags\.has\('preview'\)/],
    ['game', /homie-studio preview <id>/, cli, /cmd === 'preview'/],
    ['game', /homie-studio dev --timestamps/, cli, /timestamps: flags\.has\('timestamps'\)/],
    ['game', /homie-studio build --types/, cli, /types: flags\.has\('types'\)/],
    ['models', /homie-studio assets use <id> <asset> unused/, code('packages', 'studio', 'lib', 'art-cli.mjs'), /verb === 'use'/],
    ['models', /models\.mjs> import <id>/, code('plugins', 'homie', 'skills', 'models', 'scripts', 'models.mjs'), /cmd === 'import'/],
    ['playtest', /playtest\.mjs> review <folder> --local/, code('plugins', 'homie', 'skills', 'playtest', 'scripts', 'playtest.mjs'), /flags\.has\('local'\)[\s\S]{0,2500}REVIEW-LOCAL\.md/],
    ['playtest', /playtest\.mjs> reviewed <folder> --kind/, code('plugins', 'homie', 'skills', 'playtest', 'scripts', 'playtest.mjs'), /command: 'reviewed'/],
  ];
  for (const [guide, said, source, taken] of rows) {
    assert.match(skill(guide), said, `the ${guide} guide names it`);
    assert.match(source, taken, `and the code takes it (${said})`);
  }
  // With no terminal: the one tool that runs any studio command by its words gives these as examples, and the two
  // collision commands have tools of their own beside the asset tools.
  const tools = code('packages', 'studio', 'lib', 'mcp-tools.mjs');
  assert.match(tools, /name: 'studio_run'[\s\S]{0,900}\["shoot","<id>","--preview"\], \["build","--types"\], \["assets","use","<id>","<asset>","unused"\]/);
  const art = code('packages', 'studio', 'lib', 'art-tools.mjs');
  for (const name of ['collision_bake', 'collision_check']) assert.match(art, new RegExp(`name: '${name}'`));
});
