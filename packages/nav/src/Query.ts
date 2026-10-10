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
