# Players and cloud saves

A studio's games can keep progress that lasts: a character that levels up for days, unlocks, a collection,
lifetime stats, a hardcore mode with a hall of the fallen. It follows the player to every device they sign in
on. Everything lives in the studio's **own** Worker and D1, on its own Cloudflare account: no third party, no
tracker, no cookie from anyone else, and no other studio can see these players.

## Rooms are rooms; saves are saves

A public room is tonight's match. It keeps the live round (bodies, the clock, the world) and **forgets everything
60 seconds after its last player leaves**. That is right for a round and wrong for a hero. So a persistent game
keeps two kinds of state apart:

| | The room (`@homie-rocks/studio/netplay`, `createRoom`) | The save (`@homie-rocks/studio/saves`) |
| --- | --- | --- |
| Lasts | while anyone is in the room (+60 s) | until the player deletes it |
| Belongs to | the room; the host browser runs the rules | one player, one game |
| Holds | positions, enemies, pickups, the round's score | name, level, gold, inventory, unlocks, settings |
| Written | 20 times a second, in memory | when it changes, at most about once a second |

The pattern (the `ember-vale` starter does exactly this):

1. When the player arrives, **load** the hero from saves; until it loads, play as a level-1 body.
2. The host decides what happened (who killed what) and tells **that player's own browser** (a netplay event
   to its seat). Only the hero's own browser changes the hero and **saves** it.
3. The room carries what the others need to see (my level, so my health bar is right; my hero's name, so it is
   the name over my head), never the save itself. The name goes to the host as an event, and the host keeps every
   seat's in keyed state (`net.state('heroes', { [seat]: name })`), which a new host and a late joiner already have.
   On a kids server nobody's typed name reaches anyone else: the others keep seeing the room's handles.

## Quick start

game.json:

```json
{ "id": "my-rpg", "saves": true }
```

`src/main.ts`:

```ts
import { createSaves } from '@homie-rocks/studio/saves';   // also in '@homie-rocks/studio/port'

interface Hero { name: string; level: number; xp: number; gold: number }
const saves = createSaves({ game: 'my-rpg' });

let hero = (await saves.get<Hero>('hero')) ?? { name: 'Wanderer', level: 1, xp: 0, gold: 0 };
// … the hero gains something:
hero.gold += 25;
await saves.set('hero', hero);          // safe on this device at once; in the cloud when online

// The player signed in on this device (or signed out): these are someone else's saves now.
saves.on('player', async () => { hero = (await saves.get<Hero>('hero')) ?? newHero(); });
```

`"saves": true` turns on the play page's saves bridge for that game, and a "Your progress follows you" link on its
landing. Pressing Play never needs an account.

## Who the player is

- **A guest** is made the first time a game saves something (never on Play). Their progress is kept on the server
  for that browser (a cookie that is this site's alone) and in that browser's local copy.
- **An account** is a guest (or anyone) who made a **passkey** on this site: Face ID, a fingerprint, a PIN or a
  security key. No password, no email. A guest who makes an account keeps everything: it is the same player.
- **Another device**: "Sign in" with the same passkey. The device's own passkey sync carries it (iCloud Keychain,
  Google Password Manager, a password manager), or the browser offers a phone's QR code. The same saves are there.
  A guest who signs in to an account they already have loses nothing: what only the guest had (keys, stats,
  memorials) moves over, and a key both have is combined ("When a guest signs in to their account", below).
- **Recovery**: add another passkey on another device or a security key (`/account/`). A **recovery email** is
  offered only when the studio has a mail sender: a Cloudflare Email Service binding named `PLAYER_MAIL`
  (`"send_email": [{ "name": "PLAYER_MAIL" }]` in wrangler.jsonc; Email Sending needs the Workers paid plan and a
  domain onboarded to it) and a `PLAYER_MAIL_FROM` variable on that domain. The address is confirmed by a
  one-time link, and a recovery link lets the player make a new passkey; the old sessions end.
