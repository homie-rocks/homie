# Room chat

Every studio game has room chat from `@homie-rocks/studio` 0.23.0: reactions that float up every
screen in the room (the players', the watchers', the big screen's), the game's quick lines, and
typed messages where the room's rules allow them. It feels like the Homie app's live rooms and
homie.rocks's room chat because it is the same thing: the same five reactions in the same order,
the same message shapes, the same float on a television.

The wire, the rules and the helper are in [NETPLAY.md section 19](../netplay/NETPLAY.md). This
page is the short version for a game's author, and why the review uses what it uses. For what a
studio's owner is responsible for, read [OWNERS.md](OWNERS.md).

## What a game gets with no work

- **The Chat pill** on the play page, beside the room button: the room's last minutes, the
  reactions, the quick lines, typing where allowed, Report on a line, and two switches ("Show my
  messages over my character", "Show chat on this screen").
- **The float:** every reaction rises up every screen in the room.
- **The ticker:** a new line shows for a moment where the play page's status chip sits.
- **The big screen** (`/<game>/tv`) shows the room's lines in a corner; the **watch page** has a
  Chat button; **homie.rocks** shows the room's chat on its card when the studio allows it.

## What a game can add

**Its rules, in game.json** (the owner can change every one in the office):

```json
"chat": {
  "mode": "text",
  "who": "signed-in",
  "react": "anyone",
  "slow": 2,
  "max": 140,
  "emoji": { "gem": "💎" },
  "lines": { "gg": "Good game!", "gem": "Grab that gem!", "help": "Help me!", "wait": "Wait for me!" }
}
```

| Field | | Default |
|---|---|---|
| `mode` | `off`, `emoji` (reactions only), `lines` (and quick lines), `text` (and typing) | `text` |
| `who` | who may type: `anyone`, `signed-in` (a player account with a passkey), `members` (of the room's server) | `signed-in` |
| `react` | who may send reactions and quick lines (the same three) | `anyone` |
| `slow`, `max` | seconds between one person's lines; a typed line's length | 2, 140 |
| `links`, `swears` | `block` or `allow` (a link is never clickable; slurs, sexual words, threats and contact details are always held) | `block` |
| `ai` | review typed messages with the studio's own Workers AI | `true` |
| `bubbles`, `watchers`, `hub` | over the speaker's character; watchers may send; homie.rocks may show it | `true` |
| `emoji`, `lines` | up to 3 more reactions; up to 12 quick lines (each passes the chat floor at build) | the five; 8 friendly lines |
| `block`, `allow` | the studio's own words to hold (`word*` inside words) or to let through | none |

`"chat": false` turns it off. A kids server, and every beginner server, keeps chat to emoji and
quick lines whatever the game says. Where new lines show for a moment: game.json
`"screen": { "chat": "bottom-right" }` (any corner, `top-center` or `bottom-center`), or `false`
for only the pill's count.

**Speech bubbles over characters**, with the port kit (the starters draw them):

```ts
import { createBubbles, paintBubbles, BUBBLE_FONT } from '@homie-rocks/studio/port';
const bubbles = createBubbles({ measure: (t) => { ctx.font = BUBBLE_FONT; return ctx.measureText(t).width; } });
net.on('say', (s) => bubbles.say(s.seat, s.text, { id: s.id, kind: s.kind }));
net.on('unchat', (e) => e.ids.forEach((id) => bubbles.remove(id)));
// each frame, after the names: the anchor is just over each speaking body's name
paintBubbles(ctx, bubbles.place(speakers.map((s) => ({ key: s.seat, x: s.x, y: s.nameTop, self: s.mine }))));
```

A 3D game draws them the same way on its HUD canvas (Gem Rush 3D does), or reads `place()`'s boxes
and draws its own. **The game's own chat UI** (a key that opens a wheel of quick lines, say):
`net.sayLine('gg')`, `net.react('fire')`, `net.say(text)`; `net.on('chat')` for a log of your own.

## Moderation: what it uses, and why

The owner asked for "Cloudflare's new decisions API". That is **Clef**, Cloudflare's decision
models, launched on Workers AI on 2026-10-01 (Birthday Week): `@cf/cloudflare/clef-flash` (9B) and
`@cf/cloudflare/clef` (27B). They do not write text: you send a `state` (here, the message) and
typed questions, and they return a probability for every allowed answer. Cloudflare names "trust
and safety: score user submissions against your own policy rubric" as a use.

| | Clef-flash (the default) | Clef | Llama Guard 3 8B | AI Gateway Guardrails |
|---|---|---|---|---|
| What | a decision model: our own question, a probability per answer | the same, larger | Meta's fixed safety categories (S1–S14) | Llama Guard run on prompts and responses of model calls through a gateway |
| Price | $0.09 per M input tokens, no output charge: measured about 2.3 neurons a short message (the question is most of it) | $0.24 per M: about 6 neurons | $0.48 per M in, $0.03 out: up to about 10 neurons a message with its policy prompt | Llama Guard's price, plus the model call it guards |
| Speed | about 40 ms median, 120 ms p95 (Cloudflare's numbers) | about 210 ms median | about 500 ms (Cloudflare's guardrails notes) | a model call plus about 500 ms |
| Fits game chat | our categories: insults, hate, sexual, grooming, harm, spam | the same, more accurate | no insults or bullying category; most game-chat abuse reads as "safe" | not for arbitrary text: it guards model traffic |

Clef-flash is the default because it is the cheapest per message by about five times, the fastest
by far (a message waits for it before anyone sees it), and lets the studio ask exactly what game
chat needs. Honest caveats: it is one day old as this ships, Cloudflare publishes no moderation
accuracy numbers for it, and the message it reads is a player's, so a player can try to steer it
(less of a risk than with a model that writes, since it only scores fixed answers). That is why
**the word list always runs first and decides alone** whenever the review cannot (no binding, the
day's budget used, an error, a slow answer). `HOMIE_CHAT_MODEL` switches to Clef or Llama Guard.
Firewall for AI (now "AI Security for Apps") was ruled out: it reads HTTP requests at the zone, not
messages inside a Durable Object, and its detections are an Enterprise add-on.

**What it costs a studio.** Workers AI gives every account 10,000 neurons a day free, on the free
Workers plan too, with no payment method. The review's day is 2,000 neurons by default (about
850 typed messages, measured), leaving the AI guides their 8,000; `homie-studio chat budget <n>` changes it. On the free plan, past the allocation
Workers AI refuses (the floor decides); on Workers Paid, past it is $0.011 per 1,000 neurons, which
is why the review stops at its own budget. `homie-studio deploy` binds Workers AI when a game lets
players type; `homie-studio dev --remote-ai` uses the real one (billed to the signed-in account).
