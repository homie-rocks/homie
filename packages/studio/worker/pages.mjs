import { appWords, openPath } from './app-format.mjs';
import { APP_SHELL_JS } from './app-shell.mjs';
/**
 * The play shell: the page around a game's sandboxed frame at /<game>/play and /<game>/tv. Every other page is
 * worker/site.mjs. Every name a player typed is escaped.
 */
import { playerAncestors, PLAYER_SANDBOX, PLAYER_SIZE } from './embed.mjs';
import { esc, layout, gameSocialTags } from './site.mjs';
import { NET_PALETTE } from './room.mjs';
import { PARAM_VALUE, PREFS_LIMITS, playParams } from './seats.mjs';
import { SKILLS } from './agents.mjs';
import { KIDS_LINE, POLICY_WORDS } from './servers.mjs';
import { SAVES_SHELL_CSS, SAVES_SHELL_JS } from './saves-shell.mjs';
import { CHAT_CSS, CHAT_JS, CHAT_OWNER_JS, chatBoot } from './chat-page.mjs';
import { SHOP_SHELL_CSS, SHOP_SHELL_JS } from './shop-page.mjs';
import { ARRIVAL_JS, arrivalCard } from './arrival.mjs';

export { homePage, mediaIndexPage, notFoundPage, songPage, videoPage } from './site.mjs';

/** A room code: 1 to 32 letters, digits, - or _. */
export const ROOM_ID = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Who may put the play page (and so the game) inside a frame: this site, plus the https origins studio.json
 * `site.frameAncestors` names (for example a hub that embeds the game). Anything else is refused by the browser.
 */
export function frameAncestors(cat) {
  const extra = (Array.isArray(cat?.studio?.site?.frameAncestors) ? cat.studio.site.frameAncestors : [])
    .map((o) => { try { const u = new URL(String(o)); return u.protocol === 'https:' && u.origin === String(o).replace(/\/+$/, '') ? u.origin : null; } catch { return null; } })
    .filter(Boolean).slice(0, 8);
  return ["'self'", ...extra].join(' ');
}

/** What a play, big-screen or watch page answers to a room code it cannot use: said on the page, never a silent public room. */
export function badRoomPage(cat, g, raw, { screen = false, watch = false } = {}) {
  const shown = String(raw ?? '').slice(0, 64);
  return layout(cat, {
    title: `That room link does not work · ${g.name}`, page: 'bad-room', status: 400,
    main: `<header class="head"><p class="kicker">${esc(g.name)}</p><h1>That room link does not work</h1>
<p class="lead">The room code in this link${shown ? ` (<span class="addr">${esc(shown)}${String(raw).length > 64 ? '…' : ''}</span>)` : ''} is not one a room can have: a code is 1 to 32 letters, digits, hyphens or underscores. Ask whoever sent it for the link again, or ${watch ? 'watch' : 'play in'} a public room.</p>
<div class="keys"><a class="btn" href="/${esc(g.id)}/${watch ? 'watch' : screen ? 'tv' : 'play'}"${watch ? '' : ' data-play'}>${watch ? 'Watch a public room' : 'Join a public room'}</a><a class="ghost" href="/${esc(g.id)}/">Back to ${esc(g.name)}</a></div></header>`,
  });
}

/** A game whose game.json says `"watch": false` has no watch door: the page says so and offers Play. */
export function noWatchPage(cat, g) {
  return layout(cat, {
    title: `${g.name} is not shown to watchers`, page: 'no-watch', status: 404,
    main: `<header class="head"><p class="kicker">${esc(g.name)}</p><h1>${esc(g.name)} is played, not watched</h1>
<p class="lead">Its rooms are not shown to watchers: what each player sees stays theirs. Press Play and you are in a room, with bots in the empty seats.</p>
<div class="keys"><a class="btn" href="${esc(openPath(g))}" data-play>Play ${esc(g.name)}</a><a class="ghost" href="/${esc(g.id)}/">Back to ${esc(g.name)}</a></div></header>`,
  });
}

/** Where the room button may sit: a corner, or the middle of the top edge. */
export const SHARE_PLACES = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-right'];

/**
 * Where the room button sits on each device, from game.json `screen.share`, so it never covers the game's own
 * HUD (a scoreboard in the top right, a fuel bar across a phone's top):
 *
 *   "share": "top-left"                                     every device (a place from SHARE_PLACES)
 *   "share": { "at": "top-right", "y": 64 }                 moved 64 px in from its edge (x: from its side)
 *   "share": { "desk": "bottom-left", "phone": { "at": "top-left", "y": 56 }, "sideways": "top-center" }
 *   "share": { "at": "top-right", "label": false }          the button stays a small round icon (the room code is
 *                                                           in its sheet), for a corner with little room
 *
 * `desk` is a computer, `phone` a phone held upright, `sideways` a phone turned sideways (else as `phone`). For a
 * corner, `x` and `y` move the button in from its side and its edge (0 to 600 px); for top-center, `x` moves it
 * right (or left, negative) and `y` down. Anything else is the default: the top right, as before.
 */
export function sharePlaces(value) {
  const one = (v) => {
    const o = typeof v === 'string' ? { at: v } : v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    if (!o || !SHARE_PLACES.includes(o.at)) return null;
    const num = (n, lo, hi) => (Number.isFinite(Number(n)) ? Math.max(lo, Math.min(hi, Math.round(Number(n)))) : 0);
    return { at: o.at, x: num(o.x, o.at === 'top-center' ? -600 : 0, 600), y: num(o.y, 0, 600), label: o.label !== false };
  };
  // A place for every device (a string, or an object with `at`), then any device's own over it.
  const all = one(value) ?? { at: 'top-right', x: 0, y: 0, label: true };
  const per = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const desk = one(per.desk) ?? all;
  const phone = one(per.phone) ?? all;
  return { desk, phone, sideways: one(per.sideways) ?? phone };
}

/**
 * The play shell. It asks the Lobby for a public room, boots the game frame at once (seated, no waiting), keeps
 * the seat token for a reload, writes the room into the address (so a reload or a copied address comes back to
 * it), and keeps the room's facts in `window.__shell` (what a test or a big screen reads). A small room button at
 * the edge (game.json `screen.share`, per device: sharePlaces) opens Invite, Big screen and the room code; nothing
 * covers the middle of the screen or a thumb.
 */
