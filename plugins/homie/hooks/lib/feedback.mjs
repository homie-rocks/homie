/**
 * TELL HOMIE (0.28.0): a short note from a creator to the people who make Homie, drafted by Claude in plain words,
 * shown to the person exactly as it would go, and sent ONLY after they say yes. One module for every road a note
 * takes from this side: the local MCP's `homie_feedback` (lib/mcp-tools.mjs), its card (mcp/ui/feedback.js), and
 * the rules the Homie mod and the remote Homie MCP keep the same (homie.rocks has its own copy of these rules and
 * applies them again when a note arrives).
 *
 * What a note is, and nothing more: its kind (stuck, confusing, idea, praise, bug), the words, the step or skill it
 * is about, the studio and plugin versions, which app it came from, whether Claude offered it or the person asked,
 * and a reply address only when the person typed one. No file, no log, no code, no key, no studio name, no path.
 *
 * Before anything is shown, the words go through the mod's own redaction (lib/redact.mjs, the same rules the mod
 * uses on tool output: keys, tokens, private keys, owner links) and then a note's own: fenced code, home folders
 * (a user's home becomes ~), email addresses, a workers.dev address's account name, network addresses and long
 * opaque strings. What was taken out is listed with the draft, so the person sees it too.
 *
 * THE DRAFT IS THE NOTE. A draft's id is a hash of everything that would be sent; a send carries the id and the same
 * fields, and a send whose fields do not hash to its id is refused. So what goes out is exactly what was shown.
 */
import { redactText } from './redact.mjs';

export const FEEDBACK_KINDS = Object.freeze(['stuck', 'confusing', 'idea', 'praise', 'bug']);
export const FEEDBACK_APPS = Object.freeze(['claude-code', 'codex', 'grok', 'claude-desktop', 'claude-ai', 'other']);
export const FEEDBACK_LIMITS = Object.freeze({ text: 1500, raw: 6000, lines: 30, step: 80, email: 254, version: 32, perSession: 5, offers: 3 });
export const KIND_LABEL = Object.freeze({ stuck: 'Stuck', confusing: 'Confusing', idea: 'Idea', praise: 'Praise', bug: 'Bug' });
export const APP_LABEL = Object.freeze({ 'claude-code': 'Claude Code', codex: 'Codex', grok: 'Grok', 'claude-desktop': 'the Claude desktop app', 'claude-ai': 'Claude on the web or a phone', other: 'another app' });

/** Where a note goes on a Homie directory (homie.rocks, or a local one for tests). */
export const feedbackUrl = (directory = 'https://homie.rocks') => `${String(directory || 'https://homie.rocks').replace(/\/+$/, '')}/api/feedback/tell`;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,63}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const HIDDEN = (what) => `[${what} hidden by Homie]`;

/*
 * A note's own rules, after the mod's. Each: what it is (said to the person), the pattern, and its replacement.
 * Order matters: code first (whatever is inside a fence goes whole), then links and addresses.
 */
