import * as nav from 'navcat';
import { meshData } from './MeshData.ts';

interface Index {
  revision: number;
  component: Map<number, number>;
  members: number[][];
  edges: Set<number>[];
  reachable: Map<number, Set<number>>;
}
const indices = new WeakMap<object, Index>();
/** Strong components share one reachability set. Directed links remain directed.
 * Iterative Kosaraju avoids stack limits on large streamed worlds. */
function index(mesh: object): Index {
  const s = meshData(mesh);
  const cached = indices.get(mesh);
  if (cached?.revision === s.revision) return cached;
  const forward = new Map<number, number[]>(), reverse = new Map<number, number[]>();
  for (const node of s.nav.nodes) {
    if (!node.allocated || !nav.DEFAULT_QUERY_FILTER.passFilter(node.ref, s.nav)) continue;
    forward.set(node.ref, []);
    reverse.set(node.ref, []);
  }
  for (const [ref, edges] of forward) {
    for (const id of nav.getNodeByRef(s.nav, ref).links) {
      const link = s.nav.links[id]!;
      if (!link.allocated || !forward.has(link.toNodeRef)) continue;
      edges.push(link.toNodeRef);
      reverse.get(link.toNodeRef)!.push(ref);
    }
  }
  const seen = new Set<number>(), order: number[] = [];
  for (const root of forward.keys()) {
    if (seen.has(root)) continue;
    const stack: [number, number][] = [[root, 0]];
    seen.add(root);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const edges = forward.get(top[0])!;
      if (top[1] === edges.length) { order.push(top[0]); stack.pop(); continue; }
      const next = edges[top[1]++]!;
      if (!seen.has(next)) { seen.add(next); stack.push([next, 0]); }
    }
  }
  const component = new Map<number, number>(), members: number[][] = [];
  for (const root of order.reverse()) {
    if (component.has(root)) continue;
    const id = members.length, group = [root];
    component.set(root, id);
    for (let i = 0; i < group.length; i++) {
      for (const next of reverse.get(group[i]!)!) {
        if (!component.has(next)) { component.set(next, id); group.push(next); }
      }
    }
    members.push(group);
  }
  const edges = members.map(() => new Set<number>());
  for (const [ref, links] of forward) {
    const from = component.get(ref)!;
    for (const next of links) {
      const to = component.get(next)!;
      if (from !== to) edges[from]!.add(to);
    }
  }
  const result = { revision: s.revision, component, members, edges, reachable: new Map() };
  indices.set(mesh, result);
  return result;
}
export function reachable(mesh: object, from: number): Set<number> {
  const data = index(mesh), root = data.component.get(from);
  if (root === undefined) return new Set();
  const cached = data.reachable.get(root);
  if (cached) return cached;
  const queue = [root], seen = new Set(queue), refs = new Set<number>();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const ref of data.members[id]!) refs.add(ref);
    for (const next of data.edges[id]!) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  data.reachable.set(root, refs);
  return refs;
}
