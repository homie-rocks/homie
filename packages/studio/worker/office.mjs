/**
 * THE STUDIO'S BACK OFFICE (@homie-rocks/studio 0.13.0): the studio's owner, and the owner's AI, see and run the
 * studio's live games. Everything lives in the studio's own Worker and D1; homie.rocks stores none of it.
 *
 *   /_studio/office              the owner's live view: every live room of every game (players, bots, round,
 *                                uptime) and who is in it, refreshing by itself; kick, mute, announce, close a room;
 *                                each game's launch state, remix switch, room size and invites
 *   /_studio/confirm/<ask>       a control the owner's AI asked for, waiting for the owner's one tap
 *   /_studio/api/...             the same, as JSON, for the page, the in-game owner overlay, the CLI and the MCP
 *   /<game>/invite               an invite code, spent for this browser's pass to an invite-only game
 *
 * WHO. Only the owner: the owner's signed-in browser (the one-time sign-in link the CLI mints with the studio's own
 * Cloudflare login; from 0.13.0 its session cookie lives at / so the owner is recognised in their own games), or an
 * office key (`homie-studio office key`, also minted with that login; D1 keeps only its SHA-256). A player can
 * never be the owner: the session is an HttpOnly cookie no page or game can read, and the games run in a sandboxed,
 * opaque-origin frame that can send no request as this site. With an office key, the AI can look, announce and
 * make invites; a control that takes something away (kick, mute, closing a room, a game's launch state, remix
 * switch or room size) only becomes an ASK, which the owner confirms with one tap in their signed-in browser.
 * No key can confirm an ask.
 *
 * CONTROLS ARE SIGNED. The Worker hands a room a control as a `ctl` message signed with the studio's own office
 * key (HMAC-SHA256, a random secret in D1 `meta`, made on first use), for one game and one room, valid for a
 * minute, used once; the room's Table verifies it before room.mjs applies it (NETPLAY.md section 15).
 *
 * LAUNCH STATES, per game: `private` (the owner only), `invite` (an invite-only beta: invite links or codes, then
 * this browser's pass), `public` (the default; listed). Live in D1 `office_games`; a game.json `"launch"` is a new
 * game's state until the owner sets one, so a game can be private from its first deploy. A game that is not public
 * is left out of the studio's pages, /api/games, /api/rooms and the directory manifest, so the directory drops it
 * the next time it reads the studio; its own pages, rooms and play frame refuse anyone without access (the play
 * frame and its sockets carry a signed ticket the play page mints). A Preview (no D1, an unlisted address of a
 * branch under review) enforces no launch state. The remix switch publishes or withdraws the game's
 * /games/<id>/source.json (a game.json `"share": { "source": false }` builds none to publish).
 *
 * PLAYER ACCOUNTS (worker/players.mjs, handed over in worker/index.mjs with `usePlayers()`): `of(request, env)` names
 * the signed-in player in their play page's ticket, so their seat carries their account and a kick holds it on every
 * device; `get(id, env)` names them in the office; `isOwner(request, env)` lets the owner's own account (a passkey,
 * `homie-studio players owner`) count as the owner everywhere the owner's session does. A player with no account is
 * a guest with a handle.
 */
import { SEAT_MAX, seatsOf } from './seats.mjs';
import { OWNER_COOKIE, cookieValues, ownerAllowed, ownerSession } from './stats.mjs';
import { esc, layout, notFoundPage } from './site.mjs';
import { confirmPage, lockedPage, officePage } from './office-page.mjs';

export { OFFICE_MIGRATION, OFFICE_MIGRATION_FILE } from './office-schema.mjs';

export const LAUNCH_STATES = Object.freeze(['private', 'invite', 'public']);
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ROOM_ID = /^[A-Za-z0-9_-]{1,32}$/;
const ASK_ID = /^ask_[a-f0-9]{16}$/;
const INVITE_ID = /^[a-f0-9]{10}$/;
/** Invite codes: 8 letters and digits nobody misreads (no 0/O, 1/I/L), shown as XXXX-XXXX. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ASK_TTL_MS = 15 * 60_000;
const PASS_TTL_MS = 90 * 24 * 3600_000;
const TICKET_TTL_MS = 12 * 3600_000;
/** Who may stay in a live room after a launch change, by the kinds of holder a ticket names (o, i-…, p-…). */
const ALLOW = Object.freeze({ private: ['o'], invite: ['o', 'i'], public: null });

