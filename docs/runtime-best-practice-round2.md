# Runtime follow-up evidence (2026-10-15)

This is **not completion of the requested batch**. Gate/server-hosted hibernation,
the cause of the original two missing admissions, and the original Chrome launch
failure remain open. The PR remains draft. No version bump, merge or production
deployment. Measurements used only the throwaway studio.

## Changes and checks

- MCP catalogue notifications no longer hold up a response. The deployed trace
  found a `tools-catalogue` D1 read taking up to 324 ms on an initialize request.
  Existing-stream delivery now runs in `waitUntil`; the caller still uses the
  current catalogue. A workerd regression holds publication pending, verifies
  initialize answers, then verifies publication completes. Authorization remains
  on the response path. Existing MCP/notification/request-budget checks: 41 pass;
  new workerd regression: 1 pass.
- Owner statistics explain that page counters show the last hourly rollup and
  that ingestion can delay recent activity. The historical totals/lag/replay
  regression passes; the runtime regression suite now has 31 passing checks.
- CI captures Chrome child stderr, exit status/signal, `/dev/shm` capacity/free
  bytes, and the Chrome process inventory at launch and exit, including failures
  before Puppeteer returns a Browser. Shard regression checks: 5 pass. The
  one-off comparison job was removed after capturing its artifact; the explicit
  diagnostic script remains available, outside the test inventory.

## Latency against 0.54.0

[Evidence](../packages/studio/test/evidence/runtime-best-practice-round2.json) and
[raw samples](../packages/studio/test/evidence/runtime-best-practice-round2-samples.jsonl)
retain cf-rays, version markers, TCP/TLS timings, Worker elapsed time and individual
D1/DO call durations. Baseline and branch used the same throwaway database and
room namespace, in sequential deployments. The measured code is `d91bd316`.
Only matching version markers and colos are included. Version/status filtering
retained 45/48 baseline, 46/48 initial and 37/48 final requests. Each request used a fresh
curl process, as in the first comparison. No concurrent admission load ran during
the final comparison. The initial batch overlapped the short analytics probe.

Warm YVR TTFB, milliseconds; brackets are observed p25–p75, followed by min–max:

| Endpoint | 0.54.0 | Follow-up | n before/after |
|---|---:|---:|---:|
| MCP initialize | 191 [166–267], 155–390 | 160 [140–271], 126–306 | 9/14 |
| Room seat | 324 [232–348], 176–1016 | 252 [195–322], 173–376 | 9/8 |

Warm seat PDX: 1208 [580–2038], 296–2074 → 272 [245–344], 243–423 ms
(n=8/7). Its baseline spread is too large for a general speedup claim.

Cold here means first request in an isolate, not cold D1 or a cold room. Cold MCP
YVR: 1474 → 407 ms (n=1/2, after range 335–480). There were no
matching-version final cold MCP PDX samples. Cold seat PDX: 432 → 493 ms
(n=1/5, after range 384–505), a higher observed median. These cold samples
are particularly small and do not establish cold-seat non-regression.

The initial branch warm-seat YVR TTFB was 356 ms, but both baseline and initial
branch had **67 ms median Worker duration**. Thus that apparent regression was
not explained by extra Worker work. Final branch Worker median was 50.5 ms
(range 44–56). No speculative seat-cache or placement change was added. MCP
foreground Worker time in the final warm YVR samples was 0 ms at Date.now's
resolution. This does not mean zero CPU work. D1 work still occurs in background.
The measured warm medians do not regress; these sequential observational samples do
not establish a universal latency guarantee or isolate every network effect.

## Admission reliability

Five independent batches, 48 sockets at concurrency 8: **48/48 each, 240/240**.
No retries, full-seat answers, duplicate welcomes or early closes during the
observation. Each retained row records reservation cf-ray, socket upgrade cf-ray,
seat and admission timing. Tests use the real deployed network and WebSockets;
they do not run a game's browser rendering or play a round. The observation ends
1.5 seconds after the last admission, then the probe closes its sockets. Raw rows
retain subsequent close callbacks (including abnormal close codes); the admission
summary does not claim clean shutdowns or long-lived connection reliability.

