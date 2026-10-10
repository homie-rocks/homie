import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

const helper=new URL('./test/mcp-stdio.mjs',import.meta.url).href;
for(const mode of ['reply','exit'])test(`desktop MCP client releases timers after ${mode}`,{timeout:10000},()=>{
  const server=mode==='reply'
    ? `process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{for(const line of s.trim().split('\\n')){const q=JSON.parse(line);console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{ok:true}}));}});`
    : `process.stdin.once('data',()=>process.exit(0));`;
  // The parent must exit naturally, well before the client's 60-second request
  // deadline. force-exit or unref would conceal unfinished requests/cleanup.
  const source=`import assert from 'node:assert/strict';import {talk} from ${JSON.stringify(helper)};
    const s=talk(process.execPath,['-e',${JSON.stringify(server)}]);
    try{${mode==='reply'
      ? "assert.equal((await s.request('ping')).result.ok,true);"
      : "await assert.rejects(s.request('ping'),/MCP server closed/);"}}
    finally{await s.close();await s.close();}`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:5000});
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,0,result.stderr);
});
