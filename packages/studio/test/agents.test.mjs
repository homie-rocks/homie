/**
 * @homie-rocks/studio 0.16.0: agent seats and the skill dial (NETPLAY.md section 17, contract revision 6).
 *
 *   - the relay: a hybrid server keeps its top seats for AI (a person never takes one; a person seated above a new
 *     cap keeps their seat); an AI sits only with the Worker's word (`agent-pass`), never on a humans-only server or
 *     with no AI seat free (`agents-off`), and with no game client only where the host's game moves AI bodies
 *     (`agents-unsupported`); every agent is "<label> · AI" and a person's name never ends in an AI mark; a hands-host
 *     agent never hosts and gets no snapshots; the relay labels the host's roster and results so they cannot hide an
 *     AI; agents alone with no person seated are closed (`agents-alone`); speech modes and the agents' speech rate;
 *     the party's vote (median rounded down, the ceiling, early close, the timeout, the shell's socket, one vote a
 *     seat, no AI or watcher votes); the owner's policy control sends AI out after the round; a restart keeps the dial;
 *   - the helper: the Roster's AI seats, an agent's claim and release, bots off, trim, reconcile; `policy`,
 *     `skillOf`, `caps`, the vote, Quiet AI; the dial is the same table in the helper and the Worker;
 *   - the port kit: BotBrain's measured reaction and aim spread follow the dial.
 * Run: node --test packages/studio/test/agents.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_POLICY, NetRoom, medianVote, normalizePolicy } from '../worker/room.mjs';
import { AI_MARK, SKILLS, aiName, decodeFacts, encodeFacts, isAiName, skillPreset, stripAi } from '../worker/agents.mjs';
import { cleanName } from '../worker/players.mjs';
import { virtualTime } from './virtual-time.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-agents-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const POL = (extra = {}) => ({ ...DEFAULT_POLICY, at: 10, ...extra });
const AGENT = (extra = {}) => ({ pass: 'abcdef0123', role: 'party', hands: 'self', by: 'studio', name: 'Claude', ...extra });

function relay(opts = {}, pol = null) {
  let t = 1_000_000;
  const room = new NetRoom({ code: 's-night-shift-1', maxPlayers: 8, now: () => t, ...opts });
  if (pol) room.setPolicy(pol);
  const join = (conn = {}, hello = {}) => {
    const c = { sent: [], closed: null, ip: `203.0.113.${Math.floor(Math.random() * 200)}`, ...conn, send(text) { this.sent.push(JSON.parse(text)); }, close(code, why) { this.closed = [code, why]; } };
    const h = room.attach(c);
    h.onMessage(JSON.stringify({ t: 'hello', v: 1, device: 'desk', want: 'play', canHost: true, ...hello }));
    return { conn: c, h, say: (m) => h.onMessage(JSON.stringify(m)), last: (type) => [...c.sent].reverse().find((x) => x.t === type) ?? null, all: (type) => c.sent.filter((x) => x.t === type) };
  };
  const agent = (facts = {}, hello = {}) => join({ agent: AGENT(facts) }, { agent: { hands: facts.hands ?? 'self', role: facts.role ?? 'party' }, ...hello });
  const feed = (conn = {}) => { const w = { sent: [], ...conn, send(text) { this.sent.push(JSON.parse(text)); } }; const h = room.watch(w); w.say = (m) => h.onMessage(JSON.stringify(m)); return w; };
  return { room, join, agent, feed, advance: (ms) => { t += ms; }, now: () => t };
}

/* ------------------------------------------------------------------ names and the dial */

test('every agent is "<label> · AI"; a person\'s name never ends in an AI or bot mark', () => {
  assert.equal(AI_MARK, ' · AI');
  assert.equal(aiName('Claude'), 'Claude · AI');
  assert.equal(aiName('Claude · AI'), 'Claude · AI', 'never twice');
  assert.equal(aiName('a very long name for an agent here'), 'a very long name · AI', 'the label is at most 16 characters');
  assert.equal(aiName(''), 'Agent · AI');
  for (const n of ['Bob · AI', 'Bob (AI)', 'Bob [bot]', 'Bob - A.I.', 'Bob Bot', 'Bob  ·  ai']) {
    assert.equal(isAiName(n), true, n);
    assert.equal(stripAi(n), 'Bob', n);
  }
  for (const n of ['Ai', 'Mai', 'Robot', 'Abbot', 'Mia I']) assert.equal(isAiName(n), false, `${n} is a person's name`);
  assert.equal(cleanName('Ada · AI').ok, false, 'an account name cannot say AI');
  assert.equal(cleanName('Ada · AI').error, 'name-ai');
  assert.equal(cleanName('Mai').ok, true);
  const facts = { a: 'Zoë · AI', n: [1, 2] };
  assert.deepEqual(decodeFacts(encodeFacts(facts)), facts, 'the Worker\'s pol/ag values survive the address');
  assert.equal(decodeFacts('not base64!'), null);
});

