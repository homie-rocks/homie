/**
 * ============================================================================
 *  Horizon.ts — what a point on a heightfield can see of the sky, and whether
 *  the sun ever reaches it.
 * ============================================================================
 *
 *  WHY THIS IS A PACKAGE CAPABILITY AND NOT A MOON THING.
 *
 *  It answers a question every outdoor world has and only one of the games this
 *  was extracted from had bothered to ask: for each cell, march outward along a
 *  fan of azimuths, track the maximum elevation angle of the terrain along each
 *  bearing, and fall out with two numbers.
 *
 *   · SKY VIEW — the mean of cos²(horizon) over azimuth. A real sky-view
 *     factor, i.e. kilometre-scale ambient occlusion. Valley floors receive
 *     less bounced light because they can see less of the sky, and that is the
 *     grounding cue that keeps working when the screen-space AO pass is off on
 *     a weaker machine. Any game with a bowl, a canyon, a hollow or a ridge
 *     wants it and three of those games have one.
 *   · NEVER LIT — if the horizon exceeds `sunElev` at EVERY azimuth then no
 *     sun at any point in the day can reach this cell. A lunar game uses it for
 *     permanently shadowed regions, DERIVED rather than painted, which is why
 *     its ice map and its lighting agree with each other for free. On Earth it
 *     is the north face that never dries.
 *
 *  IT WAS WRITTEN TWICE, VERBATIM, INSIDE ONE FUNCTION. One game's occlusion
 *  bake ran this march over the playfield and then ran a byte-identical copy
 *  of it over the far field at a coarser pitch, and then softened both results
 *  with two more byte-identical copies of a 3x3 mean. Four copies of two
 *  mechanisms in one function is what the "is there a twin" question cannot
 *  see and what "does this belong in a game" finds immediately.
 *
 *  THE HEIGHT FUNCTION IS A CALLBACK AND THAT IS THE LOAD-BEARING PART. Most of
 *  the march's samples land OUTSIDE the grid being baked: one game's near bake
 *  takes 21 million samples and the great majority are past the map edge, out
 *  in the surrounding crater bowl. A bake that could only read its own grid
 *  would judge a floor cell sunlit from the bearing of a wall it cannot see,
 *  and the shadow mask would have a hole in it. So the caller supplies "height
 *  anywhere", and how it answers outside its own data — analytically, from a
 *  coarse cache, or by clamping — is the world's business.
 * ============================================================================
 */

/** How the fan is thrown and what counts as blocked. */
export interface HorizonOpts {
  /** Bearings per cell. 24 is 15 degrees apart and is what one game measured. */
  azimuths: number;
  /** Samples along each bearing. */
  steps: number;
  /**
   * Distance of the FIRST sample, metres.
   *
   * NOT small, and one game paid for the lesson: this answers a KILOMETRE
   * scale question, and at 6 m the nearest sample was close enough for a
   * metre-scale bump to set the horizon — a 0.55 m craterlet rim 6 m away
   * subtends 5.2 degrees and clears any plausible sun elevation all by itself.
   * At 20 m the same rim subtends 1.7 degrees and cannot vote, while a crater
   * wall still does.
   */
  first: number;
  /**
   * Geometric growth per step. A geometric march resolves a rim 100 m away and
   * still reaches the opposite wall 5 km out for a fifth of the samples a
   * uniform march would need.
   */
  growth: number;
  /** Height of the observer above the surface, metres. A standing eye. */
  eye: number;
  /**
   * Planet radius for the curvature drop, metres. Pass `Infinity` for a flat
   * world and the term costs one divide and contributes exactly zero.
   *
   * It is not a rounding detail: at 5 km on the Moon the drop is 7.2 m, which
   * is enough to hide a low far wall that would otherwise falsely block the
   * sun for every cell on the plain.
   */
  radius: number;
  /**
   * Elevation, radians, below which the light source cannot clear the horizon.
   * A cell whose horizon exceeds this at every azimuth is never lit.
   */
  sunElev: number;
}

/** Where the answers go, and the grid they are answered on. */
export interface HorizonTarget {
  /** Posts per side. */
  n: number;
  /** Metres between posts. */
  step: number;
  /** World coordinate of post 0 on both axes is `-half`. */
  half: number;
  /** 1 where the sun never reaches, 0 where it does. `n * n`. */
  neverLit: Float32Array;
  /** Sky-view factor 0..1. `n * n`. */
  skyView: Float32Array;
}

/**
 * March the horizon over every cell of `t` and write both fields.
 *
 * `height` is asked for a height at an ARBITRARY world point, well outside
 * `t`'s own extent. See the header.
 */
export function horizonBake(t: HorizonTarget, height: (x: number, z: number) => number, o: HorizonOpts): void {
  const az = o.azimuths;
  const cosA = new Float32Array(az), sinA = new Float32Array(az);
  for (let a = 0; a < az; a++) {
    const th = (a / az) * Math.PI * 2;
    cosA[a] = Math.cos(th); sinA[a] = Math.sin(th);
  }

  const dist = new Float32Array(o.steps);
  let d = 0, ds = o.first;
  for (let s = 0; s < o.steps; s++) { d += ds; dist[s] = d; ds *= o.growth; }

  const twoR = 2 * o.radius;
  for (let j = 0; j < t.n; j++) {
    const z0 = j * t.step - t.half;
    for (let i = 0; i < t.n; i++) {
      const x0 = i * t.step - t.half;
      const h0 = height(x0, z0) + o.eye;
      let shadowed = 1;
      let sky = 0;
      for (let a = 0; a < az; a++) {
        // -1 rather than -Infinity: a horizon below 45 degrees BELOW the
        // observer is not a horizon, and seeding at -1 keeps the tangent
        // finite so `atan` cannot be handed a NaN from an empty march.
        let maxT = -1;
        for (let s = 0; s < o.steps; s++) {
          const r = dist[s]!;
          const hx = height(x0 + cosA[a]! * r, z0 + sinA[a]! * r);
          const tan = (hx - h0 - (r * r) / twoR) / r;
          if (tan > maxT) maxT = tan;
        }
        const elev = Math.atan(maxT);
        if (elev < o.sunElev) shadowed = 0;
        // cos² of the horizon elevation, and the `max(0, …)` is what stops a
        // cell on a peak — whose horizon is BELOW it — from being credited
        // with more than a full hemisphere of sky.
        const c = Math.cos(Math.max(0, elev));
        sky += c * c;
      }
      t.neverLit[j * t.n + i] = shadowed;
      t.skyView[j * t.n + i] = sky / az;
    }
  }
}
