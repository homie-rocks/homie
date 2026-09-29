/**
 * ============================================================================
 *  station — a closed corridor resampled into stations, and the line through it
 * ============================================================================
 *  Both racers bake the same object before the lights go out: a closed path cut
 *  into `n` evenly spaced stations, each carrying a centre point, a lateral
 *  ("binormal") axis, a half-width and a bank; a lateral OFFSET table solved so
 *  the resulting polyline has as little curvature as the corridor allows; and a
 *  pile of wrap-safe lookups the drivers hit tens of thousands of times a
 *  second with no allocation.
 *
 *  The two racing games this was extracted from have AI drivers that are forks
 *  of each other, and most of what is in them is not shared — the drivers
 *  disagree about lookahead, avoidance reach, items, thermal budget and where
 *  across the road they like to sit. But the SOLVER and the LOOKUPS were
 *  byte-identical, comments included, apart from three values (see
 *  `OffsetSolveOpts`). That is what lives here.
 *
 *  IT DOES NOT KNOW WHAT A TRACK IS, and it does not know what a lap, a
 *  checkpoint, a place or an item is, for the reason `curvature.ts` next door
 *  states: a game's track type carries a racing line, sectors and a width
 *  profile, and a package that imports it has imported a game. The caller
 *  fills the corridor arrays itself and keeps its own speed profile, its own
 *  section table and its own idea of what winning looks like. The most this
 *  file will say about speed
 *  is `brakePass`, which is "no station may be faster than it can decelerate
 *  from into the next one" — a statement about a scalar on a closed path.
 *
 *  `three` DOES NOT CROSS THIS SEAM. `point` and `nodePoint` write through a
 *  three-number `Vec3Out`, which a `THREE.Vector3` satisfies structurally, so
 *  there is no second copy of three.js to be an `instanceof` universe of its
 *  own. The solver itself uses plain locals rather than scratch vectors — see
 *  the note on `solveOffsets`.
 *
 *  THE ARITHMETIC IS THE CONTRACT. Every expression below is the games' own,
 *  in the games' own evaluation order, down to `Math.hypot(...) || 1e-4` and
 *  `(2 * d) / (l1 + l2)`. Float32Array stores round; reordering two of these
 *  sums moves a baked line by microns and a speed profile by more, and a parity
 *  test pins the result bit-exact against fingerprints taken from the games'
 *  own source before extraction. Do not tidy it.
 * ============================================================================
 */

/**
 * The write target for a point lookup. Three numbers and a setter — which is
 * every vector library there has ever been, and specifically `THREE.Vector3`.
 */
export interface Vec3Out {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): unknown;
}

/**
 * What the minimum-curvature solve needs to know that the two games disagree
 * about. Everything NOT here was identical in both and is written into the
 * body: the corner-hug weight (0.24), the late-apex bend gain (26) and weight
 * (0.55), and the twelve de-kinking passes after it.
 */
export interface OffsetSolveOpts {
  /** how far inside the kerb / lip the line is allowed to run, metres */
  edgeMargin: number;
  /** relaxation passes for the minimum-curvature solve */
  relaxPasses: number;
  /** how much of the way toward the neighbour midpoint each pass moves */
  relaxRate: number;
  /**
   * Knee of the corner-hugging blend, in 1/curvature.
   *
   * The kart racer fitted 150 against R-40 corners. The space racer runs
   * R 107-292, where the same expression saturates on every corner on the lap
   * and the blend stops discriminating, so its knee is 320 — half weight at
   * R 640.
   * A VALUE, and the only reason this is a parameter.
   */
  hugKnee: number;
  /** metres the apex is pushed later than the geometric optimum */
  lateApexShift: number;
  /**
   * Signed curvature of the CORRIDOR CENTRE at each station, 1/m, negative =
   * left.
   *
   * Supplied rather than computed, because this is exactly where the two games
   * stop agreeing: the kart racer measures it in the XZ plane
   * (`centrePlanCurvature` below), the space racer measures it about each
   * station's own normal, which is
   * the only formulation whose sign survives a deck rolling through vertical.
   * A plan-space cross product flips meaning at 90° of roll.
   */
  centreCurv: Float64Array;
}

