# Fresh Maya trial and final-pack verification

A new `codex exec --ignore-user-config --ephemeral --skip-git-repo-check
--sandbox danger-full-access` ran in the empty `/tmp/homie-maya-final-bUYeYT`
folder with `prompt.txt` on stdin. It installed only the supplied npm pack,
read packaged guides, built Coldsmoke Tuning, and used the authorised
`Homie sandbox` CLI profile. `REPORT.md` is its unedited assessment; original
failures and selected screenshots are retained. Unlike `../maya/`, this trial
used actual Stripe sandbox Checkout and signed events, not the offline simulator.

The AI found that the records-only shell omitted the shop bridge, and worked
around that with the room shell. The parent fixed the toolkit and added a browser
regression proving booking requests and returned IDs through a records-only frame.

## Final package

The parent installed the final 0.51.0 archive in the retained studio, verified its
runtime identity and packaged guide against the checkout, and reran strict build
and the generic app check. See `parent-final/provenance.json`. The original AI's
pack hash remains in its report; that report is not relabelled a final-head run.

The generic checker had returned non-green because payment and staff needs had
empty assertion lists. The parent added executable receipt, wall and staff-move
assertions in `parent-final/CODEX.md`, then ran `check tune --no-isolate` on the
actual sandbox-paid records. All four needs pass on phone, wall and staff. This
explicit existing-record check proves displayed paid state and a real staff move;
the separate Stripe acceptance proves charging. Historical failures remain intact.

On the final runtime the parent also made a new phone hold, captured Stripe's
hosted sandbox page without entering card details, completed payment through the
published CLI fixture API, confirmed the paid record on phone/wall, and refunded
it through the API. The phone showed Released in-place. The first capture script
used the wrong held-state text; another wait timed out while the phone was behind
the Checkout window. The retained timeout is not a provider failure: the verified
record was already confirmed. The follow-up foregrounded the phone and proved
payment display and refund release. See `parent-final/payment.log` and captures.
Final packaging afterward changed documentation only; runtime bytes matched the
payment-tested build, and the exact final archive was reinstalled and checked.

| Maya's need | Verdict |
|---|---|
| Book a tune on a phone | Met in local Chrome touch emulation |
| Pay and retain the last seat | Met in real Stripe sandbox |
| Release an expired or refunded seat | Met in real Stripe sandbox |
| Workshop wall follows paid bookings | Met locally |
| Authenticated staff move bookings | Met locally |
| Generic app check | Pass on retained sandbox-paid records |
| Production one-approval Stripe setup | Not met; runtime integration remains required |

No deploy, merge, live payment, card entry or exported API credential. The parent
inspected phone, wall and hosted Checkout captures. Physical phone/LAN testing,
Maya's approval of demo pricing/schedule and production staff onboarding are not
claimed. Temporary studios, private bindings, tarball and started processes were
removed after selected evidence was archived.
