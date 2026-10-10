// Props, dynamic supports, two characters, trigger zones with layer changes. Always under input.
import { each, row, flag, run, cpos, summary } from "./scenario-harness.mjs";
const evs = (ev, kind, a, b) =>
  ev
    .filter(
      (e) =>
        e.kind === kind &&
        ((e.colliderA === a && e.colliderB === b) ||
          (e.colliderA === b && e.colliderB === a)),
    )
    .map((e) => (e.started ? "B" : "E"))
    .join("");
for (const [mass, name] of [
  [1, "light 1 kg"],
  [20, "20 kg"],
  [1000, "heavy 1000 kg"],
])
  each((a, hz) => {
    const w = a.world();
    a.floor(w);
    const prop = w.createBody({
      type: "dynamic",
      mass,
      position: a.V(1.5, 0.5, 0),
      colliders: [{ shape: a.box(0.5, 0.5, 0.5), friction: 0.5 }],
    });
    const c = a.chr(w);
    run(w, hz, 0.5);
    let maxH = 0,
      minGap = 9;
    const col = w.colliders(prop)[0],
      cc = w.characterState(c).collider;
    const ev = run(
      w,
      hz,
      3,
      () => w.controlCharacter(c, a.inp(2, 0)),
      () => {
        const p = cpos(w, c),
          q = w.bodyState(prop).position;
        maxH = Math.max(maxH, a.h(p));
        minGap = Math.min(minGap, q.x - 0.5 - (p.x + 0.3));
      },
    );
    const p = cpos(w, c),
      q = w.bodyState(prop).position,
      bs = w.bodyState(prop);
    flag(
      `push ${name} crate 3 s at 2 m/s: no tunnelling, no climbing`,
      a.up,
      hz,
      minGap > -0.05 && maxH < 0.95 && q.x > p.x,
      `char x ${p.x.toFixed(3)} crate x ${q.x.toFixed(3)} crate v ${bs.velocity.x.toFixed(2)} min gap ${minGap.toFixed(3)} max h ${maxH.toFixed(3)} contact events '${evs(ev, "contact", col, cc)}'`,
    );
    if (mass === 1)
      row(
        `push light crate: char distance 3 s (2 m/s, contact at 0.69)`,
        a.up,
        hz,
        p.x,
        6,
        0.6,
      );
    if (mass === 1000)
      row(
        `heavy crate: char distance 3 s (blocked near 0.69)`,
        a.up,
        hz,
        p.x,
        0.69,
        0.5,
        `crate moved ${(q.x - 1.5).toFixed(3)}`,
      );
    flag(
      `${name}: one continuous contact, no flapping`,
      a.up,
      hz,
      evs(ev, "contact", col, cc).length <= 3,
      `'${evs(ev, "contact", col, cc)}'`,
    );
    w.dispose();
  });
