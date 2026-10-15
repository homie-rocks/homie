/** Operator-only query: never attach analytics credentials to tenant Workers. */
export function tenantMetrics({accountId,script,namespaceIds,start,end}) {
  if(!/^hm-test-[a-z0-9-]+$/.test(script)||namespaceIds.some(id=>!/^[0-9a-f]{32}$/.test(id)))throw new Error('Explicit test tenant identity required');
  return {query:`query($account: string!, $script: string!, $ids: [string!]!, $start: Time!, $end: Time!) {
    viewer { accounts(filter:{accountTag:$account}) {
      workersInvocationsAdaptive(limit:100,filter:{scriptName:$script,datetime_geq:$start,datetime_leq:$end}) {
        sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 }
      }
      durableObjectsPeriodicGroups(limit:100,filter:{namespaceId_in:$ids,datetime_geq:$start,datetime_leq:$end}) {
        dimensions { namespaceId } sum { cpuTime }
      }
    }}
  }`,variables:{account:accountId,script,ids:namespaceIds,start,end}};
}
