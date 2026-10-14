/** Fresh packed customer installs, including text checks and real Chrome captures. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpServer } from './card-host.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(ROOT, 'packages/studio/bin/homie-studio.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'homie-first-run-proof-'));
const shots = resolve(process.env.HOMIE_FIRST_RUN_SHOTS ?? join(scratch, 'captures'));
const run = (args, cwd, label) => {
 const r = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8', timeout: 300000, maxBuffer: 20e6, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
 if (label) writeFileSync(label, r.stdout + r.stderr);
 assert.equal(r.status, 0, `${args.join(' ')}\n${r.stdout}\n${r.stderr}`); return r.stdout;
};
let blocker, dev, browser, server;
try {
 mkdirSync(shots, { recursive: true });
 const pack = JSON.parse(run(['npm', 'pack', '--json', '--pack-destination', scratch], join(ROOT, 'packages/studio')))[0];
 const tar = join(scratch, pack.filename);
 blocker = createServer(socket => { socket.on('error', () => {}); socket.end(); });
 await new Promise((ok, bad) => { blocker.once('error', e => e.code === 'EADDRINUSE' ? ok() : bad(e)); blocker.listen(8787, '127.0.0.1', ok); });
 server = mcpServer(process.execPath, [CLI, 'mcp', '--studios', scratch, '--no-install'], { cwd: ROOT });
 await server.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Grok Bot', version: '1' } });
 for (const [folder, name, kind, starter] of [['cafe', 'Lantern Mug Quiz', 'business', 'quiz'], ['volunteer', 'Clover Commons', 'cause', 'gathering'], ['food-bank', 'Second Street Pantry', 'cause', 'giving'], ['bike-shop', 'Switchback Services', 'business', 'jobs']]) {
  const out = join(shots, folder); mkdirSync(out, { recursive: true });
  const made = (await server.request('tools/call', { name: 'studio_scaffold', arguments: { name, folder, kind } })).result;
  assert.ok(!made.isError, JSON.stringify(made));
  const root = join(scratch, folder);
  run([process.execPath, CLI, 'app', 'new', 'live', '--from', starter, '--name', name], root, join(out, 'app-new.txt'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'))); pkg.devDependencies['@homie-rocks/studio'] = tar;
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2)); // only substitutes this release's tarball for the unpublished npm version
  if (starter === 'giving') run([process.execPath, CLI, 'shop', 'init', '--giving', '--currency', 'cad'], root);
  if (starter === 'jobs') writeFileSync(join(root, 'shop.json'), JSON.stringify({ till: 'stripe', currency: 'cad', items: ['Safety check', 'Tune-up', 'Full service'].map((name, i) => ({ id: `service-${i}`, kind: 'service', name, price: [2500, 7500, 12500][i] })) }));
  run(['npm', 'install', '--no-fund'], root, join(out, 'install.txt'));
  run(['npm', 'run', 'build', '--', '--types'], root, join(out, 'build.txt'));
  let logs = ''; dev = spawn('npm', ['run', 'dev', '--', '--no-local-ai'], { cwd: root, detached: true, stdio: ['ignore','pipe','pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  for (const stream of [dev.stdout, dev.stderr]) stream.on('data', c => { logs += c; });
  let port;
  for (let i = 0; i < 240; i++) {
   try { port = JSON.parse(readFileSync(join(root, '.wrangler/homie-dev.json'))).port; } catch {}
   if (port && await fetch(`http://127.0.0.1:${port}/games.json`).then(r => r.ok).catch(() => false)) break;
   if (dev.exitCode !== null) throw new Error(logs);
   await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(port && Number(port) !== 8787, logs);
  const origin = `http://127.0.0.1:${port}`;
  const text = run(['npx', '--no-install', 'homie-studio', 'check', 'live', '--url', origin, '--shots', out], root, join(out, 'check.txt'));
  assert.match(text, /PASS: app/); assert.doesNotMatch(text, /undefined|NaN/);
  const receipt = JSON.parse(readFileSync(join(root, '.studio/checks/latest.json'))); assert.equal(receipt.kind, 'app'); assert.equal(receipt.ok, true);
  if (starter === 'jobs' || starter === 'giving') {
   const { default: puppeteer } = await import('puppeteer-core'); const { findChrome, chromeArgs } = await import('../lib/chrome.mjs');
   browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: chromeArgs() });
   const page = await browser.newPage(); await page.setViewport({ width: 1100, height: 900 });
   await page.goto(origin + '/shop/', { waitUntil: 'networkidle0' });
   assert.match(await page.$eval('body', e => e.textContent), /PREVIEW/);
   assert.equal(await page.$$eval('.item', e => e.length), starter === 'jobs' ? 3 : 6);
   await page.screenshot({ path: join(out, 'shop.png'), fullPage: true });
   await browser.close(); browser = null;
  }
  writeFileSync(join(out, 'dev.txt'), logs);
  writeFileSync(join(out, 'commands.txt'), `studio_scaffold ${JSON.stringify({ name, folder, kind })}\nhomie-studio app new live --from ${starter} --name ${JSON.stringify(name)}\n# @homie-rocks/studio points at npm pack from this checkout\nnpm install --no-fund\nnpm run build -- --types\nnpm run dev -- --no-local-ai\nCHROME_PATH=${JSON.stringify(process.env.CHROME_PATH ?? '')} npx --no-install homie-studio check live --url ${origin} --shots ${out}\n`);
  const done = once(dev, 'exit'); process.kill(-dev.pid, 'SIGTERM'); await done; dev = null;
  rmSync(root, { recursive: true, force: true });
  console.log(`${folder}: strict fresh install/build/dev/text check passed; ${out}`);
 }
} finally {
 await browser?.close(); await server?.close();
 if (dev && dev.exitCode === null) { const done = once(dev, 'exit'); process.kill(-dev.pid, 'SIGTERM'); await done; }
 if (blocker?.listening) await new Promise(r => blocker.close(r));
 rmSync(scratch, { recursive: true, force: true });
}
