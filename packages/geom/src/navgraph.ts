/**
 * ============================================================================
 *  navgraph — an undirected graph of places in the XZ plane, and the six
 *  questions a population asks of one.
 * ============================================================================
 *  Extracted from a base-building game, where it was the navigable half of a
 *  700-line agent class that also knew what a colony was.
 *
 *  Where do I stand beside this road (`verge`), where do I walk to next
 *  (`walkAlong`), which way does the road run under me (`corridorAt`), which
 *  neighbour keeps me going (`nextFrom`), which one gets me closer (`toward`),
 *  and which node am I nearest (`nearest`). Plus the sampling bags — `hot` and
 *  `nearHot` are LISTS, not sets, so a node listed three times is drawn three
 *  times as often, which is how a graph gets weighted without a hard edge where
 *  the population stops existing.
 *
 *  ── WHAT IT DELIBERATELY DOES NOT KNOW ─────────────────────────────────────
 *  How the graph got built, and which nodes are hot. A subclass fills `nodes`,
 *  `edges`, `hot`, `nearHot` and `surface` from whatever a world actually is —
 *  placed buildings, an authored polyline, a synthesised layout — and this
 *  class never asks. In the game it came from, a subclass does that, and its
 *  building, hot-marking, synthesis and surface lookup stayed in the game,
 *  because "the stretch the hero camera photographs" and "the carriageway
 *  rides a metre above the regolith on a graded embankment" are facts about
 *  one world.
 *
 *  ── THE RNG IS INJECTED, AND THAT IS NOT A STYLE CHOICE ────────────────────
 *  `verge`, `walkAlong` and `nextFrom` draw from a stream a game also draws
 *  from for everything else. A private generator in here would leave the game's
 *  own sequence intact but consume nothing from it, so every seeded placement
 *  downstream would land somewhere else and every capture of a "deterministic"
 *  scenario would change. The caller passes its own `rnd`, and the number of
 *  draws per call is part of this class's contract: `verge` takes three (or two
 *  when a node has no neighbour), `walkAlong` takes four, `nextFrom` takes up to
 *  six, `toward` takes none. Change a draw count and you have moved the crowd.
 *
 *  ── AND EVERY TUNED NUMBER IS THE CALLER'S ─────────────────────────────────
 *  The weld tolerance, the verge slide, the overshoot band and the
 *  already-standing-here radius are all required options with no defaults. They
 *  are metres, and metres depend on how big a world's roads are: a default here
 *  would silently give the next game one game's 24.8 m boulevard.
 * ============================================================================
 */

/** Where a point projects onto the road, and which way the road runs there. */
export interface Corridor {
  /** the centreline point the sample projects onto */
  x: number; z: number;
  /** unit direction the road runs in there */
  dx: number; dz: number;
  /** metres from the centreline the sample was */
  lat: number;
  /** how much of this segment lies behind / ahead of the projection */
  back: number; fwd: number;
}

/** Every field required. See the header. */
export interface NavGraphOptions {
  /** metres. Two authored segment ends closer than this become one node. Well
   *  under the subdivision step, or it welds two interior samples of one run. */
  weldTol: number;
  /** metres of random slide along the road applied by `verge`, so a group
   *  sampled at one node does not stack on the node itself. */
  vergeSlide: number;
  /** `walkAlong` overshoots the next node by `len * (stepMin + rnd*stepSpan)`,
   *  so arrivals do not queue on the node. */
  stepMin: number;
  stepSpan: number;
  /** metres. `walkAlong` prefers a neighbour further than this from where the
   *  walker already is, so one that has just arrived does not turn round. */
  sameNode: number;
}

export class NavGraph {
  /** flat x,z pairs */
  nodes: number[] = [];
  edges: number[][] = [];
  /**
   * SAMPLING BAGS, NOT SETS. A node listed twice is drawn twice as often. A
   * subclass fills these; empty means "no weighting", and every sampler falls
   * back to the whole graph.
   */
  hot: number[] = [];
  nearHot: number[] = [];
  /** a per-node scalar `surfaceOn` interpolates, or NaN where unknown */
  surface: number[] = [];
  /** true when `surface` is meaningful. A subclass owns this. */
  surfaced = false;

  protected readonly rnd: () => number;
  protected readonly opts: NavGraphOptions;

  constructor(rnd: () => number, opts: NavGraphOptions) {
    this.rnd = rnd;
    this.opts = opts;
  }

  get count() { return this.edges.length; }

  nodeX(i: number) { return this.nodes[i * 2]; }
  nodeZ(i: number) { return this.nodes[i * 2 + 1]; }

  protected addNode(x: number, z: number): number {
    this.nodes.push(x, z);
    this.edges.push([]);
    return this.edges.length - 1;
  }

  protected link(a: number, b: number) {
    if (a === b) return;
    if (this.edges[a].indexOf(b) < 0) this.edges[a].push(b);
    if (this.edges[b].indexOf(a) < 0) this.edges[b].push(a);
  }

