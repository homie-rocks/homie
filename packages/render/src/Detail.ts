/**
 * ============================================================================
 *  Detail.ts — the four tiling surface families every vehicle in the racers
 *  this came from is finished with, authored once.
 * ============================================================================
 *
 * `Surface.ts` is the primitive layer: a canvas, an fBm fill, a Sobel to
 * slopes, a Toksvig bake. This is one layer up and no further — it knows that a
 * clearcoat is a long flow with a dimple octave composited into its HEIGHT, and
 * that a Toksvig bake wants the same slope field the normal came from. It does
 * not know what a kart, a hull or a livery is.
 *
 * ## Why these four, and how much of them was actually the same
 *
 * The livery modules of a kart racer and of a space racer are forks. Their
 * `surfaceDetail()` functions were compared family by family:
 *
 *   clearcoat   IDENTICAL but for TWO numbers — the roughness range, 0.026 +
 *               n*0.060 against 0.024 + n*0.052, and the matching Toksvig
 *               floor. Same 256 px map, same 0.028/2/3311 flow, same
 *               0.12/2/5507 dimple at globalAlpha 0.45, same 0.42 Sobel, same
 *               1.7 repeat, same 0.12 normal scale, same 0.010/3/8123
 *               roughness field.
 *   moulded     IDENTICAL. Every number. The kart racer calls it "moulded
 *               plastic" and the space racer "matte structural composite", and
 *               a dark structural part with a pebbled mould grain and a hard
 *               0.48 roughness floor is the same surface in both.
 *   polished    IDENTICAL but for TWO numbers — the roughness floor and the
 *               bottom of its range, 0.13 against 0.09.
 *   cloth       IDENTICAL. Every number, down to the 8 px twill cell and the
 *               `(warp + weft - 1) * 10` term.
 *
 * That is the finding this repository keeps making: **when two forks look
 * divergent, the difference is a VALUE, not a behaviour.** Four numbers here,
 * against sixteen in `@homie-rocks/audio/ChargeTone` and fourteen in `@homie-rocks/camera`.
 *
 * ## The two numbers are not a detail, and they are argued in the games
 *
 * The polished floor is the case worth stating, because the two games moved it
 * in OPPOSITE directions for the same physics. The kart racer's rub strip is a
 * metre of near-cylinder aimed at a golden-hour horizon whose radiance is above
 * 1.0 linear before the key and the bloom reach it: too smooth and it clips
 * into an unbroken bar. The space racer's hull is under a black sky with one cold
 * planet in it: too rough and the metal returns the hemisphere's average, which
 * is very nearly nothing, and the part disappears. **Same failure, opposite
 * sign**, so the number stays with the game that argued it.
 *
 * ## What is NOT here
 *
 * The base coat. The kart racer bakes a lacquer peel — a 6 mm dimple field plus
 * polish swirls — that the space racer does not have at all, because its hull
 * is an ATLAS rather than a tiling family and its equivalent lives in
 * `hullFields()`. A `hasPeel` flag here would be a branch that changes
 * behaviour rather than a value, which is the tell that the two were never one
 * thing. It stays in the kart racer.
 *
 * Nor is the CACHE here. Both games memoise their `surfaceDetail()` into a
 * module-level `_detail`, and both keep doing it: which textures a game holds
 * for the life of a session is that game's budget, and a package-level cache
 * would be a second lifetime nobody can see from the game that owns the first.
 */
import * as THREE from 'three';
import { canvas, fbmFill, heightSlope, slopeToNormal, tex, toksvigTexture } from './Surface.ts';

/**
 * A clearcoat, plus the slope field it was baked from.
 *
 * The slope is returned because the POLISHED family is baked against it too —
 * that is what makes a bumper and the bodywork next to it read as finished by
 * the same hand, and it is the reason `polishedRough` takes a coat rather than
 * building its own field.
 */
export interface Clearcoat {
  normal: THREE.CanvasTexture;
  rough: THREE.CanvasTexture;
  /** The Sobel slope field of the coat's height, for a shared Toksvig bake. */
  slope: Float32Array;
  /** Edge length of the map the slope belongs to. */
  res: number;
  /** UV repeat the coat was built at, which the polished bake must match. */
  repeat: number;
}

