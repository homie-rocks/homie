/** Ordered multi-control gestures with an explicit neutral re-arm. */

export interface SequenceStep {
  readonly control: string;
  /** Magnitude at or above this value advances the step. */
  readonly threshold: number;
}

export interface SequenceOptions {
  readonly neutralBetween: boolean;
  readonly neutralThreshold: number;
}

export interface SequenceState {
  readonly index: number;
  readonly complete: boolean;
  readonly armed: boolean;
  readonly expected: string | null;
}

export interface ControlSequence {
  input(control: string, value: number | boolean): SequenceState;
  reset(): SequenceState;
  state(): SequenceState;
}

function magnitude(value: number | boolean): number {
  if (value === true) return 1;
  if (value === false) return 0;
  return Number.isFinite(value) ? Math.abs(value) : 0;
}

export function createControlSequence(
  steps: readonly SequenceStep[],
  options: SequenceOptions,
): ControlSequence {
  if (steps.length === 0) throw new Error('controls.sequence: at least one step is required');
  if (!(options.neutralThreshold >= 0 && options.neutralThreshold < 1)) {
    throw new Error('controls.sequence: neutralThreshold must be between 0 and 1');
  }
  for (const step of steps) {
    if (!step.control || !(step.threshold > options.neutralThreshold && step.threshold <= 1)) {
      throw new Error('controls.sequence: every step needs a control and a threshold above neutralThreshold');
    }
  }

  const values = new Map<string, number>();
  let index = 0;
  let armed = true;
  const snapshot = (): SequenceState => ({
    index,
    complete: index >= steps.length,
    armed,
    expected: index < steps.length ? steps[index]!.control : null,
  });
  const allNeutral = (): boolean => [...values.values()].every((value) => value <= options.neutralThreshold);

  return {
    input(control, value) {
      values.set(control, magnitude(value));
      if (index >= steps.length) return snapshot();
      if (!armed) {
        if (allNeutral()) armed = true;
        return snapshot();
      }
      const step = steps[index]!;
      if (control === step.control && magnitude(value) >= step.threshold) {
        index += 1;
        armed = !options.neutralBetween || index >= steps.length;
      }
      return snapshot();
    },
    reset() {
      values.clear();
      index = 0;
      armed = true;
      return snapshot();
    },
    state: snapshot,
  };
}