  /**
   * Snap to an existing node within `TOL`, or make a new one.
   *
   * Road segments are authored end-to-end, so consecutive segments share an
   * endpoint to within a metre or so; without the weld the graph comes out as a
   * pile of disjoint sticks and a vehicle can never leave the segment it
   * spawned on. TOL is well under the subdivision step so it can only ever join
   * segment ENDS, never two interior samples of the same run.
   */
  protected weld(x: number, z: number): number {
    const TOL2 = this.opts.weldTol * this.opts.weldTol;
    for (let i = 0; i < this.count; i++) {
      const dx = this.nodeX(i) - x, dz = this.nodeZ(i) - z;
      if (dx * dx + dz * dz < TOL2) return i;
    }
    return this.addNode(x, z);
  }

  /** Exact carriageway height for a vehicle that knows which segment it is on. */
  surfaceOn(a: number, b: number, t: number, fallback: number): number {
    if (!this.surfaced || this.surface.length !== this.count) return fallback;
    const ya = this.surface[a], yb = this.surface[b];
    if (Number.isFinite(ya) && Number.isFinite(yb)) return ya + (yb - ya) * t;
    if (Number.isFinite(ya)) return ya;
    if (Number.isFinite(yb)) return yb;
    return fallback;
  }

  /**
   * A destination one road node further ON from wherever (x, z) is, offset to
   * one side of the centreline.
   *
   * `verge()` samples a random hot node, which scatters the crowd over the whole
   * network in a way that reads as noise. This instead sends a bot to the NEXT
   * node along the road it is already beside, so a reassignment is a step of a
   * continuing journey and the population strings itself out along the road in
   * both directions, which is what a file of walkers along a road looks like.
   */
  walkAlong(x: number, z: number, off: number, out: { x: number; z: number }): boolean {
    if (this.count < 2) return false;
    const i = this.nearest(x, z);
    const adj = this.edges[i];
    if (!adj || adj.length === 0) return false;
    // Prefer a neighbour we are not already standing on top of, so a bot that
    // has just arrived does not immediately turn round.
    let j = adj[(this.rnd() * adj.length) | 0];
    for (let k = 0; k < 3; k++) {
      const c = adj[(this.rnd() * adj.length) | 0];
      const ddx = this.nodeX(c) - x, ddz = this.nodeZ(c) - z;
      if (ddx * ddx + ddz * ddz > this.opts.sameNode * this.opts.sameNode) { j = c; break; }
    }
    // ── TRIED AND REJECTED: BIASING THIS CHOICE TOWARD THE SUN ──
    //
    // A review of the hero frame found the crowd "are mid-grey panels against
    // mid-grey regolith" where the reference's robots are near-white, and part
    // of that is real: a robot walking AWAY from a 13-degree sun shows the
    // camera an unlit #c6c9cf back, which lands within a few counts of sunlit
    // regolith. Sending 70% of road walkers UP-SUN was implemented, captured,
    // and taken out again.
    //
    // It is a DRIFT. The caller's reassignment re-enters here every time a bot
    // arrives, so a standing preference for one bearing is integrated over the
    // whole session: the steady state is the entire crowd piled at the up-sun
    // end of the road and the rest of the boulevard empty — which is the other
    // half of the same review finding ("the entire left and bottom thirds of
    // the plain have none"). A staging bias that has to be re-applied every
    // arrival is not staging, it is a force. Fix the values instead (a tone
    // break in the figure's far LOD) and leave the traffic symmetric.
    let dx = this.nodeX(j) - this.nodeX(i);
    let dz = this.nodeZ(j) - this.nodeZ(i);
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    // Overshoot the node by up to half a segment so bots do not queue on it.
    const along = len * (this.opts.stepMin + this.rnd() * this.opts.stepSpan);
    out.x = this.nodeX(i) + dx * along + dz * off;
    out.z = this.nodeZ(i) + dz * along - dx * off;
    return true;
  }

