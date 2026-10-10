/** Slice 5: the real host and relay, with their clock advanced together. No browser ever hosts these rooms. */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { DEFAULT_POLICY } from '../worker/room.mjs';
import { PKG, esbuildOf, hostRig, loadGame, roomRig, writeGame } from './rules-kit.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-rules-features-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
import { vocab, source } from './rules-feature-kit.mjs';
let loaded;
async function game() {
  loaded ??= await loadGame(scratch, writeGame(scratch, 'features', { rules: source }), 'features');
  const L = loaded;
  return { L, c: L.R.compileRules(L.def, { settings: L.R.roomSettings({}).settings, seats: 4 }) };
}
const policy = (extra = {}) => ({ ...DEFAULT_POLICY, at: 20, kind: 'hybrid', aiSeats: 1, brain: 'workers-ai', ...extra });
const aiFacts = (hands = 'host') => ({ pass: 'abcdef0123', role: 'guide', hands, by: 'studio', name: 'Guide' });
const last = (c, t) => c.of(t).at(-1);
const snapEnt = (c, seat) => last(c, 'snap').d[1].find((e) => e[9] === seat);

async function room(options = {}) {
  const { L, c } = await game();
  const r = roomRig(L, c, { maxPlayers: 4, ...options });
  if (options.decider) r.room.decider = options.decider;
  r.room.setVocabulary(vocab);
  r.room.setPolicy(policy());
  const p = r.conn(); const welcome = p.hello('Player');
  r.run(100);
  return { ...r, p, welcome };
}

test('server seats, tokens, reconnects and waiting preserve the same body and never elect a browser', async () => {
  const r = await room();
  const before = snapEnt(r.p, 0)[0];
  assert.equal(r.welcome.host.id, 'server');
  assert.equal(r.welcome.role, 'replica');
  r.p.drop(); r.run(250);
  const p = r.conn(); const w = p.hello('Returned', { token: r.welcome.token });
  r.run(100);
  assert.equal(w.seat, 0);
  assert.equal(snapEnt(p, 0)[0], before);
  for (let i = 0; i < 2; i += 1) r.conn().hello('Player');
  const wait = r.conn(); assert.equal(wait.hello('Waiting').full, true);
  assert.equal(r.room.control('kick', { seat: 1 }).ok, true);
  r.run(300);
  assert.equal(last(wait, 'seat').seat, 1);
  assert.equal(r.room.hostId, null);
});

test('server guides floor on ticks, carry asks, save goals and finish them on the next tick', async () => {
  const { L, c } = await game();
  const h = hostRig(L, c); h.host.frame({ t: 'vocabulary', vocab }); h.host.frame({ t: 'policy', policy: policy() }); h.join(0); h.ticks(2);
  const bot = h.ents().find((e) => e.driver === 'ai');
  assert.equal(bot.fields[0], 1);
  assert.equal(bot.fields[2], 1);
  h.host.frame({ t: 'ev', from: 0, k: 'ask:follow', d: { slot: bot.seat, args: { seat: 0 } } });
  h.ticks();
  assert.equal(h.sent.filter((m) => m.k === 'agent:goal').at(-1).d.goal.goal, 'follow');
  const floorCount = h.ents().find((e) => e.seat === bot.seat).fields[0];
  h.ticks(40);
  assert.equal(h.ents().find((e) => e.seat === bot.seat).fields[0], floorCount);
  const restored = hostRig(L, c, { host: { restore: h.host.save() } });
  restored.host.frame({ t: 'vocabulary', vocab }); restored.host.frame({ t: 'policy', policy: policy() }); restored.join(0); restored.ticks();
  assert.equal(restored.ents().find((e) => e.seat === bot.seat).fields[2], 1);
  h.host.frame({ t: 'ev', from: bot.seat, k: 'cmd', d: ['done', {}] }); h.ticks(2);
  assert.ok(h.ents().find((e) => e.seat === bot.seat).fields[0] > floorCount);
});

test('guide roles follow reserved and admitted seats and survive host saves', async () => {
  const { L, c } = await game();
  const h = hostRig(L, c);
  const p = policy({ kind: 'beginner', aiSeats: 1, guides: 1, level: 5, skill: { level: 2 } });
  h.host.frame({ t: 'policy', policy: p }); h.join(0); h.ticks(2);
  assert.deepEqual(h.host.core.world.guideSeats, [3]);
  assert.equal(h.host.core.world.level, 2); assert.equal(h.host.core.world.guideLevel, 5);
  const restored = hostRig(L, c, { host: { restore: h.host.save() } });
  assert.deepEqual(restored.host.core.world.guideSeats, [3]);
  restored.host.frame({ t: 'policy', policy: p }); restored.join(0); restored.ticks();
  assert.deepEqual(restored.host.core.world.guideSeats, [3]);
  const r = await room();
  const a = r.conn({ agent: aiFacts() }); const w = a.hello('Guide', { agent: { hands: 'host', role: 'guide' } }); r.run(100);
  assert.deepEqual(r.host.core.world.guideSeats, [w.seat]);
});

test('held AI gets paced views, validated goals and lines, no snapshots, and humans-only removes it after the round', async () => {
  const r = await room();
  const a = r.conn({ agent: aiFacts() }); const w = a.hello('Guide', { agent: { hands: 'host', role: 'guide' } });
  assert.equal(w.seat, 3);
  r.run(2500);
  assert.equal(a.of('snap').length, 0);
  const views = a.of('ev').filter((m) => m.k === 'agent:view');
  assert.equal(views.length, 2);
  assert.equal(views[0].d.nearby, 7);
  a.say({ t: 'ev', k: 'agent:do', d: { goal: 'follow', args: { seat: 0 } } }); r.run(50);
  assert.equal(r.p.of('ev').filter((m) => m.k === 'agent:goal').at(-1).d.goal.from, 'brain');
  a.say({ t: 'ev', k: 'say:hello', d: {} }); r.run(50);
  assert.ok(r.p.of('ev').some((m) => m.k === 'say:hello' && m.d.ai));
  a.say({ t: 'ev', k: 'say:invented', d: {} }); r.run(50);
  assert.equal(r.p.of('ev').some((m) => m.k === 'say:invented'), false);
  r.room.control('policy', { pol: policy({ at: 30, kind: 'humans-only', bots: 'off' }) }); r.run(6500);
  assert.ok(!last(r.p, 'roster').slots.some(s => s.bot), 'bots off removes practice bodies');
  assert.ok(a.closed);
});

