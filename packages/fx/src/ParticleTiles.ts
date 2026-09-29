import { simplex2, mulberry32 } from '@homie-rocks/noise/Noise.js';
import { clamp01, sstep, type TileFn } from './ParticleAtlas.ts';

/**
 * ============================================================================
 *  The eight sprite shapes both racers draw with.
 * ============================================================================
 *  The two racing games these came from are forks of one another, and these
 *  eight tile functions are the part that never diverged: measured before the
 *  move, the 135 lines below were byte-identical in the two games, comments and
 *  all. The space racer appends FOUR MORE of its own — ion wash, plasma, spall,
 *  vapour — and those stay in that game, because they are its art and not a
 *  shared shape. `border` and `fbm` are exported for exactly that: a game
 *  authoring its own tiles gets the same 1-texel transparent border and the
 *  same noise as the eight it is appending to.
 *
 *  A base-building game is deliberately NOT a consumer. It re-authors most of
 *  these — a vacuum plume is not a flame, and gas vented into vacuum does not
 *  billow. Sharing the ATLAS with it (see ParticleAtlas.ts) and not the tiles
 *  is the line between the same thing and the same shape.
 * ============================================================================
 */

/** The same seeded simplex field both racers' tiles were authored against. */
const noise2 = simplex2(0x5eed1e);

export { mulberry32 };

/** Fractal brownian motion over `noise2`, -1..1. */
export function fbm(x: number, y: number, oct: number): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise2(x * freq, y * freq);
    norm += amp;
    amp *= 0.52; freq *= 2.07;
  }
  return sum / norm; // -1..1
}

/** The transparent 1-texel frame every tile in this atlas leaves. */
export const border = (u: number, v: number) =>
  sstep(0.0, 0.012, Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v)));

