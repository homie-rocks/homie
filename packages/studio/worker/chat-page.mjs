/**
 * ROOM CHAT ON THE PAGE (@homie-rocks/studio 0.23.0, NETPLAY.md section 19): one component for the play page, the big
 * screen (the TV view) and the watch page. It speaks on the page's own watch socket, so every game has it, old builds
 * too, with no game code:
 *
 *   play      a Chat pill beside the room button (the corner game.json screen.share keeps clear of the game's HUD; the
 *             round icon on a phone, as the room button is), its sheet (the room's last minutes, the room's emoji, its
 *             quick lines, typing where the rules allow, Report on a line, and for the studio's owner Remove, Mute and
 *             Kick), a short strip of new lines where the status chip sits or where game.json screen.chat puts it
 *             (chatPlaces; "sheet-only" keeps them in the sheet), and reactions floating up the screen
 *   tv        the room's lines in a corner (no typing: a television is read across a room) and the float
 *   watch     a Chat button in the watch page's band, its panel over the stage, and the float
 *
 * The float is the TV's own (homie.rocks's live rooms paint reactions on the television the same way): at most six a
 * second, eighteen at once, each rising for 2.4 s with a little sway. The five reactions and their order are
 * homie.rocks's (fire, clap, laugh, heart, wow), and so are the message shapes (`say` and `react` up, `line` and
 * `react` down) and the "One line at a time." of its slow mode.
 *
 * Names and messages are always text (textContent), never markup. Nothing here is stored but this browser's two
 * switches (localStorage): "Show chat on this screen" and "Show my messages over my character".
 */
import { REACTIONS } from './chat.mjs';
import { REPORT_REASONS, REPORT_WORDS } from './chat-store.mjs';
import { NET_PALETTE } from './room.mjs';

/** Where room chat's strip of new lines may sit: a corner, or the middle of the top or bottom edge. */
export const CHAT_PLACES = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const CHAT_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const CHAT_DEVICES = ['desk', 'phone', 'sideways', 'tv'];
const CHAT_FIELDS = ['at', 'x', 'y', 'lines'];

