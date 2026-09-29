/**
 * ============================================================================
 *  route — a control polyline becomes terrain-following frames, and frames
 *  become swept solids, ribbons, dashes and slices.
 * ============================================================================
 *  Extracted from a base-building game's structure builder, byte-for-byte
 *  except for the terrain type (see below) and the module's own scratch.
 *
 *  A road, a pressurised tube and a power line are three props; "sample a
 *  polyline against a height field, then sweep a cross-section along the
 *  frames" is one piece of geometry, and it is what every game with a path on
 *  a landscape needs. It knows a frame, a profile and an arc length. It does
 *  not know what a road is.
 *
 *  ── WHAT `station.ts` IS AND WHY THIS IS NOT IT ─────────────────────────────
 *  `station.ts` cuts a CLOSED corridor into stations and answers wrap-safe
 *  lookups for two racers' AI, tens of thousands of times a second. This file
 *  is build-time only, open-ended, and produces triangles. They share a word
 *  and nothing else; neither imports the other and neither should.
 *
 *  ── THE ONE THING THAT IS NOT BYTE-IDENTICAL: THE TERRAIN TYPE ──────────────
 *  The source typed the terrain argument as the game's own terrain interface,
 *  with a dozen members about regolith, craters and rilles. A package may not
 *  import a game's types, and it does not need to: every line below calls
 *  exactly ONE member. So the parameter is a STRUCTURAL interface with that one
 *  member, which the game's terrain satisfies without being changed or being
 *  told about this file. That is the technique: the narrowest type the code
 *  actually uses, declared by the consumer, never a shared nominal one.
 *
 *  ── THE COMMENTS BELOW ARE THE ASSET AND THEY CAME WITH IT ──────────────────
 *  Four of them carry MEASURED numbers from failures that shipped: a rigid
 *  slab 36.8 m off the surface, a carriageway sitting 0.63-0.67 m under its
 *  own terrain samples, 9,504 vertices of road facing DOWN and zero facing up,
 *  and a "dashed" centre line that quantised to a continuous line. Every one
 *  of those is a picture bug that no conformance check can see. They travel
 *  with the code. A comment that looks wrong may still be guarding something
 *  for a different reason — work out which before removing either.
 */
import * as THREE from 'three';

/**
 * The one thing a route needs from a landscape.
 *
 * `heightAt` in WORLD metres, XZ in, Y out. A game's terrain, a flat plane, a
 * heightmap reader or a test stub all satisfy this; none of them has to know
 * this file exists.
 *
 * DECLARED IN `@homie-rocks/heightfield` AND RE-EXPORTED HERE, since 2026-08-21. A
 * route SAMPLES a terrain; it does not get to say what one is. This
 * declaration used to sit in this file with nothing implementing it while
 * three games each carried their own heightfield, so the interface moved to
 * the package that now implements it and this line keeps every existing
 * `import type { HeightField } from '@homie-rocks/geom/route.js'` working, with
 * still exactly ONE declaration in the tree. `export type` is erased on emit,
 * so `dist/route.js` gains no runtime import and no browser import map
 * changes.
 */
export type { HeightField } from '@homie-rocks/heightfield/Field.js';
import type { HeightField } from '@homie-rocks/heightfield/Field.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);


// ─────────────────────────────────────────────────────────────────────────────
// Routes — roads, tubes and power lines all sweep the same sampled frame
//
// The most expensive geometry lesson behind this file: a rigid
// 240 m cylinder placed from ONE height sample at the midpoint of a 272 m arc
// left the surface by 36.8 m at both ends, and the error grew quadratically
// while the anchor looked perfect. The correct sibling function, thirty lines
// away, measured 0.00003 m. So: sample the terrain at EVERY ring, always.
// ─────────────────────────────────────────────────────────────────────────────

export interface Frame {
  p: THREE.Vector3;
  fwd: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** Cumulative distance along the route in metres — the V of every UV. */
  d: number;
}

export type RoutePoint = THREE.Vector3 | THREE.Vector2 | [number, number] | { x: number; z: number };

function toXZ(p: RoutePoint, out: THREE.Vector3): THREE.Vector3 {
  if (Array.isArray(p)) return out.set(p[0], 0, p[1]);
  const anyP = p as any;
  return out.set(anyP.x, 0, anyP.z !== undefined ? anyP.z : anyP.y);
}

