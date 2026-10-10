# Rooms milestone 2: releasable slices

0.44.0 is slice 1, **spatial state delivery**. It is useful independently in an
existing server-hosted room: the studio chooses `room.view.radiusM` in game.json,
and a player's view receives nearby entities and its own body. Unchanged state
is compressed as deltas. No change to rules or movement is needed. `room.each`,
`enter` and `leave` describe the visible set, so a view must dispose of departed
meshes and recreate returning ones. Leaving view does not mean despawning.

This first PR does not claim that the public join/build path admits hundreds.
That path retains milestone 1's 32-seat restriction until slice 2 supplies Gates
and removes it. The simulation and relay now handle a 300-seat test directly,
without a simulation seat clamp or truncated rosters/control rows. This is the
foundation for the next slice, not a substitute for its admission and transport
proof. No deployment or merge was made.

## What ships first

- `room.view.radiusM`: a studio-selected radius in metres, including z in 3D.
  Omitted or null means the whole room, with the existing small-room path and
  no extra per-client encoding. Zero means only colocated entities. No default
  radius, downstream budget, spend limit, or crowd admission policy is imposed.
- The real relay filters both ongoing snapshots and join/rejoin welcome state.
  A player with no body yet sees no entities. Watchers retain the whole-room
  overview in this slice; following a camera does not restrict their feed.
- Each connection retains one keyframe. Deltas carry changed entity components,
  new entities and explicit removals, against that keyframe. They carry the
  current round and only the receiving player's input acknowledgment/control row.
- A keyframe at least once per simulation second, and a fresh one at every
  connection or epoch change. Backpressure skips snapshots without advancing the
  encoder. A missing intermediate delta cannot corrupt later updates. A lost
  keyframe causes deltas to be ignored until the next keyframe, at most one
  simulation second later. WebSocket itself is ordered and reliable.
- Saving and host recovery still use complete authoritative state. Filtering
  never changes simulation, collision, queries, scoreboards or shared state.
- Seeded, virtual-time correctness in `npm test`; the long 300-client run is in
  `test:rules:extended`. The pre-existing 12-scenario real-time traffic matrix and
  27 handover repetitions move there too, with all assertions retained. The gate
  keeps two actual-browser cases (tab hiding and socket closing); virtual time
  covers the rate/seed/handover matrix. No wall-clock throughput threshold is a
  release gate.

Interest is a bandwidth feature, **not hidden information**. Shared state,
effects, roster and watcher overview are still public. Private fields and tells
arrive together in slice 3. Browser hosting continues to send complete state;
requesting a radius there produces a build diagnostic. The existing starters
need no contract rewrite for slice 1 and keep their whole-room views.

## Design decisions and departures

The roadmap's sections 5, 6, 7, 10 and 23 are the starting point. Milestone 1
already separates the host, core, transport-free relay and view. We reuse those
roles instead of first splitting Table into new abstractions or declaring empty
Durable Object classes. Gate and concentrator classes arrive together in slice 2,
when they can actually carry connections and their deploy can be tested.

Interest/deltas precede Gates: doing this work in the existing relay gives a
shippable feature and a measurable role to move. The codec is independent of
Cloudflare and does not introduce a second runtime or contract profile. A small
game continues to see the match contract without `uses` or `profile` boilerplate.

Deltas name periodic keyframes rather than retaining an acknowledged history
per player. One baseline bounds memory, intermediates may be skipped safely, and
reconnect always starts fresh. This trades retransmitted changes and up to one
simulation second of recovery after a lost keyframe for a much smaller protocol.
It is not the roadmap's final bandwidth scheduler; near/far tiers, priorities,
short IDs, watcher follow feeds and shared far encodings remain slice 3 work.

The roadmap's default 96-metre visibility radius, default crowd cap from S6,
per-client bandwidth budget and guest-address cap are not defaults we will
adopt. They contradict the owner's no-imposed-limits rule. Studios may choose
limits explicitly. Cloudflare limits and measured capacity are reported as
information, never turned into a Homie admission ceiling.

## Local proof

The workload uses the checked and guarded rules loader, real host runtime and
NetRoom relay, with 300 simulated WebSocket clients, one actual player body per
seat, 20 Hz seeded inputs, a 20-by-15 grid at four-metre spacing and a chosen
12-metre radius. Each player moves at up to 2 m/s and increments a field each
tick. All 300 input acknowledgments, own bodies and roster entries are checked;
there are no rules errors or cut ticks. The fixture explicitly chooses a
5,000,000-unit tick budget; this is not a new default or a general game capacity
claim. Warmup is 20 ticks. Clients keep one baseline and latest state, not a log
of every received frame.

Measurement includes input dispatch, rules, encoding, serialization and all 300
clients parsing and decoding in the same Node process. Memory is peak sampled
whole-process heap/RSS, including the harness and rules loader, not isolated
server memory. Bytes count all downstream frames during the measurement window,
including snapshot JSON and pings; WebSocket/TLS framing is not included. These
are **local numbers, not Cloudflare measurements**, not Internet latency, and
not a rendering or physical-phone capacity result.

