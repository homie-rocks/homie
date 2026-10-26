import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rulesTypes } from '../lib/rules-types.mjs';
import { typecheckRules } from '../lib/typecheck.mjs';
import { loadRules } from '../lib/rules-build.mjs';
import { esbuildOf, writeGame } from './rules-kit.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-review-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
const checked = { publicTune: {}, schema: { kinds: [
  { name: 'runner', player: true, radius: 1, fields: [['cards', { t: 'list', of: { t: 'u8' }, max: 8 }]], motion: [], input: [['ax', { t: 'i8' }]] },
  { name: 'bullet', player: false, radius: 1, fields: [], motion: [], input: [] },
], shared: [['cards', { t: 'list', of: { t: 'u8' }, max: 8 }]], effects: {}, commands: {} }, declarations: { events: {}, asks: {}, view: {} } };
const source = `import { defineRules, defineMove, f } from '@homie-rocks/studio/rules';
const move = defineMove({ runner(body, input, ctx) { body.vel = { x: 0, y: 0, z: 0 }; } });
export default defineRules({ contract: 2, space: { dims: 2 }, move,
shared: { cards: f.list(f.u8(), 8) }, entities: {
runner: { player: true, fields: { cards: f.list(f.u8(), 8) }, input: { ax: f.i8() }, tick(world, self) { self.cards = world.shared.cards; }, think() { return {}; } },
bullet: {} } });`;
test('player movement is required, other bodies optional, and copied lists accept readonly input', async () => {
  const dir = writeGame(root, 'types-review', { rules: source });
  writeFileSync(join(dir, 'src/view.ts'), 'export {};');
  await typecheckRules(root, { id: 'types-review', dir }, checked, {});
});
test('move rejects a returned value and retains the compiler reason', async () => {
  const dir = writeGame(root, 'move-return', { rules: source.replace('body.vel = { x: 0, y: 0, z: 0 };', 'return 42;') });
  writeFileSync(join(dir, 'src/view.ts'), 'export {};');
  await assert.rejects(typecheckRules(root, { id: 'move-return', dir }, checked, {}), /number.*undefined/s);
});
test('failed linking cleans up and describes the missing default export', async () => {
  await assert.rejects(loadRules(await esbuildOf(), root, 'missing', 'export const x = 1;'), /rules.ts.*default export/s);
  assert.deepEqual(readdirSync(join(root, '.studio/rules')), []);
});
test('concurrent links of the same game have isolated temporary files', async () => {
  const e = await esbuildOf();
  const results = await Promise.all(Array.from({ length: 8 }, () => loadRules(e, root, 'same', 'export default {};', { bundleOnly: true })));
  assert.equal(results.length, 8);
  assert.deepEqual(readdirSync(join(root, '.studio/rules')), []);
});

