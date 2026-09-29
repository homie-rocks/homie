/**
 * ============================================================================
 *  keyframe.ts — sampling a hand-authored camera timeline: a cardinal spline
 *  through unevenly-spaced keys, and an ease ramp that is a REPARAMETERISATION
 *  rather than a curve applied to the value.
 * ============================================================================
 *
 * `cinematics.ts` poses a camera for a known moment — an intro, a finish cut,
 * an orbit. This is the layer under a hand-authored SHOT: somebody typed a
 * table of keys with a normalised position `p` on each one, and something has
 * to read a number out of it at time t.
 *
 * ## The outcome this file owns
 *
 *   **A channel sampled between two authored keys arrives with the tangent the
 *   keys either side of it imply, and a shot that eases in and out still lasts
 *   exactly as long as it was authored to.**
 *
 * ## Why it is here rather than in the game that wrote it
 *
 * Neither function names a shot, a subject or a world. `sampleKeys` knows that
 * a key has a position and some numeric channels; `easeRamp` knows a fraction
 * and two ramp widths. One game's trailer carried both beside a 60-second shot
 * list, which is the shape of the engine's test for what belongs in a package:
 * describe it without naming the game's fiction and it is platform.
 *
 * ## THE EASE IS NOT A CURVE ON THE OUTPUT, AND THAT IS THE WHOLE POINT
 *
 * The obvious way to soften a dolly is `t = smoothstep(t)` and then sample. It
 * is wrong for a shot with an authored duration: smoothstep spends the same
 * total time but it makes the MIDDLE fast, so a beat with a 14 % head ramp and
 * a 22 % tail ramp reads as a lurch through the interesting part.
 *
 * What a camera operator means by "ease in over the first sixth" is a VELOCITY
 * profile: hold zero, ramp up, cruise, ramp down. Integrating that profile and
 * normalising by its total gives the position at time t — which is arc-length
 * reparameterisation, and it preserves the authored duration exactly because
 * the divisor is the whole integral. The rectangle rule at `steps` samples is
 * plenty: the profile is C1 and the error is under a tenth of a frame's travel
 * at the default.
 *
 * `steps` IS A REAL PARAMETER AND IT IS NOT WELDED. A caller wanting a cheaper
 * or a finer integration passes its own, and different values produce different
 * numbers — a parity probe asserts exactly that, because an extracted option
 * that no call site can move is an option that was deleted. The DEFAULT is 256
 * because that is the value the existing ramps were authored against, and
 * changing it would retune every shot already written.
 *
 * ## What is NOT here
 *
 * No `THREE` import, no camera, no clamp band. A game's shot list, its named
 * poses, its subject table and the frame it interprets `u`/`v` in all stay in
 * the game — those are the shot, and the shot is art direction.
 */

/** Anything a timeline samples: a normalised position and some channels. */
export interface TimeKey {
  /** 0..1 along the beat. Must be non-decreasing across the array. */
  readonly p: number;
}

/**
 * A cardinal (Catmull-Rom) spline through `keys`, on one numeric channel, at
 * normalised time `t`.
 *
 * The tangents are the finite differences over the NEIGHBOURING keys' own
 * spacing rather than over the segment being sampled, so unevenly-spaced keys
 * — which is what a hand-authored table always is — do not kink at the joins.
 * Endpoints duplicate, which gives a clamped rather than a wrapping curve: a
 * shot does not loop.
 *
 * The channel is read through `Number()` on purpose. A key table authored for a
 * camera carries non-numeric fields beside the numeric ones (which subject to
 * aim at, for instance) and a caller asking for a channel that is absent on the
 * key gets `NaN` rather than a silent zero — a caller wanting a default tests
 * for the channel before asking, which is cheaper than this function guessing.
 */
export function sampleKeys<K extends TimeKey>(keys: readonly K[], channel: keyof K, t: number): number {
  const n = keys.length;
  if (n === 1) return Number(keys[0]![channel]);
  let j = 0;
  while (j < n - 2 && t > keys[j + 1]!.p) j++;
  const p0 = keys[Math.max(0, j - 1)]!;
  const p1 = keys[j]!;
  const p2 = keys[j + 1]!;
  const p3 = keys[Math.min(n - 1, j + 2)]!;
  const h = Math.max(1e-6, p2.p - p1.p);
  const s = Math.min(1, Math.max(0, (t - p1.p) / h));
  const v1 = Number(p1[channel]);
  const v2 = Number(p2[channel]);
  const m1 = (v2 - Number(p0[channel])) / Math.max(1e-6, p2.p - p0.p) * h;
  const m2 = (Number(p3[channel]) - v1) / Math.max(1e-6, p3.p - p1.p) * h;
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v1 + (s3 - 2 * s2 + s) * m1
    + (-2 * s3 + 3 * s2) * v2 + (s3 - s2) * m2;
}

/**
 * Reparameterise `t` so a beat accelerates over its first `head` and decelerates
 * over its last `tail`, both as fractions of the beat, WITHOUT changing how long
 * the beat takes. See the header: this integrates a velocity profile and divides
 * by its total, which is what makes the duration survive.
 *
 * `head` and `tail` of 0 disable their end. `steps` is the integration
 * resolution and is a genuine knob — see the header.
 */
export function easeRamp(t: number, head: number, tail: number, steps = 256): number {
  t = Math.min(1, Math.max(0, t));
  const s = (x: number) => x * x * (3 - 2 * x);
  const vel = (x: number) => {
    if (head > 0 && x < head) return s(x / head);
    if (tail > 0 && x > 1 - tail) return s((1 - x) / tail);
    return 1;
  };
  const N = steps;
  let acc = 0, total = 0;
  const want = t * N;
  for (let k = 0; k < N; k++) {
    const v = vel((k + 0.5) / N);
    if (k < want) acc += v * Math.min(1, want - k);
    total += v;
  }
  return total === 0 ? t : acc / total;
}
