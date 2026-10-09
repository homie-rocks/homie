# Rooms that run on the server: plan

Status: plan, 2026-10-07. Nothing is built.
Applies to the public repository `homie-rocks/homie` (`@homie-rocks/studio`, the plugin and
its skills, the engine packages), read at `origin/main` (studio 0.32.0).

This is the document to read. Two others hold the engineering depth:
[rooms-milestone-1-design.md](rooms-milestone-1-design.md) for building milestone 1, and
[rooms-roadmap-design.md](rooms-roadmap-design.md) for milestones 2 to 10.

## Why this is happening

Today, when people play a Homie game together, one player's browser is in charge. It runs
the game's rules and tells everyone else what happened.

- That player can cheat. Scores can be faked.
- The game cannot keep a secret from the browser that runs it.
- The game stops when the players leave, and a room holds 32 people at most.
- An outside developer building a live online world on Homie removed Homie's rooms and kept
  only the skills. Today's rooms cannot grow into one place holding 1,000 characters.

The aim: a studio can build a game on Homie that grows to a million players and earns money,
without Homie being the ceiling and without leaving Homie.

## What changes for a studio

- **The game's rules run on your own Cloudflare account**, in Cloudflare's data centres.
  Players' browsers send what they press and draw what they are told.
- **The AI writes a game in two halves**: the rules (what is true in the game) and the view
  (what players see and hear).
- **Homie checks the rules before they go online.** A mistake is caught on your computer and
  explained in plain words.
- **A player's browser can still be in charge when you want that**: offline play, testing on
  your own computer, private games among friends. It is the same rules file.
- **Games you already have keep running.** A game made before this change builds and plays
  as it does today, in a player's browser. You do not have to do anything. It moves to the
  server when you ask your AI to rewrite it as rules plus view. Milestone 2 retires the old
  way of writing a game, and from then an older game needs that rewrite before it builds.
- **What stays the same.** You make games by chatting, on your own Cloudflare account.
  Servers remain the way communities form around your game. Bringing an outside web game
  into Homie (`port`) still works. Homie takes no cut of what you sell.

## What a studio will be able to build

Milestone 1 gives the first line. The rest arrive with later milestones.

- **Fair matches** from two players up: scores and pickups are decided on the server.
- **Hidden information** (a hand of cards) and **messages only one player sees**.
- **Big rooms**: hundreds of players in one place, each sent only what is near them.
- **Lasting worlds** for thousands, cut into areas that players cross without noticing.
- **Characters and inventories** on the player's account, with **trading, shared guild
  storage and a player market**. An item is always in exactly one place.
- **Vehicles and mounts**, and **real-world time**: a daily reset, an auction that ends at six.
- **Selling** on the web and in apps on Steam, iPhone and Android, with one record of what
  each player owns.
- **Voice chat** where you hear the players near you.
- **Turn-based games** that use no server time between moves.

## How a game grows

The same rules file runs at every size. Homie adds machinery underneath.

| Size | What runs | What you change | Milestone |
|---|---|---|---|
| A match of up to 32 players | One server object does everything | Nothing | 1 |
| A room for hundreds | The same, plus "gateways" that carry players' connections | One setting: seats | 2 |
| A lasting world in one area | The same room, kept running, with characters saved to accounts | One setting: lifetime | 3 |
| A world for thousands | Many areas, each its own server object, splitting and joining with the crowd | Draw a bigger map | 4 |
| Tens of thousands of players | Many copies of the match or the world, with a matchmaker or a world list in front | Nothing. Copies open by themselves | 5 |
| A million players | The same, in every region, with accounts and purchases stored per player | Nothing in the game. Possibly a larger database for search and rankings | 5 and 6 |

- Homie sets no ceiling of its own. Where Cloudflare's technology has a limit, the design
  names it and the way past it.
- The rules format grows with the milestones. Milestone 1 fixes the parts that a later
  milestone could not change without rewriting games. The rest stays a draft until
  milestones 4 and 6 are done. If a later milestone changes something, your AI updates your
  game's rules when you update Homie, and the check proves the update worked.

## The milestones

