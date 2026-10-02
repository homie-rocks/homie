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
 *   homie-studio agents brain <game> <server> off|script|workers-ai|owner-key [--budget <neurons a day | dollars a day>]
 *   homie-studio agents brain key [--remove]          the owner's own AI key (owner-key brains), from a page on this
 *                                                     computer only: it goes straight to the Worker secret
 *                                                     HOMIE_BRAIN_KEY, never through a chat, a file or a log
 *   homie-studio agents sit <game> [--server <id>] [--pass hap_…] [--label Claude]
 *                                                     sit in a guide's seat from this terminal (the local MCP's agent_sit)
 *
 * The proof of ownership is the studio's own Cloudflare login, as for the office: a ten-minute office key is minted
 * and dropped around each call. Making a server, a widening change, a pass and a room's level happen at once. A
 * change that narrows who may come in, closing a server, removing a member, and the first time AI guides may talk are
 * only ASKED for: the answer is a one-time link that opens the ask in the owner's own browser (one tap does it).
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { askedFor, withKey } from './office.mjs';
import { runner } from './cloudflare.mjs';
import { readStudio } from './studio.mjs';

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

export async function agentsBrain(root, game, server, mode, { url, budget } = {}) {
  if (!GAME.test(String(game ?? '')) || !server || !['off', 'script', 'workers-ai', 'owner-key'].includes(mode)) return { ok: false, command: 'agents brain', why: 'usage: homie-studio agents brain <game> <server> off|script|workers-ai|owner-key [--budget <neurons a day for workers-ai | dollars a day for owner-key>]' };
  const b = budget === undefined || budget === true ? undefined : Number(budget);
  if (b !== undefined && !(b >= 0)) return { ok: false, command: 'agents brain', why: '--budget is a number: Workers AI neurons a day (workers-ai; the free allocation is 10,000 an account), or dollars a day (owner-key)' };
  const r = await withKey(root, url, (call) => call('/_studio/api/agents/brain', { game, server, mode, ...(b !== undefined ? { budget: b } : {}) }));
  return askedFor(root, url, r, 'agents brain');
}

/**
 * `homie-studio agents brain key`: the owner's own AI provider key (owner-key brains: claude-haiku-4-5), typed once
 * into a page on this computer (127.0.0.1, one use, ten minutes) and handed straight to `wrangler secret put
 * HOMIE_BRAIN_KEY` on its standard input. It never passes through a chat, a file, an argument or a log, and this
 * command never prints it. `--remove` deletes the secret.
 */
export async function agentsBrainKey(root, { remove = false, log = () => {}, port = 0, wait = 10 * 60_000 } = {}) {
  const studio = readStudio(root);
  const env = studio.cloudflare?.accountId ? { CLOUDFLARE_ACCOUNT_ID: studio.cloudflare.accountId } : {};
  const w = runner(root, env);
  if (remove) {
    const r = w(['secret', 'delete', 'HOMIE_BRAIN_KEY'], { input: 'y\n' });
    return r.code === 0 ? { ok: true, command: 'agents brain key', removed: true, message: 'The key is gone from the Worker: owner-key guides answer from the game\'s script.' } : { ok: false, command: 'agents brain key', why: r.out.trim().split('\n').slice(-2).join(' ') };
  }
  const nonce = randomBytes(16).toString('hex');
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your AI key</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#1b1b1b}input{width:100%;box-sizing:border-box;font:inherit;padding:.6rem;border:1px solid #999;border-radius:8px}button{margin-top:1rem;font:inherit;font-weight:700;padding:.6rem 1.2rem;border:0;border-radius:8px;background:#1b1b1b;color:#fff}small{color:#555}</style>
<h1>Your AI key for the guides</h1><p>Paste your Anthropic API key. It goes from this page to your studio's Worker as the secret <code>HOMIE_BRAIN_KEY</code>, and nowhere else: not to the chat, not to a file. Your guides then think with claude-haiku-4-5, on your account, within the daily dollar cap in your office.</p>
<form method="post" action="/key"><input type="hidden" name="n" value="${nonce}"><input name="key" type="password" autocomplete="off" placeholder="sk-ant-…" required><button>Save to my Worker</button></form><p><small>This page works once and closes in ten minutes.</small></p>`;
  return await new Promise((done) => {
    let finished = false;
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === `/${nonce}`) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(page); return; }
      if (req.method === 'POST' && req.url === '/key') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
        req.on('end', () => {
          const form = new URLSearchParams(body);
          const key = String(form.get('key') ?? '').trim();
          if (form.get('n') !== nonce || finished) { res.writeHead(403); res.end('This page was used already.'); return; }
          if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('That does not look like an Anthropic API key (sk-ant-…). Go back and try again.'); return; }
          finished = true;
          const r = w(['secret', 'put', 'HOMIE_BRAIN_KEY'], { input: `${key}\n` });
          const okay = r.code === 0;
          res.writeHead(okay ? 200 : 500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(okay ? 'Saved to your Worker. You can close this page.' : 'Wrangler could not save it (is this computer signed in to Cloudflare? npx wrangler login). Nothing was kept.');
          server.close();
          done(okay ? { ok: true, command: 'agents brain key', saved: true, message: 'Saved as the Worker secret HOMIE_BRAIN_KEY (never shown). Owner-key guides use it from their next decision.' } : { ok: false, command: 'agents brain key', why: 'wrangler secret put failed (sign in with npx wrangler login, then run this again)' });
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(port, '127.0.0.1', () => {
      const link = `http://127.0.0.1:${server.address().port}/${nonce}`;
      log(`Open this page on this computer and paste the key there (not in a chat): ${link}`);
    });
    setTimeout(() => { if (!finished) { finished = true; server.close(); done({ ok: false, command: 'agents brain key', why: 'nothing was saved in ten minutes; run it again when ready' }); } }, wait).unref?.();
  });
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
