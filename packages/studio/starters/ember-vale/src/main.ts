/*
 * EMBER VALE — the persistent-character starter (@homie-rocks/studio/saves; the guide is saves/SAVES.md).
 *
 * Two kinds of state, kept apart on purpose:
 *
 *   THE ROOM (createRoom, netplay): tonight's hunt. Bodies, slimes, the clock, who struck what. Rounds ("nights")
 *   start the moment the first browser arrives (bots in the empty seats), arrivals take a bot's place, and a room
 *   forgets everything 60 s after its last player leaves. That is fine: nothing here has to last.
 *
 *   THE SAVE (createSaves): your hero. Name, level, experience, gold, hardcore or not. Loaded when you arrive,
 *   saved when it changes, on this device at once and in the studio's cloud when online, so it follows you to
 *   every device you sign in on. Lifetime stats (kills, gold, time played) only add up and outlive any hero.
 *
 * The host decides who killed what and sends the killer a `loot` event; only the hero's own browser changes the
 * hero and saves it. A hardcore hero who falls becomes a memorial in the Hall of the Fallen, and its save is wiped
 * in the same step (saves.fall). Canvas 2D on purpose: the point is the pattern, in a few hundred lines.
 *
 * A watcher (/<game>/watch, contract revision 5) has no hero and makes none: `room.viewSeat()` is the hero it
 * follows, drawn in gold as a hero's own browser draws itself, with that hero's panel; nobody followed, the vale.
 * The host says who slew what (`slain`), so a watcher on Auto cuts to the kill.
 *
 * Servers and the skill dial (contract revision 6): the vale's bots hunt at the room's dial (`room.skillOf(body)`:
 * how soon they notice a slime, how close they stand, how often they strike), and a beginner server's AI guide seats
 * are kept as AI bodies, marked " · AI". createRoom does the seats; the bots below read the dial.
 *
 * AI GUIDES (contract revision 7, @homie-rocks/studio/agents): on a beginner server the guide seats get a brain. The
 * vale's own words for it are ../agents.json: the goals a guide may take (follow, quest, lead, guard, back), the lines
 * it may say, and the asks a new hero can tap ("Help me with King Slime", "Take me to camp", "No thanks"). The HANDS
 * below play every frame at the dial: they walk to the goal, hunt what the goal says, and tell agents.done() when it is
 * done. The BRAIN is the server's (the Table's Workers AI, the owner's key, or the owner's own Claude in the seat); with
 * none, or between its decisions, `decide` below is the floor. A guide's line is drawn as a bubble from agents.json,
 * never from a model; "Quiet AI" hides them.
 */
import { AI_MARK, createControls, createLabels, createRoom, createSaves, easeView, exposePort, fitView, jitter, q, standoff, type BodyBase, type Fit, type LabelIn, type LabelOut, type NetEvent, type Skill } from '@homie-rocks/studio/port';
import { useAgents, type Goal, type Vocabulary } from '@homie-rocks/studio/agents';
import vocabulary from '../agents.json';

/* ------------------------------------------------------------------ rules */
const W = 1600;
const H = 1000;
const R = 22;
const SPEED = 300;
const STRIKE_RANGE = 96;
const STRIKE_MS = 380;
const DOWN_MS = 4000;
const DOWN = 1;
const STRIKING = 2;
const BOT_NAMES = ['Rook', 'Vex', 'Moth', 'Kilo', 'Juno', 'Pike', 'Nyx', 'Ash'];
const xpFor = (level: number): number => Math.round(20 * level ** 1.5);
const maxHpOf = (level: number): number => 60 + level * 12;
const damageOf = (level: number): number => 10 + level * 3;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** The hero: the one thing that lasts. Kept in the save key 'hero'. */
interface Hero { v: 1; name: string; level: number; xp: number; gold: number; hardcore: boolean; kills: number; deaths: number; born: number }
interface Body extends BodyBase { x: number; y: number; hp: number; maxHp: number; level: number; face: number; flags: number; downUntil: number; atkAt: number; strikeAt: number; tx: number; ty: number; seenAt?: number; ax?: number; ay?: number }
interface Slime { id: number; x: number; y: number; hp: number; maxHp: number; size: number; hitAt: number; lastHit: number }
type SlimeRow = [id: number, x: number, y: number, hp: number, size: number];

/* ------------------------------------------------------------------ the save */
/** A spectator (a watcher, or a big screen) has no hero of its own: it never loads, makes or saves one. */
const shellCfg = (globalThis as { HOMIE_NET?: { want?: string; watch?: boolean } }).HOMIE_NET;
const lookOnly = shellCfg?.watch === true || shellCfg?.want === 'screen';
const saves = createSaves({ game: 'ember-vale' });
let hero: Hero | null = null;
let heroLoaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Saves are cheap, but not free: one write a second at most, however often the hero changes. */
function saveSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (hero) void saves.set('hero', hero); }, 1000);
}
async function loadHero(): Promise<void> {
  if (lookOnly) { heroLoaded = true; ui.paint(); return; }
  const h = await saves.get<Hero>('hero');
  hero = h && h.v === 1 ? h : null;
  heroLoaded = true;
  ui.paint();
  if (!hero) ui.make(); else ui.hide('make');
}
void saves.ready.then(loadHero);
// Signing in on this device changes whose saves these are: load that player's hero.
saves.on('player', () => { void loadHero(); });

function gain(xp: number, gold: number): void {
  if (!hero) return;
  hero.xp += xp; hero.gold += gold; hero.kills += 1;
  while (hero.xp >= xpFor(hero.level)) { hero.xp -= xpFor(hero.level); hero.level += 1; banner(`Level ${hero.level}!`); }
  saveSoon();
  void saves.stats.add({ kills: 1, gold });
  void saves.stats.max({ level: hero.level });
}

async function fell(cause: string): Promise<void> {
  if (!hero) return;
  if (!hero.hardcore) {
    hero.deaths += 1;
    hero.gold = Math.floor(hero.gold * 0.9);
    saveSoon();
    void saves.stats.add({ deaths: 1 });
    banner('You fell, and dropped a tenth of your gold.');
    return;
  }
  // Hardcore: a memorial, and the hero's save wiped in the same step. Lifetime stats stay.
  const h = hero;
  hero = null;
  clearTimeout(saveTimer);
  void saves.stats.add({ deaths: 1, heroesLost: 1 });
  const days = Math.max(1, Math.ceil((Date.now() - h.born) / 86400_000));
  await saves.fall({ character: h.name, summary: { level: h.level, gold: h.gold, kills: h.kills, cause, days }, wipe: true, keep: ['settings'] });
  void ui.hall(`${h.name} has fallen`, `Level ${h.level}, ${h.kills} slimes, ${h.gold} gold, slain by ${cause}. The Hall remembers.`, true);
}

/* ------------------------------------------------------------------ the room */
let slimes: Slime[] = [];
let slimeSeq = 0;
let spawnAt = 0;
let kingAt = 0;
const me = { x: W / 2, y: H / 2, face: 0, has: false, strikes: 0, flashAt: 0 };
/** Where a guide can lead the party (agents.json "lead"). */
const PLACES: Record<string, { x: number; y: number }> = { camp: { x: W / 2, y: H / 2 }, king: { x: W / 2, y: 120 }, 'east-woods': { x: W - 200, y: H / 2 + 30 } };
/** When the last King Slime fell (host): a guide on the King's quest is done. */
let kingSlainAt = 0;

