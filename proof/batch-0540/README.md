# Batch 0540 proof

Base: `0b92881e` (0.53.0). No package/plugin version bump.

## Local evidence

Failing regressions were run before their fixes for request budgets, product observation,
pending needs, Big screen context, public room URLs, tool-data notifications, session
revocation, payment review/group quantities, public link storage, and the prediction race.

Targeted Node/workerd regression run: 74 passed. TypeScript workspace build passed.
The single Chrome case `ROOMS_FEEL_FILTER=60-browser ROOMS_FEEL_DELAY=300
ROOMS_FEEL_LOSS=0.1` passed: input frames 1, backwards 0, snaps 0. No local full browser
matrix was run. PR #137 run 38723722253 shard 14 failed at synchronous entity identity;
the new virtual-time test crosses a simulation tick within one synchronous callback.

Request counters assert 0 D1 round trips for public static files; 1 for public app
records, app shell, game shell, room seat and socket routing; one DO only for seat/socket.
Real workerd separately asserts steady MCP initialize/tools-list at most 1 D1 and 0 DO.
These are public fixture requests, not a claim that arbitrary transactional writes or
private authorization need at most one database operation. Private assets deliberately
recheck the live session/role; settings are current per request, not stale isolate grants.

## Deployed comparison

Owner's Homie account; two isolated Workers, each with its own D1 and SQLite DO classes.
Real toolkit Worker bundles, static catalogue, one records-only app and one browser-hosted
game. No Stripe, player credentials or production data. Page `/cafe/open`, static
`/test.js`, records `/cafe/api/app/records/notes`, MCP `initialize`, seat `/race/api/lobby`.

25 measured samples per route/version, after three warm-up rounds. Alternate before/after
order on every round, consume response bodies, keep connections alive. TTFB is measured
until fetch resolves its response headers. Every response was HTTP 200. Raw observations,
including edge Ray IDs, are in `speed-persistent.json`.

| Route | Before median ms | After median ms |
| --- | ---: | ---: |
| Page | 159.30 | 95.15 |
| Asset | 97.04 | 57.57 |
| Records | 156.11 | 98.33 |
| MCP initialize | 139.91 | 57.50 |
| Room seat | 329.50 | 143.97 |

The earlier curl-per-request run is retained in `speed-fresh-connections.json`. TLS,
network and shared-machine scheduling noise made that run inconsistent (asset baseline
146–2268 ms). Persistent connections are the primary comparison; neither run controls
other work on the owner's machine.

Resources created (cleanup verification will be appended before completion):

- Worker `hm-speed-0540-before`; D1 `bd972219-2667-44cd-b828-da5b1df346b0`.
- Worker `hm-speed-0540-after`; D1 `536a4b6e-fd54-4fb0-a72d-adb1f661670c`.
- Each Worker owns Table, Lobby, Gate and Concentrator namespaces; no R2 or KV.

Initial measured versions: before `ef1ef699-6c40-4aa6-a486-34e85a9a9326`, after
`edf815a0-8f42-41e1-9911-0c30f38920eb`. Only these throwaway Workers were deployed.
