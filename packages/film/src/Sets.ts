/**
 * ============================================================================
 *  Sets — "inside the dome" as a modelled production fact rather than an
 *  inference from a camera angle.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **A film can be asked whether the cast and the props are where the
 *   screenplay says they are, and get an answer, before anything is rendered.**
 *
 * ## The miss this is built from
 *
 * Found by a viewer of one finished trailer: before the dome breaks, the
 * characters and the garden are staged BESIDE the dome instead of inside it.
 * The retrospective is unusually blunt about why nothing caught it:
 *
 *   *"The project had visual reviewers for story and growth, but no reviewer
 *   or automated rule asking whether actors and props occupied the semantic
 *   set named by the screenplay."*
 *
 * That is a measurement gap. Two visual reviews looked at pixels; pixels are
 * consistent with either staging. The
 * screenplay said `dome.interior` and the world said a world coordinate, and
 * **nothing in the system could compare a sentence to a vector**. This file is
 * the missing type.
 *
 * ## A set is a volume, some marks, and the ways in
 *
 * The volume answers containment. The marks are where a director puts people —
 * named, so blocking is `mark: 'bed-north'` and not three numbers that cannot
 * be wrong out loud. Portals are how a body may legally get from one set to
 * another, which is what turns "the cast is outside" into the sharper question
 * "the cast is outside and there is no door on this side".
 *
 * ## Marks are the reason this is not just a bounding box
 *
 * A bounding box catches "outside the dome". It does not catch "standing
 * exactly where the dome's structural ring is", "facing away from the only
 * entrance", or "two actors on the same mark". Named marks make blocking
 * reviewable in the manifest — a director reads `mina: bed-north, patch:
 * path-east` and knows the shot without opening a renderer.
 *
 * Nothing here imports `three`. Volumes are arithmetic on triples.
 */

import type { Vec3 } from './Timeline.ts';

/* ========================================================================== */
/* Volumes                                                                    */
/* ========================================================================== */

/** An axis-aligned box, by its two corners. */
export interface BoxVolume { readonly kind: 'box'; readonly min: Vec3; readonly max: Vec3 }
/** A vertical cylinder — the honest shape of a dome floor, a silo, a lift. */
export interface CylinderVolume { readonly kind: 'cylinder'; readonly centre: Vec3; readonly radius: number; readonly height: number }
/** A sphere or a dome: `hemisphere` clips everything below the centre's y. */
export interface SphereVolume { readonly kind: 'sphere'; readonly centre: Vec3; readonly radius: number; readonly hemisphere?: boolean }
/** A convex prism: a polygon on the XZ plane, extruded between two heights. */
export interface PrismVolume { readonly kind: 'prism'; readonly footprint: readonly (readonly [number, number])[]; readonly bottom: number; readonly top: number }

export type Volume = BoxVolume | CylinderVolume | SphereVolume | PrismVolume;

/**
 * Is `p` inside `volume`, with an optional tolerance?
 *
 * `slack` is in metres and defaults to zero. A continuity pass uses a small
 * positive slack because a character's ROOT is at its feet and a doorway's
 * volume rarely includes the last centimetre of a boot; a set-dressing pass
 * uses zero. Making it a parameter rather than a constant is the difference
 * between a rule and a number somebody tuned once.
 */
export function inVolume(volume: Volume, p: Vec3, slack = 0): boolean {
  switch (volume.kind) {
    case 'box':
      return p[0] >= volume.min[0] - slack && p[0] <= volume.max[0] + slack
        && p[1] >= volume.min[1] - slack && p[1] <= volume.max[1] + slack
        && p[2] >= volume.min[2] - slack && p[2] <= volume.max[2] + slack;
    case 'cylinder': {
      const dx = p[0] - volume.centre[0];
      const dz = p[2] - volume.centre[2];
      const r = volume.radius + slack;
      if (dx * dx + dz * dz > r * r) return false;
      return p[1] >= volume.centre[1] - slack && p[1] <= volume.centre[1] + volume.height + slack;
    }
    case 'sphere': {
      if (volume.hemisphere && p[1] < volume.centre[1] - slack) return false;
      const dx = p[0] - volume.centre[0];
      const dy = p[1] - volume.centre[1];
      const dz = p[2] - volume.centre[2];
      const r = volume.radius + slack;
      return dx * dx + dy * dy + dz * dz <= r * r;
    }
    case 'prism': {
      if (p[1] < volume.bottom - slack || p[1] > volume.top + slack) return false;
      return inFootprint(volume.footprint, p[0], p[2], slack);
    }
  }
}

