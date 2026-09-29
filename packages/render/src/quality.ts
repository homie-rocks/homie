/**
 * The renderer's ordered quality tiers, with no capability probe or mutable
 * logger attached. Foundational game contracts may import this module without
 * changing when `caps.ts` is evaluated.
 *
 * This must remain a runtime value rather than a `const enum`: package
 * consumers compile under `isolatedModules`, and the ordered comparisons at
 * their call sites require `Quality.High` to exist after emit.
 */
export const Quality = { Low: 0, Medium: 1, High: 2, Ultra: 3 } as const;
export type Quality = (typeof Quality)[keyof typeof Quality];
