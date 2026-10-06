/**
 * ============================================================================
 *  FinishEffect — the last pass: sharpen, grade, speed lines, vignette, flash.
 * ============================================================================
 *
 *  `Grade.ts` is a racing game's merged grade: reprojection motion blur, a
 *  subject hold-out, an authored split tone, and a constructor that wants the
 *  camera's matrices every frame. It is the right pass for the games it came
 *  out of and a lot to adopt for a game that wants a sharp, graded picture
 *  with a couple of feedback effects on top.
 *
 *  This is the small one. It runs AFTER tone mapping, on a display-referred
 *  0..1 picture, and does five things in one fullscreen draw:
 *
 *   1. **CONTRAST-ADAPTIVE SHARPEN.** Dynamic resolution and bloom both
 *      soften the frame; a fixed unsharp mask puts the edges back and rings on
 *      every edge that was already hard. This is the five-tap form of the
 *      contrast-adaptive sharpener: the weight is scaled by how much headroom
 *      the neighbourhood has left before it clips, so flat areas and hard
 *      edges are left alone and soft detail is lifted. Four extra texture
 *      reads, compiled out entirely when `sharpen` is false (the phone tier).
 *
 *   2. **GRADE.** A tint, saturation about luma, contrast about mid grey.
 *
 *   3. **SPEED LINES.** Thin radial streaks outside a clear centre, redrawn
 *      24 times a second from the effect's OWN clock (advanced by `advance`,
 *      so a paused game holds them still). Compiled out when `lines` is false.
 *
 *   4. **VIGNETTE.**
 *
 *   5. **FLASH.** A colour laid over the frame that decays on its own: a hit,
 *      a pickup, a finish line.
 *
 *  It also scrubs a non-finite input to black before any of that. `Bloom.ts`
 *  explains at length how one NaN texel becomes a black block; the scrub there
 *  protects the bloom, and this one protects the frame from anything that got
 *  past it, at the cost of one comparison.
 *
 *  THE MATHS IS ALSO HERE AS PLAIN FUNCTIONS ({@link casSharpen},
 *  {@link flashDecay}), written to match the shader line for line, so the
 *  behaviour that matters (no change on a flat area, no overshoot past black
 *  or white, a flash that is gone when it says) is tested in Node.
 * ============================================================================
 */
import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

/** What the effect is compiled with, and where its dials start. All required. */
export interface FinishSpec {
  /** Compile the sharpen in. False costs nothing at all. */
  sharpen: boolean;
  /** 0..1. 0 is the gentlest sharpen, 1 the strongest; it is never off while compiled in. */
  sharpness: number;
  /** Compile the speed lines in. */
  lines: boolean;
  /** How many streaks fit around the frame, and the radius (0..0.7) inside which there are none. */
  lineCells: number;
  lineInner: number;
  /** 1 is unchanged for both. */
  contrast: number;
  saturation: number;
  /** Multiplied into the picture, in display terms. White is unchanged. */
  tint: THREE.Color;
  /** Darkening at the corners, 0..1, and the radius at which it starts. */
  vignette: number;
  vignetteInner: number;
  /** Seconds for a flash to fall to about a third. */
  flashTau: number;
}

/*
 * NO BACKTICKS BELOW THIS LINE until the end of the template literal: a
 * backtick inside it ends the string and the rest of the file stops parsing.
 */
