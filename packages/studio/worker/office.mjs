/**
 * THE STUDIO'S BACK OFFICE (@homie-rocks/studio 0.13.0): the studio's owner, and the owner's AI, see and run the
 * studio's live games. Everything lives in the studio's own Worker and D1; homie.rocks stores none of it.
 *
 *   /_studio/office              the owner's live view: every live room of every game (players, bots, round,
 *                                uptime) and who is in it, refreshing by itself; kick, mute, announce, close a room;
 *                                each game's launch state, room size and invites
 *   /_studio/confirm/<ask>       a control the owner's AI asked for, waiting for the owner's one tap
 *   /_studio/api/...             the same, as JSON, for the page, the in-game owner overlay, the CLI and the MCP
 *   /<game>/invite               an invite code, spent for this browser's pass to an invite-only game
 *
 * WHO. Only the owner: the owner's signed-in browser (the one-time sign-in link the CLI mints with the studio's own
 * Cloudflare login; from 0.13.0 its session cookie lives at / so the owner is recognised in their own games), or an
 * office key (`homie-studio office key`, also minted with that login; D1 keeps only its SHA-256). A player can
 * never be the owner: the session is an HttpOnly cookie no page or game can read, and the games run in a sandboxed,
 * opaque-origin frame that can send no request as this site. With an office key, the AI can look, announce and
 * make invites; a control that takes something away (kick, mute, closing a room, a game's launch state
 * or room size) only becomes an ASK, which the owner confirms with one tap in their signed-in browser.
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
 * branch under review) enforces no launch state.
 *
 * `office_games` also has a `remix` column: the owner's switch for handing a game over whole, from when that existed
 * (remix was retired). A migration that ran in the field is never edited and the column is never dropped, so it
 * stays in the table with whatever it held; nothing here reads it and nothing writes it (settingsOf, the `game`
 * action below).
 *
 * PLAYER ACCOUNTS (worker/players.mjs, handed over in worker/index.mjs with `usePlayers()`): `of(request, env)` names
 * the signed-in player in their play page's ticket, so their seat carries their account and a kick holds it on every
 * device; `get(id, env)` names them in the office; `isOwner(request, env)` lets the owner's own account (a passkey,
 * `homie-studio players owner`) count as the owner everywhere the owner's session does. A player with no account is
 * a guest with a handle.
 *
 * SERVERS AND AGENT SEATS (0.16.0, worker/servers.mjs and worker/agents.mjs): each game's servers (create at once;
 * a change that narrows who may come in, closing one, or removing a member is an ASK from an office key), agent
 * passes (issued and revoked at once; the secret is shown once), a room's dial (room_level), and whether AI guides
 * may talk (the first time is an ASK: the owner's consent). A server change reaches its live rooms as a signed
 * `policy` control; AI leave after the round when a server becomes humans-only.
 *
 * ROOM CHAT (0.23.0, worker/chat.mjs and worker/chat-store.mjs; NETPLAY.md section 19): each game's chat rules (its
 * game.json defaults, the owner's for the game, the owner's for each server), the last minutes of every live room's
 * chat with Remove (a signed `unsay`), and Mute or Kick from a line (its sender, with their lines taken down), the
 * reports players made (each the one message it is about) with Dismiss, and the review's day (Workers AI neurons).
 * From an office key, a change that opens chat up (more allowed, fewer checks) is an ASK; one that tightens it, or
 * taking a message down, happens at once.
 *
 * THE SHOP (0.24.0, worker/shop.mjs): /_studio/office/shop and /_studio/api/shop (sales, refunds, disputes, payouts as
 * links to the studio's own Stripe, a CSV, the referral books and signed statements). A refund is the owner's one tap;
 * from an office key it is ALWAYS an ask (the AI may only propose one), and so is marking a referrer paid.
 */
import { SEAT_MAX, seatsOf } from './seats.mjs';
import { PUBLIC_SERVER, SERVER_LIMITS, checkServer, levelName, narrows, policyOf, roomServer, rowFor, serverView, serversOf, serverPassCookie, writeServer } from './servers.mjs';
import { BRAIN_BUDGET, aiName, brainFor, fillSpot, passById, passCreate, passList, passRevoke, think } from './agents.mjs';
import { DEFAULT_MODEL, NEURONS_PER_M, OWNER_MODEL, vocabularyOf } from './brain.mjs';
import { OWNER_COOKIE, cookieValues, counter, ownerAllowed, ownerSession, today } from './stats.mjs';
import { esc, layout, notFoundPage } from './site.mjs';
import { confirmPage, lockedPage, officePage } from './office-page.mjs';
import { CHAT_MODES, CHAT_WHO, checkChatRules, publicChat } from './chat.mjs';
import { chatDay, chatOf, chatRowsOf, clearChatRules, dismissReport, reportsOf, writeChatRules } from './chat-store.mjs';
import { linesOf, checkRelease, performRelease, checkRefund, checkSettle, describeRefund, officeShopPage, ordersCsv, performRefund, receivedPages, settleReferrer, shopOffice, statementsOut, statementsSend } from './shop.mjs';
import { orderById } from './shop-store.mjs';
import { checkLoungeAction, describeLounge, loungeNeedsAsk, loungeOffice, performLounge } from './lounge.mjs';

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

/**
 * The room control for a launch state (NETPLAY.md section 15 `regate`): who may stay, the notice everyone sees while
 * the round finishes, and the words for whoever then leaves. Public calls a waiting change off.
 */
export function regateArgs(launch, name = 'This game') {
  if (!ALLOW[launch]) return {};
  return {
    allow: ALLOW[launch],
    ...{
      private: { notice: `${name} goes private after this round. Thanks for playing!`, message: `${name} is private now. Thanks for playing!` },
      invite: { notice: `${name} becomes an invite-only beta after this round. Invited players keep playing.`, message: `${name} is an invite-only beta now. Have an invite? Enter it on the game's page. Thanks for playing!` },
    }[launch],
  };
}

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

