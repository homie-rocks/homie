/** Page counters are sampled analytics, never billing or gameplay state.
 * D1 retains historical totals. Each rollup adds only the delta from the last
 * observed total, in the same transaction as its watermark, so retries are safe.
 */
export const PAGE_METRICS = new Set(['visit', 'play', 'screen', 'watch']);
export function writePageMetric(env, row) {
  if (!env.STUDIO_ANALYTICS || !env.STUDIO_ANALYTICS_DATASET || !PAGE_METRICS.has(row.metric)) return false;
  const day = row.day ?? new Date().toISOString().slice(0, 10);
  try { env.STUDIO_ANALYTICS.writeDataPoint({
    indexes: [String(row.subject ?? '').slice(0, 80) || 'studio'],
    blobs: [day, row.metric, String(row.subject ?? '').slice(0, 80), String(row.source ?? '').slice(0, 80)],
    doubles: [Math.max(0, Math.floor(Number(row.n ?? 1) || 0))],
  }); } catch (error) {
    // Analytics is sampled telemetry. A binding failure must not fail a page or
    // amplify the outage into a D1 write on every visit.
    console.warn('Studio analytics point dropped:', error.message);
  }
  return true;
}
async function* analyticsPages(env,{now=Date.now(),pageSize=1000}={}) {
  if (!env.ANALYTICS_SQL || !env.STUDIO_ANALYTICS_DATASET) return;
  const dataset=String(env.STUDIO_ANALYTICS_DATASET);
  if(!/^[a-z0-9_-]+$/.test(dataset))throw new Error('Invalid studio analytics dataset');
  // Revisit each UTC day for late ingestion and sample corrections. Ordered
  // pages avoid the aggregate 50k result ceiling, including a busy single day.
  for(let ago=7;ago>=0;ago--) {
    const day=new Date(now-ago*86400000).toISOString().slice(0,10);
    for(let offset=0;;offset+=pageSize) {
      const result=await env.ANALYTICS_SQL.query({
        query:`SELECT blob1 AS day, blob2 AS metric, blob3 AS subject, blob4 AS source, SUM(double1) AS n
          FROM events.analyticsEngine."${dataset}" WHERE timestamp >= $start AND blob1 = $day
          GROUP BY blob1, blob2, blob3, blob4 ORDER BY blob1, blob2, blob3, blob4 LIMIT ${pageSize} OFFSET $offset`,
        params:{start:day+'T00:00:00Z',day,offset},
      });
      if(!Array.isArray(result.data))throw new Error('Incomplete studio analytics rollup');
      yield result.data.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.day)&&PAGE_METRICS.has(r.metric)&&Number.isFinite(Number(r.n)));
      if(result.data.length<pageSize)break;
    }
  }
}
export async function analyticsTotals(env,now=Date.now()) {
  const rows=[];for await(const page of analyticsPages(env,{now}))rows.push(...page);return rows;
}
export async function analyticsStatus(env,now=Date.now()) {
  const rows=(await env.DB.prepare("SELECT key,value FROM meta WHERE key IN ('analytics-rollup-error','analytics-rollup-success')").all()).results??[];
  const values=Object.fromEntries(rows.map(r=>[r.key,r.value]));
  const error=values['analytics-rollup-error'];
  return {lastSuccess:Number(values['analytics-rollup-success'])||null,delayed:Boolean(error)||now-Number(values['analytics-rollup-success']??0)>7200000,error:error||null};
}
async function health(env,key,value) {
  await env.DB.prepare('INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value!=excluded.value').bind(key,String(value)).run();
}
export async function rollupAnalytics(env,options={}) {
  if(!env.DB||!env.ANALYTICS_SQL)return;
  try {
    for await(const rows of analyticsPages(env,options)) {
      for(let offset=0;offset<rows.length;offset+=40) {
        const statements=rows.slice(offset,offset+40).flatMap(r=>{
          const args=[r.day,r.metric,r.subject,r.source,Math.round(Number(r.n))];
          return [
            env.DB.prepare(`INSERT INTO stats_daily(day,metric,subject,source,n)
              SELECT ?1,?2,?3,?4,?5-COALESCE((SELECT n FROM stats_analytics_daily WHERE day=?1 AND metric=?2 AND subject=?3 AND source=?4),0)
              WHERE NOT EXISTS(SELECT 1 FROM stats_analytics_daily WHERE day=?1 AND metric=?2 AND subject=?3 AND source=?4 AND n=?5)
              ON CONFLICT(day,metric,subject,source) DO UPDATE SET n=stats_daily.n+excluded.n`).bind(...args),
            env.DB.prepare(`INSERT INTO stats_analytics_daily(day,metric,subject,source,n) VALUES(?1,?2,?3,?4,?5)
              ON CONFLICT(day,metric,subject,source) DO UPDATE SET n=excluded.n WHERE n!=excluded.n`).bind(...args),
          ];
        });
        if(statements.length)await env.DB.batch(statements);
      }
    }
    await health(env,'analytics-rollup-error','');
    await health(env,'analytics-rollup-success',options.now??Date.now());
    return {delayed:false};
  } catch(error) {
    console.error('Studio analytics counts delayed:',error.message);
    await health(env,'analytics-rollup-error',String(error.message).slice(0,500));
    return {delayed:true,error:error.message};
  }
}

export const ANALYTICS_MIGRATION_FILE="0037_owner_analytics.sql";
export const ANALYTICS_MIGRATION=`CREATE TABLE IF NOT EXISTS stats_analytics_daily(day TEXT NOT NULL,metric TEXT NOT NULL,subject TEXT NOT NULL,source TEXT NOT NULL,n INTEGER NOT NULL,PRIMARY KEY(day,metric,subject,source)) WITHOUT ROWID;
`;
