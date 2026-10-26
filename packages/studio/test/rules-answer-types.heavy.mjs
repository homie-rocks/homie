import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardRules } from '../lib/rules-guard.mjs';
import { checkRules } from '../lib/rules-check.mjs';
import { typecheckRules } from '../lib/typecheck.mjs';
import { esbuildOf, writeGame, COIN_MAP } from './rules-kit.mjs';
import { source, vocab } from './rules-feature-kit.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-answer-types-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
const probe = readFileSync(new URL('./fixtures/rules-protocols/s5-probe-as-on-main/rules.ts', import.meta.url), 'utf8');
for (const [id, rules] of [['main-kit', source], ['main-probe', probe]]) test(`main compatibility: ${id} keeps its original answer assignments`, async () => {
  assert.match(rules, /world.shared.yes = e.picks.advance;/);
  const dir = writeGame(root, id, { rules }); writeFileSync(join(dir, 'src/view.ts'), 'export {};');
  const esbuild = await esbuildOf(); const g = await guardRules(esbuild, root, dir);
  const checked = await checkRules(esbuild, root, id, g.code, { map: COIN_MAP, tune: {}, seats: 4, vocab }, { declarationsOnly: true });
  await typecheckRules(root, { id, dir }, checked, {});
  if (id === 'main-probe') {
    for (const mutated of [
      rules.replace("e.ask === 'plan'", "e.ask === 'plann'"),
      rules.replace('self.tactic = e.picks.tactic;', "self.tactic = e.picks.tactic === 'duble' ? 'x' : 'y';"),
      rules.replace("world.ask('director', { danger: 1 }); },\n    on:", "world.ask('director', { danger: 1 }); world.ask('plan', { danger: 1 }); },\n    on:"),
    ]) {
      assert.notEqual(mutated, rules);
      writeFileSync(join(dir, 'src/rules.ts'), mutated);
      await assert.rejects(typecheckRules(root, { id, dir }, checked, {}), /TS2367|TS2339/);
    }
  }
});
