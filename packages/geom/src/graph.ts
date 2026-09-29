/**
 * ============================================================================
 *  graph — the two structures a placed world needs before it can answer "is
 *  this connected to that" and "how do I get there", and NEITHER of them has
 *  an opinion about what a connection means.
 * ============================================================================
 *  Extracted from a base-building game's network code.
 *
 *  ── WHAT THE ORIGINAL FILE GOT RIGHT, AND WHY IT STILL LOST CODE ───────────
 *  The source file's own argument was a good one: power, tubes and roads are
 *  the same connected-component problem with different edges and different
 *  liveness rules, so it is ONE implementation with three configurations
 *  rather than three files that drift. That is correct and it is untouched —
 *  every liveness rule, every tunable and the whole notion of a "grid" stayed
 *  in the game.
 *
 *  What it also said was *"no second consumer exists; a graph package with an
 *  opinion about what makes a tube live would be worse than this"*, and that
 *  sentence proves too much. A disjoint set has no opinion about a tube. Nor
 *  does Dijkstra. What was actually entangled was the OPINION and the
 *  MACHINERY sitting in one file, and the fix is to keep the opinion and move
 *  the machinery — not to keep both because separating them would have been
 *  wrong in one particular way it is not being done.
 *
 *  ── EVERY TUNED NUMBER IS THE CALLER'S, AND THERE ARE NO DEFAULTS ──────────
 *  `WeldGraph` takes its weld tolerance as a required constructor argument and
 *  `nearest` takes its radius as a required argument. Both are METRES, and
 *  metres depend on how big a world's roads are: the game this came from welds
 *  at 7 m because a road segment there is about twelve. A default here would
 *  hand the next world that game's boulevard, which is the failure mode a
 *  parity test cannot see — the floats stay identical for the game that was
 *  measured and the next game silently inherits its scale.
 *
 *  ── COMPLEXITY, STATED RATHER THAN ASSUMED ─────────────────────────────────
 *  `vertexAt` is a LINEAR SCAN of the existing vertices and `nearest` is
 *  another, and `path` is Dijkstra with a linear scan for the minimum rather
 *  than a heap. All three are O(n) or O(n²) in the vertex count and all three
 *  are deliberate: the graph a placed world builds has a few hundred vertices
 *  at the very most, and a binary heap here would be more code than the whole
 *  rest of this file. A caller with ten thousand vertices should not reach for
 *  this — it should say so, and this paragraph is where it finds out.
 *
 *  Imports nothing — not even `three`. A plain Node script can reproduce a
 *  world's connectivity and its routes with it.
 * ============================================================================
 */

/**
 * Union-find over a fixed number of members, with path halving.
 *
 * `find` compresses as it climbs (`parent[a] = parent[parent[a]]`), which is
 * the one-line half of path compression and is what keeps a chain of joined
 * link segments from degenerating into a list walk on every query.
 *
 * MEMBERS ARE INDICES, NOT IDS. The caller keeps its own id→index map. That is
 * not laziness: an `Int32Array` of parents is the whole state, it allocates
 * once per rebuild, and a `Map<number, number>` of parents would cost more
 * than the connectivity pass it is inside.
 */
export class DisjointSet {
  private readonly parent: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
  }

  /** The representative of a's set, compressing the path on the way up. */
  find(a: number): number {
    const p = this.parent;
    while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; }
    return a;
  }

  /** Join a's set and b's. Idempotent; joining a set to itself does nothing. */
  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/**
 * An undirected weighted graph of points in the XZ plane, whose vertices are
 * WELDED: two positions within `weldTol` of each other are the same vertex.
 *
 * The weld is the reason this is a class and not three loose functions. World
 * geometry is authored end to end — segment B starts where segment A finished,
 * to within whatever the placement rounding was — so without it the graph
 * comes out as a pile of disjoint sticks and nothing can ever leave the
 * segment it started on. That failure is silent: every query still answers,
 * every answer is "not connected", and the world looks like it simply has no
 * routes in it.
 */
