/**
 * ============================================================================
 *  KeySun — where the key light is, which way its shadows fall, and how long.
 * ============================================================================
 *
 *  Anything that fakes a shadow needs three numbers the scene graph does not
 *  hand over: the ground BEARING the shadow runs along, the RUN-OUT per metre
 *  of caster height, and whether there is a key at all. A contact patch that
 *  stretches into the root of the object's own cast shadow instead of sitting
 *  beside it as a second ellipse; a blob that lengthens as the sun drops; a
 *  streak stamped down-sun; a decal that has to point the same way the cascade
 *  does. All three numbers come from the same light and they must come from it
 *  IN ONE PASS, or a streak points one way and is sized for another.
 *
 *  ── ASK, DO NOT REMEMBER ───────────────────────────────────────────────────
 *
 *  The light is cached and RE-RESOLVED the moment it is no longer parented.
 *  The rule this follows: a cache of a fact outlives the fact and then answers
 *  for it. A renderer rebuilds its lighting rig on a quality change, on
 *  a resize, on a scene reload — and a module holding the old light goes on
 *  reporting a sun that was removed twenty minutes ago, confidently, with no
 *  error anywhere. Re-resolving costs one traverse on the frame after a rebuild
 *  and nothing on every other frame.
 *
 *  THE INVALIDATION IS "NO PARENT" AND NOT "A DIFFERENT SCENE", and that limit
 *  is stated rather than papered over. A caller that swaps between two LIVE
 *  scenes, each with its own key, keeps the first one's light for as long as it
 *  stays parented: the cache has no way to know it was handed a different
 *  graph, and walking to the root every frame to check would cost more than the
 *  traverse it is avoiding. `reset()` when you swap. Found by a probe that
 *  reused one instance across nine scenes, not by reading the code.
 *
 *  ── THE SIGNS ARE THE WHOLE FILE AND EACH OF THEM IS A BUG SOMEWHERE ───────
 *
 *  · A light's POSITION is where the light comes FROM. The shadow falls the
 *    other way, so the bearing is target minus position, not position.
 *  · `sinE` is `-dy / len` and NOT `Math.abs(dy) / len`. A rig that has parked
 *    the sun below the horizon for night must produce ZERO here — an absolute
 *    value throws a shadow from underground, in the dark, which is the one time
 *    nobody is looking for it.
 *  · `cot` diverges at the horizon. Below the caller's floor it is zero rather
 *    than enormous, because a shadow a hundred metres long is not a shadow.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS THE CALLER'S ─────────────────────────────
 *
 *  Mechanism: the search, the cache and its invalidation, the bearing, the
 *  elevation, the run-out and the fade. The caller's: the horizon floor, the
 *  width of the fade band, what it does with a missing key, and every metre of
 *  whatever it then draws. Nothing here draws.
 * ============================================================================
 */
import * as THREE from 'three';

/** Everything one pass over the key light produces. */
export interface KeySunReading {
  /** True when a shadow-casting directional light was found at all. */
  found: boolean;
  /** Ground bearing the shadow runs ALONG, unnormalised. (0, 0) with no key. */
  dx: number;
  dz: number;
  /** sin(elevation). Negative with the sun below the horizon. 0 with no key. */
  sinE: number;
  /** Run-out per metre of caster height. 0 below the floor and with no key. */
  cot: number;
  /** 0..1 over the fade band above the floor. How much shadow there is to cast. */
  up: number;
}

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

export class KeySun {
  private light: THREE.DirectionalLight | null = null;
  private readonly out: KeySunReading = { found: false, dx: 0, dz: 0, sinE: 0, cot: 0, up: 0 };

  /** Forget the cached light. The next `read` traverses. */
  reset(): void {
    this.light = null;
  }

  /** The light currently held, for a probe or a diagnostic. */
  current(): THREE.DirectionalLight | null {
    return this.light;
  }

  /**
   * @param floor sin(elevation) below which there is no usable shadow. A couple
   *              of degrees at every caller so far — below that the run-out is
   *              a smear across the whole map.
   * @param band  width of the fade above the floor, in sin(elevation).
   * @returns     the same object every call. Read it or copy it; do not keep it.
   */
  read(scene: THREE.Object3D, floor: number, band: number): KeySunReading {
    const o = this.out;
    // `!this.light.parent` is the invalidation, and it is deliberately cheaper
    // and blunter than tracking the rig: a light that has been removed from the
    // graph has no parent, and that is exactly the case a stale cache answers
    // wrongly for.
    if (!this.light || !this.light.parent) {
      this.light = null;
      scene.traverse((n) => {
        const d = n as THREE.DirectionalLight;
        if (!this.light && d.isDirectionalLight && d.castShadow) this.light = d;
      });
    }
    const L = this.light;
    if (!L) {
      o.found = false; o.dx = 0; o.dz = 0; o.sinE = 0; o.cot = 0; o.up = 0;
      return o;
    }
    _p.setFromMatrixPosition(L.matrixWorld);
    _t.setFromMatrixPosition(L.target.matrixWorld);
    const dx = _t.x - _p.x, dy = _t.y - _p.y, dz = _t.z - _p.z;
    o.found = true;
    o.dx = dx; o.dz = dz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) {
      o.sinE = 0; o.cot = 0; o.up = 0;
      return o;
    }
    const sinE = -dy / len;
    const cosE = Math.sqrt(Math.max(0, 1 - sinE * sinE));
    o.sinE = sinE;
    // A ternary clamp and not `min(1, max(0, x))`. They differ on negative
    // zero — `Math.max(0, -0)` is `+0` — and on a value that a caller then
    // divides by, the sign of a zero is the difference between a shadow
    // pointing down-sun and one pointing up it.
    const u = (sinE - floor) / band;
    o.up = u < 0 ? 0 : u > 1 ? 1 : u;
    o.cot = sinE > floor ? cosE / sinE : 0;
    return o;
  }
}
