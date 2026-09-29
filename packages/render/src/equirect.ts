/**
 * ============================================================================
 *  equirect — the four operations a baked sphere texture needs.
 * ============================================================================
 *  Anything procedurally textured as a SPHERE gets baked in an equirectangular
 *  grid and then resampled onto a cube map, and that route has exactly four
 *  hazards. All four are properties of the PROJECTION, not of the planet:
 *
 *   1. Longitude WRAPS and latitude does not, so a bilinear tap has to do two
 *      different things on its two axes. Get it wrong and there is a hard
 *      vertical seam at the antimeridian.
 *   2. The grid is SINGULAR AT THE POLE — every texel of the top row is the
 *      same physical point — so any longitude-varying content there is a
 *      contradiction, and resampling turns it into a radial starburst.
 *   3. A blur has to wrap in x and clamp in y for the same reason as (1).
 *   4. The six cube faces have a handedness table that is easy to get wrong in
 *      a way that mirrors ONE continent and survives review.
 *
 *  Arrived from a base-building game's Earth renderer — Earth, painted from
 *  coastline rings. The starburst in (2) is not a story about Earth: it duly
 *  appeared on the north pole of the baked +Y face, it survived capping the
 *  coastline warp that seemed to feed it, and the fix is a property of the
 *  projection. The next moon, the next gas giant and the next painted skydome
 *  all meet the same four.
 *
 *  The width and height are ARGUMENTS, not module constants — that is the only
 *  change from the game's version, which closed over its own 1024x512.
 * ============================================================================
 */

/** Sample a wrapped equirect field bilinearly, in [0,1] uv. */
export function sampleEq(
  field: Float32Array, w: number, h: number, u: number, v: number,
): number {
  const x = u * w - 0.5;
  const y = Math.min(Math.max(v * h - 0.5, 0), h - 1.001);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const xa = ((x0 % w) + w) % w;
  const xb = ((x0 + 1) % w + w) % w;
  const ya = y0;
  const yb = Math.min(y0 + 1, h - 1);
  const a = field[ya * w + xa]!;
  const b = field[ya * w + xb]!;
  const c = field[yb * w + xa]!;
  const d = field[yb * w + xb]!;
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/**
 * Collapse an equirect field toward its own row mean near the poles, in place.
 *
 * AN EQUIRECT GRID IS GENUINELY SINGULAR AT THE POLE. Above `latStart` degrees
 * the field is blended toward the mean of its own row, reaching a pure constant
 * by `latEnd`, so the pole is single-valued BY CONSTRUCTION and no resampling
 * of any kind can produce structure there. Apply it to every channel: the fault
 * belongs to the projection and not to any one of them.
 *
 * Both latitudes are required. A default here would be one planet's tuning
 * silently applied to the next one's texture size.
 */
export function polarCollapse(
  field: Float32Array, w: number, h: number, latStart: number, latEnd: number,
): void {
  for (let y = 0; y < h; y++) {
    const lat = Math.abs(90 - (y + 0.5) / h * 180);
    const t = Math.min(Math.max((lat - latStart) / (latEnd - latStart), 0), 1);
    const k = t * t * (3 - 2 * t);
    if (k <= 0) continue;
    let mean = 0;
    for (let x = 0; x < w; x++) mean += field[y * w + x]!;
    mean /= w;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      field[i]! += (mean - field[i]!) * k;
    }
  }
}

/**
 * Separable box blur, wrapping in longitude and clamping in latitude.
 *
 * IN PLACE on `src` — callers pass a copy when they still need the original.
 * Three box passes approximate a Gaussian closely enough that the difference is
 * invisible in a soft field, at a twentieth of the cost.
 */
export function blurEq(
  src: Float32Array, w: number, h: number, radius: number, passes: number,
): Float32Array {
  const a = src;
  const b = new Float32Array(w * h);
  for (let p = 0; p < passes; p++) {
    // horizontal, wrapped
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) {
          s += a[row + (((x + k) % w) + w) % w]!;
        }
        b[row + x] = s / (radius * 2 + 1);
      }
    }
    // vertical, clamped
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = Math.min(Math.max(y + k, 0), h - 1);
          s += b[yy * w + x]!;
        }
        a[y * w + x] = s / (radius * 2 + 1);
      }
    }
  }
  // The vertical pass writes back into `a`, so `a` always holds the result and
  // `b` is scratch. Returned for readability at the call site.
  return a;
}

/** Exactly the one method of a Vector3 the face basis needs. */
export interface Vec3Out { set(x: number, y: number, z: number): unknown; }

/**
 * The six cube-face direction bases, in the OpenGL cube-map convention,
 * indexed +X, -X, +Y, -Y, +Z, -Z.
 *
 * Derived by inverting the spec's (major axis, sc, tc) table rather than being
 * guessed, because getting one face's handedness wrong produces a sphere that
 * looks almost right and has one MIRRORED feature — a fault that survives
 * review. three's `CubeTexture` sets `flipY = false`, so canvas row 0 really is
 * t = 0.
 */
