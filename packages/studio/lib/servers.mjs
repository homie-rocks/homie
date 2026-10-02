/**
 * `homie-studio servers` and `homie-studio agents` — a studio's servers and agent seats from the studio folder
 * (worker/servers.mjs and worker/agents.mjs say what they are; NETPLAY.md section 17 the contract).
 *
 *   homie-studio servers [list] [--game <id>]           every server of every game: policy, door, live rooms, AI, members
 *   homie-studio servers new <game> "<Name>" --policy open|humans-only|hybrid|beginner
 *                       [--ai <n>] [--guides <n>] [--kids] [--door open|accounts|invite] [--level 1-5] [--level-max 1-5]
 *                       [--speech game|lines|off] [--bots fill|off] [--rooms <n>] [--seats <n>] [--beginner-days <n>]
 *                       [--listed on|off] [--blurb "<one line>"] [--id <id>]
 *   homie-studio servers set <game> <server> [the same flags]
 *   homie-studio servers close <game> <server> [--reopen]
 *   homie-studio servers level <game> <room> <1-5>      the owner sets one room's AI level now
 *   homie-studio servers member <game> <server> <player> --role member|mentor|mod | --remove
 *   homie-studio agents pass <game|any> --label "<Name>" [--server <id>] [--hands self|host] [--role party|guide|player] [--days 7]
 *   homie-studio agents passes [<game>]                  every pass (never a secret)
 *   homie-studio agents revoke <pass id>
 *   homie-studio agents brain <game> <server> off|script|workers-ai|owner-key
 *
 * The proof of ownership is the studio's own Cloudflare login, as for the office: a ten-minute office key is minted
 * and dropped around each call. Making a server, a widening change, a pass and a room's level happen at once. A
 * change that narrows who may come in, closing a server, removing a member, and the first time AI guides may talk are
 * only ASKED for: the answer is a one-time link that opens the ask in the owner's own browser (one tap does it).
 */
import { askedFor, withKey } from './office.mjs';

const GAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SERVER = /^[a-z0-9][a-z0-9-]{1,19}$/;
const LEVELS = ['Rookie', 'Steady', 'Fair', 'Strong', 'Maxed'];

/** The server fields the flags give (only the ones given), as the office API takes them. */
export function serverFields(flags) {
  const f = {};
  const get = (k) => (flags.has(k) ? flags.get(k) : undefined);
  const n = (k, as) => { const v = get(k); if (v !== undefined && v !== true) f[as] = Number(v); };
  if (get('policy') !== undefined) f.policy = String(get('policy'));
  n('ai', 'aiSeats'); n('ai-seats', 'aiSeats'); n('guides', 'guides'); n('level', 'level'); n('level-max', 'levelMax'); n('rooms', 'rooms');
  n('beginner-days', 'beginnerDays');
  if (get('beginner-level') !== undefined) f.beginnerLevel = get('beginner-level') === 'none' ? null : Number(get('beginner-level'));
  if (get('seats') !== undefined) f.seats = get('seats') === 'game' ? null : Number(get('seats'));
  if (get('kids') !== undefined) f.kids = get('kids') === true || get('kids') === 'on';
  if (get('listed') !== undefined) f.listed = !(get('listed') === 'off' || get('listed') === 'no');
  for (const k of ['door', 'speech', 'bots', 'blurb', 'id', 'name']) if (get(k) !== undefined && get(k) !== true) f[k] = String(get(k));
  return f;
}

const levelWord = (n) => `${LEVELS[n - 1] ?? 'Fair'} (${n})`;

export async function serversList(root, { url, game } = {}) {
  const r = await withKey(root, url, (call) => call(`/_studio/api/servers${game ? `?game=${encodeURIComponent(game)}` : ''}`));
  if (!r.ok) return { ok: false, command: 'servers', why: r.message ?? r.why ?? 'the studio did not answer' };
  return { ok: true, command: 'servers', games: r.games ?? [], fillSpot: r.fillSpot ?? null };
}

export async function serversNew(root, game, name, flags, { url } = {}) {
  if (!GAME.test(String(game ?? '')) || !String(name ?? '').trim()) return { ok: false, command: 'servers new', why: 'usage: homie-studio servers new <game> "<Name>" --policy open|humans-only|hybrid|beginner [--ai <n>] [--guides <n>] [--kids]' };
  const body = { game, name, ...serverFields(flags) };
  if (!body.policy) return { ok: false, command: 'servers new', why: 'say the policy: --policy open, humans-only, hybrid (with --ai <n>) or beginner (with --guides <n>)' };
  const r = await withKey(root, url, (call) => call('/_studio/api/servers', body));
  if (!r.ok) return { ok: false, command: 'servers new', why: r.message ?? r.why };
  return { ok: true, command: 'servers new', game, server: r.server, notes: r.notes ?? [], message: `${r.server?.name} is open: ${r.server?.page}` };
}

export async function serversSet(root, game, server, flags, { url } = {}) {
  if (!GAME.test(String(game ?? '')) || !(SERVER.test(String(server ?? '')) || server === 'public')) return { ok: false, command: 'servers set', why: 'usage: homie-studio servers set <game> <server> [--policy …] [--level-max 3] [--door accounts] …' };
  const fields = serverFields(flags);
  delete fields.id;
  if (!Object.keys(fields).length) return { ok: false, command: 'servers set', why: 'say what to change: --name, --policy, --ai, --guides, --kids, --door, --level, --level-max, --speech, --bots, --rooms, --seats, --listed' };
  const r = await withKey(root, url, (call) => call('/_studio/api/servers/set', { game, server, ...fields }));
  return askedFor(root, url, r, 'servers set');
}