/**
 * A closed path cut into evenly spaced stations, with a lateral offset table.
 *
 * Extended, not used directly: each game's racing-line subclass adds the tables
 * its own circuit needs (a speed profile in both; solar visibility, section
 * types, a roll fraction and a vertical curvature in the space racer) and its
 * own `build`. Everything on this class is public because the games'
 * projectile and race code read `length`, `yaw` and `index` directly.
 */
export class StationLine {
  /** number of stations */
  count = 0;
  /** metres between stations */
  ds = 0;
  /** arc length of the whole closed path, metres */
  length = 0;

  /** line point (the centre point displaced by `off` along the binormal) */
  px!: Float32Array; py!: Float32Array; pz!: Float32Array;
  /** corridor centre point */
  cx!: Float32Array; cy!: Float32Array; cz!: Float32Array;
  /** the lateral ("right") axis at the station */
  bx!: Float32Array; by!: Float32Array; bz!: Float32Array;
  /** unit tangent of the LINE (not the centre), as an XZ compass heading */
  yaw!: Float32Array;
  /** lateral offset of the line from the corridor centre, metres */
  off!: Float32Array;
  /** corridor half-width at the station, metres */
  half!: Float32Array;
  /** bank angle at the station, radians */
  bank!: Float32Array;
  /** signed curvature of the line, 1/m; negative = left, by convention */
  curv!: Float32Array;

  /**
   * Size the tables. Call once, at the top of `build`, before anything else.
   *
   * The subclass allocates its own extra tables the same way; they are separate
   * arrays on purpose, because the precision chain is visible in the answer
   * (`curvature.ts` says the same thing about its Float64/Float32 pair).
   */
  alloc(n: number, length: number) {
    this.count = n;
    this.length = length;
    this.ds = length / n;
    const f = () => new Float32Array(n);
    this.px = f(); this.py = f(); this.pz = f();
    this.cx = f(); this.cy = f(); this.cz = f();
    this.bx = f(); this.by = f(); this.bz = f();
    this.yaw = f(); this.off = f(); this.half = f();
    this.bank = f(); this.curv = f();
  }

  /** the centre point of station `i` displaced `off` metres along its binormal */
  nodePoint(i: number, off: number, out: Vec3Out) {
    out.set(
      this.cx[i] + this.bx[i] * off,
      this.cy[i] + this.by[i] * off,
      this.cz[i] + this.bz[i] * off,
    );
  }

