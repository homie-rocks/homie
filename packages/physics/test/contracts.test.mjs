import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorld,
  v,
  box,
  options,
  floor,
  ticks,
  character,
} from "./helpers.mjs";
import { sampleHeightfield } from "../dist/Heightfield.js";
const pos = (w, c) => w.bodyState(w.characterState(c).body).position;

test("both up axes support characters, heightfields and world-space ray normals", () => {
  for (const up of ["y", "z"]) {
    const w = createWorld({ up });
    w.createBody({
      type: "static",
      colliders: [
        sampleHeightfield(
          { heightAt: (x, z) => x / 10 + z / 5 },
          { nx: 10, nz: 10, cell: 1, x0: 0, z0: 0 },
          up,
        ),
      ],
    });
    const p = up === "y" ? v(2, 5, 3) : v(2, 3, 5),
      down = up === "y" ? v(0, -1) : v(0, 0, -1);
    const hit = w.raycast(p, down, 10);
    assert.ok(Math.abs(hit.point[up] - 0.8) < 0.001);
    const c = w.createCharacter({ ...character, position: p });
    ticks(w, 120);
    assert.equal(w.characterState(c).grounded, true);
    assert.ok(pos(w, c)[up] > 1.5);
    w.dispose();
  }
});

test("steep supports cannot ground a character or replenish jump", () => {
  for (const up of ["y", "z"]) {
    const w = createWorld({ up });
    w.createBody({
      type: "static",
      colliders: [
        sampleHeightfield(
          { heightAt: (x) => Math.max(0, x) * 1.732 },
          { nx: 81, nz: 5, cell: 0.25, x0: -5, z0: -0.5 },
          up,
        ),
      ],
    });
    const c = w.createCharacter({
      ...character,
      position: up === "y" ? v(5, 10) : v(5, 0, 10),
    });
    for (let i = 0; i < 60; i++) {
      w.controlCharacter(c, { x: 3, jump: true });
      w.step(w.fixedDt);
    }
    assert.equal(w.characterState(c).grounded, false);
    assert.ok(w.characterState(c).verticalVelocity < 0);
    w.dispose();
  }
});

test("a sweeping wall pushes a character, a blocked push reports crushing", () => {
  for (const blocked of [false, true]) {
    const w = createWorld(options);
    floor(w);
    if (blocked)
      w.createBody({
        type: "static",
        position: v(1.2, 1),
        colliders: [{ shape: box(0.1, 1, 2) }],
      });
    const wall = w.createBody({
      type: "kinematic",
      position: v(-2, 1),
      colliders: [{ shape: box(0.2, 1, 2) }],
    });
    const c = w.createCharacter(character);
    ticks(w, 30);
    let crushed = false;
    for (let i = 1; i <= 150; i++) {
      w.moveKinematic(wall, v(-2 + i / 30, 1));
      w.step(w.fixedDt);
      crushed ||= w.characterState(c).crushed;
    }
    if (blocked) assert.equal(crushed, true);
    else assert.ok(pos(w, c).x > 3.4);
    w.dispose();
  }
});

test("jump inherits platform motion and push mass moves loose props", () => {
  const w = createWorld(options);
  const platform = w.createBody({
    type: "kinematic",
    colliders: [{ shape: box(3, 0.25, 3) }],
  });
  const c = w.createCharacter({ ...character, position: v(0, 1.2) });
  ticks(w, 30);
  for (let i = 1; i <= 60; i++) {
    w.moveKinematic(platform, v(i / 15));
    w.controlCharacter(c, { x: 0, z: 0, jump: i === 10 });
    w.step(w.fixedDt);
  }
  assert.ok(Math.abs(pos(w, c).x - 4) < 0.05);
  w.dispose();
  for (const density of [0.1, 1, 10]) {
    const w = createWorld(options);
    floor(w);
    const prop = w.createBody({
      type: "dynamic",
      position: v(1.5, 0.4),
      colliders: [{ shape: box(0.4, 0.4, 0.4), density }],
    });
    const c = w.createCharacter(character);
    ticks(w, 30);
    w.controlCharacter(c, { x: 2, z: 0 });
    ticks(w, 180);
    assert.ok(w.bodyState(prop).position.x > 5);
    w.dispose();
  }
});