test('an AI with its own hands has authoritative input and acknowledgements', async () => {
  const r = await room(); const a = r.conn({ agent: aiFacts('self') });
  const w = a.hello('Guide', { agent: { hands: 'self', role: 'guide' } }); r.run(100);
  const s = last(a, 'snap'); const x = snapEnt(a, w.seat)[3][0];
  a.say({ t: 'in', e: s.e, k: s.k + 1, r: 0, s: [[0, -100]] }); r.run(100);
  assert.ok(snapEnt(a, w.seat)[3][0] < x);
  assert.ok(last(a, 'snap').c.find((row) => row[0] === w.seat)[2] >= s.k + 1);
});

test('world.ask gets one next-tick answer, falls back without AI, and ignores late or duplicate replies', async () => {
  const { L, c } = await game();
  for (const mode of ['check', 'off', 'no-ai', 'allowance', 'pace', 'slow', 'ai', 'local']) {
    const h = hostRig(L, c, { host: { check: mode === 'check' } }); h.join(0); h.ticks();
    const ask = h.sent.find((m) => m.t === 'decide');
    if (!['check', 'slow'].includes(mode)) h.host.frame({ t: 'decided', n: ask.n, ok: ['ai', 'local'].includes(mode), by: mode, why: mode, picks: { advance: false } });
    h.ticks(mode === 'slow' ? 105 : 2);
    const state = h.sent.filter((m) => m.t === 'state').at(-1);
    assert.ok(state, mode);
    const saved = L.P.fromBytes(h.host.save());
    assert.equal(saved.core.shared[0], 1, mode);
    assert.equal(saved.core.shared[1], ['ai', 'local'].includes(mode) ? 0 : 1, mode);
    if (ask) h.host.frame({ t: 'decided', n: ask.n, ok: true, picks: { advance: true } });
    h.ticks(); assert.equal(L.P.fromBytes(h.host.save()).core.shared[0], 1);
  }
});

test('server decisions use the relay decider and obsolete host replies cannot enter a replacement', async () => {
  let resolve;
  const r = await room({ decider: () => new Promise((r) => { resolve = r; }) });
  await Promise.resolve();
  assert.equal(typeof resolve, 'function');
  const old = r.host; const replacement = r.start();
  resolve({ ok: true, by: 'local', picks: { advance: false } });
  await new Promise((r) => setImmediate(r));
  r.run(100);
  assert.notEqual(replacement, old);
  assert.equal(r.room.stats.decides, 1);
});

test('watchers and the big screen get the server round, roster, speech and chat without taking a seat', async () => {
  const r = await room();
  const w = r.conn(); const welcome = w.hello('Watcher', { watch: true });
  assert.equal(welcome.seat, null); assert.equal(welcome.watch.follow, true);
  const screen = r.conn(); assert.equal(screen.hello('Screen', { want: 'screen' }).seat, null);
  r.p.say({ t: 'ev', k: 'say:wave', d: { wave: true } });
  assert.ok(w.of('ev').some((m) => m.k === 'say:wave'));
  w.say({ t: 'ev', k: 'say:cheer', d: {} });
  assert.ok(r.p.of('ev').some((m) => m.k === 'say:cheer'));
  w.say({ t: 'say', say: 'gg' });
  assert.equal(last(r.p, 'line').text, 'Good game!');
  r.p.say({ t: 'react', kind: 'fire' });
  assert.equal(last(screen, 'react').glyph, '🔥');
  r.run(4200);
  assert.ok(w.of('round').some((m) => Array.isArray(m.round.results)));
  assert.ok(welcome.roster.length);
  assert.ok(w.of('snap').length);
  assert.equal(r.host.core.stats.errors, 0);
});

test('the party votes on the server level; owner announcements, mutes, kicks and closure still apply', async () => {
  const r = await room(); const b = r.conn(); b.hello('Second');
  r.p.say({ t: 'vote', of: 'skill', n: 1 }); b.say({ t: 'vote', of: 'skill', n: 5 });
  assert.equal(last(b, 'vote').result.level, 1);
  r.run(100);
  assert.equal(snapEnt(b, 0)[7][4], 1);
  r.room.control('level', { level: 4 }); r.run(100);
  assert.equal(snapEnt(b, 0)[7][4], 4);
  assert.equal(r.room.control('announce', { text: 'Next round soon' }).ok, true);
  assert.equal(last(b, 'announce').text, 'Next round soon');
  r.room.control('mute', { seat: 1 }); b.say({ t: 'say', say: 'gg' });
  assert.equal(last(b, 'held').why, 'muted');
  r.room.control('mute', { seat: 1, off: true }); b.say({ t: 'say', say: 'gg' });
  assert.equal(last(r.p, 'line').text, 'Good game!');
  assert.equal(r.room.control('kick', { seat: 1 }).ok, true); assert.ok(b.closed);
  assert.equal(r.room.control('close').ok, true); assert.ok(r.p.closed);
  assert.equal(r.host.facts().running, false);
});

test('server decisions reply to the room and to the entity that asked; refusals and timeouts cannot double-answer', async () => {
  const r = await room({ decider: async () => ({ ok: true, by: 'local', picks: { advance: false } }) });
  await new Promise((r) => setImmediate(r)); r.run(100);
  assert.equal(r.host.core.save().shared[0], 1);
  assert.equal(r.host.core.save().shared[1], 0);
  r.run(3100);
  r.p.say({ t: 'ev', k: 'cmd', d: ['ask', {}] }); r.run(50);
  await new Promise((r) => setImmediate(r)); r.run(100);
  assert.equal(snapEnt(r.p, 0)[7][3], 1);
  assert.equal(r.room.stats.decides, 2);
  assert.equal(r.host.core.stats.errors, 0);
});

