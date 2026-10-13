import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { bakePhysicsMesh } from '../lib/physics-mesh.mjs';

test('GLB collision bake applies hierarchy, reflection, indices and Y-up to Z-up', async () => {
  const directory=mkdtempSync(join(tmpdir(),'homie-mesh-bake-'));
  try {
    const document=new Document(),buffer=document.createBuffer();
    const position=document.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array([0,0,0,1,0,0,0,1,0]));
    const indices=document.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint16Array([0,1,2]));
    const primitive=document.createPrimitive().setAttribute('POSITION',position).setIndices(indices);
    const mesh=document.createMesh().addPrimitive(primitive);
    const child=document.createNode().setMesh(mesh).setScale([-2,2,2]);
    const parent=document.createNode().setTranslation([10,3,4]).addChild(child);
    document.createScene().addChild(parent);
    const path=join(directory,'level.glb');
    await new NodeIO().write(path,document);
    assert.deepEqual(await bakePhysicsMesh(path),{vertices:[10,-4,3,8,-4,3,10,-4,5],indices:[0,2,1]});
    primitive.setMode(1);
    await new NodeIO().write(path,document);
    await assert.rejects(bakePhysicsMesh(path),/static triangles/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