test("dynamic riders receive evenly interpolated targets at 20, 30 and 60 Hz", () => {
  const results = [];
  for (const hz of [20, 30, 60]) {
    const w = createWorld(options);
    const p = w.createBody({
      type: "kinematic",
      colliders: [{ shape: box(10, 0.25, 3), friction: 1 }],
    });
    const rider = w.createBody({
      type: "dynamic",
      position: v(0, 0.76),
      colliders: [{ shape: box(), friction: 1 }],
    });
    ticks(w, 120);
    for (let i = 1; i <= hz * 4; i++) {
      w.moveKinematic(p, v((i * 2) / hz));
      w.step(1 / hz);
    }
    results.push(w.bodyState(rider).position.x);
    w.dispose();
  }
  assert.ok(Math.min(...results) > 7.5, JSON.stringify(results));
  assert.ok(Math.max(...results) - Math.min(...results) < 0.04);
});

test("removal closes begun pairs exactly once and handles expose liveness", () => {
  for (const remove of ["body", "collider"]) {
    const w = createWorld({ gravity: v() });
    w.createBody({
      type: "static",
      colliders: [{ shape: box(), sensor: true }],
    });
    const b = w.createBody({ type: "dynamic", colliders: [{ shape: box() }] });
    const collider = w.colliders(b)[0];
    assert.equal(w.step(w.fixedDt).filter((e) => e.started).length, 1);
    if (remove === "body") w.removeBody(b);
    else w.removeCollider(collider);
    assert.equal(w.hasCollider(collider), false);
    assert.equal(w.step(w.fixedDt).filter((e) => !e.started).length, 1);
    assert.equal(w.step(w.fixedDt).length, 0);
    w.dispose();
  }
});

test("invalid inputs are rejected before mutation", () => {
  const w = createWorld(options);
  floor(w);
  const b = w.createBody({
    type: "dynamic",
    position: v(0, 3),
    colliders: [{ shape: box() }],
  });
  const c = w.createCharacter({ ...character, position: v(4, 1) });
  const saved = w.snapshot();
  for (const action of [
    () => w.impulse(b, v(1e12)),
    () => w.setVelocity(b, v(1e20)),
    () => w.setVelocity(b, v(), v(1e20)),
    () => w.teleport(b, v(1e39)),
    () => w.createBody({ type: "dynamic", position: v(1e30) }),
    () => w.createBody({ type: "dynamic", gravityScale: 1e30 }),
    () => w.controlCharacter(c, { x: 1e30 }),
    () => w.createBody({ type: "dynamic", mas: 5 }),
    () => w.createBody({ type: "dynamic" }),
    () =>
      w.createBody({
        type: "static",
        colliders: [{ shape: { kind: "box", size: v(1, 1, 1) } }],
      }),
    () =>
      w.createBody({
        type: "static",
        colliders: [
          { shape: { kind: "convex", vertices: new Float32Array(12) } },
        ],
      }),
  ]) {
    assert.throws(action, /physics:/);
    assert.deepEqual(w.snapshot(), saved);
  }
  w.restore(saved);
  w.step(w.fixedDt);
  w.dispose();
  w.dispose();
});

