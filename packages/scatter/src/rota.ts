/**
 * ============================================================================
 *  CellRota — don't show the same face twice within sight of itself.
 * ============================================================================
 *
 *  An atlas gives a scatter N variants of one prop: eight advertising boards,
 *  six shop fascias, four crate stencils, five license plates. Picking one at
 *  random per instance is correct on average and wrong in the frame the
 *  player is standing in — with eight cells and a hash, two adjacent boards
 *  come out identical about one time in eight, and a repeated ADVERT is the
 *  single loudest thing a scatter can do, because text is the one part of a
 *  world a person reads rather than glances at.
 *
 *  So: take the hash's answer, and if that cell has already been used within
 *  `clear` of here, walk to the next one. Give up after a full lap and let the
 *  caller place nothing rather than place a repeat.
 *
 *  ── WHY THE POSITION IS ONE NUMBER AND WHY IT WRAPS ────────────────────────
 *
 *  `d` is a position along a closed run — metres round a circuit, radians round
 *  a rotunda, seconds round a loop — and `ring` is its period. The distance
 *  test is `min(|Δ|, ring - |Δ|)`, so the last board before the start line and
 *  the first one after it can see each other, which they can. Pass `ring =
 *  Infinity` for an open run and the wrap term drops out.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS THE CALLER'S ─────────────────────────────
 *
 *  Mechanism: the history, the wrapped separation test, the walk and the
 *  give-up. The caller owns the CELL COUNT, the clearance, and the hash — the
 *  first pick is handed IN as a 0..1 draw rather than generated here, because
 *  which stream a scatter draws from and with what salt is the caller's and
 *  silently taking a number out of a shared RNG is how a world reseeds itself.
 *  Numbers in, an index out, no `three`.
 * ============================================================================
 */

export class CellRota {
  readonly #hist: { cell: number; d: number }[] = [];

  /**
   * @param cells how many variants the atlas holds.
   * @param clear two uses of one cell must be at least this far apart.
   * @param ring  period of the position axis; `Infinity` for an open run.
   */
  constructor(
    private readonly cells: number,
    private readonly clear: number,
    private readonly ring: number,
  ) {}

  /**
   * @param draw 0..1 from the caller's own hash or stream; picks the first
   *             cell tried.
   * @param d    where this instance is on the run.
   * @returns the cell index, or -1 if every cell is already in sight.
   */
  pick(draw: number, d: number): number {
    let cell = (draw * this.cells) | 0;
    let k = 0;
    while (k < this.cells && this.#near(cell, d)) {
      cell = (cell + 1) % this.cells;
      k++;
    }
    if (k >= this.cells) return -1;
    this.#hist.push({ cell, d });
    return cell;
  }

  #near(cell: number, d: number): boolean {
    return this.#hist.some((h) => {
      if (h.cell !== cell) return false;
      const dd = Math.abs(h.d - d);
      return Math.min(dd, this.ring - dd) < this.clear;
    });
  }
}
