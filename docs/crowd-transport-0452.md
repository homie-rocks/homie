# Crowd transport investigation (provisional 0.45.2)

This is an investigation, not a Cloudflare capacity claim. The owner's phase-B
trial remains the cloud baseline. Its generic 1012 close messages do not establish
which upstream operation failed. No trial deployment has been performed here.

## What the source and tests establish

- 0.45.0 already batched multiplex traffic (5 ms / 128 rows); it did not make one
  RPC per player per tick. Inputs already used that batch path. The patch adds
  receipt flow control, bounded reliable queues and replaceable unsent snapshots.
- Per-player interest selection, delta generation and serialization ran at the
  Table. Absolute snapshots now cross each link once per shared snapshot group;
  Gates encode the individual views after coalescing. Immutable entity fragments
  and ordered candidates for each interest cell are shared within a Gate.
- Far-view refreshes previously aligned every player on the same tick. They are
  now phased by seat: the deterministic 1,000-player / 5 Hz case refreshes 250
  players on each of four ticks instead of 1,000 on one tick. The per-player
  rate, exact controlled state, immediate arrivals and immediate exits remain.
- A multiplex session's single attach chain blocked other players behind a slow
  admission. Logical clients now have independent ordered chains. Large welcomes
  wait for reliable-queue capacity. The virtual-time thousand-welcome test keeps
  established inputs moving while the link is blocked.
- The five-second Table hello deadline started before public-handshake/relay
  transit finished. Logical creation now travels with the first public frame;
  the public Gate still bounds a client that sends nothing. A virtual-time test
  covers this distinction without extending the idle deadline.
- Roster labeling rebuilt/scanned the live list twice per row. At 1,000 seats the
  deterministic count fell from 2,000 scans to one. An isolated 20-sample benchmark
  measured median 26.14 ms before and 0.254 ms after (p95 171.53 / 1.34 ms).
  Wall-clock results were affected by concurrent machine work; operation counts
  are the stronger evidence. Checkpoint filtering also uses a reserved-seat set.
- The overrun guard could blame paired late callbacks despite maintaining the
  requested throughput. It now also requires sustained throughput below 90% of
  the requested rate. Virtual-time tests retain termination for genuinely slow
  ticks and accept paired callbacks that maintain 20 Hz.
- There was no busy-link watchdog in 0.45.0 to tune. Public links use accepted
  WebSockets, not hibernatable sockets. There is no awaited I/O in the rules tick;
  synchronous durability writes remain. Relay admission checkpoints and reports
  are coalesced, without changing direct-operation durability semantics.
- A downstream send exception was already isolated to that client in 0.45.0.
  That candidate is ruled out as a newly repaired cause. Regression coverage
  preserves it. New upstream-loss logs include layer, reason, code and queues.
- The Table applied player rate windows to batch delivery time. A held 10 Hz
  stream could therefore exceed its unchanged 60/s cap when delivered together.
  Trusted Gate ingress timestamps now survive fan-out and Concentrators; the
  Table uses those monotonic timestamps for the same rate window. Tests deliver
  100 delayed inputs without drops, still reject the 61st simultaneous input,
  reject backward-clock window resets and ignore a player's JSON timestamp.
- A 1,000-seat manifest selects 16 Gates, two Concentrators and a Table regardless
  of current occupancy. Duration estimates now count all 19 objects; request
  estimates explicitly exclude unmeasured internal traffic. No account plan is
  inferred from the deploy estimate.

The tests establish these code paths and fixes; they do not retroactively prove
that any one of them caused every original cloud symptom.

## Reproduction

Run from the repository root with Chrome installed:

```sh
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  RULES_EXTENDED=1 node --test packages/studio/test/rules-cloud-extended.mjs
```

`npm run test:rules:extended` includes this case. `CROWD_BASELINE=1` substitutes
0.45.0 server sources from `b04e6a714c71dfaa046e0ce9be3f97871e4bf62b` while holding
the frontend/driver codec constant. This is a server comparison, not a full
0.45.0 installation comparison. Each case makes a fresh studio build.

