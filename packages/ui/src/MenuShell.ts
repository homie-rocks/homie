/**
 * ============================================================================
 *  MenuShell — the four-screen menu state machine, without a single word of
 *  what any of the screens SAY.
 * ============================================================================
 *
 * The kart racer's and the space racer's menus are a fork of each other. The
 * half that is the same is not the art and not the copy — it is the machine
 * underneath: which of `title | select | pause | results | none` is up, what a
 * steer edge does to the highlight, which keypress counts as confirm, when the
 * classification board is stale enough to rebuild, and the two
 * `pointer-events` rules that decide whether a phone can tap the screen at
 * all.
 *
 * That machine is here once. Everything a player can READ stayed in its game.
 *
 * The GENERIC half of that machine is `./screens.ts` and this class consumes
 * it. Screen exclusivity, the validated `?ui=` route, cyclic focus and
 * confirmation do not require a race-shaped caller. This file is the racer
 * adapter: it decides which race state requests which screen, builds
 * standings/lap boards and owns the title/select/pause/results flow.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE KNOWS, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * An earlier version of this header refused to take the boards, on the grounds
 * that a package may not know that a row says "Abandon", and on that basis
 * left about 194 lines duplicated across the two games:
 *
 *   `fillResults`      50 / 48 lines, ~42 shared each  (~84 not taken)
 *   `buildPause`       50 / 51 lines, ~41 shared each  (~82 not taken)
 *   `buildResults`     19 / 21 lines, ~14 shared each  (~28 not taken)
 *
 * Every difference in all three is copy or a CSS class — the winner line, the
 * restart label, the quit label, `kr-best` against `kr-bestbox`, an entrance
 * delay of 0.055 s against 0.05 s. So the three members are here now, and the
 * copy went with them **as options the game supplies** — every word on those
 * screens is still authored in the game's own menu module, so the package is
 * not the place you go to change a word. What moved is the skeleton: which
 * element nests in which, the stagger, the rebuild throttle, the four button
 * wirings and the two `--d` custom properties.
 *
 * The line that holds is the ENGINEERING one, not the vocabulary one:
 *
 *  · **No `Ctx` crosses this seam.** The list below is exactly the fields the
 *    shared code reads and nothing else.
 *  · **A divergence that is a VALUE is an option. A divergence that is a
 *    BEHAVIOUR is a hook.** The three that are behaviour — what a place cell
 *    renders (the kart racer superscripts its ordinal, the space racer does
 *    not), what the results title says at each place, and what the fourth
 *    column of a running-order row reads (lap in one, heat percentage in the
 *    other) — are functions the GAME hands over on its screen spec, not a
 *    `mode` flag. A `mode` parameter would be `if (game === 'kart')` wearing a
 *    suit.
 *
 * There are still only two consumers and they are still forks of each other,
 * and that is recorded rather than hidden: two forks agreeing about the
 * anatomy of a classification board is weaker evidence than three independent
 * games would be. It is not a reason to keep the anatomy written twice.
 *
 * ---------------------------------------------------------------------------
 * NO Ctx CROSSES THIS SEAM
 * ---------------------------------------------------------------------------
 * `Ctx` is each game's own aggregate and it must never enter a package. It does
 * not need to. Below is the exact list of fields the SHARED code reads, and
 * nothing else. Both games satisfy it structurally, so no call site in either
 * game changed:
 *
 *     race.state          race.raceTime      race.selectKart()   race.reset()
 *     race.setPaused()    race.totalLaps     race.lapTimes       race.standings
 *     race.player         race.karts[] · id · finished · lap · place
 *                                      · raceDistance · stats.name
 *                                      · stats.color.getHexString()
 *     input.state.steer   input.state.itemPressed
 *     input.state.pausePressed               input.touch
 *     bus.on()            bus.emit()
 *
 * IT GREW WHEN THE BOARDS CAME IN, and that is the cost of taking them rather
 * than something to hide: `player`, `standings`, `totalLaps`, `lapTimes`,
 * `setPaused` and six fields of a racer used to be read only by members that
 * stayed in the games. What did NOT arrive is anything the shared code does not
 * read — no `heat`, no `heatCapacity`, no `t`, no `driftTier`, no `shipClass`,
 * no `KartStats` multiplier. The space racer's running-order row reads three
 * of those and reaches them through its own `orderCellText` override, where
 * its own racer type is in scope and this package never sees it.
 *
 * ---------------------------------------------------------------------------
 * THE RACE STATES ARE PASSED IN, NOT HARDCODED. READ THIS BEFORE "SIMPLIFYING".
 * ---------------------------------------------------------------------------
 * Both games declare `const enum RaceState { Menu = 0, Countdown = 1, Racing =
 * 2, Finished = 3, Results = 4, Paused = 5 }` — identical, member for member and
 * ordinal for ordinal, checked rather than assumed. It would therefore "work"
 * to write `state === 2` in here and delete eight lines from each caller.
 *
 * It is passed in anyway, because a shared name that is really a contract with
 * one game's internals is the failure that keeps recurring: two racers
 * export `TIER_COLORS` from the same filename with different hexes, and
 * hoisting either one silently repaints the other game's slide ladder with
 * nothing going red. A reordered `RaceState` in one game is that bug with a
 * worse blast radius — every menu in the OTHER game would show the wrong screen
 * and no compiler anywhere would say a word. Each game hands over its own
 * ordinals at its own call site, so a reorder travels.
 */
