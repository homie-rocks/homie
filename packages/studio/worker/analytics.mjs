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
export async function analyticsTotals(env, now = Date.now()) {
  if (!env.ANALYTICS_SQL || !env.STUDIO_ANALYTICS_DATASET) return [];
  const dataset = String(env.STUDIO_ANALYTICS_DATASET);
  if (!/^[a-z0-9_-]+$/.test(dataset)) throw new Error('Invalid studio analytics dataset');
  // Revisit seven days for delayed ingestion and sampling corrections. The SQL
  // binding applies sample weights itself; multiplying them again overcounts.
  const result = await env.ANALYTICS_SQL.query({
    query: `SELECT blob1 AS day, blob2 AS metric, blob3 AS subject, blob4 AS source, SUM(double1) AS n
      FROM events.analyticsEngine."${dataset}" WHERE timestamp >= $start
      GROUP BY blob1, blob2, blob3, blob4 LIMIT 50000`,
    params: { start: new Date(now - 7 * 86400000).toISOString().slice(0, 10) + 'T00:00:00Z' },
  });
  if (!Array.isArray(result.data) || result.data.length >= 50000) throw new Error('Incomplete studio analytics rollup');
  return result.data.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && PAGE_METRICS.has(r.metric) && Number.isFinite(Number(r.n)));
}
export async function rollupAnalytics(env) {
  if (!env.DB || !env.ANALYTICS_SQL) return;
  const rows = await analyticsTotals(env);
  // Small transactions respect D1 parameter and statement limits. Each counter
  // and its watermark are atomic even if two scheduled deliveries overlap.
  for (let offset = 0; offset < rows.length; offset += 40) {
    const statements = rows.slice(offset, offset + 40).flatMap(r => {
      const args = [r.day, r.metric, r.subject, r.source, Math.round(Number(r.n))];
      return [
        env.DB.prepare(`INSERT INTO stats_daily(day,metric,subject,source,n)
          VALUES (?1,?2,?3,?4,?5-COALESCE((SELECT n FROM stats_analytics_daily WHERE day=?1 AND metric=?2 AND subject=?3 AND source=?4),0))
          ON CONFLICT(day,metric,subject,source) DO UPDATE SET n=stats_daily.n+excluded.n`).bind(...args),
        env.DB.prepare(`INSERT INTO stats_analytics_daily(day,metric,subject,source,n) VALUES (?1,?2,?3,?4,?5)
          ON CONFLICT(day,metric,subject,source) DO UPDATE SET n=excluded.n`).bind(...args),
      ];
    });
    await env.DB.batch(statements);
  }
}
