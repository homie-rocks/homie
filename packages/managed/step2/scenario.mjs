/** Sequential live proof driver. Only invokes trusted harness scripts. */
import {readFileSync,writeFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
import {local,here,api} from './operator.mjs';import {health} from './provider.mjs';
const state=()=>JSON.parse(readFileSync(local+'resources.json'));
function run(file,args=[]){const r=spawnSync(process.execPath,[here+file,...args],{stdio:'inherit',timeout:600000});if(r.status!==0)throw new Error(file+' failed');}
async function wait(commit,want){let last;for(let i=0;i<60;i++){
 const j=await api('workflows/hm-s2-release/instances/'+state().tenant.id+'-'+commit);
 const stage=j?.steps?.at(-1)?.name??j?.status??'waiting';if(stage!==last){console.log(commit.slice(0,8)+': '+stage);last=stage;}
 if(j?.status==='errored'){if(want==='failed')return j;throw new Error(j.error?.message??'Workflow failed');}
 if(j?.status==='complete'){if(want==='failed')throw new Error('Expected failure was accepted');return j;}
 await new Promise(r=>setTimeout(r,20000));
 }throw new Error('Proof deadline exceeded');}
const first=state().pushes.find(p=>p.variant==='three').commit;
await wait(first,'verified');
run('control-release.mjs',['promote',first]);run('continuity.mjs',['seed']);
run('push.mjs',['four']);const second=state().pushes.at(-1).commit;await wait(second,'verified');
run('control-release.mjs',['promote',second,first]);
const failures=[];
for(const variant of ['bad-build','bad-check']){
 run('push.mjs',[variant]);const commit=state().pushes.at(-1).commit;const workflow=await wait(commit,'failed');
 const serving=await health(state().tenant.production.url,second);
 failures.push({variant,commit,failedAt:workflow.steps.at(-2)?.name,error:workflow.error,production:serving});
 writeFileSync(local+'failed-production-proof.json',JSON.stringify(failures,null,2));console.log(variant+': production still serves '+second);
}
run('control-release.mjs',['rollback',first,second]);run('continuity.mjs');run('sentinel.mjs');run('collect-proof.mjs');
console.log('LIVE SCENARIO PASSED');