const json = (body, status = 200, extra = {}) => new Response(`${JSON.stringify(body)}\n`, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private', 'x-robots-tag': 'noindex', ...extra },
});
const enc = encodeURIComponent;
const oneLine = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function randomHex(bytes) {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Equal strings, compared in time that does not depend on where they differ. */
function same(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
/** JSON with every object's keys sorted: what a signature covers. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/* ------------------------------------------------------------------ player accounts (a seam) */

let players = null;
/**
 * The player-accounts API, handed over once by a studio's Worker that has it:
 * `{ get(id, env), of?(request, env), isOwner?(request, env) }` (worker/players.mjs `players` is exactly this).
 */
export function usePlayers(api) { players = api && typeof api === 'object' ? api : null; }

async function playerOf(env, id) {
  if (!players?.get || !id) return null;
  try {
    const p = await players.get(id, env);
    return p && typeof p === 'object' ? { id: String(p.id ?? id).slice(0, 64), handle: oneLine(p.handle ?? p.name, 40) || null, since: p.since ?? p.createdAt ?? null } : null;
  } catch { return null; }
}

/**
 * The player account this request is signed in as (`p-<id>`, a ticket's holder), when the studio has accounts
 * (`players.of(request, env)`); null otherwise. A room then knows the account, so a kick holds it on every device.
 */
export async function accountSub(request, env) {
  if (!players?.of) return null;
  try {
    const p = await players.of(request, env);
    return p && /^[A-Za-z0-9_-]{1,64}$/.test(String(p.id ?? '')) ? `p-${p.id}` : null;
  } catch { return null; }
}

/** The owner: the signed-in owner's browser session, or (with player accounts) the owner's own account. */
export async function isOwner(request, env) {
  if ((await ownerAllowed(request, env, { kinds: ['session'] })) === 'session') return true;
  try { return players?.isOwner ? (await players.isOwner(request, env)) === true : false; } catch { return false; }
}

/* ------------------------------------------------------------------ each game's settings */

const settingsCache = new WeakMap();

/** Every game's live settings (D1 office_games), read at most every 5 s per Worker instance. Empty before migration 0003. */
export async function settingsOf(env, { fresh = false } = {}) {
  if (!env?.DB || env.HOMIE_PREVIEW === '1') return new Map();
  const hit = settingsCache.get(env.DB);
  if (!fresh && hit && Date.now() - hit.at < 5000) return hit.map;
  let map = new Map();
  try {
    const { results } = await env.DB.prepare('SELECT game, launch, remix, max_players, updated_at FROM office_games LIMIT 500').all();
    map = new Map((results ?? []).map((r) => [r.game, r]));
  } catch { map = new Map(); }
  settingsCache.set(env.DB, { at: Date.now(), map });
  return map;
}
const forgetSettings = (env) => { if (env?.DB) settingsCache.delete(env.DB); };

/** A game's launch state: the owner's (D1), else its game.json `launch`, else public. A Preview enforces none. */
export function launchOf(meta, settings, env) {
  if (env?.HOMIE_PREVIEW === '1') return 'public';
  const v = settings?.get(meta?.id)?.launch ?? meta?.launch ?? 'public';
  return LAUNCH_STATES.includes(v) ? v : 'public';
}
/** Whether the game's source is offered for remix: built (game.json share.source) and not withdrawn by the owner. */
export function remixOf(meta, settings) {
  if (meta?.landing?.source === false) return false;
  return settings?.get(meta?.id)?.remix !== 0;
}
/** A room's seats: the game's own (its netplay manifest), lowered by the owner's room size. */
export function seatsFor(meta, settings) {
  const own = seatsOf(meta);
  const n = Math.floor(Number(settings?.get(meta?.id)?.max_players));
  return n >= 1 ? Math.min(own, n) : own;
}
/** The catalogue with only its public games: what every list, the rooms and the directory manifest show. */
export function publicCatalogue(cat, settings, env) {
  const games = (cat.games ?? []).filter((g) => launchOf(g, settings, env) === 'public');
  const featured = cat.studio?.site?.featured;
  const site = featured && !games.some((g) => g.id === featured) ? { ...cat.studio.site, featured: undefined } : cat.studio?.site;
  return { ...cat, studio: cat.studio ? { ...cat.studio, ...(site ? { site } : {}) } : cat.studio, games };
}

/* ------------------------------------------------------------------ the office key: tickets and signed controls */

const keys = new WeakMap();
function hexBytes(hex) { const out = new Uint8Array(hex.length / 2); for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return out; }

/** The studio's office secret (a random 32 bytes in D1 meta, made on first use), as an HMAC key; null without D1. */
async function officeKey(env) {
  if (!env?.DB) return null;
  if (keys.has(env.DB)) return keys.get(env.DB);
  let hex = null;
  try {
    hex = (await env.DB.prepare("SELECT value FROM meta WHERE key = 'office_key'").first())?.value ?? null;
    if (!/^[a-f0-9]{64}$/.test(String(hex))) {
      await env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('office_key', ?1)").bind(randomHex(32)).run();
      hex = (await env.DB.prepare("SELECT value FROM meta WHERE key = 'office_key'").first())?.value ?? null;
    }
  } catch { hex = null; }
  if (!/^[a-f0-9]{64}$/.test(String(hex))) return null;
  const key = await crypto.subtle.importKey('raw', hexBytes(hex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  keys.set(env.DB, key);
  return key;
}
async function mac(key, text) { return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))); }

/**
 * Who a ticket names: `o` the owner, `i-<invite>` an invited browser, `p-<player>` a player account, or two of them
 * joined with `~` (an invited player who is signed in: `i-…~p-…`, so a kick holds the account too).
 */
const PART = '(?:o|i-[a-f0-9]{10}|p-[A-Za-z0-9_-]{1,64})';
const SUB = new RegExp(`^${PART}(?:~${PART})?$`);
const TICKET = new RegExp(`^([a-z0-9]{6,12})\\.(${PART}(?:~${PART})?)\\.([A-Za-z0-9_-]{32})$`);
/** A ticket's holders, as parts. */
export const holders = (sub) => String(sub ?? '').split('~').filter(Boolean);
/** Two holders as one ticket subject (each kind once, the access first). */
export function joinHolders(...subs) {
  const parts = [];
  for (const part of subs.flatMap(holders)) if (!parts.some((p) => p[0] === part[0])) parts.push(part);
  return parts.slice(0, 2).join('~') || null;
}

/** A ticket for one game (12 hours): the play page mints it for a browser it let in; the frame and its sockets carry it. */
export async function ticketFor(env, game, sub, ttlMs = TICKET_TTL_MS) {
  if (!SUB.test(String(sub ?? '')) || !GAME_ID.test(String(game ?? ''))) return null;
  const key = await officeKey(env);
  if (!key) return null;
  const exp = (Date.now() + ttlMs).toString(36);
  return `${exp}.${sub}.${(await mac(key, `ticket|${game}|${exp}|${sub}`)).slice(0, 32)}`;
}

/** Who a ticket names, when it is this studio's, for this game, and unexpired; else null. */
export async function ticketSub(env, game, ticket) {
  const m = TICKET.exec(String(ticket ?? ''));
  if (!m || parseInt(m[1], 36) < Date.now()) return null;
  const key = await officeKey(env);
  if (!key) return null;
  return same((await mac(key, `ticket|${game}|${m[1]}|${m[2]}`)).slice(0, 32), m[3]) ? m[2] : null;
}

/** A control for one room, signed for the room's Table (NETPLAY.md section 15): valid one minute, once. */
export async function signControl(env, { op, game, room, args = {} }) {
  const key = await officeKey(env);
  if (!key) return null;
  const at = Date.now();
  const ctl = { t: 'ctl', v: 1, op, game, room, args, at, exp: at + 60_000, n: randomHex(8) };
  return { ...ctl, sig: await mac(key, `ctl|${canonical(ctl)}`) };
}

/** Why a control must be refused (a word), or null when it is the owner's, for this room, in time, and new. */
export async function verifyControl(env, ctl, { game, room }, seen = null) {
  if (!ctl || typeof ctl !== 'object' || ctl.t !== 'ctl' || ctl.v !== 1 || typeof ctl.op !== 'string') return 'shape';
  if (ctl.game !== game || ctl.room !== room) return 'room';
  const now = Date.now();
  if (!(Number(ctl.exp) > now) || !(Number(ctl.at) <= now + 5000) || Number(ctl.exp) - Number(ctl.at) > 120_000) return 'expired';
  if (typeof ctl.n !== 'string' || !/^[a-f0-9]{16}$/.test(ctl.n)) return 'shape';
  if (seen?.has(ctl.n)) return 'replayed';
  const key = await officeKey(env);
  if (!key) return 'no-key';
  const { sig, ...rest } = ctl;
  if (!same(await mac(key, `ctl|${canonical(rest)}`), String(sig ?? ''))) return 'signature';
  if (seen) {
    seen.set(ctl.n, Number(ctl.exp));
    for (const [n, exp] of seen) if (exp < now) seen.delete(n);
  }
  return null;
}

/* ------------------------------------------------------------------ who may play a game that is not public */

const passCookie = (game) => `studio_pass_${game}`;

/** This browser's pass to an invite-only game (its invite still open), or null. */
async function passOf(request, env, game) {
  if (!env?.DB) return null;
  for (const value of cookieValues(request, passCookie(game)).filter((v) => /^[a-f0-9]{48}$/.test(v)).slice(0, 2)) {
    try {
      const row = await env.DB.prepare('SELECT p.invite, p.expires_at, i.revoked FROM office_passes p JOIN office_invites i ON i.id = p.invite WHERE p.hash = ?1 AND p.game = ?2')
        .bind(await sha256(value), game).first();
      if (row && !row.revoked && Number(row.expires_at) > Date.now()) return { invite: row.invite };
    } catch { return null; }
  }
  return null;
}

async function inviteOpen(env, id) {
  try {
    const row = await env.DB.prepare('SELECT revoked FROM office_invites WHERE id = ?1').bind(id).first();
    return Boolean(row) && !row.revoked;
  } catch { return false; }
}

/**
 * Whether this request may open a game in this launch state: `{ ok, sub, owner }`. A public game is everyone's; a
 * private one the owner's; an invite-only one the owner's and every browser holding a pass.
 */
export async function accessOf(request, env, game, launch) {
  if (launch === 'public') return { ok: true, sub: null, owner: false };
  if (await isOwner(request, env)) return { ok: true, sub: 'o', owner: true };
  if (launch === 'invite') {
    const pass = await passOf(request, env, game);
    if (pass) return { ok: true, sub: `i-${pass.invite}`, owner: false };
  }
  return { ok: false, sub: null, owner: false };
}

/** Whether a ticket's holder may still play now (the state may have changed, or the invite been revoked, since it was minted). */
export async function ticketAllows(env, sub, launch) {
  if (launch === 'public') return true;
  const parts = holders(sub);
  if (parts.includes('o')) return true;
  const invite = parts.find((p) => p.startsWith('i-'));
  if (launch === 'invite' && invite) return inviteOpen(env, invite.slice(2));
  return false;
}

/** The page a visitor without access sees: an invite-only game's door (an invite code), or nothing at all. */
export function gatePage(cat, meta, launch, { code = '', error = '' } = {}) {
  if (launch !== 'invite') {
    return notFoundPage('Nothing here. (Is this your studio? Your AI signs you in from the studio folder: npx --no-install homie-studio office link)', cat);
  }
  const shown = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const pretty = shown.length === 8 ? `${shown.slice(0, 4)}-${shown.slice(4)}` : shown;
  return layout(cat, {
    title: `${meta.name} · invite-only beta`, page: 'invite', status: error ? 403 : 200, active: 'games',
    extraHeaders: { 'x-robots-tag': 'noindex', 'cache-control': 'no-store, private' },
    main: `<header class="head"><p class="kicker">Invite-only beta</p><h1>${esc(meta.name)}</h1>
<p class="lead">${esc(meta.name)} is in a private beta. ${shown ? 'You have an invite: join with one tap.' : 'Have an invite code? Enter it to play.'}</p>
${error ? `<p class="lead" role="alert"><b>${esc(error)}</b></p>` : ''}
<form method="post" action="/${esc(meta.id)}/invite" class="keys" style="flex-wrap:wrap;gap:10px">
<input name="code" value="${esc(pretty)}" placeholder="XXXX-XXXX" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="12" required aria-label="Invite code" style="font:600 18px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;padding:12px 14px;border-radius:12px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;min-width:12ch">
<button class="btn" type="submit">Join the beta</button></form></header>`,
  });
}

/** POST /<game>/invite: an invite code becomes this browser's pass (a cookie for this game's pages only). */
export async function redeemInvite(request, env, url, cat, meta, settings) {
  const launch = launchOf(meta, settings, env);
  if (request.method !== 'POST' || !sameOrigin(request, url)) return new Response('Not allowed', { status: 403, headers: { 'cache-control': 'no-store' } });
  if (launch === 'public') return Response.redirect(`${url.origin}/${meta.id}/play`, 303);
  let code = '';
  try { const form = await request.formData(); code = String(form.get('code') ?? ''); } catch { code = ''; }
  const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (launch !== 'invite' || !env?.DB) return gatePage(cat, meta, launch);
  const now = Date.now();
  let row = null;
  try { row = await env.DB.prepare('SELECT id, game, uses, max_uses, expires_at, revoked FROM office_invites WHERE code = ?1').bind(norm).first(); } catch { row = null; }
  const bad = !row || row.game !== meta.id || row.revoked || (row.expires_at && Number(row.expires_at) < now) || (row.max_uses && Number(row.uses) >= Number(row.max_uses));
  if (bad) return gatePage(cat, meta, launch, { code: norm, error: 'That invite code does not work (used up, ended, or for another game). Ask whoever sent it for a new one.' });
  const pass = randomHex(24);
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE office_invites SET uses = uses + 1 WHERE id = ?1').bind(row.id),
      env.DB.prepare('INSERT INTO office_passes (hash, game, invite, expires_at) VALUES (?1, ?2, ?3, ?4)').bind(await sha256(pass), meta.id, row.id, now + PASS_TTL_MS),
      env.DB.prepare('DELETE FROM office_passes WHERE expires_at < ?1').bind(now),
    ]);
  } catch { return gatePage(cat, meta, launch, { code: norm, error: 'Something went wrong; try again.' }); }
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return new Response(null, {
    status: 303,
    headers: { location: `/${meta.id}/play`, 'cache-control': 'no-store', 'set-cookie': `${passCookie(meta.id)}=${pass}; Path=/${meta.id}/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(PASS_TTL_MS / 1000)}${secure}` },
  });
}

