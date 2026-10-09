/**
 * Kinematic capsule solver. All surfaces use the same casts and contacts.
 * Overlap repair precedes input. Foot rays combine opposing steep normals in
 * a valley, and a short grace timer retains eligible support at step edges.
 * A separate bounded pass resolves crowds using their proposed positions.
 * Resolve penetration, then sweep and slide with at most eight iterations.
 * Walkable normals lift horizontal input without reducing horizontal speed;
 * steep normals block uphill input. A blocked grounded move tries up, forward,
 * down casts. The forward cast uses this tick's travel, not capsule diameter.
 * Downward casts establish support and snap only an already grounded capsule.
 * Platform transport and obstacle normal pushes are supplied by the world after
 * this relative move; touching a side never supplies platform velocity.
 */
import { MIN_SWEEP, characterContact, posedContact } from "./CharacterQuery.ts";
import type {
  Vec3,
  Quat,
  CharacterState,
  CharacterOptions,
  CharacterInput,
  RayHit,
  QueryFilter,
} from "../Types.ts";
import type * as Rapier from "@dimforge/rapier3d-deterministic";
import { ZERO, groups } from "../Shapes.ts";

export interface CharacterHit {
  time_of_impact: number;
  normal1: Vec3;
  witness1: Vec3;
}
export interface CharacterQueries<H extends CharacterHit> {
  cast(position: Vec3, delta: Vec3): H | null;
}
const scale = (v: Vec3, s: number): Vec3 => ({
  x: v.x * s,
  y: v.y * s,
  z: v.z * s,
});
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export function solveCharacter<H extends CharacterHit>(
  queries: CharacterQueries<H>,
  position: Vec3,
  desired: Vec3,
  up: "y" | "z",
  walkable: number,
): { movement: Vec3; collisions: H[] } {
  if (
    ![...Object.values(position), ...Object.values(desired), walkable].every(
      Number.isFinite,
    )
  )
    throw new RangeError("physics: invalid character movement");
  let target = { ...position },
    remaining = { ...desired };
  const collisions: H[] = [];
  for (let iteration = 0; iteration < 8; iteration++) {
    if (dot(remaining, remaining) < MIN_SWEEP * MIN_SWEEP) break;
    const hit = queries.cast(target, remaining);
    if (!hit) {
      target = add(target, remaining);
      break;
    }
    collisions.push(hit);
    const fraction = Math.max(0, Math.min(1, hit.time_of_impact));
    target = add(target, scale(remaining, fraction));
    remaining = scale(remaining, 1 - fraction);
    const n = hit.normal1,
      into = Math.min(0, dot(remaining, n));
    if (n[up] >= walkable && desired[up] <= 0) {
      // Preserve horizontal metres/second on walkable slopes. Gravity must not
      // project into lateral drift when input is zero.
      const tangent = { ...remaining, [up]: 0 };
      remaining[up] = -dot(tangent, n) / n[up];
    } else {
      const normal = { ...n };
      if (
        ((n[up] > 0 && n[up] < walkable) ||
          (n[up] < 0 && desired[up] <= MIN_SWEEP)) &&
        dot({ ...remaining, [up]: 0 }, n) < 0
      ) {
        normal[up] = 0;
        const length = Math.sqrt(dot(normal, normal));
        if (length > 1e-8) {
          const side = scale(normal, 1 / length);
          remaining = add(
            remaining,
            scale(side, -Math.min(0, dot(remaining, side))),
          );
        }
        // Resolve gravity against the actual face in this same iteration.
        // Recasting a tangent at time zero otherwise consumes the iteration cap
        // differently for the two rotated capsule representations.
        Object.assign(normal, n);
      }
      const blocked = Math.min(0, dot(remaining, normal));
      remaining = add(remaining, scale(normal, -blocked));
      if (into === 0 && fraction === 0) break;
    }
  }
  return {
    movement: {
      x: target.x - position.x,
      y: target.y - position.y,
      z: target.z - position.z,
    },
    collisions,
  };
}

export interface CharacterRecord {
  obstructed?: number[];
  stance: CharacterState["stance"];
  facing: Vec3;
  jumped: boolean;
  landed: boolean;
  landingSpeed: number;
  id: number;
  options: CharacterOptions;
  body: number;
  collider: number;
  grounded: boolean;
  verticalVelocity: number;
  platform: number | null;
  input: CharacterInput;
  momentum: Vec3;
  hits: number[];
  crushed: boolean;
  compressionSteps?: number;
  groundTime: number;
  graceTime: number;
  jumpTime: number;
  velocity: Vec3;
}