The fixture contains the unchanged game and driver. Driver SHA-256:
`ae6ee5e335a5904abb3e7db68c12ffba41bbd0131340fb0eab1677d5a2e94bf5`.
Eight real workerd processes host the front Worker, Table, four groups of Gate
objects, and two Concentrators. Test-only HTTP stubs route inter-process object
addresses. Each ordered link injects 5 ms propagation and 1 ms/message service
cost; this is not a claim to emulate Cloudflare's scheduler or CPU accounting.

Cases use 300 simulated players plus two Chrome replicas, then 998 plus two.
N=1,000 plus two browsers exceeds the game's capacity. The ramp is 50 ms and the
steady measurement is 60 seconds. Assertions require all clients to remain,
received-frame median at least 19.5 Hz, correct browser membership and ack p95 at
most 174 ms (150 ms plus four injected hops). Tick progression alone is not a
pass. The unchanged driver's ack includes its intentional three-tick input lead.

The harness prints artifact paths and saves reports, browser screenshots, driver
logs and server logs. Metadata records source bundle hash, HEAD, driver hash,
Node version and process count. Concurrent local builds and driver event-loop
lag are material confounders; the test is not relaxed to hide them.

## Recorded failures before the cell-candidate optimization

Fresh comparison at `61e80f55`, October 10, 2026:

| Server | Simulated N | Joined / live at end | Delivered median | Ack p95 |
| --- | ---: | ---: | ---: | ---: |
| 0.45.0 server baseline | 300 | 300 / 0 | no valid steady interval | unavailable |
| 0.45.0 server baseline | 998 | 262 / 259 at cleanup start | admission failed | unavailable |
| Patched, before shared cell candidates | 300 | 300 / 300 | 16.82 Hz | 432 ms |
| Patched, before shared cell candidates | 998 | 636 / 181 at cleanup start | admission failed | unavailable |

Both baseline cases ended on overrun. The patched 300 case maintained 20.01 Hz
*Tick progression*, but failed actual frame delivery and latency; driver loop
p99 was 251 ms. The patched 998 case ended before steady measurement. These are
failures, not a successful handoff. Artifact suffixes respectively: `WYnKTD`,
`P7lMqp`, `Abzq0E`, `LK8ASK` under the system temporary `homie-crowd-proof-*` paths.
The subsequent cell optimization shares ordering work once per cell; its
regression test verifies exact per-player radius membership and snapshot order.

## Isolated Linux follow-up

The Actions reproduction runs separate local workerd processes on a four-vCPU
AMD EPYC runner, with Chrome under Xvfb. It does not deploy to Cloudflare.
At `ae46962e`, run 38071793253 failed both strict capacity cases:

| Case | Joined / live at end | Delivered median | Ack p95 |
| --- | ---: | ---: | ---: |
| 300 simulated + 2 Chrome | 300 / 300 | 15.30 Hz | 397 ms |
| 998 simulated + 2 Chrome | 932 / 4 | no valid steady interval | unavailable |

The 300 case kept 20.01 Hz tick progression. The 1,000-total case ended on host
overrun during admission. An earlier isolated attempt at `4e66560b` delivered
11.04 Hz / 887 ms at 300 and admitted 678 at the larger size. That first workflow
incorrectly masked the failing test's exit code through `tee`; explicit Bash
pipefail now makes capacity failure fail the check. No package was made from it.

A separate 300-player diagnostic profile at `ae46962e` found the Node Miniflare
controller idle for 91.49 of 92.62 seconds. The unchanged driver's 82.02-second
profile attributed 28.78 seconds to its message callback, 15.38 to garbage
collection, 6.78 to decoding and 16.66 to idle time. Callback line samples mainly
hit JSON parsing and the driver's payload-size serialization. This rules out a
busy Node controller in that run; it does not prove the driver alone caused the
server-side delivery gap. Workerd profiles and transport samples are available
with `CROWD_PROFILE=1` for the next diagnostic pass. Profiling is separate from the
strict capacity measurement and does not change the driver.

