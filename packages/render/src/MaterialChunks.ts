/**
 * ============================================================================
 *  The GLSL chunks and the one helper every world-space material injection in
 *  these racing games builds its shader out of.
 * ============================================================================
 *  Five strings and a function. They lived twice — byte-for-byte, in the
 *  `Materials.ts` of a kart racer and of a space racer, which are forks of
 *  each other — and two copies of a GLSL chunk is a shape that has already
 *  been paid for: a fix lands in one and the other keeps the bug, and the
 *  symptom is a black surface that only appears on some quality tiers.
 *
 *  THEY ARE NOT PARAMETERISED AND THERE IS NOTHING TO CONFIGURE. Every one is
 *  the same text for every caller; a game supplies VALUES (a period, a tint, a
 *  world scale) to the injections that consume these, and never a flag that
 *  changes what the chunk says. If a game ever needs a different chunk, it is a
 *  different chunk and belongs in that game — not a boolean in here.
 *
 *  WHAT IS NOT IN HERE, deliberately: the injections themselves. `injectBreakup`
 *  and `injectTriplanar` diverged for real reasons between the two games (a
 *  different specular-AA algorithm, a world-cell layer one has and the other
 *  does not) and merging them would be an upgrade to one game's picture wearing
 *  a de-duplication's clothes. They stay where they are.
 *
 *  `three` is a peerDependency here, as everywhere in this package. Two copies
 *  of three.js is two `instanceof` universes.
 * ============================================================================
 */
import * as THREE from 'three';

/**
 * World-space varyings shared by every injection below.
 *
 * `vWorldP` is the fragment's world position **including the instance matrix**
 * — three applies `instanceMatrix` inside `<project_vertex>`, so a naive
 * `modelMatrix * transformed` at `<begin_vertex>` reports the same position for
 * every instance and any world-space effect collapses to a per-instance repeat.
 * `vInstOrigin` is the instance's own origin, which is the only stable
 * per-instance identity available without a custom attribute.
 *
 * BOTH BLOCKS ARE PREPROCESSOR-GUARDED, AND THAT GUARD IS LOAD-BEARING. Two
 * injections on one material each replace the same `#include` anchor, so
 * without the guard the second one emits a duplicate `varying vec3 vWorldP;`
 * and the shader fails to compile. A shader that fails to compile is not a
 * subtle bug (three logs it and the mesh goes black), but the failure lands on
 * the LARGEST SURFACE IN THE GAME and only on the quality tiers where both
 * injections are active, which is exactly the shape of thing that survives a
 * review. `#ifndef` makes the pair idempotent in whatever order and
 * however many times they are applied.
 *
 * NOT HYPOTHETICAL, AND MEASURED RATHER THAN ARGUED. On the space racer's four
 * deck materials `injectBreakup` and `injectLineLight` both land and both emit
 * this block; a material-shader probe counts `varying vec3 vWorldP;` TWICE in
 * the text handed to the compiler for every one of them, and the guard is the
 * only reason those four surfaces are not black. The kart racer has no pair
 * that collides TODAY — the same probe counts one occurrence on all 21 of its
 * world-space materials — which is precisely why it shipped without the guard
 * and would have gone black on whichever injection was added next.
 */
export const WORLD_PARS = /* glsl */ `
#ifndef K_WORLD_PARS
#define K_WORLD_PARS
varying vec3 vWorldP;
varying float vViewDist;
#endif
`;

export const WORLD_VERTEX = /* glsl */ `
#ifndef K_WORLD_VERTEX
#define K_WORLD_VERTEX
  vec4 kWP = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    kWP = instanceMatrix * kWP;
  #endif
  vWorldP = ( modelMatrix * kWP ).xyz;
  vViewDist = length( ( viewMatrix * vec4( vWorldP, 1.0 ) ).xyz );
#endif
`;

/** Per-instance identity, paid for only where a surface actually jitters. */
export const INST_PARS = 'varying vec3 vInstOrigin;\n';

export const INST_VERTEX = /* glsl */ `
  vec4 kOrg = vec4( 0.0, 0.0, 0.0, 1.0 );
  #ifdef USE_INSTANCING
    kOrg = instanceMatrix * kOrg;
  #endif
  vInstOrigin = ( modelMatrix * kOrg ).xyz;
`;

/**
 * `#ifndef`-GUARDED FOR THE SAME REASON `WORLD_PARS` IS, and it was not.
 *
 * This block was emitted by exactly one caller (`injectBreakup`) so the missing
 * guard was harmless right up until a second injection wanted the same hash —
 * the space racer's `injectGeoWear` does, for its per-cell age field. A
 * duplicate `kHash3` is a GLSL redefinition error, i.e. a black surface, and it
 * would have landed on the largest structural surface in the frame. Guarding a
 * shared chunk is cheaper than remembering which injections are allowed to
 * coexist — and cheaper still than working out, per game, which pairs currently
 * collide.
 */
export const WORLD_HASH = /* glsl */ `
#ifndef K_WORLD_HASH
#define K_WORLD_HASH
vec3 kHash3( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}
// One 2D slice of world space that never smears on a vertical surface: folding
// Y into both axes means a wall, a roof pitch and the ground all see the
// variation move as you travel across them.
vec2 kWorldPlane( vec3 p, float period ) {
  return ( p.xz + p.y * 0.71 ) / period;
}
#endif
`;