import { el, formatClock, cssColor } from './uiUtil.ts';
import { createScreens, type ScreenRouter } from './screens.ts';

/** The five screen states. `'none'` is the race itself, with no menu up. */
export type ScreenName = 'none' | 'title' | 'select' | 'pause' | 'results';

/** The four real screens — every key of `screens`, and `'none'` excluded. */
export type BuiltScreen = Exclude<ScreenName, 'none'>;

/**
 * Exactly the racer fields the two shared boards read. Everything else about a
 * racer is the game's business and is reached through an override.
 *
 * `stats.color` is stated as "a thing with a hex string" rather than as a
 * `THREE.Color` on purpose: this package has no three.js dependency and must
 * not grow one for a `#rrggbb`. Two copies of three.js is two `instanceof`
 * universes, and the symptom is an object that renders as nothing with no error.
 */
export interface MenuRacer {
  readonly id: number;
  readonly finished: boolean;
  /** completed laps, 0-based; the running-order rebuild key reads it */
  readonly lap: number;
  /** 1-based classification position */
  readonly place: number;
  /** the sort key placement is derived from — the gap column reads it */
  readonly raceDistance: number;
  readonly stats: {
    readonly name: string;
    readonly color: { getHexString(): string };
  };
}

/** Exactly the race director surface the shared machine touches. */
export interface MenuRace {
  /** compared against the ordinals in `MenuRaceStates` — never against a literal */
  readonly state: number;
  readonly raceTime: number;
  readonly karts: readonly MenuRacer[];
  /** the human's racer. Guarded everywhere it is read: a director may not have one yet */
  readonly player: MenuRacer | null | undefined;
  /** classification order. Empty before it is computed, and the boards fall back to `karts` */
  readonly standings: readonly MenuRacer[];
  readonly totalLaps: number;
  /** completed lap times for the player, seconds */
  readonly lapTimes: readonly number[];
  selectKart(index: number): void;
  reset(): void;
  /**
   * The director owns the paused state, so the pause screen's own Resume button
   * cannot get out of it by clearing a local flag — it has to say so here. This
   * was the bug: clearing `localPause` alone left `race.state === Paused`, which
   * pinned `want` to the pause screen, and Resume did nothing at all.
   */
  setPaused(paused: boolean): void;
}

/** Exactly the input fields the shared machine reads. */
export interface MenuInputState {
  readonly steer: number;
  readonly itemPressed: boolean;
  readonly pausePressed: boolean;
}

export interface MenuInput {
  readonly state: MenuInputState;
  /** true when the player is on a finger, which can flip mid-session */
  readonly touch: boolean;
}

/**
 * The bus, as narrowly as it can be stated. `on` is handed an event whose only
 * guaranteed field is `type`; `MenuFinishEvent` below is what a `'finish'`
 * carries in both games.
 */
export interface MenuBusEvent {
  readonly type: string;
}

export interface MenuFinishEvent extends MenuBusEvent {
  readonly kart: { readonly id: number };
}

export interface MenuBus {
  on(fn: (e: MenuBusEvent) => void): void;
  emit(e: { readonly type: 'ui'; readonly name: string }): void;
}

export interface MenuCtx {
  readonly race: MenuRace;
  readonly input: MenuInput;
  readonly bus: MenuBus;
}

/**
 * The controls screen, as the shell sees it: a sibling overlay that owns input
 * while it is up. Deliberately four members and no more — `ControlsMenu` may
 * move into `@homie-rocks/input`, and this interface is written so that
 * whatever it becomes still satisfies it without this file being edited.
 */
export interface MenuOverlay<C> {
  readonly open: boolean;
  attach(ctx: C): void;
  update(ctx: C): void;
  show(): void;
}

/** One game's `RaceState` ordinals, handed over rather than assumed. */
export interface MenuRaceStates {
  readonly menu: number;
  readonly countdown: number;
  readonly racing: number;
  readonly finished: number;
  readonly results: number;
  readonly paused: number;
}

export interface MenuShellOptions {
  readonly states: MenuRaceStates;
  /**
   * Every selector that is its OWN control on a blocking screen, beyond the
   * buttons. A tap on one of these emits `'move'` and must not also count as
   * the tap-anywhere confirm, or it fires twice.
   *
   * The kart racer has one kind of card. The space racer has cards and a
   * speed-class row, so it passes `'.kr-card, .kr-class-o'`. That is the whole
   * difference and it is a string — the divergence is a value, as it usually is.
   */
  readonly cardSelector?: string;
}

/**
 * Title-screen copy for ONE device state. The shell swaps between two of these
 * whenever `input.touch` flips, which it can do mid-session — the documented
 * iPadOS "Request Desktop Website" case has Safari claiming `pointer: fine` and
 * `maxTouchPoints: 0` until the first real finger lands.
 */
