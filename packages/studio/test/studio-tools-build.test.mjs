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
  writeFileSync(made.file,good);writeFileSync(join(studio,'functions','duplicate.ts'),good);await assert.rejects(buildFunctions(studio,esbuild),/unique name/);
  await assert.rejects(functionCommand(studio,'fire',['function','fire','order.paid'],new Map([['url','https://studio.example']])),/local testing/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('priced tools use the existing keyless Stripe link sync and immutable service terms',async()=>{
 const root=mkdtempSync(join(tmpdir(),'homie-service-links-'));const studio=join(root,'studio');newStudio(studio,{name:'Services',install:false});symlinkSync(join(repo,'node_modules'),join(studio,'node_modules'));
 try{
  const made=newTool(studio,'translate');writeFileSync(made.file,readFileSync(made.file,'utf8').replace("name: 'translate',","name: 'translate', price: {amount:250,currency:'usd'},"));
  const {syncPurchaseLinks}=await import('../lib/purchase-links.mjs');const {purchaseLink}=await import('../worker/purchase-links.mjs');let writes=0;
  const {config}=await syncPurchaseLinks({root:studio,slug:'services',site:'https://services.test',mode:'test',till:'stripe',list:async()=>[],api:async(_method,path)=>{writes++;return {id:path==='/v1/products'?'prod_test':path==='/v1/prices'?'price_test':'plink_test',active:true,url:'https://buy.stripe.com/test'};}});
  assert.equal(writes,3);assert.equal(config.offers.length,1);const link=config.offers[0];assert.equal(link.kind,'service');assert.equal(link.resource,'translate');
  const env={STRIPE_SHOP_LINKS:JSON.stringify({v:1,mode:'test',items:[]}),PURCHASE_LINKS:JSON.stringify(config)};
  const order={quantity:1,resource_kind:'service',resource_id:'argument-dependent-hash',manifest:JSON.stringify({tool:'translate',version:'1.0.0'}),offer:link.offer};
  assert.equal(purchaseLink(env,order).id,'plink_test');assert.equal(purchaseLink(env,{...order,offer:JSON.stringify({...JSON.parse(link.offer),amount:500})}),undefined);
 }finally{rmSync(root,{recursive:true,force:true});}
});