export async function serversClose(root, game, server, { url, reopen } = {}) {
  if (!GAME.test(String(game ?? '')) || !(SERVER.test(String(server ?? '')) || server === 'public')) return { ok: false, command: 'servers close', why: 'usage: homie-studio servers close <game> <server> [--reopen]' };
  const r = await withKey(root, url, (call) => call('/_studio/api/servers/close', { game, server, reopen: Boolean(reopen) }));
  return askedFor(root, url, r, 'servers close');
}

export async function serversLevel(root, game, room, level, { url } = {}) {
  const n = Math.floor(Number(level));
  if (!GAME.test(String(game ?? '')) || !room || !(n >= 1 && n <= 5)) return { ok: false, command: 'servers level', why: 'usage: homie-studio servers level <game> <room> <1-5> (1 Rookie, 2 Steady, 3 Fair, 4 Strong, 5 Maxed)' };
  const r = await withKey(root, url, (call) => call('/_studio/api/room-level', { game, room, level: n }));
  return r.ok ? { ok: true, command: 'servers level', game, room, level: r.level, message: `The AI in ${room} plays at ${levelWord(r.level)} now.` } : { ok: false, command: 'servers level', why: r.message ?? r.why };
}

export async function serversMember(root, game, server, player, { url, role, remove } = {}) {
  if (!GAME.test(String(game ?? '')) || !SERVER.test(String(server ?? '')) || !player) return { ok: false, command: 'servers member', why: 'usage: homie-studio servers member <game> <server> <player id> --role member|mentor|mod | --remove' };
  const r = await withKey(root, url, (call) => call('/_studio/api/servers/member', { game, server, player, ...(remove ? { remove: true } : { role: role ?? 'member' }) }));
  return askedFor(root, url, r, 'servers member');
}

export async function agentsPass(root, game, { url, label, server, hands, role, days } = {}) {
  if (!label || label === true) return { ok: false, command: 'agents pass', why: 'usage: homie-studio agents pass <game|any> --label "<Name>" [--server <id>] [--hands self|host] [--days 7]' };
  const g = game && game !== 'any' ? game : null;
  if (g && !GAME.test(g)) return { ok: false, command: 'agents pass', why: 'the game is one of this studio\'s game ids, or "any"' };
  const r = await withKey(root, url, (call) => call('/_studio/api/agents/pass', { action: 'create', game: g, label, server: server ?? null, hands: hands ?? 'self', role: role ?? 'party', days: days === undefined ? 7 : days === 'never' ? null : Number(days) }));
  if (!r.ok) return { ok: false, command: 'agents pass', why: r.message ?? r.why };
  return {
    ok: true, command: 'agents pass', pass: r.pass, secret: r.secret,
    use: `${r.use} Keep the pass as a secret: never in a file of this repository, a chat or an issue.`,
  };
}

export async function agentsPasses(root, game, { url } = {}) {
  const r = await withKey(root, url, (call) => call('/_studio/api/agents/pass', { action: 'list', game: game ?? null }));
  return r.ok ? { ok: true, command: 'agents passes', passes: r.passes ?? [] } : { ok: false, command: 'agents passes', why: r.message ?? r.why };
}

export async function agentsRevoke(root, id, { url } = {}) {
  if (!/^[a-f0-9]{10}$/.test(String(id ?? ''))) return { ok: false, command: 'agents revoke', why: 'usage: homie-studio agents revoke <pass id> (agents passes lists them)' };
  const r = await withKey(root, url, (call) => call('/_studio/api/agents/pass', { action: 'revoke', id }));
  return r.ok ? { ok: true, command: 'agents revoke', revoked: id, left: r.left ?? 0, message: `Pass ${id} revoked${r.left ? `: its AI left ${r.left} room(s)` : ''}.` } : { ok: false, command: 'agents revoke', why: r.message ?? r.why };
}

export async function agentsBrain(root, game, server, mode, { url } = {}) {
  if (!GAME.test(String(game ?? '')) || !server || !['off', 'script', 'workers-ai', 'owner-key'].includes(mode)) return { ok: false, command: 'agents brain', why: 'usage: homie-studio agents brain <game> <server> off|script|workers-ai|owner-key' };
  const r = await withKey(root, url, (call) => call('/_studio/api/agents/brain', { game, server, mode }));
  return askedFor(root, url, r, 'agents brain');
}

/** One line per server for a person (the CLI's print). */
export function serversLines(r) {
  const lines = [];
  for (const g of r.games ?? []) {
    lines.push(`${g.name} (${g.id})${g.build?.predates ? `: its build predates servers (netplay rev ${g.build.netplayRev ?? '5 or older'}); rebuild for AI seats and the dial` : ''}`);
    for (const s of g.servers ?? []) {
      const live = s.live ?? { rooms: 0, players: 0, ai: 0 };
      lines.push(`  ${s.name} [${s.id}]: ${s.badge}${s.kids ? ', kids' : ''}, bots ${s.bots}, ${levelWord(s.level)} (ceiling ${LEVELS[s.levelMax - 1]}), door ${s.door}${s.state !== 'open' ? `, ${s.state.toUpperCase()}` : ''} · ${live.rooms ? `${live.rooms} room(s), ${live.players} playing, ${live.ai} AI` : 'no live rooms'}${s.members ? ` · ${s.members} members` : ''}`);
    }
    for (const p of (g.passes ?? []).filter((x) => x.live)) lines.push(`  pass ${p.id}: ${p.name} (${p.role}, hands ${p.hands}${p.server ? `, ${p.server} only` : ''})`);
  }
  if (r.fillSpot && !r.fillSpot.available) lines.push(`(${r.fillSpot.note})`);
  return lines;
}
