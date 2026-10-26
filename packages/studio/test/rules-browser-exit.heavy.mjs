/** Real Chrome visibility lifecycle on the production rules bundle. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { NetRoom } from '../worker/room.mjs';
import { chromeArgs, findChrome } from '../lib/chrome.mjs';
import { prepareRules, viewPlugin } from '../lib/rules-build.mjs';
import { COIN_DASH, PKG, esbuildOf } from './rules-kit.mjs';

for (const scenario of ['offline', 'online', 'expired']) test(`Chrome: solo rules host recovery, ${scenario}`, { timeout: 120000 }, async (t) => {
  const offline = scenario === 'offline';
  const dir = mkdtempSync(join(tmpdir(), 'homie-hidden-'));
  let browser;
  t.after(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });
  const esbuild = await esbuildOf();
  const g = { ...JSON.parse(readFileSync(join(COIN_DASH, 'game.json'))), dir: COIN_DASH, room: { host: 'browser', offline: true } };
  const rules = await prepareRules(esbuild, dir, g);
  const entry = join(dir, 'entry.ts');
  writeFileSync(entry, `import { openRoom } from ${JSON.stringify(join(PKG, 'rules/view.ts'))}; window.room = openRoom({ net: { config: window.TEST_CONFIG, post: null } });`);
  const built = await esbuild.build({ entryPoints: ['homie:view'], bundle: true, format: 'iife', write: false, plugins: [viewPlugin(g, rules, entry)] });
  const server = createServer((req, res) => { if (req.url === '/game.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(built.outputFiles[0].text); } else { const config = offline ? null : { v: 1, url: `ws://127.0.0.1:${server.address().port}/socket`, room: 'hidden', device: 'desk', want: 'play' }; res.end(`<!doctype html><script>window.TEST_CONFIG=${JSON.stringify(config)}</script><script src="/game.js"></script>`); } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  let relayShift = 0;
  const relay = new NetRoom({ code: 'hidden', rules: true, maxPlayers: 8, now: () => Date.now() + relayShift });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (socket) => {
    const wire = relay.attach({ send: (text) => socket.send(text), close: (code, why) => socket.close(code, why), buffered: () => socket.bufferedAmount });
    socket.on('message', (data) => wire.onMessage(data.toString())); socket.on('close', () => wire.onClose());
  });
  const heartbeat = setInterval(() => relay.tick(), 250);
  t.after(() => { clearInterval(heartbeat); for (const socket of sockets.clients) socket.terminate(); sockets.close(); });
  const puppeteer = (await import('puppeteer-core')).default;
  browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, userDataDir: join(dir, 'profile'), args: chromeArgs(), ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.bringToFront();
  await page.waitForFunction(() => window.__homieNet?.probe.tick() > 10);
  if (scenario === 'expired') {
    // The empty relay receives no ticks during the absence, as a sleeping object would.
    clearInterval(heartbeat);
    relayShift = 72000;
    for (const socket of sockets.clients) socket.terminate();
    await page.waitForFunction(() => window.__homieNet?.reconnects > 0 && window.__homieNet.connected);
    await page.waitForFunction(() => window.room.me?.driver === 'person');
    const before = await page.evaluate(() => { window.room.input({ ax: 127, ay: 0 }); return window.room.me.pos.x; });
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.ok(await page.evaluate(x => window.room.me.pos.x > x + 1, before));
    return;
  }
  const cover = await browser.newPage(); await cover.bringToFront();
  await page.waitForFunction(() => document.hidden);
  const before = await page.evaluate(() => ({ tick: window.__homieNet.probe.tick(), round: window.__homieNet.round.n }));
  await new Promise((resolve) => setTimeout(resolve, 10000));
  assert.equal(await page.evaluate(() => window.__homieNet.probe.tick()), before.tick);
  await page.bringToFront();
  await page.waitForFunction((tick) => window.__homieNet.probe.tick() > tick + 10, {}, before.tick);
  assert.deepEqual(await page.evaluate(() => ({ hosting: window.__homieNet.rulesHosting, round: window.__homieNet.round.n })), { hosting: true, round: before.round });
});
