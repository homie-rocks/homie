/*
 * The camera rules a port keeps (people's hands found every one of these):
 *
 * 1. Every direction means the same thing on screen, every second. Read the
 *    stick and WASD against the CAMERA's screen axes, never the character's
 *    facing. The classic failure: "back" turns the character toward the lens,
 *    a chase camera swings round to follow the new heading, and "back" now
 *    points somewhere else, so the character turns again, forever.
 * 2. The camera never turns by itself while a direction is held. Its yaw
 *    changes only for an explicit look input (mouse, look-drag) or at a round
 *    start. A fixed orientation ("north up") is the safe default for top-down
 *    and three-quarter games; a slow re-align after rest turned the view 80-90°
 *    on its own and broke the next presses.
 * 3. Obstacles between the lens and the player fade; the camera does not jump
 *    in front of them.
 * 4. Close enough to read: the player character is big in frame (about 14% of
 *    a phone's height, 20% of a desktop's), the ground ahead visible. A camera
 *    pulled far overhead reads as "you are so high above".
 * 5. No cuts, snaps or re-aims except at a round start or a respawn.
 *
 * The checks prove rule 1 and 2: hold a direction 5 s → one straight line and
 * under 10° of camera yaw; alternate directions for 10 s → every press goes
 * the pressed way on screen.
 */

/** Minimal shape of a three.js camera (anything with matrixWorld.elements works). */
export interface CameraLike { matrixWorld: { elements: ArrayLike<number> }; updateMatrixWorld?: (force?: boolean) => void }

export interface GroundBasis {
  /** Screen-right on the ground plane, as (x, z). */
  right: [number, number];
  /** Screen-up (away from the viewer) on the ground plane, as (x, z). */
  up: [number, number];
  /** Camera yaw in degrees: 0 when screen-up is world -z (three.js's default look direction). */
  yawDeg: number;
}

const norm = (x: number, z: number): [number, number] => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

/** The camera's screen axes laid on the ground (XZ) plane, from its world matrix. */
export function groundBasis(camera: CameraLike): GroundBasis {
  const e = camera.matrixWorld.elements;
  const right = norm(e[0] as number, e[2] as number);
  // The camera looks down its local -Z: forward = -(column 2). Straight down, fall back to its local +Y.
  let up = norm(-(e[8] as number), -(e[10] as number));
  if (Math.hypot(e[8] as number, e[10] as number) < 1e-4) up = norm(e[4] as number, e[6] as number);
  return { right, up, yawDeg: (Math.atan2(-up[0], -up[1]) * 180) / Math.PI };
}

/**
 * Screen-space input (x right, y DOWN, as keys and the touch stick give it) to a ground direction (x, z) for this
 * camera. This is THE mapping rule: the same push goes the same way on screen whatever the character faces.
 */
export function screenToGround(input: { x: number; y: number }, basis: GroundBasis): { x: number; z: number } {
  const sx = input.x; const sy = -input.y; // screen up is positive here
  return { x: basis.right[0] * sx + basis.up[0] * sy, z: basis.right[1] * sx + basis.up[1] * sy };
}

/**
 * A yaw the player owns: it moves only by `turn(deg)` (mouse, look-drag) or `set()` at a round start. Use it for
 * chase and first-person cameras; never feed it the character's heading.
 */
export class PlayerYaw {
  yaw: number;
  constructor(initialDeg = 0) { this.yaw = initialDeg; }
  turn(deltaDeg: number): number { this.yaw = ((this.yaw + deltaDeg + 540) % 360) - 180; return this.yaw; }
  set(deg: number): number { this.yaw = ((deg + 540) % 360) - 180; return this.yaw; }
  /** Screen-space input to a ground direction (x, z) for this yaw (0 = screen-up is world -z). */
  toGround(input: { x: number; y: number }): { x: number; z: number } {
    const a = (this.yaw * Math.PI) / 180;
    const up: [number, number] = [-Math.sin(a), -Math.cos(a)];
    const right: [number, number] = [Math.cos(a), -Math.sin(a)];
    return screenToGround(input, { right, up, yawDeg: this.yaw });
  }
}
