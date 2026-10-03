# Room chat: a note for studio owners

**This is not legal advice.** It says what Homie's tooling does and does not do, so you can decide
what your studio needs. Laws about online chat and children's data differ by country and change;
if your games are for children, or many children play them, talk to someone who advises on that
where you and your players are.

## Your studio, your rooms, your responsibility

A Homie studio runs on **your own Cloudflare account**: your Worker, your Durable Objects, your D1
database, your Workers AI. Homie (and homie.rocks) does not run your rooms, does not see your
players' chat, and does not moderate it for you. You choose the rules, you hold the owner's
controls, and you are the one responsible for what happens in your rooms, as the operator of the
service. Homie gives you the tools to do that well; it cannot do it for you.

What that means in practice:

- **Choose rules that fit your players.** Each game sets its defaults in game.json, and you change
  them per game and per server in the office (`/_studio/office`) or with `homie-studio chat rules`.
  If your players are young, keep chat to emoji and quick lines, or put them on a kids server (a
  beginner server with `kids` on): typing is then off whatever the game says.
- **Watch your rooms, and act.** The office shows every live room's last minutes. Remove a message,
  mute or kick its sender (their messages come down with them), and read what players report.
- **Answer reports.** Players can report a message. You see it in the office and with
  `homie-studio chat`; dismiss it once you have dealt with it.
- **Say who your game is for, and what chat it has,** on your game's page and in your own terms or
  rules, if you have them.

## What the tooling does

| | |
|---|---|
| **Who can say what** | By default: everyone can send emoji and the game's quick lines; only **signed-in players** (an account with a passkey on your studio) can type. You can open typing to guests, keep it to members of a server, keep a room to emoji or quick lines, or turn chat off. |
| **Before anyone sees a typed message** | 1) a built-in word list and patterns (slurs, sexual words, telling someone to hurt themselves, asking a player's age or where they live, asking for pictures, moving a player to another app, email addresses and phone numbers, links, swears), plus your own words; 2) a review on your own Workers AI (Cloudflare's Clef decision model) that holds insults, hate, sexual content, grooming, threats and spam. The list always runs; the review runs within a daily budget. Neither is perfect: both are English-first, and a determined person can get past any filter. |
| **Emoji and quick lines** | Fixed words you (the game) chose. They are never reviewed and reach every screen at once. |
| **Children** | A kids server keeps chat to emoji and quick lines, gives players handles instead of names, and never asks anyone's age. Homie never asks for a player's age, birthday or address anywhere. |
| **AI players** | An AI never types in room chat. |
| **Slow mode and limits** | One line every 2 s by default (you choose), and message length, repeats and floods are capped. |

## What is stored, and for how long

| What | Where | How long |
|---|---|---|
| The chat itself (every message and reaction) | Only in the room's memory, on your Cloudflare account | The last 50 messages of the last 15 minutes, for someone who just opened the room. **Never written to storage.** An empty room forgets them a minute after the last person leaves. |
| Who said what | The same memory, for your office's Mute and Kick | As long as the message is in that memory. Never an IP address. |
| A **report** | Your D1 (`chat_reports`) | The one message reported (its words, its sender's name and account id if they had one, the room, when, the reason picked), for **30 days** or until you dismiss it. Never who reported it. |
| Your chat rules and your words | Your D1 (`chat_rules`) | Until you change them. |
| Counts (messages sent, held and why, reviews) | Your D1 (`stats_daily`) | Daily numbers, never a message and never a person. |
| Player accounts | Your D1 (the players tables, `saves/SAVES.md`) | A random id, a display name, a passkey's public key. No email unless a player adds one; players can download and delete everything of theirs at `/account/`. |

**The review** sends a typed message's words (and nothing about who wrote it) to Workers AI on your
own Cloudflare account. Cloudflare says it does not store or train on Clef's requests or responses.
**homie.rocks** stores nothing of your chat: when your rules allow it, a visitor's own browser opens
your room's socket to show its chat on your room's card there. Turn that off with `hub` off.

## Children's data, in plain words

Laws in many places (for example COPPA in the United States, GDPR and the UK's Children's Code in
Europe and the UK) set rules for online services that collect personal information from children,
or that are directed at children. A typed message can contain personal information. What helps:

- **Keep chat to emoji and quick lines for games aimed at children** (or a kids server). Then no
  child types anything, and there is nothing personal in your chat to keep or lose.
- **Typing for signed-in players only** (the default) means a person behind each typed line has an
  account you can act on.
- **Little is stored**, and only briefly (see above). Reports are the exception, kept 30 days.
- **You can delete**: a report with Dismiss, a message with Remove, a player's whole account in
  their own account page (or `players` in the office).

Homie does not know your players' ages and does not verify them. Whether your game is "directed at
children", and what that requires of you, is for you to decide with advice where you need it.

## What the tooling cannot promise

No filter catches everything, and a review model can be wrong both ways. The word list is English;
other languages rely on the review. A studio past its daily review budget, or whose Worker has no
Workers AI binding yet, relies on the word list alone until the next day (the office says so). Your
attention, your rules and your owner's controls are the real safety net.
