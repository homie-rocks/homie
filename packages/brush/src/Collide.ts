/**
 * ============================================================================
 *  Collide.ts — a world made of axis-aligned boxes and a few sloped ramps.
 * ============================================================================
 *
 *  ## WHERE THIS CAME FROM, STATED FIRST BECAUSE IT IS THE WHOLE ARGUMENT
 *
 *  Every line of arithmetic below arrived from a first-person shooter's
 *  collision file, comment for comment. Three hundred and seventy raw lines
 *  that named a station, a dock, a hab and a well NOWHERE — it imported
 *  `three` and the game's own `Surface`/`STEP_HEIGHT` and nothing else, and
 *  you can describe every function in it without saying one word of that
 *  game's fiction. That is the rule of thumb for shared code here, and the
 *  file had been overlooked because a game's world folder was assumed to be
 *  content.
 *
 *  A world is content. A BROADPHASE IS NOT.
 *
 *  `@homie-rocks/walk/Ground.ts` named this exact file in its own header — as one of
 *  three live models of "what is under a person", the one that "has no answer
 *  for a bank" — and then, correctly, did not take it: a `GroundField` is a
 *  heightfield sample and this is a capsule sweep, and folding one into the
 *  other would merge two models that only look alike. So this is the OTHER
 *  half of that refusal, standing beside it rather than inside it. A game
 *  picks: a heightfield you can walk across at any angle, or a pile of boxes
 *  where LOS, nav and physics are the same data.
 *
 *  ## THE TWO THINGS THAT WERE LIFTED OUT, AND WHY EXACTLY TWO
 *
 *  The original file read two names out of the game's `types.ts`:
 *
 *   · `Surface` — a `const enum` of seven materials with friction, footstep
 *     gain and a dust colour hanging off it. THAT IS THE GAME. Brine is not a
 *     shared concept. But the broadphase never *interprets* a surface; it
 *     only carries one from the box that was hit back to the caller. So the
 *     class is generic over `S extends number` and the game names its own
 *     enum. `new CollisionWorld<Surface>(Surface.Concrete)` — no cast at any
 *     call site in either direction, which is the point of doing it this way
 *     instead of widening to `number` and casting at six seams.
 *
 *   · `STEP_HEIGHT` — 0.38 m, the lip a walker climbs without jumping. A
 *     TUNED NUMBER, and the rule here is that the package states the
 *     mechanism and the game states the number. It is a constructor option.
 *
 *  `CELL` went the same way for the same reason and its old comment is kept
 *  on the option: 4 m was chosen for a ~60x48 m station and a game with a
 *  different footprint should pass its own rather than inherit somebody
 *  else's building. Note the hard bound that comes with it — `pack()` biases
 *  by 128 cells and shifts by 12, so the addressable world is +/-128 cells on
 *  each axis. At the default that is +/-512 m and a station is nowhere near
 *  it; at a 64 m cell it is +/-8 km. Outside that range two distant cells
 *  ALIAS ONTO THE SAME KEY, which is not a crash — it is a wall you can walk
 *  through in one place and an invisible one somewhere else. `assertInRange`
 *  exists so that is a throw and not a haunting.
 *
 *  ## WHAT IS DELIBERATELY ABSENT
 *
 *  A mesh. A material. A nav graph. A room. A prop. This file answers three
 *  questions about a pile of boxes — what is under this point, what does this
 *  ray hit, and where does this capsule end up — and it is the caller that
 *  knows why it asked. `Brush.ts` next door is the authoring half that feeds
 *  it, and the two are separable on purpose: a game with its own level format
 *  can use this without ever building a bucket.
 *
 *  `three` is a peerDependency, never a dependency. Two copies of three.js is
 *  two `instanceof` universes and the symptom is arithmetic that reads zeroes.
 */
import * as THREE from 'three';

