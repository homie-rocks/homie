/**
 * The back office's pages (worker/office.mjs has the rules): the owner's live office (/_studio/office), the page
 * where the owner confirms what their AI asked (/_studio/confirm/<ask>), and the page anyone else gets.
 *
 * The office is one document and one script, inline, allowed by its hash (no other script, nothing from anywhere
 * else, connect only to this site). Everything a player typed is set as text, never as markup. Never cached,
 * never indexed, never framed.
 */
import { SKILLS } from './agents.mjs';
import { KIDS_LINE, POLICY_WORDS, SERVER_LIMITS } from './servers.mjs';
import { esc } from './site.mjs';

const PRIVATE = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, private',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};
const NO_SCRIPT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const accentOf = (cat) => { const a = cat?.studio?.theme?.accent; return /^#[0-9a-f]{3,8}$/i.test(String(a ?? '')) ? a : '#ffcf5a'; };

const CSS = `
:root { color-scheme: dark; --bg: #07080d; --panel: #10131c; --panel2: #161a26; --ink: #eef1f8; --dim: #9aa3b7; --faint: #6c7489; --line: rgba(255,255,255,.10); --line2: rgba(255,255,255,.18); --good: #7dffb0; --warn: #ffb35c; --bad: #ff6b7d; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 24px 16px 72px; }
header.top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
h1 { margin: 0; font-size: clamp(22px, 4.6vw, 32px); letter-spacing: -.02em; }
h1 small { color: var(--dim); font-weight: 600; font-size: .55em; letter-spacing: .02em; margin-left: 6px; }
h2 { margin: 0; font-size: 20px; letter-spacing: -.01em; }
h3 { margin: 18px 0 8px; font-size: 12px; letter-spacing: .09em; text-transform: uppercase; color: var(--dim); }
a { color: var(--accent); }
.dim { color: var(--dim); } .faint { color: var(--faint); }
.links { display: flex; gap: 14px; align-items: center; font-size: 14px; }
.live { display: inline-flex; align-items: center; gap: 7px; font-weight: 700; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--faint); }
.dot.on { background: var(--good); box-shadow: 0 0 0 0 rgba(125,255,176,.6); animation: pulse 1.8s infinite; }
@keyframes pulse { 70% { box-shadow: 0 0 0 9px rgba(125,255,176,0); } 100% { box-shadow: 0 0 0 0 rgba(125,255,176,0); } }
.bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 18px 0 6px; padding: 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; }
.bar label { font-size: 13px; color: var(--dim); margin-right: 2px; }
input, select { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line2); border-radius: 10px; padding: 8px 10px; min-height: 38px; }
input[type=text] { flex: 1 1 220px; min-width: 0; }
input[type=number] { width: 76px; }
button { font: inherit; font-weight: 700; color: #16120a; background: var(--accent); border: 0; border-radius: 10px; padding: 8px 14px; min-height: 38px; cursor: pointer; touch-action: manipulation; }
button.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line2); font-weight: 600; }
button.warn { background: transparent; color: var(--warn); border: 1px solid rgba(255,179,92,.45); }
button.bad { background: transparent; color: var(--bad); border: 1px solid rgba(255,107,125,.45); }
button.armed { background: var(--bad); color: #16080a; border-color: var(--bad); }
button:disabled { opacity: .45; cursor: default; }
button.small { min-height: 30px; padding: 4px 10px; font-size: 13px; border-radius: 8px; }
.game { margin-top: 22px; background: var(--panel); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; }
.ghead { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; justify-content: space-between; padding: 16px 16px 14px; border-bottom: 1px solid var(--line); }
.ghead .name { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.state { display: inline-flex; border: 1px solid var(--line2); border-radius: 999px; padding: 3px; gap: 2px; }
.state button { background: transparent; color: var(--dim); font-weight: 600; border-radius: 999px; min-height: 30px; padding: 4px 12px; font-size: 13px; }
.state button[aria-pressed=true] { background: var(--ink); color: var(--bg); }
.state button[data-v=private][aria-pressed=true] { background: #c9b8ff; }
.state button[data-v=invite][aria-pressed=true] { background: var(--warn); }
.state button[data-v=public][aria-pressed=true] { background: var(--good); }
.settings { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); background: var(--panel2); font-size: 14px; }
.settings label { display: inline-flex; gap: 8px; align-items: center; }
.switch { appearance: none; -webkit-appearance: none; width: 42px; height: 24px; min-height: 0; padding: 0; border-radius: 999px; background: var(--line2); position: relative; cursor: pointer; border: 0; }
.switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--ink); transition: left .15s; }
.switch:checked { background: var(--good); } .switch:checked::after { left: 21px; background: #0a1a10; }
.rooms { padding: 4px 0; }
.room { border-top: 1px solid var(--line); }
.room:first-child { border-top: 0; }
.rhead { display: grid; grid-template-columns: minmax(110px, 1.2fr) repeat(4, minmax(70px, 1fr)) auto; gap: 8px 12px; align-items: center; padding: 12px 16px; cursor: pointer; }
.rhead:hover { background: rgba(255,255,255,.025); }
.rhead b { font-size: 15px; }
.stat { font-variant-numeric: tabular-nums; font-size: 14px; }
.stat span { display: block; color: var(--faint); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
.racts { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.people { padding: 0 16px 14px; }
.person { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 9px 12px; margin-top: 6px; border-radius: 12px; background: var(--bg); border: 1px solid var(--line); }
.person .who { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; min-width: 0; }
.person .who b { overflow-wrap: anywhere; }
.chip { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; border: 1px solid var(--line2); color: var(--dim); }
.chip.host { color: var(--accent); border-color: var(--accent); }
.chip.owner { color: #c9b8ff; border-color: #c9b8ff; }
.chip.invited { color: var(--warn); border-color: rgba(255,179,92,.6); }
.chip.muted { color: var(--bad); border-color: rgba(255,107,125,.6); }
.chip.bot { color: var(--faint); }
.pacts { display: flex; gap: 6px; }
.empty { padding: 18px 16px; color: var(--dim); }
.held { padding: 0 16px 12px; font-size: 13px; color: var(--dim); }
.invites { padding: 12px 16px 14px; border-bottom: 1px solid var(--line); }
.inv { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; padding: 8px 0; border-top: 1px dashed var(--line); font-size: 14px; }
.inv:first-of-type { border-top: 0; }
.inv code { font: 700 15px/1 ui-monospace, Menlo, monospace; letter-spacing: .06em; color: var(--ink); }
.inv.closed { opacity: .5; }
.newinv { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.toast { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); background: #1f2433; border: 1px solid var(--line2); padding: 10px 16px; border-radius: 12px; font-weight: 600; max-width: calc(100vw - 32px); z-index: 9; }
.note { color: var(--dim); font-size: 13px; max-width: 75ch; margin-top: 26px; }
.err { color: var(--bad); }
.servers { padding: 12px 16px 14px; border-bottom: 1px solid var(--line); }
.srv { border-top: 1px dashed var(--line); padding: 8px 0; }
.srv:first-of-type { border-top: 0; }
.srvhead { display: grid; grid-template-columns: minmax(140px, 1.3fr) minmax(160px, 1.6fr) minmax(150px, 1.3fr) auto; gap: 6px 12px; align-items: center; cursor: pointer; font-size: 14px; }
.srvhead b { font-size: 15px; }
.srvbody { padding: 8px 0 4px 14px; display: grid; gap: 8px; font-size: 14px; }
.srvbody .line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.warnbox { margin: 10px 16px; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(255,179,92,.45); color: var(--warn); font-size: 14px; }
.secret { font: 600 13px/1.4 ui-monospace, Menlo, monospace; word-break: break-all; padding: 10px; border-radius: 10px; background: var(--bg); border: 1px solid var(--warn); }
.chip.ai { color: #ffe7a8; border-color: rgba(255,207,90,.6); }
/* The New server form: one panel, grouped, every control labelled, help under it in the office's quiet grey. */
.newsrv { display: grid; gap: 16px; max-width: 820px; margin-top: 10px; padding: 16px; border-radius: 14px; background: var(--panel2); border: 1px solid var(--line); }
.newsrv [hidden] { display: none !important; }
.newsrv h4 { margin: 0; font-size: 17px; letter-spacing: -.01em; }
.newsrv fieldset { border: 0; border-top: 1px solid var(--line); margin: 0; padding: 14px 0 0; min-width: 0; display: grid; gap: 10px; }
.newsrv legend { float: left; width: 100%; padding: 0 0 4px; font-size: 12px; letter-spacing: .09em; text-transform: uppercase; color: var(--dim); font-weight: 700; }
.newsrv legend + * { clear: both; }
.newsrv .frow { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 6px 14px; align-items: start; }
.newsrv .frow > label, .newsrv .frow > .lbl { padding-top: 9px; font-size: 14px; font-weight: 600; color: var(--ink); }
.newsrv .ctl { display: grid; gap: 5px; min-width: 0; }
.newsrv .help { margin: 0; color: var(--faint); font-size: 13px; line-height: 1.45; }
.newsrv .help b { color: var(--dim); font-weight: 600; }
.newsrv .note { margin: 0; padding: 10px 12px; border-radius: 12px; border: 1px dashed var(--line2); color: var(--dim); font-size: 14px; max-width: none; }
.newsrv input[type=text] { width: 100%; }
.policies { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.policy { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; align-items: start; padding: 11px 12px; border-radius: 12px; border: 1px solid var(--line2); background: var(--bg); cursor: pointer; }
.policy:hover { border-color: rgba(255,255,255,.3); }
.policy.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.policy input { margin: 2px 0 0; width: 16px; height: 16px; min-height: 0; padding: 0; border: 0; background: none; accent-color: var(--accent); }
.policy b { font-size: 14px; letter-spacing: .04em; text-transform: uppercase; }
.policy span { grid-column: 2; color: var(--dim); font-size: 13px; line-height: 1.4; }
.stepper { display: inline-flex; align-items: center; gap: 6px; }
.stepper button { width: 38px; padding: 0; font-size: 18px; line-height: 1; }
.stepper input[type=number] { width: 64px; text-align: center; -moz-appearance: textfield; }
.stepper input::-webkit-outer-spin-button, .stepper input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.stepper .of { color: var(--dim); font-size: 14px; }
.seg { display: inline-flex; flex-wrap: wrap; border: 1px solid var(--line2); border-radius: 999px; padding: 3px; gap: 2px; justify-self: start; }
.seg label { position: relative; cursor: pointer; }
.seg input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; min-height: 0; }
.seg span { display: inline-block; padding: 6px 14px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--dim); }
.seg input:checked + span { background: var(--ink); color: var(--bg); }
.seg input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 1px; }
.dial { display: grid; gap: 4px; max-width: 420px; }
.dial input[type=range] { width: 100%; min-height: 0; padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
.dial .ticks { display: grid; grid-template-columns: repeat(var(--n, 5), 1fr); font-size: 11px; color: var(--faint); }
.dial .ticks span:not(:first-child):not(:last-child) { text-align: center; }
.dial .ticks span:last-child { text-align: right; }
.dial output { font-size: 14px; color: var(--ink); }
.dial output b { color: var(--accent); }
.check { display: inline-flex; gap: 10px; align-items: center; font-weight: 600; font-size: 14px; cursor: pointer; }
.check input { width: 18px; height: 18px; min-height: 0; padding: 0; accent-color: var(--accent); }
.newsrv .acts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border-top: 1px solid var(--line); padding-top: 14px; }
@media (max-width: 720px) {
  .newsrv { padding: 14px 12px; }
  .newsrv .frow { grid-template-columns: 1fr; gap: 6px; }
  .newsrv .frow > label, .newsrv .frow > .lbl { padding-top: 0; }
  .policies { grid-template-columns: 1fr; }
}
@media (max-width: 720px) { .srvhead { grid-template-columns: 1fr 1fr; } }
@media (max-width: 720px) {
  .rhead { grid-template-columns: 1fr 1fr 1fr; }
  .rhead .racts { grid-column: 1 / -1; justify-content: flex-start; }
  .person { grid-template-columns: 1fr; }
}
`;

/* The office's one script (allowed by its hash). It reads /_studio/api/office every 3 s while the page is visible. */
export const OFFICE_SCRIPT = String.raw`(function () {
  'use strict';
  var S = { data: null, open: {}, drafts: {}, busy: false, err: 0, timer: null };
  var root = document.getElementById('games');
  var liveEl = document.getElementById('live');
  var holdEl = document.getElementById('hold');
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
  function add(p) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) p.appendChild(arguments[i]); return p; }
  function btn(label, cls, fn) { var b = el('button', cls || '', label); b.type = 'button'; b.onclick = fn; return b; }
  function toast(text, bad) { var t = document.getElementById('toast'); t.textContent = text; t.className = 'toast' + (bad ? ' err' : ''); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 3500); }
  function dur(ms) { if (!(ms >= 0)) return '–'; var s = Math.floor(ms / 1000); var h = Math.floor(s / 3600); var m = Math.floor((s % 3600) / 60); return h ? h + ' h ' + m + ' min' : m ? m + ' min' : s + ' s'; }
  function clock(ms) { if (!(ms >= 0)) return ''; var s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function hold() { return Number(holdEl.value) || 10; }
  function post(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, message: 'HTTP ' + r.status }; }); });
  }
  function act(path, body, done) {
    return post(path, body).then(function (r) {
      if (r && r.ok) toast(done || (r.what ? 'Done: ' + r.what : 'Done.'));
      else toast((r && (r.message || r.error)) || 'That did not work.', true);
      load();
      return r;
    }).catch(function () { toast('The studio did not answer.', true); });
  }
  // A control that takes something away needs a second tap within 4 s.
  function armed(label, cls, fn) {
    var b = btn(label, cls + ' small', function () {
      if (b.getAttribute('data-armed') === '1') { b.disabled = true; fn(); return; }
      b.setAttribute('data-armed', '1'); b.textContent = 'Sure? ' + label; b.classList.add('armed');
      setTimeout(function () { b.removeAttribute('data-armed'); b.textContent = label; b.classList.remove('armed'); }, 4000);
    });
    return b;
  }

  function gameSettings(g) {
    var box = el('div', 'settings');
    var st = el('div', 'state'); st.setAttribute('role', 'group'); st.setAttribute('aria-label', 'Launch state');
    [['private', 'Private'], ['invite', 'Invite-only beta'], ['public', 'Public']].forEach(function (p) {
      var b = btn(p[1], '', function () {
        if (g.launch === p[0]) return;
        if (p[0] !== 'public' && !confirm('Make ' + g.name + ' ' + p[1].toLowerCase() + '? Its live rooms finish their current round with a notice, then everyone the new state leaves out is sent out with a thank-you. It leaves the directory the next time the directory reads this studio.')) return;
        act('/_studio/api/game', { game: g.id, launch: p[0] }, g.name + ' is ' + p[1].toLowerCase() + ' now.');
      });
      b.setAttribute('data-v', p[0]); b.setAttribute('aria-pressed', g.launch === p[0] ? 'true' : 'false');
      st.appendChild(b);
    });
    var remix = el('input', 'switch'); remix.type = 'checkbox'; remix.checked = g.remix; remix.disabled = !g.remixBuilt;
    remix.setAttribute('aria-label', 'Remixable');
    remix.onchange = function () { act('/_studio/api/game', { game: g.id, remix: remix.checked }, remix.checked ? g.name + '\'s source is open for remixing.' : g.name + '\'s source is withdrawn.'); };
    var max = el('input'); max.type = 'number'; max.min = '1'; max.max = String(g.seats); max.value = String(g.maxPlayers); max.setAttribute('aria-label', 'Players per room');
    var setMax = btn('Set', 'ghost small', function () {
      var n = Math.floor(Number(max.value));
      act('/_studio/api/game', { game: g.id, maxPlayers: n >= g.seats ? null : n }, 'Rooms of ' + g.name + ' now hold ' + Math.min(n, g.seats) + '.');
    });
    add(box, st,
      add(el('label'), remix, el('span', '', !g.remixBuilt ? 'Remixable (not in the build)' : g.license === 'no-remix' ? 'Source shared (its licence: not for remixing)' : 'Remixable')),
      add(el('label'), el('span', 'dim', 'Players per room'), max, el('span', 'faint', 'of ' + g.seats), setMax),
      add(el('span', 'faint'), document.createTextNode(g.launchFrom === 'game.json' ? 'state from game.json' : '')));
    return box;
  }

  function invites(g) {
    var box = el('div', 'invites');
    add(box, el('h3', '', 'Invites' + (g.launch === 'invite' ? '' : ' (they work while the game is invite-only)')));
    (g.invites || []).forEach(function (i) {
      var row = el('div', 'inv' + (i.open ? '' : ' closed'));
      add(row, el('code', '', i.code), el('span', '', i.label || 'no label'),
        el('span', 'faint', i.uses + (i.maxUses ? ' of ' + i.maxUses : '') + ' used' + (i.revoked ? ' · revoked' : !i.open ? ' · ended' : '')));
      if (i.open) {
        add(row, btn('Copy link', 'ghost small', function () { (navigator.clipboard ? navigator.clipboard.writeText(i.link) : Promise.reject()).then(function () { toast('Invite link copied'); }, function () { toast(i.link); }); }),
          armed('Revoke', 'bad', function () { act('/_studio/api/invites/revoke', { game: g.id, id: i.id }, 'Invite ' + i.code + ' revoked.'); }));
      }
      box.appendChild(row);
    });
    var label = el('input'); label.type = 'text'; label.placeholder = 'Who it is for (optional)'; label.maxLength = 60;
    var uses = el('select'); [['1', 'one person'], ['10', 'up to 10'], ['100', 'up to 100'], ['any', 'anyone with it']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; uses.appendChild(op); });
    add(box, add(el('div', 'newinv'), label, uses, btn('New invite', 'small', function () {
      post('/_studio/api/invites', { game: g.id, label: label.value, uses: uses.value === 'any' ? 'any' : Number(uses.value) }).then(function (r) {
        if (r && r.ok && r.invites && r.invites[0]) {
          var link = r.invites[0].link; label.value = ''; label.blur();
          (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { toast('Invite ' + r.invites[0].code + ' made, and its link copied.'); }, function () { toast('Invite ' + r.invites[0].code + ': ' + link); });
        } else toast((r && r.message) || 'No invite made.', true);
        load();
      });
    })));
    return box;
  }

  /* ---------------------------------------------------------------- servers and agent seats (0.16.0) */
  var POLICY = { open: 'Open', 'humans-only': 'Humans only', hybrid: 'Hybrid', beginner: 'Beginner' };
  // Each policy's badge and line, the kids line and the dial's card names: the same words the site and the play page say.
  var WORDS = ${JSON.stringify(POLICY_WORDS)};
  var KIDS_LINE = ${JSON.stringify(KIDS_LINE)};
  var CARDS = ${JSON.stringify(SKILLS.map((k) => k.card))};
  var ROOMS_MAX = ${SERVER_LIMITS.roomsMax};
  var BEGINNER_DAYS = ${SERVER_LIMITS.beginnerDays};
  var LEVELS = ['Rookie', 'Steady', 'Fair', 'Strong', 'Maxed'];
  function sel(options, value, label) { var x = el('select'); options.forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; if (String(o[0]) === String(value)) op.selected = true; x.appendChild(op); }); if (label) x.setAttribute('aria-label', label); return x; }
  function num(value, min, max, label) { var x = el('input'); x.type = 'number'; x.min = String(min); x.max = String(max); x.value = String(value); x.setAttribute('aria-label', label); return x; }
  function srvSummary(sv) {
    var bits = [POLICY[sv.policy] + (sv.policy === 'hybrid' ? ' · ' + sv.aiSeats : ''), sv.policy === 'beginner' ? sv.guides + ' guides' : null, sv.kids ? 'kids' : null,
      sv.bots === 'off' ? 'bots off' : 'bots fill', LEVELS[sv.level - 1], sv.door !== 'open' ? 'door: ' + sv.door : null, sv.state !== 'open' ? sv.state.toUpperCase() : null];
    return bits.filter(Boolean).join(' · ');
  }
  /** The owner may narrow a server: a second thought first (a stricter door, humans-only, fewer rooms, closing). */
  function narrowing(sv, f) {
    var rank = { open: 0, accounts: 1, invite: 2 };
    return (f.door && rank[f.door] > rank[sv.door]) || (f.policy && f.policy !== sv.policy && (f.policy === 'humans-only' || f.policy === 'beginner')) || (f.rooms !== undefined && f.rooms < sv.rooms);
  }
  function setServer(g, sv, f, done) {
    if (narrowing(sv, f) && !confirm('This takes something away on ' + sv.name + (f.policy === 'humans-only' ? ': its AI players leave after the current round' : '') + '. Go ahead?')) return;
    act('/_studio/api/servers/set', Object.assign({ game: g.id, server: sv.id }, f), done || sv.name + ' changed.');
  }
  function serverRow(g, sv) {
    var box = el('div', 'srv');
    var key = 'srv:' + g.id + '/' + sv.id;
    var head = el('div', 'srvhead');
    head.onclick = function (e) { if (e.target.closest('button,select,input')) return; S.open[key] = !S.open[key]; render(); };
    var live = sv.live || { rooms: 0, players: 0, ai: 0 };
    add(head, add(el('div'), el('b', '', (S.open[key] ? '▾ ' : '▸ ') + sv.name + (sv.id === 'public' ? ' (public)' : '')), el('div', 'faint', sv.id === 'public' ? 'Quick play' : sv.id)),
      el('div', 'dim', srvSummary(sv)),
      el('div', 'stat', live.rooms ? live.rooms + (live.rooms === 1 ? ' room' : ' rooms') + ' · ' + live.players + ' playing · ' + live.ai + ' AI' : '—'),
      el('div', 'faint', sv.members ? sv.members + ' members' : ''));
    box.appendChild(head);
    if (!S.open[key]) return box;
    var body = el('div', 'srvbody');
    var pol = sel([['open', 'Open'], ['hybrid', 'Hybrid'], ['beginner', 'Beginner'], ['humans-only', 'Humans only']], sv.policy, 'Policy');
    var door = sel([['open', 'Door: anyone'], ['accounts', 'Door: accounts'], ['invite', 'Door: invite']], sv.door, 'Door');
    var bots = sel([['fill', 'Bots fill empty seats'], ['off', 'Bots off']], sv.bots, 'Bots');
    var level = sel(LEVELS.map(function (n, i) { return [i + 1, 'Default ' + n]; }), sv.level, 'Default level');
    var levelMax = sel(LEVELS.map(function (n, i) { return [i + 1, 'Ceiling ' + n]; }), sv.levelMax, 'Ceiling');
    var ai = num(sv.policy === 'beginner' ? sv.guides : sv.aiSeats, 0, 31, sv.policy === 'beginner' ? 'Guides' : 'AI seats');
    add(body, add(el('div', 'line'), pol, door, bots, level, levelMax, el('span', 'faint', sv.policy === 'beginner' ? 'guides' : 'AI seats'), ai,
      btn('Save', 'small', function () {
        var f = {};
        if (pol.value !== sv.policy) f.policy = pol.value;
        if (door.value !== sv.door) f.door = door.value;
        if (bots.value !== sv.bots) f.bots = bots.value;
        if (Number(level.value) !== sv.level) f.level = Number(level.value);
        if (Number(levelMax.value) !== sv.levelMax) f.levelMax = Number(levelMax.value);
        var n = Math.floor(Number(ai.value));
        if ((pol.value === 'beginner' ? 'guides' : 'aiSeats') && n !== (sv.policy === 'beginner' ? sv.guides : sv.aiSeats)) f[pol.value === 'beginner' ? 'guides' : 'aiSeats'] = n;
        if (!Object.keys(f).length) { toast('Nothing changed.'); return; }
        setServer(g, sv, f);
      })));
    add(body, el('div', 'faint', sv.line));
    if (sv.id !== 'public' || sv.state !== 'open') {
      add(body, add(el('div', 'line'), Object.assign(el('a', '', 'Its page'), { href: sv.page, target: '_blank', rel: 'noopener' }),
        sv.state === 'open' ? armed('Close server', 'bad', function () { act('/_studio/api/servers/close', { game: g.id, server: sv.id }, sv.name + ' closes after the current round.'); })
          : btn('Open it again', 'ghost small', function () { act('/_studio/api/servers/close', { game: g.id, server: sv.id, reopen: true }, sv.name + ' is open again.'); })));
    } else add(body, add(el('div', 'line'), armed('Hide Quick play', 'bad', function () { act('/_studio/api/servers/close', { game: g.id, server: 'public' }, 'Quick play is hidden: Play shows the other servers.'); })));
    if (sv.policy !== 'humans-only') {
      var brain = sel([['script', 'Guides: scripted'], ['off', 'Guides: off'], ['workers-ai', 'Guides talk (Workers AI)'], ['owner-key', 'Guides talk (your key)']], sv.brain, 'AI guides');
      add(body, add(el('div', 'line'), el('span', 'dim', 'AI guides\' brain'), brain, btn('Set', 'ghost small', function () {
        if ((brain.value === 'workers-ai' || brain.value === 'owner-key') && !S.data.agentsTalk && !confirm('Let AI guides talk? They speak only the lines the game\'s agents.json gives them, at most one every 8 seconds, never about a person, and any player can quiet them.')) return;
        act('/_studio/api/agents/brain', { game: g.id, server: sv.id, mode: brain.value });
      })));
      // What today's brains used of the day's budget (the whole studio), and what is missing for the one chosen.
      var bd = S.data.brain;
      if (bd && (sv.brain === 'workers-ai' || sv.brain === 'owner-key')) {
        var used = sv.brain === 'workers-ai'
          ? 'Workers AI: ' + Math.round(bd.used.neurons).toLocaleString('en-US') + ' / ' + Math.round(bd.budget.neurons).toLocaleString('en-US') + ' neurons today' + (bd.ai ? '' : ' · not bound yet: deploy once more')
          : 'Your key: $' + bd.used.usd.toFixed(2) + ' / $' + bd.budget.usd.toFixed(2) + ' today' + (bd.key ? '' : ' · no key yet: homie-studio agents brain key');
        add(body, add(el('div', 'line'), el('span', 'faint', used + (g.vocab ? '' : ' · this game has no agents.json: its guides have no words'))));
      }
    }
    if (sv.id !== 'public') {
      var mbox = el('div', 'line'); mbox.appendChild(el('span', 'dim', 'Members:'));
      var showM = btn('Show', 'ghost small', function () {
        fetch('/_studio/api/servers/members?game=' + encodeURIComponent(g.id) + '&server=' + encodeURIComponent(sv.id), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
          mbox.textContent = ''; mbox.appendChild(el('span', 'dim', 'Members:'));
          (d.members || []).forEach(function (m) {
            var who = m.account ? (m.account.handle || m.account.id) : m.player;
            var span = add(el('span', 'chip' + (m.role !== 'member' ? ' owner' : '')), document.createTextNode(who + (m.home ? ' ★' : '') + (m.role !== 'member' ? ' · ' + m.role : '')));
            mbox.appendChild(span);
            if (m.role !== 'mentor') mbox.appendChild(btn('Mentor', 'ghost small', function () { act('/_studio/api/servers/member', { game: g.id, server: sv.id, player: m.player, role: 'mentor', name: who }, who + ' is a mentor of ' + sv.name + '.'); }));
            mbox.appendChild(armed('Remove', 'bad', function () { act('/_studio/api/servers/member', { game: g.id, server: sv.id, player: m.player, remove: true, name: who }, who + ' was removed from ' + sv.name + '.'); }));
          });
          if (!(d.members || []).length) mbox.appendChild(el('span', 'faint', d.ok ? 'nobody yet' : (d.message || 'not available')));
        });
      });
      mbox.appendChild(showM);
      body.appendChild(mbox);
    }
    box.appendChild(body);
    return box;
  }
  /** A server's address from its name, as the Worker makes it (servers.mjs checkServer). */
  function serverId(name) { return String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/, ''); }
  /** A number with − and + beside it, labelled; onset gets every change. */
  function stepper(id, value, min, max, label, onset) {
    var box = el('div', 'stepper');
    var input = el('input'); input.type = 'number'; input.id = id; input.inputMode = 'numeric'; input.min = String(min); input.max = String(max); input.value = String(value);
    var show = function (v) { var n = Math.max(Number(input.min), Math.min(Number(input.max), Math.round(Number(v)) || 0)); input.value = String(n); less.disabled = n <= Number(input.min); more.disabled = n >= Number(input.max); return n; };
    var set = function (v) { onset(show(v)); };
    var less = btn('−', 'ghost small', function () { set(Number(input.value) - 1); }); less.setAttribute('aria-label', 'Fewer ' + label);
    var more = btn('+', 'ghost small', function () { set(Number(input.value) + 1); }); more.setAttribute('aria-label', 'More ' + label);
    input.onchange = function () { set(input.value); };
    less.disabled = value <= min; more.disabled = value >= max;
    add(box, less, input, more);
    // sync: the value and its bounds as the form now has them (no onset: update() is what calls it).
    return { box: box, input: input, sync: function (v, lo, hi) { input.min = String(lo); input.max = String(hi); return show(v); } };
  }
  /** One choice of a few, as the office's pill switch; each option is a real radio button. */
  function segment(name, options, value, label, onset) {
    var box = el('div', 'seg'); box.setAttribute('role', 'radiogroup'); box.setAttribute('aria-label', label);
    var inputs = {};
    options.forEach(function (o) {
      var r = el('input'); r.type = 'radio'; r.name = name; r.value = o[0]; r.checked = o[0] === value;
      r.onchange = function () { if (r.checked) onset(o[0]); };
      inputs[o[0]] = r;
      box.appendChild(add(el('label'), r, el('span', '', o[1])));
    });
    return { box: box, inputs: inputs };
  }
  /** A 1-5 dial in the vote card's names, with what the chosen level plays like. */
  function dialOf(id, value, label, onset) {
    var box = el('div', 'dial');
    var range = el('input'); range.type = 'range'; range.id = id; range.min = '1'; range.max = '5'; range.step = '1'; range.value = String(value);
    var out = el('output'); out.setAttribute('for', id);
    var ticks = el('div', 'ticks'); ticks.setAttribute('aria-hidden', 'true');
    var show = function () {
      var n = Number(range.value); var top = Number(range.max);
      out.textContent = ''; add(out, el('b', '', LEVELS[n - 1]), document.createTextNode(': ' + CARDS[n - 1]));
      range.setAttribute('aria-valuetext', LEVELS[n - 1]);
      ticks.textContent = ''; ticks.style.setProperty('--n', String(top));
      for (var i = 0; i < top; i++) ticks.appendChild(el('span', '', LEVELS[i]));
    };
    range.oninput = function () { show(); onset(Number(range.value)); };
    range.setAttribute('aria-label', label);
    show();
    add(box, range, ticks, out);
    return { box: box, range: range, set: function (n, top) { range.max = String(top); range.value = String(Math.min(n, top)); show(); } };
  }
  function row(label, forId, control, help) {
    var r = el('div', 'frow');
    var l = forId ? el('label', '', label) : el('span', 'lbl', label); if (forId) l.htmlFor = forId;
    add(r, l, add(el('div', 'ctl'), control, help));
    return r;
  }
  /**
   * The New server form (DESIGN 7.2): name; policy, with each badge's copy; AI seats or guides (capped at the room's
   * seats less one) and kids, for the policies that have them; the level it starts at and its ceiling, in the vote
   * card's names; who can come in; chat; rooms; listed. Only what applies to the chosen policy shows. What the owner
   * set lives in S.drafts, so the office's redraw every few seconds never loses it. It creates at once.
   */
  function newServer(g) {
    var key = 'new:' + g.id;
    var wrap = el('div');
    if (!S.open[key]) { wrap.appendChild(btn('+ New server', 'small', function () { S.open[key] = true; S.focusNew = key; render(); })); return wrap; }
    var seats = Math.max(2, Number(g.maxPlayers) || Number(g.seats) || 2);
    var cap = seats - 1;
    var d = S.drafts[key] || (S.drafts[key] = { name: '', policy: 'hybrid', aiSeats: Math.min(2, cap), guides: Math.min(2, cap), kids: false, door: 'open', level: 3, levelMax: 5, levelSet: false, speech: 'game', rooms: 4, listed: true });
    var id = 'ns-' + g.id + '-';
    var form = el('form', 'newsrv'); form.noValidate = true; form.setAttribute('aria-label', 'New server for ' + g.name);
    add(form, el('h4', '', 'New server for ' + g.name));

    // Name, and the address it makes.
    var name = el('input'); name.type = 'text'; name.id = id + 'name'; name.placeholder = 'Night Shift'; name.maxLength = 40; name.value = d.name; name.autocomplete = 'off';
    var nameHelp = el('p', 'help');
    add(form, row('Name', name.id, name, nameHelp));

    // Policy: four cards, each with its badge and its line.
    var pf = add(el('fieldset'), el('legend', '', 'Who plays'));
    var cards = el('div', 'policies'); cards.setAttribute('role', 'radiogroup'); cards.setAttribute('aria-label', 'Policy');
    var pol = {};
    ['hybrid', 'beginner', 'humans-only', 'open'].forEach(function (p) {
      var r = el('input'); r.type = 'radio'; r.name = id + 'policy'; r.value = p; r.checked = d.policy === p;
      var badge = el('b'); var line = el('span');
      var card = add(el('label', 'policy'), r, badge, line);
      r.onchange = function () { if (!r.checked) return; d.policy = p; if (!d.levelSet) d.level = p === 'beginner' ? 2 : 3; update(); };
      pol[p] = { input: r, card: card, badge: badge, line: line };
      cards.appendChild(card);
    });
    add(form, add(pf, cards));

    // AI in every room: seats (hybrid) or guides and kids (beginner); a plain note for the other two.
    var af = add(el('fieldset'), el('legend', '', 'AI in every room'));
    var aiHelp = el('p', 'help');
    var ai = stepper(id + 'ai', d.policy === 'beginner' ? d.guides : d.aiSeats, d.policy === 'hybrid' ? 1 : 0, cap, 'AI seats', function (n) { if (d.policy === 'beginner') d.guides = n; else d.aiSeats = n; update(); });
    var aiLabel = el('label', '', 'AI seats'); aiLabel.htmlFor = id + 'ai';
    var aiRow = add(el('div', 'frow'), aiLabel, add(el('div', 'ctl'), ai.box, aiHelp));
    var kids = el('input'); kids.type = 'checkbox'; kids.id = id + 'kids'; kids.checked = d.kids;
    kids.onchange = function () { d.kids = kids.checked; update(); };
    var kidsRow = row('Kids', null, add(el('label', 'check'), kids, el('span', '', 'A server for kids')), el('p', 'help', KIDS_LINE + ' The AI plays at Fair or gentler, and chat stays quick lines only.'));
    var aiNote = el('p', 'note');
    add(form, add(af, aiRow, kidsRow, aiNote));

    // The AI's level: where it starts and how high the party may vote it.
    var lf = add(el('fieldset'), el('legend', '', 'AI level'));
    var lvl = dialOf(id + 'level', d.level, 'Starts at', function (n) { d.level = n; d.levelSet = true; if (levels().max < n) d.levelMax = n; update(); });
    var top = dialOf(id + 'ceiling', d.levelMax, 'Ceiling', function (n) { d.levelMax = n; if (d.level > n) { d.level = n; d.levelSet = true; } update(); });
    /** The level and ceiling as the server gets them: a kids server keeps both at Fair or gentler. */
    function levels() { var cap = d.policy === 'beginner' && d.kids ? 3 : 5; var max = Math.min(d.levelMax, cap); return { cap: cap, max: max, level: Math.min(d.level, max) }; }
    add(form, add(lf,
      row('Starts at', id + 'level', lvl.box, null),
      row('Ceiling', id + 'ceiling', top.box, el('p', 'help', 'Before play the party votes how strong the AI should be (the middle vote wins), never above the ceiling. Only games whose bots read the dial change how they play.'))));

    // Who can come in: the door, how many rooms, and whether it is listed.
    var df = add(el('fieldset'), el('legend', '', 'Who can come in'));
    var DOOR_HELP = { open: 'Anyone with the link plays.', accounts: 'Players sign in with a passkey first.', invite: 'Only people with an invite to this server. Ask your AI for invite links.' };
    var doorHelp = el('p', 'help');
    var door = segment(id + 'door', [['open', 'Anyone'], ['accounts', 'Accounts'], ['invite', 'Invite only']], d.door, 'Door', function (v) { d.door = v; update(); });
    var rooms = stepper(id + 'rooms', d.rooms, 1, ROOMS_MAX, 'rooms', function (n) { d.rooms = n; update(); });
    var roomsHelp = el('p', 'help');
    var listed = el('input'); listed.type = 'checkbox'; listed.id = id + 'listed'; listed.checked = d.listed;
    listed.onchange = function () { d.listed = listed.checked; update(); };
    var listedHelp = el('p', 'help');
    add(form, add(df,
      row('Door', null, door.box, doorHelp),
      row('Rooms', id + 'rooms', rooms.box, roomsHelp),
      row('Listed', null, add(el('label', 'check'), listed, el('span', '', 'Show it to everyone')), listedHelp)));

    // Chat.
    var cf = add(el('fieldset'), el('legend', '', 'Chat'));
    var CHAT_HELP = { game: 'Players chat the way the game lets them.', lines: 'Only the game\'s quick lines: nobody types.', off: 'No chat at all.' };
    var chatHelp = el('p', 'help');
    var chat = segment(id + 'chat', [['game', 'The game\'s chat'], ['lines', 'Quick lines only'], ['off', 'Off']], d.speech, 'Chat', function (v) { d.speech = v; update(); });
    add(form, add(cf, row('Chat', null, chat.box, chatHelp)));

    var create = btn('Create', '', function () {});
    create.type = 'submit';
    var close = function () { S.open[key] = false; if (document.activeElement) document.activeElement.blur(); render(); };
    add(form, add(el('div', 'acts'), create, btn('Cancel', 'ghost', close), el('span', 'faint', 'It opens at once; you can change any of it later.')));
    name.oninput = function () { d.name = name.value; update(); };

    function update() {
      var p = d.policy;
      var n = p === 'beginner' ? d.guides : d.aiSeats;
      // Each card says its own badge and line; Hybrid's with the seats chosen.
      Object.keys(pol).forEach(function (k) {
        var w = WORDS[k];
        pol[k].badge.textContent = w.badge + (k === 'hybrid' ? ' · ' + d.aiSeats : '');
        var line = w.line.replace('{n}', String(d.aiSeats)).replace(/^[^:]+: /, '');
        pol[k].line.textContent = line.charAt(0).toUpperCase() + line.slice(1) + (k === 'beginner' && d.kids ? ' ' + KIDS_LINE : '');
        pol[k].card.classList.toggle('on', k === p);
      });
      // The name and the address it makes.
      var sid = serverId(d.name);
      var nameOk = /[A-Za-z0-9À-￿]/.test(d.name) && sid.length >= 2 && sid !== 'public';
      nameHelp.textContent = '';
      if (!d.name.trim()) nameHelp.textContent = 'Players see it on ' + g.name + '\'s page and on the play page.';
      else if (!nameOk) nameHelp.textContent = 'Use at least two letters or digits (and not "public").';
      else add(nameHelp, document.createTextNode('Its page: '), el('b', '', '/' + g.id + '/s/' + sid + '/'));
      // AI in every room.
      n = ai.sync(n, p === 'hybrid' ? 1 : 0, cap);
      if (p === 'beginner') d.guides = n; else if (p === 'hybrid') d.aiSeats = n;
      aiLabel.textContent = p === 'beginner' ? 'AI guides' : 'AI seats';
      aiRow.hidden = !(p === 'hybrid' || p === 'beginner');
      kidsRow.hidden = p !== 'beginner';
      aiHelp.textContent = p === 'hybrid'
        ? n + ' of the ' + seats + ' seats in every room ' + (n === 1 ? 'is an AI companion' : 'are AI companions') + ', always marked AI; people take the other ' + (seats - n) + '. At least one seat is always a person\'s.'
        : n + ' guide seat' + (n === 1 ? '' : 's') + ' in every room, marked AI, beside new players. The game\'s own bots play them; guides talk only once you say yes.';
      aiNote.hidden = !(p === 'humans-only' || p === 'open');
      aiNote.textContent = p === 'humans-only'
        ? 'No AI can join, not even one with a pass. The game\'s practice bots are off; you can switch them on later.'
        : 'No seats are kept for AI. An AI with an agent pass may sit, always marked AI, and the game\'s bots fill empty seats.';
      // The level: no AI on a humans-only server; kids keep it at Fair or gentler.
      lf.hidden = p === 'humans-only';
      var L = levels();
      lvl.set(L.level, L.cap); top.set(L.max, L.cap);
      // The door.
      doorHelp.textContent = DOOR_HELP[d.door] + (p === 'beginner' ? ' New players only: an account older than ' + BEGINNER_DAYS + ' days is shown another server, unless you made that player a mentor.' : '');
      d.rooms = rooms.sync(d.rooms, 1, ROOMS_MAX);
      roomsHelp.textContent = 'Up to ' + d.rooms + (d.rooms === 1 ? ' room' : ' rooms') + ' at once. When ' + (d.rooms === 1 ? 'it is' : 'they are all') + ' full, newcomers wait for a seat.';
      listedHelp.textContent = d.listed ? 'On ' + g.name + '\'s page, its servers list and the room lists.' : 'Left out of the lists: only people with its link find it.';
      // Chat: a beginner server keeps chat to quick lines (or off).
      var chatNow = p === 'beginner' && d.speech === 'game' ? 'lines' : d.speech;
      chat.inputs.game.parentNode.hidden = p === 'beginner';
      Object.keys(chat.inputs).forEach(function (k) { chat.inputs[k].checked = k === chatNow; });
      chatHelp.textContent = CHAT_HELP[chatNow] + (p === 'beginner' ? ' A beginner server keeps chat to quick lines.' : '');
      create.disabled = !nameOk;
    }
    form.onsubmit = function (e) {
      e.preventDefault();
      update();
      if (create.disabled) { name.focus(); return; }
      var p = d.policy;
      var L = levels();
      var body = { game: g.id, name: d.name, policy: p, door: d.door, level: L.level, levelMax: L.max, speech: p === 'beginner' && d.speech === 'game' ? 'lines' : d.speech, rooms: d.rooms, listed: d.listed };
      if (p === 'hybrid') body.aiSeats = d.aiSeats;
      if (p === 'beginner') { body.guides = d.guides; body.kids = d.kids; }
      create.disabled = true;
      act('/_studio/api/servers', body, d.name + ' is open.').then(function (r) {
        if (r && r.ok) { delete S.drafts[key]; close(); } else create.disabled = false;
      });
    };
    update();
    wrap.appendChild(form);
    if (S.focusNew === key) { S.focusNew = null; setTimeout(function () { name.focus(); }, 0); }
    return wrap;
  }
  function passes(g) {
    var box = el('div', 'servers');
    add(box, el('h3', '', 'Agent passes (an AI\'s way into a seat, always marked AI)'));
    (g.passes || []).forEach(function (p) {
      var row = el('div', 'inv' + (p.live ? '' : ' closed'));
      add(row, el('code', '', p.name), el('span', 'faint', p.role + ' · hands ' + p.hands + (p.server ? ' · ' + p.server : ' · any server') + (p.expiresAt ? ' · until ' + new Date(p.expiresAt).toLocaleDateString() : '') + (p.revoked ? ' · revoked' : !p.live ? ' · ended' : '')));
      if (p.live) row.appendChild(armed('Revoke', 'bad', function () { act('/_studio/api/agents/pass', { action: 'revoke', game: g.id, id: p.id }, 'Pass revoked: that AI left.'); }));
      box.appendChild(row);
    });
    var label = el('input'); label.type = 'text'; label.placeholder = 'Its name (Claude)'; label.maxLength = 16;
    var server = sel([['', 'any server that lets AI in']].concat((g.servers || []).filter(function (x) { return x.policy !== 'humans-only'; }).map(function (x) { return [x.id, x.name]; })), '', 'Server');
    var hands = sel([['self', 'runs the game itself'], ['host', 'moved by the host\'s bots']], 'self', 'Hands');
    var out = el('div');
    add(box, add(el('div', 'newinv'), label, server, hands, btn('Issue a pass', 'small', function () {
      post('/_studio/api/agents/pass', { action: 'create', game: g.id, label: label.value, server: server.value || null, hands: hands.value, days: 7 }).then(function (r) {
        out.textContent = '';
        if (!r || !r.ok) { toast((r && r.message) || 'No pass made.', true); return; }
        add(out, el('p', 'dim', 'Shown once. Give it to the AI only; it plays as ' + r.pass.name + ' for 7 days.'), el('div', 'secret', r.secret));
        label.value = ''; S.keep = true;
      });
    })), out);
    var fill = el('input', 'switch'); fill.type = 'checkbox'; fill.disabled = true; fill.setAttribute('aria-label', 'Fill-a-spot service');
    add(box, add(el('label', 'faint'), fill, el('span', '', (S.data.fillSpot && S.data.fillSpot.note) || 'Let a fill-a-spot service seat AI (coming later)')));
    return box;
  }
  function serversBox(g) {
    var box = el('div', 'servers');
    add(box, el('h3', '', 'Servers'));
    (g.servers || []).forEach(function (sv) { box.appendChild(serverRow(g, sv)); });
    box.appendChild(newServer(g));
    return box;
  }

  function person(g, r, c, now) {
    var row = el('div', 'person');
    var who = el('div', 'who');
    add(who, el('b', '', c.name || 'Someone'),
      c.seat !== null && c.seat !== undefined ? el('span', 'faint', 'seat ' + (c.seat + 1)) : el('span', 'faint', c.waiting ? 'waiting for a seat' : 'watching'),
      el('span', 'chip', c.device === 'phone' ? 'phone' : c.device === 'tv' ? 'big screen' : 'computer'),
      c.role === 'host' ? el('span', 'chip host', 'host') : null,
      c.agent ? el('span', 'chip ai', 'AI ' + (c.agent.role === 'guide' ? 'guide' : c.agent.role === 'party' ? 'companion' : 'player')) : c.as === 'owner' ? el('span', 'chip owner', 'you') : c.as === 'invited' ? el('span', 'chip invited', 'invited') : c.account ? el('span', 'chip owner', 'player ' + (c.account.handle || c.account.id)) : el('span', 'chip', 'guest'),
      c.muted ? el('span', 'chip muted', 'muted') : null,
      el('span', 'faint', 'here ' + dur(now - c.joinedAt)),
      c.browser ? el('span', 'faint', 'browser ' + c.browser) : null);
    var acts = el('div', 'pacts');
    if (c.as !== 'owner') {
      acts.appendChild(c.muted
        ? btn('Unmute', 'ghost small', function () { act('/_studio/api/mute', { game: g.id, room: r.room, id: c.id, off: true }, (c.name || 'They') + ' can talk again.'); })
        : btn('Mute', 'warn small', function () { act('/_studio/api/mute', { game: g.id, room: r.room, id: c.id, minutes: hold() }, (c.name || 'They') + ' is muted for ' + hold() + ' min.'); }));
      acts.appendChild(armed('Kick', 'bad', function () { act('/_studio/api/kick', { game: g.id, room: r.room, id: c.id, minutes: hold() }, (c.name || 'They') + ' was removed from ' + r.label + ' for ' + hold() + ' min.'); }));
    }
    return add(row, who, acts);
  }

  function room(g, r, now) {
    var box = el('div', 'room');
    var key = g.id + '/' + r.room;
    var head = el('div', 'rhead');
    head.onclick = function (e) { if (e.target.closest('button,select')) return; S.open[key] = !S.open[key]; render(); };
    var round = r.round ? 'Round ' + (r.round.n || '?') + (r.round.phase === 'live' && r.round.endsAt ? ' · ' + clock(r.round.endsAt - now) + ' left' : r.round.phase === 'over' ? ' · results' : '') : 'no round yet';
    var announce = btn('Announce', 'ghost small', function () {
      var text = prompt('Announce to everyone in ' + r.label + ' of ' + g.name + ':');
      if (text) act('/_studio/api/announce', { game: g.id, room: r.room, text: text }, 'Announced in ' + r.label + '.');
    });
    var acts = add(el('div', 'racts'), announce, r.closedUntil
      ? btn('Reopen', 'ghost small', function () { act('/_studio/api/close', { game: g.id, room: r.room, reopen: true }, r.label + ' is open again.'); })
      : armed('Close', 'bad', function () { act('/_studio/api/close', { game: g.id, room: r.room, minutes: hold() }, r.label + ' closed for ' + hold() + ' min.'); }));
    // The room's dial (room_level): the owner sets it at once, as the party's vote does.
    var lvl = r.policy ? sel([1, 2, 3, 4, 5].filter(function (n) { return n <= (r.policy.levelMax || 5); }).map(function (n) { return [n, LEVELS[n - 1]]; }), r.policy.level, 'AI level') : null;
    if (lvl) lvl.onchange = function () { act('/_studio/api/room-level', { game: g.id, room: r.room, level: Number(lvl.value) }, 'AI in ' + r.label + ' set to ' + LEVELS[Number(lvl.value) - 1] + '.'); };
    var srvName = ((g.servers || []).filter(function (x) { return x.id === r.server; })[0] || {}).name;
    add(head,
      add(el('div'), el('b', '', (S.open[key] ? '▾ ' : '▸ ') + r.label), el('div', 'faint', (r.server && r.server !== 'public' ? (srvName || r.server) + ' · ' : '') + (r.public ? 'public room' : r.server !== 'public' ? 'server room' : 'named room'))),
      add(el('div', 'stat'), el('span', '', 'players'), document.createTextNode((r.players) + ' / ' + (r.humanSeats || r.max))),
      add(el('div', 'stat'), el('span', '', 'AI · bots'), document.createTextNode((r.ai || 0) + ' · ' + String(r.bots)), lvl ? add(el('div'), lvl) : null),
      add(el('div', 'stat'), el('span', '', 'round'), document.createTextNode(round)),
      add(el('div', 'stat'), el('span', '', 'up'), document.createTextNode(r.closedUntil ? 'closed ' + dur(r.closedUntil - now) : dur(now - r.openedAt))),
      acts);
    box.appendChild(head);
    if (r.announce && r.announce.text) box.appendChild(el('div', 'held', '📣 "' + r.announce.text + '" (' + dur(r.announce.until - now) + ' left)'));
    if (r.regate) box.appendChild(el('div', 'held', 'After this round (at the latest in ' + dur(r.regate.until - now) + '), players the new launch state leaves out are sent out with a thank-you.'));
    if (S.open[key] !== false && (S.open[key] || r.players + r.screens <= 12)) {
      S.open[key] = true;
      var people = el('div', 'people');
      (r.clients || []).forEach(function (c) { people.appendChild(person(g, r, c, now)); });
      var bots = (r.slots || []).filter(function (s) { return s.bot; });
      if (bots.length) people.appendChild(el('div', 'held', 'AI and bots: ' + bots.map(function (s) { return s.name + (s.agent ? ' (AI ' + (s.agent.role === 'guide' ? 'guide' : 'seat') + ')' : ''); }).join(', ')));
      if (r.vote && r.vote.open) people.appendChild(el('div', 'held', 'The party is voting on the AI\'s level: ' + r.vote.voters + ' of ' + r.vote.of_total + ' voted.'));
      // The house guides' brains: which one runs (and why not), and their last few decisions (ids only, never words).
      if (r.brains) {
        var last = (r.brains.decisions || []).filter(function (x) { return x.goal || x.say; }).slice(-4).reverse().map(function (x) { return 'seat ' + (x.seat + 1) + ': ' + (x.goal ? x.goal + (x.args && Object.keys(x.args).length ? ' ' + Object.keys(x.args).map(function (k) { return x.args[k]; }).join(' ') : '') : 'no change') + (x.say ? ', said ' + x.say : '') + ' (' + x.provider + (x.ms ? ', ' + (x.ms / 1000).toFixed(1) + ' s' : '') + ', ' + dur(now - x.at) + ' ago)'; });
        people.appendChild(el('div', 'held', 'Guides\' brain: ' + (r.brains.brain || 'script') + (r.brains.why ? ' · ' + r.brains.why : '') + ' · ' + r.brains.calls + ' calls' + (last.length ? ' · ' + last.join('; ') : '')));
      }
      (r.bans || []).forEach(function (b) { people.appendChild(el('div', 'held', 'Kicked: ' + (b.name || 'someone') + ', may come back in ' + dur(b.until - now) + (b.address ? ' (their network too)' : ''))); });
      box.appendChild(people);
    }
    return box;
  }

  function render() {
    var d = S.data;
    if (!d) return;
    var now = Date.now() - (S.skew || 0);
    liveEl.textContent = d.playing ? d.playing + (d.playing === 1 ? ' playing now' : ' playing now') : 'nobody playing right now';
    document.getElementById('livedot').className = 'dot' + (d.playing ? ' on' : '');
    var at = document.activeElement;
    var focus = at && root.contains(at) && (/INPUT|SELECT/.test(at.tagName) || Boolean(at.closest && at.closest('.newsrv')));
    // Never redraw under a typing owner (or one working in the New server form), a control waiting for its second
    // tap, or a pass secret shown once.
    if (focus || root.querySelector('[data-armed="1"]') || root.querySelector('.secret')) return;
    root.textContent = '';
    if (!d.games.length) { root.appendChild(el('p', 'empty', 'This studio has no games yet.')); return; }
    d.games.forEach(function (g) {
      var card = el('section', 'game'); card.id = 'game-' + g.id;
      var head = el('div', 'ghead');
      add(head, add(el('div', 'name'), el('h2', '', g.name), el('span', 'faint', g.playing ? g.playing + ' playing' : 'quiet')),
        add(el('div', 'links'), Object.assign(el('a', '', 'Play'), { href: g.play, target: '_blank', rel: 'noopener' }), Object.assign(el('a', '', 'Page'), { href: g.page, target: '_blank', rel: 'noopener' })));
      add(card, head, gameSettings(g));
      // A build from before servers (netplay rev 5 or older): what it cannot do yet, and the fix.
      if (g.build && g.build.predates && (g.servers || []).some(function (x) { return x.id !== 'public' && (x.aiSeats || x.guides); })) card.appendChild(el('div', 'warnbox', 'This build predates servers (netplay rev ' + (g.build.netplayRev || '5 or older') + '): reserved AI seats stay empty and its bots don\'t read the dial. Rebuild with @homie-rocks/studio 0.16.'));
      card.appendChild(serversBox(g));
      card.appendChild(passes(g));
      if (g.launch === 'invite' || (g.invites && g.invites.length)) card.appendChild(invites(g));
      var rooms = el('div', 'rooms');
      if (!g.rooms.length) rooms.appendChild(el('div', 'empty', g.launch === 'private' ? 'Private: only you can open it. Nobody is in a room.' : 'Nobody is in a room right now.'));
      g.rooms.forEach(function (r) { rooms.appendChild(room(g, r, now)); });
      card.appendChild(rooms);
      root.appendChild(card);
    });
  }

  function load() {
    if (S.busy) return;
    S.busy = true;
    fetch('/_studio/api/office', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      S.busy = false;
      if (!d || !d.ok) { S.err++; document.getElementById('status').textContent = (d && d.message) || 'The office did not answer.'; return; }
      S.err = 0; document.getElementById('status').textContent = '';
      S.skew = Date.now() - d.now;
      S.data = d; window.__office = d; render();
    }).catch(function () { S.busy = false; S.err++; document.getElementById('status').textContent = 'The studio did not answer; trying again.'; });
  }
  function tick() { if (document.visibilityState !== 'hidden') load(); S.timer = setTimeout(tick, Math.min(30000, 3000 * Math.pow(2, Math.min(S.err, 3)))); }
  document.getElementById('announce-all').onsubmit = function (e) {
    e.preventDefault();
    var input = document.getElementById('announce-text');
    var scope = document.getElementById('announce-scope').value;
    if (!input.value.trim()) return;
    act('/_studio/api/announce', scope ? { game: scope, text: input.value } : { text: input.value }, 'Announced.').then(function () { input.value = ''; });
  };
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(); });
  tick();
}());`;

let scriptHash = null;
async function officeScriptHash() {
  if (!scriptHash) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(OFFICE_SCRIPT));
    scriptHash = `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
  }
  return scriptHash;
}

function shell(cat, title, body, { status = 200, script = null, extra = {} } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title><style>:root{--accent:${accentOf(cat)}}${CSS}</style></head><body><div class="wrap">${body}</div>${script ? `<script>${script}</script>` : ''}</body></html>`;
}

