// dynres.js and tiers.js. The controller is a state machine over frame times, so every
// claim here is made by scripting a series of frame times (usually from a model of a
// device: so many milliseconds of work that does not depend on pixels, plus so many that
// do) and reading the scale it lands on. No renderer, no browser, no clock.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DynamicResolution, bufferSize, drawAtScale } from '@homie-rocks/render/dynres.js';
import { GAME_TIERS, TIER_NAMES, extendTiers, tierBelow, tierName, tierPixelRatio, tierPropCount } from '@homie-rocks/render/tiers.js';
import { Quality } from '@homie-rocks/render/quality.js';

const SPEC = {
  floor: 0.6, ceiling: 1, step: 0.85,
  slowMs: 20, fastMs: 17.5, smoothMs: 150, hitchMs: 250,
  holdMs: 2000, recoverMs: 500,
  settleMs: 200, trialMs: 1000, helpedMs: 1.5, lockoutMs: 10000,
  regretMs: 4000, backoffMax: 8,
};

/** Run `ms` of frames whose length is `model(scale)`. Returns each move as { at, kind, scale }. */
function run(dr, ms, model, log = [], clock = { t: 0 }) {
  const end = clock.t + ms;
  while (clock.t < end) {
    const dt = model(dr.scale, clock.t);
    clock.t += dt;
    if (dr.frame(dt)) log.push({ at: clock.t, kind: dr.lastMove, scale: dr.scale });
  }
  return log;
}

test('dynres: a steady sixty frames a second never moves the scale', () => {
  const dr = new DynamicResolution(SPEC);
  assert.deepEqual(run(dr, 20000, () => 16.7), []);
  assert.equal(dr.scale, 1);
  assert.equal(dr.take(), null);
});

test('dynres: a slow spell shorter than the hold costs no sharpness', () => {
  const dr = new DynamicResolution(SPEC);
  const clock = { t: 0 };
  const log = run(dr, 3000, () => 16.7, [], clock);
  run(dr, 1500, () => 26, log, clock); // a second and a half of trouble
  run(dr, 5000, () => 16.7, log, clock);
  assert.deepEqual(log, []);
});

test('dynres: bound by pixels, it drops after two seconds and keeps the drop', () => {
  const dr = new DynamicResolution(SPEC);
  // 10 ms that pixels do not change, 12 ms that scale with the pixel count.
  const log = run(dr, 12000, (s) => 10 + 12 * s * s);
  assert.equal(log.length, 1, JSON.stringify(log));
  assert.equal(log[0].kind, 'drop');
  assert.ok(log[0].at >= 2000 && log[0].at < 2300, `the drop waited out the hold: ${log[0].at}`);
  assert.ok(Math.abs(dr.scale - 0.85) < 1e-12);
  assert.equal(dr.onTrial, false);
  assert.deepEqual(dr.moves, { drop: 1, recover: 0, revert: 0 });
});

test('dynres: when dropping did not help, the drop is taken back and not retried for the lockout', () => {
  const dr = new DynamicResolution(SPEC);
  const log = run(dr, 12000, () => 24); // bound by something pixels do not touch
  assert.deepEqual(log.map((m) => m.kind), ['drop', 'revert']);
  assert.equal(log[1].scale, 1, 'back at full sharpness');
  const trial = log[1].at - log[0].at;
  assert.ok(trial >= 1200 && trial < 1300, `judged after the settle and the trial: ${trial}`);
  // Twelve seconds in, the lockout (ten from the revert) is still running: no second drop.
  assert.equal(dr.moves.drop, 1);
  // Once it has run out the question may be asked again, and gets the same answer.
  run(dr, 6000, () => 24, log, { t: 12000 });
  assert.deepEqual(log.map((m) => m.kind), ['drop', 'revert', 'drop', 'revert']);
  assert.ok(log[2].at - log[1].at >= 10000);
});

test('dynres: it recovers much faster than it drops', () => {
  const dr = new DynamicResolution(SPEC);
  const clock = { t: 0 };
  const log = run(dr, 6000, (s) => 10 + 12 * s * s, [], clock);
  assert.equal(dr.scale, 0.85);
  const loadGone = clock.t;
  run(dr, 3000, (s) => 4 + 12 * s * s, log, clock); // the scene got lighter
  const back = log.find((m) => m.kind === 'recover');
  assert.ok(back, 'it recovered');
  assert.ok(back.at - loadGone < 1000, `within a second of the load going: ${back.at - loadGone}`);
  assert.equal(dr.scale, 1);
});

test('dynres: it stops at the floor however slow the frame is', () => {
  const dr = new DynamicResolution(SPEC);
  const log = run(dr, 60000, (s) => 5 + 120 * s * s);
  assert.equal(dr.scale, 0.6);
  assert.ok(log.every((m) => m.scale >= 0.6 && m.kind === 'drop'), JSON.stringify(log));
  assert.equal(log.length, 4, '1 -> 0.85 -> 0.72 -> 0.61 -> the floor');
});