export interface CharacterHost {
  up: "y" | "z";
  fixedDt: number;
  r: typeof Rapier;
  activate(character: CharacterRecord | undefined): void;
  body(id: number): Rapier.RigidBody;
  collider(id: number): Rapier.Collider;
  hasBody(id: number): boolean;
  hasCollider(id: number): boolean;
  colliders(id: number): number[];
  overlaps(character: CharacterRecord, position: Vec3): number[];
  byRaw: Map<number, { id: number; body: number }>;
  targets: Map<number, unknown>;
  supporters: Map<number, Set<number>>;
  raycast(
    p: Vec3,
    v: Vec3,
    distance: number,
    filter: QueryFilter,
  ): RayHit | null;
  characterCast(
    ...args: Parameters<Rapier.World["castShape"]>
  ): ReturnType<Rapier.World["castShape"]>;
  slideCharacter(
    c: CharacterRecord,
    p: Vec3,
    desired: Vec3,
  ): {
    movement: Vec3;
    collisions: (CharacterHit & { collider: Rapier.Collider })[];
  };
}

export const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
export const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
export function layersMeet(a: number, b: number): boolean {
  return !!((a >>> 16) & b & 65535) && !!((b >>> 16) & a & 65535);
}
export function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
export function turn(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y),
    ty = 2 * (q.z * v.x - q.x * v.z),
    tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

// Even polynomial on [0, pi/2]. No platform-specific transcendental calls in
// a server step; error is below 7e-9 over the accepted slope range.
export function slopeCos(x: number): number {
  const q = x * x;
  return (
    1 +
    q *
      (-1 / 2 +
        q *
          (1 / 24 +
            q *
              (-1 / 720 +
                q * (1 / 40320 + q * (-1 / 3628800 + q / 479001600)))))
  );
}

