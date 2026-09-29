/**
 * ============================================================================
 *  starfield.ts — the star CATALOGUE. How many stars there are, how bright each
 *  one is, what colour it is, and where the band runs.
 * ============================================================================
 *
 * A space racer's `Atmosphere.ts` and a base-building game's `Stars.ts` had
 * this twice, and unusually they said so out loud: the base-building game's
 * own header recorded that `bakeStarfield` was inherited from the space racer
 * and was to be taken verbatim. Two copies of a verbatim inheritance is a fork
 * waiting to happen, and it had already half-happened — the base-building
 * game's copy grew a per-star sprite size and a diffraction cross that
 * the sibling never got, and the sibling's band offset and HDR ladder had moved
 * on without it.
 *
 * ## What is one thing here, and what is two
 *
 * ONE THING, and it is all of the physics:
 *
 *   · a seeded, deterministic bake — the same seed is the same sky, which is
 *     the property that makes an A/B of two builds a measurement rather than an
 *     anecdote;
 *   · the count law, `N ∝ 10^(slope · m)`, drawn by exact inverse-CDF over an
 *     apparent-magnitude window and mapped onto an HDR window;
 *   · uniform-on-the-sphere positions by inverse-CDF in z — NOT by uniform
 *     (theta, phi), which clusters at the poles, and in both of these games the
 *     zenith is somewhere the player looks straight up at;
 *   · a two-component Gaussian dust band about a plane normal, with extinction
 *     rifts cut through it in longitude, band members drawn fainter and redder;
 *   · B−V → Ballesteros → Planckian locus → linear sRGB at unit luminance, and
 *     a chroma gain applied about that unit-luminance grey.
 *
 * TWO THINGS, and every one of them is a NUMBER the game supplies through
 * `StarfieldSpec`: the magnitude window, the HDR ladder, the band's normal and
 * its share of the population, how much fainter its members run, the chroma
 * gain, and the sprite geometry. A vacuum sky over a lunar colony and a vacuum
 * sky over a racing deck are two people's art direction reached through one
 * model, which is exactly the split this package exists to make.
 *
 * **EVERY FIELD OF `StarfieldSpec` IS REQUIRED AND NONE OF THEM HAS A DEFAULT.**
 * A game that forgets one fails to compile. A game that gets a default gets the
 * other game's sky and it looks completely fine.
 *
 * ## Two things measured before the move, so nobody re-derives them
 *
 * **The band projection is written with `cp`/`sp` hoisted out of the three
 * component expressions.** The space racer wrote `bandX.x * Math.cos(phi) * r`,
 * i.e. `(bandX.x * cos) * r`, and the base-building game wrote `bandX.x * cp`
 * with `cp = cos * r`, i.e. `bandX.x * (cos * r)`. Those are NOT the same
 * double: measured on both games' real rng streams, 2,063 of 5,934 and 12,346
 * of 36,399 band components differ in the last bits. They ARE the same
 * `Float32Array` element — `position` is float32 and the difference rounds away
 * in every one of the 42,333 band components both games actually produce,
 * measured, zero mismatches. So the hoisted form is used, it is three trig
 * calls per star instead of six, and both games' bakes are bit-identical to
 * what they were.
 *
 * **The rng is the game's, passed in, not seeded here.** It keeps this file
 * free of a dependency on `@homie-rocks/noise` for one nine-line generator, and it
 * makes the stream visible at the call site, which is the thing that has to
 * match when a bake is compared across a change. The stream order is part of
 * the contract: see `bakeStarfield`.
 *
 * ## Nothing here takes a `Ctx`
 *
 * Same line `skyrig.ts` and `cascade.ts` draw. Everything below takes numbers,
 * vectors and one plain struct.
 * ============================================================================
 */
import * as THREE from 'three';

/** A uniform [0,1) source. Both games hand in `mulberry32(seed)`. */
export type StarRng = () => number;

/**
 * Box-Muller, one value per call, so it burns TWO rng draws.
 *
 * That cost is part of the stream contract — see `bakeStarfield` — and it is
 * why the returned value is not cached: caching the second normal would halve
 * the draws and silently re-roll every star after the first band member.
 */
