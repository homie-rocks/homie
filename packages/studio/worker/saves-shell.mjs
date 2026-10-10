/**
 * The play shell's half of cloud saves (saves/SAVES.md), in the page around a game whose game.json says
 * `"saves": true`. The game runs in a sandboxed frame with an opaque origin: it can neither read this site's
 * cookies nor keep anything of its own. So the shell, on the site's own origin, does it for the game:
 *
 *   - it answers the game's `homie-save` messages (createSaves in @homie-rocks/studio/saves), only from its own
 *     frame, and only for THIS game (the game id is the page's, never the message's);
 *   - it keeps a local copy of the player's saves in this browser (localStorage, per player and game) and an
 *     outbox of changes, so a save works offline and syncs when the connection comes back, in order: memorials
 *     (a hardcore death and its wipe) first, then saves, then stats;
 *   - every change names the version it was made from, so a stale copy from another device never overwrites newer
 *     progress: on a conflict the newer cloud copy wins, unless the game resolves it (onConflict);
 *   - it shows the sign-in sheet (a passkey) when the game asks, or from the room button, and tells the game when
 *     the player changes.
 */
import { PASSKEY_JS } from './account-page.mjs';

export const SAVES_SHELL_CSS = `
.who-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 10px 2px 0; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.12); font-weight: 500; color: #c9d1e3; }
.who-row b { color: #fff; font-weight: 700; }
.who-row button { background: none; border: 0; color: var(--hot); font: inherit; font-weight: 700; cursor: pointer; padding: 6px 2px; }
.signin { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 16px; background: rgba(2,4,10,.62); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); touch-action: manipulation; -webkit-user-select: text; user-select: text; }
.signin .box { box-sizing: border-box; width: min(380px, 100%); padding: 20px; border-radius: 18px; background: rgba(10,14,24,.97); border: 1px solid rgba(255,255,255,.16); color: #eef1f8; font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif; box-shadow: 0 24px 70px rgba(0,0,0,.6); }
.signin h2 { margin: 0 0 6px; font-size: 20px; }
.signin p { margin: 0 0 12px; color: #b9c2d6; }
.signin input { box-sizing: border-box; width: 100%; min-height: 44px; margin: 0 0 12px; padding: 0 12px; border-radius: 11px; border: 1px solid rgba(255,255,255,.18); background: #05070d; color: #fff; font: 16px ui-sans-serif, system-ui, sans-serif; }
.signin .acts { display: grid; gap: 8px; }
.signin button { min-height: 46px; border-radius: 12px; border: 1px solid rgba(255,255,255,.18); background: transparent; color: inherit; font: 700 15px ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.signin button.primary { background: var(--hot); color: #0b0b10; border-color: transparent; }
.signin .note { margin: 12px 0 0; font-size: 12.5px; color: #8f99b0; }
.signin .note a { color: #c9d1e3; }
.signin .said { min-height: 1.3em; margin: 10px 0 0; font-weight: 600; }
.signin .said.bad { color: #ff8a80; }
`;

