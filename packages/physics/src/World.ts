import {
  MIN_SWEEP,
  characterContact,
  localBox,
  finiteVector,
  validateCharacterQuery,
} from "./internal/CharacterQuery.ts";
/**
 * One deterministic simulation, with stable game handles and a complete save.
 * Rapier handles encode generation bits in floats; they never escape this file.
 * The envelope saves those handles, the allocator, time remainder and controller
 * state alongside Rapier's solver snapshot. Positions alone cannot resume a solver.
 */
import type {
  World as RapierWorld,
  EventQueue,
  RigidBody,
  Collider,
} from "@dimforge/rapier3d-deterministic";
import { keys, bounded, booleans, axes } from "./internal/Validate.ts";
import { PendingIndex, queryRadius } from "./internal/PendingIndex.ts";
import { Timeline, timelineMethods, type Replay } from "./internal/Timeline.ts";
import {
  solveCharacter,
  moveCharacter,
  separateCharacters,
  copy,
  add,
  sub,
  layersMeet,
  multiply,
  turn,
  slopeCos,
  type CharacterRecord,
  type CharacterHost,
} from "./internal/Character.ts";
import { pack, unpack } from "./internal/Save.ts";
import {
  acquireEngine,
  releaseEngine,
  registerWorld,
} from "./internal/Engine.ts";
import {
  descriptor,
  finite,
  groups,
  IDENTITY,
  positive,
  rotation,
  vector,
  ZERO,
} from "./Shapes.ts";
import type {
  BodyOptions,
  BodyUpdate,
  DebugLines,
  ColliderUpdate,
  BodyState,
  CharacterInput,
  CharacterOptions,
  CharacterState,
  ColliderOptions,
  JointOptions,
  PhysicsEvent,
  QueryFilter,
  Quat,
  RandomState,
  RayHit,
  Shape,
  ShapeHit,
  Vec3,
  WorldOptions,
} from "./Types.ts";

/** The seeded generator's state is plain data, copied into a world on creation. */
export function seeded(seed: number): RandomState {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError("physics: seed must be uint32");
  return { state: seed };
}
interface BodyRecord {
  id: number;
  raw: number;
  mass?: number;
  precisionLimit?: number;
}
interface ColliderRecord extends BodyRecord {
  body: number;
  sensor: boolean;
}
interface JointRecord extends BodyRecord {
  a: number;
  b: number;
}
type StructuralEdit =
  | { kind: "body"; raw: number }
  | { kind: "joint"; raw: number }
  | {
      kind: "createJoint";
      id: number;
      a: number;
      b: number;
      options: JointOptions;
    };
interface Save {
  edits?: StructuralEdit[];
  bounds?: WorldOptions["bounds"];
  killPlane?: number;
  up?: "y" | "z";
  engine: "0.21.0";
  fixedDt: number;
  maxSubsteps: number;
  remainder: number;
  tick: number;
  next: number;
  random: number;
  bodies: BodyRecord[];
  colliders: ColliderRecord[];
  joints: JointRecord[];
  characters: CharacterRecord[];
  targets?: [number, { position: Vec3; rotation: Quat; remaining?: number }][];
  pairs?: PhysicsEvent[];
  pendingEvents?: PhysicsEvent[];
  changedFilters?: number[];
  pendingQueries?: number[];
  dirty?: boolean;
  replay?: Replay;
}
function exitNormal(normal: Vec3, direction: Vec3, inside: boolean): Vec3 {
  const sign =
    inside &&
    normal.x * direction.x + normal.y * direction.y + normal.z * direction.z < 0
      ? -1
      : 1;
  return {
    x: normal.x * sign || 0,
    y: normal.y * sign || 0,
    z: normal.z * sign || 0,
  };
}
/**
 * Create a simulation after awaiting initPhysics in this isolate.
 * The default coordinate convention is Y-up with metres and seconds.
 * Choose Z-up here for rules runtimes whose horizontal plane is XY.
 * Explicit gravity is always a world-space vector, not a local one.
 * The world copies the supplied random state rather than retaining it.
 * Creation does not advance time or create any default ground geometry.
 * @returns An owned world; call dispose when its room or game ends.
 * @throws For invalid options or when initialization has not completed.
 */
export function createWorld(options: WorldOptions): PhysicsWorld {
  return new PhysicsWorld(options);
}

/** Owns solver memory, stable handles, fixed time and exact replay state. Dispose when finished. */
export class PhysicsWorld {
  #r: ReturnType<typeof acquireEngine>;
  #world: RapierWorld;
  #queue: EventQueue;
  #timeline = new Timeline();
  #edits: StructuralEdit[] = [];
  #bodies = new Map<number, BodyRecord>();
  #kinematics = new Set<number>();
  #colliders = new Map<number, ColliderRecord>();
  #sensors = new Set<number>();
  #byRaw = new Map<number, ColliderRecord>();
  #joints = new Map<number, JointRecord>();
  #characters = new Map<number, CharacterRecord>();
  #activeCharacter?: CharacterRecord;
  #next = 1;
  #remainder = 0;
  #tick = 0;
  #random: number;
  #fixedDt: number;
  #maxSubsteps: number;
  #disposed = false;
  #dirty = true;
  #pendingQueries = new Set<number>();
  #pendingIndex = new PendingIndex();
  #pendingChanged = new Set<number>();
  #terrains = new Set<number>();
  #bounds: WorldOptions["bounds"];
  #killPlane: number | undefined;
  #up: "y" | "z";
  #failed = false;
  #pairs = new Map<string, PhysicsEvent & { impactReported?: boolean }>();
  #pendingEvents: PhysicsEvent[] = [];
  #bodyColliders = new Map<number, Set<number>>();
  #bodyCharacters = new Map<number, number>();
  #bodyJoints = new Map<number, Set<number>>();
  #supporters = new Map<number, Set<number>>();
  #colliderPairs = new Map<number, Set<string>>();
  #changedFilters = new Set<number>();
  #targets = new Map<
    number,
    { position: Vec3; rotation: Quat; remaining?: number }
  >();

