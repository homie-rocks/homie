/*
 * Homie's local cards: the MCP Apps bridge (spec 2026-01-26) every card shares. JSON-RPC 2.0 over postMessage
 * with the host: ui/initialize, the tool's input and result, the host's theme, tools/call (the host proxies it to
 * the local Homie server), ui/open-link for every link, ui/update-model-context to tell the model once, and the
 * card's size. No network of its own; every text is set as text, never as HTML.
 */
var Card = (function () {
  var seq = 0; var pending = {}; var ctx = {}; var caps = {};
  var S = { result: null, data: null, timer: null, torn: false, visible: true, told: {}, busy: false };
  var spec = null;
  var root = document.getElementById('root');

  function post(m) { window.parent.postMessage(m, '*'); }
  function rpc(method, params) {
    var id = ++seq;
    post({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error('timeout')); } }, 65000);
    });
  }
  function note(method, params) { post({ jsonrpc: '2.0', method: method, params: params || {} }); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) { var k = arguments[i]; if (k) parent.appendChild(k); } return parent; }
  function btn(label, cls, onclick) { var b = el('button', cls || '', label); b.type = 'button'; b.onclick = onclick; return b; }
  function pill(text, cls, live) { var p = el('span', 'pill ' + (cls || '')); if (live) p.appendChild(el('span', 'dot')); p.appendChild(el('span', '', text)); return p; }
  function top(label, right) { return add(el('div', 'top'), add(el('div', 'eyebrow'), el('span', 'mark'), el('span', '', 'Homie · ' + label)), right || null); }
  function img(src, alt) {
    if (typeof src !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(src)) return null;
    var i = el('img'); i.alt = alt || ''; i.decoding = 'async'; i.src = src; i.onerror = function () { i.remove(); size(); };
    return i;
  }
  function open(url) { if (typeof url === 'string' && /^https?:\/\//.test(url)) rpc('ui/open-link', { url: url }).catch(function () {}); }
  function call(name, args) { return rpc('tools/call', { name: name, arguments: args || {} }); }
  function tell(key, text) {
    if (S.told[key]) return; S.told[key] = true;
    rpc('ui/update-model-context', { content: [{ type: 'text', text: text }] }).catch(function () {});
  }
  function ago(iso) {
    var t = Date.parse(iso || ''); if (!isFinite(t)) return '';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    return s < 5 ? 'just now' : s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago';
  }
  function dur(ms) { if (!(ms >= 0)) return ''; var s = Math.round(ms / 1000); return s < 60 ? s + ' s' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  // As the ext-apps SDK measures: the content's own height (html at max-content) and the frame's width, once a
  // frame, only when either changed.
  var sized = { w: 0, h: 0, queued: false };
  function size() {
    if (sized.queued) return; sized.queued = true;
    requestAnimationFrame(function () {
      sized.queued = false;
      var html = document.documentElement; var was = html.style.height;
      html.style.height = 'max-content';
      var h = Math.ceil(html.getBoundingClientRect().height);
      html.style.height = was;
      var w = Math.ceil(window.innerWidth);
      if (w === sized.w && h === sized.h) return;
      sized.w = w; sized.h = h;
      note('ui/notifications/size-changed', { width: w, height: h });
    });
  }
  function theme(c) {
    if (!c) return;
    if (c.theme === 'light' || c.theme === 'dark') { document.documentElement.setAttribute('data-theme', c.theme); document.documentElement.style.colorScheme = c.theme; }
    var v = c.styles && c.styles.variables;
    if (v) for (var k in v) if (v[k] !== undefined && /^--[a-z0-9-]+$/.test(k)) document.documentElement.style.setProperty(k, v[k]);
    if (c.styles && c.styles.css && c.styles.css.fonts && !document.getElementById('host-fonts')) { var st = el('style'); st.id = 'host-fonts'; st.textContent = c.styles.css.fonts; document.head.appendChild(st); }
  }
  function fullscreenButton() {
    var modes = (ctx && ctx.availableDisplayModes) || [];
    if (modes.indexOf('fullscreen') < 0) return null;
    var full = ctx.displayMode === 'fullscreen';
    return btn(full ? 'Smaller' : 'Full screen', 'ghost small', function () {
      rpc('ui/request-display-mode', { mode: full ? 'inline' : 'fullscreen' }).then(function (r) { ctx.displayMode = r && r.mode; render(); }).catch(function () {});
    });
  }
  function textOf(r) { return (r && r.content && r.content[0] && r.content[0].text) || ''; }
  // An answer's own words, for a card that has nothing of its own to draw from it: short enough to stay a card.
  function words(r) {
    var j = r && r.structuredContent;
    if (j && j.kind === 'job' && j.label) return j.label + (j.state === 'running' ? ' is still running (' + (j.seconds || 0) + ' s so far). Ask again in a moment.' : ': ' + (j.state || 'done') + '.');
    var t = textOf(r).trim(); return t.length > 1500 ? t.slice(0, 1500).replace(/\s+\S*$/, '') + ' …' : t;
  }
  function render() {
    if (!spec) return;
    var card = null;
    if (!S.data) {
      // The tool answered, but not with this card's own data (a plan, a job still running, plain words). The card
      // may draw that answer itself (spec.other); else it shows the answer's words. "Loading" is only for a tool
      // that has not answered yet: an answered card never stays on the skeleton.
      if (S.result && !S.result.isError && spec.other) { try { card = spec.other(S.result.structuredContent || {}, S.result) || null; } catch (e) { card = null; } }
      if (!card) {
        card = el('main', 'card');
        if (S.result && S.result.isError) add(card, top(spec.label, pill('Not done', 'bad')), el('p', 'note bad', textOf(S.result) || 'That did not work.'));
        else if (S.result) add(card, top(spec.label), el('p', 'note words', words(S.result) || 'Done.'));
        else add(card, top(spec.label, pill('Loading', 'live', true)), el('div', 'skel'), el('div', 'skel'));
      }
    } else {
      try { card = spec.render(S.data, S.result); } catch (e) { card = add(el('main', 'card'), top(spec.label), el('p', 'note bad', String(e && e.message || e))); }
      if (S.result && S.result.isError && S.data) card.appendChild(el('p', 'note bad', textOf(S.result)));
    }
    card.id = 'root';
    if (ctx.displayMode === 'fullscreen') card.classList.add('full');
    root.replaceWith(card); root = card; size();
  }
  function take(result) {
    S.result = result;
    if (result && result.structuredContent && result.structuredContent.kind === spec.kind) S.data = result.structuredContent;
    render();
    schedule();
  }
  function schedule() {
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
    if (S.torn || !spec.poll || !S.data) return;
    var p = spec.poll(S.data);
    if (!p) return;
    S.timer = setTimeout(function () {
      S.timer = null;
      if (!S.visible) { schedule(); return; }
      call(p.tool, p.args).then(function (r) { if (r && r.structuredContent && r.structuredContent.kind === spec.kind) take(r); else schedule(); })
        .catch(function () { schedule(); });
    }, p.every || 2000);
  }
  document.addEventListener('visibilitychange', function () { S.visible = !document.hidden; });
  window.addEventListener('resize', size);
  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;
    var m = ev.data; if (!m || m.jsonrpc !== '2.0') return;
    if (m.id !== undefined && m.id !== null && !m.method) {
      var p = pending[m.id]; if (!p) return; delete pending[m.id];
      if (m.error) p.reject(m.error); else p.resolve(m.result);
      return;
    }
    if (m.method === 'ui/notifications/tool-input') { if (!S.result) render(); }
    else if (m.method === 'ui/notifications/tool-result') take(m.params);
    else if (m.method === 'ui/notifications/tool-cancelled') { if (!S.result) { S.result = { isError: true, content: [{ type: 'text', text: 'Cancelled.' }] }; render(); } }
    else if (m.method === 'ui/notifications/host-context-changed') { for (var k in m.params || {}) ctx[k] = m.params[k]; theme(m.params); render(); }
    else if (m.method === 'ui/resource-teardown') { S.torn = true; if (S.timer) clearTimeout(S.timer); if (m.id !== undefined) post({ jsonrpc: '2.0', id: m.id, result: {} }); }
    else if (m.method === 'ping' && m.id !== undefined) post({ jsonrpc: '2.0', id: m.id, result: {} });
  });

  return {
    el: el, add: add, btn: btn, pill: pill, top: top, img: img, open: open, call: call, tell: tell, ago: ago, dur: dur,
    size: size, render: render, take: take, fullscreenButton: fullscreenButton, textOf: textOf,
    ctx: function () { return ctx; },
    state: S,
    /**
     * spec: { kind, label, render(data, result) -> element, poll(data) -> { tool, args, every } | null,
     *         other(structured, result) -> element | null: an answer of another kind this card draws itself }
     */
    start: function (s) {
      spec = s;
      rpc('ui/initialize', {
        protocolVersion: '2026-01-26',
        appInfo: { name: 'homie-studio-' + s.kind + '-card', version: '1' },
        appCapabilities: { availableDisplayModes: s.fullscreen ? ['inline', 'fullscreen'] : ['inline'] },
      }).then(function (res) {
        caps = (res && res.hostCapabilities) || {}; ctx = (res && res.hostContext) || {};
        theme(ctx); note('ui/notifications/initialized', {}); render();
      }).catch(function () { note('ui/notifications/initialized', {}); render(); });
      void caps;
    },
  };
})();