const room = createRoom<Body, SlimeRow[], { slimes: Slime[]; seq: number }>({
  game: 'ember-vale',
  maxPlayers: 8,
  minBodies: 3,
  roundSeconds: 90,
  breakSeconds: 8,
  botName: (slot) => BOT_NAMES[slot % BOT_NAMES.length] as string,
  spawn: (slot, i) => {
    const a = (i / 8) * Math.PI * 2;
    const lvl = slot.bot ? 1 + (slot.slot % 4) : 1;
    const x = W / 2 + Math.cos(a) * 160; const y = H / 2 + Math.sin(a) * 120;
    return { slot: slot.slot, seat: slot.seat, name: slot.name, bot: slot.bot, score: 0, x, y, hp: maxHpOf(lvl), maxHp: maxHpOf(lvl), level: lvl, face: a, flags: 0, downUntil: 0, atkAt: 0, strikeAt: 0, tx: x, ty: y };
  },
  pack: (b) => [q(b.x, 0), q(b.y, 0), Math.max(0, Math.round(b.hp)), b.maxHp, b.level, q(b.face, 2), b.flags],
  unpack: (f, b) => { b.x = f[0] as number; b.y = f[1] as number; b.hp = f[2] as number; b.maxHp = f[3] as number; b.level = f[4] as number; b.face = f[5] as number; b.flags = f[6] as number; },
  angles: [5],
  discrete: [2, 3, 4, 6],
  onRoundStart: () => { slimes = []; spawnAt = 0; kingAt = room.net.now() + 45_000; },
  fastWorld: () => slimes.map((s) => [s.id, Math.round(s.x), Math.round(s.y), Math.max(0, Math.round(s.hp)), s.size]),
  saveWorld: () => ({ slimes, seq: slimeSeq }),
  loadWorld: (w, fast) => {
    slimes = w?.slimes?.map((s) => ({ ...s })) ?? [];
    slimeSeq = Math.max(w?.seq ?? 0, ...slimes.map((s) => s.id));
    for (const [id, x, y, hp, size] of fast ?? []) {
      const s = slimes.find((o) => o.id === id);
      if (s) { s.x = x; s.y = y; s.hp = hp; } else slimes.push({ id, x, y, hp, maxHp: hp, size, hitAt: 0, lastHit: -1 });
    }
  },
  adopt: (b) => { me.x = b.x; me.y = b.y; me.has = true; },
  local: () => (me.has ? ({ ...mine(), x: me.x, y: me.y } as Body) : null),
  onTakeover: (b) => { b.score = 0; b.flags = 0; b.hp = b.maxHp; },
});
const net = room.net;
const myLevel = (): number => hero?.level ?? 1;

/* ------------------------------------------------------------------ the guides' brain (agents.json) */
type PartyRow = { seat: number; dist: number; hp: number; down: boolean };
const greeted = new Map<number, Set<number>>();
const warnedAt = new Map<number, number>();
const agents = useAgents(net, vocabulary as unknown as Vocabulary, {
  // What a guide sees (host, at most every 2 s, under 2 KB): the vale near it, never a name, an account or typed text.
  view: (slot) => {
    const b = room.bodies.get(slot);
    if (!b) return {};
    const party: PartyRow[] = [...room.bodies.values()].filter((o) => !o.bot && o.seat !== null)
      .map((o) => ({ seat: o.seat as number, dist: Math.round(Math.hypot(o.x - b.x, o.y - b.y)), hp: Math.round((100 * o.hp) / Math.max(1, o.maxHp)), down: Boolean(o.flags & DOWN) }))
      .filter((p) => p.dist < 900).sort((x, y) => x.dist - y.dist).slice(0, 6);
    const king = slimes.find((o) => o.size === 3);
    const near = slimes.filter((o) => Math.hypot(o.x - b.x, o.y - b.y) < 350).length;
    const c = room.clock();
    return {
      me: { hp: Math.round((100 * b.hp) / Math.max(1, b.maxHp)), down: Boolean(b.flags & DOWN) },
      zone: zoneOf(b.x, b.y),
      // A brain thinks again when this changes, so it changes only for what matters: the King close, or a swarm.
      danger: king && Math.hypot(king.x - b.x, king.y - b.y) < 450 ? 'the King Slime' : near >= 5 ? 'slimes' : null,
      party, quests: openQuests(), slimes: { near, king: Boolean(king) }, round: { phase: c.phase, left: c.secondsLeft },
    };
  },
  // The scripted floor: with no AI, over budget, and between an AI's decisions. Synchronous; it never waits.
  decide: (v, { slot, goal }) => {
    const a = (v['asks'] as { k: string; args: Record<string, unknown> }[] | undefined)?.[0];
    if (a?.k === 'ask_help') return { goal: 'quest', args: { quest: a.args['quest'] }, say: 'quest_help', sayArgs: { quest: a.args['quest'] } };
    if (a?.k === 'lead_me') return { goal: 'lead', args: { place: a.args['place'] }, say: 'follow_me', sayArgs: { place: a.args['place'] } };
    if (a?.k === 'no_thanks') return { goal: 'back', say: 'bye' };
    const party = (v['party'] as PartyRow[] | undefined) ?? [];
    // What a hero asked for is carried through until it is done.
    if (goal && goal.state === 'active' && ['quest', 'lead', 'back'].includes(goal.goal)) return null;
    const seen = greeted.get(slot) ?? new Set<number>();
    greeted.set(slot, seen);
    const fresh = party.find((p) => !seen.has(p.seat) && p.dist < 420);
    if (fresh) { seen.add(fresh.seat); return { goal: 'follow', args: { seat: fresh.seat }, say: 'hello', sayArgs: { player: fresh.seat } }; }
    if (v['danger'] === 'the King Slime') {
      const warn = room.net.now() - (warnedAt.get(slot) ?? 0) > 30_000;
      if (warn) warnedAt.set(slot, room.net.now());
      return { goal: 'guard', ...(warn ? { say: 'careful', sayArgs: { thing: 'the King Slime' } } : {}) };
    }
    const hurt = party.find((p) => !p.down && p.hp < 40);
    if (hurt) return { goal: 'follow', args: { seat: hurt.seat } };
    if (party[0]) return { goal: 'follow', args: { seat: party[0].seat } };
    return { goal: 'lead', args: { place: 'camp' } };
  },
});
/** A guide's line over its head for a few seconds: the game's own words (agents.json), never a model's. */
const bubbles = new Map<number, { text: string; until: number }>();
/** What the e2e probe reads: goal changes (with the ask that led to one), asks, lines. Never a name or an account. */
const guideLog: Record<string, unknown>[] = [];
const logGuide = (row: Record<string, unknown>): void => { guideLog.push({ at: Date.now(), ...row }); if (guideLog.length > 80) guideLog.shift(); };
agents.on('say', (e) => { bubbles.set(e.slot, { text: e.text, until: performance.now() + 3600 }); logGuide({ ev: 'say', slot: e.slot, line: e.line }); });
agents.on('goal', (e) => logGuide({ ev: 'goal', slot: e.slot, goal: e.goal.goal, args: e.goal.args, from: e.goal.from, askAt: e.askAt }));
agents.on('ask', (e) => logGuide({ ev: 'ask', slot: e.slot, k: e.k, args: e.args, from: e.from }));
function mine(): Body {
  const b = room.mine();
  return b ?? ({ slot: -1, seat: room.mySeat(), name: net.name, bot: false, score: 0, x: me.x, y: me.y, hp: maxHpOf(myLevel()), maxHp: maxHpOf(myLevel()), level: myLevel(), face: me.face, flags: 0, downUntil: 0, atkAt: 0, strikeAt: 0, tx: 0, ty: 0 } as Body);
}