/* ------------------------------------------------------------------ talking to rooms */

const lobbyOf = (env, game) => env.LOBBY.get(env.LOBBY.idFromName(game));
const tableOf = (env, game, room) => env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`));

/** The rooms of one game with people in them now, as its Lobby last heard (public and named). */
async function liveRooms(env, game) {
  try { return ((await (await lobbyOf(env, game).fetch('https://lobby/office')).json()).rooms ?? []).filter((r) => ROOM_ID.test(String(r.room ?? ''))).slice(0, 40); } catch { return []; }
}

async function roomFacts(env, game, room, max) {
  try {
    const res = await tableOf(env, game, room).fetch(`https://table/__facts?game=${enc(game)}&room=${enc(room)}&max=${max}`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

/** Hand one room one signed control; what the room says back. */
async function roomControl(env, meta, settings, room, op, args) {
  const ctl = await signControl(env, { op, game: meta.id, room, args });
  if (!ctl) return { ok: false, error: 'no-key', message: 'This studio has no database for its office yet: `npm run deploy` applies migration 0003_studio_office.sql.' };
  try {
    const res = await tableOf(env, meta.id, room).fetch(new Request(`https://table/__office?game=${enc(meta.id)}&room=${enc(room)}&max=${seatsFor(meta, settings)}`, { method: 'POST', body: JSON.stringify(ctl) }));
    return await res.json();
  } catch (error) { return { ok: false, error: 'room', message: String(error?.message ?? error).slice(0, 120) }; }
}

