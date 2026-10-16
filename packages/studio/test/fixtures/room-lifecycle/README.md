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
**do not poll the objects for 26 seconds**. Read status again, then observe round
2. Constructor IDs must change, the idle tick must remain 22, and each client
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
