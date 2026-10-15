import { ownerStripeApi, installStripeWebhook } from './stripe-webhook.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runner } from './cloudflare.mjs';
import { lockDeploy } from './deploy-state.mjs';
import { readStudio, siteUrl } from './studio.mjs';
import { hookUrlOf, readShop } from './shop.mjs';
import { needsStripeMigration, finishStripeMigration, drainStripeLinks } from './stripe-migration.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const failure = (needs, why) => ({ ok: false, command: 'shop connect', needs, why });
const receiptHome = () => join(homedir(), '.config', 'homie', 'stripe');
const receiptDir = (root, storage) => join(storage, hash(realpathSync(root)).slice(0, 24));
export function stripeConnectionInfo(root, { storage = receiptHome(), mode = 'test' } = {}) {
  try {
    const receipt = JSON.parse(readFileSync(join(receiptDir(root, storage), mode + '.json'), 'utf8'));
    if (receipt.url !== hookUrlOf(siteUrl(root))) return null;
    return { mode, connectedAt: receipt.connectedAt, renew: 'homie-studio shop connect --renew' };
  } catch { return null; }
}
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
// This output stays private, including CLI config, completion, errors and API responses.
export function stripeProcess(args, { cwd, env = process.env, command = 'stripe' } = {}) {
  const childEnv = { ...env, CI: '1', NO_COLOR: '1' };
  for (const k of Object.keys(childEnv)) if (k.startsWith('STRIPE_')) delete childEnv[k];
  return new Promise((resolve) => {
    const p = spawn(command, args, { cwd, env: childEnv, shell: process.platform==='win32' && command==='npm.cmd', stdio: ['ignore', 'pipe', 'pipe'] });
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
  try { const u = new URL(s); return u.protocol === 'https:' && ['dashboard.stripe.com', 'access.stripe.com', 'marketplace.stripe.com'].includes(u.hostname) && !u.username && !u.password && !u.port; } catch { return false; }
};
/** Accept only Stripe's known login continuations. Never execute next_step as shell text. */
export function completionArgs(step) {
  if (step === 'stripe login --complete-device') return ['login', '--complete-device'];
  if (step === 'stripe login --complete-reauth') return ['login', '--complete-reauth'];
  const m = /^stripe login --complete[ =](?:'([^']+)'|"([^"]+)"|(\S+))$/.exec(step ?? '');
  const url = m && (m[1] || m[2] || m[3]);
  return stripeURL(url) ? ['login', '--complete', url] : null;
}

/** Clipboard subprocess output is private and bounded. Never pass it to a logger. */
export function clipboardAccess(platform = process.platform) {
  const command = platform === 'darwin' ? ['pbpaste', [], 'pbcopy', []]
    : platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], 'powershell.exe', ['-NoProfile', '-Command', '$input | Set-Clipboard']]
    : process.env.WAYLAND_DISPLAY ? ['wl-paste', ['--no-newline'], 'wl-copy', []] : ['xclip', ['-selection', 'clipboard', '-o'], 'xclip', ['-selection', 'clipboard']];
  const run = (cmd, args, input) => {
    const result = spawnSync(cmd, args, { input, encoding: 'utf8', timeout: 2000, maxBuffer: 16384, stdio: ['pipe','pipe','pipe'] });
    if (result.status !== 0) throw new Error('Clipboard unavailable');
    return result.stdout.trim();
  };
  return { read: () => run(command[0], command[1]), clear: () => run(command[2], command[3], '') };
}
export async function captureRestrictedKey({ clipboard, mode, open, url, wait, timeout, now = Date.now }) {
  const initial = await clipboard.read();
  open(url);
  const deadline = now() + timeout;
  while (now() < deadline) {
    const value = await clipboard.read();
    if (value !== initial && /^rk_(test|live)_[A-Za-z0-9]+$/.test(value)) {
      if (!value.startsWith('rk_' + mode + '_')) throw new Error('Wrong Stripe mode');
      return value;
    }
    await wait(500);
  }
  throw new Error('Clipboard timeout');
}
/** Reads prove authentication and resource read access, not write grants or exact scope.
 * The App manifest is the scope contract; actual writes still fail closed at Stripe. */