test('the dial: five levels, Fair is what bots always were; a kids room caps the level at 3 and aggression at 0.3', () => {
  assert.deepEqual(SKILLS.map((s) => s.name), ['Rookie', 'Steady', 'Fair', 'Strong', 'Maxed']);
  const fair = skillPreset(3);
  assert.equal(fair.reactionMs, 250);
  assert.ok(Math.abs(fair.aimNoise * 0.8 - 0.12) < 1e-9, 'Fair aims as the port kit always did: 0.12 rad');
  assert.equal(skillPreset(9).level, 5);
  assert.equal(skillPreset('x').level, 3);
  const kids = skillPreset(5, { kids: true });
  assert.equal(kids.level, 3);
  assert.equal(kids.aggression, 0.3);
  assert.equal(medianVote([1, 5]), 1, 'a tie is settled kindly (the lower middle)');
  assert.equal(medianVote([2, 4, 5]), 4);
  assert.equal(medianVote([]), null);
});

test('the helper and the Worker have the same dial', () => {
  const ts = readFileSync(join(PKG, 'netplay', 'netplay.ts'), 'utf8');
  const body = /export const SKILLS: readonly Skill\[\] = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(ts)[1];
  const rows = [...body.matchAll(/level: (\d), name: '(\w+)', reactionMs: (\d+), aimNoise: ([\d.]+), aggression: ([\d.]+), positioning: ([\d.]+), card: '([^']+)'/g)]
    .map((m) => ({ level: Number(m[1]), name: m[2], reactionMs: Number(m[3]), aimNoise: Number(m[4]), aggression: Number(m[5]), positioning: Number(m[6]), card: m[7] }));
  assert.deepEqual(rows, SKILLS.map((s) => ({ ...s })));
  assert.match(ts, /export const AI_MARK = ' · AI';/);
});

/* ------------------------------------------------------------------ the relay: seats */

test('hybrid: the top seats are kept for AI; people take the rest and wait when it is full; a person above a new cap keeps their seat', () => {
  const { room, join, agent } = relay({}, POL({ kind: 'hybrid', aiSeats: 2 }));
  assert.equal(room.humanCap(), 6);
  const people = Array.from({ length: 6 }, () => join());
  assert.deepEqual(people.map((p) => p.last('welcome').seat), [0, 1, 2, 3, 4, 5]);
  const seventh = join();
  assert.equal(seventh.last('welcome').full, true, 'the seventh person waits: seats 6 and 7 are the AI\'s');
  assert.equal(seventh.last('welcome').seat, null);
  const a = agent();
  assert.equal(a.last('welcome').seat, 7, 'an AI takes a kept seat, from the top');
  assert.equal(a.last('welcome').name, 'Claude · AI');
  assert.equal(a.last('welcome').agent.hands, 'self');
  const b = agent({ pass: 'bbbbbbbbbb', name: 'Gemma' });
  assert.equal(b.last('welcome').seat, 6);
  const c = agent({ pass: 'cccccccccc', name: 'Third' });
  assert.equal(c.last('error').code, 'agents-off', 'no AI seat is free');
  assert.match(c.last('error').message, /no AI seat is free/);
  // An open room: a person who sat at seat 7 keeps it when the server becomes hybrid.
  const open = relay({ maxPlayers: 8 }, POL());
  const ps = Array.from({ length: 8 }, () => open.join());
  const token7 = ps[7].last('welcome').token;
  ps[7].h.onClose();
  open.room.setPolicy(POL({ at: 20, kind: 'hybrid', aiSeats: 2 }));
  const back = open.join({}, { token: token7 });
  assert.equal(back.last('welcome').seat, 7, 'a person holding a seat above the cap keeps it');
  // The relay's facts: people are players; agents are counted apart.
  const f = room.facts();
  assert.equal(f.counts.players, 6);
  assert.equal(f.counts.agents, 2);
  assert.equal(f.counts.humanSeats, 6);
  assert.equal(f.clients.find((x) => x.seat === 7).agent.pass, 'abcdef0123');
});

