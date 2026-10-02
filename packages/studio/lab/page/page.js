/*
 * The Game Lab page (@homie-rocks/studio lab/page): New and Today side by side, on one clock.
 *
 * Each pane is the game's own page in a frame, with the lab's harness first (lab/harness.js). The page owns the clock:
 * it steps both panes the same number of frames at the same time, so frame f is frame f in both. Going back means
 * loading the panes again and running them to that frame as fast as they go: a take is deterministic (seeded dice,
 * the same presses at the same frames), so the frame it lands on is the frame it was. That is also checked: every
 * replay's frames are compared with the last run's, and a difference is shown.
 *
 * window.labApp is what `homie-studio lab check` drives headless (the same code the person sees).
 */
import { DEVICES, FPS, SCALES, expandTake, framesOf, inputsFromRecording } from '/_lab/take.js';

const $ = (id) => document.getElementById(id);
const GAME = location.pathname.split('/').filter(Boolean)[0];
const Q = new URLSearchParams(location.search);
const CHECK = Q.has('check');
// Phases get these, in the order they first appear (never the motion colours below, so the two never read alike).
const PALETTE = ['#a374ff', '#17c3b2', '#f5a524', '#ff6fb5', '#8bd346', '#4dd2ff', '#ffd84a', '#e58cff', '#5ee6c7', '#ff9e57'];
const MOTION = { HOLD: '#3b7bff', MOVE: '#59627c', FAST: '#ff5a6a' };
const SPEED_LABEL = { 1: '1×', 0.5: '½', 0.25: '¼', 0.1: '⅒' };
const BODY = 'body speed';
const COST = 'js ms/frame';

const S = {
  state: null,
  takeName: null,
  takeRaw: null,
  take: null,
  fps: 60,
  frames: 1,
  frame: 0,
  scale: 1,
  playing: false,
  loop: true,
  device: 'desk',
  layout: 'both',
  view: null,
  overlays: new Set(),
  track: null,
  overrides: {},
  mode: 'replay',
  busy: false,
  token: 0,
  nonce: 0,
  acc: 0,
  last: 0,
  dirty: true,
  mismatch: null,
  colours: new Map(),
  units: new Map(),
  told: { new: false, today: false },
  recordStartedAt: 0,
  primed: false,
};

const pane = (name) => ({ name, el: $(`pane-${name}`), slot: document.querySelector(`.slot[data-pane="${name}"]`), api: null, read: 0, rec: [], epoch: 0, meta: null, available: true, why: null });
const P = { new: pane('new'), today: pane('today') };
const live = () => [P.new, P.today].filter((p) => p.available && p.api);

/* ------------------------------------------------------------------ what the harness asks for */
window.__homieLabPanes = {
  config(name) {
    const t = S.take;
    return {
      fps: S.fps, seed: t?.seed ?? 1, stage: t?.stage ?? null, inputs: S.mode === 'record' ? [] : t?.inputs ?? [], storage: t?.storage ?? null, view: S.view,
      overlays: [...S.overlays], tunables: name === 'new' ? { ...S.overrides } : {}, frames: S.frames, dpr: DEVICES[S.device].dpr, mode: S.mode, scale: S.scale,
    };
  },
  // A press while recording: both panes get it at the same frame.
  input(_from, ev) { for (const p of live()) p.api.input(ev); },
};

/* ------------------------------------------------------------------ state from the server */
async function loadState() {
  const r = await fetch(`/_lab/api/${GAME}/state${Q.get('today') ? `?today=${encodeURIComponent(Q.get('today'))}` : ''}`, { cache: 'no-store' });
  S.state = await r.json();
  if (!S.state.ok) throw new Error(S.state.why ?? 'the lab could not start');
  P.today.available = S.state.today.ok;
  P.today.why = S.state.today.ok ? null : S.state.today.error ? `Today did not build: ${S.state.today.error}` : S.state.today.none;
  P.new.available = S.state.new.ok;
  P.new.why = S.state.new.ok ? null : `New did not build: ${S.state.new.error}`;
  $('game-name').textContent = S.state.game.name;
  document.title = `${S.state.game.name} · Game Lab`;
  return S.state;
}

function pickTake(name) {
  const takes = S.state.takes.takes;
  const names = Object.keys(takes);
  S.takeName = names.includes(name) ? name : S.state.takes.default ?? names[0] ?? null;
  S.takeRaw = S.takeName ? takes[S.takeName] : { seconds: 4, inputs: [], note: 'No take yet: press REC and play' };
  S.fps = FPS.includes(Number(Q.get('fps'))) ? Number(Q.get('fps')) : FPS.includes(Number(S.takeRaw.fps)) ? Number(S.takeRaw.fps) : S.fps;
  S.take = expandTake(S.takeRaw, { fps: S.fps });
  S.frames = S.take.frames;
  if (!S.deviceSet) S.device = Q.get('device') in DEVICES ? Q.get('device') : S.take.device;
  S.view = S.take.view ?? S.view;
  S.overlays = new Set(S.take.overlays);
  S.track = S.take.track ?? S.track;
  $('take-name').textContent = S.takeName ? `${S.takeName}${S.takeRaw.note ? ` · ${S.takeRaw.note}` : ''}` : 'no take yet';
}

/* ------------------------------------------------------------------ panes: load, run, collect */
function invalidate(list = [P.new, P.today]) { for (const p of list) { p.rec = []; p.epoch += 1; } S.mismatch = null; S.dirty = true; }

