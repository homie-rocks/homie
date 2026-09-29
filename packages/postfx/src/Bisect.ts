/**
 * ===========================================================================
 *  THE POST CHAIN, FOR A BISECT. GATED ON `?shot=1`.
 * ===========================================================================
 *
 * A THREE-SESSION investigation compared a kart racer and a first-person
 * shooter on which of them can photograph a HELD frame twice identically, and
 * every one of its experiments was driven from
 * `window.__ctx`, which hands out `renderer` and nothing else — so NOT ONE
 * INDIVIDUAL POST PASS HAS EVER BEEN SWITCHED OFF in either game, because there
 * was no handle to switch one off with. That, and not a shortage of hypotheses,
 * is what kept it open. This is the handle.
 *
 * IT LIVED IN TWO PLACES, AND EACH COPY'S COMMENT SAID SO. It was ~60 lines at
 * the bottom of one game's entry module and ~62 at the bottom of the other's,
 * differing by one paragraph of prose and the words "these games" / "this
 * game". A bisect whose two halves can drift is a bisect that compares two
 * different instruments — which is the whole failure that investigation was
 * about.
 *
 * ── WHY IT IS GATED, AND ON THAT FLAG ───────────────────────────────────────
 * `?shot=1` is the diagnostic flag the capture harnesses already pass, so this
 * does not exist in normal play: a player's launch has no `__pipeline` at all,
 * and `typeof window.__pipeline === 'undefined'` is the check for that. It is
 * deliberately NOT `?debug=`, which selects a diagnostic MODE — `?debug=frames`
 * turns on `preserveDrawingBuffer`, which costs frame time and would poison the
 * measurement.
 *
 * ── `composer` AND `passes` ARE GETTERS, NEVER CAPTURED VALUES ──────────────
 * The pipeline throws its composer away and builds a new one on a rung fall and
 * again after a context restore, so a handle taken once at boot would answer
 * for a composer that no longer renders anything — the cache-of-a-fact trap,
 * already paid for three times over. Ask, do not remember.
 */

/** The chain, through the three members a bisect reads. Duck-typed on purpose. */
export interface BisectableChain {
  /** PostFX — the built chain's own state: grade, bloom, dof, smaa, ao, frameClock. */
  readonly fx?: unknown;
  readonly composer?: { readonly passes?: readonly unknown[] } | null | undefined;
}

/** One row of `list()`. */
export interface PassRow {
  i: number;
  /** the constructor's name — MANGLED in a production build; see `role` */
  cls: string;
  /** postprocessing's own `.name` — often just "Pass" */
  name: string;
  /** identity against the handles PostFX kept: the only label that is not a guess */
  role: string | null;
  enabled: boolean;
  /** an EffectPass is a CONTAINER, so this is not the same list as the passes */
  effects: string[];
}

export interface ChainBisect<P extends BisectableChain> {
  /** The RenderPipeline itself: rung, dynamicScale, setMultisampling, fall(). */
  pipeline: P;
  fx: unknown;
  readonly composer: unknown;
  /** Live array. Setting `.enabled = false` on a member takes that pass out. */
  readonly passes: readonly unknown[];
  list(): PassRow[];
}

/**
 * Publish the bisect handle on `globalThis.__pipeline`, if `?shot=1`.
 *
 * @param search `location.search`. Passed in rather than read, so a harness can
 *   drive this without a browser and so the package never reaches for a global
 *   the host may not have given it.
 * @returns whether it installed — read back rather than assumed, because a flag
 *   whose effect cannot be observed is the frame-rate knob wired to nothing that
 *   has already shipped once.
 */
export function installChainBisect<P extends BisectableChain>(
  pipeline: P,
  search: string,
): boolean {
  if (new URLSearchParams(search).get('shot') !== '1') return false;

  const handle: ChainBisect<P> = {
    pipeline,
    fx: pipeline.fx,
    get composer() { return (pipeline as { composer?: unknown }).composer; },
    get passes() { return pipeline.composer?.passes ?? []; },
    /**
     * What a bisect reads first. Class name AND postprocessing's own `.name`,
     * because a production build mangles the constructor and the two would then
     * disagree — better to see both than to trust the wrong one silently.
     * `effects` matters because an EffectPass is a CONTAINER: at high these
     * games merge DoF and Bloom into one pass, so "disable the pass" and
     * "disable the effect" are different experiments.
     */
    list(): PassRow[] {
      const fx = pipeline.fx as { ao?: unknown; gradePass?: unknown } | undefined;
      return (pipeline.composer?.passes ?? []).map((raw, i): PassRow => {
        const p = raw as {
          constructor?: { name?: string };
          name?: string;
          enabled?: boolean;
          effects?: readonly { constructor?: { name?: string } }[];
        };
        return {
          i,
          cls: p?.constructor?.name ?? '?',
          name: p?.name ?? '?',
          // MEASURED, NOT ASSUMED: at `high` the AO pass reports `cls`
          // "$87431ee93b037844$export$2489f9981ab0fa82" — a mangled Parcel
          // export from the n8ao build — and `name` "Pass", the base class's
          // default. So NEITHER STRING IDENTIFIES IT, and a bisect that keys off
          // the class name would silently skip the one pass with internal
          // accumulation in it. Identity against the handles PostFX kept is the
          // only label in this chain that is not a guess.
          role: p === fx?.ao ? 'ao (N8AOPostPass)'
            : p === fx?.gradePass ? 'grade'
            : null,
          enabled: p?.enabled === true,
          effects: (p?.effects ?? []).map((e) => e?.constructor?.name ?? '?'),
        };
      });
    },
  };

  (globalThis as unknown as { __pipeline: unknown }).__pipeline = handle;
  return true;
}
