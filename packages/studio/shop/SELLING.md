# Selling things in your games: what you are taking on

Plain words for a studio's owner, from the Homie studio kit. **This is not legal or tax advice.** If you will
sell for real, ask an accountant where you must register for tax, and a lawyer anything this page leaves you
unsure about.

## The short version

You sell with **your own Stripe account**. Money goes straight from your players to you. Homie never sees it,
never holds it, and takes no cut. That also means **you are the shop**: you set the prices, you answer refund
requests, you deal with card disputes, and the tax on your sales is yours to handle.

## Who does what

| | You (the studio) | Stripe | Homie |
|---|---|---|---|
| Prices, what you sell | yes | | |
| Taking the card, the receipt email | | yes | |
| Refunds | yes: one tap in your office | carries them out | |
| Card disputes (chargebacks) | yes: you answer them in Stripe and carry the loss if you lose | runs the process | |
| Sales tax and VAT | yes, with Stripe Tax's help (or Managed Payments, below) | calculates and collects | |
| Your players' data | yes: you are responsible for it | keeps the card and email | stores nothing |
| Who may buy | your editable shop policy; protective defaults | provider terms | supplies presets |

## Refunds

- A player can refund an **unused** item themselves within the optional refund window you set from their
  account page. Set `policy.refundUsedItems` to include used items. Without a window, buyers ask you for a refund.
  Fewer people turn to card disputes when a refund is easy.
- Anything else, you refund with **one tap** on your office's shop page. Your AI can only *ask* you to refund; it
  can never do it by itself.
- Stripe does not give back its processing fee on a refund. That is the cost of a happy player.

## Disputes (chargebacks)

- A buyer's bank can reverse a payment. Stripe charges a dispute fee (about US$15) whether you win or lose, and
  you lose the sale's money if the bank decides for the buyer. On a US$5 item one dispute costs more than the
  sale, so consider your costs when setting prices. Homie imposes no price or earnings ceiling.
- **A dispute never deletes or locks the player's account.** While it is open nothing changes. If you lose it,
  that one item is taken back, as a refund would.

## Tax

You choose who the seller is when you connect your Stripe (`homie-studio shop connect` shows both):

- **You are the seller** (`"till": "stripe"`): Stripe Tax is on. It works out and collects tax **only where you
  have told Stripe you are registered**, and it does not file your returns. Some places expect a foreign seller
  of digital goods to register from the first sale (the EU and the UK do). Cheapest; the most work.
- **Stripe is the seller** (`"till": "stripe-managed"`, Stripe Managed Payments): **3.5% more** a sale. Stripe's
  Link, LLC becomes the seller of record and registers, collects, files and pays sales tax and VAT in 80+
  countries, runs fraud checks and answers disputes for you. You still carry the money of a lost dispute, and
  Stripe may refund a buyer within 60 days. You turn it on in Stripe first (after Stripe's eligibility review).

## Kids

Your shop starts with the `protective` preset in shop.json. It requires an account and a neutral age question,
blocks purchases under 13, uses a parent's checkout for teens, closes shops on kids servers and kids studios,
hides advantages on beginner and kids servers, refuses paid randomness, countdowns and virtual-currency items,
and sends TV shoppers to a phone. Existing shops without a policy keep these protections.

These are **your settings**: read and edit `policy` in shop.json. `adults-only` also blocks teens;
`custom` enables all policies. You can override individual rules without changing the others. SHOP.md lists
every setting. No spending cap or refund window applies unless you set one; existing written values stay yours.

As the seller, you are responsible for the law and your payment provider's terms wherever you sell, including
rules protecting children. Choosing a preset does not establish compliance. This is information, not legal advice.

## Referrals

If another studio (or homie.rocks, or a creator) sends you a new player who buys something, you owe them the
referral share you published in `shop.json` (10% if you kept the suggestion; 0 if you turn it off). Your office
shows what you owe and to whom, and signs a monthly statement for each. **They invoice you, and you pay them
yourself.** Nothing moves through Homie.

## What you do, and what your AI does

Your AI sets the shop up with Stripe's own tools for AI (Stripe's agent plugin: its MCP server and skills). It
makes your products in Stripe, checks your tax settings, makes the webhook, and answers "how are sales?" by reading
your Stripe. What stays yours, in Stripe's own pages:

- making the Stripe account, and later activating it (your business details, bank account and identity checks);
- one sign-in page that lets your AI use Stripe's tools: give it your **sandbox** (test) first;
- one restricted key you make in Stripe and paste into a page on your own computer (never into a chat);
- approving anything Stripe asks you to confirm (a refund your AI asked Stripe for, for example), and every refund
  in your office.

If your AI's app cannot use Stripe's sign-in page, Stripe offers an "Agent" key for it instead. From 31 October 2026
Stripe's tools for AI accept only those (or the sign-in page). The shop's own key is a different, ordinary
restricted key; never make that one an Agent key, or Stripe will hold every refund for a second approval.

## Before the first real sale

1. Make (or pick) your Stripe account, verify it, and add a bank account.
2. Test everything in **test mode** first: buy your own item with a Stripe test card, refund it from the office.
3. Fill in your public business details in Stripe (name, support email, the refund page `/shop/refunds/`).
4. Talk to an accountant about where you must register for tax, or choose Managed Payments.
5. Then, and only then, connect a live key (`homie-studio shop connect --live`).
