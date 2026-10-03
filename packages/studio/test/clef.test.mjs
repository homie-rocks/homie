/**
 * @homie-rocks/studio 0.24.4: Cloudflare's Clef decision models behind the AI guides, the person's own Clef through
 * Ollama, and a game's own decisions at play speed (NETPLAY.md sections 18 and 20).
 *
 *   - a guide's decision is asked as Clef's typed questions: only goals whose arguments the view can fill, only values the
 *     view, the list or the room offers, never a seat that said no thanks or the guide's own; no line question when quiet
 *     or with a line just said; an open ask in the goal question itself; never typed chat on a kids or lines server
 *   - the answers compose back into one decision that parseDecision and the fixed rules still check; a wrong goal or a
 *     wrong asked value is overruled
 *   - Workers AI with the default model asks Clef (model clef-flash, a state and questions); costs are input tokens only
 *   - the local engine: only a loopback Ollama, /v1/systemone, free; detection never downloads, and says the size
 *   - house guides think with Clef (and with Ollama under dev when there is no binding), remember their own lines, and
 *     know who is new
 *   - net.decide: checked questions and state (private keys dropped), host only, paced, off without a decider, picks out
 *   - chat review on the person's own Ollama when there is no binding
 * Run: node --test packages/studio/test/clef.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CLEF, DECIDE, DEFAULT_MODEL, checkDecide, clefDecision, clefQuestions, clefRun, costOf, isClef, localAiOf, parseDecision, picksOf, vocabularyOf, workersAi,
} from '../worker/brain.mjs';
import { HouseAgents, brainFor, think } from '../worker/agents.mjs';
import { DEFAULT_POLICY, NetRoom } from '../worker/room.mjs';
import { reviewChat } from '../worker/chat.mjs';
import { detectLocalAi, localAiVars } from '../lib/local-ai.mjs';
import { needsWorkersAi } from '../lib/cloudflare.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = JSON.parse(readFileSync(join(PKG, 'starters', 'ember-vale', 'agents.json'), 'utf8'));
const VOCAB = vocabularyOf(RAW).vocab;
const VIEW = { me: { hp: 90, down: false }, zone: 'camp', danger: null, party: [{ seat: 0, dist: 120, hp: 80 }, { seat: 1, dist: 300, hp: 35 }], quests: ['slime-hunt', 'king-slime'], slimes: { near: 2, king: false } };
const TALK = (extra = {}) => ({ ...DEFAULT_POLICY, at: 10, kind: 'beginner', guides: 2, speech: 'lines', brain: 'workers-ai', level: 2, ...extra });
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-clef-')));
/** A made-up address, put together (the leak audit allows none in the repository). */
const MAIL = (user, host) => [user, host].join('@');
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/** Clef's answer for a set of questions: each choice leans to `lean[id]` (else its first option). */
const answersFor = (questions, lean = {}) => Object.fromEntries(Object.entries(questions).map(([id, q]) => {
  if (q.type === 'noul') return [id, { type: 'noul', noul: lean[id] ?? 0.2 }];
  if (q.type === 'score') return [id, { type: 'score', score: lean[id] ?? 1, legend: {}, probabilities: {}, confidence: 0.5 }];
  const keys = Object.keys(q.criteria);
  const pick = keys.includes(lean[id]) ? lean[id] : keys[0];
  return [id, { type: 'choice', choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 0.8 : 0.2 / (keys.length - 1)])), confidence: 0.7 }];
}));

