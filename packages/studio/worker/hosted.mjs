/**
 * Server-hosted games: the rules this studio's build put into its Worker, and the host runtime a Table runs for one
 * room of such a game (NETPLAY.md section 29; rules/host.ts is the runtime, worker/room.mjs the relay it serves).
 *
 * `homie-studio build` writes every server-hosted game's rules, guarded (lib/rules-guard.mjs), into the studio's
 * site/src/rules/, with a table of them (site/src/rules/index.mjs): per game its rules module, its tunables, its map,
 * its settings and its seats. The studio's site/src/worker.mjs hands that table over once, when the Worker loads:
 *
 *   import { hostRules } from '@homie-rocks/studio/worker';
 *   import rules from './rules/index.mjs';
 *   hostRules(rules);
 *
 * Only the studio's own games are in it: no rules from outside the studio run on its server. The rules run in this
 * Worker's isolate, behind the build's wall and the runtime's budget, until rules get an isolate of their own.
 */
import { createHost } from '../rules/host.ts';
import { compileMap, compileRules } from '../rules/rules.ts';

/** game id → { rules, tune, map, settings, seats, build } as the build wrote it, and what compiling each gave. */
const games = new Map();
const compiled = new Map();

/** The table of this studio's server-hosted games (the build's site/src/rules/index.mjs). Called once, at load. */
export function hostRules(table) {
  games.clear();
  compiled.clear();
  if (!table || typeof table !== 'object') return 0;
  for (const [id, entry] of Object.entries(table)) if (entry && typeof entry === 'object' && entry.rules) games.set(id, entry);
  return games.size;
}

/** Whether this Worker holds rules for a game. */
export const hostedGame = (id) => games.has(id);

/** A game's rules, compiled once per isolate. Throws, naming the declaration, when they do not fit the contract. */
export function compiledFor(id) {
  if (compiled.has(id)) return compiled.get(id);
  const e = games.get(id);
  if (!e) throw new Error('this build of the site holds no rules for this game');
  const c = compileRules(e.rules, { tune: e.tune, map: compileMap(e.map, e.map?.name ?? 'main'), settings: e.settings, seats: e.seats });
  compiled.set(id, c);
  return c;
}

/**
 * The host runtime for one room. `send(frame, text)` is the relay's `hostFrame`; the clock is the Worker's own, and the
 * tick loop a timer chain inside the object. Nothing is stored yet: the room's save arrives with the next release.
 */
export function startHost(game, { send, log, onPause, onResume, onEnd }) {
  return createHost({
    game, build: games.get(game)?.build ?? undefined, compiled: compiledFor(game), send, log, onPause, onResume, onEnd,
    clock: { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h) },
    store: null,
  });
}