async function generated(source, id) {
  const { guardRules } = await import('../lib/rules-guard.mjs');
  const { checkRules } = await import('../lib/rules-check.mjs');
  const { COIN_MAP } = await import('./rules-kit.mjs');
  const dir = writeGame(root, id, { rules: source });
  const e = await esbuildOf();
  const g = await guardRules(e, root, dir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  return checkRules(e, root, id, g.code, { map: COIN_MAP, tune: {}, seats: 4, sites: g.sites });
}
const lifecycle = `import { defineRules, defineMove } from '@homie-rocks/studio/rules';
export default defineRules({ contract: 2, space: { dims: 2 }, move: defineMove({ player() {} }), entities: { player: { player: true, body: { shape: 'circle', radius: 0.5, maxSpeed: 1 },
tick(world, self) { BODY }
} }, room: { rounds: { seconds: 600, breakSeconds: 8 }, join() { return { kind: 'player', at: { x: 0, y: 0, z: 0 } }; }, on: { HANDLERS } } });`;
test('generated rooms catch a fault requiring a second person', async () => {
  await assert.rejects(generated(lifecycle.replace('BODY', `if (world.near(self.pos, 10, 'player').filter(p => p.driver === 'person').length > 1) throw new Error('second person');`).replace('HANDLERS', ''), 'second-person'), /second person/);
});
test('generated rooms exercise a seat leaving', async () => {
  await assert.rejects(generated(lifecycle.replace('BODY', '').replace('HANDLERS', `seatLeft() { throw new Error('seat left'); }`), 'seat-left'), /seat left/);
});
test('an unspawned entity handler is reported by name', async () => {
  const text = lifecycle.replace('BODY', '').replace('HANDLERS', '').replace('entities: {', 'entities: { absent: { tick() {} },');
  assert.match((await generated(text, 'unreached')).information.join('\n'), /rules.ts:\d+.*absent.tick never ran/);
});
test('a list invariant names its declared field', async () => {
  await assert.rejects(generated(`import { defineRules, f } from '@homie-rocks/studio/rules';
export default defineRules({ contract: 2, space: { dims: 2 }, entities: { dot: { fields: { cards: f.list(f.u8(), 2) }, tick(world, self) { self.cards = [1, 2, 3]; } } }, room: { start(world) { world.spawn('dot', { x: 0, y: 0, z: 0 }); } } });`, 'field-name'), /rules\.ts:2 dot\.tick: dot\.fields\.cards was written a list of 3 entries for a size of 2/);
});
test('long generated time reaches a fault after tick 3000', async () => {
  await assert.rejects(generated(lifecycle.replace('BODY', "if (world.tick > 3000) throw new Error('late tick');").replace('HANDLERS', ''), 'late-time'), /late tick/);
});
test('distant timers cannot silently accumulate past the queue limit', async () => {
  await assert.rejects(generated(`import {defineRules} from '@homie-rocks/studio/rules';
export default defineRules({contract:2,space:{dims:2},shapes:{events:{later:{}}},entities:{dot:{tick(world,self){for(let i=0;i<8;i++) world.after(100000,'later',{});},on:{later(){}}}},room:{start(world){world.spawn('dot',{x:0,y:0,z:0});}}});`, 'timer-growth'), /events and timers|tick budget/);
});
test('two-dimensional movement accepts an omitted z coordinate', async () => {
  const dir = writeGame(root, 'vector-two', { rules: source.replace('{ x: 0, y: 0, z: 0 }', '{ x: 0, y: 0 }') });
  writeFileSync(join(dir, 'src/view.ts'), 'export {};');
  await typecheckRules(root, { id: 'vector-two', dir }, checked, {});
});
test('the view knows entity fields, kinds and command names', async () => {
  const dir = writeGame(root, 'typed-view', { rules: source });
  const view = join(dir, 'src/view.ts');
  writeFileSync(view, `import {openRoom} from '@homie-rocks/studio/rules/view'; const room = openRoom(); room.each('runner', e => { const first: number | undefined = e.cards[0]; });`);
  await typecheckRules(root, { id: 'typed-view', dir }, checked, {});
  writeFileSync(view, `import {openRoom} from '@homie-rocks/studio/rules/view'; const room = openRoom(); room.each('typo', () => {}); room.command('typo', {});`);
  await assert.rejects(typecheckRules(root, { id: 'typed-view', dir }, checked, {}), /src\/view.ts/);
});
test('three hundred initial entities retain bounded generated work', async () => {
  const { COIN_DASH, COIN_MAP } = await import('./rules-kit.mjs');
  const { guardRules } = await import('../lib/rules-guard.mjs');
  const { checkRules } = await import('../lib/rules-check.mjs');
  const dir = writeGame(root, 'many-entities', { rules: readFileSync(join(COIN_DASH, 'src/rules.ts'), 'utf8'), move: readFileSync(join(COIN_DASH, 'src/move.ts'), 'utf8') });
  const e = await esbuildOf(); const guarded = await guardRules(e, root, dir);
  const map = { ...COIN_MAP, spots: { ...COIN_MAP.spots, coins: Array.from({ length: 296 }, (_, i) => [-8 + (i % 20) * 0.8, -6 + Math.floor(i / 20) * 0.8]) } };
  const r = await checkRules(e, root, 'many-entities', guarded.code, { map, tune: { public: { speed: { value: 6 } } }, seats: 8, sites: guarded.sites }, { allowance: { ticks: 2000 } });
  assert.equal(r.ticks, 2000); assert.ok(r.restores > 200);
  assert.doesNotMatch(r.information.join('\n'), /coin\.on\.take never ran/);
});
test('two-dimensional vectors are accepted by fields and event payloads', async () => {
  const model = structuredClone(checked);
  model.schema.kinds[0].fields.push(['target', { t: 'vec3' }]);
  model.declarations.events.at = [['pos', { t: 'vec3' }]];
  const rules = source.replace('self.cards = world.shared.cards;', "self.cards = world.shared.cards; self.target = {x:1,y:2}; world.send(self.id, 'at', {pos:{x:1,y:2}});");
  const dir = writeGame(root, 'vector-values', { rules });
  writeFileSync(join(dir, 'src/view.ts'), 'export {};');
  await typecheckRules(root, { id: 'vector-values', dir }, model, {});
});

test('late waves observe the declared round deadline', async () => {
  const result = await generated(`import {defineRules} from '@homie-rocks/studio/rules';
export default defineRules({contract:2,space:{dims:2},shapes:{events:{wave:{}}},entities:{slime:{tick(world,self){if(world.round.endsAt < 100) throw new Error('changed deadline');}}},room:{rounds:{seconds:10,breakSeconds:2},start(world){world.after(world.ticks(2),'wave',{});},on:{wave(world){if(world.round.phase === 'live') world.spawn('slime',{x:0,y:0});}}}});`, 'late-wave');
  assert.doesNotMatch(result.information.join('\n'), /slime\.tick never ran/);
});
test('unobserved defensive handlers are information with a declaration line', async () => {
  const result = await generated(`import {defineRules} from '@homie-rocks/studio/rules';
export default defineRules({contract:2,space:{dims:2},entities:{dot:{}},room:{on:{undeliverable(){}}}});`, 'defensive');
  assert.match(result.information.join('\n'), /rules.ts:2.*room.on.undeliverable.*never ran/);
});
test('think returning a key its kind does not declare refuses the build; a live room ignores the key', async () => {
  await assert.rejects(generated(lifecycle.replace("defineRules, defineMove", "defineRules, defineMove, f").replace('tick(world, self) { BODY }', "input:{ax:f.i8()},think(){return {x:127,ax:0};}").replace('HANDLERS', '').replace('rounds: {', 'bots:{keep:2},rounds: {'), 'think-keys'), /player\.think: think returned "x", which is not an input this kind declares\. A live room does not stop for this: it ignores it/);
});
test('round cleanup refuses persistent entity growth at the room cap', async () => {
  await assert.rejects(generated(`import {defineRules} from '@homie-rocks/studio/rules';
export default defineRules({contract:2,space:{dims:2},entities:{orb:{}},room:{rounds:{seconds:1,breakSeconds:0.2},on:{roundStart(world){for(let i=0;i<64;i++)world.spawn('orb',{x:0,y:0});}}}});`, 'round-growth'), /room\.on\.roundStart: a room holds at most 2048 entities\. This was tick \d+ of the generated play \(.*round \d+\)/);
});

test('a compiler that never ends is ended from outside, and that is said to be the compiler, not the rules', async () => {
  const {runRulesCompiler} = await import('../lib/rules-compiler.mjs');
  const file = join(root,'compiler.cjs');writeFileSync(file,'while(true){}');
  await assert.rejects(runRulesCompiler(file,[],{superviseSeconds:1}),/The rules compiler was still running after 1 seconds and was ended from outside\. This is a fault in the compiler, not a type error in the rules/);
  writeFileSync(file,"setTimeout(()=>process.stdout.write('done'),200)");
  assert.equal((await runRulesCompiler(file,[],{superviseSeconds:30})).stdout,'done');
});

test('a scheduled wave at ninety seconds is exercised at its actual deadline', async () => {
  await assert.rejects(generated(`import {defineRules} from '@homie-rocks/studio/rules';
export default defineRules({contract:2,space:{dims:2},shapes:{events:{wave:{}}},entities:{dot:{}},room:{rounds:{seconds:100,breakSeconds:2},start(world){world.after(world.ticks(90),'wave',{});},on:{wave(world){if(world.round.phase==='live'&&world.tick>=world.ticks(90))throw new Error('ninety-second wave reached');}}}});`,'ninety-wave'),/ninety-second wave reached/);
});
test('an import outside the game names the importing author line', async () => {
  const {guardRules} = await import('../lib/rules-guard.mjs');
  writeFileSync(join(root,'outside.ts'),'export const x=1;');
  const dir=writeGame(root,'import-source',{rules:`import {defineRules,f} from '@homie-rocks/studio/rules';
import {x} from '../../outside';
export default defineRules({contract:2,space:{dims:2},entities:{dot:{fields:{n:f.u8({init:x})}}}});`});
  const result=await guardRules(await esbuildOf(),root,dir);
  assert.ok(result.problems.some(p=>p.file.endsWith('import-source/src/rules.ts')&&p.line===2&&/own game/.test(p.message)),JSON.stringify(result.problems));
});

