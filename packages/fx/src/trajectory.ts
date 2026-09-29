/**
 * ============================================================================
 *  trajectory.ts — how far a thrown grain goes, on whichever world it was
 *  thrown on, and how long it is in the air.
 * ============================================================================
 *
 *  NAMED trajectory AND NOT ballistic, AND THAT IS NOT A PREFERENCE. This file
 *  and `Ballistic.ts` — the GPU-integrated particle ring, a class and two
 *  shader chunks — live in the same package, and on a case-insensitive volume
 *  (the macOS default) `ballistic.ts` and `Ballistic.ts` are ONE FILE. Git
 *  happily records both; the checkout keeps whichever landed last and the
 *  other's exports simply vanish, which is a build error if you are lucky and a
 *  silently different module if you are not. Two different things, two names
 *  that cannot collide.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **An emitter can size its own lifetimes and its own ranges against the same
 *   arithmetic the thing it is emitting will actually follow, instead of
 *   guessing — and a test can check the number the comment claims.**
 *
 * ## Why it is here, and it is not the size of the file
 *
 * The base-building game this came from had `flightRange` in one file and
 * `blastRange` in another: THE SAME EXPRESSION, character for character, under
 * two names, in two files in one directory. That is the defect
 * `@homie-rocks/fx/ParticleAtlas.ts`'s header names in its own first paragraph
 * — *"the SAME FUNCTION UNDER A DIFFERENT FILENAME, so every scan that compared
 * files by name scored it as unique code"* — and it is why "is there a twin" is
 * the wrong question. There were two twins inside the one game.
 *
 * AND NEITHER HAD A CALLER. Both comments said the export existed so a harness
 * could assert against it; `blastRange`'s said so in as many words — *"a
 * harness can call this and assert 40 m/s at 5 degrees really does travel
 * 171 m on this world"* — and no harness ever did. The repair is not deletion:
 * the arithmetic is right, the claim it supports is checkable, and the reason
 * to publish it rather than delete it is that this package's tests now MAKE
 * the check the comments asked for. A number nobody checked but could is one
 * change away from being fine.
 *
 * ## `g` IS AN ARGUMENT AND HAS NO DEFAULT
 *
 * The game's copies closed over its own `G_MOON = 1.62`. A default of 9.81 here
 * would be Earth's art direction shipped as a constant, and a default of 1.62
 * would be one game's moon shipped as physics. The caller names its own world,
 * every time, and the two-copy history above is exactly what a shared default
 * would have quietly re-created.
 *
 * ## What is NOT here
 *
 * Drag, and it is not an omission. On an airless world drag is not zero, it is
 * INEXPRESSIBLE, because the moment a coefficient exists a later edit can set
 * it, and dust that drifts is an automatic fail of that world's art direction.
 * A game in air integrates its own; these three are the vacuum closed forms and
 * say so.
 *
 * Also not folded in: the LANDING solve against a tilted plane. It takes a
 * plane normal and is genuinely a different function, and merging it into
 * `flightTime` would give one caller the other's surface. It is
 * `planeImpactTime` below, kept as its own function.
 */

/**
 * Seconds a projectile launched at `speed` and `elevation` spends in the air
 * before returning to the height it left from.
 *
 * @param speed     m/s
 * @param elevation radians above the horizontal
 * @param g         m/s² on this world. No default — see the header.
 */
export function flightTime(speed: number, elevation: number, g: number): number {
  return (2 * speed * Math.sin(elevation)) / g;
}

/** Horizontal range over that flight, metres. Same arguments. */
export function flightRange(speed: number, elevation: number, g: number): number {
  return (speed * speed * Math.sin(2 * elevation)) / g;
}

/**
 * Height of the top of that arc above the launch point, metres.
 *
 * The third member, and it is here because it is the one an emitter actually
 * needs and neither game had: a sprite pool sizing a bounding volume, or an
 * effect deciding whether a plume will reach the camera, wants the apex rather
 * than the range, and without it the two above get used as a proxy for it.
 */
export function flightApex(speed: number, elevation: number, g: number): number {
  const vy = speed * Math.sin(elevation);
  return (vy * vy) / (2 * g);
}

/**
 * Time at which a ballistic particle first meets an ARBITRARILY TILTED plane,
 * in closed form. Taken from a low-gravity base-building game's particle pool.
 *
 * The plane passes through `(px, groundY, pz)` — the point the emitter probed
 * directly beneath its spawn point — with unit-ish normal `(nx, ny, nz)`; the
 * normal is renormalised here so a caller may hand over a terrain gradient
 * without doing it first.
 *
 * SOLVED AGAINST THE ACTUAL TILT, NOT A HORIZONTAL PLANE, and that is the
 * whole reason it is fifteen lines rather than three. The general form of the
 * mistake was measured: a rigid span placed from ONE sampled frame
 * left the surface by 36.8 m at both ends, because the error of a flat
 * assumption grows quadratically away from the anchor. At particle scale the
 * same error is a boot puff floating a metre above a crater wall or buried in
 * it, which is roughly a two-thirds-of-a-metre miss across a 2 m puff on a 20°
 * slope — exactly the width of a hard intersection line.
 *
 * With p(t) = p0 + v·t − ½g·t²·ŷ and plane (n, d), n·p(t) + d = 0 gives
 *   A·t² + B·t + C = 0,  A = −½·g·n.y,  B = n·v,  C = n·p0 + d
 * and the answer is the smallest strictly positive root.
 *
 * @param g surface gravity, m/s². REQUIRED and there is no default: 1.62 here
 *   would hand the next world the Moon's, and 9.81 would hand the Moon Earth's.
 * @returns seconds; 0 when the particle spawned on or under the surface, and
 *   1e9 when it never meets the plane at all — an emitter forty metres up a
 *   hull, a vertical plane it is travelling away from, a shot that misses. The
 *   sentinel is deliberately a huge finite number rather than `Infinity`: it is
 *   written into a Float32 vertex attribute, where `Infinity` propagates NaN
 *   through the first multiply and blanks the sprite with nothing logged.
 */
export function planeImpactTime(
  px: number, py: number, pz: number,
  vx: number, vy: number, vz: number,
  groundY: number, nx: number, ny: number, nz: number,
  g: number,
): number {
  if (groundY <= -1e3) return 1e9;
  const nl = Math.hypot(nx, ny, nz) || 1;
  const ux = nx / nl, uy = ny / nl, uz = nz / nl;
  const d = -(ux * px + uy * groundY + uz * pz);
  const A = -0.5 * g * uy;
  const B = ux * vx + uy * vy + uz * vz;
  const C = ux * px + uy * py + uz * pz + d;
  if (C <= 0) return 0;                       // spawned on or under the surface
  if (Math.abs(A) < 1e-6) {                   // vertical plane: linear solve
    return B < -1e-6 ? -C / B : 1e9;
  }
  const disc = B * B - 4 * A * C;
  if (disc < 0) return 1e9;                   // never reaches it
  const sq = Math.sqrt(disc);
  const t0 = (-B - sq) / (2 * A);
  const t1 = (-B + sq) / (2 * A);
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  if (lo > 1e-5) return lo;
  if (hi > 1e-5) return hi;
  return 1e9;
}
