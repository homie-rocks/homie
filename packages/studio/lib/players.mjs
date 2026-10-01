/**
 * `homie-studio players` — the studio's players, for its owner (worker/players.mjs, saves/SAVES.md).
 *
 *   homie-studio players [--url <site>]          how many have accounts, guests with saves, who played this week
 *   homie-studio players owner [--url <site>]    a one-time link that marks the owner's OWN player account as the
 *                                                owner's (open it in the browser where they are signed in on the site)
 *   homie-studio players owner --revoke          no account is the owner's any more
 *
 * The proof of ownership is the studio's own Cloudflare login, as for `stats`: the link's key is minted here and
 * only its SHA-256 goes into the studio's D1 (through Wrangler). The link works once, for 30 minutes.
 */
import { runner } from './cloudflare.mjs';
import { loopback, mint, siteOf, statsShow } from './stats.mjs';

export async function playersShow(root, { url } = {}) {
  const s = await statsShow(root, { url, range: '7d' });
  if (!s.ok) return { ...s, command: 'players' };
  if (!s.players) return { ok: false, command: 'players', why: 'this studio\'s D1 has no player tables yet: `npm run deploy` applies migration 0004_players.sql (or `npm run dev` for a local site)' };
  return { ok: true, command: 'players', site: s.site, players: s.players, note: 'Counts only. A player\'s name, passkeys and saves are theirs; the back office lists names, never a passkey or an email.' };
}

export function playersOwner(root, { url, revoke = false } = {}) {
  const { studio, site } = siteOf(root, url);
  if (!site) return { ok: false, command: 'players owner', why: 'this studio has no live site yet: `npm run deploy` first, or give --url http://127.0.0.1:8787 for `npm run dev`' };
  const local = loopback(site);
  if (revoke) {
    const w = runner(root, studio.cloudflare?.accountId && !local ? { CLOUDFLARE_ACCOUNT_ID: studio.cloudflare.accountId } : {});
    const res = w(['d1', 'execute', studio.cloudflare.d1, local ? '--local' : '--remote', '--command', "UPDATE players SET owner = 0; DELETE FROM stats_keys WHERE kind = 'player-owner';"]);
    return res.code === 0 ? { ok: true, command: 'players owner', site, revoked: true, message: 'No player account is the owner\'s now. `homie-studio players owner` marks one again.' }
      : { ok: false, command: 'players owner', why: res.out.trim().split('\n').slice(-3).join(' ') };
  }
  const k = mint(root, studio, 'player-owner', 30 * 60_000, { local });
  if (!k.ok) return { ok: false, command: 'players owner', why: k.why };
  return {
    ok: true, command: 'players owner', site, link: `${site}/account/?owner=${k.key}`, expiresAt: k.expiresAt,
    use: 'Give this link to the studio\'s owner to open in the browser where they play: they sign in (or make an account with a passkey) on that page, then press "Yes, this account is mine". It works once, within 30 minutes. It is theirs alone; do not post it anywhere.',
  };
}
