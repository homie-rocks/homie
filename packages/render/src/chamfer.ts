/**
 * ============================================================================
 *  chamfer — the specular line down a bevelled edge, found from curvature.
 * ============================================================================
 *
 * PUBLISHED FROM A SPACE RACER, NOT DE-DUPLICATED. Only one game had written
 * this; nothing was removed from a second copy, because there was no second
 * copy. It is here because this package is a library of good things and the
 * next machine somebody builds should catch its own edges rather than
 * rediscover the curvature trick. A package knowing what a bevel looks like is
 * not a package knowing what a game contains.
 *
 * The doc comment below is the game's own, because it is the argument for the
 * two constants in the window and it does not survive paraphrase. Where it
 * quotes the art direction or a ship's numbers, that is one game's spec and is
 * labelled as such. THE REASONING is what the comment is for and it holds on
 * any bevelled surface anywhere.
 *
 * ----------------------------------------------------------------------------
 *
 * WHY THE BEVEL WAS THERE AND NOTHING WAS LIGHTING IT.
 *
 * That game's art direction makes an 8–25 mm chamfer mandatory on every edge
 * and omitting one an automatic fail, and the geometry has always had them —
 * the hull mesher's ring radius IS that chamfer and no builder leaves it at
 * zero. A review still came back with "not one chamfer in 44 frames carries a
 * specular line", and the reason is not the geometry. It is that a chamfer at
 * the hull's own roughness catches exactly the same broad, dim GGX lobe the
 * flat panel beside it does.
 *
 * The arithmetic: the key is a 0.18° disc. A surface at roughness 0.38 has a
 * GGX lobe about 25° wide, so it smears that 0.18° source across a cone 140x
 * wider than the source and the "highlight" arrives as a low, even wash. The
 * panel and the bevel return the same wash, so the bevel disappears — which
 * reads on screen exactly like an unchamfered edge and scores as one.
 *
 * What makes a real bevel snap is that it is not the same surface as the panel.
 * It is a machined or burnished band: the tool has been over it, the coating is
 * thinner on a radius than on a flat (paint pulls away from convex curvature as
 * it flows), and on a worked machine it is the first thing to be polished by
 * contact. So it is GLOSSIER and, where there is paint at all, closer to bare
 * metal. Give it those two properties and the 0.18° source returns a hard bright
 * line down every silhouette — which is the whole reason the chamfer is asked
 * for.
 *
 * FINDING THE BAND WITHOUT A SECOND ATTRIBUTE.
 *
 * The honest mask is surface curvature in WORLD units — radians of turn per
 * metre — and it is available for the price of two derivative pairs:
 *
 *     curv = |dN/ds| = ||dFdx N, dFdy N|| / ||dFdx P, dFdy P||
 *
 * A 22 mm chamfer is 45 rad/m. A 10 mm trim chamfer is 100. A hull's gross form
 * (a metre-scale loft) is about 1, and a 340 mm barrel fillet is 2.9 — so a
 * window at 5–22 rad/m separates "chamfer" from "shape" cleanly and by a wide
 * margin, on every ship, with no per-ship tuning and no baked channel.
 *
 * It is also self-limiting at distance, which a screen-space normal-variance
 * mask is not: once the chamfer is under a pixel the numerator saturates at the
 * total turn while the denominator keeps growing with the footprint, so `curv`
 * falls and the term fades out on its own. That is the correct behaviour and it
 * is why this is measured against dP rather than left in screen space — a mask
 * that got STRONGER as the ship got smaller would turn a 40 m rival into a
 * glitter ball, which is the exact failure `addSpecularAA` exists to suppress.
 *
 * Cost: four derivatives and ~14 ALU, on ONE mesh per ship. The hull materials
 * carry no `addSpecularAA`, so nothing here is fighting a term that raises
 * roughness for the opposite reason.
 *
 * ----------------------------------------------------------------------------
 *
 * ## The curvature window is NOT a parameter, and that is deliberate
 *
 * 5 and 22 rad/m stay in this file. They are not a look: they are the two edges
 * of the gap between "this is a machined bevel" and "this is the gross form of
 * the object", and the paragraph above measures that gap on real geometry and
 * finds it wide. A caller handed a knob there would be tuning the DEFINITION of
 * an edge per material, which is how a shared solve becomes eight solves. The
 * two numbers that ARE a look — how glossy the band goes and how far toward
 * bare metal — are the caller's, because they are properties of the finish.
 */
import * as THREE from 'three';
import { chainPatch } from './chainpatch.js';

export interface ChamferOpts {
  /** roughness the band is floored to — the tightness of the line */
  gloss: number;
  /** how far toward bare metal the band goes, 0..1 */
  bare: number;
}

/**
 * Give a material's high-curvature bands their own gloss and their own metal.
 *
 * Injected BEFORE `<normal_fragment_maps>` so the mask is read off the geometry
 * and never off a normal map. See the note inside.
 */
export function addChamferSpecular(m: THREE.MeshPhysicalMaterial, o: ChamferOpts): void {
  // x,y = the curvature window in rad/m; z = the roughness floor; w = the
  // metal bias. One vec4 rather than four uniforms so the injection is one
  // upload per material.
  const uChamfer = { value: new THREE.Vector4(5.0, 22.0, o.gloss, o.bare) };
  chainPatch(m, `chamfer${o.gloss.toFixed(3)}_${o.bare.toFixed(3)}`, (shader) => {
    shader.uniforms.uChamfer = uChamfer;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec4 uChamfer;\nvoid main() {')
      .replace(
        '#include <normal_fragment_maps>',
        [
          // Injected BEFORE the normal map is applied, so the mask is read off
          // the geometry's own normal (`nonPerturbedNormal`, set at the end of
          // `normal_fragment_begin`) and cannot be manufactured by a panel-line
          // relief in the tangent-space map. A normal map's creases are not
          // chamfers and must not be lit as if they were.
          '{',
          '  vec3 dNx = dFdx( nonPerturbedNormal );',
          '  vec3 dNy = dFdy( nonPerturbedNormal );',
          '  vec3 dPx = dFdx( vViewPosition );',
          '  vec3 dPy = dFdy( vViewPosition );',
          '  float turn = sqrt( dot( dNx, dNx ) + dot( dNy, dNy ) );',
          '  float span = sqrt( dot( dPx, dPx ) + dot( dPy, dPy ) );',
          '  float edge = smoothstep( uChamfer.x, uChamfer.y, turn / max( 1e-4, span ) );',
          // min(), not a straight lerp: a hull that is already glossier than
          // the floor (one hull sits at 0.11) must not be ROUGHENED by its own
          // bevel.
          '  roughnessFactor = mix( roughnessFactor, min( roughnessFactor, uChamfer.z ), edge );',
          // The art direction: "zinc primer, exposed — 3 % coverage,
          // CONCENTRATED ON LEADING EDGES". The band is where a painted hull is
          // first worn back to the substrate, so the edge is also where
          // metalness climbs. Scaled by the ship's own primer coverage, so a
          // gapless poured surface gets none of this and a fully primed hull
          // gets all of it.
          '  metalnessFactor = mix( metalnessFactor, 1.0, edge * uChamfer.w );',
          '}',
          '#include <normal_fragment_maps>',
        ].join('\n'),
      );
  });
}