/** Every game's live settings (D1 office_games), read at most every 5 s per Worker instance. Empty before migration 0005. */
export async function settingsOf(env, { fresh = false } = {}) {
  if (!env?.DB || env.HOMIE_PREVIEW === '1') return new Map();
  const hit = settingsCache.get(env.DB);
  if (!fresh && hit && Date.now() - hit.at < 5000) return hit.map;
  let map = new Map();
  try {
    const { results } = await env.DB.prepare('SELECT game, launch, max_players, updated_at FROM office_games LIMIT 500').all();
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
 * Who a ticket names: `o` the owner, `i-<invite>` an invited browser, `p-<player>` a player account, `a-<pass>` an
 * AI with an agent pass (0.16.0), or two of them joined with `~` (an invited player who is signed in: `i-…~p-…`, so
 * a kick holds the account too).
 */
const PART = '(?:o|i-[a-f0-9]{10}|p-[A-Za-z0-9_-]{1,64}|a-[a-f0-9]{10})';
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

/**
 * Whether a ticket's holder may still play now (the state may have changed, or the invite been revoked, since it was
 * minted). An agent's own pass opens a game that is not public only when it is the owner's (only the owner mints one).
 */
export async function ticketAllows(env, sub, launch) {
  if (launch === 'public') return true;
  const parts = holders(sub);
  if (parts.includes('o')) return true;
  const agent = parts.find((p) => p.startsWith('a-'));
  if (agent) { const pass = await passById(env, agent.slice(2)); return Boolean(pass?.live && pass.kind === 'owner'); }
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
  let code = '';
  try { const form = await request.formData(); code = String(form.get('code') ?? ''); } catch { code = ''; }
  const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const now = Date.now();
  let row = null;
  // An invite to one server (0.16.0, its door `invite`) works in a public game too; one to the game, only in a beta.
  try { row = env?.DB ? await env.DB.prepare('SELECT id, game, server, uses, max_uses, expires_at, revoked FROM office_invites WHERE code = ?1').bind(norm).first() : null; } catch {
    // A D1 from before migration 0006 has no `server` column: the game's own invites still work.
    try { row = await env.DB.prepare('SELECT id, game, uses, max_uses, expires_at, revoked FROM office_invites WHERE code = ?1').bind(norm).first(); } catch { row = null; }
  }
  if (!row?.server) {
    if (launch === 'public') return Response.redirect(`${url.origin}/${meta.id}/play`, 303);
    if (launch !== 'invite' || !env?.DB) return gatePage(cat, meta, launch);
  }
  const bad = !row || row.game !== meta.id || row.revoked || (row.expires_at && Number(row.expires_at) < now) || (row.max_uses && Number(row.uses) >= Number(row.max_uses));
  if (bad) return gatePage(cat, meta, launch === 'public' ? 'invite' : launch, { code: norm, error: 'That invite code does not work (used up, ended, or for another game). Ask whoever sent it for a new one.' });
  const pass = randomHex(24);
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE office_invites SET uses = uses + 1 WHERE id = ?1').bind(row.id),
      env.DB.prepare('INSERT INTO office_passes (hash, game, invite, expires_at) VALUES (?1, ?2, ?3, ?4)').bind(await sha256(pass), meta.id, row.id, now + PASS_TTL_MS),
      env.DB.prepare('DELETE FROM office_passes WHERE expires_at < ?1').bind(now),
    ]);
  } catch { return gatePage(cat, meta, launch, { code: norm, error: 'Something went wrong; try again.' }); }
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  const cookie = row.server ? serverPassCookie(meta.id, row.server) : passCookie(meta.id);
  return new Response(null, {
    status: 303,
    headers: { location: row.server ? `/${meta.id}/s/${row.server}/play` : `/${meta.id}/play`, 'cache-control': 'no-store', 'set-cookie': `${cookie}=${pass}; Path=/${meta.id}/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(PASS_TTL_MS / 1000)}${secure}` },
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
  if (!ctl) return { ok: false, error: 'no-key', message: 'This studio has no database for its office yet: `npm run deploy` applies migration 0005_studio_office.sql.' };
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
    const agentPass = parts.find((p) => p.startsWith('a-'))?.slice(2) ?? null;
    return {
      id: c.id, seat: c.seat, name: c.name, device: c.device, role: c.role, want: c.want, hidden: Boolean(c.hidden), waiting: Boolean(c.waiting),
      joinedAt: c.joinedAt, browser: c.browser, muted: Boolean(c.muted), mutedUntil: c.mutedUntil ?? null,
      // An AI (an agent pass, section 17) is always marked AI, here as everywhere.
      ...(c.agent ? { agent: { role: c.agent.role, hands: c.agent.hands, pass: c.agent.pass ?? agentPass } } : {}),
      as: c.agent ? 'ai' : parts.includes('o') ? 'owner' : invite ? 'invited' : account ? 'player' : 'guest',
      ...(invite ? { invite } : {}),
      ...(account ? { account } : {}),
    };
  }));
  const slots = Array.isArray(f.roster) ? f.roster : [];
  return {
    ...(f.durability ? { durability: { ok: f.durability.ok === true, message: oneLine(f.durability.message ?? '', 160), since: Number(f.durability.since) || null } } : {}),
    room, label: roomLabel(room), public: /^pub-\d+$/.test(room), server: roomServer(room),
    players: f.counts?.players ?? 0, screens: f.counts?.screens ?? 0, waiting: f.counts?.waiting ?? 0,
    humans: f.counts?.humans ?? 0, bots: f.counts?.bots ?? 0, max: f.counts?.maxPlayers ?? max,
    agents: f.counts?.agents ?? 0, ai: f.counts?.ai ?? 0, humanSeats: f.counts?.humanSeats ?? null,
    // The room's dial now and who set it (the party's vote, the owner), its policy, and what its game reads.
    policy: f.policy ? { kind: f.policy.kind, level: f.policy.skill?.level ?? f.policy.level, levelName: f.policy.skill?.name ?? levelName(f.policy.level), levelMax: f.policy.levelMax, by: f.policy.by ?? null, speech: f.policy.speech } : null,
    caps: Array.isArray(f.caps) ? f.caps : [], rev: f.rev ?? null,
    vote: f.vote ?? null,
    round: f.round && typeof f.round === 'object' ? { n: f.round.n ?? null, phase: f.round.phase ?? null, startedAt: f.round.startedAt ?? null, endsAt: f.round.endsAt ?? null } : null,
    openedAt: office.openedAt ?? f.openedAt ?? null, closedUntil: office.closedUntil ?? null, snapHz: f.snapHz ?? 0,
    regate: office.regate ?? null,
    host: f.host ?? null, announce: f.announce ?? null,
    slots: slots.slice(0, 64).map((s) => ({ slot: s.slot, seat: s.seat ?? null, name: oneLine(s.name, 40), bot: Boolean(s.bot), ...(s.agent ? { agent: { role: s.agent.role ?? 'party', seat: s.agent.seat ?? null } } : {}) })),
    clients, bans: office.bans ?? [], mutes: office.mutes ?? [],
    // Room chat (0.23.0): the room's last minutes, with who sent each line (a client id and account; never an address).
    chat: office.chat ? { mode: office.chat.rules?.mode ?? null, pending: office.chat.pending ?? 0, lines: (office.chat.lines ?? []).slice(-50).map((l) => ({ id: l.id, at: l.at, t: l.t, kind: l.kind, name: oneLine(l.name, 40), seat: l.seat ?? null, by: l.by, text: l.text ?? null, glyph: l.glyph ?? null, react: l.react ?? null, say: l.say ?? null, acct: Boolean(l.acct), owner: Boolean(l.owner), client: l.client ?? null, player: l.player ?? null, browser: l.browser ?? null, ...(l.review ? { review: l.review } : {}) })) } : null,
    // A game's own decisions (0.24.4, net.decide): how many, who answered, the model's median time, the neurons.
    ...(office.decides && typeof office.decides === 'object' ? { decides: { n: Number(office.decides.n) || 0, by: office.decides.by ?? {}, msP50: office.decides.msP50 ?? null, neurons: Number(office.decides.neurons) || 0 } } : {}),
    // The house guides' brains (0.17.0): which brain, why not when it is not, and the last decisions (seats and ids).
    ...(f.brains && typeof f.brains === 'object' ? { brains: {
      brain: String(f.brains.brain ?? ''), why: f.brains.why ? oneLine(f.brains.why, 120) : null, calls: Number(f.brains.calls) || 0,
      guides: (Array.isArray(f.brains.guides) ? f.brains.guides : []).slice(0, 8).map((g) => ({ name: oneLine(g.name, 40), seat: g.seat ?? null, provider: g.provider ?? null })),
      decisions: (Array.isArray(f.brains.decisions) ? f.brains.decisions : []).slice(-50),
    } } : {}),
  };
}

/**
 * `agents try` (0.24.4): a guide's brain on one moment the owner gives, with no seat taken and nobody in a room: the
 * game's own vocabulary, the view, the asks and the party's lines in; the decision out, with the brain's own pick
 * before the fixed rules, Clef's probabilities, the model's time and the neurons. It runs exactly what a house guide
 * runs (agents.mjs think) and spends from the same day's budget, so a creator can test an agents.json, and compare a
 * model (`model`: one of the models this toolkit prices) before setting it.
 */
export async function agentsTry(env, cat, body) {
  const bad = (message) => ({ ok: false, error: 'bad-request', message });
  const meta = (cat.games ?? []).find((g) => g.id === body.game);
  if (!meta) return bad('game is one of this studio\'s game ids');
  const mode = body.mode ?? 'workers-ai';
  if (!['workers-ai', 'owner-key', 'script'].includes(mode)) return bad('mode is workers-ai, owner-key or script');
  if (body.model !== undefined && !(typeof body.model === 'string' && NEURONS_PER_M[body.model])) return bad(`model is one of ${Object.keys(NEURONS_PER_M).join(', ')}`);
  const view = body.view && typeof body.view === 'object' && !Array.isArray(body.view) ? body.view : null;
  if (!view || JSON.stringify(view).length > 2048) return bad('view is the game state a guide sees (an object, under 2 KB)');
  const int = (v) => Number.isInteger(v) && v >= 0 && v < 64;
  const asks = (Array.isArray(body.asks) ? body.asks : []).slice(0, 3).filter((a) => a && typeof a.k === 'string' && int(a.from)).map((a, i) => ({ k: a.k, args: a.args && typeof a.args === 'object' ? a.args : {}, from: a.from, at: Date.now() - i }));
  const party = (Array.isArray(body.party) ? body.party : []).slice(-3).filter((p) => p && int(p.seat) && typeof p.line === 'string').map((p) => ({ seat: p.seat, line: p.line, args: p.args ?? {} }));
  const seats = (list) => (Array.isArray(list) ? list.filter(int).slice(0, 32) : []);
  let vocab = null;
  try {
    const res = env.ASSETS ? await env.ASSETS.fetch(new Request(`https://assets.local/games/${meta.id}/agents.json`)) : null;
    if (res?.ok) vocab = vocabularyOf(await res.json()).vocab;
  } catch { vocab = null; }
  if (!vocab) return { ok: false, error: 'no-vocabulary', message: `${meta.name} has no agents.json in this build: its guides have nothing to choose from.` };
  const day = await brainDay(env);
  const budget = { left: (k) => (k === 'neurons' ? day.budget.neurons - day.used.neurons : day.budget.usd * 1e6 - day.used.usd * 1e6) };
  const e = body.model ? { ...env, HOMIE_BRAIN_MODEL: body.model } : env;
  const brain = brainFor(mode, e, { budget });
  const ctx = {
    view, me: { seat: int(body.seat) ? body.seat : 7 }, goal: view.goal ?? null, asks, party, speech: ['game', 'lines', 'off'].includes(body.speech) ? body.speech : 'lines',
    kids: body.kids === true, quiet: body.quiet === true, players: seats(body.players ?? (Array.isArray(view.party) ? view.party.map((p) => p?.seat) : [])), avoid: seats(body.avoid),
    // What a house guide remembers: who is new to it, and its own last lines (ids, arguments, how long ago).
    newHere: seats(body.newHere),
    said: (Array.isArray(body.said) ? body.said : []).slice(-4).filter((x) => x && typeof x.line === 'string' && vocab.lines[x.line]).map((x) => ({ line: x.line, args: x.args && typeof x.args === 'object' ? x.args : {}, ago: Math.max(0, Number(x.agoMs) || 0) })),
  };
  const t = await think(vocab, { mode, brain, ctx });
  if (t.engine && env.DB) {
    const rows = [counter(env, { metric: 'brain-calls', subject: meta.id, source: 'try' })];
    const n = Math.round(t.cost.neurons);
    if (n > 0) rows.push(counter(env, { metric: 'brain-neurons', subject: meta.id, n }));
    if (t.cost.micros >= 1) rows.push(counter(env, { metric: 'brain-microdollars', subject: meta.id, n: Math.round(t.cost.micros) }));
    await env.DB.batch(rows.filter(Boolean)).catch(() => {});
  }
  return {
    ok: true, game: meta.id, mode, model: t.model ?? (mode === 'workers-ai' ? e.HOMIE_BRAIN_MODEL || DEFAULT_MODEL : null), engine: t.engine, provider: t.provider,
    decision: t.decision, own: t.own, overruled: /\+floor$/.test(t.provider), why: t.why, p: t.p, ms: t.ms,
    // A decision model's whole answer: every option's probability, per question (ids and numbers only).
    ...(t.answers ? { answers: Object.fromEntries(Object.entries(t.answers).map(([k, a]) => [k, a?.probabilities ? Object.fromEntries(Object.entries(a.probabilities).map(([o, v]) => [o, Math.round(Number(v) * 100) / 100])) : a?.noul ?? a?.score ?? null])) } : {}),
    ...(t.usage ? { tokens: { input: Number(t.usage.input_tokens ?? t.usage.prompt_tokens) || null, output: Number(t.usage.output_tokens ?? t.usage.completion_tokens) || 0 } } : {}),
    neurons: Math.round(t.cost.neurons * 1000) / 1000, micros: Math.round(t.cost.micros),
    budget: { neurons: day.budget.neurons, usedBefore: Math.round(day.used.neurons) },
  };
}

