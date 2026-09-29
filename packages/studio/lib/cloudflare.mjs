/**
 * `homie-studio deploy` — the studio's site on the studio's OWN Cloudflare
 * account, through Cloudflare's own tool (Wrangler, pinned in the studio).
 *
 * The person's only step is Wrangler's sign-in (`npx wrangler login`, one
 * approval in their browser); Wrangler keeps that login, this never sees a key.
 *
 * It creates what the studio needs, by the names in studio.json:
 *   the Worker (pages + rooms), a D1 database, an R2 bucket (when the account
 *   has R2), the Table/Lobby Durable Objects (declared by the Worker)
 * and it REFUSES to touch a Worker, database or bucket of that name that this
 * studio did not create (studio.json `cloudflare.created` is the record), so it
 * can never overwrite someone's existing site.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from './build.mjs';
import { wranglerConfig } from './scaffold.mjs';
import { readStudio, writeStudio } from './studio.mjs';

const ANSI = /\u001b\[[0-9;]*m/g;

export function wranglerBin(root) {
  const local = join(root, 'node_modules', '.bin', 'wrangler');
  return existsSync(local) ? local : null;
}

function runner(root, env) {
  const bin = wranglerBin(root);
  if (!bin) throw new Error('Wrangler is not installed in this studio yet: run `npm install` in the studio folder first');
  return (args, { cwd = join(root, 'site'), input } = {}) => {
    const res = spawnSync(bin, args, {
      cwd, env: { ...process.env, ...env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, encoding: 'utf8',
      input, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000,
    });
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.replace(ANSI, '');
    return { code: res.status ?? 1, out, stdout: (res.stdout ?? '').replace(ANSI, '') };
  };
}

/** Who Wrangler is signed in as, or null. Never prints a token. */
export function whoami(root, env = {}) {
  const w = runner(root, env);
  const res = w(['whoami', '--json'], { cwd: root });
  if (res.code !== 0) return null;
  try { const d = JSON.parse(res.stdout); return d.loggedIn ? { accounts: (d.accounts ?? []).map((a) => ({ id: a.id, name: a.name })), authType: d.authType } : null; } catch { return null; }
}

function parseJson(text) {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  try { return JSON.parse(text.slice(start)); } catch { return null; }
}

