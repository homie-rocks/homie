import * as THREE from 'three';
import { strutBetween } from './Strut.ts';

/**
 * ============================================================================
 *  Greeble — the industrial fittings a brush world is dressed with.
 * ============================================================================
 *  A pipe run with hangers, a bolted plate, a cable tray, a hooped drum, a
 *  locker bank, a banded crate, an instrument rack, a valve, a conduit, a
 *  junction box, a tank spur, and a guyed lattice mast.
 *
 *  WHY IT IS HERE AND NOT IN `@homie-rocks/props`. That package owns SHAPES: every
 *  generator there takes numbers and returns a `THREE.BufferGeometry`, and its
 *  own description says it owns "no materials, no placement and no scene".
 *  Nothing below returns a geometry. Every one of these writes into a
 *  `GreebleKit` — the `box` / `deco` / `mesh` vocabulary `Brush.ts` already
 *  defines — so a fitting lands in the right material bucket AND in the
 *  collider in one call, which is the whole point of building a world out of
 *  brushes. They belong beside the kit that makes them possible.
 *
 *  ------------------------------------------------------------------------
 *  EVERY COLOUR AND EVERY TUNED NUMBER IS THE CALLER'S. NO DEFAULTS.
 *  ------------------------------------------------------------------------
 *  Each function takes a `look` record and reads every material name and every
 *  proportion out of it. That is not ceremony: an earlier change deleted four
 *  of this package's options and inlined one game's literals, and every check
 *  in the repository stayed green because the parity baseline hard-coded
 *  exactly those literals. A number written into a body here is one game's art
 *  direction that the next game inherits silently and cannot see.
 *
 *  So the rule is enforced by the type: no field is optional, nothing has a
 *  default, and a game that adds a fitting has to say what its hanger spacing
 *  is rather than discovering somebody else's.
 *
 *  A parity test is the gate. It executes the original, pre-extraction props
 *  file beside this one, over a recording kit, and compares every recorded
 *  call — every float, every material name, every surface, and every vertex
 *  of every geometry handed to `mesh` — under `Object.is` with no epsilon. Its
 *  liveness section then perturbs each look field one at a time and requires
 *  the answer to CHANGE, which is the half parity cannot see.
 *
 *  ------------------------------------------------------------------------
 *  TWO AXES, ONE FUNCTION.
 *  ------------------------------------------------------------------------
 *  `pipeRun` and `cableTray` each replaced an X copy and a Z copy that had
 *  drifted: the Z cable tray had no droppers at all and the X one did, in the
 *  same game, and nobody had noticed because they are two functions. An `axis`
 *  argument is what makes that visible instead of invisible.
 * ============================================================================
 */

/**
 * The three calls a fitting makes. `BrushKit` satisfies this structurally, and
 * so does a recording kit, which is what lets a test drive the whole of a
 * game's dressing with no renderer in the process.
 */
export interface GreebleKit<S extends number, M extends string> {
  box(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    mat: M, surface: S, flags?: { floorOnly?: boolean; blockOnly?: boolean },
  ): void;
  deco(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: M): void;
  mesh(mat: M, geo: THREE.BufferGeometry, x: number, y: number, z: number): void;
}

/** Which world axis a run is laid along. */
export type RunAxis = 'x' | 'z';

// ---------------------------------------------------------------------------
//  Pipe run
// ---------------------------------------------------------------------------

export interface PipeLook<M extends string> {
  /** the pipe itself */
  pipe: M;
  /** the drop rod and the shoe that cradles the pipe */
  strap: M;
  /** metres between hangers */
  spacing: number;
  /** half-section of the drop rod */
  rod: number;
  /** how far the shoe sticks out past the pipe, each side */
  shoe: number;
  /** how far the shoe hangs below the pipe's top */
  shoeDrop: number;
  /** how far the shoe stands proud above the pipe's top */
  shoeRise: number;
}

