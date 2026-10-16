# Studio-to-studio proof

Branch: `studio-to-studio`, based on the released 0.56.0 commit `e6d2b8a8`.
No version bump. All resources in this proof are disposable fixtures.

The [live result](live-result.json) records a 2026-10-16 UTC run (October 15 in
Vancouver). Both `hm-s2s-a-mvahzrks` and `hm-s2s-b-mvahzrks` Workers and their two
D1 databases were deleted in the runner's `finally` cleanup. The account subdomain
is replaced with `studio-a.example`; no credential values are recorded.

| Item | Design and observed proof |
| --- | --- |
| t | Official MCP SDK client and OAuth provider. Live A listed B's two allowed tools, read availability and decoded the structured booking result. Unit tests refuse non-HTTPS origins, escaped discovery URLs, redirects and oversized streamed responses. |
| u | Receiver-provisioned OAuth client credentials, five-minute audience-bound tokens, existing provider validation hook. B returned verified A origin, asserted `Alex`, `owner:false`, and no app roles. Removing A's allowlist entry denied the next request. Unit tests also cover wrong credentials, receiver mismatch and rotation. |
| v | Existing slot, hold and resource allocation paths produce schema.org Offer-shaped availability. Live A selected the offered slot and created one hold. Unit tests remove that offer after capacity is consumed; the existing booking UI browser test returns exactly the selected offer's arguments. |
| o | Standard Webhooks and the MCP Events envelope feed existing durable publication/functions. Live B stored the verified sender, booking ID and ten-minute arrival in `function:arrival`. Unit tests cover duplicate delivery, changed payload conflicts, stale signatures, tampering, size limits and disabled senders. |
| p | In-process `fetchSelf` uses existing internal caller identity. Unit tests preserve a friend's non-owner identity and reject explicit credentials or another origin. Existing custom-route authorization tests remain green. |
| q | Explicit named Cloudflare Rate Limiting bindings share a caller key across delegated tools. Unit tests demonstrate shared success/refusal, undelegated-tool refusal and required anonymous keys. This binding is approximate per location, not a global hard quota. |
| w, r | Owner checklist and 3D map/terrain catalogue parts require separate follow-up PRs and visual/device proof. They are not implemented here. |

## Reproduce

Fast focused tests:

```sh
node --test packages/studio/test/studios-*.test.mjs \
  packages/studio/test/studio-services.test.mjs \
  packages/studio/test/booking-availability.test.mjs
node --test packages/studio/test/studio-to-studio-workerd.test.mjs
node --test --test-name-pattern='booking choice' packages/studio/test/app-sandbox.test.mjs
```

The workerd test runs two independent studios with separate D1 databases and the
real MCP server, SDK and OAuth transport. Its virtual network routes HTTPS between
them without opening the internet. `fixture.mjs` is shared with the live proof.

With explicit deployment authorization and an authenticated Wrangler profile,
`node proof/studio-to-studio/live.mjs` creates two fresh `hm-s2s-*` Workers/databases,
provisions random secrets through stdin, tests the full flow, then deletes only
those resources. Generated configs, bundles and raw results stay in git-ignored
`.local/` beside this file. Nothing must be retained in `/tmp`.

The new unit/browser tests were each run failing before their implementation.
The focused regression run included 40 passing tests covering existing MCP,
MCP Events and booking behavior. Build: `npm run build`. Additional existing
OAuth/browser and tool-build regressions are run before PR completion.
