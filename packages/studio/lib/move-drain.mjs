import {readStudio,siteUrl} from './studio.mjs';
import {runner} from './cloudflare.mjs';
export async function drainCommand(root,action,{run=null,fetchFn=fetch,url=null}={}){
 if(!['on','off','status'].includes(action))throw Error('Use homie-studio drain on|off|status');
 const studio=readStudio(root),cf=studio.cloudflare??{};
 if(!cf.d1)throw Error('Deploy this studio before draining rooms');
 if(action!=='status'){
  const w=run??runner(root,cf.accountId?{CLOUDFLARE_ACCOUNT_ID:cf.accountId}:{});
  const sql=action==='on'?`INSERT INTO meta(key,value) VALUES('studio_move_drain','${Date.now()}') ON CONFLICT(key) DO UPDATE SET value=CASE WHEN CAST(meta.value AS INTEGER)>0 THEN meta.value ELSE excluded.value END;`:"DELETE FROM meta WHERE key='studio_move_drain';";
  const result=await w(['d1','execute',cf.d1,'--remote','--command',sql]);
  if(result.code!==0)throw Error('Cloudflare could not change room admission; sign in and retry');
 }
 const site=url??siteUrl(root,studio);const response=await fetchFn(new URL('/api/move-status',site),{cache:'no-store',signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error('Room drain is unmeasured; keep the source running');
 const status=await response.json();
 if(typeof status.draining!=='boolean'||typeof status.drained!=='boolean')throw Error('Upgrade and deploy the toolkit before draining');
 return {ok:true,command:'drain '+action,...status,message:status.drained?'All measured rooms are empty and their pending records are delivered. The source can now be made read-only.':status.draining?'Existing rooms keep playing. New admissions are paused. Run homie-studio drain status until drained is true before freezing or changing hosts.':'Room admissions are open.'};
}
