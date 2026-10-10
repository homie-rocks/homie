// Steps, slopes, ledges, heightfield edges and seams, in four world configurations, because the controller
// must behave identically with unrelated heightfields and kinematic bodies present.
import {
  ax,
  HZ,
  UPS,
  row,
  flag,
  run,
  cpos,
  summary,
  HF,
} from "./scenario-harness.mjs";
const CONFIGS = ["plain", "+hf", "+kin", "+both"];
function setup(a, cfg) {
  const w = a.world();
  if (cfg === "+hf" || cfg === "+both")
    w.createBody({
      type: "static",
      position: a.V(500, 0, 500),
      colliders: [
        HF.heightfieldGrid(
          { nx: 3, nz: 3, cell: 1, x0: 0, z0: 0, heights: new Float32Array(9) },
          "x-fast",
          a.up,
        ),
      ],
    });
  if (cfg === "+kin" || cfg === "+both")
    w.createBody({
      type: "kinematic",
      position: a.V(-500, 0, 500),
      colliders: [{ shape: a.box(1, 1, 1) }],
    });
  return w;
}
const slopeQ = (a, deg) => {
  const t = ((deg * Math.PI) / 180) * (a.up === "y" ? 1 : -1);
  return a.up === "y"
    ? { x: 0, y: 0, z: Math.sin(t / 2), w: Math.cos(t / 2) }
    : { x: 0, y: Math.sin(t / 2), z: 0, w: Math.cos(t / 2) };
};
function ramp(a, w, deg, x0 = 2) {
  const t = (deg * Math.PI) / 180,
    L = 6;
  w.createBody({
    type: "static",
    position: a.V(
      x0 + L * Math.cos(t) + 0.5 * Math.sin(t),
      L * Math.sin(t) - 0.5 * Math.cos(t),
      0,
    ),
    rotation: slopeQ(a, deg),
    colliders: [{ shape: a.box(L, 0.5, 4) }],
  });
}
const all = (fn) => {
  for (const cfg of CONFIGS)
    for (const up of UPS)
      for (const hz of HZ) {
        const a = ax(up);
        try {
          fn(a, hz, cfg, setup(a, cfg));
        } catch (e) {
          flag(
            `THREW [${cfg}] ${e.message} ${e.cause?.message ?? ""}`,
            up,
            hz,
            false,
            (e.stack ?? "").split("\n").slice(1, 3).join("|"),
          );
        }
      }
};
const walk = (w, c, a, hz, sec, vx = 2, vs = 0, cb) =>
  run(w, hz, sec, () => w.controlCharacter(c, a.inp(vx, vs)), cb);

all((a, hz, cfg, w) => {
  a.floor(w);
  const c = a.chr(w);
  run(w, hz, 0.5);
  walk(w, c, a, hz, 2);
  row(`[${cfg}] flat floor 2 m/s 2 s: x`, a.up, hz, cpos(w, c).x, 4, 0.05);
  w.dispose();
});
for (const [rise, climbs] of [
  [0.2, true],
  [0.3, true],
  [0.34, true],
  [0.36, false],
  [0.5, false],
])
  all((a, hz, cfg, w) => {
    a.floor(w);
    w.createBody({
      type: "static",
      position: a.V(6, rise / 2, 0),
      colliders: [{ shape: a.box(4, rise / 2, 4) }],
    }); // face at x=2
    const c = a.chr(w);
    run(w, hz, 0.5);
    walk(w, c, a, hz, 2.5);
    const p = cpos(w, c);
    if (climbs)
      row(
        `[${cfg}] single step ${rise} (limit .35): x, h after 2.5 s`,
        a.up,
        hz,
        [p.x, a.h(p)],
        [5, 0.91 + rise],
        0.2,
      );
    else
      row(
        `[${cfg}] ledge ${rise} above step limit: blocked x, h`,
        a.up,
        hz,
        [p.x, a.h(p)],
        [1.69, 0.91],
        0.04,
      );
    w.dispose();
  });