const roomLabel = (room) => { const m = /^pub-(\d+)$/.exec(room); return m ? `Room ${m[1]}` : room; };

/** One room as the office shows it. */
async function roomRow(env, meta, room, max) {
  const f = await roomFacts(env, meta.id, room, max);
  if (!f) return null;
  const office = f.office ?? {};
  const clients = await Promise.all((office.clients ?? []).map(async (c) => {
    const parts = holders(c.via);
    const pid = parts.find((p) => p.startsWith('p-'))?.slice(2) ?? c.player ?? null;
    const invite = parts.find((p) => p.startsWith('i-'))?.slice(2) ?? null;
    const account = pid ? await playerOf(env, pid) : null;
    return {
      id: c.id, seat: c.seat, name: c.name, device: c.device, role: c.role, want: c.want, hidden: Boolean(c.hidden), waiting: Boolean(c.waiting),
      joinedAt: c.joinedAt, browser: c.browser, muted: Boolean(c.muted), mutedUntil: c.mutedUntil ?? null,
      as: parts.includes('o') ? 'owner' : invite ? 'invited' : account ? 'player' : 'guest',
      ...(invite ? { invite } : {}),
      ...(account ? { account } : {}),
    };
  }));
  const slots = Array.isArray(f.roster) ? f.roster : [];
  return {
    room, label: roomLabel(room), public: /^pub-\d+$/.test(room),
    players: f.counts?.players ?? 0, screens: f.counts?.screens ?? 0, waiting: f.counts?.waiting ?? 0,
    humans: f.counts?.humans ?? 0, bots: f.counts?.bots ?? 0, max: f.counts?.maxPlayers ?? max,
    round: f.round && typeof f.round === 'object' ? { n: f.round.n ?? null, phase: f.round.phase ?? null, startedAt: f.round.startedAt ?? null, endsAt: f.round.endsAt ?? null } : null,
    openedAt: office.openedAt ?? f.openedAt ?? null, closedUntil: office.closedUntil ?? null, snapHz: f.snapHz ?? 0,
    regate: office.regate ?? null,
    host: f.host ?? null, announce: f.announce ?? null,
    slots: slots.slice(0, 64).map((s) => ({ slot: s.slot, seat: s.seat ?? null, name: oneLine(s.name, 40), bot: Boolean(s.bot) })),
    clients, bans: office.bans ?? [], mutes: office.mutes ?? [],
  };
}

