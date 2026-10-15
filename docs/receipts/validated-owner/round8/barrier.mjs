import {writeFileSync,existsSync} from 'node:fs';
export async function pairBarrier(label) {
 const root=process.env.PAIR_BARRIER, side=process.env.PAIR_SIDE;
 if(!root||!side)return;
 const file=root+'-'+label;
 writeFileSync(file+'-'+side, String(Date.now()));
 const until=Date.now()+180000;
 while(!existsSync(file+'-'+(side==='b'?'c':'b'))) {
  if(Date.now()>until)throw Error('Pair barrier timed out: '+label);
  await new Promise(r=>setTimeout(r,25));
 }
}