/** The AI brains' day for the whole studio: the budget (meta brain_budget) and what today used (stats_daily). */
export async function brainDay(env) {
  const budget = { neurons: BRAIN_BUDGET.neurons, usd: BRAIN_BUDGET.usd };
  const used = { neurons: 0, usd: 0, calls: 0 };
  try {
    const b = JSON.parse((await env.DB.prepare("SELECT value FROM meta WHERE key = 'brain_budget'").first())?.value ?? 'null');
    if (b && Number.isFinite(Number(b.neurons))) budget.neurons = Number(b.neurons);
    if (b && Number.isFinite(Number(b.usd))) budget.usd = Number(b.usd);
  } catch { /* the defaults */ }
  try {
    const { results } = await env.DB.prepare("SELECT metric, SUM(n) AS n FROM stats_daily WHERE day = ?1 AND metric IN ('brain-calls', 'brain-neurons', 'brain-microdollars') GROUP BY metric").bind(today()).all();
    for (const r of results ?? []) {
      if (r.metric === 'brain-calls') used.calls = Number(r.n) || 0;
      if (r.metric === 'brain-neurons') used.neurons = Number(r.n) || 0;
      if (r.metric === 'brain-microdollars') used.usd = Math.round(Number(r.n) || 0) / 1e6;
    }
  } catch { /* nothing counted yet */ }
  return { budget, used, ai: Boolean(env.AI), key: Boolean(env.HOMIE_BRAIN_KEY), model: env.HOMIE_BRAIN_MODEL || DEFAULT_MODEL, ownerModel: OWNER_MODEL };
}

async function invitesOf(env, game, origin) {
  try {
    const { results } = await env.DB.prepare('SELECT id, code, label, uses, max_uses, expires_at, revoked, created_at, server FROM office_invites WHERE game = ?1 ORDER BY created_at DESC LIMIT 100').bind(game).all();
    return (results ?? []).map((r) => inviteView(r, game, origin));
  } catch {
    // Before migration 0006 an invite is the game's (no `server`).
    try {
      const { results } = await env.DB.prepare('SELECT id, code, label, uses, max_uses, expires_at, revoked, created_at FROM office_invites WHERE game = ?1 ORDER BY created_at DESC LIMIT 100').bind(game).all();
      return (results ?? []).map((r) => inviteView(r, game, origin));
    } catch { return []; }
  }
}
const prettyCode = (c) => `${String(c).slice(0, 4)}-${String(c).slice(4)}`;
function inviteView(r, game, origin) {
  const ended = Boolean(r.revoked) || (r.expires_at && Number(r.expires_at) < Date.now()) || (r.max_uses && Number(r.uses) >= Number(r.max_uses));
  return {
    id: r.id, code: prettyCode(r.code), label: r.label ?? '', uses: Number(r.uses) || 0, maxUses: r.max_uses ?? null,
    expiresAt: r.expires_at ?? null, revoked: Boolean(r.revoked), open: !ended,
    // An invite to one server (0.16.0) opens that server's door; any other, the game's invite-only beta.
    ...(r.server ? { server: r.server } : {}),
    link: r.server ? `${origin}/${game}/s/${r.server}/play?invite=${prettyCode(r.code)}` : `${origin}/${game}/?invite=${prettyCode(r.code)}`,
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
      .filter((r) => r.players + r.screens > 0 || r.closedUntil || r.bans.length || (r.chat && r.chat.lines.length));
    rooms.sort((a, b) => b.players - a.players || a.room.localeCompare(b.room));
    const servers = await serversOf(env, g, { fresh: true });
    const byServer = {};
    for (const r of rooms) { const b = (byServer[r.server] ??= { rooms: 0, players: 0, ai: 0 }); b.rooms += 1; b.players += r.players; b.ai += r.ai; }
    const members = await memberCountsOf(env, g.id);
    const chatRows = await chatRowsOf(env, { fresh: true });
    return {
      id: g.id, name: g.name, launch, launchFrom: row?.launch ? 'office' : g.launch ? 'game.json' : 'default',
      // Room chat (0.23.0): the game's rules as Quick play has them, where each came from, and each server's own.
      chat: {
        rules: publicChat(chatOf(g, servers.find((x) => x.id === 'public') ?? null, chatRows)),
        from: chatRows.get(`${g.id}/`) ? 'office' : g.chat !== undefined ? 'game.json' : 'default',
        office: chatRows.get(`${g.id}/`) ?? null,
        servers: servers.filter((x) => x.id !== 'public' || chatRows.get(`${g.id}/public`)).map((sv) => ({ id: sv.id, name: sv.name, rules: publicChat(chatOf(g, sv, chatRows)), office: chatRows.get(`${g.id}/${sv.id}`) ?? null })),
        reports: await reportsOf(env, { game: g.id }),
      },
      // Servers (0.16.0): each with its policy and what is on it now; its build reads the dial only from netplay rev 6.
      servers: servers.map((sv) => ({ ...serverView(sv, { origin, game: g.id }), live: byServer[sv.id] ?? { rooms: 0, players: 0, ai: 0 }, members: members[sv.id] ?? 0 })),
      build: { netplayRev: Number.isInteger(g.netplayRev) ? g.netplayRev : null, predates: !(Number(g.netplayRev) >= 6), caps: g.caps ?? null, guides: Number(g.netplayRev) >= 7 },
      // 0.17.0: the game's AI guides have words of their own (agents.json): without it they play but never talk.
      vocab: g.vocab === true,
      passes: (await passList(env, { game: g.id })).filter((x) => x.live || Date.now() - x.createdAt < 7 * 86_400_000),
      seats: seatsOf(g), maxPlayers: max, maxSet: Number(row?.max_players) >= 1 ? Number(row.max_players) : null,
      play: `${origin}/${g.id}/play`, page: `${origin}/${g.id}/`,
      invites: launch === 'invite' || (await hasInvites(env, g.id)) ? await invitesOf(env, g.id, origin) : [],
      rooms, playing: rooms.reduce((n, r) => n + r.players, 0),
    };
  }));
  return {
    ok: true, kind: 'homie-studio-office', v: 1, studio: cat.studio?.name ?? 'Studio', site: origin, now: Date.now(),
    accounts: Boolean(players?.get), games, playing: games.reduce((n, g) => n + g.playing, 0),
    // The fill-a-spot service (an AI seated in an empty spot for a price) is a money decision: not offered yet.
    fillSpot: { available: Boolean(fillSpot()), note: 'Let a fill-a-spot service seat AI (coming later)' },
    agentsTalk: await talkConsented(env),
    brain: await brainDay(env),
    chat: await chatDay(env, today()),
    // The Lounge (0.29.0): null when the studio has none.
    lounge: await loungeOffice(env, cat, origin).catch(() => null),
  };
}
async function memberCountsOf(env, game) {
  try {
    const { results } = await env.DB.prepare('SELECT server, COUNT(*) AS n FROM server_members WHERE game = ?1 GROUP BY server').bind(game).all();
    return Object.fromEntries((results ?? []).map((r) => [r.server, Number(r.n) || 0]));
  } catch { return {}; }
}
/** Whether the owner has said yes to AI guides talking (a `meta` row, the first `agents-brain` ask). */
async function talkConsented(env) {
  try { return Boolean((await env.DB.prepare("SELECT value FROM meta WHERE key = 'agents_talk_ok'").first())?.value); } catch { return false; }
}
async function hasInvites(env, game) {
  try { return Boolean(await env.DB.prepare('SELECT 1 AS x FROM office_invites WHERE game = ?1 LIMIT 1').bind(game).first()); } catch { return false; }
}

