# Studio 0.38.0 prediction release repair

The unpublished release failed because of real backward movement, not because its correction count exceeded a limit. The failed [publish run](https://github.com/homie-rocks/homie/actions/runs/37994662698) recorded 16 corrections, one ordinary catch-up, zero ordinary rebases, four backward drawing steps, and a worst step of -0.363551 m. The assertion was `backwards === 0` (steps below -0.01 m), not a correction-count assertion.

The original canvas drew one pixel per metre. That worst step was therefore only 0.364 pixels in its tiny test drawing. Gem Rush converts metres to 50 canvas pixels before camera zoom: the same displacement is 18.18 pixels at zoom 1. Counts alone cannot establish whether a correction is visible. The Chrome fixture now draws and records actual screen coordinates at 50 pixels/metre with a fixed camera and device scale 1.

## Causes and repair

During catch-up, a new snapshot could replace history ahead of the drawn tick. The current pose was preserved, but subsequent frames still crossed from old history into the replaced history. Two individually forward-moving paths could have a backward boundary. Catch-up now starts at the new snapshot boundary, and the existing bounded blend preserves the shown pose.

The loaded baseline also exposed a lead-clock recalibration between ordinary 16.6 ms frames. Recalibration discarded the drawn pose and jumped backwards 3.62 m. A lead recalibration now preserves that pose through the same bounded blend. Placement still places the body, and the clock calibration algorithm is unchanged.

The loaded full-suite gate later caught a third interaction on the 60 Hz server host: the next small reconciliation clipped the retained clock offset to the snap limit, causing a 127-pixel backward step. The limit now applies to the new correction while carrying the existing blend. A virtual regression with a small explicit limit fails with nine snaps on the intermediate implementation; it also verifies that a genuinely new ten-metre correction still snaps. The after batches and full gate streak were restarted after this change.

The original shaper was seeded (LCG, seed 417), but both directions and all sockets consumed one shared stream. Real scheduling changed which packet received each random decision. The matrix now uses independent seeded streams per connection, direction and message kind. Virtual time fixes packet order as well as loss/jitter. An interleaving test checks stream independence.

## Release gate and extended measurements

`npm test` includes the whole virtual-time delay/loss/host matrix: 20/30/60 Hz, server and browser hosts, 50/150/300 ms, 2%/10% loss, plus the 90 ms no-loss case and five extra seeds for the hardest case. It checks first-frame movement, forward and bounded displacement, authoritative pushes, stable clocks, and convergence to the host. A separate seeded dropped-input regression reproduces the old -0.105 m history-boundary reversal and requires catch-up to have occurred. A changed-input-delay regression exercises clock recalibration while drawing.

Four real-Chrome smoke cases remain: 20 Hz/server/50 ms/2%, 30 Hz/server/150 ms/10%, and 60 Hz/300 ms/10% on both hosts. Drawn direction and continuity are still asserted, including across recalibrations. First-draw response gates both suites; wall-clock latency thresholds remain in the extended suite. Real-time correction, catch and rebase counts are diagnostics; deterministic stable-clock tests own the rebase-count invariant.

`npm run test:rules:extended` includes all 37 original real-time Chrome cases, including the 90 ms action-latency measurements, alongside the existing extended rules corpus. No matrix case or motion bound was removed.

The first complete package-suite attempt also exposed an existing touch-test race: it compared a captured receipt with the mutable latest touch timestamp after more queued events could arrive. The fixture now records delivered receipts and checks that the captured receipt is one of those actual events. Direction checks and the 600 ms response limit are unchanged. This is a test correction, not a change to input handling. A subsequent package-suite attempt exposed another existing timing assumption: the MCP build test expected a synchronous result within the server's 20-second return window. It now follows the supported `studio_job` receipt to a successful terminal result with a bounded wait, retaining its build-content and feed assertions. The server's return window is unchanged. The traffic suite also measured 50.6 snapshots/s on a loaded 60 Hz host and failed its 90% wall-clock throughput threshold despite matching state, ordered effects and zero relay drops. That rate is now reported as a measurement. Six virtual-time cases require exactly one delivered snapshot per completed tick at all three rates and on both hosts, while every real-Chrome traffic scenario keeps its protocol assertions.

A local validation attempt also aborted in the deliberate worker-memory exhaustion test because the measurement driver's `NODE_OPTIONS=--max-old-space-size=1536` overrode that worker's 16 MB resource limit. The driver override was removed and the three-pass streak restarted with normal Node settings; this required no repository change. Failed attempts remain in the gate log below.

## Reproduction method

Each hardest-case session has two isolated Chrome contexts, real WebSockets, 12 seconds of calibration, 12 seconds holding forward input, then an authoritative push. Each baseline batch has 30 sessions. The loaded batches add four CPU workers and apply Chrome CDP CPU slowdown to both pages at 4x or 6x. Suites and batches run sequentially. The machine has 10 CPU cores and 24 GiB RAM; Node is 22.23.3 and Chrome is 155.0.8059.39.

The before/after comparison uses the original shaper and original drawing scale for both versions; only the predictor changes. The baseline predictor's SHA-256 is `eda7fa6882caeb5a4ba6009fd84a8516e13c48d41ceaae1d8cc20a22c06e2d3f`, identical to the failed release. Pixel evidence additionally replays consecutive recorded poses into Chrome canvases at 50 pixels/metre and measures raster alpha centroids.

The version remains 0.38.0. Only its changelog section gains a line; no tag is changed and nothing is deployed or published.

## Results

Each histogram is `value: number of sessions`; every row contains 30 sessions. Rebases and catches in this table are from steady movement; startup rebases and catches including the push are in the [full measurements](rooms-slice-6-release-measurements.json).

| Predictor / CPU | Corrections p50 / p95 / max | Rebase histogram | Catch histogram | Backward runs | Minimum step (m) | Raster step at 50 px/m |
|---|---|---|---|---|---|---|
| before / 1x | 0 / 11 / 14 | 0: 30 | 0: 23, 1: 6, 2: 1 | 3/30 | -0.078450 | -3.922 px |
| before / 4x | 0 / 11 / 19 | 0: 29, 1: 1 | 0: 22, 1: 8 | 2/30 | -3.616632 | -180.831 px |
| before / 6x | 0 / 16 / 24 | 0: 29, 1: 1 | 0: 20, 1: 6, 2: 4 | 3/30 | -3.734304 | -186.714 px |
| after / 1x | 0 / 11 / 13 | 0: 30 | 0: 23, 1: 7 | 0/30 | 0.019241 | 0.961 px |
| after / 4x | 0 / 9 / 21 | 0: 30 | 0: 22, 1: 8 | 0/30 | 0.019800 | 0.988 px |
| after / 6x | 0 / 12 / 17 | 0: 29, 1: 1 | 0: 23, 1: 7 | 0/30 | 0.000000 | 0.000 px |

The original predictor reversed in 8 of 90 sessions. The fixed predictor reversed in 0 of 90 sessions. Both targeted virtual regressions fail with the original predictor: the history boundary moves back 0.105 m; lead recalibration moves back 3.479 m. All 116 focused prediction checks passed with the final fix in 225.0 seconds; the 42-case virtual matrix took 104.2 seconds. The retained-offset regression also fails on the intermediate implementation (nine snaps), and confirms that a new ten-metre correction still triggers the snap limit.

Thirty-session batch times (normal / 4× / 6×): before 819.6s / 838.1s / 842.3s; final fix 828.2s / 828.7s / 835.8s.

## Gate runs

- `npm-ci`: exit 0, 14.6 seconds.
- `build`: exit 0, 0.7 seconds.
- `initial-npm-test`: exit 1, 902.8 seconds. Prediction Chrome file: 127.5 seconds. pass 2218, fail 1, skipped 5.
- `port-input-focused`: exit 0, 14.1 seconds. pass 3, fail 0, skipped 0.
- `mcp-window-npm-test`: exit 1, 1071.0 seconds. Prediction Chrome file: 129.7 seconds. pass 2216, fail 3, skipped 5.
- `mcp-focused`: exit 0, 37.7 seconds. pass 1, fail 0, skipped 0.
- `heap-override-pass`: exit 0, 1124.7 seconds. Prediction Chrome file: 127.9 seconds. pass 2225, fail 0, skipped 5.
- `heap-override-failure`: exit 1, 944.2 seconds. Prediction Chrome file: 124.6 seconds. pass 2221, fail 1, skipped 5.
- `pre-cap-npm-test-1`: exit 0, 873.4 seconds. Prediction Chrome file: 115.3 seconds. pass 2225, fail 0, skipped 5.
- `pre-cap-npm-test-2`: exit 0, 1031.2 seconds. Prediction Chrome file: 123.7 seconds. pass 2225, fail 0, skipped 5.
- `pre-cap-npm-test-3`: exit -15, 454.4 seconds.
- `npm-ci`: exit 0, 9.5 seconds.
- `build`: exit 0, 0.5 seconds.
- `npm-test-1`: exit 0, 826.4 seconds. Prediction Chrome file: 120.5 seconds. pass 2226, fail 0, skipped 5.
- `npm-test-2`: exit 0, 851.4 seconds. Prediction Chrome file: 119.0 seconds. pass 2226, fail 0, skipped 5.
- `npm-test-3`: exit 0, 1076.4 seconds. Prediction Chrome file: 123.1 seconds. pass 2226, fail 0, skipped 5.
- `plugin`: exit 0, 104.8 seconds. pass 120, fail 0, skipped 1.
- `validate`: exit 0, 1.9 seconds.
- `desktop`: exit 0, 65.9 seconds.
- `changelog`: exit 0, 0.1 seconds.
- `publish-check`: exit 0, 45.2 seconds.
- `extended`: exit 0, 1008.0 seconds. Prediction Chrome file: 1007.4 seconds. pass 165, fail 0, skipped 0.
