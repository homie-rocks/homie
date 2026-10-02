/**
 * AGENT SEATS (@homie-rocks/studio 0.16.0, NETPLAY.md section 17): an AI that sits in a room's seat the way a phone
 * does, always marked AI, and the skill dial every game's bots can read.
 *
 *   SKILLS / skillPreset   the dial: five levels, one shape everywhere ({ level, name, reactionMs, aimNoise,
 *                          aggression, positioning }); netplay/netplay.ts has the same table (a test keeps them equal)
 *   AI_MARK / aiName       every agent's name ends in exactly " · AI"; a person's name never ends in an AI or bot mark
 *   passes                 an agent pass is one AI's way into a seat: `hap_<id>_<secret>`, shown once; D1 keeps only
 *                          the SHA-256 of the whole pass (agent_passes). A ticket names it as the holder `a-<id>`.
 *   sitRoute               POST /<game>/api/agent with `Authorization: Bearer hap_…`: a room with people in it, a
 *                          ticket, the socket and (hands `self`) the game's frame to load
 *   fillSpot               the fill-a-spot hook: nothing issues service passes yet (a money decision), so it is null
 *
 * Nothing here imports the rest of the Worker, so the relay (room.mjs) can use the dial and the names as they are.
 */

/** The skill dial (DESIGN D8; NETPLAY.md section 17). Level 3, Fair, is what the port kit's bots always were. */
export const SKILLS = Object.freeze([
  Object.freeze({ level: 1, name: 'Rookie', reactionMs: 650, aimNoise: 0.55, aggression: 0.1, positioning: 0.1, card: 'stays at the back, misses a lot' }),
  Object.freeze({ level: 2, name: 'Steady', reactionMs: 420, aimNoise: 0.3, aggression: 0.3, positioning: 0.35, card: 'helps, never steals the show' }),
  Object.freeze({ level: 3, name: 'Fair', reactionMs: 250, aimNoise: 0.15, aggression: 0.5, positioning: 0.5, card: 'plays like a regular' }),
  Object.freeze({ level: 4, name: 'Strong', reactionMs: 170, aimNoise: 0.07, aggression: 0.7, positioning: 0.75, card: 'keeps up with good players' }),
  Object.freeze({ level: 5, name: 'Maxed', reactionMs: 110, aimNoise: 0.02, aggression: 0.9, positioning: 0.95, card: 'front-line tank, rarely misses' }),
]);
/** Kids servers: the dial's ceiling and the most aggression any AI may show. */
export const KIDS = Object.freeze({ levelMax: 3, aggression: 0.3 });

/** A level as its preset (a copy): 1..5, Fair when it is not a number; a kids room caps it at 3 and aggression at 0.3. */
export function skillPreset(n, { kids = false } = {}) {
  const top = kids ? KIDS.levelMax : 5;
  const level = Math.max(1, Math.min(top, Math.round(Number(n)) || 3));
  const s = { ...SKILLS[level - 1] };
  if (kids) s.aggression = Math.min(s.aggression, KIDS.aggression);
  return s;
}

/* ------------------------------------------------------------------ names */

/** The exact mark every agent's name ends with (DESIGN D7): it survives an old game that only draws `name`. */
export const AI_MARK = ' · AI';
/**
 * An AI or bot mark at the end of a name, as its own word after a space or a separator: "Ada · AI", "Bo (AI)",
 * "Cy [bot]", "Di - A.I.". A name that is only "Ai" (a person's name) is not one.
 */
