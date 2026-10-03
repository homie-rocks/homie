/**
 * ROOM CHAT (@homie-rocks/studio 0.23.0, NETPLAY.md section 19): what a room's chat allows, the floor every typed
 * message passes before anyone sees it, and the studio's own Cloudflare decision model that reviews it. Pure: no
 * Worker import and no Node built-in, so the relay (room.mjs), the Worker, the build, the office and the tests use it
 * as it is.
 *
 *   rules       what a room allows: `mode` off | emoji | lines | text (each allows what the one before it does),
 *               who may type (`who`) and who may react or send a quick line (`react`): anyone | signed-in | members,
 *               slow mode, the length, links, swears, the AI review, bubbles over characters, watchers, homie.rocks.
 *               The game's game.json "chat" sets its defaults; the owner's office overrides them per game and per
 *               server; a server's speech (quick lines, off) and kids mode cap them.
 *   floor       every typed message, before anything else: a short built-in list (slurs, sexual words, telling someone
 *               to hurt themselves, moving a player to another app), contact details (an email, a phone number),
 *               links, swears, and the studio's own words. It always runs, and it needs nothing.
 *   review      typed text the floor let through, on the studio's own Workers AI: Cloudflare's Clef decision model
 *               (`@cf/cloudflare/clef-flash`, launched 2026-10-01: a probability for each answer, about 40 ms), within a
 *               day's budget of neurons. Under `homie-studio dev` with no binding, the same questions go to the person's
 *               own Ollama (clef-flash) when dev found it there: free. No model, no budget left or an error: the floor
 *               alone decides.
 *
 * Emoji and quick lines are the studio's own words: they never need a review, so they reach every screen at once.
 * NOTHING is stored here: the relay keeps a short window in memory (section 19), and a report keeps only the message.
 * A room keeps its words longer only when its owner turns `history` on (a number of days, 0.29.0; off for every game
 * by default, never on a kids server): then the Table writes what was said, never a reaction, to the studio's own D1
 * (worker/lounge-store.mjs) and forgets it after that many days.
 */
import { WORDS_B64 } from './chat-words.mjs';
import { clefRun, localAiOf } from './brain.mjs';

export const CHAT_MODES = Object.freeze(['off', 'emoji', 'lines', 'text']);
export const CHAT_WHO = Object.freeze(['anyone', 'signed-in', 'members']);
const RANK = Object.freeze({ off: 0, emoji: 1, lines: 2, text: 3 });

/**
 * The reactions every Homie room has, in the order homie.rocks's room page shows them (its TV float draws the same
 * five): the kind on the wire, the glyph on the screen. A game may add up to three of its own.
 */
export const REACTIONS = Object.freeze([
  Object.freeze({ k: 'fire', e: '🔥' }),
  Object.freeze({ k: 'clap', e: '👏' }),
  Object.freeze({ k: 'laugh', e: '😂' }),
  Object.freeze({ k: 'heart', e: '❤️' }),
  Object.freeze({ k: 'wow', e: '🤯' }),
]);
/** The quick lines a game gets when its game.json names none: short, kind, and fine for every age. */
export const DEFAULT_LINES = Object.freeze([
  Object.freeze({ id: 'hi', text: 'Hi!' }),
  Object.freeze({ id: 'gg', text: 'Good game!' }),
  Object.freeze({ id: 'nice', text: 'Nice one!' }),
  Object.freeze({ id: 'go', text: 'Let\'s go!' }),
  Object.freeze({ id: 'wait', text: 'Wait for me!' }),
  Object.freeze({ id: 'help', text: 'Help!' }),
  Object.freeze({ id: 'thanks', text: 'Thanks!' }),
  Object.freeze({ id: 'again', text: 'Again?' }),
]);

