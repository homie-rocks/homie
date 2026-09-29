/**
 * The filters a camera is made of. **This file imports nothing, and that is
 * the design rather than an accident.**
 *
 * Four independent copies of the closed-form damped oscillator were measured on
 * 2026-08-19 — in two racers' cameras and in two scripts of the host runtime —
 * with three copies of `damp1` and three of `smootherstep`. The fourth
 * oscillator carries the argument for this file's whole shape, and it is the
 * reason a fifth copy would appear the moment this module took a dependency:
 * it was written out again, by hand, because the one copy that could have been
 * imported began with an import of a 365 KB renderer. Taking a WebGL library
 * as a dependency of a 3 px squash is the opposite of cheap.
 *
 * So: no `three`, no other package, no DOM. A host page that cannot afford a
 * renderer, a phone, a Node test and a game's Vite build all get the same
 * bytes, and nobody has a reason to transcribe the ODE again.
 *
 * The vector form (`damp3`) is here too, on a structurally-typed `Vec3Like`
 * rather than a `THREE.Vector3`, for the same reason: `THREE.Vector3` satisfies
 * the interface, and so does a hand-rolled `{x,y,z,set()}` on a page with no
 * three.js in it.
 *
 * **There are no tuned constants in this file.** Every omega, zeta, smooth
 * time and seed is the caller's, because AO intensity spans 1.35..5.4 and
 * exposure 1.05..1.72 across four games that all look correct, and a package
 * that ships a default for a number like that has picked one game's art
 * direction for all of them. The only literals below are the coefficients of
 * two mathematical identities and one noise shape, and those are not tuning.
 */

/** Clamp, spelled as a branch rather than `Math.min(Math.max(…))` so a NaN
 *  falls through to `hi` instead of silently becoming `lo`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Ken Perlin's quintic: zero first AND second derivative at both ends, which
 *  is what stops a move that eases in from visibly kinking as it arrives. */
export function smootherstep(x: number): number {
  x = clamp(x, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Shortest signed representation of an angle, radians. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Scalar velocity carrier for {@link damp1}. An object rather than a return
 *  tuple so the caller can hold one per axis with no allocation per frame. */
export interface Vel {
  v: number;
}

/**
 * Analytic critically-damped spring. Unconditionally stable for any dt, no
 * overshoot, and the response is a function of `smoothTime` alone rather than
 * of the frame rate.
 *
 * The `1 / (1 + x + 0.48x² + 0.235x³)` term is a rational approximation to
 * `exp(-x)` — those two coefficients are the identity, not a tuning knob, and
 * they are why this is a multiply rather than a transcendental in the frame
 * loop.
 *
 * **The failure this replaces is invisible in every still.** A per-frame lerp
 * (`cur += (target - cur) * 0.12`) composes identically at a fixed rate and
 * becomes a different game at 144 Hz — the composition stays exact while the
 * feel doubles. The rig probe's `per-frame-gain` fault is that defect,
 * re-armed, and it is the reason this function is shared rather than
 * re-typed.
 */
export function damp1(cur: number, target: number, vel: Vel, smoothTime: number, dt: number): number {
  const om = 2 / Math.max(1e-4, smoothTime);
  const x = om * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel.v + om * change) * dt;
  vel.v = (vel.v - om * temp) * e;
  return target + (change + temp) * e;
}

/**
 * The three components a vector spring needs, and nothing else.
 *
 * `THREE.Vector3` satisfies this structurally, which is what lets `damp3` live
 * in a module with no imports. So does `{ x, y, z, set }` written by hand on a
 * page that never loaded a renderer.
 */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): unknown;
}

/** Vector form of {@link damp1}; writes through `cur` and `vel`. */
export function damp3(cur: Vec3Like, target: Vec3Like, vel: Vec3Like, smoothTime: number, dt: number): void {
  const om = 2 / Math.max(1e-4, smoothTime);
  const x = om * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const cx = cur.x - target.x, cy = cur.y - target.y, cz = cur.z - target.z;
  const tx = (vel.x + om * cx) * dt, ty = (vel.y + om * cy) * dt, tz = (vel.z + om * cz) * dt;
  vel.set((vel.x - om * tx) * e, (vel.y - om * ty) * e, (vel.z - om * tz) * e);
  cur.set(target.x + (cx + tx) * e, target.y + (cy + ty) * e, target.z + (cz + tz) * e);
}

