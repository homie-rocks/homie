/**
 * ============================================================================
 *  liveryroles — a role ordinal becomes a colour, and a machine becomes eight.
 * ============================================================================
 *
 *  `MesherBase` writes one ROLE ordinal per vertex into a `Uint8Array` while a
 *  machine is being built. Nothing in that pass knows what colour anything is:
 *  the geometry is authored once, and then one small colour attribute per racer
 *  is scattered over it, so eight machines cost one vertex buffer plus eight
 *  colour buffers rather than eight of everything.
 *
 *  This file is the second half of that: the ordinal -> colour table, and the
 *  scatter. Both halves stood in the livery modules of a kart racer and of a
 *  space racer; `liveryGeometry` was BYTE-IDENTICAL in the two games, comment
 *  for comment, and `resolveRole` was a fourteen-case switch that differed only
 *  in WHICH colour each case named.
 *
 * ----------------------------------------------------------------------------
 *  THE DIVERGENCE IS A TABLE, AND THE PROOF IS THE ORDINALS
 * ----------------------------------------------------------------------------
 *  Both games declare `const enum Role` with fourteen members numbered 0..13,
 *  and both say in their own words that the numbers are baked into a
 *  `Uint8Array` and may never be renumbered. Laid out ordinal against ordinal
 *  the two enums are the same list wearing two vocabularies:
 *
 *      #   kart racer         space racer        what the case did
 *      0   Base               Base               livery.base,     else a const
 *      1   Trim               Trim               livery.trim,     else a const
 *      2   Accent             Accent             livery.accent,   else a const
 *      3   Cream              Bone               a constant
 *      4   Plastic            Composite          a constant
 *      5   Steel              Steel              a constant
 *      6   Rubber             Seal               a constant
 *      7   Skin               Skin               livery.skin,     else a const
 *      8   Suit               Suit               livery.suit,     else a const
 *      9   Glove              Glove              a constant
 *     10   Hub                Emitter            a constant
 *     11   Disc               Radiator           a constant
 *     12   Shadowed           Shadowed           livery.shadowed, else a const
 *     13   Rim                Anodised           livery.<that>,   else a const
 *
 *  Row 4 is the case worth stating out loud: `Role.Plastic` and
 *  `Role.Composite` are the same ordinal wearing two names — a RENAME, not a
 *  divergence. So is row 3, row 6, row 10, row 11 and row 13. Every case in
 *  either switch is one of exactly two shapes, and neither shape is code:
 *
 *      · a constant colour, or
 *      · a colour off the racer's own livery, with a constant to fall back to
 *        when there is no livery (the shelf, the roster preview, the editor).
 *
 *  A `RoleSlot` is those two shapes and nothing else, and each game's table is
 *  fourteen lines of its own art direction. **No colour moved.** The constants
 *  stay in the games — `#f2ece0` cream and `#d8d2c6` bone are art, and a
 *  measured constant must not quietly become everybody's default.
 *
 * ----------------------------------------------------------------------------
 *  WHY THE TABLE IS DATA AND NOT FOURTEEN CALLBACKS
 * ----------------------------------------------------------------------------
 *  A slot could have been `(l, out) => …` for every row, which would be
 *  perfectly general and exactly as long as the switch it replaced — i.e. it
 *  would move lines without removing any — the worked example of a DSL that is
 *  either as long as the code or is a different lawn. Ten of the fourteen rows
 *  in each game are a bare constant, so a bare `THREE.Color` IS the slot for
 *  those, and the four that read the racer carry a one-expression picker beside
 *  their fallback.
 *
 * ----------------------------------------------------------------------------
 *  `L` IS STRUCTURAL, AND NEITHER GAME'S `Livery` CROSSES THE SEAM
 * ----------------------------------------------------------------------------
 *  The two `Livery` interfaces share six colour fields and disagree about the
 *  seventh (`rim` vs `anodised`), about the texture they carry (a decal atlas
 *  vs a whole per-ship hull map) and about the roster metadata around it. None
 *  of that is this file's business: the picker functions are the only thing
 *  that ever touches `L`, they are written in the game beside the interface
 *  they read, and `L` is inferred from the table. A package that imported a
 *  game's `Livery` would be the wrong direction of dependency; a package that
 *  is generic over one is just a scatter.
 *
 * ----------------------------------------------------------------------------
 *  WHAT DID NOT COME
 * ----------------------------------------------------------------------------
 *  `Role` itself, both palettes, both `Livery` interfaces, `getLivery`, every
 *  material in either game, `addSunRim`/`addStarRim` (genuinely different GLSL
 *  — the space racer's reads `nonPerturbedNormal` and its own comment records
 *  the review finding that forced it, and giving the kart racer that would be
 *  an upgrade rather than a parity move) and both contact shadows.
 * ============================================================================
 */

import * as THREE from 'three';
import { smoothstep } from '@homie-rocks/noise/Noise.js';

/**
 * One row of a game's role table.
 *
 * Either a constant colour, or `[pick, fallback]` — the colour off this racer's
 * livery, and the colour to use when there is no racer.
 */
