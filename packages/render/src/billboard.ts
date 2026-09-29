/**
 * ============================================================================
 *  billboard — THE OTHER HALF OF atlasbake. Something has to DISPLAY the atlas.
 * ============================================================================
 *
 *  `atlasbake.ts` renders a subject into a cols x rows grid once at load. This
 *  is what puts those tiles back on the screen: an instanced camera-facing
 *  quad, one instance per distant thing, each picking its own tile.
 *
 *  The two files are one contract and the bake's own header says so — "an atlas
 *  baked at one tile count and sampled at another is a crowd wearing each
 *  other's frames". They share `atlasUvGLSL` for exactly that reason, so the
 *  divisor is written once and cannot drift between the two sides.
 *
 *  ── THE INSTANCE TRANSLATION HAS TO BE READ OUT OF THE MATRIX BY HAND ──────
 *
 *  This is the trap, it is the reason the vertex shader is published rather
 *  than left to each game, and it fails in the most convincing possible way.
 *  `instanceMatrix` is NOT applied to `transformed` by three's own chunks, so
 *  the obvious `modelViewMatrix * vec4(position, 1.0)` gives the SAME point for
 *  every instance in the set. It compiles, it renders, it looks entirely
 *  plausible — until you notice the entire far field has collapsed into one
 *  place. Reading column 3 for the translation and the length of column 0 for
 *  the scale is what makes an instanced billboard an instanced billboard.
 *
 *  ── OFFSET IN VIEW SPACE, NOT IN WORLD SPACE ───────────────────────────────
 *
 *  The quad is expanded AFTER the model-view transform, which is what makes it
 *  face the camera for free with no per-instance orientation and no CPU work.
 *  It also means the pivot is wherever the caller's geometry puts it: a quad
 *  translated so its base is at the origin stands ON the ground, which is what
 *  anything with feet wants, and a centred one hovers.
 *
 *  ── ALPHA CUTOUT, NOT BLENDING, AND THAT IS A DEPTH DECISION ───────────────
 *
 *  `discard` below the cutoff with `depthWrite` on. A transparent billboard
 *  needs sorting, and a far field of hundreds of them sorted per frame is more
 *  CPU than the geometry it replaced. The cost is a hard silhouette edge, which
 *  at the range a billboard is used at is a handful of pixels.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS THE CALLER'S ─────────────────────────────
 *
 *  Mechanism: the instance-matrix decode, the view-space expansion, the tile
 *  lookup, the cutout, and the tile PICK below. The caller's: the tile grid,
 *  the metres, the cutoff, the tint, whether it casts a shadow, and everything
 *  that was baked into the atlas in the first place. Nothing here knows what is
 *  on the tiles.
 * ============================================================================
 */
import * as THREE from 'three';
import { atlasUvGLSL } from './atlasbake.ts';

/** The grid, the size on the ground, and where the silhouette ends. */
export interface BillboardSpec {
  /** Tile grid. MUST match the atlas this samples. */
  cols: number;
  rows: number;
  /** Alpha below this is discarded. */
  cutoff: number;
}

/**
 * A GLSL float literal that is still the number the caller wrote.
 *
 * NOT `toFixed`. A fixed-width format turns 0.42 into 0.42000, which is the
 * same float and a different shader STRING — and a parity gate that compares
 * shader text, which is the only kind worth having, would then be unable to
 * tell a harmless reformat from a changed constant. The `.0` is added only
 * where GLSL would otherwise read an int.
 */
const glslNum = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** The vertex and fragment pair, with the grid and the cutoff baked in. */
export function billboardGLSL(spec: BillboardSpec): { vert: string; frag: string } {
  const vert = /* glsl */ `
attribute vec3 aImp;      // x tile column, y tile row, z fade 0..1
varying vec2 vUv;
varying float vFade;
uniform vec2 uSize;       // metres: half-width, height
void main() {
  // instanceMatrix is NOT applied to transformed by three, so a billboard
  // must read the instance TRANSLATION out of the matrix by hand. Computing a
  // world position the obvious way here would give the same point for every
  // instance in the set, and it would look plausible until you noticed the
  // whole field had collapsed into one place.
  #ifdef USE_INSTANCING
    vec3 ipos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float iscale = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  #else
    vec3 ipos = vec3(0.0);
    float iscale = 1.0;
  #endif
  vec4 mv = modelViewMatrix * vec4(ipos, 1.0);
  mv.xy += vec2(position.x * uSize.x, position.y * uSize.y) * iscale;
  vUv = (position.xy + vec2(0.5, 0.0) + vec2(aImp.x, aImp.y)) * ${atlasUvGLSL(spec.cols, spec.rows)};
  vFade = aImp.z;
  gl_Position = projectionMatrix * mv;
}
`;
  const frag = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uTint;
varying vec2 vUv;
varying float vFade;
#include <common>
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  if (t.a < ${glslNum(spec.cutoff)}) discard;
  vec3 c = t.rgb * uTint * vFade;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
  return { vert, frag };
}

/**
 * A material wired to those two shaders.
 *
 * @param halfW half the billboard's width, in metres.
 * @param height its full height, in metres. The ratio of the two SHOULD match
 *               the atlas tile's pixel aspect or the subject is stretched, and
 *               nothing here can check that for you: the texture's own
 *               dimensions are the whole atlas, not one tile.
 */
export function billboardMaterial(
  atlas: THREE.Texture, spec: BillboardSpec, halfW: number, height: number,
): THREE.ShaderMaterial {
  const { vert, frag } = billboardGLSL(spec);
  return new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlas },
      uSize: { value: new THREE.Vector2(halfW, height) },
      uTint: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
}

/** Where a tile pick is written, so the hot path allocates nothing. */
export interface TilePick {
  col: number;
  row: number;
}

/**
 * WHICH baked tile this instance shows.
 *
 * Rows are VIEW YAW: the angle between the subject's own facing and the
 * direction from the camera to it, quantised to the row count. Columns are an
 * animation PHASE in 0..1. That is the layout `atlasbake`'s callers bake and
 * it is stated here so the two sides cannot disagree about which axis is which.
 *
 * The `+ rows` after the modulo is not defensive: JavaScript's `%` keeps the
 * sign of the dividend, so a subject facing away from the camera produces a
 * negative row and samples off the end of the atlas — which on a repeating
 * texture is another subject's silhouette and on a clamped one is a smear.
 *
 * @param dx,dz  from the camera TO the subject, on the ground plane.
 * @param yaw    the subject's own facing.
 * @param phase  0..1 through the baked animation.
 */
export function billboardTile(
  dx: number, dz: number, yaw: number, phase: number,
  cols: number, rows: number, out: TilePick,
): TilePick {
  const rel = Math.atan2(dx, dz) - yaw;
  let row = Math.round((rel / (Math.PI * 2)) * rows) % rows;
  if (row < 0) row += rows;
  out.col = Math.floor(phase * cols) % cols;
  out.row = row;
  return out;
}
