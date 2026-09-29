/**
 * ===========================================================================
 *  @homie-rocks/loop/Boot.ts — the boot sequence a 3D game starts with.
 * ===========================================================================
 *
 * WHAT THIS IS. `Loop.ts` already owned "the frame loop a 3D game boots into".
 * This is the rest of the boot: the progress bar, the ordered `init` walk with
 * its compositor yield, the watchdog wiring, the shader pre-warm, the failure
 * page, and the `window.__*` handles every test tool reaches for.
 *
 * MEASURED before the move (comments stripped, whitespace collapsed, lines
 * under 25 characters ignored): the two racing games this came from carried
 * 83 shared lines out of 91 and 76 out of 84 in their `main.ts`. Crucially
 * the overlap was CONTIGUOUS, which is the thing that decides whether an
 * extraction is real: six runs, the longest 25 lines, and the 25 is exactly
 * `bootProgress` through `__loopHealth`. A pair with 264 shared lines in 37
 * fragments and a longest run of 13 — import blocks and one-line delegations
 * — had nothing there to extract. This is the opposite shape and that is why
 * it moved.
 *
 * ---------------------------------------------------------------------------
 * WHAT A GAME STILL OWNS, and every one of them is a VALUE rather than a switch
 *
 *   `labels`    the boot readout. 'raising the sun' / 'placing the star' /
 *               'raising the moon' are three games' voices and there is no
 *               shared answer. INDEXED against `systems`, never matched by
 *               name — see the field.
 *   `systems`   the array, in the order that game's init contract requires.
 *   `watchdogs` `FrameWatch` and `Diagnostics`, each carrying its own
 *               thresholds. The order they are initialised in is theirs.
 *   `installed` whatever has to be wired once the systems exist and before the
 *               loop starts listening. The original games all pass
 *               `installFeel`.
 *   `prewarm`   the shader pre-warm AND the line the game logs about it. It is
 *               here rather than in the package for two reasons: `prewarm`
 *               lives in `@homie-rocks/render`, which imports `three`, and this
 *               package deliberately does not (it has no three dependency);
 *               and the games' `[prewarm]` console lines differ, so a shared
 *               one would quietly rewrite a string a player pastes into a
 *               report.
 *   `ready`     the last thing before the first frame. A racing game installs
 *               its screen recorder here, with its own keys and its own
 *               download name.
 *   `publish`   the game's own `window.__*` handles.
 *
 * There is NO OPTIONAL FIELD in `BootSpec` and that is deliberate. A game that
 * forgets one should fail to compile; a game that silently gets a default gets
 * another game's boot. `installed` and `ready` are `() => void` and a game with
 * nothing to do there writes `() => {}`, which says so out loud.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE IMPORTS `three`, for the reason Host.ts states about the loop:
 * two copies of three.js is two `instanceof` universes and the symptom is an
 * object that renders as nothing with no error at all. `bootGame` touches the
 * DOM (`document.querySelector`, `document.body.innerHTML`) and the timer
 * (`requestAnimationFrame`), and nothing else.
 */

import type { LoopWorld } from './Host.ts';

/**
 * A subsystem, exactly as the games declare `System` — but only the member the
 * boot walk actually calls. `LoopSystem` in Host.ts lists the three the FRAME
 * calls; this is the one the BOOT calls, and they are deliberately separate
 * interfaces because a game's `System` satisfies both and neither implies the
 * other.
 */
export interface BootSystem<W> {
  init?(ctx: W): void | Promise<void>;
}

/**
 * A frame watchdog. `FrameWatch` and `Diagnostics` both expose exactly this on
 * the boot path; what they do afterwards is the loop's business, not the
 * boot's.
 */
export interface BootWatchdog<W> {
  init(ctx: W): void;
}

/**
 * The loop, through the five members the boot sequence calls on it.
 *
 * Structural rather than `GameLoop<W>` itself so that a test can drive the
 * shipped boot against a recording double with no renderer anywhere — the same
 * reason `LoopPipeline` exists rather than an import of `RenderPipeline`.
 */
export interface BootLoop {
  installResizeListeners(): void;
  installContextRecovery(): void;
  resize(force: boolean): void;
  start(): void;
  health(): unknown;
}

/**
 * Everything a game hands the boot. No optionals; see the header.
 *
 * `W` IS INFERRED FROM `ctx` AND FROM NOTHING ELSE — every other field wears a
 * `NoInfer<W>`. Without that, `watchdogs` and `systems` are inference sites
 * too, TypeScript unifies the candidates at the constraint, and `W` comes out
 * as `LoopWorld`: the call then demands that `Diagnostics.init` accept a bare
 * `LoopWorld` and fails at the call site with an error about `domElement`,
 * which is four questions away from the truth. Seen on a first-person shooter
 * the first time this compiled.
 */
