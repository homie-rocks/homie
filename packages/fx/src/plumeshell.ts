/**
 * ============================================================================
 *  plumeshell — the shader pair for a rocket exhaust drawn as a LUMINOUS SHELL.
 * ============================================================================
 *
 *  A plume is not a solid cone and it is not a sprite stack. It is a thin
 *  envelope of glowing gas expanding away from a nozzle, and the six terms
 *  below are what make a cone mesh read as one. Every one of them is a
 *  mechanism; not one of them is a number. THE NUMBERS ARE THE CALLER'S — this
 *  file has no defaults and must never grow any, because the difference
 *  between a vacuum plume, a sea-level plume with a shock train and a
 *  manoeuvring thruster is entirely in the values, and a default here is one
 *  game's engine quietly becoming every game's engine.
 *
 *  ── THE SIX TERMS ──────────────────────────────────────────────────────────
 *
 *   1. LIMB BRIGHTENING. The amount of gas along a line of sight is greatest
 *      where the sight line GRAZES the shell, i.e. at the silhouette. Without
 *      it a cone reads as a painted solid, which is the single most common way
 *      a plume looks fake. `uLimbPow` and `uBodyFloor` are uniforms and not
 *      constants because a thin outer shell and a thick inner column are not
 *      the same kind of gas: an optically thin shell wants a hard limb and an
 *      empty interior; an optically thick column seen face-on is BRIGHT.
 *
 *   2. AXIAL DENSITY, AS AN INVERSE SQUARE OF THE LOCAL RADIUS. Gas expanding
 *      freely thins as 1/r², and `exp(-t)` is not that — it is far too flat
 *      over the first half of the cone and far too bright at the rim, which
 *      draws a milky dome instead of a plume. `knee`/`power` MUST reproduce the
 *      radius law the geometry was actually built on (see @homie-rocks/geom/coneshell),
 *      or the brightness will not sit on the shape.
 *
 *   3. A MONOTONIC HOT ROOT, and deliberately not a shock train: Mach diamonds
 *      need ambient pressure. A caller that wants them wants a different
 *      shader, not a flag on this one.
 *
 *   4. A RIM DISSOLVE. The far end must dissolve, not stop. Without it the
 *      shell's last ring is a hard geometric ellipse hanging in space — the
 *      most obvious "this is a cone mesh" tell there is.
 *
 *   5. A GROUND FADE, in WORLD Y. A plume that cuts a hard intersection line
 *      through the deck it is landing on is the loudest amateur tell an effect
 *      of this kind can ship. Depth testing hides the part BEHIND the surface;
 *      the part in FRONT is drawn over everything. `uGroundY` is rewritten per
 *      frame by the caller, and its "no ground known" sentinel must make the
 *      fade a NO-OP rather than deleting the plume — a shader default that can
 *      hide the effect is worse than one that ignores the feature.
 *
 *   6. AZIMUTHAL STRIATION. With 1–5 correct the shell still photographs as a
 *      sheet of CELLOPHANE, because every pixel is a smooth interpolation of
 *      its neighbours. Gas is not smooth. `striRate` MUST be 2π × an integer or
 *      the pattern seams down the length of the plume where the uv wraps.
 *
 *  ── AND TWO THINGS THAT ARE NOT OPTIONAL ───────────────────────────────────
 *
 *  THE DITHER. A smooth additive ramp from a bright root to nothing, drawn
 *  over a dark background, is the widest low-amplitude gradient a renderer
 *  ever draws, and it BANDS on 8-bit output. It is hashed off `gl_FragCoord`
 *  ONLY and never off a clock: a frozen frame has to be bit-identical or every
 *  ablation measured against it is noise.
 *
 *  THE TWO INCLUDES. A hand-written ShaderMaterial gets none of three's output
 *  plumbing for free. Inside a composer both compile away and the plume stays
 *  HDR-linear for bloom to find; rendering straight to the canvas — a test,
 *  a prewarm pass, a quality tier with no post — they are what stops a
 *  correctly-authored linear value being written verbatim into an sRGB buffer
 *  and coming out roughly three times too dark.
 *
 *  ── WHY A TEMPLATE AND NOT A UNIFORM FOR EVERY NUMBER ──────────────────────
 *
 *  The values below are baked into the text. They are per-MATERIAL and never
 *  animate, so a uniform would cost a fetch per fragment to express a constant,
 *  and — the reason that matters here — `@homie-rocks/fx` has exactly one plume
 *  shader and two materials in a scene are two programs anyway. `f()` always
 *  emits a decimal point: GLSL ES does not promote an int literal in every
 *  position, and `pow(x, 6)` is a compile error where `pow(x, 6.0)` is not.
 * ============================================================================
 */

/** A float literal that is always a float. `6` renders `6.0`, never `6`. */
const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

export interface PlumeShellLook {
  /**
   * The shell's radius law, `r(t) = knee·t^power + tail·t`, normalised to the
   * end radius. THIS MUST MATCH THE GEOMETRY. Feeding the brightness a
   * different flare from the one the vertices were built on puts the bright
   * band somewhere the shape is not.
   *
   * `tail` is passed rather than derived as `1 - knee` on purpose: the two are
   * authored together against a real nozzle and `1 - 0.34` is 0.6599999999999999
   * in binary floating point, which would put a different literal in the shader
   * text than the one a reader of the call site sees.
   */
  knee: number;
  tail: number;
  power: number;
  /** Exponent of the hot root just outside the nozzle exit; higher is tighter. */
  corePow: number;
  /** Combustion roughness: base, amplitude, then temporal, axial and azimuthal rates. */
  flick: [number, number, number, number, number];
  /** The far end dissolves over `smoothstep(1, rimStart, t)`. */
  rimStart: number;
  /** Radians of striation per unit of uv.x. MUST be 2π × an integer (see term 6). */
  striRate: number;
  /** Axial band over which the striation fades in; a real plume's root is uniform. */
  striFade: [number, number];
  /** Hot-to-cool blend runs over `smoothstep(0, colMix, t)`. */
  colMix: number;
  /** The core term's share of the emitted colour. */
  coreGain: number;
  /** Ordered-dither amplitude, in scene-linear units. See the note above. */
  dither: number;
}

