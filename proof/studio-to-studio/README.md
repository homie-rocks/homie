# Studio-to-studio proof, round 2

Rebased onto main `ba51a735`. No version bump. All live resources are throwaway fixtures.

The [live result](live-result.json) records the successful 2026-10-16 UTC run.
`hm-s2s-a-mvajcr14` and `hm-s2s-b-mvajcr14` Workers and D1 databases were deleted
in `finally`. Public evidence substitutes example origins for the account hostname.
No credentials or private keys are recorded. No browser, desktop app or screen was
opened or read for this round.

| Review item | Fix and proof |
| --- | --- |
| 1. Limits | Both receiver limits and `ctx.rateLimit` use `studio:<origin>`. Fast regression failed with different keys for Alice/Bob, then passed. Anonymous MCP callers expose `clientAddressKey` as the default. Booking actor IDs remain handle-specific. |
| 2. Availability | Pure allocator consumes one snapshot. A 50-slot × 64-option regression failed at 9,601 queries and now returns 3,200 offers in three queries. Holds retain atomic capacity enforcement. |
| 3. Identity and policy | Ed25519 RFC 7523 private-key JWT, same-origin JWKS, `kid` cache refresh and public-key overlap. Fast tests cover deny-by-default, audience, replay, rotation and immediate denial. Deploy helper tests prove key generation through stdin, preservation, and sanitized errors. Live proof confirms origin identity, booking, Standard Webhooks v1a arrival/function execution, and D1 denial. HTTP workerd checks prove office Allow/Deny persistence and owner/CSRF enforcement; audit records origin and asserted handle. |
| 4. Origins | Reject IP literals, mapped/loopback/link-local/integer hosts, private names and non-443 ports unless explicitly configured. Tests cover normalization, duplicates/mismatch, undelegated and unconfigured destinations. Anonymous access requires explicit opt-in. |
| 5. Untrusted data | Results retain source/authentication and `untrusted:true`; lists and descriptions are marked. Regression failed first without the marker. Docs require wrapping before AI use. |
| 6. Handles | `assertedHandle` accepts only 1–128 `[A-Za-z0-9._@-]` characters. Tests reject a decoded space and prove no local signed-in role; a fail-first TypeScript consumer check verifies the public API names and trust metadata. Docs prohibit local-account matching; audit display does not join asserted handles to players. |
| 7. Small fixes | One 8,192-byte event limit, tested oversize/tamper/replay rejection; documented `fetchSelf` Origin implications. Live harness obtains URLs from deploy output and never reads Wrangler's OAuth file. Workerd checks that listing and calls share one request-scoped token and fetch discovery only once per URL. |

## Reproduce without a browser

```sh
node --test packages/studio/test/studios-*.test.mjs \
  packages/studio/test/studio-boundaries.test.mjs \
  packages/studio/test/studio-key-deploy.test.mjs \
  packages/studio/test/studio-services.test.mjs \
  packages/studio/test/booking-availability.test.mjs
node --test packages/studio/test/studio-to-studio-workerd.test.mjs
npm run build
```

The two-worker test uses real workerd, D1, MCP SDK and OAuth transport over a virtual
HTTPS network. Live uses the same fixture. With deployment authorization and a
Wrangler login, run `node proof/studio-to-studio/live.mjs`. It creates only fresh
`hm-s2s-*` resources, generates keys in memory, transfers secrets by stdin, tests
the flow and deletes its resources. Configs/bundles/raw results remain git-ignored.

An initial bundling failure and a subsequent authentication failure were
cleaned up before the successful run. The runner checks public JWKS and retries
only transient key-discovery/routing errors with stable business IDs.