/* ------------------------------------------------------------------ the controls */

/** Always an ask from an office key; servers' asks are decided case by case (needsAsk: what narrows, or consent). */
const DESTRUCTIVE = new Set(['kick', 'mute', 'close', 'game']);

/** An action, checked against the catalogue: `{ ok, action }` or `{ ok: false, error, message }`. */
function checkAction(cat, op, body) {
  // The Lounge's controls (0.29.0, worker/lounge.mjs): its rules, play nights, moderators, its lines and their senders.
  const lounge = checkLoungeAction(cat, op, body);
  if (lounge) return lounge;
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
      // From a chat line (0.23.0): its sender, whoever they are now (a watcher too); `purge` takes their lines down.
      const line = typeof body.line === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(body.line) ? body.line : null;
      if (id === null && seat === null && line === null) return bad('name the player: id (from the office), seat, or line (a chat message of theirs)');
      return { ok: true, action: { op, game: meta.id, room, id, seat, ...(line ? { line, purge: body.purge === true } : {}), minutes, ...(op === 'kick' ? { address: body.address === true, message: oneLine(body.message, 200) || null } : { off: body.off === true }), name: oneLine(body.name, 40) || null } };
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
      let maxPlayers;
      if (body.maxPlayers === null || body.maxPlayers === 'game') maxPlayers = null;
      else if (body.maxPlayers !== undefined) {
        maxPlayers = Math.floor(Number(body.maxPlayers));
        if (!(maxPlayers >= 1)) return bad('maxPlayers is a number from 1 to the game\'s own seats, or null for the game\'s own');
        maxPlayers = Math.min(maxPlayers, seatsOf(meta));
      }
      // An older plugin or CLI may still send `remix` (the switch that offered a game whole). It is not a setting
      // any more: alone it is refused in a sentence, and beside a launch state or a room size it is left out.
      if (launch === undefined && maxPlayers === undefined) return bad(body.remix !== undefined && body.remix !== null ? 'remix was retired: a game is no longer handed over whole, so there is no switch to set. A studio shares pieces of its games as parts (/parts/)' : 'say what to change: launch or maxPlayers');
      return { ok: true, action: { op, game: meta.id, ...(launch !== undefined ? { launch } : {}), ...(maxPlayers !== undefined ? { maxPlayers } : {}) } };
    }
    case 'server-create': {
      if (!meta) return bad('game is one of this studio\'s game ids');
      const c = checkServer(body, { create: true });
      if (!c.ok) return c;
      return { ok: true, action: { op, game: meta.id, fields: c.fields } };
    }
    case 'server-set': {
      if (!meta) return bad('game is one of this studio\'s game ids');
      if (typeof body.server !== 'string' || !(body.server === 'public' || /^[a-z0-9][a-z0-9-]{1,19}$/.test(body.server))) return bad('server is the server\'s id');
      const { game: _g, server: _s, ...rest } = body;
      const c = checkServer(rest);
      if (!c.ok) return c;
      if (!Object.keys(c.fields).length) return bad('say what to change: name, blurb, policy, aiSeats, guides, bots, level, levelMax, speech, door, kids, beginnerDays, beginnerLevel, rooms, seats, listed');
      return { ok: true, action: { op, game: meta.id, server: body.server, fields: c.fields } };
    }
    case 'server-close': {
      if (!meta) return bad('game is one of this studio\'s game ids');
      if (typeof body.server !== 'string' || !/^[a-z0-9][a-z0-9-]{1,19}$/.test(body.server)) return bad('server is the server\'s id (the public server is Quick play: close it with "public")');
      return { ok: true, action: { op, game: meta.id, server: body.server, reopen: body.reopen === true } };
    }
    case 'member': {
      if (!meta) return bad('game is one of this studio\'s game ids');
      if (typeof body.server !== 'string' || !/^[a-z0-9][a-z0-9-]{1,19}$/.test(body.server)) return bad('server is the server\'s id');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(body.player ?? ''))) return bad('player is the player\'s id (from the office)');
      if (body.remove !== true && !['member', 'mentor', 'mod'].includes(body.role)) return bad('role is member, mentor or mod; or remove: true');
      return { ok: true, action: { op, game: meta.id, server: body.server, player: body.player, ...(body.remove === true ? { remove: true } : { role: body.role }), name: oneLine(body.name, 40) || null } };
    }
    case 'pass': {
      const action = ['create', 'list', 'revoke'].includes(body.action) ? body.action : 'create';
      if (body.game !== undefined && body.game !== null && !meta) return bad('game is one of this studio\'s game ids, or leave it out for any');
      if (action === 'revoke' && !/^[a-f0-9]{10}$/.test(String(body.id ?? ''))) return bad('id is the pass\'s id');
      return { ok: true, action: { op, action, game: meta?.id ?? null, id: body.id ?? null, label: oneLine(body.label, 24), role: body.role ?? 'party', hands: body.hands ?? 'self', server: body.server ?? null, days: body.days ?? null, kind: body.kind ?? 'owner' } };
    }
    case 'room-level': {
      if (!meta) return bad('game is one of this studio\'s game ids');
      if (!room) return bad('room is the room\'s code');
      const level = Math.floor(Number(body.level));
      if (!(level >= 1 && level <= 5)) return bad('level is 1 to 5 (Rookie, Steady, Fair, Strong, Maxed)');
      return { ok: true, action: { op, game: meta.id, room, level } };
    }
    case 'shop-release': return checkRelease(body);
    case 'refund': return checkRefund(body);
    case 'shop-settle': return checkSettle(body);
    case 'agents-brain': {
      if (!meta) return bad('game is one of this studio\'s game ids');
      if (typeof body.server !== 'string' || !(body.server === 'public' || /^[a-z0-9][a-z0-9-]{1,19}$/.test(body.server))) return bad('server is the server\'s id');
      if (!['off', 'script', 'workers-ai', 'owner-key'].includes(body.mode)) return bad('mode is off, script, workers-ai or owner-key');
      // The day's budget for the studio's brains: Workers AI neurons (workers-ai) or dollars of the owner's key (owner-key).
      const budget = body.budget === undefined || body.budget === null ? undefined : Number(body.budget);
      if (budget !== undefined && (!['workers-ai', 'owner-key'].includes(body.mode) || !(budget >= 0) || budget > (body.mode === 'owner-key' ? 100 : 1e7))) return bad('budget goes with workers-ai (neurons a day; the free allocation is 10,000 an account) or owner-key (dollars a day, at most 100)');
      return { ok: true, action: { op, game: meta.id, server: body.server, mode: body.mode, ...(budget !== undefined ? { budget } : {}) } };
    }
    case 'chat-rules': {
      if (!meta) return bad('game is one of this studio\'s game ids');
      const server = body.server === undefined || body.server === null || body.server === '' ? '' : String(body.server);
      if (server && !(server === 'public' || /^[a-z0-9][a-z0-9-]{1,19}$/.test(server))) return bad('server is a server\'s id, or leave it out for the whole game');
      if (body.reset === true) return { ok: true, action: { op, game: meta.id, server, reset: true } };
      const { game: _g, server: _s, ...rest } = body;
      const c = checkChatRules(rest);
      if (!c.ok) return c;
      if (!Object.keys(c.fields).length) return bad(`say what to change: mode (${CHAT_MODES.join(', ')}), who / react (${CHAT_WHO.join(', ')}), slow, max, links, swears, ai, bubbles, watchers, hub, block, allow, lines, emoji; or reset: true`);
      return { ok: true, action: { op, game: meta.id, server, fields: c.fields } };
    }
    case 'chat-remove': {
      if (!meta) return bad('game is one of this studio\'s game ids');
      if (!room) return bad('room is the room\'s code');
      const ids = (Array.isArray(body.ids) ? body.ids : body.id !== undefined ? [body.id] : []).filter((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(x)).slice(0, 64);
      if (!ids.length && body.all !== true) return bad('id is the message\'s id (from the office), or all: true');
      return { ok: true, action: { op, game: meta.id, room, ...(body.all === true ? { all: true } : { ids }) } };
    }
    case 'chat-report': {
      if (!/^cr_[a-f0-9]{16}$/.test(String(body.id ?? ''))) return bad('id is the report\'s id');
      return { ok: true, action: { op, id: body.id } };
    }
    case 'chat-budget': {
      const n = Math.floor(Number(body.neurons));
      if (!(n >= 0 && n <= 1e7)) return bad('neurons is the review\'s day for the whole studio (0 to 10,000,000; Workers AI gives an account 10,000 a day free)');
      return { ok: true, action: { op, neurons: n } };
    }
    default:
      return bad('unknown control');
  }
}

