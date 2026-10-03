/**
 * `homie-studio setup --via stripe-projects [--with elevenlabs] [--accept-tos] [--dry-run]` (@homie-rocks/studio
 * 0.24.3, a PROTOTYPE): a creator with no Cloudflare account (and no ElevenLabs) gets both through Stripe Projects
 * (docs.stripe.com/projects), Stripe's CLI plugin that makes or links provider accounts and hands their credentials to
 * the project. Homie's own paths (`npx wrangler login`, an ElevenLabs sign-in) stay the default; this is an option.
 *
 * What it does, in order, and where it stops to hand a step to the person (`needs`):
 *   1. the Stripe CLI (1.40.0 or later) and its Projects plugin are here;
 *   2. this folder is a Stripe project, signed in to the PERSON'S OWN Stripe account (`stripe projects init` opens
 *      Stripe's sign-in in the browser: the person signs in, then this runs again);
 *   3. the catalog has Cloudflare's Workers service (and ElevenLabs' with --with elevenlabs);
 *   4. the person said yes to the provider's terms (only then --accept-tos is passed on); the services are added on
 *      their free plans: this never passes --confirm-paid-service, and stops if Stripe reports anything paid;
 *      an existing Cloudflare account is linked through Cloudflare's own approval page (`stripe projects link`);
 *      a Stripe email with no Cloudflare account gets a new one from Cloudflare;
 *   5. the credentials are where Projects put them (`stripe projects env --json` lists NAMES only): the account id
 *      goes into studio.json, the token stays in Projects' vault and its git-ignored output file, and studio.json says
 *      `cloudflare.auth: "stripe-projects"` so every Wrangler run here takes it from there (lib/projects-env.mjs);
 *   6. read-only checks with that token: Wrangler is signed in, D1 and Workers AI answer (R2 is optional and needs a
 *      payment method on Cloudflare, so it is only reported);
 *   7. .gitignore keeps `.env`, `.env.*`, `.projects/vault/` and `.projects/cache/` out of git.
 * Then `npm run deploy` works as always.
 *
 * Never: a value of any credential in output, a file of ours, an argument or a log (Projects' own rule too: names
 * only); a Stripe login that is not the person's; a paid plan; a payment method (the free plans need none).
 *
 * Unverified until a real run (the docs do not say): the exact JSON shapes of `status`, `search` and `env --json`
 * (read tolerantly here), the ElevenLabs service's slug and env name, and the Cloudflare token's permission groups
 * (step 6 measures what it can do instead of assuming).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runner } from './cloudflare.mjs';
import { envFileOf, readDotenv } from './projects-env.mjs';
import { readStudio, writeStudio } from './studio.mjs';

export const MIN_STRIPE_CLI = '1.40.0';
export const TERMS = Object.freeze({
  cloudflare: 'https://www.cloudflare.com/terms/',
  elevenlabs: 'https://elevenlabs.io/terms-of-use',
});
/** What .gitignore must hold before any credential lands in the folder. */
export const IGNORED = Object.freeze(['.env', '.env.*', '.projects/vault/', '.projects/cache/']);

