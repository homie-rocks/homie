/**
 * `homie-studio doctor`'s Workers AI row: when a server's AI guides think with Workers AI (brain `workers-ai`), is the
 * model they use (wrangler.jsonc var HOMIE_BRAIN_MODEL, else worker/brain.mjs DEFAULT_MODEL) one this studio's
 * Cloudflare account can run? Cloudflare moves models to the Workers Paid plan from time to time (three on 2026-07-28,
 * error 5035) and retires others (5007); either way the guides fall back to the game's script without a word, so the
 * doctor asks once.
 *
 * The check is ONE tiny call to the model through Cloudflare's REST API (`POST /accounts/:id/ai/run/:model`, a
 * one-word prompt, max_tokens 1: about 0.1 of the 10,000 free neurons a day), with the studio's own Wrangler login
 * (`wrangler auth token`, held in this process only) or CLOUDFLARE_API_TOKEN. It never prints the token, the account's
 * id or its name. A call that cannot be made (not signed in, several accounts and none named) says so and spends
 * nothing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MODEL } from '../worker/brain.mjs';
import { configPath, workerDir } from './studio.mjs';

const MODELS = 'https://developers.cloudflare.com/workers-ai/models/';
/** A Workers AI model id: @cf/<maker>/<model> (or @hf/…); nothing that could leave the API path. */
export const MODEL_ID = /^@[a-z0-9-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/;

const parseJson = (text) => { const s = String(text ?? ''); const i = s.search(/[[{]/); if (i < 0) return null; try { return JSON.parse(s.slice(i)); } catch { return null; } };

/** The model the studio's guides think with: wrangler.jsonc "vars".HOMIE_BRAIN_MODEL, else the toolkit's default. */
export function brainModelOf(root) {
  try {
    const json = JSON.parse(readFileSync(configPath(root), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
    const v = json?.vars?.HOMIE_BRAIN_MODEL;
    if (typeof v === 'string' && v.trim()) return { model: v.trim(), set: true };
  } catch { /* no config: the default */ }
  return { model: DEFAULT_MODEL, set: false };
}

/**
 * Whether any open server of the studio's games thinks with Workers AI: a game.json seed in the built catalogue, or a
 * row in the live database (one read-only `wrangler d1 execute --remote`). A database without the servers table, or
 * one that cannot be read, says no.
 */
export async function usesWorkersAi(root, { exec, env = process.env, accountId = null, bin } = {}) {
  try {
    const cat = JSON.parse(readFileSync(join(root, 'site', 'dist', 'games.json'), 'utf8'));
    if ((cat.games ?? []).some((g) => (g.servers ?? []).some((s) => s.brain === 'workers-ai'))) return true;
  } catch { /* not built */ }
  if (!bin || !existsSync(bin)) return false;
  let db = 'DB';
  try { db = JSON.parse(readFileSync(configPath(root), 'utf8').replace(/^\s*\/\/.*$/gm, ''))?.d1_databases?.[0]?.binding ?? 'DB'; } catch { /* the default binding */ }
  const r = await exec(bin, ['d1', 'execute', db, '--remote', '--json', '--command', "SELECT COUNT(*) AS n FROM servers WHERE brain = 'workers-ai' AND state = 'open'"], {
    cwd: workerDir(root), timeout: 25_000, env: { ...env, WRANGLER_SEND_METRICS: 'false', CI: '1', ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}) },
  });
  if (r.code !== 0) return false;
  const parsed = parseJson(r.stdout);
  return Number((Array.isArray(parsed) ? parsed[0] : parsed)?.results?.[0]?.n) > 0;
}

/** How to call Cloudflare's API as this computer's Wrangler login: headers, or null. Never printed. */
export async function cloudflareAuth({ exec, env = process.env, bin, cwd } = {}) {
  if (env.CLOUDFLARE_API_TOKEN) return { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
  if (env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_EMAIL) return { 'x-auth-key': env.CLOUDFLARE_API_KEY, 'x-auth-email': env.CLOUDFLARE_EMAIL };
  if (!bin || !existsSync(bin)) return null;
  const r = await exec(bin, ['auth', 'token', '--json'], { cwd, timeout: 15_000, env: { ...env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  if (r.code !== 0) return null;
  const j = parseJson(r.stdout);
  if (typeof j?.token === 'string' && j.token) return { authorization: `Bearer ${j.token}` };
  if (typeof j?.key === 'string' && typeof j?.email === 'string') return { 'x-auth-key': j.key, 'x-auth-email': j.email };
  return null;
}

/**
 * What Cloudflare's answer to the probe means (its errors: developers.cloudflare.com/workers-ai/platform/errors/):
 * `{ why, state }` with why one of ok, paid-only, missing, not-allowed, agreement, allowance, busy, auth, other.
 */
export function classifyProbe(status, body) {
  const errs = Array.isArray(body?.errors) ? body.errors : [];
  const codes = errs.map((e) => Number(e?.code)).filter(Number.isFinite);
  const msg = errs.map((e) => String(e?.message ?? '')).filter(Boolean).join('; ');
  const has = (c) => codes.includes(c);
  if (status >= 200 && status < 300 && body?.success !== false) return { why: 'ok', state: 'ok', msg };
  if (has(5035) || (status === 403 && /workers paid|paid plan|upgrade/i.test(msg))) return { why: 'paid-only', state: 'act', msg };
  if (has(5007) || /no such model/i.test(msg) || status === 404) return { why: 'missing', state: 'act', msg };
  if (has(5018)) return { why: 'not-allowed', state: 'act', msg };
  if (has(5016) || /agree/i.test(msg)) return { why: 'agreement', state: 'act', msg };
  if (has(3036) || (status === 429 && /free allocation|neurons/i.test(msg))) return { why: 'allowance', state: 'later', msg };
  if (has(3040) || status === 429 || status >= 500) return { why: 'busy', state: 'unknown', msg };
  if (status === 401 || has(10000) || has(10001) || (status === 403 && /auth/i.test(msg))) return { why: 'auth', state: 'unknown', msg };
  if (status === 400) return { why: 'input', state: 'act', msg };
  return { why: 'other', state: 'unknown', msg };
}

/**
 * The one call. `{ status, body }`, or `{ error }` when the network failed. `fetchFn` stands in for the network in
 * tests; the call is a one-word prompt with max_tokens 1.
 */
export async function probeModel({ model, accountId, headers, fetchFn = globalThis.fetch, base = 'https://api.cloudflare.com/client/v4', ms = 12_000 }) {
  try {
    const res = await fetchFn(`${String(base).replace(/\/+$/, '')}/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'homie-studio-doctor' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(ms),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (error) {
    return { error: String(error?.name === 'TimeoutError' ? `no answer in ${Math.round(ms / 1000)} s` : error?.message ?? error) };
  }
}

/**
 * The doctor's row, or null when no server thinks with Workers AI. `who`: the doctor's Wrangler answer
 * (`signedIn`, `accountIds`); `bin`: the studio's own Wrangler; `remote`: the studio is live, so its database may be
 * read; `exec`, `fetchFn` replaceable for tests.
 */
export async function workersAiRow({ root, studio, env = process.env, exec, fetchFn = globalThis.fetch, who = {}, bin, remote = false, cli = 'npx --no-install homie-studio' }) {
  if (!root) return null;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || studio?.cloudflare?.accountId || (who.accountIds?.length === 1 ? who.accountIds[0] : null);
  if (!(await usesWorkersAi(root, { exec, env, accountId, bin: remote ? bin : null }))) return null;
  const { model, set } = brainModelOf(root);
  const row = {
    id: 'workers-ai', label: 'Workers AI', need: 'for AI guides', model,
    unlocks: 'AI guides that think and talk on servers whose brain is workers-ai, on the studio\'s own Workers AI (free: 10,000 neurons a day for the account)',
  };
  const where = set ? 'HOMIE_BRAIN_MODEL in wrangler.jsonc' : 'the toolkit\'s default';
  const pick = (lead) => ({
    who: 'ai', open: MODELS,
    say: `${lead}Pick a model the account can run: set HOMIE_BRAIN_MODEL in wrangler.jsonc "vars" to a text-generation model from ${MODELS} that is not marked Workers Paid${set && model !== DEFAULT_MODEL ? ` (or remove it for the default, ${DEFAULT_MODEL})` : ''}, run \`${cli} doctor\` again, then \`npm run deploy\`. Until then the guides answer from the game's script.`,
  });
  const money = ' Moving the account to Workers Paid ($5 a month) also works, but that is the person\'s money: ask them, never decide it.';
  if (!MODEL_ID.test(model)) return { ...row, state: 'act', detail: `${where} is "${model.slice(0, 80)}", which is not a Workers AI model id (@cf/<maker>/<model>)`, fix: pick('') };
  if (who.signedIn === false && !env.CLOUDFLARE_API_TOKEN) return { ...row, state: 'later', detail: `${model} (${where}): checked once Wrangler is signed in`, fix: null };
  if (!accountId) return { ...row, state: 'unknown', detail: `${model}: this login reaches several Cloudflare accounts and studio.json does not say which is the studio's (cloudflare.accountId, written at the first deploy)`, fix: null };
  const headers = await cloudflareAuth({ exec, env, bin, cwd: workerDir(root) });
  if (!headers) return { ...row, state: 'unknown', detail: `${model}: could not ask Cloudflare (no sign-in to call its API with)`, fix: { who: 'ai', run: 'npx wrangler login', say: 'Sign in to Cloudflare again (you approve once in the browser), then run doctor again.' } };
  const answer = await probeModel({ model, accountId, headers, fetchFn, base: env.CLOUDFLARE_API_BASE_URL || undefined });
  // Cloudflare's own words, without the account's id, and short.
  const plain = (s) => String(s ?? '').split(accountId).join('<account>').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (answer.error) return { ...row, state: 'unknown', detail: `${model}: this computer's request to Cloudflare failed (${plain(answer.error)}); run doctor again`, fix: null };
  const c = classifyProbe(answer.status, answer.body);
  const said = c.msg ? ` (Cloudflare: "${plain(c.msg)}")` : '';
  switch (c.why) {
    case 'ok': return { ...row, state: 'ok', detail: `${model} answers on this studio's Cloudflare account (${where}; one tiny call just now)`, fix: null };
    case 'paid-only': {
      const fix = pick(model === DEFAULT_MODEL ? 'The toolkit\'s default model is paid-only now. ' : '');
      return { ...row, state: 'act', detail: `${model} needs the Workers Paid plan, and this account is on Workers Free: every guide on a workers-ai server answers from the game's script${said}`, fix: { ...fix, say: fix.say + money } };
    }
    case 'missing': return { ...row, state: 'act', detail: `Cloudflare has no model ${model} (renamed or retired)${said}`, fix: pick('') };
    case 'not-allowed': return { ...row, state: 'act', detail: `this account may not use ${model} (a private model)${said}`, fix: pick('') };
    case 'agreement': return { ...row, state: 'act', detail: `${model} asks for its maker's licence to be agreed once before it is used${said}`, fix: pick('Agreeing to a licence is the person\'s to do, never yours; or simply: ') };
    case 'input': return { ...row, state: 'act', detail: `${model} did not take a chat message: the guides need a text-generation model${said}`, fix: pick('') };
    case 'allowance': return { ...row, state: 'later', detail: `today's free Workers AI allowance (10,000 neurons for the account) is used up, so ${model} could not be checked; the guides answer from the script until 00:00 UTC`, fix: { who: 'person', say: `Nothing to do now: run doctor again after 00:00 UTC. The studio's daily budget (\`${cli} agents brain <game> <server> workers-ai --budget <neurons>\`) keeps the guides under the allowance.` } };
    case 'busy': return { ...row, state: 'unknown', detail: `Workers AI was busy just now (status ${answer.status})${said}; run doctor again in a minute`, fix: null };
    case 'auth': return { ...row, state: 'unknown', detail: `Cloudflare did not let this sign-in run Workers AI (status ${answer.status})${said}`, fix: { who: 'ai', run: 'npx wrangler login', say: 'Sign in to Cloudflare again (the login includes Workers AI), then run doctor again.' } };
    default: return { ...row, state: 'unknown', detail: `${model}: Cloudflare answered ${answer.status}${said}`, fix: null };
  }
}
