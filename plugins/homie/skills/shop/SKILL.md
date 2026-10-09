---
name: shop
description: Sell things in a Homie studio's games with the studio's OWN Stripe - a supporter pack, cosmetics, a season pass, a one-time unlock, a tip - in real money, with Stripe Checkout, Stripe Tax or Stripe Managed Payments, refunds from the office, and optional studio policies with an open default; set up with Stripe's own agent tools (Stripe's MCP server and skills) with browser approval first and an explicit manual fallback where Stripe cannot issue Worker credentials. Use when someone asks to sell something, add a shop or store, take payments or donations, make money from a game, set up or connect Stripe, make the products in Stripe, asks "how are sales?", about tax or Managed Payments, to add a supporter badge, refund a player, or about chargebacks, referral shares or affiliate links between studios.
compatibility: The studio's own current toolkit with stripe_login or shop connect --renew, Wrangler, and the official Stripe CLI. Stripe's own agent plugin (MCP and skills) is optional for catalog work and analytics.
metadata:
  providers: stripe
---

# The shop

Check that the toolkit exposes `stripe_login`, or that `homie-studio --help` lists `shop connect` with `--renew` and `--manual`. An older toolkit's default is the paste page: upgrade before using this flow; do not send the owner to that old default.
The guide is `node_modules/@homie-rocks/studio/shop/SHOP.md`; the owner's plain words are `SELLING.md`.

**The model, said plainly to the person.** The studio sells with **its own Stripe account**. The studio is the
seller: its prices, its refunds, its disputes, its tax. Money goes straight from players to the studio's Stripe;
**homie.rocks never sees it, holds it or moves it, and Homie takes no cut.** The studio is responsible for the law where it sells and for Stripe's terms.

## Connect with Stripe's own browser approval

Use `stripe_login` (MCP) or `npx --no-install homie-studio shop connect`. Test mode and a
sandbox first. If the CLI is missing, run the one installation command the result gives:
`npm install -g @stripe/cli@latest`. The toolkit opens Stripe's page and completes its official
non-interactive login. Give the person the pairing code; they select their own account and approve.
Use `studio_job` for the background result. Do not call a raw CLI config command: it may print secrets.

Be honest: Stripe's current CLI OAuth connects the AI, but has no supported export of a Worker key.
The result `worker-credential` means selling is **not connected**, even after browser approval.
Legacy CLI pairing can supply a 90-day test key; the toolkit transfers it without displaying it,
creates the webhook and saves both Worker secrets. No public API creates a shop-only restricted key.
Do not downgrade the CLI, extract keychain tokens, or put the agent in the checkout money path.
The upstream findings are `docs/stripe-connect-research.md` in Homie's source checkout.

## Never

- Never ask a person for a Stripe key, a webhook secret or a password in chat. Never display a CLI
  config, credential response, environment value or raw login-completion output. The toolkit captures
  these privately. Keys belong to the studio; no Homie account or service takes payments.
- **Never make a webhook endpoint or an event destination through Stripe's MCP**: its signing secret
  would enter the conversation. `shop connect` handles endpoint creation and secret storage privately.
- Never silently select `--manual`. Only when the owner chooses the fallback, run
  `shop connect --manual` (or `--manual --live`) and give the local page link. The page explains the
  remaining Dashboard restricted-key step and creates the webhook automatically. This fallback
  requires copying a key and does not meet the one-approval target; say so plainly.
- Live mode only when the owner says go live. Account activation, tax, bank details and Stripe
  approval links are the owner's. Never approve a Stripe confirmation link for them.
- The studio chooses its settings. Omitted policies are open; choose a preset only when requested.

## The owner's steps, for a creator with a fresh Stripe account

