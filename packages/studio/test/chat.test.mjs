import { legacyGame } from './legacy-game.mjs';
/**
 * @homie-rocks/studio 0.23.0: room chat (NETPLAY.md section 19; worker/chat.mjs, chat-store.mjs, chat-page.mjs).
 *
 *   - the floor: slurs, sexual words, telling someone to hurt themselves, contact details and other apps, links and
 *     swears are held, through spacing, repeats, leet and look-alike letters; ordinary chat, emoji and words that only
 *     contain a held word pass; a studio's own words block and allow;
 *   - the rules: Homie's defaults (emoji and quick lines for anyone, typing for signed-in players, reviewed); kids and a
 *     server's quick-lines speech cap the mode; the owner's layers win over the game's; what clients see has no word list;
 *     the build refuses a bad game.json "chat";
 *   - the review: Clef's answer read as a probability (held when "ok" is unlikely, with the likeliest reason), Llama
 *     Guard's too, neurons counted, no binding or a slow model throws so the floor decides;
 *   - the relay: reactions and lines reach every game socket and every watching shell (the sender's own copy with its
 *     `n`), with homie.rocks's shapes; a guest's typing waits for sign-in while their emoji go; slow mode and repeats;
 *     a muted sender, a watcher where watchers only read, an AI and a homie.rocks page where the room keeps chat home are
 *     refused; the studio's review holds a message or lets it through, and a mute during the review still holds it;
 *     the owner's unsay, mute and kick from a line (with their lines taken down); the window a new page gets; an empty
 *     room forgets what was said;
 *   - the helper (revision 8): `chat`, `say` (a bubble: only when its sender wants it and this browser shows chat),
 *     `unchat`, `held`, and `net.say`, `net.sayLine`, `net.react`;
 *   - the port kit: createBubbles keeps the speaker's own first and never lets two bubbles cover each other; wrapText;
 *   - the Worker: a socket's account (a passkey, not a guest), membership and another site's page reach the room; a
 *     report files the room's own copy once; the office reads every room's chat and the reports, removes a line, mutes
 *     from a line, and saves rules (opening chat up from an office key is an ask; tightening is at once), and live rooms
 *     hear new rules at once;
 *   - the pages: the play page, the big screen and the watch page carry the chat component (no `__name`), the owner's
 *     tools only on the owner's page.
 * Run: node --test packages/studio/test/chat.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHAT_DEFAULTS, CHAT_MODEL, REACTIONS, allows, chatProblems, checkChatRules, cleanText, composeChat, floor, normalizeChat, publicChat, reviewChat } from '../worker/chat.mjs';
import { CHAT_MIGRATION_FILE } from '../worker/chat-store.mjs';
import { NetRoom } from '../worker/room.mjs';
import { OFFICE_MIGRATION_FILE } from '../worker/office.mjs';
import { STATS_MIGRATION_FILE } from '../worker/stats.mjs';
import { SERVERS_MIGRATION_FILE } from '../worker/servers.mjs';
import { virtualTime } from './virtual-time.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-chat-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const EVIL = '<img src=x onerror=alert(1)>';
const DAY = 86_400_000;
const settle = () => new Promise((r) => setImmediate(r));

/* ------------------------------------------------------------------ the floor */

test('the floor holds slurs, sexual words, self-harm, contact details, links and swears, however they are spelled', () => {
  const R = normalizeChat(null);
  const held = (text, why, rules = R) => assert.deepEqual(floor(text, rules), { ok: false, why }, text);
  const ok = (text, rules = R) => assert.deepEqual(floor(text, rules), { ok: true }, text);
  held('you are a f u c k i n g idiot', 'swears');
  held('fuuuuuck', 'swears');
  held('sh1t', 'swears');
  held('what a n1gg3r', 'words');
  held('fаggot', 'words'); // a Cyrillic а
  held('go kill yourself', 'harm');
  held('kys', 'harm');
  held('send me pics', 'contact');
  held('add me on snap', 'contact');
  held(`my email is kid${String.fromCharCode(64)}example.com`, 'contact'); // an address, built so the source holds none
  held('text me at 555 123 4567', 'contact');
  held('visit cool-site.com now', 'link');
  held('https://example.com/free', 'link');
  ok('gg ez');
  ok('this hit hard', R); // "this hit" is not one word
  ok('class pass glass');
  ok('Scunthorpe');
  ok('nice shot, 10-12 15-9 next round');
  ok('I love this game ❤️ 🔥');
  // A game that allows swearing still holds slurs, sexual words and threats; a link allowed is just text.
  const loose = normalizeChat({ swears: 'allow', links: 'allow' });
  ok('well shit', loose);
  ok('see example.com', loose);
  held('what a n1gg3r', 'words', loose);
  // The studio's own words: held whole (or inside words with *), and a word it allows goes through.
  const own = normalizeChat({ block: ['potato', 'grief*'], allow: ['ass'] });
  held('you potato', 'words', own);
  held('stop griefing', 'words', own);
  ok('a potatoes field', own);
  ok('kick ass', own);
  assert.equal(cleanText('hi​there ‮evil 👨‍👩‍👧', 100), 'hithere evil 👨‍👩‍👧', 'no invisible or bidi tricks; a family emoji keeps its joiners');
});

