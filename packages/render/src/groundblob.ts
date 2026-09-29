/**
 * ============================================================================
 *  groundblob.ts — the layer of ground blobs. One instanced draw, whatever
 *  the population, and nothing in a scene floats without one.
 * ============================================================================
 *
 * A blob is a unit quad lying in the ground plane with a radial falloff sprite
 * on it. Two things are built out of exactly this machinery and they are the
 * same machinery:
 *
 *   · a CONTACT SHADOW — the soft dark patch that tells the eye an object is
 *     resting on the surface rather than hovering a hand's width above it;
 *   · a POOL OF BOUNCED LIGHT — the same quad, additive, wider and softer,
 *     drawn UNDER the shadow so the shadow's core still reads. An emissive
 *     object with a hole punched in the ground beneath it and nothing else is
 *     half a lighting event.
 *
 * It stood in the projectile code of a kart racer and of a space racer, seven
 * layers between them, and the two copies agreed line for line on the geometry,
 * the material, the instancing, the count management and the dispose. They
 * disagreed on FOUR THINGS, every one of them a number a game supplies, and
 * every one of them is a REQUIRED field of `BlobSpec` below rather than a
 * default — because four of those seven construction sites did not spell their
 * own colour, and a default would have handed one game the other's art
 * direction while looking completely fine.
 *
 * ---------------------------------------------------------------------------
 * THE TWO LIFTS, WHICH ARE THE WHOLE REASON THIS FILE IS CAREFUL
 * ---------------------------------------------------------------------------
 * A blob has to clear the surface it lies on or it z-fights with it. The two
 * games lift it along DIFFERENT AXES and both are right for their own world:
 *
 *   · along world +Y, which is what a game whose ground is broadly a floor
 *     wants — the lift is then independent of the local bank and a blob on a
 *     45° camber still sits the same visual distance off the road;
 *   · along the SURFACE NORMAL, which is what a game with an INVERSION needs.
 *     Where the deck's normal points down, a blob lifted along +Y sinks
 *     straight through the plate it is supposed to be lying on.
 *
 * So there are two lifts and a game supplies both. It is not a mode: a game
 * that wants world-Y lift passes `liftNormal: 0`, and the arithmetic below is
 * then exactly the expression that game shipped, to the bit.
 *
 * ---------------------------------------------------------------------------
 * WHY `liftNormal !== 0` IS A GUARD AND NOT AN OPTIMISATION
 * ---------------------------------------------------------------------------
 * `-0 + 0` is `+0`. Adding a zero-scaled normal to a coordinate that happens to
 * be `-0` therefore does not leave that coordinate alone — it changes the sign
 * of a zero, which changes an element of the instance matrix, which is a real
 * difference to a bit-exact comparison and to nothing else. BOTH lifts are
 * guarded, for the same reason in both directions: a game lifting along the
 * normal must not have `y` touched, and a game lifting along +Y must not have
 * `x` and `z` touched. The guard is what makes "supply zero" mean "do not touch
 * it" rather than "add nothing, nearly". Deleting either costs no frame and
 * breaks the receipt; that is precisely the kind of tidy-up this repository's
 * comments exist to stop.
 */
import * as THREE from 'three';
import { radialSprite } from './bodykit.js';

/**
 * One blob layer, fully specified. EVERY FIELD IS REQUIRED and that is the
 * point of the file: a game that forgets one fails to compile, where a game
 * that gets a default gets somebody else's art direction and looks fine.
 */
export interface BlobSpec {
  /** albedo for a shadow layer, emissive tint for an additive one */
  color: number;
  opacity: number;
  /** falloff exponent of the radial sprite — higher = tighter core */
  gamma: number;
  /** flat centre fraction before the falloff starts */
  inner: number;
  additive: boolean;
  /** metres of lift along world +Y */
  liftY: number;
  /** metres of lift along the surface normal handed to `add` */
  liftNormal: number;
  renderOrder: number;
  /** the mesh's name, which is what a scene dump and a probe read it by */
  name: string;
  /** a contact shadow is not tone-mapped; a light pool generally is not either */
  toneMapped: boolean;
}

// Scratch, module-level and shared: `add` is called once per instance per
// frame and allocating four objects a call is four objects a call for the
// collector to sweep.
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _pos = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly max: number;
  private readonly liftY: number;
  private readonly liftNormal: number;

  constructor(max: number, spec: BlobSpec) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: spec.color,
      map: radialSprite(64, spec.inner, spec.gamma),
      transparent: true,
      opacity: spec.opacity,
      depthWrite: false,
      blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: spec.toneMapped,
    });
    this.liftY = spec.liftY;
    this.liftNormal = spec.liftNormal;
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = spec.renderOrder;
    this.mesh.count = 0;
    this.mesh.name = spec.name;
  }

  begin() { this.n = 0; }

  /**
   * `width` is the full span of the blob in metres, not its radius.
   *
   * The quad is ORIENTED to the normal in both games and always was; only the
   * LIFT differed. See the header for why there are two of those and why the
   * zero case is guarded rather than added.
   */
  add(x: number, y: number, z: number, normal: THREE.Vector3, width: number) {
    if (this.n >= this.max) return;
    _q.setFromUnitVectors(UP, normal);
    _pos.set(x, y, z);
    if (this.liftY !== 0) _pos.y += this.liftY;
    if (this.liftNormal !== 0) _pos.addScaledVector(normal, this.liftNormal);
    _s.set(width, 1, width);
    _m.compose(_pos, _q, _s);
    this.mesh.setMatrixAt(this.n++, _m);
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
