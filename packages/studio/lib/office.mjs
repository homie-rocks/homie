/**
 * `homie-studio office` — the studio's back office from the studio folder (worker/office.mjs says what it is).
 *
 *   homie-studio office [--url <site>]                 every live room of every game and who is in it, now
 *   homie-studio office link [--to <path>]             a one-time link that signs the owner's browser in (the office,
 *                                                      or --to /<game>/play: a private game on the owner's phone)
 *   homie-studio office key [--hours 1]                an office key for the Homie MCP's owner tools (studio_office,
 *                                                      room_kick, room_announce, room_close, game_launch_state)
 *   homie-studio office announce "<text>" [--game <id>] [--room <code>] [--seconds 30]
 *   homie-studio office invite <game> [--label "<who>"] [--uses 1|<n>|any] [--count 1] [--days <n>]
 *   homie-studio office launch <game> private|invite|public [--remixable on|off] [--max <n>|game]
 *   homie-studio office kick <game> <room> <seat number | name> [--minutes 10]
 *   homie-studio office close <game> <room> [--minutes 10] [--reopen]
 *   homie-studio office revoke                         every office key ends; every play ticket and pending ask too
 *
 * THE PROOF OF OWNERSHIP IS THE STUDIO'S OWN CLOUDFLARE LOGIN, as for the stats: a key is minted here and only its
 * SHA-256 goes into the studio's D1. Looking, announcing and inviting happen at once. Kick, mute, closing a room and
 * a game's launch state, remix switch or room size are only ASKED for here: the answer is a one-time sign-in link
 * that opens the ask in the owner's own browser, where one tap does it (the AI that ran this cannot).
 */
import { readStudio } from './studio.mjs';
import { runner } from './cloudflare.mjs';
import { drop, loopback, mint, siteOf } from './stats.mjs';