export const CHAT_LIMITS = Object.freeze({
  /** A typed message: `max` is the room's, at most this (homie.rocks's LINE_MAX). */
  text: 280, minText: 20, name: 24,
  lineText: 60, lines: 12, extraEmoji: 3, words: 64, word: 32, slowMax: 120,
  /** `history`: the most days a room may keep what was said (0, the default, keeps nothing past the window). */
  historyMax: 90,
  /** The room's window: the last `keep` messages from the last `keepMs` (memory only), for a page that just opened. */
  keep: 50, keepMs: 15 * 60_000,
  /** The same words from the same person within this long are not sent again. */
  repeatMs: 30_000,
  /** How long a typed message may wait for the review; past it the floor alone decides. Messages waiting at once. */
  reviewMs: 1500, pending: 8,
});
/**
 * Token buckets (homie.rocks's room chat is 5 at once, then one every 2 s). Reactions refill faster: a burst of
 * fire is the point. A network address shares one bigger bucket across its sockets. A room fans out at most so many
 * reactions a second (the float draws at most six a second anyway).
 */
export const CHAT_RATES = Object.freeze({
  react: Object.freeze({ burst: 6, refillMs: 400 }),
  say: Object.freeze({ burst: 4, refillMs: 2000 }),
  address: Object.freeze({ burst: 30, refillMs: 150 }),
  roomReactsPerSecond: 40,
});

/** A game with no "chat" in its game.json: emoji and quick lines for everyone, typing for signed-in players (reviewed). */
export const CHAT_DEFAULTS = Object.freeze({
  mode: 'text', who: 'signed-in', react: 'anyone', slow: 2, max: 140, links: 'block', swears: 'block', ai: true,
  bubbles: true, watchers: true, hub: true, history: 0,
});

/** How long a room with these rules keeps what was said: its `history` days, else the window's few minutes. */
export const windowMsOf = (rules) => (rules?.history > 0 ? rules.history * 86_400_000 : CHAT_LIMITS.keepMs);

const ID = /^[a-z][a-z0-9_]{0,15}$/;
const PICTO = /\p{Extended_Pictographic}/u;
const oneLine = (v, max) => [...String(v ?? '').normalize('NFKC').replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u2028\u2029]+/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();

/** One emoji, as a game may add one: a short run with a pictograph in it (a flag, a skin tone, a ZWJ family). */
function glyphOk(g) {
  const s = String(g ?? '');
  return s.length >= 1 && s.length <= 16 && PICTO.test(s) && !/[\p{L}\p{N}\s<>&"'`]/u.test(s.replace(/\p{Extended_Pictographic}|[\u200d\ufe0f\u{1f3fb}-\u{1f3ff}\u{1f1e6}-\u{1f1ff}⃣#*0-9]/gu, ''));
}

/** Words a studio adds (blocked) or lets through (allowed): lowercase, one word or a short phrase, `word*` inside words. */
function wordList(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\n]/) : [];
  const out = [];
  for (const w of list) {
    const s = oneLine(w, CHAT_LIMITS.word).toLowerCase();
    if (s && /[\p{L}\p{N}]/u.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= CHAT_LIMITS.words) break;
  }
  return out;
}

/** The game's extra reactions: `{ "gem": "💎" }` or `[{ "k": "gem", "e": "💎" }]`, at most three, never a built-in kind. */
function extraEmoji(raw) {
  const pairs = Array.isArray(raw) ? raw.map((x) => [x?.k, x?.e]) : raw && typeof raw === 'object' ? Object.entries(raw) : [];
  const out = [];
  for (const [k, e] of pairs) {
    if (!ID.test(String(k ?? '')) || REACTIONS.some((r) => r.k === k) || out.some((r) => r.k === k) || !glyphOk(e)) continue;
    out.push({ k: String(k), e: String(e) });
    if (out.length >= CHAT_LIMITS.extraEmoji) break;
  }
  return out;
}

