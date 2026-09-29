/**
 * ============================================================================
 *  Pulse — a phone's vibration motor, on a budget.
 * ============================================================================
 *  `navigator.vibrate` takes a PATTERN — alternating on/off durations in
 *  milliseconds — and has no magnitude. That is why this is a separate module
 *  from `PadReader.rumble` and not a parameter of it: a dual-rumble magnitude
 *  and a pulse length are different units for different hardware, and the one
 *  time they were conflated the result was a game that
 *  buzzed for the things that happen TO you and was silent for the things you
 *  earn. See `PadReader.rumble`.
 *
 *  Three budgets, all of them the difference between feedback and an annoyance:
 *
 *   - **A minimum gap between starts.** Two pulses closer than ~45 ms are felt
 *     as one; a stronger one may PRE-EMPT a weaker one (compared on total
 *     pattern energy), so a big event is never lost behind a small tick.
 *   - **A duty-cycle ceiling over a rolling window.** The failure this prevents
 *     is not a single event, it is a pile-up — a game can raise five of these
 *     in half a second, and a motor that is running most of the time says
 *     nothing at all and eats the battery doing it.
 *   - **Every call wrapped.** `vibrate` can throw on a page without user
 *     activation and is simply absent in Safari.
 *
 *  NOTE, plainly: **iOS Safari does not implement `navigator.vibrate`**, so
 *  everything below lands on Android and on desktop Chrome and nowhere else.
 *  That is why no feedback built on this should ever be haptic-ONLY — every
 *  event wants a visual or an audible channel too. The iOS checkbox-switch
 *  trick is deliberately NOT shipped: Apple patched it in 26.5, it was always a
 *  hack against the platform's intent, and it is unnecessary given the rule
 *  above.
 *
 *  WHAT NOTHING HERE MEASURES: whether a pulse was FELT. No harness can hold a
 *  phone. The package harness proves the gate arithmetic — the gap,
 *  the pre-emption, the rolling window — from a synthetic clock, and proves
 *  nothing about the motor.
 * ============================================================================
 */

export interface PulseBudget {
  /** ms between pulse STARTS. 45 is the shortest gap two taps read as two taps. */
  gapMs: number;
  /** rolling window, ms */
  windowMs: number;
  /** the share of the window the motor may be running, 0..1 */
  duty: number;
}

export class Pulse {
  private readonly b: PulseBudget;
  /**
   * Asked once per call: may the motor run at all? The games route this at a
   * player preference, and the preference only applies when they are actually
   * on a phone — which is a question about the game's own idea of its session,
   * not one this module can answer.
   */
  private readonly allowed: () => boolean;

  /** `performance.now()` of the last pulse start, and its total energy */
  private at = -1e9;
  private energy = 0;
  /** rolling record of pulse (start, duration) for the duty-cycle budget */
  private log: number[] = [];

  constructor(budget: PulseBudget, allowed: () => boolean) {
    this.b = budget;
    this.allowed = allowed;
  }

  /** Fire a pattern, in milliseconds, if all three budgets allow it. */
  fire(pattern: number[]) {
    if (!this.allowed()) return;
    if (typeof navigator.vibrate !== 'function') return;
    const now = performance.now();
    let energy = 0;
    for (let i = 0; i < pattern.length; i += 2) energy += pattern[i] ?? 0;
    if (energy <= 0) return;

    // Gap, with stronger-pre-empts-weaker.
    if (now - this.at < this.b.gapMs && energy <= this.energy) return;

    // Duty cycle over the rolling window. The log is pairs of (start, ms).
    let spent = 0;
    for (let i = this.log.length - 2; i >= 0; i -= 2) {
      if ((this.log[i] ?? 0) < now - this.b.windowMs) { this.log.splice(0, i + 2); break; }
      spent += this.log[i + 1] ?? 0;
    }
    if (spent + energy > this.b.windowMs * this.b.duty) return;

    this.at = now;
    this.energy = energy;
    this.log.push(now, energy);
    try { navigator.vibrate(pattern.length === 1 ? pattern[0] as number : pattern); } catch { /* ignore */ }
  }
}
