/** Loaded tiles, runtime carving and the common query interface. No renderer. */
import { reachable } from './internal/Reachability.ts';
import * as nav from 'navcat';
import { checkConfig, checkObstacle, type BakeConfig, type Obstacle } from './Bake.ts';
import {
  axes,
  fromAxes,
  axisExtents,
  axisBounds,
  vector,
  distance,
  draw,
  point,
  positive,
  type Vector,
  type Up,
  type Point,
  type Path,
  type Ray,
  type NavigationQuery,
} from './Query.ts';
import { hash, pack, unpack } from './State.ts';
import { meshStates, locate, type MeshState } from './internal/MeshData.ts';
import { decodeTile, finishTile, type TileData } from './internal/Tile.ts';
function copyConfig(config: BakeConfig): BakeConfig {
  return {
    ...config,
    origin: vector(config.origin),
    ...(config.doorRegions
      ? {
          doorRegions: config.doorRegions.map((box) => ({
            ...box,
            min: vector(box.min),
            max: vector(box.max),
          })),
        }
      : {}),
  };
}
export interface MeshOptions {
  /** Retained packed voxel budgets; increase for large editable worlds. */
  maxRetainedCells?: number;
  maxRetainedSpans?: number;
}
export class Mesh implements NavigationQuery {
  #state: MeshState;
  #limits: Required<MeshOptions>;
  #retainedSpans = 0;
  #retainedCells = 0;
  #identity: { revision: number; bytes: Uint8Array } | undefined;
  get up(): Up {
    return this.#state.config.up ?? 'y';
  }
  get config(): BakeConfig {
    return copyConfig(this.#state.config);
  }
  constructor(config: BakeConfig, queryHalfExtents: Point, options: MeshOptions = {}) {
    this.#limits = { maxRetainedCells: options.maxRetainedCells ?? 1_000_000,
      maxRetainedSpans: options.maxRetainedSpans ?? 1_000_000 };
    for (const value of Object.values(this.#limits))
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('nav: invalid retention budget');
    checkConfig(config);
    point(queryHalfExtents);
    vector(queryHalfExtents).forEach((v) => positive(v, 'query half extent'));
    const n = nav.createNavMesh();
    n.origin = axes(config.origin, config.up);
    n.tileWidth = n.tileHeight = config.cellSize * config.tileCells;
    this.#state = {
      config: copyConfig(config),
      extent: axisExtents(queryHalfExtents, config.up),
      nav: n,
      tiles: {},
      hashes: {},
      obstacles: {},
      links: {},
      doors: {},
      nextId: 1,
      revision: 0,
    };
    meshStates.set(this, this.#state);
  }
  get revision(): number {
    return this.#state.revision;
  }
  /** Loaded areas only are reachable. Matching global origin/config prevents bad seams. */
  loadTile(bytes: Uint8Array): { warnings: string[] } {
    const t = decodeTile(bytes);
    checkConfig(t.config);
    const expected = this.#state.config;
    const normalized = (c: BakeConfig) => ({
      ...c,
      up: c.up ?? 'y',
      minRegionCells: c.minRegionCells ?? 8,
      mergeRegionCells: c.mergeRegionCells ?? 20,
      doorRegions: c.doorRegions ?? [],
    });
    const a = normalized(expected),
      b = normalized(t.config);
    if (
      Object.keys(a).some((key) => {
        const k = key as keyof BakeConfig;
        return k === 'origin'
          ? vector(a.origin).some((v, i) => v !== b.origin[i])
          : k === 'retainSpans'
            ? false
            : k === 'doorRegions'
              ? hash(pack('regions', a[k] ?? [])) !== hash(pack('regions', b[k] ?? []))
              : a[k] !== b[k];
      })
    )
      throw new Error('nav: tile configuration differs from mesh');
    const key = `${t.x},${t.z}`;
    const previous = this.#state.tiles[key]?.compact;
    const spanCount =
      this.#retainedSpans - (previous?.spanCount ?? 0) + (t.compact?.spanCount ?? 0);
    const cellCount =
      this.#retainedCells -
      (previous ? previous.width * previous.height : 0) +
      (t.compact ? t.compact.width * t.compact.height : 0);
    this.checkRetention(spanCount, cellCount);
    const obstacles = this.overlapping(t);
    const tile = obstacles.length ? finishTile(t, obstacles) : t.baked;
    nav.removeTile(this.#state.nav, t.x, t.z, 0);
    if (tile) nav.addTile(this.#state.nav, tile);
    this.#retainedSpans = spanCount;
    this.#retainedCells = cellCount;
    this.#state.tiles[key] = t;
    this.#state.hashes[key] = hash(bytes);
    this.changed();
    this.applyDoors();
    return { warnings: this.seamsAt(t.x, t.z) };
  }
  unloadTile(x: number, z: number): boolean {
    const key = `${x},${z}`;
    if (!(key in this.#state.tiles)) return false;
    nav.removeTile(this.#state.nav, x, z, 0);
    const compact = this.#state.tiles[key]!.compact;
    this.#retainedSpans -= compact?.spanCount ?? 0;
    this.#retainedCells -= compact ? compact.width * compact.height : 0;
    delete this.#state.tiles[key];
    delete this.#state.hashes[key];
    this.changed();
    return true;
  }
  private rebuild(changes: readonly Obstacle[]): void {
    for (const data of Object.values(this.#state.tiles)) {
      if (!changes.some(obstacle => this.overlaps(data, obstacle))) continue;
      const obstacles = this.overlapping(data);
      const tile = obstacles.length ? finishTile(data, obstacles) : data.baked;
      nav.removeTile(this.#state.nav, data.x, data.z, 0);
      if (tile) nav.addTile(this.#state.nav, tile);
    }
    this.applyDoors();
  }
  /** Synchronous carving of affected loaded tiles; call between fixed steps. */
  addObstacle(obstacle: Obstacle): number {
    return this.addObstacles([obstacle])[0]!;
  }
  /** Validate the whole batch, then rebuild each affected tile once. */
  addObstacles(obstacles: readonly Obstacle[]): number[] {
    const changes = obstacles.map(obstacle => {
      checkObstacle(obstacle);
      return { ...obstacle, ...axisBounds(obstacle.min, obstacle.max, this.up) };
    });
    for (const tile of Object.values(this.#state.tiles))
      if (!tile.compact && changes.some(obstacle => this.overlaps(tile, obstacle)))
        throw new Error('nav: obstacle touches a tile without carve spans');
    if (!changes.length) return [];
    const ids = changes.map(obstacle => {
      const id = this.#state.nextId++;
      this.#state.obstacles[id] = obstacle;
      return id;
    });
    this.rebuild(changes);
    this.changed();
    return ids;
  }
  removeObstacle(id: number): boolean {
    return this.removeObstacles([id]);
  }
  /** An unknown id rejects the entire batch without changing the mesh. */
  removeObstacles(ids: readonly number[]): boolean {
    const unique = [...new Set(ids)];
    if (unique.some(id => !this.#state.obstacles[id])) return false;
    if (!unique.length) return true;
    const changes = unique.map(id => this.#state.obstacles[id]!);
    for (const id of unique) delete this.#state.obstacles[id];
    this.rebuild(changes);
    this.changed();
    return true;
  }
  addLink(from: Point, to: Point, radius: number, bidirectional: boolean): number {
    point(from);
    point(to);
    positive(radius, 'link radius');
    const start = axes(from, this.up),
      end = axes(to, this.up);
    const endpointHasFloor = (p: Vector) =>
      nav.findNearestPoly(
        nav.createFindNearestPolyResult(),
        this.#state.nav,
        p,
        [radius, radius, radius],
        nav.DEFAULT_QUERY_FILTER,
      ).success;
    if (!endpointHasFloor(start) || !endpointHasFloor(end))
      throw new Error('nav: link endpoint has no floor within its radius');
    if (typeof bidirectional !== 'boolean') throw new Error('nav: link direction must be boolean');
    const id = this.#state.nextId++;
    this.#state.links[id] = nav.addOffMeshConnection(this.#state.nav, {
      start,
      end,
      radius,
      direction: bidirectional ? 1 : 0,
      flags: 1,
      area: 0,
    });
    this.changed();
    return id;
  }
  removeLink(id: number): boolean {
    const backend = this.#state.links[id];
    if (backend === undefined) return false;
    nav.removeOffMeshConnection(this.#state.nav, backend);
    delete this.#state.links[id];
    this.changed();
    return true;
  }
  /** Disable doors without changing the connection's identity. */
  setLinkEnabled(id: number, enabled: boolean): boolean {
    const backend = this.#state.links[id];
    const link = backend === undefined ? undefined : this.#state.nav.offMeshConnections[backend];
    if (!link) return false;
    link.flags = enabled ? 1 : 0;
    nav.reconnectOffMeshConnection(this.#state.nav, link);
    this.changed();
    return true;
  }
  private reachable(from: Point): Set<number> {
    const a = locate(this, axes(from, this.up));
    return a.success ? reachable(this, a.nodeRef) : new Set();
  }

  nearest(p: Point, from?: Point): Vector | null {
    point(p);
    if (!from) {
      const a = locate(this, axes(p, this.up));
      return a.success ? fromAxes(a.position, this.up) : null;
    }
    let best: Vector | null = null,
      d = Infinity;
    for (const ref of this.reachable(from)) {
      const n = nav.getNodeByRef(this.#state.nav, ref);
      if (n.type !== nav.NodeType.POLY) continue;
      const r = nav.getClosestPointOnPoly(
        nav.createGetClosestPointOnPolyResult(),
        this.#state.nav,
        ref,
        axes(p, this.up),
      );
      const nd = distance(p, fromAxes(r.position, this.up));
      if (r.success && nd < d) {
        best = fromAxes(r.position, this.up);
        d = nd;
      }
    }
    return best;
  }
  path(from: Point, to: Point): Path {
    point(from);
    point(to);
    const r = nav.findPath(
      this.#state.nav,
      axes(from, this.up),
      axes(to, this.up),
      this.#state.extent,
      nav.DEFAULT_QUERY_FILTER,
    );
    return {
      complete: r.success && !!(r.flags & nav.FindPathResultFlags.COMPLETE_PATH),
      points: r.path.map((p) => fromAxes(p.position, this.up)),
      links: r.path.map((p) =>
        p.flags & nav.StraightPathPointFlags.OFFMESH ? this.linkId(p.nodeRef ?? -1) : 0,
      ),
    };
  }
  random(from: Point, random: () => number): Vector | null {
    const refs = this.reachable(from);
    if (!refs.size) return null;
    const r = nav.findRandomPoint(
      this.#state.nav,
      { ...nav.DEFAULT_QUERY_FILTER, passFilter: (ref) => refs.has(ref) },
      () => draw(random),
    );
    return r.success ? fromAxes(r.position, this.up) : null;
  }
  raycast(from: Point, to: Point): Ray {
    point(from);
    point(to);
    const a = locate(this, axes(from, this.up));
    if (!a.success) return { clear: false, fraction: 0, point: vector(from) };
    const r = nav.raycast(
      this.#state.nav,
      a.nodeRef,
      a.position,
      axes(to, this.up),
      nav.DEFAULT_QUERY_FILTER,
    );
    const t = Math.max(0, Math.min(1, r.t));
    const target = axes(to, this.up);
    const p: Vector = [
      a.position[0] + (target[0] - a.position[0]) * t,
      a.position[1],
      a.position[2] + (target[2] - a.position[2]) * t,
    ];
    const last = r.path.at(-1);
    if (last !== undefined) {
      const floor = nav.getClosestPointOnPoly(
        nav.createGetClosestPointOnPolyResult(),
        this.#state.nav,
        last,
        p,
      );
      if (floor.success) p[1] = floor.position[1];
    }
    // Upstream rays ignore Y. A roof directly above a room is not reachable by walking straight.
    const clear = t === 1 && Math.abs(p[1] - target[1]) <= this.#state.config.cellHeight * 2;
    return { clear, fraction: t, point: fromAxes(p, this.up) };
  }
  private changed(): void {
    this.#state.revision++;
    this.#identity = undefined;
  }
  private overlaps(tile: TileData, box: Obstacle): boolean {
    const c = this.#state.config,
      origin = axes(c.origin, this.up);
    const size = c.cellSize * c.tileCells,
      pad = (Math.ceil(c.radius / c.cellSize) + 3) * c.cellSize;
    const x = origin[0] + tile.x * size,
      z = origin[2] + tile.z * size;
    return (
      box.max[0]! >= x - pad &&
      box.min[0]! <= x + size + pad &&
      box.max[2]! >= z - pad &&
      box.min[2]! <= z + size + pad
    );
  }
  private overlapping(tile: TileData): Obstacle[] {
    return Object.values(this.#state.obstacles).filter((o) => this.overlaps(tile, o));
  }
  /** Public identity includes asset hashes, dynamic edits and polygon references.
   * Restoring against an edited/reloaded mesh fails instead of using stale refs. */
  identity(): Uint8Array {
    if (!this.#identity) {
      const s = this.#state;
      const bytes = pack('identity', {
        config: s.config,
        tiles: s.hashes,
        obstacles: s.obstacles,
        links: s.nav.offMeshConnections,
        doors: s.doors,
        refs: s.nav.nodes.filter((n) => n.allocated).map((n) => n.ref),
        counters: s.nav.tilePositionToSequenceCounter,
      });
      this.#identity = { revision: this.revision, bytes };
    }
    return this.#identity.bytes.slice();
  }
  /** Public link id for a corridor reference; zero denotes ordinary walking. */
  private linkId(ref: number): number {
    if (!nav.isValidNodeRef(this.#state.nav, ref)) return 0;
    const node = nav.getNodeByRef(this.#state.nav, ref);
    if (node.type !== nav.NodeType.OFFMESH) return 0;
    return Number(
      Object.keys(this.#state.links).find(
        (id) => this.#state.links[id] === node.offMeshConnectionId,
      ) ?? 0,
    );
  }
  addCylinder(baseCenter: Point, radius: number, height: number): number {
    positive(radius, 'cylinder radius');
    positive(height, 'cylinder height');
    const p = axes(baseCenter, this.up);
    return this.addObstacle({
      ...axisBounds([p[0] - radius, p[1], p[2] - radius],
        [p[0] + radius, p[1] + height, p[2] + radius], this.up, true),
      radius,
    });
  }
  /** A cheap door disables whole intersecting polygons. Author a narrow portal
   * polygon at bake time; a box over one large room would disable that room. */
  addDoor(box: Obstacle, enabled = true): number {
    checkObstacle(box);
    if (
      !this.#state.config.doorRegions?.some((region) =>
        [0, 1, 2].every(
          (axis) => box.max[axis]! >= region.min[axis]! && box.min[axis]! <= region.max[axis]!,
        ),
      )
    )
      throw new Error('nav: bake a matching doorRegions box before adding a door');
    const id = this.#state.nextId++;
    this.#state.doors[id] = {
      box: { ...axisBounds(box.min, box.max, this.up) },
      enabled,
    };
    this.applyDoors();
    this.changed();
    return id;
  }
  setDoorEnabled(id: number, enabled: boolean): boolean {
    const door = this.#state.doors[id];
    if (!door) return false;
    door.enabled = enabled;
    this.applyDoors();
    this.changed();
    return true;
  }
  removeDoor(id: number): boolean {
    if (!this.#state.doors[id]) return false;
    delete this.#state.doors[id];
    this.applyDoors(true);
    this.changed();
    return true;
  }
  private applyDoors(reset = false): void {
    const s = this.#state;
    if (!reset && !Object.keys(s.doors).length) return;
    for (const node of s.nav.nodes) {
      if (!node.allocated || node.type !== nav.NodeType.POLY || node.area !== 2) continue;
      const tile = s.nav.tiles[node.tileId]!,
        poly = tile.polys[node.polyIndex]!;
      const vertices = poly.vertices.map((i) => tile.vertices.slice(i * 3, i * 3 + 3));
      node.flags = poly.flags;
      for (const door of Object.values(s.doors)) {
        if (door.enabled || poly.area !== 2) continue;
        const box = door.box;
        const overlaps = [0, 1, 2].every(
          (axis) =>
            Math.max(...vertices.map((p) => p[axis]!)) >= box.min[axis]! &&
            Math.min(...vertices.map((p) => p[axis]!)) <= box.max[axis]!,
        );
        if (overlaps) node.flags = 0;
      }
    }
  }
  /** Diagnostics are plain positions, never backend objects. */
  debug(): {
    triangles: number[];
    links: { id: number; from: Vector; to: Vector }[];
    seams: string[];
  } {
    const triangles: number[] = [],
      seams: string[] = [];
    for (const tile of Object.values(this.#state.nav.tiles)) {
      for (const poly of tile.polys)
        for (let i = 1; i + 1 < poly.vertices.length; i++) {
          for (const index of [poly.vertices[0]!, poly.vertices[i]!, poly.vertices[i + 1]!])
            triangles.push(...fromAxes(tile.vertices.slice(index * 3, index * 3 + 3), this.up));
        }
    }
    for (const data of Object.values(this.#state.tiles))
      seams.push(...this.seamsAt(data.x, data.z, true));
    const links = Object.entries(this.#state.links).map(([id, backend]) => {
      const link = this.#state.nav.offMeshConnections[backend]!;
      return { id: Number(id), from: fromAxes(link.start, this.up), to: fromAxes(link.end, this.up) };
    });
    return { triangles, links, seams };
  }
  private checkRetention(spans: number, cells: number): void {
    if (spans > this.#limits.maxRetainedSpans || cells > this.#limits.maxRetainedCells)
      throw new Error('nav: loaded carve tiles exceed room memory budget; unload distant tiles');
  }
  private seamsAt(x: number, z: number, forwardOnly = false): string[] {
    const backend = this.#state.nav,
      tile = nav.getTileAt(backend, x, z, 0),
      warnings: string[] = [];
    if (!tile) return warnings;
    const offsets = forwardOnly
      ? [
          [1, 0],
          [0, 1],
        ]
      : [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ];
    for (const [dx, dz] of offsets) {
      const other = nav.getTileAt(backend, x + dx!, z + dz!, 0);
      if (!other) continue;
      const connected = tile.polyNodes.some((index) =>
        backend.nodes[index]!.links.some((i) => {
          const link = backend.links[i]!;
          return link.allocated && nav.getNodeByRef(backend, link.toNodeRef).tileId === other.id;
        }),
      );
      if (!connected)
        warnings.push(
          `nav: no shared border between tiles ${x},${z} and ${x + dx!},${z + dz!}; check geometry halo or intended gap`,
        );
    }
    return warnings;
  }
  /** Dynamic topology only. Original baked assets stay in the game build. */
  save(): Uint8Array {
    const { tiles: _assets, nav: backend, ...state } = this.#state;
    const tiles = Object.fromEntries(
      Object.entries(backend.tiles).map(([id, tile]) => [
        id,
        {
          id: tile.id,
          sequence: tile.sequence,
          tileX: tile.tileX,
          tileY: tile.tileY,
          polyNodes: tile.polyNodes,
        },
      ]),
    );
    return pack('mesh', { ...state, retention: this.#limits, nav: { ...backend, tiles } });
  }
  /** Supply the original assets for every saved tile, in any order. Polygon
   * allocations and salts are restored, so saved crowds retain valid corridors. */
  static restore(bytes: Uint8Array, assets: Iterable<Uint8Array>): Mesh {
    try {
      return Mesh.restoreData(bytes, assets);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('nav:')) throw error;
      throw new Error('nav: malformed mesh snapshot');
    }
  }
  private static restoreData(bytes: Uint8Array, assets: Iterable<Uint8Array>): Mesh {
    const saved = unpack<MeshState & { retention: MeshOptions }>('mesh', bytes),
      mesh = new Mesh(saved.config, axisExtents(saved.extent, saved.config.up), saved.retention);
    const runtimeHeaders = saved.nav.tiles;
    Object.assign(mesh.#state, saved, { tiles: {}, nav: { ...saved.nav, tiles: {} } });
    for (const bytes of assets) {
      const tile = decodeTile(bytes),
        key = `${tile.x},${tile.z}`;
      if (!(key in saved.hashes)) continue;
      if (hash(bytes) !== saved.hashes[key]) throw new Error('nav: restored tile content differs');
      if (mesh.#state.tiles[key]) throw new Error('nav: duplicate restored tile');
      mesh.#retainedSpans += tile.compact?.spanCount ?? 0;
      mesh.#retainedCells += tile.compact ? tile.compact.width * tile.compact.height : 0;
      mesh.checkRetention(mesh.#retainedSpans, mesh.#retainedCells);
      mesh.#state.tiles[key] = tile;
    }
    if (Object.keys(mesh.#state.tiles).length !== Object.keys(saved.hashes).length)
      throw new Error('nav: missing restored tile assets');
    for (const header of Object.values(runtimeHeaders)) {
      const asset = mesh.#state.tiles[`${header.tileX},${header.tileY}`];
      if (!asset) throw new Error('nav: missing runtime tile');
      const obstacles = mesh.overlapping(asset),
        tile = obstacles.length ? finishTile(asset, obstacles) : asset.baked;
      if (!tile || tile.polys.length !== header.polyNodes.length)
        throw new Error('nav: restored tile topology differs');
      mesh.#state.nav.tiles[header.id] = { ...tile, ...header };
    }
    return mesh;
  }
}
