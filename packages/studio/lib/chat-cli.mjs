/**
 * `homie-studio chat` — a studio's room chat from the studio folder (worker/chat.mjs says what it is; NETPLAY.md
 * section 19 the rules and the wire). The office key it uses is the same as `office`'s: minted with the studio's own
 * Cloudflare login, ten minutes long, dropped as soon as the answer is in.
 *
 *   homie-studio chat [--game <id>]                    each game's chat rules, every live room's last minutes, the
 *                                                      reports, and the review's day (neurons used of its budget)
 *   homie-studio chat rules <game> [--server <id>] [--mode off|emoji|lines|text] [--who anyone|signed-in|members]
 *                          [--react …] [--slow <s>] [--max <n>] [--links block|allow] [--swears block|allow]
 *                          [--ai on|off] [--bubbles on|off] [--watchers on|off] [--hub on|off] [--block "a,b"] [--reset]
 *   homie-studio chat remove <game> <room> <line id>|--all
 *   homie-studio chat budget <neurons>                  the review's day for the whole studio (default 2,000)
 *   homie-studio chat words                             the built-in word list the floor holds (worker/chat-words.mjs)
 *
 * A change that opens chat up (a wider mode or audience, less slow mode, links or swears allowed, the review off) or
 * a bigger budget is only ASKED for here: the answer is the owner's one-tap link, as `office kick` gives.
 */
import { builtinWords } from '../worker/chat.mjs';
import { askedFor, withKey } from './office.mjs';

const GAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const onOff = (v) => (v === undefined ? undefined : v === true || v === 'on' || v === 'true' || v === 'yes');

/** The flags `chat rules` reads, as the office API's fields. */
export function chatFields(flags) {
  const f = {};
  const get = (k) => (flags.has(k) ? flags.get(k) : undefined);
  for (const k of ['mode', 'who', 'react', 'links', 'swears']) if (get(k) !== undefined) f[k] = String(get(k));
  for (const k of ['slow', 'max']) if (get(k) !== undefined) f[k] = Number(get(k));
  for (const k of ['ai', 'bubbles', 'watchers', 'hub']) if (get(k) !== undefined) f[k] = onOff(get(k));
  if (get('block') !== undefined) f.block = String(get('block')).split(',').map((w) => w.trim()).filter(Boolean);
  if (get('allow') !== undefined) f.allow = String(get('allow')).split(',').map((w) => w.trim()).filter(Boolean);
  return f;
}

export async function chatShow(root, { url, game } = {}) {
  const r = await withKey(root, url, (call) => call(`/_studio/api/chat${game ? `?game=${encodeURIComponent(game)}` : ''}`));
  if (!r.ok) return { ok: false, command: 'chat', why: r.why ?? r.message ?? 'the office did not answer' };
  return { command: 'chat', ...r, ok: true };
}

export async function chatRulesSet(root, game, flags, { url } = {}) {
  if (!GAME.test(String(game ?? ''))) return { ok: false, command: 'chat rules', why: 'usage: homie-studio chat rules <game> [--server <id>] --mode off|emoji|lines|text [--who …] [--slow <s>] … | --reset' };
  const server = flags.get('server') ?? '';
  const body = flags.has('reset') ? { game, server, reset: true } : { game, server, ...chatFields(flags) };
  if (!body.reset && Object.keys(body).length <= 2) return { ok: false, command: 'chat rules', why: 'say what to change: --mode, --who, --react, --slow, --max, --links, --swears, --ai, --bubbles, --watchers, --hub, --block, --allow; or --reset' };
  const r = await withKey(root, url, (call) => call('/_studio/api/chat/rules', body));
  return askedFor(root, url, r, 'chat rules');
}

export async function chatRemove(root, game, room, id, { url, all = false } = {}) {
  if (!GAME.test(String(game ?? '')) || !room || (!id && !all)) return { ok: false, command: 'chat remove', why: 'usage: homie-studio chat remove <game> <room> <line id> | --all (the ids are in `homie-studio chat`)' };
  const r = await withKey(root, url, (call) => call('/_studio/api/chat/remove', { game, room, ...(all ? { all: true } : { id }) }));
  return r.ok ? { ok: true, command: 'chat remove', removed: r.removed ?? 0, message: `Took ${r.removed ?? 0} message${r.removed === 1 ? '' : 's'} down in ${room}, on every screen.` } : { ok: false, command: 'chat remove', why: r.message ?? r.why };
}

export async function chatBudget(root, neurons, { url } = {}) {
  const n = Math.floor(Number(neurons));
  if (!(n >= 0 && n <= 1e7)) return { ok: false, command: 'chat budget', why: 'usage: homie-studio chat budget <neurons a day> (default 2000; Workers AI gives an account 10,000 a day free)' };
  const r = await withKey(root, url, (call) => call('/_studio/api/chat/budget', { neurons: n }));
  return askedFor(root, url, r, 'chat budget');
}

/** The built-in list, by group: what the floor always holds (swears only while a game holds swears). */
export function chatWords() {
  const w = builtinWords();
  return {
    ok: true, command: 'chat words',
    groups: {
      slurs: [...w.slurs], slursInsideWords: w.slursAnywhere, sexual: [...w.sexual], sexualInsideWords: w.sexualAnywhere,
      swears: [...w.swears], swearsInsideWords: w.swearsAnywhere, harm: w.harm, contact: w.contact,
    },
    note: 'Whole words unless "inside words". Shown as the floor reads them (lower case, letters only). A studio adds its own with chat rules --block, and lets one through with --allow.',
  };
}

export function chatLines(r) {
  const out = [];
  const d = r.day;
  if (d) out.push(`Review today: ${d.ai ? `${Math.round(d.used.neurons)} of ${d.budget.neurons} neurons, ${d.used.reviews} reviewed, ${d.used.held} held${d.used.errors ? `, ${d.used.errors} unanswered (the word list decided)` : ''}` : 'no Workers AI binding yet (npm run deploy binds it); the word list decides'}.`);
  for (const g of r.games ?? []) {
    const c = g.chat?.rules;
    out.push(`${g.name} (${g.id}): ${c ? `${c.mode}${c.mode === 'text' ? `, typing ${c.who}` : ''}, emoji ${c.react}, slow ${c.slow} s${c.ai ? ', reviewed' : ''}${c.capped ? ` (capped: ${c.capped})` : ''}` : 'no rules read'} · from ${g.chat?.from ?? 'default'}`);
    for (const sv of g.chat?.servers ?? []) if (sv.office) out.push(`  server ${sv.id}: ${sv.rules.mode}, typing ${sv.rules.who}`);
    for (const rm of g.rooms ?? []) for (const l of (rm.chat?.lines ?? []).slice(-8)) out.push(`  ${rm.room} ${l.id}  ${l.by === 'studio' ? 'Studio' : l.name}: ${l.kind === 'react' ? l.glyph : l.text}`);
    for (const p of g.chat?.reports ?? []) out.push(`  report ${p.id}: "${p.text}" by ${p.name} (${p.reasonText}), ${p.room}`);
  }
  return out;
}
