/**
 * ============================================================================
 *  rigaudit — A FULLY BUILT SHADOW RIG THAT CASTS NOTHING, NAMED ON FRAME 1.
 * ============================================================================
 *
 *  A cascade rig that is constructed, texel-snapped and driven every frame, and
 *  which produces no shadow at all, looks EXACTLY like a rig that is working
 *  and a scene that has no casters in it. A sibling game spent four review
 *  cycles guessing at three different causes for that one symptom. This prints
 *  the facts instead: is the shadow map even on, is the filter the one the
 *  shaders were written against, did somebody take a directional slot, and does
 *  anything in the scene actually cast.
 *
 *  ── WHY THIS IS PLATFORM ───────────────────────────────────────────────────
 *
 *  The engine plan had listed `auditRig` under its lighting row since it was
 *  written and no engine package had ever contained a line of it: PLANNED,
 *  NEVER LANDED, live inside one game — one of eight — for the whole of that
 *  time. A later review sized it at 86 substantive lines in a base-building
 *  game's `Lighting.ts` and called it
 *  *"the same shape as `matAudit`"*, which is right, and `matpick.ts` in this
 *  same package is the worked precedent this file follows deliberately.
 *
 *  Read the code below: it names no colony, no crater, no spacecraft, no lunar
 *  anything. It knows a `WebGLRenderer`, a `Scene`, a `DirectionalLight`, an
 *  `InstancedMesh` and a bounding box, which is exactly the vocabulary this
 *  package is allowed. Every one of the eight games here that casts a shadow
 *  can be silently not casting one, and seven of them currently have no way to
 *  find out.
 *
 *  ── WHY @homie-rocks/render AND NOT A NEW LIGHTING PACKAGE
 *  ───────────────────
 *
 *  The plan files this under a lighting package that does not exist. The landed
 *  shape of that row is HERE: `cascade.ts`, `cascadederiv.ts`,
 *  `shadowsplit.ts`, `lightpool.ts`, `lightbudget.ts`, `lightsloop.ts`,
 *  `keyrim.ts` and `umbra.ts` are all in `@homie-rocks/render` already. An
 *  audit of the rig those files build belongs beside them; standing up a ninth
 *  package to hold one function would put a package edge between a fitter and
 *  the check on the fitter, and the plan row's NAME has never been the thing
 *  that mattered — the same call was made for the whole planned ribbon package,
 *  which landed in `@homie-rocks/geom`.
 *
 *  ── WHAT WAS HARD-CODED AND IS NOW A PARAMETER ─────────────────────────────
 *
 *  Three things, and every one of them was a fact about ONE game stated as a
 *  universal:
 *
 *  1. THE FILTER. `THREE.PCFShadowMap` was a literal, with a message naming
 *     one game's shader and one game's renderer file. It is now
 *     `shadowMapType`,
 *     REQUIRED, with the caller's own shader name — because a caller who does
 *     not state which filter its shaders were written against has no check to
 *     run, and a check with nothing to compare against is a green that means
 *     nothing. Same rule `matpick.ts`'s `ART_THRESHOLDS` note states: a check
 *     that passes when it is not configured is a failure that keeps
 *     recurring.
 *  2. THE ORDER, AND THE PINS. One game asserted "cascades first, then
 *  EarthFill
 *     at index `earthShadow.index`". Both are the same shape — *this light must
 *     be at this directional slot, and here is the compiled-in constant that
 *     breaks if it moves* — so `order` and `pinned` cover both, and the caller
 *     supplies the `why`. The reasons are kept VERBATIM at that game's call
 *     site: a caller that does not know the reason will not pass it, and the
 *     reason is the whole value of the warning.
 *  3. THE SHADOW-LENGTH ARITHMETIC. `SILENT_TALL_M * 4.2` is cot(13.4°), the
 *     sun angle of one scenario in one game. It is `shadowPerMetre` now, and
 *     the default is 1 — a 45-degree key — which is honest rather than
 *     flattering: a wrong number here overstates a finding, so the default
 *     understates it.
 *
 *  ── WHY IT RETURNS FINDINGS RATHER THAN PRINTING ───────────────────────────
 *
 *  A package that calls `console.warn` cannot be tested without capturing a
 *  global, and a probe that has to monkey-patch `console` to read a result is a
 *  probe measuring its own patch. `auditShadowRig` computes; `printRigAudit`
 *  prints, in one place, and a caller that wants the rows in a test takes
 *  the rows. That split is also what lets that game keep publishing its full
 *  lists on `window.__lighting` — the arrays are on the return value.
 *
 *  ── THE ONE THING THIS DELIBERATELY DOES NOT DO ────────────────────────────
 *
 *  It never SETS `castShadow` on anybody's mesh. Half the silent casters in a
 *  real scene are correct on purpose — a game clears the flag on `:glass` and
 *  `:glow` submeshes because a strip's own shadow is a black line through the
 *  light it is meant to be casting, and a far scatter tier that no cascade
 *  reaches costs the near cascades their culling for nothing. So the silent
 *  lists are INFO, not WARN, and they name the offenders for the game's
 *  maintainer to judge. An auditor that starts writing becomes a second
 *  maintainer of every mesh in the scene and the first thing it will do is undo
 *  a deliberate decision.
 */
