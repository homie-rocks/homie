import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './place-database.mjs';
import {writePageMetric,rollupAnalytics} from '../worker/analytics.mjs';

test('analytics page rollups preserve old counts and replay atomically without double counting', async t => {
 const DB=database(t),day='2026-10-15',points=[];
 await DB.prepare("INSERT INTO stats_daily VALUES(?1,'visit','cafe','',10)").bind(day).run();
 let n=7;
 const env={DB,STUDIO_ANALYTICS_DATASET:'studio_visits',STUDIO_ANALYTICS:{writeDataPoint:p=>points.push(p)},ANALYTICS_SQL:{query:async({query})=>{assert.match(query,/SUM\(double1\)/);return {data:[{day,metric:'visit',subject:'cafe',source:'',n}]};}}};
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
