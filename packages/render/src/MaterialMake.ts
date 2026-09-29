/**
 * ============================================================================
 *  A generated map set, wired onto a three material.
 * ============================================================================
 *  `standardFrom` and `physicalFrom` were `Materials.std` and `Materials.phys`
 *  — private methods on the material library in a kart racer and in a
 *  space racer, byte-identical in both, and NEITHER OF THEM TOUCHED `this`.
 *  A method with no receiver is a function with a longer name, and two copies
 *  of one is the shape that lets a fix land in one game and not the other.
 *
 *  What they encode is the map-set convention every generator in both games
 *  already follows and none of them states: ORM packed into ONE texture read
 *  three ways (R=AO, G=roughness, B=metalness), with `roughness` and
 *  `metalness` left at 1 so the map is the value rather than a modulation of
 *  a scalar somebody forgot to set. Getting that wrong gives a material that
 *  looks nearly right and is uniformly too smooth, which is the art
 *  direction's constant-roughness fail arriving by accident.
 *
 *  `o` is spread LAST and that ordering is the whole flexibility: a caller
 *  overrides any of it — envMapIntensity, a colour, transmission — without the
 *  function needing to know the list.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';
import type { MapSet } from './Textures.ts';

/** Wire a standard material to a generated map set with sane defaults. */
export function standardFrom(m: MapSet, o: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: m.map,
    normalMap: m.normalMap,
    roughnessMap: m.ormMap,
    metalnessMap: m.ormMap,
    aoMap: m.ormMap,
    roughness: 1,
    metalness: 1,
    ...o,
  });
  return mat;
}

export function physicalFrom(m: MapSet, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: m.map,
    normalMap: m.normalMap,
    roughnessMap: m.ormMap,
    metalnessMap: m.ormMap,
    aoMap: m.ormMap,
    roughness: 1,
    metalness: 1,
    ...o,
  });
}
