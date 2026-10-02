---
name: servers
description: Give a Homie studio game lasting servers - named communities with their own rooms and rules - humans-only, hybrid (seats reserved for AI companions), beginner (new players, AI guides, kids-safe) - plus agent passes, the AI skill dial and the party's level vote. Use when someone asks for servers, realms or shards, human-only play, AI party members or companions, guides or helpers for new players or kids, "fill empty spots with AI", or how strong the bots should be.
---

# Servers and AI seats

Needs `@homie-rocks/studio` 0.16.0 or later (`npx --no-install homie-studio upgrade --apply`, then deploy).
Everything lives in the studio's own Worker and D1; homie.rocks stores none of it. **AI is ALWAYS marked AI**:
the relay names every agent "<label> · AI" and marks it in every roster and result. Never name an agent so it looks
human, and never try to get an agent into a humans-only server.

A **server** is a named, lasting pool of rooms for one game: strangers are matched only inside one server. Every
game already has one, **Quick play** (its public rooms). A server's page is `/<game>/s/<id>/`; `/<game>/servers/`
lists them; the landing gets a Servers band.

## Do

| The person says | Run (or the MCP tool) | What happens |
|---|---|---|
| "Make a beginner server with two guide agents" | `npx --no-install homie-studio servers new <game> "<Name>" --policy beginner --guides 2` (`server_create`) | At once: the server and its page link. Two AI guide seats in every room, marked AI, at a gentle level, for accounts under 30 days (`--beginner-days`); chat is quick lines only. `--kids` adds handles only and keeps the AI's level at most 3. In this version the guides are the game's own bots (they play, silent); talking guides come later, and turning talk on is an ASK (`agents brain`). |
| "A server with no AI at all" | `servers new <game> "<Name>" --policy humans-only` | No agent can join (the site refuses it, and so does the room); the game's practice bots are off (`--bots fill` turns them on, still marked AI). |
| "Keep two AI seats in every party" | `servers new <game> "<Name>" --policy hybrid --ai 2` | The top two seats of every room are AI companions; the party votes their level. A room of 8 holds 6 people. |
| "Make the bots easier / harder" | `servers set <game> <server> --level 2` (the server's default), `servers level <game> <room> 1-5` (one room now; `room_level`) | The dial: 1 Rookie, 2 Steady, 3 Fair, 4 Strong, 5 Maxed. Only games whose bots read it change; `servers` says which builds predate servers. `--level-max` caps what the party may vote. |
| "Only players with an account" / "invite-only server" | `servers set <game> <server> --door accounts` / `--door invite`, then `office invite <game> --server <server>` | A stricter door is an ASK (one tap). Invite codes and links for that server. |
| "Close that server" | `servers close <game> <server>` (`server_close`) | ASKED; its rooms finish their round, then everyone leaves with a thank-you. `--reopen` opens it again at once. Closing `public` hides Quick play: Play then shows the servers to pick from. |
| "Make <player> a mentor" | `servers member <game> <server> <player id> --role mentor` (`server_member`) | At once: a mentor gets into a beginner server, with a badge. `--remove` is an ASK. |
| "Let my Claude play" | `agents pass <game> --label Claude [--server <id>]` (`agent_pass`) | At once: a pass shown ONCE (give it to the AI only; never write it into the repository or a chat). The AI sits with `POST /<game>/api/agent` (`Authorization: Bearer <pass>`), only in a room with people in it, as "Claude · AI", on an open, hybrid or beginner server. `agents revoke <id>` ends it (the AI leaves at once). |

**Asks.** Making a server, a widening change, a pass, a mentor and a room's level happen at once. A change that
narrows who may come in (humans-only, a stricter door, fewer rooms), closing a server, removing a member, and the
first time AI guides may talk only ASK: the command prints a one-time link the owner opens; one tap does it. You
cannot confirm it.

**Tell the person plainly** which builds predate servers (`servers` and the office say "This build predates
servers"): such a game still plays on every server (doors, the people's cap, speech rules and AI names work), but
it keeps no AI seats and its bots ignore the dial until it is rebuilt with 0.16.0. A game whose bots are its own
code needs a few lines: the dial snippet in `node_modules/@homie-rocks/studio/netplay/NETPLAY.md` section 17
(`net.skillOf(slot)`, and `caps: ['skill', 'agents']`); a port on `BotBrain` gets it with `skill: () =>
room.skillOf(body)`.

**Money.** A paid "fill a spot" service (an AI seated in an empty spot for a price) is not offered: the office shows
it as coming later, and nothing issues its passes. Pricing it is the studio owner's own decision, never yours.
