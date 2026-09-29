/**
 * ===========================================================================
 *  @homie-rocks/postfx/Resolve.ts — an accumulating temporal resolve.
 * ===========================================================================
 *
 * WHY THIS FILE EXISTS, AND IT IS THE CATEGORY A DUPLICATION CENSUS CANNOT SEE.
 *
 * This is a package capability that did not exist. It had exactly ONE copy —
 * in one space racer's post-processing module — so every duplication census
 * scored it zero and called the file clean while it carried a whole temporal
 * antialiaser. The rule that finds this class of thing: ask *"does this
 * belong in a game"*, never *"is there a twin"*. A single implementation can
 * be 100% platform, and this one is.
 *
 * The vocabulary scan that decides platform-or-genre, run over the block that
 * moved rather than assumed: `race` 0, `lap` 0, `ship` 0, `boost` 0, `kart` 0,
 * `player` 0 — not one identifier here names a thing a game owns. The shader's
 * COMMENTS do still mention that game's far plane and its gantry chords, and
 * they are kept verbatim for the same reason `Grade.ts` kept "the player's
 * kart": the sentence beside a number is the measurement that produced it, and
 * a comment that looks wrong may be load-bearing for a reason you have not
 * found yet. Provenance, not vocabulary.
 *
 * ---------------------------------------------------------------------------
 * WHAT `ChainSpec` COULD NOT EXPRESS, WHICH IS WHY THE GAME HAD ITS OWN CHAIN
 * ---------------------------------------------------------------------------
 * `PostFXChain` builds RenderPass → AO → (DoF+Bloom) → Grade → SMAA and has no
 * vocabulary for a pass that ACCUMULATES: no history target, no per-frame
 * projection jitter, no way for the pipeline to ask "how many sub-draws does a
 * held frame need". A measurement showed the consequence — against `Chain.ts`
 * the game's file shared 72 of 715 substantive lines with a LONGEST RUN OF
 * SEVEN — and the conclusion follows: there is no shared function sitting there
 * waiting to be lifted, so the work is to widen the package until the game can
 * be a consumer, not to squeeze the game into a chain that has no room for it.
 *
 * This file is the first of those widenings. It ships the pass; the game still
 * owns the decision to build one, because "does this world alias" is a fact
 * about the world.
 *
 * ---------------------------------------------------------------------------
 * EVERY TUNING VALUE IS A REQUIRED FIELD. NO OPTIONALS, NO DEFAULTS.
 * ---------------------------------------------------------------------------
 * `ResolveLook` has six members and none of them may be omitted. A game that
 * got a default here would silently inherit another game's art direction and
 * it would look completely fine: `feedbackRest` is how long a ghost lives,
 * `clipSigma` is how much of a 40:1 lighting change is allowed to survive, and
 * a walking game that inherited a 165 m/s racer's `fastTravelPx` would hold its
 * history through motion that has nothing to do with its own.
 *
 * `materialName` is required for the same reason and it is not cosmetic: it is
 * what a person reads in a WebGL frame capture, and two games' passes that both
 * called themselves `TemporalResolve` are two rows nobody can tell apart.
 *
 * ---------------------------------------------------------------------------
 * DO NOT `node --check` THIS FILE
 * ---------------------------------------------------------------------------
 * `resolveFragment()` returns a large template literal. A backtick inside a
 * comment inside one of those has removed a whole runtime module from
 * existence once already, and `node --check` disagrees because it parses ES
 * modules as CommonJS. The package's test harness IMPORTS this module, which is
 * the only thing that proves it parses.
 */
import * as THREE from 'three';
import { Pass } from 'postprocessing';
import { jitterAt as haltonJitter, jitterIndex } from './Halton.ts';
import type { HeldFrameChain } from './Capture.ts';

/**
 * The six numbers a temporal resolve is tuned by. Every field required.
 *
 * The shipped racer values, for reference when a new game is choosing its own:
 * `phases` 8, `clipSigma` 1.25, `feedbackRest` 0.92, `feedbackFast` 0.74,
 * `fastTravelPx` 22. They are NOT exported as a preset, deliberately — a
 * preset is a default wearing a different hat, and the whole argument above is
 * that a silently inherited look is the defect.
 */
