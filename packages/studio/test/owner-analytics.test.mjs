import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './place-database.mjs';
import {writePageMetric,rollupAnalytics} from '../worker/analytics.mjs';

test('analytics page rollups preserve old counts and replay atomically without double counting', async t => {
 const DB=database(t),day='2026-10-15',points=[];
 await DB.prepare("INSERT INTO stats_daily VALUES(?1,'visit','cafe','',10)").bind(day).run();
 let n=7;
 const env={DB,STUDIO_ANALYTICS_DATASET:'studio_visits',STUDIO_ANALYTICS:{writeDataPoint:p=>points.push(p)},ANALYTICS_SQL:{query:async({query})=>{assert.match(query,/SUM\(_sample_interval \* double1\)/);return {data:[{day,metric:'visit',subject:'cafe',source:'',n}]};}}};
 assert.equal(writePageMetric(env,{metric:'visit',subject:'cafe',day}),true);
 assert.equal(points.length,1);assert.deepEqual(points[0].blobs,[day,'visit','cafe','']);
 assert.equal(writePageMetric(env,{metric:'room'}),false);
 await rollupAnalytics(env);await rollupAnalytics(env);
 assert.equal((await DB.prepare('SELECT n FROM stats_daily').first()).n,17);
 n=9;await rollupAnalytics(env);assert.equal((await DB.prepare('SELECT n FROM stats_daily').first()).n,19);
 n=8;await rollupAnalytics(env);assert.equal((await DB.prepare('SELECT n FROM stats_daily').first()).n,18);
});

test('owner totals retain history while analytics ingestion waits and explain the delay',async t=>{
 const {readStats}=await import('../worker/stats.mjs');
 const DB=database(t),day='2026-10-15';
 await DB.prepare("INSERT INTO stats_daily VALUES(?1,'visit','home','',10)").bind(day).run();
 let rows=[];
 const env={DB,STUDIO_ANALYTICS_DATASET:'studio_visits',STUDIO_ANALYTICS:{},ANALYTICS_SQL:{query:async()=>({data:rows})}};
 const read=()=>readStats(env,{games:[]},{range:{from:day,to:day,days:1}});
 await rollupAnalytics(env);
 const pending=await read();assert.equal(pending.totals.visits,10);assert.match(pending.note,/last hourly rollup/);
 rows=[{day,metric:'visit',subject:'home',source:'',n:3}];
 await rollupAnalytics(env);await rollupAnalytics(env);
 assert.equal((await read()).totals.visits,13);
});

test('unchanged rollups write no counter or watermark rows',async t=>{
 const DB=database(t),day='2026-10-15';
 const env={DB,STUDIO_ANALYTICS_DATASET:'studio_visits',ANALYTICS_SQL:{query:async()=>({data:[{day,metric:'visit',subject:'home',source:'',n:5}]})}};
 await rollupAnalytics(env);
 const before=DB.sql.prepare('SELECT total_changes() AS n').get().n;
 await rollupAnalytics(env);
 assert.ok(DB.sql.prepare('SELECT total_changes() AS n').get().n-before<=1,'only a rollup health timestamp may change');
});
test('daily pagination continues past a full page instead of freezing counts',async t=>{
 const DB=database(t),day='2026-10-15',pages=[];
 const env={DB,STUDIO_ANALYTICS_DATASET:'studio_visits',ANALYTICS_SQL:{query:async({params})=>{
  pages.push(params);return {data:params.day===day?(params.offset===0?[{day,metric:'visit',subject:'a',source:'',n:2},{day,metric:'visit',subject:'b',source:'',n:3}]:params.offset===2?[{day,metric:'visit',subject:'c',source:'',n:4}]:[]):[]};
 }}};
 await rollupAnalytics(env,{now:Date.parse(day+'T12:00:00Z'),pageSize:2});
 assert.equal(DB.sql.prepare('SELECT SUM(n) AS n FROM stats_daily').get().n,9);
 assert.ok(pages.some(p=>p.offset===2));assert.ok(new Set(pages.map(p=>p.day)).size>=7);
});
test('owner sees a failed rollup and previously stored totals remain available',async t=>{
 const DB=database(t),env={DB,STUDIO_ANALYTICS_DATASET:'studio_visits',STUDIO_ANALYTICS:{},ANALYTICS_SQL:{query:async()=>{throw new Error('query unavailable');}}};
 await rollupAnalytics(env);
 const {readStats}=await import('../worker/stats.mjs');
 const result=await readStats(env,{games:[]},{range:{from:'2026-10-15',to:'2026-10-15',days:1}});
 assert.match(result.note,/delayed.*query unavailable/i);
});

import {wranglerConfig} from '../lib/scaffold.mjs';
test('analytics bindings and hourly cron are only installed when enabled',()=>{
 const config=analytics=>JSON.parse(wranglerConfig({worker:'stats',name:'Stats',d1:'stats',analytics}).replace(/^\s*\/\/.*$/gm,''));
 assert.deepEqual(config(false).triggers.crons,[]);assert.equal(config(false).analytics,undefined);
 const enabled=config(true);assert.deepEqual(enabled.triggers.crons,['17 * * * *']);
 assert.equal(enabled.analytics_engine_datasets[0].dataset,enabled.vars.STUDIO_ANALYTICS_DATASET);
 assert.equal(enabled.analytics.binding,'ANALYTICS_SQL');
});

test('sampled analytics rows contribute weighted counts and corrected rollups remain replay safe',async t=>{
 const DB=database(t),day='2026-10-15';
 DB.sql.exec('CREATE TABLE sampled(timestamp TEXT,blob1 TEXT,blob2 TEXT,blob3 TEXT,blob4 TEXT,double1 REAL,_sample_interval INTEGER)');
 const insert=DB.sql.prepare('INSERT INTO sampled VALUES(?,?,?,?,?,?,?)');
 insert.run(day+'T01:00:00Z',day,'visit','home','',3,1);
 insert.run(day+'T02:00:00Z',day,'visit','home','',2,10);
 insert.run(day+'T03:00:00Z',day,'play','game','',4,5);
 await DB.prepare("INSERT INTO stats_daily VALUES(?1,'visit','home','',10)").bind(day).run();
 const env={DB,STUDIO_ANALYTICS_DATASET:'studio_visits',ANALYTICS_SQL:{query:async({query,params})=>({data:DB.sql.prepare(query.replace('events.analyticsEngine."studio_visits"','sampled')).all(params)})}};
 const options={now:Date.parse(day+'T12:00:00Z')};
 await rollupAnalytics(env,options);await rollupAnalytics(env,options);
 assert.equal(DB.sql.prepare("SELECT n FROM stats_daily WHERE metric='visit'").get().n,33);
 assert.equal(DB.sql.prepare("SELECT n FROM stats_daily WHERE metric='play'").get().n,20);
 DB.sql.exec("UPDATE sampled SET _sample_interval=8 WHERE _sample_interval=10");
 await rollupAnalytics(env,options);await rollupAnalytics(env,options);
 assert.equal(DB.sql.prepare("SELECT n FROM stats_daily WHERE metric='visit'").get().n,29);
});
