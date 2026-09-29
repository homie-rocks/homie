import * as THREE from 'three';
import { buildAtlas, type TileFn } from './ParticleAtlas.ts';
import { ParticleRing } from './ParticleRing.ts';
import { ParticlePool } from './ParticlePool.ts';
import { PARTICLE_FRAG, PARTICLE_VERT, particleTuning, type ParticleTuning }
  from './ParticleShader.ts';

/**
 * ============================================================================
 *  The racer particle system — a kart racer and a space racer, one copy.
 * ============================================================================
 *  These two games are forks of one another. Measured before this file existed,
 *  with both already sitting on ParticleRing: their `EmitParams` was 67
 *  identical lines, their `spawn` was identical, and their public `Particles`
 *  class was 251 lines differing in EXACTLY TWO PLACES — which tiles go into
 *  the atlas and how many rows it has, and one setter the space racer adds.
 *  The build script that assembled this file asserted all three of those facts
 *  and refused to write anything if any of them stopped being true.
 *
 *  THIS PARAGRAPH USED TO SAY THE SHADERS MUST NEVER COME HERE, and it was
 *  wrong on the facts. It read: "the space racer's streak mode is
 *  camera-relative because its ships do 142 m/s and the kart racer's is
 *  world-relative because its karts do 30; it carries four more tiles, a
 *  tumble-facet term for torn hull plate, and a longer near fade for the
 *  additive layer. Those are different pictures, not one picture with a flag."
 *
 *  Measured, and the measurement is the answer. The FRAGMENT shader was 193
 *  lines and BYTE-IDENTICAL in the two games. The vertex shader diverged in
 *  exactly three places and every one of them turned out to be a VALUE, not a
 *  flag: a camera velocity of zero IS the world frame, a shutter of zero
 *  seconds IS no exposure smear, and a facet tile index of -1 IS an atlas with
 *  no chip of plate in it. Substituting each game's constants back into the
 *  shared vertex shader and diffing the code lines against the original source
 *  gives 104 against 104 and 113 against 113. There is no per-game `if` in
 *  `ParticleShader.ts` and there is no mode parameter either.
 *
 *  So the shaders ARE here now, one level over in `./ParticleShader.ts`, and
 *  the standard layer below builds a material out of them. The only thing the
 *  old paragraph got right is the shape of the test, and it still binds: a
 *  game that genuinely needs a different picture supplies its own `layer` and
 *  this file never looks at it.
 *
 *  A ballistic game (grains in vacuum) is NOT a consumer and cannot be. Its
 *  particles are ballistic arcs that meet a tilted plane, not linear drag under
 *  gravity; that is why the shared thing is `ParticleRing`, one level down, and
 *  why this file is called Drag.
 * ============================================================================
 */

/** one live colour channel per racer; see EmitParams.channel */
export const TIER_SLOTS = 8;

/**
 * Tile 0 in both racers' atlases (`PTile.Glow`) and mode 0 in both
 * (`PMode.Billboard`). Named rather than written as bare zeroes, because the
 * enums themselves stay in the games: the kart racer declares eight tiles and
 * the space racer twelve, so a shared PTile would hand one game four sprites it
 * has no texels for.
 */
const TILE_GLOW = 0;
const MODE_BILLBOARD = 0;

