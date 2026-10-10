/**
 * The generated check of a rules game: its guarded module, linked with the real runtime, played in a worker thread
 * (rules-check-worker.mjs says what is played and what refuses a build).
 *
 * The play is bounded by its ALLOWANCE and by nothing else, so its verdict and every line it prints are the same on
 * every computer. No clock decides anything. The thread has a memory limit and a last-resort supervisor, for a fault of
 * Homie's own that would otherwise hang a build; what either says is that the check stopped, never that the game is wrong.
 */
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';

/**
 * How much is played, in the runtime's own units. A room's play ends when its ticks or its units are used up.
 *   ticks           ticks of the room's clock (at 20 a second, 18,000 is a quarter of an hour of play). A game whose
 *                   round is longer is played to the end of one round, up to twice this
 *   units           budget units, the unit a tick's budget is counted in: what every handler of the room used, and
 *                   what each person's browser used running the game's `move` for its own body
 *   everyTick       the room is rebuilt from its save and compared before every one of this many first ticks,
 *   every           and before every so-many-th tick after that,
 *   restoreBytes    until this many bytes of save have been rebuilt
 *   companionTicks  a game with companions is played a second, short time with them seated: this many ticks, on an
 *                   eighth as many units and bytes again
 * A light game uses its ticks, a second or two of processor time. A heavy one uses its units: about five seconds.
 */
export const ALLOWANCE = Object.freeze({ ticks: 18_000, units: 280_000_000, everyTick: 200, every: 29, restoreBytes: 8_000_000, companionTicks: 2_400 });
/** `homie-studio build --long-check`: eight times the play, for a person or a CI run that wants it. */
export const LONG_ALLOWANCE = Object.freeze({ ...ALLOWANCE, ticks: 8 * ALLOWANCE.ticks, units: 8 * ALLOWANCE.units, restoreBytes: 8 * ALLOWANCE.restoreBytes, companionTicks: 8 * ALLOWANCE.companionTicks, full: true });

/** The ordered declarations a save depends on. Functions contribute their presence, never their implementation. */
export function stateHash(c) {
  const { kinds, events, commands, effects, shared, rounds, bots, roomOn, asks, map: geometry, dims, contract, seats, save } = c;
  // Keep existing 2D save compatibility hashes when the 3D map vocabulary grows.
  const map = dims === 2 ? { name: geometry.name, bounds: geometry.bounds, boxes: geometry.boxes, circles: geometry.circles, spots: geometry.spots } : geometry;
  return createHash('sha256').update(JSON.stringify({ kinds, events, commands, effects, shared, rounds, bots, roomOn, asks, map, dims, contract, seats, tickHz: c.settings.tickHz, save }, (k, v) => typeof v === 'function' ? true : v)).digest('hex').slice(0, 32);
}

/**
 * Run a linked bundle (rules-build.mjs `loadRules` with `bundleOnly`) in the worker. Resolves with what the worker
 * found; rejects with the lines to fix. `data` is { id, tune, map, room, seats, vocab, sites }.
 */
export function runRulesWorker(bundle, data, { declarationsOnly = false, allowance = ALLOWANCE, memoryMb = 512, superviseSeconds = 3600 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false; let beats = 0;
    const worker = new Worker(new URL('./rules-check-worker.mjs', import.meta.url), {
      workerData: { bundle, data, declarationsOnly, allowance: { ...ALLOWANCE, ...allowance } },
      execArgv: [], // The bundle is self-contained; the parent's flags and loaders do not belong in this worker.
      resourceLimits: { maxOldGenerationSizeMb: memoryMb, stackSizeMb: 4 },
    });
    const finish = async (error, result) => {
      if (done) return;
      done = true; clearInterval(supervisor);
      await worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const stopped = (how) => new Error(`games/${data.id}: the check itself stopped ${how}, before it could decide anything about this game. This is a fault in Homie's check, not in the game's rules: report the game with this message.`);
    // The play ends by its allowance, hundreds of times sooner than this. Beats are counted, not a clock read, so a
    // computer that slept is not mistaken for a check that hung.
    const supervisor = setInterval(() => { if ((beats += 1) > superviseSeconds) finish(stopped(`after running for more than ${superviseSeconds} seconds`)); }, 1000);
    supervisor.unref();
    worker.on('message', (m) => { if (m.error) finish(new Error(m.error)); else finish(null, m.result); });
    worker.on('error', (e) => finish(stopped(e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? `when it passed its ${memoryMb} MB of memory` : `with an error of its own (${e.message})`)));
    worker.on('exit', (code) => finish(stopped(`when its thread exited (${code})`)));
  });
}

/** The same, from a game's guarded and linked module (`code`: rules-guard.mjs `guardRules`). */
export async function checkRules(esbuild, root, id, code, data, options = {}) {
  // Imported here, not at the top: the worker imports this file for `stateHash`, and has no use for the build's tools.
  const { loadRules } = await import('./rules-build.mjs');
  return runRulesWorker(await loadRules(esbuild, root, id, code, { bundleOnly: true }), { id, ...data }, options);
}
