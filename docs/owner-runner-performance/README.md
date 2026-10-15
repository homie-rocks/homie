# Owner runner performance — 15 October 2026

**NOT READY.** The load gate is now ≤25 at the start of each paired batch. Measurements ran against detached live studio `75b280cfb7f4d03d8d5f695f38b42b3c29cc5385`, concurrently on this shared Mac. Phone frame time and observer catches still fail the requested ≤live targets. No version bump, merge or real-studio deployment occurred.

Toolkit starting head: `bd7af172`. Studio base: `1d62525`; retained studio WIP commit: `71c6923` (Ryan Campbell, signed off). The previous blocked runs are preserved in [history](history-through-bd7af172.md). The limits below supersede their load-8 gate.

| Item | Branch vs detached live | Verdict |
| --- | --- | --- |
| 4× CPU phone, 180 seconds, retained code | **15 vs 11** frames >33 ms; 10,821 vs 10,823 frames; >50 ms **5 vs 5** | Fails target |
| Cloudflare, eight active players each, ten minutes | **0 vs 0 observed overruns**, all 16 online at completion | See Cloudflare section |
| Zero-delay jump feedback p90 | **30.4 vs 32.6 ms**, 11 accepted jumps each | No regression in this pair; not a statistical guarantee |
| Observer catches with no drawn monster nearby | **21 vs 6**, five paired trials, 310 seconds per build | Fails target |

The phone pair used the retained probe change and unchanged contact geometry. The catch pair used the same gameplay rules before the probe lifecycle fix. The final latency pair included an experimental contact inset subsequently reverted; latency has not been rerun after that revert. An earlier pair without the inset measured **32.7 vs 40.7 ms** zero-delay p90 (12 jumps each). These are distinct builds, not a claim that every number came from one final binary.

## Changes and rejected experiments

The existing bounded host catch-up work remains: up to four ticks per slice, an 8 ms yield on advancing clocks, retained backlog, and coalesced intermediate ephemeral snapshots. Scheduler pauses do not count as sustained slow execution; fault and instruction-budget guards still bound runaway work. The inherited studio spatial broad phase, patrol reuse and stationary-endpoint contact fix remain. All accepted reports still receive exact contact checks, with the existing 150 ms history cap.

This continuation fixes a probe lifecycle bug: a game's rich probe replaced the default probe but left its animation-frame sampler alive, continuously reading and retaining old history. Replacement now retires that sampler. A behavioral test proves one remaining sampler, frozen old history and fresh dynamic metadata. Metadata enumeration also avoids allocating an entries array. This is a redundant-work fix; the measured frame time and GC do **not** establish a performance win.

| Paired 180-second phone attempt | >33 ms branch / live | Disposition |
| --- | ---: | --- |
| Inherited WIP baseline | 10 / 9 | Baseline |
| Deferred wire-row allocation | 16 / 9 | Reverted |
| Stable prediction slots | 23 / 5 | Reverted |
| Skip empty preview contacts | 9 / 6 | Reverted |
| Reuse matching preview at commit | 16 / 7 | Reverted |
| Retire obsolete probe sampler | 15 / 11 | Retained lifecycle fix; target still fails |
| Probe plus six-pixel contact inset | 94 / 91 | Inset reverted; shared load rose to 36.27 |

The inset reduced phantom catches from 21/6 to **18/9** in a separate five-pair batch, still failing the target. More importantly, it broke the existing eight-runner event-timing parity test (41/42 studio tests). It was reverted rather than weakening that test. The restored suite passes **40/40**. Stomps and the 150 ms history cap are unchanged. The remaining observer mismatch is unresolved; these measurements do not prove a single root cause.

Real GPU Chrome and CDP CPU throttling/profiling were used. Baseline branch GC totaled about **734 ms vs 324 ms** live over 180 seconds; the retained probe attempt was about **741 vs 350 ms**. The profiles still show substantial extra presentation, entity wrapping, prediction and report work. These are individual concurrent pairs, not six alternating pairs or significance-tested improvements. No attempt is discarded merely for an unfavorable result.

## Loads and local guards

All paired batches started together once the one-minute load was ≤25; later shared-machine increases were recorded and the tests continued together.

