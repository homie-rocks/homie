/**
 * ============================================================================
 *  BallisticDust — a pool of grains thrown from a ring, integrated on the GPU.
 * ============================================================================
 *  The CPU half of an ejecta sheet: a fixed pool of instanced quads, a ring
 *  emitter, a closed-form time of flight, and a recycling cursor. The MATERIAL
 *  IS NOT HERE — `@homie-rocks/fx/Plumes.ts` made the same split for the same reason,
 *  and its header is the argument: the pooled buffer was the same in two games
 *  and the shader was not, so merging the shaders would have been a flag that
 *  changes behaviour inside a shared function.
 *
 *  ── THE POINT: THERE IS NO PER-FRAME CPU WORK. ─────────────────────────────
 *  Every grain's position is a pure function of `t`, evaluated in the vertex
 *  shader from four attributes written once at spawn:
 *
 *      aOrigin  where it left the ground
 *      aVel     the launch velocity
 *      aInfo    (spawn time, time of flight, size)
 *      aTint    linear colour, baked at spawn
 *
 *  `aInfo.y` is the closed-form time of flight back to the ground, solved HERE
 *  rather than tested per frame in the shader. That single number is what lets
 *  nine thousand grains cost one draw call and zero updates: the shader knows
 *  when a grain lands without anybody telling it, and the caller never touches
 *  the buffer again.
 *
 *  It also means the pool needs no free list and no compaction. The cursor
 *  simply walks, and an overwritten grain is one that was going to be recycled
 *  anyway; `live` reports the seconds until the last-spawned grain has
 *  certainly settled, which is all a caller needs to hide the mesh.
 *
 *  `aInfo.y` DEFAULTS TO 0, so an untouched slot lands instantly and fades: the
 *  pool starts fully invisible with no separate initialisation pass.
 *
 *  ── THE DISTRIBUTIONS ARE SKEWED, AND THAT IS NOT A DETAIL ─────────────────
 *  Uniform speed gives an obviously artificial even-density ring. Skewed hard
 *  toward the slow end, a few grains go a very long way and most stay near the
 *  source, which is what an ejecta sheet actually looks like. Both exponents
 *  are arguments, along with the azimuthal scatter that stops the sheet reading
 *  as a perfect expanding disc.
 *
 *  ── WHAT IS DELIBERATELY THE CALLER'S ──────────────────────────────────────
 *  · GRAVITY. It is the whole shape of the arc.
 *  · THE ELEVATION RANGE, which is the difference between a lunar ejecta sheet
 *    that never rises above knee height and a terrestrial dust cloud.
 *  · THE TINT, through a callback given the grain's NEARNESS to the source
 *    (1 at the centre, 0 at the outer radius) and the same RNG stream, so a
 *    caller can light near grains by its own source and far ones by the sky
 *    without a second pass. A colour constant in here would hand the next
 *    world this one's regolith.
 *  · THE RNG. Passed in, so a capture bakes the identical sheet twice.
 *
 *  EIGHT DRAWS FROM THE STREAM PER GRAIN, IN THIS ORDER: azimuth, radius,
 *  rise, speed, elevation, scatter, size, then whatever the tint callback
 *  takes. Reordering them reseeds every grain in a scene at once, which is a
 *  different picture with no diff to show for it.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';

export interface DustBurst {
  /** centre of the ring, world space. `y` is the ground the grains leave. */
  x: number;
  y: number;
  z: number;
  /** inner and outer radius of the emitting annulus */
  r0: number;
  r1: number;
  speedLo: number;
  speedHi: number;
  /** exponent skewing speed toward the low end. 1 is uniform. */
  speedSkew: number;
  /** launch elevation above horizontal, radians */
  elevLo: number;
  elevHi: number;
  elevSkew: number;
  sizeLo: number;
  sizeHi: number;
  /** full width of the azimuthal scatter off radial, radians */
  scatter: number;
  /** vertical jitter on the spawn point, metres */
  rise: number;
  /**
   * Seconds ADDED to the last grain's time of flight before `live` expires.
   *
   * Not a nicety: the shader fades a grain out after it lands, so a caller that
   * hides the mesh on the frame the last one touches down cuts the whole sheet
   * off mid-settle. It is the caller's because it is the caller's fade.
   */
  tailFade: number;
  /**
   * Linear colour for a grain, written into `out`. `near` is 1 at the centre
   * of the ring and 0 at its outer radius.
   */
  tint: (near: number, rnd: () => number, out: Float32Array) => void;
}