Measurement command:

```sh
node --input-type=module -e 'import {interestWorkload} from "./packages/studio/test/rules-interest-workload.mjs"; console.log(JSON.stringify(await interestWorkload({ticks:1200,measure:true}),null,2))'
```

Observed on macOS arm64, Node 22.23.3, 1,200 measured ticks (60 seconds of
virtual play), plus 20 warmup ticks. Other local verification was running; CPU
timings are observations, not a throughput guarantee.

| Measurement | Local result |
| --- | ---: |
| Clients / tick rate | 300 / 20 Hz |
| Peak visible bodies for one client | 33 |
| Tick including relay and all client decoding, p50 / p95 / p99 | 14.88 / 21.04 / 25.41 ms |
| Largest measured tick | 31.98 ms |
| Downstream per player, mean / highest | 23,171 / 29,117 bytes/s |
| Peak sampled whole-process heap / RSS | 133,426,952 / 238,764,032 bytes |

This does **not** meet the roadmap's eventual 16 KB/s target. Tiers, priority and
shared encodings in slice 3 have work to do; no target was weakened or represented
as passed. All 300 clients are simulated, not 300 browser tabs or Cloudflare
connections.

## Release verification

- Focused codec, relay and rules tests: 20 passed, no skips.
- Real view client on virtual time: 189 passed, including the new spatial
  delivery/lost-keyframe/reconnect case. Existing Chrome rendering smoke tests
  run in the root gate; this slice adds no rendering-specific browser case.
- Plugin: 123 passed, one optional live-URL fixture skipped.
- Plugin validation, packed Desktop server and release preflight passed;
  preflight lists studio 0.44.0 as the sole new npm version.
