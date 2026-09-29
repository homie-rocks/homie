/**
 * ============================================================================
 *  The autoplay gate — the browser's rule, obeyed once instead of per game.
 * ============================================================================
 *
 * No page may start audio until a person has touched it. That single rule
 * produces four pieces of code that every WebAudio consumer writes identically
 * and gets subtly wrong in the same four ways:
 *
 *  1. LISTEN ON THREE EVENTS, NOT ONE. `pointerdown` alone misses a keyboard
 *     player entirely, and older iOS Safari only counts `touchstart`.
 *  2. LATER GESTURES ARE NOT NO-OPS. The browser suspends a context when the
 *     tab is backgrounded, when a phone call arrives, when the OS decides.
 *     Every gesture after the first has to nudge it back or the game goes
 *     silent for the rest of the session with nothing in the console.
 *  3. `visibilitychange` IS A SEPARATE OBLIGATION. A context left running in a
 *     hidden tab keeps a phone's audio hardware awake, and iOS kills the tab.
 *  4. NO AUDIO AT ALL MUST NOT TAKE THE FRAME LOOP WITH IT. A refused or
 *     exhausted AudioContext, or a page with no AudioContext constructor
 *     (a headless capture harness, a locked-down embed), has to leave the game
 *     fully playable in silence. That is what `failed` is: a latch, checked
 *     first, never unset.
 *
 * A kart racer's Audio.ts and a space racer's carried all four BYTE-IDENTICALLY,
 * one comment line apart, and this is where they live now.
 *
 * ## What is NOT here
 *
 * The graph. `build()` is the host's, and it is where the two games differ
 * completely — buses, sends, reverb levels, which voices exist. The gate never
 * learns what a voice is; it only knows that something can be built, might fail,
 * and must be nudged.
 *
 * This file imports nothing, and neither does `packages/audio/src` as a whole
 * from outside itself — see Voice.ts's note.
 */

/**
 * What the gate needs from its consumer. Three callbacks, no types crossing.
 */
export interface GateHost {
  /**
   * The live context, or null before the first gesture built one. This is the
   * gate's ONLY way of asking "is audio up yet", so it must return null until
   * `build` has actually succeeded.
   */
  context(): AudioContext | null;
  /**
   * The volume to build at, or null if the consumer is not ready to be built —
   * the gate then does nothing and waits for the next gesture. Both games
   * return null until `init` has handed them their world, because a gesture can
   * land before a system has been initialised and building against half a game
   * is worse than staying silent for one more press.
   */
  volume(): number | null;
  /** Build the graph. Return false if audio is unavailable at all. */
  build(ac: BaseAudioContext | null, volume: number): boolean;
}

export class AudioGate {
  private readonly host: GateHost;

  /**
   * LATCHED, AND DELIBERATELY NEVER UNSET. Once we know this page cannot have
   * audio, every later gesture must be free — retrying a refused AudioContext
   * on every pointerdown is how a page ends up allocating contexts until the
   * tab dies.
   */
  private latched = false;

  private readonly onGesture = () => this.unlock();
  private readonly onVisibility = () => this.syncSuspend();

  constructor(host: GateHost) {
    this.host = host;
  }

  /** True once this page has been found to have no usable audio at all. */
  get failed(): boolean {
    return this.latched;
  }

  /** Mark audio unavailable. The consumer's own `build` calls this on a throw. */
  fail(): void {
    this.latched = true;
  }

  /**
   * Start listening for the gesture. Until one arrives the consumer is inert —
   * which is exactly what a headless capture harness needs, and why this is not
   * a failure state.
   *
   * The `try` is not decoration: in a context with no `document` (a worker, a
   * server-side render, a probe that imported the module without a page) these
   * throw, and a game that cannot register a listener is a game that will never
   * have audio, which is `failed` rather than a crash.
   */
  listen(): void {
    try {
      addEventListener('pointerdown', this.onGesture, { passive: true });
      addEventListener('touchstart', this.onGesture, { passive: true });
      addEventListener('keydown', this.onGesture);
      document.addEventListener('visibilitychange', this.onVisibility);
    } catch {
      this.latched = true;
    }
  }

  /** Detach. Safe to call when `listen` threw or was never called. */
  release(): void {
    try {
      removeEventListener('pointerdown', this.onGesture);
      removeEventListener('touchstart', this.onGesture);
      removeEventListener('keydown', this.onGesture);
      document.removeEventListener('visibilitychange', this.onVisibility);
    } catch {
      /* nothing to do */
    }
  }

  /**
   * A gesture happened. Build the graph if it does not exist, and otherwise
   * nudge a context the browser suspended on us.
   */
  unlock(): void {
    if (this.latched) return;
    const live = this.host.context();
    if (live) {
      // Later gestures just nudge a context the browser suspended on us.
      if (live.state !== 'running') live.resume().catch(() => {});
      return;
    }
    const volume = this.host.volume();
    if (volume === null) return;
    const AC = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    if (!AC) {
      this.latched = true;
      return;
    }
    if (this.host.build(null, volume)) this.host.context()?.resume().catch(() => {});
  }

  /**
   * Suspend while the tab is hidden, resume when it comes back. Wrapped because
   * `document` may be gone during a teardown and a throw here would take the
   * page's own visibility handling with it.
   */
  syncSuspend(): void {
    const live = this.host.context();
    if (!live) return;
    try {
      if (document.hidden) live.suspend().catch(() => {});
      else live.resume().catch(() => {});
    } catch {
      /* not fatal */
    }
  }
}