/**
 * Point-in-polygon on the XZ plane, with an outward slack.
 *
 * The classic ray-crossing test answers containment exactly and has no notion
 * of "nearly inside", so slack is applied as a separate edge-distance test
 * rather than by inflating the polygon — inflating a concave polygon is a
 * different shape, and quietly getting that wrong is how a tolerance becomes a
 * bug. The polygon is documented convex; the test does not require it.
 */
function inFootprint(poly: readonly (readonly [number, number])[], x: number, z: number, slack: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if ((a[1] > z) !== (b[1] > z)) {
      const t = (z - a[1]) / (b[1] - a[1]);
      if (x < a[0] + t * (b[0] - a[0])) inside = !inside;
    }
  }
  if (inside || slack <= 0) return inside;
  return distanceToEdges(poly, x, z) <= slack;
}

function distanceToEdges(poly: readonly (readonly [number, number])[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const vx = b[0] - a[0];
    const vz = b[1] - a[1];
    const len2 = vx * vx + vz * vz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / len2)) : 0;
    const dx = x - (a[0] + t * vx);
    const dz = z - (a[1] + t * vz);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/* ========================================================================== */
/* The set                                                                    */
/* ========================================================================== */

/** A named place to stand, kneel, sit or put a thing. */
export interface Mark {
  readonly id: string;
  readonly at: Vec3;
  /** Which way a body on this mark faces by default, in degrees, 0 = +Z. */
  readonly facingDeg?: number;
  /** What it is for. Not enforced; it is what a director reads. */
  readonly kind?: 'stand' | 'sit' | 'kneel' | 'prop' | 'camera' | 'entrance';
}

/** A legal way between two sets. */
export interface Portal {
  readonly id: string;
  /** The other set's id. */
  readonly to: string;
  /** Where the opening is. */
  readonly at: Vec3;
  /** Clear width in metres. A body wider than this does not fit and the linter says so. */
  readonly widthM?: number;
  /** Can something pass right now? Doors that are welded shut say false. */
  readonly passable?: boolean;
}

/** An attachment point on an ACTOR or a prop, in that thing's local space. */
export interface Socket {
  readonly id: string;
  readonly at: Vec3;
  readonly kind?: 'hand' | 'tool' | 'seat' | 'control' | 'mount';
}

export interface SetSpec {
  /** Dotted, by convention: `dome`, `dome.interior`, `dome.exterior`. */
  readonly id: string;
  readonly kind: 'interior' | 'exterior';
  readonly volume: Volume;
  readonly marks?: readonly Mark[];
  readonly portals?: readonly Portal[];
  readonly sockets?: readonly Socket[];
  /**
   * A set may sit inside another. `dome.interior` is inside `colony`, and a
   * body inside the first is trivially inside the second — which is what stops
   * a continuity pass reporting "outside colony" for everyone in the dome.
   */
  readonly within?: string;
  /** Metres per world unit. 1 unless somebody built the set at a funny scale. */
  readonly scaleM?: number;
}

export interface SetIndex {
  readonly sets: readonly SetSpec[];
  get(id: string): SetSpec | undefined;
  /** The mark, resolved through the set's own list. Undefined if the set has no such mark. */
  mark(setId: string, markId: string): Mark | undefined;
  /** Is `p` inside this set, or inside a set that this set contains? */
  contains(setId: string, p: Vec3, slack?: number): boolean;
  /** Every set containing `p`, innermost first. Empty means nowhere named. */
  where(p: Vec3, slack?: number): SetSpec[];
  /** The chain of ancestors, innermost first, including the set itself. */
  chain(setId: string): SetSpec[];
  /** A portal from `fromSet` to `toSet`, either way round. */
  portal(fromSet: string, toSet: string): Portal | undefined;
  /** Problems with the set library itself, found without a film. */
  problems(): { readonly code: string; readonly where: string; readonly detail: string }[];
}