/**
 * First-order exponential lag on a time constant: `1 - exp(-dt/tau)`, exact at
 * any step size.
 *
 * Kept beside `damp1` rather than folded into it because a first-order lag and
 * a second-order spring are different animals and both are wanted — this one
 * has no velocity state, so it cannot overshoot and cannot carry momentum
 * through a target change. It is the filter written inline as
 * `x += (want - x) * (1 - Math.exp(-dt * 10))` in the first-person shooter's
 * camera and as `(1 - Math.exp(-dtc / TAU_MOVE))` six times in the
 * base-building game's camera rig.
 *
 * `tau` is the time to close 63% of the gap. Callers who think in rates pass
 * `1 / rate`.
 */
export function expApproach(cur: number, target: number, tau: number, dt: number): number {
  if (!(dt > 0)) return cur;
  return cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1e-6, tau)));
}

/**
 * Rate-limited linear approach: move toward `target` at `perSecond` units of
 * travel per second, and stop exactly on it.
 *
 * This is the first-person shooter's `approach`, restated per second. The
 * original took `s` already multiplied by `dt` at every call site, which is
 * one multiply the caller could forget — and a step that forgets it is a rate
 * that scales with the frame time, which is the `per-frame-gain` defect
 * wearing a different name.
 */
export function approach(cur: number, target: number, perSecond: number, dt: number): number {
  const s = Math.abs(perSecond) * Math.max(0, dt);
  return cur < target ? Math.min(target, cur + s) : Math.max(target, cur - s);
}

/**
 * Interpolate in log space, for a quantity that spans decades.
 *
 * The base-building game's zoom is the case and its comment is the argument:
 * *"a linear lerp from 2600 m to 3 m spends nine tenths of the move in the
 * outer half of the range and arrives as a slam."* `k` is the fraction of the remaining
 * log-distance to close, so callers pass `1 - exp(-dt/tau)` for a frame-rate
 * independent one.
 *
 * Both ends must be positive; a zero or negative distance has no logarithm and
 * the caller is told by getting `cur` back rather than a NaN that reaches a
 * projection matrix and never leaves it.
 */
export function logApproach(cur: number, target: number, k: number): number {
  if (!(cur > 0) || !(target > 0)) return cur;
  return Math.exp(Math.log(cur) + (Math.log(target) - Math.log(cur)) * clamp(k, 0, 1));
}

/**
 * Harmonic oscillator with a free damping ratio — the one filter here that is
 * allowed to overshoot, which is what gives a boost its rebound and a landing
 * its bounce. Solved in closed form for **all three damping regimes**, so it is
 * exact at any dt rather than an O(h) substepped integration.
 *
 * **The overdamped branch is not decorative.** The host runtime's copy dropped
 * it — `if (damping < 1 - 1e-4) { … } else { … }`, so ζ > 1 is silently
 * treated as ζ = 1, with no comment claiming that was a choice. Nothing there
 * passes ζ > 1 today, so it has never been wrong, **and that is exactly the
 * point**: it is a live example of the regression an extraction re-introduces
 * by taking "the shipped one". The rig probe's `drop-overdamped` fault is that
 * deletion, and it must be seen red.
 */
export class Osc {
  v = 0;
  vel = 0;

  step(target: number, omega: number, zeta: number, dt: number): number {
    if (!(dt > 0)) return this.v;
    const x0 = this.v - target;
    const v0 = this.vel;
    if (zeta < 1 - 1e-4) {
      // Underdamped: rings through the target. `wd` is the damped frequency.
      const wd = omega * Math.sqrt(1 - zeta * zeta);
      const e = Math.exp(-zeta * omega * dt);
      const c = Math.cos(wd * dt), s = Math.sin(wd * dt);
      const A = x0;
      const B = (v0 + zeta * omega * x0) / wd;
      this.v = target + e * (A * c + B * s);
      this.vel = e * ((B * wd - zeta * omega * A) * c - (A * wd + zeta * omega * B) * s);
    } else if (zeta <= 1 + 1e-4) {
      // Critically damped: the repeated-root solution. The underdamped branch
      // divides by `wd`, which is zero here, so this branch is required and
      // not merely faster.
      const e = Math.exp(-omega * dt);
      const A = x0;
      const B = v0 + omega * x0;
      this.v = target + e * (A + B * dt);
      this.vel = e * (B - omega * (A + B * dt));
    } else {
      // Overdamped: two real roots, no oscillation, a slower approach than
      // critical. Treating this as ζ = 1 does not crash and does not look
      // wrong — it just arrives at the wrong time, which is why it vanished
      // from the host's copy without anybody noticing.
      const r = omega * Math.sqrt(zeta * zeta - 1);
      const r1 = -zeta * omega + r, r2 = -zeta * omega - r;
      const c2 = (v0 - r1 * x0) / (r2 - r1);
      const c1 = x0 - c2;
      const e1 = Math.exp(r1 * dt), e2 = Math.exp(r2 * dt);
      this.v = target + c1 * e1 + c2 * e2;
      this.vel = c1 * r1 * e1 + c2 * r2 * e2;
    }
    return this.v;
  }

