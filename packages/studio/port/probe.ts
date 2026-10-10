/*
 * What `homie-studio port check` reads inside a ported game: one object on
 * window.__homiePort, sampled every frame into a ring buffer, so the owner
 * tests can judge motion on SCREEN axes (the camera's, not the game's):
 *
 *   hold a direction 5 s     → one straight line the pressed way, camera yaw change < 10°
 *   alternate directions 10 s → every press goes the pressed way within 600 ms
 *
 * A port calls exposePort() once. `self` is the player's own body on the
 * ground plane; `basis` is the camera's screen axes on that plane (the default
 * is a flat 2D view: x right, y down). Board and turn-based games have no body:
 * they report `lastMove` (the direction the game APPLIED) instead, and the
 * check presses and swipes and compares.
 */
import type { Netplay } from '../netplay/netplay';
import { audioReport } from './audio';
import { sandboxReport } from './sandbox';

export type View = 'top' | 'side' | 'first-person' | 'board' | 'maze';

export interface PortProbeOptions {
  /** top: top-down or three-quarter (all four directions move you); side: a side view (left/right run, up jumps);
   *  first-person: WASD strafes on the camera's axes; board: no body (grid, cards, puzzle); maze: a top view on
   *  a grid of corridors whose turns are buffered (a turn into a wall waits for the next opening). */
  view: View;
  /** My body's position on the ground plane (2D: canvas x, y with y down; 3D: world x and z). null = no body yet. */
  self?: () => { x: number; y: number } | null;
  /** The camera's screen-right and screen-up directions on that plane. Default (2D): right (1,0), up (0,-1). */
  basis?: () => { right: [number, number]; up: [number, number] };
  /** About how big a body is, in the same units (a radius or half a width). The checks scale distances by it. */
  size?: number;
  /** Board games: the last move the game applied ('left' | 'right' | 'up' | 'down' | any word) and a counter. */
  lastMove?: () => string | null;
  moves?: () => number;
  /** My score right now, if the game has one. */
  score?: () => number | null;
  /** True while my body is not mine to steer (knocked back, stunned, dead, respawning): the owner tests skip
   *  those frames, and the recipe's newcomer rule says it should rarely happen in a person's first seconds. */
  busy?: () => boolean;
  /**
   * Anything else worth a look in a receipt (numbers or short strings), each a function read when asked. The names
   * in `PortExtra` are read BY NAME by the instruments (the playtest skill, `homie-studio perf`, `shoot`): set the
   * ones this game has, and its rows say what state each press and picture was taken in. Any other name is kept
   * in the receipt as it is.
   */
  extra?: PortExtra & Record<string, () => unknown>;
  /** The keys that move you (KeyboardEvent.code). Default: the arrows (WASD for first-person). */
  keys?: { up: string; down: string; left: string; right: string };
  /** Where the check puts a thumb for the stick, as screen fractions (default [0.24, 0.74]). */
  thumb?: [number, number];
  /** CSS selector of the game's own world when it is HTML (a DOM board, a grid of tiles): the check counts it as
   *  the world, not as UI covering the screen. A canvas game needs nothing here. */
  world?: string;
}

/**
 * THE STATE HOOKS THE INSTRUMENTS READ BY NAME (all optional). A playtest that cannot tell a dead body from a broken
 * control, or a perf run that cannot see the renderer's own counters, says "unknown" or "not exposed" where one of
 * these lines would have given it the answer.
 *
 *   exposePort(net, { view: 'top', self, busy,
 *     extra: { alive: () => me.hp > 0, mode: () => hud.mode, loadout: () => me.weapon,
 *              drawCalls: () => renderer.info.render.calls, triangles: () => renderer.info.render.triangles } });
 *
 * The round (`info().round`: { n, phase: 'live' | 'over', endsAt, leftMs }) needs no hook: it is the room's own, from
 * `net.round(...)`, which `createRoom` calls for every round it runs. So are `info().link` and `info().reconnects`
 * (where this browser stands with its room, and how often that was interrupted).
 */
export interface PortExtra {
  /** The local body is alive. false: spectating until the next round (a press that moves nothing is then not a broken control). */
  alive?: () => boolean;
  /** The control mode on screen, in a word or two ("manual fire", "auto", "driving"): it changes what a press does. */
  mode?: () => string;
  /** What the player holds (a weapon, a tool), when it changes which controls show. */
  loadout?: () => string;
  /** A thumb is down on the game's own stick right now. */
  touchHeld?: () => boolean;
  /** The renderer's last frame, for measured scene cost (three.js: `renderer.info.render.calls` / `.triangles`). */
  drawCalls?: () => number;
  triangles?: () => number;
}
/** The names above, for a test and for anything that lists what a probe may say. */
export const PORT_EXTRA_NAMES = ['alive', 'mode', 'loadout', 'touchHeld', 'drawCalls', 'triangles'] as const;

