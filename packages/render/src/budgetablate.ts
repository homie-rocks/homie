/**
 * ============================================================================
 *  budgetablate — `?budget=off|batch|group|lod|cascade|shadowcull`, the draw
 *  budget's ablation switch, as one function instead of six ORs per game.
 * ============================================================================
 *
 *  ── WHY AN ABLATION AT ALL ─────────────────────────────────────────────────
 *
 *  Stop measuring a coefficient; measure an ablation. Render the
 *  identical frozen frame with a mechanism on and off and subtract — that
 *  answers both "how many draw calls did it save" and the question a draw count
 *  cannot, "did it change any pixels". It must not change any.
 *
 *  ── WHY IT IS APPLIED AT BOOT AND NEVER TOGGLED ON A RUNNING PAGE ──────────
 *
 *  THE RUNTIME TOGGLE WAS NOT A CLEAN A/B AND THE MEASUREMENT SAID SO. Every
 *  arm of a sweep inherited the previous arm's state: `DrawBudget` records an
 *  owning subsystem's INTENT for `castShadow` the first time it disagrees with
 *  what was last written, so a run that turned one mechanism off and another on
 *  carried the first one's writes into the second one's baseline. Measured in a
 *  base-building game, the same configuration came back at 380 and then 332
 *  shadow draws depending only on which arm ran before it — a 13% swing with no
 *  code change, i.e. exactly the size of the effects being measured.
 *
 *  Two readings may only be compared when what is being measured matches, and a
 *  page reload is the only thing that guarantees it. So this takes the arm ONCE,
 *  before the first frame, and there is deliberately no un-apply.
 *
 *  ── WHY IT IS HERE ─────────────────────────────────────────────────────────
 *
 *  Six field names and one vocabulary, all of them `@homie-rocks/render/drawbudget.ts`'s
 *  own. A second consumer of the budget writing its own six-line cascade would
 *  get five of them right and spell the sixth `groupLod` as `lod`, which fails
 *  by doing nothing — the exact silent-green shape the ablation exists to catch.
 *  The switch and the flags belong together.
 *
 *  THIS FILE IMPORTS NOTHING; the budget arrives structurally.
 * ============================================================================
 */

/** The flags an ablation arm turns off. All of `DrawBudget`'s, by name. */
export interface AblatableBudget {
  enabled: boolean;
  batching: boolean;
  grouping: boolean;
  groupLod: boolean;
  cascadeCulling: boolean;
  shadowCulling: boolean;
}

/**
 * Arms this switch understands, in the order they appear in a report.
 *
 * `off` is every mechanism at once and is the baseline arm; the rest are single
 * mechanisms. Exported so a harness can sweep the list rather than carry its
 * own copy of it and drift.
 */
export const BUDGET_ABLATIONS = ['off', 'batch', 'group', 'lod', 'cascade', 'shadowcull'] as const;

export type BudgetAblation = (typeof BUDGET_ABLATIONS)[number];

/** What the switch did, so a caller can log or assert it rather than assume. */
export interface BudgetAblationResult {
  /** The arm applied, or null when the parameter was absent, empty or `on`. */
  arm: BudgetAblation | null;
  /** True when a value was supplied and is not an arm this file knows. */
  unknown: boolean;
}

/**
 * Applies one ablation arm to a draw budget.
 *
 * `raw` is the URL parameter exactly as read — `null` when absent. Absent, the
 * empty string and `on` all mean "leave everything alone", so `?budget=on` is a
 * writable no-op a sweep script can emit for its control arm without a special
 * case.
 *
 * AN UNRECOGNISED ARM CHANGES NOTHING AND SAYS SO. Silently ignoring it would
 * hand a sweep an arm that is secretly the control, and the whole point of an
 * ablation is that the two arms differ.
 */
export function applyBudgetAblation(
  budget: AblatableBudget,
  raw: string | null,
): BudgetAblationResult {
  if (raw === null || raw === '' || raw === 'on') return { arm: null, unknown: false };
  if (!(BUDGET_ABLATIONS as readonly string[]).includes(raw)) {
    return { arm: null, unknown: true };
  }
  const arm = raw as BudgetAblation;
  const all = arm === 'off';
  if (all) budget.enabled = false;
  if (all || arm === 'batch') budget.batching = false;
  if (all || arm === 'group') budget.grouping = false;
  if (all || arm === 'lod') budget.groupLod = false;
  if (all || arm === 'cascade') budget.cascadeCulling = false;
  if (all || arm === 'shadowcull') budget.shadowCulling = false;
  return { arm, unknown: false };
}
