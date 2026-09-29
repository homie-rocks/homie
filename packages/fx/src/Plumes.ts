import * as THREE from 'three';

/*
 * ----------------------------------------------------------------------------
 *  WHY A PLUME IS NOT PARTICLES.
 * ----------------------------------------------------------------------------
 *  This paragraph stood, word for word, at the top of the plume section in
 *  BOTH racers' effects code. It is the argument for this file existing, so
 *  it belongs to this file.
 *
 *  Three versions of the effect were a burst of additive billboards fired out
 *  of the exhaust stacks, and three reviews in a row said the boost frame has
 *  no flame in it. It never could have. A flame is a *coherent, oriented,
 *  attached* shape and a billboard cloud is none of those things:
 *
 *    - The tapered flame tile is directional, but a billboard's roll comes
 *      from its per-particle random seed, so every tongue pointed a different
 *      way and the plume had no axis at all.
 *    - The chase camera sits directly behind the stacks, so the emission
 *      velocity projects to nothing on screen, stretch-mode correctly refuses
 *      to orient, and what is left is a handful of round blobs.
 *    - At speed with motion blur on, a scatter of sub-frame-lifetime sprites
 *      smears into grey wisps — which is exactly what the boost shot showed.
 *
 *  So the plume is a MESH: a ribbon that pivots about the exhaust axis to face
 *  the camera, with an animated width profile and a baked temperature ramp. It
 *  is welded to the machine, it reads at any speed because it is not made of
 *  motion, and it degrades gracefully to a hot disc when you look straight
 *  down its axis — which is the head-on afterburner read.
 *
 *  One instanced draw for the whole field, whatever the field is doing;
 *  `instanceCount` is zero on any frame nobody is burning.
 *
 * ----------------------------------------------------------------------------
 *  WHERE THIS CAME FROM, AND WHAT DELIBERATELY DID NOT COME WITH IT.
 * ----------------------------------------------------------------------------
 *  This is the CPU half of the boost plume — the pooled two-ribbon instance
 *  buffer — lifted out of the effects code of the two racing games, where it
 *  was 95% identical: same STRIDE 16, same four attributes, same geometry
 *  loop, same begin/add/end.
 *
 *  THE FLAME ITSELF STAYED IN THE GAMES, and that is not tidiness, it is the
 *  reduction test. The kart game's PLUME_FRAG is 165 lines and the ship game's
 *  is 380; one tessellates at 11 segments and the other at 29 — and the
 *  second's own comment records WHY, at length: at 11 the shock-diamond
 *  Gaussians at u = 0.35 and u = 0.85 fall between vertices and the waist the
 *  geometry is supposed to have interpolates away to a flat 34% narrowing.
 *  Those are two different flames wearing one name. Merging them behind a flag
 *  would be a flag that changes BEHAVIOUR inside a shared function, which is
 *  the definition of "they were never one thing".
 *
 *  So the art direction arrives as VALUES the game supplies — a segment count,
 *  two shader strings, a Reinhard clip — which is exactly what the reduction
 *  test permits, and the machinery below never learns what a vehicle, a stack,
 *  a throat or a burn is.
 *
 *  Every comment on the machinery travelled UNEDITED, including the one that
 *  explains why the clip is where it is against PostFX's bloom gate: that is
 *  the measurement that sized the number, and the number is now the game's.
 * ----------------------------------------------------------------------------
 */

/**
 * What a game supplies to make its own flame out of this pool.
 *
 * `clip` is the per-pixel Reinhard shoulder the fragment shader applies.
 * The kart game ships 0.13 and the ship game 0.17, and both numbers are argued
 * for in their own files against their own bloom gates — this file must never
 * have a default for it, because a default is how one game silently inherits
 * the other's grade.
 */
export interface PlumeArt {
  /** Vertices along each of the two ribbons. */
  segments: number;
  vertexShader: string;
  fragmentShader: string;
  /** uClip: where the additive shoulder starts to compress. */
  clip: number;
}

export class Plumes {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly buf: THREE.InstancedInterleavedBuffer;
  private readonly data: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private count = 0;

  static readonly STRIDE = 16;

