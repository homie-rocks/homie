import * as THREE from 'three';
import { buildAtlas, clamp01, sstep, type TileFn } from './ParticleAtlas.ts';

/**
 * ============================================================================
 *  Decals — pooled ground-projected quads: skid marks and scorch.
 * ============================================================================
 *  THE POOL, THE RING AND THE THREE MARKS BOTH RACERS LAY. Measured before the
 *  extraction: one racer's whole `Decals.ts` was 289 substantive lines and 281
 *  of them also stood in the other's, and every method the two shared —
 *  `vert`, `quad`, `skid`, `blot`, `scorch`, `invalidate`, `update`,
 *  `clear` — was BYTE-IDENTICAL across a 180-line span, comments included, as
 *  were the two shaders, the five scratch vectors, the field block and the
 *  first 77 lines of the constructor. Two files of the same shape is one thing;
 *  180 bytes-equal lines is one file that had been copied, and a fix to the
 *  ring's tail-retirement had two chances to land and be missed in the other.
 *
 *  WHAT IS *NOT* HERE, ON PURPOSE:
 *
 *  · **The fourth atlas tile.** The atlas is 2x2 and slots 0/1/2 are Skid,
 *    Scorch and Smudge in both games. Slot 3 is NOT shared: the kart racer
 *    paints a `Splat` — the wet spattered ring water and mud throw off — and
 *    the space racer paints `MagGlow`, the mag-skirt's own footprint, which its
 *    additive and multiply layers BOTH read. Same ordinal, different art. So
 *    the tile list is a constructor argument and `coreDecalTiles()` returns
 *    the three; each game appends its own fourth and keeps its own
 *    `const enum DecalTile` naming it.
 *
 *  · **The space racer's mag-glow and radiator layers.** `magGlow`, `heatPool`
 *    and their two extra geometries are that game's, they subclass this, and
 *    they never touch this class's ring — they carry their own buffers and
 *    their own `gvert`/`hvert`. They reuse `atlas` (hence `protected`) and
 *    `DECAL_VERT`, which is why both are exported.
 *
 *  · **`ParticleTiles.fbm`.** It looks like `fbm2` below and it is NOT the
 *    same function: that one runs on `@homie-rocks/noise`'s SEEDED SIMPLEX
 *    field, this one on the sin-hash value noise the decal tiles were authored
 *    against. Sharing the name would have repainted every scorch mark in both
 *    games. `vnoise` and `fbm2` are exported so a game's own fourth tile gets
 *    the noise the other three were drawn with.
 *
 *  ---
 *  One geometry, one draw call, one hard cap. Quads are written into a ring
 *  buffer at lay-down time and never touched again: the fragment shader reads
 *  a per-vertex birth time and fades the mark out on its own, so a persisting
 *  skid mark costs the CPU nothing at all after the frame it was laid.
 *
 *  Marks are placed on the plane of the surface probe under the wheel and
 *  lifted a couple of centimetres along its normal, with polygon offset on top
 *  of that. Belt and braces, because a flickering skid mark on the hero
 *  corner would be the single most visible artefact in the game.
 *
 *  Blending is multiplicative, not alpha: a skid mark *darkens whatever it is
 *  on*, so it reads correctly on tarmac, on the kerb and on sand without any
 *  per-surface tinting, and it can never look like black paint floating over
 *  a bright surface.
 * ============================================================================
 */

export type { TileFn };

/**
 * The three atlas slots this module paints. A game names them in its own
 * `const enum DecalTile` — these are here so the class can default `scorch`
 * to its own tile without importing a game's vocabulary.
 */
export const DECAL_SKID = 0;
export const DECAL_SCORCH = 1;
export const DECAL_SMUDGE = 2;

/** pos3 + uv2 + birth1 + life1 + tint3 + strength1 */
const VSTRIDE = 11;

const _side = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c0 = new THREE.Vector3();
const _c1 = new THREE.Vector3();

// ===========================================================================
//  The noise the three tiles were authored against.
// ===========================================================================
//  Deterministic hash noise — no image data, no seeded generator needed. NOT
//  `ParticleTiles.fbm`, which is a seeded simplex field; see the header.
//  `clamp01` and `sstep` come from ParticleAtlas.ts, where the particle tiles
//  already use them; a package test proves that swap is byte-for-byte
//  invisible by building this atlas both ways.