/* The host tells the killer (and the fallen) by seat: only the hero's own browser changes its hero. */
net.on('event', (e: NetEvent) => {
  const d = (e.d ?? {}) as { xp?: number; gold?: number; cause?: string; to?: number };
  if (e.k === 'loot' && d.to === room.mySeat()) gain(Math.max(0, Number(d.xp) || 0), Math.max(0, Number(d.gold) || 0));
  if (e.k === 'down' && d.to === room.mySeat()) void fell(String(d.cause ?? 'a slime').slice(0, 40));
  if (e.k === 'slain' && typeof (e.d as { seat?: unknown })?.seat === 'number') net.spotlight((e.d as { seat: number }).seat);
});
function tell(b: Body, k: 'loot' | 'down', d: Record<string, unknown>): void {
  if (b.bot || b.seat === null) return;
  if (b.seat === room.mySeat()) { if (k === 'loot') gain(Number(d.xp), Number(d.gold)); else void fell(String(d.cause)); return; }
  net.send(k, { ...d, to: b.seat }, b.seat);
}

function strike(b: Body, now: number): void {
  b.atkAt = now; b.strikeAt = now;
  for (const s of slimes) {
    if (s.hp <= 0 || Math.hypot(s.x - b.x, s.y - b.y) > STRIKE_RANGE + s.size * 10) continue;
    s.hp -= damageOf(b.level);
    s.lastHit = b.slot;
    if (s.hp <= 0) {
      const xp = s.size === 3 ? 60 : 6 * s.size;
      const gold = s.size === 3 ? 50 : 2 + Math.floor(Math.random() * 4) * s.size;
      b.score += xp;
      if (s.size === 3) kingSlainAt = now;
      tell(b, 'loot', { xp, gold });
      // Everyone hears who slew it (a watcher on Auto cuts to them); the loot itself is the slayer's alone.
      if (!b.bot && b.seat !== null) room.send('slain', { seat: b.seat });
    }
  }
  slimes = slimes.filter((s) => s.hp > 0);
}

function down(b: Body, now: number, cause: string): void {
  b.flags = DOWN; b.hp = 0; b.downUntil = now + DOWN_MS;
  tell(b, 'down', { cause });
}

function stepHost(dt: number): void {
  const now = net.now();
  const live = room.round?.phase === 'live';
  const myS = room.mySeat();
  for (const b of room.bodies.values()) {
    if (b.flags & DOWN) {
      if (now >= b.downUntil) { b.flags = 0; b.hp = b.maxHp; b.x = W / 2 + (Math.random() - 0.5) * 300; b.y = H / 2 + (Math.random() - 0.5) * 200; room.moved(b); }
      continue;
    }
    let wants = false;
    const guide = b.bot && b.agent?.role === 'guide' ? agents.goalOf(b.slot) : null;
    if (guide) wants = stepGuide(b, guide, room.skillOf(b), dt, now);
    else if (b.bot) {
      // Bots are company, not carries: they hunt only what is near them, and strike slower than a person. At the
      // room's dial (section 17): they notice a slime `reactionMs` late, hunt farther afield the more they lean to
      // the front (positioning), aim a little off (aimNoise), and strike sooner the more aggressive they are.
      const s = room.skillOf(b);
      const near = nearestSlime(b.x, b.y);
      const reach = standoff(s, 460, 220);
      if (!b.seenAt || now - b.seenAt >= s.reactionMs) {
        b.seenAt = now;
        const t0 = near && Math.hypot(near.x - b.x, near.y - b.y) < reach ? near : null;
        b.ax = t0 ? t0.x + jitter(s, 40) : undefined; b.ay = t0 ? t0.y + jitter(s, 40) : undefined;
      }
      const t = b.ax !== undefined && b.ay !== undefined ? { x: b.ax, y: b.ay } : null;
      const tx = t ? t.x : b.tx; const ty = t ? t.y : b.ty;
      if (!t && Math.hypot(b.tx - b.x, b.ty - b.y) < 30) { b.tx = 200 + Math.random() * (W - 400); b.ty = 150 + Math.random() * (H - 300); }
      const dx = tx - b.x; const dy = ty - b.y; const dist = Math.hypot(dx, dy) || 1;
      if (dist > 60) { b.x += (dx / dist) * SPEED * 0.75 * dt; b.y += (dy / dist) * SPEED * 0.75 * dt; b.face = Math.atan2(dy, dx); }
      wants = Boolean(t && dist < STRIKE_RANGE && now - b.atkAt > 1400 - 900 * s.aggression);
    } else if (b.seat === myS) {
      b.x = me.x; b.y = me.y; b.face = me.face; b.level = myLevel(); b.maxHp = maxHpOf(b.level);
      wants = me.strikes > 0; me.strikes = 0;
    } else {
      const a = room.avatar(b);
      if (a) {
        room.bound(b, { x: Number(a[0]), y: Number(a[1]) }, SPEED, dt);
        b.face = Number(a[2]) || 0;
        // The hero's level comes from its own browser (it owns the save). A game with stakes would check it.
        b.level = clamp(Math.floor(Number(a[3]) || 1), 1, 99); b.maxHp = maxHpOf(b.level);
      }
      wants = Boolean(room.presses(b)['strike']);
    }
    b.hp = Math.min(b.hp, b.maxHp);
    b.flags = now - b.strikeAt < 200 ? STRIKING : 0;
    if (wants && live && now - b.atkAt > STRIKE_MS) strike(b, now);
  }
  if (live) stepSlimes(dt, now);
  // Every browser's ask buttons offer the quests open now (slow keyed state: sent only when it changes).
  net.state('quests', openQuests());
  room.update();
}

/* ------------------------------------------------------------------ the guides' hands */
const bodyOfSeat = (seat: unknown): Body | null => { for (const o of room.bodies.values()) if (!o.bot && o.seat === seat) return o; return null; };
const people = (): Body[] => [...room.bodies.values()].filter((o) => !o.bot && o.seat !== null && !(o.flags & DOWN));
const huntFrom = new Map<number, number>();
const arrivedAt = new Map<number, number>();
/**
 * A guide's body, every host frame, doing its goal at the dial (`s`): where it stands (positioning), how soon it
 * notices (reactionMs), how far off it strikes (aimNoise), how eagerly (aggression). Returns whether it strikes now.
 */
