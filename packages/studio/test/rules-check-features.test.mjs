/** Generated play includes the server's companions and local decision floors. */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { guardRules } from '../lib/rules-guard.mjs';
import { checkRules } from '../lib/rules-check.mjs';
import { typecheckRules } from '../lib/typecheck.mjs';
import { esbuildOf, writeGame, COIN_MAP } from './rules-kit.mjs';
import { source, vocab } from './rules-feature-kit.mjs';
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-check-features-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
async function run(rules, id) {
  const dir = writeGame(scratch, id, { rules });
  writeFileSync(join(dir, 'src/view.ts'), 'export {};');
  const esbuild = await esbuildOf();
  const guarded = await guardRules(esbuild, scratch, dir);
  assert.equal(guarded.ok, true, JSON.stringify(guarded.problems));
  const result = await checkRules(esbuild, scratch, id, guarded.code, { map: COIN_MAP, tune: {}, seats: 4, vocab, sites: guarded.sites }, { allowance: { ticks: 800 } });
  return { dir, result };
}
test('generated companion play runs guides and decision floors and restores their state', async () => {
  const { result, dir } = await run(source, 'companions');
  assert.doesNotMatch(result.information.join('\n'), /(?:pawn\.guide\.view|pawn\.guide\.floor|pawn\.think|asks\.director\.floor|room\.on\.answer) never ran/);
  assert.deepEqual(result.plays.map((p) => p.companions), [false, true], 'one room without companions and one with');
  assert.ok(result.plays.every((p) => p.restores > 100));
  await typecheckRules(scratch, { id: 'companions', dir }, result, {});
  writeFileSync(join(dir, 'src/rules.ts'), source.replace('advance: state.danger < 2', "advance: 'yes'"));
  await assert.rejects(typecheckRules(scratch, { id: 'companions', dir }, result, {}), /TS2322.*boolean/);
});
test('a guide floor failure stops generated play at its source', async () => {
  await assert.rejects(run(source.replace('self.floors += 1;', 'self.floors = 0 / 0;'), 'bad-guide'), /rules\.ts:\d+ pawn\.guide\.floor: pawn\.fields\.floors was written NaN/);
});
test('decision question validation survives the generated check', async () => {
  await assert.rejects(run(source.replace("type: 'noul'", "type: 'invented'"), 'bad-question'), /asks.director.questions/);
});
test('an invalid decision floor is refused instead of accepting a fallback answer', async () => {
  await assert.rejects(run(source.replace('advance: state.danger < 2', "advance: 'yes'"), 'bad-floor'), /asks.director.floor.*answer every declared question/);
});

test('reserved AI bodies receive validated floor goals even with ordinary bots off', async () => {
  await assert.rejects(run(source.replace('self.guided = self.goal !== null;', "if (self.driver === 'ai' && self.owner === 'reserved' && self.goal && self.goal.goal === 'guard') self.floors = 0 / 0;"), 'goal-path'), /rules\.ts:\d+ pawn\.think: pawn\.fields\.floors was written NaN/);
});
