// Determinism scene shared by Node, Chrome (studio build) and workerd. No Node APIs.
// api = { createWorld, seeded, heightfieldGrid }
export function fnv(bytes, h = 0x811c9dc5) {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const enc = new TextEncoder();
// Arithmetic-only sine and cosine: Math.sin/Math.cos differ in the last bit between Node's and workerd's V8,
// which would feed the two runtimes different commands. +, *, /, floor and abs are exact everywhere.
const PI = 3.141592653589793;
export function dsin(x) {
  x = x - 2 * PI * Math.floor((x + PI) / (2 * PI));
  const a = Math.abs(x),
    y = (16 * a * (PI - a)) / (5 * PI * PI - 4 * a * (PI - a));
  return x < 0 ? -y : y;
}
export function dcos(x) {
  return dsin(x + PI / 2);
}
export function build(api, up) {
  const V = (x = 0, h = 0, s = 0) =>
    up === "y" ? { x, y: h, z: s } : { x, y: s, z: h };
  const box = (x, h, s) => ({ kind: "box", halfExtents: V(x, h, s) });
  const yaw = (a) => {
    let s = dsin(a / 2),
      c = dcos(a / 2);
    const n = Math.sqrt(s * s + c * c);
    s /= n;
    c /= n;
    return up === "y" ? { x: 0, y: s, z: 0, w: c } : { x: 0, y: 0, z: s, w: c };
  };
  const w = api.createWorld({ up, random: api.seeded(777), killPlane: -30 });
  const N = 33,
    hts = new Float32Array(N * N);
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++)
      hts[z * N + x] = ((x * 7 + z * 13) % 11) * 0.05 + ((x ^ z) & 3) * 0.04;
  w.createBody({
    type: "static",
    colliders: [
      api.heightfieldGrid(
        { nx: N, nz: N, cell: 1, x0: -16, z0: -16, heights: hts },
        "x-fast",
        up,
      ),
    ],
  });
  w.createBody({
    type: "static",
    position: V(40, -0.5, 0),
    colliders: [box(14, 0.5, 14)].map((shape) => ({ shape })),
  });
  const zone = w.createBody({
    type: "static",
    position: V(40, 1, 0),
    colliders: [{ shape: box(4, 1, 4), sensor: true }],
  });
  const S = {
    w,
    V,
    yaw,
    up,
    dyn: [],
    chars: [],
    zone,
    zoneCol: w.colliders(zone)[0],
  };
  for (let i = 0; i < 44; i++)
    S.dyn.push(
      w.createBody({
        type: "dynamic",
        position: V(
          36 + (i % 6) * 1.1,
          0.6 + Math.floor(i / 6) * 1.2,
          -3 + (i % 5) * 1.3,
        ),
        colliders: [
          {
            shape:
              i % 3 === 0
                ? { kind: "sphere", radius: 0.4 }
                : i % 3 === 1
                  ? box(0.4, 0.4, 0.4)
                  : { kind: "capsule", radius: 0.25, halfHeight: 0.3 },
            restitution: (i % 4) * 0.1,
            friction: 0.3 + (i % 3) * 0.2,
          },
        ],
      }),
    );
  // joints: a chain hanging from a static anchor with each kind
  const anchor = w.createBody({ type: "static", position: V(50, 6, 6) });
  let prev = anchor;
  S.joints = [];
  for (const [i, kind] of [
    "ball",
    "hinge",
    "slider",
    "fixed",
    "ball",
    "hinge",
  ].entries()) {
    const b = w.createBody({
      type: "dynamic",
      position: V(50 + (i + 1) * 0.8, 6, 6),
      colliders: [{ shape: box(0.3, 0.15, 0.15) }],
    });
    const base = {
      bodyA: prev,
      bodyB: b,
      anchorA: i === 0 ? V() : V(0.4, 0, 0),
      anchorB: V(-0.4, 0, 0),
    };
    S.joints.push(
      w.createJoint(
        kind === "ball"
          ? { ...base, kind }
          : kind === "fixed"
            ? { ...base, kind }
            : {
                ...base,
                kind,
                axis: up === "y" ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 },
                limits: kind === "hinge" ? [-1, 1] : [-0.2, 0.2],
              },
      ),
    );
    S.dyn.push(b);
    prev = b;
  }
  S.plat = w.createBody({
    type: "kinematic",
    position: V(30, 1.75, 10),
    colliders: [{ shape: box(3, 0.25, 3) }],
  });
  S.wall = w.createBody({
    type: "kinematic",
    position: V(47, 1, -6),
    colliders: [{ shape: box(0.25, 1, 2) }],
  });
  const chr = (x, h, s) =>
    w.createCharacter({
      position: V(x, h, s),
      radius: 0.3,
      height: 1.8,
      stepHeight: 0.35,
      stepMinWidth: 0.2,
      slopeLimit: 0.7,
      snapDistance: 0.2,
      offset: 0.01,
      gravity: 20,
      jumpSpeed: 5,
      acceleration: 30,
      braking: 40,
      groundGrace: 0.05,
    });
  S.chars.push(chr(30, 3, 10), chr(0, 3, 0), chr(33, 1, 0), chr(45, 1, -6));
  return S;
}
// commands for tick k (applied before the step of tick k). Pure function of k and world.random().
export function commands(S, k) {
  const { w, V, yaw, up } = S;
  const t = (k + 1) / 20;
  const inp = (x, s, jump) =>
    up === "y" ? { x, z: s, jump } : { x, y: s, jump };
  w.moveKinematic(
    S.plat,
    V(
      30 + 3 * dsin(t * 0.8),
      1.75 + 0.5 * dsin(t * 0.5),
      10 + 2 * dcos(t * 0.8),
    ),
    yaw(t * 0.4),
  );
  w.moveKinematic(S.wall, V(47 - 2 * (1 - dcos(t * 0.9)), 1, -6));
  const c = S.chars;
  const on = (id) => w.hasCharacter(id);
  if (on(c[0]))
    w.controlCharacter(
      c[0],
      inp(1.5 * dcos(t * 2), 1.5 * dsin(t * 1.3), k % 37 === 5),
    );
  if (on(c[1]))
    w.controlCharacter(
      c[1],
      inp(2 * dcos(t * 0.3), 2 * dsin(t * 0.3), k % 53 === 7),
    );
  if (on(c[2])) w.controlCharacter(c[2], inp(2, 0.3 * dsin(t), false));
  if (on(c[3])) w.controlCharacter(c[3], inp(1, 0, k % 41 === 3));
  const pick = () => S.dyn[Math.floor(w.random() * S.dyn.length)];
  if (k % 9 === 4) {
    const b = pick();
    if (w.hasBody(b))
      w.impulse(b, V(w.random() * 6 - 3, 4, w.random() * 6 - 3));
  }
  if (k % 31 === 11) {
    const b = S.dyn.splice(Math.floor(w.random() * 40), 1)[0];
    if (w.hasBody(b)) w.removeBody(b);
  } // pending end events
  if (k % 23 === 6)
    S.dyn.push(
      w.createBody({
        type: "dynamic",
        position: V(38 + w.random() * 4, 5, w.random() * 4 - 2),
        colliders: [{ shape: { kind: "sphere", radius: 0.3 } }],
      }),
    );
  if (k % 29 === 13) {
    const b = pick();
    if (w.hasBody(b))
      w.updateCollider(w.colliders(b)[0], {
        layers: { membership: 1 + (k % 3), filter: 0xffff },
      });
  } // pending filter change
  if (k % 47 === 20)
    w.updateCollider(S.zoneCol, {
      layers: { membership: 1 << (k % 2), filter: 0xffff },
    });
  if (k % 43 === 17) {
    const b = pick();
    if (w.hasBody(b)) w.teleport(b, V(40 + w.random() * 2, 4, w.random() * 2));
  }
  if (k % 61 === 30) {
    const b = pick();
    if (w.hasBody(b)) w.sleep(b);
  }
  if (k === 150 && S.joints.length) w.removeJoint(S.joints.pop());
  if (k % 17 === 2) w.raycast(V(40, 10, 0), V(0, -1, 0), 20); // queries must not disturb state
  for (let i = S.dyn.length - 1; i >= 0; i--)
    if (!w.hasBody(S.dyn[i])) S.dyn.splice(i, 1);
}
