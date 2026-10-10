// Contract: horizontal input is metres/second on every walkable surface.
// Position tolerance is 1% of commanded distance; sole tolerance is 2 cm.
import { each, row, flag, run, cpos, HF } from "./scenario-harness.mjs";
for (const surface of ["box", "mesh", "heightfield", "rolling"]) {
  for (const angle of [0, 45, 90, 135, 180, 225, 270, 315]) {
    for (const offset of [0, 0.23])
      each((a, hz) => {
        const w = a.world();
        const height = (x, s) =>
          surface === "rolling" ? 0.15 * Math.sin(x) * Math.cos(s) : 0;
        if (surface === "box") a.floor(w);
        else if (surface === "mesh") {
          const vertices = [-20, -20, 20, -20, -20, 20, 20, 20].reduce(
            (v, _, i, arr) => {
              if (i % 2 === 0) {
                const p = a.V(arr[i], 0, arr[i + 1]);
                v.push(p.x, p.y, p.z);
              }
              return v;
            },
            [],
          );
          w.createBody({
            type: "static",
            colliders: [
              {
                shape: {
                  kind: "mesh",
                  vertices: new Float32Array(vertices),
                  indices: new Uint32Array(
                    a.up === "y" ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2],
                  ),
                },
              },
            ],
          });
        } else {
          const n = 65,
            heights = new Float32Array(n * n);
          for (let z = 0; z < n; z++)
            for (let x = 0; x < n; x++)
              heights[z * n + x] = height((x - 32) * 0.5, (z - 32) * 0.5);
          w.createBody({
            type: "static",
            colliders: [
              HF.heightfieldGrid(
                { nx: n, nz: n, cell: 0.5, x0: -16, z0: -16, heights },
                "x-fast",
                a.up,
              ),
            ],
          });
        }
        const c = a.chr(w, offset, 1, offset);
        run(w, hz, 0.5, () => w.controlCharacter(c, a.inp()));
        const start = cpos(w, c),
          vx = 2 * Math.cos((angle * Math.PI) / 180),
          vs = 2 * Math.sin((angle * Math.PI) / 180);
        let distance = 0,
          last = start,
          grounded = true,
          firstUngrounded;
        run(
          w,
          hz,
          2,
          () => w.controlCharacter(c, a.inp(vx, vs)),
          () => {
            const p = cpos(w, c);
            distance += Math.hypot(p.x - last.x, a.s(p) - a.s(last));
            last = p;
            if (!w.characterState(c).grounded)
              firstUngrounded ??= { p, state: w.characterState(c) };
            grounded &&= w.characterState(c).grounded;
          },
        );
        const p = cpos(w, c),
          label = `${surface} ${angle} degrees offset ${offset}`;
        row(`${label}: distance`, a.up, hz, distance, 4, 0.04);
        row(
          `${label}: final horizontal position`,
          a.up,
          hz,
          [p.x, a.s(p)],
          [start.x + 2 * vx, a.s(start) + 2 * vs],
          0.04,
        );
        // A capsule's rounded sole sits slightly above the centre sample on a slope.
        row(
          `${label}: final sole`,
          a.up,
          hz,
          a.h(p) - height(p.x, a.s(p)),
          0.91,
          0.02,
        );
        flag(
          `${label}: grounded and uncrushed`,
          a.up,
          hz,
          grounded && !w.characterState(c).crushed,
          JSON.stringify(firstUngrounded),
        );
        w.dispose();
      });
  }
}
for (const [rise, tread] of [
  [0.18, 0.28],
  [0.2, 0.3],
  [0.25, 0.4],
])
  each((a, hz) => {
    const w = a.world();
    a.floor(w);
    for (let i = 0; i < 8; i++)
      w.createBody({
        type: "static",
        position: a.V(7 + tread * i, rise * (i + 0.5), 0),
        colliders: [{ shape: a.box(5, rise / 2, 4) }],
      });
    const c = a.chr(w);
    run(w, hz, 0.5, () => w.controlCharacter(c, a.inp()));
    for (const direction of [1, -1]) {
      const start = cpos(w, c);
      let distance = 0,
        last = start;
      run(
        w,
        hz,
        4,
        () => w.controlCharacter(c, a.inp(2 * direction)),
        () => {
          const p = cpos(w, c);
          distance += Math.abs(p.x - last.x);
          last = p;
        },
      );
      const p = cpos(w, c),
        s = w.characterState(c),
        label = `stairs ${rise}/${tread} direction ${direction}`;
      row(`${label}: travel`, a.up, hz, distance, 8, 0.08);
      row(
        `${label}: final position`,
        a.up,
        hz,
        [p.x, a.h(p), a.s(p)],
        [direction === 1 ? 8 : 0, 0.91 + (direction === 1 ? 8 * rise : 0), 0],
        0.08,
      );
      flag(`${label}: flags`, a.up, hz, s.grounded && !s.crushed);
    }
    w.dispose();
  });
