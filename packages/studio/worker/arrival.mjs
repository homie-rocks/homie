/**
 * THE ARRIVAL (0.26.0): the play page and the big screen never open on a blank screen. From the page's first paint
 * until the game says it is playable, an arrival card covers the game's frame in the game's own look: its title and
 * its pitch, its key art (the landing's hero still, a trailer's poster, or its cover) drifting slowly, a progress line
 * that says what is happening (finding a room, Room 4 · 3 playing · 2 AI, loading the game, the game's own "loading
 * the heroes 60%"), and the controls for this device. Then it fades and the game has the screen.
 *
 * Colours: the game's own palette first (games.json `ui`, from its style.json: paper, ink, accent), else its
 * landing's (`landing.theme`, `landing.scheme`), else the studio's look. Words: game.json `landing.pitch` (else the
 * blurb's first sentence) and `landing.controls` (phone, computer, tv). Nothing here is invented.
 *
 * When it lifts (NETPLAY.md section 21): at the helper's `playable` message: the game's own `net.playable()` for a
 * game made with `arrival: 'game'`, else the helper's (seated, and the room's state in, two frames later). A game built
 * with an older helper lifts it once it has a seat; a frame with no helper at all, 8 s after it loaded. Whatever
 * happens it lifts 15 s after the helper attached and 30 s after the page opened, so a game is never hidden behind it.
 * `?arrive=0` leaves it out (a test that wants the bare frame).
 *
 * The page's `window.__shell.arrival` says where it is ({ phase, step, p, lookMs, liftedMs, by, mode }), and the page
 * marks `homie:look` (the card's first frame) and `homie:playable` (lifted) for `homie-studio perf`.
 */
import { esc } from './site.mjs';

