/**
 * AGENT SEATS (@homie-rocks/studio 0.16.0, NETPLAY.md section 17; brains 0.17.0, section 18): an AI that sits in
 * a room's seat the way a phone does, always marked AI, and the skill dial every game's bots can read.
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
 *   HouseAgents            (phase 2) a beginner server's AI guides, run by the room's own Table on alarms
 *
 * Nothing here imports the rest of the Worker (only brain.mjs, which is pure), so the relay (room.mjs) can use the
 * dial and the names as they are.
 */
import { GUIDE_RULES, costOf, decisionSchema, ownerKey, parseDecision, promptFor, scripted, talks, workersAi } from './brain.mjs';

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
/** The reverse, or null for anything that is not one (at most 4 KB, or `max`: a room's chat rules may be longer). */
export function decodeFacts(text, max = 4096) {
  const t = String(text ?? '');
  if (!t || t.length > max || !/^[A-Za-z0-9_-]+$/.test(t)) return null;
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
    ws, ...(pass.hands === 'self' ? { frame: `${url.origin}/${deps.meta.id}/__game/?room=${encodeURIComponent(room)}&t=${encodeURIComponent(ticket)}` } : { hello: { t: 'hello', v: 1, rev: 7, want: 'play', canHost: false, agent: { hands: 'host', role: pass.role } } }),
    expiresAt: Date.now() + AGENT_TICKET_MS,
  });
}

/**
 * FILL A SPOT (DESIGN section 12): a service that seats an AI in an empty spot for a price is the owner's money
 * decision, so nothing issues `service` passes and this hook answers null. A later version decides who, what and how.
 */
export function fillSpot() { return null; }

/* ------------------------------------------------------------------ house agents (phase 2, 0.17.0) */

/**
 * HOUSE AGENTS (NETPLAY.md section 18): a beginner server's AI guides, run by the room's own Table on the studio
 * owner's Worker. Each is a peer on a loopback `conn` handed to `room.attach()`, so it speaks the same protocol as any
 * AI: it hears `agent:view` from the host and the party's lines, and sends `agent:do` and `say:<lineId>`; the relay
 * checks it like any other. Its brain runs on Durable Object ALARMS (never an interval): one alarm per room when a
 * decision is due, at most one every 3 s, only while a person is seated and the server's AI may talk.
 *
 *   cadence   a decision on an ask made of this guide (0.8 s after it, to gather a second tap), on a goal finished or
 *             failed, on a zone or danger change, else every 12 s while people are near; at least 3 s between AI
 *             calls per guide and at most 10 a minute. The game's hands keep playing at frame rate throughout.
 *   brain     the server's: workers-ai (env.AI, model HOMIE_BRAIN_MODEL) or owner-key (the Worker secret
 *             HOMIE_BRAIN_KEY). With no binding or key, over the day's budget, or on any error or answer that is not
 *             a decision: the scripted floor (brain.mjs scripted), which answers asks the way agents.json says.
 *   rules     fixed, outside the model: a person's ask is answered as agents.json says (a model that chose otherwise is
 *             overruled), and that goal is carried through until it is done (or 60 s): no model call replaces it, and
 *             none is made meanwhile but for a new ask; a line at most every 8 s; after "no thanks" (an ask with `leave`) the guide
 *             leaves that player alone for 10 minutes; a guide never acts against a player (the vocabulary refuses
 *             such a goal); the room's owner can mute or kick a guide like anyone (a kicked guide's seat stays an AI
 *             seat the game's bots move, with no brain).
 *   log       the last 50 decisions (seats and ids only, never a name or an account), in memory, for the office.
 */

export const BRAIN_CADENCE = Object.freeze({ askDebounceMs: 800, gapMs: 3000, perMinute: 10, everyMs: 12_000, alarmGapMs: 3000, batchMs: 1500, timeoutMs: 8000 });
/** The day's default budget: 8,000 Workers AI neurons (the free allocation is 10,000 an account), $1 of the owner's key. */
export const BRAIN_BUDGET = Object.freeze({ neurons: 8000, usd: 1 });
export const HOUSE_PASS = 'house-';
const LOG_MAX = 50;

