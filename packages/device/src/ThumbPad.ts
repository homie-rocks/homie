/**
 * ============================================================================
 *  The on-screen pad's STATE MACHINE — the half both racers ran identically.
 * ============================================================================
 *  `@homie-rocks/device/Thumb.ts` already held the arithmetic (the radii, the curve,
 *  the spawn zone, the screen-space roll projection). `@homie-rocks/ui/touchSkin.ts`
 *  already held the stylesheet. What was still sitting in two places was the
 *  machine between them: which pointer owns the stick, what happens when a
 *  thumb rolls onto a second contact, where the rosette rests, which button a
 *  stab resolves to, and the twelve preference setters that all funnel through
 *  one `save`.
 *
 *  Measured on 2026-08-20, before this file existed: of the touch-controls
 *  module's 868 substantive lines in the kart racer, 421 appeared verbatim in
 *  the 1050 of the space racer — and comparing METHOD BY METHOD, 291 lines were
 *  byte-identical bodies. Those bodies are what moved here, unchanged. Nothing
 *  was rewritten, reformatted or improved on the way; the comments came because
 *  they are the asset, and a chunk that needed improving would be a separate
 *  commit.
 *
 *  ---------------------------------------------------------------------------
 *  WHAT THIS FILE IS GENERIC OVER, AND WHY IT IS NOT GENERIC OVER `Ctx`
 *
 *  A game's `TouchControls` reaches its whole world: `ControlPrefsData`, its own
 *  `TouchState`, its own `Btn` union of button ids. None of those may cross a
 *  package seam. So this class does not take them — it declares the THREE
 *  STRUCTURAL INTERFACES below, listing exactly the fields it reads, and is
 *  generic over them. Both games' existing records satisfy all three already,
 *  which is why not one of their call sites had to change.
 *
 *    PadPrefs   ten preference fields out of the fourteen the kart racer
 *               stores and the seventeen the space racer stores. It never
 *               learns what a preference MEANS beyond these ten.
 *    PadOutput  the twelve fields of a game's input state that the pad itself
 *               writes. `pitch`, `airBrakeL`, `boost`, `radiators` and the rest
 *               are not here and must not be: this class cannot see them, so it
 *               cannot quietly start deciding them.
 *    PadButton  the nine numbers a hit test needs. The game's `id` is not one.
 *
 *  ---------------------------------------------------------------------------
 *  WHAT DELIBERATELY DID NOT COME, AND WHY
 *
 *  `onMove` CAME TOO, on 2026-08-21, and this paragraph is the correction of an
 *  earlier one that said it never would. The old text is worth keeping because
 *  the reasoning it got wrong is a reasoning that will be offered again:
 *
 *    > the space racer carries a PITCH axis on the perpendicular of the same
 *    > drag, and in `onMove` that changes the ARC LATCH'S OWN CONDITION [...]
 *    > That is a different rule, not a different value, and sharing it would
 *    > need a flag that changes behaviour inside a shared function.
 *
 *  Both halves of that are true and the conclusion does not follow, because
 *  A FLAG IS NOT THE ONLY WAY TO SHARE A BODY WITH TWO VARIATION POINTS — this
 *  file had already proved that five times, twelve lines further down. Measured
 *  again before it moved: the two bodies are byte-identical over 76 lines apart
 *  from exactly one gate and one write to an axis this class cannot see, which
 *  is the SAME SHAPE as `grabFixed` and `heirAdopted`. It moved as two hooks,
 *  `arcDefines()` and `moveExtra()`.
 *
 *  AND THEN ONE OF THE TWO STOPPED BEING A DIVERGENCE, in the commit after. The
 *  gate turned out not to be about pitch at all: a 32-degree latched axis puts
 *  53% of every VERTICAL pixel into the steering command, and the kart racer
 *  had that too — a thumb sliding 191 px straight down the screen took it to
 *  full lock. Measured, then fixed for both, so `arcDefines()` is gone and the
 *  condition is unconditional here. `moveExtra()` remains, because a
 *  perpendicular axis genuinely is one game's and not the other's.
 *
 *  That is the whole argument for extracting a fork pair rather than tidying
 *  one: with two copies, one game's discovery stays one game's. Once it is one
 *  body, the other game gets the fix by existing.
 *
 *  `onUp` and `claimStick` were NOT that. Every difference in those two was a
 *  one-line write to `pitch` at a fixed point, so they moved whole and left
 *  five no-op hooks — `grabFixed` / `grabResume` / `grabFresh` on the grab,
 *  `heirAdopted` / `extraLive` / `clearExtra` on the release. The kart racer
 *  overrides none of them and reads exactly as it did; the space racer's three
 *  decisions, and the comments that justify them, stayed in the space racer.
 *
 *  `layout()` and the game's own `update()` and `mount()` bodies also stayed:
 *  they are about which controls this game HAS, which is content. `mountPad`
 *  and `runCoach` below took the halves of those that were not.
 *
 *  ---------------------------------------------------------------------------
 *  NOTHING IN THIS FILE IS VERIFIED UNDER A THUMB.
 *
 *  Say that plainly rather than let a green harness imply otherwise. It is a
 *  known trap: CDP touch events bypass the browser's gesture arbitration, so a
 *  synthetic touch harness passes while every button is dead under a real
 *  thumb. Everything here was moved by comparing bodies for byte equality and
 *  gated on typecheck + boot; that establishes that the code is the SAME code,
 *  and establishes nothing whatever about how it feels. The geometry, the hit
 *  resolution and the handover remain UNVERIFIED until a person holds a phone.
 * ============================================================================
 */
import {
  ARC_LATCH_PX,
  ARC_MAX_RAD,
  CURVE,
  DEADZONE_PX,
  DEADZONE_PX_FIXED,
  EDGE_GUARD,
  HANDOVER_DECAY,
  HANDOVER_SETTLE,
  KNOB_FRAC,
  PALM_PX,
  RELEASE_RATE,
  RING_FRAC,
  SAFE_MIN,
  TILT_DEADZONE_DEG,
  STICK_RADIUS_FRAC,
  STICK_RADIUS_MAX,
  STICK_RADIUS_MIN,
  clampStickOrigin,
  contactSizeKnown,
  grabRadiusAt,
  inSpawnZone,
  requestTiltPermission,
  safeAreaInsets,
  screenRollDegrees,
  thumbCurve,
  thumbTravel,
} from './Thumb.ts';
import type { PadFrame, ThumbHand } from './Thumb.ts';

/** Which steering source is live. */
export type PadScheme = 'floating' | 'fixed' | 'tilt' | 'buttons';

/**
 * As much of a game's own run-state as the onboarding beats need, and no more.
 *
 * FIVE MEMBERS, AND `menu` AND `results` ARE SEPARATE ON PURPOSE. Both return
 * early from the same branch, so folding them into one "idle" is the obvious
 * simplification and it is wrong: the sequence re-arms on `menu → countdown`
 * ONLY, and an idle phase would re-run the whole tutorial on the second race of
 * every session — in front of a room, at a player who has already been taught.
 * It would read as a deliberate feature. The touch-pad probe has a sub-tape
 * for exactly this, and nothing else can see it.
 *
 * `gone` is "there is no run to read at all", which is not the same as being on
 * a menu: it does not touch the stored phase, so a frame during a teardown
 * cannot silently re-arm anything either.
 */
export type CoachPhase = 'gone' | 'menu' | 'results' | 'countdown' | 'racing' | 'other';

/**
 * What a game tells the coach each frame. Three fields, all derived by the
 * GAME from its own world, so no part of a race — no state enum, no racer, no
 * drift tier — reaches this package.
 *
 * That is the whole seam. An earlier extraction refused `updateSignals` on
 * exactly this ownership test and was right to: boost time and drift tier do
 * not belong in a geometry package. They still do not. What belongs here is the
 * machine — three beats, their gates, their timeouts, and where the word is
 * printed — because that machine was byte-identical in both games and is a fact
 * about teaching a thumb rather than about a kart or a ship.
 */
export interface CoachSignals {
  phase: CoachPhase;
  /** beat 2's gate: the player has done the thing beat 2 named */
  did: boolean;
  /** beat 3's gate: the player is holding something worth releasing */
  banked: boolean;
}