const CSS_COLOUR = /^(#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([0-9a-z.,%\s/+-]{1,80}\))$/i;
const colour = (v) => (CSS_COLOUR.test(String(v ?? '')) ? String(v) : null);
const hex6 = (v) => /^#[0-9a-f]{6}$/i.test(String(v ?? ''));
const SITE_PATH = /^\/[A-Za-z0-9._~%/-]{1,300}$/;
const sitePath = (v) => (SITE_PATH.test(String(v ?? '')) && !String(v).includes('..') ? String(v) : null);
const FOCUS = /^\d{1,3}% \d{1,3}%$/;

/** The scheme words a landing uses (worker/site.mjs SCHEME_TOKENS), for a landing that sets `scheme` but no colours. */
const SCHEME = { light: { bg: '#f7f6f1', fg: '#15161d' }, dark: { bg: '#0b0c12', fg: '#f1f3f9' } };

/** The card's colours: the game's palette, else its landing's, else the studio's. */
export function arrivalColours(cat, g) {
  const t = cat?.studio?.theme ?? {};
  const L = g?.landing ?? {};
  const ui = hex6(g?.ui?.paper) && hex6(g?.ui?.text) ? g.ui : null;
  if (ui) return { bg: ui.paper, fg: ui.text, hot: colour(ui.hot) ?? colour(L.theme?.accent) ?? colour(t.accent) ?? '#ffcf5a', from: 'game' };
  const scheme = L.scheme === 'light' || L.scheme === 'dark' ? SCHEME[L.scheme] : null;
  return {
    bg: colour(L.theme?.bg) ?? scheme?.bg ?? colour(t.bg) ?? SCHEME.dark.bg,
    fg: colour(L.theme?.fg) ?? scheme?.fg ?? colour(t.fg) ?? SCHEME.dark.fg,
    hot: colour(L.theme?.accent) ?? colour(t.accent) ?? '#ffcf5a',
    from: L.theme || scheme ? 'landing' : 'studio',
  };
}

/** The first sentence of a blurb, at most `max` characters. */
const firstSentence = (s, max = 140) => {
  const one = String(s ?? '').split(/(?<=[.!?])\s/)[0] ?? '';
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

/**
 * The arrival card for a game's play page (`screen`: the big screen): its markup, its CSS, and what its script needs.
 * `{ html, css }`; empty strings with `off`.
 */
export function arrivalCard(cat, g, { screen = false, off = false } = {}) {
  if (off) return { html: '', css: '' };
  const L = g?.landing ?? {};
  const h = L.hero ?? {};
  const c = arrivalColours(cat, g);
  const wide = sitePath(h.wideImage) ?? sitePath(L.cover) ?? (g?.cover ? sitePath(`/games/${g.id}/${g.cover}`) : null);
  const tall = sitePath(h.tallImage);
  const focus = FOCUS.test(String(h.focus ?? '')) ? h.focus : '50% 45%';
  const pitch = String(L.pitch ?? '').trim() || firstSentence(g?.blurb);
  const studio = cat?.studio?.name ?? '';
  const keys = screen
    ? [['tv', L.controls?.tv ?? 'Phones are the controllers: scan the code to play.']]
    : [['phone', L.controls?.phone], ['desk', L.controls?.computer]].filter(([, v]) => v);
  const art = wide || tall
    ? `<picture class="arrive-art">${wide && tall ? `<source media="(min-aspect-ratio: 3/4)" srcset="${esc(wide)}">` : ''}<img src="${esc(tall ?? wide)}" alt="" decoding="async" fetchpriority="high" style="object-position:${esc(focus)}"></picture>`
    : '<div class="arrive-art bare" aria-hidden="true"></div>';
  const html = `<div class="arrive${screen ? ' big' : ''}" data-arrive data-from="${esc(c.from)}">
  ${art}<div class="arrive-shade" aria-hidden="true"></div>
  <div class="arrive-in">
    ${studio ? `<p class="arrive-kicker">${esc(studio)}</p>` : ''}
    <h1 class="arrive-title">${esc(g?.name ?? '')}</h1>
    ${pitch ? `<p class="arrive-pitch">${esc(pitch)}</p>` : ''}
    <div class="arrive-meter" aria-hidden="true"><i data-arrive-bar></i></div>
    <p class="arrive-step" role="status" aria-live="polite"><span data-arrive-step>Finding a room…</span><span class="arrive-room" data-arrive-room></span></p>
    ${keys.map(([k, v]) => `<p class="arrive-keys" data-for="${k}">${esc(String(v).slice(0, 160))}</p>`).join('')}
  </div>
</div>`;
  const css = `.arrive { --a-bg: ${c.bg}; --a-fg: ${c.fg}; --a-hot: ${c.hot}; position: fixed; inset: 0; z-index: 3; overflow: hidden; background: var(--a-bg); color: var(--a-fg); font: 15px/1.4 ui-rounded, "SF Pro Rounded", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; pointer-events: none; transition: opacity .3s ease, visibility 0s linear .3s; }
.arrive.lift { opacity: 0; visibility: hidden; }
.arrive.lift .arrive-art { opacity: 0; transition: opacity .15s ease; }
.arrive-art { position: absolute; inset: 0; display: block; }
.arrive-art img { width: 100%; height: 100%; object-fit: cover; display: block; animation: arrive-drift 14s ease-out both; }
.arrive-art.bare { background: radial-gradient(120% 80% at 50% 18%, color-mix(in srgb, var(--a-hot) 30%, var(--a-bg)) 0%, var(--a-bg) 62%), var(--a-bg); }
.arrive-art.bare::after { content: ""; position: absolute; inset: -20%; background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--a-fg) 4%, transparent) 0 2px, transparent 2px 22px); animation: arrive-slide 9s linear infinite; }
.arrive-shade { position: absolute; inset: 0; background: linear-gradient(180deg, color-mix(in srgb, var(--a-bg) 92%, transparent) 0%, color-mix(in srgb, var(--a-bg) 60%, transparent) 8%, transparent 20%, transparent 44%, color-mix(in srgb, var(--a-bg) 55%, transparent) 62%, color-mix(in srgb, var(--a-bg) 92%, transparent) 80%, var(--a-bg) 100%); }
.arrive-in { position: absolute; left: 0; right: 0; bottom: 0; box-sizing: border-box; padding: 0 max(20px, env(safe-area-inset-left)) max(calc(28px + 6vh), env(safe-area-inset-bottom)); display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; animation: arrive-rise .35s ease-out both; }
.arrive-kicker { margin: 0; font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: color-mix(in srgb, var(--a-fg) 70%, transparent); }
.arrive-title { margin: 0; max-width: 16ch; font-size: clamp(40px, 9vmin, 96px); line-height: .95; font-weight: 900; letter-spacing: -.02em; color: var(--a-fg); text-wrap: balance; text-shadow: 0 2px 24px color-mix(in srgb, var(--a-bg) 70%, transparent); }
.arrive-pitch { margin: 0; max-width: 34ch; font-size: clamp(15px, 2.3vmin, 21px); font-weight: 600; color: color-mix(in srgb, var(--a-fg) 86%, transparent); text-wrap: balance; }
.arrive-meter { width: min(300px, 70vw); height: 6px; margin-top: 8px; border-radius: 999px; background: color-mix(in srgb, var(--a-fg) 16%, transparent); overflow: hidden; }
.arrive-meter i { display: block; width: 6%; height: 100%; border-radius: inherit; background: var(--a-hot); transition: width .5s ease; }
.arrive-step { margin: 0; min-height: 2.8em; font-size: 14px; font-weight: 700; color: color-mix(in srgb, var(--a-fg) 88%, transparent); font-variant-numeric: tabular-nums; }
.arrive-room { display: block; margin-top: 2px; font-size: 12.5px; font-weight: 600; color: color-mix(in srgb, var(--a-fg) 66%, transparent); }
.arrive-keys { display: none; margin: 4px 0 0; padding: 7px 14px; border-radius: 999px; max-width: min(520px, 92vw); font-size: 13.5px; font-weight: 700; background: color-mix(in srgb, var(--a-fg) 9%, transparent); border: 1px solid color-mix(in srgb, var(--a-fg) 14%, transparent); }
.arrive-keys[data-for="desk"], .arrive-keys[data-for="tv"] { display: block; }
@media (max-width: 540px), (max-height: 540px) { .arrive-keys[data-for="desk"] { display: none; } .arrive-keys[data-for="phone"] { display: block; } }
.arrive.big .arrive-title { font-size: clamp(56px, 11vmin, 150px); }
.arrive.big .arrive-pitch { font-size: clamp(20px, 2.8vmin, 34px); }
.arrive.big .arrive-step, .arrive.big .arrive-keys { font-size: clamp(16px, 2vmin, 26px); }
.arrive.big .arrive-room { font-size: clamp(14px, 1.7vmin, 22px); }
@media (min-aspect-ratio: 4/3) and (min-width: 720px) { .arrive-in { padding-bottom: max(calc(36px + 8vh), env(safe-area-inset-bottom)); } }
@keyframes arrive-drift { from { transform: scale(1.08); } to { transform: scale(1); } }
@keyframes arrive-slide { from { transform: translateX(0); } to { transform: translateX(31px); } }
@keyframes arrive-rise { from { transform: translateY(10px); } }
@media (prefers-reduced-motion: reduce) { .arrive-art img, .arrive-art.bare::after, .arrive-in { animation: none; } .arrive { transition: none; } }
/* While the card is up it says the room's facts itself; the chip shows them once the game has the screen. */
.chip.held { opacity: 0; }
`;
  return { html, css };
}

/**
 * The card's script: runs before the shell's (worker/pages.mjs SHELL_JS), which calls `window.__homieArrival`:
 * `room(label)`, `facts(text)`, `full(text)`, `loadingGame()`, `message(m)` (the helper's postMessage), `lift(by)`, and
 * reads `done`. Without the card (`?arrive=0`, or no card) it is a no-op object whose `done` is true.
 */
export const ARRIVAL_JS = String.raw`(function () {
  'use strict';
  var el = document.querySelector('[data-arrive]');
  var off = new URLSearchParams(location.search).get('arrive') === '0';
  if (el && off) { el.remove(); el = null; }
  var api = { done: !el, room: noop, facts: noop, full: noop, loadingGame: noop, message: noop, lift: noop, frameLoaded: noop };
  function noop() {}
  window.__homieArrival = api;
  if (!el) return;
  var now = function () { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); };
  var mark = function (name) { try { performance.mark(name); } catch (e) {} };
  var frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) { return setTimeout(fn, 16); };
  var stepEl = el.querySelector('[data-arrive-step]');
  var roomEl = el.querySelector('[data-arrive-room]');
  var bar = el.querySelector('[data-arrive-bar]');
  // mode: who was to say when the game is playable ('auto': the helper, 'game': the game, 'seat': an older helper);
  // explicitMs: when the game itself said so (the page's clock; null: it never did); lateMs: how long after an
  // automatic arrival had already lifted the card that was (null: it was not late). The shell's script fills both.
  var a = { phase: 'room', step: stepEl.textContent, p: 0.06, lookMs: null, liftedMs: null, by: null, mode: null, explicitMs: null, lateMs: null };
  api.state = a;
  // The card's first frame on the screen: what perf reads as the time to the first meaningful frame.
  frame(function () { frame(function () { a.lookMs = Math.round(now()); mark('homie:look'); }); });
  // Each phase's ceiling: between the real steps the bar creeps toward it (never past it), so a wait never looks stuck.
  var CEIL = { room: 0.18, game: 0.33, wait: 0.33, join: 0.47, world: 0.95 };
  var stopCreep = function () {};
  if (typeof setInterval === 'function') {
    var creep = setInterval(function () {
      if (api.done) { stopCreep(); return; }
      var top = CEIL[a.phase] || 0.95;
      if (a.p < top) { a.p = Math.min(top, a.p + (top - a.p) * 0.04 + 0.002); bar.style.width = Math.round(a.p * 100) + '%'; }
    }, 150);
    stopCreep = function () { clearInterval(creep); };
  }
  function set(phase, step, p) {
    if (api.done) return;
    a.phase = phase;
    if (step && step !== a.step) { a.step = step; stepEl.textContent = step; }
    if (typeof p === 'number' && p > a.p) { a.p = Math.min(0.98, p); bar.style.width = Math.round(a.p * 100) + '%'; }
  }
  bar.style.width = Math.round(a.p * 100) + '%';
  var timers = [];
  function later(ms, why) { timers.push(setTimeout(function () { api.lift(why); }, ms)); }
  // Whatever happens, the game gets the screen within 30 s of the page opening.
  later(30000, 'timeout');
  var roomLabel = '';
  // A full server's wait ("you're next for a seat") stays said while its room loads.
  api.room = function (label) { roomLabel = label || ''; if (a.phase === 'wait') set('wait', a.step, 0.22); else set('game', 'Loading the game…', 0.22); if (!roomEl.textContent) roomEl.textContent = roomLabel; };
  api.facts = function (text) { if (!api.done && text) roomEl.textContent = text; };
  api.full = function (text) { set('wait', text, 0.3); };
  var attachedAt = 0;
  var seatedTimer = null;
  api.frameLoaded = function () {
    // A frame with no netplay helper never says anything: 8 s after it loaded, it has the screen.
    if (!attachedAt) later(8000, 'no-helper');
  };
  api.message = function (m) {
    if (api.done || !m) return;
    if (m.what === 'attached') {
      attachedAt = Date.now();
      a.mode = m.arrival === 'game' || m.arrival === 'auto' ? m.arrival : 'seat';
      set('join', 'Joining ' + (roomLabel || 'the room') + '…', 0.36);
      later(15000, 'cap');
    } else if (m.what === 'role' || m.what === 'token') {
      set('world', 'Loading the world…', 0.5);
      // A game built with a helper older than the arrival says nothing more: it has the screen once it has a seat.
      if (a.mode === 'seat' && !seatedTimer) seatedTimer = setTimeout(function () { api.lift('seated'); }, 600);
    } else if (m.what === 'loading') {
      var p = Math.max(0, Math.min(1, Number(m.p) || 0));
      var what = typeof m.label === 'string' && m.label ? m.label : 'the world';
      set('world', 'Loading ' + what + '… ' + Math.round(p * 100) + '%', 0.5 + 0.46 * p);
    } else if (m.what === 'playable') {
      api.lift(m.by === 'game' ? 'game' : 'auto');
    }
  };
  api.lift = function (by) {
    if (api.done) return;
    api.done = true;
    a.phase = 'done'; a.by = by || 'shell'; a.p = 1; a.liftedMs = Math.round(now());
    mark('homie:playable');
    timers.forEach(clearTimeout); clearTimeout(seatedTimer); stopCreep();
    bar.style.width = '100%';
    stepEl.textContent = 'Ready';
    el.classList.add('lift');
    setTimeout(function () { el.hidden = true; }, 450);
    try { window.dispatchEvent(new CustomEvent('homie-arrived', { detail: { by: a.by } })); } catch (e) {}
  };
}());`;