test('guide callbacks are bounded, their views cannot write, and a new holder never inherits an old goal', async () => {
  for (const [name, replacement] of [
    ['view-write', "self.floors = 99; return { nearby: 7, places: ['camp'] };"],
    ['view-loop', 'while (true) {}'],
  ]) {
    const L = await loadGame(scratch, writeGame(scratch, name, { rules: source.replace("return { nearby: 7, places: ['camp'] };", replacement) }), name);
    const c = L.R.compileRules(L.def, { seats: 4 });
    const h = hostRig(L, c); h.host.frame({ t: 'vocabulary', vocab }); h.host.frame({ t: 'policy', policy: policy() }); h.join(0); h.ticks(2);
    assert.ok(h.host.core.stats.errors > 0 || h.host.core.stats.budgetStops > 0, name);
    assert.ok(h.ents().every((e) => e.fields[0] !== 99), name);
    assert.ok(h.snap(), 'other bodies still receive snapshots');
    h.host.stop();
  }
  const { L, c } = await game(); const h = hostRig(L, c);
  h.host.frame({ t: 'vocabulary', vocab }); h.host.frame({ t: 'policy', policy: policy() }); h.join(0); h.ticks(2);
  const seat = h.ents().find((e) => e.driver === 'ai').seat;
  h.host.frame({ t: 'ev', from: 0, k: 'ask:follow', d: { slot: seat, args: { seat: 0 } } }); h.ticks();
  assert.equal(h.host.core.goal(seat).goal, 'follow');
  h.join(seat, 'Player'); h.ticks();
  assert.equal(h.host.core.goal(seat), null);
  assert.equal(h.host.core.stats.errors, 0);
});

test('invalid decision picks use the floor and saved pending decisions still answer once', async () => {
  const { L, c } = await game(); const h = hostRig(L, c); h.join(0); h.ticks();
  const q = h.sent.find((m) => m.t === 'decide');
  const back = hostRig(L, c, { host: { restore: h.host.save() } }); back.join(0);
  back.host.frame({ t: 'decided', n: q.n, ok: true, picks: { advance: 'invented' } }); back.ticks(2);
  assert.deepEqual(back.host.core.save().shared, [1, 1]);
  back.host.frame({ t: 'decided', n: q.n, ok: true, picks: { advance: false } }); back.ticks(2);
  assert.deepEqual(back.host.core.save().shared, [1, 1]);
});

test('chat review, moderation and history use the same server-hosted room', async () => {
  const r = await room(); const a = r.conn({ acct: true }); a.hello('Member');
  r.room.review = async () => ({ ok: false, by: 'ai', why: 'insult' });
  a.say({ t: 'say', text: 'you play like a potato' });
  await new Promise((r) => setImmediate(r));
  assert.equal(last(a, 'held').why, 'ai');
  assert.equal(r.p.of('line').length, 0);
  r.run(3000);
  r.room.review = async () => ({ ok: true, by: 'ai' });
  a.say({ t: 'say', text: 'nice dodge' }); await new Promise((r) => setImmediate(r));
  assert.equal(last(r.p, 'line').text, 'nice dodge');
  const heard = [];
  r.room.watch({ send: (text) => heard.push(JSON.parse(text)) });
  assert.ok(heard.some((m) => m.t === 'lines' && m.lines.some((l) => l.text === 'nice dodge')));
  assert.equal(r.host.core.stats.errors, 0);
});

test('the view offers ask buttons, sends an ask by body id and renders the server guide vocabulary', async (t) => {
  const { L, c } = await game();
  const file = join(scratch, 'feature-view.mjs');
  await (await esbuildOf()).build({ entryPoints: [join(PKG, 'rules/view.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent' });
  const { openRoom, setAgentFactory } = await import(pathToFileURL(file).href);
  const helperFile = join(scratch, 'feature-agents.mjs');
  await (await esbuildOf()).build({ entryPoints: [join(PKG, 'agents/agents.ts')], bundle: true, format: 'esm', outfile: helperFile });
  setAgentFactory((await import(pathToFileURL(helperFile).href)).useAgents);
  const r = roomRig(L, c, { maxPlayers: 4 });
  t.mock.timers.enable({ apis: ['Date'], now: r.clock.now() });
  r.room.setVocabulary(vocab); r.room.setPolicy(policy());
  class Socket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0;
      this.h = r.room.attach({ send: (data) => queueMicrotask(() => this.onmessage?.({ data })), close: () => this.close(), buffered: () => 0 });
      queueMicrotask(() => { this.readyState = 1; this.onopen?.({}); });
    }
    send(text) { this.h.onMessage(text); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.h.onClose(); }
  }
  const view = openRoom({ game: { id: 'features', schema: L.R.schemaOf(c), tune: {}, map: { bounds: { min: [-100, -100], max: [100, 100] } }, vocab }, timers: false, now: r.clock.now,
    net: { config: { v: 1, url: 'ws://relay/features/__net?room=r', room: 'r', device: 'desk', want: 'play', name: 'Player' }, WebSocketImpl: Socket, post: null } });
  t.after(() => { view.close(); r.host.stop(); });
  const said = []; const asks = []; const goals = [];
  view.on('say', (m) => said.push(m)); view.on('ask', (m) => asks.push(m)); view.on('goal', (m) => goals.push(m));
  await new Promise((r) => setImmediate(r)); r.run(100); await new Promise((r) => setImmediate(r));
  let bot;
  view.each('pawn', (e) => { if (e.driver === 'ai') bot = e; });
  assert.ok(bot);
  assert.ok(said.some((m) => m.text === 'Hello!'));
  const buttons = view.askButtons(bot.id);
  assert.ok(buttons.some((b) => b.k === 'follow'));
  assert.ok(buttons.some((b) => b.k === 'visit' && b.args.place === 'camp'));
  view.net.hushed = true;
  const count = said.length;
  r.room.hostFrame({ t: 'ev', k: 'say:hello', d: { slot: bot.seat, seat: null, ai: true, args: {} } });
  await new Promise((r) => setImmediate(r));
  assert.equal(said.length, count, 'Quiet AI hides the guide line');
  view.ask(bot.id, 'follow', { seat: view.seat }); r.run(100); await new Promise((r) => setImmediate(r));
  assert.equal(asks.at(-1).k, 'follow');
  assert.equal(goals.at(-1).goal.goal, 'follow');
  assert.equal(r.host.core.goal(bot.seat).asked, true);
  r.run(250); t.mock.timers.setTime(r.clock.now()); await new Promise(r => setImmediate(r)); view.pump();
  assert.equal(view.get(bot.id).goal.goal, 'follow');
  assert.deepEqual(view.askButtons(view.me.id), []);
});

