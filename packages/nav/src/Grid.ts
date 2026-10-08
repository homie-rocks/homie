/** Eight-neighbour octile paths, no corner cutting, with optional JPS. */
import {
  type Up,
  type Vector,
  type NavigationQuery,
  type Path,
  type Point,
  type Ray,
} from './Query.ts';
import { axes, fromAxes, distance, draw, point, positive } from './internal/Coordinates.ts';
import { pack, unpack } from './internal/Binary.ts';
import { jumpPath, octile } from './internal/Jump.ts';
interface GridState {
  width: number;
  depth: number;
  cell: number;
  origin: Vector;
  blocked: Uint8Array;
  up: Up;
}
export interface GridOptions {
  up?: Up;
  search?: 'astar' | 'jps';
  smooth?: boolean;
}
export class Grid implements NavigationQuery {
  #state: GridState;
  #options: GridOptions;
  #labels?: Int32Array;
  #components: Int32Array[] = [];
  #blockedCount = 0;
  #scores: Float64Array;
  #previous: Int32Array;
  #visited: Uint32Array;
  #generation = 0;
  constructor(
    width: number,
    depth: number,
    cell: number,
    origin: Point,
    blocked?: Uint8Array,
    options: GridOptions = {},
  ) {
    positive(cell, 'grid cell');
    point(origin);
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(depth) ||
      width < 1 ||
      depth < 1 ||
      width * depth > 4_000_000 ||
      (blocked && blocked.length !== width * depth)
    )
      throw new Error('nav: invalid grid dimensions');
    if (options.up !== undefined && options.up !== 'y' && options.up !== 'z')
      throw new Error('nav: up must be y or z');
    this.#options = { ...options };
    this.#state = {
      width,
      depth,
      cell,
      origin: axes(origin, options.up),
      blocked: blocked ? new Uint8Array(blocked) : new Uint8Array(width * depth),
      up: options.up ?? 'y',
    };
    for (let i = 0; i < this.#state.blocked.length; i++) {
      if (this.#state.blocked[i]) {
        this.#state.blocked[i] = 1;
        this.#blockedCount++;
      }
    }
    // Allocated lazily for A*, retained across searches. JPS uses sparse nodes.
    this.#scores = new Float64Array(0);
    this.#previous = new Int32Array(0);
    this.#visited = new Uint32Array(0);
  }
  get up(): Up {
    return this.#state.up;
  }
  private atInternal(p: Point): number {
    const s = this.#state,
      x = Math.floor((p[0]! - s.origin[0]) / s.cell),
      z = Math.floor((p[2]! - s.origin[2]) / s.cell);
    return x < 0 || z < 0 || x >= s.width || z >= s.depth ? -1 : z * s.width + x;
  }
  private at(p: Point): number {
    return this.atInternal(axes(p, this.up));
  }
  private center(i: number): Vector {
    const s = this.#state;
    return fromAxes(
      [
        s.origin[0] + ((i % s.width) + 0.5) * s.cell,
        s.origin[1],
        s.origin[2] + (Math.floor(i / s.width) + 0.5) * s.cell,
      ],
      this.up,
    );
  }
  private free(x: number, z: number): boolean {
    const s = this.#state;
    return x >= 0 && z >= 0 && x < s.width && z < s.depth && !s.blocked[z * s.width + x];
  }
  private neighbours(i: number): number[] {
    const w = this.#state.width,
      x = i % w,
      z = Math.floor(i / w),
      result: number[] = [];
    for (const [dx, dz] of [
      [-1, 0],
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      if (
        this.free(x + dx, z + dz) &&
        (!dx || !dz || (this.free(x + dx, z) && this.free(x, z + dz)))
      )
        result.push((z + dz) * w + x + dx);
    }
    return result;
  }
  private label(): void {
    if (this.#labels) return;
    const { width: w, depth: h, blocked } = this.#state;
    const labels = new Int32Array(blocked.length).fill(-1);
    const queue = new Int32Array(blocked.length),
      components: Int32Array[] = [];
    let tail = 0;
    for (let root = 0; root < labels.length; root++) {
      if (blocked[root] || labels[root] !== -1) continue;
      const id = components.length,
        first = tail;
      queue[tail++] = root;
      labels[root] = id;
      for (let head = first; head < tail; head++) {
        const cell = queue[head]!,
          x = cell % w,
          z = Math.floor(cell / w);
        for (let dz = -1; dz <= 1; dz++) {
          if (z + dz < 0 || z + dz >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if ((!dx && !dz) || x + dx < 0 || x + dx >= w) continue;
            const next = cell + dz * w + dx;
            if (
              labels[next] !== -1 ||
              blocked[next] ||
              (dx && dz && (blocked[cell + dx] || blocked[cell + dz * w]))
            )
              continue;
            labels[next] = id;
            queue[tail++] = next;
          }
        }
      }
      components.push(queue.subarray(first, tail));
    }
    this.#labels = labels;
    this.#components = components;
  }

  setBlocked(x: number, z: number, blocked: boolean): void {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(z) ||
      x < 0 ||
      z < 0 ||
      x >= this.#state.width ||
      z >= this.#state.depth
    )
      throw new Error('nav: cell outside grid');
    const i = z * this.#state.width + x,
      value = blocked ? 1 : 0;
    this.#blockedCount += value - this.#state.blocked[i]!;
    this.#state.blocked[i] = value;
    this.#labels = undefined;
    this.#components = [];
  }
  nearest(p: Point, from?: Point): Vector | null {
    point(p);
    if (from) point(from);
    const s = this.#state,
      v = axes(p, this.up);
    const x = Math.max(0, Math.min(s.width - 1, Math.floor((v[0] - s.origin[0]) / s.cell)));
    const z = Math.max(0, Math.min(s.depth - 1, Math.floor((v[2] - s.origin[2]) / s.cell)));
    const cell = z * s.width + x;
    let component: number | undefined;
    if (from && this.#blockedCount) {
      const start = this.nearest(from);
      if (!start) return null;
      this.label();
      component = this.#labels![this.at(start)]!;
      if (!s.blocked[cell] && this.#labels![cell] === this.#labels![this.at(start)])
        return this.center(cell);
    } else if (!s.blocked[cell]) return this.center(cell);
    let best = -1,
      cost = Infinity;
    const px = (v[0] - s.origin[0]) / s.cell,
      pz = (v[2] - s.origin[2]) / s.cell;
    const visit = (xx: number, zz: number): void => {
      if (xx < 0 || zz < 0 || xx >= s.width || zz >= s.depth) return;
      const i = zz * s.width + xx;
      if (s.blocked[i] || (component !== undefined && this.#labels![i] !== component)) return;
      const dx = xx + 0.5 - px,
        dz = zz + 0.5 - pz,
        d = dx * dx + dz * dz;
      if (d < cost || (d === cost && i < best)) {
        best = i;
        cost = d;
      }
    };
    // Expand only as far as the nearest eligible cell. The lower bound also
    // handles points outside the grid and disconnected components exactly.
    for (let r = 0; r < Math.max(s.width, s.depth); r++) {
      for (let xx = Math.max(0, x - r); xx <= Math.min(s.width - 1, x + r); xx++) {
        visit(xx, z - r);
        if (r) visit(xx, z + r);
      }
      for (let zz = Math.max(0, z - r + 1); zz <= Math.min(s.depth - 1, z + r - 1); zz++) {
        visit(x - r, zz);
        if (r) visit(x + r, zz);
      }
      const lower = Math.min(
        x - r > 0 ? Math.abs(x - r - 0.5 - px) : Infinity,
        x + r + 1 < s.width ? Math.abs(x + r + 1.5 - px) : Infinity,
        z - r > 0 ? Math.abs(z - r - 0.5 - pz) : Infinity,
        z + r + 1 < s.depth ? Math.abs(z + r + 1.5 - pz) : Infinity,
      );
      if (best >= 0 && cost < lower * lower) break;
    }
    return best < 0 ? null : this.center(best);
  }

  random(from: Point, random: () => number): Vector | null {
    const start = this.nearest(from);
    if (!start) return null;
    if (!this.#blockedCount)
      return this.center(Math.floor(draw(random) * this.#state.blocked.length));
    this.label();
    const cells = this.#components[this.#labels![this.at(start)]!]!;
    return this.center(cells[Math.floor(draw(random) * cells.length)]!);
  }
  path(
    from: Point,
    to: Point,
    options: Pick<GridOptions, 'search' | 'smooth'> = this.#options,
  ): Path {
    const a = this.nearest(from),
      b = this.nearest(to);
    if (!a || !b) return { complete: false, points: [], links: [], cost: 0 };
    const start = this.at(a),
      end = this.at(b),
      w = this.#state.width;
    if (!this.#blockedCount || this.clearOctile(start, end)) {
      const points = [a];
      let x = start % w,
        z = Math.floor(start / w);
      while (x !== end % w || z !== Math.floor(end / w)) {
        x += Math.sign((end % w) - x);
        z += Math.sign(Math.floor(end / w) - z);
        points.push(this.center(z * w + x));
      }
      const output = options.smooth === false ? points : start === end ? [a] : [a, b];
      return {
        complete: true,
        points: output,
        links: output.map(() => 0),
        cost:
          octile(
            Math.abs((start % w) - (end % w)),
            Math.abs(Math.floor(start / w) - Math.floor(end / w)),
          ) * this.#state.cell,
      };
    }
    let ids =
      options.search === 'jps' &&
      this.#blockedCount / this.#state.blocked.length >= 0.001 &&
      this.#blockedCount / this.#state.blocked.length < 0.05
        ? jumpPath(
            w,
            start,
            end,
            (x, z) => this.free(x, z),
            (i) => this.neighbours(i),
          )
        : [];
    // A* also supplies the nearest partial result when no complete route exists.
    if (!ids.length) ids = this.astar(start, end);
    let cost = 0;
    for (let i = 1; i < ids.length; i++)
      cost += octile(
        Math.abs((ids[i]! % w) - (ids[i - 1]! % w)),
        Math.abs(Math.floor(ids[i]! / w) - Math.floor(ids[i - 1]! / w)),
      );
    const raw = ids.map((i) => this.center(i)),
      points: Vector[] = [];
    if (options.smooth === false) points.push(...raw);
    else {
      for (let i = 0; i < raw.length; ) {
        points.push(raw[i]!);
        if (i === raw.length - 1) break;
        let next = i + 1;
        while (next + 1 < raw.length && this.raycast(raw[i]!, raw[next + 1]!).clear) next++;
        i = next;
      }
    }
    return {
      complete: ids.at(-1) === end,
      points,
      links: points.map(() => 0),
      cost: cost * this.#state.cell,
    };
  }
  private clearOctile(start: number, end: number): boolean {
    const w = this.#state.width;
    const x = start % w,
      z = Math.floor(start / w),
      ex = end % w,
      ez = Math.floor(end / w);
    const diagonal = Math.min(Math.abs(ex - x), Math.abs(ez - z));
    const elbow = (z + Math.sign(ez - z) * diagonal) * w + x + Math.sign(ex - x) * diagonal;
    return (
      this.raycast(this.center(start), this.center(elbow)).clear &&
      this.raycast(this.center(elbow), this.center(end)).clear
    );
  }
  private astar(start: number, end: number): number[] {
    const n = this.#state.blocked.length,
      w = this.#state.width;
    if (this.#scores.length !== n) {
      this.#scores = new Float64Array(n);
      this.#previous = new Int32Array(n);
      this.#visited = new Uint32Array(n);
    }
    if (++this.#generation === 0xffffffff) {
      this.#visited.fill(0);
      this.#generation = 1;
    }
    const generation = this.#generation,
      g = this.#scores,
      previous = this.#previous,
      visited = this.#visited;
    const h = (i: number): number =>
      octile(Math.abs((i % w) - (end % w)), Math.abs(Math.floor(i / w) - Math.floor(end / w)));
    const heap: { id: number; cost: number; score: number }[] = [];
    const less = (a: (typeof heap)[number], b: (typeof heap)[number]): boolean =>
      a.score < b.score || (a.score === b.score && a.id < b.id);
    const push = (id: number): void => {
      const item = { id, cost: g[id]!, score: g[id]! + h(id) };
      let i = heap.length;
      heap.push(item);
      while (i) {
        const parent = (i - 1) >> 1;
        if (!less(item, heap[parent]!)) break;
        heap[i] = heap[parent]!;
        i = parent;
      }
      heap[i] = item;
    };
    const pop = (): (typeof heap)[number] => {
      const first = heap[0]!,
        last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && less(heap[child + 1]!, heap[child]!)) child++;
          if (!less(heap[child]!, last)) break;
          heap[i] = heap[child]!;
          i = child;
        }
        heap[i] = last;
      }
      return first;
    };
    g[start] = 0;
    previous[start] = -1;
    visited[start] = generation;
    push(start);
    let best = start;
    while (heap.length) {
      const item = pop(),
        i = item.id;
      if (item.cost !== g[i]) continue;
      if (h(i) < h(best) || (h(i) === h(best) && g[i]! < g[best]!)) best = i;
      if (i === end) {
        best = end;
        break;
      }
      for (const j of this.neighbours(i)) {
        const cost =
          g[i]! + (i % w !== j % w && Math.floor(i / w) !== Math.floor(j / w) ? Math.SQRT2 : 1);
        if (visited[j] !== generation || cost < g[j]!) {
          visited[j] = generation;
          g[j] = cost;
          previous[j] = i;
          push(j);
        }
      }
    }
    const ids: number[] = [];
    for (let i = best; i !== -1; i = previous[i]!) ids.push(i);
    return ids.reverse();
  }
  /** Exact cell traversal; a ray touching a blocked corner is blocked. */
  raycast(from: Point, to: Point): Ray {
    from = axes(from, this.up);
    to = axes(to, this.up);
    const s = this.#state,
      start = this.atInternal(from),
      dx = (to[0]! - from[0]!) / s.cell,
      dz = (to[2]! - from[2]!) / s.cell;
    const hit = (t: number, clear: boolean): Ray => ({
      clear,
      fraction: t,
      point: fromAxes(
        [from[0]! + (to[0]! - from[0]!) * t, s.origin[1], from[2]! + (to[2]! - from[2]!) * t],
        this.up,
      ),
    });
    if (start < 0 || s.blocked[start] || Math.abs(from[1]! - s.origin[1]) > 1e-6)
      return hit(0, false);
    let x = start % s.width,
      z = Math.floor(start / s.width);
    const sx = Math.sign(dx),
      sz = Math.sign(dz),
      ux = (from[0]! - s.origin[0]) / s.cell,
      uz = (from[2]! - s.origin[2]) / s.cell;
    let tx = dx === 0 ? Infinity : ((sx > 0 ? x + 1 : x) - ux) / dx;
    let tz = dz === 0 ? Infinity : ((sz > 0 ? z + 1 : z) - uz) / dz;
    const free = (xx: number, zz: number): boolean =>
      xx >= 0 && zz >= 0 && xx < s.width && zz < s.depth && !s.blocked[zz * s.width + xx];
    for (;;) {
      const t = Math.min(tx, tz);
      if (t > 1) return hit(1, Math.abs(to[1]! - s.origin[1]) <= 1e-6);
      if (tx === tz) {
        if (!free(x + sx, z) || !free(x, z + sz) || !free(x + sx, z + sz)) return hit(t, false);
        x += sx;
        z += sz;
        tx += 1 / Math.abs(dx);
        tz += 1 / Math.abs(dz);
      } else if (tx < tz) {
        x += sx;
        if (!free(x, z)) return hit(t, false);
        tx += 1 / Math.abs(dx);
      } else {
        z += sz;
        if (!free(x, z)) return hit(t, false);
        tz += 1 / Math.abs(dz);
      }
    }
  }
  save(): Uint8Array {
    return pack('grid', { state: this.#state, options: this.#options });
  }
  static restore(bytes: Uint8Array): Grid {
    try {
      return Grid.restoreData(bytes);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('nav:')) throw error;
      throw new Error('nav: malformed grid snapshot');
    }
  }
  private static restoreData(bytes: Uint8Array): Grid {
    const { state: s, options } = unpack<{ state: GridState; options: GridOptions }>('grid', bytes);
    return new Grid(s.width, s.depth, s.cell, fromAxes(s.origin, s.up), s.blocked, options);
  }
}
