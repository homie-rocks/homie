# Studio parts

Studios share **parts**: reusable files another studio can find, license and install. A part may be a game mechanic, an app's quiz, menu board or waitlist screen, a music loop or complete track, or video. It can be free or priced. The licence says where it may be used, including a venue when the seller chooses that use.

## The rules

1. **The lifting command extracts a piece, never a whole game or app.** Music, video and app assets can be authored directly in a part folder. Remix, which handed over an entire game, is retired;
   parts are what replaces it.
2. **A part can take any form** that suits the piece: code, assets, data, a JSON description, a tuned config, or a
   mix. Form is not restricted.
3. **Private until shared.** A studio shares a part on purpose, with a licence (an SPDX identifier) and an
   attribution. A part records the game and the studio it came from.
4. **Homie packages are not parts.** The `@homie-rocks/*` packages are general mechanisms (camera, input, audio,
   effects, netplay), installed from npm. They are never in the catalogue. A part may say which packages it builds
   on; npm installs and resolves them. There is no resolver, no version ranges, no lockfile and no registry of
   Homie's: nothing here rebuilds what already works.
5. **Creators work in chat.** A person never types a command. The tools are few and named like the asset tools:
   `parts_find`, `part_add`, `part_new` and `part_share` (sharing and un-sharing). Anything else is plumbing behind
   those.
6. **Agents look for parts first.** When planning or making a game, the agent checks the packages for general
   mechanisms and `parts_find` for pieces other studios shared, before writing from scratch; it records in the
   game's CODEX and its credits what came from where.

## In chat

- "What parts are there for a chase camera?" (`parts_find`)
- "Add the Pickup field part from owls.example/pickup-field to my game." (`part_add`)
- "Make the creature in my game a part." (`part_new`)
- "Share the creature part under CC BY." / "Stop sharing it." (`part_share`)

## How a part moves

**Share.** The creator asks. `part_new` lifts a piece out of one of their games into `parts/<id>/`: the files
move, each module's old path keeps a line that re-exports the part's, and the game still builds and plays the same.
A file that reaches into the rest of the game is refused by name (pass what it needs in as an argument first), and
so is the game's own entry, page or `game.json`: a part is never the whole game. `part_share` marks it shared with
its licence. It is **live after the studio's next deploy**, not before. The studio's site lists its shared parts at
`/.well-known/homie-parts.json` and serves their content; **a private part is never reachable**.

**Catalogue.** `https://homie.rocks/parts/` indexes the shared parts of studios that are already listed (it never
lists a studio), searchable by kind, tag, licence and what a part builds on; each part shows its game, studio,
licence, attribution and a preview. `/parts/index.json` there is what `parts_find` reads. When it cannot be
reached, `parts_find` says so plainly and still answers with the studio's own parts: an empty list never stands in
for "could not look".

**Use.** The creator asks for a piece. `part_add` fetches **one exact version** (the latest shared unless one is
named), checks its integrity (every file's SHA-256 and size, before a byte is written), copies it into the studio
at `parts/_vendor/<host>/<id>/` (theirs to tune from then on), records where it came from in `parts/origins.json`,
adds the credit to the game's `credits.json`, and lets npm install any packages it builds on. Adding it again
later brings the newer version: what changed is shown, local tuning (`tuning.json`) is kept, and a file the studio
edited is never replaced without saying so.

**Publishing a game that uses parts** shows their licences and attributions, and says plainly when licences cannot
be combined.

## A part on disk

`parts/<id>/part.json`, with the part's files beside it (`id`: lowercase letters, digits and hyphens; the folder is
named after it):