export class HouseAgents {
  /**
   * @param {object} o
   * @param {import('./room.mjs').NetRoom} o.room
   * @param {object} [o.env]  the Worker's env (AI, HOMIE_BRAIN_KEY, HOMIE_BRAIN_MODEL)
   * @param {(at: number) => void} [o.setAlarm]  the Durable Object's storage.setAlarm
   * @param {{ left: (kind: 'neurons' | 'micros') => number, spend: (c: { neurons: number, micros: number, provider: string }) => void }} [o.budget]
   * @param {object} [o.providers]  { 'workers-ai': (env, args) => …, 'owner-key': (env, args) => … } (tests stand in for them)
   */
  constructor({ room, env = {}, now = Date.now, setAlarm = () => {}, budget = null, providers = {}, log = () => {} }) {
    this.room = room;
    this.env = env;
    this.now = now;
    this.setAlarm = setAlarm;
    this.budget = budget ?? { left: () => Infinity, spend: () => {} };
    this.providers = { 'workers-ai': workersAi, 'owner-key': ownerKey, ...providers };
    this.log = log;
    this.agents = [];
    this.decisions = [];
    this.alarmAt = null;
    this.lastAlarmAt = -Infinity;
    this.backoffUntil = 0;
    /** pass id → until: a guide the owner kicked stays out until its hold ends. */
    this.held = new Map();
    this.why = null;
    this.calls = 0;
    this.spent = { neurons: 0, micros: 0 };
  }

  /** How many house guides this room should have now: the server's guides, less any a pass-holding AI took. */
  wanted() {
    const r = this.room;
    const p = r.policy;
    const no = (why) => { this.wantWhy = why; return 0; };
    if (!talks(p)) return no('talk-off');
    if (!r.vocab) return no('no-vocabulary');
    if (!(p.guides > 0)) return no('no-guides');
    if (r.closedUntil > this.now()) return no('closed');
    if (!r.seatedHumans().length) return no('nobody-seated');
    const host = r.host();
    if (!(host ? host.caps : r.caps).has('agents')) return no('host-moves-no-ai');
    const taken = r.live().filter((c) => c.agent && !c.conn.loopback && c.agent.role === 'guide').length;
    this.wantWhy = taken ? 'pass-guides' : null;
    return Math.max(0, p.guides - taken);
  }

  live() { return this.agents.filter((a) => !a.closed); }

  /** Seat or stand guides so the room has what it should (called on the Table's 1 s beat and on a policy change). */
  sync() {
    const want = this.wanted();
    const live = this.live();
    for (const a of live.slice(want).reverse()) this.stand(a, this.wantWhy ?? 'not-needed');
    if (live.length >= want || this.now() < this.backoffUntil) return;
    for (let i = live.length; i < want; i += 1) if (!this.sit()) break;
  }

  /** One guide sits: a loopback peer whose hello says it is an AI with no game client (hands `host`). */
  sit() {
    const vocab = this.room.vocab;
    const used = new Set(this.live().map((a) => a.n));
    let n = 0;
    while (used.has(n)) n += 1;
    const pass = `${HOUSE_PASS}${n + 1}`;
    if ((this.held.get(pass) ?? 0) > this.now()) return false;
    const names = vocab?.names?.length ? vocab.names : ['Guide'];
    const label = names.length > n ? names[n] : `${names[n % names.length]} ${Math.floor(n / names.length) + 1}`;
    const a = {
      n, pass, name: aiName(label), seat: null, closed: false, view: null, viewAt: 0, zone: undefined, danger: undefined, goalState: null,
      asks: [], answered: new Map(), carry: null, party: [], avoid: new Map(), calls: [], lastCallAt: -Infinity, dueAt: Infinity, dueWhy: null, sayAt: -Infinity, inFlight: false, provider: null,
    };
    a.conn = {
      loopback: true, ip: null, browser: null, via: null, player: null, qa: false, watch: false,
      agent: { pass, role: 'guide', hands: 'host', by: 'studio', name: label },
      send: (text) => this.onFrame(a, text),
      close: (code, why) => this.onClosed(a, why),
      buffered: () => 0,
    };
    this.agents.push(a);
    a.h = this.room.attach(a.conn);
    a.h.onMessage(JSON.stringify({ t: 'hello', v: 1, rev: 7, device: 'desk', want: 'play', canHost: false, agent: { hands: 'host', role: 'guide' } }));
    return !a.closed;
  }

  stand(a, why = 'bye') {
    if (a.closed) return;
    a.closed = true;
    try { a.h.onMessage(JSON.stringify({ t: 'bye' })); } catch { /* gone */ }
    this.log({ ev: 'house-stand', room: this.room.code, pass: a.pass, why });
  }

  /** Every guide stands (AI talk turned off, the room forgotten). */
  stop(why = 'stop') { for (const a of this.live()) this.stand(a, why); }

