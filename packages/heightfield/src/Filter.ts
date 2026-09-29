/**
 * ============================================================================
 *  Filter.ts — the three filters a heightfield needs, and none of them is
 *  a general image filter.
 * ============================================================================
 *
 *  A heightfield is filtered for three different reasons and they want three
 *  different kernels. Putting them in one file next to each other is so that
 *  the next person picks the right one instead of reaching for whichever is
 *  nearest:
 *
 *   · `binomial5` LOW-PASSES A CONTINUOUS FUNCTION before it is sampled at a
 *     coarser spacing. It is the fix for decimation aliasing and it is applied
 *     at SAMPLE time, at a tap spacing tied to the sample spacing — it never
 *     touches the stored grid.
 *   · `boxBlur2D` SMOOTHS THE STORED GRID, in place, over a sub-rectangle.
 *     That is a destructive edit to the world.
 *   · `smooth3x3` softens a COARSE mask whose cells are the artefact — a
 *     binary decision baked per cell renders as a staircase at the cell pitch.
 *
 *  All three are pure arithmetic over Float32Array and none imports `three`.
 * ============================================================================
 */
import type { HeightField } from './Field.ts';

/**
 * Pascal's row 5. The separable binomial kernel's weights.
 *
 * WHY A BINOMIAL AND NOT A BOX, which is the whole reason this constant is
 * public and commented. The response of the 5-tap binomial was measured
 * at tap spacing `step/3` against the level it is protecting:
 *
 *   λ = 2·step (the level's Nyquist limit)  ->  0.56 amplitude — kept
 *   λ = step                                ->  0.06 amplitude — killed
 *   λ = 0.7·step                            ->  0.00003        — gone
 *
 * so relief the level can carry survives and everything it cannot carry is
 * REMOVED rather than folded down into a low frequency. A box kernel's
 * response rings — it has zeroes but no monotone rolloff — and the artefact it
 * leaves is the one this exists to remove: a row of evenly spaced triangular
 * teeth along every distant ridge, measured at 15.7 px / 16.0 m on one game's
 * regional capture, i.e. LOD 3's stride to three significant figures.
 */
export const BINOM5 = [1, 4, 6, 4, 1];

/**
 * The height function band-limited to a given sample spacing: separable
 * binomial 5x5, tap spacing `d` metres.
 *
 * `d <= 0` is the identity path and costs exactly one fetch — that is the
 * finest LOD level, whose vertices ARE the field and which must not be
 * filtered at all.
 *
 * 25 fetches per output. That is the price of a mesh that does not comb, and
 * it is paid at build time.
 */
export function binomial5(f: HeightField, x: number, z: number, d: number): number {
  if (d <= 0) return f.heightAt(x, z);
  let s = 0;
  for (let b = 0; b < 5; b++) {
    const wz = z + (b - 2) * d, wb = BINOM5[b]!;
    for (let a = 0; a < 5; a++) s += wb * BINOM5[a]! * f.heightAt(x + (a - 2) * d, wz);
  }
  return s * (1 / 256);
}

/**
 * Separable box blur of a `w x h` scratch buffer, radius `rad`, clamped at the
 * edges. The result is left in `a`; `b` is scratch of the same size and is
 * clobbered.
 *
 * TWO BUFFERS AND NOT ONE, and it is not an optimisation. A blur that reads
 * and writes the same array reads values this pass already wrote, so the
 * kernel grows one cell per row and the smoothing eats outward in the scan
 * direction — which on a levelled building site is a flat tongue running off
 * one side of the pad and nowhere else. It looks like a noise artefact and it
 * is a loop-carried dependency.
 *
 * EDGE POLICY IS CLAMP, matching `bilinear`: a sub-rectangle of a larger field
 * has real ground outside it, and treating that as zero would pull the border
 * of every blurred region toward sea level.
 */
