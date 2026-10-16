import {readStudio,writeStudio,workerDir} from './studio.mjs';
import {cloudflareAuth} from './brain-probe.mjs';
import {join} from 'node:path';
export const backgroundQueues=worker=>({work:worker.slice(0,48)+'-background',dead:worker.slice(0,48)+'-background-dlq'});
/** Names reserve this studio's queues. An interrupted pre-deploy creation has no
 * bindings yet; inspect structured API records before resuming that reservation. */
export async function ensureBackgroundQueues(root,run,{accountId,fetchFn=fetch,headers}={}) {
  const studio=readStudio(root),names=backgroundQueues(studio.cloudflare.worker);
  accountId??=process.env.CLOUDFLARE_ACCOUNT_ID??studio.cloudflare.accountId;
  for(const name of [names.dead,names.work]) {
    if(readStudio(root).cloudflare.created?.includes('queue:'+name))continue;
    const result=run(['queues','create',name]);
    if(result.code!==0) {
      headers??=await cloudflareAuth({bin:join(root,'node_modules/.bin/wrangler'),cwd:workerDir(root),exec:async(_bin,args)=>{const r=run(args);return {code:r.code,stdout:r.stdout??r.out};}});
      const permission='The deployment token needs Account > Queues > Edit on this account. Add that permission to the CI/Workers Builds token (or sign in again with Wrangler), then retry deploy.';
      if(!headers||!accountId)throw new Error(permission);
      const response=await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/queues?name=${encodeURIComponent(name)}`,{headers,signal:AbortSignal.timeout(15000)});
      if(response.status===401||response.status===403)throw new Error(permission);
      const body=await response.json();
      if(!response.ok||body.success===false)throw new Error(`Could not inspect queue ${name} (HTTP ${response.status}). ${permission}`);
      const queue=body.result?.find(q=>q.queue_name===name);
      if(!queue)throw new Error(`Could not create queue ${name}. ${permission} Wrangler: ${result.out?.trim().split('\n').slice(-4).join(' ')}`);
      const producers=queue.producers??[],consumers=queue.consumers??[];
      if((queue.producers_total_count??producers.length)>producers.length||(queue.consumers_total_count??consumers.length)>consumers.length||
        producers.some(p=>p.type!=='worker'||p.script!==studio.cloudflare.worker)||consumers.some(c=>c.type!=='worker'||(c.script_name??c.script)!==studio.cloudflare.worker))
        throw new Error(`Queue ${name} is bound to another producer or consumer; it must belong exclusively to this studio`);
    }
    const latest=readStudio(root);
    writeStudio(root,{...latest,cloudflare:{...latest.cloudflare,created:[...new Set([...(latest.cloudflare.created??[]),'queue:'+name])].sort()}});
  }
}