const HOUR = 3600_000;
const GAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Call the studio's office API with a key that lives ten minutes and is dropped as soon as the answer is in. */
export async function withKey(root, url, fn) {
  const { studio, site } = siteOf(root, url);
  if (!site) return { ok: false, why: 'this studio has no live site yet: `npm run deploy` first, or give --url http://127.0.0.1:8787 for `npm run dev`' };
  const local = loopback(site);
  const k = mint(root, studio, 'office', 10 * 60_000, { local });
  if (!k.ok) return { ok: false, why: /no such table: stats_keys/.test(k.why) ? k.why : k.why };
  try {
    const call = async (path, body = null) => {
      const res = await fetch(`${site}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${k.key}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000),
      });
      const out = await res.json().catch(() => ({ ok: false, message: `${site}${path} answered ${res.status}` }));
      return { status: res.status, ...out };
    };
    return await fn(call, { studio, site, local });
  } catch (error) {
    return { ok: false, why: `could not reach ${site}: ${error.message}` };
  } finally { drop(root, studio, k.hash, { local }); }
}

/** A one-time sign-in link for the owner's browser that lands on `to` (30 minutes). */
function signinTo(root, url, to) {
  const { studio, site } = siteOf(root, url);
  if (!site) return { ok: false, why: 'this studio has no live site yet: `npm run deploy` first' };
  const k = mint(root, studio, 'signin', 30 * 60_000, { local: loopback(site) });
  if (!k.ok) return k;
  return { ok: true, site, link: `${site}/_studio/signin?k=${k.key}${to && to !== '/_studio/stats' ? `&to=${encodeURIComponent(to)}` : ''}`, expiresAt: k.expiresAt };
}

export const askedFor = (root, url, r, command) => {
  if (!r.ok) return { ok: false, command, why: r.message ?? r.why ?? `the studio said ${r.error ?? r.status}` };
  if (r.needs !== 'owner' || !r.ask) return { ok: true, command, done: true, result: r, message: r.what ? `Done: ${r.what}` : 'Done.' };
  const link = signinTo(root, url, `/_studio/confirm/${r.ask.id}`);
  return {
    ok: true, command, asked: true, ask: r.ask, what: r.ask.what,
    link: link.ok ? link.link : r.ask.confirm,
    use: `Waiting for the owner: ${r.ask.what} Give the owner this link to open in their own browser: it signs that browser in (once, within 30 minutes) and shows the ask with one button. It lasts 15 minutes; nothing happens unless the owner taps.`,
  };
};

export async function officeShow(root, { url } = {}) {
  const r = await withKey(root, url, (call) => call('/_studio/api/office'));
  if (!r.ok) return { ok: false, command: 'office', why: r.why ?? r.message ?? 'the office did not answer' };
  return { command: 'office', ...r, ok: true };
}

export function officeLink(root, { url, to } = {}) {
  const target = to && /^\/[A-Za-z0-9_/-]{1,80}$/.test(String(to)) ? String(to) : '/_studio/office';
  const r = signinTo(root, url, target);
  if (!r.ok) return { ok: false, command: 'office link', why: r.why };
  return {
    ...r, command: 'office link', to: target,
    use: 'Give this link to the studio\'s owner to open in their own browser: it works once, within 30 minutes, and keeps that browser signed in as the owner for 30 days (the office, the stats, and the owner\'s tools inside their own games). It is theirs alone; do not post it anywhere.',
  };
}

export function officeKey(root, { url, hours } = {}) {
  const { studio, site } = siteOf(root, url);
  if (!site) return { ok: false, command: 'office key', why: 'this studio has no live site yet: `npm run deploy` first' };
  const h = Math.max(1, Math.min(24 * 30, Math.floor(Number(hours) || 1)));
  const k = mint(root, studio, 'office', h * HOUR, { local: loopback(site) });
  if (!k.ok) return { ok: false, command: 'office key', why: k.why };
  return {
    ok: true, command: 'office key', site, key: k.key, expiresAt: k.expiresAt, hours: h,
    use: `Pass { "site": "${site}", "key": "<this key>" } to the Homie MCP's owner tools (studio_office, room_announce, room_kick, room_close, game_launch_state). With it the AI sees the live rooms, announces and makes invites; a kick, a closed room or a launch state change is only asked for, and the owner confirms it with one tap. It also reads the stats (studio_stats). It ends at ${k.expiresAt}; \`homie-studio office revoke\` ends it sooner. Never paste it anywhere else.`,
  };
}

export async function officeAnnounce(root, text, { url, game, room, seconds } = {}) {
  if (!String(text ?? '').trim()) return { ok: false, command: 'office announce', why: 'usage: homie-studio office announce "<text>" [--game <id>] [--room <code>]' };
  const r = await withKey(root, url, (call) => call('/_studio/api/announce', { text, ...(game ? { game } : {}), ...(room ? { room } : {}), ...(seconds ? { seconds: Number(seconds) } : {}) }));
  return r.ok ? { ok: true, command: 'office announce', ...r, message: `Announced to ${r.people ?? 0} people in ${r.rooms ?? 0} room(s).` } : { ok: false, command: 'office announce', why: r.message ?? r.why };
}

export async function officeInvite(root, game, { url, label, uses, count, days, server } = {}) {
  if (!GAME.test(String(game ?? ''))) return { ok: false, command: 'office invite', why: 'usage: homie-studio office invite <game> [--label "<who>"] [--uses 1|<n>|any] [--count 1] [--server <id>]' };
  const r = await withKey(root, url, (call) => call('/_studio/api/invites', {
    game, ...(label ? { label } : {}), uses: uses === 'any' ? 'any' : uses ? Number(uses) : 1, ...(count ? { count: Number(count) } : {}), ...(days ? { days: Number(days) } : {}), ...(server ? { server } : {}),
  }));
  if (!r.ok) return { ok: false, command: 'office invite', why: r.message ?? r.why };
  // An invite to a server (its door "invite") works whatever the game's launch state; a game's own, in a beta only.
  return { ok: true, command: 'office invite', game, launch: r.launch, invites: r.invites, note: server || r.launch === 'invite' ? null : `${game} is ${r.launch} now: invites let people in once it is an invite-only beta (homie-studio office launch ${game} invite).` };
}

export async function officeLaunch(root, game, state, { url, remixable, max } = {}) {
  if (!GAME.test(String(game ?? '')) || (state !== undefined && state !== null && !['private', 'invite', 'public'].includes(state))) {
    return { ok: false, command: 'office launch', why: 'usage: homie-studio office launch <game> private|invite|public [--remixable on|off] [--max <n>|game]' };
  }
  const body = { game, ...(state ? { launch: state } : {}), ...(remixable !== undefined ? { remix: remixable === 'on' || remixable === true } : {}), ...(max !== undefined ? { maxPlayers: max === 'game' ? null : Number(max) } : {}) };
  const r = await withKey(root, url, (call) => call('/_studio/api/game', body));
  return askedFor(root, url, r, 'office launch');
}

export async function officeKick(root, game, room, who, { url, minutes } = {}) {
  if (!GAME.test(String(game ?? '')) || !room || who === undefined) return { ok: false, command: 'office kick', why: 'usage: homie-studio office kick <game> <room> <seat number | name> [--minutes 10]' };
  const r = await withKey(root, url, async (call) => {
    const office = await call('/_studio/api/office');
    const g = (office.games ?? []).find((x) => x.id === game);
    const rm = (g?.rooms ?? []).find((x) => x.room === room || x.label.toLowerCase() === String(room).toLowerCase());
    if (!rm) return { ok: false, message: `nobody is in ${room} of ${game} now (homie-studio office lists the rooms)` };
    const seat = /^\d+$/.test(String(who)) ? Number(who) - 1 : null;
    const c = rm.clients.find((x) => (seat !== null && x.seat === seat) || String(x.name).toLowerCase() === String(who).toLowerCase());
    if (!c) return { ok: false, message: `no "${who}" in ${rm.label} (seats are numbered from 1)` };
    return call('/_studio/api/kick', { game, room: rm.room, id: c.id, minutes: Number(minutes) || 10 });
  });
  return askedFor(root, url, r, 'office kick');
}

export async function officeClose(root, game, room, { url, minutes, reopen } = {}) {
  if (!GAME.test(String(game ?? '')) || !room) return { ok: false, command: 'office close', why: 'usage: homie-studio office close <game> <room> [--minutes 10] [--reopen]' };
  const r = await withKey(root, url, (call) => call('/_studio/api/close', { game, room, minutes: Number(minutes) || 10, reopen: Boolean(reopen) }));
  return askedFor(root, url, r, 'office close');
}

/** Every office key ends, and the office secret is made anew: every play ticket and every signed control ends with it. */
export function officeRevoke(root, { url } = {}) {
  const { studio, site } = siteOf(root, url);
  const local = site ? loopback(site) : false;
  const w = runner(root, studio.cloudflare?.accountId && !local ? { CLOUDFLARE_ACCOUNT_ID: studio.cloudflare.accountId } : {});
  const res = w(['d1', 'execute', studio.cloudflare.d1, local ? '--local' : '--remote', '--command', "DELETE FROM stats_keys WHERE kind = 'office'; DELETE FROM meta WHERE key = 'office_key'; UPDATE office_asks SET state = 'expired' WHERE state = 'pending';"]);
  return res.code === 0
    ? { ok: true, command: 'office revoke', site, message: 'Every office key has ended, and every play ticket and pending ask with it (a browser let into a private or invite-only game gets a new ticket the next time it opens the game). Invite passes and the owner\'s signed-in browsers stay; `homie-studio stats revoke` ends those sessions.' }
    : { ok: false, command: 'office revoke', why: res.out.trim().split('\n').slice(-3).join(' ') };
}

/** One line per room for a person (the CLI's print). */
export function officeLines(r) {
  const lines = [`${r.studio}: ${r.playing ? `${r.playing} playing now` : 'nobody playing right now'} (${r.site})`];
  const now = r.now ?? Date.now();
  const mins = (ms) => `${Math.max(0, Math.round(ms / 60000))} min`;
  for (const g of r.games ?? []) {
    lines.push(`  ${g.name} (${g.id}): ${g.launch}${g.launch === 'public' ? '' : ' (not listed)'}, ${g.remix ? 'remixable' : 'source closed'}, rooms of ${g.maxPlayers}${g.maxSet ? ` (the game's own: ${g.seats})` : ''}`);
    for (const i of (g.invites ?? []).filter((x) => x.open)) lines.push(`    invite ${i.code}${i.label ? ` (${i.label})` : ''}: ${i.uses}${i.maxUses ? ` of ${i.maxUses}` : ''} used · ${i.link}`);
    if (!g.rooms.length) lines.push('    no live rooms');
    for (const rm of g.rooms) {
      const round = rm.round ? `round ${rm.round.n} ${rm.round.phase}` : 'no round';
      lines.push(`    ${rm.label}${rm.public ? '' : ' (named)'}: ${rm.players}/${rm.max} players, ${rm.bots} bots, ${round}, up ${rm.openedAt ? mins(now - rm.openedAt) : '?'}${rm.closedUntil ? `, CLOSED for ${mins(rm.closedUntil - now)}` : ''}`);
      for (const c of rm.clients) lines.push(`      ${c.seat !== null ? `seat ${c.seat + 1}` : 'watching'}: ${c.name} · ${c.device}${c.role === 'host' ? ' · host' : ''} · ${c.as}${c.muted ? ' · muted' : ''} · here ${mins(now - c.joinedAt)}`);
      for (const b of rm.bans ?? []) lines.push(`      kicked: ${b.name} (back in ${mins(b.until - now)})`);
    }
  }
  return lines;
}