/** Whether a chat change opens chat up (an office key only ASKS for these): more allowed, fewer checks, wider doors. */
export function chatOpensUp(before, f) {
  const rank = { off: 0, emoji: 1, lines: 2, text: 3 };
  const who = { members: 0, 'signed-in': 1, anyone: 2 };
  if (f.mode !== undefined && rank[f.mode] > rank[before.mode]) return true;
  for (const k of ['who', 'react']) if (f[k] !== undefined && who[f[k]] > who[before[k]]) return true;
  if (f.slow !== undefined && f.slow < before.slow) return true;
  if (f.max !== undefined && f.max > before.max) return true;
  // Keeping what people say for longer (history, 0.29.0) is the owner's to confirm; keeping it for less is not.
  if (f.history !== undefined && f.history > (before.history ?? 0)) return true;
  if (f.links === 'allow' && before.links !== 'allow') return true;
  if (f.swears === 'allow' && before.swears !== 'allow') return true;
  for (const k of ['watchers', 'hub']) if (f[k] === true && !before[k]) return true;
  if (f.ai === false && before.ai) return true;
  if (f.allow !== undefined && f.allow.some((w) => !(before.allow ?? []).includes(w))) return true;
  if (f.block !== undefined && (before.block ?? []).some((w) => !f.block.includes(w))) return true;
  if (f.lines !== undefined || f.emoji !== undefined) return true;
  return false;
}

/** The action in plain words, for the owner's confirm page and the AI's card. */
export function describe(cat, a) {
  if (String(a.op).startsWith('lounge-')) return describeLounge(cat, a);
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
      if (a.maxPlayers !== undefined) bits.push(a.maxPlayers === null ? `give ${gname}'s rooms the game's own number of seats` : `set ${gname}'s rooms to at most ${a.maxPlayers} players`);
      const s = bits.join('; ');
      return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
    }
    case 'server-create': return `Make a ${a.fields.policy} server "${a.fields.name}" for ${gname}.`;
    case 'server-set': {
      const f = a.fields;
      const bits = [];
      if (f.policy) bits.push(f.policy === 'humans-only' ? 'make it humans-only (its AI players leave after the current round, and no AI can join)' : `make it ${f.policy}`);
      if (f.door) bits.push(f.door === 'open' ? 'open its door to anyone' : f.door === 'accounts' ? 'let in only players with an account (a passkey)' : 'let in only players with an invite');
      if (f.rooms !== undefined) bits.push(`allow ${f.rooms} room${f.rooms === 1 ? '' : 's'} at most`);
      if (f.seats !== undefined) bits.push(f.seats === null ? 'give its rooms the game\'s own seats' : `give its rooms ${f.seats} seats`);
      if (f.beginnerDays !== undefined) bits.push(`count players as new for ${f.beginnerDays} days`);
      if (f.name) bits.push(`rename it "${f.name}"`);
      const rest = Object.keys(f).filter((k) => !['policy', 'door', 'rooms', 'seats', 'beginnerDays', 'name'].includes(k));
      if (rest.length) bits.push(`change its ${rest.join(', ')}`);
      return `On ${gname}'s server ${a.server}: ${bits.join('; ')}.`;
    }
    case 'server-close': return a.reopen ? `Open ${gname}'s server ${a.server} again.` : `Close ${gname}'s server ${a.server}: its rooms finish the current round, then everyone leaves with a thank-you, and nobody can join until it opens again.`;
    case 'member': return a.remove ? `Remove ${a.name ?? 'that player'} from ${gname}'s server ${a.server} (they can join again unless its door keeps them out).` : `Make ${a.name ?? 'that player'} a ${a.role} of ${gname}'s server ${a.server}.`;
    case 'pass': return a.action === 'revoke' ? `Revoke the agent pass ${a.id}: that AI leaves every room and cannot sit again.` : `Issue an agent pass for an AI called "${a.label} · AI".`;
    case 'room-level': return `Set the AI in ${where} to ${levelName(a.level)} (level ${a.level}).`;
    case 'shop-release': return `Release reservation ${a.order}: it stops counting toward the cap. We ask Stripe to expire an open Checkout Session. This does not refund a payment. A payment that still arrives grants the item, counts toward spending and can be refunded from the office.`;
    case 'refund': return describeRefund(cat, a, a.item ? { item: a.item, amount: a.amount, currency: a.currency } : null);
    case 'shop-settle': return `Mark what this studio owes ${a.via} for referrals in ${a.currency.toUpperCase()} as paid${a.ref ? ` (${a.ref})` : ''}: its owed lines are settled in the books.`;
    case 'agents-brain': return ['workers-ai', 'owner-key'].includes(a.mode)
      ? `Let the AI guides on ${gname}'s server ${a.server} talk: they speak only the lines the game's own agents.json gives them (never free text), at most one line every 8 seconds, never about a person, and a player can quiet them. Their brain runs on ${a.mode === 'workers-ai' ? `this studio's own Workers AI (free allowance${a.budget !== undefined ? `; at most ${Math.round(a.budget).toLocaleString('en-US')} neurons a day` : ''})` : `your own AI provider key (claude-haiku-4-5, your money${a.budget !== undefined ? `, at most $${Number(a.budget).toFixed(2)} a day` : ', capped daily'})`}.`
      : `Set the AI guides' brain on ${gname}'s server ${a.server} to ${a.mode}.`;
    case 'chat-rules': {
      const where = a.server ? `${gname}'s server ${a.server}` : gname;
      if (a.reset) return `Give ${where} its own chat rules back (the game's game.json, or Homie's defaults).`;
      const f = a.fields;
      const bits = [];
      if (f.mode) bits.push({ off: 'turn chat off', emoji: 'keep chat to emoji', lines: 'keep chat to emoji and quick lines', text: 'let players type' }[f.mode]);
      if (f.who) bits.push(`typing for ${f.who === 'anyone' ? 'anyone, guests too' : f.who === 'signed-in' ? 'signed-in players (a passkey)' : 'members only'}`);
      if (f.react) bits.push(`emoji and quick lines for ${f.react === 'anyone' ? 'anyone' : f.react === 'signed-in' ? 'signed-in players' : 'members only'}`);
      if (f.slow !== undefined) bits.push(f.slow ? `slow mode: one message every ${f.slow} s` : 'no slow mode');
      if (f.max !== undefined) bits.push(`messages up to ${f.max} characters`);
      if (f.links) bits.push(f.links === 'allow' ? 'allow links' : 'hold links');
      if (f.swears) bits.push(f.swears === 'allow' ? 'allow swearing' : 'hold swearing');
      if (f.ai !== undefined) bits.push(f.ai ? 'review typed messages with this studio\'s Workers AI' : 'stop the AI review (the word list still runs)');
      const rest = Object.keys(f).filter((k) => !['mode', 'who', 'react', 'slow', 'max', 'links', 'swears', 'ai'].includes(k));
      if (rest.length) bits.push(`change its ${rest.join(', ')}`);
      return `Room chat in ${where}: ${bits.join('; ')}.`;
    }
    case 'chat-remove': return a.all ? `Take every message down in ${where}.` : `Take ${a.ids.length === 1 ? 'a message' : `${a.ids.length} messages`} down in ${where}.`;
    case 'chat-report': return 'Dismiss a chat report (it is deleted).';
    case 'chat-budget': return `Let room chat's review use up to ${a.neurons.toLocaleString('en-US')} Workers AI neurons a day for the whole studio (about ${a.neurons.toLocaleString('en-US')} typed messages; the free allocation is 10,000 an account, shared with the AI guides; past it on Workers Paid, $0.011 per 1,000).`;
    default: return 'A control.';
  }
}

