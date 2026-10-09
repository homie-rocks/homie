/** Stripe owns browser authorization. This module owns only secret transport and a non-secret receipt.
 * See docs/stripe-connect-research.md: current CLI OAuth is NOT a Worker credential issuer. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runner } from './cloudflare.mjs';
import { lockDeploy } from './deploy-state.mjs';
import { readStudio, siteUrl } from './studio.mjs';
import { hookUrlOf, readShop, shopConnectManual } from './shop.mjs';
import { syncPaymentLinks } from './shop-links.mjs';
import { LINKS_STRIPE_VERSION, fullerReason } from '../worker/shop-links.mjs';
import { formEncode } from '../worker/stripe.mjs';

const hash = (s) => createHash('sha256').update(s).digest('hex');
const failure = (needs, why, extra = {}) => ({ ok: false, command: 'shop connect', needs, why, ...extra });
const receiptHome = () => join(homedir(), '.config', 'homie', 'stripe');
const receiptDir = (root, storage) => join(storage, hash(realpathSync(root)).slice(0, 24));

/** Local expiry evidence only; no account query and no credentials in the result. */
export function stripeConnectionInfo(root, { storage = receiptHome(), now = Date.now } = {}) {
  try {
    const r = JSON.parse(readFileSync(join(receiptDir(root, storage), 'test.json'), 'utf8'));
    if (r.url !== hookUrlOf(siteUrl(root)) || !Number.isFinite(Date.parse(r.expiresAt))) return null;
    return { mode: 'test', expiresAt: r.expiresAt, expired: Date.parse(r.expiresAt) <= now(), renew: 'homie-studio shop connect --renew' };
  } catch { return null; }
}