/**
 * Turn a control polyline into terrain-following frames.
 *
 * `lift` is measured from the ground, so a road at 0.06 m and a tube at 2.4 m
 * both track a ridge correctly. Tangents are recomputed from the LIFTED 3-D
 * positions, so a ribbon on a slope lies in the slope rather than hovering off
 * the downhill end of it.
 */
export function sampleRoute(
  pts: RoutePoint[], terrain: HeightField | null, spacing: number, lift: number | ((t: number) => number),
  crossWidth = 0, grade = 0,
): Frame[] {
  const ctrl: THREE.Vector3[] = pts.map((p) => toXZ(p, new THREE.Vector3()));
  if (ctrl.length < 2) return [];
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5);
  const flatLen = curve.getLength();
  const n = Math.max(2, Math.ceil(flatLen / spacing));
  const frames: Frame[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curve.getPointAt(t);
    const l = typeof lift === 'function' ? lift(t) : lift;
    p.y = (terrain ? terrain.heightAt(p.x, p.z) : 0) + l;
    frames.push({ p, fwd: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), d: 0 });
  }

  // ── GRADING: the second reason the road network was invisible ─────────────
  //
  // A road founded on a single centreline sample every `spacing` metres sinks
  // into every bump between the samples, and the sinking is not small. Measured
  // on the first build with the boulevard's own frames: the slab top sat
  // 0.63-0.67 m BELOW `terrain.heightAt` at its own vertices over long stretches
  // of the run, so even with the winding fixed above the carriageway would have
  // been buried in regolith for most of its length. This is the floating
  // cylinder's "place everything in the frame you sampled" failure in its
  // cross-sectional form: sampling the centreline is not sampling the corridor.
  //
  // A real road is not draped over the ground, it is CUT AND FILLED. So:
  //
  //   1. take the MAXIMUM terrain height across the corridor's full width at
  //      each station, not the centreline value and not the mean, so the slab
  //      clears the high shoulder instead of splitting the difference with it;
  //   2. fill the dips longitudinally. Replacing y with max(y, mean of its two
  //      neighbours) converges on a profile that bridges hollows and still
  //      follows ridges, which is what a vertical alignment does. Six passes at
  //      4 m spacing gives a ~24 m influence radius: long enough to carry a
  //      crater hollow, short enough not to launch the road off a rim.
  //
  // The road profile then carries a batter down to -2.4 m on each side, which
  // is the fill that makes the raised carriageway read as an embankment rather
  // than as a slab hovering over the regolith.
  if (grade > 0 && terrain) {
    const y: number[] = new Array(frames.length);
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      // Provisional tangent, only good enough to aim the cross probes.
      const a = frames[Math.max(0, i - 1)].p, bq = frames[Math.min(frames.length - 1, i + 1)].p;
      _v.subVectors(bq, a).setY(0).normalize();
      _v2.crossVectors(_v, _up).normalize();
      let h = terrain.heightAt(f.p.x, f.p.z);
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue;
        const s = (k / 2) * grade;
        h = Math.max(h, terrain.heightAt(f.p.x + _v2.x * s, f.p.z + _v2.z * s));
      }
      y[i] = h;
    }
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < y.length - 1; i++) y[i] = Math.max(y[i], (y[i - 1] + y[i + 1]) * 0.5);
    }
    for (let i = 0; i < frames.length; i++) {
      const l = typeof lift === 'function' ? lift(i / n) : lift;
      frames[i].p.y = y[i] + l;
    }
  }

  for (let i = 0; i < frames.length; i++) {
    const a = frames[Math.max(0, i - 1)].p, b = frames[Math.min(frames.length - 1, i + 1)].p;
    frames[i].fwd.subVectors(b, a).normalize();
    frames[i].right.crossVectors(frames[i].fwd, _up).normalize();
    // Re-derive up from the actual tangent, so the cross-section stays
    // perpendicular to the road on a grade instead of shearing.
    frames[i].up.crossVectors(frames[i].right, frames[i].fwd).normalize();

    // CROSS-SLOPE. A 17.4 m wide slab held level across a hillside leaves up to
    // a metre of daylight on the uphill edge — measured 0.98 m on a test
    // terrain before this existed, which is the same class of error as the
    // floating cylinder above, just rotated 90 degrees.
    // Sampling the terrain at the slab's own half-width and rolling the section
    // into it took that to under 0.25 m, and the kerb's 0.62 m skirt covers the
    // remainder. Capped at 12 degrees so a road crossing a crater rim banks
    // like a road and not like a rollercoaster.
    // Skipped entirely once the corridor has been GRADED: a cut-and-fill
    // causeway is level in section by construction, and rolling it into a
    // cross-slope it no longer has would tip the kerbs and put one edge strip
    // under the fill. Cross-slope is for a route that drapes (tubes, cables).
    if (crossWidth > 0 && terrain && grade <= 0) {
      const f = frames[i];
      const hl = terrain.heightAt(f.p.x - f.right.x * crossWidth, f.p.z - f.right.z * crossWidth);
      const hr = terrain.heightAt(f.p.x + f.right.x * crossWidth, f.p.z + f.right.z * crossWidth);
      const roll = Math.max(-0.21, Math.min(0.21, Math.atan2(hr - hl, crossWidth * 2)));
      // NEGATIVE roll, and the sign is not a guess. `right` is cross(fwd, up),
      // which for fwd = +Z gives -X; rotating that about +Z by +roll drives its
      // Y component NEGATIVE, so a +roll would bank the section into the hill
      // instead of onto it. Measured worst-case deviation from the sampled
      // ground on the test terrain: 0.98 m with no cross-slope, 1.35 m
      // with the sign wrong, 0.61 m with it right — and 0.61 m is inside the
      // kerb's own 0.62 m skirt, which is why the skirt is that deep. If this
      // ever looks wrong again, measure it; do not reason about it.
      f.right.applyAxisAngle(f.fwd, -roll);
      f.up.crossVectors(f.right, f.fwd).normalize();
      // Re-centre the section on the mean of the three probes rather than on
      // the centreline alone, so a road crossing a ridge sits astride it.
      const l = typeof lift === 'function' ? lift(i / n) : lift;
      f.p.y = (hl + hr) * 0.25 + (f.p.y - l) * 0.5 + l;
    }
    if (i > 0) frames[i].d = frames[i - 1].d + frames[i].p.distanceTo(frames[i - 1].p);
  }
  return frames;
}