/**
 * The ten preference fields this class reads.
 *
 * A game's own record is wider and stays wider — quality tiers, pad layouts,
 * pitch inversion, radiator assists. Those are that game's meaning and this
 * package must not learn them; it holds the record only so `commit()` can be
 * the one funnel that persists.
 */
export interface PadPrefs {
  scheme: PadScheme;
  hand: ThumbHand;
  /** auto-accelerate */
  autoAccel: boolean;
  haptics: boolean;
  steerAssist: number;
  driftAssist: number;
  /** degrees of device roll that reach full lock in the tilt scheme */
  tiltRange: number;
  /** fixed-stick rosette centre, as a FRACTION of the viewport */
  fixedX: number;
  fixedY: number;
  /** onboarding version already shown; compared against `tutorialVersion` */
  tutorialSeen: number;
}

/**
 * The twelve output fields this class writes.
 *
 * Every one of them is written by code that moved here verbatim. A game adding
 * a thirteenth axis does NOT add it here — it adds it to its own state and
 * writes it from its own override, which is exactly how the space racer's
 * pitch and air brakes work.
 */
export interface PadOutput {
  /** the input contract: -1 full LEFT .. +1 full RIGHT. Unfiltered. */
  steer: number;
  /** -1 / 0 / +1 from the `buttons` scheme only */
  digital: number;
  /** true while the steering source is authoritative (including the ramp) */
  steering: boolean;
  /** true while the player is actually touching something */
  active: boolean;
  pause: boolean;
  haptics: boolean;
  steerAssist: number;
  driftAssist: number;
  drift: boolean;
  item: boolean;
  look: boolean;
  brake: number;
}

/**
 * The cached hit geometry of one control.
 *
 * A game's `Btn` extends this with its own `id`. The capsule fields are the
 * general case and the circle is the degenerate one — see `coreDistance`.
 */
export interface PadButton {
  el: HTMLElement;
  pointer: number;
  /** set on press, cleared by the game's `update()` — a sub-frame stab lands */
  tapped: boolean;
  cx: number;
  cy: number;
  /** DRAWN radius. Stage 1 of hit resolution: inside this, this button wins. */
  visR: number;
  /**
   * Half-extents of the capsule's CORE SEGMENT, from which `visR` is swept.
   * Both are 0 for a circle — which is every control in the kart racer and
   * every one in the space racer except the two air-brake pads — so the
   * distance function below is the same one it always was for them.
   */
  hx: number;
  hy: number;
  /** padded radius, = visR + the cluster's one derived pad */
  padR: number;
  /** kept for the touch-feel measurement, which reads sqrt(r2) as hit radius */
  r2: number;
}

/**
 * Distance from a point to a button's core segment. For a circle (hx = hy = 0)
 * this is exactly the `Math.hypot(x - cx, y - cy)` it replaces.
 */
function coreDistance(b: PadButton, x: number, y: number) {
  const dx = Math.max(0, Math.abs(x - b.cx) - b.hx);
  const dy = Math.max(0, Math.abs(y - b.cy) - b.hy);
  return Math.hypot(dx, dy);
}

export abstract class ThumbPad<
  P extends PadPrefs,
  S extends PadOutput,
  B extends PadButton,
