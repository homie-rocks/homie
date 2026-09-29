/**
 * ============================================================================
 *  matsweep.ts — install shader terms onto materials a module did not build,
 *  a few a frame, exactly once each.
 * ============================================================================
 *  A material library can only reach the materials it made. Every game of any
 *  size has a second population — the ones the world generator, the prop kit or
 *  the track builder made — and the injections that need nothing from a texture
 *  set (a geometric wear term, a variance filter, an analytic light) are
 *  precisely the ones that could reach them. What stops it is not the term. It
 *  is that doing it correctly has six moving parts and getting any of them
 *  wrong is silent:
 *
 *   · **Not all at once.** Every material out there is already COMPILED —
 *     a library inits before a world does, so the pre-warm built these programs
 *     with the un-patched hooks and `needsUpdate` throws them away. The whole
 *     set in one frame is one ~300 ms stall; a handful a frame is that stall
 *     spread over the frames a menu is on screen, where a long frame costs
 *     nothing. `traverse` has no early-out, so a full sweep still WALKS the
 *     graph and only skips the work — a handful of null checks over a group
 *     that is otherwise touched once.
 *   · **Exactly once each.** A WeakSet held by the CALLER, so two sweeps over
 *     overlapping subtrees do not double-inject, and so a build-time
 *     installation in the other module makes this a no-op rather than a second
 *     helping. It is the caller's set by identity for the same reason every
 *     idempotence register in this package is: a second, equivalent set is the
 *     same bug wearing a different name.
 *   · **Standard and Physical only.** These injections write into
 *     `reflectedLight` and `roughnessFactor`. A Basic material has neither, and
 *     a decal or a sprite that received one would fail to compile and take the
 *     surface it is on to black.
 *   · **A fixture is not a surface.** An emitter lit by the term it is emitting
 *     doubles its own edge. The threshold is the CALLER'S — what counts as a
 *     fixture is a fact about a game's emissive ladder — and the tier is
 *     measured the way an artist thinks about it: intensity times the emissive
 *     colour's strongest channel.
 *   · **Refuse rather than guess.** A root that is absent or empty costs
 *     nothing and does NOT fall back to sweeping the scene. Sweeping a scene
 *     reaches the vehicles, and a world-oriented wear term on a moving object
 *     makes frost swim across a hull as it yaws.
 *   · **Know when it is finished.** A pass that finds nothing NEW after at
 *     least one has landed is the end of the set; a pass that finds nothing AT
 *     ALL is a world that has not built its meshes yet, and spending the budget
 *     on it is the whole point of having a budget.
 *
 *  WHAT IS NOT HERE, AND IS NOT AN OMISSION. Which subtree, which threshold,
 *  which terms and with what arguments — all of it is the caller's. This class
 *  chooses nothing about a picture; it decides when and how often, and it is
 *  the six bullets above.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import type * as THREE from 'three';

export interface SweepOpts {
  /**
   * How many frames this sweep may spend looking for its root. It is a frame
   * budget and not a timeout: a world that never builds the subtree must stop
   * costing a traverse eventually, and a world that builds it on frame 200 must
   * still be reached.
   */
  frames: number;
  /** materials patched per frame. Default 4 — see the stall note in the header */
  perFrame?: number;
  /**
   * A material whose emissive tier reaches this is a FIXTURE and is skipped.
   * Tier is `emissiveIntensity * max(emissive.r, g, b)`. Default 0.9.
   */
  fixtureTier?: number;
  /**
   * The idempotence register, BY IDENTITY. Shared across every sweep that could
   * reach the same material, and shared with any build-time installation that
   * wants to take a material off the list.
   */
  claimed: WeakSet<THREE.Material>;
}

/**
 * One budgeted sweep. Construct it once, call `run` from `update`, and it stops
 * on its own.
 */
export class MaterialSweep {
  private budget: number;
  private readonly perFrame: number;
  private readonly fixtureTier: number;
  private readonly claimed: WeakSet<THREE.Material>;
  /** how many materials this sweep has actually patched, over its whole life */
  count = 0;

  constructor(o: SweepOpts) {
    this.budget = o.frames;
    this.perFrame = o.perFrame ?? 4;
    this.fixtureTier = o.fixtureTier ?? 0.9;
    this.claimed = o.claimed;
  }

  /** true once the sweep has decided it is finished, or run out of frames */
  get finished(): boolean { return this.budget <= 0; }

  /**
   * Stop looking, now and permanently. For a dispose: the graph this was
   * walking is going away, and a budget left running traverses a dead group
   * every frame. NOT the same as finishing — `justFinished` stays false.
   */
  stop(): void { this.budget = 0; }

  /**
   * Spend one frame of the budget on `root`.
   *
   * `apply` receives a material that is Standard-or-Physical, unclaimed and not
   * a fixture, and installs whatever it likes on it. `needsUpdate` and the
   * counting are this class's; the picture is the caller's. Returning nothing
   * still counts — a caller that DECIDED to leave a material alone has spent
   * the slot, and re-visiting it next frame would be a sweep that never ends.
   */
  run(
    root: THREE.Object3D | null | undefined,
    apply: (m: THREE.MeshStandardMaterial) => void,
    /**
     * A job that outranks patching and TAKES THE FRAME when it does something —
     * replacing a material outright rather than injecting into one, say.
     * Returning true ends the frame here, which is the honest accounting: the
     * slot it spent is the slot `apply` would have had, and doing both in one
     * frame is the ~300 ms stall this whole class exists to spread out.
     */
    preempt?: (root: THREE.Object3D) => boolean,
  ): void {
    if (this.budget <= 0) return;
    this.budget--;
    if (!root || root.children.length === 0) return;
    if (preempt?.(root)) return;

    let patched = 0;
    root.traverse((o) => {
      if (patched >= this.perFrame) return;
      const mats = (o as THREE.Mesh).material;
      if (!mats) return;
      const list = Array.isArray(mats) ? mats : [mats];
      for (const m of list) {
        if (!m || this.claimed.has(m)) continue;
        this.claimed.add(m);
        const sm = m as THREE.MeshStandardMaterial;
        if (!(sm as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) continue;
        const e = sm.emissive;
        const tier = e ? (sm.emissiveIntensity ?? 1) * Math.max(e.r, e.g, e.b) : 0;
        if (tier >= this.fixtureTier) continue;
        apply(sm);
        sm.needsUpdate = true;
        patched++;
        this.count++;
        if (patched >= this.perFrame) break;
      }
    });

    // Nothing NEW after at least one landed is the end of the set. Nothing at
    // all is a world that has not built its meshes yet — keep spending frames.
    if (patched > 0 || this.count === 0) return;
    this.budget = 0;
    this.done = true;
  }

  /**
   * True exactly once: on the frame the sweep decided the set was complete,
   * having patched something. The caller logs THERE — this class does not own a
   * vocabulary for what was installed, and a package that logs a game's
   * art-direction section numbers is a package that has taken a game's art
   * direction with it.
   *
   * Deliberately NOT `finished`, which is also true when the frame budget
   * simply ran out over a world that never appeared. Those two must not render
   * as the same thing: one is a complete set and one is a sweep that found
   * nothing, and a message about the second would be a precise lie.
   */
  justFinished(): boolean {
    if (!this.done || this.reported) return false;
    this.reported = true;
    return true;
  }

  private done = false;
  private reported = false;
}
