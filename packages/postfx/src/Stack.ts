/**
 * ============================================================================
 *  One assembled post stack, tuned per tier: build it, size it, render it.
 * ============================================================================
 *
 *  `Chain.ts` is a chain a game SUBCLASSES: ordered stages, ambient occlusion,
 *  depth of field, a capture protocol. This is the other thing a new game
 *  asks for, which is the picture, now, in a dozen lines:
 *
 *      scene (half-float HDR, MSAA by tier)
 *        -> bloom with the non-finite scrub and a tint        (Bloom.ts)
 *        -> ACES tone map
 *        -> sharpen, grade, speed lines, vignette, flash      (Finish.ts)
 *
 *  It is those existing pieces put in the one order that works, with the two
 *  decisions that are easy to get wrong made once:
 *
 *   - **TONE MAPPING HAPPENS HERE, SO THE RENDERER'S MUST BE OFF.** A renderer
 *     left on ACES tone-maps into the half-float buffer, and then bloom is
 *     thresholding a picture that has already been squeezed under 1: nothing
 *     glows, and the stack looks broken. {@link buildPostStack} sets
 *     `renderer.toneMapping = NoToneMapping` and says so.
 *
 *   - **THE BLOOM'S MIP COUNT FOLLOWS THE BUFFER.** `bloomLevels` in
 *     `Bloom.ts` holds the top mip at a fixed number of rows, so a dynamic
 *     resolution drop does not turn the glow into a veil. `setSize` applies it.
 *
 *  A tier ({@link PostTier}) says what is paid for; a look ({@link PostLook})
 *  says what it looks like. {@link POST_TIERS} and {@link POST_LOOK} are a
 *  starting pair: copy either, change it, pass yours. Nothing here reads a
 *  setting, a device or a window.
 *
 *  It is not a framework and nothing requires it: every piece it assembles is
 *  exported by its own module and can be put in a composer by hand.
 * ============================================================================
 */
