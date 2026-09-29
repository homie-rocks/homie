/**
 * ============================================================================
 *  kartlod.ts — the draw-call budget keeper both racers run, once.
 * ============================================================================
 *
 * The draw-budget modules of a kart racer and of a space racer were the same
 * machine. Not "similar": the governor, the hysteresis band, the frustum-padded
 * shadow relevance test, the two impostor poses, the re-bind identity check and
 * the `userData` walk were the same statements in the same order, and the class
 * body from `interface KartLod` to the closing brace matched line for line for
 * ninety-four consecutive substantive lines.
 *
 * ## What actually differed: SEVEN NUMBERS, and every one is a LENGTH IN METRES
 *
 *   |                  | kart racer  | space racer  |
 *   |------------------|-------------|--------------|
 *   | `lodSwap`        | 20          | 45           |
 *   | `lodKeep`        | 17          | 38           |
 *   | `lodSwapLow`     | 13          | 28           |
 *   | `lodKeepLow`     | 11          | 23           |
 *   | `shadowSlack`    | 8.0         | 14.0         |
 *   | `hullRadius`     | 1.4         | 5.2          |
 *   | `shadowMax`      | 85          | 220          |
 *
 * A kart is 2.1 m long and closes at 30 m/s; a ship is 8.0–10.2 m long and
 * closes at 142. The key light is 14 degrees up in one game and 6.5 in the
 * other, so the same hull lays a 6 m shadow or a 13 m one and the frustum
 * padding has to cover it. **The distances are the same derivation run against
 * a different vehicle** — which is why they belong in the games, beside the
 * paragraphs that derive them, and the machine belongs here.
 *
 * `governorFloor` is 0.55 in both and is a tuning field anyway, because a
 * number that happens to agree today is not a number that is shared.
 *
 * ## Ctx does not cross this seam
 *
 * `LodWorld` below is the complete list of what the budget keeper READS off a
 * game's frame context — five fields, no more. Both games' `Ctx` satisfies it
 * structurally and neither call site changed. This package must never learn
 * what a race is, what an item is or what a lap is.
 *
 * `Quality` is the one exception and it is not one: it already lives in
 * `@homie-rocks/render/caps.ts`, and both games re-export it from their own
 * `types.ts` (`import { Quality } from '@homie-rocks/render/caps.js'`). Comparing
 * against it here reaches for this package's own module, not a game's.
 *
 * ## The one BEHAVIOUR that differed, and it was a bug in one of them
 *
 * The space racer's `bind()` publishes the recorded state onto the mesh — five
 * assignments — and the kart racer's does not. That is a shadow fix the space
 * racer made, and the reasoning is reproduced verbatim on `bind()` below.
 *
 * It is a no-op on a FIRST bind in either game, because `buildKart` leaves
 * every impostor `castShadow = true`, in the shadow-only pose, with every
 * detail node visible — exactly the state `{ near: true, casting: true }`
 * records. It stops being a no-op on a RE-BIND, which is precisely the case it
 * was written for. So the kart racer gains the fix, and this is stated out loud
 * rather than smuggled: a parity probe pins the corrected behaviour with its
 * own fault (`rebind-assumed`) so the regression cannot come back quietly, and
 * pins the pre-move behaviour of everything else exactly.
 *
 * A FLAG choosing between the two was considered and rejected. A flag selecting
 * between two behaviours inside a shared function is the tell that they were
 * never one thing — and here they genuinely are one thing, because one side of
 * the flag would be "keep the defect".
 */
import * as THREE from 'three';
import { Quality } from './caps.ts';
import { registerPrewarm } from './Prewarm.ts';

/**
 * Everything the budget keeper reads off a frame. This is the whole seam.
 *
 * `camera` is `THREE.Camera` rather than `PerspectiveCamera` on purpose: the
 * three members used — `projectionMatrix`, `matrixWorldInverse`, `position` —
 * are all on the base, and a package that demands a perspective camera has
 * taken a position on how a game is framed.
 */
