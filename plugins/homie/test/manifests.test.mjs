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

/*
 * WHICH HOOKS FILE GROK IS GIVEN. Grok takes a plugin's hooks file from the plugin's ROOT plugin.json, and with
 * none named there it loads hooks/hooks.json. Ours is the Claude Code mod's ({ "modules": [...] }, no "hooks"
 * object), so a root manifest that names no hooks hands Grok a file it registers nothing from: no hold ran in Grok,
 * and 0.30.2 put that down to Grok.
 */
test('the root plugin.json names the hooks file Grok runs, and Grok is never given the Claude Code mod\'s hooks.json', () => {
  const root = json(join(PLUGIN, 'plugin.json'));
  assert.equal(typeof root.hooks, 'string', 'the root plugin.json names a hooks file: without one Grok falls back to hooks/hooks.json');
  const named = join(PLUGIN, root.hooks);
  assert.ok(existsSync(named), `plugin.json names ${root.hooks}, which exists`);
  assert.notEqual(join(PLUGIN, root.hooks), join(PLUGIN, 'hooks', 'hooks.json'), 'never the Claude Code mod\'s file');
  assert.equal(root.hooks, json(join(PLUGIN, '.grok-plugin', 'plugin.json')).hooks, 'the same file .grok-plugin/plugin.json names');
  const file = json(named);
  assert.ok(file.hooks && typeof file.hooks === 'object' && !Array.isArray(file.hooks), 'it has a "hooks" object');
  for (const event of ['PreToolUse', 'UserPromptSubmit', 'PostToolUse']) {
    const handlers = (file.hooks[event] ?? []).flatMap((g) => g.hooks ?? []);
    assert.ok(handlers.length, `${event} has a handler`);
    for (const h of handlers) {
      assert.equal(h.type, 'command');
      assert.match(h.command, /^node "\$\{GROK_PLUGIN_ROOT\}\/hooks\/grok\.mjs" (pre|prompt|post)$/, 'run from the folder Grok installed the plugin in');
      // Grok kills a hook after 5 s unless told otherwise, and a killed hook lets the call through.
      assert.ok(Number(h.timeout) >= 10, `${event}: a timeout of its own`);
    }
  }
  // The matcher is tested against the tool's real name: Grok's own shell and edit tools, and server__tool for MCP
  // (a server's name may itself have an underscore).
  const matcher = new RegExp(file.hooks.PreToolUse[0].matcher);
  for (const name of ['run_terminal_command', 'Bash', 'search_replace', 'Edit', 'Write', 'homie__studio_deploy', 'homie-rocks__studio_deploy', 'cloudflare_bindings__workers_delete', 'mcp__homie__studio_deploy']) assert.match(name, matcher);
  for (const name of ['read_file', 'grep', 'list_dir', 'web_search']) assert.doesNotMatch(name, matcher);
  // What Grok falls back to with no hooks named is the mod's file, which has nothing Grok can register.
  const mod = json(join(PLUGIN, 'hooks', 'hooks.json'));
  assert.equal(mod.hooks, undefined, 'hooks/hooks.json is the Claude Code mod (modules), with no "hooks" object');
  assert.ok(Array.isArray(mod.modules));
  // Codex still reads its hooks from its own manifest, and the root one declares no $schema (Codex would then read
  // it, and run none of the plugin's hooks).
  assert.equal(root.$schema, undefined);
  assert.equal(json(join(PLUGIN, '.codex-plugin', 'plugin.json')).hooks, './hooks/codex.json');
  assert.equal(root.extensions['com.openai'].hooks, './hooks/codex.json');
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
