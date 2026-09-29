/**
 * ============================================================================
 *  emissivepulse.ts — four emissive behaviours out of ONE material, selected
 *  per piece by a vertex attribute.
 * ============================================================================
 *
 *  A world full of artificial light is a beacon here, a status strip there, a
 *  travelling chase down a kerb, a slow breathing glow inside a window. The
 *  obvious implementation is a material per behaviour and a draw call per
 *  material, and it is wrong twice: it costs the draws, and it means a piece
 *  cannot change behaviour without changing material.
 *
 *  So the behaviour rides on the geometry. `aVar.w` picks the waveform,
 *  `aVar.x` is a per-piece phase so a row of beacons does not flash in unison,
 *  `aVar.z` scales the result, and `vColor` carries the emissive radiance
 *  itself — which is why it must be a Float32 colour attribute and never a
 *  normalised byte one: a radiance ladder's top rung is above 1 and a byte
 *  attribute clips it to white.
 *
 *  ## The four
 *
 *    0  steady
 *    1  BEACON — a fast rise and a long exponential decay. A sine reads as a
 *       dimmer knob being turned, which is the amateur version of a flash; the
 *       decay is what makes it read as xenon.
 *    2  TRAVEL — a gaussian head running along `uv.y`. The period is given in
 *       CYCLES PER UNIT of uv.y, so if the caller's uv.y is metres along the
 *       strip the head moves at a real speed regardless of how the strip was
 *       tessellated. Two strips of different lengths then agree.
 *    3  BREATHE — a slow sine, for an interior.
 *
 *  ## Three things that are corrections, not knobs
 *
 *  **`vec3( vColor )`, not `vColor`.** three r185 declares the varying as a
 *  *vec4* for BOTH USE_COLOR and USE_COLOR_ALPHA — they were unified in
 *  color_pars_fragment — so a bare `vColor` in a vec3 expression fails to link
 *  and takes the whole lit-material family with it. That is a black scene
 *  behind a boot bar that reads "ready".
 *
 *  **color_fragment is REPLACED WITH NOTHING.** `vColor` here is an emissive
 *  radiance, not an albedo tint, and letting three multiply `diffuseColor` by
 *  it as well would make the UNLIT body of a strip glow-coloured instead of
 *  whatever dark colour its author chose for it to fall back to when the power
 *  goes off.
 *
 *  **The anchor is emissivemap_fragment.** `totalEmissiveRadiance` is
 *  established there and consumed further down; a write before it is
 *  overwritten and a write after it is a no-op, and both look exactly like a
 *  working shader.
 *
 *  ## What the caller owns
 *
 *  Every number. The three waveforms' constants are tuning, and the optional
 *  chroma shift is a whole art direction: which hue family it acts on, which
 *  way it moves and how far. A default here is how the next game inherits the
 *  last one's colour grade with every parity check still green.
 */
import * as THREE from 'three';

/** A number as GLSL source; an integer still emits a float literal. */
function glslNum(v: number): string {
  const s = String(v);
  return s.indexOf('.') < 0 && s.indexOf('e') < 0 ? s + '.0' : s;
}
/** The same, at a fixed number of places, for a value authored as 1.10. */
function glslFixed(v: number, dp: number): string {
  return v.toFixed(dp);
}

export interface BeaconTune {
  /** Seconds per flash. */
  period: number;
  /** Floor between flashes. */
  floor: number;
  /** Peak added at the rise. */
  gain: number;
  /** Decay rate over the cycle. Higher is a shorter flash. */
  decay: number;
}

export interface TravelTune {
  /** Cycles per unit of uv.y. Author uv.y in metres and this is a wavelength. */
  cyclesPerUnit: number;
  /** Cycles per second the head advances. */
  speed: number;
  /** Level away from the head. */
  floor: number;
  /** Peak at the head. */
  gain: number;
  /** Gaussian sharpness. Higher is a tighter head. */
  sharp: number;
}

export interface BreatheTune {
  base: number;
  amp: number;
  /** Radians per second. */
  rate: number;
}

/**
 * Collapse ONE hue family toward its own luminance, under a driver uniform.
 *
 * The mechanism is generic and the choice is not: a family is selected by a
 * channel comparison, so `bias` sets how far apart two channels must be before
 * a colour counts as belonging to it, and `weights` is where the collapsed
 * value lands per channel — equal weights give neutral grey, a rising ramp
 * gives a cool tint. Everything the driver does not select is untouched.
 */
