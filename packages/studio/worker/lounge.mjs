/**
 * THE LOUNGE (@homie-rocks/studio 0.29.0, chat/LOUNGE.md): a studio's own community room at /lounge/, when studio.json
 * turns it on. Play nights, demos, "show what you made", and talking with the people who play the studio's games. It
 * is room chat (NETPLAY.md section 19) in a room of its own: the same relay, the same floor and review on the studio's
 * own Workers AI, the same owner's tools, plus what a lasting room needs:
 *
 *   history     the owner may keep what was said for a number of days (off until they do; never on a kids lounge),
 *               in the studio's own D1 (worker/lounge-store.mjs); anyone takes their own line down, the owner and the
 *               moderators take anyone's, deleting an account takes every line of it
 *   moderators  player accounts the owner names: Remove, Mute, Kick and slow mode from the Lounge page itself
 *   play nights set by the owner in the office (or `homie-studio lounge night`), shown with the visitor's own time
 *   featured    live rooms: this studio's, and with a directory the whole directory's, each with Watch and Join
 *   show        "show what you made": a link to a Homie studio's game becomes a card (read from that studio's own
 *               manifest, its words through the floor and the review like any line); links are never typed
 *
 * Who says what is the Worker's word: a page of this site carries its signed-in account (a passkey) and the owner's mark;
 * a page of another site (homie.rocks shows the Lounge live) is a watcher with a handle that can react and send quick
 * lines when the rules let it, never type, and never speaks as anyone signed in here. Kids: a lounge with `kids` keeps
 * chat to emoji and quick lines and keeps nothing.
 */
import { CHAT_LIMITS, REACTIONS, checkChatRules, cleanText, composeChat, publicChat } from './chat.mjs';
import { REPORT_REASONS, chatRowsOf, clearChatRules, fileReport, reportsOf, writeChatRules } from './chat-store.mjs';
import {
  LOUNGE_CHAT, LOUNGE_GAME, LOUNGE_LIMITS, LOUNGE_ROOM, addMod, addNight, checkNight, historyOf, isMod, keptLine, modsOf, nightsOf,
  removeMod, removeNight, trimHistory,
} from './lounge-store.mjs';
import { encodeFacts } from './agents.mjs';
import { PUBLIC_SERVER, policyOf } from './servers.mjs';
import { players } from './players.mjs';
import { signControl } from './office.mjs';
import { LOUNGE_JS, loungePage } from './lounge-page.mjs';
import { STUDIO_VERSION_TAG } from './version.mjs';

const json = (body, status = 200, extra = {}) => new Response(`${JSON.stringify(body)}\n`, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});
const BROWSER_KEY = /^[A-Za-z0-9_-]{16,43}$/;
const LINE_ID = /^[A-Za-z0-9_-]{1,16}$/;
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NOBODY = Object.freeze({ player: null, acct: false, owner: false, mod: false, name: null });
const oneLine = (v, max) => [...String(v ?? '').normalize('NFKC').replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u2028\u2029]+/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();

export const isLoungePath = (p) => p === '/lounge' || p.startsWith('/lounge/') || p === '/_homie/lounge.js';

/** The studio's Lounge as the build kept it (studio.json "lounge"), or null when it has none. */
export const loungeOf = (cat) => (cat?.studio?.lounge && typeof cat.studio.lounge === 'object' ? cat.studio.lounge : null);

/** The Lounge's chat rules: its defaults, studio.json's `lounge.chat`, then the owner's (the office), kids capped. */
export async function loungeRules(env, cat, { fresh = false } = {}) {
  const L = loungeOf(cat);
  const rows = await chatRowsOf(env, { fresh });
  return composeChat({ game: { ...LOUNGE_CHAT, ...(L?.chat ?? {}) }, office: rows.get(`${LOUNGE_GAME}/`) ?? null, kids: Boolean(L?.kids), speech: 'game' });
}

/** Where the Lounge's rules came from (the office's "from"). */
async function rulesFrom(env) {
  const rows = await chatRowsOf(env, { fresh: true });
  return rows.get(`${LOUNGE_GAME}/`) ? 'office' : 'default';
}

/** The Lounge's room policy: humans only (an AI never types in chat), kids when the Lounge is, the chat rules beside. */
function loungePolicy(L, chat) {
  const kids = Boolean(L?.kids);
  const srv = { ...PUBLIC_SERVER, id: 'lounge', name: L?.name ?? 'The Lounge', policy: 'humans-only', aiSeats: 0, guides: 0, bots: 'off', kids, speech: kids ? 'lines' : 'game' };
  return policyOf(srv, { seats: 2, named: true, chat });
}

