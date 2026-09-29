/**
 * ===========================================================================
 *  @homie-rocks/bus/KeyedBus.ts — the same pub/sub, dispatched PER EVENT TYPE.
 * ===========================================================================
 *
 * Taken from a base-building game's own bus. The package already had a bus;
 * the game's is different in a way that is measurably better for one shape of
 * caller, so the package takes the game's version rather than the game
 * keeping a private copy of it.
 *
 * ── THIS DOES NOT CONTRADICT `Bus.ts`'s HEADER. READ BOTH. ─────────────────
 *
 * `Bus.ts` records that the first version of that package WAS keyed by event
 * name and that it was "the wrong extraction". That argument is about the
 * EVENT VOCABULARY, and it is still right:
 *
 *   > Reduce what is the same THING; parameterise what is only the same SHAPE.
 *   > … a lap event and a weapon event and a colony-tick event are the game,
 *   > and game vocabulary stays out of shared code.
 *
 * Nothing here knows an event name. `M` is the game's map, declared in the
 * game, exactly as `E` is in `Bus.ts`. What the two files actually disagree
 * about is DISPATCH, and the disagreement is real:
 *
 *   `Bus<E>`      one handler set. Every emit walks every subscriber, and the
 *                 subscriber decides whether the event was for it. 179 emit
 *                 sites across three racers are written that way and rewriting
 *                 them buys nothing.
 *   `KeyedBus<M>` one set per type. An emit walks only the handlers for that
 *                 type, and an event with no listeners costs one Map lookup.
 *
 * The game's own comment is the reason it needs the second one, and it is a
 * measurement rather than a preference: *"`step` fires at 60 Hz from the
 * capture harness and must not walk every listener in the game."* Nine of its
 * ten event types fire at most a handful of times in a session; one fires
 * sixty times a second. Under `Bus<E>` that one event pays for all ten.
 *
 * So they are two mechanisms, not two spellings, and both are in this package
 * on purpose. A game picks by asking whether it has a hot event.
 *
 * ── WHY A CLASS AND NOT A MODULE SINGLETON ─────────────────────────────────
 *
 * The game's version was module state — `const handlers = new Map()` at file
 * scope, with `on`/`emit`/`clearBus` as free functions. That is fine while
 * exactly one world exists per page, and it stops being fine the moment two do:
 * a split-screen experience, a second embedded page, or a test that builds
 * two worlds in one process to compare them. `clearBus()` existing at all is
 * the tell — it is a teardown for state that belongs to nothing.
 *
 * The instance keeps the game's API otherwise, verbatim, including the
 * unsubscribe closure, the once-wrapper and the swallow.
 */

/** A handler for one event type. Must not throw; if it does, the others run. */
export type KeyedHandler<P> = (payload: P) => void;

/** Unsubscribe. Calling it twice is harmless. */
export type Unsubscribe = () => void;

/**
 * `M` is the game's event map: `{ scenario: { name: string }, … }`. Nothing in
 * this file constrains the keys or the payloads.
 */
export class KeyedBus<M> {
  /**
   * Handlers stored PER TYPE rather than in one set. See the header: this is
   * the whole difference between this class and `Bus<E>`.
   */
  private readonly handlers = new Map<keyof M, Set<KeyedHandler<never>>>();

  /**
   * Subscribe. Returns the unsubscribe closure — keep it, because a subsystem
   * that is rebuilt on a quality change and re-subscribes without
   * unsubscribing runs its handler twice, which for a reset event means
   * resetting a world that a later handler has already re-seeded.
   */
  on<K extends keyof M>(type: K, fn: KeyedHandler<M[K]>): Unsubscribe {
    let set = this.handlers.get(type);
    if (set === undefined) this.handlers.set(type, (set = new Set()));
    set.add(fn as KeyedHandler<never>);
    return () => { set!.delete(fn as KeyedHandler<never>); };
  }

  /** Subscribe for exactly one dispatch. */
  once<K extends keyof M>(type: K, fn: KeyedHandler<M[K]>): Unsubscribe {
    const off = this.on(type, ((p: M[K]) => { off(); fn(p); }) as KeyedHandler<M[K]>);
    return off;
  }

  /**
   * Dispatch, synchronously, in subscription order.
   *
   * The try/catch is deliberate and is not a catch-all that hides failures:
   * nothing is returned, no value is invented, and the failure is printed with
   * the event type that caused it. What it buys is that one bad subscriber
   * cannot take the frame down with it — this is called from inside a render
   * loop and from inside a test harness's step, and an exception there takes
   * the render with it. One game lost every frame's render from ~20 s onward
   * to exactly this shape of bug, read for weeks as console noise.
   */
  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (set === undefined) return;
    for (const h of set) {
      try {
        (h as KeyedHandler<M[K]>)(payload);
      } catch (err) {
        console.error('[bus] handler threw for "' + String(type) + '"', err);
      }
    }
  }

  /** Drop every listener. Only a full teardown should need this. */
  clear(): void { this.handlers.clear(); }
}
