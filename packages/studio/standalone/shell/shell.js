/*
 * THE STANDALONE SHELL (standalone/STANDALONE.md): the one page of a game's desktop or phone app. It frames the
 * built game exactly as the site's play page does (worker/pages.mjs SHELL_JS, which this mirrors), because the
 * netplay helper only talks to a page around it. Nothing here is about one game: what differs is config.js
 * (window.__HOMIE_APP), which `homie-studio standalone build` writes.
 *
 * It finds a room on the studio's own site (the Lobby, then the room's socket), and when it cannot, the game plays
 * offline with its bots. It never signs anybody in, keeps no cloud saves and opens no shop: the frame is this page's
 * own origin, so the game's saves and settings stay on this device.
 */
(function () {
  'use strict';
  var app = window.__HOMIE_APP || {};
  var game = String(app.game || 'game');
  var name = String(app.name || game);
  var site = String(app.site || '').replace(/\/+$/, '');
  var ver = typeof app.ver === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(app.ver) ? app.ver : '';
  var ROOM = /^[A-Za-z0-9_-]{1,32}$/;
  var frame = document.querySelector('iframe.game');
  var device = Math.min(innerWidth, innerHeight) <= 540 ? 'phone' : 'desk';
  var state = { game: game, room: null, online: false, device: device, attached: false, seat: null, link: null, closed: null, stale: null, outdated: false, finding: false, notice: null, starts: 0, net: null };
  window.__shell = state;
  try { document.title = name; frame.title = name; } catch (e) {}
  // The game's own palette (its style.json), as on the play page: the button wears its paper and text.
  try {
    var c = app.colours;
    var hex = /^#[0-9a-f]{6}$/i;
    if (c && hex.test(c.paper) && hex.test(c.text)) { document.documentElement.style.setProperty('--paper', c.paper + 'e6'); document.documentElement.style.setProperty('--text', c.text); }
    if (c && hex.test(c.hot)) document.documentElement.style.setProperty('--hot', c.hot);
  } catch (e) {}

  // This device's room key: random, kept in this app's own storage, and sent only to this studio's rooms. It is
  // what an owner's kick holds out of a room for a while; it says nothing about who the player is.
  function rnd() {
    try { var a = new Uint8Array(16); crypto.getRandomValues(a); var s = ''; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    catch (e) { var r = ''; while (r.length < 22) r += Math.random().toString(36).slice(2); return r.slice(0, 22); }
  }
  var roomKey = null;
  try { roomKey = localStorage.getItem('homie-b'); if (!/^[A-Za-z0-9_-]{16,43}$/.test(roomKey || '')) { roomKey = rnd(); localStorage.setItem('homie-b', roomKey); } } catch (e) { roomKey = rnd(); }

  // A room the player chose (a friend's code, a private room of their own) is remembered; a Quick play room is not.
  var REMEMBER = 'homie-app.' + game + '.room';
  function remembered() { try { var r = localStorage.getItem(REMEMBER); return ROOM.test(r || '') ? r : null; } catch (e) { return null; } }
  function remember(room) { try { if (room) localStorage.setItem(REMEMBER, room); else localStorage.removeItem(REMEMBER); } catch (e) {} }

  var ui = document.querySelector('[data-room-ui]');
  var toggle = ui.querySelector('[data-share-toggle]');
  var sheet = ui.querySelector('[data-share-sheet]');
  var toast = document.querySelector('[data-toast]');
  var noticeEl = document.querySelector('[data-notice]');
  var dimTimer = null;
  // Where the button sits on THIS device (game.json screen.share), so it never covers the game's own HUD.
  function place() {
    if (!app.share) return;
    var key = device === 'phone' ? (innerWidth > innerHeight ? 'sideways' : 'phone') : 'desk';
    var p = app.share[key] || app.share.desk;
    if (!p) return;
    ui.className = 'room at-' + p.at;
    ui.style.setProperty('--dx', (p.x || 0) + 'px');
    ui.style.setProperty('--dy', (p.y || 0) + 'px');
    if (p.label === false) toggle.classList.add('icon'); else toggle.classList.remove('icon');
    state.share = { device: key, at: p.at, x: p.x || 0, y: p.y || 0, label: p.label !== false };
  }
  place();
  addEventListener('resize', place);
  function labelOf(room) { var m = /^pub-(\d+)$/.exec(room); return m ? 'Room ' + m[1] : room; }
  function flash(text, tap) {
    toast.textContent = text; toast.hidden = false; toast.onclick = tap || null;
    if (tap) toast.classList.add('tap'); else toast.classList.remove('tap');
    clearTimeout(flash.t);
    flash.t = setTimeout(function () { toast.hidden = true; toast.onclick = null; }, tap ? 12000 : 2600);
  }
  function wake() {
    toggle.classList.remove('dim');
    clearTimeout(dimTimer);
    dimTimer = setTimeout(function () { if (sheet.hidden && state.online && (!state.link || state.link.state === 'online')) toggle.classList.add('dim'); }, 6000);
  }
  function open(on) { sheet.hidden = !on; toggle.setAttribute('aria-expanded', on ? 'true' : 'false'); wake(); tellRects(); if (!on) { try { frame.focus(); } catch (e) {} } }
  function copy(text, done) {
    var ok = function () { flash(done || 'Link copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { flash(text); });
    else flash(text);
  }
  /** The room's address on the studio's site: a friend opens it in any browser and lands in this room. */
  function linkOf(room) { return site + '/' + game + '/play?room=' + encodeURIComponent(room); }

  var canOffline = !app.room || app.room.host === 'browser' || app.room.offline !== false;
  noticeEl.querySelector('[data-notice-offline]').hidden = !canOffline;
  // What the button and its sheet say: the room, or plainly that this copy plays offline.
  function paint() {
    var alone = !state.online || (state.link && state.link.state === 'alone');
    var word = !state.starts ? 'Finding a room…' : alone ? (canOffline ? 'Playing offline · Try again' : 'Connection needed · Try again') : state.link && state.link.state === 'reconnecting' ? 'Reconnecting…' : labelOf(state.room);
    ui.querySelector('[data-room-code]').textContent = word;
    ui.querySelector('[data-room-label]').textContent = state.online ? labelOf(state.room) : 'Offline';
    ui.querySelector('[data-room-state]').textContent = !site ? 'This copy has no online address' : alone ? 'No room answered' : '';
    // A copy the site has outgrown cannot invite anybody: a friend's browser would land on the newer version, which
    // this copy cannot join. The line about updating stands where the invite was.
    ui.querySelector('[data-room-link]').textContent = state.outdated ? STALE : state.online ? linkOf(state.room).replace(/^https?:\/\//, '') : (canOffline ? 'Your game and its bots are on this device.' : 'This game needs a connection.');
    ui.querySelector('[data-invite]').hidden = !state.online || state.outdated;
    ui.querySelector('[data-quick]').textContent = alone ? 'Try again' : 'Quick play';
    if (alone) ui.querySelector('[data-quick]').classList.add('primary'); else ui.querySelector('[data-quick]').classList.remove('primary');
    ui.querySelector('[data-offline]').hidden = !state.online || !canOffline;
    wake();
    tellRects();
  }

  /** Which public room to join: the studio's Lobby, within this copy's own build of the game (`gv`). Any failure: null. */
  var avoid = [];
  function lobby() {
    if (!site || typeof fetch !== 'function') return Promise.resolve(null);
    var q = [];
    if (ver) q.push('gv=' + encodeURIComponent(ver));
    if (avoid.length) q.push('not=' + avoid.slice(-4).map(encodeURIComponent).join(','));
    var opts = { method: 'POST' };
    try { if (typeof AbortController === 'function') { var ac = new AbortController(); opts.signal = ac.signal; setTimeout(function () { try { ac.abort(); } catch (e) {} }, 6000); } } catch (e) {}
    return fetch(site + '/' + game + '/api/lobby' + (q.length ? '?' + q.join('&') : ''), opts)
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.error === 'stale') { state.outdated = true; flash(STALE); } return j && typeof j.room === 'string' && ROOM.test(j.room) ? j.room : null; })
      .catch(function () { return null; });
  }

  var KEY = null;
  /*
   * The seat's token is kept in this app's own storage, not for the visit only: an app that is closed and opened
   * again comes back to its seat, where a fresh one would meet its own body still standing in the room.
   */
  function tokenOf(key) { try { var t = localStorage.getItem(key); return typeof t === 'string' && t.length > 0 && t.length <= 256 ? t : null; } catch (e) { return null; } }
  /** Start the game in `room`, or offline (null): what the helper reads as HOMIE_NET, then the frame. */
  function start(room) {
    state.room = room; state.online = Boolean(room); state.attached = false; state.seat = null;
    state.link = null; state.closed = null; state.stale = null; state.finding = false;
    KEY = room ? 'homie-net.' + game + '.' + room + '.play' : null;
    var token = KEY ? tokenOf(KEY) : null;
    var cfg = {
      v: 1,
      url: room ? site.replace(/^http/, 'ws') + '/' + game + '/__net?room=' + encodeURIComponent(room) + '&b=' + roomKey + (ver ? '&gv=' + encodeURIComponent(ver) : '') : '',
      params: app.params && typeof app.params === 'object' ? app.params : {},
      prefs: true, device: device, want: 'play', debug: false, chatOff: true, bubbleOff: true, app: true,
    };
    if (room) cfg.room = room;
    if (ver) cfg.ver = ver;
    if (token) cfg.token = token;
    if (app.movement) cfg.movement = app.movement;
    state.net = cfg;
    window.__HOMIE_APP_NET = cfg;
    state.starts += 1;
    // The same address again does not load a frame again: every start after the first names its turn.
    turn = state.starts > 1 ? '?start=' + state.starts : '';
    frame.src = 'game/index.html' + turn;
    paint();
  }
  /** The turn the frame was last told to load: a message from the page before it is not about this room. */
  var turn = '';
  function current() { try { return frame.contentWindow.location.search === turn; } catch (e) { return false; } }
  /*
   * Ask the Lobby, and never keep the player at a blank screen for it: with no answer in a second and a half the
   * game starts offline, and a room that arrives after that is offered ("Back online · Join"), never switched to
   * under the player. One search at a time: a second press while one is out does nothing.
   */
  var WAIT = 1500;
  function find() {
    if (state.finding) return;
    state.finding = true;
    var asked = state.starts;
    // Asked for by somebody already playing offline ("Try again"): their round goes on while the Lobby is asked.
    if (asked > 0 && !state.online) {
      lobby().then(function (room) {
        state.finding = false;
        if (state.starts !== asked) return;
        if (room) start(room); else { flash(state.outdated ? STALE : canOffline ? 'No room answered: still playing offline.' : 'This game needs a connection.'); paint(); }
      });
      return;
    }
    var late = false;
    var timer = setTimeout(function () { if (state.finding && state.starts === asked) { late = true; start(null); state.finding = true; } }, WAIT);
    lobby().then(function (room) {
      clearTimeout(timer);
      if (!late) { if (state.starts === asked) start(room); else state.finding = false; return; }
      state.finding = false;
      // The player may have chosen a room meanwhile: only somebody still offline is offered this one.
      if (room && !state.online) flash('Back online · Join', function () { toast.hidden = true; hide(); start(room); });
    });
  }
  function quick() { if (state.finding) return; remember(null); hide(); flash('Finding a room…'); find(); }
  /** Back to the room the player chose, else the Lobby's. */
  function go() { if (state.finding) return; var kept = remembered(); hide(); if (kept && site) start(kept); else find(); }
  function join(code) {
    if (!ROOM.test(code)) { flash('A room code is 1 to 32 letters, digits, - or _.'); return false; }
    if (!site) { flash(canOffline ? 'This copy has no online address: it plays offline.' : 'This game needs an online address and a connection.'); return false; }
    remember(code); hide(); open(false); start(code);
    return true;
  }
  function privateCode() {
    var abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    var out = '';
    try { var a = new Uint8Array(6); crypto.getRandomValues(a); for (var i = 0; i < 6; i++) out += abc[a[i] % abc.length]; }
    catch (e) { while (out.length < 6) out += abc[Math.floor(Math.random() * abc.length)]; }
    return out;
  }

  // A room this copy cannot stay in, said plainly, with the two ways on: another room, or the game by itself.
  function notice(title, text) {
    state.notice = { title: title, text: text };
    noticeEl.querySelector('[data-notice-title]').textContent = title;
    noticeEl.querySelector('[data-notice-text]').textContent = text;
    noticeEl.hidden = false;
    tellRects();
  }
  function hide() { state.notice = null; noticeEl.hidden = true; }
  var STALE = 'Update ' + name + ' to play online with everyone.';

  /*
   * NET.PREFS (NETPLAY.md section 24), kept by this page as the play page keeps them: one JSON object per game in
   * this app's own storage, 16 KB, 32 keys and 64 characters a key at most; with no storage, for the visit.
   */
  var PREFS_KEY = 'homie-prefs.' + game;
  var PREFS = { bytes: 16384, keys: 32, key: 64 };
  var prefsMem = null;
  function prefsRead() {
    if (prefsMem) return prefsMem;
    try { var o = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { prefsMem = {}; return prefsMem; }
  }
  function prefsWrite(o) {
    var text = JSON.stringify(o);
    if (typeof text !== 'string' || text.length > PREFS.bytes || Object.keys(o).length > PREFS.keys) return 'too-large';
    if (prefsMem) { prefsMem = o; return 'memory'; }
    try { localStorage.setItem(PREFS_KEY, text); return 'kept'; } catch (e) { prefsMem = o; return 'memory'; }
  }
  function answerPrefs(m) {
    var out = { t: 'homie-prefs', n: m.n, ok: false };
    try {
      var all = prefsRead();
      var k = m.k;
      var okKey = typeof k === 'string' && k.length > 0 && k.length <= PREFS.key && k !== '__proto__';
      if (m.op === 'all') { out.ok = true; out.all = all; }
      else if (!okKey) out.why = 'key';
      else if (m.op === 'set' || m.op === 'del') {
        var next = {};
        Object.keys(all).forEach(function (x) { if (x !== k) next[x] = all[x]; });
        if (m.op === 'set' && m.v !== null && m.v !== undefined) next[k] = m.v;
        // A NaN or an Infinity would be written as null and read back as a setting: refused.
        var how = m.op === 'set' && typeof m.v === 'number' && !isFinite(m.v) ? 'value' : prefsWrite(next);
        if (how === 'too-large' || how === 'value') out.why = how; else { out.ok = true; out.kept = how; }
      } else out.why = 'op';
    } catch (e) { out.why = 'error'; }
    state.prefs = { op: m.op, ok: out.ok, why: out.why || null };
    try { frame.contentWindow.postMessage(out, '*'); } catch (e2) {}
  }

  // Where this page's own controls sit over the game (section 24), in the game's own CSS pixels.
  var RECTS = [['room', '[data-share-toggle]'], ['sheet', '[data-share-sheet]'], ['notice', '[data-notice]']];
  var lastRects = '';
  function shellRects() {
    var out = [];
    RECTS.forEach(function (r) {
      var el = null;
      try { el = document.querySelector(r[1]); } catch (e) { el = null; }
      if (!el || el.hidden || typeof el.getBoundingClientRect !== 'function') return;
      var b = el.getBoundingClientRect();
      if (!b || !(b.width > 0) || !(b.height > 0)) return;
      out.push({ id: r[0], x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) });
    });
    return out;
  }
  function tellRects() {
    if (!state.attached) return;
    var w = typeof innerWidth === 'number' ? innerWidth : 0;
    var h = typeof innerHeight === 'number' ? innerHeight : 0;
    var msg = { t: 'homie-shell', device: device, orientation: w > h ? 'landscape' : 'portrait', width: w, height: h, rects: shellRects() };
    var sig = JSON.stringify(msg);
    if (sig === lastRects) return;
    lastRects = sig;
    state.rects = msg;
    try { frame.contentWindow.postMessage(msg, '*'); } catch (e) {}
  }

  // What the game's helper says to the page around it.
  window.addEventListener('message', function (ev) {
    if (ev.source !== frame.contentWindow) return;
    var m = ev.data;
    if (!m || typeof m !== 'object' || m.t !== 'homie-net') return;
    // The frame is one window through every start: a word from the page of the start BEFORE this one (still on its
    // way out) is not about this room. The page of this start is the one whose address names this turn.
    if (!current()) return;
    // An offline helper never says `attached`: its first word of any kind is as good.
    if (!state.attached) { state.attached = true; lastRects = ''; tellRects(); }
    if (m.what === 'prefs') answerPrefs(m);
    // A seat's token is this room's only when the helper says so: it is never kept under another room's name.
    if (m.what === 'token' && typeof m.token === 'string' && m.room === state.room && KEY) { state.seat = m.seat; try { localStorage.setItem(KEY, m.token.slice(0, 256)); } catch (e) {} }
    // The link: in the room, knocking again, or playing alone because the room never answered.
    if (m.what === 'link' && typeof m.state === 'string') { state.link = { state: m.state, why: String(m.why || ''), at: Date.now() }; paint(); }
    // A newer build of the game is live on the site. This copy cannot load it: only an update of the app can, so
    // it is said, never reloaded. Kept out of a room for it (final): the notice, with the ways on.
    if (m.what === 'stale') {
      state.stale = { ver: typeof m.ver === 'string' ? m.ver : null, final: m.final === true };
      state.outdated = true;
      paint();
      if (m.final === true) notice('A new version is out', STALE); else flash(STALE);
    }
    // Stopped for good in THIS room (a helper from before 0.32.0 does not name the room: it is taken at its word).
    if (m.what === 'closed' && m.why !== 'stale' && (m.room === undefined || m.room === null || m.room === state.room)) {
      state.closed = m.why;
      if (state.room && avoid.indexOf(state.room) < 0) avoid.push(state.room);
      if (m.why === 'kicked') notice('You were removed from this room', 'The studio removed this device from the room for a while.');
      else if (m.why === 'room-closed') notice('This room is closed', 'The studio closed this room.');
      else if (m.why === 'room-full' || m.why === 'too-many') notice('This room is full', 'Every seat in this room is taken.');
      else if (m.why === 'replaced') notice('Playing somewhere else', 'This seat was opened again from another place.');
    }
  });

  frame.addEventListener('load', function () {
    try { frame.focus(); frame.contentWindow.focus(); } catch (e) {}
    // The helper may start after the frame's load: the rectangles are said again once it has.
    state.attached = true; lastRects = ''; tellRects();
    setTimeout(function () { lastRects = ''; tellRects(); }, 1500);
  });
  window.addEventListener('pointerdown', function (e) { if (ui.contains(e.target) || noticeEl.contains(e.target)) return; try { frame.focus(); } catch (e2) {} }, { passive: true });
  toggle.addEventListener('click', function (e) { e.stopPropagation(); open(sheet.hidden); });
  document.addEventListener('pointerdown', function (e) { if (!sheet.hidden && !ui.contains(e.target)) open(false); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) open(false); });
  ui.querySelector('[data-invite]').addEventListener('click', function () {
    if (!state.online) { flash('Join a room first: this game is playing offline.'); return; }
    var link = linkOf(state.room);
    var data = { title: name, text: 'Play ' + name + ' with me: join my room.', url: link };
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) navigator.share(data).catch(function () {});
    else copy(link, 'Invite link copied');
  });
  ui.querySelector('[data-quick]').addEventListener('click', function () { open(false); if (state.online) quick(); else go(); });
  ui.querySelector('[data-private]').addEventListener('click', function () { join(privateCode()); });
  ui.querySelector('[data-offline]').addEventListener('click', function () { open(false); hide(); start(null); });
  ui.querySelector('[data-join-form]').addEventListener('submit', function (e) {
    if (e && e.preventDefault) e.preventDefault();
    var input = ui.querySelector('[data-join-code]');
    if (join(String(input.value || '').trim())) input.value = '';
  });
  noticeEl.querySelector('[data-notice-quick]').addEventListener('click', quick);
  noticeEl.querySelector('[data-notice-offline]').addEventListener('click', function () { hide(); start(null); });
  // The device is online again while the game plays offline: offered, never done for the player mid-round.
  addEventListener('online', function () {
    if (!site || state.finding || (state.online && !(state.link && state.link.state === 'alone'))) return;
    flash('Back online · Join', function () { toast.hidden = true; go(); });
  });
  addEventListener('resize', tellRects);
  if (typeof setInterval === 'function') setInterval(tellRects, 1000);
  state.join = join; state.quick = quick; state.go = go;

  go();
})();