- **Names** follow the same rules as a room's names: one line, at most 24 characters, whitespace collapsed, no
  control, zero-width or bidi characters, at least one letter or digit, never a role ("admin", "moderator",
  "owner", "official"…) or the studio's own name, and always drawn as text. A guest's name is a two-word handle
  until they choose one. A signed-in player plays under their name in every room of the studio.
- The game can show who is playing (`saves.player`: `name`, `guest`, `signedIn`, `owner`) and offer
  `saves.signIn(reason)` from its own button: the play page shows its sign-in sheet over the game.
- **The account page** is `/account/` on the studio's site: make an account, sign in, name, passkeys (add,
  remove), recovery email, download everything, delete everything.

Passkeys belong to the **host name** they were made on. Accounts made on a studio's workers.dev address do not
sign in on its custom domain later: give a persistent game its final address before people make accounts. A
Preview (a branch's own URL) has no database, so it has no accounts. In `npm run dev`, open
`http://localhost:8787` (not `127.0.0.1`): a passkey needs a name, not an IP address.

## The API

`createSaves(options?)`:

| Option | |
| --- | --- |
| `game` | The game's id (names the local-only store). On a studio site the shell's own game id is used: a game can only ever reach its own saves. |
| `onConflict(c)` | Another device saved a key since this one's copy. Return the value to keep (merge `c.mine` and `c.theirs`), or `undefined` for the cloud's (the default). |
| `local` | `true` forces local-only mode (tests, a game outside a studio). |

| Call | |
| --- | --- |
| `ready` | Resolves with the player once their saves are loaded. |
| `player` | `{ id, name, guest, owner, signedIn, local }`. |
| `peek(key)` | The last known value, at once (for a render loop). |
| `get(key)` | The value, or `null`. |
| `set(key, value)` | `{ ok, synced, version }`. JSON only. Resolves when synced, or after about 4 s with `synced: false` (it is safe on this device and syncs later). |
| `remove(key)` | Delete one key. |
| `list()` | `[{ key, version, updatedAt, pending }]`. |
| `wipe({ keep })` | Delete this game's saves except `keep` ("new game"). Stats and memorials stay. |
| `stats.add({…})`, `stats.max({…})`, `stats.min({…})`, `stats.get()` | Lifetime numbers that only add up, or keep the highest or lowest: kills, gold earned, seconds played, best level, fastest run. A wipe or a death keeps them. |
| `fall({ character, summary, wipe, keep })` | A memorial in the hall of the fallen; with `wipe: true`, this game's saves (except `keep`) are deleted in the same database transaction. |
| `fallen({ limit, mine })` | The hall of the fallen: the newest memorials of this game (`{ character, player, summary, at }`, no player id). |
| `rename(name)` | The player's display name on this studio. |
| `signIn(reason?)` | Show the sign-in sheet. Call it from a button the player pressed. |
| `flush()`, `status()` | Wait for the cloud; `{ mode, online, pending, lastSyncAt, lastError }`. |
| `on('player' \| 'synced' \| 'status' \| 'conflict' \| 'error', fn)` | Returns an unsubscribe function. |

Without a studio around it (the game opened as a plain file, in a Vite dev server, or a game.json without
`"saves": true`) the same calls keep everything in that page's own storage (`mode: 'local'`).

## Offline, versions and conflicts

The play page keeps a copy of the player's saves in that browser and an **outbox** of changes. A `set` while
offline is safe at once and syncs when the connection comes back (the `online` event, and retries that back off
to 30 s), in order: memorials first, then saves, then stats. Leaving the page sends what is left.

Every key has a **version** that goes up by one with each write. Every change names the version it was made from,
so a stale copy never overwrites newer progress silently: if another device saved the key in between, the change
is a **conflict**. By default the newer cloud copy wins and the game hears `conflict`; with `onConflict` the game
decides (merge two inventories, keep the higher level). This is also what stops a hardcore hero from coming back:
an old offline copy of a dead hero is a conflict with the wipe, and the wipe wins.

A write is atomic **per key**, not across keys: keep one character in one key.

## When a guest signs in to their account

Somebody plays as a guest, then signs in to the account they made on another device. Both players have saves.
Whatever only the guest had moves to the account as it is (keys, stats, memorials), and the guest is gone. For a
key **both** have, the game says how the two combine, once, when the studio's Worker loads
(`site/src/worker.mjs`):

```js
import { mergeSaves } from '@homie-rocks/studio/worker';

mergeSaves({
  'night-run': {
    saves: {
      'server:career-v1': { union: 'matches', by: 'id', order: 'endedAt', keep: 100 },
      settings: 'newer', 'best-level': 'larger', coins: 'sum', 'slot-*': 'account',
      inventory: (guest, account, ctx) => ({ items: [...new Set([...account.items, ...guest.items])] }),
    },
    stats: { kills: 'sum', level: 'larger', 'best-time': 'smaller' },
  },
});
```

A name is the exact key, or a prefix ending in `*`. The exact key beats a prefix; a longer prefix beats a shorter
one. A rule that is none of the ones below throws when the Worker loads, naming it.

| A save's rule | The account ends with |
| --- | --- |
| `'account'`, `'guest'` | that side's value. |
| `'newer'` | the one written last (a tie: the account's). |
| `'larger'`, `'smaller'` | the larger or smaller of two numbers. `{ rule: 'larger', by: 'level' }` compares that number in two objects and keeps the whole object. |
| `'sum'` | two numbers added; or two objects with every number they share added, and for anything else the account's (the guest's where the account has none). |
| `{ union: 'matches', by: 'id', order: 'endedAt', keep: 100 }` | the account's object with that list joined to the guest's by `by` (on the same id, the account's entry), newest `order` first, cut to `keep`. `order` and `keep` are optional; `'union'` alone is exactly the rule shown. A joined list too large for a save loses entries from its end until it fits. |
| `(guest, account, ctx) => value` | what the game's own function returns, run on the server. It may be async. `ctx` is `{ game, key, guest: { updatedAt, version }, account: { updatedAt, version } }`. |

A stat's rule is `'sum'`, `'larger'`, `'smaller'`, `'guest'` or `'account'`.

**With no rule**, and whenever a rule cannot apply (two values that are not numbers to compare, a function that
throws, returns nothing, or returns more than a save holds), the default applies. It never fails the sign-in:

1. Equal values: nothing to do.
2. Two values of the **record shape** the room server writes (`{ matches: [{ id, … }] }`, every `id` a text):
   joined by id, newest first. For a `server:` key the newest 100 are kept, the record's own bound; only the server
   can write such a key, so nothing else could combine the two. A key the browser wrote that happens to have this
   shape is joined the same way and not cut (it is cut only if it would not fit a save). Declare `'account'` for a
   key of that shape that must not be joined.
3. Anything else: the account's value stays, and the guest's is **handed back** to the browser that signed in. The
   play page raises it as an ordinary conflict, `mine` the guest's value and `theirs` the account's: a game with
   `onConflict` keeps or merges it, and its answer is written on top; without `onConflict` the account's stays and
   the game hears `conflict` with `kept: 'theirs'`. A stat keeps the account's number.

The sign-in answers with what happened, beside `adoptedGuest: true`:

```js
adopted: {
  merged: [{ game, key, rule, took }],      // took: 'merged', 'guest' or 'account' (a rule chose it)
  moved: 3,                                 // keys only the guest had
  kept: [{ game, key, value }],             // case 3; `rule` and `error` when a declared rule could not apply
  stats: { merged: [{ game, name, rule }], kept: [{ game, name, value }] },
}
```

`kept` carries at most 256 KiB of values; past that a key is named with `truncated: true` and the play page uses
its own copy of the guest's value. A sign-in on `/account/` has no game to ask, so there the account's simply stays.

It happens **exactly once**, in the one database transaction of the sign-in. If a room writes a record to either
player between the read and that transaction, the transaction fails whole, and it is read and tried again; after
four tries the account keeps every key both have and the answer says `fallback: true`. A round that ended a moment
before the sign-in writes its record a moment after, under the guest's id: the guest leaves a forwarding row
(`saves`, game `''`, key `server:moved`) and the record follows it to the account.

**What is new and what is a fix.** `mergeSaves` and its rules are opt-in: a studio that declares nothing has the
results it always had for every key and stat (the account's stays). Two things changed for everyone, both fixes:
server records are joined (a guest's verified matches used to vanish), and a value the account did not take is
handed back instead of dropped. A merged value larger than 64 KiB falls to the default; a merge never counts
against a game's 256 KiB.

## The hall of the fallen: a hardcore recipe

```ts
async function heroDied(cause: string) {
  if (!hero.hardcore) { hero.gold = Math.floor(hero.gold * 0.9); await saves.set('hero', hero); return; }
  const fallen = hero;
  hero = null;
  await saves.stats.add({ deaths: 1, heroesLost: 1 });      // lifetime: kept
  await saves.fall({
    character: fallen.name,
    summary: { level: fallen.level, gold: fallen.gold, kills: fallen.kills, cause },
    wipe: true,                                             // the hero's save goes, in the same step
    keep: ['settings'],                                     // what survives (sound volume, key bindings)
  });
  showHall(await saves.fallen({ limit: 10 }));             // the names of the dead, newest first
}
```

- The death and the wipe are one transaction on the server; on the device the wipe happens at once, even offline.
- Memorials are public to the game's players: the character's name, the player's display name and the summary
  (at most 2 KB). A player's own memorials go with their account if they delete it.
- At most 20 memorials a day per player and game.

## Limits

| | |
| --- | --- |
| A value | 64 KiB of JSON (1 MiB with the studio's storage, R2: kept under a random key that `/media/` never serves) |
| Keys | 64 per player per game; names of 1 to 64 letters, digits, `_ . : -` |
| A game's saves | 256 KiB per player in D1 (and 4 MiB of large ones with storage) |
| One write | 32 keys |
| Stats | 64 names per player per game, finite numbers |
| Passkeys | 10 per account |
| Rates (per Worker instance, in memory) | 120 writes and 240 reads a minute per player; 60 sign-in or sign-up tries per address per 10 minutes; 60 new players per address an hour |
| New players | 5,000 a day for the whole studio (the `PLAYER_LIMIT_DAILY` variable changes it) |

On Cloudflare's free plan a D1 database has 100,000 row writes a day for everything (stats included). A save is
one write; the play page coalesces a burst into one request per key. Save on change, not every frame.

## What is stored, and privacy

Migration `site/migrations/0004_players.sql` (deploy applies it; an older studio gets it from the next deploy):

| Table | What | Never |
| --- | --- | --- |
| `players` | a random id (`pl_…`), the display name, guest and owner flags, when made and last seen (refreshed at most every six hours) | an email, a password, an IP address |
| `player_passkeys` | each passkey's public key, algorithm, signature counter, a label ("iPhone"), when made and last used | a private key (it cannot leave the device) |
| `player_sessions` | the SHA-256 of each session cookie and short-lived room pass | the cookie itself |
| `player_challenges` | the SHA-256 of each one-time challenge or emailed link, for minutes | |
| `player_emails` | a recovery email, only if the player added one | |
| `saves`, `player_stats`, `memorials` | what the game saved | anything the game did not |

A guest who signed in to their account leaves two small rows in `saves` under game `''`: `server:moved` under the
guest's id (the account's id and when) and `server:from:<guest>` under the account's. They are in no export and no
count, and they are deleted with the account.

- **The player** sees all of it at `/account/`, downloads it as one JSON file (`/api/player/export`), and deletes
  it all (`/api/player/delete`): their passkeys, sessions, saves, stats, memorials and email, and their large
  saves in R2. The page tells them to remove the passkey from their device too, and tells the device itself where
  the browser supports it.
- **The owner** sees counts (`homie-studio players`, the private stats page, `studio_stats`) and, through the back
  office, names and when players were last seen: never a passkey, a session or an email.
- **No IP address is stored.** Rate limits count in memory and forget. No third-party script, beacon or cookie is
  used; the passkey ceremony is between the player's device and this site.
- **Guests** nobody has played for 180 days are deleted with everything they kept.
- The session cookie is `studio_player`: HttpOnly, Secure, SameSite=Lax, this site only. The game, in its sandboxed
  frame, never sees it: the play page makes every saves call for it, for that game only.

## For the studio's back office

Server-side, from the Worker (`import { players } from '@homie-rocks/studio/worker'`):

```js
await players.count(env);              // { accounts, guests, owners, new7d, active1d, active7d }
await players.list(env, { limit, cursor, q, guests });   // { players: [{ id, name, guest, owner, createdAt, seenAt, passkeys }], next }
await players.get(env, id);            // the same, plus saves per game (keys, bytes, last write), stats, memorials
await players.of(request, env);        // the request's signed-in player, or null
await players.isOwner(request, env);   // the request is the owner's own account
await players.passFor(env, id, { game, minutes });       // a short-lived pass naming a player ('pp_…')
await players.readPass(env, pass);     // { id, name, guest, owner, game } or null
await players.rename(env, id, name);   // moderation: the same name rules
await players.remove(env, id);         // everything of that player, as their own Delete does
```

**The owner's own account**: the owner plays with an ordinary passkey account on their site, and marks it once:
`npx --no-install homie-studio players owner` (it uses the studio's own Cloudflare login, like `stats link`) gives
a one-time link; opened where they are signed in, one press marks that account as the owner's. `players owner
--revoke` unmarks every account.

**In a room**: the play page can ask `POST /api/player/pass { "game": "<id>" }` for a 10-minute pass; a room that
needs to know who a socket is (to recognise the owner, or to kick by account) takes it on the socket URL and calls
`players.readPass` before handing the socket to the Table.

## HTTP

Same origin only (a POST must come from this site's own pages, as JSON). For reference; games use the SDK.

| | |
| --- | --- |
| `GET /api/player/me` | the signed-in player, the features (`accounts`, `email`), the limits |
| `POST /api/player/signup/options`, `POST /api/player/signup` | make an account, or add a passkey to this browser's guest or account |
| `POST /api/player/signin/options`, `POST /api/player/signin` | sign in with a passkey (discoverable: no name typed): `{ ok, player, adoptedGuest, adopted? }` |
| `POST /api/player/signout`, `POST /api/player/name`, `GET /api/player/passkeys`, `POST /api/player/passkeys/remove` | |
| `GET /api/player/export`, `POST /api/player/delete` (`{ "confirm": "delete" }`) | everything, and nothing |
| `GET /api/player/saves/<game>[?values=1]`, `GET /api/player/saves/<game>/<key>` | read |
| `POST /api/player/saves/<game>` `{ set: [{ key, value, base }], del: [{ key, base }] }` | write (a guest is made on the first) |
| `POST /api/player/saves/<game>/wipe` `{ keep }` | |
| `GET`/`POST /api/player/stats/<game>` `{ add, max, min }` | lifetime stats |
| `GET /api/player/fallen/<game>[?mine=1]`, `POST /api/player/fallen/<game>` `{ character, summary, wipe, keep }` | the hall of the fallen |
| `POST /api/player/pass`, `POST /api/player/owner` | a room pass; the owner's one-time mark |
| `POST /api/player/email`, `/email/verify`, `/email/remove`, `/recover`, `/recover/options` | the recovery email, with a mail sender |