/**
 * A straight pipe of radius `r` at height `y`, hung from `yCeil`.
 *
 * `a0`/`a1` are along `axis`; `across` is the other horizontal coordinate. At
 * least two hangers, always — a single one reads as a pipe balanced on a pin.
 */
export function pipeRun<S extends number, M extends string>(
  k: GreebleKit<S, M>, axis: RunAxis,
  a0: number, a1: number, y: number, across: number, r: number, yCeil: number,
  look: PipeLook<M>,
): void {
  if (axis === 'x') k.deco(a0, y - r, across - r, a1, y + r, across + r, look.pipe);
  else k.deco(across - r, y - r, a0, across + r, y + r, a1, look.pipe);
  const n = Math.max(2, Math.round(Math.abs(a1 - a0) / look.spacing));
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    const hx = axis === 'x' ? a : across;
    const hz = axis === 'x' ? across : a;
    pipeHanger(k, hx, y + r, hz, yCeil, look);
  }
}

/** One drop rod and its shoe. Exported because a run is not the only thing hung. */
export function pipeHanger<S extends number, M extends string>(
  k: GreebleKit<S, M>, x: number, yPipeTop: number, z: number, yCeil: number,
  look: Pick<PipeLook<M>, 'strap' | 'rod' | 'shoe' | 'shoeDrop' | 'shoeRise'>,
): void {
  const { rod, shoe } = look;
  k.deco(x - rod, yPipeTop, z - rod, x + rod, yCeil, z + rod, look.strap);
  k.deco(
    x - shoe, yPipeTop - look.shoeDrop, z - shoe,
    x + shoe, yPipeTop + look.shoeRise, z + shoe, look.strap,
  );
}

// ---------------------------------------------------------------------------
//  Small fittings
// ---------------------------------------------------------------------------

export interface ValveLook<M extends string> {
  /** the two crossed spokes */
  spoke: M;
  /** the boss the spokes turn on */
  boss: M;
  /** half-length of a spoke */
  reach: number;
  /** half-section of a spoke */
  bar: number;
  /** half-width of the boss */
  bossHalf: number;
  /** how far the boss drops below centre */
  bossDown: number;
  /** how far the boss stands above centre */
  bossUp: number;
}

/** A handwheel: two crossed spokes on a boss. */
export function valveWheel<S extends number, M extends string>(
  k: GreebleKit<S, M>, x: number, y: number, z: number, look: ValveLook<M>,
): void {
  const { reach, bar, bossHalf } = look;
  k.deco(x - reach, y - bar, z - bar, x + reach, y + bar, z + bar, look.spoke);
  k.deco(x - bar, y - bar, z - reach, x + bar, y + bar, z + reach, look.spoke);
  k.deco(x - bossHalf, y - look.bossDown, z - bossHalf, x + bossHalf, y + look.bossUp, z + bossHalf, look.boss);
}

/** A square-section conduit along one axis. */
export function conduit<S extends number, M extends string>(
  k: GreebleKit<S, M>, axis: RunAxis, a0: number, a1: number, y: number, across: number,
  look: { skin: M; half: number },
): void {
  const h = look.half;
  if (axis === 'x') k.deco(a0, y - h, across - h, a1, y + h, across + h, look.skin);
  else k.deco(across - h, y - h, a0, across + h, y + h, a1, look.skin);
}

export interface JunctionLook<M extends string> {
  body: M;
  gland: M;
  /** half extents of the body: across, up, out of the wall */
  w: number; h: number; d: number;
  /** the gland strip: how far it over-hangs the body, and how deep it is */
  glandOut: number; glandDepth: number;
  /**
   * Where the strip sits, as two drops BELOW centre — not as a thickness under
   * the body. It deliberately overlaps the body's lower edge, so a caller who
   * moves `h` does not tear the two apart.
   */
  glandLow: number; glandHigh: number;
}

