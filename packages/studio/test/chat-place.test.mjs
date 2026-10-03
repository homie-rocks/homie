/**
 * @homie-rocks/studio 0.24.5: where room chat sits on the play page, so it never covers a game's HUD.
 *
 *   - the Chat pill follows the room button: the round icon on a phone (either way up) and beside a room button that
 *     game.json keeps an icon (`screen.share` "label": false); on a computer its word shows unless, with it, the band
 *     would leave the screen or reach from its corner into the middle third (a game's clock or title), and once it
 *     has, it stays the icon until the screen changes size; the count rides the icon's corner;
 *   - game.json `screen.chat` places the strip of new lines per device (`at`, `x` / `y`, `lines`: "strip" or
 *     "sheet-only", `desk`, `phone`, `sideways`, `tv`): as before when it is absent, a string or false; past the room
 *     button when it shares its place; "sheet-only" keeps new lines in the sheet and the pill counts them; the big
 *     screen takes a corner only and keeps its lines unless its own entry says otherwise;
 *   - the build warns about a wrong field (and the place is "at"), and a game.json "chat" (the room's rules) that names
 *     a place or "sheet-only" is pointed at `screen.chat`.
 * The chat component runs here against a small stand-in page (no browser needed); the pull request has screenshots of
 * the real page in Chrome.
 * Run: node --test packages/studio/test/chat-place.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { CHAT_CSS, CHAT_JS, CHAT_PLACES, chatBoot, chatPlaces, screenChatProblems } from '../worker/chat-page.mjs';
import { chatProblems } from '../worker/chat.mjs';
import { playPage } from '../worker/pages.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');

/**
 * The chat component on a stand-in page: a band (the room button's row) whose width is the room button's plus the
 * pill's (73 px with its word, 34 as the icon), on a screen `width` wide, with the shell's `share` for this device.
 */
function chatPage({ surface = 'play', g = { id: 'rock-race', name: 'Rock Race' }, share = { device: 'desk', at: 'top-right', x: 0, y: 0, label: true }, width = 1280, height = 800, room = 90 } = {}) {
  const made = [];
  const node = (tag) => {
    const e = {
      tag, className: '', hidden: false, attrs: {}, children: [], listeners: {}, textContent: '', title: '', parentNode: null,
      style: { props: {}, setProperty(k, v) { this.props[k] = String(v); } },
      classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
      addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, append(...cs) { for (const c of cs) this.appendChild(c); },
      insertBefore(c) { return this.appendChild(c); }, removeChild(c) { this.children.splice(this.children.indexOf(c), 1); },
      get firstChild() { return this.children[0]; }, remove() {}, contains: () => false, querySelector: () => null, focus() {},
    };
    made.push(e);
    return e;
  };
  const body = node('body');
  const ui = node('div');
  const band = node('div');
  // The band sits at the room button's place: from the right edge at a right corner, from the left at a left one.
  const dims = { room };
  band.getBoundingClientRect = () => {
    const pill = band.children.find((c) => c.attrs['data-chat-toggle'] !== undefined);
    const w = dims.room + 8 + (pill && pill.classList.contains('icon-only') ? 34 : 73);
    const at = share.at ?? 'top-right';
    const left = at.endsWith('right') ? ctx.innerWidth - 8 - w : at.endsWith('center') ? (ctx.innerWidth - w) / 2 : 8;
    return { left, right: left + w, width: w, top: 8, bottom: 42 };
  };
  const timers = [];
  const listeners = {};
  const ctx = {
    document: {
      body,
      querySelector: (s) => (s === '[data-room-ui] .pills' ? band : s === '[data-room-ui]' ? ui : null),
      createElement: node, addEventListener() {}, createTextNode: (t) => ({ textContent: t }),
    },
    localStorage: { getItem: () => null, setItem() {} },
    innerWidth: width, innerHeight: height, performance: { now: () => 0 },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: (fn) => { timers.push({ fn, ms: 16 }); return timers.length; },
    addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn); },
    __shell: surface === 'play' ? { share: { ...share }, seat: null } : undefined,
    __HOMIE_CHAT: chatBoot(g, { surface }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHAT_JS, ctx);
  const st = ctx.__homieChat;
  st.socket({ readyState: 1, send() {} }, 'pub-3');
  st.facts({ t: 'net', policy: { chat: { mode: 'text', who: 'anyone', react: 'anyone', lines: [{ id: 'hi', text: 'Hi!' }], max: 140 } } });
  const pill = band.children.find((c) => c.attrs['data-chat-toggle'] !== undefined) ?? null;
  const badge = pill?.children.find((c) => c.className === 'cbadge') ?? null;
  return {
    st, ctx, band, pill, badge, body, dims,
    icon: () => Boolean(pill?.classList.contains('icon-only')),
    say: (text, id = `l${Math.random().toString(36).slice(2, 8)}`) => st.receive({ t: 'line', id, name: 'Ada', text, seat: 2 }),
    strip: () => made.find((e) => /^ctick at-/.test(e.className)) ?? null,
    corner: () => made.find((e) => /^ctv at-/.test(e.className)) ?? null,
    run: () => { for (const t of timers.splice(0)) if (t.ms <= 60) t.fn(); },
    resize: (w, h, next = {}) => { ctx.innerWidth = w; ctx.innerHeight = h; Object.assign(ctx.__shell.share, next); for (const fn of listeners.resize ?? []) fn(); },
  };
}