export interface BootSpec<W extends LoopWorld> {
  ctx: W;
  /**
   * The systems, in dependency order. `init` is awaited one at a time — a
   * `Promise.all` here would run a track's terrain build against a materials
   * cache that has not seen the environment map yet.
   */
  systems: readonly BootSystem<NoInfer<W>>[];
  /**
   * Human-readable names for the boot progress readout.
   *
   * INDEXED, not matched by name — `labels[i]` is read against `systems[i]`, so
   * reordering one without the other silently mislabels the whole boot. The
   * `?? 'loading'` fallback below means a shorter list fails quietly rather
   * than throwing, which is the right trade on the boot path and the reason
   * this comment exists.
   */
  labels: readonly string[];
  /** `[frameWatch, diagnostics]`, initialised in the order given. */
  watchdogs: readonly BootWatchdog<NoInfer<W>>[];
  loop: BootLoop;
  /** Runs after the watchdogs and before the loop installs its listeners. */
  installed(ctx: NoInfer<W>): void;
  /** Compile every shader, and log whatever this game logs about it. */
  prewarm(ctx: NoInfer<W>): Promise<void>;
  /** Runs after the bar reaches 'ready' and immediately before `loop.start()`. */
  ready(ctx: NoInfer<W>): void;
  /** `window.__*` handles, published SYNCHRONOUSLY. See `bootGame`. */
  publish: Readonly<Record<string, unknown>>;
}

/**
 * Drive the boot bar.
 *
 * Both selectors are queried on every call rather than captured once: the boot
 * curtain is markup the game's `index.html` owns and a game is free to render
 * it late. A missing element is a no-op and never a throw — a progress bar that
 * cannot be found must not be the thing that stops a game booting.
 */
function bootProgress(frac: number, label: string): void {
  const bar = document.querySelector<HTMLElement>('.boot-bar i');
  const step = document.querySelector<HTMLElement>('.boot-step');
  if (bar) bar.style.width = `${Math.round(frac * 100)}%`;
  if (step) step.textContent = label;
}

/** Rewrite only the caption, leaving the bar where it is. See `timed`. */
function bootCaption(text: string): void {
  const step = document.querySelector<HTMLElement>('.boot-step');
  if (step) step.textContent = text;
}

/** One turn of the compositor. */
const nextFrame = (): Promise<void> =>
  new Promise<void>((r) => { requestAnimationFrame(() => r()); });

/**
 * How long one boot step may take before the screen admits it, milliseconds.
 *
 * NOT tuning, and therefore not a spec field: this is not how a game looks, it
 * is how long a person will stare at a stationary progress bar before deciding
 * the machine is broken. Four seconds is generous — the slowest step measured
 * on the development machine is the shader pre-warm at well under one — and the cost of it
 * being too long is a few silent seconds, while the cost of it being too short
 * is a game that cries wolf on a cold cache.
 */
export const STALL_MS = 4000;

/** One entry per boot step, published as `window.__bootTrace`. */
export interface BootStepTime {
  step: string;
  ms: number;
}

/**
 * Run one boot step, time it, and SAY SO IF IT HANGS.
 *
 * THE DEFECT THIS EXISTS FOR: a boot bar parked at 40% and a boot bar parked at
 * 40% look identical whether the step behind it is taking eight seconds on a
 * cold shader cache or has hung for ever on a promise that will never settle.
 * The rule is that "we could not measure it" and "we measured it and it was
 * fine" must never render as the same colour — applied here to the one screen
 * a player actually sees. Past four seconds the caption starts counting, so a
 * player can tell a slow machine from a dead one, and the step's name is right
 * there next to the number.
 *
 * It does NOT abort. A deadline that kills a boot would turn a slow machine into
 * a broken one, which is a worse failure than the one it was fixing.
 *
 * `state.current` is what the failure page names when a step throws.
 */
async function timed(
  state: { current: string },
  label: string,
  trace: BootStepTime[],
  fn: () => void | Promise<void>,
): Promise<void> {
  state.current = label;
  const t0 = performance.now();
  // Ticks every second and stays quiet until STALL_MS, rather than firing on a
  // STALL_MS interval: the first thing a stalled boot should print is "4s", not
  // nothing until 8.
  let stalled = false;
  const tick = setInterval(() => {
    const ms = performance.now() - t0;
    if (ms < STALL_MS) return;
    stalled = true;
    bootCaption(`${label}… ${Math.round(ms / 1000)}s`);
  }, 1000);
  try {
    await fn();
  } finally {
    clearInterval(tick);
    trace.push({ step: label, ms: Math.round((performance.now() - t0) * 10) / 10 });
    // Put the caption back — but ONLY if the stopwatch actually wrote, or a
    // healthy boot would gain one redundant DOM write per step and this would
    // stop being a change that no parity check can see. A step that stalled and
    // then completed must not leave its stopwatch frozen on screen under the
    // NEXT step's bar.
    if (stalled) bootCaption(label);
  }
}

