import { createServer } from 'node:http';
import { needsStripeMigration, stripeSessionsDrained, finishStripeMigration } from './stripe-migration.mjs';
import { compactDecrypt, importPKCS8, decodeProtectedHeader } from 'jose';
import { KEY_SHAPE, WEBHOOK_SECRET_SHAPE, modeOf } from '../worker/stripe.mjs';
/** Stripe owns browser authorization. This module owns only secret transport and a non-secret receipt.
 * See docs/stripe-connect-research.md: current CLI OAuth is NOT a Worker credential issuer. */
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runner } from './cloudflare.mjs';
import { lockDeploy } from './deploy-state.mjs';
import { readStudio, siteUrl } from './studio.mjs';
import { hookUrlOf, readShop } from './shop.mjs';
import { redactStripe } from '../worker/stripe.mjs';

const hash = (s) => createHash('sha256').update(s).digest('hex');
const failure = (needs, why, extra = {}) => ({ ok: false, command: 'shop connect', needs, why, ...extra });
const receiptHome = () => join(homedir(), '.config', 'homie', 'stripe');
const receiptDir = (root, storage) => join(storage, hash(realpathSync(root)).slice(0, 24));

/** Local non-secret receipt. Runtime checks determine whether the key still works. */
export function stripeConnectionInfo(root, { storage = receiptHome() } = {}) {
  try {
    const r = JSON.parse(readFileSync(join(receiptDir(root, storage), 'test.json'), 'utf8'));
    if (r.url !== hookUrlOf(siteUrl(root)) || !r.keyId) return null;
    return { mode: 'test', connectedAt: r.connectedAt, renew: 'homie-studio shop connect --renew' };
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

/** The remote callback can only reach the computer that owns this loopback listener.
 * Display the Stripe-verified account before sending the local collect capability. */
export async function createApprovalListener({ confirm, port = 0 }) {
  let url, approval = null;
  const server = createServer(async (req, res) => {
    const respond = (status, body) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'" }); res.end(body); };
    try {
      if (req.headers.host !== new URL(url).host) return respond(400, 'Invalid host');
      const target = new URL(req.url, url);
      if (target.pathname !== '/stripe/confirm') return respond(404, 'Not found');
      if (req.method === 'GET') {
        const account = target.searchParams.get('account'), value = target.searchParams.get('confirm'), id = target.searchParams.get('id');
        if (!/^acct_[A-Za-z0-9]+$/.test(account ?? '') || !/^[a-f0-9]{64}$/.test(value ?? '') || !id) return respond(400, 'Invalid approval');
        approval = { account, confirm: value, id, token: randomBytes(32).toString('hex') };
        return respond(200, `<h1>Connect Stripe account ${account}</h1><p>Connect this account to your studio on this computer?</p><form method="post"><input type="hidden" name="token" value="${approval.token}"><button>Connect this account</button></form>`);
      }
      if (req.method !== 'POST' || req.headers.origin !== new URL(url).origin) return respond(403, 'Invalid origin');
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1024) return respond(413, 'Too large'); }
      if (!approval || new URLSearchParams(body).get('token') !== approval.token) return respond(403, 'Invalid confirmation');
      const value = approval; approval = null;
      await confirm(value);
      respond(200, '<h1>Stripe account confirmed</h1><p>You can close this window.</p>');
    } catch { respond(400, 'Setup could not finish. Retry shop connect.'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  url = `http://127.0.0.1:${server.address().port}/stripe/confirm`;
  return { url, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

/** One approval; ciphertext is the only credential representation crossing Homie. */
export async function shopConnect(root, options = {}) {
  if (options.manual || options.fromClipboard) return failure('app-approval', 'Approve the Homie Stripe App; key entry is not supported.');
  const { live = false, log = () => {}, open = openBrowser, fetcher = fetch,
    storage = receiptHome(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeout = 10 * 60_000 } = options;
  const mode = live ? 'live' : 'test';
  const checked = readShop(root);
  if (!checked.ok || checked.absent) return failure('shop', 'Create and check shop.json first.');
  let site;
  try { site = new URL(siteUrl(root)); } catch { return failure('deploy', 'Deploy the studio to its HTTPS address first.'); }
  if (site.protocol !== 'https:' || site.username || site.password || site.port) return failure('deploy', 'The studio needs a public HTTPS address.');
  const dir = receiptDir(root, storage);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = lockDeploy(dir);
  if (!lock.ok) return failure('busy', 'Stripe setup is already running for this studio.');
  let listener;
  try {
    for (const file of readdirSync(dir).filter(name => /^(test|live)-pending\.json(?:\.tmp)?$/.test(name))) {
      const path=join(dir,file), saved=json(readFileSync(path,'utf8'));
      if(file.endsWith('.tmp') || !saved || saved.expires < Date.now())rmSync(path,{force:true});
    }
    const studio = readStudio(root);
    const receiptFile = join(dir, mode + '.json');
    const prior = existsSync(receiptFile) ? json(readFileSync(receiptFile, 'utf8')) : null;
    const migration = needsStripeMigration(root, prior, mode);
    const w = options.wrangler ?? runner(root, studio.cloudflare?.accountId ? { CLOUDFLARE_ACCOUNT_ID: studio.cloudflare.accountId } : {});
    const service = options.service ?? 'https://homie.rocks/api/stripe-app';
    const endpoint = new URL(service);
    if (endpoint.origin !== 'https://homie.rocks' && !(endpoint.protocol === 'http:' && ['localhost','127.0.0.1'].includes(endpoint.hostname))) throw new Error('Invalid setup service');
    const pendingFile = join(dir, mode + '-pending.json');
    let pending = existsSync(pendingFile) ? json(readFileSync(pendingFile, 'utf8')) : null;
    if (!pending || !pending.privateKey || options.renew || pending.origin !== site.origin || pending.expires < Date.now()) { pending = null; rmSync(pendingFile, { force: true }); }
    const savePending = () => { writeFileSync(pendingFile + '.tmp', JSON.stringify(pending), { mode: 0o600 }); renameSync(pendingFile + '.tmp', pendingFile); };
    const call = async (path, body) => {
      const response = await fetcher(service + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error('Setup service refused request');
      return response.json();
    };
    listener = await createApprovalListener({ port: pending?.loopback ? Number(new URL(pending.loopback).port) : 0,
      confirm: async value => {
        if (!pending || value.id !== pending.started.id) throw new Error('Wrong setup');
        await call('/confirm', { id: value.id, confirm: value.confirm, collectToken: pending.collectToken });
      } });
    if (!pending) {
      const keys = generateKeyPairSync('rsa', { modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
      const nonce = randomBytes(32).toString('hex'), collectToken = randomBytes(32).toString('hex');
      if ((await w(['secret', 'put', 'STRIPE_SETUP_CHALLENGE'], { input: hash(nonce) })).code !== 0) return failure('cloudflare', 'Cloudflare could not prepare Stripe setup. Retry shop connect.');
      const started = await call('/start', { nonce, collectToken, publicKey: keys.publicKey, origin: site.origin, mode, migration, loopback: listener.url, expectedAccount: prior?.account });
      if (!stripeURL(started.url) || typeof started.id !== 'string') throw new Error('Invalid approval response');
      pending = { ...keys, nonce, collectToken, started, loopback: listener.url, origin: site.origin, expires: Date.now() + (migration ? 48 * 60 * 60_000 : timeout) };
      savePending();
      log('Approve Homie in Stripe. Your studio will receive its Checkout connection automatically.');
      options.onEvent?.({ type: 'stripe.approval', message: 'Approval opened in your browser.' });
      open(started.url);
    }
    const { started, collectToken, privateKey } = pending;
    const deadline = pending.expires;
    let result;
    while (Date.now() < deadline) {
      result = await call('/collect', { id: started.id, collectToken });
      if (result.status === 'ready') break;
      if (result.status === 'draining' && result.open === 0 && await stripeSessionsDrained(w, studio.cloudflare.d1, result.complete)) {
        await call('/drained', { id: started.id, collectToken });
      }
      if (result.status === 'failed') { rmSync(pendingFile, { force: true }); return failure('app-approval', 'Stripe setup could not finish. Retry shop connect after the Homie app is approved for managed keys.'); }
      await wait(30_000);
    }
    if (result?.status !== 'ready') { rmSync(pendingFile, {force:true}); return failure('app-approval', 'Approval timed out. Run shop connect again.'); }
    if (result.mode !== mode || result.origin !== site.origin || !/^acct_[A-Za-z0-9]+$/.test(result.account)) throw new Error('Setup binding mismatch');
    const key = await decryptManagedKey(result.key, privateKey);
    delete pending.privateKey; delete pending.publicKey; savePending();
    if (!KEY_SHAPE.test(key) || modeOf(key) !== mode) throw new Error('Invalid credential envelope');
    // Capture and discard all Wrangler output, including failures. Never return provider error text.
    for (const [name, value] of [['STRIPE_KEY', key]]) {
      if ((await w(['secret', 'put', name], { input: value })).code !== 0) return failure('cloudflare', 'Cloudflare could not finish installing Stripe. Run shop connect again.');
    }
    if (migration) {
      const deployStudio = options.deploy ?? ((root) => import('./cloudflare.mjs').then(m => m.deploy(root)));
      const deployed = await deployStudio(root);
      if (!deployed.ok) return failure('migration', 'Studio Checkout deployment could not finish; retry shop connect.');
    }
    const boot = await fetcher(site.origin + '/api/shop/stripe-setup', { method: 'POST', headers: { authorization: 'Bearer ' + pending.nonce }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!boot.ok) throw new Error('Studio webhook setup failed');
    const installed = await boot.json();
    if (!installed.ok || !/^we_[A-Za-z0-9]+$/.test(installed.webhookId)) throw new Error('Studio webhook unavailable');
    result.webhookId = installed.webhookId;
    if (migration) {
      await call('/cutover', {id:started.id,collectToken,webhookId:result.webhookId});
      let drained = false;
      while (Date.now() < deadline) {
        const page = await call('/collect', {id:started.id,collectToken});
        if (page.status === 'failed') throw new Error('Cutover failed');
        if (page.status === 'drained') {drained=true;break;}
        if (page.status === 'draining' && page.open === 0 && await stripeSessionsDrained(w,studio.cloudflare.d1,page.complete)) {
          const done = await call('/drained',{id:started.id,collectToken});
          if(done.ok){drained=true;break;}
        }
        await wait(30_000);
      }
      if(!drained)throw new Error('Drain timeout');
      const listed = await w(['secret', 'list']);
      const names = json(listed.stdout ?? listed.out);
      if (listed.code !== 0 || !Array.isArray(names)) return failure('cloudflare', 'Stripe is installed; retry shop connect to finish removing the retired configuration.');
      for (const name of ['STRIPE_SHOP_LINKS', 'PURCHASE_LINKS', 'STRIPE_CHECKOUT_MODE']) {
        if (names.some(entry => entry.name === name) && (await w(['secret', 'delete', name], { input: 'y\n' })).code !== 0) return failure('cloudflare', 'Stripe is installed; retry shop connect to finish removing the retired configuration.');
      }
    }
    await call('/ack', { id: started.id, collectToken, webhookId: result.webhookId });
    rmSync(pendingFile, { force: true });
    if (migration) finishStripeMigration(root);
    const receipt = { mode, account: result.account, keyId: result.keyId, webhookId: result.webhookId, url: hookUrlOf(site.origin), connectedAt: new Date().toISOString() };
    writeFileSync(join(dir, mode + '.json.tmp'), JSON.stringify(receipt), { mode: 0o600 });
    renameSync(join(dir, mode + '.json.tmp'), join(dir, mode + '.json'));
    return { ok: true, command: 'shop connect', mode, account: result.account, message: 'Stripe connected. Purchases and signed fulfilment run on your studio.' };
  } catch { return failure('stripe-setup', 'Stripe setup could not finish. Retry shop connect. No credentials were printed.'); }
  finally { if (listener) await listener.close(); lock.release(); }
}

export async function decryptManagedKey(ciphertext, privateKey) {
 const {alg,enc}=decodeProtectedHeader(ciphertext);
 if(!['RSA-OAEP','RSA-OAEP-256'].includes(alg)||enc!=='A256GCM')throw new Error('Unsupported key envelope');
 const key=await importPKCS8(privateKey,alg);
 return new TextDecoder().decode((await compactDecrypt(ciphertext,key,{keyManagementAlgorithms:[alg],contentEncryptionAlgorithms:['A256GCM']})).plaintext);
}
