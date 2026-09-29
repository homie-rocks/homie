/**
 * ============================================================================
 *  extrude — a closed profile pulled along an axis with a TRUE CHAMFER.
 * ============================================================================
 *  `THREE.ExtrudeGeometry` already does the pull. What is here is the four
 *  decisions around it that every caller gets wrong the same way, and the one
 *  that is not obvious:
 *
 *   1. `bevelSegments: 1` IS A CHAMFER; 2 OR MORE IS A FILLET. One segment
 *      leaves a flat facet with two hard arrises, which is what a folded or
 *      brake-pressed edge physically is. Two or more rounds it, and a rounded
 *      edge on a form whose whole design language is flat panels reads worse
 *      than no edge treatment at all. It is the default here and it is a
 *      parameter, because a moulded form genuinely wants the fillet.
 *   2. `depth` IS NOT `width`. The bevel adds `bevelThickness` at BOTH ends, so
 *      a caller asking for a 2 m part and passing 2 m as the depth gets one
 *      2 m + 2·bevel long. Every caller wants the finished overall size, so
 *      that is what this takes and the subtraction happens once, here.
 *   3. IT IS CENTRED. three extrudes 0..depth in +Z; a part built about its own
 *      centre is the only kind that can be mirrored, instanced or rotated
 *      without every call site carrying a half-length offset.
 *   4. THE AXIS IS A YAW, not a swap. Profiles are naturally drawn in the plane
 *      a person sketches in — x across, y up — and the model's forward axis is
 *      whatever the rest of that directory uses. A yaw about Y after the
 *      extrusion re-aims it without touching the profile, so the drawing stays
 *      readable and the convention stays at the call site.
 *
 *  `computeVertexNormals()` at the end because the bevel's facets need their
 *  own normals and three's extruder does not split them.
 *
 *  WHAT IS NOT HERE: the profile. A silhouette is the most content-bearing
 *  thing a vehicle or a building has, and a package holding one would be a
 *  package that had picked a game.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';

export interface ChamferExtrudeOpts {
  /** FINISHED overall length along the extrusion axis, bevel included. */
  width: number;
  /** chamfer thickness and size, both — a 45° facet. */
  bevel: number;
  /** tessellation of any curve in the profile. 1 for a polygon. */
  curveSegments?: number;
  /** 1 for a chamfer, more for a fillet. See the header before raising it. */
  bevelSegments?: number;
  /** yaw about Y applied after centring, radians. Default `-PI/2`, i.e. the
   *  profile's +x becomes +Z. Pass 0 to leave the extrusion along +Z. */
  yaw?: number;
}

/** A closed polygon, in the profile plane. */
export function polyShape(pts: Array<[number, number]>): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  return shape;
}

export function chamferExtrude(shape: THREE.Shape, o: ChamferExtrudeOpts): THREE.BufferGeometry {
  const depth = o.width - o.bevel * 2;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: o.bevel,
    bevelSize: o.bevel,
    bevelOffset: 0,
    bevelSegments: o.bevelSegments ?? 1,
    curveSegments: o.curveSegments ?? 1,
  });
  g.translate(0, 0, -depth * 0.5);
  g.rotateY(o.yaw ?? -Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** `chamferExtrude` over a polygon, which is what most callers want. */
export function extrudePoly(
  pts: Array<[number, number]>,
  o: ChamferExtrudeOpts,
): THREE.BufferGeometry {
  return chamferExtrude(polyShape(pts), o);
}
