/**
 * ============================================================================
 *  footplant — WHERE A FOOT IS, ON THE CPU, and the two patches under it.
 * ============================================================================
 *  The third side of this package's triangle. `Gait.ts` owns the PHASE.
 *  `gpubiped.ts` poses the whole skeleton from that phase in the vertex shader,
 *  where a crowd can afford it. This is the small piece the CPU still has to
 *  know: where one foot is on the ground at a given phase.
 *
 *  IT IS A MIRROR AND IT SAYS SO. `footPlant` computes exactly what the shader's
 *  `legIK` computes for the foot's body-local Z and its height above the
 *  ground, and nothing else — no angles, no chain, no skinning. Two copies of
 *  one curve, one on each side of the bus, because the shader cannot tell the
 *  CPU where it put the foot and the CPU has to know: a contact shadow founded
 *  on the wrong place is worse than no contact shadow, and it is the exact
 *  artefact — "the trailing foot floats with a visible air gap" — that having
 *  no per-foot answer produces in the first place.
 *
 *  RETUNE THE GAIT AND YOU RETUNE BOTH. They share a `FootTune`, which is the
 *  structural half of keeping them honest; a test comparing the two against
 *  each other is the other half and is the caller's, because only the caller
 *  knows which proportions it fed the shader.
 *
 * ----------------------------------------------------------------------------
 *  TWO PATCHES PER FOOT, NOT ONE, AND THAT IS THE WHOLE OF `bipedContacts`
 * ----------------------------------------------------------------------------
 *  A contact occlusion laid at the width of the thing casting it is INVISIBLE.
 *  There is no gradient anywhere the eye can find, because every pixel it
 *  darkens is a pixel the foot is standing on. That reads, precisely, as a
 *  figure sitting ON the ground rather than IN it — and it is not fixed by
 *  making the patch darker.
 *
 *  Real occlusion under a foot has two components at two different sizes: a
 *  small, hard, nearly-black core where the sole actually seals against the
 *  ground, and a much wider, much weaker bowl where the leg and the body block
 *  the sky. So both are laid. The wide one is several times the foot and weak
 *  enough to be a gradient rather than a stain; the core is slightly wider than
 *  the sole so that it has an edge OUTSIDE the silhouette to be seen against.
 *
 *  A FOOT IN FLIGHT STILL OCCLUDES. It just does it more weakly and over a
 *  wider patch, which is what an area-light occlusion term does — so lift fades
 *  the strength and grows the radius rather than switching the patch off. A
 *  patch that pops out at toe-off is more visible than the artefact it fixes.
 *
 * ----------------------------------------------------------------------------
 *  THE SINK IS A FUNCTION, AND THAT IS WHY THIS FILE IS IN @homie-rocks/walk
 * ----------------------------------------------------------------------------
 *  `bipedContacts` pushes into a callback, not into a layer. The obvious layer
 *  is `@homie-rocks/render/sunpatch`, and taking it as a parameter would make this
 *  package depend on the renderer to answer a question about a leg. It does not
 *  need to: a patch is six numbers. A caller with a SunPatches hands it
 *  `(x, y, z, r, s, soft) => patches.push(...)` and pays nothing.
 * ============================================================================
 */

/** The gait numbers the foot curve needs. A subset of the shader rig's. */
export interface FootTune {
  /** Fraction of one cycle the foot is planted. Must match the shader's. */
  duty: number;
  /** Swing height = (liftBase + liftPerSpeed * min(v, liftSpeedCap)) * weight. */
  liftBase: number;
  liftPerSpeed: number;
  liftSpeedCap: number;
  /** Shapes the swing arc: sin(PI * s^liftSkew). Below 1 it hangs late. */
  liftSkew: number;
}

/** Body-local foot placement. Reused, never allocated in a frame loop. */
export interface FootState {
  /** Metres forward (+) or back (-) of the pelvis, body-local. */
  z: number;
  /** Metres above the ground. Zero for the whole stance window. */
  lift: number;
}