test('the Chat pill follows the room button: the round icon on a phone and beside a room button kept an icon; the count on its corner', () => {
  const desk = chatPage();
  assert.ok(desk.pill, 'the pill is in the room button\'s band');
  assert.equal(desk.icon(), false, 'a computer with room: the word shows, as before');
  assert.equal(desk.pill.attrs['aria-label'], 'Room chat');
  for (const device of ['phone', 'sideways']) {
    const p = chatPage({ share: { device, at: 'top-right', x: 0, y: 0, label: true }, width: device === 'phone' ? 390 : 844, height: device === 'phone' ? 844 : 390 });
    assert.equal(p.icon(), true, `${device}: the round icon from the start`);
    assert.equal(p.pill.title, 'Room chat', 'the icon says what it is');
  }
  const kept = chatPage({ share: { device: 'desk', at: 'top-left', x: 0, y: 0, label: false } });
  assert.equal(kept.icon(), true, 'game.json screen.share "label": false keeps the room button an icon, and the pill with it');
  // The count of new lines: on the icon too.
  const phone = chatPage({ share: { device: 'phone', at: 'top-left', x: 0, y: 0, label: false }, width: 390, height: 844 });
  phone.say('first');
  phone.say('second');
  assert.equal(phone.badge.hidden, false);
  assert.equal(phone.badge.textContent, '2');
  // The style: the icon is the room button's 34 px circle, its word goes, the count rides its corner.
  assert.match(CHAT_CSS, /\.cpill\.icon-only, \.cpill\.icon-only:hover, \.cpill\.icon-only:focus-visible, \.cpill\.icon-only\[aria-expanded="true"\] \{ position: relative; width: 34px; padding: 0; justify-content: center; \}/);
  assert.match(CHAT_CSS, /\.cpill\.icon-only span\.cword \{ display: none; \}/);
  assert.match(CHAT_CSS, /\.cpill\.icon-only \.cbadge \{ position: absolute; top: -5px; right: -5px;/);
});

test('on a computer the word goes where it would reach the middle third or leave the screen, and stays gone until the screen changes size', () => {
  // A right corner: with its word the band (the room button 90, a gap 8, the pill 73) starts at width - 179, and the
  // middle third ends at two thirds of the width. 1280: 1101 against 853; 600: 421 against 400; 520: 341 against 347.
  assert.equal(chatPage({ width: 1280 }).icon(), false);
  assert.equal(chatPage({ width: 600 }).icon(), false, 'out of the middle third: the word');
  assert.equal(chatPage({ width: 520 }).icon(), true, 'with the word the band would reach the middle third: the icon');
  // A left corner reads from the left: the band's right edge must stay inside the first third.
  assert.equal(chatPage({ width: 520, share: { device: 'desk', at: 'top-left', x: 0, y: 0, label: true } }).icon(), true);
  assert.equal(chatPage({ width: 900, share: { device: 'desk', at: 'top-left', x: 0, y: 0, label: true } }).icon(), false);
  // The top's middle: only the screen's edges.
  assert.equal(chatPage({ width: 520, share: { device: 'desk', at: 'top-center', x: 0, y: 0, label: true } }).icon(), false, 'the game gave the band the middle');
  assert.equal(chatPage({ width: 170, share: { device: 'desk', at: 'top-center', x: 0, y: 0, label: true } }).icon(), true, 'off the screen\'s edges: the icon');
  // Sticky: the room button's label made the band reach the middle third; once it fades to its dot the band is short
  // again, and the word still does not come back (no flicker as the label comes and goes)...
  const p = chatPage({ width: 600, room: 140 });
  assert.equal(p.icon(), true);
  p.dims.room = 34;
  p.st.fit();
  assert.equal(p.icon(), true);
  // ...a new screen size does (the room button moves first, then the word is measured afresh).
  p.resize(1280, 800);
  p.run();
  assert.equal(p.icon(), false, 'widened: the word again');
  p.resize(390, 844, { device: 'phone' });
  p.run();
  assert.equal(p.icon(), true, 'turned into a phone\'s width: the icon');
});

test('game.json screen.chat: the strip\'s place per device, moved in, past the room button, or kept in the sheet', () => {
  // Absent: as before (the bottom left; the bottom right when the room button is at the bottom left).
  const a = chatPage();
  a.say('hi');
  assert.equal(a.strip().className, 'ctick at-bottom-left');
  assert.deepEqual(a.strip().style.props, { '--chat-x': '0px', '--chat-y': '0px' });
  const b = chatPage({ share: { device: 'desk', at: 'bottom-left', x: 0, y: 0, label: true } });
  b.say('hi');
  assert.equal(b.strip().className, 'ctick at-bottom-right');
  // A string: every device, as before.
  const c = chatPage({ g: { id: 'g', name: 'G', screen: { chat: 'top-center' } } });
  c.say('hi');
  assert.equal(c.strip().className, 'ctick at-top-center');
  // Per device, moved in by x / y.
  const screen = { chat: { at: 'top-left', y: 120, desk: { at: 'bottom-right', x: 24 }, phone: { lines: 'sheet-only' }, sideways: { at: 'top-right', lines: 'strip' } } };
  const desk = chatPage({ g: { id: 'g', name: 'G', screen } });
  desk.say('hi');
  assert.equal(desk.strip().className, 'ctick at-bottom-right');
  assert.deepEqual(desk.strip().style.props, { '--chat-x': '24px', '--chat-y': '120px' }, 'a device changes only what it names');
  // "sheet-only": no strip, the line waits in the sheet and the pill counts it.
  const phone = chatPage({ g: { id: 'g', name: 'G', screen }, share: { device: 'phone', at: 'top-right', x: 0, y: 0, label: true }, width: 390, height: 844 });
  phone.say('hi');
  assert.equal(phone.strip(), null, 'no strip on a phone held upright');
  assert.equal(phone.badge.textContent, '1', 'the pill counts it');
  assert.equal(phone.st.lines.length, 1, 'the sheet has it');
  const side = chatPage({ g: { id: 'g', name: 'G', screen }, share: { device: 'sideways', at: 'top-right', x: 0, y: 40, label: true }, width: 844, height: 390 });
  side.say('hi');
  assert.equal(side.strip().className, 'ctick at-top-right', 'sideways takes its own over the phone\'s');
  assert.deepEqual(side.strip().style.props, { '--chat-x': '0px', '--chat-y': '160px' }, 'sharing the room button\'s place: past the button, by its own y too');
  // false: no strip anywhere (only the pill's count), as before.
  const off = chatPage({ g: { id: 'g', name: 'G', screen: { chat: false } } });
  off.say('hi');
  assert.equal(off.strip(), null);
  assert.equal(off.badge.textContent, '1');
});

test('the big screen: its corner from screen.chat (a corner only), moved in; its lines stay unless its own entry says "sheet-only"', () => {
  const tv = (chat) => { const p = chatPage({ surface: 'tv', g: { id: 'g', name: 'G', ...(chat === undefined ? {} : { screen: { chat } }) } }); p.say('hi'); return p.corner(); };
  assert.equal(tv(undefined).className, 'ctv at-bottom-left', 'as before');
  assert.equal(tv('top-right').className, 'ctv at-top-right', 'a corner string, as before');
  assert.equal(tv('top-center').className, 'ctv at-bottom-left', 'the middle of an edge is not a corner: as before');
  assert.equal(tv(false).className, 'ctv at-bottom-left', 'false is the play page\'s: the big screen keeps its lines');
  assert.equal(tv({ lines: 'sheet-only' }).className, 'ctv at-bottom-left', 'and so is the top level\'s "sheet-only"');
  const own = tv({ at: 'bottom-right', tv: { at: 'top-right', y: 40 } });
  assert.equal(own.className, 'ctv at-top-right');
  assert.deepEqual(own.style.props, { '--chat-x': '0px', '--chat-y': '40px' });
  assert.equal(tv({ tv: { lines: 'sheet-only' } }), null, 'its own "sheet-only": only the float');
});

test('chatPlaces and the build\'s check: every form, the defaults, and words that say what to fix', () => {
  const none = { at: null, x: 0, y: 0, lines: 'strip' };
  assert.deepEqual(chatPlaces(undefined), { desk: none, phone: none, sideways: none, tv: none });
  assert.deepEqual(CHAT_PLACES, ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']);
  assert.deepEqual(chatPlaces('bottom-right').phone, { ...none, at: 'bottom-right' });
  assert.deepEqual(chatPlaces('middle').desk, none, 'a place that is not one is the default');
  assert.deepEqual(chatPlaces(false).desk, { ...none, lines: 'sheet-only' });
  const p = chatPlaces({ at: 'top-center', x: -80, y: 9999, phone: false, sideways: { at: 'top-left' }, tv: { at: 'top-center' } });
  assert.deepEqual(p.desk, { at: 'top-center', x: -80, y: 600, lines: 'strip' }, 'offsets stay on the screen; the middle moves either way');
  assert.deepEqual(p.phone, { at: 'top-center', x: -80, y: 600, lines: 'sheet-only' }, 'false on a device: that device keeps lines in the sheet');
  assert.deepEqual(p.sideways, { at: 'top-left', x: 0, y: 600, lines: 'sheet-only' }, 'sideways starts from the phone\'s; a corner moves only inwards');
  assert.deepEqual(p.tv, none, 'the big screen takes a corner only');
  assert.deepEqual(chatPlaces({ at: 'top-left', y: 30, lines: 'sheet-only' }).tv, { at: 'top-left', x: 0, y: 30, lines: 'strip' });
  // The build reads it and warns (the page uses the default there).
  assert.deepEqual(screenChatProblems(undefined), []);
  assert.deepEqual(screenChatProblems('bottom-right'), []);
  assert.deepEqual(screenChatProblems({ at: 'top-left', y: 120, lines: 'sheet-only', phone: false, desk: 'bottom-right', tv: { at: 'top-right' } }), []);
  const bad = screenChatProblems({ corner: 'top-right', lines: 'none', x: 'far', phone: { at: 'middle' }, tv: { at: 'top-center' } });
  assert.deepEqual(bad, [
    'screen.chat.corner is not a field (the place is "at")',
    'screen.chat.x is a number of pixels',
    'screen.chat.lines is "strip" or "sheet-only"',
    'screen.chat.phone.at "middle" is not a place (top-left, top-center, top-right, bottom-left, bottom-center, bottom-right)',
    'screen.chat.tv.at: the big screen takes a corner',
  ]);
  assert.deepEqual(screenChatProblems('left'), ['screen.chat "left" is not a place (top-left, top-center, top-right, bottom-left, bottom-center, bottom-right)']);
  // game.json "chat" is the room's rules: a place or "sheet-only" there is pointed at screen.chat.
  assert.deepEqual(chatProblems({ corner: 'top-right', lines: 'sheet-only' }), [
    'chat.corner: where chat sits on the screen goes in "screen": { "chat": { "at": … } }',
    'chat.lines is the quick lines ({ "id": "text" }); "sheet-only" goes in "screen": { "chat": { "lines": "sheet-only" } }',
  ]);
  assert.deepEqual(chatProblems({ at: 1_700_000_000_000, lines: { gg: 'Good game!' } }), [], 'a rules layer\'s time is not a place');
});

test('the play page carries the places; the build passes screen.chat through and warns about a wrong field', async () => {
  const g = { id: 'rock-race', name: 'Rock Race', players: { max: 6 }, screen: { share: { phone: { at: 'top-left', label: false } }, chat: { phone: { lines: 'sheet-only' }, desk: { at: 'top-left', y: 130 } } } };
  const html = await playPage({ studio: { name: 'Night Owls' }, games: [] }, g).text();
  const boot = JSON.parse(/window\.__HOMIE_CHAT=(\{.*?\});<\/script>/.exec(html)[1]);
  assert.deepEqual(boot.places.phone, { at: null, x: 0, y: 0, lines: 'sheet-only' });
  assert.deepEqual(boot.places.desk, { at: 'top-left', x: 0, y: 130, lines: 'strip' });
  // A real build of a starter with a screen.chat.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-chat-place-')));
  try {
    const dir = join(scratch, 'owls');
    const made = spawnSync(process.execPath, [CLI, 'new', dir, '--name', 'Owls', '--homie', 'https://homie.test', '--no-install', '--json'], { cwd: scratch, encoding: 'utf8' });
    assert.equal(made.status, 0, made.stdout + made.stderr);
    mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
    symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
    symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
    assert.equal(spawnSync(process.execPath, [CLI, 'game', 'new', 'owl-run', '--from', 'gem-rush', '--json'], { cwd: dir, encoding: 'utf8' }).status, 0);
    const gj = join(dir, 'games', 'owl-run', 'game.json');
    const chat = { phone: { lines: 'sheet-only' }, desk: { at: 'top-left', y: 130 }, corner: 'top-right' };
    writeFileSync(gj, JSON.stringify({ ...JSON.parse(readFileSync(gj, 'utf8')), screen: { chat } }, null, 2));
    const b = spawnSync(process.execPath, [CLI, 'build'], { cwd: dir, encoding: 'utf8' });
    assert.equal(b.status, 0, b.stdout + b.stderr);
    assert.match(b.stderr, /warning: games\/owl-run\/game\.json: screen\.chat\.corner is not a field \(the place is "at"\); the play page uses the default there/);
    const row = JSON.parse(readFileSync(join(dir, 'site', 'dist', 'games.json'), 'utf8')).games.find((x) => x.id === 'owl-run');
    assert.deepEqual(row.screen.chat, chat, 'games.json carries it as written; the page reads it with chatPlaces');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
