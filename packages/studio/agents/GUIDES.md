# AI guides in an RPG of your own

How an existing studio game with zones, quests and a party (an RPG, a dungeon crawler, an adventure) adopts AI
guides that answer "Help me with this quest". It takes an afternoon. Do it in the game's own repository, with its
owner's say; nothing here changes another studio's game. The contract is `netplay/NETPLAY.md` section 18; Ember
Vale (`homie-studio game new <id> --from ember-vale`) is the worked example.

## 0. What you get

- A beginner server whose AI guide seats (always marked "· AI") follow new heroes, lead them to places, take on a
  quest with them, and pull back when asked.
- **Hands** are your game's own bot code, every frame, at the party's skill dial. **The brain** picks a goal every
  few seconds: the studio's own Workers AI, the owner's own key, or the owner's Claude in a seat. With none of them
  (or over the day's budget) your scripted `decide` plays.
- The AI never types. It chooses ids from your `agents.json`; your game draws your own words.

## 1. Upgrade

`npx --no-install homie-studio upgrade --apply`, to `@homie-rocks/studio` 0.17.0 or later, then build. A game that
vendors `netplay.ts` updates its copy (revision 7). `homie-studio servers` shows each build's revision.

## 2. Write `games/<id>/agents.json` in the game's voice

Start from the goals your bot code can really do. For an RPG with zones and quests:

```json
{ "v": 1,
  "persona": "A veteran of the north roads who helps new adventurers. Brief, warm, a little dry; never mocking.",
  "names": ["Tamsin", "Oren", "Bryn"],
  "labels": { "old-mill": "the Old Mill", "wolf-den": "the wolf den", "town": "town" },
  "goals": {
    "follow": { "about": "stay with a player", "args": { "seat": "player" } },
    "quest":  { "about": "do a quest with the party", "args": { "quest": "view.quests" } },
    "lead":   { "about": "lead the party to a zone", "args": { "zone": "view.zones" } },
    "heal":   { "about": "stay behind the party and heal whoever is hurt" },
    "back":   { "about": "pull back to the nearest safe zone" } },
  "lines": {
    "hello":      { "text": "Well met, {player}. I'm {me}, an AI guide. Ask if you need a hand.", "args": { "player": "player" } },
    "quest_help": { "text": "{quest}? I know the way. Stay close.", "args": { "quest": "view.quests" } },
    "this_way":   { "text": "This way, to {zone}.", "args": { "zone": "view.zones" } },
    "careful":    { "text": "Careful: {thing} ahead.", "args": { "thing": ["wolves", "a trap", "the boss"] } },
    "bye":        { "text": "Understood. I'll keep my distance." } },
  "asks": {
    "ask_help":  { "text": "Help me with {quest}", "args": { "quest": "view.quests" }, "goal": "quest", "say": "quest_help" },
    "take_me":   { "text": "Take me to {zone}", "args": { "zone": "view.zones" }, "goal": "lead", "say": "this_way" },
    "no_thanks": { "text": "No thanks", "goal": "back", "say": "bye", "leave": true } } }
```

Rules the build enforces: ids are `a-z0-9_`; a text is at most 120 characters and its `{placeholders}` are its
arguments (or `{me}`); an argument is `"player"`, a list, or `"view.<key>"`; a goal is done *with* players, never
to one. Keep `labels` for every id a player will read. Quest and zone ids that come from the view (`view.quests`)
must be ids, not sentences.

## 3. Wire `useAgents` (host side, a few dozen lines)

```ts
import vocab from '../agents.json';
import { useAgents, type Vocabulary } from '@homie-rocks/studio/agents';

const agents = useAgents(room.net, vocab as unknown as Vocabulary, {
  view: (slot) => ({                       // game state only, seats not names, under 2 KB
    me: { hp: hpPct(slot), zone: zoneOf(slot) }, zone: zoneOf(slot), danger: dangerNear(slot),
    party: partyNear(slot, 900).map((p) => ({ seat: p.seat, dist: p.dist, hp: p.hpPct })),
    quests: activeQuestIds(), zones: knownZoneIds(),
  }),
  decide: (v) => {                         // the floor: synchronous, never waits
    const a = v.asks?.[0];
    if (a?.k === 'ask_help') return { goal: 'quest', args: { quest: a.args.quest }, say: 'quest_help', sayArgs: { quest: a.args.quest } };
    if (a?.k === 'take_me') return { goal: 'lead', args: { zone: a.args.zone }, say: 'this_way', sayArgs: { zone: a.args.zone } };
    if (a?.k === 'no_thanks') return { goal: 'back', say: 'bye' };
    return v.party?.[0] ? { goal: 'follow', args: { seat: v.party[0].seat } } : { goal: 'back' };
  },
});
```

- **Hands.** In the host's bot step, a guide slot (`b.agent?.role === 'guide'`) does `agents.goalOf(b.slot)` with
  your own movement and combat, at `room.skillOf(b)`; call `agents.done(b.slot, ok)` when the quest or the walk is
  over. With no goal, your usual bot code runs.
- **Asks.** Draw `agents.askButtons(slot, { quests, zones })` as buttons near a guide (mouse and keyboard: a small
  panel; a number key per button works well); a click is `agents.ask(slot, k, args)`. Never a text box.
- **Lines.** `agents.on('say', ({ slot, text }) => speechBubble(slot, text))`, styled like your game's dialogue.
  Quiet AI is already handled.
- **Zones and quests** your RPG keeps server-side or in saves stay where they are; the view only names their ids.

## 4. Turn it on (the owner)

1. `homie-studio servers new <id> "First Steps" --policy beginner --guides 2` (add `--kids` for children).
2. `homie-studio agents brain <id> first-steps workers-ai`: the first time is an ASK the owner taps; then
   `npm run deploy` once (it binds Workers AI). The free allocation (10,000 neurons a day) gives about six busy
   guide-hours; the default budget is 8,000. Or `owner-key` with `agents brain key` on the owner's own computer.
3. Try it: two browsers on the server's page, walk up to a guide, tap "Help me with ...". In a terminal or the
   local MCP, `agent_sit { game: "<id>", server: "first-steps" }` puts your own Claude in a guide's seat.

## 5. Do not

- Put a player's name, account, chat text or anything personal in a view. Seats only.
- Give a guide a goal against players (attack, steal, block), or lines that tease, flirt or ask about a person.
- Let a guide hold the quest's win: it helps, the hero finishes.
- Store guide state in the room for days: a room forgets 60 s after the last person; lasting things are saves.