export interface BoxCol<S extends number = number> {
  min: THREE.Vector3;
  max: THREE.Vector3;
  surface: S;
  /** if set, this box is a one-way floor (no ceiling, no walls) */
  floorOnly?: boolean;
  /** solid but not walkable (railing, tank glass) */
  blockOnly?: boolean;
}

export interface RampCol<S extends number = number> {
  /** lower corner of the ramp slab, xz */
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** height at min.z and at max.z (or x if axis === 0) */
  y0: number;
  y1: number;
  axis: 0 | 2;
  surface: S;
}

export interface CollideOpts {
  /**
   * XZ hash cell, metres. The original station is ~60x48 m and 4 m cells keep
   * the lists short. See the header for the +/-128-cell addressing bound this
   * trades against.
   */
  cell?: number;
  /**
   * The lip a capsule climbs without jumping, metres. A stair riser and a
   * crate edge both have to be under it or they snag; a knee-high crate has
   * to be over it or the world has no obstacles.
   */
  stepHeight?: number;
}

const EPS = 1e-4;
const MAX_ITERS = 4;

/**
 * Swept capsule, hitscan and ground query against boxes and ramps.
 *
 * Capsule = vertical cylinder of `radius` with hemispherical caps, total
 * height `height`. The stored position is the FOOT (bottom of the lower
 * hemisphere sits on the floor).
 *
 * `defaultSurface` is what a query answers with when it found nothing to read
 * a surface off — a hit on a ramp reports the ramp's, a hit on a box reports
 * the box's, and the initial value before either has to be SOMETHING. The
 * game names it because only the game knows which of its materials is the
 * boring one.
 */
export class CollisionWorld<S extends number = number> {
  readonly boxes: BoxCol<S>[] = [];
  readonly ramps: RampCol<S>[] = [];
  private grid = new Map<number, number[]>();
  private seen = new Set<number>();
  private readonly cell: number;
  private readonly stepHeight: number;
  private readonly defaultSurface: S;

  constructor(defaultSurface: S, opts: CollideOpts = {}) {
    this.defaultSurface = defaultSurface;
    this.cell = opts.cell ?? 4;
    this.stepHeight = opts.stepHeight ?? 0.38;
  }

