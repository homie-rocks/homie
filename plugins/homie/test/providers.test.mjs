/**
 * The providers' own tools, declared lazily: providers.json (which plugin.json points at) lists each provider's CLI,
 * plugin, MCP servers and skills, the skills that use them and what stays Homie's; each of those skills names its
 * providers in its own frontmatter, and a skill that uses a provider's MCP server declares it for Codex in
 * agents/openai.yaml. This checks that they all say the same thing, that every frontmatter is plain YAML a strict
 * reader takes (the Agent Skills fields only), and that the Homie mod's guards know every provider's paid and
 * account-changing tools. It reads files only: nothing is installed, signed in or called.
 *
 * Run: node --test plugins/homie/test/providers.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cloudflareMcpChangeOf, paidMcpOf, paidOf } from '../hooks/lib/commands.mjs';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const SKILLS = readdirSync(join(PLUGIN, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const registry = () => json(join(PLUGIN, json(join(PLUGIN, 'plugin.json')).extensions['rocks.homie'].providers));

/** A SKILL.md's frontmatter, read the strict way: top-level `key: value` (a plain or double-quoted scalar) and `metadata`'s one level of `key: value`. */
function frontmatter(skill) {
  const text = readFileSync(join(PLUGIN, 'skills', skill, 'SKILL.md'), 'utf8');
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)[1];
  const out = {};
  let map = null;
  for (const line of block.split('\n')) {
    const inner = /^ {2}([a-z][a-z0-9-]*): (.+)$/.exec(line);
    if (inner && map) { map[inner[1]] = inner[2]; continue; }
    const m = /^([a-z][a-z-]*):(?: (.*))?$/.exec(line);
    assert.ok(m, `skills/${skill}: "${line.slice(0, 60)}" is a key: value line`);
    const [, key, raw = ''] = m;
    if (raw === '') { map = {}; out[key] = map; continue; }
    map = null;
    if (raw.startsWith('"')) out[key] = JSON.parse(raw);
    else {
      // A plain scalar: a strict YAML reader refuses one holding ": " or " #", or starting with a sign of another type.
      assert.ok(!/: | #/.test(raw) && !/^[-?:,[\]{}#&*!|>'%@`]/.test(raw), `skills/${skill}: ${key} is plain YAML (quote it when it holds ": ")`);
      out[key] = raw;
    }
  }
  return out;
}

/** The MCP servers an agents/openai.yaml declares: [{ type, value, transport, url }]. */
function codexTools(skill) {
  const file = join(PLUGIN, 'skills', skill, 'agents', 'openai.yaml');
  if (!existsSync(file)) return [];
  const tools = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const item = /^\s*- type: "([^"]+)"$/.exec(line);
    if (item) { tools.push({ type: item[1] }); continue; }
    const kv = /^\s+(value|description|transport|url): "([^"]*)"$/.exec(line);
    if (kv) { tools[tools.length - 1][kv[1]] = kv[2]; continue; }
    assert.ok(/^(dependencies|  tools):$/.test(line), `skills/${skill}/agents/openai.yaml: unexpected line "${line}"`);
  }
  return tools;
}

test('plugin.json points at providers.json, a dated list loaded on use', () => {
  const plugin = json(join(PLUGIN, 'plugin.json'));
  for (const [ns, v] of Object.entries(plugin.extensions)) {
    assert.match(ns, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, `extensions.${ns} is a reverse-domain namespace`);
    assert.equal(typeof v, 'object');
  }
  assert.equal(plugin.extensions['rocks.homie'].providers, './providers.json');
  const r = registry();
  assert.equal(r.v, 1);
  assert.match(r.checked, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.load, 'on-use', 'nothing installs by itself');
  assert.deepEqual(Object.keys(r.providers).sort(), ['cloudflare', 'elevenlabs', 'fal', 'github', 'stripe', 'tripo']);
});