## Allocation follow-up

A separate local workerd profile (`rDv1k6`, pre-change) located Gate samples in
field comparison, map construction and garbage collection. Of 24,422 Gate-0
samples, 6,367 were GC, 2,364 encoder work and 1,931 delta field comparison. The
Concentrator recorded 1,109 of 4,178 samples in batch serialization and 664 in
parsing. Workerd sample intervals vary while isolates are inactive, so these
counts are not reported as synchronous execution milliseconds.

Tuple fields now compare directly instead of allocating JSON for each field,
and chained encoders reuse their private row map. Full shared snapshots are
serialized once per isolate rather than separately for every downstream Gate
link. The wire format is unchanged. Deterministic tests verify zero field
serializations for a 1,000-row numeric delta, exact reconstruction and one state
serialization across eight links. A six-repeat 64-view/200-entity/120-tick
microbenchmark fell from median 0.576 seconds to 0.315 seconds on this
machine; it is not a capacity result. Both capacity cases still require a fresh
run after this change.

The initial receipt implementation also imposed stop-and-wait: at 80 ms receipt
RTT it delivered only 50 of 80 offered snapshots in four seconds (12.5 Hz).
The bounded four-frame pipeline delivers all 80 (20 Hz) in the same virtual-time
case. Outstanding frames share a 4 MiB byte budget, reliable order is preserved,
duplicate receipts do not free capacity twice, and a minute-long stalled link
retains only four in-flight frames plus the latest unsent view per player.

## Pipelined local run

With the allocation fixes and four-frame pipeline, a local Node 22 run passed
300 simulated players plus two Chrome replicas: 300/300 live, delivered median
19.95 Hz, ack p95 163 ms against 174 ms including injected link delay. The
300 case began just before commit `07516563` was recorded (its metadata therefore
names `35243353` with the pipeline still in the working tree); its worker bundle
hash is retained. The following full-room case at `07516563` admitted 897 before
host overrun, so this is not a completed handoff.

An unchanged-driver Node 24 diagnostic hit its default 512 MiB RSS limit at 522
clients. A separate diagnostic using its supported `--rss-mb 1024` option admitted
all 998 simulated clients plus the two Chrome players and retained all of them,
with no errors or disconnects. Delivery still failed: 11.07 Hz median and
1,817 ms ack p95. The client peaked at 764 MiB RSS and 652 ms loop p99. This driver
resource experiment did not change game settings, offered traffic or acceptance
thresholds. `CROWD_DRIVER_RSS_MB` exposes that diagnostic option; the reproduction
default remains 512 MiB.

A subsequent allocation change reuses private interest/encoder records across
frames, avoids a WeakMap per entity comparison, avoids a Map for the common
single-precision case, and removes decoder update-pair allocations. The wire
bytes remain identical in the 64-view/1,000-entity/120-tick six-repeat benchmark:
62,668,998 bytes for both implementations. Median encoding time fell from
466 ms to 325 ms. Capacity remains unproven until the next run.

## Diagnostics and approval

Room and office telemetry expose bounded per-stage samples, per-Gate view/encode/
send timings, queue depths, receipt latency and coalescing. Cloudflare freezes
synchronous runtime clocks; unavailable execution duration is explicitly marked,
not presented as zero CPU. Aggregate platform CPU is not relabeled per-tick time.
Browser telemetry distinguishes server, browser, disconnected and offline sources.
The missing measurement guide is included in the package.

Deploy hooks recognize a trusted owner's natural-language deploy request as
approval for that task and its retries. Explicit refusals revoke it; quoted or
reported requests do not grant it. Unrequested deploys remain held. The trial
studio's existing approval hook was not bypassed.
