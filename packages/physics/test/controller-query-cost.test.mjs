import test from "node:test";
import assert from "node:assert/strict";
import { ax, run } from "./scenario-harness.mjs";
import { inspect } from "../dist/internal/Engine.js";
import { sampleHeightfield } from "../dist/Heightfield.js";
for (const kind of ["mesh", "heightfield"])
  test(`walking never fetches the supporting ${kind} shape`, () => {
    const a = ax("y"),
      w = a.world();
    w.createBody(
      kind === "mesh"
        ? {
            type: "static",
            colliders: [
              {
                shape: {
                  kind: "mesh",
                  vertices: new Float32Array([
                    -10, 0, -10, 10, 0, -10, -10, 0, 10, 10, 0, 10,
                  ]),
                  indices: new Uint32Array([0, 2, 1, 1, 2, 3]),
                },
              },
            ],
          }
        : {
            type: "static",
            colliders: [
              sampleHeightfield(
                { heightAt: () => 0 },
                { nx: 65, nz: 65, cell: 1, x0: -32, z0: -32 },
              ),
            ],
          },
    );
    const c = a.chr(w, 0, 2);
    run(w, 60, 0.5);
    const { world: raw, engine: r } = inspect(w);
    raw.colliders.forEach((collider) => {
      if (
        [r.ShapeType.TriMesh, r.ShapeType.HeightField].includes(
          collider.shapeType(),
        )
      )
        Object.defineProperty(collider, "shape", {
          get() {
            assert.fail("whole supporting shape was fetched");
          },
        });
    });
    run(w, 60, 2, () => w.controlCharacter(c, a.inp(2)));
    assert.ok(w.characterState(c).grounded);
    w.dispose();
  });