import * as THREE from 'three';
import { EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { TintedBloomEffect, bloomLevels } from './Bloom.ts';
import { FinishEffect } from './Finish.ts';

/** What one tier pays for. */
export interface PostTier {
  /** Half-float scene buffer. False falls back to 8 bits: bloom still runs, on clipped values. */
  readonly hdr: boolean;
  /** MSAA samples on the scene buffer. 0 is off. */
  readonly msaa: number;
  /** Most bloom mip levels this tier spends; 0 is no bloom pass at all. */
  readonly bloomLevels: number;
  /** Compile the contrast-adaptive sharpen in, and how hard it works (0..1). */
  readonly sharpen: boolean;
  readonly sharpness: number;
  /** Compile the speed lines in. */
  readonly speedLines: boolean;
}

export const POST_TIERS: Readonly<Record<'high' | 'medium' | 'low', PostTier>> = {
  high: { hdr: true, msaa: 4, bloomLevels: 6, sharpen: true, sharpness: 0.5, speedLines: true },
  medium: { hdr: true, msaa: 2, bloomLevels: 5, sharpen: true, sharpness: 0.35, speedLines: true },
  // No sharpen: it is four more reads a pixel on the device with the least fill
  // rate, and at a pixel ratio of 1 there is little softness to take back.
  low: { hdr: true, msaa: 0, bloomLevels: 4, sharpen: false, sharpness: 0, speedLines: true },
};

/** What the picture looks like. Every field is read once, at build. */
export interface PostLook {
  /** Multiplies the scene before the tone map. */
  readonly exposure: number;
  /** Scene-linear luminance above which a texel blooms, and the knee under it. */
  readonly bloomThreshold: number;
  readonly bloomSmoothing: number;
  readonly bloomIntensity: number;
  readonly bloomRadius: number;
  readonly bloomTint: THREE.Color;
  readonly contrast: number;
  readonly saturation: number;
  readonly tint: THREE.Color;
  readonly vignette: number;
  readonly vignetteInner: number;
  readonly lineCells: number;
  readonly lineInner: number;
  readonly flashTau: number;
}

/** A neutral, slightly punchy look: bloom only on what is genuinely brighter than white. */
export const POST_LOOK: PostLook = {
  exposure: 1,
  bloomThreshold: 1.0, bloomSmoothing: 0.25, bloomIntensity: 0.8, bloomRadius: 0.7,
  bloomTint: /* @__PURE__ */ new THREE.Color(1, 1, 1),
  contrast: 1.06, saturation: 1.1, tint: /* @__PURE__ */ new THREE.Color(1, 1, 1),
  vignette: 0.28, vignetteInner: 0.35,
  lineCells: 90, lineInner: 0.28,
  flashTau: 0.12,
};

export interface PostStackSpec {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  tier: PostTier;
  look: PostLook;
}

export interface PostStack {
  readonly composer: EffectComposer;
  /** Null on a tier with no bloom. */
  readonly bloom: TintedBloomEffect | null;
  readonly tone: ToneMappingEffect;
  /** Speed lines (`finish.speed = 0.4`), flash (`finish.flash(1, 1, 1, 0.6)`), grade, vignette. */
  readonly finish: FinishEffect;
  /** Drawing-buffer size in pixels. Call it right before `render` when it changes. */
  setSize(width: number, height: number): void;
  /** Advance the flash and the speed-line clock by the game's `dt`, then draw. */
  render(dt: number): void;
  dispose(): void;
}

/**
 * The effects of a stack and the passes they go in, with no renderer: what
 * {@link buildPostStack} puts in its composer. Split out so the assembly (which
 * tier gets which effect, in which pass) is checked in Node, and so a game with
 * its own composer can take the effects and leave the rest.
 */
export function postStackEffects(tier: PostTier, look: PostLook): {
  bloom: TintedBloomEffect | null; tone: ToneMappingEffect; finish: FinishEffect;
} {
  const bloom = tier.bloomLevels > 0
    ? new TintedBloomEffect({
      threshold: look.bloomThreshold, smoothing: look.bloomSmoothing,
      intensity: look.bloomIntensity, radius: look.bloomRadius, levels: tier.bloomLevels,
      tint: look.bloomTint,
      // The largest finite half float: anything at or past it is not light.
      finiteBound: 65504, stretchAt: null,
    })
    : null;
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const finish = new FinishEffect({
    sharpen: tier.sharpen, sharpness: tier.sharpness,
    lines: tier.speedLines, lineCells: look.lineCells, lineInner: look.lineInner,
    contrast: look.contrast, saturation: look.saturation, tint: look.tint,
    vignette: look.vignette, vignetteInner: look.vignetteInner, flashTau: look.flashTau,
  });
  return { bloom, tone, finish };
}

export function buildPostStack(spec: PostStackSpec): PostStack {
  const { renderer, scene, camera, tier, look } = spec;
  // See the header: the stack owns the tone map, and exposure is the renderer's
  // one dial that the tone-mapping effect reads.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = look.exposure;

  const composer = new EffectComposer(renderer, {
    frameBufferType: tier.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    multisampling: tier.msaa,
  });
  const { bloom, tone, finish } = postStackEffects(tier, look);
  composer.addPass(new RenderPass(scene, camera));
  // Bloom and the tone map share a pass (neither reads its neighbours). The
  // finish gets its own because the sharpen must read the TONE-MAPPED picture.
  composer.addPass(bloom ? new EffectPass(camera, bloom, tone) : new EffectPass(camera, tone));
  composer.addPass(new EffectPass(camera, finish));

  return {
    composer, bloom, tone, finish,
    setSize(width, height) {
      if (bloom) {
        const want = bloomLevels(height, tier.bloomLevels);
        // Guarded: moving the count reallocates the whole mip chain.
        if (bloom.mipmapBlurPass.levels !== want) bloom.mipmapBlurPass.levels = want;
      }
      composer.setSize(width, height, false);
    },
    render(dt) {
      finish.advance(dt);
      composer.render(dt);
    },
    dispose() { composer.dispose(); },
  };
}
