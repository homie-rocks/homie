/**
 * ===========================================================================
 *  @homie-rocks/loop/Contracts.ts — the two declarations every 3D game's
 *  `types.ts` would otherwise write out by hand.
 * ===========================================================================
 *
 * WHAT THIS IS. `Host.ts` already declares the members the FRAME calls on a
 * subsystem (`LoopSystem`) and `Boot.ts` the one the BOOT calls
 * (`BootSystem`), and its header says the two are deliberately separate
 * interfaces because a game's `System` satisfies both and neither implies the
 * other. This is the `System` that satisfies both — the declaration the games
 * this was extracted from each carried, character for character, in their own
 * `types.ts`. `System`, `IBus`, `Settings` and the engine half of `Ctx` made
 * up the longest verbatim run duplicated between them.
 *
 * ---------------------------------------------------------------------------
 * WHAT A GAME STILL OWNS, and why none of it is here
 *
 *   `Ctx`            its own subsystem fields — `track`/`race`/`items` in a
 *                    racer, `map`/`match`/`combat`/`player`/`hurt` in a
 *                    shooter. The ENGINE half is
 *                    `@homie-rocks/render/World.ts`'s `EngineCtx`, which is
 *                    where it has to live because it names six three.js types
 *                    and this package refuses to import three (it has no three
 *                    dependency).
 *   `GameEvent`      the discriminated union. Thirteen, twenty-five and sixteen
 *                    members in the three original games, and every one of
 *                    them names something in that game.
 *   `EventHandler`   one line per game, because it names that game's union.
 *   `Surface`,       the const enums. They are the game's vocabulary and,
 *   `RaceState` …    separately, test tools PARSE them out of the game's own
 *                    source — a `const enum` does not exist at run time under
 *                    type stripping, so moving one silently blinds an
 *                    instrument that keeps reporting green.
 *
 * NOTHING HERE IMPORTS `three`, for the reason `Host.ts` states at length.
 * Nothing here imports anything at all outside this package.
 */

import type { BootSystem } from './Boot.ts';
import type { LoopSystem } from './Host.ts';

/**
 * A subsystem, exactly as the original games declared it.
 *
 * Composed from the two seams that already existed rather than re-listing
 * their members: `BootSystem` contributes `init`, `LoopSystem` contributes
 * `update` / `lateUpdate` / `resize`, and `dispose` is the one member neither
 * of them had a caller for. That composition is the point — it is now
 * IMPOSSIBLE for a game's `System` to satisfy the boot walk and not the frame
 * loop, which was previously true only because separate files agreed.
 *
 * Every member is optional, and that is not laxity: the games' arrays mix
 * systems that implement one, two, three or none of them, and the boot walk
 * and the frame loop both call through `?.`.
 */
export interface System<W> extends BootSystem<W>, LoopSystem<W> {
  /** Release GPU and DOM resources. Nothing in the shipped boot calls it. */
  dispose?(): void;
}

/**
 * The fire-and-forget event bus, through the two members a game's `IBus`
 * declared. `@homie-rocks/bus/Bus.ts` is the implementation the games construct;
 * this is the shape their `Ctx` holds it by.
 *
 * Generic over the event union rather than over a `type` string, because the
 * union is the one part of this that is genuinely each game's: `on` returns
 * the unsubscribe function and a handler that has narrowed on `e.type` has to
 * see that game's members.
 */
export interface Bus<E> {
  emit(e: E): void;
  on(h: (e: E) => void): () => void;
}
