/**
 * ===========================================================================
 *  @homie-rocks/diagnostics/StripRead.ts — read the PRESENTED image back, on demand,
 *  and REFUSE rather than answer wrongly.
 * ===========================================================================
 *
 * Extracted from one base-building game's `Diagnostics.ts`, where it was
 * `readFrame()`. Nothing in it is specific to that game, and there was no
 * second copy to trip a duplication counter. What it is, is the sampler behind an on-demand
 * `window.__frameHealth()` — the handle a person or a harness pulls at an
 * arbitrary moment to ask *"is there a picture on the screen right now"*.
 *
 * ── IT IS NOT `pipeline.sampleFrame()`, AND THE DIFFERENCE IS THE POINT ─────
 *
 * `@homie-rocks/render`'s `RenderPipeline.sampleFrame()` answers the same question
 * and is deliberately NOT this function. It runs INSIDE the task that drew the
 * frame, which is the only reason it can work without `preserveDrawingBuffer`:
 * the drawing buffer is discarded when the compositor takes the surface, and
 * that cannot happen until the task yields. It is the watchdog's per-frame
 * oracle and it must stay cheap and unconditional.
 *
 * This one is called from OUTSIDE any such task — from a console, from a CDP
 * evaluate, from a capture harness between shots — so the buffer it wants to
 * read has already been taken. Without the flag `readPixels` returns discarded
 * contents, and that reads as: **100% of frames are black, confidently, and
 * completely false.**
 *
 * So it REFUSES. `ok: false` with a `reason`, never a plausible zero. "We could
 * not measure it" and "we measured it and it was fine" must never render as the
 * same colour, and a luma of 0 from an unreadable buffer is the single most
 * convincing wrong answer a frame check can produce.
 *
 * ── THE ONE THING THAT DID NOT GET UNIFIED, NAMED SO IT IS NOT LOST ─────────
 *
 * `sampleFrame` computes Rec.709 luma; this computes the mean of R, G and B.
 * They disagree by up to ~30% on a saturated frame. That is real drift and it
 * is NOT resolved here, because the thresholds a caller feeds this function
 * were FITTED against the mean-of-RGB number from real captures, and the game
 * this came from states its re-fit procedure as a thing that requires
 * photographs. Switching the formula under fitted constants would move every
 * verdict by an unmeasured amount and look completely fine. A standing seam;
 * the fix is one capture-and-refit pass, not a rewrite.
 *
 * ── WHY THE STRIPS ─────────────────────────────────────────────────────────
 *
 * `readPixels` on the default framebuffer is a synchronous pipeline stall, so
 * this is called a handful of times in the life of a page and never in a steady
 * state. `strips` bands, evenly spread top to bottom, because the sky, the
 * midground and the foreground answer very different questions and a single
 * band can sit entirely inside one of them.
 */

import type { DiagRenderer } from './Host.ts';

/** Every threshold is the caller's. There are no defaults; see the header. */
export interface StripOptions {
  /** How many horizontal bands, spread evenly down the frame. */
  strips: number;
  /** Display luma at or below which a pixel counts as near-black. */
  dark: number;
  /** Display luma at or above which a pixel counts as lit. */
  lit: number;
}

export interface StripSample {
  /** false when the read could not be performed AT ALL. Not a soft failure. */
  measured: boolean;
  /** Why not, when `measured` is false. Empty when it is true. */
  reason: string;
  mean: number;
  /** luma standard deviation — structure, not brightness */
  sd: number;
  /** fraction of sampled pixels at or below `dark` — the tear signal */
  darkFrac: number;
  /** fraction at or above `lit` */
  lit: number;
  samples: number;
}

const UNMEASURED = { mean: 0, sd: 0, darkFrac: 0, lit: 0, samples: 0 };

export function sampleStrips(renderer: DiagRenderer, o: StripOptions): StripSample {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const attrs = gl.getContextAttributes();
  if (attrs === null || attrs.preserveDrawingBuffer !== true) {
    return {
      measured: false,
      reason: 'the context was NOT created with preserveDrawingBuffer, so the presented '
        + 'buffer cannot be read; boot with ?debug=frames. Reporting nothing rather than '
        + 'a false 100%-black.',
      ...UNMEASURED,
    };
  }

  // Read from the DEFAULT framebuffer — the thing the player actually sees,
  // after the whole post chain. Anything else measures an intermediate.
  renderer.setRenderTarget(null);
  const w = gl.drawingBufferWidth | 0;
  const h = gl.drawingBufferHeight | 0;
  if (w <= 0 || h <= 0) {
    return { measured: false, reason: 'the drawing buffer has no size yet', ...UNMEASURED };
  }

  const bandH = Math.max(1, Math.min(8, Math.floor(h / 90)));
  const buf = new Uint8Array(w * bandH * 4);
  let n = 0, sum = 0, sum2 = 0, dark = 0, lit = 0;
  for (let s = 0; s < o.strips; s++) {
    const y = Math.min(h - bandH, Math.max(0, Math.floor(h * ((s + 0.5) / o.strips)) - (bandH >> 1)));
    gl.readPixels(0, y, w, bandH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    for (let i = 0; i < buf.length; i += 4) {
      const l = (buf[i]! + buf[i + 1]! + buf[i + 2]!) / 3;
      if (l <= o.dark) dark++;
      if (l >= o.lit) lit++;
      sum += l; sum2 += l * l; n++;
    }
  }
  if (n === 0) {
    return { measured: false, reason: 'no pixels were read back', ...UNMEASURED };
  }
  const mean = sum / n;
  return {
    measured: true,
    reason: '',
    mean,
    sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
    darkFrac: dark / n,
    lit: lit / n,
    samples: n,
  };
}