// standing / walking on a resting dynamic body, and on a sliding dynamic body
each((a, hz) => {
  const w = a.world();
  a.floor(w);
  const slab = w.createBody({
    type: "dynamic",
    mass: 300,
    position: a.V(0, 0.25, 0),
    colliders: [{ shape: a.box(3, 0.25, 3), friction: 0.8 }],
  });
  const c = a.chr(w, 0, 1.6, 0);
  run(w, hz, 1);
  const s0 = w.bodyState(slab).position,
    p0 = cpos(w, c);
  row(
    "stand on resting 300 kg dynamic slab 1 s: char h",
    a.up,
    hz,
    a.h(p0),
    0.5 + 0.91,
    0.03,
    `platform=${w.characterState(c).platform === slab} grounded=${w.characterState(c).grounded}`,
  );
  let ung = 0;
  run(
    w,
    hz,
    1,
    () => w.controlCharacter(c, a.inp(2, 0)),
    () => {
      if (!w.characterState(c).grounded) ung++;
    },
  );
  const p1 = cpos(w, c),
    s1 = w.bodyState(slab).position;
  row(
    "walk across resting dynamic slab 1 s: char dx, slab dx",
    a.up,
    hz,
    [p1.x - p0.x, s1.x - s0.x],
    [2, 0],
    0.1,
    `ungrounded ${ung} slab h ${a.h(s1).toFixed(3)}`,
  );
  w.dispose();
});
each((a, hz) => {
  // sliding dynamic raft on a frictionless floor at 2 m/s in +s; character stands, then walks across
  const w = a.world();
  w.createBody({
    type: "static",
    position: a.V(0, -0.5, 0),
    colliders: [{ shape: a.box(60, 0.5, 60), friction: 0 }],
  });
  const raft = w.createBody({
    type: "dynamic",
    mass: 500,
    position: a.V(0, 0.25, 0),
    colliders: [{ shape: a.box(3, 0.25, 3), friction: 0 }],
    lockRotations: true,
  });
  const c = a.chr(w, 0, 1.6, 0);
  run(w, hz, 1);
  w.setVelocity(raft, a.V(0, 0, 2));
  run(w, hz, 1, () => w.controlCharacter(c, a.inp(0, 0)));
  const r0 = w.bodyState(raft).position,
    p0 = cpos(w, c);
  row(
    "dynamic raft sliding 2 m/s: idle rider offset after 1 s (dx, ds)",
    a.up,
    hz,
    [p0.x - r0.x, a.s(p0) - a.s(r0)],
    [0, 0],
    0.1,
    `raft v ${a.s(w.bodyState(raft).velocity).toFixed(2)}`,
  );
  run(w, hz, 1, () => w.controlCharacter(c, a.inp(2, 0)));
  const r1 = w.bodyState(raft).position,
    p1 = cpos(w, c);
  row(
    "dynamic raft sliding 2 m/s: walk across 1 s rel (dx, ds)",
    a.up,
    hz,
    [p1.x - r1.x - (p0.x - r0.x), a.s(p1) - a.s(r1) - (a.s(p0) - a.s(r0))],
    [2, 0],
    0.15,
    `on raft=${w.characterState(c).platform === raft}`,
  );
  w.dispose();
});
// two characters
each((a, hz) => {
  const w = a.world();
  a.floor(w);
  const c1 = a.chr(w, -2, 1, 0),
    c2 = a.chr(w, 2, 1, 0);
  run(w, hz, 0.5);
  let minD = 9,
    maxH = 0;
  const ev = run(
    w,
    hz,
    3,
    () => {
      w.controlCharacter(c1, a.inp(2, 0));
      w.controlCharacter(c2, a.inp(-2, 0));
    },
    () => {
      const p = cpos(w, c1),
        q = cpos(w, c2);
      minD = Math.min(minD, Math.hypot(q.x - p.x, a.s(q) - a.s(p)));
      maxH = Math.max(maxH, a.h(p), a.h(q));
    },
  );
  const p = cpos(w, c1),
    q = cpos(w, c2);
  flag(
    "two characters head-on 2 m/s each 3 s: no overlap, no climbing (they may slide round each other)",
    a.up,
    hz,
    minD > 0.58 && maxH < 0.95,
    `x1 ${p.x.toFixed(3)} x2 ${q.x.toFixed(3)} min centre distance ${minD.toFixed(3)} (2r=0.6) max h ${maxH.toFixed(3)} ds ${a.s(p).toFixed(3)},${a.s(q).toFixed(3)}`,
  );
  const k = evs(
    ev,
    "contact",
    w.characterState(c1).collider,
    w.characterState(c2).collider,
  );
  flag(
    "character-character contact events alternate",
    a.up,
    hz,
    /^(BE)*B?$/.test(k) && k.length <= 2,
    `'${k}'`,
  );
  // c1 keeps pushing, c2 idle: does c1 push c2? report
  const q0 = cpos(w, c2).x;
  run(w, hz, 2, () => {
    w.controlCharacter(c1, a.inp(2, 0));
    w.controlCharacter(c2, a.inp(0, 0));
  });
  row(
    "one pushes an idle character 2 s: idle one displaced (expect 0: characters block)",
    a.up,
    hz,
    cpos(w, c2).x - q0,
    0,
    0.05,
    `pusher x ${cpos(w, c1).x.toFixed(3)}`,
  );
  // separate: both walk apart
  const x1 = cpos(w, c1).x,
    x2 = cpos(w, c2).x;
  run(w, hz, 1, () => {
    w.controlCharacter(c1, a.inp(-2, 0));
    w.controlCharacter(c2, a.inp(2, 0));
  });
  row(
    "then walk apart 1 s: (dx1, dx2)",
    a.up,
    hz,
    [cpos(w, c1).x - x1, cpos(w, c2).x - x2],
    [-2, 2],
    0.08,
  );
  // one jumps onto the other's head: stands? report
  w.dispose();
});
each((a, hz) => {
  // character lands on another character's head
  const w = a.world();
  a.floor(w);
  const c1 = a.chr(w, 0, 1, 0),
    c2 = a.chr(w, 0.05, 4, 0);
  run(w, hz, 2, () => {
    w.controlCharacter(c1, a.inp(0, 0));
  });
  const p = cpos(w, c1),
    q = cpos(w, c2);
  flag(
    "character dropped onto another: no overlap, both finite, lower one not pushed into floor",
    a.up,
    hz,
    a.h(p) > 0.88 &&
      Math.hypot(q.x - p.x, a.h(q) - a.h(p), a.s(q) - a.s(p)) > 0.58,
    `lower h ${a.h(p).toFixed(3)} upper (${q.x.toFixed(3)}, h ${a.h(q).toFixed(3)}) upper grounded=${w.characterState(c2).grounded} platform=${w.characterState(c2).platform}`,
  );
  w.dispose();
});
// trigger zone whose layers change with a character inside (moving), and character layer change
each((a, hz) => {
  const w = a.world();
  a.floor(w);
  const zoneBody = w.createBody({
    type: "static",
    position: a.V(0, 1, 0),
    colliders: [{ shape: a.box(3, 1, 3), sensor: true }],
  });
  const zone = w.colliders(zoneBody)[0];
  const c = a.chr(w, -5, 1, 0);
  const cc = w.characterState(c).collider;
  let ev = [];
  ev.push(...run(w, hz, 0.5));
  ev.push(...run(w, hz, 2, () => w.controlCharacter(c, a.inp(2, 0)))); // now at x=-1, inside
  const k1 = evs(ev, "trigger", zone, cc);
  // pace back and forth inside while layers change
  const pace = (sec) =>
    run(w, hz, sec, (i, t) =>
      w.controlCharacter(c, a.inp(Math.sin(t * 6) > 0 ? 1 : -1, 0)),
    );
  ev = pace(1);
  const k2 = evs(ev, "trigger", zone, cc);
  w.updateCollider(zone, { layers: { membership: 0xffff, filter: 0xffff } });
  ev = pace(1);
  const k3 = evs(ev, "trigger", zone, cc); // same masks: nothing
  w.updateCollider(zone, { layers: { membership: 2, filter: 2 } });
  ev = pace(1);
  const k4 = evs(ev, "trigger", zone, cc); // still meets (char has all bits): nothing
  w.updateCollider(cc, { layers: { membership: 1, filter: 1 } });
  ev = pace(1);
  const k5 = evs(ev, "trigger", zone, cc); // no longer meets: one end
  w.updateCollider(cc, { layers: { membership: 3, filter: 3 } });
  ev = pace(1);
  const k6 = evs(ev, "trigger", zone, cc); // meets again: one begin
  w.updateCollider(zone, { layers: { membership: 4, filter: 4 } });
  ev = pace(1);
  const k7 = evs(ev, "trigger", zone, cc); // end
  w.updateCollider(zone, { layers: { membership: 1, filter: 1 } });
  w.updateCollider(zone, { sensor: false });
  w.updateCollider(zone, { sensor: true });
  ev = pace(1);
  const k8 = evs(ev, "trigger", zone, cc); // begin
  ev = run(w, hz, 3, () => w.controlCharacter(c, a.inp(2, 0)));
  const k9 = evs(ev, "trigger", zone, cc); // walks out: end
  const got = [k1, k2, k3, k4, k5, k6, k7, k8, k9].join("|"),
    want = "B|||| E|B|E|B|E".replace(" ", "");
  flag(
    "character in trigger zone through layer changes (enter|pace|same|still-meets|char-out|char-in|zone-out|zone-in|leave)",
    a.up,
    hz,
    got === want,
    `got '${got}' want '${want}' floor still solid: h ${a.h(cpos(w, c)).toFixed(3)}`,
  );
  w.dispose();
});

