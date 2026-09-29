/**
 * ============================================================================
 *  Scratch — four reused temporaries, and the reason they are not duplicated.
 * ============================================================================
 *  These are not exported from the package for anyone to use. They exist as
 *  their own module for one reason: in the game they came from they were FOUR
 *  OBJECTS shared by `gantryCraneGeo` and `pressureBayGeo`, and those two
 *  generators went into different modules here.
 *
 *  MOVING A FUNCTION GIVES IT A DIFFERENT MODULE-LEVEL SCRATCH. Copying these
 *  four lines into both files would compile, would look tidier, and would mean
 *  the two generators no longer share the objects they shared before — which is
 *  a behaviour difference that shows up only if the two ever interleave, and
 *  therefore a behaviour difference nobody would find. The whole claim of this
 *  package is that nothing changed; a claim with a "well, except for" in it is
 *  not one.
 *
 *  So the aliasing is preserved exactly, and a fingerprint test proves it
 *  rather than asserting it — every geometry these two build is compared
 *  bit-for-bit against the game's own pre-move bytes.
 *
 *  Both current uses set-then-consume inside one synchronous call, so the
 *  sharing is very probably not observable. "Very probably" is exactly the
 *  standard this file exists to avoid having to meet.
 */
import * as THREE from 'three';

export const _ta = new THREE.Vector3();
export const _tb = new THREE.Vector3();
export const _tq = new THREE.Quaternion();
export const _tup = new THREE.Vector3(0, 1, 0);
