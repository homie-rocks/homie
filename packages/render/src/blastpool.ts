/**
 * ============================================================================
 *  blastpool.ts — a fixed pool of blast flashes: an additive core and a ground
 *  ring, both pre-built, both hidden, neither ever allocated after `init`.
 * ============================================================================
 *
 * Every explosion in both racers is these two objects: a sphere of light at the
 * point of impact, and a disc of light on the ground under it. The pool is
 * fixed and small (three or four), it recycles the oldest slot on overflow
 * rather than dropping the event, and nothing here allocates once it is built —
 * a garbage collection in the middle of a blast is a frame drop at exactly the
 * moment the player is looking.
 *
 * It stood in the projectile code of a kart racer and of a space racer, and the
 * two copies agreed on all of it: the pooled construction, the recycle scan,
 * the timer, the visibility flip, the two mesh scales and the two opacity
 * writes. What differed was the ART, and the art is what `BlastSpec` carries.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CURVES ARE FUNCTIONS AND NOT EXPONENTS
 * ---------------------------------------------------------------------------
 * The kart racer's flash expands as `0.25 + (1 - (1-u)^3) * 1.15` — fast out,
 * slow fade, the shape of every good explosion in air. The space racer's is
 * `0.2 + u * 1.9`, LINEAR, because in vacuum there is nothing to slow it down
 * and an ease-out reads as air resistance in a place that has no air.
 *
 * It is tempting to unify those behind one exponent, since `1 - (1-u)^1` is `u`
 * in algebra. IT IS NOT `u` IN BINARY FLOATING POINT: at `u = 0.1`, `1 - (1 -
 * 0.1)` is `0.09999999999999998`. So an exponent parameter would move every
 * pixel of one game's explosion by a rounding error and call it a refactor.
 *
 * The curves are therefore the VALUES a game supplies, verbatim in the game's
 * own spelling, and this file never writes an easing of its own. The same goes
 * for the two opacity ramps.
 *
 * ---------------------------------------------------------------------------
 * AND WHY `placeRing` IS A FUNCTION TOO
 * ---------------------------------------------------------------------------
 * The kart racer's ring lies in the world plane and is lifted 0.12 m along +Y;
 * its quaternion is never written at all. The space racer's is lifted 0.12 m
 * along the DECK NORMAL and oriented to it, for the inverted-track reason
 * `groundblob.ts` states at length. Those are not two values of one expression:
 * one of them assigns a quaternion and the other deliberately does not, and a
 * shared version that always assigns is a different program for a game that
 * never had one — bit-identical only where the normal happens to be world up,
 * which is exactly the case a probe would be tempted to test and exactly the
 * case that proves nothing.
 *
 * So the placement is the game's, in one line each, and this file owns the
 * pool, the clock and the fade.
 */
import * as THREE from 'three';

/**
 * One blast pool, fully specified. EVERY FIELD IS REQUIRED: a game that forgets
 * one fails to compile, where a game that gets a default gets the other game's
 * explosion and it looks completely fine.
 */
export interface BlastSpec {
  /** how many flashes may be in the air at once */
  count: number;
  /** width and height segments of the core sphere */
  coreSegments: readonly [number, number];
  coreColor: number;
  ringColor: number;
  /** the ring's radial sprite — a game builds it with its own inner/gamma */
  ringMap: THREE.Texture;
  /** seconds a flash lives */
  life: number;
  renderOrder: number;
  /** the radius multiplier at normalised age `u`, in the game's own spelling */
  expand: (u: number) => number;
  /** the core's own scale as a fraction of the expanded radius */
  coreScale: number;
  /** the ring's own scale as a fraction of the expanded radius */
  ringScale: number;
  coreAlpha: (u: number) => number;
  ringAlpha: (u: number) => number;
  /** where the ring goes and how it is turned, given the impact and its normal */
  placeRing: (ring: THREE.Mesh, at: THREE.Vector3, normal: THREE.Vector3) => void;
}

interface Blast {
  t: number;
  life: number;
  scale: number;
  core: THREE.Mesh;
  ring: THREE.Mesh;
}

export class BlastFlashes {
  /**
   * The slots, readable because both games add the two meshes to their own
   * group rather than owning a group here — a pool that made its own group
   * would put every game's blasts one transform away from where they were.
   */
  readonly slots: Blast[] = [];