/** The eight sprite shapes. Every tile leaves a transparent 1-texel border. */
export function coreTiles(): TileFn[] {
  return [
    // 0 — Glow: wide gaussian-ish halo with a hint of a core.
    (u, v, o) => {
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const f = Math.max(0, 1 - d);
      const a = Math.min(1, Math.pow(f, 2.7) + 0.45 * Math.pow(f, 11));
      o[0] = o[1] = o[2] = 1; o[3] = a * border(u, v);
    },
    // 1 — Core: a blown pinpoint riding a wide soft glow, plus a *feathered*
    //     4-point flare.
    //
    //     The flare used to be `1 - |y| * 22`, i.e. a 1/22-wide linear ramp.
    //     That is a hard-edged cross barely two texels across: once the sprite
    //     is under ~20 px on screen the mip chain collapses it into a solid
    //     diamond with a crisp silhouette and no falloff at all, which is
    //     exactly the "blue confetti" the drift sparks were reading as. A
    //     gaussian flare band and a wide power-law halo survive minification —
    //     the sprite just gets softer as it shrinks instead of harder.
    //
    //     A later change: the profile is now dominated by *falloff*. The previous
    //     `core + 0.34*halo` reached alpha 1 by 40% of the radius, so with an
    //     additively-authored colour the whole inner disc saturated and the
    //     sprite arrived as a hard-edged chip — the torn-purple-confetti read on
    //     the tier-2 drift frame. A tight gaussian core riding a long power-law
    //     skirt spends almost all of its area below the clip point, which is
    //     what makes a spark look like a spark instead of a decal.
    (u, v, o) => {
      const x = (u - 0.5) * 2, y = (v - 0.5) * 2;
      const d = Math.hypot(x, y);
      const f = Math.max(0, 1 - d);
      const core = Math.exp(-d * d * 34);
      const halo = 0.16 * Math.pow(f, 2.2);
      const fall = Math.pow(f, 3.2);
      const flare = Math.exp(-y * y * 18) + Math.exp(-x * x * 18);
      const a = core + halo + 0.22 * fall * flare;
      // slightly warm core so additive stacking does not read as dead white
      o[0] = 1; o[1] = 0.97; o[2] = 0.93; o[3] = Math.min(1, a) * border(u, v);
    },
    // 2 — Smoke: eroded billow. RGB carries interior density variation so the
    //     lit puff has form before a single light hits it.
    (u, v, o) => {
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const n = fbm(u * 3.2, v * 3.2, 4);
      const n2 = fbm(u * 8.4 + 11.3, v * 8.4 - 5.1, 3);
      const mask = Math.pow(Math.max(0, 1 - d), 0.85);
      const dens = mask * (0.66 + 0.46 * n + 0.18 * n2);
      let a = sstep(0.09, 0.72, dens);
      a *= sstep(1.0, 0.74, d);
      const shade = 0.70 + 0.30 * clamp01(0.5 + 0.5 * n) + 0.06 * n2;
      o[0] = shade; o[1] = shade * 0.995; o[2] = shade * 0.985;
      o[3] = a * border(u, v);
    },
    // 3 — Flame: base at v=0, tip at v=1, tapered and wobbled, with a baked
    //     temperature ramp from white-hot to deep orange.
    //
    //     The alpha is a two-lobe radial falloff — a tight bright core riding a
    //     wide, long soft tail — and it reaches zero *smoothly* at the
    //     silhouette. A smoothstep-to-1 profile (which is what this used to be)
    //     produces a hard alpha edge, and a hard alpha edge on an additive
    //     sprite is exactly the cardboard-cutout tell the plume was showing.
    (u, v, o) => {
      const x = (u - 0.5) * 2;
      const width = Math.pow(Math.max(0.001, 1 - v), 0.55) * 0.92;
      const wob = fbm(u * 4.6, v * 3.1 - 2.0, 3) * 0.20 * v;
      // 1 on the spine, 0 on the silhouette, negative outside it
      const q = clamp01(1 - Math.abs(x) / width + wob);
      let a = 0.42 * Math.pow(q, 1.9) + 0.58 * Math.pow(q, 7.0);
      // long soft dissolve at the tip and a soft shoulder at the base — no
      // clipped end caps in either direction
      a *= sstep(1.0, 0.52, v);
      a *= sstep(0.0, 0.16, v);
      const core = clamp01((1 - v) * 1.35 * (1 - Math.abs(x) * 0.8));
      const c = Math.pow(core, 1.6);
      o[0] = 1.0;
      o[1] = 0.24 + 0.70 * c;
      o[2] = 0.04 + 0.56 * c * c;
      o[3] = a * border(u, v);
    },
    // 4 — Star: a four-point sparkle, authored as *light* rather than as a
    //     shape. The old five-lobed disc had a filled body with a hard rim: at
    //     twenty pixels across it read as a white flower petal pasted over the
    //     vehicle, which is what the closeup frame was showing beside the driver.
    //     Two crossed gaussian bars plus a bright pinpoint and a wide skirt
    //     minify into a soft twinkle instead of a solid glyph.
    (u, v, o) => {
      const x = (u - 0.5) * 2, y = (v - 0.5) * 2;
      const r = Math.hypot(x, y);
      const fade = Math.max(0, 1 - r);
      const bar = Math.exp(-y * y * 150) * Math.exp(-x * x * 1.6)
        + Math.exp(-x * x * 150) * Math.exp(-y * y * 1.6);
      const dia = 0.42 * (Math.exp(-(x - y) * (x - y) * 220) + Math.exp(-(x + y) * (x + y) * 220))
        * Math.exp(-r * r * 2.4);
      const point = Math.exp(-r * r * 90);
      const a = Math.min(1, (0.62 * bar + dia) * Math.pow(fade, 1.4) + point + 0.10 * Math.pow(fade, 3.0));
      o[0] = 1; o[1] = 0.985; o[2] = 0.95; o[3] = a * border(u, v);
    },
    // 5 — Streak: soft capsule along +v, for stretched sparks and debris. A
    //     narrow blown spine inside a wider soft body, so a motion-streaked
    //     spark still has a hot centre line rather than reading as a flat bar.
    (u, v, o) => {
      const x = (u - 0.5) * 2, y = (v - 0.5) * 2;
      const along = Math.pow(Math.max(0, 1 - Math.abs(y)), 0.75);
      const body = sstep(0.0, 0.62, 1 - Math.abs(x) / 0.46);
      const spine = Math.exp(-x * x * 34);
      o[0] = 1; o[1] = 0.98; o[2] = 0.95;
      o[3] = Math.min(1, along * (0.55 * body + 0.62 * spine)) * border(u, v);
    },
    // 6 — Ring: thin gaussian annulus.
    (u, v, o) => {
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const t = (d - 0.76) / 0.15;
      const a = Math.exp(-t * t) * sstep(1.0, 0.9, d);
      o[0] = o[1] = o[2] = 1; o[3] = a * border(u, v);
    },
    // 7 — Splash: droplet cluster, for water spray and sand grains.
    (u, v, o) => {
      const rnd = mulberry32(0x51a5);
      let a = 0;
      for (let i = 0; i < 9; i++) {
        const cx = 0.5 + (rnd() - 0.5) * 0.72;
        const cy = 0.5 + (rnd() - 0.5) * 0.72;
        const rr = 0.055 + rnd() * 0.115;
        const d = Math.hypot(u - cx, v - cy);
        a = Math.max(a, 1 - sstep(rr * 0.35, rr, d));
      }
      a *= sstep(1.0, 0.78, Math.hypot(u - 0.5, v - 0.5) * 2);
      const n = 0.86 + 0.14 * fbm(u * 12, v * 12, 2);
      o[0] = n; o[1] = n; o[2] = 1; o[3] = a * border(u, v);
    },
  ];
}