export interface EmitParams {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** uniform random sphere added to the spawn point, metres */
  posJitter: number;
  /** uniform random sphere added to the velocity, m/s */
  velJitter: number;
  /** ±fraction applied to |velocity| */
  velScatter: number;
  life: number;
  /** ±fraction of life */
  lifeJitter: number;
  size0: number; size1: number;
  /** ±fraction applied to both sizes */
  sizeJitter: number;
  r0: number; g0: number; b0: number; a0: number;
  r1: number; g1: number; b1: number; a1: number;
  /** m/s², negative falls */
  gravity: number;
  /** linear drag coefficient, 1/s. Higher = stops sooner. */
  drag: number;
  /** rad/s billboard roll; randomised in sign */
  spin: number;
  /** index into the game's own atlas — `PTile` in the consuming game */
  tile: number;
  /** `PMode`: 0 billboard, 1 ground quad, 2 velocity-stretched */
  mode: number;
  /** extra length per m/s of speed, Stretch mode only */
  stretch: number;
  /** fraction of life spent fading in */
  fadeIn: number;
  /** world Y of the surface this particle should not cut through */
  groundY: number;
  /**
   * Unit normal of that surface. The soft fade is a real plane test, not a
   * height test: on a 20-degree banked curve a horizontal-plane fade is out by
   * two thirds of a metre across a 2 m puff, which is exactly the width of the
   * hard intersection line reviews kept flagging.
   */
  gnx: number; gny: number; gnz: number;
  /** metres of soft-fade depth. 0 disables both soft tests. */
  softness: number;
  /**
   * Metres to pull the sprite toward the camera before it is billboarded.
   * The cheapest half of "soft particles": a quad biased 0.2–0.4 m toward the
   * eye simply stops intersecting the thing it was about to slice through, and
   * at these sizes the parallax error is invisible.
   */
  camBias: number;
  count: number;
  /**
   * LIVE COLOUR CHANNEL, 1..TIER_SLOTS. 0 = none (the authored colour is used
   * verbatim).
   *
   * A drift particle's colour is not a property of the particle, it is a
   * property of the *drift* — and a drift changes tier while its own shower is
   * still in the air. Baking `C_TIER[tier]` in at spawn is why the reviewed
   * tier-2 frame contained a screen full of tier-1 blue sparks: the promotion
   * happened on the frame the shutter fired and every grain already in flight
   * kept the colour it was born with.
   *
   * So a particle on a channel stores only its INTENSITY (author the colour as
   * white * intensity) and multiplies in `uTierCol[channel-1]` in the vertex
   * shader. The game rewrites that array every frame from each racer's live
   * drift tier, so a promotion recolours the entire shower — in flight,
   * instantly, for free.
   */
  channel: number;
}

/**
 * The half of the ring that is the same in both racers: the write path.
 *
 * A game subclasses THIS rather than ParticleRing, supplies its own shaders and
 * uniforms in its constructor, and inherits the 32 floats below unchanged.
 */
export abstract class DragParticleRing extends ParticleRing {
  spawn(p: EmitParams, now: number, seed: number): boolean {
    const o = this.reserve();
    if (o < 0) return false;

    const d = this.data;
    const R = Math.random;

    // --- position ---
    const pj = p.posJitter;
    d[o] = p.x + (R() - 0.5) * 2 * pj;
    d[o + 1] = p.y + (R() - 0.5) * 2 * pj;
    d[o + 2] = p.z + (R() - 0.5) * 2 * pj;
    const life = p.life * (1 + (R() - 0.5) * 2 * p.lifeJitter);
    d[o + 3] = now;

    // --- velocity ---
    const scat = 1 + (R() - 0.5) * 2 * p.velScatter;
    const vj = p.velJitter;
    d[o + 4] = p.vx * scat + (R() - 0.5) * 2 * vj;
    d[o + 5] = p.vy * scat + (R() - 0.5) * 2 * vj;
    d[o + 6] = p.vz * scat + (R() - 0.5) * 2 * vj;
    d[o + 7] = life;

    d[o + 8] = p.gravity;
    d[o + 9] = p.drag;
    d[o + 10] = p.spin * (R() < 0.5 ? -1 : 1);
    d[o + 11] = p.mode;

    const sj = 1 + (R() - 0.5) * 2 * p.sizeJitter;
    d[o + 12] = p.size0 * sj;
    d[o + 13] = p.size1 * sj;
    d[o + 14] = p.stretch;
    d[o + 15] = p.fadeIn;

    d[o + 16] = p.r0; d[o + 17] = p.g0; d[o + 18] = p.b0; d[o + 19] = p.a0;
    d[o + 20] = p.r1; d[o + 21] = p.g1; d[o + 22] = p.b1; d[o + 23] = p.a1;

    d[o + 24] = p.tile;
    // integer part = live colour channel, fraction = random phase (see the
    // `channel` doc on EmitParams). `seed` is always in [0,1).
    d[o + 25] = p.channel + seed;
    d[o + 26] = p.groundY;
    d[o + 27] = p.softness;

    d[o + 28] = p.gnx; d[o + 29] = p.gny; d[o + 30] = p.gnz;
    d[o + 31] = p.camBias;

    this.keepAlive(now + life);
    return true;
  }
}