interface PortProbe {
  v: 1;
  view: View;
  size: number;
  keys: { up: string; down: string; left: string; right: string };
  thumb: [number, number];
  world: string | null;
  /** Rows since `t` (performance.now ms): [t, x, y, rightX, rightY, upX, upY, moves, busy (1/0)]. */
  rows(since?: number): number[][];
  now(): number;
  info(): Record<string, unknown>;
  errors: string[];
}

const RING = 4000;

export function exposePort(net: Netplay<unknown, unknown, unknown> | null, opts: PortProbeOptions): PortProbe {
  const rows: number[][] = [];
  let frames = 0;
  const frameTimes: number[] = [];
  const errors: string[] = [];
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => { errors.push(String((e as ErrorEvent).message ?? e).slice(0, 300)); if (errors.length > 50) errors.shift(); });
    window.addEventListener('unhandledrejection', (e) => { errors.push(`unhandled: ${String((e as PromiseRejectionEvent).reason).slice(0, 300)}`); if (errors.length > 50) errors.shift(); });
  }
  const flat = (): { right: [number, number]; up: [number, number] } => ({ right: [1, 0], up: [0, -1] });
  const basisOf = opts.basis ?? flat;
  const sample = (t: number): void => {
    frames += 1;
    frameTimes.push(t); if (frameTimes.length > 120) frameTimes.shift();
    let me: { x: number; y: number } | null = null;
    try { me = opts.self ? opts.self() : null; } catch { me = null; }
    let b = flat();
    try { b = basisOf(); } catch { /* keep flat */ }
    let m = 0;
    try { m = opts.moves ? Number(opts.moves()) || 0 : 0; } catch { /* ignore */ }
    let busy = 0;
    try { busy = opts.busy && opts.busy() ? 1 : 0; } catch { /* ignore */ }
    rows.push([t, me ? me.x : NaN, me ? me.y : NaN, b.right[0], b.right[1], b.up[0], b.up[1], m, busy]);
    if (rows.length > RING) rows.splice(0, rows.length - RING);
  };
  // The position is sampled now; rAF may carry an earlier timestamp on a busy renderer.
  const loop = (): void => { sample(performance.now()); requestAnimationFrame(loop); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(loop);
  const probe: PortProbe = {
    v: 1,
    view: opts.view,
    size: opts.size ?? 1,
    keys: opts.keys ?? (opts.view === 'first-person' ? { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' } : { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }),
    thumb: opts.thumb ?? [0.24, 0.74],
    world: opts.world ?? null,
    rows(since = 0) { return rows.filter((r) => (r[0] as number) >= since); },
    now: () => performance.now(),
    info() {
      const fps = frameTimes.length > 10 ? (frameTimes.length - 1) / (((frameTimes[frameTimes.length - 1] as number) - (frameTimes[0] as number)) / 1000) : null;
      const extra: Record<string, unknown> = {};
      for (const [k, f] of Object.entries(opts.extra ?? {})) { try { extra[k] = f(); } catch (e) { extra[k] = `error: ${String(e)}`; } }
      let lastMove: string | null = null;
      try { lastMove = opts.lastMove ? opts.lastMove() : null; } catch { /* ignore */ }
      let score: number | null = null;
      try { score = opts.score ? opts.score() : null; } catch { /* ignore */ }
      return {
        view: opts.view, frames, fps: fps === null ? null : Math.round(fps * 10) / 10,
        role: net?.role ?? null, seat: net?.seat ?? null, offline: net?.offline ?? null, owned: net?.owned ?? null,
        round: net?.roundInfo ? { n: net.roundInfo.n, phase: net.roundInfo.phase, endsAt: net.roundInfo.endsAt, leftMs: Math.round(net.roundInfo.endsAt - net.now()) } : null,
        slots: net?.slots?.map((s) => ({ slot: s.slot, seat: s.seat, bot: s.bot })) ?? null,
        // Where this browser stands with its room (netplay revision 9): a reading taken while cut off is not play.
        link: net?.link ?? null, reconnects: net?.reconnects ?? null,
        lastMove, moves: opts.moves ? opts.moves() : null, score,
        audio: audioReport(), sandbox: sandboxReport(), errors: errors.slice(-10), extra,
      };
    },
    errors,
  };
  (window as unknown as { __homiePort: PortProbe }).__homiePort = probe;
  // The contract's own probes too, so the netplay e2e and any older harness can read this game.
  try { net?.expose({ self: () => { const s = opts.self?.(); return s ? { x: s.x, y: s.y } : null; }, frames: () => frames }); } catch { /* offline */ }
  return probe;
}