/** The game's quick lines: `{ "gg": "Good game!" }` or `[{ "id", "text" }]`; at most 12, each passes the floor. */
function quickLines(raw) {
  if (raw === undefined || raw === null) return DEFAULT_LINES.map((l) => ({ ...l }));
  const pairs = Array.isArray(raw) ? raw.map((x) => [x?.id, x?.text]) : typeof raw === 'object' ? Object.entries(raw) : [];
  const out = [];
  for (const [id, text] of pairs) {
    const t = oneLine(text, CHAT_LIMITS.lineText);
    if (!ID.test(String(id ?? '')) || !t || out.some((l) => l.id === id) || !floor(t, { swears: 'block', links: 'block' }).ok) continue;
    out.push({ id: String(id), text: t });
    if (out.length >= CHAT_LIMITS.lines) break;
  }
  return out;
}

/**
 * A room's chat rules, every field checked (a bad one never breaks a room). `kids` and `speech` are the server's:
 * speech `lines` (a beginner server) or kids keeps chat to emoji and quick lines; speech `off` turns it off.
 */
export function normalizeChat(raw, { kids = false, speech = 'game' } = {}) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const pick = (k, list) => (list.includes(r[k]) ? r[k] : CHAT_DEFAULTS[k]);
  const bool = (k) => (r[k] === undefined || r[k] === null ? CHAT_DEFAULTS[k] : r[k] === true || r[k] === 'on' || r[k] === 1);
  const int = (v, lo, hi, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  let mode = r.mode === false ? 'off' : pick('mode', CHAT_MODES);
  const cap = speech === 'off' ? 'off' : speech === 'lines' || kids ? 'lines' : 'text';
  const why = speech === 'off' ? 'server-off' : kids ? 'kids' : 'server-lines';
  // Capped now, or capped before (rules the Worker already capped keep saying why when the room reads them again).
  const capped = RANK[mode] > RANK[cap] || (r.capped === why && RANK[mode] === RANK[cap]) ? why : null;
  if (capped) mode = cap;
  return {
    v: 1, at: Math.max(0, Number(r.at) || 0), mode,
    who: pick('who', CHAT_WHO), react: pick('react', CHAT_WHO),
    slow: int(r.slow, 0, CHAT_LIMITS.slowMax, CHAT_DEFAULTS.slow),
    max: int(r.max, CHAT_LIMITS.minText, CHAT_LIMITS.text, CHAT_DEFAULTS.max),
    links: r.links === 'allow' ? 'allow' : 'block',
    swears: r.swears === 'allow' ? 'allow' : 'block',
    ai: bool('ai'), bubbles: bool('bubbles'), watchers: bool('watchers'), hub: bool('hub'),
    // Kept words (0.29.0): only when the owner asks, never on a kids server or a capped one, never with chat off.
    history: kids || capped || mode === 'off' ? 0 : int(r.history, 0, CHAT_LIMITS.historyMax, CHAT_DEFAULTS.history),
    emoji: [...REACTIONS.map((x) => ({ ...x })), ...extraEmoji(r.emoji)],
    lines: quickLines(r.lines),
    block: wordList(r.block), allow: wordList(r.allow),
    kids: Boolean(kids), ...(capped ? { capped } : {}),
  };
}

/** What every client is told (the policy's `chat`): the rules without the studio's own word lists. */
export function publicChat(rules) {
  if (!rules) return null;
  const { block: _b, allow: _a, ...rest } = rules;
  return rest;
}

/**
 * A room's rules from its layers: the game's game.json "chat", then the owner's for the game, then the owner's for this
 * server (each replaces what it names), capped by the server's speech and kids. `at` is the newest owner's change.
 */
export function composeChat({ game = null, office = null, server = null, kids = false, speech = 'game' } = {}) {
  const layer = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  const { at: a1 = 0, ...o } = layer(office);
  const { at: a2 = 0, ...s } = layer(server);
  return normalizeChat({ ...layer(game), ...o, ...s, at: Math.max(Number(a1) || 0, Number(a2) || 0) }, { kids, speech });
}

