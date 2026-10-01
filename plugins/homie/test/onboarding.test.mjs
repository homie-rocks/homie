/**
 * The built-in flow for a new studio, as the skills say it (from the first outside creators' feedback):
 *
 *   - studio-setup: the setup status comes first, then a checklist that never jumps ahead (see a working game,
 *     one small change, the plan, build, playtest and online), and it asks before copying a game;
 *   - plan: the interview covers every topic, and ends in the Game Codex (CODEX.md, drawn in the game's look,
 *     an artifact where the app has artifacts), kept true, with the build's progress on it;
 *   - parallel: offered as a choice with its trade-off, only where subagents exist, one folder per agent,
 *     then a merge, a check, a playtest and a blind review;
 *   - every `homie-studio` command any skill names is one the toolkit has (its usage text).
 *
 * Run: node --test plugins/homie/test/onboarding.test.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(PLUGIN, '..', '..');
const skill = (name) => readFileSync(join(PLUGIN, 'skills', name, 'SKILL.md'), 'utf8');
const at = (text, needle) => { const i = text.indexOf(needle); assert.ok(i >= 0, `names ${JSON.stringify(needle)}`); return i; };

test('studio-setup: setup status first, then a checklist in order that never jumps ahead', () => {
  const s = skill('studio-setup');
  const steps = ['0. Setup status', '1. The studio', '2. See a working game', '3. One small change', '4. Plan your game', '5. Build it', '6. Playtest it'];
  const listed = steps.map((x) => at(s, x));
  assert.deepEqual([...listed].sort((a, b) => a - b), listed, 'the checklist is in order');
  assert.ok(at(s, 'setup status --connector yes') < at(s, 'game new <id> --from gem-rush'), 'the status comes before any game is made');
  assert.match(s, /Never jump ahead/);
  // A new studio has no game: "see a working game" is a live one elsewhere, and a starter goes in only when asked.
  assert.match(s, /Show a live one; copy nothing/);
  assert.match(s, /homie-studio demo/);
  assert.match(s, /Only when they ask for a copy/);
  assert.ok(at(s, 'homie-studio demo') < at(s, 'game new <id> --from gem-rush'), 'the live demo comes before any copy');
  assert.match(s, /Never block on an optional row/);
  assert.match(s, /even while they wait/, 'the person can do their part while waiting');
  assert.match(s, /`plan` skill/);
  assert.match(s, /`parallel` skill/);
  assert.match(s, /statusline --install/, 'the status line is offered in the setup step');
  assert.match(s, /Asked for everything at once/, 'a one-prompt studio still goes all the way');
});

test('plan: the interview covers every topic, naturally, and ends in the Game Codex', () => {
  const s = skill('plan');
  for (const topic of ['Game type and genre', 'Style and art direction', 'Devices', 'Players and rooms', 'Art and film', 'Music and sound', 'Scope']) assert.match(s, new RegExp(`\\*\\*${topic}\\*\\*`), topic);
  // Persistent games: the interview always asks, and the game skill wires cloud saves in when the answer is yes.
  assert.match(s, /Does progress need to persist across sessions or devices\?/);
  const game = skill('game');
  for (const needle of ['"saves": true', "createSaves", '--from ember-vale', 'saves.fall', 'SAVES.md']) at(game, needle);
  assert.match(s, /natural, not a form/);
  assert.match(s, /Two or three questions a message/);
  for (const needle of ['games/<id>/CODEX.md', 'codex new <id>', 'codex <id> --artifact', 'codex <id> --open', 'codex link <id>', 'Keep it true', 'Build status', 'progress start <id>']) at(s, needle);
  assert.match(s, /Codex CLI has no command status\s+line/, 'what a Codex user sees instead');
  const ref = readFileSync(join(PLUGIN, 'skills', 'plan', 'references', 'CODEX.md'), 'utf8');
  for (const needle of ['palette:', 'fonts:', '### Cinder Wisp', '`M-01`', '- [x]', '| Action | Phone | Computer']) at(ref, needle);
});

test('parallel: a choice with its trade-off, one folder each, then merge, check, playtest and a blind review', () => {
  const s = skill('parallel');
  assert.match(s, /usage/);
  assert.match(s, /only when your app can run subagents/);
  assert.match(s, /Writes only in/);
  assert.match(s, /Shared files have one owner/);
  const order = ['2. `npm run build`', '3. `npm run dev` in the background, then `npx --no-install homie-studio check <id>', 'The `playtest` skill', 'then its blind review', 'Update the codex', 'Commit once'].map((x) => at(s, x));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'merge, check, playtest, review, codex, commit, in that order');
});

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
