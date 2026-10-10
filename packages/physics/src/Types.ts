/** All distances are metres, time seconds and mass kilograms. World axes are
 * right-handed. Selecting Z-up changes the controller and terrain convention;
 * generic vectors, quaternions, mesh vertices and joint anchors remain world or
 * body-local data as documented below. No solver types cross this boundary.
 */

/** A vector in the coordinate frame of its containing field. */
export interface Vec3 {
  /** X component. */
  x: number;
  /** Y component. */
  y: number;
  /** Z component. */
  z: number;
}
/** Unit quaternion; non-unit and non-finite values are rejected. */
export interface Quat extends Vec3 {
  /** Scalar component; identity is {x:0,y:0,z:0,w:1}. */
  w: number;
}
/** Both membership/filter intersections must be nonzero to interact. */
export interface Layers {
  /** Unsigned 16-bit membership mask. */
  membership: number;
  /** Unsigned 16-bit mask of accepted memberships. */
  filter: number;
}
/** Collision geometry in body-local metres. A capsule's long axis follows up.
 * Heightfields use canonical X/height/second-ground-axis scale and Z-fast samples;
 * the world rotates them for Z-up. Mesh vertices are already in the world's axes.
 */
export type Shape =
  | {
      /** A rectangular solid. */
      kind: "box";
      /** Positive half-widths in body-local X/Y/Z. */
      halfExtents: Vec3;
    }
  | {
      /** A sphere. */
      kind: "sphere";
      /** Positive radius. */
      radius: number;
    }
  | {
      /** A cylinder with hemispherical caps. */
      kind: "capsule";
      /** Positive cap radius. */
      radius: number;
      /** Half the cylinder height, excluding caps; zero makes a sphere. */
      halfHeight: number;
    }
  | {
      /** Convex hull of noncoplanar points. */
      kind: "convex";
      /** Packed xyz points; copied to the solver on creation. */
      vertices: Float32Array;
    }
  | {
      /** Static-only indexed triangle surface. */
      kind: "mesh";
      /** Packed xyz positions. */
      vertices: Float32Array;
      /** Three in-range vertex indices per triangle. */
      indices: Uint32Array;
    }
  | {
      /** Static-only regular terrain, centred on its local origin. */
      kind: "heightfield";
      /** Cell count on the second horizontal axis, at least one. */
      rows: number;
      /** Cell count on X, at least one. */
      columns: number;
      /** (rows+1)*(columns+1) samples, second horizontal axis changing fastest. */
      heights: Float32Array;
      /** X width, Y height multiplier, Z ground depth, all positive. */
      scale: Vec3;
    };
