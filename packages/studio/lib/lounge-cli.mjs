/**
 * `homie-studio lounge` — the studio's Lounge from the studio folder (worker/lounge.mjs says what it is; chat/LOUNGE.md
 * the whole of it). The office key it uses is `office`'s: minted with the studio's own Cloudflare login, ten minutes
 * long, dropped as soon as the answer is in.
 *
 *   homie-studio lounge                                 its rules, play nights, moderators, last lines and reports
 *   homie-studio lounge night "<title>" --at <time> [--minutes 120] [--game <id>|<https link>] [--note "…"]
 *                                                       a play night; --at is an ISO time with its zone, or UTC (…Z)
 *   homie-studio lounge night remove <id>
 *   homie-studio lounge history <days>                  keep what is said for that many days (0 keeps nothing)
 *   homie-studio lounge rules [--slow <s>] [--who anyone|signed-in] [--mode …] [--hub on|off] [--ai on|off] | --reset
 *   homie-studio lounge mod <player id> [--remove]      a moderator: Remove, Mute, Kick (an hour at most), slow mode
 *   homie-studio lounge remove <line id>|--all
 *
 * Keeping more (a longer history), opening chat up, a new moderator, a mute or a kick are only ASKED for here: the answer
 * is the owner's one-tap link, as `office kick` gives. A play night, slow mode, taking a message down and keeping less
 * happen at once.
 */
import { askedFor, withKey } from './office.mjs';
import { chatFields } from './chat-cli.mjs';

export async function loungeShow(root, { url } = {}) {
  const r = await withKey(root, url, (call) => call('/_studio/api/lounge'));
  if (!r.ok) return { ok: false, command: 'lounge', why: r.why ?? r.message ?? 'the office did not answer' };
  return { command: 'lounge', ...r, ok: true };
}

export async function loungeNight(root, args, flags, { url } = {}) {
  if (args[0] === 'remove') {
    if (!/^pn_[a-f0-9]{12}$/.test(String(args[1] ?? ''))) return { ok: false, command: 'lounge night', why: 'usage: homie-studio lounge night remove <id> (the ids are in `homie-studio lounge`)' };
    const r = await withKey(root, url, (call) => call('/_studio/api/lounge/night', { remove: args[1] }));
    return r.ok ? { ok: true, command: 'lounge night', message: 'Play night removed.' } : { ok: false, command: 'lounge night', why: r.message ?? r.why };
  }
  const title = args.join(' ').trim();
  if (!title || !flags.get('at')) return { ok: false, command: 'lounge night', why: 'usage: homie-studio lounge night "<title>" --at 2026-10-09T19:00:00-07:00 [--minutes 120] [--game <id>] [--note "…"]' };
  const body = { title, at: String(flags.get('at')), ...(flags.has('minutes') ? { minutes: Number(flags.get('minutes')) } : {}), ...(flags.has('game') ? { game: String(flags.get('game')) } : {}), ...(flags.has('note') ? { note: String(flags.get('note')) } : {}) };
  const r = await withKey(root, url, (call) => call('/_studio/api/lounge/night', body));
  return r.ok ? { ok: true, command: 'lounge night', id: r.id, message: `Play night added (${r.id}): it shows in the Lounge in everyone's own time.` } : { ok: false, command: 'lounge night', why: r.message ?? r.why };
}

export async function loungeRulesSet(root, flags, { url, history = undefined } = {}) {
  const body = flags.has('reset') ? { reset: true } : { ...chatFields(flags), ...(history !== undefined ? { history: Math.floor(Number(history)) } : flags.has('history') ? { history: Math.floor(Number(flags.get('history'))) } : {}) };
  if (!body.reset && !Object.keys(body).length) return { ok: false, command: 'lounge rules', why: 'say what to change: --history <days>, --slow, --who, --mode, --hub, --ai, --block, --allow; or --reset' };
  const r = await withKey(root, url, (call) => call('/_studio/api/lounge/rules', body));
  return askedFor(root, url, r, 'lounge rules');
}

export async function loungeMod(root, player, { url, remove = false } = {}) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(player ?? ''))) return { ok: false, command: 'lounge mod', why: 'usage: homie-studio lounge mod <player id> [--remove] (`homie-studio lounge` shows the ids of signed-in senders)' };
  const r = await withKey(root, url, (call) => call('/_studio/api/lounge/mod', { player, ...(remove ? { remove: true } : {}) }));
  return askedFor(root, url, r, 'lounge mod');
}

export async function loungeRemove(root, id, { url, all = false } = {}) {
  if (!id && !all) return { ok: false, command: 'lounge remove', why: 'usage: homie-studio lounge remove <line id> | --all' };
  const r = await withKey(root, url, (call) => call('/_studio/api/lounge/remove', all ? { all: true } : { id }));
  return r.ok ? { ok: true, command: 'lounge remove', message: `Took ${r.removed ?? 0} message${r.removed === 1 ? '' : 's'} down, on every screen.` } : { ok: false, command: 'lounge remove', why: r.message ?? r.why };
}

export function loungeLines(r) {
  const L = r.lounge;
  if (!L) return ['This studio has no Lounge: add "lounge": true to studio.json and deploy.'];
  const c = L.rules ?? {};
  const out = [`${L.name} (${L.page}): ${c.mode}${c.mode === 'text' ? `, typing ${c.who}` : ''}, emoji ${c.react}, slow ${c.slow} s, ${c.history ? `kept ${c.history} days` : 'nothing kept'}${c.hub ? ', shown on homie.rocks' : ''}${L.kids ? ', kids' : ''} · rules from ${L.from === 'office' ? 'the office' : 'the defaults'} · ${L.here} here now`];
  for (const n of L.nights ?? []) out.push(`  night ${n.id}: ${n.title}, ${n.at} for ${n.minutes} min${n.game?.name ? ` (${n.game.name})` : ''}`);
  for (const m of L.mods ?? []) out.push(`  moderator ${m.player}: ${m.name ?? '?'}`);
  for (const l of (L.lines ?? []).filter((x) => x.kind !== 'react').slice(-12)) out.push(`  ${l.id}  ${l.by === 'studio' ? 'Studio' : l.name}${l.player ? ` [${l.player}]` : ''}: ${l.card ? `card: ${l.card.title} by ${l.card.studio}` : l.text}`);
  for (const p of L.reports ?? []) out.push(`  report ${p.id}: "${p.text}" by ${p.name} (${p.reasonText})`);
  return out;
}
