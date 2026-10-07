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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

test('a first run in Codex and Grok: no connector is no dead end, the holds are said when off, and a neighbouring studio is left alone', () => {
  const s = skill('studio-setup');
  // The stop that ended a first run in 66 seconds with nothing made is gone, in both places it was written.
  assert.doesNotMatch(s, /not connected and stop/);
  assert.doesNotMatch(s, /without the connector there is no pinned toolkit/);
  assert.match(s, /Without the connector, with a shell: go on\./);
  at(s, 'npx -y @homie-rocks/studio@latest new <folder> --name "<Name>"');
  at(s, 'npx -y @homie-rocks/studio@latest setup status --connector no --json');
  assert.match(s, /Stop only when there is neither/);
  assert.match(s, /Never invent the package\s+address: it is `@homie-rocks\/studio`/, 'the one address is still written down here');
  for (const how of [/codex plugin add homie@homie/, /grok plugin install\s+homie-rocks\/homie#plugins\/homie/, /a custom connector at `https:\/\/homie\.rocks\/mcp`/]) assert.match(s, how);
  assert.match(s, /Never stop for a missing connector while you can run a command/);
  // The app is named to the status, which then says whether Homie's holds are on; off is said in the first reply.
  at(s, '--client codex');
  at(s, '--client grok');
  assert.match(s, /When it is off, say so in one sentence in this first reply/);
  assert.match(s, /When it is on, say nothing about it and\s+change nothing/);
  // The demo's link is given whether or not this session could read the arcade.
  at(s, 'https://arcade.homie.rocks/asteroids-arena/play');
  assert.match(s, /say nothing about the lookup/);
  // Another studio in the same folder is somebody else's.
  assert.match(s, /Never read or copy from another studio in the same folder unless the person asks/);
  assert.match(skill('game'), /\*\*Other studios\*\* beside this one .* are other people's\s+work: never read their games or copy from them/);
  // Nothing promises Codex or Grok what only Claude draws.
  assert.match(s, /In Codex and Grok Build Homie\s+draws no status line, pane or card/);
  // Grok Build runs a plugin's hooks once the plugin is trusted (0.30.2 said it runs none: Grok had been handed the
  // Claude Code mod's hooks file, see test/manifests.test.mjs). The setup skill says so, never assumes they are
  // on, and tells Grok to ask the person itself while the setup status says off.
  assert.match(s, /\*\*Homie's holds in Grok\.\*\*/);
  assert.match(s, /Grok runs a plugin's hooks only once the person has trusted the plugin/);
  assert.match(s, /Never assume they are on:\s+the setup status with `--client grok` says which it is/);
  assert.match(s, /say what it would do in one sentence and wait for the person's yes/);
  const everywhere = [...readdirSync(join(PLUGIN, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => [d.name, skill(d.name)]),
    ...['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.grok-plugin/plugin.json', 'README.md', 'hooks/grok.json'].map((m) => [m, readFileSync(join(PLUGIN, m), 'utf8')])];
  for (const [name, text] of everywhere) {
    // The one place the old claim is still spelled is the README's account of why it was wrong.
    const said = text.replace(/read\s+that as "Grok runs no plugin's hooks", which was wrong/, '');
    assert.doesNotMatch(said, /Grok(?: Build)?(?: 1\.0\.\d+)? (?:runs|registers) no plugin's\s+hooks|hooks do not run (?:in Grok|there) yet|nothing is held (?:there|in Grok) yet/, `${name}: nothing says Grok runs no hooks`);
  }
  for (const m of ['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.grok-plugin/plugin.json']) {
    assert.match(readFileSync(join(PLUGIN, m), 'utf8'), /In Grok Build the same hooks hold the same calls once you trust the plugin/, m);
  }
  // Going online never lists: the directory is a separate step the person asks for.
  assert.match(s, /\*\*The directory, only when asked\.\*\* Going online never lists a studio/);
  assert.match(skill('publish'), /Going online never lists a studio\. Listing is this separate step/);
  // Asked for everything at once: a Play link the moment two browsers finish a round, before any polish.
  assert.match(s, /\*\*A Play link first\.\*\*/);
  assert.ok(at(s, 'A Play link first') < at(s, '## 0. Setup status'), 'said with the one-sentence flow');
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

test('standalone: plan first, what the app does not have said before shipping, signing and uploads left to the person', () => {
  const s = skill('standalone');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(s)[1];
  assert.match(front, /^name: standalone$/m);
  assert.match(front, /^description: .*Steam.*iOS and Android/m);
  assert.doesNotMatch(front.split('\n').find((l) => l.startsWith('description: ')).slice(13), /: | #/, 'plain YAML');
  // Every command it names is in the toolkit's usage, as the toolkit spells it.
  const usage = readFileSync(join(ROOT, 'packages', 'studio', 'bin', 'homie-studio.mjs'), 'utf8').split('*/')[0];
  assert.match(usage, /homie-studio standalone plan\|build\|run\|steam\|ci <game>/);
  const verbs = [...s.matchAll(/homie-studio standalone ([a-z]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(verbs)].sort(), ['build', 'ci', 'plan', 'run', 'steam']);
  for (const flag of ['--for', '--release']) { at(s, flag); at(usage, flag); }
  // The order: the plan, then the build; and the honest list before anything ships.
  const order = ['standalone plan <id>', 'What the standalone game does not have (v1)', 'standalone build <id>', 'standalone run <id>', '--release', 'standalone ci <id>'].map((x) => at(s, x));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const needle of ['no player accounts or sign-in', 'no cloud saves', 'no shop', 'no room chat', 'no automatic updates', 'Do not soften it', 'Never\n  install a JDK', 'Never\n   ask for a password', '**Uploading is the person\'s.**', '0.32.0 or later', '**and it has been deployed since**', '"netplay": { "version": "1" }', 'game_standalone']) at(s, needle);
  assert.match(s, /"Skipped" is not "built"/);
  // What was run and what was not, said as it is: built is not works, a store is not a yes, Steam's overlay is not promised.
  for (const needle of ['"started here and loaded the game: yes" or "NO"', '"built, not\nstarted on this computer"', '**UNSIGNED**', 'The Windows and Linux builds have never been started', 'lost when the app is\n  uninstalled', 'never a promise that the store\n  takes the game', 'Before you spend money', 'do not promise an overlay', 'has not been run by the people who made it', '`launchctl setenv`', 'studio_job']) at(s, needle);
  assert.doesNotMatch(s, /the builds (Steam|the App Store and Google Play) takes?/, 'a file a store accepts for upload, never "the build the store takes"');
  // The guide it points at ships in the package, and the hooks read its commands as what they are.
  assert.ok(existsSync(join(ROOT, 'packages', 'studio', 'standalone', 'STANDALONE.md')));
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