test('dynres: a device that cannot hold the higher scale is asked less and less often', () => {
  const dr = new DynamicResolution(SPEC);
  // Slow at full scale, comfortably fast one step down: the case that makes a naive
  // controller swing between the two for ever.
  const log = run(dr, 120000, (s) => (s > 0.9 ? 22 : 15));
  const recoveries = log.filter((m) => m.kind === 'recover').map((m) => m.at);
  const drops = log.filter((m) => m.kind === 'drop').map((m) => m.at);
  // How long it sat at the lower scale before each recovery.
  const waits = recoveries.map((at) => at - Math.max(...drops.filter((d) => d < at)));
  assert.ok(waits.length >= 4, `it kept trying: ${waits.length}`);
  assert.ok(waits[1] > waits[0] + 400 && waits[2] > waits[1] + 900 && waits[3] > waits[2] + 1900, `each wait is longer, by double the step before: ${waits.map(Math.round)}`);
  assert.ok(Math.max(...waits) <= SPEC.settleMs + SPEC.trialMs + SPEC.recoverMs * SPEC.backoffMax + 200, 'and the wait has a ceiling');
  assert.equal(dr.moves.revert, 0, 'every one of those drops did help');
});

test('dynres: a hitch is not load', () => {
  const dr = new DynamicResolution(SPEC);
  const log = run(dr, 30000, (_s, t) => (Math.floor(t / 16.7) % 3 === 0 ? 900 : 16.7));
  assert.deepEqual(log, []);
  assert.ok(dr.smoothedMs < 17, 'and it never entered the average');
});

test('dynres: the resize happens immediately before the draw, once per change', () => {
  const dr = new DynamicResolution(SPEC);
  const calls = [];
  const frame = (dt) => {
    dr.frame(dt);
    drawAtScale(dr, (s) => calls.push(`resize ${s.toFixed(2)}`), () => calls.push('draw'));
  };
  for (let t = 0; t < 2500; t += 22) frame(22);
  const at = calls.findIndex((c) => c.startsWith('resize'));
  assert.ok(at > 0, 'a resize happened');
  assert.equal(calls[at], 'resize 0.85');
  assert.equal(calls[at + 1], 'draw', 'with the draw directly after it');
  assert.equal(calls.filter((c) => c.startsWith('resize')).length, 1);
  assert.equal(dr.take(), null, 'a change is handed out once');
});

test('dynres: a scale set by hand is clamped, pending, and ends a trial', () => {
  const dr = new DynamicResolution(SPEC);
  run(dr, 2400, () => 24);
  assert.equal(dr.onTrial, true);
  dr.reset(0.2);
  assert.equal(dr.scale, 0.6);
  assert.equal(dr.onTrial, false);
  assert.equal(dr.take(), 0.6);
});

test('dynres: a spec that cannot work is refused at construction', () => {
  assert.throws(() => new DynamicResolution({ ...SPEC, floor: 0 }), RangeError);
  assert.throws(() => new DynamicResolution({ ...SPEC, step: 1 }), RangeError);
  assert.throws(() => new DynamicResolution({ ...SPEC, fastMs: 21 }), RangeError);
});

test('dynres: buffer sizes are whole and even', () => {
  const out = { width: 0, height: 0 };
  for (const scale of [1, 0.85, 0.7225, 0.6]) {
    bufferSize(393, 852, 3, scale, out);
    assert.equal(out.width % 2, 0); assert.equal(out.height % 2, 0);
  }
  assert.deepEqual(bufferSize(1920, 1080, 1, 1, out), { width: 1920, height: 1080 });
  assert.deepEqual(bufferSize(0, 0, 1, 1, out), { width: 2, height: 2 });
});

test('tiers: three rows, each cheaper than the one above in every column', () => {
  assert.deepEqual(TIER_NAMES, ['high', 'medium', 'low']);
  for (const key of Object.keys(GAME_TIERS.high)) {
    assert.ok(GAME_TIERS.high[key] >= GAME_TIERS.medium[key] && GAME_TIERS.medium[key] >= GAME_TIERS.low[key], key);
  }
});

test('tiers: a game adds its own columns and overrides shipped ones without touching the table', () => {
  const mine = extendTiers({
    high: { grassBlades: 40000, drawDistance: 300 },
    medium: { grassBlades: 15000, drawDistance: 200 },
    low: { grassBlades: 0, drawDistance: 120 },
  });
  assert.equal(mine.low.grassBlades, 0);
  assert.equal(mine.high.drawDistance, 300);
  assert.equal(mine.medium.msaa, GAME_TIERS.medium.msaa);
  assert.equal(GAME_TIERS.high.drawDistance, 160, 'the shipped table is unchanged');
});

test('tiers: the tier for a detected quality, the pixel ratio and the prop count', () => {
  assert.equal(tierName(Quality.Ultra), 'high');
  assert.equal(tierName(Quality.High), 'high');
  assert.equal(tierName(Quality.Medium), 'medium');
  assert.equal(tierName(Quality.Low), 'low');
  assert.equal(tierBelow('high'), 'medium'); assert.equal(tierBelow('low'), 'low');
  // A 3x phone on Medium: capped at 1.5, and the dynamic scale still bites under the cap.
  assert.equal(tierPixelRatio(GAME_TIERS.medium, 3, 1), 1.5);
  assert.ok(Math.abs(tierPixelRatio(GAME_TIERS.medium, 3, 0.8) - 1.2) < 1e-12);
  assert.equal(tierPixelRatio(GAME_TIERS.high, 1, 1), 1);
  assert.equal(tierPropCount(GAME_TIERS.low, 1000), 350);
  assert.equal(tierPropCount(GAME_TIERS.low, 1), 1);
  assert.equal(tierPropCount(GAME_TIERS.low, 0), 0);
});