const AI_TAIL = /[\s·•∙⋅・|:_\-–—(\[{]+(?:a\.?\s?i\.?|bots?)[\s)\]}.!·•∙⋅・|:_\-–—]*$/iu;
const oneLine = (v, max) => String(v ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Whether a name ends in an AI or bot mark. */
export const isAiName = (name) => AI_TAIL.test(String(name ?? '').trim());

/** A name with every AI or bot mark taken off its end: what a person's typed name becomes (they cannot claim one). */
export function stripAi(name) {
  let s = oneLine(name, 64);
  for (let i = 0; i < 6 && AI_TAIL.test(s); i += 1) s = s.replace(AI_TAIL, '').trim();
  return s.replace(/[\s·•∙⋅・|:_\-–—(\[{]+$/u, '').trim();
}

/** An agent's name as every room shows it: its label (at most 16 characters, no mark of its own) and " · AI". */
export function aiName(label) {
  const base = [...stripAi(label)].slice(0, 16).join('').trim();
  return `${base || 'Agent'}${AI_MARK}`;
}

/* ------------------------------------------------------------------ the wire's facts (Worker → Table) */

/** JSON as base64url (no padding), for the Worker's own `pol` and `ag` values on the Table's address. */
export function encodeFacts(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** The reverse, or null for anything that is not one (at most 4 KB). */
export function decodeFacts(text) {
  const t = String(text ?? '');
  if (!t || t.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(t)) return null;
  try {
    const s = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

/* ------------------------------------------------------------------ passes */

export const PASS_KINDS = Object.freeze(['owner', 'guest', 'service']);
export const PASS_ROLES = Object.freeze(['party', 'guide', 'player']);
export const PASS_HANDS = Object.freeze(['self', 'host']);
export const PASS_ID = /^[a-f0-9]{10}$/;
const PASS_TOKEN = /^hap_([a-f0-9]{10})_([A-Za-z0-9_-]{40})$/;
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SERVER_ID = /^[a-z0-9][a-z0-9-]{1,19}$/;
const DAY = 86_400_000;
/** An agent's ticket lasts as long as a player's (12 hours); a pass lasts what the owner said, or until revoked. */
export const AGENT_TICKET_MS = 12 * 3600_000;

function randomText(bytes) {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  let s = '';
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomHex(bytes) {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A pass as the office, the CLI and the MCP see it: never its secret. */
export function passView(r, now = Date.now()) {
  if (!r) return null;
  const expiresAt = r.expires_at === null || r.expires_at === undefined ? null : Number(r.expires_at);
  const revoked = Number(r.revoked) === 1;
  return {
    id: r.id, label: r.label, name: aiName(r.label), kind: r.kind, role: r.role, hands: r.hands,
    game: r.game ?? null, server: r.server ?? null, issuer: r.issuer ?? 'owner', expiresAt, revoked, createdAt: Number(r.created_at),
    live: !revoked && (expiresAt === null || expiresAt > now),
  };
}

/**
 * A new pass (the owner's office): `{ ok, pass, secret }`, the secret shown this once. A label is what the relay
 * shows ("Claude" plays as "Claude · AI"). A fill-a-spot service has no issuer yet (DESIGN section 12: money).
 */
export async function passCreate(env, { label, kind = 'owner', role = 'party', hands = 'self', game = null, server = null, days = null, issuer = 'owner' } = {}) {
  if (!env?.DB) return { ok: false, error: 'no-db', message: 'This studio has no D1 for agent passes.' };
  const name = [...stripAi(label)].slice(0, 16).join('').trim();
  if (!name || !/[\p{L}\p{N}]/u.test(name)) return { ok: false, error: 'label', message: 'label is the name the AI plays under (1 to 16 letters or digits; " · AI" is added)' };
  if (kind === 'service') return { ok: false, error: 'service', message: 'Passes for a fill-a-spot service come later; nothing issues them yet.' };
  if (!PASS_KINDS.includes(kind)) return { ok: false, error: 'kind', message: 'kind is owner or guest' };
  if (!PASS_ROLES.includes(role)) return { ok: false, error: 'role', message: 'role is party, guide or player' };
  if (!PASS_HANDS.includes(hands)) return { ok: false, error: 'hands', message: 'hands is self (the AI runs the game itself) or host (the host\'s bot code moves it)' };
  if (game !== null && !GAME_ID.test(String(game))) return { ok: false, error: 'game', message: 'game is one of this studio\'s game ids, or leave it out for any' };
  if (server !== null && !SERVER_ID.test(String(server))) return { ok: false, error: 'server', message: 'server is a server id, or leave it out for any that lets AI in' };
  const id = randomHex(5);
  const secret = `hap_${id}_${randomText(30)}`;
  const now = Date.now();
  const d = days === null || days === undefined ? null : Math.max(1, Math.min(365, Math.floor(Number(days)) || 7));
  const row = { id, label: name, kind, role, hands, game, server, issuer: String(issuer ?? 'owner').slice(0, 40), expires_at: d ? now + d * DAY : null, revoked: 0, created_at: now };
  await env.DB.prepare('INSERT INTO agent_passes (id, hash, label, kind, role, hands, game, server, issuer, expires_at, revoked, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11)')
    .bind(id, await sha256(secret), name, kind, role, hands, game, server, row.issuer, row.expires_at, now).run();
  return { ok: true, pass: passView(row, now), secret };
}

/** The pass a `hap_…` secret is, when it is this studio's and still good; else null. */
export async function passOf(env, token) {
  const m = PASS_TOKEN.exec(String(token ?? '').trim());
  if (!m || !env?.DB) return null;
  let r = null;
  try { r = await env.DB.prepare('SELECT * FROM agent_passes WHERE hash = ?1').bind(await sha256(m[0])).first(); } catch { return null; }
  if (!r || r.id !== m[1]) return null;
  const v = passView(r);
  return v.live ? v : null;
}

/** A pass by its id (a ticket's `a-<id>`), live or not: null when there is none. */
export async function passById(env, id) {
  if (!PASS_ID.test(String(id ?? '')) || !env?.DB) return null;
  try { return passView(await env.DB.prepare('SELECT * FROM agent_passes WHERE id = ?1').bind(id).first()); } catch { return null; }
}

export async function passRevoke(env, id) {
  if (!PASS_ID.test(String(id ?? ''))) return { ok: false, error: 'id', message: 'id is the pass\'s id (10 letters and digits)' };
  const r = await env.DB.prepare('UPDATE agent_passes SET revoked = 1 WHERE id = ?1 RETURNING id').bind(id).first();
  return r ? { ok: true, revoked: id } : { ok: false, error: 'no-pass', message: 'No such pass.' };
}

/** Every pass (newest first), for one game or all: { id, label, name, kind, role, hands, game, server, live, … }. */
export async function passList(env, { game = null } = {}) {
  try {
    const { results } = game
      ? await env.DB.prepare('SELECT * FROM agent_passes WHERE game = ?1 OR game IS NULL ORDER BY created_at DESC LIMIT 200').bind(game).all()
      : await env.DB.prepare('SELECT * FROM agent_passes ORDER BY created_at DESC LIMIT 200').all();
    return (results ?? []).map((r) => passView(r));
  } catch { return []; }
}

/** What a room is told about an agent (`peer.agent`): its pass, role, hands, and who it is for. */
export const agentFacts = (pass) => ({ pass: pass.id, role: pass.role, hands: pass.hands, by: pass.kind === 'owner' ? 'studio' : pass.kind });

/**
 * Why this pass may not sit here, or null when it may: the server's policy (humans-only lets no AI in), the pass's
 * own game and server, and a game that is not public (only the owner's own passes open it).
 */
export function passRefusal(pass, { game, server, policy, launch = 'public' }) {
  if (!pass || !pass.live) return { status: 403, error: 'agent-pass', message: 'That agent pass is revoked, ended, or not this studio\'s.' };
  if (pass.game && pass.game !== game) return { status: 403, error: 'agent-scope', message: `This pass is for ${pass.game}, not ${game}.` };
  if (pass.server && pass.server !== server) return { status: 403, error: 'agent-scope', message: `This pass is for the server ${pass.server}.` };
  if (policy?.kind === 'humans-only') return { status: 403, error: 'agents-off', message: 'This server is for humans only' };
  if (launch !== 'public' && pass.kind !== 'owner') return { status: 403, error: 'not-open', message: 'This game is not open to you.' };
  return null;
}

/**
 * POST /<game>/api/agent (Bearer pass): a seat for an AI. Strangers are never started a room by an AI (DESIGN D9):
 * the Lobby offers only a room of the server's pool that has people in it. Hands `self`: load `frame` (the game,
 * which plays as the AI); hands `host`: open `ws` and say hello with `agent: { hands: 'host' }` (the host's bot code
 * moves the body; NETPLAY.md section 17).
 *
 * `deps`: { meta, launch, serverOf(id) -> server | null, policyOf(server) -> Policy, join(server, policy) -> room | null,
 *           ticketFor(sub) -> ticket }
 */
export async function sitRoute(request, env, url, deps) {
  const json = (body, status = 200) => new Response(`${JSON.stringify(body)}\n`, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private' } });
  if (request.method !== 'POST') return json({ ok: false, error: 'method', message: 'POST, with Authorization: Bearer <agent pass>' }, 405);
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  const pass = await passOf(env, bearer);
  if (!pass) return json({ ok: false, error: 'agent-pass', message: 'An AI sits with an agent pass from the studio\'s owner (homie-studio agents pass).' }, 401);
  let body = {};
  try { const t = await request.text(); body = t ? JSON.parse(t) : {}; } catch { return json({ ok: false, error: 'json' }, 400); }
  const wanted = typeof body?.server === 'string' && SERVER_ID.test(body.server) ? body.server : pass.server ?? 'public';
  const server = deps.serverOf(wanted);
  if (!server || server.state !== 'open') return json({ ok: false, error: 'no-server', message: `No open server called ${wanted} here.` }, 404);
  const policy = deps.policyOf(server);
  const why = passRefusal(pass, { game: deps.meta.id, server: server.id, policy, launch: deps.launch });
  if (why) return json({ ok: false, ...why }, why.status);
  const room = await deps.join(server, policy);
  if (!room) return json({ ok: false, error: 'no-room', message: 'Nobody is playing on this server right now: an AI never starts a room. Try again when people are here.' }, 409);
  const ticket = await deps.ticketFor(`a-${pass.id}`);
  if (!ticket) return json({ ok: false, error: 'no-ticket', message: 'This studio cannot mint tickets yet (its D1).' }, 503);
  const ws = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}/${deps.meta.id}/__net?room=${encodeURIComponent(room)}&t=${encodeURIComponent(ticket)}`;
  return json({
    ok: true, game: deps.meta.id, server: server.id, room, ticket, name: aiName(pass.label), role: pass.role, hands: pass.hands, policy: { kind: policy.kind, level: policy.level, levelMax: policy.levelMax },
    ws, ...(pass.hands === 'self' ? { frame: `${url.origin}/${deps.meta.id}/__game/?room=${encodeURIComponent(room)}&t=${encodeURIComponent(ticket)}` } : { hello: { t: 'hello', v: 1, rev: 6, want: 'play', canHost: false, agent: { hands: 'host', role: pass.role } } }),
    expiresAt: Date.now() + AGENT_TICKET_MS,
  });
}

/**
 * FILL A SPOT (DESIGN section 12): a service that seats an AI in an empty spot for a price is the owner's money
 * decision, so nothing issues `service` passes and this hook answers null. A later version decides who, what and how.
 */
export function fillSpot() { return null; }
