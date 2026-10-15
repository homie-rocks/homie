import {cloudflareAuth} from './brain-probe.mjs';
import {readConfig} from './routes.mjs';
import {readStudio,workerDir} from './studio.mjs';
import {join} from 'node:path';
/** Enable replicas on this studio's database using the same login as deployment.
 * A missing account/id (first Workers Builds provisioning) is retried next deploy.
 * Auth failures are reported; the primary-first runtime remains consistent.
 */
export async function enableReadReplication(root, run, {accountId, databaseId, fetchFn=fetch}={}) {
  const studio=readStudio(root);
  accountId??=process.env.CLOUDFLARE_ACCOUNT_ID??studio.cloudflare?.accountId;
  databaseId??=readConfig(root)?.d1_databases?.find(db=>db.binding==='DB')?.database_id;
  if (!accountId || !databaseId) return {enabled:false,reason:'database provisioning has not supplied its account and id'};
  if (process.env.HOMIE_STUDIO_WARM==='0') return {enabled:false,reason:'offline test'};
  const headers=await cloudflareAuth({bin:join(root,'node_modules/.bin/wrangler'),cwd:workerDir(root),exec:async(_bin,args)=>{const r=run(args);return {code:r.code,stdout:r.stdout??r.out};}});
  if (!headers) return {enabled:false,reason:'Cloudflare authentication unavailable'};
  const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}`;
  const response=await fetchFn(url,{method:'PATCH',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({read_replication:{mode:'auto'}}),signal:AbortSignal.timeout(15000)});
  const body=await response.json();
  if(!response.ok||body.success===false||body.result?.read_replication?.mode!=='auto')throw new Error(`Could not enable D1 read replication (HTTP ${response.status}); the deployment login needs D1 Edit`);
  return {enabled:true};
}
