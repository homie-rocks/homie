import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRules } from '../lib/rules-build.mjs';
import { guardRules } from '../lib/rules-guard.mjs';
import { checkRules } from '../lib/rules-check.mjs';
import { typecheckRules } from '../lib/typecheck.mjs';
import { esbuildOf, writeGame, COIN_MAP } from './rules-kit.mjs';
import { source, vocab } from './rules-feature-kit.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-goals-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
async function build(id, rules, vocabulary) {
  const dir = writeGame(root, id, { rules });
  writeFileSync(join(dir, 'src/view.ts'), 'export {};');
  mkdirSync(join(dir, 'map')); writeFileSync(join(dir, 'map/main.json'), JSON.stringify(COIN_MAP));
  if (vocabulary) writeFileSync(join(dir, 'agents.json'), JSON.stringify(vocabulary));
  return prepareRules(await esbuildOf(), root, { id, dir, players: { max: 4 } });
}
test('goal and request arguments retain declared text, player, literal and reference types', async () => {
  const v = structuredClone(vocab);
  v.goals.pick = { about: 'Choose', args: { mode: ['near', 'far'], gem: 'view.gems' } };
  const rules = source.replace('nearby: f.u8(),', 'gems: f.list(f.ref(), 2), nearby: f.u8(),')
    .replace('nearby: 7,', "gems: [self.id], nearby: 7,")
    .replace('self.guided = self.goal !== null;', `const goal = self.goal;if(goal && goal.state!=='active')throw new Error('entity goal state was not admitted'); if(goal?.goal==='visit')world.map.spot(goal.args.place); if(goal?.goal==='follow'){const seat:number=goal.args.seat;} if(goal?.goal==='pick'){const mode:'near'|'far'=goal.args.mode;const gem:string=goal.args.gem;} self.guided = goal !== null;`)
    .replace('self.floors += 1;', `if(v.goal && (typeof v.goal.asked !== 'boolean' || typeof v.goal.at !== 'number' || v.goal.at > world.tick || (v.goal.from !== 'floor' && v.goal.from !== 'brain')))throw new Error('goal metadata was not admitted');if(v.goal?.goal==='visit')world.map.spot(v.goal.args.place);const request=v.asks[0];if(request?.k==='visit')world.map.spot(request.args.place);self.floors += 1;`);
  await build('goal-types', rules, v);
});

test('goal argument names and their declared types reject wrong reads', async () => {
  for (const [id, read, pattern] of [
    ['wrong-goal-field', "if(self.goal?.goal==='visit')world.map.spot(self.goal.args.missing);", /missing.*place|does not exist/],
    ['wrong-goal-type', "if(self.goal?.goal==='follow')world.map.spot(self.goal.args.seat);", /number.*string/],
  ]) await assert.rejects(build(id, source.replace('self.guided = self.goal !== null;', read), vocab), pattern);
});

// The compiler alone: what a floor returns and what a view asks are read against agents.json.
async function types(id, rules, view, vocabulary) {
  const dir = writeGame(root, id, { rules });
  writeFileSync(join(dir, 'src/view.ts'), `import { openRoom } from '@homie-rocks/studio/rules/view'; const room = openRoom();\n${view}\n`);
  const esbuild = await esbuildOf(); const g = await guardRules(esbuild, root, dir);
  const checked = await checkRules(esbuild, root, id, g.code, { map: COIN_MAP, tune: {}, seats: 4, vocab: vocabulary, sites: g.sites }, { declarationsOnly: true });
  return typecheckRules(root, { id, dir }, checked, {});
}
const spoken = structuredClone(vocab);
spoken.goals.pick = { about: 'Choose', args: { mode: ['near', 'far'] } };
spoken.lines.off = { text: 'Off to {place}.', args: { place: 'view.places' } };
const FLOOR = "{ goal: 'guard', say: 'hello' }";
const BUTTONS = "for (const b of room.askButtons('e1')) { if (b.k === 'visit') b.args.place.trim(); room.ask('e1', b.k, b.args); }";

test('a floor decision and a view request that fit the vocabulary compile', async () => {
  assert.match(source, /return ask \? \{ goal: ask\.k, args: ask\.args \} : \{ goal: 'guard', say: 'hello' \}/);
  await types('fits', source, `${BUTTONS} room.ask('e1', 'follow', { seat: 0 }); room.ask('e1', 'visit', { place: 'camp' });`, spoken);
  await types('fits-own', source.replace(FLOOR, "v.nearby > 9 ? {} : v.nearby > 3 ? { goal: null, say: 'hello' } : { goal: 'pick', args: { mode: 'near' }, say: 'off', sayArgs: { place: 'camp' } }"), BUTTONS, spoken);
  // No agents.json: nothing to read a name against, so both stay as loose as they were.
  await types('no-vocabulary', source.replace(FLOOR, "{ goal: 'anything', args: { any: 1 }, say: 'any' }"), "room.ask('e1', 'anything'); room.ask('e1', 'anything', { any: 1 });", undefined);
});

test('a floor decision outside the vocabulary does not compile', async () => {
  for (const [id, decision] of [
    ['argument-outside-list', "{ goal: 'pick', args: { mode: 'up' } }"],
    ['argument-of-another-goal', "{ goal: 'visit', args: { seat: 0 } }"],
    ['argument-missing', "{ goal: 'pick' }"],
    ['argument-undeclared', "{ goal: 'guard', args: { place: 'camp' } }"],
    ['say-argument-type', "{ goal: 'guard', say: 'off', sayArgs: { place: 7 } }"],
    ['say-unknown', "{ goal: 'guard', say: 'bye' }"],
    ['goal-unknown', "{ goal: 'wait' }"],
  ]) await assert.rejects(types(id, source.replace(FLOOR, decision), '', spoken), /TS2322[^]*Repair: A floor returns goal and say names from agents\.json/, id);
});

test('a view request outside the vocabulary does not compile', async () => {
  for (const [id, call, pattern] of [
    ['request-unknown', "room.ask('e1', 'fly', {});", /"fly"/],
    ['request-argument-missing', "room.ask('e1', 'visit', {});", /place/],
    ['request-arguments-absent', "room.ask('e1', 'visit');", /TS2554/],
    ['request-argument-type', "room.ask('e1', 'follow', { seat: 'one' });", /string.*number/],
  ]) await assert.rejects(types(id, source, call, spoken), pattern, id);
});