export const SAVES_SHELL_JS = `${PASSKEY_JS}
(function () {
  'use strict';
  var boot = window.__HOMIE_PLAY;
  var frame = document.querySelector('iframe.game');
  var P = homiePasskey;
  var GAME = boot.game;
  var KEY = /^[A-Za-z0-9_.:-]{1,64}$/;
  var hint = null;
  try { hint = JSON.parse(localStorage.getItem('homie.player') || 'null'); } catch (e) { hint = null; }
  var S = { player: hint && hint.id ? { id: hint.id, name: hint.name, guest: !!hint.guest, owner: !!hint.owner } : null, cache: {}, pending: {}, falls: [], stats: { add: {}, max: {}, min: {} },
    online: navigator.onLine !== false, lastSyncAt: null, lastError: null, resolver: false, flushing: null, again: false, backoff: 0, timer: null, loaded: false, seq: 0 };
  var state = window.__shell || (window.__shell = {});
  state.saves = { get player() { return S.player; }, status: status, cache: function () { return S.cache; }, pending: function () { return S.pending; } };

  /* -------------------------------------------------- this browser's copy */
  function ns() { return 'homie-saves.' + GAME + '.' + (S.player ? S.player.id : 'anon'); }
  function persist() { try { localStorage.setItem(ns(), JSON.stringify({ cache: S.cache, pending: S.pending, falls: S.falls, stats: S.stats })); } catch (e) {} }
  function restore() {
    S.cache = {}; S.pending = {}; S.falls = []; S.stats = { add: {}, max: {}, min: {} };
    try { var j = JSON.parse(localStorage.getItem(ns()) || 'null'); if (j) { S.cache = j.cache || {}; S.pending = j.pending || {}; S.falls = j.falls || []; S.stats = j.stats || S.stats; } } catch (e) {}
  }
  function valueOf(key) { var p = S.pending[key]; if (p) return p.op === 'del' ? null : p.v; var c = S.cache[key]; return c ? c.v : null; }
  function versionOf(key) { var c = S.cache[key]; return c ? c.ver : 0; }
  function snapshot() { var out = {}; Object.keys(S.cache).forEach(function (k) { out[k] = valueOf(k); }); Object.keys(S.pending).forEach(function (k) { out[k] = valueOf(k); }); Object.keys(out).forEach(function (k) { if (out[k] === null) delete out[k]; }); return out; }
  function pendingCount() { var n = Object.keys(S.pending).length + S.falls.length; ['add', 'max', 'min'].forEach(function (k) { n += Object.keys(S.stats[k]).length ? 1 : 0; }); return n; }
  function status() { return { mode: 'cloud', online: S.online, pending: pendingCount(), lastSyncAt: S.lastSyncAt, lastError: S.lastError }; }

  /* -------------------------------------------------- to and from the game */
  function post(m) { try { frame.contentWindow.postMessage(Object.assign({ t: 'homie-save' }, m), '*'); } catch (e) {} }
  function tell(ev, extra) { post(Object.assign({ ev: ev }, extra || {})); }
  function me() { return S.player ? { id: S.player.id, name: S.player.name, guest: !!S.player.guest, owner: !!S.player.owner, signedIn: !S.player.guest, local: false } : { id: null, name: 'Guest', guest: true, owner: false, signedIn: false, local: false }; }
  var asks = {};
  var askSeq = 0;

  function setPlayer(p, fromServer) {
    var before = S.player ? S.player.id : null;
    var after = p ? p.id : null;
    if (before !== after) {
      // The first save made a guest: this browser's anonymous copy is that guest's now.
      if (!before && after) { var anon = null; try { anon = localStorage.getItem(ns()); localStorage.removeItem(ns()); } catch (e) {} S.player = p; if (anon) { try { localStorage.setItem(ns(), anon); } catch (e) {} } }
      else { S.player = p; restore(); }
    } else S.player = p;
    P.remember(S.player);
    paintWho();
    if (fromServer && before !== after) { tell('player', { player: me(), cache: snapshot() }); }
    else if (fromServer) tell('player', { player: me(), cache: snapshot(), same: true });
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== frame.contentWindow) return;
    var m = ev.data;
    if (!m || typeof m !== 'object' || m.t !== 'homie-save') return;
    var reply = function (body) { post(Object.assign({ q: m.q }, body)); };
    var op = m.op;
    try {
      if (op === 'hello') {
        S.resolver = !!m.resolver;
        // At most 3 s: a slow network gets this browser's copy now, and the cloud's when it lands (a 'player' event).
        var late = false;
        return Promise.race([loaded, new Promise(function (r) { setTimeout(function () { late = true; r(); }, 3000); })]).then(function () {
          reply({ ok: true, player: me(), cache: snapshot(), status: status(), fresh: !late });
          if (late) loaded.then(function () { tell('player', { player: me(), cache: snapshot(), same: true }); });
        });
      }
      if (op === 'get') return loaded.then(function () {
        var key=String(m.key);if(key.indexOf('server:')===0&&KEY.test(key))return api('GET','/api/player/saves/'+GAME+'/'+encodeURIComponent(key)).then(function(r){if(r.ok){S.cache[key]={v:r.value,ver:r.version,at:r.updatedAt};persist();}reply(r);},function(){reply({ok:false,error:'offline',value:valueOf(key)});});
        reply({ ok: true, value: valueOf(key), version: versionOf(key) });
      });
      if (op === 'list') return loaded.then(function () { var keys = {}; Object.keys(S.cache).forEach(function (k) { keys[k] = 1; }); Object.keys(S.pending).forEach(function (k) { keys[k] = 1; });
        reply({ ok: true, keys: Object.keys(keys).filter(function (k) { return valueOf(k) !== null; }).sort().map(function (k) { var c = S.cache[k]; return { key: k, version: c ? c.ver : 0, updatedAt: c ? c.at : null, pending: !!S.pending[k] }; }) }); });
      if (op === 'set' || op === 'del') {
        var key = String(m.key || '');
        if(key.indexOf('server:')===0)return reply({ok:false,error:'authority',message:'This record is written by the game server'});
        if (!KEY.test(key)) return reply({ ok: false, error: 'key', message: 'a save key is 1 to 64 letters, digits, _ . : or -' });
        if (op === 'set') {
          var text; try { text = JSON.stringify(m.value); } catch (e) { return reply({ ok: false, error: 'value', message: 'a save is JSON' }); }
          if (text === undefined) return reply({ ok: false, error: 'value', message: 'a save needs a value' });
          if (text.length > 1048576) return reply({ ok: false, error: 'too-large', message: 'a save is at most 1 MiB' });
        }
        var prev = S.pending[key];
        S.pending[key] = { op: op, v: op === 'set' ? m.value : null, base: prev ? prev.base : versionOf(key), n: ++S.seq };
        persist();
        return flushSoon(250).then(function () {
          var p = S.pending[key];
          if (p && p.err) { var err = p.err; delete S.pending[key]; persist(); return reply({ ok: false, error: err.error, message: err.message }); }
          var c = S.cache[key];
          reply({ ok: true, synced: !S.pending[key], version: c ? c.ver : 0 });
        });
      }
      if (op === 'wipe') {
        var keep = Array.isArray(m.keep) ? m.keep.map(String) : [];
        Object.keys(snapshot()).forEach(function (k) { if (keep.indexOf(k) < 0) S.pending[k] = { op: 'del', v: null, base: S.pending[k] ? S.pending[k].base : versionOf(k), n: ++S.seq }; });
        persist();
        return flushSoon(0).then(function () { reply({ ok: true, synced: pendingCount() === 0 }); });
      }
      if (op === 'stats') {
        if (m.kind === 'get') return api('GET', '/api/player/stats/' + GAME).then(function (r) { reply({ ok: true, stats: merged(r.ok ? r.stats : {}) }); }, function () { reply({ ok: true, stats: merged({}), offline: true }); });
        var kind = m.kind === 'max' || m.kind === 'min' ? m.kind : 'add';
        var bad = null;
        Object.keys(m.values || {}).forEach(function (name) {
          var n = Number(m.values[name]);
          if (!/^[A-Za-z0-9_.:-]{1,32}$/.test(name) || !isFinite(n)) { bad = name; return; }
          var cur = S.stats[kind][name];
          S.stats[kind][name] = cur === undefined ? n : kind === 'add' ? cur + n : kind === 'max' ? Math.max(cur, n) : Math.min(cur, n);
        });
        if (bad !== null) return reply({ ok: false, error: 'stat', message: 'a stat name is 1 to 32 letters, digits, _ . : or -, and its value a number' });
        persist();
        return flushSoon(1500).then(function () { reply({ ok: true, synced: !Object.keys(S.stats[kind]).length }); });
      }
      if (op === 'fall') {
        var f = { character: String(m.character || '').slice(0, 64), summary: m.summary && typeof m.summary === 'object' ? m.summary : {}, wipe: m.wipe === true, keep: Array.isArray(m.keep) ? m.keep.map(String) : [], n: ++S.seq };
        S.falls.push(f);
        // The wipe happens here at once (a death is final even offline); the server does it with the memorial.
        if (f.wipe) { Object.keys(snapshot()).forEach(function (k) { if (f.keep.indexOf(k) < 0) { delete S.pending[k]; delete S.cache[k]; } }); }
        persist();
        return flushSoon(0).then(function () { reply({ ok: true, synced: S.falls.indexOf(f) < 0, memorial: f.memorial || null }); });
      }
      if (op === 'fallen') return api('GET', '/api/player/fallen/' + GAME + '?limit=' + (Number(m.limit) || 20) + (m.mine ? '&mine=1' : '')).then(function (r) { reply({ ok: !!r.ok, fallen: r.fallen || [], message: r.message }); }, function () { reply({ ok: false, fallen: [], error: 'offline', message: 'the hall of the fallen needs a connection' }); });
      if (op === 'rename') return api('POST', '/api/player/name', { name: m.name }).then(function (r) { if (r.ok) setPlayer(Object.assign({}, S.player, { name: r.player.name }), true); reply({ ok: !!r.ok, name: r.ok ? r.player.name : undefined, error: r.error, message: r.message }); }, function () { reply({ ok: false, error: 'offline', message: 'renaming needs a connection' }); });
      if (op === 'signin') { openSheet(m.reason ? String(m.reason).slice(0, 140) : ''); return reply({ ok: true }); }
      if (op === 'flush') return flushSoon(0).then(function () { reply({ ok: true, status: status() }); });
      if (op === 'resolver') { S.resolver = !!m.on; return reply({ ok: true }); }
      if (op === 'resolve' && asks[m.ask]) { var a = asks[m.ask]; delete asks[m.ask]; a(m); return; }
    } catch (e) { reply({ ok: false, error: 'shell', message: String(e && e.message || e) }); }
  });

  function merged(server) {
    var out = {}; Object.keys(server || {}).forEach(function (k) { out[k] = server[k]; });
    Object.keys(S.stats.add).forEach(function (k) { out[k] = (out[k] || 0) + S.stats.add[k]; });
    Object.keys(S.stats.max).forEach(function (k) { out[k] = out[k] === undefined ? S.stats.max[k] : Math.max(out[k], S.stats.max[k]); });
    Object.keys(S.stats.min).forEach(function (k) { out[k] = out[k] === undefined ? S.stats.min[k] : Math.min(out[k], S.stats.min[k]); });
    return out;
  }

  /* -------------------------------------------------- the network */
  function api(method, path, body, keepalive) {
    var init = { method: method, credentials: 'same-origin', cache: 'no-store', headers: {}, keepalive: !!keepalive && (body === undefined || JSON.stringify(body).length < 60000) };
    if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    // A request that hangs (a train tunnel) counts as offline after 12 s; the change stays queued.
    if (typeof AbortController === 'function' && !init.keepalive) { var ac = new AbortController(); setTimeout(function () { ac.abort(); }, 12000); init.signal = ac.signal; }
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'http' }; }).then(function (j) { j.status = r.status; if (r.status >= 500 && !j.error) j.error = 'server'; return j; });
    });
  }
  function online(on) { if (S.online !== on) { S.online = on; tell('status', { status: status() }); } }

  /** What the cloud has for this game: the copy for every key with no change waiting. */
  function refresh() {
    return api('GET', '/api/player/saves/' + GAME + '?values=1').then(function (r) {
      online(true);
      if (!r.ok) { S.lastError = r.message || r.error; return; }
      if (r.player && (!S.player || S.player.id !== r.player.id || S.player.guest !== r.player.guest || S.player.name !== r.player.name)) setPlayer(r.player, true);
      if (!r.player && S.player) setPlayer(null, true);
      if (!r.player) return;
      var seen = {};
      (r.keys || []).forEach(function (k) { seen[k.key] = 1; if (!S.pending[k.key]) S.cache[k.key] = { v: k.value, ver: k.version, at: k.updatedAt }; });
      Object.keys(S.cache).forEach(function (k) { if (!seen[k] && !S.pending[k]) delete S.cache[k]; });
      S.lastSyncAt = Date.now(); persist();
    }, function () { online(false); });
  }

  function flushSoon(ms) {
    clearTimeout(S.timer);
    return new Promise(function (resolve) {
      var waiters = flushSoon.waiters || (flushSoon.waiters = []);
      waiters.push(resolve);
      // A promise for a game never waits more than 4 s: the change is safe in this browser either way.
      setTimeout(function () { var i = waiters.indexOf(resolve); if (i >= 0) { waiters.splice(i, 1); resolve(); } }, 4000);
      S.timer = setTimeout(function () { flush().then(function () { var w = flushSoon.waiters.splice(0); w.forEach(function (f) { f(); }); }); }, ms);
    });
  }

  function flush(keepalive) {
    if (S.flushing) { S.again = true; return S.flushing; }
    S.flushing = run(keepalive).then(function () {
      S.flushing = null;
      if (S.again) { S.again = false; return flush(keepalive); }
    }, function () { S.flushing = null; });
    return S.flushing;
  }

  function retryLater() {
    S.backoff = Math.min(30000, S.backoff ? S.backoff * 2 : 2000);
    clearTimeout(S.retry);
    S.retry = setTimeout(function () { flush(); }, S.backoff);
  }

  function run(keepalive) {
    if (!pendingCount()) return Promise.resolve();
    // 1. Memorials (and their wipes), in order.
    var fallStep = S.falls.length ? api('POST', '/api/player/fallen/' + GAME, (function (f) { return { character: f.character, summary: f.summary, wipe: f.wipe, keep: f.keep }; })(S.falls[0]), keepalive).then(function (r) {
      var f = S.falls[0];
      if (r.player) adopt(r.player);
      if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 429)) {
        S.falls.shift(); f.memorial = r.memorial || null;
        if (!r.ok) S.lastError = r.message || r.error;
        if (r.ok && f.wipe) (r.wiped || []).forEach(function (k) { if (!S.pending[k]) delete S.cache[k]; else S.pending[k].base = 0; });
        if (r.ok && f.wipe) Object.keys(S.pending).forEach(function (k) { if (S.pending[k].n > f.n && f.keep.indexOf(k) < 0) S.pending[k].base = 0; });
        persist();
        return run(keepalive);
      }
      throw new Error(r.status === 429 ? 'rate' : 'server');
    }) : null;
    if (fallStep) return fallStep.then(function () { S.backoff = 0; online(true); }, function () { online(false); retryLater(); });
    // 2. Saves, up to 32 keys a request.
    var keys = Object.keys(S.pending).slice(0, 32);
    var sent = {};
    var body = { set: [], del: [] };
    keys.forEach(function (k) { var p = S.pending[k]; sent[k] = p.n; if (p.op === 'del') body.del.push({ key: k, base: p.base }); else body.set.push({ key: k, value: p.v, base: p.base }); });
    var saveStep = keys.length ? api('POST', '/api/player/saves/' + GAME, body, keepalive).then(function (r) {
      if (r.player) adopt(r.player);
      if (!r.ok && !r.results) { if (r.status >= 400 && r.status < 500 && r.status !== 429) { keys.forEach(function (k) { if (S.pending[k] && S.pending[k].n === sent[k]) S.pending[k].err = { error: r.error, message: r.message }; }); S.lastError = r.message || r.error; return; } throw new Error(r.status === 429 ? 'rate' : 'server'); }
      var asked = [];
      (r.results || []).forEach(function (x) {
        var p = S.pending[x.key];
        var same = p && p.n === sent[x.key];
        if (x.ok) {
          if (p && p.op === 'del' && same) delete S.cache[x.key];
          else if (p && p.op === 'set') S.cache[x.key] = { v: p.v, ver: x.version, at: Date.now() };
          if (same) delete S.pending[x.key]; else if (p) p.base = x.version;
        } else if (x.error === 'conflict') {
          var theirs = x.current || { value: null, version: 0 };
          asked.push(resolve(x.key, p, theirs, same));
        } else if (same) { p.err = { error: x.error, message: x.message }; S.lastError = x.message || x.error; tell('error', { key: x.key, error: x.error, message: x.message }); }
      });
      persist();
      return Promise.all(asked);
    }) : Promise.resolve();
    return saveStep.then(function () {
      // 3. Stats: the sums and highs gathered since the last sync.
      var st = S.stats;
      if (!Object.keys(st.add).length && !Object.keys(st.max).length && !Object.keys(st.min).length) return;
      S.stats = { add: {}, max: {}, min: {} }; persist();
      return api('POST', '/api/player/stats/' + GAME, st, keepalive).then(function (r) {
        if (r.player) adopt(r.player);
        if (!r.ok && (r.status === 429 || r.status >= 500 || !r.status)) { restoreStats(st); throw new Error('server'); }
        if (!r.ok) S.lastError = r.message || r.error;
      }, function (e) { restoreStats(st); throw e; });
    }).then(function () {
      S.backoff = 0; S.lastSyncAt = Date.now(); online(true); persist();
      tell('synced', { status: status() });
      var left = Object.keys(S.pending).filter(function (k) { return !S.pending[k].err; }).length;
      if (left) return run(keepalive);
    }, function () { online(false); retryLater(); tell('status', { status: status() }); });
  }

  function restoreStats(st) {
    ['add', 'max', 'min'].forEach(function (kind) { Object.keys(st[kind]).forEach(function (k) {
      var cur = S.stats[kind][k];
      S.stats[kind][k] = cur === undefined ? st[kind][k] : kind === 'add' ? cur + st[kind][k] : kind === 'max' ? Math.max(cur, st[kind][k]) : Math.min(cur, st[kind][k]);
    }); });
    persist();
  }

  /** The server made this browser a guest (its first save), or the player changed name. */
  function adopt(p) { if (!S.player || S.player.id !== p.id || S.player.guest !== p.guest || S.player.name !== p.name) setPlayer({ id: p.id, name: p.name, guest: p.guest, owner: p.owner }, true); }

  /**
   * Another device saved this key since this browser's copy. The newer cloud copy wins, unless the game said it
   * resolves conflicts: then it is asked (mine, theirs) and its answer is written on top of the cloud's version.
   */
  function resolve(key, p, theirs, same) {
    var mine = p ? (p.op === 'del' ? null : p.v) : null;
    var takeTheirs = function () {
      if (theirs.version) S.cache[key] = { v: theirs.value, ver: theirs.version, at: Date.now() }; else delete S.cache[key];
      if (same) delete S.pending[key];
      persist();
      tell('conflict', { key: key, mine: mine, theirs: theirs.value, theirsVersion: theirs.version, kept: 'theirs' });
    };
    if (!S.resolver) { takeTheirs(); return Promise.resolve(); }
    var id = ++askSeq;
    return new Promise(function (done) {
      var timer = setTimeout(function () { delete asks[id]; takeTheirs(); done(); }, 5000);
      asks[id] = function (m) {
        clearTimeout(timer);
        if (m.keep === 'theirs' || m.value === undefined) { takeTheirs(); return done(); }
        S.cache[key] = { v: theirs.value, ver: theirs.version, at: Date.now() };
        S.pending[key] = { op: m.value === null ? 'del' : 'set', v: m.value, base: theirs.version, n: ++S.seq };
        persist();
        tell('conflict', { key: key, mine: mine, theirs: theirs.value, theirsVersion: theirs.version, kept: 'game' });
        S.again = true;
        done();
      };
      tell('conflict', { key: key, mine: mine, theirs: theirs.value, theirsVersion: theirs.version, ask: id });
    });
  }

  addEventListener('online', function () { online(true); S.backoff = 0; flush(); });
  addEventListener('offline', function () { online(false); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });
  addEventListener('pagehide', function () { flush(true); });

  /* -------------------------------------------------- who is playing, and signing in */
  var sheet = null;
  function account() {
    var href = '/account/?next=' + encodeURIComponent(window.__shell && window.__shell.returnPath ? window.__shell.returnPath() : location.pathname + location.search);
    if (window.__HOMIE_PLAY.embed && window.__shell.openStudio) window.__shell.openStudio(href);
    else location.href = href;
  }
  function paintWho() {
    var row = document.querySelector('[data-who]');
    if (!row) return;
    var name = row.querySelector('[data-who-name]');
    var btn = row.querySelector('[data-who-act]');
    if (S.player && !S.player.guest) { name.textContent = S.player.name; btn.textContent = 'Account'; btn.onclick = function () { account(); }; }
    else { name.textContent = S.player ? S.player.name + ' (guest)' : 'Guest'; btn.textContent = 'Save my progress'; btn.onclick = function () { openSheet(''); }; }
    row.hidden = false;
  }

  function openSheet(reason) {
    if (window.__HOMIE_PLAY.embed && window.top !== window) { account(); return; }
    if (sheet) return;
    var signedIn = S.player && !S.player.guest;
    if (signedIn) { tell('player', { player: me(), cache: snapshot(), same: true }); return; }
    sheet = document.createElement('div');
    sheet.className = 'signin';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Keep your progress');
    var box = document.createElement('div'); box.className = 'box';
    var h = document.createElement('h2'); h.textContent = 'Keep your progress';
    var p = document.createElement('p'); p.textContent = reason || 'Make an account with a passkey (Face ID, a fingerprint or your PIN) and your progress follows you to every device. No password, no email.';
    var input = document.createElement('input'); input.placeholder = 'Your name (optional)'; input.maxLength = 24; input.autocomplete = 'nickname';
    if (S.player && S.player.name) input.placeholder = S.player.name;
    var acts = document.createElement('div'); acts.className = 'acts';
    var make = document.createElement('button'); make.className = 'primary'; make.type = 'button'; make.textContent = 'Make an account';
    var inn = document.createElement('button'); inn.type = 'button'; inn.textContent = 'I have one: sign in';
    var later = document.createElement('button'); later.type = 'button'; later.textContent = 'Not now';
    var said = document.createElement('p'); said.className = 'said'; said.setAttribute('role', 'status');
    var note = document.createElement('p'); note.className = 'note';
    note.append('On this studio only. ');
    var more = document.createElement('a'); more.href = '/account/'; more.target = '_blank'; more.rel = 'noopener'; more.textContent = 'What is kept';
    note.append(more);
    acts.append(make, inn, later);
    box.append(h, p, input, acts, said, note);
    sheet.append(box);
    document.body.append(sheet);
    // Fetched now, so the tap reaches the passkey prompt at once (Safari wants the tap).
    P.prime('up', '/api/player/signup/options'); P.prime('in', '/api/player/signin/options');
    function close() { if (sheet) { sheet.remove(); sheet = null; try { frame.focus(); } catch (e) {} } }
    function busy(on) { make.disabled = inn.disabled = on; }
    later.onclick = close;
    sheet.addEventListener('pointerdown', function (e) { if (e.target === sheet) close(); });
    make.onclick = function () {
      busy(true); said.className = 'said'; said.textContent = 'Follow your device…';
      flush().then(function () { return P.signUp(input.value.trim()); }).then(function (r) {
        setPlayer({ id: r.player.id, name: r.player.name, guest: false, owner: r.player.owner }, true);
        return refresh().then(function () { tell('player', { player: me(), cache: snapshot() }); close(); });
      }).catch(function (e) { said.className = 'said bad'; said.textContent = e && e.name ? P.said(e) : (e && e.message) || 'That did not work.'; busy(false); P.prime('up', '/api/player/signup/options'); });
    };
    inn.onclick = function () {
      busy(true); said.className = 'said'; said.textContent = 'Follow your device…';
      flush().then(function () { return P.signIn(); }).then(function (r) {
        setPlayer({ id: r.player.id, name: r.player.name, guest: false, owner: r.player.owner }, false);
        return refresh().then(function () { tell('player', { player: me(), cache: snapshot() }); close(); });
      }).catch(function (e) { said.className = 'said bad'; said.textContent = e && e.name ? P.said(e) : (e && e.message) || 'That did not work.'; busy(false); P.prime('in', '/api/player/signin/options'); });
    };
  }

  /* -------------------------------------------------- start */
  restore();
  var loaded = refresh().then(function () { paintWho(); return flush(); }, function () { paintWho(); });
}());`;
