/**
 * `homie-studio stats` — the studio's own numbers, for its owner (worker/stats.mjs says what is counted).
 *
 *   homie-studio stats [--range 1d|7d|30d|90d] [--game <id> | --song <slug> | --video <slug>]
 *                                  the numbers, read with a key that lives ten minutes and is dropped after
 *   homie-studio stats key [--hours 1]    a read key for the Homie MCP tool `studio_stats` (up to 30 days)
 *   homie-studio stats link               a one-time link that opens /_studio/stats in the owner's browser
 *   homie-studio stats revoke             every key and page session ends now
 *   homie-studio stats share on|off       tell the homie.rocks directory "played this week" (two numbers), or stop
 *
 * THE PROOF OF OWNERSHIP IS THE STUDIO'S OWN CLOUDFLARE LOGIN. A key is minted here, on this computer, and only
 * its SHA-256 goes into the studio's D1 (through Wrangler, which only the studio's owner is signed in to). The key
 * itself is never sent to Cloudflare, never written to a file, and lives for its hours only. A studio running
 * locally (`npm run dev`, a loopback --url) uses the local D1.
 */
import { createHash, randomBytes } from 'node:crypto';
import { runner } from './cloudflare.mjs';
import { readStudio, siteUrl, writeStudio } from './studio.mjs';

const HOUR = 3600_000;
const RANGES = new Set(['1d', '7d', '30d', '90d']);
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const loopback = (url) => { try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname); } catch { return false; } };

export function siteOf(root, url) {
  const studio = readStudio(root);
  const site = String(url || siteUrl(root, studio) || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(site)) return { studio, site: null };
  return { studio, site };
}

/** Put a key's hash into the studio's D1 (remote, or local for a loopback site). The key never leaves this machine. */
export function mint(root, studio, kind, ttlMs, { local }) {
  const key = `hsk_${randomBytes(24).toString('hex')}`;
  const hash = createHash('sha256').update(key).digest('hex');
  const now = Date.now();
  const w = runner(root, studio.cloudflare?.accountId && !local ? { CLOUDFLARE_ACCOUNT_ID: studio.cloudflare.accountId } : {});
  const sql = `DELETE FROM stats_keys WHERE expires_at < ${now}; INSERT INTO stats_keys (hash, kind, expires_at) VALUES ('${hash}', '${kind}', ${now + ttlMs});`;
  const res = w(['d1', 'execute', studio.cloudflare.d1, local ? '--local' : '--remote', '--command', sql]);
  if (res.code !== 0) {
    const why = /no such table: stats_keys/i.test(res.out)
      ? 'this studio\'s D1 has no stats tables yet: run `npm run deploy` (it applies migration 0002_studio_stats.sql), or `npm run dev` for a local site'
      : /not logged in|login|authenticat/i.test(res.out) ? 'Wrangler is not signed in to this studio\'s Cloudflare: run `npx wrangler login` (the person approves once)'
        : `could not write the key's hash to D1: ${res.out.trim().split('\n').slice(-3).join(' ')}`;
    return { ok: false, why };
  }
  return { ok: true, key, hash, expiresAt: new Date(now + ttlMs).toISOString() };
}

function drop(root, studio, hash, { local }) {
  const w = runner(root, studio.cloudflare?.accountId && !local ? { CLOUDFLARE_ACCOUNT_ID: studio.cloudflare.accountId } : {});
  w(['d1', 'execute', studio.cloudflare.d1, local ? '--local' : '--remote', '--command', `DELETE FROM stats_keys WHERE hash = '${hash}';`]);
}

export function statsQuery({ range, game, song, video } = {}) {
  const q = new URLSearchParams();
  q.set('range', RANGES.has(range) ? range : '7d');
  if (game && SLUG.test(game)) q.set('game', game);
  else if (song && SLUG.test(song)) q.set('song', song);
  else if (video && SLUG.test(video)) q.set('video', video);
  return q;
}

