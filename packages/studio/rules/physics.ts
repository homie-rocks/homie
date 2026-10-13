/** Opt-in boundary. Importing the rules kernel never imports or initializes WASM. */
import type { Vec3 } from './rules.ts';
export interface PhysicsMesh { vertices: readonly number[]; indices: readonly number[] }
// Structural query types keep the ordinary rules types independent of the optional package.
export type PhysicsShape = {kind: 'box'; halfExtents: Vec3} | {kind: 'sphere'; radius: number} | {kind: 'capsule'; radius: number; halfHeight: number};
export interface PhysicsRotation {x: number; y: number; z: number; w: number}
export interface PhysicsFilter {layers?: {membership: number; filter: number}; excludeBody?: number; excludeCollider?: number; sensors?: boolean}
export interface PhysicsHit {collider: number; body: number; point: Vec3; normal: Vec3}
export interface PhysicsMovement {
  sweep(body: {pos: Vec3; vel: Vec3; grounded: boolean}, delta: Vec3, radius: number, height: number): void;
  ray(origin: Vec3, direction: Vec3, distance: number, filter?: PhysicsFilter): (PhysicsHit & {distance: number}) | null;
  overlap(shape: PhysicsShape, position: Vec3, orientation?: PhysicsRotation, filter?: PhysicsFilter): number[];
  cast(shape: PhysicsShape, position: Vec3, delta: Vec3, orientation?: PhysicsRotation, filter?: PhysicsFilter): (PhysicsHit & {fraction: number}) | null;
}
export interface RulesPhysics extends PhysicsMovement {
  step(seconds: number): void;
}
export interface PhysicsBridge { api: RulesPhysics; movement: PhysicsMovement; save(): number[]; dispose(): void }
let factory: ((mesh: PhysicsMesh, saved?: number[]) => PhysicsBridge) | undefined;
export function registerPhysics(value: NonNullable<typeof factory>): void { factory = value; }
export function physicsWorld(mesh?: PhysicsMesh, saved?: number[]): PhysicsBridge | undefined {
  if (!mesh) { if (saved !== undefined) throw new Error('physics save requires a physics level'); return; }
  if (saved !== undefined && (!Array.isArray(saved) || saved.some(n => !Number.isInteger(n) || n < 0 || n > 255))) throw new Error('physics: invalid saved bytes');
  if (!factory) throw new Error('physics: initialize the game before starting its room');
  return factory(mesh, saved);
}