  /**
   * Check a body handle without dereferencing a solver object.
   * @param id Stable integer handle returned by createBody or characterState.
   * @returns Whether this world still owns the body record.
   */
  hasBody(id: number): boolean {
    return !this.#disposed && this.#bodies.has(id);
  }
  /**
   * Check a collider handle before processing a retained hit or event.
   * @param id Stable collider handle, rather than the wrapped solver handle.
   * @returns False for removed, wrong-kind or disposed-world handles.
   */
  hasCollider(id: number): boolean {
    return !this.#disposed && this.#colliders.has(id);
  }
  /**
   * Check whether a constraint still belongs to this world.
   * @param id Stable handle returned by createJoint.
   * @returns False for missing, removed or wrong-kind handles.
   */
  hasJoint(id: number): boolean {
    return !this.#disposed && this.#joints.has(id);
  }
  /**
   * Check whether an upright controller still exists.
   * @param id Stable handle returned by createCharacter.
   * @returns Whether a controller with this handle is currently owned.
   */
  hasCharacter(id: number): boolean {
    return !this.#disposed && this.#characters.has(id);
  }
  #trackPair(key: string, event: PhysicsEvent): void {
    this.#pairs.set(key, event);
    for (const id of [event.colliderA, event.colliderB]) {
      let set = this.#colliderPairs.get(id);
      if (!set) this.#colliderPairs.set(id, (set = new Set()));
      set.add(key);
    }
  }
  #forgetPair(key: string): void {
    const event = this.#pairs.get(key);
    if (event)
      for (const id of [event.colliderA, event.colliderB])
        this.#colliderPairs.get(id)?.delete(key);
    this.#pairs.delete(key);
  }
  #endPairs(id: number): void {
    for (const key of [...(this.#colliderPairs.get(id) ?? [])]) {
      const event = this.#pairs.get(key)!;
      this.#pendingEvents.push({ ...event, tick: this.#tick, started: false });
      this.#forgetPair(key);
    }
    this.#colliderPairs.delete(id);
  }

  /**
   * Construct the owner of one solver and its event queue.
   * @param options Coordinate, gravity, time and random-number conventions.
   * @throws Before allocation when configuration is malformed.
   */
  constructor(options: WorldOptions) {
    keys(
      options,
      "gravity up fixedDt maxSubsteps random bounds killPlane",
      "world",
    );
    this.#bounds =
      options.bounds === undefined
        ? {
            min: { x: -10000, y: -10000, z: -10000 },
            max: { x: 10000, y: 10000, z: 10000 },
          }
        : options.bounds && {
            min: vector(options.bounds.min),
            max: vector(options.bounds.max),
          };
    if (
      this.#bounds &&
      ["x", "y", "z"].some(
        (axis) =>
          this.#bounds!.min[axis as keyof Vec3] >=
          this.#bounds!.max[axis as keyof Vec3],
      )
    )
      throw new RangeError("physics: invalid bounds");
    this.#killPlane =
      options.killPlane === undefined
        ? undefined
        : finite(options.killPlane, "killPlane");
    this.#up = options.up ?? "y";
    if (this.#up !== "y" && this.#up !== "z")
      throw new RangeError("physics: up must be y or z");
    const gravity = vector(
      options.gravity ??
        (this.#up === "y"
          ? { x: 0, y: -9.81, z: 0 }
          : { x: 0, y: 0, z: -9.81 }),
    );
    this.#fixedDt = bounded(options.fixedDt ?? 1 / 60, "fixedDt", 0.001, 0.1);
    this.#maxSubsteps = options.maxSubsteps ?? 8;
    if (
      !Number.isSafeInteger(this.#maxSubsteps) ||
      this.#maxSubsteps < 1 ||
      this.#maxSubsteps > 128
    )
      throw new RangeError("physics: maxSubsteps must be an integer in 1..128");
    this.#random = seeded(options.random?.state ?? 1).state;
    for (const n of Object.values(gravity)) bounded(n, "gravity", -1000, 1000);
    const r = (this.#r = acquireEngine());
    this.#world = new r.World(gravity);
    this.#world.timestep = this.#fixedDt;
    this.#queue = new r.EventQueue(true);
    registerWorld(this, () => ({ engine: this.#r, world: this.#world }));
  }
  /** Fixed solver interval in seconds, immutable except when restoring a save. */
  get fixedDt(): number {
    return this.#fixedDt;
  }
  /** Completed fixed substeps; restored with the world. */
  get tick(): number {
    return this.#tick;
  }
  /** Accumulated seconds awaiting a complete fixed substep. */
  get remainder(): number {
    return this.#remainder;
  }
  #alive(): void {
    if (this.#disposed) throw new Error("physics: world is disposed");
    if (this.#failed)
      throw new Error(
        "physics: engine failed; restore a saved state or dispose",
      );
  }
  #id(): number {
    if (this.#next >= Number.MAX_SAFE_INTEGER)
      throw new RangeError("physics: handle space exhausted");
    return this.#next++;
  }
  #body(id: number): RigidBody {
    this.#alive();
    const record = this.#bodies.get(id);
    if (!record) throw new RangeError(`physics: unknown body ${id}`);
    return this.#world.getRigidBody(record.raw);
  }
  #collider(id: number): Collider {
    this.#alive();
    const record = this.#colliders.get(id);
    if (!record) throw new RangeError(`physics: unknown collider ${id}`);
    return this.#world.getCollider(record.raw);
  }
  /**
   * Advance this world's uint32 linear congruential generator once.
   * @returns A deterministic floating-point sample derived from uint32 state.
   * @throws If the world was disposed or its solver has failed.
   */
  random(): number {
    this.#alive();
    this.#random = (Math.imul(this.#random, 1664525) + 1013904223) >>> 0;
    return this.#random / 4294967296;
  }
  /**
   * Create a static, kinematic or dynamic rigid body with stable identity.
   * @param o Body pose, motion, mass, locking and optional attached geometry.
   * @returns A body handle; use colliders(handle) to obtain attached handles.
   * @throws For unknown fields, invalid geometry or unsafe numerical values.
   */
  createBody(o: BodyOptions): number {
    keys(
      o,
      "type position rotation velocity angularVelocity gravityScale linearDamping angularDamping " +
        "canSleep ccd lockRotations colliders mass lockTranslations rotationAxes",
      "body",
    );
    this.#alive();
    const r = this.#r;
    booleans(o, "canSleep ccd lockRotations");
    if (o.lockTranslations !== undefined)
      axes(o.lockTranslations, "lockTranslations");
    if (o.rotationAxes !== undefined) axes(o.rotationAxes, "rotationAxes");
    const factories = {
      static: r.RigidBodyDesc.fixed,
      kinematic: r.RigidBodyDesc.kinematicPositionBased,
      dynamic: r.RigidBodyDesc.dynamic,
    };
    if (!Object.hasOwn(factories, o.type))
      throw new TypeError(
        "physics: body type must be static, kinematic or dynamic",
      );
    const d = factories[o.type]();
    const p = vector(o.position ?? ZERO),
      q = rotation(o.rotation ?? IDENTITY),
      v = vector(o.velocity ?? ZERO);
    for (const n of Object.values(v)) bounded(n, "velocity", -10000, 10000);
    for (const n of Object.values(vector(o.angularVelocity ?? ZERO)))
      bounded(n, "angular velocity", -1000, 1000);
    d.setTranslation(p.x, p.y, p.z)
      .setRotation(q)
      .setLinvel(v.x, v.y, v.z)
      .setAngvel(vector(o.angularVelocity ?? ZERO));
    d.setGravityScale(bounded(o.gravityScale ?? 1, "gravityScale", -100, 100));
    d.setLinearDamping(positive(o.linearDamping ?? 0, "linearDamping", true));
    d.setAngularDamping(
      positive(o.angularDamping ?? 0, "angularDamping", true),
    );
    d.setCanSleep(o.canSleep ?? true).setCcdEnabled(o.ccd ?? false);
    if (o.lockRotations) d.lockRotations();
    if (o.lockTranslations)
      d.enabledTranslations(
        !o.lockTranslations.x,
        !o.lockTranslations.y,
        !o.lockTranslations.z,
      );
    if (o.rotationAxes)
      d.enabledRotations(o.rotationAxes.x, o.rotationAxes.y, o.rotationAxes.z);
    if (o.mass !== undefined) {
      bounded(o.mass, "mass", 0.000001, 1000000);
      if (!o.colliders?.length) d.setAdditionalMass(o.mass);
    }
    if (
      o.type === "dynamic" &&
      o.mass === undefined &&
      !(o.colliders ?? []).some((c) => !c.sensor && (c.density ?? 1) > 0)
    ) {
      throw new RangeError(
        "physics: a dynamic body needs positive solid collider density or explicit mass",
      );
    }
    if (
      o.type === "dynamic" &&
      o.colliders?.length &&
      o.colliders.every((c) => c.sensor)
    )
      throw new RangeError("physics: a dynamic body needs a solid collider");
    // Validate every collider before allocating a body, so bad data leaves no body behind.
    const colliders = (o.colliders ?? []).map((c) =>
      this.#colliderDesc(c, o.type),
    );
    if (o.mass !== undefined && colliders.length) {
      for (const collider of colliders)
        collider.setMass(o.mass / colliders.length);
    }
    const precisionLimit = Math.min(
      1e6,
      ...(o.colliders ?? []).map((c) => this.#shapePrecision(c.shape)),
    );
    if (
      Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) > precisionLimit ||
      (o.colliders ?? []).some((c) =>
        Object.values(add(p, c.position ?? ZERO)).some(
          (n) => Math.abs(n) > this.#shapePrecision(c.shape),
        ),
      )
    )
      throw new RangeError(
        "physics: shape is too small for position precision",
      );
    const b = this.#world.createRigidBody(d),
      id = this.#id();
    this.#bodies.set(id, {
      id,
      raw: b.handle,
      precisionLimit,
      ...(o.mass === undefined ? {} : { mass: o.mass }),
    });
    if (b.isKinematic()) this.#kinematics.add(id);
    this.#bodyColliders.set(id, new Set());
    this.#bodyJoints.set(id, new Set());
    colliders.forEach((desc, i) =>
      this.#insertCollider(id, desc, o.colliders![i]!.sensor ?? false),
    );
    return id;
  }
  #shapePrecision(shape: Shape): number {
    if (shape.kind === "heightfield")
      return Math.min(
        1e6,
        (shape.scale.x / shape.columns) * 65536,
        (shape.scale.z / shape.rows) * 65536,
      );
    if (shape.kind === "convex" || shape.kind === "mesh") {
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < shape.vertices.length; i++) {
        const a = i % 3;
        min[a] = Math.min(min[a]!, shape.vertices[i]!);
        max[a] = Math.max(max[a]!, shape.vertices[i]!);
      }
      return Math.min(
        1e6,
        ...min.map((n, a) => (max[a]! - n) * 65536).filter((n) => n > 0),
      );
    }
    const extent =
      shape.kind === "sphere" || shape.kind === "capsule"
        ? shape.radius
        : shape.kind === "box"
          ? Math.min(
              shape.halfExtents.x,
              shape.halfExtents.y,
              shape.halfExtents.z,
            )
          : 1;
    return Math.min(1e6, extent * 131072);
  }
  #colliderDesc(o: ColliderOptions, type: BodyOptions["type"]) {
    keys(
      o,
      "shape position gridPosition rotation sensor layers friction restitution density impactThreshold",
      "collider",
    );
    booleans(o, "sensor");
    if (!o.shape) throw new TypeError("physics: collider needs a shape");
    if (
      type !== "static" &&
      (o.shape.kind === "mesh" || o.shape.kind === "heightfield")
    )
      throw new RangeError(
        "physics: mesh and heightfield colliders require a static body; use convex hulls for moving bodies",
      );
    let shape = o.shape;
    if (o.gridPosition && shape.kind !== "heightfield")
      throw new RangeError("physics: gridPosition requires a heightfield");
    const gridPosition = o.gridPosition
      ? this.#up === "y"
        ? { x: o.gridPosition.x, y: 0, z: o.gridPosition.z }
        : { x: o.gridPosition.x, y: o.gridPosition.z, z: 0 }
      : undefined;
    let p = vector(o.position ?? gridPosition ?? ZERO),
      q = rotation(o.rotation ?? IDENTITY);
    if (
      this.#up === "z" &&
      (shape.kind === "capsule" || shape.kind === "heightfield")
    ) {
      // Rotate +90 degrees about X, preserving handedness. A terrain grid's
      // second horizontal coordinate remains positive by reversing its rows.
      const h = Math.SQRT1_2;
      q = {
        x: (q.w + q.x) * h,
        y: (q.y + q.z) * h,
        z: (q.z - q.y) * h,
        w: (q.w - q.x) * h,
      };
      if (shape.kind === "heightfield") {
        const heights = new Float32Array(shape.heights.length);
        for (let x = 0; x <= shape.columns; x++)
          for (let z = 0; z <= shape.rows; z++) {
            heights[x * (shape.rows + 1) + z] =
              shape.heights[x * (shape.rows + 1) + shape.rows - z]!;
          }
        shape = { ...shape, heights };
      }
    }
    const d = descriptor(shape, this.#r);
    d.setTranslation(p.x, p.y, p.z).setRotation(q);
    d.setSensor(o.sensor ?? false).setCollisionGroups(groups(o.layers));
    d.setFriction(positive(o.friction ?? 0.5, "friction", true));
    const restitution = positive(o.restitution ?? 0, "restitution", true);
    if (restitution > 1)
      throw new RangeError("physics: restitution must be at most one");
    d.setRestitution(restitution).setDensity(
      positive(o.density ?? 1, "density", true),
    );
    d.setActiveEvents(
      this.#r.ActiveEvents.COLLISION_EVENTS |
        this.#r.ActiveEvents.CONTACT_FORCE_EVENTS,
    );
    d.setContactForceEventThreshold(
      positive(o.impactThreshold ?? 10, "impactThreshold", true),
    );
    d.setActiveCollisionTypes(this.#r.ActiveCollisionTypes.ALL);
    return d;
  }
  #insertCollider(
    body: number,
    d: ReturnType<typeof descriptor>,
    sensor: boolean,
  ): number {
    const c = this.#world.createCollider(d, this.#body(body)),
      id = this.#id();
    const record = { id, raw: c.handle, body, sensor };
    this.#dirty = true;
    this.#bodyColliders.get(body)!.add(id);
    const mass = this.#bodies.get(body)!.mass;
    if (mass !== undefined) {
      const owner = this.#body(body);
      owner.setAdditionalMass(0, true);
      const ids = this.#bodyColliders.get(body)!;
      for (const other of ids)
        (other === id ? c : this.#collider(other)).setMass(mass / ids.size);
      owner.recomputeMassPropertiesFromColliders();
    }
    this.#colliders.set(id, record);
    if (record.sensor) this.#sensors.add(id);
    this.#byRaw.set(c.handle, record);
    this.#markPending(id);
    if (c.shapeType() === this.#r.ShapeType.HeightField) this.#terrains.add(id);
    return id;
  }
  /**
   * Attach another piece of local collision geometry to a live body.
   * @param body A currently live rigid-body handle, not a character handle.
   * @param o Geometry, local transform, collision masks and material settings.
   * @returns A new stable collider handle.
   */
  createCollider(body: number, o: ColliderOptions): number {
    const b = this.#body(body);
    const desc = this.#colliderDesc(
      o,
      b.isFixed() ? "static" : b.isDynamic() ? "dynamic" : "kinematic",
    );
    if (
      b.isDynamic() &&
      o.sensor &&
      this.colliders(body).every((id) => this.#collider(id).isSensor())
    )
      throw new RangeError("physics: a dynamic body needs a solid collider");
    const limit = Math.min(
      this.#bodies.get(body)!.precisionLimit ?? 1e6,
      this.#shapePrecision(o.shape),
    );
    if (
      Object.values(add(b.translation(), o.position ?? ZERO)).some(
        (n) => Math.abs(n) > limit,
      )
    )
      throw new RangeError(
        "physics: shape is too small for position precision",
      );
    const id = this.#insertCollider(body, desc, o.sensor ?? false);
    this.#bodies.get(body)!.precisionLimit = limit;
    return id;
  }
  /**
   * Copy the ordered list of shapes attached to a live body.
   * @param body Stable rigid-body handle whose attached shapes are wanted.
   * @returns Handles in insertion order; an empty static body returns [].
   * @throws For a stale, wrong-kind or disposed-world handle.
   */
  colliders(body: number): number[] {
    this.#body(body);
    return [...this.#bodyColliders.get(body)!];
  }
  /**
   * Read a copied pose, velocities and sleeping flag.
   * @param body A currently live rigid-body handle.
   * @returns A detached plain-data BodyState suitable for a renderer.
   * @throws For a missing body or a failed/disposed world.
   */
  bodyState(body: number): BodyState {
    const b = this.#body(body),
      q = b.rotation();
    return {
      position: copy(b.translation()),
      rotation: { ...copy(q), w: q.w },
      velocity: copy(b.linvel()),
      angularVelocity: copy(b.angvel()),
      sleeping: b.isSleeping(),
    };
  }
  /**
   * Apply an instantaneous momentum change to a dynamic body.
   * @param body Dynamic body receiving the impulse.
   * @param impulse World momentum vector; its components must be bounded.
   * @param at Optional world application point, creating angular momentum too.
   * @throws Before applying a rejected input or unsafe linear velocity.
   */
  impulse(body: number, impulse: Vec3, at?: Vec3): void {
    const b = this.#body(body),
      v = vector(impulse);
    if (!b.isDynamic())
      throw new RangeError("physics: impulses require a dynamic body");
    const mass = b.mass(),
      current = b.linvel();
    for (const axis of ["x", "y", "z"] as const)
      bounded(
        current[axis] + v[axis] / mass,
        "resulting velocity",
        -10000,
        10000,
      );
    if (at) b.applyImpulseAtPoint(v, vector(at), true);
    else b.applyImpulse(v, true);
  }
  /**
   * Replace a dynamic body's world linear and optional angular velocity.
   * @param body Live dynamic body to edit.
   * @param velocity World linear velocity in metres per second.
   * @param angular Optional world angular velocity in radians per second.
   * @throws For invalid vectors or a static/kinematic body.
   */
  setVelocity(body: number, velocity: Vec3, angular?: Vec3): void {
    const b = this.#body(body),
      v = vector(velocity),
      a = angular && vector(angular);
    if (!b.isDynamic())
      throw new RangeError("physics: setVelocity requires a dynamic body");
    for (const n of Object.values(v)) bounded(n, "velocity", -10000, 10000);
    if (a)
      for (const n of Object.values(a))
        bounded(n, "angular velocity", -1000, 1000);
    b.setLinvel(v, true);
    if (a) b.setAngvel(a, true);
  }
  /**
   * Set a body's world pose immediately, without sweeping the displacement.
   * @param body Live body whose transform is changed.
   * @param position World-space centre in metres.
   * @param orientation Optional unit world quaternion.
   * @throws Before mutation for an invalid transform or stale handle.
   */
  teleport(body: number, position: Vec3, orientation?: Quat): void {
    const b = this.#body(body),
      p = vector(position),
      q = orientation && rotation(orientation);
    if (
      Object.values(p).some(
        (n) => Math.abs(n) > (this.#bodies.get(body)!.precisionLimit ?? 1e6),
      )
    )
      throw new RangeError(
        "physics: shape is too small for position precision",
      );
    this.#dirty = true;
    this.#targets.delete(body);
    for (const id of this.#bodyColliders.get(body)!) this.#markPending(id);
    b.setTranslation(p, true);
    if (q) b.setRotation(q, true);
    if (b.isKinematic()) {
      b.setNextKinematicTranslation(p);
      if (q) b.setNextKinematicRotation(q);
    }
    const character = this.#bodyCharacters.get(body);
    if (character !== undefined) {
      const c = this.#characters.get(character)!;
      if (c.platform !== null) this.#supporters.get(c.platform)?.delete(c.id);
      c.platform = null;
      c.grounded = false;
      c.verticalVelocity = 0;
      c.momentum = { ...ZERO };
    }
  }
  /**
   * Queue a world target for the next outer step that advances simulation.
   * @param body A non-character position-based kinematic body.
   * @param position World centre to reach by the end of the next outer step.
   * @param orientation Optional target quaternion; omitted rotation is held.
   * @throws For characters, nonkinematic bodies or malformed transforms.
   */
  moveKinematic(body: number, position: Vec3, orientation?: Quat): void {
    const b = this.#body(body),
      p = vector(position),
      q = orientation && rotation(orientation);
    if (!b.isKinematic() || this.#bodyCharacters.has(body))
      throw new RangeError(
        "physics: moveKinematic requires a non-character kinematic body",
      );
    this.#targets.set(body, {
      position: p,
      rotation: q ?? { ...b.rotation() },
    });
  }
  /**
   * Change solver tuning while retaining a body's stable handle.
   * @param body Live rigid body whose tuning is changed.
   * @param options Only the fields being changed; absent fields are preserved.
   * @throws For unknown keys, invalid values or a stale body.
   */
  updateBody(body: number, options: BodyUpdate): void {
    keys(
      options,
      "gravityScale linearDamping angularDamping ccd lockTranslations rotationAxes",
      "body update",
    );
    const b = this.#body(body);
    booleans(options, "ccd");
    if (options.lockTranslations !== undefined)
      axes(options.lockTranslations, "lockTranslations");
    if (options.rotationAxes !== undefined)
      axes(options.rotationAxes, "rotationAxes");
    for (const [key, value] of Object.entries(options))
      if (typeof value === "number" && key !== "gravityScale")
        positive(value, key, true);
    if (options.gravityScale !== undefined)
      bounded(options.gravityScale, "gravityScale", -100, 100);
    if (options.gravityScale !== undefined)
      b.setGravityScale(options.gravityScale, true);
    if (options.linearDamping !== undefined)
      b.setLinearDamping(options.linearDamping);
    if (options.angularDamping !== undefined)
      b.setAngularDamping(options.angularDamping);
    if (options.ccd !== undefined) b.enableCcd(options.ccd);
    if (options.lockTranslations) {
      const a = options.lockTranslations;
      b.setEnabledTranslations(!a.x, !a.y, !a.z, true);
    }
    if (options.rotationAxes) {
      const a = options.rotationAxes;
      b.setEnabledRotations(a.x, a.y, a.z, true);
    }
  }
  /**
   * Change a material, sensor flag or collision mask in place.
   * @param id Live collider handle, not its owning body handle.
   * @param options Only material, sensor and layer fields being changed.
   * @throws Before applying rejected fields or invalid numerical material data.
   */
  updateCollider(id: number, options: ColliderUpdate): void {
    keys(options, "friction restitution sensor layers", "collider update");
    const c = this.#collider(id);
    booleans(options, "sensor");
    if (options.friction !== undefined)
      positive(options.friction, "friction", true);
    if (options.restitution !== undefined)
      bounded(options.restitution, "restitution", 0, 1);
    if (options.layers) groups(options.layers);
    if (
      options.sensor === true &&
      !c.isSensor() &&
      c.parent()?.isDynamic() &&
      this.colliders(this.#colliders.get(id)!.body).every(
        (other) => other === id || this.#collider(other).isSensor(),
      )
    )
      throw new RangeError("physics: a dynamic body requires a solid collider");
    if (options.friction !== undefined) c.setFriction(options.friction);
    if (options.restitution !== undefined)
      c.setRestitution(options.restitution);
    if (options.sensor !== undefined && options.sensor !== c.isSensor()) {
      this.#changedFilters.add(id);
      c.setSensor(options.sensor);
      this.#colliders.get(id)!.sensor = options.sensor;
      if (options.sensor) this.#sensors.add(id);
      else this.#sensors.delete(id);
    }
    if (options.layers && groups(options.layers) !== c.collisionGroups()) {
      this.#changedFilters.add(id);
      c.setCollisionGroups(groups(options.layers));
      const character = this.#bodyCharacters.get(this.#colliders.get(id)!.body);
      if (character !== undefined)
        this.#characters.get(character)!.options.layers = { ...options.layers };
    }
  }
  /**
   * Add a persistent world-space force measured in newtons.
   * @param body Live dynamic body receiving the force.
   * @param force World force vector with bounded finite components.
   * @param at Optional world-space application point in metres.
   * @throws For invalid vectors or a nondynamic target.
   */
  force(body: number, force: Vec3, at?: Vec3): void {
    const b = this.#body(body),
      f = vector(force),
      p = at && vector(at);
    if (!b.isDynamic())
      throw new RangeError("physics: forces require a dynamic body");
    if (p) b.addForceAtPoint(f, p, true);
    else b.addForce(f, true);
  }
  /**
   * Add persistent world-space torque in newton metres.
   * @param body A live dynamic body, not a static or kinematic one.
   * @param torque Bounded world torque vector.
   * @throws Before applying malformed input or a nondynamic target.
   */
  torque(body: number, torque: Vec3): void {
    const b = this.#body(body),
      t = vector(torque);
    if (!b.isDynamic())
      throw new RangeError("physics: torque requires a dynamic body");
    b.addTorque(t, true);
  }
  /**
   * Reset accumulated persistent force and torque on a live body.
   * @param body Live body whose accumulated loads should be cleared.
   * @throws For a stale, wrong-kind or disposed-world handle.
   */
  clearForces(body: number): void {
    const b = this.#body(body);
    b.resetForces(true);
    b.resetTorques(true);
  }
  /**
   * Ask the solver to suspend a live body until it is disturbed.
   * @param body Live body to put to sleep.
   * @throws For a missing body or failed/disposed world.
   */
  sleep(body: number): void {
    this.#body(body).sleep();
  }
  /**
   * Wake a live body so it participates in the next solver step.
   * @param body Live body to awaken.
   * @throws For a missing body or failed/disposed world.
   */
  wake(body: number): void {
    this.#body(body).wakeUp();
  }
  /**
   * Remove one attached shape and invalidate its collider handle.
   * @param id Live collider handle to remove.
   * @throws For a stale handle or for a controller-owned capsule.
   */
  removeCollider(id: number): void {
    const c = this.#collider(id);
    if (this.#bodyCharacters.has(this.#colliders.get(id)!.body))
      throw new RangeError("physics: remove the character, not its collider");
    this.#endPairs(id);
    this.#dirty = true;
    this.#bodyColliders.get(this.#colliders.get(id)!.body)!.delete(id);
    this.#world.removeCollider(c, true);
    this.#byRaw.delete(c.handle);
    this.#colliders.delete(id);
    this.#sensors.delete(id);
    this.#pendingQueries.delete(id);
    this.#pendingIndex.delete(id);
    this.#pendingChanged.delete(id);
    this.#changedFilters.delete(id);
    this.#terrains.delete(id);
  }
  /**
   * Remove a body and all geometry, joints and controllers it owns.
   * @param id Live body handle, including a character's capsule body if desired.
   * @throws For a stale body; removal itself is intentionally not idempotent.
   */
  removeBody(id: number): void {
    const b = this.#body(id);
    const character = this.#bodyCharacters.get(id);
    if (character !== undefined) this.#removeController(character);
    for (const collider of this.#bodyColliders.get(id)!) {
      const c = this.#colliders.get(collider)!;
      this.#endPairs(c.id);
      this.#byRaw.delete(c.raw);
      this.#colliders.delete(c.id);
      this.#sensors.delete(c.id);
      this.#pendingQueries.delete(c.id);
      this.#pendingIndex.delete(c.id);
      this.#pendingChanged.delete(c.id);
      this.#changedFilters.delete(c.id);
      this.#terrains.delete(c.id);
    }
    for (const joint of this.#bodyJoints.get(id) ?? []) {
      const record = this.#joints.get(joint)!;
      this.#edits.push({ kind: "joint", raw: record.raw });

      this.#bodyJoints
        .get(record.a === id ? record.b : record.a)
        ?.delete(joint);
      this.#joints.delete(joint);
    }
    this.#bodyJoints.delete(id);
    for (const character of this.#supporters.get(id) ?? []) {
      const c = this.#characters.get(character);
      if (c) c.platform = null;
    }
    this.#supporters.delete(id);
    this.#targets.delete(id);
    this.#edits.push({ kind: "body", raw: b.handle });
    this.#bodies.delete(id);
    this.#kinematics.delete(id);
    this.#bodyColliders.delete(id);
    this.#bodyCharacters.delete(id);
  }
  #jointData(o: JointOptions) {
    keys(
      o,
      "kind bodyA bodyB anchorA anchorB contacts rotationA rotationB axis limits",
      "joint",
    );
    booleans(o, "contacts");
    const r = this.#r;
    if (o.bodyA === o.bodyB)
      throw new RangeError("physics: a joint needs two different bodies");
    const aa = vector(o.anchorA),
      ab = vector(o.anchorB);
    let d;
    switch (o.kind) {
      case "fixed":
        d = r.JointData.fixed(
          aa,
          rotation(o.rotationA ?? IDENTITY),
          ab,
          rotation(o.rotationB ?? IDENTITY),
        );
        break;
      case "ball":
        d = r.JointData.spherical(aa, ab);
        break;
      case "hinge":
      case "slider": {
        const axis = vector(o.axis),
          len = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);
        if (Math.abs(len - 1) > 1e-5)
          throw new RangeError("physics: joint axis must be unit length");
        d =
          o.kind === "hinge"
            ? r.JointData.revolute(aa, ab, axis)
            : r.JointData.prismatic(aa, ab, axis);
        if (o.limits) {
          const [lo, hi] = o.limits;
          finite(lo, "limit");
          finite(hi, "limit");
          if (lo > hi)
            throw new RangeError("physics: joint limits are reversed");
          d.limitsEnabled = true;
          d.limits = [lo, hi];
        }
        break;
      }
      default:
        throw new TypeError("physics: unknown joint kind");
    }
    return d;
  }
  /**
   * Connect two distinct live bodies with a stable joint handle.
   * @param o Joint kind, connected bodies, local frames and optional limits.
   * @returns A stable joint handle whose lifetime ends with either body.
   * @throws Before allocation when the description is invalid.
   */
  createJoint(o: JointOptions): number {
    const a = this.#body(o.bodyA),
      b = this.#body(o.bodyB);
    this.#jointData(o);
    const id = this.#id();
    this.#edits.push({
      kind: "createJoint",
      id,
      a: a.handle,
      b: b.handle,
      options: structuredClone(o),
    });
    this.#joints.set(id, { id, raw: -id, a: o.bodyA, b: o.bodyB });
    this.#bodyJoints.get(o.bodyA)!.add(id);
    this.#bodyJoints.get(o.bodyB)!.add(id);
    return id;
  }
  #flushEdits(): void {
    const created = new Map<number, number>();
    for (const edit of this.#edits) {
      if (edit.kind === "createJoint") {
        const j = this.#world.createImpulseJoint(
          this.#jointData(edit.options),
          this.#world.getRigidBody(edit.a),
          this.#world.getRigidBody(edit.b),
          true,
        );
        j.setContactsEnabled(edit.options.contacts ?? false);
        created.set(-edit.id, j.handle);
        const record = this.#joints.get(edit.id);
        if (record) record.raw = j.handle;
      } else if (edit.kind === "joint") {
        const raw = created.get(edit.raw) ?? edit.raw;
        if (this.#world.impulseJoints.contains(raw)) {
          const joint = this.#world.getImpulseJoint(raw),
            a = joint.body1(),
            b = joint.body2();
          this.#world.removeImpulseJoint(joint, false);
          a.wakeUp();
          b.wakeUp();
        }
      } else this.#world.removeRigidBody(this.#world.getRigidBody(edit.raw));
    }
    this.#edits = [];
  }
  /**
   * Remove one impulse constraint and wake its connected bodies.
   * @param id Live joint handle returned by createJoint.
   * @throws For a stale or wrong-kind handle.
   */
  removeJoint(id: number): void {
    this.#alive();
    const j = this.#joints.get(id);
    if (!j) throw new RangeError(`physics: unknown joint ${id}`);
    this.#edits.push({ kind: "joint", raw: j.raw });

    this.#joints.delete(id);
    this.#bodyJoints.get(j.a)!.delete(id);
    this.#bodyJoints.get(j.b)!.delete(id);
  }
  /** Read the latest solved normal force in newtons without generating sustained events. */
  contactForce(colliderA: number, colliderB: number): number {
    this.#alive();
    let impulse = 0;
    this.#world.contactPair(
      this.#collider(colliderA),
      this.#collider(colliderB),
      (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i++)
          impulse += manifold.contactImpulse(i);
      },
    );
    return impulse / this.#fixedDt;
  }
  #markPending(id: number): void {
    this.#pendingQueries.add(id);
    this.#pendingChanged.add(id);
  }
  #sync(): void {
    this.#alive();
    if (this.#dirty) this.#world.propagateModifiedBodyPositionsToColliders();
    this.#dirty = false;
    for (const id of this.#pendingChanged) {
      const c = this.#collider(id);
      this.#pendingIndex.set(id, c.translation(), queryRadius(c.shape));
    }
    this.#pendingChanged.clear();
  }
  #filter(f: QueryFilter) {
    keys(f, "layers excludeBody excludeCollider sensors", "query");
    booleans(f, "sensors");
    return [
      f.sensors === true ? undefined : this.#r.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(f.layers),
      !this.hasCollider(f.excludeCollider!)
        ? undefined
        : this.#collider(f.excludeCollider!),
      !this.hasBody(f.excludeBody!) ? undefined : this.#body(f.excludeBody!),
    ] as const;
  }
  /**
   * Find the nearest boundary along a unit world-space ray.
   * @param origin World ray origin in metres.
   * @param direction Unit world direction; non-unit vectors are rejected.
   * @param distance Nonnegative maximum travel distance.
   * @returns Plain hit data, or null if no eligible collider is reached.
   */
  raycast(
    origin: Vec3,
    direction: Vec3,
    distance: number,
    filter: QueryFilter = {},
  ): RayHit | null {
    const p = vector(origin),
      v = vector(direction);
    positive(distance, "distance", true);
    const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (Math.abs(length - 1) > 1e-5)
      throw new RangeError("physics: ray direction must be unit length");
    this.#sync();
    let best: RayHit | null = null;
    for (const hit of this.#rayHits(p, v, distance, filter))
      if (
        !best ||
        hit.distance < best.distance ||
        (hit.distance === best.distance && hit.collider < best.collider)
      )
        best = hit;
    return best;
  }
  /**
   * Collect every eligible ray boundary, sorted by distance and handle.
   * @param origin World ray origin.
   * @param direction Unit world direction.
   * @param distance Nonnegative maximum distance in metres.
   * @returns A detached array, empty when the ray misses.
   */
  raycastAll(
    origin: Vec3,
    direction: Vec3,
    distance: number,
    filter: QueryFilter = {},
  ): RayHit[] {
    const p = vector(origin),
      v = vector(direction);
    positive(distance, "distance", true);
    if (Math.abs(v.x * v.x + v.y * v.y + v.z * v.z - 1) > 1e-5)
      throw new RangeError("physics: ray direction must be unit length");
    this.#sync();
    return this.#rayHits(p, v, distance, filter, true).sort(
      (a, b) => a.distance - b.distance || a.collider - b.collider,
    );
  }
  #eligible(c: Collider, filter: QueryFilter): boolean {
    const record = this.#byRaw.get(c.handle);
    return (
      !!record &&
      record.id !== filter.excludeCollider &&
      record.body !== filter.excludeBody &&
      (filter.sensors === true || !c.isSensor()) &&
      layersMeet(c.collisionGroups(), groups(filter.layers))
    );
  }
  #rayHits(
    p: Vec3,
    v: Vec3,
    distance: number,
    filter: QueryFilter,
    all = false,
  ): RayHit[] {
    const hits: RayHit[] = [];
    const ray = new this.#r.Ray(p, v);
    const accept = (
      collider: Collider,
      hit: { timeOfImpact: number; normal: Vec3 },
    ) => {
      const c = this.#byRaw.get(collider.handle)!;
      hits.push({
        collider: c.id,
        body: c.body,
        distance: hit.timeOfImpact,
        point: add(p, {
          x: v.x * hit.timeOfImpact,
          y: v.y * hit.timeOfImpact,
          z: v.z * hit.timeOfImpact,
        }),
        normal: exitNormal(hit.normal, v, collider.containsPoint(p)),
      });
    };
    if (all)
      this.#world.intersectionsWithRay(
        ray,
        distance,
        false,
        (hit) => {
          accept(hit.collider, hit);
          return true;
        },
        ...this.#filter(filter),
        (c) =>
          this.#eligible(c, filter) &&
          !this.#pendingQueries.has(this.#byRaw.get(c.handle)?.id ?? -1),
      );
    else {
      const hit = this.#world.castRayAndGetNormal(
        ray,
        distance,
        false,
        ...this.#filter(filter),
        (c) =>
          this.#eligible(c, filter) &&
          !this.#pendingQueries.has(this.#byRaw.get(c.handle)?.id ?? -1),
      );
      if (hit) accept(hit.collider, hit);
    }
    for (const id of this.#pendingIndex.candidates(
      p,
      { x: v.x * distance, y: v.y * distance, z: v.z * distance },
      0,
    )) {
      if (!this.hasCollider(id)) continue;
      const c = this.#collider(id);
      if (!this.#eligible(c, filter)) continue;
      const hit = c.castRayAndGetNormal(ray, distance, false);
      if (hit) accept(c, hit);
    }
    for (const id of this.#terrains) {
      if (!this.hasCollider(id) || hits.some((hit) => hit.collider === id))
        continue;
      const c = this.#collider(id);
      if (!this.#eligible(c, filter)) continue;
      // Rapier's terrain ray traversal misses shared triangle boundaries.
      // Retry the four neighbouring cells at a sub-millimetre local offset.
      for (const [x, z] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const shift = turn(c.rotation(), {
          x: x! * 0.0001,
          y: 0,
          z: z! * 0.0001,
        });
        const hit = c.castRayAndGetNormal(
          new this.#r.Ray(add(p, shift), v),
          distance,
          false,
        );
        if (hit) {
          accept(c, hit);
          break;
        }
      }
    }
    return hits;
  }
  #castRaw(
    ...args: Parameters<RapierWorld["castShape"]>
  ): ReturnType<RapierWorld["castShape"]> {
    const [
      p,
      q,
      v,
      shape,
      distance,
      max,
      stop,
      flags = 0,
      masks = 0xffffffff,
      excludeCollider,
      excludeBody,
      predicate,
    ] = args;
    let boxHit: ReturnType<RapierWorld["castShape"]> = null;
    const acceptBox = (c: Collider): boolean => {
      if (!this.#activeCharacter || c.shapeType() !== this.#r.ShapeType.Cuboid)
        return true;
      const box = localBox(
        this.#r,
        c,
        shape,
        p,
        { x: v.x * max, y: v.y * max, z: v.z * max },
        distance,
      );
      const candidate = box?.shape.castShape(
        box.p,
        box.q,
        ZERO,
        shape,
        p,
        q,
        v,
        distance,
        max,
        stop,
      );
      if (
        candidate &&
        (!boxHit || candidate.time_of_impact < boxHit.time_of_impact)
      )
        boxHit = {
          ...candidate,
          collider: c,
          normal1: turn(box!.q, candidate.normal1),
          witness1: add(box!.p, turn(box!.q, candidate.witness1)),
        };
      return false;
    };
    let hit = this.#world.castShape(
      p,
      q,
      v,
      shape,
      distance,
      max,
      stop,
      flags || undefined,
      masks,
      excludeCollider,
      excludeBody,
      (c) =>
        this.#byRaw.has(c.handle) &&
        !this.#pendingQueries.has(this.#byRaw.get(c.handle)?.id ?? -1) &&
        (!predicate || predicate(c)) &&
        acceptBox(c),
    );
    for (const id of this.#pendingIndex.candidates(
      p,
      { x: v.x * max, y: v.y * max, z: v.z * max },
      queryRadius(shape) + distance,
    )) {
      if (!this.hasCollider(id)) continue;
      const c = this.#collider(id),
        body = c.parent();
      if (
        c.handle === excludeCollider?.handle ||
        body?.handle === excludeBody?.handle ||
        !layersMeet(c.collisionGroups(), masks) ||
        (predicate && !predicate(c))
      )
        continue;
      const f = this.#r.QueryFilterFlags;
      if (
        (flags & f.EXCLUDE_SENSORS && c.isSensor()) ||
        (flags & f.EXCLUDE_SOLIDS && !c.isSensor()) ||
        (flags & f.EXCLUDE_FIXED && body?.isFixed()) ||
        (flags & f.EXCLUDE_KINEMATIC && body?.isKinematic()) ||
        (flags & f.EXCLUDE_DYNAMIC && body?.isDynamic())
      )
        continue;
      if (!acceptBox(c)) continue;
      const next = c.castShape(ZERO, shape, p, q, v, distance, max, stop);
      if (next && (!hit || next.time_of_impact < hit.time_of_impact))
        hit = {
          ...next,
          collider: c,
          witness1: add(c.translation(), turn(c.rotation(), next.witness1)),
          normal1: turn(c.rotation(), next.normal1),
        };
    }
    const localHit = boxHit as ReturnType<RapierWorld["castShape"]>;
    if (localHit && (!hit || localHit.time_of_impact < hit.time_of_impact))
      hit = localHit;
    return hit;
  }
  /**
   * Sweep convex geometry through a world-space displacement.
   * @param shape Convex collision description, copied into the query adapter.
   * @param position Starting world centre in metres.
   * @param delta Complete desired world displacement in metres.
   * @returns The first hit and world witness/normal, or null on a miss.
   */
  castShape(
    shape: Shape,
    position: Vec3,
    delta: Vec3,
    orientation: Quat = IDENTITY,
    filter: QueryFilter = {},
  ): ShapeHit | null {
    if (shape.kind === "mesh" || shape.kind === "heightfield")
      throw new RangeError("physics: cast a convex shape");
    const desc = this.#colliderDesc({ shape, rotation: orientation }, "static");
    const s = desc.shape,
      p = vector(position),
      d = vector(delta),
      q = desc.rotation;
    this.#sync();
    const hit = this.#castRaw(p, q, d, s, 0, 1, true, ...this.#filter(filter));
    if (!hit) return null;
    const c = this.#byRaw.get(hit.collider.handle)!;
    return {
      collider: c.id,
      body: c.body,
      fraction: hit.time_of_impact,
      point: copy(hit.witness1),
      normal: copy(hit.normal1),
    };
  }
  /**
   * Find shapes overlapping supplied geometry at a world pose.
   * @param shape Collision geometry whose overlap is being checked.
   * @param position World centre of that geometry.
   * @param orientation Optional world rotation, default identity.
   * @returns A detached list of eligible collider handles.
   */
  overlaps(
    shape: Shape,
    position: Vec3,
    orientation: Quat = IDENTITY,
    filter: QueryFilter = {},
  ): number[] {
    const desc = this.#colliderDesc({ shape, rotation: orientation }, "static");
    const s = desc.shape,
      p = vector(position),
      q = desc.rotation,
      out: number[] = [];
    this.#sync();
    this.#world.intersectionsWithShape(
      p,
      q,
      s,
      (c) => {
        out.push(this.#byRaw.get(c.handle)!.id);
        return true;
      },
      ...this.#filter(filter),
      (c) =>
        this.#eligible(c, filter) &&
        !this.#pendingQueries.has(this.#byRaw.get(c.handle)?.id ?? -1),
    );
    for (const id of this.#pendingIndex.candidates(p, ZERO, queryRadius(s))) {
      if (!this.hasCollider(id)) continue;
      const c = this.#collider(id);
      if (this.#eligible(c, filter) && c.intersectsShape(s, p, q)) out.push(id);
    }
    return out.sort((a, b) => a - b);
  }
  #characterOptions(options: CharacterOptions): CharacterOptions {
    keys(
      options,
      "position radius height stepHeight stepMinWidth slopeLimit snapDistance offset gravity jumpSpeed " +
        "layers terminalSpeed pushMass coyoteTime jumpBuffer acceleration groundGrace braking airAcceleration slideControl facingResponse softBoundary",
      "character",
    );
    const o = {
      ...options,
      position: vector(options.position),
      layers: options.layers && { ...options.layers },
    };
    positive(o.radius, "radius");
    positive(o.height, "height");
    if (o.height < 2 * o.radius)
      throw new RangeError("physics: character height must include both caps");
    positive(o.offset, "offset");
    positive(o.stepHeight, "stepHeight", true);
    positive(o.stepMinWidth, "stepMinWidth");
    positive(o.snapDistance, "snapDistance", true);
    bounded(o.gravity, "character gravity", 0, 1000);
    bounded(o.jumpSpeed, "jumpSpeed", 0, 1000);
    positive(o.slopeLimit, "slopeLimit", true);
    if (o.slopeLimit >= Math.PI / 2)
      throw new RangeError("physics: slopeLimit must be below pi/2");
    groups(o.layers);
    for (const name of [
      "terminalSpeed",
      "pushMass",
      "coyoteTime",
      "jumpBuffer",
      "acceleration",
      "groundGrace",
      "braking",
      "airAcceleration",
      "slideControl",
      "facingResponse",
    ] as const) {
      if (o[name] !== undefined) positive(o[name]!, name, true);
    }
    if (o.slideControl !== undefined)
      bounded(o.slideControl, "slideControl", 0, 1);
    if (o.softBoundary) {
      keys(o.softBoundary, "halfExtent margin strength", "softBoundary");
      for (const [key, value] of Object.entries(o.softBoundary))
        positive(value, key);
      if (o.softBoundary.margin > o.softBoundary.halfExtent)
        throw new RangeError("physics: boundary margin exceeds extent");
      o.softBoundary = { ...o.softBoundary };
    }
    return o;
  }
  /**
   * Create an upright kinematic capsule and its movement controller.
   * @param options Required geometry/tuning plus optional gameplay controls.
   * @returns A character handle, distinct from body and collider handles.
   * @throws For malformed tuning, unsafe numbers or an embedded spawn.
   */
  createCharacter(options: CharacterOptions): number {
    this.#alive();
    const o = this.#characterOptions(options);
    const shape: Shape = {
      kind: "capsule",
      radius: o.radius,
      halfHeight: o.height / 2 - o.radius,
    };
    let embedded = this.overlaps(shape, o.position, IDENTITY, {
      layers: o.layers,
    }).some((id) => {
      const capsule = new this.#r.Capsule(o.height / 2 - o.radius, o.radius);
      const q =
        this.#up === "y"
          ? IDENTITY
          : { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
      return (
        (characterContact(
          this.#r,
          this.#collider(id),
          capsule,
          o.position,
          q,
          0,
        )?.distance ?? 0) < -0.0001
      );
    });
    // Containment probes cover deep GJK degeneracies where an intersection
    // routine can converge to a near-zero positive distance inside a wide box.
    for (const offset of [
      0,
      o.height / 2 - o.radius,
      o.radius - o.height / 2,
    ]) {
      const point = {
        ...o.position,
        [this.#up]: o.position[this.#up] + offset,
      };
      this.#world.intersectionsWithPoint(
        point,
        (collider) => {
          if (!this.#byRaw.has(collider.handle)) return true;
          embedded = true;
          return false;
        },
        this.#r.QueryFilterFlags.EXCLUDE_SENSORS,
        groups(o.layers),
      );
    }
    if (embedded) {
      throw new RangeError(
        "physics: character spawn overlaps a solid; choose a clear position",
      );
    }
    const body = this.createBody({
      type: "kinematic",
      position: o.position,
      lockRotations: true,
      colliders: [
        {
          shape: {
            kind: "capsule",
            radius: o.radius,
            halfHeight: o.height / 2 - o.radius,
          },
          layers: o.layers,
        },
      ],
    });
    const collider = this.colliders(body)[0]!,
      id = this.#id();
    const c: CharacterRecord = {
      id,
      options: o,
      body,
      collider,
      grounded: false,
      verticalVelocity: 0,
      platform: null,
      input: { x: 0, y: 0, z: 0 },
      momentum: { ...ZERO },
      hits: [],
      crushed: false,
      groundTime: 0,
      graceTime: 0,
      jumpTime: 0,
      velocity: { ...ZERO },
      stance: "falling",
      facing: { x: 1, y: 0, z: 0 },
      jumped: false,
      landed: false,
      landingSpeed: 0,
    };
    this.#characters.set(id, c);
    this.#bodyCharacters.set(body, id);
    return id;
  }
  #character(id: number): CharacterRecord {
    this.#alive();
    const c = this.#characters.get(id);
    if (!c) throw new RangeError(`physics: unknown character ${id}`);
    return c;
  }
  /**
   * Copy support, vertical velocity, touched shapes and crush status.
   * @param id Live character handle returned by createCharacter.
   * @returns Detached plain data, including a copied hits array.
   * @throws For a stale or wrong-kind character handle.
   */
  characterState(id: number): CharacterState {
    const c = this.#character(id);
    return {
      body: c.body,
      collider: c.collider,
      grounded: c.grounded,
      verticalVelocity: c.verticalVelocity,
      platform: c.platform,
      hits: [...c.hits],
      crushed: c.crushed,
      stance: c.stance,
      facing: copy(c.facing),
      jumped: c.jumped,
      landed: c.landed,
      landingSpeed: c.landingSpeed,
    };
  }
  /**
   * Set held horizontal input and optionally request one buffered jump.
   * @param id Live character handle, not its capsule body handle.
   * @param input Desired ground velocity and optional jump request.
   * @throws For unknown fields, invalid components or vertical input.
   */
  controlCharacter(id: number, input: CharacterInput): void {
    keys(input, "x y z jump", "character input");
    booleans(input, "jump");
    if ((input[this.#up] ?? 0) !== 0)
      throw new RangeError(
        "physics: character input uses only the ground axes",
      );
    const c = this.#character(id);
    c.input = {
      x: finite(input.x, "input.x"),
      y: finite(input.y ?? 0, "input.y"),
      z: finite(input.z ?? 0, "input.z"),
      jump: !!input.jump || !!c.input.jump,
    };
  }
  #removeController(id: number): void {
    const character = this.#characters.get(id)!;
    if (character.platform !== null)
      this.#supporters.get(character.platform)?.delete(id);
    this.#characters.delete(id);
  }
  /**
   * Remove a controller together with its capsule body and shape.
   * @param id Live character handle returned by createCharacter.
   * @throws For a stale or wrong-kind handle.
   */
  removeCharacter(id: number): void {
    const c = this.#character(id);
    this.removeBody(c.body);
  }
  #characterCast(
    ...args: Parameters<RapierWorld["castShape"]>
  ): ReturnType<RapierWorld["castShape"]> {
    const [position, orientation, delta, geometry, skinDistance, maximum] =
      args;
    validateCharacterQuery(geometry, position, orientation, skinDistance);
    if (!finiteVector(delta) || !Number.isFinite(maximum) || maximum <= 0)
      throw new RangeError("physics: invalid character sweep");
    if (
      (delta.x ** 2 + delta.y ** 2 + delta.z ** 2) * maximum ** 2 <
      MIN_SWEEP ** 2
    )
      return null;
    const previous = args[11];
    const blocked = this.#activeCharacter?.obstructed ?? [];
    args[11] = (other) =>
      !blocked.includes(this.#byRaw.get(other.handle)?.body ?? -1) &&
      (!previous || previous(other));
    const skin = args[4];
    args[4] = 0;
    const shape = args[3];
    const downward =
      args[2].x === 0 &&
      args[2][this.#up === "y" ? "z" : "y"] === 0 &&
      args[2][this.#up] < 0;
    const originalDistance = -args[2][this.#up];
    const lift = downward ? skin + 0.005 : 0;
    if (
      shape.type === this.#r.ShapeType.Capsule &&
      args[2].x === 0 &&
      args[2][this.#up === "y" ? "z" : "y"] === 0 &&
      args[2][this.#up] < 0
    ) {
      const capsule =
        shape as import("@dimforge/rapier3d-deterministic").Capsule;
      args[0] = {
        ...args[0],
        [this.#up]: args[0][this.#up] - Math.fround(capsule.halfHeight),
      };
      args[3] = new this.#r.Ball(capsule.radius);
    }
    if (downward) {
      args[0] = { ...args[0], [this.#up]: args[0][this.#up] + lift };
      args[2] = { ...args[2], [this.#up]: args[2][this.#up] - lift - skin };
    }
    let hit = this.#castRaw(...args);
    if (
      !hit &&
      args[2][this.#up] < 0 &&
      args[2].x === 0 &&
      args[2][this.#up === "y" ? "z" : "y"] === 0
    ) {
      const original = args[0],
        horizontal = this.#up === "y" ? "z" : "y";
      for (const sign of [-1, 1]) {
        args[0] = {
          ...original,
          x: original.x + sign * 0.0001,
          [horizontal]: original[horizontal] + 0.0001,
        };
        hit = this.#castRaw(...args);
        if (hit) break;
      }
    }
    if (hit && skin > 0) {
      const v = args[2],
        n = hit.normal1;
      const approach = -(v.x * n.x + v.y * n.y + v.z * n.z);
      if (approach > 1e-8) hit.time_of_impact -= skin / approach;
    }
    if (hit) {
      if (downward)
        hit.time_of_impact =
          (hit.time_of_impact * -args[2][this.#up] - lift) / originalDistance;
      else hit.time_of_impact = Math.max(0, hit.time_of_impact);
      if (hit.time_of_impact > 1) return null;
    }
    return hit;
  }
  #slideCharacter(c: CharacterRecord, position: Vec3, desired: Vec3) {
    const capsule = this.#collider(c.collider);
    return solveCharacter(
      {
        cast: (target, remaining) =>
          this.#characterCast(
            target,
            capsule.rotation(),
            remaining,
            capsule.shape,
            c.options.offset,
            1,
            false,
            this.#r.QueryFilterFlags.EXCLUDE_SENSORS,
            groups(c.options.layers),
            capsule,
            this.#body(c.body),
            (other) => {
              const contact = characterContact(
                this.#r,
                other,
                capsule.shape,
                target,
                capsule.rotation(),
                c.options.offset * 1.1,
              );
              return (
                !contact ||
                contact.normal1.x * remaining.x +
                  contact.normal1.y * remaining.y +
                  contact.normal1.z * remaining.z <
                  -1e-7
              );
            },
          ),
      },
      position,
      desired,
      this.#up,
      slopeCos(c.options.slopeLimit),
    );
  }
  #reconcileTriggers(events: PhysicsEvent[]): void {
    const actual = new Map<string, PhysicsEvent>();
    for (const id of this.#sensors) {
      const record = this.#colliders.get(id)!;
      const sensor = this.#collider(id);
      this.#world.intersectionsWithShape(
        sensor.translation(),
        sensor.rotation(),
        sensor.shape,
        (other) => {
          const second = this.#byRaw.get(other.handle);
          if (
            !second ||
            second.body === record.body ||
            (this.#body(record.body).isFixed() &&
              this.#body(second.body).isFixed())
          )
            return true;
          const [a, b] =
            record.id < second.id ? [record, second] : [second, record];
          const key = `${a.id}:${b.id}`;
          actual.set(key, {
            tick: this.#tick,
            kind: "trigger",
            started: true,
            bodyA: a.body,
            bodyB: b.body,
            colliderA: a.id,
            colliderB: b.id,
          });
          return true;
        },
        undefined,
        sensor.collisionGroups(),
        sensor,
        sensor.parent() ?? undefined,
      );
    }
    for (const [key, old] of this.#pairs) {
      if (old.kind === "trigger" && !actual.has(key)) {
        const event = { ...old, tick: this.#tick, started: false };
        this.#forgetPair(key);
        events.push(event);
      }
    }
    for (const [key, event] of actual)
      if (!this.#pairs.has(key)) {
        this.#trackPair(key, event);
        events.push(event);
      }
  }
  #characterHost(): CharacterHost {
    return {
      up: this.#up,
      fixedDt: this.#fixedDt,
      r: this.#r,
      activate: (c) => {
        this.#activeCharacter = c;
      },
      body: (id) => this.#body(id),
      collider: (id) => this.#collider(id),
      hasBody: (id) => this.hasBody(id),
      hasCollider: (id) => this.hasCollider(id),
      colliders: (id) => this.colliders(id),
      overlaps: (c, p) =>
        this.overlaps(
          {
            kind: "capsule",
            radius: c.options.radius,
            halfHeight: c.options.height / 2 - c.options.radius,
          },
          p,
          IDENTITY,
          { excludeBody: c.body, layers: c.options.layers },
        ),
      byRaw: this.#byRaw,
      targets: this.#targets,
      supporters: this.#supporters,
      raycast: (p, v, d, f) => this.raycast(p, v, d, f),
      characterCast: (...args) => this.#characterCast(...args),
      slideCharacter: (c, p, d) => this.#slideCharacter(c, p, d),
    };
  }
  /**
   * Advance by complete fixed substeps while retaining fractional seconds.
   * @param dt Nonnegative elapsed simulation seconds, normally a fixed game tick.
   * @returns Ordered contact/trigger transitions and solved impact events.
   * @throws For invalid time, excessive catch-up, or a trapped/failed solver.
   */
  step(dt: number): PhysicsEvent[] {
    this.#alive();
    positive(dt, "dt", true);
    const total = this.#remainder + dt,
      count = Math.floor(total / this.#fixedDt + 1e-10);
    if (!Number.isSafeInteger(count) || count > this.#maxSubsteps)
      throw new RangeError(
        "physics: dt exceeds maxSubsteps; feed smaller fixed tick batches",
      );
    this.#remainder = Math.max(0, total - count * this.#fixedDt);
    for (const c of this.#characters.values()) {
      c.crushed = false;
      c.hits = [];
      c.jumped = false;
      c.landed = false;
      c.landingSpeed = 0;
    }
    const events: PhysicsEvent[] = this.#pendingEvents.splice(0);
    const targets = [...this.#targets].map(([id, target]) => ({
      id,
      target,
      start: this.bodyState(id),
    }));
    try {
      for (let i = 0; i < count; i++) {
        this.#flushEdits();
        for (const { id, target, start } of targets) {
          if (!this.hasBody(id)) continue;
          const t = Math.min(
              1,
              ((i + 1) * this.#fixedDt) / (target.remaining ?? total),
            ),
            b = this.#body(id);
          b.setNextKinematicTranslation({
            x: start.position.x + (target.position.x - start.position.x) * t,
            y: start.position.y + (target.position.y - start.position.y) * t,
            z: start.position.z + (target.position.z - start.position.z) * t,
          });
          const a = start.rotation,
            z = target.rotation;
          const sign =
            a.x * z.x + a.y * z.y + a.z * z.z + a.w * z.w < 0 ? -1 : 1;
          const q = {
            x: a.x * (1 - t) + z.x * t * sign,
            y: a.y * (1 - t) + z.y * t * sign,
            z: a.z * (1 - t) + z.z * t * sign,
            w: a.w * (1 - t) + z.w * t * sign,
          };
          const n = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
          b.setNextKinematicRotation({
            x: q.x / n,
            y: q.y / n,
            z: q.z / n,
            w: q.w / n,
          });
        }
        this.#sync();
        const characterHost = this.#characterHost();
        for (const c of this.#characters.values())
          moveCharacter(characterHost, c);
        separateCharacters(characterHost, [...this.#characters.values()]);
        // Body-local policy failures never poison the solver or unrelated bodies.
        for (const record of this.#bodies.values()) {
          const body = this.#world.getRigidBody(record.raw);
          if (body.isFixed() || body.isSleeping()) continue;
          const p = body.translation();
          const outside =
            (this.#killPlane !== undefined && p[this.#up] < this.#killPlane) ||
            (this.#bounds &&
              (["x", "y", "z"] as const).some(
                (axis) =>
                  p[axis] < this.#bounds!.min[axis] ||
                  p[axis] > this.#bounds!.max[axis],
              ));
          const imprecise = Object.values(p).some(
            (n) =>
              !Number.isFinite(n) ||
              Math.abs(n) > (record.precisionLimit ?? 1e6),
          );
          const report = (reason: PhysicsEvent["reason"]) => {
            if (
              events.some(
                (e) =>
                  e.kind === "limit" &&
                  e.bodyA === record.id &&
                  e.reason === reason,
              )
            )
              return;
            const collider = this.colliders(record.id)[0] ?? 0;
            events.push({
              tick: this.#tick,
              kind: "limit",
              started: false,
              bodyA: record.id,
              bodyB: record.id,
              colliderA: collider,
              colliderB: collider,
              reason,
              character: this.#bodyCharacters.get(record.id),
            });
          };
          if (outside || imprecise) {
            report(outside ? "outside-bounds" : "position-precision");
            this.removeBody(record.id);
            for (const event of this.#pendingEvents.splice(0))
              events.push(event);
            continue;
          }
          for (const [value, limit, angular] of [
            [body.linvel(), 10000, false],
            [body.angvel(), 1000, true],
          ] as const) {
            if (
              Object.values(value).some(
                (n) => !Number.isFinite(n) || Math.abs(n) > limit,
              )
            ) {
              const clamp = (n: number) =>
                Number.isFinite(n) ? Math.max(-limit, Math.min(limit, n)) : 0;
              const next = {
                x: clamp(value.x),
                y: clamp(value.y),
                z: clamp(value.z),
              };
              if (angular) body.setAngvel(next, true);
              else body.setLinvel(next, true);
              report("velocity-clamped");
            }
          }
        }
        this.#flushEdits();
        let reconcileTriggers = false;
        if (this.#sensors.size) {
          reconcileTriggers =
            this.#pendingQueries.size > 0 || this.#changedFilters.size > 0;
          if (!reconcileTriggers)
            this.#world.forEachActiveRigidBody((body) => {
              if (body.isDynamic()) reconcileTriggers = true;
            });
          if (!reconcileTriggers)
            for (const id of this.#kinematics) {
              const body = this.#body(id),
                p = body.translation(),
                next = body.nextTranslation(),
                q = body.rotation(),
                nextQ = body.nextRotation();
              if (
                p.x !== next.x ||
                p.y !== next.y ||
                p.z !== next.z ||
                q.x !== nextQ.x ||
                q.y !== nextQ.y ||
                q.z !== nextQ.z ||
                q.w !== nextQ.w
              ) {
                reconcileTriggers = true;
                break;
              }
            }
        }
        this.#world.step(this.#queue);
        this.#dirty = false;
        this.#pendingQueries.clear();
        this.#pendingIndex.clear();
        this.#pendingChanged.clear();
        this.#tick++;
        const batch: PhysicsEvent[] = [];
        this.#queue.drainCollisionEvents((ra, rb, started) => {
          let a = this.#byRaw.get(ra),
            b = this.#byRaw.get(rb);
          // Removing a collider intentionally discards its later engine exit event.
          if (!a || !b) return;
          if (
            !a.sensor &&
            !b.sensor &&
            (this.#bodyCharacters.has(a.body) ||
              this.#bodyCharacters.has(b.body))
          )
            return;
          if (this.#changedFilters.has(a.id) || this.#changedFilters.has(b.id))
            return;
          if (a.id > b.id) [a, b] = [b, a];
          const event: PhysicsEvent = {
            tick: this.#tick,
            kind: a.sensor || b.sensor ? "trigger" : "contact",
            started,
            colliderA: a.id,
            colliderB: b.id,
            bodyA: a.body,
            bodyB: b.body,
          };
          if (started && event.kind === "contact") {
            this.#world.contactPair(
              this.#collider(a.id),
              this.#collider(b.id),
              (manifold, flipped) => {
                if (!event.normal) {
                  const n = manifold.normal(),
                    sign = flipped ? -1 : 1;
                  event.normal = {
                    x: n.x * sign,
                    y: n.y * sign,
                    z: n.z * sign,
                  };
                  if (manifold.numSolverContacts())
                    event.point = copy(manifold.solverContactPoint(0)!);
                }
                for (let j = 0; j < manifold.numContacts(); j++)
                  event.impulse =
                    (event.impulse ?? 0) + manifold.contactImpulse(j);
              },
            );
          }
          batch.push(event);
        });
        // Edited filters are reconciled from geometry rather than assumed engine transitions.
        for (const id of this.#changedFilters) {
          const a = this.#colliders.get(id);
          if (!a) continue;
          const candidates = new Set<number>();
          const ca = this.#collider(a.id);
          const include = (other: Collider) => {
            const record = this.#byRaw.get(other.handle);
            if (record) candidates.add(record.id);
          };
          this.#world.contactPairsWith(ca, include);
          this.#world.intersectionPairsWith(ca, include);
          this.#world.intersectionsWithShape(
            ca.translation(),
            ca.rotation(),
            ca.shape,
            (other) => {
              include(other);
              return true;
            },
          );
          for (const key of this.#colliderPairs.get(id) ?? []) {
            const old = this.#pairs.get(key)!;
            candidates.add(
              old.colliderA === id ? old.colliderB : old.colliderA,
            );
          }
          for (const otherId of [...candidates].sort((a, b) => a - b)) {
            const b = this.#colliders.get(otherId);
            if (!b) continue;
            if (
              a.body === b.body ||
              (this.#body(a.body).isFixed() && this.#body(b.body).isFixed())
            )
              continue;
            const cb = this.#collider(b.id);
            const key = `${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`;
            const old = this.#pairs.get(key);
            const kind = a.sensor || b.sensor ? "trigger" : "contact";
            const touching =
              layersMeet(ca.collisionGroups(), cb.collisionGroups()) &&
              (ca.contactCollider(cb, 0.002)?.distance ?? Infinity) <= 0.002;
            if (old && (!touching || old.kind !== kind))
              batch.push({ ...old, tick: this.#tick, started: false });
            if (touching && (!old || old.kind !== kind)) {
              const [first, second] = a.id < b.id ? [a, b] : [b, a];
              batch.push({
                tick: this.#tick,
                kind,
                started: true,
                colliderA: first.id,
                colliderB: second.id,
                bodyA: first.body,
                bodyB: second.body,
              });
            }
          }
        }
        this.#changedFilters.clear();
        for (const c of this.#characters.values()) {
          if (this.#collider(c.collider).isSensor()) continue;
          const candidates = new Set(c.hits);
          for (const key of this.#colliderPairs.get(c.collider) ?? []) {
            const old = this.#pairs.get(key)!;
            if (old.kind === "contact")
              candidates.add(
                old.colliderA === c.collider ? old.colliderB : old.colliderA,
              );
          }
          for (const id of candidates) {
            const other = this.#colliders.get(id);
            if (!other || other.sensor) continue;
            const a = Math.min(c.collider, id),
              b = Math.max(c.collider, id),
              key = `${a}:${b}`;
            const old = this.#pairs.get(key);
            const velocity = this.#body(other.body).linvel();
            const travel =
              Math.sqrt(
                velocity.x * velocity.x +
                  velocity.y * velocity.y +
                  velocity.z * velocity.z,
              ) * this.#fixedDt;
            const capsule = this.#collider(c.collider);
            const contact = characterContact(
              this.#r,
              this.#collider(id),
              capsule.shape,
              capsule.translation(),
              capsule.rotation(),
              c.options.offset * 4 + Math.min(c.options.radius, 2 * travel),
            );
            if (contact && a === c.collider) {
              [contact.point1, contact.point2] = [
                contact.point2,
                contact.point1,
              ];
              [contact.normal1, contact.normal2] = [
                contact.normal2,
                contact.normal1,
              ];
            }
            const touching =
              contact &&
              layersMeet(
                this.#collider(c.collider).collisionGroups(),
                this.#collider(id).collisionGroups(),
              );
            if (touching && !old)
              batch.push({
                tick: this.#tick,
                kind: "contact",
                started: true,
                colliderA: a,
                colliderB: b,
                bodyA: this.#colliders.get(a)!.body,
                bodyB: this.#colliders.get(b)!.body,
                point: copy(contact.point1),
                normal: copy(contact.normal1),
                impulse: 0,
              });
            else if (!touching && old)
              batch.push({ ...old, tick: this.#tick, started: false });
          }
        }
        const begun = new Map<
          string,
          PhysicsEvent & { impactReported?: boolean }
        >();
        for (const event of batch)
          if (event.kind === "contact" && event.started)
            begun.set(`${event.colliderA}:${event.colliderB}`, event);
        this.#queue.drainContactForceEvents((force) => {
          let a = this.#byRaw.get(force.collider1()),
            b = this.#byRaw.get(force.collider2());
          if (!a || !b) return;
          if (a.id > b.id) [a, b] = [b, a];
          const pair =
            this.#pairs.get(`${a.id}:${b.id}`) ?? begun.get(`${a.id}:${b.id}`);
          if (!pair || pair.impactReported) return;
          pair.impactReported = true;
          const impulse = force.totalForceMagnitude() * this.#fixedDt;
          const event: PhysicsEvent = {
            tick: this.#tick,
            kind: "impact",
            started: true,
            colliderA: a.id,
            colliderB: b.id,
            bodyA: a.body,
            bodyB: b.body,
            impulse,
          };
          this.#world.contactPair(
            this.#collider(a.id),
            this.#collider(b.id),
            (manifold, flipped) => {
              if (event.normal) return;
              const n = manifold.normal(),
                sign = flipped ? -1 : 1;
              event.normal = { x: n.x * sign, y: n.y * sign, z: n.z * sign };
              if (manifold.numSolverContacts())
                event.point = copy(manifold.solverContactPoint(0)!);
            },
          );
          batch.push(event);
        });
        batch.sort(
          (a, b) => a.colliderA - b.colliderA || a.colliderB - b.colliderB,
        );
        const accepted: PhysicsEvent[] = [];
        for (const event of batch) {
          if (event.kind === "impact") {
            accepted.push(event);
            continue;
          }
          const key = `${event.colliderA}:${event.colliderB}`;
          const old = this.#pairs.get(key);
          if (
            event.started
              ? old?.kind === event.kind
              : !old || old.kind !== event.kind
          )
            continue;
          if (event.started) this.#trackPair(key, event);
          else this.#forgetPair(key);
          accepted.push(event);
        }
        for (const event of accepted) events.push(event);
        if (reconcileTriggers) this.#reconcileTriggers(events);
      }
    } catch (cause) {
      if (!(cause instanceof WebAssembly.RuntimeError)) throw cause;
      this.#failed = true;
      this.#timeline.clear();
      this.#world = undefined as unknown as RapierWorld;
      this.#queue = undefined as unknown as EventQueue;
      this.#r = undefined as unknown as ReturnType<typeof acquireEngine>;
      throw new Error(
        "physics: engine failed during step; restore a saved state or dispose",
        { cause },
      );
    }
    if (count)
      for (const { id, target } of targets) {
        if (!this.hasBody(id)) continue;
        const remaining = (target.remaining ?? total) - count * this.#fixedDt;
        if (remaining > 1e-10) this.#targets.set(id, { ...target, remaining });
        else this.#targets.delete(id);
      }
    if (count) this.#timeline.clear();
    return events;
  }
  /**
   * Encode one complete replayable timeline in a single byte buffer.
   * @returns Owned bytes; use snapshotChunks for bounded storage values.
   * @throws When the world is failed or disposed.
   */
  snapshot(): Uint8Array {
    this.#alive();
    const meta: Save = {
      bounds: this.#bounds,
      killPlane: this.#killPlane,
      up: this.#up,
      engine: "0.21.0",
      fixedDt: this.#fixedDt,
      maxSubsteps: this.#maxSubsteps,
      remainder: this.#remainder,
      tick: this.#tick,
      next: this.#next,
      random: this.#random,
      bodies: [...this.#bodies.values()],
      colliders: [...this.#colliders.values()],
      joints: [...this.#joints.values()],
      characters: [...this.#characters.values()],
      targets: [...this.#targets],
      pairs: [...this.#pairs.values()],
      pendingEvents: this.#pendingEvents,
      changedFilters: [...this.#changedFilters],
      pendingQueries: [...this.#pendingQueries],
      dirty: this.#dirty,
      replay: this.#timeline.replay,
      edits: this.#edits,
    };
    return pack(
      meta,
      this.#timeline.replay ? new Uint8Array() : this.#world.takeSnapshot(),
    );
  }
  /**
   * Create one binary save and expose ordered views into its buffer.
   * @param maxBytes Maximum chunk size, in bytes, from 1024 to 2000000.
   * @returns Ordered Uint8Array views; no JSON or per-chunk re-encoding.
   * @throws For invalid size limits or a failed/disposed world.
   */
  snapshotChunks(maxBytes = 1900000): Uint8Array[] {
    if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 2000000) {
      throw new RangeError("physics: chunk size must be 1024..2000000 bytes");
    }
    const bytes = this.snapshot(),
      chunks: Uint8Array[] = [];
    for (let offset = 0; offset < bytes.length; offset += maxBytes)
      chunks.push(bytes.subarray(offset, offset + maxBytes));
    return chunks;
  }
  /**
   * Assemble ordered stored values and restore them as one binary state.
   * @param chunks Ordered byte-array values from one snapshot generation.
   * @throws Before replacement if the envelope or its saved state is invalid.
   */
  restoreChunks(chunks: readonly Uint8Array[]): void {
    if (
      !Array.isArray(chunks) ||
      chunks.some((c) => !(c instanceof Uint8Array))
    ) {
      throw new TypeError("physics: chunks must be an array of byte arrays");
    }
    const size = chunks.reduce((n, chunk) => n + chunk.byteLength, 0);
    if (size > 64 * 1024 * 1024)
      throw new RangeError("physics: snapshot exceeds 64 MiB");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    this.restore(bytes);
  }
  /**
   * Validate and atomically replace this world's current timeline.
   * @param bytes Trusted server-owned snapshot from the supported engine.
   * @throws Without replacing state when validation fails.
   * @throws If the world was explicitly disposed rather than merely failed.
   */
  restore(bytes: Uint8Array): void {
    if (this.#disposed) throw new Error("physics: world is disposed");
    const { meta, raw } = unpack(bytes);
    const s = meta as Save;
    if (s?.replay) {
      const replay = s.replay;
      if (
        !(replay.checkpoint instanceof Uint8Array) ||
        !Array.isArray(replay.commands) ||
        (unpack(replay.checkpoint).meta as Save)?.replay ||
        replay.commands.some(
          (command) =>
            !Array.isArray(command) ||
            command.length !== 2 ||
            !timelineMethods.includes(
              command[0] as (typeof timelineMethods)[number],
            ) ||
            !Array.isArray(command[1]),
        )
      )
        throw new RangeError("physics: invalid snapshot command journal");
      const execute = (owner: PhysicsWorld) => {
        owner.restore(replay.checkpoint);
        const methods = owner as unknown as Record<
          string,
          (...args: unknown[]) => unknown
        >;
        for (const [name, args] of replay.commands) methods[name]!(...args);
      };
      const validation = createWorld({});
      try {
        execute(validation);
        const canonical = validation.snapshot();
        if (
          canonical.length !== bytes.length ||
          canonical.some((value, i) => value !== bytes[i])
        )
          throw new RangeError(
            "physics: snapshot journal does not match its state",
          );
      } finally {
        validation.dispose();
      }
      execute(this);
      return;
    }

    if (
      !s ||
      ![s.bodies, s.colliders, s.joints, s.characters].every(Array.isArray)
    ) {
      throw new RangeError("physics: invalid snapshot records");
    }
    for (const records of [s.targets, s.pairs, s.pendingEvents]) {
      if (records !== undefined && !Array.isArray(records))
        throw new RangeError("physics: invalid snapshot records");
    }
    if (s.up !== undefined && s.up !== "y" && s.up !== "z")
      throw new RangeError("physics: invalid saved up axis");
    if (s.engine !== "0.21.0")
      throw new RangeError(
        "physics: incompatible engine version; saves do not cross engine versions",
      );
    bounded(s.fixedDt, "saved fixedDt", 0.001, 0.1);
    seeded(s.random);
    if (
      !Number.isSafeInteger(s.maxSubsteps) ||
      s.maxSubsteps < 1 ||
      s.maxSubsteps > 128 ||
      !Number.isSafeInteger(s.next) ||
      s.next < 1 ||
      !Number.isSafeInteger(s.tick) ||
      s.tick < 0 ||
      !Number.isFinite(s.remainder) ||
      s.remainder < 0 ||
      s.remainder >= s.fixedDt
    )
      throw new RangeError("physics: invalid snapshot state");
    const restoringEngine = this.#failed ? acquireEngine() : this.#r;
    const world = restoringEngine.World.restoreSnapshot(raw);
    if (!world) throw new RangeError("physics: invalid engine snapshot");
    try {
      if (s.edits !== undefined && !Array.isArray(s.edits))
        throw new RangeError("physics: invalid structural commands");
      const queuedJoints = new Set<number>();
      const removedBodies = new Set<number>();
      for (const edit of s.edits ?? []) {
        if (!edit || !["body", "joint", "createJoint"].includes(edit.kind))
          throw new RangeError("physics: invalid structural command");
        if (edit.kind === "createJoint") {
          if (
            !Number.isSafeInteger(edit.id) ||
            edit.id < 1 ||
            edit.id >= s.next ||
            queuedJoints.has(-edit.id) ||
            removedBodies.has(edit.a) ||
            removedBodies.has(edit.b) ||
            !world.bodies.contains(edit.a) ||
            !world.bodies.contains(edit.b)
          )
            throw new RangeError("physics: invalid pending joint");
          this.#jointData(edit.options);
          queuedJoints.add(-edit.id);
        } else if (edit.kind === "body") {
          if (!world.bodies.contains(edit.raw) || removedBodies.has(edit.raw))
            throw new RangeError("physics: invalid pending removal");
          removedBodies.add(edit.raw);
        } else if (
          !queuedJoints.has(edit.raw) &&
          !world.impulseJoints.contains(edit.raw)
        )
          throw new RangeError("physics: invalid pending joint removal");
      }
      const ids = new Set<number>();
      for (const item of [
        ...s.bodies,
        ...s.colliders,
        ...s.joints,
        ...s.characters,
      ]) {
        if (
          !Number.isSafeInteger(item.id) ||
          item.id < 1 ||
          item.id >= s.next ||
          ids.has(item.id)
        )
          throw new RangeError("physics: invalid saved handle");
        ids.add(item.id);
      }
      const bodyRecords = new Map(s.bodies.map((b) => [b.id, b]));
      const colliderRecords = new Map(s.colliders.map((c) => [c.id, c]));
      for (const records of [s.bodies, s.colliders, s.joints]) {
        if (
          new Set(records.map((record) => record.raw)).size !== records.length
        )
          throw new RangeError("physics: duplicate saved raw handle");
      }
      for (const b of s.bodies)
        if (!world.bodies.contains(b.raw))
          throw new RangeError("physics: missing saved body");
      for (const c of s.colliders)
        if (
          !world.colliders.contains(c.raw) ||
          world.getCollider(c.raw).parent()?.handle !==
            bodyRecords.get(c.body)?.raw
        )
          throw new RangeError("physics: missing saved collider");
      for (const j of s.joints) {
        if (
          j.raw === -j.id &&
          s.edits?.some((e) => e.kind === "createJoint" && e.id === j.id)
        )
          continue;
        if (!world.impulseJoints.contains(j.raw))
          throw new RangeError("physics: missing saved joint");
        const joint = world.getImpulseJoint(j.raw);
        if (
          bodyRecords.get(j.a)?.raw !== joint.body1().handle ||
          bodyRecords.get(j.b)?.raw !== joint.body2().handle
        ) {
          throw new RangeError("physics: invalid saved joint ownership");
        }
      }
      for (const field of ["body", "collider"] as const) {
        if (
          new Set(s.characters.map((c) => c[field])).size !==
          s.characters.length
        ) {
          throw new RangeError("physics: duplicate saved character ownership");
        }
      }
      for (const event of [...(s.pairs ?? []), ...(s.pendingEvents ?? [])]) {
        if (
          !event ||
          !["contact", "trigger"].includes(event.kind) ||
          typeof event.started !== "boolean" ||
          ![event.colliderA, event.colliderB, event.bodyA, event.bodyB].every(
            (id) => Number.isSafeInteger(id) && id > 0 && id < s.next,
          )
        ) {
          throw new RangeError("physics: invalid saved event");
        }
      }
      for (const event of s.pairs ?? []) {
        if (
          !event.started ||
          colliderRecords.get(event.colliderA)?.body !== event.bodyA ||
          colliderRecords.get(event.colliderB)?.body !== event.bodyB
        )
          throw new RangeError("physics: invalid saved pair");
      }
      if (
        s.changedFilters !== undefined &&
        (!Array.isArray(s.changedFilters) ||
          !s.changedFilters.every((id) => colliderRecords.has(id)))
      )
        throw new RangeError("physics: invalid pending filter changes");
      for (const c of s.characters) {
        this.#characterOptions(c.options);
        c.stance ??= c.grounded ? "planted" : "falling";
        if (!["planted", "rising", "falling", "sliding"].includes(c.stance))
          throw new RangeError("physics: invalid saved stance");
        c.facing ??= { x: 1, y: 0, z: 0 };
        vector(c.facing);
        c.jumped ??= false;
        c.landed ??= false;
        c.landingSpeed ??= 0;
        booleans(c, "jumped landed");
        positive(c.landingSpeed, "landing speed", true);
        c.momentum ??= { ...ZERO };
        c.velocity ??= { ...ZERO };
        c.hits ??= [];
        c.crushed ??= false;
        c.groundTime ??= 0;
        c.graceTime ??= 0;
        c.jumpTime ??= 0;
        if (
          !Array.isArray(c.hits) ||
          !c.hits.every(
            (id) => Number.isSafeInteger(id) && id > 0 && id < s.next,
          ) ||
          (c.platform !== null && !bodyRecords.has(c.platform))
        ) {
          throw new RangeError("physics: invalid saved character references");
        }
        for (const timer of [c.groundTime, c.graceTime, c.jumpTime])
          bounded(timer, "saved character timer", 0, 1000000);
        booleans(c.input, "jump");
        booleans(c, "grounded crushed");
        vector(c.momentum);
        vector(c.velocity);
        finite(c.verticalVelocity, "saved vertical velocity");
        finite(c.input.x, "saved input");
        finite(c.input.y ?? 0, "saved input");
        finite(c.input.z ?? 0, "saved input");
      }
      for (const [id, target] of s.targets ?? []) {
        if (!bodyRecords.has(id))
          throw new RangeError("physics: missing saved target");
        vector(target.position);
        rotation(target.rotation);
        if (target.remaining !== undefined)
          bounded(target.remaining, "saved target time", 0, 1);
      }
      for (const c of s.characters)
        if (
          !bodyRecords.has(c.body) ||
          colliderRecords.get(c.collider)?.body !== c.body
        )
          throw new RangeError("physics: missing saved character");
    } catch (error) {
      world.free();
      throw error;
    }
    this.#release();
    this.#timeline.clear();
    this.#r = restoringEngine;
    this.#failed = false;
    this.#dirty = s.dirty ?? true;
    this.#world = world;
    this.#edits = s.edits ?? [];
    this.#queue = new this.#r.EventQueue(true);
    this.#bounds = s.bounds;
    this.#killPlane = s.killPlane;
    this.#up = s.up ?? "y";
    this.#fixedDt = s.fixedDt;
    this.#maxSubsteps = s.maxSubsteps;
    this.#remainder = s.remainder;
    this.#tick = s.tick;
    this.#next = s.next;
    this.#random = s.random;
    this.#bodies = new Map(s.bodies.map((v) => [v.id, v]));
    this.#kinematics = new Set(
      s.bodies
        .filter((b) => this.#world.getRigidBody(b.raw).isKinematic())
        .map((b) => b.id),
    );
    this.#colliders = new Map(s.colliders.map((v) => [v.id, v]));
    this.#sensors = new Set(
      s.colliders.filter((c) => c.sensor).map((c) => c.id),
    );
    this.#byRaw = new Map(s.colliders.map((v) => [v.raw, v]));
    this.#pendingQueries = new Set(
      s.pendingQueries ?? s.colliders.map((c) => c.id),
    );
    this.#pendingIndex.clear();
    this.#pendingChanged = new Set(this.#pendingQueries);
    this.#terrains = new Set(
      s.colliders
        .filter(
          (c) =>
            this.#collider(c.id).shapeType() === this.#r.ShapeType.HeightField,
        )
        .map((c) => c.id),
    );
    this.#joints = new Map(s.joints.map((v) => [v.id, v]));
    this.#targets = new Map(s.targets ?? []);
    this.#pairs = new Map(
      (s.pairs ?? []).map((e) => [`${e.colliderA}:${e.colliderB}`, e]),
    );
    this.#colliderPairs.clear();
    for (const [key, event] of this.#pairs) this.#trackPair(key, event);
    this.#bodyJoints = new Map(s.bodies.map((b) => [b.id, new Set<number>()]));
    for (const j of s.joints) {
      this.#bodyJoints.get(j.a)!.add(j.id);
      this.#bodyJoints.get(j.b)!.add(j.id);
    }
    this.#supporters.clear();
    for (const c of s.characters)
      if (c.platform !== null) {
        let set = this.#supporters.get(c.platform);
        if (!set) this.#supporters.set(c.platform, (set = new Set()));
        set.add(c.id);
      }
    this.#pendingEvents = s.pendingEvents ?? [];
    this.#changedFilters = new Set(s.changedFilters ?? []);
    this.#bodyColliders = new Map(
      s.bodies.map((b) => [b.id, new Set<number>()]),
    );
    for (const c of s.colliders) this.#bodyColliders.get(c.body)!.add(c.id);
    this.#bodyCharacters = new Map(s.characters.map((c) => [c.body, c.id]));
    this.#characters = new Map(s.characters.map((v) => [v.id, v]));
  }
  /**
   * Copy solver debug geometry for an optional renderer or diagnostic.
   * @returns Owned Float32Array vertices and colours.
   * @throws For a failed or disposed world.
   */
  debugLines(): DebugLines {
    this.#sync();
    const d = this.#world.debugRender();
    return { vertices: d.vertices.slice(), colors: d.colors.slice() };
  }
  #release(): void {
    if (this.#failed) return;
    this.#world.free();
    this.#queue.free();
  }

  /**
   * Release this world's owned solver resources and clear handle indices.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#release();
    if (!this.#failed) releaseEngine(this.#r);
    this.#world = undefined as unknown as RapierWorld;
    this.#queue = undefined as unknown as EventQueue;
    this.#r = undefined as unknown as ReturnType<typeof acquireEngine>;
    this.#disposed = true;
    this.#bodies.clear();
    this.#pendingQueries.clear();
    this.#pendingIndex.clear();
    this.#pendingChanged.clear();
    this.#changedFilters.clear();
    this.#terrains.clear();
    this.#kinematics.clear();
    this.#colliders.clear();
    this.#sensors.clear();
    this.#byRaw.clear();
    this.#joints.clear();
    this.#characters.clear();
    this.#edits = [];
    this.#bodyColliders.clear();
    this.#bodyCharacters.clear();
    this.#bodyJoints.clear();
    this.#supporters.clear();
    this.#colliderPairs.clear();
    this.#pairs.clear();
    this.#targets.clear();
    this.#pendingEvents.length = 0;
  }
}
