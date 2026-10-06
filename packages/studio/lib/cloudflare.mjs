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
 * It never creates R2: Cloudflare asks for a payment method before R2 works,
 * even inside its free tier, so storage for large media is its own later step
 * (`homie-studio storage add`) that the person agrees to. Once a studio has it,
 * deploy binds it and moves the big songs and videos there first (mediaMove:
 * uploaded, read back, checked by SHA-256), so the site stops carrying them and
 * serves them from R2 at the same addresses.
 *
 * It REFUSES to touch a Worker, database or bucket of that name that this
 * studio did not create (studio.json `cloudflare.created` is the record), so it
 * can never overwrite someone's existing site. `deploy --plan` says all of this
 * before anything happens and calls nothing.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from './build.mjs';
import { builtGames, compareDeploy, deployWords, lastDeploy, lastDeployRecord, lockDeploy, recordDeploy } from './deploy-state.mjs';
import { listedHere, publish } from './directory.mjs';
import { MAX_ASSET_BYTES, R2_COST, mediaPlan, r2OverOf, recordMove, sha256File, sizeOf } from './media.mjs';
import { whyFailed } from './net.mjs';
import { repoOf } from './repo.mjs';
import { keptRoutes, readConfig, shadowedDomain, wideRouteRefusal } from './routes.mjs';
import { ensureLocalIgnored, ensureMigrations, migrationWord, wranglerConfig } from './scaffold.mjs';
import { LOCAL_STATE, configPath, isWorkersDev, layoutOf, readLocal, readStudio, siteUrl, workerDir, writeLocal, writeStudio } from './studio.mjs';
import { projectsCloudflareEnv } from './projects-env.mjs';