test('the rules: Homie\'s defaults, kids and quick-lines servers cap them, the owner\'s layers win, clients never see the word list', () => {
  const d = normalizeChat(null);
  assert.equal(d.mode, 'text');
  assert.equal(d.who, 'signed-in', 'typing waits for a passkey account by default');
  assert.equal(d.react, 'anyone', 'emoji and quick lines are open to guests');
  assert.equal(d.ai, true);
  assert.deepEqual(d.emoji.map((e) => e.k), ['fire', 'clap', 'laugh', 'heart', 'wow'], 'homie.rocks\'s five, in its order');
  assert.equal(d.lines.length, 8);
  assert.equal(normalizeChat({ mode: 'text' }, { kids: true }).mode, 'lines', 'kids: emoji and quick lines only');
  assert.equal(normalizeChat({ mode: 'text' }, { kids: true }).capped, 'kids');
  assert.equal(normalizeChat({ mode: 'text' }, { speech: 'lines' }).mode, 'lines');
  assert.equal(normalizeChat({ mode: 'text' }, { speech: 'off' }).mode, 'off');
  assert.equal(normalizeChat({ mode: 'emoji' }, { speech: 'lines' }).mode, 'emoji', 'a cap never raises');
  const c = composeChat({ game: { mode: 'lines', slow: 5, lines: { gg: 'Good game!' } }, office: { mode: 'text', at: 10 }, server: { who: 'members', at: 20 } });
  assert.equal(c.mode, 'text'); assert.equal(c.slow, 5); assert.equal(c.who, 'members'); assert.equal(c.at, 20);
  assert.deepEqual(c.lines, [{ id: 'gg', text: 'Good game!' }]);
  const r = normalizeChat({ emoji: { gem: '💎', bad: 'abc', fire: '💧' }, lines: { hi: 'Hi!', bad: 'you shit', x1: '' }, block: ['potato'] });
  assert.deepEqual(r.emoji.map((e) => e.k), ['fire', 'clap', 'laugh', 'heart', 'wow', 'gem'], 'a game adds its own emoji, never replaces a built-in');
  assert.deepEqual(r.lines.map((l) => l.id), ['hi'], 'a quick line must pass the floor');
  assert.equal(publicChat(r).block, undefined, 'clients never get the studio\'s own words');
  assert.equal(allows(r, 'text'), true); assert.equal(allows(normalizeChat({ mode: 'emoji' }), 'line'), false);
  assert.equal(checkChatRules({ mode: 'loud' }).ok, false);
  assert.deepEqual(checkChatRules({ mode: 'emoji', slow: 4, ai: false }).fields, { mode: 'emoji', slow: 4, ai: false });
  assert.deepEqual(chatProblems({ mode: 'text', lines: { gg: 'Good game!' } }), []);
  assert.match(chatProblems({ mode: 'yell' }).join(' '), /chat.mode/);
  assert.match(chatProblems({ lines: { gg: 'send me pics' } }).join(' '), /floor/);
  assert.deepEqual(chatProblems(false), [], 'false: a game with no chat');
  assert.equal(CHAT_DEFAULTS.max, 140);
});

/* ------------------------------------------------------------------ the review */

test('the review: Clef\'s probabilities decide, the likeliest reason is kept, neurons are counted; no binding or a slow model throws', async () => {
  const calls = [];
  const env = (answer, usage = { input_tokens: 120 }) => ({ AI: { run: async (model, input) => { calls.push({ model, input }); return { model, answers: { verdict: answer }, usage }; } } });
  let v = await reviewChat(env({ type: 'choice', choice: 'ok', probabilities: { ok: 0.93, insult: 0.04, spam: 0.03 } }), 'gg ez');
  assert.equal(v.ok, true);
  assert.equal(v.model, CHAT_MODEL);
  assert.equal(calls[0].model, '@cf/cloudflare/clef-flash');
  assert.equal(calls[0].input.model, 'clef-flash');
  assert.equal(calls[0].input.state, 'gg ez', 'the message is the state; the questions are the studio\'s own');
  assert.equal(calls[0].input.questions.verdict.type, 'choice');
  assert.ok(Math.abs(v.neurons - (120 * 8182) / 1e6) < 1e-9, 'clef-flash: 8,182 neurons a million input tokens, no output charge');
  v = await reviewChat(env({ type: 'choice', choice: 'grooming', probabilities: { ok: 0.12, grooming: 0.8, spam: 0.08 } }), 'how old are you, which school');
  assert.deepEqual([v.ok, v.why], [false, 'grooming']);
  v = await reviewChat(env({ type: 'choice', choice: 'ok', probabilities: { ok: 0.41, insult: 0.59 } }), 'meh');
  assert.deepEqual([v.ok, v.why], [false, 'insult'], 'held when "ok" is less likely than not, whatever the top choice');
  const guard = { AI: { run: async () => ({ response: { safe: false, categories: ['S10'] }, usage: { prompt_tokens: 210, completion_tokens: 4 } }) } };
  v = await reviewChat(guard, 'x', { model: '@cf/meta/llama-guard-3-8b' });
  assert.deepEqual([v.ok, v.why], [false, 'guard:S10']);
  await assert.rejects(reviewChat({}, 'hi'), /no Workers AI binding/);
  const slow = { AI: { run: () => new Promise((r) => setTimeout(() => r({}), 200)) } };
  await assert.rejects(reviewChat(slow, 'hi', { ms: 20 }), /took over 20 ms/);
  await assert.rejects(reviewChat({ AI: { run: async () => ({}) } }, 'hi'), /nothing it could use/);
});

/* ------------------------------------------------------------------ the relay */

