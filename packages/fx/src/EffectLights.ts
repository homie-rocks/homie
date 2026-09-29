import * as THREE from 'three';

/*
 * ----------------------------------------------------------------------------
 *  WHY THE COMMENTS BELOW TALK ABOUT KARTS AND TARMAC.
 * ----------------------------------------------------------------------------
 *  This is the fixed pool of claimable point lights, lifted whole out of the
 *  effects system of the two racing games it came from, where it was
 *  byte-identical in both — 86 lines, `diff` clean, measured 2026-08-20.
 *
 *  Every comment travelled with the constant it justifies, unedited, including
 *  the ones that cite a kart, a road or a chase camera. Those are not
 *  vocabulary, they are the MEASUREMENT that sized the number beside them, and
 *  `Trails.ts` in this package records what happens when a worked example is
 *  "tidied up" out of a shared file: the next person re-derives the constant
 *  from nothing and the effect quietly changes in two games at once.
 *
 *  WHAT DID NOT COME WITH IT. The emitters did not. Nothing in this file knows
 *  what a race, a track, an item or a match is, and it must not learn — a game
 *  context object crossing this seam is the failure mode to avoid. It knows a
 *  position, a normal, a colour and a time, and the game decides all four.
 * ----------------------------------------------------------------------------
 */

// ===========================================================================
//  Effect lights — a tiny fixed pool of point lights that bright effects can
//  claim for a frame.
// ===========================================================================
//
//  Every additive effect in this file used to be pure emission: sparks, flame
//  and boost pads glowed but lit nothing, so they floated in front of the world
//  instead of being part of it. Coloured light pooling under the tier is what
//  sells the drift read at a glance in a shipped arcade racer.
//
//  The pool is allocated ONCE and the lights stay in the scene for the lifetime
//  of the process with intensity 0 when idle. That matters: three.js keys shader
//  permutations on the light counts, so adding, removing or hiding a light
//  forces every material in the scene to recompile. A fixed count costs a few
//  ALU per lit fragment and never hitches.
//
//  Claims are re-issued every frame and ranked by importance, so the player's
//  drift always outranks a rival's and the pool degrades by dropping the least
//  important claimant rather than by flickering between them.
export class EffectLights {
  private readonly lights: THREE.PointLight[] = [];
  /** importance of whatever currently owns each slot, this frame */
  private readonly score: number[] = [];
  private readonly owner: number[] = [];

  constructor(count: number) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 2);
      l.castShadow = false;
      // Never culled out of the light list: see the note above on recompiles.
      l.matrixAutoUpdate = false;
      this.lights.push(l);
      this.score.push(-1);
      this.owner.push(-1);
    }
  }

  get meshes(): THREE.PointLight[] { return this.lights; }

  /**
   * THE CONTENTION CENSUS, and it exists because losing here is SILENT.
   *
   * `request` returns without a word when the pool is full and the claimant is
   * not important enough — which is correct behaviour and completely
   * unreportable, so neither game it came from ever knew how often it happens.
   * This pool is allocated with THREE lights at High, two at Medium and none at
   * Low — "three lights, regardless of how many entities want one" — and every
   * constant in the picture stack was fitted on a fixed cast. With every phone
   * a controller, eight players is eight boosting machines asking three lights
   * for a flame that lights the hull — and five of them get nothing, invisibly,
   * in exactly the frame that is busiest.
   *
   * A defect that only appears at occupancy is not found by code review or by
   * a screenshot of an empty scene. So the pool counts, per frame, and the
   * count is read back through `RacerSystem.census()`.
   *
   * These are COUNTERS AND NOTHING ELSE. No claim is granted or refused
   * differently because of them; a parity test grades the placements against
   * the same pool driven with the counters ignored.
   */
  /**
   * Every request that got past the empty-pool / zero-intensity gate.
   *
   * `wanted` is NOT `granted + denied`. The difference is the third case, and
   * it is the healthy one: a claimant that already owns a slot and has already
   * put something more important in it this frame asks again, is turned away,
   * and its light is on anyway. Counting that as a denial would report a full
   * pool as starved. The identity that holds is
   * `wanted === granted + denied + heldByOwner`.
   */
  wanted = 0;
  granted = 0;
  /** claims the pool turned away this frame, because it was full and busier */
  denied = 0;
  /** the third case above: the claimant already holds the slot, lit */
  heldByOwner = 0;
  /**
   * THE NUMBER THAT TURNED OUT TO MATTER, and it is not `denied`.
   *
   * A claim that arrives at a full pool and is MORE important than the weakest
   * slot does not get refused — it takes the slot, and the machine that had it
   * loses its light **within the same frame, after it was already placed**.
   * With importance rising down the grid (which is what a field spread over a
   * lap looks like: nearer machines matter more), eight boosting machines
   * against three slots produce eight placements, ZERO denials and five
   * evictions, and the five that lose were lit a microsecond earlier.
   *
   * `denied` alone reports that as a healthy pool. A first test asserted
   * `granted <= capacity` and went red on correct code, which is how this was
   * found; the assertion was wrong and the mechanism is right, and the
   * honest census needs both columns. Nothing here changes the eviction — the
   * scoring is the pool's whole job — it only stops it being invisible.
   */
  evicted = 0;
  get capacity(): number { return this.lights.length; }

  begin() {
    for (let i = 0; i < this.score.length; i++) this.score[i] = -1;
    this.wanted = 0;
    this.granted = 0;
    this.denied = 0;
    this.heldByOwner = 0;
    this.evicted = 0;
  }

  /**
   * Ask for a light. `key` identifies the claimant so the same emitter keeps
   * the same slot frame to frame (a light that hops between vehicles strobes).
   */
  request(key: number, importance: number, p: THREE.Vector3, colour: THREE.Color,
          intensity: number, distance: number) {
    if (this.lights.length === 0 || intensity <= 0) return;
    // Counted BEFORE the two early returns below, because a claim the pool
    // turned away is exactly the thing that has never been visible.
    this.wanted += 1;
    let slot = -1;
    for (let i = 0; i < this.owner.length; i++) {
      if (this.owner[i] === key) { slot = i; break; }
    }
    if (slot < 0) {
      let worst = 0;
      for (let i = 1; i < this.score.length; i++) if (this.score[i]! < this.score[worst]!) worst = i;
      if (this.score[worst]! >= importance) { this.denied += 1; return; }
      // Taking a slot off somebody who has ALREADY placed into it this frame is
      // an eviction; taking an idle slot is not. `score >= 0` is exactly that
      // test — `begin()` sets every slot to -1 and only a placement raises it.
      if (this.score[worst]! >= 0) this.evicted += 1;
      slot = worst;
    } else if (this.score[slot]! >= importance) {
      // NOT a denial: this claimant already holds the slot and has already
      // placed something more important into it this frame. Its light is on.
      this.heldByOwner += 1;
      return;
    }
    this.granted += 1;
    this.owner[slot] = key;
    this.score[slot] = importance;
    const l = this.lights[slot]!;
    l.position.copy(p);
    l.updateMatrix();
    l.color.copy(colour);
    l.intensity = intensity;
    l.distance = distance;
  }

  /** Anything not claimed this frame goes dark (but stays in the light list). */
  end(dt: number) {
    const k = Math.min(1, dt * 18);
    for (let i = 0; i < this.lights.length; i++) {
      if (this.score[i]! < 0) {
        const l = this.lights[i]!;
        if (l.intensity > 0.001) l.intensity -= l.intensity * k;
        else { l.intensity = 0; this.owner[i] = -1; }
      }
    }
  }

  dispose() { for (const l of this.lights) l.removeFromParent(); }
}