**Sizes.** Homie is built by AI coding agents working in parallel, so person-weeks say
little. Each piece has a relative size instead. The scale is defined by what changes in
today's code.

| Size | What it means in this codebase |
|---|---|
| XS | A change inside one existing part of Homie, or one small new part. Nothing changes in how browsers and the server talk, or in what is stored |
| S | One new part of middling size, or a change to about a tenth of one of the two biggest files in today's rooms |
| M | Two to four new parts, or about a quarter of one of those two files reworked, or one of Homie's starter games converted |
| L | Five to ten new parts, or a change to how browsers and the server talk, or a new kind of server object, with changes across the rooms code, the build and a skill. Tested on real Cloudflare |
| XL | More than ten new parts and several new kinds of server object that talk to each other, proved on a test rig that imitates Cloudflare, with load tests on real Cloudflare |

| | Milestone | What a studio gets | Size | Needs first | Can be built beside |
|---|---|---|---|---|---|
| 1 | **Rules on the server** | A game written as rules plus view. A normal room (up to 32 players) whose rules run on your Cloudflare. The room survives restarts, and a deploy costs players a short pause. Your own movement still feels instant. The same rules run in a player's browser when you choose, and offline. A strict build check. The `game` skill writes it. Homie's starters run on it | Eight slices: L, M, M, M, M, L, L, M | Nothing | |
| 2 | Bigger rooms | Gateways, sending each player only what is near, hundreds in one place, hidden information and messages for one player, vehicles and mounts, game files over 25 MiB | L | 1 | 3, 5, 6, 7 |
| 3 | Lasting worlds and characters | Part A: rule changes reach running rooms without a restart, and rules run in a locked box. Part B: a world that stays, in one area; characters and inventories on the player's account; safe trading; real-world time; restore points and undoing a bad update | XL (part A is L, part B is L) | 1 | 2, 5, 7 |
| 4 | Worlds of many areas | Borders, crossing, areas that split and join, layers for crowds: one seamless world for thousands | XL | 2 and 3 | 5, 6, 7 |
| 5 | Many rooms, worlds and regions | Matchmaking that grows by itself, parties, world lists, regions, game-wide events, tested at 100,000 rooms | L | 1 (world lists and staged rule rollouts need 3) | 2, 3, 4, 6, 7 |
| 6 | Accounts, economy and markets | The shop with your own rules in place of Homie's limits, protection against fake sign-ups, accounts built for a million players, guilds and their shared storage, a player market | XL | 3 (the shop changes need only 1) | 2, 4, 5, 7 |
| 7 | Running a live game | Dashboards, alerts, game-master tools, cheating and abuse signals, your own cost alerts, Homie updates rolled out a few rooms at a time | L | 1 | Everything |
| 8 | Voice chat | Hearing the players near you, and party voice | M | 2 | Everything after 2 |
| 9 | Apps that earn | Accounts, saves and purchases inside Steam, iPhone and Android apps | L | 6 | 4, 5, 7, 8, 10 |
| 10 | Heavy worlds | Stronger machines for the busiest areas, crowds of a thousand in one view, worlds of ten thousand, faster networking for action games if Cloudflare offers a way | L | 4 | 5 to 9 |

- Milestone 1 is the change this plan is named for. Everything after it is a separate piece
  that a studio picks up only when its game needs it.
- 2, 3, 5 and 7 can all start as soon as 1 is done.
- Each later milestone gets its own design pass when it starts. Its size is restated then.
- Art and design tooling is parked. Nothing is planned for it here.

## What it needs from Cloudflare

| What the studio uses | Cloudflare plan | Why |
|---|---|---|
| Site, accounts, shop, rooms hosted in a player's browser | Free works | As today |
| Rooms with rules on the server (milestone 1) | Free works, inside Cloudflare's three daily allowances below. Workers Paid (from US$5 a month, plus usage) removes them | Milestone 1 uses the same kind of server object the rooms use today. It adds one saved row a second per room |
| The locked box around rules, and rule changes without a restart (milestone 3, part A) | Workers Paid | Cloudflare sells that product on the paid plan only |
| Game files over 25 MiB (milestone 2), saved rule bundles (milestone 3) | R2 file storage, which asks for a payment method even inside its free allowance | Cloudflare's rule |
| Stronger machines (milestone 10), the audit trail (milestone 6) | Workers Paid | Cloudflare sells them on the paid plan only |