function relay({ policy = null, clock = { t: 1_000_000 } } = {}) {
  const room = new NetRoom({ code: 'pub-1', now: () => clock.t });
  if (policy) room.setPolicy(policy);
  const sock = (extra = {}) => ({ sent: [], closed: null, ip: '203.0.113.5', send(x) { this.sent.push(JSON.parse(x)); }, close(c, w) { this.closed = [c, w]; }, ...extra });
  const player = (name, extra = {}) => {
    const conn = sock({ browser: `b-${name.toLowerCase().padEnd(18, 'x')}`, ...extra });
    const h = room.attach(conn);
    h.onMessage(JSON.stringify({ t: 'hello', v: 1, device: 'desk', want: 'play', canHost: true, name }));
    return { conn, h, say: (m) => h.onMessage(JSON.stringify(m)), got: (t) => conn.sent.filter((x) => x.t === t) };
  };
  const shell = (extra = {}) => {
    const conn = sock(extra);
    const w = room.watch(conn);
    return { conn, w, say: (m) => w.onMessage(JSON.stringify(m)), got: (t) => conn.sent.filter((x) => x.t === t) };
  };
  return { room, clock, player, shell };
}
const POL = (chat, extra = {}) => ({ v: 1, at: 10, server: null, kind: 'open', aiSeats: 0, guides: 0, bots: 'fill', level: 3, levelMax: 5, speech: 'game', kids: false, brain: 'script', chat, ...extra });

test('the relay: a reaction and a line reach every game socket and every shell, in homie.rocks\'s shapes; guests react, signed-in players type', () => {
  const { room, clock, player, shell } = relay();
  const ada = player('Ada', { acct: true });
  const bo = player('Bo');
  const adaShell = shell({ browser: ada.conn.browser, acct: true });
  const tv = shell({});
  adaShell.say({ t: 'react', kind: 'fire', n: 'r1' });
  const seen = bo.got('react')[0];
  assert.deepEqual({ t: seen.t, react: seen.react, glyph: seen.glyph, name: seen.name, seat: seen.seat, by: seen.by, bubble: seen.bubble }, { t: 'react', react: 'fire', glyph: '🔥', name: 'Ada', seat: 0, by: 'player', bubble: true });
  assert.equal(seen.n, undefined, 'others never see the sender\'s own id');
  assert.equal(adaShell.got('react')[0].n, 'r1', 'the sender\'s shell gets its own copy with its id');
  assert.equal(tv.got('react').length, 1, 'the big screen gets it');
  assert.equal(ada.got('react').length, 1, 'the sender\'s game gets it too (its bubble)');
  // A guest's typing waits for sign-in; their quick line and emoji go.
  bo.say({ t: 'say', text: 'hello', n: 'b1' });
  assert.deepEqual(bo.got('held').map((m) => [m.why, m.n]), [['sign-in', 'b1']]);
  bo.say({ t: 'say', say: 'gg' });
  assert.equal(ada.got('line').at(-1).text, 'Good game!');
  assert.equal(ada.got('line').at(-1).say, 'gg');
  adaShell.say({ t: 'say', text: 'hello all', bubble: false });
  const line = tv.got('line').at(-1);
  assert.equal(line.text, 'hello all');
  assert.equal(line.bubble, undefined, '"not over my character"');
  assert.equal(line.acct, true);
  // Slow mode (2 s by default) and a repeat.
  adaShell.say({ t: 'say', text: 'again' });
  assert.equal(adaShell.got('slow').at(-1).why, 'slow');
  clock.t += 2500;
  adaShell.say({ t: 'say', text: 'hello all' });
  assert.equal(adaShell.got('held').at(-1).why, 'repeat');
  adaShell.say({ t: 'say', text: 'add me on snap' });
  assert.equal(adaShell.got('held').at(-1).why, 'contact');
  adaShell.say({ t: 'react', kind: 'confetti' });
  assert.equal(adaShell.got('held').at(-1).why, 'unknown');
  // A page that opens now gets the window.
  const late = shell({});
  assert.deepEqual(late.got('lines')[0].lines.map((l) => l.text ?? l.glyph), ['🔥', 'Good game!', 'hello all']);
  // The facts every shell reads say the rules (and never the word list).
  assert.equal(room.facts().policy.chat.mode, 'text');
  assert.equal(room.facts().policy.chat.block, undefined);
});

