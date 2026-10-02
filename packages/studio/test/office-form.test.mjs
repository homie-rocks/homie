/**
 * @homie-rocks/studio 0.16.1: the office's New server form (worker/office-page.mjs, DESIGN 7.2).
 *
 *   - every control is labelled, and the help under it is the policy copy the site and the play page say
 *     (servers.mjs POLICY_WORDS and KIDS_LINE, the vote card's level names);
 *   - only what applies shows: AI seats for hybrid, AI guides and Kids for beginner, no AI level on a humans-only
 *     server, and a beginner server's chat is quick lines or off;
 *   - kids keeps the level and its ceiling at Fair or gentler without forgetting what the owner chose;
 *   - the office's redraw every few seconds keeps what the owner set; Create sends exactly that, and the form closes.
 * The office script runs here against a small stand-in DOM (no browser needed); the same form was driven in Chrome.
 * Run: node --test packages/studio/test/office-form.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { OFFICE_SCRIPT } from '../worker/office-page.mjs';
import { KIDS_LINE, POLICY_WORDS } from '../worker/servers.mjs';

/** Just enough of a DOM for the office script: elements, text, classes, simple selectors, focus and clicks. */
function stage(data) {
  const doc = { activeElement: null, listeners: {} };
  const byId = {};
  const posts = [];
  const matchOne = (el, sel) => {
    const m = /^([a-z0-9]*)((?:\.[\w-]+|\[[^\]]+\])*)$/i.exec(sel.trim());
    if (!m || !el.tagName || el.tagName === '#TEXT') return false;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    for (const part of m[2].match(/\.[\w-]+|\[[^\]]+\]/g) ?? []) {
      if (part[0] === '.') { if (!el.cls.has(part.slice(1))) return false; continue; }
      const [, k, v] = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(part);
      const have = k in el.attrs ? el.attrs[k] : el[k] !== undefined && el[k] !== null && el[k] !== '' ? String(el[k]) : null;
      if (have === null || (v !== undefined && have !== v)) return false;
    }
    return true;
  };
  class El {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.attrs = {}; this.cls = new Set(); this.hidden = false; this._t = ''; this.style = { setProperty() {} }; this.value = ''; this.checked = false; this.disabled = false; this.type = ''; }
    get className() { return [...this.cls].join(' '); }
    set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() { const c = this.cls; return { add: (x) => c.add(x), remove: (x) => c.delete(x), contains: (x) => c.has(x), toggle: (x, on) => { const v = on === undefined ? !c.has(x) : Boolean(on); if (v) c.add(x); else c.delete(x); return v; } }; }
    appendChild(n) { if (n.parentNode) n.parentNode.children.splice(n.parentNode.children.indexOf(n), 1); n.parentNode = this; this.children.push(n); return n; }
    get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { for (const c of this.children) c.parentNode = null; this.children = []; this._t = String(v); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    matches(sel) { return sel.split(',').some((one) => matchOne(this, one)); }
    closest(sel) { for (let x = this; x; x = x.parentNode) if (x.matches(sel)) return x; return null; }
    querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
    get shown() { for (let x = this; x; x = x.parentNode) if (x.hidden) return false; return true; }
    focus() { doc.activeElement = this; }
    blur() { if (doc.activeElement === this) doc.activeElement = null; }
    click() {
      if (this.disabled) return;
      if (this.type === 'radio') {
        let form = this; while (form.parentNode) form = form.parentNode;
        for (const r of form.querySelectorAll('input')) if (r.type === 'radio' && r.name === this.name) r.checked = false;
        this.checked = true; this.onchange?.(); return;
      }
      if (this.type === 'checkbox') { this.checked = !this.checked; this.onchange?.(); return; }
      this.onclick?.({ target: this });
      if (this.type === 'submit') this.closest('form')?.onsubmit?.({ preventDefault() {} });
    }
  }
  const document = {
    get activeElement() { return doc.activeElement; },
    visibilityState: 'visible',
    createElement: (t) => new El(t),
    createTextNode: (t) => { const n = new El('#text'); n._t = String(t); return n; },
    getElementById: (id) => (byId[id] ??= Object.assign(new El('div'), { id })),
    addEventListener: (t, fn) => { (doc.listeners[t] ??= []).push(fn); },
  };
  const ctx = {
    document, navigator: {}, JSON, Math, Number, String, Date, Object, Array, Promise, encodeURIComponent,
    setTimeout: (fn, ms) => { if (!ms) queueMicrotask(fn); return 0; }, clearTimeout() {},
    confirm: () => true,
    fetch: async (url, opts = {}) => {
      if (opts.method === 'POST') { posts.push([url, JSON.parse(opts.body)]); return { json: async () => ({ ok: true }) }; }
      return { json: async () => data() };
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(OFFICE_SCRIPT, ctx);
  const settle = () => new Promise((r) => setTimeout(r, 5));
  return {
    root: document.getElementById('games'), posts, settle, doc,
    /** The office's next look (it reads /_studio/api/office every few seconds while the page is visible). */
    redraw: async () => { for (const fn of doc.listeners.visibilitychange ?? []) fn(); await settle(); },
  };
}

const office = () => ({
  ok: true, now: Date.now(), playing: 0, agentsTalk: false, fillSpot: null,
  games: [{
    id: 'gem-rush', name: 'Gem Rush', playing: 0, play: '/gem-rush/play', page: '/gem-rush/', launch: 'public', remix: true, remixBuilt: true, seats: 8, maxPlayers: 8,
    servers: [{ id: 'public', name: 'Quick play', policy: 'open', aiSeats: 0, guides: 0, kids: false, bots: 'fill', level: 3, levelMax: 5, door: 'open', state: 'open', line: POLICY_WORDS.open.line }],
    passes: [], invites: [], rooms: [],
  }],
});

test('the New server form: labelled, its policy\'s own words, only what applies, kept across a redraw, and Create sends it', async () => {
  const s = stage(office);
  await s.settle();
  const game = s.root.querySelector('section.game');
  assert.ok(game, 'the office drew the game');
  [...game.querySelectorAll('button')].find((b) => b.textContent === '+ New server').click();
  await s.settle();
  let form = s.root.querySelector('form.newsrv');
  assert.ok(form, 'the form opens');
  const name = () => form.querySelector('input[type=text]');
  assert.equal(s.doc.activeElement, name(), 'the name has the focus (the office never redraws under it)');
  const rowOf = (label) => form.querySelectorAll('.frow').find((r) => r.children[0].textContent === label);
  const radio = (v) => form.querySelectorAll('input').find((i) => i.type === 'radio' && i.value === v && /policy$/.test(i.name));
  const fieldset = (legend) => form.querySelectorAll('fieldset').find((f) => f.children[0].textContent === legend);
  const help = (label) => rowOf(label).children[1].querySelector('p.help')?.textContent ?? '';

  // Every control has its label.
  for (const label of ['Name', 'AI seats', 'Kids', 'Starts at', 'Ceiling', 'Door', 'Rooms', 'Listed', 'Chat']) assert.ok(rowOf(label), `a row labelled ${label}`);
  for (const id of ['name', 'ai', 'level', 'ceiling', 'rooms']) {
    const control = form.querySelector(`[id=ns-gem-rush-${id}]`);
    assert.ok(control && form.querySelectorAll('label').some((l) => l.htmlFor === control.id), `${id} has a <label for>`);
  }
  // The policy cards say the site's own words.
  const card = (p) => radio(p).parentNode;
  assert.equal(card('hybrid').children[1].textContent, 'Hybrid · 2');
  assert.equal(card('hybrid').children[2].textContent, '2 seats in every room are AI companions, always marked AI. Your party sets their level.');
  assert.equal(card('humans-only').children[2].textContent, 'Every player here is a person. AI can\'t join.');
  assert.equal(card('beginner').children[2].textContent, 'F' + POLICY_WORDS.beginner.line.slice('Beginner: f'.length));

  // Hybrid (the default): AI seats, no Kids, a level.
  name().value = 'Night Owls'; name().oninput();
  assert.match(help('Name'), /Its page: \/gem-rush\/s\/night-owls\//);
  assert.ok(rowOf('AI seats').shown && !rowOf('Kids').shown && fieldset('AI level').shown);
  assert.match(help('AI seats'), /^2 of the 8 seats in every room are AI companions, always marked AI; people take the other 6/);

  // Beginner: AI guides and Kids; chat is quick lines or off.
  radio('beginner').click();
  assert.ok(rowOf('AI guides').shown && rowOf('Kids').shown, 'guides and kids show for a beginner server');
  assert.match(help('Kids'), new RegExp(`^${KIDS_LINE}`));
  const chatOption = (v) => rowOf('Chat').querySelectorAll('input').find((i) => i.value === v);
  assert.equal(chatOption('game').parentNode.hidden, true, 'no free chat on a beginner server');
  assert.equal(chatOption('lines').checked, true);
  assert.equal(form.querySelector('[id=ns-gem-rush-level]').value, '2', 'a beginner server starts its AI at Steady');
  rowOf('Kids').querySelector('input').click();
  assert.equal(form.querySelector('[id=ns-gem-rush-ceiling]').max, '3', 'kids: the ceiling is Fair at most');
  assert.equal(form.querySelector('[id=ns-gem-rush-ceiling]').value, '3');
  form.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'More AI seats').click();
  assert.equal(form.querySelector('[id=ns-gem-rush-ai]').value, '3');

  // The office looks again (focus elsewhere): what the owner set is still there.
  s.doc.activeElement = null;
  await s.redraw();
  const again = s.root.querySelector('form.newsrv');
  assert.notEqual(again, form, 'the office drew the form anew');
  form = again;
  assert.equal(name().value, 'Night Owls');
  assert.equal(radio('beginner').checked, true);
  assert.equal(form.querySelector('[id=ns-gem-rush-ai]').value, '3');
  assert.equal(rowOf('Kids').querySelector('input').checked, true);

  // Humans only: no AI seats, no kids, no AI level; a plain note says why.
  radio('humans-only').click();
  assert.ok(!rowOf('AI seats').shown && !rowOf('Kids').shown && !fieldset('AI level').shown);
  assert.match(fieldset('AI in every room').querySelector('p.note').textContent, /^No AI can join/);
  // Open: the ceiling the owner chose comes back (kids held it at Fair only on the beginner server).
  radio('open').click();
  assert.equal(form.querySelector('[id=ns-gem-rush-ceiling]').value, '5');

  // Create sends what the form shows, and the form closes.
  radio('beginner').click();
  form.querySelectorAll('button').find((b) => b.textContent === 'Create').click();
  await s.settle();
  assert.deepEqual(s.posts, [['/_studio/api/servers', { game: 'gem-rush', name: 'Night Owls', policy: 'beginner', door: 'open', level: 2, levelMax: 3, speech: 'lines', rooms: 4, listed: true, guides: 3, kids: true }]]);
  assert.equal(s.root.querySelector('form.newsrv'), null, 'the form closes once the server is open');
});
