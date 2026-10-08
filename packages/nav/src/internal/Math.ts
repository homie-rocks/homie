/** Deterministic kernels on [-pi/4, pi/4]. Split pi/2 reduction retains
 * precision for bounded avoidance angles without using host transcendental calls.
 * Coefficients are the fdlibm minimax sine/cosine coefficients. */
function reduced(angle: number): [number, number] {
  const quadrant = Math.round(angle * 0.6366197723675814);
  const x = (angle - quadrant * 1.5707963267341256) - quadrant * 6.077100506506192e-11;
  return [x, ((quadrant % 4) + 4) % 4];
}
function sine(x: number): number {
  const z = x * x;
  return x + x * z * (-1.6666666666666632e-1 + z * (8.33333333332249e-3 +
    z * (-1.984126982985795e-4 + z * (2.7557313707070068e-6 +
    z * (-2.5050760253406863e-8 + z * 1.58969099521155e-10)))));
}
function cosine(x: number): number {
  const z = x * x;
  return 1 - (0.5 * z - z * z * (4.16666666666666e-2 + z * (-1.388888888887411e-3 +
    z * (2.480158728947673e-5 + z * (-2.7557314351390663e-7 +
    z * (2.087572321298175e-9 + z * -1.1359647557788195e-11))))));
}
export function deterministicSin(angle: number): number {
  const [x, q] = reduced(angle);
  return q === 0 ? sine(x) : q === 1 ? cosine(x) : q === 2 ? -sine(x) : -cosine(x);
}
export function deterministicCos(angle: number): number {
  const [x, q] = reduced(angle);
  return q === 0 ? cosine(x) : q === 1 ? -sine(x) : q === 2 ? -cosine(x) : sine(x);
}