> {
  /** the game's live input state. Written only through `PadOutput`'s twelve. */
  abstract readonly state: S;

  /** persisted player preferences — the source of truth for everything below */
  prefs: P;

  /**
   * The onboarding version this game is on. A VALUE the game supplies, not a
   * behaviour: the kart racer is on 1 and the space racer is on 2 because their
   * controls diverged, and a shared default would silently re-run one game's
   * tutorial or skip the other's.
   */
  protected readonly tutorialVersion: number;

  /** the one funnel that persists. See `commit`. */
  private readonly savePrefs: (prefs: P) => void;

  constructor(prefs: P, savePrefs: (prefs: P) => void, tutorialVersion: number) {
    this.prefs = prefs;
    this.savePrefs = savePrefs;
    this.tutorialVersion = tutorialVersion;
  }

  /** auto-accelerate — the AUTO chip and the controls screen both toggle it */
  auto = true;
  protected root: HTMLElement | null = null;
  protected stickWrap!: HTMLElement;
  protected stickBase!: HTMLElement;
  protected stickKnob!: HTMLElement;
  protected ghost!: HTMLElement;
  /**
   * Four more elements `mountPad` finds, because both games' markup declares
   * all four under the same class names and does the same thing with them.
   *
   * `cluster` and `padsWrap` are the two containers a game's own `layout()`
   * measures and places into; `pauseChip` is wired here; `coachEl` is the one
   * the beats below print on.
   */
  protected cluster!: HTMLElement;
  protected padsWrap!: HTMLElement;
  protected pauseChip!: HTMLElement;
  protected coachEl!: HTMLElement;
  /**
   * The three elements `setAuto` owns. The game's `mount()` finds them, because
   * the game's markup is the game's; what happens to them when the player
   * turns auto-accelerate off is identical in both and lives here.
   */
  protected gasBtn!: HTMLElement;
  protected autoChip!: HTMLElement;
  protected bGas!: B;
  /**
   * The two steering pads, which only the `buttons` scheme reads. Resolved by
   * the game in its `wire()`, because the game's markup declares them.
   *
   * A left-handed player's mirror moves the RECTANGLES and never the sign, so
   * `padLeft` is the pad that means LEFT in every hand — see the steering
   * negation invariant at the top of both games' files.
   */
  protected padLeft!: B;
  protected padRight!: B;
  /** public for the touch-feel measurement, which reads cached radii back */
  buttons: B[] = [];

  /** -1 when no thumb is steering */
  protected stickPointer = -1;
  protected originX = 0;
  protected originY = 0;
  /** travel to full lock for THIS grab — see rGrab in the game's `claimStick` */
  radius = STICK_RADIUS_MIN;
  /** the un-clamped ideal, recomputed on layout */
  protected stickRadius = STICK_RADIUS_MIN;
  protected deadzonePx: number = DEADZONE_PX;
  protected mounted = false;
  /** public: the touch-feel measurement forces a re-measure through this */
  dirty = true;
  /** pointers that went down without claiming anything — may still slide on */
  protected free = new Set<number>();
  /** last known position of each free pointer, for heir adoption */
  protected freeXY = new Map<number, { x: number; y: number }>();

  // --- arc latch, per grab ---
  protected arcLatched = false;
  protected arcCos = 1;
  protected arcSin = 0;
  protected grabTravel = 0;

  // --- release ramp / handover ---
  protected releasing = false;
  protected handoverT = -1;

  // --- tilt ---
  private tiltOn = false;
  protected tiltZero = 0;
  protected tiltRaw = 0;
  private tiltSeen = false;

  // --- layout cache ---
  protected safe = { l: SAFE_MIN, r: SAFE_MIN, t: SAFE_MIN, b: SAFE_MIN };
  protected vw = 0;
  protected vh = 0;

  /** true once anything at all has been touched — gates the ghost stick */
  protected touchedEver = false;

  /** set by Input so control-level feedback can use the one haptics gate */
  pulse: ((pattern: number[]) => void) | null = null;
  /** watches the two attributes that decide whether the cluster has a size */
  protected menuObserver: MutationObserver | null = null;

  // --- onboarding. Which beats exist is the pad's; what ARMS them is not.
  protected coachStep = 0;
  protected coachT = 0;
  protected coachDone = false;
  /**
   * The phase the last tick reported, and the reason it is stored as a phase
   * rather than as the game's own state value: see `CoachPhase`.
   */
  protected coachPhase: CoachPhase = 'menu';

  // ------------------------------------------------------ what a game supplies

  /** Size and place every control. Which controls exist is the game's. */
  protected abstract layout: () => void;
  /** Is this button part of the current scheme / AUTO state at all? */
  protected abstract enabled(b: B): boolean;
  /**
   * Brand one of this game's buttons around the nine numbers hit resolution
   * needs. `mountPad` finds the element; the game adds its own `id`, which is
   * the only field of a `Btn` this package must never learn the values of.
   */
  protected abstract newButton(id: string, el: HTMLElement): B;
  /**
   * The control beats 2 and 3 print their word ON.
   *
   * A getter rather than a field because it is read at frame time, from a
   * button the game's own `mount()` resolves — and because naming the field
   * here would mean naming the control, which is the game's word for it.
   */
  protected abstract coachAt(): B;
  /**
   * Beat 2's word. A VALUE, not a behaviour: the kart racer says `DRIFT` and
   * the space racer says `AIR-BRAKE` about the same beat, gated on the same
   * signal, printed on the same control, at the same moment. One game calling
   * a thing by a different name is a rename, not a divergence.
   */
  protected abstract readonly coachWord2: string;

  // -------------------------------------------------------------------- life

  /**
   * Bring the pad up: the stylesheet, the root, the elements, the buttons, the
   * two chips, the listeners and the menu observer.
   *
   * EVERY LINE OF THIS WAS BYTE-IDENTICAL in the kart racer and the space
   * racer, including the two long comments — which are the asset, and which is
   * why they came whole rather than being summarised on the way. The order is
   * the order it was in, statement for statement, and that is not a style
   * point: `layout()` is called before the listeners go on, and `applyScheme()`
   * after it, and a pad that lays out after its first pointer event has already
   * cached seven zeroes.
   *
   * THE FOUR THINGS A GAME SUPPLIES, and they are the only four:
   *
   *   css      its stylesheet, the chunks of @homie-rocks/ui/touchSkin.ts it uses
   *            plus the controls only it has
   *   markup   its own cluster; both roots carry the same stick, ghost, pads
   *            and coach, and neither's buttons are the other's
   *   ids      the buttons, in declaration order. Order is load-bearing — it
   *            is the order `measure()` walks and the order the DOM holds
   *   wire     what to do once the buttons exist: resolve them by id, and
   *            attach anything only this game has. Called at exactly the point
   *            the `byId` block sat at in both files.
   */
  protected mountPad(css: string, markup: string, ids: readonly string[], wire: () => void) {
    const style = document.createElement('style');
    style.id = 'tc-style';
    style.textContent = css;
    document.head.appendChild(style);

    // Lets the HUD (and the rules at the foot of a game's file) reflow for thumbs.
    document.documentElement.setAttribute('data-touch', '');
    document.documentElement.setAttribute('data-touch-hand', this.prefs.hand);
    document.documentElement.setAttribute('data-touch-scheme', this.prefs.scheme);

    const root = document.createElement('div');
    root.className = 'tc-root';
    root.innerHTML = markup;
    document.body.appendChild(root);
    this.root = root;

    this.stickWrap = root.querySelector('.tc-stick-zone')!;
    this.stickBase = root.querySelector('.tc-stick-base')!;
    this.stickKnob = root.querySelector('.tc-stick-knob')!;
    this.ghost = root.querySelector('.tc-ghost')!;
    this.cluster = root.querySelector('.tc-cluster')!;
    this.padsWrap = root.querySelector('.tc-pads')!;
    this.autoChip = root.querySelector('.tc-auto')!;
    this.pauseChip = root.querySelector('.tc-pause')!;
    this.coachEl = root.querySelector('.tc-coach')!;
    this.gasBtn = root.querySelector('[data-btn="gas"]')!;

    for (const id of ids) {
      const el = root.querySelector<HTMLElement>(`[data-btn="${id}"]`)!;
      this.buttons.push(this.newButton(id, el));
    }
    wire();

    this.autoChip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setAuto(!this.auto);
      this.pulse?.([12]);
    });
    this.pauseChip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.state.pause = true; // consumed as an edge by Input on the next frame
    });

    this.auto = this.prefs.autoAccel;
    this.state.driftAssist = this.prefs.driftAssist;
    this.state.steerAssist = this.prefs.steerAssist;
    this.state.haptics = this.prefs.haptics;
    this.setAuto(this.auto);
    this.layout();
    this.applyScheme(this.prefs.scheme);

    // Listeners go on the window so a thumb that slides off a button still
    // releases it — a button that latches because the release landed on the
    // canvas is the second most common on-screen-control bug.
    addEventListener('pointerdown', this.onDown, { passive: false });
    addEventListener('pointermove', this.onMove, { passive: false });
    addEventListener('pointerup', this.onUp, { passive: false });
    addEventListener('pointercancel', this.onUp, { passive: false });
    addEventListener('contextmenu', this.onContext);
    addEventListener('resize', this.onViewportChange);
    addEventListener('orientationchange', this.onOrientation);
    // `visualViewport` is the only thing that reports the URL bar collapsing or
    // a software keyboard opening. `resize` alone misses both, and a stale hit
    // cache after either is a cluster that no longer matches what is drawn.
    visualViewport?.addEventListener('resize', this.onViewportChange);
    visualViewport?.addEventListener('scroll', this.onViewportChange);

    /**
     * A SHIPPED GAME BUG, fixed here at its source.
     *
     * The hit circles are cached and refreshed only when `dirty` is set — on
     * mount, on resize, on an AUTO toggle. The FIRST `pointerdown` after mount
     * is what triggers the first `measure()`, and at boot that touch lands
     * while `html[data-menu]` has `.tc-cluster` at `display: none`. Every rect
     * is then 0x0, every button gets `visR = 0`, `dirty` goes false, and
     * NOTHING set it again when the menu closed — so DRIFT, ITEM, BRAKE, LOOK
     * and GAS were dead for the rest of the session. A player taps through the
     * title screen, so a player hits this every single time.
     *
     * It was invisible to review for the same reason it is deterministic: the
     * buttons are drawn, they animate on press (the `.down` class is CSS, not
     * state), and only the input does nothing. A screenshot cannot find it.
     *
     * `data-menu` and `data-touch-preview` are the two attributes that change
     * whether these boxes have a size, so observing exactly those two is
     * sufficient and costs one callback per menu transition.
     */
    this.menuObserver = new MutationObserver(() => { this.dirty = true; });
    this.menuObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-menu', 'data-touch-preview'],
    });
  }

  unmount() {
    if (!this.mounted) return;
    this.mounted = false;
    removeEventListener('pointerdown', this.onDown);
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onUp);
    removeEventListener('pointercancel', this.onUp);
    removeEventListener('contextmenu', this.onContext);
    removeEventListener('resize', this.onViewportChange);
    removeEventListener('orientationchange', this.onOrientation);
    visualViewport?.removeEventListener('resize', this.onViewportChange);
    visualViewport?.removeEventListener('scroll', this.onViewportChange);
    this.menuObserver?.disconnect();
    this.menuObserver = null;
    this.stopTilt();
    const de = document.documentElement;
    de.removeAttribute('data-touch');
    de.removeAttribute('data-touch-hand');
    de.removeAttribute('data-touch-scheme');
    de.removeAttribute('data-touch-preview');
    document.getElementById('tc-style')?.remove();
    this.root?.remove();
    this.root = null;
    this.buttons.length = 0;
    this.releaseEverything();
  }

  // ---------------------------------------------------------------- prefs API

  /** Persist and apply. Every setter funnels here so nothing can drift apart. */
  protected commit(patch: Partial<P>) {
    Object.assign(this.prefs, patch);
    this.savePrefs(this.prefs);
  }

  setAuto(on: boolean) {
    this.auto = on;
    this.autoChip.classList.toggle('on', on);
    this.autoChip.textContent = on ? 'AUTO' : 'MAN';
    // With auto off the player needs a throttle; with it on that space is dead
    // weight under the thumb, so the pedal is removed rather than just dimmed.
    this.gasBtn.style.display = on ? 'none' : '';
    if (on && this.bGas) {
      this.bGas.pointer = -1;
      this.bGas.tapped = false;
      this.bGas.el.classList.remove('down');
    }
    this.dirty = true;
    this.layout();
    if (this.prefs.autoAccel !== on) this.commit({ autoAccel: on } as Partial<P>);
  }

  setHand(hand: ThumbHand) {
    document.documentElement.setAttribute('data-touch-hand', hand);
    this.commit({ hand } as Partial<P>);
    this.releaseEverything();
    this.dirty = true;
    this.layout();
  }

  setHaptics(on: boolean) {
    this.state.haptics = on;
    this.commit({ haptics: on } as Partial<P>);
  }

  setSteerAssist(a: number) {
    this.state.steerAssist = a;
    this.commit({ steerAssist: a } as Partial<P>);
  }

  setDriftAssist(a: number) {
    this.state.driftAssist = a;
    this.commit({ driftAssist: a } as Partial<P>);
  }

  setTiltRange(deg: number) {
    this.commit({ tiltRange: deg } as Partial<P>);
  }

  /** Zero the tilt scheme at the posture the device is in right now. */
  recentreTilt() {
    this.tiltZero = this.tiltRaw;
  }

  /**
   * Swap the steering source without unmounting the cluster.
   *
   * Safe mid-race, and that is a requirement rather than a nicety: every live
   * pointer is released, `steer` is zeroed and `steering` cleared, and NOTHING
   * here touches `IRace`. Switching schemes must never end or reset a race —
   * that is the same class of bug as the pause menu that permanently ended one.
   */
  setScheme(scheme: PadScheme) {
    if (scheme === this.prefs.scheme) return;
    this.commit({ scheme } as Partial<P>);
    this.applyScheme(scheme);
  }

  protected applyScheme(scheme: PadScheme) {
    this.releaseEverything();
    document.documentElement.setAttribute('data-touch-scheme', scheme);
    if (scheme === 'tilt') this.startTilt();
    else this.stopTilt();
    this.deadzonePx = scheme === 'fixed' ? DEADZONE_PX_FIXED : DEADZONE_PX;
    this.dirty = true;
    this.layout();
    if (scheme === 'fixed') this.showFixedRosette();
    else this.stickWrap.classList.remove('rosette');
  }

  /**
   * Release every live pointer and zero every output. Cannot leave a latch.
   *
   * A game that has MORE outputs overrides this, calls `super` and clears its
   * own — which is what the space racer does for pitch, the two air brakes,
   * boost and shield. It must never do the zeroing itself instead: the pointer
   * state and the axes are cleared together, always.
   */
  protected releaseEverything() {
    this.stickPointer = -1;
    this.releasing = false;
    this.handoverT = -1;
    this.arcLatched = false;
    this.free.clear();
    this.freeXY.clear();
    this.state.steer = 0;
    this.state.digital = 0;
    this.state.steering = false;
    this.state.active = false;
    this.stickWrap?.classList.remove('live');
    for (const b of this.buttons) {
      b.pointer = -1;
      b.tapped = false;
      b.el.classList.remove('down');
    }
    this.state.drift = false;
    this.state.item = false;
    this.state.look = false;
    this.state.brake = 0;
  }

  /**
   * The live-preview hook used by the controls screen.
   *
   * A blocking menu hides every `.tc-*` element, which is correct and is also
   * exactly wrong for a screen whose whole job is "try this scheme and watch it
   * respond". `data-touch-preview` re-reveals the STEERING SOURCE ONLY — never
   * the action cluster, so a preview cannot fire an item, open the pause menu
   * or toggle AUTO by mis-tap.
   */
  setPreview(on: boolean) {
    const de = document.documentElement;
    if (on) de.setAttribute('data-touch-preview', '');
    else de.removeAttribute('data-touch-preview');
    this.releaseEverything();
    this.dirty = true;
  }

  // ------------------------------------------------------------------ layout

  protected onContext = (e: Event) => e.preventDefault();

  protected onViewportChange = () => {
    this.dirty = true;
    this.layout();
  };

  /**
   * iOS fires `orientationchange` BEFORE layout has settled, so a single
   * re-measure reads the old frame. Two rAFs is the documented-by-experiment
   * minimum. Entering portrait force-releases everything: the rotate card
   * covers the controls, and a pointer that keeps driving an invisible stick is
   * a kart that keeps turning behind a "rotate your device" message.
   */
  protected onOrientation = () => {
    this.onViewportChange();
    requestAnimationFrame(() => {
      this.onViewportChange();
      requestAnimationFrame(this.onViewportChange);
    });
  };

  /**
   * Read the safe-area insets once per layout, floored at SAFE_MIN.
   *
   * The probe element, and why the floor is the part that is always real, are
   * in ./Thumb.ts. `.tc-safeprobe` is drawn by @homie-rocks/ui/touchSkin.ts, which is
   * the same stylesheet both games mount, so the selector is shared with it
   * rather than with either game.
   */
  protected readSafeArea() {
    this.safe = safeAreaInsets(this.root?.querySelector<HTMLElement>('.tc-safeprobe') ?? null, SAFE_MIN);
  }

