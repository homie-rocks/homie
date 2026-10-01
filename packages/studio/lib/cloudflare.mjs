/**
 * `homie-studio deploy` — the studio's site on the studio's OWN Cloudflare
 * account, through Cloudflare's own tool (Wrangler, pinned in the studio).
 *
 * The person's only step is Wrangler's sign-in (`npx wrangler login`, one
 * approval in their browser); Wrangler keeps that login, this never sees a key.
 *
 * NO CREDIT CARD. It creates only what Cloudflare's free Workers plan gives a
 * brand-new account with no payment method, by the names in studio.json:
 *   the Worker (pages + rooms), a D1 database, and the Table/Lobby Durable
 *   Objects (SQLite-backed, declared by the Worker).
 * It never creates or binds R2: Cloudflare asks for a payment method before R2
 * works, even inside its free tier, so storage for large media is its own later
 * step (`homie-studio storage add`) that the person agrees to.
 *
 * It REFUSES to touch a Worker, database or bucket of that name that this
 * studio did not create (studio.json `cloudflare.created` is the record), so it
 * can never overwrite someone's existing site. `deploy --plan` says all of this
 * before anything happens and calls nothing.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from './build.mjs';
import { repoOf } from './repo.mjs';
import { ensureLocalIgnored, ensureMigrations, migrationWord, wranglerConfig } from './scaffold.mjs';
import { LOCAL_STATE, configPath, isWorkersDev, layoutOf, readLocal, readStudio, siteUrl, workerDir, writeLocal, writeStudio } from './studio.mjs';

const ANSI = /\u001b\[[0-9;]*m/g;

export function wranglerBin(root) {
  const local = join(root, 'node_modules', '.bin', 'wrangler');
  return existsSync(local) ? local : null;
}

/** Wrangler from the studio's own node_modules, run in site/ with the given environment. */
export function runner(root, env) {
  const bin = wranglerBin(root);
  if (!bin) throw new Error('Wrangler is not installed in this studio yet: run `npm install` in the studio folder first');
  return (args, { cwd = workerDir(root), input } = {}) => {
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

/*
 * WHAT A NEW ACCOUNT TRIPS ON, said as the next step instead of a Wrangler stack.
 * Measured names: 10034 is Cloudflare's "verify your email address" (a new
 * account cannot deploy a Worker until it does); a missing workers.dev
 * subdomain is registered by Wrangler itself when an agent runs it (Claude Code
 * and Codex are detected), and otherwise needs one visit to the onboarding page.
 */
export function explainCloudflare(out, accountId = null) {
  const text = String(out ?? '');
  const dash = accountId ? `https://dash.cloudflare.com/${accountId}` : 'https://dash.cloudflare.com';
  if (/\b10034\b|verify your email/i.test(text)) {
    return { needs: 'cloudflare-verify-email', why: `Cloudflare needs this account's email address verified before it runs a Worker. Ask the person to open the verification email from Cloudflare (or ${dash}/profile and "Send verification email"), click it, then run \`npm run deploy\` again. No payment method is needed.` };
  }
  if (/register a workers\.dev subdomain|workers\/onboarding/i.test(text)) {
    return { needs: 'workers-dev-subdomain', why: `This Cloudflare account has no workers.dev address yet. Ask the person to open ${dash}/workers/onboarding once and pick one (it is free), then run \`npm run deploy\` again.` };
  }
  if (/maximum number of (D1 )?databases|database limit|too many databases/i.test(text)) {
    return { needs: 'd1-limit', why: 'This Cloudflare account has used all the D1 databases its plan allows (10 on the free plan). Nothing was deployed. Ask the person which unused database of theirs to remove, or use another account; never delete one yourself.' };
  }
  if (/\b1027\b|exceeded .*daily request limit/i.test(text)) {
    return { needs: 'free-plan-daily-limit', why: 'This account used its free plan\'s 100,000 Worker requests for today (it resets at 00:00 UTC). Nothing is broken; try again after the reset.' };
  }
  return null;
}

/** What `deploy` will create and what it costs, from studio.json alone. It calls nothing. */
export function deployPlan(root) {
  const studio = readStudio(root);
  const cf = { created: [], ...studio.cloudflare };
  const created = new Set(cf.created ?? []);
  const storage = cf.r2 && created.has(`r2:${cf.r2}`) ? cf.r2 : null;
  const mark = (key) => (created.has(key) ? 'exists (this studio made it)' : 'will be created');
  return {
    ok: true, command: 'deploy plan', studio: studio.name, account: cf.accountId ?? null,
    cloudflare: [
      { kind: 'Worker', name: cf.worker, what: 'the studio\'s pages, each game\'s page and play shell, and /.well-known/homie-studio.json for the directory', state: mark(`worker:${cf.worker}`), plan: 'Workers Free' },
      { kind: 'D1 database', name: cf.d1, what: 'the directory claim, every finished round, the studio\'s own stats (daily counters of visits, plays, rooms, rounds and songs, for the owner only; nothing about a visitor), and, for games that keep saves, player accounts (a passkey\'s public key, never a password) and their saves', state: mark(`d1:${cf.d1}`), plan: 'Workers Free (500 MB per database, 5 GB per account)' },
      { kind: 'Durable Object', name: 'Table', what: 'one per public room: the netplay relay (seats, host, snapshots); runs no game code', state: 'declared by the Worker', plan: 'Workers Free (SQLite-backed)' },
      { kind: 'Durable Object', name: 'Lobby', what: 'one per game: puts strangers who press Play into the same room', state: 'declared by the Worker', plan: 'Workers Free (SQLite-backed)' },
      storage
        ? { kind: 'R2 bucket', name: storage, what: 'large media for /media/<key> (added with storage add)', state: 'exists (this studio made it)', plan: 'R2 (payment method on the account; 10 GB-month free)' }
        : { kind: 'R2 bucket', name: null, what: 'none: a new studio needs no storage. `homie-studio storage add` adds it later, for large media only', state: 'not created', plan: null },
    ],
    cost: storage
      ? 'Free on Cloudflare\'s Workers Free plan. R2 storage is free up to 10 GB-month; beyond that Cloudflare bills the account directly.'
      : 'Free: everything above is on Cloudflare\'s Workers Free plan, which needs no payment method. Its daily limits (100,000 Worker requests; D1 5 million rows read and 100,000 written) reset at 00:00 UTC; past them requests fail until the reset, nothing is charged.',
    login: 'One approval: `npx wrangler login` opens Cloudflare in the person\'s browser (a free account works; a new one verifies its email address first).',
    address: `https://${cf.worker}.<the account's workers.dev subdomain>.workers.dev`,
    directory: {
      site: studio.homie?.directory || 'https://homie.rocks',
      stores: 'the site\'s address and a claim token, the studio\'s name and slug, the @homie-rocks/studio version, and each game\'s id, name, blurb and Play/page links. Never code, media, keys or accounts.',
    },
    never: 'It never touches a Worker, database or bucket this studio did not create, and it never adds a payment method or buys anything.',
  };
}

export async function deploy(root, { log = () => {}, homie } = {}) {
  const studio = readStudio(root);
  const cf = { r2: null, created: [], ...studio.cloudflare };
  const created = new Set(cf.created ?? []);
  const who = whoami(root);
  if (!who) {
    return { ok: false, command: 'deploy', needs: 'cloudflare-login', why: 'Wrangler is not signed in to Cloudflare. Run `npx wrangler login` in the studio folder: it opens Cloudflare in the browser and the person approves once (a free account works, no payment method). Then run `npm run deploy` again.' };
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || cf.accountId || (who.accounts.length === 1 ? who.accounts[0].id : null);
  if (!accountId) {
    return { ok: false, command: 'deploy', needs: 'cloudflare-account', why: `This Cloudflare login can reach ${who.accounts.length} accounts; ask the person which one this studio uses and put its id in studio.json (cloudflare.accountId).`, accounts: who.accounts };
  }
  const w = runner(root, { CLOUDFLARE_ACCOUNT_ID: accountId });
  const refuse = (why, out) => {
    const r = { ok: false, command: 'deploy', ...(explainCloudflare(out, accountId) ?? { why }) };
    // What the account asked for (an email to verify…) stays on this computer, for `setup status`.
    if (r.needs) { try { writeLocal(root, { needs: r.needs, needsAt: new Date().toISOString() }); } catch { /* not recorded */ } }
    return r;
  };
  // Record every resource the moment it exists, so a deploy cut short (an expired login, a network drop) resumes
  // instead of refusing its own database as "someone else's" next time.
  const remember = (key) => {
    created.add(key);
    writeStudio(root, { ...readStudio(root), cloudflare: { ...readStudio(root).cloudflare, accountId, created: [...created].sort() } });
  };
  const steps = [];
  const step = (what, extra = {}) => { steps.push({ what, ...extra }); log(what); };

  // The first deploy says what it is about to create, and what it costs, before it creates anything: the person
  // reads it in the transcript whether or not the AI repeated it.
  const announced = [];
  if (!created.has(`worker:${cf.worker}`)) {
    const account = who.accounts.find((a) => a.id === accountId)?.name ?? 'the signed-in account';
    announced.push(
      `First deploy of ${studio.name} to the Cloudflare account "${account}". It creates: the Worker ${cf.worker} (the site and its rooms), the D1 database ${cf.d1} (rounds, and the studio's own stats: counts for the owner, never a visitor's identity), and the Durable Objects Table and Lobby (SQLite-backed).`,
      'Cost: free, on the Workers Free plan; no payment method, no R2 (storage for large media is `homie-studio storage add`, later, only if wanted).',
      `The directory (${homie || studio.homie?.directory || 'https://homie.rocks'}) will store the site's address and claim, the studio's name, and each game's name, blurb and Play link.`,
    );
    for (const line of announced) log(line);
  }

  const b = await build(root, { log });
  if (!b.catalogue.length && !b.songs.length && !b.videos.length) return { ok: false, command: 'deploy', why: 'nothing to put online yet: make a game (`npx --no-install homie-studio game new <id> --from gem-rush`) or publish a song or video in music/ or videos/ (media/MEDIA.md)' };
  step(`built ${b.catalogue.length} game(s), ${b.songs.length} song(s), ${b.videos.length} video(s)`);

  // The Worker: never one this studio did not make.
  if (!created.has(`worker:${cf.worker}`)) {
    const exists = w(['versions', 'list', '--name', cf.worker, '--json']);
    if (exists.code === 0) {
      return { ok: false, command: 'deploy', why: `A Worker named "${cf.worker}" already exists on this Cloudflare account and this studio did not create it, so nothing was deployed. Pick another name in studio.json (cloudflare.worker) and site/wrangler.jsonc (name).` };
    }
    if (!/10007|does not exist/i.test(exists.out)) return refuse(`could not check the Worker name: ${exists.out.trim().split('\n').slice(-3).join(' ')}`, exists.out);
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
    if (made.code !== 0 || !id) return refuse(`could not create the D1 database "${cf.d1}": ${made.out.trim().split('\n').slice(-4).join(' ')}`, made.out);
    db = { name: cf.d1, uuid: id };
    remember(`d1:${cf.d1}`);
    step(`created D1 ${cf.d1}`);
  }

  // Storage (R2) is bound only when `storage add` made the bucket. Deploy itself never creates or lists R2, so a
  // free account with no payment method deploys the whole studio.
  const r2 = cf.r2 && created.has(`r2:${cf.r2}`) ? cf.r2 : null;
  if (!r2) step('no storage (R2): the studio needs none to run; `homie-studio storage add` adds it for large media');

  writeFileSync(configPath(root), wranglerConfig({ worker: cf.worker, name: studio.name, d1: cf.d1, d1Id: db.uuid, r2, layout: layoutOf(root) }));
  for (const added of ensureMigrations(root)) step(`added ${added} (${migrationWord(added)})`);
  const migrate = w(['d1', 'migrations', 'apply', cf.d1, '--remote']);
  if (migrate.code !== 0) return refuse(`D1 migrations failed: ${migrate.out.trim().split('\n').slice(-4).join(' ')}`, migrate.out);
  step('D1 migrations applied');

  const started = Date.now();
  const dep = w(['deploy', ...repoVar(root)]);
  if (dep.code !== 0) return refuse(`wrangler deploy failed: ${dep.out.trim().split('\n').slice(-6).join(' ')}`, dep.out);
  remember(`worker:${cf.worker}`);
  // The workers.dev address names the Cloudflare account (often after its owner): it stays on this computer, in
  // .studio/local.json (git-ignored), and never in the committed studio.json. A custom domain stays in studio.json.
  if (ensureLocalIgnored(root)) step(`added .studio/ to .gitignore (${LOCAL_STATE} keeps this computer's own state)`);
  const workersDev = /https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(dep.out)?.[0] ?? readLocal(root).url ?? (isWorkersDev(cf.url) ? cf.url : null);
  if (workersDev) writeLocal(root, { url: workersDev, deployedAt: new Date().toISOString(), needs: null, needsAt: null });
  const movedOut = isWorkersDev(cf.url);
  if (movedOut) {
    cf.url = null;
    writeStudio(root, { ...readStudio(root), cloudflare: { ...readStudio(root).cloudflare, url: null } });
    step(`studio.json no longer keeps the workers.dev address (it names the Cloudflare account); it is in ${LOCAL_STATE} on this computer. An earlier commit of studio.json still has it in the repository's history.`);
  }
  const url = siteUrl(root);
  step(`deployed ${cf.worker} in ${Math.round((Date.now() - started) / 1000)} s`, { url, ...(workersDev && workersDev !== url ? { workersDev } : {}) });

  // The homie.rocks directory claim: the live site claims itself the first time its manifest is read (0.10.0), so
  // reading it once now is all it takes; nothing is stored by hand.
  const directory = homie || studio.homie?.directory || 'https://homie.rocks';
  let claim = null;
  if (url) {
    claim = await warmClaim(url);
    if (claim) step('the site claimed itself in the directory');
    else step('the directory claim is not there yet (the site claims itself when the directory first reads it)');
  }

  // studio.json keeps what is safe to commit: names, ids, the custom domain; never the workers.dev address.
  const { url: _url, deployedAt: _at, ...kept } = cf;
  const next = { ...kept, ...(cf.url && !isWorkersDev(cf.url) ? { url: cf.url } : {}), accountId, d1Id: db.uuid, r2: cf.r2 ?? null, created: [...created].sort() };
  writeStudio(root, { ...readStudio(root), cloudflare: next });
  return {
    ok: true, command: 'deploy', url, ...(workersDev ? { workersDev, local: LOCAL_STATE } : {}), worker: cf.worker, d1: cf.d1, r2, account: accountId, announced, steps,
    games: b.catalogue.map((id) => ({ id, page: url ? `${url}/${id}/` : null, play: url ? `${url}/${id}/play` : null })),
    songs: b.songs.map((slug) => ({ slug, page: url ? `${url}/music/${slug}/` : null })),
    videos: b.videos.map((slug) => ({ slug, page: url ? `${url}/videos/${slug}/` : null })),
    claim: Boolean(claim), directory,
  };
}

/*
 * THE STUDIO'S REPOSITORY, FOR ITS WORKER (lib/repo.mjs). The Claude app's hand-off opens Claude Code on the studio's
 * own GitHub repository, and only the studio knows which it is: the deploy hands it to the Worker as a variable
 * (HOMIE_REPO), never into a public file, and the Worker tells its directory alongside its claim.
 */
export function repoVar(root) {
  const repo = repoOf(root);
  return repo ? ['--var', `HOMIE_REPO:${repo}`] : [];
}

/**
 * Read the live site's manifest once, which makes a 0.10.0 site claim itself in its directory. Returns the claim it
 * serves, or null (the directory did not answer, the site is not reachable yet, or it is a Preview). A fresh deploy
 * can take a few seconds to answer everywhere, so it asks three times.
 */
export async function warmClaim(site, { tries = 3, wait = 2500 } = {}) {
  if (process.env.HOMIE_STUDIO_WARM === '0') return null; // the toolkit's own tests: their live site is made up
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${String(site).replace(/\/+$/, '')}/.well-known/homie-studio.json`, { headers: { accept: 'application/json', 'user-agent': 'homie-studio-deploy' }, signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const body = await res.json();
        if (/^[a-f0-9]{16,128}$/.test(body?.claim ?? '')) return body.claim;
      }
    } catch { /* not answering yet */ }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, wait));
  }
  return null;
}

/** The Worker's name and D1 database, as the studio's wrangler.jsonc says (Cloudflare's forms may have renamed them). */
export function configNames(root) {
  try {
    const text = readFileSync(configPath(root), 'utf8');
    const json = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
    return { worker: json.name ?? null, d1: json.d1_databases?.[0]?.database_name ?? null, binding: json.d1_databases?.[0]?.binding ?? 'DB' };
  } catch { return { worker: null, d1: null, binding: 'DB' }; }
}

/*
 * `npm run deploy` IN WORKERS BUILDS (WORKERS_CI=1, or `deploy --ci`). Cloudflare's own CI has already run
 * `npm run build`, and holds its own API token for this one account; the Worker and its database were made by the
 * "Deploy to Cloudflare" flow or by an earlier deploy. So this only applies the D1 migrations (by binding name: the
 * form may have renamed the database) and deploys. It creates nothing by hand and refuses nothing, and writes
 * nothing back (a CI checkout is thrown away). On the very first deploy the database may not exist yet: Wrangler
 * creates the one the binding names while it deploys, and the migrations run right after.
 */
export async function ciDeploy(root, { log = () => {} } = {}) {
  const w = runner(root, {});
  const names = configNames(root);
  const steps = [];
  const step = (what) => { steps.push({ what }); log(what); };
  const refuse = (why, out) => ({ ok: false, command: 'deploy', ci: true, ...(explainCloudflare(out) ?? { why }), steps });
  if (!existsSync(join(root, 'site', 'dist', 'games.json'))) return { ok: false, command: 'deploy', ci: true, why: 'nothing is built: the build command is `npm run build` (homie-studio build), and it runs before this', steps };
  for (const added of ensureMigrations(root)) step(`added ${added} (${migrationWord(added)})`);
  const apply = () => w(['d1', 'migrations', 'apply', names.binding, '--remote']);
  let migrate = apply();
  const first = migrate.code !== 0 && /not found|could(?:n't| not) find|does not exist|no database|database_id/i.test(migrate.out);
  if (migrate.code !== 0 && !first) return refuse(`D1 migrations failed: ${migrate.out.trim().split('\n').slice(-4).join(' ')}`, migrate.out);
  if (!first) step('D1 migrations applied');
  const started = Date.now();
  const dep = w(['deploy', ...repoVar(root)]);
  if (dep.code !== 0) return refuse(`wrangler deploy failed: ${dep.out.trim().split('\n').slice(-6).join(' ')}`, dep.out);
  step(`deployed ${names.worker ?? 'the Worker'} in ${Math.round((Date.now() - started) / 1000)} s`);
  const repo = repoOf(root);
  step(repo ? `the live site knows its GitHub repository (${repo}), for the Claude app's hand-off` : 'no GitHub repository found here (no HOMIE_REPO, studio.json "github" or git remote): the Claude app\'s card asks the person which it is');
  if (first) {
    migrate = apply();
    if (migrate.code !== 0) return refuse(`D1 migrations failed after the first deploy: ${migrate.out.trim().split('\n').slice(-4).join(' ')}`, migrate.out);
    step('D1 migrations applied (the database was created with this first deploy)');
  }
  // The live address, from what Wrangler printed (a custom domain in studio.json wins).
  const workersDev = /https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(dep.out)?.[0] ?? null;
  let url = null;
  try { url = siteUrl(root) ?? workersDev; } catch { url = workersDev; }
  const claim = url ? await warmClaim(url) : null;
  step(claim ? 'the site claimed itself in the directory' : 'no directory claim yet (the site claims itself when the directory first reads it)');
  let games = [];
  try { games = JSON.parse(readFileSync(join(root, 'site', 'dist', 'games.json'), 'utf8')).games.map((g) => g.id); } catch { games = []; }
  return {
    ok: true, command: 'deploy', ci: true, url, worker: names.worker, d1: names.d1, r2: null, steps, announced: [],
    commit: process.env.WORKERS_CI_COMMIT_SHA ?? null, branch: process.env.WORKERS_CI_BRANCH ?? null,
    games: games.map((id) => ({ id, page: url ? `${url}/${id}/` : null, play: url ? `${url}/${id}/play` : null })), songs: [], videos: [],
    claim: Boolean(claim),
  };
}

/*
 * `homie-studio storage add` — the studio's own storage for large media (songs,
 * videos, big art), as an R2 bucket on its account, bound as MEDIA and served at
 * /media/<key>. It is separate from deploy on purpose: Cloudflare asks for a
 * payment method on the account before R2 works, even inside R2's free tier
 * (10 GB-month), so this is a step the person agrees to, and a studio that only
 * makes games never needs it. It changes nothing on Cloudflare but the one bucket.
 */
export async function storageAdd(root, { log = () => {} } = {}) {
  const studio = readStudio(root);
  const cf = { created: [], ...studio.cloudflare };
  const created = new Set(cf.created ?? []);
  const bucket = cf.r2 || `${studio.slug}-media`;
  if (created.has(`r2:${bucket}`)) {
    return { ok: true, command: 'storage add', bucket, already: true, next: ['npm run deploy   (binds it as MEDIA if the live site does not have it yet)'] };
  }
  const who = whoami(root);
  if (!who) return { ok: false, command: 'storage add', needs: 'cloudflare-login', why: 'Wrangler is not signed in to Cloudflare. Run `npx wrangler login` first (one approval in the browser).' };
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || cf.accountId || (who.accounts.length === 1 ? who.accounts[0].id : null);
  if (!accountId) return { ok: false, command: 'storage add', needs: 'cloudflare-account', why: 'This login reaches several Cloudflare accounts; put the studio\'s in studio.json (cloudflare.accountId) first.', accounts: who.accounts };
  const w = runner(root, { CLOUDFLARE_ACCOUNT_ID: accountId });
  const enable = {
    ok: false, command: 'storage add', needs: 'r2-payment-method', bucket,
    why: `R2 is not turned on for this Cloudflare account. Cloudflare asks for a payment method before R2 works, even inside its free tier (10 GB-month of storage, 1 million writes and 10 million reads a month free). Only the person can decide that: if they want storage, they open https://dash.cloudflare.com/${accountId}/r2/overview, add R2 there, and you run \`npx --no-install homie-studio storage add\` again. Nothing was created; the studio keeps working without storage.`,
  };
  const buckets = w(['r2', 'bucket', 'list']);
  if (buckets.code !== 0) {
    if (/enable R2|R2 is not enabled|10042|purchase|subscription|payment/i.test(buckets.out)) return enable;
    return { ok: false, command: 'storage add', ...(explainCloudflare(buckets.out, accountId) ?? { why: `could not list R2 buckets: ${buckets.out.trim().split('\n').slice(-3).join(' ')}` }) };
  }
  const names = [...buckets.out.matchAll(/^name:\s+(\S+)/gm)].map((m) => m[1]);
  if (names.includes(bucket)) {
    return { ok: false, command: 'storage add', why: `An R2 bucket named "${bucket}" already exists on this account and this studio did not create it; nothing was created. Put another name in studio.json (cloudflare.r2) and run storage add again.` };
  }
  const made = w(['r2', 'bucket', 'create', bucket]);
  if (made.code !== 0) {
    if (/enable R2|R2 is not enabled|10042|purchase|subscription|payment/i.test(made.out)) return enable;
    return { ok: false, command: 'storage add', why: `could not create the R2 bucket "${bucket}": ${made.out.trim().split('\n').slice(-4).join(' ')}` };
  }
  created.add(`r2:${bucket}`);
  const next = { ...readStudio(root), cloudflare: { ...readStudio(root).cloudflare, accountId, r2: bucket, created: [...created].sort() } };
  writeStudio(root, next);
  if (next.cloudflare.d1Id) {
    writeFileSync(configPath(root), wranglerConfig({ worker: cf.worker, name: studio.name, d1: cf.d1, d1Id: next.cloudflare.d1Id, r2: bucket, layout: layoutOf(root) }));
  }
  log(`created R2 ${bucket}`);
  return { ok: true, command: 'storage add', bucket, account: accountId, next: ['npm run deploy   (binds the bucket as MEDIA; the site serves it at /media/<key>)', 'npx --no-install homie-studio media put <file>'] };
}
