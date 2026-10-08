/** World coordinates in metres. Public points accept arrays and typed arrays. */
export type Point = ArrayLike<number>;
export type Vector = [number, number, number];
export type Up = 'y' | 'z';
export interface Path {
  complete: boolean;
  points: Vector[];
  /** Public link ids, or zero for walking, parallel to points. */
  links: number[];
  /** Grid search cost before optional smoothing, in metres. */
  cost?: number;
}
export interface Ray {
  clear: boolean;
  fraction: number;
  point: Vector;
}
export interface NavigationQuery {
  path(from: Point, to: Point): Path;
  nearest(point: Point, from?: Point): Vector | null;
  random(from: Point, random: () => number): Vector | null;
  raycast(from: Point, to: Point): Ray;
}
export function point(p: Point): void {
  if (!p || p.length !== 3 || ![p[0], p[1], p[2]].every(Number.isFinite))
    throw new Error('nav: a point needs three finite coordinates');
}
export function vector(p: Point): Vector {
  point(p);
  return [p[0]!, p[1]!, p[2]!];
}
/** Rotate world coordinates into the internal Y-up frame: (x,y,z) -> (x,z,-y). */
export function axes(p: Point, up: Up = 'y'): Vector {
  point(p);
  return up === 'z' ? [p[0]!, p[2]!, -p[1]!] : vector(p);
}
/** Inverse rotation, from internal Y-up to world coordinates. */
export function fromAxes(p: Point, up: Up = 'y'): Vector {
  point(p);
  return up === 'z' ? [p[0]!, -p[2]!, p[1]!] : vector(p);
}
/** Extents have no direction; rotations permute their positive magnitudes. */
export function axisExtents(p: Point, up: Up = 'y'): Vector {
  return axes(p, up).map(Math.abs) as Vector;
}
/** Rotating a box also changes which corner is its minimum. */
export function axisBounds(min: Point, max: Point, up: Up = 'y', inverse = false): { min: Vector; max: Vector } {
  const a = inverse ? fromAxes(min, up) : axes(min, up);
  const b = inverse ? fromAxes(max, up) : axes(max, up);
  return { min: a.map((v, i) => Math.min(v, b[i]!)) as Vector,
    max: a.map((v, i) => Math.max(v, b[i]!)) as Vector };
}
export function positive(n: number, name: string): void {
  if (!Number.isFinite(n) || n <= 0) throw new Error(`nav: ${name} must be positive and finite`);
}
export function distance(a: Point, b: Point): number {
  const x = a[0]! - b[0]!,
    y = a[1]! - b[1]!,
    z = a[2]! - b[2]!;
  return Math.sqrt(x * x + y * y + z * z);
}
export function draw(random: () => number): number {
  const n = random();
  if (typeof n !== 'number' || !(n >= 0 && n < 1))
    throw new Error('nav: random must return a number in [0, 1)');
  return n;
}
