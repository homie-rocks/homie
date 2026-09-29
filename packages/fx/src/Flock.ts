import * as THREE from 'three';

/**
 * ============================================================================
 *  FLOCK — many small GPU-animated bodies on their own orbits, and a startle
 * ============================================================================
 *
 *  One instanced draw, one triangle soup per body, four floats of orbit and
 *  four of phase per instance, and a scare impulse the CPU latches and the
 *  vertex shader reads. Everything a flock of anything needs and nothing that
 *  says what it is a flock OF.
 *
 *  IT TAKES THE SHADERS AS ARGUMENTS, for `Motes.ts`'s reason and in its
 *  words: one racer's forward-scatter haze and another's tumbling glint *"are
 *  two effects and not two tunings of one"*. A flock is worse, not better —
 *  the wing beat, the bank into the turn, the albedo along the span and what
 *  "startled" even looks like are the whole of what makes a gull a gull and a
 *  bat a bat. What is shared is the buffer assembly, the uniform block, the
 *  latch and the envelope on it.
 *
 *  THE ENVELOPE IS THE PART WORTH READING TWICE, and it is the only behaviour
 *  in this file. A flush is ASYMMETRIC: birds break fast and settle slowly, so
 *  the strength chases its target at two different rates depending on which
 *  way it is going, over a smoothstep of a linearly decaying timer. A single
 *  exponential in either direction reads as a wave rather than a flush.
 *
 *  THE LATCH REFUSES A WEAKER SCARE while a stronger one is still decaying.
 *  Without that, a field of eight bodies passing a colony re-latches the point
 *  every few frames and the flock jitters between eight flee directions
 *  instead of leaving.
 *
 *  THE BOUNDING SPHERE IS THE CALLER'S and it is not a detail. A startled body
 *  flies clear of its orbit, and a sphere sized to the orbits alone culls the
 *  flock mid-scatter — the one frame anybody is looking at it.
 * ============================================================================
 */

/** Everything the caller decides. EVERY FIELD IS REQUIRED. */
export interface FlockSpec {
  /** how many bodies */
  count: number;
  /**
   * One body's triangle soup, as raw xyz triples. It is read as a body-local
   * frame by the vertex shader, not as a mesh — which is why it is a flat
   * array and not a geometry.
   */
  silhouette: readonly number[];
  /**
   * Fill one body's orbit (xyz centre, w radius) and phase (x phase, y angular
   * speed, z beat rate, w scale). Called once per body at construction with
   * the index, and it is where every number that decides what the flock DOES
   * lives — how many of them fly low, how wide they range, how fast they beat.
   */
  layout: (i: number, orbit: Float32Array, phase: Float32Array) => void;
  vertexShader: string;
  fragmentShader: string;
  /** where the flock lives, and how far a scattered body may get from it */
  centre: THREE.Vector3;
  boundRadius: number;
  /** seconds a scare takes to decay to nothing */
  scareDecay: number;
  /**
   * A new scare is refused while the current one is above this. 0 accepts
   * every latch, which is the jitter described above.
   */
  latchFloor: number;
  /** how fast the strength chases its target, breaking and settling */
  breakRate: number;
  settleRate: number;
  name: string;
}

export class Flock {
  readonly mesh: THREE.Mesh;
  readonly centre = new THREE.Vector3();
  private readonly material: THREE.ShaderMaterial;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly spec: FlockSpec;
  private scareT = 0;

  constructor(spec: FlockSpec) {
    this.spec = spec;
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(spec.silhouette), 3),
    );

    const orbit = new Float32Array(spec.count * 4);
    const phase = new Float32Array(spec.count * 4);
    for (let i = 0; i < spec.count; i++) spec.layout(i, orbit, phase);
    this.geo.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
    this.geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 4));
    this.geo.instanceCount = spec.count;
    this.geo.boundingSphere = new THREE.Sphere(spec.centre.clone(), spec.boundRadius);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLight: { value: new THREE.Color(1, 1, 1) },
        // Parked far below the world so an un-startled flock is not sitting
        // inside its own scare field on the first frame.
        uScare: { value: new THREE.Vector4(0, -1e4, 0, 0) },
      },
      vertexShader: spec.vertexShader,
      fragmentShader: spec.fragmentShader,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.name = spec.name;
    this.mesh.matrixAutoUpdate = false;
    this.centre.copy(spec.centre);
  }

  private get u(): { uTime: { value: number }; uLight: { value: THREE.Color }; uScare: { value: THREE.Vector4 } } {
    return this.material.uniforms as never;
  }

  /** Latch a startle point. Ignored while a stronger one is still decaying. */
  startle(p: THREE.Vector3): void {
    if (this.scareT > this.spec.latchFloor) return;
    this.scareT = 1;
    this.u.uScare.value.set(p.x, p.y, p.z, 0);
  }

  update(time: number, light: THREE.Color, dt: number): void {
    this.u.uTime.value = time;
    this.u.uLight.value.copy(light);
    this.scareT = Math.max(0, this.scareT - dt * this.spec.scareDecay);
    const s = this.u.uScare.value;
    const want = this.scareT * this.scareT * (3 - 2 * this.scareT);
    s.w += (want - s.w) * Math.min(1, dt * (want > s.w ? this.spec.breakRate : this.spec.settleRate));
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