- Template and history generation, changelog sync/check completed.
- Root `npm test` runs with `CHROME_PATH` pointing to local Chrome. Final root
  results and all six CI checks are tracked on [PR #83](https://github.com/homie-rocks/homie/pull/83).
- A same-role reconnect now delivers its welcome snapshot to the rules view,
  even though no role-change event fires. The regression blocks later periodic
  keyframes and verifies that welcome-based deltas advance the view immediately.

## Remaining slices, in order

Each is a separate releasable commit series/PR after its predecessor is released.
Only slice 1 is implemented and proposed for release in this worktree.

1. **0.44.0 — spatial state delivery**, above. Proof: codec oracle, real views
   on virtual time, loss/reconnect, and 300-client host/relay workload.
2. **Gates and bigger public rooms.** Add Gate/concentrator classes together,
   reuse the delivery role, batch input and preserve commands, signed room passes,
   resume/revocation, and automatic layout from `players.max`. Remove public seat
   caps, make guest policy studio-selected, report tested size in build/deploy
   plans. Prove 300 clients through the actual join path, Gate restart/resend,
   20 Gates through concentrators, and small rooms without extra objects. Retire
   the legacy netplay authoring/build path and port host helpers here, updating
   port tooling, fixtures and starters in the same release; rules plus view is
   the sole game design, including the existing browser/offline mode.
3. **Private and scheduled delivery.** Field `see`, reliable one-player `tell`,
   near/far tiers, optional studio-chosen downstream budget and priorities,
   watcher follow/region and overview feeds, crowd rendering guidance/helpers.
   Update starters where these capabilities apply. Prove no owner/server field
   reaches another player's bytes, tells survive reconnect once, boundary
   enter/leave and fairness under a chosen budget; measure a dense crowd and
   rendering in real browsers. A view leaving interest is not evidence of privacy.
4. **Crowd policies and vehicles.** Studio-selected `crowd.cap` with queue/hold,
   soft event work scheduling without dropping work, `uses`, solid bodies,
   attach/control/detach and driver prediction. Prove cap absent means no imposed
   cap; explicit queues/holds release correctly; four-person vehicle prediction,
   seat contention, disconnect and restore. Ship one vehicle example and update
   the skill in the same slice.
5. **Large worlds' files.** Extend existing studio-owned R2 asset serving to game
   files over 25 MiB and multipart upload; streamed map chunks, zones, compiled
   triangle meshes and navigation. Reuse the existing upload/build machinery.
   Prove large asset integrity, interrupted/resumed multipart upload and map
   streaming with the same collision data on server and client.
6. **Milestone proofs and authoring tools.** Single-machine swarm CLI, match kit,
   cross-browser-engine movement hashing, S6 at 20/60 Hz and multiple regions,
   S11 transport assessment, dense crowd tuning and remaining authoring trials.
   Local correctness stays seeded/virtual; long runs stay extended. The roadmap's
   300-bot, 30-minute Cloudflare exit test, Gate recovery latency, physical phone
   rendering and actual billing need a separately authorized deployment/device
   session. No local receipt here is represented as those results.

## Slice 2 implementation work (0.45.0, local worktree)

This section is an implementation record, **not a completed release receipt**.
The old authoring/build/port path has not yet been retired. That remains a
release blocker for the requested coherent slice; it must not be deferred to
slice 3 while calling slice 2 finished.

Implemented so far:

- `players.max` is the single build size, read by public admission, compilation
  and deploy planning without the 32-seat clamp. Shared carrier addresses have
  no automatic player ceiling.
- Gate and Concentrator classes carry ordered, batched logical connections over
  binding-only links. Public authentication remains in the Worker. Small rooms
  embed the delivery role in the Table; larger layouts use one logical Gate per
  64 seats and concentrators above eight Gates. These are routing partitions,
  not admission limits. The template generates both bindings and migrations.
- Link loss closes downstream sockets for normal token-based seat resumption.
  Gates do not persist simulation or become a second authority. Gate passes are
  internal binding requests, not independently client-supplied authorizations.
- Ordered snapshot deltas, shared spatial indexing and cached wire rows reduce
  repeated work. Optional `precisionM`, `nearM`, and `farHz` schedule remote
  visual state; controlled bodies remain exact. Snapshot exits remain immediate.
- Revision 12 carries roster patches after a full welcome roster. A reconnect
  storm previously repeated full rosters to every player. The patch baseline is
  the last transmitted roster, separately from policy relabelling.

A candidate 300-player manifest (the game still needs appropriate arena,
spawning, rule cost and rendering):

```json
{
  "players": { "min": 1, "max": 300 },
  "room": {
    "host": "server",
    "view": { "radiusM": 12, "precisionM": 0.01, "nearM": 4, "farHz": 5 }
  }
}
```

The visual settings are examples, not imposed defaults or information privacy.
The workload explicitly chooses a 5,000,000-unit tick budget as in slice 1.

### Local measurements during implementation

All results below are **local**, not Cloudflare, billing, Internet latency or
physical-phone results. Bytes exclude WebSocket/TLS framing. Heap/RSS include
clients and the test harness in the same Node process. Other work on this
machine affects CPU timing; bytes are deterministic for the virtual workload.

| Workload | Players | Mean bytes/player/s | Tick p50 / p95 ms | Peak heap / RSS bytes |
| --- | ---: | ---: | ---: | ---: |
| Unmodified 0.44.0, 1,200 virtual ticks | 300 | 23,171 | 12.23 / 16.72 | 134,431,008 / 238,534,656 |
| Scheduled/delta delivery, 1,200 virtual ticks | 300 | 9,184 | 15.98 / 26.84 | 118,783,424 / 225,673,216 |
| Scheduled/delta delivery, 120 virtual ticks | 1,000 | 9,495 | 29.42 / 45.07 | 179,875,320 / 316,293,120 |
| Gate links, 4 Chrome pages, reconnect churn and host restore, before roster patches | 300 | 88,444 | 15.79 / 73.47 | 142,211,400 / 375,734,272 |
| Same mixed transport workload, with roster patches | 300 | 13,623 | 13.52 / 25.33 | 154,397,384 / 274,808,832 |

Steady-state downstream falls about **60%** at 300. The mixed transport result
includes recovery traffic and is not directly comparable to the steady-state
number. These two preliminary mixed runs did not declare game rounds; the
harness now declares a ten-minute round and checks that both failures preserve
it. Final mid-round receipts are still required.

The first 1,000-client mixed run failed seat continuity while joining under
heavy concurrent local load. No passing 1,000-client mixed receipt is claimed.
The harness now starts input/heartbeat processing before admitting the swarm
and yields between arrival batches; this correction needs a successful rerun.

The mixed harness uses the real Gate/Concentrator classes, the rules loader,
host and NetRoom, external local WebSockets and Chrome, with in-memory links
standing in for Durable Object binding links. It does **not** yet prove the
actual Worker public join route or workerd eviction. Those are release blockers,
not equivalent measurements. It also needs a 20-Gate recovery case.

Commands:

```sh
node packages/studio/test/rules-crowd-local.mjs 300 15
node packages/studio/test/rules-crowd-local.mjs 1000 15
node --test packages/studio/test/rules-gates.test.mjs packages/studio/test/rules-interest.test.mjs
```

The sustained, real-time 300/1,000 mixed runs live in `test:rules:extended`.
Virtual-time tests cover batching/order, 1,000 logical admissions, link cleanup,
spatial boundaries, quantisation, far scheduling and keyframe recovery.

Initial root `npm test`: 2,340 passed, 19 failed, 13 skipped. Failures identified
so far were generated template drift, new Worker exports, a round-stat regression,
and test environments missing the new Gate binding for small rooms. Template,
exports and statistics are corrected; the small-room path now embeds the Gate
role as intended. Follow-up roster tests caught policy relabelling changing the
patch baseline; the separate transmitted baseline fixes that and both affected
real-view tests pass. A final clean root run and six green CI checks remain.

Remaining requested slice-2 work: retire the old netplay authoring/build/port
path and migrate its fixtures/docs, finish real public-route/workerd recovery
proofs, obtain both declared-round mixed receipts, and complete release gates.
Slices 3–6 above remain after those requirements, with the visual scheduling
and roster bandwidth work now brought forward into this slice.