import * as THREE from 'three';

/** One thing the audit found. `level` is the caller's print severity. */
export interface RigFinding {
  /** Stable machine name — a test anchors on this, never on the prose. */
  code:
  | 'shadowmap-off'
  | 'shadowmap-type'
  | 'directional-order'
  | 'directional-pin'
  | 'not-casting'
  | 'no-casters'
  | 'silent-instanced'
  | 'silent-tall';
  /**
   * `warn` is "this is broken". `info` is "here is an inventory, some of which
   * is correct on purpose" — see the note above on why the silent lists are
   * never warnings.
   */
  level: 'warn' | 'info';
  message: string;
}

/** A light that must occupy one specific directional slot, and why. */
export interface RigPin {
  /** Index into the scene's shadow-casting DirectionalLight order. */
  index: number;
  light: THREE.DirectionalLight;
  /**
   * What breaks when it moves, in the caller's own words. Printed verbatim.
   * There is no default: a pin with no stated consequence produces a warning
   * nobody can act on, which is the same as no warning at all.
   */
  why: string;
}

/** A light whose `castShadow` must be true, and what goes dark when it is not. */
export interface RigMustCast {
  light: THREE.DirectionalLight;
  /** Name used in the message when `light.name` is empty. */
  label?: string;
  why: string;
}

export interface RigAuditSpec {
  scene: THREE.Scene;
  renderer?: THREE.WebGLRenderer | null;
  /**
   * The shadow-map filter this game's shaders were written against. REQUIRED —
   * see the header. Pass the same constant the renderer is configured with.
   */
  shadowMapType: THREE.ShadowMapType;
  /** Name of the shader that breaks when the filter is wrong, for the message. */
  shaderName?: string;
  /** Where the renderer's shadow-map type is set, for the message. */
  rendererFile?: string;
  /**
   * Lights that must occupy directional slots 0..n-1, in this order. three
   * fills `directionalShadowMap[i]` in scene-traversal order with shadow
   * casters first, so a shader reading slot `i` as cascade `i` breaks the
   * moment another subsystem adds a shadow-casting directional light earlier.
   */
  order?: readonly THREE.DirectionalLight[];
  /** Lights pinned to one specific slot each, with the caller's reason. */
  pinned?: readonly RigPin[];
  /** Lights that must be casting at all, with the caller's reason. */
  mustCast?: readonly RigMustCast[];
  /** Where the caller republishes the full silent lists, named in the message. */
  publishedAt?: string;
}

/**
 * The three numbers the silent-caster inventory is stated in. Exported so a
 * caller can read the defaults it is accepting rather than inherit them
 * silently — `matpick.ts`'s `ART_THRESHOLDS` states the reasoning in full.
 *
 * Unlike a threshold in an art check, none of these can make the audit pass
 * when it should fail: they only decide how long the inventory is. A caller
 * that passes nothing still gets a list.
 */
export const RIG_THRESHOLDS = {
  /** An InstancedMesh with at least this many members and no `castShadow` is
   *  listed. Below it a set is small enough that its absence is not visible. */
  instanceFloor: 24,
  /** A single visible mesh at least this tall (metres, world scale) with no
   *  `castShadow` is listed. Tall is where the flag matters, for a reason that
   *  is trigonometry and not taste — see `shadowPerMetre`. */
  tallM: 12,
  /**
   * Metres of shadow one metre of height lays down at the game's lowest key
   * angle, i.e. cot(elevation). Only used to make the message concrete.
   *
   * The default is 1 — a 45-degree sun — because a wrong number here inflates
   * a finding, and a default should err toward understating one. The
   * base-building game's mature scenario is 13.4 degrees, so it passes 4.2.
   */
  shadowPerMetre: 1,
} as const;