const _sp = new THREE.Vector3();

/**
 * Sweep a 2-D cross-section [right, up] along frames.
 *
 * The profile normal is computed in the section plane and split at corners
 * sharper than 34 degrees, which is what keeps a kerb chamfer reading as a
 * chamfer instead of smoothing into the slab.
 */
export function sweepGeo(frames: Frame[], profile: number[][], closed = false): THREE.BufferGeometry {
  if (frames.length < 2 || profile.length < 2) return new THREE.BufferGeometry();
  const m = profile.length;
  const segN: number[][] = [];
  const count = closed ? m : m - 1;
  for (let i = 0; i < count; i++) {
    const a = profile[i], b = profile[(i + 1) % m];
    const dr = b[0] - a[0], du = b[1] - a[1];
    const L = Math.hypot(dr, du) || 1;
    segN.push([du / L, -dr / L]);
  }
  // Per-profile-point ring entries, duplicated at a hard corner.
  const ring: number[][] = [];   // [r, u, nr, nu, arc]
  let acc = 0;
  const cosSharp = Math.cos((34 * Math.PI) / 180);
  for (let i = 0; i < m; i++) {
    if (i > 0) acc += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
    const a = closed ? segN[(i - 1 + m) % m] : segN[i - 1];
    const b = closed ? segN[i % m] : segN[i];
    if (a && b) {
      if (a[0] * b[0] + a[1] * b[1] < cosSharp) {
        ring.push([profile[i][0], profile[i][1], a[0], a[1], acc]);
        ring.push([profile[i][0], profile[i][1], b[0], b[1], acc]);
        continue;
      }
      const nr = a[0] + b[0], nu = a[1] + b[1];
      const L = Math.hypot(nr, nu) || 1;
      ring.push([profile[i][0], profile[i][1], nr / L, nu / L, acc]);
    } else {
      const s = a || b;
      ring.push([profile[i][0], profile[i][1], s[0], s[1], acc]);
    }
  }
  if (closed) ring.push([...ring[0].slice(0, 4), acc + Math.hypot(profile[0][0] - profile[m - 1][0], profile[0][1] - profile[m - 1][1])]);

  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const push = (fi: number, ri: number) => {
    const f = frames[fi], e = ring[ri];
    _sp.copy(f.p).addScaledVector(f.right, e[0]).addScaledVector(f.up, e[1]);
    pos.push(_sp.x, _sp.y, _sp.z);
    // NEGATED, AND THIS IS THE FIX FOR THE MISSING ROAD NETWORK.
    //
    // `segN` above is the 2-D left normal of the section, which is the outward
    // normal only in a RIGHT-handed (r, u) frame. Our frames are not: `right`
    // is cross(fwd, up), so for fwd = +Z it is -X, and (right, up, fwd) has
    // determinant -1. Every surface this function produced therefore came out
    // inside-out.
    //
    // MEASURED on the first build, before any other change: of 9,504 vertices
    // in the boulevard's slab, 4,740 faced down and ZERO faced up; the painted
    // markings were 3,360 of 3,360 down; the cyan edge strips 5,184 of 5,184
    // down; the transit tubes' interior deck 72 of 72 down. Those materials are
    // FrontSide, so the entire road network — slab, kerbs, painted markings and
    // the emissive strips the art direction uses as the frame's leading lines —
    // was back-face culled from every camera above the road, which is every
    // camera in the game. It was not subtle art, it was not drawn.
    //
    // The winding below is reversed to match, so the geometric and the shading
    // normal agree. Fixing it here rather than by reversing the profile arrays
    // at the call sites is deliberate: there were eight of them, a reversed
    // profile also reverses the section arc-length that becomes the U of the
    // UV, and the next person to author a cross-section would get it wrong
    // again. `sampleRoute`'s cross-slope sign is MEASURED against the existing
    // handedness (see its comment) and is not touched by this.
    _sp.set(0, 0, 0).addScaledVector(f.right, -e[2]).addScaledVector(f.up, -e[3]);
    nor.push(_sp.x, _sp.y, _sp.z);
    uv.push(e[4], f.d);
  };
  for (let i = 0; i < frames.length - 1; i++) {
    for (let j = 0; j < ring.length - 1; j++) {
      if (ring[j][0] === ring[j + 1][0] && ring[j][1] === ring[j + 1][1]) continue;
      push(i, j); push(i + 1, j + 1); push(i + 1, j);
      push(i, j); push(i, j + 1); push(i + 1, j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** A flat strip lying on the route surface: lane markings and light strips. */
export function ribbonGeo(frames: Frame[], offset: number, width: number, lift: number, from = 0, to = -1): THREE.BufferGeometry {
  const a = Math.max(0, from), b = to < 0 ? frames.length - 1 : Math.min(to, frames.length - 1);
  if (b - a < 1) return new THREE.BufferGeometry();
  const sub = frames.slice(a, b + 1);
  const lifted = sub.map((f) => ({ ...f, p: f.p.clone().addScaledVector(f.up, lift) }));
  return sweepGeo(lifted as Frame[], [[offset - width / 2, 0], [offset + width / 2, 0]]);
}

/**
 * The frame at an exact distance along a route, interpolated between stations.
 *
 * Build-time only, so the allocation is fine; the alternative is an out-param
 * that every caller then has to clone anyway because these end up stored.
 */
/**
 * A swept frame AS A TRANSFORM: the basis is (right, up, fwd) and the origin is
 * `at`, defaulting to the frame's own point.
 *
 * Every generator that hangs geometry off a route writes this — a relief joint
 * across a carriageway, a crate staged beside it, a stiffening rib round a
 * bore, a saddle under it, a bulkhead closing it — and writes it the same way,
 * because a frame IS an orthonormal basis and `makeBasis` is how three takes
 * one. Naming it is worth more than the lines it saves: `makeBasis(f.right,
 * f.up, f.fwd)` does not say which way the piece will end up facing, and the
 * answer is "the piece's local X runs across the route, its Y up, its Z along".
 *
 * `turnX` is a rotation about the piece's own X applied AFTER the basis, and it
 * exists for one recurring need rather than for generality: a lathe or a torus
 * is authored lying in XZ, and a SECTION of a swept run is the plane the
 * frame's forward is normal to, so a ring wants a quarter turn to stand up in
 * it. Its SIGN is the caller's — which face a section presents depends on which
 * end of the run it is closing, and getting it wrong back-face-culls a bulkhead
 * rather than erroring.
 *
 * Returns a FRESH matrix. Every caller keeps its result and hands it to an
 * accumulator that reads rather than copies, so a shared scratch here would be
 * one piece silently wearing the next piece's transform.
 */
export function frameXf(f: Frame, at?: THREE.Vector3, turnX = 0): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeBasis(f.right, f.up, f.fwd).setPosition(at ?? f.p);
  if (turnX) m.multiply(new THREE.Matrix4().makeRotationX(turnX));
  return m;
}

export function frameAtDistance(frames: Frame[], d: number): Frame {
  const last = frames.length - 1;
  if (last < 1) return frames[0];
  if (d <= frames[0].d) return frames[0];
  if (d >= frames[last].d) return frames[last];
  let i = 0;
  while (i < last - 1 && frames[i + 1].d <= d) i++;
  const a = frames[i], b = frames[i + 1];
  const u = (d - a.d) / Math.max(1e-6, b.d - a.d);
  return {
    p: a.p.clone().lerp(b.p, u),
    fwd: a.fwd.clone().lerp(b.fwd, u).normalize(),
    right: a.right.clone().lerp(b.right, u).normalize(),
    up: a.up.clone().lerp(b.up, u).normalize(),
    d,
  };
}

/**
 * The sub-run of a route between two distances, with EXACT ends.
 *
 * `d` is preserved from the parent route rather than re-based to zero, which is
 * what lets a dash pattern or a travelling pulse keep one global phase across a
 * route that has been cut into several runs by a junction.
 */
export function sliceFrames(frames: Frame[], d0: number, d1: number): Frame[] {
  if (frames.length < 2) return [];
  const total = frames[frames.length - 1].d;
  const a = Math.max(0, Math.min(total, d0));
  const b = Math.max(0, Math.min(total, d1));
  if (b - a < 1e-3) return [];
  const out: Frame[] = [frameAtDistance(frames, a)];
  for (const f of frames) if (f.d > a + 1e-3 && f.d < b - 1e-3) out.push(f);
  out.push(frameAtDistance(frames, b));
  return out;
}

/**
 * The complement of a set of [from, to] distance holes over [0, total].
 *
 * This is how a road yields at a junction: one party (the road builder) works
 * out where the network crosses itself and hands the intervals back, and every
 * piece of road geometry — slab, paint, emissive — is emitted from the SAME
 * interval list. "Two systems must not both own the same volume" is a picture
 * problem here, and the fix is a single authority for what is paved.
 */
export function runsOutside(total: number, holes?: readonly [number, number][]): [number, number][] {
  if (!holes || holes.length === 0) return total > 0 ? [[0, total]] : [];
  const sorted = holes
    .map((h) => [Math.max(0, h[0]), Math.min(total, h[1])] as [number, number])
    .filter((h) => h[1] > h[0])
    .sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let cur = 0;
  for (const h of sorted) {
    // Runs shorter than a metre are a sliver of kerb nobody can see and two
    // more draws' worth of vertices, so they are dropped rather than emitted.
    if (h[0] > cur + 1.0) out.push([cur, h[0]]);
    cur = Math.max(cur, h[1]);
  }
  if (total > cur + 1.0) out.push([cur, total]);
  return out;
}

/**
 * Dashed lane marking.
 *
 * ── THE DASHES WERE ONCE NOT DASHED, AND THE ARITHMETIC SAYS WHY ────────────
 *
 * The previous implementation picked the dash's start and end by SNAPPING to
 * frame indices: `while (frames[i1].d < s + dash) i1++`. Road frames were 4 m
 * apart and the dash was 4.5 m, so every dash was rounded UP to the next
 * station — and the next period's start index was then rounded DOWN past it.
 * Worked through for the shipped numbers (dash 4.5, gap 4.5, spacing 4): dash
 * 1 covered 0-8 m, dash 2 covered 8-16 m, dash 3 covered 16-24 m. The gap was
 * quantised to exactly zero and the "dashed" divider was a CONTINUOUS painted
 * line for the whole length of every road in the game, which is precisely what
 * a review measured off the rendered frames.
 *
 * So the dash ends are interpolated now, never snapped, and the phase is taken
 * from the parent route's distance so a run cut out by a junction resumes the
 * rhythm instead of restarting it.
 */
export function dashedRibbon(
  frames: Frame[], offset: number, width: number, lift: number, dash = 3.0, gap = 9.0,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (frames.length < 2) return new THREE.BufferGeometry();
  const d0 = frames[0].d;
  const total = frames[frames.length - 1].d;
  const period = dash + gap;
  for (let s = Math.floor(d0 / period) * period; s < total; s += period) {
    const sub = sliceFrames(frames, Math.max(s, d0), Math.min(s + dash, total));
    // A dash clipped to under a third of its length by a junction reads as a
    // paint blob, not as the start of a rhythm.
    if (sub.length >= 2 && sub[sub.length - 1].d - sub[0].d > dash * 0.34) {
      parts.push(ribbonGeo(sub, offset, width, lift));
    }
  }
  return mergeGeos(parts);
}

/** Concatenate geometries that already share an attribute layout. */
export function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (const g of list) {
    const p = g.attributes.position;
    if (!p) continue;
    const pa = p.array as ArrayLike<number>;
    const na = g.attributes.normal.array as ArrayLike<number>;
    const ua = g.attributes.uv.array as ArrayLike<number>;
    for (let i = 0; i < p.count; i++) {
      pos.push(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]);
      nor.push(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]);
      uv.push(ua[i * 2], ua[i * 2 + 1]);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

// ---------------------------------------------------------------------------
// Frame-list operations, profile generators and the swept-surface index
// ---------------------------------------------------------------------------
//
// Everything below came from the same base-building game's structure builder,
// where it sat among the road, tube and power-line builders. None of it names
// a colony: reversing a frame list, a lathe profile, a segment crossing and
// "how high is the swept surface at this point on the ground" are what any
// game that sweeps a route along a height field needs, and the game that
// commissioned each one had already written down the bug that bought it.

/**
 * Frames walked backwards, with distance re-accumulated from the new start.
 *
 * This is how a second strip pulses AGAINST the traffic on the other
 * carriageway without a second shader path: a travelling-pulse mode that reads
 * uv.y in metres has its direction of travel reversed by reversing the sweep.
 *
 * `p` and `up` are SHARED with the input frames and `fwd`/`right` are fresh
 * negated clones. That asymmetry is deliberate and load-bearing: position and
 * up are unchanged by walking the other way, and cloning them would double the
 * allocation for a route that can be several thousand frames long.
 */
export function reverseFrames(frames: Frame[]): Frame[] {
  const out: Frame[] = [];
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]!;
    out.push({
      p: f.p, fwd: f.fwd.clone().negate(), right: f.right.clone().negate(), up: f.up,
      d: frames[frames.length - 1]!.d - f.d,
    });
  }
  return out;
}

/**
 * A closed circular cross-section for `sweepGeo(frames, profile, true)`.
 *
 * IT EMITS `sides` POINTS, NOT `sides + 1`, AND THAT IS THE WHOLE NOTE. The
 * version this came from emitted a final point exactly equal to the first while
 * every call site also passed `closed = true`. `sweepGeo` in closed mode
 * already wraps from the last point back to the first, so the duplicate
 * produced a zero-length profile segment whose 2-D normal is (dr, du) = (0, 0)
 * — a ZERO NORMAL, not merely a wasted triangle — swept the full length of the
 * run. It rendered as a degenerate white quad off each end and an unshaded seam
 * down the whole length. A closed profile must list each point once.
 */
export function circleProfile(r: number, sides: number, offU = 0): number[][] {
  const p: number[][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    p.push([Math.sin(a) * r, Math.cos(a) * r + offU]);
  }
  return p;
}

/**
 * A lathe profile for an OGIVE — a dome whose flank is a power curve rather
 * than a hemisphere, which is what a tall pressure shell or a nose cone is.
 *
 * `rScale` scales the radius without touching the height, so a rib cage and the
 * glazing it holds are the same silhouette at two offsets.
 *
 * The last ring is pulled to a hair rather than to zero: a lathe ring of radius
 * 0 makes a fan of degenerate triangles whose normals are undefined, and
 * `latheGeo`'s own guard only catches EXACTLY coincident points.
 */
export function ogiveProfile(R: number, H: number, steps: number, rScale = 1, exp = 0.62): number[][] {
  const p: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = Math.max(0.06, R * Math.pow(Math.max(0, 1 - t * t), exp)) * rScale;
    p.push([r, t * H]);
  }
  return p;
}

