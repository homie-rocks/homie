/**
 * @homie-rocks/studio 0.18.1: a flat world on every screen (port/view.ts), as both starters use it.
 *
 *   - fitView: the whole world where it fits at a size that reads (a computer, a TV); on a phone held upright it fills
 *     the screen (no empty band above or below) and follows the player, never past the world's edge but for the HUD's
 *     margins; a following camera is never so far out that a band shows beside the world; `whole` is an overview;
 *   - createLabels: names that crowd round one spot never cover each other; the player's own is placed first and never
 *     covered or faded; a name with no room fades out (and goes at once if it would touch another); names keep off
 *     other bodies and the game's own boxes when they can, stay on screen, and do not flicker between two spots;
 *   - the starters: both draw through these, and Ember Vale's ask panel stands clear above STRIKE on a touch screen.
 * Run: node --test packages/studio/test/view.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-view-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

let mod = null;
async function view() {
  if (mod) return mod;
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  await esbuild.build({ entryPoints: [join(PKG, 'port', 'view.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: join(scratch, 'view.mjs'), logLevel: 'silent' });
  mod = await import(join(scratch, 'view.mjs'));
  return mod;
}

const WORLD = { w: 1600, h: 1000 };
const SCREENS = { upright: { w: 390, h: 844 }, sideways: { w: 844, h: 390 }, computer: { w: 1280, h: 720 }, tv: { w: 1920, h: 1080 } };
/** The world's rectangle on screen under a camera. */
const onScreen = (fit, s) => ({ left: s.w / 2 - fit.x * fit.scale, top: s.h / 2 - fit.y * fit.scale, right: s.w / 2 + (WORLD.w - fit.x) * fit.scale, bottom: s.h / 2 + (WORLD.h - fit.y) * fit.scale });

test('fitView: the whole world on a computer and a TV; on a phone it fills the screen and follows the player', async () => {
  const { fitView, toScreen, easeView } = await view();
  const READABLE = 0.62;
  for (const name of ['computer', 'tv']) {
    const s = SCREENS[name];
    const fit = fitView({ world: WORLD, screen: s, readable: READABLE, focus: { x: 100, y: 100 } });
    assert.equal(fit.follow, false, `${name}: the whole world fits at a size that reads`);
    assert.equal(fit.scale, Math.min(s.w / WORLD.w, s.h / WORLD.h));
    assert.deepEqual([fit.x, fit.y], [800, 500], `${name}: centred, whoever the player is`);
  }
  // Held upright, "fit" drew the world 390 x 244 in the middle of an 844-tall screen: now it fills the screen.
  const up = SCREENS.upright;
  const fit = fitView({ world: WORLD, screen: up, readable: READABLE, focus: { x: 800, y: 500 } });
  assert.equal(fit.follow, true);
  assert.ok(Math.abs(fit.scale - 844 / 1000) < 1e-9, 'as close as fills the screen\'s height');
  const r = onScreen(fit, up);
  assert.ok(r.top <= 0 && r.bottom >= up.h && r.left <= 0 && r.right >= up.w, `the world covers the whole screen: ${JSON.stringify(r)}`);
  assert.deepEqual(toScreen(fit, up, 800, 500), { x: 195, y: 422 }, 'the player in the middle');
  // At a corner the camera stops at the world's edge (no empty band), but for what keeps the player clear of the HUD.
  const corner = fitView({ world: WORLD, screen: up, readable: READABLE, focus: { x: 20, y: 20 }, inset: { top: 124, bottom: 100 } });
  const c = onScreen(corner, up);
  assert.ok(Math.abs(c.left) < 1e-9, 'the left edge of the world at the left edge of the screen');
  assert.ok(Math.abs(toScreen(corner, up, 20, 20).y - 124) < 1e-6, 'the player just clear of the HUD\'s 124 px');
  assert.ok(c.top > 0 && c.top < 124, `the world's top slid down only that far (${c.top.toFixed(1)} px)`);
  const far = fitView({ world: WORLD, screen: up, readable: READABLE, focus: { x: 1590, y: 990 }, inset: { top: 124, bottom: 100 } });
  const low = onScreen(far, up);
  assert.ok(Math.abs(low.right - up.w) < 1e-6 && Math.abs(toScreen(far, up, 1590, 990).y - (up.h - 100)) < 1e-6, 'and at the far corner, clear of STRIKE');
  // Away from the edges the margins change nothing: the world fills the screen, with no band above or below.
  const mid = onScreen(fitView({ world: WORLD, screen: up, readable: READABLE, focus: { x: 600, y: 415 }, inset: { top: 124, bottom: 100 } }), up);
  assert.ok(mid.top <= 1e-9 && mid.bottom >= up.h - 1e-9, `no empty band: ${JSON.stringify(mid)}`);
  // On its side: closer than "fit" (0.39), as the game asks (a zoom), and still never a band beside the world.
  const side = fitView({ world: WORLD, screen: SCREENS.sideways, readable: READABLE, zoom: 390 / 560, focus: { x: 800, y: 500 } });
  assert.ok(side.follow && Math.abs(side.scale - 390 / 560) < 1e-9);
  // A zoom that would show past the world is raised to what fills the screen.
  const wide = fitView({ world: WORLD, screen: up, readable: 0, zoom: 0.3, focus: { x: 800, y: 500 } });
  assert.ok(wide.follow && Math.abs(wide.scale - 0.844) < 1e-9, 'readable 0: always follows, never further out than the screen allows');
  // An overview (a watcher following nobody) is the whole world, even on a phone.
  const all = fitView({ world: WORLD, screen: up, readable: READABLE, whole: true });
  assert.equal(all.follow, false);
  assert.equal(all.scale, 390 / 1600);
  // Easing goes the whole way in time, and a first frame is the target itself.
  let cam = easeView(null, fit, 0.016);
  assert.deepEqual(cam, fit);
  for (let i = 0; i < 120; i++) cam = easeView(cam, corner, 1 / 60);
  assert.ok(Math.abs(cam.x - corner.x) < 0.01 && Math.abs(cam.y - corner.y) < 0.01);
});