test('guide floors share the tick budget, and only one game ask of a name can be open', async () => {
  const L = await loadGame(scratch, writeGame(scratch, 'floor-loop', { rules: source.replace('self.floors += 1;', 'while (true) { self.floors += 1; }') }), 'floor-loop');
  const c = L.R.compileRules(L.def, { seats: 4 });
  const bad = hostRig(L, c); bad.host.frame({ t: 'vocabulary', vocab }); bad.host.frame({ t: 'policy', policy: policy() }); bad.join(0); bad.ticks(2);
  assert.ok(bad.host.core.stats.budgetStops > 0);
  assert.equal(bad.host.facts().faults, 0);
  assert.ok(bad.snap()); bad.host.stop();
  const good = await game(); const h = hostRig(good.L, good.c); h.join(0); h.ticks(2);
  h.host.frame({ t: 'ev', from: 0, k: 'cmd', d: ['ask', {}] }); h.ticks();
  assert.equal(h.sent.filter((m) => m.t === 'decide').length, 1, 'the room already has this name open');
  const ask = h.sent.find((m) => m.t === 'decide');
  h.host.frame({ t: 'decided', n: ask.n, ok: false, why: 'off' }); h.ticks();
  h.host.frame({ t: 'ev', from: 0, k: 'cmd', d: ['ask', {}] }); h.ticks();
  assert.equal(h.sent.filter((m) => m.t === 'decide').length, 2, 'the next caller may ask once the first answer arrived');
});

for (const kind of ['open', 'humans-only', 'hybrid', 'beginner']) test(`policy ${kind}: only reserved bodies get goals; people never take them`, async () => {
  const { L, c } = await game(); const h = hostRig(L, c);
  h.host.frame({ t: 'vocabulary', vocab });
  h.host.frame({ t: 'policy', policy: policy({ kind, aiSeats: kind === 'hybrid' ? 2 : 0, guides: kind === 'beginner' ? 1 : 0 }) });
  h.join(0); h.ticks(2);
  const reserved = kind === 'hybrid' ? 2 : kind === 'beginner' ? 1 : 0;
  assert.equal(h.sent.filter(m => m.t === 'roster').at(-1).slots.filter(s => s.agent).length, reserved);
  const ids = h.ents().filter(e => e.driver === 'ai').map(e => e.id);
  h.join(1); h.ticks(2);
  assert.deepEqual(h.ents().filter(e => e.driver === 'ai').map(e => e.id), ids);
  h.host.frame({ t: 'leave', seat: 1 }); h.ticks(2);
  assert.equal(h.host.core.goal(1), null);
  assert.equal(h.ents().find(e => e.seat === 1).fields[0], 0);
});

test('a person and a watcher cannot mark relayed speech as a guide', async () => {
  const r = await room(); const w = r.conn(); w.hello('Watcher', { want: 'watch' });
  for (const sender of [r.p, w]) sender.say({ t: 'ev', k: 'say:hello', d: { ai: true, slot: 3, seat: 3, args: {} } });
  const forged = r.p.of('ev').filter(m => m.k === 'say:hello' && m.d?.ai === true);
  assert.equal(forged.length, 1, 'only the initial real guide line');
});

for (const floor of ['throw new Error("no")', 'return undefined', 'return { advance: "wrong" }']) test(`a failed decision floor settles once: ${floor}`, async () => {
  const L = await loadGame(scratch, writeGame(scratch, `bad-floor-${floor.length}`, { rules: source.replace('return { advance: state.danger < 2 };', floor) }), `bad-floor-${floor.length}`);
  const h = hostRig(L, L.R.compileRules(L.def, { seats: 4 })); h.join(0); h.ticks();
  const ask = h.sent.find(m => m.t === 'decide'); h.host.frame({ t: 'decided', n: ask.n, ok: false }); h.ticks(20);
  assert.equal(h.host.core.save().asks.length, 0);
  assert.equal(h.host.core.stats.errors, 1);
  assert.equal(h.host.core.save().shared[0], 1, 'a failed floor still delivers one answer');
  h.host.frame({ t: 'ev', from: 0, k: 'cmd', d: ['ask', {}] }); h.ticks();
  assert.equal(h.sent.filter(m => m.t === 'decide').length, 2);
});

test('the core rejects inherited goal ids and wrong arguments at its own boundary', async () => {
  const { L, c } = await game(); const h = hostRig(L, c); h.join(3, 'Helper', { agent: aiFacts() }); h.ticks();
  h.host.frame({ t: 'vocabulary', vocab });
  for (const goal of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    h.host.core.goal(3, { goal, args: {}, from: 'brain', at: 1 });
    assert.equal(h.host.core.goal(3), null, goal);
  }
  h.host.core.goal(3, { goal: 'follow', args: { seat: {} }, from: 'brain', at: 1 });
  assert.equal(h.host.core.goal(3), null);
});

test('decision reasons are bounded words before an answer handler reads them', async () => {
  const rules = source.replace('answers: f.u16(), yes: f.bit()', 'answers: f.u16(), yes: f.bit(), badWhy: f.bit()').replace('world.shared.answers += 1;', "world.shared.badWhy = typeof e.why !== 'string' || e.why.length > 32; world.shared.answers += 1;");
  const L = await loadGame(scratch, writeGame(scratch, 'why-bound', { rules }), 'why-bound');
  for (const why of [{ bad: 1 }, 'x'.repeat(1000000), '__proto__']) {
    const h = hostRig(L, L.R.compileRules(L.def, { seats: 4 })); h.join(0); h.ticks();
    const ask = h.sent.find(m => m.t === 'decide'); h.host.frame({ t: 'decided', n: ask.n, ok: false, why }); h.ticks(2);
    assert.deepEqual(h.host.core.save().shared, [1, 1, 0]); assert.equal(h.host.core.stats.errors, 0);
  }
});

test('a guide view cannot emit an effect', async () => {
  const rules = source.replace('shapes: { view:', "shapes: { effects: { puff: {} }, view:").replace("return { nearby: 7, places: ['camp'] };", "world.emit('puff', self.pos); return { nearby: 7, places: ['camp'] };");
  const L = await loadGame(scratch, writeGame(scratch, 'view-effect', { rules }), 'view-effect');
  const h = hostRig(L, L.R.compileRules(L.def, { seats: 4 })); h.host.frame({ t: 'vocabulary', vocab }); h.host.frame({ t: 'policy', policy: policy() }); h.join(0); h.ticks(50);
  assert.equal(h.sent.filter(m => m.k === 'fx').length, 0); assert.match(h.host.core.stats.lastError, /world.emit is for handlers/);
});