| The owner | You |
|---|---|
| Creates/verifies their Stripe account on Stripe's own pages if needed; approves the browser pairing for their sandbox. | `shop init`, `shop check`, then `stripe_login` / `shop connect`. Check the result, not just whether login succeeded. |
| Approves Cloudflare separately if not connected yet. | `cloudflare_login`, `studio_deploy`, then rerun `shop connect`. Approval before deploy is reusable; an HTTPS deployment is required for the webhook. |
| Nothing while supported test credentials are installed. | The toolkit creates the endpoint, captures the secret, and saves both credentials to the Worker. Verify the first test purchase below. No catalog is required for inline products; `shop catalog` reconciles a separate Stripe catalog if wanted. |
| Chooses the manual fallback, if they want to continue when the result says `worker-credential`. | Explain that OAuth does not supply the independent Worker's key. Offer the fallback; do not ask for the key. The local fallback page guides the Dashboard step. |
| Approves Stripe again when a legacy key expires. | Rerun `shop connect --renew` before the returned expiry; valid installed connections are reused. OAuth refresh is automatic for CLI operations, not the Worker's key. |
| Says “go live” and completes Stripe's account activation. | `shop connect --live`. Live key export is unsupported; name the gap and the optional `--manual --live` fallback. Reconcile the live catalog if used; verify a real purchase/refund only when authorized. |

## Optional Stripe agent tools

For catalog work, analytics and advice, `stripe agent setup` installs Stripe's own agent plugin and
skills; its OAuth MCP is `https://mcp.stripe.com`. This is optional and separate from Worker credentials.
Check `get_stripe_account_info` before writes; confirm the account and mode match the studio.
The tools include `stripe_api_read`, `stripe_api_write`, API discovery and `stripe_analytics`.
From **2026-10-31**, MCP rejects API keys without the Agent tag; OAuth remains supported. Agent keys
can put refunds behind Stripe approval. A returned confirmation link belongs to the owner; wait
for approval before retrying. Do not silently replace the payment runtime with MCP; a separate persistent MCP client would need its own production verification.

## Do

