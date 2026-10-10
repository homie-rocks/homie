/** Real local app proof; also used by the ordinary suite. Scratch studio and Chrome profile are always removed. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { build as bundle } from 'esbuild';
import { newStudio } from '../lib/scaffold.mjs';
import { newApp } from '../lib/studio.mjs';
import { check } from '../lib/check.mjs';
import { lanAddresses } from '../lib/dev.mjs';
import { chromeArgs, findChrome } from '../lib/chrome.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(ROOT, 'packages/studio/bin/homie-studio.mjs');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export async function appProof({ wrangler, shots = null, log = () => {} }) {
  const scratch = mkdtempSync(join(tmpdir(), 'homie-app-proof-')); const studio = join(scratch, 'studio');
  let dev, browser; let serverLog = ''; const errors = [];
  const stop = async () => {
    if (!dev || dev.exitCode !== null || dev.signalCode !== null) return;
    const done = once(dev, 'exit'); try { process.kill(-dev.pid, 'SIGTERM'); } catch { dev.kill('SIGTERM'); }
    const timer = setTimeout(() => { try { process.kill(-dev.pid, 'SIGKILL'); } catch {} }, 5000);
    try { await done; } finally { clearTimeout(timer); }
  };
  try {
    newStudio(studio, { name: 'Welcome House', install: false });
    mkdirSync(join(studio, 'node_modules/.bin'), { recursive: true });
    for (const name of readdirSync(join(ROOT, 'node_modules'))) if (name !== '.bin' && name !== 'wrangler') symlinkSync(join(ROOT, 'node_modules', name), join(studio, 'node_modules', name));
    symlinkSync(wrangler, join(studio, 'node_modules/.bin/wrangler'));
    symlinkSync(dirname(dirname(wrangler)), join(studio, 'node_modules/wrangler'));
    await newApp(studio, 'welcome', { name: 'Welcome House' });
    // Public helper is bundled into a fixture page, tested on an actual insecure LAN origin.
    const publicDir = join(studio, 'site/public'); mkdirSync(publicDir, { recursive: true });
    const script = await bundle({ stdin: { contents: `import * as links from '${join(ROOT, 'packages/studio/links/links.mjs')}'; window.proofLinks = links;`, resolveDir: ROOT }, bundle: true, write: false, format: 'iife' });
    writeFileSync(join(publicDir, 'links.js'), script.outputFiles[0].text);
    writeFileSync(join(publicDir, 'links.html'), '<!doctype html><script src="/links.js"></script>');
    // dev builds this rules app with the strict compiler before starting Wrangler.
    // Do not build it twice: this proof is of app behavior, not cold-start speed.
    const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise((r) => socket.close(r));
    const ip = lanAddresses()[0]; assert.ok(ip, 'a LAN IPv4 address is available');
    const origin = `http://${ip}:${port}`, local = `http://localhost:${port}`;
    const start = async () => {
      dev = spawn(process.execPath, [CLI, 'dev', '--lan', '--no-local-ai', '--port', String(port)], { cwd: studio, detached: true, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1536' }, stdio: ['ignore', 'pipe', 'pipe'] });
      for (const stream of [dev.stdout, dev.stderr]) stream.on('data', (b) => { serverLog = (serverLog + b).slice(-18000); });
      const end = Date.now() + 300000;
      while (Date.now() < end && dev.exitCode === null && dev.signalCode === null) {
        if (await fetch(`${origin}/api/games`, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok).catch(() => false)) return;
        await pause(200);
      }
      throw new Error('LAN dev failed: ' + serverLog);
    };
    await start(); log('dev --lan reached from its network address');
    const sql = (text) => { const r = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'DB', '--local', '--command', text], { cwd: studio, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } }); assert.equal(r.status, 0, r.stderr); };
    const checked = await check({ url: origin, game: 'welcome', log }); assert.equal(checked.ok, true, checked.why);
    sql('DELETE FROM app_records;');
    browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, userDataDir: join(scratch, 'chrome'), args: chromeArgs(), timeout: 150000 });
    const surface = async (name, width, height) => { const context = await browser.createBrowserContext(); const page = await context.newPage(); await page.setViewport({ width, height, isMobile: name.startsWith('phone'), hasTouch: name !== 'wall' }); page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`)); return { name, context, page }; };
    const wall = await surface('wall', 1600, 900), phone = await surface('phone', 390, 844), phone2 = await surface('phone-two', 390, 844), staff = await surface('staff-tablet', 1024, 768);
    // A real WebAuthn ceremony in Chrome at localhost. HTTP LAN cannot run passkeys.
    const cdp = await staff.page.createCDPSession(); await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await staff.page.goto(`${local}/account/`); await staff.page.waitForSelector('[data-view="out"]:not([hidden])');
    await staff.page.click('[data-make]');
    await staff.page.waitForSelector('[data-view="in"]:not([hidden])', { timeout: 30000 });
    const who = await staff.page.evaluate(async () => (await (await fetch('/api/player/me')).json()));
    const person = who.player ?? who.me; assert.ok(person?.id, JSON.stringify(who));
    const cookie = (await staff.context.cookies()).find((c) => c.name === 'studio_player'); assert.ok(cookie);
    // Same local account on the second local hostname, explicitly copied only by this test harness.
    await staff.context.setCookie({ name: cookie.name, value: cookie.value, domain: ip, path: '/', httpOnly: true, sameSite: 'Lax' });
    const owner = randomBytes(32).toString('hex'); sql(`INSERT INTO stats_keys (hash,kind,expires_at) VALUES ('${createHash('sha256').update(owner).digest('hex')}','session',${Date.now()+3600000});`);
    const grant = async (body) => fetch(`${origin}/welcome/api/app/roles`, { method: 'POST', headers: { origin, cookie: `studio_owner=${owner}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const roleRes = await grant({ role: 'staff', player: person.id }); assert.equal(roleRes.status, 200); const privateLink = (await roleRes.json()).link;
    assert.equal((await fetch(privateLink, { redirect: 'manual' })).status, 302, 'a link alone requires sign-in');
    assert.equal((await fetch(`${origin}/welcome/open?role=staff`)).status, 404, 'staff has no guessable entrance');
    const room = 'welcome-proof';
    const open = async (s, url) => { await s.page.goto(url, { waitUntil: 'domcontentloaded' }); await s.page.waitForFunction(() => window.__shell?.link?.state === 'online', { timeout: 60000 }); s.frame = s.page.frames().find((f) => /\/__game\//.test(f.url())); assert.ok(s.frame); await s.frame.waitForSelector('[data-count]'); };
    await open(wall, `${origin}/welcome/tv?room=${room}`);
    assert.match(await wall.page.$eval('[data-join]', (e) => e.textContent), /Scan to join/);
    const qrLink = await wall.page.$eval('[data-join] span', (e) => 'http://' + e.textContent); assert.equal(new URL(qrLink).hostname, ip); assert.equal(new URL(qrLink).searchParams.get('room'), room);
    await open(phone, qrLink); await open(phone2, qrLink); await open(staff, privateLink + `&room=${room}`);
    for (const s of [phone, phone2]) { await s.frame.waitForFunction(() => !document.querySelector('[data-join]').disabled); await s.frame.tap('[data-join]'); await s.frame.waitForFunction(() => document.querySelector('[data-join]').hidden); }
    for (const s of [wall, phone, phone2, staff]) await s.frame.waitForFunction(() => document.querySelector('[data-count]').textContent === '2');
    await staff.frame.tap('[data-next]');
    for (const s of [wall, phone, phone2, staff]) await s.frame.waitForFunction(() => document.querySelector('[data-count]').textContent === '1');
    await phone.frame.waitForFunction(() => document.querySelector('#detail').textContent.includes('your turn'));
    assert.ok(!(await phone2.frame.$eval('#detail', (e) => e.textContent)).includes('your turn'));
    const ticketUrl = phone.page.url(); assert.ok(new URL(ticketUrl).searchParams.get('ticket'));
    await open(phone, ticketUrl); await phone.frame.waitForFunction(() => document.querySelector('#detail').textContent.includes('your turn'));
    assert.equal((await fetch(`${origin}/welcome/api/app/records/queue/forged?role=staff`, { method: 'PUT', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ data: { label: 'fake', status: 'called' }, version: 1 }) })).status, 404);
    // Browser helper exercise on LAN HTTP, with randomUUID actually unavailable.
    const linksPage = await browser.newPage(); await linksPage.goto(`${origin}/links.html`);
    const links = await linksPage.evaluate(() => { const h = window.proofLinks; const id = h.randomId(); const url = h.appLink('/welcome/open', { ticket: id, room: 'welcome-proof' }); const svg = h.qrSvg(url, { title: 'Ticket' }); document.body.innerHTML = svg; return { id, url, svg: svg.startsWith('<svg'), secure: isSecureContext, uuid: typeof crypto.randomUUID }; });
    assert.equal(links.secure, false); assert.equal(links.uuid, 'undefined'); assert.match(links.id, /^[a-f0-9]{32}$/); assert.equal(links.svg, true); assert.equal(new URL(links.url).hostname, ip);
    await linksPage.goto(links.url); assert.equal(new URL(linksPage.url()).searchParams.get('ticket'), links.id); await linksPage.close();
    for (const s of [wall, phone, phone2, staff]) await s.frame.waitForFunction(() => document.querySelector('#connection').textContent.includes('live'));
    const watch = await browser.newPage(); await watch.goto(`${origin}/welcome/watch?room=welcome-proof`);
    await watch.waitForFunction(() => document.querySelector('iframe')?.src.includes('/__game/'));
    const watchFrame = watch.frames().find((f) => /\/__game\//.test(f.url())); assert.ok(watchFrame);
    await watchFrame.waitForFunction(() => document.querySelector('[data-count]')?.textContent === '1');
    assert.equal(new URL(watchFrame.url()).searchParams.get('role'), 'wall'); await watch.close();
    if (shots) { mkdirSync(shots, { recursive: true }); for (const s of [wall, phone, phone2, staff]) await s.page.screenshot({ path: join(shots, `${s.name}.jpg`), type: 'jpeg', quality: 68 }); }
    assert.equal((await grant({ role: 'staff', player: person.id, revoke: true })).status, 200);
    const refused = await staff.page.evaluate(async () => { const p = new URL(location.href); p.pathname = '/welcome/api/app/records/queue'; return (await fetch(p)).status; }); assert.equal(refused, 403, 'open tablet loses access immediately');
    await browser.close(); browser = null; await stop(); await start();
    const lasting = await (await fetch(`${origin}/welcome/api/app/records/queue?room=after-restart`)).json(); assert.equal(lasting.records.length, 2); assert.equal(lasting.records.filter((r) => r.data.status === 'called').length, 1);
    assert.deepEqual(errors, []);
    const receipt = { ok: true, check: checked, surfaces: ['wall', 'phone', 'phone-two', 'staff-tablet'], lan: true, qrTargetOpened: true, watchRecords: true, physicalCameraScan: false, plainHttpIds: true, passkey: 'Chrome virtual authenticator at localhost; test harness copied its session to LAN hostname', grantAndRevocation: true, persistedAcrossServerRestart: true, pageErrors: errors };
    if (shots) writeFileSync(join(shots, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
  } finally { await browser?.close().catch(() => {}); await stop(); rmSync(scratch, { recursive: true, force: true }); }
}