  /**
   * THE CARRIAGEWAY NEAREST (x, z): its centreline point and which way it runs.
   *
   * `verge` and `walkAlong` both answer "give me somewhere on the road", which
   * is enough to STAND a figure beside a road and is not enough to make a FILE
   * of them: a file needs the road's own direction so every member can be
   * spaced along it and pointed down it. A crowd with the first and not the
   * second drew the review "figures facing arbitrary directions, going
   * nowhere" — which is precisely the missing tangent.
   *
   * Nearest node, then the closest of that node's own segments, then the
   * projection onto it. Same shape as the surface lookup a subclass writes, and
   * it has to be: a post
   * placed off one basis and founded off another is a robot standing beside
   * the road it is supposed to be walking down.
   *
   * @returns false when there is no network to speak of.
   */
  corridorAt(x: number, z: number, out: Corridor): boolean {
    if (this.count < 2) return false;
    const i = this.nearest(x, z);
    const adj = this.edges[i];
    if (!adj || adj.length === 0) return false;
    let bestD = Infinity;
    for (let e = 0; e < adj.length; e++) {
      const j = adj[e];
      const ax = this.nodeX(i), az = this.nodeZ(i);
      const sx = this.nodeX(j) - ax, sz = this.nodeZ(j) - az;
      const l2 = sx * sx + sz * sz;
      if (l2 < 1e-6) continue;
      const u = Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / l2));
      const px = ax + sx * u, pz = az + sz * u;
      const d = Math.hypot(x - px, z - pz);
      if (d < bestD) {
        bestD = d;
        const l = Math.sqrt(l2);
        out.x = px; out.z = pz;
        out.dx = sx / l; out.dz = sz / l;
        out.lat = d;
        // How much road there is either side of the projection, so a file can be
        // laid along it without running off the end of the segment.
        out.back = l * u; out.fwd = l * (1 - u);
      }
    }
    return bestD < Infinity;
  }

  /** A node index worth being on, biased to the built area. */
  hotNode(k: number): number {
    if (this.hot.length === 0) return this.count > 0 ? k % this.count : 0;
    return this.hot[((k % this.hot.length) + this.hot.length) % this.hot.length];
  }

  /** A node on the near half of the boulevard. Falls back to `hotNode`. */
  nearNode(k: number): number {
    if (this.nearHot.length === 0) return this.hotNode(k);
    return this.nearHot[((k % this.nearHot.length) + this.nearHot.length) % this.nearHot.length];
  }

  /**
   * Unique near-half nodes, in graph order (south to north along the
   * authored boulevard). Used to SPACE the near fleet rather than stack it
   * on whichever node the bag listed most often.
   */
  nearUnique(): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    const src = this.nearHot.length ? this.nearHot : this.hot;
    for (let i = 0; i < src.length; i++) {
      const n = src[i];
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    if (out.length === 0) {
      for (let i = 0; i < this.count; i++) out.push(i);
    }
    return out;
  }

  /** Pick a neighbour, preferring to keep going rather than to double back. */
  nextFrom(node: number, from: number): number {
    const adj = this.edges[node];
    if (!adj || adj.length === 0) return from;
    if (adj.length === 1) return adj[0];
    for (let tries = 0; tries < 6; tries++) {
      const c = adj[(this.rnd() * adj.length) | 0];
      if (c !== from) return c;
    }
    return adj[0];
  }

  /**
   * Neighbour that most reduces distance to a world point. Haul trucks
   * use this so the boulevard is a route, not a parade loop. No rnd.
   */
  toward(node: number, from: number, x: number, z: number): number {
    const adj = this.edges[node];
    if (!adj || adj.length === 0) return from;
    if (adj.length === 1) return adj[0];
    const here = Math.hypot(this.nodeX(node) - x, this.nodeZ(node) - z);
    let best = adj[0], bestD = Infinity;
    for (let i = 0; i < adj.length; i++) {
      const c = adj[i];
      if (c === from && adj.length > 1) continue;
      const d = Math.hypot(this.nodeX(c) - x, this.nodeZ(c) - z);
      if (d < bestD) { bestD = d; best = c; }
    }
    // If every neighbour is worse we are at the closest node — sit
    // on a side road rather than reverse-oscillate.
    if (bestD > here + 1.5 && adj.length > 1) {
      for (let i = 0; i < adj.length; i++) if (adj[i] !== from) return adj[i];
    }
    return best;
  }

  /**
   * A point `off` metres to one side of the road centreline, at a random node.
   *
   * A uniform scatter over a site reads as noise; a file of figures walking the
   * verge reads as a commute. This is the sampler that buys that, and it is also
   * where a vehicle should be spawned so it starts on the slab instead of
   * snapping onto it on its first tick.
   */
  verge(off: number, out: { x: number; z: number }, near = false): boolean {
    if (this.count < 2) return false;
    const bag = near && this.nearHot.length ? this.nearHot : this.hot;
    const i = bag.length
      ? bag[(this.rnd() * bag.length) | 0]
      : this.hotNode((this.rnd() * Math.max(1, this.hot.length || this.count)) | 0);
    const adj = this.edges[i];
    const j = adj && adj.length ? adj[(this.rnd() * adj.length) | 0] : -1;
    let dx = 0, dz = 1;
    if (j >= 0) {
      dx = this.nodeX(j) - this.nodeX(i);
      dz = this.nodeZ(j) - this.nodeZ(i);
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
    }
    // right-hand normal, plus a little slide along the road so a group of bots
    // does not stack on the sample point itself
    const along = (this.rnd() - 0.5) * this.opts.vergeSlide;
    out.x = this.nodeX(i) + dz * off + dx * along;
    out.z = this.nodeZ(i) - dx * off + dz * along;
    return true;
  }

  nearest(x: number, z: number): number {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.count; i++) {
      const dx = this.nodeX(i) - x, dz = this.nodeZ(i) - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    return best;
  }
}
