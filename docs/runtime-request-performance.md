# Request performance

Part 2 depends on part 1's module boundaries. The standard Worker entry now loads rendering and room engines at their own entry points; custom room subclasses keep their constructors. Assets use explicit Worker routes, metadata uses an atomic cold D1 batch and revision caching, and D1 Sessions start at the primary for current authorization. MCP prefix reads and expiry cleanup use indexes; subscription objects are separate from matchmaking. Catalogue notifications use request background work.

Migration `0034_runtime_indexes.sql` adds only the MCP expiry index. Queue intake, room summaries and analytics schemas belong to their consumers in subsequent parts. Hourly cleanup prunes expired MCP keys and guests.

The [original measurements](https://github.com/homie-rocks/homie/blob/c4fc93ba480549996869b4d6ca59d0c4a7a293ec/packages/studio/test/evidence/runtime-best-practice-round2.json) and [raw samples](https://github.com/homie-rocks/homie/blob/c4fc93ba480549996869b4d6ca59d0c4a7a293ec/packages/studio/test/evidence/runtime-best-practice-round2-samples.jsonl) measure the combined branch at d91bd316 against 0.54.0, not this isolated PR. Warm YVR MCP median TTFB was 191→160 ms (n=9/14); warm YVR seat 324→252 ms (n=9/8). Samples were sequential, version/colo filtered and not randomized. Cold PDX seat 432→493 ms (n=1/5) does not establish non-regression. The draft lifecycle PR tracks further proof; no new deployment is claimed here.

Validation: 35 request-budget, runtime, notification and workerd checks pass, including initialize answering while catalogue publication remains pending. Deployment/configuration fixtures are tested separately. No version bump.