/** A wall junction box with a gland strip under it. */
export function junctionBox<S extends number, M extends string>(
  k: GreebleKit<S, M>, x: number, y: number, z: number, look: JunctionLook<M>,
): void {
  k.deco(x - look.w, y - look.h, z - look.d, x + look.w, y + look.h, z + look.d, look.body);
  k.deco(
    x - look.glandOut, y - look.glandLow, z - look.glandDepth,
    x + look.glandOut, y - look.glandHigh, z + look.glandDepth, look.gland,
  );
}

// ---------------------------------------------------------------------------
//  Bolted plate
// ---------------------------------------------------------------------------

export interface PlateLook<M extends string> {
  skin: M;
  bolt: M;
  /** how far in from each edge a bolt head sits */
  inset: number;
  /** half-size of a bolt head in the plate's plane */
  head: number;
  /** how far a head stands proud of each face */
  proud: number;
}

/**
 * A plate with four bolt heads, in ANY axis-aligned plane.
 *
 * The mechanism is the axis detection: the thinnest of the three extents is
 * the plate's normal, the heads go on the other two, and they are extruded
 * through the thin axis so both faces show one. That is what makes this one
 * function rather than three, and it is the part a game should not re-derive.
 * Both directions are taken from the sign of the span, so a plate written
 * "backwards" bolts the same way.
 */
export function boltedPlate<S extends number, M extends string>(
  k: GreebleKit<S, M>,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  look: PlateLook<M>,
): void {
  k.deco(x0, y0, z0, x1, y1, z1, look.skin);
  const ix = Math.sign(x1 - x0) || 1;
  const iy = Math.sign(y1 - y0) || 1;
  const iz = Math.sign(z1 - z0) || 1;
  const { inset, head, proud } = look;
  const bx = inset * ix, by = inset * iy, bz = inset * iz;
  const xs = [x0 + bx, x1 - bx];
  const ys = [y0 + by, y1 - by];
  const zs = [z0 + bz, z1 - bz];
  const sx = Math.abs(x1 - x0), sy = Math.abs(y1 - y0), sz = Math.abs(z1 - z0);
  if (sx <= sy && sx <= sz) {
    for (const y of ys) for (const z of zs) {
      k.deco(x0 - proud * ix, y - head, z - head, x1 + proud * ix, y + head, z + head, look.bolt);
    }
  } else if (sz <= sx && sz <= sy) {
    for (const x of xs) for (const y of ys) {
      k.deco(x - head, y - head, z0 - proud * iz, x + head, y + head, z1 + proud * iz, look.bolt);
    }
  } else {
    for (const x of xs) for (const z of zs) {
      k.deco(x - head, y0 - proud * iy, z - head, x + head, y1 + proud * iy, z + head, look.bolt);
    }
  }
}

// ---------------------------------------------------------------------------
//  Cable tray
// ---------------------------------------------------------------------------

export interface TrayLook<M extends string> {
  /** the tray floor, its two upstands and the droppers */
  frame: M;
  /** the bundles lying in it */
  bundle: M;
  floor: number;
  wall: number;
  lipIn: number;
  /**
   * The two bundles, as a pair of offsets from the tray centreline, mirrored.
   * The first laid is the one on the LOW side of centre — order matters,
   * because `BrushKit.merge()` concatenates in push order.
   */
  bundleIn: number;
  bundleOut: number;
  bundleLow: number;
  bundleHigh: number;
  /** metres between droppers, and their half-section. `null` hangs nothing. */
  dropSpacing: number | null;
  dropHalf: number;
  /** how far above the tray a dropper reaches when no ceiling is given */
  dropReach: number;
}

/**
 * A tray of bundles between two rails, optionally hung from a ceiling.
 *
 * The two hand-written copies this replaced had DRIFTED: the X one hung
 * droppers and the Z one did not, in the same room of the same game. That is
 * what a second copy costs, and it is why the axis is an argument.
 */
