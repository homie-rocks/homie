/** Configure one requested hostname. Wrangler creates its DNS and TLS on deploy using OAuth.
 * No zone ids or DNS values pass through the person. Existing unrelated routes stay intact.
 */
import { writeFileSync } from 'node:fs';
import { readConfig, routesOf } from './routes.mjs';
import { configPath, readStudio, writeStudio } from './studio.mjs';

export function studioDomain(root, hostname) {
  const host = String(hostname ?? '').trim().toLowerCase();
  if (host.length > 253 || !host.includes('.') || !host.split('.').every((p) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p)) || host.endsWith('.workers.dev')) {
    return { ok: false, next: 'AI: use the requested domain hostname alone, for example play.example.com.' };
  }
  const config = readConfig(root);
  if (!config) return { ok: false, next: 'AI: repair the studio’s Wrangler configuration, then retry studio_domain.' };
  const routes = routesOf(config);
  if (!routes.some((r) => r.pattern === host && r.custom_domain === true)) routes.push({ pattern: host, custom_domain: true });
  const studio = readStudio(root);
  writeFileSync(configPath(root), `${JSON.stringify({ ...config, routes }, null, 2)}\n`);
  writeStudio(root, { ...studio, cloudflare: { ...studio.cloudflare, domain: host } });
  return { ok: true, host, next: 'AI: run studio_deploy with plan: true, then deploy within the person’s request. Cloudflare creates DNS and TLS with the existing sign-in. If the zone is not active on this account, keep the current live address and help connect the domain in the browser.', open: 'https://dash.cloudflare.com/?to=/:account/domains' };
}

/** A first deploy may need the account's workers.dev name. Never rename an existing one. */
export async function registerWorkersAddress({ accountId, slug = 'studio', headers, fetchFn = fetch } = {}) {
  const next = 'AI: retry Cloudflare sign-in with cloudflare_login, then deploy again.';
  if (!headers || !accountId) return { ok: false, next };
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/subdomain`;
  try {
    const old = await fetchFn(url, { headers, signal: AbortSignal.timeout(15_000) });
    const body = await old.json();
    if (old.ok && body.success !== false && body.result?.subdomain) return { ok: true, created: false };
    if (old.status !== 404 && !(old.ok && body.success !== false && !body.result?.subdomain)) return { ok: false, next, status: old.status };
    // Stable, unguessable from the account name, and no choice of a technical setting for the person.
    const { createHash } = await import('node:crypto');
    const stem = String(slug).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40) || 'studio';
    const suffix = createHash('sha256').update(accountId).digest('hex').slice(0, 10);
    const res = await fetchFn(url, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ subdomain: `${stem}-${suffix}` }), signal: AbortSignal.timeout(15_000) });
    const made = await res.json();
    return res.ok && made.success !== false && made.result?.subdomain
      ? { ok: true, created: true }
      : { ok: false, status: res.status, next: 'AI: open https://dash.cloudflare.com/?to=/:account/workers-and-pages and resolve the account address with the existing sign-in, then retry deploy. Do not ask the person for a setting or id.' };
  } catch { return { ok: false, next: 'AI: retry deploy when Cloudflare is reachable; no account setting was confirmed.' }; }
}
