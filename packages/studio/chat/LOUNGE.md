# The Lounge

A studio's own community room, at `/lounge/` on the studio's site (`@homie-rocks/studio` 0.29.0): play nights,
demos, "show what you made", and talking with the people who play your games. It runs on your own Cloudflare
account like everything else in the studio. Nobody else hosts it, reads it or moderates it for you.

It is room chat ([CHAT.md](CHAT.md), [NETPLAY.md section 19](../netplay/NETPLAY.md)) in a room of its own: the same
reactions floating up every screen, quick lines, typing for signed-in players, the same word list and Clef review
before anyone sees a typed line, and the same owner's tools. On top of that it has what a lasting room needs:
history (only if you turn it on), moderators, play nights, live rooms to jump into, and cards for games people made.

## Turn it on

In `studio.json`:

```json
"lounge": true
```

or, to say more:

```json
"lounge": {
  "name": "The Lounge",
  "blurb": "Play nights, demos and what everybody is making. Come and say hi.",
  "featured": "directory",
  "kids": false,
  "chat": { "slow": 5 }
}
```

| Field | | Default |
|---|---|---|
| `name`, `tab` | the page's title, and the word in the site's top line | "The Lounge", "Lounge" |
| `blurb` | one line under the title | the line above |
| `featured` | live rooms in the sidebar: `directory` (yours, then the busiest across your directory), `studio` (yours only), `none` | `directory` |
| `kids` | emoji and quick lines only, nothing kept | `true` for a studio with `"audience": "kids"` |
| `chat` | the Lounge's chat rules before you change them in the office (the fields of game.json `chat`) | below |

Then `npm run build` and `npm run deploy` (it applies migration `0009_studio_lounge.sql`). A game already called
`lounge` keeps its page, and the build says the Lounge is off.

## What it does, with no work

- **The talk.** Reactions and quick lines for anyone; typing for players signed in with a passkey (no password, no
  email). Every typed line passes the word list and your Workers AI review first. Slow mode is 3 s by default.
- **Sign in in place.** "Sign in" and "Make a passkey" are on the Lounge page itself; the account is the same one your
  games and `/account/` use.
- **Show what you made.** A signed-in person pastes a link to a game. If it is a Homie studio's game (yours, or any
  site answering `/.well-known/homie-studio.json`), it becomes a card with the game's own title, pitch and picture, and
  a Play button. Its words pass the word list and the review like a typed line. Three cards an hour each. Plain links
  are never allowed in typed lines, so a card is the only way a link gets in.
- **Play nights.** You set them in the office (or with `homie-studio lounge night`). Everyone sees the time in their
  own zone, a countdown, "On now", the game's link, and Add to calendar (a small `.ics` the browser makes; nothing
  else is contacted).
- **Live now.** Your live rooms, and with a directory the busiest rooms across it, each with Watch and Join.
- **On a phone** it is one column of talk with "What's on" a tap away; on a computer, the talk and a sidebar.
- **On homie.rocks** (when your rules let it, `hub`), a visitor's own browser opens the Lounge's socket and shows it
  live, like a room's card there. Those visitors react and send quick lines; typing stays on your site, where they can
  sign in. homie.rocks keeps none of it.

## Keeping it kind

| Who | Can |
|---|---|
| Anyone | react, send quick lines, report a line (the studio sees the line and the reason, never who reported it), take their own line down |
| Signed in | type, show what they made, take down their own lines, kept ones too |
| A moderator | take any line down, mute or kick its sender for up to an hour (their lines come down with them), set slow mode; never on your lines or another moderator's |
| You, the owner | all of that, holds of up to a day, every rule, history, play nights, moderators, from the Lounge itself or the office |

Make someone a moderator from one of their lines in the office ("Make moderator"), or with
`homie-studio lounge mod <player id>`. A moderator needs an account with a passkey.

**Kids.** A kids Lounge keeps chat to emoji and quick lines and keeps nothing, whatever else it says. Nobody in the
Lounge is ever asked their age, where they live or for photos; the page says so, and the review holds it.

## History: what is kept, and only if you say so

By default the Lounge keeps what a room keeps: the last 50 lines of the last few minutes, in memory, and nothing
else. You can choose to keep what is said for 1 to 90 days (the office, or `homie-studio lounge history <days>`).
Then, in your D1 (`chat_history`):

- typed lines, quick lines, cards and your own studio lines; **never a reaction, an address or a browser key**;
- the name shown, when, and for a signed-in sender their account id (so they can take their lines down, and deleting
  their account deletes them);
- deleted after that many days. Keeping fewer days (or none) deletes the rest at once.

A person sees what is kept on the page ("What's said is kept for 14 days"), takes their own lines down any time,
downloads theirs with everything else at `/account/`, and deletes them with their account. Reports stay as before:
one line, 30 days.

History is a room chat rule (`history`, in days), so a game can keep its chat too, but it is **off for every game**
and stays off unless you turn it on in the office for that game. Turning it on is the owner's one tap when your AI
asks for it.

## From the studio folder

```sh
npx --no-install homie-studio lounge                      # rules, play nights, moderators, last lines, reports
npx --no-install homie-studio lounge night "Night Rush night" --at 2026-10-09T19:00:00-07:00 --minutes 120 --game night-rush
npx --no-install homie-studio lounge night remove pn_0123456789ab
npx --no-install homie-studio lounge history 14            # asked: the owner confirms with one tap
npx --no-install homie-studio lounge rules --slow 10
npx --no-install homie-studio lounge mod pl_… [--remove]   # asked
npx --no-install homie-studio lounge remove <line id>
```

The Lounge's public facts are at `/lounge/api/now` (its rules, play nights and live rooms; homie.rocks reads it).

## What it costs

A line or a reaction is one message on the Lounge's room (Durable Objects, billed 20:1); the fan-out is free. Typed
lines and cards use the review's daily budget, shared with your rooms (2,000 neurons a day by default, inside
Workers AI's free 10,000). History is a few D1 rows a line.
