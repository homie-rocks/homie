/**
 * THE LOUNGE'S PAGE (@homie-rocks/studio 0.29.0, chat/LOUNGE.md): /lounge/ in the studio's own look (worker/site.mjs
 * layout). One column of talk on a phone, with "What's on" a tap away; the talk and a sidebar (the next play night, live
 * rooms, show what you made, how it works) on a computer. The page's script is /_homie/lounge.js (the site's CSP allows
 * no inline script): the room's own watch socket (NETPLAY.md section 19), the float, a passkey sign-in in place, cards,
 * reports, a person's own Delete, and the keepers' Remove, Mute, Kick and slow mode.
 *
 * Names, lines and cards are always text (textContent) and links are built from checked https addresses, never markup.
 */
import { REACTIONS } from './chat.mjs';
import { REPORT_REASONS, REPORT_WORDS } from './chat-store.mjs';
import { PASSKEY_JS } from './account-page.mjs';
import { esc, icon, layout } from './site.mjs';
import { breadcrumbs } from './schema.mjs';
import { STUDIO_VERSION_TAG } from './version.mjs';

const jsonScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const CSS = `
body[data-page="lounge"] main{display:block}
body[data-page="lounge"] .foot{display:none}
.lg{max-width:1260px;margin:0 auto;padding:clamp(10px,2vw,22px) max(var(--gutter),16px) 0;display:grid;grid-template-columns:minmax(0,1fr);gap:22px}
.lg-tabs{display:none}
.lg-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:6px 2px 14px;border-bottom:1px solid var(--line)}
.lg-head h1{margin:0;font:800 clamp(30px,4.4vw,52px)/1 var(--display);letter-spacing:-.025em}
.lg-head p{margin:8px 0 0;max-width:62ch;color:var(--soft);font-size:16px}
.lg-here{display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;background:var(--panel);border:1px solid var(--line);font:600 13px/1 var(--text);color:var(--soft);white-space:nowrap}
.lg-here i{width:8px;height:8px;border-radius:50%;background:#3ddc84;box-shadow:0 0 10px #3ddc84}
.lg-here.off i{background:var(--dim);box-shadow:none}
.lg-chat{display:flex;flex-direction:column;min-width:0;min-height:calc(100dvh - var(--top-h) - 24px)}
.lg-feed{list-style:none;margin:0;padding:10px 0 34px;flex:1;display:flex;flex-direction:column;gap:2px}
.lg-more{align-self:center;margin:6px 0 10px;min-height:40px;padding:0 16px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--soft);font:600 14px/1 var(--text);cursor:pointer}
.lg-day{align-self:center;margin:14px 0 6px;padding:4px 12px;border-radius:999px;background:var(--panel);font:600 12px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}
.lg-empty{margin:auto;padding:36px 10px;text-align:center;color:var(--dim);max-width:44ch}
.lg-empty b{display:block;margin-bottom:6px;color:var(--fg);font:800 22px/1.2 var(--display)}
.ln{position:relative;display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:2px 12px;padding:8px 10px;border-radius:14px}
.ln:hover,.ln:focus-within{background:color-mix(in srgb,var(--fg) 4%,transparent)}
.ln.me{background:color-mix(in srgb,var(--hot) 7%,transparent)}
.ln.cont{padding-top:1px}
.ln.cont .av,.ln.cont .who{display:none}
.ln.cont .body{grid-column:2}
.av{grid-row:span 2;width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font:800 16px/1 var(--display);color:#0b0b0f;background:var(--hot)}
.who{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0}
.who b{font:700 15px/1.3 var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:24ch}
.who time{font:500 12px/1 var(--mono);color:var(--dim)}
.tag{padding:2px 7px;border-radius:999px;font:700 10.5px/1.5 var(--mono);letter-spacing:.06em;text-transform:uppercase;background:color-mix(in srgb,var(--fg) 10%,transparent);color:var(--soft)}
.tag.owner{background:color-mix(in srgb,var(--hot) 26%,transparent);color:var(--fg)}
.tag.mod{background:color-mix(in srgb,#3ddc84 22%,transparent);color:var(--fg)}
.tag.hub{background:transparent;border:1px solid var(--line)}
.body{grid-column:2;min-width:0;font-size:16px;line-height:1.5;overflow-wrap:anywhere;color:var(--fg)}
.body.react{font-size:15px;color:var(--dim)}
.body.react span{font-size:22px;vertical-align:-3px;margin-left:4px}
.body.quick{font-style:italic;color:var(--soft)}
.ln.studio .body{font-weight:600}
.ln.studio .av{background:var(--fg);color:var(--bg)}
.ln-x{grid-row:1;grid-column:3;align-self:start;width:34px;height:34px;border-radius:10px;border:0;background:transparent;color:var(--dim);cursor:pointer;opacity:0;font:700 18px/1 var(--text)}
.ln:hover .ln-x,.ln:focus-within .ln-x,.ln-x[aria-expanded="true"]{opacity:1}
@media (hover:none){.ln-x{opacity:.6}}
.ln-menu{position:absolute;right:8px;top:40px;z-index:6;display:flex;flex-direction:column;min-width:190px;padding:6px;border-radius:14px;background:var(--bg);border:1px solid var(--line);box-shadow:0 18px 50px rgba(0,0,0,.4)}
.ln-menu button{min-height:42px;padding:0 12px;border:0;border-radius:10px;background:transparent;color:var(--fg);font:600 15px/1 var(--text);text-align:left;cursor:pointer}
.ln-menu button:hover,.ln-menu button:focus-visible{background:var(--panel)}
.ln-menu button.bad{color:#ff8a80}
.ln-menu p{margin:6px 10px;font-size:13px;color:var(--dim)}
.mcard{display:grid;grid-template-columns:minmax(0,1fr);margin-top:8px;max-width:520px;border-radius:var(--r);overflow:hidden;background:var(--panel);border:1px solid var(--line);text-decoration:none;color:inherit}
.mcard .pic{aspect-ratio:16/9;background:linear-gradient(135deg,color-mix(in srgb,var(--hot) 40%,var(--bg)),var(--panel));background-size:cover;background-position:center}
.mcard .pic img{width:100%;height:100%;object-fit:cover}
.mcard .txt{padding:12px 14px 14px}
.mcard .kick{margin:0;font:700 11px/1.4 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--glow-ink)}
.mcard h3{margin:4px 0 2px;font:800 20px/1.2 var(--display)}
.mcard p{margin:0;color:var(--soft);font-size:14.5px}
.mcard .go{display:inline-flex;align-items:center;gap:8px;margin-top:10px;min-height:38px;padding:0 14px;border-radius:999px;background:var(--hot);color:var(--hot-ink);font:700 14px/1 var(--text)}
.lg-compose{position:sticky;bottom:0;z-index:5;margin:0 -6px;padding:10px 6px calc(env(safe-area-inset-bottom,0px) + 12px);background:var(--bg)}
.lg-compose::before{content:"";position:absolute;left:0;right:0;top:-22px;height:22px;background:linear-gradient(to top,var(--bg),color-mix(in srgb,var(--bg) 0%,transparent));pointer-events:none}
.lg-reacts{display:flex;gap:8px;flex-wrap:wrap}
.lg-reacts button{width:46px;height:46px;border-radius:50%;border:1px solid var(--line);background:var(--panel);font-size:22px;line-height:1;cursor:pointer;transition:transform .12s}
.lg-reacts button:active,.lg-reacts button.pop{transform:scale(1.18)}
.lg-lines{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;margin-top:10px;padding-bottom:2px}
.lg-lines::-webkit-scrollbar{display:none}
.lg-lines button{flex:none;min-height:40px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--soft);font:600 14px/1 var(--text);cursor:pointer;white-space:nowrap}
.lg-lines button:hover{color:var(--fg);border-color:color-mix(in srgb,var(--fg) 30%,transparent)}
.lg-type{display:flex;gap:10px;align-items:center;margin-top:10px}
.lg-type input{flex:1;min-width:0;min-height:50px;padding:0 16px;border-radius:16px;border:1px solid var(--line);background:var(--panel);color:var(--fg);font:500 16px/1 var(--text)}
.lg-type input:focus{outline:2px solid var(--hot);outline-offset:1px}
.lg-type button,.lg-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:50px;padding:0 18px;border-radius:16px;border:0;background:var(--hot);color:var(--hot-ink);font:700 15px/1 var(--text);cursor:pointer;text-decoration:none;white-space:nowrap}
.lg-btn.lg-ghost{background:transparent;color:var(--fg);border:1px solid color-mix(in srgb,var(--fg) 26%,transparent)}
.lg-btn.lg-sm{min-height:40px;padding:0 14px;border-radius:12px;font-size:14px}
.lg-sign{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:10px;padding:12px;border-radius:16px;background:var(--panel);border:1px solid var(--line)}
.lg-sign p{flex:1 1 220px;margin:0;color:var(--soft);font-size:14.5px}
.lg-note{min-height:1.4em;margin:8px 2px 0;font:600 13.5px/1.4 var(--text);color:var(--dim)}
.lg-note.bad{color:#ff8a80}
.lg-note.good{color:#8fe3a8}
.lg-ban{margin:10px 0 0;padding:12px 14px;border-radius:14px;background:color-mix(in srgb,#ff8a80 14%,var(--panel));font-weight:600}
.lg-float{position:fixed;inset:0;pointer-events:none;z-index:4}
.lg-side{display:flex;flex-direction:column;gap:16px;padding-bottom:24px}
.sc{padding:16px 16px 18px;border-radius:var(--r);background:var(--panel);border:1px solid var(--line)}
.sc h2{margin:0 0 4px;font:800 18px/1.25 var(--display)}
.sc .k{margin:0 0 8px;font:700 11px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--glow-ink)}
.sc p{margin:6px 0 0;color:var(--soft);font-size:14.5px}
.night .when{margin-top:6px;font:700 15px/1.4 var(--text)}
.night .count{display:inline-block;margin-top:10px;padding:6px 12px;border-radius:999px;background:color-mix(in srgb,var(--hot) 20%,transparent);font:700 13px/1.2 var(--mono);letter-spacing:.04em}
.night .count.on{background:#3ddc84;color:#06210f}
.night .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.night ul{list-style:none;margin:14px 0 0;padding:12px 0 0;border-top:1px solid var(--line)}
.night li{display:flex;justify-content:space-between;gap:10px;padding:5px 0;font-size:14px;color:var(--soft)}
.rooms-l{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
.rooms-l li{display:grid;grid-template-columns:56px minmax(0,1fr);gap:4px 12px;align-items:center}
.rooms-l .th{grid-row:span 2;width:56px;height:56px;border-radius:12px;background:linear-gradient(135deg,color-mix(in srgb,var(--hot) 45%,var(--bg)),var(--bg));background-size:cover;background-position:center}
.rooms-l b{font:700 14.5px/1.3 var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rooms-l span{font-size:13px;color:var(--dim)}
.rooms-l li.empty{display:block;font-size:14px;color:var(--dim)}
.rooms-l .ra{grid-column:2;display:flex;gap:8px;margin-top:4px}
.rooms-l .ra a{display:inline-flex;align-items:center;min-height:34px;padding:0 12px;border-radius:999px;font:700 13px/1 var(--text);text-decoration:none;border:1px solid var(--line);color:var(--fg)}
.rooms-l .ra a.j{background:var(--hot);color:var(--hot-ink);border-color:transparent}
.how ul{margin:8px 0 0;padding-left:18px;color:var(--soft);font-size:14px}
.how li{margin:5px 0}
.keep{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.keep select{min-height:40px;padding:0 10px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:600 14px/1 var(--text)}
dialog.lg-dlg{width:min(520px,calc(100vw - 24px));padding:0;border:1px solid var(--line);border-radius:22px;background:var(--bg);color:var(--fg);box-shadow:0 30px 90px rgba(0,0,0,.55)}
dialog.lg-dlg::backdrop{background:rgba(0,0,0,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
.lg-dlg form{padding:22px}
.lg-dlg h2{margin:0;font:800 24px/1.2 var(--display)}
.lg-dlg p{margin:8px 0 0;color:var(--soft);font-size:14.5px}
.lg-dlg label{display:block;margin-top:16px;font:600 13px/1.4 var(--text);color:var(--dim)}
.lg-dlg input,.lg-dlg textarea{box-sizing:border-box;width:100%;margin-top:6px;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:var(--panel);color:var(--fg);font:500 16px/1.4 var(--text)}
.lg-dlg textarea{min-height:76px;resize:vertical}
.lg-dlg .row{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;margin-top:18px}
.lg-dlg .reasons{display:flex;flex-direction:column;gap:8px;margin-top:14px}
.lg-dlg .reasons button{min-height:46px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--fg);font:600 15px/1 var(--text);text-align:left;cursor:pointer}
@media (min-width:960px){
  .lg{grid-template-columns:minmax(0,1fr) 360px;gap:28px}
  .lg-side{position:sticky;top:calc(var(--top-h) + 14px);align-self:start;max-height:calc(100dvh - var(--top-h) - 28px);overflow:auto;padding-top:6px;scrollbar-width:thin}
}
@media (max-width:959px){
  .lg{padding:0 12px;gap:0}
  .lg-tabs{display:flex;position:sticky;top:var(--lg-top,var(--top-h));z-index:6;gap:6px;margin:0 -12px;padding:8px 12px;background:color-mix(in srgb,var(--bg) 88%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
  .lg-tabs button{flex:1;min-height:44px;border-radius:12px;border:1px solid transparent;background:transparent;color:var(--soft);font:700 15px/1 var(--text);cursor:pointer}
  .lg-tabs button[aria-selected="true"]{background:var(--panel);color:var(--fg);border-color:var(--line)}
  .lg-tabs button b{display:inline-block;min-width:20px;margin-left:6px;padding:2px 6px;border-radius:999px;background:var(--hot);color:var(--hot-ink);font:700 11px/1.3 var(--mono)}
  .lg[data-tab="chat"] .lg-side{display:none}
  .lg[data-tab="on"] .lg-chat{display:none}
  .lg-side{padding-top:14px}
  .lg-head{padding-top:12px}
  .lg-head h1{font-size:30px}
  .lg-head p{font-size:15px}
  .lg-chat{min-height:calc(100dvh - var(--top-h) - 62px)}
  .lg-reacts{flex-wrap:nowrap;justify-content:space-between}
  .lg-reacts button{width:44px;height:44px}
  .ln{padding:8px 4px;grid-template-columns:34px minmax(0,1fr) auto;gap:2px 10px}
  .av{width:34px;height:34px;border-radius:10px;font-size:14px}
}
@media (prefers-reduced-motion:reduce){.lg-reacts button{transition:none}}
`;

