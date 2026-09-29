/**
 * ============================================================================
 *  keylight.ts — finding the scene's key directional light, and re-finding it.
 * ============================================================================
 *
 * A subsystem that needs the sun's direction — a tracker, a shadow streak, a
 * ground-bounce term, a sun-facing billboard — usually cannot be handed the
 * light, because the rig that owns it is another module built at another boot
 * stage. So it goes looking. Two things about going looking are always the
 * same, and one of them is a trap that has been paid for repeatedly.
 *
 * ---------------------------------------------------------------------------
 *  THE TRAP: A CACHE OF A FACT WILL OUTLIVE THE FACT AND THEN ANSWER FOR IT
 * ---------------------------------------------------------------------------
 * Attach once at bring-up and hold the reference, and the subsystem is correct
 * until something rebuilds the rig — a scenario reseed, a quality change, a
 * WebGL context restore — at which point it is holding a `DirectionalLight`
 * that has been removed from the scene. Nothing throws. `position` and
 * `target.position` still read, they just describe a sun that is no longer
 * lighting anything, and every consumer keeps aiming at where the sun was when
 * the page loaded.
 *
 * So the reference is REVALIDATED, not cached: `light.parent === null` means it
 * has been removed from the graph and the search runs again. That is one
 * property read per frame against a scene traverse per rebuild, and it is the
 * difference between "ask" and "remember".
 *
 * WHAT THAT GUARD CANNOT SEE, stated so nobody assumes otherwise. `.parent` is
 * the only handle three gives, and it is written by `Object3D.remove` /
 * `removeFromParent`. A teardown that empties `scene.children` DIRECTLY leaves
 * every child's `.parent` still pointing at the scene, so a light detached that
 * way is invisible to this and the stale reference survives. (A test battery
 * hit exactly that and its script was corrected to use the real API, which is
 * how this paragraph came to exist.) It also cannot see a light that
 * is still attached but is no longer the one a caller means — a rig that swaps
 * the key's INTENSITY to zero rather than removing it needs `rescan()`.
 *
 * ---------------------------------------------------------------------------
 *  AND THE OTHER HALF: DO NOT TRAVERSE FOR SOMETHING THAT IS NOT THERE
 * ---------------------------------------------------------------------------
 * At boot the light genuinely does not exist yet, and a subsystem that ticks
 * before the rig is built would traverse the whole scene every frame finding
 * nothing. `retry` is the floor between failed searches. A SUCCESSFUL search
 * is not throttled at all — the revalidation above is a pointer comparison.
 *
 * `rescan()` forces the next `find` to search even inside the retry window, for
 * the case where the caller KNOWS the graph just changed and does not want to
 * spend the retry interval aiming at a fallback.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THE CALLER OWNS
 * ---------------------------------------------------------------------------
 * `castsShadow`, and it matters more than it looks: a rig with a key and a fill
 * directional hands the first one found to whoever asks, and depth-first order
 * is a property of the order the rig happened to add them. A consumer that
 * wants the SUN rather than a light wants the one that casts.
 *
 * And the direction maths. This returns the light, not a vector, because the
 * two questions callers actually ask are different: "which way is the sun" is
 * `position - target`, and "which way does the shadow fall" is the negative of
 * that, and whether they want the LOCAL pair or the world one depends on
 * whether the rig parents its light under anything. Owning that here would make
 * one of those callers subtly wrong and neither of them would notice.
 */
import * as THREE from 'three';

export interface KeyLightOpts {
  /**
   * Only accept a light that casts a shadow. See the header: a rig with a fill
   * directional will otherwise hand you the fill, on graph order.
   */
  castsShadow?: boolean;
  /**
   * Seconds between searches that found nothing. A successful one is never
   * throttled, because holding it costs a pointer comparison.
   */
  retry: number;
}

export class KeyLight {
  /** The light, or null while nothing in the scene qualifies. */
  light: THREE.DirectionalLight | null = null;
  private cool = 0;
  private o: KeyLightOpts;

  // Written out rather than as a parameter property, so this parses under a
  // strip-only type remover.
  constructor(o: KeyLightOpts) { this.o = o; }

  /** Search on the next `find` even if the retry window has not elapsed. */
  rescan(): void { this.cool = 0; this.light = null; }

  /**
   * @param dt seconds since the last call, for the retry throttle. Sim seconds
   *           are fine and are what a frozen capture wants — the throttle is a
   *           cost control, not a timing behaviour.
   */
  find(scene: THREE.Object3D, dt: number): THREE.DirectionalLight | null {
    // REVALIDATE. A light removed from the graph has a null parent, and holding
    // it is how a subsystem answers for a sun that is not there any more.
    if (this.light && !this.light.parent) this.light = null;
    if (!this.light && this.cool <= 0) {
      this.cool = this.o.retry;
      const want = this.o.castsShadow === true;
      scene.traverse((n) => {
        if (this.light) return;
        const l = n as THREE.DirectionalLight;
        if (l.isDirectionalLight && (!want || l.castShadow)) this.light = l;
      });
    }
    this.cool -= dt;
    return this.light;
  }
}

