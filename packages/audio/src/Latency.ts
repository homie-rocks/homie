/**
 * ============================================================================
 *  Latency.ts — how far behind the sound is, and the refusal to guess.
 * ============================================================================
 *
 * A rhythm game needs an honest measurement of OUTPUT LATENCY: a real number,
 * taken on the real hardware, and when it cannot be measured honestly, a report
 * that says BLOCKED rather than a plausible figure. This module is the reading,
 * and — more importantly — it is the shape of the reading.
 *
 * ## The outcome this file owns
 *
 *   **A consumer can tell the difference between "the device is 12 ms behind"
 *   and "this browser will not say", and it CANNOT accidentally treat the
 *   second as zero.**
 *
 * ## Why this is not four lines of property reads
 *
 * The canonical defect this code guards against is exactly this shape: a
 * plausible default returned in place of an answer. A certificate health check
 * once wrapped a call in try/catch and reported *"there is no certificate"* for
 * one that was present, valid and had 89 days left, and the service told a
 * precise lie while looking healthy.
 *
 * `AudioContext.outputLatency` is the same trap wearing an audio costume:
 *
 *   · Safari does not implement it at all, so it is `undefined`.
 *   · Chrome reports **0** until the output device has actually started —
 *     before the first sound, and on a context that is still `suspended`,
 *     which is every context until somebody touches something.
 *   · `baseLatency` is the graph's own buffering and is NOT the speaker; a
 *     consumer that adds only that one is compensating for a third of the path.
 *
 * A rhythm experience uses this number to decide when to DRAW the thing you are
 * hearing. Compensating by zero because a browser said `0` and compensating by
 * zero because there is genuinely no latency are two different products, and
 * only one of them is honest. So:
 *
 *   **`0` and `undefined` both come back as `null`, and `null` is a sentence.**
 *
 * A caller that wants to proceed anyway has to write the fallback down at its
 * own call site, in its own code, where a reviewer can see the number it
 * decided to believe.
 *
 * ## What this file does NOT know, and it is the biggest term
 *
 * Neither field includes the latency of the GRAPH BETWEEN the source and the
 * destination. `Synth.ts`'s output chain is (glue compressor → limiter → trim →
 * safety clipper) and a `DynamicsCompressor` is not a delay-free node in any
 * implementation. Nothing in the Web Audio API reports that, so nothing here
 * invents it: it is measured by rendering a known impulse through the real
 * graph offline and reading the sample index back, which is what a rhythm
 * game's clock probe does, and the number belongs to the
 * consumer's own graph rather than to this package.
 *
 * ## This file imports nothing at all
 */

/**
 * What the device would tell us, with the refusals kept separate from the
 * numbers.
 *
 * Every field is `number | null` rather than `number`. There is no `total: 0`
 * to be read past.
 */
export interface OutputLatency {
  /**
   * `AudioContext.baseLatency` — the graph's own buffering, in seconds. Null
   * when unreported or zero; see the header on why zero is a refusal.
   */
  base: number | null;
  /**
   * `AudioContext.outputLatency` — everything from the destination node to the
   * speaker, in seconds. Null when unreported or zero.
   */
  output: number | null;
  /**
   * `base + output`, and ONLY when both are real. Null if either is null — a
   * partial sum is the plausible default this whole module exists to refuse.
   */
  total: number | null;
  sampleRate: number;
  /**
   * The context's own `state` at the moment of the reading, verbatim.
   *
   * Load-bearing rather than decorative: `outputLatency` of a `suspended`
   * context is meaningless on every engine, and a reading taken before the
   * first gesture is a reading of nothing. A caller that prints a number
   * without printing this next to it has published a measurement of an unopened
   * device.
   */
  state: string;
  /**
   * Which fields refused, by name, in the order they were asked. Empty when
   * both answered. This is what a report prints instead of a figure.
   */
  missing: readonly string[];
}

/**
 * Everything this module reads. Structural, so a harness — and an
 * `OfflineAudioContext`, which reports neither latency and says so — satisfies
 * it without a DOM.
 */
export interface LatencyContext {
  readonly sampleRate: number;
  readonly state?: string;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
}

/** A finite, strictly positive number, or null. The whole policy, in one line. */
function reported(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Read the device's own account of how far behind it is.
 *
 * Does NOT throw and does NOT catch: every branch here is a property read on a
 * structure the caller already holds. There is nothing to fail, so there is no
 * try/catch to turn a failure into a plausible default — which is the whole
 * lesson of the certificate check in the header, applied by having no catch
 * rather than by having a careful one.
 */
export function outputLatency(ctx: LatencyContext): OutputLatency {
  const base = reported(ctx.baseLatency);
  const output = reported(ctx.outputLatency);
  const missing: string[] = [];
  if (base === null) missing.push('baseLatency');
  if (output === null) missing.push('outputLatency');
  return {
    base,
    output,
    total: base !== null && output !== null ? base + output : null,
    sampleRate: ctx.sampleRate,
    state: typeof ctx.state === 'string' ? ctx.state : 'unknown',
    missing,
  };
}

/**
 * One line for a console, a HUD or a probe's report.
 *
 * It NAMES what it could not measure. "we could not measure it" and "we
 * measured it and it was fine" must never render as the same colour, and on a
 * one-line readout the only way to honour that is to say the word.
 */
export function latencyLine(l: OutputLatency): string {
  const ms = (v: number | null): string => (v === null ? 'not reported' : `${(v * 1000).toFixed(2)} ms`);
  const head = `latency base ${ms(l.base)} · output ${ms(l.output)} · total ${ms(l.total)}`;
  const tail = ` (${l.sampleRate} Hz, context ${l.state})`;
  return l.missing.length === 0 ? head + tail : `${head}${tail} — UNMEASURED: ${l.missing.join(', ')}`;
}
