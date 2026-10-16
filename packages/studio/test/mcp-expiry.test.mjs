import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MCP_MIGRATION,oauthStorage} from '../worker/mcp-store.mjs';
import {pruneMcpKeys,pushEvents,pushToolList} from '../worker/event-resources.mjs';

test('MCP expiry preserves live OAuth, dedupe and stream rows and removes expired rows',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(MCP_MIGRATION);
 const statement=(query,args=[])=>({bind:(...a)=>statement(query,a),run:async()=>({meta:sql.prepare(query).run(...args)}),first:async()=>sql.prepare(query).get(...args),all:async()=>({results:sql.prepare(query).all(...args)})});
 const DB={prepare:q=>statement(q)},kv=oauthStorage(DB),now=Math.floor(Date.now()/1000);
 try{
  for(const key of ['oauth:token','oauth:code','delivery:tool:abcdefgh','tools-stream:live','mcp-event-stream:live']){
   await kv.put(key,JSON.stringify({connection:key}),{expiration:now+600});
   await kv.put(key+':expired','{}',{expiration:now-1});
  }
  await kv.put('permanent','kept');
  await pruneMcpKeys({DB});
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM mcp_kv').get().n,6);
  assert.equal(await kv.get('permanent'),'kept');
  assert.ok(await kv.get('oauth:code'));
  assert.equal(sql.prepare("INSERT OR IGNORE INTO mcp_kv VALUES('delivery:tool:abcdefgh','true',?)").run(now+600).changes,0,'webhook retry remains deduplicated');
  const wakes=[];const env={DB,STUDIO_EVENT_FEEDS:'{"feed":{"event":"test"}}',LOBBY:{idFromName:x=>x,get:id=>({fetch:async()=>{wakes.push(id);return new Response();}})}};
  await pushEvents(env,{},'https://example.test');assert.equal(wakes.length,2);
  wakes.length=0;await pushToolList(env,{},[],'https://example.test');assert.equal(wakes.length,1);
 }finally{sql.close();}
});