/** Shape, local transform, material and collision filtering. */
export interface ColliderOptions {
  /** Required geometry. Concave mesh/terrain can only belong to static bodies. */
  shape: Shape;
  /** Local centre; defaults to zero. Terrain helpers supply canonical grid offsets. */
  position?: Vec3;
  /** Axis-independent horizontal centre supplied by terrain helpers. Heightfields only. */
  gridPosition?: {
    /** Centre on the first horizontal axis. */
    x: number;
    /** Centre on the second horizontal axis. */
    z: number;
  };
  /** Local unit rotation, applied after the capsule/terrain up-axis rotation. */
  rotation?: Quat;
  /** Trigger without physical response; default false. */
  sensor?: boolean;
  /** Collision/query masks; default all bits in both masks. */
  layers?: Layers;
  /** Nonnegative coefficient; default 0.5. */
  friction?: number;
  /** Bounce coefficient in [0,1]; default zero. */
  restitution?: number;
  /** Kilograms per cubic metre; default 1. Zero contributes no mass. */
  density?: number;
  /** Minimum contact force in newtons for the first impact of a contact episode; default 10. */
  impactThreshold?: number;
}
/** Per-axis switches in world coordinates. */
export interface AxisFlags {
  /** Switch for the world X axis. */
  x: boolean;
  /** Switch for the world Y axis. */
  y: boolean;
  /** Switch for the world Z axis. */
  z: boolean;
}
/** Debug geometry copied from the solver; safe to retain after a later step. */
export interface DebugLines {
  /** Consecutive xyz endpoints; six floats per line segment. */
  vertices: Float32Array;
  /** RGBA colour per endpoint; eight floats per line segment. */
  colors: Float32Array;
}
/** A rigid body. Dynamic bodies need positive collider density or explicit mass. */
export interface BodyOptions {
  /** Static stays fixed; kinematic follows targets; dynamic responds to forces. */
  type: "static" | "kinematic" | "dynamic";
  /** Total mass in kg, split equally among attached shapes; overrides their density. */
  mass?: number;
  /** True locks translation along that world axis; defaults to all false. */
  lockTranslations?: AxisFlags;
  /** Enabled world rotation axes; defaults to all true. */
  rotationAxes?: AxisFlags;
  /** World-space centre, default origin. */
  position?: Vec3;
  /** World unit orientation, default identity. */
  rotation?: Quat;
  /** Initial world linear velocity in m/s, default zero. */
  velocity?: Vec3;
  /** Initial world angular velocity in rad/s, default zero. */
  angularVelocity?: Vec3;
  /** Gravity multiplier, default 1. */
  gravityScale?: number;
  /** Nonnegative linear damping in inverse seconds, default zero. */
  linearDamping?: number;
  /** Nonnegative angular damping in inverse seconds, default zero. */
  angularDamping?: number;
  /** Allow stationary dynamics to sleep, default true. */
  canSleep?: boolean;
  /** Continuous collision detection, default false. */
  ccd?: boolean;
  /** Lock all rotation, default false; rotationAxes takes precedence if present. */
  lockRotations?: boolean;
  /** Shapes attached at creation, default empty. */
  colliders?: readonly ColliderOptions[];
}
/** A copied pose and velocities; changing these values cannot mutate the world. */
export interface BodyState {
  /** World centre in metres. */
  position: Vec3;
  /** World unit orientation. */
  rotation: Quat;
  /** World linear velocity in m/s. */
  velocity: Vec3;
  /** World angular velocity in rad/s. */
  angularVelocity: Vec3;
  /** Whether the solver has suspended this body until disturbed. */
  sleeping: boolean;
}
/** Constraint anchors and rotations are local to their respective bodies. */
export type JointOptions = {
  /** First live body handle. */
  bodyA: number;
  /** Second, different live body handle. */
  bodyB: number;
  /** First body's local anchor in metres. */
  anchorA: Vec3;
  /** Second body's local anchor in metres. */
  anchorB: Vec3;
  /** Allow collision between connected bodies; default false. */
  contacts?: boolean;
} & (
  | {
      /** Locks position and orientation. */
      kind: "fixed";
      /** First local constraint frame; default identity. */
      rotationA?: Quat;
      /** Second local constraint frame; default identity. */
      rotationB?: Quat;
    }
  | {
      /** Spherical joint, free rotation about an anchor. */
      kind: "ball";
    }
  | {
      /** Hinge rotates about the axis; slider translates along it. */
      kind: "hinge" | "slider";
      /** Local unit constraint axis in both bodies. */
      axis: Vec3;
      /** Inclusive [min,max], radians for hinge or metres for slider. */
      limits?: readonly [number, number];
    }
);
/** Optional query restrictions. Stale excluded handles are harmless. */
export interface QueryFilter {
  /** Two-sided query masks, default all bits. */
  layers?: Layers;
  /** Ignore every collider of this body. */
  excludeBody?: number;
  /** Ignore this collider. */
  excludeCollider?: number;
  /** Include sensors when true; default false. */
  sensors?: boolean;
}
/** Ray boundary hit, with a usable outward normal even for rays starting inside. */
export interface RayHit {
  /** Hit collider handle. */
  collider: number;
  /** Owning body handle. */
  body: number;
  /** Metres along the unit ray direction. */
  distance: number;
  /** World contact position. */
  point: Vec3;
  /** World outward unit normal. */
  normal: Vec3;
}
/** Swept convex shape hit. */
export interface ShapeHit {
  /** Hit collider handle. */
  collider: number;
  /** Owning body handle. */
  body: number;
  /** Fraction of supplied displacement in [0,1]. */
  fraction: number;
  /** World witness point on the obstacle. */
  point: Vec3;
  /** World outward normal of the obstacle. */
  normal: Vec3;
}
/** Sorted pair transition, including exits queued by removal. Check liveness
 * before accessing a body: an earlier event handler may have removed it.
 */
