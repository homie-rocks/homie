---
name: shop
description: Sell things in a Homie studio's games with the studio's OWN Stripe - a supporter pack, cosmetics, a season pass, a one-time unlock, a tip - in real money, with Stripe Checkout, Stripe Tax or Stripe Managed Payments, refunds from the office, and the kids rules built in. Use when someone asks to sell something, add a shop or store, take payments or donations, make money from a game, set up Stripe, add a supporter badge, refund a player, or asks about chargebacks, sales tax, referral shares or affiliate links between studios.
---

# The shop

Needs `@homie-rocks/studio` 0.24.0 or later (`npx --no-install homie-studio upgrade --apply`, then deploy).
The guide is `node_modules/@homie-rocks/studio/shop/SHOP.md`; the owner's plain words are `SELLING.md`.

**The model, said plainly to the person.** The studio sells with **its own Stripe account**. The studio is the
seller: its prices, its refunds, its disputes, its tax. Money goes straight from players to the studio's Stripe;
**homie.rocks never sees it, holds it or moves it, and Homie takes no cut.** There is no shared currency between
studios. This is not legal or tax advice; for selling for real, the owner asks an accountant where to register.

## Never

- Never ask for a Stripe key, a webhook secret or any password in the chat, and never write one into a file, a
  command line, a commit or a log. Keys go in only through `homie-studio shop connect` (a page on the owner's
  own computer).
- Never refund, mark a referrer paid, or switch to live keys by yourself: you **ask**, the owner taps.
- Never touch a Stripe account with the Stripe CLI or any other login you find on the computer. Only the owner's
  own pages and the studio's own Worker talk to Stripe.
- Never sell anything random (loot boxes, mystery crates, spins), never a currency (gems, coins, points), never a
  countdown, never pay-to-win on a beginner or kids server, never anything on a kids server or in a studio made for
  children. The kit refuses these anyway; do not look for a way around it.
- Never put a buy button on the play, start or wake button, never open the shop on a timer, never word a sale at
  children ("ask your parents!"). The television never sells.

## Do

| The person says | Run | What happens |
|---|---|---|
| "Sell a supporter pack for $5" | `npx --no-install homie-studio shop init --supporter` (then `shop check`) | `shop.json` with a US$5 Supporter pack (a badge on their profile and beside their name in rooms, for a year; it changes nothing about play) and `SELLING.md`. Commit both. |
| "Sell a skin / a season pass / the full game" | edit `shop.json` `items` (`kind`: `cosmetic`, `pass`, `unlock`; `price` in cents; `gives`: the keys the game reads), `shop check` | Real money only. An item that changes how the game plays gets `"advantage": true`: never sold or counted on beginner servers. Under US$3 the check warns: fees eat it. |
| "Let people tip" | an item `{ "kind": "tip", "price": "choose", "min": 200, "max": 5000 }` | Pay what you want between min and max. |
| "Connect my Stripe" / "turn the shop on" | `npm run deploy` (migration 0008), then `npx --no-install homie-studio shop connect` and give the owner the 127.0.0.1 link it prints | The page tells the owner what to make in Stripe (a restricted key with Checkout Sessions: Write, Charges: Write, PaymentIntents: Read, Disputes: Read; a webhook to `<site>/api/shop/hook` with the listed events), takes both, and asks **who is the seller**: the studio (Stripe Tax on) or Stripe (Managed Payments: 3.5% more; Stripe registers, files and pays the tax and answers disputes). TEST keys only; `--live` only when the owner says the shop is ready to sell for real. |
| "Is the shop working?" | `npx --no-install homie-studio shop` | Open (test or live) or exactly what is missing, the last 30 days, the webhook address. |
| "Show me the sales" | `shop orders`, or the owner's `/_studio/office/shop` | Orders with their Stripe pages; payouts, disputes, balance and tax as links to the studio's own Stripe Dashboard; a CSV for the accountant. |
| "Refund that player" | `npx --no-install homie-studio shop refund <ord_…> --note "<why>"` | An ASK: give the owner the one-tap link. In the office the owner's own Refund button does it at once. The item leaves the player's account; the money goes back in 5 to 10 days. |
| "Someone charged back" | nothing to undo: the owner answers it in Stripe (the office links it) | While open nothing changes; lost: that one item goes; won: it stays. **The account is never locked or deleted over a dispute.** |
| "Show the item in the game" / "the supporter badge" | in the game: `createShop()` from `@homie-rocks/studio/shop`; `shop.has('skin:ember')`, `shop.on('change', …)`, `shop.open('ember-skin')` from a button the player pressed, `shop.used(key)` when equipped | The play shell answers for the signed-in player; a badge rides on their seat as `peer.badge` (the Worker sets it, never a hello). |
| "Pay studios that send us players" / "affiliate links" | `shop.json` `referrals` (rate, window, hold), `shop statements [--send]` | A `?via=<host>` link from another site (homie.rocks is one more referrer, on the same terms) counts for a new player's purchases; statements are signed with the studio's key; the referrer invoices the studio; the owner pays and marks it paid (an ASK from you). Nothing moves through Homie. |

## Who may buy (the kit decides; tell the person)

A guest makes an account first (a passkey). Every account answers one neutral question once: the year they were
born (no default; kept only as adult, teen or child). Under 13: nothing, ever. 13 to 17: a one-time link a parent
opens on their own phone and pays in their own name. Adults: Stripe's own hosted page, one item at a time, with a
monthly cap (US$50 at most). A kids server shows no shop. A TV's store sheet is a code to buy on a phone.

## The first sale (the acceptance)

In test mode: buy the supporter pack on a phone with Stripe's test card `4242 4242 4242 4242`, see "It's yours",
see the badge on the account page and beside the name in a room (from the next room the player joins), refund it
from `/_studio/office/shop`, and see the badge go. A kids server's room shows no shop; `/<game>/tv` shows only a code.
