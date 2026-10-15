/** Operator cron hook. No credential or monitoring binding is given to tenants. */
import {readFileSync,writeFileSync} from 'node:fs';
import {account,api} from './cloud.mjs';
import {graphql} from './graphql.mjs';
import {tenantMetrics} from '../analytics.mjs';
const [stateDir,tenant,output,enforce]=process.argv.slice(2);
if(!/^hm-test-[a-z0-9-]+$/.test(tenant??''))throw Error('Test tenant required');
const state=JSON.parse(readFileSync(stateDir+'/resources.json'));
if(state.namespace!=='homie-managed-test'||!state.users.includes(tenant))throw Error('Tenant not owned by this test run');
const bindings=await api(`workers/dispatch/namespaces/homie-managed-test/scripts/${tenant}/bindings`);
const query=tenantMetrics({accountId:account,script:tenant,namespaceIds:bindings.filter(b=>b.type==='durable_object_namespace').map(b=>b.namespace_id),start:new Date(Date.now()-15*60*1000).toISOString(),end:new Date().toISOString()});
const result=await graphql(query.query,query.variables);if(result.errors?.length)throw Error('Analytics unavailable; operator investigation required');
const data=result.data.viewer.accounts[0];
const total=(rows,key)=>rows.reduce((n,row)=>n+(row.sum[key]??0),0);
const usage={workerRequests:total(data.workersInvocationsAdaptive,'requests'),workerErrors:total(data.workersInvocationsAdaptive,'errors'),workerSubrequests:total(data.workersInvocationsAdaptive,'subrequests'),doSubrequests:total(data.durableObjectsPeriodicGroups,'subrequests'),doOutboundBodyBytes:total(data.durableObjectsSubrequestsAdaptiveGroups,'requestBodySizeUncached')};
const alerts=[];const coverage={worker:data.workersInvocationsAdaptive.length>0,durableObjects:data.durableObjectsPeriodicGroups.length>0};
if(usage.workerSubrequests+usage.doSubrequests>10000)alerts.push('subrequests > 10000 / 15 minutes');
if(usage.doOutboundBodyBytes>10*1024*1024)alerts.push('DO outbound bodies > 10 MiB / 15 minutes');
if(usage.workerErrors>=100&&usage.workerErrors/Math.max(1,usage.workerRequests)>.2)alerts.push('Worker errors >= 100 and >20% / 15 minutes');
const report={at:new Date().toISOString(),tenant,usage,coverage,alerts,query,result,enforced:false};
if(alerts.length&&enforce==='--enforce'){
 if(!/^hm-test-dispatch\.[a-z0-9-]+\.workers\.dev$/.test(state.dispatchHost))throw Error('Test host required');
 const r=await fetch('https://'+state.dispatchHost+'/__operator/kill',{method:'POST',headers:{authorization:'Bearer '+readFileSync(stateDir+'/operator-token','utf8'),'content-type':'application/json'},body:JSON.stringify({tenant})});
 if(!r.ok)throw Error('Kill failed');report.enforced=true;
}
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log({tenant,usage,coverage,alerts,enforced:report.enforced});