const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
// This output stays private, including CLI config, completion, errors and API responses.
export function stripeProcess(args, { cwd, env = process.env } = {}) {
  const childEnv = { ...env, CI: '1', NO_COLOR: '1' };
  for (const k of Object.keys(childEnv)) if (k.startsWith('STRIPE_')) delete childEnv[k];
  return new Promise((resolve) => {
    const p = spawn('stripe', args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', ended = false;
    const end = (r) => { if (!ended) { ended = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { p.kill(); end({ code: 1 }); }, 10 * 60_000);
    p.stdout.on('data', (b) => { stdout += b; if (stdout.length > 4_000_000) p.kill(); });
    p.stderr.on('data', (b) => { stderr += b; if (stderr.length > 1_000_000) p.kill(); });
    p.on('error', (e) => end({ code: 1, missing: e.code === 'ENOENT' }));
    p.on('close', (code) => end({ code: code ?? 1, stdout, stderr }));
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
  p.on('error', () => {}); p.unref();
}

const stripeURL = (s) => {
  try { const u = new URL(s); return u.protocol === 'https:' && ['dashboard.stripe.com', 'access.stripe.com'].includes(u.hostname) && !u.username && !u.password && !u.port; } catch { return false; }
};
/** Accept only Stripe's known login continuations. Never execute next_step as shell text. */
export function completionArgs(step) {
  if (step === 'stripe login --complete-device') return ['login', '--complete-device'];
  if (step === 'stripe login --complete-reauth') return ['login', '--complete-reauth'];
  const m = /^stripe login --complete[ =](?:'([^']+)'|"([^"]+)"|(\S+))$/.exec(step ?? '');
  const url = m && (m[1] || m[2] || m[3]);
  return stripeURL(url) ? ['login', '--complete', url] : null;
}

export async function shopConnect(root, options = {}) {
  if (options.manual) {
    const result = await shopConnectManual(root, options);
    if (result.ok) rmSync(join(receiptDir(root, options.storage ?? receiptHome()), 'test.json'), { force: true });
    return result;
  }
  const { live = false, renew = false, log = () => {}, exec = stripeProcess, open = openBrowser,
    storage = receiptHome(), wrangler = null } = options;
  const mode = live ? 'live' : 'test';
  const checked = readShop(root);
  if (!checked.ok || checked.absent) return failure('shop', 'Create and check shop.json first: homie-studio shop init, then shop check.');
  if (options.managed === true && checked.shop.till !== 'stripe-managed') return failure('shop-settings', 'For Managed Payments, set shop.json till to stripe-managed and deploy that choice before connecting. Stripe’s own eligibility and terms still apply.');
  const id = hash(realpathSync(root)).slice(0, 24);
  const profile = `homie-${id}`;
  const dir = join(storage, id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Reuse the toolkit’s process-aware lock, in the private receipt folder. Dead processes do not strand setup.
  const lock = lockDeploy(dir);
  if (!lock.ok) return failure('busy', 'Stripe connection is already running for this studio. Wait for that command to finish.');
  try {
    const cli = (args) => exec(['--project-name', profile, ...args], { cwd: root });
    const installed = await cli(['--version']);
    if (installed.code !== 0) return failure('stripe-cli', 'Install Stripe’s official CLI, then run shop connect again.', { next: ['npm install -g @stripe/cli@latest'] });

    // A read both checks existing credentials and lets Stripe refresh its OAuth session itself.
    let probe = renew ? { code: 1 } : await cli(['get', '/v1/products', '-d', 'limit=1', ...(live ? ['--live'] : [])]);
    if (probe.code !== 0 || !Array.isArray(json(probe.stdout)?.data)) {
      const start = await cli(['login', '--non-interactive', ...(renew ? ['--new-session'] : [])]);
      const login = json(start.stdout);
      const complete = completionArgs(login?.next_step);
      if (start.code !== 0 || !stripeURL(login?.browser_url) || !complete || !/^[a-zA-Z0-9 -]{1,100}$/.test(login?.verification_code ?? '')) {
        return failure('stripe-login', 'Stripe could not start browser approval. Update the official Stripe CLI and try shop connect again. An account administrator may need to enable CLI access in Stripe’s MCP and CLI access settings.');
      }
      log(`Approve your studio’s Stripe account in your browser. Pairing code: ${login.verification_code}. ${login.browser_url}`);
      open(login.browser_url);
      const finished = await cli(complete);
      if (finished.code !== 0) return failure('stripe-login', 'Stripe approval did not finish. Run shop connect again when ready.');

      probe = await cli(['get', '/v1/products', '-d', 'limit=1', ...(live ? ['--live'] : [])]);
      if (probe.code !== 0 || !Array.isArray(json(probe.stdout)?.data)) return failure('stripe-access', 'Stripe is signed in but cannot read Products in the requested mode. Review the account, sandbox and permissions in Stripe, then run shop connect --renew again.');
    }
    const site = siteUrl(root);
    if (!site) return failure('deploy', 'Stripe is connected on this computer. Deploy the studio with studio_deploy (Cloudflare approval first if needed), then run shop connect again.', { mode, connected: true });
    let target;
    try { target = new URL(site); } catch { return failure('deploy', 'Deploy the studio to a public HTTPS address, then run shop connect again.'); }
    if (target.protocol !== 'https:' || target.username || target.password || /^(localhost|127\.|\[::1\])/.test(target.hostname)) return failure('deploy', 'Deploy the studio to a public HTTPS address, then run shop connect again.');
    const api = async (method, path, params, idempotency) => {
      const args = [method.toLowerCase(), path, '--stripe-version', LINKS_STRIPE_VERSION, ...(live ? ['--live'] : []), ...(idempotency ? ['--idempotency', idempotency] : [])];
      for (const [k, v] of formEncode(params)) args.push('-d', `${k}=${v}`);
      const r = await cli(args);
      const body = json(r.stdout);
      if (r.code !== 0 || !body || body.error) throw new Error('Stripe API operation failed');
      return body;
    };
    const reason = fullerReason(checked.shop);
    if (reason) return failure('fuller-checkout', reason, { mode, connected: true });
    const studio = readStudio(root);
    const w = wrangler ?? runner(root, studio.cloudflare?.accountId ? { CLOUDFLARE_ACCOUNT_ID: studio.cloudflare.accountId } : {});
    const receiptFile = join(dir, `${mode}.json`);
    const receipt = existsSync(receiptFile) ? json(readFileSync(receiptFile, 'utf8')) : null;
    const result = await syncPaymentLinks({ api, shop: checked.shop, slug: studio.slug, site: target.origin, mode, w, receipt,
      saveReceipt: (record) => {
        writeFileSync(`${receiptFile}.tmp`, JSON.stringify(record), { mode: 0o600 });
        renameSync(`${receiptFile}.tmp`, receiptFile);
      } });
    return { ...result, profile };
  } catch {
    return failure('stripe-setup', 'Stripe setup could not finish. Check the studio’s Stripe session and Products, Prices, Payment Links and Webhook Endpoints write permissions, and the Cloudflare login, then run shop connect again. No credentials were printed.');
  } finally { lock.release(); }
}