test("binary saves detect bit damage, chunk below storage limits and replay", () => {
  const w = createWorld(options);
  floor(w);
  for (let i = 0; i < 100; i++)
    w.createBody({
      type: "dynamic",
      position: v(i % 10, 2 + Math.floor(i / 10)),
      colliders: [{ shape: box() }],
    });
  ticks(w, 10);
  const saved = w.snapshot(),
    copy = saved.slice();
  copy[copy.length - 1] ^= 1;
  assert.throws(() => w.restore(copy), /snapshot/);
  assert.deepEqual(w.snapshot(), saved);
  const chunks = w.snapshotChunks(4096);
  assert.ok(chunks.every((c) => c.length <= 4096));
  const other = createWorld({});
  other.restoreChunks(chunks);
  assert.deepEqual(other.snapshot(), saved);
  assert.deepEqual(other.step(0.05), w.step(0.05));
  assert.deepEqual(other.snapshot(), w.snapshot());
  other.dispose();
  w.dispose();
});

test("stepped paths never call nondeterministic transcendental maths", () => {
  const w = createWorld(options);
  floor(w);
  w.createCharacter(character);
  const original = {};
  try {
    for (const name of ["sin", "cos", "tan", "atan2", "pow", "exp", "log"]) {
      original[name] = Math[name];
      Math[name] = () => {
        throw new Error("forbidden Math." + name);
      };
    }
    ticks(w, 120);
  } finally {
    Object.assign(Math, original);
    w.dispose();
  }
});

test("declared steps work, falling is bounded, embedded spawns fail", () => {
  for (const height of [0.3, 0.34]) {
    const w = createWorld(options);
    floor(w);
    w.createBody({
      type: "static",
      position: v(2, height / 2),
      colliders: [{ shape: box(1, height / 2, 2) }],
    });
    const c = w.createCharacter(character);
    ticks(w, 30);
    w.controlCharacter(c, { x: 2, z: 0 });
    ticks(w, 120);
    assert.ok(pos(w, c).x > 2.5, JSON.stringify(pos(w, c)));
    w.dispose();
  }
  const w = createWorld(options);
  floor(w);
  assert.throws(
    () => w.createCharacter({ ...character, position: v(0, -0.1) }),
    /overlaps/,
  );
  const c = w.createCharacter({ ...character, position: v(100, 1) });
  ticks(w, 3600);
  assert.equal(w.characterState(c).verticalVelocity, -60);
  w.dispose();
});

test("trapped steps remain restorable and disposable", async () => {
  const { inspect } = await import("../dist/internal/Engine.js");
  const w = createWorld(options);
  floor(w);
  const save = w.snapshot();
  inspect(w).world.step = () => {
    throw new WebAssembly.RuntimeError("injected trap");
  };
  assert.throws(() => w.step(w.fixedDt), /engine failed/);
  assert.throws(() => w.bodyState(1), /engine failed/);
  w.restore(save);
  w.step(w.fixedDt);
  w.dispose();
  w.dispose();
});

test("insert, teleport and material queries need no full scene refit", async () => {
  const { inspect } = await import("../dist/internal/Engine.js");
  const w = createWorld(options);
  let calls = 0;
  inspect(w).world.updateSceneQueries = () => {
    calls++;
  };
  try {
    const b = floor(w);
    for (let i = 0; i < 100; i++) assert.ok(w.raycast(v(0, 2), v(0, -1), 10));
    w.teleport(b, v(2, -0.5));
    assert.ok(w.raycast(v(0, 2), v(0, -1), 10));
    w.updateCollider(w.colliders(b)[0], { friction: 0.2 });
    w.step(w.fixedDt);
    assert.ok(w.raycast(v(0, 2), v(0, -1), 10));
    assert.equal(calls, 0);
  } finally {
    w.dispose();
  }
});

