/** Fixed-step navigation. Only persistent fields are saved; avoidance candidates,
 * neighbour lists and steering scratch are rebuilt at the next tick. */
import { crowd, pathCorridor, localBoundary, obstacleAvoidance } from './internal/Backend.ts';
import type { crowd as CrowdTypes } from 'navcat/blocks';
import { DEFAULT_QUERY_FILTER, getNodeByRef, isValidNodeRef } from 'navcat';
import { Mesh } from './Mesh.ts';
import { meshData, locate } from './internal/MeshData.ts';
import { pack, unpack } from './State.ts';
import { axes, positive, distance, type Point, type Vector } from './Query.ts';
export interface AgentTune {
  radius: number;
  height: number;
  speed: number;
  acceleration: number;
  neighbours: number;
  separation: number;
  /** Manual links pause until completeLink(id), including across save/restore. */
  manualLinks?: boolean;
}
export interface Agent {
  position: Vector;
  velocity: Vector;
  status: 'walking' | 'link' | 'stranded';
  link: number | null;
  offMesh: boolean;
  partial: boolean;
}
export interface CrowdOptions {
  searchIterations?: number;
}
interface CrowdState {
  data: CrowdTypes.Crowd;
  dt: number;
  tick: number;
  revision: number;
  targets: Record<string, Vector>;
}
const scratch = new Set([
  'obstacleAvoidanceQuery',
  'obstacleAvoidanceDebugData',
  'neis',
  'corners',
  'desiredSpeed',
  'desiredVelocity',
  'newVelocity',
  'displacement',
]);
export class Crowd {
  #state: CrowdState;
  constructor(
    readonly mesh: Mesh,
    dt: number,
    maxRadius: number,
    options: CrowdOptions = {},
  ) {
    positive(dt, 'fixed dt');
    positive(maxRadius, 'maximum radius');
    if (dt > 0.1) throw new Error('nav: fixed dt must be at most 0.1 seconds');
    const m = meshData(mesh);
    if (maxRadius > m.config.radius) throw new Error('nav: crowd radius exceeds baked clearance');
    const data = crowd.create(maxRadius);
    data.agentIdCounter = 1;
    data.agentPlacementHalfExtents = [...m.extent];
    if (options.searchIterations !== undefined) {
      positive(options.searchIterations, 'search iterations');
      if (!Number.isSafeInteger(options.searchIterations) || options.searchIterations > 8192)
        throw new Error('nav: search iterations must be an integer up to 8192');
      data.quickSearchIterations =
        data.maxIterationsPerAgent =
        data.maxIterationsPerUpdate =
          options.searchIterations;
    }
    this.#state = { data, dt, tick: 0, revision: mesh.revision, targets: {} };
  }
  get tick(): number {
    return this.#state.tick;
  }
  ids(): number[] {
    return Object.keys(this.#state.data.agents).map(Number);
  }
  add(at: Point, tune: AgentTune): number {
    for (const key of ['radius', 'height', 'speed', 'acceleration', 'neighbours'] as const)
      positive(tune[key], key);
    const m = meshData(this.mesh),
      position = axes(at, this.mesh.up);
    if (
      !Number.isFinite(tune.separation) ||
      tune.separation < 0 ||
      tune.radius > this.#state.data.maxAgentRadius ||
      tune.height > m.config.height
    )
      throw new Error('nav: agent exceeds baked dimensions or has invalid separation');
    if (!locate(this.mesh, position).success) throw new Error('nav: agent has no floor');
    return Number(
      crowd.addAgent(this.#state.data, m.nav, position, {
        radius: tune.radius,
        height: tune.height,
        maxSpeed: tune.speed,
        maxAcceleration: tune.acceleration,
        collisionQueryRange: tune.neighbours,
        separationWeight: tune.separation,
        updateFlags: 31,
        queryFilter: DEFAULT_QUERY_FILTER,
        autoTraverseOffMeshConnections: !tune.manualLinks,
      }),
    );
  }
  remove(id: number): boolean {
    delete this.#state.targets[id];
    return crowd.removeAgent(this.#state.data, String(id));
  }
  target(id: number, to: Point): boolean {
    const target = axes(to, this.mesh.up),
      result = locate(this.mesh, target);
    const agent = this.#state.data.agents[id];
    if (
      !agent ||
      !result.success ||
      !this.mesh.path(axes(agent.position, this.mesh.up), to).complete
    )
      return false;
    this.#state.targets[id] = target;
    return crowd.requestMoveTarget(this.#state.data, String(id), result.nodeRef, result.position);
  }
  stop(id: number): boolean {
    delete this.#state.targets[id];
    return crowd.resetMoveTarget(this.#state.data, String(id));
  }
  setSpeed(id: number, speed: number): boolean {
    positive(speed, 'speed');
    const agent = this.#state.data.agents[id];
    if (!agent) return false;
    agent.maxSpeed = speed;
    return true;
  }
  /** Explicit placement keeps identity, tune and requested destination. */
  place(id: number, at: Point): boolean {
    const a = this.#state.data.agents[id];
    if (!a) return false;
    const p = locate(this.mesh, axes(at, this.mesh.up));
    if (!p.success) return false;
    a.position = [...p.position];
    a.velocity = [0, 0, 0];
    a.state = crowd.AgentState.WALKING;
    a.offMeshAnimation = null;
    pathCorridor.reset(a.corridor, p.nodeRef, p.position);
    localBoundary.resetLocalBoundary(a.boundary);
    const target = this.#state.targets[id];
    if (target) {
      const goal = locate(this.mesh, target);
      if (goal.success)
        crowd.requestMoveTarget(this.#state.data, String(id), goal.nodeRef, goal.position);
    }
    return true;
  }
  completeLink(id: number): boolean {
    return crowd.completeOffMeshConnection(this.#state.data, String(id));
  }
  agent(id: number): Agent | null {
    const a = this.#state.data.agents[id];
    if (!a) return null;
    const m = meshData(this.mesh),
      ref = a.offMeshAnimation?.nodeRef;
    const backend =
      ref !== undefined && isValidNodeRef(m.nav, ref)
        ? getNodeByRef(m.nav, ref).offMeshConnectionId
        : undefined;
    const link =
      backend === undefined
        ? null
        : Number(Object.keys(m.links).find((key) => m.links[key] === backend) ?? 0) || null;
    return {
      position: axes(a.position, this.mesh.up),
      velocity: axes(a.velocity, this.mesh.up),
      status:
        a.state === crowd.AgentState.INVALID
          ? 'stranded'
          : a.state === crowd.AgentState.OFFMESH
            ? 'link'
            : 'walking',
      link,
      offMesh: a.state === crowd.AgentState.OFFMESH,
      partial: a.targetPathIsPartial,
    };
  }
  arrived(id: number, tolerance: number): boolean {
    positive(tolerance, 'arrival tolerance');
    const a = this.#state.data.agents[id],
      target = this.#state.targets[id];
    return (
      !!a &&
      !!target &&
      !a.targetPathIsPartial &&
      a.targetState === crowd.AgentTargetState.VALID &&
      a.state === crowd.AgentState.WALKING &&
      distance(a.position, a.targetPosition) <= tolerance
    );
  }
  step(): void {
    const s = this.#state,
      m = meshData(this.mesh);
    if (s.revision !== this.mesh.revision) {
      // Only recover stranded agents and lost requests. The backend validates
      // each live corridor itself; distant edits do not reset valid searches.
      for (const id of this.ids()) {
        const a = s.data.agents[id]!;
        const floor = a.corridor.path[0];
        if (
          a.state === crowd.AgentState.WALKING &&
          floor !== undefined &&
          isValidNodeRef(m.nav, floor) &&
          !DEFAULT_QUERY_FILTER.passFilter(floor, m.nav)
        )
          a.state = crowd.AgentState.INVALID;
        if (a.state === crowd.AgentState.INVALID) this.place(id, axes(a.position, this.mesh.up));
        const target = s.targets[id];
        if (target) {
          const p = locate(this.mesh, target);
          if (p.success && (a.targetState === crowd.AgentTargetState.NONE || distance(p.position, a.targetPosition) > 1e-9)) crowd.requestMoveTarget(s.data, String(id), p.nodeRef, p.position);
        }
      }
      s.revision = this.mesh.revision;
    }
    crowd.update(s.data, m.nav, s.dt);
    s.tick++;
  }
  /** No tiles or mesh payload. Restore deliberately requires the shared mesh. */
  save(): Uint8Array {
    const agents: Record<string, unknown> = {};
    for (const [id, agent] of Object.entries(this.#state.data.agents))
      agents[id] = Object.fromEntries(Object.entries(agent).filter(([key]) => !scratch.has(key)));
    return pack('crowd', {
      identity: unpack('identity', this.mesh.identity()),
      state: { ...this.#state, data: { ...this.#state.data, agents } },
    });
  }
  static restore(bytes: Uint8Array, mesh: Mesh): Crowd {
    try { return Crowd.restoreData(bytes, mesh); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('nav:')) throw error;
      throw new Error('nav: malformed crowd snapshot');
    }
  }
  private static restoreData(bytes: Uint8Array, mesh: Mesh): Crowd {
    const saved = unpack<{ identity: unknown; state: CrowdState }>('crowd', bytes);
    const identity = mesh.identity(),
      expected = pack('identity', saved.identity);
    if (identity.length !== expected.length || identity.some((v, i) => v !== expected[i]))
      throw new Error('nav: crowd mesh identity differs');
    const s = saved.state,
      result = new Crowd(mesh, s.dt, s.data.maxAgentRadius);
    for (const a of Object.values(s.data.agents)) {
      a.obstacleAvoidanceQuery = obstacleAvoidance.createObstacleAvoidanceQuery(32, 32);
      a.neis = [];
      a.corners = [];
      a.desiredSpeed = 0;
      a.desiredVelocity = [0, 0, 0];
      a.newVelocity = [0, 0, 0];
      a.displacement = [0, 0, 0];
    }
    result.#state = s;
    return result;
  }
}