export function moveCharacter(ctx: CharacterHost, c: CharacterRecord): void {
  ctx.activate(c);
  const cap = ctx.collider(c.collider);
  c.obstructed = (c.obstructed ?? []).filter(
    (id) =>
      ctx.hasBody(id) &&
      ctx
        .colliders(id)
        .some(
          (cid) =>
            (ctx.collider(cid).contactCollider(cap, c.options.offset)
              ?.distance ?? Infinity) < c.options.offset,
        ),
  );
  let compressed = c.obstructed.length > 0;
  const wasGrounded = c.grounded;
  const previousPlatform = c.platform;
  const dt = ctx.fixedDt,
    b = ctx.body(c.body),
    p = b.translation();
  // Repair genuine overlap from edits and dynamic contacts before sweeping.
  // Four passes bound work even when solids make separation impossible.
  for (let pass = 0; pass < 4; pass++) {
    let corrected = false;
    for (const id of ctx.overlaps(c, p)) {
      const solid = ctx.collider(id);
      const body = ctx.byRaw.get(solid.handle)!.body;
      if (c.obstructed.includes(body)) continue;
      const contact = characterContact(
        ctx.r,
        solid,
        cap.shape,
        p,
        cap.rotation(),
        0,
      );
      if (!contact || contact.distance >= -0.00001) continue;
      const push = scale(contact.normal1, c.options.offset - contact.distance);
      const block = ctx.characterCast(
        p,
        cap.rotation(),
        push,
        cap.shape,
        0,
        1,
        false,
        ctx.r.QueryFilterFlags.EXCLUDE_SENSORS,
        groups(c.options.layers),
        cap,
        b,
        (other) => other.handle !== solid.handle,
      );
      const fraction = block ? Math.max(0, block.time_of_impact) : 1;
      Object.assign(p, add(p, scale(push, fraction)));

      corrected ||= fraction > 0;
    }
    if (!corrected) break;
  }
  let carry = ZERO;
  if (c.grounded && c.platform !== null && ctx.hasBody(c.platform)) {
    const platform = ctx.body(c.platform);
    if (platform.isKinematic()) {
      const q = platform.rotation(),
        foot = { ...p, [ctx.up]: p[ctx.up] - c.options.height / 2 };
      const local = turn(
        { x: -q.x, y: -q.y, z: -q.z, w: q.w },
        sub(foot, platform.translation()),
      );
      carry = sub(
        add(platform.nextTranslation(), turn(platform.nextRotation(), local)),
        foot,
      );
    } else if (platform.isDynamic()) {
      const v = platform.velocityAtPoint(p);
      carry = { x: v.x * dt, y: v.y * dt, z: v.z * dt };
    }
  }
  c.groundTime = c.grounded
    ? (c.options.coyoteTime ?? 0.1)
    : Math.max(0, c.groundTime - dt);
  c.jumpTime = c.input.jump
    ? (c.options.jumpBuffer ?? 0.1) + dt
    : Math.max(0, c.jumpTime - dt);
  const jumping = c.jumpTime > 0 && (c.grounded || c.groundTime > 0);
  if (jumping) {
    c.jumped = true;
    c.verticalVelocity = c.options.jumpSpeed;
    c.grounded = false;
    c.platform = null;
    c.jumpTime = 0;
    c.groundTime = 0;
    c.momentum = { x: carry.x / dt, y: carry.y / dt, z: carry.z / dt };
    c.verticalVelocity += c.momentum[ctx.up];
    c.momentum[ctx.up] = 0;
    carry = ZERO;
  }
  c.input.jump = false;
  const previousVertical = c.verticalVelocity;
  c.verticalVelocity = Math.max(
    -(c.options.terminalSpeed ?? 60),
    c.verticalVelocity - c.options.gravity * dt,
  );
  const support = c.platform;
  const horizontal = ctx.up === "y" ? "z" : "y";
  for (const axis of ["x", horizontal] as const) {
    let wanted = c.input[axis] ?? 0;
    let boundaryPush = 0;
    const boundary = c.options.softBoundary;
    if (boundary) {
      const edge = Math.max(
        0,
        Math.abs(p[axis]) - (boundary.halfExtent - boundary.margin),
      );
      if (wanted * p[axis] > 0)
        wanted *= Math.max(0, 1 - edge / boundary.margin);
      boundaryPush = Math.sign(p[axis]) * edge * boundary.strength * dt;
    }
    const braking = wanted === 0 || wanted * c.velocity[axis] < 0;
    const acceleration =
      c.stance === "sliding"
        ? (c.options.acceleration ?? 1000) * (c.options.slideControl ?? 0.2)
        : !wasGrounded || jumping
          ? (c.options.airAcceleration ?? 12)
          : braking
            ? (c.options.braking ?? c.options.acceleration ?? 1000)
            : (c.options.acceleration ?? 1000);
    const limit = acceleration * dt;
    c.velocity[axis] += Math.max(
      -limit,
      Math.min(limit, wanted - c.velocity[axis]),
    );
    c.velocity[axis] -= boundaryPush;
  }
  const desired = {
    x: (c.velocity.x + c.momentum.x) * dt,
    y: (c.velocity.y + c.momentum.y) * dt,
    z: (c.velocity.z + c.momentum.z) * dt,
  };
  desired[ctx.up] = (previousVertical + c.verticalVelocity) * 0.5 * dt;
  if (wasGrounded && !jumping) {
    const capsule = ctx.collider(c.collider);
    const ground = ctx.characterCast(
      p,
      capsule.rotation(),
      { ...ZERO, [ctx.up]: -Math.max(0.02, c.options.snapDistance) },
      capsule.shape,
      c.options.offset,
      1,
      false,
      ctx.r.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(c.options.layers),
      capsule,
      b,
    );
    if (ground && ground.normal1[ctx.up] >= slopeCos(c.options.slopeLimit)) {
      const n = ground.normal1;
      desired[ctx.up] =
        -(desired.x * n.x + desired[horizontal] * n[horizontal]) / n[ctx.up];
    }
  }
  // Relative player movement is swept against obstacle poses. Platform motion
  // is resolved separately below, avoiding Rapier's kinematic-ground velocity correction.
  const resolved = ctx.slideCharacter(c, p, desired);
  const movement = resolved.movement;
  const collisions = resolved.collisions;
  c.grounded = false;
  c.platform = null;
  for (let i = 0; i < collisions.length; i++) {
    const hit = collisions[i];
    if (!hit?.collider) continue;
    const record = ctx.byRaw.get(hit.collider.handle)!;
    c.hits.push(record.id);
    if (
      hit.normal1[ctx.up] >= slopeCos(c.options.slopeLimit) &&
      c.verticalVelocity <= 0
    ) {
      c.grounded = true;
      c.platform = record.body;
    }
    const other = hit.collider.parent();
    if (
      other?.isDynamic() &&
      other.mass() <= (c.options.pushMass ?? 80) &&
      (c.options.pushMass ?? 80) > 0
    ) {
      const relative = sub(c.velocity, other.linvel());
      const approach = Math.min(
        0,
        relative.x * hit.normal1.x +
          relative.y * hit.normal1.y +
          relative.z * hit.normal1.z,
      );
      const strength =
        Math.min(other.mass(), c.options.pushMass ?? 80) * -approach;
      other.applyImpulseAtPoint(
        {
          x: -hit.normal1.x * strength,
          y: -hit.normal1.y * strength,
          z: -hit.normal1.z * strength,
        },
        hit.witness1,
        true,
      );
    }
  }
  let supportProbed = false;
  if (!c.grounded && c.verticalVelocity <= 0) {
    const capsule = ctx.collider(c.collider);
    const depth = wasGrounded ? c.options.snapDistance : 0.002;
    const down = { ...ZERO, [ctx.up]: -Math.max(depth, 0.002) };
    const ground = ctx.characterCast(
      add(p, movement),
      capsule.rotation(),
      down,
      capsule.shape,
      c.options.offset,
      1,
      false,
      ctx.r.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(c.options.layers),
      capsule,
      b,
    );
    if (ground && ground.normal1[ctx.up] >= slopeCos(c.options.slopeLimit)) {
      supportProbed = true;
      movement[ctx.up] += down[ctx.up] * ground.time_of_impact;
      c.grounded = true;
      c.platform = ctx.byRaw.get(ground.collider.handle)!.body;
      c.hits.push(ctx.byRaw.get(ground.collider.handle)!.id);
    }
  }
  const steep = collisions.some((_, i) => {
    const normal = collisions[i]?.normal1[ctx.up] ?? 0;
    return normal > 0.01 && normal < slopeCos(c.options.slopeLimit);
  });
  if (
    !c.grounded &&
    steep &&
    c.verticalVelocity <= 0 &&
    Math.abs(movement[ctx.up]) < Math.abs(desired[ctx.up]) * 0.1
  ) {
    const normals: { normal: Vec3; body: number; collider: number }[] = [];
    for (const axis of ["x", horizontal] as const)
      for (const sign of [-1, 1]) {
        const origin = {
          ...p,
          [axis]: p[axis] + sign * c.options.radius * 0.5,
        };
        const hit = ctx.raycast(
          origin,
          { ...ZERO, [ctx.up]: -1 },
          c.options.height / 2 + c.options.snapDistance,
          { excludeBody: c.body, layers: c.options.layers },
        );
        if (hit && hit.normal[ctx.up] > 0.01) normals.push(hit);
      }
    for (const a of normals)
      for (const b of normals) {
        if (
          a.normal.x * b.normal.x +
            a.normal[horizontal] * b.normal[horizontal] >=
          -0.01
        )
          continue;
        const n = add(a.normal, b.normal),
          length = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
        if (n[ctx.up] / length >= slopeCos(c.options.slopeLimit)) {
          c.grounded = true;
          c.platform = a.body;
          c.hits.push(a.collider, b.collider);
        }
      }
  }
  if (c.grounded) c.graceTime = c.options.groundGrace ?? 0.1;
  else {
    c.graceTime = Math.max(0, c.graceTime - dt);
    if (
      !steep &&
      !jumping &&
      c.verticalVelocity <= 0 &&
      c.graceTime > 0 &&
      previousPlatform !== null &&
      ctx.hasBody(previousPlatform) &&
      ctx.colliders(previousPlatform).some((id) => {
        const solid = ctx.collider(id);
        return (
          !solid.isSensor() &&
          layersMeet(solid.collisionGroups(), groups(c.options.layers))
        );
      })
    ) {
      c.grounded = true;
      c.platform = previousPlatform;
    }
  }
  if (steep && !c.grounded) {
    c.groundTime = 0;
    c.graceTime = 0;
  }
  if (
    c.grounded &&
    c.momentum.x === 0 &&
    c.momentum[horizontal] === 0 &&
    Math.abs(c.velocity.x) < 1e-6 &&
    Math.abs(c.velocity[horizontal]) < 1e-6
  ) {
    movement.x = 0;
    movement[horizontal] = 0;
  }
  if (c.grounded && !wasGrounded && !jumping) {
    c.landed = true;
    c.landingSpeed = Math.max(c.landingSpeed, -c.verticalVelocity);
  }
  if (
    c.grounded ||
    (c.verticalVelocity > 0 &&
      collisions.some((hit) => hit.normal1[ctx.up] < -0.1))
  )
    c.verticalVelocity = 0;
  if (c.grounded) c.momentum = { ...ZERO };
  let target = add(p, movement);
  let stepped = false;
  // A declared step is measured from the sole, independent of the capsule's
  // skin. Confirm head clearance, tread width and a walkable landing before
  // making the discrete step; a steep ramp can never satisfy the landing test.
  const speed = Math.sqrt(
    desired.x * desired.x + desired[horizontal] * desired[horizontal],
  );
  const travelled = Math.sqrt(
    movement.x * movement.x + movement[horizontal] * movement[horizontal],
  );
  if (
    (c.grounded || wasGrounded) &&
    !jumping &&
    c.options.stepHeight > 0 &&
    speed > 0 &&
    travelled < speed * 0.9 &&
    collisions.some(
      (hit) => hit.normal1[ctx.up] < slopeCos(c.options.slopeLimit),
    )
  ) {
    const collider = ctx.collider(c.collider),
      q = collider.rotation();
    const rise = {
      ...ZERO,
      [ctx.up]: c.options.stepHeight + 2 * c.options.offset,
    };
    const filter = [
      ctx.r.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(c.options.layers),
      collider,
      b,
    ] as const;
    const ceiling = ctx.characterCast(
      p,
      q,
      rise,
      collider.shape,
      0,
      1,
      false,
      ...filter,
    );
    if (!ceiling) {
      const raised = add(p, rise),
        width = speed;
      const across = {
        ...ZERO,
        x: (desired.x / speed) * width,
        [horizontal]: (desired[horizontal] / speed) * width,
      };
      const wall = ctx.characterCast(
        raised,
        q,
        across,
        collider.shape,
        0,
        1,
        false,
        ...filter,
      );
      if (!wall) {
        const top = add(raised, across),
          down = { ...ZERO, [ctx.up]: -rise[ctx.up] };
        const tread = ctx.characterCast(
          top,
          q,
          down,
          collider.shape,
          0,
          1,
          false,
          ...filter,
        );
        const treadProbe = tread
          ? ctx.raycast(
              {
                ...tread.witness1,
                x:
                  tread.witness1.x +
                  (desired.x / speed) * (c.options.stepMinWidth || 0.01),
                [horizontal]:
                  tread.witness1[horizontal] +
                  (desired[horizontal] / speed) *
                    (c.options.stepMinWidth || 0.01),
                [ctx.up]:
                  p[ctx.up] -
                  c.options.height / 2 +
                  c.options.stepHeight +
                  0.02,
              },
              { ...ZERO, [ctx.up]: -1 },
              c.options.stepHeight + 0.04,
              { excludeBody: c.body, layers: c.options.layers },
            )
          : null;
        if (
          tread &&
          treadProbe &&
          treadProbe.normal[ctx.up] >= slopeCos(c.options.slopeLimit) &&
          Math.abs(treadProbe.point[ctx.up] - tread.witness1[ctx.up]) < 0.02 &&
          treadProbe.point[ctx.up] -
            (p[ctx.up] - c.options.height / 2 - c.options.offset) <=
            c.options.stepHeight + 0.001
        ) {
          const landing = add(top, {
            ...ZERO,
            [ctx.up]: down[ctx.up] * tread.time_of_impact + c.options.offset,
          });
          const climb = landing[ctx.up] - p[ctx.up];
          if (
            climb > c.options.offset &&
            climb <= c.options.stepHeight + 1e-4
          ) {
            target = {
              ...landing,
              x: p.x + desired.x,
              [horizontal]: p[horizontal] + desired[horizontal],
            };
            stepped = true;
            c.grounded = true;
            c.platform = ctx.byRaw.get(tread.collider.handle)!.body;
            c.hits.push(ctx.byRaw.get(tread.collider.handle)!.id);
          }
        }
      }
    }
  }
  if (
    wasGrounded &&
    !supportProbed &&
    !stepped &&
    !jumping &&
    c.verticalVelocity <= 0 &&
    c.options.snapDistance > 0
  ) {
    const capsule = ctx.collider(c.collider),
      down = { ...ZERO, [ctx.up]: -c.options.snapDistance };
    const ground = ctx.characterCast(
      target,
      capsule.rotation(),
      down,
      capsule.shape,
      c.options.offset,
      1,
      false,
      ctx.r.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(c.options.layers),
      capsule,
      b,
    );
    if (
      ground &&
      ground.time_of_impact * c.options.snapDistance > c.options.offset &&
      ground.normal1[ctx.up] >= slopeCos(c.options.slopeLimit)
    ) {
      target[ctx.up] += down[ctx.up] * ground.time_of_impact;
      c.grounded = true;
      c.platform = ctx.byRaw.get(ground.collider.handle)!.body;
      c.hits.push(ctx.byRaw.get(ground.collider.handle)!.id);
    }
  }
  if (support !== null && (carry.x !== 0 || carry.y !== 0 || carry.z !== 0)) {
    // Sweep the carrier displacement against everything except the supporting
    // body. Its old pose must not block a descending lift's passenger.
    const hit = ctx.characterCast(
      target,
      ctx.collider(c.collider).rotation(),
      carry,
      ctx.collider(c.collider).shape,
      c.options.offset,
      1,
      true,
      ctx.r.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(c.options.layers),
      ctx.collider(c.collider),
      b,
      (other) => ctx.byRaw.get(other.handle)?.body !== support,
    );
    const fraction = hit ? Math.max(0, hit.time_of_impact) : 1;
    target = add(target, {
      x: carry.x * fraction,
      y: carry.y * fraction,
      z: carry.z * fraction,
    });
    if (fraction < 0.999 && carry[ctx.up] > MIN_SWEEP) {
      compressed = true;
      if (!c.obstructed.includes(support)) c.obstructed.push(support);
      c.platform = null;
      c.grounded = false;
    }
  }
  // Sweep translating obstacles against the passenger, then resolve their
  // target poses. Contact at the target also accounts for rotating arms.
  const capsule = ctx.collider(c.collider);
  for (const [id] of ctx.targets) {
    if (id === c.platform || id === support || c.obstructed.includes(id))
      continue;
    const obstacle = ctx.body(id),
      delta = sub(obstacle.nextTranslation(), obstacle.translation());
    for (const colliderId of ctx.colliders(id)) {
      const solid = ctx.collider(colliderId);
      if (
        solid.isSensor() ||
        !layersMeet(solid.collisionGroups(), groups(c.options.layers))
      )
        continue;
      const sweep =
        dot(delta, delta) < MIN_SWEEP * MIN_SWEEP
          ? null
          : solid.castShape(
              delta,
              capsule.shape,
              target,
              capsule.rotation(),
              ZERO,
              0,
              1,
              false,
            );
      let push = { ...ZERO };
      if (sweep) {
        const normal = turn(solid.rotation(), sweep.normal1);
        const remaining =
          Math.max(
            0,
            delta.x * normal.x + delta.y * normal.y + delta.z * normal.z,
          ) *
          (1 - sweep.time_of_impact);
        push = {
          x: normal.x * remaining,
          y: normal.y * remaining,
          z: normal.z * remaining,
        };
      }
      const oldQ = obstacle.rotation();
      const local = turn(
        { x: -oldQ.x, y: -oldQ.y, z: -oldQ.z, w: oldQ.w },
        sub(solid.translation(), obstacle.translation()),
      );
      const nextPos = add(
        obstacle.nextTranslation(),
        turn(obstacle.nextRotation(), local),
      );
      const localQ = multiply(
        { x: -oldQ.x, y: -oldQ.y, z: -oldQ.z, w: oldQ.w },
        solid.rotation(),
      );
      const nextQ = multiply(obstacle.nextRotation(), localQ);
      const contact = posedContact(
        ctx.r,
        solid,
        nextPos,
        nextQ,
        capsule.shape,
        add(target, push),
        capsule.rotation(),
        c.options.offset,
      );
      if (contact && contact.distance < c.options.offset) {
        const amount = c.options.offset - contact.distance;
        push = add(push, {
          x: contact.normal1.x * amount,
          y: contact.normal1.y * amount,
          z: contact.normal1.z * amount,
        });
      }
      if (push.x || push.y || push.z) {
        const block = ctx.characterCast(
          target,
          capsule.rotation(),
          push,
          capsule.shape,
          c.options.offset,
          1,
          false,
          ctx.r.QueryFilterFlags.EXCLUDE_SENSORS,
          groups(c.options.layers),
          capsule,
          b,
          (other) => {
            const body = ctx.byRaw.get(other.handle)?.body;
            if (body === id) return false;
            const contact = characterContact(
              ctx.r,
              other,
              capsule.shape,
              target,
              capsule.rotation(),
              c.options.offset * 1.1,
            );
            return (
              !contact ||
              contact.normal1.x * push.x +
                contact.normal1.y * push.y +
                contact.normal1.z * push.z <
                -Math.max(
                  1e-8,
                  0.003 *
                    Math.sqrt(
                      push.x * push.x + push.y * push.y + push.z * push.z,
                    ),
                )
            );
          },
        );
        const fraction = block ? Math.max(0, block.time_of_impact) : 1;
        target = add(target, {
          x: push.x * fraction,
          y: push.y * fraction,
          z: push.z * fraction,
        });
        if (fraction < 0.999) {
          compressed = true;
          if (
            Math.abs(push[ctx.up]) >
              Math.abs(push.x) + Math.abs(push[horizontal]) &&
            !c.obstructed.includes(id)
          )
            c.obstructed.push(id);
        }
        c.hits.push(colliderId);
      }
    }
  }
  c.compressionSteps = compressed
    ? Math.min(2, (c.compressionSteps ?? 0) + 1)
    : 0;
  c.crushed ||= c.compressionSteps > 1;
  c.stance = c.grounded
    ? "planted"
    : c.verticalVelocity > 0
      ? "rising"
      : steep
        ? "sliding"
        : "falling";
  const speed2 =
    c.velocity.x * c.velocity.x +
    c.velocity[horizontal] * c.velocity[horizontal];
  if (speed2 > 1e-8) {
    const length = Math.sqrt(speed2),
      t = Math.min(1, (c.options.facingResponse ?? 12) * dt);
    let goalX = c.velocity.x / length,
      goalH = c.velocity[horizontal] / length;
    if (c.facing.x * goalX + c.facing[horizontal] * goalH < -0.95 && t < 1) {
      goalX = -c.facing[horizontal];
      goalH = c.facing.x;
    }
    const x = c.facing.x * (1 - t) + goalX * t,
      h = c.facing[horizontal] * (1 - t) + goalH * t;
    const n = Math.sqrt(x * x + h * h);
    if (n > 1e-8) c.facing = { ...ZERO, x: x / n, [horizontal]: h / n };
  }
  c.hits = [...new Set(c.hits)];
  b.setNextKinematicTranslation(target);
  if (previousPlatform !== c.platform) {
    if (previousPlatform !== null)
      ctx.supporters.get(previousPlatform)?.delete(c.id);
    if (c.platform !== null) {
      let set = ctx.supporters.get(c.platform);
      if (!set) ctx.supporters.set(c.platform, (set = new Set()));
      set.add(c.id);
    }
  }
}
/** Resolve proposed capsule positions together; only the final corrections
 * cross the engine boundary. Nearby solid contact planes constrain the local
 * iterations, then sweeps verify them and add any newly encountered wall. */