const tableOf = (env) => env.TABLE.get(env.TABLE.idFromName(`${LOUNGE_GAME}/${LOUNGE_ROOM}`));
const tableUrl = (path, extra = '') => `https://table/${path}?game=${LOUNGE_GAME}&room=${LOUNGE_ROOM}&max=2${extra}`;

/** One signed control for the Lounge's room (NETPLAY.md section 15): what the room says back. */
export async function loungeControl(env, op, args = {}) {
  const ctl = await signControl(env, { op, game: LOUNGE_GAME, room: LOUNGE_ROOM, args });
  if (!ctl) return { ok: false, error: 'no-key', message: 'This studio has no database for its office yet: `npm run deploy` applies its migrations.' };
  try {
    const res = await tableOf(env).fetch(new Request(tableUrl('__office'), { method: 'POST', body: JSON.stringify(ctl) }));
    return await res.json();
  } catch (error) { return { ok: false, error: 'room', message: String(error?.message ?? error).slice(0, 120) }; }
}

/** The Lounge's room as its owner sees it: who is here, the last lines with who sent them, mutes and holds. */
async function loungeFacts(env) {
  try { const res = await tableOf(env).fetch(tableUrl('__facts')); return res.ok ? await res.json() : null; } catch { return null; }
}

/** Every live room of the Lounge after a rules change hears its new rules now (a signed `policy` control). */
async function pushRules(env, cat) {
  const L = loungeOf(cat);
  const rules = await loungeRules(env, cat, { fresh: true });
  await loungeControl(env, 'policy', { pol: loungePolicy(L, rules) });
  return rules;
}

/**
 * Who this request is to the Lounge: a signed-in account (a passkey, never a guest), the studio's owner, a moderator
 * the owner named, and the name they chose. Only a page of this site: another site's page is nobody.
 */
async function whoOf(request, env) {
  let p = null;
  try { p = await players.of(request, env); } catch { p = null; }
  if (!p || p.guest) return NOBODY;
  const owner = Boolean(p.owner);
  return { player: p.id, acct: true, owner, mod: !owner && await isMod(env, p.id), name: oneLine(p.name, CHAT_LIMITS.name) || null };
}

function sameOrigin(request, url) {
  const o = request.headers.get('origin');
  return Boolean(o) && o === url.origin;
}

async function readJson(request, max = 2048) {
  const text = await request.text();
  if (text.length > max) return { error: 'too-large' };
  try { const b = JSON.parse(text || '{}'); return b && typeof b === 'object' && !Array.isArray(b) ? { body: b } : { error: 'json' }; } catch { return { error: 'json' }; }
}

/* ------------------------------------------------------------------ what the page and homie.rocks read */

/** A play night as everyone sees it: its game named and linked when it is one of this studio's (or a link to one). */
function nightView(n, cat, origin) {
  let game = null;
  if (n.game && GAME_ID.test(n.game)) {
    const g = (cat.games ?? []).find((x) => x.id === n.game);
    if (g) game = { name: g.name, page: `${origin}/${g.id}/`, play: `${origin}/${g.id}/play` };
  } else if (n.game && /^https:\/\//.test(n.game)) {
    game = { name: null, page: n.game, play: n.game };
  }
  return { id: n.id, title: n.title, at: new Date(n.at).toISOString(), minutes: n.minutes, note: n.note ?? null, on: Boolean(n.on), game };
}

const hubCache = new Map();
/** The directory's live rooms (its /api/hub), read at most every 45 s by this Worker instance, 3 s at most. */
async function directoryRooms(directory, fetchFn = fetch) {
  const hit = hubCache.get(directory);
  if (hit && Date.now() - hit.at < 45_000) return hit.rooms;
  let rooms = [];
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const res = await fetchFn(`${directory}/api/hub`, { signal: ctl.signal, headers: { accept: 'application/json' } });
    clearTimeout(t);
    const body = res.ok ? await res.json() : null;
    const https = (u) => (typeof u === 'string' && /^https:\/\/[^\s]{4,400}$/.test(u) ? u : null);
    rooms = (Array.isArray(body?.rooms) ? body.rooms : []).slice(0, 50).map((r) => ({
      title: oneLine(r.title, 80) || 'A room', studio: oneLine(r.studio, 60) || null, site: https(r.site), players: Math.max(0, Math.floor(Number(r.players) || 0)),
      max: null, watch: https(r.watch), join: https(r.href), picture: https(r.picture),
    })).filter((r) => r.join && r.players > 0);
  } catch { rooms = []; }
  hubCache.set(directory, { at: Date.now(), rooms });
  return rooms;
}

/**
 * The live rooms the Lounge shows (Watch and Join): this studio's own, and with `featured: "directory"` (the default)
 * the directory's busiest too. Never more than eight.
 */