test('refusals: an AI hello with no pass, any AI on a humans-only server, and a lite AI where the host\'s game moves no AI', () => {
  const { join, agent, room } = relay({}, POL());
  join();
  const fake = join({}, { agent: { hands: 'self', role: 'party' } });
  assert.equal(fake.last('error').code, 'agent-pass', 'only the Worker\'s word (a verified pass) makes an agent');
  assert.deepEqual(fake.conn.closed, [1008, 'agent-pass']);
  const lite = agent({ hands: 'host' });
  assert.equal(lite.last('error').code, 'agents-unsupported', 'the host never said caps: [\'agents\'] (an old build)');
  const humans = relay({}, POL({ kind: 'humans-only' }));
  humans.join();
  const a = humans.agent();
  assert.equal(a.last('error').code, 'agents-off');
  assert.equal(a.last('error').message, 'This server is for humans only');
  assert.equal(a.last('welcome'), null);
  // A host whose game moves AI bodies: the lite AI sits.
  const r2 = relay({}, POL({ kind: 'hybrid', aiSeats: 1 }));
  r2.join({}, { caps: ['agents'] });
  const l2 = r2.agent({ hands: 'host' });
  assert.equal(l2.last('welcome').seat, 7);
  assert.equal(room.facts().rev, 7);
});

test('names: a person cannot type an AI mark, a kids server uses handles, and an agent\'s name is its label', () => {
  const { join, agent } = relay({}, POL());
  const p = join({}, { name: 'Bob · AI' });
  assert.equal(p.last('welcome').name, 'Bob');
  const a = agent({}, { name: 'Totally a person' });
  assert.equal(a.last('welcome').name, 'Claude · AI', 'the hello\'s name is ignored for an agent');
  const kids = relay({}, POL({ kind: 'beginner', kids: true, guides: 2, speech: 'lines' }));
  const k = kids.join({}, { name: 'Real Name Here' });
  assert.notEqual(k.last('welcome').name, 'Real Name Here', 'kids: names are handles');
  assert.match(k.last('welcome').name, /^\w+ \w+$/);
});

test('an AI with no game client never hosts and gets no snapshots, checkpoints or state; one that runs the game hosts only when no person can', () => {
  const { room, join, agent } = relay({}, POL({ kind: 'hybrid', aiSeats: 2 }));
  const host = join({}, { caps: ['agents'] });
  assert.equal(host.last('welcome').role, 'host');
  host.say({ t: 'state', k: 'zone', d: { x: 1 } });
  host.say({ t: 'snap', k: 1, st: 1_000_000, d: { p: [] } });
  const lite = agent({ hands: 'host' });
  const w = lite.last('welcome');
  assert.equal(w.snap, null, 'no snapshot in its welcome');
  assert.deepEqual(w.state, {}, 'no state');
  assert.equal(w.role, 'replica');
  host.say({ t: 'snap', k: 2, st: 1_000_000, d: { p: [] } });
  host.say({ t: 'state', k: 'zone', d: { x: 2 } });
  host.say({ t: 'ev', k: 'boom', d: 1 });
  host.say({ t: 'ev', k: 'for-you', d: 1, to: w.seat });
  assert.equal(lite.all('snap').length, 0);
  assert.equal(lite.all('state').length, 0);
  assert.deepEqual(lite.all('ev').map((e) => e.k), ['for-you'], 'only what is addressed to its seat');
  // The person leaves: the lite AI cannot host (nobody does).
  host.h.onClose();
  room.tick();
  assert.equal(room.hostRef(), null, 'a lite AI is never elected host');
  // A full-client AI hosts a room no person can host, and hands it back when one arrives.
  const r = relay({}, POL({ kind: 'hybrid', aiSeats: 1 }));
  const shy = r.join({}, { canHost: false });
  const self = r.agent();
  assert.equal(shy.last('welcome').role, 'replica');
  assert.equal(self.last('welcome').role, 'host', 'nobody else can host: the AI does');
  const person = r.join();
  assert.equal(person.last('welcome').role, 'host', 'a person who can host takes the rules back (DESIGN D10)');
  assert.equal(person.last('welcome').why, 'host-person');
  assert.equal(self.last('role').role, 'replica');
});

