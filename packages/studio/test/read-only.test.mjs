import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import worker from '../worker/index.mjs';
import {signPayload} from '../worker/stripe.mjs';
import {readOnlyCommand} from '../lib/read-only.mjs';
import {Table} from '../worker/table.mjs';
import {DatabaseSync} from 'node:sqlite';

const cat={studio:{name:'Example',slug:'example'},games:[]};
const WRITE=/^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i;
/** A D1 stand-in that answers every read with no rows (a save's write says it took) and remembers every statement it ran. */
function spyDatabase() {
  const ran=[];
  const statement=(sql,args=[])=>({sql,bind:(...a)=>statement(sql,a),
    first:async()=>{ran.push(sql);return /RETURNING version/.test(sql)?{version:1}:null;},all:async()=>{ran.push(sql);return {results:[]};},
    run:async()=>{ran.push(sql);return {success:true,meta:{changes:1}};},raw:async()=>{ran.push(sql);return [];}});
  return {ran,writes:()=>ran.filter(sql=>WRITE.test(sql)),prepare:sql=>statement(sql),batch:async list=>{for(const s of list)ran.push(s.sql);return list.map(()=>({results:[]}));}};
}
const studioEnv=(extra={})=>({ASSETS:{fetch:async()=>Response.json(cat)},...extra});
async function call(env,path,init) {
  const waits=[];
  const res=await worker.fetch(new Request('https://studio.example'+path,init),env,{waitUntil:p=>waits.push(p)});
  await Promise.allSettled(waits);
  return res;
}

