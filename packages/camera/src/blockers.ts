/**
 * ============================================================================
 *  What a chase lens is not allowed to be inside.
 * ============================================================================
 *
 *  Two small stores and the three questions asked of them every frame: how far
 *  along a segment before it enters a box, how to get a lens out of one it is
 *  already inside, and how low the roof is at this point on the circuit.
 *
 *  Byte-identical in both racers' cameras before this move — `ceilingAt`,
 *  `propSegment` and `propPush`, character for character, in a 215-line run
 *  the two files shared.
 *
 *  **THE BUILDERS USED TO STAY IN THE GAMES, AND HALF OF THAT ARGUMENT WAS
 *  WRONG.** What stood here said the walks could not cross because they take a
 *  `Ctx`, which carries race, track, items, match and colony, and which the
 *  engine's rules forbid crossing a package seam even as an `import type`. The
 *  rule is right and the conclusion did not follow: a walk that takes a `Ctx`
 *  is not a walk that needs one. `buildProps` reads three fields of it —
 *  `frame`, `scene`, `race.karts` — so `scene.ts` declares an interface of
 *  exactly those three, both games' `Ctx` satisfies it structurally, and no lap
 *  and no colony comes with it. The walks are `@homie-rocks/camera/scene.ts`
 *  now, and the package's tests hold them character-identical to the bodies
 *  they were lifted out of.
 *
 *  What has NOT changed is the half of the argument that was right: the ANSWER
 *  is what crosses at THIS file's seam. A packed `Float32Array` the caller
 *  fills, and two queries over it that do not know what a kart is. And the
 *  per-game name filter stayed the game's — the kart racer skips
 *  `palm|crowd|banana`, the space racer skips `kesh|magstrip|handrail`, and a
 *  handrail runs along 100% of every deck edge in one game and does not exist
 *  in the other.
 *
 *  **NO NUMBER IS IN THIS FILE.** `PROP_ESCAPE_MAX` — how deep a box a lens is
 *  allowed to be shoved out of — is 3.2 in both games today, and it is STILL a
 *  constructor argument. `lens.ts`'s header makes the argument at length and it
 *  is the same one: a package that ships a number two games happen to agree on
 *  has picked one game's feel for every game that ever calls this, silently,
 *  and the frames look completely fine.
 *
 *  Zero allocation in both queries: no raycaster, no BVH to keep warm, no
 *  temporary vectors. A six-compare AABB reject in front of a slab test over a
 *  flat array, which is what makes it affordable to ask about two thousand
 *  boxes on every frame of a race.
 * ============================================================================
 */
import * as THREE from 'three';

/*
 * THE `!` ON EVERY TYPED-ARRAY TAP, AND WHY IT IS NOT LAZINESS.
 *
 * `@homie-rocks/render/Textures.ts` makes this argument at length and it is not
 * repeated here. Short version: this package runs `noUncheckedIndexedAccess`
 * and the games it came out of run `strict: false`, so every read of a
 * Float32Array stops compiling the moment the file crosses the packages/
 * boundary. Every index below is in range by construction — `i0`/`i1` are taken
 * modulo `B.length`, and `o` walks `propCount * 6` entries of an array that was
 * built as exactly that many — and `!` erases at emit, so the JavaScript that
 * ships is character-for-character what the games shipped. A bounds branch
 * inside a loop over two thousand boxes, run every frame, would be a cost
 * bought with nothing AND would change what the code does, which is the one
 * thing a parity change may not do.
 */

/**
 * The bore-roof lookup table, and the one question asked of it every frame.
 *
 * The TABLE is built by the game — one ray straight up from the road at every
 * station, against meshes only the game can name — and handed over as a
 * `Float32Array` of world heights, or `null` where the circuit has no roof.
 * Reading it is the part that is the same in both games, so reading it is the
 * part that is here.
 */
export class BoreCeiling {
  /** Roof height per station, `+Infinity` where the ray found nothing, and
   *  `null` when this circuit has no bore at all. The game fills it. */
  boreY: Float32Array | null = null;

  /** Roof height above `t`, +Infinity where there is no roof. Interpolated, so
   *  the ceiling does not step as the kart drives under it. */
  ceilingAt(t: number): number {
    const B = this.boreY;
    if (!B) return Infinity;
    const n = B.length;
    let f = (t - Math.floor(t)) * n;
    const i0 = Math.floor(f) % n;
    const i1 = (i0 + 1) % n;
    const a = B[i0]!, b = B[i1]!;
    if (!isFinite(a) || !isFinite(b)) return Math.min(a, b);
    f -= Math.floor(f);
    return a + (b - a) * f;
  }
}

/**
 * A flat `Float32Array` of world AABBs — six floats a box — and the two
 * queries a lens asks of them.
 *
 * The BUILD is `@homie-rocks/camera/scene.ts`'s `PropBuilder` — it walks a scene,
 * excludes the karts by identity and reads the game's own name filter, over an
 * interface of the three fields it actually needs rather than over a `Ctx`.
 * What crosses THIS seam is the answer: a packed array, and a slab test and an
 * escape that do not know or care what a kart is.
 */
export class BoxField {
  /** Six floats per box: minX minY minZ maxX maxY maxZ. The game fills it. */
  props: Float32Array | null = null;
  propCount = 0;