const ANSI = /\u001b\[[0-9;]*m/g;

export function wranglerBin(root) {
  const local = join(root, 'node_modules', '.bin', 'wrangler');
  return existsSync(local) ? local : null;
}

/**
 * Wrangler from the studio's own node_modules, run in site/ with the given environment. A studio whose Cloudflare came
 * through Stripe Projects (studio.json `cloudflare.auth: "stripe-projects"`, 0.24.3) runs it with the token and account
 * Projects synced to its git-ignored output file; every other studio with Wrangler's own sign-in.
 */
export function runner(root, env) {
  const bin = wranglerBin(root);
  if (!bin) throw new Error('Wrangler is not installed in this studio yet: run `npm install` in the studio folder first');
  return (args, { cwd = workerDir(root), input } = {}) => {
    const res = spawnSync(bin, args, {
      cwd, env: { ...process.env, ...projectsCloudflareEnv(root), ...env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, encoding: 'utf8',
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
  // A route in wrangler.jsonc that another Worker of the zone already holds. Wrangler refuses, and so does the
  // studio: that route is not the studio's to take (lib/routes.mjs).
  if (/assigned to another worker|already assigned to routes/i.test(text)) {
    const routes = [...text.matchAll(/^\s*-\s+(\S+)\s*$/gm)].map((m) => m[1]);
    return { needs: 'cloudflare-routes', ...(routes.length ? { routes } : {}), why: `A route in wrangler.jsonc${routes.length ? ` (${routes.join(', ')})` : ''} already belongs to another Worker on this Cloudflare zone, so Cloudflare refused the deploy and the live site is unchanged. The studio never takes a route from another Worker. If the route is wider than the studio's own hostname (a wildcard, a catch-all), take it out of wrangler.jsonc and give the studio its own: { "pattern": "<its hostname>/*", "zone_name": "<the domain>" }. If it IS the studio's own hostname, ask the person: only they can unassign it from the other Worker, in the zone's Workers Routes in the Cloudflare dashboard.` };
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
        ? { kind: 'R2 bucket', name: storage, what: 'the studio\'s big media: songs and videos over the size studio.json media.r2Over names (1 MiB unless set) or that git leaves out, uploaded and checked by SHA-256 before the site stops carrying them, served at their same addresses', state: 'exists (this studio made it)', plan: 'R2 (payment method on the account; 10 GB-month free)' }
        : { kind: 'R2 bucket', name: null, what: 'none: a new studio needs no storage. `homie-studio storage add` adds it later, for large media only', state: 'not created', plan: null },
    ],
    cost: storage
      ? `Free on Cloudflare's Workers Free plan. ${R2_COST} Beyond the free tier Cloudflare bills the account directly.`
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

/**
 * `homie-studio deploy`. One at a time for a studio: it holds the studio's deploy lock (lib/deploy-state.mjs) from
 * before it reads anything until it ends, however it ends. `fetchFn` is the toolkit's own tests' stand-in network.
 */
export async function deploy(root, opts = {}) {
  const lock = lockDeploy(root);
  if (!lock.ok) return { ok: false, command: 'deploy', needs: lock.needs, why: lock.why };
  // A deploy that is killed still lets go (a kill -9 cannot; the next deploy sees its process is gone).
  const onExit = () => lock.release();
  process.once('exit', onExit);
  try { return await deployLocked(root, opts); } finally { process.off('exit', onExit); lock.release(); }
}

async function deployLocked(root, { log = () => {}, homie, fetchFn = null } = {}) {
  const studio = readStudio(root);
  const cf = { r2: null, created: [], ...studio.cloudflare };
  const created = new Set(cf.created ?? []);
  // A wildcard or catch-all route in the studio's own config would hand other hostnames of the zone to this Worker:
  // refused before Cloudflare is asked anything (lib/routes.mjs). Read once here; every rewrite below keeps the
  // studio's own routes exactly as its owner wrote them.
  const wide = wideRouteRefusal(readConfig(root), studio);
  if (wide) return { ok: false, command: 'deploy', ...wide };
  const routes = keptRoutes(root, studio);
  const who = whoami(root);
  if (!who) {
    if (cf.auth === 'stripe-projects') {
      return { ok: false, command: 'deploy', needs: 'cloudflare-login', why: 'Wrangler did not accept the Cloudflare token Stripe Projects keeps for this studio (studio.json "auth": "stripe-projects"). Run `stripe projects env --pull` in the studio folder (it rewrites the git-ignored .env from Projects\' vault), then `npm run deploy` again; or sign in the usual way (`npx wrangler login`) and remove "auth" from studio.json.' };
    }
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

  // Big media into the studio's R2 before the build (0.18.0): only with storage this studio made, so a free account
  // with no payment method is never asked anything about R2. Each file is read back and its SHA-256 compared before
  // the build stops carrying it; a file that did not make it stays on the site (when it fits) and is named here.
  const storage = cf.r2 && created.has(`r2:${cf.r2}`) ? cf.r2 : null;
  let media = null;
  if (storage) {
    media = await mediaMove(root, { auto: true, accountId, log });
    for (const m of media.moved ?? []) step(`moved ${m.path} (${sizeOf(m.bytes)}) to R2 and checked it by SHA-256; the site serves it at the same address, ${m.url}`);
    for (const m of media.failed ?? []) step(`not moved to R2: ${m.path}: ${m.why}`);
    if (media.why && !media.ok) step(`big media stays on the site this time: ${media.why}`);
  }

  const b = await build(root, { log, deploy: true });
  // A new studio goes live with its own Home ("First game coming soon") before it has a game.
  step(b.catalogue.length || b.songs.length || b.videos.length ? `built ${b.catalogue.length} game(s), ${b.songs.length} song(s), ${b.videos.length} video(s)` : 'built the home page (no game yet: "First game coming soon")');
  for (const n of b.mediaNotes ?? []) step(`note: ${n.file}: ${n.why}`);
  if (b.retired) step(`note: ${b.retired}`);
  // Which games this deploy changes, against what the last deploy from this computer put live, each with the
  // build's own hash for it (lib/deploy-state.mjs: one hash vocabulary). The record is written only once Wrangler has deployed.
  const builtNow = builtGames(root, b.catalogue);
  const delta = compareDeploy(builtNow, lastDeploy(root), lastDeployRecord(root));
  for (const g of delta.games) step(`${g.id}: ${deployWords(delta.first ? { hash: g.hash } : g)}`, { game: g.id, hash: g.hash, change: g.change });
  if (delta.first && delta.games.length) step('no earlier deploy from this computer to compare with: the next one says changed or unchanged for each game');
  for (const id of delta.removed) step(`${id}: no longer in the build; it leaves the site with this deploy`);

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
  const r2 = storage;
  if (!r2) step('no storage (R2): the studio needs none to run; `homie-studio storage add` adds it for large media');

  writeFileSync(configPath(root), wranglerConfig({ worker: cf.worker, name: studio.name, d1: cf.d1, d1Id: db.uuid, r2, layout: layoutOf(root), routes }));
  if (routes) step(`kept the studio's own route${routes.length === 1 ? '' : 's'} in wrangler.jsonc: ${routes.map((r) => r.pattern).join(', ')}`);
  for (const added of ensureMigrations(root)) step(`added ${added} (${migrationWord(added)})`);
  const migrate = w(['d1', 'migrations', 'apply', cf.d1, '--remote']);
  if (migrate.code !== 0) return refuse(`D1 migrations failed: ${migrate.out.trim().split('\n').slice(-4).join(' ')}`, migrate.out);
  step('D1 migrations applied');
  // Workers AI (0.17.0): bound only when a server's AI guides think with it.
  if (needsWorkersAi(root, w, cf.d1)) {
    writeFileSync(configPath(root), wranglerConfig({ worker: cf.worker, name: studio.name, d1: cf.d1, d1Id: db.uuid, r2, layout: layoutOf(root), ai: true, routes }));
    step('Workers AI bound (AI): a server\'s AI guides think with it and typed room chat is reviewed with it, each within its day\'s budget (free allocation: 10,000 neurons a day)');
  }

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
  recordDeploy(root, builtNow);
  let claim = null;
  const notes = [];
  if (url) {
    const read = await readLiveSite(url, fetchFn ? { fetchFn } : {});
    claim = read.claim;
    if (claim) step('the site claimed itself in the directory');
    else if (read.state === 'other' && !isWorkersDev(url)) {
      // The studio's own domain answered as something else: say which route is needed (lib/routes.mjs). The deploy
      // itself went through; the zone's other routes are never touched.
      const s = shadowedDomain(readConfig(root), new URL(url).hostname, read);
      notes.push(s.why);
      step(s.why, s.route ? { needs: 'cloudflare-routes', route: s.route } : {});
    } else if (read.state === 'unreachable') {
      // This computer could not ask (its own name lookup, no connection): a network preflight failure, never a
      // verdict on the site that was just deployed.
      const said = `deployed, but this computer could not read ${url} back to check it: ${read.why}. ${read.preflight === 'dns' ? 'That is this computer\'s name lookup (a browser here may still open the site), not the deploy.' : 'That is this computer\'s connection, not the deploy.'} The site claims itself when the directory first reads it.`;
      notes.push(said);
      step(said, { preflight: read.preflight ?? 'network' });
    } else step('the directory claim is not there yet (the site claims itself when the directory first reads it)');
  }

  // The deploy before this one came from a toolkit that still had remix, and left games open to be taken whole. No
  // game's source is served any more, but the directory keeps its old copy of the studio (and its offer of those
  // games) until it reads the site again, so ask it to, now. ONLY for a studio this computer listed (publish records
  // it): going online never lists a studio, and a deploy never lists one either. Once: see compareDeploy.
  let reread = null;
  if (url && delta.withdrawn.length) {
    const which = delta.withdrawn.join(', ');
    const dir = String(directory).replace(/\/+$/, '');
    if (listedHere(root, { site: url, directory: dir })) {
      const again = await publish(root, { homie: dir, site: url, ...(fetchFn ? { fetchFn } : {}) });
      reread = { ok: again.ok, games: delta.withdrawn, ...(again.ok ? {} : { why: again.why }), ...(again.publishes ? { publishes: again.publishes } : {}) };
      step(again.ok
        ? `asked the directory to read the studio again: it still offered the source of ${which}, and no game's source is served whole any more${again.publishes?.line ? ` (${again.publishes.line})` : ''}`
        : `the directory still offers the source of ${which}, which is no longer served, and it did not take the re-read (${String(again.why ?? 'no answer').split('\n')[0]}): it keeps its old copy until the next publish`);
      if (!again.ok) notes.push(`The directory still offers the source of ${which}, which this site no longer serves: publish again later (homie-studio publish).`);
    } else {
      step(`the source of ${which} is no longer served (games build on each other through parts now); this computer has no record of listing the studio in the directory, so the directory was not asked anything (a deploy never lists a studio). If it is listed, publish again and the directory reads the site as it is.`);
    }
  }

  // studio.json keeps what is safe to commit: names, ids, the custom domain; never the workers.dev address.
  const { url: _url, deployedAt: _at, ...kept } = cf;
  const next = { ...kept, ...(cf.url && !isWorkersDev(cf.url) ? { url: cf.url } : {}), accountId, d1Id: db.uuid, r2: cf.r2 ?? null, created: [...created].sort() };
  writeStudio(root, { ...readStudio(root), cloudflare: next });
  return {
    ok: true, command: 'deploy', url, ...(workersDev ? { workersDev, local: LOCAL_STATE } : {}), worker: cf.worker, d1: cf.d1, r2, account: accountId, announced, steps,
    ...(media ? { media: { moved: media.moved ?? [], failed: media.failed ?? [], inR2: media.inR2 ?? null } } : {}),
    games: b.catalogue.map((id) => { const g = delta.games.find((x) => x.id === id); return { id, page: url ? `${url}/${id}/` : null, play: url ? `${url}/${id}/play` : null, hash: g?.hash ?? null, change: delta.first ? 'first deploy from this computer' : g?.change ?? null }; }),
    ...(delta.removed.length ? { removed: delta.removed } : {}),
    ...(routes ? { routes: routes.map((r) => r.pattern) } : {}),
    ...(notes.length ? { notes } : {}),
    ...(reread ? { reread } : {}),
    songs: b.songs.map((slug) => ({ slug, page: url ? `${url}/music/${slug}/` : null })),
    videos: b.videos.map((slug) => ({ slug, page: url ? `${url}/videos/${slug}/` : null })),
    claim: Boolean(claim), directory,
  };
}

/**
 * Whether any server of this studio's games thinks with Workers AI (a D1 row with brain 'workers-ai', or a game.json
 * seed): deploy binds AI only then (DESIGN section 6). A database without the servers table yet says no.
 */
export function needsWorkersAi(root, w, db) {
  try {
    const cat = JSON.parse(readFileSync(join(root, 'site', 'dist', 'games.json'), 'utf8'));
    if ((cat.games ?? []).some((g) => (g.servers ?? []).some((s) => s.brain === 'workers-ai'))) return true;
    // Room chat (0.23.0): a game whose players may type has its messages reviewed by the studio's own Workers AI
    // (Cloudflare's Clef decision model, within a day's budget of the free allocation) unless its game.json says no.
    if ((cat.games ?? []).some((g) => g.chat !== false && (g.chat?.mode ?? 'text') === 'text' && g.chat?.ai !== false)) return true;
    // A game's own decisions (0.24.4): a game whose game.json says "decide": true asks the same decision model.
    if ((cat.games ?? []).some((g) => g.decide === true)) return true;
  } catch { /* not built */ }
  const r = w(['d1', 'execute', db, '--remote', '--json', '--command', "SELECT COUNT(*) AS n FROM servers WHERE brain = 'workers-ai' AND state = 'open'"]);
  if (r.code !== 0) return false;
  const parsed = parseJson(r.stdout ?? r.out);
  return Number((Array.isArray(parsed) ? parsed[0] : parsed)?.results?.[0]?.n) > 0;
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
 * The live site's manifest, read back after a deploy, and what the answer was:
 *   state 'studio'       it answered as a studio; `claim` is its directory claim (null until it has one)
 *   state 'other'        the address answered, and not as a studio (another Worker's page, a 404 that is not ours):
 *                        `status`, and `said`, the first words of what it said
 *   state 'unreachable'  this computer could not ask: `why`, and `preflight` ('dns' for a name it could not look up)
 *   state 'skipped'      the toolkit's own tests (HOMIE_STUDIO_WARM=0) with no stand-in network
 * Reading it is also what makes a 0.10.0 site claim itself. A fresh deploy can take a few seconds to answer
 * everywhere, so a site that does not yet answer as a studio is asked three times.
 */
export async function readLiveSite(site, { tries = 3, wait = 2500, fetchFn = null } = {}) {
  if (!fetchFn && process.env.HOMIE_STUDIO_WARM === '0') return { state: 'skipped', claim: null };
  const ask = fetchFn ?? globalThis.fetch;
  const base = String(site).replace(/\/+$/, '');
  let last = { state: 'unreachable', claim: null, why: 'no answer' };
  for (let i = 0; i < tries; i++) {
    try {
      const res = await ask(`${base}/.well-known/homie-studio.json`, { headers: { accept: 'application/json', 'user-agent': 'homie-studio-deploy' }, signal: AbortSignal.timeout(15_000) });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch { body = null; }
      const studio = res.ok && body && typeof body === 'object' && ('claim' in body || Array.isArray(body.games));
      if (studio) {
        const claim = /^[a-f0-9]{16,128}$/.test(body.claim ?? '') ? body.claim : null;
        if (claim) return { state: 'studio', claim };
        last = { state: 'studio', claim: null };
      } else last = { state: 'other', claim: null, status: res.status, said: String(body?.error ?? body?.message ?? text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) };
    } catch (error) {
      const w = whyFailed(error, base);
      last = { state: 'unreachable', claim: null, why: w.why, code: w.code ?? null, ...(w.preflight ? { preflight: w.preflight } : {}) };
      // A name this computer cannot look up does not start resolving in five seconds: say so now.
      if (w.preflight === 'dns') return last;
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, wait));
  }
  return last;
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
  // Workers AI (0.17.0): bound only when a server's AI guides think with it. The checkout is thrown away after.
  if (!first && needsWorkersAi(root, w, names.binding)) {
    try {
      const json = JSON.parse(readFileSync(configPath(root), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
      if (!json.ai) { json.ai = { binding: 'AI' }; writeFileSync(configPath(root), `${JSON.stringify(json, null, 2)}\n`); }
      step('Workers AI bound (AI): the AI guides and the review of typed room chat');
    } catch { step('could not add the Workers AI binding to wrangler.jsonc: the guides answer from the game\'s script'); }
  }
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
  const hashes = builtGames(root, games);
  for (const id of games) if (hashes[id]?.hash) step(`${id}: ${deployWords(hashes[id])}`);
  return {
    ok: true, command: 'deploy', ci: true, url, worker: names.worker, d1: names.d1, r2: null, steps, announced: [],
    commit: process.env.WORKERS_CI_COMMIT_SHA ?? null, branch: process.env.WORKERS_CI_BRANCH ?? null,
    // A CI checkout has no earlier deploy to compare with: each game's content hash only (lib/deploy-state.mjs).
    games: games.map((id) => ({ id, page: url ? `${url}/${id}/` : null, play: url ? `${url}/${id}/play` : null, hash: hashes[id]?.hash ?? null })), songs: [], videos: [],
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
    // The studio's own routes stay through this rewrite too (lib/routes.mjs).
    writeFileSync(configPath(root), wranglerConfig({ worker: cf.worker, name: studio.name, d1: cf.d1, d1Id: next.cloudflare.d1Id, r2: bucket, layout: layoutOf(root), routes: keptRoutes(root, studio) }));
  }
  log(`created R2 ${bucket}`);
  return { ok: true, command: 'storage add', bucket, account: accountId, cost: R2_COST, next: ['npx --no-install homie-studio media move --dry-run   (which songs and videos go to R2: over 1 MiB, or left out of git)', 'npm run deploy   (binds the bucket as MEDIA, moves them, checks each by SHA-256, and serves them from R2 at the same addresses; the files stay in this folder)'] };
}

/** One Wrangler command, run without blocking (an upload of a music video takes a while); the last of its words kept. */
function wranglerRun(bin, args, { cwd, env }) {
  return new Promise((done) => {
    const p = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const keep = (d) => { out = `${out}${d}`.slice(-8000); };
    p.stdout.on('data', keep);
    p.stderr.on('data', keep);
    p.on('error', (e) => done({ code: 1, out: String(e.message) }));
    p.on('close', (code) => done({ code: code ?? 1, out: out.replace(ANSI, '') }));
  });
}

/** Read an object back from R2 (`wrangler r2 object get --pipe`) and hash it as it streams: nothing is written to disk. */
function hashRemote(bin, path, { cwd, env }) {
  return new Promise((done) => {
    const p = spawn(bin, ['r2', 'object', 'get', path, '--remote', '--pipe'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const h = createHash('sha256');
    let bytes = 0;
    let err = '';
    p.stdout.on('data', (d) => { h.update(d); bytes += d.length; });
    p.stderr.on('data', (d) => { err = `${err}${d}`.slice(-4000); });
    p.on('error', (e) => done({ code: 1, err: String(e.message) }));
    p.on('close', (code) => done({ code: code ?? 1, sha256: h.digest('hex'), bytes, err: err.replace(ANSI, '') }));
  });
}

/*
 * `homie-studio media move [<file>...] [--dry-run] [--verify]` (and every `deploy` of a studio with storage): the big
 * public files of the studio's published songs and videos go into its own R2, at the key that is their path, so the
 * site keeps serving them at the same address.
 *
 *   1. hash the file on this computer (SHA-256);
 *   2. `wrangler r2 object put <bucket>/<path>`;
 *   3. read it back (`wrangler r2 object get --pipe`) and hash what R2 returns;
 *   4. only when size and hash match, record `r2: { key, sha256, bytes, at }` on the manifest's file.
 *
 * The next deploy's build leaves a recorded file out of the site's static assets (and serves it from R2). The file
 * on this computer is never deleted, moved or changed. A file that fails any step is named, and stays on the site.
 * `--verify` reads every file already recorded back from R2 and checks its hash again (it changes nothing).
 */
export async function mediaMove(root, { paths = null, dryRun = false, verify = false, auto = false, accountId = null, log = () => {} } = {}) {
  const studio = readStudio(root);
  const cf = { created: [], ...studio.cloudflare };
  const bucket = cf.r2 && (cf.created ?? []).includes(`r2:${cf.r2}`) ? cf.r2 : null;
  const over = r2OverOf(studio);
  const named = Array.isArray(paths) && paths.length ? paths : null;
  const rows = mediaPlan(root, { over, paths: named });
  const view = (r) => ({ path: r.path, kind: r.kind, slug: r.slug, role: r.role, state: r.state, bytes: r.bytes ?? null, ...(r.reason ? { reason: r.reason } : {}), ...(r.why ? { why: r.why } : {}) });
  const held = rows.filter((r) => r.state === 'r2');
  const todo = rows.filter((r) => r.state === 'move');
  const inR2 = [...held, ...todo].reduce((n, r) => n + (r.bytes ?? 0), 0);
  const base = {
    command: 'media move', bucket, over, rows: rows.map(view), inR2, cost: R2_COST,
    // Over the free 10 GB-month, Cloudflare bills the account: say so with the number.
    ...(inR2 > 10e9 ? { warning: `R2 would hold ${sizeOf(inR2)} of this studio's media, over the 10 GB-month free tier: about US$${(((inR2 - 10e9) / 1e9) * 0.015).toFixed(2)} a month more, billed by Cloudflare to the account` } : {}),
  };
  if (!bucket) {
    return { ok: false, ...base, needs: 'storage', why: 'this studio has no storage yet, so its media stays on the site (files up to 25 MiB each). `npx --no-install homie-studio storage add` adds an R2 bucket; Cloudflare asks for a payment method on the account before R2 works, so ask the person first. Games never need it.' };
  }
  if (auto && over === null && !named) return { ok: true, ...base, off: true, moved: [], failed: [], why: 'studio.json media.r2Over is false: nothing moves on its own' };
  if (dryRun || (!todo.length && !verify)) return { ok: true, ...base, dryRun, moved: [], failed: [], next: todo.length ? 'npx --no-install homie-studio media move   (then npm run deploy)' : null };
  const bin = wranglerBin(root);
  if (!bin) return { ok: false, ...base, why: 'Wrangler is not installed in this studio yet: run `npm install` in the studio folder first' };
  const account = accountId || process.env.CLOUDFLARE_ACCOUNT_ID || cf.accountId || null;
  const opts = { cwd: workerDir(root), env: { ...process.env, ...projectsCloudflareEnv(root), ...(account ? { CLOUDFLARE_ACCOUNT_ID: account } : {}), WRANGLER_SEND_METRICS: 'false', CI: '1' } };
  const moved = [];
  const failed = [];
  const verified = [];
  if (verify) {
    for (const r of held) {
      const key = r.held?.key ?? r.path;
      const got = await hashRemote(bin, `${bucket}/${key}`, opts);
      const ok = got.code === 0 && got.sha256 === r.held?.sha256 && got.bytes === Number(r.held?.bytes);
      verified.push({ path: r.path, key, ok, bytes: got.bytes, ...(ok ? {} : { why: got.code !== 0 ? `could not read it back: ${got.err.trim().split('\n').slice(-2).join(' ')}` : 'R2 returned different bytes than were recorded' }) });
      log(`${ok ? 'verified' : 'MISMATCH'} ${r.path} in R2 ${bucket}/${key}`);
    }
  }
  for (const r of todo) {
    const key = r.path;
    const url = `/${key.split('/').map(encodeURIComponent).join('/')}`;
    const sha256 = sha256File(r.abs);
    log(`uploading ${r.path} (${sizeOf(r.bytes)}) to R2 ${bucket}/${key}`);
    const put = await wranglerRun(bin, ['r2', 'object', 'put', `${bucket}/${key}`, '--file', r.abs, '--content-type', r.type, '--remote'], opts);
    // Where the file is meanwhile: on the site when it fits; a bigger one keeps an older R2 copy, or waits.
    const meanwhile = r.bytes <= MAX_ASSET_BYTES ? ' It stays on the site.' : r.held ? ' Its page keeps playing the older copy in R2.' : ' At this size the site cannot carry it, so its page waits until it is in R2.';
    if (put.code !== 0) {
      failed.push({ path: r.path, bytes: r.bytes, why: `${explainCloudflare(put.out, account)?.why ?? `the upload failed: ${put.out.trim().split('\n').slice(-3).join(' ')}`}${meanwhile}` });
      continue;
    }
    const got = await hashRemote(bin, `${bucket}/${key}`, opts);
    if (got.code !== 0 || got.sha256 !== sha256 || got.bytes !== r.bytes) {
      failed.push({ path: r.path, bytes: r.bytes, why: `${got.code !== 0 ? `uploaded, but it could not be read back to check it (${got.err.trim().split('\n').slice(-2).join(' ')}); nothing recorded.` : `R2 returned ${got.bytes} bytes with a different SHA-256 from this file's ${r.bytes}; nothing recorded.`}${meanwhile}` });
      continue;
    }
    const at = new Date().toISOString();
    const manifests = recordMove(root, r.path, { key, sha256, bytes: r.bytes, at });
    moved.push({ path: r.path, key, bytes: r.bytes, sha256, url, manifests });
    log(`checked ${r.path} in R2 by SHA-256 (${sha256.slice(0, 12)}…); its address stays ${url}`);
  }
  const bad = verified.filter((v) => !v.ok);
  return {
    ok: !failed.length && !bad.length, ...base, moved, failed, ...(verify ? { verified } : {}),
    ...(moved.length ? { next: 'npm run deploy: the site stops carrying these files and serves them from R2 at the same addresses. The files stay in this folder; commit the manifests (they name each file\'s R2 copy), never the media.' } : {}),
  };
}