test('the relay holds chat a room\'s rules do not allow: off, emoji only, kids, watchers who only read, an AI, a homie.rocks page, members', () => {
  {
    const { player } = relay({ policy: POL({ mode: 'off' }) });
    const a = player('Ada', { acct: true });
    a.say({ t: 'react', kind: 'fire' });
    assert.equal(a.got('held')[0].why, 'off');
  }
  {
    const { player } = relay({ policy: POL({ mode: 'text', who: 'anyone' }, { kind: 'beginner', guides: 0, speech: 'lines', kids: true }) });
    const a = player('Ada', { acct: true });
    a.say({ t: 'say', text: 'hi there' });
    assert.equal(a.got('held')[0].why, 'lines', 'kids: quick lines and emoji only, whatever the game asks');
    a.say({ t: 'say', say: 'hi' });
    assert.equal(a.got('line')[0].text, 'Hi!');
  }
  {
    const { player, shell } = relay({ policy: POL({ watchers: false, hub: false, react: 'anyone', who: 'members' }) });
    player('Ada', { acct: true });
    const watcher = shell({ browser: 'w-xxxxxxxxxxxxxxxxxxx' });
    watcher.say({ t: 'react', kind: 'clap' });
    assert.equal(watcher.got('held')[0].why, 'watchers');
    const hub = shell({ hub: true });
    assert.equal(hub.got('lines').length, 0, 'a room that keeps its chat home sends homie.rocks none of it');
    hub.say({ t: 'react', kind: 'clap' });
    assert.equal(hub.got('held')[0].why, 'hub');
    const p = player('Cy', { acct: true });
    p.say({ t: 'say', text: 'hello' });
    assert.equal(p.got('held')[0].why, 'members');
    const m = player('Di', { acct: true, member: true });
    m.say({ t: 'say', text: 'hello' });
    assert.equal(m.got('line')[0].text, 'hello');
    const owner = player('Owl', { via: 'o' });
    owner.say({ t: 'say', text: 'welcome everyone' });
    assert.equal(owner.got('line').at(-1).owner, true, 'the owner always speaks, marked as the owner');
  }
  {
    const { room, player } = relay();
    const ai = room.attach({ sent: [], send(x) { this.sent.push(JSON.parse(x)); }, close() {}, agent: { pass: 'p1', role: 'party', hands: 'self', name: 'Wren' } });
    ai.onMessage(JSON.stringify({ t: 'hello', v: 1, device: 'desk', want: 'play', canHost: true }));
    const a = player('Ada', { acct: true });
    void a;
    ai.onMessage(JSON.stringify({ t: 'say', text: 'hi' }));
    assert.equal(room.chatLog.length, 0, 'an AI never types in room chat');
  }
});

test('the relay: the studio\'s review holds or passes typed text; a failed review lets the floor decide; a mute during it still holds', async () => {
  const { room, clock, player } = relay();
  const a = player('Ada', { acct: true });
  const b = player('Bo');
  let answer = { ok: false, by: 'ai', why: 'insult' };
  let gate = null;
  room.review = (text) => new Promise((res) => { gate = () => res(typeof answer === 'function' ? answer(text) : answer); });
  a.say({ t: 'say', text: 'you play like a potato', n: 'a1' });
  await settle();
  assert.equal(room.chatPending, 1);
  assert.equal(b.got('line').length, 0, 'nothing goes out before the review says so');
  gate(); await new Promise((r) => setImmediate(r));
  assert.deepEqual(a.got('held').map((m) => [m.why, m.n]), [['ai', 'a1']]);
  assert.equal(b.got('line').length, 0);
  answer = { ok: true, by: 'ai' };
  clock.t += 3000;
  a.say({ t: 'say', text: 'nice dodge' });
  await settle();
  gate(); await new Promise((r) => setImmediate(r));
  assert.equal(b.got('line').at(-1).text, 'nice dodge');
  room.review = () => Promise.reject(new Error('model down'));
  clock.t += 3000;
  a.say({ t: 'say', text: 'still here' });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.equal(b.got('line').at(-1).text, 'still here', 'a review that fails lets the floor decide');
  assert.equal(room.stats.chatAiErrors, 1);
  // Muted while the review ran: held all the same.
  room.review = () => new Promise((res) => { gate = () => res({ ok: true, by: 'ai' }); });
  clock.t += 3000;
  a.say({ t: 'say', text: 'one more thing' });
  await settle();
  room.control('mute', { seat: 0, minutes: 5 });
  gate(); await new Promise((r) => setImmediate(r));
  assert.notEqual(b.got('line').at(-1).text, 'one more thing');
  assert.equal(a.got('held').at(-1).why, 'muted');
  // Emoji and quick lines never wait for a review.
  let reviewed = 0;
  room.review = async () => { reviewed += 1; return { ok: true }; };
  b.say({ t: 'react', kind: 'wow' });
  assert.equal(a.got('react').at(-1).react, 'wow');
  assert.equal(reviewed, 0);
});

test('the owner\'s controls on chat: unsay, mute and kick from a line (their lines taken down), and an empty room forgets what was said', () => {
  const { room, clock, player, shell } = relay();
  const a = player('Ada', { acct: true });
  const b = player('Bo', { acct: true });
  const watcher = shell({ browser: 'w-yyyyyyyyyyyyyyyyyyy', acct: true });
  b.say({ t: 'say', text: 'first' });
  clock.t += 2500;
  b.say({ t: 'say', text: 'second' });
  watcher.say({ t: 'react', kind: 'heart' });
  const ids = room.chatLog.map((r) => r.id);
  assert.deepEqual(room.control('unsay', { id: ids[0] }), { ok: true, op: 'unsay', removed: 1 });
  assert.deepEqual(a.got('unline').at(-1).ids, [ids[0]], 'every screen hears it gone');
  assert.equal(watcher.got('unline').length, 1);
  const office = room.officeFacts().office.chat;
  assert.equal(office.lines.length, 2);
  assert.ok(office.lines[0].client, 'the office knows whose line it is (a client id), never an address');
  const r = room.control('mute', { line: ids[1], minutes: 5, purge: true });
  assert.equal(r.ok, true); assert.equal(r.name, b.conn.sent.find((m) => m.t === 'welcome').name);
  assert.equal(r.removed, 1, 'their lines came down with the mute');
  clock.t += 3000;
  b.say({ t: 'say', say: 'gg' });
  assert.equal(b.got('held').at(-1).why, 'muted');
  // A watcher with no seat: held by browser and account, from their line.
  const k = room.control('kick', { line: ids[2], minutes: 5, purge: true });
  assert.equal(k.ok, true);
  assert.equal(watcher.got('kicked').length, 1, 'their page hears it');
  // Everyone leaves: a minute later the room forgets what was said.
  a.h.onClose(); b.h.onClose();
  clock.t += 61_000;
  room.tick();
  assert.equal(room.chatLog.length, 0);
});

