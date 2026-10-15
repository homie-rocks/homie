/** DO fetches bypass this Worker. No platform secrets/bindings belong in tenant code. */
export function blocked(host, controls=[]) {
  host=host.toLowerCase().replace(/\.$/,'');
  if(controls.some(h=>host===h||host.endsWith('.'+h)))return true;
  if(!host.includes('.') && !host.includes(':'))return true;
  if(/(^|\.)(localhost|local|internal|invalid)$/.test(host))return true;
  // IPv6 literals: permit only global unicast (2000::/3); deny IPv4-mapped literals too.
  if(host.startsWith('['))return !/^\[[23][0-9a-f]{3}:/.test(host);
  if(/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a,b]=host.split('.').map(Number);
    return a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19);
  }
  return false;
}
export default {
  async tail(events) {
    // Provider scriptName is authority; never promote owner log fields into identity.
    // Do not copy URLs, headers, console payloads or exceptions (may contain secrets).
    for(const event of events)console.log(JSON.stringify({tenant:event.scriptName,event:'tenant-trace',outcome:event.outcome,
      entrypoint:event.entrypoint??null,eventType:event.event?.type??(event.event?.request?'fetch':event.event?.scheduledTime?'scheduled':'other'),
      logs:event.logs?.length??0,exceptions:event.exceptions?.length??0}));
  },
  async fetch(request,env) {
    if(typeof env.tenant!=='string'||!env.tenant||env.tenant.length>255)return new Response('Missing tenant',{status:403});
    const url=new URL(request.url);
    if(!['https:','http:'].includes(url.protocol)||blocked(url.hostname,env.CONTROL_HOSTS??[]))return new Response('Managed destination denied',{status:403});
    const headers=new Headers(request.headers);headers.set('x-homie-tenant',env.tenant);
    console.log(JSON.stringify({tenant:env.tenant,event:'egress',host:url.hostname}));
    // Never follow an unchecked redirect; the tenant's next fetch is checked again.
    return fetch(new Request(request,{headers,redirect:'manual'}));
  }
};
