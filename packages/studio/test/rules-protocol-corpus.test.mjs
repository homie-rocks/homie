/** Original third-review sources, copied without rewriting handlers or views. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRules } from '../lib/rules-build.mjs';
import { esbuildOf, writeGame } from './rules-kit.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-third-corpus-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
const cases = [
  ['s5-probe-as-on-main'], ['k5-ready-up'], ['k6-vote-ends-round'], ['k7-two-step-protocol'],
  ['q01-floor-wrong-arg-key', /rules\.ts:\d+:\d+ TS2322[^]*GameDecision/],   // the compiler has it first now
  ['q02-floor-unknown-goal', /rules\.ts:\d+:\d+ TS2322[^]*relight[^]*GameDecision/],
  ['q03-goal-never-completes'],
  ['q04-ask-no-floor', /asks.bonus.*floor/],
  ['q07-answer-unchecked', /picks|pace|ask/],
  ['q08-floor-score-out-of-range', /asks.bonus.floor.*pace.*3.*0.*2/],
  ['q18-text-overflow', /lamp\.fields\.name was written a text of \d+ characters for a size of 8/],
  ['q23-follow-goal-deref', /rules.ts:\d+.*keeper.think.*absent/],
  ['t8-heavy-540s-fault', /rules.ts:\d+.*room.on.storm.*absent.*This was tick 10801 of the generated play/],   // nine minutes into a heavy game: the first room is played that far by default
];
for (const [id, refusal] of (process.env.RULES_EXTENDED ? cases : cases.filter(([id]) => ['s5-probe-as-on-main','k7-two-step-protocol','q01-floor-wrong-arg-key','q08-floor-score-out-of-range'].includes(id)))) test(`protocol corpus: ${id}`, async () => {
  const base = new URL(`./fixtures/rules-protocols/${id}/`, import.meta.url);
  const read = (name, fallback) => existsSync(new URL(name, base)) ? readFileSync(new URL(name, base), 'utf8') : fallback;
  const dir = writeGame(root, id, { rules: read('rules.ts'), move: read('move.ts', null) });
  writeFileSync(join(dir, 'src/view.ts'), read('view.ts', 'export {};'));
  mkdirSync(join(dir, 'map')); writeFileSync(join(dir, 'map/main.json'), read('map.json'));
  for (const name of ['agents.json', 'tunables.json']) if (existsSync(new URL(name, base))) writeFileSync(join(dir, name), read(name));
  const meta = JSON.parse(read('game.json', '{"players":{"max":8}}'));
  const logs = [];
  const build = () => prepareRules(esbuild, root, { ...meta, id, dir }, { log: m => logs.push(m) });
  const esbuild = await esbuildOf();
  if (refusal) await assert.rejects(build, refusal);
  else await build();
});