/** What may be sent in this mode: a reaction (emoji and up), a quick line (lines and up), typed text (text). */
export function allows(rules, kind) {
  const m = RANK[rules?.mode] ?? 0;
  return kind === 'react' ? m >= 1 : kind === 'line' ? m >= 2 : kind === 'text' ? m >= 3 : false;
}

/** An owner's change from the office (or the API): `{ ok, fields }` with only what was given, or `{ ok: false, message }`. */
export function checkChatRules(body) {
  const bad = (message) => ({ ok: false, error: 'bad-request', message });
  const f = {};
  const b = body && typeof body === 'object' ? body : {};
  if (b.mode !== undefined) { if (!CHAT_MODES.includes(b.mode)) return bad('mode is off, emoji, lines or text'); f.mode = b.mode; }
  for (const k of ['who', 'react']) if (b[k] !== undefined) { if (!CHAT_WHO.includes(b[k])) return bad(`${k} is anyone, signed-in or members`); f[k] = b[k]; }
  if (b.slow !== undefined) { const n = Math.floor(Number(b.slow)); if (!Number.isFinite(n) || n < 0 || n > CHAT_LIMITS.slowMax) return bad(`slow is 0 to ${CHAT_LIMITS.slowMax} seconds`); f.slow = n; }
  if (b.max !== undefined) { const n = Math.floor(Number(b.max)); if (!Number.isFinite(n) || n < CHAT_LIMITS.minText || n > CHAT_LIMITS.text) return bad(`max is ${CHAT_LIMITS.minText} to ${CHAT_LIMITS.text} characters`); f.max = n; }
  if (b.history !== undefined) { const n = Math.floor(Number(b.history)); if (!Number.isFinite(n) || n < 0 || n > CHAT_LIMITS.historyMax) return bad(`history is 0 (keep nothing) to ${CHAT_LIMITS.historyMax} days`); f.history = n; }
  if (b.links !== undefined) { if (!['block', 'allow'].includes(b.links)) return bad('links is block or allow'); f.links = b.links; }
  if (b.swears !== undefined) { if (!['block', 'allow'].includes(b.swears)) return bad('swears is block or allow'); f.swears = b.swears; }
  for (const k of ['ai', 'bubbles', 'watchers', 'hub']) if (b[k] !== undefined) f[k] = b[k] === true || b[k] === 'on' || b[k] === 'true';
  if (b.block !== undefined) f.block = wordList(b.block);
  if (b.allow !== undefined) f.allow = wordList(b.allow);
  if (b.lines !== undefined) { if (b.lines !== null && typeof b.lines !== 'object') return bad('lines is { "id": "text" }'); f.lines = b.lines === null ? null : quickLines(b.lines); }
  if (b.emoji !== undefined) f.emoji = extraEmoji(b.emoji);
  return { ok: true, fields: f };
}

