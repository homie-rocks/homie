import { requireState, numbers, record } from './internal/Validate.ts';
/** Fixed-step navigation with pull-based mesh synchronization and explicit detach.
 * Tile sequence + polygon identity guard saved searches and corridors; edits only
 * restart requests touching replaced or rejected nodes, from retained progress.
 * Pending targets coalesce until the current search finishes. The pinned backend
 * resets requests unconditionally and uses a dense neighbour array: this wrapper
 * preserves requests, and scripts/runtime.mjs patches that array to a sparse hash.
 * All persistent bookkeeping is saved; steering scratch is rebuilt next tick. */
import { crowd, pathCorridor, localBoundary, obstacleAvoidance } from './internal/Backend.ts';
import type { crowd as CrowdTypes } from 'navcat/blocks';
import {
  DEFAULT_QUERY_FILTER,
  getNodeByRef,
  isValidNodeRef,
  createSlicedNodePathQuery,
} from 'navcat';
import { reachable } from './internal/Reachability.ts';
import { Mesh } from './Mesh.ts';
import { meshData, locate } from './internal/MeshData.ts';
import { pack, unpack } from './internal/Binary.ts';
import { type Point, type Vector } from './Query.ts';
import { axes, fromAxes, positive, distance } from './internal/Coordinates.ts';
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
  traversals: Record<string, number>;
  generations: Record<string, string>;
}
/** Audited against pinned blocks.js update order:
 * - neighbours are cleared for ALL states by updateNeighbours before any read;
 * - avoidance query counts reset in updateVelocityPlanning before WALKING reads;
 *   other states never sample it; debug data only records samples (not enabled).
 * Every other agent field is retained, including corners and steering vectors:
 * updateCorners skips pending requests, while updateSteering still reads corners.
 * Crowd-level counters, ordering, query budgets and all boundary/corridor state
 * are saved unfiltered. Active sliced-query pools retain object aliases.
 */