async function load(p, token) {
  const d = DEVICES[S.device];
  p.api = null;
  p.read = 0;
  p.meta = null;
  if (!p.available) { p.el.removeAttribute('src'); return; }
  p.el.width = d.w; p.el.height = d.h;
  p.el.style.width = `${d.w}px`; p.el.style.height = `${d.h}px`;
  await new Promise((done) => { p.el.onload = done; p.el.src = `/${GAME}/${p.name}/?b=${++S.nonce}`; });
  if (token !== S.token) return;
  const api = p.el.contentWindow?.__homieLabPane;
  if (!api) { p.why = `The ${p.name} page has no lab harness (it did not load).`; p.available = false; return; }
  await api.ready;
  p.api = api;
  remember(p);
}

function collect(p) {
  const fr = p.api.frames;
  for (; p.read < fr.length; p.read += 1) {
    const r = fr[p.read];
    const old = p.rec[r.f - 1];
    if (old && old.epoch === p.epoch && old.sig !== r.sig && !S.mismatch && S.mode !== 'record') S.mismatch = { pane: p.name, f: r.f };
    p.rec[r.f - 1] = { f: r.f, tr: { ...r.tr }, ph: r.ph ? [r.ph[0], r.ph[1]] : null, ms: r.ms, sig: r.sig, me: r.me ? [r.me[0], r.me[1]] : null, epoch: p.epoch };
  }
  remember(p);
}
/** What a pane's game has said so far, kept across reloads (a fresh pane has said nothing yet). */
function remember(p) {
  p.meta = p.api.meta();
  for (const [k, u] of Object.entries(p.meta.units ?? {})) if (!S.units.has(k) || (!S.units.get(k) && u)) S.units.set(k, u);
  if (p.meta.instrumented || p.meta.views?.length || p.meta.overlays?.length || p.meta.tunables) S.told[p.name] = true;
}

async function advance(n, list = live()) {
  if (n <= 0 || !list.length) return;
  await Promise.all(list.map((p) => p.api.run(n)));
  for (const p of list) collect(p);
  S.frame = Math.max(...list.map((p) => p.api.frame));
  S.dirty = true;
}

/** Load the panes again and run them to `target` (as fast as they go). Returns false when a newer boot took over. */
async function boot(target = 0, names = ['new', 'today']) {
  const token = ++S.token;
  S.busy = true;
  showVeils(true);
  const list = names.map((n) => P[n]);
  try {
    await Promise.all(list.map((p) => load(p, token)));
    if (token !== S.token) return false;
    const runnable = list.filter((p) => p.api);
    for (const p of runnable) p.api.set({ scale: S.scale, paused: !S.playing });
    // Run in slices, so the counter moves and the page stays responsive while a long seek runs. Frame 1 is the first
    // the game draws (before it, the canvas is empty), so a pane always stands on frame 1 or later.
    const goal = Math.max(1, Math.min(target, S.frames));
    while (runnable.length && Math.min(...runnable.map((p) => p.api.frame)) < goal) {
      const at = Math.min(...runnable.map((p) => p.api.frame));
      await Promise.all(runnable.map((p) => p.api.run(Math.min(30, goal - p.api.frame))));
      for (const p of runnable) collect(p);
      if (token !== S.token) return false;
      if (goal - at > 60) { $('counter').textContent = `SEEK ${Math.min(...runnable.map((p) => p.api.frame))} / ${goal}`; await nextPaint(); }
    }
    // A pane booted alone (a slider moved) catches up with the other.
    S.frame = Math.max(0, ...live().map((p) => p.api.frame));
    S.dirty = true;
    return true;
  } finally {
    if (token === S.token) { S.busy = false; showVeils(false); paint(); }
  }
}
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => r()));

/** Run the whole take once (fast), so the timeline and graphs are whole, then go back to the start. */
async function prime({ play = !CHECK } = {}) {
  S.primed = false;
  S.playing = false;
  invalidate();
  setStatus();
  if (!(await boot(S.frames))) return;
  S.primed = true;
  setStatus();
  if (!(await boot(0))) return;
  if (play) setPlaying(true);
}

/* ------------------------------------------------------------------ the clock */
function setPlaying(on) {
  if (on && S.frame >= S.frames) { S.acc = 0; S.playing = true; void restart(); updateButtons(); return; }
  S.playing = on;
  S.acc = 0;
  for (const p of live()) p.api.set({ paused: !on });
  updateButtons();
}
async function restart() { await boot(0); }

async function seek(f) {
  const target = Math.max(1, Math.min(S.frames, Math.round(f)));
  if (target === S.frame && !S.busy) return;
  if (target > S.frame && live().length && !S.busy) { await advance(target - S.frame); paint(); return; }
  S.seekTo = target;
  if (S.seeking) return;
  S.seeking = true;
  try {
    while (S.seekTo !== undefined) {
      const t = S.seekTo;
      S.seekTo = undefined;
      await boot(t);
    }
  } finally { S.seeking = false; }
}