The original failing attempt was overwritten by the successful run in the old
probe file. Its retained summary says only “hello timeout” and “fetch failure”,
without the fetch cause or matching server trace. These new passes do **not**
identify those failures as race, capacity or retry problems, and no causal
admission fix is claimed.

## Analytics ingestion and owner visibility

Live page requests produced 21 Analytics Engine points. Fourteen came from two
seven-request batches that failed during rendering because the reused fixture
held an old draft of migration 0034; counting had already occurred. Applying the
current migration fixed the fixture. The final seven page requests all returned
200. Its immediate ingestion query saw six points, demonstrating ingestion lag.
Later it saw all 21. These failed fixture requests are not latency successes.

The owner API initially returned 16 visits (10 seeded historical + 6 rolled up).
After ingestion and rollup it returned **31** (10 + 21); replay returned **31**.
The deployed owner response contains the hourly-rollup explanation. This proves
live ingestion, preservation of historical counts, delayed visibility and replay
idempotency; it does not test high-volume adaptive sampling.

## Chrome runner evidence

[Run 38823144183, diagnostic job](https://github.com/homie-rocks/homie/actions/runs/38823144183/job/116724266015):
12 original endpoint-URL launches and 12 pipe launches, all successful, same flags
apart from the transport. Original median 185 ms, range 176–7403 ms; pipe median
177 ms, range 173–287 ms. The first original launch was slow, but it did not hit
30 seconds. No timeout was increased. The artifact `chrome-launch-comparison`
contains raw stderr, process exits and process/shared-memory inventories.

The earlier instrumented shard run also records successful simultaneous Chrome
instances and about 8.38 GB of available `/dev/shm`. These observations do not
establish the cause of the historical timeout. The old failed log lacks stderr,
exit status and resource evidence. The pipe mitigation remains, but the original
root cause remains unproved.

## Hibernation remains open

No Gate/server-hosted hibernation conversion is included in this follow-up.
Gate still holds an outbound socket and accepts public sockets using the standard
API. Table explicitly excludes relayed and server-hosted rooms from `canSleep`.
Changing inbound acceptance alone cannot make this topology hibernate.

There is also a rules-contract issue to solve explicitly: the current core still
runs entity movement and handlers between `round.end()` and the next round;
`roundOver` waits two ticks for in-flight scoring. A blanket pause on the first
`over` phase would change game results or suppress handlers. The complete change
needs a durable relay detach/resume protocol, restored logical sessions without
new welcomes, and an explicit between-round scheduling contract with regression
and deployed restoration proof. None of that proof is claimed here.

## Cleanup and review scope

At 23:26:22 UTC the account inventory found **zero `hm-rbp-*` Workers, D1
databases, Queues, Durable Object namespaces and R2 buckets**. All pages were
checked; counts scanned were 55, 42, 2, 162 and 11 respectively. The queue consumer
was removed before its Worker; all five deletion calls succeeded. The tail process
owned by this run was terminated.

**Cleanup is not fully complete:** `hm_rbp_proof_visits` still contains 21 test
points. Post-deletion SQL `SHOW TABLES` confirms it remains. The Analytics Engine
dashboard exposes Explore Data, Copy Binding and Create Alert, but no deletion
control; the published API exposes read-only SQL. The producer is deleted.
[Cloudflare documents three-month retention](https://developers.cloudflare.com/analytics/analytics-engine/limits/).
Do not claim the dataset or its points were deleted.

The PR is too broad for one comfortable review (over 100 files, including a large
module extraction, persistence, payments, analytics and CI). Once the open work
is complete, a sensible split is: (1) behavior-preserving module extraction,
(2) request/assets/metadata/MCP performance, (3) queue delivery and payment
recovery, (4) lobby/WebSocket lifecycle, (5) analytics and owner visibility,
(6) CI launcher evidence. Keep migrations with the consumers that require them,
and attach the applicable measurements to each PR. **No split was performed.**