export class WeldGraph {
  /** Flat [x, z, x, z, …] vertex positions. */
  readonly xz: number[] = [];
  /** `adj[i]` = vertex indices reachable from i; `w[i]` the matching lengths. */
  readonly adj: number[][] = [];
  readonly w: number[][] = [];

  private readonly weldTol2: number;

  /** @param weldTol metres. Two ends this close are one vertex. Required. */
  constructor(weldTol: number) {
    this.weldTol2 = weldTol * weldTol;
  }

  get count(): number { return this.adj.length; }

  x(i: number): number { return this.xz[i * 2]; }
  z(i: number): number { return this.xz[i * 2 + 1]; }

  /**
   * The index of the vertex at (x, z), welding to an existing one within
   * tolerance or appending a new one.
   *
   * THERE IS NO PER-VERTEX PAYLOAD AND THAT IS DELIBERATE. The original road
   * graph carried a parallel `comp: number[]` of component ids, written on
   * every rebuild and READ BY NOTHING — found with an unused-symbol pass. A
   * slot a package offers is a slot the next game fills, so an unused one does
   * not get to move: a caller
   * that needs a payload keeps its own array against these indices, which is
   * what the one that thought it needed one would have done.
   */
  vertexAt(x: number, z: number): number {
    const xz = this.xz;
    for (let i = 0; i < xz.length; i += 2) {
      const dx = x - xz[i], dz = z - xz[i + 1];
      if (dx * dx + dz * dz <= this.weldTol2) return i >> 1;
    }
    xz.push(x, z);
    this.adj.push([]);
    this.w.push([]);
    return (xz.length >> 1) - 1;
  }

  /** Join two vertices with an edge whose weight is the distance between them. */
  edge(a: number, b: number): void {
    if (a === b) return;
    const dx = this.xz[a * 2] - this.xz[b * 2];
    const dz = this.xz[a * 2 + 1] - this.xz[b * 2 + 1];
    const len = Math.sqrt(dx * dx + dz * dz);
    this.adj[a].push(b); this.w[a].push(len);
    this.adj[b].push(a); this.w[b].push(len);
  }

  /**
   * The nearest vertex to a world point within `maxDist` metres, or -1.
   *
   * `maxDist` is REQUIRED and there is no default. It is how far a thing may
   * be from the network and still count as being on it, which is a fact about
   * how wide the caller's roads are.
   */
  nearest(x: number, z: number, maxDist: number): number {
    const xz = this.xz;
    let best = -1, bd = maxDist * maxDist;
    for (let i = 0; i < xz.length; i += 2) {
      const dx = x - xz[i], dz = z - xz[i + 1];
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i >> 1; }
    }
    return best;
  }

  /**
   * Shortest path from vertex `a` to vertex `b`, written into `out` as a flat
   * [x, z, …] list. Returns false when they are not connected — and `out` is
   * cleared either way, so a caller that ignores the return value walks
   * nowhere rather than walking the previous path again.
   *
   * Dijkstra with a linear scan for the minimum. See the header on why there
   * is no heap.
   */
  path(a: number, b: number, out: number[]): boolean {
    out.length = 0;
    const n = this.adj.length;
    const xz = this.xz;
    if (a < 0 || b < 0 || a >= n || b >= n) return false;
    if (a === b) { out.push(xz[a * 2], xz[a * 2 + 1]); return true; }
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    dist[a] = 0;
    for (;;) {
      let u = -1, bestD = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < bestD) { bestD = dist[i]; u = i; }
      if (u < 0) break;
      if (u === b) break;
      done[u] = 1;
      const au = this.adj[u], wu = this.w[u];
      for (let k = 0; k < au.length; k++) {
        const v = au[k];
        const nd = dist[u] + wu[k];
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; }
      }
    }
    if (!Number.isFinite(dist[b])) return false;
    const stack: number[] = [];
    for (let v = b; v >= 0; v = prev[v]) stack.push(v);
    for (let i = stack.length - 1; i >= 0; i--) out.push(xz[stack[i] * 2], xz[stack[i] * 2 + 1]);
    return true;
  }
}