function tick(now) {
  const real = S.last ? now - S.last : 0;
  S.last = now;
  if (S.playing && !S.busy && S.primed && live().length) {
    S.acc += Math.min(250, real) * S.scale;
    const step = 1000 / S.fps;
    let n = Math.floor(S.acc / step);
    if (n > 0) {
      S.acc -= n * step;
      n = Math.min(n, 4, S.frames - S.frame);
      if (n > 0) { S.busy = true; void advance(n).finally(() => { S.busy = false; if (S.mode === 'record') recTick(); }); }
      else if (S.frame >= S.frames) {
        if (S.mode === 'record') void stopRecording();
        else if (S.loop) void restart();
        else setPlaying(false);
      }
    }
  }
  if (S.dirty) paint();
  requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------ what was recorded, as pictures */
function colourOf(name) {
  if (!S.colours.has(name)) S.colours.set(name, PALETTE[S.colours.size % PALETTE.length]);
  return S.colours.get(name);
}
function phasesOf(p) {
  const out = [];
  for (let i = 0; i < S.frames; i += 1) {
    const r = p.rec[i];
    const name = r?.ph?.[0] ?? null;
    const prev = out[out.length - 1];
    if (prev && prev.name === name && prev.to === i) { prev.to = i + 1; if (r?.ph?.[1]) prev.note = r.ph[1]; continue; }
    if (r === undefined) continue;
    if (name) out.push({ name, note: r.ph[1] ?? '', from: i, to: i + 1 });
    else if (prev && prev.to === i) out.push({ name: null, from: i, to: i + 1 });
  }
  return out.filter((s) => s.name);
}

/** Every graphable value: what the game tracks, its body's speed (the port probe's), and its JavaScript per frame. */
function trackNames() {
  const names = [...S.units.keys()];
  if ([P.new, P.today].some((p) => p.rec.some((r) => r?.me))) names.push(BODY);
  names.push(COST);
  return names;
}
function unitOf(name) {
  if (name === BODY) return 'u/s';
  if (name === COST) return 'ms';
  return S.units.get(name) || '';
}
function seriesOf(p, name) {
  const out = new Array(S.frames).fill(null);
  for (let i = 0; i < S.frames; i += 1) {
    const r = p.rec[i];
    if (!r) continue;
    if (name === COST) out[i] = r.ms;
    else if (name === BODY) {
      const prev = p.rec[i - 1];
      out[i] = r.me && prev?.me ? Math.hypot(r.me[0] - prev.me[0], r.me[1] - prev.me[1]) * S.fps : r.me ? 0 : null;
    } else out[i] = Object.hasOwn(r.tr, name) ? r.tr[name] : null;
  }
  return out;
}
function motionOf(series) {
  let max = 0;
  for (const v of series) if (v !== null && Math.abs(v) > max) max = Math.abs(v);
  return series.map((v) => (v === null || max === 0 ? null : Math.abs(v) <= max * 0.08 ? 'HOLD' : Math.abs(v) >= max * 0.6 ? 'FAST' : 'MOVE'));
}

/* ------------------------------------------------------------------ drawing: timeline and graph */
function canvasOf(id) {
  const c = $(id);
  const dpr = Math.min(3, devicePixelRatio || 1);
  const w = Math.max(10, Math.round(c.clientWidth));
  const h = Math.max(10, Math.round(c.clientHeight));
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
const PAD_L = 8;
const PAD_R = 34;
const xOf = (f, w) => PAD_L + (f / S.frames) * (w - PAD_L - PAD_R);
const frameAt = (x, w) => Math.round(((x - PAD_L) / (w - PAD_L - PAD_R)) * S.frames);

function drawTimeline() {
  const { ctx, w } = canvasOf('timeline');
  const mono = '700 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
  const rows = [
    { p: P.new, y: 0, h: 19, label: true },
    { p: P.today, y: 27, h: 13, label: true },
  ];
  const track = S.track ?? trackNames()[0];
  for (const row of rows) {
    ctx.fillStyle = '#0a0e18';
    ctx.fillRect(PAD_L, row.y, w - PAD_L - PAD_R, row.h);
    if (!row.p.available) continue;
    for (const s of phasesOf(row.p)) {
      const x0 = xOf(s.from, w); const x1 = xOf(s.to, w);
      const c = colourOf(s.name);
      ctx.fillStyle = c;
      ctx.globalAlpha = row.p === P.new ? 0.9 : 0.6;
      ctx.fillRect(x0, row.y, Math.max(1, x1 - x0 - 1), row.h);
      ctx.globalAlpha = 1;
      const here = S.frame - 1 >= s.from && S.frame - 1 < s.to;
      if (here) { ctx.strokeStyle = '#ffad3b'; ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, row.y + 1, Math.max(1, x1 - x0 - 3), row.h - 2); }
      ctx.font = mono;
      const text = s.name;
      if (row.label && ctx.measureText(text).width + 8 < x1 - x0) { ctx.fillStyle = '#0a0d14'; ctx.textBaseline = 'middle'; ctx.fillText(text, x0 + 4, row.y + row.h / 2 + 0.5); }
    }
    // Motion beneath each row: HOLD, MOVE, FAST, from the chosen graph's values.
    const m = motionOf(seriesOf(row.p, track));
    const y = row.y + row.h + 1;
    for (let i = 0; i < m.length; i += 1) {
      if (!m[i]) continue;
      ctx.fillStyle = MOTION[m[i]];
      ctx.fillRect(xOf(i, w), y, Math.max(1, xOf(i + 1, w) - xOf(i, w)), 4);
    }
  }
  // The ruler: a tick every 10 frames, seconds named.
  const ry = 48;
  ctx.fillStyle = '#59627c';
  ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'top';
  const every = S.frames > 600 ? 60 : S.frames > 240 ? 20 : 10;
  for (let f = 0; f <= S.frames; f += every) {
    const x = xOf(f, w);
    const sec = f % S.fps === 0;
    ctx.fillRect(Math.round(x), ry - (sec ? 3 : 1), 1, sec ? 5 : 3);
    const label = sec ? `${f / S.fps}s` : String(f);
    if (x + ctx.measureText(label).width < w - PAD_R + 20) { ctx.fillStyle = sec ? '#8d96b0' : '#59627c'; ctx.fillText(label, x + 2, ry + 1); ctx.fillStyle = '#59627c'; }
  }
  playhead(ctx, w, 0, 58);
}

function drawGraph() {
  const { ctx, w, h } = canvasOf('graph');
  const name = S.track ?? trackNames()[0];
  const a = seriesOf(P.new, name);
  const b = P.today.available ? seriesOf(P.today, name) : [];
  let max = 0; let min = 0;
  for (const v of [...a, ...b]) if (v !== null) { if (v > max) max = v; if (v < min) min = v; }
  if (max === min) max = min + 1;
  const nice = niceMax(max);
  const top = 16; const bottom = h - 6;
  const yOf = (v) => bottom - ((v - min) / (nice - min)) * (bottom - top);
  ctx.fillStyle = '#0a0e18';
  ctx.fillRect(PAD_L, top, w - PAD_L - PAD_R, bottom - top);
  // Grid, and the axis on the right.
  ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';
  for (const v of [0, nice / 2, nice]) {
    const y = Math.round(yOf(v)) + 0.5;
    ctx.strokeStyle = '#1a2236'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(w - PAD_R, y); ctx.stroke();
    ctx.fillStyle = '#59627c'; ctx.fillText(fmt(v), w - PAD_R + 5, y);
  }
  // New's phase edges, faint.
  ctx.strokeStyle = 'rgba(141,150,176,.16)';
  for (const s of phasesOf(P.new)) { const x = Math.round(xOf(s.from, w)) + 0.5; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); }
  const path = (series) => {
    ctx.beginPath();
    let on = false;
    for (let i = 0; i < series.length; i += 1) {
      const v = series[i];
      if (v === null) { on = false; continue; }
      const x = xOf(i + 0.5, w); const y = yOf(v);
      if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y);
    }
  };
  // New: a filled line in amber.
  ctx.save();
  path(a);
  ctx.strokeStyle = '#ffad3b'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  let started = false; let lastX = 0; let firstX = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === null) continue;
    const x = xOf(i + 0.5, w); const y = yOf(a[i]);
    if (!started) { ctx.moveTo(x, yOf(Math.max(min, 0))); ctx.lineTo(x, y); started = true; firstX = x; } else ctx.lineTo(x, y);
    lastX = x;
  }
  if (started) { ctx.lineTo(lastX, yOf(Math.max(min, 0))); ctx.lineTo(firstX, yOf(Math.max(min, 0))); ctx.fillStyle = 'rgba(255,173,59,.16)'; ctx.fill(); }
  ctx.restore();
  // Today: dashed, cool.
  if (b.length) { ctx.save(); path(b); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(124,196,255,.9)'; ctx.lineWidth = 1.3; ctx.stroke(); ctx.restore(); }
  // Its name, and the two lines' names.
  ctx.textBaseline = 'top';
  ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#8d96b0';
  ctx.fillText(`${name}${unitOf(name) ? ` ${unitOf(name)}` : ''}`, PAD_L + 6, 2);
  const legend = [['new', '#ffad3b', false], ...(b.length ? [['today', '#7cc4ff', true]] : [])];
  let lx = w - PAD_R - 6;
  ctx.textAlign = 'right';
  for (const [label, colour, dashed] of legend.reverse()) {
    ctx.fillStyle = colour; ctx.fillText(label, lx, 2);
    const tw = ctx.measureText(label).width;
    ctx.strokeStyle = colour; ctx.lineWidth = 1.5; ctx.setLineDash(dashed ? [3, 2] : []);
    ctx.beginPath(); ctx.moveTo(lx - tw - 22, 7); ctx.lineTo(lx - tw - 6, 7); ctx.stroke(); ctx.setLineDash([]);
    lx -= tw + 34;
  }
  ctx.textAlign = 'left';
  playhead(ctx, w, top, bottom);
}

