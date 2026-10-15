/** Only the shell's own frame can ask; role and access come from the shell, never the message. */
export const APP_SHELL_JS = String.raw`(function () {
  var boot = window.__HOMIE_PLAY || window.__HOMIE_APP || window.__HOMIE_WATCH;
  if (!boot || boot.kind !== 'app') return;
  var frame = boot.direct ? {contentWindow:window} : document.querySelector('iframe.game') || document.querySelector('iframe');
  var params = new URLSearchParams(location.search);
  // Authorized shell responses have already set the HttpOnly role handoff.
  if(params.has('access')) {
    params.delete('access');
    history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+(location.hash||''));
  }
  // Share short-lived reads across same-origin screens with the same role and browser cookies.
  // No records are persisted. Writes always reach the Worker and invalidate all views.
  var recent = new Map(), failures = new Map(), pending = new Map();
  var channel; try { channel = new BroadcastChannel('homie-app-records-v1'); } catch (_) {}
  function accept(m) { if (m?.invalidate) { recent.clear(); failures.clear(); } else if (m?.path && m?.entry) recent.set(m.path, m.entry); }
  if (channel) channel.onmessage = function(e) { accept(e.data); };
  function share(m) { accept(m); if (channel) channel.postMessage(m); }
  function locked(run) { return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('homie-app-records-v1', run) : run(); }
  async function request(path, m) {
    var read = m.type!=='homie-app-tool' && m.method === 'GET';
    if (read && pending.has(path)) return pending.get(path);
    var job = locked(async function() {
      var cached = recent.get(path);
      if (read && cached && cached.until > Date.now()) return cached.result;
      var result;
      try {
        var res = await fetch(path, { method: m.type==='homie-app-tool'?'POST':m.method, headers: { 'content-type': 'application/json' }, body: m.type==='homie-app-tool'?JSON.stringify({name:m.name,input:m.input}):read ? undefined : JSON.stringify({ data: m.data, version: m.version }), signal: AbortSignal.timeout(8000) });
        result = await res.json();
        if (res.status === 429 || res.status >= 500) throw new Error('reconnect');
        failures.delete(path);
        if (read && result.ok) share({path: path, entry: {result: result, until: Date.now() + 1500}});
        if (!read && result.ok) share({invalidate: true});
      } catch (_) {
        result = {ok: false, error: 'Reconnecting. Your saved updates will appear shortly.'};
        if (read) { var count = (failures.get(path) || 0) + 1; failures.set(path, count); share({path: path, entry: {result: result, until: Date.now() + Math.min(30000, 1000 * Math.pow(2, count - 1))}}); }
      }
      return result;
    });
    if (read) { pending.set(path, job); job.finally(function() { pending.delete(path); }); }
    return job;
  }
  var live, collections=new Set(), presence=0, clock=null;
  function query() {
    var q=new URLSearchParams();
    ['role','surface','room'].forEach(function(k){var v=params.get(k);if(v)q.set(k,v);});
    if(boot.screen&&!q.has('role'))q.set('surface','wall');
    return q;
  }
  function context() {var room=new URLSearchParams(location.search).get('room');return {app:boot.game,origin:location.origin,url:location.origin+'/'+boot.game+'/open'+(room&&/^[A-Za-z0-9_-]{1,32}$/.test(room)?'?room='+encodeURIComponent(room):''),presence:presence,now:clock};}
  function sendContext(){frame?.contentWindow?.postMessage({type:'homie-app-context',context:context()},'*');}
  function connect(){
    live?.close();
    var q=query();collections.forEach(function(c){q.append('collection',c);});
    live=new EventSource((boot.site||'')+'/'+boot.game+'/api/app/live?'+q);
    live.onmessage=function(e){var value=JSON.parse(e.data);if(presence!==value.presence){presence=value.presence;sendContext();}if(value.collections?.length){share({invalidate:true});Promise.allSettled([...pending.values()]).then(function(){share({invalidate:true});frame?.contentWindow?.postMessage({type:'homie-app-changed',collections:value.collections},'*');});}};
  }
  window.homieApp=Object.freeze({get context(){return context();},setTestClock:function(value){if(!boot.test)throw new Error('Local proof session required');if(value!==null&&!Number.isFinite(value))throw new Error('Invalid clock');clock=value;sendContext();}});
  addEventListener('pagehide',function(){live?.close();});
  addEventListener('message', async function (e) {
    var m = e.data;
    if(frame&&e.source===frame.contentWindow&&m?.type==='homie-app-context'){sendContext();return;}
    if(frame&&e.source===frame.contentWindow&&m?.type==='homie-app-subscribe'){
      if(!Array.isArray(m.collections)||m.collections.some(c=>!/^[a-z][a-z0-9-]{0,39}$/.test(c)))return;
      m.collections.forEach(c=>collections.add(c));connect();return;
    }
    if (frame && e.source === frame.contentWindow && m?.type === 'homie-app-ticket' && /^[a-f0-9]{32}$/.test(m.ticket)) { params.set('ticket', m.ticket); history.replaceState(null, '', location.pathname + '?' + params); return; }
    if (!frame || e.source !== frame.contentWindow || !m || !['homie-app','homie-app-tool'].includes(m.type) || !/^[a-f0-9]{32}$/.test(m.id || '')) return;
    if (m.type==='homie-app' && (!/^[a-z][a-z0-9-]{0,39}$/.test(m.collection || '') || !['GET','POST','PUT','DELETE'].includes(m.method) || (m.record !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(m.record)))) return;
    var q = new URLSearchParams();
    ['role','surface'].forEach(function (k) { var v = params.get(k); if (v) q.set(k, v); });
    if (boot.screen && !q.has('role')) q.set('surface', 'wall');
    var path = (boot.site || '') + '/' + boot.game + '/api/app/records/' + m.collection + (m.record ? '/' + m.record : '') + '?' + q;
    if(m.type==='homie-app-tool')path=(boot.site||'')+'/'+boot.game+'/api/app/tools?'+q;
    var result = await request(path, m);
    e.source.postMessage({ type: 'homie-app-result', id: m.id, result: result }, '*');
  });
})();`;