```json
{
  "id": "pickup-field",
  "name": "Pickup field",
  "kind": "mechanic",
  "version": "1.0.0",
  "summary": "Host-authoritative pickups on spawn spots.",
  "license": "CC-BY-4.0",
  "attribution": "Night Owls",
  "share": false,
  "tags": ["pickups", "netplay"],
  "from": { "game": "gem-cave", "studio": "Night Owls" },
  "entry": "src/index.ts",
  "files": [{ "path": "src/index.ts", "sha256": "…", "bytes": 1234 }],
  "preview": { "page": "preview/index.html", "image": "preview/cover.jpg", "aspect": "4:3", "phoneAspect": "3:4" },
  "requires": { "packages": { "@homie-rocks/camera": "^0.2.0" }, "parts": ["other-studio.example/some-part"] },
  "physical": { "units": "metres", "scale": 1, "pivot": "feet", "collision": "collision.json" },
  "skeleton": { "rig": "humanoid-v1", "clips": ["idle", "run"] },
  "contract": { "inputs": {}, "state": {}, "netplay": "host-authoritative" },
  "cost": { "triangles": 0, "drawCalls": 0, "textureMB": 0, "bytes": 0, "measuredOn": "…" },
  "provenance": { "source": "original", "notes": "" }
}
```

| Field | What it is |
| --- | --- |
| `id`, `name`, `kind`, `version`, `summary` | `version` is three numbers; a shared version never changes, so a change is a new version. `summary` is one sentence. |
| `kind` | `character`, `rig`, `clips`, `environment`, `effect`, `sound`, `ui`, `mechanic`, `shader`, `level-generator`, `bot-brain`, `audio-pack`, `set-piece`. These are suggestions, not a whitelist. `app`, `music` and `video` are also suggested; any lowercase label of letters, digits and hyphens is accepted. |
| `license`, `attribution` | Needed to share: an SPDX identifier, and who a game using the part credits. |
| `share` | **Default `false`.** The part's own switch, and the only thing that decides whether it is shared. |
| `from` | The source and studio: existing `{game, studio}` stays valid; non-game work may use `{kind, id, studio}`. Written when a part is lifted out of a game. |
| `uses` | Optional intended uses: `game`, `app`, `venue`, `cause`, `music`, `video`; the licence governs permission. |
| App/media provenance | The source and studio: `game`, `app`, `music` or `video` with its id. Written when a part is lifted out of a game. |
| `entry` | For a part with code: the module a game imports. A part of assets or data has none. |
| `files` | Every file with its SHA-256 and size, **written by the tool, never by hand**. A file may carry `"rights"` (below). |
| `preview` | `page`: a self-contained HTML page shown in a sandboxed frame. `image`: a still. `aspect`: the frame's shape as `"W:H"` (whole numbers 1 to 32, no flatter than 3:1, no taller than 1:2; default `"16:9"`). `phoneAspect`: the shape when the frame is narrower than 600 px. |
| `requires.packages` | The npm packages it builds on, as `package.json` would name them. npm reads them; nothing else does. |
| `requires.parts` | Other parts it needs: a plain list of `"<host>/<id>"`. Named to the person, never solved. |
| `physical`, `skeleton`, `contract`, `cost` | Optional descriptions for whoever uses the piece: its scale, pivot and collision data; its rig and clips; its inputs, state and who decides in a room (`host-authoritative`, `replicated`, `local`); device costs that were measured (never guessed). |
| `provenance` | `source`: `original`, `generated` or `imported` (with `origin`). Needed to share. |

A field this file does not name is kept and ignored. A field whose name starts with `_` never leaves the studio.
`tuning.json` in a part holds its tunables: it ships as the author's defaults and is the one file a newer version
never overwrites (the new defaults arrive beside it as `tuning.upstream.json`).

**Sharing is refused**, in plain words, when: there is no SPDX licence; the licence asks for credit and nobody is
named; the part does not say where it came from; or the rights to a file are unknown. A file's rights are its own
`"rights"` (`{ "license": "<SPDX>" }` or `"unknown"`), else the record of a game asset with the same bytes
(`games/<id>/assets/manifest.json`: a store-licensed or bought file cannot be shared inside a part), else the
part's `provenance`.

**Licences that cannot be combined** (shown when a part is added and before a game goes online): two parts under
different share-alike licences in one game; a non-commercial part in a studio with a shop; a no-derivatives part
whose files were changed locally; a part with no licence; credit owed and missing from the game's credits. A
share-alike part is pointed out for the person's decision, and a licence the toolkit does not know is said to be
one to read.

## What a studio's site serves