/** Six names round one spot (bodies 30 px apart), as a party crowds round its guides. */
function crowd(selfIndex = 2) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const x = 195 + ((i % 3) - 1) * 30; const y = 420 + Math.floor(i / 3) * 30;
    out.push({ key: i, text: `Name ${i}`, x, y: y - 30, w: 110, h: 18, below: y + 22 + 18, body: { left: x - 20, top: y - 28, right: x + 20, bottom: y + 18 }, self: i === selfIndex, rank: i });
  }
  return out;
}
const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test('createLabels: crowded names never cover each other, your own stays readable, the rest move or fade', async () => {
  const { createLabels } = await view();
  const screen = () => ({ w: 390, h: 844 });
  const labels = createLabels({ screen });
  let out = [];
  for (let f = 0; f < 90; f++) out = labels.place(crowd(), 1 / 60);
  const shown = out.filter((l) => l.alpha > 0);
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) assert.ok(!hit(shown[i], shown[j]), `"${shown[i].text}" and "${shown[j].text}" overlap`);
  const mine = out.find((l) => l.self);
  assert.equal(mine.alpha, 1, 'your own name never fades');
  assert.equal(mine.moved, false, 'and sits in its own spot');
  assert.ok(out.every((l) => l.self || !hit(l, mine) || l.alpha === 0), 'nothing covers it');
  assert.ok(shown.length >= 4, `most names still show (${shown.length} of 6), moved off their spots`);
  assert.ok(out.some((l) => l.moved && l.alpha > 0), 'some moved (a row up, or under their body)');
  assert.ok(out.some((l) => l.alpha === 0), 'and one with no room left has faded out');
  assert.ok(shown.every((l) => l.left >= 0 && l.right <= 390 && l.top >= 0 && l.bottom <= 844), 'all on screen');
  // The order the game passes them in does not matter: your own and rank decide.
  const again = createLabels({ screen });
  let rev = [];
  for (let f = 0; f < 90; f++) rev = again.place(crowd().reverse(), 1 / 60);
  assert.deepEqual(rev.filter((l) => l.alpha > 0).map((l) => l.key).sort(), shown.map((l) => l.key).sort());
});

test('createLabels: as a crowd jostles, no two names that show ever touch (fading ones included), in any frame', async () => {
  const { createLabels } = await view();
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const labels = createLabels({ screen: () => ({ w: 390, h: 844 }) });
  const at = Array.from({ length: 8 }, (_, i) => ({ x: 195 + ((i % 4) - 1.5) * 26, y: 420 + Math.floor(i / 4) * 34 }));
  let worst = 0;
  for (let f = 0; f < 600; f++) {
    for (const p of at) { p.x += (rnd() - 0.5) * 10; p.y += (rnd() - 0.5) * 10; p.x = Math.max(120, Math.min(270, p.x)); p.y = Math.max(360, Math.min(520, p.y)); }
    const out = labels.place(at.map((p, i) => ({ key: i, text: `Guide ${i} · AI`, x: p.x, y: p.y - 30, w: 96, h: 18, below: p.y + 40, body: { left: p.x - 20, top: p.y - 28, right: p.x + 20, bottom: p.y + 18 }, self: i === 0, rank: i })), 1 / 60);
    const shown = out.filter((l) => l.alpha > 0);
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) if (hit(shown[i], shown[j])) worst += 1;
    assert.equal(out.find((l) => l.self).alpha, 1);
  }
  assert.equal(worst, 0, 'two names that show touched');
});

