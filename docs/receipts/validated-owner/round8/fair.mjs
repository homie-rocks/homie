// pt6 fairness from both screens. node fair.mjs [-v] files...
// OWN screen (frames, painted pos when present):
//   sidePass: my box overlaps a drawn monster from the side for >=2 frames, not safe (>=2 s since my last respawn), no catch within 1 s
//   goldBack: a gold my box touched vanished on my screen, then reappeared within 3 s without my HUD going up (a pickup taken back)
//   goldMiss: touched a shown gold for >=3 frames, it never vanished on my screen
//   stompBack: monster vanished after a stomp-look, reappeared within 3 s at nearly the same place
// OTHER screen (seen: [absT, x, y, mons, score]):
//   seenPass: my runner overlaps a monster from the side on the other screen >=2 frames, not within 2 s after a respawn there, no respawn within 1 s
//   seenCatchNoMonster: my runner respawns on the other screen with no monster within 1.2 tiles of it there in the 600 ms before
//   seenTeleport: one drawn step of my runner on the other screen > 1.5 tiles that is not a respawn (onto a spawn point)
//   seenStall: my runner frozen on the other screen >= 400 ms while it moves on my own screen
// CLOCK (branch): own tick - view tick, median and max, and after events
import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib';
import { loadModule } from '/Users/ryan/Studios/homie-arcade-rules/tests/lib/rules.mjs';
const L = await loadModule('games/tiny-platformer/src/level.ts');
const V = process.argv.includes('-v');
const ov = (x1, y1, x2, y2) => !((x1 + 31 / 32) < x2 || (x2 + 31 / 32) < x1 || (y1 + 31 / 32) < y2 || (y2 + 31 / 32) < y1);
const onSpawn = (x, y) => L.SPAWNS.some((sp) => Math.abs(sp[0] - x) < 1.2 && Math.abs(sp[1] - y) < 1.5);
const T = {};
const add = (o) => { for (const [k, v] of Object.entries(o)) if (typeof v === 'number') T[k] = /Max$/.test(k) ? Math.max(T[k] ?? 0, v) : (T[k] ?? 0) + v; };
for (const p of process.argv.slice(2).filter((a) => a !== '-v')) {
  let raw = readFileSync(p); if (p.endsWith('.gz')) raw = gunzipSync(raw); const r = JSON.parse(raw); const F = r.frames; if (!F?.length) continue;
  const X = (f) => (f[7] && Math.abs(f[7][2] - f[0]) < 20 ? f[7][0] : f[1]), Y = (f) => (f[7] && Math.abs(f[7][2] - f[0]) < 20 ? f[7][1] : f[2]);
  const t0 = F[0][0], S = (t) => +((t - t0) / 1000).toFixed(2);
  // respawns on own screen
  const resp = []; for (let i = 1; i < F.length; i++) if (Math.hypot(F[i][1] - F[i - 1][1], F[i][2] - F[i - 1][2]) > 3 && onSpawn(F[i][1], F[i][2])) resp.push(F[i][0]);
  const safeAt = (t) => resp.some((rt) => t >= rt - 50 && t - rt < 2200);
  const caughtSoon = (t) => resp.some((rt) => rt >= t && rt - t < 1000);
  const o = { sec: (F.at(-1)[0] - t0) / 1000, catches: resp.length, sidePass: 0, sidePassDeep: 0, sideTouch: 0, goldTouch: 0, goldBack: 0, goldMiss: 0, stompBack: 0, ex: [] };
  // own: side touches
  const run = new Map();
  for (let i = 1; i < F.length; i++) {
    const f = F[i], x = X(f), y = Y(f), dy = Y(f) - Y(F[i - 1]);
    const now = new Set();
    for (const [mi, mx, my] of f[5] ?? []) {
      if (!ov(x, y, mx, my)) continue; now.add(mi);
      const looksStomp = dy > 0 && my - y > 0.5;
      const cur = run.get(mi) ?? { t: f[0], n: 0, side: 0, deep: 0 }; cur.n++; if (!looksStomp) { cur.side++; if (Math.abs(mx - x) < 0.5 && Math.abs(my - y) < 0.5) cur.deep++; } run.set(mi, cur);
    }
    for (const [mi, cur] of run) if (!now.has(mi)) {
      run.delete(mi);
      if (!(f[5] ?? []).some((m) => m[0] === mi)) continue;   // it vanished: stomped
      if (cur.side >= 2 && !safeAt(cur.t)) { o.sideTouch++; if (!caughtSoon(cur.t)) { o.sidePass++; if (cur.deep) o.sidePassDeep++; if (o.ex.length < 6) o.ex.push({ what: 'sidePass', s: S(cur.t), frames: cur.side }); } }
    }
  }
  // own: gold
  for (let gi = 0; gi < 8; gi++) {
    const g = L.GOLD[gi]; let touchN = 0, touchT = 0, vanishedT = 0, scoreAt = null;
    for (let i = 1; i < F.length; i++) {
      const f = F[i], shown = Boolean(f[4] & (1 << gi)), x = X(f), y = Y(f);
      if (shown && ov(x, y, g.x, g.y)) { if (!touchN) { touchT = f[0]; scoreAt = F[i - 1][3]; } touchN++; }
      if (touchN && !shown && !vanishedT) { vanishedT = f[0]; o.goldTouch++; }
      if (vanishedT) {
        if (shown && f[0] - vanishedT < 3000) { const counted = f[3] != null && scoreAt != null && f[3] > scoreAt; if (!counted) { o.goldBack++; if (o.ex.length < 6) o.ex.push({ what: 'goldBack', s: S(vanishedT), gi, ms: Math.round(f[0] - vanishedT) }); } touchN = 0; vanishedT = 0; }
        else if (f[0] - vanishedT >= 3000) { touchN = 0; vanishedT = 0; }
      } else if (touchN && (!shown || !ov(x, y, g.x, g.y))) { if (touchN >= 3 && shown) { o.goldMiss++; if (o.ex.length < 6) o.ex.push({ what: 'goldMiss', s: S(touchT), gi, frames: touchN }); } if (shown) touchN = 0; }
    }
  }
  // own: stomp taken back
  for (let i = 1; i < F.length; i++) {
    const prev = F[i - 1][5] ?? [], cur = F[i][5] ?? [];
    for (const [mi, mx, my] of prev) if (!cur.some((m) => m[0] === mi) && ov(X(F[i - 1]), Y(F[i - 1]), mx, my)) {
      const j = F.findIndex((f, k) => k > i && f[0] - F[i][0] < 3000 && (f[5] ?? []).some((m) => m[0] === mi && Math.abs(m[1] - mx) < 2.5 && Math.abs(m[2] - my) < 2.5));
      if (j > 0) { o.stompBack++; if (o.ex.length < 6) o.ex.push({ what: 'stompBack', s: S(F[i][0]), mi }); }
    }
  }
  // other screen
  const Sn = r.seen ?? [];
  Object.assign(o, { seenFrames: Sn.length, seenResp: 0, seenPass: 0, seenPassDeep: 0, seenSideTouch: 0, seenCatchNoMonster: 0, seenTeleport: 0, seenTeleportMax: 0, seenStall: 0, seenStallMsMax: 0 });
  if (Sn.length && Sn[0].length >= 4) {
    const sresp = []; for (let i = 1; i < Sn.length; i++) { const d = Math.hypot(Sn[i][1] - Sn[i - 1][1], Sn[i][2] - Sn[i - 1][2]); if (d > 3 && onSpawn(Sn[i][1], Sn[i][2])) sresp.push(i); else if (d > 1.5 && Sn[i][0] - Sn[i - 1][0] < 60) { o.seenTeleport++; o.seenTeleportMax = Math.max(o.seenTeleportMax, d); if (o.ex.length < 10) o.ex.push({ what: 'seenTeleport', s: +((Sn[i][0] - (r.origin + t0)) / 1000).toFixed(2), d: +d.toFixed(2), from: [Sn[i - 1][1], Sn[i - 1][2]], to: [Sn[i][1], Sn[i][2]] }); } }
    o.seenResp = sresp.length;
    const sT = sresp.map((i) => Sn[i][0]);
    for (const i of sresp) {
      const tt = Sn[i][0]; let near = false;
      for (let k = i - 1; k >= 0 && tt - Sn[k][0] < 600; k--) for (const [, mx, my] of Sn[k][3]) if (Math.abs(mx - Sn[k][1]) < 1.2 && Math.abs(my - Sn[k][2]) < 1.2) near = true;
      if (!near) { o.seenCatchNoMonster++; if (o.ex.length < 10) o.ex.push({ what: 'seenCatchNoMonster', s: +((tt - (r.origin + t0)) / 1000).toFixed(2), at: [Sn[i - 1][1], Sn[i - 1][2]] }); }
    }
    const srun = new Map();
    for (let i = 1; i < Sn.length; i++) {
      const [t, x, y, mons] = Sn[i], dy = y - Sn[i - 1][2]; const now = new Set();
      for (const [mi, mx, my] of mons) { if (!ov(x, y, mx, my)) continue; now.add(mi); const cur = srun.get(mi) ?? { t, side: 0, deep: 0 }; if (!(dy > 0 && my - y > 0.5)) { cur.side++; if (Math.abs(mx - x) < 0.5 && Math.abs(my - y) < 0.5) cur.deep++; } srun.set(mi, cur); }
      for (const [mi, cur] of srun) if (!now.has(mi)) { srun.delete(mi); if (!mons.some((m) => m[0] === mi)) continue; if (cur.side >= 2 && !sT.some((rt) => cur.t >= rt - 50 && cur.t - rt < 2200)) { o.seenSideTouch++; if (!sT.some((rt) => rt >= cur.t && rt - cur.t < 1000)) { o.seenPass++; if (cur.deep) o.seenPassDeep++; if (o.ex.length < 10) o.ex.push({ what: 'seenPass', s: +((cur.t - (r.origin + t0)) / 1000).toFixed(2), frames: cur.side }); } } }
    }
    // stalls on the other screen while I move on my own
    let st = null;
    for (let i = 1; i < Sn.length; i++) { const still = Sn[i][1] === Sn[i - 1][1] && Sn[i][2] === Sn[i - 1][2]; if (still) { if (!st) st = Sn[i - 1][0]; } else if (st) { const ms = Sn[i - 1][0] - st; if (ms >= 400) { const a = st - r.origin, b = Sn[i - 1][0] - r.origin; const fr = F.filter((f) => f[0] >= a && f[0] <= b); if (fr.length > 2 && Math.abs(fr.at(-1)[1] - fr[0][1]) + Math.abs(fr.at(-1)[2] - fr[0][2]) > 1) { o.seenStall++; o.seenStallMsMax = Math.max(o.seenStallMsMax, ms); } } st = null; } }
  }
  // clock (branch only): own tick - view tick
  const lead = F.filter((f) => f[8] && f[8][0] != null && f[8][1] != null).map((f) => f[8][0] - f[8][1]);
  if (lead.length) { const s = [...lead].sort((a, b) => a - b); o.leadMed = +s[Math.floor(s.length / 2)].toFixed(1); o.leadMin = +s[0].toFixed(1); o.leadEnd = +lead.at(-1).toFixed(1); }
  add({ ...o, leadMed: undefined, leadMin: undefined, leadEnd: undefined });
  const name = p.split('/').pop().replace(/-lag.*-frames\.json(\.gz)?$/, '').replace(/-frames\.json(\.gz)?$/, '');
  console.log(name, JSON.stringify({ ...o, sec: Math.round(o.sec), ex: V ? o.ex : undefined }));
}
console.log('TOTAL', JSON.stringify(T));
