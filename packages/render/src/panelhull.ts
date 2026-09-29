/**
 * ============================================================================
 *  panelhull.ts — a plated surface, baked once, as fields and then as maps.
 * ============================================================================
 *
 * Anything welded out of stamped plate — a hull, a fuselage, a tank, a hangar
 * door, a container — has the same four-layer surface history, and this file
 * bakes it:
 *
 *   1. a two-scale BSP PANEL FIELD, so no two plates are the same size and the
 *      layout has no dominant frequency for the eye to catch;
 *   2. a FASTENER grid that runs around each sub-panel's own perimeter rather
 *      than across the whole surface, because a fastener grid that ignores the
 *      panels under it is the clearest possible sign that two layers were
 *      generated independently;
 *   3. OIL-CANNING — a stamped panel is not flat between its fixings, and the
 *      direction of the dish is a property of the PANEL rather than of a noise
 *      field, which is also what gives the cavity solve something to find in
 *      the middle of a large plate;
 *   4. the three derived fields every wear pass reads: cavity (where deposits
 *      sit), curvature (where paint is knocked off) and exposure (which faces
 *      the light has reached).
 *
 * ...and then packs them into the two maps a physical material wants: a Sobel
 * normal and an ORM whose **B and A carry the two WEAR FIELDS, not a metalness
 * value**. That last decision is the whole reason this file is worth having and
 * it is explained at `packHullMaps`.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS PLATFORM HERE AND WHAT IS NOT
 * ---------------------------------------------------------------------------
 * The layering, the order, the fastener-follows-panel rule and the ORM channel
 * assignment are platform: they are what a plated surface IS, in any game.
 *
 * EVERY NUMBER IS THE GAME'S, and there is not one default in this file. A
 * plate scale is a statement about how big the plates are on THIS machine; a
 * cavity reach is a statement about how deep its recesses are; an exposure
 * direction is a statement about where that world's light comes from. Ship a
 * default for any of them and the next game inherits this one's surface while
 * every check stays green — which is the failure mode these packages exist to
 * stop, and it has already happened twice.
 *
 * ---------------------------------------------------------------------------
 * TWO TRAPS THE CALLER HAS TO KNOW ABOUT
 * ---------------------------------------------------------------------------
 * · `bspPanelField` CLAMPS THE JOINT WIDTH UP to 2.2 / res in tile units, so a
 *   field built at a lower resolution than the atlas cannot have a joint
 *   narrower than that however narrow you ask for — and it is then bilinearly
 *   magnified on the way up. A 0.006 joint requested at res 128 and magnified
 *   to 512 comes out as a nine-texel soft ramp where a plate joint should be:
 *   present in the field, invisible on the model, and the single biggest reason
 *   a hull reads as having no panel lines at all. Build each scale at the
 *   ATLAS's own resolution unless you have measured that you can afford not to.
 * · THE ATLAS IS A UNIT SQUARE, not a tiling repeat. That is what lets a serial,
 *   a hazard stencil and a mismatched panel be PLACED rather than scattered.
 *   `wrap` is therefore clamp, and it is not an option.
 */
import * as THREE from 'three';
import {
  bspPanelField, cavityField, clamp, clamp01, curvatureField, exposureField,
  fbmField, grainField, hash2, smoothstep, type PanelSplitResult,
} from '@homie-rocks/noise/Noise.js';
import { bytesTexture, sobelNormalBytes, textureBudget } from './Textures.js';
import { chainPatch } from './chainpatch.js';

/** One BSP scale. Both of a hull's two scales are stated the same way. */
export interface PanelScaleSpec {
  /** smallest leaf as a fraction of the atlas — this is the plate size */
  minArea: number;
  sizeJitter: number;
  crossChance: number;
  /** joint width in tile units; read the clamp trap in the header first */
  gap: number;
  seed: number;
}

