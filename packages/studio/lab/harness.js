/*
 * The Game Lab's harness (@homie-rocks/studio lab/harness.js): the first script of a game's page when the lab serves
 * it (/new/ and /today/, `homie-studio lab <game>`), before the game's own. It makes a take replayable:
 *
 *   - THE CLOCK. requestAnimationFrame, performance.now(), Date.now() (and new Date()), setTimeout and setInterval run
 *     on the lab's clock. Frame f happens at exactly f / fps seconds, and only when the lab steps it, so a take plays
 *     the same at 1x, 1/10 or one frame at a time, and a paused game is paused all the way down (netplay's offline
 *     host, a round's countdown, a knockback's timer).
 *   - THE DICE. Math.random() is seeded (the world's dice, the same in both builds); window.__homieLab.random() is a
 *     second stream for juice (particles, shake), so a build that adds a spark never moves a gem in the other.
 *   - STORAGE. localStorage and sessionStorage are this take's own, in memory, seeded from the take (a hero at level
 *     3), so a take never changes the next one.
 *   - INPUT. A take's keys and pointer presses are dispatched at the start of their frame. While the person records,
 *     their real presses are held back and dispatched the same way at the next frame (both panes get them at the same
 *     frame); while a take replays, real presses are ignored. Focus changes never reach the game.
 *   - WHAT THE GAME SAYS. window.__homieLab is what @homie-rocks/studio/lab calls: tracked values, phases, poses,
 *     preset views, overlays and tunables, recorded per frame for the lab page to draw.
 *
 * The page that frames it (the lab page) drives it through window.__homieLabPane. Opened on its own (no lab around
 * it) it plays in real time on the same seeded clock. Plain script, no build step: it is served as it is.
 */