all((a, hz, cfg, w) => {
  // staircase: 8 steps, rise 0.2, run 0.5, first face at x=2
  a.floor(w);
  for (let i = 0; i < 8; i++)
    w.createBody({
      type: "static",
      position: a.V(2 + 0.5 * i + 5, 0.1 + 0.2 * i, 0),
      colliders: [{ shape: a.box(5, 0.1, 4) }],
    });
  const c = a.chr(w);
  run(w, hz, 0.5);
  let ung = 0;
  walk(w, c, a, hz, 4, 2, 0, () => {
    if (!w.characterState(c).grounded) ung++;
  });
  const p = cpos(w, c);
  row(
    `[${cfg}] staircase 8 x 0.2 rise 0.5 run: x, h after 4 s at 2 m/s`,
    a.up,
    hz,
    [p.x, a.h(p)],
    [8, 0.91 + 1.6],
    0.5,
    `ungrounded ticks ${ung}`,
  );
  // and back down
  walk(w, c, a, hz, 4, -2, 0);
  const q = cpos(w, c);
  row(
    `[${cfg}] staircase back down 4 s: x, h`,
    a.up,
    hz,
    [q.x, a.h(q)],
    [0, 0.91],
    0.5,
  );
  w.dispose();
});
for (const deg of [20, 35, 39])
  all((a, hz, cfg, w) => {
    a.floor(w);
    ramp(a, w, deg);
    const c = a.chr(w);
    run(w, hz, 0.5);
    walk(w, c, a, hz, 1.5);
    const p0 = cpos(w, c);
    let ung = 0;
    walk(w, c, a, hz, 1.5, 2, 0, () => {
      if (!w.characterState(c).grounded) ung++;
    });
    const p1 = cpos(w, c);
    const t = (deg * Math.PI) / 180;
    row(
      `[${cfg}] slope ${deg} deg (limit 40.1): horizontal speed, rise/run`,
      a.up,
      hz,
      [(p1.x - p0.x) / 1.5, (a.h(p1) - a.h(p0)) / (p1.x - p0.x)],
      [2, Math.tan(t)],
      2 * (1 - Math.cos(t)) + 0.06,
      `ungrounded ${ung}`,
    );
    // walk back down: must stay grounded (snap), no hopping
    let ungD = 0;
    walk(w, c, a, hz, 1.2, -2, 0, () => {
      if (!w.characterState(c).grounded) ungD++;
    });
    flag(
      `[${cfg}] walk down ${deg} deg slope at 2 m/s stays grounded`,
      a.up,
      hz,
      ungD === 0,
      `ungrounded ticks ${ungD}`,
    );
    w.dispose();
  });
for (const deg of [41, 45, 60])
  all((a, hz, cfg, w) => {
    a.floor(w);
    ramp(a, w, deg);
    const c = a.chr(w);
    run(w, hz, 0.5);
    let maxH = 0,
      maxX = 0;
    run(
      w,
      hz,
      4,
      () => w.controlCharacter(c, a.inp(2, 0, true)),
      () => {
        const p = cpos(w, c);
        maxH = Math.max(maxH, a.h(p));
        maxX = Math.max(maxX, p.x);
      },
    );
    // jump-spam into the over-limit slope: must gain no more than one (buffered) jump: 0.78 above rest, and x no further than where a jump arc touches the face
    const t = (deg * Math.PI) / 180;
    flag(
      `[${cfg}] slope ${deg} deg over limit, walk + jump-spam 4 s: no climbing`,
      a.up,
      hz,
      maxH < 0.91 + 0.85 && maxX < 2 + 0.85 / Math.tan(t) + 0.3,
      `max h ${maxH.toFixed(3)} max x ${maxX.toFixed(3)} final x ${cpos(w, c).x.toFixed(3)} h ${a.h(cpos(w, c)).toFixed(3)} stance ${w.characterState(c).stance}`,
    );
    w.dispose();
  });