function playhead(ctx, w, y0, y1) {
  if (!S.frames) return;
  const x = Math.round(xOf(Math.max(0, S.frame - 0.5), w)) + 0.5;
  ctx.strokeStyle = '#ffad3b'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
}
function niceMax(v) { const p = 10 ** Math.floor(Math.log10(Math.max(1e-9, v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }
function fmt(v) { const a = Math.abs(v); return a >= 1000 ? `${Math.round(v / 100) / 10}k` : a >= 100 ? String(Math.round(v)) : a >= 10 ? (Math.round(v * 10) / 10).toString() : (Math.round(v * 100) / 100).toString(); }

/* ------------------------------------------------------------------ the stage */
const BAND_TOP = 26;
const BAND_BOTTOM = 34;
function layoutStage() {
  const stage = $('stage');
  const W = stage.clientWidth; const H = stage.clientHeight;
  const d = DEVICES[S.device];
  const both = S.layout === 'both';
  const pad = W < 640 ? 8 : 14; const gap = W < 640 ? 8 : 16;
  // Each pane has a band above it (its name) and below it (the phase it is in), outside the game's own picture.
  const BAND = BAND_TOP + BAND_BOTTOM;
  const one = Math.min((W - pad * 2) / d.w, (H - pad * 2 - BAND) / d.h);
  const row = Math.min((W - pad * 2 - gap) / 2 / d.w, (H - pad * 2 - BAND) / d.h);
  const col = Math.min((W - pad * 2) / d.w, (H - pad * 2 - gap - BAND * 2) / 2 / d.h);
  const place = (p, x, y, s, show) => {
    p.slot.hidden = !show;
    p.slot.style.left = `${Math.round(x)}px`; p.slot.style.top = `${Math.round(y)}px`;
    p.slot.style.width = `${Math.round(d.w * s)}px`; p.slot.style.height = `${Math.round(d.h * s) + BAND}px`;
    p.el.style.transform = `scale(${s})`;
  };
  P.new.slot.classList.remove('ghost'); P.today.slot.classList.remove('ghost');
  if (both) {
    if (row >= col) {
      const s = row; const tw = d.w * s * 2 + gap;
      const x = (W - tw) / 2; const y = (H - d.h * s - BAND) / 2;
      place(P.new, x, y, s, true); place(P.today, x + d.w * s + gap, y, s, true);
    } else {
      const s = col; const th = (d.h * s + BAND) * 2 + gap;
      const x = (W - d.w * s) / 2; const y = (H - th) / 2;
      place(P.new, x, y, s, true); place(P.today, x, y + d.h * s + BAND + gap, s, true);
    }
  } else {
    const s = one;
    const x = (W - d.w * s) / 2; const y = (H - d.h * s - BAND) / 2;
    place(P.new, x, y, s, S.layout !== 'today');
    place(P.today, x, y, s, S.layout !== 'new');
    if (S.layout === 'ghost') P.today.slot.classList.add('ghost');
  }
}

function showVeils(busy) {
  for (const p of [P.new, P.today]) {
    const v = $(`veil-${p.name}`);
    if (!p.available) { v.hidden = false; v.innerHTML = ''; const b = document.createElement('b'); b.textContent = p.name === 'new' ? 'NEW' : 'TODAY'; v.append(b, document.createTextNode(p.why ?? 'Not available.')); continue; }
    v.hidden = true;
  }
  $('stage').classList.toggle('busy', busy);
}

/* ------------------------------------------------------------------ painting the page */
function paint() {
  S.dirty = false;
  const sec = S.frame / S.fps;
  if (!S.busy || S.frame > 0) $('counter').textContent = `F ${S.frame} / ${S.frames} · ${sec.toFixed(2)} s`;
  for (const p of [P.new, P.today]) {
    const cap = $(`cap-${p.name}`);
    cap.innerHTML = '';
    const r = p.rec[S.frame - 1];
    if (r?.ph && p.available) {
      const b = document.createElement('b'); b.textContent = r.ph[0]; b.style.color = colourOf(r.ph[0]); b.style.borderColor = colourOf(r.ph[0]);
      cap.append(b);
      if (r.ph[1]) { const s = document.createElement('span'); s.textContent = r.ph[1]; cap.append(s); }
    }
  }
  drawTimeline();
  drawGraph();
}

function setStatus() {
  const box = $('status');
  box.innerHTML = '';
  const chip = (text, cls = '', title = '') => { const c = document.createElement('span'); c.className = `chip ${cls}`; const d = document.createElement('span'); d.className = 'dot'; c.append(d, document.createTextNode(text)); if (title) c.title = title; box.append(c); return c; };
  const st = S.state;
  if (!st) return;
  if (!S.primed) chip('Reading the take', 'busy warn');
  if (!st.new.ok) chip('New did not build', 'bad', st.new.error ?? '');
  if (st.today.ok && st.new.dirty === 0 && st.today.ref === 'HEAD') chip('New = Today', 'warn', 'games/ has no change since the last commit: change something and New shows it');
  else if (st.new.dirty) chip(`${st.new.dirty} file${st.new.dirty === 1 ? '' : 's'} changed`, '', 'games/ differs from the last commit');
  for (const p of [P.new, P.today]) { const e = p.meta?.errors ?? []; if (e.length) chip(`${e.length} error${e.length === 1 ? '' : 's'} in ${p.name}`, 'bad', e.join('\n')); }
  if (S.mismatch) chip(`Replays differ at F${S.mismatch.f} (${S.mismatch.pane})`, 'bad', 'The same build played the same take differently: something in the game reads a clock, dice or input the lab does not drive (crypto, a fetch, an audio clock). The lab skill says how to find it.');
  else if (S.primed && P.new.rec.length && S.replayed) chip('Replays match', 'ok', 'Every replay of this take landed on the same frames as the first run');
  $('new-sub').textContent = st.new.ok ? `working tree${st.new.dirty ? ` · ${st.new.dirty} changed` : ''}` : 'did not build';
  $('today-sub').textContent = st.today.ok ? `${st.today.commit.short} ${st.today.commit.subject}` : st.today.ref;
  const instrumented = S.told.new || S.told.today;
  const hint = $('hint');
  if (P.new.meta && !instrumented) hint.innerHTML = 'This game tells the lab nothing yet: the graph is its body\'s speed from the port probe. The lab skill adds <code>lab.phase</code>, <code>lab.track</code> and <code>lab.tunables</code>.';
  else if (!S.takeName) hint.innerHTML = 'No take yet: press <code>● REC</code> and play the move in NEW (both builds get the same presses), or write one in <code>lab.json</code>.';
  else hint.textContent = `${S.takeRaw.note ?? ''}${S.takeRaw.note ? ' · ' : ''}${S.take.stage ? `stage ${S.take.stage} · ` : ''}seed ${S.take.seed} · ${(S.takeRaw.inputs ?? []).length} press${(S.takeRaw.inputs ?? []).length === 1 ? '' : 'es'} · ${DEVICES[S.device].label} ${DEVICES[S.device].w}×${DEVICES[S.device].h}`;
}

/* ------------------------------------------------------------------ controls */
function buttons(boxId, items, current, onPick, label) {
  const box = $(boxId);
  box.innerHTML = '';
  if (!items.length) return;
  if (label) { const l = document.createElement('span'); l.className = 'label'; l.textContent = label; box.append(l); }
  for (const [value, text, title] of items) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; if (title) b.title = title;
    const on = typeof current === 'function' ? current(value) : current === value;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.onclick = () => onPick(value);
    box.append(b);
  }
}

function updateButtons() {
  buttons('layout', [['new', 'New'], ['today', 'Today'], ['both', 'Both'], ['ghost', 'Ghost', 'Today over New, half strength']], S.layout, (v) => { S.layout = v; layoutStage(); updateButtons(); });
  const views = [...new Set([...(P.new.meta?.views ?? []), ...(P.today.meta?.views ?? [])])];
  buttons('views', views.map((v) => [v, v]), (v) => (S.view ?? views[0]) === v, (v) => { S.view = v; for (const p of live()) p.api.set({ view: v }); redrawIfPaused(); updateButtons(); }, views.length ? 'View' : '');
  buttons('device', Object.entries(DEVICES).map(([k, d]) => [k, d.label, `${d.w}×${d.h}`]), S.device, (v) => { if (v === S.device) return; S.device = v; S.deviceSet = true; layoutStage(); updateButtons(); void prime(); });
  const overlays = [...new Set([...(P.new.meta?.overlays ?? []), ...(P.today.meta?.overlays ?? [])])];
  buttons('overlays', overlays.map((o) => [o, o]), (o) => S.overlays.has(o), (o) => { if (S.overlays.has(o)) S.overlays.delete(o); else S.overlays.add(o); for (const p of live()) p.api.set({ overlays: { [o]: S.overlays.has(o) } }); redrawIfPaused(); updateButtons(); }, overlays.length ? 'Show' : '');
  buttons('speeds', SCALES.map((s) => [s, SPEED_LABEL[s], `${s}× speed`]), S.scale, (s) => { S.scale = s; for (const p of live()) p.api.set({ scale: s }); updateButtons(); });
  buttons('fpses', FPS.map((f) => [f, String(f), `${f} frames a second`]), S.fps, (f) => { if (f === S.fps) return; S.fps = f; S.take = expandTake(S.takeRaw, { fps: f }); S.frames = S.take.frames; updateButtons(); void prime(); });
  const tracks = trackNames();
  buttons('tracks', tracks.map((t) => [t, t]), (t) => (S.track ?? tracks[0]) === t, (t) => { S.track = t; S.dirty = true; updateButtons(); });
  $('play').textContent = S.playing ? 'Pause' : 'Play';
  $('play').classList.toggle('on', S.playing);
  $('loop').classList.toggle('on', S.loop);
  $('rec').classList.toggle('on', S.mode === 'record');
  const sel = $('take-pick');
  const names = Object.keys(S.state?.takes?.takes ?? {});
  if (sel.dataset.sig !== names.join('|') + S.takeName) {
    sel.dataset.sig = names.join('|') + S.takeName;
    sel.innerHTML = '';
    for (const n of names) { const o = document.createElement('option'); o.value = n; o.textContent = n; o.selected = n === S.takeName; sel.append(o); }
    if (!names.length) { const o = document.createElement('option'); o.textContent = 'no take yet'; sel.append(o); }
  }
  legend();
}

function legend() {
  const box = $('legend');
  box.innerHTML = '';
  for (const [k, c] of Object.entries(MOTION)) { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = c; s.append(i, document.createTextNode(k)); box.append(s); }
  const r = document.createElement('span'); r.className = 'right'; r.textContent = 'phases: new above, today below'; box.append(r);
}

async function redrawIfPaused() { if (!S.playing && S.primed) await boot(S.frame); }

/* ------------------------------------------------------------------ tunables */
const pretty = (k) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
function tunablesView() {
  const list = $('tune-list');
  list.innerHTML = '';
  const t = S.state?.tunables ?? {};
  const spec = t.spec ?? P.new.meta?.tunables ?? null;
  $('tune-file').textContent = t.spec ? t.file : '';
  if (!spec || !Object.keys(spec).length) {
    const p = document.createElement('p'); p.className = 'tune-empty';
    p.innerHTML = t.error ? `tunables.json: ${escapeHtml(t.error)}` : 'No tunables yet. Put the numbers that shape the move (a launch speed, a hit-stop, an ease) in <code>tunables.json</code> and read them with <code>lab.tunables</code>: each becomes a slider here, and a kept slider is written back into the file.';
    list.append(p);
  } else {
    let group = null;
    for (const [name, raw] of Object.entries(spec)) {
      const s = typeof raw === 'number' ? { value: raw } : raw;
      if (s.group && s.group !== group) { group = s.group; const g = document.createElement('div'); g.className = 'tune-group'; g.textContent = group; list.append(g); }
      const file = Number(s.value);
      const v = Object.hasOwn(S.overrides, name) ? S.overrides[name] : file;
      const min = Number.isFinite(s.min) ? s.min : Math.min(0, file);
      const max = Number.isFinite(s.max) ? s.max : Math.max(1, Math.abs(file) * 2);
      const step = Number.isFinite(s.step) ? s.step : (max - min) / 200;
      const today = t.today?.[name];
      const k = document.createElement('div'); k.className = `knob${v !== file ? ' changed' : ''}`;
      const row = document.createElement('div'); row.className = 'row';
      const n = document.createElement('span'); n.className = 'name'; n.textContent = pretty(name); n.title = name;
      const val = document.createElement('span'); val.className = 'val'; val.textContent = fmtVal(v, step);
      const unit = document.createElement('span'); unit.className = 'unit'; unit.textContent = s.unit ?? '';
      row.append(n, val, unit);
      const track = document.createElement('div'); track.className = 'track';
      const input = document.createElement('input');
      input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(v);
      input.setAttribute('aria-label', `${pretty(name)}${s.unit ? ` (${s.unit})` : ''}`);
      const fill = () => input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min || 1)) * 100}%`);
      fill();
      let tick = null;
      if (Number.isFinite(today) && max > min) { tick = document.createElement('i'); tick.className = 'tick'; tick.style.left = `calc(${((today - min) / (max - min)) * 100}% - 1px)`; tick.title = `Today: ${today}`; tick.hidden = today === v; }
      input.oninput = () => { const x = Number(input.value); val.textContent = fmtVal(x, step); fill(); if (x === file) delete S.overrides[name]; else S.overrides[name] = x; k.classList.toggle('changed', x !== file); if (tick) tick.hidden = today === x; footState(); retune(); };
      track.append(input);
      if (tick) track.append(tick);
      k.append(row, track);
      const was = document.createElement('span'); was.className = 'was';
      was.textContent = [v !== file ? `file ${fmtVal(file, step)}` : null, Number.isFinite(today) && today !== v ? `today ${fmtVal(today, step)}` : null].filter(Boolean).join(' · ');
      if (was.textContent) k.append(was);
      if (s.note) { const no = document.createElement('span'); no.className = 'note'; no.textContent = s.note; k.append(no); }
      list.append(k);
    }
  }
  footState();
}
const fmtVal = (v, step) => (step >= 1 ? String(Math.round(v)) : step >= 0.1 ? v.toFixed(1) : step >= 0.01 ? v.toFixed(2) : String(Math.round(v * 1000) / 1000));
function footState() {
  const any = Object.keys(S.overrides).length > 0;
  $('keep').disabled = !any || !S.state?.tunables?.spec;
  $('undo').disabled = !any;
}
let retuneTimer = 0;
function retune() {
  clearTimeout(retuneTimer);
  retuneTimer = setTimeout(async () => {
    invalidate([P.new]);
    const playing = S.playing;
    await boot(S.frame, ['new']);
    if (playing) setPlaying(true);
  }, 200);
}

async function keep() {
  const values = { ...S.overrides };
  $('keep').disabled = true;
  $('keep').textContent = 'Keeping…';
  try {
    const r = await fetch(`/_lab/api/${GAME}/tunables`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.why);
    S.overrides = {};
    await loadState();
    tunablesView();
    invalidate([P.new]);
    await boot(S.frame, ['new']);
    flash(`Kept in ${j.file}: ${j.changed.map((c) => `${c.name} ${c.from} → ${c.to}`).join(', ')}`);
  } catch (error) { flash(`Not kept: ${error.message}`); }
  finally { $('keep').textContent = 'Keep in code'; footState(); setStatus(); }
}
function flash(text) { $('hint').textContent = text; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

/* ------------------------------------------------------------------ recording a take */
const REC_SECONDS = 20;
async function startRecording() {
  S.mode = 'record';
  S.recFramesBefore = S.frames;
  S.frames = Math.round(REC_SECONDS * S.fps);
  invalidate();
  $('recbar').hidden = false;
  $('rec-text').textContent = `Recording: play in NEW (both builds get your presses) · up to ${REC_SECONDS} s`;
  updateButtons();
  S.primed = true;
  await boot(0);
  P.new.el.focus();
  try { P.new.el.contentWindow.focus(); } catch { /* fine */ }
  setPlaying(true);
}
function recTick() { $('rec-text').textContent = `Recording ${(S.frame / S.fps).toFixed(1)} s: play in NEW (both builds get your presses)`; }
async function stopRecording() {
  if (S.mode !== 'record') return;
  setPlaying(false);
  const events = (P.new.api?.recorded ?? []).map((e) => ({ ...e }));
  const seconds = Math.max(0.5, Math.ceil((S.frame / S.fps) * 10) / 10);
  S.mode = 'replay';
  $('recbar').hidden = true;
  const taken = Object.keys(S.state.takes.takes);
  let n = taken.length + 1;
  while (taken.includes(`take-${n}`)) n += 1;
  const name = (CHECK ? `take-${n}` : (prompt('Name this take (lowercase, hyphens)', `take-${n}`) ?? '')).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  const take = { note: 'Recorded in the lab', seconds, seed: S.take?.seed ?? 1, device: S.device, fps: S.fps, ...(S.take?.stage ? { stage: S.take.stage } : {}), ...(S.view ? { view: S.view } : {}), ...(S.overlays.size ? { overlays: [...S.overlays] } : {}), ...(S.track ? { track: S.track } : {}), ...(S.takeRaw?.storage ? { storage: S.takeRaw.storage } : {}), inputs: inputsFromRecording(events) };
  if (!name) { S.frames = S.recFramesBefore; flash('Recording dropped (no name).'); await prime(); return; }
  const r = await fetch(`/_lab/api/${GAME}/take`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, take, default: true }) });
  const j = await r.json();
  if (!j.ok) { flash(`Not saved: ${j.why}`); S.frames = S.recFramesBefore; await prime(); return; }
  await loadState();
  pickTake(name);
  updateButtons();
  setStatus();
  flash(`Take "${name}" saved in ${j.file}: ${take.inputs.length} inputs over ${seconds} s.`);
  await prime();
}

/* ------------------------------------------------------------------ scrubbing */
function scrubber(id) {
  const c = $(id);
  let down = false;
  const at = (e) => { const r = c.getBoundingClientRect(); return frameAt(e.clientX - r.left, r.width); };
  c.addEventListener('pointerdown', (e) => { if (!S.primed || S.mode === 'record') return; down = true; c.setPointerCapture(e.pointerId); setPlaying(false); void seek(at(e)); });
  c.addEventListener('pointermove', (e) => { if (down) void seek(at(e)); });
  const up = () => { down = false; };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
}

/* ------------------------------------------------------------------ start */
function wire() {
  $('play').onclick = () => setPlaying(!S.playing);
  $('to-start').onclick = () => { setPlaying(false); void seek(0); };
  $('to-end').onclick = () => { setPlaying(false); void seek(S.frames); };
  $('back').onclick = () => { setPlaying(false); void seek(S.frame - 1); };
  $('fwd').onclick = () => { setPlaying(false); void seek(S.frame + 1); };
  $('loop').onclick = () => { S.loop = !S.loop; updateButtons(); };
  $('keep').onclick = () => void keep();
  $('undo').onclick = () => { S.overrides = {}; tunablesView(); retune(); };
  $('rec').onclick = () => (S.mode === 'record' ? void stopRecording() : void startRecording());
  $('rec-stop').onclick = () => void stopRecording();
  $('take-pick').onchange = (e) => { pickTake(e.target.value); updateButtons(); setStatus(); void prime(); };
  scrubber('timeline');
  scrubber('graph');
  addEventListener('resize', () => { layoutStage(); S.dirty = true; });
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
    const k = e.code;
    if (k === 'Space') { e.preventDefault(); setPlaying(!S.playing); }
    else if (k === 'ArrowLeft') { e.preventDefault(); setPlaying(false); void seek(S.frame - (e.shiftKey ? 10 : 1)); }
    else if (k === 'ArrowRight') { e.preventDefault(); setPlaying(false); void seek(S.frame + (e.shiftKey ? 10 : 1)); }
    else if (k === 'Home') { setPlaying(false); void seek(0); }
    else if (k === 'End') { setPlaying(false); void seek(S.frames); }
    else if (/^Digit[1-4]$/.test(k)) { S.scale = SCALES[Number(k.slice(5)) - 1]; for (const p of live()) p.api.set({ scale: S.scale }); updateButtons(); }
  });
  if (!CHECK && typeof EventSource === 'function') {
    const es = new EventSource(`/_lab/api/${GAME}/events`);
    es.onmessage = async (m) => {
      let e; try { e = JSON.parse(m.data); } catch { return; }
      if (e.k !== 'build') return;
      await loadState();
      setStatus();
      tunablesView();
      const p = e.pane === 'today' ? P.today : P.new;
      if (!e.ok) { flash(`${e.pane === 'today' ? 'Today' : 'New'} did not build: ${e.error}`); return; }
      flash(e.pane === 'today' ? `Today is now ${S.state.today.commit?.short} "${S.state.today.commit?.subject}".` : 'New rebuilt from your change.');
      invalidate([p]);
      const playing = S.playing;
      await boot(S.frame, [p.name]);
      if (playing) setPlaying(true);
    };
  }
}

async function main() {
  wire();
  await loadState();
  pickTake(Q.get('take'));
  if (Q.get('layout') && ['new', 'today', 'both', 'ghost'].includes(Q.get('layout'))) S.layout = Q.get('layout');
  if (Q.get('view')) S.view = Q.get('view');
  if (Q.get('speed') && SCALES.includes(Number(Q.get('speed')))) S.scale = Number(Q.get('speed'));
  layoutStage();
  updateButtons();
  setStatus();
  tunablesView();
  requestAnimationFrame(tick);
  await prime();
  S.replayed = true;
  updateButtons();
  setStatus();
  tunablesView();
}

/* ------------------------------------------------------------------ what `homie-studio lab check` drives */
const readyP = main();
window.labApp = {
  ready: readyP,
  state: () => ({ frame: S.frame, frames: S.frames, fps: S.fps, device: S.device, take: S.takeName, playing: S.playing, busy: S.busy, primed: S.primed, mismatch: S.mismatch }),
  data() {
    const one = (p) => ({ available: p.available, why: p.why, meta: p.meta, frames: p.rec.map((r) => (r ? { f: r.f, tr: r.tr, ph: r.ph, ms: r.ms, sig: r.sig, me: r.me } : null)), phases: phasesOf(p) });
    return { game: GAME, take: S.takeName, note: S.takeRaw?.note ?? null, fps: S.fps, frames: S.frames, device: S.device, seed: S.take?.seed ?? 1, inputs: S.take?.inputs.length ?? 0, todayBuild: S.state?.today ?? null, newBuild: S.state?.new ?? null, tunables: S.state?.tunables ?? null, overrides: { ...S.overrides }, units: Object.fromEntries(trackNames().map((t) => [t, unitOf(t)])), mismatch: S.mismatch, new: one(P.new), today: one(P.today) };
  },
  /** The whole take again, from a fresh load: each frame is compared with the run before (mismatch says where). */
  async rerun() { S.mismatch = null; await boot(S.frames); paint(); return this.data(); },
  async seek(f) { setPlaying(false); await seek(f); paint(); await nextPaint(); await nextPaint(); return S.frame; },
  setTrack(t) { S.track = t; updateButtons(); paint(); },
  setLayout(l) { S.layout = l; layoutStage(); updateButtons(); },
  setOverlays(list) { S.overlays = new Set(list); for (const p of live()) p.api.set({ overlays: Object.fromEntries((p.meta?.overlays ?? []).map((o) => [o, S.overlays.has(o)])) }); updateButtons(); },
  setView(v) { S.view = v; for (const p of live()) p.api.set({ view: v }); updateButtons(); },
  setScale(s) { S.scale = s; updateButtons(); },
  play(on = true) { setPlaying(on); },
};