test('labels: the host\'s roster and results cannot hide an AI, mark a person as AI, or keep a body with no seat a person', () => {
  const { room, join, agent } = relay({}, POL({ kind: 'hybrid', aiSeats: 2 }));
  const host = join({}, { caps: ['agents'], name: 'Ada' });
  const other = join({}, { name: 'Bo' });
  const a = agent();
  const aSeat = a.last('welcome').seat;
  host.say({ t: 'roster', slots: [
    { slot: 0, seat: 0, name: 'Ada (AI)', bot: false, agent: { seat: 0, role: 'party', hands: 'self' } },
    { slot: 1, seat: aSeat, name: 'Totally Bob', bot: false },
    { slot: 2, seat: null, name: 'Sneaky', bot: false },
    { slot: 3, seat: 4, name: 'Ghost', bot: false },
    { slot: 4, seat: null, name: 'Rook', bot: true, agent: { seat: null, role: 'party', hands: 'host' } },
    { slot: 5, seat: 1, name: 'Bo', bot: false },
  ] });
  const slots = other.last('roster').slots;
  assert.equal(slots[0].agent, undefined, 'a person is never marked AI');
  assert.equal(slots[0].name, 'Ada', 'a person\'s name loses an AI mark');
  assert.equal(slots[1].name, 'Claude · AI', 'an agent\'s seat is named and marked so');
  assert.deepEqual(slots[1].agent, { seat: aSeat, role: 'party', hands: 'self' });
  assert.equal(slots[2].bot, true, 'a body with no seat is a bot');
  assert.equal(slots[3].bot, true, 'a seat nobody holds is a bot');
  assert.equal(slots[3].seat, null);
  assert.equal(slots[4].name, 'Rook · AI', 'a seat kept for AI says AI');
  assert.equal(room.facts().counts.ai, 2);
  assert.equal(room.facts().counts.humans, 2);
  host.say({ t: 'round', round: { n: 1, phase: 'over', startedAt: 0, endsAt: 1, results: [
    { slot: 1, seat: aSeat, name: 'Bob', score: 9, bot: false, place: 1 },
    { slot: 0, seat: 0, name: 'Ada · AI', score: 3, bot: false, place: 2, agent: true },
  ] } });
  const res = other.last('round').round.results;
  assert.equal(res[0].agent, true);
  assert.equal(res[0].name, 'Claude · AI');
  assert.equal(res[1].agent, undefined);
  assert.equal(res[1].name, 'Ada');
});

test('agents never keep a room alive: alone for a minute they are closed (agents-alone), and none may come in', () => {
  const { room, join, agent, advance } = relay({}, POL({ kind: 'hybrid', aiSeats: 2 }));
  const person = join();
  const a = agent();
  person.h.onClose();
  // The AI's socket stays alive (it pings like any client); only the room's emptiness ends it.
  const pass = (ms) => { for (let t = 0; t < ms; t += 5000) { advance(Math.min(5000, ms - t)); a.say({ t: 'ping', c: 1 }); room.tick(); } };
  pass(30_000);
  assert.equal(a.conn.closed, null, 'a moment alone is fine (the person may be reloading)');
  pass(31_000);
  assert.equal(a.last('error').code, 'agents-alone');
  assert.deepEqual(a.conn.closed, [4001, 'agents-alone']);
  const late = agent();
  assert.equal(late.last('error').code, 'agents-alone', 'an AI does not open an empty room');
  // The Lobby counts people only: a room with only agents is empty.
  assert.equal(room.facts().counts.players, 0);
});

test('speech: quick lines only drops free chat (anyone\'s), off drops all of it, and an agent says at most one line every 4 s and 8 a minute', () => {
  const lines = relay({}, POL({ kind: 'beginner', guides: 1, speech: 'lines' }));
  const h = lines.join();
  const p = lines.join();
  p.say({ t: 'ev', k: 'chat', d: 'hello there' });
  p.say({ t: 'ev', k: 'say:hello', d: {} });
  p.say({ t: 'ev', k: 'emote', d: 'wave' });
  assert.deepEqual(h.all('ev').map((e) => e.k), ['say:hello', 'emote']);
  h.say({ t: 'ev', k: 'chat:line', d: 'relayed by the host' });
  assert.equal(p.all('ev').length, 0, 'a host relaying chat is held to it too');
  assert.equal(lines.room.stats.speechDrops, 2);
  const off = relay({}, POL({ speech: 'off' }));
  const oh = off.join();
  const op = off.join();
  for (const k of ['chat', 'say:x', 'emote']) op.say({ t: 'ev', k, d: 1 });
  op.say({ t: 'ev', k: 'jump', d: 1 });
  assert.deepEqual(oh.all('ev').map((e) => e.k), ['jump']);
  // An agent's lines (revision 7: only its game's vocabulary, on a server whose AI may talk): one every 4 s, 8 a minute.
  const r = relay({}, POL({ kind: 'hybrid', aiSeats: 1, brain: 'workers-ai' }));
  r.room.setVocabulary({ v: 1, goals: { wait: { about: 'wait here' } }, lines: Object.fromEntries(['hi', 'again', ...Array.from({ length: 12 }, (_, i) => `l${i}`)].map((k) => [k, { text: k }])) });
  const rh = r.join();
  const a = r.agent();
  a.say({ t: 'ev', k: 'say:hi', d: {} });
  a.say({ t: 'ev', k: 'say:again', d: {} });
  assert.deepEqual(rh.all('ev').map((e) => e.k), ['say:hi'], 'one line every 4 s');
  for (let i = 0; i < 12; i += 1) { r.advance(4100); a.say({ t: 'ev', k: `say:l${i}`, d: {} }); }
  assert.ok(rh.all('ev').length <= 9, `at most 8 a minute (got ${rh.all('ev').length} in ~53 s)`);
  assert.ok(r.room.stats.agentDrops >= 1);
  r.advance(3000);
  a.say({ t: 'ev', k: 'agent:do', d: { goal: 'wait', args: {} } });
  assert.equal(rh.last('ev').k, 'agent:do', 'what is not speech passes (a goal of the vocabulary)');
});