/* ------------------------------------------------------------------ the helper (revision 8) */

let helper = null;
async function netplayModule() {
  if (helper) return helper;
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  const file = join(scratch, 'netplay.mjs');
  await esbuild.build({ entryPoints: [join(PKG, 'netplay', 'netplay.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent' });
  helper = await import(file);
  return helper;
}

test('the helper: chat, say (a bubble only when its sender wants it and this browser shows chat), unchat, held, and the game\'s own chat UI', async (t) => {
  const { createNetplay, NETPLAY_REVISION, NETPLAY_MARK } = await netplayModule();
  assert.equal(NETPLAY_REVISION, 11, 'revision 10 (NETPLAY.md section 29); room chat is revision 8\'s');
  assert.equal(NETPLAY_MARK, 'homie-netplay-rev:11');
  const { wait } = virtualTime(t);
  const room = new NetRoom({ code: 'pub-1', maxPlayers: 8 });
  const socket = (conn = {}) => class MemorySocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0;
      this.h = room.attach({ ...conn, send: (x) => setTimeout(() => this.onmessage?.({ data: x }), 0), close: () => {}, buffered: () => 0 });
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }
    send(x) { this.h.onMessage(x); }
    close() { this.readyState = 3; this.h.onClose(); }
  };
  const cfg = (extra = {}) => ({ v: 1, url: 'ws://relay/x/__net?room=pub-1', room: 'pub-1', device: 'desk', want: 'play', ...extra });
  const open = [];
  t.after(() => { for (const n of open) n.close(); });
  const make = (c, conn) => { const n = createNetplay({ post: null, game: 'x', WebSocketImpl: socket(conn), config: cfg(c) }); open.push(n); return n; };
  const a = make({ name: 'Ada' }, { acct: true });
  const b = make({ name: 'Bo', bubbleOff: true });
  const quiet = make({ name: 'Cy', chatOff: true });
  await wait(40);
  assert.equal(a.chatRules.mode, 'text', 'the rules ride in the policy');
  const chats = []; const says = []; const quietSays = []; const gone = []; const held = [];
  b.on('chat', (m) => chats.push(m)); b.on('say', (s) => says.push(s)); quiet.on('say', (s) => quietSays.push(s)); b.on('unchat', (e) => gone.push(e)); a.on('held', (h) => held.push(h));
  assert.equal(a.say('hello room'), true);
  await wait(20);
  assert.equal(chats.at(-1).text, 'hello room');
  assert.equal(chats.at(-1).kind, 'text');
  assert.deepEqual(says.map((s) => [s.seat, s.text, s.kind]), [[0, 'hello room', 'text']]);
  assert.equal(quietSays.length, 0, 'a browser with chat hidden draws no bubbles');
  b.react('heart');
  await wait(20);
  const heart = says.find((s) => s.kind === 'react');
  assert.equal(heart, undefined, 'Bo does not want his own over his character (bubbleOff)');
  assert.equal(chats.at(-1).glyph, '❤️');
  b.say('typing as a guest');
  await wait(2500); // past slow mode (2 s)
  a.sayLine('gg');
  await wait(20);
  assert.equal(chats.at(-1).say, 'gg');
  room.control('unsay', { id: chats.at(-1).id });
  await wait(20);
  assert.deepEqual(gone.at(-1).ids, [chats.at(-1).id]);
  a.say('hi again');
  await wait(20);
  assert.equal(held.at(-1).why, 'slow', 'slow mode, said to the sender');
});

/* ------------------------------------------------------------------ the port kit */