const FINISH_FRAGMENT = /* glsl */ `
uniform vec2 grade;      // x contrast, y saturation
uniform vec3 tint;
uniform float sharpness;
uniform vec4 lines;      // x amount, y inner radius, z cells, w unused
uniform float clock;
uniform vec2 vignette;   // x amount, y inner radius
uniform vec4 flash;      // rgb colour, a amount

// A relational test against a finite bound, not a self-compare: see Bloom.ts.
vec3 pfxFinite(vec3 v) {
  bvec3 ok = lessThan(abs(v), vec3(65504.0));
  return vec3(ok.x ? v.x : 0.0, ok.y ? v.y : 0.0, ok.z ? v.z : 0.0);
}

float pfxHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

#ifdef FINISH_SHARPEN
vec3 pfxTap(vec2 uv) { return clamp(pfxFinite(texture2D(inputBuffer, uv).rgb), 0.0, 1.0); }

vec3 pfxCas(vec3 c, vec2 uv) {
  vec3 a = pfxTap(uv + vec2(0.0, -texelSize.y));
  vec3 b = pfxTap(uv + vec2(-texelSize.x, 0.0));
  vec3 d = pfxTap(uv + vec2(texelSize.x, 0.0));
  vec3 e = pfxTap(uv + vec2(0.0, texelSize.y));
  vec3 mn = min(c, min(min(a, b), min(d, e)));
  vec3 mx = max(c, max(max(a, b), max(d, e)));
  // Headroom before the neighbourhood clips, over its peak: 0 on a hard edge
  // that already spans black to white, so that edge gets no ringing.
  vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
  vec3 w = amp * (-1.0 / mix(8.0, 5.0, sharpness));
  return clamp((c + (a + b + d + e) * w) / (1.0 + 4.0 * w), 0.0, 1.0);
}
#endif

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = clamp(pfxFinite(inputColor.rgb), 0.0, 1.0);
#ifdef FINISH_SHARPEN
  c = pfxCas(c, uv);
#endif

  c *= tint;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, grade.y);
  c = (c - 0.5) * grade.x + 0.5;

  // Centred, and squared up so a streak or a vignette is round on any aspect.
  vec2 p = uv - 0.5;
  float r = length(p);
  p.x *= texelSize.y / texelSize.x;

#ifdef FINISH_LINES
  if (lines.x > 0.0) {
    float turn = atan(p.y, p.x) / 6.2831853 + 0.5;
    float id = floor(turn * lines.z);
    float f = fract(turn * lines.z);
    float tick = floor(clock * 24.0);
    float on = step(0.7, pfxHash(vec2(id, tick)));
    float body = smoothstep(0.0, 0.3, f) * (1.0 - smoothstep(0.7, 1.0, f));
    float start = lines.y + 0.2 * pfxHash(vec2(id + 31.0, tick));
    c += on * body * smoothstep(start, start + 0.18, r) * lines.x;
  }
#endif

  c *= 1.0 - vignette.x * smoothstep(vignette.y, 0.75, r);
  c = mix(c, flash.rgb, clamp(flash.a, 0.0, 1.0));
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

/**
 * The sharpen, for one channel, exactly as the shader computes it: the centre
 * `c` and its four neighbours, all 0..1, and a sharpness 0..1.
 */
export function casSharpen(c: number, a: number, b: number, d: number, e: number, sharpness: number): number {
  const mn = Math.min(c, a, b, d, e);
  const mx = Math.max(c, a, b, d, e);
  const amp = Math.sqrt(Math.min(1, Math.max(0, Math.min(mn, 1 - mx) / Math.max(mx, 1e-4))));
  const w = amp * (-1 / (8 + (5 - 8) * sharpness));
  return Math.min(1, Math.max(0, (c + (a + b + d + e) * w) / (1 + 4 * w)));
}

/** A flash level after `dt` seconds: an exponential, snapped to 0 once it cannot be seen. */
export function flashDecay(level: number, tau: number, dt: number): number {
  const next = level * Math.exp(-dt / Math.max(1e-6, tau));
  return next < 1 / 512 ? 0 : next;
}

export class FinishEffect extends Effect {
  private readonly flashTau: number;

  constructor(spec: FinishSpec) {
    const defines = new Map<string, string>();
    if (spec.sharpen) defines.set('FINISH_SHARPEN', '1');
    if (spec.lines) defines.set('FINISH_LINES', '1');
    super('Finish', FINISH_FRAGMENT, {
      // CONVOLUTION only when it really reads its neighbours: an effect that
      // declares it cannot share a pass with another one that does.
      attributes: spec.sharpen ? EffectAttribute.CONVOLUTION : EffectAttribute.NONE,
      blendFunction: BlendFunction.SRC,
      defines,
      uniforms: new Map<string, THREE.Uniform>([
        ['grade', new THREE.Uniform(new THREE.Vector2(spec.contrast, spec.saturation))],
        ['tint', new THREE.Uniform(new THREE.Vector3(spec.tint.r, spec.tint.g, spec.tint.b))],
        ['sharpness', new THREE.Uniform(Math.min(1, Math.max(0, spec.sharpness)))],
        ['lines', new THREE.Uniform(new THREE.Vector4(0, spec.lineInner, spec.lineCells, 0))],
        ['clock', new THREE.Uniform(0)],
        ['vignette', new THREE.Uniform(new THREE.Vector2(spec.vignette, spec.vignetteInner))],
        ['flash', new THREE.Uniform(new THREE.Vector4(1, 1, 1, 0))],
      ]),
    });
    this.flashTau = spec.flashTau;
  }

  /** x contrast, y saturation. */
  get grade(): THREE.Vector2 { return this.uniforms.get('grade')!.value; }
  get tint(): THREE.Vector3 { return this.uniforms.get('tint')!.value; }
  /** x amount, y inner radius. */
  get vignette(): THREE.Vector2 { return this.uniforms.get('vignette')!.value; }

  /** Speed-line brightness, 0 (none) to about 0.5 (a boost). The game eases it. */
  set speed(amount: number) { (this.uniforms.get('lines')!.value as THREE.Vector4).x = Math.max(0, amount); }
  get speed(): number { return (this.uniforms.get('lines')!.value as THREE.Vector4).x; }

  /** The flash showing now, 0..1. */
  get flashLevel(): number { return (this.uniforms.get('flash')!.value as THREE.Vector4).w; }

  /**
   * Lay a colour over the frame at `strength` (0..1); it decays by itself.
   * A flash never lowers one already showing, so two hits in a frame read as
   * the stronger and not as whichever came last.
   */
  flash(r: number, g: number, b: number, strength: number): void {
    const f = this.uniforms.get('flash')!.value as THREE.Vector4;
    if (strength < f.w) return;
    f.set(r, g, b, Math.min(1, strength));
  }

  /**
   * Advance the flash and the speed-line clock by `dt` seconds. Call it once
   * a frame with the GAME's dt, so a pause or a hit-stop holds both still.
   */
  advance(dt: number): void {
    const f = this.uniforms.get('flash')!.value as THREE.Vector4;
    f.w = flashDecay(f.w, this.flashTau, dt);
    // Wrapped so the float the shader multiplies stays exact for any session length.
    this.uniforms.get('clock')!.value = (this.uniforms.get('clock')!.value + dt) % 600;
  }
}