all((a, hz, cfg, w) => {
  // ledge: floor top at 0 for x<3, lower floor at -2
  w.createBody({
    type: "static",
    position: a.V(-7, -0.5, 0),
    colliders: [{ shape: a.box(10, 0.5, 4) }],
  });
  a.floor(w, 40, -2);
  const c = a.chr(w);
  run(w, hz, 0.5);
  walk(w, c, a, hz, 3);
  const p = cpos(w, c),
    s = w.characterState(c);
  // leaves the edge at x~3.3 (t=1.65); fall 2 m takes 0.447 s; air control keeps 2 m/s -> x = 6
  row(
    `[${cfg}] walk off a 2 m ledge: x, h after 3 s`,
    a.up,
    hz,
    [p.x, a.h(p)],
    [6, -2 + 0.91],
    0.12,
    `grounded=${s.grounded}`,
  );
  w.dispose();
});
all((a, hz, cfg, w) => {
  // low ceiling 1.7 m: blocked
  a.floor(w);
  w.createBody({
    type: "static",
    position: a.V(6, 1.7 + 0.5, 0),
    colliders: [{ shape: a.box(4, 0.5, 4) }],
  });
  const c = a.chr(w);
  run(w, hz, 0.5);
  walk(w, c, a, hz, 2.5);
  const p = cpos(w, c);
  flag(
    `[${cfg}] ceiling at 1.7 m (capsule 1.8): blocked at the lip, not wedged under`,
    a.up,
    hz,
    p.x < 2.0 && Math.abs(a.h(p) - 0.91) < 0.03,
    `x ${p.x.toFixed(3)} h ${a.h(p).toFixed(3)}`,
  );
  walk(w, c, a, hz, 1, -2, 0);
  row(
    `[${cfg}] then walk away 1 s: dx`,
    a.up,
    hz,
    cpos(w, c).x - p.x,
    -2,
    0.08,
  );
  w.dispose();
});
// Heightfields
const hf = (a, nx, nz, cell, x0, z0, fn) => {
  const h = new Float32Array(nx * nz);
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++)
      h[z * nx + x] = fn(x0 + x * cell, z0 + z * cell);
  return HF.heightfieldGrid(
    { nx, nz, cell, x0, z0, heights: h },
    "x-fast",
    a.up,
  );
};
for (const cfg of ["hf", "hf+kin"])
  for (const up of UPS)
    for (const hz of HZ) {
      const a = ax(up);
      const mk = () => {
        const w = a.world();
        if (cfg === "hf+kin")
          w.createBody({
            type: "kinematic",
            position: a.V(-500, 0, 500),
            colliders: [{ shape: a.box(1, 1, 1) }],
          });
        return w;
      };
      try {
        // flat heightfield, walk exactly along a grid line, a cell diagonal, and an off-grid line
        for (const [name, sx, ss, vx, vs] of [
          ["along grid line s=0", -6, 0, 2, 0],
          ["along cell centre s=0.5", -6, 0.5, 2, 0],
          ["along diagonal through vertices", -4, -4, 1.5, 1.5],
          ["along anti-diagonal", -4, 4, 1.5, -1.5],
          ["along s axis on grid line x=0", 0, -6, 0, 2],
        ]) {
          const w = mk();
          w.createBody({
            type: "static",
            colliders: [hf(a, 17, 17, 1, -8, -8, () => 0)],
          });
          const c = a.chr(w, sx, 1, ss);
          run(w, hz, 0.5);
          let ung = 0,
            minH = 9,
            maxH = -9;
          walk(w, c, a, hz, 3, vx, vs, () => {
            const h = a.h(cpos(w, c));
            minH = Math.min(minH, h);
            maxH = Math.max(maxH, h);
            if (!w.characterState(c).grounded) ung++;
          });
          const p = cpos(w, c);
          row(
            `[${cfg}] flat heightfield ${name}: (dx, ds) 3 s`,
            up,
            hz,
            [p.x - sx, a.s(p) - ss],
            [vx * 3, vs * 3],
            0.08,
            `h ${minH.toFixed(3)}..${maxH.toFixed(3)} ungrounded ${ung}`,
          );
          flag(
            `[${cfg}] ${name}: height steady, grounded`,
            up,
            hz,
            ung === 0 && maxH - minH < 0.02 && Math.abs(maxH - 0.91) < 0.03,
            `h ${minH.toFixed(3)}..${maxH.toFixed(3)} ungrounded ${ung}`,
          );
          w.dispose();
        }
        // seam: heightfield (x -8..0) next to a box floor (x 0..8) at the same height, and next to another heightfield
        for (const other of ["box", "heightfield"]) {
          const w = mk();
          w.createBody({
            type: "static",
            colliders: [hf(a, 9, 9, 1, -8, -4, () => 0)],
          });
          if (other === "box")
            w.createBody({
              type: "static",
              position: a.V(4, -0.5, 0),
              colliders: [{ shape: a.box(4, 0.5, 4) }],
            });
          else
            w.createBody({
              type: "static",
              colliders: [hf(a, 9, 9, 1, 0, -4, () => 0)],
            });
          const c = a.chr(w, -3, 1, 0.3);
          run(w, hz, 0.5);
          let ung = 0,
            minH = 9,
            maxH = -9;
          walk(w, c, a, hz, 3, 2, 0, () => {
            const h = a.h(cpos(w, c));
            minH = Math.min(minH, h);
            maxH = Math.max(maxH, h);
            if (!w.characterState(c).grounded) ung++;
          });
          const p = cpos(w, c);
          row(
            `[${cfg}] heightfield -> ${other} seam at x=0: x after 3 s, back`,
            up,
            hz,
            [p.x, (walk(w, c, a, hz, 3, -2, 0), cpos(w, c).x)],
            [3, -3],
            0.1,
            `h ${minH.toFixed(3)}..${maxH.toFixed(3)} ungrounded ${ung}`,
          );
          w.dispose();
        }
        // walk off the heightfield edge into the void and onto a floor 1 m lower
        {
          const w = mk();
          w.createBody({
            type: "static",
            colliders: [hf(a, 9, 9, 1, -8, -4, () => 0)],
          });
          a.floor(w, 40, -1);
          const c = a.chr(w, -3, 1, 0);
          run(w, hz, 0.5);
          walk(w, c, a, hz, 3);
          const p = cpos(w, c);
          row(
            `[${cfg}] walk off heightfield edge to floor 1 m below: x, h`,
            up,
            hz,
            [p.x, a.h(p)],
            [3, -0.09],
            0.12,
          );
          w.dispose();
        }
        // rolling terrain (max slope ~17 deg): horizontal distance and feet-to-ground error at the end
        {
          const f = (x, z) => 0.6 * Math.sin(x * 0.5) * Math.cos(z * 0.5);
          const w = mk();
          w.createBody({
            type: "static",
            colliders: [hf(a, 65, 65, 0.5, -16, -16, f)],
          });
          const c = a.chr(w, -10, 2, 0.25);
          run(w, hz, 1);
          let ung = 0,
            worst = 0,
            n = 0;
          const x0 = cpos(w, c).x;
          walk(w, c, a, hz, 8, 2, 0.5, () => {
            n++;
            if (!w.characterState(c).grounded) ung++;
          });
          const p = cpos(w, c);
          row(
            `[${cfg}] rolling heightfield, 8 s at (2, 0.5) m/s: (dx, ds)`,
            up,
            hz,
            [p.x - x0, a.s(p) - 0.25],
            [16, 4],
            0.4,
            `ungrounded ${ung}/${n} ticks, feet above terrain ${(a.h(p) - 0.9 - f(p.x, a.s(p))).toFixed(3)}`,
          );
          flag(
            `[${cfg}] rolling heightfield: grounded >= 95% of ticks`,
            up,
            hz,
            ung <= n * 0.05,
            `ungrounded ${ung}/${n}`,
          );
          w.dispose();
        }
        // terrain with a cliff steeper than the limit (sample step of 2 m over one 0.5 m cell = 76 deg): no climbing even with jump-spam
        {
          const w = mk();
          w.createBody({
            type: "static",
            colliders: [hf(a, 33, 9, 0.5, -8, -2, (x) => (x >= 2 ? 2 : 0))],
          });
          const c = a.chr(w, 0, 1, 0.25);
          run(w, hz, 0.5);
          let maxH = 0,
            maxX = 0;
          run(
            w,
            hz,
            4,
            () => w.controlCharacter(c, a.inp(2, 0, true)),
            () => {
              const p = cpos(w, c);
              maxH = Math.max(maxH, a.h(p));
              maxX = Math.max(maxX, p.x);
            },
          );
          flag(
            `[${cfg}] heightfield cliff 76 deg, walk + jump-spam 4 s: no climbing`,
            up,
            hz,
            maxH < 0.91 + 0.85 && maxX < 2.0,
            `max h ${maxH.toFixed(3)} max x ${maxX.toFixed(3)}`,
          );
          w.dispose();
        }
      } catch (e) {
        flag(
          `THREW [${cfg}] ${e.message} ${e.cause?.message ?? ""}`,
          up,
          hz,
          false,
          (e.stack ?? "").split("\n").slice(1, 3).join("|"),
        );
      }
    }
summary();
