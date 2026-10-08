import * as nav from 'navcat';
import { numbers, record, requireState } from './Validate.ts';
import type { MeshState } from './MeshData.ts';
import { checkObstacle } from '../Bake.ts';

const integer = (n: number, min = 0): void => requireState(Number.isSafeInteger(n) && n >= min);
/** Check both structure and cross references before exposing restored topology. */
export function validateMesh(s: MeshState): void {
  const n = s.nav;
  record(n);
  numbers(n.origin, 3);
  requireState(n.tileWidth > 0 && n.tileHeight > 0);
  integer(s.revision);
  integer(s.nextId, 1);
  for (const value of [
    s.hashes,
    s.obstacles,
    s.links,
    s.doors,
    n.tiles,
    n.tilePositionToTileId,
    n.tileColumnToTileIds,
    n.tilePositionToSequenceCounter,
    n.offMeshConnections,
    n.offMeshConnectionAttachments,
  ])
    record(value);
  for (const collection of [s.obstacles, s.links, s.doors]) for (const id of Object.keys(collection)) {
    integer(Number(id), 1);
    requireState(Number(id) < s.nextId);
  }
  for (const obstacle of Object.values(s.obstacles)) checkObstacle(obstacle);
  for (const door of Object.values(s.doors)) {
    record(door);
    checkObstacle(door.box);
    requireState(typeof door.enabled === 'boolean');
  }
  requireState(Array.isArray(n.nodes) && Array.isArray(n.links));
  for (const pool of [
    n.nodeIndexPool,
    n.linkIndexPool,
    n.tileIndexPool,
    n.offMeshConnectionIndexPool,
  ]) {
    record(pool);
    integer(pool.counter);
    numbers(pool.free);
    requireState(new Set(pool.free).size === pool.free.length);
    for (const i of pool.free) {
      integer(i);
      requireState(i < pool.counter);
    }
  }
  requireState(
    n.nodeIndexPool.counter === n.nodes.length && n.linkIndexPool.counter === n.links.length,
  );
  const valid = (ref: number): boolean => Number.isSafeInteger(ref) && nav.isValidNodeRef(n, ref);
  for (const [i, node] of n.nodes.entries()) {
    record(node);
    requireState(typeof node.allocated === 'boolean' && node.index === i);
    requireState(node.allocated !== n.nodeIndexPool.free.includes(i));
    numbers(node.links);
    if (!node.allocated) continue;
    requireState(
      valid(node.ref) &&
        nav.getNodeRefIndex(node.ref) === i &&
        nav.getNodeRefType(node.ref) === node.type,
    );
    integer(node.flags);
    integer(node.area);
    requireState(node.type === nav.NodeType.POLY || node.type === nav.NodeType.OFFMESH);
    if (node.type === nav.NodeType.POLY) {
      const tile = n.tiles[node.tileId];
      requireState(tile && tile.polys[node.polyIndex] && tile.polyNodes[node.polyIndex] === i);
    } else requireState(n.offMeshConnections[node.offMeshConnectionId]);
    for (const id of node.links) {
      const link = n.links[id];
      requireState(
        link && link.allocated && link.fromNodeIndex === i && link.fromNodeRef === node.ref,
      );
    }
  }
  for (const [i, link] of n.links.entries()) {
    record(link);
    requireState(typeof link.allocated === 'boolean' && link.index === i);
    requireState(link.allocated !== n.linkIndexPool.free.includes(i));
    if (!link.allocated) continue;
    requireState(valid(link.fromNodeRef) && valid(link.toNodeRef));
    requireState(
      n.nodes[link.fromNodeIndex]?.ref === link.fromNodeRef &&
        n.nodes[link.toNodeIndex]?.ref === link.toNodeRef &&
        n.nodes[link.fromNodeIndex]!.links.includes(i),
    );
    for (const v of [link.edge, link.side, link.bmin, link.bmax]) requireState(Number.isFinite(v));
  }
  for (const [key, tile] of Object.entries(n.tiles)) {
    requireState(String(tile.id) === key);
    integer(tile.sequence);
    numbers(tile.polyNodes, tile.polys.length);
    requireState(
      n.tilePositionToTileId[`${tile.tileX},${tile.tileY},${tile.tileLayer}`] === tile.id,
    );
    requireState(n.tileColumnToTileIds[`${tile.tileX},${tile.tileY}`]?.includes(tile.id));
    for (const index of tile.polyNodes)
      requireState(n.nodes[index]?.allocated && n.nodes[index]?.tileId === tile.id);
  }
  for (const id of Object.values(n.tilePositionToTileId)) requireState(n.tiles[id]);
  for (const ids of Object.values(n.tileColumnToTileIds)) {
    numbers(ids);
    for (const id of ids) requireState(n.tiles[id]);
  }
  for (const value of Object.values(n.tilePositionToSequenceCounter)) integer(value);
  integer(n.offMeshConnectionSequenceCounter);
  for (const [key, con] of Object.entries(n.offMeshConnections)) {
    record(con);
    requireState(String(con.id) === key);
    numbers(con.start, 3);
    numbers(con.end, 3);
    requireState(Number.isFinite(con.radius) && con.radius > 0);
    integer(con.sequence);
    integer(con.flags);
    integer(con.area);
    requireState(con.direction === 0 || con.direction === 1);
  }
  for (const [id, attachment] of Object.entries(n.offMeshConnectionAttachments)) {
    record(attachment);
    requireState(n.offMeshConnections[id]);
    const attached = n.nodes[nav.getNodeRefIndex(attachment.offMeshNode)];
    requireState(
      attached?.type === nav.NodeType.OFFMESH && String(attached.offMeshConnectionId) === id,
    );
    for (const ref of [attachment.offMeshNode, attachment.startPolyNode, attachment.endPolyNode])
      requireState(ref === null || ref === -1 || valid(ref));
  }
  for (const id of Object.values(s.links)) requireState(n.offMeshConnections[id]);
  for (const hash of Object.values(s.hashes)) integer(hash);
}