export function gaussian(rng: StarRng): number {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function clampUnit(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstepUnit(e0: number, e1: number, x: number): number {
  const t = clampUnit((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/**
 * The dust rifts, as a function of longitude along the band.
 *
 * Three incommensurate harmonics, so the pattern never repeats inside one turn
 * and cannot be read as a waveform. Returns 1 where the band is clear and 0
 * where it is fully obscured; a band member landing in an obscured longitude is
 * re-drawn into the general field instead, which is exactly what extinction
 * does — the star is still there, it is behind the dust.
 *
 * THE RIFTS ARE WHAT MAKE THIS INCAPABLE OF READING AS A LIGHT SHAFT, and that
 * is why the function is exported rather than inlined. A shaft of scattered
 * light is brightest along its own axis and cannot have a dark gap in it; a
 * dust band is DEFINED by its gaps. Both games also paint a haze over the same
 * volume, and both import this rather than declaring their own so the dark
 * rifts in the haze fall exactly where the star density drops.
 *
 * The harmonics are deliberately NOT spec fields. They are the shape of a dust
 * band, not a look: changing them changes which longitudes are dark, which is
 * a reseed rather than an art direction, and a game that wants a different one
 * wants a different seed.
 */
export function laneClearance(phi: number): number {
  const a = Math.sin(phi * 3.0 + 0.7) * 0.55
    + Math.sin(phi * 7.0 + 2.1) * 0.30
    + Math.sin(phi * 17.0 + 4.3) * 0.15;
  return clampUnit((a + 0.42) / 0.90);
}

/**
 * The band's own orthonormal frame: two unit vectors spanning the plane
 * perpendicular to `normal`, with the first one rotated `lonOffset` radians
 * about the normal.
 *
 * **THIS EXISTS BECAUSE BOTH GAMES HAD THE STAR BAKE AND THE PAINTED HAZE
 * DERIVING IT SEPARATELY FROM THE SAME NORMAL.** The base-building game caught
 * that on its own and left the note: the two derivations agreed only because
 * nobody had touched either, and a longitude offset applied to one of them —
 * which is exactly what `lonOffset` is — rotates the painted haze off its own
 * stars with no error anywhere. One derivation, every consumer.
 *
 * `lonOffset` of 0 is bit-exactly the un-rotated frame: three's
 * `applyAxisAngle` with a zero angle builds the identity quaternion and
 * `applyQuaternion` returns the input components unchanged. Verified rather
 * than assumed, because a sky rotating by one ulp is a sky nobody can compare.
 */
export function bandFrame(
  normal: THREE.Vector3,
  lonOffset: number,
): { x: THREE.Vector3; y: THREE.Vector3 } {
  const x = new THREE.Vector3(0, 1, 0).cross(normal);
  // Degenerate only if the band's plane contained world up exactly. It does
  // not in either game, but a zero vector here would NaN every band star.
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  x.normalize().applyAxisAngle(normal, lonOffset);
  const y = new THREE.Vector3().crossVectors(normal, x).normalize();
  return { x, y };
}

/**
 * B−V colour index → blackbody temperature, Ballesteros (2012). Good to a few
 * percent over the whole main sequence, which is far better than the eye needs
 * from something 1.4 px across.
 */
export function bvToKelvin(bv: number): number {
  const a = 0.92 * bv;
  return 4600 * (1 / (a + 1.7) + 1 / (a + 0.62));
}

/**
 * Planckian locus in CIE xy (Kim et al. cubic), then xy → XYZ → linear sRGB,
 * normalised to unit luminance so the magnitude alone sets brightness.
 *
 * THIS IS NOT DECORATION. A monochrome white starfield is the single loudest
 * "procedural sky" tell available, because every real star field is a scatter
 * of blue-white, straw and orange points and the eye knows it without being
 * able to say why. Both games shipped a version with a reviewer naming it.
 *
 * Unit luminance is the property the chroma gain in `bakeStarfield` depends on:
 * pushing a unit-luminance triplet away from 1.0 is a pure saturation move, so
 * a star's brightness — and therefore the field's contribution to every
 * luminance-histogram check either game runs — is bit-identical whatever the
 * gain is set to.
 */
export function blackbodyLinear(kelvin: number, out: THREE.Vector3): THREE.Vector3 {
  const T = Math.min(Math.max(kelvin, 1667), 25000);
  const t = 1000 / T;
  let x: number;
  if (T <= 4000) {
    x = -0.2661239 * t * t * t - 0.2343589 * t * t + 0.8776956 * t + 0.179910;
  } else {
    x = -3.0258469 * t * t * t + 2.1070379 * t * t + 0.2226347 * t + 0.240390;
  }
  let y: number;
  if (T <= 2222) {
    y = -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683;
  } else if (T <= 4000) {
    y = -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867;
  } else {
    y = 3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483;
  }
  const Y = 1;
  const X = (x / Math.max(y, 1e-4)) * Y;
  const Z = ((1 - x - y) / Math.max(y, 1e-4)) * Y;
  // XYZ → linear sRGB (D65)
  let r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  let g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  let b = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  r = Math.max(r, 0); g = Math.max(g, 0); b = Math.max(b, 0);
  const lum = Math.max(0.2126 * r + 0.7152 * g + 0.0722 * b, 1e-5);
  return out.set(r / lum, g / lum, b / lum);
}

/**
 * Everything about a star field that is a LOOK rather than a mechanism.
 *
 * Every field is required. There are no defaults here and there must not be
 * one added: a sky is the largest single surface in either of these games, and
 * a game that inherits half of another game's sky by forgetting a field looks
 * completely fine and is wrong.
 */
export interface StarfieldSpec {
  /** Brightest apparent magnitude drawn. */
  magMin: number;
  /** Faintest apparent magnitude drawn. Members are clamped to this. */
  magMax: number;
  /** Scene-linear HDR value `magMin` maps to. */
  hdrAtMagMin: number;
  /** Scene-linear HDR value `magMax` maps to. */
  hdrAtMagMax: number;
  /**
   * Exponent of the count law, `N ∝ 10^(slope · m)`. 0.6 is the astrophysical
   * one. It is the single number that decides how many unmistakable anchor
   * stars the field has, which is why it is a field and not a constant.
   */
  countLawSlope: number;
  /**
   * Saturation gain on the blackbody colour, about its own unit-luminance
   * point. 1.0 is the physics. Anything above it is compensation for what a
   * 1.4 px point loses to antialiasing and to a highlight-desaturation grade,
   * which is a property of the game's post chain and therefore the game's.
   */
  chromaGain: number;
  /** Normal of the band's plane, unit length, world space. */
  bandNormal: THREE.Vector3;
  /** Band frame, longitude zero. From `bandFrame`. */
  bandX: THREE.Vector3;
  /** Band frame, longitude +90 degrees. From `bandFrame`. */
  bandY: THREE.Vector3;
  /**
   * Fraction of the population OFFERED to the band. Not the fraction that
   * lands in it: `laneClearance` re-draws obscured candidates into the general
   * field, and its mean over longitude is about 0.47, so barely half of the
   * candidates ever become band members.
   */
  bandFraction: number;
  /** Gaussian sigma of the band's dense core, in direction cosine off plane. */
  bandCoreSigma: number;
  /** Gaussian sigma of the broader halo around it. */
  bandHaloSigma: number;
  /** Share of band members drawn from the core rather than the halo. */
  bandCoreShare: number;
  /**
   * Magnitudes fainter band members run than the general field.
   *
   * THIS DECIDES WHETHER THE BAND READS AS A BAND OR AS A CONSTELLATION. A dust
   * band is an unresolved population — many faint members, not fewer bright
   * ones — and a concentration of BRIGHT points reads as a shape the eye names.
   * It also has a ceiling nobody guesses right: under a `countLawSlope` of 0.6
   * the median field star is already near `magMax`, so a large offset pushes
   * most of the band onto the clamp and the band becomes a patch of identical
   * floor-value dots the tone map's toe swallows whole. Both games shipped that
   * once, from opposite directions.
   */
  bandMagOffset: number;
  /** Interstellar reddening through the dust, in B−V. */
  bandReddening: number;
  /** Sprite width in FRAMEBUFFER pixels for a star with no diffraction cross. */
  spriteBasePx: number;
  /**
   * Extra sprite width at full cross strength, to give the arms room.
   *
   * ZERO IS A STARFIELD WITH NO DIFFRACTION CROSS, and that is the honest way
   * to say it: every `size` is then exactly `spriteBasePx` and every `cross` is
   * a strength nothing draws. It is not a flag and there is no branch on it.
   */
  spriteCrossPx: number;
  /** HDR value at which the cross starts to appear. */
  crossHdrLo: number;
  /** HDR value at which the cross reaches full strength. */
  crossHdrHi: number;
}

export interface StarfieldData {
  /** unit direction per star, xyz triples */
  position: Float32Array;
  /** linear-sRGB blackbody colour per star, already scaled by its HDR value */
  color: Float32Array;
  /** per-star phase, so the sub-pixel temporal jitter is decorrelated */
  phase: Float32Array;
  /** sprite width in framebuffer pixels */
  size: Float32Array;
  /** 0..1 diffraction-cross strength */
  cross: Float32Array;
  count: number;
}

/**
 * Bake the field. Deterministic in `rng`, which the caller seeds.
 *
 * ## THE RNG STREAM IS PART OF THE CONTRACT
 *
 * Per star, in this order and no other:
 *
 *   band candidates (`i < round(count · bandFraction)`) draw a longitude, then
 *   one acceptance value against `laneClearance`; an ACCEPTED member then draws
 *   a core/halo choice and TWO more for `gaussian`, and skips the uniform draw.
 *   A REJECTED candidate falls through to the uniform draw like any other star.
 *   Every star then draws three for a uniform direction if it is not a band
 *   member, one for magnitude, one for B−V, and one for phase.
 *
 * Anything that changes how many values are drawn — caching Box-Muller's second
 * normal, adding a rejection loop, reordering the two branches — re-rolls every
 * star after the first band candidate. Both skies are compared bake-to-bake by
 * a starfield parity probe for exactly that reason.
 *
 * ## The three distributions
 *
 *  · MAGNITUDE by exact inverse-CDF on `N ∝ 10^(slope · m)` over
 *    [`magMin`, `magMax`]:  CDF(m) ∝ 10^(s m) − 10^(s m0), so
 *    m = log10( lo + u (hi − lo) ) / s. One log and one pow per star, at bake
 *    time, for the population that fills the empty half of every frame.
 *  · POSITION uniform on the sphere by inverse-CDF in z.
 *  · THE BAND, a two-component Gaussian in the direction cosine off
 *    `bandNormal`, with `laneClearance` extinction cut through it in longitude.
 *
 * `k` is solved rather than authored so the faint end lands exactly on
 * `hdrAtMagMax`. Note which way it can go: k above 1 STRETCHES the photometric
 * range past the real one, k below 1 COMPRESSES it — which is what an eye
 * adapted to a dark sky does, and it is the only way the faintest stars clear
 * the tone map's toe instead of dithering in and out between frames. Ordering
 * is preserved either way, so the count law's shape survives intact.
 */
export function bakeStarfield(
  count: number,
  spec: StarfieldSpec,
  rng: StarRng,
): StarfieldData {
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const size = new Float32Array(count);
  const cross = new Float32Array(count);
  const rgb = new THREE.Vector3();

  const bandX = spec.bandX;
  const bandY = spec.bandY;
  const N = spec.bandNormal;

  // hdr(m) = hdrAtMagMin · 10^(-0.4 k (m - magMin)).
  const k = Math.log10(spec.hdrAtMagMax / spec.hdrAtMagMin)
    / (-0.4 * (spec.magMax - spec.magMin));
  const bandCount = Math.round(count * spec.bandFraction);
  // Inverse-CDF bounds for the count law.
  const magLo = Math.pow(10, spec.countLawSlope * spec.magMin);
  const magHi = Math.pow(10, spec.countLawSlope * spec.magMax);

  for (let i = 0; i < count; i++) {
    let inBand = false;
    let extinction = 0;

    if (i < bandCount) {
      const phi = rng() * Math.PI * 2;
      const clear = laneClearance(phi);
      // Extinguished candidates fall through to the uniform draw below. That IS
      // the rift mechanism: the band is thinner where the dust is thicker.
      if (rng() < clear) {
        const sigma = rng() < spec.bandCoreShare ? spec.bandCoreSigma : spec.bandHaloSigma;
        // Direction cosine off the plane. Clamped rather than rejected: a
        // rejection loop would make the bake's cost depend on the rng stream,
        // and this tail is 6 sigma out.
        const w = Math.max(-0.999, Math.min(0.999, gaussian(rng) * sigma));
        const r = Math.sqrt(Math.max(1 - w * w, 0));
        const cp = Math.cos(phi) * r;
        const sp = Math.sin(phi) * r;
        const dx = bandX.x * cp + bandY.x * sp + N.x * w;
        const dy = bandX.y * cp + bandY.y * sp + N.y * w;
        const dz = bandX.z * cp + bandY.z * sp + N.z * w;
        const inv = 1 / Math.max(Math.hypot(dx, dy, dz), 1e-6);
        position[i * 3] = dx * inv;
        position[i * 3 + 1] = dy * inv;
        position[i * 3 + 2] = dz * inv;
        inBand = true;
        // Reddening tracks how much dust the light came through, so the edges
        // of a rift are redder than its clear middle. It is the same physical
        // quantity that removed the neighbouring star.
        extinction = 1 - clear;
      }
    }

    if (!inBand) {
      const z = rng() * 2 - 1;
      const r = Math.sqrt(Math.max(1 - z * z, 0));
      const phi = rng() * Math.PI * 2;
      position[i * 3] = Math.cos(phi) * r;
      position[i * 3 + 1] = z;
      position[i * 3 + 2] = Math.sin(phi) * r;
    }

    let m = Math.log10(magLo + rng() * (magHi - magLo)) / spec.countLawSlope;
    if (inBand) m += spec.bandMagOffset;
    m = Math.min(Math.max(m, spec.magMin), spec.magMax);
    const hdr = spec.hdrAtMagMin * Math.pow(10, -0.4 * k * (m - spec.magMin));

    // B−V weighted toward the blue-white end, roughly -0.3..1.6, i.e. B0
    // through K5. That is what a magnitude-limited sample of a real sky is:
    // the intrinsically bright stars visible from far away are the hot ones.
    let bv = -0.30 + 1.9 * Math.pow(rng(), 1.6);
    if (inBand) bv += spec.bandReddening * (0.35 + 0.65 * extinction);
    blackbodyLinear(bvToKelvin(bv), rgb);
    // Chroma gain about the unit-luminance grey. See `blackbodyLinear`: this
    // cannot change a star's brightness. Clamped at zero per channel so a
    // strong gain on an already-saturated red cannot go negative in blue.
    rgb.set(
      Math.max(1 + (rgb.x - 1) * spec.chromaGain, 0),
      Math.max(1 + (rgb.y - 1) * spec.chromaGain, 0),
      Math.max(1 + (rgb.z - 1) * spec.chromaGain, 0),
    );
    color[i * 3] = rgb.x * hdr;
    color[i * 3 + 1] = rgb.y * hdr;
    color[i * 3 + 2] = rgb.z * hdr;

    const c = smoothstepUnit(spec.crossHdrLo, spec.crossHdrHi, hdr);
    cross[i] = c;
    size[i] = spec.spriteBasePx + spec.spriteCrossPx * c;
    phase[i] = rng() * Math.PI * 2;
  }

  return { position, color, phase, size, cross, count };
}

// ---------------------------------------------------------------------------
// The object the baked field is drawn as
// ---------------------------------------------------------------------------

/** What `starfieldPoints` needs and cannot work out from the catalogue. */
export interface StarfieldPointsOpts {
  /** The material's `name`. It is what a scene-graph audit reports. */
  name: string;
  /** `2 / drawingBufferHeight` at build time; the game re-writes it per frame. */
  pixelScale: number;
  /** Direction toward the body that occludes stars, tested in the vertex stage. */
  occluderDir: THREE.Vector3;
  /** Cosine of that body's angular radius. `1` means "nothing occludes". */
  occluderCos: number;
  /** `starSpriteShaders(...).vertex`. Passed in, so this file needs no sprite. */
  vertexShader: string;
  /** `starSpriteShaders(...).fragment`. */
  fragmentShader: string;
}

/** The three handles a game needs back. */
export interface StarfieldPoints {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  /** Exposed so a second `Points` for an env bake can SHARE it. See below. */
  geometry: THREE.BufferGeometry;
}

/**
 * Turn a baked catalogue into the one draw call it is drawn as.
 *
 * ## Why this is here and not in a game
 *
 * `bakeStarfield` above already produced the five buffers and `starsprite.ts`
 * already produced the program that reads them. What was left in the games was
 * the twenty lines that name those five attributes in the order the program
 * declares them and set eight flags on a `Points` — and it sat in the
 * base-building game's `Stars.ts` and the space racer's `Sky.ts`, line for line
 * apart from the material's `name`, where the pixel scale came from, and whose
 * planet the occluder is. One move took the catalogue and an earlier one the
 * sprite; the seam BETWEEN them stayed in two games, which is the shape a fork
 * starts in. An attribute name misspelled on one side of it is not an error —
 * three leaves the attribute undefined, and the field renders black, or all at
 * one size, or unjittered, and looks completely plausible.
 *
 * ## The flags, and why each is the package's rather than a taste
 *
 *  · ADDITIVE, `depthWrite: false`, `transparent: true` — a star ADDS photons
 *    to whatever is behind it. No sky in these games is dark enough for
 *    that to be a choice.
 *  · `renderOrder = 1001` — one past `mountSkyDome`'s dome, so the dome (which
 *    writes no depth) cannot sort in front of the field, and so a game's
 *    `onBeforeRender` hung off the dome has always run before the field draws.
 *    The two numbers are a pair; moving one moves the other.
 *  · `frustumCulled = false` and `matrixAutoUpdate = false` — the field is a
 *    unit sphere of DIRECTIONS at the origin, so a culler is being asked
 *    whether a 1 m ball is on screen and the answer is usually no.
 *  · `boundingSphere` at 1e9 — the same fact written down, so anything that
 *    asks (a raycast, three's own `computeBoundingSphere`) gets the sky and not
 *    the 1 m ball. The base-building game set this and the space racer did not.
 *    Neither game raycasts its stars and both cull nothing, so no frame either
 *    game renders can observe it — SAID OUT LOUD BECAUSE IT IS THE ONE LINE
 *    THAT WAS NOT IN
 *    BOTH COPIES, and an unstated difference is how a merge becomes a defect.
 *  · `fog: false` — `scene.fog` is banned in both of these games, but three
 *    compiles the fog path in from the MATERIAL and not from the scene, so a
 *    `Fog` set by anything downstream would otherwise reach the stars.
 *
 * ## What the caller still does
 *
 * Adding it to a scene, and building the SECOND `Points` an env bake needs.
 * That one must share BOTH the geometry and the material with the visible field
 * — a probe baked from a copy is the classic way to get chrome reflecting a sky
 * nobody can see, the same argument `mountSkyDome` makes for the dome — so
 * `geometry` is returned rather than kept.
 */
export function starfieldPoints(
  data: StarfieldData,
  o: StarfieldPointsOpts,
): StarfieldPoints {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(data.color, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(data.phase, 1));
  // The sprite's own width and its diffraction-cross strength, both baked. The
  // fragment stage divides the width back out, so these change what a star
  // LOOKS like and never how much light it puts in the frame.
  geometry.setAttribute('aSize', new THREE.BufferAttribute(data.size, 1));
  geometry.setAttribute('aCross', new THREE.BufferAttribute(data.cross, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const material = new THREE.ShaderMaterial({
    name: o.name,
    uniforms: {
      uPixelScale: { value: o.pixelScale },
      uJitter: { value: 0 },
      uOccluderDir: { value: o.occluderDir },
      uOccluderCos: { value: o.occluderCos },
    },
    vertexShader: o.vertexShader,
    fragmentShader: o.fragmentShader,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: false,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'Starfield';
  points.frustumCulled = false;
  points.matrixAutoUpdate = false;
  points.renderOrder = 1001;
  points.castShadow = false;
  points.receiveShadow = false;

  return { points, material, geometry };
}
