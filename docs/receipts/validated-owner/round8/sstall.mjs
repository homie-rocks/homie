// my runner frozen on the other screen >= 700 ms while it moves on my own (both builds)
import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib';
for (const p of process.argv.slice(2)) { const r = JSON.parse(gunzipSync(readFileSync(p))); const F = r.frames, t0 = F[0][0], S = r.seen ?? []; const out = [];
 let st = null; for (let i = 1; i < S.length; i++) { const still = S[i][1] === S[i-1][1] && S[i][2] === S[i-1][2]; if (still) { if (st === null) st = i - 1; } else if (st !== null) { const ms = S[i-1][0] - S[st][0]; if (ms >= 700) { const a = S[st][0] - r.origin, b = S[i-1][0] - r.origin; const fr = F.filter((f) => f[0] >= a && f[0] <= b); let path = 0; for (let k = 1; k < fr.length; k++) path += Math.hypot(fr[k][1]-fr[k-1][1], fr[k][2]-fr[k-1][2]); if (path > 1) out.push([+((a - t0)/1000).toFixed(1), Math.round(ms), +path.toFixed(1)]); } st = null; } }
 if (st !== null) { const ms = S.at(-1)[0] - S[st][0]; if (ms >= 700) out.push([+((S[st][0]-r.origin-t0)/1000).toFixed(1), Math.round(ms), 'end']); }
 console.log(p.split('/').pop().replace(/-lag.*/, ''), JSON.stringify(out)); }
