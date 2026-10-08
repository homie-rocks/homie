/** Fixed arithmetic, no host transcendental functions. Argument reduction to
 * [-pi/2, pi/2] followed by a degree-17 Taylor polynomial. Sampling angles are
 * bounded by 2*pi. Error is below 5e-14 there; ordering is identical on IEEE-754
 * JavaScript engines (no fused multiply-add or platform libm call).
 */
const PI = 3.141592653589793;
export function deterministicSin(angle: number): number {
  let x = angle % (2 * PI);
  if (x > PI) x -= 2 * PI;
  if (x < -PI) x += 2 * PI;
  if (x > PI / 2) x = PI - x;
  if (x < -PI / 2) x = -PI - x;
  const squared = x * x;
  let term = x, result = x;
  for (let n = 1; n <= 8; n++) { term *= -squared / ((2 * n) * (2 * n + 1)); result += term; }
  return result;
}
export function deterministicCos(angle: number): number { return deterministicSin(angle + PI / 2); }