/* ------------------------------------------------------------------ the vote */

test('the vote: the middle vote wins, rounded down, under the ceiling; it closes when everyone voted or in 15 s; agents and watchers never vote', () => {
  const { room, join, agent, feed, advance } = relay({}, POL({ kind: 'hybrid', aiSeats: 2, levelMax: 4 }));
  const A = join({ browser: 'aaaaaaaaaaaaaaaaaaaa' }, { caps: ['agents', 'skill'] });
  const B = join({ browser: 'bbbbbbbbbbbbbbbbbbbb' });
  const ai = agent();
  ai.say({ t: 'vote', of: 'skill', n: 4 });
  assert.equal(ai.last('error').code, 'vote', 'an AI never votes');
  A.say({ t: 'vote', of: 'skill', n: 1 });
  const v = B.last('vote');
  assert.equal(v.open, true);
  assert.deepEqual(v.options, [1, 2, 3, 4], 'options above the ceiling are hidden');
  assert.equal(v.voters, 1);
  assert.equal(v.of_total, 2, 'two seated people (the AI is not a voter)');
  // B votes from the play page's card: the shell's watch socket, mapped to B's seat by the browser key.
  const shellB = feed({ browser: 'bbbbbbbbbbbbbbbbbbbb' });
  shellB.say({ t: 'vote', of: 'skill', n: 5 });
  assert.equal(shellB.sent.at(-1).code, 'vote', 'above the ceiling is refused');
  shellB.say({ t: 'vote', of: 'skill', n: 4 });
  const done = A.last('vote');
  assert.equal(done.open, false, 'everyone seated voted: it closes at once');
  assert.equal(done.result.level, 1, 'Rookie and Strong: the lower middle, Rookie');
  assert.equal(done.result.votes, 2);
  assert.equal(A.last('policy').policy.skill.name, 'Rookie', 'it applies at once');
  assert.equal(room.facts().policy.skill.level, 1);
  // A player opens another one too soon: refused; after 2 minutes, both vote Strong.
  A.say({ t: 'vote', of: 'skill', open: true });
  assert.match(A.last('error').message, /a moment ago/);
  advance(121_000);
  A.say({ t: 'vote', of: 'skill', n: 4 });
  B.say({ t: 'vote', of: 'skill', n: 4 });
  assert.equal(A.last('vote').result.level, 4);
  // A watcher (no seat) cannot vote; the timeout closes a vote with the votes it has.
  const watcher = join({}, { watch: true });
  advance(121_000);
  A.say({ t: 'vote', of: 'skill', open: true });
  watcher.say({ t: 'vote', of: 'skill', n: 2 });
  assert.equal(watcher.last('error').code, 'vote');
  A.say({ t: 'vote', of: 'skill', n: 2 });
  A.say({ t: 'vote', of: 'skill', n: 3 });
  assert.equal(B.last('vote').voters, 1, 'one vote a seat (a change replaces it)');
  for (let i = 0; i < 4; i += 1) { advance(4000); A.say({ t: 'ping', c: 1 }); B.say({ t: 'ping', c: 1 }); room.tick(); }
  assert.equal(B.last('vote').open, false);
  assert.equal(B.last('vote').result.level, 3);
  assert.equal(B.last('vote').result.why, 'time');
});

test('a party\'s first live round with AI seats opens the vote by itself (a game that reads the dial), once per half hour', () => {
  const { join, advance } = relay({}, POL({ kind: 'hybrid', aiSeats: 2 }));
  const h = join({}, { caps: ['agents'] });
  const p = join();
  h.say({ t: 'round', round: { n: 1, phase: 'live', startedAt: 0, endsAt: 60_000 } });
  assert.equal(p.last('vote'), null, 'its bots do not read the dial yet: no vote');
  h.say({ t: 'caps', caps: ['skill', 'agents'] });
  h.say({ t: 'round', round: { n: 2, phase: 'live', startedAt: 0, endsAt: 60_000 } });
  assert.equal(p.last('vote').open, true);
  assert.equal(p.last('vote').reason, 'start');
  advance(16_000);
  h.say({ t: 'round', round: { n: 3, phase: 'live', startedAt: 0, endsAt: 60_000 } });
  assert.equal(p.all('vote').filter((v) => v.open && v.reason === 'start').length, 1, 'once per half hour');
});