export async function featuredRooms(env, cat, origin, { roomsOf = null, fetchFn = fetch } = {}) {
  const L = loungeOf(cat);
  if (!L || L.featured === 'none') return [];
  const abs = (u) => (u && u.startsWith('/') ? `${origin}${u}` : u);
  let own = [];
  try {
    own = roomsOf ? (await roomsOf(env, cat.games ?? [])).rooms.map((r) => ({
      title: `${r.name} · ${r.label}`, studio: cat.studio?.name ?? null, site: origin, players: r.players, max: r.max,
      watch: r.watch ? abs(r.watch) : null, join: abs(r.play), picture: r.cover ? abs(r.cover) : null, here: true,
    })) : [];
  } catch { own = []; }
  if (L.featured === 'studio' || !cat.studio?.directory || env.HOMIE_PREVIEW === '1') return own.slice(0, 8);
  const host = new URL(origin).host;
  const others = (await directoryRooms(cat.studio.directory, fetchFn)).filter((r) => { try { return !r.site || new URL(r.site).host !== host; } catch { return true; } });
  return [...own, ...others].sort((a, b) => b.players - a.players).slice(0, 8);
}

/** What /lounge/api/now says (the page's sidebar and homie.rocks's Lounge page): the rules, the nights, the rooms. */
export async function loungeNow(env, cat, origin, opts = {}) {
  const L = loungeOf(cat);
  const [rules, nights, rooms, facts] = await Promise.all([loungeRules(env, cat), nightsOf(env), featuredRooms(env, cat, origin, opts), loungeFacts(env)]);
  const pub = publicChat(rules);
  const ws = origin.replace(/^http/, 'ws');
  return {
    ok: true,
    lounge: {
      name: L.name, blurb: L.blurb, studio: cat.studio?.name ?? null, page: `${origin}/lounge/`, socket: `${ws}/lounge/__watch`,
      here: Math.max(0, Number(facts?.counts?.shells ?? 0) || 0),
      rules: { mode: pub.mode, who: pub.who, react: pub.react, hub: pub.hub, slow: pub.slow, history: pub.history ?? 0, kids: Boolean(L.kids) },
    },
    nights: nights.map((n) => nightView(n, cat, origin)),
    rooms,
  };
}

/* ------------------------------------------------------------------ show what you made */

const showsMade = new Map();
/** Cards one account may post: three an hour (this Worker's memory). A card that was not posted does not count. */
function showAllowed(player, now = Date.now()) {
  const list = (showsMade.get(player) ?? []).filter((at) => now - at < 3600_000);
  showsMade.set(player, list);
  if (showsMade.size > 5000) for (const [k, v] of showsMade) if (!v.some((at) => now - at < 3600_000)) showsMade.delete(k);
  return list.length < LOUNGE_LIMITS.show;
}
const showPosted = (player, now = Date.now()) => { showsMade.set(player, [...(showsMade.get(player) ?? []), now]); };

/**
 * A link to a game becomes a card, read from where it lives: this studio's own game from its catalogue; another studio's
 * from that site's Homie manifest (/.well-known/homie-studio.json), so only a Homie studio's game can be a card and
 * its title, pitch and picture are the studio's own. `{ ok, card }` or `{ ok: false, message }`.
 */
export async function cardFor(link, { cat, origin, fetchFn = fetch, local = false } = {}) {
  const bad = (message) => ({ ok: false, error: 'card', message });
  let u;
  try { u = new URL(String(link ?? '').trim()); } catch { return bad('Paste the link to your game (https://…).'); }
  const localHost = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(local && localHost && u.protocol === 'http:')) return bad('That needs to be an https link to a game.');
  if (u.username || u.password || String(link).length > 300) return bad('That link is not one a card can show.');
  const id = u.pathname.split('/').filter(Boolean)[0] ?? '';
  if (!GAME_ID.test(id)) return bad('Link to the game itself: its page (https://your-studio/<game>/) or its Play.');
  if (u.origin === origin) {
    const g = (cat.games ?? []).find((x) => x.id === id);
    if (!g) return bad('This studio has no game at that link.');
    const cover = g.landing?.hero?.wideImage ?? g.landing?.hero?.tallImage ?? g.landing?.cover ?? (g.cover ? `/games/${g.id}/${g.cover}` : null);
    return { ok: true, card: { url: `${origin}/${g.id}/`, title: oneLine(g.name, 80), studio: oneLine(cat.studio?.name, 60), pitch: oneLine(g.blurb, 160), image: cover ? (cover.startsWith('/') ? `${origin}${cover}` : cover) : null, game: g.id } };
  }
  if (localHost && !local) return bad('That link is on somebody\'s own computer: share the game\'s live link.');
  let manifest = null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    // Workers know `follow` and `manual` (no `error`): a redirect is not the studio's own manifest, so it is refused.
    const res = await fetchFn(`${u.origin}/.well-known/homie-studio.json`, { signal: ctl.signal, headers: { accept: 'application/json' }, redirect: 'manual' });
    clearTimeout(t);
    const text = res.status === 200 ? await res.text() : '';
    manifest = text && text.length < 512 * 1024 ? JSON.parse(text) : null;
  } catch { manifest = null; }
  if (!manifest || manifest.kind !== 'homie-studio' || !Array.isArray(manifest.games)) return bad('That site is not a Homie studio (it has no studio manifest), so it can\'t be a card.');
  const g = manifest.games.find((x) => x && x.id === id);
  if (!g) return bad(`${oneLine(manifest.name, 60) || 'That studio'} has no public game at that link.`);
  const https = (v) => (typeof v === 'string' && /^https:\/\/[^\s]{4,400}$/.test(v) ? v : null);
  const page = https(g.page) && new URL(g.page).origin === u.origin ? g.page : `${u.origin}/${id}/`;
  return { ok: true, card: { url: page, title: oneLine(g.name, 80) || id, studio: oneLine(manifest.name, 60), pitch: oneLine(g.blurb, 160), image: https(g.cover), game: id } };
}