export interface PanelHullSpec {
  /** atlas edge, before the process texture budget has had its say */
  res: number;
  /** the plate scale and the sub-panel scale */
  big: PanelScaleSpec;
  sub: PanelScaleSpec;
  /** per-texel grain, for the last decade of variation */
  grainSeed: number;
  /** the fine noise under the fastener heads */
  rivet: { freq: number; octaves: number; seed: number };
  fastener: {
    /** heads per sub-panel edge */
    perEdge: number;
    /** the band around a sub-panel's perimeter the heads live in */
    perimLo: number;
    perimHi: number;
    /** how sharp one head is */
    headLo: number;
    headHi: number;
  };
  /** what each layer contributes to the relief, in the units the fields consume */
  height: {
    plate: number;
    subPanel: number;
    fastener: number;
    /** the squared term that flattens a head's crown */
    fastenerCrown: number;
    rivet: number;
    /** the per-panel dish; its sign is the panel's, not the noise's */
    oilCan: number;
  };
  /** cavity solve: reach in texels, and the relief scale it is measured against */
  cavity: { reach: number; relief: number };
  /** curvature solve radius, texels */
  curvature: number;
  /**
   * Where the light has been, over the surface's whole history. Not where the
   * key is this frame — this is what decides where rime survives and where
   * paint chalks, so it is a statement about the world and never about a shot.
   */
  exposure: { dirX: number; dirY: number; elevation: number; reach: number; relief: number };
}

/** The panel geometry, as fields rather than as pixels. */
export interface PanelHullFields {
  res: number;
  big: PanelSplitResult;
  sub: PanelSplitResult;
  fastener: Float32Array;
  height: Float32Array;
  cavity: Float32Array;
  curvature: Float32Array;
  exposure: Float32Array;
  grain: Float32Array;
  /**
   * The sub-panel seed, carried forward because `packHullMaps` hashes the same
   * panel ids and MUST do it in the same stream. A second seed spelled at the
   * pack site is how a roughness draw stops correlating with the panel it is
   * supposed to belong to, silently.
   */
  subSeed: number;
}

/**
 * Bake the fields once.
 *
 * Held separately from the maps because every albedo pass over the roster reads
 * them, and regenerating a BSP and three placement solves per body would be N
 * times the boot cost for N identical answers. Caching is the CALLER's, not
 * this file's: a module-level cache here would hand a second game in the same
 * process the first game's plating.
 */
export function panelHullFields(s: PanelHullSpec): PanelHullFields {
  const res = Math.min(s.res, textureBudget());
  const n = res * res;
  const big = bspPanelField(res, { ...s.big, res });
  const sub = bspPanelField(res, { ...s.sub, res });
  const fastener = new Float32Array(n);
  const height = new Float32Array(n);
  const grain = grainField(res, s.grainSeed);
  const rivetNoise = fbmField(res, s.rivet);
  const h = s.height;
  const f = s.fastener;

  for (let i = 0; i < n; i++) {
    // Fasteners run around each SUB-panel's perimeter. See the header.
    const perim = 1 - smoothstep(f.perimLo, f.perimHi, Math.min(
      Math.min(sub.lu[i]!, 1 - sub.lu[i]!), Math.min(sub.lv[i]!, 1 - sub.lv[i]!),
    ));
    const fu = Math.abs(((sub.lu[i]! * f.perEdge) % 1) - 0.5) * 2;
    const fv = Math.abs(((sub.lv[i]! * f.perEdge) % 1) - 0.5) * 2;
    fastener[i] = smoothstep(f.headLo, f.headHi, Math.min(fu, fv)) * perim;
    height[i] =
      -(1 - big.edge[i]!) * h.plate -
      (1 - sub.edge[i]!) * h.subPanel +
      fastener[i]! * h.fastener - fastener[i]! * fastener[i]! * h.fastenerCrown +
      rivetNoise[i]! * h.rivet +
      (hash2(sub.id[i]!, 3, s.sub.seed) - 0.5) * h.oilCan *
        (1 - Math.abs(sub.lu[i]! - 0.5) * 2) * (1 - Math.abs(sub.lv[i]! - 0.5) * 2);
  }

  const cavity = cavityField(height, res, s.cavity.reach, s.cavity.relief);
  const curvature = curvatureField(height, res, s.curvature);
  const e = s.exposure;
  const exposure = exposureField(height, res, e.dirX, e.dirY, e.elevation, e.reach, e.relief);

  return { res, big, sub, fastener, height, cavity, curvature, exposure, grain, subSeed: s.sub.seed };
}