async function invitesOf(env, game, origin) {
  try {
    const { results } = await env.DB.prepare('SELECT id, code, label, uses, max_uses, expires_at, revoked, created_at FROM office_invites WHERE game = ?1 ORDER BY created_at DESC LIMIT 100').bind(game).all();
    return (results ?? []).map((r) => inviteView(r, game, origin));
  } catch { return []; }
}
const prettyCode = (c) => `${String(c).slice(0, 4)}-${String(c).slice(4)}`;
function inviteView(r, game, origin) {
  const ended = Boolean(r.revoked) || (r.expires_at && Number(r.expires_at) < Date.now()) || (r.max_uses && Number(r.uses) >= Number(r.max_uses));
  return {
    id: r.id, code: prettyCode(r.code), label: r.label ?? '', uses: Number(r.uses) || 0, maxUses: r.max_uses ?? null,
    expiresAt: r.expires_at ?? null, revoked: Boolean(r.revoked), open: !ended, link: `${origin}/${game}/?invite=${prettyCode(r.code)}`,
  };
}

/** The whole back office, now: every game, its settings, and every live room with who is in it. */
export async function officeView(env, cat, origin) {
  const settings = await settingsOf(env, { fresh: true });
  const games = await Promise.all((cat.games ?? []).map(async (g) => {
    const launch = launchOf(g, settings, env);
    const row = settings.get(g.id);
    const max = seatsFor(g, settings);
    const rooms = (await Promise.all((await liveRooms(env, g.id)).map((r) => roomRow(env, g, r.room, max)))).filter(Boolean)
      .filter((r) => r.players + r.screens > 0 || r.closedUntil || r.bans.length);
    rooms.sort((a, b) => b.players - a.players || a.room.localeCompare(b.room));
    return {
      id: g.id, name: g.name, launch, launchFrom: row?.launch ? 'office' : g.launch ? 'game.json' : 'default',
      remix: remixOf(g, settings), remixBuilt: g.landing?.source !== false,
      seats: seatsOf(g), maxPlayers: max, maxSet: Number(row?.max_players) >= 1 ? Number(row.max_players) : null,
      play: `${origin}/${g.id}/play`, page: `${origin}/${g.id}/`,
      invites: launch === 'invite' || (await hasInvites(env, g.id)) ? await invitesOf(env, g.id, origin) : [],
      rooms, playing: rooms.reduce((n, r) => n + r.players, 0),
    };
  }));
  return {
    ok: true, kind: 'homie-studio-office', v: 1, studio: cat.studio?.name ?? 'Studio', site: origin, now: Date.now(),
    accounts: Boolean(players?.get), games, playing: games.reduce((n, g) => n + g.playing, 0),
  };
}
async function hasInvites(env, game) {
  try { return Boolean(await env.DB.prepare('SELECT 1 AS x FROM office_invites WHERE game = ?1 LIMIT 1').bind(game).first()); } catch { return false; }
}

/* ------------------------------------------------------------------ the controls */

const DESTRUCTIVE = new Set(['kick', 'mute', 'close', 'game']);

/** An action, checked against the catalogue: `{ ok, action }` or `{ ok: false, error, message }`. */
function checkAction(cat, op, body) {
  const meta = (cat.games ?? []).find((g) => g.id === body.game);
  const room = typeof body.room === 'string' && ROOM_ID.test(body.room) ? body.room : null;
  const minutes = Math.max(1, Math.min(24 * 60, Math.floor(Number(body.minutes) || 10)));
  const bad = (message) => ({ ok: false, error: 'bad-request', message });
  switch (op) {
    case 'kick':
    case 'mute': {
      if (!meta) return bad('game is one of this studio\'s game ids');
      if (!room) return bad('room is the room\'s code (pub-3, or a named room)');
      const id = typeof body.id === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(body.id) ? body.id : null;
      const seat = Number.isInteger(body.seat) && body.seat >= 0 && body.seat < SEAT_MAX ? body.seat : null;
      if (id === null && seat === null) return bad('name the player: id (from the office) or seat');
      return { ok: true, action: { op, game: meta.id, room, id, seat, minutes, ...(op === 'kick' ? { address: body.address === true, message: oneLine(body.message, 200) || null } : { off: body.off === true }), name: oneLine(body.name, 40) || null } };
    }
    case 'close': {
      if (!meta) return bad('game is one of this studio\'s game ids');
      if (!room) return bad('room is the room\'s code');
      return { ok: true, action: { op, game: meta.id, room, minutes, reopen: body.reopen === true, message: oneLine(body.message, 200) || null } };
    }
    case 'announce': {
      const text = oneLine(body.text, 280);
      if (body.game !== undefined && body.game !== null && !meta) return bad('game is one of this studio\'s game ids, or leave it out for every game');
      if (body.room !== undefined && body.room !== null && (!room || !meta)) return bad('room needs its game, and is the room\'s code');
      const seconds = Math.max(5, Math.min(3600, Math.floor(Number(body.seconds) || 30)));
      return { ok: true, action: { op, game: meta?.id ?? null, room, text, seconds } };
    }
    case 'game': {
      if (!meta) return bad('game is one of this studio\'s game ids');
      const launch = body.launch === undefined || body.launch === null ? undefined : String(body.launch);
      if (launch !== undefined && !LAUNCH_STATES.includes(launch)) return bad('launch is private, invite or public');
      const remix = body.remix === undefined || body.remix === null ? undefined : body.remix === true || body.remix === 'on';
      let maxPlayers;
      if (body.maxPlayers === null || body.maxPlayers === 'game') maxPlayers = null;
      else if (body.maxPlayers !== undefined) {
        maxPlayers = Math.floor(Number(body.maxPlayers));
        if (!(maxPlayers >= 1)) return bad('maxPlayers is a number from 1 to the game\'s own seats, or null for the game\'s own');
        maxPlayers = Math.min(maxPlayers, seatsOf(meta));
      }
      if (launch === undefined && remix === undefined && maxPlayers === undefined) return bad('say what to change: launch, remix or maxPlayers');
      if (remix === true && meta.landing?.source === false) return bad(`${meta.name}'s source is not in its build (game.json "share": { "source": false }); set it to true and deploy first`);
      return { ok: true, action: { op, game: meta.id, ...(launch !== undefined ? { launch } : {}), ...(remix !== undefined ? { remix } : {}), ...(maxPlayers !== undefined ? { maxPlayers } : {}) } };
    }
    default:
      return bad('unknown control');
  }
}