/* ------------------------------------------------------------------ the routes */

/**
 * /lounge/ and everything under it, and /_homie/lounge.js. Null when the studio has no Lounge (a game, a page of the
 * studio's own or a 404 answers instead).
 */
export async function loungeRoutes(request, env, ctx, url, { catalogueOf, roomsOf = null }) {
  const path = url.pathname;
  const read = request.method === 'GET' || request.method === 'HEAD';
  const cat = await catalogueOf();
  const L = loungeOf(cat);
  if (!L) return null;
  if (path === '/_homie/lounge.js') return new Response(LOUNGE_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': url.searchParams.get('v') === STUDIO_VERSION_TAG ? 'public, max-age=31536000, immutable' : 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
  if (path === '/lounge' && read) return Response.redirect(`${url.origin}/lounge/${url.search}`, 301);
  if (!env.TABLE || !env.DB) return path.startsWith('/lounge/api/') ? json({ ok: false, error: 'no-rooms', message: 'This studio has no rooms or database bound yet: `npm run deploy` sets them up.' }, 503) : null;
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url.origin);

  if (path === '/lounge/' && read) {
    const [who, rules, nights] = await Promise.all([whoOf(request, env), loungeRules(env, cat), nightsOf(env)]);
    return loungePage(cat, { origin: url.origin, who, rules: publicChat(rules), nights: nights.map((n) => nightView(n, cat, url.origin)) });
  }

  if (path === '/lounge/__watch') {
    if (request.headers.get('upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const origin = request.headers.get('origin');
    const hub = Boolean(origin) && origin !== 'null' && origin !== url.origin;
    const rules = await loungeRules(env, cat);
    if (hub && !rules.hub) return new Response('this lounge is shown only on its own site', { status: 403 });
    // A page of another site never speaks as anyone signed in here (its socket carries the visitor's cookies too).
    const who = hub ? NOBODY : await whoOf(request, env);
    const b = BROWSER_KEY.test(url.searchParams.get('b') ?? '') ? url.searchParams.get('b') : '';
    const via = who.player ? (who.owner ? `o~p-${who.player}` : `p-${who.player}`) : null;
    const lean = { ...rules, emoji: rules.emoji.filter((e) => !REACTIONS.some((r) => r.k === e.k)) };
    const target = tableUrl('__watch', `${b ? `&b=${b}` : ''}${via ? `&via=${encodeURIComponent(via)}` : ''}&pol=${encodeFacts(loungePolicy(L, rules))}&chat=${encodeFacts(lean)}${who.acct ? '&acct=1&mem=1' : ''}${hub ? '&hub=1' : ''}${who.name ? `&nm=${encodeURIComponent(who.name)}` : ''}${who.mod ? '&mod=1' : ''}`);
    return tableOf(env).fetch(new Request(target, request));
  }

  if (path === '/lounge/api/now' && read) {
    return json(await loungeNow(env, cat, url.origin, { roomsOf }), 200, { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=30' });
  }

  if (path === '/lounge/api/history' && read) {
    const rules = await loungeRules(env, cat);
    if (!(rules.history > 0)) return json({ ok: true, history: 0, lines: [] });
    const before = Number(url.searchParams.get('before'));
    const [lines, who] = await Promise.all([historyOf(env, LOUNGE_GAME, LOUNGE_ROOM, { days: rules.history, before: Number.isFinite(before) && before > 0 ? before : null }), whoOf(request, env)]);
    // A signed-in person's own kept lines say so (they may take them down); nobody else's account is ever named.
    return json({ ok: true, history: rules.history, lines: lines.map((r) => ({ ...wire(r), ...(who.player && r.from?.player === who.player ? { mine: true } : {}) })), more: lines.length >= LOUNGE_LIMITS.page });
  }

  if (path === '/lounge/api/show') {
    if (request.method !== 'POST' || !sameOrigin(request, url)) return json({ ok: false, error: 'origin', message: 'A card comes from the Lounge page itself.' }, 403);
    const who = await whoOf(request, env);
    if (!who.acct) return json({ ok: false, error: 'sign-in', message: 'Sign in with a passkey to show what you made.' }, 401);
    const r = await readJson(request);
    if (r.error) return json({ ok: false, error: r.error }, 400);
    if (!who.owner && !showAllowed(who.player)) return json({ ok: false, error: 'rate', message: 'Three cards an hour: give the Lounge a moment with this one.' }, 429);
    const made = await cardFor(r.body.url, { cat, origin: url.origin, local });
    if (!made.ok) return json(made, 400);
    const note = cleanText(r.body.note, 200);
    const b = BROWSER_KEY.test(String(r.body.b ?? '')) ? r.body.b : null;
    const res = await loungeControl(env, 'card', { card: made.card, note, name: who.name, player: who.player, acct: true, owner: who.owner, mod: who.mod, browser: b });
    if (!res.ok) return json({ ok: false, error: res.error ?? 'held', why: res.why ?? null, message: res.message ?? 'That card was not posted.' }, res.error === 'muted' || res.error === 'kicked' ? 403 : 400);
    if (!who.owner) showPosted(who.player);
    return json({ ok: true, id: res.id, card: made.card, message: 'It\'s in the Lounge.' });
  }

  if (path === '/lounge/api/report') {
    if (request.method !== 'POST' || !sameOrigin(request, url)) return json({ ok: false, error: 'origin', message: 'A report comes from the Lounge page itself.' }, 403);
    const r = await readJson(request);
    if (r.error) return json({ ok: false, error: r.error }, 400);
    const id = String(r.body.id ?? '');
    if (!LINE_ID.test(id)) return json({ ok: false, error: 'bad-request', message: 'id names the message' }, 400);
    const reason = REPORT_REASONS.includes(r.body.reason) ? r.body.reason : 'other';
    const key = `${BROWSER_KEY.test(String(r.body.b ?? '')) ? r.body.b : ''}|${request.headers.get('cf-connecting-ip') ?? ''}`;
    if (!reportAllowed(key)) return json({ ok: false, error: 'rate', message: 'That is a lot of reports: the studio has them. Try again in a few minutes.' }, 429);
    const line = await lineOf(env, id);
    if (!line) return json({ ok: false, error: 'gone', message: 'That message is no longer in the Lounge.' }, 404);
    if (line.by === 'studio') return json({ ok: false, error: 'studio', message: 'That is the studio\'s own line.' }, 400);
    try { await fileReport(env, { game: LOUNGE_GAME, room: LOUNGE_ROOM, line, reason }); } catch (error) {
      return json({ ok: false, error: 'not-migrated', message: `Reports need migration 0007_studio_chat.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }, 503);
    }
    return json({ ok: true, message: 'Thanks for telling the studio. They will look at it.' });
  }

  if (path === '/lounge/api/delete') {
    // A signed-in person takes their own message down, kept ones too (a guest does it on the socket, in the window).
    if (request.method !== 'POST' || !sameOrigin(request, url)) return json({ ok: false, error: 'origin', message: 'This comes from the Lounge page itself.' }, 403);
    const who = await whoOf(request, env);
    if (!who.acct) return json({ ok: false, error: 'sign-in', message: 'Sign in to take your own messages down.' }, 401);
    const r = await readJson(request);
    if (r.error) return json({ ok: false, error: r.error }, 400);
    const id = String(r.body.id ?? '');
    if (!LINE_ID.test(id)) return json({ ok: false, error: 'bad-request', message: 'id names the message' }, 400);
    const line = await lineOf(env, id);
    if (!line) return json({ ok: false, error: 'gone', message: 'That message is gone already.' }, 404);
    if (line.player !== who.player || line.by === 'studio') return json({ ok: false, error: 'not-yours', message: 'Only its sender (or the studio) can take a message down.' }, 403);
    const res = await loungeControl(env, 'unsay', { ids: [id] });
    return json({ ok: Boolean(res.ok), message: 'Taken down.' });
  }

  if (path === '/lounge/api/mod') {
    if (request.method !== 'POST' || !sameOrigin(request, url)) return json({ ok: false, error: 'origin', message: 'This comes from the Lounge page itself.' }, 403);
    const who = await whoOf(request, env);
    if (!who.owner && !who.mod) return json({ ok: false, error: 'not-a-mod', message: 'Only the studio\'s owner and its moderators keep the Lounge.' }, 403);
    const r = await readJson(request);
    if (r.error) return json({ ok: false, error: r.error }, 400);
    return json(await modAction(env, cat, who, r.body));
  }
  return path.startsWith('/lounge/') ? json({ ok: false, error: 'not-found' }, 404) : null;
}

/** A kept or live line as every page gets it (the relay's own `line` shape). */
function wire(r) {
  const base = { id: r.id, at: r.at, name: r.name, seat: null, colour: null, by: r.by, ...(r.acct ? { acct: true } : {}), ...(r.owner ? { owner: true } : {}), ...(r.mod ? { mod: true } : {}), kept: true };
  return { t: 'line', ...base, text: r.text ?? '', ...(r.say ? { say: r.say } : {}), ...(r.kind === 'card' && r.card ? { card: r.card } : {}) };
}

/** One line the room holds now, else the one the Lounge kept (an older line has only its sender's account). */
async function lineOf(env, id) {
  try {
    const res = await tableOf(env).fetch(tableUrl('__chat', `&op=line&id=${encodeURIComponent(id)}`));
    const line = (await res.json()).line ?? null;
    if (line) return line;
  } catch { /* the kept copy */ }
  const kept = await keptLine(env, LOUNGE_GAME, LOUNGE_ROOM, id);
  return kept ? { id: kept.id, kind: kept.kind, text: kept.text ?? null, glyph: null, name: kept.name, seat: null, at: kept.at, by: kept.by, player: kept.from?.player ?? null, owner: kept.owner, mod: Boolean(kept.mod) } : null;
}

const reportsMade = new Map();
function reportAllowed(key, now = Date.now()) {
  const list = (reportsMade.get(key) ?? []).filter((at) => now - at < 10 * 60_000);
  if (list.length >= 8) { reportsMade.set(key, list); return false; }
  list.push(now);
  reportsMade.set(key, list);
  if (reportsMade.size > 5000) for (const [k, v] of reportsMade) if (!v.some((at) => now - at < 10 * 60_000)) reportsMade.delete(k);
  return true;
}

/**
 * The Lounge's keepers, from the page: the owner and the moderators they named. Remove a line, mute or kick its sender
 * (their lines come down with them), or set slow mode. A moderator holds someone for at most an hour and never acts on
 * the owner's lines or another moderator's; the owner may hold for up to a day.
 */
async function modAction(env, cat, who, body) {
  const op = String(body.op ?? '');
  if (op === 'slow') {
    const n = Math.floor(Number(body.seconds));
    if (!(n >= 0 && n <= CHAT_LIMITS.slowMax)) return { ok: false, error: 'bad-request', message: `seconds is 0 to ${CHAT_LIMITS.slowMax}` };
    try { await writeChatRules(env, LOUNGE_GAME, '', { slow: n }); } catch (error) { return { ok: false, error: 'not-migrated', message: String(error?.message ?? error).slice(0, 120) }; }
    const rules = await pushRules(env, cat);
    return { ok: true, op, slow: rules.slow, message: rules.slow ? `Slow mode: one message every ${rules.slow} s.` : 'Slow mode is off.' };
  }
  if (!['remove', 'mute', 'kick'].includes(op)) return { ok: false, error: 'bad-request', message: 'op is remove, mute, kick or slow' };
  const id = String(body.line ?? '');
  if (!LINE_ID.test(id)) return { ok: false, error: 'bad-request', message: 'line is the message\'s id' };
  const line = await lineOf(env, id);
  if (!line) return { ok: false, error: 'gone', message: 'That message is gone already.' };
  if (line.by === 'studio' && op !== 'remove') return { ok: false, error: 'studio', message: 'That is the studio\'s own line.' };
  if (!who.owner && (line.owner || line.mod) && line.player !== who.player) return { ok: false, error: 'keeper', message: 'Moderators don\'t act on the owner\'s or another moderator\'s lines.' };
  if (op === 'remove') {
    const r = await loungeControl(env, 'unsay', { ids: [id] });
    return { ok: Boolean(r.ok), op, removed: r.removed ?? 0, message: 'Taken down on every screen.' };
  }
  const minutes = Math.max(1, Math.min(who.owner ? 1440 : 60, Math.floor(Number(body.minutes) || 10)));
  const kept = { id: line.id, name: line.name, seat: null, from: { client: null, token: null, browser: null, player: line.player ?? null } };
  const r = await loungeControl(env, op, { line: id, minutes, purge: true, kept, ...(op === 'kick' ? { message: 'The Lounge\'s keepers asked you to take a break. You can come back later.' } : {}) });
  return { ...r, op, minutes, message: r.ok ? `${line.name} is ${op === 'kick' ? 'out of the Lounge' : 'muted'} for ${minutes} min; their messages are down.` : r.message };
}

/* ------------------------------------------------------------------ the office */

/** The Lounge in the office: its rules and where they came from, the play nights, the moderators, the last lines, reports. */
export async function loungeOffice(env, cat, origin) {
  const L = loungeOf(cat);
  if (!L) return null;
  const [rules, from, nights, mods, facts, reports] = await Promise.all([loungeRules(env, cat, { fresh: true }), rulesFrom(env), nightsOf(env, { limit: LOUNGE_LIMITS.nights }), modsOf(env), loungeFacts(env), reportsOf(env, { game: LOUNGE_GAME })]);
  const lines = (facts?.office?.chat?.lines ?? []).slice(-50).map((l) => ({ id: l.id, at: l.at, t: l.t, kind: l.kind, name: oneLine(l.name, 40), by: l.by, text: l.text ?? null, glyph: l.glyph ?? null, card: l.card ?? null, acct: Boolean(l.acct), owner: Boolean(l.owner), mod: Boolean(l.mod), player: l.player ?? null }));
  return {
    on: true, name: L.name, page: `${origin}/lounge/`, kids: Boolean(L.kids), featured: L.featured,
    rules: publicChat(rules), office: (await chatRowsOf(env, { fresh: true })).get(`${LOUNGE_GAME}/`) ?? null, from,
    nights: nights.map((n) => nightView(n, cat, origin)), mods, lines, here: Math.max(0, Number(facts?.counts?.shells ?? 0) || 0),
    mutes: facts?.office?.mutes ?? [], bans: facts?.office?.bans ?? [], reports,
  };
}

/** An office control for the Lounge, checked: `{ ok, action }` or `{ ok: false, message }`; null when `op` is not one. */
export function checkLoungeAction(cat, op, body) {
  if (!op.startsWith('lounge-')) return null;
  const bad = (message) => ({ ok: false, error: 'bad-request', message });
  if (!loungeOf(cat)) return bad('This studio has no Lounge: add "lounge": true to studio.json and deploy.');
  switch (op) {
    case 'lounge-rules': {
      if (body.reset === true) return { ok: true, action: { op, reset: true } };
      const c = checkChatRules(body);
      if (!c.ok) return c;
      if (!Object.keys(c.fields).length) return bad('say what to change: mode, who, react, slow, max, links, swears, ai, hub, history (days), block, allow, lines, emoji; or reset: true');
      return { ok: true, action: { op, fields: c.fields } };
    }
    case 'lounge-night': {
      if (body.remove !== undefined) return /^pn_[a-f0-9]{12}$/.test(String(body.remove)) ? { ok: true, action: { op, remove: body.remove } } : bad('remove is the play night\'s id');
      const n = checkNight(body);
      if (!n.ok) return n;
      if (n.night.game && GAME_ID.test(n.night.game) && !(cat.games ?? []).some((g) => g.id === n.night.game)) return bad(`game: this studio has no game "${n.night.game}"`);
      return { ok: true, action: { op, night: n.night } };
    }
    case 'lounge-mod': {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(body.player ?? ''))) return bad('player is the player\'s id (the office lists players)');
      return { ok: true, action: { op, player: body.player, ...(body.remove === true ? { remove: true } : {}), name: oneLine(body.name, 40) || null } };
    }
    case 'lounge-remove': {
      const ids = (Array.isArray(body.ids) ? body.ids : body.id !== undefined ? [body.id] : []).filter((x) => typeof x === 'string' && LINE_ID.test(x)).slice(0, 64);
      if (!ids.length && body.all !== true) return bad('id is the message\'s id, or all: true');
      return { ok: true, action: { op, ...(body.all === true ? { all: true } : { ids }) } };
    }
    case 'lounge-hold': {
      if (!LINE_ID.test(String(body.line ?? ''))) return bad('line is the message\'s id');
      const minutes = Math.max(1, Math.min(1440, Math.floor(Number(body.minutes) || 10)));
      return { ok: true, action: { op, line: body.line, kick: body.kick === true, minutes, off: body.off === true } };
    }
    default: return bad('unknown control');
  }
}

/** In words, for the office's toast and an AI's ask. */
export function describeLounge(cat, a) {
  const name = loungeOf(cat)?.name ?? 'the Lounge';
  switch (a.op) {
    case 'lounge-rules': {
      if (a.reset) return `Give ${name} its own chat rules back.`;
      const f = a.fields;
      const bits = [];
      if (f.history !== undefined) bits.push(f.history ? `keep what people say for ${f.history} ${f.history === 1 ? 'day' : 'days'} (signed-in people can take their own lines down; deleting an account takes its lines)` : 'keep nothing past the last few minutes (what was kept is deleted now)');
      if (f.mode) bits.push({ off: 'turn chat off', emoji: 'keep chat to emoji', lines: 'keep chat to emoji and quick lines', text: 'let people type' }[f.mode]);
      if (f.who) bits.push(`typing for ${f.who === 'anyone' ? 'anyone, guests too' : f.who === 'signed-in' ? 'signed-in people (a passkey)' : 'members only'}`);
      if (f.slow !== undefined) bits.push(f.slow ? `slow mode: one message every ${f.slow} s` : 'no slow mode');
      if (f.hub !== undefined) bits.push(f.hub ? 'show it live on homie.rocks' : 'keep it to this site');
      const rest = Object.keys(f).filter((k) => !['history', 'mode', 'who', 'slow', 'hub'].includes(k));
      if (rest.length) bits.push(`change its ${rest.join(', ')}`);
      return `${name}: ${bits.join('; ')}.`;
    }
    case 'lounge-night': return a.remove ? `Take a play night off ${name}.` : `Add a play night to ${name}: "${a.night.title}", ${new Date(a.night.at).toISOString().replace('T', ' ').slice(0, 16)} UTC for ${a.night.minutes} min.`;
    case 'lounge-mod': return a.remove ? `Stop ${a.name ?? a.player} moderating ${name}.` : `Make ${a.name ?? a.player} a moderator of ${name}: they can take messages down, mute or kick someone for up to an hour, and set slow mode.`;
    case 'lounge-remove': return a.all ? `Take every message in ${name} down.` : `Take ${a.ids.length === 1 ? 'a message' : `${a.ids.length} messages`} down in ${name}.`;
    case 'lounge-hold': return a.off ? `Unmute someone in ${name}.` : `${a.kick ? 'Kick' : 'Mute'} the sender of a message in ${name} for ${a.minutes} min, and take their messages down.`;
    default: return 'A Lounge control.';
  }
}

/** Whether an office key (the owner's AI) only ASKS: keeping more, opening chat up, a new moderator, a mute or a kick. */
export async function loungeNeedsAsk(env, cat, a, chatOpensUp) {
  if (a.op === 'lounge-rules') return a.reset ? true : chatOpensUp(await loungeRules(env, cat, { fresh: true }), a.fields);
  if (a.op === 'lounge-mod') return a.remove !== true;
  if (a.op === 'lounge-hold') return a.off !== true;
  return false;
}

export async function performLounge(env, cat, a, origin = '') {
  switch (a.op) {
    case 'lounge-rules': {
      const before = await loungeRules(env, cat, { fresh: true });
      try {
        if (a.reset) await clearChatRules(env, LOUNGE_GAME, '');
        else await writeChatRules(env, LOUNGE_GAME, '', a.fields);
      } catch (error) { return { ok: false, error: 'not-migrated', message: `The Lounge needs migrations 0007 and 0009 (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }; }
      const rules = await pushRules(env, cat);
      // Keeping fewer days (or none) forgets the rest now, not later.
      let forgot = 0;
      if ((rules.history ?? 0) < (before.history ?? 0)) forgot = await trimHistory(env, LOUNGE_GAME, rules.history ?? 0).catch(() => 0);
      return { ok: true, op: a.op, rules: publicChat(rules), ...(forgot ? { forgot } : {}) };
    }
    case 'lounge-night': {
      try {
        if (a.remove) return { op: a.op, ...(await removeNight(env, a.remove)) };
        return { op: a.op, ...(await addNight(env, a.night)), night: nightView({ id: null, ...a.night, on: false }, cat, origin) };
      } catch (error) { return { ok: false, error: 'not-migrated', message: `Play nights need migration 0009_studio_lounge.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }; }
    }
    case 'lounge-mod': {
      try {
        const r = a.remove ? await removeMod(env, a.player) : await addMod(env, a.player);
        return { op: a.op, ...r, note: r.ok ? (a.remove ? 'They are not a moderator any more (from their next visit).' : 'They are a moderator from their next visit to the Lounge.') : undefined };
      } catch (error) { return { ok: false, error: 'not-migrated', message: `Moderators need migration 0009_studio_lounge.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }; }
    }
    case 'lounge-remove': return { ...(await loungeControl(env, 'unsay', a.all ? { all: true } : { ids: a.ids })), op: a.op };
    case 'lounge-hold': {
      if (a.off) return { ...(await loungeControl(env, 'mute', { line: a.line, off: true })), op: a.op };
      const line = await lineOf(env, a.line);
      if (!line) return { ok: false, error: 'gone', message: 'That message is gone already.' };
      const kept = { id: line.id, name: line.name, seat: null, from: { client: null, token: null, browser: null, player: line.player ?? null } };
      return { ...(await loungeControl(env, a.kick ? 'kick' : 'mute', { line: a.line, minutes: a.minutes, purge: true, kept, ...(a.kick ? { message: 'The studio asked you to take a break from the Lounge.' } : {}) })), op: a.op };
    }
    default: return { ok: false, error: 'unknown' };
  }
}
