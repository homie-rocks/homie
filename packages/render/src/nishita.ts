/**
 * ============================================================================
 *  nishita.ts — a golden-hour earth sky: the physical model, and the shaders
 *  that draw it.
 * ============================================================================
 *  WHERE THIS CAME FROM. This was 413 substantive lines sitting inside a kart
 *  racer's `Atmosphere.ts`, and it had no second copy anywhere — which is
 *  exactly why repeated duplication-hunting walked past it. A single
 *  implementation can still be 100% platform, and this one is: nothing below
 *  knows what a vehicle, a lap, a track or a `Ctx` is. It knows a sun
 *  direction, two hexes it must land on after tone mapping, and how air
 *  scatters light.
 *
 *  The model is Nishita single scattering integrated through a spherical
 *  atmosphere. Two things make it usable in a 60 fps game:
 *
 *  1. The scattering integrals are baked once, on the CPU, into a 2D LUT
 *     parameterised by (view elevation, angle to sun). With a FIXED sun that
 *     pair determines the geometry exactly, so the LUT is lossless up to
 *     interpolation. Crucially the *phase functions are not baked* — they are
 *     evaluated per pixel, which is what keeps the Mie forward lobe around the
 *     disc razor sharp while the expensive part stays a single texture fetch.
 *
 *  2. A two-point calibration layer sits on top: the Rayleigh term is scaled by
 *     a gain that is solved at boot so the tonemapped zenith and horizon land
 *     exactly on the game's authored hexes. The gain is fitted by numerically
 *     inverting three's ACES curve, so the sky obeys the art direction after
 *     tone mapping rather than before it — which is the only place it matters.
 *
 *  Everything here is deterministic; the same boot produces the same sky.
 *
 *  ---------------------------------------------------------------------------
 *  WHAT DID NOT MOVE, AND WHY THE SEAM IS WHERE IT IS
 *  ---------------------------------------------------------------------------
 *  Every COLOUR and every DIRECTION stayed in the game. `SkyArt` below carries
 *  them, and EVERY FIELD OF IT IS REQUIRED — no optionals and no defaults. A
 *  sky is the single loudest statement a game makes about what time of day it
 *  is and what planet it is on; a game that forgot a field and silently
 *  inherited the kart racer's #ffd0a0 horizon would look completely fine and
 *  would be wearing another game's art direction. It must fail to compile
 *  instead.
 *
 *  The constants that DID move are the ones that are nobody's taste: the
 *  planet's radius, the scale heights, the Rayleigh and Mie coefficients of
 *  air, the Cornette-Shanks asymmetry, the integration step counts, the LUT
 *  dimensions, and the two structural corrections single scattering needs to
 *  stop lying (the isotropic Mie floor and the Rayleigh backscatter
 *  suppression). Those are properties of air, or of the approximation, and a
 *  second earthlike sky would rediscover exactly them.
 * ============================================================================
 */
import * as THREE from 'three';
import { createNoise4D } from 'simplex-noise';

// --- what the game must state, and there are no defaults ---------------------

/**
 * The art direction a sky is built from. Every field is required; see the
 * header for why a default here is a silent theft of another game's look.
 */
export interface SkyArt {
  /** Unit vector pointing TOWARD the sun. The game's own key direction. */
  sun: THREE.Vector3;
  /** The exposure the calibration is solved against — the renderer's own. */
  exposure: number;
  /** Displayed zenith colour, after tone mapping. The solver hits this exactly. */
  zenithTarget: number;
  /** Displayed horizon colour, after tone mapping, probed 90° from the sun. */
  horizonTarget: number;
  /**
   * Floors for `inverseAces`. A sky authored bright never needs the search to
   * go as far down as a vacuum build's does, and a shared default would
   * re-tune whichever game did not get it — the symptom being a sky subtly
   * wrong in a build nobody changed.
   */
  acesFloor: number;
  acesProbeFloor: number;
  /** Sunlight arriving at cloud altitude, before `cloudSunGain`. */
  warmLight: number;
  /** The chromaticity `projectSH` pulls the irradiance probe toward. */
  fillTint: number;
  /** Multiplier on `warmLight` for the lit face of a cloud. */
  cloudSunGain: number;
  /** Multiplier on the zenith radiance for the shaded base of a cloud. */
  cloudAmbientGain: number;
  /** How far the shaded base is pulled toward its own luminance, 0..1. */
  cloudAmbientDesat: number;
  /** Albedo of the ground hemisphere, applied to the horizon radiance. */
  groundAlbedo: number;
  /** Additive warm pedestal under the ground hemisphere, linear RGB. */
  groundPedestal: [number, number, number];
  /** How bright the disc core is. High on purpose: it must clip and bloom. */
  sunDiscIntensity: number;
  /** Angular radius of the disc, radians. */
  sunAngularRadius: number;
  /** Seed for the tileable cloud noise. Same seed, same clouds, every boot. */
  cloudNoiseSeed: number;
}

/**
 * What the fragment shader needs that the model cannot know.
 *
 * `hazeFn` is a GLSL identifier prefix rather than a fixed name for a reason
 * that is not cosmetic: the SAME emitter also writes the haze function into
 * three's `fog_pars_fragment` ShaderChunk, which is shared by every material
 * in the game, and two games in one process would collide on one name. The
 * game names it, once, and the dome and the fog then read the same function.
 */
export interface SkyShaderArt {
  /** GLSL identifier for the emitted haze function, e.g. `krHaze`. */
  hazeFn: string;
  /**
   * The cloud decks, FAR FIRST. Compiled behind `#if CLOUD_LAYERS > n` so the
   * quality tier can drop the near decks; the caller sets that define.
   */
  decks: SkyDeck[];
}

/**
 * One parallax cloud plane. The deck table is the game's, because the
 * altitudes and drift rates are what say whether the weather is a
 * Mediterranean afternoon or a storm front.
 */
export interface SkyDeck {
  /** metres above the camera plane */
  height: number;
  /** world-space frequency of the noise lookup */
  scale: number;
  /** drift velocity in the noise's own UV, per second */
  drift: [number, number];
  /** density threshold — lower is more sky, higher is more cloud */
  cover: number;
  /** optical thickness multiplier */
  thick: number;
  /** final alpha multiplier for this plane */
  alphaMul: number;
}

// --- model constants ---------------------------------------------------------

const PLANET_R = 6360e3;
const ATMO_R = 6420e3;
const H_RAYLEIGH = 8000;
const H_MIE = 1200;
/** Rayleigh scattering at sea level, per metre, for R/G/B. */
const BETA_R = [5.8e-6, 13.5e-6, 33.1e-6];
/** Mie scattering at sea level, scaled by the turbidity we want. */
const BETA_M = 21e-6 * 0.5;
/** Mie extinction is a little above its scattering — aerosols absorb. */
const MIE_EXTINCTION = 1.1;
/** Cornette-Shanks asymmetry. 0.76 is the usual hazy-day value. */
const MIE_G = 0.76;
/**
 * Isotropic floor added to the Mie phase. Single scattering puts essentially
 * all the aerosol light into the forward lobe, so the half of the sky away from
 * the sun loses its haze entirely and comes back as a clean Rayleigh cyan — the
 * "it looks like noon over there" failure. Real multiple-scattered aerosol
 * light is close to isotropic, and adding it back is what turns the
 * away-from-sun sky blue-VIOLET instead of blue. The calibration re-solves
 * against this, so the art direction's zenith and horizon hexes still land
 * exactly.
 */
const MIE_ISOTROPIC = 0.12;
/**
 * Rayleigh backscatter suppression. rayleighPhase peaks equally forward and
 * backward, so with a single horizon gain fitted at 90° to the sun the ANTI-solar
 * horizon came out ~1.9x brighter than the fit direction — a superwhite band
 * wrapped the entire compass and every frame read as the same washed-out haze
 * regardless of where the camera pointed. In the real thing that light has
 * grazed the whole atmosphere and is extinguished; single scattering cannot see
 * that. The falloff is keyed to gamma < -0.05 so the fit directions (gamma ~ 0
 * at the horizon probe, +0.245 at the zenith) are untouched and the calibration
 * is exactly preserved.
 */