/** A game.json "chat" as the build checks it: the problems in words (an empty list is fine). */
export function chatProblems(raw) {
  if (raw === undefined) return [];
  if (raw === false) return [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['"chat" is an object (or false for no chat)'];
  const out = [];
  if (raw.mode !== undefined && !CHAT_MODES.includes(raw.mode)) out.push('chat.mode is off, emoji, lines or text');
  if (raw.history !== undefined && !(Number.isInteger(raw.history) && raw.history >= 0 && raw.history <= CHAT_LIMITS.historyMax)) out.push(`chat.history is a number of days, 0 to ${CHAT_LIMITS.historyMax} (0 keeps nothing past the room's few minutes)`);
  for (const k of ['who', 'react']) if (raw[k] !== undefined && !CHAT_WHO.includes(raw[k])) out.push(`chat.${k} is anyone, signed-in or members`);
  // Where chat sits on the screen is the page's (game.json "screen": { "chat" }), never the room's rules.
  for (const k of ['corner', 'place', 'at']) if (raw[k] !== undefined && (k !== 'at' || typeof raw.at === 'string')) out.push(`chat.${k}: where chat sits on the screen goes in "screen": { "chat": { "at": … } }`);
  if (raw.lines === 'strip' || raw.lines === 'sheet-only') out.push(`chat.lines is the quick lines ({ "id": "text" }); "${raw.lines}" goes in "screen": { "chat": { "lines": "${raw.lines}" } }`);
  else if (raw.lines !== undefined && raw.lines !== null) {
    const pairs = Array.isArray(raw.lines) ? raw.lines.map((x) => [x?.id, x?.text]) : typeof raw.lines === 'object' ? Object.entries(raw.lines) : null;
    if (!pairs) out.push('chat.lines is { "id": "text" }');
    else {
      if (pairs.length > CHAT_LIMITS.lines) out.push(`chat.lines: at most ${CHAT_LIMITS.lines}`);
      for (const [id, text] of pairs) {
        if (!ID.test(String(id ?? ''))) out.push(`chat.lines: "${oneLine(id, 20)}" is not an id (a-z, 0-9 and _, 16 at most)`);
        else if (!oneLine(text, CHAT_LIMITS.lineText)) out.push(`chat.lines.${id} has no text`);
        else if (String(text).length > CHAT_LIMITS.lineText) out.push(`chat.lines.${id} is over ${CHAT_LIMITS.lineText} characters`);
        else if (!floor(oneLine(text, CHAT_LIMITS.lineText), { swears: 'block', links: 'block' }).ok) out.push(`chat.lines.${id} does not pass the chat floor (a word, a link or contact details)`);
      }
    }
  }
  if (raw.emoji !== undefined) {
    const pairs = Array.isArray(raw.emoji) ? raw.emoji.map((x) => [x?.k, x?.e]) : raw.emoji && typeof raw.emoji === 'object' ? Object.entries(raw.emoji) : null;
    if (!pairs) out.push('chat.emoji is { "kind": "💎" }');
    else for (const [k, e] of pairs) if (!ID.test(String(k ?? '')) || !glyphOk(e)) out.push(`chat.emoji: "${oneLine(k, 20)}" needs an id and one emoji`);
  }
  return out.slice(0, 8);
}

/* ------------------------------------------------------------------ the floor */

let WORDS = null;
/** The built-in list (worker/chat-words.mjs), decoded once. */
export function builtinWords() {
  if (WORDS) return WORDS;
  const text = typeof atob === 'function' ? new TextDecoder().decode(Uint8Array.from(atob(WORDS_B64), (c) => c.charCodeAt(0))) : '';
  const raw = JSON.parse(text);
  const norm = (list) => (list ?? []).map((w) => tokens(matchForm(w)).join(' ')).filter(Boolean);
  WORDS = Object.freeze({
    slurs: new Set(norm(raw.slurs)), slursAnywhere: norm(raw.slursAnywhere),
    sexual: new Set(norm(raw.sexual)), sexualAnywhere: norm(raw.sexualAnywhere),
    swears: new Set(norm(raw.swears)), swearsAnywhere: norm(raw.swearsAnywhere),
    harm: norm(raw.harm), contact: norm(raw.contact),
  });
  return WORDS;
}

/** Letters a filter is dodged with: digits and signs for letters, and look-alike letters from other scripts. */
const LEET = Object.freeze({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'l', '€': 'e', '£': 'l', '+': 't' });
const LOOK = Object.freeze({ а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ѕ: 's', к: 'k', м: 'm', т: 't', в: 'b', н: 'h', ӏ: 'l', ј: 'j', ԁ: 'd', ɡ: 'g', ı: 'i', ο: 'o', α: 'a', ε: 'e', ν: 'v', κ: 'k', τ: 't', ρ: 'p' });
/** Text as the floor reads it: lower case, no accents, look-alikes and leet made letters, everything else a space. */
export function matchForm(text) {
  const s = String(text ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
  let out = '';
  for (const ch of s) out += LOOK[ch] ?? LEET[ch] ?? (/[a-z]/.test(ch) ? ch : ' ');
  return out;
}
const tokens = (form) => form.split(/\s+/).filter(Boolean);
/** "f u c k", "f.u.c.k": three or more single letters in a row are read as one word too. */
function joinedSingles(list) {
  const out = [];
  let run = [];
  for (const t of [...list, '']) {
    if (t.length === 1) { run.push(t); continue; }
    if (run.length >= 3) out.push(run.join(''));
    run = [];
  }
  return out;
}
const hasDouble = (w) => /(.)\1/.test(w);
/** A word's readings: as typed, three or more of a letter as one or as two, and every double as one. */
function variants(t) {
  return [...new Set([t, t.replace(/(.)\1{2,}/g, '$1'), t.replace(/(.)\1{2,}/g, '$1$1'), t.replace(/(.)\1+/g, '$1')])];
}

const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]{0,62}\.(?:com|net|org|gg|io|co|me|tv|ly|xyz|app|dev|link|site|online|store|shop|live|info|biz|us|uk|ca|de|fr|ru|cn|jp|br|in|au|nl|pl|es|it|club|fun|game|games|chat|social|click|top|vip|win|bet|cc|to|sh|ai)\b|\b(?:dot|d0t)\s*(?:com|net|org|gg)\b/i;
const EMAIL = /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/;

/**
 * The floor: `{ ok: true }`, or `{ ok: false, why }` with `why` one of words, harm, contact, link, swears. Whole words
 * and phrases, and a few that are held even inside another word. `rules` brings the room's links and swears and the
 * studio's own `block` and `allow` words.
 */
export function floor(text, rules = {}) {
  const W = builtinWords();
  const form = matchForm(text);
  const list = tokens(form);
  const allow = new Set((rules.allow ?? []).map((w) => tokens(matchForm(w)).join(' ')).filter(Boolean));
  const words = [...list, ...joinedSingles(list)].filter((t) => !allow.has(t));
  const reads = words.flatMap(variants);
  const flat = ` ${list.join(' ')} `;
  const whole = (set) => reads.some((v) => set.has(v));
  const inside = (subs) => reads.some((v) => subs.some((s) => v.includes(s)));
  const phrase = (list2) => list2.some((p) => !allow.has(p) && flat.includes(` ${p} `));
  if (whole(W.slurs) || inside(W.slursAnywhere)) return { ok: false, why: 'words' };
  if (phrase(W.harm)) return { ok: false, why: 'harm' };
  if (whole(W.sexual) || inside(W.sexualAnywhere)) return { ok: false, why: 'words' };
  const raw = String(text ?? '');
  if (phrase(W.contact) || EMAIL.test(raw) || PHONE.test(raw)) return { ok: false, why: 'contact' };
  if (rules.links !== 'allow' && LINK.test(raw)) return { ok: false, why: 'link' };
  if (rules.swears !== 'allow' && (whole(W.swears) || inside(W.swearsAnywhere))) return { ok: false, why: 'swears' };
  for (const b of rules.block ?? []) {
    const star = b.endsWith('*');
    const w = tokens(matchForm(star ? b.slice(0, -1) : b)).join(' ');
    if (!w) continue;
    if (w.includes(' ') ? flat.includes(` ${w} `) : star ? inside([w]) : reads.includes(w)) return { ok: false, why: 'words' };
  }
  return { ok: true };
}

/** A typed message as it goes out: one line, no control or invisible characters (a joiner inside an emoji stays). */
export function cleanText(raw, max = CHAT_LIMITS.text) {
  const keep = String(raw ?? '').normalize('NFKC')
    .replace(/[\p{Cc}\p{Co}\p{Cs}\u2028\u2029]+/gu, ' ')
    .replace(/(\p{Extended_Pictographic}\ufe0f?)\u200d(?=\p{Extended_Pictographic})/gu, '$1\u{e000}')
    .replace(/\p{Cf}+/gu, '')
    .replace(/\u{e000}/gu, '\u200d')
    .replace(/\s+/g, ' ').trim();
  return [...keep].slice(0, Math.max(1, max)).join('').trim();
}

/** What a sender is told when a message is not sent (the shell says it; the reason stays a word on the wire). */
export const HELD_WORDS = Object.freeze({
  off: 'Chat is off in this room.',
  emoji: 'This room keeps chat to emoji.',
  lines: 'This room keeps chat to emoji and quick lines.',
  'sign-in': 'Sign in to type here. Emoji are open to everyone.',
  'sign-in-react': 'Sign in to chat in this room.',
  members: 'Only members of this server can type here.',
  'members-react': 'Only members of this server can chat here.',
  watchers: 'Watchers read the chat here; only players send.',
  hub: 'This room\'s chat stays on the studio\'s own site.',
  muted: 'The studio muted you: your chat reaches nobody for now.',
  slow: 'One line at a time.',
  repeat: 'You just said that.',
  words: 'Not sent: it has a word this game doesn\'t allow.',
  harm: 'Not sent: this game doesn\'t allow that.',
  contact: 'Not sent: no personal questions, contact details or other apps in game chat.',
  link: 'Not sent: links aren\'t allowed in this room\'s chat.',
  swears: 'Not sent: this game keeps chat clean.',
  ai: 'Not sent: the studio\'s filter held that message.',
  busy: 'Chat is busy right now; try again in a moment.',
  ai_seat: 'An AI never types in room chat.',
  unknown: 'That is not one of this room\'s reactions or lines.',
  empty: 'Nothing to send.',
});

/* ------------------------------------------------------------------ the review: Cloudflare's decision models */

/** The default model (var HOMIE_CHAT_MODEL changes it), and what each costs in neurons per million input tokens. */
export const CHAT_MODEL = '@cf/cloudflare/clef-flash';
export const CHAT_MODELS = Object.freeze({
  // Clef: Cloudflare's decision models (2026-10-01). $0.09 / $0.24 per M input tokens, no output charge
  // (Workers AI pricing, 2026-10-02: $0.011 per 1,000 neurons).
  '@cf/cloudflare/clef-flash': Object.freeze({ kind: 'clef', name: 'clef-flash', input: 8182, output: 0 }),
  '@cf/cloudflare/clef': Object.freeze({ kind: 'clef', name: 'clef', input: 21818, output: 0 }),
  // Llama Guard 3: Meta's fixed safety categories (no insults or bullying among them), about 500 ms.
  '@cf/meta/llama-guard-3-8b': Object.freeze({ kind: 'guard', input: 44003, output: 2730 }),
});
/** What a studio's chat review may use a day (meta `chat_budget`): with the AI guides' 8,000, the 10,000 free a day. */
export const CHAT_BUDGET = Object.freeze({ neurons: 2000 });
/**
 * The one question the decision model answers about a message: which of these it is. A message whose `ok` is below
 * `threshold` is held, and the most likely other answer says why (the office counts them; nobody else sees it).
 */
export const VERDICT = Object.freeze({
  type: 'choice',
  instructions: 'A chat message in a public online game; some players are children. What is it?',
  criteria: Object.freeze({
    ok: 'Normal game chat, jokes, banter, mild trash talk',
    insult: 'Insults, bullying or harassment of a person',
    hate: 'Slurs or hate against a group',
    sexual: 'Sexual content or advances',
    grooming: 'Asks age, location, photos, contacts, or to move apps',
    harm: 'Threats, violence, or urging self-harm',
    spam: 'Ads, scams or spam',
  }),
});
const VERDICT_CHARS = JSON.stringify(VERDICT).length;
export const REVIEW_THRESHOLD = 0.5;

const timeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`the review took over ${ms} ms`)), ms))]);

