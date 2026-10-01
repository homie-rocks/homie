---
name: office
description: Run a Homie studio's live games from its back office - who is playing right now in every room (players, bots, round, uptime), announce a line to players in-game, kick or mute a player, close a room, set players per room, and each game's launch state (private, invite-only beta with invite links and codes, public) and remix switch. The owner confirms anything that takes something away with one tap. Use when someone asks who is playing, wants to talk to their players, remove or silence a player, run a closed or invite-only beta, hide or launch a game, make invite codes, or open or close a game's source for remixing.
---

# Run the studio's live games (the back office)

Everything lives in the studio's own Worker and D1 (`@homie-rocks/studio` 0.13.0 or later;
an older studio gets it from `npx --no-install homie-studio upgrade --apply` and a deploy).
homie.rocks stores none of it. The owner is the studio's owner: never act as if a player
or anyone else were.

## Look first

- In the studio folder: `npx --no-install homie-studio office` lists every live room of
  every game, who is in it (seat, handle, phone or computer, host, guest or invited),
  bots, the round and how long the room has been up. Say it plainly.
- From an app without the studio folder: `npx --no-install homie-studio office key`
  gives an office key (1 hour by default); pass `{ site, key }` to the Homie MCP tool
  `studio_office`, which shows a live card where the app can draw one. Never paste the key
  anywhere else; `office revoke` ends every key.
- For the person's own browser: `npx --no-install homie-studio office link` gives a
  one-time sign-in link to `/_studio/office` (live, refreshing, with every control), and
  signs that browser in as the owner: their own games then show a small Owner button
  (tap a player: Mute, Kick; Announce). Give the link to the person to open themselves.

## Do

| The person says | Run (or the MCP tool) | What happens |
|---|---|---|
| "Tell everyone..." | `office announce "<one line>" [--game <id>] [--room <code>]` (`room_announce`) | At once: a banner every player sees in the game, 30 s by default (`--seconds`). |
| "Make invite codes for the beta" | `office invite <id> --label "<who>" --uses 1` (`game_launch_state` with `invites`) | At once: invite links and codes (XXXX-XXXX); each lets one browser in, or `--uses <n>` / `any`. |
| "Kick / boot that player" | `office kick <id> <room> <seat number or name>` (`room_kick`) | ASKED: the owner taps once to confirm. They are removed with a polite notice and cannot come back to that room for 10 minutes (`--minutes`). |
| "Close that room" | `office close <id> <room>` (`room_close`) | ASKED, then everyone is sent out with a thank-you; nobody gets in for 10 minutes. |
| "Make it private / an invite-only beta / public", "players per room", "stop/allow remixes" | `office launch <id> private\|invite\|public [--max <n>] [--remixable on\|off]` (`game_launch_state`) | ASKED. Private: only the owner. Invite: invited browsers only. Public: anyone, listed. Going private or invite-only closes the game's live rooms for 15 s so everyone comes back through the door, and the game leaves the homie.rocks directory the next time it reads the studio (`studio_publish` reads it at once). |

**An ask is not done until the owner tapped.** `kick`, `close` and `launch` print a
one-time link (the MCP tools show a card with the same button) that opens the ask in the
owner's own browser; one tap does it, "No" cancels it, and it ends after 15 minutes. You
cannot confirm it and must never try: no key, tool or command can. Tell the person what
you asked for, give them the link, and check afterwards (`office`, or the ask's status).

- To keep a NEW game private from its very first deploy, put `"launch": "private"` in its
  `game.json` before deploying; the owner opens it with `office link --to /<id>/play`.
- Mute stops a player's chat and emotes (`say`, `chat`, `emote` events). If the game has
  other ways to talk, make it hide them with `net.isMuted(seat)`; a game can also show
  announcements its own way (`net.on('announce', ...)`) and open a player's owner card when
  their body is clicked (`net.pickPlayer(seat)`): `NETPLAY.md` section 15.
- Kicks hold a player's browser (and account, once players sign in), not their network,
  unless the owner asks for `--address` (a household or a phone carrier can share one).
- In a Preview (a branch's own address) launch states are not enforced and there is no
  office: it has no database.
