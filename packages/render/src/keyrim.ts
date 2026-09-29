/**
 * ============================================================================
 *  The key's rim — the third light of a three-point rig, as GLSL.
 * ============================================================================
 *
 * The sky modules of a kart racer and of a space racer are forks of each other,
 * and this function was character-for-character the same in both: the same five
 * statements, the same grazing exponent, the same floor mask, the same
 * roughness rolloff. What differed was its NAME — one game calls its key a sun
 * and the other a star — and TWO NUMBERS, both of which the game still owns and
 * still passes in.
 *
 * ## What this is, and what it is deliberately not
 *
 * Not a physical term and not pretending to be. It is the third light of a
 * three-point rig expressed as a function of GEOMETRY rather than as another
 * DirectionalLight, because a rim that is a light has to be re-aimed every time
 * the subject turns and both games have eight subjects. It is driven by the
 * key's ALREADY SHADOWED radiance, which is what makes it vanish in shadow —
 * inside a tunnel in one game, inside the eclipse and an enclosed bay in the
 * other — exactly as a real one would, with nothing per-game to switch it off.
 *
 * THE `lit` FACTOR IS WHAT KEEPS IT HONEST. The rim appears only on the edge
 * turned TOWARD the key, so a machine with the key behind it gets a hot outline
 * and one driving into the key gets none, which is the correct read. A rim that
 * ignores `lit` is a white outline drawn round everything.
 *
 * THE FLOOR MASK IS NOT COSMETIC, and it is the one part of this that looks
 * removable. Vectors here are VIEW space, so the world-up component has to be
 * recovered from the view matrix. Without the mask, every ground fragment past
 * about twelve metres is grazing and the rim stops being a rim: it becomes a
 * second, uncontrolled specular smeared over the whole carriageway. Both games
 * measured that, and the one with a 6.5° key measured it WORSE than the one
 * with a 14° key, which is why the mask is here rather than in either.
 *
 * ## Which numbers are here and which are the game's
 *
 * `strength` and `power` are the caller's, because they are a look: one game
 * derives its strength from a peak radiance divided by its star's intensity,
 * the other states 0.21 flat. The three constants that stay — the 0.25/0.95
 * smoothstep of the mask and the 0.65 roughness rolloff — were the same value
 * in both AND are properties of the CONSTRUCTION rather than of the world: the
 * first is where a surface stops being a silhouette edge and starts being
 * ground, the second is that a rough surface has no coherent grazing lobe to
 * carry a rim. Neither is a taste.
 *
 * ## `krKeyRim` is the name in both games now
 *
 * The two forks had `krSunRim` and `krStarRim`. The identifier is declared and
 * called inside one generated chunk and appears nowhere else, so the rename
 * changes no program either driver compiles — but leaving it as a parameter
 * would have been a knob with no reason to be turned.
 *
 * This returns TEXT, not a chunk: `saturate` and `viewMatrix` are the caller's,
 * declared in the same chunk above it. It is a fragment of somebody else's.
 */

import { glslFloat } from './cascade.js';

/**
 * @param strength peak rim radiance as a multiple of the key's own colour
 * @param power    grazing exponent; higher is a narrower edge
 */
export function keyRimGlsl(strength: number, power: number): string {
  const F = glslFloat;
  return /* glsl */`
vec3 krKeyRim( const in vec3 lightColor, const in vec3 lightDir,
	const in vec3 N, const in vec3 V, const in float rough ) {
	float graze = 1.0 - saturate( dot( N, V ) );
	float lit = saturate( dot( N, lightDir ) );
	float worldY = dot( N, vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] ) );
	float mask = 1.0 - smoothstep( 0.25, 0.95, worldY );
	float k = ${F(strength)} * pow( graze, ${F(power)} ) * lit * mask;
	return lightColor * ( k * ( 1.0 - 0.65 * rough ) );
}
`;
}