/**
 * One typed message, reviewed on the studio's own Workers AI: `{ ok, why, p, neurons, ms, model }`. `ok: false`: held
 * (`why` is the most likely other answer). Throws when there is no binding, the model fails or it takes too long:
 * the caller lets the floor decide.
 */
export async function reviewChat(env, text, { model = env?.HOMIE_CHAT_MODEL || CHAT_MODEL, ms = CHAT_LIMITS.reviewMs, threshold = REVIEW_THRESHOLD, links = 'block', now = () => Date.now(), fetch: fetchImpl = null } = {}) {
  // No binding: the person's own Ollama (`homie-studio dev` found clef-flash there), with the same question. Free.
  const local = env?.AI && typeof env.AI.run === 'function' ? null : localAiOf(env);
  if (!local && (!env?.AI || typeof env.AI.run !== 'function')) throw new Error('this Worker has no Workers AI binding (AI)');
  const spec = local ? { kind: 'clef', name: local.model, input: 0, output: 0 } : CHAT_MODELS[model] ?? CHAT_MODELS[CHAT_MODEL];
  const at = now();
  if (spec.kind === 'guard') {
    const r = await timeout(env.AI.run(model, { messages: [{ role: 'user', content: text }], temperature: 0, max_tokens: 16, response_format: { type: 'json_object' } }), ms);
    let v = r?.response;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = { safe: /^\s*safe\b/i.test(v), categories: (v.match(/S\d{1,2}/g) ?? []) }; } }
    if (!v || typeof v.safe !== 'boolean') throw new Error('the review answered nothing it could use');
    const input = Number(r?.usage?.prompt_tokens) || Math.ceil(text.length / 4) + 200;
    const output = Number(r?.usage?.completion_tokens) || 4;
    return { ok: v.safe, why: v.safe ? null : `guard:${(v.categories ?? []).slice(0, 3).join(',') || 'unsafe'}`, p: v.safe ? 1 : 0, neurons: (input * spec.input + output * spec.output) / 1e6, ms: now() - at, model };
  }
  // A room that allows links says so, so a plain link is not read as spam.
  const verdict = links === 'allow' ? { ...VERDICT, criteria: { ...VERDICT.criteria, spam: 'Ads, scams or spam (a plain link is fine here)' } } : VERDICT;
  const r = local
    ? await clefRun(env, { state: text, questions: { verdict }, ms: Math.max(ms, 4000), local, fetch: fetchImpl })
    : await timeout(env.AI.run(model, { model: spec.name, state: text, questions: { verdict } }), ms);
  const a = r?.answers?.verdict;
  if (!a || typeof a !== 'object') throw new Error('the review answered nothing it could use');
  const probs = a.probabilities && typeof a.probabilities === 'object' ? a.probabilities : null;
  const choice = typeof a.choice === 'string' ? a.choice : null;
  const pOk = probs && Number.isFinite(Number(probs.ok)) ? Number(probs.ok) : choice === 'ok' ? 1 : 0;
  let why = null;
  if (pOk < threshold) {
    why = choice && choice !== 'ok' ? choice : null;
    if (!why && probs) why = Object.entries(probs).filter(([k]) => k !== 'ok').sort((x, y) => Number(y[1]) - Number(x[1]))[0]?.[0] ?? null;
    why = why ?? 'held';
  }
  const input = Number(r?.usage?.input_tokens ?? r?.usage?.prompt_tokens) || Math.ceil((text.length + VERDICT_CHARS) / 4);
  return { ok: pOk >= threshold, why, p: Math.round(pOk * 1000) / 1000, neurons: (input * spec.input) / 1e6, ms: now() - at, model: local ? local.model : model, ...(local ? { local: true } : {}) };
}