export interface PhysicsEvent {
  /** Fixed substep number when emitted (removal uses the current number). */
  tick: number;
  /** Trigger/contact are pair transitions; impact reports solved contact impulse. */
  kind: "contact" | "trigger" | "impact" | "limit";
  /** Character removed with a limited body, when applicable. */
  character?: number;
  /** Reason for a reported clamp or removed body. */
  reason?: "velocity-clamped" | "outside-bounds" | "position-precision";
  /** True begins a pair or reports an impact; false ends a pair. */
  started: boolean;
  /** Smaller collider handle. */
  colliderA: number;
  /** Larger collider handle. */
  colliderB: number;
  /** Body owning colliderA, possibly removed before delivery. */
  bodyA: number;
  /** Body owning colliderB, possibly removed before delivery. */
  bodyB: number;
  /** World contact point if available; absent for triggers. */
  point?: Vec3;
  /** World normal outward from A if available. */
  normal?: Vec3;
  /** Solver normal impulse in kg*m/s; character sweep contacts report zero. */
  impulse?: number;
}
/** Upright capsule tuning. Game gravity and jump speed are explicit. */
export interface CharacterOptions {
  /** Initial world capsule centre; solid overlaps are rejected. */
  position: Vec3;
  /** Positive capsule radius in metres. */
  radius: number;
  /** Full height including both caps, at least twice radius. */
  height: number;
  /** Maximum sole-to-tread rise in metres; zero disables stairs. */
  stepHeight: number;
  /** Minimum clear horizontal tread depth in metres. */
  stepMinWidth: number;
  /** Maximum supporting slope in radians, [0,pi/2). Steeper faces cannot jump. */
  slopeLimit: number;
  /** Maximum downward ground search in metres; zero disables snap. */
  snapDistance: number;
  /** Positive collision skin in metres; 0.01 is typical for a human capsule. */
  offset: number;
  /** Downward acceleration in m/s² along the selected up axis. */
  gravity: number;
  /** Upward jump speed in m/s. */
  jumpSpeed: number;
  /** Collision masks, default all bits. */
  layers?: Layers;
  /** Maximum downward speed in m/s, default 60. */
  terminalSpeed?: number;
  /** Effective mass in kg used to push dynamics, default 80; zero disables pushing. */
  pushMass?: number;
  /** Seconds allowed to jump after leaving support, default 0.1. */
  coyoteTime?: number;
  /** Seconds an early jump request waits for support, default 0.1. */
  jumpBuffer?: number;
  /** Horizontal acceleration and braking in m/s², default 1000. */
  acceleration?: number;
  /** Ground deceleration with zero or reversing input; default acceleration. */
  braking?: number;
  /** Horizontal acceleration in air, m/s²; default 12. */
  airAcceleration?: number;
  /** Fraction of input acceleration retained on steep slopes; default 0.2. */
  slideControl?: number;
  /** Facing interpolation response in inverse seconds; default 12. */
  facingResponse?: number;
  /** Optional spring boundary in the two ground axes, centred at the origin. */
  softBoundary?: {
    /** Positive horizontal half extent in metres. */
    halfExtent: number;
    /** Width of the boundary margin in metres. */
    margin: number;
    /** Inward acceleration per metre beyond the margin. */
    strength: number;
  };
  /** Seconds of ground continuity across step edges and seams, default 0.1. */
  groundGrace?: number;
}
/** Copied controller state. Position is available through bodyState(body). */
export interface CharacterState {
  /** Movement phase for animation and gameplay. */
  stance: "planted" | "rising" | "falling" | "sliding";
  /** Unit horizontal facing, independent from travel velocity. */
  facing: Vec3;
  /** A jump began during this outer tick. */
  jumped: boolean;
  /** The character landed during this outer tick. */
  landed: boolean;
  /** Largest downward landing speed during this tick, m/s. */
  landingSpeed: number;
  /** Kinematic capsule body handle. */
  body: number;
  /** Capsule collider handle. */
  collider: number;
  /** Supporting surface is within the slope limit. */
  grounded: boolean;
  /** Up-axis speed in m/s. */
  verticalVelocity: number;
  /** Supporting body handle, or null in the air. */
  platform: number | null;
  /** Collider handles touched by the current outer tick. */
  hits: readonly number[];
  /** A moving obstacle attempted to push the capsule through another solid. */
  crushed: boolean;
}
/** Held horizontal velocity, in world m/s. Jump is buffered once per request. */
export interface CharacterInput {
  /** Desired X velocity. */
  x: number;
  /** Desired Y velocity for Z-up worlds; default zero. */
  y?: number;
  /** Desired Z velocity for Y-up worlds; default zero. */
  z?: number;
  /** Request a jump; default false. */
  jump?: boolean;
}
/** Mutable uint32 LCG state, copied into a world at creation. */
export interface RandomState {
  /** Integer in [0,4294967295]. */
  state: number;
}
/** One simulation's coordinate and time conventions. */
export interface WorldOptions {
  /** Removal bounds; default +/-10000 metres on all axes. Null disables game bounds. */
  bounds?: {
    /** Inclusive lower corner. */
    min: Vec3;
    /** Inclusive upper corner. */
    max: Vec3;
  } | null;
  /** Optional lower bound along up; bodies below it are removed and reported. */
  killPlane?: number;
  /** World acceleration in m/s²; default -9.81 along up. */
  gravity?: Vec3;
  /** Up axis for gravity defaults, capsules, characters and terrain; default 'y'. */
  up?: "y" | "z";
  /** Fixed solver step in seconds, [0.001,0.1]; default 1/60. */
  fixedDt?: number;
  /** Maximum fixed steps per outer call, 1..128; default 8. Overload throws without changing time. */
  maxSubsteps?: number;
  /** Initial seeded generator state, default {state:1}. */
  random?: RandomState;
}
/** Mutable tuning, with the same fields and units as BodyOptions. */
export type BodyUpdate = Pick<
  BodyOptions,
  | "gravityScale"
  | "linearDamping"
  | "angularDamping"
  | "ccd"
  | "lockTranslations"
  | "rotationAxes"
>;
/** Mutable collider material/filter fields, with the same units as ColliderOptions. */
export type ColliderUpdate = Pick<
  ColliderOptions,
  "friction" | "restitution" | "sensor" | "layers"
>;