let view = null;
async function viewModule() {
  if (view) return view;
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  await esbuild.build({ entryPoints: [join(PKG, 'port', 'view.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: join(scratch, 'view.mjs'), logLevel: 'silent' });
  view = await import(join(scratch, 'view.mjs'));
  return view;
}

test('createBubbles: the speaker\'s own first, two bubbles never cover each other, they wrap, fade and go; wrapText', async () => {
  const { createBubbles, wrapText } = await viewModule();
  let now = 0;
  const measure = (s) => s.length * 7;
  const b = createBubbles({ measure, now: () => now, screen: () => ({ w: 800, h: 600 }) });
  b.say(1, 'hello there, this is a long message that will wrap onto more than one line for sure', { id: 'x1' });
  b.say(2, 'me too', { id: 'x2' });
  b.say(3, '🔥', { kind: 'react' });
  now = 200;
  // Three speakers standing on one spot: their bubbles stack, none covers another.
  const out = b.place([{ key: 1, x: 400, y: 400 }, { key: 2, x: 405, y: 400, self: true }, { key: 3, x: 398, y: 402 }]);
  assert.equal(out.length, 3);
  assert.equal(out[0].key, 2, 'the player\'s own first');
  for (let i = 0; i < out.length; i += 1) for (let j = i + 1; j < out.length; j += 1) {
    const p = out[i]; const q = out[j];
    assert.ok(!(p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom), `bubbles ${p.key} and ${q.key} overlap`);
  }
  const long = out.find((x) => x.key === 1);
  assert.ok(long.lines.length > 1 && long.lines.length <= 3);
  assert.ok(long.right - long.left <= 190 + 16 + 1, 'no wider than its max');
  assert.equal(out.find((x) => x.key === 3).emoji, true);
  b.remove('x2');
  assert.equal(b.place([{ key: 2, x: 405, y: 400 }]).length, 0, 'taken down');
  now = 60_000;
  assert.equal(b.place([{ key: 1, x: 400, y: 400 }]).length, 0, 'gone after its time');
  assert.equal(b.size, 0);
  assert.deepEqual(wrapText('aaaa bbbb cccc', 28, measure, 3), ['aaaa', 'bbbb', 'cccc']);
  assert.equal(wrapText('w'.repeat(40), 70, measure, 2).length, 2);
});

/* ------------------------------------------------------------------ the Worker, the office and the pages */

function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Chat Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return dir;
}
function fakeD1(dir) {
  const sql = new DatabaseSync(':memory:');
  for (const f of ['0001_studio.sql', STATS_MIGRATION_FILE, '0004_players.sql', OFFICE_MIGRATION_FILE, SERVERS_MIGRATION_FILE, CHAT_MIGRATION_FILE]) sql.exec(readFileSync(join(dir, 'site', 'migrations', f), 'utf8'));
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: r.changes } }; },
  });
  return { sql, prepare: (q) => stmt(q), batch: async (list) => { for (const s of list) await s.run(); return []; } };
}
function assetsOf(dir) {
  const dist = join(dir, 'site', 'dist');
  return {
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, p);
      if (!f.startsWith(dist) || !existsSync(f)) return new Response('not found', { status: 404 });
      return new Response(readFileSync(f), { headers: { 'content-type': p.endsWith('.json') ? 'application/json' : p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' } });
    },
  };
}
function namespace(Klass, envRef, waits) {
  const objs = new Map();
  return {
    objs,
    idFromName: (n) => n,
    get(id) {
      if (!objs.has(id)) {
        const store = new Map();
        const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, setAlarm: async (at) => { store.set('__alarm', at); } }, blockConcurrencyWhile: async (fn) => fn(), waitUntil: (p) => waits.push(p) };
        objs.set(id, new Klass(ctx, envRef.env));
      }
      const o = objs.get(id);
      return { fetch: (req, init) => o.fetch(req instanceof Request ? req : new Request(req, init)) };
    },
  };
}

