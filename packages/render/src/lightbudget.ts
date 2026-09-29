/**
 * ============================================================================
 *  lightbudget.ts — how many point lights the frame is allowed to have, and
 *  which one of them gets the shadow map.
 * ============================================================================
 *  Nothing in this was ever about a first-person shooter.
 *
 *  It lived in a first-person shooter's `DrawBudget` module under a name that
 *  already belonged to something else — a kart racer's `DrawBudget` is a
 *  level-of-detail governor for vehicles (`@homie-rocks/render/kartlod.ts`) and
 *  shares not one line with it. Two unrelated mechanisms wearing one name is
 *  precisely why repeated duplication-hunting scored this file zero: there was
 *  no second copy to trip a counter, and the one file with the same NAME is a
 *  different thing entirely.
 *
 *  What it actually does is a property of three.js and of a handheld GPU:
 *
 *   · A `PointLight` outside its own falloff radius contributes nothing and
 *     still costs a full lighting iteration in every fragment that survives
 *     the depth test, because three uploads the whole uniform array.
 *   · A point light's shadow is a CUBE — six render passes — so a second one
 *     is not a small increment, and the near one is the only one a person can
 *     see the contact of.
 *
 *  Any game with authored point lights in rooms wants exactly this. A
 *  base-building game, an interior walkthrough and a walking simulator would
 *  all rediscover it.
 *
 *  ---------------------------------------------------------------------------
 *  WHAT THE GAME STILL OWNS, and each is a NUMBER rather than a switch
 *  ---------------------------------------------------------------------------
 *   `slackNear` / `slackFar`  how far past its own radius a light stays lit,
 *                             in metres, handheld and not. This is a statement
 *                             about how big the rooms are.
 *   `shadowRange`             how close the one shadow caster has to be.
 *   `casters`                 how many shadowed point lights the tier allows.
 *
 *  No defaults, for the reason every spec in this repository states: a game
 *  that inherits one inherits another game's room size and looks fine doing it.
 *
 *  ---------------------------------------------------------------------------
 *  `Ctx` NEVER CROSSES THIS SEAM. `LightBudgetWorld` names the four fields the
 *  cull actually reads and each game's own `Ctx` satisfies it structurally, so
 *  no call site changes.
 * ============================================================================
 */
import * as THREE from 'three';

/** The four things the cull reads off a frame context. NOT `Ctx`. */
export interface LightBudgetWorld {
  scene: THREE.Object3D;
  camera: { position: THREE.Vector3 };
  settings: { shadows: boolean };
}

/** What a game must state. No optionals — see the header. */
export interface LightBudgetSpec {
  /** metres past a light's own `distance` it stays visible, on a handheld */
  slackNear: number;
  /** the same, on a desktop-class GPU */
  slackFar: number;
  /** metres inside which a light is allowed to keep its shadow cube */
  shadowRange: number;
  /** how many shadowed point lights the frame may carry at once */
  casters: number;
}

/**
 * Keeps the point-light count and the point-light shadow count inside budget.
 *
 * Run it in `lateUpdate`, AFTER the camera has been posed: every decision it
 * makes is a distance from a camera that has already moved this frame, and a
 * cull measured from last frame's camera pops a light on the frame the player
 * turns round.
 */
export class LightBudget {
  private readonly spec: LightBudgetSpec;
  private readonly lights: THREE.PointLight[] = [];
  private readonly shadowAble = new Set<THREE.PointLight>();
  private scanned = false;

  constructor(spec: LightBudgetSpec) {
    this.spec = spec;
  }

  /**
   * Forget the scan.
   *
   * The scan is a CACHE OF A FACT — which lights exist — and the rule is ask,
   * do not remember. It is cached anyway because a full `traverse` of a
   * built level every frame is the thing this class exists to avoid, so the
   * honest arrangement is a cache with a door on it: anything that adds or
   * removes a light calls this, and until it does the budget is answering
   * about a scene that has changed.
   */
  rescan(): void {
    this.scanned = false;
  }

  update(world: LightBudgetWorld, handheld: boolean): void {
    if (!this.scanned) {
      this.lights.length = 0;
      this.shadowAble.clear();
      world.scene.traverse((o) => {
        const l = o as THREE.PointLight;
        if (!l.isPointLight) return;
        this.lights.push(l);
        // Recorded BEFORE anything below touches `castShadow`, because after
        // the first frame `castShadow` is this class's own answer and reading
        // it back would let one dark frame permanently un-shadow a light.
        if (l.castShadow) this.shadowAble.add(l);
      });
      this.scanned = true;
    }

    const cam = world.camera.position;
    const slack = handheld ? this.spec.slackNear : this.spec.slackFar;
    let shadowLeft = world.settings.shadows ? this.spec.casters : 0;

    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i]!;
      const d = l.position.distanceTo(cam);
      l.visible = d < (l.distance || 16) + slack;
      if (this.shadowAble.has(l)) {
        const want = l.visible && shadowLeft > 0 && d < this.spec.shadowRange;
        l.castShadow = want;
        if (want) shadowLeft--;
      }
    }
  }
}