export function buildSetIndex(specs: readonly SetSpec[]): SetIndex {
  const byId = new Map<string, SetSpec>();
  for (const s of specs) byId.set(s.id, s);

  const chain = (setId: string): SetSpec[] => {
    const out: SetSpec[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined = setId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const set = byId.get(cursor);
      if (!set) break;
      out.push(set);
      cursor = set.within;
    }
    return out;
  };

  const index: SetIndex = {
    sets: specs,
    get: (id) => byId.get(id),

    mark(setId, markId) {
      // Look up the chain, not just the set. A mark on `dome` — the front
      // door, say — is legitimately usable by a shot playing in
      // `dome.interior`, and forcing a director to duplicate it into both is
      // how two marks with one name end up in different places.
      for (const set of chain(setId)) {
        const found = set.marks?.find((m) => m.id === markId);
        if (found) return found;
      }
      return undefined;
    },

    contains(setId, p, slack = 0) {
      const set = byId.get(setId);
      if (!set) return false;
      if (inVolume(set.volume, p, slack)) return true;
      // A set contains everything its children contain. Walking down is
      // necessary because `colony`'s own volume may be a footprint that does
      // not include the dome's roof.
      for (const other of specs) {
        if (other.within === setId && index.contains(other.id, p, slack)) return true;
      }
      return false;
    },

    where(p, slack = 0) {
      const hits = specs.filter((s) => inVolume(s.volume, p, slack));
      // Innermost first: a set with a parent is deeper than one without, and
      // between two at the same depth the smaller volume is the more specific
      // answer. A caller asking "where is this" wants `dome.interior`, not
      // `colony`.
      return hits.sort((a, b) => chain(b.id).length - chain(a.id).length || volumeSize(a.volume) - volumeSize(b.volume));
    },

    chain,

    portal(fromSet, toSet) {
      const from = byId.get(fromSet);
      const forward = from?.portals?.find((p) => p.to === toSet);
      if (forward) return forward;
      const to = byId.get(toSet);
      return to?.portals?.find((p) => p.to === fromSet);
    },

    problems() {
      const out: { code: string; where: string; detail: string }[] = [];
      const seen = new Set<string>();
      for (const set of specs) {
        if (seen.has(set.id)) out.push({ code: 'duplicate-set', where: set.id, detail: 'two sets share an id' });
        seen.add(set.id);
        if (set.within && !byId.has(set.within)) {
          out.push({ code: 'unknown-parent', where: set.id, detail: `within "${set.within}", which is not a set` });
        }
        if (set.within && chain(set.id).length > 1 && chain(set.id).some((s, i) => i > 0 && s.id === set.id)) {
          out.push({ code: 'set-cycle', where: set.id, detail: 'the containment chain loops' });
        }
        const markIds = new Set<string>();
        for (const mark of set.marks ?? []) {
          if (markIds.has(mark.id)) out.push({ code: 'duplicate-mark', where: `${set.id}:${mark.id}`, detail: 'two marks share an id in one set' });
          markIds.add(mark.id);
          // A mark outside its own set is the set-dressing form of the exact
          // bug this file exists for, and it is worth catching one layer
          // earlier than the film: every shot that uses the mark inherits it.
          if (!inVolume(set.volume, mark.at, 0.25)) {
            out.push({ code: 'mark-outside-set', where: `${set.id}:${mark.id}`, detail: `mark "${mark.id}" is not inside the set that declares it` });
          }
        }
        for (const portal of set.portals ?? []) {
          if (!byId.has(portal.to)) out.push({ code: 'portal-nowhere', where: `${set.id}:${portal.id}`, detail: `leads to "${portal.to}", which is not a set` });
        }
      }
      return out;
    },
  };

  return index;
}

/** A rough volume, for ordering "which set is more specific". */
function volumeSize(v: Volume): number {
  switch (v.kind) {
    case 'box': return Math.abs((v.max[0] - v.min[0]) * (v.max[1] - v.min[1]) * (v.max[2] - v.min[2]));
    case 'cylinder': return Math.PI * v.radius * v.radius * v.height;
    case 'sphere': return (v.hemisphere ? 2 : 4) / 3 * Math.PI * v.radius ** 3;
    case 'prism': {
      let area = 0;
      for (let i = 0, j = v.footprint.length - 1; i < v.footprint.length; j = i++) {
        const a = v.footprint[i]!;
        const b = v.footprint[j]!;
        area += (b[0] + a[0]) * (b[1] - a[1]);
      }
      return Math.abs(area / 2) * Math.abs(v.top - v.bottom);
    }
  }
}

/** Where a body on this mark actually stands, as a plain triple. */
export function markPoint(mark: Mark): Vec3 { return mark.at; }

/** The facing of a mark as a unit XZ direction. 0° is +Z, which is three.js's forward. */
export function markFacing(mark: Mark): Vec3 {
  const rad = ((mark.facingDeg ?? 0) * Math.PI) / 180;
  return [Math.sin(rad), 0, Math.cos(rad)];
}
