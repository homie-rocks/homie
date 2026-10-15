# Stripe plugin upgrade fixture

Written using `shopMcpPlan` and `saveMcpVerification` from release
`release-2026-10-14-studio-0.51.6` (commit `3600632d`), with the deterministic
Stripe stand-in in `selling-stripe-fixture.mjs`. No Stripe account was contacted.
The old planner was run to convergence, discarding reads after each write as that
release instructed. Its verification writer produced `.studio/stripe-mcp.json`
verbatim, including observations and the result fingerprint, without a source
fingerprint. `unverified.json` captures an earlier returned plan and its input
observations in the same options/result envelope.

The golf shop has two items, one menu and 20 booking slots (23 Payment Links).
On 0.51.7, a fresh replan requests two searches and 23 individual link reads:
25 plugin calls. With saved observations, the fixed planner requests zero. An
explicit fresh check requests two searches and one expanded link list: three.
The test also generates 120 slots and verifies multi-page reads, build asset
publication, runtime loading and a stubbed deploy; no actual deploy runs.
