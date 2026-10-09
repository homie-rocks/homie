/** The five starters at the player address in real Chrome, as a page of its own and in a cross-origin sandboxed frame.
 * No request leaves this computer: the allowed HTTPS parent (x.com) is answered here, everything else is refused.
 * Needs CHROME_PATH (real Chrome) and Wrangler (installed in the toolkit, or WRANGLER_PATH naming an installed
 * wrangler/bin/wrangler.js); without either it skips. Local bindings only, no account, no credentials.
 * Screenshots go to EMBED_SHOTS or a temporary folder.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import puppeteer from 'puppeteer-core';
import { chromeArgs } from '../lib/chrome.mjs';
import { build } from '../lib/build.mjs';
import { newGame } from '../lib/studio.mjs';
import { studioFiles } from '../lib/scaffold.mjs';
import { PLAYER_SANDBOX } from '../worker/embed.mjs';
import { REPO_NM } from './rules-kit.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ids = ['gem-rush', 'coin-dash', 'gem-rush-3d', 'hero-rush-3d', 'ember-vale'];
// A post is about 516 px wide on X's website and 358 px on a phone; the card's player is square (worker/embed.mjs
// PLAYER_SIZE). 358×201 is a 16:9 host at a phone's width: the shortest frame the shell and the starters must fit.
const scenarios = [
  { framed: true, width: 358, height: 201, touch: true, blocked: true },
  { framed: true, width: 516, height: 516 },
  { width: 390, height: 844, touch: true, insets: true },
  { width: 1280, height: 720, reload: true },
];

test('Chrome: every starter plays at the player address, as its own page and framed by a post', { timeout: 600000 }, async t => {
  if (!process.env.CHROME_PATH) { t.skip('Set CHROME_PATH to run the starters at the player address in real Chrome.'); return; }
  const wrangler = process.env.WRANGLER_PATH || join(REPO_NM, 'wrangler', 'bin', 'wrangler.js');
  if (!existsSync(wrangler)) { t.skip('Local Wrangler executable is absent; install Wrangler (or set WRANGLER_PATH) to run the starters at the player address.'); return; }
  // Launch first: a machine that cannot start the Chrome it named says so before five games are built.
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true,
    // The window is as large as the largest page below: headless Chrome stops routing clicks into a cross-origin frame
    // beyond its real window once another tab has been opened and closed, whatever viewport is emulated.
    args: [...chromeArgs(), '--window-size=1300,1200', '--autoplay-policy=document-user-activation-required', '--test-third-party-cookie-phaseout',
      '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'] });
  // The real path: macOS's temporary folder is a symlink, and the build's rules guard refuses a linked module by path.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-player-chrome-')));
  const shots = process.env.EMBED_SHOTS || join(root, 'shots'); mkdirSync(shots, { recursive: true });
  let child, output = '';
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, 'exit');
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    const force = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 5000);
    try { await ended; } finally { clearTimeout(force); child.stdout.destroy(); child.stderr.destroy(); }
  };
  try {
    for (const [path, body] of Object.entries(studioFiles({ name: 'Player Test', slug: 'player-test', homie: null }))) {
      mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body);
    }
    mkdirSync(join(root, 'node_modules/@homie-rocks'), { recursive: true });
    for (const name of readdirSync(REPO_NM)) {
      if (name !== '@homie-rocks' && name !== '.bin') symlinkSync(join(REPO_NM, name), join(root, 'node_modules', name));
    }
    for (const name of readdirSync(join(REPO_NM, '@homie-rocks'))) symlinkSync(join(REPO_NM, '@homie-rocks', name), join(root, 'node_modules/@homie-rocks', name));
    for (const id of ids) {
      const result = await newGame(root, id, { from: id });
      if (result.models) assert.equal(result.models.missing.length, 0, 'the 3D starters need their real textured models, not stand-ins');
    }
    // A shop with one item, so the shell's shop is the real one; no payment provider and no checkout credentials.
    writeFileSync(join(root, 'shop.json'), JSON.stringify({ till: 'stripe', currency: 'usd', items: [{ id: 'supporter', kind: 'supporter', name: 'Supporter', price: 500, days: 365, gives: ['badge:supporter'], badge: 'Supporter' }] }));
    await build(root, { log: () => {} });
    // The build's esbuild is a child process of this one, and can hold it open for minutes after the test: stop it.
    await createRequire(join(root, 'package.json'))('esbuild').stop();
    writeFileSync(join(root, '.dev.vars'), 'STRIPE_KEY=rk_test_' + 'a'.repeat(32) + '\nSTRIPE_WEBHOOK_SECRET=whsec_' + 'b'.repeat(32) + '\n');
    const config = join(root, 'wrangler.jsonc');
    const env = { PATH: process.env.PATH, HOME: root, TMPDIR: tmpdir(), NODE_OPTIONS: '--max-old-space-size=1536', WRANGLER_SEND_METRICS: 'false', CI: '1' };
    const migrate = spawnSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', config], { cwd: root, env, encoding: 'utf8' });
    assert.equal(migrate.status, 0, migrate.stdout + migrate.stderr);
    const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(r => probe.close(r));
    child = spawn(process.execPath, [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--config', config], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 300; i++) {
      // The answer is read to its end: an unread body would hold this process open long after the test.
      try { const answer = await fetch(`${base}/${ids[0]}/play/embed`); await answer.arrayBuffer(); if (answer.ok) { ready = true; break; } } catch {}
      if (child.exitCode !== null) break; await sleep(200);
    }
    assert.ok(ready, output);

    /** One page with everything a run must not do recorded in `errors`, and the parent post answered locally. */
    const openPage = async ({ id, framed, width, height, touch, blocked, lobbyDown, signedIn }) => {
      const page = await browser.newPage(); page.setDefaultTimeout(15000);
      const errors = [];
      page.on('console', m => { if (m.type() === 'error' && !(lobbyDown ? /BLOCKED_BY_CLIENT|ERR_FAILED/ : /BLOCKED_BY_CLIENT/).test(m.text())) errors.push(m.text()); });
      page.on('pageerror', e => errors.push(e.message));
      page.on('requestfailed', r => { if (!/BLOCKED_BY_CLIENT/.test(r.failure().errorText) && !(lobbyDown && new URL(r.url()).pathname.endsWith('/api/lobby'))) errors.push(r.url() + ': ' + r.failure().errorText); });
      page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`); });
      await page.setViewport({ width: framed ? 1100 : width, height: framed ? 1040 : height, isMobile: !!touch, hasTouch: !!touch });
      const cdp = await page.createCDPSession();
      // Third-party cookies refused by Chrome itself; the game's own frame is an opaque origin with no storage at all.
      await cdp.send('Network.enable');
      await cdp.send('Network.setCookieControls', { enableThirdPartyCookieRestriction: true, disableThirdPartyCookieMetadata: true, disableThirdPartyCookieHeuristics: true }).catch(() => {});
      // An in-app browser that refuses site data: every storage getter and the cookie accessor throw.
      if (blocked) await page.evaluateOnNewDocument(() => {
        for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new DOMException('Blocked', 'SecurityError'); } });
        Object.defineProperty(document, 'cookie', { get() { throw new DOMException('Blocked', 'SecurityError'); }, set() { throw new DOMException('Blocked', 'SecurityError'); } });
      });
      // Chrome's touch emulation stops at the page: a cross-origin frame inside it still reports a mouse. A phone's
      // answers to the two questions the shell and the touch kit ask are given to every frame, so a framed game
      // draws its touch controls and is driven by touches, as it is on a phone.
      if (touch) await page.evaluateOnNewDocument(() => {
        const real = window.matchMedia.bind(window);
        window.matchMedia = q => (/pointer:\s*coarse/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : real(q));
        Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 });
      });
      await page.evaluateOnNewDocument(() => {
        window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ': ' + e.blockedURI));
      });
      await page.setRequestInterception(true);
      page.on('request', r => {
        const u = new URL(r.url());
        if (u.pathname.endsWith('/api/shop/buy')) errors.push('a checkout request was made inside the player');
        if (lobbyDown && u.pathname.endsWith('/api/lobby')) return r.abort('failed');
        // A signed-in player, answered here at the saves call: the Account button's way out is exercised without credentials.
        if (signedIn && u.pathname === `/api/player/saves/${id}` && r.method() === 'GET') return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, player: { id: 'test-account', guest: false, name: 'Player' }, keys: [] }) });
        if (u.hostname === 'x.com') return r.respond({ status: 200, contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>body{margin:0}iframe{width:${width}px;height:${height}px;border:0;display:block}</style>${[0, 1].map(() => `<iframe scrolling="no" allow="autoplay; fullscreen; web-share" allowfullscreen sandbox="${PLAYER_SANDBOX}" src="${base}/${id}/play/embed"></iframe>`).join('')}` });
        if (u.hostname === '127.0.0.1' || ['data:', 'blob:'].includes(u.protocol)) return r.continue();
        return r.abort('blockedbyclient'); // Nothing leaves this computer (a starter's web font among it).
      });
      return { page, cdp, errors };
    };
    /** The shell and game frames of the page, once every game has a seat. */
    const seated = async (page, id, count) => {
      let shells = [], games = [];
      for (let i = 0; i < 100; i++) {
        shells = page.frames().filter(f => { try { return new URL(f.url()).pathname === `/${id}/play/embed`; } catch { return false; } });
        games = page.frames().filter(f => f.url().includes('/__game/'));
        if (games.length === count) break; await sleep(150);
      }
      assert.equal(games.length, count, 'the game frame loads');
      for (const game of games) await game.waitForFunction(() => Number.isInteger(window.__homieNet?.seat) && window.__homieNet?.connected);
      return { shells, games };
    };
    const who = game => game.evaluate(() => ({ seat: window.__homieNet.seat, name: window.HOMIE_NET.name, room: window.HOMIE_NET.room }));
    /** Does the player's own body move? Two directions each way: a new guest may take over a body standing at a wall. */
    const moves = async (page, game, touch) => {
      const at = () => game.evaluate(() => window.__homieNet.probe.self());
      const far = (a, b) => a && b && Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)) > .1;
      const box = await (await game.$('canvas')).boundingBox();
      // Resizing the content for the shop can move the game's own buttons. Start on exposed canvas.
      const point = await game.evaluate(() => {
        for (const [x,y] of [[.35,.65],[.5,.45],[.35,.35],[.6,.55]]) {
          const px = innerWidth*x, py = innerHeight*y;
          if (document.elementFromPoint(px,py)?.tagName === 'CANVAS') return {x:px,y:py};
        }
        return {x:innerWidth*.35,y:innerHeight*.65};
      });
      const x = box.x + point.x, y = box.y + point.y;
      const start = await at();
      if (!touch) await page.mouse.click(x, y);
      for (const [key, dx, dy] of [['KeyD', 60, -25], ['KeyA', -60, 25], ['KeyS', 20, 50], ['KeyW', -20, -50]]) {
        if (touch) { await page.touchscreen.touchStart(x, y); await page.touchscreen.touchMove(x + dx, y + dy); await sleep(700); await page.touchscreen.touchEnd(); }
        else { await page.keyboard.down(key); await sleep(700); await page.keyboard.up(key); }
        await sleep(150);
        if (far(start, await at())) return true;
      }
      return false;
    };
    /** Back on the post's tab after another one closed: in front, and drawn again, before the next press. Until this
     *  tab has drawn a frame Chrome sends a press over a cross-origin frame to the page around it. */
    const back = async (page, shell) => {
      await page.bringToFront();
      for (const f of [page.mainFrame(), shell]) await f.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    };
    const box = (frame, selector) => frame.$(selector).then(el => el && el.boundingBox());
    /** The open room sheet: inside the screen's safe area, below the button that opened it, with the way out in view. */
    const sheetFits = async (page, shell, safe, label) => {
      const sheet = await box(shell, '[data-share-sheet]'), pill = await box(shell, '[data-share-toggle]'), exit = await box(shell, '[data-studio-open]');
      assert.ok(sheet.x >= safe.left && sheet.y >= safe.top && sheet.x + sheet.width <= safe.right + .5 && sheet.y + sheet.height <= safe.bottom + .5, `${label}: the room sheet ${JSON.stringify(sheet)} stays inside the safe area ${JSON.stringify(safe)}`);
      assert.ok(sheet.y >= pill.y + pill.height, `${label}: the room sheet opens below its button`);
      assert.ok(exit.height >= 44 && exit.y >= sheet.y && exit.y + exit.height <= sheet.y + sheet.height + .5, `${label}: the way out is in view when the sheet opens, without a scroll`);
      const state = await shell.$eval('[data-share-sheet]', el => ({ scrolls: el.scrollHeight > el.clientHeight + 4, more: el.classList.contains('more'), overflow: getComputedStyle(el).overflowY }));
      assert.equal(state.overflow, 'auto'); assert.equal(state.more, state.scrolls, `${label}: a sheet with more below says so`);
    };

    for (const id of ids) {
      for (const scenario of scenarios) {
        const { framed, width, height, touch } = scenario;
        const label = `${id}-${framed ? 'frame' : 'top'}-${width}x${height}`;
        const { page, cdp, errors } = await openPage({ id, ...scenario, signedIn: id === 'ember-vale' && width === 516 });
        // A phone's notch and home bar (an iPhone's numbers): the page says where they are through env(safe-area-inset-*).
        let safe = { left: 0, top: 0, right: framed ? width : width, bottom: framed ? height : height }, insets = false;
        if (scenario.insets) {
          try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34, left: 0, right: 0 } }); insets = true; safe = { left: 0, top: 59, right: width, bottom: height - 34 }; }
          catch { t.diagnostic('This Chrome cannot emulate safe-area insets; the sheet is checked against the whole screen.'); }
        }
        await page.goto(framed ? 'https://x.com/test/status/1' : `${base}/${id}/play/embed`);
        const { shells, games } = await seated(page, id, framed ? 2 : 1);
        const players = await Promise.all(games.map(who));
        players.forEach(p => { assert.match(p.name, /^Guest /, label); assert.match(p.room, /^pub-[1-9][0-9]*$/, label); });
        if (framed) {
          // Two posts of one game on a page: one room, two players.
          assert.equal(players[0].room, players[1].room, label); assert.notEqual(players[0].seat, players[1].seat, label); assert.notEqual(players[0].name, players[1].name, label);
        }
        const shell = shells[0], game = games[0];
        assert.equal(await shell.evaluate(() => document.documentElement.className), framed ? 'player-frame' : 'player-top');
        await game.evaluate(() => {
          window.__sound = new AudioContext(); const oscillator = window.__sound.createOscillator();
          const gain = window.__sound.createGain(); gain.gain.value = 0; oscillator.connect(gain).connect(window.__sound.destination); oscillator.start();
          window.__sound.resume(); // Asked once, at startup: the first press must be what starts it.
        });
        assert.equal(await game.evaluate(() => window.__sound.state), 'suspended', label);
        // Nothing the game draws as a control is off its frame or under the shell's own buttons (Ember Vale's new-hero card).
        const pills = await box(shell, '[data-room-ui] .pills');
        const frameBox = await (await game.frameElement()).boundingBox();
        for (const control of await game.$$('button,a,[role=button],input')) {
          const r = await control.boundingBox(); if (!r || !r.width || !r.height) continue;
          const text = await control.evaluate(e => (e.textContent || e.placeholder || e.id).trim());
          assert.ok(r.x >= frameBox.x - 1 && r.y >= frameBox.y - 1 && r.x + r.width <= frameBox.x + frameBox.width + 1 && r.y + r.height <= frameBox.y + frameBox.height + 1, `${label}: "${text}" is inside the game's frame`);
          if (await control.evaluate(e => !!e.closest('.panel'))) assert.ok(r.y >= pills.y + pills.height || r.x + r.width <= pills.x || r.x >= pills.x + pills.width, `${label}: "${text}" is clear of the shell's buttons`);
        }
        // Ember Vale starts from its own card: through the button a person presses.
        if (id === 'ember-vale') for (const b of await game.$$('button')) if (/Into the vale/i.test(await b.evaluate(e => e.textContent)) && await b.boundingBox()) await b.click();
        await game.waitForFunction(() => window.__homieNet?.probe?.self?.());
        const moved = await moves(page, game, touch);
        if (!moved) await page.screenshot({ path: join(shots, label + '-movement-failure.png') });
        assert.ok(moved, `${label}: the player's own body moves`);
        await game.waitForFunction(() => window.__sound.state === 'running');
        for (const f of [shell, game]) {
          assert.deepEqual(await f.evaluate(() => window.__csp), [], label);
          assert.ok(await f.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), `${label}: nothing scrolls`);
        }
        await page.screenshot({ path: join(shots, label + '.png') });

        const shopControl = await box(shell, '[data-shop-control]');
        assert.ok(shopControl && shopControl.height >= 44 && shopControl.y + shopControl.height <= frameBox.y, label + ': Shop reserves space above content');
        await shell.click('[data-shop-control]');
        await shell.waitForSelector('.shopsheet');
        await shell.click('.shopsheet button[aria-label=Close]');

        // The closed shell: the way out is not drawn over the game, and the room button says there is one.
        assert.equal(await shell.$eval('[data-studio-open]', e => e.getBoundingClientRect().height), 0, 'the way out is in the closed sheet, never over the game');
        assert.match(await shell.$eval('[data-share-toggle]', e => e.getAttribute('aria-label') + ' ' + e.textContent), /studio’s site.*Site/, label);
        await shell.click('[data-share-toggle]');
        await sheetFits(page, shell, safe, label);
        // Words written for a frame are for a frame only.
        const frameWords = await shell.$$eval('.frame-only', els => els.map(e => e.getClientRects().length > 0));
        assert.ok(frameWords.length >= 2 && frameWords.every(shown => shown === !!framed), `${label}: frame-only wording ${framed ? 'shows' : 'is hidden'}`);
        await page.screenshot({ path: join(shots, label + '-sheet.png') });
        for (const control of await shell.$$('[data-share-sheet] a, [data-share-sheet] button')) {
          if (!await control.evaluate(e => e.getClientRects().length > 0)) continue;
          await control.evaluate(e => e.scrollIntoView({ block: 'nearest' }));
          assert.ok(await control.evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), `${label}: every row of the sheet can be reached`);
          const text = (await control.evaluate(e => e.textContent)).trim();
          if (await control.evaluate(e => e.matches('a') || e.matches('[data-who-act]'))) {
            if (!framed) continue; // As a page of its own these navigate this tab: checked once, below.
            // In a frame every link leaves through a new top-level tab: the frame itself never goes to a page that refuses framing.
            const opened = browser.waitForTarget(target => target.opener() === page.target(), { timeout: 8000 }).catch(() => null);
            await control.click(); const target = await opened;
            assert.ok(target, `${label}: "${text}" opens a tab of its own`);
            const popup = await target.page();
            await popup.waitForFunction(() => location.href !== 'about:blank');
            assert.equal(await popup.evaluate(() => window.top === window), true, text);
            // Signing in comes back to Play, never to the guests-only player.
            const next = new URL(popup.url()).searchParams.get('next');
            if (next !== null) assert.match(next, new RegExp(`^/${id}/play\\?room=pub-`), `${label}: "${text}" comes back to Play`);
            await popup.close(); await back(page, shell);
            assert.equal(new URL(shell.url()).pathname, `/${id}/play/embed`, `${label}: the frame stays on the player after "${text}"`);
          } else if (/Copy link|Invite/.test(text)) await control.click();
        }
        // The shop: never a purchase here, a link to the studio's shop instead.
        await shell.evaluate(() => document.querySelector('[data-shop-open]').click());
        const buy = await shell.waitForSelector('.shopsheet a.buy');
        const shopWords = await shell.$eval('.shopsheet', e => e.textContent);
        assert.equal(/outside this post/.test(shopWords), !!framed, `${label}: the shop's words fit where it is shown`);
        if (framed) {
          const opened = browser.waitForTarget(target => target.opener() === page.target(), { timeout: 8000 });
          await buy.click(); await (await (await opened).page()).close(); await back(page, shell);
        }
        await shell.click('.shopsheet button[aria-label=Close]');

        if (scenario.insets && insets) {
          // The same phone on its side: sensor housing left and right, home bar below. The seat is kept through the turn.
          await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 21, left: 59, right: 59 } });
          await page.setViewport({ width: height, height: width, isMobile: true, hasTouch: true });
          await sleep(400);
          if (await shell.$eval('[data-share-sheet]', e => e.hidden)) await shell.click('[data-share-toggle]');
          await sheetFits(page, shell, { left: 59, top: 0, right: height - 59, bottom: width - 21 }, label + '-landscape');
          await page.screenshot({ path: join(shots, label + '-landscape-sheet.png') });
          assert.equal((await who(game)).seat, players[0].seat, `${label}: turning the phone keeps the seat`);
        }
        if (scenario.reload) {
          // A reload of the player's own page comes back to the same room, seat and name.
          await page.reload();
          const again = await seated(page, id, 1);
          assert.deepEqual(await who(again.games[0]), players[0], `${label}: a reload keeps the room, the seat and the name`);
        }
        assert.deepEqual(errors, [], label);
        await page.close();
      }
    }

    // As a page of its own a link navigates this tab (no popup), and Back comes back to the player.
    {
      const { page, errors } = await openPage({ id: 'gem-rush', width: 390, height: 844, touch: true });
      await page.goto(`${base}/gem-rush/play/embed`);
      const { shells } = await seated(page, 'gem-rush', 1);
      await shells[0].click('[data-share-toggle]');
      await Promise.all([page.waitForNavigation(), shells[0].click('[data-studio-open]')]);
      assert.match(page.url(), /\/gem-rush\/play\?room=pub-/);
      assert.equal((await browser.pages()).filter(p => p.url().includes('/gem-rush/')).length, 1, 'no second tab');
      assert.deepEqual(errors, []); await page.close();
    }
    // The lobby does not answer: the player falls back to the room Play falls back to, and plays.
    {
      const { page, errors } = await openPage({ id: 'gem-rush', width: 390, height: 844, touch: true, lobbyDown: true });
      await page.goto(`${base}/gem-rush/play/embed`);
      const { games } = await seated(page, 'gem-rush', 1);
      assert.equal((await who(games[0])).room, 'main');
      assert.ok(await moves(page, games[0], true), 'plays in the fallback room');
      assert.deepEqual(errors, []); await page.close();
    }
    // A host that grants less fails in words, and never navigates the frame to a page that refuses framing.
    for (const [sandbox, message] of [
      ['allow-same-origin allow-scripts', 'blocked opening a tab'],
      ['allow-popups allow-popups-to-escape-sandbox allow-scripts', 'prevents the game from connecting'],
    ]) {
      const page = await browser.newPage(); page.setDefaultTimeout(15000);
      await page.setRequestInterception(true);
      page.on('request', r => new URL(r.url()).hostname === 'x.com'
        ? r.respond({ status: 200, contentType: 'text/html', body: `<iframe style="width:516px;height:516px" sandbox="${sandbox}" src="${base}/gem-rush/play/embed"></iframe>` }) : r.continue());
      await page.goto('https://x.com/test/status/2');
      let shell;
      for (let i = 0; i < 100; i++) { shell = page.frames().find(f => f.url().includes('/play/embed')); if (shell) break; await sleep(100); }
      assert.ok(shell);
      if (sandbox.includes('allow-same-origin')) {
        await shell.waitForFunction(() => Number.isInteger(window.__shell?.seat));
        await shell.click('[data-share-toggle]'); await shell.click('[data-studio-open]');
      }
      await shell.waitForFunction(text => { const n = document.querySelector('[data-embed-note]'); return n && !n.hidden && n.textContent.includes(text); }, {}, message);
      assert.ok(shell.url().includes('/play/embed')); await page.close();
    }
    t.diagnostic(`Starter screenshots: ${shots}`);
  } finally {
    await stop();
    await browser.close(); rmSync(root, { recursive: true, force: true });
  }
});
