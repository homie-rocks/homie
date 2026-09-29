import * as THREE from 'three';

/**
 * ============================================================================
 *  THE EFFECTS SYSTEM'S FRAME SCAFFOLDING — the part that is not an effect.
 * ============================================================================
 *  An `Effects` class in a racer spends most of its lines deciding WHAT to
 *  emit. Around that decision sits a fixed amount of housekeeping that has
 *  nothing to do with any particular effect: surviving a lost GL context,
 *  walking the emission density down when the machine is missing frames,
 *  thinning emitters by distance and by whether the machine emitting them is
 *  even on screen, and flushing the five pooled layers in the one order that
 *  works.
 *
 *  All of it was BYTE-IDENTICAL between the two racing games' `Effects`
 *  classes — comments, constants, worked examples and all — because none of it
 *  knows what a kart or a ship is. It lives here once now.
 *
 *  WHY THIS COULD MOVE WHEN "IT TAKES Ctx" SAID IT COULD NOT.
 *
 *  `hookContextLoss` and `lateUpdate` both took the game's `Ctx`, which carries
 *  the race, the track, the item system and (in the ship game) the combat and
 *  thermal models — none of which belongs in a shared package. But this code
 *  reads four things off it: a canvas, a camera's matrices, a camera's near and
 *  far planes, and an optional depth texture. Those are passed as values. The
 *  interfaces below are exactly the fields these functions touch on the effects
 *  system itself, and each game's `Effects` satisfies them structurally, so no
 *  call site took a cast.
 *
 *  ONE CONSEQUENCE FOR THE GAMES, WRITTEN DOWN BECAUSE IT IS EASY TO UNDO:
 *  `particles`, `trails`, `decals`, `rings` and `fx` had to lose the `private`
 *  keyword on both games' `Effects`. TypeScript will not match a `private`
 *  field structurally, and the alternative was renaming a hundred-odd call
 *  sites. The fields are still nobody else's business; the keyword is off for
 *  the seam and for nothing else, and each game says so at the declaration.
 *
 *  SCRATCH. `_frustum`, `_viewProj` and `_bounds` below are THIS module's. In
 *  both games they were module-level scratch used by exactly two places — the
 *  frustum build in `update` and `offScreenScale` — and by nothing else in
 *  either file, so moving them cannot make a caller's value survive a call it
 *  used to be destroyed by. Both games' post-processing module has its own
 *  `_viewProj`; that is a different module and is untouched.
 * ============================================================================
 */

const _frustum = new THREE.Frustum();
const _viewProj = new THREE.Matrix4();
const _bounds = new THREE.Sphere();

// ---------------------------------------------------------------------------
//  The seams. Exactly what is read, and nothing else.
// ---------------------------------------------------------------------------

/**
 * The per-machine effect state, as far as a context restore is concerned: a
 * ribbon-trail handle and whether a continuous skid emitter is running. Both
 * games' per-machine effect state carries thirty-odd more fields and none of them matter here.
 */
export interface TrailedState {
  trail: number;
  skidding: boolean;
}

/**
 * The GL-backed layers whose CPU copies outlive a context loss.
 *
 * Every property is optional because these are `!`-declared fields on a class
 * whose `init` may not have run — the original code guarded every one of them
 * with `?.` and this preserves that exactly.
 */
export interface RestorableLayers {
  readonly particles?: { invalidateGL(): void } | null;
  readonly decals?: { invalidate(): void; clear(): void } | null;
  readonly trails?: { release(handle: number): void } | null;
  /** Sparse by machine id; the holes are real and are skipped. */
  readonly fx?: readonly (TrailedState | null | undefined)[];
}

/**
 * The five pooled layers, in the shape `flush` needs them. `plumes` is absent
 * on purpose: it is opened and closed around the game's own per-machine loop,
 * which is the one part of the frame tail that is not shared.
 */
export interface FrameLayers {
  readonly particles: {
    additiveGain: number;
    update(now: number): void;
    setDepthTexture(tex: THREE.Texture | null, near: number, far: number): void;
  };
  readonly trails: { gain: number; update(dt: number): void };
  readonly decals: { update(now: number): void };
  readonly rings: {
    gain: number;
    update(now: number): void;
    setDepthTexture(tex: THREE.Texture | null, near: number, far: number): void;
  };
}

// ---------------------------------------------------------------------------
//  WebGL context loss
// ---------------------------------------------------------------------------

/**
 * WEBGL CONTEXT LOSS.
 *
 * A phone that is running out of memory does not always kill the tab: often
 * enough it takes the GL context away first, and a page with no
 * `webglcontextlost` handler answers that by rendering nothing at all — a
 * black frame that never comes back. That is a plausible reading of "still
 * black partial renders at times", and until this was added there
 * was not a single listener in the codebase.
 *
 * Owning the renderer's recovery is not this file's job (that belongs to the
 * game's renderer) but owning OUR OWN is. Both particle rings, the decal ring and
 * the two procedural atlases keep their CPU copies for the life of the process,
 * so a restored context needs nothing rebuilt — only telling that everything it
 * holds is stale. Calling `preventDefault` on the loss event is what allows the
 * browser to fire `webglcontextrestored` at all; without it the context is gone
 * for good, which is the difference between a stutter and a dead tab.
 */
export class ContextGuard {
  /**
   * True between the loss and the restore. The effects system reads this at the
   * top of `update` and `lateUpdate` and does nothing at all while it is set:
   * emitting into a ring whose GPU mirror does not exist only guarantees that
   * the restore frame has a full buffer's worth of upload to do.
   */
  lost = false;

  #canvas: HTMLCanvasElement | null = null;
  #host: RestorableLayers | null = null;