/** A normal + roughness pair that tiles. */
export interface DetailPair {
  normal: THREE.CanvasTexture;
  rough: THREE.CanvasTexture;
}

/**
 * THE CLEARCOAT: a long-wave spray-gun flow with a real ~19 mm orange-peel
 * octave composited into the HEIGHT before the Sobel.
 *
 * The composite is the whole point and it is worth being precise about what it
 * fixes. The flow alone is a 36-texel wave of 0.09 amplitude; Sobel it at 0.42
 * and multiply by a 0.055 normal scale and the coat's peak tangent tilt is 0.08
 * DEGREES — the clearcoat normal map is, numerically, off. 256 px over a 588 mm
 * tile is 2.3 mm per texel, so an 8-texel cell is a ~19 mm dimple: orange peel
 * at a stylised, toy-like scale, coarse enough that a reflected horizon visibly
 * ripples instead of dissolving.
 *
 * It goes into the HEIGHT rather than being a second normal, so both
 * frequencies share one slope field and therefore one Toksvig bake — whatever
 * mips away becomes coat roughness instead of sparkle. The long flow then
 * contributes little to the normal; it still carries the coat's roughness hazes
 * and the polished family's bake, which is where it was always doing the work.
 *
 * @param roughLo   bottom of the roughness range, linear
 * @param roughSpan width of that range
 * @param roughFloor the Toksvig floor. Both games set it to `roughLo`, which is
 *   correct and is still passed explicitly: a floor that silently tracked the
 *   range would be a decision this file is not entitled to make.
 */
export function clearcoat(o: {
  res?: number;
  normalScale: number;
  repeat: number;
  roughLo: number;
  roughSpan: number;
  roughFloor: number;
}): Clearcoat {
  const C = o.res ?? 256;
  const flow = canvas(C);
  fbmFill(flow, 0, 0, C, C, 0.028, 2, 3311, (n) => {
    const v = 128 + (n - 0.5) * 46;
    return [v, v, v];
  });
  {
    const dimple = canvas(C);
    fbmFill(dimple, 0, 0, C, C, 0.12, 2, 5507, (n) => {
      const v = 128 + (n - 0.5) * 110;
      return [v, v, v];
    });
    flow.globalAlpha = 0.45;
    flow.drawImage(dimple.canvas, 0, 0);
    flow.globalAlpha = 1;
  }
  const slope = heightSlope(flow, 0.42);
  const normal = tex(slopeToNormal(slope, C, C), false, o.repeat);
  const crough = canvas(C);
  fbmFill(crough, 0, 0, C, C, 0.010, 3, 8123, (n) => {
    const v = Math.round((o.roughLo + n * o.roughSpan) * 255);
    return [v, v, v];
  });
  const rough = toksvigTexture(crough, slope, o.normalScale, o.repeat, true, o.roughFloor);
  return { normal, rough, slope, res: C, repeat: o.repeat };
}

/**
 * THE MOULDED FAMILY: a pebbled mould grain with a hard roughness FLOOR.
 *
 * The floor is the load-bearing part. A dark structural part under a strong
 * normal with a 0.14 minimum roughness is a white per-pixel sparkle — that
 * shipped once, on a kart's dark trim (0.72 base x a 0.20 map), and it is what
 * `roughFloor` exists to stop. Nothing on a floorpan or an airframe underside
 * is polished anyway.
 *
 * Every number below was the same in both games. The two that a caller still
 * supplies are the ones that describe the PART rather than the material: how
 * hard the normal is pushed, and how big the tile is on the thing wearing it.
 */
export function moulded(o: {
  res?: number;
  normalScale: number;
  repeat: number;
  roughLo?: number;
  roughSpan?: number;
  roughFloor?: number;
}): DetailPair {
  const S = o.res ?? 512;
  const grain = canvas(S);
  fbmFill(grain, 0, 0, S, S, 0.085, 3, 5150, (n) => {
    const v = 128 + (n - 0.5) * 96;
    return [v, v, v];
  });
  const grainSlope = heightSlope(grain, 0.55);
  const normal = tex(slopeToNormal(grainSlope, S, S), false, o.repeat);
  const lo = o.roughLo ?? 0.52;
  const span = o.roughSpan ?? 0.34;
  const prg = canvas(S);
  fbmFill(prg, 0, 0, S, S, 0.014, 3, 2277, (n) => {
    const v = Math.round((lo + n * span) * 255);
    return [v, v, v];
  });
  const rough = toksvigTexture(prg, grainSlope, o.normalScale, o.repeat, true, o.roughFloor ?? 0.48);
  return { normal, rough };
}