/**
 * Where one foot is at gait phase `q`, at speed `v`, on a cycle of `T` seconds.
 *
 * `gw` is the gait weight — the caller's fade from standing to walking — and it
 * scales the lift only, so a figure coming to a stop plants its feet rather than
 * paddling them.
 *
 * Across the stance window the foot slides from +e/2 to -e/2 where
 * `e = v * duty * T` is the ground covered while it is planted. That is the
 * same construction as the shader's, and it is why the foot does not skate.
 */
export function footPlant(
  out: FootState, q: number, v: number, T: number, gw: number, k: FootTune,
): FootState {
  const e = v * k.duty * T;
  if (q < k.duty) {
    const s = q / k.duty;
    out.z = e * (0.5 - s);
    out.lift = 0;
  } else {
    const s = (q - k.duty) / (1 - k.duty);
    const sm = s * s * (3 - 2 * s);
    out.z = -0.5 * e + e * sm;
    out.lift = (k.liftBase + k.liftPerSpeed * Math.min(v, k.liftSpeedCap)) * gw
      * Math.sin(Math.PI * Math.pow(s, k.liftSkew));
  }
  return out;
}

/** Six numbers: world x, y, z, radius, strength, softness. */
export type PatchSink = (
  x: number, y: number, z: number, r: number, str: number, soft: number,
) => void;

/** The shape of the three patches. See the header for why there are three. */
export interface ContactTune extends FootTune {
  /** Half the stance width — where a foot sits, left and right of centre. */
  hipX: number;
  /** Body bowl radius = bodyBase + bodyPerSpeed * min(v, bodySpeedCap). */
  bodyBase: number;
  bodyPerSpeed: number;
  bodySpeedCap: number;
  /** Body bowl: metres above ground, share of the caller's strength, softness. */
  bodyLift: number;
  bodyStrength: number;
  bodySoft: number;
  /** Metres the ankle sits behind the sole's centre. */
  ankleOffset: number;
  /** Foot patch: metres above ground, base radius, radius gained per metre of lift. */
  footLift: number;
  footBase: number;
  footPerLift: number;
  footSoft: number;
  /**
   * Strength = str * (footFloor + footFade * fade^2).
   *
   * TWO NUMBERS AND NOT ONE, even though every sane pair sums to 1. Deriving
   * the second as `1 - footFloor` is a different FLOAT: `1 - 0.34` is
   * 0.6599999999999999, and a caller that had the pair written out gets a
   * silently different patch strength the moment they are folded into one
   * parameter. That is not a rounding difference to shrug at — it is the exact
   * shape of an extraction quietly changing a picture, and a parity test caught
   * it happening.
   */
  footFloor: number;
  footFade: number;
  /** Lift at which a foot's patch has faded all the way to footFloor. */
  fadeLift: number;
}

/**
 * One wide body bowl and two foot patches, for a figure close enough that the
 * difference between them is visible. Beyond that range the two feet are inside
 * a pixel of each other and the caller should lay the body patch alone.
 *
 * `phase` is the left foot's; the right is half a cycle behind, which is what
 * makes it a walk and not a hop.
 */
export function bipedContacts(
  sink: PatchSink,
  x: number, y: number, z: number, yaw: number,
  phase: number, speed: number, cycle: number, gaitWeight: number,
  scale: number, str: number, k: ContactTune,
): void {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const body = k.bodyBase + k.bodyPerSpeed * Math.min(speed, k.bodySpeedCap);
  sink(x, y + k.bodyLift, z, body * scale, str * k.bodyStrength, k.bodySoft);
  const f: FootState = { z: 0, lift: 0 };
  for (const side of [-1, 1]) {
    footPlant(f, side < 0 ? phase % 1 : (phase + 0.5) % 1, speed, cycle, gaitWeight, k);
    const lx = side * k.hipX * scale;
    const lz = (f.z + k.ankleOffset) * scale;
    const fade = Math.max(0, Math.min(1, 1 - f.lift / k.fadeLift));
    sink(
      x + lx * c + lz * s, y + k.footLift, z - lx * s + lz * c,
      (k.footBase + f.lift * k.footPerLift) * scale,
      str * (k.footFloor + k.footFade * fade * fade),
      k.footSoft,
    );
  }
}