const h1 = (x: number) => {
  const s = Math.sin(x * 127.1) * 43758.5453;
  return s - Math.floor(s);
};
const vnoise = (x: number) => {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return h1(i) * (1 - u) + h1(i + 1) * u;
};
const h2 = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const vnoise2 = (x: number, y: number) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
};
const fbm2 = (x: number, y: number, oct: number) => {
  let a = 1, f = 1, s = 0, nrm = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise2(x * f, y * f); nrm += a; a *= 0.5; f *= 2.11; }
  return s / nrm;
};

/** exported for a game authoring its own fourth tile */
export { vnoise, vnoise2, fbm2, clamp01, sstep };

/** the vertex stage both this layer and a subclass's extra layers run */
export const DECAL_VERT = /* glsl */ `
attribute vec2 aLife;    // x birth, y lifetime
attribute vec4 aTint;    // rgb tint, a strength

varying vec2 vUv;
varying vec2 vLife;
varying vec4 vTint;

void main() {
  vUv = uv;
  vLife = aLife;
  vTint = aTint;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec2 uAtlasTiles;
uniform float uTime;

varying vec2 vUv;
varying vec2 vLife;
varying vec4 vTint;

void main() {
  if (vLife.y <= 0.0) discard;
  float age = (uTime - vLife.x) / vLife.y;
  if (age < 0.0 || age >= 1.0) discard;
  float mask = texture2D(uAtlas, vUv).a;
  // Hold, then dissolve. Marks should look permanent for a while, then thin
  // out rather than uniformly ghosting away.
  float a = mask * vTint.a * (1.0 - smoothstep(0.5, 1.0, age));
  if (a < 0.004) discard;
  // Multiplicative: 1.0 leaves the surface untouched, tint darkens it.
  gl_FragColor = vec4(mix(vec3(1.0), vTint.rgb, a), 1.0);
}
`;


/**
 * Atlas slots 0, 1 and 2 — the three marks both racers lay. A game appends its
 * own slot 3 and passes the whole list to the constructor.
 */
export function coreDecalTiles(): TileFn[] {
  return [
    // 0 — Skid. Deliberately a function of u only (across the tyre width) so
    // that consecutive quads tile along v with no seam whatsoever.
    (u: number, _v: number, o: Float32Array) => {
      const tread = 0.62 + 0.38 * vnoise(u * 26);
      const grain = 0.80 + 0.20 * vnoise(u * 97 + 13);
      const edge = sstep(0.0, 0.16, u) * sstep(1.0, 0.84, u);
      o[0] = o[1] = o[2] = 1;
      o[3] = clamp01(tread * grain * edge);
    },
    // 1 — Scorch: eroded soot disc with a slightly hotter, denser core.
    (u: number, v: number, o: Float32Array) => {
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const n = fbm2(u * 5.5, v * 5.5, 4);
      const a = clamp01(sstep(1.0, 0.18, d + (n - 0.5) * 0.55));
      o[0] = o[1] = o[2] = 1;
      o[3] = Math.pow(a, 0.85);
    },
    // 2 — Smudge: the small dark kiss a drift spark leaves on the tarmac.
    (u: number, v: number, o: Float32Array) => {
      const x = (u - 0.5) * 2, y = (v - 0.5) * 2.6;
      const d = Math.hypot(x, y);
      const n = fbm2(u * 9, v * 4, 3);
      o[0] = o[1] = o[2] = 1;
      o[3] = clamp01(sstep(1.0, 0.25, d + (n - 0.5) * 0.5)) * 0.8;
    },
  ];
}

export class Decals {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly buffer: THREE.InterleavedBuffer;
  private readonly data: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  /** protected, not private: a subclass's own layers draw from the same atlas */
  protected readonly atlas: THREE.DataTexture;
  private head = 0;
  /** oldest live quad; [tail, tail+used) mod capacity is the live window */
  private tail = 0;
  private used = 0;
  /** wall-clock expiry of each slot, so the ring can retire its own tail */
  private readonly expire: Float32Array;
  private frameStart = 0;
  private frameWrote = 0;
  private fullDirty = false;


