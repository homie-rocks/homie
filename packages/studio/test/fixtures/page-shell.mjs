import vm from 'node:vm';
import { setTimeout as settleTimer } from 'node:timers';
import { playPage, watchPage } from '../../worker/pages.mjs';
const cat = { studio: { name: 'Night Owls', theme: { accent: '#ffcf5a' } }, games: [] };
const game = { id: 'rock-race', name: 'Rock <Race>', players: { max: 6 } };

/** The play page's shell script, run against a stand-in page at `search`. */
export async function shell(search, { lobby = 'pub-3', screen = false, room = null, g = game, width = 1280, height = 800, server = null, storage = null, rects = {}, timers = null, watch = false } = {}) {
  const res = watch ? watchPage(cat, g, { room, server }) : playPage(cat, g, { screen, room, server });
  const html = await res.text();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const els = new Map();
  const el = (sel) => {
    if (sel === '[data-join]') return null;
    if (!els.has(sel)) {
      els.set(sel, {
        sel, textContent: '', hidden: /sheet|toast|results|screen/.test(sel), attrs: {}, listeners: {}, href: '', src: '', className: '',
        style: { props: {}, setProperty(k, v) { this.props[k] = String(v); } },
        classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); }, toggle() {} },
        setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
        addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }, querySelector: (s) => el(s), contains: () => false,
        append() {}, focus() {}, contentWindow: { focus() {}, postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))) },
        // Where the stand-in page draws this control (the shell tells the game's frame; nothing is drawn where none is given).
        getBoundingClientRect: () => { const r = rects[sel]; return r ? { left: r[0], top: r[1], width: r[2], height: r[3] } : { left: 0, top: 0, width: 0, height: 0 }; },
        // Room chat's component (0.23.0) builds its pill and sheet into the band: a stand-in takes them.
        appendChild(c) { return c; }, insertBefore(c) { return c; }, remove() {},
      });
    }
    return els.get(sel);
  };
  const session = new Map();
  const replaced = [];
  const fetched = [];
  const posted = [];
  /** Every element the page made itself (a notice's heading, its links), in order. */
  const drawn = [];
  const heard = {};
  const ctx = {
    document: { createTextNode: (textContent) => ({ textContent }), querySelector: el, createElement: () => { const made = el(`new-${Math.random()}`); drawn.push(made); return made; }, addEventListener() {}, createElementNS: () => el('svg'), body: { classList: { toggle() {}, remove() {}, add() {} }, appendChild(c) { return c; } } },
    location: { search, origin: 'https://owls.example', pathname: `/${game.id}/${screen ? 'tv' : 'play'}`, hash: '', host: 'owls.example', protocol: 'https:' },
    history: { state: null, replaceState: (s, t, u) => replaced.push(u) },
    sessionStorage: { getItem: (k) => session.get(k) ?? null, setItem(k, v) { session.set(k, v); } },
    navigator: {},
    WebSocket: class { constructor(u) { this.url = u; } },
    fetch: async (u, o) => { fetched.push([u, o?.method]); return { json: async () => ({ room: lobby }) }; },
    URL, URLSearchParams, setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; }, clearTimeout, setInterval() {}, clearInterval() {}, ...(timers ?? {}), innerWidth: width, innerHeight: height,
    addEventListener(type, fn) { (heard[type] ??= []).push(fn); },
    ...(storage ? { localStorage: storage } : {}),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const s of scripts) vm.runInContext(s, ctx);
  await new Promise((r) => settleTimer(r, 10));
  /** What the game's helper says to the page (postMessage from the frame). */
  const fromGame = (m) => { for (const fn of heard.message ?? []) fn({ source: el('iframe.game').contentWindow, data: { t: 'homie-net', ...m } }); };
  return { html, ctx, el, replaced, fetched, posted, heard, fromGame, drawn };
}