/**
 * How the fields become the two shared maps. Every weight is the game's.
 *
 * `roughCentre` is the one that needs saying out loud: the G channel is a
 * MULTIPLIER centred on a value, not a roughness. Each material then sets its
 * own roughness to its own figure divided by that centre, so a matte body and a
 * polished one both come off the same map and both keep the per-panel spread.
 */
export interface PanelHullMapSpec {
  ao: { cavity: number; fastener: number };
  rough: {
    centre: number;
    /** width of the per-panel roughness draw, and the salt it is hashed with */
    panelSpread: number;
    panelSalt: number;
    cavity: number;
    crown: number;
    grain: number;
  };
  /** how much of a fastener head reads as proud bare metal in the A channel */
  crownFastener: number;
  /** Sobel strength, as a multiple of `res` — see the note at the call */
  normalScale: number;
  anisotropy: number;
}

export interface PanelHullMaps {
  normal: THREE.Texture;
  /**
   * R = AO, G = roughness centre, **B = cavity, A = crown**.
   *
   * B AND A CARRY THE TWO WEAR FIELDS, NOT A METALNESS VALUE, and this is the
   * decision the whole file is built around.
   *
   * Putting a near-constant metalness here and letting each material scale it
   * by one number is what makes every body in a roster read as the same flat
   * plastic, and the arithmetic says why: a PAINTED hull is a dielectric, so
   * running it at metalness 0.55 replaces 55 % of its response with a smooth
   * mirror of the environment while scaling the diffuse — the panel field, the
   * oxide, the primer, the stencils, all of it — down by the same 55 %. A
   * beautiful albedo multiplied by 0.45 and covered in an even, featureless env
   * reflection is exactly a large flat surface whose highlight is perfectly
   * even from edge to edge.
   *
   * So metalness stops being a value and becomes a MASK the material resolves
   * in the shader from these two fields: cavity (where oxide sits, and oxide is
   * a dielectric) and crown (where paint is knocked back to primer and bare
   * plate, and that IS metal). Both are the same fields the albedo pass reads,
   * so the metal shows through exactly where the paint has gone — which is the
   * correlation that reads as history, and the thing a second scattered mask
   * can never buy.
   *
   * Fastener heads fold into the CROWN channel rather than into one of their
   * own: a rivet is a proud, high-curvature feature and that is what crown
   * means, so a rivet on a painted surface comes out as a bare metal dome
   * sitting in paint for free.
   *
   * It is bound as `metalnessMap` only so three declares the sampler and the UV
   * varying; the stock chunk's contribution is overwritten by the material.
   */
  orm: THREE.Texture;
  res: number;
}

export function packHullMaps(hf: PanelHullFields, m: PanelHullMapSpec): PanelHullMaps {
  const res = hf.res;
  const n = res * res;
  const orm = new Uint8ClampedArray(n * 4);
  for (let i = 0, k = 0; i < n; i++, k += 4) {
    const cav = hf.cavity[i]!;
    const crown = clamp(hf.curvature[i]!, -1, 1);
    orm[k] = (1 - cav * m.ao.cavity - hf.fastener[i]! * m.ao.fastener) * 255;
    const panelR = (hash2(hf.sub.id[i]!, m.rough.panelSalt, hf.subSeed) - 0.5) * m.rough.panelSpread;
    orm[k + 1] = clamp01(
      m.rough.centre + panelR + cav * m.rough.cavity
      - Math.max(0, crown) * m.rough.crown + (hf.grain[i]! - 0.5) * m.rough.grain,
    ) * 255;
    orm[k + 2] = clamp01(cav) * 255;
    orm[k + 3] = clamp01(Math.max(0, crown) + hf.fastener[i]! * m.crownFastener) * 255;
  }

  // The Sobel strength scales with `res` because a taller field over the same
  // world area has steeper texel-to-texel steps; a fixed strength would make
  // the relief flatten out every time the texture budget dropped a rung.
  const normalBytes = sobelNormalBytes(hf.height, res, m.normalScale * res * 0.012);
  const up = { srgb: false, wrap: THREE.ClampToEdgeWrapping, anisotropy: m.anisotropy };
  return {
    normal: bytesTexture(res, normalBytes, up),
    orm: bytesTexture(res, orm, up),
    res,
  };
}

