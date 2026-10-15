# Checkout migration — unreleased

The owner installs Homie, generates (sandbox: reveals) the restricted key and
copies it. The local tool installs it via Wrangler stdin and clears the clipboard.

Checkout deployment and Worker-owned webhook bootstrap precede link retirement.
The owner's existing local Stripe CLI login, checked against the RAK account,
deactivates links; the Worker has no Payment Links permission. Open sessions are
expired, all receipt pages are checked, then a second pass runs after at least
30 seconds. Pending asynchronous payments retain old webhook configuration.
Only after drain succeeds are old hooks and link configuration removed.
`shop connect --finish` retries without another Copy. All financial rows remain.

Full real 0.53 migration and App-generated RAK acceptance remain required. See
[the RAK guide](../../../docs/stripe-rak-owner-guide.md) for exact steps and gates.