for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) test(`inherited vocabulary id ${id} is refused for AI, floors and player asks`, async () => {
  const r = await room(); const a = r.conn({ agent: aiFacts() }); a.hello('Helper', { agent: { hands: 'host', role: 'guide' } }); r.run(2100);
  const before = r.host.core.goal(3); const asks = r.p.of('ev').filter(m => m.k === 'agent:ask').length;
  a.say({ t: 'ev', k: 'agent:do', d: { goal: id, args: {} } }); a.say({ t: 'ev', k: `say:${id}`, d: { args: {} } });
  r.p.say({ t: 'ev', k: `ask:${id}`, d: { slot: 3, args: {} } }); r.run(100);
  assert.deepEqual(r.host.core.goal(3), before); assert.equal(r.p.of('ev').filter(m => m.k === 'agent:ask').length, asks); assert.equal(r.p.of('ev').filter(m => m.k === `say:${id}`).length, 0);
  const rules = source.replace("{ goal: 'guard', say: 'hello' }", `{ goal: '${id}', say: '${id}' }`);
  const L = await loadGame(scratch, writeGame(scratch, `proto-${id}`, { rules }), `proto-${id}`); const h = hostRig(L, L.R.compileRules(L.def, { seats: 4 }));
  h.host.frame({ t: 'vocabulary', vocab }); h.host.frame({ t: 'policy', policy: policy() }); h.join(0); h.ticks(2);
  assert.equal(h.host.core.goal(3), null); assert.equal(h.sent.filter(m => m.k === `say:${id}`).length, 0);
});

test('replacing a socket keeps its body; a kicked token cannot return', async () => {
  const r = await room(); const id = r.host.core.bodyOf(0).id;
  const p = r.conn(); p.hello('Returned', { token: r.welcome.token }); r.run(100);
  assert.equal(r.p.closed[1], 'replaced'); assert.equal(r.host.core.bodyOf(0).id, id);
  r.room.control('kick', { seat: 0 }); const back = r.conn(); back.hello('Returned', { token: r.welcome.token });
  assert.ok(back.closed || back.of('err').length);
});

test('a kind with think but no guide does not advertise agents', async () => {
  const rules = source.replace(/    guide: .*\n/, ''); const L = await loadGame(scratch, writeGame(scratch, 'no-guide', { rules }), 'no-guide');
  const h = hostRig(L, L.R.compileRules(L.def, { seats: 4 })); h.join(0); h.ticks();
  assert.ok(!h.sent.find(m => m.t === 'caps').caps.includes('agents'));
});

test('a held guide whose floor declines an ask is attempted once and then paced', async () => {
  const rules = source.replace("return ask ? { goal: ask.k, args: ask.args } : { goal: 'guard', say: 'hello' };", "return { goal: 'guard' };");
  const L = await loadGame(scratch, writeGame(scratch, 'decline-floor', { rules }), 'decline-floor'); const h = hostRig(L, L.R.compileRules(L.def, { seats: 4 }));
  h.host.frame({ t: 'vocabulary', vocab }); h.join(0); h.join(3, 'Helper', { agent: aiFacts() }); h.ticks(2);
  h.host.frame({ t: 'ev', from: 0, k: 'ask:follow', d: { slot: 3, args: { seat: 0 } } }); h.ticks(200);
  assert.ok(h.ents().find(e => e.seat === 3).fields[0] <= 9);
  const saved = L.P.fromBytes(h.host.save()); assert.equal(saved.agents.askAt.length, 0);
});

test('saved goals, asks and policy are validated before a rules callback reads them', async () => {
  const { L, c } = await game(); const h = hostRig(L, c); h.host.frame({ t: 'vocabulary', vocab }); h.host.frame({ t: 'policy', policy: policy() }); h.join(0); h.ticks(2);
  const saved = L.P.fromBytes(h.host.save());
  saved.agents.goals = [[3, { goal: 'constructor', args: {}, state: 'active', asked: false, at: 0 }]];
  saved.agents.asks = [[3, [{ k: 'constructor', args: {}, from: 0, at: 0 }]]];
  saved.core.ents.find(e => e[11] === 3)[15] = { goal: 'constructor', args: {} };
  saved.core.asks[0].state = { danger: { bad: true } };
  const validPolicy = saved.core.policy;
  saved.core.policy = { reserved: 999999999, level: 999, levelMax: 999, bots: 'invalid' };
  assert.throws(() => hostRig(L, c, { host: { restore: L.P.toBytes(saved) } }), /saved (rules state|host inputs) are invalid|saved rules state is invalid/);
  saved.core.policy = validPolicy;
  assert.throws(() => hostRig(L, c, { host: { restore: L.P.toBytes(saved) } }), /saved (rules state|host inputs) are invalid|saved rules state is invalid/);
});

test('malformed goal and line identifiers never fault the host', async () => {
  const r = await room(); const a = r.conn({ agent: aiFacts() }); a.hello('Helper', { agent: { hands: 'host', role: 'guide' } }); r.run(2100);
  for (const goal of [null, 1, [], { toString: null, valueOf: null }]) { a.say({ t: 'ev', k: 'agent:do', d: { goal, args: {} } }); r.run(3100); }
  assert.equal(r.host.facts().faults, 0); assert.notEqual(r.host.core.goal(3)?.from, 'brain');
});

test('server speech respects oversize, flood and mute limits', async () => {
  const r = await room(); const p = r.conn(); const w = p.hello('Player'); r.run(100);
  p.say({ t: 'ev', k: 'chat:line', d: { text: 'x'.repeat(5000) } }); assert.ok(p.of('error').some(e => e.code === 'too-large'));
  r.room.control('mute', { seat: w.seat, minutes: 1 }); const count = r.p.of('ev').filter(e => e.k === 'say:hello').length;
  p.say({ t: 'ev', k: 'say:hello', d: {} }); assert.equal(r.p.of('ev').filter(e => e.k === 'say:hello').length, count);
  const spam = r.conn(); spam.hello('Player'); for (let i = 0; i < 200; i++) spam.say({ t: 'ev', k: 'say:hello', d: {} }); assert.equal(spam.closed[1], 'flood');
});

test('packed player snapshots include the validated active goal', async () => {
  const { L, c } = await game(); const h = hostRig(L, c); h.host.frame({ t: 'vocabulary', vocab }); h.join(0); h.join(3, 'Helper', { agent: aiFacts() }); h.ticks(2);
  const wire = h.snap().d[1].find(w => w[9] === 3);
  assert.deepEqual(L.P.unpackEntity(L.R.schemaOf(c).kinds, wire, c.dims).goal, h.host.core.goal(3));
  assert.equal(L.P.unpackEntity(L.R.schemaOf(c).kinds, wire.slice(0, 13), c.dims).goal, null);
});