- The free plan has three daily allowances for these server objects. The first allows about
  three and a half hours a day of a full 8-player room. Each of the others, a day of one room.

| Free allowance, per day | Enough for about |
|---|---|
| 100,000 requests (players' messages) | 27 player-hours of play |
| 13,000 GB-seconds of running time | 28 hours of one room being open |
| 100,000 rows written (the saves) | 27 hours of one room being open |

- When one runs out, Cloudflare refuses that kind of work until midnight UTC. Out of
  requests, every room of every game stops until then, not only the busy one.
- Today's browser-hosted rooms already use the first two. The third is new. Slice 1 measures
  the first two on real Cloudflare and slice 2 the third, and the tools then state them.
- Homie tells you before it puts anything online what will be created and roughly what it
  costs. It never switches a plan for you. Where a game needs the paid plan, Homie says so
  in plain words, and you turn it on yourself or keep the game without that feature.

## What it costs to run

These are estimates from Cloudflare's published prices on 2026-10-07 at the default settings.
They are rounded to two figures. They are information. Homie limits nothing because of them.
[rooms-roadmap-design.md](rooms-roadmap-design.md) section 21 shows every line.

| Game | Roughly |
|---|---|
| One 8-player match, per hour of play, as milestone 1 builds it | 1.4 cents (about 0.17 cents per player-hour) |
| The same from milestone 3, with rules in the locked box and things of value written at once | 5 cents (about 0.7 cents per player-hour) |
| A world with 1,000 players online, per hour | $2.20 (about 0.22 cents per player-hour) |
| 100,000 players online at once, in worlds | $220 an hour |
| 100,000 players online at once, in 8-player matches | $680 an hour |
| 1,000,000 players online at once, in worlds | $2,200 an hour |
| A game with a million players a month, each playing 20 hours, in worlds | $45,000 a month (between $40,000 and $62,000) |
| The same in 8-player matches | $140,000 a month (between $100,000 and $270,000) |

- A match with nobody in it costs nothing. An empty lasting world costs cents a month.
- Voice chat is extra: about a tenth of a cent per player-hour.
- A database outside Cloudflare, if you choose one, is billed by whoever runs it.
- Every figure is replaced by a measurement as its milestone is built.

## What stays the studio's own choice

This section describes where the plan ends up. The limits in today's code stay in force
until the milestone named removes them.

- **Your game, your decisions.** Prices, what you sell, how much a player may spend, refund
  periods and AI spending become your settings, with no ceiling from Homie on any of them.
- **Homie will not set a spending limit, a budget or a cap for you.** No limit exists
  unless you create one. From milestone 7 you can add your own: a cost page, alerts at
  amounts you choose, and a limit with the behaviour you pick.
- **Today's limits in Homie's code go in milestone 6**: US$50 a month from one player, no
  item over US$500, 60 items, five kinds of item, no subscriptions, no currency of your own,
  a daily allowance for AI. Until then they apply, including to a game's own AI decisions in
  milestone 1. [rooms-roadmap-design.md](rooms-roadmap-design.md) section 6.2 lists every
  limit found in the code and what it becomes.
- **Protections are policies you choose and can see.** Homie ships presets ("kids", "teens
  with a parent's approval", "general") that you can read, pick and edit. A preset is not a
  lock.
- **The law and the stores still apply to you.** Homie tells you, next to each choice, what
  the usual obligations are. That is information, not legal advice.
- **Per-game settings** cover where rules run, offline play, seats, speed, how much play a
  restart may replay, regions and more. Each has a default.
- The only limits left are technical ones. Each is listed with its reason and the way past.

## Decisions (the owner's; not open for relitigating)

1. **One runtime, evolved in place.** No second version kept beside it, no tear-down, no
   migration tooling. Hardly anyone uses Homie yet, so there is no legacy to protect.
2. **One thing, called a room.** A room can be one cell or many, short-lived or persistent,
   one of many matched copies or a single shared place. There is no separate "realm".
3. **One codebase per game.** A game is rules (nothing from the browser in them) plus view
   (rendering, camera, HUD, sound). The same rules run wherever the runtime puts them.
4. **The server hosts by default.** Rules run on the studio's own Cloudflare.
5. **A player's browser can still host**, as a mode of the same runtime: offline play, local
   dev, and private friends games the owner chooses to run that way.
6. **Servers stay**, as the community layer on top of rooms of any size.
7. **Homie's own games and starters are updated** as the runtime changes, as ordinary work.
8. **No cheap fixes.** The aim is the complete answer, not a patch around the gap.

Also fixed: the `port` feature stays unless the owner decides otherwise. Art tooling is parked.

How this plan reads those decisions:

- A room stays the one thing a player joins. The layers that appear at scale are not rooms
  and are not called rooms: the matchmaker, the world list, the player's account.
- "No migration tooling" means no tooling to carry games from today's netplay to the new
  runtime. A game's own saved state changing shape between its own builds is ordinary game
  development.

## Milestone 1 in full

**What it is.** The thinnest thing that is complete and correct: a game written as rules
plus view, whose rules run in one server object on the studio's Cloudflare.

| After milestone 1 a studio gets | Not yet, and where it comes |
|---|---|
| Rules on its own Cloudflare. Score and pickups are decided there. So is movement, unless you choose to let each browser move its own character: lighter, but a changed browser can then walk through walls | Hidden information. Every browser still receives the whole room, so a card game is not fair yet (milestone 2) |
| One room of up to 32 players, with rounds, results, bots, AI seats, chat, votes, watchers and the owner's controls, all as today | More than 32 players in a room (milestone 2) |
| Your own character still answers on the next drawn frame after you press, as today | Lasting worlds, saved characters and items. In `ember-vale`, level and gold are still what the browser says they are (milestone 3) |
| A room that survives a restart, losing at most one second of play | Deploys with no interruption (milestone 3). See the next table |
| Offline play, and apps for computers and phones, from the same rules | An app on an older build playing online in a server-hosted room. It plays offline until updated (milestone 3) |
| A check before every build, with mistakes explained in plain words | A locked box around rules (milestone 3). See below |
| The `game` skill writes such games. Homie's four starters and a new example run on it | |

**What a deploy does to people who are playing.** Until milestone 3 the site and the rooms
are one program, so putting any change online restarts every room.

| What you deployed | What players see |
|---|---|
| Something else: a blog post, another game | A pause of one to three seconds. They carry on |
| A change to that game | Their pages reload by themselves. They keep their seat and score and are playing again in about five seconds |
| A change to what that game stores | The match in progress ends. Their pages reload and they start a fresh one |

**What protects your site from a mistake in the rules.** Until milestone 3 a game's rules
run in the same program as your site, accounts and shop.

- Only your own studio's rules run there. Code from outside your studio does not.
- The build refuses rules that use anything outside a short list of safe operations, and
  names the line.
- The build adds a guard that stops a rule that runs too long or takes too much memory. The
  room loses a few milliseconds. A game whose rules keep failing has its room closed, and
  the log says which.
- A mistake cannot read or change accounts, purchases or another room. It can slow or
  restart your other rooms for a few seconds, because Cloudflare may run them side by side.
- This guards against mistakes by your own AI. It is not yet a locked box against code
  written to attack.

**How it stays thin.** Today's rooms already do seats, chat, votes, watchers, owner controls
and AI seats without caring who is in charge. Milestone 1 puts the server in charge instead
of a browser. Nothing that works is rebuilt.

### The slices

There are eight. Each runs end to end and can be released on its own. Slices 2, 3, 4 and 5
need only slice 1 and can be built at the same time. Slice 6 needs all four, slice 7 needs 6
and slice 8 needs 7. Exit tests run on a test copy of a studio's site on real Cloudflare.

**What the AI writes while the slices land.** The `game` skill never writes less than it
does today. Until slice 8 it writes new games in today's form, which keeps working. From
slice 4 it can also change the rules of a rules game. From slice 8 every new game is one.

**1. A game with its rules on the server (L)**

- Ships: the rules format in full, including movement, input, rounds, results, bots and
  what happens to a character while its player is away. The code that runs it in the server
  object. The library a view uses. The part of the check that guards the server. The example
  game `coin-dash`. The testing tools read such a game. A person's character still moves as
  today: the browser says where it is and the server holds it to its top speed.
- Not yet: a room has no save. A restart or a deploy ends its match and players land in a
  fresh one. Today's rooms survive a deploy, so `coin-dash` is offered to studios only once
  slices 2 and 4 are both out. Until then it runs on Homie's test studio.
- Exit test:
  - Two browsers land in one `coin-dash` room and finish a round with bots. The round is in
    the studio's stats.
  - Closing any one tab does not interrupt the others. A changed browser cannot change its
    score.
  - Rules that use a forbidden operation are refused with the line named. A planted rule
    that never ends, one that is slow, and one that grabs memory are each stopped and named.
  - With 8 test players for 20 minutes, the room runs 99.5% of its steps, and 99% of updates
    arrive less than one and a half steps apart.
  - A room everyone has left stops being billed, checked on Cloudflare's own figures.
  - The same game runs under `homie-studio dev`.

**2. The room survives (M, after 1)**

- Ships: the whole room saved once a second and at each round's end. After a restart the
  room loads its save and carries on with seats kept. The three deploy cases above. A room
  that fails to come back three times in a row closes, and its players get a fresh one.
- Exit test:
  - 200 forced restarts with 8 test players: 95% are playing again within 3 seconds, and
    nothing older than one second is lost.
  - 20 deploys that change the game but not what it stores: every page reloads by itself,
    and 95% are playing again within 5 seconds with their scores.
  - One deploy that changes what it stores: every player is in a new room within 5 seconds.
  - A deploy that does not touch the game reloads nobody.

**3. The same rules in a player's browser, and offline (M, after 1)**

- Ships: a setting that puts a player's browser in charge, with today's handover when that
  player leaves. Offline play with bots for every rules game, in the browser and in apps,
  unless the studio turns it off to keep its rules on the server. The Game Lab compares two
  versions of a rules game.
- Exit test:
  - `coin-dash` passes the two-browser check with the server in charge and with a browser.
  - With the connection cut it plays on with bots, in a browser and in a built app.
  - The tab in charge is closed mid-round: another browser takes over and the round finishes.

**4. The build check (M, after 1)**

- Ships: type checking of rules, always. A play the build generates itself, on the real
  runtime: a build fails for a handler that threw, a tick out of budget, a character the
  server held back, a value the room had to change and lose, or a room that did not come back
  the same from its save. Messages for
  the chat: what broke, the line, the usual fix. A reference page, so the `game` skill can
  change a rules game.
- Exit test:
  - A rules file with fifteen planted faults fails with each line named.
  - Three one-sentence change requests to `coin-dash`, fixed in advance, run unattended. Each
    result passes the check and the two-browser check.

**5. Every room feature with the server in charge (M, after 1)**

- Ships: AI seats and guides, and a game's own AI decisions, driven by the server.
- Exit test: seats, chat, votes, watchers, owner controls, AI seats, AI decisions and round
  stats each have a passing test with the server in charge.

**6. Feels like today (L, after 2, 3, 4 and 5)**

- Ships: the server moves every character. The browser moves your own at once with the same
  movement code and corrects itself smoothly when the server answers. A knock is shown from
  the moment it lands, not skipped. `gem-rush` converted, with its knock-back. A feel check:
  a test that a converted game moves and scores as before.
- Exit test:
  - `gem-rush` against figures recorded from today's version: crossing time within 2%, and
    total score over 20 bot rounds within 15%. Today's run-to-run variation is recorded first.
  - Your own character answers the stick as fast as today's, to within 8 ms. A knocked
    player sees the hit land, the pause and the whole slide, with no jump of the picture.
  - On an ordinary connection, half of another player's actions are seen within 280 ms and
    95% within 350. Half of the server's answers to your own action arrive within 170 ms.
  - A changed browser cannot move faster than the character's top speed, or ignore a knock.
  - `gem-rush` passes the two-browser check with either in charge.

**7. 3D and the remaining starters (L, after 6)**

- Ships: 3D characters with height and jumping. `gem-rush-3d`, `hero-rush-3d` and
  `ember-vale` converted. `ember-vale` keeps today's cloud saves. Games brought in with
  `port` keep running in a player's browser, unchanged.
- Exit test:
  - All five games pass the check and the two-browser playtest with either in charge.
  - Each converted starter passes its feel check: crossing time within 2% of today's, jump
    height within 2% of its setting, score within 15%.
  - 32 test players for 30 minutes: the room's steadiness is measured, and the tools state
    the largest room size tested.
  - One ported game still passes the port check.

**8. The skill writes rules games (M, after 7)**

- Ships: the `game` skill rewritten for rules plus view. New games start from the converted
  starters.
- Exit test: five one-sentence requests, fixed in advance, run unattended. Each produces a
  game that passes the check and a two-browser playtest.

[rooms-milestone-1-design.md](rooms-milestone-1-design.md) section 14 lists what each slice
changes and how the sizes were worked out. Slices 2, 5 and 8 are sized by judgement.

### What milestone 1 keeps from later milestones

A match room is deleted when it ends, so nothing milestone 1 stores has to be readable later.
The only thing that could force a rewrite is the shape of a game's rules. These rules of the
format are therefore fixed now. Each costs little.

| Kept now | Why it cannot wait |
|---|---|
| A rule changes only its own thing. Anything else is a message that arrives on a later step | With many areas there is no other way. A game written without it would be rewritten |
| A search has a reach. There is no list of everything in the room | Same |
| All of a game's state is declared, with a type and a largest size. No state anywhere else | Saving, restoring and later moving things between areas all depend on it |
| Every message, command and effect is declared with its data | Type checking today. Apps that outlive a build later |
| Shared room state is written only by room-level rules. Joining is a pure function | Later the room's centre and its areas are different server objects |
| Rounds, results, seats and bots are declared, and Homie runs them | Results later come from many areas. Today's round stats keep working |
| Distances are metres, with x, y and z | Area sizes and view distances are in metres later |
| The strict list of what rules may use, including which maths | Allowing more later breaks nothing. Refusing something later would break games |
| Movement code is in its own file and reads only the character's own movement state, its input and the map | The browser runs that file to predict. Later it is all a browser gets |
| One input per step, stamped with its step and acknowledged | Changing it later would change every view |
| Names of things are opaque. Rules compare them and nothing else | Names gain a second part when worlds have many areas |
| Every rules file says which version of the format it is in | Lets a later Homie recognise and update it |
| Each save records which rules it fits | A room whose save no longer fits is ended cleanly |
| The guard on what rules may do and how long they may run | Without it a server-hosted room is not safe to ship |

### What moved out of milestone 1

None of these forces a rewrite of a game or of stored data when it is added later.
[rooms-milestone-1-design.md](rooms-milestone-1-design.md) section 13 gives the reason for
each.

| Moved | To milestone |
|---|---|
| The locked box around rules; rule bundles in file storage; rule changes with no restart; the split into a site Worker and a rooms Worker; isolating one runaway rule from the rest of its room; old app builds playing online; the paid-plan check and wording | 3, part A |
| A saved row for each thing of value instead of one save a second; a save on every step; the simulator that proves recovery; real-world time and rooms that sleep between turns; rule profiles; a wire that carries its own description; the full measurement of AI authoring | 3, part B |
| Hidden fields and messages for one player; signed room passes; the first capacity measurement, with faster step rates and other regions; seats above 32; game files over 25 MiB; map zones; the kit of ready-made rule pieces; a local bot swarm; the port toolkit moved onto the new runtime, and the old way of writing a game retired | 2 |
| Shared counters merged from many areas | 4 |
| Copies of server classes, and the test of how many rooms share a thread | 5 (the number in the id arrives with the first long-lived objects in 3) |
| The two AI allowances become the studio's own settings | 6 |
| Homie updates rolled out a few rooms at a time; metrics; replaying a recorded session | 7 |
