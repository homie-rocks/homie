import * as THREE from 'three';

/**
 * ============================================================================
 *  SparkField — the pooled point burst a HIT makes.
 * ============================================================================
 *
 *  A fixed-capacity `THREE.Points` cloud with per-particle velocity, gravity,
 *  lifetime and a colour that fades on its own life. One draw call, one
 *  allocation at build time, and the oldest particle retired when the pool is
 *  full.
 *
 *  ## Why this is beside `CameraField` and not inside `blast.ts`
 *
 *  `@homie-rocks/fx/blast.ts` already has "the four one-shot showers both racers
 *  fire" and it is excellent — and it is a racer's. It is built on
 *  `DragParticles` and the eight-tile `ParticleAtlas`, it takes a `Medium`
 *  because a kart throws matter through air and a mag-racer through vacuum, it
 *  inherits a fraction of the emitting MACHINE's velocity, and it reaches for
 *  `WakeState`. None of that is wrong; all of it assumes something is driving.
 *
 *  A shooter's impact is four numbers: where the round landed, how hard, what
 *  colour, and how long the sparks live. Bending it onto `blast()` means
 *  inventing a medium, a machine and a wake for a wall being shot, and the
 *  smallest of the games this was extracted from would have been carrying
 *  three parameters it has no opinion about so it could avoid carrying fifty
 *  lines it does. This is the second capability a first-person shooter had to
 *  hand-write because the nearest shared module only fits a car. See
 *  `CameraField.ts`'s header for the first, which is the same finding about
 *  weather.
 *
 *  ## The two capacities, and the defect they preserve
 *
 *  `capacity` is how many particles are DRAWN and `live` is how many are
 *  SIMULATED, and they are two fields because in the shooter they were two
 *  numbers: the point cloud is sized 400 on High and 180 below it, while the
 *  retirement cap was a flat 380 either way.
 *
 *  **On anything below High that game simulated up to 200 sparks it never drew**
 *  — full gravity, full integration, full retirement bookkeeping, nothing on
 *  screen. That is a live finding and it is not fixed here, because collapsing
 *  the two would change which sparks survive on every machine that runs at
 *  Medium or Low, and a behaviour change belongs in its own change with its own
 *  before-and-after. A game that has no such history should pass `capacity`
 *  alone and let `live` default to it.
 */
export interface SparkFieldSpec {
  /** Drawn slots. Also the default for `live`. */
  capacity: number;
  /** Simulated particles before the oldest is retired. Defaults to `capacity`. */
  live?: number;
  /** Metres per second per second taken off `vel.y`, applied before integration. */
  gravity: number;
  /** The point material. The game owns the size, the blend and the colour mode. */
  material: THREE.PointsMaterial;
  /** `points.name`, for the draw-call inspector. */
  name?: string;
  /**
   * Where an unused slot is parked, in world Y.
   *
   * A `Points` cloud draws every vertex it has; there is no per-vertex "off".
   * The cheapest way to hide a dead slot is to put it somewhere the camera is
   * not, and -40 is under the floor of a building.
   */
  parkY?: number;
}

/** One particle. `color` is deliberately NOT cloned — a burst shares one. */
export interface SparkParticle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  color: THREE.Color;
}

export class SparkField {
  readonly points: THREE.Points;
  /** The live particles, newest last. Public so a game can read its own count. */
  readonly particles: SparkParticle[] = [];

  private readonly geo: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private readonly posAttr: Float32Array;
  private readonly colAttr: Float32Array;
  private readonly capacity: number;
  private readonly liveCap: number;
  private readonly gravity: number;
  private readonly parkY: number;

  constructor(spec: SparkFieldSpec) {
    this.capacity = spec.capacity;
    this.liveCap = spec.live ?? spec.capacity;
    this.gravity = spec.gravity;
    this.parkY = spec.parkY ?? -40;
    this.posAttr = new Float32Array(spec.capacity * 3);
    this.colAttr = new Float32Array(spec.capacity * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.posAttr, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colAttr, 3));
    this.material = spec.material;
    this.points = new THREE.Points(this.geo, this.material);
    // Same reason as `CameraField`: the cloud is wherever the shooting is, and
    // a bounding box computed once is a burst that vanishes at a corner.
    this.points.frustumCulled = false;
    if (spec.name) this.points.name = spec.name;
  }

  /**
   * Add one particle. `pos` is copied; `vel` and `color` are taken as given.
   *
   * The retirement is applied here, one at a time, rather than after a whole
   * burst. It is the same set either way — dropping the front until the length
   * fits leaves the newest `live` particles in both orders — and doing it here
   * means a caller cannot forget.
   */
  emit(pos: THREE.Vector3, vel: THREE.Vector3, life: number, max: number, color: THREE.Color) {
    this.particles.push({ pos: pos.clone(), vel, life, max, color });
    if (this.particles.length > this.liveCap) this.particles.shift();
  }

  /**
   * Age, accelerate, integrate, retire — and then write the whole buffer.
   *
   * The order is semi-implicit Euler and it is not interchangeable with the
   * other one: gravity goes onto the velocity BEFORE the velocity moves the
   * particle, which is what makes a burst arc rather than hang for one frame.
   */
  update(dt: number) {
    const p = this.particles;
    for (let i = p.length - 1; i >= 0; i--) {
      const s = p[i]!;
      s.life -= dt;
      s.vel.y -= this.gravity * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (s.life <= 0) p.splice(i, 1);
    }
    for (let i = 0; i < this.capacity; i++) {
      const s = p[i];
      if (!s) {
        this.posAttr[i * 3 + 1] = this.parkY;
        continue;
      }
      this.posAttr[i * 3] = s.pos.x;
      this.posAttr[i * 3 + 1] = s.pos.y;
      this.posAttr[i * 3 + 2] = s.pos.z;
      // Fade on the particle's OWN life, not the pool's clock: a burst emitted
      // late must not inherit the brightness of the one before it.
      const a = s.life / s.max;
      this.colAttr[i * 3] = s.color.r * a;
      this.colAttr[i * 3 + 1] = s.color.g * a;
      this.colAttr[i * 3 + 2] = s.color.b * a;
    }
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.attributes.color!.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.material.dispose(); }
}
