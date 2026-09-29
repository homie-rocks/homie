/*
 * ----------------------------------------------------------------------------
 *  SHADER CHUNKS — the GLSL that is plumbing rather than art direction.
 * ----------------------------------------------------------------------------
 *  A game's fragment shader IS its look and almost all of it stays in the game;
 *  `Plumes.ts` and `Motes.ts` both refuse to take one and say at length why.
 *  What lives here is the other kind: a paragraph of GLSL that names nothing
 *  anybody could photograph, that several shaders in several games have each
 *  written out for themselves, and that has exactly one correct spelling.
 *
 *  These are TEMPLATE FRAGMENTS, not a library the shader links against. WebGL1
 *  has no linker and three's `#include` resolves against a fixed chunk table, so
 *  the only honest mechanism is string interpolation at the call site — which
 *  also means what a game gets is visible in its own source rather than hidden
 *  behind a specifier.
 * ----------------------------------------------------------------------------
 */

/**
 * A HEXAGONAL GRID, as a distance field over a 2D coordinate.
 *
 * `hexCell` folds a uv into the nearest cell's local frame — the two candidate
 * lattices of a hex packing are the two `mod`s, and the nearer one wins — and
 * `hexDist` is the distance to that cell's boundary, so `smoothstep` over it
 * gives an EDGED grid rather than a filled one. A filled hex grid is a texture;
 * an edged one is a structure.
 *
 * 1.7320508 is sqrt(3), the row pitch of a unit-radius hex packing. Nothing
 * here has a scale, a colour, an animation or an opinion: the caller decides the
 * cell pitch by what it multiplies its uv by, and the edge width by where it
 * puts the smoothstep.
 *
 * Splice it above `main()`. Lifted out of a space racer's shield shell, where
 * it was the only part of that shader a reader could not attribute to the game.
 */
export const HEX_GRID = /* glsl */ `
vec2 hexCell(vec2 uv) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  return dot(a, a) < dot(b, b) ? a : b;
}
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}`;

/**
 * THE PER-FRAGMENT REINHARD SHOULDER every additive surface in this codebase
 * uses: compress the MAX channel and scale all three by it, so overlapping
 * sprites asymptote instead of summing and a saturated hue never desaturates to
 * white on the way up.
 *
 * Counted 2026-08-22: eight copies of these two lines, across four games and two
 * package modules, each with its own knee and its own local name. The knee IS
 * the art direction — it is fitted against a specific bloom gate and a specific
 * emissive ladder, and `Trails.ts` and `ParticleShader.ts` take theirs as a
 * uniform for exactly that reason — so it is an argument and there is no
 * default. The two lines are not.
 *
 * `tmp` is the local the caller wants declared, because these lines land inside
 * a `main()` that may already have a `mx` in it, and a redeclaration is a
 * compile error a person reads as "the package broke my shader".
 *
 * The emitted text is byte-for-byte what the eight sites already wrote, so
 * adopting it moves no pixel — which a parity test checks by comparing both
 * games' whole fragment shader strings.
 */
export const shoulder = (rgb: string, tmp: string, knee: string) =>
  `  float ${tmp} = max(max(${rgb}.r, ${rgb}.g), ${rgb}.b);\n`
  + `  ${rgb} *= ${tmp} > 1e-4 ? 1.0 / (1.0 + ${tmp} * ${knee}) : 1.0;`;