  /**
   * QUADS LAID SINCE THE LAST `clear()`, BY ATLAS SLOT. Diagnostics only: four
   * integers incremented in `quad`, never read by the renderer.
   *
   * It exists because a report can say "8573 of 9000 quads live" and cannot say
   * how many of them were the mark under investigation — and in one
   * base-building game the answer WAS the finding: the boot prints were
   * authored, laid LAST, and starved by the ring guards ahead of them.
   * `liveCount` cannot see that and neither can a screenshot.
   */
  readonly tally = new Int32Array(4);

  /** How many quads are live. Diagnostics read this. */
  get liveCount(): number { return this.used; }

  /**
   * @param opts.atlas a PREBUILT atlas, replacing the one this constructor
   *   would pack from `tiles`. It exists for a game whose atlas differs from
   *   `buildAtlas`'s in a way that is visible on screen — one sets anisotropy
   *   and orders its mip chain differently — so that adopting this layer
   *   cannot silently change what its marks look like. Handing over the
   *   texture is a smaller promise than handing over the packer.
   * @param opts.name the mesh's name. Ablation harnesses select layers by it,
   *   so two layers in one scene must not share one.
   */
  constructor(readonly capacity: number, tileSize: number, tiles: TileFn[],
              opts: { atlas?: THREE.DataTexture; name?: string } = {}) {
    this.atlas = opts.atlas ?? buildAtlas(tiles, 2, 2, tileSize);
    this.expire = new Float32Array(capacity);
    this.data = new Float32Array(capacity * 4 * VSTRIDE);
    this.buffer = new THREE.InterleavedBuffer(this.data, VSTRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    this.geo.setAttribute('uv', new THREE.InterleavedBufferAttribute(this.buffer, 2, 3));
    this.geo.setAttribute('aLife', new THREE.InterleavedBufferAttribute(this.buffer, 2, 5));
    this.geo.setAttribute('aTint', new THREE.InterleavedBufferAttribute(this.buffer, 4, 7));

    // TWO COPIES OF THE INDEX BUFFER, AND THIS IS A FRAME-PACING FIX.
    //
    // The live set is the ring window [tail, tail + used). `setDrawRange` can
    // express exactly one span, so when that window straddled the ring's wrap
    // the only correct single span was the WHOLE RING — every expired quad in
    // the buffer rasterised, texture-fetched and discarded, on a layer that is
    // blended and lying flat across the road. With a live set of ~70 quads
    // against a 1200-quad ring that is a seventeen-fold spike in decal fill,
    // and it lands on whichever frame the wrap happens to fall on. A single
    // frame that costs seventeen times its neighbours is exactly the stutter
    // the player is reporting as a black flash.
    //
    // Duplicating the index list makes quad q addressable at BOTH q and
    // q + capacity, so a window that runs off the end of the ring is still one
    // contiguous run of indices starting at `tail * 6`. The draw is now always
    // proportional to what is actually on the road. Cost: capacity * 12 extra
    // Uint16s — 77 KB at the largest tier, uploaded once, never touched again.
    //
    // Uint16 is safe by construction: the largest capacity any tier asks for is
    // 3200, i.e. 12 800 vertices, a fifth of the 65 536 an index can address.
    const idx = new Uint16Array(capacity * 12);
    for (let q = 0; q < capacity; q++) {
      const b = q * 4;
      const o = q * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
      idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
      idx.copyWithin((capacity + q) * 6, o, o + 6);
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: this.atlas },
        uAtlasTiles: { value: new THREE.Vector2(2, 2) },
        uTime: { value: 0 },
      },
      vertexShader: DECAL_VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.MultiplyBlending,
      // three only wires up MultiplyBlending's blend func on the premultiplied
      // path; without this the state call is refused and marks draw as normal
      // alpha. We never include the premultiply chunk, so the shader is
      // unaffected — this flag exists purely to select the right blend func.
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -12,
      // The output is a multiplier, not a radiance value; tone mapping it
      // would lift the marks toward grey.
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = opts.name ?? 'fx-decals';
    // Decals go down after opaque geometry but before every particle.
    this.mesh.renderOrder = 5;
  }