test('every provider names its account, its skills, its own tools on https, and what stays Homie\'s', () => {
  const urls = (v) => (typeof v === 'string' ? [...v.matchAll(/https?:\/\/[^\s),]+/g)].map((m) => m[0]) : Array.isArray(v) ? v.flatMap(urls) : v && typeof v === 'object' ? Object.values(v).flatMap(urls) : []);
  for (const [id, p] of Object.entries(registry().providers)) {
    assert.ok(p.name && p.account, `${id}: name and account`);
    assert.ok(p.skills.length > 0, `${id}: used by a skill`);
    for (const s of p.skills) assert.ok(SKILLS.includes(s), `${id}: skills/${s} exists`);
    assert.ok(p.cli?.name && p.cli.install && p.cli.signIn && p.cli.homieUses, `${id}: its CLI, how it installs and signs in, and what Homie uses of it`);
    assert.ok(Array.isArray(p.mcp), `${id}: mcp is a list (empty when Homie uses none)`);
    for (const m of p.mcp) {
      assert.ok(m.name && m.use, `${id}: each MCP server has a name and a use`);
      assert.match(m.url, /^https:\/\//, `${id}/${m.name}: https`);
      assert.ok(['none', 'oauth'].includes(m.auth), `${id}/${m.name}: signs in on the provider's own page, or needs nothing (never a pasted key)`);
      assert.equal(typeof m.writes, 'boolean');
    }
    if (p.plugin) assert.ok(p.plugin.claudeCode?.length && p.plugin.source && p.plugin.brings, `${id}: the plugin's install, source and what it brings`);
    assert.ok(p.homieKeeps.length > 0, `${id}: what stays Homie's`);
    for (const u of urls(p)) assert.match(u, /^https:\/\//, `${id}: ${u}`);
  }
});

test('every skill\'s frontmatter is plain YAML with the Agent Skills fields only, and names its providers', () => {
  const r = registry();
  for (const skill of SKILLS) {
    const f = frontmatter(skill);
    for (const k of Object.keys(f)) assert.ok(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'].includes(k), `skills/${skill}: ${k} is an Agent Skills field`);
    assert.equal(f.name, skill);
    assert.ok(f.description.length >= 40 && f.description.length <= 1024, `skills/${skill}: a description of 40 to 1,024 characters`);
    const listed = Object.entries(r.providers).filter(([, p]) => p.skills.includes(skill)).map(([id]) => id).sort();
    const named = String(f.metadata?.providers ?? '').split(/\s+/).filter(Boolean).sort();
    assert.deepEqual(named, listed, `skills/${skill}: metadata.providers and providers.json agree`);
    if (named.length) {
      assert.ok(f.compatibility && f.compatibility.length <= 500, `skills/${skill}: compatibility says what it needs, in 500 characters at most`);
      const words = f.compatibility.toLowerCase();
      for (const id of named) assert.ok(words.includes(r.providers[id].name.toLowerCase()) || words.includes(r.providers[id].cli.name), `skills/${skill}: compatibility names ${id}`);
    }
  }
});

test('a skill\'s Codex MCP dependency is one of its own providers\' servers, and only a server that needs no pasted key', () => {
  const r = registry();
  const declared = [];
  for (const skill of SKILLS) {
    for (const t of codexTools(skill)) {
      declared.push(skill);
      assert.equal(t.type, 'mcp');
      assert.equal(t.transport, 'streamable_http');
      assert.ok(t.description?.length > 20, `skills/${skill}: says what the server is for`);
      const providers = String(frontmatter(skill).metadata?.providers ?? '').split(/\s+/);
      const server = providers.flatMap((id) => r.providers[id]?.mcp ?? []).find((m) => m.url === t.url);
      assert.ok(server, `skills/${skill}: ${t.url} is in providers.json under one of its providers`);
      assert.equal(server.name, t.value, `skills/${skill}: the server's name is providers.json's`);
    }
  }
  assert.deepEqual(declared.sort(), ['art', 'models', 'publish', 'servers', 'shop', 'style', 'video']);
});

test('the Homie mod\'s guards know every provider\'s paid and account-changing tools; sign-ins stay free', () => {
  const r = registry().providers;
  // A generating command of each provider's own CLI is held as a call whose cost cannot be read first; signing in is not.
  const generating = { elevenlabs: 'elevenlabs music compose --json -', fal: 'fal api fal-ai/flux/dev prompt=owl', tripo: 'tripo make "a lantern"', stripe: 'stripe projects upgrade cloudflare/workers' };
  for (const [id, command] of Object.entries(generating)) {
    assert.equal(paidOf(command)?.raw, true, `${id}: ${command} is held`);
    const signIn = r[id].cli.signIn.split(/ \(|;/)[0].trim();
    assert.equal(paidOf(signIn), null, `${id}: ${signIn} is free`);
  }
  for (const id of ['fal', 'elevenlabs']) {
    for (const m of r[id].mcp.filter((x) => x.spends)) {
      for (const tool of [`mcp__${m.name}__run_model`, `mcp__plugin_${id}_${m.name}__generate`]) assert.ok(paidMcpOf(tool, {})?.raw, `${tool} is held`);
      assert.equal(paidMcpOf(`mcp__${m.name}__get_pricing`, {}), null, `${m.name}: reading a price is free`);
    }
  }
  for (const m of r.cloudflare.mcp) {
    const del = cloudflareMcpChangeOf(`mcp__plugin_cloudflare_${m.name}__d1_database_delete`, { database_id: 'x' });
    assert.equal(del?.kind, 'delete', `${m.name}: a delete is held`);
    assert.equal(cloudflareMcpChangeOf(`mcp__${m.name}__search_cloudflare_documentation`, { query: 'limits' }), null, `${m.name}: a read is not`);
  }
});

test('the plugin README lists every provider and points at providers.json', () => {
  const readme = readFileSync(join(PLUGIN, 'README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('## The providers\' own tools'), readme.indexOf('## The Homie mod'));
  assert.ok(section.includes('providers.json') && section.includes('extensions["rocks.homie"].providers'));
  for (const p of Object.values(registry().providers)) assert.ok(section.includes(`| ${p.name} |`), `the README's table has ${p.name}`);
});
