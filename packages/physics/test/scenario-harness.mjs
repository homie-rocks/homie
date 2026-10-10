import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
const P = new URL("../dist/", import.meta.url);
export const { initPhysics, wasmURL } = await import(new URL("Engine.js", P));
export const { createWorld, seeded } = await import(new URL("World.js", P));
export const HF = await import(new URL("Heightfield.js", P));
export const INTERNAL = await import(new URL("internal/Engine.js", P));
await initPhysics(await WebAssembly.compile(await readFile(wasmURL())));
export const hash = (u8) =>
  createHash("sha1").update(u8).digest("hex").slice(0, 12);
export const HZ = process.env.PHYSICS_FULL ? [20, 30, 60] : [60];
export const UPS = ["y", "z"];
// Axis helper: (x, h, s) = ground-x, height, second ground axis.
export function ax(up) {
  const V = (x = 0, h = 0, s = 0) =>
    up === "y" ? { x, y: h, z: s } : { x, y: s, z: h };
  return {
    up,
    V,
    box: (x, h, s) => ({ kind: "box", halfExtents: V(x, h, s) }),
    inp: (x = 0, s = 0, jump = false) =>
      up === "y" ? { x, z: s, jump } : { x, y: s, jump },
    h: (p) => (up === "y" ? p.y : p.z),
    s: (p) => (up === "y" ? p.z : p.y),
    yaw: (a) =>
      up === "y"
        ? { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }
        : { x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) },
    world: (o = {}) => createWorld({ up, ...o }),
    floor: (w, size = 40, h = 0) =>
      w.createBody({
        type: "static",
        position: V(0, h - 0.5, 0),
        colliders: [
          { shape: { kind: "box", halfExtents: V(size, 0.5, size) } },
        ],
      }),
    chr: (w, x = 0, h = 1, s = 0, o = {}) =>
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
        ...o,
      }),
  };
}
export const cpos = (w, c) => w.bodyState(w.characterState(c).body).position;
// run `seconds` of game time at `hz`, calling before(i, t) ahead of each outer step; returns all events
export function run(w, hz, seconds, before, after) {
  const n = Math.round(seconds * hz),
    ev = [];
  for (let i = 0; i < n; i++) {
    before?.(i, (i + 1) / hz);
    for (const event of w.step(1 / hz)) ev.push(event);
    after?.(i, (i + 1) / hz);
  }
  return ev;
}
let fails = 0,
  total = 0;
export const rows = [];
export function row(name, up, hz, got, want, tol, extra = "") {
  total++;
  const g = Array.isArray(got) ? got : [got],
    e = Array.isArray(want) ? want : [want];
  const ok = g.every((x, i) => Number.isFinite(x) && Math.abs(x - e[i]) <= tol);
  if (!ok) fails++;
  const line = `${ok ? "ok  " : "FAIL"} ${name.padEnd(58)} up=${up} ${String(hz).padStart(2)}Hz got ${g.map((x) => (+x).toFixed(3)).join(", ")} want ${e.map((x) => (+x).toFixed(3)).join(", ")} (tol ${tol}) ${extra}`;
  test(`${name} ${up} ${hz}Hz`, () => assert.ok(ok, line));
  return ok;
}
export function flag(name, up, hz, ok, extra = "") {
  total++;
  if (!ok) fails++;
  const line = `${ok ? "ok  " : "FAIL"} ${name.padEnd(58)} up=${up} ${String(hz).padStart(2)}Hz ${extra}`;
  test(`${name} ${up} ${hz}Hz`, () => assert.ok(ok, line));
  return ok;
}
export function summary() {
  console.log(`\n${total - fails}/${total} passed, ${fails} FAILED`);
}
export function each(fn) {
  for (const up of UPS)
    for (const hz of HZ) {
      try {
        fn(ax(up), hz);
      } catch (e) {
        flag(
          "THREW " + (e.message ?? e),
          up,
          hz,
          false,
          (e.cause?.message ?? "") +
            " " +
            (e.stack ?? "").split("\n").slice(1, 3).join(" | "),
        );
      }
    }
}