`sharedPartsOf(studio)` (`lib/parts.mjs`) is the single answer to what a studio shares: its parts with
`share: true` that have a packed version. The build writes exactly that into the site, and the site, the
well-known file and through them the hub read nothing else.

- `GET /.well-known/homie-parts.json` → `{ "v": 1, "studio": { "name", "url" }, "parts": [ … ] }`. Each entry is the
  part's `part.json` (latest version), plus `"url": "/parts/<id>/<version>/"`, `"page": "/parts/<id>/"`,
  `"versions": [ … ]`, `"add": "<host>/<id>"`, and for a part from one of the studio's public games
  `"from": { "game", "name", "studio", "page", "play" }`, so a catalogue can show and group by game. CORS open for
  GET. No shared part: the same shape with `"parts": []`.
- `GET /parts/<id>/<version>/part.json` and `/parts/<id>/<version>/<file path>`: the content exactly as hashed,
  immutable (a year's cache), CORS open, GET and HEAD only. An HTML file among them (a preview) is served
  sandboxed, so it runs without the site's cookies or storage.
- `GET /parts/` and `/parts/<id>/`: the studio's own pages in its own look (each part's game, licence,
  attribution, preview, what it builds on and costs, and what to say in chat to add it), and a **Parts from this
  game** band on a game's landing page.

**Declare the shape of an interactive preview.** The default frame is 16:9, and across a 390 px phone that is
about 197 px tall: a heading and two buttons fill it, and what the preview draws below them is cut off with no
error to notice. Say `"aspect"` and `"phoneAspect"` in `preview` for a preview somebody plays with. With neither, a
narrow frame is at least 320 px tall (70% of a short screen), and every preview has an **Open the preview** link
that shows it in a tab of its own.

Sharing packs the part: the exact bytes of that version are kept in `parts/_packed/<id>/<version>/`, and every
packed version of a shared part is served, so "one exact version" stays true after a newer one ships.

## Using a part in a game

```ts
import { createPickupField } from '@parts/owls.example/pickup-field';   // a part brought in
import { chasePose } from '@parts/chase-camera';                        // one of the studio's own
import table from '@parts/owls.example/loot-table/table.json';          // any file of a part
```

The build resolves `@parts/<host>/<id>` to the part's `entry` in `parts/_vendor/<host>/<id>/`, and `@parts/<id>`
to `parts/<id>/`, and bundles it into the game. A game that imports a brought-in part is credited for it by the
build, whether or not the add named the game.

## For whoever works on the toolkit

- `lib/parts.mjs` the format, hashes, lifting, sharing checks, `sharedPartsOf`, licences; `lib/parts-store.mjs`
  find, add, share (one injectable `fetch`, one injectable npm runner: tests touch neither the network nor the
  registry); `lib/parts-build.mjs` the build's three call-outs; `lib/parts-tools.mjs` the four chat tools;
  `worker/parts.mjs` everything the site serves.
- Packages: `npm ls <name>@<spec>` says whether the studio has one; `npm install --save-exact <name>@<spec>`
  installs what is missing, after one line saying what and why; npm's output and errors are relayed as they are.
  A package the studio's own `package.json` already names at a version npm says does not fit is explained and left
  alone.
- The plumbing behind the tools is `homie-studio parts find | new | add | share | unshare | check`.

App parts use the same lift/import/credit paths as game parts. Music and video parts can start empty with the corresponding kind; add their selected files, licence and provenance before sharing. `uses` describes what they are for, not permission to use them: the licence controls that. Optional `sale` metadata adds pricing without changing the meaning of `share`.

For example: `homie-studio parts new welcome-queue --kind waitlist --uses app,venue`, or `parts new gala-loop --kind loop --uses venue,cause`. A source app is selected by the existing `--from <id>` and `--game <id>` options.

## Selling a part to another studio

A part can be free or have `sale` in its `part.json`. The seller chooses its price,
licence and refund terms. Homie takes no cut and sets no price or spending ceiling
for studio purchases. Existing player shop rules apply to players, not these licences.