/* ------------------------------------------------------------------ the owner's policy */

test('the owner makes a server humans-only: its AI leave after the round, none may come back, and a restart keeps the party\'s dial', () => {
  const { room, join, agent, advance } = relay({}, POL({ kind: 'hybrid', aiSeats: 2 }));
  const h = join({}, { caps: ['agents', 'skill'] });
  const a = agent();
  h.say({ t: 'round', round: { n: 4, phase: 'live', startedAt: 1_000_000, endsAt: 1_000_000 + 40_000 } });
  const res = room.control('policy', { pol: POL({ at: 50, kind: 'humans-only' }) });
  assert.equal(res.ok, true);
  assert.equal(res.leaving, 1);
  assert.equal(h.last('policy').policy.kind, 'humans-only');
  assert.equal(a.conn.closed, null, 'the round finishes first');
  h.say({ t: 'round', round: { n: 4, phase: 'over', startedAt: 1_000_000 + 40_000, endsAt: 1_000_000 + 47_000 } });
  advance(5001); room.tick();
  assert.equal(a.last('error').code, 'agents-off');
  assert.equal(a.last('error').message, 'This server is humans-only now.');
  assert.ok(a.conn.closed);
  assert.equal(agent({ pass: 'dddddddddd' }).last('error').code, 'agents-off');
  // An older stamp never replaces a newer policy; the same stamp with other words does (a redeployed seed).
  assert.equal(room.setPolicy(POL({ at: 40, kind: 'open' })).same, true);
  assert.equal(room.policy.kind, 'humans-only');
  // The party's dial (or the owner's) survives a deploy, written at the next tick (not within 30 s).
  const saves = [];
  room.store = { save: (o) => saves.push(o), clear: () => {} };
  room.persist();
  saves.length = 0;
  room.control('level', { level: 2 });
  room.tick();
  assert.equal(saves.at(-1)?.level, 2, 'saved at once');
  assert.equal(h.last('policy').policy.skill.name, 'Steady');
  const saved = room.saved();
  const r2 = new NetRoom({ code: 's-night-shift-1', maxPlayers: 8, now: () => 1_000_000 + 60_000 });
  assert.equal(r2.restore(saved), true);
  assert.equal(r2.policyOut().skill.level, 2);
  assert.equal(r2.policy.kind, 'humans-only');
  assert.equal(normalizePolicy({ kind: 'nonsense', aiSeats: 99 }).kind, 'open');
});

/* ------------------------------------------------------------------ the helper */