// A narrow corridor makes the head-on outcome unique: neither capsule can
// pass the other. Travel and final centres are measured to 2 cm.
each((a, hz) => {
  const w = a.world();
  a.floor(w);
  for (const side of [-1, 1])
    w.createBody({
      type: "static",
      position: a.V(0, 2, side * 0.575),
      colliders: [{ shape: a.box(10, 2, 0.25) }],
    });
  const left = a.chr(w, -3),
    right = a.chr(w, 3);
  run(w, hz, 0.5, () => {
    w.controlCharacter(left, a.inp());
    w.controlCharacter(right, a.inp());
  });
  const starts = [cpos(w, left), cpos(w, right)],
    travel = [0, 0];
  let last = starts;
  run(
    w,
    hz,
    3,
    () => {
      w.controlCharacter(left, a.inp(2));
      w.controlCharacter(right, a.inp(-2));
    },
    () => {
      const p = [cpos(w, left), cpos(w, right)];
      for (let i = 0; i < 2; i++)
        travel[i] += Math.hypot(p[i].x - last[i].x, a.s(p[i]) - a.s(last[i]));
      last = p;
    },
  );
  row("head-on corridor: distance", a.up, hz, travel, [2.695, 2.695], 0.02);
  row(
    "head-on corridor: final centres",
    a.up,
    hz,
    [last[0].x, last[1].x, a.s(last[0]), a.s(last[1])],
    [-0.305, 0.305, 0, 0],
    0.02,
  );
  flag(
    "head-on corridor: flags",
    a.up,
    hz,
    [left, right].every((c) => {
      const state = w.characterState(c);
      return state.grounded && !state.crushed;
    }),
  );
  w.dispose();
});
each((a, hz) => {
  const w = a.world();
  a.floor(w);
  const zone = w.createBody({
    type: "static",
    position: a.V(0, 2, 0),
    colliders: [{ shape: a.box(1, 2, 1), sensor: true }],
  });
  const c = a.chr(w, -3);
  run(w, hz, 0.5, () => w.controlCharacter(c, a.inp()));
  let last = cpos(w, c),
    travel = 0;
  const events = run(
    w,
    hz,
    3,
    () => w.controlCharacter(c, a.inp(2)),
    () => {
      const p = cpos(w, c);
      travel += Math.hypot(p.x - last.x, a.s(p) - a.s(last));
      last = p;
    },
  );
  row("walk through trigger: distance", a.up, hz, travel, 6, 0.01);
  row(
    "walk through trigger: position",
    a.up,
    hz,
    [last.x, a.h(last), a.s(last)],
    [3, 0.91, 0],
    0.01,
  );
  const state = w.characterState(c),
    transitions = events
      .filter(
        (e) => e.kind === "trigger" && (e.bodyA === zone || e.bodyB === zone),
      )
      .map((e) => e.started);
  flag(
    "walk through trigger: flags and closed pair",
    a.up,
    hz,
    state.grounded &&
      !state.crushed &&
      JSON.stringify(transitions) === "[true,false]",
  );
  w.dispose();
});

summary();
