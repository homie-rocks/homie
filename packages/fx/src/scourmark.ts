/**
 * ============================================================================
 *  scourmark — a SWEPT blast mark, drawn to a canvas at load.
 * ============================================================================
 *
 *  Anything that fires downward at a surface — a landing rocket, a hovering
 *  thruster, a jet blast deflector — does not leave a soft round smudge. It
 *  drives the loose fines outward radially at very shallow angles, so the
 *  signature is LONG THIN RADIAL STREAKS over a darker scoured centre where
 *  the surface has been stripped down to whatever is compacted underneath.
 *  A round smudge is the default and it is what makes a blast mark read as a
 *  decal rather than as damage.
 *
 *  Drawn on WHITE for a multiply blend, so nothing here is per-surface: see
 *  @homie-rocks/render/contactdecal for why that matters and for the two traps in
 *  the material that consumes this.
 *
 *  THE ORDER IS LOAD-BEARING. Streaks first, then the core, then the blotches:
 *  the core has to sit ON the streaks (a plume that scours a centre scours the
 *  streaks that crossed it) and the blotches have to sit on everything (they
 *  are what stops the rim being a circle, and a rim circle is the single tell
 *  that says "decal").
 *
 *  THE CENTRE IS NOT THE DARKEST POINT, and that is a physical claim rather
 *  than a style: directly under the nozzles everything loose has already gone
 *  and what is left is bare, slightly brighter, compacted ground. The darkest
 *  ring is just OUTSIDE the footprint. A caller passes the three stops that
 *  say so; there is no default, because a mark on ice, on sand and on regolith
 *  are three different curves.
 * ============================================================================
 */
import * as THREE from 'three';

export interface ScourLook {
  /** Canvas edge, texels. */
  size: number;
  /** How many radial streaks. */
  streaks: number;
  /** Streak inner radius, as a fraction of the canvas: [min, span]. */
  streakR0: [number, number];
  /** Streak outer radius: [min, span], with `span` skewed by `streakSkew`. */
  streakR1: [number, number];
  /** Skew on the outer radius. Above 1 keeps most streaks short and a few long. */
  streakSkew: number;
  /** Streak width, texels: [min, span]. */
  streakW: [number, number];
  /** Streak darkness: [min, span], 0 = untouched .. 1 = black. */
  streakDark: [number, number];
  /** The scoured core, as gradient stops out to `coreR`. See the note above. */
  coreR: number;
  coreStops: Array<[number, string]>;
  /** How many rim blotches. */
  blotches: number;
  /** Blotch centre radius: [min, span], with `span` skewed by `blotchSkew`. */
  blotchR: [number, number];
  blotchSkew: number;
  /** Blotch radius, as a fraction of the canvas: [min, span]. */
  blotchSize: [number, number];
  /** Blotch value, 0..255: [min, span]. */
  blotchV: [number, number];
  /** Alpha at a blotch's centre. */
  blotchAlpha: number;
  anisotropy: number;
}

/** `rnd` is the caller's stream, so a mark is reproducible with its scene. */
export function bakeScourMark(look: ScourLook, rnd: () => number): THREE.CanvasTexture {
  const S = look.size;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;

  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);

  const cx = S / 2;
  const cy = S / 2;

  g.lineCap = 'round';
  for (let i = 0; i < look.streaks; i++) {
    const a = rnd() * Math.PI * 2;
    const r0 = S * (look.streakR0[0] + rnd() * look.streakR0[1]);
    const r1 = S * (look.streakR1[0] + Math.pow(rnd(), look.streakSkew) * look.streakR1[1]);
    const w = look.streakW[0] + rnd() * look.streakW[1];
    const dark = look.streakDark[0] + rnd() * look.streakDark[1];
    const grad = g.createLinearGradient(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    const c0 = Math.round(255 * (1 - (1 - dark) * 0.55));
    grad.addColorStop(0, 'rgb(' + c0 + ',' + c0 + ',' + Math.round(c0 * 1.02) + ')');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = grad;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    g.stroke();
  }

  const core = g.createRadialGradient(cx, cy, S * 0.02, cx, cy, S * look.coreR);
  for (const [at, col] of look.coreStops) core.addColorStop(at, col);
  g.fillStyle = core;
  g.beginPath();
  g.arc(cx, cy, S * look.coreR, 0, Math.PI * 2);
  g.fill();

  for (let i = 0; i < look.blotches; i++) {
    const a = rnd() * Math.PI * 2;
    const r = S * (look.blotchR[0] + Math.pow(rnd(), look.blotchSkew) * look.blotchR[1]);
    const rad = S * (look.blotchSize[0] + rnd() * look.blotchSize[1]);
    const v = Math.round(look.blotchV[0] + rnd() * look.blotchV[1]);
    const bl = g.createRadialGradient(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0, cx + Math.cos(a) * r, cy + Math.sin(a) * r, rad);
    bl.addColorStop(0, 'rgba(' + v + ',' + v + ',' + Math.round(v * 1.03) + ',' + look.blotchAlpha + ')');
    bl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = bl;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rad, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = look.anisotropy;
  tex.needsUpdate = true;
  return tex;
}
