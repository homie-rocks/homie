import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalCredential} from '../lib/local-test.mjs';
import {functionCommand} from '../lib/functions-cli.mjs';
import {connectToolClient} from '../lib/tools-cli.mjs';
test('CLI fires order.paid with booking/app reference and calls private tools without browser approval',{timeout:30000},async t=>{
 const root=mkdtempSync(join(tmpdir(),'homie-headless-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const secret=createLocalCredential(root);
 const bundled=await build({stdin:{resolveDir:new URL('../worker/',import.meta.url).pathname,contents:`import {remoteMcp} from './mcp.mjs';import {useFunctions} from './functions.mjs';useFunctions(async()=>[{name:'paid',event:'order.paid',handler:async(e,c)=>{await c.database.put(e.id,e.data);}}]);export default {fetch(req,env,ctx){return remoteMcp(req,env,ctx,{catalogueOf:async()=>({games:[]}),definitions:[{name:'echo',description:'Echo reference',audience:'owner',inputSchema:{type:'object'},handler:args=>args}]});}};`},bundle:true,write:false,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
 const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'headless',compatibilityDate:'2026-10-07',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{DB:{type:'d1',id:'headless'},HOMIE_LOCAL_TEST_SECRET:{type:'json',value:secret}}}}]});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort())for(const sql of readFileSync(new URL('../../../template/site/migrations/'+file,import.meta.url),'utf8').replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(sql.trim())await db.prepare(sql).run();
 const origin=(await mf.ready).origin;const reference={app:'boards',booking:'fitting-one'};
 const fired=await functionCommand(root,'fire',['function','fire','order.paid'],new Map([['url',origin],['input',JSON.stringify(reference)],['id','test-paid']]));assert.equal(fired.ok,true,JSON.stringify(fired));
 const row=await db.prepare("SELECT value FROM tool_data WHERE namespace='function:paid' AND key='test-paid'").first();assert.deepEqual(JSON.parse(row.value),reference);
 const client=await connectToolClient(root,origin,{open:()=>{throw Error('Browser approval attempted');}});try{const result=await client.callTool({name:'echo',arguments:reference});assert.equal(result.isError,undefined);assert.deepEqual(JSON.parse(result.content[0].text).data,reference);}finally{await client.close();}
});