export interface ResolveLook {
  /**
   * Length of the Halton cycle, in frames. The capture path resolves a held
   * frame from exactly this many sub-draws, so a whole cycle is the only count
   * at which the accumulated mean is unbiased.
   */
  phases: number;
  /**
   * Variance-clip width in standard deviations. Lower is sharper and noisier.
   *
   * This is the anti-ghost, and it is the clause that survives a strobe: a
   * pixel whose light has just changed by 40:1 finds its history outside the
   * box and takes the new value almost entirely. The same mechanism handles
   * disocclusion behind a passing object, which is why this needs no separate
   * rejection heuristic.
   */
  clipSigma: number;
  /**
   * History weight at rest.
   *
   * 0.92 is roughly a twelve-frame box, i.e. it converges inside a fifth of a
   * second — fast enough that a shot harness holding the sim still for 0.62 s
   * photographs a fully converged frame, and slow enough to actually integrate
   * eight jitter positions.
   */
  feedbackRest: number;
  /**
   * The floor the history weight falls to under screen-space motion.
   *
   * The floor exists because the game that wrote this moves at 165 m/s.
   * Variance clipping is the primary anti-ghost and it is good, but at a pixel
   * velocity of tens of pixels per frame the reprojected history is sampled
   * from far enough away that it is no longer an estimate of the same surface,
   * and holding 0.92 of it buys smearing rather than samples.
   */
  feedbackFast: number;
  /**
   * Reprojected travel, in PIXELS, at which the feedback has reached its floor.
   *
   * Pixels and not metres per second: what matters is how far the surface moved
   * on SCREEN, which is what makes a distant truss keep its accumulation while
   * a near-field gantry leg gives it up.
   */
  fastTravelPx: number;
  /** The name a frame capture shows for this pass. See the header. */
  materialName: string;
}

/**
 * The resolve fragment, built against one game's `ResolveLook`.
 *
 * A FUNCTION AND NOT A CONSTANT, and that is the whole reason the constants
 * could move at all: three of the six are interpolated into GLSL rather than
 * being uniforms, so a module-level `TAA_FRAGMENT` string would have baked one
 * game's numbers into the package. They are compile-time in the shader
 * deliberately — `clipSigma` and `fastTravelPx` are in the inner loop and in a
 * `mix` respectively, and a uniform there is a register read per pixel for a
 * number that changes when somebody edits the file.
 */