test("contacts have data, mutable tuning and forces work, rays exit solids", () => {
  const w = createWorld(options);
  floor(w);
  const b = w.createBody({
    type: "dynamic",
    position: v(0, 3),
    colliders: [{ shape: box() }],
  });
  const impact = ticks(w, 90).find((e) => e.kind === "impact" && e.bodyB === b);
  assert.ok(impact.point);
  assert.ok(impact.normal);
  assert.ok(impact.impulse > 0);
  w.updateBody(b, {
    gravityScale: 0,
    ccd: true,
    linearDamping: 0.1,
    lockTranslations: { x: false, y: false, z: true },
  });
  w.updateCollider(w.colliders(b)[0], {
    friction: 0.2,
    layers: { membership: 1, filter: 65535 },
  });
  const lockedZ = w.bodyState(b).position.z;
  w.force(b, v(5, 0, 10));
  w.torque(b, v(0, 1));
  ticks(w, 10);
  w.clearForces(b);
  assert.ok(w.bodyState(b).velocity.x > 0);
  assert.ok(Math.abs(w.bodyState(b).position.z - lockedZ) < 0.001);
  const solid = w.createBody({
    type: "static",
    position: v(10, 2),
    colliders: [{ shape: box() }],
  });
  const hit = w.raycast(v(10, 2), v(1), 5);
  assert.ok(hit.distance > 0);
  assert.deepEqual(hit.normal, v(1));
  w.removeBody(solid);
  assert.doesNotThrow(() => w.raycast(v(), v(1), 5, { excludeBody: solid }));
  const wall = w.createBody({
    type: "static",
    position: v(3, 1),
    colliders: [{ shape: box(0.1, 1, 2) }],
  });
  const c = w.createCharacter({ ...character, position: v(1, 1) });
  ticks(w, 30);
  w.controlCharacter(c, { x: 2, z: 0 });
  const contacts = ticks(w, 120);
  assert.ok(
    contacts.some(
      (e) =>
        e.started &&
        e.kind === "contact" &&
        (e.bodyA === wall || e.bodyB === wall),
    ),
  );
  assert.ok(w.characterState(c).hits.length);
  w.dispose();
});

test("capsule query orientation follows up, and tilted platforms carry the sole", () => {
  for (const up of ["y", "z"]) {
    const w = createWorld({ up, gravity: v() });
    const p = up === "y" ? v(0, 1) : v(0, 0, 1);
    w.createBody({
      type: "static",
      position: p,
      colliders: [{ shape: box(0.1, 0.1, 0.1) }],
    });
    assert.equal(
      w.overlaps({ kind: "capsule", radius: 0.2, halfHeight: 1 }, v()).length,
      1,
    );
    w.dispose();
  }
  const w = createWorld(options),
    p = w.createBody({
      type: "kinematic",
      colliders: [{ shape: box(3, 0.25, 3) }],
    });
  const c = w.createCharacter({ ...character, position: v(1, 1.2) });
  ticks(w, 30);
  for (let i = 1; i <= 240; i++) {
    const a = ((i / 240) * Math.PI) / 6;
    w.moveKinematic(p, v(), {
      x: 0,
      y: 0,
      z: Math.sin(a / 2),
      w: Math.cos(a / 2),
    });
    w.step(w.fixedDt);
  }
  assert.ok(pos(w, c).x > 0.68, JSON.stringify(pos(w, c)));
  assert.equal(w.characterState(c).grounded, true);
  w.dispose();
});

test("character acceleration, buffered jumping and coyote time have saved state", () => {
  const w = createWorld(options);
  floor(w);
  const c = w.createCharacter({
    ...character,
    acceleration: 2,
    coyoteTime: 0.12,
    jumpBuffer: 0.15,
  });
  ticks(w, 30);
  w.controlCharacter(c, { x: 4, z: 0 });
  const start = pos(w, c).x;
  ticks(w, 15);
  assert.ok(pos(w, c).x - start < 0.2);
  assert.ok(pos(w, c).x > start);
  // A request just before landing is retained across restoration.
  w.teleport(w.characterState(c).body, v(0, 1.05));
  w.controlCharacter(c, { x: 0, z: 0, jump: true });
  const restored = createWorld({});
  restored.restore(w.snapshot());
  let highest = 0;
  for (let i = 0; i < 60; i++) {
    assert.deepEqual(w.step(w.fixedDt), restored.step(w.fixedDt));
    highest = Math.max(highest, pos(w, c).y);
  }
  assert.ok(highest > 1.3);
  assert.deepEqual(w.snapshot(), restored.snapshot());
  w.dispose();
  restored.dispose();
});