export interface TitlePrompt {
  /** the one line under the mark: "Press Enter to Start" / "Tap to begin" */
  readonly prompt: string;
  /** miniature renderings of the actual controls, on touch. `''` on keys. */
  readonly glyphsHtml: string;
  /** the keyboard legend. `''` on touch. */
  readonly hintHtml: string;
}

export interface TitleScreenSpec {
  /** the game's own mark, already assembled. The package never builds a logo. */
  readonly markHtml: string;
  /** the strapline under the mark */
  readonly subText: string;
  /** column gap on the stage, e.g. `'1.2vmin'`. Omitted leaves the stylesheet's. */
  readonly gap?: string;
  readonly controlsLabel: string;
  readonly touch: TitlePrompt;
  readonly keys: TitlePrompt;
}

/**
 * THE PLACE CELL, and why it is a function the game hands over.
 *
 * The kart racer superscripts the ordinal — `2<sup>nd</sup>` — and the space
 * racer prints a bare numeral, because its whole screen vocabulary is
 * stencilled and a superscript is a typographic register that appears nowhere
 * else in it. That
 * is a genuine difference in what gets rendered, so it is not an option value;
 * it is the game's own function. A boolean `ordinals: true` would have been
 * `if (game === 'kart')` wearing a suit.
 *
 * Declared with METHOD SYNTAX deliberately: method-typed members stay bivariant
 * even under `strictFunctionTypes`, so a game may type its implementation
 * against its own racer type without a variance error at the call site.
 */
export interface PlaceCell {
  /** HTML for the place cell of the row at 0-based index `i`. */
  placeHtml(i: number): string;
}

export interface PauseScreenSpec extends PlaceCell {
  readonly gap?: string;
  /** the small line above the word "Paused" */
  readonly badge: string;
  /** `'kr-title kr-gold'` in one game, `'kr-title-n'` in the other */
  readonly titleClass: string;
  readonly titleText: string;
  readonly orderTitle: string;
  readonly resumeLabel: string;
  readonly controlsLabel: string;
  readonly restartLabel: string;
  readonly quitLabel: string;
  /**
   * The fourth column of a RUNNING-ORDER row (the pause screen, not the results
   * board). The kart racer prints the lap; the space racer prints heat
   * percentage, because on that screen the interesting fact about 4th place is
   * that they are at 91% and cannot boost out of a long banked section. Heat is
   * not on `MenuRacer` and must not be — this runs in the game, where its own racer
   * type is in scope and this package never sees it.
   */
  orderCellText(k: MenuRacer, race: MenuRace): string;
}

export interface ResultsScreenSpec extends PlaceCell {
  readonly titleClass: string;
  /** what the heading says before a race has been classified */
  readonly titleText: string;
  /** `--d` entrance delay on the grid and the button list, e.g. `'0.06s'` */
  readonly gridDelay?: string;
  readonly listDelay?: string;
  readonly againLabel: string;
  readonly backLabel: string;
  /**
   * Row entrance stagger: `--d` on row i is `base + i * step` seconds, three
   * decimals. 0.14/0.055 in one game and 0.12/0.05 in the other — a value, and
   * therefore an option rather than a branch.
   */
  readonly rowDelayBase: number;
  readonly rowDelayStep: number;
  /** the best-lap callout's class — `'kr-best'` in one game, `'kr-bestbox'` in the other */
  readonly bestClass: string;
  readonly bestLabel: string;
  /** prefix for a lap line, rendered as `${lapLabel} ${n}` */
  readonly lapLabel: string;
  readonly totalLabel: string;
  /** what the best-lap callout reads before any lap is complete */
  readonly noBestText: string;
  /** what a lap line reads before that lap is complete */
  readonly noLapText: string;
  /** what the classification heading reads for a 1-based finishing place */
  resultsTitleText(place: number): string;
}

export abstract class MenuShell<C extends MenuCtx> {
  /** The screen currently shown — HUD reads this to decide how to fade out. */
  screen: ScreenName = 'none';
  /** True while a full-screen menu owns the frame (HUD hides entirely). */
  blocking = false;
  /**
   * Set by a tap on the title or select screen. Touch devices have no Enter key
   * and the title screen's only other affordance is a keyboard hint, so a tap
   * anywhere on those two IS the front door.
   *
   * IT USED TO INCLUDE THE RESULTS SCREEN, IN BOTH GAMES, AND THAT WAS A TRAP.
   * `onConfirm`'s results branch clicks `buttons.results[btnIndex]`, and
   * `btnIndex` is reset to 0 every time a screen comes up — button 0 is "Race
   * again" / "Run it again". So one stray finger anywhere on the classification
   * board **restarted the race for everyone watching**, unlabelled, with no
   * confirmation, on the one screen people actually want to sit and read.
   *
   * The title screen needs the gesture because it has nothing else to offer a
   * thumb. The results screen does not: it carries two full-width buttons, both
   * `pointer-events: auto`, both saying in words what they do. The gesture was
   * inherited from the screen that needs it by the screen that must not have
   * it, and neither game's copy was ever the place to notice that.
   *
   * `blocking` keeps all three screens — it means "a full-screen menu owns the
   * frame", which is still true of the board, and the HUD reads it to hide.
   */
  private tapConfirm = false;