  addBox(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    surface: S = this.defaultSurface,
    flags?: { floorOnly?: boolean; blockOnly?: boolean },
  ): BoxCol<S> {
    const b: BoxCol<S> = {
      min: new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
      max: new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
      surface,
      floorOnly: flags?.floorOnly,
      blockOnly: flags?.blockOnly,
    };
    const i = this.boxes.length;
    this.boxes.push(b);
    const CELL = this.cell;
    const ix0 = Math.floor(b.min.x / CELL);
    const ix1 = Math.floor(b.max.x / CELL);
    const iz0 = Math.floor(b.min.z / CELL);
    const iz1 = Math.floor(b.max.z / CELL);
    assertInRange(ix0, iz0);
    assertInRange(ix1, iz1);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = pack(ix, iz);
        let list = this.grid.get(k);
        if (!list) { list = []; this.grid.set(k, list); }
        list.push(i);
      }
    }
    return b;
  }

  /** Visit unique boxes whose XZ cells overlap the query rectangle. */
  private visitXZ(x0: number, z0: number, x1: number, z1: number, fn: (b: BoxCol<S>) => void) {
    const CELL = this.cell;
    const ix0 = Math.floor(Math.min(x0, x1) / CELL);
    const ix1 = Math.floor(Math.max(x0, x1) / CELL);
    const iz0 = Math.floor(Math.min(z0, z1) / CELL);
    const iz1 = Math.floor(Math.max(z0, z1) / CELL);
    this.seen.clear();
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = this.grid.get(pack(ix, iz));
        if (!list) continue;
        for (let n = 0; n < list.length; n++) {
          const i = list[n]!;
          if (this.seen.has(i)) continue;
          this.seen.add(i);
          fn(this.boxes[i]!);
        }
      }
    }
  }

  addRamp(
    x0: number, z0: number, x1: number, z1: number,
    y0: number, y1: number, axis: 0 | 2,
    surface: S = this.defaultSurface,
  ): RampCol<S> {
    const r: RampCol<S> = {
      min: new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
      max: new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
      y0, y1, axis, surface,
    };
    this.ramps.push(r);
    return r;
  }

  rampY(r: RampCol<S>, x: number, z: number): number {
    if (r.axis === 2) {
      const t = (z - r.min.z) / Math.max(1e-4, r.max.z - r.min.z);
      return r.y0 + (r.y1 - r.y0) * THREE.MathUtils.clamp(t, 0, 1);
    }
    const t = (x - r.min.x) / Math.max(1e-4, r.max.x - r.min.x);
    return r.y0 + (r.y1 - r.y0) * THREE.MathUtils.clamp(t, 0, 1);
  }

  groundAt(x: number, z: number, yHint = 40): { y: number; surface: S; normal: THREE.Vector3 } | null {
    let bestY = -Infinity;
    let surface = this.defaultSurface;
    const normal = new THREE.Vector3(0, 1, 0);
    this.visitXZ(x, z, x, z, (b) => {
      if (b.blockOnly) return;
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) return;
      const top = b.max.y;
      if (top <= yHint + 0.6 && top > bestY) {
        bestY = top;
        surface = b.surface;
        normal.set(0, 1, 0);
      }
    });
    for (const r of this.ramps) {
      if (x < r.min.x || x > r.max.x || z < r.min.z || z > r.max.z) continue;
      const y = this.rampY(r, x, z);
      if (y <= yHint + 0.6 && y > bestY) {
        bestY = y;
        surface = r.surface;
        if (r.axis === 2) {
          const dy = r.y1 - r.y0;
          const dz = r.max.z - r.min.z;
          normal.set(0, dz, -dy).normalize();
          if (normal.y < 0) normal.multiplyScalar(-1);
        } else {
          const dy = r.y1 - r.y0;
          const dx = r.max.x - r.min.x;
          normal.set(-dy, dx, 0).normalize();
          if (normal.y < 0) normal.multiplyScalar(-1);
        }
      }
    }
    if (bestY === -Infinity) return null;
    return { y: bestY, surface, normal };
  }

  /**
   * Segment vs world, first hit. Used by hitscan and LOS.
   * Origin/dir in world space, dir should be unit.
   */
  raycast(
    origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number,
  ): { point: THREE.Vector3; normal: THREE.Vector3; dist: number; surface: S } | null {
    const CELL = this.cell;
    let best = maxDist;
    let hit = false;
    const point = new THREE.Vector3();
    const normal = new THREE.Vector3(0, 1, 0);
    let surface = this.defaultSurface;

    const steps = Math.max(1, Math.ceil(maxDist / (CELL * 0.45)));
    this.seen.clear();
    for (let s = 0; s <= steps; s++) {
      const tq = (s / steps) * maxDist;
      const qx = origin.x + dir.x * tq;
      const qz = origin.z + dir.z * tq;
      const ix = Math.floor(qx / CELL);
      const iz = Math.floor(qz / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.grid.get(pack(ix + dx, iz + dz));
          if (!list) continue;
          for (let n = 0; n < list.length; n++) {
            const i = list[n]!;
            if (this.seen.has(i)) continue;
            this.seen.add(i);
            const b = this.boxes[i]!;
            if (b.floorOnly) continue;
            const t = rayAabb(origin, dir, b.min, b.max, maxDist);
            if (t !== null && t < best) {
              best = t;
              hit = true;
              point.copy(origin).addScaledVector(dir, t);
              aabbNormal(point, b.min, b.max, normal);
              surface = b.surface;
            }
          }
        }
      }
    }
    for (const r of this.ramps) {
      // Treat the ramp as a thin slab between y0/y1 for LOS. Good enough for
      // cover and not worth a custom triangle test on the hot path.
      const min = _tmpMin.copy(r.min); min.y = Math.min(r.y0, r.y1) - 0.04;
      const max = _tmpMax.copy(r.max); max.y = Math.max(r.y0, r.y1) + 0.12;
      const t = rayAabb(origin, dir, min, max, maxDist);
      if (t !== null && t < best) {
        best = t;
        hit = true;
        point.copy(origin).addScaledVector(dir, t);
        normal.set(0, 1, 0);
        surface = r.surface;
      }
    }
    if (!hit) return null;
    return { point: point.clone(), normal: normal.clone(), dist: best, surface };
  }

  collide(
    pos: THREE.Vector3, vel: THREE.Vector3,
    radius: number, height: number, dt: number,
  ): { grounded: boolean; normal: THREE.Vector3; surface: S; wall: THREE.Vector3 | null; ceiling: boolean; stepped: boolean } {
    const STEP_HEIGHT = this.stepHeight;
    const p = pos;
    p.x += vel.x * dt;
    p.z += vel.z * dt;

    let grounded = false;
    let ceiling = false;
    let stepped = false;
    let surface = this.defaultSurface;
    const gNormal = new THREE.Vector3(0, 1, 0);
    let wall: THREE.Vector3 | null = null;

    // Step-up: if we are walking into a lip no taller than STEP_HEIGHT, climb
    // it before the wall solve so stairs and crate edges don't snag.
    const pad = radius + 0.6;
    this.visitXZ(p.x - pad, p.z - pad, p.x + pad, p.z + pad, (b) => {
      if (b.floorOnly || b.blockOnly) return;
      const ex0 = b.min.x - radius, ex1 = b.max.x + radius;
      const ez0 = b.min.z - radius, ez1 = b.max.z + radius;
      if (p.x < ex0 || p.x > ex1 || p.z < ez0 || p.z > ez1) return;
      const lip = b.max.y - p.y;
      if (lip > 0.02 && lip <= STEP_HEIGHT && p.y + height > b.max.y) {
        p.y = b.max.y;
        stepped = true;
      }
    });

    // Horizontal MTV on XZ against expanded AABBs.
    for (let iter = 0; iter < MAX_ITERS; iter++) {
      let bestPen = 0;
      let nx = 0, nz = 0;
      let hitBox: BoxCol<S> | null = null;
      this.visitXZ(p.x - pad, p.z - pad, p.x + pad, p.z + pad, (b) => {
        if (b.floorOnly) return;
        const ex0 = b.min.x - radius, ex1 = b.max.x + radius;
        const ez0 = b.min.z - radius, ez1 = b.max.z + radius;
        if (p.x <= ex0 || p.x >= ex1 || p.z <= ez0 || p.z >= ez1) return;
        const foot = p.y + 0.08;
        const head = p.y + height - 0.04;
        if (head < b.min.y || foot > b.max.y) return;
        const penX = Math.min(p.x - ex0, ex1 - p.x);
        const penZ = Math.min(p.z - ez0, ez1 - p.z);
        const pen = Math.min(penX, penZ);
        if (pen > bestPen) {
          bestPen = pen;
          hitBox = b;
          if (penX < penZ) {
            nx = p.x < (b.min.x + b.max.x) * 0.5 ? -1 : 1;
            nz = 0;
          } else {
            nx = 0;
            nz = p.z < (b.min.z + b.max.z) * 0.5 ? -1 : 1;
          }
        }
      });
      if (bestPen <= 0 || !hitBox) break;
      p.x += nx * (bestPen + EPS);
      p.z += nz * (bestPen + EPS);
      // kill velocity into the wall
      const vn = vel.x * nx + vel.z * nz;
      if (vn < 0) {
        vel.x -= vn * nx;
        vel.z -= vn * nz;
      }
      wall = new THREE.Vector3(p.x, p.y + height * 0.5, p.z);
    }

    // Vertical: integrate then snap to ground / hit ceiling.
    p.y += vel.y * dt;
    const g = this.groundAt(p.x, p.z, p.y + 0.9);
    if (g) {
      const support = g.y;
      if (p.y <= support + 0.06 && vel.y <= 0.35) {
        p.y = support;
        if (vel.y < 0) vel.y = 0;
        grounded = true;
        surface = g.surface;
        gNormal.copy(g.normal);
      } else if (p.y < support - 0.5 && p.y + height > support) {
        // embedded — pop up
        p.y = support;
        vel.y = 0;
        grounded = true;
        surface = g.surface;
      }
    }

    // Ceiling: any box whose underside is just above the head, overlapping xz.
    const head = p.y + height;
    this.visitXZ(p.x - pad, p.z - pad, p.x + pad, p.z + pad, (b) => {
      if (b.floorOnly || b.blockOnly) return;
      if (p.x < b.min.x - radius || p.x > b.max.x + radius) return;
      if (p.z < b.min.z - radius || p.z > b.max.z + radius) return;
      if (head > b.min.y && p.y < b.min.y && vel.y > 0) {
        p.y = b.min.y - height - EPS;
        vel.y = 0;
        ceiling = true;
      }
    });

    return { grounded, normal: gNormal, surface, wall, ceiling, stepped };
  }
}