test("saved character options and raw handle ownership are checked before replacement", async () => {
  const { pack, unpack } = await import("../dist/internal/Save.js");
  const w = createWorld(options);
  floor(w);
  w.createCharacter(character);
  const saved = w.snapshot();
  for (const mutate of [
    (s) => {
      s.characters[0].options.radius = -1;
    },
    (s) => {
      s.characters[0].options.gravity = 1e30;
    },
    (s) => {
      s.colliders[0].body = s.characters[0].body;
    },
    (s) => {
      s.up = "x";
    },
  ]) {
    const { meta, raw } = unpack(saved);
    mutate(meta);
    assert.throws(() => w.restore(pack(meta, raw)), /physics:/);
    assert.deepEqual(w.snapshot(), saved);
  }
  w.dispose();
});

test("storage sizes fit chunked values for 2000 bodies and a terrain tile", () => {
  const w = createWorld(options);
  floor(w);
  for (let i = 0; i < 2000; i++)
    w.createBody({
      type: "dynamic",
      position: v(i % 20, 1 + Math.floor(i / 400), Math.floor(i / 20) % 20),
      colliders: [{ shape: box(0.4, 0.4, 0.4) }],
    });
  ticks(w, 60);
  const save = w.snapshot(),
    chunks = w.snapshotChunks();
  assert.ok(save.byteLength / 2000 < 2000, `${save.byteLength} bytes`);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.byteLength < 2 * 1024 * 1024));
  const restored = createWorld({});
  restored.restoreChunks(chunks);
  assert.deepEqual(restored.snapshot(), save);
  restored.dispose();
  w.dispose();
  const terrain = createWorld({});
  terrain.createBody({
    type: "static",
    colliders: [
      sampleHeightfield(
        { heightAt: () => 0 },
        { nx: 65, nz: 65, cell: 1, x0: 0, z0: 0 },
      ),
    ],
  });
  assert.ok(terrain.snapshot().byteLength < 32768);
  terrain.dispose();
});

test("unreleased version-one envelopes are refused", async () => {
  const { unpack } = await import("../dist/internal/Save.js");
  const w = createWorld(options);
  floor(w);
  const { meta, raw } = unpack(w.snapshot());
  const header = new TextEncoder().encode(JSON.stringify(meta));
  const legacy = new Uint8Array(8 + header.length + raw.length),
    view = new DataView(legacy.buffer);
  view.setUint32(0, 0x48505931);
  view.setUint32(4, header.length, true);
  legacy.set(header, 8);
  legacy.set(raw, 8 + header.length);
  assert.throws(() => w.restore(legacy), /version/);
  w.step(w.fixedDt);
  w.dispose();
});

test("optional three helpers copy geometry and own disposable debug buffers", async () => {
  const { BoxGeometry } = await import("three");
  const { geometryShape, PhysicsDebug } = await import("../dist/Three.js");
  const geometry = new BoxGeometry(1, 1, 1),
    shape = geometryShape(geometry),
    hull = geometryShape(geometry, "convex");
  assert.equal(shape.kind, "mesh");
  assert.equal(hull.kind, "convex");
  const w = createWorld(options);
  w.createBody({ type: "static", colliders: [{ shape }] });
  const debug = new PhysicsDebug();
  debug.update(w);
  assert.ok(debug.geometry.getAttribute("position").count > 0);
  debug.dispose();
  geometry.dispose();
  w.dispose();
});

