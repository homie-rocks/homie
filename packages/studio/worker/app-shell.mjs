/** Only the shell's own frame can ask; role and access come from the shell, never the message. */
export const APP_SHELL_JS = String.raw`(function () {
  var boot = window.__HOMIE_PLAY || window.__HOMIE_APP || window.__HOMIE_WATCH;
  if (!boot || boot.kind !== 'app') return;
  var frame = document.querySelector('iframe.game') || document.querySelector('iframe');
  var params = new URLSearchParams(location.search);
  // Share short-lived reads across same-origin screens with the exact same role/access.
  // No records are persisted. Writes always reach the Worker and invalidate all views.
  var recent = new Map(), failures = new Map(), pending = new Map();
  var channel; try { channel = new BroadcastChannel('homie-app-records-v1'); } catch (_) {}
  function accept(m) { if (m?.invalidate) { recent.clear(); failures.clear(); } else if (m?.path && m?.entry) recent.set(m.path, m.entry); }
  if (channel) channel.onmessage = function(e) { accept(e.data); };
  function share(m) { accept(m); if (channel) channel.postMessage(m); }
  function locked(run) { return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('homie-app-records-v1', run) : run(); }
  async function request(path, m) {
    var read = m.method === 'GET';
    if (read && pending.has(path)) return pending.get(path);
    var job = locked(async function() {
      var cached = recent.get(path);
      if (read && cached && cached.until > Date.now()) return cached.result;
      var result;
      try {
        var res = await fetch(path, { method: m.method, headers: { 'content-type': 'application/json' }, body: read ? undefined : JSON.stringify({ data: m.data, version: m.version }), signal: AbortSignal.timeout(8000) });
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
  addEventListener('message', async function (e) {
    var m = e.data;
    if (frame && e.source === frame.contentWindow && m?.type === 'homie-app-ticket' && /^[a-f0-9]{32}$/.test(m.ticket)) { params.set('ticket', m.ticket); history.replaceState(null, '', location.pathname + '?' + params); return; }
    if (!frame || e.source !== frame.contentWindow || !m || m.type !== 'homie-app' || !/^[a-f0-9]{32}$/.test(m.id || '')) return;
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(m.collection || '') || !['GET','POST','PUT','DELETE'].includes(m.method) || (m.record !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(m.record))) return;
    var q = new URLSearchParams();
    ['role','surface','access'].forEach(function (k) { var v = params.get(k); if (v) q.set(k, v); });
    if (boot.screen && !q.has('role')) q.set('surface', 'wall');
    var path = (boot.site || '') + '/' + boot.game + '/api/app/records/' + m.collection + (m.record ? '/' + m.record : '') + '?' + q;
    var result = await request(path, m);
    e.source.postMessage({ type: 'homie-app-result', id: m.id, result: result }, '*');
  });
})();`;