  #onLost = (e: Event) => {
    // Without this the browser never attempts a restore.
    e.preventDefault();
    this.lost = true;
  };

  #onRestored = () => {
    this.lost = false;
    const host = this.#host;
    if (!host) return;
    host.particles?.invalidateGL();
    host.decals?.invalidate();
    // Whatever was in flight belonged to a context that no longer exists.
    host.decals?.clear();
    for (const f of host.fx ?? []) {
      if (!f) continue;
      if (f.trail >= 0) host.trails?.release(f.trail);
      f.trail = -1;
      f.skidding = false;
    }
  };

  /**
   * `canvas` is `ctx.renderer?.domElement`, which is legitimately absent in a
   * headless run; that is a no-op rather than a throw, and `lost` then just
   * never becomes true, which is the right answer for a run with no GL at all.
   */
  attach(canvas: HTMLCanvasElement | null | undefined, host: RestorableLayers): void {
    if (!canvas) return;
    this.#canvas = canvas;
    this.#host = host;
    canvas.addEventListener('webglcontextlost', this.#onLost, false);
    canvas.addEventListener('webglcontextrestored', this.#onRestored, false);
  }

  detach(): void {
    if (!this.#canvas) return;
    this.#canvas.removeEventListener('webglcontextlost', this.#onLost, false);
    this.#canvas.removeEventListener('webglcontextrestored', this.#onRestored, false);
    this.#canvas = null;
    this.#host = null;
  }
}

// ---------------------------------------------------------------------------
//  Distance and visibility thinning
// ---------------------------------------------------------------------------

/**
 * near/mid/far emission multiplier by distance; steeper on the mobile tiers.
 */
export function lodOf(dist: number, mobile: boolean): number {
  if (mobile) return dist < 16 ? 1 : dist < 42 ? 0.30 : 0.09;
  return dist < 30 ? 1 : dist < 70 ? 0.45 : 0.18;
}

/**
 * Extra thinning for a machine that is not on screen. **Mobile tiers only** —
 * the caller gates `build` as well as `scale`, so High and Ultra do not pay for
 * the test and do not lose a grain.
 *
 * The measured worst case is fill-rate bound, not CPU bound (55% idle, 10% in
 * the GL driver), and the layer that can produce unbounded blended fill is the
 * particle one. A phone is 390 px tall with a 62-degree lens: on a wide
 * sweeping corner most of a bunched field is behind or beside the camera, and every grain
 * those machines emit is spawned, uploaded, integrated in the vertex shader and
 * clipped, having spent a slot in a ring the machines you CAN see are competing
 * for.
 *
 * A quarter rather than zero, and padded by twelve metres. Both matter: the
 * emitters are stateful accumulators, so switching one off and on again makes a
 * shower restart rather than fade, and a rival's smoke legitimately drifts into
 * frame after the machine that made it has left it. Twelve metres is about a
 * third of a second of travel at racing speed, which is more than the longest
 * smoke life either game authors.
 */
export class OffScreenTest {
  /**
   * Built once per frame from the camera the chase rig posed last frame, which
   * is a frame stale and irrelevant at the twelve metres of padding above.
   */
  build(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    _viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProj);
  }

  scale(position: THREE.Vector3): number {
    _bounds.center.copy(position);
    _bounds.radius = 12;
    return _frustum.intersectsSphere(_bounds) ? 1 : 0.25;
  }
}

// ---------------------------------------------------------------------------
//  The frame tail
// ---------------------------------------------------------------------------

/**
 * The end of `lateUpdate`: hand every pooled layer the frame's gain and let it
 * integrate, then pick up a scene depth texture if one appeared.
 *
 * The order is load-bearing and is the order both games shipped: trails on
 * `dt`, decals and rings on `now`, gains assigned after the layer updates that
 * do not read them and before the particle update that does.
 */
export class FrameFlush {
  #lastDepth: THREE.Texture | null = null;

  /**
   * The public setter's half of the same latch. Both games expose
   * `Effects.setDepthTexture` for a pipeline that wants to push rather than
   * publish, and it wrote `lastDepth` directly — so the latch has to be ONE
   * piece of state or the next frame's `run` would see a difference that is not
   * one and rewrite the uniforms it just wrote.
   */
  latch(tex: THREE.Texture | null): void {
    this.#lastDepth = tex;
  }

  /**
   * `depth` is the caller's already-normalised `ctx.depthTexture ?? null`.
   *
   * NORMALISE TO NULL BEFORE THE COMPARE, and the games did. Nobody publishes
   * `depthTexture` today, so the read is `undefined` while `lastDepth` is
   * `null` — and `undefined !== null`, so the old form re-entered this branch
   * on every single frame for the whole race, walking both particle layers and
   * the ring material to write uniforms that had not changed. It never
   * recompiled (the SOFT_DEPTH define only flips when the texture's truthiness
   * changes) but it is per-frame work in the hot path for a thing that is
   * switched off. The `?? null` stays at the call site because it is the game's
   * `Ctx` that is loosely typed, not this argument.
   */
  run(
    layers: FrameLayers, now: number, dt: number, gain: number,
    depth: THREE.Texture | null, near: number, far: number,
  ): void {
    layers.trails.update(dt);
    layers.decals.update(now);
    layers.rings.update(now);
    layers.rings.gain = gain;
    layers.trails.gain = gain;
    layers.particles.additiveGain = gain;
    layers.particles.update(now);

    // Opportunistic true soft particles: if whoever owns the render pipeline
    // publishes a scene depth texture on the context we pick it up for free.
    if (depth !== this.#lastDepth) {
      this.#lastDepth = depth;
      layers.rings.setDepthTexture(this.#lastDepth, near, far);
      layers.particles.setDepthTexture(this.#lastDepth, near, far);
    }
  }
}