/** What a game supplies that this file deliberately does not know. */
export interface DragParticlesSpec {
  additiveCapacity: number;
  alphaCapacity: number;
  /**
   * The resolution of ONE atlas tile. 256 gives a 1024x512 RGBA atlas — 2 MB
   * before mips, 2.8 MB with them, held twice over (once in the JS heap as the
   * mip chain, once on the GPU) for the life of the process. These sprites are
   * soft by construction and are drawn at a few dozen pixels; 128 is visually
   * indistinguishable in motion and costs a quarter as much in both memories,
   * plus a quarter of the boot time to synthesise. Mobile takes 128, desktop
   * keeps 256.
   */
  tileSize: number;
  tiles: TileFn[];
  atlasCols: number;
  atlasRows: number;
  /**
   * The three numbers-and-a-vector the shared program reads. See
   * `ParticleTuning` for what each one is and what the identity values mean.
   * Omit it and every one takes its identity, which is the kart racer's picture.
   */
  tuning?: ParticleTuning;
  /**
   * The lens fade, per layer: x fully faded at this view depth, y fully opaque
   * from here out. A FUNCTION rather than a pair because the two layers can
   * legitimately want different ones — the space racer fades its additive layer
   * out over 0.6-2.6 m because a defocused additive sprite over the grade's
   * desaturation knee arrives as a flat white plate with a quad edge on it,
   * while its lit layer keeps the short fade because smoke is not over the knee
   * and cutting it early would open a hole around the camera.
   */
  nearFade?(additive: boolean): readonly [number, number];
  /**
   * Build one layer yourself, if this game's picture is genuinely a different
   * one. Omit it and the standard layer below is used — which is what both
   * racers do, on the identical program, with only their own values on it.
   */
  layer?(capacity: number, atlas: THREE.DataTexture, additive: boolean, lit: boolean,
         tierCol: Float32Array): DragParticleRing;
}

/**
 * THE STANDARD LAYER — the material both racers were writing out by hand.
 *
 * It was thirty lines of uniform map, and after the shaders moved it was the
 * SAME thirty lines in both games apart from the atlas dimensions, the lens
 * fade and the tuning. Keeping it here rather than in each game is not only
 * fewer lines: a uniform's value lives on the GL program rather than on the
 * material, and three caches one program per source-and-defines, so a game that
 * hand-wrote the map and forgot an entry would render with the GL default —
 * or, where two materials share a program, with whatever the other one last
 * wrote. That defect is now unavailable rather than merely unlikely.
 */