const NOTE_RULES = [
  { kind: 'code', re: /```[\s\S]*?(?:```|$)/g, to: () => '[code left out by Homie]' },
  // A workers.dev address names the Cloudflare account, often after its owner: the account part goes.
  // (Labels are bounded, as DNS bounds them: an unbounded one makes this rule quadratic on a long run of hyphens.)
  { kind: 'a workers.dev account name', re: /\b([a-z0-9-]{1,63}\.)?([a-z0-9-]{1,63})(\.workers\.dev)\b/gi, to: (m, sub, account, tail) => `${sub ?? ''}[account]${tail}` },
  { kind: 'a home folder', re: /(?:\/Users\/|\/home\/)([^/\s"'`]+)/g, to: () => '~' },
  { kind: 'a home folder', re: /\b[A-Za-z]:\\Users\\([^\\\s"'`]+)/g, to: () => '~' },
  { kind: 'an email address', re: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}\b/g, to: () => HIDDEN('an email address') },
  // A network address that is not this computer's own.
  { kind: 'a network address', re: /\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, to: () => HIDDEN('a network address') },
  // A signed token (three dotted parts, the first two JSON in base64): whole, before the rule below takes one part.
  { kind: 'a token', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, to: () => HIDDEN('a token') },
  // Anything long and opaque that a rule above did not name (a token of a kind nobody listed, a hash, a blob), after
  // a dot too.
  { kind: 'a long code', re: /(?<![A-Za-z0-9_\-+/=])(?=[A-Za-z0-9_\-+/=]*[0-9])(?=[A-Za-z0-9_\-+/=]*[A-Za-z])[A-Za-z0-9_\-+/=]{32,}(?![A-Za-z0-9_\-+/=])/g, to: () => HIDDEN('a long code') },
];

/** The words of a note as they may go: redacted, plain, and the list of what was taken out. */
export function redactNote(value) {
  let text = String(value ?? '').replace(/\r\n?/g, '\n').replace(CONTROL, '');
  const taken = [];
  for (const rule of NOTE_RULES.slice(0, 1)) text = applyRule(text, rule, taken);
  const r = redactText(text);
  if (r.hits.length) {
    taken.push(...r.hits.map((h) => (h === 'owner link' ? 'a private link' : `a ${h}`.replace(/^a ([aeiou])/i, 'an $1'))));
    // The mod's words for a link it showed in its pane are not true of a note: here the link is simply gone.
    text = r.text.split('[one-time owner link: the Homie mod showed it to the person in its Studio pane; Claude never sees it]').join(HIDDEN('a private link'));
  }
  for (const rule of NOTE_RULES.slice(1)) text = applyRule(text, rule, taken);
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, taken: [...new Set(taken)] };
}

function applyRule(text, rule, taken) {
  rule.re.lastIndex = 0;
  return text.replace(rule.re, (...m) => {
    const out = rule.to(...m);
    if (out !== m[0]) taken.push(rule.kind);
    return out;
  });
}

const oneLine = (value, max) => String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * A note as it may be shown and sent, or why not: { ok: true, note, taken } | { ok: false, why }.
 * `input`: { kind, text, step?, studioVersion?, pluginVersion?, app?, email?, offered? }.
 */
export function cleanNote(input = {}) {
  const kind = String(input.kind ?? '').trim().toLowerCase();
  if (!FEEDBACK_KINDS.includes(kind)) return { ok: false, why: `kind is one of ${FEEDBACK_KINDS.join(', ')}` };
  const raw = String(input.text ?? '');
  // Before any rule reads it: a note is short, and a rule's cost grows with what it is given.
  if (raw.length > FEEDBACK_LIMITS.raw) return { ok: false, why: `the note is ${raw.length.toLocaleString('en-US')} characters: keep it under ${FEEDBACK_LIMITS.text.toLocaleString('en-US')} (a short note, never a log or a file)` };
  const { text, taken } = redactNote(raw);
  if (!text) return { ok: false, why: 'the note is empty: write what happened in a sentence or two, in plain words' };
  if (text.length > FEEDBACK_LIMITS.text) return { ok: false, why: `the note is ${text.length} characters: keep it under ${FEEDBACK_LIMITS.text.toLocaleString('en-US')} (a short note, never a log or a file)` };
  if (text.split('\n').length > FEEDBACK_LIMITS.lines) return { ok: false, why: `the note has more than ${FEEDBACK_LIMITS.lines} lines: a short note, never a log or a file` };
  const stepRaw = oneLine(input.step, 400);
  const step = stepRaw ? oneLine(redactNote(stepRaw).text, FEEDBACK_LIMITS.step) || null : null;
  const version = (v) => { const s = String(v ?? '').trim().replace(/^v/, ''); return VERSION.test(s) ? s : null; };
  const app = FEEDBACK_APPS.includes(String(input.app ?? '')) ? String(input.app) : 'other';
  const emailRaw = String(input.email ?? '').trim();
  if (emailRaw && (emailRaw.length > FEEDBACK_LIMITS.email || !EMAIL.test(emailRaw))) return { ok: false, why: 'the reply address is not a whole email address: leave it out, or ask the person for theirs' };
  const note = {
    kind, text, step,
    studioVersion: version(input.studioVersion), pluginVersion: version(input.pluginVersion),
    app, email: emailRaw || null, offered: input.offered === true,
  };
  return { ok: true, note, taken };
}

/** A draft's id: what would be sent, hashed. The same note always has the same id; any change gives another. */
export async function draftId(note) {
  const canonical = JSON.stringify([note.kind, note.text, note.step, note.studioVersion, note.pluginVersion, note.app, note.email, note.offered]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `fd_${[...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** What goes with the words, in a line the person reads. */
export function withLine(note) {
  const parts = [
    note.step ? `the step (${note.step})` : null,
    note.studioVersion ? `studio ${note.studioVersion}` : null,
    note.pluginVersion ? `plugin ${note.pluginVersion}` : null,
    APP_LABEL[note.app] ?? null,
    note.offered ? 'that Claude offered it' : 'that you asked to send it',
  ].filter(Boolean);
  return `${parts.join(' · ')}. ${note.email ? `A reply address: ${note.email}.` : 'No reply address.'}`;
}

/** The note, exactly as it would go, as the text a chat shows (for an app with no card). */
export function noteBlock(note, taken = []) {
  return [
    `  Kind: ${KIND_LABEL[note.kind]}`,
    ...note.text.split('\n').map((l, i, all) => `  ${i === 0 ? '"' : ' '}${l}${i === all.length - 1 ? '"' : ''}`),
    `  Sent with it: ${withLine(note)}`,
    ...(taken.length ? [`  Homie took out: ${taken.join(', ')}.`] : []),
  ].join('\n');
}

/** The body a Homie directory takes at /api/feedback/tell. `source`: 'plugin' (this toolkit) or 'mod'. */
export function noteBody(note, { source, consent }) {
  const body = { kind: note.kind, text: note.text, source, consent, offered: note.offered, app: note.app };
  for (const k of ['step', 'studioVersion', 'pluginVersion', 'email']) if (note[k]) body[k] = note[k];
  return body;
}

/**
 * Send a note the person said yes to: { ok, reference, repeat } | { ok: false, why, status }. Never retried here:
 * a second press is the person's to make, and the directory answers a repeat with the same reference.
 */
export async function sendNote(note, { directory, source = 'plugin', consent = 'chat', fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  let res;
  try {
    res = await fetchImpl(feedbackUrl(directory), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': `homie-studio-feedback (${source})` },
      body: JSON.stringify(noteBody(note, { source, consent })),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, status: 0, why: `Homie could not be reached (${error?.name === 'TimeoutError' ? 'no answer in 15 s' : error?.cause?.code ?? error?.message ?? 'no connection'}). Nothing was sent; the person can try again later.` };
  }
  let body = null;
  try { body = JSON.parse(await res.text()); } catch { body = null; }
  if (res.ok && body?.ok === true && typeof body.reference === 'string') return { ok: true, reference: body.reference, repeat: body.repeat === true };
  const said = typeof body?.message === 'string' ? oneLine(body.message, 300) : null;
  if (res.status === 429) return { ok: false, status: 429, why: said ?? 'Homie has had enough notes from this network today. Nothing was sent; try again tomorrow.' };
  if (res.status === 404) return { ok: false, status: 404, why: 'This Homie directory does not take notes yet. Nothing was sent.' };
  return { ok: false, status: res.status, why: `${said ?? `Homie answered ${res.status}`}. Nothing was sent.` };
}

/** Which app a client is, from its MCP initialize clientInfo. */
export function appOf(clientInfo) {
  const name = String(clientInfo?.name ?? '').toLowerCase();
  if (/codex/.test(name)) return 'codex';
  if (/grok/.test(name)) return 'grok';
  if (/claude[-_ ]?code/.test(name)) return 'claude-code';
  if (/claude/.test(name)) return 'claude-desktop';
  return 'other';
}