- Retained phone pair: start **14.217**, range **11.893–17.627**.
- Final inset phone attempt: start **14.569**, maximum **36.270**. It recorded 94/91 long frames and 9/1 unexplained jumps; it is not evidence of preserved smoothness.
- Five catch pairs on retained geometry: recorded range **7.083–15.323**.
- Final latency batch: waited at **27.015**, started at **19.153**, maximum **28.833**. Zero-delay run feedback p90 was **29.6/31.1 ms**. At 150 ms injected delay, jump p90 was **30.7/32.5 ms** (12/8 accepted jumps); run p90 **25.7/30.0 ms**.
- Retained phone pair: no solid penetration, correction slides, or stalls; one unexplained jump each; one socket each.
- Retained-geometry catch pairs: deep observer pass-throughs **2/9**, own deep side pass-throughs **2/14**. Better pass-through counts do not excuse excess catches.

The final concurrent focused 64-report CPU fixture started at load **7.235**, ended **7.776**. Current all-path contact rules: median **0.708 ms**, p95 **5.610 ms**; older `9240a05` contact rules on the same current core: **0.731 ms**, p95 **4.297 ms**. Both had zero held reports and rule errors. Peak metered units were **46,872 / 39,317**. This is **not live browser-host CPU** and is not a robust speedup claim: an earlier concurrent pair measured 1.181/1.064 ms median and 6.785/5.241 ms p95.

## Cloudflare

Cloudflare was tested before any local measurement in this continuation. Both throwaway Workers use isolated Durable Objects, no production routes, no real-studio database or AI binding, and names ending in `-perf-test`.

The first attempt was invalid: the detached live site's canonical redirect briefly sent its test room to the real studio. It was stopped, both temporary Workers deleted, and preview isolation corrected. No production deployment occurred. The corrected harness asserts the page remains on the intended test origin.

The first completed pair ran eight active players for 600 seconds each with **no observed overrun**; all 16 clients remained online at completion and rounds continued. It started at load **8.629**, peaked at **25.685**. Its measured windows were offset by **100.827 seconds**, so a final run adds an explicit shared start barrier. The initial run's available server tick samples reported zero errors/budget stops, peak 13,055 metered units. Tail coverage is incomplete for long-lived Durable Object requests. Cloudflare tick CPU milliseconds were unavailable or below clock resolution; no Cloudflare CPU-millisecond comparison is claimed.

Final synchronized run: **600 seconds per room**, starting at **07:15:53.504 / .505 UTC** (1 ms apart), with eight active players each. Both completed in round 5, all 16 clients online, no observed overrun. Branch clients sent 12,867–13,170 messages each; live clients 10,971–12,360. Final reconnect counters totaled **1 vs 8**; this is not a claim of uninterrupted connections. Neither main-player nor crowd browser logs recorded errors. Available branch tail samples: **12**, zero rule errors, zero budget stops, peak **31,351** tick units. Tail outcomes also contain **1/10 `exception`** records without exception details and disconnected/canceled streams; these are retained and not represented as a clean error-free server trace.

Process start load was **6.789**, the last reading before the shared measurement start **8.893**, maximum **31.223**, final **15.366**. The barrier itself checked load ≤25. Both Workers were successfully deleted: `homie-arcade-runner-1014-perf-test` and `homie-arcade-live-1014-perf-test`. [Compact results](continuation-25/cloud-synchronized-summary.json) and [load receipts](continuation-25/cloud-pair-synced25.log) are saved with both deletion receipts.

Two preceding synchronized attempts failed during initial seating (branch at 60 seconds, then control at 180 seconds). Neither began measurement; their peers were stopped and both Workers deleted each time. The harness copy now retries an unseated setup page and captures errors; the successful run needed no setup refresh. The original harness remains unchanged.

## Verification and artifacts

- Toolkit build and strict Tiny Platformer build passed.
- Final restored studio suite: **40/40**.
- Probe replacement behavior: **1/1**.
- Focused host overrun/backlog/suspension/production-adapter checks: **6/6**.
- Earlier intermediate optimization checks are not presented as tests of retained code.

Original pt6 harness files were untouched. Copies, raw frame traces, Chrome profiles, load logs and receipts are in `/tmp/owner-perf-round`; detached live is `/tmp/owner-perf-live`. Compact evidence is stored alongside this report. Only this task's processes are stopped during cleanup.

Remaining work is substantive: achieve phone parity and eliminate the excess observer catches without regressing event timing, then remeasure all final gates. The branch must not be described as ready or merged on the strength of the successful ten-minute survival or latency measurements.