export function resolveFragment(look: ResolveLook): string {
  return /* glsl */ `
// Explicit sampler precision. The default precision for a sampler2D in a
// fragment shader is lowp, which is 8 bits of mantissa either side of the
// point — sampling a half-float HDR buffer through one quantises everything
// above 1.0 into a handful of steps, and everything this pass exists to filter
// lives above 1.0. mediump IS half float, which is exactly the buffer's own
// format; depth needs highp or the reprojection lands on the wrong surface.
uniform mediump sampler2D inputBuffer;
uniform mediump sampler2D historyBuffer;
uniform highp sampler2D depthBuffer;
/**
 * LAST FRAME'S CLIP SPACE FROM THIS ONE'S, COMPOSED ON THE CPU. See 'reproj' in
 * the chain's sync for why this is one matrix and not the 'prevViewProj *
 * inverse(viewProj)' pair it replaces. highp explicitly: the whole point of this
 * uniform is that it is the numerically well-behaved spelling, and inheriting a
 * precision from the default would make that a coincidence.
 */
uniform highp mat4 reproj;
uniform vec2 texelSize;
/** x: history weight at rest, y: 0 on the first frame after a rebuild. */
uniform vec2 blend;
varying vec2 vUv;

const vec3 TAA_LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 taaTone(vec3 c) { return c / (1.0 + dot(c, TAA_LUMA)); }
vec3 taaUntone(vec3 c) { return c / max(1e-4, 1.0 - dot(c, TAA_LUMA)); }

void main() {
  vec3 cur = taaTone(max(texture2D(inputBuffer, vUv).rgb, 0.0));

  // The current frame's 3x3 neighbourhood, as a mean and a variance. This is
  // both the clip box and — because it is computed in the tone-mapped space —
  // the reason a single 12.0 sample cannot blow the box open.
  vec3 m1 = vec3(0.0);
  vec3 m2 = vec3(0.0);
  for (int j = -1; j <= 1; ++j) {
    for (int i = -1; i <= 1; ++i) {
      vec3 s = taaTone(max(texture2D(inputBuffer, vUv + vec2(float(i), float(j)) * texelSize).rgb, 0.0));
      m1 += s;
      m2 += s * s;
    }
  }
  m1 /= 9.0;
  m2 /= 9.0;
  vec3 sigma = sqrt(max(m2 - m1 * m1, 0.0));
  vec3 lo = m1 - ${look.clipSigma.toFixed(2)} * sigma;
  vec3 hi = m1 + ${look.clipSigma.toFixed(2)} * sigma;

  // Reprojection, straight from this frame's clip space into last frame's,
  // through the UNJITTERED transform pair. The jitter is the signal being
  // accumulated; putting it into the motion vector as well would cancel it and
  // leave a filter that averages the same sample eight times.
  //
  // ONE MATRIX, AND IT HAS TO BE ONE MATRIX. This used to reconstruct a world
  // position ('invViewProj * ndc', homogeneous divide) and then project it
  // forward again ('prevViewProj * world'), which is the same transform
  // algebraically and is not the same transform in float32. A space game's far
  // plane is tens of kilometres, so a pixel on the spine reconstructs to a
  // world point four orders of magnitude larger than the clip coordinates it
  // came from, and projecting it back is a difference of large numbers — the
  // error lands entirely in the sub-pixel part of 'prevUv', which is precisely
  // the part this pass is built on.
  //
  // MEASURED, and it is why this pass shipped worse than no pass at all: on the
  // MUSTER shot, which is 'still: 1, speed: 0' and therefore has a camera that
  // barely moves, the round-trip form produced a frame visibly SOFTER than the
  // same frame with the resolve disabled — structural detail on the gantry
  // chords blurred into grey. A history fetched a fraction of a texel away is
  // resampled bilinearly every frame, and repeated resampling of a fixed
  // sub-pixel offset is a convergent low-pass filter: the pass was not
  // accumulating samples, it was Gaussian-blurring the frame. Forcing
  // 'prevUv = vUv' restored it exactly, which is the diagnosis in one line.
  //
  // Composed on the CPU instead, 'reproj' is the identity to double precision
  // when the camera has not moved, so a static frame resolves to the mean of
  // its eight jitter positions — which is what the pass is for — and a moving
  // one costs one mat4 multiply with no huge intermediate anywhere.
  float depth = texture2D(depthBuffer, vUv).r;
  vec4 prevClip = reproj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec2 prevUv = prevClip.xy / prevClip.w * 0.5 + 0.5;

  // Off-screen history is not history. Tested before the fetch rather than
  // relying on clamp-to-edge, which would smear the frame border inward, and
  // 'w > 0' with it: a surface that was BEHIND last frame's eye projects to a
  // perfectly plausible-looking uv through a negative w, and that uv is a
  // mirror image of where the surface actually was.
  vec2 inside = step(vec2(0.0), prevUv) * step(prevUv, vec2(1.0));
  float onScreen = inside.x * inside.y * step(1e-6, prevClip.w);

  vec3 hist = clamp(taaTone(max(texture2D(historyBuffer, prevUv).rgb, 0.0)), lo, hi);

  float travelPx = length((prevUv - vUv) / texelSize);
  float fast = clamp(travelPx / ${look.fastTravelPx.toFixed(1)}, 0.0, 1.0);
  float feedback = mix(blend.x, ${look.feedbackFast.toFixed(2)}, fast);

  gl_FragColor = vec4(taaUntone(mix(cur, hist, feedback * blend.y * onScreen)), 1.0);
}
`;
}

