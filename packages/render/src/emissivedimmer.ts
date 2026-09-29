/**
 * ============================================================================
 *  emissivedimmer.ts — a global dimmer switch over every emissive material a
 *  scene reached through one naming convention.
 * ============================================================================
 *
 * ## The mechanism, with nothing in it that knows what is being dimmed
 *
 * A game that builds its artificial light out of a small number of
 * `MeshStandardMaterial`s already owns a dimmer switch it has not wired up:
 * `emissive * emissiveIntensity` is, by construction, a global gain on every
 * fixture drawn with that material. This class is the switch plate.
 *
 *   `scan`     walk the scene, adopt the material of every mesh whose name ends
 *              in `suffix`, and record its AUTHORED emissive and intensity
 *   `apply`    write `authored * tint` and `authored.intensity * gain`
 *   `restore`  put every adopted material back exactly as its owner wrote it
 *   `reset`    forget everything, because the scene was rebuilt underneath us
 *
 * ## Three properties that are the whole reason this is a class
 *
 * **The authored value is captured once, before the first grade.** Without the
 * `Map`, a re-scan taken mid-dim records a graded value as the original and the
 * grade compounds every rescan until the fixtures are black. The `Map` is keyed
 * on the MATERIAL, so re-adoption is idempotent however many meshes share one.
 *
 * **It is a uniform write, not a recompile.** `emissive` and `emissiveIntensity`
 * are uniforms on an already-compiled program, so writing them every frame costs
 * two uploads and never touches `needsUpdate`. That is the difference between
 * this and the obvious "swap the material" implementation, which recompiles
 * every program in the game on the one frame the state changes.
 *
 * **`reset` is not optional and it is not tidiness.** A game that rebuilds its
 * world — a new level, a re-seed, a scenario swap — disposes the meshes this
 * adopted while `driven` stays non-zero, the rescan interval has not elapsed,
 * and `apply` writes into dead materials. The new fixtures then keep their
 * authored intensity with no dim applied at all, which reads as the lights
 * having come back on by themselves.
 *
 * ## What is NOT here
 *
 * **Every colour and every tuned number.** `apply` takes a finished `tint` and
 * a finished `gain`; it does not know what a brownout is, that a fixture is
 * cyan, or that anything gets dimmer at noon. The caller composes those from
 * its own palette and its own state, and that is deliberate: a tint default in
 * this file is how the next game to import it inherits the first one's colour
 * grade while every parity check stays green.
 *
 * **Which materials are excluded.** The `suffix` is the whole selector. A game
 * that wants its vehicles left alone at full brightness while the base browns
 * out expresses that by not naming vehicle submeshes with the suffix — not by a
 * flag here.
 */
import * as THREE from 'three';

/** Authored values, captured the first time a material is adopted. */
interface AuthoredEmissive { emissive: THREE.Color; intensity: number; }

export interface EmissiveDimmerSpec {
  /**
   * Mesh-name suffix that marks a submesh as a fixture. Required, with no
   * default: the convention is the game's, and a wrong one here fails in the
   * quiet direction — `driven` stays 0, nothing throws, and the dimmer simply
   * never changes a pixel. Callers should shout when `driven` is 0 and the
   * state says it should not be.
   */
  suffix: string;
  /**
   * Frames between rescans. A world that is built progressively needs this to
   * be finite; `force` covers the moments the caller knows it changed.
   */
  rescanFrames: number;
}

export class EmissiveDimmer {
  readonly #suffix: string;
  readonly #rescanFrames: number;
  readonly #authored = new Map<THREE.Material, AuthoredEmissive>();
  #appliedK = -1;
  #appliedGain = -1;
  readonly #appliedTint = new THREE.Color(-1, -1, -1);
  #scanFrame = -1e9;

  constructor(spec: EmissiveDimmerSpec) {
    this.#suffix = spec.suffix;
    this.#rescanFrames = spec.rescanFrames;
  }