/**
   * The nine lines EVERY `layout()` opens with, and the reason they are here.
   *
   * `mounted`, `root`, `vw`, `vh`, `readSafeArea`, `stickRadius`, `radius` and
   * `stickPointer` are all this class's already — a game's `layout()` was
   * re-deriving the viewport and re-sizing the rosette from constants this
   * package owns, in both racers, byte for byte. What a game's `layout()` is
   * FOR is where its own controls go, and nothing above that first blank line
   * was ever about that.
   *
   * RETURNS NULL RATHER THAN THROWING when there is nothing mounted, because
   * the guard it replaces was an early `return` and a caller has to be able to
   * spell that: `const L = this.layoutBase(); if (!L) return;`.
   *
   * `cl` comes back with it because both games declare the same three-term
   * clamp on the next line and then use it fifteen times. It is not a
   * convenience: a game that wrote `Math.min(hi, Math.max(lo, mid))` instead
   * would clamp identically until `lo > hi`, which is exactly what a small
   * phone with a large safe area produces.
   */
  protected layoutBase(): { vw: number; vh: number; vmin: number;
    cl: (lo: number, mid: number, hi: number) => number } | null {
    if (!this.mounted || !this.root) return null;
    const vw = innerWidth, vh = innerHeight;
    this.vw = vw; this.vh = vh;
    this.readSafeArea();
    const cl = (lo: number, mid: number, hi: number) => Math.max(lo, Math.min(hi, mid));
    this.stickRadius = cl(STICK_RADIUS_MIN, Math.min(vw, vh) * STICK_RADIUS_FRAC, STICK_RADIUS_MAX);
    if (this.stickPointer < 0) this.radius = this.stickRadius;
    return { vw, vh, vmin: Math.min(vw, vh) / 100, cl };
  }

  /**
   * The rosette's DRAWN size, from the live hit radius.
   *
   * Decoupled from the hit radius on purpose — see `RING_FRAC` in ./Thumb.ts —
   * and all three elements are this class's: `.tc-stick-base`, `.tc-stick-knob`
   * and `.tc-ghost` are queried in `mountPad` and come from
   * @homie-rocks/ui/touchSkin.ts's `TC_FRAME_MARKUP` and `TC_FRAME_CSS`. A game had
   * no business computing the size of an element it does not own, and both
   * racers were doing it with the same four lines.
   */
  protected layoutRosette() {
    const ring = this.radius * RING_FRAC;
    this.stickBase.style.width = this.stickBase.style.height = `${ring * 2}px`;
    this.stickKnob.style.width = this.stickKnob.style.height = `${ring * 2 * KNOB_FRAC}px`;
    this.ghost.style.setProperty('--ghost-d', `${ring * 2}px`);
  }

  /**
   * The four lines every `layout()` ENDS with, and the last one is why this is
   * worth a name.
   *
   * PORTRAIT COVERS THE CONTROLS WITH THE ROTATE CARD, and a pointer still
   * driving an invisible stick behind it is a vehicle that keeps turning. Both
   * racers carry that release and both wrote it out; a third game that forgot
   * it would have a defect nobody sees until somebody rotates a handset
   * mid-corner — which is exactly the class a synthetic touch probe cannot find
   * and a person holding a phone can.
   */
  protected layoutEnd(vw: number, vh: number) {
    if (this.prefs.scheme === 'fixed') this.showFixedRosette();
    this.placeGhost();
    this.dirty = true;
    if (vh > vw) this.releaseEverything();
  }

    /** The canonical left-thumb rest point, in px rather than in mm. */
  protected restPoint() {
    const vw = this.vw || innerWidth, vh = this.vh || innerHeight;
    // 25 mm at 35 deg from the pivot, expressed as a fraction of the short edge
    // because mm are not derivable at runtime (CSS px per mm is 5.9-6.4 across
    // the device table and is never reported to the page).
    const d = Math.max(120, Math.min(190, Math.min(vw, vh) * 0.42));
    const a = (35 * Math.PI) / 180;
    const x = -8 + Math.cos(a) * d;
    const y = vh + 10 - Math.sin(a) * d;
    return this.prefs.hand === 'left'
      ? { x: vw - x, y }
      : { x, y };
  }

  protected showFixedRosette() {
    const vw = this.vw || innerWidth, vh = this.vh || innerHeight;
    const rest = this.restPoint();
    const x = this.prefs.fixedX >= 0 ? this.prefs.fixedX * vw : rest.x;
    const y = this.prefs.fixedY >= 0 ? this.prefs.fixedY * vh : rest.y;
    this.originX = x;
    this.originY = y;
    this.stickWrap.classList.add('rosette');
    this.placeStick(0, 0);
  }

  protected placeGhost() {
    const p = this.restPoint();
    this.ghost.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    const first = this.prefs.tutorialSeen < this.tutorialVersion;
    // A ghost STICK only makes sense for a scheme that has one. Tilt and the
    // button pads teach themselves differently (the coach beat, and a pad you
    // can see at rest), and a phantom stick beside them would be a lie.
    const hasStick = this.prefs.scheme === 'floating' || this.prefs.scheme === 'fixed';
    this.ghost.classList.toggle('on', first && !this.touchedEver && hasStick);
  }

  // -------------------------------------------------------------- hit testing

  /**
   * Refresh the cached hit circles. Layout is read here and nowhere else —
   * `getBoundingClientRect()` inside a pointer handler forces synchronous
   * layout, five times, on the exact event whose latency the player feels.
   *
   * The pad is DERIVED from the drawn gap rather than being a flat +16 px on
   * radii of 21-43 px, which is what made every padded pair overlap. One number
   * for the cluster: a game's layout puts every button at the same `gap` from
   * its nearest neighbour, so a per-control pad would be the same number
   * anyway, and the touch-feel measurement models the pad as a constant.
   */
  protected measure() {
    this.dirty = false;
    for (const b of this.buttons) {
      const r = b.el.getBoundingClientRect();
      b.cx = r.left + r.width / 2;
      b.cy = r.top + r.height / 2;
      // A capsule is a circle swept along a segment: the swept radius is half
      // the SHORT side, and the leftover length becomes the core's half-extent.
      // A square element yields hx = hy = 0 and the old circle exactly.
      const short = Math.min(r.width, r.height);
      b.visR = short === 0 ? 0 : short / 2;
      b.hx = Math.max(0, (r.width - short) / 2);
      b.hy = Math.max(0, (r.height - short) / 2);
    }
    const live = this.buttons.filter((b) => b.visR > 0 && this.enabled(b));
    let minGap = Infinity;
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i]!, c = live[j]!;
        // Core-to-core, so a tall capsule beside a small round button reports
        // the gap the player can actually see rather than a centre distance
        // that counts the capsule's length as clearance.
        const g = Math.hypot(
          Math.max(0, Math.abs(a.cx - c.cx) - a.hx - c.hx),
          Math.max(0, Math.abs(a.cy - c.cy) - a.hy - c.hy),
        ) - a.visR - c.visR;
        if (g < minGap) minGap = g;
      }
    }
    const pad = live.length < 2 ? 16 : Math.min(16, Math.max(4, minGap / 2 + 2));
    for (const b of this.buttons) {
      b.padR = b.visR === 0 ? 0 : b.visR + pad;
      b.r2 = b.padR * b.padR;
    }
  }

  /**
   * Two stages, and the order is the whole fix for the mis-hit below.
   *
   * 1. If the point is inside a button's DRAWN disc, that button wins
   *    unconditionally. What you see is what you press. The old code returned
   *    the first PADDED circle in declaration order, so 198 px of the visible
   *    ITEM face fired DRIFT and 175 px of BRAKE did too — on the drift-facing
   *    edge, exactly where a right thumb travelling from DRIFT arrives.
   * 2. Otherwise take the smallest NORMALISED distance `(dist - visR) / visR`,
   *    ties to the smaller `visR` (the more specific target).
   *
   * Buttons already holding a pointer are skipped, deliberately: a thumb
   * holding DRIFT through a corner, brushed by a second finger, must not have
   * its drift dropped when the BRUSH lifts.
   */
  protected hitButton(x: number, y: number): B | null {
    if (this.dirty) this.measure();
    let best: B | null = null;
    let bestD = Infinity;
    for (const b of this.buttons) {
      if (!this.enabled(b) || b.visR === 0 || b.pointer >= 0) continue;
      const d = coreDistance(b, x, y);
      if (d <= b.visR && d < bestD) { best = b; bestD = d; }
    }
    if (best) return best;

    let bestN = Infinity;
    for (const b of this.buttons) {
      if (!this.enabled(b) || b.visR === 0 || b.pointer >= 0) continue;
      const d = coreDistance(b, x, y);
      if (d > b.padR) continue;
      const n = (d - b.visR) / b.visR;
      if (n < bestN - 1e-6 || (Math.abs(n - bestN) <= 1e-6 && best && b.visR < (best as B).visR)) {
        bestN = n;
        best = b;
      }
    }
    return best;
  }

  protected claim(b: B, id: number) {
    b.pointer = id;
    b.tapped = true;
    b.el.classList.add('down');
  }

  // ----------------------------------------------------------------- pointers

  /**
   * Take the stick at (x, y). Byte-identical in both racers except for three
   * one-line pitch writes, which are the three hooks below.
   *
   * THREE NO-OP HOOKS RATHER THAN ONE FLAG. A discriminant passed in — "which
   * kind of grab is this" — would be a shared function whose behaviour changes
   * inside itself, which is two things wearing one name. Three empty methods
   * cost nothing at a call site that has none, and they leave the space racer's
   * three decisions, and the three comments explaining them, in the game that
   * made them. The kart racer overrides none of them and reads exactly as it
   * did.
   */
  protected claimStick(id: number, x: number, y: number) {
    const wasSteer = this.releasing ? this.state.steer : 0;
    this.stickPointer = id;
    this.radius = this.prefs.scheme === 'fixed' ? this.stickRadius : this.grabRadius(x);
    this.arcLatched = false;
    this.arcCos = 1;
    this.arcSin = 0;
    this.grabTravel = 0;
    this.handoverT = -1;
    if (this.prefs.scheme === 'fixed') {
      // Frozen rosette: the origin does not move, so the first touch already
      // carries a deflection. That is what a fixed stick IS.
      this.state.steer = this.curve(x - this.originX);
      this.grabFixed(x, y);
    } else if (this.releasing && Math.abs(wasSteer) > 1e-4) {
      // Re-grab inside the release ramp: continue from where the ramp got to,
      // rather than snapping to zero under a thumb that never left the screen.
      // The window is self-limiting — exactly as long as the ramp, <= 62.5 ms.
      this.transplantOrigin(x, wasSteer);
      this.originY = y;
      this.state.steer = wasSteer;
      this.grabResume();
    } else {
      this.originX = x;
      this.originY = y;
      this.clampOrigin();
      this.state.steer = 0;
      this.grabFresh();
    }
    this.releasing = false;
    this.state.steering = true;
    this.stickWrap.classList.add('live');
    this.placeStick(this.stickOffset(), 0);
  }

  /** A grab on the frozen rosette. `x`/`y` are the touch, not the origin. */
  protected grabFixed(_x: number, _y: number) {}
  /** A re-grab inside the release ramp, with the steer already carried over. */
  protected grabResume() {}
  /** A grab on nothing: a new origin, and every axis starts at zero. */
  protected grabFresh() {}

  /**
   * The steering half of the drag: a pointer moves on the screen.
   *
   * WHY THIS IS HERE NOW, AND WHAT THE OLD REFUSAL GOT RIGHT AND WRONG.
   *
   * The header of this file used to say `onMove` STAYS IN THE GAMES, on the
   * grounds that the space racer's arc latch "is a different rule, not a
   * different value". Re-measured 2026-08-21: the two bodies are byte-identical
   * over 76 lines apart from EXACTLY TWO POINTS, and both of those are the same
   * shape as the five hooks `claimStick` and `onUp` already leave behind —
   *
   *   1. the latch gate — `arcDefines()` below;
   *   2. one write to a perpendicular axis this class cannot see — `moveExtra()`.
   *
   * That is not "a flag that changes behaviour inside a shared function". A
   * flag would be one body branching on WHICH GAME IT IS; these are two named
   * questions the subclass answers, with a default that is the whole answer for
   * a game with no perpendicular axis. The kart racer overrides neither and
   * reads exactly as it did.
   *
   * The refusal WAS right that a `mode` argument would have been wrong, and it
   * was right about the physics: on a pad with a pitch axis, a latched vertical
   * drag leaks 53% of the pitch command into the steering. That fact now lives
   * where the game that has pitch keeps it.
   *
   * EXPRESSING THE GATE AS A VALUE WAS TRIED FIRST AND REJECTED, on arithmetic
   * rather than taste. `Math.abs(dy) < Math.abs(dx) * SLOPE` reproduces the
   * space racer exactly at SLOPE = 1, and is meant to reproduce the kart racer
   * at SLOPE = Infinity — but a PERFECTLY VERTICAL drag has `dx === 0`, and
   * `0 * Infinity` is NaN, so every comparison against it is false and the latch
   * silently stops firing. `clientX` is an integer on most touch hardware, so a
   * thumb dragging straight down hits that exactly. A value that is wrong at
   * one end of its own range is not a value.
   */
  protected onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.stickPointer) {
      const known = this.free.has(e.pointerId);
      if (known) this.freeXY.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!known) return;
      // A thumb that missed the button it was aiming at can still slide on.
      const b = this.hitButton(e.clientX, e.clientY);
      if (b) {
        e.preventDefault();
        this.free.delete(e.pointerId);
        this.freeXY.delete(e.pointerId);
        this.claim(b, e.pointerId);
        return;
      }
      // The thumb roll, second half: a free pointer that MOVES while nothing is
      // steering takes the stick. Without this, a thumb that landed a moment
      // too early can never steer, however far it drags.
      if (this.stickPointer < 0 && this.canSpawnStickAt(e.clientX, e.clientY)) {
        e.preventDefault();
        this.free.delete(e.pointerId);
        this.freeXY.delete(e.pointerId);
        this.claimStick(e.pointerId, e.clientX, e.clientY);
      }
      return;
    }
    e.preventDefault();
    // Any movement from the heir cancels the palm-safety decay.
    this.handoverT = -1;

    let dx = e.clientX - this.originX;
    let dy = e.clientY - this.originY;
    const r = this.radius;

    // Thumb-arc alignment: latch the drag axis once the grab has actually
    // travelled, then measure along it.
    if (!this.arcLatched) {
      this.grabTravel = Math.hypot(dx, dy);
      /**
       * A PREDOMINANTLY VERTICAL FIRST MOVEMENT DOES NOT DEFINE THE AXIS.
       *
       * The clamp below folds a 90-degree stab to 32 degrees rather than
       * rejecting it, which reads as protection and is not: a 32-degree axis
       * puts sin(32) = 0.53 of every further VERTICAL px straight into the
       * steering command. The space racer found this when it gained a pitch
       * axis on the perpendicular — a rotated axis leaks 53% of every pitch
       * drag into steer — and wrote the condition. The kart racer had the same
       * defect with nothing on the perpendicular to make it obvious, and
       * MEASURED 2026-08-21 on the shipped arithmetic, at the shipped R = 96:
       *
       *   a thumb that lands on the stick and slides STRAIGHT DOWN the screen
       *
       *      down    kart before    after
       *      ------  -----------    -----
       *       20 px       0.1104    0
       *       80 px       0.4416    0
       *      191 px       1.0000    0
       *
       * A thumb sliding down the screen took that kart to FULL LOCK RIGHT
       * without ever moving sideways. An ordinary bowed horizontal sweep is
       * byte-identical across the change — 0 of 60 samples differ — because
       * the gate only ever refuses a movement that was never horizontal.
       *
       * THE TIE IS DELIBERATE. `>` and not `>=`: a drag at exactly 45 degrees
       * does not define an axis, because there the thumb is asking for the two
       * directions in equal measure and there is no reason to prefer one. A
       * `>=` compiles, typechecks and rotates the axis under a diagonal thumb,
       * so the stick-drag parity probe leads with a trace whose dx and dy are
       * equal to the bit.
       */
      if (this.grabTravel >= ARC_LATCH_PX && Math.abs(dx) > Math.abs(dy)) {
        let th = Math.atan2(dy, dx);
        // Fold into (-90, 90]: a leftward drag and a rightward drag share an
        // axis. Then clamp, so a vertical stab cannot rotate it into nonsense.
        if (th > Math.PI / 2) th -= Math.PI;
        else if (th <= -Math.PI / 2) th += Math.PI;
        th = Math.max(-ARC_MAX_RAD, Math.min(ARC_MAX_RAD, th));
        this.arcCos = Math.cos(th);
        this.arcSin = Math.sin(th);
        this.arcLatched = true;
      }
    }
    const project = () => (this.arcLatched ? dx * this.arcCos + dy * this.arcSin : dx);
    let dxEff = project();

    if (this.prefs.scheme !== 'fixed' && Math.abs(dxEff) > r) {
      /**
       * Let the base trail the thumb once it leaves the ring, so the stick never
       * saturates and a pull back toward centre responds immediately.
       *
       * LOCK RADIUS AND TRAIL RADIUS MUST BE THE SAME NUMBER. If they differ
       * there is a band at the rim where pushing further does nothing and
       * pulling back does nothing either, which is the exact "saturates and
       * then feels dead" failure the floating base exists to avoid.
       *
       * The origin slides ALONG the latched axis, not along screen X, or an
       * arced thumb would walk the base off its own diagonal over a long pull.
       */
      const over = dxEff - Math.sign(dxEff) * r;
      this.originX += over * this.arcCos;
      this.originY += over * this.arcSin;
      this.clampOrigin();
      dx = e.clientX - this.originX;
      dy = e.clientY - this.originY;
      dxEff = project();
    }
    dxEff = Math.max(-r, Math.min(r, dxEff));

    this.state.steer = this.curve(dxEff);
    this.moveExtra(dx, dy);
    this.placeStick(dx, dy);
  };

  /**
   * Any axis besides `steer` that this same drag produces, written at the exact
   * point the game wrote it: after `steer` is committed and before the knob is
   * placed. `dx`/`dy` are from the LIVE origin, which has already trailed.
   *
   * A no-op here rather than a `pitch` field, because this class cannot see a
   * game's extra axes and must not start deciding them — see `PadOutput`.
   */
  protected moveExtra(_dx: number, _dy: number) {}

  /**
   * A pointer leaves the screen. Byte-identical in both racers except for the
   * two `extra`-axis hooks below.
   *
   * The release path here is the ONE ramp this file has, and `steering` stays
   * TRUE while the command is non-zero so the game's Input keeps taking the
   * analogue path — its digital return branch stops being load-bearing for
   * touch.
   */
  protected onUp = (e: PointerEvent) => {
    this.free.delete(e.pointerId);
    this.freeXY.delete(e.pointerId);
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = -1;
      /**
       * THE THUMB ROLL. Before handing the steering back to zero, look for an
       * heir: a free pointer already on the screen inside the spawn region.
       * Adopt the MOST RECENTLY added one — a rolled thumb's new contact is the
       * newest thing down — and transplant the origin so the output is
       * reproduced EXACTLY. Steering is continuous across the roll: no snap, no
       * jump, no lost lap.
       */
      const heir = this.pickHeir();
      if (heir >= 0) {
        const p = this.freeXY.get(heir)!;
        const carry = this.state.steer;
        this.free.delete(heir);
        this.freeXY.delete(heir);
        this.stickPointer = heir;
        this.radius = this.prefs.scheme === 'fixed' ? this.stickRadius : this.grabRadius(p.x);
        this.transplantOrigin(p.x, carry);
        this.originY = p.y;
        this.arcLatched = false;
        this.state.steer = carry;
        this.heirAdopted();
        this.state.steering = true;
        this.releasing = false;
        // Palm safety: if the heir never moves, this decays. See HANDOVER_*.
        this.handoverT = 0;
        this.placeStick(this.stickOffset(), 0);
      } else {
        // Owned release ramp. `steering` stays TRUE while steer != 0 so Input
        // keeps taking the analogue path and its digital return branch stops
        // being load-bearing for touch.
        this.releasing = Math.abs(this.state.steer) > 1e-6 || this.extraLive();
        if (!this.releasing) {
          this.state.steer = 0;
          this.state.steering = false;
          this.clearExtra();
          this.stickWrap.classList.remove('live');
        }
      }
    }
    for (const b of this.buttons) {
      if (b.pointer === e.pointerId) {
        b.pointer = -1;
        b.el.classList.remove('down');
      }
    }
  };

  /**
   * The heir has been adopted and `steer` carried across. Any OTHER axis gets
   * its say here — before `steering` goes true, exactly where the write sat.
   */
  protected heirAdopted() {}
  /**
   * Is any axis besides `steer` still non-zero? Decides whether the ramp arms
   * at all, so an axis that is live while steer is not keeps the ramp running
   * rather than being held for the rest of the race with nothing on the screen.
   */
  protected extraLive(): boolean { return false; }
  /** The ramp did not arm, so everything is zeroed on the spot. */
  protected clearExtra() {}

  // ------------------------------------------------------------ steer maths
  //
  // THE ARITHMETIC IS ./Thumb.ts. What is left here is which numbers this pad
  // feeds it, which is the part that is the PAD's rather than the maths'.

  /** dead-zoned, rescaled, expo'd, at this grab's radius and dead zone. */
  protected curve(dx: number): number {
    return thumbCurve(dx, this.radius, this.deadzonePx);
  }

  /**
   * Move the base so the CURRENT output is reproduced from where the thumb is
   * now — the thumb-roll handover, a re-grab inside the release ramp, and a
   * resize mid-drag are all "the output must not jump".
   */
  protected transplantOrigin(clientX: number, steer: number) {
    this.originX = clientX - thumbTravel(steer, this.radius, this.deadzonePx);
    this.clampOrigin();
  }

  /**
   * The frame the three geometry rules are decided in.
   *
   * NO `|| innerWidth` FALLBACK HERE, DELIBERATELY. `inSpawn` had one and the
   * other two did not, and that asymmetry is real: a spawn can be asked about
   * before the first layout has run, while the clamp and the room rule cannot,
   * and giving them a fallback would change what they answer at vw = 0.
   */
  protected frame(): PadFrame {
    return { vw: this.vw, vh: this.vh, safeL: this.safe.l, safeR: this.safe.r, hand: this.prefs.hand };
  }

  /** The base may trail, but it may not migrate out of its own half over a lap. */
  protected clampOrigin() {
    this.originX = clampStickOrigin(this.originX, this.frame());
  }

  /** Is this point a legal place to START a stick? See ./Thumb.ts. */
  protected inSpawn(x: number, y: number) {
    return inSpawnZone(x, y, { ...this.frame(), vw: this.vw || innerWidth, vh: this.vh || innerHeight });
  }

  /** Room clamp: full lock must be reachable from every legal spawn. */
  protected grabRadius(x: number) {
    return grabRadiusAt(x, this.frame(), this.stickRadius);
  }

  protected stickOffset() {
    // Recover the drawn offset from the current output, so the knob and the
    // number can never disagree. The same inverse the handover uses, once.
    return thumbTravel(this.state.steer, this.radius, this.deadzonePx);
  }

  // ----------------------------------------------------------------- pointers

  protected onDown = (e: PointerEvent) => {
    if (!this.mounted) return;
    const t = e.target as HTMLElement;
    if (t?.closest?.('.tc-chip')) return; // handled by their own listeners
    this.touchedEver = true;
    this.ghost.classList.remove('on');

    const btn = this.hitButton(e.clientX, e.clientY);
    if (btn) {
      e.preventDefault();
      this.claim(btn, e.pointerId);
      return;
    }

    if (this.canSpawnStick(e)) {
      e.preventDefault();
      this.claimStick(e.pointerId, e.clientX, e.clientY);
      return;
    }

    // Landed on nothing. Keep watching it: a thumb that missed the button it
    // was aiming at can still slide on, and a thumb that lands while another is
    // steering is the HEIR if that other one lifts.
    this.free.add(e.pointerId);
    this.freeXY.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  protected canSpawnStick(e: PointerEvent) {
    const sch = this.prefs.scheme;
    if (sch === 'tilt' || sch === 'buttons') return false;
    if (this.stickPointer >= 0) return false;
    const x = e.clientX, y = e.clientY;
    // Edge guard, on pointerdown only. A drag that LEAVES through the band is
    // fine; it is the touch that STARTS there that the OS steals.
    if (x < EDGE_GUARD || x > this.vw - EDGE_GUARD || y < EDGE_GUARD || y > this.vh - EDGE_GUARD) return false;
    // Palm rejection, feature-detected. Safari reports width === 1 for every
    // touch, so a browser that has never reported anything else is one whose
    // contact size carries no information at all and the test is skipped.
    if (contactSizeKnown(e) && Math.max(e.width, e.height) > PALM_PX) return false;
    if (sch === 'fixed') {
      // A fixed stick is grabbed by touching near its rosette, not by touching
      // the whole half — otherwise a touch at the far edge is instant full lock.
      return Math.hypot(x - this.originX, y - this.originY) <= this.stickRadius * 1.35;
    }
    return this.inSpawn(x, y);
  }

  protected canSpawnStickAt(x: number, y: number) {
    const sch = this.prefs.scheme;
    if (sch === 'tilt' || sch === 'buttons') return false;
    if (sch === 'fixed') return Math.hypot(x - this.originX, y - this.originY) <= this.stickRadius * 1.35;
    return this.inSpawn(x, y);
  }

  protected pickHeir(): number {
    let best = -1;
    for (const id of this.free) {
      const p = this.freeXY.get(id);
      if (!p || !this.canSpawnStickAt(p.x, p.y)) continue;
      best = id; // Sets iterate in insertion order, so the last match is newest
    }
    return best;
  }

  protected placeStick(dx: number, dy: number) {
    const ring = this.radius * RING_FRAC;
    const k = Math.hypot(dx, dy);
    // The knob tracks 1:1 until the rim; past it the remaining travel is rim
    // alpha, so the outer 38% of the sweep stays legible without the ring
    // having to be as big as the hit area.
    const scale = k > ring ? ring / k : 1;
    this.stickBase.style.transform =
      `translate(${this.originX}px, ${this.originY}px) translate(-50%, -50%)`;
    this.stickKnob.style.transform =
      `translate(${this.originX + dx * scale}px, ${this.originY + dy * scale}px) translate(-50%, -50%)`;
    this.stickBase.style.setProperty('--rim', (0.35 + 0.65 * Math.abs(this.state.steer)).toFixed(3));
  }

  // --------------------------------------------------------------------- tilt

  protected startTilt() {
    if (this.tiltOn) return;
    this.tiltOn = true;
    this.tiltSeen = false;
    addEventListener('deviceorientation', this.onTilt);
  }

  protected stopTilt() {
    if (!this.tiltOn) return;
    this.tiltOn = false;
    removeEventListener('deviceorientation', this.onTilt);
    this.tiltRaw = 0;
  }

  /**
   * iOS 13+ gates DeviceOrientation behind a permission prompt that may only be
   * requested from a user gesture. Called from the controls screen's own tap.
   */
  async requestTilt(): Promise<boolean> { return requestTiltPermission(); }

  /** True once a real orientation sample has arrived — the menu shows this. */
  get tiltAvailable() { return this.tiltSeen; }

  /**
   * Project gravity into SCREEN space, and calibrate on the first sample.
   *
   * The derivation, and the pre-registered trap it avoids — a scheme that
   * steers backwards in one of the two landscapes, which looks fine in every
   * test somebody thought to run — are in ./Thumb.ts. There is no negation here
   * and there must never be one.
   */
  private onTilt = (e: DeviceOrientationEvent) => {
    const deg = screenRollDegrees(e.beta, e.gamma);
    if (deg === null) return;
    this.tiltRaw = deg;
    if (!this.tiltSeen) {
      this.tiltSeen = true;
      // The first sample is the player's actual holding posture, so it is zero.
      this.tiltZero = this.tiltRaw;
    }
  };

  /** Degrees off the calibrated neutral — shown live on the controls screen. */
  get tiltDegrees() { return this.tiltRaw - this.tiltZero; }

  // -------------------------------------------------------------------- frame

  /** Input clears this after converting it to a one-frame edge. */
  consumePause() {
    const p = this.state.pause;
    this.state.pause = false;
    return p;
  }

  /**
   * THE STEERING SOURCE. Four branches of one `if`, and the order is the
   * behaviour: a frame lands in exactly one of them and a reordering changes
   * which. Both games ran this byte-identically apart from the two lines the
   * `releaseExtra` hook below carries.
   *
   * The game's own `update()` calls this first and then merges its buttons,
   * because `digital` is zeroed here and the button pass may set it.
   *
   * NO SMOOTHING ON AN ANALOGUE SOURCE. A thumb on glass and a tilted phone are
   * already absolute positions: they ARE the rack command, and a second rate
   * limiter in series is the known "mushy" failure, already paid for once. The
   * ONE ramp here is the release ramp, which runs only after the thumb has
   * gone, and the `buttons` scheme deliberately emits a DIGITAL request so the
   * game's own key ramp handles it — one invented axis, one ramp, not two.
   */
  protected updateSteerSource(dt: number) {
    const s = this.state;
    const sch = this.prefs.scheme;

    s.digital = 0;
    if (sch === 'tilt') {
      const range = Math.max(6, this.prefs.tiltRange);
      const deg = this.tiltDegrees;
      const m = Math.abs(deg);
      const out = m <= TILT_DEADZONE_DEG
        ? 0
        : Math.sign(deg) * Math.min(1, Math.pow((m - TILT_DEADZONE_DEG) / (range - TILT_DEADZONE_DEG), CURVE));
      s.steer = out;
      // `steering` true only once a real sample has landed, so a device that
      // never fires the event falls back to the keyboard path rather than
      // pinning the command at a confident zero.
      s.steering = this.tiltAvailable;
    } else if (sch === 'buttons') {
      const l = this.padLeft.pointer >= 0 || this.padLeft.tapped;
      const r = this.padRight.pointer >= 0 || this.padRight.tapped;
      // A DIGITAL request. The game's Input owns the ramp — see NO SMOOTHING.
      s.digital = (r ? 1 : 0) - (l ? 1 : 0);
      s.steer = 0;
      s.steering = false;
    } else if (this.releasing) {
      const d = RELEASE_RATE * dt;
      s.steer = Math.abs(s.steer) <= d ? 0 : s.steer - Math.sign(s.steer) * d;
      // UNCONDITIONALLY, AND BEFORE THE TEST. `&&` short-circuits, so writing
      // `s.steer === 0 && this.releaseExtra(d)` would run the second axis's
      // ramp only on the frames steer happened to already be zero — an axis
      // that ramps in fits, on a phone, at 165 m/s, and nothing would throw.
      const extraDone = this.releaseExtra(d);
      if (s.steer === 0 && extraDone) {
        this.releasing = false;
        s.steering = false;
        this.stickWrap.classList.remove('live');
      }
    } else if (this.handoverT >= 0) {
      // Palm safety on an adopted heir that has not moved.
      this.handoverT += dt;
      if (this.handoverT > HANDOVER_SETTLE) {
        const k = Math.min(1, (this.handoverT - HANDOVER_SETTLE) / HANDOVER_DECAY);
        s.steer = s.steer * (1 - k) + 0 * k;
        if (k >= 1) {
          s.steer = 0;
          this.handoverT = -1;
        }
      }
    }
  }

  /**
   * Ramp any axis this game has BESIDE steer down the same ramp, and answer
   * whether it has arrived. `d` is the step already applied to steer.
   *
   * Default: there is no such axis, so the ramp is finished when steer is.
   * The space racer overrides it for PITCH, and the reason it must be part of
   * the same test rather than a separate one is written at its override: a
   * thumb that pitched without steering leaves steer at 0, and a ramp gated on
   * steer alone would leave that pitch command held for the rest of the race
   * with nothing on the screen.
   *
   * A HOOK RATHER THAN A FLAG. A boolean that changed what the shared function
   * does inside itself would be two things wearing one name; this leaves the
   * decision, and the comment explaining it, in the game that made it.
   */
  protected releaseExtra(_d: number): boolean { return true; }

  // -------------------------------------------------------------- onboarding

  /**
   * Three beats, each printed ON the control it refers to, each gated on the
   * player actually doing the thing, each with a hard timeout so it can never
   * block a race. No overlay, no dimming, nothing to dismiss, at most two words
   * on screen at any instant.
   *
   * The old onboarding was one line of `clamp(9px, 1.4vmin, 18px)` type at 44%
   * opacity — 1.5 mm of glyph — naming controls without showing where they are,
   * while the floating stick was invisible at rest. A first-run player had no
   * visual evidence a steering control existed.
   *
   * Byte-identical in both racers apart from beat 2's WORD and the `hy` term in
   * the anchor — and `hy` is 0 for every control the kart racer draws, so that
   * one was never a divergence at all. See `CoachSignals` for what does not
   * cross.
   */
  protected runCoach(sig: CoachSignals, dt: number) {
    if (this.coachDone || this.prefs.tutorialSeen >= this.tutorialVersion) return;
    if (sig.phase === 'gone') return;
    if (sig.phase === 'menu' || sig.phase === 'results') {
      this.coachPhase = sig.phase;
      return;
    }
    // A new race resets the sequence exactly once; nothing here runs twice.
    if (this.coachPhase === 'menu' && sig.phase === 'countdown') {
      this.coachStep = 1;
      this.coachT = 0;
    }
    this.coachPhase = sig.phase;
    if (this.coachStep === 0) return;
    this.coachT += dt;

    const say = (word: string, where: 'stick' | 'drift') => {
      if (this.coachEl.textContent !== word) this.coachEl.textContent = word;
      this.coachEl.setAttribute('data-at', where);
      this.coachEl.classList.add('on');
      if (where === 'stick') {
        const p = this.stickPointer >= 0 || this.prefs.scheme === 'fixed'
          ? { x: this.originX, y: this.originY }
          : this.restPoint();
        this.coachEl.style.transform = `translate(${p.x}px, ${p.y - this.radius * RING_FRAC - 26}px) translate(-50%, -50%)`;
      } else {
        // `hy` matters here: a capsule control's top edge is half its LENGTH
        // above the centre, not half its width. Without the term the coach word
        // is printed on top of the very control it is pointing at. It is 0 for
        // a circle, which is every control the kart racer draws, so carrying it
        // is free there and correct for the space racer's air-brake pads.
        const b = this.coachAt();
        this.coachEl.style.transform = `translate(${b.cx}px, ${b.cy - b.hy - b.visR - 26}px) translate(-50%, -50%)`;
      }
    };
    const hide = () => this.coachEl.classList.remove('on');

    switch (this.coachStep) {
      case 1: // STEER — during the countdown's ~3.5 s of dead time
        say(this.prefs.scheme === 'tilt' ? 'TILT' : 'STEER', 'stick');
        if (Math.abs(this.state.steer) > 0.35 || this.state.digital !== 0 || this.coachT > 2.5) {
          this.coachStep = 2;
          this.coachT = 0;
          hide();
        }
        break;
      case 2: // the game's own word — armed once the race is actually running
        if (sig.phase !== 'racing') break;
        say(this.coachWord2, 'drift');
        if (sig.did) { this.coachStep = 3; this.coachT = 0; hide(); }
        else if (this.coachT > 6) { this.coachStep = 3; this.coachT = 0; hide(); }
        break;
      case 3: // RELEASE — the first time a tier is banked
        if (sig.banked) {
          say('LET GO', 'drift');
          this.coachAt().el.classList.add('letgo');
        } else if (this.coachT > 12) {
          this.finishCoach();
        } else if (this.coachAt().el.classList.contains('letgo')) {
          // They released with a tier banked, or lost it. Either way, done.
          this.finishCoach();
        }
        break;
    }
  }

  protected finishCoach() {
    this.coachDone = true;
    this.coachEl.classList.remove('on');
    this.coachAt().el.classList.remove('letgo');
    this.commit({ tutorialSeen: this.tutorialVersion } as Partial<P>);
  }
}