export interface ChromaShiftTune {
  /** How much bluer than red a colour must be to count. */
  bias: number;
  /** Per-channel multipliers on the collapsed luminance. */
  weights: [number, number, number];
  /** How far to go at driver = 1. */
  amount: number;
  /** Decimal places each weight is written at, so 1.10 stays 1.10. */
  dp?: number;
}

export interface EmissivePulseInstall {
  /** Seconds. The caller's SIM clock, so a frozen frame is reproducible. */
  uTime: { value: number };
  /** The chroma shift's driver, 0..1. Required only if `chroma` is given. */
  uDriver?: { value: number };
  /** Shared idempotence guard, owned by the caller. */
  seen: WeakSet<THREE.Material>;
  /** Program cache key. Bump it whenever any number below changes. */
  key: string;
  beacon: BeaconTune;
  travel: TravelTune;
  breathe: BreatheTune;
  chroma?: ChromaShiftTune;
  /** The vertex/fragment declarations for the aVar attribute. */
  parsV: string;
  vert: string;
  parsF: string;
}

export function installEmissivePulse(mat: THREE.Material, o: EmissivePulseInstall): void {
  if (o.seen.has(mat)) return;
  o.seen.add(mat);
  const b = o.beacon, t = o.travel, br = o.breathe, c = o.chroma;
  const dp = c?.dp ?? 2;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = o.uTime;
    if (o.uDriver) shader.uniforms.uNight = o.uDriver;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + o.parsV)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + o.vert);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\n'
        + (o.uDriver ? 'uniform float uNight;\n' : '') + o.parsF)
      .replace('#include <color_fragment>', '')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n' + /* glsl */ `
        float mbPulse = 1.0;
        if ( vVar.w > 0.5 && vVar.w < 1.5 ) {
          // Beacon: a fast rise and a long decay reads as a xenon flash; a sine
          // reads as a dimmer knob being turned, which is the amateur version.
          float mbP = fract( uTime / ${glslNum(b.period)} + vVar.x );
          mbPulse = ${glslNum(b.floor)} + ${glslNum(b.gain)} * exp( - mbP * ${glslNum(b.decay)} );
        } else if ( vVar.w > 1.5 && vVar.w < 2.5 ) {
          // Travelling pulse. vPieceUv.y is in the caller's own units, so the
          // wavelength and the head speed below are real rather than a function
          // of how the strip happened to be tessellated.
          float mbS = fract( vPieceUv.y * ${glslNum(t.cyclesPerUnit)} - uTime * ${glslNum(t.speed)} + vVar.x );
          float mbD = min( mbS, 1.0 - mbS );
          mbPulse = ${glslNum(t.floor)} + ${glslNum(t.gain)} * exp( - mbD * mbD * ${glslNum(t.sharp)} );
        } else if ( vVar.w > 2.5 ) {
          mbPulse = ${glslNum(br.base)} + ${glslNum(br.amp)} * sin( uTime * ${glslNum(br.rate)} + vVar.x * 6.28 );
        }
        // vec3( vColor ), not vColor: three r185 declares the varying as
        // *vec4* for BOTH USE_COLOR and USE_COLOR_ALPHA (they were unified —
        // see color_pars_fragment.glsl.js), so a bare vColor here is a
        // vec3 *= vec4 assign and the whole lit-material family fails to link.
        // That is a black scene behind a boot bar that reads "ready".
        vec3 mbCol = vec3( vColor );
${c ? `        float mbIsCyan = step( mbCol.r + ${glslNum(c.bias)}, mbCol.b );
        float mbIceY = dot( mbCol, vec3( 0.2126, 0.7152, 0.0722 ) );
        mbCol = mix( mbCol, vec3( mbIceY * ${glslFixed(c.weights[0], dp)}, mbIceY * ${glslFixed(c.weights[1], dp)}, mbIceY * ${glslFixed(c.weights[2], dp)} ), mbIsCyan * uNight * ${glslNum(c.amount)} );\n` : ''}        totalEmissiveRadiance *= mbCol * vVar.z * mbPulse;
        `,
      );
  };
  const key = o.key;
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key
      : () => key;
}