test('restoring before every tick preserves guide views, goals and floor timing', async () => {
  const rules = source.replace('nearby: 7, places:', 'nearby: self.goal ? 2 : 1, places:').replace('self.floors += 1;', 'self.floors += v.nearby;');
  const L = await loadGame(scratch, writeGame(scratch, 'guide-restore', { rules }), 'guide-restore'); const c = L.R.compileRules(L.def, { seats: 4 });
  const make = restore => { const h = hostRig(L, c, { host: { restore } }); h.host.frame({ t: 'vocabulary', vocab }); h.host.frame({ t: 'policy', policy: policy() }); h.join(0); return h; };
  const a = make(); let b = make();
  for (let i = 0; i < 25; i++) { a.ticks(); b.ticks(); const saved = b.host.save(); b.host.stop(); b = make(saved); }
  assert.deepEqual(b.host.core.save().ents, a.host.core.save().ents); assert.deepEqual(L.P.fromBytes(b.host.save()).agents, L.P.fromBytes(a.host.save()).agents);
});

test('client frames cannot change server policy, peer identity or decision answers', async () => {
  const r = await room(); const state = r.host.core.save(); const pol = JSON.stringify(r.room.policy);
  for (const t of ['policy', 'vocabulary', 'decided', 'roster', 'round', 'ctl', 'join', 'free']) r.p.say({ t, policy: policy({ aiSeats: 3 }), vocab, n: 'fake', ok: true, picks: { advance: true }, peer: { seat: 0, agent: aiFacts() }, op: 'level', args: { level: 5 }, slots: [] });
  assert.equal(JSON.stringify(r.room.policy), pol); assert.deepEqual(r.host.core.save(), state); assert.equal(r.host.core.bodyOf(0).driver, 'person');
});

for (const asks of ['nope', [null], [{ name: 'director', n: 'broken', at: 'later', state: {} }]]) test(`damaged saved asks ${JSON.stringify(asks)} cannot stop a room`, async () => {
  const { L, c } = await game(); const h = hostRig(L, c); h.join(0); h.ticks(2);
  const saved = L.P.fromBytes(h.host.save()); saved.core.asks = asks;
  assert.throws(() => hostRig(L, c, { host: { restore: L.P.toBytes(saved) } }), /saved rules state is invalid/);
});

test('a rejected restored carried goal cannot suppress a valid floor for sixty seconds', async () => {
  const { L, c } = await game(); const h = hostRig(L, c); h.host.frame({ t: 'vocabulary', vocab }); h.host.frame({ t: 'policy', policy: policy() }); h.join(0); h.ticks(2);
  const saved = L.P.fromBytes(h.host.save());
  saved.agents.goals = [[3, { goal: 'visit', args: { place: 'unoffered' }, state: 'active', from: 'floor', asked: true, at: 0 }]];
  const back = hostRig(L, c, { host: { restore: L.P.toBytes(saved) } }); back.host.frame({ t: 'vocabulary', vocab }); back.host.frame({ t: 'policy', policy: policy() }); back.join(0); back.ticks(2);
  assert.equal(back.host.core.goal(3)?.goal, 'guard');
});

for (const from of ['answer', 'floor']) test(`fractional score from ${from} is refused`, async () => {
  const rules = source.replace('yes: f.bit()', 'yes: f.u8()').replace("{ type: 'noul', instructions: 'Advance?' }", "{ type: 'score', instructions: 'Advance?', criteria: ['No', 'Maybe', 'Yes'] }").replace('world.shared.yes = e.picks.advance', 'world.shared.yes = e.picks.advance * 10').replace('advance: state.danger < 2', `advance: ${from === 'floor' ? '1.5' : '0'}`);
  const L = await loadGame(scratch, writeGame(scratch, `fraction-${from}`, { rules }), `fraction-${from}`); const c = L.R.compileRules(L.def, { seats: 4 }); const h = hostRig(L, c); h.join(0); h.ticks();
  const q = h.sent.find(m => m.t === 'decide'); h.host.frame({ t: 'decided', n: q.n, ok: from === 'answer', picks: { advance: 1.5 } }); h.ticks(2);
  assert.equal(h.host.core.save().shared[1], 0); assert.equal(h.host.core.save().shared[0], 1); assert.equal(h.host.core.stats.errors, from === 'floor' ? 1 : 0);
});

for (const value of ['nope', [null]]) test(`damaged saved guide tables ${JSON.stringify(value)} cannot stop a room`, async () => {
  const { L, c } = await game(); const h = hostRig(L, c); h.host.frame({ t: 'vocabulary', vocab }); h.host.frame({ t: 'policy', policy: policy() }); h.join(0); h.ticks(2);
  const saved = L.P.fromBytes(h.host.save()); saved.core.guideViews = value; saved.guideViews = value;
  for (const k of Object.keys(saved.agents)) saved.agents[k] = value;
  assert.throws(() => hostRig(L, c, { host: { restore: L.P.toBytes(saved) } }), /saved host inputs are invalid/);
});

test('server capacity comes from the build even after an older room save', async () => {
  const r = await room();
  const saved = r.room.saved(); saved.maxPlayers = 2;
  r.room.restore(saved); assert.equal(r.room.maxPlayers, 4);
  r.room.askedMax = 2; r.room.setSeats(4); assert.equal(r.room.maxPlayers, 4);
});