export function cableTray<S extends number, M extends string>(
  k: GreebleKit<S, M>, axis: RunAxis,
  a0: number, a1: number, y: number, c0: number, c1: number, yCeil: number | undefined,
  look: TrayLook<M>,
): void {
  const { floor, wall, lipIn } = look;
  const along = (lo: number, hi: number, yl: number, yh: number, mat: M) => {
    if (axis === 'x') k.deco(a0, yl, lo, a1, yh, hi, mat);
    else k.deco(lo, yl, a0, hi, yh, a1, mat);
  };
  along(c0, c1, y, y + floor, look.frame);
  along(c0, c0 + lipIn, y + floor, y + wall, look.frame);
  along(c1 - lipIn, c1, y + floor, y + wall, look.frame);
  const mid = (c0 + c1) * 0.5;
  along(mid - look.bundleOut, mid - look.bundleIn, y + look.bundleLow, y + look.bundleHigh, look.bundle);
  along(mid + look.bundleIn, mid + look.bundleOut, y + look.bundleLow, y + look.bundleHigh, look.bundle);
  if (look.dropSpacing === null) return;
  const top = yCeil ?? y + look.dropReach;
  const n = Math.max(2, Math.round(Math.abs(a1 - a0) / look.dropSpacing));
  const d = look.dropHalf;
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    if (axis === 'x') k.deco(a - d, y + wall, mid - d, a + d, top, mid + d, look.frame);
    else k.deco(mid - d, y + wall, a - d, mid + d, top, a + d, look.frame);
  }
}

// ---------------------------------------------------------------------------
//  Drum
// ---------------------------------------------------------------------------

/**
 * Where the fittings sit along a drum, as fractions of its length.
 *
 * SEPARATE PER POSE, and that is not symmetry that was lost in the move — the
 * one game this came from really does band a standing drum at 0.16/0.84 and a
 * lying one at 0.18/0.82, and puts the bung a third of the way off centre on
 * one and a fifth on the other. Two records rather than one is what stops a
 * later edit quietly making them agree.
 */
export interface DrumPose {
  hoopA: number;
  hoopB: number;
  /** how far past the end the lid sits, and how far past the lid the bung does */
  lidGap: number;
  bungGap: number;
  /** how far off the axis the bung is, as a fraction of the radius */
  bungOff: number;
}

export interface DrumLook<M extends string> {
  body: M;
  hoop: M;
  lid: M;
  surface: number;
  /** radial segments of the body and lid, and of the bung */
  seg: number;
  bungSeg: number;
  /** how far the hoops stand off the body, and their tube radius and segments */
  hoopOut: number;
  hoopTube: number;
  hoopRadial: number;
  hoopTubular: number;
  /** how far the lid overhangs and how thick it is */
  lidOut: number;
  lidThick: number;
  /** the bung's radius and thickness */
  bung: number;
  bungThick: number;
  /** the collider inside the silhouette, as a fraction of the radius */
  boxIn: number;
  standing: DrumPose;
  lying: DrumPose;
  /** a lying drum's collider: how far in from each end, and how tall in radii */
  lyingEnd: number;
  lyingTall: number;
}

/**
 * A hooped drum, standing on end or lying down.
 *
 * `x, y, z` is the FOOT of a standing drum and the near end of a lying one, so
 * a caller places it on a floor rather than computing a centre. The collider
 * is a box kept inside the cylinder, so a silhouette is round and the capsule
 * still cannot walk into it.
 */