export async function validateRestrictedKey(key, mode, fetcher = fetch) {
  if (!new RegExp('^rk_' + mode + '_[A-Za-z0-9]+$').test(key)) throw new Error('Wrong key mode');
  const call = async path => {
    const response = await fetcher('https://api.stripe.com' + path, {
      headers: { authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Stripe validation failed');
    return response.json();
  };
  const account = await call('/v1/account');
  if (!/^acct_[A-Za-z0-9]+$/.test(account.id)) throw new Error('Account unavailable');
  for (const resource of ['checkout/sessions','payment_intents','charges','subscriptions','billing_portal/configurations','disputes','invoices','products','prices']) {
    const page = await call('/v1/' + resource + '?limit=1');
    if (!Array.isArray(page.data) || page.data.some(item => typeof item.livemode === 'boolean' && item.livemode !== (mode === 'live'))) throw new Error('Stripe validation failed');
  }
  const name = account.business_profile?.name || account.settings?.dashboard?.display_name || account.id;
  return { id: account.id, name: String(name).replace(/[\r\n\x00-\x1f]/g, ' ').replace(/(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/g, '[redacted]').slice(0, 120) };
}
const fallback = mode => failure('private-terminal', 'Clipboard capture could not finish. In your own terminal, from the studio site directory, run npx wrangler secret put STRIPE_KEY and paste only into its hidden prompt. Never paste a key into chat. Then run homie-studio shop connect --finish' + (mode === 'live' ? ' --live' : '') + '.');

export async function shopConnect(root, options = {}) {
  const { live = false, log = () => {}, open = openBrowser, fetcher = fetch, storage = receiptHome(),
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeout = 10 * 60_000 } = options;
  const mode = live ? 'live' : 'test';
  if (!readShop(root).ok || readShop(root).absent) return failure('shop', 'Create and check shop.json first.');
  let site;
  try { site = new URL(siteUrl(root)); } catch { return failure('deploy', 'Deploy the studio to its HTTPS address first.'); }
  if (site.protocol !== 'https:' || site.username || site.password || site.port) return failure('deploy', 'The studio needs a public HTTPS address.');
  const dir = receiptDir(root, storage);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = lockDeploy(dir);
  if (!lock.ok) return failure('busy', 'Stripe setup is already running for this studio.');
  let clipboard, captured, stage = 'webhook';
  try {
    for(const mode of ['test','live'])for(const suffix of ['-pending.json','-pending.json.tmp'])rmSync(join(dir,mode+suffix),{force:true});
    const studio = readStudio(root);
    const receiptFile = join(dir, mode + '.json');
    const prior = existsSync(receiptFile) ? json(readFileSync(receiptFile, 'utf8')) : null;
    const migration = needsStripeMigration(root, prior, mode);
    const w = options.wrangler ?? runner(root, studio.cloudflare?.accountId ? { CLOUDFLARE_ACCOUNT_ID: studio.cloudflare.accountId } : {});
    const pendingFile = join(dir, mode + '-rak.json');
    let pending = existsSync(pendingFile) ? json(readFileSync(pendingFile, 'utf8')) : null;
    if (pending?.origin !== site.origin) pending = null;
    const save = () => { writeFileSync(pendingFile + '.tmp', JSON.stringify(pending), { mode: 0o600 }); renameSync(pendingFile + '.tmp', pendingFile); };
    const hookFile = join(dir, mode + '-webhook.json');
    const legacyFile = join(root,'.studio','stripe-mcp.json');
    const legacyAccount = existsSync(legacyFile) ? json(readFileSync(legacyFile,'utf8'))?.options?.account : null;
    const hookReceipt = existsSync(hookFile) ? json(readFileSync(hookFile,'utf8')) : prior;
    const profile = options.profile ?? pending?.profile ?? hookReceipt?.profile ?? prior?.profile ?? 'homie-' + hash(realpathSync(root)).slice(0,24);
    const owner = await ownerStripeApi({root, profile, mode, account:pending?.account ?? prior?.account ?? hookReceipt?.account ?? legacyAccount,
      process:options.stripeProcess ?? stripeProcess, open, log, onEvent:options.onEvent, installExec:options.installExec});
    const hook = await installStripeWebhook({ ...owner, origin:site.origin, mode, w, receipt:hookReceipt ?? {}, save:value=>{
      writeFileSync(hookFile+'.tmp',JSON.stringify({...value,profile}),{mode:0o600});renameSync(hookFile+'.tmp',hookFile);
    }});
    stage = 'key';
    if (!options.finish && !pending && (!prior || prior.keyless || options.renew)) {
      const url = options.installUrl ?? process.env.HOMIE_STRIPE_INSTALL_URL;
      if (!stripeURL(url)) return failure('app-install-link', 'Configure the uploaded Homie App’s External test link as HOMIE_STRIPE_INSTALL_URL, then resume shop connect.');
      clipboard = options.clipboard ?? clipboardAccess();
      log(options.renew ? 'On the Homie App settings page, choose View API keys → Roll key → Copy.' : 'Install Homie in your chosen Stripe account. Choose View API keys → Generate new key (sandbox: Reveal key) → Copy.');
      options.onEvent?.({ type: 'stripe.approval', message: 'Install Homie, generate the restricted key, then Copy. Do not paste it into chat.' });
      try { captured = await captureRestrictedKey({ clipboard, mode, open, url, wait, timeout, now: options.now }); }
      catch { return fallback(mode); }
      const account = await validateRestrictedKey(captured, mode, fetcher);
      if (account.id !== owner.account) return failure('account-mismatch', 'Select the previously connected Stripe account.');
      pending = { profile, origin: site.origin, account: account.id, name: account.name, nonce: randomBytes(32).toString('hex'), mode };
      // Never include subprocess output in tool output, including errors.
      if ((await w(['secret', 'put', 'STRIPE_KEY'], { input: captured })).code !== 0) return failure('cloudflare', 'Cloudflare could not install the connection. Retry shop connect.');
      save();
      if (await clipboard.read() === captured) await clipboard.clear();
      captured = null;
    } else {
      // A private-terminal fallback does not expose the installed key to the tool.
      pending ??= { profile, origin: site.origin, account: owner.account, nonce: randomBytes(32).toString('hex'), mode };
      save();
    }
    if ((await w(['secret', 'put', 'STRIPE_SETUP_CHALLENGE'], { input: hash(pending.nonce) })).code !== 0) throw new Error('Setup challenge failed');
    if (migration && !pending.deployed) {
      const deployStudio = options.deploy ?? (root => import('./cloudflare.mjs').then(m => m.deploy(root)));
      if (!(await deployStudio(root)).ok) return failure('migration', 'Checkout deployment failed; run shop connect --finish to resume.');
      pending.deployed = true; save();
    }
    const response = await fetcher(site.origin + '/api/shop/stripe-setup', {
      method: 'POST', headers: { authorization: 'Bearer ' + pending.nonce, 'content-type': 'application/json' },
      body: JSON.stringify({ mode, account: pending.account }), redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (response.status === 401) { rmSync(pendingFile,{force:true}); return failure('reconnect','The app key has expired or been revoked. Run shop connect --renew; the webhook approval will be reused.'); }
    if (!response.ok) throw new Error('Stripe setup failed');
    const installed = await response.json();
    if (!installed.ok || !/^acct_[A-Za-z0-9]+$/.test(installed.account)) throw new Error('Invalid setup');
    if (pending.account && pending.account !== installed.account) throw new Error('Wrong account');
    if (migration) {
      await drainStripeLinks({ root, origin: site.origin, account: installed.account, mode, w, database: studio.cloudflare.d1,
        keepHook: hook.webhookId, process: options.stripeProcess ?? stripeProcess, wait, profile });
      const listed = await w(['secret', 'list']);
      const names = json(listed.stdout ?? listed.out);
      if (listed.code !== 0 || !Array.isArray(names)) throw new Error('Secret list failed');
      for (const name of ['STRIPE_SHOP_LINKS','PURCHASE_LINKS','STRIPE_CHECKOUT_MODE'])
        if (names.some(entry => entry.name === name) && (await w(['secret','delete',name], { input:'y\n' })).code !== 0) throw new Error('Cleanup failed');
      finishStripeMigration(root);
    }
    const name = pending.name || String(installed.name ?? installed.account).replace(/(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/g,'[redacted]').replace(/[\r\n\x00-\x1f]/g,' ').slice(0,120);
    writeFileSync(receiptFile + '.tmp', JSON.stringify({ mode, profile, account: installed.account, webhookId: hook.webhookId, url: hookUrlOf(site.origin), connectedAt: new Date().toISOString() }), { mode: 0o600 });
    renameSync(receiptFile + '.tmp', receiptFile); rmSync(pendingFile, { force: true });
    await w(['secret','delete','STRIPE_SETUP_CHALLENGE'], { input:'y\n' });
    return { ok: true, command: 'shop connect', message: 'connected to ' + name };
  } catch { if(stage==='webhook')return failure('webhook-setup','Stripe webhook approval or private secret installation could not finish. Run shop connect again to resume with the same account and CLI profile.'); return failure('stripe-setup', 'Connection could not finish. Run shop connect --finish to resume after private key installation, or shop connect to copy a new key. Migration retains old webhook configuration until draining succeeds.'); }
  finally {
    if (captured && clipboard) { try { if (await clipboard.read() === captured) await clipboard.clear(); } catch {} }
    lock.release();
  }
}

export async function disconnectStripe(root, options = {}) {
  const studio = readStudio(root);
  const w = options.wrangler ?? runner(root, studio.cloudflare?.accountId ? { CLOUDFLARE_ACCOUNT_ID: studio.cloudflare.accountId } : {});
  try {
    const dir=receiptDir(root,options.storage??receiptHome()), mode=options.live?'live':'test';
    const file=existsSync(join(dir,mode+'.json'))?join(dir,mode+'.json'):join(dir,mode+'-webhook.json');
    const receipt=json(readFileSync(file,'utf8'));
    const owner=await ownerStripeApi({root,profile:options.profile??receipt.profile??'homie-'+hash(realpathSync(root)).slice(0,24),mode,account:receipt.account,
      process:options.stripeProcess??stripeProcess,open:options.open??openBrowser,log:options.log});
    try { await owner.api('DELETE','/v1/webhook_endpoints/'+receipt.webhookId); } catch(error) { if(error.status!==404)throw error; }
    if ((await w(['secret','delete','STRIPE_KEY'],{input:'y\n'})).code !== 0) throw new Error();
    for (const name of ['STRIPE_WEBHOOK_SECRET','STRIPE_SETUP_CHALLENGE']) await w(['secret','delete',name],{input:'y\n'});
    for(const suffix of ['.json','-rak.json','-webhook.json'])rmSync(join(dir,mode+suffix),{force:true});
    return {ok:true,command:'shop disconnect',message:'Webhook endpoint and Worker key removed. In Stripe Settings → Installed apps → Homie → View API keys, roll/expire the old key. Uninstall alone is not assumed to revoke it.'};
  } catch { return {ok:false,command:'shop disconnect',why:'Disconnect could not finish. Retry with the approved owner CLI profile; endpoint cleanup must precede removal of Worker secrets.'}; }
}
