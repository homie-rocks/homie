/** Four-neighbour A*: exact shortest grid routes, stable ties, no corner cutting. */
import { distance, draw, point, positive, type NavigationQuery, type Path, type Point, type Ray } from './Query.ts';
import { pack, unpack } from './State.ts';
export interface GridState { width: number; depth: number; cell: number; origin: Point; blocked: Uint8Array }
export class Grid implements NavigationQuery {
  readonly state: GridState;
  constructor(width: number, depth: number, cell: number, origin: Point, blocked?: Uint8Array) {
    positive(cell, 'grid cell'); point(origin);
    if (!Number.isInteger(width) || !Number.isInteger(depth) || width < 1 || depth < 1 || width * depth > 4_000_000 || (blocked && blocked.length !== width * depth)) throw new Error('nav: invalid grid dimensions');
    this.state = { width, depth, cell, origin: [...origin], blocked: blocked ? blocked.slice() : new Uint8Array(width * depth) };
  }
  private at(p: Point): number {
    const s = this.state, x = Math.floor((p[0] - s.origin[0]) / s.cell), z = Math.floor((p[2] - s.origin[2]) / s.cell);
    return x < 0 || z < 0 || x >= s.width || z >= s.depth ? -1 : z * s.width + x;
  }
  private center(i: number): Point {
    const s = this.state;
    return [s.origin[0] + (i % s.width + 0.5) * s.cell, s.origin[1], s.origin[2] + (Math.floor(i / s.width) + 0.5) * s.cell];
  }
  private neighbours(i: number): number[] {
    const w = this.state.width, n = this.state.blocked.length, x = i % w;
    return [x > 0 ? i - 1 : -1, i >= w ? i - w : -1, x + 1 < w ? i + 1 : -1, i + w < n ? i + w : -1].filter(j => j >= 0 && !this.state.blocked[j]);
  }
  private reachable(from: Point): number[] {
    const p = this.nearest(from); if (!p) return [];
    const root = this.at(p), queue = [root], seen = new Uint8Array(this.state.blocked.length); seen[root] = 1;
    for (let k = 0; k < queue.length; k++) for (const j of this.neighbours(queue[k]!)) if (!seen[j]) { seen[j] = 1; queue.push(j); }
    return queue;
  }
  setBlocked(x: number, z: number, blocked: boolean): void {
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= this.state.width || z >= this.state.depth) throw new Error('nav: cell outside grid');
    this.state.blocked[z * this.state.width + x] = blocked ? 1 : 0;
  }
  nearest(p: Point, from?: Point): Point | null {
    point(p); if (from) point(from);
    const cells = from ? this.reachable(from) : null;
    let best = -1, d = Infinity;
    const visit = (i: number): void => { if (!this.state.blocked[i]) { const n = distance(p, this.center(i)); if (n < d || (n === d && i < best)) { d = n; best = i; } } };
    if (cells) cells.forEach(visit); else for (let i = 0; i < this.state.blocked.length; i++) visit(i);
    return best < 0 ? null : this.center(best);
  }
  random(from: Point, random: () => number): Point | null {
    point(from); const cells = this.reachable(from);
    return cells.length ? this.center(cells[Math.floor(draw(random) * cells.length)]!) : null;
  }
  path(from: Point, to: Point): Path {
    const a = this.nearest(from), b = this.nearest(to);
    if (!a || !b) return { complete: false, points: [], links: [] };
    const start = this.at(a), end = this.at(b), n = this.state.blocked.length, w = this.state.width;
    const g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    const h = (i: number): number => Math.abs(i % w - end % w) + Math.abs(Math.floor(i / w) - Math.floor(end / w));
    const heap: { i: number; g: number; f: number }[] = [];
    const less = (a: (typeof heap)[number], b: (typeof heap)[number]): boolean => a.f < b.f || (a.f === b.f && a.i < b.i);
    const push = (i: number): void => {
      const item = { i, g: g[i]!, f: g[i]! + h(i) }; let k = heap.length; heap.push(item);
      while (k > 0) { const p = (k - 1) >> 1; if (!less(item, heap[p]!)) break; heap[k] = heap[p]!; k = p; } heap[k] = item;
    };
    const pop = (): (typeof heap)[number] => {
      const first = heap[0]!, last = heap.pop()!;
      if (heap.length) { let k = 0; while (k * 2 + 1 < heap.length) { let c = k * 2 + 1; if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++; if (!less(heap[c]!, last)) break; heap[k] = heap[c]!; k = c; } heap[k] = last; }
      return first;
    };
    g[start] = 0; push(start); let best = start;
    while (heap.length) {
      const q = pop(), i = q.i; if (closed[i] || q.g !== g[i]) continue;
      closed[i] = 1;
      if (h(i) < h(best) || (h(i) === h(best) && g[i]! < g[best]!)) best = i;
      if (i === end) { best = i; break; }
      for (const j of this.neighbours(i)) if (!closed[j] && g[i]! + 1 < g[j]!) { g[j] = g[i]! + 1; prev[j] = i; push(j); }
    }
    const ids: number[] = []; for (let i = best; i !== -1; i = prev[i]!) ids.push(i);
    ids.reverse(); return { complete: best === end, points: ids.map(i => this.center(i)), links: ids.map(() => 0) };
  }
  /** Exact cell traversal; a ray touching a blocked corner is blocked. */
  raycast(from: Point, to: Point): Ray {
    point(from); point(to);
    const s = this.state, start = this.at(from), dx = (to[0] - from[0]) / s.cell, dz = (to[2] - from[2]) / s.cell;
    const hit = (t: number, clear: boolean): Ray => ({ clear, fraction: t, point: [from[0] + (to[0] - from[0]) * t, s.origin[1], from[2] + (to[2] - from[2]) * t] });
    if (start < 0 || s.blocked[start] || Math.abs(from[1] - s.origin[1]) > 1e-6) return hit(0, false);
    let x = start % s.width, z = Math.floor(start / s.width);
    const sx = Math.sign(dx), sz = Math.sign(dz), ux = (from[0] - s.origin[0]) / s.cell, uz = (from[2] - s.origin[2]) / s.cell;
    let tx = dx === 0 ? Infinity : ((sx > 0 ? x + 1 : x) - ux) / dx;
    let tz = dz === 0 ? Infinity : ((sz > 0 ? z + 1 : z) - uz) / dz;
    const free = (xx: number, zz: number): boolean => xx >= 0 && zz >= 0 && xx < s.width && zz < s.depth && !s.blocked[zz * s.width + xx];
    for (;;) {
      const t = Math.min(tx, tz); if (t > 1) return hit(1, Math.abs(to[1] - s.origin[1]) <= 1e-6);
      if (tx === tz) { if (!free(x + sx, z) || !free(x, z + sz) || !free(x + sx, z + sz)) return hit(t, false); x += sx; z += sz; tx += 1 / Math.abs(dx); tz += 1 / Math.abs(dz); }
      else if (tx < tz) { x += sx; if (!free(x, z)) return hit(t, false); tx += 1 / Math.abs(dx); }
      else { z += sz; if (!free(x, z)) return hit(t, false); tz += 1 / Math.abs(dz); }
    }
  }
  save(): Uint8Array { return pack('grid', this.state); }
  static restore(bytes: Uint8Array): Grid { const s = unpack<GridState>('grid', bytes); return new Grid(s.width, s.depth, s.cell, s.origin, s.blocked); }
}
