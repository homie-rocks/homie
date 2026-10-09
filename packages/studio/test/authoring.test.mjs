/** The unattended runner must distinguish an edit, a refusal and a successful proof. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { authoring, REQUESTS } from './authoring.mjs';
import { PKG } from './rules-kit.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-authoring-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const skill = join(PKG, '../../plugins/homie/skills/game/SKILL.md');
test('three fixed requests go through the skill and reference; an unchanged game never counts as a pass', async () => {
  const studio = join(scratch, 'noop'); mkdirSync(studio);
  const prompts = [];
  const rows = await authoring({ studio, skill, agent: ['fixture'], run: async (_args, _cwd, input) => { prompts.push(input); } });
  assert.equal(rows.length, 3); assert.equal(prompts.length, 3);
  for (let i = 0; i < rows.length; i += 1) {
    assert.equal(rows[i].ok, false); assert.match(rows[i].error, /no change/);
    assert.ok(prompts[i].includes(REQUESTS[i].text));
    assert.match(prompts[i], /Rules reference \(contract 2\)/); assert.match(prompts[i], /Read \[RULES.md\]/);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(studio, '.checks/authoring/report.json'))).rows, rows);
});
test('an edit whose build fails is recorded, and no browser success is claimed', async () => {
  const studio = join(scratch, 'bad'); mkdirSync(studio);
  const rows = await authoring({ studio, skill, agent: ['fixture'], run: async (args, cwd, input) => {
    if (input) { const game = /Edit only games\/([\w-]+)/.exec(input)[1]; writeFileSync(join(cwd, 'games', game, 'src/view.ts'), 'broken edit'); }
    else { assert.ok(args.includes('build')); throw new Error('build refused the authored game'); }
  } });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => !r.ok && /build refused/.test(r.error)));
});
