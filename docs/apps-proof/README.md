# Apps proof

A fresh studio scaffolded from this checkout, with `app new welcome`, a typed build, and `dev --lan`. The proof drives real Chrome at the machine's Wi-Fi address: a wall, two touch phones and a staff tablet. It exercises the welcome queue rather than QA-only controls. The temporary studio, browser profiles and local servers are removed in `finally`.

- [Wall](wall.jpg), [customer whose turn it is](phone.jpg), [waiting customer](phone-two.jpg), [staff tablet](staff-tablet.jpg).
- [Machine-readable receipt](receipt.json): shared action, reconnect, watch, private role checks, revocation, HTTP-safe IDs and persistence across a server restart. No browser page errors.
- `packages/studio/test/apps-proof.mjs` is the reproducible harness; `apps-browser.test.mjs` runs it in the normal suite when Chrome and Wrangler are available. `HOMIE_APPS_WRANGLER` names an existing Wrangler entry point; `HOMIE_APPS_SHOTS` optionally saves compressed JPEGs.

The QR target was opened in Chrome. A physical phone camera was not used. Staff registration used Chrome's virtual WebAuthn authenticator at localhost; the test harness copied that real account session to the LAN hostname. Plain HTTP LAN cannot run passkeys. No production authentication bypass was introduced.

The same app bundle was prepared through the existing standalone web packaging path. Signed native store binaries, store submission and deployment were not performed. Native staff accounts/billing, offline writes and unbounded record storage remain outside this small addition; the public customer role is supported. Records are limited to 1,000 per collection and 8 KB each; app authors define deletion and retention using the records helper.

The build compatibility test compares an existing game's bundle bytes and digest before and after adding an app. The public catalogue distinguishes apps, while the room, assets, shop, parts, build and standalone implementation stays shared.

## Original app implementation proof

Run sequentially on this checkout with `CHROME_PATH` set to the installed Google Chrome:

| Gate | Result |
| --- | --- |
| `npm ci` | Passed |
| `npm run build` | Passed |
| `npm test` | 1,100 passed, 0 failed; 2 Stripe-mock tests skipped because `STRIPE_MOCK_URL` was absent |
| `npm run test:plugin` | 116 passed, 0 failed; optional live-site playtest skipped because `HOMIE_PLAYTEST_URL` was absent |
| `npm run validate` | Marketplace and plugin passed |
| `node scripts/desktop.mjs --check` | Packed server passed; 66 tools and five cards answered |
| `node scripts/changelog.mjs --sync` | Both changelogs match |
| Final app/site/parts wording checks | 33 passed |
| Final fresh-studio Chrome proof | Passed; screenshots and receipt alongside this file |

The cached pinned Wrangler was linked locally for the optional game browser tests. Both the ten-update and thirty-update play/watch proofs passed, preserving rooms and seats. Earlier attempts exposed a timing-guard rejection that dev remembered without retrying: dev now resamples only that wall-clock rejection, at ten-second intervals, at most three times, keeping the last good build. The guard itself is unchanged. A payment timing assertion passed on isolated retry and in the final full suite.

Recording, sound and performance plugin tests passed on this run. Free disk space increased during the task and never crossed the requested 3 GB stop threshold. The desktop package/staging tree, diagnostic copy, temporary studios, local servers and temporary Wrangler links were removed. That initial implementation proof made no version change, push, pull request or deployment. The follow-up below records the separate release allocation and PR update.


## APPS follow-up: cards, Shop and existing studios

The follow-up rebases onto main including the rules build check and browser-hosted rules. It allocates studio **0.37.0**, plugin **0.38.0**, regenerates the lockfile, public template and template history, and retains main's older changelog sections byte for byte.

The 13 release files follow the previous release pattern: `.claude-plugin/marketplace.json`; both `CHANGELOG.md` files; `package-lock.json`; `packages/studio/package.json`, `worker/version.mjs` and `lib/template-history.json`; `plugins/homie/plugin.json` and its `.claude-plugin`, `.codex-plugin` and `.grok-plugin` manifests; and `template/package.json` / `template/studio.json`. The template and history were regenerated with the repository scripts; all 55 history entries from main remain unchanged.

Public apps use the game's player-card renderer, HTTPS image rules and sandbox, through `/open/embed`; their metadata and exits say Open. Chrome exercises an app framed cross-origin with storage blocked, actual shared input, and the same app at the top-level player address. Image tests measure an app's own tall still and fallback picture.

The Shop button has its own 52-pixel strip above the content, respecting safe areas. It uses the same store sheet as the room panel and `createShop().open()` / `.open(item)`. `screen.shop: false` hides the button per game or app. The Worker checks shop readiness and the experience's items before rendering it. A player-card purchase opens the studio's shop, preserving the requested item. Ordinary play/open pages use the configured Payment Link or keyed Checkout path.

The Chrome purchase test runs both game and app shells at **390×844, 358×201 and 1280×720**, for each of the two payment paths (12 cases). It clicks the visible Shop button, exercises both in-experience API buttons, and starts an order through the real Worker shop code and stand-in Stripe. It checks button size, reachability and separation from the content. The starter embed proof also moves actual characters with mouse and touch while the control is present. After shrinking the content, its touch gesture chooses exposed canvas rather than a fixed point that can now hit a game's own button.