  onClosed(a, why) {
    a.closed = true;
    a.seat = null;
    this.agents = this.agents.filter((x) => x !== a);
    if (why === 'agents-alone') this.backoffUntil = this.now() + 30_000;
  }

  onFrame(a, text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    const now = this.now();
    switch (m.t) {
      case 'welcome': a.seat = m.seat; if (typeof m.name === 'string') a.name = m.name; return;
      case 'error':
        if (m.code === 'kicked') this.held.set(a.pass, Number(m.until) || now + 10 * 60_000);
        else if (['agents-off', 'agents-unsupported', 'agent-pass', 'room-closed', 'room-full', 'too-many'].includes(m.code)) this.backoffUntil = now + 60_000;
        else if (m.code === 'agents-alone') this.backoffUntil = now + 30_000;
        return;
      case 'policy':
        if (!talks(m.policy)) this.stop('talk-off');
        return;
      case 'ev': return this.onEvent(a, m, now);
      default: return;
    }
  }

  onEvent(a, m, now) {
    const k = String(m.k ?? '');
    const d = m.d && typeof m.d === 'object' ? m.d : {};
    if (k === 'agent:view') {
      const before = a.view;
      a.view = d;
      a.viewAt = now;
      // What makes a guide think again at once: its goal ended, the zone or the danger changed.
      const state = d.goal && typeof d.goal === 'object' ? d.goal.state ?? null : null;
      if ((state === 'done' || state === 'failed') && a.goalState !== state) this.due(a, now, `goal ${state}`);
      a.goalState = state;
      if (before && (JSON.stringify(d.zone ?? null) !== JSON.stringify(a.zone ?? null) || JSON.stringify(d.danger ?? null) !== JSON.stringify(a.danger ?? null))) this.due(a, now, d.danger ? 'danger' : 'zone');
      a.zone = d.zone ?? null;
      a.danger = d.danger ?? null;
      // Asks the game lists in the view (the host's own player's asks reach a guide this way).
      for (const x of Array.isArray(d.asks) ? d.asks.slice(0, 4) : []) if (x && typeof x.k === 'string' && Number.isInteger(x.from)) this.ask(a, { k: x.k, args: x.args ?? {}, from: x.from, at: Number(x.at) || now }, now);
      if (a.dueAt === Infinity && this.near(a)) this.due(a, Math.max(now, (a.lastCallAt === -Infinity ? now : a.lastCallAt + BRAIN_CADENCE.everyMs)), 'every 12 s');
      return;
    }
    const ask = /^ask:([a-z][a-z0-9_]{0,31})$/.exec(k)?.[1];
    if (ask && d.seat === a.seat && Number.isInteger(m.from)) { this.ask(a, { k: ask, args: d.args ?? {}, from: m.from, at: now }, now); return; }
    // The party's lines: the brain sees the last three, as ids and arguments (free text only on a "game" server).
    const line = /^say:([a-z][a-z0-9_]{0,31})$/.exec(k)?.[1];
    if (line && m.from !== a.seat && !(d.ai && d.slot !== undefined && d.seat === a.seat)) a.party = [...a.party, { seat: m.from, line, args: d.args ?? {} }].slice(-3);
    else if (/^chat/i.test(k) && typeof (d.text ?? m.d) === 'string') a.party = [...a.party, { seat: m.from, chat: String(d.text ?? m.d).slice(0, 120) }].slice(-3);
  }

  /** An ask made of this guide: remembered for 30 s, decided on 0.8 s later. "No thanks" holds the player off 10 minutes. */
  ask(a, x, now) {
    const vocab = this.room.vocab;
    if (!vocab?.asks?.[x.k]) return;
    // One ask is decided once: the same ask (the host's view lists it for 30 s, and a person's copy came first) is not
    // a new reason to think, nor a new call to a model.
    const key = `${x.k}|${x.from}|${JSON.stringify(x.args ?? {})}`;
    for (const [k, until] of a.answered) if (until <= now) a.answered.delete(k);
    if (a.answered.has(key) || a.asks.some((y) => `${y.k}|${y.from}|${JSON.stringify(y.args ?? {})}` === key)) return;
    if (vocab.asks[x.k].leave) a.avoid.set(x.from, now + GUIDE_RULES.leaveMs);
    a.asks = [...a.asks, x].slice(-4);
    this.due(a, now + BRAIN_CADENCE.askDebounceMs, `ask ${x.k}`);
  }

  /** People near this guide (the view's `party`, else anyone seated). */
  near(a) {
    const p = a.view?.party;
    return Array.isArray(p) ? p.length > 0 : this.room.seatedHumans().length > 0;
  }

