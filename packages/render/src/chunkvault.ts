/**
 * ============================================================================
 *  `THREE.ShaderChunk` is a PROCESS-WIDE MUTABLE OBJECT. This is the save.
 * ============================================================================
 *
 * A renderer that patches a chunk and does not put it back leaves every later
 * scene in the page — a second game, a menu, a replay — compiling against the
 * first one's fog and the first one's shadow resolver, with no error anywhere.
 * The save and the restore are therefore one pair in one object rather than two
 * halves in two places, which is how they drift.
 *
 * Every rig that patches three's chunks needs exactly this and nothing more, so
 * it lives once. `cascade.ts` holds a vault over its eight chunks; a
 * base-building game holds one over its three. The LIST is the caller's,
 * because which chunks a rig patches is a fact about that rig; the memo
 * discipline is not, and it is the part that is easy to get wrong.
 */
import * as THREE from 'three';

/**
 * A memoised snapshot of the unpatched text of a named set of `ShaderChunk`
 * entries, and the ability to put them all back.
 */
export class ChunkVault {
  readonly names: readonly string[];
  #stock: Record<string, string> | null = null;

  constructor(names: readonly string[]) {
    this.names = names.slice();
  }

  /**
   * The unpatched text of every chunk in `names`, captured the FIRST time this
   * is called and memoised after that.
   *
   * THE MEMO IS WHAT MAKES A SECOND INSTALL SAFE, and it is the whole reason
   * this is an object rather than two free functions over a local variable.
   * Every rig in this repository installs its patches at least twice — once at
   * boot against an empty scene, once on the first real frame, and again on
   * every quality switch — and capturing "the original" the second time would
   * capture the FIRST INSTALL'S OUTPUT as the original. `restore()` would then
   * put the patch back instead of removing it, and a later re-derive would
   * patch an already-patched string. Neither produces an error; both produce a
   * shader nobody can account for.
   */
  stock(): Record<string, string> {
    const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
    if (this.#stock === null) {
      const snap: Record<string, string> = {};
      for (const name of this.names) snap[name] = chunks[name] as string;
      this.#stock = snap;
    }
    return this.#stock;
  }

  /**
   * Put every patched chunk back and forget the originals.
   *
   * Idempotent, and a NO-OP when nothing was ever captured — a dispose that runs
   * twice, or one on a rig that threw during init, must not write `undefined`
   * over three's own source. That is a page whose every later material fails to
   * compile, from a cleanup path.
   */
  restore(): void {
    if (this.#stock === null) return;
    const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
    for (const name of this.names) chunks[name] = this.#stock[name] as string;
    this.#stock = null;
  }

  /** True once `stock()` has captured. For a harness, and for an assertion. */
  get captured(): boolean {
    return this.#stock !== null;
  }
}
