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

/**
 * The error codes that mean "this computer could not look the name up" (the resolver's, never the site's). ONE list:
 * every command that works against a site reads it through `whyFailed`, and the plugin's own preflight
 * (skills/playtest/scripts/lib/preflight.mjs, which cannot import this file: it runs against whatever studio is
 * installed) keeps the same list, held equal by a test that feeds both the same errors.
 */
export const DNS_CODES = ['ENOTFOUND', 'EAI_AGAIN', 'EAI_NODATA', 'EAI_NONAME', 'ESERVFAIL'];

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
  // A name this process could not look up is this computer's network, never the site's fault: `preflight` says so
  // to callers that would otherwise read "did not answer" as a broken site or game (see `reachSite`).
  if (DNS_CODES.includes(code)) return { why: `could not look up ${host} (${code})${via}`, code, preflight: 'dns' };
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
  if (!res.ok || body?.ok === false) return { ok: false, body, headers: res.headers, ...whyRefused(res, body, text, url) };
  return { ok: true, status: res.status, body, headers: res.headers };
}

/** Whether an address is this computer's own (a dev site): never a network question. */
export function isLoopback(url) {
  try { const h = new URL(String(url)).hostname.toLowerCase(); return LOOPBACK.includes(h) || h.endsWith('.localhost'); } catch { return false; }
}

/*
 * NODE'S DNS IS NOT THE BROWSER'S. On one computer the public studio opened in Chrome while Node's fetch() could
 * not look its hostname up at all (a browser may use its own secure DNS, a VPN's or a cached answer; Node asks the
 * system resolver and nothing else). A check against the public address stopped before it opened a game, and what
 * it printed read as the site, or the game, being down.
 *
 * `reachSite` is the one preflight for a command that is about to work against a site: it asks once, and a failure
 * says what kind it is.
 *   { ok: true, status }                                   the site answered (any status is an answer)
 *   { ok: false, preflight: 'dns', why, instead, ... }     THIS COMPUTER could not look the name up: a network
 *                                                          preflight failure, with local testing offered instead
 *   { ok: false, preflight: 'network', why, instead, ... } no connection, a timeout, a certificate, a proxy refusal
 *   { ok: false, preflight: 'site', status, why }          it answered, and the answer is an error (5xx)
 * It never says a game is broken: it has not opened one.
 */
export const LOCAL_INSTEAD = 'To test without this computer\'s network in the way: run the site here (`npx --no-install homie-studio dev`, as a background task) and give the command --url http://127.0.0.1:8787 (or leave --url out where the command finds the dev site itself).';

export async function reachSite(url, { fetchFn = globalThis.fetch, timeout = 10_000, path = '/', env = process.env, execArgv = process.execArgv } = {}) {
  const base = String(url ?? '').replace(/\/+$/, '');
  const host = hostOf(base);
  let res;
  try { res = await fetchFn(`${base}${path}`, { method: 'GET', redirect: 'manual', headers: { accept: '*/*' }, signal: AbortSignal.timeout(timeout) }); } catch (error) {
    const w = whyFailed(error, base, { env, execArgv });
    if (isLoopback(base)) return { ok: false, preflight: 'local', code: w.code ?? null, why: `${base} does not answer (${w.code ?? 'no connection'}): the site is not running here. Start it (npx --no-install homie-studio dev, as a background task) or check the port.` };
    if (w.preflight === 'dns') {
      return {
        ok: false, preflight: 'dns', code: w.code, needs: 'network-preflight',
        why: `network preflight failed, before any page or game was opened: this computer's Node.js ${w.why}. A browser on the same computer may still open ${host} (browsers can use their own DNS), so this says nothing about the site or the game: it is this computer's name lookup.`,
        instead: LOCAL_INSTEAD,
      };
    }
    return { ok: false, preflight: 'network', code: w.code ?? null, needs: w.needs ?? 'network-preflight', why: `network preflight failed, before any page or game was opened: ${w.why}. That is the connection from this computer to ${host}, not a result about the game.`, instead: LOCAL_INSTEAD };
  }
  try { await res.body?.cancel?.(); } catch { /* nothing to drop */ }
  if (res.status >= 500) return { ok: false, preflight: 'site', status: res.status, why: `${host} answered ${res.status}: the site itself is failing (not this computer's network).` };
  return { ok: true, status: res.status };
}

/**
 * WHAT A COMMAND SAYS WHEN `reachSite` DID NOT FIND THE PLAY PAGE: one classification and one sentence for `check`,
 * `perf`, `shoot` and `port check` (and, word for word in its DNS case, the playtest and perf skills' scripts), so
 * the same failure is never "the site does not answer" from one command and "network preflight" from the next.
 *
 *   null                                the page answered: go on
 *   preflight 'local'                   this computer's own address has nothing listening: start the site
 *   preflight 'site'                    it answered, with an error (a 5xx, or a 4xx: a wrong address or game id)
 *   preflight 'dns' | 'network'         BLOCKED: this computer could not ask. Nothing was measured, nothing is said
 *                                       about the site or the game, and local testing is offered instead.
 *
 * A command that only drives a browser (check, shoot) may still try on a BLOCKED one, because a browser can open a
 * site this process cannot look up; if the browser then fails too, this is what it reports.
 */
export function siteRefusal(reach, { command, play }) {
  if (reach?.ok) {
    return reach.status >= 400 ? { ok: false, command, preflight: 'site', status: reach.status, why: `${play} answered ${reach.status}: start the site (npm run dev, as a background task) or check the address and the game's id` } : null;
  }
  if (reach?.preflight === 'local') return { ok: false, command, preflight: 'local', why: `${play} does not answer: start the site (npm run dev, as a background task that outlives this command) or check the address` };
  if (reach?.preflight === 'site') return { ok: false, command, preflight: 'site', status: reach.status ?? null, why: reach.why };
  return {
    ok: false, command, blocked: true, verdict: 'BLOCKED', preflight: reach?.preflight ?? 'network', ...(reach?.code ? { code: reach.code } : {}), needs: reach?.needs ?? 'network-preflight', instead: reach?.instead ?? LOCAL_INSTEAD,
    why: `BLOCKED ${reach?.why ?? 'network preflight failed, before any page or game was opened.'} Nothing was measured. ${reach?.instead ?? LOCAL_INSTEAD}`,
  };
}
