/** Full builds of map payloads, companion views and away play. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRules } from '../lib/rules-build.mjs';
import { esbuildOf, writeGame, COIN_MAP, COIN_DASH } from './rules-kit.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-third-corpus-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
const cases = [
 ['n4-map-in-event'], ['n3c-goal-variable'], ['n3b-goal-helper'],
 ['w08-ledger-cleared-mid-protocol', /room.on.emptied.*holds itself|room.on.emptied.*absent/],
 ['ua-say-text'], ['ue-say-slot-math'], ['uc-button-arg', /place.*does not exist/s],
 // A light game whose fault is twelve and a half minutes into a match: the default play is a quarter of an hour.
 ['x7-minute-thirteen', /rules\.ts:16 runner\.tick: runner\.fields\.gear\[0\] was written NaN.*This was tick 15002 of the generated play/],
 // A heavy game whose map passes its size in its fourteenth round: the first room is played that far by default.
 ...(process.env.RULES_EXTENDED ? [['m1-big-map'], ['m5-forty-sentries'], ['l3-heavy-map-of-13', /rules\.ts:\d+ room\.on\.roundStart: shared\.hist was changed in place in this handler \(not assigned\), and when the handler ended it held a map of 14 keys for a size of 13/]] : []),
];
for (const [id, refusal] of cases) test(`declared boundary: ${id}`, async () => {
  const base = new URL(`./fixtures/rules-boundaries/${id}/`, import.meta.url);
  const read = (name, fallback) => existsSync(new URL(name, base)) ? readFileSync(new URL(name, base), 'utf8') : fallback;
  const dir = writeGame(root, id, { rules: read('rules.ts'), move: read('move.ts', null) });
  writeFileSync(join(dir, 'src/view.ts'), read('view.ts', 'export {};'));
  mkdirSync(join(dir, 'map')); writeFileSync(join(dir, 'map/main.json'), read('map.json',readFileSync(join(COIN_DASH,'map/main.json'),'utf8')));
  for (const name of ['agents.json', 'tunables.json']) if (existsSync(new URL(name, base))) writeFileSync(join(dir, name), read(name));
  const meta = JSON.parse(read('game.json', '{"players":{"max":8}}'));
  const logs = [];
  const build = () => prepareRules(esbuild, root, { ...meta, id, dir }, { log: m => logs.push(m) });
  const esbuild = await esbuildOf();
  if (refusal) await assert.rejects(build, refusal);
  else await build();
});

test('button arguments narrow by their declared request', async () => {
 const base = new URL('./fixtures/rules-boundaries/uc-button-arg/', import.meta.url);
 const dir=writeGame(root,'typed-buttons',{rules:readFileSync(new URL('rules.ts',base),'utf8')});
 writeFileSync(join(dir,'src/view.ts'),readFileSync(new URL('view.ts',base),'utf8').replace('el.title = b.args.place;', "if(b.k==='visit') el.title = b.args.place;"));
 mkdirSync(join(dir,'map'));writeFileSync(join(dir,'map/main.json'),readFileSync(new URL('map.json',base)));
 writeFileSync(join(dir,'agents.json'),readFileSync(new URL('agents.json',base)));
 await prepareRules(await esbuildOf(),root,{id:'typed-buttons',dir,players:{max:8}});
});