test('createLabels: other bodies and the game\'s boxes are kept clear when they can be; no flicker; off-screen spots unused', async () => {
  const { createLabels } = await view();
  // Two bodies, one right above the other: the lower one's name would sit on the upper body, so it goes under its own.
  const a = { key: 'a', text: 'Upper', x: 200, y: 370, w: 60, h: 18, below: 440, body: { left: 180, top: 372, right: 220, bottom: 420 } };
  const b = { key: 'b', text: 'Lower', x: 200, y: 418, w: 60, h: 18, below: 490, body: { left: 180, top: 420, right: 220, bottom: 470 } };
  const labels = createLabels({ screen: () => ({ w: 400, h: 800 }) });
  let out = labels.place([a, b], 1);
  const lower = out.find((l) => l.key === 'b');
  assert.ok(!hit(lower, a.body), 'kept off the other body');
  assert.equal(lower.bottom, 490, 'under its own body');
  // A box the game asks for (a speech bubble) is kept clear.
  const bubble = { left: 150, top: 330, right: 250, bottom: 372 };
  out = createLabels({ screen: () => ({ w: 400, h: 800 }), avoid: () => [bubble] }).place([a], 1);
  assert.ok(!hit(out[0], bubble), 'kept off the bubble');
  // Hysteresis: once moved, a name goes home only with room to spare, not the moment its home is barely free.
  const c = { key: 'c', text: 'Mover', x: 200, y: 300, w: 80, h: 18 };
  const blocker = (top) => ({ key: 'z', text: 'Block', x: 200, y: top + 18, w: 80, h: 18, rank: -1 });
  const sticky = createLabels({ screen: () => ({ w: 400, h: 800 }) });
  out = sticky.place([c, blocker(290)], 1);
  assert.equal(out.find((l) => l.key === 'c').moved, true, 'blocked at home: moved');
  out = sticky.place([c, blocker(262)], 1); // home free by 3 px only
  assert.equal(out.find((l) => l.key === 'c').moved, true, 'stays moved while home is barely free');
  out = sticky.place([c, blocker(240)], 1);
  assert.equal(out.find((l) => l.key === 'c').moved, false, 'home again with room to spare');
  // A spot off the top of the screen is not a spot: a name at the top edge goes under its body.
  out = createLabels({ screen: () => ({ w: 400, h: 800 }) }).place([{ key: 't', text: 'Top', x: 200, y: 10, w: 40, h: 18, below: 70 }], 1);
  assert.ok(out[0].top >= 0 && out[0].bottom === 70);
  // Sideways a name is kept on screen.
  out = createLabels({ screen: () => ({ w: 400, h: 800 }) }).place([{ key: 'e', text: 'Edge', x: 5, y: 300, w: 80, h: 18 }], 1);
  assert.ok(out[0].left >= 0);
});

test('the starters draw through it, and Ember Vale\'s ask panel stands clear above STRIKE on a touch screen', () => {
  for (const g of ['ember-vale', 'gem-rush']) {
    const src = readFileSync(join(PKG, 'starters', g, 'src', g === 'gem-rush' ? 'view.ts' : 'main.ts'), 'utf8');
    assert.match(src, /fitView\(/, `${g} frames its world with fitView`);
    assert.match(src, /createLabels\(/, `${g} places its names with createLabels`);
    assert.match(src, /labels: \(\) =>/, `${g} lets the probe see its names (boxes only)`);
  }
  const html = readFileSync(join(PKG, 'starters', 'ember-vale', 'index.html'), 'utf8');
  const rule = html.match(/\.touch \.asks \{([^}]*)\}/)?.[1] ?? '';
  const bottom = Number(rule.match(/bottom: calc\((\d+)px/)?.[1]);
  const touch = readFileSync(join(PKG, 'port', 'touch.ts'), 'utf8');
  // The touch kit's first button: 68 px across (never under 56), 24 px up from the bottom.
  assert.match(touch, /size: Math\.max\(56, b\.size \?\? 68\), right: b\.right \?\? 18, bottom: b\.bottom \?\? 24 \+ i \* 84/);
  assert.ok(bottom >= 24 + 68 + 8, `the panel's foot (${bottom} px up) is at least 8 px above STRIKE's top (92 px up)`);
  assert.match(html, /id="asks"[^>]*data-touch-pass/, 'a touch on the panel never starts the stick');
  assert.match(readFileSync(join(PKG, 'starters', 'ember-vale', 'src', 'main.ts'), 'utf8'), /classList\.toggle\('touch', input\.touch\.enabled\)/);
});