function defaultExec(cmd, args, { cwd, env, timeout = 180_000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: env ?? process.env, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return { code: r.error.code === 'ENOENT' ? 127 : r.error.code === 'ETIMEDOUT' ? 124 : 1, stdout: '', stderr: String(r.error.message) };
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The first JSON value in a command's output (CLIs print a line or two before it), or null. */
export function jsonOf(text) {
  const t = String(text ?? '');
  let i = t.search(/[[{]/);
  while (i >= 0) {
    const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    for (const piece of [t.slice(i), end > i ? t.slice(i, end + 1) : null]) {
      if (piece === null) continue;
      try { return JSON.parse(piece); } catch { /* the next try */ }
    }
    const next = t.slice(i + 1).search(/[[{]/);
    i = next < 0 ? -1 : i + 1 + next;
  }
  return null;
}

/** Every string in a JSON value (keys too), for reading shapes the docs do not pin down. */
function stringsIn(value, out = [], depth = 0) {
  if (depth > 12 || value === null || value === undefined) return out;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out, depth + 1);
  else if (typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.push(k); stringsIn(v, out, depth + 1); }
  return out;
}

/** provider/service slugs named anywhere in a JSON answer ("cloudflare/workers"), and provider + service pairs. */
export function servicesIn(value) {
  const found = new Set();
  for (const s of stringsIn(value)) if (/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_:.-]*$/i.test(s)) found.add(s.toLowerCase());
  const walk = (v, depth = 0) => {
    if (depth > 12 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    const p = typeof v.provider === 'string' ? v.provider : typeof v.provider?.id === 'string' ? v.provider.id : null;
    const s = typeof v.service === 'string' ? v.service : typeof v.service?.id === 'string' ? v.service.id : null;
    if (p && s) found.add((s.includes('/') ? s : `${p}/${s}`).toLowerCase());
    Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(value);
  return [...found];
}

/** Environment variable NAMES in `stripe projects env --json` (values are never there, and never read from it). */
export function envNamesIn(value) {
  return [...new Set(stringsIn(value).filter((s) => /^[A-Z][A-Z0-9_]{2,}$/.test(s)))];
}

/** Whether an answer says something costs money: a price or amount above 0, or a plan named paid. */
export function paidIn(value) {
  let paid = false;
  const walk = (v, key = '', depth = 0) => {
    if (paid || depth > 12 || v === null || v === undefined) return;
    if (typeof v === 'number') { if (/price|amount|cost|monthly/i.test(key) && v > 0) paid = true; return; }
    if (typeof v === 'string') { if (/^(tier|plan|plan_id|tier_id)$/i.test(key) && /paid|\bpro\b|scale|business|enterprise/i.test(v) && !/free/i.test(v)) paid = true; return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, key, depth + 1)); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  walk(value);
  return paid;
}

const CODES = ['PROVIDER_NOT_LINKED', 'BROWSER_AUTH_REQUIRED', 'NOT_INITIALIZED', 'PROJECT_NOT_FOUND', 'TOS_NOT_ACCEPTED', 'PAYMENT_METHOD_REQUIRED', 'PAID_SERVICE_CONFIRMATION_REQUIRED'];
/** The error code a Projects command answered with (from its JSON or its words). */
export function codeOf(r) {
  const text = `${r?.stdout ?? ''}\n${r?.stderr ?? ''}`;
  const j = jsonOf(text);
  const failed = j && typeof j === 'object' && (j.error || j.ok === false || j.success === false || j.status === 'error');
  const fromJson = failed ? (j.error?.code ?? j.code ?? null) : null;
  if (typeof fromJson === 'string' && fromJson) return fromJson.toUpperCase();
  for (const c of CODES) if (text.includes(c)) return c;
  if (/not (?:been )?initiali[sz]ed|no project found|run `?stripe projects init/i.test(text)) return 'NOT_INITIALIZED';
  if (/log ?in|sign ?in|authenticat/i.test(text) && /browser/i.test(text)) return 'BROWSER_AUTH_REQUIRED';
  if (/terms of service|accept.*tos|--accept-tos/i.test(text)) return 'TOS_NOT_ACCEPTED';
  if (/paid|payment method/i.test(text) && /confirm|required/i.test(text)) return 'PAID_SERVICE_CONFIRMATION_REQUIRED';
  return r?.code === 0 ? null : 'UNKNOWN_ERROR';
}

const versionAtLeast = (v, min) => {
  const a = String(v).split('.').map(Number); const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) { if ((a[i] || 0) > b[i]) return true; if ((a[i] || 0) < b[i]) return false; }
  return true;
};

/** .gitignore holds every line in IGNORED (appended, with a comment, when one is missing). */
function ensureIgnored(root, { dryRun }) {
  const file = join(root, '.gitignore');
  const now = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const have = new Set(now.split(/\r?\n/).map((l) => l.trim()));
  const missing = IGNORED.filter((l) => !have.has(l) && !have.has(`/${l}`));
  if (missing.length && !dryRun) appendFileSync(file, `${now && !now.endsWith('\n') ? '\n' : ''}# Stripe Projects: credentials stay on this computer (its vault and the .env it syncs), never in git.\n${missing.join('\n')}\n`);
  return missing;
}

/**
 * The prototype's whole run. `exec(cmd, args, { cwd, env })` and `wrangler(args)` are replaceable (tests use
 * stand-ins that answer like the real CLIs' --json); `stripe` names the Stripe CLI.
 */
export async function setupViaProjects(root, {
  withElevenlabs = false, acceptTos = false, dryRun = false, log = () => {},
  exec = defaultExec, stripe = process.env.HOMIE_STRIPE_CLI || 'stripe', wrangler = null,
} = {}) {
  const steps = [];
  const step = (id, state, words) => { steps.push({ id, state, words }); log(`${state === 'ok' || state === 'done' ? '✓' : state === 'needs' ? '→' : '·'} ${words}`); };
  const stop = (id, needs, why, extra = {}) => ({ ok: false, command: 'setup', via: 'stripe-projects', dryRun, steps, needs: { id, ...needs }, why, ...extra });
  const run = (args) => exec(stripe, args, { cwd: root });

  // 1. The Stripe CLI and the Projects plugin.
  const v = run(['--version']);
  const version = /(\d+\.\d+\.\d+)/.exec(`${v.stdout} ${v.stderr}`)?.[1] ?? null;
  if (v.code === 127 || !version) {
    return stop('stripe-cli', { who: 'ai', run: 'npm install -g @stripe/cli@latest', say: 'Stripe\'s own CLI (or on a Mac: brew install stripe/stripe-cli/stripe); the person approves the install.' }, 'the Stripe CLI is not on this computer');
  }
  if (!versionAtLeast(version, MIN_STRIPE_CLI)) {
    return stop('stripe-cli', { who: 'ai', run: 'npm install -g @stripe/cli@latest', say: `Stripe Projects needs the Stripe CLI ${MIN_STRIPE_CLI} or later (this one is ${version}); on a Mac with Homebrew: brew upgrade stripe/stripe-cli/stripe.` }, `the Stripe CLI is ${version}; Projects needs ${MIN_STRIPE_CLI} or later`);
  }
  step('stripe-cli', 'ok', `the Stripe CLI ${version}`);
  const plugin = run(['projects', '--version']);
  if (plugin.code !== 0) return stop('projects-plugin', { who: 'ai', run: 'stripe plugin install projects', say: 'Stripe\'s Projects plugin for the CLI (no sign-in yet).' }, 'the Stripe Projects plugin is not installed');
  step('projects-plugin', 'ok', 'the Stripe Projects plugin');

  // 2. A project here, signed in to the person's own Stripe.
  const status = run(['projects', 'status', '--json']);
  const statusCode = codeOf(status);
  if (status.code !== 0 || (statusCode && statusCode !== 'UNKNOWN_ERROR')) {
    if (['NOT_INITIALIZED', 'PROJECT_NOT_FOUND', 'BROWSER_AUTH_REQUIRED', 'UNKNOWN_ERROR'].includes(statusCode ?? 'UNKNOWN_ERROR')) {
      return stop('projects-init', {
        who: 'ai', run: 'stripe projects init --yes',
        say: 'Stripe opens its sign-in in the browser: the person signs in to THEIR OWN Stripe account (a new free one is fine; never a work or client account that happens to be signed in here). Wait until they say it is done, then run this again.',
      }, statusCode === 'BROWSER_AUTH_REQUIRED' ? 'Stripe needs the person to sign in first' : 'this studio folder is not a Stripe project yet');
    }
  }
  const have = servicesIn(jsonOf(status.stdout));
  step('project', 'ok', 'this folder is a Stripe project');

  // 3. The catalog: Cloudflare's Workers service (and ElevenLabs').
  const find = (provider, prefer) => {
    const r = run(['projects', 'search', provider, '--json']);
    const j = jsonOf(r.stdout);
    if (r.code !== 0 || !j) return { slug: null, why: `stripe projects search ${provider} did not answer (${codeOf(r) ?? 'no JSON'})` };
    if (Number(j.result_count) === 0) return { slug: null, why: `${provider} is not in the Stripe Projects catalog` };
    const all = servicesIn(j).filter((s) => s.startsWith(`${provider}/`));
    const slug = prefer.map((p) => all.find((s) => p.test(s))).find(Boolean) ?? null;
    return slug ? { slug, all } : { slug: null, why: `the catalog has no ${provider} service this kit knows (${all.join(', ') || 'none listed'})` };
  };
  const wants = [['cloudflare', [/^cloudflare\/workers$/, /^cloudflare\/worker$/, /^cloudflare\/workers?[:/]/]]];
  if (withElevenlabs) wants.push(['elevenlabs', [/^elevenlabs\/(?:tts|api|key|audio|music)$/, /^elevenlabs\//]]);
  const slugs = {};
  for (const [provider, prefer] of wants) {
    const f = find(provider, prefer);
    if (!f.slug) return stop('not-in-catalog', { who: 'person', say: `Use Homie's usual way for ${provider === 'cloudflare' ? 'Cloudflare (npx wrangler login)' : 'ElevenLabs (elevenlabs auth login)'} instead.` }, f.why);
    slugs[provider] = f.slug;
    step(`catalog-${provider}`, 'ok', `${f.slug} is in the Stripe Projects catalog`);
  }

  // 4. The services, on their free plans, after the person said yes to the providers' terms.
  const missing = Object.entries(slugs).filter(([, slug]) => !have.includes(slug));
  if (missing.length && !acceptTos && !dryRun) {
    const names = missing.map(([p]) => (p === 'cloudflare' ? 'Cloudflare' : 'ElevenLabs'));
    return stop('accept-terms', {
      who: 'person',
      say: `Stripe Projects will make (or link) ${names.join(' and ')} for this studio on the free plan${names.length > 1 ? 's' : ''}, with no payment method. The person accepts ${missing.map(([p]) => `${p === 'cloudflare' ? 'Cloudflare' : 'ElevenLabs'}'s terms (${TERMS[p]})`).join(' and ')}. When they say yes, run this again with --accept-tos.${missing.some(([p]) => p === 'elevenlabs') ? ' ElevenLabs\' free plan has no commercial licence: songs made on it cannot be sold or monetised.' : ''}`,
    }, `the person has not accepted ${names.join(' and ')}'s terms yet`, { plan: missing.map(([, slug]) => `stripe projects add ${slug} --json --no-interactive --accept-tos`) });
  }
  for (const [provider, slug] of missing) {
    if (dryRun) { step(`add-${provider}`, 'skipped', `would run: stripe projects add ${slug} --json --no-interactive --accept-tos`); continue; }
    const add = run(['projects', 'add', slug, '--json', '--no-interactive', '--accept-tos']);
    const code = codeOf(add);
    if (code === 'PROVIDER_NOT_LINKED') {
      return stop(`link-${provider}`, {
        who: 'ai', run: `stripe projects link ${provider}`,
        say: provider === 'cloudflare'
          ? 'If the person\'s Stripe email already has a Cloudflare account, Cloudflare\'s own approval page opens: they approve once. If not, Cloudflare makes a free account for them. Then run this again.'
          : 'ElevenLabs\' own approval page may open: the person approves once. Then run this again.',
      }, `${provider} is not linked to this Stripe account yet`);
    }
    if (code === 'BROWSER_AUTH_REQUIRED') return stop('projects-init', { who: 'ai', run: 'stripe projects init --yes', say: 'Stripe needs the person to sign in again in the browser. Then run this again.' }, 'Stripe asked for a sign-in');
    if (code === 'PAID_SERVICE_CONFIRMATION_REQUIRED' || code === 'PAYMENT_METHOD_REQUIRED') {
      return stop('paid', { who: 'person', say: `Stripe says ${slug} would cost money here. This kit adds only free plans: nothing was added. Use Homie's usual way (npx wrangler login) instead, or decide about a paid plan yourself in Stripe Projects.` }, `${slug} is not free here`);
    }
    if (add.code !== 0) return stop('projects-error', { who: 'ai', run: `stripe projects add ${slug} --json --no-interactive --accept-tos --debug`, say: 'Show the person Stripe\'s error as it is (names of variables only, never values).' }, `stripe projects add ${slug} failed (${code ?? 'no code'})`);
    if (paidIn(jsonOf(add.stdout))) {
      return stop('paid', { who: 'person', say: `Stripe reported a price for ${slug}. Check it with stripe projects status, and downgrade it to the free plan (stripe projects downgrade ${slug}) or remove it, before anything else.` }, `Stripe reported a paid plan for ${slug}`);
    }
    step(`add-${provider}`, 'done', `${slug} added on its free plan`);
  }
  for (const [provider, slug] of Object.entries(slugs)) if (have.includes(slug)) step(`add-${provider}`, 'ok', `${slug} was already in this project`);

  // 5. The credentials: names from Projects, values only from its output file, only into Wrangler's environment.
  const envList = run(['projects', 'env', '--json']);
  const names = envNamesIn(jsonOf(envList.stdout));
  const shown = run(['projects', 'env', 'show', '--json']);
  const outName = (() => {
    const j = jsonOf(shown.stdout);
    const pick = (o) => (o && typeof o === 'object' ? (o.output ?? o.output_file ?? o.outputFile ?? o.environment?.output ?? null) : null);
    const o = pick(j) ?? (Array.isArray(j) ? j.map(pick).find(Boolean) : null);
    return typeof o === 'string' && o ? o : '.env';
  })();
  const outFile = envFileOf(root, outName);
  if (!outFile) return stop('env-file', { who: 'ai', say: 'Set the Projects environment\'s output file inside the studio (stripe projects env update --output .env).' }, `the Projects output file (${outName}) is outside the studio`);
  const missingIgnores = ensureIgnored(root, { dryRun });
  if (missingIgnores.length) step('gitignore', dryRun ? 'skipped' : 'done', `${dryRun ? 'would add' : 'added'} ${missingIgnores.join(', ')} to .gitignore`);
  else step('gitignore', 'ok', '.gitignore keeps the credentials out of git');
  if (dryRun) {
    return { ok: true, command: 'setup', via: 'stripe-projects', dryRun: true, steps, services: slugs, envNames: names, envFile: outName, next: ['Run it without --dry-run (after the person accepted the terms: --accept-tos).'] };
  }
  if (!names.includes('CLOUDFLARE_API_TOKEN') || !names.includes('CLOUDFLARE_ACCOUNT_ID')) {
    const pull = run(['projects', 'env', '--pull']);
    if (pull.code !== 0) return stop('credentials', { who: 'ai', run: 'stripe projects env --pull', say: 'Projects did not sync the credentials; show its error (names only).' }, 'Stripe Projects listed no CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID');
  }
  const vars = readDotenv(outFile);
  if (!vars.CLOUDFLARE_API_TOKEN || !vars.CLOUDFLARE_ACCOUNT_ID) {
    return stop('credentials', { who: 'ai', run: 'stripe projects env --pull', say: `Projects has not written CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to ${outName} yet: pull them, then run this again.` }, `no Cloudflare credentials in ${outName}`);
  }
  if (!/^[a-f0-9]{32}$/i.test(vars.CLOUDFLARE_ACCOUNT_ID)) return stop('credentials', { who: 'ai', say: 'The account id Projects wrote does not look like a Cloudflare account id; check stripe projects status.' }, 'CLOUDFLARE_ACCOUNT_ID is not a Cloudflare account id');
  const studio = readStudio(root);
  const before = studio.cloudflare?.accountId;
  if (before && before !== vars.CLOUDFLARE_ACCOUNT_ID && (studio.cloudflare?.created ?? []).length) {
    return stop('other-account', { who: 'person', say: 'This studio already lives on another Cloudflare account. Keep that one (npx wrangler login), or move the studio deliberately; nothing was changed.' }, 'studio.json names another Cloudflare account that this studio already deployed to');
  }
  const eleven = withElevenlabs ? names.find((n) => /ELEVEN/.test(n) && /KEY/.test(n)) ?? (Object.keys(vars).find((n) => /ELEVEN/.test(n) && /KEY/.test(n)) ?? null) : null;
  writeStudio(root, {
    ...studio,
    cloudflare: { ...studio.cloudflare, accountId: vars.CLOUDFLARE_ACCOUNT_ID, auth: 'stripe-projects', envFile: outName },
    ...(withElevenlabs && eleven ? { providers: { ...(studio.providers ?? {}), elevenlabs: { via: 'stripe-projects', envKey: eleven, envFile: outName } } } : {}),
  });
  step('studio.json', 'done', `studio.json: the Cloudflare account Projects gave (its id, not a secret), and "auth": "stripe-projects" (the token stays in ${outName} and Projects' vault)${eleven ? `; ElevenLabs' key is ${eleven} there` : ''}`);

  // 6. What the token can do, read-only.
  const w = wrangler ?? ((args) => runner(root, {})(args));
  const checks = {};
  try {
    const who = w(['whoami', '--json']);
    let signed = false;
    try { signed = Boolean(jsonOf(who.stdout ?? who.out)?.loggedIn); } catch { signed = false; }
    checks.signedIn = who.code === 0 && signed;
    checks.d1 = w(['d1', 'list', '--json']).code === 0;
    checks.workersAi = w(['ai', 'models', '--json']).code === 0;
    checks.r2 = w(['r2', 'bucket', 'list']).code === 0;
  } catch (error) {
    checks.error = String(error?.message ?? error).slice(0, 200);
  }
  const short = [checks.signedIn === false ? 'Wrangler does not accept the token' : null, checks.d1 === false ? 'D1 (the studio\'s database)' : null].filter(Boolean);
  step('checks', checks.error ? 'skipped' : short.length ? 'needs' : 'ok', checks.error ? `not checked (${checks.error})` : `Wrangler with the Projects token: signed in ${checks.signedIn ? 'yes' : 'no'}, D1 ${checks.d1 ? 'yes' : 'no'}, Workers AI ${checks.workersAi ? 'yes' : 'no'}, R2 ${checks.r2 ? 'yes' : 'no (optional: storage asks Cloudflare for a payment method)'}`);
  if (short.length) {
    return stop('token-scope', { who: 'ai', run: 'stripe projects search cloudflare --json', say: `The token Projects gave cannot do: ${short.join(', ')}. Add the missing Cloudflare service through Projects (search the catalog: stripe projects search cloudflare --json), or use npx wrangler login instead.` }, `the Cloudflare token cannot do: ${short.join(', ')}`, { checks });
  }
  return {
    ok: true, command: 'setup', via: 'stripe-projects', steps, services: slugs, checks, envFile: outName,
    wrote: ['studio.json', ...(missingIgnores.length ? ['.gitignore'] : [])],
    ...(eleven ? { elevenlabs: { envKey: eleven, note: 'ElevenLabs\' free plan has no commercial licence: the music skill says the plan before every render.' } } : {}),
    next: ['Commit studio.json and .gitignore (never .env or .projects/vault/).', 'npm run deploy   (Wrangler deploys with the Projects token; no wrangler login needed)'],
  };
}

export function projectsLines(r) {
  const lines = [];
  for (const s of r.steps ?? []) lines.push(`  ${s.state === 'ok' || s.state === 'done' ? '✓' : s.state === 'needs' ? '→' : '·'} ${s.words}`);
  if (r.ok === false && r.needs) lines.push(`Next (${r.needs.who === 'person' ? 'the person' : 'your AI'}): ${r.needs.run ? `${r.needs.run}  ` : ''}${r.needs.say}`);
  for (const n of r.next ?? []) lines.push(n);
  return lines;
}