/**
 * ============================================================================
 *  AND THE SECOND QUESTION, WHICH IS NOT THE SAME QUESTION.
 * ============================================================================
 *
 *  Two changes landed in this filename within an hour of each other, and the
 *  merge was an add/add conflict. `KeyLight` above and `scanKeyLight` below
 *  are BOTH kept, deliberately and permanently, because collapsing them into
 *  one walk would silently change which light a game shades against. Two
 *  things that genuinely differ stay two, even when a shared version would
 *  compile.
 *
 *  They differ on the ranking rule, which is the whole of it:
 *
 *    · `KeyLight` takes the FIRST directional light in depth-first order that
 *      satisfies `castsShadow`, and then HOLDS it, revalidating on `.parent`
 *      and throttling only the searches that fail. Its consumers want "the
 *      thing casting the shadows", they call every frame, and they want the
 *      answer to stop changing once it is found.
 *
 *    · `scanKeyLight` takes the BRIGHTEST qualifying light over an intensity
 *      floor, optionally also reporting one by `.name`, and holds nothing at
 *      all. Its consumers want "the thing lighting the scene", they call on a
 *      slow cadence, and they each cache on their own policy.
 *
 *  At night those two return different objects, on purpose. A `find()` that
 *  quietly started returning the brightest would change a base-building game's
 *  contact shadows and nothing in the suite would go red.
 *
 *  What IS shared is the trap, and both headers state it independently: a
 *  handle threaded from the rig is a cache of a fact, and it outlives the fact.
 * ============================================================================
 */
/**
 * ============================================================================
 *  keylight — "which of these is the key", asked of a scene rather than of a
 *  variable somebody remembered to set.
 * ============================================================================
 *
 *  WHY IT IS A SCAN AND NOT A HANDLE. Every subsystem downstream of a light rig
 *  needs the key: a contact-shadow march needs its direction, a surface shader
 *  needs its colour and irradiance, an audio duck might need its elevation.
 *  Threading a handle from the rig to all of them means every one of them holds
 *  a CACHE OF A FACT, and the most expensive recurring trap in this codebase is
 *  exactly that — the cache outlives the fact and then answers for it. Asking
 *  the scene costs a walk over a handful of children and is always right.
 *
 *  IT DOES NOT CACHE, AND THAT IS THE POINT. Callers cache, because the two
 *  that exist cache on genuinely different policies — one counts CALLS and
 *  re-checks that the light is still parented to the scene it came from, the
 *  other counts RENDERER FRAMES — and a shared cache with a mode flag would be
 *  two policies wearing one name. What is shared is the WALK, which is the part
 *  that was written twice with two different answers to the same four
 *  questions.
 *
 *  ONE GAME HAD FOUR COPIES OF THIS WALK and no two agreed: its post chain
 *  scanned direct children only and required `.visible`; its ground material
 *  traversed the whole graph and did not; its structures and its agents each
 *  took the FIRST directional light they met, which is whichever one happened
 *  to be added first. Every one of them is defensible on its own and they
 *  cannot all be describing the same key. That is the shape a duplication
 *  census scores as zero, four times over.
 *
 *  EVERY OPTION IS REQUIRED. A default here decides which light a game's
 *  shading is written against, silently, and the two live callers disagree on
 *  three of the four.
 * ============================================================================
 */

export interface KeyLightScan {
  /** How deep to look: the scene's direct children, or the whole graph. */
  deep: boolean;
  /** Skip lights whose `.visible` is false. */
  visibleOnly: boolean;
  /**
   * A light must be strictly brighter than this to be considered at all.
   *
   * NOT ZERO, and the reason is a live behaviour rather than tidiness: a
   * cascaded sun rig parks its slave lights at intensity 0 and keeps them in
   * the scene, so a threshold of zero returns a shadow-only slave as the key
   * whenever it happens to be first. It is also what makes "the sun has set"
   * answerable — at dusk every cascade falls under it and the scan returns
   * null, which is a different statement from "there is no sun in this scene".
   */
  minIntensity: number;
  /**
   * Also report the light with this exact `.name`, whatever its rank, or null
   * to skip the lookup.
   *
   * A rig's DESIGNATED key and its BRIGHTEST light are the same object most of
   * the time and not always: at night a fill can outrank the sun, and a shader
   * that wants "the thing casting the shadows" and one that wants "the thing
   * lighting the scene" are asking different questions. Both answers come back
   * from one walk.
   */
  named: string | null;
}

export interface KeyLightResult {
  /** Brightest qualifying directional light, or null if none qualified. */
  brightest: THREE.DirectionalLight | null;
  /** The one matching `named`, or null when not asked for or not found. */
  named: THREE.DirectionalLight | null;
}

/**
 * Walk a scene for its directional lights and answer both questions at once.
 *
 * RETURNS A FRESH OBJECT, and that is a deliberate choice against this
 * package's usual allocation-free habit. A shared mutable result would make two
 * scans of the same scene ALIAS — the second overwrites the first, and a caller
 * holding both then compares a thing with itself and finds it equal. That is
 * `colourOf` called twice with a different hat on, and it renders perfectly.
 * The scan is on a slow cadence by construction (a key does not change between
 * frames), so the allocation is not on any hot path.
 *
 * Ties go to the FIRST light met, which for `deep: false` is scene-add order.
 * That is stated rather than arbitrary: two lights at exactly equal intensity
 * swapping between frames is a strobe, and add order does not change.
 */
export function scanKeyLight(scene: THREE.Object3D, spec: KeyLightScan): KeyLightResult {
  let best: THREE.DirectionalLight | null = null;
  let bestI = spec.minIntensity;
  let named: THREE.DirectionalLight | null = null;
  const visit = (o: THREE.Object3D): void => {
    const l = o as THREE.DirectionalLight;
    if (l.isDirectionalLight !== true) return;
    if (spec.named !== null && l.name === spec.named) named = l;
    if (spec.visibleOnly && l.visible !== true) return;
    if (l.intensity > bestI) { bestI = l.intensity; best = l; }
  };
  if (spec.deep) scene.traverse(visit);
  else for (const child of scene.children) visit(child);
  return { brightest: best, named };
}