  due(a, at, why) {
    if (at < a.dueAt) { a.dueAt = at; a.dueWhy = why; }
    this.schedule();
  }

  /** When this guide may next call its brain: 3 s after its last call, and within 10 calls a minute. */
  readyAt(a, now) {
    const recent = a.calls.filter((t) => t > now - 60_000);
    const cap = recent.length >= BRAIN_CADENCE.perMinute ? recent[recent.length - BRAIN_CADENCE.perMinute] + 60_000 : -Infinity;
    return Math.max(a.lastCallAt + BRAIN_CADENCE.gapMs, cap);
  }

  /** One alarm for the room: the earliest due guide, never sooner than 3 s after the last alarm. */
  schedule() {
    const now = this.now();
    let next = Infinity;
    for (const a of this.live()) if (a.seat !== null && a.dueAt !== Infinity && !a.inFlight) next = Math.min(next, Math.max(a.dueAt, this.readyAt(a, now)));
    if (next === Infinity) return null;
    const at = Math.max(next, this.lastAlarmAt + BRAIN_CADENCE.alarmGapMs, now + 20);
    if (this.alarmAt !== null && this.alarmAt <= at && this.alarmAt > now) return this.alarmAt;
    this.alarmAt = at;
    try { this.setAlarm(at); } catch { /* the next beat schedules again */ }
    return at;
  }

  /** The Durable Object's alarm: every guide due by now (or within 1.5 s) decides, then the next alarm is set. */
  async onAlarm() {
    const now = this.now();
    this.lastAlarmAt = now;
    this.alarmAt = null;
    const due = this.live().filter((a) => a.seat !== null && !a.inFlight && a.dueAt <= now + BRAIN_CADENCE.batchMs && this.readyAt(a, now) <= now + 100);
    await Promise.all(due.map((a) => this.decide(a).catch((error) => { a.inFlight = false; this.log({ ev: 'house-decide-failed', room: this.room.code, pass: a.pass, error: String(error?.message ?? error).slice(0, 200) }); })));
    this.schedule();
    return due.length;
  }

  /** The brain this server asked for, if it can run now: its binding or key is there, and today's budget is not spent. */
  providerFor(mode) {
    if (mode === 'workers-ai') {
      if (!this.env?.AI) return { why: 'no Workers AI binding (deploy once more to add it)' };
      if (this.budget.left('neurons') <= 0) return { why: 'today\'s Workers AI budget is spent (scripted until 00:00 UTC)' };
      return { run: (args) => this.providers['workers-ai'](this.env, args) };
    }
    if (mode === 'owner-key') {
      if (!this.env?.HOMIE_BRAIN_KEY) return { why: 'no key yet (homie-studio agents brain key)' };
      if (this.budget.left('micros') <= 0) return { why: 'today\'s dollar cap is reached (scripted until 00:00 UTC)' };
      return { run: (args) => this.providers['owner-key'](this.env, args) };
    }
    return { why: 'scripted' };
  }