| The person says | Run | What happens |
|---|---|---|
| "Sell a supporter pack for $5" | `npx --no-install homie-studio shop init --supporter` (then `shop check`) | `shop.json` with a US$5 Supporter pack (a badge on their profile and beside their name in rooms, for a year; it changes nothing about play) and `SELLING.md`. Commit both. |
| "Sell a skin / a season pass / the full game" | edit `shop.json` `items` (`kind`: `cosmetic`, `pass`, `unlock`; `price` in Stripe currency units; `gives`: the keys the game reads), `shop check`, then `shop catalog` again | Kinds are studio labels, without a fixed list. `"advantage": true` follows the studio policy for beginner and kids servers. Homie sets no price ceiling. |
| "Let people tip" | an item `{ "kind": "tip", "price": "choose", "min": 200, "max": 5000 }` | Pay what you want; amounts follow Stripe currency requirements, and max is optional and chosen by the studio. |
| "Make the products in Stripe" | `shop catalog`, then the read with `stripe_api_read`, then `shop catalog --have <file>` | The exact `stripe_api_write` calls still needed (one Product an item, id `homie_<studio>_<item>`, with a tax code and a default Price of shop.json's amount); a changed price is a new Price made the default; a removed item is archived, never deleted. In sync, shop.json `catalog` records the mode and checkouts name the Products. shop.json's price is always what is charged. |
| "Connect my Stripe" / "turn the shop on" | `stripe_login` or `npx --no-install homie-studio shop connect` | Stripe browser approval; automatic test credentials and webhook where supported. Follow `deploy`, `renew` or `worker-credential` in the result. `--manual` only if the owner chooses the fallback; `--live` only when they say go live. |
| "Is tax set up?" | `stripe_api_read` `GET /v1/tax/settings`, and `GET /v1/tax/registrations` | Seller "stripe": Stripe Tax needs `status: active` (the business address in Settings, Tax), or checkouts fail; with no registrations it collects no tax anywhere: say so, the accountant decides where to register. Seller "stripe-managed": Stripe files the tax; the connect page's test checkout said whether Managed Payments is on. Change nothing yourself. |
| "Is the shop working?" | `npx --no-install homie-studio shop` | Open (test or live) or exactly what is missing, the last 30 days, the webhook address. |
| "How are sales?" / "Show me the sales" | `shop` and `shop orders` first (the studio's own books); with Stripe's MCP, read-only: `stripe_analytics`, or `stripe_api_read` on `/v1/balance`, `/v1/payouts`, `/v1/checkout/sessions` | Counts, money and payouts in a few lines; never a buyer's name, email or card. Never a write to answer a question. The owner's `/_studio/office/shop` links every Stripe page and gives the accountant a CSV. |
| "Refund that player" | `npx --no-install homie-studio shop refund <ord_…> --note "<why>"` | An ASK: give the owner the one-tap link (in the office their own Refund button does it at once). The item leaves the player's account; the money goes back in 5 to 10 days. If the owner asks you to refund through Stripe's MCP instead, Stripe answers with its confirmation link: theirs to approve; the webhook takes the item back when Stripe refunds. If a refund comes back "held", the shop's key is an Agent key: the owner approves it in Stripe (Settings, Approvals) and reconnects with a plain restricted key. |
| "Someone charged back" | nothing to undo: the owner answers it in Stripe (the office links it) | While open nothing changes; lost: that one item goes; won: it stays. **The account is never locked or deleted over a dispute.** |
| "Show the item in the game" / "the supporter badge" | in the game: `createShop()` from `@homie-rocks/studio/shop`; `shop.has('skin:ember')`, `shop.on('change', …)`, `shop.open('ember-skin')` from a button the player pressed, `shop.used(key)` when equipped | The play shell answers for the signed-in player; a badge rides on their seat as `peer.badge` (the Worker sets it, never a hello). |
| "Pay studios that send us players" / "affiliate links" | `shop.json` `referrals` (rate, window, hold), `shop statements [--send]` | A `?via=<host>` link from another site (homie.rocks is one more referrer, on the same terms) counts for a new player's purchases; statements are signed with the studio's key; the referrer invoices the studio; the owner pays and marks it paid (an ASK from you). Nothing moves through Homie. |

## Your shop, your choices

The default is open: guests buy repeatedly without an age question, with any wording or kind, from any page.
`shop init` writes no policy. A released shop file without a preset now uses the open default.
Write `"policy": { "preset": "protective" }` to retain earlier account and age behavior.
`adults-only` is another optional bundle. Neither scans content. SHOP.md lists individual overrides.

The studio can set items, quantities, prices, tip ranges, entitlements, sale dates, currency, optional
`automaticTax`, `capPerPlayerMonth`, `refundDays`, referral terms and configurable flood protection.
No toolkit amount or duration ceiling applies. Stripe currency constraints and safe integer arithmetic apply.
A refund window includes used items unless `policy.refundUsedItems` is false. A player cannot refund a tip;
the office can refund any order or line. Guest purchases stay owned when the buyer signs in later.

For carts: `shop.add(item, quantity, amount?)`, then `shop.checkout()`; `shop.buy(item)` buys directly.
Free and paid lines share one order and one Stripe Session. The studio chooses where to open the shop.

## The first sale (the acceptance)

In test mode: buy the supporter pack on a phone with Stripe's test card `4242 4242 4242 4242`, see "It's yours",
see the badge on the account page and beside the name in a room (from the next room the player joins), refund it
from `/_studio/office/shop`, and see the badge go. With the protective preset, a kids server's room shows no shop and `/<game>/tv` shows only a code.

The optional manual fallback accepts restricted (`rk_`) or full secret (`sk_`) keys; recommend restricted permissions for this shop.
Checkout setup includes both the Stripe key and webhook signing secret; readiness names either missing step.
The studio can set `checkoutMinutes` from Stripe's 30-minute minimum to its 1440-minute (24-hour) default and
maximum (values below 31 use 31 for transport margin). Cancelling a named checkout or replacing an open checkout at least a minute old asks Stripe to expire it before releasing its reservation.
Free carts grant locally. Game checkout uses a separate tab when available, otherwise the same tab and returns to the game or TV page. Cookies must work before buying. Each recorded payment checks Stripe’s refunds and dispute state. Refund books follow Stripe’s refund list: named lines only, untagged partial refunds on the order, and revocation only after success.
The additive 0012 schema step tolerates the released Worker during deploy and rollback; before the step,
new code keeps owned items and office refunds available while new sales wait.
