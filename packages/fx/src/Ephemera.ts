import * as THREE from 'three';

/**
 * ============================================================================
 *  Ephemera — objects that are added to a scene, live for a moment, and have
 *  to be taken out again WITH their geometry.
 * ============================================================================
 *  A tracer, a bullet hole, a scorch, a dropped shell, a spent flare. Each one
 *  is a whole `Object3D` rather than a slot in a pooled buffer, and that is a
 *  legitimate choice at the counts these things actually reach — but it means
 *  every one of them needs the same four things done to it in the same order,
 *  and getting any of them wrong is a leak nobody sees until an hour in.
 *
 *  WHY THIS IS NOT `@homie-rocks/fx/Decals.ts`. That class is the racers' answer and
 *  it is a different answer: one ring of interleaved quads, a 2x2 procedural
 *  atlas, a custom shader, a duplicated index buffer to keep the wrap frame
 *  from costing seventeen times its neighbours. It is right for a thousand
 *  skid marks lying flat on a road. It is the wrong shape for eighty bullet
 *  holes on six surfaces at arbitrary angles, and adopting it would be an art
 *  change wearing a refactor's clothes. Both exist on purpose.
 *
 *  THE FOUR THINGS, and each of them has shipped wrong somewhere:
 *
 *   1. **The geometry is disposed, the material is not.** Every ephemeron here
 *      builds its own geometry — that is what makes it a fresh object rather
 *      than an instance — so dropping the reference leaks a GPU buffer. The
 *      MATERIAL is usually shared with everything else of its kind, and
 *      disposing that takes the whole class out with it. So: `geometry.dispose`
 *      always, `material` never. A pool that guessed either way would be wrong
 *      half the time, which is why neither is a flag.
 *   2. **The cap is a RING, not a cliff.** Past `capacity` the OLDEST goes,
 *      immediately, disposed. The alternative — refuse to add — is worse in
 *      the exact moment it fires: the player is shooting a lot, and the marks
 *      that stop appearing are the ones they just made.
 *   3. **Removal happens on the frame the life crosses zero, in reverse index
 *      order.** Forward iteration with a splice skips the next element, which
 *      leaves one object in the scene for the rest of the session per frame in
 *      which two expire together.
 *   4. **Whatever fades is the caller's business.** `fade` is optional and gets
 *      the remaining life; a tracer ramps a line's opacity off it, a decal does
 *      nothing at all and simply vanishes. This module never touches a
 *      material, so it cannot have an opinion about how something leaves.
 *
 *  NO CLOCK OF ITS OWN. `tick(dt)` is called by the caller's frame, so a frozen
 *  frame (`dt = 0`) freezes the pool exactly, which is what a still-frame
 *  harness needs and what a wall-clock deadline inside here would have broken.
 * ============================================================================
 */

/** One live object and what is left of its life, in seconds. */
interface Live<T extends THREE.Object3D> {
  object: T;
  life: number;
}

export class Ephemera<T extends THREE.Object3D = THREE.Object3D> {
  private live: Live<T>[] = [];

  /**
   * `scene` is where these hang; `capacity` is the ring size. Both are
   * required: a default capacity would be one game's memory budget applied to
   * another's rate of fire.
   */
  constructor(
    private readonly scene: THREE.Object3D,
    private readonly capacity: number,
  ) {}

  /** How many are on screen right now. Reported, never decided on here. */
  get count(): number {
    return this.live.length;
  }

  /**
   * Add an object with a life in seconds, evicting the oldest if the ring is
   * full. Returns the object so a caller can keep configuring it.
   */
  add(object: T, life: number): T {
    if (this.live.length >= this.capacity) this.retire(0);
    this.scene.add(object);
    this.live.push({ object, life });
    return object;
  }

  /**
   * One frame. `fade` sees each survivor and its remaining life, in the order
   * they were added.
   */
  tick(dt: number, fade?: (object: T, life: number) => void): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i]!;
      e.life -= dt;
      if (e.life <= 0) this.retire(i);
      else if (fade) fade(e.object, e.life);
    }
  }

  /** Take everything out and dispose it. A context loss or a level change. */
  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.retire(i);
  }

  /**
   * Remove one by index. Geometry disposed, material left alone — rule 1.
   *
   * `traverse` rather than a cast: an ephemeron may be a Group of two meshes
   * (a tracer with a glow, a decal with a rim) and a leak inside a child is
   * the same leak.
   */
  private retire(i: number): void {
    const e = this.live[i]!;
    this.scene.remove(e.object);
    e.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.live.splice(i, 1);
  }
}
