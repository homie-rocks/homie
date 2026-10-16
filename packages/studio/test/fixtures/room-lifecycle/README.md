# Deployed room lifecycle fixture

Bundle `worker.mjs` with esbuild (ESM, browser/workerd conditions, external
`node:*` and `cloudflare:*`). Use a throwaway `hm-rbp-*` Worker with SQLite
Durable Object bindings `TABLE`, `LOBBY`, `GATE`, and `CONCENTRATOR`, corresponding
to the four exported classes. Enable `nodejs_compat` and set `PROOF_VERSION` to
a unique deployment marker. No D1, queue, analytics dataset, or public assets are
needed for this lifecycle fixture. The catalogue is deliberately minimal; the
public routing, admission, rules runtime, and transports are the real toolkit.

Connect two external player WebSockets to each of `/direct/__net` and
`/gated/__net`, with a fresh `room` query parameter and `gv=proof`. Send
`{"t":"hello","v":1,"rev":12,"rules":true,"want":"play","coast":1}` and
edge heartbeats (`homie-ping`) every two seconds. Record upgrade `cf-ray` headers,
welcomes, closes, decoded snapshots, and round frames.

After round 1 settles, read `/proof-status?key=<game>/<room>` (and, for the gated
room, `&kind=GATE` with key `<game>/<room>/0`). Leave both sockets connected and
**do not poll the objects for 40 seconds**. Read status again, then observe round
2. Constructor IDs must change, the idle tick must remain unchanged, and each client
must receive round 2 and its own body without another welcome, a close, or an
undecodable snapshot. Check the deployment marker on every observation. A
forced abort or redeploy is not idle eviction evidence.

Delete the throwaway Worker afterward and verify its absence. Observation
endpoints belong only to this fixture; none are added to the toolkit router.

Run the external probe with Node and the repository dependencies installed:

```sh
node packages/studio/test/fixtures/room-lifecycle/probe.mjs <fixture-url> <PROOF_VERSION> direct direct.json
node packages/studio/test/fixtures/room-lifecycle/probe.mjs <fixture-url> <PROOF_VERSION> gated gated.json
```

The probe writes the observations before intentionally closing its sockets.

For a crowd, append `128` to the gated probe command. The probe admits batches
of 16 and starts heartbeats before admission, then waits for the settled break
before measuring its 40-second hibernation interval.

`match-probe.mjs <fixture-url> <output.json>` checks 16 quiet pairs, then 2,048
unique players at 128 concurrent join pairs. It asserts unique allocations,
all 16 matching shards used, and bounded per-object request counts. The fixture's
`/proof-lobby` counters are observation-only and never ship in the toolkit router.

`/proof-capacity?game=<fresh-name>` measures 1,024 durable allocations against one coordinator with 32 concurrent callers. `/proof-peak?game=<fresh-name>` accepts timestamped shard totals; `/proof-lobby` exposes peak write counts. `/proof-miss-start?key=<game>/<room>` removes the scheduled wake for a break recovery probe. Status includes accepted room input counts and the Gate link epoch. These failure and observation routes are fixture-only.