/**
 * Boot a game.
 *
 * Call it at module scope. It publishes the window handles synchronously and
 * then runs the asynchronous boot, so a harness that attaches before the first
 * frame finds `__ctx` and `__loopHealth` already there — which is what the
 * games' own module-scope publishing block did, one microtask later.
 *
 * IT DOES NOT RETURN THE PROMISE, and that is on purpose: the failure path is
 * in here. A boot that throws prints the stack onto the page, because a blank
 * screen with a clean console is the failure mode this repository has shipped
 * before and it is indistinguishable from a game that never loaded.
 */
export function bootGame<W extends LoopWorld>(spec: BootSpec<W>): void {
  const w = window as unknown as Record<string, unknown>;
  // The loop is the only thing that sets `__gameReady` TRUE (Loop.ts,
  // READY_FRAME). Publishing `false` here rather than leaving it `undefined`
  // means a harness that reads it early gets "not ready" instead of "no such
  // property"; every reader in this repository tests `=== true`, so the two are
  // the same answer, and one of them is a sentence.
  w.__gameReady = false;
  w.__ctx = spec.ctx;
  w.__loopHealth = () => spec.loop.health();
  for (const [k, v] of Object.entries(spec.publish)) w[k] = v;

  // One entry per step, filled in as the boot runs. Published EMPTY and up
  // front rather than on completion: the run that matters is the one that never
  // finishes, and a trace that only exists after a successful boot describes
  // exactly the boots nobody needed described.
  const trace: BootStepTime[] = [];
  w.__bootTrace = trace;
  const state = { current: 'starting' };

  void run(spec, state, trace).catch((err: unknown) => {
    console.error(`[boot] failed at "${state.current}"`, err);
    // THE STEP IS NAMED. It used to print the stack alone, which in a built
    // bundle is a column number in a file called `index-4f1a.js` and tells a
    // player, and the person reading their photograph of the screen, nothing at
    // all about which of fourteen subsystems refused to start.
    document.body.innerHTML =
      `<pre style="color:#f66;padding:24px;font:13px ui-monospace">Boot failed at "${state.current}":\n${(err as Error)?.stack || err}</pre>`;
  });
}

async function run<W extends LoopWorld>(
  spec: BootSpec<W>, state: { current: string }, trace: BootStepTime[],
): Promise<void> {
  const { ctx, systems, labels, loop } = spec;

  for (let i = 0; i < systems.length; i++) {
    const label = labels[i] ?? 'loading';
    bootProgress(i / (systems.length + 1), label);
    // Yield to the compositor so the bar actually repaints between steps —
    // without this the whole loop runs inside one frame and the player sees a
    // frozen bar, which looks worse than no bar at all.
    await nextFrame();
    await timed(state, label, trace, () => systems[i]?.init?.(ctx));
  }

  state.current = 'wiring the watchdogs';
  for (const watch of spec.watchdogs) watch.init(ctx);
  spec.installed(ctx);
  loop.installResizeListeners();
  loop.installContextRecovery();
  loop.resize(true);

  // Compile every shader before the first frame is presented. Doing it here
  // costs a moment of boot; not doing it costs a dropped frame mid-race every
  // time a new material first appears, which reads as the screen flashing black.
  bootProgress(systems.length / (systems.length + 1), 'compiling shaders');
  await nextFrame();
  await timed(state, 'compiling shaders', trace, () => spec.prewarm(ctx));

  bootProgress(1, 'ready');
  state.current = 'ready';
  // The whole boot, in one line, named by step and sorted longest first. Every
  // game gained this at once, and none of them had it: "boot took 9 s" was the
  // most any of them could say, and the answer to "which nine seconds" was to
  // add console.time by hand and reload.
  const total = trace.reduce((a, s) => a + s.ms, 0);
  const worst = [...trace].sort((a, b) => b.ms - a.ms).slice(0, 3)
    .map((s) => `${s.step} ${s.ms}ms`).join(', ');
  console.info(`[boot] ${trace.length} steps in ${Math.round(total)}ms — slowest: ${worst}`);
  spec.ready(ctx);
  // `?scaler=` is applied by `loop.start()` BEFORE the first rAF, so the very
  // first presented frame is already at the pinned resolution — a pinned run
  // must not contain a rung change of its own.
  loop.start();
  // AFTER `start()`, exactly as the original games had it. `start()` only
  // schedules a frame, so nothing has presented yet and this cannot clobber a
  // `__gameReady` the loop has already set; if `start()` ever presents
  // synchronously, this line becomes a bug and the order is why.
  (window as unknown as { __gameReady: boolean }).__gameReady = false;
}