const scratch = new Set(['obstacleAvoidanceQuery', 'obstacleAvoidanceDebugData', 'neis']);
export class Crowd {
  #state: CrowdState;
  #mesh: Mesh | undefined;
  get mesh(): Mesh {
    if (!this.#mesh) throw new Error('nav: crowd is detached');
    return this.#mesh;
  }
  /** Constructor attaches; detach releases ownership and ends all access. */
  detach(): void { this.#mesh = undefined; }
  private sync(): void {
    if (this.#state.revision !== this.mesh.revision) this.invalidate();
  }
  constructor(
    mesh: Mesh,
    dt: number,
    maxRadius: number,
    options: CrowdOptions = {},
  ) {
    this.#mesh = mesh;
    positive(dt, 'fixed dt');
    positive(maxRadius, 'maximum radius');
    if (dt > 0.1) throw new Error(`nav: fixed dt ${dt} must be at most 0.1 seconds`);
    const m = meshData(mesh);
    if (maxRadius > m.config.radius)
      throw new Error(`nav: crowd radius ${maxRadius} exceeds baked clearance ${m.config.radius}`);
    const data = crowd.create(maxRadius);
    data.agentIdCounter = 1;
    data.agentPlacementHalfExtents = [...m.extent];
    if (options.searchIterations !== undefined) {
      positive(options.searchIterations, 'search iterations');
      if (!Number.isSafeInteger(options.searchIterations) || options.searchIterations > 8192)
        throw new Error(
          `nav: search iterations ${options.searchIterations} must be an integer up to 8192`,
        );
      data.quickSearchIterations =
        data.maxIterationsPerAgent =
        data.maxIterationsPerUpdate =
          options.searchIterations;
    }
    this.#state = {
      data,
      dt,
      tick: 0,
      revision: mesh.revision,
      targets: {},
      traversals: {},
      generations: {},
    };

  }
  get tick(): number {
    void this.mesh;
    return this.#state.tick;
  }
  ids(): number[] {
    void this.mesh;
    return Object.keys(this.#state.data.agents).map(Number);
  }
  add(at: Point, tune: AgentTune): number {
    this.sync();
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
      throw new Error(
        'nav: agent exceeds baked dimensions or has invalid separation: ' +
          `radius ${tune.radius} (maximum ${this.#state.data.maxAgentRadius}), ` +
          `height ${tune.height} (maximum ${m.config.height}), separation ${tune.separation} (minimum 0)`,
      );
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
    this.sync();
    delete this.#state.targets[id];
    delete this.#state.traversals[id];
    return crowd.removeAgent(this.#state.data, String(id));
  }
  target(id: number, to: Point): boolean {
    this.sync();
    const target = axes(to, this.mesh.up);
    const previous = this.#state.targets[id];
    const result = locate(this.mesh, target);
    const agent = this.#state.data.agents[id];
    if (!agent) return false;
    if (agent.state !== crowd.AgentState.WALKING) {
      this.#state.targets[id] = target;
      crowd.resetMoveTarget(this.#state.data, String(id));
      agent.slicedQuery = createSlicedNodePathQuery();
      return false;
    }
    if (
      !agent ||
      !result.success ||
      !reachable(this.mesh, locate(this.mesh, agent.position).nodeRef).has(result.nodeRef)
    )
      return false;
    if (previous && previous.every((v, i) => v === target[i])) return true;
    this.#state.targets[id] = target;
    // Coalesce a moving endpoint while a route is being found. Finish that search,
    // then extend its corridor to the latest requested endpoint at the next step.
    if (agent.targetRef === result.nodeRef && agent.targetState !== crowd.AgentTargetState.NONE) {
      agent.targetPosition = [...result.position];
      if (agent.slicedQuery.status !== 0) agent.slicedQuery.endPosition = [...result.position];
      if (agent.corridor.path.at(-1) === result.nodeRef) agent.corridor.target = [...result.position];
      return true;
    }
    if (agent.targetState === crowd.AgentTargetState.WAITING_FOR_PATH ||
        agent.targetState === crowd.AgentTargetState.WAITING_FOR_QUEUE) return true;
    if (agent.corridor.path.length && agent.targetState === crowd.AgentTargetState.VALID) {
      agent.targetRef = result.nodeRef;
      agent.targetPosition = [...result.position];
      agent.targetState = crowd.AgentTargetState.WAITING_FOR_QUEUE;
      return true;
    }
    return crowd.requestMoveTarget(this.#state.data, String(id), result.nodeRef, result.position);
  }
  stop(id: number): boolean {
    this.sync();
    delete this.#state.targets[id];
    return crowd.resetMoveTarget(this.#state.data, String(id));
  }
  setSpeed(id: number, speed: number): boolean {
    this.sync();
    positive(speed, 'speed');
    const agent = this.#state.data.agents[id];
    if (!agent) return false;
    agent.maxSpeed = speed;
    return true;
  }
  /** Explicit placement keeps identity, tune and requested destination. */
  place(id: number, at: Point): boolean {
    this.sync();
    const a = this.#state.data.agents[id];
    if (!a) return false;
    const p = locate(this.mesh, axes(at, this.mesh.up));
    if (!p.success) return false;
    a.position = [...p.position];
    a.velocity = [0, 0, 0];
    a.state = crowd.AgentState.WALKING;
    a.offMeshAnimation = null;
    delete this.#state.traversals[id];
    pathCorridor.reset(a.corridor, p.nodeRef, p.position);
    localBoundary.resetLocalBoundary(a.boundary);
    a.slicedQuery = createSlicedNodePathQuery();
    a.corners = [];
    crowd.resetMoveTarget(this.#state.data, String(id));
    const target = this.#state.targets[id];
    if (target) {
      const goal = locate(this.mesh, target);
      if (goal.success)
        crowd.requestMoveTarget(this.#state.data, String(id), goal.nodeRef, goal.position);
    }
    return true;
  }
  completeLink(id: number): boolean {
    this.sync();
    const completed = crowd.completeOffMeshConnection(this.#state.data, String(id));
    if (completed) this.finishLink(id, this.#state.data.agents[id]!.position);
    return completed;
  }
  private finishLink(id: number, end: Vector): void {
    delete this.#state.traversals[id];
    if (this.place(id, fromAxes(end, this.mesh.up))) return;
    const a = this.#state.data.agents[id]!;
    a.position = [...end];
    a.state = crowd.AgentState.INVALID;
    a.offMeshAnimation = null;
    a.corridor.path = [];
    a.corners = [];
    a.slicedQuery = createSlicedNodePathQuery();
    localBoundary.resetLocalBoundary(a.boundary);
    crowd.resetMoveTarget(this.#state.data, String(id));
  }
  agent(id: number): Agent | null {
    void this.mesh;
    const a = this.#state.data.agents[id];
    if (!a) return null;
    const m = meshData(this.mesh),
      ref = a.offMeshAnimation?.nodeRef;
    const backend =
      ref !== undefined && isValidNodeRef(m.nav, ref)
        ? getNodeByRef(m.nav, ref).offMeshConnectionId
        : undefined;
    const link =
      this.#state.traversals[id] ??
      (backend === undefined
        ? null
        : Number(Object.keys(m.links).find((key) => m.links[key] === backend) ?? 0) || null);
    return {
      position: fromAxes(a.position, this.mesh.up),
      velocity: fromAxes(a.velocity, this.mesh.up),
      status:
        a.state === crowd.AgentState.INVALID ||
        (this.#state.revision !== this.mesh.revision && !locate(this.mesh, a.position).success)
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
    void this.mesh;
    positive(tolerance, 'arrival tolerance');
    const a = this.#state.data.agents[id],
      target = this.#state.targets[id];
    return (
      !!a &&
      !!target &&
      (this.#state.revision === this.mesh.revision ||
        a.corridor.path.every(ref => this.#state.generations[ref] === this.generation(ref))) &&
      !a.targetPathIsPartial &&
      a.targetState === crowd.AgentTargetState.VALID &&
      a.state === crowd.AgentState.WALKING &&
      distance(a.position, a.targetPosition) <= tolerance
    );
  }
  private generation(ref: number): string {
    const nav = meshData(this.mesh).nav;
    if (!isValidNodeRef(nav, ref)) return '';
    const node = getNodeByRef(nav, ref);
    const tile = nav.tiles[node.tileId];
    return tile ? `${tile.tileX},${tile.tileY},${tile.tileLayer}:${tile.sequence}:${node.polyIndex}:${node.flags}`
      : `link:${node.offMeshConnectionId}:${ref}:${node.flags}`;
  }
  private captureGenerations(): void {
    const refs = new Set<number>();
    for (const a of Object.values(this.#state.data.agents)) {
      for (const ref of [...a.corridor.path, ...a.boundary.polys]) refs.add(ref);
      if (a.targetRef !== null) refs.add(a.targetRef);
      if (a.slicedQuery.status !== 0) {
        refs.add(a.slicedQuery.startNodeRef); refs.add(a.slicedQuery.endNodeRef);
        for (const nodes of Object.values(a.slicedQuery.nodes)) for (const node of nodes) refs.add(node.nodeRef);
      }
    }
    this.#state.generations = Object.fromEntries([...refs].sort((a, b) => a - b).map(ref => [ref, this.generation(ref)]));
  }
  /** All mesh mutations funnel here before stale references can be observed.
   * Completed, valid corridors keep moving. Every search pool and boundary is
   * checked; invalid corridors restart from position. Traversals retain only
   * their endpoint coordinates and public identity if their link disappears.
   */
  private invalidate(): void {
    const s = this.#state,
      m = meshData(this.mesh);
    const valid = (ref: number): boolean =>
      isValidNodeRef(m.nav, ref) && DEFAULT_QUERY_FILTER.passFilter(ref, m.nav) &&
      (s.generations[ref] === undefined || s.generations[ref] === this.generation(ref));
    for (const id of Object.keys(s.data.agents).map(Number)) {
      const a = s.data.agents[id]!;
      const q = a.slicedQuery;
      let restart = q.status !== 0 && (
        !valid(q.startNodeRef) || !valid(q.endNodeRef) ||
        Object.values(q.nodes).some(nodes => nodes.some(node => !valid(node.nodeRef))));
      if (restart) a.slicedQuery = createSlicedNodePathQuery();
      if (!a.boundary.polys.every(valid)) localBoundary.resetLocalBoundary(a.boundary);
      a.neis = [];
      const animation = a.offMeshAnimation;
      if (animation && !valid(animation.nodeRef)) animation.nodeRef = -1;
      const broken =
        !a.corridor.path.length ||
        !a.corridor.path.every(valid) ||
        a.state === crowd.AgentState.INVALID;
      if (broken) {
        const floor = locate(this.mesh, animation ? animation.endPosition : a.position);
        pathCorridor.reset(
          a.corridor,
          floor.success ? floor.nodeRef : -1,
          floor.success ? floor.position : a.position,
        );
        if (!floor.success) a.corridor.path = [];
        a.corners = [];
        restart = true;
        if (!animation) {
          a.state = floor.success ? crowd.AgentState.WALKING : crowd.AgentState.INVALID;
          if (floor.success) a.position = [...floor.position];
          else a.velocity = [0, 0, 0];
          delete s.traversals[id];
        }
      }
      if (
        a.corners.some(
          (corner) => corner.nodeRef !== null && corner.nodeRef !== -1 && !valid(corner.nodeRef),
        )
      ) {
        a.corners = [];
        restart = true;
      }
      if (a.targetRef !== null && !valid(a.targetRef)) restart = true;
      const target = s.targets[id];
      if (restart || (target && a.targetState === crowd.AgentTargetState.NONE)) {
        a.slicedQuery = createSlicedNodePathQuery();
        crowd.resetMoveTarget(s.data, String(id));
        if (target) {
          const goal = locate(this.mesh, target);
          if (goal.success && a.corridor.path.length) {
            crowd.requestMoveTarget(s.data, String(id), goal.nodeRef, goal.position);
            a.targetState = crowd.AgentTargetState.WAITING_FOR_QUEUE;
          }
        }
      }
    }
    s.revision = this.mesh.revision;
    this.captureGenerations();
  }
  step(): void {
    this.sync();
    const s = this.#state,
      m = meshData(this.mesh);
    if (s.revision !== this.mesh.revision) this.invalidate();
    const traversing = new Map(
      Object.entries(s.data.agents)
        .filter(([, a]) => a.offMeshAnimation)
        .map(([id, a]) => [id, a.offMeshAnimation!.endPosition]),
    );
    crowd.update(s.data, m.nav, s.dt);
    for (const [id, end] of traversing)
      if (!s.data.agents[id]!.offMeshAnimation) this.finishLink(Number(id), end);
    for (const id in s.data.agents) {
      const agent = s.data.agents[id]!;
      if (agent.state !== crowd.AgentState.OFFMESH) {
        delete s.traversals[id];
        continue;
      }
      const ref = agent.offMeshAnimation?.nodeRef;
      if (s.traversals[id] === undefined && ref !== undefined && isValidNodeRef(m.nav, ref)) {
        const backend = getNodeByRef(m.nav, ref).offMeshConnectionId;
        const link = Object.keys(m.links).find((key) => m.links[key] === backend);
        if (link !== undefined) s.traversals[id] = Number(link);
      }
    }
    for (const [id, target] of Object.entries(s.targets)) {
      const a = s.data.agents[id];
      if (a?.state !== crowd.AgentState.WALKING || a.targetState !== crowd.AgentTargetState.VALID) continue;
      const goal = locate(this.mesh, target);
      if (goal.success && goal.nodeRef !== a.targetRef) {
        a.targetRef = goal.nodeRef;
        a.targetPosition = [...goal.position];
        a.targetState = crowd.AgentTargetState.WAITING_FOR_QUEUE;
      }
    }
    s.tick++;
    this.captureGenerations();
  }
  /** No tiles or mesh payload. Restore deliberately requires the shared mesh. */
  save(): Uint8Array {
    this.sync();
    const agents: Record<string, unknown> = {};
    for (const [id, agent] of Object.entries(this.#state.data.agents)) {
      const fields = Object.fromEntries(Object.entries(agent).filter(([key]) => !scratch.has(key)));
      fields.obstacleAvoidance = { ...agent.obstacleAvoidance };
      // A finalized query's old node pool is scratch. Active heaps retain aliases.
      fields.slicedQuery = agent.slicedQuery.status === 0 ? null : agent.slicedQuery;
      agents[id] = fields;
    }
    return pack('crowd', {
      identity: unpack('identity', this.mesh.identity()),
      state: { ...this.#state, data: { ...this.#state.data, agents } },
    });
  }
  static restore(bytes: Uint8Array, mesh: Mesh): Crowd {
    try {
      return Crowd.restoreData(bytes, mesh);
    } catch (error) {
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
    requireState(Number.isSafeInteger(s.tick) && s.tick >= 0 && Number.isSafeInteger(s.revision));
    record(s.generations);
    for (const value of Object.values(s.generations)) requireState(typeof value === 'string');
    record(s.targets);
    record(s.traversals);
    record(s.data.agents);
    numbers(s.data.agentPlacementHalfExtents, 3);
    for (const n of [
      s.data.agentIdCounter,
      s.data.maxIterationsPerUpdate,
      s.data.maxIterationsPerAgent,
      s.data.quickSearchIterations,
    ])
      requireState(Number.isSafeInteger(n) && n > 0);
    const nav = meshData(mesh).nav;
    const validRef = (ref: number): boolean =>
      Number.isSafeInteger(ref) && isValidNodeRef(nav, ref);
    for (const [id, target] of Object.entries(s.targets)) {
      requireState(s.data.agents[id]);
      numbers(target, 3);
      axes(target);
    }
    for (const [id, link] of Object.entries(s.traversals))
      requireState(s.data.agents[id] && Number.isSafeInteger(link) && link > 0);
    for (const id of Object.keys(s.data.agents))
      requireState(
        Number.isSafeInteger(Number(id)) && Number(id) > 0 && Number(id) < s.data.agentIdCounter,
      );
    for (const a of Object.values(s.data.agents)) {
      record(a);
      axes(a.position);
      if (a.state === crowd.AgentState.WALKING) requireState(locate(mesh, a.position).success);
      axes(a.targetPosition);
      for (const p of [
        a.position,
        a.velocity,
        a.desiredVelocity,
        a.newVelocity,
        a.displacement,
        a.targetPosition,
      ])
        numbers(p, 3);
      for (const n of [
        a.radius,
        a.height,
        a.maxAcceleration,
        a.maxSpeed,
        a.collisionQueryRange,
        a.pathOptimizationRange,
        a.separationWeight,
        a.desiredSpeed,
        a.targetPathfindingTime,
        a.topologyOptTime,
      ])
        requireState(Number.isFinite(n));
      requireState(
        a.radius > 0 &&
          a.radius <= s.data.maxAgentRadius &&
          a.height > 0 &&
          a.height <= mesh.config.height &&
          a.maxSpeed > 0 &&
          a.maxAcceleration > 0 &&
          a.collisionQueryRange > 0 &&
          a.separationWeight >= 0,
      );
      requireState(
        [0, 1, 2].includes(a.state) &&
          Number.isSafeInteger(a.targetState) &&
          a.targetState >= 0 &&
          a.targetState <= 6 &&
          a.queryFilter === DEFAULT_QUERY_FILTER,
      );
      requireState(
        typeof a.autoTraverseOffMeshConnections === 'boolean' &&
          typeof a.targetReplan === 'boolean' &&
          typeof a.targetPathIsPartial === 'boolean',
      );
      record(a.corridor);
      numbers(a.corridor.position, 3);
      numbers(a.corridor.target, 3);
      numbers(a.corridor.path);
      requireState(a.corridor.path.every(validRef));
      requireState(a.targetRef === null || a.targetRef === -1 || validRef(a.targetRef));
      record(a.boundary);
      numbers(a.boundary.center, 3);
      numbers(a.boundary.polys);
      requireState(a.boundary.polys.every(validRef));
      requireState(Array.isArray(a.boundary.segments) && Array.isArray(a.corners));
      for (const seg of a.boundary.segments) {
        numbers(seg.s, 6);
        requireState(Number.isFinite(seg.d));
      }
      for (const corner of a.corners) {
        numbers(corner.position, 3);
        requireState(Number.isSafeInteger(corner.flags));
        requireState(corner.nodeRef === null || corner.nodeRef === -1 || validRef(corner.nodeRef));
      }
      record(a.obstacleAvoidance);
      for (const name of [
        'velBias',
        'weightDesVel',
        'weightCurVel',
        'weightSide',
        'weightToi',
        'horizTime',
        'gridSize',
        'adaptiveDivs',
        'adaptiveRings',
        'adaptiveDepth',
      ] as const)
        requireState(a.obstacleAvoidance[name] === crowd.DEFAULT_OBSTACLE_AVOIDANCE_PARAMS[name]);
      if (a.offMeshAnimation) {
        const anim = a.offMeshAnimation;
        numbers(anim.startPosition, 3);
        numbers(anim.endPosition, 3);
        requireState(
          Number.isFinite(anim.t) &&
            anim.t >= 0 &&
            Number.isFinite(anim.duration) &&
            (anim.duration >= 0 || (!a.autoTraverseOffMeshConnections && anim.duration === -1)),
        );
        requireState(anim.nodeRef === -1 || validRef(anim.nodeRef));
      }
      if (a.slicedQuery) {
        const q = a.slicedQuery;
        requireState(Number.isInteger(q.status) && q.filter === DEFAULT_QUERY_FILTER);
        numbers(q.startPosition, 3);
        numbers(q.endPosition, 3);
        record(q.nodes);
        requireState(Array.isArray(q.openList));
        requireState(validRef(q.startNodeRef) && validRef(q.endNodeRef));
        requireState(
          q.status > 0 &&
            q.status <= 31 &&
            (q.raycastLimitSqr === null ||
              (Number.isFinite(q.raycastLimitSqr) && q.raycastLimitSqr >= 0)),
        );
        const members = new Set(Object.values(q.nodes).flat());
        requireState(
          q.openList.every((node) => members.has(node)) &&
            (q.lastBestNode === null || members.has(q.lastBestNode)),
        );
        for (const [ref, nodes] of Object.entries(q.nodes)) {
          requireState(Array.isArray(nodes));
          for (const node of nodes) {
            numbers(node.position, 3);
            requireState(
              Number.isFinite(node.cost) &&
                Number.isFinite(node.total) &&
                validRef(node.nodeRef) &&
                String(node.nodeRef) === ref &&
                Number.isSafeInteger(node.state) &&
                Number.isSafeInteger(node.flags),
            );
            if (node.parentNodeRef !== null)
              requireState(
                q.nodes[node.parentNodeRef]?.some((parent) => parent.state === node.parentState),
              );
          }
        }
      }
      if (a.slicedQuery) {
        const pool = a.slicedQuery.nodes;
        const complete = new Set<object>();
        for (const start of Object.values(pool).flat()) {
          const chain = new Set<object>();
          let node: typeof start | undefined = start;
          while (node && !complete.has(node)) {
            requireState(!chain.has(node));
            chain.add(node);
            const parentRef: number | null = node.parentNodeRef;
            const parentState: number | null = node.parentState;
            node =
              parentRef === null
                ? undefined
                : pool[parentRef]?.find((n) => n.state === parentState);
          }
          for (const member of chain) complete.add(member);
        }
      }
      if (!a.slicedQuery) a.slicedQuery = createSlicedNodePathQuery();
      a.obstacleAvoidanceQuery = obstacleAvoidance.createObstacleAvoidanceQuery(32, 32);
      a.neis = [];
    }
    result.#state = s;
    return result;
  }
}
