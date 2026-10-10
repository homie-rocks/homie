# Stormbreak terrain regression

The two original probes are copied unchanged from Homie's studio at 0.44.1.
`map.json` is their exact lossless output: 179 boxes and 3,879 top tiles (six
ramps, 739 landscape, 3,134 courier). Tests add `base: 0` to close these tiles.
Source merging arithmetic error is at most 1.78e-15 m; no resampling occurred.
The studio itself was read only.

Both original probes were run from a temporary copy of the studio with this
worktree's package linked. The adapted runs only add `base:0`, replace the old
failure assertions with collision assertions, and include eight seats in the map
probe. Receipts are retained here; the release gates use this same baked map in
rules-view.test.mjs and rules-terrain-chrome.test.mjs, independent of local paths.
The original probe scripts retain their original failure expectations and are
provenance, not scripts to run directly against the new API.

The unchanged reference mover rejects a blocked .2 m input increment, stopping at
-3.000 m. The continuous toolkit sweep stops the same .42 m capsule at -2.921 m
(-2.5 minus radius minus .001 skin). Both block the side. Both rays hit at 1.500 m.
Changing the capsule to force identical coordinates would misrepresent parity.
The full Stormbreak game has not been ported or deployed by these toolkit tests.

# Physics package boundary

PR #76 (`physics-package`) was inspected, including Shapes.ts, Heightfield.ts and
its package design. Its shape operations construct Rapier WASM descriptors;
there is no standalone convex cast implementation to extract. Rules handlers and
prediction are synchronous, guarded, and meter each bounded query operation.
Depending on the private, unpublished physics package would add initialization,
Float32 geometry conversion and unmetered WASM calls to that contract. Therefore
rules keeps its existing collision kernel and adds solid triangular prisms there.
No Rapier implementation was copied. A future shared engine would require a
separate decision about initialization, precision, budgets and package release.
