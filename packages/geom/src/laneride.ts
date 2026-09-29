/**
 * ============================================================================
 *  laneride — a body travelling a NavGraph IN A LANE, not on a rail.
 * ============================================================================
 *  `navgraph.ts` answers geometric questions about a road network: which node
 *  is nearest, which neighbour heads that way, how high is the carriageway at
 *  this point on this segment. It has no state and no clock.
 *
 *  This is the thing that RIDES it. One scalar state — which segment, how far
 *  along, how far right of the centre line, how fast, which way it is pointing
 *  — advanced by dt, with the four behaviours that separate traffic from a
 *  train:
 *
 *   1. **A LANE OFFSET.** The rider is `lane` metres to the right of the
 *      centre line, so a road with two of these on it reads as a road with two
 *      directions of travel rather than as a single-file track. It is the
 *      cheapest single thing that makes a network look used.
 *   2. **AN EASE-OFF INTO THE JUNCTION.** Speed falls as the segment end
 *      approaches, on a floor-and-slope curve the caller states. Without it a
 *      vehicle takes a corner at cruise and the heading slew cannot keep up,
 *      so it visibly crabs through the turn.
 *   3. **A HAND-OFF AT THE NODE** that can be given a destination. With no
 *      destination it wanders (`nextFrom`); with one it routes (`toward`).
 *      One call site, two behaviours, no second loop.
 *   4. **A STEER ANGLE DERIVED FROM THE HEADING RATE**, not from the geometry.
 *      The front wheels then point where the body is actually going rather than
 *      where the road does, which is the difference between a vehicle turning
 *      and a vehicle sliding sideways with its wheels straight.
 *
 *  `steerTo` is the same rider off the graph: free drive toward a world point.
 *  A network is always a subset of a world, and something eventually has to
 *  leave it.
 *
 * ----------------------------------------------------------------------------
 *  EVERY NUMBER IS THE CALLER'S. `RideTune` IS NINE OF THEM AND HAS NO DEFAULTS
 * ----------------------------------------------------------------------------
 *  Top speed, acceleration, braking, where the ease-off starts and how steep it
 *  is, how fast the heading may slew, and the steer gain and its limit. Those
 *  are a vehicle's character and a road's character, and a package that carried
 *  any of them would hand the next game this game's traffic. There is no
 *  default `RideTune` for the same reason there is no default gravity in
 *  `@homie-rocks/walk/gpubiped`.
 *
 *  The LANE WIDTH is not in the tune either — it is a per-rider field, because
 *  splitting a fleet between two lane centres is the whole point of having one.
 *
 * ----------------------------------------------------------------------------
 *  wrapAngle IS THE LOOP FORM AND THAT IS DELIBERATE
 * ----------------------------------------------------------------------------
 *  `@homie-rocks/camera/spring.js` exports `wrapAngle` as `atan2(sin a, cos a)`. It
 *  is the better function and this is NOT it. The two disagree in the last bits
 *  for every angle, `@homie-rocks/geom` does not depend on `@homie-rocks/camera`, and a
 *  heading is integrated every frame — so a change of the last bits is a slow
 *  divergence in where a fleet ends up, not a rounding difference. Two forms,
 *  both correct, kept apart on purpose; `@homie-rocks/render/canvastex.js` made
 *  the same call about its clamp for the same reason.
 * ============================================================================
 */
import type { NavGraph } from './navgraph.ts';

const TAU = Math.PI * 2;

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/** Shortest signed representation of an angle. See the header: NOT atan2. */
export function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= TAU;
  while (r < -Math.PI) r += TAU;
  return r;
}

/** Move `a` toward `b` by at most `max`, the short way round. */
export function turnToward(a: number, b: number, max: number): number {
  return a + clamp(wrapAngle(b - a), -max, max);
}

/** What a vehicle and a road are like. Nine numbers, none of them optional. */
export interface RideTune {
  /** Cruise speed, m/s. */
  top: number;
  /** Acceleration, m/s^2. */
  accel: number;
  /** Braking, m/s^2, as a positive magnitude. */
  brake: number;
  /** Metres of segment left at which the ease-off into the junction begins. */
  easeFrom: number;
  /** The ease-off's floor speed, m/s — it never crawls below this. */
  easeFloor: number;
  /** Ease-off target is `top * (easeBase + remaining / easeSpan)`. */
  easeBase: number;
  easeSpan: number;
  /** Heading slew limit, rad/s. */
  turnRate: number;
  /** steer = headingRate * steerGain, clamped to +-steerLimit. */
  steerGain: number;
  steerLimit: number;
}

/**
 * The neighbour of `node` whose direction best matches (ax, az).
 *
 * Pulled out because both seating paths wanted it and had a copy each. It is
 * how a caller aims one body at the camera without a standing bearing bias on
 * the whole fleet: seat it on a node and say which way it should be pointing.
 */
export function bestNeighbour(g: NavGraph, node: number, ax: number, az: number): number {
  const adj = g.edges[node];
  if (!adj || adj.length === 0) return g.nextFrom(node, -1);
  let best = adj[0]!, bestDot = -Infinity;
  for (let e = 0; e < adj.length; e++) {
    const j = adj[e]!;
    const dx = g.nodeX(j) - g.nodeX(node);
    const dz = g.nodeZ(j) - g.nodeZ(node);
    const l = Math.hypot(dx, dz) || 1;
    const d = (dx / l) * ax + (dz / l) * az;
    if (d > bestDot) { bestDot = d; best = j; }
  }
  return best;
}