  constructor(readonly capacity: number, art: PlumeArt) {
    // Two ribbons: the camera-facing tongue, and a fin crossed at ninety
    // degrees that only becomes visible when you look down the axis.
    const n = art.segments;
    const pos = new Float32Array(2 * n * 2 * 3);
    const idx = new Uint16Array(2 * (n - 1) * 6);
    for (let r = 0; r < 2; r++) {
      const vb = r * n * 2;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const o0 = (vb + i * 2) * 3, o1 = (vb + i * 2 + 1) * 3;
        pos[o0] = -1; pos[o0 + 1] = u; pos[o0 + 2] = r;
        pos[o1] = 1; pos[o1 + 1] = u; pos[o1 + 2] = r;
      }
      const ib = r * (n - 1) * 6;
      for (let i = 0; i < n - 1; i++) {
        const a = vb + i * 2;
        idx[ib + i * 6] = a; idx[ib + i * 6 + 1] = a + 1; idx[ib + i * 6 + 2] = a + 2;
        idx[ib + i * 6 + 3] = a + 1; idx[ib + i * 6 + 4] = a + 3; idx[ib + i * 6 + 5] = a + 2;
      }
    }

    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.data = new Float32Array(capacity * Plumes.STRIDE);
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, Plumes.STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const names = ['aOrigin', 'aAxis', 'aShape', 'aTint'];
    for (let i = 0; i < names.length; i++) {
      this.geo.setAttribute(names[i]!, new THREE.InterleavedBufferAttribute(this.buf, 4, i * 4));
    }
    this.geo.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      // 0.13 to match the particle layer. At 0.19 the shoulder was pulling the
      // white-hot spine of the flame down to ~2.5 linear, which sits below
      // PostFX's bloom gate once the ACES shoulder has had it — a boost flame
      // that does not bloom is a painted shape, and "no flame in the boost
      // frame" had been a review note four times running.
      uniforms: { uTime: { value: 0 }, uGain: { value: 1 }, uClip: { value: art.clip } },
      vertexShader: art.vertexShader,
      fragmentShader: art.fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.name = 'fx-plumes';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 12;
  }

  /**
   * Submissions dropped this frame because the instance buffer was full.
   *
   * Same silence as `Trails.acquire`: `add` returns without a word past
   * capacity, which is right — a dropped instance is better than a resize in
   * the middle of a frame — and completely unreportable. The pool is sized
   * `RACER_COUNT * 2` in one racer and `* 3` in the other, both fitted against
   * a fixed grid, and a machine whose flame is dropped is a machine with no
   * engine in the eclipse. Counted, never acted on.
   */
  dropped = 0;
  /** instances actually submitted this frame */
  get claimed(): number { return this.count; }

  begin() { this.count = 0; this.dropped = 0; }

  /**
   * `axis` points the way the flame grows (i.e. backwards out of the stack) and
   * need not be normalised. `seed` should be stable per stack so the flicker of
   * a given exhaust is continuous rather than re-randomised every frame.
   */
  add(origin: THREE.Vector3, axis: THREE.Vector3, length: number, radius: number,
      tint: THREE.Color, intensity: number, alpha: number, seed: number,
      shape: number) {
    const i = this.count;
    if (i >= this.capacity) { this.dropped += 1; return; }
    this.count = i + 1;
    const o = i * Plumes.STRIDE;
    const d = this.data;
    d[o] = origin.x; d[o + 1] = origin.y; d[o + 2] = origin.z;
    d[o + 3] = (seed * 0.6180339887) % 1;
    const il = 1 / (Math.hypot(axis.x, axis.y, axis.z) || 1);
    d[o + 4] = axis.x * il; d[o + 5] = axis.y * il; d[o + 6] = axis.z * il;
    d[o + 7] = length;
    // Decorrelate the flicker rate per stack without letting it run away: the
    // seed is an integer stack id, so fold it through the golden ratio first.
    const jitter = (seed * 0.6180339887) % 1;
    // aShape.w is the ONLY slot whose meaning the two racers disagree about,
    // and they disagree in the SHADER, not here: the kart game reads it as a
    // taper power and passes a constant 0.62 forever; the ship game reads it as
    // the shock-diamond amplitude and passes a live 0..1. Clamping it is the
    // only thing this file is entitled to have an opinion about.
    d[o + 8] = radius; d[o + 9] = intensity; d[o + 10] = 20 + 8 * jitter;
    d[o + 11] = shape < 0 ? 0 : shape > 1 ? 1 : shape;
    d[o + 12] = tint.r; d[o + 13] = tint.g; d[o + 14] = tint.b; d[o + 15] = alpha;
  }

  end(time: number, gain: number) {
    this.material.uniforms.uTime!.value = time;
    this.material.uniforms.uGain!.value = gain;
    this.geo.instanceCount = this.count;
    if (this.count > 0) this.buf.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.material.dispose(); }
}
