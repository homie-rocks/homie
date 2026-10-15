// Validate referenced CLI commands, without prescribing skill wording.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(PLUGIN, '..', '..');
const skill = (name) => readFileSync(join(PLUGIN, 'skills', name, 'SKILL.md'), 'utf8');

test('every homie-studio command a skill names is one the toolkit has', () => {
  const usage = readFileSync(join(ROOT, 'packages', 'studio', 'bin', 'homie-studio.mjs'), 'utf8').split('*/')[0];
  const known = new Set([...usage.matchAll(/homie-studio ([a-z]+)(?: \[?([a-z]+)\]?)?/g)].flatMap((m) => [m[1], m[2] ? `${m[1]} ${m[2]}` : m[1]]));
  known.add('doctor');
  const skills = readdirSync(join(PLUGIN, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const name of skills) {
    for (const [, cmd, sub] of skill(name).matchAll(/homie-studio ([a-z]+)(?: ([a-z]+))?/g)) {
      assert.ok(known.has(cmd), `${name}: homie-studio ${cmd}`);
      if (sub && ['setup', 'codex', 'progress', 'stats', 'port', 'game', 'storage', 'media', 'chrome'].includes(cmd) && known.has(`${cmd} ${sub}`) === false) {
        // a word after the command that is not one of its subcommands is the game id or plain text
        assert.ok(!['status', 'attach', 'new', 'link', 'install', 'start', 'stage', 'check', 'end'].includes(sub), `${name}: homie-studio ${cmd} ${sub} is not in the toolkit's usage`);
      }
    }
  }
});