  /** writes one of the four vertices of the quad currently being laid */
  private vert(o: number, x: number, y: number, z: number, u: number, v: number,
               birth: number, life: number, tr: number, tg: number, tb: number, s: number,
               ox: number, oy: number) {
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = ox + u * 0.5;   // atlas is 2x2
    d[o + 4] = oy + v * 0.5;
    d[o + 5] = birth; d[o + 6] = life;
    d[o + 7] = tr; d[o + 8] = tg; d[o + 9] = tb; d[o + 10] = s;
  }

  /**
   * Lay one quad from four world-space corners in winding order a,b,c,d.
   * `sa` applies to the a/b edge and `sb` to the c/d edge — i.e. to the two
   * ENDS of a strip segment, so consecutive segments hand strength across
   * their joins without pulsing.
   */
  private quad(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    tile: number, birth: number, life: number,
    tr: number, tg: number, tb: number, sa: number, sb: number,
  ) {
    const i = this.head;
    this.head = this.head + 1;
    if (this.head >= this.capacity) this.head = 0;
    if (this.used < this.capacity) this.used++;
    else this.tail = this.head;   // recycled the oldest: the window slides
    this.expire[i] = birth + life;
    this.frameWrote++;
    if (tile >= 0 && tile < 4) this.tally[tile]!++;

    const ox = (tile & 1) * 0.5;
    const oy = (tile >> 1) * 0.5;
    const b0 = i * 4 * VSTRIDE;
    this.vert(b0, ax, ay, az, 0, 0, birth, life, tr, tg, tb, sa, ox, oy);
    this.vert(b0 + VSTRIDE, bx, by, bz, 1, 0, birth, life, tr, tg, tb, sa, ox, oy);
    this.vert(b0 + VSTRIDE * 2, cx, cy, cz, 1, 1, birth, life, tr, tg, tb, sb, ox, oy);
    this.vert(b0 + VSTRIDE * 3, dx, dy, dz, 0, 1, birth, life, tr, tg, tb, sb, ox, oy);
  }

  /**
   * A strip segment from `a` to `b` on a surface with normal `n`.
   * `sa`/`sb` are the mark strengths at each end (0..1) — feed the run-in and
   * run-out of a skid with low values and it fades in and out naturally.
   *
   * `tile` and `lift` are trailing arguments so a racer's existing calls are
   * unchanged, and they are arguments at all because neither is a property of
   * a strip. A rover track and a worn footpath are different SLOTS of the same
   * geometry, and 0.025 m of lift is right over a graded carriageway and not
   * over a 2 m heightfield — where a flickering track across the hero road
   * would be the most visible artefact in the frame.
   */
  skid(a: THREE.Vector3, b: THREE.Vector3, n: THREE.Vector3, width: number,
       sa: number, sb: number, now: number, life: number,
       tr = 0.30, tg = 0.28, tb = 0.30, tile: number = DECAL_SKID, lift = 0.025) {
    _seg.subVectors(b, a);
    if (_seg.lengthSq() < 1e-6) return;
    _n.copy(n).normalize();
    _side.crossVectors(_seg, _n);
    if (_side.lengthSq() < 1e-8) return;
    _side.normalize().multiplyScalar(width * 0.5);
    _c0.copy(a).addScaledVector(_n, lift);
    _c1.copy(b).addScaledVector(_n, lift);
    this.quad(
      _c0.x - _side.x, _c0.y - _side.y, _c0.z - _side.z,
      _c0.x + _side.x, _c0.y + _side.y, _c0.z + _side.z,
      _c1.x + _side.x, _c1.y + _side.y, _c1.z + _side.z,
      _c1.x - _side.x, _c1.y - _side.y, _c1.z - _side.z,
      tile, now, life, tr, tg, tb, sa, sb,
    );
  }