test('read-only: a write is refused with 503, Retry-After and the header, and reaches no database',async()=>{
  const DB=spyDatabase();
  const res=await call(studioEnv({STUDIO_READ_ONLY:'1',DB}),'/api/stats/beat',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(res.status,503);
  assert.equal(res.headers.get('x-studio-read-only'),'1');
  assert.ok(Number(res.headers.get('retry-after'))>0);
  const body=await res.json();
  assert.equal(body.ok,false);assert.equal(body.error,'read-only');assert.equal(typeof body.message,'string');
  assert.deepEqual(DB.ran,[]);
});

test('read-only: pages and reads keep answering, with the notice, and write nothing to D1',async()=>{
  // A person's page view is counted (a D1 write) when the studio is open; read-only, the page answers and counts nothing.
  const visit={headers:{'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36','sec-fetch-dest':'document'}};
  const openDb=spyDatabase();
  const open=await call(studioEnv({DB:openDb}),'/',visit);
  assert.equal(open.headers.get('x-studio-read-only'),null);
  assert.doesNotMatch(await open.text(),/data-studio-read-only/);
  assert.ok(openDb.writes().length>0,'an open studio counts the visit');
  const DB=spyDatabase();
  const page=await call(studioEnv({STUDIO_READ_ONLY:'1',DB}),'/',visit);
  assert.equal(page.status,200);
  assert.equal(page.headers.get('x-studio-read-only'),'1');
  assert.match(await page.text(),/data-studio-read-only/);
  assert.deepEqual(DB.writes(),[]);
  for(const method of ['HEAD','OPTIONS'])assert.notEqual((await call(studioEnv({STUDIO_READ_ONLY:'1'}),'/',{method})).status,503,method);
});

test('read-only: /api/games reports the switch, so a tool can check it without a write',async()=>{
  const on=await (await call(studioEnv({STUDIO_READ_ONLY:'1'}),'/api/games')).json();
  assert.equal(on.readOnly,true);
  const off=await (await call(studioEnv(),'/api/games')).json();
  assert.equal(off.readOnly,false);
});

test('read-only: the Stripe webhook still records a paid event, so payments made are fulfilled',async()=>{
  const DB=spyDatabase(),sent=[],secret='whsec_readonlyfixture';
  const payload=JSON.stringify({id:'evt_readonly',type:'checkout.session.completed',data:{object:{}}});
  const t=Math.floor(Date.now()/1000);
  const res=await call(studioEnv({STUDIO_READ_ONLY:'1',DB,STRIPE_WEBHOOK_SECRET:secret,BACKGROUND:{send:async m=>sent.push(m)}}),'/api/shop/hook',
    {method:'POST',headers:{'stripe-signature':`t=${t},v1=${await signPayload(payload,secret,t)}`},body:payload});
  assert.equal(res.status,200);
  assert.ok(DB.writes().some(sql=>/INSERT INTO stripe_intake/.test(sql)),'the verified event is stored');
  assert.ok(sent.some(m=>m.type==='stripe.event'&&m.id==='evt_readonly'));
});

test('read-only: scheduled work writes nothing, and queued work waits except Stripe fulfilment',async()=>{
  const DB=spyDatabase();
  await worker.scheduled({cron:'*/5 * * * *',scheduledTime:Date.now()},studioEnv({STUDIO_READ_ONLY:'1',DB}),{waitUntil:()=>{}});
  assert.deepEqual(DB.writes(),[]);
  const queueDb=spyDatabase(),done=[];
  const message=body=>({body,ack:()=>done.push([body.type,'ack']),retry:o=>done.push([body.type,'retry',o?.delaySeconds])});
  await worker.queue({messages:[message({v:1,type:'studio.changed',origin:'https://studio.example'}),message({v:1,type:'stripe.event',id:'evt_readonly'})]},studioEnv({STUDIO_READ_ONLY:'1',DB:queueDb}));
  const changed=done.find(d=>d[0]==='studio.changed');
  assert.equal(changed[1],'retry');assert.ok(changed[2]>=60,'retried after the read-only window');
  assert.ok(queueDb.ran.some(sql=>/UPDATE stripe_intake/.test(sql)),'the Stripe event is reconciled with the full database');
});

test('read-only: a live room keeps its round record in its outbox and writes it to D1 once the studio is open',async()=>{
  // The room's own storage (Durable Object SQLite) holds the record; D1 is the studio's database.
  const sql=new DatabaseSync(':memory:');
  const storage={sql:{exec:(q,...a)=>{const st=sql.prepare(q);return /^\s*SELECT/i.test(q)?{toArray:()=>st.all(...a)}:(st.run(...a),{toArray:()=>[]});}},getAlarm:async()=>null,setAlarm:async()=>{},get:async()=>undefined,put:async()=>{},delete:async()=>{}};
  sql.exec('CREATE TABLE round_outbox(id TEXT PRIMARY KEY,player TEXT,key TEXT,value TEXT)');
  sql.prepare('INSERT INTO round_outbox VALUES(?,?,?,?)').run('p1:server:matches:r1','p1','server:matches',JSON.stringify({id:'r1',at:1}));
  const room=(env)=>{const table=new Table({storage,waitUntil:()=>{},blockConcurrencyWhile:fn=>fn()},env);table.game='example';table.code='room-1';return table;};
  const DB=spyDatabase();
  await room({STUDIO_READ_ONLY:'1',DB}).flushRoundRecords();
  assert.deepEqual(DB.writes(),[],'no write reaches D1 while read-only');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM round_outbox').get().n,1,'the record waits in the room');
  const openDb=spyDatabase();
  await room({DB:openDb}).flushRoundRecords();
  assert.ok(openDb.writes().some(q=>/\bsaves\b/.test(q)),'open again, the record is written');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM round_outbox').get().n,0);
});

test('read-only on|off|status sets and clears the STUDIO_READ_ONLY Worker secret and reads /api/games back',async t=>{
  const root=mkdtempSync(join(tmpdir(),'homie-read-only-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'studio.json'),JSON.stringify({name:'Example',cloudflare:{worker:'example-site',created:['worker:example-site']}}));
  let secrets=[];const calls=[];
  const run=async(args,opts={})=>{
    calls.push({args,input:opts.input});
    if(args[1]==='list')return {code:0,stdout:JSON.stringify(secrets.map(name=>({name,type:'secret_text'})))};
    if(args[1]==='put'){secrets=[...new Set([...secrets,args[2]])];return {code:0,stdout:''};}
    if(args[1]==='delete'){secrets=secrets.filter(n=>n!==args[2]);return {code:0,stdout:''};}
    return {code:1,out:'unexpected'};
  };
  const fetchFn=async url=>{assert.equal(String(url),'https://studio.example/api/games');return Response.json({readOnly:secrets.includes('STUDIO_READ_ONLY')});};
  const opts={run,fetchFn,url:'https://studio.example',wait:0};
  const on=await readOnlyCommand(root,'on',opts);
  assert.equal(on.ok,true);assert.equal(on.readOnly,true);assert.equal(on.live,true);
  const put=calls.find(c=>c.args[1]==='put');
  assert.deepEqual(put.args,['secret','put','STUDIO_READ_ONLY','--name','example-site']);
  assert.equal(put.input,'1\n');
  const status=await readOnlyCommand(root,'status',opts);
  assert.equal(status.readOnly,true);assert.equal(status.live,true);
  const off=await readOnlyCommand(root,'off',opts);
  assert.equal(off.ok,true);assert.equal(off.readOnly,false);assert.equal(off.live,false);
  assert.ok(calls.some(c=>c.args.join(' ')==='secret delete STUDIO_READ_ONLY --name example-site'));
  const again=await readOnlyCommand(root,'off',opts);
  assert.equal(again.ok,true);assert.equal(again.already,true,'turning it off twice changes nothing');
  await assert.rejects(readOnlyCommand(root,'maybe',opts),/on, off or status/);
});
