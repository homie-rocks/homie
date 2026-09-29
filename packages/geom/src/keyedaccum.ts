/**
 * ============================================================================
 *  keyedaccum.ts — one accumulator per material key, one mesh per key.
 * ============================================================================
 *
 * `AttrAccum` next door welds many geometries into one buffer. It has no
 * opinion about materials, which is right, and it means every caller that wants
 * more than one material writes the same twelve lines: a Map from key to
 * accumulator, a lazy `get`-or-create, and a finish loop that skips the empty
 * ones, names each mesh and applies the caller's flags.
 *
 * That is what this is. It is the PER-NODE sibling of
 * `@homie-rocks/render/worldbatch`'s `StaticMerge`, which does the same bucketing for
 * a whole world across many nodes and rebuilds on a flush — same shape, one
 * scale up, and the two deliberately share the `MergeLib` idea of a key-to-
 * material lookup so a caller's shadow policy can be ONE function handed to
 * both. A game that writes the policy twice will eventually have two of them,
 * and the second will be the one that is wrong.
 *
 * ---------------------------------------------------------------------------
 *  WHY THE ORDER OF THE MAP IS PART OF THE CONTRACT
 * ---------------------------------------------------------------------------
 * The group's children come out in the order the keys were FIRST touched, not
 * in the order of the key type or in sorted order. That is a Map's insertion
 * order and it is deliberate: renderOrder is set per key, and among meshes
 * sharing a renderOrder three falls back to the order it walked the graph. Two
 * transparent meshes at the same renderOrder therefore depend on this, and
 * sorting the keys "to be tidy" reorders the blend on any node that has two.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THE CALLER OWNS
 * ---------------------------------------------------------------------------
 * The material for a key, the mesh name, and the flags — which is where a
 * shadow and render-order policy lives, because "an emissive strip must not
 * cast" is a statement about a game's look and not about triangles. And the
 * per-vertex payload: this takes the colour and the four extra channels already
 * decided, so whatever a game encodes into them (a tier, a pulse mode, a
 * per-piece roughness delta) stays in the game.
 */
import * as THREE from 'three';
import { AttrAccum } from './attraccum.js';

export interface KeyedAccumOpts<K extends string> {
  /** The material a key draws with. */
  material(key: K): THREE.Material;
  /** Name for the mesh a key produces. Shows up in a scene dump and in stats. */
  meshName(key: K, groupName: string): string;
  /**
   * Applied to every emitted mesh. This is the caller's shadow and
   * render-order policy, and handing the SAME function to a world batcher is
   * what stops a node's meshes and its merged copy disagreeing.
   */
  flags?(key: K, mesh: THREE.Mesh): void;
}

export class KeyedAccum<K extends string> {
  private acc = new Map<K, AttrAccum>();
  private o: KeyedAccumOpts<K>;
  /** How many `add` calls landed. A caller's own stats row usually wants this. */
  pieces = 0;

  // Written out rather than as a TypeScript parameter property, so this parses
  // under a strip-only type remover (node --experimental-strip-types). A
  // headless test runs these modules directly, and a build step it does not
  // share is a build step that can disagree with the game's.
  constructor(o: KeyedAccumOpts<K>) { this.o = o; }

  /**
   * One geometry, transformed, into the accumulator for `key`.
   *
   * `col` is read immediately, so a caller may reuse one scratch Color across
   * a whole build loop — which every build loop that uses this does, because a
   * fresh Color per piece is a few thousand allocations per building.
   */
  add(
    key: K, geo: THREE.BufferGeometry, m: THREE.Matrix4, col: THREE.Color,
    vx: number, vy: number, vz: number, vw: number,
  ): this {
    let a = this.acc.get(key);
    if (!a) this.acc.set(key, (a = new AttrAccum()));
    this.pieces++;
    a.add(geo, m, col, vx, vy, vz, vw);
    return this;
  }

  /** One mesh per non-empty key, in first-touched order. See the header. */
  finish(name: string): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    for (const [key, a] of this.acc) {
      if (a.empty) continue;
      const mesh = new THREE.Mesh(a.build(), this.o.material(key));
      mesh.name = this.o.meshName(key, name);
      this.o.flags?.(key, mesh);
      g.add(mesh);
    }
    return g;
  }
}