test('whole host saves preserve pending decisions, companion pacing and reserved names', async () => {
  const { L, c } = await game(); const h = hostRig(L, c);
  h.host.frame({ t: 'vocabulary', vocab }); h.host.frame({ t: 'policy', policy: policy({ kind: 'beginner', guides: 1, aiSeats: 1 }) });
  h.join(0); h.ticks(2);
  h.host.frame({ t: 'ev', from: 0, k: 'ask:follow', d: { slot: 3, args: { seat: 0 } } }); h.ticks();
  const saved = L.P.fromBytes(h.host.save()); assert.ok(saved.core.asks.length); assert.ok(saved.agents.sayAt.length); assert.ok(saved.guideViews.length);
  const back = hostRig(L, c, { host: { restore: h.host.save(), restoreEpoch: h.host.epoch + 1 } });
  assert.deepEqual(L.P.fromBytes(back.host.save()).core.ents.map(e => e[15]), saved.core.ents.map(e => e[15]), 'saving before vocabulary arrives retains the deferred goals');
  back.host.frame({ t: 'vocabulary', vocab }); back.host.frame({ t: 'policy', policy: policy({ kind: 'beginner', guides: 1, aiSeats: 1 }) });
  const restored = L.P.fromBytes(back.host.save());
  assert.deepEqual(restored.agents, saved.agents); assert.deepEqual(restored.core.asks, saved.core.asks); assert.deepEqual(restored.guideViews, saved.guideViews);
  assert.deepEqual(restored.core.ents.filter(e => e[13] === 'reserved'), saved.core.ents.filter(e => e[13] === 'reserved'));
  back.join(0); back.ticks(); h.ticks();
  assert.deepEqual(back.host.core.save().ents.filter(e => e[13] === 'reserved'), h.host.core.save().ents.filter(e => e[13] === 'reserved'));
  assert.deepEqual(back.sent.filter(m => m.t === 'roster').at(-1).slots, h.sent.filter(m => m.t === 'roster').at(-1).slots);
  h.host.stop(); back.host.stop();
});

test('saved answers must satisfy the same questions as live decisions', async () => {
  const { L, c } = await game(); const h = hostRig(L, c); h.join(0); h.ticks(2);
  const saved = h.host.core.save();
  saved.queue.push([saved.tick + 1, 0, '', 1, '', 'room', 'answer', { ask: 'director', by: 'ai', picks: { advance: 'forged' } }, saved.tick, 1]);
  assert.throws(() => L.C.createCore(c, { restore: saved }), /saved answer/);
});

test('handover keeps the same holder input and a different holder clears it', async () => {
  const { L, c } = await game(); const h = hostRig(L, c); h.join(0); h.ticks(2);
  h.host.frame({ t: 'in', from: 0, e: h.host.epoch, k: h.host.tick + 1, r: 0, s: [[0, 70]] }); h.ticks();
  const save = h.host.save();
  const same = hostRig(L, c, { host: { restore: save, restoreEpoch: 99 } }); same.join(0); same.ticks();
  assert.ok(same.ents()[0].pos.x > h.ents()[0].pos.x);
  assert.equal(L.P.fromBytes(same.host.save()).queues[0][1].ax, 70);
  const other = hostRig(L, c, { host: { restore: save, restoreEpoch: 100 } }); other.join(0, 'New', { occ: 999 }); other.ticks();
  assert.equal(L.P.fromBytes(other.host.save()).queues.length, 0);
});


test('a queued AI answer keeps the absence of a refusal reason on restore', async () => {
  const { L, c } = await game(); const h = hostRig(L, c); h.join(0); h.ticks(2);
  const saved = h.host.core.save();
  const answer = { ask: 'director', by: 'ai', picks: { advance: true } };
  saved.queue.push([saved.tick + 1, 0, '', 1, '', 'room', 'answer', answer, saved.tick, 1]);
  const restored = L.C.createCore(c, { restore: saved });
  assert.deepEqual(restored.save().queue.find(q => q[6] === 'answer')[7], answer);
  h.host.stop();
});

for (const rules of [false, true]) test(`relay speech stamps are authoritative with rules=${rules}`, async () => {
  const { L, c } = await game(); const r = roomRig(L, c, { maxPlayers: 4, roomOpts: { rules } });
  r.host.stop(); r.room.setServerHost(null);
  const a = r.conn(); a.hello('First', { rules, rev: 11 });
  const b = r.conn(); b.hello('Second', { rules, rev: 11 });
  const other = r.conn(); other.hello('Third', { rules, rev: 11 });
  b.say({ t: 'ev', k: 'say', from: 99, d: { text: 'Second spoke' } });
  const incoming = a.of('ev').at(-1); assert.equal(incoming.from, 1);
  a.say({ ...incoming, rules });
  assert.equal(other.of('ev').at(-1).from, rules ? 1 : 0);
  a.say({ t: 'ev', rules, k: 'say', from: 99, d: { text: 'No live holder' } });
  assert.equal(other.of('ev').at(-1).from, rules ? null : 0);
  a.drop(); b.drop(); other.drop();
});

test('slow-host handover needs a recent and measurably faster candidate', async () => {
  const { L, c } = await game(); const r = roomRig(L, c, { maxPlayers: 4, roomOpts: { rules: true } });
  r.host.stop(); r.room.setServerHost(null);
  const a = r.conn(); const aw = a.hello('First', { rules: true, rev: 11 });
  const b = r.conn(); const bw = b.hello('Second', { rules: true, rev: 11 });
  b.say({ t: 'ping', readySpeed: 0.1 }); a.say({ t: 'yield', slow: true, speed: 0.1 });
  assert.equal(r.room.hostId, aw.id);
  b.say({ t: 'ping', readySpeed: 1 }); a.say({ t: 'yield', slow: true, speed: 0.1 });
  assert.equal(r.room.hostId, bw.id);
  a.say({ t: 'ping', readySpeed: 1 }); b.say({ t: 'yield', slow: true, speed: 0.1 });
  assert.equal(r.room.hostId, bw.id, 'the former host measured equally slow cannot reclaim the role');
  a.drop(); b.drop();
});

test('a rules host whose yield elects nobody is told it keeps the role, and a page before revision 11 never hosts', async () => {
  const { L, c } = await game(); const r = roomRig(L, c, { maxPlayers: 4, roomOpts: { rules: true } });
  r.host.stop(); r.room.setServerHost(null);
  const old = r.conn(); const ow = old.hello('Old', { rules: true, rev: 10 });
  assert.equal(ow.role, 'replica', 'its unmarked output would be taken for a player\'s'); assert.equal(r.room.hostId, null);
  const a = r.conn(); const aw = a.hello('First', { rules: true, rev: 11 });
  assert.equal(aw.role, 'host');
  a.say({ t: 'yield' });
  assert.equal(r.room.hostId, aw.id, 'the old page is no candidate');
  const kept = (page) => page.of('host').filter(m => m.why === 'host-kept').map(m => m.host?.id);
  assert.deepEqual(kept(a), [aw.id]); assert.equal(a.of('role').length, 0);
  assert.deepEqual(kept(old), [aw.id], 'the others, told a moment ago that nobody hosts, are told who does');
  a.say({ t: 'yield', slow: true, speed: 0.1 });
  assert.deepEqual(kept(a), [aw.id, aw.id]);
  const b = r.conn(); const bw = b.hello('Second', { rules: true, rev: 11 });
  a.say({ t: 'yield' });
  assert.equal(r.room.hostId, bw.id); assert.equal(a.of('role').at(-1).role, 'replica');
  assert.equal(kept(a).length, 2, 'a yield that moved the role is answered by the role alone');
  old.drop(); a.drop(); b.drop();
});