  /** How many materials the dimmer has adopted. 0 means it is doing nothing. */
  get driven(): number { return this.#authored.size; }

  /**
   * Walk the scene and adopt every matching material.
   *
   * Re-scanned on an interval rather than once, because a world built
   * progressively replaces its merged meshes as it grows.
   */
  scan(scene: THREE.Scene, frame: number, force = false): void {
    if (!force && frame - this.#scanFrame < this.#rescanFrames) return;
    this.#scanFrame = frame;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || typeof m.name !== 'string' || !m.name.endsWith(this.#suffix)) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial;
        if (!std || !std.isMeshStandardMaterial || this.#authored.has(std)) continue;
        this.#authored.set(std, {
          emissive: std.emissive.clone(),
          intensity: std.emissiveIntensity,
        });
      }
    });
  }

  /**
   * Push the grade.
   *
   * `tint` is the per-channel multiplier AT FULL STRENGTH and `k` is how far
   * toward it to travel, so the channel factors are `lerp(1, tint.c, k)`. They
   * arrive separately rather than pre-lerped because `k` is also the early-out
   * key, and a caller that lerped upstream would hand back a tint that no
   * longer says which state it belongs to.
   *
   * `gain` is a FLAT scalar on `emissiveIntensity` — every level change belongs
   * here and every hue change belongs in `tint`. Conflating them is how a level
   * change acquires a colour: a game whose lights dim at noon and grade toward
   * a failure palette when the power drops must not tint the noon frame toward
   * the failure palette, and keeping the two arguments apart is what enforces
   * that at the seam rather than in a comment.
   *
   * Early-outs when no number has moved, so a steady state pays five float
   * comparisons per frame.
   *
   * `tint` is solved in the renderer's WORKING colour space, which is where a
   * material's `emissive` lives. A caller deriving it from palette entries must
   * take the ratio of two `THREE.Color`s, not of their sRGB bytes — the second
   * grades a gamma-encoded ratio into a linear multiply and lands well short.
   */
  apply(tint: THREE.Color, k: number, gain: number): void {
    if (Math.abs(k - this.#appliedK) < 1e-4
      && Math.abs(gain - this.#appliedGain) < 1e-4
      && Math.abs(tint.r - this.#appliedTint.r) < 1e-4
      && Math.abs(tint.g - this.#appliedTint.g) < 1e-4
      && Math.abs(tint.b - this.#appliedTint.b) < 1e-4) return;
    this.#appliedK = k;
    this.#appliedGain = gain;
    this.#appliedTint.copy(tint);

    const gr = THREE.MathUtils.lerp(1, tint.r, k);
    const gg = THREE.MathUtils.lerp(1, tint.g, k);
    const gb = THREE.MathUtils.lerp(1, tint.b, k);

    for (const [mat, a] of this.#authored) {
      const std = mat as THREE.MeshStandardMaterial;
      std.emissive.setRGB(a.emissive.r * gr, a.emissive.g * gg, a.emissive.b * gb);
      std.emissiveIntensity = a.intensity * gain;
    }
  }

  /**
   * Put every adopted material back exactly as its owner authored it, so a
   * restored world is bit-identical to one that never dimmed rather than
   * "close enough".
   */
  restore(): void {
    if (this.#appliedK === 0 && this.#appliedGain === 1) return;
    this.#appliedK = 0;
    this.#appliedGain = 1;
    this.#appliedTint.setRGB(1, 1, 1);
    for (const [mat, a] of this.#authored) {
      const std = mat as THREE.MeshStandardMaterial;
      std.emissive.copy(a.emissive);
      std.emissiveIntensity = a.intensity;
    }
  }

  /** Drop every adopted material. See the header — this is a correctness call. */
  reset(): void {
    this.#authored.clear();
    this.#appliedK = -1;
    this.#appliedGain = -1;
    this.#appliedTint.setRGB(-1, -1, -1);
    this.#scanFrame = -1e9;
  }
}