let helper = null;
async function netplayModule() {
  if (helper) return helper;
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  const file = join(scratch, 'netplay.mjs');
  await esbuild.build({ entryPoints: [join(PKG, 'netplay', 'netplay.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent' });
  helper = await import(file);
  return helper;
}
let port = null;
async function portModule() {
  if (port) return port;
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  const file = join(scratch, 'bots.mjs');
  await esbuild.build({ entryPoints: [join(PKG, 'port', 'bots.ts'), join(PKG, 'port', 'skill.ts')], bundle: true, format: 'esm', platform: 'neutral', outdir: join(scratch, 'port'), logLevel: 'silent' });
  port = { ...(await import(join(scratch, 'port', 'bots.js'))), ...(await import(join(scratch, 'port', 'skill.js'))) };
  void file;
  return port;
}

test('Roster (revision 6): kept AI seats, an agent\'s claim and release, bots off, trim and reconcile', async () => {
  const { Roster, DEFAULT_POLICY: DP } = await netplayModule();
  let pol = { ...DP, kind: 'hybrid', aiSeats: 2 };
  const r = new Roster({ min: 3, max: 8, botName: (s) => `Bot${s}`, policy: () => pol });
  assert.equal(r.slots.length, 3);
  assert.equal(r.agents().length, 2, 'two seats kept for AI');
  assert.ok(r.agents().every((s) => s.bot && s.agent.seat === null && s.name.endsWith(' · AI')));
  // A person never takes a kept seat: there is one plain bot, then a new slot.
  const p0 = r.claim(0, 'Ada');
  assert.equal(p0.slot.agent, undefined);
  const p1 = r.claim(1, 'Bo');
  assert.equal(p1.added, true, 'no plain bot left: a new slot, never an AI\'s');
  assert.equal(r.agents().length, 2);
  // An AI with no game client takes a kept seat and stays a bot body; one that runs the game drives it.
  const lite = r.claim(7, 'Claude · AI', { role: 'party', hands: 'host' });
  assert.equal(lite.slot.bot, true);
  assert.equal(lite.slot.seat, null);
  assert.equal(lite.slot.agent.seat, 7);
  const self = r.claim(6, 'Gemma · AI', { role: 'party', hands: 'self' });
  assert.equal(self.slot.bot, false);
  assert.equal(self.slot.seat, 6);
  assert.equal(r.bySeat(7), lite.slot, 'an agent\'s slot is found by its seat');
  // Leaving: back to a seat kept for AI.
  const rel = r.release(7);
  assert.equal(rel.agent.seat, null);
  assert.equal(rel.bot, true);
  assert.equal(rel.name, `Bot${rel.slot} · AI`);
  // reconcile: an agent peer present claims; a person gone becomes a bot.
  const { claimed, released } = r.reconcile([{ seat: 0, name: 'Ada' }, { seat: 6, name: 'Gemma · AI', agent: { pass: 'x', role: 'party', hands: 'self', by: 'studio' } }, { seat: 7, name: 'Claude · AI', agent: { pass: 'y', role: 'party', hands: 'host', by: 'studio' } }]);
  assert.deepEqual(released.map((s) => s.slot), [p1.slot.slot]);
  assert.equal(claimed.length, 1);
  assert.equal(r.bySeat(7).agent.hands, 'host');
  // A humans-only server: no filler bots, no kept seats; trim drops them between rounds.
  pol = { ...DP, kind: 'humans-only', bots: 'off' };
  const h = new Roster({ min: 3, max: 8, policy: () => pol });
  assert.equal(h.slots.length, 0, 'a lone person plays alone');
  h.claim(0, 'Ada');
  assert.equal(h.slots.length, 1);
  pol = { ...DP, kind: 'open' };
  const o = new Roster({ min: 3, max: 8, policy: () => pol });
  o.claim(0, 'Ada');
  o.claim(1, 'Bo'); o.claim(2, 'Cy'); o.claim(3, 'Di');
  o.release(3); o.release(2);
  assert.equal(o.slots.length, 4);
  o.trim();
  assert.equal(o.slots.length, 3, 'surplus bots go between rounds');
  // An old roster without a policy works as it always did.
  const plain = new Roster({ min: 3, max: 8 });
  assert.equal(plain.slots.length, 3);
  assert.equal(plain.agents().length, 0);
});

function memoryRoom(opts = {}, pol = null) {
  const room = new NetRoom({ code: 's-night-shift-1', maxPlayers: 8, ...opts });
  if (pol) room.setPolicy(pol);
  const socket = (conn = {}) => class MemorySocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0;
      this.h = room.attach({ ...conn, send: (t) => setTimeout(() => this.onmessage?.({ data: t }), 0), close: () => {}, buffered: () => 0 });
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }
    send(t) { this.h.onMessage(t); }
    close() { this.readyState = 3; this.h.onClose(); }
  };
  return { room, socket };
}
const cfg = (extra = {}) => ({ v: 1, url: 'ws://relay/x/__net?room=s-night-shift-1', room: 's-night-shift-1', device: 'desk', want: 'play', ...extra });

test('netplay helper: the policy and the dial, caps, the vote, an agent\'s hello, and Quiet AI', async (t) => {
  const { createNetplay } = await netplayModule();
  const { wait } = virtualTime(t);
  const { room, socket } = memoryRoom({}, POL({ kind: 'hybrid', aiSeats: 2, level: 2 }));
  const open = [];
  t.after(() => { for (const n of open) n.close(); });
  const make = (o, conn) => { const n = createNetplay({ post: null, game: 'x', WebSocketImpl: socket(conn), ...o }); open.push(n); return n; };
  const host = make({ config: cfg({ name: 'Ada' }), caps: ['agents'] });
  await wait(40);
  assert.equal(host.isHost, true);
  assert.equal(host.policy.kind, 'hybrid');
  assert.equal(host.policy.aiSeats, 2);
  assert.deepEqual([...room.caps], ['agents'], 'its hello said agents');
  assert.equal(host.skill.name, 'Steady', 'the server\'s level until a vote');
  await wait(20);
  assert.deepEqual([...room.caps].sort(), ['agents', 'skill'], 'reading the dial told the room (the play page offers the vote)');
  // A guide plays at the server's level; everyone else at the party's.
  host.roster([{ slot: 0, seat: 0, name: 'Ada', bot: false }, { slot: 1, seat: null, name: 'Wren · AI', bot: true, agent: { seat: null, role: 'guide', hands: 'host' } }, { slot: 2, seat: null, name: 'Moss · AI', bot: true, agent: { seat: null, role: 'party', hands: 'host' } }]);
  const p = make({ config: cfg({ name: 'Bo' }) });
  await wait(40);
  const votes = [];
  p.on('vote', (v) => votes.push(v));
  const policies = [];
  p.on('policy', (x) => policies.push(x));
  assert.equal(p.vote(5), true);
  await wait(20);
  assert.equal(host.vote(5), true);
  await wait(30);
  assert.equal(votes.at(-1).open, false);
  assert.equal(votes.at(-1).result.level, 5);
  assert.equal(policies.at(-1).skill.name, 'Maxed');
  assert.equal(host.skillOf(2).name, 'Maxed', 'a companion plays at the party\'s dial');
  assert.equal(host.skillOf(1).name, 'Steady', 'a guide at the server\'s level');
  // An agent's frame: its hello says so; the relay knows it from the Worker's word.
  const ai = make({ config: cfg({ name: 'Claude · AI', agent: { hands: 'self', role: 'party' } }) }, { agent: AGENT() });
  await wait(40);
  assert.equal(ai.asAgent, true);
  assert.equal(ai.seat, 7);
  assert.equal(ai.name, 'Claude · AI');
  assert.equal(ai.vote(1), false, 'an AI does not vote');
  assert.equal(host.isAgent(7), true);
  assert.equal(host.agents().length, 1);
  // Quiet AI: this browser does not hear the AI's speech; the others do.
  const heard = [];
  p.on('event', (e) => heard.push(e.k));
  p.hushed = true;
  host.send('say:hello', {}, undefined);
  ai.send('say:hi');
  await wait(30);
  // The AI's speech went to the host; the host relays it to everyone as its own (from the host's seat).
  host.send('say:relayed', {});
  await wait(30);
  assert.ok(heard.includes('say:relayed'), 'a person\'s (the host\'s) line is heard');
  room.tick();
});