/** Whether an office key (the owner's AI) only ASKS for this (DESIGN D13): what takes something away, or consent. */
export async function needsAsk(env, cat, a) {
  if (String(a.op).startsWith('lounge-')) return loungeNeedsAsk(env, cat, a, chatOpensUp);
  if (DESTRUCTIVE.has(a.op)) return true;
  // Money: the owner's AI may only propose a refund or a settlement; the owner says yes.
  if (a.op === 'refund' || a.op === 'shop-settle' || a.op === 'shop-release') return true;
  if (a.op === 'server-close') return !a.reopen;
  if (a.op === 'member') return a.remove === true;
  if (a.op === 'server-set') {
    const meta = (cat.games ?? []).find((g) => g.id === a.game);
    const before = meta ? (await serversOf(env, meta, { fresh: true })).find((x) => x.id === a.server) : null;
    return narrows(before, a.fields);
  }
  // A bigger review budget can cost money on Workers Paid: the owner says yes. A smaller one happens at once.
  if (a.op === 'chat-budget') return a.neurons > (await chatDay(env, today())).budget.neurons;
  if (a.op === 'chat-rules') {
    if (a.reset) return true;
    const meta = (cat.games ?? []).find((g) => g.id === a.game);
    const servers = meta ? await serversOf(env, meta, { fresh: true }) : [];
    const before = chatOf(meta, servers.find((x) => x.id === (a.server || 'public')) ?? null, await chatRowsOf(env, { fresh: true }));
    return chatOpensUp(before, a.fields);
  }
  if (a.op === 'agents-brain') {
    if (['workers-ai', 'owner-key'].includes(a.mode) && !(await talkConsented(env))) return true;
    // Raising the cap on the owner's own money is the owner's to confirm; Workers AI's free allocation is not money.
    if (a.mode === 'owner-key' && a.budget !== undefined) return a.budget > (await brainDay(env)).budget.usd;
    return false;
  }
  return false;
}

/** The live rooms of one server of a game. */
async function serverRooms(env, game, server) {
  return (await liveRooms(env, game)).filter((r) => roomServer(r.room) === server);
}

/** A server's policy reaches every live room of it now (a signed `policy` control; section 17). */
async function pushPolicy(env, meta, settings, server) {
  const pol = policyOf(server, { seats: seatsFor(meta, settings), chat: chatOf(meta, server, await chatRowsOf(env, { fresh: true })) });
  const rooms = await serverRooms(env, meta.id, server.id);
  const res = await Promise.all(rooms.map((r) => roomControl(env, meta, settings, r.room, 'policy', { pol })));
  return { rooms: rooms.length, leaving: res.reduce((n, r) => n + (r.leaving ?? 0), 0) };
}

/** The authenticated owner who actually confirms the release. */
async function releaseIdentity(request, env) {
  const player = await players?.of?.(request, env);
  if (player?.owner) return `account ${player.id}`;
  const session = await ownerSession(request, env);
  // Legacy owner sessions have no account or label. Record a fingerprint, never the credential.
  return `owner session ${await sha256(session)}`;
}

