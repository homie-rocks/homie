/** One query vocabulary for a floor mesh and a flat grid. Metres, Y up. */
export type Point = [number, number, number];
export interface Path {
  /** A partial path never silently counts as arrival. */
  complete: boolean;
  points: Point[];
  /** Off-mesh connection node refs, or 0, parallel to points. */
  links: number[];
}
export interface Ray { clear: boolean; fraction: number; point: Point }
export interface NavigationQuery {
  path(from: Point, to: Point): Path;
  /** With from, only points in its directed reachable component are considered. */
  nearest(point: Point, from?: Point): Point | null;
  random(from: Point, random: () => number): Point | null;
  raycast(from: Point, to: Point): Ray;
}
export function point(p: Point): void {
  if (p.length !== 3 || !p.every(Number.isFinite)) throw new Error('nav: a point needs three finite coordinates');
}
export function positive(n: number, name: string): void {
  if (!Number.isFinite(n) || n <= 0) throw new Error(`nav: ${name} must be positive and finite`);
}
export function distance(a: Point, b: Point): number {
  const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
  return Math.sqrt(x * x + y * y + z * z);
}
export function draw(random: () => number): number {
  const n = random();
  if (!(n >= 0 && n < 1)) throw new Error('nav: random must return a number in [0, 1)');
  return n;
}
