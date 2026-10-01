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
 */
import { createControls, createRoom, createSaves, exposePort, q, type BodyBase, type NetEvent } from '@homie-rocks/studio/port';

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
interface Body extends BodyBase { x: number; y: number; hp: number; maxHp: number; level: number; face: number; flags: number; downUntil: number; atkAt: number; strikeAt: number; tx: number; ty: number }
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
    if (b.bot) {
      // Bots are company, not carries: they hunt only what is near them, and strike slower than a person.
      const near = nearestSlime(b.x, b.y);
      const t = near && Math.hypot(near.x - b.x, near.y - b.y) < 360 ? near : null;
      const tx = t ? t.x : b.tx; const ty = t ? t.y : b.ty;
      if (!t && Math.hypot(b.tx - b.x, b.ty - b.y) < 30) { b.tx = 200 + Math.random() * (W - 400); b.ty = 150 + Math.random() * (H - 300); }
      const dx = tx - b.x; const dy = ty - b.y; const dist = Math.hypot(dx, dy) || 1;
      if (dist > 60) { b.x += (dx / dist) * SPEED * 0.75 * dt; b.y += (dy / dist) * SPEED * 0.75 * dt; b.face = Math.atan2(dy, dx); }
      wants = Boolean(t && dist < STRIKE_RANGE && now - b.atkAt > 900);
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
  room.update();
}

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
let scale = 1; let ox = 0; let oy = 0;
function resize(): void {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  scale = Math.min(canvas.width / W, canvas.height / H); ox = (canvas.width - W * scale) / 2; oy = (canvas.height - H * scale) / 2;
}
addEventListener('resize', resize);
resize();
let bannerText = ''; let bannerUntil = 0;
function banner(t: string): void { bannerText = t; bannerUntil = performance.now() + 2600; }
const SLIME = ['#7ad35a', '#e0a83a', '#c74bd8'];

function draw(t: number): void {
  const s = scale;
  ctx.fillStyle = '#0b0f0a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save(); ctx.translate(ox, oy); ctx.scale(s, s);
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
  for (const b of room.view()) {
    const self = !b.bot && b.seat === viewS;
    const local = self && !room.hosting && !net.watching;
    const x = local ? me.x : b.x; const y = local ? me.y : b.y;
    const isDown = Boolean(b.flags & DOWN);
    ctx.globalAlpha = isDown ? 0.35 : 1;
    if ((b.flags & STRIKING) || (self && performance.now() - me.flashAt < 160)) { ctx.strokeStyle = 'rgba(255,207,110,.7)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, STRIKE_RANGE * 0.8, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = self ? '#ffcf6e' : b.bot ? '#8aa0b8' : '#f3ead2';
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0f0a'; ctx.beginPath(); ctx.arc(x + Math.cos(b.face) * 10, y + Math.sin(b.face) * 10, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - 24, y - R - 12, 48, 5);
    ctx.fillStyle = '#7ad35a'; ctx.fillRect(x - 24, y - R - 12, (48 * clamp(b.hp, 0, b.maxHp)) / Math.max(1, b.maxHp), 5);
    ctx.globalAlpha = 1;
    ctx.font = '600 18px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = self ? '#ffcf6e' : '#e7d9b4';
    ctx.fillText(`${b.name}${b.bot ? ' · bot' : ''} · ${b.level}`, x, y - R - 18);
  }
  ctx.restore();
  hud(t);
}

function hud(t: number): void {
  const k = Math.max(0.8, Math.min(1.4, canvas.height / 900));
  ctx.save(); ctx.scale(k, k);
  const x0 = 14; const y0 = 14;
  ctx.fillStyle = 'rgba(10,14,9,.62)'; ctx.fillRect(x0, y0, 240, 62);
  ctx.textAlign = 'left'; ctx.font = '700 16px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#ffcf6e';
  if (lookOnly) {
    // A watcher's panel is the followed hero's, as the room has them (their save stays in their own browser).
    const v = room.viewBody();
    if (v) {
      ctx.fillText(`${v.name} · Lv ${v.level}`, x0 + 10, y0 + 22);
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x0 + 10, y0 + 32, 140, 6);
      ctx.fillStyle = '#7ad35a'; ctx.fillRect(x0 + 10, y0 + 32, (140 * clamp(v.hp, 0, v.maxHp)) / Math.max(1, v.maxHp), 6);
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#e7d9b4';
      ctx.fillText(`${v.score} xp tonight${v.flags & DOWN ? ' · down' : ''}`, x0 + 10, y0 + 54);
    } else {
      const heroes = room.view().filter((b) => !b.bot).length;
      ctx.fillText('Watching the vale', x0 + 10, y0 + 22);
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#e7d9b4';
      ctx.fillText(`${heroes} ${heroes === 1 ? 'hero' : 'heroes'} · ${(room.fast() ?? []).length} slimes`, x0 + 10, y0 + 46);
    }
  } else ctx.fillText(hero ? `${hero.name}${hero.hardcore ? ' ☠' : ''} · Lv ${hero.level}` : heroLoaded ? 'No hero yet' : 'Loading your hero…', x0 + 10, y0 + 22);
  if (hero && !lookOnly) {
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x0 + 10, y0 + 32, 140, 6);
    ctx.fillStyle = '#ffcf6e'; ctx.fillRect(x0 + 10, y0 + 32, (140 * hero.xp) / xpFor(hero.level), 6);
    ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#e7d9b4';
    ctx.fillText(`${hero.gold} gold · ${hero.kills} slain`, x0 + 10, y0 + 54);
  }
  const c = room.clock();
  ctx.textAlign = 'center'; ctx.font = '700 16px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#f3ead2';
  const cw = canvas.width / k;
  ctx.fillText(c.phase === 'over' ? `Dawn · night ${c.n + 1} in ${c.secondsLeft}s` : `Night ${c.n} · ${Math.floor(c.secondsLeft / 60)}:${String(c.secondsLeft % 60).padStart(2, '0')}`, cw / 2, 30);
  if (c.phase === 'over') {
    const rows = room.results().slice(0, 5);
    ctx.fillStyle = 'rgba(10,14,9,.78)'; ctx.fillRect(cw / 2 - 150, 44, 300, 30 + rows.length * 22);
    ctx.fillStyle = '#ffcf6e'; ctx.fillText('Tonight\'s hunters', cw / 2, 66);
    ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#e7d9b4';
    rows.forEach((r, i) => ctx.fillText(`${r.place}. ${r.name}${r.bot ? ' (bot)' : ''} — ${r.score} xp`, cw / 2, 90 + i * 22));
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
net.expose({ scores: () => room.view().map((b) => ({ slot: b.slot, seat: b.seat, bot: b.bot, score: b.score })) });

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