/** The action in plain words, for the owner's confirm page and the AI's card. */
export function describe(cat, a) {
  const g = (cat.games ?? []).find((x) => x.id === a.game);
  const gname = g?.name ?? a.game;
  const where = a.room ? `${roomLabel(a.room)} of ${gname}` : gname;
  const who = a.name ? `${a.name}${Number.isInteger(a.seat) ? ` (seat ${a.seat + 1})` : ''}` : Number.isInteger(a.seat) ? `the player in seat ${a.seat + 1}` : 'that player';
  const mins = `${a.minutes} minute${a.minutes === 1 ? '' : 's'}`;
  switch (a.op) {
    case 'kick': return `Kick ${who} out of ${where}; they cannot come back to that room for ${mins}${a.address ? ' (nor can anyone else on their network)' : ''}.`;
    case 'mute': return a.off ? `Unmute ${who} in ${where}.` : `Mute ${who} in ${where} for ${mins}: their chat and emotes reach nobody.`;
    case 'close': return a.reopen ? `Open ${where} again.` : `Close ${where}: everyone in it is sent out with a thank-you, and it stays closed for ${mins}.`;
    case 'announce': return `Announce to ${a.room ? where : a.game ? `every room of ${gname}` : 'every room of every game'}: "${a.text}"`;
    case 'game': {
      const bits = [];
      if (a.launch) bits.push({ private: `make ${gname} private (only you can open it; after the current round everyone else leaves its rooms with a thank-you, and it leaves the directory on the next read)`, invite: `make ${gname} an invite-only beta (invited players only; after the current round everyone else leaves its rooms with a thank-you, and it leaves the directory on the next read)`, public: `make ${gname} public (anyone can play; listed in the directory on the next read)` }[a.launch]);
      if (a.remix !== undefined) bits.push(a.remix ? `publish ${gname}'s source for remixing` : `withdraw ${gname}'s source from remixing`);
      if (a.maxPlayers !== undefined) bits.push(a.maxPlayers === null ? `give ${gname}'s rooms the game's own number of seats` : `set ${gname}'s rooms to at most ${a.maxPlayers} players`);
      const s = bits.join('; ');
      return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
    }
    default: return 'A control.';
  }
}

/** Do it: the owner's own session did, or the owner confirmed what the AI asked. */
export async function perform(env, cat, a) {
  const settings = await settingsOf(env, { fresh: true });
  const meta = (cat.games ?? []).find((g) => g.id === a.game) ?? null;
  switch (a.op) {
    case 'kick':
    case 'mute': {
      const r = await roomControl(env, meta, settings, a.room, a.op, a.op === 'kick'
        ? { id: a.id, seat: a.seat, minutes: a.minutes, address: a.address, ...(a.message ? { message: a.message } : {}) }
        : { id: a.id, seat: a.seat, minutes: a.minutes, off: a.off });
      return r;
    }
    case 'close': return roomControl(env, meta, settings, a.room, 'close', a.reopen ? { reopen: true } : { minutes: a.minutes, ...(a.message ? { message: a.message } : {}) });
    case 'announce': {
      const games = a.game ? [meta] : (cat.games ?? []);
      const targets = [];
      for (const g of games) {
        if (a.room) targets.push([g, a.room]);
        else for (const r of await liveRooms(env, g.id)) targets.push([g, r.room]);
      }
      const id = randomHex(4);
      const results = await Promise.all(targets.slice(0, 200).map(([g, room]) => roomControl(env, g, settings, room, 'announce', { text: a.text, seconds: a.seconds, id })));
      return { ok: true, op: 'announce', rooms: results.filter((r) => r.ok).length, people: results.reduce((n, r) => n + (r.people ?? 0), 0), text: a.text, cleared: !a.text };
    }
    case 'game': {
      if (!env?.DB) return { ok: false, error: 'no-db', message: 'This studio has no D1 for its office.' };
      const prev = launchOf(meta, settings, env);
      const row = settings.get(meta.id) ?? {};
      const next = {
        launch: a.launch ?? row.launch ?? null,
        remix: a.remix === undefined ? (row.remix ?? null) : (a.remix ? 1 : 0),
        max: a.maxPlayers === undefined ? (row.max_players ?? null) : a.maxPlayers,
      };
      await env.DB.prepare(`INSERT INTO office_games (game, launch, remix, max_players, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(game) DO UPDATE SET launch = excluded.launch, remix = excluded.remix, max_players = excluded.max_players, updated_at = excluded.updated_at`)
        .bind(meta.id, next.launch, next.remix, next.max, Date.now()).run();
      forgetSettings(env);
      const fresh = await settingsOf(env, { fresh: true });
      const launch = launchOf(meta, fresh, env);
      const done = { ok: true, op: 'game', game: meta.id, launch, remix: remixOf(meta, fresh), maxPlayers: seatsFor(meta, fresh), regating: 0 };
      const rooms = await liveRooms(env, meta.id);
      // Who may play changed: every live room finishes its current round, with a notice, and then whoever the new
      // state leaves out is sent out of it (the owner, and in an invite-only beta the invited, play on). Back to a
      // wider state, a change still waiting is called off.
      if (launch !== prev) {
        const words = {
          private: { notice: `${meta.name} goes private after this round. Thanks for playing!`, message: `${meta.name} is private now. Thanks for playing!` },
          invite: { notice: `${meta.name} becomes an invite-only beta after this round. Invited players keep playing.`, message: `${meta.name} is an invite-only beta now. Have an invite? Enter it on the game's page. Thanks for playing!` },
          public: {},
        }[launch];
        const res = await Promise.all(rooms.map((r) => roomControl(env, meta, fresh, r.room, 'regate', ALLOW[launch] ? { allow: ALLOW[launch], ...words } : {})));
        done.regating = res.filter((r) => r.ok && r.leaving > 0).length;
      }
      if (a.maxPlayers !== undefined) {
        await Promise.all(rooms.map((r) => roomControl(env, meta, fresh, r.room, 'seats', { max: done.maxPlayers })));
      }
      return done;
    }
    default: return { ok: false, error: 'op' };
  }
}