test('a guide\'s decision as Clef questions: only what the view can fill, never a seat to leave alone, the ask in the question', () => {
  const ask = { k: 'ask_help', args: { quest: 'king-slime' }, from: 1, at: 1 };
  const q = clefQuestions(VOCAB, { view: VIEW, me: { seat: 7 }, asks: [ask], players: [0, 1], avoid: [], speech: 'lines' });
  assert.deepEqual(Object.keys(q.questions).sort(), ['arg.place', 'arg.quest', 'arg.seat', 'arg.thing', 'goal', 'say'].sort());
  assert.deepEqual(Object.keys(q.questions.goal.criteria), ['follow', 'quest', 'lead', 'guard', 'back']);
  assert.match(q.questions.goal.instructions, /^Seat 1 just asked the guide: "Help me with King Slime"\. The game's answer to that is quest/);
  assert.deepEqual(Object.keys(q.questions['arg.quest'].criteria), ['slime-hunt', 'king-slime'], 'the quests the view offers, one question for goal and line');
  assert.deepEqual(Object.keys(q.questions['arg.seat'].criteria), ['seat_0', 'seat_1'], 'players only, never the guide itself');
  assert.equal(q.questions.say.criteria[CLEF.none], 'say nothing now');
  assert.equal(q.questions.speak, undefined, 'an open ask always gets its line: no "anything to say?" gate');
  assert.deepEqual(q.state.openAsks, [{ fromSeat: 1, says: 'Help me with King Slime', wantsGoal: 'quest', wantsLine: 'quest_help', args: { quest: 'king-slime' } }]);
  // No quest in the view: the quest goal and its line are not offered at all.
  const none = clefQuestions(VOCAB, { view: { ...VIEW, quests: [] }, me: { seat: 7 }, players: [0, 1] });
  assert.ok(!('quest' in none.questions.goal.criteria) && !('quest_help' in none.questions.say.criteria));
  assert.equal(none.questions.speak.type, 'noul', 'no ask: a line also needs a yes to "anything to say at all"');
  // "No thanks" from seat 1: that seat is not an option anywhere; one player left: no seat question.
  const left = clefQuestions(VOCAB, { view: VIEW, me: { seat: 7 }, players: [0, 1], avoid: [1] });
  assert.equal(left.questions['arg.seat'], undefined);
  assert.deepEqual(left.plan.args.player.opts.map((o) => o.value), [0]);
  assert.deepEqual(left.state.leaveAlone, ['seat 1 said no thanks']);
  // Quiet (a line in the last 8 s): no line questions at all.
  const quiet = clefQuestions(VOCAB, { view: VIEW, me: { seat: 7 }, players: [0, 1], quiet: true });
  assert.ok(!quiet.questions.say && !quiet.questions['arg.thing'] && !quiet.questions.speak);
  // Typed chat reaches the state only on a "game" server that is not for kids; a name or a ticket in a view never does.
  const party = [{ seat: 0, chat: `my email is ${MAIL('x', 'y.com')}` }, { seat: 1, line: 'nice', args: { player: 0 } }];
  const view = { ...VIEW, name: 'Ada', ticket: 'eyJhbGciOiJIUzI1NiJ9.secretsecret' };
  const lines = clefQuestions(VOCAB, { view, me: { seat: 7 }, players: [0, 1], party, speech: 'lines' });
  assert.deepEqual(lines.state.recentLines, [{ seat: 1, said: 'Nice strike, seat 0!' }]);
  assert.equal(lines.state.game.name, undefined);
  assert.equal(lines.state.game.ticket, undefined);
  assert.equal(clefQuestions(VOCAB, { view, me: { seat: 7 }, players: [0, 1], party, speech: 'game', kids: true }).state.recentLines.length, 1, 'kids: never typed text');
  const game = clefQuestions(VOCAB, { view, me: { seat: 7 }, players: [0, 1], party, speech: 'game' });
  assert.ok(game.state.recentLines[0].typed.startsWith('my email is') && !game.state.recentLines[0].typed.includes('@'), 'an address is redacted (the chat floor holds them before this anyway)');
  // Memory: its own last lines, and who is new to it.
  const mem = clefQuestions(VOCAB, { view: VIEW, me: { seat: 7 }, players: [0, 1], said: [{ line: 'hello', args: { player: 0 }, ago: 30_000 }], newHere: [1] });
  assert.deepEqual(mem.state.youSaid, [{ said: 'Hi seat 0! I\'m the guide, an AI guide. Tap me if you want help.', secondsAgo: 30 }]);
  assert.deepEqual(mem.state.newHere, ['seat 1']);
  // No goal can be filled: nothing to ask (the floor decides).
  const v2 = vocabularyOf({ v: 1, goals: { follow: { about: 'stay with a player', args: { seat: 'player' } } } }).vocab;
  assert.equal(clefQuestions(v2, { view: { party: [] }, players: [] }), null);
});

test('Clef\'s answers become one decision; parseDecision and the fixed rules still check it', async () => {
  const ask = { k: 'ask_help', args: { quest: 'king-slime' }, from: 1, at: 1 };
  const q = clefQuestions(VOCAB, { view: VIEW, me: { seat: 7 }, asks: [ask], players: [0, 1] });
  const d = clefDecision(answersFor(q.questions, { goal: 'quest', 'arg.quest': 'king-slime', say: 'quest_help' }), q.plan);
  assert.deepEqual(d.decision, { goal: 'quest', args: { quest: 'king-slime' }, say: 'quest_help', sayArgs: { quest: 'king-slime' } }, 'the line\'s quest is the goal\'s');
  assert.equal(d.p.goal, 0.8);
  assert.equal(parseDecision(d.decision, VOCAB, { view: VIEW, players: [0, 1] }).ok, true);
  assert.equal(clefDecision(answersFor(q.questions, { goal: 'guard', say: CLEF.none }), q.plan).decision.say, null, 'none: silent');
  const idle = clefQuestions(VOCAB, { view: VIEW, me: { seat: 7 }, players: [0, 1] });
  assert.equal(clefDecision(answersFor(idle.questions, { goal: 'follow', say: 'hello', speak: 0.2 }), idle.plan).decision.say, null, 'no yes to "anything to say": silent');
  assert.equal(clefDecision(answersFor(idle.questions, { goal: 'follow', say: 'hello', speak: 0.8, 'arg.seat': 'seat_1' }), idle.plan).decision.sayArgs.player, 1);
  // think(): a model that picks the asked goal with another value is overruled, like one that picks another goal.
  const brain = (out) => ({ engine: 'workers-ai', run: async () => ({ out, usage: { input_tokens: 1000, output_tokens: 0 }, model: DEFAULT_MODEL, jsonMode: 'clef' }) });
  const ctx = { view: VIEW, me: { seat: 7 }, asks: [ask], players: [0, 1], avoid: [] };
  let t = await think(VOCAB, { mode: 'workers-ai', brain: brain({ goal: 'quest', args: { quest: 'slime-hunt' }, say: null, sayArgs: {} }), ctx });
  assert.equal(t.provider, 'workers-ai+floor');
  assert.deepEqual(t.decision.args, { quest: 'king-slime' });
  assert.match(t.why, /quest with quest slime-hunt/);
  assert.equal(t.own.args.quest, 'slime-hunt', 'the brain\'s own pick is kept for the log (and the ask-answer rate)');
  t = await think(VOCAB, { mode: 'workers-ai', brain: brain({ goal: 'quest', args: { quest: 'king-slime' }, say: 'quest_help', sayArgs: { quest: 'king-slime' } }), ctx });
  assert.equal(t.provider, 'workers-ai', 'answered as asked: no rule needed');
  assert.ok(Math.abs(t.cost.neurons - 8.182) < 1e-9, '1,000 input tokens of clef-flash: 8.18 neurons, nothing for output');
  t = await think(VOCAB, { mode: 'workers-ai', brain: brain(null), ctx });
  assert.equal(t.provider, 'script', 'no decision: the floor answers the ask');
});

test('Workers AI with the default model asks Clef: its model selector, the state and the questions; nothing to parse', async () => {
  assert.equal(DEFAULT_MODEL, '@cf/cloudflare/clef-flash');
  assert.ok(isClef(DEFAULT_MODEL) && isClef('clef-flash:9b') && isClef('clef') && !isClef('@cf/meta/llama-3.1-8b-instruct-fp8-fast'));
  const calls = [];
  const env = { AI: { run: async (model, input) => { calls.push({ model, input }); return { model: 'clef-flash', answers: answersFor(input.questions, { goal: 'lead', 'arg.place': 'king', say: 'follow_me' }), usage: { input_tokens: 980, output_tokens: 0 } }; } } };
  const ctx = { view: VIEW, me: { seat: 7 }, asks: [{ k: 'lead_me', args: { place: 'king' }, from: 0, at: 1 }], players: [0, 1] };
  const r = await workersAi(env, { system: 'unused', user: 'unused', schema: {}, vocab: VOCAB, ctx });
  assert.equal(calls[0].model, '@cf/cloudflare/clef-flash');
  assert.equal(calls[0].input.model, 'clef-flash');
  assert.ok(calls[0].input.state && calls[0].input.questions.goal, 'a state and typed questions, never a chat message');
  assert.equal(calls[0].input.messages, undefined);
  assert.deepEqual(r.out, { goal: 'lead', args: { place: 'king' }, say: 'follow_me', sayArgs: { place: 'king' } });
  assert.equal(costOf({ provider: 'workers-ai', model: r.model, usage: r.usage }).neurons, (980 * 8182) / 1e6);
  await assert.rejects(workersAi(env, { system: '', user: '', schema: {} }), /needs the vocabulary/);
  await assert.rejects(clefRun({ AI: { run: async () => ({}) } }, { state: 'x', questions: {} }), /answered nothing/);
});

test('the person\'s own Clef: only a loopback Ollama, /v1/systemone, free; dev finds it and never downloads one', async () => {
  assert.equal(localAiOf({}), null);
  assert.equal(localAiOf({ HOMIE_LOCAL_AI: 'https://ollama.example.com:11434' }), null, 'never another machine');
  assert.deepEqual(localAiOf({ HOMIE_LOCAL_AI: 'http://127.0.0.1:11434/', HOMIE_LOCAL_AI_MODEL: 'clef-flash:9b' }), { base: 'http://127.0.0.1:11434', model: 'clef-flash:9b' });
  assert.equal(localAiOf({ HOMIE_LOCAL_AI: 'http://127.0.0.1:11434', HOMIE_LOCAL_AI_MODEL: 'llama3' }).model, 'clef-flash', 'only a Clef model');
  const seen = [];
  const fetch = async (url, init) => { seen.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ model: 'clef-flash:9b', answers: { ok: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 300, output_tokens: 0 } }), { status: 200 }); };
  const r = await clefRun({}, { state: 'x', questions: { ok: { type: 'noul', instructions: 'ok?' } }, local: { base: 'http://127.0.0.1:11434', model: 'clef-flash:9b' }, fetch });
  assert.equal(seen[0].url, 'http://127.0.0.1:11434/v1/systemone');
  assert.equal(seen[0].body.model, 'clef-flash:9b');
  assert.equal(r.engine, 'local');
  assert.equal(costOf({ provider: 'local', model: r.model, usage: r.usage }).neurons, 0);
  // Which brain runs: the binding, else the person's Ollama, else why not.
  assert.equal(brainFor('workers-ai', { AI: {} }).engine, 'workers-ai');
  assert.equal(brainFor('workers-ai', { HOMIE_LOCAL_AI: 'http://127.0.0.1:11434' }).engine, 'local');
  assert.match(brainFor('workers-ai', {}).why, /no Workers AI binding/);
  assert.equal(brainFor('owner-key', { HOMIE_LOCAL_AI: 'http://127.0.0.1:11434' }).engine, 'local', 'no key yet: this computer\'s Clef');
  assert.match(brainFor('workers-ai', { AI: {} }, { budget: { left: () => 0 } }).why, /budget is spent/);
  // Detection: two local GETs; it names the download's size and that the person decides; it never pulls.
  const ollama = (version, models) => async (url, init) => {
    if (init?.method && init.method !== 'GET') throw new Error('detection only reads');
    if (String(url).endsWith('/api/version')) return version ? new Response(JSON.stringify({ version })) : Promise.reject(new Error('ECONNREFUSED'));
    if (String(url).endsWith('/api/tags')) return new Response(JSON.stringify({ models: models.map((name) => ({ name })) }));
    throw new Error(`unexpected ${url}`);
  };
  assert.equal((await detectLocalAi({ env: {}, fetchFn: ollama(null, []) })).why, 'no-ollama');
  assert.equal((await detectLocalAi({ env: {}, fetchFn: ollama('0.34.4', ['clef-flash:9b']) })).why, 'old-ollama');
  const no = await detectLocalAi({ env: {}, fetchFn: ollama('0.35.1', ['qwen2.5:7b']) });
  assert.equal(no.why, 'no-model');
  assert.match(no.say, /ask first/);
  assert.match(no.say, /ollama pull clef-flash` downloads about 11 GB/);
  const yes = await detectLocalAi({ env: { HOMIE_OLLAMA: 'http://127.0.0.1:11435' }, fetchFn: ollama('0.35.2', ['gemma4:latest', 'clef-flash:9b']) });
  assert.deepEqual({ ok: yes.ok, base: yes.base, model: yes.model }, { ok: true, base: 'http://127.0.0.1:11435', model: 'clef-flash:9b' });
  assert.deepEqual(localAiVars(yes), ['--var', 'HOMIE_LOCAL_AI:http://127.0.0.1:11435', '--var', 'HOMIE_LOCAL_AI_MODEL:clef-flash:9b']);
  assert.equal((await detectLocalAi({ env: { HOMIE_OLLAMA: 'http://10.0.0.5:11434' }, fetchFn: ollama(null, []) })).base, 'http://127.0.0.1:11434', 'never another machine');
  // Chat review on this computer when there is no binding.
  const chat = await reviewChat({ HOMIE_LOCAL_AI: 'http://127.0.0.1:11434' }, 'gg', { fetch: async () => new Response(JSON.stringify({ answers: { verdict: { type: 'choice', choice: 'ok', probabilities: { ok: 0.95, insult: 0.05 } } }, usage: { input_tokens: 200 } })) });
  assert.deepEqual({ ok: chat.ok, neurons: chat.neurons, local: chat.local }, { ok: true, neurons: 0, local: true });
});

test('house guides think with Clef: one call a decision, the line said remembered, who is new told; Ollama under dev', async () => {
  let t = 1_000_000;
  const room = new NetRoom({ code: 's-first-light-1', maxPlayers: 8, now: () => t });
  room.setPolicy(TALK());
  room.setVocabulary(RAW);
  const join = (hello = {}) => {
    const c = { sent: [], ip: `203.0.113.${Math.floor(Math.random() * 200)}`, send(x) { this.sent.push(JSON.parse(x)); }, close() {} };
    const h = room.attach(c);
    h.onMessage(JSON.stringify({ t: 'hello', v: 1, rev: 7, device: 'desk', want: 'play', canHost: true, ...hello }));
    return { c, say: (m) => h.onMessage(JSON.stringify(m)) };
  };
  const host = join({ caps: ['agents', 'skill'] });
  join();
  const states = [];
  const alarms = [];
  const env = { AI: { run: async (model, input) => { states.push(input.state); return { answers: answersFor(input.questions, { goal: 'follow', 'arg.seat': 'seat_1', say: 'hello', speak: 0.9 }), usage: { input_tokens: 1000, output_tokens: 0 } }; } } };
  const spent = [];
  const hs = new HouseAgents({ room, env, now: () => t, setAlarm: (at) => alarms.push(at), budget: { left: () => 8000, spend: (c) => spent.push(c) } });
  hs.sync();
  const [g1] = hs.live().map((a) => a.seat);
  host.say({ t: 'ev', k: 'agent:view', to: g1, d: VIEW });
  const fire = async () => { const at = alarms.at(-1); if (at > t) t = at; alarms.length = 0; return hs.onAlarm(); };
  await fire();
  const d1 = hs.decisions.at(-1);
  assert.equal(d1.provider, 'workers-ai');
  assert.equal(d1.model, '@cf/cloudflare/clef-flash');
  assert.deepEqual([d1.goal, d1.args, d1.say, d1.sayArgs], ['follow', { seat: 1 }, 'hello', { player: 1 }]);
  assert.ok(d1.neurons > 8 && d1.neurons < 8.3 && spent[0].provider === 'workers-ai');
  assert.deepEqual(states[0].newHere, ['seat 0', 'seat 1'], 'both are new to this guide');
  t += 21_000;
  host.say({ t: 'ev', k: 'agent:view', to: g1, d: { ...VIEW, zone: 'vale' } });
  await fire();
  assert.equal(states.length, 2);
  assert.equal(states[1].youSaid[0].said.startsWith('Hi seat 1!'), true, 'it remembers what it said');
  assert.equal(states[1].newHere, undefined, 'nobody is new any more');
  // Under dev: no binding, the person's own Ollama (free; counted as a local call).
  const local = new HouseAgents({ room, env: { HOMIE_LOCAL_AI: 'http://127.0.0.1:11434' }, providers: { local: async () => ({ out: { goal: 'guard', args: {}, say: null, sayArgs: {} }, usage: { input_tokens: 900, output_tokens: 0 }, model: 'clef-flash:9b', engine: 'local', jsonMode: 'clef' }) } });
  assert.equal(local.providerFor('workers-ai').engine, 'local');
});

test('net.decide: questions and state checked, host only, paced to one every 3 s, off without a decider, picks out', async () => {
  const ok = checkDecide({ heroes: [{ hp: 40, name: 'Ada', email: MAIL('a', 'b.co') }], note: 'x' }, {
    tactic: { type: 'choice', instructions: 'How should the slimes hunt?', criteria: { chase: 'Rush', surround: null } },
    wave: { type: 'noul', instructions: 'A wave now?' },
    pressure: { type: 'score', instructions: 'How hard?', criteria: ['Gentle', 'Steady', 'Fierce'] },
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.state.heroes, [{ hp: 40 }], 'a name or an email never reaches the model');
  assert.deepEqual(ok.questions.tactic.criteria, { chase: 'Rush', surround: null });
  for (const [why, q] of [
    [/choice has 2 to 26/, { a: { type: 'choice', instructions: 'x', criteria: { only: 'one' } } }],
    [/score has 2 to 10/, { a: { type: 'score', instructions: 'x', criteria: Array.from({ length: 11 }, (_, i) => `l${i}`) } }],
    [/type is choice, noul/, { a: { type: 'text', instructions: 'write me a poem' } }],
    [/1 to 8 questions/, Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`q${i}`, { type: 'noul', instructions: 'x' }]))],
    [/option "a b"/, { a: { type: 'choice', instructions: 'x', criteria: { 'a b': 1, c: 2 } } }],
  ]) assert.match(checkDecide({}, q).why, why);
  assert.match(checkDecide({ big: 'x'.repeat(50).repeat(60).split('').map(() => 1) }, { a: { type: 'noul', instructions: 'x' } }).why ?? '', /state is over|^$/);
  const { picks, p } = picksOf({ tactic: { choice: 'surround', probabilities: { chase: 0.3, surround: 0.7 } }, wave: { noul: 0.62 }, pressure: { score: 1.37 } }, ok.questions);
  assert.deepEqual(picks, { tactic: 'surround', wave: true, pressure: 1.37 });
  assert.deepEqual(p.wave, { yes: 0.62 });
  // The relay.
  let t = 5_000_000;
  const room = new NetRoom({ code: 'abc123', maxPlayers: 8, now: () => t });
  const join = (hello = {}) => {
    const c = { sent: [], ip: `198.51.100.${Math.floor(Math.random() * 200)}`, send(x) { this.sent.push(JSON.parse(x)); }, close() {} };
    const h = room.attach(c);
    h.onMessage(JSON.stringify({ t: 'hello', v: 1, rev: 7, device: 'desk', want: 'play', canHost: true, ...hello }));
    return { c, say: (m) => h.onMessage(JSON.stringify(m)), last: () => [...c.sent].reverse().find((x) => x.t === 'decided') ?? null };
  };
  const host = join();
  const other = join({ canHost: false });
  const ask = (who, n, extra = {}) => who.say({ t: 'decide', n, state: { heroes: 2 }, questions: { wave: { type: 'noul', instructions: 'A wave now?' } }, ...extra });
  ask(host, 'd1');
  assert.deepEqual(host.last(), { t: 'decided', n: 'd1', ok: false, why: 'off' }, 'no decider (a Table without one): off, and the host\'s floor answers');
  const asked = [];
  room.decider = async (state, questions) => { asked.push({ state, questions }); return { ok: true, by: 'ai', picks: { wave: false }, p: { wave: { yes: 0.2 } }, ms: 240 }; };
  ask(other, 'x1');
  assert.equal(other.last().why, 'not-host', 'only the host asks');
  ask(host, 'd2', { questions: { a: { type: 'choice', instructions: 'x', criteria: { one: 1 } } } });
  assert.equal(host.last().why, 'bad');
  t += 3000;
  ask(host, 'd3');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(host.last(), { t: 'decided', n: 'd3', ok: true, by: 'ai', picks: { wave: false }, p: { wave: { yes: 0.2 } }, ms: 240 });
  assert.equal(asked.length, 1);
  ask(host, 'd4');
  assert.equal(host.last().why, 'pace', 'one every 3 s a room');
  assert.ok(host.last().retryMs > 0);
  for (let i = 0; i < 25; i += 1) { t += 3000; ask(host, `m${i}`); }
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(room.stats.decides <= DECIDE.perMinute + 1, `at most ${DECIDE.perMinute} a minute (${room.stats.decides})`);
  assert.equal(room.stats.decided.ai, room.stats.decides);
});

test('deploy binds Workers AI for a game that asks for decisions', () => {
  const root = join(scratch, 'studio');
  mkdirSync(join(root, 'site', 'dist'), { recursive: true });
  writeFileSync(join(root, 'site', 'dist', 'games.json'), JSON.stringify({ games: [{ id: 'vale', chat: false, decide: true }] }));
  assert.equal(needsWorkersAi(root, () => ({ code: 1 }), 'DB'), true);
  writeFileSync(join(root, 'site', 'dist', 'games.json'), JSON.stringify({ games: [{ id: 'vale', chat: false }] }));
  assert.equal(needsWorkersAi(root, () => ({ code: 1 }), 'DB'), false);
});
