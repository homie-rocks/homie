// Staircases of ordinary proportions. stepHeight 0.35, radius 0.3. First riser at x=2. 4 s at 2 m/s.
import {
  ax,
  UPS,
  HZ,
  row,
  flag,
  run,
  cpos,
  summary,
} from "./scenario-harness.mjs";
for (const [rise, tread] of [
  [0.18, 0.28],
  [0.2, 0.3],
  [0.25, 0.4],
  [0.2, 0.45],
  [0.2, 0.5],
  [0.2, 0.6],
])
  for (const smw of [0.2, 0.05])
    for (const up of UPS)
      for (const hz of HZ) {
        const a = ax(up),
          w = a.world();
        a.floor(w);
        const n = 8;
        for (let i = 0; i < n; i++)
          w.createBody({
            type: "static",
            position: a.V(2 + tread * i + 5, rise * (i + 0.5), 0),
            colliders: [{ shape: a.box(5, rise / 2, 4) }],
          });
        const c = a.chr(w, 0, 1, 0, { stepMinWidth: smw });
        run(w, hz, 0.5);
        run(w, hz, 4, () => w.controlCharacter(c, a.inp(2, 0)));
        const p = cpos(w, c);
        // ideal: reaches riser at 0.85 s, top of flight after n*tread metres; total x = 8 if speed is kept
        row(
          `T stairs rise ${rise} tread ${tread} stepMinWidth ${smw}: x, h after 4 s`,
          up,
          hz,
          [p.x, a.h(p)],
          [8, 0.91 + n * rise],
          0.8,
        );
        w.dispose();
      }
summary();