(function () {
  'use strict';
  if (window.__homieLabPane) return;

  var real = {
    now: performance.now.bind(performance),
    raf: window.requestAnimationFrame.bind(window),
    setTimeout: window.setTimeout.bind(window),
    random: Math.random,
    Date: Date,
  };

  /* ------------------------------------------------------------------ config (from the lab page around it) */
  var pane = /\/today\//.test(location.pathname) ? 'today' : 'new';
  var cfg = null;
  try { if (window.parent !== window && window.parent.__homieLabPanes) cfg = window.parent.__homieLabPanes.config(pane); } catch (e) { cfg = null; }
  var free = !cfg;
  cfg = cfg || {};
  var fps = [60, 30, 15, 12].indexOf(Number(cfg.fps)) >= 0 ? Number(cfg.fps) : 60;
  var step = 1000 / fps;
  var seed = (Number(cfg.seed) >>> 0) || 1;
  var epoch = Number.isFinite(cfg.epoch) ? cfg.epoch : Date.UTC(2026, 0, 1);
  var inputs = Array.isArray(cfg.inputs) ? cfg.inputs.slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); }) : [];
  var mode = cfg.mode === 'record' ? 'record' : 'replay';
  var limit = Number(cfg.frames) > 0 ? Number(cfg.frames) : Infinity;

  /* ------------------------------------------------------------------ the dice */
  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      var t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }
  function dice(s) { var r = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, s); for (var i = 0; i < 15; i++) r(); return r; }
  var worldDice = dice(seed);
  var fxDice = dice((seed ^ 0x5bd1e995) >>> 0);
  Math.random = function () { return worldDice(); };

  /* ------------------------------------------------------------------ the clock */
  var vt = 0; // ms since the page started, on the lab's clock
  var frame = 0;
  performance.now = function () { return vt; };
  var RealDate = real.Date;
  function LabDate() {
    var a = Array.prototype.slice.call(arguments);
    if (!(this instanceof LabDate)) return new RealDate(epoch + vt).toString();
    return a.length ? new (Function.prototype.bind.apply(RealDate, [null].concat(a)))() : new RealDate(epoch + vt);
  }
  LabDate.prototype = RealDate.prototype;
  LabDate.now = function () { return epoch + vt; };
  LabDate.parse = RealDate.parse;
  LabDate.UTC = RealDate.UTC;
  window.Date = LabDate;

  var rafQ = new Map();
  var rafId = 0;
  window.requestAnimationFrame = function (cb) { rafId += 1; rafQ.set(rafId, cb); return rafId; };
  window.cancelAnimationFrame = function (id) { rafQ.delete(id); };

  var timers = new Map();
  var timerId = 0;
  var timerSeq = 0;
  function addTimer(fn, ms, args, every) {
    timerId += 1;
    timers.set(timerId, { at: vt + Math.max(0, Number(ms) || 0), fn: fn, args: args, every: every ? Math.max(1, Number(ms) || 0) : 0, seq: ++timerSeq });
    return timerId;
  }
  window.setTimeout = function (fn, ms) { return addTimer(fn, ms, Array.prototype.slice.call(arguments, 2), false); };
  window.setInterval = function (fn, ms) { return addTimer(fn, ms, Array.prototype.slice.call(arguments, 2), true); };
  window.clearTimeout = window.clearInterval = function (id) { timers.delete(id); };
  function fireTimers(until) {
    for (var guard = 0; guard < 10000; guard++) {
      var next = null; var nextId = 0;
      timers.forEach(function (tm, id) { if (tm.at <= until && (!next || tm.at < next.at || (tm.at === next.at && tm.seq < next.seq))) { next = tm; nextId = id; } });
      if (!next) return;
      if (next.at > vt) vt = next.at;
      if (next.every) { next.at += next.every; next.seq = ++timerSeq; } else timers.delete(nextId);
      try { if (typeof next.fn === 'function') next.fn.apply(window, next.args); } catch (e) { error(e); }
    }
  }

  /* ------------------------------------------------------------------ storage: this take's own */
  function memStorage(seedItems) {
    var m = new Map();
    if (seedItems && typeof seedItems === 'object') Object.keys(seedItems).forEach(function (k) { m.set(String(k), typeof seedItems[k] === 'string' ? seedItems[k] : JSON.stringify(seedItems[k])); });
    return {
      getItem: function (k) { k = String(k); return m.has(k) ? m.get(k) : null; },
      setItem: function (k, v) { m.set(String(k), String(v)); },
      removeItem: function (k) { m.delete(String(k)); },
      clear: function () { m.clear(); },
      key: function (i) { return Array.from(m.keys())[i] || null; },
      get length() { return m.size; },
    };
  }
  var local = memStorage(cfg.storage);
  var session = memStorage(null);
  try { Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return local; } }); } catch (e) { /* kept */ }
  try { Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { return session; } }); } catch (e) { /* kept */ }

  /* ------------------------------------------------------------------ the display */
  if (Number(cfg.dpr) > 0) { var dpr = Number(cfg.dpr); try { Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: function () { return dpr; } }); } catch (e) { /* kept */ } }

  /* ------------------------------------------------------------------ input */
  var KEYS = ['keydown', 'keyup'];
  var POINTERS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'];
  var queued = []; // inputs for the next frame (recorded, or forwarded from the other pane)
  var recorded = [];
  var nextInput = 0;
  var captured = new Map(); // pointerId -> element (pointer capture for synthetic pointers)
  var sp = Element.prototype.setPointerCapture;
  var rp = Element.prototype.releasePointerCapture;
  var hp = Element.prototype.hasPointerCapture;
  Element.prototype.setPointerCapture = function (id) { captured.set(id, this); try { sp.call(this, id); } catch (e) { /* a synthetic pointer */ } };
  Element.prototype.releasePointerCapture = function (id) { if (captured.get(id) === this) captured.delete(id); try { rp.call(this, id); } catch (e) { /* a synthetic pointer */ } };
  Element.prototype.hasPointerCapture = function (id) { return captured.get(id) === this || (function (el) { try { return hp.call(el, id); } catch (e) { return false; } })(this); };

  function keyInfo(code) {
    var known = { ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40], Space: [' ', 32], Enter: ['Enter', 13], Escape: ['Escape', 27], ShiftLeft: ['Shift', 16], ShiftRight: ['Shift', 16] };
    if (known[code]) return known[code];
    var l = /^Key([A-Z])$/.exec(code); if (l) return [l[1].toLowerCase(), l[1].charCodeAt(0)];
    var d = /^Digit([0-9])$/.exec(code); if (d) return [d[1], 48 + Number(d[1])];
    return [code, 0];
  }
  function dispatch(ev) {
    if (ev.type === 'key') {
      var k = keyInfo(ev.code);
      var ke = new KeyboardEvent(ev.down ? 'keydown' : 'keyup', { key: k[0], code: ev.code, bubbles: true, cancelable: true, composed: true });
      try { Object.defineProperty(ke, 'keyCode', { get: function () { return k[1]; } }); Object.defineProperty(ke, 'which', { get: function () { return k[1]; } }); } catch (e) { /* read-only */ }
      var at = document.activeElement && document.activeElement !== document.documentElement ? document.activeElement : document.body || document;
      at.dispatchEvent(ke);
      return;
    }
    if (ev.type === 'pointer') {
      var type = 'pointer' + ev.ev;
      var target = captured.get(ev.id) || document.elementFromPoint(ev.x, ev.y) || document.body;
      var pe = new PointerEvent(type, { clientX: ev.x, clientY: ev.y, screenX: ev.x, screenY: ev.y, pointerId: ev.id, pointerType: ev.pt || 'touch', isPrimary: ev.id === (ev.primary || ev.id), buttons: ev.ev === 'up' || ev.ev === 'cancel' ? 0 : 1, button: ev.ev === 'move' ? -1 : 0, bubbles: true, cancelable: true, composed: true, width: 20, height: 20, pressure: ev.ev === 'up' ? 0 : 0.5 });
      target.dispatchEvent(pe);
      if (ev.ev === 'up' || ev.ev === 'cancel') captured.delete(ev.id);
    }
  }
  function fromEvent(e) {
    if (KEYS.indexOf(e.type) >= 0) return { type: 'key', code: e.code, down: e.type === 'keydown' };
    var ev = e.type.slice(7);
    return { type: 'pointer', ev: ev, x: Math.round(e.clientX * 10) / 10, y: Math.round(e.clientY * 10) / 10, id: e.pointerId, pt: e.pointerType === 'mouse' ? 'mouse' : e.pointerType || 'touch' };
  }
  // Real presses: held back for the next frame while recording (and given to the other pane too), ignored otherwise.
  function onReal(e) {
    if (!e.isTrusted) return;
    if (KEYS.indexOf(e.type) >= 0 && (e.repeat || e.metaKey || e.ctrlKey)) { if (e.repeat) { e.stopImmediatePropagation(); e.preventDefault(); } return; }
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) return; // typing into the game's own box
    e.stopImmediatePropagation();
    if (KEYS.indexOf(e.type) >= 0 || e.type !== 'pointermove') e.preventDefault();
    if (mode !== 'record' || free) { if (free) dispatchLater(fromEvent(e)); return; }
    var ev = fromEvent(e);
    try { window.parent.__homieLabPanes.input(pane, ev); } catch (x) { queue(ev); }
  }
  function dispatchLater(ev) { queued.push(ev); }
  KEYS.concat(POINTERS).forEach(function (t) { window.addEventListener(t, onReal, true); });
  // Focus coming and going (the person clicking the lab's buttons) is not the game's business.
  ['blur', 'focus'].forEach(function (t) { window.addEventListener(t, function (e) { if (e.target === window) e.stopImmediatePropagation(); }, true); });
  document.addEventListener('visibilitychange', function (e) { e.stopImmediatePropagation(); }, true);

  function queue(ev) {
    var at = Math.round((frame + 1) * step * 1000) / 1000;
    var row = Object.assign({ at: at }, ev);
    // A pointer that moved twice before the next frame: only where it ended counts (a take stays small).
    var last = recorded[recorded.length - 1];
    if (row.type === 'pointer' && row.ev === 'move' && last && last.at === at && last.type === 'pointer' && last.ev === 'move' && last.id === row.id) {
      recorded[recorded.length - 1] = row;
      for (var i = queued.length - 1; i >= 0; i--) if (queued[i] === last) { queued[i] = row; break; }
      return;
    }
    queued.push(row);
    recorded.push(row);
  }

  /* ------------------------------------------------------------------ what the game reports */
  var meta = { units: {}, views: [], overlays: [], tunables: null, used: { track: 0, phase: 0, pose: 0 }, errors: [], held: false };
  var phaseNow = null;
  var cur = null;
  var poses = new Map();
  var view = typeof cfg.view === 'string' ? cfg.view : null;
  var overlaysOn = new Set(Array.isArray(cfg.overlays) ? cfg.overlays : []);
  var live = cfg.tunables && typeof cfg.tunables === 'object' ? Object.assign({}, cfg.tunables) : {};
  var frames = [];
  var readyWaiters = [];
  var state = { scale: Number(cfg.scale) || 1, paused: false };

  function error(e) {
    var m = String((e && (e.message || e.reason)) || e).slice(0, 240);
    if (meta.errors.length < 20 && meta.errors.indexOf(m) < 0) meta.errors.push(m);
  }
  window.addEventListener('error', function (e) { error(e.error || e.message); });
  window.addEventListener('unhandledrejection', function (e) { error(e.reason); });

  window.__homieLab = {
    v: 1,
    pane: pane,
    stage: typeof cfg.stage === 'string' && cfg.stage ? cfg.stage.slice(0, 32) : null,
    get frame() { return frame; },
    get fps() { return fps; },
    get scale() { return state.scale; },
    get paused() { return state.paused; },
    track: function (name, value, unit) {
      meta.used.track += 1;
      var v = Number(value);
      if (cur) cur.tr[String(name).slice(0, 32)] = Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
      if (unit && !meta.units[name]) meta.units[name] = String(unit).slice(0, 12);
      else if (!(name in meta.units)) meta.units[name] = '';
    },
    phase: function (name, note) {
      meta.used.phase += 1;
      phaseNow = name ? [String(name).slice(0, 24), note ? String(note).slice(0, 90) : ''] : null;
      if (cur) cur.ph = phaseNow;
    },
    pose: function (name, value) {
      meta.used.pose += 1;
      var ring = poses.get(name);
      if (!ring) { ring = []; poses.set(name, ring); }
      var copy = {};
      if (value && typeof value === 'object') Object.keys(value).forEach(function (k) { copy[k] = value[k]; });
      if (ring.length && ring[ring.length - 1].f === frame) ring[ring.length - 1].v = copy; else ring.push({ f: frame, v: copy });
      if (ring.length > 720) ring.shift();
    },
    past: function (name, count, every) {
      var ring = poses.get(name) || [];
      var out = [];
      var stride = Math.max(1, Number(every) || 1);
      var want = Math.max(0, Math.min(240, Number(count) || 8));
      for (var i = ring.length - 1; i >= 0 && out.length < want; i--) {
        var r = ring[i];
        if (r.f >= frame) continue;
        if ((frame - r.f) % stride === 0) out.push(r.v);
      }
      return out;
    },
    views: function (names) { meta.views = names.map(String).slice(0, 8); },
    view: function () { return view; },
    overlays: function (names) { meta.overlays = names.map(String).slice(0, 12); },
    overlay: function (name) { return overlaysOn.has(name); },
    tunables: function (spec) { meta.tunables = spec; return live; },
    random: function () { return fxDice(); },
    hold: function () { meta.held = true; },
    ready: function () { meta.held = false; readyWaiters.splice(0).forEach(function (r) { r(); }); },
  };

  /* ------------------------------------------------------------------ one frame */
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function selfAt() {
    try {
      var p = window.__homiePort;
      if (!p) return null;
      var rows = p.rows(vt);
      var r = rows[rows.length - 1];
      return r && Number.isFinite(r[1]) ? [Math.round(r[1] * 100) / 100, Math.round(r[2] * 100) / 100] : null;
    } catch (e) { return null; }
  }
  function runFrame() {
    var target = (frame + 1) * step;
    fireTimers(target);
    vt = target;
    frame += 1;
    cur = { f: frame, t: Math.round(vt * 1000) / 1000, tr: {}, ph: phaseNow, ms: 0, sig: '' };
    // Half a millisecond of slack: a take's times are written to 0.1 ms, and frames are at least 16.7 ms apart.
    while (nextInput < inputs.length && (inputs[nextInput].at || 0) <= vt + 0.5) { try { dispatch(inputs[nextInput]); } catch (e) { error(e); } nextInput += 1; }
    var now = queued.splice(0);
    for (var i = 0; i < now.length; i++) { try { dispatch(now[i]); } catch (e) { error(e); } }
    var q = rafQ;
    rafQ = new Map();
    var t0 = real.now();
    q.forEach(function (cb) { try { cb(vt); } catch (e) { error(e); } });
    cur.ms = Math.round((real.now() - t0) * 1000) / 1000;
    cur.ph = phaseNow;
    var me = selfAt();
    if (me) cur.me = me;
    cur.sig = hash(JSON.stringify([cur.tr, cur.ph, me]));
    frames.push(cur);
    var done = cur;
    cur = null;
    return done;
  }

  var channel = new MessageChannel();
  var waiting = [];
  channel.port1.onmessage = function () { var w = waiting.shift(); if (w) w(); };
  function yieldTask() { return new Promise(function (r) { waiting.push(r); channel.port2.postMessage(0); }); }

  var loaded = new Promise(function (resolve) {
    function go() {
      var fonts = document.fonts && document.fonts.ready ? document.fonts.ready.catch(function () {}) : Promise.resolve();
      fonts.then(function () { return yieldTask(); }).then(function () {
        if (!meta.held) resolve();
        else readyWaiters.push(resolve);
      });
    }
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
  });

  var running = false;
  window.__homieLabPane = {
    v: 1,
    pane: pane,
    ready: loaded,
    get frame() { return frame; },
    get t() { return vt; },
    get fps() { return fps; },
    frames: frames,
    recorded: recorded,
    /** What the game said about itself: units of its tracks, its views, overlays and tunables, errors. */
    meta: function () { return { units: meta.units, views: meta.views, overlays: meta.overlays, tunables: meta.tunables, instrumented: meta.used.track + meta.used.phase + meta.used.pose > 0, used: meta.used, errors: meta.errors.slice() }; },
    /** Run `n` frames, a task apart (promises settle between frames, as in a browser). */
    run: function (n) {
      if (running) return Promise.resolve(frame);
      running = true;
      var left = Math.max(0, Math.min(Number(n) || 0, limit - frame));
      return loaded.then(function loop() {
        if (left <= 0) { running = false; return frame; }
        left -= 1;
        runFrame();
        return left > 0 ? yieldTask().then(loop) : (running = false, frame);
      });
    },
    /** A press for the next frame (the person's, forwarded by the lab page to both panes). */
    input: function (ev) { queue(ev); },
    set: function (o) {
      if (!o) return;
      if ('view' in o) view = o.view;
      if (o.overlays) Object.keys(o.overlays).forEach(function (k) { if (o.overlays[k]) overlaysOn.add(k); else overlaysOn.delete(k); });
      if (o.tunables) Object.keys(o.tunables).forEach(function (k) { live[k] = o.tunables[k]; });
      if (o.mode === 'record' || o.mode === 'replay') mode = o.mode;
      if (Number(o.scale) > 0) state.scale = Number(o.scale);
      if (typeof o.paused === 'boolean') state.paused = o.paused;
    },
    get mode() { return mode; },
    /** The first canvas's picture now (a still for the lab's sheet). */
    still: function (type, quality) {
      var c = document.querySelector('canvas');
      try { return c ? c.toDataURL(type || 'image/jpeg', quality || 0.82) : null; } catch (e) { return null; }
    },
  };

  // On its own (no lab around it): real time, one lab frame per screen frame, on the same seeded clock.
  if (free) {
    loaded.then(function () {
      var tick = function () { runFrame(); if (frames.length > 1200) frames.splice(0, frames.length - 1200); real.raf(tick); };
      real.raf(tick);
    });
  }
})();