  /**
   * Metres of penetration a lens may be shoved back out of, and NO DEFAULT.
   *
   * 3.2 in both racers today. It is an argument anyway, for the reason
   * `lens.ts` gives about its own bounds: a package that ships a number two
   * games happen to agree on has picked one game's feel for every game that
   * ever calls this, and the frames look completely fine while it does.
   *
   * It is what stops the escape becoming a teleport. A lens genuinely 30 m
   * inside a piece of architecture is not a lens the rig can rescue by moving
   * it 30 m sideways in one frame; past this depth it stays where it is and
   * the shot is wrong for a moment instead of wrong and moving.
   */
  private readonly escapeMax: number;

  constructor(escapeMax: number) {
    this.escapeMax = escapeMax;
  }

  /**
   * Parametric distance along p0 -> p1 at which the segment first enters any
   * box, inflated by `pad`; 1 when clear. A slab test behind a six-compare AABB
   * reject over a flat array: no allocation, no raycaster, no BVH to keep warm.
   */
  propSegment(p0: THREE.Vector3, p1: THREE.Vector3, pad: number): number {
    const P = this.props;
    if (!P) return 1;
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    // A finite stand-in for 1/0: an exact zero makes the product NaN when the
    // origin sits exactly on a slab plane.
    const ix = dx !== 0 ? 1 / dx : 1e30;
    const iy = dy !== 0 ? 1 / dy : 1e30;
    const iz = dz !== 0 ? 1 / dz : 1e30;
    const qx0 = Math.min(p0.x, p1.x) - pad, qx1 = Math.max(p0.x, p1.x) + pad;
    const qy0 = Math.min(p0.y, p1.y) - pad, qy1 = Math.max(p0.y, p1.y) + pad;
    const qz0 = Math.min(p0.z, p1.z) - pad, qz1 = Math.max(p0.z, p1.z) + pad;

    let best = 1;
    for (let i = 0, o = 0; i < this.propCount; i++, o += 6) {
      const bx0 = P[o]!, by0 = P[o + 1]!, bz0 = P[o + 2]!;
      const bx1 = P[o + 3]!, by1 = P[o + 4]!, bz1 = P[o + 5]!;
      if (bx1 < qx0 || bx0 > qx1 || by1 < qy0 || by0 > qy1 || bz1 < qz0 || bz0 > qz1) continue;

      let t0 = 0, t1 = best;
      let a = (bx0 - pad - p0.x) * ix, b = (bx1 + pad - p0.x) * ix;
      if (a > b) { const s = a; a = b; b = s; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) continue;
      a = (by0 - pad - p0.y) * iy; b = (by1 + pad - p0.y) * iy;
      if (a > b) { const s = a; a = b; b = s; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) continue;
      a = (bz0 - pad - p0.z) * iz; b = (bz1 + pad - p0.z) * iz;
      if (a > b) { const s = a; a = b; b = s; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) continue;

      best = t0;
      if (best <= 0) break;
    }
    return best;
  }

  /**
   * Last resort: resolve the lens out of any box it has ended up inside.
   *
   * The escape is chosen along the direction of TRAVEL. Taking the axis of
   * least penetration instead picks, for a rig moving lengthwise through a
   * roadside box at 30 m/s, the face it just came in through — so the push
   * becomes a wall and pins the lens to a fixed world point while the kart
   * drives away from it. Up is always an exit (furniture is ground-planted) and
   * is the one exit that cannot become a wall.
   */
  propPush(p: THREE.Vector3, kart: THREE.Vector3, pad: number, travel: THREE.Vector3) {
    const P = this.props;
    if (!P) return;
    const tx = travel.x, tz = travel.z;
    const moving = Math.hypot(tx, tz) > 0.5;
    for (let i = 0, o = 0; i < this.propCount; i++, o += 6) {
      const bx0 = P[o]! - pad, by0 = P[o + 1]! - pad, bz0 = P[o + 2]! - pad;
      const bx1 = P[o + 3]! + pad, by1 = P[o + 4]! + pad, bz1 = P[o + 5]! + pad;
      if (p.x < bx0 || p.x > bx1 || p.y < by0 || p.y > by1 || p.z < bz0 || p.z > bz1) continue;
      // If the KART is in the same box the box is wrong, not the camera.
      if (kart.x >= bx0 && kart.x <= bx1 && kart.z >= bz0 && kart.z <= bz1) continue;

      const py = by1 - p.y;
      const sx = moving ? (tx >= 0 ? 1 : -1) : (p.x - bx0 < bx1 - p.x ? -1 : 1);
      const sz = moving ? (tz >= 0 ? 1 : -1) : (p.z - bz0 < bz1 - p.z ? -1 : 1);
      const px = sx > 0 ? bx1 - p.x : p.x - bx0;
      const pz = sz > 0 ? bz1 - p.z : p.z - bz0;

      if (py <= px * 1.15 && py <= pz * 1.15) { if (py <= this.escapeMax) p.y = by1; continue; }
      if (px <= pz) {
        if (px <= this.escapeMax) p.x = sx > 0 ? bx1 : bx0;
        else if (py <= this.escapeMax) p.y = by1;
        continue;
      }
      if (pz <= this.escapeMax) p.z = sz > 0 ? bz1 : bz0;
      else if (py <= this.escapeMax) p.y = by1;
    }
  }
}