  /**
   * ONE RECTANGULAR MARK lying on the surface, its LENGTH along a world heading.
   *
   * ── WHY THIS IS NOT `blot` ─────────────────────────────────────────────────
   * `blot` takes a single radius and is exactly right for a radially symmetric
   * tile and exactly wrong for anything with a direction. A boot print is
   * 0.34 m long and 0.15 m wide — a 2.3:1 rectangle — and the only quad `blot`
   * can build is a square, so a print laid through it is either the right
   * length at twice the width or the right width at half the length. Under a
   * crowd at 5x that is the difference between a boot print and a smudge.
   *
   * `blot`'s basis is also arbitrary AND RANDOMLY ROTATED, which is right for
   * hiding the repeat in a scorch and wrong for a print: a caller passing a
   * compass heading gets a mark pointing anywhere. Here the length axis is the
   * heading PROJECTED ONTO THE SURFACE, so the mark agrees with the direction
   * of travel on flat ground and on a slope.
   *
   * @param halfW half the quad's width, metres, ACROSS the heading
   * @param halfL half the quad's length, metres, ALONG it
   * @param yaw   world heading, 0 = +Z
   */
  mark(p: THREE.Vector3, n: THREE.Vector3, halfW: number, halfL: number, tile: number,
       now: number, life: number, strength: number,
       tr = 0.30, tg = 0.28, tb = 0.26, yaw = 0) {
    _n.copy(n).normalize();
    _seg.set(Math.sin(yaw), 0, Math.cos(yaw));
    _seg.addScaledVector(_n, -_n.dot(_seg));
    if (_seg.lengthSq() < 1e-8) _seg.set(0, 0, 1); else _seg.normalize();
    _side.crossVectors(_seg, _n);
    if (_side.lengthSq() < 1e-8) return;
    _side.normalize();
    const ex = _side.x * halfW, ey = _side.y * halfW, ez = _side.z * halfW;
    const fx = _seg.x * halfL, fy = _seg.y * halfL, fz = _seg.z * halfL;
    const px = p.x + _n.x * 0.03, py = p.y + _n.y * 0.03, pz = p.z + _n.z * 0.03;
    this.quad(
      px - ex - fx, py - ey - fy, pz - ez - fz,
      px + ex - fx, py + ey - fy, pz + ez - fz,
      px + ex + fx, py + ey + fy, pz + ez + fz,
      px - ex + fx, py - ey + fy, pz - ez + fz,
      tile, now, life, tr, tg, tb, strength, strength,
    );
  }

  /** A radially symmetric mark (scorch, smudge, splat) lying on the surface. */
  blot(p: THREE.Vector3, n: THREE.Vector3, radius: number, tile: number,
       now: number, life: number, strength: number,
       tr = 0.09, tg = 0.075, tb = 0.07) {
    _n.copy(n).normalize();
    // any two vectors orthogonal to n, rotated randomly so repeats don't align
    _seg.set(_n.y, -_n.z, _n.x);
    _side.crossVectors(_n, _seg).normalize();
    _seg.crossVectors(_side, _n).normalize();
    const a = Math.random() * Math.PI * 2;
    const ca = Math.cos(a) * radius, sa2 = Math.sin(a) * radius;
    const ex = _side.x * ca + _seg.x * sa2, ey = _side.y * ca + _seg.y * sa2, ez = _side.z * ca + _seg.z * sa2;
    const fx = -_side.x * sa2 + _seg.x * ca, fy = -_side.y * sa2 + _seg.y * ca, fz = -_side.z * sa2 + _seg.z * ca;
    const px = p.x + _n.x * 0.03, py = p.y + _n.y * 0.03, pz = p.z + _n.z * 0.03;
    this.quad(
      px - ex - fx, py - ey - fy, pz - ez - fz,
      px + ex - fx, py + ey - fy, pz + ez - fz,
      px + ex + fx, py + ey + fy, pz + ez + fz,
      px - ex + fx, py - ey + fy, pz - ez + fz,
      tile, now, life, tr, tg, tb, strength, strength,
    );
  }