  protected root: HTMLDivElement;
  protected ctx!: C;
  private readonly router: ScreenRouter<BuiltScreen>;
  protected get forced(): ScreenName | null { return this.router.forced; }
  protected set forced(name: ScreenName | null) {
    if (name === null || name === 'none') this.router.clearForced();
    else this.router.force(name);
  }

  /** Local pause, used when the race director does not model `paused`. */
  protected localPause = false;
  protected localTitle = false;
  protected selecting = false;

  protected selected = 0;
  protected cards: HTMLDivElement[] = [];
  protected buttons: { pause: HTMLDivElement[]; results: HTMLDivElement[] } = { pause: [], results: [] };
  protected btnIndex = 0;

  private prevSteer = 0;
  protected resultsBuilt = false;
  /** How many racers were classified when the board was last built. */
  private resultsFinished = -1;
  protected finishTimes = new Map<number, number>();
  private lastRaceTime = 0;

  /**
   * The live handles the three shared screens hold. They are set by the
   * `build*Screen` members below, which the subclass calls from its OWN
   * constructor body — see the note on the constructor for why a base
   * constructor could not have built them.
   */
  private promptLine!: HTMLDivElement;
  private glyphRow!: HTMLDivElement;
  private keyLegend!: HTMLDivElement;
  private touchCopyShown: boolean | null = null;
  private title!: TitleScreenSpec;

  /** the running order on the pause screen */
  private orderBoard!: HTMLDivElement;
  /** throttle on the pause board rebuild — it only changes when places do */
  private orderKey = '';
  private pause!: PauseScreenSpec;

  private resultsBoard!: HTMLDivElement;
  private lapsBoard!: HTMLDivElement;
  private resultsHead!: HTMLDivElement;
  private results!: ResultsScreenSpec;

  /** the controls screen — its own overlay, not one of the four `screens` */
  protected controls!: MenuOverlay<C>;
  /** the four screens, handed over by `mount()` at the end of the subclass ctor */
  private screens!: Record<BuiltScreen, HTMLDivElement>;

  private readonly states: MenuRaceStates;
  private readonly cardSelector: string;

