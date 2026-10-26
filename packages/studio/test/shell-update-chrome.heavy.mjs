/**
 * A play page left open across a deploy (0.46.5), in real Chrome against a real local Worker.
 *
 * The page a browser holds was made by the Worker that was live when it opened; the game's frame is always asked of
 * the Worker that is live now. Two old pages are made here by rewriting the first page the Worker sends, the way an
 * older Worker would have written it, and everything after that is the real thing:
 *
 *   a page that says what it was made for, and is behind   → one full reload, to the same room and the same seat
 *   a page from before that handshake, with no player      → a whole new page by the one way such a page has, and the
 *     ticket, hosting a game that keeps results               next round's result is kept for the player
 *
 * Run: node --test packages/studio/test/shell-update-chrome.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { test } from 'node:test';
import puppeteer from 'puppeteer-core';
import { findChrome, chromeArgs } from '../lib/chrome.mjs';
import { PKG, REPO_NM } from './rules-kit.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('real Chrome: a play page older than the game is brought up to date once, keeps its room and seat, and the next result is kept', { timeout: 900_000 }, async (t) => {
  const wrangler = join(REPO_NM, '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
  if (!existsSync(wrangler)) { t.skip('Local Wrangler executable is absent.'); return; }
  if (!findChrome()) { t.skip('Chrome is absent; set CHROME_PATH.'); return; }
  let browser;
  try { browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: chromeArgs(), timeout: 0 }); }
  catch (error) { t.skip('Chrome cannot start: ' + error.message.split('\n')[0]); return; }
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-shell-update-'))), studio = join(scratch, 'studio');
  const cli = join(PKG, 'bin/homie-studio.mjs'); let dev;
  const stop = async (child) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, 'exit');
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    const force = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 5000);
    try { await ended; } finally { clearTimeout(force); }
  };
  try {
    const run = (args, cwd = scratch) => { const r = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); };
    run(['new', studio, '--name', 'Shell Owls', '--homie', 'https://homie.test', '--no-install']);
    mkdirSync(join(studio, 'node_modules/@homie-rocks'), { recursive: true });
    symlinkSync(PKG, join(studio, 'node_modules/@homie-rocks/studio'));
    mkdirSync(join(studio, 'node_modules/.bin'), { recursive: true });
    symlinkSync(wrangler, join(studio, 'node_modules/.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'));
    for (const name of ['esbuild', 'wrangler']) symlinkSync(join(REPO_NM, name), join(studio, 'node_modules', name));
    run(['game', 'new', 'coin-dash', '--from', 'coin-dash'], studio);
    // The game keeps a verified result for each player (room.records), in short rounds.
    const rules = join(studio, 'games/coin-dash/src/rules.ts'); let text = readFileSync(rules, 'utf8');
    for (const [from, to] of [
      ['  shared: {},', '  shared: { match: f.text(40) },'],
      ['    rounds: { seconds: 60, breakSeconds: 8 },', "    records: { key: 'server:history', identity: 'match', fields: { score: 'score' } },\n    rounds: { seconds: 8, breakSeconds: 3 },"],
      ['      roundStart(world) {', "      roundStart(world) { world.shared.match = 'm' + Math.floor(world.random() * 1e9) + ':' + world.round.n;"],
    ]) { assert.ok(text.includes(from), from); text = text.replace(from, to); }
    writeFileSync(rules, text);
    const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise((r) => probe.close(r));
    const origin = `http://localhost:${port}`; let log = '';
    dev = spawn(process.execPath, [cli, 'dev', '--port', String(port), '--no-local-ai'], { cwd: studio, detached: true, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1536' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [dev.stdout, dev.stderr]) stream.on('data', (chunk) => { log = (log + chunk).slice(-12000); });
    let ready = false;
    while (dev.exitCode === null && dev.signalCode === null) { ready = await fetch(`${origin}/coin-dash/play`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false); if (ready) break; await sleep(300); }
    assert.ok(ready, log);

    /** A fresh browser whose FIRST play page is rewritten as an older Worker would have written it. */
    const open = async (room, rewrite) => {
      const context = await browser.createBrowserContext(), page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const loads = []; page.on('framenavigated', (f) => { if (f === page.mainFrame()) loads.push(f.url()); });
      const cdp = await page.createCDPSession(); let first = true;
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/coin-dash/play*', resourceType: 'Document', requestStage: 'Response' }] });
      cdp.on('Fetch.requestPaused', async (e) => {
        try {
          if (!first || e.responseStatusCode !== 200) { await cdp.send('Fetch.continueRequest', { requestId: e.requestId }); return; }
          first = false;
          const got = await cdp.send('Fetch.getResponseBody', { requestId: e.requestId });
          const body = rewrite(got.base64Encoded ? Buffer.from(got.body, 'base64').toString('utf8') : got.body);
          await cdp.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 200, responseHeaders: e.responseHeaders.filter((h) => !/^(content-length|content-encoding|set-cookie)$/i.test(h.name)), body: Buffer.from(body).toString('base64') });
        } catch { /* the page went away */ }
      });
      await page.goto(`${origin}/coin-dash/play?room=${room}`, { waitUntil: 'domcontentloaded' });
      return { context, page, errors, loads };
    };
    const boot = (page) => page.evaluate(() => ({ sh: window.__HOMIE_PLAY.sh ?? null, ticket: Boolean(window.__HOMIE_PLAY.t), room: new URL(location.href).searchParams.get('room'), seat: window.__shell?.seat ?? null, connected: Boolean(window.__shell?.stats?.connected) }));
    const seated = async (page) => { for (let i = 0; i < 300; i += 1) { const b = await boot(page).catch(() => null); if (b && b.connected && typeof b.seat === 'number') return b; await sleep(200); } throw new Error('never seated: ' + JSON.stringify(await boot(page).catch(() => null)) + '\n' + log.slice(-1500)); };

    // 1. A page that says what it was made for, and is behind.
    {
      const made = /"sh":"([^"]+)"/.exec(await (await fetch(`${origin}/coin-dash/play?room=probe`)).text())?.[1];
      assert.ok(made, 'the play page says what it was made for');
      // The seat is kept by its token, which the page holds for its tab: seat first on a current page, then age the page in place.
      const context = await browser.createBrowserContext(), page = await context.newPage(); page.setDefaultTimeout(60_000);
      const loads = []; page.on('framenavigated', (f) => { if (f === page.mainFrame()) loads.push(f.url()); });
      await page.goto(`${origin}/coin-dash/play?room=behind`, { waitUntil: 'domcontentloaded' });
      const before = await seated(page);
      // The deploy: the page now holds an older key than the Worker would write, and its frame is asked for again.
      await page.evaluate(() => { window.__HOMIE_PLAY.sh = '0.40.0-old'; const frame = document.querySelector('iframe.game'); const u = new URL(frame.src); u.searchParams.set('sh', '0.40.0-old'); frame.src = u.href; });
      for (let i = 0; i < 150 && loads.length < 2; i += 1) await sleep(200);
      const after = await seated(page);
      await sleep(3000);
      assert.equal(loads.length, 2, 'one full reload, and only one: ' + loads.join(' '));
      assert.equal(after.sh, made, 'the page is the one the Worker writes now');
      assert.equal(after.room, 'behind', 'the same room'); assert.equal(after.seat, before.seat, 'the same seat');
      await context.close();
    }

    // 2. A page from before the handshake, with no player ticket, hosting a game that keeps results.
    {
      const old = await open('legacy', (html) => html.replace(/"sh":"[^"]*",?/, '').replace(/"t":"[^"]*",?/, ''));
      for (let i = 0; i < 200 && old.loads.length < 2; i += 1) await sleep(200);
      assert.match(old.loads[1] ?? '', /\/coin-dash\/play\?room=legacy$/, 'the old page was replaced in its private room: ' + old.loads.join(' '));
      const now = await seated(old.page);
      assert.equal(now.room, 'legacy', 'updating an old shell does not choose public quick play');
      // The new page keeps the named room: from here it must not load again.
      const settled = old.loads.length;
      assert.equal(now.ticket, true, 'the new page holds the player\'s ticket'); assert.ok(now.sh);
      // The next round's result is kept, with the player doing nothing.
      let kept = null;
      for (let i = 0; i < 150 && !kept; i += 1) { await sleep(400); kept = await old.page.evaluate(() => fetch('/api/player/saves/coin-dash/server%3Ahistory').then((r) => r.json()).then((j) => (j.value?.matches?.length ? j.value.matches : null)).catch(() => null)); }
      assert.ok(kept && kept.length >= 1, 'a finished round was recorded for the player of the page that had none: ' + JSON.stringify(kept));
      assert.equal(old.loads.length, settled, 'and the page was not loaded again: ' + old.loads.join(' '));
      assert.deepEqual(old.errors, []);
      await old.context.close();
    }
  } finally {
    await browser?.close().catch(() => {});
    await stop(dev);
    rmSync(scratch, { recursive: true, force: true });
  }
});