const RAYLEIGH_BACKSCATTER = 0.40;
/** Arbitrary radiometric scale; the calibration layer removes the ambiguity. */
const SUN_ENERGY = 22;
/** Aerosols here are warm — this is what gives the disc its golden collar. */
const MIE_TINT = [1.0, 0.78, 0.52];
/**
 * Elevation (dir.y) at which the horizon gain has fully handed over to zenith.
 * 0.42 rather than 0.35: the warm band has to survive up to ~25° or the sky
 * jumps from a white horizon straight into saturated blue with no golden middle,
 * which is the other half of the "different time of day in every frame" note.
 */
const GAIN_BLEND_END = 0.42;
const GAIN_BLEND_POW = 0.95;
/**
 * How the dome hands over to the aerial-perspective haze at the horizon line.
 *
 * THIS IS THE HORIZON SEAM, and it was a construction error rather than a
 * tuning one. Aerial perspective drives every distant surface toward
 * `krFogHaze`, which is the low-sky radiance WITH the highlight rolloff applied.
 * The dome was drawn from the raw radiance and only pulled 34% of the way toward
 * that same haze. Straight down-sun the raw value is (6.94, 3.10, 1.79) and the
 * haze is (1.15, 0.51, 0.30), so the last pixel of sky above the waterline came
 * out FOUR TIMES brighter than the first pixel of fully-hazed sea below it —
 * a hard, dead-straight, horizon-wide step. No amount of fog tuning can close
 * it, because the two sides were converging on different numbers by design.
 *
 * The sky and the fog now converge on exactly the same value in exactly the same
 * azimuth: the weld reaches 1.0 at mu = 0. The band is deliberately narrow
 * (3.2°) so it reads as the real thing — the compressed haze layer you always
 * see stacked on a sea horizon — rather than as a wash up the dome.
 */
const HORIZON_WELD_BAND = 0.055;

/**
 * The shoulder applied to the low sky before it becomes the aerial-perspective
 * asymptote. Retuned upward from 0.55/1.15 now that it no longer destroys hue.
 *
 * The old ceiling of 1.15 was doing two jobs at once and doing the second one
 * badly: it kept the fog target under the ACES knee (right) and, as a side
 * effect of being per-channel, it flattened the entire compass onto one
 * near-neutral cream (wrong — see `compressHighlights`). With the chromaticity
 * preserved, a ceiling that low crushes the haze a stop and a half below the
 * sky it is supposed to be welded to. At 0.90/1.95 the fitted haze lands on
 * #f1e3d9 down-sun, #fbc191 at 90° and #f8bf90 behind — within a few percent of
 * the art direction's #ffd0a0 where the art direction measures it, with 1.8:1
 * of luminance spread around the compass, and still low enough that a headland
 * standing in front of it keeps a slice of display range to be a silhouette in.
 */
const HAZE_KNEE = 0.90;
const HAZE_CEILING = 1.95;
const HAZE_DESAT = 0.45;
/** Eye height used for the integrals. Sea level plus a bit of cliff. */
const VIEW_ALTITUDE = 300;

const I_STEPS = 20;
const J_STEPS = 8;

/** LUT dimensions. Both axes hold smooth functions, so this is plenty. */
export const LUT_WIDTH = 128;
export const LUT_HEIGHT = 64;

/**
 * Basis for the azimuthal fit of the horizon haze, evaluated at `c` = the cosine
 * of the angle between the view azimuth and the sun's.
 *
 * Deliberately NOT a polynomial. The function being fitted is the low-elevation
 * radiance: nearly flat across the whole anti-solar half of the compass and then
 * rising hard over the last 40° into the sun. Monomials fit that with visible
 * ringing (0.09 absolute in blue, which is 40% of blue's value out on the flat
 * part, and it alternates sign — exactly the wobble that would show up as bands
 * of hue in the haze). Two Cornette-Shanks lobes plus a linear base fits the
 * same data an order of magnitude better, because the sun-ward shoulder IS a
 * Mie phase function; this is the physics written down rather than approximated.
 */
const HAZE_LOBE_G = [0.55, 0.82];
export const HAZE_TERMS = 2 + HAZE_LOBE_G.length;

/** Normalised Cornette-Shanks lobe. GLSL twin lives in `hazeGlsl`. */
function hazeLobe(c: number, g: number): number {
  const g2 = g * g;
  const d = Math.max(1 + g2 - 2 * g * c, 1e-4);
  return (1 - g2) / ((2 + g2) * d * Math.sqrt(d));
}

/** Fill `out` with the fit basis at `c`. Must match the GLSL exactly. */
function hazeBasis(c: number, out: number[]): void {
  out[0] = 1;
  out[1] = c;
  for (let k = 0; k < HAZE_LOBE_G.length; k++) out[2 + k] = hazeLobe(c, HAZE_LOBE_G[k]!);
}
/** Elevation the haze is probed at: the first sliver of sky above the horizon,
 *  which is what a fragment at aerial-perspective infinity actually converges
 *  on. Not exactly 0 — the model's ground blend starts biting below it. */
const HAZE_MU = 0.012;

const CLOUD_NOISE_SIZE = 256;
/** Cycles-per-tile baked into R,G,B,A of the cloud noise. */
const CLOUD_NOISE_OCTAVES = [2, 4, 8, 16];

// --- scratch -----------------------------------------------------------------

const _integralR = new Float64Array(3);
const _rayScratch = new Float64Array(3);
const _mieScratch = new Float64Array(3);
const _dir = new THREE.Vector3();
const _shBasis: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const _hazeBasis: number[] = [0, 0, 0, 0];
const _weldScratch = new THREE.Vector3();
const UP_AXIS = new THREE.Vector3(0, 1, 0);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * ACES FORWARD AND INVERTED, AND THE LEAST-SQUARES SOLVER, LIVE IN
 * ./colour.ts.
 *
 * The floors `inverseAces` searches down to are ARGUMENTS with no default,
 * stated at the call site beside the exposure they are solved against: a
 * default would silently re-tune whichever game did not get it, and the
 * symptom would be a sky subtly wrong in a build nobody changed. They arrive
 * on `SkyArt`; see `calibrate()`.
 */
import { hexToLinear, inverseAces, solveMulti } from './colour.ts';

// --- phase functions ---------------------------------------------------------