/**
 * The temporal resolve pass. Reads the composer's colour and depth plus its own
 * history target, writes the resolved image to the output buffer; a `CopyPass`
 * registered immediately after it refills the history from the swapped result.
 *
 * TWO PASSES RATHER THAN ONE, and the alternative was worse. A pass can only
 * write one attachment through postprocessing's fullscreen path, so writing the
 * resolve and its own history in one go would mean either an MRT setup (a
 * second colour attachment on every composer buffer, for one pass) or reaching
 * into `EffectComposer`'s private ping-pong to hand it a target it did not
 * allocate. The copy is a straight blit of an already-resident buffer and it is
 * the cheapest thing in the chain.
 *
 * WHAT THE PROBLEM ACTUALLY IS, MEASURED, in the game this came from. That
 * circuit's handrail stanchions, truss diagonals and gantry chords are 30-90 mm
 * members seen from tens of metres, so at 1080p most of them are between a
 * third and one pixel wide. One shading sample per pixel either lands on a
 * member or misses it, and the members are lit — so the deck edge prints as a
 * dashed chain of bright beads rather than as a line. Rendering the same frozen
 * vantage at 2x2 and box-downsampling turns that chain back into legible
 * structure while moving the 99.9th percentile of scene-linear luma by 4%
 * (1.87 -> 1.95) and the fraction of the frame above 1.0 by 1.4% (2.690% ->
 * 2.727%) — i.e. the same light, differently distributed, which is the
 * signature of a COVERAGE error and not a shading one.
 *
 * WHY NOT MSAA. It is the obvious answer and it is unavailable when an AO pass
 * is in the chain: `N8AOPostPass` samples the composer's input buffer as a
 * texture, a multisampled attachment cannot resolve to one, and
 * `multisampling = 2` measured 32 black frames in 420.
 *
 * WHY NOT SMAA ALONE. SMAA is morphological: it reconstructs an edge from the
 * colours either side of it. A chain of beads has no edge to reconstruct — the
 * information about how much of the pixel the stanchion covered was destroyed
 * at rasterisation and no amount of post-filtering can invent it. SMAA smooths
 * each bead; it cannot join them.
 *
 * SO: PUT THE SAMPLES BACK, ONE PER FRAME. The projection is offset by a
 * sub-pixel Halton offset every frame, so over `phases` frames a given pixel
 * has been sampled at that many different positions inside its own footprint,
 * and the accumulated result is a multi-sample estimate of coverage that costs
 * one sample per frame.
 */
export class TemporalResolvePass extends Pass {
  readonly history: THREE.WebGLRenderTarget;
  readonly material: THREE.ShaderMaterial;
  /**
   * The six uniforms, held as a typed record and handed to the material rather
   * than read back off it.
   *
   * NOT `material.uniforms.reproj.value as Matrix4` at every call site, which is
   * what the game's copy did. `ShaderMaterial.uniforms` is a string-indexed map,
   * so every read of it is `IUniform | undefined` and every write is a cast —
   * and a cast is exactly the thing that would keep compiling after somebody
   * renamed a uniform in the fragment above. Named fields here mean a rename is
   * a type error in this file and in every consumer at once.
   */
  private readonly u: {
    inputBuffer: { value: THREE.Texture | null };
    historyBuffer: { value: THREE.Texture | null };
    depthBuffer: { value: THREE.Texture | null };
    reproj: { value: THREE.Matrix4 };
    texelSize: { value: THREE.Vector2 };
    blend: { value: THREE.Vector2 };
  };
  /** Halton index; wraps at `look.phases` so the sequence is finite and even. */
  private frame = 0;
  /** The sub-pixel offset applied to the projection for the CURRENT frame. */
  readonly jitter = new THREE.Vector2();

