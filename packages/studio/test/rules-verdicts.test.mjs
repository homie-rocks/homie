import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRules } from '../lib/rules-build.mjs';
import { esbuildOf, writeGame, COIN_MAP } from './rules-kit.mjs';
import { source, vocab } from './rules-feature-kit.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-verdicts-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
async function build(id, rules, vocabulary) {
  const dir = writeGame(root, id, { rules });
  writeFileSync(join(dir, 'src/view.ts'), 'export {};');
  mkdirSync(join(dir, 'map')); writeFileSync(join(dir, 'map/main.json'), JSON.stringify(COIN_MAP));
  if (vocabulary) writeFileSync(join(dir, 'agents.json'), JSON.stringify(vocabulary));
  return prepareRules(await esbuildOf(), root, { id, dir, players: { max: 4 } });
}
const game = body => `import {defineRules,f} from '@homie-rocks/studio/rules';
export default defineRules({contract:2,space:{dims:2},shapes:{events:{close:{round:f.u16()}}},shared:{winners:f.list(f.u8(),5)},entities:{crate:{}},room:{rounds:{seconds:1,breakSeconds:1},on:{roundStart(world){${body}},close(world,e){if(e.round===world.round.n)world.round.end();}}}});`;
for (const [id, body] of [
  ['last-five', 'const winners=[...world.shared.winners,1]; if(winners.length>5)winners.shift(); world.shared.winners=winners;'],
  ['bounded-crates', "if(world.round.n<10)world.spawn('crate',{x:0,y:0});"],
  ['guarded-timers', "world.after(world.ticks(45),'close',{round:world.round.n});"],
]) test(`bounded growth builds: ${id}`, async () => { await build(id, game(body)); });
test('a manual round that the generated play did not end is said in its one line, and builds', async () => {
  const r = await build('manual', game('').replace('seconds:1', 'seconds:0'));
  assert.match(r.check.information[0], /, 0 rounds finished,/);
});
test('the shared feature fixture builds whole with its vocabulary', async () => { await build('kit', source, vocab); });
test('a round history map is refused only when its declared cap is exceeded', async () => {
  const rules = game("world.shared.history['r'+world.round.n]=1;")
    .replace('winners:f.list(f.u8(),5)', 'winners:f.list(f.u8(),5),history:f.map(f.u8(),8)');
  await assert.rejects(build('history-overflow', rules), /room\.on\.roundStart: shared\.history was changed in place in this handler \(not assigned\), and when the handler ended it held a map of 9 keys for a size of 8/);
});
test('a repeated timer chain is refused at its real pending queue cap', async () => {
  const rules = game("world.after(world.ticks(3600),'close',{round:world.round.n});")
    .replace('entities:{crate:{}}', "entities:{crate:{tick(world){for(let i=0;i<8;i++)world.after(world.ticks(3600),'close',{round:world.round.n});},on:{close(world,self,e){world.after(world.ticks(3600),'close',e);}}}}")
    .replace('room:{rounds:', "room:{start(world){world.spawn('crate',{x:0,y:0});},rounds:");
  await assert.rejects(build('timer-chain-cap', rules), /crate\.(?:tick|on\.close): this room already holds 16384 events and timers that are waiting/);
});