/**
 * The vertex half. No look values reach it — it is instancing, uvs and a world
 * altitude — so it is one constant string.
 *
 * THE INSTANCING GUARD IS THE WHOLE OF IT. three does NOT fold `instanceMatrix`
 * into `transformed` for you; the built-in `project_vertex` chunk multiplies it
 * into `mvPosition` only. A hand-written vertex shader must apply it itself, and
 * a plume that forgets renders every engine's exhaust at engine zero — a failure
 * that looks entirely plausible on screen.
 */
export const PLUME_SHELL_VERT = /* glsl */ `
varying vec3 vViewNormal;
varying vec2 vUvP;
varying float vWorldY;

void main() {
  vec3 objPos = position;
  vec3 objNrm = normal;
  #ifdef USE_INSTANCING
    objPos = ( instanceMatrix * vec4( objPos, 1.0 ) ).xyz;
    objNrm = mat3( instanceMatrix ) * objNrm;
  #endif
  vViewNormal = normalize( normalMatrix * objNrm );
  vUvP = uv;
  // World height, for the ground fade. modelMatrix is the VEHICLE's transform
  // (this mesh is parented to it), so this is a real world altitude and it
  // tracks a descent for free.
  vWorldY = ( modelMatrix * vec4( objPos, 1.0 ) ).y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( objPos, 1.0 );
}
`;

/** The uniforms the fragment half declares, for a caller building the material. */
export const PLUME_SHELL_UNIFORMS = [
  'uHot', 'uCool', 'uCore', 'uThrottle', 'uIntensity', 'uRootR', 'uCoreBoost',
  'uTimeP', 'uGroundY', 'uFadeH', 'uLimbPow', 'uBodyFloor', 'uStriate',
] as const;

/** The fragment half, with `look` baked in. */
export function plumeShellFrag(look: PlumeShellLook): string {
  const [fb, fa, ft, fx, fu] = look.flick;
  const [s0, s1] = look.striFade;
  return /* glsl */ `
uniform vec3 uHot;
uniform vec3 uCool;
uniform vec3 uCore;
uniform float uThrottle;
uniform float uIntensity;
uniform float uRootR;
uniform float uCoreBoost;
uniform float uTimeP;
uniform float uGroundY;
uniform float uFadeH;
uniform float uLimbPow;
uniform float uBodyFloor;
uniform float uStriate;
varying vec3 vViewNormal;
varying vec2 vUvP;
varying float vWorldY;

void main() {
  float t = vUvP.y;

  // 1. LIMB BRIGHTENING — the column density is greatest at the silhouette.
  float ndv = abs( normalize( vViewNormal ).z );
  float limb = pow( 1.0 - ndv, uLimbPow );

  // 2. AXIAL DENSITY. 'f' reproduces the RADIUS the geometry has at this
  //    station; 'uRootR' is the root radius as a fraction of the end radius;
  //    the column density goes as the inverse square of the local radius.
  float f = ${f(look.knee)} * pow( t, ${f(look.power)} ) + ${f(look.tail)} * t;
  float dens = uRootR / ( uRootR + f );
  float axial = dens * dens;

  // 3. The hot root. One monotonic term — no shock train, no Mach diamonds.
  float core = pow( max( 0.0, 1.0 - t ), ${f(look.corePow)} ) * uCoreBoost;

  // Combustion roughness.
  float flick = ${f(fb)} + ${f(fa)} * sin( uTimeP * ${f(ft)} + t * ${f(fx)} + vUvP.x * ${f(fu)} );

  // 4. The far end dissolves rather than stopping.
  float rim = smoothstep( 1.0, ${f(look.rimStart)}, t );

  // 5. The flow arrives at the surface and stops being visible there, which is
  //    also what really happens: the axial flow turns 90 degrees at the ground
  //    and becomes a radial sheet, which is a different effect's job.
  float ground = smoothstep( uGroundY, uGroundY + uFadeH, vWorldY );

  // 6. Azimuthal structure, faded out at the root where a plume is uniform.
  float stri = 1.0 - uStriate * ( 0.5 - 0.5 * cos( vUvP.x * ${f(look.striRate)} + t * 3.1 ) )
                              * smoothstep( ${f(s0)}, ${f(s1)}, t );

  vec3 col = mix( uHot, uCool, smoothstep( 0.0, ${f(look.colMix)}, t ) );
  float a = uIntensity * uThrottle * axial * rim * ground * ( uBodyFloor + ( 1.0 - uBodyFloor ) * limb ) * flick * stri;

  vec3 outCol = col * a + uCore * core * uThrottle * uIntensity * ground * ${f(look.coreGain)};

  // The dither. Hashed off gl_FragCoord ONLY, never off a clock.
  float dth = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  outCol += ( dth - 0.5 ) * ${f(look.dither)};

  gl_FragColor = vec4( outCol, 1.0 );

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
}