  /**
   * @param hdr   true when the composer's buffer is half-float rather than 8-bit
   * @param look  every tuning value, all required — see {@link ResolveLook}
   */
  constructor(hdr: boolean, private readonly look: ResolveLook) {
    super('TemporalResolve');
    this.needsSwap = true;
    // Asks the composer to attach a depth texture to its input buffer. Without
    // this the reprojection has no geometry to reproject.
    this.needsDepthTexture = true;

    this.history = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      // The history has to hold the same range as the buffer it is a history
      // OF. An 8-bit history under an HDR chain clamps at 1.0, which would
      // quietly delete every value the bloom threshold is there to select.
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });
    this.history.texture.name = 'TemporalResolve.History';

    this.u = {
      inputBuffer: { value: null },
      historyBuffer: { value: this.history.texture },
      depthBuffer: { value: null },
      reproj: { value: new THREE.Matrix4() },
      texelSize: { value: new THREE.Vector2() },
      blend: { value: new THREE.Vector2(look.feedbackRest, 0) },
    };

    this.material = new THREE.ShaderMaterial({
      name: look.materialName,
      // postprocessing's own fullscreen vertex shader: the screen mesh is a
      // single triangle in clip space, so vUv falls out of the position.
      vertexShader: 'varying vec2 vUv;void main(){vUv=position.xy*0.5+0.5;'
        + 'gl_Position=vec4(position.xy,1.0,1.0);}',
      fragmentShader: resolveFragment(look),
      depthWrite: false,
      depthTest: false,
      blending: THREE.NoBlending,
      uniforms: this.u,
    });
    this.fullscreenMaterial = this.material;
  }

  /**
   * LAST FRAME'S CLIP SPACE FROM THIS ONE'S, mutable in place.
   *
   * Exposed as the matrix itself rather than as a setter because the caller
   * composes it with `multiplyMatrices` into a buffer it does not want to
   * allocate sixty times a second, and because a held frame writes
   * `.identity()` into it — see the note at `reproj` in the fragment above for
   * why one matrix composed on the CPU and not the two-matrix round trip.
   */
  get reproj(): THREE.Matrix4 {
    return this.u.reproj.value;
  }

  /**
   * How many jitter positions one cycle is — the count a held frame has to be
   * accumulated from before it can present. Read by the chain rather than
   * reaching into `look`, so the capture schedule and the shader cannot
   * disagree about the length of the sequence.
   */
  get phases(): number {
    return this.look.phases;
  }

  /** The history weight at rest. The live chain restores this after a capture. */
  get feedbackRest(): number {
    return this.look.feedbackRest;
  }

  /** Discards the history: the next frame is taken whole. */
  reset(): void {
    this.u.blend.value.y = 0;
    this.frame = 0;
  }

  /**
   * Advances the Halton sequence and returns this frame's sub-pixel offset in
   * PIXELS. Called by the pipeline before the scene is rendered, because the
   * offset has to be in the projection matrix the RenderPass uses.
   */
  nextJitter(): THREE.Vector2 {
    return this.jitterAt((this.frame + 1) % this.look.phases);
  }

  /**
   * The same offset, at an EXPLICIT position in the cycle. This is what makes
   * the sequence addressable rather than merely finite, which is the whole
   * difference between a live frame and a reproducible one: `nextJitter` asks
   * "where are we?", and a capture has to be able to say "position 3".
   */
  jitterAt(index: number): THREE.Vector2 {
    this.frame = jitterIndex(index, this.look.phases);
    // `./Halton.ts` writes straight into this Vector2 — it types the out-param
    // structurally as `{ x, y }` precisely so a package with three as a peer
    // does not have to import three to describe two numbers, and so this stays
    // allocation-free at 60 Hz. The +1 that skips the sequence's own origin
    // travelled with it, and its comment was corrected on the way: that sample
    // is not "at the pixel centre", it is on the footprint CORNER, which four
    // neighbouring pixels share and whose two axes are equal by construction.
    // Measured over a cycle of eight, dropping the +1 moves the cycle's mean
    // y-offset from exactly 0 to -0.1111.
    haltonJitter(this.frame, this.look.phases, this.jitter);
    return this.jitter;
  }

  /**
   * Overrides the history weight for one draw. The live chain wants the
   * exponential filter `feedbackRest` describes, and an accumulation wants
   * `1 - 1/k`, which is the same shader arriving at an unweighted mean instead.
   */
  setFeedback(weight: number): void {
    this.u.blend.value.x = weight;
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.u.depthBuffer.value = depthTexture;
  }

  override setSize(width: number, height: number): void {
    this.history.setSize(width, height);
    this.u.texelSize.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    // A resized history is a history of a different image. Reprojecting into it
    // would be reprojecting into the previous resolution's pixels.
    this.reset();
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget | null,
    outputBuffer: THREE.WebGLRenderTarget | null,
  ): void {
    this.u.inputBuffer.value = inputBuffer?.texture ?? null;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
    // Whatever the first frame after a reset looked like, there is a history
    // now. Raised here rather than in `sync` so it cannot be raised on a frame
    // the pass did not actually run.
    this.u.blend.value.y = 1;
  }

  override dispose(): void {
    this.history.dispose();
    this.material.dispose();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
//  THE DRIVER — the half without which the pass above is not a capability
// ---------------------------------------------------------------------------
/**
 * WHY THIS IS IN THE PACKAGE AND NOT LEFT IN THE GAME.
 *
 * A pass a consumer still has to hand-drive is not a capability, it is a part.
 * The pass above is inert on its own: something has to skew the projection
 * before the scene render and unskew it after, switch the chain's tail off
 * while a held frame converges, switch the history copy off while it presents,
 * and put all four back in a `finally`. That protocol is nine methods, it is
 * the same nine for any game with an accumulating resolve, and getting any one
 * of them wrong is invisible — a chain left with its tail disabled renders into
 * a buffer and presents nothing, which is a black screen that survives the
 * fault that caused it.
 *
 * `Capture.ts` already owns the CONTROL FLOW (`renderFrame` decides the order,
 * the weights and what happens in the `finally`) and declares the six verbs it
 * drives as `HeldFrameChain`. What was missing was an implementation of those
 * verbs for a chain that actually has a resolve in it. A space racer wrote one;
 * nothing else could, because there was no pass to write it against. This is
 * that implementation, and it is the reason `Resolve.ts` is a capability rather
 * than a class.
 *
 * WHAT IT READS OFF THE HOST, counted rather than copied: the pass array's
 * `enabled` flags and nothing else. It is not handed a chain, a composer, a
 * `Ctx` or a game — `attach()` takes the three facts it needs and `heldFrame()`
 * takes the camera and the draw for one frame. A god-object parameter here
 * would have made this undrivable in Node, which is exactly where the
 * capability probe drives it.
 */
export class ResolveDriver {
  /** The resolve, or null on a tier that does not build one. */
  pass: TemporalResolvePass | null = null;

  /**
   * Every pass in the composer, in order. Only `enabled` is ever touched.
   * Empty until `attach`.
   */
  private passes: readonly { enabled: boolean }[] = [];

  /**
   * Index in `passes` of the first pass DOWNSTREAM of the resolve and its
   * history copy, or -1 when there is no resolve in the chain.
   *
   * The capture accumulation only needs the part of the chain that feeds the
   * history — scene, AO, resolve, copy. Everything after it (DoF, bloom, the
   * grade, the final edge resolve) is a pure function of the resolved image, so
   * running it on the sub-draws that are not the last one is that many full
   * sets of full-screen fill spent on a picture nothing will ever look at.
   */
  private tailFrom = -1;

  /**
   * The drawing-buffer size the pipeline last pushed, in device pixels.
   *
   * 1x1 rather than 0: these are divisors in the projection skew, and a zero
   * would put `Infinity` into the camera's projection matrix before the first
   * `setSize` — which renders as a completely black frame with no error at all.
   * A 1x1 start is a very large but FINITE jitter on a frame that cannot be
   * drawn yet, and the first size push overwrites it.
   */
  private bufW = 1;
  private bufH = 1;

  /** Saved projection skew, so `clearJitter` restores rather than recomputes. */
  private readonly jitterSaved = new THREE.Vector2();
  private jitterActive = false;

  /**
   * Point the driver at a freshly built chain. Call once per `build()`, after
   * every pass has been added, and call {@link detach} from `dispose()`.
   *
   * @param pass      the resolve, or null on a tier that does not build one
   * @param passes    the composer's passes in order — only `enabled` is read
   * @param tailFrom  index of the first pass downstream of the history copy
   */
  attach(
    pass: TemporalResolvePass | null,
    passes: readonly { enabled: boolean }[],
    tailFrom: number,
  ): void {
    this.pass = pass;
    this.passes = passes;
    this.tailFrom = pass === null ? -1 : tailFrom;
  }

  /** Forget the chain. A driver holding a disposed pass array is a leak. */
  detach(): void {
    this.pass = null;
    this.passes = [];
    this.tailFrom = -1;
    this.jitterActive = false;
  }

  /**
   * The drawing-buffer size, in device pixels. The capture verbs need it and
   * this is the only place it arrives; the chain that owns this driver is
   * handed it by the pipeline on every resize, including the pushes that do
   * not rebuild the chain — which is every move an adaptive ladder makes.
   */
  setSize(width: number, height: number): void {
    this.bufW = width;
    this.bufH = height;
  }

  /**
   * Offsets the projection by this frame's sub-pixel jitter, in place.
   *
   * Called AFTER the uniform sync and BEFORE `composer.render`, which is the
   * only window in which it is correct: the sync has to see the unjittered
   * matrices (any reprojection is computed against them) and the RenderPass has
   * to see the jittered one.
   *
   * The skew goes into `projectionMatrix.elements[8]` and `[9]` — the m02/m12
   * terms, which shift the frustum sideways without changing its shape, and are
   * the same two entries three's own `setViewOffset` moves. NDC spans -1..1
   * across the drawing buffer, so one pixel is 2/width.
   *
   * `projectionMatrixInverse` is re-derived because an AO pass reconstructs
   * view-space position from depth through it. Leaving it stale would put the
   * occlusion a pixel away from the geometry it belongs to, once per frame, in
   * a different direction each time — which is a shimmer, not an offset.
   */
  applyJitter(camera: THREE.Camera, index?: number): void {
    const pass = this.pass;
    const width = this.bufW;
    const height = this.bufH;
    if (pass === null || this.jitterActive || width < 2 || height < 2) return;
    const j = index === undefined ? pass.nextJitter() : pass.jitterAt(index);
    const e = camera.projectionMatrix.elements;
    this.jitterSaved.set(e[8], e[9]);
    e[8] += (2 * j.x) / width;
    e[9] += (2 * j.y) / height;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.jitterActive = true;
  }

  /** Undoes `applyJitter`. Idempotent, and a no-op if no jitter was applied. */
  clearJitter(camera: THREE.Camera): void {
    if (!this.jitterActive) return;
    const e = camera.projectionMatrix.elements;
    e[8] = this.jitterSaved.x;
    e[9] = this.jitterSaved.y;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.jitterActive = false;
  }

  /**
   * Enables or disables every pass downstream of the history copy.
   *
   * The index reads are guarded rather than asserted. `tailFrom` is a number
   * the CHAIN computed from its own pass list, and a chain that got it wrong —
   * off by one after somebody inserted a pass — would otherwise throw inside a
   * `finally`, which is the one place a throw turns a look bug into a black
   * screen that survives its own cause.
   */
  private setTailEnabled(on: boolean): void {
    if (this.tailFrom < 0) return;
    for (let i = this.tailFrom; i < this.passes.length; i++) {
      const p = this.passes[i];
      if (p !== undefined) p.enabled = on;
    }
  }

  /** The copy pass that refills the resolve's history. */
  private setHistoryCopyEnabled(on: boolean): void {
    if (this.tailFrom < 1) return;
    const p = this.passes[this.tailFrom - 1];
    if (p !== undefined) p.enabled = on;
  }

  /**
   * The six verbs `Capture.ts` drives, bound to one camera and one draw.
   *
   * A FACTORY AND NOT SIX PUBLIC METHODS, because the camera and the draw are
   * facts about ONE FRAME and the buffer size is a fact about the chain. Six
   * methods each taking a camera is six chances to hand one of them a different
   * camera than the others, and the failure — half the accumulation converged
   * from a viewpoint the present draw does not use — is a soft picture nobody
   * can attribute.
   */
  heldFrame(camera: THREE.Camera, draw: () => void): HeldFrameChain {
    return {
      // Zero when there is no resolve in the chain: a held frame is then
      // already a pure function of the frozen world and the loop would be
      // identical draws.
      samples: () => (this.pass === null ? 0 : this.pass.phases),

      // Opens the accumulation for a held frame: throw the history away and
      // start the sequence at position 0. The reset is what makes the result
      // independent of everything that was ever drawn before it, which is the
      // property the whole exercise is for.
      beginCapture: () => { this.pass?.reset(); },

      // Prepares accumulation sub-draw `i` of `n`.
      //
      // THE WEIGHT SCHEDULE IS `1 - 1/k`, WHICH IS A RUNNING MEAN AND NOT A
      // TUNING, and it arrives from `Capture.ts` rather than being recomputed
      // here so the schedule and the loop that drives it cannot drift apart in
      // two files. Sub-draw 1 takes the frame whole (the history was just
      // discarded, so the pass's own `blend.y` gate does this for us);
      // sub-draw k contributes 1/k. Unrolled, every one of the n samples ends
      // up carrying exactly 1/n of the history, so what the accumulation
      // leaves behind is the unweighted mean of n jitter positions.
      // `feedbackRest` is the right number for a LIVE frame — it is a filter
      // with a memory of the frames before it — and it is the wrong number
      // here, because a fixed exponential weight never reaches a fixed point,
      // and "never reaches a fixed point" is the defect.
      captureSubframe: (i: number, feedback: number) => {
        const pass = this.pass;
        if (pass === null) return;
        pass.setFeedback(feedback);
        this.setTailEnabled(false);
        this.setHistoryCopyEnabled(true);
        this.clearJitter(camera);
        this.applyJitter(camera, i);
      },

      // Prepares the PRESENT draw of a held frame — the one that actually
      // reaches the screen. Runs the full chain, takes the accumulated history
      // whole, and does NOT write the history back.
      //
      // Being a pure function of (history, current scene) is what makes the
      // repeat exact: feedback 1.0 means the current sample is used only for
      // the variance clip's neighbourhood, and with the copy disabled the
      // history cannot move. So the repeat draw sees identical inputs and
      // produces an identical image.
      //
      // It is also the better picture. At feedback `1 - 1/n` the last jitter
      // position would carry 1/n more weight than the others; at 1.0 the
      // presented frame is the clean unweighted mean of all n.
      capturePresent: (lastIndex: number) => {
        const pass = this.pass;
        if (pass === null) {
          // No resolve in the chain: a held frame is one ordinary draw.
          this.clearJitter(camera);
          return;
        }
        pass.setFeedback(1);
        this.setTailEnabled(true);
        this.setHistoryCopyEnabled(false);
        this.clearJitter(camera);
        this.applyJitter(camera, lastIndex);
      },

      // A live frame: advance the sequence by one and leave the chain alone.
      liveFrame: () => { this.applyJitter(camera); },

      // Closes a held frame and puts the chain back exactly as a live frame
      // expects to find it. Called from a `finally`, because a throw out of the
      // composer that left the tail passes disabled would leave the game
      // rendering into a buffer and presenting nothing.
      //
      // The history is deliberately NOT discarded here. It holds a fully
      // converged still of the exact scene the next live frame will start from,
      // which is the best seed a temporal filter can be handed.
      endFrame: () => {
        this.clearJitter(camera);
        this.setTailEnabled(true);
        this.setHistoryCopyEnabled(true);
        const pass = this.pass;
        if (pass !== null) pass.setFeedback(pass.feedbackRest);
      },

      draw,
    };
  }
}