/** The page. `who` is the signed-in account (or nobody), `rules` the Lounge's public chat rules, `nights` its play nights. */
export function loungePage(cat, { origin = '', who = {}, rules = {}, nights = [] } = {}) {
  const L = cat.studio?.lounge ?? {};
  const studio = cat.studio?.name ?? 'Studio';
  const boot = {
    v: 1, studio, name: L.name ?? 'The Lounge', socket: '/lounge/__watch', account: '/account/',
    me: { signedIn: Boolean(who.acct), name: who.name ?? null, owner: Boolean(who.owner), mod: Boolean(who.mod), player: who.player ?? null },
    rules, nights, reactions: REACTIONS, reasons: REPORT_REASONS.map((k) => ({ k, text: REPORT_WORDS[k] })), kids: Boolean(L.kids), featured: L.featured ?? 'directory',
  };
  const next = nights[0] ?? null;
  const keeps = rules.history > 0 ? `kept for ${rules.history} ${rules.history === 1 ? 'day' : 'days'}` : 'gone after a few minutes';
  const main = `
<div class="lg" data-tab="chat" data-lounge>
  <div class="lg-tabs" role="tablist" aria-label="${esc(boot.name)}">
    <button type="button" role="tab" aria-selected="true" data-tab-to="chat">Chat</button>
    <button type="button" role="tab" aria-selected="false" data-tab-to="on">What's on${nights.length ? `<b>${esc(nights.length)}</b>` : ''}</button>
  </div>
  <section class="lg-chat" aria-labelledby="lg-title">
    <header class="lg-head">
      <div><h1 id="lg-title">${esc(boot.name)}</h1><p>${esc(L.blurb ?? '')}</p></div>
      <span class="lg-here off" data-here><i></i><span>Joining…</span></span>
    </header>
    <ol class="lg-feed" data-feed aria-live="polite" aria-label="Messages"><li class="lg-empty"><b>Getting the Lounge…</b>One moment.</li></ol>
    <div class="lg-compose" data-compose>
      <div class="lg-reacts" data-reacts aria-label="Reactions"></div>
      <div class="lg-lines" data-lines aria-label="Quick lines"></div>
      <div data-typing></div>
      <p class="lg-note" data-note role="status"></p>
    </div>
  </section>
  <aside class="lg-side" aria-label="What's on">
    <section class="sc night" data-night>
      <p class="k">${icon('calendar')} Play night</p>
      ${next ? `<h2>${esc(next.title)}</h2><p class="when" data-when="${esc(next.at)}">${esc(new Date(next.at).toUTCString().replace(/:00 GMT$/, ' UTC'))}</p>` : `<h2>No play night set yet</h2><p>When the studio sets one, it shows here with your own time.</p>`}
    </section>
    <section class="sc" data-live><p class="k">${icon('eye')} Live now</p><h2>Rooms you can join</h2><ul class="rooms-l" data-rooms><li><span>Reading the rooms…</span></li></ul></section>
    <section class="sc" data-show-card><p class="k">${icon('spark')} Show what you made</p><h2>Made a game with Homie?</h2><p>Post its link: it shows as a card with its picture, and people can play it from here.</p><div class="keep"><button type="button" class="lg-btn lg-sm" data-show>${icon('plus')} Show it</button></div></section>
    <section class="sc how"><p class="k">${icon('lounge')} How it works</p>
      <ul>
        <li>Reactions and quick lines are for everyone.${rules.mode === 'text' ? ` Typing is for ${rules.who === 'anyone' ? 'anyone' : 'people signed in with a passkey (no password, no email)'}.` : ''}</li>
        <li>Every typed message is checked before anyone sees it.</li>
        <li>What's said is <b data-keeps>${esc(keeps)}</b>. Take your own messages down any time; report anything that isn't okay.</li>
        <li>Nobody here will ever ask your age, where you live or for photos. If they do, report it.</li>
      </ul>
      <div class="keep" data-keep hidden></div>
    </section>
  </aside>
</div>
<canvas class="lg-float" data-float aria-hidden="true"></canvas>
<dialog class="lg-dlg" data-show-dlg><form method="dialog" data-show-form>
  <h2>Show what you made</h2><p>Paste the link to your game (its page or its Play). It must be a Homie studio's game.</p>
  <label for="lg-url">Link</label><input id="lg-url" name="url" type="url" inputmode="url" required placeholder="https://your-studio.example/your-game/" autocomplete="off">
  <label for="lg-say">Say something about it (optional)</label><textarea id="lg-say" name="note" maxlength="200" placeholder="What it is, what's new, what you want people to try"></textarea>
  <p class="lg-note" data-show-note role="status"></p>
  <div class="row"><button type="button" class="lg-btn lg-ghost lg-sm" data-close>Cancel</button><button type="submit" class="lg-btn lg-sm" value="post">Post it</button></div>
</form></dialog>
<dialog class="lg-dlg" data-report-dlg><form method="dialog"><h2>Report this message</h2><p>The studio sees this one message and the reason. They never see who reported it.</p><div class="reasons" data-reasons></div><div class="row"><button type="button" class="lg-btn lg-ghost lg-sm" data-close>Cancel</button></div></form></dialog>
<script type="application/json" id="lounge-boot">${jsonScript(boot)}</script>
<script src="/_homie/lounge.js?v=${STUDIO_VERSION_TAG}" defer></script>`;
  return layout(cat, {
    title: `${boot.name} · ${studio}`, description: L.blurb ?? '', origin, path: '/lounge/', active: 'lounge', page: 'lounge',
    head: `<style>${CSS}</style>`, main, ld: [breadcrumbs(origin, [['Home', '/'], [boot.name, '/lounge/']])],
    extraHeaders: { 'cache-control': 'private, no-store' },
  });
}