export function hoopedDrum<S extends number, M extends string>(
  k: GreebleKit<S, M>, x: number, y: number, z: number, r: number, h: number,
  axis: 'y' | 'x', look: DrumLook<M>,
): void {
  const body = new THREE.CylinderGeometry(r, r, h, look.seg);
  const hoopA = new THREE.TorusGeometry(r + look.hoopOut, look.hoopTube, look.hoopRadial, look.hoopTubular);
  const hoopB = new THREE.TorusGeometry(r + look.hoopOut, look.hoopTube, look.hoopRadial, look.hoopTubular);
  const lid = new THREE.CylinderGeometry(r + look.lidOut, r + look.lidOut, look.lidThick, look.seg);
  const bung = new THREE.CylinderGeometry(look.bung, look.bung, look.bungThick, look.bungSeg);
  const inset = r * look.boxIn;
  const surface = look.surface as S;
  if (axis === 'x') {
    const q = look.lying;
    body.rotateZ(Math.PI / 2);
    hoopA.rotateY(Math.PI / 2);
    hoopB.rotateY(Math.PI / 2);
    lid.rotateZ(Math.PI / 2);
    bung.rotateZ(Math.PI / 2);
    const cx = x + h * 0.5;
    const cy = y + r;
    k.mesh(look.body, body, cx, cy, z);
    k.mesh(look.hoop, hoopA, x + h * q.hoopA, cy, z);
    k.mesh(look.hoop, hoopB, x + h * q.hoopB, cy, z);
    k.mesh(look.lid, lid, x + h + q.lidGap, cy, z);
    k.mesh(look.hoop, bung, x + h + q.bungGap, cy, z + r * q.bungOff);
    k.box(
      x + look.lyingEnd, y, z - inset,
      x + h - look.lyingEnd, y + r * look.lyingTall, z + inset,
      look.body, surface,
    );
  } else {
    const q = look.standing;
    hoopA.rotateX(Math.PI / 2);
    hoopB.rotateX(Math.PI / 2);
    k.mesh(look.body, body, x, y + h * 0.5, z);
    k.mesh(look.hoop, hoopA, x, y + h * q.hoopA, z);
    k.mesh(look.hoop, hoopB, x, y + h * q.hoopB, z);
    k.mesh(look.lid, lid, x, y + h + q.lidGap, z);
    k.mesh(look.hoop, bung, x + r * q.bungOff, y + h + q.bungGap, z);
    k.box(x - inset, y, z - inset, x + inset, y + h, z + inset, look.body, surface);
  }
}

// ---------------------------------------------------------------------------
//  Locker bank
// ---------------------------------------------------------------------------

export interface LockerLook<M extends string> {
  door: M;
  trim: M;
  surface: number;
  /** metres of door width per locker */
  pitch: number;
  /** the plinth under the bank */
  plinth: number;
  /** half-thickness of a door divider */
  divider: number;
  /** the handle: how far it stands out, and where up the door it sits */
  handleOut: number;
  handleHalf: number;
  handleLow: number;
  handleHigh: number;
}

/**
 * A bank of lockers along Z, with the handles on the +X face.
 *
 * The divider count comes out of the run length rather than being passed, so a
 * long bank and a short one have the same door width — which is what makes a
 * row of them read as a bank rather than as one stretched cabinet.
 */
export function lockerBank<S extends number, M extends string>(
  k: GreebleKit<S, M>,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  look: LockerLook<M>,
): void {
  k.box(x0, y0, z0, x1, y1, z1, look.door, look.surface as S);
  k.deco(x0, y0, z0, x1, y0 + look.plinth, z1, look.trim);
  const n = Math.max(2, Math.round(Math.abs(z1 - z0) / look.pitch));
  for (let i = 0; i <= n; i++) {
    const z = z0 + (z1 - z0) * (i / n);
    k.deco(x0, y0, z - look.divider, x1, y1, z + look.divider, look.trim);
  }
  for (let i = 0; i < n; i++) {
    const z = z0 + (z1 - z0) * ((i + 0.5) / n);
    k.deco(
      x1, y0 + (y1 - y0) * look.handleLow, z - look.handleHalf,
      x1 + look.handleOut, y0 + (y1 - y0) * look.handleHigh, z + look.handleHalf, look.trim,
    );
  }
}

// ---------------------------------------------------------------------------
//  Guyed lattice mast
// ---------------------------------------------------------------------------

