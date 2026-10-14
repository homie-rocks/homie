// Landing asset guidance and model budgets, independently scheduled in CI.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { modelBudgetsOf } from '../lib/build.mjs';
import { placeholderGlb } from '../lib/optimise.mjs';
import { PKG, scratch, plain, json, write, studio } from './build-kit.mjs';

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

