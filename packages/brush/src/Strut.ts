/**
 * ============================================================================
 *  Strut.ts — a square section stretched between two points in space.
 * ============================================================================
 *
 *  `Brush.ts` and `Collide.ts` are a world of AXIS-ALIGNED boxes; this is the
 *  one thing a box world cannot say and every box world eventually needs — a
 *  guy wire, a diagonal brace, a handrail run, a tie-down, a cable to an
 *  anchor. You can describe it without naming a single thing in any game's
 *  fiction, which is the test for shared code: *a bar of square section, from
 *  A to B.*
 *
 *  ## WHY IT IS NOT `@homie-rocks/geom`
 *
 *  It was looked for there first, and it is not there. `trs()` takes Euler
 *  angles, so a caller with two endpoints has to derive them; `anchor()`
 *  orients an `Object3D` rather than baking a geometry; `tube.ts` wants a
 *  path and returns a cylinder. What was missing is exactly the cheap one: a
 *  `BoxGeometry` whose local +Y is rotated onto B − A, baked, so it merges
 *  into a static bucket with no node and no matrix.
 *
 *  It lives HERE rather than in `@homie-rocks/geom` because a strut is only useful
 *  next to the thing it braces, and everything that braces in this repository
 *  is a brush box. If a second game wants one without a brush world, that is
 *  the argument for promoting it and the promotion is a rename.
 *
 *  ## THE ORIENTATION IS A QUATERNION AND NOT AN EULER ANGLE, AND THAT IS
 *  ## MEASURED, NOT PREFERRED
 *
 *  The two call sites this replaced did it two different ways. In the
 *  first-person shooter it came from, `guyWire` built the rotation with
 *  `setFromUnitVectors(+Y, dir)` and `faceBrace` — its neighbour, same shape,
 *  same section idea — built it with `rotateZ(±ang)` / `rotateX(±ang)` off an
 *  `atan2`. Those are different computations and this file only gets to hold
 *  one of them, so the question "do they agree" is a gate and not a shrug.
 *
 *  THEY AGREE BIT FOR BIT. A parity test runs both paths over the 52 brace
 *  shapes the game actually builds plus 20,000 random ones — 80,208
 *  geometries, position and normal, `Object.is`, no epsilon — and the count of
 *  differing floats is ZERO. It is not "close enough": the outputs are the
 *  same `Float32Array`s. That is what made collapsing two call sites onto one
 *  implementation a REFACTOR rather than a picture change, and if a three.js
 *  upgrade ever breaks it the test says so before a frame does.
 *
 *  A NOTE ON THE ONE DEGREE OF FREEDOM NOBODY IS GIVEN. There is no roll
 *  parameter. `setFromUnitVectors` picks the shortest arc, which leaves the
 *  bar's twist about its own long axis unspecified and arbitrary — fine for a
 *  square section whose four sides are the same material, WRONG the moment
 *  somebody wants an I-beam or a channel here. Adding roll later is additive;
 *  pretending the current answer is a choice would not be.
 *
 *  `three` is a peerDependency. Two copies is two `instanceof` universes.
 */
import * as THREE from 'three';

/**
 * A geometry and where it goes. `BrushKit.mesh()` takes exactly these four,
 * in this order, which is the whole reason the midpoint is returned rather
 * than baked in: `merge()` translates every piece itself, and a geometry that
 * arrived pre-translated would be moved twice.
 *
 * `x`/`y`/`z` ARE `(a + b) * 0.5` AND A CALLER THAT ALREADY KNOWS THE CENTRE
 * SHOULD USE ITS OWN. `((c + h) + (c - h)) * 0.5` is not `c` in binary
 * floating point, and the original `faceBrace` — which derives two symmetric
 * endpoints from a centre it is holding — came back one ulp low at
 * `c = -1.237839488312602`. The parity test found that, in 5,000 random
 * braces, on the first run. It is invisible in a frame and it is still a
 * digit thrown away for no reason, and a package that quietly rounds its
 * caller's coordinates is a package nobody can do exact arithmetic against.
 */
export interface StrutPlacement {
  geo: THREE.BufferGeometry;
  x: number;
  y: number;
  z: number;
}

/** Reused so a tower of forty braces does not allocate eighty vectors. */
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A bar of square section from (x0,y0,z0) to (x1,y1,z1).
 *
 * `section` is the width and depth of the bar, in metres — how thick a guy
 * wire or a brace is, is the game's look and never this file's.
 *
 * A ZERO-LENGTH STRUT IS A DEGENERATE GEOMETRY AND THIS THROWS RATHER THAN
 * RETURNING ONE. `normalize()` on a zero vector returns (0,0,0), and
 * `setFromUnitVectors` with that gives a quaternion that is not a rotation;
 * the resulting BoxGeometry has zero height, contributes NaN normals to the
 * merged buffer through `computeVertexNormals`, and the symptom is a whole
 * material bucket rendering as nothing with no error at all. A caller that
 * hands two identical points has a bug in its own coordinates and needs to
 * hear about it — this repository's standing rule that a crash gets fixed and
 * a plausible default gets quoted.
 */
export function strutBetween(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  section: number,
): StrutPlacement {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0)) {
    throw new RangeError(
      `strutBetween: zero-length strut at (${x0}, ${y0}, ${z0}) — `
      + 'a degenerate box merges as NaN normals and takes its whole bucket with it',
    );
  }
  const geo = new THREE.BoxGeometry(section, len, section);
  _dir.set(dx, dy, dz).normalize();
  geo.applyQuaternion(_q.setFromUnitVectors(UP, _dir));
  return {
    geo,
    x: (x0 + x1) * 0.5,
    y: (y0 + y1) * 0.5,
    z: (z0 + z1) * 0.5,
  };
}