  /**
   * Signed curvature of the CORRIDOR CENTRE in the XZ plane, into `out`.
   *
   * For a circuit that never leaves the horizontal enough to matter. A deck
   * that rolls past vertical must not use this — see `OffsetSolveOpts.centreCurv`.
   */
  centrePlanCurvature(out: Float64Array) {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const v1x = this.cx[i] - this.cx[a], v1z = this.cz[i] - this.cz[a];
      const v2x = this.cx[b] - this.cx[i], v2z = this.cz[b] - this.cz[i];
      const l1 = Math.hypot(v1x, v1z) || 1e-4;
      const l2 = Math.hypot(v2x, v2z) || 1e-4;
      const t1x = v1x / l1, t1z = v1z / l1;
      const t2x = v2x / l2, t2z = v2z / l2;
      out[i] = (2 * Math.atan2(t1x * t2z - t1z * t2x, t1x * t2x + t1z * t2z)) / (l1 + l2);
    }
  }

  /**
   * Solve `off`: minimum curvature through the corridor, hugged back toward the
   * inside a little, then given a late apex.
   *
   * THREE PASSES, AND EACH IS UNDOING A PROBLEM THE ONE BEFORE IT CREATED.
   *
   *  1. **Relaxation.** Moving every node toward the midpoint of its
   *     neighbours, but only along the lateral axis, is gradient descent on
   *     total curvature. Constrained by the corridor it converges on the
   *     geometric racing line: wide on entry, clipping the apex, wide again on
   *     exit. It is solved in WORLD space and projected onto the binormal, and
   *     that is what makes it do the right thing through a rolling deck for
   *     free: holding a constant lateral offset while the deck rolls 180° over
   *     66 m is a helix of radius `off`, and a helix has real curvature (0.011
   *     /m at 5 m of offset). The solver sees that cost and drives the line to
   *     the middle of the deck through the roll, which is where a human would
   *     put it.
   *
   *  2. **The corner-hugging blend.** A pure minimum-curvature line
   *     straight-lines a wide corner into nothing: technically fastest, but it
   *     drives like a solver and it never loads the machine hard enough to be
   *     worth a drift or an air-brake. Blending a little of the classic
   *     hug-the-inside line back in restores the shape of the circuit — the
   *     corners stay corners, the tiers are worth taking, and the cost in lap
   *     time is a couple of tenths.
   *
   *  3. **The late apex.** Re-reading the converged offset from slightly
   *     *earlier* along the path delays the whole pattern, which is exactly
   *     what a late apex is: give up entry radius to straighten the exit. Only
   *     applied where it is a corner — shifting the line on a straight would
   *     just make it wander — and followed by a dozen smoothing passes to take
   *     the kinks back out.
   *
   * NO MODULE SCRATCH VECTOR IS USED HERE, deliberately. Both games ran this
   * loop through a shared `_p0`/`_p2` pair; moving it into a package would have
   * given it a DIFFERENT pair, and a value the game held across the call would
   * survive where it used to be clobbered. Plain locals cannot have that bug at
   * all — and both `_p0` and `_p2` were only ever read on the next line anyway,
   * which is why the arithmetic below is identical rather than merely
   * equivalent.
   */
  solveOffsets(o: OffsetSolveOpts) {
    const n = this.count;
    const off = this.off;
    const ck = o.centreCurv;
    const lim = new Float32Array(n);
    for (let i = 0; i < n; i++) lim[i] = Math.max(0.5, this.half[i] - o.edgeMargin);

    for (let pass = 0; pass < o.relaxPasses; pass++) {
      for (let i = 0; i < n; i++) {
        const a = (i - 1 + n) % n;
        const b = (i + 1) % n;
        // the two neighbours, each displaced by its own offset — this is
        // `nodePoint(a, off[a], _p0)` and `nodePoint(b, off[b], _p2)` inlined
        const p0x = this.cx[a] + this.bx[a] * off[a];
        const p0y = this.cy[a] + this.by[a] * off[a];
        const p0z = this.cz[a] + this.bz[a] * off[a];
        const p2x = this.cx[b] + this.bx[b] * off[b];
        const p2y = this.cy[b] + this.by[b] * off[b];
        const p2z = this.cz[b] + this.bz[b] * off[b];
        // midpoint of the neighbours, expressed in this node's lateral frame
        const mx = (p0x + p2x) * 0.5 - this.cx[i];
        const my = (p0y + p2y) * 0.5 - this.cy[i];
        const mz = (p0z + p2z) * 0.5 - this.cz[i];
        const want = mx * this.bx[i] + my * this.by[i] + mz * this.bz[i];
        off[i] = clamp(off[i] + (want - off[i]) * o.relaxRate, -lim[i], lim[i]);
      }
    }

    {
      const w = 0.24;
      for (let i = 0; i < n; i++) {
        const inside = Math.sign(ck[i]) * Math.min(1, Math.abs(ck[i]) * o.hugKnee) * this.half[i] * 0.5;
        off[i] = clamp(off[i] + (inside - off[i]) * w, -lim[i], lim[i]);
      }
    }

    {
      const shift = Math.max(1, Math.round(o.lateApexShift / this.ds));
      const src = Float32Array.from(off);
      for (let i = 0; i < n; i++) {
        const a = (i - 1 + n) % n;
        const b = (i + 1) % n;
        // second difference of the offset ~ how hard this node is working
        const bend = Math.abs(src[a] - 2 * src[i] + src[b]) / this.ds;
        const w = Math.min(1, bend * 26) * 0.55;
        const j = (i - shift + n) % n;
        off[i] = clamp(src[i] + (src[j] - src[i]) * w, -lim[i], lim[i]);
      }
      for (let pass = 0; pass < 12; pass++) {
        for (let i = 0; i < n; i++) {
          const a = (i - 1 + n) % n;
          const b = (i + 1) % n;
          off[i] = clamp(off[i] * 0.6 + (off[a] + off[b]) * 0.2, -lim[i], lim[i]);
        }
      }
    }
  }

  /** fill `px/py/pz` from the solved `off`. Call after any pass that edits it. */
  resolvePoints() {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      this.px[i] = this.cx[i] + this.bx[i] * this.off[i];
      this.py[i] = this.cy[i] + this.by[i] * this.off[i];
      this.pz[i] = this.cz[i] + this.bz[i] * this.off[i];
    }
  }

  /**
   * Fill `yaw` from the line points, as a WORLD COMPASS bearing in XZ.
   *
   * It stays a plan bearing even on a circuit that rolls, because it is not the
   * driver's: homing projectiles and the wrong-way test read it, and both of
   * those genuinely want a bearing. The driver uses `curv` and the chassis
   * frame instead.
   */
  resolveYaw() {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const v1x = this.px[i] - this.px[a], v1z = this.pz[i] - this.pz[a];
      const v2x = this.px[b] - this.px[i], v2z = this.pz[b] - this.pz[i];
      this.yaw[i] = Math.atan2(v2x + v1x, v2z + v1z);
    }
  }

  /**
   * Fill `curv` with the signed curvature of the LINE in the XZ plane.
   *
   * The two segment directions are `(l1+l2)/2` apart along the path, not
   * `l1+l2` — getting that wrong halves every curvature and the whole field
   * arrives at the hairpin believing it is a kink.
   */
  resolvePlanCurvature() {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const v1x = this.px[i] - this.px[a], v1z = this.pz[i] - this.pz[a];
      const v2x = this.px[b] - this.px[i], v2z = this.pz[b] - this.pz[i];
      const l1 = Math.hypot(v1x, v1z) || 1e-4;
      const l2 = Math.hypot(v2x, v2z) || 1e-4;
      const t1x = v1x / l1, t1z = v1z / l1;
      const t2x = v2x / l2, t2z = v2z / l2;
      const d = Math.atan2(t1x * t2z - t1z * t2x, t1x * t2x + t1z * t2z);
      this.curv[i] = (2 * d) / (l1 + l2);
    }
  }

  /**
   * Circular box blur of `curv`, `radius` stations either side.
   *
   * Curvature straight off three samples is noisy at any realistic station
   * spacing; a short blur turns it into something a speed profile can trust.
   */
  smoothCurv(radius: number) {
    this.smoothTable(this.curv, radius);
  }

  /**
   * The same wrap-safe box blur over any per-station table. `smoothCurv` is this
   * with `curv` filled in, and it kept its name because both games call it.
   *
   * A blur here is not cosmetic. A raw three-sample curvature at ~9 m spacing
   * puts a speed limit on a single node of surface relief, and a field that
   * brakes for a weld is a field that looks broken.
   */
  smoothTable(table: Float32Array, radius: number) {
    const n = this.count;
    const src = Float32Array.from(table);
    const w = radius * 2 + 1;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) acc += src[(i + k + n) % n]!;
      table[i] = acc / w;
    }
  }

  /**
   * Backward pass over a per-station speed table: no station may be faster than
   * it can decelerate from into the one after it. Twice around, so the loop
   * seam is consistent.
   *
   * The table is passed in rather than owned: what limits a machine, and how
   * much of the capability the planner is allowed to spend, is the game's.
   */
  brakePass(speed: Float32Array, aBrake: number) {
    const n = this.count;
    for (let pass = 0; pass < 2; pass++) {
      for (let s = n - 1; s >= 0; s--) {
        const i = s;
        const j = (i + 1) % n;
        const cap = Math.sqrt(speed[j] * speed[j] + 2 * aBrake * this.ds);
        if (speed[i] > cap) speed[i] = cap;
      }
    }
  }

  // --- runtime lookups (all wrap, all allocation-free) --------------------

  /** station index for an arc distance */
  index(d: number): number {
    const n = this.count;
    let i = Math.floor((d / this.length) * n) % n;
    if (i < 0) i += n;
    return i;
  }

  /** interpolated line point at arc distance `d` */
  point<T extends Vec3Out>(d: number, out: T): T {
    const n = this.count;
    let f = (d / this.length) * n;
    f -= Math.floor(f / n) * n;
    const i = Math.floor(f) % n;
    const j = (i + 1) % n;
    const u = f - Math.floor(f);
    out.set(
      this.px[i] + (this.px[j] - this.px[i]) * u,
      this.py[i] + (this.py[j] - this.py[i]) * u,
      this.pz[i] + (this.pz[j] - this.pz[i]) * u,
    );
    return out;
  }

  /** interpolated lateral offset of the line at arc distance `d` */
  offsetAt(d: number): number {
    const n = this.count;
    let f = (d / this.length) * n;
    f -= Math.floor(f / n) * n;
    const i = Math.floor(f) % n;
    const j = (i + 1) % n;
    const u = f - Math.floor(f);
    return this.off[i] + (this.off[j] - this.off[i]) * u;
  }

  curvAt(d: number): number {
    return this.curv[this.index(d)];
  }

  /** nearest-station read of any per-station table */
  at(table: Float32Array, d: number): number {
    return table[this.index(d)];
  }

  /** lowest value of a per-station table over the next `span` metres */
  minOver(table: Float32Array, d: number, span: number): number {
    const steps = Math.max(1, Math.round(span / this.ds));
    const i0 = this.index(d);
    let m = Infinity;
    for (let s = 0; s <= steps; s++) {
      const v = table[(i0 + s) % this.count];
      if (v < m) m = v;
    }
    return m;
  }

  /** highest value of a per-station table over the next `span` metres */
  peakOver(table: Float32Array, d: number, span: number): number {
    const steps = Math.max(1, Math.round(span / this.ds));
    const i0 = this.index(d);
    let best = 0;
    for (let s = 0; s <= steps; s++) {
      const v = table[(i0 + s) % this.count];
      if (v > best) best = v;
    }
    return best;
  }

  /** strongest |curvature| over the next `span` metres, keeping its sign */
  peakCurv(d: number, span: number): number {
    const steps = Math.max(1, Math.round(span / this.ds));
    const i0 = this.index(d);
    let best = 0;
    for (let s = 0; s <= steps; s++) {
      const c = this.curv[(i0 + s) % this.count];
      if (Math.abs(c) > Math.abs(best)) best = c;
    }
    return best;
  }

  /** signed lateral offset of a world point from the corridor centre at progress t */
  lateralOf(x: number, y: number, z: number, t: number): number {
    const i = this.index(t * this.length);
    return (x - this.cx[i]) * this.bx[i] + (y - this.cy[i]) * this.by[i] + (z - this.cz[i]) * this.bz[i];
  }

  /** forward arc gap from `d` to `target`, always in [0, length) */
  gapTo(d: number, target: number): number {
    let g = target - d;
    g -= Math.floor(g / this.length) * this.length;
    return g;
  }

  /**
   * Raise `table` to at least `v` at every station between two arc distances.
   *
   * Wrap-safe by construction — the loop runs over raw station indices and
   * takes them modulo `count`, so a span that crosses the start/finish line is
   * not a special case. `d1` may legitimately be less than `d0`.
   */
  raiseOver(table: Float32Array, d0: number, d1: number, v: number) {
    const n = this.count;
    const i0 = Math.floor(d0 / this.ds);
    const i1 = Math.ceil(d1 / this.ds);
    for (let s = i0; s <= i1; s++) {
      const i = ((s % n) + n) % n;
      if (table[i]! < v) table[i]! = v;
    }
  }

  /**
   * 0..1 ramp along the line: full over [t0, t1], easing in over `lead` metres
   * before it, zero everywhere else. Wrap-safe.
   *
   * `t0`/`t1` are progress in [0, 1); `lead` is progress too, so the ramp scales
   * with the line rather than being a fixed number of metres on every circuit.
   */
  rampWeight(t: number, t0: number, t1: number, lead: number): number {
    const L = this.length;
    const d = t * L;
    const a = (t0 - lead) * L, b = t0 * L, c = t1 * L;
    const g0 = this.gapTo(a, d);                 // how far past the ramp start
    const width = (c - a + L) % L;
    if (g0 > width) return 0;
    const inRamp = (b - a + L) % L;
    return g0 < inRamp ? g0 / Math.max(1e-3, inRamp) : 1;
  }

  /**
   * Signed curvature of the three-point arc a -> b -> c, measured IN THE PLANE
   * whose normal is `(nx, ny, nz)`.
   *
   * The sign convention is the one `curv` already uses: `t1 x t2` points along
   * +normal for a turn toward -binormal, so the negation puts that turn on the
   * negative side of zero.
   *
   * TAKING THE TWO SEGMENT DIRECTIONS `(l1+l2)/2` APART RATHER THAN `l1+l2` IS
   * NOT AN OPTIMISATION AND IT HAS BEEN GOT WRONG: halving every curvature has
   * a whole field arrive at the tightest corner on the circuit believing it is
   * a kink.
   *
   * Plain locals, no scratch vectors, and `Math.sqrt(x*x + y*y + z*z)` rather
   * than `Math.hypot` — the two are not the same number, and this file's header
   * says why that matters here.
   */
  arcCurvature(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
  ): number {
    let t1x = bx - ax, t1y = by - ay, t1z = bz - az;
    let t2x = cx - bx, t2y = cy - by, t2z = cz - bz;
    const l1 = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z) || 1e-4;
    const l2 = Math.sqrt(t2x * t2x + t2y * t2y + t2z * t2z) || 1e-4;
    const i1 = 1 / l1, i2 = 1 / l2;
    t1x *= i1; t1y *= i1; t1z *= i1;
    t2x *= i2; t2y *= i2; t2z *= i2;
    const crx = t1y * t2z - t1z * t2y;
    const cry = t1z * t2x - t1x * t2z;
    const crz = t1x * t2y - t1y * t2x;
    const s = -(crx * nx + cry * ny + crz * nz);
    return (2 * Math.atan2(s, t1x * t2x + t1y * t2y + t1z * t2z)) / (l1 + l2);
  }

  /**
   * Curvature of the three-point arc a -> b -> c resolved ONTO `(nx, ny, nz)` —
   * i.e. how much the path bends OUT of the plane, rather than within it.
   *
   * `arcCurvature` is the turn; this is the crest and the dip. Negative means
   * the surface falls away under you, which on a magnetically-held vehicle is
   * the one place where the hold budget rather than the grip budget sets the
   * speed, and on a wheeled one is where it goes light.
   *
   * `(t2 - t1) . n` over the MEAN chord, which is why the divisor is
   * `(l1 + l2) * 0.5` and not `l1 + l2`.
   */
  normalCurvature(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
  ): number {
    let t1x = bx - ax, t1y = by - ay, t1z = bz - az;
    let t2x = cx - bx, t2y = cy - by, t2z = cz - bz;
    const l1 = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z) || 1e-4;
    const l2 = Math.sqrt(t2x * t2x + t2y * t2y + t2z * t2z) || 1e-4;
    const i1 = 1 / l1, i2 = 1 / l2;
    t1x *= i1; t1y *= i1; t1z *= i1;
    t2x *= i2; t2y *= i2; t2z *= i2;
    return ((t2x - t1x) * nx + (t2y - t1y) * ny + (t2z - t1z) * nz) / ((l1 + l2) * 0.5);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
