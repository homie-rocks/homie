/** Optional renderer helpers. No core module imports this file. */
import * as THREE from 'three';
import type { Triangles } from './Bake.ts';
import type { Mesh } from './Mesh.ts';
import type { Crowd } from './Crowd.ts';
import type { Up } from './Query.ts';
/** Flatten visible mesh geometry after world transforms, respecting indices,
 * draw ranges, instancing and mirrored transforms. Root matrices are updated. */
export function trianglesFromObject3D(root: THREE.Object3D, options: { up?: Up } = {}): Triangles {
  root.updateWorldMatrix(true, true);
  const positions: number[] = [],
    point = new THREE.Vector3(),
    instance = new THREE.Matrix4(),
    world = new THREE.Matrix4();
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry,
      attribute = geometry.getAttribute('position');
    if (!attribute) return;
    const index = geometry.getIndex(),
      count = index?.count ?? attribute.count;
    const first = geometry.drawRange.start,
      last = Math.min(count, first + geometry.drawRange.count);
    const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
    for (let n = 0; n < instances; n++) {
      world.copy(object.matrixWorld);
      if (object instanceof THREE.InstancedMesh) {
        object.getMatrixAt(n, instance);
        world.multiply(instance);
      }
      const mirrored = world.determinant() < 0;
      for (let i = first; i + 2 < last; i += 3)
        for (const offset of mirrored ? [0, 2, 1] : [0, 1, 2]) {
          point
            .fromBufferAttribute(attribute, index ? index.getX(i + offset) : i + offset)
            .applyMatrix4(world);
          positions.push(
            point.x,
            options.up === 'z' ? -point.z : point.y,
            options.up === 'z' ? point.y : point.z,
          );
        }
    }
  });
  return { positions: new Float64Array(positions) };
}
/** Rebuild this disposable group after edits or each debug frame. For Z-up mesh
 * state, positions are converted to three.js Y-up for display. */
export function debugMesh(mesh: Mesh, crowd?: Crowd): THREE.Group {
  const group = new THREE.Group(),
    data = mesh.debug();
  const display = (p: ArrayLike<number>): number[] =>
    mesh.up === 'z' ? [p[0]!, p[2]!, -p[1]!] : [p[0]!, p[1]!, p[2]!];
  const positions: number[] = [];
  for (let i = 0; i < data.triangles.length; i += 3)
    positions.push(...display(data.triangles.slice(i, i + 3)));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  group.add(
    new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x37bb88,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  const links = new THREE.BufferGeometry();
  links.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      data.links.flatMap((link) => [...display(link.from), ...display(link.to)]),
      3,
    ),
  );
  group.add(new THREE.LineSegments(links, new THREE.LineBasicMaterial({ color: 0xffcc44 })));
  if (crowd) {
    const agents = new THREE.BufferGeometry();
    agents.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        crowd.ids().flatMap((id) => display(crowd.agent(id)!.position)),
        3,
      ),
    );
    group.add(new THREE.Points(agents, new THREE.PointsMaterial({ color: 0xff4477, size: 0.3 })));
  }
  return group;
}
export function disposeDebugMesh(group: THREE.Group): void {
  group.traverse((object) => {
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.LineSegments ||
      object instanceof THREE.Points
    ) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        material.dispose();
    }
  });
  group.clear();
}