/** The page's script: the passkey half of the account page, then the Lounge. Plain ES2017, no framework. */
export const LOUNGE_JS = `${PASSKEY_JS}\n${String.raw`(function () {
  'use strict';
  var bootEl = document.getElementById('lounge-boot');
  if (!bootEl) return;
  var B = JSON.parse(bootEl.textContent || '{}');
  var root = document.querySelector('[data-lounge]');
  var feed = document.querySelector('[data-feed]');
  var note = document.querySelector('[data-note]');
  var hereEl = document.querySelector('[data-here]');
  var reactsEl = document.querySelector('[data-reacts]');
  var linesEl = document.querySelector('[data-lines]');
  var typingEl = document.querySelector('[data-typing]');
  var canvas = document.querySelector('[data-float]');
  var me = B.me || {};
  var rules = B.rules || {};
  var lines = [];
  var mine = {};
  var ws = null, stopped = false, retry = 0, seq = 0, held = null, more = rules.history > 0, rulesKey = null;
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
  function add(p) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) p.appendChild(arguments[i]); return p; }
  function hue(s) { var h = 2166136261; s = String(s || ''); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h % 360; }
  function rnd() { var a = new Uint8Array(18); crypto.getRandomValues(a); return btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  var bkey = null;
  try { bkey = localStorage.getItem('homie-b'); if (!/^[A-Za-z0-9_-]{16,43}$/.test(bkey || '')) { bkey = rnd(); localStorage.setItem('homie-b', bkey); } } catch (e) { bkey = rnd(); }
  function say(text, kind) { note.textContent = text || ''; note.className = 'lg-note' + (kind ? ' ' + kind : ''); if (text) { clearTimeout(say.t); say.t = setTimeout(function () { if (note.textContent === text) note.textContent = ''; }, 6000); } }
  function post(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, message: 'The Lounge answered ' + r.status + '.' }; }); });
  }
  function https(u) { return typeof u === 'string' && /^https?:\/\/[^\s]{4,400}$/.test(u) && (u.indexOf('https://') === 0 || /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) ? u : null; }

  /* ---------------------------------------------------------------- tabs (a phone) */
  Array.prototype.forEach.call(document.querySelectorAll('[data-tab-to]'), function (b) {
    b.addEventListener('click', function () {
      root.setAttribute('data-tab', b.getAttribute('data-tab-to'));
      Array.prototype.forEach.call(document.querySelectorAll('[data-tab-to]'), function (o) { o.setAttribute('aria-selected', o === b ? 'true' : 'false'); });
      window.scrollTo(0, b.getAttribute('data-tab-to') === 'chat' ? document.body.scrollHeight : 0);
    });
  });

  /* ---------------------------------------------------------------- the float (the room's own: six a second, eighteen at once) */
  var ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  var parts = [], spent = [], raf = 0;
  function paint(t) {
    raf = 0;
    if (!ctx) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = innerWidth, h = innerHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var box = feed.getBoundingClientRect();
    var left = Math.max(0, box.left), right = Math.min(w, box.right);
    var size = Math.max(26, Math.min(44, h * 0.05));
    ctx.font = size + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    parts = parts.filter(function (p) { return t - p.at < 2400; });
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], age = (t - p.at) / 2400;
      if (age < 0) continue;
      ctx.globalAlpha = Math.min(1, age * 8) * (1 - age);
      ctx.fillText(p.glyph, left + (right - left) * p.x + Math.sin(age * 5) * p.sway * 26, h * (0.86 - age * 0.55));
    }
    ctx.globalAlpha = 1;
    if (parts.length) raf = requestAnimationFrame(paint);
  }
  function burst(glyph) {
    if (!glyph || reduced || !ctx) return;
    var t = performance.now();
    spent = spent.filter(function (s) { return s > t - 1000; });
    if (spent.length >= 6 || parts.length >= 18) return;
    spent.push(t);
    parts.push({ glyph: glyph, at: t, x: 0.12 + Math.random() * 0.76, sway: Math.random() * 2 - 1 });
    if (!raf) raf = requestAnimationFrame(paint);
  }

  /* ---------------------------------------------------------------- the feed */
  var timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  var dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  function dayOf(at) { var d = new Date(at); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function dayWord(at) {
    var now = new Date(); var d = new Date(at);
    if (dayOf(at) === dayOf(now.getTime())) return 'Today';
    if (dayOf(at) === dayOf(now.getTime() - 86400000)) return 'Yesterday';
    return dayFmt.format(d);
  }
  function isMine(m) { return Boolean(m.mine || (m.n && mine[m.n])); }
  function keeper() { return Boolean(me.owner || me.mod); }
  var open = null;
  function closeMenu() { if (open) { open.menu.remove(); open.btn.setAttribute('aria-expanded', 'false'); open = null; } }
  document.addEventListener('click', function (e) { if (open && !open.menu.contains(e.target) && e.target !== open.btn) closeMenu(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
  function menuFor(m, li, btn) {
    if (open && open.btn === btn) { closeMenu(); return; }
    closeMenu();
    var menu = el('div', 'ln-menu'); menu.setAttribute('role', 'menu');
    var item = function (label, cls, fn) { var b = el('button', cls || '', label); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.onclick = function () { closeMenu(); fn(); }; menu.appendChild(b); };
    var own = isMine(m);
    if (own) item('Delete my message', 'bad', function () { if (me.signedIn) post('/lounge/api/delete', { id: m.id }).then(function (r) { if (!r || !r.ok) say((r && r.message) || 'That did not work.', 'bad'); }); else send({ t: 'unsay', id: m.id }); });
    if (!own && m.by !== 'studio') item('Report', '', function () { report(m); });
    if (keeper() && m.by !== 'studio' && !own) {
      item('Remove from the Lounge', '', function () { mod({ op: 'remove', line: m.id }); });
      item('Mute for 10 min', '', function () { mod({ op: 'mute', line: m.id, minutes: 10 }); });
      item(me.owner ? 'Kick for a day' : 'Kick for an hour', 'bad', function () { if (confirm('Kick ' + m.name + ' out of the Lounge for ' + (me.owner ? 'a day' : 'an hour') + '? Their messages come down too.')) mod({ op: 'kick', line: m.id, minutes: me.owner ? 1440 : 60 }); });
    } else if (keeper() && m.by === 'studio') item('Remove from the Lounge', '', function () { mod({ op: 'remove', line: m.id }); });
    if (!menu.children.length) menu.appendChild(el('p', '', 'Nothing to do with this one.'));
    li.appendChild(menu);
    btn.setAttribute('aria-expanded', 'true');
    open = { menu: menu, btn: btn };
    var first = menu.querySelector('button'); if (first) first.focus();
  }
  function cardEl(c) {
    var url = https(c.url);
    var a = el(url ? 'a' : 'div', 'mcard');
    if (url) { a.href = url; a.rel = 'nofollow ugc noopener'; a.target = '_blank'; }
    var pic = el('div', 'pic');
    var img = https(c.image);
    if (img) { var i = el('img'); i.src = img; i.alt = ''; i.decoding = 'async'; i.referrerPolicy = 'no-referrer'; i.onerror = function () { i.remove(); }; pic.appendChild(i); }
    var txt = el('div', 'txt');
    add(txt, el('p', 'kick', c.studio ? 'Made by ' + c.studio : 'Made with Homie'), el('h3', '', c.title || 'A game'), c.pitch ? el('p', '', c.pitch) : null, url ? el('span', 'go', 'Play it') : null);
    return add(a, pic, txt);
  }
  function lineEl(m, prev) {
    var li = el('li', 'ln' + (m.by === 'studio' ? ' studio' : '') + (isMine(m) ? ' me' : ''));
    li.setAttribute('data-id', m.id);
    var cont = prev && prev.t === 'line' && m.t === 'line' && prev.name === m.name && prev.by === m.by && !m.card && !prev.card && m.at - prev.at < 5 * 60000 && dayOf(prev.at) === dayOf(m.at);
    if (cont) li.classList.add('cont');
    var who = m.by === 'studio' ? B.studio : m.name || 'Someone';
    var av = el('span', 'av', String(who).trim().charAt(0).toUpperCase() || '·');
    if (m.by !== 'studio') av.style.background = 'oklch(.78 .13 ' + hue(who) + ')';
    av.setAttribute('aria-hidden', 'true');
    var head = el('div', 'who');
    var name = el('b', '', who);
    if (m.by !== 'studio') name.style.color = 'oklch(.84 .12 ' + hue(who) + ')';
    var time = el('time', '', timeFmt.format(new Date(m.at))); time.dateTime = new Date(m.at).toISOString(); time.title = new Date(m.at).toLocaleString();
    add(head, name, m.owner && m.by !== 'studio' ? el('span', 'tag owner', 'Owner') : null, m.mod ? el('span', 'tag mod', 'Mod') : null, m.by === 'hub' ? el('span', 'tag hub', 'on homie.rocks') : null, isMine(m) ? el('span', 'tag', 'You') : null, time);
    var body;
    if (m.t === 'react') { body = el('div', 'body react', 'reacted'); body.appendChild(el('span', '', m.glyph || '')); }
    else if (m.card) { body = el('div', 'body'); if (m.text && !/^Made: /.test(m.text)) body.appendChild(el('div', '', m.text)); body.appendChild(cardEl(m.card)); }
    else body = el('div', 'body' + (m.say ? ' quick' : ''), m.text || '');
    var x = el('button', 'ln-x', '⋯'); x.type = 'button'; x.setAttribute('aria-label', 'More for this message'); x.setAttribute('aria-haspopup', 'menu'); x.setAttribute('aria-expanded', 'false');
    x.onclick = function (e) { e.stopPropagation(); menuFor(m, li, x); };
    add(li, av, head, body, m.t === 'react' ? null : x);
    return li;
  }
  function render(keepBottom) {
    var stick = keepBottom || (window.innerHeight + window.scrollY >= document.body.scrollHeight - 140);
    closeMenu();
    feed.textContent = '';
    if (more) { var b = el('button', 'lg-more', 'Earlier messages'); b.type = 'button'; b.onclick = earlier; feed.appendChild(b); }
    if (!lines.length) {
      var e = el('li', 'lg-empty'); add(e, el('b', '', 'Quiet in here.'), document.createTextNode(rules.mode === 'off' ? 'The Lounge is closed for now.' : 'Say hi, or send a reaction: it floats up everyone\'s screen.'));
      feed.appendChild(e);
    }
    var prev = null, lastDay = null;
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i];
      var d = dayOf(m.at);
      if (d !== lastDay) { feed.appendChild(el('li', 'lg-day', dayWord(m.at))); lastDay = d; prev = null; }
      feed.appendChild(lineEl(m, prev));
      prev = m;
    }
    if (stick) toBottom();
  }
  function toBottom() {
    var go = function () { window.scrollTo(0, document.documentElement.scrollHeight); };
    requestAnimationFrame(go); setTimeout(go, 160);
  }
  function nearBottom() { return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160; }
  function earlier() {
    var before = lines.length ? lines[0].at : Date.now();
    fetch('/lounge/api/history?before=' + encodeURIComponent(before), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var got = (j && j.lines) || [];
      var have = {}; lines.forEach(function (l) { have[l.id] = 1; });
      lines = got.filter(function (l) { return !have[l.id]; }).concat(lines);
      more = Boolean(j && j.more);
      var h = document.body.scrollHeight;
      render(false);
      window.scrollTo(0, window.scrollY + (document.body.scrollHeight - h));
    }).catch(function () { say('The earlier messages did not load.', 'bad'); });
  }

  /* ---------------------------------------------------------------- what may be sent, and how */
  function allowed(kind) {
    var rank = { off: 0, emoji: 1, lines: 2, text: 3 }[rules.mode] || 0;
    var need = kind === 'text' ? rules.who : rules.react;
    var mode = kind === 'react' ? rank >= 1 : kind === 'line' ? rank >= 2 : rank >= 3;
    if (!mode) return false;
    if (me.owner) return true;
    if (need === 'signed-in' || need === 'members') return Boolean(me.signedIn);
    return true;
  }
  function paintCompose() {
    reactsEl.textContent = ''; linesEl.textContent = ''; typingEl.textContent = '';
    if (held) { typingEl.appendChild(el('p', 'lg-ban', held)); return; }
    (rules.emoji || B.reactions || []).forEach(function (r) {
      var b = el('button', '', r.e); b.type = 'button'; b.setAttribute('aria-label', 'React ' + r.k); b.disabled = !allowed('react');
      b.onclick = function () { if (send({ t: 'react', kind: r.k })) { burst(r.e); b.classList.add('pop'); setTimeout(function () { b.classList.remove('pop'); }, 160); } };
      reactsEl.appendChild(b);
    });
    reactsEl.hidden = !allowed('react');
    if (allowed('line')) (rules.lines || []).forEach(function (l) { var b = el('button', '', l.text); b.type = 'button'; b.onclick = function () { send({ t: 'say', say: l.id }); }; linesEl.appendChild(b); });
    linesEl.hidden = !linesEl.children.length;
    var rank = { off: 0, emoji: 1, lines: 2, text: 3 }[rules.mode] || 0;
    if (rank >= 3 && allowed('text')) {
      var form = el('form', 'lg-type'); form.setAttribute('autocomplete', 'off');
      var input = el('input'); input.type = 'text'; input.maxLength = rules.max || 280; input.placeholder = 'Say something to the Lounge'; input.setAttribute('aria-label', 'Message'); input.enterKeyHint = 'send';
      var go = el('button', '', 'Send'); go.type = 'submit';
      form.onsubmit = function (e) { e.preventDefault(); var t = input.value.trim(); if (!t) return; if (send({ t: 'say', text: t })) { input.value = ''; } };
      add(typingEl, add(form, input, go));
    } else if (rank >= 3 && !me.signedIn) {
      var box = el('div', 'lg-sign');
      var p = el('p', '', 'Sign in with a passkey to type and to show what you made. No password, no email: your phone or computer unlocks it.');
      var si = el('button', 'lg-btn lg-sm', 'Sign in'); si.type = 'button';
      var su = el('button', 'lg-btn lg-ghost lg-sm', 'Make a passkey'); su.type = 'button';
      si.onclick = function () { passkey('in'); }; su.onclick = function () { passkey('up'); };
      add(typingEl, add(box, p, si, su));
    } else if (rules.mode === 'off') typingEl.appendChild(el('p', 'lg-sign', 'The Lounge is closed for now.'));
  }
  function passkey(kind) {
    if (!window.homiePasskey || !homiePasskey.supported()) { location.href = B.account + '?next=/lounge/'; return; }
    say(kind === 'in' ? 'Waiting for your passkey…' : 'Making your passkey…');
    var p = kind === 'in' ? homiePasskey.signIn() : homiePasskey.signUp(prompt('The name people see in the Lounge (you can change it later):', '') || undefined);
    p.then(function () { say('Signed in.', 'good'); location.reload(); }, function (e) { say(homiePasskey.said ? homiePasskey.said(e) : (e && e.message) || 'That did not work.', 'bad'); });
  }
  var waiting = null;
  function send(m) {
    seq += 1;
    var n = 'l' + seq + Math.random().toString(36).slice(2, 6);
    var frame = JSON.stringify(Object.assign({}, m, { n: n }));
    mine[n] = 1;
    // Said a moment before the Lounge is connected (a page just opened, a phone waking up): it goes as soon as it is.
    if (!ws || ws.readyState !== 1) { if (stopped) return false; waiting = frame; say('Connecting to the Lounge…'); return true; }
    try { ws.send(frame); return true; } catch (e) { return false; }
  }
  function mod(body) {
    post('/lounge/api/mod', body).then(function (r) { say((r && r.message) || (r && r.ok ? 'Done.' : 'That did not work.'), r && r.ok ? 'good' : 'bad'); });
  }

  /* ---------------------------------------------------------------- report */
  var repDlg = document.querySelector('[data-report-dlg]');
  function report(m) {
    var box = repDlg.querySelector('[data-reasons]'); box.textContent = '';
    (B.reasons || []).forEach(function (r) {
      var b = el('button', '', r.text); b.type = 'button';
      b.onclick = function () { repDlg.close(); post('/lounge/api/report', { id: m.id, reason: r.k, b: bkey }).then(function (j) { say((j && j.message) || 'Sent.', j && j.ok ? 'good' : 'bad'); }); };
      box.appendChild(b);
    });
    if (repDlg.showModal) repDlg.showModal(); else repDlg.setAttribute('open', '');
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) { b.onclick = function () { var d = b.closest('dialog'); if (d) d.close(); }; });

  /* ---------------------------------------------------------------- show what you made */
  var showDlg = document.querySelector('[data-show-dlg]');
  var showNote = document.querySelector('[data-show-note]');
  var showBtn = document.querySelector('[data-show]');
  if (showBtn) showBtn.onclick = function () {
    if (!me.signedIn) { root.setAttribute('data-tab', 'chat'); say('Sign in with a passkey first: then show what you made.'); paintCompose(); window.scrollTo(0, document.body.scrollHeight); return; }
    showNote.textContent = ''; if (showDlg.showModal) showDlg.showModal(); else showDlg.setAttribute('open', '');
    setTimeout(function () { var u = showDlg.querySelector('input'); if (u) u.focus(); }, 0);
  };
  var showForm = document.querySelector('[data-show-form]');
  if (showForm) showForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = showForm.elements.url.value.trim(), text = showForm.elements.note.value.trim();
    showNote.className = 'lg-note'; showNote.textContent = 'Reading your game…';
    post('/lounge/api/show', { url: url, note: text, b: bkey }).then(function (r) {
      if (r && r.ok) { showDlg.close(); showForm.reset(); root.setAttribute('data-tab', 'chat'); say('Your card is in the Lounge.', 'good'); }
      else { showNote.className = 'lg-note bad'; showNote.textContent = (r && r.message) || 'That did not post.'; }
    });
  });

  /* ---------------------------------------------------------------- the socket */
  function onFrame(m) {
    if (m.t === 'net') {
      var pol = m.policy && m.policy.chat;
      // Only a real change of rules redraws the box (the room says its facts whenever somebody comes or goes), and
      // what a person was typing stays, with the cursor in it.
      var key = pol ? JSON.stringify(pol) : null;
      if (pol && key !== rulesKey) {
        rulesKey = key; rules = pol; more = more || rules.history > 0;
        var k = document.querySelector('[data-keeps]'); if (k) k.textContent = rules.history > 0 ? 'kept for ' + rules.history + (rules.history === 1 ? ' day' : ' days') : 'gone after a few minutes';
        var was = typingEl.querySelector('input'); var draft = was ? was.value : ''; var focused = was && document.activeElement === was;
        paintCompose(); paintKeep();
        var now2 = typingEl.querySelector('input'); if (now2 && draft) now2.value = draft; if (now2 && focused) now2.focus();
      }
      var c = m.counts || {}; here(c.shells || ((c.watchers || 0) + (c.players || 0)));
      return;
    }
    if (m.t === 'lines' && Array.isArray(m.lines)) {
      var have = {}; lines.forEach(function (l) { have[l.id] = l; });
      m.lines.forEach(function (l) { if (have[l.id]) return; lines.push(l); });
      lines.sort(function (a, b) { return a.at - b.at; });
      more = rules.history > 0 && lines.length >= 30;
      render(true); return;
    }
    if (m.t === 'line' || m.t === 'react') {
      var own = Boolean(m.n && mine[m.n]);
      if (own) m.mine = true;
      if (m.t === 'react' && !own) burst(m.glyph);
      if (lines.some(function (l) { return l.id === m.id; })) return;
      lines.push(m);
      if (lines.length > 400) lines = lines.slice(-400);
      render(own);
      return;
    }
    if (m.t === 'unline' && Array.isArray(m.ids)) { var gone = {}; m.ids.forEach(function (i) { gone[i] = 1; }); lines = lines.filter(function (l) { return !gone[l.id]; }); render(false); return; }
    if (m.t === 'held' || m.t === 'slow') { say(m.message || 'Not sent.', 'bad'); return; }
    if (m.t === 'muted') { say('The Lounge\'s keepers muted you for a while: your messages reach nobody for now.', 'bad'); return; }
    if (m.t === 'kicked') { held = m.message || 'The Lounge\'s keepers asked you to take a break.'; paintCompose(); stop(); return; }
    if (m.t === 'closed') { held = m.message || 'The Lounge is closed for now.'; paintCompose(); stop(); }
  }
  function connect() {
    if (stopped) return;
    var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + B.socket + '?b=' + encodeURIComponent(bkey);
    try { ws = new WebSocket(url); } catch (e) { return; }
    ws.addEventListener('message', function (ev) { try { onFrame(JSON.parse(String(ev.data))); } catch (e) { /* not a frame */ } });
    ws.addEventListener('open', function () { retry = 0; say(''); if (waiting) { try { ws.send(waiting); } catch (e) { /* next time */ } waiting = null; } });
    ws.addEventListener('close', function () { if (!stopped) { retry += 1; hereEl.classList.add('off'); hereEl.lastChild.textContent = 'Reconnecting…'; setTimeout(connect, Math.min(15000, 1000 * Math.pow(2, Math.min(retry, 4)))); } });
  }
  function stop() { stopped = true; try { if (ws) ws.close(); } catch (e) { /* gone */ } }
  addEventListener('pagehide', function () { stop(); });
  addEventListener('pageshow', function (e) { if (e.persisted && stopped && !held) { stopped = false; connect(); } });

  /* ---------------------------------------------------------------- what's on: the play night, live rooms, the keepers' pace */
  var whenFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  function left(ms) { var m = Math.round(ms / 60000); if (m < 60) return m + ' min'; var h = Math.floor(m / 60); if (h < 48) return h + ' h ' + (m % 60) + ' min'; return Math.floor(h / 24) + ' days'; }
  function ics(n) {
    var stamp = function (ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
    var start = Date.parse(n.at), end = start + n.minutes * 60000;
    var esc = function (s) { return String(s || '').replace(/[\\;,]/g, function (c) { return '\\' + c; }).replace(/\n/g, ' '); };
    var text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Homie//Lounge//EN', 'BEGIN:VEVENT', 'UID:' + n.id + '@' + location.host, 'DTSTAMP:' + stamp(Date.now()), 'DTSTART:' + stamp(start), 'DTEND:' + stamp(end),
      'SUMMARY:' + esc(n.title), 'DESCRIPTION:' + esc((n.note ? n.note + ' ' : '') + 'In ' + B.name + ' at ' + location.origin + '/lounge/'), 'URL:' + location.origin + '/lounge/', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    var a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' })); a.download = (n.title || 'play-night').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() + '.ics';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  var nights = B.nights || [];
  function paintNight() {
    var box = document.querySelector('[data-night]');
    if (!box) return;
    var k = box.querySelector('.k') || el('p', 'k', 'Play night');
    box.textContent = ''; box.appendChild(k);
    if (!nights.length) { add(box, el('h2', '', 'No play night set yet'), el('p', '', 'When the studio sets one, it shows here in your own time.')); return; }
    var n = nights[0], start = Date.parse(n.at), end = start + n.minutes * 60000, now = Date.now();
    add(box, el('h2', '', n.title), el('p', 'when', whenFmt.format(new Date(start))));
    if (n.note) box.appendChild(el('p', '', n.note));
    var c = el('span', 'count' + (now >= start && now < end ? ' on' : ''), now >= start && now < end ? 'On now' : 'Starts in ' + left(start - now));
    box.appendChild(c);
    var acts = el('div', 'acts');
    var cal = el('button', 'lg-btn lg-ghost lg-sm', 'Add to calendar'); cal.type = 'button'; cal.onclick = function () { ics(n); };
    if (n.game && https(n.game.play)) { var g = el('a', 'lg-btn lg-sm', n.game.name ? 'Play ' + n.game.name : 'Open the game'); g.href = n.game.play; g.rel = 'noopener'; acts.appendChild(g); }
    acts.appendChild(cal);
    box.appendChild(acts);
    if (nights.length > 1) {
      var ul = el('ul');
      nights.slice(1, 5).forEach(function (o) { add(ul, add(el('li'), el('span', '', o.title), el('span', '', whenFmt.format(new Date(Date.parse(o.at)))))); });
      box.appendChild(ul);
    }
  }
  function paintRooms(rooms) {
    var ul = document.querySelector('[data-rooms]');
    if (!ul) return;
    ul.textContent = '';
    if (!rooms.length) { ul.appendChild(el('li', 'empty', 'Nobody is playing right now. Start a room from any game, and say so here.')); return; }
    rooms.forEach(function (r) {
      var li = el('li');
      var th = el('span', 'th'); if (https(r.picture)) th.style.backgroundImage = 'url("' + r.picture.replace(/"/g, '') + '")';
      var acts = el('div', 'ra');
      if (https(r.watch)) { var w = el('a', '', 'Watch'); w.href = r.watch; w.rel = 'nofollow ugc noopener'; acts.appendChild(w); }
      if (https(r.join)) { var j = el('a', 'j', 'Join'); j.href = r.join; j.rel = 'nofollow ugc noopener'; acts.appendChild(j); }
      add(li, th, el('b', '', r.title), el('span', '', (r.studio ? r.studio + ' · ' : '') + r.players + (r.players === 1 ? ' playing' : ' playing') + (r.max ? ' of ' + r.max : '')), acts);
      ul.appendChild(li);
    });
  }
  function paintKeep() {
    var box = document.querySelector('[data-keep]');
    if (!box || !keeper()) return;
    box.hidden = false; box.textContent = '';
    var sel = el('select'); sel.setAttribute('aria-label', 'Slow mode');
    [[0, 'Slow mode off'], [3, 'One message every 3 s'], [10, 'Every 10 s'], [30, 'Every 30 s'], [120, 'Every 2 min']].forEach(function (o) { var op = el('option', '', o[1]); op.value = String(o[0]); if (Number(rules.slow) === o[0]) op.selected = true; sel.appendChild(op); });
    sel.onchange = function () { mod({ op: 'slow', seconds: Number(sel.value) }); };
    add(box, el('span', 'tag ' + (me.owner ? 'owner' : 'mod'), me.owner ? 'You keep this Lounge' : 'You\'re a moderator'), sel);
  }
  function here(n) { hereEl.classList.toggle('off', !n); hereEl.lastChild.textContent = n > 1 ? n + ' here now' : n === 1 ? 'Just you here' : 'Nobody else here'; }
  function now() {
    fetch('/lounge/api/now', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) return;
      nights = j.nights || nights; paintNight(); paintRooms(j.rooms || []);
      if (j.lounge && ws && ws.readyState === 1) here(j.lounge.here);
    }).catch(function () { /* next time */ });
  }

  function measureTop() { var t = document.querySelector('.top'); if (t) document.documentElement.style.setProperty('--lg-top', Math.round(t.getBoundingClientRect().height) + 'px'); }
  measureTop(); addEventListener('resize', measureTop);
  paintCompose(); paintNight(); paintKeep(); render(true); connect(); now();
  setInterval(function () { if (document.visibilityState !== 'hidden') { now(); } }, 30000);
  setInterval(paintNight, 30000);
}());`}`;