let built = null;
async function site() {
  if (!built) {
    const dir = studio('worker');
    legacyGame(dir, 'owl-run', 'Owl Run');
    const gj = join(dir, 'games', 'owl-run', 'game.json');
    writeFileSync(gj, JSON.stringify({ ...JSON.parse(readFileSync(gj, 'utf8')), chat: { mode: 'text', slow: 1, lines: { gg: 'Good game!', hoot: 'Hoot hoot!' }, emoji: { owl: '🦉' } } }, null, 2));
    const b = run(['build'], dir);
    assert.equal(JSON.parse(b.stdout).ok, true, b.stdout + b.stderr);
    built = dir;
  }
  const dir = built;
  const { default: worker, Table, Lobby } = await import('../worker/index.mjs');
  const waits = [];
  const ref = {};
  const DB = fakeD1(dir);
  const env = { ASSETS: assetsOf(dir), DB, STUDIO_NAME: 'Chat Owls' };
  ref.env = env;
  env.TABLE = namespace(Table, ref, waits);
  env.LOBBY = namespace(Lobby, ref, waits);
  const ctx = { waitUntil: (p) => waits.push(p) };
  const fetchSite = async (path, init = {}) => {
    const r = await worker.fetch(new Request(`https://owls.example${path}`, { ...init, headers: { 'user-agent': BROWSER, ...(init.headers ?? {}) } }), env, ctx);
    await Promise.all(waits.splice(0));
    return r;
  };
  const mint = (kind, value, ttl = 3600_000) => DB.sql.prepare('INSERT INTO stats_keys (hash, kind, expires_at) VALUES (?, ?, ?)').run(sha(value), kind, Date.now() + ttl);
  const session = 'f'.repeat(64);
  mint('session', session);
  const officeKey = `hsk_${'0e'.repeat(24)}`;
  mint('office', officeKey);
  let pn = 0;
  const player = ({ guest = false } = {}) => {
    pn += 1;
    const id = `pl_${String(pn).padStart(22, 'p')}`;
    const token = `${String(pn).padStart(43, 't')}`;
    DB.sql.prepare('INSERT INTO players (id, name, named, guest, owner, created_at, seen_at) VALUES (?, ?, 1, ?, 0, ?, ?)').run(id, `Player ${pn}`, guest ? 1 : 0, Date.now() - DAY, Date.now());
    DB.sql.prepare("INSERT INTO player_sessions (hash, player, kind, expires_at) VALUES (?, ?, 'session', ?)").run(sha(token), id, Date.now() + DAY);
    return { id, cookie: `studio_player=${token}` };
  };
  /** A socket through the Worker, as workerd would open it (Node has no WebSocketPair and no 101 Response). */
  const ends = [];
  class FakeSocket { constructor() { this.listeners = {}; this.sent = []; } accept() {} send(t) { this.sent.push(JSON.parse(t)); } close() { this.closed = true; } addEventListener(k, fn) { (this.listeners[k] ??= []).push(fn); } emit(k, e) { for (const fn of this.listeners[k] ?? []) fn(e); } }
  const socket = async (path, headers = {}) => {
    globalThis.WebSocketPair = class { constructor() { const c = new FakeSocket(); const s2 = new FakeSocket(); ends.push(s2); return { 0: c, 1: s2 }; } };
    try { await fetchSite(path, { headers: { upgrade: 'websocket', ...headers } }).catch((e) => { if (!/status/.test(String(e))) throw e; }); } finally { delete globalThis.WebSocketPair; }
    const end = ends.at(-1);
    return { end, say: (m) => end.emit('message', { data: JSON.stringify(m) }), got: (t) => end.sent.filter((x) => x.t === t) };
  };
  const stop = () => { for (const o of env.TABLE.objs.values()) if (o.timer) { clearInterval(o.timer); o.timer = null; } };
  const owner = { cookie: `studio_owner=${session}` };
  const same = { origin: 'https://owls.example', 'content-type': 'application/json' };
  const key = { authorization: `Bearer ${officeKey}`, 'content-type': 'application/json' };
  const post = (path, body, headers = key) => fetchSite(path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { env, DB, dir, fetchSite, socket, stop, player, owner, same, key, post };
}

test('the Worker: a socket\'s passkey account, membership and another site\'s page reach the room; game.json\'s chat is the room\'s', async () => {
  const { env, socket, stop, player } = await site();
  try {
    const guestShell = await socket('/owl-run/__watch?room=pub-1&b=aaaaaaaaaaaaaaaaaaaa');
    const room = env.TABLE.objs.get('owl-run/pub-1').room;
    assert.equal(room.chatRules().slow, 1, 'game.json "chat" reached the room');
    assert.deepEqual(room.chatRules().lines.map((l) => l.id), ['gg', 'hoot']);
    assert.ok(room.chatRules().emoji.some((e) => e.k === 'owl'));
    assert.equal(guestShell.got('lines').length, 1);
    guestShell.say({ t: 'say', text: 'hi' });
    assert.equal(guestShell.got('held')[0].why, 'sign-in');
    guestShell.say({ t: 'say', say: 'hoot' });
    assert.equal(room.chatLog.at(-1).text, 'Hoot hoot!');
    // A player with a passkey: the play page's ticket names them; their typing goes.
    const p = player();
    const t = await (await import('../worker/office.mjs')).ticketFor(env, 'owl-run', `p-${p.id}`);
    const signed = await socket(`/owl-run/__watch?room=pub-1&b=bbbbbbbbbbbbbbbbbbbb&t=${encodeURIComponent(t)}`);
    signed.say({ t: 'say', text: 'evening owls' });
    await settle(); // typed text waits for the review (no Workers AI here: the floor decides, a turn later)
    assert.equal(room.chatLog.at(-1).text, 'evening owls');
    assert.equal(room.chatLog.at(-1).acct, true);
    // A guest account (no passkey) is not signed in for chat.
    const g = player({ guest: true });
    const gt = await (await import('../worker/office.mjs')).ticketFor(env, 'owl-run', `p-${g.id}`);
    const guest = await socket(`/owl-run/__watch?room=pub-1&b=cccccccccccccccccccc&t=${encodeURIComponent(gt)}`);
    guest.say({ t: 'say', text: 'me too' });
    assert.equal(guest.got('held')[0].why, 'sign-in');
    // homie.rocks's room page: another origin, a watcher marked hub.
    const hub = await socket('/owl-run/__watch?room=pub-1', { origin: 'https://homie.rocks' });
    hub.say({ t: 'react', kind: 'owl' });
    assert.equal(room.chatLog.at(-1).by, 'hub');
  } finally { stop(); }
});

test('a report files the room\'s own copy of one message, once; it needs this site\'s page; the office lists and dismisses it', async () => {
  const { env, DB, socket, stop, post, same, fetchSite, owner } = await site();
  try {
    const shell = await socket('/owl-run/__watch?room=pub-2&b=dddddddddddddddddddd');
    const game = await socket('/owl-run/__net?room=pub-2&b=dddddddddddddddddddd');
    game.say({ t: 'hello', v: 1, device: 'desk', want: 'play', canHost: true, name: 'Ada' });
    shell.say({ t: 'say', say: 'gg' });
    const room = env.TABLE.objs.get('owl-run/pub-2').room;
    const id = room.chatLog.at(-1).id;
    let r = await post('/owl-run/api/chat/report', { room: 'pub-2', id, reason: 'mean', b: 'eeeeeeeeeeeeeeeeeeee' }, { 'content-type': 'application/json' });
    assert.equal(r.status, 403, 'only from this site\'s own pages');
    r = await post('/owl-run/api/chat/report', { room: 'pub-2', id, reason: 'mean', b: 'eeeeeeeeeeeeeeeeeeee', text: 'they are awful' }, same);
    assert.equal(r.status, 200, await r.text());
    await post('/owl-run/api/chat/report', { room: 'pub-2', id, reason: 'spam', b: 'ffffffffffffffffffff' }, same);
    const rows = DB.sql.prepare('SELECT * FROM chat_reports').all();
    assert.equal(rows.length, 1, 'once per message');
    assert.equal(rows[0].text, 'Good game!', 'the room\'s copy, never the reporter\'s words');
    assert.equal(rows[0].reason, 'mean');
    assert.ok(!JSON.stringify(rows[0]).includes('eeeeeeeeeeeeeeeeeeee'), 'nothing about who reported it');
    r = await post('/owl-run/api/chat/report', { room: 'pub-2', id: 'nosuchline', reason: 'mean' }, same);
    assert.equal(r.status, 404);
    const office = await (await fetchSite('/_studio/api/chat?game=owl-run', { headers: owner })).json();
    assert.equal(office.games[0].chat.reports.length, 1);
    assert.equal(office.games[0].rooms.find((x) => x.room === 'pub-2').chat.lines.length, 1);
    r = await post('/_studio/api/chat/report', { id: rows[0].id });
    assert.equal((await r.json()).removed, 1);
    assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM chat_reports').get().n, 0);
  } finally { stop(); }
});

test('the office: rules that open chat up are an ask from an office key, tightening is at once; live rooms hear them; remove and mute from a line', async () => {
  const { env, socket, stop, post, owner, same, fetchSite } = await site();
  try {
    const shell = await socket('/owl-run/__watch?room=pub-3&b=gggggggggggggggggggg');
    const game = await socket('/owl-run/__net?room=pub-3&b=gggggggggggggggggggg');
    game.say({ t: 'hello', v: 1, device: 'desk', want: 'play', canHost: true, name: 'Ada' });
    const room = env.TABLE.objs.get('owl-run/pub-3').room;
    let r = await post('/_studio/api/chat/rules', { game: 'owl-run', mode: 'emoji' });
    let j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.rules.mode, 'emoji');
    assert.equal(room.chatRules().mode, 'emoji', 'the live room heard it at once');
    assert.equal(shell.got('net').at(-1).policy.chat.mode, 'emoji', 'and every shell in it');
    r = await post('/_studio/api/chat/rules', { game: 'owl-run', mode: 'text', swears: 'allow' });
    j = await r.json();
    assert.equal(r.status, 202, 'opening chat up from an office key waits for the owner');
    assert.equal(j.needs, 'owner');
    assert.match(j.ask.what, /let players type/);
    r = await post('/_studio/api/chat/rules', { game: 'owl-run', mode: 'text' }, { ...same, ...owner });
    assert.equal(r.status, 200, 'the owner\'s own browser does it at once');
    assert.equal(room.chatRules().mode, 'text');
    // Remove a line, and mute its sender from it.
    shell.say({ t: 'react', kind: 'fire' });
    const id = room.chatLog.at(-1).id;
    r = await post('/_studio/api/chat/remove', { game: 'owl-run', room: 'pub-3', id }, { ...same, ...owner });
    assert.equal((await r.json()).removed, 1);
    assert.equal(shell.got('unline').length, 1);
    shell.say({ t: 'react', kind: 'clap' });
    r = await post('/_studio/api/mute', { game: 'owl-run', room: 'pub-3', line: room.chatLog.at(-1).id, minutes: 5, purge: true }, { ...same, ...owner });
    j = await r.json();
    assert.equal(j.ok, true, JSON.stringify(j));
    shell.say({ t: 'react', kind: 'wow' });
    assert.equal(shell.got('held').at(-1).why, 'muted');
    // Back to the game's own (an ask from a key; the owner's at once).
    r = await post('/_studio/api/chat/rules', { game: 'owl-run', reset: true }, { ...same, ...owner });
    assert.equal(r.status, 200);
    const office = await (await fetchSite('/_studio/api/office', { headers: owner })).json();
    assert.equal(office.games[0].chat.from, 'game.json');
    assert.ok(office.chat && office.chat.budget.neurons === 2000, 'the review\'s day: 2,000 neurons by default');
  } finally { stop(); }
});