export function boxBlur2D(a: Float32Array, b: Float32Array, w: number, h: number, rad: number): void {
  const k = 1 / (rad * 2 + 1);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let s = 0;
      for (let d = -rad; d <= rad; d++) {
        const ii = i + d;
        s += a[j * w + (ii < 0 ? 0 : ii > w - 1 ? w - 1 : ii)]!;
      }
      b[j * w + i] = s * k;
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let s = 0;
      for (let d = -rad; d <= rad; d++) {
        const jj = j + d;
        s += b[(jj < 0 ? 0 : jj > h - 1 ? h - 1 : jj) * w + i]!;
      }
      a[j * w + i] = s * k;
    }
  }
}

/**
 * `passes` rounds of a 3x3 neighbourhood MEAN over a square `n x n` grid, in
 * place, using `tmp` as scratch.
 *
 * THE DIVISOR IS THE NUMBER OF NEIGHBOURS THAT EXIST, not 9. At a border cell
 * a divisor of 9 mixes in five phantom zeroes, which on a 0..1 mask is a dark
 * frame drawn one cell wide around the whole map — and on a permanently
 * shadowed region mask, "dark" means "never sunlit", so the map edge would
 * grow a ring of false cold trap.
 *
 * This is for a COARSE mask whose own cell pitch is the artefact: one game
 * bakes permanent shadow as a hard binary per 16 m cell, and a hard binary at
 * 16 m renders the cold-trap boundary as a staircase, when the real boundary
 * wanders over tens of metres as the sun's azimuth sweeps.
 */
export function smooth3x3(buf: Float32Array, n: number, passes: number, tmp: Float32Array): void {
  for (let pass = 0; pass < passes; pass++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let s = 0, c = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const jj = j + dj, ii = i + di;
            if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
            s += buf[jj * n + ii]!; c++;
          }
        }
        tmp[j * n + i] = s / c;
      }
    }
    buf.set(tmp);
  }
}

/**
 * `passes` rounds of a 3x3 neighbourhood mean over a RECTANGULAR `w x h` grid,
 * mixed in per cell by `weight`.
 *
 * ── WHY THIS IS A SECOND FUNCTION AND NOT `smooth3x3` WITH TWO ARGUMENTS ────
 *
 * Two differences, and only the first is about the shape.
 *
 *  1. RECTANGULAR. `smooth3x3` takes one `n`; a heightfield sized off a
 *     circuit's plan extent is `w x h` with no reason for those to agree.
 *  2. IT IS A MIX, NOT A REPLACEMENT, AND THAT IS NOT THE SAME ARITHMETIC.
 *     `buf[k] + (mean - buf[k]) * 1` is not the same double as `mean` — the
 *     subtract-and-add round differently — so this cannot be `smooth3x3` with
 *     a weight of one bolted on without moving every existing consumer's
 *     terrain by an ulp. Two functions, and the existing cold-trap mask keeps
 *     the bytes it has.
 *
 * ── WHAT THE WEIGHT IS FOR ─────────────────────────────────────────────────
 *
 * An unmasked blur over a whole world blurs the thing the world is ABOUT. A
 * racing game's case is the one this came from: the authored road cross-section
 * is law within thirty metres of the kerb, and only the far field — where two
 * opposite sides of a circuit's terrain meet in a knife-edge crease — is
 * allowed to relax into a hillside. `weight(k)` is 0 on the road and ramps to 1
 * out in the fold. What that ramp IS, and where it starts, is the world's.
 *
 * THE DIVISOR IS THE NUMBER OF NEIGHBOURS THAT EXIST, not 9, for the reason
 * `smooth3x3` above states at length; the two agree about the border rule.
 *
 * The neighbourhood is accumulated ROW-MAJOR, outer loop over `dj`, and that
 * is load-bearing rather than tidy: a float sum is not associative and the
 * game this came from summed in this order.
 */
export function smoothMasked3x3(
  buf: Float32Array, w: number, h: number, passes: number, tmp: Float32Array,
  weight: (k: number) => number,
): void {
  for (let pass = 0; pass < passes; pass++) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        let s = 0, c = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj; if (jj < 0 || jj >= h) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di; if (ii < 0 || ii >= w) continue;
            s += buf[jj * w + ii]!; c++;
          }
        }
        tmp[k] = buf[k]! + (s / c - buf[k]!) * weight(k);
      }
    }
    buf.set(tmp);
  }
}
