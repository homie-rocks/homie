/** Trusted Tail collector. Internet egress is permitted; no outbound filter is deployed. */
export default {
  async tail(events) {
    // Provider scriptName is authority; never promote owner log fields into identity.
    // Do not copy URLs, headers, console payloads or exceptions (may contain secrets).
    for(const event of events)console.log(JSON.stringify({tenant:event.scriptName,event:'tenant-trace',outcome:event.outcome,
      entrypoint:event.entrypoint??null,durableObjectId:event.durableObjectId??null,dispatchNamespace:event.dispatchNamespace??null,cpuTime:event.cpuTime,wallTime:event.wallTime,eventTimestamp:event.eventTimestamp,eventType:event.event?.type??(event.event?.request?'fetch':event.event?.scheduledTime?'scheduled':'other'),
      signals:(event.logs??[]).flatMap(l=>(l.message??[]).flatMap(m=>{try{const v=JSON.parse(m);return v.event==='fixture-egress'&&['worker','do'].includes(v.kind)?[v.kind]:[];}catch{return [];}})),logs:event.logs?.length??0,exceptions:event.exceptions?.length??0}));
  }
};
