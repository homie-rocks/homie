// Real preview server and Chrome capture contracts, independently scheduled in CI.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { bundleOf, gameDigest } from '../lib/build.mjs';
import { previewServer } from '../lib/preview.mjs';
import { findChrome } from '../lib/chrome.mjs';
import { CLI, run, json, edit, studio } from './build-kit.mjs';

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

