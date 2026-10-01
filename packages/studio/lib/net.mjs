/**
 * THE TOOLKIT'S OWN WEB REQUESTS, AND WHAT TO SAY WHEN ONE FAILS.
 *
 * A Claude Code cloud session sends ALL of its traffic through an HTTP proxy named in HTTPS_PROXY. curl, npm and
 * git use that proxy. Node's own fetch() does not, unless the process started with NODE_USE_ENV_PROXY=1 (Node
 * 22.21 and later): it connects directly, the VM's direct egress fails ("getaddrinfo ENOTFOUND"), and the toolkit
 * used to report "did not answer". On 2026-09-30 a session with FULL network access read that as a blocked network
 * and told the person to change their network settings, while curl in the same session reached homie.rocks.
 *
 * So:
 *   - The CLI restarts itself once with NODE_USE_ENV_PROXY=1 when a proxy is set and this Node can use it
 *     (`restartWithProxy`), so every request it makes goes the way curl's do. Loopback addresses never go
 *     through the proxy.
 *   - A failed request is reported as what it is (`request`, `whyFailed`):
 *       * the status and the server's own message;
 *       * or the connection error's code (ENOTFOUND, ECONNREFUSED, a timeout, a TLS error) and whether a proxy
 *         was used.
 *   - The network setting is named ONLY when the proxy itself refused the host: a 403 with
 *     `x-deny-reason: host_not_allowed`, or a CONNECT it refused.
 */
import { spawn } from 'node:child_process';

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
const LOOPBACK = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** The proxy this machine's web requests go through (the environment's HTTPS_PROXY and friends), or null. */
export function proxyOf(env = process.env) {
  for (const k of PROXY_VARS) if (String(env[k] ?? '').trim()) return { variable: k, url: String(env[k]).trim() };
  return null;
}

/**
 * Whether this process's fetch() uses that proxy: Node's NODE_USE_ENV_PROXY / --use-env-proxy is on, and the variable
 * Node reads for https (https_proxy, then HTTPS_PROXY; an empty one counts, as "none") names one.
 */
export function proxyInUse(env = process.env, execArgv = process.execArgv) {
  const on = env.NODE_USE_ENV_PROXY === '1' || execArgv.includes('--use-env-proxy');
  return on && Boolean(String(env.https_proxy ?? env.HTTPS_PROXY ?? '').trim());
}

/** Whether this Node.js can use the environment's proxy at all (22.21 and later have --use-env-proxy). */
export function canUseProxy() {
  try { return Boolean(process.allowedNodeEnvironmentFlags?.has('--use-env-proxy')); } catch { return false; }
}

/** NO_PROXY with this machine's own loopback addresses in it (a dev site or a local directory never goes out). */
export function noProxyWithLoopback(value) {
  const have = String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set([...have, ...LOOPBACK.filter((h) => h !== '[::1]')])].join(',');
}

/**
 * Run this CLI once more with Node's proxy support on, when a proxy is set and not yet in use. Resolves to the exit
 * status of that run, or null when there was nothing to do (no proxy, already on, or a Node without it). A signal
 * this process gets (Ctrl-C, or a kill by its process id) is passed on, so the run never outlives it.
 */
export function restartWithProxy({ argv = process.argv, env = process.env, execArgv = process.execArgv } = {}) {
  if (!proxyOf(env) || proxyInUse(env, execArgv) || !canUseProxy() || env.HOMIE_STUDIO_NO_PROXY_RESTART === '1') return Promise.resolve(null);
  // Node reads https_proxy before HTTPS_PROXY, and an EMPTY one counts: it would silently mean "no proxy".
  const next = Object.fromEntries(Object.entries(env).filter(([k, v]) => !(PROXY_VARS.includes(k) && !String(v ?? '').trim())));
  const quiet = execArgv.some((a) => a.startsWith('--disable-warning=UNDICI-EHPA')) ? [] : ['--disable-warning=UNDICI-EHPA'];
  return new Promise((done) => {
    let child;
    try {
      child = spawn(process.execPath, [...quiet, ...execArgv, ...argv.slice(1)], {
        stdio: 'inherit',
        env: { ...next, NODE_USE_ENV_PROXY: '1', HOMIE_STUDIO_NO_PROXY_RESTART: '1', NO_PROXY: noProxyWithLoopback(env.NO_PROXY ?? env.no_proxy), no_proxy: noProxyWithLoopback(env.no_proxy ?? env.NO_PROXY) },
      });
    } catch { done(null); return; } // could not start it: carry on in this process, and the errors will say why
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    // Ctrl-C at a terminal reaches the whole process group already: pass SIGINT on only when nothing else will.
    const pass = (signal) => { if (signal === 'SIGINT' && process.stdin.isTTY) return; try { child.kill(signal); } catch { /* already gone */ } };
    for (const signal of signals) process.on(signal, pass);
    child.on('error', () => { for (const signal of signals) process.off(signal, pass); done(null); });
    child.on('exit', (code, signal) => { for (const signal of signals) process.off(signal, pass); done(code ?? (signal ? 1 : 0)); });
  });
}