function stepGuide(b: Body, g: Goal, s: Skill, dt: number, now: number): boolean {
  let tx = b.x; let ty = b.y; let hunt: Slime | null = null;
  const nearTo = (x: number, y: number, r: number): Slime | null => { const n = nearestSlime(x, y); return n && Math.hypot(n.x - x, n.y - y) < r ? n : null; };
  switch (g.goal) {
    case 'follow': {
      const p = bodyOfSeat(g.args['seat']);
      if (!p) { agents.done(b.slot, false); break; }
      // A step behind the hero (closer at a higher dial), each guide to its own side, and the slime that comes for them.
      const back = standoff(s, 70, 150);
      const side = (b.slot % 2 ? 1 : -1) * (0.5 + (b.slot % 3) * 0.25);
      tx = p.x - Math.cos(p.face + side) * back; ty = p.y - Math.sin(p.face + side) * back;
      hunt = nearTo(p.x, p.y, 200);
      break;
    }
    case 'quest': {
      const quest = g.args['quest'];
      if (quest === 'king-slime') {
        if (kingSlainAt > g.at) { agents.done(b.slot, true); break; }
        hunt = slimes.find((o) => o.size === 3) ?? null;
        if (!hunt) { tx = PLACES['king']!.x; ty = PLACES['king']!.y + 70; }
      } else if (quest === 'big-slime') {
        hunt = slimes.filter((o) => o.size === 2).sort((x, y) => Math.hypot(x.x - b.x, x.y - b.y) - Math.hypot(y.x - b.x, y.y - b.y))[0] ?? null;
        if (!hunt) agents.done(b.slot, true);
      } else {
        // A slime hunt: the slimes near the party, three of them.
        if (!huntFrom.has(b.slot) || huntFrom.get(b.slot)! > b.score) huntFrom.set(b.slot, b.score);
        if (b.score - huntFrom.get(b.slot)! >= 18) { huntFrom.delete(b.slot); agents.done(b.slot, true); break; }
        const ps = people();
        const cx = ps.length ? ps.reduce((a, o) => a + o.x, 0) / ps.length : b.x;
        const cy = ps.length ? ps.reduce((a, o) => a + o.y, 0) / ps.length : b.y;
        hunt = nearTo(cx, cy, 520) ?? nearestSlime(b.x, b.y);
      }
      break;
    }
    case 'lead': {
      const at = PLACES[String(g.args['place'])] ?? PLACES['camp']!;
      tx = at.x; ty = at.y;
      // Done when it is there and a hero came along; given up when nobody came within 20 s of it arriving.
      if (Math.hypot(at.x - b.x, at.y - b.y) < 60) {
        if (!arrivedAt.has(b.slot)) arrivedAt.set(b.slot, now);
        if (people().some((o) => Math.hypot(o.x - at.x, o.y - at.y) < 280)) { arrivedAt.delete(b.slot); agents.done(b.slot, true); }
        else if (now - arrivedAt.get(b.slot)! > 20_000) { arrivedAt.delete(b.slot); agents.done(b.slot, false); }
      } else arrivedAt.delete(b.slot);
      hunt = nearTo(b.x, b.y, 110);
      break;
    }
    case 'guard': {
      const ps = people().filter((o) => Math.hypot(o.x - b.x, o.y - b.y) < 700);
      const cx = ps.length ? ps.reduce((a, o) => a + o.x, 0) / ps.length : b.x;
      const cy = ps.length ? ps.reduce((a, o) => a + o.y, 0) / ps.length : b.y;
      tx = cx + 50; ty = cy + 40;
      hunt = nearTo(cx, cy, standoff(s, 260, 160));
      break;
    }
    case 'back': {
      const at = PLACES['camp']!;
      tx = at.x; ty = at.y;
      if (Math.hypot(at.x - b.x, at.y - b.y) < 50) agents.done(b.slot, true);
      break;
    }
    default: break;
  }
  // Two guides with the same goal never stand in one spot: each keeps its own place around it.
  if (!hunt && g.goal !== 'follow') { const k = b.slot * 2.4; tx += Math.cos(k) * 46; ty += Math.sin(k) * 46; }
  // Reaction time: a guide re-aims only every reactionMs, a little off at a low dial.
  if (hunt) {
    if (!b.seenAt || now - b.seenAt >= s.reactionMs) { b.seenAt = now; b.ax = hunt.x + jitter(s, 40); b.ay = hunt.y + jitter(s, 40); }
    tx = b.ax ?? hunt.x; ty = b.ay ?? hunt.y;
  }
  const dx = tx - b.x; const dy = ty - b.y; const dist = Math.hypot(dx, dy) || 1;
  if (dist > (hunt ? 50 : 24)) { const v = Math.min(SPEED * 0.85, dist / Math.max(dt, 1e-3)); b.x = clamp(b.x + (dx / dist) * v * dt, R, W - R); b.y = clamp(b.y + (dy / dist) * v * dt, R, H - R); b.face = Math.atan2(dy, dx); }
  return Boolean(hunt && Math.hypot(hunt.x - b.x, hunt.y - b.y) < STRIKE_RANGE + hunt.size * 10 && now - b.atkAt > 1400 - 900 * s.aggression);
}

/** The quests open now: a slime hunt always, the King Slime when it is out or close to coming, a big slime when one is. */
function openQuests(): string[] {
  const now = net.now();
  return ['slime-hunt', ...(slimes.some((o) => o.size === 3) || kingAt - now < 30_000 ? ['king-slime'] : []), ...(slimes.some((o) => o.size === 2) ? ['big-slime'] : [])];
}
const zoneOf = (x: number, y: number): string => {
  let best = 'vale'; let bd = 260;
  for (const [id, p] of Object.entries(PLACES)) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = id; } }
  return best;
};

function nearestSlime(x: number, y: number): Slime | null {
  let best: Slime | null = null; let bd = Infinity;
  for (const s of slimes) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } }
  return best;
}

