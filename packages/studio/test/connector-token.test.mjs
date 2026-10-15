import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MCP_MIGRATION} from '../worker/mcp-store.mjs';
test('authenticated CLI writes a private scoped connector; bearer expires and revokes',async()=>{
 const {connectorToken}=await import('../lib/connector-token.mjs');
 const {tokenCaller}=await import('../worker/connector-token.mjs');
 const dir=mkdtempSync(join(tmpdir(),'homie-token-'));const sql=new DatabaseSync(':memory:');sql.exec(MCP_MIGRATION);
 const stmt=(q,args=[])=>({bind:(...a)=>stmt(q,a),first:async()=>sql.prepare(q).get(...args)??null});const env={DB:{prepare:stmt}};
 const execute=async file=>{sql.exec(readFileSync(file,'utf8'));};
 try {
 const out=join(dir,'connector.json');const result=await connectorToken(dir,{url:'https://new.example',tools:['studio_stats'],out,execute});
 const config=JSON.parse(readFileSync(out,'utf8'));const authorization=config.mcpServers.studio.headers.Authorization;
 assert.equal(statSync(out).mode&0o777,0o600);assert.ok(!JSON.stringify(result).includes(authorization.slice(7)));
 assert.deepEqual((await tokenCaller(new Request('https://new.example/mcp/auth',{headers:{authorization}}),env)).tools,['studio_stats']);
 assert.equal(await tokenCaller(new Request('https://other.example/mcp/auth',{headers:{authorization}}),env),null);
 await connectorToken(dir,{revoke:result.id,execute});assert.equal(await tokenCaller(new Request('https://new.example/mcp/auth',{headers:{authorization}}),env),null);
 const second=await connectorToken(dir,{url:'https://new.example',tools:['studio_stats'],out:join(dir,'second.json'),execute});sql.exec('UPDATE mcp_kv SET expires=1');
 const auth2=JSON.parse(readFileSync(join(dir,'second.json'),'utf8')).mcpServers.studio.headers.Authorization;
 assert.equal(await tokenCaller(new Request('https://new.example/mcp/auth',{headers:{authorization:auth2}}),env),null);
 await assert.rejects(connectorToken(dir,{url:'https://new.example',tools:['*'],out:join(dir,'bad.json'),execute}),/explicit tool/);
 }finally{sql.close();rmSync(dir,{recursive:true,force:true});}
});
test('CLI uses authenticated Wrangler D1, prints only metadata, and parses revocation',async()=>{
 const {mkdirSync,writeFileSync}=await import('node:fs');const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const root=mkdtempSync(join(tmpdir(),'homie-connector-cli-'));
 try {
 writeFileSync(join(root,'studio.json'),JSON.stringify({name:'New studio',cloudflare:{url:'https://new.example'}}));
 writeFileSync(join(root,'wrangler.jsonc'),JSON.stringify({name:'new',d1_databases:[{binding:'DB',database_name:'new-db'}]}));
 mkdirSync(join(root,'node_modules','.bin'),{recursive:true});
 writeFileSync(join(root,'node_modules','.bin','wrangler'),`#!${process.execPath}\nrequire('node:fs').writeFileSync('invocation.json',JSON.stringify(process.argv.slice(2)));\n`,{mode:0o700});
 const cli=fileURLToPath(new URL('../bin/homie-studio.mjs',import.meta.url));
 const run=args=>spawnSync(process.execPath,[cli,'connector',...args,'--json'],{cwd:root,encoding:'utf8'});
 const minted=run(['--tools','studio_stats','--out','private.json']);assert.equal(minted.status,0,minted.stdout+minted.stderr);
 const result=JSON.parse(minted.stdout);const secret=JSON.parse(readFileSync(join(root,'private.json'),'utf8')).mcpServers.studio.headers.Authorization;
 assert.ok(!(minted.stdout+minted.stderr).includes(secret.slice(7)));
 assert.deepEqual(JSON.parse(readFileSync(join(root,'invocation.json'),'utf8')).slice(0,5),['d1','execute','new-db','--remote','--file']);
 const revoked=run(['--revoke',result.id]);assert.equal(revoked.status,0,revoked.stdout+revoked.stderr);assert.equal(JSON.parse(revoked.stdout).revoked,result.id);
 }finally{rmSync(root,{recursive:true,force:true});}
});
