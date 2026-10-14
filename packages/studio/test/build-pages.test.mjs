// Page ordering and custom home heroes across real builds.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { orderGames } from '../lib/build.mjs';
import { run, out, write, editJson, studio, siteOf } from './build-kit.mjs';

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

