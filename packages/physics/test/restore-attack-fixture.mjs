// Independent restore attack, runtime-neutral (Node, browser, workerd). Generator: xoshiro128** seeded by splitmix32.
// runSeed(api, seed, up, opts) -> { ticks, forks: [{ at, mode, firstDivergence, kind }], digest, ops, errors }
function sm32(a) {
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}
function rng(seed) {
  const s = sm32(seed);
  let a = s(),
    b = s(),
    c = s(),
    d = s();
  const next = () => {
    const r =
      Math.imul((Math.imul(b, 5) << 7) | (Math.imul(b, 5) >>> 25), 9) >>> 0;
    const t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = (d << 11) | (d >>> 21);
    return r / 4294967296;
  };
  const R = {
    f: (lo = 0, hi = 1) => lo + (hi - lo) * next(),
    i: (n) => Math.floor(next() * n),
    p: (x) => next() < x,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
  return R;
}
// Sine and cosine from +, * and floor only: Math.sin differs in the last bit between Node 22 and workerd (measured), which would make the two runtimes issue different commands.
function psin(x) {
  const T = 6.283185307179586;
  x = x - T * Math.floor(x / T + 0.5);
  const q = x * x;
  return (
    x *
    (1 +
      q *
        (-1 / 6 +
          q *
            (1 / 120 +
              q *
                (-1 / 5040 +
                  q *
                    (1 / 362880 +
                      q *
                        (-1 / 39916800 +
                          q *
                            (1 / 6227020800 +
                              q *
                                (-1 / 1307674368000 +
                                  q / 355687428096000))))))))
  );
}
const pcos = (x) => psin(x + 1.5707963267948966);
const f64 = new Float64Array(1),
  u32 = new Uint32Array(f64.buffer);
function hasher() {
  let h1 = 0x811c9dc5,
    h2 = 0x1b873593;
  const mix = (x) => {
    h1 = Math.imul(h1 ^ x, 0x01000193);
    h2 = Math.imul(((h2 << 5) | (h2 >>> 27)) ^ x, 0x85ebca6b);
  };
  return {
    num: (v) => {
      f64[0] = v;
      mix(u32[0]);
      mix(u32[1]);
    },
    str: (s) => {
      for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
    },
    out: () =>
      (h1 >>> 0).toString(16).padStart(8, "0") +
      (h2 >>> 0).toString(16).padStart(8, "0"),
  };
}
export function makeRun(api, seed, up) {
  const V = (a = 0, h = 0, b = 0) =>
    up === "y" ? { x: a, y: h, z: b } : { x: a, y: b, z: h };
  const g = rng((seed * 2654435761) >>> 0);
  const dt = g.pick([1 / 60, 1 / 30, 1 / 20, 1 / 50, 1 / 24, 0.031]);
  const ground = g.pick(["box", "terrain", "mesh", "tiles"]);
  const cfg = {
    dt,
    ground,
    nBodies: 6 + g.i(18),
    nChars: 1 + g.i(3),
    nPlat: g.i(3),
    fixedDt: g.pick([1 / 60, 1 / 60, 1 / 120]),
  };
  const hfn = (a, b) => 0.5 * psin(a * 0.5 + seed) * pcos(b * 0.4);
  const charOpts = (a, h, b) => ({
    position: V(a, h, b),
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
  });
  const shape = (r) => {
    const k = r.i(4);
    if (k === 0)
      return {
        kind: "box",
        halfExtents: {
          x: r.f(0.15, 0.5),
          y: r.f(0.15, 0.5),
          z: r.f(0.15, 0.5),
        },
      };
    if (k === 1) return { kind: "sphere", radius: r.f(0.15, 0.45) };
    if (k === 2)
      return {
        kind: "capsule",
        radius: r.f(0.15, 0.3),
        halfHeight: r.f(0.1, 0.4),
      };
    const v = new Float32Array(24);
    for (let i = 0; i < 8; i++) {
      v[i * 3] = (i & 1 ? 1 : -1) * r.f(0.15, 0.4);
      v[i * 3 + 1] = (i & 2 ? 1 : -1) * r.f(0.15, 0.4);
      v[i * 3 + 2] = (i & 4 ? 1 : -1) * r.f(0.15, 0.4);
    }
    return { kind: "convex", vertices: v };
  };
  // build(world) -> script state; must be deterministic
  function build(w) {
    const S = {
      bodies: [],
      joints: [],
      chars: [],
      plats: [],
      zone: 0,
      errors: 0,
      ops: 0,
    };
    if (ground === "box")
      w.createBody({
        type: "static",
        position: V(0, -0.5, 0),
        colliders: [{ shape: { kind: "box", halfExtents: V(14, 0.5, 14) } }],
      });
    else if (ground === "tiles")
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          w.createBody({
            type: "static",
            position: V(i * 9, -0.5, j * 9),
            colliders: [
              { shape: { kind: "box", halfExtents: V(4.5, 0.5, 4.5) } },
            ],
          });
    else if (ground === "terrain") {
      const n = 29,
        heights = new Float32Array(n * n);
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) heights[j * n + i] = hfn(-14 + i, -14 + j);
      w.createBody({
        type: "static",
        colliders: [
          api.HF.heightfieldGrid(
            { nx: n, nz: n, cell: 1, x0: -14, z0: -14, heights },
            "x-fast",
          ),
        ],
      });
    } else {
      const P = [
        [-14, 0, -14],
        [14, 0, -14],
        [-14, 0, 14],
        [14, 0, 14],
      ].map((p) => V(...p));
      const vertices = new Float32Array(P.flatMap((p) => [p.x, p.y, p.z]));
      w.createBody({
        type: "static",
        colliders: [
          {
            shape: {
              kind: "mesh",
              vertices,
              indices: new Uint32Array(
                up === "y" ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2],
              ),
            },
          },
        ],
      });
    }
    for (const [a, b, ha, hb] of [
      [14.5, 0, 0.5, 15],
      [-14.5, 0, 0.5, 15],
      [0, 14.5, 15, 0.5],
      [0, -14.5, 15, 0.5],
    ])
      w.createBody({
        type: "static",
        position: V(a, 2, b),
        colliders: [{ shape: { kind: "box", halfExtents: V(ha, 4, hb) } }],
      });
    S.zone = w.createBody({
      type: "static",
      position: V(3, 1, 3),
      colliders: [
        { shape: { kind: "box", halfExtents: V(2, 1.5, 2) }, sensor: true },
      ],
    });
    for (let i = 0; i < cfg.nBodies; i++)
      S.bodies.push(
        w.createBody({
          type: "dynamic",
          mass: g.f(0.5, 20),
          position: V(g.f(-9, 9), g.f(1.2, 5), g.f(-9, 9)),
          ccd: g.p(0.2),
          colliders: [
            { shape: shape(g), friction: g.f(0, 1), restitution: g.f(0, 0.6) },
          ],
        }),
      );
    for (let i = 0; i < cfg.nPlat; i++)
      S.plats.push({
        id: w.createBody({
          type: "kinematic",
          position: V(-6 + i * 6, 0.9, -8),
          colliders: [
            { shape: { kind: "box", halfExtents: V(1.5, 0.2, 1.5) } },
          ],
        }),
        a0: -6 + i * 6,
        ph: g.f(0, 6),
        sp: g.f(0.5, 2),
        vert: g.p(0.4),
        spin: g.p(0.4) ? g.f(-1, 1) : 0,
      });
    for (let i = 0; i < cfg.nChars; i++)
      S.chars.push({
        id: w.createCharacter(
          charOpts(
            -4 + i * 3,
            i < cfg.nPlat ? 2.2 : 2.6,
            i < cfg.nPlat ? -8 : 0,
          ),
        ),
        ia: 0,
        ib: 0,
      });
    for (let i = 0; i + 1 < S.bodies.length && i < 6; i += 2)
      if (g.p(0.6)) joint(w, S, g, S.bodies[i], S.bodies[i + 1]);
    return S;
  }
  function joint(w, S, r, A, B) {
    const kind = r.pick(["fixed", "ball", "hinge", "slider"]);
    const o = {
      kind,
      bodyA: A,
      bodyB: B,
      anchorA: { x: r.f(-0.5, 0.5), y: 0.6, z: 0 },
      anchorB: { x: 0, y: -0.6, z: r.f(-0.5, 0.5) },
    };
    if (kind === "hinge" || kind === "slider") {
      o.axis = r.pick([
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
      ]);
      if (r.p(0.5)) o.limits = [-0.6, 0.8];
    }
    if (r.p(0.3)) o.contacts = true;
    S.joints.push(w.createJoint(o));
  }
  const attempt = (S, H, fn) => {
    S.ops++;
    try {
      const r = fn();
      if (r !== undefined)
        H.str(typeof r === "number" ? "n" + r : JSON.stringify(r));
    } catch (e) {
      S.errors++;
      H.str("E:" + (e?.message ?? e));
      if (/engine failed/.test(e?.message ?? "")) throw e;
    }
  };
  // commands for outer tick t; depends only on (seed, t) and S
  function ops(w, S, t, H) {
    const r = rng((seed * 7919 + t * 104729 + 13) >>> 0);
    const live = () => S.bodies.filter((b) => w.hasBody(b));
    let L = live();
    const any = () => r.pick(L);
    for (const p of S.plats) {
      const T = (t + 1) * dt;
      attempt(S, H, () => {
        const q = p.spin
          ? (() => {
              const a = (p.spin * T) / 2;
              return up === "y"
                ? { x: 0, y: psin(a), z: 0, w: pcos(a) }
                : { x: 0, y: 0, z: psin(a), w: pcos(a) };
            })()
          : undefined;
        w.moveKinematic(
          p.id,
          V(
            p.a0 + (p.vert ? 0 : 2 * psin(p.sp * T + p.ph)),
            0.9 + (p.vert ? 1 + psin(p.sp * T + p.ph) : 0),
            -8 + (p.vert ? 0 : psin(0.7 * p.sp * T)),
          ),
          q,
        );
      });
    }
    for (const c of S.chars) {
      if (!w.hasCharacter(c.id)) continue;
      if (r.p(0.12)) {
        const a = r.f(0, 6.2832),
          s = r.pick([0, 2, 2, 4, 6]);
        c.ia = s * pcos(a);
        c.ib = s * psin(a);
      }
      const jump = r.p(0.06);
      attempt(S, H, () =>
        w.controlCharacter(
          c.id,
          up === "y" ? { x: c.ia, z: c.ib, jump } : { x: c.ia, y: c.ib, jump },
        ),
      );
    }
    if (r.p(0.06))
      attempt(S, H, () => {
        const id = w.createBody({
          type: "dynamic",
          mass: r.f(0.5, 20),
          position: V(r.f(-9, 9), r.f(3, 6), r.f(-9, 9)),
          ccd: r.p(0.2),
          canSleep: !r.p(0.1),
          colliders: [{ shape: shape(r), friction: r.f(0, 1) }],
        });
        S.bodies.push(id);
        return id;
      });
    L = live();
    if (L.length > 4 && r.p(0.05))
      attempt(S, H, () => {
        const b = any();
        w.removeBody(b);
      });
    L = live();
    if (!L.length) return;
    if (r.p(0.12))
      attempt(S, H, () =>
        w.impulse(any(), V(r.f(-30, 30), r.f(0, 40), r.f(-30, 30))),
      );
    if (r.p(0.03))
      attempt(S, H, () =>
        w.setVelocity(any(), V(r.f(-5, 5), r.f(0, 5), r.f(-5, 5)), {
          x: r.f(-3, 3),
          y: r.f(-3, 3),
          z: r.f(-3, 3),
        }),
      );
    if (r.p(0.02))
      attempt(S, H, () =>
        w.teleport(any(), V(r.f(-9, 9), r.f(2, 5), r.f(-9, 9))),
      );
    if (r.p(0.04))
      attempt(S, H, () => {
        const cs = w.colliders(any());
        w.updateCollider(
          r.pick(cs),
          r.pick([
            { friction: r.f(0, 1) },
            { restitution: r.f(0, 1) },
            { layers: { membership: 1 + r.i(3), filter: 0xffff } },
            { layers: { membership: 0xffff, filter: 0xffff } },
          ]),
        );
      });
    if (r.p(0.03))
      attempt(S, H, () =>
        w.updateBody(
          any(),
          r.pick([
            { gravityScale: r.f(0, 2) },
            { linearDamping: r.f(0, 2) },
            { angularDamping: r.f(0, 2) },
            { ccd: r.p(0.5) },
            { lockTranslations: { x: r.p(0.3), y: false, z: r.p(0.3) } },
          ]),
        ),
      );
    if (r.p(0.05)) attempt(S, H, () => w.sleep(any()));
    if (r.p(0.03)) attempt(S, H, () => w.wake(any()));
    if (r.p(0.03))
      attempt(S, H, () =>
        w.force(any(), V(r.f(-20, 20), r.f(0, 30), r.f(-20, 20))),
      );
    if (r.p(0.02))
      attempt(S, H, () =>
        w.torque(any(), { x: r.f(-5, 5), y: r.f(-5, 5), z: r.f(-5, 5) }),
      );
    if (r.p(0.03)) attempt(S, H, () => w.clearForces(any()));
    if (L.length > 1 && r.p(0.03))
      attempt(S, H, () => {
        const A = any();
        let B = any();
        if (A === B) B = L[(L.indexOf(A) + 1) % L.length];
        joint(w, S, r, A, B);
      });
    if (r.p(0.03))
      attempt(S, H, () => {
        const js = S.joints.filter((j) => w.hasJoint(j));
        if (js.length) w.removeJoint(r.pick(js));
      });
    if (r.p(0.02))
      attempt(S, H, () =>
        w.createCollider(any(), {
          shape: { kind: "sphere", radius: r.f(0.1, 0.3) },
          position: { x: r.f(-0.4, 0.4), y: r.f(-0.4, 0.4), z: 0 },
        }),
      );
    if (r.p(0.015))
      attempt(S, H, () => {
        const cs = w.colliders(any());
        if (cs.length > 1) w.removeCollider(cs[cs.length - 1]);
      });
    if (r.p(0.01))
      attempt(S, H, () => {
        const id = w.createCharacter(
          charOpts(r.f(-8, 8), r.f(3, 5), r.f(-8, 8)),
        );
        S.chars.push({ id, ia: 0, ib: 0 });
        return id;
      });
    if (r.p(0.006))
      attempt(S, H, () => {
        const cs = S.chars.filter((c) => w.hasCharacter(c.id));
        if (cs.length > 1) w.removeCharacter(r.pick(cs).id);
      });
    if (r.p(0.1))
      attempt(S, H, () =>
        w.raycast(V(r.f(-9, 9), 8, r.f(-9, 9)), V(0, -1, 0), 20),
      );
    if (r.p(0.05))
      attempt(S, H, () =>
        w.overlaps(
          { kind: "sphere", radius: 1.5 },
          V(r.f(-9, 9), 1, r.f(-9, 9)),
        ),
      );
    if (r.p(0.03))
      attempt(S, H, () =>
        w.castShape(
          { kind: "sphere", radius: 0.4 },
          V(r.f(-9, 9), 6, r.f(-9, 9)),
          V(0, -8, 0),
        ),
      );
    if (r.p(0.03)) attempt(S, H, () => w.random());
  }
  function digest(w, S, H, events) {
    for (const b of S.bodies) {
      if (!w.hasBody(b)) {
        H.str("x");
        continue;
      }
      const s = w.bodyState(b);
      for (const v of [s.position, s.rotation, s.velocity, s.angularVelocity]) {
        H.num(v.x);
        H.num(v.y);
        H.num(v.z);
        if ("w" in v) H.num(v.w);
      }
      H.str(s.sleeping ? "S" : "A");
    }
    for (const p of S.plats) {
      const s = w.bodyState(p.id);
      H.num(s.position.x);
      H.num(s.position.y);
      H.num(s.position.z);
      H.num(s.rotation.w);
    }
    for (const c of S.chars) {
      if (!w.hasCharacter(c.id)) {
        H.str("x");
        continue;
      }
      const s = w.characterState(c.id);
      const b = w.bodyState(s.body);
      H.num(b.position.x);
      H.num(b.position.y);
      H.num(b.position.z);
      H.num(s.verticalVelocity);
      H.num(s.facing.x);
      H.num(s.facing.y);
      H.num(s.facing.z);
      H.str(
        `${s.grounded}${s.platform}${s.stance}${s.crushed}${s.jumped}${s.landed}${s.landingSpeed}${s.hits.join(",")}`,
      );
    }
    for (const e of events)
      H.str(
        `${e.kind}${e.started}${e.colliderA}:${e.colliderB}:${e.tick}:${e.reason ?? ""}`,
      );
    return H.out();
  }
  const cloneS = (S) => JSON.parse(JSON.stringify(S));
  return {
    cfg,
    build,
    ops,
    digest,
    cloneS,
    opts: {
      up,
      fixedDt: cfg.fixedDt,
      maxSubsteps: 16,
      random: api.seeded(seed),
    },
  };
}
export function runSeed(
  api,
  seed,
  up,
  { ticks = 520, after = 300, forks = 4, perturb = false } = {},
) {
  const R = makeRun(api, seed, up);
  const g = rng(seed ^ 0x5bd1e995);
  const w = api.createWorld(R.opts);
  const S = R.build(w);
  const forkAt = [];
  for (let i = 0; i < forks; i++)
    forkAt.push({
      at: 1 + g.i(ticks - after - 1),
      mode: g.pick([
        "after-commands",
        "tick-boundary",
        "tick-boundary",
        "twice",
      ]),
    });
  const dig = [];
  const saves = [];
  for (let t = 0; t < ticks; t++) {
    for (const f of forkAt)
      if (f.at === t && f.mode !== "after-commands")
        saves.push({
          ...f,
          bytes:
            f.mode === "twice"
              ? (() => {
                  const b = w.snapshot();
                  w.snapshot();
                  return b;
                })()
              : w.snapshot(),
          S: R.cloneS(S),
          pre: false,
        });
    const H = hasher();
    R.ops(w, S, t, H);
    for (const f of forkAt)
      if (f.at === t && f.mode === "after-commands")
        saves.push({
          ...f,
          bytes: w.snapshot(),
          S: R.cloneS(S),
          pre: true,
          opsHash: H.out(),
        });
    const ev = w.step(R.cfg.dt);
    dig.push(R.digest(w, S, H, ev));
  }
  const finalBytes = w.snapshot().length;
  const out = {
    seed,
    up,
    cfg: R.cfg,
    ticks,
    ops: S.ops,
    errors: S.errors,
    bodies: S.bodies.length,
    digest: dig[dig.length - 1],
    forks: [],
    saveBytes: finalBytes,
  };
  w.dispose();
  for (const f of saves) {
    const w2 = api.createWorld({});
    const res = {
      at: f.at,
      mode: f.mode,
      bytes: f.bytes.length,
      firstDivergence: null,
    };
    try {
      w2.restore(f.bytes);
      const S2 = f.S;
      if (perturb) {
        const b = S2.bodies.find((x) => w2.hasBody(x));
        w2.impulse(b, { x: 1e-5, y: 0, z: 0 });
      }
      for (let t = f.at; t < f.at + after; t++) {
        const H = hasher();
        if (!(f.pre && t === f.at)) R.ops(w2, S2, t, H);
        else {
          /* commands of this tick are inside the save */
        }
        const ev = w2.step(R.cfg.dt);
        const d = R.digest(w2, S2, H, ev);
        if (!(f.pre && t === f.at) && d !== dig[t]) {
          res.firstDivergence = t - f.at;
          break;
        }
        if (f.pre && t === f.at) {
          // digest excludes the op results on this tick: recompute comparable digest by ignoring; compare from next tick
          res.preTick = true;
        }
      }
    } catch (e) {
      res.firstDivergence = -1;
      res.error = String(e?.message ?? e);
    }
    try {
      w2.dispose();
    } catch {}
    out.forks.push(res);
  }
  return out;
}
// A steppable session for hosts that keep a world across requests (a Durable Object).
export function session(api, seed, up, resume) {
  const R = makeRun(api, seed, up);
  let w, S, t;
  if (resume) {
    w = api.createWorld({});
    w.restoreChunks(resume.chunks);
    S = resume.S;
    t = resume.t;
  } else {
    w = api.createWorld(R.opts);
    S = R.build(w);
    t = 0;
  }
  return {
    get t() {
      return t;
    },
    get S() {
      return S;
    },
    world: () => w,
    tick() {
      const H = hasher();
      R.ops(w, S, t, H);
      const ev = w.step(R.cfg.dt);
      t++;
      return R.digest(w, S, H, ev);
    },
    dispose() {
      w.dispose();
    },
  };
}
export function sample(api, seeds, axes = ["y", "z"]) {
  const out = { digests: {}, diverged: [], forks: 0, runs: 0 };
  for (const seed of seeds)
    for (const up of axes) {
      const r = runSeed(api, seed, up);
      out.runs++;
      out.digests[`${seed}${up}`] = r.digest;
      for (const f of r.forks) {
        out.forks++;
        if (f.firstDivergence !== null)
          out.diverged.push(
            `seed ${seed} up=${up} save at ${f.at} (${f.mode}) +${f.firstDivergence} ${f.error ?? ""}`,
          );
      }
    }
  return out;
}