class StandardLayer extends DragParticleRing {
  constructor(capacity: number, atlas: THREE.DataTexture, additive: boolean, lit: boolean,
              tierCol: Float32Array, spec: DragParticlesSpec) {
    const t = particleTuning(spec.tuning);
    const fade = spec.nearFade ? spec.nearFade(additive) : ([0.35, 1.25] as const);
    super({
      capacity,
      additive,
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAtlas: { value: atlas },
        uAtlasTiles: { value: new THREE.Vector2(spec.atlasCols, spec.atlasRows) },
        uGain: { value: 1 },
        uClip: { value: additive ? 0.13 : 0.0 },
        // 0.40 of viewport height. Big enough for an explosion fireball to feel
        // enormous, small enough that no single sprite can ever become the
        // frame — which is what the boost plume was doing into the chase cam.
        uSizeCap: { value: 0.40 },
        uNearFade: { value: new THREE.Vector2(fade[0], fade[1]) },
        uCamVel: { value: new THREE.Vector3() },
        uStretch: { value: new THREE.Vector2(t.stretch[0], t.stretch[1]) },
        uSmear: { value: new THREE.Vector3(t.smear[0], t.smear[1], t.smear[2]) },
        uFacetTile: { value: t.facetTile },
        // The lit layer never takes the bias: smoke and regolith carry their
        // form in low frequencies, so sharpening them buys nothing and costs
        // the crawl. See uMipBias in ParticleShader.ts.
        uMipBias: { value: additive ? t.mipBias : 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSkyColor: { value: new THREE.Color(0.4, 0.5, 0.7) },
        uBounceColor: { value: new THREE.Color(0.25, 0.18, 0.12) },
        uDepth: { value: null },
        uInvRes: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
        uCamPlanes: { value: new THREE.Vector2(0.2, 3000) },
        uTierCol: { value: tierCol },
      },
      defines: {
        TIER_SLOTS: String(TIER_SLOTS),
        ...(lit ? { LIT: '' } : {}),
        ...(additive ? { ADDITIVE: '' } : {}),
      } as Record<string, string>,
    });
  }
}

/**
 * THE UNIFORM NAMES BELOW ARE THE CONTRACT BETWEEN THIS FILE AND A GAME'S
 * `Layer`. This class never writes a shader, but it does reach into the
 * material for uTime, uGain, uInvRes, uDepth, uCamPlanes, uSunDir, uSunColor,
 * uSkyColor and uBounceColor — so a Layer that does not declare one of those
 * will throw here rather than quietly render wrong, which is the right
 * direction for this seam to fail in.
 */