/**
 * THE POLISHED FAMILY: a roughness map and nothing else — no grain at all, just
 * a long-wave polish haze, because **a mirror needs curvature to reflect, not
 * noise.** It rides the clearcoat's own slope field, which is what makes a
 * metal part and the painted panel beside it feel finished by the same person.
 *
 * The frequency is the argued one. At scale 0.012 on a 256 map a roughness
 * feature is ~83 texels, and against a 588 mm tile that is a 190 mm cell: a
 * metre-long strip gets five of them, which is not a break, it is a slow drift.
 * 0.045 puts a cell every ~50 mm, so a highlight running along a strip is
 * interrupted several times per its own width. Metal does not look polished
 * because it is uniformly smooth; it looks polished because it is ALMOST
 * uniformly smooth.
 *
 * `roughLo` and `roughFloor` are the two numbers the games disagree about, and
 * they disagree in OPPOSITE directions under the same physics. See this file's
 * header.
 */
export function polishedRough(coat: Clearcoat, o: {
  normalScale: number;
  roughLo: number;
  roughSpan: number;
  roughFloor: number;
}): THREE.CanvasTexture {
  const chr = canvas(coat.res);
  fbmFill(chr, 0, 0, coat.res, coat.res, 0.045, 3, 6611, (n) => {
    const v = Math.round((o.roughLo + n * o.roughSpan) * 255);
    return [v, v, v];
  });
  return toksvigTexture(chr, coat.slope, o.normalScale, coat.repeat, true, o.roughFloor);
}

/**
 * THE RACE SUIT: Nomex twill, and it exists because a figure whose cloth is as
 * tight as the vehicle's paint reads as a plastic toy inside a plastic toy.
 * Both games once shipped the driver on the moulded family, and both files say
 * the same thing about it.
 *
 * Two interlaced thread runs in quadrature at 90 degrees; the twill offset makes
 * the over/under alternate diagonally instead of forming a visible checker. A
 * *high* roughness (0.80-0.94) and a normal fine enough that at hero distance it
 * only shows as a soft sheen break across a shoulder.
 *
 * Every number here was the same in both games, down to the 8 px cell and the
 * `(warp + weft - 1) * 10` term that lifts the crossings.
 */
export function twillCloth(o: {
  res?: number;
  normalScale: number;
  repeat: number;
  cell?: number;
}): DetailPair {
  const W = o.res ?? 256;
  const CELL = o.cell ?? 8; // px per thread pair -> ~2.5 mm on the body
  const weave = canvas(W);
  {
    const img = weave.createImageData(W, W);
    const d = img.data;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        // two sine runs in quadrature; the twill offset makes the over/under
        // alternate diagonally instead of forming a visible checker
        const twill = ((Math.floor(x / CELL) + Math.floor(y / CELL)) & 1) ? 1 : -1;
        const warp = Math.sin((x / CELL) * Math.PI * 2) * 0.5 + 0.5;
        const weft = Math.sin((y / CELL) * Math.PI * 2) * 0.5 + 0.5;
        const h = 128 + (warp - weft) * twill * 44 + (warp + weft - 1) * 10;
        const i = (y * W + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = h;
        d[i + 3] = 255;
      }
    }
    weave.putImageData(img, 0, 0);
  }
  const weaveSlope = heightSlope(weave, 0.30);
  const normal = tex(slopeToNormal(weaveSlope, W, W), false, o.repeat);
  const crg = canvas(W);
  fbmFill(crg, 0, 0, W, W, 0.02, 3, 6421, (n) => {
    const v = Math.round((0.80 + n * 0.14) * 255);
    return [v, v, v];
  });
  const rough = toksvigTexture(crg, weaveSlope, o.normalScale, o.repeat, true, 0.78);
  return { normal, rough };
}