test('the pages: play, the big screen and watch carry the chat component; the owner\'s tools only for the owner; nothing a player typed is markup', async () => {
  const { fetchSite, owner, stop } = await site();
  try {
    const play = await (await fetchSite('/owl-run/play?room=pub-4')).text();
    assert.match(play, /window\.__HOMIE_CHAT=\{"surface":"play"/);
    assert.match(play, /"owner":false/);
    assert.ok(!play.includes('__name('), 'no bundler helper in an inline script');
    const tv = await (await fetchSite('/owl-run/tv?room=pub-4')).text();
    assert.match(tv, /"surface":"tv"/);
    const watch = await (await fetchSite('/owl-run/watch?room=pub-4')).text();
    assert.match(watch, /"surface":"watch"/);
    const mine = await (await fetchSite('/owl-run/play?room=pub-4', { headers: owner })).text();
    assert.match(mine, /"owner":true/);
    const { CHAT_JS } = await import('../worker/chat-page.mjs');
    assert.ok(!/innerHTML\s*=(?!\s*ICON\b)/.test(CHAT_JS), 'the chat component sets player text as text only (innerHTML only for its own icon)');
    void EVIL;
  } finally { stop(); }
});

test('deploy binds Workers AI for a game whose players may type (the review), and not for one kept to emoji and lines', async () => {
  const { needsWorkersAi } = await import('../lib/cloudflare.mjs');
  const root = join(scratch, 'ai-binding');
  mkdirSync(join(root, 'site', 'dist'), { recursive: true });
  const none = () => ({ code: 0, stdout: JSON.stringify([{ results: [{ n: 0 }] }]), out: '' });
  const games = (list) => writeFileSync(join(root, 'site', 'dist', 'games.json'), JSON.stringify({ games: list }));
  games([{ id: 'a' }]);
  assert.equal(needsWorkersAi(root, none, 'DB'), true, 'a game with no "chat" lets signed-in players type, reviewed');
  games([{ id: 'a', chat: { mode: 'lines' } }, { id: 'b', chat: false }, { id: 'c', chat: { mode: 'text', ai: false } }]);
  assert.equal(needsWorkersAi(root, none, 'DB'), false, 'emoji and lines, no chat, or typing without the review: no binding for chat');
});