### Trial method and conversion

Both requested studios were copied to temporary directories, excluding `node_modules`, git history, local runtime state and secret files. The toolkit was installed from this checkout's npm tarball. Only the copies were changed; no deployment or provider configuration was performed.

Switchback's workshop moved from `games/workshop` to `apps/workshop`, and `game.json` became `app.json`. It gained customer, wall, kiosk and staff role declarations, surface mappings, Open/Scan to join wording, and explicit `records.persist: false`. The existing room checkpoint model, procedural 3D workshop, audio and shared commands were retained. The internal QR module import became `@homie-rocks/studio/links`; ticket URLs and custom site links became `/workshop/open`. Built assets intentionally remain at `/games/workshop`, so authored media URLs continue working.

This is a conversion of the **existing public local demo**, not a production repair system. Its staff controls remain public and labelled as demo controls. The move alone cannot turn browser-hosted repair records into authoritative business data or provide staff authentication. That requires a separate records/permissions migration.

The app check needs a real action and a shared visible result. The existing customer bell for ready sample ticket 404 supplies the action. The copy gained a visible bell-call count shared by its screens, and `check.params: { "ticket": "404" }` opens that ticket. This trial exposed the need for optional check URL parameters; the toolkit now supports them while retaining its own isolated room. Multi-step form filling remains outside this small checker: a workflow needing that should use a richer studio-owned browser proof (Switchback already has one).

Reviewing the surface links also found that the frame defaulted to the phone role even when `surface=wall` was supplied. The frame now resolves the role through the same `appRole` function as access checks, with explicit roles still taking precedence; a route regression test covers it.

The old custom home page still speaks in the studio's own words and must be edited by the studio; changing the catalogue kind does not rewrite authored HTML. The toolkit's public exports removed the fragile relative import into `node_modules`. Source-folder conversion itself required no changes to the 3D scene or sound code.

Against the freshly packed main toolkit (including PR #73), the packed APPS toolkit produced identical bundle hashes for all five Arcade games:

| Game | Main and APPS hash |
| --- | --- |
| 2048-race | `eb32611a3ea65ef6` |
| asteroids-arena | `7e396921f09e7e7d` |
| bone-burglar | `ba3734e8a67721b4` |
| octree-arena | `16e295509bb7b9f9` |
| tiny-platformer | `4c685613817d26d7` |

### Follow-up verification

The full suite ran with Chrome, the installed Wrangler and Miniflare, and a temporary local `release-2026-10-09-studio-0.37.0` tag pointing at the tested code. This exercises the publish job's current-version tag case, rather than assuming every tag is older. The tag was removed afterwards and was never pushed.

| Gate | Result |
| --- | --- |
| `npm ci` | Passed; 135 packages installed |
| `npm run build` | Passed |
| `npm test -- --test-concurrency=2` | 1,386 passed, 0 failed, 0 cancelled, 2 skipped; 1,388 tests total |
| `npm run test:plugin` | 116 passed, 0 failed, 1 skipped; 117 tests total |
| `npm run validate` | Both marketplace and plugin passed |
| `node scripts/desktop.mjs --check` | Passed; packed server answered with 66 tools and 5 cards |
| `node scripts/changelog.mjs --check` | Passed; main's older sections remain byte-identical |
| `node scripts/publish.mjs --check` | Passed; 1 new version, 22 published packages unchanged |

The two suite skips require the external `STRIPE_MOCK_URL` service; the in-process stand-in Stripe purchase tests ran and passed. The plugin skip requires `HOMIE_PLAYTEST_URL`. The real-Chrome starter proof passed all 20 cases, the added Shop proof passed all 12 game/app/size/payment-path cases, and the room-update proof passed ten batches of ten updates and one batch of thirty. The workerd/Node determinism check also ran.

The default-concurrency run exposed a snapshot mismatch and a timeout in main's wall-clock rules traffic test while the machine was heavily loaded. All 12 traffic scenarios then passed in isolation (13 reported tests including the parent), and the complete suite passed with two test files at a time. No runtime assertion was removed and no rules test was skipped. Earlier Shop test mock failures were fixed by modelling both Shop buttons and following the MCP result's actual `job` handle.

The changelog checker retains main's advisory about the missing 0.35.1 tag link; its released section was deliberately not edited.

The converted Switchback workshop built and its packed-toolkit app check passed: `[data-ring="404"]` changed the visible count from `Bell calls: 0` to `Bell calls: 1` on the wall and both phones, and the actor's reload retained the result.

All five Arcade checks passed through a real completed round with both human browser seats present in the results, no reconnects, and the same build output as packed main. The default check settings and studio sources were retained.

| Arcade game | Check | Computer / phone FPS | Reconnects |
| --- | --- | --- | --- |
| 2048-race | Passed | 60 / 60 | 0 |
| asteroids-arena | Passed | 60 / 60 | 0 |
| bone-burglar | Passed | 60 / 60 | 0 |
| octree-arena | Passed | 60 / 60 | 0 |
| tiny-platformer | Passed | 61 / 60 | 0 |

Both temporary studio copies, the baseline toolkit copy and tarballs were deleted after recording these results. Local trial servers were stopped. The original studios were never changed. Temporary Wrangler links, the local test tag and desktop packaging output were removed. No deployment or merge was performed.
