/*
 * netplay.ts — Homie netplay contract v1, the game side.
 * =============================================================================
 *
 * Vendor this ONE file into a game (copy it to src/net/netplay.ts). It has no
 * imports and no dependencies, uses only erasable TypeScript (Node can import
 * it with type stripping), and compiles under `strict` and under the games'
 * `strict: false`. The wire protocol, the roles and the budgets it implements
 * are specified in NETPLAY.md beside it; this file is the reference client.
 *
 * WHAT IT DOES
 *   - Finds its shell: `window.HOMIE_NET` (injected by the web shell before the
 *     game's first module runs). No HOMIE_NET — a plain file, a Vite dev
 *     server — means OFFLINE: role `host`, seat `null`, every send a cheap
 *     no-op. The game then seats its local player itself (keys or touch).
 *   - Speaks the v1 wire protocol over one WebSocket: hello/welcome, snapshots
 *     (host -> all), inputs (replica -> host, press edges never lost), events,
 *     keyed slow state, ~1 Hz checkpoints, round and roster, ping/pong clock.
 *   - Keeps a snapshot interpolation buffer in server time (`sample()`), with a
 *     delay measured from how old snapshots really are when they arrive.
 *   - Keeps the body-control table: per seat a reset epoch `rs`, who drives the
 *     body (`own`), and the last input the host had (`ack`). The host resets,
 *     takes and gives bodies; the replica hears it as a `control` event.
 *   - Tells the game about role changes at ANY time: first role, promotion to
 *     host (with the relay's last checkpoint + snapshot + state), demotion.
 *   - Stays alive: yields the host role when its tab is hidden, drops a socket
 *     that went quiet, reconnects with its seat token.
 *   - Reports role/seat/rtt/snapshot rate to the parent shell by postMessage
 *     (for the debug strip) and on `window.__homieNet` (for e2e probes).
 *   - Watching (revision 5, NETPLAY.md section 16): a watcher is a screen that
 *     never takes a seat. `net.viewSeat` is whose view to draw (a player's own
 *     seat; for a watcher, the player it follows, or null for the overview),
 *     `net.follow(seat | 'auto' | null)` changes it (the watch page's strip and
 *     keys 1-9, A and O call it), and Auto follows the action: the newest
 *     `net.spotlight(seat)`, else the leader of the game's `scores` probe.
 *   - Servers and agent seats (revision 6, NETPLAY.md section 17): `net.policy`
 *     is the room's server policy and `net.skillOf(slot)` the skill dial a bot
 *     should play at (the party votes it: `net.vote(n)`, `net.openVote()`);
 *     an AI's seat is marked (`peer.agent`, `net.isAgent(seat)`, every name
 *     ends in " · AI"); `Roster` keeps a hybrid server's AI seats; `net.hushed`
 *     is the player's "Quiet AI".
 *   - Agent hands and brains (revision 7, NETPLAY.md section 18): an AI with no
 *     game client of its own sees the game through `agent:view` events the host
 *     sends its seat and moves through `agent:do` goals; it speaks only the
 *     game's `agents.json` lines (`say:<lineId>`). `@homie-rocks/studio/agents`
 *     (`useAgents`) is the host's side of it; this file only carries the frames.
 *   - Room chat (revision 8, NETPLAY.md section 19): everyone's lines and
 *     reactions (`on('chat')`), the ones to draw over a character
 *     (`on('say')`: a speech bubble, `createBubbles` in the port kit draws
 *     them), messages taken down (`on('unchat')`), and the game's own chat UI
 *     (`net.say(text)`, `net.sayLine(id)`, `net.react(kind)`); the room's rules
 *     are `net.chatRules`. The play page's chat panel needs none of it.
 *   - The arrival (0.26.0, NETPLAY.md section 21): tells its page when the game
 *     is playable, so the play page's arrival card (the game's title, art and a
 *     progress line) gives it the screen: by itself once seated with the room's
 *     state, or the game's own `net.playable()` (`arrival: 'game'`), with
 *     `net.loading(p, what)` while it loads. Nothing crosses the relay.
 *   - The link, said out loud (revision 9, NETPLAY.md section 22): `net.link` and
 *     `on('link')` say whether this browser is in its room (`online`), trying to
 *     get back (`reconnecting`), playing by itself because the room never
 *     answered or did not come back (`alone`), or stopped (`closed`); one line
 *     over the game says which, in words that are true ("Reconnecting…" only to a
 *     page that was connected; restyle it, or `linkOverlay: false`). `reconnecting`
 *     is bounded (`reconnectMaxMs`); `net.full` and `net.line()` say a full room
 *     and a game's own sentence (section 28). A host whose frames hitch keeps its
 *     role with a heartbeat snapshot from a timer.
 *   - Game revisions (section 23): game.json `netplay.version` rides in the hello;
 *     a room runs one build at a time and an older tab is told to reload
 *     (`on('stale')`). `features` are per-peer capability flags the relay keeps,
 *     so a new host knows them without asking again.
 *   - The page around the frame (section 24): `net.prefs` (a few settings kept by
 *     the play page, because the frame has no storage of its own; read a number
 *     with `net.prefs.number(key, fallback)`, never a `null` to multiply by), `net.params`
 *     (the address's switches the page passed in), `net.shell` (where the page's
 *     own buttons sit over the game), and `guardGestures()` for a touch game.
 *   - Rules on the server (revision 10, NETPLAY.md section 29): a game written as
 *     rules plus view has no browser host. `createNetplay({ rules: true })` is what
 *     its view library (`@homie-rocks/studio/rules/view`) starts: this browser never
 *     hosts, its input goes out as steps stamped with the room's tick
 *     (`net.steps(e, k, entries, r)`), and each snapshot names the room's epoch
 *     (`snapshot.e`) and carries one row a seat, `[seat, r, ack, lead]`. A game
 *     written the old way uses none of it and runs exactly as before.
 *
 * WHAT IT DOES NOT DO: rendering, physics, input devices, bots. `Roster` below
 * is the bot-yield bookkeeping a host needs; the bots themselves are the game's.
 * =============================================================================
 */

export const NETPLAY_VERSION = 1;
/** The contract revision this helper speaks (NETPLAY.md): its hello says so (`rev`), and so does every build of it. */
export const NETPLAY_REVISION = 12;
/** In every bundle that includes the helper: `homie-studio build` reads it to tell the office which revision a build speaks. */
export const NETPLAY_MARK = 'homie-netplay-rev:12';

export type Role = 'host' | 'replica' | 'screen';
export type Device = 'phone' | 'desk' | 'tv';
export type Want = 'play' | 'screen';
/** Whose view a watcher draws: a seat, `'auto'` (the action), or `null` (the overview camera). */
export type Follow = number | 'auto' | null;
/**
 * Why the view changed: `start` (the first), `seat` (a player's own seat), `asked` (the watcher or its page chose),
 * `auto` (Auto moved to the action), `left` (the followed player left; Auto took over), `back` (they came back),
 * `policy` (the room or the game allows the overview only now, or again more).
 */
export type ViewWhy = 'start' | 'seat' | 'asked' | 'auto' | 'left' | 'back' | 'policy';
export interface ViewChange {
  /** The seat whose camera and HUD to draw; null: the overview camera. */
  seat: number | null;
  /** What was asked: a seat, 'auto', or null (the whole room). */
  following: Follow;
  prev: number | null;
  why: ViewWhy;
}
/** Who moves a seated body by default. `owner`: the seat's own browser (instant). `host`: the host's rules. */
export type Movement = 'owner' | 'host';

/** What the shell injects as `window.HOMIE_NET` before the game boots. */
export interface NetConfig {
  v: number;
  /** The relay socket: dev `ws://127.0.0.1:<port>/__net?room=main`, site `wss://<host>/api/table/<CODE>/ws?as=net&s=<nonce>`. */
  url: string;
  room?: string;
  /** Seat capability from an earlier welcome (or a lobby reservation). Resumes the same seat. */
  token?: string;
  name?: string;
  device?: Device;
  want?: Want;
  debug?: boolean;
  /** Revision 5: this browser watches (a screen that never takes a seat), from the game's watch door. */
  watch?: boolean;
  /** Whose view the watcher starts on: a seat number, 'auto' (the default) or 'overview'. */
  follow?: number | 'auto' | 'overview';
  /** What the game lets its watchers see (game.json "watch"): 'follow' (the default) or 'overview'. */
  watchPolicy?: 'follow' | 'overview';
  /** Revision 6: this frame plays as an AI (an agent pass; the Worker's word). Its hello says so. */
  agent?: { hands: 'self' | 'host'; role: AgentRole };
  /** Revision 6: the play page's "Quiet AI" is on: AI speech is not shown on this browser. */
  hush?: boolean;
  /** Revision 8: this browser hides room chat (the play page's "Show chat" is off): no `say` bubbles either. */
  chatOff?: boolean;
  /** Revision 8: this player does not want their own messages over their character (the play page's toggle). */
  bubbleOff?: boolean;
  /** Revision 9: the game's revision this page was served with (game.json `netplay.version`); the hello says it. */
  ver?: string;
  /** Revision 9: the switches the play page passed in from its own address (`?q=low&debug`), by name. */
  params?: Record<string, string>;
  /** Revision 9: the page around the frame keeps `net.prefs` (a play page from before it does not say so). */
  prefs?: boolean;
  /**
   * This game runs in a standalone copy (a desktop or phone app, standalone/STANDALONE.md), whose files are the
   * build it was made from: a reload cannot bring a newer one, only an update of the app can. The lines about a newer
   * version say so, and a tap on one reloads nothing. Nothing on the wire changes.
   */
  app?: boolean;
}

/* ------------------------------------------------- the link, revisions and the page (revision 9, sections 22-24) */

/**
 * Where this browser stands with its room. `connecting`: no welcome yet. `online`: in the room. `reconnecting`: it
 * was in the room and its socket went; it is knocking again (its seat token keeps its body), for `reconnectMaxMs` at
 * most. `alone`: the room never answered in time, or did not come back in that time, so this browser plays by itself
 * as an offline host with its own bots (it still knocks, and joins when answered).
 * `offline`: there is no room at all (a plain file, a dev server with no shell). `closed`: stopped for good
 * (`net.closedWhy` says why: another tab took the seat, the room is full, the game was updated…).
 */
export type LinkState = 'connecting' | 'online' | 'reconnecting' | 'alone' | 'offline' | 'closed';
export interface LinkChange {
  state: LinkState;
  prev: LinkState;
  /** Why it changed: `welcome`, `lost` (the socket closed), `stale` (it went silent), `relay-timeout` (the room never answered), `reconnect-timeout` (it was in the room and the room did not come back in `reconnectMaxMs`), `no-shell`, or a refusal's code. */
  why: string;
  /** This browser is running the rules right now (alone, or as the room's host): two browsers can both say so while one is cut off. */
  hosting: boolean;
  /** How long the socket has been down (ms; 0 when it is not). */
  downMs: number;
}
/** A newer build of the game is live (`on('stale')`): this tab still runs `mine`; `final`: it was kept out of a room for it. */
export interface StaleNotice { ver: string | null; mine: string | null; final: boolean; immediate?: boolean }
/** One of the play page's own controls drawn over the game, in CSS pixels of the game's own viewport. */
export interface ShellRect {
  /** `room` (the room button), `server` (the server pill), `chip` (the "3 playing" line), `chat`, `join` (the big screen's QR card), `banner`, `results`. */
  id: string;
  x: number; y: number; w: number; h: number;
  /** It fades by itself after a few seconds (the chip, a toast): still worth keeping important text out of. */
  fades?: boolean;
}
/** Where the page's controls sit over the game on this device, held this way (`on('shell')`; null before the page says). */
export interface ShellLayout {
  device: Device;
  orientation: 'portrait' | 'landscape';
  /** The game frame's size in CSS pixels, as the page sees it. */
  width: number; height: number;
  rects: ShellRect[];
}
/**
 * A few settings the play page keeps for this game on this browser (quality, a personal best, the last name typed):
 * the game's frame has no storage of its own. Strings, numbers, booleans and small JSON; 16 KB a game in all, 64
 * characters a key, 32 keys. Never a secret, never progress that must not be lost (that is cloud saves).
 */
export interface Prefs {
  /**
   * The value kept under `key`, or `fallback`. Always resolves (with the fallback when the page cannot answer, and
   * when nothing or `null` is kept). It is NOT checked against the fallback's type: for a number, a switch or one of
   * a few words, use `number`, `boolean` and `string` below, which cannot hand a game a `null` to multiply by.
   */
  get<T = unknown>(key: string, fallback?: T): Promise<T>;
  /**
   * A NUMBER that cannot go quiet (section 24). The kept value when it is a finite number, else `fallback`: for a
   * key never set, a `null`, a string, a `NaN`, and before the prefs have arrived (`await net.prefs.ready` first;
   * a read before that returns the fallback and warns once). `min` and `max` hold the answer (and the fallback) to
   * a range; `integer` rounds it. `fallback` must itself be a finite number: anything else throws a TypeError.
   */
  number(key: string, fallback: number, range?: { min?: number; max?: number; integer?: boolean }): number;
  /** A switch: the kept value when it is `true` or `false`, else `fallback` (never `0`, `'false'` or `null` read as a boolean). */
  boolean(key: string, fallback: boolean): boolean;
  /** A word: the kept value when it is a string (and one of `oneOf`, when given), else `fallback`. */
  string<T extends string = string>(key: string, fallback: T, opts?: { oneOf?: readonly T[] }): T;
  /**
   * Keep a value (`null` or `undefined` removes it). Resolves false when it was not kept: too big, no page, or a
   * value JSON cannot hold (`NaN`, `Infinity`, a function, a loop), which is refused with a warning rather than
   * kept as `null`.
   */
  set(key: string, value: unknown): Promise<boolean>;
  remove(key: string): Promise<boolean>;
  /** Everything kept for this game. */
  all(): Promise<Record<string, unknown>>;
  /** What this page has read so far, without waiting (after `all()` or `ready` resolved: everything). Before that it is the fallback, and says so once. */
  peek<T = unknown>(key: string, fallback?: T): T;
  /** Resolves once everything kept was read (so `peek`, `number`, `boolean` and `string` are complete). */
  readonly ready: Promise<void>;
  /** Everything kept has been read: the typed readers answer from what is kept, not from their fallbacks. */
  readonly loaded: boolean;
  /** Where the values live: `page` (the play page's storage), `local` (this document's own), `memory` (this visit only). */
  readonly where: 'page' | 'local' | 'memory';
}
/** The arrival, for a performance probe (`window.__homieNet.arrival`). Times are ms since the helper was created. */
export interface ArrivalInfo {
  mode: 'auto' | 'game';
  /** Who gave the game the screen (null: not yet). */
  by: 'auto' | 'game' | null;
  playableMs: number | null;
  /** When the game itself called `net.playable()` (null: it never did). */
  explicitMs: number | null;
  /** The game's own word came this long after an automatic arrival had already lifted the card (null: it did not). */
  lateMs: number | null;
}

/* ------------------------------------------------- room chat (revision 8, section 19) */

export type ChatMode = 'off' | 'emoji' | 'lines' | 'text';
export type ChatWho = 'anyone' | 'signed-in' | 'members';
/** A room's chat rules (the policy's `chat`): what may be sent, who may send it, and the room's reactions and lines. */
export interface ChatRules {
  mode: ChatMode;
  /** Who may type (`text`), and who may send a reaction or a quick line. */
  who: ChatWho;
  react: ChatWho;
  /** Slow mode: seconds between one person's messages (0: off). */
  slow: number;
  /** A typed message's length. */
  max: number;
  links: 'block' | 'allow';
  swears: 'block' | 'allow';
  /** The studio's Workers AI reviews typed messages (the word list always runs). */
  ai: boolean;
  /** A message may show over its sender's character. */
  bubbles: boolean;
  watchers: boolean;
  hub: boolean;
  /** The room's reactions: homie.rocks's five (fire, clap, laugh, heart, wow) and up to three of the game's own. */
  emoji: { k: string; e: string }[];
  /** The room's quick lines: the game's own words (game.json "chat": { "lines" }). */
  lines: { id: string; text: string }[];
  kids?: boolean;
  /** Why the mode is lower than the game asks: `kids`, `server-lines` or `server-off`. */
  capped?: string;
}
/**
 * One message in the room (`on('chat')`): a typed line, a quick line (`say`: its id), a reaction (`react`, `glyph`), or
 * the studio's own line (an announcement). `seat` is the sender's (null: a watcher, a homie.rocks page, the studio);
 * `bubble`: the sender wants it over their character. Names and text are data: draw them as text, never as markup.
 */
export interface ChatLine {
  id: string;
  at: number;
  kind: 'text' | 'line' | 'react' | 'studio';
  name: string;
  seat: number | null;
  colour: number | null;
  by: 'player' | 'watcher' | 'hub' | 'studio';
  text?: string;
  say?: string;
  react?: string;
  glyph?: string;
  bubble?: boolean;
  acct?: boolean;
  owner?: boolean;
  /** This browser sent it. */
  mine?: boolean;
}
/** A message to draw over a character (`on('say')`): the seat's, with its words or its emoji. */
export interface SayBubble { id: string; seat: number; name: string; text: string; glyph?: string; kind: 'text' | 'line' | 'react' }
/** A message that was not sent (to this browser only): `why` is a word (slow, sign-in, words, link, ai…), `message` says it. */
export interface ChatHeld { why: string; message: string; until?: number }

/* ------------------------------------------------- servers and agent seats (revision 6, section 17) */

export type PolicyKind = 'open' | 'humans-only' | 'hybrid' | 'beginner';
export type AgentRole = 'party' | 'guide' | 'player';
/** The skill dial: one shape everywhere. Level 3, Fair, is what bots always were. */
export interface Skill { level: number; name: string; reactionMs: number; aimNoise: number; aggression: number; positioning: number; card?: string }
/** The room's server policy (the Worker's, applied by the relay) with `skill`: the room's dial now. */
export interface Policy {
  v: 1;
  at: number;
  /** null: a named room (it takes the public server's rules). */
  server: { id: string; name: string } | null;
  kind: PolicyKind;
  /** Seats kept for AI companions in every room (hybrid; a beginner server may add some). */
  aiSeats: number;
  /** AI guides in every room (beginner). */
  guides: number;
  /** The game's filler bots: 'off' on a humans-only server unless the owner turned practice bots on. */
  bots: 'fill' | 'off';
  /** The server's level (guides play at it); `skill` is the room's dial (the party's vote, or the owner's). */
  level: number;
  levelMax: number;
  /** 'lines': free chat is dropped (quick lines and emotes pass); 'off': all speech is dropped. */
  speech: 'game' | 'lines' | 'off';
  kids: boolean;
  brain: string;
  skill: Skill;
  by?: 'vote' | 'owner';
  /** Revision 8: the room's chat rules (section 19). */
  chat?: ChatRules;
}
/** What a room says about an AI in a seat (`peer.agent`). */
export interface AgentFacts { pass: string; role: AgentRole; hands: 'self' | 'host'; by: 'studio' | 'guest' | 'service' }
/** The party's vote on the dial (a `vote` frame): options 1..levelMax, how many chose each, the result once closed. */
export interface VoteState {
  of: 'skill';
  id: string;
  open: boolean;
  until: number;
  options: number[];
  counts: Record<string, number>;
  voters: number;
  of_total: number;
  result?: { level: number; name: string; votes: number; why?: string };
  reason?: string;
}

