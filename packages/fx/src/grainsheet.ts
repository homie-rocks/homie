/**
 * ============================================================================
 *  grainsheet — the shader pair for a BALLISTIC ejecta sheet.
 * ============================================================================
 *
 *  The partner of `BallisticDust.ts`, which owns the pool, the ring emitter and
 *  the closed-form time of flight. This owns what those grains LOOK like, and
 *  the split is the one `Plumes.ts` states: the buffer is the same everywhere
 *  and the shader is the whole look.
 *
 *  ── WHOLE SIMULATION, IN THE VERTEX SHADER ─────────────────────────────────
 *
 *  A parabola, in world space, and then it stops. There is no drag term, no
 *  turbulence field, no curl noise and no buoyancy, because a ballistic sheet
 *  is what you get when there is nothing for the grains to push against. A
 *  caller who wants billow wants a different effect. `gravity` is the ONLY
 *  physical constant and it is required: 9.81 and 1.62 are different pictures,
 *  and a default here is one world's gravity leaking into every other one.
 *
 *  ── THE THREE THINGS THAT MAKE IT READ ─────────────────────────────────────
 *
 *   1. THE SMEAR. A grain at 40 m/s crosses two thirds of a metre in one
 *      60 Hz frame; a photograph of that is a STREAK, not a dot. Stretching
 *      the quad along its SCREEN-SPACE velocity multiplies the covered area
 *      three to five times for no extra particle, and it turns a field of
 *      round dots into radial lines pointing away from the impingement —
 *      which is what makes a ballistic sheet legible AS ballistic. The
 *      velocity is the derivative of the same parabola the position comes
 *      from, so there is no second integrator to disagree with the first. It
 *      dies with the grain: a settled grain is round, because it is not moving.
 *
 *   2. THE PUFF PROFILE. A grain sprite stands for a puff of MANY grains, so
 *      its profile is a density falling from the centre with no flat top and
 *      no rim, and it is never opaque. A flat-topped disc with a soft rim is
 *      invisible while the grains are sub-pixel and resolves into hard white
 *      circles the moment they are not — bokeh snow, which is the failure this
 *      profile exists to refuse.
 *
 *   3. THE TINT FALLOFF. A caller bakes the blast's contribution into `aTint`
 *      at SPAWN, off the grain's birth radius. That is right at birth and
 *      wrong four seconds later: a grain that travels three hundred metres
 *      carries its under-the-nozzle brightness the whole way and photographs
 *      as white snow scattered across the mid-field. Falling off with flight
 *      fraction is both the fix and the physics.
 *
 *  ── THE DEAD-SLOT BRANCH IS NOT AN OPTIMISATION DETAIL ─────────────────────
 *
 *  Fully-faded grains are pushed outside the clip volume rather than drawn as
 *  transparent quads. The pool is large and this is most of it, most of the
 *  time; it is cheaper than any CPU-side compaction and it allocates nothing.
 *
 *  `f()` always emits a decimal point — GLSL ES does not promote an int literal
 *  in every position.
 * ============================================================================
 */

const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

export interface GrainSheetLook {
  /** m/s². The one physical constant, and it has no default. */
  gravity: number;
  /** Seconds over which a newly-spawned grain fades in. */
  appear: number;
  /** Seconds a landed grain takes to settle into the surface. It does not drift. */
  settle: number;
  /** Fraction of the baked spawn tint lost over a full flight. See point 3 above. */
  tintFalloff: number;
  /** Extra sprite size at the end of flight, as a fraction: a spray disperses. */
  grow: number;
  /** Hard cap on the velocity smear, in multiples of the quad. */
  stretchMax: number;
  /** Seconds after landing over which the smear dies back to a round grain. */
  smearDie: number;
  /** Radius over which the puff's density falls to nothing, in quad units. */
  puffR: number;
  /** Column opacity of one puff at its centre. */
  puffAlpha: number;
  /** Alpha below which a fragment is discarded outright. */
  cutoff: number;
}

/**
 * The vertex half. `aInfo` is (birth time, time of ground impact, size);
 * `aTint` is the light baked at spawn; `aOrigin`/`aVel` are the parabola.
 */
export function grainSheetVert(look: GrainSheetLook): string {
  const g = look.gravity;
  return /* glsl */ `
uniform float uTimeD;
uniform float uSizeScale;
uniform float uStretch;
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec3 aInfo;   // x = birth time, y = time of ground impact, z = size
attribute vec3 aTint;
varying float vAlphaD;
varying vec3 vTintD;
varying vec2 vQuadD;

void main() {
  float age = uTimeD - aInfo.x;
  float tLand = aInfo.y;
  float t = clamp( age, 0.0, tLand );

  // THE WHOLE SIMULATION.
  vec3 p = aOrigin + aVel * t - vec3( 0.0, ${f(g / 2)} * t * t, 0.0 );

  float appear = smoothstep( 0.0, ${f(look.appear)}, age );
  float settle = 1.0 - smoothstep( 0.0, ${f(look.settle)}, age - tLand );
  vAlphaD = appear * settle * step( 0.0, age );

  // The spawn tint is right at birth and wrong at range.
  float flown = clamp( t / max( tLand, 0.001 ), 0.0, 1.0 );
  vTintD = aTint * ( 1.0 - ${f(look.tintFalloff)} * flown );
  vQuadD = uv - 0.5;

  if ( vAlphaD <= 0.001 ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }

  float grow = 1.0 + ${f(look.grow)} * clamp( t / max( tLand, 0.001 ), 0.0, 1.0 );
  float size = aInfo.z * uSizeScale * grow;

  vec4 mv = modelViewMatrix * vec4( p, 1.0 );

  // THE SMEAR, along the screen-space velocity of the same parabola.
  vec3 wv = aVel - vec3( 0.0, ${f(g)} * t, 0.0 );
  vec3 vv = ( modelViewMatrix * vec4( wv, 0.0 ) ).xyz;
  float sp = length( vv.xy );
  float moving = 1.0 - smoothstep( 0.0, ${f(look.smearDie)}, age - tLand );
  vec2 dir = sp > 1e-4 ? vv.xy / sp : vec2( 1.0, 0.0 );
  vec2 perp = vec2( -dir.y, dir.x );
  float lenK = min( 1.0 + uStretch * sp * moving, ${f(look.stretchMax)} );
  mv.xy += ( dir * vQuadD.x * lenK + perp * vQuadD.y ) * size;
  gl_Position = projectionMatrix * mv;
}
`;
}

/** The fragment half: a puff, not a bubble. */
export function grainSheetFrag(look: GrainSheetLook): string {
  return /* glsl */ `
varying float vAlphaD;
varying vec3 vTintD;
varying vec2 vQuadD;

void main() {
  float d = length( vQuadD );
  // A density falling from the centre, with no flat top and no rim.
  float m = 1.0 - smoothstep( 0.0, ${f(look.puffR)}, d );
  float a = m * m * vAlphaD * ${f(look.puffAlpha)};
  if ( a < ${f(look.cutoff)} ) discard;
  gl_FragColor = vec4( vTintD, a );

  // Without these the grains are written as raw linear into an sRGB buffer and
  // the sheet reads as black soot. See plumeshell.ts.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
}
