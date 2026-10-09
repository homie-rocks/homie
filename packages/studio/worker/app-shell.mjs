/** Only the shell's own frame can ask; role and access come from the shell, never the message. */
export const APP_SHELL_JS = String.raw`(function () {
  var boot = window.__HOMIE_PLAY || window.__HOMIE_APP || window.__HOMIE_WATCH;
  if (!boot || boot.kind !== 'app') return;
  var frame = document.querySelector('iframe.game') || document.querySelector('iframe');
  var params = new URLSearchParams(location.search);
  var inflight = 0;
  addEventListener('message', async function (e) {
    var m = e.data;
    if (frame && e.source === frame.contentWindow && m?.type === 'homie-app-ticket' && /^[a-f0-9]{32}$/.test(m.ticket)) { params.set('ticket', m.ticket); history.replaceState(null, '', location.pathname + '?' + params); return; }
    if (!frame || e.source !== frame.contentWindow || !m || m.type !== 'homie-app' || !/^[a-f0-9]{32}$/.test(m.id || '')) return;
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(m.collection || '') || !['GET','POST','PUT','DELETE'].includes(m.method) || (m.record !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(m.record))) return;
    var result;
    if (inflight >= 8) result = { ok: false, error: 'too many requests' };
    else {
      inflight++;
      try {
        var q = new URLSearchParams();
        ['role','surface','access'].forEach(function (k) { var v = params.get(k); if (v) q.set(k, v); });
        if (boot.screen && !q.has('role')) q.set('surface', 'wall');
        var path = (boot.site || '') + '/' + boot.game + '/api/app/records/' + m.collection + (m.record ? '/' + m.record : '') + '?' + q;
        var res = await fetch(path, { method: m.method, headers: { 'content-type': 'application/json' }, body: m.method === 'GET' ? undefined : JSON.stringify({ data: m.data, version: m.version }) });
        result = await res.json();
      } catch (err) { result = { ok: false, error: 'records unavailable; reconnect and retry' }; }
      finally { inflight--; }
    }
    e.source.postMessage({ type: 'homie-app-result', id: m.id, result: result }, '*');
  });
})();`;