async function makeAsk(env, cat, action, origin) {
  const id = `ask_${randomHex(8)}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO office_asks (id, action, state, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, JSON.stringify(action), 'pending', now, now + ASK_TTL_MS),
    env.DB.prepare('DELETE FROM office_asks WHERE expires_at < ?1').bind(now - 24 * 3600_000),
  ]);
  return askView({ id, action: JSON.stringify(action), state: 'pending', result: null, created_at: now, expires_at: now + ASK_TTL_MS }, cat, origin);
}

function askView(row, cat, origin) {
  let action = null; let result = null;
  try { action = JSON.parse(row.action); } catch { action = null; }
  try { result = row.result ? JSON.parse(row.result) : null; } catch { result = null; }
  const state = row.state === 'pending' && Number(row.expires_at) < Date.now() ? 'expired' : row.state;
  return { id: row.id, state, what: action ? describe(cat, action) : '', action, result, confirm: `${origin}/_studio/confirm/${row.id}`, expiresAt: Number(row.expires_at), createdAt: Number(row.created_at) };
}

async function readAsk(env, id) {
  if (!ASK_ID.test(String(id ?? ''))) return null;
  try { return await env.DB.prepare('SELECT * FROM office_asks WHERE id = ?1').bind(id).first(); } catch { return null; }
}

/** The name in a seat now (so an ask says who it is about). */
async function nameIn(env, cat, a) {
  const meta = (cat.games ?? []).find((g) => g.id === a.game);
  const f = meta ? await roomFacts(env, meta.id, a.room, seatsFor(meta, await settingsOf(env))) : null;
  const c = (f?.clients ?? []).find((x) => (a.id && x.id === a.id) || (a.id === null && x.seat === a.seat));
  return c ? { name: oneLine(c.name, 40), seat: c.seat } : null;
}

/* ------------------------------------------------------------------ routes */

/** A POST from this site's own page: its Origin, or (when a browser sends `Origin: null` or none) Sec-Fetch-Site. */
export function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') return origin === url.origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

async function invitesApi(request, env, url, cat, body, who) {
  const origin = url.origin;
  const meta = (cat.games ?? []).find((g) => g.id === (request.method === 'GET' ? url.searchParams.get('game') : body?.game));
  if (!meta) return json({ ok: false, error: 'bad-request', message: 'game is one of this studio\'s game ids' }, 400);
  if (request.method === 'GET') return json({ ok: true, game: meta.id, invites: await invitesOf(env, meta.id, origin) });
  if (url.pathname.endsWith('/revoke')) {
    if (!INVITE_ID.test(String(body.id ?? ''))) return json({ ok: false, error: 'bad-request', message: 'id is the invite\'s id' }, 400);
    await env.DB.prepare('UPDATE office_invites SET revoked = 1 WHERE id = ?1 AND game = ?2').bind(body.id, meta.id).run();
    return json({ ok: true, game: meta.id, revoked: body.id, by: who });
  }
  const count = Math.max(1, Math.min(20, Math.floor(Number(body.count) || 1)));
  const uses = body.uses === null || body.uses === undefined || body.uses === 'any' ? null : Math.max(1, Math.min(10_000, Math.floor(Number(body.uses) || 1)));
  const days = body.days === null || body.days === undefined ? null : Math.max(1, Math.min(365, Math.floor(Number(body.days) || 30)));
  const label = oneLine(body.label, 60) || null;
  const made = [];
  for (let i = 0; i < count; i += 1) {
    const raw = new Uint8Array(8);
    crypto.getRandomValues(raw);
    const code = [...raw].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    const row = { id: randomHex(5), code, label, uses: 0, max_uses: uses, expires_at: days ? Date.now() + days * 86400_000 : null, revoked: 0, created_at: Date.now() };
    await env.DB.prepare('INSERT INTO office_invites (id, game, code, label, uses, max_uses, expires_at, revoked, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, 0, ?7)')
      .bind(row.id, meta.id, row.code, row.label, row.max_uses, row.expires_at, row.created_at).run();
    made.push(inviteView(row, meta.id, origin));
  }
  return json({ ok: true, game: meta.id, launch: launchOf(meta, await settingsOf(env), env), invites: made });
}

async function api(request, env, url, cat) {
  const path = url.pathname;
  // An office key, the owner's signed-in browser, or the owner's own player account (a passkey).
  let who = await ownerAllowed(request, env, { kinds: ['office', 'session'] });
  if (!who && (await isOwner(request, env))) who = 'session';
  if (!who) {
    return json({ ok: false, error: 'owner-only', message: 'The back office is the studio owner\'s. In the studio folder, `npx --no-install homie-studio office key` gives the owner\'s AI a key; `npx --no-install homie-studio office link` signs the owner\'s browser in.' }, 401, { 'www-authenticate': 'Bearer' });
  }
  if (!env.TABLE || !env.LOBBY) return json({ ok: false, error: 'no-rooms', message: 'this Worker has no rooms bound' }, 503);
  let body = {};
  if (request.method === 'POST') {
    if (who === 'session' && !sameOrigin(request, url)) return json({ ok: false, error: 'origin', message: 'a control comes from this site\'s own pages' }, 403);
    if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return json({ ok: false, error: 'content-type', message: 'send JSON' }, 415);
    const text = await request.text();
    if (text.length > 8192) return json({ ok: false, error: 'too-large' }, 413);
    try { body = JSON.parse(text || '{}'); } catch { return json({ ok: false, error: 'json' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'json' }, 400);
  } else if (request.method !== 'GET') return json({ ok: false, error: 'method' }, 405);

  if (path === '/_studio/api/office' && request.method === 'GET') {
    try { return json({ ...(await officeView(env, cat, url.origin)), by: who }); } catch (error) {
      return json({ ok: false, error: 'no-office', message: `The office is not in this studio's D1 yet: \`npm run deploy\` applies migration 0003_studio_office.sql. (${String(error?.message ?? error).slice(0, 120)})` }, 503);
    }
  }
  if (path === '/_studio/api/invites' || path === '/_studio/api/invites/revoke') {
    if (path.endsWith('/revoke') && request.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
    try { return await invitesApi(request, env, url, cat, body, who); } catch (error) {
      return json({ ok: false, error: 'no-office', message: `Invites need migration 0003_studio_office.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }, 503);
    }
  }
  const askPath = /^\/_studio\/api\/asks\/(ask_[a-f0-9]{16})$/.exec(path);
  if (askPath && request.method === 'GET') {
    const row = await readAsk(env, askPath[1]);
    return row ? json({ ok: true, ask: askView(row, cat, url.origin) }) : json({ ok: false, error: 'no-ask', message: 'No such ask: they last 15 minutes.' }, 404);
  }
  const op = /^\/_studio\/api\/(kick|mute|close|announce|game)$/.exec(path)?.[1];
  if (!op || request.method !== 'POST') return json({ ok: false, error: 'not-found' }, 404);
  const checked = checkAction(cat, op, body);
  if (!checked.ok) return json(checked, 400);
  const action = checked.action;
  // An office key (the owner's AI) only ASKS for what takes something away; the owner confirms with one tap.
  if (who === 'office' && DESTRUCTIVE.has(op)) {
    if (op === 'kick' || op === 'mute') {
      const found = await nameIn(env, cat, action);
      if (!found) return json({ ok: false, error: 'no-player', message: 'Nobody is in that seat of that room now (studio_office lists who is).' }, 404);
      action.name = found.name;
      action.seat = found.seat;
    }
    try {
      const ask = await makeAsk(env, cat, action, url.origin);
      return json({ ok: true, needs: 'owner', ask, message: `Waiting for the owner: ${ask.what} The owner confirms it with one tap at ${ask.confirm} (signed in to the studio; it lasts 15 minutes).` }, 202);
    } catch (error) {
      return json({ ok: false, error: 'no-office', message: `Asks need migration 0003_studio_office.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }, 503);
    }
  }
  const result = await perform(env, cat, action);
  return json({ ...result, what: describe(cat, action), by: who }, result.ok ? 200 : result.error === 'no-player' ? 404 : 400);
}

