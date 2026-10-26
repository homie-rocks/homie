/**
 * The independent reviews' games, through the public build: 74 with a planted fault and 15 without.
 * Each faulty one says where it is stopped (fixtures/rules-admission/index.json): by the wall (`guard`), by the
 * compiler (`types`), or by the generated play (`generated`, with the message it must give). `built` is a fault the
 * play does not prove (a game that cannot be won, a rule that is unfair): the build is right to pass it, and the index
 * says why it is there (`says`: a line of information the build must print about it). A correct game must build.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRules } from '../lib/rules-build.mjs';
import { esbuildOf, writeGame, COIN_DASH } from './rules-kit.mjs';
const fixtures = new URL('./fixtures/rules-admission/', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('index.json', fixtures), 'utf8'));
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-corpus-')));
test.after(() => rmSync(root, {recursive:true,force:true}));
const correctRoot = new URL('./fixtures/rules-valid-games/', import.meta.url);
cases.push(...JSON.parse(readFileSync(new URL('index.json',correctRoot),'utf8')));
const selected = process.env.RULES_EXTENDED ? cases : cases.filter(c => ['f02-module-let','f09-list-overflow','f24-empty-room-throw','f38-budget-every-tick','f40-math-random','n11-winners-list-grows','f05-score-nan','c1-capture-flag'].includes(c.id));
for (const item of selected) test(`rules corpus: ${item.id}`, async () => {
  const source = new URL(`${item.id}/`, item.correct ? correctRoot : fixtures);
  const get = (name, fallback) => existsSync(new URL(name, source)) ? readFileSync(new URL(name, source), 'utf8') : fallback;
  const dir = writeGame(root, item.id, {rules:get('rules.ts',''),move:get('move.ts',null)});
  writeFileSync(join(dir,'src/view.ts'),get('view.ts','export {};'));
  for (const name of ['helper.ts','helper.js']) if (existsSync(new URL(name,source))) cpSync(new URL(name,source),join(dir,'src',name));
  mkdirSync(join(dir,'map'));writeFileSync(join(dir,'map/main.json'), get('map.json',readFileSync(join(COIN_DASH,'map/main.json'),'utf8')));
  writeFileSync(join(dir,'tunables.json'), get('tunables.json','{}'));
  const meta = JSON.parse(get('game.json','{"players":{"max":8}}'));
  const logs=[]; let message=''; let result;
  try { result=await prepareRules(await esbuildOf(),root,{...meta,id:item.id,dir},{log:m=>logs.push(m)}); } catch(e) {message=e.message;}
  const stage = message.includes('its rules were refused') ? 'guard' : message.includes('type errors') ? 'types' : message ? 'generated' : 'built';
  if (process.env.RULES_CORPUS_RECORD) writeFileSync(join(process.env.RULES_CORPUS_RECORD,`${item.id}.json`),JSON.stringify({stage,message,logs,check:result?.check}));
  if(item.correct) { assert.equal(message,'',message); return; }
  assert.equal(stage,item.stage,`${item.what}\n${message}\n${logs.join('\n')}`);
  if (item.match) assert.match(message,new RegExp(item.match));
  // What the runtime held to a range is said with its own count: information, never a refusal.
  if (item.says) assert.match((result?.check?.information ?? []).join('\n'),new RegExp(item.says));
});