/**
 * Do segments A and B cross in the XZ plane?
 *
 * Returns the parameter along A in 0..1, or -1 when they do not. A route
 * network surveys itself with this before it emits anything, and a run refuses
 * itself when it would pass through one already standing.
 */
export function segCrossXZ(
  ax0: number, az0: number, ax1: number, az1: number,
  bx0: number, bz0: number, bx1: number, bz1: number,
): number {
  const rx = ax1 - ax0, rz = az1 - az0;
  const sx = bx1 - bx0, sz = bz1 - bz0;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return -1;    // parallel or degenerate
  const qpx = bx0 - ax0, qpz = bz0 - az0;
  const t = (qpx * sz - qpz * sx) / den;
  const u = (qpx * rz - qpz * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

export interface SweptIndexOpts {
  /**
   * Half-width of the band where the answer IS the swept surface, metres.
   * Inside it, `yAt` returns the surface; outside `outer` it returns the
   * caller's fallback; between the two it smoothsteps.
   */
  inner: number;
  outer: number;
  /** Vertical offset from the frame's own `p.y` to the surface being queried. */
  lift?: number;
  /** Distance past which a run is not considered at all, metres. */
  search?: number;
}

/**
 * WHERE IS THE SWEPT SURFACE, asked of the frames that were actually swept.
 *
 * THE POINT IS THE "ACTUALLY". Anything that has to sit ON a swept route — a
 * vehicle, a walker, a prop — needs the height of the mesh that got built, and
 * the tempting alternative is to re-grade the source polyline and evaluate
 * that. It does not agree: the game this arrived from found its trucks seated
 * 6-14 cm inside the road, and its movers up to 80 cm, i.e. wheels visibly
 * buried in the slab. A route that was smoothed, resampled or graded on its way
 * to geometry is a DIFFERENT curve from the one it started as, and only one of
 * them is the thing in the picture.
 *
 * So the builder publishes the frames it swept and everything else queries
 * this. Linear search over every run, nearest point on each segment — a route
 * network is hundreds of segments and this is called for a handful of agents
 * per tick, so an acceleration structure would be a cost with no reader.
 */
export class SweptIndex {
  private runs: { x: number; y: number; z: number }[][] = [];
  private o: SweptIndexOpts;

  constructor(o: SweptIndexOpts) { this.o = o; }

  publish(frames: Frame[]): void {
    const run: { x: number; y: number; z: number }[] = new Array(frames.length);
    for (let i = 0; i < frames.length; i++) {
      const p = frames[i]!.p;
      run[i] = { x: p.x, y: p.y, z: p.z };
    }
    this.runs.push(run);
  }

  clear(): void { this.runs.length = 0; }

  get count(): number { return this.runs.length; }

  /** World Y of the swept surface at (x, z), or `fallback` beyond `outer`. */
  yAt(x: number, z: number, fallback: number): number {
    const { inner, outer } = this.o;
    const lift = this.o.lift ?? 0;
    let bestD = this.o.search ?? 40;
    let surf = NaN;
    for (let r = 0; r < this.runs.length; r++) {
      const run = this.runs[r]!;
      for (let i = 0; i < run.length - 1; i++) {
        const a = run[i]!, b = run[i + 1]!;
        const sx = b.x - a.x, sz = b.z - a.z;
        const l2 = sx * sx + sz * sz;
        if (l2 < 1e-6) continue;
        const u = Math.max(0, Math.min(1, ((x - a.x) * sx + (z - a.z) * sz) / l2));
        const px = a.x + sx * u, pz = a.z + sz * u;
        const d = Math.hypot(x - px, z - pz);
        if (d < bestD) {
          bestD = d;
          surf = a.y + (b.y - a.y) * u + lift;
        }
      }
    }
    if (!Number.isFinite(surf)) return fallback;
    if (bestD <= inner) return surf;
    if (bestD >= outer) return fallback;
    const k = (bestD - inner) / (outer - inner);
    return surf + (fallback - surf) * (k * k * (3 - 2 * k));
  }
}
