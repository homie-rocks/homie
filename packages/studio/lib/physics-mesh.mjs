import { NodeIO } from '@gltf-transform/core';
import { Matrix4, Vector3 } from 'three';

/** Build-time only: bake the default GLB scene, including every node transform.
 * Rules use Z-up; glTF is Y-up. (x,y,z) -> (x,-z,y) preserves handedness.
 * Animated, skinned and morphing geometry needs an explicitly authored static collider.
 */
export async function bakePhysicsMesh(path) {
  const document = await new NodeIO().read(path);
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene || root.listAnimations().length) throw new Error('physics mesh: needs a static default scene');
  const vertices = [], indices = [];
  scene.traverse(node => {
    if (node.getSkin()) throw new Error('physics mesh: skinned nodes need a static collider');
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    const mirrored = matrix.determinant() < 0;
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      if (primitive.getMode() !== 4 || primitive.listTargets().length) throw new Error('physics mesh: only static triangles are supported');
      const positions = primitive.getAttribute('POSITION'), index = primitive.getIndices();
      if (!positions || positions.getElementSize() !== 3) throw new Error('physics mesh: missing xyz positions');
      const base = vertices.length / 3;
      for (let i = 0; i < positions.getCount(); i++) {
        const p = new Vector3().fromArray(positions.getElement(i, [])).applyMatrix4(matrix);
        if (![p.x,p.y,p.z].every(Number.isFinite)) throw new Error('physics mesh: nonfinite vertex');
        vertices.push(Math.fround(p.x), Math.fround(-p.z), Math.fround(p.y));
      }
      const count = index?.getCount() ?? positions.getCount();
      if (count % 3) throw new Error('physics mesh: incomplete triangle');
      for (let i = 0; i < count; i += 3) {
        const triangle = [0,1,2].map(j => index ? index.getScalar(i+j) : i+j);
        if (!triangle.every(n => Number.isSafeInteger(n) && n >= 0 && n < positions.getCount())) throw new Error('physics mesh: index out of range');
        if (mirrored) [triangle[1],triangle[2]] = [triangle[2],triangle[1]];
        indices.push(...triangle.map(n => base+n));
      }
    }
  });
  if (!indices.length) throw new Error('physics mesh: no triangles');
  return { vertices, indices };
}