export class LaneRider {
  /** World position of the body. Y is nobody's business here. */
  x = 0;
  z = 0;
  /** Radians, atan2(dx, dz) convention — 0 is +Z. */
  heading = 0;
  speed = 0;
  /** Front-wheel angle, derived from how fast the heading is actually moving. */
  steer = 0;
  /** Signed acceleration this step. The caller's suspension wants it. */
  accel = 0;
  /** Metres to the right of the centre line. This is what makes it a lane. */
  lane = 0;

  node0 = 0;
  node1 = 0;
  /** 0..1 along the current segment. */
  t = 0;

  /**
   * Seat the body on an explicit node, part-way along the segment toward
   * `next`, and put it in its lane.
   *
   * `t` is clamped away from both ends because a body seated exactly on a node
   * hands off on its first step, before anything has looked at it, and lands
   * somewhere the caller did not ask for.
   */
  seat(g: NavGraph, node: number, next: number, t: number, tLo: number, tHi: number): void {
    const i = ((node % g.count) + g.count) % g.count;
    this.node0 = i;
    this.node1 = next;
    this.t = clamp(t, tLo, tHi);
    const ax = g.nodeX(i), az = g.nodeZ(i);
    const bx = g.nodeX(this.node1), bz = g.nodeZ(this.node1);
    const dx = bx - ax, dz = bz - az;
    const seg = Math.max(0.001, Math.hypot(dx, dz));
    const ux = dx / seg, uz = dz / seg;
    this.x = ax + ux * (this.t * seg) + uz * this.lane;
    this.z = az + uz * (this.t * seg) - ux * this.lane;
    this.heading = Math.atan2(dx, dz);
  }

  /**
   * One step along the graph.
   *
   * `towardX/towardZ` are NaN for a wanderer and a world point for a body with
   * somewhere to be. Returns true if it crossed a node this step, which is the
   * only moment a caller's route logic has to run.
   */
  advance(g: NavGraph, dt: number, k: RideTune, towardX = NaN, towardZ = NaN): boolean {
    const ax = g.nodeX(this.node0), az = g.nodeZ(this.node0);
    const bx = g.nodeX(this.node1), bz = g.nodeZ(this.node1);
    let dx = bx - ax, dz = bz - az;
    const seg = Math.max(0.001, Math.hypot(dx, dz));
    dx /= seg; dz /= seg;

    // right-hand offset from the centre line
    const rx = dz, rz = -dx;
    const px = ax + dx * (this.t * seg) + rx * this.lane;
    const pz = az + dz * (this.t * seg) + rz * this.lane;

    // Ease off approaching a junction. See the header, behaviour 2.
    const remain = (1 - this.t) * seg;
    const want = remain < k.easeFrom
      ? Math.max(k.easeFloor, k.top * (k.easeBase + remain / k.easeSpan))
      : k.top;
    const a = want > this.speed ? k.accel : -k.brake;
    this.speed = clamp(this.speed + a * dt, 0, k.top);
    this.accel = a;

    this.t += (this.speed * dt) / seg;
    let crossed = false;
    if (this.t >= 1) {
      this.t -= 1;
      crossed = true;
      const prev = this.node0;
      this.node0 = this.node1;
      this.node1 = Number.isFinite(towardX)
        ? g.toward(this.node0, prev, towardX, towardZ)
        : g.nextFrom(this.node0, prev);
      // A hand-off that returns where we already are is a body stuck on one
      // node forever, which reads as a vehicle parked in the middle of a road.
      if (this.node1 === this.node0) this.node1 = g.nextFrom(this.node0, -1);
    }

    this.x = px;
    this.z = pz;
    const prevHeading = this.heading;
    this.heading = turnToward(this.heading, Math.atan2(dx, dz), dt * k.turnRate);
    this.steer = clamp(
      wrapAngle(this.heading - prevHeading) / Math.max(dt, 1e-4) * k.steerGain,
      -k.steerLimit, k.steerLimit);
    return crossed;
  }

  /**
   * Free drive toward a world point, off the graph entirely.
   *
   * Integrates position rather than reading it off a segment, so the caller
   * owns re-seating when the body arrives somewhere the network reaches again.
   * Returns the distance still to run, so a caller can decide it has arrived
   * without recomputing the same hypot.
   */
  steerTo(tx: number, tz: number, dt: number, k: RideTune): number {
    const dx = tx - this.x, dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) return dist;
    const prevHeading = this.heading;
    this.heading = turnToward(this.heading, Math.atan2(dx / dist, dz / dist), dt * k.turnRate);
    this.steer = clamp(
      wrapAngle(this.heading - prevHeading) / Math.max(dt, 1e-4) * k.steerGain,
      -k.steerLimit, k.steerLimit);
    const a = this.speed < k.top ? k.accel : -k.brake;
    this.speed = clamp(this.speed + a * dt, 0, k.top);
    this.accel = a;
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
    return dist;
  }
}