/** The numbers, read with a ten-minute key that is dropped as soon as they are in. */
export async function statsShow(root, { url, range, game, song, video } = {}) {
  const { studio, site } = siteOf(root, url);
  if (!site) return { ok: false, command: 'stats', why: 'this studio has no live site yet: `npm run deploy` first, or give --url http://127.0.0.1:8787 for `npm run dev`' };
  const local = loopback(site);
  const k = mint(root, studio, 'read', 10 * 60_000, { local });
  if (!k.ok) return { ok: false, command: 'stats', why: k.why };
  try {
    const res = await fetch(`${site}/api/stats?${statsQuery({ range, game, song, video })}`, { headers: { authorization: `Bearer ${k.key}` }, signal: AbortSignal.timeout(20_000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) return { ok: false, command: 'stats', why: body.message ?? `${site}/api/stats answered ${res.status}` };
    return { command: 'stats', ...body, ok: true };
  } catch (error) {
    return { ok: false, command: 'stats', why: `could not read ${site}/api/stats: ${error.message}` };
  } finally { drop(root, studio, k.hash, { local }); }
}

/** A read key for `studio_stats` (the Homie MCP): 1 hour by default, 30 days at most. */
export function statsKey(root, { url, hours } = {}) {
  const { studio, site } = siteOf(root, url);
  if (!site) return { ok: false, command: 'stats key', why: 'this studio has no live site yet: `npm run deploy` first' };
  const h = Math.max(1, Math.min(24 * 30, Math.floor(Number(hours) || 1)));
  const k = mint(root, studio, 'read', h * HOUR, { local: loopback(site) });
  if (!k.ok) return { ok: false, command: 'stats key', why: k.why };
  return {
    ok: true, command: 'stats key', site, key: k.key, expiresAt: k.expiresAt, hours: h,
    use: `Call the Homie MCP tool studio_stats with { "site": "${site}", "key": "<this key>" } (and range, game, song or video). The key only reads this studio's numbers, ends at ${k.expiresAt}, and \`homie-studio stats revoke\` ends it sooner. Never paste it anywhere else.`,
  };
}

/** A one-time sign-in link (30 minutes) that opens the private stats page in the owner's own browser. */
export function statsLink(root, { url } = {}) {
  const { studio, site } = siteOf(root, url);
  if (!site) return { ok: false, command: 'stats link', why: 'this studio has no live site yet: `npm run deploy` first' };
  const k = mint(root, studio, 'signin', 30 * 60_000, { local: loopback(site) });
  if (!k.ok) return { ok: false, command: 'stats link', why: k.why };
  return {
    ok: true, command: 'stats link', site, link: `${site}/_studio/signin?k=${k.key}`, expiresAt: k.expiresAt,
    use: 'Give this link to the studio\'s owner to open in their own browser: it works once, within 30 minutes, and keeps that browser signed in to the stats page for 30 days. It is theirs alone; do not post it anywhere.',
  };
}

export function statsRevoke(root, { url } = {}) {
  const { studio, site } = siteOf(root, url);
  const local = site ? loopback(site) : false;
  const w = runner(root, studio.cloudflare?.accountId && !local ? { CLOUDFLARE_ACCOUNT_ID: studio.cloudflare.accountId } : {});
  const res = w(['d1', 'execute', studio.cloudflare.d1, local ? '--local' : '--remote', '--command', 'DELETE FROM stats_keys;']);
  return res.code === 0 ? { ok: true, command: 'stats revoke', site, message: 'Every stats key and page session has ended.' } : { ok: false, command: 'stats revoke', why: res.out.trim().split('\n').slice(-3).join(' ') };
}

export function statsShare(root, on) {
  const studio = readStudio(root);
  const share = on === 'on' || on === true || on === 'true';
  writeStudio(root, { ...studio, stats: { ...(studio.stats ?? {}), share } });
  return {
    ok: true, command: 'stats share', share,
    message: share
      ? 'studio.json stats.share is on. After `npm run deploy`, the site tells the homie.rocks directory two numbers for the whole studio: Play presses and rounds with people in them, over the last 7 days. Nothing else leaves the studio.'
      : 'studio.json stats.share is off. After `npm run deploy`, the site tells the directory nothing.',
  };
}
