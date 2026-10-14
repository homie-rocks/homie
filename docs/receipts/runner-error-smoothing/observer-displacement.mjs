// Derived from the supplied pt4 observer audit; reads JSON or gzip traces.
// --outside-outages splits spans at injected network cuts; the default retains them.
// Drawn own runner vs the same runner on the other player's screen (server truth, later). node div.mjs files...
// Finds the time shift that best aligns them, then lists spans where the drawn runner is > 1.5 tiles from where everyone else sees it.
import { readFileSync } from 'node:fs';
import {gunzipSync} from 'node:zlib';
const excludeOutages = process.argv.includes('--outside-outages');
for (const p of process.argv.slice(2).filter(p => p !== '--outside-outages')) {
  const r = JSON.parse(p.endsWith('.gz')?gunzipSync(readFileSync(p)):readFileSync(p)); const F = r.frames, S = r.seen; if (!S?.length || !r.origin) { console.log(p, 'no seen'); continue; }
  const t0 = F[0][0];
  let j = 0; const at = (abs) => { while (j > 0 && S[j][0] > abs) j--; while (j + 1 < S.length && S[j + 1][0] <= abs) j++; if (abs < S[0][0] || j + 1 >= S.length) return null; const a = S[j], b = S[j + 1]; if (b[0] - a[0] > 200) return null; const f = (abs - a[0]) / (b[0] - a[0]); if (Math.hypot(b[1] - a[1], b[2] - a[2]) > 3) return f < 0.5 ? [a[1], a[2]] : [b[1], b[2]]; return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
  const dist = (shift) => { j = 0; const d = []; for (const f of F) { const q = at(r.origin + f[0] + shift); if (q) d.push(Math.hypot(f[1] - q[0], f[2] - q[1])); } d.sort((a, b) => a - b); return d.length ? d[Math.floor(d.length / 2)] : 1e9; };
  let best = 0, bd = 1e9; for (let s = -200; s <= 1200; s += 20) { const d = dist(s); if (d < bd) { bd = d; best = s; } }
  // per 3-second window: its own best shift (the prediction lead changes over a session)
  const W = 3000, shiftOf = new Map();
  for (let w0 = F[0][0]; w0 < F.at(-1)[0]; w0 += W) { const part = F.filter((f) => f[0] >= w0 && f[0] < w0 + W); let bs = best, bv = 1e9; for (let s = -200; s <= 1200; s += 20) { j = 0; const d = []; for (const f of part) { const q = at(r.origin + f[0] + s); if (q) d.push(Math.hypot(f[1] - q[0], f[2] - q[1])); } d.sort((a, b) => a - b); const m = d.length ? d[Math.floor(d.length / 2)] : 1e9; if (m < bv) { bv = m; bs = s; } } shiftOf.set(Math.floor((w0 - F[0][0]) / W), bs); }
  j = 0; const spans = []; let cur = null; const ds = [];
  for (const f of F) { if (excludeOutages && (r.events ?? []).some(e => e.what === 'reconnect' && f[0] >= e.at && f[0] <= e.at + e.ms)) { if (cur) spans.push(cur); cur = null; continue; } const sh = shiftOf.get(Math.floor((f[0] - F[0][0]) / W)) ?? best; j = 0; const q = at(r.origin + f[0] + sh); if (!q) continue; const d = Math.hypot(f[1] - q[0], f[2] - q[1]); ds.push(d);
    if (d > 1.5) { if (!cur) cur = { t0: f[0], max: 0, at: [f[1], f[2]], seen: q }; cur.t1 = f[0]; if (d > cur.max) { cur.max = d; cur.at = [f[1], f[2]]; cur.seen = q; } } else if (cur) { spans.push(cur); cur = null; } }
  if (cur) spans.push(cur);
  ds.sort((a, b) => a - b);
  const long = spans.filter((s) => s.t1 - s.t0 >= 300).map((s) => ({ s: +((s.t0 - t0) / 1000).toFixed(2), ms: Math.round(s.t1 - s.t0), maxTiles: +s.max.toFixed(2), drawn: s.at.map((v) => +v.toFixed(2)), seen: s.seen.map((v) => +v.toFixed(2)) }));
  // respawn windows on either screen: my placements (big jump onto a spawn, or diedAt change) and big jumps on the other screen
  const pl = []; for (let i = 1; i < F.length; i++) { const d = F[i][6], pd = F[i - 1][6]; if ((d && pd && (d.diedAt !== pd.diedAt || d.round !== pd.round))) pl.push(r.origin + F[i][0]); }
  for (let i = 1; i < S.length; i++) if (Math.hypot(S[i][1] - S[i - 1][1], S[i][2] - S[i - 1][2]) > 3) pl.push(S[i][0]);
  const clean = spans.filter((sp) => sp.max > 1.5 && sp.t1 - sp.t0 > 300 && !pl.some((t) => t >= r.origin + sp.t0 - 1500 && t <= r.origin + sp.t1 + 1500));
  const lost = { n: clean.length, ms: Math.round(clean.reduce((a, sp) => a + sp.t1 - sp.t0, 0)), worst: clean.map((sp) => ({ s: +((sp.t0 - t0) / 1000).toFixed(1), ms: Math.round(sp.t1 - sp.t0), tiles: +sp.max.toFixed(1) })) };
  console.log(p.split('/').pop().replace('-frames.json', ''), 'WRONGPLACE>1.5t>300ms', JSON.stringify(lost));
  console.log(p.split('/').pop().replace('-frames.json', ''), JSON.stringify({ shiftMs: best, medianTiles: +bd.toFixed(3), p95: +ds[Math.floor(ds.length * 0.95)].toFixed(2), p99: +ds[Math.floor(ds.length * 0.99)].toFixed(2), spansOver1_5: spans.length, spansOver300ms: long.length, totalMsOver1_5: Math.round(spans.reduce((a, s) => a + s.t1 - s.t0, 0)) }));
  for (const l of long.slice(0, 8)) console.log('  ', JSON.stringify(l));
}