/**
 * A hex read as a per-channel **multiplier**, not as a colour.
 *
 * Deliberately not routed through `THREE.Color`: colour management would apply
 * an sRGB→linear transfer, and a transfer curve on a *ratio* is meaningless —
 * 0xb3b3b3 is supposed to mean "70% of whatever is already there", and after a
 * 2.2 gamma it means 45% instead, which is how every tint constant in a library
 * like this ends up hand-tuned to a number nobody can explain.
 *
 * `hueOnly` rescales so the largest channel is 1, giving a pure warm/cool shift
 * with no net gain or loss of energy — right for a colour drift, wrong for a
 * stain, which is supposed to be darker than what it sits on.
 */
export function tintMul(hex: number, hueOnly = false): THREE.Vector3 {
  let r = ((hex >> 16) & 255) / 255;
  let g = ((hex >> 8) & 255) / 255;
  let b = (hex & 255) / 255;
  if (hueOnly) {
    const m = Math.max(r, g, b) || 1;
    r /= m;
    g /= m;
    b /= m;
  }
  return new THREE.Vector3(r, g, b);
}

// ---------------------------------------------------------------------------
// PANELISATION — the four functions every world-space surface-history layer
// needs before it can paint anything.
// ---------------------------------------------------------------------------
//
// A material whose only detail is a tiled texture map filters into a flat grey
// at any distance the building is actually SEEN from. A 4 m tile on 1024 texels
// is 3.9 mm a texel; a 52 m dome reading 400 px wide is 33 TEXELS PER SCREEN
// PIXEL, so every feature in the bake — the bead, the course seam, the mottle —
// is past mip 5 and a mip is an average. That is the "untextured clay" a
// reviewer sees, and no amount of extra detail in the tile fixes it.
//
// Detail that survives has to be authored in METRES and in WORLD SPACE, so it
// cannot tile, cannot be mipped away, and lands identically on two pieces of
// geometry that happen to meet. (A merged object has no continuous UV across
// its parts, which is also why a texture-space band around a lathed end cap
// comes out as a wood-grain rosette: the lathe UV runs radially. A world-space
// band has no such thing to get wrong.)
//
// These four are what that layer is built out of, in every game that has one:
//
//   mbHash    a cheap 2-D hash, for jittering a lattice.
//   mbSplit   PANEL OUTLINES FROM A JITTERED LATTICE. A plain modulo grid gives
//             every panel an identical width, which reads instantly as CG;
//             displacing each grid LINE by a hash of its own index gives every
//             cell a different width while staying closed-form — no loop, no
//             neighbour search — and continuous across the boundary between two
//             separate meshes. Returns (cell index, 0..1 across the cell, cell
//             width in metres).
//             THE CORRECTION STEP IS LOAD-BEARING: floor(x/sc) names the cell of
//             the UNJITTERED lattice, and once a boundary has moved, the
//             fragments in the band between the old line and the new one belong
//             to the PREVIOUS cell. Without the fixup they get a negative `t`
//             and read as a stripe of a foreign panel's tone.
//   mbGroove  a coverage-correct groove with a clean LOD exit.
//   mbFade    the exit itself: below a pixel a feature fades to NOTHING rather
//             than dithering. An 18 mm seam sampled at 200 mm per pixel is
//             aliasing crawl, and the honest answer to a feature smaller than a
//             pixel is to stop drawing it. This is not optional — it is what
//             stops a world-space detail layer becoming the crawl it was added
//             to avoid.
//
// Nothing here is a colour, a scale or a material: the caller passes the panel
// size, the jitter and the feature size, and what those numbers MEAN — a 0.40 m
// print pass, a 2.4 m feedstock session, a 3 m formwork bay — is the caller's
// art direction and stays with it.
//
// THE `mb` PREFIX STAYS. These are GLSL identifiers that appear in the final
// shader text, and the parity baseline for the move that published them is
// byte-for-byte. Renaming them is a change of its own, not a tidy-up beside
// a move. Arrived from a base-building game's structures module.
export const PANEL_PARS = /* glsl */ `
float mbHash( vec2 p ) {
  vec3 q = fract( p.xyx * vec3( 0.1031, 0.1030, 0.0973 ) );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
vec3 mbSplit( float x, float sc, float jit ) {
  float i = floor( x / sc );
  float b0 = ( i + jit * ( mbHash( vec2( i, 7.0 ) ) - 0.5 ) ) * sc;
  if ( x < b0 ) {
    i -= 1.0;
    b0 = ( i + jit * ( mbHash( vec2( i, 7.0 ) ) - 0.5 ) ) * sc;
  }
  float b1 = ( i + 1.0 + jit * ( mbHash( vec2( i + 1.0, 7.0 ) ) - 0.5 ) ) * sc;
  float w = max( 1e-3, b1 - b0 );
  return vec3( i, ( x - b0 ) / w, w );
}
// Coverage-correct groove, and a clean LOD exit. Below a pixel the term fades
// to nothing instead of dithering: an 18 mm seam sampled at 200 mm per pixel is
// aliasing crawl, which the art direction bans outright, and the honest answer to a
// feature smaller than a pixel is to stop drawing it.
float mbGroove( float d, float halfW, float px ) {
  float fade = 1.0 - smoothstep( halfW * 0.7, halfW * 3.5, px );
  return fade * ( 1.0 - smoothstep( halfW - px, halfW + px, d ) );
}
float mbFade( float feature, float px ) {
  return 1.0 - smoothstep( feature * 0.7, feature * 3.5, px );
}
`;