test("explicit body mass is total mass and retains shape inertia", () => {
  const w = createWorld({ gravity: v() });
  const b = w.createBody({
    type: "dynamic",
    mass: 5,
    colliders: [{ shape: box() }],
  });
  w.impulse(b, v(10));
  assert.equal(w.bodyState(b).velocity.x, 2);
  w.impulse(b, v(0, 1), v(1));
  w.step(w.fixedDt);
  assert.ok(Math.abs(w.bodyState(b).angularVelocity.z) > 0);
  w.dispose();
});

test("public declarations document members and contain no wrapped-library imports", async () => {
  const ts = (await import("typescript")).default;
  const { readFile } = await import("node:fs/promises");
  for (const name of ["Types", "World", "Engine", "Heightfield", "Three"]) {
    const source = await readFile(
      new URL(`../src/${name}.ts`, import.meta.url),
      "utf8",
    );
    const file = ts.createSourceFile(
      name + ".ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      const member =
        ts.isPropertySignature(node) ||
        ((ts.isMethodDeclaration(node) ||
          ts.isGetAccessor(node) ||
          ts.isConstructorDeclaration(node)) &&
          (!node.name || !ts.isPrivateIdentifier(node.name)));
      if (member && (name !== "World" || !ts.isPropertySignature(node))) {
        assert.ok(
          ts.getJSDocCommentsAndTags(node).length,
          `${name}: ${node.name?.getText(file) ?? "constructor"} needs documentation`,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    const declarations = await readFile(
      new URL(`../dist/${name}.d.ts`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(declarations, /from ['"]@dimforge\//);
  }
  const engine = await import("../dist/Engine.js");
  assert.equal(engine.engine, undefined);
  await assert.rejects(import("@homie-rocks/physics/Shapes.js"), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
  await assert.rejects(import("@homie-rocks/physics/vendor/rapier.js"), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
});

test("coyote jumping works after leaving a walkable ledge", () => {
  const w = createWorld(options);
  w.createBody({ type: "static", colliders: [{ shape: box(1, 0.25, 2) }] });
  const c = w.createCharacter({
    ...character,
    position: v(0, 1.2),
    coyoteTime: 0.12,
  });
  ticks(w, 30);
  w.controlCharacter(c, { x: 3, z: 0 });
  let left = false;
  for (let i = 0; i < 90; i++) {
    w.step(w.fixedDt);
    if (!w.characterState(c).grounded) {
      left = true;
      break;
    }
  }
  assert.equal(left, true);
  w.controlCharacter(c, { x: 3, z: 0, jump: true });
  w.step(w.fixedDt);
  assert.ok(w.characterState(c).verticalVelocity > 0);
  w.dispose();
});

test("ground hysteresis bridges a short seam without granting steep support", () => {
  const run = (groundGrace) => {
    const w = createWorld(options);
    for (const x of [-1.35, 1.35])
      w.createBody({
        type: "static",
        position: v(x),
        colliders: [{ shape: box(1, 0.25, 2) }],
      });
    const c = w.createCharacter({
      ...character,
      position: v(-1.2, 1.2),
      groundGrace,
    });
    ticks(w, 30);
    w.controlCharacter(c, { x: 2, z: 0 });
    let air = 0;
    for (let i = 0; i < 70; i++) {
      w.step(w.fixedDt);
      if (!w.characterState(c).grounded) air++;
    }
    w.dispose();
    return air;
  };
  assert.ok(run(0.1) < run(0));
});

test("nested keys and boolean options cannot silently change a command", () => {
  const w = createWorld(options);
  for (const o of [
    { type: "dynamic", mass: 1, ccd: "false" },
    { type: "dynamic", mass: 1, position: { x: 0, y: 0, z: 0, speed: 2 } },
    { type: "dynamic", mass: 1, lockTranslations: { z: true } },
    {
      type: "static",
      colliders: [
        { shape: box(), layers: { membership: 1, filter: 1, mask: 2 } },
      ],
    },
  ]) {
    assert.throws(() => w.createBody(o), /physics:/);
  }
  w.dispose();
});
