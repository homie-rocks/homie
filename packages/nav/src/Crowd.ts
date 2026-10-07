/** Fixed steps over Detour-style corridor following and sampled local avoidance. */
import { crowd } from 'navcat/blocks';
import { DEFAULT_QUERY_FILTER } from 'navcat';
import { Mesh } from './Mesh.ts';
import { pack, unpack } from './State.ts';
import { point, positive, distance, type Point } from './Query.ts';
export interface AgentTune {
  radius: number; height: number; speed: number; acceleration: number;
  /** Neighbour search distance, metres. */
  neighbours: number; separation: number;
}
interface CrowdState { data: crowd.Crowd; dt: number; tick: number; revision: number }
export class Crowd {
  readonly state: CrowdState;
  constructor(readonly mesh: Mesh, dt: number, maxRadius: number) {
    positive(dt, 'fixed dt'); positive(maxRadius, 'maximum radius');
    if (dt > 0.1) throw new Error('nav: fixed dt must be at most 0.1 seconds');
    if (maxRadius > mesh.state.config.radius) throw new Error('nav: crowd radius exceeds baked clearance');
    this.state = { data: crowd.create(maxRadius), dt, tick: 0, revision: mesh.revision };
    this.state.data.agentPlacementHalfExtents = [...mesh.state.extent];
  }
  add(at: Point, t: AgentTune): string {
    point(at);
    for (const k of ['radius', 'height', 'speed', 'acceleration', 'neighbours'] as const) positive(t[k], k);
    if (!Number.isFinite(t.separation) || t.separation < 0 || t.radius > this.state.data.maxAgentRadius || t.height > this.mesh.state.config.height) throw new Error('nav: agent exceeds baked dimensions or has invalid separation');
    if (!this.mesh.locate(at).success) throw new Error('nav: agent has no floor');
    return crowd.addAgent(this.state.data, this.mesh.state.nav, [...at], { radius: t.radius, height: t.height, maxSpeed: t.speed, maxAcceleration: t.acceleration, collisionQueryRange: t.neighbours, separationWeight: t.separation, updateFlags: 31, queryFilter: DEFAULT_QUERY_FILTER, autoTraverseOffMeshConnections: true });
  }
  remove(id: string): boolean { return crowd.removeAgent(this.state.data, id); }
  target(id: string, to: Point): boolean {
    const p = this.mesh.locate(to);
    return p.success && crowd.requestMoveTarget(this.state.data, id, p.nodeRef, p.position);
  }
  stop(id: string): boolean { return crowd.resetMoveTarget(this.state.data, id); }
  /** Copies for rendering or game state; no backend object can be changed through them. */
  agent(id: string): { position: Float64Array; velocity: Float64Array; offMesh: boolean; partial: boolean } | null {
    const a = this.state.data.agents[id];
    return a ? { position: new Float64Array(a.position), velocity: new Float64Array(a.velocity), offMesh: a.state === crowd.AgentState.OFFMESH, partial: a.targetPathIsPartial } : null;
  }
  arrived(id: string, tolerance: number): boolean {
    positive(tolerance, 'arrival tolerance');
    const a = this.state.data.agents[id];
    return !!a && !a.targetPathIsPartial && a.targetState === crowd.AgentTargetState.VALID && a.state === crowd.AgentState.WALKING && distance(a.position, a.targetPosition) <= tolerance;
  }
  /** Exactly one tick; there is no elapsed-time accumulator or wall clock. */
  step(): void {
    if (this.state.revision !== this.mesh.revision) {
      // Re-acquire targets after tile replacement. Old polygon refs have expired.
      for (const id of Object.keys(this.state.data.agents)) {
        const a = this.state.data.agents[id]!;
        if (a.targetState !== crowd.AgentTargetState.NONE) {
          const p = this.mesh.locate(a.targetPosition);
          if (p.success) crowd.requestMoveTarget(this.state.data, id, p.nodeRef, p.position);
          else crowd.resetMoveTarget(this.state.data, id);
        }
      }
      this.state.revision = this.mesh.revision;
    }
    crowd.update(this.state.data, this.mesh.state.nav, this.state.dt); this.state.tick++;
  }
  /** Includes mesh, obstacles, tile salts, sliced searches, avoidance and link progress. */
  save(): Uint8Array { return pack('crowd', { mesh: this.mesh.save(), state: this.state }); }
  static restore(bytes: Uint8Array): Crowd {
    const s = unpack<{ mesh: Uint8Array; state: CrowdState }>('crowd', bytes);
    const c = new Crowd(Mesh.restore(s.mesh), s.state.dt, s.state.data.maxAgentRadius);
    Object.assign(c.state, s.state); return c;
  }
}