function stepSlimes(dt: number, now: number): void {
  const bodies = [...room.bodies.values()].filter((b) => !(b.flags & DOWN));
  const people = bodies.filter((b) => !b.bot).length;
  if (now >= spawnAt && slimes.length < 6 + people * 2) {
    spawnAt = now + 1100;
    const edge = Math.floor(Math.random() * 4);
    const x = edge === 0 ? 30 : edge === 1 ? W - 30 : Math.random() * W;
    const y = edge === 2 ? 30 : edge === 3 ? H - 30 : Math.random() * H;
    const size = Math.random() < 0.25 ? 2 : 1;
    slimes.push({ id: ++slimeSeq, x, y, hp: 18 * size, maxHp: 18 * size, size, hitAt: 0, lastHit: -1 });
  }
  if (now >= kingAt && !slimes.some((s) => s.size === 3)) {
    kingAt = now + 60_000;
    slimes.push({ id: ++slimeSeq, x: W / 2, y: 40, hp: 160, maxHp: 160, size: 3, hitAt: 0, lastHit: -1 });
    room.send('king', {});
  }
  // Slimes hunt heroes: the nearest person, and a bot only when no person is up.
  const prey = bodies.some((b) => !b.bot) ? bodies.filter((b) => !b.bot) : bodies;
  for (const s of slimes) {
    let target: Body | null = null; let bd = Infinity;
    for (const b of prey) { const d = Math.hypot(b.x - s.x, b.y - s.y); if (d < bd) { bd = d; target = b; } }
    const speed = s.size === 3 ? 70 : 95 - s.size * 10;
    if (target) {
      const dx = target.x - s.x; const dy = target.y - s.y; const dist = Math.hypot(dx, dy) || 1;
      s.x += (dx / dist) * speed * dt; s.y += (dy / dist) * speed * dt;
      if (dist < R + 10 + s.size * 10 && now - s.hitAt > 800) {
        s.hitAt = now;
        target.hp -= 5 * s.size + (s.size === 3 ? 10 : 0);
        if (target.hp <= 0) down(target, now, s.size === 3 ? 'the King Slime' : s.size === 2 ? 'a big slime' : 'a slime');
      }
    } else { s.x += Math.sin(now / 900 + s.id) * 20 * dt; s.y += Math.cos(now / 1100 + s.id) * 20 * dt; }
    s.x = clamp(s.x, 20, W - 20); s.y = clamp(s.y, 20, H - 20);
  }
}

/* ------------------------------------------------------------------ input */
const input = createControls({ actions: { strike: ['Space', 'KeyJ', 'Enter'] }, touch: { buttons: [{ id: 'strike', label: 'STRIKE' }] } });
// A touch screen has STRIKE at the bottom right: the ask panel stands right above it (index.html, .touch).
document.body.classList.toggle('touch', input.touch.enabled);
function stepMe(dt: number): void {
  const b = room.hosting ? room.mine() : null;
  const isDown = b ? Boolean(b.flags & DOWN) : Boolean(myViewBody()?.flags && (myViewBody()!.flags & DOWN));
  const typing = !ui.idle();
  const m = typing || isDown ? { x: 0, y: 0 } : input.move();
  if (Math.hypot(m.x, m.y) > 0.05) { me.face = Math.atan2(m.y, m.x); me.x = clamp(me.x + m.x * SPEED * dt, R, W - R); me.y = clamp(me.y + m.y * SPEED * dt, R, H - R); me.has = true; }
  if (!typing && input.pressed('strike')) { if (room.hosting) me.strikes += 1; else room.press('strike'); me.flashAt = performance.now(); }
  room.input([q(me.x, 0), q(me.y, 0), q(me.face, 2), myLevel()]);
}
function myViewBody(): Body | null { const s = room.mySeat(); return room.view().find((b) => b.seat === s && !b.bot) ?? null; }

/* ------------------------------------------------------------------ drawing */
const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
let dpr = 1; let vw = 1; let vh = 1;
function resize(): void {
  dpr = Math.min(2, devicePixelRatio || 1); vw = innerWidth; vh = innerHeight;
  canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
  // The page's pills sit under the hero panel, which grows with the screen (a TV's would cover them).
  const pills = document.querySelector<HTMLElement>('.pill');
  if (pills) pills.style.top = `calc(${Math.max(86, Math.round(76 * hudScale() + 10))}px + env(safe-area-inset-top))`;
}
/** CSS px per HUD unit, from the screen's CSS size: 0.7 on a phone either way up, 0.8 on a computer, 1.2 on a TV. */
function hudScale(): number { return Math.max(Math.min(vw, vh) <= 540 ? 0.7 : 0.8, Math.min(1.4, vh / 900, vw / 560)); }
addEventListener('resize', resize);
resize();
let bannerText = ''; let bannerUntil = 0;
function banner(t: string): void { bannerText = t; bannerUntil = performance.now() + 2600; }
const SLIME = ['#7ad35a', '#e0a83a', '#c74bd8'];

/*
 * The camera (port/view.ts). Where the whole vale fits at a size that reads (a computer, a TV) it all shows, as it
 * always did. Where it would be small (a phone, above all held upright, where the vale was a strip a quarter of the
 * screen tall), the vale fills the screen and follows your hero (a watcher: the hero followed), never past the vale's
 * edge, except as far as it takes to keep your hero clear of the panel at the top and STRIKE at the bottom.
 */
const READABLE = 0.62; // CSS px per vale unit: a body 27 px across, a name 12 px tall
const INSET = { top: 124, bottom: 100 }; // the hero panel and its pills; STRIKE and the ask panel's foot
let cam: Fit | null = null;
let lastDraw = 0;
// Names keep clear of the guides' bubbles and of the ask panel (a page element over the canvas).
const labels = createLabels({ screen: () => ({ w: vw, h: vh }), avoid: () => { const p = document.getElementById('asks'); return p && !p.hidden ? [...bubbleBoxes, p.getBoundingClientRect()] : bubbleBoxes; } });
let bubbleBoxes: { left: number; top: number; right: number; bottom: number }[] = [];
let shownLabels: LabelOut[] = [];
function aim(): Fit {
  const v = lookOnly ? room.viewBody() : null;
  const focus = !lookOnly && me.has ? { x: me.x, y: me.y } : v ? { x: v.x, y: v.y } : null;
  const phone = Math.min(vw, vh) <= 540;
  return fitView({ world: { w: W, h: H }, screen: { w: vw, h: vh }, readable: READABLE, zoom: Math.max(READABLE, Math.min(vw, vh) / (phone ? 560 : 820)), focus, whole: lookOnly && !v, inset: INSET });
}

