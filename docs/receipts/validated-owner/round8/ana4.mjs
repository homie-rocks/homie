// pt4 audit of the own runner, per drawn frame. node ana4.mjs [-v] files...
// jumps: one drawn frame > 1.5 tiles that is not a placement (the fixer's metric)
// skips: a frame beyond physics x1.5 (15 t/s run, 60 t/s fall, 24.1 t/s rise), landing snaps excluded
// slides: runs of skip frames (gaps <= 3 frames) = a visible correction drawn over several frames; net tiles, ms, max step
// respawn: on each placement (diedAt / round change), frames until the runner stands on a spawn, and the step at that frame
// frames: dt > 33 / > 50 ms, p99
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { loadModule } from '/Users/ryan/Studios/homie-arcade-rules/tests/lib/rules.mjs';
const L = await loadModule('games/tiny-platformer/src/level.ts');
const pen = (x, y) => { let d = 0; for (let cy = Math.floor(y); cy <= Math.floor(y + 1); cy++) for (let cx = Math.floor(x); cx <= Math.floor(x + 1); cx++) { if (cx < 0 || cy < 0 || cx >= L.TW || cy >= L.TH || !L.TILES[cx + cy * L.TW]) continue; d = Math.max(d, Math.min(x + 1 - cx, cx + 1 - x, y + 1 - cy, cy + 1 - y)); } return d; };
const nearSpawn = (x, y, r = 1.2) => L.SPAWNS.some(([sx, sy]) => Math.abs(x - sx) < r && Math.abs(y - sy) < r + 0.3);
const V = process.argv.includes('-v');
const T = { runs: 0, frames: 0, inSolid: 0, jumps: 0, jumpMax: 0, skips: 0, slides: 0, slidesOver1: 0, slidesOver3: 0, slideMaxNet: 0, respawns: 0, respawnsGlided: 0, over33: 0, over50: 0 };
const all = [];
for (const p of process.argv.slice(2).filter((a) => a !== '-v')) {
  let raw = readFileSync(p); if (p.endsWith('.gz')) raw = gunzipSync(raw);
  const rec = JSON.parse(raw); const F = rec.frames; if (!F?.length) continue;
  const t0 = F[0][0]; const S = (t) => +((t - t0) / 1000).toFixed(2);
  const evs = (rec.events ?? []).map((e) => ({ what: e.what, at: e.at, back: e.back }));
  const sinceEv = (t) => { let best = null; for (const e of evs) { const b = e.back ?? e.at; if (b <= t && (best === null || t - b < best.ms)) best = { what: e.what, ms: Math.round(t - b) }; } return best; };
  let inSolid = 0, jumps = [], skips = [], placements = [], lastPl = -1e9, over33 = 0, over50 = 0; const dts = [];
  for (let i = 0; i < F.length; i++) {
    const [t, x, y] = F[i]; if (pen(x, y) > 0.1) inSolid++;
    if (!i) continue;
    const [pt, px, py] = F[i - 1]; const dt = t - pt; dts.push(dt); if (dt > 33) over33++; if (dt > 50) over50++;
    const dd = F[i][6], pd = F[i - 1][6];
    const dx = x - px, dy = y - py, step = Math.hypot(dx, dy);
    const placed = (dd && dd.moved) || (dd && pd && (dd.diedAt !== pd.diedAt || dd.round !== pd.round)) || (!dd && step > 3 && nearSpawn(x, y, 0.3));
    if (placed) { placements.push({ i, t, step, at: [x, y], from: [px, py] }); lastPl = t; continue; }
    if (step > 1.5) jumps.push({ s: S(t), step: +step.toFixed(2), dx: +dx.toFixed(2), dy: +dy.toFixed(2), sincePlaceS: +((t - lastPl) / 1000).toFixed(2), ev: sinceEv(t) });
    if (dt > 100) continue;
    const span = Math.max(dt, 16.7) / 1000 + 0.008; const over = Math.max(Math.abs(dx) / (15 * span + 0.02), dy / (60 * span + 0.02), -dy / (24.1 * span + 0.02));
    const snap = dy < 0 && -dy <= 1.01 && Math.abs(y - Math.round(y)) < 0.02 && Math.abs(dx) <= 15 * span + 0.02;
    if (over > 1.5 && !snap) skips.push({ i, t, step, from: [px, py], to: [x, y] });
  }
  // slides
  const slides = [];
  for (const s of skips) { const last = slides.at(-1); if (last && s.i - last.i1 <= 3) { last.i1 = s.i; last.n++; last.maxStep = Math.max(last.maxStep, s.step); last.to = s.to; last.t1 = s.t; } else slides.push({ i0: s.i, i1: s.i, n: 1, maxStep: s.step, from: s.from, to: s.to, t0: s.t, t1: s.t }); }
  const slideRows = slides.map((s) => ({ s: S(s.t0), frames: s.n, ms: Math.round(s.t1 - s.t0 + 16.7), net: +Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]).toFixed(2), maxStep: +s.maxStep.toFixed(2), from: s.from.map((v) => +v.toFixed(2)), to: s.to.map((v) => +v.toFixed(2)), sincePlaceS: +(((s.t0 - (placements.filter((p) => p.t <= s.t0).at(-1)?.t ?? -1e12)) / 1000)).toFixed(2), ev: sinceEv(s.t0) }));
  // respawns: does the placement frame itself put the runner on a spawn (a cut), or does it get there over frames?
  const dSpawn = (x, y) => Math.min(...L.SPAWNS.map(([sx, sy]) => Math.hypot(x - sx, y - sy)));
  const resp = placements.map((pl) => { const slideAfter = slideRows.find((r) => r.net > 1 && r.s >= S(pl.t) && r.s - S(pl.t) < 1.5); return { s: S(pl.t), cut: +pl.step.toFixed(2), fromSpawnTiles: +dSpawn(pl.at[0], pl.at[1]).toFixed(2), slideWithin1_5s: slideAfter ? slideAfter.net : 0, ev: sinceEv(pl.t) }; });
  // stalls: a run key held > 550 ms, open floor ahead (no wall in the next column at body rows), drawn x not moving for >= 120 ms
  const keys = rec.keys ?? []; let ki = 0, left = false, right = false, dir = 0, dirAt = 0; const stalls = []; let st = null;
  const solidT = (cx, cy) => cx < 0 || cx >= L.TW || (cy >= 0 && cy < L.TH && L.TILES[cx + cy * L.TW] !== 0);
  for (let i = 1; i < F.length; i++) {
    const [t, x, y] = F[i], [pt, px] = F[i - 1];
    while (ki < keys.length && keys[ki][0] <= t) { const [kt, code, down] = keys[ki++]; if (code === 'ArrowLeft') left = !!down; if (code === 'ArrowRight') right = !!down; const n = (+right) - (+left); if (n !== dir) { dir = n; dirAt = kt; } }
    const ahead = dir > 0 ? Math.floor(x + 1.02) : Math.floor(x - 0.02);
    const wall = dir && (solidT(ahead, Math.floor(y + 0.01)) || solidT(ahead, Math.floor(y + 0.99)));
    const pl = placements.some((p) => Math.abs(p.t - t) < 600);
    const stuck = dir && t - dirAt > 550 && !wall && !pl && Math.abs(x - px) < 0.002 && t - pt < 40;
    if (stuck) { if (!st) st = { t0: pt, x, y, dir }; st.t1 = t; } else if (st) { if (st.t1 - st.t0 >= 120) stalls.push({ s: S(st.t0), ms: Math.round(st.t1 - st.t0), at: [+st.x.toFixed(2), +st.y.toFixed(2)], dir: st.dir, ev: sinceEv(st.t0) }); st = null; }
  }
  dts.sort((a, b) => a - b);
  const row = { s: S(F.at(-1)[0]), frames: F.length, cpu: rec.cpu, load: rec.load?.[0], late: rec.wire?.late, socks: rec.wire?.sockets, inSolid, jumps: jumps.length, jumpMax: +Math.max(0, ...jumps.map((j) => j.step)).toFixed(2), skips: skips.length, slides: slideRows.length, slidesOver1: slideRows.filter((r) => r.net > 1).length, slideMaxNet: Math.max(0, ...slideRows.map((r) => r.net)), respawns: resp.length, respawnsNotCut: resp.filter((r) => r.cut < 1.5 || r.slideWithin1_5s).length, respawnLeadMax: Math.max(0, ...resp.map((r) => r.fromSpawnTiles)), stalls: stalls.length, stallMs: stalls.reduce((a, b) => a + b.ms, 0), over33, over50, dtP99: +dts[Math.floor(dts.length * 0.99)].toFixed(1), dtMax: +dts.at(-1).toFixed(0), ev: evs.map((e) => e.what).join(',') };
  T.runs++; T.frames += F.length; T.inSolid += inSolid; T.jumps += jumps.length; T.jumpMax = Math.max(T.jumpMax, row.jumpMax); T.skips += skips.length; T.slides += slideRows.length; T.slidesOver1 += row.slidesOver1; T.slidesOver3 += slideRows.filter((r) => r.net > 3).length; T.slideMaxNet = Math.max(T.slideMaxNet, row.slideMaxNet); T.respawns += resp.length; T.respawnsGlided += row.respawnsNotCut; T.over33 += over33; T.stalls = (T.stalls ?? 0) + stalls.length; T.stallMs = (T.stallMs ?? 0) + stalls.reduce((a, b) => a + b.ms, 0); T.over50 += over50;
  const name = p.split('/').pop().replace(/-frames\.json(\.gz)?$/, '');
  console.log(name, JSON.stringify(row));
  if (V) { if (jumps.length) console.log('  jumps', JSON.stringify(jumps.slice(0, 8))); const big = slideRows.filter((r) => r.net > 1); if (big.length) console.log('  slides>1', JSON.stringify(big.slice(0, 8))); const g = resp.filter((r) => r.cut < 1.5 || r.slideWithin1_5s || r.fromSpawnTiles > 3); if (g.length) console.log('  respawnNotCut', JSON.stringify(g.slice(0, 6))); }
  if (V && stalls.length) console.log('  stalls', JSON.stringify(stalls.slice(0, 6)));
  all.push({ name, row, jumps, slides: slideRows, resp, stalls });
}
console.log('TOTAL', JSON.stringify(T));
if (process.env.OUTJSON) (await import('node:fs')).writeFileSync(process.env.OUTJSON, JSON.stringify(all));