export async function deploy(root, { log = () => {}, homie } = {}) {
  const studio = readStudio(root);
  const cf = { r2: `${studio.slug}-media`, created: [], ...studio.cloudflare };
  const created = new Set(cf.created ?? []);
  const who = whoami(root);
  if (!who) {
    return { ok: false, command: 'deploy', needs: 'cloudflare-login', why: 'Wrangler is not signed in to Cloudflare. Run `npx wrangler login` in the studio folder: it opens Cloudflare in the browser and the person approves once. Then run `npm run deploy` again.' };
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || cf.accountId || (who.accounts.length === 1 ? who.accounts[0].id : null);
  if (!accountId) {
    return { ok: false, command: 'deploy', needs: 'cloudflare-account', why: `This Cloudflare login can reach ${who.accounts.length} accounts; ask the person which one this studio uses and put its id in studio.json (cloudflare.accountId).`, accounts: who.accounts };
  }
  const w = runner(root, { CLOUDFLARE_ACCOUNT_ID: accountId });
  // Record every resource the moment it exists, so a deploy cut short (an expired login, a network drop) resumes
  // instead of refusing its own database as "someone else's" next time.
  const remember = (key) => {
    created.add(key);
    writeStudio(root, { ...readStudio(root), cloudflare: { ...readStudio(root).cloudflare, accountId, created: [...created].sort() } });
  };
  const steps = [];
  const step = (what, extra = {}) => { steps.push({ what, ...extra }); log(what); };

  const b = await build(root, { log });
  if (!b.catalogue.length) return { ok: false, command: 'deploy', why: 'no games built yet: make one with `npx --no-install homie-studio game new <id> --from gem-rush`' };
  step(`built ${b.catalogue.length} game(s)`);

  // The Worker: never one this studio did not make.
  if (!created.has(`worker:${cf.worker}`)) {
    const exists = w(['versions', 'list', '--name', cf.worker, '--json']);
    if (exists.code === 0) {
      return { ok: false, command: 'deploy', why: `A Worker named "${cf.worker}" already exists on this Cloudflare account and this studio did not create it, so nothing was deployed. Pick another name in studio.json (cloudflare.worker) and site/wrangler.jsonc (name).` };
    }
    if (!/10007|does not exist/i.test(exists.out)) return { ok: false, command: 'deploy', why: `could not check the Worker name: ${exists.out.trim().split('\n').slice(-3).join(' ')}` };
  }

  // D1.
  const list = w(['d1', 'list', '--json']);
  const dbs = parseJson(list.out) ?? [];
  let db = dbs.find((d) => d.name === cf.d1);
  if (db && !created.has(`d1:${cf.d1}`)) {
    return { ok: false, command: 'deploy', why: `A D1 database named "${cf.d1}" already exists on this account and this studio did not create it; nothing was deployed. Pick another name in studio.json (cloudflare.d1).` };
  }
  if (!db) {
    const made = w(['d1', 'create', cf.d1]);
    const id = /"?database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/.exec(made.out)?.[1];
    if (made.code !== 0 || !id) return { ok: false, command: 'deploy', why: `could not create the D1 database "${cf.d1}": ${made.out.trim().split('\n').slice(-4).join(' ')}` };
    db = { name: cf.d1, uuid: id };
    remember(`d1:${cf.d1}`);
    step(`created D1 ${cf.d1}`);
  }

  // R2, when the account has it (R2 needs a payment method on the account; without it the site runs without MEDIA).
  let r2 = cf.r2 || null;
  if (r2 && !created.has(`r2:${r2}`)) {
    const buckets = w(['r2', 'bucket', 'list']);
    const names = [...buckets.out.matchAll(/^name:\s+(\S+)/gm)].map((m) => m[1]);
    if (names.includes(r2)) {
      return { ok: false, command: 'deploy', why: `An R2 bucket named "${r2}" already exists on this account and this studio did not create it; nothing was deployed. Pick another name in studio.json (cloudflare.r2).` };
    }
    const made = w(['r2', 'bucket', 'create', r2]);
    if (made.code === 0) { remember(`r2:${r2}`); step(`created R2 ${r2}`); }
    else if (/enable R2|R2 is not enabled|10042|purchase|subscription/i.test(made.out)) { step('R2 is not enabled on this account: the site deploys without media storage for now'); r2 = null; }
    else return { ok: false, command: 'deploy', why: `could not create the R2 bucket "${r2}": ${made.out.trim().split('\n').slice(-4).join(' ')}` };
  }

  writeFileSync(join(root, 'site', 'wrangler.jsonc'), wranglerConfig({ worker: cf.worker, name: studio.name, d1: cf.d1, d1Id: db.uuid, r2 }));
  const migrate = w(['d1', 'migrations', 'apply', cf.d1, '--remote']);
  if (migrate.code !== 0) return { ok: false, command: 'deploy', why: `D1 migrations failed: ${migrate.out.trim().split('\n').slice(-4).join(' ')}` };
  step('D1 migrations applied');

  const started = Date.now();
  const dep = w(['deploy']);
  if (dep.code !== 0) return { ok: false, command: 'deploy', why: `wrangler deploy failed: ${dep.out.trim().split('\n').slice(-6).join(' ')}` };
  remember(`worker:${cf.worker}`);
  const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(dep.out)?.[0] ?? cf.url ?? null;
  step(`deployed ${cf.worker} in ${Math.round((Date.now() - started) / 1000)} s`, { url });

  // The homie.rocks directory claim: the site serves it, which proves this studio controls the site.
  const directory = homie || studio.homie?.directory || 'https://homie.rocks';
  let claim = null;
  if (url) {
    try {
      const res = await fetch(`${directory.replace(/\/+$/, '')}/api/studio/claim?site=${encodeURIComponent(url)}`);
      const body = await res.json();
      if (res.ok && /^[a-f0-9]{16,128}$/.test(body.claim ?? '')) claim = body.claim;
    } catch { /* the directory is optional for a live site */ }
    if (claim) {
      const put = w(['d1', 'execute', cf.d1, '--remote', '--command', `INSERT OR REPLACE INTO meta (key, value) VALUES ('homie_claim', '${claim}')`]);
      step(put.code === 0 ? 'directory claim stored' : 'could not store the directory claim (publish will say so)');
    }
  }

  const next = { ...cf, accountId, url, d1Id: db.uuid, r2, created: [...created].sort(), deployedAt: new Date().toISOString() };
  writeStudio(root, { ...studio, cloudflare: next });
  return {
    ok: true, command: 'deploy', url, worker: cf.worker, d1: cf.d1, r2, account: accountId, steps,
    games: b.catalogue.map((id) => ({ id, page: url ? `${url}/${id}/` : null, play: url ? `${url}/${id}/play` : null })),
    claim: Boolean(claim), directory,
  };
}