/**
 * WHERE THE PAINT ENDS AND THE METAL STARTS — the shader half of the ORM's
 * B and A channels, and the reason they carry fields instead of a value.
 *
 * A per-material `metalness` scalar can only say "a bit shiny everywhere". What
 * a real finish is, is composite: paint over zinc with the paint gone at every
 * leading edge; a chalked coat over galvanising with the galvanising showing; a
 * mismatched panel with a fifth of it rusted off. So metalness is resolved PER
 * TEXEL here, from the two wear fields `packHullMaps` wrote, against three
 * scalars the body supplies:
 *
 *   rust    oxide coverage  — reads the CAVITY channel. Oxide is a dielectric.
 *   bare    bare coverage   — reads the CROWN channel, rivet heads included. Is
 *                             metal.
 *   intact  the finish's own metalness where it has NOT worn — 0 for paint,
 *           ceramic and lacquer, 1 for bare steel and chrome.
 *
 * THE TWO SMOOTHSTEP WINDOWS MUST BE THE SAME ONES THE ALBEDO PASS USED. That
 * is the whole point and it is the easy thing to let drift: if the lighting's
 * idea of "bare" and the albedo's idea of "bare" land on different texels, the
 * wear stops reading as history and starts reading as a second texture laid
 * over the first. They are arguments here so a caller can pass one pair of
 * numbers to both halves rather than spelling them twice.
 *
 * Roughness rides along: oxide is rough, freshly exposed plate is not.
 *
 * Cost: one texture fetch (same texture, same UV, so a cache hit) and about a
 * dozen ALU. It REPLACES nothing — the stock `<metalnessmap_fragment>` still
 * runs above it and is overwritten, which is cheaper than fighting three's
 * chunk order for the sake of one multiply. The cache key is constant, so a
 * whole roster shares ONE program for this injection: only the uniform differs,
 * and a uniform does not fork a shader.
 */
export interface WearMetalnessTune {
  /** oxide coverage, bare coverage, and the intact finish's own metalness */
  rust: number;
  bare: number;
  intact: number;
  /** the cavity window the albedo pass placed oxide in, and its gain */
  rustWindow: readonly [number, number];
  rustGain: number;
  /** the crown window the albedo pass placed primer in */
  bareWindow: readonly [number, number];
  /** how completely bare plate wins over the finish, and oxide takes metal away */
  bareWins: number;
  rustKills: number;
  /** what each does to roughness */
  rustRough: number;
  bareRough: number;
}

export function installWearMetalness(m: THREE.Material, t: WearMetalnessTune) {
  const uWear = { value: new THREE.Vector3(t.rust, t.bare, t.intact) };
  chainPatch(m, 'hullwear1', (shader: { uniforms: Record<string, unknown>; fragmentShader: string }) => {
    shader.uniforms.uWear = uWear;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uWear;\nvoid main() {')
      .replace(
        '#include <metalnessmap_fragment>',
        [
          '#include <metalnessmap_fragment>',
          '{',
          '  vec4 wearT = texture2D( metalnessMap, vMetalnessMapUv );',
          `  float rust = clamp( smoothstep( ${t.rustWindow[0].toFixed(2)}, ${t.rustWindow[1].toFixed(2)}, wearT.b ) * uWear.x * ${t.rustGain.toFixed(2)}, 0.0, 1.0 );`,
          `  float bare = clamp( smoothstep( ${t.bareWindow[0].toFixed(2)}, ${t.bareWindow[1].toFixed(2)}, wearT.a ) * uWear.y, 0.0, 1.0 );`,
          // Bare plate wins over the finish; oxide then takes metal away from
          // whatever is left, including from a surface that was bare to start
          // with — a rusted steel truss is not a mirror either.
          `  metalnessFactor = mix( uWear.z, 1.0, bare * ${t.bareWins.toFixed(2)} ) * ( 1.0 - rust * ${t.rustKills.toFixed(2)} );`,
          `  roughnessFactor = clamp( roughnessFactor * ( 1.0 + rust * ${t.rustRough.toFixed(2)} - bare * ${t.bareRough.toFixed(2)} ), 0.03, 1.0 );`,
          '}',
        ].join('\n'),
      );
  });
}