export interface LodWorld {
  /** seconds since the previous frame, already clamped upstream. */
  dt: number;
  camera: THREE.Camera;
  /** only `environmentIntensity` is read, and only to hand it back out. */
  scene: { environmentIntensity: number };
  settings: { quality: Quality; shadows: boolean };
  /** the field. `null`/absent before the grid is built, which is a normal frame. */
  race?: { karts: readonly { object: THREE.Object3D }[] } | null;
}

/** The seven metres, the floor, and the game's own environment hook. */
export interface LodTuning {
  /** distance a vehicle collapses to its merged bake at, metres, Quality.High+ */
  lodSwap: number;
  /** distance it comes back at. Strictly below `lodSwap`; the gap is hysteresis. */
  lodKeep: number;
  /** the same pair below Quality.High — the same look at half the pixel count. */
  lodSwapLow: number;
  lodKeepLow: number;
  /**
   * how far outside the frustum a vehicle can be and still cast a shadow the
   * camera would see, metres. Sized off the KEY LIGHT'S ELEVATION, not off the
   * vehicle: a hull of height h lays its shadow h / tan(elevation) along the
   * ground, so this moves when the sun moves and not when the car does.
   */
  shadowSlack: number;
  /** bounding radius for the frustum test, metres. Half the longest hull. */
  hullRadius: number;
  /** hard distance cap on vehicle shadows, metres. Sized off the cascades. */
  shadowMax: number;
  /** how far the frame-time governor may pull every distance in. 0..1. */
  governorFloor: number;
  /**
   * Called once per `lateUpdate` with `scene.environmentIntensity`.
   *
   * Both games key their vehicle materials to it with a render hook that hangs
   * off the body-paint mesh — which stops firing the moment that mesh is hidden
   * by the LOD swap, i.e. exactly when this system is the reason it is hidden.
   * Both implementations early-out on an unchanged value, so it is one float
   * compare in the common case.
   */
  syncEnv(intensity: number): void;
}

interface KartLod {
  root: THREE.Object3D;
  impostor: THREE.Mesh;
  detail: THREE.Object3D[];
  /**
   * The two poses of the merged bake, resolved once at bind rather than looked
   * up out of `userData` on every swap. `shadowMat` is the invisible-but-
   * casting pose used while the detail meshes are what the camera sees;
   * `bakeMat` is the lit pose used once the vehicle has collapsed to the bake.
   */
  shadowMat: THREE.Material;
  bakeMat: THREE.Material;
  /** true while the detail meshes are the ones being drawn */
  near: boolean;
  casting: boolean;
}

const _sphere = new THREE.Sphere();
const _pos = new THREE.Vector3();

/**
 * The budget keeper. Subclass it with the game's numbers; in either racer the
 * subclass is now the constants, their derivations, and eleven lines.
 *
 * Runs in `lateUpdate` and must be registered AFTER the chase camera, because
 * every decision it makes is measured from the camera the chase rig has just
 * finished posing.
 */
export class KartLodBudget {
  /** Debug switch: off restores the un-LODed field. */
  enabled = true;
  private lods: KartLod[] = [];
  /**
   * Identity of the field the LOD list was built from. Not just the count: a
   * rebuilt grid of the same size has to re-bind or this holds handles into
   * models that are no longer in the scene.
   *
   * Held as two fields rather than as a joined string. It is compared on every
   * frame, and building `count + ':' + uuid` to compare it allocated a string
   * per frame for the whole race — the only allocation left in this file, and
   * the art direction asks for none.
   */
  private boundCount = -1;
  private boundId = '';
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  /** smoothed frame time, seconds; drives the governor. */
  private smoothDt = 1 / 60;
  private governor = 1;

  constructor(protected readonly tuning: LodTuning) {}

  /** 1 = the authored distances, `governorFloor` = as tight as it will ever go. */
  get lodGovernor() { return this.governor; }