export interface MastLook<M extends string> {
  leg: M;
  rime: M;
  skirt: M;
  lamp: M;
  legSurface: number;
  rimeSurface: number;
  skirtSurface: number;
  /** the base pad: half-width, its top, and the roof it sits on */
  padHalf: number;
  padTop: number;
  groundY: number;
  /** the two quarter-skirts either side of the pad */
  skirtHalf: number;
  skirtIn: number;
  rimeTop: number;
  skirtTop: number;
  /** the mast: where the legs start, their half-spacing and half-section */
  legFoot: number;
  half: number;
  legHalf: number;
  /** how far rime climbs a leg, and how far it stands proud of one */
  rimeClimb: number;
  rimeProud: number;
  /** ring bands: how many, the first one's lift, the pitch divisor, the band depth */
  rings: number;
  ringLift: number;
  ringSpan: number;
  ringThick: number;
  /** the crossed bay bars: their lift above a ring, their depth and half-section */
  barLift: number;
  barTop: number;
  barHalf: number;
  /** the X-brace: where it starts above a ring, and its section */
  braceFoot: number;
  braceSection: number;
  /** the head: cap half-width and height, then the lamp's */
  capHalf: number;
  capTall: number;
  lampHalf: number;
  lampTall: number;
  /** guys: how far out the anchors sit, how far below the head they leave */
  reach: number;
  headDrop: number;
  /** where a guy lands, and its section */
  guyFoot: number;
  guySection: number;
  /** each anchor block, and the rime pad under it */
  anchorHalf: number;
  anchorTop: number;
  anchorRimeHalf: number;
  anchorRimeTop: number;
}

/**
 * A guyed lattice mast: four legs, N ring bands with crossed bay bars and
 * X-braces between them, a lamp on the head, and four guys to roof anchors.
 *
 * NOTHING FLOATS — the base pad, the rime skirt and the four anchor blocks are
 * part of the mast, not decoration a caller adds afterwards. A mast whose guys
 * end in mid-air is the one thing about this shape that reads as a bug from
 * across a room.
 */
export function guyedMast<S extends number, M extends string>(
  k: GreebleKit<S, M>, x: number, z: number, h: number, look: MastLook<M>,
): void {
  const { half, legHalf: leg, padHalf, groundY } = look;
  const y0 = look.legFoot;
  k.box(x - padHalf, groundY, z - padHalf, x + padHalf, look.padTop, z + padHalf,
    look.leg, look.legSurface as S, { blockOnly: true });
  k.box(x - look.skirtHalf, groundY, z - look.skirtHalf, x - look.skirtIn, look.rimeTop, z - look.skirtIn,
    look.rime, look.rimeSurface as S);
  k.box(x + look.skirtIn, groundY, z + look.skirtIn, x + look.skirtHalf, look.skirtTop, z + look.skirtHalf,
    look.skirt, look.skirtSurface as S);

  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    k.deco(
      x + dx * half - leg, y0, z + dz * half - leg,
      x + dx * half + leg, y0 + h, z + dz * half + leg, look.leg,
    );
    const p = look.rimeProud;
    k.deco(
      x + dx * half - leg - p, y0, z + dz * half - leg - p,
      x + dx * half + leg + p, y0 + look.rimeClimb, z + dz * half + leg + p, look.rime,
    );
  }

  const rings = look.rings;
  for (let i = 0; i < rings; i++) {
    const y = y0 + look.ringLift + i * (h / (rings - look.ringSpan));
    const t = look.ringThick;
    k.deco(x - half - leg, y, z - half - leg, x + half + leg, y + t, z - half + leg, look.leg);
    k.deco(x - half - leg, y, z + half - leg, x + half + leg, y + t, z + half + leg, look.leg);
    k.deco(x - half - leg, y, z - half - leg, x - half + leg, y + t, z + half + leg, look.leg);
    k.deco(x + half - leg, y, z - half - leg, x + half + leg, y + t, z + half + leg, look.leg);
    const b = look.barHalf;
    k.deco(x - half, y + look.barLift, z - b, x + half, y + look.barTop, z + b, look.leg);
    k.deco(x - b, y + look.barLift, z - half, x + b, y + look.barTop, z + half, look.leg);
    if (i < rings - 1) {
      const y1 = y0 + look.ringLift + (i + 1) * (h / (rings - look.ringSpan));
      faceBrace(k, x, z, y + look.braceFoot, y1, half, 'z', 1, look);
      faceBrace(k, x, z, y + look.braceFoot, y1, half, 'z', -1, look);
      faceBrace(k, x, z, y + look.braceFoot, y1, half, 'x', 1, look);
      faceBrace(k, x, z, y + look.braceFoot, y1, half, 'x', -1, look);
    }
  }

  const c = look.capHalf;
  k.deco(x - c, y0 + h, z - c, x + c, y0 + h + look.capTall, z + c, look.leg);
  const l = look.lampHalf;
  k.deco(x - l, y0 + h + look.capTall, z - l, x + l, y0 + h + look.capTall + look.lampTall, z + l, look.lamp);

  const reach = look.reach;
  const headY = y0 + h - look.headDrop;
  guy(k, x, headY, z, x + reach, look.guyFoot, z, look);
  guy(k, x, headY, z, x - reach, look.guyFoot, z, look);
  guy(k, x, headY, z, x, look.guyFoot, z + reach, look);
  guy(k, x, headY, z, x, look.guyFoot, z - reach, look);
  for (const [ax, az] of [[reach, 0], [-reach, 0], [0, reach], [0, -reach]] as const) {
    const a = look.anchorHalf;
    k.deco(x + ax - a, groundY, z + az - a, x + ax + a, look.anchorTop, z + az + a, look.leg);
    const ar = look.anchorRimeHalf;
    k.deco(x + ax - ar, groundY, z + az - ar, x + ax + ar, look.anchorRimeTop, z + az + ar, look.rime);
  }
}

