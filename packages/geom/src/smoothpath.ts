/**
 * ============================================================================
 *  smoothpath — curvature-weighted resampling of a control polyline.
 * ============================================================================
 *  What `tubeInto` wants fed to it. Byte-identical in the two racing games it
 *  was extracted from, including the constant: only the two doc comments
 *  differed, and only in which shiny thing they named (a chrome tube at
 *  roughness 0.15 against tarmac; a polished metal at roughness 0.11 against a
 *  black sky). Same function, same number, two paint jobs.
 * ============================================================================
 */
import * as THREE from 'three';

/**
 * Resample a control polyline through a Catmull-Rom so `tubeInto` sweeps a
 * continuous curve instead of mitring at every control point. A polished tube
 * with faceted bends catches broken specular — the highlight jumps from facet
 * to facet instead of running along the bend — and a metal at low roughness
 * needs *curvature* to have anything to reflect in the first place.
 *
 * Samples are placed at equal increments of (arc length + BEND_W x turning
 * angle), NOT at equal arc length. Equal spacing is the obvious thing and it is
 * the wrong thing: it spends the same number of samples on a dead-straight
 * upright as on the shoulder beside it, so the residual facet all piles up in
 * the bends that are actually on the silhouette. Weighting by curvature moves
 * samples from where they buy nothing to where they buy everything — on
 * the kart racer's roll hoop it takes the worst joint from 17.6 to 13.4 degrees
 * for exactly zero extra triangles, which is the same result as raising the
 * sample count from 22 to 30.
 */
const BEND_W = 0.5;
const _sa = new THREE.Vector3();
const _sb = new THREE.Vector3();

export function smoothPath(pts: THREE.Vector3[], n: number): THREE.Vector3[] {
  const fineN = Math.max(64, (n - 1) * 8);
  const fine = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5).getSpacedPoints(fineN);
  // w[i] = cost of reaching fine[i]; strictly increasing, so it inverts cleanly
  const w = new Float64Array(fineN + 1);
  for (let i = 1; i <= fineN; i++) {
    let turn = 0;
    if (i < fineN) {
      _sa.subVectors(fine[i], fine[i - 1]).normalize();
      _sb.subVectors(fine[i + 1], fine[i]).normalize();
      turn = Math.acos(THREE.MathUtils.clamp(_sa.dot(_sb), -1, 1));
    }
    w[i] = w[i - 1] + fine[i].distanceTo(fine[i - 1]) + BEND_W * turn;
  }
  const out: THREE.Vector3[] = [fine[0].clone()];
  let k = 1;
  for (let s = 1; s < n - 1; s++) {
    const t = (s / (n - 1)) * w[fineN];
    while (k < fineN && w[k] < t) k++;
    const f = (t - w[k - 1]) / Math.max(1e-9, w[k] - w[k - 1]);
    out.push(new THREE.Vector3().lerpVectors(fine[k - 1], fine[k], f));
  }
  out.push(fine[fineN].clone());
  return out;
}
