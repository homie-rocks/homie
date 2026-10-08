/** Structural validation at trusted-asset/save boundaries, before backend calls. */
export function requireState(condition: unknown): asserts condition {
  if (!condition) throw new Error('nav: malformed navigation structure');
}
export function numbers(value: unknown, length?: number): asserts value is number[] {
  requireState(Array.isArray(value) && (length === undefined || value.length === length) && value.every(Number.isFinite));
}
export function record(value: unknown): asserts value is Record<string, unknown> {
  requireState(value !== null && typeof value === 'object' && !Array.isArray(value));
}
