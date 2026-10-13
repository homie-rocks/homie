/** Loaded only by games declaring a baked physics level. */
import { createWorld } from '@homie-rocks/physics/World.js';
import { initPhysics } from '@homie-rocks/physics/Worker.js';
import { brand, charge } from './guard.ts';
import { registerPhysics, type PhysicsMovement, type RulesPhysics } from './physics.ts';

// CPU calibration is recorded in docs/physics-048-calibration.md. Charges precede work.
export const PHYSICS_UNITS = Object.freeze({ cast: 768, ray: 640, overlap: 640, step: 2400 });
export async function initializePhysics(source: WebAssembly.Module | BufferSource): Promise<void> {
  await initPhysics(source);
  registerPhysics((mesh, saved) => {
    const world = createWorld({ up: 'z', fixedDt: 1 / 300, maxSubsteps: 128, bounds: null });
    try {
      if (saved) world.restore(Uint8Array.from(saved));
      else world.createBody({ type: 'static', colliders: [{ shape: { kind: 'mesh', vertices: Float32Array.from(mesh.vertices), indices: Uint32Array.from(mesh.indices) } }] });
      const count = Math.max(1, Math.ceil(mesh.indices.length / (1754 * 3)));
      const convex = (shape: {kind:string}) => { if (!['box','sphere','capsule'].includes(shape.kind)) throw new Error('rules physics queries use a box, sphere or capsule'); };
      const movement: PhysicsMovement = {
        cast(...args) { charge(PHYSICS_UNITS.cast * count); convex(args[0]); return world.castShape(...args); },
        ray(...args) { charge(PHYSICS_UNITS.ray * count); return world.raycast(...args); },
        overlap(...args) { charge(PHYSICS_UNITS.overlap * count); convex(args[0]); return world.overlaps(...args); },
        sweep(body, delta, radius, height) {
          charge(64);
          let left = { ...delta }, pos = { ...body.pos }, vel = { ...body.vel };
          let grounded = false;
          for (let n = 0; n < 4; n++) {
            const length = Math.hypot(left.x, left.y, left.z);
            if (length < 1e-9) break;
            charge(PHYSICS_UNITS.cast * count);
            const hit = world.castCapsule(pos, left, radius, height);
            const fraction = hit ? Math.max(0, hit.fraction) : 1;
            pos = { x: pos.x + left.x * fraction, y: pos.y + left.y * fraction, z: pos.z + left.z * fraction };
            if (!hit) break;
            if (hit.normal.z > .65 && delta.z <= 0) grounded = true;
            const normal = hit.normal;
            const dot = left.x * normal.x + left.y * normal.y + left.z * normal.z;
            const speed = vel.x * normal.x + vel.y * normal.y + vel.z * normal.z;
            if (normal.z > .65 && delta.z <= 0) {
              // Lift the requested horizontal travel along a walkable slope.
              // Projecting gravity onto its normal would make an idle capsule drift.
              left = { x: left.x * (1-fraction), y: left.y * (1-fraction), z: 0 };
              left.z = -(left.x * normal.x + left.y * normal.y) / normal.z;
              vel = { x: vel.x, y: vel.y, z: Math.max(0, vel.z) };
            } else {
              left = { x: (left.x-normal.x*Math.min(0,dot))*(1-fraction), y: (left.y-normal.y*Math.min(0,dot))*(1-fraction), z: (left.z-normal.z*Math.min(0,dot))*(1-fraction) };
              vel = { x:vel.x-normal.x*Math.min(0,speed), y:vel.y-normal.y*Math.min(0,speed), z:vel.z-normal.z*Math.min(0,speed) };
            }
          }
          body.pos = pos; body.vel = vel; body.grounded = grounded;
        },
      };
      const api: RulesPhysics = {
        ...movement,
        step(dt) {
          charge(8);
          if (!Number.isFinite(dt) || dt < 0) throw new Error('physics: dt must be finite and nonnegative');
          charge(PHYSICS_UNITS.step * count * Math.max(1, Math.ceil(dt * 300)));
          while (dt > .1) { world.step(.1); dt -= .1; }
          world.step(dt);
        },
      };
      let disposed = false, finalSave: number[] | undefined;
      return { api: brand(Object.freeze(api)), movement: brand(Object.freeze(movement)),
        save: () => finalSave ? [...finalSave] : Array.from(world.snapshot()),
        dispose: () => {
          if (disposed) return;
          try { finalSave = Array.from(world.snapshot()); } catch { /* A failed engine has no final checkpoint. */ }
          world.dispose(); disposed = true;
        },
      };
    } catch (error) { world.dispose(); throw error; }
  });
}