export function playPage(cat, g, { embed = false, origin = '', preview = false, screen = false, joinUrl = null, qr = null, local = false, room = null, ticket = null, owner = false, launch = 'public', server = null, acct = false, member = false, shop = null } = {}) {
  const shopControl = Boolean(shop && !screen && g.screen?.shop !== false);
  const accent = cat?.studio?.theme?.accent ?? '#ffcf5a';
  const corner = (name, fallback) => (['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(g.screen?.[name]) ? g.screen[name] : fallback);
  const places = sharePlaces(g.screen?.share);
  // The phone's glass belongs to the game: no page pan, pinch-zoom, text selection or callout under a thumb
  // (a pinch between a stick thumb and a button thumb made the browser cancel both touches).
  // A game with an art direction (games.json `ui`, from its style.json): the pills wear its paper and text, like its HUD.
  const okHex = (v) => /^#[0-9a-f]{6}$/i.test(String(v ?? ''));
  const ui = okHex(g.ui?.paper) && okHex(g.ui?.text) ? g.ui : null;
  const pillUi = ui ? `\n.pill, .chip, .pill.dim { background: ${ui.paper}e6; color: ${ui.text}; border-color: ${ui.text}22; }\n.pill svg { color: ${ui.text}; }` : '';
  // The arrival card (worker/arrival.mjs): the game's own look until the game says it is playable, never a blank screen.
  const arrive = arrivalCard(cat, g, { screen });
  const css = `:root{--hot:${/^#[0-9a-f]{3,8}$/i.test(accent) ? accent : '#ffcf5a'}}
html, body { height: 100%; margin: 0; overflow: hidden; overscroll-behavior: none; background: #04060c; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
iframe.game { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; display: block; background: #04060c; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.chip { position: fixed; left: max(10px, env(safe-area-inset-left)); bottom: max(10px, env(safe-area-inset-bottom)); z-index: 5; padding: 6px 10px; border-radius: 999px; background: rgba(0,0,0,.55); color: #dfe6f5; font: 12px/1.2 ui-sans-serif, system-ui, sans-serif; pointer-events: none; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); transition: opacity .6s; }
.chip.quiet { opacity: 0; }
.card { position: fixed; right: 12px; bottom: 12px; z-index: 4; max-width: 300px; padding: 10px 12px; border-radius: 12px; background: rgba(8,12,22,.82); border: 1px solid rgba(255,255,255,.14); color: #e8ecf5; font: 13px/1.35 ui-sans-serif, system-ui, sans-serif; }
.card h2 { margin: 0 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--hot); }
.card ol { margin: 0; padding-left: 18px; }
.join { position: fixed; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom)); z-index: 6; display: flex; gap: 14px; align-items: center; padding: 12px 14px; border-radius: 16px; background: rgba(8,12,22,.78); border: 1px solid rgba(255,255,255,.14); color: #eef1f8; font: 600 clamp(14px, 1.6vmin, 22px)/1.3 ui-sans-serif, system-ui, sans-serif; pointer-events: none; }
.join.join-top-left { top: max(16px, env(safe-area-inset-top)); left: max(16px, env(safe-area-inset-left)); right: auto; bottom: auto; }
.join.join-top-right { top: max(16px, env(safe-area-inset-top)); bottom: auto; }
.join.join-bottom-left { left: max(16px, env(safe-area-inset-left)); right: auto; }
.join .qr { width: clamp(96px, 15vmin, 220px); height: clamp(96px, 15vmin, 220px); border-radius: 8px; overflow: hidden; }
.join .qr svg { width: 100%; height: 100%; display: block; }
.join b { display: block; color: var(--hot); font-size: 1.15em; margin-bottom: 4px; }
.join span { opacity: .85; word-break: break-all; }
.room { --dx: 0px; --dy: 0px; position: fixed; z-index: 7; display: flex; flex-direction: column; gap: 8px; font: 600 13px/1.2 ui-sans-serif, system-ui, -apple-system, sans-serif; color: #eef1f8; }
.room.at-top-right { top: calc(max(8px, env(safe-area-inset-top)) + var(--dy)); right: calc(max(8px, env(safe-area-inset-right)) + var(--dx)); align-items: flex-end; }
.room.at-top-left { top: calc(max(8px, env(safe-area-inset-top)) + var(--dy)); left: calc(max(8px, env(safe-area-inset-left)) + var(--dx)); align-items: flex-start; }
.room.at-top-center { top: calc(max(8px, env(safe-area-inset-top)) + var(--dy)); left: calc(50% + var(--dx)); transform: translateX(-50%); align-items: center; }
.room.at-bottom-right { bottom: calc(max(8px, env(safe-area-inset-bottom)) + var(--dy)); right: calc(max(8px, env(safe-area-inset-right)) + var(--dx)); align-items: flex-end; flex-direction: column-reverse; }
.room.at-bottom-left { bottom: calc(max(8px, env(safe-area-inset-bottom)) + var(--dy)); left: calc(max(8px, env(safe-area-inset-left)) + var(--dx)); align-items: flex-start; flex-direction: column-reverse; }
.chip.chip-right { left: auto; right: max(10px, env(safe-area-inset-right)); }
/* The room button and the server pill share one band at the room button's place, side by side (the server pill on
   the inner side), so the shell never covers more of the game than the place the game gave the room button. */
.room .pills { display: flex; align-items: center; gap: 8px; }
.room.at-top-right .pills, .room.at-bottom-right .pills { flex-direction: row-reverse; }
.pill { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 11px 0 9px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); background: rgba(6,9,16,.62); color: inherit; font: inherit; cursor: pointer; touch-action: manipulation; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); transition: opacity .5s; }
.pill svg { width: 15px; height: 15px; flex: none; }
.pill.dim { opacity: .38; width: 34px; padding: 0; justify-content: center; }
.pill.dim span { display: none; }
.pill:hover, .pill:focus-visible, .pill[aria-expanded="true"] { opacity: 1; width: auto; padding: 0 11px 0 9px; }
.pill:hover span, .pill:focus-visible span, .pill[aria-expanded="true"] span { display: inline; }
/* game.json screen.share "label": false: always the small round icon, even while it is open (the code is in the sheet). */
.pill.icon, .pill.icon:hover, .pill.icon:focus-visible, .pill.icon[aria-expanded="true"] { width: 34px; padding: 0; justify-content: center; }
.pill.icon span, .pill.icon:hover span, .pill.icon:focus-visible span, .pill.icon[aria-expanded="true"] span { display: none; }
.sheet { box-sizing: border-box; width: min(300px, calc(100vw - 16px)); padding: 12px; border-radius: 16px; background: rgba(8,12,22,.94); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 18px 50px rgba(0,0,0,.5); -webkit-user-select: text; user-select: text; touch-action: manipulation; }
.sheet .code { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin: 2px 2px 10px; }
.sheet .code b { font: 800 20px/1.1 ui-sans-serif, system-ui, sans-serif; letter-spacing: -.01em; }
.sheet .code span { color: #aab3c7; font-weight: 500; font-size: 12px; }
.sheet .acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sheet .acts > * { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 42px; padding: 0 10px; border-radius: 11px; border: 1px solid rgba(255,255,255,.16); background: transparent; color: inherit; font: inherit; text-decoration: none; cursor: pointer; }
.sheet .acts .primary { background: var(--hot); color: #0b0b10; border-color: transparent; font-weight: 800; }
.sheet .acts svg { width: 16px; height: 16px; flex: none; }
.sheet .link { display: block; margin: 10px 2px 2px; color: #aab3c7; font: 500 11.5px/1.35 ui-monospace, Menlo, monospace; word-break: break-all; }
.sheet .foot { display: flex; justify-content: space-between; margin-top: 10px; font-weight: 500; }
.sheet .foot a, .sheet .foot button { color: #aab3c7; background: none; border: 0; padding: 6px 2px; font: inherit; text-decoration: none; cursor: pointer; }
.sheet .foot a:hover, .sheet .foot button:hover { color: #fff; }
.toast { position: fixed; left: 50%; top: max(12px, env(safe-area-inset-top)); z-index: 8; transform: translateX(-50%); padding: 8px 14px; border-radius: 999px; background: rgba(8,12,22,.9); color: #fff; font: 600 13px/1.2 ui-sans-serif, system-ui, sans-serif; pointer-events: none; }
/* The studio's announcement (section 15): a line across the top, small, never over the middle; it goes by itself. */
.banner { box-sizing: border-box; position: fixed; left: 50%; top: calc(max(8px, env(safe-area-inset-top)) + 44px); z-index: 9; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; width: max-content; max-width: min(560px, calc(100vw - 24px)); padding: 9px 8px 9px 14px; border-radius: 14px; background: rgba(8,12,22,.9); border: 1px solid var(--hot); color: #fff; font: 600 14px/1.35 ui-sans-serif, system-ui, -apple-system, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.45); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); touch-action: manipulation; animation: drop .35s ease-out; }
.banner b { color: var(--hot); font-weight: 800; white-space: nowrap; }
.banner span { overflow-wrap: anywhere; }
.banner button { flex: none; width: 30px; height: 30px; border-radius: 50%; border: 0; background: rgba(255,255,255,.08); color: #fff; font: 600 16px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
@keyframes drop { from { opacity: 0; transform: translate(-50%, -8px); } }
/* A kick or a closed room: the game stops, and the page says so plainly. */
.notice { box-sizing: border-box; position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 20px; background: rgba(4,6,12,.86); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); color: #eef1f8; font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif; -webkit-user-select: text; user-select: text; touch-action: manipulation; }
.notice .box { box-sizing: border-box; width: min(420px, 100%); padding: 22px; border-radius: 20px; background: #0d111c; border: 1px solid rgba(255,255,255,.14); box-shadow: 0 24px 70px rgba(0,0,0,.55); }
.notice h1 { margin: 0 0 8px; font-size: 22px; letter-spacing: -.01em; }
.notice p { margin: 0 0 10px; color: #c3cad9; }
.notice .when { color: var(--hot); font-weight: 700; }
.notice .acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.notice .acts a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 12px; text-decoration: none; font-weight: 700; color: #eef1f8; border: 1px solid rgba(255,255,255,.18); }
.notice .acts a.primary { background: var(--hot); color: #0b0b10; border-color: transparent; }
[hidden] { display: none !important; }
${arrive.css}
${embed ? `html,body{touch-action:auto}.room.at-top-center{transform:none;left:auto;right:max(8px,env(safe-area-inset-right))}.embed-open{display:flex;align-items:center;min-height:44px;color:inherit}.embed-note{font:12px/1.4 system-ui;overflow-wrap:anywhere}.sheet{position:fixed;inset:calc(max(8px,env(safe-area-inset-top)) + 48px) max(8px,env(safe-area-inset-right)) auto auto;max-width:calc(100vw - max(8px,env(safe-area-inset-left)) - max(8px,env(safe-area-inset-right)));max-height:calc(100dvh - max(8px,env(safe-area-inset-top)) - 48px - max(8px,env(safe-area-inset-bottom)));overflow:auto;overscroll-behavior:contain;touch-action:pan-y}.sheet.more::after{content:'▾ more below';position:sticky;bottom:-12px;display:block;margin:0 -12px -12px;padding:16px 0 5px;text-align:center;font:600 11px/1 system-ui;color:#cfd6e6;background:linear-gradient(transparent,rgba(8,12,22,.98) 60%);pointer-events:none}.sheet .embed-help{margin:8px 2px;font:500 12px/1.4 system-ui;color:#aab3c7}html:not(.player-frame) .frame-only{display:none}.sheet a,.sheet button{min-height:44px}.sheet .foot a,.sheet .foot button{display:inline-flex;align-items:center}.embed-open .frame-only{margin-left:4px}.player-top iframe.game{inset:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);width:calc(100% - env(safe-area-inset-left) - env(safe-area-inset-right));height:calc(100% - env(safe-area-inset-top) - env(safe-area-inset-bottom))}.arrive-in{padding:12px}.arrive-title{font-size:clamp(24px,7vw,52px)}` : ''}
${shopControl ? `.shop-control{color:#eef1f8;font:600 13px/1.2 system-ui;position:fixed;top:env(safe-area-inset-top);left:max(8px,env(safe-area-inset-left));height:52px;display:flex;align-items:center;z-index:6}.shop-control button{min-height:44px;padding:0 18px}html body .room.room{flex-direction:column;align-items:flex-end;top:max(4px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));left:auto;bottom:auto;transform:none}html body iframe.game.game{top:calc(env(safe-area-inset-top) + 52px);height:calc(100% - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 52px)}` : ''}
${SERVER_CSS}${CHAT_CSS}${g.saves && !screen ? SAVES_SHELL_CSS : ''}${shop ? SHOP_SHELL_CSS : ''}${pillUi}`;
  // The room button's place on each device (sharePlaces); the shell moves it to this browser's once it knows the device.
  // A ticket (a game that is not public) and the owner's overlay ride along only for the browser they are for.
  // The server this page plays on (0.16.0): its pool (the Lobby), its badge and line for the chip, its ceiling.
  const srv = server ? { id: server.id, name: server.name, badge: server.badge, line: server.line, policy: server.policy, kids: Boolean(server.kids), mentor: Boolean(server.mentor), levelMax: server.levelMax } : null;
  // game.json "agents": { "vote": "game" } draws its own vote card; false turns the vote off (section 17).
  const vote = g.agents?.vote === 'game' || g.agents?.vote === false ? g.agents.vote : 'shell';
  // The address's switches the game's frame is handed (NETPLAY.md section 24): the defaults and the game's own names.
  const boot = { ...(g.kind === 'app' ? { kind: 'app', appWords: appWords(g) } : {}), embed, game: g.id, name: g.name, screen: Boolean(screen), share: places, params: playParams(g), paramValue: PARAM_VALUE, prefs: PREFS_LIMITS, ...(room ? { room } : {}), ...(ticket ? { t: ticket } : {}), ...(owner ? { owner: true, launch } : {}), ...(srv ? { server: srv } : {}), vote, skills: SKILLS.map((k) => ({ level: k.level, name: k.name, card: k.card })), words: POLICY_WORDS, kidsLine: KIDS_LINE, ...(shop ? { shop } : {}) };
  // game.json "screen": { "join": "top-left" | "top-right" | "bottom-left" | "bottom-right" } keeps the card off the game's own HUD.
  const joinCorner = corner('join', 'bottom-right');
  const first = places.desk;
  // Local development: no join card at all on the big screen (no phone can open this computer's address); the room
  // button's sheet says to deploy to share, for whoever looks for a link.
  const joinCard = screen && joinUrl && !local ? `<div class="join join-${joinCorner}" data-join>${qr ? `<div class="qr">${qr}</div>` : ''}<div><b>${esc(appWords(g).join)}</b><span>${esc(joinUrl.replace(/^https?:\/\//, ''))}</span></div></div>` : '';
  const share = screen ? '' : `<div class="room at-${first.at}" style="--dx:${first.x}px;--dy:${first.y}px" data-room-ui>
  <div class="pills"><button class="pill${first.label ? '' : ' icon'}" type="button" data-share-toggle aria-expanded="false" aria-controls="share-sheet" aria-label="${embed ? 'Room, invite and the studio’s site' : 'Room, invite and big screen'}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/></svg><span data-room-code>Room</span></button>
  <button class="pill spill" type="button" data-server-toggle aria-expanded="false" aria-controls="server-sheet" hidden><span class="sdot" aria-hidden="true"></span><span data-server-label></span></button></div>
  <div class="sheet ssheet" id="server-sheet" role="dialog" aria-label="This server" data-server-sheet hidden>
    <div class="code"><b data-server-name></b><span data-server-badge></span></div>
    <p class="sline" data-server-line></p>
    <div class="srow" data-level-row hidden><span>AI level: <b data-level-name></b></span><button type="button" data-level-vote>Change ▾</button></div>
    <label class="srow quiet-ai"><span>Quiet AI <small>hides AI chat on this screen</small></span><input type="checkbox" data-quiet-ai></label>
  </div>
  <div class="sheet" id="share-sheet" role="dialog" aria-label="This room" data-share-sheet hidden>
    <div class="code"><b data-room-label>This room</b><span data-room-count></span></div>${embed ? `
    <a class="embed-open" data-studio-open href="${esc(openPath(g))}" target="_blank" rel="noopener noreferrer">Open on the studio's site<span class="frame-only"> ↗</span></a><div class="embed-note" data-embed-note role="status" hidden></div>` : ''}
    <div class="acts">
      <button type="button" class="primary" data-invite><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7"/></svg><span data-invite-word>Invite</span></button>
      <a data-bigscreen target="_blank" rel="noopener" href="/${esc(g.id)}/tv"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 20.5h8"/></svg><span>Big screen</span></a>
    </div>
${embed ? `    <p class="embed-help">Sound starts after a press. If pointer lock, fullscreen or a gamepad is unavailable, use keys or touch, or open on the studio’s site.<span class="frame-only"> Big screen and phone controllers open in a new tab.</span></p>` : ''}
    <span class="link" data-room-link></span>
    <div class="foot"><a href="/${esc(g.id)}/"${embed ? ' target="_blank" rel="noopener noreferrer"' : ''}>← ${esc(g.name)}</a>${shop ? '<button type="button" data-shop-open>Shop</button>' : ''}<button type="button" data-copy-link>Copy link</button></div>${g.saves ? `
    <div class="who-row" data-who hidden><span data-who-name></span><button type="button" data-who-act></button></div>` : ''}
  </div>
</div>
<div class="toast" data-toast role="status" hidden></div>`;
  return layoutless(`${g.name} · ${appWords(g).open}`, `
<iframe class="game" title="${esc(g.name)}" sandbox="allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups" allow="fullscreen *; autoplay *; gamepad *"></iframe>
${arrive.html}
<div class="chip${arrive.html ? ' held' : ''}" data-chip><span data-status>finding a room…</span></div>
<div class="vote" data-vote role="dialog" aria-label="How strong should the AI be?" data-keep-focus hidden></div>
<div class="card" data-results hidden></div>
<div class="card" data-screen hidden></div>
${joinCard}${share}${shopControl ? '<div class="shop-control"><button class="pill" type="button" data-shop-open data-shop-control>Shop</button></div>' : ''}
<script>window.__HOMIE_PLAY=${JSON.stringify(boot).replace(/</g, '\\u003c')};</script>
<script>window.__HOMIE_CHAT=${JSON.stringify(chatBoot(g, { surface: screen ? 'tv' : 'play', owner, acct, member })).replace(/</g, '\\u003c')};</script>
<script>${CHAT_JS}</script>
<script>${ARRIVAL_JS}</script>
<script>${SHELL_JS}</script>${g.kind === 'app' ? `<script>${APP_SHELL_JS}</script>` : ''}${g.saves && !screen ? `
<script>${SAVES_SHELL_JS}</script>` : ''}${shop ? `
<script>${SHOP_SHELL_JS}</script>` : ''}${owner ? `<style>${OWNER_CSS}</style><script>${OWNER_JS}</script><script>${CHAT_OWNER_JS}</script>` : ''}`, css, embed ? embedAncestors(cat, origin, preview) : frameAncestors(cat), { embed, origin, head: gameSocialTags(cat, g, origin, launch === 'public') });
}

/*
 * SERVERS AND THE AI DIAL (0.16.0, NETPLAY.md section 17): the server pill beside the room button, in the same band
 * (its name and badge, or on a phone held upright its dot; its sheet has the policy's line, the AI's level with
 * "Change", and Quiet AI), and the party's vote card on how strong the AI should be (an opaque bottom sheet on a
 * phone; keys 1-5 on a computer). Nothing covers the middle of the screen except the card, for a few seconds, when a
 * vote is open.
 */
const SERVER_CSS = `.spill .sdot { width: 8px; height: 8px; border-radius: 50%; background: var(--hot); flex: none; }
.spill.dim .sdot { display: block; }
/* A phone held upright has no width to spare at its top: the server pill is its dot from the start (its sheet says
   the name, the badge and the line; the chip names the server), so the band is the room button's label and one dot. */
@media (max-width: 540px) {
  .spill, .spill:hover, .spill:focus-visible, .spill[aria-expanded="true"] { width: 34px; padding: 0; justify-content: center; }
  .spill span[data-server-label], .spill:hover span[data-server-label], .spill:focus-visible span[data-server-label], .spill[aria-expanded="true"] span[data-server-label] { display: none; }
}
.ssheet .sline { margin: 0 2px 10px; color: #c3cad9; font-weight: 500; line-height: 1.4; }
.ssheet .srow { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 40px; margin: 0 2px; border-top: 1px solid rgba(255,255,255,.08); font-weight: 600; }
.ssheet .srow small { display: block; color: #8b93a7; font-weight: 500; font-size: 11px; }
.ssheet .srow button { min-height: 34px; padding: 0 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.18); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.ssheet .srow input { width: 20px; height: 20px; accent-color: var(--hot); }
.aipill { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; background: rgba(255,207,90,.2); color: #ffe7a8; font: 800 10px/1.6 ui-monospace, Menlo, monospace; letter-spacing: .06em; vertical-align: 1px; }
.vote { box-sizing: border-box; position: fixed; left: 50%; top: 50%; z-index: 12; transform: translate(-50%, -50%); width: min(560px, calc(100vw - 24px)); padding: 16px 16px 14px; border-radius: 18px; background: #080c16; border: 1px solid var(--hot); color: #eef1f8; font: 600 14px/1.35 ui-sans-serif, system-ui, -apple-system, sans-serif; box-shadow: 0 24px 70px rgba(0,0,0,.55); touch-action: manipulation; -webkit-user-select: none; user-select: none; animation: rise .25s ease-out; }
@keyframes rise { from { opacity: 0; transform: translate(-50%, -46%); } }
.vote .vh { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin: 0 2px 12px; }
.vote .vh b { font-size: 18px; letter-spacing: -.01em; }
.vote .vh span { color: #aab3c7; font-weight: 600; font-size: 12px; white-space: nowrap; }
.vote .opts { display: grid; grid-template-columns: repeat(var(--n, 5), 1fr); gap: 8px; }
.vote .opts button { min-height: 58px; padding: 6px 4px; border-radius: 13px; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.04); color: inherit; font: inherit; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
.vote .opts button b { font-size: 16px; }
.vote .opts button small { color: #9aa3b7; font-size: 11px; font-weight: 600; }
.vote .opts button[aria-pressed="true"] { background: var(--hot); color: #0b0b10; border-color: transparent; }
.vote .opts button[aria-pressed="true"] small { color: #3b3420; }
.vote .legend { display: flex; justify-content: space-between; gap: 10px; margin: 10px 4px 0; color: #8b93a7; font-size: 11px; font-weight: 600; }
.vote .legend i { flex: 1; border-bottom: 2px dotted rgba(255,255,255,.18); margin-bottom: 4px; }
.vote .foot { margin: 10px 2px 0; text-align: center; color: #c3cad9; font-weight: 600; }
@media (max-width: 540px) {
  .vote { top: auto; bottom: 0; left: 0; right: 0; width: auto; transform: none; border-radius: 20px 20px 0 0; padding-bottom: max(16px, env(safe-area-inset-bottom)); animation: up .25s ease-out; }
  @keyframes up { from { opacity: 0; transform: translateY(20px); } }
  .vote .opts { grid-template-columns: repeat(3, 1fr); }
  .vote .opts button { min-height: 64px; }
  .vote .legend { display: none; }
}`;

/** The play page's own document (no site chrome: the game owns the whole screen). */
function layoutless(title, body, css, ancestors = "'self'", { embed = false, origin = '', head = '' } = {}) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>${esc(title)}</title>${head}<link rel="icon" href="data:,"><style>${css}</style></head>
<body>${body}</body></html>`, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      // Framed only by this site and the origins studio.json names (a browser that reads CSP ignores the older header).
      ...(embed ? {} : { 'x-frame-options': 'SAMEORIGIN' }),
      'content-security-policy': `frame-ancestors ${ancestors}`,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
}

/* The shell script (runs on the site's own origin; the game runs in the sandboxed frame). */
// Included separately in each page: a successful welcome acknowledges the actual frame build.
const BUILD_RETRY_JS = String.raw`
  function buildRetry(load, note) {
    var active = false, loading = false, reported = false, failed = false, rules = false;
    var attempt = 0, timer = null, probe = null, target = null, exhausted = false, legacy = [];
    function cancel() { clearTimeout(timer); clearTimeout(probe); timer = probe = null; }
    function done() { cancel(); active = false; failed = false; }
    function giveUp() { exhausted = true; done(); note('Reload the page to play the new version.'); }
    function run() {
      cancel();
      legacy = legacy.filter(function (at) { return Date.now() - at < 60000; });
      if (rules ? attempt >= 6 : legacy.length >= 2) { giveUp(); return; }
      if (!rules) legacy.push(Date.now());
      active = true; loading = true; reported = false; failed = false; attempt++;
      note('Updating the game. Loading…'); load();
    }
    function wait() {
      if (!active || loading || !failed || timer !== null) return;
      clearTimeout(probe); probe = null;
      if (rules ? attempt >= 6 : legacy.length >= 2) { giveUp(); return; }
      var delay = [2000, 5000, 15000][Math.min(attempt - 1, 2)];
      note('Updating the game. Retrying in ' + delay / 1000 + ' s.');
      timer = setTimeout(run, delay);
    }
    return {
      request: function (ver, immediate) {
        if (exhausted && ver === target) return;
        if (!active) { target = ver; rules = immediate === true; attempt = 0; exhausted = false; run(); }
        else if (!rules) run();
        else { failed = true; wait(); }
      },
      loaded: function () {
        loading = false;
        if (!active) return;
        if (failed) { wait(); return; }
        // A browser error document emits load too. Only the helper can confirm this document.
        if (!reported && probe === null) probe = setTimeout(function () { probe = null; failed = true; wait(); }, 5000);
      },
      reported: function () { reported = true; clearTimeout(probe); probe = null; },
      failed: function () { loading = false; failed = true; wait(); },
      // Told to wait for its room, the page says so. A newer build that loads after this round is not a wait: the
      // page is still in its room, live, and says nothing here.
      stop: function (quiet) { done(); note(quiet === true ? '' : 'Waiting for the room.'); },
      acknowledge: function () { var was = active; exhausted = false; done(); loading = false; note(''); return was; }
    };
  }
`;

const SHELL_JS = String.raw`${BUILD_RETRY_JS}(function () {
  'use strict';
  var boot = window.__HOMIE_PLAY;
  var framed = window.top !== window;
  if (boot.embed) document.documentElement.classList.add(framed ? 'player-frame' : 'player-top');
  var params = new URLSearchParams(location.search);
  var screenMode = !boot.embed && (params.get('screen') === '1' || boot.screen === true);
  // Local development (this computer's own address): never hand a phone a link it cannot open.
  var LOCAL = /^(localhost|.*\.localhost|127\..*|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);
  var asked = boot.embed ? null : params.get('hand');
  var device = asked === 'phone' || asked === 'desk' || asked === 'tv' ? asked : (boot.embed ? matchMedia('(pointer:coarse)').matches : Math.min(innerWidth, innerHeight) <= 540) ? 'phone' : 'desk';
  var want = screenMode ? 'screen' : 'play';
  var frame = document.querySelector('iframe.game');
  var statusEl = document.querySelector('[data-status]');
  var results = document.querySelector('[data-results]');
  var screenCard = document.querySelector('[data-screen]');
  var state = { game: boot.game, room: null, device: device, want: want, attached: false, stats: null, round: null, roster: null, facts: null, seat: null, results: [], closed: null, link: null, notice: null, banner: null, muted: null, server: boot.server || null, vote: null, myVote: {}, quietAi: false, full: false };
  window.__shell = state;
  // Where signing in comes back to. From the player address that is Play in the same room: the player itself is guests only.
  state.returnPath = function () { return boot.embed ? '/' + boot.game + (boot.kind === 'app' ? '/open' : '/play') + (state.room ? '?room=' + encodeURIComponent(state.room) : '') : location.pathname + location.search; };
  // The arrival card (worker/arrival.mjs): the game's look while the room connects and the game loads.
  var A = window.__homieArrival || { done: true, room: function () {}, facts: function () {}, full: function () {}, message: function () {}, lift: function () {}, frameLoaded: function () {} };
  state.arrival = A.state || null;
  // This browser's room key: random, kept in this site's own storage, and sent only to this site's rooms. It is what
  // an owner's kick holds out of a room for a while (section 15); it says nothing about who the player is.
  function rnd() {
    try { var a = new Uint8Array(16); crypto.getRandomValues(a); var s = ''; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    catch (e) { var r = ''; while (r.length < 22) r += Math.random().toString(36).slice(2); return r.slice(0, 22); }
  }
  // The player address (a post's player card): a guest name and room of its own, never the address's. Opened as a
  // page of its own, and while this tab's storage works, they are kept for the visit: a reload, Back or Forward comes
  // back to the same room, seat and name. In a frame nothing is kept: two posts of one game on a page are two frames
  // sharing one sessionStorage, and they must stay two players.
  var keeps = !boot.embed || !framed;
  var EMBED_ROOM = /^(?:pub-[1-9][0-9]*|main)$/;
  var EMBED_KEY = 'homie-player.' + boot.game;
  var kept = null;
  if (boot.embed && keeps) try { kept = JSON.parse(sessionStorage.getItem(EMBED_KEY) || 'null'); } catch (e) { kept = null; }
  var guestName = kept && /^Guest [A-Za-z0-9_-]{6}$/.test(kept.name || '') ? kept.name : 'Guest ' + rnd().slice(0, 6);
  var roomKey = null;
  try { roomKey = localStorage.getItem('homie-b'); if (!/^[A-Za-z0-9_-]{16,43}$/.test(roomKey || '')) { roomKey = rnd(); localStorage.setItem('homie-b', roomKey); } } catch (e) { roomKey = rnd(); }

  // The chip says who is here, then gets out of the game's way (games draw their own HUD at the top). It never takes a touch.
  var chip = document.querySelector('[data-chip]');
  var quietTimer = null;
  function say(text) {
    // While the arrival card is up it says this itself; the chip waits for the game to have the screen.
    if (!A.done) { statusEl.textContent = text; return; }
    if (statusEl.textContent === text && !chip.classList.contains('held')) return;
    statusEl.textContent = text;
    chip.classList.remove('held');
    chip.classList.remove('quiet');
    clearTimeout(quietTimer);
    quietTimer = setTimeout(function () { chip.classList.add('quiet'); }, 5000);
  }

  // This room, shared: the code, Invite (the phone's share sheet, or the link copied), Big screen (the TV view of this room).
  var ui = document.querySelector('[data-room-ui]');
  var toggle = ui && ui.querySelector('[data-share-toggle]');
  var sheet = ui && ui.querySelector('[data-share-sheet]');
  var toast = document.querySelector('[data-toast]');
  var dimTimer = null;
  // Where the button sits on THIS device (game.json screen.share, per computer, phone and phone turned sideways: a
  // corner or the top's middle, moved in by x / y), so it never sits on the game's own scoreboard or fuel bar.
  function place() {
    if (!ui || !boot.share) return;
    var key = device === 'phone' ? (innerWidth > innerHeight ? 'sideways' : 'phone') : 'desk';
    var p = boot.share[key] || boot.share.desk;
    if (!p) return;
    ui.className = 'room at-' + p.at;
    ui.style.setProperty('--dx', (p.x || 0) + 'px');
    ui.style.setProperty('--dy', (p.y || 0) + 'px');
    if (toggle) { if (p.label === false) toggle.classList.add('icon'); else toggle.classList.remove('icon'); }
    // The status chip lives at the bottom left: a button there sends it to the bottom right.
    if (p.at === 'bottom-left') chip.classList.add('chip-right'); else chip.classList.remove('chip-right');
    state.share = { device: key, at: p.at, x: p.x || 0, y: p.y || 0, label: p.label !== false };
  }
  place();
  addEventListener('resize', place);
  function labelOf(room) {
    var m = /^pub-(\d+)$/.exec(room);
    if (m) return 'Room ' + m[1];
    // A room of this page's server (s-<server>-<n>) is "Room <n>" too: the server pill beside the button names it.
    var at = state.server ? 's-' + state.server.id + '-' : null;
    var n = at && room.indexOf(at) === 0 ? room.slice(at.length) : '';
    return /^\d+$/.test(n) ? 'Room ' + n : room;
  }
  function flash(text) { if (!toast) return; toast.textContent = text; toast.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(function () { toast.hidden = true; }, 1800); }
  // The room pill and the server pill (in one band, at the room button's place) fade to dots after 6 s.
  function wake() {
    if (!toggle) return;
    var sp = document.querySelector('[data-server-toggle]');
    toggle.classList.remove('dim'); if (sp) sp.classList.remove('dim');
    clearTimeout(dimTimer);
    dimTimer = setTimeout(function () {
      if (sheet.hidden) toggle.classList.add('dim');
      var ss = document.querySelector('[data-server-sheet]');
      if (sp && (!ss || ss.hidden)) sp.classList.add('dim');
    }, 6000);
  }
  // The player address in a short frame: a sheet that scrolls says there is more below (the hint is 30 px of its own).
  function more(el) { if (!el.hidden) el.classList.toggle('more', el.scrollTop + el.clientHeight < el.scrollHeight - (el.classList.contains('more') ? 34 : 4)); }
  if (boot.embed) {
    [].forEach.call(document.querySelectorAll('.sheet'), function (el) {
      el.addEventListener('scroll', function () { more(el); });
      try { new MutationObserver(function () { more(el); }).observe(el, { attributes: true, attributeFilter: ['hidden'] }); } catch (e) {}
    });
    addEventListener('resize', function () { [].forEach.call(document.querySelectorAll('.sheet'), more); });
  }
  function open(on) { if (!sheet) return; sheet.hidden = !on; toggle.setAttribute('aria-expanded', on ? 'true' : 'false'); if (on) wake(); else { wake(); try { frame.focus(); } catch (e) {} } }
  function copy(text, done) {
    var ok = function () { flash(done || 'Link copied'); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { flash(text); });
    else flash(text); } catch (e) { flash(text); }
  }
  function shareReady(room) {
    if (!ui) return;
    var link = location.origin + '/' + boot.game + (boot.kind === 'app' ? '/open?room=' : '/play?room=') + encodeURIComponent(room);
    state.link = link;
    ui.querySelector('[data-room-code]').textContent = labelOf(room) + (boot.embed ? ' \u00b7 Site' : '');
    ui.querySelector('[data-room-label]').textContent = labelOf(room);
    ui.querySelector('[data-room-link]').textContent = LOCAL ? 'Deploy to share: this preview address works on this computer only.' : link.replace(/^https?:\/\//, '');
    ui.querySelector('[data-bigscreen]').href = '/' + boot.game + '/tv?room=' + encodeURIComponent(room);
    toggle.addEventListener('click', function (e) { e.stopPropagation(); open(sheet.hidden); });
    ui.querySelector('[data-invite]').addEventListener('click', function () {
      var data = { title: boot.name, text: (boot.appWords ? boot.appWords.open : 'Play') + ' ' + boot.name + ' with me: join my room.', url: link };
      try { if (navigator.share && (!navigator.canShare || navigator.canShare(data))) navigator.share(data).catch(function () { copy(link, 'Invite link copied'); });
      else copy(link, 'Invite link copied'); } catch (e) { copy(link, 'Invite link copied'); }
    });
    ui.querySelector('[data-copy-link]').addEventListener('click', function () { copy(link); });
    document.addEventListener('pointerdown', function (e) { if (!sheet.hidden && !ui.contains(e.target)) open(false); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) open(false); });
    wake();
  }

  function start(room) {
    state.room = room;
    if (boot.embed && keeps) try { sessionStorage.setItem(EMBED_KEY, JSON.stringify({ room: room, name: guestName })); } catch (e) {}
    var studioOpen = document.querySelector('[data-studio-open]');
    if (studioOpen) studioOpen.href = '/' + boot.game + (boot.kind === 'app' ? '/open?room=' : '/play?room=') + encodeURIComponent(room);
    // The room goes into the address: a reload comes back to it, and a copied address brings a friend into it.
    try {
      if (params.get('room') !== room) {
        params.set('room', room);
        params.delete('not');
        history.replaceState(history.state, '', location.pathname + '?' + params.toString() + location.hash);
      }
    } catch (e) {}
    var memoryToken = null;
    var KEY = 'homie-net.' + boot.game + '.' + room + '.' + want;
    // The frame's address, made again for a reload of the game (a newer build, section 23): the seat's token as it is now.
    function frameUrl() {
      var token = memoryToken;
      try { if (keeps) token = sessionStorage.getItem(KEY) || memoryToken; } catch (e) {}
      var q = new URLSearchParams({ room: room, device: device, want: want });
      if (boot.embed) q.set('embed', '1');
      if (token) q.set('k', token);
      q.set('b', roomKey);
      if (boot.embed) q.set('name', guestName);
      if (boot.t) q.set('t', boot.t);
      if (!boot.embed && params.get('name')) q.set('name', params.get('name'));
      else if (!boot.embed) {
        // A player with an account (or a named guest) on this studio plays under their own name in every room.
        try { var who = JSON.parse(localStorage.getItem('homie.player') || 'null'); if (who && typeof who.name === 'string' && who.name) q.set('name', who.name.slice(0, 24)); } catch (e) {}
      }
      // Quiet AI (this browser hides AI speech): the helper starts hushed, and hears a change by message.
      if (state.quietAi) q.set('hush', '1');
      // Room chat (section 19): this browser's "Show chat" and "Show my messages over my character", for the game's bubbles.
      try { if (localStorage.getItem('homie-chat-show') === '0') q.set('chat', '0'); if (localStorage.getItem('homie-chat-bubble') === '0') q.set('bub', '0'); } catch (e) {}
      // The frame cannot read this page's address (it is an opaque origin): hand it the game's own switches (section 24).
      // An allow-list: ?debug and ?q always, the port kit's three, and the names game.json "netplay.params" declares;
      // never one this page uses itself (the room, the token, the ticket). The game reads them as net.params.
      var okValue = new RegExp(boot.paramValue || '^[A-Za-z0-9_.~-]{0,48}$');
      (boot.params || ['debug', 'q', 'touchdebug', 'cam', 'view']).forEach(function (k) { var v = params.get(k); if (v !== null && okValue.test(v)) q.set(k, v); });
      // This page keeps net.prefs for the frame (section 24).
      q.set('pf', '1');
      return '/' + boot.game + '/__game/?' + q.toString();
    }
    state.params = {};
    (boot.params || []).forEach(function (k) { var v = params.get(k); if (v !== null && new RegExp(boot.paramValue || '^$').test(v)) state.params[k] = v; });
    var updating = buildRetry(function () {
      state.stale = null; state.closed = null; state.reloaded = (state.reloaded || 0) + 1;
      frame.src = frameUrl();
    }, function (text) { clearTimeout(flash.t); if (toast) { toast.textContent = text; toast.hidden = !text; } });
    function reloadGame() { updating.request(state.stale && state.stale.ver, state.stale && state.stale.immediate); }
    frame.src = frameUrl();
    A.room(labelOf(room));
    frame.addEventListener('error', updating.failed);
    frame.addEventListener('load', function () { updating.loaded(); A.frameLoaded(); try { frame.focus(); frame.contentWindow.focus(); } catch (e) {} });
    window.addEventListener('pointerdown', function (e) { if ((ui && ui.contains(e.target)) || (e.target.closest && e.target.closest('[data-keep-focus]'))) return; try { frame.focus(); } catch (e2) {} }, { passive: true });
    window.addEventListener('message', function (ev) {
      if (ev.source !== frame.contentWindow) return;
      var m = ev.data;
      if (!m || typeof m !== 'object' || m.t !== 'homie-net') return;
      A.message(m);
      if (m.what === 'wait') updating.stop();
      if (m.what === 'build' && updating.acknowledge(m.ver) && toast) toast.hidden = true;
      if (m.what === 'attached' || m.what === 'ready') updating.reported();
      if (m.what === 'attached') { state.attached = true; lastRects = ''; tellRects(); }
      // The link (section 22): in the room, knocking again, or playing alone because the room never answered.
      if (m.what === 'link' && typeof m.state === 'string') state.link = { state: m.state, why: String(m.why || ''), hosting: m.hosting === true, at: Date.now() };
      // Every seat is taken and this browser asked to play (the room's own word, in its welcome): it watches until one
      // frees up, and the chip says so. Not full any more once it has been seated, or plays by itself.
      if (m.what === 'full') state.full = m.full === true;
      // The game's own word that it was playable (section 21), beside who lifted the card: a late one is a game whose
      // arrival should be 'game'. A performance probe reads both here.
      if (m.what === 'ready') {
        state.ready = { mode: m.mode === 'game' ? 'game' : 'auto', ms: Number(m.ms) || 0, lateMs: typeof m.lateMs === 'number' ? m.lateMs : null, atMs: Math.round(typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) };
        if (A.state) { A.state.explicitMs = state.ready.atMs; A.state.lateMs = state.ready.lateMs; }
      }
      if (m.what === 'prefs') answerPrefs(m);
      // A newer build of the game is live. Kept out of a room for it (final): the game loads again now. Still
      // playing in its own room: it loads again at the round's break, or at once on a big screen (nothing to lose).
      if (m.what === 'rematch' && m.room === room) {
        var fresh = new URL(location.href);
        fresh.searchParams.delete('room'); fresh.searchParams.set('not', room);
        location.replace(fresh.href);
        return;
      }
      if (m.what === 'stale') {
        state.stale = { ver: typeof m.ver === 'string' ? m.ver : null, final: m.final === true, immediate: m.immediate === true };
        if (m.final !== true && m.immediate !== true && !screenMode) updating.stop(true);
        if (m.final === true || m.immediate === true || screenMode) reloadGame();
        else flash('A new version of ' + boot.name + ' is ready: it loads after this round.');
      }
      if (boot.embed && m.what === 'embed-unavailable') { var note = document.querySelector('[data-embed-note]'); if (note) { note.hidden = false; note.textContent = framed ? 'This frame cannot use ' + String(m.feature).slice(0, 30) + '. Open on the studio’s site for full controls.' : String(m.feature).slice(0, 30) + ' is unavailable here: use keys or touch.'; } }
      if (m.what === 'token' && typeof m.token === 'string') { memoryToken = m.token; state.seat = m.seat; if (typeof m.seat === 'number') state.full = false; try { if (keeps) sessionStorage.setItem(KEY, m.token); } catch (e) {} if (window.__homieChat) window.__homieChat.seat(); }
      if (m.what === 'stats') state.stats = m.stats;
      if (m.what === 'round') { onRound(m.round); if (state.stale && m.round && m.round.phase === 'over') reloadGame(); }
      if (m.what === 'roster') state.roster = m.slots;
      // Stopped for good. Removed, or the room closed: the notice. A room with no place left at all: the same notice
      // with its own words, because "try another room" is the only thing a player can do about it.
      if (m.what === 'line') state.gameLine = typeof m.text === 'string' ? m.text.slice(0, 200) : null;
      if (m.what === 'closed') { state.closed = m.why; if (typeof m.message === 'string') state.gameLine = m.message.slice(0, 200); if (m.why === 'kicked' || m.why === 'room-closed' || m.why === 'agents-off') notice(m.why === 'kicked' ? 'kicked' : 'closed', m); else if (m.why === 'room-full' || m.why === 'too-many') notice('full', m); }
      // A game's net.pickPlayer(seat): only an owner's page listens (its overlay opens that player's card).
      if (m.what === 'pick' && (m.seat === null || typeof m.seat === 'number')) { try { window.dispatchEvent(new CustomEvent('homie-pick', { detail: { seat: m.seat } })); } catch (e) {} }
      paint();
    });
    watch(room);
    shareReady(room);
    addEventListener('resize', tellRects);
    if (typeof setInterval === 'function') setInterval(tellRects, 1000);
    if (screenMode && !document.querySelector('[data-join]') && !LOCAL) {
      var h2 = document.createElement('h2'); h2.textContent = 'Join on your phone';
      var div = document.createElement('div'); div.textContent = location.origin + '/' + boot.game + (boot.kind === 'app' ? '/open?room=' : '/play?room=') + encodeURIComponent(room);
      screenCard.append(h2, div); screenCard.hidden = false;
    }
  }

  /*
   * NET.PREFS (NETPLAY.md section 24). The game's frame is an opaque origin (no allow-same-origin: a stranger's game
   * must never read this site's storage, cookies or the owner's session), so its own localStorage throws. This page
   * keeps a few settings for it instead: one JSON object per game under this site's storage, 16 KB and 32 keys at
   * most, read and written only for this page's own game. With no storage (a private window): for the visit.
   */
  var PREFS_KEY = 'homie-prefs.' + boot.game;
  var PREFS = boot.prefs || { bytes: 16384, keys: 32, key: 64 };
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
        // A NaN or an Infinity would be written as null and read back as a setting (a volume of null plays as 0):
        // refused, whatever helper sent it.
        var how = m.op === 'set' && typeof m.v === 'number' && !isFinite(m.v) ? 'value' : prefsWrite(next);
        if (how === 'too-large' || how === 'value') out.why = how; else { out.ok = true; out.kept = how; }
      } else out.why = 'op';
    } catch (e) { out.why = 'error'; }
    state.prefs = { op: m.op, ok: out.ok, why: out.why || null };
    try { frame.contentWindow.postMessage(out, '*'); } catch (e2) {}
  }

  /*
   * WHERE THIS PAGE'S OWN CONTROLS SIT OVER THE GAME (section 24). The frame fills the page, so these rectangles are
   * in the game's own CSS pixels. A game's HUD check that only measures inside the frame cannot see them: the room
   * button, the server pill, the chat pill, the "3 playing" chip (it fades, and comes back), the big screen's join
   * card, the studio's banner. Said to the helper when it attaches, on a resize or a turn, and when one moves.
   */
  var RECTS = [['room', '[data-share-toggle]'], ['server', '[data-server-toggle]'], ['chat', '[data-chat-toggle]'], ['chip', '[data-chip]', true], ['join', '[data-join]'], ['banner', '[data-banner]'], ['ticker', '.ctick', true], ['results', '[data-results]'], ['screen', '[data-screen]'], ['sheet', '[data-share-sheet]'], ['server-sheet', '[data-server-sheet]'], ['vote', '[data-vote]']];
  var lastRects = '';
  function shellRects() {
    var out = [];
    RECTS.forEach(function (r) {
      var el = null;
      try { el = document.querySelector(r[1]); } catch (e) { el = null; }
      if (!el || el.hidden || typeof el.getBoundingClientRect !== 'function') return;
      var b = el.getBoundingClientRect();
      if (!b || !(b.width > 0) || !(b.height > 0)) return;
      var o = { id: r[0], x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
      if (r[2]) o.fades = true;
      out.push(o);
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

  function onRound(r) {
    if (!r) return;
    state.round = r;
    if (r.phase === 'over' && Array.isArray(r.results)) {
      // One entry per finished round (a round is its number AND its end time: an emptied room starts again at 1).
      var key = r.n + ':' + r.endsAt;
      if (!state.results.some(function (x) { return x.key === key; })) state.results.push({ key: key, n: r.n, endsAt: r.endsAt, at: Date.now(), results: r.results });
      results.textContent = '';
      var h = document.createElement('h2'); h.textContent = 'Round ' + r.n;
      var ol = document.createElement('ol');
      r.results.slice(0, 6).forEach(function (row) {
        var li = document.createElement('li');
        li.textContent = String(row.name) + ' — ' + row.score;
        // Every AI row (an agent, or a bot) carries the AI pill.
        if (row.agent || row.bot) { var pill = document.createElement('span'); pill.className = 'aipill'; pill.textContent = 'AI'; li.append(pill); }
        ol.append(li);
      });
      results.append(h, ol); results.hidden = params.get('debug') !== '1'; // the game draws its own results; the card is for ?debug=1
    } else if (r.phase === 'live') results.hidden = true;
  }

  function watch(room) {
    if (state.notice) return;
    var ws;
    var extra = '&b=' + encodeURIComponent(roomKey) + (boot.t ? '&t=' + encodeURIComponent(boot.t) : '');
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/' + boot.game + '/__watch?room=' + encodeURIComponent(room) + extra); }
    catch (e) { setTimeout(function () { watch(room); }, 2000); return; }
    state.watchSocket = ws;
    // Room chat (section 19) speaks on this socket: lines, reactions and what the room keeps of the last minutes.
    if (window.__homieChat) window.__homieChat.socket(ws, room);
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'kicked') { notice('kicked', m); return; }
      if (m.t === 'closed') { notice('closed', m); return; }
      if (m.t === 'announce') { banner(m); return; }
      if (m.t === 'muted') { mutedNote(m); return; }
      if (m.t === 'vote') { onVote(m); return; }
      if (window.__homieChat && window.__homieChat.receive(m)) return;
      if (m.t !== 'net') return;
      if (window.__homieChat) window.__homieChat.facts(m);
      state.facts = m;
      if (typeof m.st === 'number') state.offset = m.st - Date.now();
      if (m.announce && m.announce.text) banner(m.announce, true);
      if (state.facts && state.facts.round) onRound(state.facts.round);
      if (m.vote) onVote(m.vote, true); else if (state.vote && state.vote.open) onVote({ open: false, id: state.vote.id }, true);
      paint();
    };
    ws.onclose = function () { if (!state.notice) setTimeout(function () { watch(room); }, 1500); };
  }

  // The studio's announcement: one line across the top until it ends (its own clock) or the player closes it.
  var shownBanners = {};
  function banner(a, quiet) {
    if (!a || typeof a !== 'object') return;
    var old = document.querySelector('[data-banner]');
    if (!a.text) { if (old && (!a.id || old.getAttribute('data-banner') === a.id)) { old.remove(); state.banner = null; } return; }
    if (quiet && shownBanners[a.id]) return;
    shownBanners[a.id] = true;
    var left = Math.max(3000, Math.min(3600000, (Number(a.until) || 0) - (Number(a.at) || 0) || 30000));
    if (state.facts && state.facts.st && a.until) left = Math.max(1000, Math.min(left, a.until - state.facts.st));
    if (old) old.remove();
    var el = document.createElement('div'); el.className = 'banner'; el.setAttribute('role', 'status'); el.setAttribute('data-banner', String(a.id || '')); el.setAttribute('data-keep-focus', '');
    var b = document.createElement('b'); b.textContent = 'Studio';
    var span = document.createElement('span'); span.textContent = String(a.text).slice(0, 280);
    var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
    x.onclick = function () { el.remove(); state.banner = null; };
    el.append(b, span, x);
    document.body.appendChild(el);
    state.banner = { id: a.id, text: String(a.text) };
    setTimeout(function () { if (el.parentNode) { el.remove(); if (state.banner && state.banner.id === a.id) state.banner = null; } }, left);
  }

  function mutedNote(m) {
    var mins = m.until ? Math.max(1, Math.round((m.until - (state.facts && state.facts.st ? state.facts.st : Date.now())) / 60000)) : 0;
    state.muted = m.until ? { until: m.until } : null;
    flash(m.until ? 'The studio muted you for ' + mins + ' min: your chat and emotes reach nobody.' : 'The studio unmuted you.');
  }

  // A kick or a closed room ends play here: the game frame stops (an older game would otherwise knock again and
  // again), and the page says what happened, when they can come back, and where to play now.
  function notice(kind, m) {
    if (state.notice) return;
    A.lift('notice');
    state.notice = { kind: kind, until: m && m.until ? m.until : null, message: m && m.message ? String(m.message) : '' };
    try { frame.src = 'about:blank'; } catch (e) {}
    if (state.watchSocket) { try { state.watchSocket.close(); } catch (e) {} }
    if (ui) ui.hidden = true;
    var old = document.querySelector('[data-banner]'); if (old) old.remove();
    var nowAt = state.facts && state.facts.st ? state.facts.st : Date.now();
    var mins = state.notice.until ? Math.max(1, Math.ceil((state.notice.until - nowAt) / 60000)) : 0;
    var label = labelOf(state.room || '');
    var box = document.createElement('div'); box.className = 'notice'; box.setAttribute('data-notice', kind); box.setAttribute('role', 'alertdialog'); box.setAttribute('data-keep-focus', '');
    var inner = document.createElement('div'); inner.className = 'box';
    var h = document.createElement('h1'); h.textContent = kind === 'kicked' ? 'You were removed from this room' : kind === 'full' ? 'This room is full' : 'This room is closed';
    var p = document.createElement('p'); p.textContent = kind === 'full' ? label + ' has no place left, to play or to watch. Another room is one tap away.' : state.notice.message || (kind === 'kicked' ? 'The studio removed you from this room.' : 'The studio closed this room. Thanks for playing!');
    var w = document.createElement('p'); w.className = 'when';
    w.textContent = mins ? (kind === 'kicked' ? 'You can come back to ' + label + ' in ' + mins + ' min.' : label + ' opens again in ' + mins + ' min.') : '';
    var acts = document.createElement('div'); acts.className = 'acts';
    var other = document.createElement('a'); other.className = 'primary'; other.href = '/' + boot.game + (boot.kind === 'app' ? '/open?not=' : '/play?not=') + encodeURIComponent(state.room || ''); other.textContent = boot.kind === 'app' ? 'Join another room' : 'Play in another room';
    var back = document.createElement('a'); back.href = '/' + boot.game + '/'; back.textContent = 'Back to ' + boot.name;
    acts.append(other, back);
    inner.append(h, p, w, acts); box.appendChild(inner);
    document.body.appendChild(box);
    say(kind === 'kicked' ? 'removed from this room' : kind === 'full' ? 'room full' : 'room closed');
  }

  function paint() {
    var f = state.facts;
    var n = f && f.counts ? f.counts.players : null;
    var bits = [];
    if (state.server) bits.push(state.server.name);
    if (n !== null) bits.push(n + (boot.kind === 'app' ? ' ' + (n === 1 ? boot.appWords.one : boot.appWords.many) + ' here' : ' playing'));
    // Every AI is counted as AI (agents, the seats kept for them, and the game's bots), never as a player.
    var aiN = f && f.counts ? (Number(f.counts.ai) || 0) + (Number(f.counts.bots) || 0) : 0;
    if (aiN) bits.push(aiN + ' AI');
    if (f && f.counts && f.counts.watchers) bits.push(f.counts.watchers + ' watching');
    if (state.full) bits.push('waiting for a seat');
    // Stopped for good: nothing is knocking any more, so it never says "reconnecting". What is true, in a word.
    if (state.gameLine) bits.push(state.gameLine);
    else if (state.closed) bits.push({ replaced: 'opened in another tab', 'room-full': 'room full', 'too-many': 'room full', stale: 'updating…', kicked: 'removed from this room', 'room-closed': 'room closed', 'agents-off': 'room closed' }[state.closed] || 'disconnected: reload to play');
    // The link (section 22): cut off from a room it was in and knocking again ("reconnecting" is true only then), or
    // playing by itself because the room never answered, or did not come back in time.
    else if (state.link && state.link.state === 'reconnecting') bits.push('reconnecting');
    else if (state.link && state.link.state === 'alone') bits.push(state.link.why === 'reconnect-timeout' ? 'playing on your own: the room dropped' : 'playing on your own: looking for the room');
    // The arrival card's line: the room and who is in it ("Room 2 · 3 playing · 2 AI").
    if (!A.done && state.room) A.facts([labelOf(state.room), n ? n + (boot.kind === 'app' ? ' ' + (n === 1 ? boot.appWords.one : boot.appWords.many) + ' here' : ' playing') : '', aiN ? aiN + ' AI' : ''].filter(Boolean).join(' · '));
    say(bits.join(' · ') || 'joining…');
    var count = ui && ui.querySelector('[data-room-count]');
    if (count && n !== null) count.textContent = n + ' ' + (boot.appWords ? (n === 1 ? boot.appWords.one : boot.appWords.many) : (n === 1 ? 'player' : 'players')) + ' here' + (aiN ? ' · ' + aiN + ' AI' : '');
    serverUi();
  }

  /* ---------------------------------------------------------- the server pill, Quiet AI and the vote (section 17) */
  var SKILL = boot.skills || [];
  var sToggle = document.querySelector('[data-server-toggle]');
  var sSheet = document.querySelector('[data-server-sheet]');
  var voteCard = document.querySelector('[data-vote]');
  try { state.quietAi = localStorage.getItem('homie-quiet-ai') === '1'; } catch (e) { state.quietAi = false; }
  function skillName(n) { var s = SKILL[n - 1]; return s ? s.name : 'level ' + n; }
  function hasAi() { var f = state.facts; return Boolean(f && f.counts && (f.counts.ai || f.counts.bots || f.counts.agents)); }
  function readsDial() { var f = state.facts; return Boolean(f && Array.isArray(f.caps) && f.caps.indexOf('skill') >= 0); }
  // The room's live policy says the badge and line (the owner's change reaches an open page at once); the
  // server's words from the page load are the fallback.
  function policyText(pol) {
    var w = pol && boot.words ? boot.words[pol.kind] : null;
    if (!w) return state.server ? { badge: state.server.badge, line: state.server.line } : { badge: 'Open', line: boot.kind === 'app' ? 'Open: join this screen together.' : 'Open: anyone can play. AI players are always marked AI.' };
    var n = pol.kind === 'hybrid' ? (Number(pol.aiSeats) || 0) : 0;
    return { badge: pol.kind === 'hybrid' ? w.badge + ' · ' + n : w.badge, line: w.line.replace('{n}', String(n)) + (pol.kids && boot.kidsLine ? ' ' + boot.kidsLine : '') };
  }
  function serverUi() {
    if (!sToggle || !sSheet) return;
    var f = state.facts; var pol = f && f.policy ? f.policy : null;
    var show = Boolean(state.server) || (hasAi() && readsDial());
    sToggle.hidden = !show;
    if (!show) return;
    var name = state.server ? state.server.name : 'Quick play';
    var words = policyText(pol);
    var label = name + ' · ' + words.badge + (state.server && state.server.mentor ? ' · Mentor' : '');
    var labelEl = sToggle.querySelector('[data-server-label]');
    // A new policy (the owner's change) shows in full for a moment, then fades with the room pill.
    if (labelEl.textContent !== label) { labelEl.textContent = label; sToggle.setAttribute('aria-label', label + ': this server'); wake(); }
    sSheet.querySelector('[data-server-name]').textContent = name;
    sSheet.querySelector('[data-server-badge]').textContent = words.badge;
    sSheet.querySelector('[data-server-line]').textContent = words.line;
    var row = sSheet.querySelector('[data-level-row]');
    row.hidden = !(readsDial() && hasAi() && boot.vote !== false);
    if (pol && pol.skill) sSheet.querySelector('[data-level-name]').textContent = pol.skill.name;
    sSheet.querySelector('[data-quiet-ai]').checked = state.quietAi;
  }
  if (sToggle) {
    sToggle.addEventListener('click', function (e) { e.stopPropagation(); var on = sSheet.hidden; sSheet.hidden = !on; sToggle.setAttribute('aria-expanded', on ? 'true' : 'false'); if (on && sheet) open(false); wake(); });
    document.addEventListener('pointerdown', function (e) { if (!sSheet.hidden && !sSheet.contains(e.target) && e.target !== sToggle && !sToggle.contains(e.target)) { sSheet.hidden = true; sToggle.setAttribute('aria-expanded', 'false'); } }, true);
    sSheet.querySelector('[data-quiet-ai]').addEventListener('change', function (e) {
      state.quietAi = e.target.checked;
      try { localStorage.setItem('homie-quiet-ai', state.quietAi ? '1' : '0'); } catch (e2) {}
      try { frame.contentWindow.postMessage({ t: 'homie-hush', on: state.quietAi }, '*'); } catch (e3) {}
      flash(state.quietAi ? 'AI chat is hidden on this screen.' : 'AI chat shows again.');
    });
    sSheet.querySelector('[data-level-vote]').addEventListener('click', function () { sendVote({ open: true }); sSheet.hidden = true; sToggle.setAttribute('aria-expanded', 'false'); });
  }
  function sendVote(m) {
    var ws = state.watchSocket;
    if (!ws || ws.readyState !== 1) { flash('Not connected yet; try again in a moment.'); return; }
    try { ws.send(JSON.stringify(Object.assign({ t: 'vote', of: 'skill' }, m))); } catch (e) {}
  }
  function cast(n) { if (!state.vote || !state.vote.open) return; state.myVote[state.vote.id] = n; sendVote({ n: n }); renderVote(); }
  var shownResults = {};
  function onVote(v, quiet) {
    if (!v || typeof v !== 'object') return;
    if (v.t === 'error' || v.code) return;
    var prev = state.vote;
    state.vote = v.options ? v : (prev && prev.id === v.id ? Object.assign({}, prev, { open: false }) : prev);
    if (v.result && !v.open && !shownResults[v.id] && !quiet) {
      shownResults[v.id] = true;
      flash('The party set the AI to ' + v.result.name + ' (' + v.result.votes + (v.result.votes === 1 ? ' vote' : ' votes') + ').');
    } else if (v.result && !v.open) shownResults[v.id] = true;
    renderVote();
  }
  var voteTimer = null;
  function renderVote() {
    var v = state.vote;
    if (!voteCard) return;
    // A game that draws its own card (game.json "agents": { "vote": "game" }), or no vote: the shell shows none.
    if (!v || !v.open || boot.vote !== 'shell' || boot.screen || state.seat === null || state.seat === undefined) { voteCard.hidden = true; clearInterval(voteTimer); voteTimer = null; return; }
    var left = Math.max(0, Math.ceil((v.until - (Date.now() + (state.offset || 0))) / 1000));
    var mine = state.myVote[v.id];
    voteCard.textContent = '';
    var head = document.createElement('div'); head.className = 'vh';
    var t = document.createElement('b'); t.textContent = 'How strong should the AI be?';
    var sub = document.createElement('span'); sub.textContent = 'for this party · ' + left + ' s';
    head.append(t, sub);
    var opts = document.createElement('div'); opts.className = 'opts'; opts.style.setProperty('--n', String(v.options.length));
    v.options.forEach(function (n) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-vote-n', String(n));
      b.setAttribute('aria-pressed', mine === n ? 'true' : 'false');
      var big = document.createElement('b'); big.textContent = n + ' ' + skillName(n);
      var small = document.createElement('small'); small.textContent = (v.counts && v.counts[n] ? v.counts[n] + (v.counts[n] === 1 ? ' vote' : ' votes') : '\u00a0');
      b.append(big, small);
      b.addEventListener('click', function () { cast(n); });
      opts.appendChild(b);
    });
    var legend = document.createElement('div'); legend.className = 'legend';
    var l1 = document.createElement('span'); l1.textContent = SKILL[0] ? SKILL[0].card.split(',')[0] : 'stays at the back';
    var l2 = document.createElement('span'); var top = SKILL[v.options.length - 1]; l2.textContent = top ? top.card.split(',')[0] : '';
    legend.append(l1, document.createElement('i'), l2);
    var foot = document.createElement('div'); foot.className = 'foot';
    foot.textContent = (v.voters || 0) + ' of ' + (v.of_total || 1) + ' voted · the middle vote wins';
    voteCard.append(head, opts, legend, foot);
    voteCard.hidden = false;
    if (!voteTimer) voteTimer = setInterval(renderVote, 500);
  }
  document.addEventListener('keydown', function (e) {
    if (!state.vote || !state.vote.open || voteCard.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    var n = Number(e.key);
    if (state.vote.options.indexOf(n) >= 0) { e.preventDefault(); cast(n); }
  });

  if (boot.embed) {
    state.openStudio = function (href) {
      if (!framed) { location.assign(href); return; }
      var opened = null;
      try { opened = window.open(href, '_blank'); if (opened) opened.opener = null; } catch (e) {}
      if (!opened) {
        open(true);
        var note = document.querySelector('[data-embed-note]');
        note.hidden = false; note.textContent = 'This host blocked opening a tab. Copy this address into your browser: ' + new URL(href, location.href).href;
      }
    };
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var u = new URL(a.href, location.href);
      if (u.origin === location.origin && u.pathname === '/' + boot.game + (boot.kind === 'app' ? '/open/embed' : '/play/embed')) return;
      e.preventDefault(); state.openStudio(a.href);
    }, true);
    if (self.origin === 'null') {
      A.lift(); open(true);
      var note = document.querySelector('[data-embed-note]');
      note.hidden = false; note.textContent = 'This host prevents connecting. Open on the studio’s site.';
      say('Open on the studio’s site');
      return;
    }
  }

  // A named room (?room=, a friend's link, a test, the big screen's QR) skips the lobby; everyone else meets strangers.
  // The page refuses a code it cannot use before it gets here, so an asked room is never swapped for a public one.
  var askedRoom = params.get('room');
  if (boot.embed) {
    // The player address never takes a room from its address. A reload, Back or Forward goes back to the room this
    // visit was in (as Play's own address does); a fresh arrival asks the lobby where people are.
    var arrived = '';
    try { arrived = performance.getEntriesByType('navigation')[0].type; } catch (e) {}
    askedRoom = kept && (arrived === 'reload' || arrived === 'back_forward') && EMBED_ROOM.test(kept.room || '') ? kept.room : null;
  }
  var lobbyQ = [];
  if (state.server) lobbyQ.push('server=' + encodeURIComponent(state.server.id));
  if (/^[A-Za-z0-9_,-]{1,140}$/.test(params.get('not') || '')) lobbyQ.push('not=' + encodeURIComponent(params.get('not')));
  // Once the game has the screen, the chip says the room's facts for a few seconds, then gets out of the way.
  window.addEventListener('homie-arrived', function () { paint(); });
  if (boot.room) start(boot.room);
  else if (askedRoom !== null && /^[A-Za-z0-9_-]{1,32}$/.test(askedRoom)) start(askedRoom);
  else if (askedRoom !== null) { say('that room link does not work'); }
  else fetch('/' + boot.game + '/api/lobby' + (lobbyQ.length ? '?' + lobbyQ.join('&') : ''), { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      // Every room this server may have is full: the fullest one, watched until a seat frees (the relay seats it).
      if (j.full) { state.full = true; flash((state.server ? state.server.name : 'This server') + ' is full. You\u2019re next for a seat.'); A.full((state.server ? state.server.name : 'This server') + ' is full: you\u2019re next for a seat…'); }
      start(j.room || 'main');
    })
    .catch(function () { start('main'); });
}());`;

/*
 * THE OWNER IN THEIR OWN GAME (0.13.0). Only a page served to the studio's signed-in owner carries this (the
 * Worker checks the owner's session before it adds it; nobody else's page has a byte of it): a small Owner button
 * in a corner the room button does not use, and a sheet with everyone in this room. A tap on a player shows who they
 * are, with Mute and Kick; Announce reaches this room or every room of the game. The controls go to the studio's
 * own /_studio/api with the owner's session (an HttpOnly cookie; the game's sandboxed frame can neither read it nor
 * send it). A game can open a player's card itself: `net.pickPlayer(seat)` (a click on that player's body).
 */
const OWNER_CSS = `.owner { position: fixed; z-index: 10; top: max(8px, env(safe-area-inset-top)); left: max(8px, env(safe-area-inset-left)); font: 600 13px/1.25 ui-sans-serif, system-ui, -apple-system, sans-serif; color: #eef1f8; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.owner.at-right { align-items: flex-end; }
.owner.up { flex-direction: column-reverse; }
.owner .opill { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px 0 9px; border-radius: 999px; border: 1px solid #c9b8ff; background: rgba(12,8,24,.7); color: #e6dcff; font: inherit; cursor: pointer; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); touch-action: manipulation; }
.owner .opill i { width: 8px; height: 8px; border-radius: 50%; background: #c9b8ff; }
.osheet { box-sizing: border-box; width: min(340px, calc(100vw - 16px)); max-height: min(560px, calc(100vh - 70px)); overflow: auto; padding: 12px; border-radius: 16px; background: rgba(10,8,20,.96); border: 1px solid rgba(201,184,255,.35); box-shadow: 0 18px 50px rgba(0,0,0,.55); -webkit-user-select: text; user-select: text; touch-action: manipulation; }
.osheet h2 { margin: 2px 2px 8px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #c9b8ff; display: flex; justify-content: space-between; gap: 8px; }
.osheet h2 a { color: #aab3c7; text-transform: none; letter-spacing: 0; font-weight: 600; text-decoration: none; }
.osheet .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 8px 10px; margin: 0 0 6px; border-radius: 11px; border: 1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.03); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.osheet .row:hover { border-color: rgba(201,184,255,.5); }
.osheet .row small { color: #9aa3b7; font-weight: 500; }
.osheet .tag { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(255,255,255,.2); color: #aab3c7; margin-left: 6px; }
.osheet .tag.you { color: #c9b8ff; border-color: #c9b8ff; }
.osheet .tag.muted { color: #ff8a9a; border-color: rgba(255,107,125,.6); }
.osheet .tag.ai { color: #ffe7a8; border-color: rgba(255,207,90,.6); }
.osheet .bot { color: #6c7489; font-weight: 500; padding: 2px 10px 8px; }
.osheet .det { padding: 4px 2px; }
.osheet .det b { font-size: 18px; display: block; margin-bottom: 4px; overflow-wrap: anywhere; }
.osheet .det p { margin: 0 0 4px; color: #aab3c7; font-weight: 500; }
.osheet .acts { display: flex; gap: 8px; margin: 12px 0 4px; flex-wrap: wrap; }
.osheet .acts button, .osheet form button { min-height: 40px; padding: 0 14px; border-radius: 11px; font: inherit; font-weight: 800; cursor: pointer; border: 1px solid rgba(255,255,255,.18); background: transparent; color: inherit; }
.osheet .acts .kick { color: #ff8a9a; border-color: rgba(255,107,125,.55); }
.osheet .acts .kick.armed { background: #ff6b7d; color: #16080a; }
.osheet .acts .mute { color: #ffc27a; border-color: rgba(255,179,92,.55); }
.osheet .back { background: none; border: 0; color: #aab3c7; font: inherit; padding: 4px 0; cursor: pointer; }
.osheet form { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.10); display: grid; gap: 8px; }
.osheet textarea, .osheet select { box-sizing: border-box; width: 100%; font: 500 14px/1.35 ui-sans-serif, system-ui, sans-serif; color: inherit; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.16); border-radius: 10px; padding: 8px 10px; }
.osheet textarea { min-height: 58px; resize: vertical; }
.osheet form button { background: #c9b8ff; color: #120a24; border-color: transparent; }
.osheet .msg { color: #aab3c7; font-weight: 500; min-height: 1.2em; margin: 6px 2px 0; }`;

const OWNER_JS = String.raw`(function () {
  'use strict';
  var boot = window.__HOMIE_PLAY; var state = window.__shell;
  if (!boot || !boot.owner || !state || boot.screen) return;
  var HOLD = 10;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
  // Beside the room button, on its inner side: the game already keeps that edge clear of its own HUD
  // (game.json screen.share), so the owner's button never sits on a scoreboard or a stick.
  var root = el('div', 'owner'); root.setAttribute('data-owner', ''); root.setAttribute('data-keep-focus', '');
  var pill = el('button', 'opill'); pill.type = 'button'; pill.setAttribute('aria-expanded', 'false'); pill.appendChild(el('i')); pill.appendChild(el('span', '', 'Owner'));
  var sheet = el('div', 'osheet'); sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Owner');
  root.append(pill, sheet); document.body.appendChild(root);
  var toggleEl = document.querySelector('[data-share-toggle]');
  function placeOwner() {
    var r = toggleEl ? toggleEl.getBoundingClientRect() : null;
    if (!r || !r.width) return;
    var right = r.left + r.width / 2 > innerWidth / 2;
    var low = r.top > innerHeight / 2;
    root.classList.toggle('at-right', right); root.classList.toggle('up', low);
    root.style.top = low ? '' : Math.round(r.top) + 'px';
    root.style.bottom = low ? Math.round(innerHeight - r.bottom) + 'px' : '';
    root.style.left = right ? '' : Math.round(r.right + 8) + 'px';
    root.style.right = right ? Math.round(innerWidth - r.left + 8) + 'px' : '';
  }
  placeOwner();
  addEventListener('resize', placeOwner);
  try { new ResizeObserver(placeOwner).observe(toggleEl); } catch (e) { setInterval(placeOwner, 500); }
  var view = { pick: null, msg: '', armed: null, armedAt: 0 };
  function post(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, message: 'HTTP ' + r.status }; }); })
      .catch(function () { return { ok: false, message: 'The studio did not answer.' }; });
  }
  function clients() { var f = state.facts; return (f && Array.isArray(f.clients) ? f.clients : []).filter(function (c) { return c.seat !== null || c.waiting; }); }
  function bots() { var f = state.facts; return (f && Array.isArray(f.roster) ? f.roster : []).filter(function (s) { return s && s.bot; }); }
  function mins(ms) { var m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? 'under a minute' : m + ' min'; }
  var drawn = '';
  function render(force) {
    if (sheet.hidden) return;
    var active = document.activeElement; if (active && sheet.contains(active) && /TEXTAREA|SELECT/.test(active.tagName)) return;
    // Redraw only when something it shows changed (a button under a finger is never swapped mid-tap).
    var armedOn = view.armed !== null && Date.now() - view.armedAt < 4000 ? view.armed : null;
    var sig = JSON.stringify([state.room, state.seat, view.pick, view.msg, armedOn, clients().map(function (c) { return [c.id, c.name, c.seat, c.muted, c.role, c.device]; }), bots().map(function (b) { return b.name; })]);
    if (!force && sig === drawn) return;
    drawn = sig;
    sheet.textContent = '';
    var h = el('h2'); h.appendChild(el('span', '', 'Owner · ' + (state.room ? (/^pub-(\d+)$/.test(state.room) ? 'Room ' + state.room.slice(4) : state.room) : 'this room')));
    var office = el('a', '', 'Office ↗'); office.href = '/_studio/office'; office.target = '_blank'; office.rel = 'noopener'; h.appendChild(office);
    sheet.appendChild(h);
    var list = clients();
    var picked = view.pick === null ? null : list.filter(function (c) { return c.id === view.pick || (typeof view.pick === 'number' && c.seat === view.pick); })[0];
    if (picked) {
      var me = picked.seat !== null && picked.seat === state.seat;
      var back = el('button', 'back', '← Everyone here'); back.type = 'button'; back.onclick = function () { view.pick = null; view.msg = ''; render(); };
      var det = el('div', 'det');
      det.appendChild(el('b', '', picked.name || 'Someone'));
      det.appendChild(el('p', '', (picked.seat !== null ? 'Seat ' + (picked.seat + 1) : 'Watching') + ' · ' + (picked.agent ? 'an AI (' + (picked.agent.role === 'guide' ? 'a guide' : 'a companion') + '), always marked AI' : picked.device === 'phone' ? 'on a phone' : picked.device === 'tv' ? 'a big screen' : 'on a computer') + (picked.role === 'host' ? ' · hosting the room' : '')));
      if (me) det.appendChild(el('p', '', 'This is you.'));
      if (picked.muted) det.appendChild(el('p', '', 'Muted: their chat and emotes reach nobody.'));
      sheet.append(back, det);
      if (!me) {
        var acts = el('div', 'acts');
        var mute = el('button', 'mute', picked.muted ? 'Unmute' : 'Mute ' + HOLD + ' min'); mute.type = 'button';
        mute.onclick = function () { mute.disabled = true; post('/_studio/api/mute', { game: boot.game, room: state.room, id: picked.id, minutes: HOLD, off: Boolean(picked.muted) }).then(function (r) { view.msg = r.ok ? (picked.muted ? 'Unmuted.' : 'Muted for ' + HOLD + ' min.') : (r.message || 'That did not work.'); render(); }); };
        // A kick takes a second tap within 4 s (the sheet redraws meanwhile, so the arming is remembered here).
        var armedNow = view.armed === picked.id && Date.now() - view.armedAt < 4000;
        var kick = el('button', 'kick' + (armedNow ? ' armed' : ''), armedNow ? 'Sure? Kick' : 'Kick ' + HOLD + ' min'); kick.type = 'button';
        kick.onclick = function () {
          if (!(view.armed === picked.id && Date.now() - view.armedAt < 4000)) { view.armed = picked.id; view.armedAt = Date.now(); render(); setTimeout(render, 4050); return; }
          view.armed = null;
          kick.disabled = true;
          post('/_studio/api/kick', { game: boot.game, room: state.room, id: picked.id, minutes: HOLD }).then(function (r) { view.msg = r.ok ? (picked.name || 'They') + ' was removed for ' + HOLD + ' min.' : (r.message || 'That did not work.'); if (r.ok) view.pick = null; render(); });
        };
        acts.append(mute, kick); sheet.appendChild(acts);
      }
    } else {
      if (!list.length) sheet.appendChild(el('p', 'msg', 'Nobody else is here yet.'));
      list.forEach(function (c) {
        var row = el('button', 'row'); row.type = 'button';
        var left = el('span'); left.appendChild(el('span', '', c.name || 'Someone'));
        if (c.seat !== null && c.seat === state.seat) left.appendChild(el('span', 'tag you', 'you'));
        if (c.muted) left.appendChild(el('span', 'tag muted', 'muted'));
        if (c.agent) left.appendChild(el('span', 'tag ai', 'AI' + (c.agent.role === 'guide' ? ' guide' : c.agent.role === 'party' ? ' companion' : '')));
        if (c.role === 'host') left.appendChild(el('span', 'tag', 'host'));
        row.append(left, el('small', '', c.seat !== null ? 'seat ' + (c.seat + 1) + ' · ' + (c.device === 'phone' ? 'phone' : c.device === 'tv' ? 'screen' : 'computer') : 'waiting'));
        row.onclick = function () { view.pick = c.id; view.msg = ''; render(); };
        sheet.appendChild(row);
      });
      var b = bots(); if (b.length) sheet.appendChild(el('div', 'bot', 'AI bots: ' + b.map(function (s) { return s.name; }).join(', ')));
    }
    var form = el('form'); form.setAttribute('data-announce', '');
    var ta = el('textarea'); ta.maxLength = 280; ta.placeholder = 'Announce something to the players'; ta.setAttribute('aria-label', 'Announcement');
    var scope = el('select'); var o1 = el('option', '', 'This room'); o1.value = 'room'; var o2 = el('option', '', 'Every room of ' + boot.name); o2.value = 'game'; scope.append(o1, o2);
    var send = el('button', '', 'Announce'); send.type = 'submit';
    form.append(ta, scope, send);
    form.onsubmit = function (e) {
      e.preventDefault(); if (!ta.value.trim()) return; send.disabled = true;
      post('/_studio/api/announce', scope.value === 'room' ? { game: boot.game, room: state.room, text: ta.value } : { game: boot.game, text: ta.value }).then(function (r) {
        view.msg = r.ok ? 'Announced to ' + (r.people || 0) + (r.people === 1 ? ' person' : ' people') + '.' : (r.message || 'That did not work.');
        if (r.ok) ta.value = ''; send.disabled = false; ta.blur(); render();
      });
    };
    sheet.appendChild(form);
    sheet.appendChild(el('p', 'msg', view.msg));
  }
  function open(on) { sheet.hidden = !on; pill.setAttribute('aria-expanded', on ? 'true' : 'false'); if (on) render(true); }
  pill.onclick = function (e) { e.stopPropagation(); open(sheet.hidden); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) open(false); });
  // A game that knows its players' bodies opens one's card (net.pickPlayer(seat), posted by its frame).
  window.addEventListener('homie-pick', function (e) { var seat = e.detail && e.detail.seat; if (seat === null || typeof seat === 'number') { view.pick = seat; view.msg = ''; open(true); } });
  window.__ownerPick = function (seat) { view.pick = seat; view.msg = ''; open(true); };
  setInterval(render, 1500);
  window.__owner = { open: open, render: render };
}());`;

/*
 * WATCH ANY PLAYER (0.15.0, NETPLAY.md section 16). /<game>/watch?room=<room>[&follow=<seat>|auto|overview] is the
 * game itself, rendered by this browser as a watcher: a screen that never takes a seat. A strip of the room's players
 * switches whose view it renders (a tap, keys 1-9, A for Auto, O for the whole room); Auto follows the action. The
 * game draws the followed player's camera and HUD (its netplay helper's `viewSeat`); a game that does not shows its
 * overview, and the strip says so. A game with hidden hands or roles says `"watch": "overview"` in game.json: its
 * watchers see the whole room only. A private or invite-only game is watched only by whoever may play it (the door
 * is the play door's). Every name a player typed is set with textContent.
 */
export function watchPage(cat, g, { origin = '', room = null, ticket = null, policy = 'follow', owner = false, acct = false, member = false } = {}) {
  const accent = cat?.studio?.theme?.accent ?? '#ffcf5a';
  const hot = /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : '#ffcf5a';
  const boot = { ...(g.kind === 'app' ? { kind: 'app', screen: true, role: g.surfaces?.wall, params: playParams(g) } : {}), game: g.id, name: g.name, policy, palette: NET_PALETTE, ...(room ? { room } : {}), ...(ticket ? { t: ticket } : {}) };
  const css = `:root{--hot:${hot}}${WATCH_CSS}${CHAT_CSS}${g.kind === 'app' ? '.dock{display:none}' : ''}`;
  return layoutless(`Watch ${g.name}`, `
<header class="wtop" data-top>
  <span class="live" data-live><i aria-hidden="true"></i><b>Live</b></span>
  <span data-update role="status" hidden></span>
  <span class="what"><b>${esc(g.name)}</b><span data-room-label>finding a room…</span></span>
  <span class="clock" data-clock hidden></span>
  <span class="grow"></span>
  <span class="eyes" data-eyes hidden title="Watching this room"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><span data-eyes-n></span><span class="eyes-w"> watching</span></span>
  <a class="playb" data-playb href="${esc(openPath(g))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l12-7.2a1 1 0 0 0 0-1.72l-12-7.2A1 1 0 0 0 7 4.8Z" fill="currentColor"/></svg><span>${esc(appWords(g).open)}</span></a>
</header>
<main class="stage"><iframe class="game" title="${esc(g.name)}, live" tabindex="-1" sandbox="allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups" allow="fullscreen *; autoplay *; gamepad *"></iframe></main>
<footer class="dock">
  <div class="caption" data-caption role="status" aria-live="polite"><b data-cap-head>Joining the room…</b><span data-cap-sub></span></div>
  <nav class="strip" data-strip role="toolbar" aria-label="Whose view to watch"></nav>
</footer>
<div class="wnote" data-note hidden></div>
<script>window.__HOMIE_WATCH=${JSON.stringify(boot).replace(/</g, '\\u003c')};</script>
<script>window.__HOMIE_CHAT=${JSON.stringify(chatBoot(g, { surface: 'watch', owner, acct, member })).replace(/</g, '\\u003c')};</script>
<script>${CHAT_JS}</script>${owner ? `<script>${CHAT_OWNER_JS}</script>` : ''}
<script>${WATCH_JS}</script>${g.kind === 'app' ? `<script>${APP_SHELL_JS}</script>` : ''}`, css, frameAncestors(cat), { head: gameSocialTags(cat, g, origin) });
}

/*
 * The watch page is a broadcast: a band above the game (live, the game and room, the clock, who is watching, Play),
 * the game in between, and a dock below (whose view this is, and the players to switch between). Nothing covers the
 * game's own picture or HUD: every game draws its clock and board where it likes.
 */
const WATCH_CSS = `
html, body { height: 100%; margin: 0; overflow: hidden; overscroll-behavior: none; background: #05070d; color: #eef1f8; -webkit-tap-highlight-color: transparent; }
body { --u: clamp(12px, calc(0.8vmin + 7px), 22px); --band: #080b14; --line: rgba(255,255,255,.08); display: flex; flex-direction: column; font: 600 var(--u)/1.25 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
body.big { --u: clamp(16px, calc(1vmin + 6px), 32px); }
.stage { position: relative; flex: 1; min-height: 0; background: #04060c; }
iframe.game { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; background: #04060c; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.wtop { flex: none; display: flex; align-items: center; gap: calc(var(--u) * .7); padding: max(calc(var(--u) * .5), env(safe-area-inset-top)) max(calc(var(--u) * .9), env(safe-area-inset-right)) calc(var(--u) * .5) max(calc(var(--u) * .9), env(safe-area-inset-left)); background: linear-gradient(#0b0f1a, var(--band)); border-bottom: 1px solid var(--line); min-width: 0; }
.grow { flex: 1; }
.live { flex: none; display: inline-flex; align-items: center; gap: .45em; padding: .3em .7em .3em .6em; border-radius: 999px; background: rgba(255,59,92,.16); border: 1px solid rgba(255,90,120,.5); font-weight: 800; font-size: .74em; letter-spacing: .14em; text-transform: uppercase; color: #ffd9e0; }
.live i { width: .62em; height: .62em; border-radius: 50%; background: #ff3b5c; box-shadow: 0 0 10px #ff3b5c; animation: pulse 1.6s ease-in-out infinite; }
.live.off { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.18); color: #aab3c7; }
.live.off i { background: #6c7489; box-shadow: none; animation: none; }
@keyframes pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .live i { animation: none; } }
.what { display: flex; align-items: baseline; gap: .55em; min-width: 0; }
.what b { font-weight: 800; font-size: 1.05em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.what span { color: #9aa3b7; font-size: .86em; font-weight: 600; white-space: nowrap; }
.clock { flex: none; padding: .26em .7em; border-radius: 9px; background: rgba(255,255,255,.05); border: 1px solid var(--line); font-variant-numeric: tabular-nums; font-weight: 800; white-space: nowrap; }
.eyes { flex: none; display: inline-flex; align-items: center; gap: .35em; color: #b9c1d3; font-variant-numeric: tabular-nums; font-size: .9em; }
.eyes svg { width: 1.2em; height: 1.2em; }
.playb { flex: none; display: inline-flex; align-items: center; gap: .45em; min-height: 2.4em; padding: 0 1em 0 .8em; border-radius: 11px; background: var(--hot); color: #0b0b10; font-weight: 800; text-decoration: none; }
.playb:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.playb svg { width: 1em; height: 1em; }
.dock { flex: none; display: flex; align-items: center; gap: calc(var(--u) * .9); padding: calc(var(--u) * .55) max(calc(var(--u) * .9), env(safe-area-inset-right)) max(calc(var(--u) * .55), env(safe-area-inset-bottom)) max(calc(var(--u) * .9), env(safe-area-inset-left)); background: linear-gradient(var(--band), #0b0f1a); border-top: 1px solid var(--line); min-width: 0; }
.caption { flex: 0 1 auto; min-width: 0; max-width: 34%; display: flex; flex-direction: column; gap: .1em; }
.caption b { font-weight: 800; font-size: 1.08em; display: flex; align-items: center; gap: .5em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.caption b .dot { width: .72em; height: .72em; border-radius: 50%; flex: none; }
.caption span { color: #9aa3b7; font-size: .82em; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.strip { flex: 1; min-width: 0; display: flex; gap: calc(var(--u) * .45); overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; touch-action: pan-x; padding: 3px 2px; }
.strip::-webkit-scrollbar { display: none; }
.strip > :first-child { margin-left: auto; }
.strip > :last-child { margin-right: auto; }
.chip { flex: none; display: inline-flex; align-items: center; gap: .5em; min-height: 2.6em; max-width: 15em; padding: 0 .9em 0 .5em; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.035); color: #e8ecf5; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; transition: border-color .2s, background .2s; }
.chip:hover { border-color: rgba(255,255,255,.4); }
.chip:focus-visible { outline: 2px solid var(--hot); outline-offset: 2px; }
.chip[aria-pressed="true"] { border-color: var(--hot); background: color-mix(in srgb, var(--hot) 16%, transparent); box-shadow: inset 0 0 0 1px var(--hot); }
.chip.auto-on { border-color: color-mix(in srgb, var(--hot) 55%, rgba(255,255,255,.2)); }
.chip[disabled] { cursor: default; padding-left: .8em; }
.chip[disabled]:hover { border-color: rgba(255,255,255,.14); }
.chip .k { display: inline-grid; place-items: center; min-width: 1.45em; height: 1.45em; padding: 0 .2em; border-radius: 6px; background: rgba(255,255,255,.08); color: #9aa3b7; font-size: .76em; font-weight: 800; box-sizing: border-box; }
.chip .dot { width: .8em; height: .8em; border-radius: 50%; flex: none; }
.chip .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip .sc { color: #9aa3b7; font-variant-numeric: tabular-nums; font-weight: 800; }
.chip .sc.lead { color: var(--hot); }
.chip svg { width: 1.1em; height: 1.1em; flex: none; }
.chip .tag { font-size: .68em; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--hot); }
.chip .tag.ai { padding: .1em .45em; border-radius: 999px; background: color-mix(in srgb, var(--hot) 20%, transparent); color: #fff; letter-spacing: .06em; }
.hint { flex: none; align-self: center; color: #7d8699; font-size: .76em; font-weight: 600; padding: 0 .2em; white-space: nowrap; }
@media (hover: none) { .chip .k, .hint { display: none; } }
/* A phone held upright: the caption over the strip, the strip scrolling sideways. */
@media (max-width: 640px) {
  .dock { flex-direction: column; align-items: stretch; gap: calc(var(--u) * .45); }
  .caption { max-width: none; align-items: center; text-align: center; }
  .chip { max-width: 10.5em; min-height: 2.75em; }
  .what span, .eyes-w { display: none; }
}
/* Not much height (a phone on its side): thinner bands. */
@media (max-height: 460px) {
  .wtop, .dock { padding-top: 4px; padding-bottom: max(4px, env(safe-area-inset-bottom)); }
  .caption span { display: none; }
  .chip { min-height: 2.3em; }
}
body.idle { cursor: none; }
.wnote { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 20px; background: rgba(4,6,12,.8); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.wnote .box { box-sizing: border-box; width: min(440px, 100%); padding: calc(var(--u) * 1.5); border-radius: 20px; background: #0d111c; border: 1px solid rgba(255,255,255,.14); box-shadow: 0 24px 70px rgba(0,0,0,.55); }
.wnote h1 { margin: 0 0 .4em; font-size: 1.5em; letter-spacing: -.01em; }
.wnote p { margin: 0 0 .7em; color: #c3cad9; font-weight: 500; line-height: 1.45; }
.wnote .acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 1em; }
.wnote .acts a { display: inline-flex; align-items: center; min-height: 2.9em; padding: 0 1.1em; border-radius: 12px; text-decoration: none; font-weight: 800; color: #eef1f8; border: 1px solid rgba(255,255,255,.18); }
.wnote .acts a.primary { background: var(--hot); color: #0b0b10; border-color: transparent; }
[hidden] { display: none !important; }`;

/* The watch page's script (the site's own origin; the game runs in the sandboxed frame as a watcher). */
const WATCH_JS = String.raw`${BUILD_RETRY_JS}(function () {
  'use strict';
  var boot = window.__HOMIE_WATCH;
  var params = new URLSearchParams(location.search);
  var hand = params.get('hand');
  var device = hand === 'phone' || hand === 'desk' || hand === 'tv' ? hand : (boot.embed ? matchMedia('(pointer:coarse)').matches : Math.min(innerWidth, innerHeight) <= 540) ? 'phone' : 'desk';
  var frame = document.querySelector('iframe.game');
  var q1 = function (s) { return document.querySelector(s); };
  var strip = q1('[data-strip]'), note = q1('[data-note]');
  var capHead = q1('[data-cap-head]'), capSub = q1('[data-cap-sub]'), clockEl = q1('[data-clock]'), liveEl = q1('[data-live]');
  var palette = Array.isArray(boot.palette) ? boot.palette : [];
  var asked = params.get('follow');
  var first = /^\d{1,2}$/.test(asked || '') ? Number(asked) : asked === 'overview' ? null : 'auto';
  // What the page knows: the room's facts (its watch socket), and what the game in the frame says it renders.
  var state = { game: boot.game, room: null, facts: null, offset: 0, round: null, view: null, follows: null, canFollow: boot.policy !== 'overview', why: boot.policy === 'overview' ? 'overview' : null, scores: null, asked: first, attached: false, notice: null, emptySince: 0 };
  window.__watch = state;
  function rnd() {
    try { var a = new Uint8Array(16); crypto.getRandomValues(a); var s = ''; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    catch (e) { var r = ''; while (r.length < 22) r += Math.random().toString(36).slice(2); return r.slice(0, 22); }
  }
  // The browser's room key, as the play page keeps it: a kick holds a browser out of watching too, and a browser
  // that holds a seat in this room watches it in the overview only (section 16).
  var roomKey = null;
  try { roomKey = localStorage.getItem('homie-b'); if (!/^[A-Za-z0-9_-]{16,43}$/.test(roomKey || '')) { roomKey = rnd(); localStorage.setItem('homie-b', roomKey); } } catch (e) { roomKey = rnd(); }

  function sizeUp() {
    var big = hand === 'tv' || (Math.min(innerWidth, innerHeight) >= 900 && !(window.matchMedia && matchMedia('(pointer: coarse)').matches));
    document.body.classList.toggle('big', big);
  }
  sizeUp();
  addEventListener('resize', sizeUp);
  function labelOf(room) { var m = /^pub-(\d+)$/.exec(room || ''); return m ? 'Room ' + m[1] : (room || ''); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
  function svg(path) { var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.innerHTML = path; return s; }
  var AUTO_ICON = '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>';
  var ROOM_ICON = '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>';

  // The players, in seat order: the strip's order, and what keys 1-9 pick (the n-th player).
  function players() {
    var f = state.facts;
    var list = f && Array.isArray(f.clients) ? f.clients.filter(function (c) { return c && typeof c.seat === 'number' && !c.watch; }) : [];
    return list.sort(function (a, b) { return a.seat - b.seat; });
  }
  function nameOf(seat) { var p = players().filter(function (c) { return c.seat === seat; })[0]; return p ? String(p.name || 'A player') : null; }
  function colourOf(p) { return palette[(Number(p.colour) || 0) % (palette.length || 1)] || '#e8ecf5'; }
  // Choosing whose view: the game decides it can (its helper said so), and the room lets this browser.
  function canChoose() { return state.follows === true && state.canFollow; }

  function follow(target) {
    if (!canChoose() || !frame.contentWindow) return;
    state.asked = target;
    try { frame.contentWindow.postMessage({ t: 'homie-watch', follow: target }, '*'); } catch (e) {}
    paint();
  }

  // The address follows the view, so a copied link watches the same player.
  function syncUrl() {
    try {
      var v = state.view;
      var f = !v ? null : v.following === 'auto' ? 'auto' : v.following === null ? 'overview' : String(v.following);
      if (params.get('room') !== state.room || (f && params.get('follow') !== f)) {
        params.set('room', state.room);
        if (f) params.set('follow', f); else params.delete('follow');
        params.delete('not');
        history.replaceState(history.state, '', location.pathname + '?' + params.toString() + location.hash);
      }
    } catch (e) {}
  }

  function start(room) {
    state.room = room;
    syncUrl();
    q1('[data-room-label]').textContent = labelOf(room);
    q1('[data-playb]').href = '/' + boot.game + (boot.kind === 'app' ? '/open?room=' : '/play?room=') + encodeURIComponent(room);
    document.title = 'Watch ' + boot.name + ' · ' + labelOf(room);
    var q = new URLSearchParams({ room: room, watch: '1', device: device, b: roomKey });
    if (boot.kind === 'app') { q.set('role', params.get('role') || boot.role); q.set('surface', 'wall'); q1('[data-playb] span').textContent = 'Open'; }
    q.set('follow', first === 'auto' ? 'auto' : first === null ? 'overview' : String(first));
    if (boot.t) q.set('t', boot.t);
    if (params.get('debug') === '1') q.set('debug', '1');
    ['cam', 'view'].forEach(function (k) { var v = params.get(k); if (v && /^[A-Za-z0-9_-]{1,16}$/.test(v)) q.set(k, v); });
    frame.src = '/' + boot.game + '/__game/?' + q.toString();
    var updating = buildRetry(function () { frame.src = '/' + boot.game + '/__game/?' + q.toString(); }, function (text) { var el = q1('[data-update]'); if (el) { el.textContent = text; el.hidden = !text; } });
    frame.addEventListener('load', updating.loaded);
    frame.addEventListener('error', updating.failed);
    addEventListener('message', function (ev) {
      if (ev.source !== frame.contentWindow) return;
      var m = ev.data;
      if (!m || typeof m !== 'object' || m.t !== 'homie-net') return;
      if (m.what === 'rematch' && m.room === room) {
        var fresh = new URL(location.href); fresh.searchParams.delete('room'); fresh.searchParams.set('not', room);
        location.replace(fresh.href); return;
      }
      if (m.what === 'wait') updating.stop();
      else if (m.what === 'stale' && m.final !== true && m.immediate !== true) updating.stop(true);
      if (m.what === 'stale' && (m.final === true || m.immediate === true)) updating.request(m.ver, m.immediate);
      if (m.what === 'build') updating.acknowledge(m.ver);
      if (m.what === 'attached' || m.what === 'ready') updating.reported();
      if (m.what === 'attached') {
        state.attached = true;
        // A helper from before revision 5 never says what it renders: after a moment, the room's overview it is.
        setTimeout(function () { if (state.follows === null) { state.follows = false; paint(); } }, 4000);
      }
      if (m.what === 'view') {
        state.view = { seat: typeof m.seat === 'number' ? m.seat : null, following: m.following === 'auto' || typeof m.following === 'number' ? m.following : null, why: String(m.why || '') };
        state.follows = m.follows === true;
        state.canFollow = m.canFollow !== false;
        state.why = typeof m.whyNot === 'string' ? m.whyNot : null;
        syncUrl();
      }
      if (m.what === 'scores' && Array.isArray(m.scores)) {
        var sc = {}; m.scores.forEach(function (r) { if (r && typeof r.seat === 'number' && isFinite(r.score)) sc[r.seat] = Number(r.score); });
        state.scores = sc;
      }
      if (m.what === 'round' && m.round) state.round = m.round;
      if (m.what === 'closed') {
        if (m.why === 'kicked' || m.why === 'room-closed') shut(m.why === 'kicked' ? 'kicked' : 'closed', m);
        else if (m.why === 'watch-off') shut('off', m);
        else if (m.why === 'room-full') shut('full', m);
      }
      paint();
    });
    watch(room);
  }

  function watch(room) {
    if (state.notice && state.notice.final) return;
    var ws;
    var extra = '&b=' + encodeURIComponent(roomKey) + (boot.t ? '&t=' + encodeURIComponent(boot.t) : '');
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/' + boot.game + '/__watch?room=' + encodeURIComponent(room) + extra); }
    catch (e) { setTimeout(function () { watch(room); }, 2000); return; }
    state.socket = ws;
    // Room chat (section 19): a watcher reads the room's chat and sends what the room's rules let a watcher send.
    if (window.__homieChat) window.__homieChat.socket(ws, room);
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'kicked') { shut('kicked', m); return; }
      if (m.t === 'closed') { shut('closed', m); return; }
      if (window.__homieChat && window.__homieChat.receive(m)) return;
      if (m.t !== 'net') return;
      if (window.__homieChat) window.__homieChat.facts(m);
      state.facts = m;
      if (typeof m.st === 'number') state.offset = m.st - Date.now();
      if (m.round) state.round = m.round;
      paint();
    };
    ws.onclose = function () { if (!(state.notice && state.notice.final)) setTimeout(function () { watch(room); }, 1500); };
  }

  // A room that ended, a game that is not watched, a kick: the page says so plainly and offers the way on.
  function shut(kind, m) {
    if (state.notice && state.notice.kind === kind) return;
    var final = kind !== 'empty';
    state.notice = { kind: kind, final: final };
    if (final) { try { frame.src = 'about:blank'; } catch (e) {} if (state.socket) { try { state.socket.close(); } catch (e) {} } }
    note.textContent = '';
    var box = el('div', 'box');
    var label = labelOf(state.room);
    var heads = { empty: 'Everyone has left ' + label, kicked: 'You were removed from this room', closed: 'This room is closed', off: boot.name + ' is played, not watched', full: label + ' is full of watchers', none: 'Nobody is playing ' + boot.name + ' right now' };
    var lines = {
      empty: 'The players went on their way. Watch another room, or press Play: you start at once, with bots in the empty seats.',
      kicked: (m && m.message) || 'The studio removed you from this room.',
      closed: (m && m.message) || 'The studio closed this room.',
      off: 'Its rooms are not shown to watchers. Press Play and you are in one.',
      full: 'Every place to watch it from is taken. Try the busiest other room.',
      none: 'This page finds a room the moment somebody starts one. Or press Play, and people who come to watch will see you.',
    };
    if (boot.kind === 'app') { heads.none = 'Nobody is here right now'; heads.off = 'Watching is unavailable'; lines.empty = lines.none = lines.off = 'Open the app to join a screen, or watch another room.'; }
    box.appendChild(el('h1', '', heads[kind] || heads.closed));
    box.appendChild(el('p', '', lines[kind] || lines.closed));
    var acts = el('div', 'acts');
    var other = el('a', 'primary', kind === 'none' || kind === 'off' ? (boot.kind === 'app' ? 'Open ' : 'Play ') + boot.name : 'Watch another room');
    other.href = kind === 'none' || kind === 'off' ? '/' + boot.game + '/play' : '/' + boot.game + '/watch?not=' + encodeURIComponent(state.room || '');
    acts.appendChild(other);
    if (kind !== 'none' && kind !== 'off') { var play = el('a', '', 'Play'); play.href = '/' + boot.game + '/play'; acts.appendChild(play); }
    var back = el('a', '', 'Back to ' + boot.name); back.href = '/' + boot.game + '/'; acts.appendChild(back);
    box.appendChild(acts);
    note.appendChild(box);
    note.hidden = false;
    liveEl.classList.add('off');
  }
  function unshut() { if (state.notice && !state.notice.final) { state.notice = null; note.hidden = true; note.textContent = ''; liveEl.classList.remove('off'); } }

  var drawn = '';
  function paintStrip() {
    var list = players();
    var choose = canChoose();
    var v = state.view || { seat: null, following: state.asked, why: '' };
    var scores = state.scores || {};
    var lead = null; var best = -Infinity;
    list.forEach(function (p) { var s = scores[p.seat]; if (typeof s === 'number' && s > best) { best = s; lead = p.seat; } });
    var sig = JSON.stringify([choose, v.seat, v.following, list.map(function (p) { return [p.seat, p.name, p.colour, scores[p.seat], Boolean(p.agent)]; }), lead, state.follows]);
    if (sig === drawn) return;
    drawn = sig;
    strip.textContent = '';
    function chip(target, key, build, pressed, extraCls) {
      var b = el('button', 'chip' + (extraCls ? ' ' + extraCls : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      if (!choose) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      if (key) b.appendChild(el('span', 'k', key));
      build(b);
      b.addEventListener('click', function () { follow(target); });
      strip.appendChild(b);
      return b;
    }
    if (choose) chip('auto', 'A', function (b) { b.appendChild(svg(AUTO_ICON)); b.appendChild(el('span', 'nm', 'Auto')); }, v.following === 'auto');
    list.forEach(function (p, i) {
      var on = choose && v.following === p.seat;
      var auto = choose && v.following === 'auto' && v.seat === p.seat;
      chip(p.seat, i < 9 ? String(i + 1) : '', function (b) {
        var dot = el('i', 'dot'); dot.style.background = colourOf(p); b.appendChild(dot);
        b.appendChild(el('span', 'nm', p.name || 'A player'));
        // An AI in the room is marked AI here too (section 17).
        if (p.agent) b.appendChild(el('span', 'tag ai', 'AI'));
        if (auto) b.appendChild(el('span', 'tag', 'auto'));
        if (typeof scores[p.seat] === 'number') b.appendChild(el('span', 'sc' + (p.seat === lead && list.length > 1 ? ' lead' : ''), scores[p.seat]));
        b.setAttribute('aria-label', (on || auto ? 'Watching ' : 'Watch ') + (p.name || 'a player'));
      }, on, auto ? 'auto-on' : '');
    });
    if (choose) chip(null, 'O', function (b) { b.appendChild(svg(ROOM_ICON)); b.appendChild(el('span', 'nm', 'Whole room')); }, v.following === null);
    if (choose && device !== 'phone') strip.appendChild(el('span', 'hint', '1–9 · A · O'));
  }

  function paint() {
    var f = state.facts;
    var list = players();
    // The caption: whose view this is, and why it is the whole room when it is.
    var v = state.view;
    var head = 'Watching the whole room';
    var sub = '';
    var dotColour = null;
    if (!state.attached || state.follows === null) { head = 'Joining ' + labelOf(state.room) + '…'; }
    else if (!state.follows) sub = boot.name + ' shows watchers the whole room';
    else if (!state.canFollow && state.why === 'seated-here') sub = 'You are playing in this room in another tab, so this one shows the whole room';
    else if (!state.canFollow) sub = boot.name + ' keeps each player’s view to themselves';
    else if (v && v.seat !== null) {
      var who = list.filter(function (p) { return p.seat === v.seat; })[0];
      head = 'Watching ' + (who ? who.name || 'a player' : 'a player');
      dotColour = who ? colourOf(who) : null;
      sub = v.following === 'auto' ? 'Auto · following the action' : '';
    } else if (v && v.following === 'auto') sub = list.length ? 'Auto · waiting for the action' : 'Auto · nobody is playing yet';
    capHead.textContent = '';
    if (dotColour) { var d = el('span', 'dot'); d.style.background = dotColour; capHead.appendChild(d); }
    capHead.appendChild(document.createTextNode(head));
    capSub.textContent = sub;
    capSub.hidden = !sub;
    // The round's clock, in the relay's time.
    var r = state.round;
    if (r && isFinite(r.endsAt)) {
      var left = Math.max(0, Math.ceil((r.endsAt - (Date.now() + state.offset)) / 1000));
      clockEl.textContent = r.phase === 'over' ? 'Next round in ' + left : 'Round ' + r.n + ' · ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      clockEl.hidden = false;
    } else clockEl.hidden = true;
    var eyes = f && f.counts ? Number(f.counts.watchers) || 0 : 0;
    q1('[data-eyes]').hidden = eyes < 1;
    q1('[data-eyes-n]').textContent = String(eyes);
    paintStrip();
    // Everyone left: say so after a moment (a reload is not a departure), and take it back if they return.
    var people = f && f.counts ? Number(f.counts.players) || 0 : null;
    if (people === 0 && state.attached) {
      if (!state.emptySince) state.emptySince = Date.now();
      if (Date.now() - state.emptySince > 6000 && !state.notice) shut('empty');
    } else { state.emptySince = 0; if (people) unshut(); }
  }
  setInterval(paint, 500);

  // Keys: 1-9 the n-th player, A Auto, O (or 0) the whole room, arrows the next or previous player, F full screen.
  addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;
    var list = players();
    wake();
    if (/^[1-9]$/.test(k)) { var p = list[Number(k) - 1]; if (p) follow(p.seat); e.preventDefault(); return; }
    if (k === 'a' || k === 'A') { follow('auto'); return; }
    if (k === 'o' || k === 'O' || k === '0') { follow(null); return; }
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      if (!list.length) return;
      var cur = state.view && typeof state.view.seat === 'number' ? state.view.seat : null;
      var i = list.map(function (p) { return p.seat; }).indexOf(cur);
      var n = k === 'ArrowRight' ? (i + 1) % list.length : (i <= 0 ? list.length - 1 : i - 1);
      follow(list[n].seat); e.preventDefault(); return;
    }
    if (k === 'f' || k === 'F') { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e2) {} }
  });

  // The bars get out of the way while nobody touches anything; any touch, move or key brings them back.
  var idleTimer = null;
  function wake() { document.body.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(function () { document.body.classList.add('idle'); }, 5000); }
  ['pointermove', 'pointerdown', 'touchstart', 'wheel'].forEach(function (t) { addEventListener(t, wake, { passive: true }); });
  wake();
  // The frame never keeps the keys: a click in the game hands them back to the page.
  addEventListener('blur', function () { setTimeout(function () { if (document.activeElement === frame) { try { frame.blur(); window.focus(); } catch (e) {} } }, 0); });

  // A named room watches that room; no room: the busiest public room now (nothing is reserved), or a wait for one.
  var askedRoom = params.get('room');
  if (boot.room) start(boot.room);
  else if (askedRoom !== null && /^[A-Za-z0-9_-]{1,32}$/.test(askedRoom)) start(askedRoom);
  else {
    var not = /^[A-Za-z0-9_,-]{1,140}$/.test(params.get('not') || '') ? params.get('not') : '';
    var look = function () {
      fetch('/' + boot.game + '/api/watch' + (not ? '?not=' + encodeURIComponent(not) : ''), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.room) { unshut(); state.notice = null; note.hidden = true; start(j.room); } else { if (!state.notice) shut('none'); state.notice.final = false; setTimeout(look, 10000); } })
        .catch(function () { setTimeout(look, 10000); });
    };
    look();
  }
}());`;

export function embedAncestors(cat, origin, preview = false) {
  const normal = playerAncestors(cat);
  if (!preview || !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) return normal;
  const port = new URL(origin).port;
  return `${normal === "'none'" ? '' : normal} http://localhost${port ? ':' + port : ''} http://127.0.0.1${port ? ':' + port : ''}`.trim();
}

export function embedPreview(cat, g, origin) {
  const frameOrigin = new URL(origin); frameOrigin.hostname = frameOrigin.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  return layoutless(`Preview ${g.name} in a post`, `<h1>Player card preview</h1><p>A cross-origin mock post using the sandbox observed in X’s web client. X’s phone apps open the player full screen; its website opens third-party games in a new tab.</p><iframe title="${esc(g.name)}" src="${esc(frameOrigin.origin)}${esc(openPath(g))}/embed" sandbox="${PLAYER_SANDBOX}" allow="autoplay; fullscreen; web-share" allowfullscreen scrolling="no" style="width:100%;aspect-ratio:${PLAYER_SIZE.width}/${PLAYER_SIZE.height};border:0"></iframe>`, 'body{max-width:480px;margin:24px auto;background:#101622;color:white;font:16px system-ui}');
}