/**
 * An X-brace across one axis-aligned face of a mast.
 *
 * THE ORDER OF THE TWO `mesh` CALLS IS LOAD-BEARING. `BrushKit.merge()`
 * concatenates a bucket in push order, so swapping the diagonals rewrites every
 * float after them in the merged buffer. `d = 1` is the first one.
 *
 * AND THE CENTRE IS `cx`/`cz`, NOT THE STRUT'S OWN. `strutBetween` returns the
 * midpoint of the two endpoints it was given, and `((c + h) + (c - h)) * 0.5`
 * is NOT `c` in binary floating point — measured at c = -1.237839488312602
 * coming back one ulp low. A brace already HAS its centre; deriving it back out
 * of two symmetric endpoints throws away a digit for nothing. `s.y` IS used,
 * because `(y0 + y1) * 0.5` is the expression that was already there.
 */
function faceBrace<S extends number, M extends string>(
  k: GreebleKit<S, M>, x: number, z: number, y0: number, y1: number, half: number,
  axis: RunAxis, sign: 1 | -1, look: Pick<MastLook<M>, 'leg' | 'braceSection'>,
): void {
  const cx = axis === 'z' ? x : x + sign * half;
  const cz = axis === 'z' ? z + sign * half : z;
  const ax = axis === 'z' ? half : 0;
  const az = axis === 'z' ? 0 : half;
  for (const d of [1, -1] as const) {
    const s = strutBetween(cx + d * ax, y0, cz + d * az, cx - d * ax, y1, cz - d * az, look.braceSection);
    k.mesh(look.leg, s.geo, cx, s.y, cz);
  }
}

/** One tie from the mast head to a roof anchor. */
function guy<S extends number, M extends string>(
  k: GreebleKit<S, M>,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  look: Pick<MastLook<M>, 'leg' | 'guySection'>,
): void {
  const s = strutBetween(x0, y0, z0, x1, y1, z1, look.guySection);
  k.mesh(look.leg, s.geo, s.x, s.y, s.z);
}
