/**
 * The back office's pages (worker/office.mjs has the rules): the owner's live office (/_studio/office), the page
 * where the owner confirms what their AI asked (/_studio/confirm/<ask>), and the page anyone else gets.
 *
 * The office is one document and one script, inline, allowed by its hash (no other script, nothing from anywhere
 * else, connect only to this site). Everything a player typed is set as text, never as markup. Never cached,
 * never indexed, never framed.
 */
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
@media (max-width: 720px) {
  .rhead { grid-template-columns: 1fr 1fr 1fr; }
  .rhead .racts { grid-column: 1 / -1; justify-content: flex-start; }
  .person { grid-template-columns: 1fr; }
}
`;

/* The office's one script (allowed by its hash). It reads /_studio/api/office every 3 s while the page is visible. */
export const OFFICE_SCRIPT = String.raw`(function () {
  'use strict';
  var S = { data: null, open: {}, busy: false, err: 0, timer: null };
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
      add(el('label'), remix, el('span', '', g.remixBuilt ? 'Remixable' : 'Remixable (not in the build)')),
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

  function person(g, r, c, now) {
    var row = el('div', 'person');
    var who = el('div', 'who');
    add(who, el('b', '', c.name || 'Someone'),
      c.seat !== null && c.seat !== undefined ? el('span', 'faint', 'seat ' + (c.seat + 1)) : el('span', 'faint', c.waiting ? 'waiting for a seat' : 'watching'),
      el('span', 'chip', c.device === 'phone' ? 'phone' : c.device === 'tv' ? 'big screen' : 'computer'),
      c.role === 'host' ? el('span', 'chip host', 'host') : null,
      c.as === 'owner' ? el('span', 'chip owner', 'you') : c.as === 'invited' ? el('span', 'chip invited', 'invited') : c.account ? el('span', 'chip owner', 'player ' + (c.account.handle || c.account.id)) : el('span', 'chip', 'guest'),
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
    head.onclick = function (e) { if (e.target.closest('button')) return; S.open[key] = !S.open[key]; render(); };
    var round = r.round ? 'Round ' + (r.round.n || '?') + (r.round.phase === 'live' && r.round.endsAt ? ' · ' + clock(r.round.endsAt - now) + ' left' : r.round.phase === 'over' ? ' · results' : '') : 'no round yet';
    var announce = btn('Announce', 'ghost small', function () {
      var text = prompt('Announce to everyone in ' + r.label + ' of ' + g.name + ':');
      if (text) act('/_studio/api/announce', { game: g.id, room: r.room, text: text }, 'Announced in ' + r.label + '.');
    });
    var acts = add(el('div', 'racts'), announce, r.closedUntil
      ? btn('Reopen', 'ghost small', function () { act('/_studio/api/close', { game: g.id, room: r.room, reopen: true }, r.label + ' is open again.'); })
      : armed('Close', 'bad', function () { act('/_studio/api/close', { game: g.id, room: r.room, minutes: hold() }, r.label + ' closed for ' + hold() + ' min.'); }));
    add(head,
      add(el('div'), el('b', '', (S.open[key] ? '▾ ' : '▸ ') + r.label), el('div', 'faint', r.public ? 'public room' : 'named room')),
      add(el('div', 'stat'), el('span', '', 'players'), document.createTextNode((r.players) + ' / ' + r.max)),
      add(el('div', 'stat'), el('span', '', 'bots'), document.createTextNode(String(r.bots))),
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
      if (bots.length) people.appendChild(el('div', 'held', 'Bots: ' + bots.map(function (s) { return s.name; }).join(', ')));
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
    var focus = document.activeElement && root.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName);
    // Never redraw under a typing owner, or a control waiting for its second tap; the next poll will.
    if (focus || root.querySelector('[data-armed="1"]')) return;
    root.textContent = '';
    if (!d.games.length) { root.appendChild(el('p', 'empty', 'This studio has no games yet.')); return; }
    d.games.forEach(function (g) {
      var card = el('section', 'game'); card.id = 'game-' + g.id;
      var head = el('div', 'ghead');
      add(head, add(el('div', 'name'), el('h2', '', g.name), el('span', 'faint', g.playing ? g.playing + ' playing' : 'quiet')),
        add(el('div', 'links'), Object.assign(el('a', '', 'Play'), { href: g.play, target: '_blank', rel: 'noopener' }), Object.assign(el('a', '', 'Page'), { href: g.page, target: '_blank', rel: 'noopener' })));
      add(card, head, gameSettings(g));
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

const VERB = { kick: 'Kick', mute: 'Mute', close: 'Close the room', announce: 'Announce', game: 'Change it' };

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
<form method="post" class="bar" style="background:transparent;border:0;padding:0"><button type="submit" name="do" value="yes" class="${['kick', 'close'].includes(ask.action?.op) && !ask.action?.reopen ? 'armed' : ''}">${esc(verb)}</button><button type="submit" name="do" value="no" class="ghost">No</button></form>
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
