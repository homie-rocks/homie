# Owner action checklist

A phone-first, one-tap confirmation surface for a studio's own pending tools: bookings,
refunds, requests and publication. Consequences are always visible before confirmation.
The UI is a reusable component, not an approval system or a source of authorization.

## For the AI integrating this part

Import `mountChecklist` from `@parts/owner-action-checklist` and include `src/style.css`.
Mount in an element owned by the app. Supply async `list()` and `execute(input)` callbacks;
`ready` resolves after initial loading, `refresh()` reloads, `dispose()` removes the UI.
Use your app's authenticated same-origin endpoint. Do not put credentials in a preview.
The CSS accepts `--checklist-ink`, `--checklist-card`, `--checklist-accent`.

Each item has unique string `id`, opaque string `revision`, `title`, `consequence` and
`confirmLabel`, and optional boolean `irreversible`. State the exact effect, amount/currency, recipient, visibility and
irreversibility where applicable. All labels render as text, never HTML. Limit: 100 items.

`execute` receives `{id, revision, operation: 'confirm'|'undo', key, token?}`.
A successful durable commit returns `{ok:true, message, undoToken?}`. `message` describes
what actually happened (past tense); it appears after “Done —”. `irreversible: true`
always labels the consequence before confirmation and suppresses undo even if a token arrives.
The visible states are Pending → Confirming → Done → Undone. During execution, the button
is disabled and live status announces progress. After undo, return `{ok:true,message,pendingItem}`
with a complete freshly revisioned proposal to re-enable confirmation. Without `pendingItem`,
the disabled button says “Undone”. The undo message should name the restored state, e.g.
“Saturday’s booking is back to pending.” Never return a pending proposal before restoration commits. Return an undo token
only for an operation your server can reverse; never show a refund as reversible. A token
must be bound to the authenticated actor, original action and deadline on the server.
The UI disables duplicate taps. An uncertain failure locks that revision for the lifetime
of the mounted component: reconcile from server state, returning a new revision only when
safe to act again. Do not automatically retry a financial/publication mutation.

### Worker integration

Import `createChecklistHandler` from the part's `src/handler.mjs`. Mount it at an exact
route in the studio Worker, supplying `{app:'your-app', list, act}`. It calls the existing
`isOwner(request,env)`, `hasRole(request,env,app,'staff')`, and `requireSameOrigin(request)`
from `@homie-rocks/studio/worker`. POST is checked for same-origin evidence before roles;
responses are not cached. No new roles, sessions, cross-origin bypass or tool router.

`list({request,env,owner,staff})` must filter to the actor's allowed proposals.
`act(context,input)` MUST reload the server-owned proposal and check its action-specific
permission (staff membership does not grant refunds or publishing), compare revision,
consume the proposal and persist the result/idempotency key atomically in the studio's
existing durable store. Use a provider idempotency key for external side effects. Return
prior results on repeated keys, reject stale revisions and expired/used undo tokens,
and reconcile unknown provider outcomes before issuing a replacement revision. Never
execute a client-supplied tool name, arguments, price or consequence. The adapter owns
these domain guarantees: the component cannot make separate provider/database commits atomic.

The `auth` override exists for tests; production should use the default helpers.
The preview uses in-memory fake results, clearly labelled, with no network mutations.

## Built from / rights

Original reusable UI from **Owner action checklist**, Homie toolkit; Ryan Campbell.
No third-party parts. Worker authorization uses `@homie-rocks/studio`.
Apache-2.0; preserve LICENSE and NOTICE and the part attribution.