/** The owner's live office. `headers` may carry the session carried over to / (a session from before 0.13.0). */
export async function officePage(cat, headers = {}) {
  const name = cat.studio?.name ?? 'Studio';
  const options = (cat.games ?? []).map((g) => `<option value="${esc(g.id)}">every room of ${esc(g.name)}</option>`).join('');
  const body = `<header class="top"><h1>${esc(name)} <small>Office</small></h1>
<div class="links"><span class="live"><i class="dot" id="livedot"></i><span id="live">…</span></span><a href="/_studio/stats">Stats</a>
<form method="post" action="/_studio/signout" style="display:inline"><button class="ghost small" type="submit">Sign out</button></form></div></header>
<form class="bar" id="announce-all"><label for="announce-text">Announce</label><input type="text" id="announce-text" maxlength="280" placeholder="A line every player sees, in the game" autocomplete="off">
<select id="announce-scope" aria-label="Who sees it"><option value="">every room of every game</option>${options}</select><button type="submit">Send</button>
<label for="hold" style="margin-left:auto">Kick, mute and close for</label><select id="hold"><option value="5">5 min</option><option value="10" selected>10 min</option><option value="30">30 min</option><option value="60">1 hour</option><option value="1440">a day</option></select></form>
<p class="dim" id="status" role="status"></p>
<div id="games" aria-live="polite"><p class="empty">Reading the rooms…</p></div>
<div class="toast" id="toast" role="status" hidden></div>
<p class="note">Servers: each game's named room pools. Open: anyone, AI with a pass marked AI. Humans only: no AI at all. Hybrid: some seats in every room are AI companions; the party votes their level. Beginner: new players, AI guides, quick lines only. Changing a server reaches its live rooms at once; AI leave after the round when a server becomes humans-only.</p>
<p class="note">Live from this studio's own rooms, every few seconds. A kick holds that player out of that room for the time you pick (their browser, and their account once players sign in); a mute stops their chat and emotes; Close sends everyone in a room out with a thank-you. Private: only you can open the game. Invite-only: invited players only (each invite link or code lets a browser in). Public: anyone, and listed. A game that is not public leaves the Homie directory the next time it reads this studio. This page is yours alone, never cached or indexed.</p>`;
  return new Response(shell(cat, `Office · ${name}`, body, { script: OFFICE_SCRIPT }), {
    headers: {
      ...PRIVATE, ...headers,
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src '${await officeScriptHash()}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}

/** What anyone but the owner gets at /_studio/office or a confirm link. */
export function lockedPage(cat, { what = 'office', ask = null } = {}) {
  const name = cat.studio?.name ?? 'Studio';
  const link = what === 'confirm' && ask ? `npx --no-install homie-studio office link --to /_studio/confirm/${ask}` : 'npx --no-install homie-studio office link';
  const body = `<h1>${esc(name)} <small>${what === 'confirm' ? 'Confirm' : 'Office'}</small></h1>
<p class="dim">${what === 'confirm' ? 'Your AI asked for something only the studio\'s owner can say yes to.' : 'The office is for the studio\'s owner only.'}</p>
<p class="note">Sign this browser in first: ask your AI, in the studio's folder, to run <code>${esc(link)}</code>. It uses the studio's own Cloudflare login and gives a one-time link for this browser${what === 'confirm' ? ' that comes straight back here' : ''}.</p>`;
  return new Response(shell(cat, `${what === 'confirm' ? 'Confirm' : 'Office'} · private`, body), { status: 401, headers: { ...PRIVATE, 'content-security-policy': NO_SCRIPT_CSP } });
}

const VERB = { kick: 'Kick', mute: 'Mute', close: 'Close the room', announce: 'Announce', game: 'Change it', 'server-set': 'Change it', 'server-close': 'Close it', member: 'Remove', 'agents-brain': 'Let them talk' };

/** The owner's one tap for what their AI asked, and what came of it. */
export function confirmPage(cat, ask, { missing = false } = {}) {
  const name = cat.studio?.name ?? 'Studio';
  let body;
  if (missing || !ask) {
    body = `<h1>Nothing to confirm</h1><p class="dim">That ask is not here: asks last 15 minutes. Your AI can ask again.</p><p><a href="/_studio/office">Open the office</a></p>`;
  } else if (ask.state === 'pending') {
    const verb = ask.action?.op === 'mute' && ask.action.off ? 'Unmute' : ask.action?.op === 'close' && ask.action.reopen ? 'Open it again' : VERB[ask.action?.op] ?? 'Yes';
    body = `<h1>${esc(name)} <small>Your AI asks</small></h1>
<p style="font-size:19px;line-height:1.45;max-width:46ch">${esc(ask.what)}</p>
<form method="post" class="bar" style="background:transparent;border:0;padding:0"><button type="submit" name="do" value="yes" class="${['kick', 'close', 'server-close', 'member'].includes(ask.action?.op) && !ask.action?.reopen ? 'armed' : ''}">${esc(verb)}</button><button type="submit" name="do" value="no" class="ghost">No</button></form>
<p class="note">Only you can confirm this: your AI asked through the studio's office key, which cannot say yes. It lasts until ${esc(new Date(ask.expiresAt).toISOString().slice(11, 16))} UTC.</p>`;
  } else {
    const said = { done: 'Done.', failed: 'That did not work.', cancelled: 'Not done: you said no.', expired: 'This ask ran out (15 minutes). Your AI can ask again.', working: 'Working on it…' }[ask.state] ?? ask.state;
    const result = ask.result && !ask.result.ok && ask.result.message ? ` ${ask.result.message}` : '';
    body = `<h1>${esc(said)}</h1><p class="dim">${esc(ask.what)}${esc(result)}</p><p><a href="/_studio/office">Open the office</a></p>`;
  }
  // One panel, thumb-sized buttons: this page is often opened on the owner's phone from a chat.
  const panel = `<div class="game" style="max-width:560px;margin:8vh auto 0;padding:22px 20px">${body.replace(/<button /g, '<button style="min-height:48px;padding:0 24px;font-size:16px" ')}</div>`;
  return new Response(shell(cat, `Confirm · ${name}`, panel), { status: missing ? 404 : 200, headers: { ...PRIVATE, 'content-security-policy': NO_SCRIPT_CSP } });
}
