import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardRules } from '../lib/rules-guard.mjs';
import { checkRules } from '../lib/rules-check.mjs';
import { typecheckRules } from '../lib/typecheck.mjs';
import { esbuildOf, writeGame, COIN_MAP } from './rules-kit.mjs';
import { source, vocab } from './rules-feature-kit.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-third-review-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
async function run(id, rules, options = {}) {
  const dir = writeGame(root, id, { rules });
  writeFileSync(join(dir, 'src/view.ts'), 'export {};');
  const e = await esbuildOf();
  const g = await guardRules(e, root, dir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  const result = await checkRules(e, root, id, g.code, { map: COIN_MAP, tune: {}, seats: 2, vocab, sites: g.sites }, options);
  return { dir, result };
}
test('answers retain the declared question types in both handler scopes', async () => {
  const rules = source.replace('self.answered += 1;', "if (e.ask === 'director') self.guided = e.picks.advance;");
  const { dir, result } = await run('typed-answers', rules, { declarationsOnly: true });
  await typecheckRules(root, { id: 'typed-answers', dir }, result, {});
});
const commandGame = `import { defineRules, defineMove, f } from '@homie-rocks/studio/rules';
export default defineRules({ contract: 2, space: { dims: 2 },
move: defineMove({ player() {} }), shapes: { commands: { vote: {} }, events: { voted: {} } },
entities: { player: { player: true, fields: { voted: f.bit() }, body: { shape: 'circle', radius: 0.2, maxSpeed: 1 },
commands: { vote(world, self) { self.voted = true; world.sendRoom('voted'); } },
onRoom: { roundStart(world, self) { self.voted = false; } } } },
room: { rounds: { seconds: 0, breakSeconds: 1 }, join() { return { kind: 'player', at: { x: 0, y: 0, z: 0 } }; },
on: { voted(world) { const people = world.near({ x: 0, y: 0, z: 0 }, 64, 'player').filter(p => p.driver === 'person'); if (people.length && people.every(p => p.voted)) world.round.end(); } } } });`;
test('a vote ends several generated rounds without an exemption', async () => {
  const { result } = await run('votes', commandGame);
  assert.ok(result.roundsPlayed >= 4, `${result.roundsPlayed} rounds`);
});
test('events keep the reachable state and order in which the game sends them', async () => {
  const rules = commandGame.replace('events: { voted: {} }', 'events: { voted: {}, claimed: { name: f.text(8) }, expired: { name: f.text(8) } }')
    .replace('entities: {', 'shared: { owners: f.map(f.u8(), 8) }, entities: {')
    .replace("self.voted = true;", "self.voted = true; world.sendRoom('claimed', { name: 'north' }); world.sendRoom('expired', { name: 'north' });")
    .replace('seconds: 0', 'seconds: 1')
    .replace('on: { voted', 'on: { claimed(world, e) { world.shared.owners[e.name] = 1; }, expired(world, e) { world.shared.owners[e.name] -= 1; }, voted');
  await run('ordered-events', rules);
});
for (const [id, replacement, pattern] of [
  ['wrong-goal', "{ goal: 'missing' }", /guide.floor.*missing.*guard/],
  ['wrong-argument', "{ goal: 'follow', args: { name: 0 } }", /guide.floor.*argument.*name/],
  ['wrong-line', "{ say: 'missing' }", /guide.floor.*missing.*hello/],
]) test(`a rejected companion decision fails: ${id}`, async () => {
  await assert.rejects(run(id, source.replace("{ goal: 'guard', say: 'hello' }", replacement), ), pattern);
});
test('a person request reaches think on a reserved AI seat in a two seat game', async () => {
  await assert.rejects(run('requested-goal', source.replace('self.guided = self.goal !== null;', "if (self.driver === 'ai' && self.goal && self.goal.goal === 'follow') throw new Error('follow reached');")), /pawn.think.*follow reached/);
});
test('unobserved round coverage cannot hide an unrelated invalid value', async () => {
  const rules = commandGame.replace('self.voted = true;', 'self.voted = true; const values = []; values[0].missing;');
  await assert.rejects(run('exemption-is-local', rules), /absent/);
});
