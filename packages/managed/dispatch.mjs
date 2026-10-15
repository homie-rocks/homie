/** Trusted registry only: never derive a script name from user input. */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__managed/')) return new Response('Not found', {status:404});
    const route = env.ROUTES.find(r => r.hostname === url.hostname &&
      (r.prefix === '/' || url.pathname === r.prefix || url.pathname.startsWith(r.prefix + '/')));
    if (!route) return new Response('Not found', {status:404});
    if (route.prefix !== '/') url.pathname = url.pathname.slice(route.prefix.length) || '/';
    const headers = new Headers(request.headers);
    for (const key of [...headers.keys()]) if (key.startsWith('x-homie-managed-')) headers.delete(key);
    return env.STUDIOS.get(route.script, {}, {limits:{cpuMs:100, subRequests:50}})
      .fetch(new Request(url, new Request(request, {headers})));
  },
  async scheduled(event, env, ctx) {
    const scripts = [...new Set(env.ROUTES.map(r => r.script))];
    const work = Promise.all(scripts.map(async script => {
      const response = await env.STUDIOS.get(script, {props:{managedTick:true}},
        {limits:{cpuMs:1000, subRequests:100}}).fetch('https://managed.invalid/__managed/tick', {
          method:'POST', body:JSON.stringify({scheduledTime:event.scheduledTime, cron:event.cron})
        });
      if (!response.ok) throw new Error(`Scheduled tick failed: ${script} ${response.status}`);
    }));
    ctx.waitUntil(work);
    await work;
  }
};