  private readonly spec: BlastSpec;

  constructor(spec: BlastSpec) {
    this.spec = spec;
    const coreGeo = new THREE.SphereGeometry(1, spec.coreSegments[0], spec.coreSegments[1]);
    const coreMat = new THREE.MeshBasicMaterial({
      color: spec.coreColor, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const ringGeo = new THREE.PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: spec.ringColor, map: spec.ringMap, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    for (let i = 0; i < spec.count; i++) {
      // `.clone()` per slot, and it is not waste: each flash fades on its own
      // clock, and opacity lives on the MATERIAL. One shared material means
      // every flash in the air fades at the rate of whichever one was written
      // last, which reads as the older ones snapping out.
      const core = new THREE.Mesh(coreGeo, coreMat.clone());
      const ring = new THREE.Mesh(ringGeo, ringMat.clone());
      core.visible = ring.visible = false;
      core.frustumCulled = false;
      ring.frustumCulled = false;
      core.renderOrder = spec.renderOrder;
      ring.renderOrder = spec.renderOrder;
      this.slots.push({ t: 0, life: 0, scale: 1, core, ring });
    }
  }

  /** Every mesh this pool owns, for the caller to parent where it wants them. */
  meshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const b of this.slots) out.push(b.core, b.ring);
    return out;
  }

  /**
   * Light one up at `at`, `radius` metres across, on a surface whose normal is
   * `normal`.
   *
   * A free slot is taken if there is one. Otherwise the pool RECYCLES THE ONE
   * NEAREST THE END OF ITS LIFE, and that qualifier is the whole of this
   * method — a missing explosion is a hit the player did not see land, and a
   * WRONGLY CHOSEN recycle is worse than a missing one because it deletes the
   * hit that just happened and leaves three older, dimmer ones burning.
   *
   * Both games shipped `slots[0]` here, which is arbitrary: with three or four
   * slots and a bomb chain or a burst weapon, the flash the player just caused
   * is as likely as any other to be the one thrown away, and what is left on the
   * screen is somebody else's older explosion. The kart racer's projectile
   * `acquire()` had already learned this exact lesson in its own comment — it
   * recycled the item with the MOST life left and the player's input read as
   * simply not happening — and the note did not travel eighty lines down the
   * same file.
   *
   * `t / life` and not `t`: the two games run 0.42 s and 0.55 s flashes, and a
   * pool with mixed lifetimes ranked by raw age throws away a young long flash
   * before an old short one.
   */
  spawn(at: THREE.Vector3, radius: number, normal: THREE.Vector3) {
    let slot = this.slots[0]!;
    let spent = -Infinity;
    for (const b of this.slots) {
      if (b.life <= 0) { slot = b; spent = Infinity; break; }
      const done = b.t / b.life;
      if (done > spent) { spent = done; slot = b; }
    }
    slot.life = this.spec.life;
    slot.t = 0;
    slot.scale = radius;
    slot.core.position.copy(at);
    this.spec.placeRing(slot.ring, at, normal);
    slot.core.visible = slot.ring.visible = true;
  }

  update(dt: number) {
    const s = this.spec;
    for (const b of this.slots) {
      if (b.life <= 0) continue;
      b.t += dt;
      const u = Math.min(1, b.t / b.life);
      if (u >= 1) {
        b.life = 0;
        b.core.visible = b.ring.visible = false;
        continue;
      }
      const r = b.scale * s.expand(u);
      b.core.scale.setScalar(r * s.coreScale);
      b.ring.scale.set(r * s.ringScale, 1, r * s.ringScale);
      (b.core.material as THREE.MeshBasicMaterial).opacity = s.coreAlpha(u);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = s.ringAlpha(u);
    }
  }

  /** Put every flash out — called on a reset. */
  clear() {
    for (const b of this.slots) {
      b.life = 0;
      b.core.visible = b.ring.visible = false;
    }
  }

  dispose() {
    for (const b of this.slots) {
      (b.core.material as THREE.Material).dispose();
      (b.ring.material as THREE.Material).dispose();
    }
    // The two geometries are shared by every slot, so disposing slot 0's is
    // disposing all of them; the materials are per-slot clones and are not.
    if (this.slots.length) {
      this.slots[0]!.core.geometry.dispose();
      this.slots[0]!.ring.geometry.dispose();
    }
  }
}
