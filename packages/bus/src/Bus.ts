/**
 * Trivial synchronous pub/sub, generic over the event type the game defines.
 *
 * ## Why this is generic and not typed per event
 *
 * The first version of this package was a typed per-event bus —
 * `Bus<M extends AnyEventMap>`, handlers keyed by event name. It was better
 * code and it was the wrong extraction, by a rule this codebase follows:
 *
 *   > **Reduce what is the same THING; parameterise what is only the same
 *   > SHAPE.**
 *
 * Measured across the three games that owned a `Bus` on 2026-08-19: **179
 * `.emit()` call sites and 20 `.on()` sites**, against `GameEvent` unions of
 * **13, 24 and 16 variants — no two alike**. The *mechanism* (dispatch
 * synchronously, never let one handler's throw stop the others) is the same
 * thing in all three. The *vocabulary* is not, and it never will be: a lap
 * event and a weapon event and a colony-tick event are the game, and game
 * vocabulary stays out of shared code.
 *
 * So `E` is the seam. The game declares its own union in its own `types.ts` and
 * hands it in. Nothing here knows what an event *is*, only that handlers get
 * given one.
 *
 * ## Why it is byte-for-byte the behaviour it replaces
 *
 * Every one of those 179 call sites has to compile and behave identically, or
 * the extraction cannot be told apart from a regression — which is the argument
 * for doing parity first and landing improvements separately, where a single
 * before-and-after shows what they bought. The API, the swallow, and the
 * console line are the games' own, unchanged, down to the `[bus]` prefix and
 * the argument order.
 *
 * A game's `IBus` interface stays in the game's `types.ts` and is satisfied
 * structurally — `const bus: IBus = new Bus<GameEvent>()` type-checks with no
 * `implements` clause, so nothing in this package has to import a game.
 */

/** A handler. Must not throw; if it does, the others still run. */
export type EventHandler<E> = (e: E) => void;

/** Unsubscribe. Calling it twice is harmless. */
export type Unsubscribe = () => void;

export class Bus<E> {
  private handlers = new Set<EventHandler<E>>();

  /**
   * Dispatch to every handler, synchronously, in subscription order.
   *
   * The try/catch is deliberate and is not a catch-all that hides failures:
   * nothing is returned, no value is invented, and the failure is printed with
   * the event type that caused it. What it buys is that one bad subscriber
   * cannot take the frame down with it — in a render loop that is the
   * difference between a visible glitch and a black screen. The games' own
   * comment said it in one line: *"Handlers must never throw; we swallow if
   * they do."*
   */
  emit(e: E): void {
    for (const h of this.handlers) {
      try {
        h(e);
      } catch (err) {
        console.error('[bus] handler threw for', (e as { type?: unknown })?.type, err);
      }
    }
  }

  /** Subscribe. Returns the unsubscribe. */
  on(h: EventHandler<E>): Unsubscribe {
    this.handlers.add(h);
    return () => { this.handlers.delete(h); };
  }
}