/** The dial's five levels (worker/agents.mjs has the same table; a test keeps them equal). */
export const SKILLS: readonly Skill[] = Object.freeze([
  Object.freeze({ level: 1, name: 'Rookie', reactionMs: 650, aimNoise: 0.55, aggression: 0.1, positioning: 0.1, card: 'stays at the back, misses a lot' }),
  Object.freeze({ level: 2, name: 'Steady', reactionMs: 420, aimNoise: 0.3, aggression: 0.3, positioning: 0.35, card: 'helps, never steals the show' }),
  Object.freeze({ level: 3, name: 'Fair', reactionMs: 250, aimNoise: 0.15, aggression: 0.5, positioning: 0.5, card: 'plays like a regular' }),
  Object.freeze({ level: 4, name: 'Strong', reactionMs: 170, aimNoise: 0.07, aggression: 0.7, positioning: 0.75, card: 'keeps up with good players' }),
  Object.freeze({ level: 5, name: 'Maxed', reactionMs: 110, aimNoise: 0.02, aggression: 0.9, positioning: 0.95, card: 'front-line tank, rarely misses' }),
]);
/** A level as its preset (a copy): 1..5, Fair for anything else; a kids room caps it at 3 and aggression at 0.3. */
export function skillPreset(n: number, kids = false): Skill {
  const level = Math.max(1, Math.min(kids ? 3 : 5, Math.round(Number(n)) || 3));
  const s = { ...(SKILLS[level - 1] as Skill) };
  if (kids) s.aggression = Math.min(s.aggression, 0.3);
  return s;
}
/** The exact mark at the end of every agent's name. */
export const AI_MARK = ' · AI';
const AI_TAIL = /[\s·•∙⋅・|:_\-–—(\[{]+(?:a\.?\s?i\.?|bots?)[\s)\]}.!·•∙⋅・|:_\-–—]*$/iu;
/** A name with every AI or bot mark taken off its end (a person cannot claim one). */
export function stripAi(name: string): string {
  let s = String(name ?? '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 6 && AI_TAIL.test(s); i += 1) s = s.replace(AI_TAIL, '').trim();
  return s.replace(/[\s·•∙⋅・|:_\-–—(\[{]+$/u, '').trim();
}
/** An agent's name as every room shows it: its label (16 characters at most) and " · AI". */
export function aiName(label: string): string {
  const base = [...stripAi(label)].slice(0, 16).join('').trim();
  return `${base || 'Agent'}${AI_MARK}`;
}
/** A room's policy before the relay says one (or an older relay that never will): open, bots fill, Fair. */
export const DEFAULT_POLICY: Policy = Object.freeze({
  v: 1, at: 0, server: null, kind: 'open', aiSeats: 0, guides: 0, bots: 'fill', level: 3, levelMax: 5, speech: 'game', kids: false, brain: 'script',
  skill: SKILLS[2] as Skill,
}) as Policy;
const SPEECH_KIND = /^(?:say|chat|emote)/i;

export interface HostRef { id: string; seat: number | null }

export interface Peer {
  id: string;
  seat: number | null;
  name: string;
  colour: number;
  device: Device;
  want: Want;
  role: Role;
  /** Muted by the studio's owner (section 15): hide this player's chat and emotes. */
  muted?: boolean;
  /** A watcher (section 16): a screen that came to watch; it never takes a seat. */
  watch?: boolean;
  /** Revision 6: an AI in a seat (always named "<label> · AI"). */
  agent?: AgentFacts;
  /**
   * A badge the player's account owns on this studio (a supporter's, from the shop: @homie-rocks/studio 0.24.0), as
   * a word to show beside their name. Only the studio's Worker sets it, from what the account bought; a hello cannot.
   * Never on a kids server, never for an AI.
   */
  badge?: string;
  /**
   * Revision 9: which stay in the seat this is. The relay gives a seat a new number every time it changes hands
   * and keeps it across that browser's reconnects, so a host can tell "the same player came back" from "somebody
   * new has this seat number now". Undefined from an older relay.
   */
  occ?: number;
  /** Revision 9: the game revision this peer's page was served with (game.json `netplay.version`). */
  ver?: string;
  /** Revision 9: what this peer's build says it can do (`createNetplay({ features })`); the relay keeps it. */
  feat?: string[];
}

/** One seat's entry in the body-control table: [seat, rs, own (1|0), ack]. */
export type ControlWire = [seat: number, rs: number, own: number, ack: number];
export interface Snapshot<D = unknown> {
  k: number; st: number; d: D; from?: number | null; c?: ControlWire[]; /** Revision 9: a heartbeat: the host's last state again, while its frames hitch. */ hb?: 1;
  /** Revision 10, a rules game: the room's epoch. Its `c` rows are `[seat, r, ack, lead]` (the placement counter, the newest input stamp the server had, and how early this seat's input arrived, in sixteenths of a tick; -128: none arrived). */
  e?: number;
}
/** Revision 10: one input entry of a rules game, `[o, ...fields]`: a tick offset from the frame's first tick, then the kind's declared input fields in order (and, for an owner-moved body, its claimed position, velocity and heading: nine numbers). */
export type StepEntry = number[];
export interface Checkpoint<D = unknown> { k: number; st: number; d: D; c?: ControlWire[] }
export interface InputFrame<A = unknown> {
  /** Sequence number per sender. */
  q: number;
  /** Client-owned avatar state (owner movement), or intent (host movement). */
  a: A;
  /** Buttons held right now. */
  h: string[];
  /** Press edges since the previous frame, by button id (the relay clamps each to 0..8). */
  p: Record<string, number>;
  /** Sender seat, stamped by the relay (never trusted from the body). */
  from: number;
  /** The reset epoch the sender had adopted when it sent this frame. */
  r: number | null;
}
export interface NetEvent<D = unknown> {
  k: string;
  d: D;
  from: number | null;
  /** The sender's peer id (events to the host only), so the host can answer a screen with `send(k, d, id)`. */
  id?: string;
}

/**
 * The studio's announcement (NETPLAY.md section 15): one line from the studio's owner to everyone in the room, until
 * `until` (server ms). The shell shows it as a banner; a game may show it its own way. `text: null` takes it down.
 */
export interface Announcement { id: string; text: string | null; at?: number; until?: number; from?: string }
/** A player muted (or unmuted, `until: 0`) by the studio's owner: their chat and emotes (`ev` kinds say, chat, emote) reach nobody. */
export interface Mute { id: string; seat: number | null; until: number }

/** A seat's body control as the host keeps it. */
export interface Control {
  seat: number;
  /** Reset epoch: bumped whenever the host moved the body itself; the owner adopts the host's position. */
  rs: number;
  /** true: the seat's browser moves the body (owner movement). false: the host does (host movement, or taken). */
  own: boolean;
  /** Sequence number of the newest input frame the host had from this seat when it sent the snapshot. */
  ack: number;
}
export interface ControlChange<S = unknown> extends Control {
  /** rs changed: put your avatar where `snap` has your body, and drop any prediction. */
  reset: boolean;
  snap: Snapshot<S>;
}
export interface PendingInput<A = unknown> { q: number; a: A; h: string[]; at: number; dt: number }

export interface RoundResult { slot: number; seat: number | null; name: string; score: number; bot: boolean; place: number; /** Revision 6: an AI's row (the relay marks it). */ agent?: true }
export interface RoundInfo {
  n: number;
  phase: 'live' | 'over';
  /** Server ms. */
  startedAt: number;
  /** Server ms: end of the live phase, or end of the intermission when phase is 'over'. */
  endsAt: number;
  results?: RoundResult[];
}
/**
 * A body in the round. Revision 6: `agent` marks an AI's slot: a seat kept for AI (`agent.seat` null: nobody's brain
 * yet, the host's bots move it), or an agent's (its seat; hands `host`: the host's bot code moves it, `bot` stays true).
 */
export interface Slot { slot: number; seat: number | null; name: string; bot: boolean; agent?: { seat: number | null; role: AgentRole; hands: 'self' | 'host' } }

export interface RoleChange<S = unknown, C = unknown> {
  role: Role;
  prev: Role | null;
  why: string;
  /** Became host while a round was already running somewhere: restore from ckpt/snap/state. */
  promoted: boolean;
  /** Was host, is not any more: stop running rules. */
  demoted: boolean;
  ckpt: Checkpoint<C> | null;
  snap: Snapshot<S> | null;
  round: RoundInfo | null;
  roster: Slot[] | null;
  /** Every connected peer including this one. */
  peers: Peer[];
}

export interface Sample<S = unknown> {
  a: Snapshot<S>;
  b: Snapshot<S>;
  /** 0..1 between a and b. */
  alpha: number;
  /** The server time being rendered. */
  renderT: number;
  /** ms the render time is past the newest snapshot (0 when interpolating). */
  starved: number;
}

export interface NetStats {
  role: Role;
  seat: number | null;
  host: HostRef | null;
  connected: boolean;
  offline: boolean;
  rtt: number | null;
  offset: number;
  snapHzIn: number;
  snapHzOut: number;
  inputHzIn: number;
  inputHzOut: number;
  /** Idle input frames not sent (identical to the last one, inside the keepalive interval). */
  idleInputsSkipped?: number;
  lastSnapBytes: number;
  maxSnapBytes: number;
  bytesInPerS: number;
  bytesOutPerS: number;
  interpDelay: number;
  /** 90th percentile of (arrival time - st) over the last 40 snapshots: transit plus clock error. */
  snapAgeP90: number;
  /** Share of sample() calls in the last 2 s window that ran past the newest snapshot. */
  starvedPct: number;
  rejectedSnaps: number;
  owned: boolean;
  pending: number;
  stateKeys: number;
  peers: number;
  reconnects: number;
  /** Revision 9: times a link that was up went down (a reconnect that worked on the first knock counts once). */
  drops?: number;
  /** Revision 9: where this browser stands with its room. */
  link?: LinkState;
  /** Revision 9: heartbeat snapshots sent from the timer while the game's own frames hitched. */
  heartbeats?: number;
  promotions: number;
  round: number | null;
  /** Section 20: the host's decisions: asked, answered by the studio's model ('ai'), the person's own Ollama ('local'), or the floor; median ms. */
  decides?: { asked: number; ai: number; local: number; floor: number; msP50: number | null };
}

export interface Vec { x: number; y: number; z?: number }
/** What a game can expose for harnesses (an end-to-end test reads these through `window.__homieNet.probe`). */
export interface Probes {
  self?: () => Vec | null;
  peer?: (seat: number) => Vec | null;
  frames?: () => number;
  [extra: string]: unknown;
}

/** The guarded rules module supplies this adapter lazily; the vendorable helper imports no runtime. */
export interface RulesHost {
  frame(m: Record<string, unknown>): void;
  sync(peers: Peer[]): void;
  /** The round, the roster, the shared state and the capabilities again, as output: a relay that restarted has none of them. */
  announce(): void;
  pause(): void;
  resume(): void;
  start(): void;
  stop(): void;
  save(): unknown;
  readonly tick: number;
  facts(): Record<string, unknown>;
}
export type RulesHostFactory = (o: { now(): number; send(m: Record<string, unknown>): void; restore: unknown; peers?: Peer[]; held?: Peer[]; policy?: Policy; onEnd(why: string): void }) => RulesHost;

export interface RulesOutputSender {
  push(frame: Record<string, unknown>): void;
  finish(frame: Record<string, unknown>): void;
  /** `yield`, in order behind the checkpoint; what the rules make after it is held until `release()` or `stop()`. */
  handOver(frame: Record<string, unknown>): void;
  readonly handing: boolean;
  readonly waiting: boolean;
  release(): void;
  /** The page is going: what the allowance permits, then the last checkpoint, always. */
  leave(): void;
  stop(): void;
}

export interface NetplayOptions<C = unknown> {
  /** Defaults to `window.HOMIE_NET`. `null` forces offline. */
  config?: NetConfig | null;
  want?: Want;
  /** Revision 5: watch (a screen that never takes a seat). Defaults to the shell's `HOMIE_NET.watch`. */
  watch?: boolean;
  /** A watcher's keys (1-9 a player, A Auto, O or 0 the whole room, arrows the next player). Default true. */
  watchKeys?: boolean;
  /** May this browser be elected host? Default true. */
  canHost?: boolean;
  /**
   * Revision 10: this game is written as rules plus view (NETPLAY.md section 29). Its elected browser or server
   * runs the same host runtime. The view sends input with `net.steps` and reads the control table as rows of
   * `[seat, r, ack, lead]`. Set by the view library (`openRoom`), not by a game.
   */
  rules?: boolean;
  /** Shared relay limits supplied by the rules view; legacy vendor copies stay dependency-free. */
  rulesLimits?: { bytes: Record<string, number>; rates: Record<string, number>; output: (opts: { rates: Record<string, number>; send: (frame: Record<string, unknown>) => void; now: () => number }) => RulesOutputSender };
  /** Set by the rules view's build. Server games load this only once playable, or when starting offline. */
  rulesHost?: { mode: 'server' | 'browser'; offline: boolean; load?: () => Promise<RulesHostFactory> };
  /** Game id, for the relay's logs. */
  game?: string;
  /** Seats in a room (the manifest's players.max). The relay takes it from the first visitor of an empty room. */
  maxPlayers?: number;
  /** Who moves a seated body by default. Default `owner`. */
  movement?: Movement;
  snapshotHz?: number;
  inputHz?: number;
  checkpointMs?: number;
  /** Fixed interpolation delay in ms. Default: adaptive (arrival age p90 + 1.2 intervals). */
  interpDelayMs?: number;
  /** Floor under the adaptive interpolation buffer (rules views). */
  interpFloorMs?: number;
  /** Host: return the full rules state. Called every `checkpointMs`, before yielding, and on pagehide. */
  checkpoint?: () => C;
  /** ms to wait for a welcome before falling back to offline host, when the socket could not even open. Default 4000. */
  connectTimeoutMs?: number;
  /**
   * How long a page whose socket is open (or opening) listens for the room's welcome before it plays alone, counted
   * only while the page can listen. Default 10000; 2000 to 120000. A heavy 3D boot under load that takes longer
   * plays a private round for a few seconds first: raise it, or use `connectClock: 'game'`.
   */
  connectOpenMaxMs?: number;
  /**
   * When that wait starts. 'auto' (the default): when the helper is created. 'game': when the game calls
   * `net.start()`, once it has finished booting (or 60 s after the helper was created, so a game that never says is
   * never left without a role). The socket opens at once either way; a welcome that arrives first is used at once.
   */
  connectClock?: 'auto' | 'game';
  /**
   * How long a page that WAS in its room keeps `reconnecting` before it plays `alone` (a private round with its own
   * bots; it still knocks, and joins when it is answered). Default 20000; 5000 to 300000. Before this there was no
   * bound: a replica whose room never came back showed a frozen round and "Reconnecting…" for good.
   */
  reconnectMaxMs?: number;
  /**
   * A host's heartbeat: when the game has not sent a snapshot for this long while others are present (its frames
   * hitched: a long load, a shader compile, a throttled tab), the helper sends the last one again from a timer, so
   * the relay does not hand the room to somebody else for a pause. Default 500 ms; 0 turns it off. It stops after
   * 4 s without a real snapshot: a game that is really frozen is still replaced.
   */
  heartbeatMs?: number;
  /**
   * The game's revision (game.json `netplay.version`; the play page passes it, so a game rarely sets this itself).
   * A room runs one revision at a time: see NETPLAY.md section 23.
   */
  version?: string;
  /**
   * What this build can do, as short words (`['powerups', 'rhythm2']`: up to 8, each a-z, 0-9 and -, 24 characters).
   * The relay keeps them with the peer, so every host (and the next one) reads `net.featuresOf(seat)` instead of
   * running its own handshake. An older build says none.
   */
  features?: string[];
  /**
   * The line drawn over the game while the link is down ("Reconnecting…", "Playing on your own…"), while the room
   * is full, and for `net.line()`. Default true in a room; false turns it off (listen to `link` and draw your own).
   * Restyle it with CSS on `[data-homie-link]`.
   */
  linkOverlay?: boolean;
  /** A socket that delivered nothing for this long is dropped and reopened (pongs come every 2 s). Default 6000. */
  staleMs?: number;
  /** Tests: a WebSocket constructor. */
  WebSocketImpl?: WebSocketCtor;
  /** Tests / custom shells: where parent notifications go. Default `parent.postMessage` when framed. */
  post?: ((msg: Record<string, unknown>) => void) | null;
  /**
   * Revision 6: what this game does with servers. 'skill': its bots read the dial (`net.skillOf`); 'agents': its host
   * moves an AI's body with its own bot code (a Roster that passes `p.agent`). Reading the dial declares 'skill' too.
   */
  caps?: ('skill' | 'agents')[];
  /**
   * THE ARRIVAL (NETPLAY.md section 21): who says when the play page's arrival card (the game's title, art and a
   * progress line while the room connects and the game loads) gives the screen to the game. 'auto' (the default): this
   * helper, once this browser has its role and the room's state (a host at once, anyone else at its first snapshot),
   * two animation frames later. 'game': the game itself, with `net.playable()` once its world and the player's own body
   * are drawn (the page lifts the card anyway 12 s after the helper attached, so a game that never says is never hidden).
   */
  arrival?: 'auto' | 'game';
}

type WebSocketCtor = new (url: string) => WebSocketLike;
interface WebSocketLike {
  readyState: number;
  bufferedAmount?: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface NetHandlers<S, A, C> {
  role: (e: RoleChange<S, C>) => void;
  join: (p: Peer) => void;
  leave: (p: { id: string; seat: number | null; why: string }) => void;
  input: (f: InputFrame<A>) => void;
  event: (e: NetEvent) => void;
  snapshot: (s: Snapshot<S>) => void;
  /** Seated, not host: my body's control changed (reset, taken, given back). */
  control: (e: ControlChange<S>) => void;
  /** A keyed state value changed (null: deleted). Fires for every key on welcome and promotion too. */
  state: (e: { k: string; d: unknown }) => void;
  round: (r: RoundInfo) => void;
  roster: (slots: Slot[]) => void;
  status: (connected: boolean) => void;
  /** The studio's owner announced something to this room (or took it down: `text: null`). */
  announce: (a: Announcement) => void;
  /** The studio's owner muted or unmuted a player in this room. */
  mute: (m: Mute) => void;
  /** Whose view to draw changed (a watcher's follow, or a player's own seat). Listening says the game draws it. */
  view: (v: ViewChange) => void;
  /** Revision 6: the room's policy or dial changed (a vote's result, the owner, the server). */
  policy: (p: Policy) => void;
  /** Revision 6: the party's vote on the dial opened, moved or closed. */
  vote: (v: VoteState) => void;
  /** Revision 8: a line or a reaction in the room's chat (anyone's, the studio's, mine). */
  chat: (m: ChatLine) => void;
  /** Revision 8: a message to draw over a seat's character (its sender wants it there and this browser shows chat). */
  say: (s: SayBubble) => void;
  /** Revision 8: the studio took messages down: hide them (and their bubbles). */
  unchat: (e: { ids: string[] }) => void;
  /** Revision 8: a message of mine was not sent (slow mode, sign in to type, a word, the studio's filter…). */
  held: (h: ChatHeld) => void;
  /** Revision 9: where this browser stands with its room changed (online, reconnecting, alone, closed). */
  link: (e: LinkChange) => void;
  /** Revision 9: a newer build of the game is live; this tab should reload (section 23). */
  stale: (e: StaleNotice) => void;
  /** Revision 9: the play page's own controls over the game moved (a turn of the phone, a sheet opened). */
  shell: (e: ShellLayout) => void;
}

/**
 * A GAME'S OWN DECISIONS (section 20): typed questions about the game's state that the studio's decision model (Clef)
 * answers with a probability for every option, never with text. A Choice picks one option id (2 to 26), a yes/no
 * (`noul`) is true or false, a Score is a level (2 to 10, lowest first; the answer is the probability-weighted level).
 */
export type DecideQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: 'score'; instructions: string; criteria: string[] };
export type DecidePicks = Record<string, string | boolean | number>;
/**
 * What `decide` resolves to, always: `by` 'ai' (the studio's Workers AI) or 'local' (the person's own Ollama under dev),
 * or 'floor' (the game's own answer: no AI, not opted in, over budget, paced, slow, not the host); `why` says which.
 * `p`: the model's probability for each option (a choice), `{ yes }` (a yes/no), or each level (a score).
 */
export interface Decided { by: 'ai' | 'local' | 'floor'; picks: DecidePicks; p?: Record<string, Record<string, number>>; ms: number; why?: string }
export interface DecideOptions {
  /** The game's own answer, synchronous: used whenever the model's is not there in time. Missing picks fall back to it one by one. */
  floor?: (state: unknown) => DecidePicks;
  /** How long to wait for the model (default 2500 ms; at most 5000). */
  ms?: number;
}

export interface Netplay<S = unknown, A = unknown, C = unknown> {
  readonly role: Role;
  readonly isHost: boolean;
  /** This browser's player seat, or null (a screen, a full room, or offline). */
  readonly seat: number | null;
  readonly spectator: boolean;
  readonly offline: boolean;
  readonly rulesHosting: boolean;
  readonly connected: boolean;
  /** Why the client stopped for good (a refusal reconnecting would repeat: 'replaced', 'room-full', ...), else null. */
  readonly closedWhy: string | null;
  /** How long the socket has been down while it reconnects (ms; 0 while connected). */
  readonly downMs: number;
  /**
   * THE LINK (revision 9, NETPLAY.md section 22). `offline` is true when this browser is NOT in a room: there is no
   * shell at all, or the room never answered and it plays alone (`link === 'alone'`). `connected` is true only while
   * the socket is up and welcomed. Between the two (`!offline && !connected`) the browser was in a room and is
   * knocking again: `link === 'reconnecting'`. `link` says which in one word, and `on('link')` when it changes.
   */
  readonly link: LinkState;
  /** Times the helper has scheduled another knock at the relay (the same number as `stats().reconnects`). 0: never interrupted. */
  readonly reconnects: number;
  /** My welcome gave me back the seat my token named: I am the player who was here, not a new one in the same seat number. */
  readonly resumed: boolean;
  /**
   * This browser asked to play and every seat is taken: it is in the room with no seat (`seat === null`, role
   * `screen`) and the relay seats it when one frees up (a `role` event with `why: 'seated'`). The line over the game
   * says so; the rules view decides what the page shows meanwhile.
   */
  readonly full: boolean;
  /**
   * The line over the game is the game's to use too: one short sentence about where this player stands ("Playing
   * on your own until the next round"), or null to take it away. Shown while the link is `online`; a link that is
   * down says its own line first.
   */
  line(text: string | null): void;
  /** `connectClock: 'game'`: the game has finished booting; the wait for the room's welcome starts now. Once. */
  start(): void;
  /** REVISIONS (section 23): this page's game revision (null: the game names none). */
  readonly version: string | null;
  /** A newer revision is live and this tab should reload: its name (or '' when the relay named none); null otherwise. */
  readonly stale: string | null;
  /** What a seat's build says it can do (its `features`); [] for an older build, an empty seat or a bot. */
  featuresOf(seat: number | null): string[];
  /** Every seated player's build has this feature (bots and AI bodies the host moves are the host's own). */
  allHave(feature: string): boolean;
  /** THE PAGE (section 24): a few settings the play page keeps for this game. */
  readonly prefs: Prefs;
  /** The switches the play page passed in from its address (`/play?q=low&debug`), by name. Offline: this document's own. */
  readonly params: Readonly<Record<string, string>>;
  /** One switch, or `fallback` (a bare `?debug` is `''`). */
  param(name: string, fallback?: string | null): string | null;
  /** Where the play page's own controls sit over the game (null before the page says, or with no page). */
  readonly shell: ShellLayout | null;
  /** The arrival's facts (mode, who lifted the card, when the game itself said it was playable). */
  readonly arrivalInfo: ArrivalInfo;
  /**
   * Host: hand the room to another browser — a checkpoint, then the protocol's `yield` (the same road a hidden
   * tab takes). The relay elects the best other candidate, or keeps me host when nobody else can host.
   * Use it when a big screen or a struggling phone should give the room to a seated computer (never in a
   * host's first 30 s, at most once a minute); false when not sent.
   */
  handOff(): boolean;
  /** Seated replica: true while my browser moves my body; false while the host does (host movement, or taken). */
  readonly owned: boolean;
  readonly id: string | null;
  readonly name: string;
  readonly colour: number;
  readonly device: Device;
  readonly host: HostRef | null;
  readonly peers: ReadonlyMap<string, Peer>;
  readonly roundInfo: RoundInfo | null;
  readonly slots: Slot[] | null;
  /** The studio's announcement now showing in this room, or null. */
  readonly announcement: Announcement | null;
  /** Whether the studio's owner has muted this seat (its chat and emotes reach nobody; a game hides them too). */
  isMuted(seat: number | null): boolean;
  /**
   * A player was clicked (their body, their name): tell the shell. Only the studio's owner's page does anything with
   * it (opens that player's card with Mute and Kick); for everyone else it is nothing.
   */
  pickPlayer(seat: number | null): void;
  /**
   * WATCHING (revision 5, NETPLAY.md section 16). `watching`: this browser is a watcher, a screen that never takes a
   * seat. `viewSeat`: whose camera and HUD to draw: a player's own seat, the seat a watcher follows, or null for the
   * overview camera. Reading it (or listening for `view`) tells the watch page that this game draws the followed
   * player; a game that never does is shown as its overview, and the page says so.
   */
  readonly watching: boolean;
  readonly viewSeat: number | null;
  /** What the watcher asked for: a seat, 'auto' or null (the whole room). */
  readonly following: Follow;
  /**
   * `viewSeat` without saying the game draws it: for an overlay that only marks the followed player (the port's
   * HUD), so a game whose camera does not follow is still shown to its watchers as its overview.
   */
  readonly watchedSeat: number | null;
  /** Whether this watcher may follow one player (false: the game or the room shows it the overview only). */
  readonly canFollow: boolean;
  /** Watcher: follow a seat, 'auto' (the action) or null (the whole room). False when not a watcher or not allowed. */
  follow(target: Follow | 'overview'): boolean;
  /**
   * Anyone: something happened to this player (a hit, a goal, a pickup). Auto cuts to the newest one once the player
   * it shows has had a few seconds. A cheap no-op except on a watcher in Auto.
   */
  spotlight(seat: number | null): void;
  /** The seated players, in seat order (the watch strip's order: key 1 is the first). */
  players(): Peer[];
  /**
   * SERVERS AND AGENT SEATS (revision 6, NETPLAY.md section 17). `policy`: the room's server policy (DEFAULT_POLICY
   * before the relay says one). `skill`: the room's dial now. `skillOf(slot)`: the dial a bot in that slot plays at
   * (a guide plays at the server's level; everyone else at the party's). Reading either tells the room this game's
   * bots read the dial (caps 'skill'), so its play page offers the vote.
   */
  readonly policy: Policy;
  readonly skill: Skill;
  skillOf(slot: number): Skill;
  /** A seated player's vote on the dial (1..levelMax); opens a vote when none is open. False when not sent. */
  vote(n: number): boolean;
  /** Open the party's vote (a dungeon door, a new level): at most once every 2 minutes a room. */
  openVote(of?: 'skill', reason?: string): boolean;
  /** The vote open now (or the last result), or null. */
  readonly voteState: VoteState | null;
  /** The AI peers in the room. */
  agents(): Peer[];
  /** Whether an AI sits in this seat. */
  isAgent(seat: number | null): boolean;
  /** This browser's "Quiet AI": AI speech is dropped before the game hears it. Settable. */
  hushed: boolean;
  /** This browser plays as an AI (the frame of an agent pass). */
  readonly asAgent: boolean;
  /**
   * THE ARRIVAL (section 21): the world and the player's own body are drawn, so the play page's arrival card gives the
   * screen to the game. Once; later calls do nothing. Needed only with `arrival: 'game'` (an 'auto' game may call it
   * earlier than the helper would).
   */
  playable(): void;
  /**
   * While it loads: how far along the game is (0 to 1) and what it is loading ("the heroes"), for the arrival card's
   * progress line. At most ten a second reach the page; nothing after `playable()`.
   */
  loading(fraction: number, what?: string): void;
  /** Resolves with the first role (welcome, or offline fallback). */
  readonly ready: Promise<RoleChange<S, C>>;
  on<K extends keyof NetHandlers<S, A, C>>(kind: K, fn: NetHandlers<S, A, C>[K]): () => void;
  /**
   * ROOM CHAT (revision 8, NETPLAY.md section 19). `chatRules`: the room's rules (null before the relay says them).
   * `say(text)` types a line, `sayLine(id)` sends one of the room's quick lines, `react(kind)` an emoji (fire, clap,
   * laugh, heart, wow, or the game's own): checked by the relay like the play page's own panel; false when not sent
   * (offline, or the room's rules say no). `chatShown`: this browser shows chat (its player can turn it off).
   */
  readonly chatRules: ChatRules | null;
  say(text: string, opts?: { bubble?: boolean }): boolean;
  sayLine(id: string, opts?: { bubble?: boolean }): boolean;
  react(kind: string, opts?: { bubble?: boolean }): boolean;
  readonly chatShown: boolean;
  /** Server time in ms (relay clock). Offline: Date.now(). */
  now(): number;
  /** Host: true when the next `snapshot()` would be sent. Build the state only then. */
  snapshotDue(): boolean;
  /** Host: broadcast fast state (live bodies, projectiles); throttled to snapshotHz (1 Hz while alone). */
  snapshot(d: S, tick?: number, force?: boolean): boolean;
  /** Host: send a checkpoint now (normally automatic via `options.checkpoint`). */
  checkpointNow(): void;
  /** Host: announce a round phase (start / end with results). Relay keeps the latest for joiners and the shell. */
  round(r: RoundInfo): void;
  /** Host: announce slots (humans + bots). Relay keeps the latest for joiners and the shell. */
  roster(slots: Slot[]): void;
  /** Host: set slow keyed state (claims, doors, scores board); `null` deletes. Sent only when it changed. */
  state(key: string, d: unknown): boolean;
  /** Everyone: the latest value of a keyed state entry. */
  stateOf<T = unknown>(key: string): T | undefined;
  stateKeys(): string[];
  /** Player (non-host): own avatar state (or intent) + held buttons, every frame. Batched; press edges sent at once. */
  input(a: A, held?: Iterable<string> | Record<string, boolean>): void;
  /** Player: an explicit press edge (for buttons you do not report as held). */
  press(id: string): void;
  /**
   * Revision 10, a rules game: one input frame. `e` is the room's epoch this browser has adopted, `k` the first room
   * tick the frame covers, `entries` its steps (`[o, ...fields]`, offsets rising) and `r` the placement counter it has
   * adopted. False when not sent (not seated, not connected). The view library calls it; a game calls `room.input`.
   */
  steps(e: number, k: number, entries: StepEntry[], r: number): boolean;
  /** Event. Host: to everyone, or to one seat (number) or one peer id (string, e.g. a screen). Others: to the host. */
  send(kind: string, data?: unknown, to?: number | string): void;
  /** Host: latest input frame from a seat (intents, buttons) whatever the body's control. */
  inputOf(seat: number): InputFrame<A> | null;
  /** Host: the owner's avatar state, or null when the body is not owner-driven or the frame predates the last reset. */
  avatar(seat: number): A | null;
  /** Host: press edges from a seat since the last call (cleared on read). */
  takePresses(seat: number): Record<string, number>;
  /** Host: a seat's control entry (`taken`: the host is driving it, whatever the movement mode). */
  control(seat: number): Control & { taken: boolean };
  /** Host: I moved this body myself (spawn, respawn, takeover, anti-cheat): the owner adopts my position. */
  reset(seat: number): number;
  /** Host: drive this body myself (knockback, carry, stun). With `ms`, it is given back by itself after that long. */
  take(seat: number, ms?: number): void;
  /** Host: hand a taken body back to the room's movement mode where it now is (bumps rs). */
  give(seat: number): void;
  /** Seated replica: my input frames the host had not acknowledged in the newest snapshot, oldest first. */
  pending(): PendingInput<A>[];
  /** Interpolation pair for rendering remote entities. */
  sample(delayMs?: number): Sample<S> | null;
  latest(): Snapshot<S> | null;
  /**
   * Host: ask the studio's decision model (Clef) a few typed questions about the game's state, for a game whose
   * game.json says "decide": true. Always resolves: with the model's picks, or the floor's when it cannot answer in
   * time (no AI, over the day's budget, at most one ask every 3 s a room, a replica, offline). Never per frame: per
   * beat (every few seconds), and the game keeps playing while it waits.
   */
  decide(state: unknown, questions: Record<string, DecideQuestion>, opts?: DecideOptions): Promise<Decided>;
  stats(): NetStats;
  expose(probes: Probes): void;
  close(): void;
}

/* ------------------------------------------------------------------ helpers */

/**
 * The contract's 12 player colours (NETPLAY.md section 3): a peer's `colour` (its seat % 12) indexes this list. The
 * watch page's player strip draws them, so a game that colours its players by seat matches it.
 */
export const PALETTE: readonly string[] = Object.freeze(['#8fe36a', '#ffd166', '#ef6f6c', '#6cb4ee', '#c792ea', '#f4a261', '#2ec4b6', '#ff8fab', '#a7c957', '#e9c46a', '#90e0ef', '#f28482']);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
/** Round to `places` decimals — the cheapest snapshot compression there is. */
export const q = (v: number, places = 2): number => {
  const m = 10 ** places;
  return Math.round(v * m) / m;
};
/**
 * Host: bound a client-owned move. Returns the point at most `maxDist` from `from` toward `to`, and `over`: how far
 * the claim was beyond the bound (Infinity for a non-number). Call every host frame with
 * `maxDist = maxSpeed * dt * 1.3 + slack`; a legitimate avatar catches up within a frame or two, a teleport crawls.
 */
export function capMove(from: Vec, to: Vec, maxDist: number): { x: number; y: number; z?: number; over: number } {
  const hasZ = typeof from.z === 'number' && typeof to.z === 'number';
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y) || (hasZ && !Number.isFinite(to.z as number))) {
    return { x: from.x, y: from.y, ...(hasZ ? { z: from.z as number } : {}), over: Infinity };
  }
  const dx = to.x - from.x; const dy = to.y - from.y; const dz = hasZ ? (to.z as number) - (from.z as number) : 0;
  const d = Math.hypot(dx, dy, dz);
  if (d <= maxDist) return { x: to.x, y: to.y, ...(hasZ ? { z: to.z as number } : {}), over: 0 };
  const k = maxDist / d;
  return { x: from.x + dx * k, y: from.y + dy * k, ...(hasZ ? { z: (from.z as number) + dz * k } : {}), over: d - maxDist };
}

/** Short edge <= 540 CSS px is a phone (the web shell's own rule). */
export function guessDevice(): Device {
  try {
    const asked = new URLSearchParams(location.search).get('hand');
    if (asked === 'phone' || asked === 'desk') return asked;
    return Math.min(innerWidth, innerHeight) <= 540 ? 'phone' : 'desk';
  } catch { return 'desk'; }
}

/* ------------------------------------------------------------------- Roster */

export interface RosterOptions {
  /** Slots always filled (humans + bots). */
  min: number;
  /** Hard cap on slots. */
  max: number;
  botName?: (slot: number) => string;
  /**
   * Revision 6: the room's policy (read from `net.policy`). A hybrid or beginner server keeps
   * `aiSeats + guides` slots for AI (marked `agent`, never given to a person); `bots: 'off'` adds no other filler.
   */
  policy?: () => Policy | null;
  /**
   * ADMISSION (revision 9, NETPLAY.md section 25): which bot's body a NEW arrival takes. Called with the bot slots
   * it may take (never one kept for AI when a person arrives, never another person's), in slot order; return the
   * `slot` to give, `undefined` for the default (the lowest), or `null` when none of them will do (a new body is
   * added when the room has space; when it has none, the default applies: a seated person always gets a body).
   * It must be deterministic from the game's state (a new host asks it again). It is NOT asked for somebody who
   * comes back to the body they held (a reload, a reconnect): returning players keep their body, alive or not.
   */
  admit?: (candidates: Slot[], who: { seat: number; name: string; agent: boolean }) => number | null | undefined;
}
/** What `Roster.claim` did. `back`: the seat got the body it already had, or the one it held last (nobody new). */
export interface Claim { slot: Slot; yielded: boolean; added: boolean; back: boolean }

const copySlot = (s: Slot): Slot => ({ slot: s.slot, seat: s.seat, name: s.name, bot: s.bot, ...(s.agent ? { agent: { seat: s.agent.seat, role: s.agent.role, hands: s.agent.hands } } : {}) });

/**
 * Host-side bookkeeping for bots that yield their slot to an arriving human.
 *
 * A round always has at least `min` bodies. A human who arrives takes back the
 * slot they held last if it is still a bot (a reload lands in the same body),
 * else the lowest bot slot, inheriting that body where it stands; only when no
 * bot is left is a new slot added (up to `max`). A human who leaves turns back
 * into a bot in the same slot, so the round never loses a body mid-play.
 * `trim()` drops surplus bots between rounds.
 *
 * Revision 6 (section 17): with a `policy`, the seats a server keeps for AI are slots marked `agent` (a bot body
 * until an AI sits; a person never takes one). An agent claims one: hands `host` keeps the body a bot that the
 * host's bot code moves (`agent.seat` says whose), hands `self` drives it like a person. An agent who leaves hands
 * the slot back as a seat kept for AI. `bots: 'off'` (a humans-only server) adds no filler bots at all.
 */
export class Roster {
  slots: Slot[] = [];
  readonly min: number;
  readonly max: number;
  readonly botName: (slot: number) => string;
  private readonly policyFn: (() => Policy | null) | null;
  private readonly admitFn: RosterOptions['admit'] | null;
  /** seat → the slot it held when it last left, and which stay in the seat that was (`Peer.occ`) */
  private readonly lastSlot = new Map<number, { slot: number; occ: number | undefined }>();
  /** seat → which stay in the seat holds its slot now (`Peer.occ`; nothing from a relay that does not say) */
  private readonly occ = new Map<number, number>();

  constructor(opts: RosterOptions) {
    this.min = Math.max(0, opts.min | 0);
    this.max = Math.max(this.min, opts.max | 0);
    this.botName = opts.botName ?? ((slot: number) => `Bot ${slot + 1}`);
    this.policyFn = opts.policy ?? null;
    this.admitFn = opts.admit ?? null;
    this.fill();
  }

  /** `occupants`: what `occupants()` returned when the slots were saved (a checkpoint), so a new host can tell who came back. */
  static from(slots: readonly Slot[], opts: RosterOptions, occupants?: readonly (readonly [seat: number, occ: number])[] | null): Roster {
    const r = new Roster(opts);
    r.slots = slots.map(copySlot);
    if (Array.isArray(occupants)) for (const row of occupants) if (Array.isArray(row) && Number.isInteger(row[0]) && Number.isInteger(row[1]) && r.bySeat(row[0] as number)) r.occ.set(row[0] as number, row[1] as number);
    r.fill();
    return r;
  }

  /** Which stay in its seat holds each slot ([seat, occ]): keep it in the checkpoint, beside `toJSON()`. */
  occupants(): [seat: number, occ: number][] {
    return [...this.occ].filter(([seat]) => Boolean(this.bySeat(seat)));
  }

  /**
   * The seat has a slot here, but the relay says somebody else holds that seat number now (it changed hands while
   * this host was not told: a checkpoint of a room that emptied, a host that was cut off). False when either side
   * does not know (an older relay, an older checkpoint): then the seat is taken to be the same player's.
   */
  changedHands(seat: number, occ: number | undefined | null): boolean {
    const known = this.occ.get(seat);
    return typeof occ === 'number' && known !== undefined && known !== occ;
  }

  /** The seat's player is gone for good and a stranger may get the number: its body is a bot's, and nobody "returns" to it. */
  vacate(seat: number): Slot | null {
    const s = this.release(seat);
    this.lastSlot.delete(seat);
    return s;
  }

  private policy(): Policy | null {
    try { return this.policyFn ? this.policyFn() : null; } catch { return null; }
  }

  /** How many slots this room keeps for AI (revision 6): aiSeats + guides, never every slot. */
  reserved(): number {
    const p = this.policy();
    if (!p || (p.kind !== 'hybrid' && p.kind !== 'beginner')) return 0;
    return Math.max(0, Math.min((p.aiSeats | 0) + (p.guides | 0), this.max - 1));
  }

  /** Each kept slot's role: the guides first, then the companions. */
  private reserveRole(i: number): AgentRole {
    const p = this.policy();
    return p && i < (p.guides | 0) ? 'guide' : 'party';
  }

  fill(): void {
    // The seats kept for AI: bot bodies marked `agent` until an AI sits in one.
    const want = this.reserved();
    let have = this.slots.filter((s) => s.agent).length;
    while (have < want && this.slots.length < this.max) {
      const slot = this.nextSlotId();
      this.slots.push({ slot, seat: null, name: aiName(this.botName(slot)), bot: true, agent: { seat: null, role: this.reserveRole(have), hands: 'host' } });
      have += 1;
    }
    // Filler bots, unless the server turned them off.
    if (this.policy()?.bots !== 'off') {
      while (this.slots.length < this.min) {
        const slot = this.nextSlotId();
        this.slots.push({ slot, seat: null, name: this.botName(slot), bot: true });
      }
    }
    this.slots.sort((a, b) => a.slot - b.slot);
  }

  private nextSlotId(): number {
    let id = 0;
    const used = new Set(this.slots.map((s) => s.slot));
    while (used.has(id)) id += 1;
    return id;
  }

  bySeat(seat: number): Slot | undefined { return this.slots.find((s) => (s.seat === seat && !s.bot) || (s.agent && s.agent.seat === seat)); }
  humans(): Slot[] { return this.slots.filter((s) => !s.bot && !s.agent); }
  bots(): Slot[] { return this.slots.filter((s) => s.bot); }
  /** Revision 6: the slots of AI (an agent's, or a seat kept for one). */
  agents(): Slot[] { return this.slots.filter((s) => s.agent); }

  /**
   * A human (or, revision 6, an agent) takes a slot. Returns the slot, whether it yielded a bot, or null (full:
   * spectate). A person never takes a slot kept for AI; an agent takes one first.
   *
   * `occ` (revision 9): which stay in the seat this is (`peer.occ`). The same stay keeps its body (`back`); a seat
   * that changed hands gives its old body back to a bot first, and the newcomer is admitted like any other arrival.
   * A NEW arrival's body is the `admit` callback's choice among the bots it may take, else the lowest.
   */
  claim(seat: number, name: string, agent?: { role?: AgentRole; hands?: 'self' | 'host' } | null, occ?: number | null): Claim | null {
    const stay = typeof occ === 'number' ? occ : undefined;
    const mine = this.bySeat(seat);
    if (mine && !this.changedHands(seat, stay)) {
      if (stay !== undefined) this.occ.set(seat, stay);
      mine.name = name || mine.name;
      return { slot: mine, yielded: false, added: false, back: true };
    }
    // Somebody new holds this seat number: the body its last holder left goes back to a bot, and is not "theirs".
    if (mine) this.vacate(seat);
    const held = this.lastSlot.get(seat);
    const last = held && (stay === undefined || held.occ === undefined || held.occ === stay) ? held.slot : undefined;
    const kept = (s: Slot): boolean => Boolean(s.agent && s.agent.seat === null);
    const plainBot = (s: Slot): boolean => s.bot && !s.agent;
    const settle = (slot: Slot, yielded: boolean, added: boolean, back: boolean): Claim => {
      if (stay !== undefined) this.occ.set(seat, stay); else this.occ.delete(seat);
      this.lastSlot.delete(seat);
      return { slot, yielded, added, back };
    };
    /** The game's choice among `cands` (undefined: the default; null: none of them will do). */
    const chosen = (cands: Slot[]): Slot | null | undefined => {
      if (!this.admitFn || !cands.length) return undefined;
      let r: number | null | undefined;
      try { r = this.admitFn(cands.map(copySlot), { seat, name, agent: Boolean(agent) }); } catch (err) { console.warn('[netplay] admit()', err); return undefined; }
      if (r === null) return null;
      return cands.find((s) => s.slot === r);
    };
    if (agent) {
      const role: AgentRole = agent.role === 'guide' || agent.role === 'player' ? agent.role : 'party';
      const hands = agent.hands === 'host' ? 'host' : 'self';
      const take = (s: Slot): Slot => {
        s.agent = { seat, role: s.agent?.role ?? role, hands };
        s.name = name || aiName(this.botName(s.slot));
        // hands `host`: still a bot body, moved by the host's bot code; hands `self`: driven like a person's.
        if (hands === 'host') { s.bot = true; s.seat = null; } else { s.bot = false; s.seat = seat; }
        return s;
      };
      const back = last !== undefined ? this.slots.find((s) => s.slot === last && (kept(s) || plainBot(s))) : undefined;
      if (back) return settle(take(back), true, false, true);
      // A seat kept for AI first (the reservation), then a plain bot: the game chooses within whichever it is.
      const pool = this.slots.some(kept) ? this.slots.filter(kept) : this.slots.filter(plainBot);
      const pick = chosen(pool);
      const slot = pick ?? (pick === null && this.slots.length < this.max ? undefined : pool[0]);
      if (slot) return settle(take(slot), true, false, false);
      if (this.slots.length >= this.max) return null;
      const s = take({ slot: this.nextSlotId(), seat: null, name: '', bot: true });
      this.slots.push(s);
      this.slots.sort((a, b) => a.slot - b.slot);
      return settle(s, false, true, false);
    }
    const give = (bot: Slot): Slot => { bot.bot = false; bot.seat = seat; bot.name = name || `Player ${seat + 1}`; return bot; };
    const back = last !== undefined ? this.slots.find((s) => s.slot === last && plainBot(s)) : undefined;
    if (back) return settle(give(back), true, false, true);
    const pool = this.slots.filter(plainBot);
    const pick = chosen(pool);
    // "None of these" adds a body while the room has space; a full room still seats the person in the default one.
    const bot = pick ?? (pick === null && this.slots.length < this.max ? undefined : pool[0]);
    if (bot) return settle(give(bot), true, false, false);
    if (this.slots.length >= this.max) return null;
    const slot = this.nextSlotId();
    const s: Slot = { slot, seat, name: name || `Player ${seat + 1}`, bot: false };
    this.slots.push(s);
    this.slots.sort((a, b) => a.slot - b.slot);
    return settle(s, false, true, false);
  }

  /** A human leaves: their slot becomes a bot where it stands. An agent's goes back to a seat kept for AI. */
  release(seat: number): Slot | null {
    const s = this.bySeat(seat);
    if (!s) return null;
    this.lastSlot.set(seat, { slot: s.slot, occ: this.occ.get(seat) });
    this.occ.delete(seat);
    s.bot = true; s.seat = null;
    if (s.agent) {
      const keep = this.slots.filter((x) => x.agent && x !== s).length < this.reserved();
      if (keep) { s.agent = { seat: null, role: s.agent.role, hands: 'host' }; s.name = aiName(this.botName(s.slot)); } else { delete s.agent; s.name = this.botName(s.slot); }
    } else s.name = this.botName(s.slot);
    return s;
  }

  /** Between rounds: remove bots beyond `min` slots (the seats kept for AI stay). Returns the removed slot ids. */
  trim(): number[] {
    const removed: number[] = [];
    const floor = this.policy()?.bots === 'off' ? 0 : this.min;
    let kept = this.slots.filter((s) => s.agent && s.agent.seat === null).length;
    const surplusKept = (): boolean => kept > this.reserved();
    for (let i = this.slots.length - 1; i >= 0; i -= 1) {
      const s = this.slots[i];
      if (!s || !s.bot) continue;
      const isKept = Boolean(s.agent && s.agent.seat === null);
      if (s.agent && !isKept) continue; // an agent's own body (hands host) stays while it is here
      if (isKept ? surplusKept() : this.slots.length > Math.max(floor, this.reserved())) {
        removed.push(s.slot); this.slots.splice(i, 1);
        if (isKept) kept -= 1;
      }
    }
    this.fill();
    return removed;
  }

  /**
   * After a promotion (or a host's own reconnect): make the roster agree with who is actually connected (an agent
   * with its facts). `claimed`: every body a present seat took just now, through the same `claim` (and `admit`) as
   * a fresh join (reset each one); a seat whose number somebody else holds now (`occ` differs) is one of them.
   * `back`: those of `claimed` whose player got the body they held last (nobody new). Players whose slot never left
   * are in neither.
   */
  reconcile(peers: Iterable<{ seat: number | null; name: string; agent?: AgentFacts | null; occ?: number | null }>): { claimed: Slot[]; released: Slot[]; back: Slot[] } {
    const here = new Map<number, { name: string; agent?: AgentFacts | null; occ?: number | null }>();
    for (const p of peers) if (p.seat !== null && p.seat !== undefined) here.set(p.seat, { name: p.name, agent: p.agent ?? null, occ: p.occ ?? null });
    const released: Slot[] = [];
    const claimed: Slot[] = [];
    const back: Slot[] = [];
    for (const s of this.slots.filter((x) => !x.bot || (x.agent && x.agent.seat !== null))) {
      const seat = s.agent && s.agent.seat !== null ? s.agent.seat : s.seat;
      if (seat !== null && !here.has(seat)) { const r = this.release(seat); if (r) released.push(r); }
    }
    for (const [seat, p] of here) {
      const had = this.bySeat(seat);
      if (had && !this.changedHands(seat, p.occ)) { if (typeof p.occ === 'number') this.occ.set(seat, p.occ); continue; }
      if (had) released.push(had);
      const c = this.claim(seat, p.name, p.agent ? { role: p.agent.role, hands: p.agent.hands } : null, p.occ);
      if (c) { claimed.push(c.slot); if (c.back) back.push(c.slot); }
    }
    this.fill();
    return { claimed, released, back };
  }

  toJSON(): Slot[] { return this.slots.map(copySlot); }
}

/* --------------------------------------------------------------- the client */

const LADDER = [250, 500, 1000, 2000, 4000];
/**
 * Relay errors after which reconnecting would only repeat the refusal. A 'flood' kick is NOT one: a replica's
 * inputs bunch up behind a stall it did not cause (a host migration, a relay or network hiccup that delivers a
 * second of frames at once), and a kick that ended the page's play for good left a phone frozen with no word.
 * After one it comes back (its seat token keeps its body), sending at the slow rate below.
 */
const FINAL_ERRORS = new Set(['room-over', 'host-failed', 'replaced', 'version', 'room-full', 'too-many', 'kicked', 'room-closed', 'watch-off', 'agent-pass', 'agents-off', 'agents-unsupported', 'stale']);
/** An AI closed for being alone in a room (`agents-alone`, section 17) waits this long before it knocks again. */
const AGENTS_ALONE_WAIT_MS = 30_000;
/**
 * Input pacing (NETPLAY.md §5): at most this many `in` frames in any rolling second from this browser, whatever
 * the frame rate or the press rate: two thirds of the relay's cap of 60, so frames that reach it bunched (a
 * stall anywhere between) still fit under the cap.
 */
const IN_CAP_PER_S = 32;
/** Longest a page with a live socket listens for the relay's welcome before it plays alone (ms of time it could listen): the default of `connectOpenMaxMs`. */
const CONNECT_OPEN_MAX_MS = 10_000;
/** `connectClock: 'game'`: the wait starts by itself this long after the helper was created, if the game never calls `net.start()`. */
const CONNECT_CLOCK_MAX_MS = 60_000;
/** A host's heartbeat (section 22): the default gap without a snapshot before the timer sends one, and how long it keeps a silent game its role. */
const HEARTBEAT_MS = 500;
const HEARTBEAT_MAX_MS = 4000;
/** How long a page that was in its room stays `reconnecting` before it plays alone: the default of `reconnectMaxMs`. */
const RECONNECT_MAX_MS = 20_000;
/** The link overlay: a reconnect shorter than this is never drawn. */
const LINK_OVERLAY_MS = 700;
/** What a standalone copy says when a newer build of the game is live: the way to it is the app's own update. */
export const APP_STALE_LINE = 'A new version is out. Update the app to play online.';
/** `net.prefs` (section 24): what the play page keeps for one game on one browser. worker/pages.mjs has the same numbers. */
export const PREFS_LIMITS = Object.freeze({ bytes: 16_384, keys: 32, key: 64 });
const PREFS_WAIT_MS = 2000;
const FEATURE = /^[a-z0-9][a-z0-9-]{0,23}$/;
const VERSION = /^[A-Za-z0-9._-]{1,32}$/;
/** A game revision as the contract carries it: 1 to 32 of A-Z a-z 0-9 . _ - (a number is its digits), else null. */
export function cleanVersion(v: unknown): string | null {
  const t = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
  return VERSION.test(t) ? t : null;
}
/** A build's features as the contract carries them: up to 8 short lowercase words. */
export function cleanFeatures(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const x of list) { const k = String(x ?? '').toLowerCase(); if (FEATURE.test(k) && !out.includes(k)) out.push(k); if (out.length >= 8) break; }
  return out;
}

/**
 * PLACES (NETPLAY.md section 26): rows ranked by score, with a tie policy said out loud. `rows` must already be in the
 * order to show them (the tiebreak is the caller's).
 * `'order'` (the default, what results always were): places 1, 2, 3… in that order, so two equal scores get different
 * places. `'shared'`: standard competition places, equal scores share one and the next is skipped (1, 1, 3).
 * `'dense'`: equal scores share one and none is skipped (1, 1, 2).
 */
export type TiePolicy = 'order' | 'shared' | 'dense';
export function placesOf(scores: readonly number[], ties: TiePolicy = 'order'): number[] {
  const out: number[] = [];
  for (let i = 0; i < scores.length; i += 1) {
    if (ties === 'order' || i === 0 || scores[i] !== scores[i - 1]) out.push(ties === 'dense' && i > 0 ? (out[i - 1] as number) + 1 : i + 1);
    else out.push(out[i - 1] as number);
  }
  return out;
}

/**
 * A TOUCH GAME'S GESTURE GUARD (NETPLAY.md section 24), for the game's own page. The play page around the frame
 * already refuses selection, the callout and page gestures on itself, but a long press INSIDE the game's document
 * (a HUD label, a button's text, the canvas) is the game's: on a phone it raises the copy/paste callout or selects
 * text, and the thumb's touch is cancelled. Call it once, early:
 *
 *   const off = guardGestures({ touch: 'canvas, [data-action]' });
 *
 * It makes the page's text unselectable and suppresses the callout and the context menu, and it stops the browser's
 * default for touches that start on the elements `touch` names (pan, pinch, double-tap zoom: `touch-action: none`
 * plus a non-passive `preventDefault`). Text fields, selects, links, ordinary buttons and anything inside
 * `[data-selectable]` keep their native behaviour. Returns the function that takes it all off again.
 */
export interface GestureGuardOptions {
  /** Where gameplay touches land: a selector (default 'canvas'). Touches that start there never pan, zoom or select. */
  touch?: string;
  /** The document to guard (default: this one). */
  document?: Document;
  /** false: add no stylesheet (the listeners only). */
  css?: boolean;
}
const NATIVE_TOUCH = 'input, textarea, select, option, a[href], label, [contenteditable]:not([contenteditable="false"]), [data-selectable]';
export function guardGestures(o: GestureGuardOptions = {}): () => void {
  const doc = o.document ?? (globalThis as { document?: Document }).document;
  if (!doc || typeof doc.addEventListener !== 'function') return () => {};
  const touch = typeof o.touch === 'string' && o.touch.trim() ? o.touch : 'canvas';
  const within = (t: EventTarget | null, sel: string): boolean => {
    const el = t as { closest?: (s: string) => unknown; parentElement?: { closest?: (s: string) => unknown } } | null;
    try { return Boolean(el && (typeof el.closest === 'function' ? el.closest(sel) : el.parentElement?.closest?.(sel))); } catch { return false; }
  };
  /** A field, a link, a select, a marked region: the browser's own behaviour is the right one there. */
  const native = (t: EventTarget | null): boolean => within(t, NATIVE_TOUCH);
  /** A touch the game owns: it started on a gameplay surface. An ordinary button outside one keeps its click. */
  const gameplay = (t: EventTarget | null): boolean => !native(t) && within(t, touch);
  let style: { remove?: () => void } | null = null;
  if (o.css !== false && typeof doc.createElement === 'function') {
    try {
      const el = doc.createElement('style');
      el.setAttribute('data-homie-gestures', '');
      el.textContent = `html,body{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;overscroll-behavior:none}
${touch}{touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
input,textarea,select,[contenteditable]:not([contenteditable="false"]),[data-selectable],[data-selectable] *{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default;touch-action:auto}`;
      (doc.head ?? doc.documentElement)?.appendChild(el);
      style = el;
    } catch { /* a document that takes no styles keeps the listeners */ }
  }
  const stop = (e: Event): void => { if (e.cancelable) e.preventDefault(); };
  const onSelect = (e: Event): void => { if (!native(e.target)) stop(e); };
  const onMenu = (e: Event): void => { if (!native(e.target)) stop(e); };
  const onTouch = (e: Event): void => { if (gameplay(e.target)) stop(e); };
  // iOS's pinch on the page (it has no touch-action for it before 13, and ignores user-scalable).
  const onGesture = (e: Event): void => { if (!native(e.target)) stop(e); };
  const active = { passive: false, capture: true } as AddEventListenerOptions;
  doc.addEventListener('selectstart', onSelect, true);
  doc.addEventListener('contextmenu', onMenu, true);
  doc.addEventListener('touchstart', onTouch, active);
  doc.addEventListener('touchmove', onTouch, active);
  doc.addEventListener('gesturestart', onGesture, active);
  doc.addEventListener('dblclick', onTouch, true);
  return () => {
    doc.removeEventListener('selectstart', onSelect, true);
    doc.removeEventListener('contextmenu', onMenu, true);
    doc.removeEventListener('touchstart', onTouch, active);
    doc.removeEventListener('touchmove', onTouch, active);
    doc.removeEventListener('gesturestart', onGesture, active);
    doc.removeEventListener('dblclick', onTouch, true);
    try { style?.remove?.(); } catch { /* gone */ }
  };
}
/** After the relay reports dropped inputs (or kicked this browser for them): the cap for the next while. */
const IN_SLOW_CAP_PER_S = 15;
const IN_SLOW_MS = 8000;
/** A socket with this much still unsent does not queue another input frame (the newest one waits instead). */
const IN_BACKLOG_BYTES = 2048;
/**
 * An input frame identical to the last one sent (same avatar or intent, same held keys, no press, same reset epoch)
 * goes out at most this often: a player standing still says so four times a second, not twenty. The host already
 * holds that frame, so nothing it reads changes; every incoming socket message is a Durable Object request
 * (billed 20:1), and in a 32-seat room the replicas' inputs are nearly all of them (NETPLAY.md §11).
 */
const IDLE_INPUT_MS = 250;
/** Auto (section 16): a player shown is shown at least this long before the action cuts to another. */
const AUTO_MIN_MS = 3500;
/** Auto, with no action: look again (the leader, or the next player) this often. */
const AUTO_HOLD_MS = 12_000;
/** A followed player who left and comes back within this long is followed again. */
const WISH_MS = 30_000;
/** The watch page's live scores, from the game's `scores` probe, at most this often. */
const SCORES_MS = 1000;

function heldList(held: Iterable<string> | Record<string, boolean> | undefined): string[] {
  if (!held) return [];
  if (typeof (held as Iterable<string>)[Symbol.iterator] === 'function') return [...(held as Iterable<string>)];
  const out: string[] = [];
  for (const [k, v] of Object.entries(held as Record<string, boolean>)) if (v) out.push(k);
  return out;
}

/** A rolling per-second counter. */
function rate() {
  const stamps: number[] = [];
  return {
    hit(now: number) { stamps.push(now); while (stamps.length && (stamps[0] as number) < now - 1000) stamps.shift(); },
    hz(now: number) { while (stamps.length && (stamps[0] as number) < now - 1000) stamps.shift(); return stamps.length; },
  };
}

export function createNetplay<S = unknown, A = unknown, C = unknown>(opts: NetplayOptions<C> = {}): Netplay<S, A, C> {
  const g = globalThis as unknown as {
    HOMIE_NET?: NetConfig; WebSocket?: WebSocketCtor; document?: Document; addEventListener?: typeof addEventListener;
    parent?: Window; __homieNet?: unknown;
  };
  const cfg: NetConfig | null = opts.config === undefined ? (g.HOMIE_NET ?? null) : opts.config;
  const WS: WebSocketCtor | undefined = opts.WebSocketImpl ?? g.WebSocket;
  const snapshotMs = 1000 / Math.max(1, Math.min(30, opts.snapshotHz ?? 20));
  const inputMs = 1000 / Math.max(1, Math.min(30, opts.inputHz ?? 20));
  const checkpointMs = Math.max(250, opts.checkpointMs ?? 1000);
  const connectTimeoutMs = opts.connectTimeoutMs ?? 4000;
  const connectOpenMaxMs = Math.max(2000, Math.min(120_000, Number(opts.connectOpenMaxMs) || CONNECT_OPEN_MAX_MS));
  const reconnectMaxMs = Math.max(5000, Math.min(300_000, Number(opts.reconnectMaxMs) || (opts.rules && (opts.rulesHost?.offline || opts.rulesHost?.mode === 'browser') ? 5000 : RECONNECT_MAX_MS)));
  const heartbeatMs = opts.rules === true || opts.heartbeatMs === 0 ? 0 : Math.max(200, Math.min(2000, Number(opts.heartbeatMs) || HEARTBEAT_MS));
  const staleMs = Math.max(2500, opts.staleMs ?? 6000);
  // Revisions (section 23): the game's revision (the page's word, or the game's own) and what this build can do.
  const version = cleanVersion(opts.version ?? cfg?.ver);
  const features = cleanFeatures(opts.features);
  const device: Device = cfg?.device ?? guessDevice();
  // A watcher (section 16) is a screen that never takes a seat, whatever else it is told.
  const watching = Boolean(opts.watch ?? cfg?.watch);
  const want: Want = watching ? 'screen' : (opts.want ?? cfg?.want ?? 'play');
  const rulesGame = opts.rules === true;
  let canHost = rulesGame ? opts.rulesHost?.mode === 'browser' : opts.canHost ?? true;
  const defaultOwn = (opts.movement ?? 'owner') === 'owner';

  // Where parent notifications go: the shell page around a framed game.
  const post: ((m: Record<string, unknown>) => void) | null = opts.post !== undefined ? opts.post
    : (() => {
      try {
        if (g.parent && g.parent !== (globalThis as unknown)) {
          const p = g.parent;
          return (m: Record<string, unknown>) => { try { p.postMessage({ t: 'homie-net', ...m }, '*'); } catch { /* gone */ } };
        }
      } catch { /* cross-origin parent access is fine for postMessage; anything else: no parent */ }
      return null;
    })();

  const handlers: { [K in keyof NetHandlers<S, A, C>]: Set<NetHandlers<S, A, C>[K]> } = {
    role: new Set(), join: new Set(), leave: new Set(), input: new Set(), event: new Set(),
    snapshot: new Set(), control: new Set(), state: new Set(), round: new Set(), roster: new Set(), status: new Set(), announce: new Set(), mute: new Set(), view: new Set(),
    policy: new Set(), vote: new Set(), chat: new Set(), say: new Set(), unchat: new Set(), held: new Set(),
    link: new Set(), stale: new Set(), shell: new Set(),
  };
  const emit = <K extends keyof NetHandlers<S, A, C>>(kind: K, arg: Parameters<NetHandlers<S, A, C>[K]>[0]): void => {
    for (const fn of [...handlers[kind]]) {
      try { (fn as (x: unknown) => void)(arg); } catch (err) { console.warn(`[netplay] ${String(kind)} handler`, err); }
    }
  };

  // ---------------------------------------------------------------- state
  let rulesHost: RulesHost | null = null;
  let hostLoad: Promise<RulesHostFactory> | null = null;
  let hostGeneration = 0;
  let pendingRules: Record<string, unknown>[] = [];
  let disposed = false;
  let onlineRulesSave: unknown = null;
  const canOffline = !rulesGame || Boolean(opts.rulesHost?.offline || canHost);
  function loadHost(): Promise<RulesHostFactory> | null {
    if (!opts.rulesHost?.load) return null;
    return hostLoad ??= Promise.resolve().then(() => opts.rulesHost!.load!()).catch((error) => { hostLoad = null; throw error; });
  }
  let rulesSender: RulesOutputSender | null = null;
  let yieldTimer: ReturnType<typeof setTimeout> | null = null;
  function stopRules(): void { if (yieldTimer !== null) { clearTimeout(yieldTimer); yieldTimer = null; } rulesSender?.stop(); rulesSender = null; hostGeneration += 1; rulesHost?.stop(); rulesHost = null; pendingRules = []; }
  /**
   * Checkpoint, then yield: one ordered act. A rules host's yield follows its checkpoint through the sender, and what
   * its rules make afterwards is held until the relay answers (a `role` to somebody else, or `host` with
   * `why: 'host-kept'`), so no page is shown a tick the next host will run again.
   */
  function yieldHost(extra: Record<string, unknown> = {}): boolean {
    sendCheckpoint();
    if (!rulesHost || !rulesSender) return raw({ t: 'yield', ...extra });
    rulesSender.handOver(extra);
    // An answer that never comes (a relay that does not know the frame) must not hold the room's output for good.
    if (yieldTimer === null) yieldTimer = setTimeout(yieldAnswered, 2000);
    return true;
  }
  function yieldAnswered(): void {
    if (yieldTimer !== null) { clearTimeout(yieldTimer); yieldTimer = null; }
    rulesPace = null;
    rulesSender?.release();
    // A second yield was queued behind what was held: it waits for its own answer.
    if (rulesSender?.waiting) yieldTimer = setTimeout(yieldAnswered, 2000);
  }
  function rulesFrame(m: Record<string, unknown>): boolean {
    if (!rulesGame || role !== 'host' || offline) return false;
    if (rulesHost) rulesHost.frame(m);
    else if (pendingRules.length < 256) pendingRules.push(m);
    return true;
  }
  function rulesPeers(): Peer[] {
    if (!offline) return [...peers.values()];
    return seat === null ? [] : [{ id: 'offline', seat, name: name || 'You', colour: seat % 12, device, want: 'play', role: 'host', occ: 1 }];
  }
  function rulesNotice(text: string): void {
    api.line(text);
    setTimeout(() => { if (!disposed && gameLine === text) api.line(null); }, 8000);
  }
  function unavailableRules(): void {
    canHost = false;
    stopRules(); setRole('replica', 'rules-unavailable');
    if (!offline && ws) { raw({ t: 'bye' }); lost(ws, 'rules-unavailable'); }
    api.line('This game needs a connection.');
  }
  function endRules(why: string, message = `This game's rules stopped: ${why}`): void {
    if (offline && cfg?.url) {
      stopRules(); setRole('replica', 'offline-rules-ended');
      api.line(`Offline rules stopped: ${why}. This game needs a connection.`);
      return;
    }
    const sender = rulesSender; rulesSender = null;
    if (sender) sender.finish({ t: 'rules-end', why }); else raw({ t: 'rules-end', why, rules: true });
    stopRules(); setRole('replica', 'rules-ended');
    closed = true; api.line(message); setLink('closed', 'rules-ended');
  }
  function startRules(restore: unknown): void {
    stopRules();
    const generation = hostGeneration;
    const loading = loadHost();
    if (!loading) { unavailableRules(); return; }
    void loading.then((make) => {
      if (disposed || generation !== hostGeneration || role !== 'host') return;
      try {
        rebase = true;
        rulesPace = null;
        if (!opts.rulesLimits) throw new Error('Rules output limits are missing');
        rulesSender = opts.rulesLimits.output({ rates: opts.rulesLimits.rates, send: raw, now: () => performance.now() });
        const options = { now: () => performance.now(), restore, peers: rulesPeers(), held: offline ? [] : heldPeers, policy: offline ? DEFAULT_POLICY : policy, send: rulesOut, onEnd: (why: string) => endRules(why) };
        try { rulesHost = make(options); }
        catch (error) {
          if (!restore) throw error;
          rulesHost = make({ ...options, restore: null });
          rulesNotice('The saved round could not be restored. A new round has started.');
        }
        rulesHost.frame({ t: 'policy', policy: offline ? DEFAULT_POLICY : policy });
        rulesHost.sync(rulesPeers());
        for (const m of pendingRules) rulesHost.frame(m);
        pendingRules = [];
        rulesHost.start();
        if (offline && cfg?.url && !closed) { if (retryTimer !== null) clearTimeout(retryTimer); retryTimer = setTimeout(open, 0); }
        if (hidden()) rulesHost.pause();
        sendCheckpoint(); paintLink();
      } catch (error) {
        if (generation === hostGeneration && !disposed) { endRules('fault', 'The game rules could not start. Reload to try again.'); console.warn('[netplay] rules startup failed', error); }
      }
    }, (error) => {
      if (generation === hostGeneration && !disposed) { unavailableRules(); console.warn('[netplay] rules module failed to load', error); }
    });
  }
  /** A local host sees its own output too. No offline frame is ever sent or saved to the relay. */
  let rulesPace: { at: number; tick: number } | null = null;
  let rulesWireStamp = -Infinity;
  let rulesSimStamp = 0;
  let rulesFrameAt = 0;
  let rulesWireOffset: number | null = null;
  let rulesRound: Record<string, unknown> | null = null;
  function rulesOut(m: Record<string, unknown>): void {
    const offset = now() - performance.now();
    let slowYield: Record<string, unknown> | null = null;
    if (m.t === 'snap') {
      const at = performance.now();
      if (!rulesPace) rulesPace = { at, tick: Number(m.k) };
      else if (at - rulesPace.at >= 5000) {
        const { at: paceAt, tick: paceTick } = rulesPace;
        const slow = (Number(m.k) - rulesPace.tick) * 1000 < (at - rulesPace.at) * (opts.snapshotHz ?? 20) / 2;
        rulesPace = { at, tick: Number(m.k) };
        if (slow && !offline && peers.size > 1 && !hidden()) slowYield = { slow: true, speed: (Number(m.k) - paceTick) * 1000 / ((at - paceAt) * (opts.snapshotHz ?? 20)) };
      }
      rulesWireStamp = Math.max(rulesWireStamp + Math.max(1, Number(m.st) - rulesSimStamp), Math.round(Number(m.st) + offset));
      rulesSimStamp = Number(m.st); rulesFrameAt = performance.now();
      m = { ...m, st: rulesWireStamp };
      if (rulesWireOffset !== null && Math.abs(offset - rulesWireOffset) > 50 && rulesRound) { const { results, ...round } = rulesRound.round as RoundInfo; rulesOut({ ...rulesRound, round, retime: true }); }
      rulesWireOffset = offset;
    }
    if (m.t === 'round') rulesRound = m;
    if (m.t === 'round') { const r = m.round as RoundInfo; m = { ...m, round: { ...r, startedAt: Math.round(r.startedAt + offset), endsAt: Math.round(r.endsAt + offset) } }; }

    if (!offline && connected) rulesSender?.push(m);
    // A slow host yields after the snapshot of the tick its checkpoint saves, so nothing of that tick follows the yield.
    if (slowYield) yieldHost(slowYield);
    if (!offline && connected && ['ev', 'roster', 'round', 'state'].includes(String(m.t))) return;
    if (m.t === 'snap') { tick = Number(m.k); onSnap(m, 0, true); }
    else if (m.t === 'state' && typeof m.k === 'string') applyState(m.k, m.d);
    else if (m.t === 'round') { const incoming = m.round as RoundInfo; roundInfo = m.retime && roundInfo?.n === incoming.n ? { ...roundInfo, ...incoming } : incoming; if (!m.retime) { emit('round', roundInfo); post?.({ what: 'round', round: roundInfo }); } }
    else if (m.t === 'roster' && (offline || !connected)) { slots = m.slots as Slot[]; emit('roster', slots); post?.({ what: 'roster', slots }); }
    else if (m.t === 'ev' && (m.to === undefined || m.to === seat || m.to === id)) emit('event', { k: String(m.k), d: m.d, from: typeof m.from === 'number' ? m.from : null });
  }
  let role: Role = 'replica';
  let roleKnown = false;
  let seat: number | null = null;
  let id: string | null = null;
  let token: string | undefined = cfg?.token;
  let name = cfg?.name ?? '';
  let colour = 0;
  let host: HostRef | null = null;
  let offline = !cfg || !cfg.url || !WS;
  let connected = false;
  let closed = false;
  let ws: WebSocketLike | null = null;
  let attempt = 0;
  let reconnects = 0;
  let drops = 0;
  let heartbeats = 0;
  /** My welcome gave me back the seat my token named (the same player), and a newer build is live (section 23). */
  let resumed = false;
  let staleVer: string | null = null;
  let promotions = 0;
  let lastMsgAt = 0;
  let socketStartedAt = 0;
  let waitingVisible = false;
  const peers = new Map<string, Peer>();
  let heldPeers: Peer[] = [];
  let roundInfo: RoundInfo | null = null;
  let slots: Slot[] | null = null;
  let lastCkpt: Checkpoint<C> | null = null;

  // keyed slow state
  const stateMap = new Map<string, unknown>();
  const stateSent = new Map<string, string>();

  // body control: the host's table, and this replica's own entry
  const ctl = new Map<number, { rs: number; own: boolean; taken: boolean; ack: number; giveAt: number }>();
  let mine = { rs: 0, own: defaultOwn, ack: 0 };

  // clock
  let offset = 0;
  let rtt: number | null = null;
  const samples: { rtt: number; off: number }[] = [];
  const pingsOut = new Map<number, number>();

  // snapshots
  const buf: Snapshot<S>[] = [];
  let lastSnapSentAt = -Infinity;
  let tick = 0;
  let iv = snapshotMs;
  let lastArrival = 0;
  let lastArrivalSt = 0;
  const ages: number[] = [];
  let ageP90 = 0;
  let delaySmooth = 0;
  let rebase = false;
  let rejectedSnaps = 0;
  let sampleFrames = 0;
  let starvedFrames = 0;
  let starvedPct = 0;
  let starvedWindowAt = 0;
  let lastSnapBytes = 0;
  let maxSnapBytes = 0;
  let lastSnapInfo: { k: number; st: number; from: number | null; at: number } | null = null;
  const snapIn = rate();
  const snapOut = rate();
  const inputIn = rate();
  const inputOut = rate();
  const bytesIn: { at: number; n: number }[] = [];
  const bytesOut: { at: number; n: number }[] = [];

  // inputs
  let inSeq = 0;
  let lastInputSentAt = -Infinity;
  let pendingA: A | undefined;
  let pendingHeld: string[] = [];
  let prevHeld = new Set<string>();
  let pendingPresses: Record<string, number> = {};
  let inputTimer: ReturnType<typeof setTimeout> | null = null;
  /** The last input frame sent, as text (idle frames repeat it at most every IDLE_INPUT_MS). */
  let lastInputSig = '';
  /** Wall times of the input frames sent in the last second, and until when the slow cap holds. */
  const inSent: number[] = [];
  let inSlowUntil = 0;
  /** Section 20: decisions waiting for the room's answer (by request id), and how long the room said it is off. */
  const deciding = new Map<string, { done: (d: Decided) => void; timer: ReturnType<typeof setTimeout>; at: number; floor: () => Decided }>();
  let decideSeq = 0;
  let decideOffUntil = 0;
  let decideNextAt = 0;
  const decideStats = { asked: 0, ai: 0, local: 0, floor: 0, ms: [] as number[] };
  let idleSkipped = 0;
  /** Why this client stopped for good (a FINAL_ERRORS refusal), or null while it plays or reconnects. */
  let closedWhy: string | null = null;
  // The arrival (section 21): the play page's card lifts at `playable` (the game's word, or this helper's).
  const arrival: 'auto' | 'game' = opts.arrival === 'game' ? 'game' : 'auto';
  let playableSent = false;
  let autoArmed = false;
  let snapSeen = false;
  let loadingAt = 0;
  const createdAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const arrived: ArrivalInfo = { mode: arrival, by: null, playableMs: null, explicitMs: null, lateMs: null };
  function sayPlayable(by: 'game' | 'auto'): void {
    if (playableSent) return;
    playableSent = true;
    arrived.by = by;
    arrived.playableMs = Math.round(wall() - createdAt);
    post?.({ what: 'playable', by });
    if (rulesGame && canOffline && !canHost) void loadHost()?.catch(() => {});
  }
  /**
   * The game's own `net.playable()`. With `arrival: 'auto'` the helper may already have given the game the screen
   * (seated, the room's state in): a later call then changes nothing, and a performance probe has measured an empty
   * world as playable. Say so once, and tell the page when the game itself was ready, so a report can show both.
   */
  function explicitPlayable(): void {
    if (arrived.explicitMs !== null) return;
    arrived.explicitMs = Math.round(wall() - createdAt);
    const late = playableSent && arrived.by === 'auto' && arrived.playableMs !== null ? arrived.explicitMs - arrived.playableMs : null;
    if (late !== null && late >= 250) {
      arrived.lateMs = late;
      console.warn(`[netplay] net.playable() came ${late} ms after the arrival card had already lifted: this game uses the automatic arrival (seated, with the room's state), so its own word changed nothing and the card left before the game was ready. Pass createNetplay({ arrival: 'game' }) so the card waits for net.playable().`);
    }
    post?.({ what: 'ready', by: 'game', mode: arrival, ms: arrived.explicitMs, ...(arrived.lateMs !== null ? { lateMs: arrived.lateMs } : {}) });
    sayPlayable('game');
  }
  /** 'auto': a host at once, anyone else at its first snapshot, then two animation frames (the game drew with it). */
  function autoPlayable(): void {
    if (arrival !== 'auto' || playableSent || autoArmed || !roleKnown) return;
    if ((rulesGame || role !== 'host') && !snapSeen) return;
    autoArmed = true;
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
    const later = (fn: () => void): void => { if (typeof raf === 'function') raf(fn); else setTimeout(fn, 16); };
    later(() => later(() => sayPlayable('auto')));
  }
  /** The studio's announcement now showing, and the seats the studio muted (until when, server ms). */
  let announcement: Announcement | null = null;
  const muted = new Map<number, number>();
  /** Wall time the socket went down (0 while connected): how long a reconnect has taken. */
  let downSince = 0;
  const sentHist: { q: number; a: A; h: string[]; at: number; r: number }[] = [];
  const inputs = new Map<number, InputFrame<A>>();
  const presses = new Map<number, Record<string, number>>();

  let probes: Probes = {};

  // watching (section 16)
  const firstFollow = cfg?.follow;
  let following: Follow = typeof firstFollow === 'number' && Number.isInteger(firstFollow) && firstFollow >= 0 ? firstFollow : firstFollow === 'overview' ? null : 'auto';
  /** The seat drawn now, and whether the game has shown it draws a followed player (it read viewSeat or listens). */
  let viewNow: number | null = null;
  let viewKnown = false;
  let follows = false;
  /** The page's word (game.json "watch": "overview") and the relay's (welcome.watch / watch frames). */
  const policyFollow = cfg?.watchPolicy !== 'overview';
  let relayFollow = true;
  let relayWhy: string | null = null;
  /** Auto's choice and when it was made; the newest spotlight; a followed player who left, and when. */
  let autoSeat: number | null = null;
  let autoAt = 0;
  let spot = { seat: -1, at: 0 };
  /** A spotlight waiting for the player shown to have had their moment: Auto looks again exactly then. */
  let spotTimer: ReturnType<typeof setTimeout> | null = null;
  let wish: number | null = null;
  let wishAt = 0;
  let lastViewPost = '';

  // servers and agent seats (section 17)
  let policy: Policy = DEFAULT_POLICY;
  let voteState: VoteState | null = null;
  /** What this game does with servers: its own word, and 'skill' once it reads the dial. Sent to the relay when hosting. */
  const caps = new Set<string>((opts.caps ?? []).filter((k) => k === 'skill' || k === 'agents'));
  let capsSent = '';
  const asAgent = cfg?.agent && typeof cfg.agent === 'object' ? { hands: cfg.agent.hands === 'host' ? 'host' : 'self', role: cfg.agent.role ?? 'party' } : null;
  let hushed = cfg?.hush === true;
  let aloneUntil = 0;
  // room chat (section 19): this browser shows chat (the play page's "Show chat"), and wants its own lines over its character.
  let chatShown = cfg?.chatOff !== true;
  let bubbleMine = cfg?.bubbleOff !== true;
  let chatSeq = 0;

  const wall = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const now = (): number => (offline ? Date.now() : Date.now() + offset);

  let resolveReady: (e: RoleChange<S, C>) => void = () => {};
  const ready = new Promise<RoleChange<S, C>>((res) => { resolveReady = res; });

  const countBytes = (list: { at: number; n: number }[], n: number): void => {
    const t = wall();
    list.push({ at: t, n });
    while (list.length && (list[0] as { at: number }).at < t - 1000) list.shift();
  };
  const perSecond = (list: { at: number; n: number }[]): number => {
    const t = wall();
    while (list.length && (list[0] as { at: number }).at < t - 1000) list.shift();
    return list.reduce((s, x) => s + x.n, 0);
  };

  function raw(msg: Record<string, unknown>): boolean {
    if (!ws || ws.readyState !== 1) return false;
    const text = JSON.stringify(msg);
    try { ws.send(text); } catch { return false; }
    countBytes(bytesOut, text.length);
    return true;
  }

  /* ------------------------------------------------------------ the link (revision 9, section 22) */
  let link: LinkState = offline ? 'offline' : 'connecting';
  /** The line over the game while the link is down: made on first need, in this document, so a game's CSS reaches it. */
  const overlayOn = opts.linkOverlay !== false && !offline;
  /** A standalone copy (HOMIE_NET.app): a newer build is reached by updating the app, never by a reload. */
  const inApp = cfg?.app === true;
  let overlay: HTMLElement | null = null;
  let overlayTimer: ReturnType<typeof setTimeout> | null = null;
  let overlayHide: ReturnType<typeof setTimeout> | null = null;
  function overlayEl(): HTMLElement | null {
    const doc = g.document;
    if (!overlayOn || !doc || typeof doc.createElement !== 'function' || !doc.body) return null;
    if (overlay) return overlay;
    try {
      // :where() has no specificity: any rule a game writes for [data-homie-link] wins.
      const st = doc.createElement('style');
      st.setAttribute('data-homie-link-style', '');
      st.textContent = ':where([data-homie-link]){position:fixed;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);z-index:2147483000;max-width:calc(100vw - 24px);padding:8px 14px;border-radius:999px;background:rgba(8,12,22,.9);color:#fff;font:600 13px/1.25 ui-sans-serif,system-ui,-apple-system,sans-serif;text-align:center;pointer-events:none;-webkit-user-select:none;user-select:none}:where([data-homie-link][hidden]){display:none}:where([data-homie-link="stale"]){pointer-events:auto;cursor:pointer}';
      (doc.head ?? doc.documentElement).appendChild(st);
      const el = doc.createElement('div');
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.hidden = true;
      el.addEventListener('click', () => { if (!inApp && el.getAttribute('data-homie-link') === 'stale') { try { (globalThis as { location?: Location }).location?.reload(); } catch { /* not a page */ } } });
      doc.body.appendChild(el);
      overlay = el;
    } catch { overlay = null; }
    return overlay;
  }
  /** Asked to play and every seat is taken (the welcome's `full`): in the room, watching, seated when one frees up. */
  let full = false;
  /** The game's own sentence for the line (`net.line`), shown while the link is up. */
  let gameLine: string | null = null;
  /** Why this page plays alone, and the last refusal that was not final (`room-stale`): the line says the true one. */
  let aloneWhy = '';
  let lastRefusal = '';
  type LineKind = 'offline' | 'reconnecting' | 'alone' | 'stale' | 'closed' | 'full' | 'seat';
  function showOverlay(kind: LineKind, text: string, forMs = 0): void {
    const el = overlayEl();
    if (!el) return;
    if (overlayHide) { clearTimeout(overlayHide); overlayHide = null; }
    el.setAttribute('data-homie-link', kind);
    el.textContent = text;
    el.hidden = false;
    if (forMs > 0) overlayHide = setTimeout(() => { overlayHide = null; if (el.getAttribute('data-homie-link') === kind) el.hidden = true; }, forMs);
  }
  /** What is true of a page that plays by itself: it never says "reconnecting" to somebody who was never connected. */
  function aloneText(): string {
    if (!canOffline) return 'This game needs a connection.';
    if (rulesGame && !rulesHost) return 'Loading offline play…';
    if (aloneWhy === 'reconnect-timeout') return 'Playing on your own · the room dropped, still trying…';
    if (lastRefusal === 'room-stale') return 'Playing on your own · this room opens when its players have the new version';
    return 'Playing on your own · still looking for the room…';
  }
  /** A page stopped for good says why in words; the play page around it offers the way out (another room, a reload). */
  function closedText(): string | null {
    if (closedWhy === 'room-full' || closedWhy === 'too-many') return offline ? 'This room is full · playing on your own' : 'This room is full.';
    if (closedWhy === 'replaced') return 'This game is open in another tab.';
    if (closedWhy === 'kicked' || closedWhy === 'room-closed') return 'This room is closed.';
    if (closedWhy === 'version') return inApp ? APP_STALE_LINE : 'This game needs a reload to play online.';
    return null;
  }
  function paintLink(): void {
    if (!overlayOn) return;
    if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
    const closedSays = link === 'closed' ? gameLine || closedText() : null;
    if (link === 'reconnecting') {
      // A blip shorter than a blink is never drawn.
      overlayTimer = setTimeout(() => { overlayTimer = null; if (link === 'reconnecting') showOverlay('reconnecting', 'Reconnecting…'); }, LINK_OVERLAY_MS);
    } else if (link === 'offline' && !canOffline) showOverlay('offline', 'This game needs a connection.');
    else if (link === 'alone') showOverlay('alone', gameLine || aloneText());
    else if (link === 'closed' && closedWhy === 'stale') showOverlay('stale', inApp ? APP_STALE_LINE : 'This game was updated. Tap to reload.');
    else if (closedSays) showOverlay('closed', closedSays);
    // In the room: the game's own sentence about where this player stands, else that the room is full.
    else if (link === 'online' && gameLine) showOverlay('seat', gameLine);
    else if (link === 'online' && full) showOverlay('full', 'This room is full · watching until a seat is free');
    else if (overlay && overlay.getAttribute('data-homie-link') !== 'stale') overlay.hidden = true;
  }
  function setLink(next: LinkState, why: string): void {
    if (next === link) return;
    const prev = link;
    link = next;
    const e: LinkChange = { state: next, prev, why, hosting: roleKnown && role === 'host', downMs: connected || !downSince ? 0 : Math.round(wall() - downSince) };
    post?.({ what: 'link', state: next, prev, why, hosting: e.hosting });
    paintLink();
    emit('link', e);
  }
  /** A newer build is live (section 23): the relay's `stale` frame (still playing) or its `stale` refusal (kept out). */
  function noteStale(ver: unknown, final: boolean, immediate = false): void {
    const next = cleanVersion(ver) ?? '';
    const first = staleVer === null;
    staleVer = next;
    if (!first && !final) return;
    post?.({ what: 'stale', ver: next || null, mine: version, final, ...(immediate ? { immediate: true } : {}) });
    if (!final) showOverlay('stale', inApp ? APP_STALE_LINE : 'A new version is ready. Tap to reload.', 10_000);
    emit('stale', { ver: next || null, mine: version, final, ...(immediate ? { immediate: true } : {}) });
  }

  /* ------------------------------------------------------------ the page around the frame (revision 9, section 24) */
  // The address's switches: the play page's allow-listed ones (HOMIE_NET.params), or, with no page, this document's own.
  const params: Readonly<Record<string, string>> = Object.freeze((() => {
    const out: Record<string, string> = {};
    const given = cfg?.params;
    if (given && typeof given === 'object') {
      for (const [k, v] of Object.entries(given).slice(0, 32)) if (typeof v === 'string') out[k] = v;
      return out;
    }
    try {
      const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
      // With no page at all, the document's own address. In a frame whose page predates `params`, only the
      // switches that page always passed on (its own words, the seat's token among them, are in the address too).
      const always = ['debug', 'q', 'touchdebug', 'cam', 'view'];
      // forEach, not iteration: a game checked with lib "DOM" alone (no DOM.Iterable) has no iterator on URLSearchParams.
      let seen = 0;
      if (search) new URLSearchParams(search).forEach((v, k) => { if (seen++ < 32 && (!cfg || always.includes(k))) out[k] = v; });
    } catch { /* not a page */ }
    return out;
  })());
  let shellLayout: ShellLayout | null = null;
  function readShell(m: Record<string, unknown>): void {
    if (!Array.isArray(m['rects'])) return;
    const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
    const rects: ShellRect[] = [];
    for (const r of (m['rects'] as Record<string, unknown>[]).slice(0, 16)) {
      if (!r || typeof r !== 'object' || typeof r['id'] !== 'string') continue;
      const rect: ShellRect = { id: String(r['id']).slice(0, 24), x: num(r['x']), y: num(r['y']), w: Math.max(0, num(r['w'])), h: Math.max(0, num(r['h'])) };
      if (r['fades'] === true) rect.fades = true;
      if (rect.w && rect.h) rects.push(rect);
    }
    const dev = m['device'] === 'phone' || m['device'] === 'tv' ? m['device'] : 'desk';
    shellLayout = { device: dev, orientation: m['orientation'] === 'portrait' ? 'portrait' : 'landscape', width: num(m['width']), height: num(m['height']), rects };
    emit('shell', shellLayout);
  }

  // net.prefs: the play page keeps them (it says so in HOMIE_NET.prefs); with no page, this document's own storage
  // when it has one (a plain file, a dev server), else memory for the visit.
  const prefsKey = `homie-prefs.${String(opts.game ?? 'game').slice(0, 64)}`;
  const prefsCache = new Map<string, unknown>();
  const prefsAsks = new Map<number, (m: Record<string, unknown>) => void>();
  let prefsSeq = 0;
  let prefsReady: Promise<void> | null = null;
  const localStore = (): Storage | null => {
    try { const st = (globalThis as { localStorage?: Storage }).localStorage; if (!st) return null; st.getItem(prefsKey); return st; } catch { return null; }
  };
  const prefsWhere: Prefs['where'] = cfg?.prefs === true && post ? 'page' : !cfg && localStore() ? 'local' : 'memory';
  const prefsKeyOk = (k: unknown): k is string => typeof k === 'string' && k.length > 0 && k.length <= PREFS_LIMITS.key;
  function prefsAsk(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((done) => {
      const n = (prefsSeq += 1);
      const timer = setTimeout(() => { if (prefsAsks.delete(n)) done({ ok: false, why: 'no-answer' }); }, PREFS_WAIT_MS);
      prefsAsks.set(n, (m) => { clearTimeout(timer); done(m); });
      post?.({ what: 'prefs', n, ...msg });
    });
  }
  function prefsLoad(): Promise<void> {
    if (prefsReady) return prefsReady;
    const take = (all: unknown): void => {
      if (!all || typeof all !== 'object') return;
      // What this visit already set wins over what was read (a set that raced the first read).
      // A `null` on disk is what an earlier build kept for a NaN: it is nothing, not a setting.
      for (const [k, v] of Object.entries(all as Record<string, unknown>)) if (!prefsCache.has(k) && v !== null && v !== undefined) prefsCache.set(k, v);
    };
    if (prefsWhere === 'page') prefsReady = prefsAsk({ op: 'all' }).then((m) => { take(m['all']); prefsLoaded = true; });
    else {
      if (prefsWhere === 'local') { try { take(JSON.parse(localStore()?.getItem(prefsKey) ?? '{}')); } catch { /* nothing kept */ } }
      // With no page to ask, everything is read at once: a typed reader never meets "not arrived yet" here.
      prefsLoaded = true;
      prefsReady = Promise.resolve();
    }
    return prefsReady;
  }
  /** Whether the whole set still fits (16 KB, 32 keys): the page checks again; this keeps the three places alike. */
  function prefsFits(key: string, value: unknown): boolean {
    const next = Object.fromEntries(prefsCache);
    next[key] = value;
    let text: string;
    try { text = JSON.stringify(next); } catch { return false; }
    return typeof text === 'string' && text.length <= PREFS_LIMITS.bytes && Object.keys(next).length <= PREFS_LIMITS.keys;
  }
  /** Said once a visit, not once every ten seconds: a mistake in the game's code, for whoever is building it. */
  const saidOnce = new Set<string>();
  const sayOnce = (key: string, msg: string): void => { if (saidOnce.has(key)) return; saidOnce.add(key); console.warn('[netplay]', msg); };
  let prefsLoaded = false;
  const kindOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v === 'number' && !Number.isFinite(v) ? String(v) : `a ${typeof v}`);
  /** Why JSON cannot hold `v` as it is (it would be kept as `null`, or not at all), or null when it can. */
  function unkeepable(v: unknown, depth = 0, seen: Set<object> = new Set()): string | null {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? null : `${String(v)} (JSON keeps it as null)`;
    if (typeof v === 'undefined') return depth ? 'undefined inside it' : null;
    if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return `a ${typeof v}`;
    if (depth > 8) return 'nested too deep';
    const o = v as object;
    if (seen.has(o)) return 'a loop';
    seen.add(o);
    for (const x of Array.isArray(o) ? o : Object.values(o)) { const why = unkeepable(x, depth + 1, seen); if (why) return why; }
    seen.delete(o);
    return null;
  }
  /**
   * The kept value for a typed reader, or `undefined` for "use the fallback": nothing kept, a `null`, or the prefs
   * not read yet. Reading before they arrive is the mistake that made a volume silent, so it is said once, with the fix.
   */
  function prefsRaw(key: string, how: string, fallback: unknown): unknown {
    if (!prefsLoaded) {
      void prefsLoad();
      if (!prefsCache.has(key)) {
        sayOnce('prefs-early', `net.prefs.${how}('${key}') was read before the prefs had arrived, so it answered with its fallback (${JSON.stringify(fallback)}). Wait for them first: await net.prefs.ready`);
        return undefined;
      }
    }
    const v = prefsCache.get(key);
    return v === null ? undefined : v;
  }
  const wrongType = (key: string, how: string, v: unknown, fallback: unknown): void =>
    sayOnce(`prefs-type:${key}`, `net.prefs.${how}('${key}'): what is kept is ${kindOf(v)}, so it answered with its fallback (${JSON.stringify(fallback)})`);
  const prefs: Prefs = {
    // A kept `null` is never a value (set(key, null) removes): the fallback, not a null a game multiplies into silence.
    get: <T,>(key: string, fallback?: T): Promise<T> => prefsLoad().then(() => { const v = prefsCache.get(key); return (v === undefined || v === null ? fallback : v) as T; }),
    peek: <T,>(key: string, fallback?: T): T => { const v = prefsRaw(key, 'peek', fallback); return (v === undefined ? fallback : v) as T; },
    number(key: string, fallback: number, range: { min?: number; max?: number; integer?: boolean } = {}): number {
      if (typeof fallback !== 'number' || !Number.isFinite(fallback)) throw new TypeError(`net.prefs.number('${key}', fallback): the fallback must be a finite number, not ${kindOf(fallback)}`);
      const min = typeof range.min === 'number' && Number.isFinite(range.min) ? range.min : -Infinity;
      const max = typeof range.max === 'number' && Number.isFinite(range.max) ? range.max : Infinity;
      if (min > max) throw new TypeError(`net.prefs.number('${key}'): min (${min}) is above max (${max})`);
      const v = prefsRaw(key, 'number', fallback);
      let n = fallback;
      if (typeof v === 'number' && Number.isFinite(v)) n = v; else if (v !== undefined) wrongType(key, 'number', v, fallback);
      if (range.integer) n = Math.round(n);
      return Math.max(min, Math.min(max, n));
    },
    boolean(key: string, fallback: boolean): boolean {
      if (typeof fallback !== 'boolean') throw new TypeError(`net.prefs.boolean('${key}', fallback): the fallback must be true or false, not ${kindOf(fallback)}`);
      const v = prefsRaw(key, 'boolean', fallback);
      if (typeof v === 'boolean') return v;
      if (v !== undefined) wrongType(key, 'boolean', v, fallback);
      return fallback;
    },
    string<T extends string = string>(key: string, fallback: T, o: { oneOf?: readonly T[] } = {}): T {
      if (typeof fallback !== 'string') throw new TypeError(`net.prefs.string('${key}', fallback): the fallback must be a string, not ${kindOf(fallback)}`);
      if (o.oneOf && !o.oneOf.includes(fallback)) throw new TypeError(`net.prefs.string('${key}'): the fallback '${fallback}' is not one of ${JSON.stringify(o.oneOf)}`);
      const v = prefsRaw(key, 'string', fallback);
      if (typeof v === 'string' && (!o.oneOf || o.oneOf.includes(v as T))) return v as T;
      if (v !== undefined) sayOnce(`prefs-type:${key}`, typeof v === 'string' ? `net.prefs.string('${key}'): '${v.slice(0, 40)}' is not one of ${JSON.stringify(o.oneOf)}, so it answered with its fallback ('${fallback}')` : `net.prefs.string('${key}'): what is kept is ${kindOf(v)}, so it answered with its fallback ('${fallback}')`);
      return fallback;
    },
    all: () => prefsLoad().then(() => Object.fromEntries(prefsCache)),
    remove: (key: string) => prefs.set(key, null),
    async set(key: string, value: unknown): Promise<boolean> {
      if (!prefsKeyOk(key)) { sayOnce('prefs-key', `net.prefs.set: a key is 1 to ${PREFS_LIMITS.key} characters; ${JSON.stringify(String(key as unknown).slice(0, 24))} was not kept`); return false; }
      const del = value === null || value === undefined;
      // NaN, Infinity, a function, a loop: JSON would keep `null` (or nothing), and the next visit would read that as
      // a setting. Refused here, in words, instead of a volume that is silent from then on.
      const bad = del ? null : unkeepable(value);
      if (bad) { sayOnce(`prefs-value:${key}`, `net.prefs.set('${key}', …): the value is ${bad}, which cannot be kept, so nothing was changed. Keep a finite number, a string, a boolean or plain JSON`); return false; }
      await prefsLoad();
      if (!del && !prefsFits(key, value)) { warnOnce('prefs-size', `net.prefs: '${key}' was not kept (a game's prefs are ${PREFS_LIMITS.bytes / 1024} KB and ${PREFS_LIMITS.keys} keys in all)`); return false; }
      const had = prefsCache.has(key);
      const before = prefsCache.get(key);
      if (del) prefsCache.delete(key); else prefsCache.set(key, JSON.parse(JSON.stringify(value)));
      if (prefsWhere === 'page') {
        const m = await prefsAsk(del ? { op: 'del', k: key } : { op: 'set', k: key, v: value });
        // Refused by the page (over its cap): what was kept before stands.
        if (m['ok'] !== true && m['why'] !== 'no-answer') { if (had) prefsCache.set(key, before); else prefsCache.delete(key); return false; }
        return m['ok'] === true;
      }
      if (prefsWhere === 'local') { try { localStore()?.setItem(prefsKey, JSON.stringify(Object.fromEntries(prefsCache))); } catch { return false; } }
      return true;
    },
    get ready() { return prefsLoad(); },
    get loaded() { return prefsLoaded; },
    get where() { return prefsWhere; },
  };

  /* ------------------------------------------------------------ body control (host) */
  function ctlOf(s: number): { rs: number; own: boolean; taken: boolean; ack: number; giveAt: number } {
    let e = ctl.get(s);
    if (!e) { e = { rs: 1, own: defaultOwn, taken: false, ack: 0, giveAt: 0 }; ctl.set(s, e); }
    return e;
  }
  /** Give back: the body returns to the room's movement mode, and rs bumps so the owner restarts from here. */
  function giveBack(e: { rs: number; own: boolean; taken: boolean; giveAt: number }): void { e.taken = false; e.own = defaultOwn; e.giveAt = 0; e.rs += 1; }
  function sweepCtl(): void {
    const t = wall();
    for (const e of ctl.values()) if (e.taken && e.giveAt && t >= e.giveAt) giveBack(e);
  }
  function ctlWire(): ControlWire[] {
    sweepCtl();
    const here = new Set<number>();
    for (const p of peers.values()) if (p.seat !== null) here.add(p.seat);
    const out: ControlWire[] = [];
    for (const [s, e] of ctl) if (here.has(s)) out.push([s, e.rs, e.own ? 1 : 0, e.ack]);
    return out;
  }
  /** A new host rebuilds the table from the checkpoint, then the newer snapshot. A body taken mid-knockback is given back. */
  function adoptCtl(ckpt: Checkpoint<C> | null, snap: Snapshot<S> | null): void {
    ctl.clear();
    for (const src of [ckpt?.c, snap?.c]) {
      if (!Array.isArray(src)) continue;
      for (const [s, rs, own] of src) {
        // A body the old host had taken (mid-knockback) goes back to the room's mode, with a reset.
        const wasTaken = (own === 1) !== defaultOwn;
        ctl.set(s, { rs: wasTaken ? rs + 1 : rs, own: defaultOwn, taken: false, ack: 0, giveAt: 0 });
      }
    }
  }

  /* ------------------------------------------------------------ keyed state */
  function applyState(k: string, d: unknown): void {
    if (d === null || d === undefined) { if (!stateMap.has(k)) return; stateMap.delete(k); emit('state', { k, d: null }); return; }
    stateMap.set(k, d);
    emit('state', { k, d });
  }
  function replaceState(next: unknown): void {
    if (!next || typeof next !== 'object') return;
    const obj = next as Record<string, unknown>;
    for (const k of [...stateMap.keys()]) if (!(k in obj)) applyState(k, null);
    for (const [k, d] of Object.entries(obj)) if (JSON.stringify(stateMap.get(k)) !== JSON.stringify(d)) applyState(k, d);
  }
  function primeStateSent(): void {
    stateSent.clear();
    for (const [k, d] of stateMap) stateSent.set(k, JSON.stringify(d));
  }

  /* ------------------------------------------------------------ watching (section 16) */
  const canFollowNow = (): boolean => watching && policyFollow && relayFollow;
  /** The seated players, in seat order (never a watcher, never a waiting screen). */
  function seated(): Peer[] {
    return [...peers.values()].filter((p) => typeof p.seat === 'number' && !p.watch).sort((a, b) => (a.seat as number) - (b.seat as number));
  }
  const presentSeat = (s: number | null): boolean => s !== null && seated().some((p) => p.seat === s);
  /** The leader of the game's `scores` probe ([{ seat, score }]), among the seated players; null without one. */
  function leader(list: Peer[]): { seat: number; score: number } | null {
    const fn = probes['scores'];
    if (typeof fn !== 'function') return null;
    let rows: unknown;
    try { rows = (fn as () => unknown)(); } catch { return null; }
    if (!Array.isArray(rows)) return null;
    let best: { seat: number; score: number } | null = null;
    for (const r of rows as { seat?: unknown; score?: unknown }[]) {
      if (!r || typeof r.seat !== 'number' || !Number.isFinite(Number(r.score)) || !list.some((p) => p.seat === r.seat)) continue;
      if (!best || Number(r.score) > best.score) best = { seat: r.seat, score: Number(r.score) };
    }
    return best;
  }
  const scoreOf = (s: number): number => {
    const fn = probes['scores'];
    try { const r = typeof fn === 'function' ? ((fn as () => { seat?: number; score?: number }[])() ?? []).find((x) => x && x.seat === s) : null; return r ? Number(r.score) || 0 : 0; } catch { return 0; }
  };
  /**
   * AUTO: the newest spotlight on a present player (once the one shown has had AUTO_MIN_MS); with no action, every
   * AUTO_HOLD_MS the leader of the game's scores (ties keep who is shown); with no scores, the next player in seat order.
   */
  function pickAuto(): number | null {
    const list = seated();
    if (!list.length) return null;
    const has = (s: number): boolean => list.some((p) => p.seat === s);
    const t = wall();
    const cur = autoSeat !== null && has(autoSeat) ? autoSeat : null;
    const dwell = t - autoAt;
    let next: number | null = cur;
    if (spot.seat >= 0 && spot.at > autoAt && has(spot.seat) && spot.seat !== cur && (cur === null || dwell >= AUTO_MIN_MS)) next = spot.seat;
    else if (cur === null || dwell >= AUTO_HOLD_MS) {
      const lead = leader(list);
      if (lead) next = cur !== null && scoreOf(cur) >= lead.score ? cur : lead.seat;
      else if (cur === null) next = (list[0] as Peer).seat;
      else { const i = list.findIndex((p) => p.seat === cur); next = (list[(i + 1) % list.length] as Peer).seat; }
      if (next === cur) autoAt = t; // looked again, and stayed: the next look is a hold from now
    }
    if (next !== autoSeat) { autoSeat = next; autoAt = t; }
    // Action is waiting on the player shown: cut the moment their AUTO_MIN_MS is up, not on the next look.
    if (spot.seat >= 0 && spot.at > autoAt && spot.seat !== next && has(spot.seat) && !spotTimer && !closed) {
      spotTimer = setTimeout(() => { spotTimer = null; if (following === 'auto') resolveView('auto'); }, Math.max(0, AUTO_MIN_MS - (t - autoAt)) + 5);
    }
    return next;
  }
  /** Work out whose view to draw now, and tell the game (a `view` event) and the watch page when it changed. */
  function resolveView(why: ViewWhy): void {
    let next: number | null;
    if (!watching) next = offline ? null : seat;
    else if (!canFollowNow()) next = null;
    else if (following === null) next = null;
    else if (typeof following === 'number') {
      if (presentSeat(following)) next = following;
      else if (!roleKnown || !peers.size) next = null; // not in the room yet: the welcome says who is here
      else {
        // The followed player left: Auto takes over, and their view comes back if they do (a reload, a blip).
        wish = following; wishAt = wall(); following = 'auto'; why = 'left';
        autoSeat = null; next = pickAuto();
      }
    } else {
      if (wish !== null && presentSeat(wish) && wall() - wishAt < WISH_MS) { following = wish; wish = null; why = 'back'; next = following; }
      else { if (wish !== null && wall() - wishAt >= WISH_MS) wish = null; next = pickAuto(); }
    }
    if (!viewKnown || next !== viewNow) {
      const prev = viewNow;
      viewNow = next;
      const first = !viewKnown;
      viewKnown = true;
      emit('view', { seat: next, following: watching ? following : next, prev, why: first ? 'start' : why });
    }
    postView(why);
  }
  function postView(why: ViewWhy | string = 'start'): void {
    if (!post || !watching) return;
    const whyNot = !policyFollow ? 'overview' : !relayFollow ? (relayWhy ?? 'overview') : null;
    const msg = { what: 'view', seat: viewNow, following, follows, canFollow: canFollowNow(), whyNot, why };
    const sig = JSON.stringify([msg.seat, msg.following, msg.follows, msg.canFollow, msg.whyNot]);
    if (sig === lastViewPost) return;
    lastViewPost = sig;
    post(msg);
  }
  /** The game shows it draws a followed player: tell the watch page, so its strip lets the watcher choose. */
  function markFollows(): void {
    if (follows || !watching) return;
    follows = true;
    postView('start');
  }

  function setRole(next: Role, why: string, extra: Partial<RoleChange<S, C>> = {}): void {
    const prev = roleKnown ? role : null;
    const was = role;
    role = next;
    roleKnown = true;
    // Promoted = became host of a round that is already running somewhere: the relay handed over its
    // last checkpoint and/or snapshot, and the game must restore from them instead of starting fresh.
    const promoted = next === 'host' && (prev === null || was !== 'host') && Boolean(extra.ckpt || extra.snap);
    const demoted = prev === 'host' && next !== 'host';
    if (promoted) promotions += 1;
    const e: RoleChange<S, C> = {
      role: next, prev, why, promoted, demoted,
      ckpt: extra.ckpt ?? null, snap: extra.snap ?? null, round: extra.round ?? roundInfo, roster: extra.roster ?? slots,
      peers: [...peers.values()],
    };
    if (next === 'host') {
      inputs.clear(); presses.clear();
      if (was !== 'host' || prev === null) { adoptCtl(extra.ckpt ?? null, extra.snap ?? null); primeStateSent(); }
    } else {
      mine = { rs: 0, own: defaultOwn, ack: 0 };
      sentHist.length = 0;
    }
    post?.({ what: 'role', role: next, prev, why, seat });
    if (next === 'host') { capsSent = ''; sendCaps(); }
    if (rulesGame) { if (next === 'host') startRules(extra.ckpt?.d ?? null); else stopRules(); }
    resolveReady(e);
    emit('role', e);
    resolveView('seat');
    notifyStats(true);
    autoPlayable();
  }

  /** The newest snapshot this browser holds, if recent: a promoted host's restore when the relay has none. */
  function localSnap(): Snapshot<S> | null {
    const s = buf[buf.length - 1];
    return s && now() - s.st < 5000 ? s : null;
  }

  // ---------------------------------------------------------------- wire in
  function onMessage(data: unknown): void {
    lastMsgAt = wall();
    const text = typeof data === 'string' ? data : String(data);
    countBytes(bytesIn, text.length);
    let m: Record<string, unknown>;
    try { m = JSON.parse(text) as Record<string, unknown>; } catch { return; }
    if (!m || typeof m['t'] !== 'string') return;
    switch (m['t']) {
      case 'welcome': return onWelcome(m);
      case 'snap': return onSnap(m, text.length);
      case 'free': if (![...peers.values()].some((p) => p.seat === m.seat)) rulesFrame(m); return;
      case 'in': if (rulesFrame(m)) return; return onInput(m);
      case 'ev': {
        if (m.hosted !== true && rulesFrame(m)) return;
        const k = String(m['k'] ?? '');
        const from = typeof m['from'] === 'number' ? m['from'] : null;
        // Quiet AI (section 17): this browser does not hear an AI's speech, its own or relayed by the host (section 18:
        // a host relays an AI's line with `d.ai`).
        if (hushed && SPEECH_KIND.test(k) && ((from !== null && api.isAgent(from)) || (m['d'] && typeof m['d'] === 'object' && (m['d'] as { ai?: unknown }).ai === true))) return;
        emit('event', { k, d: m['d'], from, ...(typeof m['id'] === 'string' ? { id: m['id'] } : {}) });
        return;
      }
      case 'policy': {
        rulesFrame(m);
        if (m['policy'] && typeof m['policy'] === 'object') { policy = readPolicy(m['policy']); emit('policy', policy); post?.({ what: 'policy', policy }); }
        return;
      }
      case 'vote': {
        voteState = readVote(m);
        if (voteState) { emit('vote', voteState); post?.({ what: 'vote', vote: voteState }); }
        return;
      }
      case 'line':
      case 'react': {
        // Room chat (section 19): a line or a reaction, anyone's. One the sender wants over their character is a `say`.
        const line = readChatLine(m);
        if (!line) return;
        emit('chat', line);
        if (line.bubble && line.seat !== null && chatShown && line.kind !== 'studio') {
          emit('say', { id: line.id, seat: line.seat, name: line.name, text: line.kind === 'react' ? (line.glyph ?? '') : (line.text ?? ''), ...(line.glyph ? { glyph: line.glyph } : {}), kind: line.kind === 'react' ? 'react' : line.kind === 'line' ? 'line' : 'text' });
        }
        return;
      }
      case 'unline': {
        const ids = Array.isArray(m['ids']) ? (m['ids'] as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 64) : [];
        if (ids.length) emit('unchat', { ids });
        return;
      }
      case 'held':
      case 'slow': {
        emit('held', { why: String(m['why'] ?? (m['t'] === 'slow' ? 'slow' : 'held')), message: String(m['message'] ?? ''), ...(typeof m['until'] === 'number' ? { until: m['until'] } : {}) });
        return;
      }
      case 'state': if (typeof m['k'] === 'string') applyState(m['k'], m['d']); return;
      case 'probe': if (typeof m.n === 'string') raw({t:'probeAck',n:m.n}); return;
      case 'pong': return onPong(m);
      case 'announce': {
        if (typeof m['id'] !== 'string') return;
        const a: Announcement = { id: m['id'], text: typeof m['text'] === 'string' ? m['text'] : null, ...(typeof m['at'] === 'number' ? { at: m['at'] } : {}), ...(typeof m['until'] === 'number' ? { until: m['until'] } : {}), from: 'studio' };
        announcement = a.text ? a : null;
        emit('announce', a);
        return;
      }
      case 'mute': {
        const mute: Mute = { id: String(m['id'] ?? ''), seat: typeof m['seat'] === 'number' ? m['seat'] : null, until: Number(m['until']) || 0 };
        if (mute.seat !== null) { if (mute.until > now()) muted.set(mute.seat, mute.until); else muted.delete(mute.seat); }
        const p = peers.get(mute.id);
        if (p) peers.set(mute.id, { ...p, ...(mute.until > now() ? { muted: true } : { muted: undefined }) });
        emit('mute', mute);
        return;
      }
      case 'join': {
        rulesFrame(m);
        const p = m['peer'] as Peer | undefined;
        if (p && typeof p.id === 'string') { peers.set(p.id, p); if (role === 'host' && p.seat !== null) ctlOf(p.seat); emit('join', p); if (watching) resolveView('auto'); }
        return;
      }
      case 'leave': {
        rulesFrame(m);
        const pid = String(m['id'] ?? '');
        const p = peers.get(pid);
        peers.delete(pid);
        const s = typeof m['seat'] === 'number' ? m['seat'] : (p?.seat ?? null);
        if (s !== null) { inputs.delete(s); presses.delete(s); }
        emit('leave', { id: pid, seat: s, why: String(m['why'] ?? 'closed') });
        if (watching) resolveView('auto');
        return;
      }
      case 'round': {
        const incoming = m['round'] as RoundInfo;
        roundInfo = m.retime && roundInfo?.n === incoming.n ? { ...roundInfo, ...incoming } : incoming;
        if (m.retime) return;
        post?.({ what: 'round', round: roundInfo });
        emit('round', roundInfo);
        return;
      }
      case 'roster': {
        if (m['patch'] === true) {
          const next = new Map((slots ?? []).map(row => [row.slot, row]));
          for (const slot of (m['removed'] as number[] ?? [])) next.delete(slot);
          for (const row of (m['slots'] as Slot[] ?? [])) next.set(row.slot, row);
          slots = [...next.values()].sort((a, b) => a.slot - b.slot);
        } else slots = (m['slots'] as Slot[]) ?? null;
        post?.({ what: 'roster', slots });
        if (slots) emit('roster', slots);
        return;
      }
      case 'host': {
        // The relay kept this page as the host after its yield: what the rules made meanwhile goes out.
        if (m['why'] === 'host-kept') yieldAnswered();
        host = (m['host'] as HostRef | null) ?? null;
        if (m['why'] !== 'host-kept') rebase = true; // the next snapshot is on the new host's timeline
        for (const p of peers.values()) p.role = host && p.id === host.id ? 'host' : (p.seat === null ? 'screen' : 'replica');
        notifyStats(true);
        return;
      }
      case 'seat': {
        // A seat freed up and this spectator, who wanted to play, has it now.
        seat = typeof m['seat'] === 'number' ? m['seat'] : null;
        token = typeof m['token'] === 'string' ? m['token'] : token;
        name = typeof m['name'] === 'string' ? m['name'] : name;
        colour = typeof m['colour'] === 'number' ? m['colour'] : colour;
        if (id) { const p = peers.get(id); if (p) { p.seat = seat; p.name = name; p.colour = colour; } }
        post?.({ what: 'token', token, seat, room: cfg?.room ?? null });
        if (full) { full = false; post?.({ what: 'full', full: false }); paintLink(); }
        setRole(m['role'] === 'host' ? 'host' : 'replica', 'seated');
        return;
      }
      case 'role': {
        heldPeers = Array.isArray(m.held) ? m.held as Peer[] : [];
        const next = m['role'] as Role;
        host = (m['host'] as HostRef | null) ?? host;
        rebase = true;
        if (Array.isArray(m['peers'])) { peers.clear(); for (const p of m['peers'] as Peer[]) peers.set(p.id, p); }
        if (m['round']) roundInfo = m['round'] as RoundInfo;
        if (m['roster']) slots = m['roster'] as Slot[];
        if (m['state']) replaceState(m['state']);
        const ckpt = (m['ckpt'] as Checkpoint<C> | null) ?? (next === 'host' && !m['snap'] && onlineRulesSave ? { k: tick, st: now(), d: onlineRulesSave as C } : null);
        onlineRulesSave = null;
        let snap = (m['snap'] as Snapshot<S> | null) ?? null;
        if (next === 'host' && !snap) snap = localSnap();
        if (ckpt) lastCkpt = ckpt;
        setRole(next, String(m['why'] ?? 'relay'), { ckpt, snap, round: roundInfo, roster: slots });
        if (next === 'host') { lastSnapSentAt = -Infinity; if (snap) tick = Math.max(tick, snap.k); }
        return;
      }
      case 'stale': {
        // A newer build of the game is live (section 23): this tab keeps playing in its own room, and is told.
        noteStale(m['ver'], false, m['immediate'] === true);
        return;
      }
      case 'watch': {
        // The relay's word on following (section 16): a seat this browser took in another tab, or taken back.
        relayFollow = m['follow'] !== false;
        relayWhy = typeof m['why'] === 'string' ? m['why'] : null;
        resolveView('policy');
        return;
      }
      case 'decided': {
        if (rulesFrame(m)) return;
        const n = String(m['n'] ?? '');
        const w = deciding.get(n);
        if (!w) return;
        deciding.delete(n);
        clearTimeout(w.timer);
        const ms = Math.round(wall() - w.at);
        if (m['ok'] === true && m['picks'] && typeof m['picks'] === 'object') {
          const base = w.floor();
          const by = m['by'] === 'local' ? 'local' : 'ai';
          decideStats[by] += 1;
          decideStats.ms.push(ms); if (decideStats.ms.length > 40) decideStats.ms.shift();
          w.done({ by, picks: { ...base.picks, ...(m['picks'] as DecidePicks) }, p: (m['p'] as Decided['p']) ?? {}, ms });
          return;
        }
        const why = String(m['why'] ?? 'error');
        // Not opted in, no AI or out of budget: ask again only after a minute. Paced: at the room's next slot.
        if (why === 'off' || why === 'no-ai' || why === 'budget') decideOffUntil = wall() + 60_000;
        if (why === 'pace' && Number.isFinite(Number(m['retryMs']))) decideNextAt = wall() + Number(m['retryMs']);
        decideStats.floor += 1;
        w.done({ ...w.floor(), why, ms });
        return;
      }
      case 'error': {
        const code = String(m['code'] ?? '');
        if (code === 'room-over' && m['rematch'] === true) {
          closed = true; closedWhy = code;
          post?.({ what: 'rematch', room: cfg?.room ?? null });
          setLink('closed', code);
          return;
        }
        if (rulesGame && role === 'host' && m.view !== true && ['too-large', 'state-full'].includes(code)) {
          const message = `This game's rules exceeded the browser room size cap: ${m.message}. Join again for a fresh room.`;
          console.warn('[netplay]', message); endRules('size', message); return;
        }
        // Inputs over the relay's cap were dropped: send fewer for a while (the newest frame still goes out).
        if ((code === 'rate' && m['of'] === 'in') || code === 'flood') inSlowUntil = wall() + IN_SLOW_MS;
        // An AI alone in a room (nobody seated): it knocks again only after a while (section 17).
        if (code === 'agents-alone') aloneUntil = wall() + AGENTS_ALONE_WAIT_MS;
        if (code === 'host-fault') { rulesNotice(String(m.message)); return; }
        if (code === 'vote') { warnOnce('vote', m['message']); return; }
        if (code === 'rate' || code === 'state-full') { warnOnce(`${code}:${String(m['of'] ?? '')}`, m['message']); return; }
        // The room still runs another build of the game (section 23): not final. Its players were told to reload; this
        // browser keeps knocking and is let in when they have. Said once, not at every knock.
        if (code === 'room-stale') { post?.({ what: 'wait', final: false }); lastRefusal = code; warnOnce('room-stale', m['message']); if (link === 'alone') paintLink(); return; }
        console.warn('[netplay] relay refused:', code, m['message']);
        // The same seat opened in another tab, a full room, a version the relay does not speak: reconnecting
        // would repeat the refusal (or, for 'replaced', make the two tabs evict each other for ever).
        if (FINAL_ERRORS.has(code)) {
          closed = true;
          closedWhy = code;
          post?.({ what: 'closed', why: code, room: cfg?.room ?? null, ...(typeof m['until'] === 'number' ? { until: m['until'] } : {}), ...(typeof m['message'] === 'string' ? { message: String(m['message']).slice(0, 200) } : {}) });
          // Kept out of a room for running an older build (section 23): the page reloads the game; the game may too.
          if (code === 'stale') noteStale(m['ver'], true, m['immediate'] === true);
          if (rulesGame) { stopRules(); setRole('replica', code); if (typeof m['message'] === 'string' && !(code === 'room-over' && gameLine?.includes('cap:'))) api.line(m['message']); if (inApp && code === 'stale' && canOffline) goOfflineHost('stale'); }
          setLink('closed', code);
        }
        return;
      }
      default: return;
    }
  }
  const warned = new Map<string, number>();
  function warnOnce(key: string, msg: unknown): void {
    const t = wall();
    if (t - (warned.get(key) ?? -Infinity) < 10_000) return;
    warned.set(key, t);
    console.warn('[netplay]', msg);
  }

  function onWelcome(m: Record<string, unknown>): void {
    post?.({ what: 'build', ver: version });
    clearTimeout(connectTimer);
    const next = m['role'] as Role;
    const wasOffline = offline;
    // Reconnected (a network blip, or a relay restart) and still the host: my rules state is the live one.
    const continuing = roleKnown && role === 'host' && next === 'host' && !wasOffline;
    // Who this host had in its room before its socket went: what it missed is worked out below.
    const had = continuing ? [...peers.values()] : [];
    const hadSeat = seat;
    const offered = token;
    id = String(m['id']);
    seat = typeof m['seat'] === 'number' ? m['seat'] : null;
    token = typeof m['token'] === 'string' ? m['token'] : token;
    // The relay gave back the seat my token named: I am the player who was here, not a new one in that seat number.
    resumed = seat !== null && typeof offered === 'string' && offered !== '' && offered === token;
    name = typeof m['name'] === 'string' ? m['name'] : name;
    colour = typeof m['colour'] === 'number' ? m['colour'] : colour;
    host = (m['host'] as HostRef | null) ?? null;
    heldPeers = Array.isArray(m.held) ? m.held as Peer[] : [];
    peers.clear();
    if (Array.isArray(m['peers'])) for (const p of m['peers'] as Peer[]) peers.set(p.id, p);
    if (typeof m['st'] === 'number' && rtt === null) offset = (m['st'] as number) - Date.now();
    if (watching) {
      // A relay from before revision 5 says nothing: following is the page's to allow.
      const w = m['watch'] as { follow?: boolean; why?: string } | undefined;
      relayFollow = !w || w.follow !== false;
      relayWhy = w && typeof w.why === 'string' ? w.why : null;
    }
    // Revision 6: the room's policy and an open vote (an older relay says neither: open, Fair).
    if (m['policy'] && typeof m['policy'] === 'object') { policy = readPolicy(m['policy']); queueMicrotask(() => { emit('policy', policy); post?.({ what: 'policy', policy }); }); }
    if (m['vote'] && typeof m['vote'] === 'object') voteState = readVote(m['vote'] as Record<string, unknown>);
    const ckpt = (m['ckpt'] as Checkpoint<C> | null) ?? (next === 'host' && !m['snap'] && onlineRulesSave ? { k: tick, st: now(), d: onlineRulesSave as C } : null);
    onlineRulesSave = null;
    let snap = (m['snap'] as Snapshot<S> | null) ?? null;
    const a = m['announce'] as Announcement | undefined;
    if (a && typeof a === 'object' && typeof a.id === 'string' && typeof a.text === 'string' && (!announcement || announcement.id !== a.id)) { announcement = { ...a, from: 'studio' }; queueMicrotask(() => emit('announce', announcement as Announcement)); }
    if (!continuing) {
      roundInfo = (m['round'] as RoundInfo | null) ?? roundInfo;
      slots = (m['roster'] as Slot[] | null) ?? slots;
      replaceState(m['state']);
    }
    rebase = true;
    // The relay's last snapshot comes with the welcome: the room's state is in (the arrival, section 21).
    if (snap && next !== 'host' && acceptSnap(snap, JSON.stringify(snap).length, false)) snapSeen = true;
    if (next === 'host' && !snap && !continuing) snap = localSnap();
    if (wasOffline && rulesGame) rulesNotice('Connection restored. Joining the online round.');
    offline = false;
    connected = true;
    downSince = 0;
    attempt = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    lastRefusal = '';
    // Asked to play and every seat is taken: in the room with no seat, and seated when one frees up (a `seat` frame).
    const nowFull = m['full'] === true && seat === null && !watching;
    if (nowFull !== full) { full = nowFull; post?.({ what: 'full', full }); }
    emit('status', true);
    post?.({ what: 'token', token, seat, room: cfg?.room ?? null });
    // First welcome, a reconnect, or coming back from an offline fallback: only a CHANGE is a role event,
    // except the very first, which always is (the game waits on it).
    if (!roleKnown || next !== role || wasOffline) {
      setRole(next, wasOffline && roleKnown ? 'reconnected' : String(m['why'] ?? 'welcome'), { ckpt, snap, round: roundInfo, roster: slots });
      if (next === 'host' && snap) tick = Math.max(tick, snap.k);
    }
    // A reconnect to the same role emits no role event, but its welcome is a new
    // connection's keyframe. Rules views must adopt it before the first delta.
    if (rulesGame && snap && next !== 'host') emit('snapshot', snap);
    if (continuing) { rulesHost?.sync(rulesPeers()); reannounce(); catchUp(had, hadSeat); }
    if (link === 'online') paintLink(); else setLink('online', 'welcome');
    // A build older than the live one, let in to its own room (section 23).
    if (m['stale'] && typeof m['stale'] === 'object') noteStale((m['stale'] as { ver?: unknown }).ver, false);
    resolveView('seat');
    ping(); setTimeout(ping, 120); setTimeout(ping, 260);
  }

  /**
   * A host that reconnected and is still the host hears no `role` (nothing changed for it), and the relay never told
   * it who came or went while its socket was down: the welcome only replaced the peer list. Without this, a player
   * who joined meanwhile had no body for the rest of the visit (no `join` ever reached the host's roster), and one
   * who left kept a frozen one. So the difference is said as the `leave` and `join` events it would have been:
   * by seat (a socket id changes on every reconnect), and a seat whose number changed hands (`occ`) is both.
   */
  function catchUp(had: Peer[], hadSeat: number | null): void {
    const seatedOf = (list: Iterable<Peer>): Map<number, Peer> => {
      const out = new Map<number, Peer>();
      for (const p of list) if (typeof p.seat === 'number' && p.seat !== seat && p.seat !== hadSeat) out.set(p.seat, p);
      return out;
    };
    const before = seatedOf(had);
    const after = seatedOf(peers.values());
    const swapped = (a: Peer, b: Peer): boolean => typeof a.occ === 'number' && typeof b.occ === 'number' && a.occ !== b.occ;
    for (const [s, old] of before) {
      const cur = after.get(s);
      if (cur && !swapped(old, cur)) continue;
      inputs.delete(s); presses.delete(s);
      emit('leave', { id: old.id, seat: s, why: 'gone' });
    }
    for (const [s, cur] of after) {
      const old = before.get(s);
      if (old && !swapped(old, cur)) continue;
      ctlOf(s);
      emit('join', cur);
    }
    if (watching) resolveView('auto');
  }

  /** A host that reconnected (the relay may have restarted): hand the relay the round, roster, state and a checkpoint. */
  function reannounce(): void {
    // A rules host's are its runtime's output, by the one way out every other frame of the rules takes.
    if (rulesGame) { rulesHost?.announce(); sendCheckpoint(); return; }
    if (roundInfo) raw({ t: 'round', round: roundInfo });
    if (slots) raw({ t: 'roster', slots });
    for (const [k, d] of stateMap) raw({ t: 'state', k, d });
    primeStateSent();
    sendCheckpoint();
  }

  /** Buffer a snapshot. `live`: it came off the wire just now (its age is a transit sample). */
  function acceptSnap(s: Snapshot<S>, bytes: number, live: boolean, local = false): boolean {
    const t = now();
    // A snapshot stamped far in the future would hold the buffer for good (the relay clamps st too).
    if (!Number.isFinite(s.st) || (!local && s.st > t + 1000)) { rejectedSnaps += 1; return false; }
    if (rebase) {
      // New host, new timeline: its clock may sit a little behind the old one's. Keep older frames to hold on.
      while (buf.length && (buf[buf.length - 1] as Snapshot<S>).st >= s.st) buf.pop();
      rebase = false;
      lastArrival = 0;
    }
    if (rulesGame && buf.length && buf[buf.length - 1].e !== s.e) { buf.length = 0; ages.length = 0; lastArrival = 0; }
    const newest = buf[buf.length - 1];
    if (newest && s.st <= newest.st) return false;
    const arrival = wall();
    if (live) {
      const gap = lastArrival ? arrival - lastArrival : Infinity;
      if (lastArrival) {
        const stGap = s.st - lastArrivalSt;
        if (stGap > 0 && stGap < 1000) iv = iv * 0.9 + stGap * 0.1;
      }
      lastArrival = arrival;
      lastArrivalSt = s.st;
      // A snapshot handled in the same burst as the one before it waited behind this page's own stall (a GC, a
      // long frame), not on the network: its age says nothing about transit, and the page was not drawing anyway.
      if (gap >= iv * 0.25) {
        ages.push(t - s.st);
        if (ages.length > 40) ages.shift();
        const sorted = [...ages].sort((x, y) => x - y);
        ageP90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] as number;
        // The 95th percentile and 1.4 intervals, not the 90th and 1.2. A phone host's frame
        // quantisation (snapshots at 50/67 ms) plus 30-50 ms relay jitter held the picture on 5-8 % of a desktop
        // replica's frames in the contract e2e (interpolation-not-starved); this buys ~20 ms of delay for it.
        const ageP95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] as number;
        // Render far enough back that the next snapshot is normally here before we need it: its age, plus one
        // interval. Rise up to 6 ms a snapshot (a hold is visible); fall 6% of the excess a snapshot, at least 3 ms
        // (boot-time jank clears in about a second, as a brief time-warp nobody sees).
        const target = Math.max(50, Math.min(400, ageP95 + iv * 1.4 + 6));
        if (!delaySmooth || ages.length <= 3) delaySmooth = target;
        else if (target > delaySmooth) delaySmooth += Math.min(6, target - delaySmooth);
        else delaySmooth -= Math.min(delaySmooth - target, Math.max(3, (delaySmooth - target) * 0.06));
      }
    }
    lastSnapBytes = bytes;
    maxSnapBytes = Math.max(maxSnapBytes, bytes);
    buf.push(s);
    lastSnapInfo = { k: s.k, st: s.st, from: s.from ?? null, at: Date.now() };
    const cutoff = s.st - 1500;
    while (buf.length > 2 && (buf[0] as Snapshot<S>).st < cutoff) buf.shift();
    if (buf.length > 64) buf.splice(0, buf.length - 64);
    if (live) snapIn.hit(arrival);
    controlFrom(s);
    return true;
  }

  /** Seated replica: read my entry of the control table in the newest snapshot. */
  function controlFrom(s: Snapshot<S>): void {
    // A rules game's rows are [seat, r, ack, lead], read by the view library from the snapshot itself.
    if (seat === null || role === 'host' || rulesGame || !Array.isArray(s.c)) return;
    const e = s.c.find((x) => x[0] === seat);
    if (!e) return;
    const [, rs, own, ack] = e;
    const reset = rs !== mine.rs;
    const ownB = own === 1;
    const changed = reset || ownB !== mine.own;
    mine = { rs, own: ownB, ack };
    if (reset) sentHist.length = 0;
    else while (sentHist.length && (sentHist[0] as { q: number }).q <= ack) sentHist.shift();
    if (changed) emit('control', { seat, rs, own: ownB, ack, reset, snap: s });
  }

  function onSnap(m: Record<string, unknown>, bytes: number, local = false): void {
    if (role === 'host' && !local) return; // a stale frame from a previous host
    const s: Snapshot<S> = { k: Number(m['k']) || 0, st: Number(m['st']), d: m['d'] as S, from: typeof m['from'] === 'number' ? m['from'] : null };
    if (Array.isArray(m['c'])) s.c = m['c'] as ControlWire[];
    if (m['hb'] === 1) s.hb = 1;
    if (typeof m['e'] === 'number') s.e = m['e'];
    if (acceptSnap(s, bytes, true, local)) { emit('snapshot', s); if (!snapSeen) { snapSeen = true; autoPlayable(); } }
  }

  function onInput(m: Record<string, unknown>): void {
    if (role !== 'host') return;
    const from = m['from'];
    if (typeof from !== 'number') return;
    const p: Record<string, number> = {};
    if (m['p'] && typeof m['p'] === 'object') {
      for (const [k, v] of Object.entries(m['p'] as Record<string, unknown>)) p[k] = Math.max(0, Math.min(8, Math.floor(Number(v) || 0)));
    }
    const f: InputFrame<A> = {
      q: Number(m['q']) || 0, a: m['a'] as A,
      h: Array.isArray(m['h']) ? (m['h'] as unknown[]).map(String) : [],
      p, from, r: typeof m['r'] === 'number' ? m['r'] : null,
    };
    const prev = inputs.get(from);
    if (prev && f.q <= prev.q && f.q > 0) return; // out of order
    inputs.set(from, f);
    ctlOf(from).ack = f.q;
    const acc = presses.get(from) ?? {};
    for (const [k, v] of Object.entries(f.p)) acc[k] = Math.min(64, (acc[k] ?? 0) + v);
    presses.set(from, acc);
    inputIn.hit(wall());
    emit('input', f);
  }

  function onPong(m: Record<string, unknown>): void {
    const c = Number(m['c']);
    const st = Number(m['st']);
    const sent = pingsOut.get(c);
    if (sent === undefined || !Number.isFinite(st)) return;
    pingsOut.delete(c);
    const recv = Date.now();
    const r = recv - sent;
    const off = st + r / 2 - recv;
    samples.push({ rtt: r, off });
    if (samples.length > 8) samples.shift();
    const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    rtt = r;
    // Slew small corrections, jump big ones: a clock that jumps backwards makes interpolation stutter.
    const d = best.off - offset;
    offset = Math.abs(d) > 100 || samples.length <= 3 ? best.off : offset + Math.max(-5, Math.min(5, d));
    notifyStats(false);
  }

  // ---------------------------------------------------------------- wire out
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let paceTimer: ReturnType<typeof setInterval> | null = null;
  let readySpeed = 0;
  let ckptTimer: ReturnType<typeof setInterval> | null = null;
  let statsTimer: ReturnType<typeof setInterval> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let hbTimer: ReturnType<typeof setInterval> | null = null;
  /** `reconnecting` is bounded (`reconnectMaxMs`): when this fires and the room is still not back, the page plays alone. */
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** When `ping()` last ran: one that runs seconds late (the page was blocked) says nothing about the socket. */
  let lastPingTick = 0;
  /** `connectClock: 'game'`: the wait for the welcome is not counted until the game says it has booted. */
  let clockRunning = opts.connectClock !== 'game';
  let lastStatsPost = 0;
  /** The last snapshot's state as text, and when the GAME last sent one (a heartbeat is not the game's). */
  let lastSnapData: string | null = null;
  let lastRealSnapAt = -Infinity;
  /** A snapshot's time stamp is always later than the one before it: a replica drops one that is not, and a real
   *  snapshot sent in the same millisecond as a heartbeat must not be the one dropped. */
  let lastSnapSt = 0;
  const snapStamp = (): number => (lastSnapSt = Math.max(now(), lastSnapSt + 1));

  /**
   * A host's heartbeat (section 22). The relay replaces a host that sent no snapshot for its stall time, which is
   * right for a frozen tab and wrong for a game whose frames hitched for a second (a level loading, shaders
   * compiling, a throttled window): the room changed hands again and again. So when the game has sent nothing for
   * `heartbeatMs`, this timer sends its last state again with a fresh time stamp, marked `hb`. Replicas hold the
   * picture, which is what the host is showing too. Only for HEARTBEAT_MAX_MS: after that the game is taken to be
   * frozen, the heartbeat stops, and the relay hands the room on as before.
   */
  function heartbeat(): void {
    if (role !== 'host' || offline || !connected || closed || peers.size < 2 || lastSnapData === null || hidden()) return;
    const t = wall();
    if (t - lastSnapSentAt < heartbeatMs || t - lastRealSnapAt > HEARTBEAT_MAX_MS) return;
    if (!ws || ws.readyState !== 1 || (ws.bufferedAmount ?? 0) > 3 * 1024) return;
    const c = ctlWire();
    const text = `{"t":"snap","k":${tick},"st":${snapStamp()},"d":${lastSnapData}${c.length ? `,"c":${JSON.stringify(c)}` : ''},"hb":1}`;
    try { ws.send(text); } catch { return; }
    countBytes(bytesOut, text.length);
    lastSnapSentAt = t;
    heartbeats += 1;
  }

  function hidden(): boolean { try { return Boolean(g.document?.hidden); } catch { return false; } }
  function ping(): void {
    // This runs every two seconds at least. A gap of more than three and a half means the page itself was held.
    const beat = wall();
    const pingHeld = beat - lastPingTick > 2000 + 1500;
    lastPingTick = beat;
    if (!connected) {
      if (rulesGame && offline && rulesHost && ws && wall() - socketStartedAt >= 2500) { lost(ws, 'connect-timeout'); return; }
      // A socket that opened and was never welcomed (a room that is not answering) is as dead as a silent one: drop
      // it and knock again, so a page that gave up and plays alone still finds its room when the room is back.
      if (ws && ws.readyState === 1 && lastMsgAt && wall() - lastMsgAt > Math.max(staleMs, connectOpenMaxMs)) lost(ws, 'stale');
      return;
    }
    // A socket that delivered nothing (not even a pong) for staleMs is half-open: drop it and reconnect. But not on
    // the word of a timer that itself ran seconds late: the page was blocked (a heavy boot, shaders compiling) and
    // could not have heard anything, and what the relay sent meanwhile is still queued behind this very timer.
    // Dropping a healthy socket there turned every long hitch into a reconnect.
    if (ws && lastMsgAt && wall() - lastMsgAt > staleMs) {
      if (!pingHeld) { lost(ws, 'stale'); return; }
      // Two and a half seconds to be heard from (a pong answers the ping below): a socket that is really dead is
      // still dropped, two beats from now.
      lastMsgAt = wall() - staleMs + 2500;
    }
    const c = Date.now();
    pingsOut.set(c, c);
    if (pingsOut.size > 16) { const first = pingsOut.keys().next().value; if (first !== undefined) pingsOut.delete(first); }
    // A hidden host's yield is behind its checkpoint in the sender: the relay hears of the hidden tab after both.
    raw({ t: 'ping', c, hid: hidden() && !rulesSender?.handing, ...(rulesGame ? { readySpeed } : {}) });
  }

  function sendCheckpoint(): void {
    if (role !== 'host' || (!opts.checkpoint && !rulesHost) || offline || !connected) return;
    let d: C;
    try { d = (rulesHost ? rulesHost.save() : opts.checkpoint!()) as C; } catch (err) { console.warn('[netplay] checkpoint()', err); return; }
    const c: Checkpoint<C> = { k: rulesHost?.tick ?? tick, st: now(), d, c: ctlWire() };
    lastCkpt = c;
    const frame = { t: 'ckpt', k: c.k, st: c.st, d: c.d, c: c.c };
    if (rulesHost) rulesSender?.push(frame); else raw(frame);
  }

  /** How long until one more input frame fits the rolling-second cap (0: now). */
  function inputBudgetWait(): number {
    const t = wall();
    while (inSent.length && (inSent[0] as number) <= t - 1000) inSent.shift();
    const cap = t < inSlowUntil ? IN_SLOW_CAP_PER_S : IN_CAP_PER_S;
    if (inSent.length < cap) return 0;
    return Math.max(1, (inSent[inSent.length - cap] as number) + 1000 - t);
  }

  function flushInput(): void {
    inputTimer = null;
    if (role === 'host' || seat === null || offline || !connected || pendingA === undefined) return;
    // Never a burst: over the cap, or with the last frames still unsent on the socket, the newest frame waits
    // (it replaces whatever was pending, so nothing stale is ever flushed after a stall).
    const budget = inputBudgetWait();
    const backlog = (ws?.bufferedAmount ?? 0) > IN_BACKLOG_BYTES;
    if (budget > 0 || backlog) { inputTimer = setTimeout(flushInput, backlog ? Math.max(budget, 30) : budget); return; }
    // Standing still: the host has this exact frame already. Say it again only as a keepalive.
    const pressed = Object.keys(pendingPresses).length > 0;
    let sig = '';
    try { sig = JSON.stringify([pendingA, pendingHeld, mine.rs]); } catch { sig = ''; }
    if (!pressed && sig && sig === lastInputSig && wall() - lastInputSentAt < IDLE_INPUT_MS) { idleSkipped += 1; return; }
    inSent.push(wall());
    inSeq += 1;
    const msg: Record<string, unknown> = { t: 'in', q: inSeq, a: pendingA, h: pendingHeld, r: mine.rs };
    if (Object.keys(pendingPresses).length) msg['p'] = pendingPresses;
    if (raw(msg)) {
      inputOut.hit(wall()); pendingPresses = {}; lastInputSig = sig;
      sentHist.push({ q: inSeq, a: pendingA, h: pendingHeld, at: wall(), r: mine.rs });
      if (sentHist.length > 64) sentHist.shift();
    }
    lastInputSentAt = wall();
  }

  function scheduleInput(urgent: boolean): void {
    const since = wall() - lastInputSentAt;
    const wait = Math.max(inputBudgetWait(), urgent ? Math.max(0, 16 - since) : Math.max(0, inputMs - since));
    if (wait <= 0) { if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; } flushInput(); return; }
    if (inputTimer) return;
    inputTimer = setTimeout(flushInput, wait);
  }

  function statsNow(): NetStats {
    const t = wall();
    return {
      role, seat, host, connected, offline, rtt, offset: Math.round(offset),
      snapHzIn: snapIn.hz(t), snapHzOut: snapOut.hz(t), inputHzIn: inputIn.hz(t), inputHzOut: inputOut.hz(t), idleInputsSkipped: idleSkipped,
      lastSnapBytes, maxSnapBytes, bytesInPerS: perSecond(bytesIn), bytesOutPerS: perSecond(bytesOut),
      interpDelay: Math.round(interpDelay()), snapAgeP90: Math.round(ageP90), starvedPct: +starvedPct.toFixed(3), rejectedSnaps,
      owned: api.owned, pending: sentHist.length, stateKeys: stateMap.size,
      peers: peers.size, reconnects, drops, link, heartbeats, promotions, round: roundInfo ? roundInfo.n : null,
      decides: { asked: decideStats.asked, ai: decideStats.ai, local: decideStats.local, floor: decideStats.floor, msP50: [...decideStats.ms].sort((x, y) => x - y)[Math.floor(decideStats.ms.length / 2)] ?? null },
    };
  }
  function notifyStats(force: boolean): void {
    if (!post) return;
    const t = wall();
    if (!force && t - lastStatsPost < 450) return;
    lastStatsPost = t;
    post({ what: 'stats', stats: statsNow(), name, colour });
  }

  function interpDelay(): number {
    if (opts.interpDelayMs !== undefined) return opts.interpDelayMs;
    return Math.max(opts.interpFloorMs ?? 0, delaySmooth || Math.max(50, iv * 1.6 + 8));
  }

  // ---------------------------------------------------------------- connect
  function goOfflineHost(why: string): void {
    const kept = rulesHost?.save() ?? null;
    if (!offline && kept && peers.size <= 1) onlineRulesSave = kept;
    offline = true;
    connected = false;
    seat = rulesGame && canOffline && want === 'play' ? (seat ?? 0) : null;
    if (full) { full = false; post?.({ what: 'full', full: false }); }
    aloneWhy = why;
    // A page that gives up on a room it WAS in says so as a role event even when it was that room's host: its seat is
    // gone with the room, and the game seats itself again for a round of its own.
    if (!roleKnown || role !== 'host' || (rulesGame && !rulesHost) || why === 'reconnect-timeout') setRole(canOffline ? 'host' : 'replica', why, rulesGame && kept ? { ckpt: { k: tick, st: now(), d: kept as C } } : {});
    // No shell at all is `offline` from the start; a room that never answered is `alone` (and still knocked at). A
    // page the relay refused for good stays `closed` (nothing is knocking): it plays by itself and its line says why.
    if (closed) paintLink();
    else if (why !== 'offline') setLink('alone', why);
    else paintLink();
  }

  function lost(sock: WebSocketLike, why: string): void {
    if (ws !== sock) return;
    ws = null;
    sock.onclose = null; sock.onmessage = null; sock.onerror = null; sock.onopen = null;
    if (why !== 'closed') { try { sock.close(4000, why); } catch { /* gone */ } }
    const was = connected;
    connected = false;
    if (was) { downSince = wall(); drops += 1; }
    if (was) emit('status', false);
    // It was in its room and the socket went: it knocks again with its token. (Never welcomed yet: still `connecting`,
    // or `alone` once it gave up waiting; stopped for good: `closed`.)
    if (was && !closed) {
      setLink('reconnecting', why === 'stale' ? 'stale' : 'lost');
      // BOUNDED (section 22): a room that does not come back in reconnectMaxMs is not waited for with a frozen round
      // on screen. The page plays alone with its own bots, says so, and keeps knocking.
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { reconnectTimer = null; if (link === 'reconnecting' && !closed) goOfflineHost('reconnect-timeout'); }, reconnectMaxMs);
    }
    notifyStats(true);
    retry();
  }

  function open(): void {
    if (closed || !cfg || !WS || ws) return;
    let sock: WebSocketLike;
    try { sock = new WS(cfg.url); } catch { retry(); return; }
    ws = sock; socketStartedAt = wall();
    sock.onopen = () => {
      lastMsgAt = wall();
      raw({
        t: 'hello', rules: rulesGame, v: NETPLAY_VERSION, rev: NETPLAY_REVISION, token, name: name || undefined, device, want, canHost: asAgent && asAgent.hands === 'host' ? false : canHost, game: opts.game, max: opts.maxPlayers,
        ...(watching ? { watch: true } : {}), ...(caps.size ? { caps: [...caps] } : {}), ...(asAgent ? { agent: asAgent } : {}),
        // Revision 9 (an older relay ignores both): the game's revision and what this build can do.
        ...(version ? { ver: version } : {}), ...(features.length ? { feat: features } : {}),
      });
    };
    sock.onmessage = (ev) => onMessage(ev.data);
    sock.onclose = () => lost(sock, 'closed');
    // Browsers follow an error with close; Node's WebSocket, on a refused connection, never does.
    sock.onerror = () => lost(sock, 'error');
  }
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  function retry(): void {
    if (closed) return;
    // A hidden tab does not play and its timers crawl: reconnect when it is looked at again.
    if (hidden()) { waitingVisible = true; return; }
    const wait = Math.max(rulesGame ? (attempt < 3 ? Math.random() * Math.min(2000, 500 * 2 ** attempt) : (0.5 + Math.random() * 0.5) * Math.min(60_000, 2000 * 2 ** Math.min(attempt - 2, 5))) : LADDER[Math.min(attempt, LADDER.length - 1)] as number, aloneUntil - wall());
    attempt += 1;
    reconnects += 1;
    retryTimer = setTimeout(open, rulesGame && offline && rulesHost ? Math.min(wait, 2500) : wait);
  }

  if (offline) {
    // No shell (a plain file, a dev server): the game is its own host, offline.
    queueMicrotask(() => goOfflineHost('offline'));
  } else {
    post?.({ what: 'attached', v: NETPLAY_VERSION, rev: NETPLAY_REVISION, mark: NETPLAY_MARK, arrival });
    open();
    // A relay that never answers must not leave a game on a black screen. But the wait is counted only while
    // this page is able to listen: a phone compiling shaders under load is blocked for seconds at a time, and
    // neither its socket's open nor the relay's welcome can be handled meanwhile. Giving up on the wall clock
    // started a private fight 1 at every loaded boot and swapped it for the room's a moment later. A socket
    // that is connecting or open gets CONNECT_OPEN_MAX_MS of that listening time; one that failed outright
    // (ws is null between retries) gets connectTimeoutMs.
    // `connectOpenMaxMs` sizes that wait; with `connectClock: 'game'` it starts only at `net.start()`, once the game
    // has finished booting (or CONNECT_CLOCK_MAX_MS after the helper was made: a game that never says still gets a role).
    let listenedMs = 0;
    let lastCheckAt = wall();
    const bornAt = wall();
    const connectCheck = (): void => {
      if (roleKnown) return;
      const t = wall();
      if (!clockRunning && t - bornAt >= CONNECT_CLOCK_MAX_MS) clockRunning = true;
      if (clockRunning) listenedMs += Math.min(t - lastCheckAt, 600);
      lastCheckAt = t;
      const live = Boolean(ws && (ws.readyState === 0 || ws.readyState === 1));
      if (listenedMs < (live ? connectOpenMaxMs : connectTimeoutMs)) { connectTimer = setTimeout(connectCheck, 250); return; }
      goOfflineHost('relay-timeout');
    };
    connectTimer = setTimeout(connectCheck, 250);
    if (heartbeatMs) hbTimer = setInterval(heartbeat, 250);
    lastPingTick = wall();
    pingTimer = setInterval(ping, 2000);
    if (rulesGame) {
      let at = wall(); const samples: number[] = [];
      paceTimer = setInterval(() => {
        const next = wall(); samples.push(Math.min(1, 100 / Math.max(100, next - at))); at = next;
        if (samples.length > 20) samples.shift();
        readySpeed = samples.reduce((a, b) => a + b, 0) / samples.length;
      }, 100);
    }
    ckptTimer = setInterval(sendCheckpoint, checkpointMs);
    statsTimer = setInterval(() => notifyStats(true), 500);
  }
  try {
    g.document?.addEventListener('visibilitychange', () => {
      if (disposed) return;
      if (hidden()) rulesHost?.pause(); else rulesHost?.resume();
      if (!hidden() && waitingVisible) { waitingVisible = false; attempt = 0; open(); return; }
      if (!connected) return;
      if (hidden()) {
        // A hidden phone tab loses its timers and rAF: hand the round on before it stalls.
        if (role === 'host' && peers.size > 1) yieldHost();
        ping();
      } else ping();
    });
    g.addEventListener?.('online', () => { if (!closed && !connected && rulesGame) { if (ws) lost(ws, 'online'); if (retryTimer !== null) clearTimeout(retryTimer); retryTimer = null; attempt = 0; open(); } });
    g.addEventListener?.('pagehide', () => { if (role === 'host') { sendCheckpoint(); rulesSender?.leave(); } raw({ t: 'bye' }); });
  } catch { /* not a browser */ }

  // ---------------------------------------------------------------- watching
  let watchTimer: ReturnType<typeof setInterval> | null = null;
  if (watching && !offline) {
    // Auto looks again twice a second; the watch page gets live scores from the game's `scores` probe.
    let lastScores = 0;
    watchTimer = setInterval(() => {
      if (closed) return;
      if (following === 'auto' || wish !== null) resolveView('auto');
      const fn = probes['scores'];
      const t = wall();
      if (post && typeof fn === 'function' && t - lastScores >= SCORES_MS) {
        lastScores = t;
        try {
          const rows = ((fn as () => { seat?: unknown; score?: unknown }[])() ?? []).filter((r) => r && typeof r.seat === 'number' && Number.isFinite(Number(r.score)));
          post({ what: 'scores', scores: rows.map((r) => ({ seat: r.seat, score: Number(r.score) })) });
        } catch { /* a probe that throws reports nothing */ }
      }
    }, 500);
    try {
      // The watch page's strip and keys: { t: 'homie-watch', follow: seat | 'auto' | null }, from the page around the frame only.
      g.addEventListener?.('message', (ev: MessageEvent) => {
        if (ev.source !== g.parent || !ev.data || typeof ev.data !== 'object') return;
        const d = ev.data as { t?: unknown; follow?: unknown };
        if (d.t !== 'homie-watch') return;
        const f = d.follow;
        if (f === 'auto' || f === null || f === 'overview' || (typeof f === 'number' && Number.isInteger(f))) api.follow(f as Follow | 'overview');
      });
      // The same keys inside the frame, for a watcher who clicked into the game.
      if (opts.watchKeys !== false) {
        g.addEventListener?.('keydown', (ev: KeyboardEvent) => {
          if (ev.metaKey || ev.ctrlKey || ev.altKey || !follows) return;
          const list = seated();
          const k = ev.key;
          if (/^[1-9]$/.test(k)) { const p = list[Number(k) - 1]; if (p) api.follow(p.seat); return; }
          if (k === 'a' || k === 'A') { api.follow('auto'); return; }
          if (k === 'o' || k === 'O' || k === '0') { api.follow(null); return; }
          if ((k === 'ArrowRight' || k === 'ArrowLeft') && list.length) {
            const i = list.findIndex((p) => p.seat === viewNow);
            const n = k === 'ArrowRight' ? (i + 1) % list.length : (i <= 0 ? list.length - 1 : i - 1);
            api.follow((list[n] as Peer).seat);
          }
        });
      }
    } catch { /* not a browser */ }
  }

  // The play page's "Quiet AI" (section 17): { t: 'homie-hush', on }, from the page around the frame only.
  try {
    g.addEventListener?.('message', (ev: MessageEvent) => {
      if (ev.source !== g.parent || !ev.data || typeof ev.data !== 'object') return;
      const d = ev.data as { t?: unknown; on?: unknown };
      if (d.t === 'homie-hush') hushed = d.on === true;
      // The page's answer to a net.prefs call, and where its own controls sit over the game (section 24).
      if (d.t === 'homie-prefs') { const m = d as Record<string, unknown>; const w = prefsAsks.get(Number(m['n'])); if (w) { prefsAsks.delete(Number(m['n'])); w(m); } }
      if (d.t === 'homie-shell') readShell(d as Record<string, unknown>);
      // Room chat (section 19): the play page's "Show chat" and "Show my messages over my character".
      if (d.t === 'homie-chat') {
        const c = d as { show?: unknown; bubble?: unknown };
        if (typeof c.show === 'boolean') chatShown = c.show;
        if (typeof c.bubble === 'boolean') bubbleMine = c.bubble;
      }
    });
  } catch { /* not a browser */ }

  /** Tell the relay what this game does with servers (only a host's word counts), once per change. */
  function sendCaps(): void {
    if (rulesGame || role !== 'host' || offline || !connected || !caps.size) return;
    const list = [...caps].sort();
    const sig = list.join(',');
    if (sig === capsSent) return;
    if (raw({ t: 'caps', caps: list })) capsSent = sig;
  }
  function declare(k: 'skill' | 'agents'): void {
    if (caps.has(k)) { if (role === 'host' && capsSent === '') sendCaps(); return; }
    caps.add(k);
    sendCaps();
  }
  function readPolicy(raw0: unknown): Policy {
    const p = (raw0 ?? {}) as Partial<Policy>;
    const kids = p.kids === true;
    const levelMax = Math.max(1, Math.min(kids ? 3 : 5, Number(p.levelMax) || 5));
    const sk = p.skill && typeof p.skill === 'object' ? (p.skill as Skill) : skillPreset(Number(p.level) || 3, kids);
    return {
      ...DEFAULT_POLICY, ...p,
      kind: p.kind === 'humans-only' || p.kind === 'hybrid' || p.kind === 'beginner' ? p.kind : 'open',
      aiSeats: Math.max(0, Number(p.aiSeats) || 0), guides: Math.max(0, Number(p.guides) || 0), bots: p.bots === 'off' ? 'off' : 'fill',
      level: Math.max(1, Math.min(levelMax, Number(p.level) || 3)), levelMax, kids,
      skill: { ...skillPreset(Number(sk.level) || 3, kids), ...sk },
    } as Policy;
  }
  function readChatLine(m: Record<string, unknown>): ChatLine | null {
    if (typeof m['id'] !== 'string') return null;
    const react = m['t'] === 'react';
    const by = m['by'] === 'watcher' || m['by'] === 'hub' || m['by'] === 'studio' ? m['by'] : 'player';
    return {
      id: m['id'], at: Number(m['at']) || now(), kind: react ? 'react' : by === 'studio' ? 'studio' : typeof m['say'] === 'string' ? 'line' : 'text',
      name: String(m['name'] ?? '').slice(0, 40), seat: typeof m['seat'] === 'number' ? m['seat'] : null, colour: typeof m['colour'] === 'number' ? m['colour'] : null, by,
      ...(typeof m['text'] === 'string' ? { text: m['text'] } : {}), ...(typeof m['say'] === 'string' ? { say: m['say'] } : {}),
      ...(react ? { react: String(m['react'] ?? ''), glyph: String(m['glyph'] ?? '') } : {}),
      ...(m['bubble'] === true ? { bubble: true } : {}), ...(m['acct'] === true ? { acct: true } : {}), ...(m['owner'] === true ? { owner: true } : {}),
      ...(typeof m['n'] === 'string' ? { mine: true } : {}),
    };
  }
  function chatSend(msg: Record<string, unknown>, bubble?: boolean): boolean {
    if (offline || asAgent) return false;
    chatSeq += 1;
    return raw({ ...msg, n: `g${chatSeq}`, ...((bubble ?? bubbleMine) ? {} : { bubble: false }) });
  }
  function readVote(m: Record<string, unknown>): VoteState | null {
    if (!Array.isArray(m['options']) || typeof m['id'] !== 'string') return null;
    return {
      of: 'skill', id: String(m['id']), open: m['open'] === true, until: Number(m['until']) || 0, options: (m['options'] as unknown[]).map(Number).filter(Number.isFinite),
      counts: (m['counts'] && typeof m['counts'] === 'object' ? m['counts'] : {}) as Record<string, number>, voters: Number(m['voters']) || 0, of_total: Number(m['of_total']) || 0,
      ...(m['result'] && typeof m['result'] === 'object' ? { result: m['result'] as VoteState['result'] } : {}), ...(typeof m['reason'] === 'string' ? { reason: m['reason'] } : {}),
    };
  }

  // ---------------------------------------------------------------- API
  const api: Netplay<S, A, C> = {
    get role() { return role; },
    get isHost() { return role === 'host'; },
    get seat() { return seat; },
    get spectator() { return seat === null && !offline; },
    get offline() { return offline; },
    get rulesHosting() { return Boolean(rulesHost); },
    get connected() { return connected; },
    get closedWhy() { return closedWhy; },
    get downMs() { return connected || !downSince ? 0 : wall() - downSince; },
    get link() { return link; },
    get reconnects() { return reconnects; },
    get resumed() { return resumed; },
    get full() { return full; },
    line(text: string | null): void {
      const next = typeof text === 'string' && text.trim() ? text.trim().slice(0, 120) : null;
      if (next === gameLine) return;
      gameLine = next;
      post?.({ what: 'line', text: next });
      paintLink();
    },
    start(): void { clockRunning = true; },
    get version() { return version; },
    get stale() { return staleVer; },
    featuresOf(s: number | null): string[] {
      if (s === null || s === undefined) return [];
      if (s === seat && !offline) return [...features];
      for (const p of peers.values()) if (p.seat === s) return Array.isArray(p.feat) ? p.feat.filter((x) => typeof x === 'string') : [];
      return [];
    },
    allHave(feature: string): boolean {
      const k = String(feature ?? '').toLowerCase();
      if (!features.includes(k)) return false;
      // A lite agent (hands `host`) has no game client: its body is the host's own bot code.
      for (const p of peers.values()) if (typeof p.seat === 'number' && !p.watch && !(p.agent && p.agent.hands === 'host') && !(Array.isArray(p.feat) && p.feat.includes(k))) return false;
      return true;
    },
    get prefs() { return prefs; },
    get params() { return params; },
    param(n: string, fallback: string | null = null): string | null { return Object.prototype.hasOwnProperty.call(params, n) ? params[n] as string : fallback; },
    get shell() { return shellLayout; },
    get arrivalInfo() { return { ...arrived }; },
    get owned() { return role === 'host' || offline || seat === null ? true : mine.own; },
    get id() { return id; },
    get name() { return name; },
    get colour() { return colour; },
    get device() { return device; },
    get host() { return host; },
    get peers() { return peers; },
    get roundInfo() { return roundInfo; },
    get slots() { return slots; },
    get announcement() { return announcement && (announcement.until === undefined || announcement.until > now()) ? announcement : null; },
    isMuted(s: number | null): boolean { return s !== null && (muted.get(s) ?? 0) > now(); },
    pickPlayer(s: number | null): void { post?.({ what: 'pick', seat: typeof s === 'number' ? s : null }); },
    playable(): void { explicitPlayable(); },
    loading(fraction: number, what?: string): void {
      if (playableSent) return;
      const t = wall();
      const p = Math.max(0, Math.min(1, Number(fraction) || 0));
      if (t - loadingAt < 100 && p < 1) return;
      loadingAt = t;
      post?.({ what: 'loading', p: Math.round(p * 100) / 100, ...(typeof what === 'string' && what ? { label: what.slice(0, 40) } : {}) });
    },
    get watching() { return watching; },
    get viewSeat() { markFollows(); return watching ? viewNow : (offline ? null : seat); },
    get following() { return watching ? following : seat; },
    get watchedSeat() { return watching ? viewNow : (offline ? null : seat); },
    get canFollow() { return canFollowNow(); },
    follow(target) {
      if (!watching) return false;
      const next: Follow | undefined = target === 'auto' ? 'auto' : target === null || target === 'overview' ? null
        : typeof target === 'number' && Number.isInteger(target) && target >= 0 && target < 64 ? target : undefined;
      if (next === undefined || !canFollowNow()) return false;
      following = next;
      wish = null;
      // Auto starts from the player on screen (no cut for its own sake); a pick is shown at once.
      if (next === 'auto') { autoSeat = viewNow; autoAt = wall(); }
      resolveView('asked');
      postView('asked');
      return true;
    },
    spotlight(s) {
      if (!watching || typeof s !== 'number') return;
      spot = { seat: s, at: wall() };
      if (following === 'auto') resolveView('auto');
    },
    players: seated,
    get policy() { return policy; },
    get skill() { declare('skill'); return policy.skill; },
    skillOf(slot: number): Skill {
      declare('skill');
      const s = (slots ?? []).find((x) => x.slot === slot);
      // A guide plays at the server's own level; everyone else at the party's dial.
      if (s && s.agent && s.agent.role === 'guide') return skillPreset(policy.level, policy.kids);
      return policy.skill;
    },
    vote(n: number): boolean {
      if (offline || seat === null || watching || asAgent) return false;
      return raw({ t: 'vote', of: 'skill', n: Math.floor(Number(n)) });
    },
    openVote(_of = 'skill', reason?: string): boolean {
      if (offline || (seat === null && role !== 'host') || watching || asAgent) return false;
      return raw({ t: 'vote', of: 'skill', open: true, ...(reason ? { reason: String(reason).slice(0, 40) } : {}) });
    },
    get voteState() { return voteState; },
    agents(): Peer[] { return [...peers.values()].filter((p) => Boolean(p.agent)); },
    isAgent(s: number | null): boolean {
      if (s === null || s === undefined) return false;
      for (const p of peers.values()) if (p.seat === s && p.agent) return true;
      return false;
    },
    get hushed() { return hushed; },
    set hushed(on: boolean) { hushed = Boolean(on); },
    get chatRules() { return policy.chat ?? null; },
    get chatShown() { return chatShown; },
    say(text: string, o?: { bubble?: boolean }): boolean {
      const t = String(text ?? '').trim();
      if (!t) return false;
      return chatSend({ t: 'say', text: t.slice(0, 280) }, o?.bubble);
    },
    sayLine(id: string, o?: { bubble?: boolean }): boolean { return chatSend({ t: 'say', say: String(id ?? '').slice(0, 16) }, o?.bubble); },
    react(kind: string, o?: { bubble?: boolean }): boolean { return chatSend({ t: 'react', kind: String(kind ?? '').slice(0, 16) }, o?.bubble); },
    get asAgent() { return Boolean(asAgent); },
    ready,
    on(kind, fn) {
      (handlers[kind] as Set<unknown>).add(fn);
      if (kind === 'view') markFollows();
      return () => { (handlers[kind] as Set<unknown>).delete(fn); };
    },
    now,
    snapshotDue() {
      if (role !== 'host' || !connected || offline) return false;
      // Alone: 1 Hz, so a joiner's welcome carries a recent world. With company: snapshotHz.
      return wall() - lastSnapSentAt >= (peers.size > 1 ? snapshotMs : 1000) - 2;
    },
    snapshot(d, k, force = false) {
      if (rulesGame) return false;
      if (role !== 'host' || offline || !connected) return false;
      if (!force && wall() - lastSnapSentAt < (peers.size > 1 ? snapshotMs : 1000) - 2) return false;
      tick = k ?? tick + 1;
      const st = snapStamp();
      const c = ctlWire();
      // The state as text once: the heartbeat sends the same text again while the game's frames hitch.
      const data = JSON.stringify(d ?? null);
      const text = `{"t":"snap","k":${JSON.stringify(tick)},"st":${st},"d":${data}${c.length ? `,"c":${JSON.stringify(c)}` : ''}}`;
      lastSnapData = data;
      lastRealSnapAt = wall();
      if (!ws || ws.readyState !== 1) return false;
      // A congested socket drops a snapshot rather than queueing a stale one. At 3 KB (about six
      // snapshots), not 256 KB. A starved network thread on a loaded phone held a second of snapshots and then
      // flushed them at once; the relay counted 30+ in a second, dropped them, and called the host stalled.
      if ((ws.bufferedAmount ?? 0) > 3 * 1024) return false;
      try { ws.send(text); } catch { return false; }
      countBytes(bytesOut, text.length);
      lastSnapSentAt = wall();
      lastSnapBytes = text.length;
      maxSnapBytes = Math.max(maxSnapBytes, text.length);
      if (text.length > 8192) warnOnce('snap-size', `snapshot is ${text.length} B; the budget is 8 KB (move slow state to net.state())`);
      snapOut.hit(wall());
      return true;
    },
    checkpointNow: sendCheckpoint,
    handOff() {
      if (role !== 'host' || offline || !connected || peers.size < 2) return false;
      return yieldHost();
    },
    round(r) {
      if (rulesGame) return;
      roundInfo = r;
      post?.({ what: 'round', round: r });
      if (role === 'host') raw({ t: 'round', round: r });
      emit('round', r);
    },
    roster(s) {
      if (rulesGame) return;
      slots = s.map((x) => ({ slot: x.slot, seat: x.seat, name: x.name, bot: x.bot, ...(x.agent ? { agent: { seat: x.agent.seat, role: x.agent.role, hands: x.agent.hands } } : {}) }));
      post?.({ what: 'roster', slots });
      if (role === 'host') raw({ t: 'roster', slots });
    },
    state(key, d) {
      if (rulesGame) return false;
      if (role !== 'host' && !offline) return false;
      const text = JSON.stringify(d ?? null);
      if (stateSent.get(key) === text) return false;
      stateSent.set(key, text);
      if (d === null || d === undefined) stateMap.delete(key); else stateMap.set(key, d);
      if (text.length > 6000) warnOnce(`state-size:${key}`, `state '${key}' is ${text.length} B; split it (8 KB cap per key)`);
      if (!offline) raw({ t: 'state', k: key, d: d ?? null });
      return true;
    },
    stateOf<T = unknown>(key: string) { return stateMap.get(key) as T | undefined; },
    stateKeys() { return [...stateMap.keys()]; },
    input(a, held) {
      if (rulesGame) return;
      pendingA = a;
      const list = heldList(held);
      let edge = false;
      for (const h of list) if (!prevHeld.has(h)) { pendingPresses[h] = (pendingPresses[h] ?? 0) + 1; edge = true; }
      prevHeld = new Set(list);
      pendingHeld = list;
      if (role === 'host' || seat === null || offline || !connected) { pendingPresses = {}; return; }
      scheduleInput(edge);
    },
    steps(e, k, entries, r) {
      if (seat === null || !entries.length) return false;
      if (rulesHost && offline) { rulesHost.frame({ t: 'in', from: seat, e, k, s: entries, r }); return true; }
      if ((!rulesGame && role === 'host') || offline || !connected) return false;
      if (!raw({ t: 'in', e, k, s: entries, r })) return false;
      inputOut.hit(wall());
      return true;
    },
    press(idp) {
      if (rulesGame) return;
      if (role === 'host' || seat === null || offline || !connected) return;
      pendingPresses[idp] = (pendingPresses[idp] ?? 0) + 1;
      scheduleInput(true);
    },
    send(kind, data, to) {
      if (rulesHost && offline) { rulesHost.frame({ t: 'ev', from: seat, id, k: kind, d: data ?? null }); return; }
      if (offline) return;
      const m: Record<string, unknown> = { t: 'ev', k: kind, d: data ?? null, ...(rulesGame ? { view: true } : {}) };
      if (!rulesGame && role === 'host' && (typeof to === 'number' || typeof to === 'string')) m['to'] = to;
      raw(m);
    },
    inputOf(s) { return inputs.get(s) ?? null; },
    avatar(s) {
      const f = inputs.get(s);
      if (!f) return null;
      sweepCtl();
      const e = ctlOf(s);
      return e.own && f.r === e.rs ? f.a : null;
    },
    takePresses(s) { const p = presses.get(s) ?? {}; presses.delete(s); return p; },
    control(s) { sweepCtl(); const e = ctlOf(s); return { seat: s, rs: e.rs, own: e.own, taken: e.taken, ack: e.ack }; },
    reset(s) { const e = ctlOf(s); e.rs += 1; return e.rs; },
    take(s, ms) { const e = ctlOf(s); e.own = false; e.taken = true; e.giveAt = ms && ms > 0 ? wall() + ms : 0; },
    give(s) { const e = ctlOf(s); if (e.taken) giveBack(e); },
    pending() {
      const out: PendingInput<A>[] = [];
      for (let i = 0; i < sentHist.length; i += 1) {
        const f = sentHist[i] as { q: number; a: A; h: string[]; at: number; r: number };
        if (f.r !== mine.rs || f.q <= mine.ack) continue;
        const next = sentHist[i + 1];
        out.push({ q: f.q, a: f.a, h: f.h, at: f.at, dt: Math.max(0, (next ? next.at : wall()) - f.at) });
      }
      return out;
    },
    sample(delayMs) {
      if (!buf.length) return null;
      const renderT = (rulesHost ? rulesWireStamp + performance.now() - rulesFrameAt : now()) - (delayMs ?? interpDelay());
      const newest = buf[buf.length - 1] as Snapshot<S>;
      const oldest = buf[0] as Snapshot<S>;
      const t = wall();
      if (!starvedWindowAt) starvedWindowAt = t;
      if (t - starvedWindowAt >= 2000) { starvedPct = sampleFrames ? starvedFrames / sampleFrames : 0; sampleFrames = 0; starvedFrames = 0; starvedWindowAt = t; }
      sampleFrames += 1;
      if (renderT >= newest.st) {
        const over = renderT - newest.st;
        if (over > 0) {
          starvedFrames += 1;
          // An underrun: grow the buffer by exactly the overrun (up to 30 ms a frame). The picture was holding on
          // the newest snapshot anyway, so nothing jumps back, and the next snapshots continue instead of catching up.
          if (delayMs === undefined && opts.interpDelayMs === undefined && delaySmooth) delaySmooth = Math.min(400, delaySmooth + Math.min(30, over));
        }
        return { a: newest, b: newest, alpha: 1, renderT, starved: over };
      }
      if (renderT <= oldest.st) return { a: oldest, b: oldest, alpha: 0, renderT, starved: 0 };
      for (let i = buf.length - 1; i > 0; i -= 1) {
        const a = buf[i - 1] as Snapshot<S>;
        const b = buf[i] as Snapshot<S>;
        if (a.st <= renderT && renderT <= b.st) {
          const span = b.st - a.st;
          return { a, b, alpha: span > 0 ? (renderT - a.st) / span : 1, renderT, starved: 0 };
        }
      }
      return { a: newest, b: newest, alpha: 1, renderT, starved: 0 };
    },
    latest() { return buf.length ? buf[buf.length - 1] as Snapshot<S> : null; },
    decide(state, questions, o = {}) {
      const t0 = wall();
      const floor = (): Decided => {
        let picks: DecidePicks = {};
        try { picks = o.floor ? o.floor(state) ?? {} : {}; } catch { picks = {}; }
        return { by: 'floor', picks, ms: Math.round(wall() - t0) };
      };
      decideStats.asked += 1;
      const now0 = wall();
      const why = rulesGame || role !== 'host' ? 'not-host' : offline || !connected ? 'offline' : now0 < decideOffUntil ? 'off' : now0 < decideNextAt ? 'pace' : null;
      if (why) { decideStats.floor += 1; return Promise.resolve({ ...floor(), why }); }
      decideNextAt = now0 + 3000;
      const n = `d${(decideSeq += 1).toString(36)}`;
      return new Promise<Decided>((done) => {
        const ms = Math.max(200, Math.min(5000, Number(o.ms) || 2500));
        const timer = setTimeout(() => { if (deciding.delete(n)) { decideStats.floor += 1; done({ ...floor(), why: 'slow' }); } }, ms);
        deciding.set(n, { done, timer, at: t0, floor });
        if (!raw({ t: 'decide', n, state, questions })) { deciding.delete(n); clearTimeout(timer); decideStats.floor += 1; done({ ...floor(), why: 'offline' }); }
      });
    },
    stats: statsNow,
    expose(p) { probes = { ...probes, ...p }; },
    close() {
      sendCheckpoint(); rulesSender?.leave();
      disposed = true; stopRules();
      closed = true;
      if (pingTimer) clearInterval(pingTimer);
      if (paceTimer) clearInterval(paceTimer);
      if (ckptTimer) clearInterval(ckptTimer);
      if (statsTimer) clearInterval(statsTimer);
      if (watchTimer) clearInterval(watchTimer);
      if (hbTimer) clearInterval(hbTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (spotTimer) clearTimeout(spotTimer);
      if (overlayTimer) clearTimeout(overlayTimer);
      if (overlayHide) clearTimeout(overlayHide);
      clearTimeout(connectTimer);
      try { raw({ t: 'bye' }); ws?.close(1000, 'bye'); } catch { /* gone */ }
      if (!offline || link === 'alone') setLink('closed', 'close');
      if (overlay) overlay.hidden = true;
    },
  };

  // Harness / console surface. Counters and probes, never controls.
  try {
    g.__homieNet = {
      get role() { return role; },
      get seat() { return seat; },
      get offline() { return offline; },
      get rulesHosting() { return Boolean(rulesHost); },
      get connected() { return connected; },
      get owned() { return api.owned; },
      get host() { return host; },
      get peers() { return [...peers.values()]; },
      get round() { return roundInfo; },
      get roster() { return slots; },
      get watching() { return watching; },
      get viewSeat() { return viewNow; },
      get policy() { return policy; },
      get vote() { return voteState; },
      get revision() { return NETPLAY_REVISION; },
      /** Revision 9: the link, how often it was interrupted, the game's revision, and the arrival's facts (for a probe). */
      get link() { return link; },
      get full() { return full; },
      get line() { return overlay && !overlay.hidden ? { kind: overlay.getAttribute('data-homie-link'), text: overlay.textContent } : null; },
      get reconnects() { return reconnects; },
      get drops() { return drops; },
      get version() { return version; },
      get stale() { return staleVer; },
      get arrival() { return { ...arrived }; },
      get shell() { return shellLayout; },
      get params() { return params; },
      get agent() { return asAgent; },
      get following() { return following; },
      get state() { return Object.fromEntries(stateMap); },
      get lastCheckpoint() { return lastCkpt ? { k: lastCkpt.k, st: lastCkpt.st } : null; },
      /** The newest snapshot this browser received: tick, server time, sender seat, local Date.now() of arrival. */
      get lastSnapshot() { return lastSnapInfo; },
      stats: statsNow,
      now,
      get probe() { return probes; },
    };
  } catch { /* frozen global */ }

  return api;
}