const hostOf = (url) => { try { return new URL(String(url)).host; } catch { return String(url); } };
const oneLine = (text, max = 200) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The one network setting a Claude Code cloud session can change, said only when its proxy refused the host. */
export function networkSetting(host) {
  return `the network proxy of this machine refused ${host}. In a Claude Code cloud session that means the environment's network access leaves it out: in claude.ai/code, open the environment's settings, set Network access to Custom, add ${host} (keep "Also include default list of common package managers"; Full works too), and start a new session`;
}

/**
 * Why a request that never got an answer failed: the connection error's own code and words, and the proxy's part.
 * { why, code, needs } where needs is 'network' only for a refusal by the proxy itself.
 */
export function whyFailed(error, url, { env = process.env, execArgv = process.execArgv } = {}) {
  const host = hostOf(url);
  // fetch() wraps the real error: TypeError "fetch failed" > (a DOMException) > the socket's or the proxy's own.
  const chain = [];
  for (let e = error, i = 0; e && i < 6; e = e.cause, i += 1) chain.push(e);
  const deepest = chain.at(-1) ?? {};
  const code = chain.map((e) => e?.code).reverse().find((c) => typeof c === 'string' && c.trim())
    ?? (chain.some((e) => e?.name === 'TimeoutError') ? 'TIMEOUT' : null);
  const words = oneLine(deepest.message ?? String(error));
  const proxy = proxyOf(env);
  const used = Boolean(proxy) && proxyInUse(env, execArgv);
  const refused = /Proxy response \((\d{3})\)/i.exec(chain.map((e) => e?.message ?? '').join(' '));
  if (refused && refused[1] === '403') return { why: networkSetting(host), code: 'PROXY_403', needs: 'network' };
  if (refused) return { why: `the network proxy (${proxy?.variable ?? 'HTTPS_PROXY'}) answered ${refused[1]} when asked to connect to ${host}`, code: `PROXY_${refused[1]}` };
  const via = proxy ? (used ? ` (through the proxy in ${proxy.variable})` : ` (directly: this machine's proxy in ${proxy.variable} was not used${canUseProxy() ? '' : `, because Node.js ${process.versions.node} cannot use it; Node.js 22.21 or newer can`})`) : '';
  if (code === 'TIMEOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return { why: `no answer from ${host} in time${via}`, code: code ?? 'TIMEOUT' };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { why: `could not look up ${host} (${code})${via}`, code };
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return { why: `could not connect to ${host} (${code})${via}`, code };
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/i.test(code ?? '') || /certificate/i.test(words)) {
    return { why: `the TLS certificate ${host} presented is not trusted here (${code ?? words})${via}; when a proxy inspects traffic, its CA belongs in NODE_EXTRA_CA_CERTS`, code: code ?? 'CERT' };
  }
  return { why: `the request to ${host} failed (${code ? `${code}: ` : ''}${words})${via}`, code };
}

/** Why an answer is a refusal: the proxy's (and then the one network setting), or the server's own words. */
export function whyRefused(res, body, text, url) {
  const host = hostOf(url);
  if (res?.status === 403 && /host_not_allowed/i.test(res.headers?.get?.('x-deny-reason') ?? '')) return { why: networkSetting(host), needs: 'network', status: 403 };
  const said = oneLine(body?.message ?? body?.error ?? (body ? '' : text), 300);
  return { why: `${host} answered ${res?.status}${said ? `: ${said}` : ''}`, status: res?.status ?? null };
}

/**
 * One JSON request with an honest result: { ok: true, status, body } or { ok: false, why, status?, code?, needs? }.
 * A 2xx answer whose JSON says `ok: false` is a refusal too.
 */
export async function request(url, init = {}, { timeout = 10_000, fetchFn = globalThis.fetch } = {}) {
  let res; let text = '';
  try {
    res = await fetchFn(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeout) });
    text = await res.text();
  } catch (error) { return { ok: false, ...whyFailed(error, url) }; }
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok || body?.ok === false) return { ok: false, body, ...whyRefused(res, body, text, url) };
  return { ok: true, status: res.status, body, headers: res.headers };
}
