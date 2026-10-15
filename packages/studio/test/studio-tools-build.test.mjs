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

 test('function new builds typed code, stable cron configuration and rejects duplicate names',async()=>{
 const root=mkdtempSync(join(tmpdir(),'homie-function-build-'));const studio=join(root,'studio');newStudio(studio,{name:'Functions',install:false});symlinkSync(join(repo,'node_modules'),join(studio,'node_modules'));
 try{
  const {functionCommand}=await import('../lib/functions-cli.mjs');const {buildFunctions}=await import('../lib/functions-build.mjs');
  const made=await functionCommand(studio,'new',['function','new','paid-order'],new Map([['event','order.paid']]));
  const good=readFileSync(made.file,'utf8');assert.equal((await buildFunctions(studio,esbuild))[0].event,'order.paid');
  const config=readFileSync(join(studio,'wrangler.jsonc'),'utf8');await buildFunctions(studio,esbuild);assert.equal(readFileSync(join(studio,'wrangler.jsonc'),'utf8'),config);
  assert.ok(JSON.parse(config.replace(/^\s*\/\/.*$/gm,'')).triggers.crons.includes('* * * * *'));
  writeFileSync(made.file,good.replace('await context.database.put', 'const bad: number = event.id; await context.database.put'));await assert.rejects(buildFunctions(studio,esbuild),/not assignable/);
  const logs=[];writeFileSync(made.file,good.replace("event: \"order.paid\",","event: \"order.paid\", schedule: '*/15 * * * *',"));
  await buildFunctions(studio,esbuild,{log:m=>logs.push(m)});
  assert.ok(logs.length>0);
  writeFileSync(made.file,good.replace("event: \"order.paid\",","event: \"order.paid\", schedule: '99 9 * * *',"));
  await assert.rejects(buildFunctions(studio,esbuild),/paid-order cannot run: invalid schedule/);
  writeFileSync(made.file,good);writeFileSync(join(studio,'functions','duplicate.ts'),good);await assert.rejects(buildFunctions(studio,esbuild),/unique name/);
  await assert.rejects(functionCommand(studio,'fire',['function','fire','order.paid'],new Map([['url','https://studio.example']])),/local testing/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