test('netplay helper: an older relay says no policy: open, Fair, and nothing breaks', async (t) => {
  const { createNetplay } = await netplayModule();
  const { wait } = virtualTime(t);
  const { socket } = memoryRoom();
  const strip = socket();
  const n = createNetplay({ post: null, game: 'x', WebSocketImpl: strip, config: cfg() });
  t.after(() => n.close());
  await wait(40);
  assert.equal(n.policy.kind, 'open');
  assert.equal(n.skill.name, 'Fair');
  assert.equal(n.skillOf(0).name, 'Fair');
});

/* ------------------------------------------------------------------ the port kit */

test('BotBrain at the dial: it reacts reactionMs late and aims within aimNoise x 0.8', async () => {
  const { BotBrain, brainOf, jitter, engages, standoff } = await portModule();
  const measure = (level) => {
    const s = skillPreset(level);
    const b = new BotBrain({ skill: () => s, stuckMs: 1e9 });
    // The target flips side at t = 1000: how long until the stick follows?
    let target = { x: 100, y: 0 };
    let flipped = null;
    const angles = [];
    for (let t = 0; t <= 3000; t += 5) {
      if (t === 1000) { target = { x: -100, y: 0 }; b.target = null; }
      const v = b.think(t, { x: 0, y: 0 }, () => target);
      if (t > 1000 && flipped === null && v.x < 0) flipped = t - 1000;
      if (t < 1000 && t > s.reactionMs + 10 && (v.x || v.y)) angles.push(Math.atan2(v.y, v.x));
    }
    const spread = Math.max(...angles.map((a) => Math.abs(a)));
    return { flipped, spread, aimError: brainOf(s).aimError };
  };
  const rookie = measure(1);
  const maxed = measure(5);
  assert.ok(Math.abs(rookie.flipped - 650) <= 10, `Rookie reacts 650 ms late (measured ${rookie.flipped})`);
  assert.ok(Math.abs(maxed.flipped - 110) <= 10, `Maxed reacts 110 ms late (measured ${maxed.flipped})`);
  assert.ok(rookie.spread <= rookie.aimError / 2 + 1e-9 && rookie.spread > rookie.aimError / 4, `Rookie's aim errs up to ±${(rookie.aimError / 2).toFixed(3)} rad (widest ${rookie.spread.toFixed(3)})`);
  assert.ok(maxed.spread <= maxed.aimError / 2 + 1e-9, `Maxed barely errs (widest ${maxed.spread.toFixed(4)})`);
  assert.equal(brainOf(skillPreset(3)).commitMs, 2500, 'Fair commits as bots always did');
  assert.ok(Math.abs(jitter(skillPreset(5), 100)) <= 2);
  assert.equal(standoff(skillPreset(1), 50, 400), 400 - 350 * 0.1);
  let fights = 0;
  for (let i = 0; i < 100_000; i += 1) if (engages(skillPreset(5), 0.01)) fights += 1;
  assert.ok(fights > 800 && fights < 1000, `Maxed engages about 0.9 times a second (${fights / 1000}/s over 1000 s)`);
});
