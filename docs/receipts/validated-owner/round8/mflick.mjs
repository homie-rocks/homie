// monster one-frame re-shows after it vanished next to my runner (stomp) : node mflick.mjs files
import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib';
const T={runs:0,vanish:0,reshow:0,reshowFrames:[]};
for (const p of process.argv.slice(2)) { const r = JSON.parse(gunzipSync(readFileSync(p))); const F = r.frames, t0=F[0][0]; T.runs++;
 for (let i = 1; i < F.length; i++) { const prev = F[i-1][5] ?? [], cur = F[i][5] ?? [];
  for (const [mi, mx, my] of prev) if (!cur.some(m=>m[0]===mi) && Math.abs(mx-F[i-1][1])<1.2 && Math.abs(my-F[i-1][2])<1.2) { T.vanish++;
    let n=0, first=-1; for (let k=i+1;k<F.length&&F[k][0]-F[i][0]<600;k++) if ((F[k][5]??[]).some(m=>m[0]===mi&&Math.abs(m[1]-mx)<2.5&&Math.abs(m[2]-my)<2.5)) { n++; if(first<0)first=k; }
    if (n) { T.reshow++; T.reshowFrames.push(n); console.log(p.split('/').pop().slice(0,14), ((F[i][0]-t0)/1000).toFixed(2), 'mi', mi, 'reshown frames', n, 'after ms', Math.round(F[first][0]-F[i][0])); } } } }
console.log('TOTAL', JSON.stringify(T));