function draw(t: number): void {
  const dt = lastDraw ? Math.min(0.1, (t - lastDraw) / 1000) : 0;
  lastDraw = t;
  const want = aim();
  // A cut when the camera changes kind (a phone turned, a watcher's pick); else it glides.
  cam = !cam || cam.follow !== want.follow ? want : easeView(cam, want, dt, 10);
  const s = cam.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0f0a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (vw / 2 - cam.x * s), dpr * (vh / 2 - cam.y * s));
  // The vale: moss, and embers that drift.
  ctx.fillStyle = '#16210f'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    const x = (i * 263) % W; const y = (i * 151 + (t / 40) * ((i % 3) + 1)) % H;
    ctx.fillStyle = i % 5 ? 'rgba(122,211,90,.10)' : 'rgba(255,170,80,.35)';
    ctx.beginPath(); ctx.arc(x, H - y, i % 5 ? 26 : 2.5, 0, Math.PI * 2); ctx.fill();
  }
  const fast = room.fast() ?? [];
  for (const [, x, y, hp, size] of fast) {
    const r = 12 + size * 10;
    ctx.fillStyle = SLIME[size - 1] ?? '#7ad35a';
    ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.78 + Math.sin(t / 180 + x) * 0.06), 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0f0a'; ctx.fillRect(x - r * 0.4, y - r * 0.2, 4, 4); ctx.fillRect(x + r * 0.3, y - r * 0.2, 4, 4);
    if (size === 3) { ctx.fillStyle = '#ffcf6e'; ctx.fillRect(x - 14, y - r - 12, 28, 8); }
    const max = size === 3 ? 160 : 18 * size;
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - r, y + r + 4, r * 2, 4);
    ctx.fillStyle = '#ff7a59'; ctx.fillRect(x - r, y + r + 4, (r * 2 * clamp(hp, 0, max)) / max, 4);
  }
  // The hero whose view this is: my own, or the one a watcher follows (null: the vale, nobody in gold).
  const viewS = room.viewSeat();
  const sx = (x: number): number => vw / 2 + (x - (cam as Fit).x) * s;
  const sy = (y: number): number => vh / 2 + (y - (cam as Fit).y) * s;
  // Names are drawn after the vale, on the screen, at a size that reads on any screen; they never pile up.
  const fs = clamp(18 * s, 12, 20);
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  const names: LabelIn[] = [];
  const said: { x: number; y: number; head: number; text: string }[] = [];
  const mine: ScreenBox[] = []; // your own hero and its name: no bubble covers them
  const meAt = (() => { const v = room.view().find((b) => !b.bot && b.seat === viewS); return v ? { x: v.x, y: v.y } : null; })();
  for (const b of room.view()) {
    const self = !b.bot && b.seat === viewS;
    const local = self && !room.hosting && !net.watching;
    const x = local ? me.x : b.x; const y = local ? me.y : b.y;
    const isDown = Boolean(b.flags & DOWN);
    ctx.globalAlpha = isDown ? 0.35 : 1;
    if ((b.flags & STRIKING) || (self && performance.now() - me.flashAt < 160)) { ctx.strokeStyle = 'rgba(255,207,110,.7)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, STRIKE_RANGE * 0.8, 0, Math.PI * 2); ctx.stroke(); }
    const isGuide = (net.slots ?? []).some((x) => x.slot === b.slot && x.agent?.role === 'guide');
    ctx.fillStyle = self ? '#ffcf6e' : isGuide ? '#7fd8c8' : b.bot ? '#8aa0b8' : '#f3ead2';
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0f0a'; ctx.beginPath(); ctx.arc(x + Math.cos(b.face) * 10, y + Math.sin(b.face) * 10, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - 24, y - R - 12, 48, 5);
    ctx.fillStyle = '#7ad35a'; ctx.fillRect(x - 24, y - R - 12, (48 * clamp(b.hp, 0, b.maxHp)) / Math.max(1, b.maxHp), 5);
    ctx.globalAlpha = 1;
    // An AI's name already ends in " · AI" (a guide, a companion); a plain bot says bot.
    const text = `${b.name}${b.bot && !b.name.endsWith(AI_MARK) ? ' · bot' : ''}${isGuide ? ' · guide' : ''} · ${b.level}`;
    const near = meAt ? Math.hypot(x - meAt.x, y - meAt.y) : 0;
    // Its spot is above its health bar; its body (and bar) is what other names keep off. People first, then guides,
    // then bots; nearer you first.
    const body = { left: sx(x - 24), top: sy(y - R - 12), right: sx(x + 24), bottom: sy(y + R) };
    if (body.right < 0 || body.left > vw || body.bottom < 0 || body.top > vh) continue; // off screen: no name at the edge
    if (self) { const w = ctx.measureText(text).width; mine.push(body, { left: sx(x) - w / 2 - 6, top: body.top - 4 - fs * 1.2, right: sx(x) + w / 2 + 6, bottom: body.top }); }
    names.push({ key: b.slot, text, x: sx(x), y: body.top - 3, w: ctx.measureText(text).width, h: fs * 1.2, below: body.bottom + 4 + fs * 1.2, body, self, rank: (b.bot ? (isGuide ? 1 : 2) : 0) * 10_000 + near });
    const line = bubbles.get(b.slot);
    // The bubble's tail stops just above the guide's own name, so the name keeps its spot while it speaks.
    if (line && line.until > performance.now()) said.push({ x: sx(x), y: body.top - 3 - fs * 1.2 - 12, head: body.top, text: line.text });
  }
  ctx.restore();
  // Speech bubbles first (labels keep clear of them), then the names; your own last, on a dark chip.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bubbleBoxes = said.map((b) => bubble(b.x, b.y, b.text, fs, b.head, mine));
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  shownLabels = labels.place(names, dt);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const l of [...shownLabels].sort((a, b) => Number(Boolean(a.self)) - Number(Boolean(b.self)))) {
    if (l.alpha <= 0) continue;
    ctx.globalAlpha = l.alpha;
    if (l.moved) {
      // Moved off its own spot: a thin line to its body says whose it is.
      const under = l.top > l.y;
      ctx.strokeStyle = 'rgba(231,217,180,.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(l.cx, under ? l.top : l.bottom); ctx.lineTo(l.x, under ? (l.body?.bottom ?? l.top - 6) : l.y + 2); ctx.stroke();
    }
    if (l.self) { ctx.fillStyle = 'rgba(10,14,9,.72)'; ctx.beginPath(); ctx.roundRect(l.left - 5, l.top - 1, l.right - l.left + 10, l.bottom - l.top + 2, 6); ctx.fill(); }
    else { ctx.strokeStyle = 'rgba(8,11,6,.8)'; ctx.lineWidth = 3; ctx.strokeText(l.text, l.cx, l.cy); }
    ctx.fillStyle = l.self ? '#ffcf6e' : '#e7d9b4';
    ctx.fillText(l.text, l.cx, l.cy);
  }
  ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  hud(t);
}

type ScreenBox = { left: number; top: number; right: number; bottom: number };
const touches = (a: ScreenBox, b: ScreenBox): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
/**
 * A speech bubble: up to three short lines, above a guide (screen px). It never covers your own hero or its name
 * (`clearOf`): it moves aside, or higher, and its tail runs down to the guide's head (`head`), so whose line it is
 * stays plain. Returns the box it covers.
 */
function bubble(x: number, y: number, text: string, fs: number, head: number, clearOf: ScreenBox[]): ScreenBox {
  const f = Math.max(12, fs - 1);
  ctx.font = `600 ${f}px ui-sans-serif, system-ui, sans-serif`;
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) { if ((line + ' ' + w).trim().length > 26 && line) { lines.push(line); line = w; } else line = (line + ' ' + w).trim(); }
  if (line) lines.push(line);
  const shown = lines.slice(0, 3);
  const wid = Math.max(...shown.map((l) => ctx.measureText(l).width)) + 20;
  const hgt = shown.length * f * 1.25 + 10;
  // Where it goes: above the guide; else beside that, either way; else higher, over whatever it must keep clear of.
  const above = Math.min(y, ...clearOf.map((c) => c.top - 12));
  const spots = [y, above].flatMap((by) => [x, x + wid * 0.6 + 16, x - wid * 0.6 - 16].map((bx) => ({ bx: clamp(bx, wid / 2 + 4, vw - wid / 2 - 4), by })));
  const at = spots.find((p) => p.by - hgt >= 0 && !clearOf.some((c) => touches({ left: p.bx - wid / 2, top: p.by - hgt, right: p.bx + wid / 2, bottom: p.by + 8 }, c))) ?? spots[0]!;
  const cx = at.bx; const by = at.by;
  const tail = clamp(x, cx - wid / 2 + 12, cx + wid / 2 - 12);
  ctx.fillStyle = 'rgba(14,30,27,.92)'; ctx.strokeStyle = 'rgba(127,216,200,.75)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(cx - wid / 2, by - hgt, wid, hgt, 10); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tail - 6, by); ctx.lineTo(tail + 6, by); ctx.lineTo(tail, by + 8); ctx.closePath(); ctx.fillStyle = 'rgba(14,30,27,.92)'; ctx.fill();
  if (head > by + 12 || tail !== x) { ctx.strokeStyle = 'rgba(127,216,200,.75)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tail, by + 8); ctx.lineTo(x, head - 2); ctx.stroke(); }
  ctx.fillStyle = '#e9fff9'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  shown.forEach((l, i) => ctx.fillText(l, cx, by - hgt + 5 + f * 1.25 * (i + 0.5)));
  ctx.textBaseline = 'alphabetic';
  return { left: cx - wid / 2, top: by - hgt, right: cx + wid / 2, bottom: by + 8 };
}