  /**
   * Bind at boot rather than waiting for the first frame, for one reason: the
   * shader pre-warm runs immediately after every system's `init`, and the two
   * materials the impostor swaps between are reachable from `root.userData`
   * only — they hang off no mesh in the scene, so the pre-warm's scene walk
   * cannot see them.
   *
   * Today that is harmless: measured over a 45 s race the program cache holds
   * flat at 83 and the LOD swap compiles nothing, because the impostor's
   * program key collides with one the field already has. But that is an
   * accident of what the vehicles happen to be made of, not a property anybody
   * stated, and the failure mode if it ever stops being true is the worst one
   * in the game — a synchronous compile on the frame a rival crosses the swap
   * ring, which is the "screen flashes black" mechanism Prewarm.ts documents.
   * Registering costs nothing when the pass finds the program already built,
   * and it also covers the re-warm after a WebGL context restore.
   */
  init(w: LodWorld) {
    const karts = w.race?.karts;
    // `first` rather than `karts[0]` only because this package compiles under
    // `noUncheckedIndexedAccess` and the games do not. Same guard, same value:
    // the length test above is what makes it present in both spellings.
    const first = karts && karts.length ? karts[0] : undefined;
    if (karts && first) this.bind(karts, karts.length, first.object.uuid);
  }

  lateUpdate(w: LodWorld, dt = w.dt) {
    // See `LodTuning.syncEnv`: the hook this replaces stops firing exactly when
    // this system hides the mesh it hangs off.
    this.tuning.syncEnv(w.scene.environmentIntensity);

    if (!this.enabled) return;
    const karts = w.race?.karts;
    if (!karts || !karts.length) return;
    const first = karts[0];
    if (!first) return;   // unreachable past the length test; see `init`.
    const id = first.object.uuid;
    if (this.boundCount !== karts.length || this.boundId !== id) {
      this.bind(karts, karts.length, id);
    }
    if (!this.lods.length) return;

    const t = this.tuning;

    // --- frame-time governor ------------------------------------------------
    // `dt` arrives already clamped to 1/20 upstream, which is what we want: this
    // has to chase a sustained deficit, not a single stall.
    if (dt > 0) {
      this.smoothDt += (dt - this.smoothDt) * Math.min(1, dt * 2.5);
      const HOT = 1 / 55, COOL = 1 / 68;
      if (this.smoothDt > HOT) this.governor = Math.max(t.governorFloor, this.governor - dt * 0.8);
      else if (this.smoothDt < COOL) this.governor = Math.min(1, this.governor + dt * 0.06);
    }

    const q = w.settings.quality;
    const g = this.governor;
    const swap = (q >= Quality.High ? t.lodSwap : t.lodSwapLow) * g;
    const keep = (q >= Quality.High ? t.lodKeep : t.lodKeepLow) * g;
    const shadowMax = t.shadowMax * g;
    const shadows = w.settings.shadows;

    const cam = w.camera;
    cam.updateMatrixWorld();
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);