  kick(a: number): void { this.vel += a; }
  reset(): void { this.v = 0; this.vel = 0; }
}

/**
 * Two detuned sines: dense enough to read as shake, smooth enough not to
 * alias.
 *
 * **Deterministic in `t`, and that is the whole reason it is a function of
 * time rather than a call to `Math.random()`.** The base-building game states
 * the stake best: *"a capture with zero advance is bit-identical and two
 * captures an advance apart differ, which is exactly the freeze proof the shot
 * tool relies on."* A rig shaking on `Math.random()` cannot be photographed
 * twice the same, so every visual assertion about it is unfalsifiable — as it
 * was in the first-person shooter's camera, which had no camera harness at all
 * and so had never been asked.
 *
 * The two frequencies and the 0.62/0.38 split are the noise's shape, not a
 * per-game intensity: amplitude is the caller's, and `seed` decorrelates the
 * axes so x and y do not shake as one diagonal.
 */
export function shakeNoise(t: number, seed: number): number {
  return Math.sin(t * 27.3 + seed * 4.7) * 0.62 + Math.sin(t * 44.1 + seed * 11.3) * 0.38;
}

/**
 * Trauma that **composes** rather than letting the last request win.
 *
 * The kart racer's model, and the distinction is one line with opposite outcomes:
 * `traumaDecay = Math.min(this.traumaDecay, …)`, so a longer requested duration
 * means a *slower bleed-off, not a timer*, and two knocks 40 ms apart add up
 * instead of the second one truncating the first. The first-person shooter
 * does the other thing (`shakeT = Math.max(shakeT, seconds)`); both are legitimate and a game has to
 * keep choosing, so the choice is stated here in the name of the class rather
 * than hidden in a flag on a shared one.
 *
 * The decay bounds and the reset value are constructor arguments with no
 * defaults, deliberately: `3.3` is the kart racer's measured bleed-off for its
 * own knocks, and a package that shipped it as a default would have picked one
 * game's feel for every game that ever calls this.
 */
export class Trauma {
  private amount = 0;
  private decay: number;
  /** Bleed-off per second when nothing is asking for a longer one. */
  private readonly baseDecay: number;
  /** Floor and ceiling on the derived decay rate. A request of zero seconds
   *  would otherwise divide by nothing, and one of ten seconds would leave a
   *  shake running long after the round ended. */
  private readonly decayMin: number;
  private readonly decayMax: number;

  constructor(baseDecay: number, decayMin: number, decayMax: number) {
    this.baseDecay = baseDecay;
    this.decayMin = decayMin;
    this.decayMax = decayMax;
    this.decay = baseDecay;
  }

  add(amount: number, seconds: number): void {
    this.amount = Math.min(1, this.amount + amount);
    this.decay = Math.min(this.decay, clamp(1 / Math.max(0.08, seconds), this.decayMin, this.decayMax));
  }

  /** Decays the trauma and returns the shake amplitude, 0 when there is none.
   *  Squared falloff: small knocks stay subtle, big ones hit hard. */
  step(dt: number): number {
    if (this.amount <= 0) { this.decay = this.baseDecay; return 0; }
    this.amount = Math.max(0, this.amount - this.decay * dt);
    if (this.amount <= 0) { this.decay = this.baseDecay; return 0; }
    return this.amount * this.amount;
  }

  reset(): void { this.amount = 0; this.decay = this.baseDecay; }
}