function hud(t: number): void {
  // Device px per HUD unit: as before on an upright phone, a computer and a TV; readable on a phone on its side and on
  // a high-density computer screen (it was sized by device pixels, so half as big there).
  const k = dpr * hudScale();
  ctx.save(); ctx.scale(k, k);
  const x0 = 14; const y0 = 14;
  const TITLE = '700 16px ui-sans-serif, system-ui, sans-serif';
  const SMALL = '600 13px ui-sans-serif, system-ui, sans-serif';
  // A watcher's panel is the followed hero's, as the room has them (their save stays in their own browser).
  const v = lookOnly ? room.viewBody() : null;
  const heroes = room.view().filter((b) => !b.bot).length;
  const title = lookOnly ? (v ? `${v.name} · Lv ${v.level}` : 'Watching the vale') : hero ? `${hero.name}${hero.hardcore ? ' ☠' : ''} · Lv ${hero.level}` : heroLoaded ? 'No hero yet' : 'Loading your hero…';
  const sub = lookOnly ? (v ? `${v.score} xp tonight${v.flags & DOWN ? ' · down' : ''}` : `${heroes} ${heroes === 1 ? 'hero' : 'heroes'} · ${(room.fast() ?? []).length} slimes`) : hero ? `${hero.gold} gold · ${hero.kills} slain` : '';
  const bar = v ? { colour: '#7ad35a', of: clamp(v.hp, 0, v.maxHp) / Math.max(1, v.maxHp) } : hero && !lookOnly ? { colour: '#ffcf6e', of: hero.xp / xpFor(hero.level) } : null;
  // The panel is as wide as what it says: on a phone the vale runs under it, and the clock sits beside it.
  ctx.font = TITLE; const titleW = ctx.measureText(title).width;
  ctx.font = SMALL; const subW = sub ? ctx.measureText(sub).width : 0;
  const pw = Math.max(bar ? 140 : 0, titleW, subW) + 20;
  ctx.fillStyle = 'rgba(10,14,9,.62)'; ctx.fillRect(x0, y0, pw, 62);
  ctx.textAlign = 'left'; ctx.font = TITLE; ctx.fillStyle = '#ffcf6e';
  ctx.fillText(title, x0 + 10, y0 + 22);
  if (bar) {
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x0 + 10, y0 + 32, 140, 6);
    ctx.fillStyle = bar.colour; ctx.fillRect(x0 + 10, y0 + 32, 140 * clamp(bar.of, 0, 1), 6);
  }
  if (sub) { ctx.font = SMALL; ctx.fillStyle = '#e7d9b4'; ctx.fillText(sub, x0 + 10, y0 + (bar ? 54 : 46)); }
  const c = room.clock();
  ctx.font = TITLE; ctx.fillStyle = '#f3ead2';
  const cw = canvas.width / k;
  const clock = c.phase === 'over' ? `Dawn · night ${c.n + 1} in ${c.secondsLeft}s` : `Night ${c.n} · ${Math.floor(c.secondsLeft / 60)}:${String(c.secondsLeft % 60).padStart(2, '0')}`;
  // Top centre; on a narrow screen where that would touch the panel, just under it.
  if (x0 + pw + 10 > cw / 2 - ctx.measureText(clock).width / 2) { ctx.textAlign = 'left'; ctx.fillText(clock, x0 + 10, y0 + 62 + 20); }
  else { ctx.textAlign = 'center'; ctx.fillText(clock, cw / 2, 30); }
  ctx.textAlign = 'center';
  if (c.phase === 'over') {
    const rows = room.results().slice(0, 5);
    // Under the page's own pills on a narrow screen (they are buttons, above the canvas), else under the clock.
    const top = vw <= 540 ? 132 * (dpr / k) : 44;
    ctx.fillStyle = 'rgba(10,14,9,.78)'; ctx.fillRect(cw / 2 - 150, top, 300, 30 + rows.length * 22);
    ctx.font = TITLE; ctx.fillStyle = '#ffcf6e'; ctx.fillText('Tonight\'s hunters', cw / 2, top + 22);
    ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#e7d9b4';
    rows.forEach((r, i) => ctx.fillText(`${r.place}. ${r.name}${r.bot && !r.name.endsWith(AI_MARK) ? ' (bot)' : ''} — ${r.score} xp`, cw / 2, top + 46 + i * 22));
  }
  if (performance.now() < bannerUntil) { ctx.font = '800 22px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#ffcf6e'; ctx.fillText(bannerText, cw / 2, canvas.height / k - 90); }
  const st = saves.status();
  // Under the clock: the pills below the hero panel are the page's own buttons and would cover it.
  if (st.pending && !st.online) { ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#c9c0a6'; ctx.textAlign = 'center'; ctx.fillText('Offline: your hero is saved on this device and syncs when you are back', cw / 2, 52); }
  void t;
  ctx.restore();
}