export type RoleSlot<L> =
  | THREE.Color
  | readonly [pick: (l: L) => THREE.Color, fallback: THREE.Color];

/**
 * What `liveryGeometry` needs off a built machine.
 *
 * Structurally `@homie-rocks/geom`'s `Built` minus `triangles`, restated rather than
 * imported: `@homie-rocks/render` does not depend on `@homie-rocks/geom`, and this is two
 * fields. Anything with a geometry and a per-vertex role array satisfies it.
 */
export interface RoledGeometry {
  geo: THREE.BufferGeometry;
  /** per-vertex colour role, resolved to RGB per livery */
  roles: ArrayLike<number>;
}

const _tmpColor = new THREE.Color();

/**
 * Resolve one role ordinal against a table and a racer.
 *
 * Out of range, or a hole in the table, is white — which is what both games'
 * `default:` arm did, and it is deliberately LOUD: a role nobody gave a colour
 * to should be visible on the machine, not silently the base coat.
 */
export function resolveRole<L>(
  slots: readonly RoleSlot<L>[],
  role: number,
  l: L | null,
  out: THREE.Color,
): THREE.Color {
  const slot = slots[role];
  if (slot === undefined) return out.setRGB(1, 1, 1);
  if (Array.isArray(slot)) {
    const [pick, fallback] = slot as readonly [(l: L) => THREE.Color, THREE.Color];
    return out.copy(l ? pick(l) : fallback);
  }
  return out.copy(slot as THREE.Color);
}

/**
 * A geometry for one livery that re-uses the source position/uv/index buffers
 * verbatim and only owns a fresh colour attribute. Eight karts therefore cost
 * one vertex buffer plus eight small colour buffers.
 */
export function liveryGeometry<L>(
  slots: readonly RoleSlot<L>[],
  built: RoledGeometry,
  l: L | null,
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', built.geo.getAttribute('position'));
  g.setAttribute('normal', built.geo.getAttribute('normal'));
  g.setAttribute('uv', built.geo.getAttribute('uv'));
  g.setIndex(built.geo.getIndex());
  const n = built.roles.length;
  const col = new Float32Array(n * 3);
  // resolve once per role, then scatter — 13 colour conversions, not 20 000
  const lut = new Float32Array(slots.length * 3);
  for (let r = 0; r < slots.length; r++) {
    // THREE.Color already holds linear working-space values (ColorManagement
    // converts on assignment) and vertex colours are consumed as-is, so a
    // second sRGB->linear pass here would darken every painted panel.
    resolveRole(slots, r, l, _tmpColor);
    lut[r * 3] = _tmpColor.r;
    lut[r * 3 + 1] = _tmpColor.g;
    lut[r * 3 + 2] = _tmpColor.b;
  }
  // The `!`s are `noUncheckedIndexedAccess`, which the games do not run and this
  // package does. Both arrays are dense by construction — `roles` came out of a
  // mesher that appended one entry per vertex, `lut` was just filled to length —
  // and a `?? 0` here would be a plausible default painting a machine black.
  for (let i = 0; i < n; i++) {
    const r = built.roles[i]! * 3;
    col[i * 3] = lut[r]!;
    col[i * 3 + 1] = lut[r + 1]!;
    col[i * 3 + 2] = lut[r + 2]!;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.boundingSphere = built.geo.boundingSphere;
  return g;
}

/**
 * Bind a game's role table once and hand back the call the game already makes.
 *
 * Both games' `KartModel` and `Driver` call `liveryGeometry(built, l)` — a
 * dozen call sites between them, none of which has any business knowing there
 * is a table. Binding here means the seam moved and not one call site did.
 */
export function liveryRoles<L>(slots: readonly RoleSlot<L>[]) {
  return {
    /** The role count, for anything that wants to size a buffer by it. */
    count: slots.length,
    liveryGeometry: (built: RoledGeometry, l: L | null) => liveryGeometry(slots, built, l),
    resolveRole: (role: number, l: L | null, out: THREE.Color) => resolveRole(slots, role, l, out),
  };
}

// ---------------------------------------------------------------------------
// The two materials at the far end of the LOD ramp
// ---------------------------------------------------------------------------
//
// Both games cache one of each, module-wide, and both call them from
// `KartModel` at exactly two places. The bodies stood in both files: the
// impostor's differed in three NUMBERS (a roughness, a metalness and which
// env-response curve to inject) and the shadow-only material's did not differ
// at all.

let _impostor: THREE.MeshStandardMaterial | null = null;
let _shadowOnly: THREE.MeshBasicMaterial | null = null;

/** The three values the two games' impostor materials disagreed about. */
export interface ImpostorLook {
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  /** the game's own chroma-limiting env response, applied by the caller's injector */
  inject: (m: THREE.MeshStandardMaterial) => void;
}

/**
 * The distant machine's single surface.
 *
 * A kart is fifteen meshes because it is six materials plus four wheels plus a
 * driver who moves independently of all of them, and every one of those is a
 * draw call in the colour pass and another one-and-a-third in the cascades.
 * Eight of them is 220 draw calls against a 250 budget for the entire frame,
 * which is the whole reason this file gained a second material.
 *
 * Past ~26 m a kart is under a hundred pixels tall and the thing that reads is
 * its silhouette and its livery, not the disagreement between a lacquer's two
 * specular lobes. So the far LOD is the same geometry, merged, wearing one
 * vertex-coloured surface: the livery survives verbatim (it lives in the colour
 * attribute), the shape survives verbatim, and what is lost is the clearcoat,
 * the chrome's mirror and the visor's Fresnel — none of which resolve at that
 * size. No maps at all: a 167 mm orange-peel tile at 26 m is sub-texel noise,
 * and sampling it is how a distant kart starts to sparkle.
 *
 * `inject` is the game's own env response and it is not optional in practice:
 * without it the LOD swap is a visible hue pop, because the near machine would
 * be answering the sky in its roster colour and the far one in the sky's.
 */
export function impostorMaterial(look: ImpostorLook): THREE.MeshStandardMaterial {
  if (_impostor) return _impostor;
  _impostor = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: look.roughness,
    metalness: look.metalness,
    envMapIntensity: look.envMapIntensity,
  });
  look.inject(_impostor);
  return _impostor;
}