export abstract class DragParticles extends ParticlePool<EmitParams, DragParticleRing> {
  /** Shared spawn description — fill it, then call emit(). Never copied. */
  readonly p: EmitParams = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    posJitter: 0, velJitter: 0, velScatter: 0,
    life: 1, lifeJitter: 0.2,
    size0: 1, size1: 1, sizeJitter: 0.2,
    r0: 1, g0: 1, b0: 1, a0: 1,
    r1: 1, g1: 1, b1: 1, a1: 0,
    gravity: 0, drag: 1, spin: 0,
    tile: TILE_GLOW, mode: MODE_BILLBOARD, stretch: 0, fadeIn: 0.08,
    groundY: -1e4, gnx: 0, gny: 1, gnz: 0, softness: 0, camBias: 0, count: 1,
    channel: 0,
  };

  /** vec3[TIER_SLOTS], shared by both layers; written by `setChannelColor` */
  private readonly tierCol: Float32Array;

  /**
   * The atlas, the two rings and the group are `ParticlePool`'s; what is built
   * here is the LAYER, because `spec.layer` is how a game that genuinely needs
   * a different picture supplies its own and this file never looks at it.
   *
   * `tierCol` is threaded through the factory rather than set afterwards: it is
   * one Float32Array shared by both layers' `uTierCol` uniform, so recolouring
   * a channel is O(1) and reaches particles already in the air.
   */
  constructor(spec: DragParticlesSpec) {
    const { additiveCapacity, alphaCapacity } = spec;
    const tierCol = new Float32Array(TIER_SLOTS * 3).fill(1);
    const atlas = buildAtlas(spec.tiles, spec.atlasCols, spec.atlasRows, spec.tileSize);
    const build = spec.layer
      ?? ((cap, a, additive, lit, tc) => new StandardLayer(cap, a, additive, lit, tc, spec));
    super(atlas,
      build(additiveCapacity, atlas, true, false, tierCol),
      build(alphaCapacity, atlas, false, true, tierCol));
    this.tierCol = tierCol;
  }

  /**
   * `Math.random`, and it is stated rather than defaulted — see the header on
   * `ParticlePool`. These two games have no capture harness that has to
   * integrate the same sequence twice, so an unseeded stream is the right
   * answer here and the WRONG one for a game with one, which is exactly why
   * the base makes every subclass say.
   */
  protected nextRandom(): number { return Math.random(); }

  protected spawnOne(layer: DragParticleRing, now: number): boolean {
    return layer.spawn(this.p, now, Math.random());
  }

  /** Reset the shared params to neutral defaults before configuring an emit. */
  reset(): EmitParams {
    const p = this.p;
    p.x = p.y = p.z = 0;
    p.vx = p.vy = p.vz = 0;
    p.posJitter = 0; p.velJitter = 0; p.velScatter = 0;
    p.life = 1; p.lifeJitter = 0.2;
    p.size0 = 1; p.size1 = 1; p.sizeJitter = 0.2;
    p.r0 = p.g0 = p.b0 = 1; p.a0 = 1;
    p.r1 = p.g1 = p.b1 = 1; p.a1 = 0;
    p.gravity = 0; p.drag = 1; p.spin = 0;
    p.tile = TILE_GLOW; p.mode = MODE_BILLBOARD; p.stretch = 0; p.fadeIn = 0.08;
    p.groundY = -1e4; p.gnx = 0; p.gny = 1; p.gnz = 0;
    p.softness = 0; p.camBias = 0; p.count = 1; p.channel = 0;
    return p;
  }

  /**
   * Point every live particle on `channel` (1..TIER_SLOTS) at a new colour.
   * The particles themselves are never rewritten — they hold only their
   * intensity — so this is O(1) and recolours a shower already in the air.
   */
  setChannelColor(channel: number, c: THREE.Color) {
    if (channel < 1 || channel > TIER_SLOTS) return;
    const o = (channel - 1) * 3;
    const t = this.tierCol;
    if (t[o] === c.r && t[o + 1] === c.g && t[o + 2] === c.b) return;
    t[o] = c.r; t[o + 1] = c.g; t[o + 2] = c.b;
  }

  /**
   * Declare the surface this emission sits on. Every emitter should call this:
   * it is what drives the soft fade *and* the camera-facing bias, and the two
   * together are the whole reason particles stop slicing through the road.
   */
  ground(y: number, n: { x: number; y: number; z: number }, softness: number, camBias = 0.22): EmitParams {
    const p = this.p;
    p.groundY = y; p.gnx = n.x; p.gny = n.y; p.gnz = n.z;
    p.softness = softness; p.camBias = camBias;
    return p;
  }

  /**
   * The camera's own world velocity, m/s, on both layers.
   *
   * `uCamVel` is declared HERE (see the uniform block above) and read by
   * `PARTICLE_VERT`, so a game could only ever write it by reaching through
   * `material.uniforms` into a layer this class owns — which is what the space
   * racer's `Particles` subclass was doing in four lines. The setter for a
   * uniform this file declares belongs to this file.
   *
   * WHY IT MATTERS AND IS NOT A CONVENIENCE: `PMode.Stretch` is motion blur and
   * motion blur is RELATIVE — see the long note in `ParticleShader.ts`. Left at
   * zero on a game whose emitters hand their particles most of the emitting
   * machine's velocity, the whole field streaks at maximum elongation on every
   * frame. Zero is nonetheless the right default, because it degrades to the
   * world frame exactly rather than to nothing.
   *
   * The game owns the number: differencing a camera position and smoothing it
   * is a decision about a chase rig, and two of them in one game can legitimately
   * smooth it differently.
   */
  setCameraVelocity(v: THREE.Vector3) {
    for (const l of this.layers) l.material.uniforms.uCamVel!.value.copy(v);
  }

}