/* ------------------------------------------------------------------ the little bit of DOM */
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const ui = {
  idle: (): boolean => $('make').hidden && $('hall').hidden,
  hide: (id: string): void => { $(id).hidden = true; },
  paint(): void {
    const p = saves.player;
    $('who').textContent = p.local ? 'Playing here only' : p.signedIn ? `${p.name}${p.owner ? ' · owner' : ''}` : 'Guest · keep my hero';
    $('who').hidden = lookOnly;
  },
  make(): void {
    ($('hero-name') as HTMLInputElement).value = '';
    $('make').hidden = false;
    $('hall').hidden = true;
  },
  async hall(title: string, text: string, mourn = false): Promise<void> {
    $('hall-title').textContent = title;
    $('hall-text').textContent = text;
    $('hall-go').hidden = !mourn;
    const list = $('hall-list');
    list.textContent = 'Reading the names…';
    $('hall').hidden = false;
    const fallen = await saves.fallen({ limit: 12 });
    list.textContent = '';
    if (!fallen.length) { const li = document.createElement('li'); li.textContent = 'Nobody yet. May it stay that way.'; list.append(li); }
    for (const f of fallen) {
      const li = document.createElement('li');
      const s = f.summary as { level?: number; cause?: string };
      li.textContent = `${f.character}, level ${s.level ?? '?'} `;
      const small = document.createElement('small');
      small.textContent = `(${f.player}) slain by ${s.cause ?? 'the vale'}, ${new Date(f.at).toLocaleDateString()}`;
      li.append(small);
      list.append(li);
    }
  },
};
$('who').addEventListener('click', () => { if (saves.player.signedIn) window.open('/account/', '_blank', 'noopener'); else saves.signIn('Keep your hero on every device: make an account with a passkey.'); });
$('hall-btn').addEventListener('click', () => { void ui.hall('Hall of the Fallen', 'Hardcore heroes who fell in Ember Vale.'); });
$('hall-close').addEventListener('click', () => { $('hall').hidden = true; if (heroLoaded && !hero) ui.make(); });
$('hall-go').addEventListener('click', () => ui.make());
// Keys typed into the name box are words, not moves.
$('hero-name').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('hero-go').click(); });
$('hero-go').addEventListener('click', () => {
  const typed = ($('hero-name') as HTMLInputElement).value.replace(/\s+/g, ' ').trim().slice(0, 20);
  hero = { v: 1, name: typed || saves.player.name || 'Wanderer', level: 1, xp: 0, gold: 0, hardcore: ($('hero-hc') as HTMLInputElement).checked, kills: 0, deaths: 0, born: Date.now() };
  void saves.set('hero', hero);
  $('make').hidden = true;
  banner(hero.hardcore ? 'One life. Make it count.' : `Welcome to the vale, ${hero.name}.`);
});
saves.on('player', () => ui.paint());
// Time in the vale, a lifetime stat: added every 30 s while the page is open and visible.
setInterval(() => { if (hero && document.visibilityState === 'visible') void saves.stats.add({ seconds: 30 }); }, 30_000);

/* ------------------------------------------------------------------ asking a guide (buttons, never typing) */
/** The guide nearest my hero (within 340 px), and the asks I can make of it: drawn as buttons, four times a second. */
let asksFor = -1;
let asksSig = '';
const askEls = new Map<string, HTMLButtonElement>();
function paintAsks(): void {
  const panel = $('asks');
  const mySeat = room.mySeat();
  const here = me.has && mySeat !== null && !lookOnly && ui.idle();
  let best: { slot: number; name: string; d: number } | null = null;
  if (here) {
    for (const b of room.view()) {
      const sl = (net.slots ?? []).find((x) => x.slot === b.slot);
      if (!sl?.agent || sl.agent.role !== 'guide') continue;
      // The guide the panel is for keeps it while it is in reach, unless another is much nearer: two guides at the
      // party's side would otherwise swap it four times a second, and a thumb's tap would land on a button just redrawn.
      const d = Math.hypot(b.x - me.x, b.y - me.y);
      const rank = d - (b.slot === asksFor ? 120 : 0);
      if (d < 340 && (!best || rank < best.d)) best = { slot: b.slot, name: b.name, d: rank };
    }
  }
  if (!best) { panel.hidden = true; asksFor = -1; asksSig = ''; return; }
  const quests = (net.stateOf<string[]>('quests') ?? (room.hosting ? openQuests() : ['slime-hunt'])).slice(0, 3);
  // Help with each open quest, one place to be led to (not the one I am in), and "No thanks"; three on a phone (either way up).
  const zone = zoneOf(me.x, me.y);
  const all = agents.askButtons(best.slot, { quests });
  const lead = all.filter((b) => b.k === 'lead_me' && b.args['place'] !== zone).slice(0, 1);
  const order = [...all.filter((b) => b.k === 'ask_help'), ...lead, ...all.filter((b) => b.k === 'no_thanks')];
  const buttons = order.slice(0, Math.min(innerWidth, innerHeight) < 540 ? 3 : 5);
  const sig = `${best.slot}|${best.name}|${buttons.map((b) => b.text).join('|')}`;
  panel.hidden = false;
  if (sig === asksSig) return;
  asksSig = sig;
  asksFor = best.slot;
  panel.dataset['slot'] = String(best.slot);
  $('asks-who').textContent = `${best.name} · guide`;
  // A button that stays is the same element (a quest that opens or closes adds or takes one): a thumb's tap that lands
  // while the list changes around it still counts.
  const list = $('asks-list');
  const keep = new Set<string>();
  buttons.forEach((b, i) => {
    const key = `${b.k}|${JSON.stringify(b.args)}`;
    keep.add(key);
    let el = askEls.get(key);
    if (!el) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset['ask'] = b.k;
      btn.addEventListener('click', () => {
        if (asksFor < 0) return;
        if (agents.ask(asksFor, b.k, b.args)) { logGuide({ ev: 'asked', slot: asksFor, k: b.k, args: b.args }); btn.classList.add('sent'); setTimeout(() => btn.classList.remove('sent'), 900); }
      });
      askEls.set(key, btn);
      el = btn;
    }
    if (el.textContent !== b.text) el.textContent = b.text;
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] ?? null);
  });
  for (const [key, el] of askEls) if (!keep.has(key)) { el.remove(); askEls.delete(key); }
}
setInterval(paintAsks, 250);

/* ------------------------------------------------------------------ loop */
let last = performance.now();
let frames = 0;
function frame(t: number): void {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  stepMe(dt);
  if (room.hosting) stepHost(dt);
  draw(t);
  frames += 1;
  requestAnimationFrame(frame);
}

// Tonight's experience per hero: the watch page's live scores, and who Auto follows when nobody is slaying.
net.expose({
  scores: () => room.view().map((b) => ({ slot: b.slot, seat: b.seat, bot: b.bot, score: b.score })),
  // The guides, for the e2e probe: each guide's goal now, and the log of goals, asks and lines (seats and ids only).
  guides: () => ({
    hosting: room.hosting, talking: agents.talking, stats: agents.stats(),
    now: agents.guides().map((g) => { const v = room.view().find((b) => b.slot === g.slot); return { slot: g.slot, seat: g.agent?.seat ?? null, name: g.name, goal: agents.goalOf(g.slot), x: v ? Math.round(v.x) : null, y: v ? Math.round(v.y) : null }; }),
    me: me.has ? { x: Math.round(me.x), y: me.y | 0 } : null,
    log: guideLog.slice(),
  }),
  // Where the camera looks, and the names as drawn (boxes only: the e2e probe counts overlaps and checks your own).
  camera: () => (cam ? { x: cam.x, y: cam.y, scale: cam.scale, follow: cam.follow } : null),
  labels: () => shownLabels.map((l) => ({ self: Boolean(l.self), alpha: l.alpha, moved: l.moved, left: Math.round(l.left), top: Math.round(l.top), right: Math.round(l.right), bottom: Math.round(l.bottom) })),
});

exposePort(net, {
  view: 'top',
  self: () => (me.has && room.mySeat() !== null ? { x: me.x, y: me.y } : null),
  size: R,
  score: () => { const s = room.mySeat(); return room.view().find((b) => b.seat === s && !b.bot)?.score ?? null; },
  busy: () => !ui.idle(),
  extra: { level: () => hero?.level ?? 0, frames: () => frames, saves: () => saves.status().mode },
});

void net.ready.then(() => { const b = room.mine(); if (b) { me.x = b.x; me.y = b.y; me.has = true; } });
requestAnimationFrame(frame);