  /**
   * THE CONSTRUCTOR DOES NOT BUILD THE SCREENS, AND THAT IS NOT A STYLE CHOICE.
   *
   * All four games compile with `useDefineForClassFields: true`. A subclass's
   * field declarations — including the `private titlePrompt!: HTMLDivElement`
   * kind with no initialiser — are DEFINED, as `undefined`, the instant
   * `super()` returns and before a line of the subclass constructor body runs.
   * So a base constructor that called `this.buildTitle()` would run a method
   * that writes `this.promptLine`, and then have that write erased a moment
   * later by the subclass's own declaration. The screen would be built, look
   * completely correct in the DOM, and every handle to a live element inside it
   * would be `undefined` — a failure worse than a crash, because the first
   * symptom is somewhere else entirely.
   *
   * The subclass therefore builds its screens itself and calls `mount()` last.
   */
  protected constructor(parent: HTMLElement, opts: MenuShellOptions) {
    this.states = opts.states;
    this.cardSelector = opts.cardSelector ?? '.kr-card';

    this.router = createScreens<BuiltScreen>({
      names: ['title', 'select', 'pause', 'results'],
      param: 'ui',
      onMove: () => this.ui('move'),
    });

    this.root = el('div', 'kr-screens', parent);

    // one delegated listener rather than a handler per control
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.kr-btn')) this.ui('confirm');
      else if (t.closest(this.cardSelector)) this.ui('move');
    });

    // Tap-anywhere confirm, on the two screens that have no other front door.
    // A real control that was tapped handles itself via its own click handler,
    // so those are excluded to avoid confirming twice. The results screen is
    // excluded for a different reason — see `tapConfirm`.
    this.root.addEventListener('pointerdown', (e) => {
      if (this.screen !== 'title' && this.screen !== 'select') return;
      const t = e.target as HTMLElement;
      if (t.closest('.kr-btn, ' + this.cardSelector)) return;
      this.tapConfirm = true;
    });

  }

  /**
   * Hand over the controls overlay and the four built screens. Called as the
   * LAST statement of the subclass constructor — see the note on the ctor.
   */
  protected mount(controls: MenuOverlay<C>, screens: Record<BuiltScreen, HTMLDivElement>) {
    this.controls = controls;
    this.screens = screens;
    this.router.add('title', {
      root: screens.title,
      confirm: () => { this.selecting = true; this.ui('confirm'); },
    });
    this.router.add('select', {
      root: screens.select,
      focus: {
        items: () => this.cards,
        read: () => this.selected,
        write: (index) => { this.selected = index; this.syncCards(); },
      },
      confirm: () => { this.startRace(this.ctx); this.ui('confirm'); },
    });
    this.router.add('pause', {
      root: screens.pause,
      focus: {
        items: () => this.buttons.pause,
        read: () => this.btnIndex,
        write: (index) => { this.btnIndex = index; this.syncButtons(); },
      },
    });
    this.router.add('results', {
      root: screens.results,
      focus: {
        items: () => this.buttons.results,
        read: () => this.btnIndex,
        write: (index) => { this.btnIndex = index; this.syncButtons(); },
      },
    });
  }

  init(ctx: C) {
    // A crash, not a plausible default. A subclass that forgot `mount()` would
    // otherwise fail on the first frame with a `screens is undefined` read
    // somewhere inside `update`, which reads as a bug in this file.
    if (!this.screens) {
      throw new Error('MenuShell: mount() was never called — the subclass constructor must end with it');
    }
    this.ctx = ctx;
    // finish times are not on the race director, so we stamp them off the bus.
    // The cast is the seam: this shell is not shown the game's event union, and
    // the games' `'finish'` carries the racer that crossed. Narrowing on `type`
    // alone cannot reach `kart` without it.
    ctx.bus.on((e) => {
      if (e.type === 'finish') this.finishTimes.set((e as MenuFinishEvent).kart.id, ctx.race.raceTime);
    });
    this.onInit(ctx);
    this.fillRoster(ctx);
    this.controls.attach(ctx);
  }

  // ------------------------------------------------------------------ frame

  update(ctx: C, _dt: number) {
    const race = ctx.race;
    const input = ctx.input.state;

    // A race reset rewinds the clock; drop stale results so they rebuild.
    if (race.raceTime < this.lastRaceTime - 0.25) {
      this.resultsBuilt = false;
      this.resultsFinished = -1;
      this.finishTimes.clear();
    }
    this.lastRaceTime = race.raceTime;

    // The title copy follows the device actually in use, and `input.touch` can
    // flip mid-session (the iPadOS lazy mount, or a keyboard being pressed on a
    // tablet). Cached on the value, so this is a compare per frame.
    this.syncTouchCopy(ctx.input.touch);

    // The controls screen owns input while it is up: it is a sibling overlay,
    // not one of the four screens, so nothing below it may act on a confirm.
    this.controls.update(ctx);
    if (this.controls.open) {
      this.tapConfirm = false;
      this.prevSteer = input.steer;
      return;
    }

    const inRace = race.state === this.states.racing || race.state === this.states.countdown;

    // Confirm is the fire button — Enter / Space / gamepad face — which is what
    // the on-screen hint actually promises. It used to read `pausePressed`, i.e.
    // Escape or P alone, so the title screen said "PRESS ENTER TO START" and
    // Enter did nothing at all.
    //
    // It is gated on a screen actually being up. Without that gate the same
    // keypress that fires a shell also opens the pause menu, because with no
    // screen showing `onConfirm` falls through to its pause branch.
    if (this.screen !== 'none') {
      if (this.confirmPressed(input) || this.tapConfirm) this.onConfirm(ctx, inRace);
    } else if (input.pausePressed && inRace) {
      this.localPause = true;
      this.ui('pause');
    }
    this.tapConfirm = false;

    // steer edges drive menu navigation on keyboard/gamepad
    const st = input.steer;
    if (st > 0.55 && this.prevSteer <= 0.55) this.nav(1);
    else if (st < -0.55 && this.prevSteer >= -0.55) this.nav(-1);
    this.prevSteer = st;

    let want: ScreenName;
    if (race.state === this.states.menu || this.localTitle) want = this.selecting ? 'select' : 'title';
    else if (race.state === this.states.paused || this.localPause) want = 'pause';
    else if (race.state === this.states.finished || race.state === this.states.results) want = 'results';
    else want = 'none';
    want = this.router.resolve(want === 'none' ? null : want) ?? 'none';

    // The board is not final the moment it appears. It goes up after the PLAYER
    // crosses, and the field behind them is still running for up to half a
    // minute. Building it once meant a winning player saw a classification
    // frozen at their own crossing: every row below them ordered by
    // distance-on-track, printing a metre gap instead of a finish time, and
    // never corrected. Rebuild while anyone is still out there — the finished
    // count only moves seven more times, so this is a handful of rebuilds, not
    // a per-frame one.
    if (want === 'results') {
      const done = ctx.race.karts.reduce((n, k) => n + (k.finished ? 1 : 0), 0);
      if (!this.resultsBuilt || done !== this.resultsFinished) {
        this.resultsFinished = done;
        this.fillResults(ctx);
      }
    } else if (want === 'pause') {
      this.fillPauseOrder(ctx);
    }

    if (want !== this.screen) {
      this.btnIndex = 0;
      this.screen = want;
      this.router.show(want === 'none' ? null : want);
      this.syncButtons();
    }
    this.blocking = want === 'title' || want === 'select' || want === 'results';

    // Inline, not stylesheet: the HUD layer sets `pointer-events: none` with
    // enough specificity that an appended `.kr-screen.on` rule loses, and a
    // blocking screen that cannot receive a tap is unstartable on a phone —
    // there is no Enter key to fall back to. Inline always wins, and reverting
    // to 'none' the moment the screen clears keeps the canvas clickable.
    const pe = this.blocking ? 'auto' : 'none';
    this.root.style.pointerEvents = pe;
    // Clear the OUTGOING screen too. This used to only ever set the incoming
    // one, so a screen that had been shown kept `pointer-events: auto` as an
    // inline style — which outranks any stylesheet — for the rest of the
    // session. Every `.kr-screen` stays displayed, so the title screen sat over
    // the race as a live, invisible pointer target from the first frame on.
    for (const name of Object.keys(this.screens) as BuiltScreen[]) {
      const e = this.screens[name];
      if (e) e.style.pointerEvents = name === want ? pe : 'none';
    }

    // Tell the touch layer a menu owns the screen. Without this the stick and
    // the action cluster stay drawn over every menu — the results board shipped
    // with a live DRIFT button on top of it and the fire button sitting across
    // the TOTAL row. Driving controls over a screen you cannot drive from are
    // decoration at best and a mis-tap at worst.
    //
    // Signalled as an attribute rather than a direct call because the menus must
    // not depend on the touch controls: they mount lazily, and on a browser that
    // lies about being a desktop they may not exist yet when this first runs.
    // CSS applies retroactively; a method call would have to be replayed. Same
    // shape as the existing `html[data-touch]` HUD reflow.
    if (want === 'none') delete document.documentElement.dataset.menu;
    else document.documentElement.dataset.menu = want;
  }

  // ------------------------------------------------------------------ input

  protected nav(dir: number) {
    if (dir === -1 || dir === 1) this.router.nav(dir);
  }

  /**
   * Keyboard confirm routes through the same `click()` the mouse uses, so the
   * 'confirm' SFX is emitted once, by the delegated listener in the ctor.
   */
  protected onConfirm(ctx: C, inRace: boolean) {
    if (this.router.confirm()) return;
    if (inRace) { this.localPause = true; this.ui('pause'); }
  }

  /** Menu SFX hook — the audio system listens for these on the bus. */
  protected ui(name: string) {
    this.ctx?.bus.emit({ type: 'ui', name });
  }

  protected startRace(ctx: C) {
    this.forced = null;
    this.localTitle = false;
    this.selecting = false;
    this.localPause = false;
    this.resultsBuilt = false;
    this.resultsFinished = -1;
    this.finishTimes.clear();
    // Hand the choice over BEFORE resetting. This line is the whole point of
    // the select screen: without it `this.selected` only ever moved a CSS
    // highlight, and every race was driven in machine 0 whatever was clicked.
    ctx.race.selectKart(this.selected);
    this.onStartRace(ctx);
    ctx.race.reset();
  }

  // ------------------------------------------------------------------ build

  protected makeScreen(cls: string) {
    const s = el('div', 'kr-screen ' + cls, this.root);
    el('div', 'kr-screen-in', s);
    return s;
  }

  protected syncCards() {
    for (let i = 0; i < this.cards.length; i++) {
      this.cards[i]!.classList.toggle('sel', i === this.selected);
    }
  }

  protected syncButtons() {
    const list = this.screen === 'pause' ? this.buttons.pause
      : this.screen === 'results' ? this.buttons.results : null;
    for (const group of [this.buttons.pause, this.buttons.results]) {
      for (let i = 0; i < group.length; i++) {
        group[i]!.classList.toggle('sel', group === list && i === this.btnIndex);
      }
    }
  }

  // ---------------------------------------------------------- shared screens

  /**
   * THE TITLE SCREEN. Mark, strapline, prompt, glyph row, keyboard legend, and
   * a Controls button that must stop propagation — a tap on it is not also the
   * tap-anywhere confirm, or opening the settings starts the race.
   *
   * `titlePrompt` / `titleGlyphs` / `titleHint` are built EMPTY and filled by
   * `syncTouchCopy` below. They were once filled here from a one-shot
   * `matchMedia('(pointer: coarse)')` probe in the constructor, which is
   * exactly the check that fails on the documented iPadOS "Request Desktop
   * Website" case: Safari claims `pointer: fine` and `maxTouchPoints: 0`, so an
   * iPad in desktop mode got on-screen controls and the words "Press Enter to
   * Start" above them. `Input` handles that with a lazy capture-phase mount on
   * the first real finger, and the menu copy has to come along.
   */
  protected buildTitleScreen(spec: TitleScreenSpec) {
    this.title = spec;
    const s = this.makeScreen('kr-s-title');
    const inner = s.firstElementChild as HTMLDivElement;
    const wrap = el('div', 'kr-stage', inner);
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'center';
    if (spec.gap) wrap.style.gap = spec.gap;
    wrap.innerHTML = spec.markHtml;
    el('div', 'kr-sub', wrap, spec.subText);
    this.promptLine = el('div', 'kr-prompt', wrap);
    this.glyphRow = el('div', 'kr-glyphs', wrap);
    this.keyLegend = el('div', 'kr-hint', wrap);
    const cbtn = el('div', 'kr-btn kr-btn-controls', wrap, spec.controlsLabel);
    cbtn.onclick = (e) => { e.stopPropagation(); this.controls.show(); };
    this.syncTouchCopy(false);
    return s;
  }

  /**
   * The title copy follows the device actually in use, and `input.touch` can
   * flip mid-session. Cached on the value, so `update` pays one compare a frame.
   *
   * This is why the glyph row exists at all. The only touch
   * onboarding used to be one line of `kr-hint` at `clamp(9px, 1.4vmin, 18px)`
   * — 1.4 vmin is 5.5 px on a 390-tall phone so it clamped to 9 px — at 44%
   * opacity: 1.5 mm of glyph, NAMING controls without showing where any of them
   * are, while the floating stick is invisible at rest. A first-run player had
   * no visual evidence a steering control existed. On touch that line is
   * replaced by miniature renderings of the ACTUAL controls at their actual
   * colours, each with one word beneath it at >= 14 px and full opacity. Same
   * information; nothing to read.
   */
  protected syncTouchCopy(touch: boolean) {
    if (this.touchCopyShown === touch) return;
    this.touchCopyShown = touch;
    const c = touch ? this.title.touch : this.title.keys;
    this.promptLine.textContent = c.prompt;
    this.glyphRow.innerHTML = c.glyphsHtml;
    this.keyLegend.innerHTML = c.hintHtml;
  }

  /**
   * THE PAUSE SCREEN, which carries the full running order.
   *
   * The eight-driver order used to be a permanent timing tower pinned to the
   * right-centre of the in-race HUD — the largest single element on screen,
   * sitting on the outside of every right-hand corner, occluding the rivals it
   * was describing. It belongs here and on the results screen, where the race
   * is stopped and eight rows are actually readable.
   */
  protected buildPauseScreen(spec: PauseScreenSpec) {
    this.pause = spec;
    const s = this.makeScreen('kr-s-pause');
    const inner = s.firstElementChild as HTMLDivElement;
    const box = el('div', 'kr-stage', inner);
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'center';
    box.style.width = '100%';
    if (spec.gap) box.style.gap = spec.gap;
    el('div', 'kr-pause-badge', box, spec.badge);
    el('div', spec.titleClass, box, spec.titleText);

    const grid = el('div', 'kr-pause-grid', box);
    const left = el('div', undefined, grid);
    el('div', 'kr-order-title', left, spec.orderTitle);
    this.orderBoard = el('div', 'kr-standings', left);
    const right = el('div', undefined, grid) as HTMLDivElement;
    right.style.display = 'flex';
    right.style.flexDirection = 'column';
    right.style.justifyContent = 'center';
    right.style.height = '100%';
    const list = el('div', 'kr-menu-list', right);

    const resume = el('div', 'kr-btn', list, spec.resumeLabel);
    // Clearing `localPause` alone is not enough: on a real race the director
    // owns the pause and `race.state` is `Paused`, which keeps `want` pinned to
    // this screen no matter what the UI's own flag says. Resume has to tell the
    // director too, or the button does nothing — which is exactly what it did.
    resume.onclick = () => {
      this.localPause = false;
      this.forced = null;
      this.ctx?.race.setPaused(false);
    };
    // Reachable MID-RACE, deliberately. `setScheme` releases every pointer and
    // zeroes the command and never touches the race director, so a player who
    // cannot steer can fix that without abandoning the race they are in.
    const ctrl = el('div', 'kr-btn', list, spec.controlsLabel);
    ctrl.onclick = () => this.controls.show();
    const restart = el('div', 'kr-btn', list, spec.restartLabel);
    restart.onclick = () => { this.localPause = false; this.forced = null; this.startRace(this.ctx); };
    const quit = el('div', 'kr-btn', list, spec.quitLabel);
    quit.onclick = () => {
      this.localPause = false;
      this.forced = null;
      this.localTitle = true;
      this.selecting = false;
      this.ctx.race.reset();
    };
    this.buttons.pause = [resume, ctrl, restart, quit];
    return s;
  }

  /** THE CLASSIFICATION BOARD's frame. `fillResults` puts the rows in it. */
  protected buildResultsScreen(spec: ResultsScreenSpec) {
    this.results = spec;
    const s = this.makeScreen('kr-s-results');
    const inner = s.firstElementChild as HTMLDivElement;
    this.resultsHead = el('div', spec.titleClass + ' kr-stage', inner, spec.titleText);
    const grid = el('div', 'kr-results-grid kr-stage', inner);
    if (spec.gridDelay) grid.style.setProperty('--d', spec.gridDelay);
    this.resultsBoard = el('div', 'kr-standings', grid);
    const right = el('div', undefined, grid) as HTMLDivElement;
    right.style.display = 'flex';
    right.style.flexDirection = 'column';
    this.lapsBoard = el('div', 'kr-laps', right);

    const list = el('div', 'kr-menu-list kr-stage', inner);
    if (spec.listDelay) list.style.setProperty('--d', spec.listDelay);
    const again = el('div', 'kr-btn', list, spec.againLabel);
    again.onclick = () => this.startRace(this.ctx);
    const title = el('div', 'kr-btn', list, spec.backLabel);
    title.onclick = () => { this.localTitle = true; this.selecting = false; this.forced = null; this.ctx.race.reset(); };
    this.buttons.results = [again, title];
    return s;
  }

  // ----------------------------------------------------------- shared boards

  /**
   * The running order, on the pause screen. Rebuilt only when the order (or the
   * lap the leader is on) actually changes — the pause screen is static and a
   * per-frame rebuild of eight rows would be eight allocations a frame for
   * nothing.
   */
  protected fillPauseOrder(ctx: C) {
    const spec = this.pause;
    const race = ctx.race;
    const player = race.player;
    const order = race.standings.length ? race.standings : race.karts;

    let key = '';
    for (let i = 0; i < order.length; i++) key += order[i]!.id + ':' + order[i]!.lap + '|';
    if (key === this.orderKey) return;
    this.orderKey = key;

    // Rebuilt rows must not re-deal the entrance animation on every reorder.
    this.orderBoard.classList.add('settled');
    this.orderBoard.textContent = '';
    order.forEach((k, i) => {
      const row = el('div', 'kr-row' + (k === player ? ' you' : ''), this.orderBoard);
      row.style.setProperty('--c', cssColor(k.stats.color));
      el('div', 'kr-row-p', row).innerHTML = spec.placeHtml(i);
      el('div', 'kr-row-c', row);
      // Full names, never truncated: the roster's longest name is authored and
      // the row is sized for it. `text-overflow: ellipsis` on content whose
      // maximum length you control is the loudest "unfinished" tell there is,
      // and the old in-race tower shipped truncated names in every captured
      // frame.
      el('div', 'kr-row-n', row, k.stats.name);
      el('div', 'kr-row-t', row, spec.orderCellText(k, race));
    });
  }

  /**
   * The classification board. May be called more than once per race — see the
   * rebuild note in `update`.
   */
  protected fillResults(ctx: C) {
    const spec = this.results;
    // Second and subsequent builds land on a board the player is already
    // reading; only the first one gets the staggered entrance.
    this.resultsBoard.classList.toggle('settled', this.resultsBuilt);
    this.resultsBuilt = true;
    const race = ctx.race;
    const player = race.player;
    const order = race.standings.length ? race.standings : race.karts;

    this.resultsHead.textContent = spec.resultsTitleText(player ? player.place : 1);

    this.resultsBoard.textContent = '';
    order.forEach((k, i) => {
      const row = el('div', 'kr-row' + (k === player ? ' you' : ''), this.resultsBoard);
      row.style.setProperty('--c', cssColor(k.stats.color));
      row.style.setProperty('--d', (spec.rowDelayBase + i * spec.rowDelayStep).toFixed(3) + 's');
      el('div', 'kr-row-p', row).innerHTML = spec.placeHtml(i);
      el('div', 'kr-row-c', row);
      el('div', 'kr-row-n', row, k.stats.name);
      // A racer who has not crossed yet has no time, so the column carries the
      // gap in metres instead. The PLAYER is the exception: the board goes up on
      // their crossing and the finish event may not have been stamped yet.
      const t = this.finishTimes.get(k.id);
      const gap = player ? k.raceDistance - player.raceDistance : 0;
      el('div', 'kr-row-t', row,
        t !== undefined ? formatClock(t)
          : k === player ? formatClock(race.raceTime)
            : `${gap >= 0 ? '+' : '−'}${Math.abs(Math.round(gap))} m`);
    });

    // lap times + best-lap callout
    this.lapsBoard.textContent = '';
    const laps = race.lapTimes;
    let best = -1;
    for (let i = 0; i < laps.length; i++) if (best < 0 || laps[i]! < laps[best]!) best = i;

    const callout = el('div', spec.bestClass, this.lapsBoard);
    el('b', undefined, callout, spec.bestLabel);
    el('em', undefined, callout, best >= 0 ? formatClock(laps[best]!, 3) : spec.noBestText);

    for (let i = 0; i < race.totalLaps; i++) {
      const line = el('div', 'kr-lapline' + (i === best ? ' best' : ''), this.lapsBoard);
      el('b', undefined, line, `${spec.lapLabel} ${i + 1}`);
      el('em', undefined, line, i < laps.length ? formatClock(laps[i]!, 3) : spec.noLapText);
    }
    const total = el('div', 'kr-lapline kr-lapline-total', this.lapsBoard);
    el('b', undefined, total, spec.totalLabel);
    el('em', undefined, total,
      formatClock(player ? (this.finishTimes.get(player.id) ?? race.raceTime) : race.raceTime, 3));
  }

  // ------------------------------------------------------------------ hooks

  /**
   * Which press confirms. Default is the item/fire button. The space racer reads
   * `weaponPressed` first — the retained alias `itemPressed` is set by the same
   * producers, so both games' behaviour is preserved exactly rather than
   * unified into whichever one looks tidier.
   */
  protected confirmPressed(input: C['input']['state']): boolean {
    return input.itemPressed;
  }

  /** Runs inside `init`, before the roster is filled. Empty here. */
  protected onInit(_ctx: C): void {}

  /**
   * Runs inside `startRace`, between `selectKart` and `reset`. Empty here.
   * The space racer hands the speed class over in it.
   */
  protected onStartRace(_ctx: C): void {}

  // --------------------------------------------------------------- abstract

  /** The roster of selectable racers. Pushes into `this.cards`. */
  protected abstract fillRoster(ctx: C): void;
}
