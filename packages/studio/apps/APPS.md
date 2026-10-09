# One screen, roles, parts

`homie-studio app new welcome` writes `apps/welcome/app.json` and the welcome scene. Games and apps share one ID namespace, bundle/room/TV/watch pipeline, parts, shop and standalone builds. Source apps build into the compatibility asset namespace `site/dist/games/<id>`; `games.json` uses `kind: "app"`. Public manifests expose `apps[]` with `open` and `wall` addresses separately from `games[]`.

Open `/<id>/open`, its landing `/<id>/`, or its wall `/<id>/tv`. `?surface=kiosk` and `?role=customer` choose a declared public presentation. The phone surface must be public for standalone customer builds. Every app remains one view that transforms; roles choose what is visible and permitted, not a menu of pages.

## Lasting records

The studio's existing D1 stores app records independently of room checkpoints. Deploy/dev apply `0014_studio_apps.sql`; old studios gain it through the normal migration helper. Previews without D1 return a clear unavailable response, never pretend to persist. Room saves still expire according to the room contract.

```ts
import { createAppRecords } from '@homie-rocks/studio/apps';
const queue = createAppRecords<{ label: string; status: string }>({ collection: 'queue' });
const rows = await queue.list();
await queue.create({ label: 'A17', status: 'waiting' });
await queue.update(rows[0], { ...rows[0].data, status: 'called' });
await queue.remove(rows[0]);
queue.dispose();
```

The shell handles requests only from its own frame and uses its own role, link and account, never authority claimed by the message. The Worker checks every request. Roles declare `signIn: boolean` and `can: ["read:queue", "create:queue", "update:queue", "delete:queue"]`. Collections declare fields with `type` (string/number/boolean), optional `required`, `maxLength`, `enum`, and `initial` (the only value allowed on create). Unknown fields are refused. Records are at most 8 KB, collection reads at most 1,000 records, request bodies at most 12 KB. A full collection refuses creates. This is a small operational helper, not an unbounded ledger.

Generate a fresh ID for every new record; never reuse a deleted ID. Updates and deletes compare `version` atomically. Conflicts return 409; reload and resolve them. A successful write is committed before acknowledgement. Records are scoped by app and collection, not by room. Deleting a room does not delete records. With `records.persist: false`, use netplay keyed state for transient data instead. Database failures are visible and never replaced with fabricated local success.

Use existing netplay events for refresh notices and shared animation. A missed or malicious notice cannot change authoritative records: reload them on reconnect and at a bounded fallback interval. The starter polls every two seconds and accelerates on room notices. Browser hosts remain untrusted for business data. Public collection reads reveal the whole public collection; ticket IDs and UI filtering are not access control. Use separate protected collections for private data.

## Staff

`homie-studio app role welcome staff --url <origin>` returns an unpredictable role address for the owner. Add `--player <account-id>` to grant an existing non-guest account, or `--revoke` with that player to remove it. The command reuses the office's short-lived owner key. Accounts/passkeys and the office owner's existing session are reused. An anonymous browser with the link goes to `/account/` to sign in; a signed-in account without a grant receives 403. Every record call rechecks the grant, so revocation applies to open tablets too.

The private address hides the staff entrance; it is not a bearer permission. It is never in public metadata. Passkeys require HTTPS or localhost. `dev --lan` exposes the local site to the same Wi-Fi, but does not weaken staff authentication. On local HTTP, provision test sessions explicitly in tests or use a secure local origin for real sign-in.

## Links and plain HTTP

```ts
import { appLink, qrSvg, randomId } from '@homie-rocks/studio/links';
const ticket = randomId(); // 128 cryptographic bits through getRandomValues
const url = appLink('/welcome/open', { ticket, room: 'main' }, 'https://studio.example');
const svg = qrSvg(url, { title: 'Your ticket' });
```

The QR encoder is the existing wall encoder, publicly exported with types. Links allow HTTP(S), preserve parameters and encode values. Do not copy `access` or any other private parameter into a public ticket. The helper works on LAN HTTP, where `crypto.randomUUID` may not exist.

## Parts, check and stores

Parts import exactly as games do (`@parts/<id>` or `@parts/<host>/<id>`), with the same provenance and credit checks. `check.action` and `check.observe` name real UI selectors: the checker clicks on a phone, waits for changed text on wall and both phones, then reloads the actor and checks again. No round hooks are required. This performs the declared action and writes real records: use a local/test studio or a workflow explicitly safe to exercise.

`homie-studio standalone plan/build <app-id>` reuses Electron/Capacitor and the same built bundle. Public customer record calls use the existing standalone origin allowlist; credentials are never shared across origins. Native staff sign-in, private collections, offline record writes, native billing and automatic store upload are not implemented. Existing game standalone behavior is unchanged. A store build still needs its normal local SDK, signing and store review.
