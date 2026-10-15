import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {toolDatabase} from '../worker/tool-database.mjs';
import {MCP_MIGRATION} from '../worker/mcp-store.mjs';
test('capacity action admits one of six simultaneous requests and rejects invalid input',async()=>{
 const result=await build({entryPoints:['plugins/homie/skills/app/examples/reserve.mjs'],bundle:true,write:false,format:'esm',platform:'node'});
 const {default:reserve}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const sql=new DatabaseSync(':memory:');sql.exec(MCP_MIGRATION);sql.exec('ALTER TABLE tool_data ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
 const stmt=(q,args=[])=>({bind:(...a)=>stmt(q,a),first:async()=>sql.prepare(q).get(...args)??null});
 const database=toolDatabase({prepare:stmt},'capacity');
 try{
 await database.put('tee-0900',{remaining:1,bookings:[]},{version:0});
 const results=await Promise.all(Array.from({length:6},(_,i)=>reserve.handler({slot:'tee-0900'},{database,caller:{id:'guest-'+i}})));
 assert.equal(results.filter(r=>r.ok).length,1);const row=await database.getVersioned('tee-0900');assert.equal(row.value.remaining,0);assert.equal(row.value.bookings.length,1);assert.equal(row.version,2);
 const {CfWorkerJsonSchemaValidator}=await import('@modelcontextprotocol/server/validators/cf-worker');
 const validator=new CfWorkerJsonSchemaValidator().getValidator(reserve.inputSchema);
 assert.equal(validator({slot:'tee-0900',remaining:20}).valid,false);assert.equal(validator({slot:4}).valid,false);
 }finally{sql.close();}
});
