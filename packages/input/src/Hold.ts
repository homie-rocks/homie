/**
 * ============================================================================
 *  Hold.ts — "keep pressing it and something else happens", once.
 * ============================================================================
 *
 *  ## WHY THIS EXISTS, AND THE REASON IT DID NOT
 *
 *  A drum-machine game shipped this recogniser THREE TIMES IN ONE FILE — once
 *  for a pointer on the screen, once for a key, once for a button on a phone —
 *  each with its own `Map` of down-times, its own membership set of what had
 *  already fired, its own string-prefixed key space and its own copy of the
 *  crossing test. Its own comment recorded the decision not to publish it:
 *  one consumer, so not yet.
 *
 *  **That reasoning is wrong.** "Is there a twin" is the question that called
 *  another game clean for twelve iterations while it carried a whole renderer
 *  with exactly one copy. The question is whether a DRUM MACHINE needs to know
 *  how to time a long press, and it does not — a menu, a photo mode, a
 *  hold-to-confirm and a charge shot all need the same thing. There were three
 *  copies inside the one consumer, which is the strongest possible form of the
 *  argument and was visible from the file itself.
 *
 *  ## WHAT IT IS, AND WHAT MAKES IT MORE THAN A TIMESTAMP MAP
 *
 *  Three properties, and each is a defect somebody has shipped:
 *
 *  1. **IT FIRES ON A TIMER READ, NOT ON THE RELEASE.** Erasing on release
 *     means a player holds a ring, nothing happens, they let go, and it clears
 *     — a full second after they stopped believing it worked. Firing at the
 *     threshold means the thing goes dark UNDER THE FINGER THAT IS STILL ON IT,
 *     which is the only feedback that reads as cause. So the caller polls
 *     `fired(now)` from its own update rather than being called back from an
 *     event.
 *
 *  2. **ONE HOLD FIRES ONCE.** Without the fired-mark, a finger left on a pad
 *     re-fires every frame past the threshold — sixty erases a second, which
 *     for a destructive gesture is the difference between "it cleared" and
 *     "everything is gone". The mark is cleared by `up`, and by a fresh `down`,
 *     so a re-press is a new hold.
 *
 *  3. **ONE THRESHOLD, ONE CLOCK, ONE PLACE.** The drum machine's own comment
 *     makes the argument and it is general: *"A phone that timed its own hold
 *     would be a second recogniser with its own idea of 600 ms, and the two
 *     would disagree on a slow LAN in a way that reads as the machine being
 *     inconsistent."* Every transport a game owns feeds ONE of these.
 *
 *  ## WHAT IT IS NOT
 *
 *  Not a gesture library. No double-tap, no swipe, no long-press-then-drag, no
 *  repeat-while-held. Every one of those is a thing SOME game needs and no game
 *  needs all of; adding them now would be picking a genre for the package on
 *  the evidence of one consumer, which is the mistake `@homie-rocks/postfx`'s
 *  `ChainWorld` made when it grew `speedIntensity` and two non-racers had to
 *  disagree with it in writing before it came back out.
 *
 *  **AND THE HONEST LABEL, WHICH TRAVELS WITH THE CODE.** A hold is a TOUCH
 *  gesture, and CDP touch events bypass the browser's gesture arbitration. A
 *  probe drives this class's arithmetic with an injected clock and proves the
 *  timing; **whether 600 ms fights iOS's own long-press under an actual thumb
 *  is UNVERIFIED until a person holds one**, and no automated probe can answer
 *  it.
 * ============================================================================
 */

/**
 * A set of things that are currently being held down, and which of them have
 * been held long enough.
 *
 * `K` is whatever the caller wants back when one fires — a track index, an
 * action name, an object. The class never looks inside it.
 *
 * THE CLOCK IS THE CALLER'S, passed in on every call, and that is not a
 * convenience. A class that read `performance.now()` itself could not be driven
 * by a harness at times of its choosing, could not be driven by an audio clock,
 * and would be a second clock in a program whose whole premise is that there is
 * one — the drum machine this came from exists to make exactly that point
 * about its own audio.
 */
export class HoldSet<K> {
  /** Milliseconds a press has to last. No default: how long is the game's. */
  readonly thresholdMs: number;

  /** id -> when it went down, and what to hand back. */
  readonly #down = new Map<string, { at: number; key: K }>();
  /** ids whose current hold has already fired. Cleared by `up` and by `down`. */
  readonly #fired = new Set<string>();

  constructor(thresholdMs: number) {
    this.thresholdMs = thresholdMs;
  }

  /**
   * Something went down. `id` is the caller's key space — a pointer id, a key
   * code, a seat-and-control pair — and two transports must not collide in it,
   * which is why the caller owns the spelling and this class never invents one.
   *
   * A fresh `down` on an id that is already held RESTARTS the hold and clears
   * its fired mark, because a re-press is a new gesture. That also makes the
   * poll-driven case work: a pad's rising edge arrives as a `down` whether or
   * not the previous release was ever seen.
   */
  down(id: string, key: K, now: number): void {
    this.#down.set(id, { at: now, key });
    this.#fired.delete(id);
  }

  /** Released, or cancelled. Idempotent, because `pointercancel` doubles up. */
  up(id: string): void {
    this.#down.delete(id);
    this.#fired.delete(id);
  }

  /** Is this id down right now? */
  has(id: string): boolean {
    return this.#down.has(id);
  }

  /**
   * Everything that has now been held long enough and has not already fired.
   *
   * Returns the caller's keys rather than the ids, in insertion order, and
   * marks each one fired on the way out — so calling this twice in one frame
   * yields the second call nothing, which is the behaviour a caller that polls
   * from two places needs and is easy to get wrong the other way.
   *
   * ALLOCATES ONLY WHEN SOMETHING FIRES. The common case — a frame in which
   * nothing has crossed — returns the same frozen empty array every time, so
   * this may be called sixty times a second from an update loop.
   */
  fired(now: number): readonly K[] {
    let out: K[] | null = null;
    for (const [id, rec] of this.#down) {
      if (now - rec.at < this.thresholdMs || this.#fired.has(id)) continue;
      this.#fired.add(id);
      (out ??= []).push(rec.key);
    }
    return out ?? EMPTY;
  }

  /** Everything up. For a blur, a phase change, or a seat leaving. */
  clear(): void {
    this.#down.clear();
    this.#fired.clear();
  }
}

/** One frozen array, returned on every frame in which nothing fired. */
const EMPTY: readonly never[] = Object.freeze([]);
