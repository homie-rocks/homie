import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {guardFiles} from '../lib/rules-guard.mjs';
import {esbuildOf,writeGame} from './rules-kit.mjs';

test('rules traverse extracted parts and aliases, guarding every dependency and refusing escapes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'rules-parts-'));
 try {
  const dir=writeGame(root,'game',{rules:"import { score } from './lifted'; export function points() { return score(2); }"});
  const part=join(root,'parts','score');mkdirSync(part,{recursive:true});
  writeFileSync(join(part,'part.json'),JSON.stringify({id:'score',name:'Score',kind:'mechanic',version:'1.0.0',entry:'score.ts'}));
  writeFileSync(join(part,'score.ts'),'export function score(n: number) { return n * 10; }');
  writeFileSync(join(dir,'src','lifted.ts'),"export * from '../../parts/score/score.ts';");
  const esbuild=await esbuildOf(),run=()=>guardFiles(esbuild,root,dir,join(dir,'src','rules.ts'));
  let result=await run();assert.deepEqual(result.problems,[]);assert.equal(result.files.size,3);
  writeFileSync(join(dir,'src','lifted.ts'),"export { score } from '@parts/score';");
  result=await run();assert.deepEqual(result.problems,[]);assert.equal(result.files.size,3);
  writeFileSync(join(part,'score.ts'),'export function score() { return Date.now(); }');
  result=await run();assert.match(result.problems.map(p=>p.message).join(' '),/Date is not available/);
  writeFileSync(join(root,'outside.ts'),'export function score() { return 1; }');
  writeFileSync(join(part,'score.ts'),"export { score } from '../../outside.ts';");
  result=await run();assert.match(result.problems.map(p=>p.message).join(' '),/own game or registered parts/);
  rmSync(join(part,'score.ts'));symlinkSync(join(root,'outside.ts'),join(part,'score.ts'));
  result=await run();assert.match(result.problems.map(p=>p.message).join(' '),/own game or registered parts/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