const _tint = new Float32Array(3);

export class BallisticDust {
  readonly geometry: THREE.InstancedBufferGeometry;
  /** seconds until the last-spawned grain has certainly settled */
  live = 0;

  private readonly max: number;
  private readonly rnd: () => number;
  private readonly gravity: number;
  private readonly aOrigin: THREE.InstancedBufferAttribute;
  private readonly aVel: THREE.InstancedBufferAttribute;
  private readonly aInfo: THREE.InstancedBufferAttribute;
  private readonly aTint: THREE.InstancedBufferAttribute;
  private cursor = 0;

  constructor(max: number, gravity: number, rnd: () => number) {
    this.max = max;
    this.gravity = gravity;
    this.rnd = rnd;
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    g.setIndex(quad.getIndex());
    quad.dispose();
    const attr = () => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aOrigin = attr();
    this.aVel = attr();
    this.aInfo = attr();
    this.aTint = attr();
    g.setAttribute('aOrigin', this.aOrigin);
    g.setAttribute('aVel', this.aVel);
    g.setAttribute('aInfo', this.aInfo);
    g.setAttribute('aTint', this.aTint);
    g.instanceCount = max;
    // Every grain's position is computed in the vertex shader, so the CPU-side
    // bounds are meaningless. Culling on them would blink the whole sheet out.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = g;
  }

  /** Throw `n` grains. `clock` is the caller's own sim clock, never wall clock. */
  emit(n: number, clock: number, b: DustBurst): void {
    if (n <= 0) return;
    const G = this.gravity;
    const rnd = this.rnd;
    let maxLife = 0;
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;

      const az = rnd() * Math.PI * 2;
      // sqrt of a uniform gives an EVEN AREA density across the annulus. A raw
      // uniform crowds the inner edge, which reads as a bullseye.
      const rr = b.r0 + (b.r1 - b.r0) * Math.sqrt(rnd());
      const ox = b.x + Math.cos(az) * rr;
      const oz = b.z + Math.sin(az) * rr;
      const oy = b.y + rnd() * b.rise;

      const sp = b.speedLo + (b.speedHi - b.speedLo) * Math.pow(rnd(), b.speedSkew);
      const el = b.elevLo + (b.elevHi - b.elevLo) * Math.pow(rnd(), b.elevSkew);
      const ce = Math.cos(el);
      const se = Math.sin(el);
      // Radially outward, with a little scatter so the sheet has structure
      // rather than reading as a perfect expanding disc.
      const spread = (rnd() - 0.5) * b.scatter;
      const dx = Math.cos(az + spread);
      const dz = Math.sin(az + spread);

      const vx = dx * sp * ce;
      const vy = sp * se;
      const vz = dz * sp * ce;

      // Closed-form time of flight back to the ground. See the header: solving
      // it here is what makes the whole system a pure function of t.
      const h = Math.max(0, oy - b.y);
      const tLand = (vy + Math.sqrt(vy * vy + 2 * G * h)) / G;

      this.aOrigin.setXYZ(k, ox, oy, oz);
      this.aVel.setXYZ(k, vx, vy, vz);
      this.aInfo.setXYZ(k, clock, tLand, b.sizeLo + (b.sizeHi - b.sizeLo) * rnd());

      const near = 1 - Math.min(1, rr / Math.max(0.001, b.r1));
      b.tint(near, rnd, _tint);
      this.aTint.setXYZ(k, _tint[0]!, _tint[1]!, _tint[2]!);

      if (tLand > maxLife) maxLife = tLand;
    }
    this.aOrigin.needsUpdate = true;
    this.aVel.needsUpdate = true;
    this.aInfo.needsUpdate = true;
    this.aTint.needsUpdate = true;
    // The tail is the fade the shader runs after a grain lands; without it the
    // caller hides the mesh on the frame the last grain touches down and the
    // whole sheet vanishes mid-settle.
    this.live = Math.max(this.live, maxLife + b.tailFade);
  }

  /** Count the clock down. Returns true while anything is still on screen. */
  step(dt: number): boolean {
    if (this.live <= 0) return false;
    this.live -= dt;
    return this.live > 0;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
