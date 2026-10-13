// Build contract cases, split into independent files for CI; shared fixtures in build-kit.mjs.
import { legacyGame } from './legacy-game.mjs';
import { browserRulesGame } from './browser-rules-game.mjs';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleOf, gameDigest, modelBudgetsOf, orderGames } from '../lib/build.mjs';
import { placeholderGlb } from '../lib/optimise.mjs';
import { previewServer } from '../lib/preview.mjs';
import { findChrome } from '../lib/chrome.mjs';
import { openStage, swapIn } from '../lib/stage.mjs';
import { basedOnCredit, basedOnRow, licenseLabel, licenseOf, retiredKeys } from '../worker/license.mjs';
import { creditsPage } from '../worker/site.mjs';
import { PKG, CLI, REPO_NM, scratch, run, plain, out, json, write, edit, editJson, studio, siteOf, snapshot } from './build-kit.mjs';

test('studio.json site.order is the order of every list; a Home of the studio\'s own takes the generated hero', async () => {
  const games = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const warned = [];
  assert.deepEqual(orderGames(games, ['c', 'nope', 'a', 'c'], (l) => warned.push(l)).map((g) => g.id), ['c', 'a', 'b', 'd'], 'named first, the rest by id');
  assert.match(warned.join('\n'), /site\.order names "nope", which is not one of this studio's games/);
  assert.deepEqual(orderGames(games, undefined).map((g) => g.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(orderGames(games, 'c').map((g) => g.id), ['a', 'b', 'c', 'd'], 'not a list: the order it always had');

  const dir = studio('order', ['glow', 'glow-two', 'zed']);
  // By id, the older game always came before the newer one.
  assert.deepEqual(out(run(['build'], dir)).catalogue, ['glow', 'glow-two', 'zed']);
  editJson(join(dir, 'studio.json'), (s) => { s.site = { ...(s.site ?? {}), order: ['glow-two', 'zed'] }; });
  assert.deepEqual(out(run(['build'], dir)).catalogue, ['glow-two', 'zed', 'glow']);
  const site = await siteOf(dir);
  const at = (html, id) => html.indexOf(`href="/${id}/"`);
  for (const path of ['/games/', '/']) {
    const html = await (await site(path)).text();
    assert.ok(at(html, 'glow-two') > 0 && at(html, 'glow-two') < at(html, 'zed') && at(html, 'zed') < at(html, 'glow'), `${path} lists the games in the studio's order`);
  }
  assert.deepEqual((await (await site('/.well-known/homie-studio.json')).json()).games.map((g) => g.id), ['glow-two', 'zed', 'glow']);
  assert.deepEqual((await (await site('/api/games')).json()).games.map((g) => g.id), ['glow-two', 'zed', 'glow']);
  const home = await (await site('/')).text();
  assert.match(home, /<h1 class="title[^"]*" id="hero-title">Game glow-two<\/h1>/, 'with no featured game, Home\'s hero follows the order');

  // A Home of the studio's own: the generated hero by a marker, for the featured game or the one it names.
  write(dir, 'site/pages/index.html', '<!doctype html><html><head><!-- homie:style --></head><body><!-- homie:header --><main><!-- homie:home-hero --><p id="mine">ours</p><!-- homie:home-hero zed --><!-- homie:home-hero nope --></main><!-- homie:footer --><!-- homie:script --></body></html>');
  assert.equal(run(['build'], dir).status, 0);
  const own = await (await (await siteOf(dir))('/')).text();
  const heroes = [...own.matchAll(/<section class="hero home" aria-labelledby="hero-title">[\s\S]*?<h1 class="title[^"]*" id="hero-title">([^<]+)<\/h1>[\s\S]*?href="\/([a-z-]+)\/play" data-play/g)].map((x) => [x[1], x[2]]);
  assert.deepEqual(heroes, [['Game glow-two', 'glow-two'], ['Game zed', 'zed']], 'the featured game\'s hero, then the named one; an unknown game leaves nothing');
  assert.match(own, /<p id="mine">ours<\/p>/);
  assert.doesNotMatch(own, /homie:home-hero/);
});

test('the build says which hero files a landing wants, and what shape', () => {
  const dir = studio('hero', ['alpha']);
  const said = plain(['build'], dir).stdout;
  assert.match(said, /^Landing \/alpha\/: hero from the studio's colours \(it has no picture or footage yet\)/m);
  assert.match(said, /give it one: games\/alpha\/hero\/wide\.jpg \(16:9, 1280×720 or larger\) and games\/alpha\/hero\/tall\.jpg \(9:16, 720×1280, for an upright phone\); footage beside them as hero\/wide\.mp4 and hero\/tall\.mp4/);
  // Those names are the ones the landing reads, and where the site serves them.
  write(dir, 'games/alpha/hero/wide.jpg', 'wide');
  write(dir, 'games/alpha/hero/tall.jpg', 'tall');
  write(dir, 'games/alpha/hero/wide.mp4', 'film');
  const again = plain(['build'], dir).stdout;
  assert.match(again, /^Landing \/alpha\/: hero from its footage/m);
  assert.doesNotMatch(again, /give it one/);
  assert.deepEqual(json(join(dir, 'site/dist/games.json')).games[0].landing.hero, { wide: '/games/alpha/_landing/wide.mp4', wideImage: '/games/alpha/_landing/wide.jpg', tallImage: '/games/alpha/_landing/tall.jpg' });
});

test('a game sets its own model budgets in game.json (assets.budgets), and createModels() reads them', async () => {
  const warned = [];
  const log = (l) => warned.push(l);
  assert.equal(modelBudgetsOf({ id: 'x' }, log), null);
  assert.equal(modelBudgetsOf({ id: 'x', assets: 'library' }, log), null, 'a starter\'s note is not a budget');
  assert.deepEqual(modelBudgetsOf({ id: 'x', assets: { budgets: { triangles: 8000, bytes: 1500000 } } }, log), { triangles: 8000, bytes: 1500000 });
  assert.deepEqual(warned, []);
  assert.deepEqual(modelBudgetsOf({ id: 'x', assets: { budgets: { triangles: 'many', bytes: 2048, kb: 5 } } }, log), { bytes: 2048 });
  assert.match(warned.join('\n'), /assets\.budgets\.triangles is a whole number above zero/);
  assert.match(warned.join('\n'), /assets\.budgets\.kb is not one of triangles, bytes, texturePx, materials/);

  // The runtime half: the same loader, bundled the way `build` bundles a game, with and without a game's budgets.
  const esbuild = await import('esbuild');
  const box = Buffer.from(await placeholderGlb([1, 2, 3]));   // twelve triangles
  const real = { fetch: globalThis.fetch, location: globalThis.location };
  test.after(() => { globalThis.fetch = real.fetch; globalThis.location = real.location; });
  globalThis.location = new URL('https://studio.test/games/x/');
  globalThis.fetch = async () => new Response(box, { headers: { 'content-length': String(box.length) } });
  const warningsWith = async (name, define) => {
    const file = join(scratch, `models-${name}.mjs`);
    await esbuild.build({ entryPoints: [join(PKG, 'assets', 'assets.ts')], bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], outfile: file, logLevel: 'silent', absWorkingDir: PKG, ...(define ? { define: { __HOMIE_MODEL_BUDGETS__: JSON.stringify(define) } } : {}) });
    const { createModels } = await import(pathToFileURL(file));
    const said = [];
    const model = await createModels({ dev: true, onWarn: (t) => said.push(t) }).load('./models/box.glb');
    assert.equal(model.triangles, 12);
    return said.join('\n');
  };
  assert.doesNotMatch(await warningsWith('default', null), /triangles|KB/, 'a box is inside the prop budget; no constant in the bundle is fine');
  const tight = await warningsWith('tight', { triangles: 5, bytes: 100 });
  assert.match(tight, /12 triangles \(its budget is 5\)/);
  assert.match(tight, /KB \(its budget is 1 KB\)/);
  assert.doesNotMatch(await warningsWith('roomy', { triangles: 8000, bytes: 1500000 }), /triangles|KB/);
  globalThis.fetch = real.fetch;
  globalThis.location = real.location;
});

test('shoot --preview: frames of the built game from the light preview server, no site running, named by the build\'s own hash and bundle', { skip: findChrome() ? false : 'no Chrome on this machine', timeout: 240_000 }, async () => {
  // ACROSS THE SEAM: the real build (its report and its hashed bundle), the real preview server, and shoot.
  const dir = studio('shoot-preview', ['alpha']);
  const { shoot } = await import('../lib/shoot.mjs');
  const frames = join(dir, '.studio', 'shoot', 'alpha');
  const none = await shoot({ preview: true, root: dir, game: 'alpha', frames: 3, out: frames });
  assert.equal(none.ok, false);
  assert.match(none.why, /no build of alpha in site\/dist/, 'nothing built: said as the preview says it');
  assert.equal(none.command, 'shoot');
  assert.equal(run(['build'], dir).status, 0);
  const built = join(dir, 'site', 'dist', 'games', 'alpha');
  const r = await shoot({ preview: true, root: dir, game: 'alpha', frames: 3, fps: 30, out: frames, timeoutMs: 200_000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.frames, 3);
  assert.match(r.play, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'the game\'s own page on this computer: no Wrangler, no play page');
  assert.deepEqual([r.smoke.verdict, r.smoke.ok], ['NOT RUN', null]);
  assert.match(r.smoke.why, /no rooms .*needs the whole site \(homie-studio dev, then --url\)/);
  assert.equal(r.ready.ready, null, 'no loading cover on this page: not claimed either way');
  // The frames are of THIS build: the hash the build reported, and the hashed bundle the page really loaded.
  assert.deepEqual(r.build, { hash: json(join(dir, 'site', 'dist', '_site', 'build.json')).games.alpha.hash, bundle: bundleOf(built), loaded: true });
  assert.equal(r.build.hash, gameDigest(built));
  assert.match(r.build.bundle, /^assets\/main-[A-Z0-9]+\.js$/);
  const rec = json(join(frames, 'shoot.json'));
  assert.equal(rec.rows.length, 3);
  for (const row of rec.rows) assert.ok(existsSync(join(frames, row.file)), row.file);
  for (let i = 1; i < rec.rows.length; i++) assert.ok(Math.abs((rec.rows[i].clockMs - rec.rows[i - 1].clockMs) - 1000 / 30) < 0.01, 'one step of the game\'s clock a frame');
  assert.equal(rec.rows[0].phase, 'live', 'the starter\'s port probe is read in the page itself (it is the game\'s frame here): alone, its round runs');
  // And the server it started is gone with it.
  await assert.rejects(fetch(r.play, { signal: AbortSignal.timeout(3000) }));
});

test('preview <id>: one built game\'s files and nothing else, across a rebuild', async () => {
  const dir = studio('preview', ['alpha']);
  const none = await previewServer(dir, 'alpha', { port: 0 });
  assert.equal(none.ok, false);
  assert.match(none.why, /no build of alpha in site\/dist: run .*homie-studio build alpha/);
  assert.equal((await previewServer(dir, '../x', { port: 0 })).ok, false);
  assert.equal(run(['build'], dir).status, 0);
  const p = await previewServer(dir, 'alpha', { port: 0 });
  assert.equal(p.ok, true, JSON.stringify(p.why));
  try {
    assert.match(p.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const built = join(dir, 'site', 'dist', 'games', 'alpha');
    const first = bundleOf(built);
    const page = await fetch(p.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    const html = await page.text();
    assert.ok(html.includes(`src="./${first}"`));
    assert.doesNotMatch(html, /HOMIE_NET/, 'the page as built: no room to join');
    const js = await fetch(new URL(first, p.url));
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /^text\/javascript/);
    assert.equal(await js.text(), readFileSync(join(built, first), 'utf8'));
    // Only that game's files: nothing above its folder, by any spelling.
    for (const path of ['/../../games.json', '/%2e%2e/%2e%2e/games.json', '/..%2f..%2fgames.json', '/nope.js']) {
      const res = await fetch(`${p.url.slice(0, -1)}${path}`);
      assert.equal(res.status, 404, path);
      await res.arrayBuffer();
    }
    assert.equal((await fetch(p.url, { method: 'POST' })).status, 405);
    // A build while it runs: the same server, the new game, no restart.
    edit(join(dir, 'games/alpha/src/main.ts'), (t) => `${t}\nconsole.log('rebuilt under a running preview');\n`);
    // Keep the preview event loop live while the separate build process works.
    await promisify(execFile)(process.execPath, [CLI, 'build', '--json'], { cwd: dir });
    const next = bundleOf(built);
    assert.notEqual(next, first);
    assert.ok((await (await fetch(p.url)).text()).includes(`src="./${next}"`));
    assert.match(await (await fetch(new URL(next, p.url))).text(), /rebuilt under a running preview/);
  } finally { p.server.closeAllConnections?.(); p.server.close(); }
});

