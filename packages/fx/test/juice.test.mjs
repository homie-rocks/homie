// juice.js: four small feedback pieces, each tested for the mistake it exists to avoid.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Combo, HitStop, burstScale, kickImpulse } from '@homie-rocks/fx/juice.js';

const COMBO = {
  window: 2, perStep: 3, stepMult: 0.5, maxMult: 3,
  callouts: [{ at: 3, text: 'Nice' }, { at: 6, text: 'Great' }, { at: 10, text: 'Unstoppable' }],
};

test('combo: hits inside the window build a multiplier in steps, up to the ceiling', () => {
  const c = new Combo(COMBO);
  const mults = [];
  for (let i = 0; i < 20; i++) { mults.push(c.hit().multiplier); c.step(0.5); }
  assert.deepEqual(mults.slice(0, 7), [1, 1, 1.5, 1.5, 1.5, 2, 2]);
  assert.equal(mults[19], 3, 'capped');
  assert.equal(c.count, 20);
});

test('combo: a callout fires once, on the hit that reaches it, and never again that combo', () => {
  const c = new Combo(COMBO);
  const said = [];
  for (let i = 0; i < 12; i++) said.push(c.hit().callout);
  assert.deepEqual(said, [null, null, 'Nice', null, null, 'Great', null, null, null, 'Unstoppable', null, null]);
});

test('combo: several hits at once announce the highest threshold they crossed', () => {
  const c = new Combo(COMBO);
  c.hit(2);
  assert.equal(c.hit(5).callout, 'Great'); // 2 -> 7 passes 3 and 6
  assert.equal(c.hit(1).callout, null);
});

test('combo: it drops when the window runs out, reports what it reached, and starts again from one', () => {
  const c = new Combo(COMBO);
  c.hit(); c.hit(); c.hit(); c.hit();
  assert.equal(c.step(1.9), 0, 'still alive');
  assert.ok(Math.abs(c.timeLeft - 0.1) < 1e-9);
  c.hit(); // a hit restarts the window
  assert.equal(c.step(1.9), 0);
  assert.equal(c.step(0.2), 5, 'the frame it ends says how long it was');
  assert.equal(c.step(1), 0, 'and only that frame');
  assert.equal(c.multiplier, 1);
  assert.equal(c.best, 5);
  assert.equal(c.hit().count, 1);
  assert.equal(c.hit().callout, null);
  assert.equal(c.hit().callout, 'Nice', 'callouts are per combo');
});

test('combo: a pause (no time passing) holds it', () => {
  const c = new Combo(COMBO);
  c.hit();
  for (let i = 0; i < 1000; i++) assert.equal(c.step(0), 0);
  assert.equal(c.count, 1);
});

const STOP = { seconds: 0.06, maxSeconds: 0.15, scale: 0 };

test('hit-stop: the simulation loses exactly the length of the stop, at any frame rate', () => {
  for (const hz of [30, 60, 144]) {
    const h = new HitStop(STOP);
    h.hit(1);
    let real = 0, sim = 0;
    for (let i = 0; i < hz; i++) { real += 1 / hz; sim += h.step(1 / hz); }
    assert.ok(Math.abs((real - sim) - 0.06) < 1e-9, `${hz} Hz lost ${real - sim}`);
    assert.equal(h.stopped, false);
  }
});

test('hit-stop: a flurry of hits stops as long as the hardest one, not the sum', () => {
  const h = new HitStop(STOP);
  for (let i = 0; i < 50; i++) h.hit(1);
  assert.ok(Math.abs(h.remaining - 0.06) < 1e-12);
  h.hit(0.2);
  assert.ok(Math.abs(h.remaining - 0.06) < 1e-12, 'a weaker hit does not shorten it');
  h.hit(100);
  assert.equal(h.remaining, 0.15, 'and there is a ceiling');
});

test('hit-stop: with a scale it crawls instead of freezing', () => {
  const h = new HitStop({ ...STOP, scale: 0.1 });
  h.hit(1);
  assert.ok(Math.abs(h.step(0.02) - 0.002) < 1e-12);
  // 0.04 s of stop left in a 0.1 s frame: 0.04 at a tenth, 0.06 at full speed.
  assert.ok(Math.abs(h.step(0.1) - (0.004 + 0.06)) < 1e-12);
  assert.equal(h.step(0.016), 0.016);
});

test('kick: a hit far away kicks less, and no hit kicks past the ceiling', () => {
  const o = { gain: 2, max: 5, falloffM: 10 };
  assert.equal(kickImpulse(1, 0, o), 2);
  assert.equal(kickImpulse(1, 10, o), 1, 'half as hard at the falloff distance');
  assert.ok(kickImpulse(1, 40, o) < 0.15);
  assert.equal(kickImpulse(100, 0, o), 5);
});

test('burst: as authored up close, fewer and larger far away, nothing past the cull distance', () => {
  const o = { count: 48, size: 0.2, refM: 8, minCount: 4, maxGrow: 4, cullM: 90 };
  const out = { count: 0, size: 0 };
  assert.deepEqual({ ...burstScale(3, o, out) }, { count: 48, size: 0.2 });
  assert.deepEqual({ ...burstScale(8, o, out) }, { count: 48, size: 0.2 });
  burstScale(16, o, out);
  assert.equal(out.count, 12); assert.equal(out.size, 0.4);
  // The drawn area (count * size^2), which is the cost, never goes up with distance.
  const authored = 48 * 0.2 * 0.2;
  for (let d = 0; d <= 24; d += 0.5) {
    burstScale(d, o, out);
    assert.ok(out.count > o.minCount && out.count * out.size * out.size <= authored + 1e-9, `at ${d} m`);
  }
  burstScale(80, o, out);
  assert.equal(out.count, 4, 'never fewer than the floor while it is drawn');
  assert.equal(out.size, 0.8, 'and it stops growing');
  assert.equal(burstScale(91, o, out).count, 0);
});