test('rules relay caps count encoded bytes, including multibyte state', async () => {
  const { L, c } = await game(); const r = roomRig(L, c, { maxPlayers: 4, roomOpts: { rules: true } });
  r.host.stop(); r.room.setServerHost(null);
  const a = r.conn(); a.hello('First', { rules: true, rev: 11 });
  const b = r.conn(); b.hello('Second', { rules: true, rev: 11 });
  const frame = { t: 'state', rules: true, k: 'shared', d: '界'.repeat(3000) };
  const bytes = Buffer.byteLength(JSON.stringify(frame));
  assert.ok(bytes > 8192 && JSON.stringify(frame).length < 8192);
  a.say(frame);
  assert.ok(a.of('error').some(e => e.code === 'too-large' && e.message.includes(`${bytes} B`)));
  assert.ok(b.of('error').some(e => e.code === 'room-over'));
  a.drop(); b.drop();
});

test('rules roster identities and guide roles come from held seats and policy', async () => {
  const { L, c } = await game(); const r = roomRig(L, c, { maxPlayers: 4, roomOpts: { rules: true } });
  r.host.stop(); r.room.setServerHost(null);
  r.room.setPolicy(policy({ kind: 'beginner', aiSeats: 1, guides: 1 }));
  const a = r.conn(); a.hello('First', { rules: true, rev: 11 });
  a.say({ t: 'roster', rules: true, slots: [
    { slot: 0, seat: null, bot: true, name: 'First', agent: { role: 'guide' } },
    { slot: 1, seat: null, bot: true, name: 'Bot', agent: { role: 'guide' } },
    { slot: 2, seat: null, bot: true, name: 'Companion' },
    { slot: 3, seat: 3, bot: true, name: 'Guide', agent: { role: 'party' } },
  ] });
  const rows = r.room.lastRoster;
  assert.equal(rows[0].bot, false); assert.equal(rows[0].seat, 0); assert.equal(rows[0].agent, undefined);
  assert.equal(rows[1].agent, undefined);
  assert.equal(rows[2].agent?.role, 'party'); assert.match(rows[2].name, /AI/);
  assert.equal(rows[3].agent?.role, 'guide');
  a.drop();
});

test('the rules catalogue fixes browser room capacity before hello and after restore', async () => {
  const { L, c } = await game(); const r = roomRig(L, c, { maxPlayers: 4, roomOpts: { rules: true } });
  r.host.stop(); r.room.setServerHost(null);
  const a = r.conn(); a.hello('First', { rules: true, rev: 11, max: 2 });
  assert.equal(r.room.maxPlayers, 4);
  const saved = r.room.saved(); saved.maxPlayers = 2;
  r.room.restore(saved); assert.equal(r.room.maxPlayers, 4);
  r.room.askedMax = 2; r.room.setSeats(4); assert.equal(r.room.maxPlayers, 4);
  a.drop();
});


test('fractional round and break durations restore at every tick', async () => {
  const { L, c } = await game();
  const compiled = { ...c, rounds: { seconds: 0.08, breakSeconds: 0.17 } };
  let core = L.C.createCore(compiled);
  const uninterrupted = L.C.createCore(compiled);
  for (let tick = 0; tick < 40; tick++) {
    core = L.C.createCore(compiled, { restore: core.save() });
    core.step(); uninterrupted.step();
    assert.deepEqual(core.snapshot(), uninterrupted.snapshot());
  }
});

test('a restored goal targeting a temporarily away person cannot fault server recovery', async () => {
  const { L, c } = await game(); const h = hostRig(L, c);
  h.host.frame({ t: 'vocabulary', vocab }); h.host.frame({ t: 'policy', policy: policy() }); h.join(0); h.ticks(2);
  h.host.frame({ t: 'ev', from: 0, k: 'ask:follow', d: { slot: 3, args: { seat: 0 } } }); h.ticks(2);
  assert.equal(h.host.core.goal(3)?.goal, 'follow');
  const restored = hostRig(L, c, { host: { restore: h.host.save(), restoreEpoch: 99 } });
  restored.host.frame({ t: 'vocabulary', vocab }); restored.host.frame({ t: 'policy', policy: policy() }); restored.join(0); restored.ticks(2);
  assert.equal(restored.host.facts().faults, 0); assert.equal(restored.host.core.goal(3)?.goal, 'follow');
  h.host.stop(); restored.host.stop();
});

test('an invalid line rejects the whole floor decision before a valid goal reaches rules', async () => {
  const rules = source.replace("{ goal: 'guard', say: 'hello' }", "{ goal: 'guard', say: 'missing' }");
  const L = await loadGame(scratch, writeGame(scratch, 'atomic-floor', { rules }), 'atomic-floor');
  const h = hostRig(L, L.R.compileRules(L.def, { seats: 4 }));
  h.host.frame({ t: 'vocabulary', vocab }); h.host.frame({ t: 'policy', policy: policy() }); h.join(0); h.ticks(10);
  assert.equal(h.host.core.goal(3), null);
  assert.equal(h.sent.filter(m => m.k === 'say:missing').length, 0);
});

test('direct core input values cross the same declared boundary as player frames', async () => {
  const rules = source.replace('self.level = world.level;', "if(typeof self.input.ax !== 'number' || self.input.ax < -128 || self.input.ax > 127)throw new Error('unvalidated input');self.level=world.level;");
  const L = await loadGame(scratch, writeGame(scratch, 'core-input-boundary', { rules }), 'core-input-boundary');
  const c = L.R.compileRules(L.def, { seats: 4 });
  for (const value of [{}, 'wrong', Infinity, NaN, 999, -999]) {
    const core = L.C.createCore(c);
    core.seatJoin({ seat: 0, driver: 'person', owner: 'test' }); core.step();
    core.step(new Map([[0, { values: { ax: value } }]]));
    assert.equal(core.stats.errors, 0, core.stats.lastError);
  }
});
