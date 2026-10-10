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