export const FACE_BASIS: ((s: number, t: number, out: Vec3Out) => void)[] = [
  (s, t, o) => o.set(1, -(2 * t - 1), -(2 * s - 1)),   // +X
  (s, t, o) => o.set(-1, -(2 * t - 1), (2 * s - 1)),   // -X
  (s, t, o) => o.set((2 * s - 1), 1, (2 * t - 1)),     // +Y
  (s, t, o) => o.set((2 * s - 1), -1, -(2 * t - 1)),   // -Y
  (s, t, o) => o.set((2 * s - 1), -(2 * t - 1), 1),    // +Z
  (s, t, o) => o.set(-(2 * s - 1), -(2 * t - 1), -1),  // -Z
];

/**
 * Where a cube-face texel lands on an equirectangular field, in the BODY frame.
 *
 * `u` wraps at the +X meridian and `v` runs 0 at the north pole to 1 at the
 * south, which is the convention `sampleEq` and `polarCollapse` are written in.
 * The clamp on `y` is not decoration: a direction one ulp outside the unit
 * sphere makes `asin` return NaN, and a NaN `v` samples row NaN, which
 * `sampleEq` turns into a texel from somewhere unrelated rather than an error.
 */
export function dirToEquirect(x: number, y: number, z: number, out: { u: number; v: number }): void {
  out.u = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
  out.v = 0.5 - Math.asin(Math.min(Math.max(y, -1), 1)) / Math.PI;
}

/**
 * Resample equirectangular fields into ONE square cube-face canvas.
 *
 * `write` is handed the texel's own (u, v) on the equirect and the byte offset
 * into this face's `ImageData`, and writes the four channels itself. Everything
 * about WHAT is being resampled — how many fields, which channel each lands in,
 * whether it is encoded or raw, what alpha means — is the caller's, because
 * those are the four decisions that are always about the thing being baked and
 * never about the projection.
 *
 * ONE FACE PER CALL, AND THE SIX-FACE LOOP IS THE CALLER'S. That is not a
 * smaller API for its own sake; it was MEASURED. A game here bakes two cube
 * textures from one field set — a 512-square albedo and a 256-square data map —
 * and the loop it had written them in was interleaved: day face 0, aux face 0,
 * day face 1, and so on. A six-at-a-time version of this function reordered
 * that to six days then six auxes, and its output was byte-identical over all
 * twelve faces at the shipped sizes... and the game's held NIGHT frame moved.
 * Six 512-square canvases alive at once instead of one is 6 MB of peak, and
 * this game settles its capture in WALL-CLOCK milliseconds against a fixture
 * scan on a 120-FRAME interval, so a boot-cost shift of that size lands the
 * shutter on a different number of lights. The pixels were provably identical
 * and the picture still changed. Owning the loop is what lets a caller keep its
 * own allocation shape.
 *
 * ALPHA IS THE CALLER'S TOO AND IT IS A TRAP. A canvas backing store is
 * PREMULTIPLIED, so any alpha under 255 quantises the RGB it is carrying; a
 * field written at alpha 5 comes back with its colour destroyed. A game
 * carrying a mask in the alpha channel of a cube face has to put it somewhere
 * else. This cannot enforce that, so it says it.
 *
 * The direction is normalised before projection: the face bases return a vector
 * on the CUBE, not on the sphere, and skipping the normalise pulls every texel
 * toward the face centre — a smooth distortion nobody sees until a coastline is
 * compared against a map.
 */
const _eqDir = {
  x: 0, y: 0, z: 0,
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; },
};
const _eqUv = { u: 0, v: 0 };

export function equirectCubeFace(
  size: number,
  face: number,
  write: (u: number, v: number, data: Uint8ClampedArray, k: number) => void,
): HTMLCanvasElement {
  const basis = FACE_BASIS[face] as (s: number, t: number, out: Vec3Out) => void;
  if (basis === undefined) throw new RangeError(`equirectCubeFace: face ${face} is not 0..5`);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  if (ctx === null) throw new Error('equirectCubeFace: no 2d context');
  const img = ctx.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      basis((i + 0.5) / size, (j + 0.5) / size, _eqDir);
      // `Vector3.normalize()` to the bit: sqrt of the sum, `|| 1`, then a
      // MULTIPLY by the reciprocal. `Math.hypot` and a divide are each a
      // different last ulp, and a cube face is a million texels of them.
      const inv = 1 / (Math.sqrt(
        _eqDir.x * _eqDir.x + _eqDir.y * _eqDir.y + _eqDir.z * _eqDir.z) || 1);
      dirToEquirect(_eqDir.x * inv, _eqDir.y * inv, _eqDir.z * inv, _eqUv);
      write(_eqUv.u, _eqUv.v, img.data, (j * size + i) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
