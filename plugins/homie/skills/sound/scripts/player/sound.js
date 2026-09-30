/*
 * sound.js: a game's sound effects and music, from the files the Homie plugin's sound skill made
 * (sound.json beside them lists what exists). Plain JavaScript, no dependencies.
 *
 *   import { createSound } from './sound.js';            // bundle games: from src/; static games: from sound/
 *   const sound = createSound({ base: 'sound/' });        // where sound.json and the files are served, relative to the page
 *   sound.play('jump');                                   // a random variant, a little pitch jitter, never more than 4 at once
 *   sound.play('coin', { pitch: combo, volume: 0.8, pan: -0.3 });
 *   sound.music('theme');                                 // the theme's first loop, from the first touch on
 *   sound.section('chase');                               // the next loop, starting exactly on the next bar line
 *   sound.duck(0.4, 0.5);                                 // music down to 40% for half a second (a big hit, a line of speech)
 *   sound.volume({ sfx: 1, music: 0.6 }); sound.mute(true);
 *
 * Sound starts on the first touch, click or key, with no "tap for sound" screen: browsers keep audio
 * suspended until a person has touched the page, so the first gesture resumes it (a held stick counts
 * when the finger lifts). A sound asked for before that is dropped, not queued: a late hit is worse than none.
 * window.__homieSound holds counters for a playtest (what played, when); it never controls anything.
 */