/** One entry of game.json `screen.chat` as written (a place, false, or an object), keeping only the fields that are right. */
function chatEntry(v) {
  if (v === false) return { lines: 'sheet-only' };
  if (typeof v === 'string') return CHAT_PLACES.includes(v) ? { at: v } : {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const o = {};
  if (CHAT_PLACES.includes(v.at)) o.at = v.at;
  for (const k of ['x', 'y']) if (v[k] !== undefined && v[k] !== null && v[k] !== '' && Number.isFinite(Number(v[k]))) o[k] = Math.round(Number(v[k]));
  if (v.lines === 'strip' || v.lines === 'sheet-only') o.lines = v.lines;
  return o;
}

/**
 * Where room chat sits on each screen, from game.json `screen.chat` (0.24.5), so a game with a busy HUD keeps its chat
 * off its clock, its title and its controls. The Chat pill itself sits in the room button's band (`screen.share`
 * places both); this places the strip of new lines that shows for a moment, and the big screen's corner of lines:
 *
 *   "chat": "bottom-right"                                   every device's strip there (and the big screen's corner)
 *   "chat": false                                            no strip: new lines wait in the sheet, the pill counts them
 *   "chat": { "at": "top-left", "y": 120 }                   moved 120 px in from its edge (x: from its side)
 *   "chat": { "lines": "strip", "phone": { "lines": "sheet-only" }, "tv": { "at": "top-right" } }
 *
 * `at` is a place from CHAT_PLACES (default: the bottom left, or the bottom right when the room button is there); `x`
 * and `y` move it in, 0 to 600 px (in the middle of an edge, `x` moves it either way); `lines` is "strip" (the default)
 * or "sheet-only". `desk`, `phone` (held upright), `sideways` (else as `phone`) and `tv` (the big screen) each change
 * only what they name. The big screen has no sheet: it takes a corner only, its place follows the top level's when that
 * is a corner, and its lines stay unless its own entry says "sheet-only" (then it shows only the float).
 */
export function chatPlaces(value) {
  const top = chatEntry(value);
  const per = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const done = (o) => {
    const at = o.at ?? null;
    const clamp = (n, lo) => Math.max(lo, Math.min(600, n ?? 0));
    return { at, x: clamp(o.x, at && at.endsWith('center') ? -600 : 0), y: clamp(o.y, 0), lines: o.lines ?? 'strip' };
  };
  const phone = { ...top, ...chatEntry(per.phone) };
  const { lines: _l, ...where } = top;
  const own = chatEntry(per.tv);
  if (own.at && !CHAT_CORNERS.includes(own.at)) delete own.at;
  const tv = { ...(CHAT_CORNERS.includes(where.at) ? where : {}), ...own };
  return { desk: done({ ...top, ...chatEntry(per.desk) }), phone: done(phone), sideways: done({ ...phone, ...chatEntry(per.sideways) }), tv: done(tv) };
}

/** game.json `screen.chat` as the build reads it: the problems in words (the page uses the default for anything wrong). */
export function screenChatProblems(value) {
  if (value === undefined || value === null || value === false) return [];
  const out = [];
  const one = (v, name, top) => {
    if (v === false) return;
    if (typeof v === 'string') { if (!CHAT_PLACES.includes(v)) out.push(`${name} "${v}" is not a place (${CHAT_PLACES.join(', ')})`); return; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { out.push(`${name} is a place, false, or { "at", "x", "y", "lines" }`); return; }
    for (const k of Object.keys(v)) {
      if (top && CHAT_DEVICES.includes(k)) continue;
      if (!CHAT_FIELDS.includes(k)) out.push(`${name}.${k} is not a field (${k === 'corner' || k === 'place' ? 'the place is "at"' : `${CHAT_FIELDS.join(', ')}${top ? `, or ${CHAT_DEVICES.join(', ')}` : ''}`})`);
    }
    if (v.at !== undefined && !CHAT_PLACES.includes(v.at)) out.push(`${name}.at "${v.at}" is not a place (${CHAT_PLACES.join(', ')})`);
    if (name.endsWith('.tv') && v.at !== undefined && !CHAT_CORNERS.includes(v.at)) out.push(`${name}.at: the big screen takes a corner`);
    for (const k of ['x', 'y']) if (v[k] !== undefined && !Number.isFinite(Number(v[k]))) out.push(`${name}.${k} is a number of pixels`);
    if (v.lines !== undefined && v.lines !== 'strip' && v.lines !== 'sheet-only') out.push(`${name}.lines is "strip" or "sheet-only"`);
  };
  one(value, 'screen.chat', true);
  if (value && typeof value === 'object' && !Array.isArray(value)) for (const d of CHAT_DEVICES) if (value[d] !== undefined) one(value[d], `screen.chat.${d}`, false);
  return out.slice(0, 8);
}

/** What a page's chat starts from (`window.__HOMIE_CHAT`): its surface, the game, and who this browser is to the studio. */
export function chatBoot(g, { surface = 'play', owner = false, acct = false, member = false, room = null } = {}) {
  return {
    surface, game: g.id, name: g.name, owner: Boolean(owner), acct: Boolean(acct), member: Boolean(member), palette: NET_PALETTE,
    reactions: REACTIONS, reasons: REPORT_REASONS.map((k) => ({ k, text: REPORT_WORDS[k] })),
    ...(room ? { room } : {}),
    // game.json "screen": { "chat": … }: where the strip of new lines sits on each device, or "sheet-only" (chatPlaces).
    places: chatPlaces(g?.screen?.chat),
    account: '/account/',
  };
}

export const CHAT_CSS = `
/* ROOM CHAT (section 19). */
.cpill .cico { width: 15px; height: 15px; flex: none; }
.cpill .cbadge { min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 8px; background: var(--hot); color: #0b0b10; font: 800 10px/16px ui-sans-serif, system-ui, sans-serif; text-align: center; }
.cpill.dim .cbadge { display: inline-block; }
/* The pill as the room button's round icon (on a phone, beside a room button kept an icon, or where its word would reach
   the game's clock or title): its word goes, and the count rides its corner. */
.cpill.icon-only, .cpill.icon-only:hover, .cpill.icon-only:focus-visible, .cpill.icon-only[aria-expanded="true"] { position: relative; width: 34px; padding: 0; justify-content: center; }
.cpill.icon-only span.cword { display: none; }
.cpill.icon-only .cbadge { position: absolute; top: -5px; right: -5px; min-width: 16px; box-shadow: 0 0 0 2px rgba(6,9,16,.85); }
.csheet { display: flex; flex-direction: column; gap: 8px; width: min(340px, calc(100vw - 16px)); }
.chead { display: flex; align-items: center; gap: 8px; margin: 0 2px; }
.chead b { font: 800 15px/1.2 ui-sans-serif, system-ui, sans-serif; letter-spacing: -.01em; }
.chead span { flex: 1; min-width: 0; color: #aab3c7; font-weight: 500; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chead button { flex: none; width: 30px; height: 30px; border-radius: 50%; border: 0; background: rgba(255,255,255,.07); color: inherit; font: 600 15px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.cfeed { list-style: none; margin: 0; padding: 0 2px; min-height: 48px; max-height: clamp(96px, 30vh, 280px); overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 2px; font: 500 14px/1.38 ui-sans-serif, system-ui, -apple-system, sans-serif; -webkit-user-select: text; user-select: text; touch-action: pan-y; }
.cfeed .cempty { color: #7d8699; font-size: 13px; padding: 10px 4px; cursor: default; }
.cfeed li { padding: 3px 6px; border-radius: 8px; overflow-wrap: anywhere; cursor: pointer; }
.cfeed li:hover { background: rgba(255,255,255,.04); }
.cfeed li.cmine { cursor: default; }
.cfeed .cn { font-weight: 800; margin-right: 6px; }
.cfeed .ctag { display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 999px; font: 800 10px/1.6 ui-monospace, Menlo, monospace; letter-spacing: .06em; vertical-align: 1px; background: color-mix(in srgb, var(--hot) 22%, transparent); color: #fff; }
.cfeed li.creact { opacity: .7; font-size: 1.05em; }
.cfeed li.creact .cg { font-size: 1.45em; line-height: 1; vertical-align: -.12em; }
.cfeed li.cstudio { border: 1px solid color-mix(in srgb, var(--hot) 60%, transparent); }
.cfeed li.cstudio .cn { color: var(--hot); }
.cfeed li.cpending { opacity: .55; }
.cfeed li.cheld { color: #ffb3bd; }
.cfeed li .cwhy { display: block; font-size: 12px; color: #ff8a9a; font-weight: 600; }
.cfeed li.cgone { opacity: .45; text-decoration: line-through; }
.cacts { display: flex; flex-wrap: wrap; gap: 6px; margin: 5px 0 2px; }
.cacts button { min-height: 30px; padding: 0 10px; border-radius: 9px; border: 1px solid rgba(255,255,255,.18); background: transparent; color: inherit; font: 700 12px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.cacts button.warn { color: #ffc27a; border-color: rgba(255,179,92,.55); }
.cacts button.bad { color: #ff8a9a; border-color: rgba(255,107,125,.55); }
.cacts button.bad.armed { background: #ff6b7d; color: #16080a; }
.cnew { align-self: center; margin-top: -4px; padding: 3px 10px; border-radius: 999px; border: 0; background: var(--hot); color: #0b0b10; font: 800 11.5px/1.3 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.creacts { display: flex; gap: 6px; justify-content: space-between; }
.creacts button { width: 2.5rem; height: 2.5rem; flex: none; border-radius: 50%; border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.04); font: 1.25rem/1 "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; cursor: pointer; touch-action: manipulation; transition: transform .12s ease-out, border-color .12s; padding: 0; }
.creacts button.pop { transform: scale(1.16); border-color: var(--hot); }
.creacts button[disabled] { opacity: .35; cursor: default; }
.clines { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; touch-action: pan-x; padding: 1px 0 2px; }
.clines::-webkit-scrollbar { display: none; }
.clines button { flex: none; min-height: 32px; padding: 0 11px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16); background: transparent; color: inherit; font: 700 12.5px/1 ui-sans-serif, system-ui, sans-serif; white-space: nowrap; cursor: pointer; touch-action: manipulation; }
.csay { display: flex; gap: 6px; margin: 0; }
.csay input { flex: 1; min-width: 0; min-height: 40px; box-sizing: border-box; border-radius: 11px; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.05); color: inherit; font: 500 16px/1.2 ui-sans-serif, system-ui, sans-serif; padding: 0 11px; -webkit-user-select: text; user-select: text; }
.csay input:focus { outline: 2px solid color-mix(in srgb, var(--hot) 70%, transparent); outline-offset: 0; }
.csay button { min-height: 40px; padding: 0 14px; border-radius: 11px; border: 0; background: var(--hot); color: #0b0b10; font: 800 14px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.cnote { margin: 0 2px; color: #aab3c7; font: 500 12.5px/1.4 ui-sans-serif, system-ui, sans-serif; }
.cnote a { color: var(--hot); font-weight: 700; text-decoration: none; }
.copts { display: grid; gap: 2px; border-top: 1px solid rgba(255,255,255,.08); padding-top: 6px; margin: 0 2px; }
.copts label { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 30px; font: 600 12.5px/1.25 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.copts input { width: 18px; height: 18px; flex: none; accent-color: var(--hot); }
.creport { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 6px 0 2px; }
.creport p { grid-column: 1 / -1; margin: 0; color: #c3cad9; font: 600 12.5px/1.35 ui-sans-serif, system-ui, sans-serif; }
.creport button { min-height: 32px; padding: 0 8px; border-radius: 9px; border: 1px solid rgba(255,255,255,.16); background: transparent; color: inherit; font: 700 12px/1.2 ui-sans-serif, system-ui, sans-serif; cursor: pointer; text-align: left; }
/* The strip of new lines (game.json screen.chat: its place, moved in by --chat-x / --chat-y). */
.ctick { --chat-x: 0px; --chat-y: 0px; position: fixed; z-index: 5; display: flex; flex-direction: column; gap: 4px; max-width: min(320px, calc(100vw - 24px)); pointer-events: none; }
.ctick.at-bottom-left { left: calc(max(10px, env(safe-area-inset-left)) + var(--chat-x)); bottom: calc(max(10px, env(safe-area-inset-bottom)) + 36px + var(--chat-y)); align-items: flex-start; }
.ctick.at-bottom-right { right: calc(max(10px, env(safe-area-inset-right)) + var(--chat-x)); bottom: calc(max(10px, env(safe-area-inset-bottom)) + 36px + var(--chat-y)); align-items: flex-end; }
.ctick.at-bottom-center { left: calc(50% + var(--chat-x)); transform: translateX(-50%); bottom: calc(max(10px, env(safe-area-inset-bottom)) + 36px + var(--chat-y)); align-items: center; }
.ctick.at-top-left { left: calc(max(10px, env(safe-area-inset-left)) + var(--chat-x)); top: calc(max(10px, env(safe-area-inset-top)) + 48px + var(--chat-y)); align-items: flex-start; flex-direction: column-reverse; }
.ctick.at-top-right { right: calc(max(10px, env(safe-area-inset-right)) + var(--chat-x)); top: calc(max(10px, env(safe-area-inset-top)) + 48px + var(--chat-y)); align-items: flex-end; flex-direction: column-reverse; }
.ctick.at-top-center { left: calc(50% + var(--chat-x)); transform: translateX(-50%); top: calc(max(10px, env(safe-area-inset-top)) + 48px + var(--chat-y)); align-items: center; flex-direction: column-reverse; }
.ctick div { padding: 5px 10px; border-radius: 12px; background: rgba(6,9,16,.66); color: #eef1f8; font: 600 13px/1.3 ui-sans-serif, system-ui, -apple-system, sans-serif; overflow-wrap: anywhere; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: ctin .2s ease-out; transition: opacity .5s; }
.ctick div b { font-weight: 800; margin-right: 6px; }
.ctick div.cout { opacity: 0; }
@keyframes ctin { from { opacity: 0; transform: translateY(6px); } }
.cfloat { position: fixed; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 4; }
.ctv { --chat-x: 0px; --chat-y: 0px; position: fixed; z-index: 6; box-sizing: border-box; width: min(26rem, 30vw); max-height: 42vh; display: flex; flex-direction: column; justify-content: flex-end; gap: .3em; padding: .55em .8em; border-radius: 16px; background: rgba(8,12,22,.7); border: 1px solid rgba(255,255,255,.12); color: #eef1f8; font: 600 clamp(14px, 1.6vmin, 24px)/1.35 ui-sans-serif, system-ui, -apple-system, sans-serif; pointer-events: none; overflow: hidden; }
.ctv:empty { display: none; }
.ctv.at-bottom-left { left: calc(max(16px, env(safe-area-inset-left)) + var(--chat-x)); bottom: calc(max(16px, env(safe-area-inset-bottom)) + var(--chat-y)); }
.ctv.at-bottom-right { right: calc(max(16px, env(safe-area-inset-right)) + var(--chat-x)); bottom: calc(max(16px, env(safe-area-inset-bottom)) + var(--chat-y)); }
.ctv.at-top-left { left: calc(max(16px, env(safe-area-inset-left)) + var(--chat-x)); top: calc(max(16px, env(safe-area-inset-top)) + var(--chat-y)); justify-content: flex-start; }
.ctv.at-top-right { right: calc(max(16px, env(safe-area-inset-right)) + var(--chat-x)); top: calc(max(16px, env(safe-area-inset-top)) + var(--chat-y)); justify-content: flex-start; }
.ctv div { overflow-wrap: anywhere; transition: opacity 1s; }
.ctv div.cout { opacity: 0; }
.ctv b { font-weight: 800; margin-right: .4em; }
.ctv .cg { font-size: 1.5em; line-height: 1; vertical-align: -.12em; }
.ctv .creact { opacity: .75; }
.cwatch { flex: none; display: inline-flex; align-items: center; gap: .45em; min-height: 2.4em; padding: 0 .9em 0 .75em; border-radius: 11px; border: 1px solid rgba(255,255,255,.18); background: transparent; color: #eef1f8; font: inherit; font-weight: 800; cursor: pointer; }
.cwatch .cico { width: 1.1em; height: 1.1em; }
.cwatch[aria-expanded="true"] { border-color: var(--hot); }
.cwatch .cbadge { min-width: 1.3em; height: 1.3em; padding: 0 .3em; box-sizing: border-box; border-radius: .65em; background: var(--hot); color: #0b0b10; font-size: .72em; line-height: 1.3em; text-align: center; }
.cpanel { position: absolute; z-index: 8; top: 10px; right: max(10px, env(safe-area-inset-right)); box-sizing: border-box; padding: 12px; border-radius: 16px; background: rgba(8,12,22,.94); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 18px 50px rgba(0,0,0,.5); color: #eef1f8; font-size: 13px; }
@media (max-width: 640px) {
  .cpanel { top: auto; bottom: 0; left: 0; right: 0; width: auto; border-radius: 18px 18px 0 0; padding-bottom: max(12px, env(safe-area-inset-bottom)); }
  .cpanel.csheet { width: auto; }
  .cwatch .cword { display: none; }
}
@media (max-height: 460px) { .cfeed { max-height: 26vh; } .clines { display: none; } }
@media (prefers-reduced-motion: reduce) { .ctick div { animation: none; } .creacts button { transition: none; } }
`;

/**
 * The owner's chat tools (a page served to the studio's signed-in owner only; nobody else's page has a byte of it):
 * Remove a line from every screen, Mute its sender for 10 minutes, or Kick them out of the room (a second tap), each
 * taking the sender's lines down too. The controls go to the studio's own /_studio/api with the owner's session.
 */
export const CHAT_OWNER_JS = String.raw`(function () {
  'use strict';
  var st = window.__homieChat; var cfg = window.__HOMIE_CHAT;
  if (!st || !cfg || !cfg.owner) return;
  function call(path, body, done) {
    fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, message: 'HTTP ' + r.status }; }); })
      .then(function (j) { st.pick = null; st.flash(j.ok ? done : (j.message || 'That did not work.')); st.render(); })
      .catch(function () { st.flash('The studio did not answer.'); });
  }
  function button(cls, text, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.onclick = function (e) { e.stopPropagation(); fn(); }; return b; }
  st.ownerActs = function (m, acts) {
    acts.append(
      button('bad', 'Remove', function () { call('/_studio/api/chat/remove', { game: cfg.game, room: st.room, id: m.id }, 'Removed from every screen.'); }),
      button('warn', 'Mute 10 min', function () { call('/_studio/api/mute', { game: cfg.game, room: st.room, line: m.id, minutes: 10, purge: true }, 'Muted for 10 min; their messages are down.'); }),
      button('bad' + (st.armed === m.id ? ' armed' : ''), st.armed === m.id ? 'Tap again to remove them' : 'Kick', function () {
        if (st.armed !== m.id) { st.armed = m.id; st.render(); return; }
        st.armed = null;
        call('/_studio/api/kick', { game: cfg.game, room: st.room, line: m.id, minutes: 10, purge: true }, 'Removed from the room for 10 min.');
      }));
  };
}());`;

/* The chat component (the site's own origin; it never touches the game's frame except to tell it the two switches). */
export const CHAT_JS = String.raw`(function () {
  'use strict';
  var cfg = window.__HOMIE_CHAT;
  if (!cfg) return;
  var surface = cfg.surface;
  var palette = cfg.palette || [];
  var reduce = false;
  try { reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var st = { ws: null, room: cfg.room || null, rules: null, now: null, lines: [], open: false, unread: 0, pending: {}, seq: 0, show: true, bubble: true, armed: null, pick: null, report: null, log: [], got: {}, sent: {} };
  window.__homieChat = st;
  try { st.show = localStorage.getItem('homie-chat-show') !== '0'; st.bubble = localStorage.getItem('homie-chat-bubble') !== '0'; } catch (e) {}
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
  function now() { return Date.now(); }
  // A name's colour: the player's seat colour (the game's own), else homie.rocks's room chat hue from the name.
  function hueOf(s) { var h = 2166136261; s = String(s || ''); for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h % 360; }
  function colourOf(m) { return typeof m.colour === 'number' && palette.length ? palette[m.colour % palette.length] : 'oklch(.82 .13 ' + hueOf(m.name) + ')'; }
  function mySeat() { var s = window.__shell; return s && typeof s.seat === 'number' ? s.seat : null; }
  var ICON = '<svg class="cico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.3 9.6 9.6 0 0 1-3.6-.7L3 21l1.6-4.5A8 8 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3.2a8.4 8.4 0 0 1 9 8.3Z"/></svg>';

  /* ------------------------------------------------------------ the float: the TV's reactions, on this screen */
  var canvas = null; var ctx = null; var parts = []; var spent = []; var raf = 0;
  function floatLayer() {
    if (canvas) return;
    var host = (surface === 'watch' ? document.querySelector('.stage') : null) || document.body;
    if (!host) return;
    canvas = el('canvas', 'cfloat'); canvas.setAttribute('aria-hidden', 'true');
    if (surface === 'watch') { canvas.style.position = 'absolute'; }
    host.appendChild(canvas);
    ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) { canvas = null; return; }
  }
  function burst(glyph, id) {
    if (!st.show || !glyph) return;
    if (reduce) { tick({ name: '', glyph: glyph, react: true }); return; }
    floatLayer();
    if (!canvas) return;
    var t = performance.now();
    while (spent.length && spent[0] < t - 1000) spent.shift();
    // At most six a second and eighteen at once (the TV's own numbers): a storm stays a storm, never a wall.
    if (spent.length >= 6 || parts.length >= 18) return;
    spent.push(t);
    parts.push({ glyph: glyph, at: t, x: 0.1 + Math.random() * 0.8, sway: Math.random() * 2 - 1, id: id || null, seen: false });
    if (!raf) raf = requestAnimationFrame(paint);
  }
  function paint(t) {
    raf = 0;
    if (!canvas) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = canvas.clientWidth; var h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = Math.max(20, Math.min(40, h * 0.05)) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    parts = parts.filter(function (p) { return t - p.at < 2400; });
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i]; var age = (t - p.at) / 2400;
      if (age < 0) continue;
      ctx.globalAlpha = Math.min(1, age * 8) * (1 - age);
      ctx.fillText(p.glyph, w * p.x + Math.sin(age * 5) * p.sway * Math.min(48, w * 0.025), h * (0.9 - age * 0.55));
      // When a reaction is first on this screen (what a latency check reads: the line's id and the wall clock).
      if (!p.seen) { p.seen = true; if (p.id) st.got[p.id] = Date.now(); }
    }
    ctx.globalAlpha = 1;
    if (parts.length) raf = requestAnimationFrame(paint);
  }

  /* ------------------------------------------------------------ where chat sits on this screen (game.json screen.chat) */
  // This screen as the room button knows it (desk, phone held upright, phone turned sideways), else by its size.
  function device() {
    if (surface === 'tv') return 'tv';
    var s = window.__shell && window.__shell.share;
    if (s && s.device) return s.device;
    var w = window.innerWidth || 0; var h = window.innerHeight || 0;
    return w && h && Math.min(w, h) <= 540 ? (w > h ? 'sideways' : 'phone') : 'desk';
  }
  function placeHere() { var p = cfg.places || {}; return p[device()] || p.desk || { at: null, x: 0, y: 0, lines: 'strip' }; }

  /* ------------------------------------------------------------ the strip: new lines, for a moment, where the chip sits */
  var tickEl = null;
  function tickPlace() {
    var p = placeHere();
    if (p.at) return p.at;
    var s = window.__shell && window.__shell.share;
    return s && s.at === 'bottom-left' ? 'bottom-right' : 'bottom-left';
  }
  function tick(m) {
    if (surface === 'tv' || !st.show || st.open) return;
    // "sheet-only": a busy HUD keeps new lines in the sheet; the pill's count says they are there.
    var p = placeHere();
    if (p.lines === 'sheet-only') return;
    if (!tickEl) {
      var host = (surface === 'watch' ? document.querySelector('.stage') : null) || document.body;
      if (!host) return;
      tickEl = el('div', 'ctick'); tickEl.setAttribute('aria-hidden', 'true'); host.appendChild(tickEl); if (surface === 'watch') tickEl.style.position = 'absolute';
    }
    var at = tickPlace();
    tickEl.className = 'ctick at-' + at;
    // Moved in by the game's x / y, and past the room button when the strip shares its place.
    var s = window.__shell && window.__shell.share; var same = surface === 'play' && s && s.at === at;
    tickEl.style.setProperty('--chat-x', ((p.x || 0) + (same ? s.x || 0 : 0)) + 'px');
    tickEl.style.setProperty('--chat-y', ((p.y || 0) + (same ? s.y || 0 : 0)) + 'px');
    var row = el('div');
    if (m.name) { var b = el('b', '', m.name); b.style.color = colourOf(m); row.appendChild(b); }
    row.appendChild(document.createTextNode(m.glyph && m.react ? m.glyph : (m.text || '')));
    tickEl.appendChild(row);
    while (tickEl.children.length > 3) tickEl.removeChild(tickEl.firstChild);
    setTimeout(function () { row.classList.add('cout'); setTimeout(function () { if (row.parentNode) row.remove(); }, 600); }, 4500);
  }

  /* ------------------------------------------------------------ the TV's corner */
  var tvEl = null;
  function tvLine(m) {
    var p = placeHere();
    if (!st.show || p.lines === 'sheet-only') return;
    if (!tvEl) {
      if (!document.body) return;
      tvEl = el('div', 'ctv');
      var join = document.querySelector('[data-join]');
      var at = join && /join-bottom-left/.test(join.className) ? 'bottom-right' : join && /join-top-left|join-top-right/.test(join.className) ? 'bottom-left' : 'bottom-left';
      tvEl.className = 'ctv at-' + (p.at || at);
      tvEl.style.setProperty('--chat-x', (p.x || 0) + 'px');
      tvEl.style.setProperty('--chat-y', (p.y || 0) + 'px');
      document.body.appendChild(tvEl);
    }
    var row = el('div', m.t === 'react' ? 'creact' : '');
    row.setAttribute('data-line', m.id || '');
    var b = el('b', '', m.by === 'studio' ? 'Studio' : m.name); b.style.color = m.by === 'studio' ? 'var(--hot)' : colourOf(m); row.appendChild(b);
    if (m.t === 'react') row.appendChild(el('span', 'cg', m.glyph || '')); else row.appendChild(document.createTextNode(m.text || ''));
    tvEl.appendChild(row);
    while (tvEl.children.length > 6) tvEl.removeChild(tvEl.firstChild);
    setTimeout(function () { row.classList.add('cout'); setTimeout(function () { if (row.parentNode) row.remove(); }, 1100); }, 20000);
  }

  /* ------------------------------------------------------------ the pill, the sheet, the panel */
  var pill = null; var badge = null; var sheet = null; var feed = null; var newBtn = null; var reactsEl = null; var linesEl = null; var form = null; var input = null; var note = null; var where = null;
  var bubbleBox = null; var showBox = null;
  function build() {
    if (surface === 'tv' || sheet) return;
    if (surface === 'play') {
      var band = document.querySelector('[data-room-ui] .pills');
      var ui = document.querySelector('[data-room-ui]');
      if (!band || !ui) return;
      pill = el('button', 'pill cpill'); pill.type = 'button'; pill.setAttribute('data-chat-toggle', ''); pill.setAttribute('aria-expanded', 'false'); pill.setAttribute('aria-controls', 'chat-sheet'); pill.setAttribute('aria-label', 'Room chat');
      pill.innerHTML = ICON; pill.appendChild(el('span', 'cword', 'Chat')); badge = el('b', 'cbadge'); badge.hidden = true; pill.appendChild(badge);
      band.appendChild(pill);
      watchBand(band);
      sheet = el('div', 'sheet csheet'); sheet.id = 'chat-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Room chat'); sheet.hidden = true;
      ui.appendChild(sheet);
      // One sheet at a time: the room's and the server's close this one, and this one closes theirs.
      ['[data-share-toggle]', '[data-server-toggle]'].forEach(function (q) { var b = document.querySelector(q); if (b) b.addEventListener('click', function () { openChat(false, true); }); });
    } else {
      var top = document.querySelector('[data-top]'); var playb = document.querySelector('[data-playb]');
      if (!top) return;
      pill = el('button', 'cwatch'); pill.type = 'button'; pill.setAttribute('aria-expanded', 'false'); pill.setAttribute('aria-label', 'Room chat');
      pill.innerHTML = ICON; pill.appendChild(el('span', 'cword', 'Chat')); badge = el('b', 'cbadge'); badge.hidden = true; pill.appendChild(badge);
      top.insertBefore(pill, playb || null);
      sheet = el('div', 'cpanel csheet'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Room chat'); sheet.setAttribute('data-keep-focus', ''); sheet.hidden = true;
      (document.querySelector('.stage') || document.body).appendChild(sheet);
    }
    pill.addEventListener('click', function (e) { e.stopPropagation(); openChat(!st.open); });
    var head = el('div', 'chead'); head.appendChild(el('b', '', 'Room chat')); where = el('span'); head.appendChild(where);
    var x = el('button', '', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close chat'); x.onclick = function () { openChat(false); }; head.appendChild(x);
    feed = el('ol', 'cfeed'); feed.setAttribute('aria-live', 'polite'); feed.setAttribute('data-chat-feed', '');
    feed.addEventListener('scroll', function () { if (atBottom()) newBtn.hidden = true; }, { passive: true });
    newBtn = el('button', 'cnew', 'New messages ↓'); newBtn.type = 'button'; newBtn.hidden = true; newBtn.onclick = function () { feed.scrollTop = feed.scrollHeight; newBtn.hidden = true; };
    reactsEl = el('div', 'creacts'); reactsEl.setAttribute('data-chat-reacts', '');
    linesEl = el('div', 'clines'); linesEl.setAttribute('data-chat-lines', '');
    form = el('form', 'csay'); form.setAttribute('data-chat-say', '');
    input = el('input'); input.type = 'text'; input.setAttribute('enterkeyhint', 'send'); input.setAttribute('autocomplete', 'off'); input.setAttribute('aria-label', 'Say something to the room'); input.placeholder = 'Say something…';
    var go = el('button', '', 'Say'); go.type = 'submit';
    form.append(input, go);
    form.addEventListener('submit', function (e) { e.preventDefault(); sendText(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); openChat(false); } e.stopPropagation(); });
    note = el('p', 'cnote'); note.hidden = true; note.setAttribute('data-chat-note', '');
    var opts = el('div', 'copts');
    var l1 = el('label'); l1.appendChild(el('span', '', 'Show my messages over my character')); bubbleBox = el('input'); bubbleBox.type = 'checkbox'; bubbleBox.checked = st.bubble; bubbleBox.setAttribute('data-chat-bubble', ''); l1.appendChild(bubbleBox);
    var l2 = el('label'); l2.appendChild(el('span', '', 'Show chat on this screen')); showBox = el('input'); showBox.type = 'checkbox'; showBox.checked = st.show; showBox.setAttribute('data-chat-show', ''); l2.appendChild(showBox);
    bubbleBox.addEventListener('change', function () { st.bubble = bubbleBox.checked; try { localStorage.setItem('homie-chat-bubble', st.bubble ? '1' : '0'); } catch (e) {} tellFrame(); });
    showBox.addEventListener('change', function () { st.show = showBox.checked; try { localStorage.setItem('homie-chat-show', st.show ? '1' : '0'); } catch (e) {} tellFrame(); if (!st.show) { parts = []; if (tickEl) tickEl.textContent = ''; } });
    opts.append(l1, l2);
    if (surface !== 'play') l1.hidden = true;
    sheet.append(head, feed, newBtn, reactsEl, linesEl, form, note, opts);
    document.addEventListener('pointerdown', function (e) { if (st.open && !sheet.contains(e.target) && !pill.contains(e.target)) openChat(false); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.open) openChat(false); });
    renderFeed();
    paintRules();
  }
  /*
   * The pill's word, as the room button's: on a phone (either way up), or beside a room button that game.json keeps an
   * icon ("label": false), the pill is the round icon from the start. Elsewhere its word shows unless, with it, the band
   * would leave the screen or reach from its corner into the middle third of the screen's width (where games keep a
   * clock or a title); once it has, it stays the icon until the screen changes size, so it never flickers as the room
   * button's own label comes and goes.
   */
  var narrow = false;
  function shareHere() { var s = window.__shell && window.__shell.share; return s || {}; }
  function wordCollides() {
    var band = pill && pill.parentNode;
    var w = window.innerWidth || 0;
    if (!band || !band.getBoundingClientRect || !w) return false;
    var had = pill.classList.contains('icon-only');
    if (had) pill.classList.remove('icon-only');
    var r = band.getBoundingClientRect();
    if (had) pill.classList.add('icon-only');
    if (!r.width) return false;
    if (r.left < 4 || r.right > w - 4) return true;
    var at = shareHere().at || 'top-right';
    if (/center/.test(at)) return false;
    return /right/.test(at) ? r.left < w * 2 / 3 : r.right > w / 3;
  }
  function fitPill() {
    if (!pill || surface !== 'play') return;
    var s = shareHere();
    if (!narrow && s.device !== 'phone' && s.device !== 'sideways' && s.label !== false) narrow = wordCollides();
    var icon = s.device === 'phone' || s.device === 'sideways' || s.label === false || narrow;
    if (icon) { pill.classList.add('icon-only'); pill.title = 'Room chat'; } else { pill.classList.remove('icon-only'); pill.title = ''; }
    st.compact = icon;
  }
  var fitQueued = false;
  function fitSoon() {
    if (fitQueued) return;
    fitQueued = true;
    var go = function () { fitQueued = false; fitPill(); };
    if (window.requestAnimationFrame) window.requestAnimationFrame(go); else setTimeout(go, 16);
  }
  function watchBand(band) {
    fitPill();
    // The band changes as the room code arrives, the server's pill shows and the labels fade to dots: look again.
    try { if (window.ResizeObserver) new ResizeObserver(fitSoon).observe(band); } catch (e) {}
    // A new size (a turned phone, a resized window): the room button moves first, then the word is measured afresh.
    window.addEventListener('resize', function () { setTimeout(function () { narrow = false; fitPill(); }, 60); });
  }
  st.fit = fitPill;
  function openChat(on, quiet) {
    if (!sheet) return;
    st.open = Boolean(on);
    sheet.hidden = !st.open;
    pill.setAttribute('aria-expanded', st.open ? 'true' : 'false');
    if (st.open) {
      st.unread = 0; paintBadge();
      if (surface === 'play') {
        ['[data-share-sheet]', '[data-server-sheet]'].forEach(function (q) { var s = document.querySelector(q); if (s) s.hidden = true; });
        ['[data-share-toggle]', '[data-server-toggle]'].forEach(function (q) { var b = document.querySelector(q); if (b) b.setAttribute('aria-expanded', 'false'); });
        pill.classList.remove('dim');
      }
      if (tickEl) tickEl.textContent = '';
      feed.scrollTop = feed.scrollHeight;
    } else if (!quiet) {
      var frame = document.querySelector('iframe.game');
      if (surface === 'play' && frame) { try { frame.focus(); } catch (e) {} }
    }
  }
  function paintBadge() { if (!badge) return; badge.hidden = !st.unread; badge.textContent = st.unread > 9 ? '9+' : String(st.unread); }
  function tellFrame() {
    var frame = document.querySelector('iframe.game');
    try { if (frame && frame.contentWindow) frame.contentWindow.postMessage({ t: 'homie-chat', show: st.show, bubble: st.bubble }, '*'); } catch (e) {}
  }

  /* ------------------------------------------------------------ the rules: what this browser may send here */
  function rank(mode) { return { off: 0, emoji: 1, lines: 2, text: 3 }[mode] || 0; }
  function mayIf(who) { return cfg.owner || who === 'anyone' || (who === 'signed-in' && cfg.acct) || (who === 'members' && cfg.member); }
  function iAmWatcher() { return surface === 'watch' || mySeat() === null; }
  function paintRules() {
    var r = st.rules;
    if (!sheet || !r) { if (pill) pill.hidden = Boolean(r && r.mode === 'off'); return; }
    pill.hidden = r.mode === 'off';
    if (r.mode === 'off' && st.open) openChat(false);
    var watchersOut = iAmWatcher() && !r.watchers && !cfg.owner;
    var reacts = rank(r.mode) >= 1 && mayIf(r.react) && !watchersOut;
    var lines = rank(r.mode) >= 2 && mayIf(r.react) && !watchersOut;
    var typing = rank(r.mode) >= 3 && mayIf(r.who) && !watchersOut;
    reactsEl.textContent = '';
    (r.emoji || cfg.reactions).forEach(function (x) {
      var b = el('button', '', x.e); b.type = 'button'; b.setAttribute('data-react', x.k); b.setAttribute('aria-label', 'React ' + x.k); b.title = x.k;
      b.disabled = !reacts;
      b.addEventListener('click', function () { sendReact(x, b); });
      reactsEl.appendChild(b);
    });
    reactsEl.hidden = rank(r.mode) < 1;
    linesEl.textContent = '';
    (rank(r.mode) >= 2 ? r.lines || [] : []).forEach(function (l) {
      var b = el('button', '', l.text); b.type = 'button'; b.setAttribute('data-say', l.id); b.disabled = !lines;
      b.addEventListener('click', function () { sendLine(l); });
      linesEl.appendChild(b);
    });
    linesEl.hidden = !(rank(r.mode) >= 2 && (r.lines || []).length);
    form.hidden = !typing;
    input.maxLength = r.max || 140;
    var n = '';
    var link = null;
    if (watchersOut) n = 'Watchers read the chat here; only players send.';
    else if (r.mode === 'emoji') n = r.capped === 'kids' ? 'This room keeps chat to emoji (a room for kids).' : 'This room keeps chat to emoji.';
    else if (r.mode === 'lines') n = r.capped === 'kids' ? 'This room keeps chat to emoji and quick lines (a room for kids).' : 'This room keeps chat to emoji and quick lines.';
    else if (!typing && r.who === 'signed-in') { n = 'Sign in to type here. Emoji ' + (rank(r.mode) >= 2 ? 'and quick lines are' : 'are') + ' open to everyone. '; link = 'Sign in'; }
    else if (!typing && r.who === 'members') n = 'Only members of this server type here.';
    if (!reacts && !watchersOut && r.react === 'signed-in' && !cfg.acct) { n = 'Sign in to chat in this room. '; link = 'Sign in'; }
    note.textContent = n;
    if (link) { var a = el('a', '', link); a.href = cfg.account + '?next=' + encodeURIComponent(window.__shell && window.__shell.returnPath ? window.__shell.returnPath() : location.pathname + location.search); a.target = surface === 'play' ? '_blank' : '_self'; note.appendChild(a); }
    note.hidden = !n;
    bubbleBox.parentNode.hidden = surface !== 'play' || !r.bubbles || mySeat() === null;
  }
  function paintWhere() {
    if (!where) return;
    var f = st.now; var c = f && f.counts ? f.counts : null;
    var bits = [];
    if (st.room) { var m = /^pub-(\d+)$/.exec(st.room); bits.push(m ? 'Room ' + m[1] : st.room); }
    if (c) bits.push(c.players + (c.players === 1 ? ' playing' : ' playing') + (c.watchers ? ' · ' + c.watchers + ' watching' : ''));
    where.textContent = bits.join(' · ');
  }

  /* ------------------------------------------------------------ sending */
  function send(msg) {
    var ws = st.ws;
    if (!ws || ws.readyState !== 1) { flash('Not connected yet; try again in a moment.'); return false; }
    try { ws.send(JSON.stringify(msg)); return true; } catch (e) { return false; }
  }
  function nextN() { st.seq += 1; return 'c' + st.seq + Math.random().toString(36).slice(2, 6); }
  function sendReact(x, b) {
    var n = nextN();
    var msg = { t: 'react', kind: x.k, n: n };
    if (!st.bubble) msg.bubble = false;
    if (!send(msg)) return;
    st.pending[n] = { react: true, at: now() };
    st.sent[n] = now();
    // Yours floats at once; the room's copy of it does not float twice.
    burst(x.e, null);
    if (b) { b.classList.add('pop'); setTimeout(function () { b.classList.remove('pop'); }, 160); }
  }
  function sendLine(l) {
    var n = nextN();
    var msg = { t: 'say', say: l.id, n: n };
    if (!st.bubble) msg.bubble = false;
    if (!send(msg)) return;
    st.sent[n] = now();
    addPending(n, l.text);
  }
  function sendText() {
    var text = String(input.value || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    var n = nextN();
    var msg = { t: 'say', text: text.slice(0, (st.rules && st.rules.max) || 280), n: n };
    if (!st.bubble) msg.bubble = false;
    if (!send(msg)) return;
    st.sent[n] = now();
    input.value = '';
    addPending(n, text);
  }
  function addPending(n, text) {
    var me = { id: null, n: n, t: 'line', name: myName(), text: text, seat: mySeat(), colour: mySeat(), pending: true, mine: true };
    st.pending[n] = me;
    st.lines.push(me);
    renderFeed(true);
  }
  function myName() { var f = st.now; var s = mySeat(); var c = f && f.clients ? f.clients.filter(function (x) { return x.seat === s && s !== null; })[0] : null; return c ? c.name : 'You'; }

  /* ------------------------------------------------------------ receiving */
  function receive(m) {
    if (!m || typeof m !== 'object') return false;
    if (m.t === 'line' || m.t === 'react') { onLine(m, false); return true; }
    if (m.t === 'lines' && Array.isArray(m.lines)) { st.lines = m.lines.slice(-80).map(function (x) { return Object.assign({}, x); }); renderFeed(); return true; }
    if (m.t === 'unline' && Array.isArray(m.ids)) {
      st.lines = st.lines.filter(function (x) { return m.ids.indexOf(x.id) < 0; });
      if (tvEl) m.ids.forEach(function (id) { var r = tvEl.querySelector('[data-line="' + String(id).replace(/[^A-Za-z0-9_-]/g, '') + '"]'); if (r) r.remove(); });
      renderFeed(); return true;
    }
    if (m.t === 'held' || m.t === 'slow') {
      var p = m.n && st.pending[m.n];
      if (p && !p.react) { p.pending = false; p.held = m.message || 'Not sent.'; if (input && !input.value && p.text && m.why !== 'words' && m.why !== 'harm' && m.why !== 'ai' && m.why !== 'contact') input.value = p.text; renderFeed(); setTimeout(function () { st.lines = st.lines.filter(function (x) { return x !== p; }); renderFeed(); }, 7000); }
      else flash(m.message || 'Not sent.');
      if (m.n) delete st.pending[m.n];
      return true;
    }
    return false;
  }
  function onLine(m, quiet) {
    var mine = Boolean(m.n && st.pending[m.n]) || (typeof m.seat === 'number' && m.seat === mySeat() && surface === 'play');
    var p = m.n ? st.pending[m.n] : null;
    if (p) delete st.pending[m.n];
    var line = Object.assign({}, m, { mine: mine });
    if (p && !p.react) { var i = st.lines.indexOf(p); if (i >= 0) st.lines[i] = line; else st.lines.push(line); }
    else st.lines.push(line);
    if (st.lines.length > 80) st.lines = st.lines.slice(-80);
    st.log.push({ id: m.id, t: m.t, n: m.n || null, at: now(), mine: mine });
    if (st.log.length > 200) st.log.shift();
    if (m.t === 'react' && !(p && p.react)) burst(m.glyph, m.id);
    else if (m.t === 'react' && p && p.react) st.got[m.id] = now();
    if (m.t === 'line') st.got[m.id] = now();
    if (surface === 'tv') { tvLine(m); return; }
    if (!quiet && !mine && m.t === 'line' && m.by !== 'studio') {
      if (!st.open) { st.unread += 1; paintBadge(); if (pill) pill.classList.remove('dim'); }
      tick(m);
    }
    renderFeed(true);
  }

  /* ------------------------------------------------------------ the feed */
  function atBottom() { return !feed || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 24; }
  function renderFeed(append) {
    if (!feed) return;
    var stick = atBottom();
    feed.textContent = '';
    if (!st.lines.length) { var e = el('li', 'cempty', 'Nothing said yet. Say hi, or send an emoji.'); feed.appendChild(e); return; }
    st.lines.forEach(function (m) {
      var li = el('li', (m.t === 'react' ? 'creact' : '') + (m.by === 'studio' ? ' cstudio' : '') + (m.pending ? ' cpending' : '') + (m.held ? ' cheld' : '') + (m.mine ? ' cmine' : ''));
      if (m.id) li.setAttribute('data-line', m.id);
      if (m.by === 'studio') li.appendChild(el('span', 'ctag', 'STUDIO'));
      else if (m.owner) li.appendChild(el('span', 'ctag', 'OWNER'));
      var n = el('span', 'cn', m.by === 'studio' ? 'Studio' : m.mine && surface === 'play' ? 'You' : m.name); if (m.by !== 'studio') n.style.color = colourOf(m); li.appendChild(n);
      if (m.t === 'react') li.appendChild(el('span', 'cg', m.glyph || '')); else li.appendChild(el('span', 'ct', m.text || ''));
      if (m.held) li.appendChild(el('span', 'cwhy', m.held));
      if (m.reported) li.appendChild(el('span', 'cwhy', 'Reported. Thanks.'));
      if (m.id && !m.mine && m.by !== 'studio' && !m.pending) li.addEventListener('click', function () { st.pick = st.pick === m.id ? null : m.id; st.armed = null; st.report = null; renderFeed(); });
      if (m.id && st.pick === m.id) li.appendChild(actions(m));
      feed.appendChild(li);
    });
    if (stick || !append) feed.scrollTop = feed.scrollHeight; else if (append) newBtn.hidden = false;
  }
  function actions(m) {
    var box = el('div');
    if (m.id && st.report === m.id) {
      var rep = el('div', 'creport'); rep.appendChild(el('p', '', 'Tell the studio what is wrong with this message:'));
      (cfg.reasons || []).forEach(function (r) { var b = el('button', '', r.text); b.type = 'button'; b.onclick = function (e) { e.stopPropagation(); report(m, r.k); }; rep.appendChild(b); });
      box.appendChild(rep);
      return box;
    }
    var acts = el('div', 'cacts');
    if (!m.reported) { var r = el('button', 'warn', 'Report'); r.type = 'button'; r.onclick = function (e) { e.stopPropagation(); st.report = m.id; renderFeed(); }; acts.appendChild(r); }
    // The studio's owner, in their own game: Remove, Mute and Kick, from the owner's own script (only their page has it).
    if (cfg.owner && typeof st.ownerActs === 'function') st.ownerActs(m, acts);
    box.appendChild(acts);
    return box;
  }
  function report(m, reason) {
    var b = null; try { b = localStorage.getItem('homie-b'); } catch (e) {}
    fetch('/' + cfg.game + '/api/chat/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room: st.room, id: m.id, reason: reason, b: b }) })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (j) { st.report = null; st.pick = null; if (j.ok) m.reported = true; flash(j.message || (j.ok ? 'Thanks for telling the studio.' : 'That did not go through.')); renderFeed(); })
      .catch(function () { flash('That did not go through.'); });
  }
  var flashEl = null;
  function flash(text) {
    var t = document.querySelector('[data-toast]');
    if (t) { t.textContent = text; t.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(function () { t.hidden = true; }, 2600); return; }
    if (!flashEl) { if (!document.body) return; flashEl = el('div', 'ctick at-top-center'); document.body.appendChild(flashEl); }
    var row = el('div', '', text); flashEl.appendChild(row);
    setTimeout(function () { row.remove(); }, 2600);
  }

  /* ------------------------------------------------------------ what the page tells it */
  st.socket = function (ws, room) { st.ws = ws; if (room) st.room = room; build(); paintWhere(); };
  st.receive = receive;
  st.facts = function (f) {
    if (!f || typeof f !== 'object') return;
    st.now = f;
    var r = f.policy && f.policy.chat ? f.policy.chat : null;
    var sig = r ? JSON.stringify(r) : '';
    if (sig !== st.rulesSig) { st.rulesSig = sig; st.rules = r; build(); paintRules(); }
    paintWhere();
  };
  st.seat = function () { paintRules(); };
  st.burst = burst;
  st.flash = function (t) { flash(t); };
  st.render = function () { renderFeed(); };
  // A big screen has nothing to type with: its corner and the float only.
  if (surface === 'tv') floatLayer();
  // Settle the game's frame on this browser's two switches as soon as it loads.
  var frame0 = document.querySelector('iframe.game');
  if (frame0) frame0.addEventListener('load', tellFrame);
}());`;
