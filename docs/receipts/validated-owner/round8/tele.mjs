// steps of my runner on the other screen > N tiles in one frame that are not respawns onto a spawn; node tele.mjs N files
import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib';
import { loadModule } from '/Users/ryan/Studios/homie-arcade-rules/tests/lib/rules.mjs';
const L = await loadModule('games/tiny-platformer/src/level.ts'); const onSpawn = (x, y) => L.SPAWNS.some((sp) => Math.abs(sp[0] - x) < 1.2 && Math.abs(sp[1] - y) < 1.5);
const N = +process.argv[2]; for (const p of process.argv.slice(3)) { const r = JSON.parse(gunzipSync(readFileSync(p))); const S = r.seen ?? []; let n = 0, max = 0;
 for (let i = 1; i < S.length; i++) { const d = Math.hypot(S[i][1]-S[i-1][1], S[i][2]-S[i-1][2]); if (d > N && !onSpawn(S[i][1], S[i][2]) && S[i][0]-S[i-1][0] < 60) { n++; max = Math.max(max, d); } }
 console.log(p.replace(/-lag.*/, ''), n, max.toFixed(1)); }