/** Do it: the owner's own session did, or the owner confirmed what the AI asked. */
export async function perform(env, cat, a) {
  if (String(a.op).startsWith('lounge-')) return performLounge(env, cat, a, a.origin ?? '');
  const settings = await settingsOf(env, { fresh: true });
  const meta = (cat.games ?? []).find((g) => g.id === a.game) ?? null;
  switch (a.op) {
    case 'kick':
    case 'mute': {
      const line = a.line ? { line: a.line, purge: a.purge === true } : {};
      const r = await roomControl(env, meta, settings, a.room, a.op, a.op === 'kick'
        ? { id: a.id, seat: a.seat, minutes: a.minutes, address: a.address, ...line, ...(a.message ? { message: a.message } : {}) }
        : { id: a.id, seat: a.seat, minutes: a.minutes, off: a.off, ...line });
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
        max: a.maxPlayers === undefined ? (row.max_players ?? null) : a.maxPlayers,
      };
      // The table's `remix` column is not named: a new row leaves it NULL and an old row keeps what it had (above).
      await env.DB.prepare(`INSERT INTO office_games (game, launch, max_players, updated_at) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(game) DO UPDATE SET launch = excluded.launch, max_players = excluded.max_players, updated_at = excluded.updated_at`)
        .bind(meta.id, next.launch, next.max, Date.now()).run();
      forgetSettings(env);
      const fresh = await settingsOf(env, { fresh: true });
      const launch = launchOf(meta, fresh, env);
      const done = { ok: true, op: 'game', game: meta.id, launch, maxPlayers: seatsFor(meta, fresh), regating: 0 };
      const rooms = await liveRooms(env, meta.id);
      // Who may play changed: every live room finishes its current round, with a notice, and then whoever the new
      // state leaves out is sent out of it (the owner, and in an invite-only beta the invited, play on). Back to a
      // wider state, a change still waiting is called off.
      if (launch !== prev) {
        const res = await Promise.all(rooms.map((r) => roomControl(env, meta, fresh, r.room, 'regate', regateArgs(launch, meta.name))));
        done.regating = res.filter((r) => r.ok && r.leaving > 0).length;
      }
      if (a.maxPlayers !== undefined) {
        await Promise.all(rooms.map((r) => roomControl(env, meta, fresh, r.room, 'seats', { max: done.maxPlayers })));
      }
      return done;
    }
    case 'server-create': {
      if (!env?.DB) return { ok: false, error: 'no-db', message: 'This studio has no D1 for servers.' };
      const list = await serversOf(env, meta, { fresh: true });
      if (list.some((x) => x.id === a.fields.id)) return { ok: false, error: 'exists', message: `${meta.name} already has a server called ${a.fields.id}; change it with server_set.` };
      if (list.length >= SERVER_LIMITS.perGame) return { ok: false, error: 'limit', message: `A game has at most ${SERVER_LIMITS.perGame} servers.` };
      const sv = rowFor(meta.id, null, a.fields);
      try { await writeServer(env, meta.id, sv); } catch (error) { return { ok: false, error: 'not-migrated', message: `Servers need migration 0006_studio_servers.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }; }
      const view = serverView(sv, { origin: a.origin ?? '', game: meta.id });
      const notes = [];
      if (sv.policy === 'beginner' && sv.guides) notes.push(`${sv.guides} AI guide seat${sv.guides === 1 ? '' : 's'} in every room, marked AI: they play from the game's script, silent. To let them talk (only the game's own agents.json lines), turn on a brain: agents brain ${meta.id} ${sv.id} workers-ai (the first time asks the owner).${meta.vocab ? '' : ` ${meta.name} has no agents.json yet: write one first.`}`);
      if (sv.policy === 'hybrid') notes.push(`${sv.aiSeats} seat${sv.aiSeats === 1 ? '' : 's'} in every room are AI companions, marked AI; the party votes their level.`);
      if (sv.policy === 'humans-only') notes.push('No AI can join; the game\'s practice bots are off unless the owner turns them on (bots: fill).');
      if (!(Number(meta.netplayRev) >= 6)) notes.push(`${meta.name}'s build predates servers (netplay revision ${meta.netplayRev ?? '5 or older'}): reserved AI seats stay empty and its bots do not read the dial until it is rebuilt with @homie-rocks/studio 0.16.`);
      return { ok: true, op: a.op, game: meta.id, server: view, notes };
    }
    case 'server-set': {
      const before = (await serversOf(env, meta, { fresh: true })).find((x) => x.id === a.server);
      if (!before) return { ok: false, error: 'no-server', message: `${meta.name} has no server called ${a.server}.` };
      const sv = rowFor(meta.id, before, a.fields);
      try { await writeServer(env, meta.id, sv); } catch (error) { return { ok: false, error: 'not-migrated', message: `Servers need migration 0006_studio_servers.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }; }
      const pushed = await pushPolicy(env, meta, settings, sv);
      return { ok: true, op: a.op, game: meta.id, server: serverView(sv, { game: meta.id }), rooms: pushed.rooms, aiLeaving: pushed.leaving };
    }
    case 'server-close': {
      const before = (await serversOf(env, meta, { fresh: true })).find((x) => x.id === a.server) ?? (a.server === 'public' ? PUBLIC_SERVER : null);
      if (!before) return { ok: false, error: 'no-server', message: `${meta.name} has no server called ${a.server}.` };
      const sv = rowFor(meta.id, before, { state: a.reopen ? 'open' : 'closed' });
      try { await writeServer(env, meta.id, sv); } catch (error) { return { ok: false, error: 'not-migrated', message: `Servers need migration 0006_studio_servers.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }; }
      const rooms = await serverRooms(env, meta.id, sv.id);
      // Its rooms finish the round they are in, then everyone but the owner leaves (the launch-change road).
      const res = a.reopen
        ? await Promise.all(rooms.map((r) => roomControl(env, meta, settings, r.room, 'regate', {})))
        : await Promise.all(rooms.map((r) => roomControl(env, meta, settings, r.room, 'regate', { allow: ['o'], notice: `${sv.name} closes after this round. Thanks for playing!`, message: `${sv.name} is closed now. Thanks for playing!` })));
      return { ok: true, op: a.op, game: meta.id, server: sv.id, state: sv.state, rooms: res.filter((r) => r.ok).length };
    }
    case 'member': {
      try {
        if (a.remove) await env.DB.prepare('DELETE FROM server_members WHERE game = ?1 AND server = ?2 AND player = ?3').bind(meta.id, a.server, a.player).run();
        else {
          const now = Date.now();
          await env.DB.prepare(`INSERT INTO server_members (game, server, player, role, home, joined_at, seen_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)
            ON CONFLICT(game, server, player) DO UPDATE SET role = excluded.role`).bind(meta.id, a.server, a.player, a.role, now).run();
        }
      } catch (error) { return { ok: false, error: 'not-migrated', message: `Servers need migration 0006_studio_servers.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }; }
      return { ok: true, op: a.op, game: meta.id, server: a.server, player: a.player, ...(a.remove ? { removed: true } : { role: a.role }) };
    }
    case 'pass': {
      try {
        if (a.action === 'list') return { ok: true, op: a.op, passes: await passList(env, { game: a.game }) };
        if (a.action === 'revoke') {
          const r = await passRevoke(env, a.id);
          if (!r.ok) return r;
          // The AI leaves every room it sits in now, and is held out of them.
          let left = 0;
          for (const g of a.game ? [meta] : (cat.games ?? [])) {
            for (const room of await liveRooms(env, g.id)) {
              const f = await roomFacts(env, g.id, room.room, seatsFor(g, settings));
              for (const c of (f?.clients ?? []).filter((x) => x.agent?.pass === a.id)) {
                const k = await roomControl(env, g, settings, room.room, 'kick', { id: c.id, minutes: 24 * 60, message: 'This AI\'s pass was revoked.' });
                if (k.ok) left += 1;
              }
            }
          }
          return { ok: true, op: a.op, revoked: a.id, left };
        }
        const r = await passCreate(env, { label: a.label, kind: a.kind, role: a.role, hands: a.hands, game: a.game, server: a.server, days: a.days });
        if (!r.ok) return r;
        return {
          ok: true, op: a.op, pass: r.pass, secret: r.secret,
          use: `This is the only time the pass is shown. The AI sits with POST ${a.origin ?? ''}/${a.game ?? '<game>'}/api/agent and the header "Authorization: Bearer <pass>"; it plays as "${aiName(a.label)}", marked AI, never on a humans-only server. Revoke it any time.`,
        };
      } catch (error) { return { ok: false, error: 'not-migrated', message: `Agent passes need migration 0006_studio_servers.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }; }
    }
    case 'room-level': return roomControl(env, meta, settings, a.room, 'level', { level: a.level });
    case 'chat-rules': {
      if (!env?.DB) return { ok: false, error: 'no-db', message: 'This studio has no D1 for its office.' };
      try {
        if (a.reset) await clearChatRules(env, meta.id, a.server);
        else await writeChatRules(env, meta.id, a.server, a.fields);
      } catch (error) { return { ok: false, error: 'not-migrated', message: `Chat rules need migration 0007_studio_chat.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }; }
      // Every live room the change reaches hears its new rules now (a signed policy control, as a server change does).
      const servers = await serversOf(env, meta, { fresh: true });
      const reach = a.server ? servers.filter((x) => x.id === a.server) : servers;
      let rooms = 0;
      for (const sv of reach) rooms += (await pushPolicy(env, meta, settings, sv)).rooms;
      const rows = await chatRowsOf(env, { fresh: true });
      const rules = publicChat(chatOf(meta, servers.find((x) => x.id === (a.server || 'public')) ?? PUBLIC_SERVER, rows));
      return { ok: true, op: a.op, game: meta.id, server: a.server || null, rules, rooms };
    }
    case 'chat-remove': {
      const r = await roomControl(env, meta, settings, a.room, 'unsay', a.all ? { all: true } : { ids: a.ids });
      return r;
    }
    case 'chat-report': {
      try { return { op: a.op, ...(await dismissReport(env, a.id)) }; } catch (error) { return { ok: false, error: 'not-migrated', message: String(error?.message ?? error).slice(0, 120) }; }
    }
    case 'chat-budget': {
      try { await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('chat_budget', ?1)").bind(JSON.stringify({ neurons: a.neurons })).run(); } catch (error) { return { ok: false, error: 'no-db', message: String(error?.message ?? error).slice(0, 120) }; }
      return { ok: true, op: a.op, budget: { neurons: a.neurons }, note: `Room chat's review may use ${a.neurons.toLocaleString('en-US')} neurons a day from now on (rooms read it again within a minute).` };
    }
    case 'agents-brain': {
      const before = (await serversOf(env, meta, { fresh: true })).find((x) => x.id === a.server);
      if (!before) return { ok: false, error: 'no-server', message: `${meta.name} has no server called ${a.server}.` };
      if (before.policy === 'humans-only') return { ok: false, error: 'humans-only', message: 'A humans-only server has no AI to talk.' };
      const sv = rowFor(meta.id, before, { brain: a.mode });
      try {
        await writeServer(env, meta.id, sv);
        if (['workers-ai', 'owner-key'].includes(a.mode)) await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('agents_talk_ok', ?1)").bind(String(Date.now())).run();
      } catch (error) { return { ok: false, error: 'not-migrated', message: `Servers need migration 0006_studio_servers.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }; }
      if (a.budget !== undefined) {
        const day = await brainDay(env);
        const next = { neurons: day.budget.neurons, usd: day.budget.usd, ...(a.mode === 'workers-ai' ? { neurons: Math.round(a.budget) } : { usd: Math.round(a.budget * 100) / 100 }) };
        await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('brain_budget', ?1)").bind(JSON.stringify(next)).run().catch(() => {});
      }
      await pushPolicy(env, meta, settings, sv);
      const day = await brainDay(env);
      const notes = [];
      if (!meta.vocab && ['workers-ai', 'owner-key'].includes(a.mode)) notes.push(`${meta.name} has no agents.json yet: its guides play but have no words. Write one (the game skill's "Write the guide vocabulary"), build and deploy.`);
      if (a.mode === 'workers-ai') notes.push(!env.AI ? 'This Worker has no Workers AI binding yet: run `npm run deploy` once more (it binds Workers AI when a server uses it). Until then the guides answer from the game\'s script.'
        : !(day.budget.neurons > 0) ? 'The day\'s Workers AI budget is 0: the guides answer from the game\'s script (set --budget to let them think).'
          : `The guides think with Workers AI (${day.model}) from their next decision: at most ${day.budget.neurons.toLocaleString('en-US')} neurons a day for the whole studio (${Math.round(day.used.neurons).toLocaleString('en-US')} used today), then the game's script until 00:00 UTC.`);
      if (a.mode === 'owner-key') notes.push(!env.HOMIE_BRAIN_KEY ? 'Set your key on your own computer: `npx --no-install homie-studio agents brain key` opens a page there (the key goes straight to the Worker, never through a chat). Until then the guides answer from the game\'s script.'
        : !(day.budget.usd > 0) ? 'The day\'s dollar cap is 0: the guides answer from the game\'s script.'
          : `The guides think with your key (claude-haiku-4-5) from their next decision, at most $${day.budget.usd.toFixed(2)} a day ($${day.used.usd.toFixed(2)} used today), then the game's script until 00:00 UTC.`);
      if (a.mode === 'script') notes.push('The guides play from the game\'s script, silent.');
      if (a.mode === 'off') notes.push('The guides are the game\'s plain bots.');
      return { ok: true, op: a.op, game: meta.id, server: sv.id, brain: sv.brain, budget: day.budget, note: `Saved. ${notes.join(' ')}`.trim() };
    }
    case 'shop-release': return performRelease(env, a, cat);
    case 'refund': return performRefund(env, cat, a);
    case 'shop-settle': return settleReferrer(env, a);
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
  // An invite to one server's door (0.16.0): the server must be this game's.
  const server = typeof body.server === 'string' && body.server ? body.server : null;
  if (server && !(await serversOf(env, meta, { fresh: true })).some((x) => x.id === server && x.id !== 'public')) return json({ ok: false, error: 'bad-request', message: `${meta.name} has no server called ${server}` }, 400);
  const made = [];
  for (let i = 0; i < count; i += 1) {
    const raw = new Uint8Array(8);
    crypto.getRandomValues(raw);
    const code = [...raw].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    const row = { id: randomHex(5), code, label, uses: 0, max_uses: uses, expires_at: days ? Date.now() + days * 86400_000 : null, revoked: 0, created_at: Date.now(), server };
    if (server) {
      await env.DB.prepare('INSERT INTO office_invites (id, game, code, label, uses, max_uses, expires_at, revoked, created_at, server) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, 0, ?7, ?8)')
        .bind(row.id, meta.id, row.code, row.label, row.max_uses, row.expires_at, row.created_at, server).run();
    } else {
      await env.DB.prepare('INSERT INTO office_invites (id, game, code, label, uses, max_uses, expires_at, revoked, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, 0, ?7)')
        .bind(row.id, meta.id, row.code, row.label, row.max_uses, row.expires_at, row.created_at).run();
    }
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
      return json({ ok: false, error: 'no-office', message: `The office is not in this studio's D1 yet: \`npm run deploy\` applies migration 0005_studio_office.sql. (${String(error?.message ?? error).slice(0, 120)})` }, 503);
    }
  }
  if (path === '/_studio/api/invites' || path === '/_studio/api/invites/revoke') {
    if (path.endsWith('/revoke') && request.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
    try { return await invitesApi(request, env, url, cat, body, who); } catch (error) {
      return json({ ok: false, error: 'no-office', message: `Invites need migration 0005_studio_office.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }, 503);
    }
  }
  const askPath = /^\/_studio\/api\/asks\/(ask_[a-f0-9]{16})$/.exec(path);
  if (askPath && request.method === 'GET') {
    const row = await readAsk(env, askPath[1]);
    return row ? json({ ok: true, ask: askView(row, cat, url.origin) }) : json({ ok: false, error: 'no-ask', message: 'No such ask: they last 15 minutes.' }, 404);
  }
  // Servers and agent seats (0.16.0): the list, and each server's members.
  if (path === '/_studio/api/servers' && request.method === 'GET') {
    const metas = (cat.games ?? []).filter((g) => !url.searchParams.get('game') || g.id === url.searchParams.get('game'));
    const view = await officeView(env, { ...cat, games: metas }, url.origin);
    return json({ ok: true, games: view.games.map((g) => ({ id: g.id, name: g.name, build: g.build, servers: g.servers, passes: g.passes })), fillSpot: view.fillSpot, agentsTalk: view.agentsTalk });
  }
  if (path === '/_studio/api/servers/members' && request.method === 'GET') {
    const game = url.searchParams.get('game');
    const server = url.searchParams.get('server');
    try {
      const { results } = await env.DB.prepare('SELECT player, role, home, joined_at, seen_at FROM server_members WHERE game = ?1 AND server = ?2 ORDER BY seen_at DESC LIMIT 200').bind(game, server).all();
      const members = await Promise.all((results ?? []).map(async (r) => ({ player: r.player, account: await playerOf(env, r.player), role: r.role, home: Number(r.home) === 1, joinedAt: Number(r.joined_at), seenAt: Number(r.seen_at) })));
      return json({ ok: true, game, server, members });
    } catch (error) { return json({ ok: false, error: 'not-migrated', message: `Servers need migration 0006_studio_servers.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }, 503); }
  }
  // A guide's brain on a moment the owner gives (0.24.4): what it would decide, why, how sure, how long and what it cost.
  if (path === '/_studio/api/agents/try' && request.method === 'POST') return json(await agentsTry(env, cat, body));
  // Room chat (0.23.0): every game's rules, every live room's last minutes, the reports, the review's day.
  if (path === '/_studio/api/chat' && request.method === 'GET') {
    const metas = (cat.games ?? []).filter((g) => !url.searchParams.get('game') || g.id === url.searchParams.get('game'));
    const view = await officeView(env, { ...cat, games: metas }, url.origin);
    return json({ ok: true, day: view.chat, games: view.games.map((g) => ({ id: g.id, name: g.name, chat: g.chat, rooms: g.rooms.map((r) => ({ room: r.room, label: r.label, players: r.players, chat: r.chat })) })) });
  }
  // The Lounge (0.29.0): its rules, play nights, moderators, last lines and reports.
  if (path === '/_studio/api/lounge' && request.method === 'GET') {
    const lounge = await loungeOffice(env, cat, url.origin);
    return lounge ? json({ ok: true, lounge }) : json({ ok: false, error: 'no-lounge', message: 'This studio has no Lounge: add "lounge": true to studio.json and deploy.' }, 404);
  }
  // The shop (0.24.0): the owner's view, the accountant's CSV, the referral statements.
  if (path === '/_studio/api/shop' && request.method === 'GET') return json(await shopOffice(env, cat, url.origin, url.searchParams.get('cursor') ?? '', /^\d+$/.test(url.searchParams.get('itemCursor') ?? '') ? Number(url.searchParams.get('itemCursor')) : 0, /^\d+$/.test(url.searchParams.get('orderCursor') ?? '') ? Math.min(Number(url.searchParams.get('orderCursor')), Number.MAX_SAFE_INTEGER) : 0));
  if (path === '/_studio/api/shop/orders.csv' && request.method === 'GET') {
    try {
      return new Response(await ordersCsv(env), { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store, private', 'content-disposition': `attachment; filename="orders-${today()}.csv"` } });
    } catch { return json({ ok: false, error: 'not-migrated', message: 'The shop needs migration 0008_studio_shop.sql (npm run deploy).' }, 503); }
  }
  if (path === '/_studio/api/shop/lines' && request.method === 'GET') return json({ ok: true, ...(await linesOf(env, { via: url.searchParams.get('via'), currency: url.searchParams.get('currency'), cursor: url.searchParams.get('cursor') ?? '' })) });
  if (path === '/_studio/api/shop/received' && request.method === 'GET') return json(await receivedPages(env, url.searchParams.get('seller') ?? '', url.searchParams.get('period') ?? '', url.searchParams.get('cursor') ?? ''));
  if (path === '/_studio/api/shop/statements' && request.method === 'GET') return json(await statementsOut(env, cat, url.origin, url.searchParams.get('period'), url.searchParams.get('cursor') ?? ''));
  if (path === '/_studio/api/shop/statements/send' && request.method === 'POST') return json(await statementsSend(env, cat, url.origin, body.period, body.cursor ?? ''));
  const OPS = {
    '/_studio/api/chat/rules': 'chat-rules', '/_studio/api/chat/remove': 'chat-remove', '/_studio/api/chat/report': 'chat-report', '/_studio/api/chat/budget': 'chat-budget',
    '/_studio/api/kick': 'kick', '/_studio/api/mute': 'mute', '/_studio/api/close': 'close', '/_studio/api/announce': 'announce', '/_studio/api/game': 'game',
    '/_studio/api/servers': 'server-create', '/_studio/api/servers/set': 'server-set', '/_studio/api/servers/close': 'server-close', '/_studio/api/servers/member': 'member',
    '/_studio/api/agents/pass': 'pass', '/_studio/api/room-level': 'room-level', '/_studio/api/agents/brain': 'agents-brain',
    '/_studio/api/shop/release': 'shop-release', '/_studio/api/shop/refund': 'refund', '/_studio/api/shop/settle': 'shop-settle',
    '/_studio/api/lounge/rules': 'lounge-rules', '/_studio/api/lounge/night': 'lounge-night', '/_studio/api/lounge/mod': 'lounge-mod',
    '/_studio/api/lounge/remove': 'lounge-remove', '/_studio/api/lounge/hold': 'lounge-hold',
  };
  const op = OPS[path];
  if (!op || request.method !== 'POST') return json({ ok: false, error: 'not-found' }, 404);
  const checked = checkAction(cat, op, body);
  if (!checked.ok) return json(checked, 400);
  const action = checked.action;
  if (op === 'shop-release' && who === 'session') action.by = await releaseIdentity(request, env);
  if (op === 'server-create' || op === 'pass' || op === 'lounge-night') action.origin = url.origin;
  if (op === 'refund') {
    // The ask and the confirm page say what the order is (its item and price), read from the books now.
    const o = await orderById(env, action.order);
    if (!o) return json({ ok: false, error: 'order', message: 'No such order (homie-studio shop orders lists them).' }, 404);
    Object.assign(action, { item: o.item, amount: Number(o.amount), currency: o.currency });
  }
  // An office key (the owner's AI) only ASKS for what takes something away; the owner confirms with one tap.
  if (who === 'office' && await needsAsk(env, cat, action)) {
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
      return json({ ok: false, error: 'no-office', message: `Asks need migration 0005_studio_office.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }, 503);
    }
  }
  const result = await perform(env, cat, action);
  // A refund Stripe holds for a person's approval (an Agent-tagged key) is accepted, not refused: it happens there.
  return json({ ...result, what: describe(cat, action), by: who }, result.ok ? 200 : result.held ? 202 : result.error === 'no-player' ? 404 : 400);
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
  if (path === '/_studio/office/shop' || path === '/_studio/office/shop/') {
    const cat = await catalogueOf();
    if (request.method !== 'GET') return new Response('method', { status: 405 });
    if (!(await isOwner(request, env))) return lockedPage(cat, { what: 'office' });
    return officeShopPage(cat);
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
    if (ask.action.op === 'shop-release') ask.action.by = await releaseIdentity(request, env);
    const result = await perform(env, cat, ask.action);
    await env.DB.prepare('UPDATE office_asks SET state = ?2, result = ?3 WHERE id = ?1').bind(ask.id, result.ok ? 'done' : 'failed', JSON.stringify(result).slice(0, 4000)).run();
    return confirmPage(cat, { ...ask, state: result.ok ? 'done' : 'failed', result });
  }
  return null;
}
