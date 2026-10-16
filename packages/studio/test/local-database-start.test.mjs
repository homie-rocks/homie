import {tmpdir} from 'node:os';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareLocalDatabase} from '../lib/local-database-start.mjs';

test('local serving is gated on migrations then function registration',async()=>{
 const calls=[];
 assert.equal(await prepareLocalDatabase({register:async()=>{calls.push('register');return true;},migrate:async()=>{calls.push('migrate');return true;}}),null);
 assert.deepEqual(calls,['migrate','register']);
});
test('failed migration never registers functions or permits serving',async()=>{
 assert.equal(await prepareLocalDatabase({migrate:async()=>false,register:()=>assert.fail('must not register')}),'Local database migration failed; fix the D1 error above before serving requests.');
});
test('failed registration never permits serving',async()=>{
 assert.match(await prepareLocalDatabase({migrate:async()=>true,register:async()=>false}),/registration failed/);
});

test('the first notice on a fresh local database reaches its registered function',async t=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync}=await import('node:fs');
 const {join}=await import('node:path');
 const {functionDeploymentSQL}=await import('../lib/functions-build.mjs');
 const {emitEvent,runFunctions}=await import('../worker/functions.mjs');
 const root=mkdtempSync(join(tmpdir(),'homie-functions-'));
 const sql=new DatabaseSync(':memory:');
 t.after(()=>{sql.close();rmSync(root,{recursive:true,force:true});});
 mkdirSync(join(root,'site/src/functions'),{recursive:true});
 writeFileSync(join(root,'studio.json'),'{}');
 writeFileSync(join(root,'site/src/functions/declarations.json'),JSON.stringify([{name:'notice',event:'notice'}]));
 const stmt=(q,a=[])=>({bind:(...v)=>stmt(q,v),first:async()=>sql.prepare(q).get(...a)??null,all:async()=>({results:sql.prepare(q).all(...a)}),run:async()=>({meta:{changes:sql.prepare(q).run(...a).changes}})});
 const DB={prepare:stmt,batch:xs=>Promise.all(xs.map(x=>x.run()))};
 const failure=await prepareLocalDatabase({migrate:async()=>{
   const migrations=new URL('../../../template/site/migrations/',import.meta.url);
   for(const file of readdirSync(migrations).sort())sql.exec(readFileSync(new URL(file,migrations),'utf8'));
   return true;
 },register:async()=>{sql.exec(functionDeploymentSQL(root));return true;}});
 assert.equal(failure,null);
 let notices=0;
 await emitEvent({DB},'notice',{text:'first'},{id:'first-notice'});
 await runFunctions({DB},{games:[]},'https://studio.example',{definitions:[{name:'notice',event:'notice',handler:event=>{assert.equal(event.data.text,'first');notices++;}}]});
 assert.equal(notices,1);
});