```json
{
  "license": "LicenseRef-Studio-Commercial",
  "licenseTerms": "LICENSE.txt",
  "sale": {
    "amount": 2500,
    "currency": "usd",
    "billing": "one-time",
    "scope": "studio",
    "source": true,
    "updates": "major",
    "taxCode": "txcd_10000000",
    "refund": "Contact the studio for the refund terms written in LICENSE.txt.",
    "onRefund": "terminate",
    "onExpiry": "retain",
    "commercialUse": true,
    "transferable": false,
    "publicFiles": ["preview/demo.js"]
  }
}
```

This fragment is added to a complete part; choose the tax code for the actual goods.
`LICENSE.txt` must contain the complete seller-chosen licence and refund terms and
identify each custom licence. `license` also accepts SPDX expressions (`MIT OR
Apache-2.0`, for example); the toolkit never chooses an alternative for the buyer.
`LicenseRef-…` identifies a custom commercial licence, not an SPDX listed licence.
The structured summary and licence text must agree; the text is what the parties read.

- `amount` is a positive integer in Stripe's currency minor units (JPY has no cents).
  There is no toolkit price ceiling; Stripe's own supported amounts still apply.
- `billing`: `one-time`, `day`, `week`, `month`, `year` (the recurring intervals Stripe supports). Recurring sales use Stripe Billing, with
  paid-through periods from paid invoices. Cancellation uses Stripe's customer portal.
- `scope` is the seller’s label for licensed use (for example `studio`, `game`, `seat`, `venue` or `app`). A game licence names the buyer's game. A seat
  licence has a quantity; seat assignment and transfer follow the written terms.
- `source`, `commercialUse`, `transferable` are explicit booleans. Package only the
  files being sold. `source: false` does not strip or obfuscate files automatically.
- `updates`: `none`, `major`, `all`. Existing purchases use their original update
  promise. Later list prices and new-buyer terms never remove the purchased promise. Included updates remain licensed under the purchased terms.
- `refund` is the seller's policy in plain words; `onRefund` and `onExpiry` choose
  `retain` or `terminate` for rights to already downloaded copies. Full refunds and
  lost disputes stop new downloads. Partial refunds leave the licence active.
- `publicFiles` explicitly names preview dependencies that may be downloaded without
  buying. The preview page, image and licence text are public automatically. A browser
  demo exposes whatever code and assets it uses. Keep private source out of previews.

On an already deployed studio, ask the AI to connect the shop and sell the part. The AI runs `shop init` if needed, `shop connect`, configures private storage and shares the release. **One browser approval** connects Stripe when its CLI session is not already authorized; an existing session needs **zero** new approvals. Account onboarding and Cloudflare authorization are separate provider requirements. Products, Prices, Payment Links and the webhook are created through Stripe's official CLI. The webhook signing secret and an automatically generated purchase signing key go privately into the Worker. No person finds, copies or pastes either secret.

The default hosted fallback uses these Payment Links with **no Stripe API key in the Worker**. The hosted review records the accepted terms, then redirects to Stripe with an opaque order reference. A verified signed event binds the exact link, revision, currency, amount and mode before granting files. Lost events wait for Stripe redelivery; the owner's AI can resend them through Stripe's CLI. Refund in Stripe or ask that connected AI. Keyless retirement returns the subscriptions for that AI to cancel through Stripe; signed cancellation events let retirement finish without revoking paid-period downloads. The shop's signed refund snapshots update access; the Worker makes no Stripe API request. The AI can preconfigure any positive quantities in `parts/offers.json`, for example `{"camera":{"quantities":[1,5,20]}}`, then run `shop connect`; it creates a fixed link for each chosen quantity. The default is one unit. A quantity without a matching link needs that setup sync or the fuller Session connection, so the paid quantity always matches the approved quote. Signed paid invoices supply recurring access periods; invoice-payment events associate their refunds. A later billing period never removes the rights the seller promised for earlier downloads.

Paid releases use a **separate private R2 bucket and `PURCHASE_MEDIA` binding**. Never enable a public R2 domain for it. Deploy verifies the selling Worker before uploading private files and reads every uploaded hash back. No paid payload is copied into public static assets; the normal Worker cannot read this bucket. Technical file and request limits are security/resource safeguards, not spending limits.

### Which payment paths need credentials