  async decide(a) {
    const vocab = this.room.vocab;
    if (!vocab || a.closed) return null;
    a.inFlight = true;
    const now = this.now();
    const dueWhy = a.dueWhy;
    a.dueAt = Infinity;
    a.dueWhy = null;
    for (const [seat, until] of a.avoid) if (until <= now) a.avoid.delete(seat);
    const asks = a.asks.filter((x) => now - x.at < GUIDE_RULES.askMs);
    const quiet = now - a.sayAt < GUIDE_RULES.quietMs;
    // Carrying out what a person asked (until it is done, or 60 s): nothing to decide but a new ask; no model call.
    const goalNow = a.view?.goal && typeof a.view.goal === 'object' ? a.view.goal : null;
    if (!asks.length && a.carry && now < a.carry.until && (!goalNow || (goalNow.goal === a.carry.goal && goalNow.state === 'active'))) {
      a.inFlight = false;
      if (this.near(a) && !a.closed) this.due(a, now + BRAIN_CADENCE.everyMs, 'every 12 s');
      return null;
    }
    if (a.carry && (now >= a.carry.until || (goalNow && (goalNow.goal !== a.carry.goal || goalNow.state !== 'active')))) a.carry = null;
    const players = this.room.peopleSeats();
    const avoid = [...a.avoid.keys()];
    const mode = this.room.policy.brain;
    const p = this.providerFor(mode);
    this.why = p.why ?? null;
    let decision = null;
    let provider = 'script';
    let why = p.why ?? null;
    let ms = 0;
    let cost = { neurons: 0, micros: 0 };
    // Every decision keeps the 3 s pace (the relay takes one goal every 3 s); AI calls also count to 10 a minute.
    a.lastCallAt = now;
    if (p.run) {
      const prompt = promptFor(vocab, { view: a.view, me: { seat: a.seat }, goal: a.view?.goal ?? null, asks, party: a.party, speech: this.room.policy.speech, quiet });
      a.calls = [...a.calls.filter((t) => t > now - 60_000), now];
      try {
        const r = await p.run({ ...prompt, schema: decisionSchema(vocab), ms: BRAIN_CADENCE.timeoutMs });
        ms = this.now() - now;
        cost = costOf({ provider: mode, model: r.model, usage: r.usage, system: prompt.system, user: prompt.user, text: typeof r.out === 'string' ? r.out : JSON.stringify(r.out ?? '') });
        this.calls += 1;
        this.spent.neurons += cost.neurons;
        this.spent.micros += cost.micros;
        this.budget.spend({ ...cost, provider: mode });
        const parsed = parseDecision(r.out, vocab, { view: a.view, players, avoid });
        if (parsed.ok) { decision = parsed.decision; provider = mode; why = null; } else why = parsed.why;
        // A fixed rule: a person's ask is answered the way agents.json says (its goal). A model that chose something
        // else is overruled by the floor's answer; its line stays when it is one of the ask's.
        const ask = asks.at(-1);
        const want = ask ? vocab.asks[ask.k]?.goal : undefined;
        if (decision && want && decision.goal !== want) {
          const floor = scripted(vocab, { asks, view: a.view, players, avoid, quiet });
          if (floor?.goal) { why = `the model chose ${decision.goal}; the ask was answered as agents.json says`; decision = { ...floor, say: floor.say ?? null, sayArgs: floor.sayArgs ?? {} }; provider = `${mode}+floor`; }
        }
      } catch (error) {
        ms = this.now() - now;
        why = String(error?.message ?? error).slice(0, 120);
      }
    }
    // The floor: no AI, an AI that failed, or an answer that was not a decision.
    if (!decision) decision = scripted(vocab, { asks, view: a.view, players, avoid, quiet });
    const did = decision ? this.act(a, decision, quiet) : { goal: null, say: null };
    if (asks.length && decision) {
      for (const x of asks) a.answered.set(`${x.k}|${x.from}|${JSON.stringify(x.args ?? {})}`, now + 6000);
      a.asks = [];
      if (did.goal) a.carry = { goal: did.goal, until: now + GUIDE_RULES.carryMs };
    }
    a.provider = decision ? provider : a.provider;
    this.decisions = [...this.decisions, {
      at: now, seat: a.seat, guide: a.pass, provider: decision ? provider : 'none', ms, on: dueWhy,
      goal: did.goal, args: did.goal ? decision.args : null, say: did.say, sayArgs: did.say ? decision.sayArgs : null,
      ...(why ? { why } : {}), ...(cost.neurons ? { neurons: Math.round(cost.neurons * 100) / 100 } : {}), ...(cost.micros ? { micros: cost.micros } : {}),
    }].slice(-LOG_MAX);
    a.inFlight = false;
    if (this.near(a) && !a.closed) this.due(a, now + BRAIN_CADENCE.everyMs, 'every 12 s');
    return decision;
  }

  /** A decision becomes frames: `agent:do` (its goal) and, at most every 8 s, `say:<line>`. The relay checks both again. */
  act(a, decision, quiet) {
    const out = { goal: null, say: null };
    if (a.closed) return out;
    if (decision.goal) {
      a.h.onMessage(JSON.stringify({ t: 'ev', k: 'agent:do', d: { goal: decision.goal, args: decision.args ?? {} } }));
      out.goal = decision.goal;
    }
    if (decision.say && !quiet) {
      a.h.onMessage(JSON.stringify({ t: 'ev', k: `say:${decision.say}`, d: { args: decision.sayArgs ?? {} } }));
      a.sayAt = this.now();
      out.say = decision.say;
    }
    return out;
  }

  /** What the office shows: the guides, the brain in use (and why not, when it is not), and the last decisions. */
  facts() {
    return {
      brain: this.room.policy.brain, why: this.why, calls: this.calls,
      spent: { neurons: Math.round(this.spent.neurons * 100) / 100, micros: Math.round(this.spent.micros) },
      guides: this.live().map((a) => ({ name: a.name, seat: a.seat, provider: a.provider, asks: a.asks.length, dueAt: a.dueAt === Infinity ? null : a.dueAt })),
      decisions: this.decisions.slice(-LOG_MAX),
    };
  }
}
