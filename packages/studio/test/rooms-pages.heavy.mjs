/** Real update/recovery behavior belongs to the release suite; the paced update matrix is an explicit soak. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { test } from 'node:test';
import puppeteer from 'puppeteer-core';
import { findChrome, chromeArgs } from '../lib/chrome.mjs';
import { PKG, REPO_NM } from './rules-kit.mjs';

const soak = process.env.HOMIE_ROOMS_PAGE_SOAK === '1';
test(soak ? 'real Chrome play and watch pages: paced update soak' : 'real Chrome play and watch pages retain their room through three acknowledged updates', { timeout: soak ? 1_800_000 : 900_000 }, async t => {
  const wrangler = join(REPO_NM, '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
  if (!existsSync(wrangler)) { t.skip('Local Wrangler executable is absent; install Wrangler to run the real update proof.'); return; }
  if (!findChrome()) { t.skip('Chrome is absent; set CHROME_PATH to run the real update proof.'); return; }
  // Fail at the actual browser boundary before starting a server on a machine that cannot launch Chrome.
  try { const probe = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: chromeArgs(), timeout: 0 }); await probe.close(); }
  catch (error) { t.skip('Chrome cannot start: ' + error.message.split('\n')[0]); return; }
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-room-pages-'))), studio = join(scratch, 'studio');
  const cli = join(PKG, 'bin/homie-studio.mjs'); let dev, proof;
  const stop = async child => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, 'exit');
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    const force = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 5000);
    try { await ended; } finally { clearTimeout(force); }
  };
  try {
    const run = args => { const r = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd: scratch, encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); };
    run(['new', studio, '--name', 'Room Owls', '--homie', 'https://homie.test', '--no-install']);
    mkdirSync(join(studio, 'node_modules/@homie-rocks'), { recursive: true });
    symlinkSync(PKG, join(studio, 'node_modules/@homie-rocks/studio'));
    mkdirSync(join(studio, 'node_modules/.bin'), { recursive: true });
    symlinkSync(wrangler, join(studio, 'node_modules/.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'));
    for (const name of ['esbuild', 'wrangler']) symlinkSync(join(REPO_NM, name), join(studio, 'node_modules', name));
    const made = spawnSync(process.execPath, [cli, 'game', 'new', 'coin-dash', '--from', 'coin-dash', '--json'], { cwd: studio, encoding: 'utf8' }); assert.equal(made.status, 0, made.stdout + made.stderr);
    const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(r => socket.close(r));
    const origin = `http://127.0.0.1:${port}`; let log = '';
    dev = spawn(process.execPath, [cli, 'dev', '--port', String(port), '--no-local-ai'], { cwd: studio, detached: true, env: { ...process.env, HOMIE_PREVIEW: '1', NODE_OPTIONS: '--max-old-space-size=1536' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [dev.stdout, dev.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-12000); });
    let ready = false;
    while (dev.exitCode === null && dev.signalCode === null) {
      ready = await fetch(`${origin}/coin-dash/play`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok).catch(() => false);
      if (ready) break; await new Promise(r => setTimeout(r, 250));
    }
    assert.ok(ready, log);
    proof = spawn(process.execPath, ['--max-old-space-size=1536', join(PKG, 'test/rooms-pages.mjs'), origin, studio, ...(soak ? [] : ['--release'])], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let result = ''; for (const stream of [proof.stdout, proof.stderr]) stream.on('data', chunk => { result += chunk; });
    const [code] = await Promise.race([
      once(proof, 'exit'),
      once(dev, 'exit').then(([code, signal]) => { throw new Error(`Preview dev exited during the update proof (code ${code}, signal ${signal})\n${log}`); }),
    ]);
    assert.equal(code, 0, result + '\n' + log);
  } finally {
    await stop(proof);
    if (dev && dev.exitCode === null && dev.signalCode === null) {
      await stop(dev);
    }
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('real Chrome retries silent, HTTP error and reset frame documents on play and watch pages', async t => {
  if (!findChrome()) { t.skip('Chrome is absent; set CHROME_PATH to run frame recovery.'); return; }
  let browser;
  try { browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: chromeArgs(), timeout: 0 }); }
  catch (error) { t.skip('Chrome cannot start: ' + error.message.split('\n')[0]); return; }
  const { createServer: httpServer } = await import('node:http');
  const { playPage, watchPage } = await import('../worker/pages.mjs');
  const cat = { studio: { name: 'Room Owls', theme: { accent: '#ffcf5a' } }, games: [] };
  const game = { id: 'test', name: 'Test', players: { max: 8 } };
  let failure = null, requests = 0;
  const server = httpServer(async (req, res) => {
    if (req.url.includes('/__game/')) {
      requests++;
      if (failure === 'reset' && requests <= 4) { req.socket.destroy(); return; }
      if (failure === 'status' && requests === 1) { res.writeHead(503, { 'content-type': 'text/html' }); res.end('Unavailable'); return; }
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      res.end(failure === 'silent' ? '<p>No helper</p>' : `<script>window.good=true; for(const what of ['attached','ready','build']) parent.postMessage({t:'homie-net',what,ver:'new'},'*');</script>`);
      return;
    }
    if (/\/test\/(play|watch)/.test(req.url)) {
      const response = req.url.includes('/watch') ? watchPage(cat, game, { room: 'friends' }) : playPage(cat, game, { room: 'friends' });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    for (const mode of ['play', 'watch']) for (const fault of ['silent', 'status', 'reset']) {
      failure = null; requests = 0;
      const page = await browser.newPage(); page.setDefaultTimeout(0); page.setDefaultNavigationTimeout(0);
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/test/${mode}?room=friends`);
        const frame = page.frames().find(f => f !== page.mainFrame()); await frame.waitForFunction('window.good === true');
        failure = fault; requests = 0;
        await frame.evaluate(() => parent.postMessage({ t: 'homie-net', what: 'stale', final: true, immediate: true, ver: 'new' }, '*'));
        const status = mode === 'play' ? '[data-toast]' : '[data-update]';
        if (fault === 'silent') {
          await page.waitForFunction(sel => document.querySelector(sel)?.textContent.includes('Reload the page'), {}, status);
          assert.equal(requests, 6);
        } else {
          // Wait for the new document's positive report, not the iframe load event.
          while (true) {
            const good = await page.frames().find(f => f !== page.mainFrame())?.evaluate(() => window.good === true).catch(() => false);
            if (requests > (fault === 'reset' ? 4 : 1) && good) break;
            await new Promise(r => setTimeout(r, 50));
          }
          await page.waitForFunction(sel => document.querySelector(sel)?.hidden === true, {}, status);
          assert.equal(new URL(page.url()).searchParams.get('room'), 'friends');
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
