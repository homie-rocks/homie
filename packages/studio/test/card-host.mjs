/**
 * A stand-in MCP Apps host for card tests: a page that frames one card (lib/mcp.mjs cardHtml), answers its
 * ui/initialize with a host context, hands it a tool result, and forwards the card's tools/call requests to a real
 * `homie-studio mcp` server (stdio). Headless Chrome drives it, so a test can press a card's buttons and look.
 *
 *   const host = await cardHost({ server, uri, result, viewport })   // server: talk() from scripts/desktop.mjs
 *   await host.page.click('button'); await host.shot(file); await host.close();
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cardHtml } from '../lib/mcp.mjs';

/** A host's side of the stdio transport, for one `homie-studio mcp` process: { request(method, params), close() }. */
export function mcpServer(cmd, args, { cwd, env = {} } = {}) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; let seq = 0; let err = ''; const waiting = new Map();
  child.stderr.on('data', (d) => { err += d; });
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => { if (waiting.has(id)) reject(new Error(`no answer to ${method}\n${err.slice(-1500)}`)); }, Number(process.env.HOMIE_MCP_TEST_WAIT_MS ?? 120_000));
  });
  const close = () => new Promise((r) => { if (child.exitCode !== null) r(); else { child.on('close', r); child.stdin.end(); } });
  return { request, close, stderr: () => err };
}

const HOST_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:#f4f3ef;font-family:system-ui}iframe{display:block;width:100%;border:0;background:transparent}.dark{background:#1b1b1d}</style></head>
<body><iframe id="card" sandbox="allow-scripts"></iframe><script>
const frame = document.getElementById('card');
let result = null; let dark = false;
window.calls = [];
window.told = [];
window.boot = (html, r, theme) => { result = r; dark = theme === 'dark'; if (dark) document.body.className = 'dark'; frame.srcdoc = html; };
window.addEventListener('message', async (ev) => {
  const m = ev.data; if (!m || m.jsonrpc !== '2.0') return;
  const reply = (res) => frame.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: res }, '*');
  if (m.method === 'ui/initialize') {
    reply({ protocolVersion: '2026-01-26', hostCapabilities: {}, hostContext: { theme: dark ? 'dark' : 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] } });
  } else if (m.method === 'ui/notifications/initialized') {
    frame.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result }, '*');
  } else if (m.method === 'ui/notifications/size-changed') {
    frame.style.height = m.params.height + 'px';
  } else if (m.method === 'tools/call') {
    window.calls.push(m.params);
    const res = await window.callTool(m.params.name, m.params.arguments || {});
    reply(res);
  } else if (m.method === 'ui/update-model-context') {
    window.told.push(m.params.content?.[0]?.text ?? ''); reply({});
  } else if (m.id !== undefined) reply({});
});
</script></body></html>`;

export async function cardHost({ puppeteer, chrome, args = [], server, uri, result, viewport = { width: 760, height: 900, deviceScaleFactor: 1 }, theme = 'light' }) {
  const http = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HOST_PAGE); });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args });
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
  await page.exposeFunction('callTool', async (name, a) => (await server.request('tools/call', { name, arguments: a })).result);
  await page.goto(`http://127.0.0.1:${http.address().port}/`);
  await page.evaluate((h, r, t) => window.boot(h, r, t), cardHtml(uri), result, theme);
  const frame = async () => { for (let i = 0; i < 50; i++) { const f = page.frames().find((x) => x !== page.mainFrame()); if (f) return f; await new Promise((r) => setTimeout(r, 100)); } throw new Error('no card frame'); };
  const card = await frame();
  const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
  await settle(900);
  return {
    page, card, errors, settle,
    /** Press the first button whose text matches. */
    /** Press the first (or the nth, from 0) button whose text matches. */
    press: async (re, nth = 0) => {
      const ok = await card.evaluate((src, n) => { const r = new RegExp(src, 'i'); const b = [...document.querySelectorAll('button')].filter((x) => r.test(x.textContent))[n]; if (b) b.click(); return Boolean(b); }, re.source ?? String(re), nth);
      if (!ok) throw new Error(`no button matching ${re}${nth ? ` (#${nth})` : ''}`);
      return ok;
    },
    /** Type into the card's text field, then press Enter. */
    type: async (text) => {
      await card.focus('input[type=text]');
      await card.type('input[type=text]', text);
      await card.evaluate(() => document.querySelector('input[type=text]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    },
    text: () => card.evaluate(() => document.body.innerText),
    calls: () => page.evaluate(() => window.calls),
    told: () => page.evaluate(() => window.told),
    shot: async (file) => { const el = await page.$('#card'); await el.screenshot({ path: file }); },
    close: async () => { await browser.close().catch(() => {}); await new Promise((r) => http.close(r)); },
  };
}
