// SoundLimiter.js: a minimum gap per sound and voice caps, on the caller's clock.
import assert from 'node:assert/strict';
import test from 'node:test';
import { SoundLimiter } from '@homie-rocks/audio/SoundLimiter.js';

const SPEC = {
  maxVoices: 6,
  fallback: { minGap: 0.05, voices: 3, seconds: 0.4 },
  sounds: {
    pickup: { minGap: 0.06, voices: 4, seconds: 0.25 },
    horn: { minGap: 0, voices: 1, seconds: 2 },
  },
};

test('limiter: forty of the same sound in one frame play once', () => {
  const l = new SoundLimiter(SPEC);
  let played = 0;
  for (let i = 0; i < 40; i++) if (l.allow('pickup', 10)) played++;
  assert.equal(played, 1);
  assert.equal(l.refused.gap, 39);
});

test('limiter: a run of the same sound becomes a steady rattle at the gap', () => {
  const l = new SoundLimiter(SPEC);
  const starts = [];
  // A pickup every frame for a second, at 120 frames a second.
  for (let f = 0; f < 120; f++) { const t = f / 120; if (l.allow('pickup', t)) starts.push(t); }
  assert.ok(starts.length >= 14 && starts.length <= 17, `about one per 60 ms: ${starts.length}`);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 0.06 - 1e-9);
});

test('limiter: a sound cannot stack on itself past its own voice cap, and frees a voice when one ends', () => {
  const l = new SoundLimiter(SPEC);
  assert.equal(l.allow('horn', 0), true);
  assert.equal(l.allow('horn', 0.5), false, 'still sounding');
  assert.equal(l.refused.voices, 1);
  assert.equal(l.playing('horn', 0.5), 1);
  assert.equal(l.allow('horn', 2), true, 'the first has ended');
});

test('limiter: the overall cap holds across different sounds, and nothing is cut to make room', () => {
  const l = new SoundLimiter(SPEC);
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ok = ids.map((id) => l.allow(id, 1));
  assert.deepEqual(ok, [true, true, true, true, true, true, false, false]);
  assert.equal(l.active(1), 6);
  assert.equal(l.refused.total, 2);
  assert.equal(l.playing('a', 1.2), 1, 'the first is still counted as playing: it was not stolen');
  // They all end at 1.4; then there is room again.
  assert.equal(l.active(1.4), 0);
  assert.equal(l.allow('g', 1.4), true);
});

test('limiter: a sound not named uses the fallback, and each sound has its own gap', () => {
  const l = new SoundLimiter(SPEC);
  assert.equal(l.allow('thud', 0), true);
  assert.equal(l.allow('thud', 0.04), false);
  assert.equal(l.allow('clink', 0.04), true, 'a different sound is not held by it');
  assert.equal(l.allow('thud', 0.05), true);
});

test('limiter: reset forgets what was playing', () => {
  const l = new SoundLimiter(SPEC);
  l.allow('horn', 0);
  l.reset();
  assert.equal(l.active(0), 0);
  assert.equal(l.allow('horn', 0), true);
});
