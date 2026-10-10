import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,symlinkSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {newStudio} from '../lib/scaffold.mjs';import {newTool} from '../lib/tools-cli.mjs';import {buildTools} from '../lib/tools-build.mjs';import * as esbuild from 'esbuild';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
test('tool new produces typed code, auto-discovery rejects types, duplicate names and reserved built-ins',async()=>{
 const root=mkdtempSync(join(tmpdir(),'homie-tool-build-'));const studio=join(root,'studio');newStudio(studio,{name:'Tools',install:false});symlinkSync(join(repo,'node_modules'),join(studio,'node_modules'));
 try{
  const made=newTool(studio,'tonight-special');assert.deepEqual(await buildTools(studio,esbuild),['tonight_special']);
  const good=readFileSync(made.file,'utf8');
  const part=join(studio,'parts','shared-tool');mkdirSync(part,{recursive:true});
  writeFileSync(join(part,'part.json'),JSON.stringify({id:'shared-tool',name:'Shared tool',version:'1.0.0',kind:'code',entry:'tool.ts'}));
  writeFileSync(join(part,'tool.ts'),good);writeFileSync(made.file,"export {default} from '@parts/shared-tool';\n");
  assert.deepEqual(await buildTools(studio,esbuild),['tonight_special']);
  writeFileSync(made.file,good);writeFileSync(made.file,good.replace('return { message,','const invalid: number = message; return { message,'));await assert.rejects(buildTools(studio,esbuild),/not assignable/);
  writeFileSync(made.file,good);const other=newTool(studio,'another');writeFileSync(other.file,good);await assert.rejects(buildTools(studio,esbuild),/duplicated/);
  rmSync(other.file);writeFileSync(made.file,good.replace("name: 'tonight_special'","name: 'studio_office'"));await assert.rejects(buildTools(studio,esbuild),/reserved/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