export function separateCharacters(
  ctx: CharacterHost,
  characters: CharacterRecord[],
): void {
  if (characters.length < 2) {
    ctx.activate(undefined);
    return;
  }
  const horizontal = ctx.up === "y" ? "z" : "y";
  const bodies = characters.map((c) => ctx.body(c.body));
  const initial = bodies.map((b) => b.nextTranslation()),
    positions = initial.map(copy);
  const masks = characters.map((c) => groups(c.options.layers));
  const characterBodies = new Set(characters.map((c) => c.body));
  const planes = characters.map(() => [] as { point: Vec3; normal: Vec3 }[]);
  const caps = characters.map((c) => ctx.collider(c.collider));
  let prepared = false;
  const move = (
    index: number,
    sign: number,
    amount: number,
    nx: number,
    ns: number,
  ): number => {
    const p = positions[index]!,
      oldX = p.x,
      oldS = p[horizontal],
      travel = amount * sign;
    p.x += nx * travel;
    p[horizontal] += ns * travel;
    for (let pass = 0; pass < 2; pass++)
      for (const plane of planes[index]!) {
        const n = plane.normal,
          point = plane.point;
        const depth =
          (p.x - point.x) * n.x + (p.y - point.y) * n.y + (p.z - point.z) * n.z;
        if (depth < 0) {
          p.x -= n.x * depth;
          p.y -= n.y * depth;
          p.z -= n.z * depth;
        }
      }
    return Math.max(
      0,
      ((p.x - oldX) * nx + (p[horizontal] - oldS) * ns) * sign,
    );
  };
  const prepare = () => {
    if (prepared) return;
    prepared = true;
    for (let i = 0; i < characters.length; i++) {
      const c = characters[i]!,
        cap = caps[i]!;
      for (const id of new Set(c.hits)) {
        if (!ctx.hasCollider(id)) continue;
        const solid = ctx.collider(id),
          body = ctx.byRaw.get(solid.handle)!.body;
        if (
          characterBodies.has(body) ||
          c.obstructed?.includes(body) ||
          solid.isSensor()
        )
          continue;
        const contact = characterContact(
          ctx.r,
          solid,
          cap.shape,
          positions[i]!,
          cap.rotation(),
          c.options.offset * 2,
        );
        if (contact)
          planes[i]!.push({
            normal: contact.normal1,
            point: add(
              positions[i]!,
              scale(contact.normal1, c.options.offset - contact.distance),
            ),
          });
      }
    }
  };
  for (let verification = 0; verification < 3; verification++) {
    for (let iteration = 0; iteration < 96; iteration++) {
      let largest = 0;
      for (let i = 0; i < characters.length; i++)
        for (let j = i + 1; j < characters.length; j++) {
          if (!layersMeet(masks[i]!, masks[j]!)) continue;
          const a = characters[i]!,
            b = characters[j]!,
            pa = positions[i]!,
            pb = positions[j]!;
          const vertical = Math.max(
            0,
            Math.abs(pa[ctx.up] - pb[ctx.up]) -
              (a.options.height / 2 -
                a.options.radius +
                b.options.height / 2 -
                b.options.radius),
          );
          const radius =
            a.options.radius +
            b.options.radius +
            Math.max(a.options.offset, b.options.offset);
          if (vertical >= radius) continue;
          const minimum = Math.sqrt(radius * radius - vertical * vertical),
            dx = pa.x - pb.x,
            ds = pa[horizontal] - pb[horizontal];
          const distance = Math.sqrt(dx * dx + ds * ds),
            deficit = minimum - distance;
          if (deficit <= 0) continue;
          largest = Math.max(largest, deficit);
          prepare();
          const nx = distance > 1e-8 ? dx / distance : 1,
            ns = distance > 1e-8 ? ds / distance : 0;
          const first = move(i, 1, deficit / 2, nx, ns),
            second = move(j, -1, deficit / 2, nx, ns);
          let residual = Math.max(0, deficit - first - second);
          if (first >= deficit * 0.499 && residual > 0)
            residual -= move(i, 1, residual, nx, ns);
          if (second >= deficit * 0.499 && residual > 0)
            move(j, -1, residual, nx, ns);
        }
      if (largest < 0.0005) break;
    }
    if (!prepared) break;
    let blocked = false;
    for (let i = 0; i < characters.length; i++) {
      const c = characters[i]!,
        cap = caps[i]!,
        delta = sub(positions[i]!, initial[i]!);
      if (dot(delta, delta) < MIN_SWEEP * MIN_SWEEP) continue;
      ctx.activate(c);
      const hit = ctx.characterCast(
        initial[i]!,
        cap.rotation(),
        delta,
        cap.shape,
        c.options.offset,
        1,
        false,
        ctx.r.QueryFilterFlags.EXCLUDE_SENSORS,
        masks[i],
        cap,
        bodies[i],
        (other) => !characterBodies.has(ctx.byRaw.get(other.handle)!.body),
      );
      if (hit) {
        const id = ctx.byRaw.get(hit.collider.handle)!.id;
        if (!c.hits.includes(id)) c.hits.push(id);
      }
      if (hit && hit.time_of_impact < 0.999) {
        const point = add(
          initial[i]!,
          scale(delta, Math.max(0, hit.time_of_impact)),
        );
        positions[i] = point;
        planes[i]!.push({ point, normal: hit.normal1 });
        blocked = true;
      }
    }
    if (!blocked) break;
  }
  for (let i = 0; i < characters.length; i++)
    bodies[i]!.setNextKinematicTranslation(positions[i]!);
  ctx.activate(undefined);
}