const _tmpMin = new THREE.Vector3();
const _tmpMax = new THREE.Vector3();

/**
 * Two cell indices into one integer key.
 *
 * The bias and the shift bound the addressable world to +/-128 cells on each
 * axis. Past that the key WRAPS and two distant cells share a bucket, which
 * presents as a wall you can walk through in one place and an invisible one
 * somewhere else — a haunting, not a crash, and nothing above would report it.
 */
export function pack(ix: number, iz: number): number {
  return ((ix + 128) << 12) | (iz + 128);
}

/** The bound `pack` carries, made loud. Called on insert only, never per frame. */
export function assertInRange(ix: number, iz: number) {
  if (ix < -128 || ix > 127 || iz < -128 || iz > 127) {
    throw new RangeError(
      `CollisionWorld: cell (${ix}, ${iz}) is outside the +/-128 the hash key can address. `
      + 'Two distant cells would alias onto one bucket and the world would gain a hole. '
      + 'Pass a larger `cell` to the constructor, or keep the world inside the grid.',
    );
  }
}

export function rayAabb(
  o: THREE.Vector3, d: THREE.Vector3,
  min: THREE.Vector3, max: THREE.Vector3, maxT: number,
): number | null {
  let tmin = 0;
  let tmax = maxT;
  for (let i = 0; i < 3; i++) {
    const oi = o.getComponent(i);
    const di = d.getComponent(i);
    const a = min.getComponent(i);
    const b = max.getComponent(i);
    if (Math.abs(di) < 1e-8) {
      if (oi < a || oi > b) return null;
      continue;
    }
    const inv = 1 / di;
    let t1 = (a - oi) * inv;
    let t2 = (b - oi) * inv;
    if (t1 > t2) { const k = t1; t1 = t2; t2 = k; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin >= 0 ? tmin : (tmax >= 0 ? tmax : null);
}

export function aabbNormal(p: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3, out: THREE.Vector3) {
  const dx0 = Math.abs(p.x - min.x), dx1 = Math.abs(p.x - max.x);
  const dy0 = Math.abs(p.y - min.y), dy1 = Math.abs(p.y - max.y);
  const dz0 = Math.abs(p.z - min.z), dz1 = Math.abs(p.z - max.z);
  const m = Math.min(dx0, dx1, dy0, dy1, dz0, dz1);
  if (m === dx0) out.set(-1, 0, 0);
  else if (m === dx1) out.set(1, 0, 0);
  else if (m === dy0) out.set(0, -1, 0);
  else if (m === dy1) out.set(0, 1, 0);
  else if (m === dz0) out.set(0, 0, -1);
  else out.set(0, 0, 1);
}