/** The cached impostor, or null if nothing has asked for one yet. */
export function impostorMaterialIfBuilt(): THREE.MeshStandardMaterial | null {
  return _impostor;
}

/**
 * The same merged mesh, wearing nothing.
 *
 * three decides what goes in a shadow map from `castShadow` on the object and
 * `visible` on the object and its material — there is no "cast but do not
 * draw" flag, and both the colour pass and the shadow pass read the same two
 * booleans. So a near machine, which must keep all its detail meshes in the
 * colour pass, gets its shadow from this: the merged mesh stays in the scene
 * with `castShadow` on and a material that writes no colour and no depth. It
 * costs one rasterised-but-discarded draw and saves nineteen shadow draws.
 *
 * The kart racer adds that `renderOrder` puts it after the opaque queue so the
 * depth buffer it is tested against is already full and almost every fragment
 * dies at early-Z; the space racer adds that its near cascade is 2048² of an
 * 18 m box, so a ship's own shadow is the sharpest thing in it and this is what
 * feeds the first grounding cue. Both are true of the same two lines.
 */
export function shadowOnlyMaterial(): THREE.MeshBasicMaterial {
  if (_shadowOnly) return _shadowOnly;
  _shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  return _shadowOnly;
}

/**
 * A CHANNEL rather than a paint: the same shared-buffer trick as
 * `liveryGeometry`, with the colour ramped along the machine's own Z instead of
 * looked up per role.
 *
 * Some parts carry a value in their vertex colour that a shader reads as a
 * MEANING — which end of a heat pipe this vertex is, which side of a flow a
 * panel is on — rather than as a colour a livery table picks. Those parts must
 * NOT go through `liveryGeometry`: a role LUT would put the team's paint on
 * them and the shader would read a team colour as a temperature.
 *
 * BLENDED, NOT SWITCHED PER PART. A ramp along the station reads as a direction
 * of flow; two hard-edged parts read as two decals. The window is the caller's
 * and it is measured from the BACK of the mesh's own extent, so a long body and
 * a short one put the split in the same place proportionally.
 *
 * `hotRole` is the authored override: one role ordinal that means "this vertex
 * is at the hot end wherever it happens to sit". A ramp is the right default
 * for a pipe with a direction and the wrong answer for a panel that is at one
 * temperature all over, and a part like that straddling the mid-station would
 * otherwise come out cold at one end and hot at the other. Pass -1 for none.
 */
export interface StationRamp {
  cold: THREE.Color;
  hot: THREE.Color;
  /** smoothstep window over the mesh's own Z extent, 0 at the back */
  from: number;
  to: number;
  /** the role ordinal that is hot everywhere, or -1 */
  hotRole: number;
}

export function stationRampGeometry(built: RoledGeometry, s: StationRamp): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = built.geo.getAttribute('position');
  g.setAttribute('position', pos);
  g.setAttribute('normal', built.geo.getAttribute('normal'));
  g.setAttribute('uv', built.geo.getAttribute('uv'));
  g.setIndex(built.geo.getIndex());
  const n = built.roles.length;
  const col = new Float32Array(n * 3);
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const z = pos.getZ(i);
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  // The floor is not tidiness: a flat part — one plate, every vertex at one z —
  // is a legitimate thing to hand this, and a zero span would make every t a
  // NaN and every vertex colour NaN, which renders as black with no error.
  const span = Math.max(1e-3, zMax - zMin);
  for (let i = 0; i < n; i++) {
    const t = (pos.getZ(i) - zMin) / span;
    const hot = built.roles[i] === s.hotRole ? 1 : 1 - smoothstep(s.from, s.to, t);
    col[i * 3] = s.cold.r + (s.hot.r - s.cold.r) * hot;
    col[i * 3 + 1] = s.cold.g + (s.hot.g - s.cold.g) * hot;
    col[i * 3 + 2] = s.cold.b + (s.hot.b - s.cold.b) * hot;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.boundingSphere = built.geo.boundingSphere;
  return g;
}
