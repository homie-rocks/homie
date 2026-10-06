// Finish.js and Stack.js. The sharpen and the flash are tested through the plain
// functions the shader is written to match; the assembly (which tier gets which effect,
// and what is compiled in) is tested on the real effect objects, which need no GL to
// construct. What these tests do NOT do is compile the GLSL: that needs a GPU.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { EffectAttribute } from 'postprocessing';
import { FinishEffect, casSharpen, flashDecay } from '@homie-rocks/postfx/Finish.js';
import { POST_LOOK, POST_TIERS, postStackEffects } from '@homie-rocks/postfx/Stack.js';
import { TintedBloomEffect } from '@homie-rocks/postfx/Bloom.js';

const SPEC = {
  sharpen: true, sharpness: 0.5, lines: true, lineCells: 90, lineInner: 0.28,
  contrast: 1, saturation: 1, tint: new THREE.Color(1, 1, 1),
  vignette: 0.3, vignetteInner: 0.35, flashTau: 0.12,
};

test('finish: the sharpen leaves a flat area exactly alone', () => {
  for (const v of [0, 0.2, 0.5, 0.9, 1]) {
    assert.ok(Math.abs(casSharpen(v, v, v, v, v, 1) - v) < 1e-12, `flat ${v}`);
  }
});

test('finish: the sharpen lifts soft detail, more at a higher sharpness', () => {
  // A pixel a little brighter than its neighbours gets brighter still; a darker one, darker.
  const up0 = casSharpen(0.55, 0.45, 0.45, 0.45, 0.45, 0), up1 = casSharpen(0.55, 0.45, 0.45, 0.45, 0.45, 1);
  assert.ok(up0 > 0.55 && up1 > up0, `${up0} ${up1}`);
  assert.ok(casSharpen(0.45, 0.55, 0.55, 0.55, 0.55, 1) < 0.45);
});

test('finish: the sharpen does not ring on an edge that is already hard, and never leaves 0..1', () => {
  // Black to white: there is no headroom, so the weight is zero and the pixel is unchanged.
  assert.equal(casSharpen(1, 0, 1, 0, 1, 1), 1);
  assert.equal(casSharpen(0, 0, 1, 0, 1, 1), 0);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 20000; i++) {
    const v = casSharpen(rnd(), rnd(), rnd(), rnd(), rnd(), rnd());
    assert.ok(v >= 0 && v <= 1 && Number.isFinite(v), `out of range: ${v}`);
  }
});

test('finish: a flash decays on the game\'s clock, is gone when it cannot be seen, and holds while paused', () => {
  assert.ok(Math.abs(flashDecay(1, 0.12, 0.12) - Math.exp(-1)) < 1e-12);
  assert.equal(flashDecay(0.001, 0.12, 0.016), 0);
  const fx = new FinishEffect(SPEC);
  fx.flash(1, 0.2, 0.2, 0.8);
  assert.equal(fx.flashLevel, 0.8);
  fx.advance(0); // paused, or inside a hit-stop
  assert.equal(fx.flashLevel, 0.8);
  let t = 0;
  while (fx.flashLevel > 0) { fx.advance(1 / 60); t += 1 / 60; assert.ok(t < 2, 'it ends'); }
  assert.ok(t > 0.4 && t < 0.9, `0.8 falls below sight in about six time constants: ${t}`);
});

test('finish: the stronger of two flashes wins, whichever came last', () => {
  const fx = new FinishEffect(SPEC);
  fx.flash(1, 0, 0, 0.9);
  fx.flash(0, 0, 1, 0.3);
  const f = fx.uniforms.get('flash').value;
  assert.deepEqual([f.x, f.y, f.z, f.w], [1, 0, 0, 0.9]);
  fx.flash(0, 1, 0, 5);
  assert.deepEqual([f.x, f.y, f.z, f.w], [0, 1, 0, 1], 'and it is clamped to 1');
});

test('finish: a tier that does not pay for the sharpen or the lines does not compile them', () => {
  const full = new FinishEffect(SPEC);
  assert.ok(full.defines.has('FINISH_SHARPEN') && full.defines.has('FINISH_LINES'));
  assert.ok(full.getAttributes() & EffectAttribute.CONVOLUTION, 'reading neighbours is declared');
  const bare = new FinishEffect({ ...SPEC, sharpen: false, lines: false });
  assert.equal(bare.defines.size, 0);
  assert.equal(bare.getAttributes() & EffectAttribute.CONVOLUTION, 0, 'so it can share a pass');
  // The shader text guards both blocks, and scrubs non-finite input before anything else.
  const glsl = full.getFragmentShader();
  assert.match(glsl, /#ifdef FINISH_SHARPEN[\s\S]+pfxCas[\s\S]+#endif/);
  assert.match(glsl, /#ifdef FINISH_LINES/);
  assert.match(glsl, /vec3 c = clamp\(pfxFinite\(inputColor\.rgb\)/);
  assert.ok(!glsl.includes('!='), 'no self-compare NaN test: a compiler may fold it away');
});

test('finish: speed lines are a dial the game sets, and the clock that redraws them wraps', () => {
  const fx = new FinishEffect(SPEC);
  assert.equal(fx.speed, 0, 'off until asked for');
  fx.speed = 0.4; assert.equal(fx.speed, 0.4);
  fx.speed = -1; assert.equal(fx.speed, 0);
  for (let i = 0; i < 700; i++) fx.advance(1);
  assert.ok(fx.uniforms.get('clock').value < 600);
});

test('stack: each tier gets the effects it pays for, and bloom is always the scrubbed one', () => {
  for (const name of ['high', 'medium', 'low']) {
    const tier = POST_TIERS[name];
    const { bloom, tone, finish } = postStackEffects(tier, POST_LOOK);
    assert.ok(bloom instanceof TintedBloomEffect, `${name}: bloom is the non-finite-safe effect`);
    assert.match(bloom.getFragmentShader(), /pfxFiniteBloom/);
    assert.equal(bloom.mipmapBlurPass.levels, tier.bloomLevels);
    assert.ok(tone, 'a tone map');
    assert.equal(finish.defines.has('FINISH_SHARPEN'), tier.sharpen, `${name}: sharpen`);
    assert.equal(finish.defines.has('FINISH_LINES'), tier.speedLines, `${name}: lines`);
    assert.equal(tier.hdr, true);
  }
  assert.ok(POST_TIERS.high.msaa > POST_TIERS.medium.msaa && POST_TIERS.medium.msaa > POST_TIERS.low.msaa);
  assert.ok(POST_TIERS.high.bloomLevels > POST_TIERS.low.bloomLevels);
  assert.equal(POST_TIERS.low.sharpen, false);
});

test('stack: a tier with no bloom levels builds no bloom, and a look is the caller\'s', () => {
  const { bloom, finish } = postStackEffects({ ...POST_TIERS.low, bloomLevels: 0 }, { ...POST_LOOK, contrast: 1.3, vignette: 0 });
  assert.equal(bloom, null);
  assert.equal(finish.grade.x, 1.3);
  assert.equal(finish.vignette.x, 0);
});
