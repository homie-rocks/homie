/**
 * ============================================================================
 *  HeldLatch.ts — how a chain that ACCUMULATES survives being held, without
 *  photographing a racer standing still.
 * ============================================================================
 *  A held frame has to be the SAME PICTURE every time it is drawn. That is what
 *  a capture protocol means, and `./Chain.ts`'s `syncHeld` gets there the direct
 *  way: `if (held) this.primed = false`. Drop the history, reproject through the
 *  identity, blur nothing, and every held draw is bit-identical.
 *
 *  THAT IS THE RIGHT ANSWER FOR A CHAIN WITH NOTHING TO ACCUMULATE AND THE
 *  WRONG ONE FOR A CHAIN THAT HAS SOMETHING, and both halves are measured.
 *
 *  Right: a harness pose or any `__freeze` TELEPORTS the camera, and
 *  reprojecting across a jump nobody made smears the whole frame along a motion
 *  vector describing it. One game measured that as a teal brick across half a
 *  capture set.
 *
 *  Wrong: every reprojection is a difference against the PREVIOUS frame, and
 *  the previous frame of the FIRST held draw is a live one. So held draw 1
 *  inherited a real camera sweep and held draw 2 saw everything exactly where
 *  it left it and read zero — and which one the shutter caught was decided by
 *  how many rAFs the compositor happened to run. Dropping the history fixes
 *  that by making every draw the second one, and the cost is the whole shutter:
 *  seventeen of twenty stations in one capture set asked for 60–109 px of
 *  streak and measured 2.00 px world edges, which is an antialiaser's own
 *  transition width. Every still anybody had scored was a photograph of a
 *  165 m/s racer standing still.
 *
 *  THE TWO REQUIREMENTS ONLY COLLIDED BECAUSE ONE FLAG WAS SERVING BOTH.
 *  Determinism needs every held draw to be IDENTICAL. It does not need them to
 *  be MOTIONLESS. So: LATCH the history rather than dropping it. Every live
 *  frame stashes the reprojection state it entered with, and every held draw of
 *  the hold that follows replays that same stash. All held draws then reproject
 *  through one fixed pair — bit-identical however many the compositor runs —
 *  and that pair is a real stride of simulated motion.
 *
 *  AND THE LATCH MUST NOT FIRE ON A STANDING START. The inverse failure is
 *  "the picture is smeared and the world is not moving", and it is real: a grid
 *  shot is a countdown at 0 m/s, and the last LIVE frame before that hold is
 *  one where a harness was still easing the camera onto its mark — real camera
 *  motion belonging to the staging and not to the race. Replaying it measured
 *  11.0 px across against 6.0 px down, a 1.83 anisotropy where a still frame
 *  reads 1.0. Below walking pace there is nothing for a shutter to smear, so
 *  the hold collapses the history exactly as the base chain does.
 *
 *  `moving` IS THE SUBJECT'S OWN SPEED AND NOT THE CAMERA'S DISPLACEMENT. The
 *  camera can be moving because a rig is settling, and a settling rig is
 *  exactly the motion a capture must NOT photograph. The caller answers it,
 *  because only the caller knows what the subject is.
 *
 *  WHAT IS DELIBERATELY NOT HERE. Which fields are the history. This class
 *  never touches a matrix; `save`, `restore` and `drop` are the caller's, and a
 *  chain with three history buffers or none uses the same three verbs. That is
 *  what stops this being a second `syncHeld` with a different policy welded in.
 * ============================================================================
 */

export interface HeldLatchOpts {
  /**
   * Stash the reprojection state THE FRAME ENTERED WITH. Called on every live
   * frame, and it must run BEFORE the frame rolls its history forward — what a
   * hold replays is the pair the last live frame DREW with, not the pair that
   * frame left behind, and those are the same camera twice.
   */
  save: () => void;
  /** Put the stash back. Called on every held frame of a moving hold. */
  restore: () => void;
  /**
   * Collapse the history: no previous frame, no blur. Called on every held
   * frame of a hold that began below walking pace, and it is what `./Chain.ts`
   * does unconditionally.
   */
  drop: () => void;
  /**
   * Is the SUBJECT moving, right now, on this live frame? Read on live frames
   * only; the answer is latched with the rest and it is what decides which of
   * `restore` and `drop` the hold that follows will use.
   */
  moving: () => boolean;
}

/**
 * Call `apply(held)` once per sync, at the TOP, before anything reads the
 * reprojection state.
 */
export class HeldLatch {
  private readonly o: HeldLatchOpts;
  private wasMoving = false;

  constructor(o: HeldLatchOpts) { this.o = o; }

  /** true if the hold currently in progress is replaying a moving stash */
  get replaying(): boolean { return this.wasMoving; }

  apply(held: boolean): void {
    if (held && this.wasMoving) { this.o.restore(); return; }
    if (held) { this.o.drop(); return; }
    this.o.save();
    this.wasMoving = this.o.moving();
  }
}