    for (const lod of this.lods) {
      lod.root.getWorldPosition(_pos);
      const d = _pos.distanceTo(cam.position);

      // --- level of detail -------------------------------------------------
      const near = lod.near ? d < swap : d < keep;
      if (near !== lod.near) {
        lod.near = near;
        for (const n of lod.detail) n.visible = near;
        lod.impostor.material = near ? lod.shadowMat : lod.bakeMat;
        // The shadow-only pose wants to be last in the opaque queue so early-Z
        // eats it; the visible pose wants to sort normally with everything else.
        lod.impostor.renderOrder = near ? 4 : 0;
      }

      // --- shadow relevance ------------------------------------------------
      // Note this runs on the impostor whether or not it is the visible mesh:
      // it is the vehicle's only shadow caster in both states.
      let cast = shadows && d < shadowMax;
      if (cast) {
        _sphere.center.copy(_pos);
        _sphere.radius = t.hullRadius + t.shadowSlack;
        cast = this.frustum.intersectsSphere(_sphere);
      }
      if (cast !== lod.casting) {
        lod.casting = cast;
        lod.impostor.castShadow = cast;
      }
      // A near vehicle's merged mesh exists only to cast; if it is not casting
      // either, it is a rasterised-and-discarded draw call for nothing.
      lod.impostor.visible = !near || cast;
    }
  }

  dispose() {
    this.lods = [];
    this.boundCount = -1;
    this.boundId = '';
  }

  // -------------------------------------------------------------------------

  /**
   * Finds the model root inside each vehicle's scene node. `Kart` wraps the
   * built model in two groups of its own (`object` -> `visual` -> model root),
   * and neither the wrapper nor `IKart` exposes the model, so the handles are
   * picked up off the userData the builder leaves behind rather than by
   * widening a shared interface for a renderer-side concern.
   */
  private bind(karts: readonly { object: THREE.Object3D }[], count: number, id: string) {
    this.lods = [];
    this.boundCount = count;
    this.boundId = id;
    for (const k of karts) {
      k.object.traverse((o) => {
        const imp = o.userData?.impostor as THREE.Mesh | undefined | null;
        const detail = o.userData?.detailNodes as THREE.Object3D[] | undefined;
        if (!imp || !detail) return;
        // Both poses have to exist before this vehicle is allowed into the list.
        // Assigning `undefined` to `Mesh.material` does not fail here — it
        // fails inside `WebGLRenderer.render`, part-way through the opaque
        // queue, and everything after it in that queue is simply never drawn.
        // A half-drawn frame is indistinguishable from the black partial
        // renders being reported, so a vehicle missing either material keeps
        // all fifteen of its meshes rather than taking the whole frame down.
        const shadowMat = o.userData?.shadowOnlyMat as THREE.Material | undefined;
        const bakeMat = o.userData?.impostorMat as THREE.Material | undefined;
        if (!shadowMat || !bakeMat) return;
        registerPrewarm(bakeMat, { label: 'kart-impostor-bake' });
        registerPrewarm(shadowMat, { label: 'kart-impostor-shadow' });

        // PUBLISH THE RECORDED STATE RATHER THAN ASSUMING THE MODEL IS IN IT,
        // and this is the space racer's shadow fix rather than tidiness. The
        // kart racer did not have it before this module existed; see the file
        // header for why it takes it rather than being given a flag.
        //
        // `lateUpdate` writes `castShadow` and the LOD pose ONLY ON A CHANGE
        // against the two booleans below, which is correct and cheap — and it
        // is only correct if the booleans describe the mesh. At boot they do,
        // because `buildKart` leaves every impostor `castShadow = true` and
        // every detail node visible. On a RE-BIND they need not: this runs
        // whenever the field's count or identity changes (a restart, a rebuilt
        // grid), and a vehicle that was out of frustum at that moment is
        // sitting there with `castShadow = false` and its detail meshes hidden
        // while the fresh record says `casting: true, near: true`. The first
        // frame then computes `cast = true`, finds no change, writes nothing,
        // and that machine casts no shadow into any cascade for the rest of the
        // session — which is a review finding, verbatim, on every ship in
        // all 44 frames ("no ship casts a shadow onto the deck anywhere").
        // The same divergence on `near` hides a vehicle outright: detail meshes
        // left invisible, impostor in the shadow-only pose, nothing drawn.
        //
        // Five assignments at bind cost nothing and make the invariant the
        // change detection depends on true by construction.
        for (const n of detail) n.visible = true;
        imp.material = shadowMat;
        imp.renderOrder = 4;
        imp.castShadow = true;
        imp.visible = true;

        this.lods.push({
          root: o, impostor: imp, detail, shadowMat, bakeMat, near: true, casting: true,
        });
      });
    }
  }
}