function smoothstep01(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Must stay bit-for-bit equivalent to the GLSL twin in SKY_FRAGMENT_SHADER. */
function rayleighPhase(c: number): number {
  const back = RAYLEIGH_BACKSCATTER
    + (1 - RAYLEIGH_BACKSCATTER) * smoothstep01(-0.95, -0.05, c);
  return 0.0596831 * (1 + c * c) * back;
}

function miePhase(c: number, g: number): number {
  const g2 = g * g;
  const d = Math.max(1 + g2 - 2 * g * c, 1e-4);
  return 0.1193662 * ((1 - g2) * (1 + c * c)) / ((2 + g2) * d * Math.sqrt(d));
}

/**
 * The atmosphere, evaluated on the CPU and baked for the GPU.
 *
 * Owns the calibration gains, so the fog colour, the ambient SH and the sky
 * shader are all guaranteed to agree — a fog colour that does not match the
 * sky at the horizon is the single most common way this look falls apart.
 */
export class NishitaSky {
  /** The art this sky was built from. Held so the shader emitters can read it. */
  readonly art: SkyArt;
  readonly sun: THREE.Vector3;
  readonly exposure: number;

  /** Rayleigh gains, solved against the art direction's hexes. */
  readonly gainZenith = new THREE.Vector3();
  readonly gainHorizon = new THREE.Vector3();
  /** Linear radiance of the horizon; drives fog and the sky/fog weld. */
  readonly horizonColor = new THREE.Vector3();
  /** Linear radiance below the horizon — sea and sand haze, feeds the env map. */
  readonly groundColor = new THREE.Vector3();
  /** Linear radiance of the zenith. */
  readonly zenithColor = new THREE.Vector3();
  /** Radiance of the sun disc, already reddened by its own path through the air. */
  readonly sunDiscColor = new THREE.Vector3();
  /** Sunlight arriving at cloud altitude — less reddened than the disc. */
  readonly cloudSunColor = new THREE.Vector3();
  /** Skylight filling the shaded side of a cloud. */
  readonly cloudAmbientColor = new THREE.Vector3();

  /**
   * The colour distance fog and the low sky converge on: the horizon radiance
   * with the highlight rolloff applied, so it agrees with the dome in hue but
   * lands under the ACES knee in value. Distinct from `horizonColor`, which is
   * deliberately superwhite and must stay that way for the dome to hit the
   * art direction's #ffd0a0.
   */
  readonly hazeColor = new THREE.Vector3();

  /** Horizontal unit vector toward the sun, in world XZ. */
  readonly sunAzimuth = new THREE.Vector2();
  /**
   * The haze as a function of *view azimuth* rather than a single constant:
   * polynomial coefficients (ascending powers) in
   * `c = dot( normalize( viewDir.xz ), sunAzimuth )`, one Vector3 per term.
   *
   * This is the fix for the flat white sea. Aerial perspective converges on the
   * sky's own radiance at the horizon, and at 14° elevation that radiance swings
   * from a hot #ffc98a straight down-sun to a cool dusty violet at the anti-solar
   * azimuth — a factor of ~3 in the red channel. Feeding ONE colour to the fog,
   * as this did, guarantees that in most camera directions the sea meets the sky
   * at a hard value/hue step, because the sky is drawn from the real model and
   * the water is drawn from the average. Sampled per view direction the two
   * converge by construction and the horizon seam has nothing left to be.
   *
   * Fitted, not tabulated, so the same five constants can be baked as literals
   * into the fog ShaderChunk — which has no way to receive a uniform.
   */
  readonly hazePoly: THREE.Vector3[] = [];

  /**
   * How bright the disc core is, and how big. Both are the game's — the second
   * one especially: a disc at life size is 0.0047 rad and reads as a pinhole,
   * and how far past that a game goes is a statement about how cartoon it is.
   */
  readonly sunDiscIntensity: number;
  readonly sunAngularRadius: number;

  private readonly mieTint = new THREE.Vector3(MIE_TINT[0], MIE_TINT[1], MIE_TINT[2]);
  /** Horizon direction used as the calibration probe: 90° in azimuth from the sun. */
  private readonly fitDir = new THREE.Vector3();

  constructor(art: SkyArt) {
    this.art = art;
    this.sun = art.sun.clone().normalize();
    this.exposure = art.exposure;
    this.sunDiscIntensity = art.sunDiscIntensity;
    this.sunAngularRadius = art.sunAngularRadius;

    const sh = new THREE.Vector3(this.sun.x, 0, this.sun.z).normalize();
    this.fitDir.set(-sh.z, 0.02, sh.x).normalize();

    this.calibrate();
  }

  // -- integration ------------------------------------------------------------

  /**
   * Accumulate the Rayleigh (per channel) and Mie (grey) scattering integrals
   * along `dir`. Phase functions are deliberately NOT applied here: keeping
   * them out is what lets the GPU bake this into a smooth, filterable LUT.
   * Returns the Mie integral; the Rayleigh integral lands in `outR`.
   */
  private integrate(dx: number, dy: number, dz: number, outR: Float64Array): number {
    outR[0] = 0; outR[1] = 0; outR[2] = 0;
    const oy = PLANET_R + VIEW_ALTITUDE;

    // ray/atmosphere, with the camera inside the shell so there is always a hit
    const bA = 2 * oy * dy;
    const cA = oy * oy - ATMO_R * ATMO_R;
    const discA = bA * bA - 4 * cA;
    if (discA <= 0) return 0;
    let t1 = (-bA + Math.sqrt(discA)) * 0.5;

    // clip against the planet so downward rays terminate at the surface
    const cP = oy * oy - PLANET_R * PLANET_R;
    const discP = bA * bA - 4 * cP;
    if (discP > 0) {
      const tp = (-bA - Math.sqrt(discP)) * 0.5;
      if (tp > 0) t1 = Math.min(t1, tp);
    }

    const step = t1 / I_STEPS;
    let odR = 0;
    let odM = 0;
    let mie = 0;
    let t = step * 0.5;

    for (let i = 0; i < I_STEPS; i++) {
      const px = dx * t, py = oy + dy * t, pz = dz * t;
      const h = Math.sqrt(px * px + py * py + pz * pz) - PLANET_R;
      const hr = Math.exp(-h / H_RAYLEIGH) * step;
      const hm = Math.exp(-h / H_MIE) * step;
      odR += hr;
      odM += hm;

      // secondary ray toward the sun
      const sx = this.sun.x, sy = this.sun.y, sz = this.sun.z;
      const bL = 2 * (px * sx + py * sy + pz * sz);
      const cL = px * px + py * py + pz * pz - ATMO_R * ATMO_R;
      const tL = (-bL + Math.sqrt(Math.max(bL * bL - 4 * cL, 0))) * 0.5;
      const lStep = tL / J_STEPS;
      let lodR = 0;
      let lodM = 0;
      let lit = true;
      let lt = lStep * 0.5;
      for (let j = 0; j < J_STEPS; j++) {
        const qx = px + sx * lt, qy = py + sy * lt, qz = pz + sz * lt;
        const lh = Math.sqrt(qx * qx + qy * qy + qz * qz) - PLANET_R;
        if (lh < 0) { lit = false; break; }
        lodR += Math.exp(-lh / H_RAYLEIGH) * lStep;
        lodM += Math.exp(-lh / H_MIE) * lStep;
        lt += lStep;
      }

      if (lit) {
        const tauM = BETA_M * MIE_EXTINCTION * (odM + lodM);
        for (let c = 0; c < 3; c++) {
          outR[c]! += hr * Math.exp(-(BETA_R[c]! * (odR + lodR) + tauM));
        }
        mie += hm * Math.exp(-(BETA_R[1]! * (odR + lodR) + tauM));
      }
      t += step;
    }
    return mie;
  }

  /** Split radiance into its Rayleigh and Mie parts, both pre-gain. */
  private parts(dx: number, dy: number, dz: number, ray: Float64Array, mieOut: Float64Array): void {
    const mie = this.integrate(dx, dy, dz, _integralR);
    const gamma = dx * this.sun.x + dy * this.sun.y + dz * this.sun.z;
    const pr = rayleighPhase(gamma);
    const pm = miePhase(gamma, MIE_G);
    for (let c = 0; c < 3; c++) {
      ray[c] = SUN_ENERGY * BETA_R[c]! * _integralR[c]! * pr;
      mieOut[c] = SUN_ENERGY * BETA_M * mie * (pm + MIE_ISOTROPIC) * MIE_TINT[c]!;
    }
  }

  /**
   * Roll the top end of a linear radiance off toward `ceiling`. The sky's own
   * horizon is bright (the art direction's #ffd0a0 has R = 255, so the linear
   * value that tone maps to it sits above display white), and that is fine for
   * the DOME — but anything that uses it as an asymptote for geometry, i.e.
   * fog, drives every distant surface past the ACES knee where all form
   * disappears. Compressed, the same hue lands just under the knee: distant
   * land still reads as a silhouette against the sky instead of dissolving into
   * it.
   *
   * THE COMPRESSION IS APPLIED TO THE BRIGHTEST CHANNEL AND THE OTHER TWO ARE
   * SCALED WITH IT. This is the fix for the dead white sea.
   *
   * Per-channel compression — what this used to do — is a hue destroyer, and at
   * golden hour it is a catastrophic one. Straight down-sun the model's own
   * low-sky radiance is (6.94, 3.10, 1.79): a saturated orange with a 3.9:1
   * red:blue ratio. Compress each channel independently against a ceiling of
   * 1.15 and every channel above ~2 lands within a percent of the ceiling, so
   * that orange came out (1.150, 1.141, 1.074) — a 1.07:1 ratio, i.e. NEUTRAL
   * WHITE. The fog colour, the sky's horizon weld and the cloud aerial term all
   * converge on this value, which is why the bay was a featureless white sheet
   * and why the whole compass hazed to the same cream regardless of where the
   * camera pointed: the azimuthal variation the haze fit works so hard to
   * preserve was being flattened by the very last operation applied to it.
   *
   * Gated on max(rgb) the same orange lands at (1.150, 0.514, 0.297): the same
   * chromaticity, the same 3.9:1 ratio, under the knee. Sea and sky now converge
   * on a warm value down-sun and a duller one away from it, which is what makes
   * the bay read as water at golden hour instead of as paper.
   */
  static compressHighlights(
    v: THREE.Vector3, out: THREE.Vector3,
    knee = HAZE_KNEE, ceiling = HAZE_CEILING, desatMax = HAZE_DESAT,
  ): THREE.Vector3 {
    const m = Math.max(v.x, v.y, v.z);
    if (m <= knee) return out.copy(v);
    const span = ceiling - knee;
    const s = (knee + span * (1 - Math.exp(-(m - knee) / span))) / m;
    out.set(v.x * s, v.y * s, v.z * s);
    // ...then the SAME desaturation ACES itself would have applied on the way to
    // display, so preserving chromaticity in linear does not come back as an
    // over-saturated result on screen. Looking straight into the sun the haze is
    // pale and warm; at 90° it is amber; behind, dusty. That spread — 1.8:1 in
    // luminance and a full hue swing — is the thing a single fog colour cannot
    // have, and it is what makes the bay read as a place rather than a backdrop.
    let t = Math.min(Math.max((m - knee) / (knee * 12 - knee), 0), 1);
    t = t * t * (3 - 2 * t) * desatMax;
    if (t <= 0) return out;
    const lum = 0.2126 * out.x + 0.7152 * out.y + 0.0722 * out.z;
    return out.set(
      out.x + (lum - out.x) * t,
      out.y + (lum - out.y) * t,
      out.z + (lum - out.z) * t,
    );
  }

  // -- calibration ------------------------------------------------------------

  private calibrate(): void {
    const target = new Float64Array(3);
    const solved = new Float64Array(3);

    // zenith
    hexToLinear(this.art.zenithTarget, target);
    inverseAces(target, this.exposure, solved, this.art.acesFloor, this.art.acesProbeFloor);
    this.parts(0, 1, 0, _rayScratch, _mieScratch);
    this.gainZenith.set(
      Math.max((solved[0]! - _mieScratch[0]!) / _rayScratch[0]!, 0),
      Math.max((solved[1]! - _mieScratch[1]!) / _rayScratch[1]!, 0),
      Math.max((solved[2]! - _mieScratch[2]!) / _rayScratch[2]!, 0),
    );
    this.zenithColor.set(solved[0]!, solved[1]!, solved[2]);

    // horizon, probed 90° in azimuth from the sun so the fit is not dominated
    // by the blown-out sun-facing side
    hexToLinear(this.art.horizonTarget, target);
    inverseAces(target, this.exposure, solved, this.art.acesFloor, this.art.acesProbeFloor);
    this.parts(this.fitDir.x, this.fitDir.y, this.fitDir.z, _rayScratch, _mieScratch);
    this.gainHorizon.set(
      Math.max((solved[0]! - _mieScratch[0]!) / _rayScratch[0]!, 0),
      Math.max((solved[1]! - _mieScratch[1]!) / _rayScratch[1]!, 0),
      Math.max((solved[2]! - _mieScratch[2]!) / _rayScratch[2]!, 0),
    );

    // The fit direction now evaluates (by construction) to the art direction's
    // horizon. Fog inherits it verbatim so the two can never drift apart.
    this.radiance(this.fitDir, this.horizonColor, false);

    // Below the horizon: warm sea and sand haze. Only the env map and the last
    // couple of degrees of the dome ever see this, but a black lower hemisphere
    // would strip every PBR material of its bounce.
    //
    // THIS IS THE SECOND REASON PBR IN THIS GAME READ FLAT, and unlike the
    // direct rig it is invisible in any still of the sky itself.
    //
    // An environment map only sculpts if its luminance actually varies with
    // direction: a metal reflects the sphere, so a sphere that is the same
    // brightness everywhere reflects as a flat swatch no matter how good the
    // material is, and the same map convolved to irradiance gives every normal
    // the same fill. Measured over 2048 uniform directions on an earlier sky:
    //
    //   mean radiance above +0.2 elevation   0.311
    //   mean radiance below -0.05 elevation  0.314      <- 1.01 : 1
    //
    // i.e. the lower hemisphere was AS BRIGHT AS THE SKY. Chrome had no horizon
    // line to catch, clearcoat had no dark half to roll its Fresnel against,
    // and the diffuse IBL arrived as pure DC with no vertical gradient at all —
    // an upward-facing normal and a downward-facing one got the same skylight.
    // Every "no rim, no readable key direction on the vehicles" note lands
    // here.
    //
    // The old coefficients say why: 0.30 of a superwhite horizon is already a
    // bright plate, and the additive offsets on top of it were (0.014, 0.080,
    // 0.097) — i.e. weighted toward BLUE, which is the one thing golden-hour
    // ground is not. That was a second sky pasted under the world.
    //
    // Now: 0.15 of the horizon (a plausible albedo for water, sand and rock
    // taken together) plus a small WARM pedestal, so the lower hemisphere reads
    // as sunlit ground seen through haze. Upper:lower goes to about 1.9:1, which
    // is a horizon line a mirror can find, a vertical gradient the SH can carry,
    // and a genuine warm-below / cool-above axis in the irradiance itself.
    const albedo = this.art.groundAlbedo;
    const ped = this.art.groundPedestal;
    this.groundColor.set(
      this.horizonColor.x * albedo + ped[0],
      this.horizonColor.y * albedo + ped[1],
      this.horizonColor.z * albedo + ped[2],
    );

    // Sun disc: transmittance along its own path, normalised then driven hot.
    const trans = this.sunTransmittance();
    const peak = Math.max(trans.x, trans.y, trans.z);
    this.sunDiscColor.copy(trans).multiplyScalar(this.sunDiscIntensity / peak);

    // Cloud lighting. Clouds sit above most of the haze so they see a cleaner,
    // slightly less reddened sun than the disc we draw at the horizon line.
    //
    // 1.7, not 3.4: at 3.4 the lit face landed at linear ~2.2 and ACES returned
    // (244,238,232) — a NEUTRAL WHITE cumulus, which is the single loudest
    // "this is midday" signal a sky can send. Halved, the same cloud sits at
    // ~1.28 linear and tone maps to (236,221,207): still the brightest thing in
    // frame after the disc, but unmistakably warm. The thin backlit rims still
    // clip, because the forward Mie lobe multiplies this by up to 2.2.
    const warm = new THREE.Color(this.art.warmLight);
    this.cloudSunColor.set(warm.r, warm.g, warm.b).multiplyScalar(this.art.cloudSunGain);
    // SHADED CLOUD, and this is the fix for the grey-brown smear that sat
    // behind the subject in the first version's closeup and grid frames.
    //
    // It was `zenith * 0.40 + horizon * 0.20`, i.e. a saturated BLUE plus a
    // saturated ORANGE. Superposing the two ends of the compass is exactly the
    // one operation the sky itself never performs, and the result is not "dusty
    // rose" — it is (0.460, 0.160, 0.235), a magenta with a collapsed green
    // channel, at a luminance of 0.23 against a sky sitting at 0.33. Every
    // thick cloud core in the game was therefore DARKER and MUDDIER than the
    // sky behind it and tinted a hue no light source in the scene emits. On
    // screen that is a dirty-lens smudge, not a cumulus.
    //
    // A cloud base is a shadowed surface, so the lighting rules say what lights
    // it: the cool sky fill, and only that. Taking the zenith radiance alone
    // keeps a clean blue chromaticity that cannot cancel to grey, and 1.55x
    // puts the shaded side just ABOVE the surrounding sky in luminance rather
    // than below it, so the mass reads as a lit object instead of a hole. All
    // the warmth now arrives through the sun term, where it can only ever land
    // on the parts of the cloud the sun actually reaches — which is what gives
    // a cumulus its warm top and rim and its cool base.
    //
    // Half-desaturated on the way through: the raw zenith is a 0.11 red:blue,
    // which on a cloud face reads as a painted blue object rather than as white
    // water lit by a blue sky. Pivoting on its own luminance keeps the level
    // exactly where it was set. Measured, thick core 90° off the sun, after
    // tone mapping: sRGB (169,176,209) — blue-grey, no green notch, and
    // brighter than the zenith it sits in front of. Its sun-facing flank comes
    // out (227,220,222) and its down-sun rim clips at (249,245,240), so one
    // cloud now spans a red:blue of 0.72 to 2.2. The old smudge measured
    // (161,145,171) at every point on the same cloud.
    {
      const z = this.zenithColor;
      const y = 0.2126 * z.x + 0.7152 * z.y + 0.0722 * z.z;
      const d = this.art.cloudAmbientDesat;
      const g = this.art.cloudAmbientGain;
      this.cloudAmbientColor.set(
        (z.x + (y - z.x) * d) * g,
        (z.y + (y - z.y) * d) * g,
        (z.z + (y - z.z) * d) * g,
      );
    }

    // Aerial perspective, from the same calibrated horizon the dome uses.
    NishitaSky.compressHighlights(this.horizonColor, this.hazeColor);
    this.fitHaze();
  }

  /**
   * Fit `hazePoly` by least squares against the model's own low-elevation
   * radiance, sampled uniformly in azimuth from the sun round to the anti-sun.
   * Rolled off first, for exactly the reason `hazeColor` is: an asymptote above
   * display white drags every distant surface over the ACES knee.
   *
   * `weld = false` on the probe, or this would be fitting itself.
   */
  private fitHaze(): void {
    const sh = new THREE.Vector3(this.sun.x, 0, this.sun.z).normalize();
    this.sunAzimuth.set(sh.x, sh.z);

    const N = 65;
    const horiz = Math.sqrt(1 - HAZE_MU * HAZE_MU);
    const dir = new THREE.Vector3();
    const rad = new THREE.Vector3();
    const rolled = new THREE.Vector3();

    const n = HAZE_TERMS;
    const M = new Array<number>(n * n).fill(0);
    const rhs: number[][] = [
      new Array<number>(n).fill(0), new Array<number>(n).fill(0), new Array<number>(n).fill(0),
    ];
    const basis = new Array<number>(n).fill(0);
    const sample: number[] = [0, 0, 0];

    for (let i = 0; i < N; i++) {
      const a = (Math.PI * i) / (N - 1);          // 0 = looking straight down-sun
      const ca = Math.cos(a), sa = Math.sin(a);
      dir.set((sh.x * ca - sh.z * sa) * horiz, HAZE_MU, (sh.z * ca + sh.x * sa) * horiz);
      this.radiance(dir, rad, false);
      NishitaSky.compressHighlights(rad, rolled);
      sample[0] = rolled.x; sample[1] = rolled.y; sample[2] = rolled.z;

      hazeBasis(ca, basis);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) M[r * n + c]! += basis[r]! * basis[c]!;
        for (let ch = 0; ch < 3; ch++) rhs[ch]![r]! += basis[r]! * sample[ch]!;
      }
    }

    const sol = solveMulti(M, rhs, n);
    this.hazePoly.length = 0;
    for (let k = 0; k < n; k++) {
      this.hazePoly.push(new THREE.Vector3(sol[0]![k], sol[1]![k], sol[2]![k]));
    }
  }

  /**
   * The fitted haze in a horizontal direction. `c` is the cosine of the angle
   * between that direction's azimuth and the sun's; +1 is straight down-sun.
   * The GLSL twin lives in `hazeGlsl` below and must stay identical.
   */
  hazeAt(c: number, out: THREE.Vector3): THREE.Vector3 {
    const t = Math.min(Math.max(c, -1), 1);
    hazeBasis(t, _hazeBasis);
    out.set(0, 0, 0);
    for (let k = 0; k < this.hazePoly.length; k++) {
      out.addScaledVector(this.hazePoly[k]!, _hazeBasis[k]!);
    }
    out.set(Math.max(out.x, 0.008), Math.max(out.y, 0.008), Math.max(out.z, 0.008));
    return out;
  }

  /** Transmittance of the whole atmosphere along the sun ray. */
  private sunTransmittance(): THREE.Vector3 {
    const s = this.sun;
    const oy = PLANET_R + VIEW_ALTITUDE;
    const b = 2 * oy * s.y;
    const c = oy * oy - ATMO_R * ATMO_R;
    const t1 = (-b + Math.sqrt(b * b - 4 * c)) * 0.5;
    const step = t1 / 32;
    let odR = 0;
    let odM = 0;
    let t = step * 0.5;
    for (let i = 0; i < 32; i++) {
      const px = s.x * t, py = oy + s.y * t, pz = s.z * t;
      const h = Math.sqrt(px * px + py * py + pz * pz) - PLANET_R;
      odR += Math.exp(-h / H_RAYLEIGH) * step;
      odM += Math.exp(-h / H_MIE) * step;
      t += step;
    }
    const tm = BETA_M * MIE_EXTINCTION * odM;
    return new THREE.Vector3(
      Math.exp(-(BETA_R[0]! * odR + tm)),
      Math.exp(-(BETA_R[1]! * odR + tm)),
      Math.exp(-(BETA_R[2]! * odR + tm)),
    );
  }

  // -- evaluation -------------------------------------------------------------

  /**
   * Calibrated sky radiance for `dir`, matching the fragment shader term for
   * term (minus the disc and the clouds). Used for fog, ambient SH and any
   * system that wants to know what colour the sky is in a direction.
   */
  radiance(dir: THREE.Vector3, out: THREE.Vector3, weld = true): THREE.Vector3 {
    this.parts(dir.x, dir.y, dir.z, _rayScratch, _mieScratch);
    const mu = dir.y;
    let k = (mu - 0) / GAIN_BLEND_END;
    k = Math.min(Math.max(k, 0), 1);
    k = Math.pow(k * k * (3 - 2 * k), GAIN_BLEND_POW);
    out.set(
      _rayScratch[0]! * (this.gainHorizon.x + (this.gainZenith.x - this.gainHorizon.x) * k) + _mieScratch[0]!,
      _rayScratch[1]! * (this.gainHorizon.y + (this.gainZenith.y - this.gainHorizon.y) * k) + _mieScratch[1]!,
      _rayScratch[2]! * (this.gainHorizon.z + (this.gainZenith.z - this.gainHorizon.z) * k) + _mieScratch[2]!,
    );
    if (mu < 0) {
      let g = Math.min(Math.max(-mu / 0.16, 0), 1);
      g = g * g * (3 - 2 * g);
      out.lerp(this.groundColor, g);
    }
    if (weld) {
      // Twin of the weld in the fragment shader; see HORIZON_WELD_BAND. Note it
      // welds to the haze in THIS direction's azimuth, not to the single
      // averaged `hazeColor` — the shader has always done the former and the CPU
      // side quietly did the latter, which put the SH probe and the sky on two
      // different horizons.
      const l = Math.hypot(dir.x, dir.z);
      const c = l > 1e-5
        ? Math.min(Math.max((dir.x * this.sunAzimuth.x + dir.z * this.sunAzimuth.y) / l, -1), 1)
        : 0;
      let w = Math.min(Math.max(Math.abs(mu) / HORIZON_WELD_BAND, 0), 1);
      w = 1 - w * w * (3 - 2 * w);
      out.lerp(this.hazeAt(c, _weldScratch), w);
    }
    return out;
  }

  // -- baking -----------------------------------------------------------------

  /**
   * Bake the scattering integrals into an RGBA half-float LUT.
   * u = sqrt(view elevation)  — packs texels toward the horizon where the
   *     gradient is steepest.
   * v = (angle-to-sun cosine remapped to 0..1).
   * RGB hold the Rayleigh integral, A the Mie integral. Phases stay on the GPU.
   */
  bakeScatteringLUT(): THREE.DataTexture {
    const w = LUT_WIDTH, h = LUT_HEIGHT;
    const data = new Uint16Array(w * h * 4);
    const sy = this.sun.y;
    const shLen = Math.sqrt(Math.max(1 - sy * sy, 1e-6));
    // horizontal basis: e points along the sun's azimuth, f is perpendicular
    const ex = this.sun.x / shLen, ez = this.sun.z / shLen;
    const fx = -ez, fz = ex;

    for (let y = 0; y < h; y++) {
      const gamma = ((y + 0.5) / h) * 2 - 1;
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w;
        const mu = u * u;
        const sinMu = Math.sqrt(Math.max(1 - mu * mu, 0));
        // gamma = mu*sun.y + p*|sun_horizontal|  =>  solve for p, clamp to the
        // physically reachable range so the out-of-gamut corners hold their
        // nearest valid neighbour instead of garbage.
        let p = (gamma - mu * sy) / shLen;
        p = Math.min(Math.max(p, -sinMu), sinMu);
        const q = Math.sqrt(Math.max(sinMu * sinMu - p * p, 0));
        const dx = ex * p + fx * q;
        const dz = ez * p + fz * q;

        const mie = this.integrate(dx, mu, dz, _integralR);
        const i = (y * w + x) * 4;
        data[i] = THREE.DataUtils.toHalfFloat(SUN_ENERGY * BETA_R[0]! * _integralR[0]!);
        data[i + 1] = THREE.DataUtils.toHalfFloat(SUN_ENERGY * BETA_R[1]! * _integralR[1]!);
        data[i + 2] = THREE.DataUtils.toHalfFloat(SUN_ENERGY * BETA_R[2]! * _integralR[2]!);
        data[i + 3] = THREE.DataUtils.toHalfFloat(SUN_ENERGY * BETA_M * mie);
      }
    }

    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Tileable 4-octave noise, one octave per channel. Sampling it once gives a
   * complete FBM; sampling it twice at incommensurate scales gives eight
   * octaves for two fetches, which is what keeps the clouds cheap.
   * Tileability comes from evaluating 4D simplex on a torus.
   */
  bakeCloudNoise(): THREE.DataTexture {
    const size = CLOUD_NOISE_SIZE;
    const noise = createNoise4D(mulberry32(this.art.cloudNoiseSeed));
    const data = new Uint8Array(size * size * 4);
    const TAU = Math.PI * 2;
    for (let c = 0; c < 4; c++) {
      const r = CLOUD_NOISE_OCTAVES[c]! / TAU;
      for (let y = 0; y < size; y++) {
        const v = (y / size) * TAU;
        const cv = Math.cos(v) * r, sv = Math.sin(v) * r;
        for (let x = 0; x < size; x++) {
          const u = (x / size) * TAU;
          const n = noise(Math.cos(u) * r, Math.sin(u) * r, cv, sv);
          data[(y * size + x) * 4 + c] = Math.round(Math.min(Math.max(n * 0.5 + 0.5, 0), 1) * 255);
        }
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Project the calibrated sky (including its ground hemisphere) onto SH9.
   * Fibonacci sampling, uniform solid angle, three's own basis and
   * normalisation so the result drops straight into a LightProbe.
   */
  projectSH(samples: number, fillTint: number): THREE.SphericalHarmonics3 {
    const sh = new THREE.SphericalHarmonics3();
    const coeff = sh.coefficients;
    const radiance = new THREE.Vector3();
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < samples; i++) {
      const y = 1 - (2 * i + 1) / samples;
      const r = Math.sqrt(Math.max(1 - y * y, 0));
      const phi = i * golden;
      _dir.set(Math.cos(phi) * r, y, Math.sin(phi) * r);
      this.radiance(_dir, radiance);
      THREE.SphericalHarmonics3.getBasisAt(_dir, _shBasis);
      for (let j = 0; j < 9; j++) {
        const b = _shBasis[j]!;
        coeff[j]!.x += radiance.x * b;
        coeff[j]!.y += radiance.y * b;
        coeff[j]!.z += radiance.z * b;
      }
    }
    const norm = (4 * Math.PI) / samples;
    for (let j = 0; j < 9; j++) coeff[j]!.multiplyScalar(norm);

    if (fillTint > 0) this.tintFill(sh, fillTint);
    return sh;
  }

  /**
   * Pull the probe's chromaticity partway toward the art direction's stated sky
   * fill (#a8c8ff). Single-scattering skylight is bluer than the real thing —
   * multiple scattering desaturates it, and we do not simulate multiple
   * scattering. Luminance is preserved, so this changes the hue of shaded
   * surfaces without touching how bright they are.
   */
  private tintFill(sh: THREE.SphericalHarmonics3, blend: number): void {
    const irr = sh.getIrradianceAt(UP_AXIS, new THREE.Vector3());
    if (irr.x <= 0 || irr.y <= 0 || irr.z <= 0) return;

    const t = new THREE.Color(this.art.fillTint);
    const lumaIrr = 0.2126 * irr.x + 0.7152 * irr.y + 0.0722 * irr.z;
    const lumaT = 0.2126 * t.r + 0.7152 * t.g + 0.0722 * t.b;
    const k = lumaIrr / Math.max(lumaT, 1e-6);

    const gx = 1 + ((t.r * k) / irr.x - 1) * blend;
    const gy = 1 + ((t.g * k) / irr.y - 1) * blend;
    const gz = 1 + ((t.b * k) / irr.z - 1) * blend;
    for (let j = 0; j < 9; j++) {
      sh.coefficients[j]!.x *= gx;
      sh.coefficients[j]!.y *= gy;
      sh.coefficients[j]!.z *= gz;
    }
  }

  /** Uniform block the sky material needs from the model. */
  uniformValues() {
    return {
      gainZenith: this.gainZenith.clone(),
      gainHorizon: this.gainHorizon.clone(),
      mieTint: this.mieTint.clone(),
      mieG: MIE_G,
      mieIso: MIE_ISOTROPIC,
      rayBack: RAYLEIGH_BACKSCATTER,
      gainBlendEnd: GAIN_BLEND_END,
      gainBlendPow: GAIN_BLEND_POW,
    };
  }
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

function gf(x: number): string {
  return Number.isFinite(x) ? x.toFixed(7) : '0.0';
}

/**
 * Emit the GLSL twin of `NishitaSky.hazeAt` with the fitted coefficients
 * baked in as literals.
 *
 * Literals rather than uniforms because the primary consumer is three's
 * `fog_pars_fragment` ShaderChunk, which is shared by every material in the
 * game and has no uniform channel of its own: `UniformsLib.fog` is merged into
 * `ShaderLib` at three's module-init time, so nothing added later reaches a
 * MeshStandardMaterial. The sky dome uses the same generated source so the dome
 * and the fog can never disagree about what colour the horizon is.
 */
export function hazeGlsl(model: NishitaSky, name: string): string {
  const p = model.hazePoly;
  const v = (c: THREE.Vector3) => `vec3( ${gf(c.x)}, ${gf(c.y)}, ${gf(c.z)} )`;
  const terms = [`${v(p[0]!)}`, `${v(p[1]!)} * c`];
  for (let k = 0; k < HAZE_LOBE_G.length; k++) {
    terms.push(`${v(p[2 + k]!)} * ${name}Lobe( c, ${gf(HAZE_LOBE_G[k]!)} )`);
  }
  return /* glsl */`
float ${name}Lobe( float c, float g ) {
	float g2 = g * g;
	float d = max( 1.0 + g2 - 2.0 * g * c, 1e-4 );
	return ( 1.0 - g2 ) / ( ( 2.0 + g2 ) * d * sqrt( d ) );
}

vec3 ${name}( vec2 dirXZ ) {
	float l = length( dirXZ );
	float c = l > 1e-5 ? clamp( dot( dirXZ / l, vec2( ${gf(model.sunAzimuth.x)}, ${gf(model.sunAzimuth.y)} ) ), -1.0, 1.0 ) : 0.0;
	return max( ${terms.join('\n\t\t+ ')}, vec3( 0.008 ) );
}
`;
}

/**
 * The infinite-skybox vertex stage. IT LIVES IN `skyrig.ts` and is
 * re-exported here, not declared.
 *
 * It knows nothing about scattering — it strips the translation out of the
 * model-view and forces z = w — so a vacuum sky was reaching it by importing
 * the Rayleigh/Mie integrator, which is the wrong dependency to hand a game
 * whose art direction forbids air. Re-exported rather than repointed because
 * a game's `Atmosphere.ts` re-exports this name from here and its `Sky.ts`
 * imports it from there; a change that rewrites every call site is a change
 * whose misses cannot be grepped for.
 */
export { SKY_VERTEX_SHADER } from './skyrig.ts';

/**
 * The dome's fragment stage. Built per-model rather than being a constant so it
 * can inline the same baked haze fit the fog chunk uses — the sky and the aerial
 * perspective have to converge on the *same* colour in the *same* direction or
 * the horizon is a seam, and the only way to guarantee that is one source.
 */
export function buildSkyFragmentShader(model: NishitaSky, o: SkyShaderArt): string {
  const decks = o.decks
    .map((d, i) => `#if CLOUD_LAYERS > ${o.decks.length - 1 - i}
  vec4 c${i} = cloudLayer(dir, gamma, ${gf(d.height)}, ${gf(d.scale)}, vec2(${gf(d.drift[0])}, ${gf(d.drift[1])}), ${gf(d.cover)}, ${gf(d.thick)}, ${gf(d.alphaMul)});
  col = mix(col, c${i}.rgb, c${i}.a);
#endif`)
    .join('\n');
  return /* glsl */ `
uniform sampler2D uLut;
uniform sampler2D uNoise;
uniform vec3 uSunDir;
uniform vec2 uSunPlane;      // normalised sun azimuth, for cloud self-shadowing
uniform vec3 uGainZenith;
uniform vec3 uGainHorizon;
uniform vec3 uMieTint;
uniform vec3 uSunDisc;
uniform vec3 uGroundColor;
uniform vec3 uHorizonColor;
uniform vec3 uCloudSun;
uniform vec3 uCloudAmbient;
uniform vec2 uCameraXZ;
uniform float uTime;
uniform float uMieG;
uniform float uMieIso;
uniform float uRayBack;
uniform float uGainBlendEnd;
uniform float uGainBlendPow;
uniform float uSunRadius;
uniform float uCloudAmount;

varying vec3 vDir;

${hazeGlsl(model, o.hazeFn)}

/**
 * The haze in THIS fragment's azimuth. Written once at the top of main() and
 * read by the horizon weld and by every cloud layer, all of which used to
 * converge on a single constant and therefore flattened the whole compass into
 * one cream band.
 */
vec3 gHaze;

// Twin of the CPU rayleighPhase above — the two MUST stay identical or the
// calibrated gains stop meaning anything. uRayBack kills the anti-solar
// backscatter lobe that single scattering wildly overestimates.
float rayleighPhase(float c) {
  float back = mix(uRayBack, 1.0, smoothstep(-0.95, -0.05, c));
  return 0.0596831 * (1.0 + c * c) * back;
}

// Cornette-Shanks. The sharp forward lobe here is the whole reason the phase
// functions are evaluated per pixel instead of being baked into the LUT.
float miePhase(float c, float g) {
  float g2 = g * g;
  float d = max(1.0 + g2 - 2.0 * g * c, 1e-4);
  return 0.1193662 * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * d * sqrt(d));
}

vec3 atmosphere(vec3 dir, float gamma) {
  float mu = dir.y;
  vec2 uv = vec2(sqrt(clamp(mu, 0.0, 1.0)), gamma * 0.5 + 0.5);
  vec4 s = texture2D(uLut, uv);

  float k = pow(smoothstep(0.0, uGainBlendEnd, mu), uGainBlendPow);
  vec3 gain = mix(uGainHorizon, uGainZenith, k);

  vec3 col = s.rgb * rayleighPhase(gamma) * gain
           + s.a * uMieTint * (miePhase(gamma, uMieG) + uMieIso);

  // Below the horizon we are looking into sea and sand haze. This exists so the
  // env map has a lower hemisphere; on screen it is under the terrain.
  col = mix(col, uGroundColor, smoothstep(0.0, 0.16, -mu));

  // THE HORIZON WELD. At mu = 0 this is not a nudge, it is an identity: the sky
  // on the waterline IS gHaze, which is exactly what aerial perspective drives
  // every distant surface toward, in exactly this azimuth. Sea and sky therefore
  // arrive at the same number from both sides and the seam has nothing left to
  // be. At 34% (what this was) the last pixel of sky sat 4x above the first
  // pixel of hazed sea down-sun — see HORIZON_WELD_BAND.
  col = mix(col, gHaze, 1.0 - smoothstep(0.0, ${gf(HORIZON_WELD_BAND)}, abs(mu)));
  return col;
}

// --- clouds ---------------------------------------------------------------
// Three parallax planes rather than a raymarch: at 60 fps with a full game
// underneath, layered planes with real sun-side occlusion buy 90% of the depth
// for 5% of the cost. Each layer is lit from behind by the low sun, so thin
// edges glow warm and thick cores fall back to cool skylight.

// One fetch, four octaves — the noise texture carries 2/4/8/16 cycles per tile
// in R/G/B/A. Weighted hard toward the base octave: the threshold below slices
// this field, and a detail-heavy field slices into speckle rather than mass.
float fbmTex(vec2 p) {
  vec4 a = texture2D(uNoise, p);
  return a.r * 0.60 + a.g * 0.24 + a.b * 0.10 + a.a * 0.06;
}

float cloudField(vec2 p, vec2 w) {
  return fbmTex(p + w) * 0.80 + fbmTex(p * 2.63 + w * 1.9 + vec2(0.31, 0.77)) * 0.20;
}

// Note the deliberate absence of early-outs: every texture fetch here has to be
// reached by the whole quad or the implicit mip derivatives go undefined and
// cloud edges speckle. The layer is masked by multiplying alpha instead.
vec4 cloudLayer(vec3 dir, float gamma, float height, float scale,
                vec2 drift, float cover, float thick, float alphaMul) {
  float fade = smoothstep(0.015, 0.17, dir.y);

  // planar projection: true perspective convergence toward the horizon, and
  // real translational parallax between the layers as the kart moves
  float t = height / max(dir.y, 0.015);
  vec2 p = (uCameraXZ + dir.xz * t) * scale + drift * uTime;

  vec3 w3 = texture2D(uNoise, p * 0.31 + drift * uTime * 0.4).rgb;
  vec2 warp = (w3.xy - 0.5) * 0.22;

  float d = cloudField(p, warp);
  // low-frequency coverage modulation at an incommensurate scale — this is what
  // stops the 256px noise tile from reading as a grid across the sky
  float cov = cover + (w3.z - 0.5) * 0.30;
  // THE DENSITY SLICE. The band was 0.13 wide against a coverage modulation of
  // +/-0.15, which meant most of the sky sat inside the ramp rather than on
  // either side of it: instead of clouds with edges, the dome carried a
  // continuous field of 10–40% alpha with no boundary anywhere. That is the
  // "no defined edge, reads as a render smear" note, and it is a threshold
  // problem, not a shading one. 0.085 gives the mass a rim to be lit on, and
  // the extra bias below removes the marginal wisps entirely rather than
  // rendering them at an alpha too low to read as anything but haze.
  float a = smoothstep(cov + 0.030, cov + 0.115, d);
  // ...and a knee on the alpha itself, so what survives the slice is either
  // clearly a cloud or clearly not one. Costs one multiply.
  a *= a * (3.0 - 2.0 * a);

  // one tap displaced toward the sun approximates the optical depth of the path
  // the sunlight took to reach this pixel. With the sun 14° up that path is
  // mostly horizontal, which is exactly why the rims light and the cores do not.
  float dl = cloudField(p + uSunPlane * 0.13, warp);
  float al = smoothstep(cov + 0.030, cov + 0.115, dl);
  al *= al * (3.0 - 2.0 * al);   // same knee as 'a': the silver lining below
                                 // compares the two and needs them shaped alike
  // 0.10 floor: multiple scattering keeps even a thick core off the floor.
  // Without it the shaded side collapses onto pure skylight and goes violet.
  float trans = 0.10 + 0.90 * exp(-(a * 0.45 + al * 1.30) * thick);

  // The isotropic term carries most of the weight: real clouds multiple-scatter
  // into near-Lambertian white, and a pure single-scattering lobe would leave
  // every cloud with the sun behind the camera looking like a bruise.
  float forward = miePhase(gamma, 0.62) * 1.5;
  vec3 lit = uCloudSun * (trans * (0.55 + forward));

  // THE SILVER LINING. 'trans' alone gives the whole cloud a uniform response
  // to its own thickness and has no idea which SIDE of the mass it is on, so a
  // cumulus lit from 14° came out as a single flat value with a soft falloff —
  // no top, no rim, nothing to say where the light was. (a - al) is exactly
  // that missing information and it costs nothing: it is the gradient of the
  // density field along the sun's own azimuth, already sampled two lines up.
  // Positive means the sunward neighbour is THINNER than we are, i.e. we are on
  // the sun-facing flank with a clear path to the disc, which is where the
  // bright warm edge of a real cloud is. Weighted into the forward lobe so the
  // effect strengthens down-sun, which is where a silver lining actually
  // appears, and gated on the fragment being inside the cloud at all so it
  // cannot draw a halo on empty sky.
  float sunFace = clamp((a - al) * 2.6, 0.0, 1.0) * smoothstep(0.05, 0.30, a);
  lit += uCloudSun * (sunFace * (0.28 + forward * 0.90));

  float powder = 1.0 - exp(-3.0 * a);
  vec3 amb = uCloudAmbient * (0.42 + 0.58 * powder);

  vec3 col = amb + lit;
  // CHROMA FLOOR: "nothing in the world is fully desaturated".
  // The lit and ambient terms now sit at opposite ends of the warm/cool axis by
  // construction, which is the point, but it also means there is a mixing ratio
  // somewhere on every cloud where they cross and cancel toward neutral. A
  // gentle push away from the fragment's own luminance keeps that crossing a
  // HUE TRANSITION rather than a grey band, and it can never darken or brighten
  // the cloud because it pivots on luminance.
  float yc = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(yc), col, 1.18), vec3(0.0));
  // Clouds obey the same aerial perspective as everything else. Toward the
  // rolled-off haze, not the clipping horizon constant: at 0.85 toward a
  // superwhite the whole lower cloud deck turned into one featureless cream
  // smear about 40% up frame, which is what deleted the background layer.
  // Per-azimuth now, so the deck reddens down-sun and cools away from it
  // instead of ending in the same band of cream all the way round.
  col = mix(col, gHaze, (1.0 - fade) * 0.70);
  return vec4(col, a * alphaMul * fade * uCloudAmount);
}

// Triangular-PDF dither. A 4000px-wide smooth gradient quantised to 8 bits
// bands visibly; a sub-LSB of noise removes it for free. Static in screen space
// so it never crawls. The relative term handles the bright end where ACES has
// compressed the signal, the absolute term handles the dark end.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 dir = normalize(vDir);
  float gamma = dot(dir, uSunDir);
  gHaze = ${o.hazeFn}(dir.xz);

  vec3 col = atmosphere(dir, gamma);

  // THE DISC. The art bible's clearest possible statement of where
  // the key is, and the frame's only guaranteed highlight anchor.
  //
  // Two things changed in a later version, both about the EDGE rather than the core.
  //
  //  · Real limb darkening instead of a shaped falloff. The solar disc obeys
  //    I(mu)/I(0) ~ 1 - u(1 - mu) with mu the cosine off the disc normal and
  //    u ~ 0.6 in visible light, so the rim of the sun is genuinely a third the
  //    brightness of its centre. pow(1 - r*r, 0.35) -- what this was -- only
  //    reached 0.70 at r = 0.8 and was then mixed 45% back toward flat, so the
  //    disc was to within a few percent a uniform white sticker — which is
  //    exactly what it read as against the glare it sits in.
  //
  //  · Limb SOFTENING, i.e. the edge is not on the disc. Seen through 30-odd
  //    air masses at 14° elevation the limb is smeared by atmospheric seeing and
  //    aerosol forward scatter over a couple of tenths of a degree, and it bleeds
  //    slightly PAST the geometric radius. The old edge ramp ran 0.80 -> 1.00 of
  //    the radius and terminated exactly at it, i.e. a hard geometric boundary
  //    with a wide interior ramp — backwards on both counts. This runs
  //    0.93 -> 1.09: a tight core with a soft skirt that hands over to the
  //    aureole below instead of stopping dead against the sky.
  float ang = acos(clamp(gamma, -1.0, 1.0));
  float rr = ang / uSunRadius;
  float mu = sqrt(max(1.0 - min(rr, 1.0) * min(rr, 1.0), 0.0));
  float limb = 0.34 + 0.66 * mu;
  float disc = 1.0 - smoothstep(0.93, 1.09, rr);
  col += uSunDisc * disc * limb;
  // THE AUREOLE, i.e. the atmospheric halo proper: the tight, near-white collar
  // of aerosol forward scatter that welds the disc to the sky. Without it the
  // disc has a hard outer boundary against a sky two orders of magnitude dimmer
  // and reads as a decal pasted on the dome — which, with the glare lobes below
  // starting three degrees out, is what it was. Falls to 15% within 2° and to a
  // thousandth by 5°, so it is a halo and not a wash; at the 90° calibration
  // probe it is exp(-86), i.e. exactly zero, and the bible's #ffd0a0 horizon is
  // untouched.
  col += uSunDisc * 0.11 * exp(-ang * 55.0);
  // THE AUREOLE. The art bible asks for "a warm bloom around the sun disc", and
  // keys the whole readability layer off being able to tell where the light
  // is coming from. The two lobes here used to peak at 0.42 and 0.025 linear
  // against a horizon that is itself above 1.0 — i.e. the near-sun sky was
  // within a couple of percent of the sky forty degrees away, the disc was a
  // hard-edged sticker with nothing around it, and with the disc off the top of
  // frame (which at 14° elevation and a chase camera is most of the lap) there
  // was no evidence of the sun in the shot at all. Now: an inner glare lobe
  // 4.5x brighter and half again as wide, and an outer forward-scatter lobe
  // that carries measurable warmth out to ~25°, so the sun's quarter of the sky
  // reads hot even when the disc itself is outside the frustum. Both are
  // tinted by uSunDisc, i.e. by the sun's own reddened transmittance, so this
  // can only ever add the key's colour.
  //
  // A later version widens the OUTER lobe again (0.0055/3.2 -> 0.010/2.4). The review
  // note was "there is no sun disc anywhere and the frame has no highlight
  // anchor", and the literal reading — add a disc — is already satisfied: the
  // disc is drawn eight lines up at 42 linear and clips hard. What is actually
  // true of all ten first reviewed frames is that the camera never points within 60°
  // of the sun, so the only evidence the sun can leave in those frames is the
  // GRADIENT across the sky. At 20° off-axis this lobe now contributes 8% of
  // the horizon radiance instead of 3%, and at 45° it is 3% instead of 0.9%,
  // so the sun's quarter of the dome is measurably hotter from any heading.
  // At the 90° calibration probe it is 0.4%, i.e. below the fit's own
  // residual, so the bible's #ffd0a0 horizon still lands where it landed.
  col += uSunDisc * 0.045 * exp(-ang * 13.0);
  col += uSunDisc * 0.010 * exp(-ang * 2.4);

  // Composited top-down: the high cirrus is furthest away in every direction,
  // the low deck is nearest, and each plane parallaxes against the others.
${decks}

  float n = hash12(gl_FragCoord.xy) + hash12(gl_FragCoord.xy + 17.31) - 1.0;
  col *= 1.0 + n * 0.0050;
  col += n * 0.0020;

  gl_FragColor = vec4(max(col, 0.0), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
}
