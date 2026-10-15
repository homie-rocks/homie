/** Operator-only query: never attach analytics credentials to tenant Workers. */
export function tenantMetrics({accountId,script,namespaceIds,start,end}) {
  if(!/^hm-test-[a-z0-9-]+$/.test(script)||namespaceIds.some(id=>!/^[0-9a-f]{32}$/.test(id)))throw new Error('Explicit test tenant identity required');
  return {query:`query($account: string!, $script: string!, $ids: [string!]!, $start: Time!, $end: Time!) {
    viewer { accounts(filter:{accountTag:$account}) {
      workersInvocationsAdaptive(limit:100,filter:{scriptName:$script,datetime_geq:$start,datetime_leq:$end}) {
        dimensions { scriptName dispatchNamespaceName } sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 }
      }
      durableObjectsSubrequestsAdaptiveGroups(limit:100,filter:{namespaceId_in:$ids,datetime_geq:$start,datetime_leq:$end}) {
        dimensions { namespaceId scriptName } sum { requestBodySizeUncached }
      }
      durableObjectsInvocationsAdaptiveGroups(limit:100,filter:{namespaceId_in:$ids,datetime_geq:$start,datetime_leq:$end}) {
        dimensions { namespaceId scriptName } sum { requests }
      }
      durableObjectsPeriodicGroups(limit:100,filter:{namespaceId_in:$ids,datetime_geq:$start,datetime_leq:$end}) {
        dimensions { namespaceId } sum { cpuTime subrequests }
      }
    }}
  }`,variables:{account:accountId,script,ids:namespaceIds,start,end}};
}
