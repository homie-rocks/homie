# Round 7 follow-up — NOT READY

This follows the independent review of toolkit `5ab00fca` and studio `a18931bc`.
The requested final-head, full paired matrix is **not complete**. Slow-phone performance remains unproven, and the latest low-lag trial still has more shallow observer overlaps than live. Do not replace live from this receipt.

Control: detached studio main `038fdb0`, published toolkit **0.53.0**, served from frozen runtime and assets on port 8792. Candidate: `arcade-server-rules` at `924076a`, published **0.53.0** plus the checked-in PR #116 overlay, frozen on port 8791. No package version bump, merge or deployment.

## Changes

1. **Stomps:** player snapshot rows carry the last accepted owner-input tick. `room.confirmedTick` reads it from the sampled authoritative scene only when the epoch and placement revision match the owner. Tiny Platformer holds a speculative monster hide until that scene confirms/refutes the contact or a new monster lifecycle begins. Merely reaching the wall tick no longer releases the hide.
2. **Observers:** accepted owner ticks feed a separate adaptive 50–250 ms buffer at 20 Hz. Arrival timestamps map the stream onto the viewing clock. The buffer consumes fresh reports directly, avoiding a second pass through the shared scene delay. Catch-up travel is bounded to 1.4 tiles per drawing for this runner; actual placements still cut at the shared scene's revision boundary.
3. **Server stalls:** movement credit includes elapsed server wall time, so delayed callbacks do not reject continued valid input. Every accepted move still runs guarded canonical physics, duplicate ticks grant no travel, and processing remains bounded to eight reports per step. Receive/report queues retain up to 256 ticks.
4. **Phone:** reuse an identical guarded forecast at its commit tick; isolate preview motion; reuse immutable entity descriptions; skip off-camera runner rasterization; cache label widths; merge adjacent same-colour map rectangles; skip the game's no-op preview contact scan. Canvas resolution and game physics are unchanged. These changes are not yet proven to meet the phone gate.
5. **Upgrade:** the studio pins 0.53.0. `postinstall` applies an exact patch over that release and stamps its runtime identity. The overlay preserves published 0.53.0 changes, including bodyless participants. A clean `npm ci`, a second idempotent application, and a byte comparison against the active patched runtime pass.

## Measurements and their scope

The user's pt7 tools (`cmp6`, `phone`, `ana4`, `fair`, `mflick`, `tele`, `sstall`) supplied the driving and analysis. GPU Chrome pairs ran side by side. Load was sampled every five seconds; any peak above 25 invalidates the whole pair. Earlier runtime/asset reload attempts are also excluded.

**Current build:** frozen runtime `9e81a002769740d5c07d45ab`; `fresh-l0`, about 62 seconds, three players with the third as onlooker, peak load 19.37.

| Measurement | Candidate | Live |
| --- | ---: | ---: |
| Onlooker steps >3 tiles, excluding spawn cuts | 0 | 3 |
| Onlooker side passes / deep passes | 3 / 0 | 1 / 1 |
| Owner solid frames / jumps / slides / stalls | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Frames >33 ms / >50 ms (desktop, not phone) | 2 / 1 | 0 / 0 |
| Eligible stomp disappearances | 0 | 1 |

This single current-build run is insufficient to prove the stomp fix or the full low-lag fairness gate.

**Earlier development builds, not final-head acceptance:**

- Six load-valid pairs retained here show **0 reappearances / 8 disappearances** on the candidate versus **0 / 3** on live. These cover the acknowledgement-based hide but precede the final buffer and rendering refinements.
- `stall-final`: three 3-second server pauses, peak load **20.18**. Owner jumps **0 versus 2**; slides **0 versus 3**, live maximum **23.97 tiles**. Observer >3-tile steps **0 versus 5**. The later fresh-report buffer change has not yet repeated this browser trial; targeted stall and bounded-catch-up tests pass.
- Last load-valid 180-second CPU×4 phone pair (`phone-5`, peak **18.85**): >33 ms **13 versus 4**, >50 ms **3 versus 1**, p99 **20.8 versus 20.3 ms**. This **fails** and predates the final forecast/description/map optimizations.
- Subsequent phone pairs exceeded load 25: peaks **48.53**, **46.79**, and **57.27**. The latest (`fresh-phone`) also lost the candidate frame before writing a complete receipt. They cannot establish a performance improvement. Other invalid attempts and their loads remain in `batch.log`.

## Checks

- 308 view tests pass in five non-overlapping batches. Two later regressions also pass: fresh owner reports bypass the shared buffer, and old placement snapshots cannot acknowledge current contacts. The focused remote/placement/stall tests pass after those changes.
- 19 owner-validation tests and all 44 studio tests pass. Earlier collision/hostile/probe compatibility checks pass.
- Strict full studio build passes: 18,000 generated-play ticks and 813 restore comparisons. Toolkit TypeScript build and runtime identity check pass.
- Original studio tests and physics remain unchanged.

## Remaining work

Run the full current-head paired matrix in a quiet window: repeated stomps and low-lag fairness, 80/300 ms plus jitter/loss, 2/6/15-second outages, background/freeze, eight players, fast/slow clocks, lag-switch fairness and catch-up, five minutes of sustained play, three feel batches, controls, reload, rounds, and forged reports. Repeat the 180-second CPU×4 phone test and fix any remaining regression. Earlier passes are not substituted for these missing current-build checks.

The retry loop was stopped after sustained shared-machine contention repeatedly exceeded the user's load ceiling. No acceptance conclusion is drawn from rejected runs. Full local traces and orchestration remain in `/tmp/pt8`; selected load-valid traces and analyzer outputs are committed beside this receipt. The supplied harness lives under the user's pt7 `tp` directory. For example:

```sh
GPU=1 node "$P/cmp6.mjs" --base http://127.0.0.1:8791 --tag b-example --only shape --skip-presses --delay 0 --seconds 60 --obs3 --out /tmp/pt8/runs
# Run the matching control concurrently on 8792, monitor load, then:
node "$P/tele.mjs" 3 /tmp/pt8/runs/b-example-lag0-loss0-jitter0-frames.json.gz
node "$P/mflick.mjs" /tmp/pt8/runs/b-example-lag0-loss0-jitter0-frames.json.gz
```
