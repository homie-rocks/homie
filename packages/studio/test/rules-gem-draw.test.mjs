/** Run the shipped canvas view with an explicitly stale rAF timestamp. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { PKG, esbuildOf } from './rules-kit.mjs';

test('Gem Rush paints effects delivered after the animation frame timestamp', async () => {
  const esbuild = await esbuildOf();
  const source = readFileSync(join(PKG, 'starters/gem-rush/src/view.ts'), 'utf8').replace(/^import .*;\n/gm, '');
  const { code } = await esbuild.transform(source, { loader: 'ts', format: 'iife' });
  const handlers = {}, radii = [];
  let frame, now = 1000, delivered = false;
  const noop = () => {};
  const ctx = new Proxy({
    createRadialGradient: () => ({ addColorStop: noop }),
    arc: (_x, _y, radius) => { assert.ok(Number.isFinite(radius) && radius >= 0, `invalid radius ${radius}`); radii.push(radius); },
  }, { get: (o, key) => o[key] ?? noop });
  const net = { on: noop, now: () => now, viewSeat: null, slots: [], role: 'replica', link: 'online' };
  const room = { net, tune: { knockRange: 3.4, ringMs: 300 }, seat: null,
    input() { if (!delivered) { delivered = true; handlers.wave({ id: 'r', at: { x: 8, y: 8 } }); } },
    get: () => ({ id: 'r', kind: 'runner', seat: 0 }), each: noop, shared: {},
    on: (name, fn) => { handlers[name] = fn; }, probe: noop,
  };
  runInNewContext(code, {
    openRoom: () => room, guardGestures: noop, PALETTE: ['white'], AI_MARK: 'bot',
    createLabels: () => ({ place: () => [] }), createBubbles: () => ({ size: 0 }),
    lab: { camera: () => () => null, overlay: noop, draw: noop, time: { dt: () => .016 }, on: false },
    document: { getElementById: () => ({ getContext: () => ctx, addEventListener: noop }) },
    addEventListener: noop, requestAnimationFrame: fn => { frame = fn; },
    performance: { now: () => now }, devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
    location: { search: '' }, window: {}, URLSearchParams,
  });
  frame(500); // The queued effect is delivered during updateView at time 1000.
  assert.equal(delivered, true);
  assert.ok(radii.includes(22), 'the new wave starts at the avatar radius');
  now += 150;
  frame(516);
  assert.ok(radii.some(r => r > 22), 'the wave expands on the paint clock despite stale rAF timestamps');
});