| Path | Stripe API key in Worker? | Other requirements |
| --- | --- | --- |
| Hosted Payment Link fallback | **No** | CLI browser approval at setup; signed webhook; private signing key and storage |
| MPP Stripe shared payment tokens | **Yes** | Authenticated PaymentIntent creation, account profile and SPT eligibility |
| MPP over MCP | **Yes** | The same Stripe shared-token charge, carried by MCP |
| x402 Base recorded into Stripe | **Yes** | Authenticated transaction-verification PaymentIntent; live CDP facilitator credentials; Stripe-approved deposit address |
| Dynamic Checkout Sessions, direct refunds, provider-read recovery | **Yes** | Stripe API access for those operations |

Stripe's [MPP guide](https://docs.stripe.com/payments/machine/mpp) initializes the Stripe client with a secret credential. Its [x402 guide](https://docs.stripe.com/payments/machine/x402) separates the on-chain facilitator settlement from authenticated PaymentIntent recording. **x402 itself does not require a Stripe API key**; this supported path records money into the seller's Stripe books as Stripe documents. The keyless Payment Link path uses [signed webhooks](https://docs.stripe.com/webhooks) instead of provider reads. CLI OAuth is not exported as a Worker REST credential; see [the setup research](../../../docs/stripe-connect-research.md).

For a fuller connection, the AI operates Stripe's [key-creation page](https://docs.stripe.com/keys), selects the necessary permissions and clicks Copy, then runs `shop connect --from-clipboard` (`--live` for live mode). The local command privately reads the clipboard, verifies the key, makes the webhook and writes secrets to Wrangler stdin, then clears the clipboard. **The human only handles provider sign-in, verification or approval prompts**; their count is controlled by Stripe. Never ask the person to find or paste a key when browser control is available. No supported public API to mint a persistent Stripe REST credential from the CLI approval was established. On macOS this uses `pbpaste`/`pbcopy`, Windows its clipboard commands, and Linux Wayland `wl-paste`/`wl-copy`; other desktops require an equivalent private credential transport. The manual local form remains an explicit fallback, not the default instruction. Live CDP credentials likewise belong to the seller and should be transferred privately by the AI from the provider's setup; no Homie account is involved.

Turnstile is optional. If the studio configures it, the fallback verifies its hostname and action. The per-address Worker rate limiter remains configurable flood protection. Machine payment proofs are verified by the protocol libraries.

A release's bytes never change. `parts/offers.json` holds only price overrides and
availability choices. Other terms come from the release being offered. Each accepted
offer version stores the complete terms and price together. Earlier free copies cannot be recalled. `share: false` stops discovery
and new checkout after deploy; R2 keeps paid releases for existing buyers. Do not
remove purchased releases. Keep the packed files, D1 purchase records and signing key
in the seller's backups. Run shop connect again after adding paid parts to register the additional
subscription webhook events and permissions. Stripe's Dashboard must have its customer
portal enabled for subscription management; refunds and cancellation are separate.

## Buying and keeping the proof

Requires studio **0.36.0**. Discovery uses `/.well-known/api-catalog`, linking
`/parts/catalog.json`, `/purchases/keys.json`, the HTTP resource and MCP endpoints.
The seller's public page and catalogue contain schema.org Product and Offer descriptions.

The buyer sees the full offer and exact quote before approving payment. Set
`HOMIE_PARTS_WALLET` to the person's installed `link-cli` or `purl` client.
The tool calls the wallet, which owns all spending authority and limits. Link card spends
currently require approval in the Link app. Retry the same purchase after that approval.
A compatible funded crypto wallet can use its existing authority. No seller checkout
page is involved in a successful protocol exchange.

MPP uses Stripe shared payment tokens. Tempo is disabled. x402 exact uses Base
payments to the studio's Stripe deposit address. Both return files, a payment receipt
and signed purchase proof. MCP uses MPP's JSON-RPC challenge and receipt binding.
Checkout remains the human fallback, and handles subscriptions, non-USD prices and final
tax calculation. Managed Payments is a Checkout option; machine charges use the studio
as seller. In fallback Checkout the person accepts the licence and presses Pay; an
assistant must not submit acceptance with a browser tool.

`shop connect` obtains the profile and stablecoin deposit addresses from Stripe and writes
`PURCHASE_MACHINE_PAYMENTS` and a mode/key-bound `PURCHASE_PAYMENT_CAPABILITIES` record. It needs
**PaymentIntents Write**, Business Profiles access, Payment Method Configurations reads and
Crypto Deposit Addresses access, as well as the existing Checkout and webhook permissions.
The fuller connection reports Stripe readiness errors. Connect and scheduled checks read the
profile, enabled methods and existing deposit addresses. They create no provider objects.
These reads establish configuration, not PaymentIntents Write permission, funded settlement
or SPT eligibility. Real purchase outcomes update readiness. The scheduled check retries
failures with backoff and rechecks successful configuration every six hours.
Stablecoins still require Stripe approval; the office reports unavailable methods and the
catalogue lists the available paths. Live Base additionally needs the studio's own
`CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`. The toolkit does not invent those credentials.

At the documentation check on 2026-10-08, the Link wallet supports US and Canadian wallet accounts and a $500 spend-request
limit. An x402 client's default spend control can be $1 per payment; the wallet owner decides
whether to change it. These are provider/client constraints, not studio pricing limits.
`part_add` also accepts a `wallet` argument. A failed token clears pending wallet approval. Explicit wallet refusals, missing wallet software,
unsupported methods and unavailable machine paths offer a clearly labelled hosted Checkout fallback. An uncertain settlement must be reconciled before paying again.

`/openapi.json`, linked as `service-desc` from the API catalogue, publishes each offer's
request schema and `x-payment-info`. Buyers can submit the published `offerVersion`.
Challenges bind to the server hostname and an individual purchase resource URL. Unpaid
machine orders and challenges last five minutes; reprice, withdrawal and retirement close
old unpaid offers. The limiter applies before protected R2 file reads too.

Verified stablecoin settlements grant access even while Stripe recording is unavailable.
`purchase_jobs` retains the recording parameters and transaction reference. A five-minute
cron and on-demand order refresh retry recordings and re-read processing PaymentIntents.
If paid files cannot be restored, the owner must refund the order manually. Maintenance never
refunds for a storage outage. Every five minutes it reads unresolved Stripe objects and retries
delivery availability. The owner can run the same recovery with
`POST /_studio/api/shop/reconcile-payments` and an optional `order` identifier; buyers retrying
their purchase also trigger this read. Existing payment facts and order identifiers are retained
for late webhooks. Authentication, permission and idempotency errors are not charge refusals.
After 23 hours, no charge is replayed. Reads continue: a paid object is recorded; a canceled or
unpaid object releases the claim. An exhausted complete list after the deadline also releases
the claim while keeping its order. If Stripe remains unreadable, the office shows the order,
request key, recorded PaymentIntent (if known), age and last error. Reconnect the key and use
Reconcile payments now. If you have the exact PaymentIntent id, use Read this payment beside
the recovery row (or pass `payment` and `order` to the same endpoint). Its order metadata must
match. Use the normal refund action once Stripe confirms payment; an unpaid canceled object
releases the claim. Never infer no charge from an API error.

An explicit sandbox readiness check is available through
`POST /_studio/api/shop/readiness`. It reads current configuration without creating any provider object, order, entitlement or refund. Failures expire after five minutes;
success expires after six hours. The report records the check time and its limited scope.
Scheduled capability checks are read-only, at most four successful checks per day, with
backoff after failure. No extra permissions or checks apply to a shop without paid releases.

Paid objects live under `paid-parts/` in the private `PURCHASE_MEDIA` bucket, separate from
public `MEDIA`. Deployment creates that bucket, deploys the guarded Worker, then uploads and
verifies the files. Failure before deployment uploads nothing. An older public Worker has no
binding to those objects. Public routes also refuse the prefix if it is bound accidentally.

The studio can tune `PURCHASE_RATE_LIMITER` in its Wrangler configuration; deployment keeps
that binding’s chosen limit and period. It is an abuse control, not a spending allowance.

Stripe can initiate Managed Payments refunds within 60 days in certain cases, including
support escalations left unanswered for 48 hours, and can accept disputes. A customer’s
data-deletion request cancels their Managed Payments subscriptions. These are Stripe’s
rules, described in its [Managed Payments guide](https://docs.stripe.com/payments/managed-payments/how-it-works).
Provider reconciliation observes refunds and cancellation regardless of who requested them.

## Seller settings and recovery

`part.json.sale` supplies terms for each immutable release. `parts offer <id> --amount`
sets only a persistent price override. Other terms change with a new release. Offers are
versioned from all terms, resource and price; a buyer keeps the version they purchased.
The build does not write `parts/offers.json`. Only the newest release sells by default;
`--release <version> --keep-on-sale` retains an older release. Release settings merge,
so adding an included upgrade does not silently withdraw an older release.

`--withdraw` closes new sales; `--on-sale` explicitly reopens an offer. Deployment expires
obsolete open Checkout sessions. A completed payment is honored even if its webhook
arrives after withdrawal or another release. `parts retire` closes sales and cancels
future subscription billing, preserving already-paid periods. `--upgrade included` may
add rights; changing it back cannot revoke promised or already-granted releases.

`intentMinutes` is 30–1440 and controls the approval intent before Checkout. Stripe chooses
the Checkout Session's default expiration, keeping retry parameters stable. Download
credentials last five minutes. Reconciliation happens once per grant rather than per file.
The studio can configure its abuse rate limit; it is not a spending cap.

`refundWindowDays` enables buyer self-service refunds when present and positive. It counts
from the current payment's paid timestamp, including renewals. Otherwise ask the seller.
`refundEndsSubscription` cancels future billing only after a successful full refund.
Pending or failed refunds keep billing intact. Credit-only invoices have no charge to refund.
`immediateDelivery: true` adds the consumer immediate-delivery acknowledgement beside Pay;
the seller chooses it to match its full licence and obligations.

A public test-card payment gets no protected files until the owner identifies the order
and runs `parts test-access <order>`. This authorizes that claim only while the shop remains
in test mode. Reissue needs new approval. Never approve an unknown test buyer. Use a second
studio for tests: one Worker has one Stripe key/mode, and switching a live shop to test
interrupts its live buyers. A grant or proof from test never becomes a live purchase.

Claims, download tokens and pristine backups live in `.homie/paid-parts`, outside public
source. Back them up privately. A long-lived Ed25519 proof cannot download; a short-lived
grant can. Updates derive from the purchased licence. A verified backup restores offline;
new delivery and updates require the seller to remain reachable. There is no project escrow.

If a claim is lost, `parts recover <seller>/<part> --order <order>` generates a new private
claim and public claim hash. Give the hash and Stripe receipt to the seller. The seller
matches the payer/receipt in Stripe and runs `parts reissue <order> --claim-hash <hash>
--receipt-verified`. Never pass `--receipt-verified` on the assistant's own word. Reissue
revokes the former claim and downloads. An order ID alone proves nothing. A healthy local
claim cannot be overwritten by recovery. Transfer requires the purchased terms to allow it.

`parts manage` creates a fresh Stripe portal session. Without a local record, a seller's
configured `purchasesPortalLogin` lets Stripe authenticate the buyer and provide billing and
receipt access for assisted recovery. Run refunds only when requested by the person.

Paid resource setup uses the `shop connect` page for `TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET` (hosted fallback), and `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`
(live Base). Machine and fallback readiness are independent. Base is an explicit choice
with manual refund responsibility; Tempo is disabled. If Stripe cannot record a settled
Base transfer, the office names the payer, token, atomic amount and transaction. Send any
owed refund from the studio's own wallet and use `shop refund <order> --manual-transaction
<hash>` to verify and record it after owner confirmation. Missing storage never authorizes
an automatic refund. Configure the studio's own Base RPC in purchase settings for recovery.

The recovery status `fulfilled` means the purchased files are available and the entitlement
has been issued; it is not proof that the buyer downloaded them. An unpaid challenge retains
a five-minute quote row so a retry uses the same terms and the owner can grant test access.
It creates no provider object. Cleanup removes that row only if no provider or settlement job
was ever attached. A paid order whose files cannot be restored needs an owner's manual refund.