  /**
   * A scorch keyed to an *emissive* effect colour — a drift tier, a boost pad.
   *
   * The art direction asks for a ground-scorch decal under the drift sparks in
   * the tier colour, but this layer multiplies: it can only ever darken what it
   * lands on, and a saturated `#ff9d2e` used directly as a multiplier would
   * strip the blue out of the tarmac and leave a flat orange stain rather than
   * a burn. So the emissive colour is converted into a *tint of the darkening*:
   * a common dark floor plus a hue lift normalised by the colour's strongest
   * channel, which keeps every tier equally dark and lets the hue live in the
   * ratio between the channels. Tier 2 leaves a warm brown scorch, tier 1 a
   * cool one, tier 3 a violet one, and all three read as burnt road.
   */
  scorch(p: THREE.Vector3, n: THREE.Vector3, radius: number, col: THREE.Color,
         now: number, life: number, strength: number, tile: number = DECAL_SCORCH) {
    const mx = Math.max(col.r, col.g, col.b) || 1;
    const k = 0.34 / mx;
    this.blot(p, n, radius, tile, now, life, strength,
      0.070 + col.r * k, 0.065 + col.g * k, 0.060 + col.b * k);
  }

  /** Re-upload everything — after a WebGL context restore. */
  invalidate() { this.fullDirty = true; this.atlas.needsUpdate = true; }

  update(time: number) {
    const cap = this.capacity;
    // the two `!`s in this method are `noUncheckedIndexedAccess` (this package
    // is strict where the games are not) and are type-only — see tsconfig.base.
    this.material.uniforms.uTime!.value = time;

    // --- retire the tail --------------------------------------------------
    //
    // `used` only ever grew, so within a couple of laps the layer was drawing
    // its full 3200 quads on every frame forever — a road's worth of expired
    // marks, each one still rasterised and each one still fetching the atlas
    // before the fragment shader could discard it. On a phone that is a few
    // million wasted blended fragments a frame, and it is invisible in a
    // profiler because nothing about it changes: it is just permanently slow.
    //
    // Marks are laid in time order and recycled oldest-first, so the live set
    // is the ring window [tail, head). Walking the tail forward past whatever
    // has expired keeps the draw proportional to what is actually on the road —
    // typically a few hundred quads instead of the whole ring. The scan is
    // capped so an expiry cliff (a race reset, a whole field's marks ageing out
    // together) is amortised over a few frames rather than spent in one.
    let scan = 256;
    while (this.used > 0 && scan-- > 0 && this.expire[this.tail]! <= time) {
      this.tail = this.tail + 1 >= cap ? 0 : this.tail + 1;
      this.used--;
    }

    // One contiguous span, wrap or no wrap — see the doubled index list in the
    // constructor. A straddling window simply runs on into the second copy.
    this.geo.setDrawRange(this.tail * 6, this.used * 6);

    // --- upload only what was written -------------------------------------
    const per = 4 * VSTRIDE;
    const buf = this.buffer;
    if (this.fullDirty || this.frameWrote >= cap) {
      buf.clearUpdateRanges();
      buf.addUpdateRange(0, cap * per);
      buf.needsUpdate = true;
    } else if (this.frameWrote > 0) {
      buf.clearUpdateRanges();
      const end = this.frameStart + this.frameWrote;
      if (end <= cap) {
        buf.addUpdateRange(this.frameStart * per, this.frameWrote * per);
      } else {
        buf.addUpdateRange(this.frameStart * per, (cap - this.frameStart) * per);
        buf.addUpdateRange(0, (end - cap) * per);
      }
      buf.needsUpdate = true;
    }
    this.fullDirty = false;
    this.frameStart = this.head;
    this.frameWrote = 0;
  }

  /**
   * Wipe every mark — used on race reset.
   *
   * No memset and no upload. This used to `fill(0)` 140 000 floats and then
   * mark the whole 1.4 MB buffer dirty, i.e. a 563 KB clear plus a full-buffer
   * re-upload on the countdown frame — a hitch on precisely the frame the
   * player is watching the lights. Resetting the ring pointers is enough: the
   * draw range collapses to nothing, and the stale floats behind it are
   * overwritten before they can ever be drawn again.
   */
  clear() {
    this.head = 0; this.tail = 0; this.used = 0;
    this.frameStart = 0; this.frameWrote = 0;
    this.tally.fill(0);
    this.geo.setDrawRange(0, 0);
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
    this.atlas.dispose();
  }
}