/** /_studio/office, /_studio/confirm/<ask> and /_studio/api/*; null for any other path. */
export async function officeRoutes(request, env, url, { catalogueOf }) {
  const path = url.pathname;
  if (path.startsWith('/_studio/api/')) return api(request, env, url, await catalogueOf());
  if (path === '/_studio/office' || path === '/_studio/office/') {
    const cat = await catalogueOf();
    if (request.method !== 'GET') return new Response('method', { status: 405 });
    if (!(await isOwner(request, env))) return lockedPage(cat, { what: 'office' });
    // A session from before 0.13.0 lives only under /_studio/: carry it to / so the owner's games know them too.
    const session = await ownerSession(request, env);
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return officePage(cat, session ? { 'set-cookie': `${OWNER_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secure}` } : {});
  }
  const confirm = /^\/_studio\/confirm\/(ask_[a-f0-9]{16})\/?$/.exec(path);
  if (confirm) {
    const cat = await catalogueOf();
    if (!(await isOwner(request, env))) return lockedPage(cat, { what: 'confirm', ask: confirm[1] });
    const row = await readAsk(env, confirm[1]);
    if (!row) return confirmPage(cat, null, { missing: true });
    const ask = askView(row, cat, url.origin);
    if (request.method === 'GET') return confirmPage(cat, ask);
    if (request.method !== 'POST' || !sameOrigin(request, url)) return new Response('Not allowed', { status: 403 });
    let yes = false;
    try { yes = String((await request.formData()).get('do') ?? '') === 'yes'; } catch { yes = false; }
    if (ask.state !== 'pending') return confirmPage(cat, ask);
    if (!yes) {
      await env.DB.prepare("UPDATE office_asks SET state = 'cancelled' WHERE id = ?1 AND state = 'pending'").bind(ask.id).run();
      return confirmPage(cat, { ...ask, state: 'cancelled' });
    }
    // Claim it first, so a double tap does it once.
    await env.DB.prepare("UPDATE office_asks SET state = 'working' WHERE id = ?1 AND state = 'pending'").bind(ask.id).run();
    const claimed = await readAsk(env, ask.id);
    if (claimed?.state !== 'working') return confirmPage(cat, askView(claimed ?? row, cat, url.origin));
    const result = await perform(env, cat, ask.action);
    await env.DB.prepare('UPDATE office_asks SET state = ?2, result = ?3 WHERE id = ?1').bind(ask.id, result.ok ? 'done' : 'failed', JSON.stringify(result).slice(0, 4000)).run();
    return confirmPage(cat, { ...ask, state: result.ok ? 'done' : 'failed', result });
  }
  return null;
}