export function createSound({ base = 'sound/', manifest = 'sound.json', maxPerName = 4, maxVoices = 24 } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = AC ? new AC({ latencyHint: 'interactive' }) : null;
  const url = (f) => new URL(f, new URL(base, document.baseURI)).toString();
  const buses = {};
  const buffers = new Map();
  const live = new Map();
  const stats = { unlocked: false, unlockedAt: null, plays: [], missing: [], errors: [], music: null };
  let meta = { sfx: {}, music: {} };
  let muted = false;
  const levels = { master: 1, sfx: 1, music: 0.7 };
  let track = null;

  if (ctx) {
    buses.master = ctx.createGain();
    // A gentle safety limiter: many hits at once must not clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6; comp.knee.value = 6; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.15;
    buses.master.connect(comp).connect(ctx.destination);
    buses.sfx = ctx.createGain(); buses.sfx.connect(buses.master);
    buses.music = ctx.createGain(); buses.music.connect(buses.master);
    buses.duck = ctx.createGain(); buses.duck.connect(buses.music);
    applyLevels();
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not iOS */ }
    const unlock = () => {
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      try { const b = ctx.createBuffer(1, 1, 22050); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) { /* closed */ }
      if (!stats.unlocked && ctx.state === 'running') { stats.unlocked = true; stats.unlockedAt = performance.now(); }
      if (track && !track.started && ctx.state === 'running') startTrack();
    };
    for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'click']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    ctx.addEventListener('statechange', () => { if (ctx.state === 'running') { stats.unlocked = true; stats.unlockedAt = stats.unlockedAt || performance.now(); if (track && !track.started) startTrack(); } });
  }

  const ready = fetch(url(manifest)).then((r) => { if (!r.ok) throw new Error(`${manifest}: HTTP ${r.status}`); return r.json(); }).then((m) => {
    meta = { sfx: m.sfx || {}, music: m.music || {} };
    const variants = Object.values(meta.sfx).flat();
    const loops = Object.values(meta.music).flatMap((t) => Object.values(t.loops || {}));
    return Promise.all([...variants, ...loops].map(loadFirst));
  }).catch((e) => { stats.errors.push(String(e && e.message || e)); });

  function load(file) {
    if (!ctx || buffers.has(file)) return buffers.get(file);
    const p = fetch(url(file)).then((r) => { if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((b) => new Promise((ok, no) => ctx.decodeAudioData(b, ok, no)))
      .then((buf) => { buffers.set(file, buf); return buf; })
      .catch((e) => { stats.errors.push(String(e && e.message || e)); buffers.delete(file); return null; });
    buffers.set(file, p);
    return p;
  }

  /** A file listed as [ogg, wav]: the first this browser decodes wins (older Safari cannot decode Ogg). */
  function loadFirst(list) {
    const files = Array.isArray(list) ? list : [list];
    const key = files.join('|');
    if (buffers.has(key)) return buffers.get(key);
    const p = files.reduce((prev, f) => prev.then((buf) => buf || load(f).then((b) => (b instanceof AudioBuffer ? b : null))), Promise.resolve(null))
      .then((buf) => { if (buf) buffers.set(key, buf); else buffers.delete(key); return buf; });
    buffers.set(key, p);
    return p;
  }
  const loopBuffer = (list) => buffers.get(Array.isArray(list) ? list.join('|') : list);

  function applyLevels() {
    if (!ctx) return;
    const t = ctx.currentTime;
    buses.master.gain.setTargetAtTime(muted ? 0 : levels.master, t, 0.02);
    buses.sfx.gain.setTargetAtTime(levels.sfx, t, 0.02);
    buses.music.gain.setTargetAtTime(levels.music, t, 0.05);
  }

  function play(name, { volume = 1, pitch = 0, pan = 0, jitter = 0.35 } = {}) {
    stats.plays.push({ name, t: Math.round(performance.now()) });
    if (stats.plays.length > 500) stats.plays.splice(0, 250);
    if (!ctx || ctx.state !== 'running') return null;
    const variants = meta.sfx[name];
    if (!variants || !variants.length) { if (!stats.missing.includes(name)) stats.missing.push(name); return null; }
    const buf = loopBuffer(variants[Math.floor(Math.random() * variants.length)]);
    if (!(buf instanceof AudioBuffer)) return null;
    const mine = live.get(name) || [];
    while (mine.length >= maxPerName) { try { mine.shift().stop(); } catch (e) { /* ended */ } }
    let total = 0; for (const v of live.values()) total += v.length;
    if (total >= maxVoices) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 2 ** ((pitch + (Math.random() * 2 - 1) * jitter) / 12);
    const g = ctx.createGain(); g.gain.value = volume;
    let node = src.connect(g);
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); node = node.connect(p); }
    node.connect(buses.sfx);
    src.onended = () => { const i = mine.indexOf(src); if (i >= 0) mine.splice(i, 1); };
    mine.push(src); live.set(name, mine);
    src.start();
    return src;
  }

  function startTrack() {
    if (!track || !ctx || ctx.state !== 'running') return;
    const buf = loopBuffer(track.loops[track.section]);
    if (!(buf instanceof AudioBuffer)) { ready.then(() => { if (track && !track.started) startTrack(); }); return; }
    track.started = true;
    track.t0 = ctx.currentTime + 0.05;
    track.node = loopNode(buf, track.t0, track.fade);
    stats.music = { name: track.name, section: track.section, since: Math.round(performance.now()) };
  }

  function loopNode(buf, at, fade) {
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(1, at + Math.max(0.005, fade));
    src.connect(g).connect(buses.duck);
    src.start(at);
    return { src, g };
  }

  let loaded = false;
  ready.then(() => { loaded = true; });
  function music(name, opts = {}) {
    // Called before sound.json has arrived (the usual case: at the top of the game): start it once it has.
    if (!loaded) { ready.then(() => music(name, opts)); return; }
    const { section = null, fade = 0.4 } = opts;
    const t = meta.music[name];
    if (!t) { stats.errors.push(`no music "${name}" in ${manifest}`); return; }
    stopMusic({ fade: 0.2 });
    const first = section || Object.keys(t.loops || {})[0];
    track = { name, loops: t.loops, bar: t.barSeconds, section: first, started: false, fade };
    startTrack();
  }

  /** Switch loops on the next bar line (every loop shares the tempo, so bar lines line up). */
  function section(name, { fade = 0.03 } = {}) {
    if (!track || !track.loops[name] || name === track.section) return;
    track.section = name;
    if (!track.started) return;
    const buf = loopBuffer(track.loops[name]);
    if (!(buf instanceof AudioBuffer)) return;
    const now = ctx.currentTime;
    const at = track.t0 + Math.ceil((now + 0.02 - track.t0) / track.bar) * track.bar;
    const old = track.node;
    old.g.gain.setValueAtTime(1, at - fade); old.g.gain.linearRampToValueAtTime(0, at);
    try { old.src.stop(at + 0.05); } catch (e) { /* */ }
    track.node = loopNode(buf, at - fade, fade);
    track.t0 = at;
    stats.music = { name: track.name, section: name, since: Math.round(performance.now()) };
  }

  function stopMusic({ fade = 0.5 } = {}) {
    if (!track) return;
    if (track.node && ctx) { const t = ctx.currentTime; track.node.g.gain.setTargetAtTime(0, t, fade / 3); try { track.node.src.stop(t + fade + 0.1); } catch (e) { /* */ } }
    track = null; stats.music = null;
  }

  function duck(to = 0.4, seconds = 0.4) {
    if (!ctx) return;
    const t = ctx.currentTime; const g = buses.duck.gain;
    g.cancelScheduledValues(t); g.setTargetAtTime(to, t, 0.015); g.setTargetAtTime(1, t + seconds, 0.12);
  }

  const api = {
    ready, play, music, section, stopMusic, duck,
    volume(v) { Object.assign(levels, v || {}); applyLevels(); },
    mute(on = true) { muted = !!on; applyLevels(); },
    get context() { return ctx; },
    state: () => ({ unlocked: stats.unlocked, running: ctx ? ctx.state === 'running' : false, loaded: new Set([...buffers.values()].filter((b) => b instanceof AudioBuffer)).size, music: stats.music, missing: stats.missing.slice(), errors: stats.errors.slice(0, 10) }),
  };
  try { window.__homieSound = { get stats() { return { ...api.state(), plays: stats.plays.slice(-100), unlockedAt: stats.unlockedAt }; } }; } catch (e) { /* frozen global */ }
  return api;
}
