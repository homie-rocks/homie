/** Loaded tiles, runtime carving and the common query interface. No renderer. */
import * as nav from 'navcat';
import { tilePolygons, checkConfig, checkObstacle, type BakeConfig, type Obstacle, type TileData } from './Bake.ts';
import { distance, draw, point, positive, type Point, type Path, type Ray, type NavigationQuery } from './Query.ts';
import { pack, unpack } from './State.ts';
interface MeshState {
  config: BakeConfig; extent: Point; nav: nav.NavMesh; tiles: Record<string, Uint8Array>;
  obstacles: Record<string, Obstacle>; nextObstacle: number; revision: number;
}
export class Mesh implements NavigationQuery {
  /** Internal backend data; treat as read-only. Use save() at a tick boundary. */
  readonly state: MeshState;
  constructor(config: BakeConfig, queryHalfExtents: Point) {
    checkConfig(config); point(queryHalfExtents); queryHalfExtents.forEach(v => positive(v, 'query half extent'));
    const n = nav.createNavMesh(); n.origin = [...config.origin]; n.tileWidth = n.tileHeight = config.cellSize * config.tileCells;
    this.state = { config: { ...config, origin: [...config.origin] }, extent: [...queryHalfExtents], nav: n, tiles: {}, obstacles: {}, nextObstacle: 1, revision: 0 };
  }
  get revision(): number { return this.state.revision; }
  /** Loaded areas only are reachable. Matching global origin/config prevents bad seams. */
  loadTile(bytes: Uint8Array): void {
    const t = unpack<TileData>('tile', bytes);
    checkConfig(t.config);
    const expected = this.state.config;
    if (Object.keys(expected).some(key => {
      const k = key as keyof BakeConfig;
      return k === 'origin' ? expected.origin.some((v, i) => v !== t.config.origin[i]) : expected[k] !== t.config[k];
    })) throw new Error('nav: tile configuration differs from mesh');
    const key = `${t.x},${t.z}`;
    const tile = tilePolygons(bytes, Object.values(this.state.obstacles));
    nav.removeTile(this.state.nav, t.x, t.z, 0);
    if (tile) nav.addTile(this.state.nav, tile);
    this.state.tiles[key] = bytes.slice(); this.state.revision++;
  }
  unloadTile(x: number, z: number): boolean {
    const key = `${x},${z}`; if (!(key in this.state.tiles)) return false;
    nav.removeTile(this.state.nav, x, z, 0); delete this.state.tiles[key]; this.state.revision++; return true;
  }
  private rebuild(obstacle: Obstacle): void {
    const c = this.state.config, size = c.cellSize * c.tileCells, pad = (Math.ceil(c.radius / c.cellSize) + 3) * c.cellSize;
    for (const key of Object.keys(this.state.tiles)) {
      const [x, z] = key.split(',').map(Number) as [number, number];
      const x0 = c.origin[0] + x * size, z0 = c.origin[2] + z * size;
      if (obstacle.max[0] < x0 - pad || obstacle.min[0] > x0 + size + pad || obstacle.max[2] < z0 - pad || obstacle.min[2] > z0 + size + pad) continue;
      this.loadTile(this.state.tiles[key]!);
    }
  }
  /** Synchronous carving of affected loaded tiles; call between fixed steps. */
  addObstacle(obstacle: Obstacle): number {
    checkObstacle(obstacle);
    const id = this.state.nextObstacle++;
    const o = { min: [...obstacle.min] as Point, max: [...obstacle.max] as Point };
    this.state.obstacles[id] = o; this.rebuild(o); this.state.revision++; return id;
  }
  removeObstacle(id: number): boolean {
    const o = this.state.obstacles[id]; if (!o) return false;
    delete this.state.obstacles[id]; this.rebuild(o); this.state.revision++; return true;
  }
  addLink(from: Point, to: Point, radius: number, bidirectional: boolean): number {
    point(from); point(to); positive(radius, 'link radius');
    const id = nav.addOffMeshConnection(this.state.nav, { start: [...from], end: [...to], radius, direction: bidirectional ? 1 : 0, flags: 1, area: 0 });
    this.state.revision++; return id;
  }
  removeLink(id: number): void { nav.removeOffMeshConnection(this.state.nav, id); this.state.revision++; }
  /** Disable doors without changing the connection's identity. */
  setLinkEnabled(id: number, enabled: boolean): void {
    const link = this.state.nav.offMeshConnections[id]; if (!link) throw new Error('nav: unknown link');
    link.flags = enabled ? 1 : 0; nav.reconnectOffMeshConnection(this.state.nav, link); this.state.revision++;
  }
  locate(p: Point): nav.FindNearestPolyResult {
    point(p); return nav.findNearestPoly(nav.createFindNearestPolyResult(), this.state.nav, p, this.state.extent, nav.DEFAULT_QUERY_FILTER);
  }
  private reachable(from: Point): Set<number> {
    const a = this.locate(from), found = new Set<number>();
    if (!a.success) return found;
    const queue = [a.nodeRef]; found.add(a.nodeRef);
    for (let i = 0; i < queue.length; i++) {
      const n = nav.getNodeByRef(this.state.nav, queue[i]!);
      for (const index of n.links) {
        const link = this.state.nav.links[index]!;
        if (link.allocated && !found.has(link.toNodeRef) && nav.DEFAULT_QUERY_FILTER.passFilter(link.toNodeRef, this.state.nav)) { found.add(link.toNodeRef); queue.push(link.toNodeRef); }
      }
    }
    return found;
  }
  nearest(p: Point, from?: Point): Point | null {
    point(p);
    if (!from) { const a = this.locate(p); return a.success ? [...a.position] : null; }
    let best: Point | null = null, d = Infinity;
    for (const ref of this.reachable(from)) {
      const n = nav.getNodeByRef(this.state.nav, ref); if (n.type !== nav.NodeType.POLY) continue;
      const r = nav.getClosestPointOnPoly(nav.createGetClosestPointOnPolyResult(), this.state.nav, ref, p);
      const nd = distance(p, r.position);
      if (r.success && nd < d) { best = [...r.position]; d = nd; }
    }
    return best;
  }
  path(from: Point, to: Point): Path {
    point(from); point(to);
    const r = nav.findPath(this.state.nav, from, to, this.state.extent, nav.DEFAULT_QUERY_FILTER);
    return { complete: r.success && !!(r.flags & nav.FindPathResultFlags.COMPLETE_PATH), points: r.path.map(p => [...p.position]), links: r.path.map(p => p.flags & nav.StraightPathPointFlags.OFFMESH ? p.nodeRef ?? 0 : 0) };
  }
  random(from: Point, random: () => number): Point | null {
    const refs = this.reachable(from); if (!refs.size) return null;
    const r = nav.findRandomPoint(this.state.nav, { ...nav.DEFAULT_QUERY_FILTER, passFilter: ref => refs.has(ref) }, () => draw(random));
    return r.success ? [...r.position] : null;
  }
  raycast(from: Point, to: Point): Ray {
    point(from); point(to); const a = this.locate(from);
    if (!a.success) return { clear: false, fraction: 0, point: [...from] };
    const r = nav.raycast(this.state.nav, a.nodeRef, a.position, to, nav.DEFAULT_QUERY_FILTER);
    const t = Math.max(0, Math.min(1, r.t));
    const p: Point = [a.position[0] + (to[0] - a.position[0]) * t, a.position[1], a.position[2] + (to[2] - a.position[2]) * t];
    const last = r.path.at(-1);
    if (last !== undefined) {
      const floor = nav.getClosestPointOnPoly(nav.createGetClosestPointOnPolyResult(), this.state.nav, last, p);
      if (floor.success) p[1] = floor.position[1];
    }
    // Upstream rays ignore Y. A roof directly above a room is not reachable by walking straight.
    const clear = t === 1 && Math.abs(p[1] - to[1]) <= this.state.config.cellHeight * 2;
    return { clear, fraction: t, point: p };
  }
  save(): Uint8Array { return pack('mesh', this.state); }
  static restore(bytes: Uint8Array): Mesh {
    const s = unpack<MeshState>('mesh', bytes), m = new Mesh(s.config, s.extent);
    Object.assign(m.state, s); return m;
  }
}