export type RigThresholds = { -readonly [K in keyof typeof RIG_THRESHOLDS]: number };

export interface RigAudit {
  findings: RigFinding[];
  /** Every DirectionalLight in the scene, in traversal order. */
  directionals: THREE.DirectionalLight[];
  /** Visible meshes with `castShadow` set. */
  casters: number;
  /** How many of those are instanced sets. */
  instancedCasters: number;
  /** `name xN` for every silent instanced set over `instanceFloor`. */
  silentInstancedCasters: string[];
  /** `name Nm` for every silent single mesh over `tallM`. */
  silentTallCasters: string[];
}

const _scale = new THREE.Vector3();

const nameOf = (o: { name?: string }): string => o.name || '(unnamed)';

/**
 * Run the audit. Cheap enough for frame 1 and far too expensive for every
 * frame: it walks the whole scene graph twice and may compute bounding boxes.
 *
 * Call it AFTER every subsystem has finished building. On frame 0 the world
 * does not exist yet, and a warning that fires before the thing it is about is
 * a warning nobody reads twice.
 */
export function auditShadowRig(
  spec: RigAuditSpec,
  thresholds: Partial<RigThresholds> = {},
): RigAudit {
  const T: RigThresholds = { ...RIG_THRESHOLDS, ...thresholds };
  const findings: RigFinding[] = [];
  const r = spec.renderer;
  const shader = spec.shaderName || 'the cascade shader';

  if (r && !r.shadowMap.enabled) {
    findings.push({
      code: 'shadowmap-off', level: 'warn',
      message: 'renderer.shadowMap.enabled is false. The cascades are built, texel-snapped '
        + 'and driven every frame, and NOTHING casts a shadow.',
    });
  }
  if (r && r.shadowMap.type !== spec.shadowMapType) {
    findings.push({
      code: 'shadowmap-type', level: 'warn',
      message: 'renderer.shadowMap.type is ' + r.shadowMap.type + ', not the ' + spec.shadowMapType
        + ' ' + shader + ' was written against, so its filter define is undefined and it has '
        + 'fallen back to whatever the unconfigured branch does. The derived filter is not '
        + 'running. Set it in ' + (spec.rendererFile || 'the renderer') + '.',
    });
  }

  // ── WHO IS IN WHICH DIRECTIONAL SLOT ─────────────────────────────────────
  // traverse(), not traverseVisible(): three fills directionalShadowMap from
  // the lights it finds, and a light with `visible = false` still occupies its
  // place in that ordering for as long as it is in the graph. Auditing only the
  // visible ones would report a correct order for a scene that renders a wrong
  // one, which is the exact failure mode this whole file exists to catch.
  const directionals: THREE.DirectionalLight[] = [];
  spec.scene.traverse((o) => {
    const l = o as THREE.DirectionalLight;
    if (l.isDirectionalLight) directionals.push(l);
  });

  const order = spec.order;
  if (order && order.length > 0) {
    let ok = directionals.length >= order.length;
    for (let i = 0; ok && i < order.length; i++) {
      if (directionals[i] !== order[i]) ok = false;
    }
    if (!ok) {
      findings.push({
        code: 'directional-order', level: 'warn',
        message: 'the DirectionalLight order changed. ' + shader + ' reads '
          + 'directionalShadowMap[i] as slot i, and three fills that array in scene-traversal '
          + 'order with shadow casters first. Some other subsystem has added a shadow-casting '
          + 'directional light; shadows will be wrong until it is added after the '
          + order.length + ' this rig owns.',
      });
    }
  }

  for (const p of spec.pinned || []) {
    if (directionals[p.index] === p.light) continue;
    findings.push({
      code: 'directional-pin', level: 'warn',
      message: nameOf(p.light) + ' is not at directional index ' + p.index + ' (found '
        + (directionals[p.index] ? nameOf(directionals[p.index]!) : 'nothing') + '). ' + p.why,
    });
  }

  for (const m of spec.mustCast || []) {
    if (m.light.castShadow) continue;
    findings.push({
      code: 'not-casting', level: 'warn',
      message: (m.label || nameOf(m.light)) + '.castShadow is false. ' + m.why,
    });
  }

  // ── AND THE MESHES THAT SHOULD BE CASTING AND ARE NOT ────────────────────
  //
  // Two inventories, because the two failures do not look alike and one cannot
  // find the other:
  //
  //  · an INSTANCED SET that silently dropped out. "Four thousand boulders cast
  //    essentially nothing under a low sun" is the highest-value shadow bug
  //    available in an outdoor scene, and it is invisible from inside the file
  //    that has it, because that file is looking at one rock.
  //  · a TALL SINGLE MESH. The instanced check cannot see "the 50 m tower and
  //    the 35 m dome cast NO SHADOW AT ALL", because those are one mesh each.
  //    Height is the axis that matters and the reason is trigonometry: a caster
  //    lays `height * cot(elevation)` metres of shadow, so at a 13-degree key a
  //    silent 35 m dome removes 147 m of shadow from the frame and a silent 2 m
  //    mast removes 8.
  let casters = 0;
  let instancedCasters = 0;
  const silentInstancedCasters: string[] = [];
  const silentTallCasters: string[] = [];
  spec.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.castShadow) {
      casters++;
      if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) instancedCasters++;
      return;
    }
    const inst = m as unknown as THREE.InstancedMesh;
    if (inst.isInstancedMesh && inst.count >= T.instanceFloor && m.visible) {
      silentInstancedCasters.push(nameOf(m) + ' x' + inst.count);
      return;
    }
    if (m.visible && !inst.isInstancedMesh && m.geometry) {
      const g = m.geometry;
      if (g.boundingBox === null) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (bb !== null) {
        _scale.setFromMatrixScale(m.matrixWorld);
        const h = (bb.max.y - bb.min.y) * Math.max(_scale.x, _scale.y, _scale.z);
        if (h >= T.tallM) silentTallCasters.push(nameOf(m) + ' ' + h.toFixed(0) + ' m');
      }
    }
  });

  const full = spec.publishedAt ? ' Full list on ' + spec.publishedAt + '.' : '';
  if (casters === 0) {
    findings.push({
      code: 'no-casters', level: 'warn',
      message: 'the cascades are built and NOTHING in the scene has castShadow set. '
        + 'An InstancedMesh in particular drops out of the shadow pass silently.',
    });
  }
  if (silentInstancedCasters.length > 0) {
    findings.push({
      code: 'silent-instanced', level: 'info',
      message: 'instanced meshes with ' + T.instanceFloor + '+ members and castShadow === false '
        + '(expected: any scatter tier further out than the last cascade reaches, which is '
        + 'deliberate — rasterising it into a map that cannot contain it costs the near '
        + 'cascades their culling and draws nothing): '
        + silentInstancedCasters.slice(0, 10).join(', ')
        + (silentInstancedCasters.length > 10 ? ', ...' : '') + '.' + full,
    });
  }
  if (silentTallCasters.length > 0) {
    findings.push({
      code: 'silent-tall', level: 'info',
      message: 'meshes taller than ' + T.tallM + ' m with castShadow === false, i.e. objects '
        + 'whose absence from the shadow pass removes '
        + (T.tallM * T.shadowPerMetre).toFixed(0) + '+ m of shadow each at the lowest key angle '
        + '(expected: glass and glow submeshes, which are cleared on purpose because a strip\'s '
        + 'own shadow is a black line through the light it is meant to be casting): '
        + silentTallCasters.slice(0, 12).join(', ')
        + (silentTallCasters.length > 12 ? ', ...' : '') + '.' + full,
    });
  }

  return {
    findings, directionals, casters, instancedCasters,
    silentInstancedCasters, silentTallCasters,
  };
}

/**
 * Print an audit, one line per finding, `warn` and `info` kept apart.
 *
 * The distinction is the point and it is not cosmetic: everything at `info` is
 * an inventory a human has to judge, and printing it as a warning trains the
 * reader to ignore the channel that carries the two real failures.
 */
export function printRigAudit(audit: RigAudit, tag = '[lighting]'): void {
  for (const f of audit.findings) {
    if (f.level === 'warn') console.warn(tag + ' ' + f.message);
    else console.info(tag + ' ' + f.message);
  }
}
