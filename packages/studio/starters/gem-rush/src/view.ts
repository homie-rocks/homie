/** Gem Rush: the canvas draws the room; rules.ts decides the game. Coordinates here are pixels (50 per metre). */
import { openRoom, type Entity } from '@homie-rocks/studio/rules/view';
import type rules from './rules';
import { guardGestures, PALETTE, AI_MARK, type Slot, type RoundInfo } from '@homie-rocks/studio/netplay';
import { BUBBLE_FONT, createBubbles, createLabels, fitView, paintBubbles, type BubbleIn, type BubbleOut, type LabelIn, type LabelOut } from '@homie-rocks/studio/port';
import { lab } from '@homie-rocks/studio/lab';
// This canvas draws positive Y downward; report its axes to the control checks.
const room = openRoom<typeof rules>({ screenBasis: () => ({ right: [1, 0], up: [0, -1] }) });
const net = room.net;
guardGestures({ touch: 'canvas' });
const W = 1600, H = 1000, R_AV = 22, R_GEM = 13;
const T = { ...room.tune, knockRange: Number(room.tune.knockRange) * 50, knockDistance: Number(room.tune.knockDistance) * 50 } as Record<string, number>;
const colourOf = (slot: number, seat: number | null): string => PALETTE[(seat ?? slot) % PALETTE.length] as string;
const BOT_NAMES = ['Rook', 'Vex', 'Moth', 'Kilo', 'Juno', 'Pike', 'Nyx', 'Ash'];
const botName = (slot: number): string => BOT_NAMES[slot % BOT_NAMES.length] as string;
const label = (name: string, bot: boolean): string => name.endsWith(AI_MARK) ? name : bot ? `${name} · bot` : name;
const mySeat = (): number | null => room.seat;
const viewSeat = (): number | null => net.viewSeat;
const me = { x: 800, y: 500, has: false };
const drawn = new Map<number, { x: number; y: number; seat: number; score: number; slot: number }>();
const waves: { x: number; y: number; at: number; colour: string; knock?: boolean }[] = [];
let wavesSeen = 0, knocksSeen = 0, frames = 0;
let gems: { x: number; y: number; id: number }[] = [];
let round: RoundInfo | null = null;
let zone: { x: number; y: number; r: number } | null = null;
const slotOf = (e: Entity): number => e.kind === 'runner' ? e.seat ?? 0 : 0;
function updateView(): void {
  const v = moveVector(); room.input({ ax: Math.round(v.x * 127), ay: Math.round(v.y * 127) });
  const own = room.me; me.has = Boolean(own);
  if (own) { me.x = own.pos.x * 50; me.y = own.pos.y * 50; }
  drawn.clear();
  room.each('runner', e => drawn.set(slotOf(e), { slot: slotOf(e), seat: e.driver === 'bot' ? -1 : e.seat ?? -1, x: e.pos.x * 50, y: e.pos.y * 50, score: Number(e.score) }));
  gems = []; room.each('gem', e => gems.push({ id: gems.length, x: e.pos.x * 50, y: e.pos.y * 50 }));
  const z = room.shared.zone as { x: number; y: number } | undefined;
  zone = z ? { x: z.x * 50, y: z.y * 50, r: 150 } : null;
  const r = room.round;
  round = r ? { ...r, startedAt: 0, endsAt: net.now() + r.secondsLeft * 1000 } : null;
}
function effect(name: 'wave' | 'knock', e: { id?: string; at?: { x: number; y: number } | null; dir?: { x: number; y: number }; by?: string }): void {
  const body = e.id ? room.get(e.id) : null;
  if (!body || body.kind !== 'runner' || !e.at) return;
  const slot = slotOf(body), at = { x: e.at.x * 50, y: e.at.y * 50 }, now = performance.now();
  waves.push({ ...at, at: now, colour: colourOf(slot, body.seat ?? null), knock: name === 'knock' });
  if (name === 'wave') { wavesSeen++; pushes.set(slot, now); }
  else if (e.dir) {
    const by = e.by ? room.get(e.by) : null;
    knocksSeen++; bumped({ slot, dx: e.dir.x, dy: e.dir.y, by: by?.kind === 'runner' ? by.seat : undefined }, at);
    if (lab.on) Object.assign(subject, { slot, at: net.now(), x0: at.x, y0: at.y, px: at.x, py: at.y, has: true });
  }
}
room.on('wave', e => effect('wave', e));
room.on('knock', e => effect('knock', e));
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' && !keys.has('Space')) wave();
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0, active: false };
const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  if (stick.active && e.pointerId !== stick.id) { wave(); return; } // a second finger waves
  stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.x = e.clientX; stick.y = e.clientY; stick.active = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) { stick.x = e.clientX; stick.y = e.clientY; } });
const endStick = (e: PointerEvent): void => { if (e.pointerId === stick.id) { stick.active = false; stick.id = -1; } };
canvas.addEventListener('pointerup', endStick);
canvas.addEventListener('pointercancel', endStick);

function moveVector(): { x: number; y: number } {
  let x = 0; let y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  if (stick.active) {
    const dx = stick.x - stick.ox; const dy = stick.y - stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > 6) { const m = Math.min(1, len / 56); x += (dx / len) * m; y += (dy / len) * m; }
  }
  const len = Math.hypot(x, y);
  return len > 1 ? { x: x / len, y: y / len } : { x, y };
}

function wave(): void {
  const v = moveVector(); room.input({ ax: Math.round(v.x * 127), ay: Math.round(v.y * 127), wave: true });
}
const bumps = new Map<number, { at: number; dx: number; dy: number }>();
const pushes = new Map<number, number>();
const sparks: { x: number; y: number; vx: number; vy: number; at: number; life: number }[] = [];
let kickAt = -1e9;
function bumped(d: { slot: number; dx?: number; dy?: number; by?: number }, at: { x: number; y: number }): void {
  const now = performance.now();
  const dx = Number(d.dx) || 0; const dy = Number(d.dy) || 0;
  bumps.set(d.slot, { at: now, dx, dy });
  const base = Math.atan2(dy, dx);
  for (let i = 0; i < T.sparks; i += 1) {
    const a = base + (lab.random() - 0.5) * 1.6;
    const v = 420 + lab.random() * 520;
    sparks.push({ x: at.x - dx * R_AV * 0.6, y: at.y - dy * R_AV * 0.6, vx: Math.cos(a) * v, vy: Math.sin(a) * v, at: now, life: 170 + lab.random() * 170 });
  }
  if (sparks.length > 160) sparks.splice(0, sparks.length - 160);
  // The camera kicks for whoever was in it: the body bumped, or the one who waved.
  const mine = [...drawn.values()].find((x) => x.seat === net.seat)?.slot;
  if (mine !== undefined && (d.slot === mine || d.by === mine)) kickAt = now;
}
/** A body's look this frame: offset, stretch along an angle, and how white it flashes. */
function bodyFx(slot: number, t: number): { ox: number; oy: number; sx: number; sy: number; ang: number; flash: number } {
  const out = { ox: 0, oy: 0, sx: 1, sy: 1, ang: 0, flash: 0 };
  const p = pushes.get(slot);
  if (p !== undefined) { const u = (t - p) / 170; if (u >= 0 && u < 1) { const k = 0.14 * Math.sin(Math.PI * u); out.sx = 1 + k; out.sy = 1 + k; } }
  const b = bumps.get(slot);
  if (!b) return out;
  const age = t - b.at;
  const hs = T.hitStopMs; const end = hs + T.knockMs;
  if (age > end + T.settleMs + 200) { bumps.delete(slot); return out; }
  out.ang = Math.atan2(b.dy, b.dx);
  out.flash = T.flashMs > 0 ? Math.max(0, 1 - age / T.flashMs) : 0;
  let k = 0;
  if (age < hs) { k = -T.squash * 0.45; out.ox = Math.sin(age * 0.9) * 3; out.oy = Math.cos(age * 1.3) * 3; }
  else if (age < end) k = T.squash * (1 - (age - hs) / T.knockMs) ** Math.max(0, T.knockEase - 1);
  else if (T.settleMs > 0 && age < end + T.settleMs) { const w = (age - end) / T.settleMs; k = -T.squash * 0.8 * Math.exp(-3 * w) * Math.sin(2.5 * Math.PI * w); }
  out.sx *= 1 + k; out.sy *= 1 / (1 + k);
  return out;
}
function drawSparks(t: number, scale: number): void {
  ctx.lineCap = 'round';
  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const sp = sparks[i] as (typeof sparks)[number];
    const age = t - sp.at;
    if (age > sp.life) { sparks.splice(i, 1); continue; }
    if (age < T.hitStopMs * 0.5) continue;
    const u = age / sp.life; const s = age / 1000 * (1 - u * 0.5);
    const x = sp.x + sp.vx * s; const y = sp.y + sp.vy * s;
    ctx.strokeStyle = u < 0.4 ? '#ffffff' : '#ffd166'; ctx.globalAlpha = 1 - u; ctx.lineWidth = (2.5 + 4 * (1 - u)) / Math.max(0.5, scale);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - sp.vx * 0.022 * (1 - u), y - sp.vy * 0.022 * (1 - u)); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.lineCap = 'butt';
}

type Pose = { x: number; y: number; sx?: number; sy?: number; a?: number };
const subject = { slot: -1, at: 0, x0: 0, y0: 0, px: 0, py: 0, has: false };
function subjectAt(): Pose | null { return subject.has ? drawn.get(subject.slot) ?? null : null; }
function labReport(dt: number): void {
  const at = subjectAt();
  if (!at || dt <= 0) { lab.phase(null); return; }
  const age = net.now() - subject.at;
  lab.track('speed', Math.hypot(at.x - subject.px, at.y - subject.py) / dt, 'px/s');
  lab.track('distance', Math.hypot(at.x - subject.x0, at.y - subject.y0), 'px');
  subject.px = at.x; subject.py = at.y;
  const fx = bodyFx(subject.slot, performance.now());
  lab.track('stretch', (fx.sx - 1) * 100, '%');
  if (age < T.hitStopMs) lab.phase('HIT-STOP', 'The hit lands: hold, flash, squash');
  else if (age < T.hitStopMs + T.knockMs * 0.3) lab.phase('LAUNCH', 'Leaves fast, stretched along the hit');
  else if (age < T.hitStopMs + T.knockMs) lab.phase('SLIDE', 'Eases into the stop: no creep, no pop');
  else if (age < T.hitStopMs + T.knockMs + T.settleMs) lab.phase('SETTLE', 'Squash on the stop, overlap on the way out');
  else lab.phase(null);
  lab.pose('subject', { x: at.x, y: at.y, sx: fx.sx, sy: fx.sy, a: fx.ang });
}
/** The lab's views: the game's own camera, close on the knock, the whole arena. */
const labView = lab.camera<{ zoom?: number; whole?: boolean } | null>({ game: null, close: { zoom: 2.4 }, arena: { whole: true } });
lab.overlay('onion', (c, k) => {
  const g = c as CanvasRenderingContext2D; const s = Number(k) || 1;
  const ghosts = lab.past<Pose>('subject', 8, 3);
  ghosts.forEach((p, i) => { g.globalAlpha = 0.5 * (1 - i / ghosts.length); g.strokeStyle = '#ffad3b'; g.lineWidth = 2 / s; g.beginPath(); g.ellipse(p.x, p.y, R_AV * (p.sx ?? 1), R_AV * (p.sy ?? 1), p.a ?? 0, 0, Math.PI * 2); g.stroke(); });
  g.globalAlpha = 1;
});
lab.overlay('arcs', (c, k) => {
  const g = c as CanvasRenderingContext2D; const s = Number(k) || 1;
  const pts = lab.past<Pose>('subject', 90, 1);
  if (pts.length < 2) return;
  g.strokeStyle = 'rgba(124,196,255,.55)'; g.lineWidth = 1.5 / s;
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
  g.fillStyle = '#7cc4ff';
  for (const p of pts) { g.beginPath(); g.arc(p.x, p.y, 2.5 / s, 0, Math.PI * 2); g.fill(); }
});
lab.overlay('reach', (c, k) => {
  if (!me.has) return;
  const g = c as CanvasRenderingContext2D; const s = Number(k) || 1;
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.5 / s; g.setLineDash([8 / s, 6 / s]);
  g.beginPath(); g.arc(me.x, me.y, T.knockRange, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
});

/* ------------------------------------------------------------------ draw */
let dpr = 1;
function resize(): void {
  dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

const cam = { x: W / 2, y: H / 2, scale: 0 };
const labels = createLabels({ screen: () => ({ w: innerWidth, h: innerHeight }) });
// Room chat (NETPLAY.md section 19): what a player says in the room's chat (the play page's Chat, or a quick line) shows
// over their body for a few seconds, when they want it there. The studio taking a message down takes its bubble too.
const bubbles = createBubbles({ measure: (t) => { ctx.font = BUBBLE_FONT; return ctx.measureText(t).width; }, screen: () => ({ w: innerWidth, h: innerHeight }) });
net.on('say', (s) => bubbles.say(s.seat, s.text, { id: s.id, kind: s.kind }));
net.on('unchat', (e) => { for (const id of e.ids) bubbles.remove(id); });
let shownBubbles: BubbleOut[] = [];
let shownLabels: LabelOut[] = [];
let lastDraw = 0;
/** Where a seat's body is drawn now (host: the real body; replica: interpolated), or null. */
function seatPos(seat: number): { x: number; y: number } | null {
  if (seat === mySeat() && me.has && !net.watching) return me;
  const d = [...drawn.values()].find((x) => x.seat === seat);
  return d ? { x: d.x, y: d.y } : null;
}
const gemGlow = (() => {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R_GEM * 2.8);
  g.addColorStop(0, 'rgba(255,209,102,0.55)'); g.addColorStop(0.4, 'rgba(255,170,60,0.18)'); g.addColorStop(1, 'rgba(255,150,40,0)');
  return g;
})();
function draw(t: number): void {
  const cw = innerWidth; const ch = innerHeight;
  const phone = Math.min(cw, ch) <= 540;
  // The view: my own body, or (a watcher) the followed player's, drawn exactly as their own browser frames it.
  const view = viewSeat();
  const followed = net.watching && view !== null ? seatPos(view) : null;
  const overview = net.watching ? !followed : mySeat() === null;
  // The camera: close on the body whose view this is, never past the arena's edge (except as far as it takes to keep
  // that body clear of the HUD), and never so far out that an empty band shows beside the arena (held upright, a
  // phone showed the arena as a band with a third of the screen dark below or above it; now the arena fills the
  // screen). Following nobody: the whole arena.
  const focus = net.watching ? followed : overview || !me.has ? null : me;
  // The Game Lab's views (outside the lab: the game's own camera, always).
  const lv = labView();
  const want = overview || lv?.whole ? { scale: Math.min(cw / (W + 80), ch / (H + 80)), x: W / 2, y: H / 2 }
    : fitView({ world: { w: W, h: H }, screen: { w: cw, h: ch }, readable: 0, zoom: (Math.min(cw, ch) / (phone ? 560 : 820)) * (lv?.zoom ?? 1), focus: lv?.zoom ? subjectAt() ?? focus : focus, inset: { top: 52, bottom: 36 } });
  // A watcher's switch glides: the zoom and the pan ease over a few frames, never a cut.
  cam.scale = cam.scale ? cam.scale + (want.scale - cam.scale) * 0.12 : want.scale;
  const scale = cam.scale;
  cam.x += (want.x - cam.x) * 0.2; cam.y += (want.y - cam.y) * 0.2;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.8);
  bg.addColorStop(0, '#0d1426'); bg.addColorStop(1, '#04060c');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);

  // The camera's kick (a bump you were in): a few px, gone in a fifth of a second.
  const kick = t - kickAt < 200 ? T.shake * (1 - (t - kickAt) / 200) ** 2 : 0;
  ctx.save();
  ctx.translate(cw / 2 + (kick ? (lab.random() - 0.5) * 2 * kick : 0), ch / 2 + (kick ? (lab.random() - 0.5) * 2 * kick : 0)); ctx.scale(scale, scale); ctx.translate(-cam.x, -cam.y);
  // arena
  ctx.strokeStyle = 'rgba(125,240,255,0.07)'; ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += 100) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(125,240,255,0.55)'; ctx.lineWidth = 4; ctx.strokeRect(0, 0, W, H);
  // hot zone (keyed state): gems inside score double
  if (zone) {
    const pulse = 0.5 + 0.5 * Math.sin(t / 300);
    ctx.fillStyle = `rgba(255,120,190,${0.06 + 0.05 * pulse})`; ctx.beginPath(); ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,140,200,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([14, 10]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,170,215,0.85)'; ctx.font = '700 16px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('×2', zone.x, zone.y + 6);
  }

  // gems
  const gemList: { x: number; y: number; id: number }[] = gems;
  for (const g of gemList) {
    const spin = t / 500 + g.id;
    const r = R_GEM * (1 + 0.12 * Math.sin(t / 200 + g.id));
    ctx.save(); ctx.translate(g.x, g.y);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = gemGlow; ctx.beginPath(); ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.rotate(spin);
    ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.8, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.8, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // waves
  for (let i = waves.length - 1; i >= 0; i -= 1) {
    const w = waves[i] as (typeof waves)[number];
    const age = (t - w.at) / T.ringMs;
    if (age > 1) { waves.splice(i, 1); continue; }
    ctx.strokeStyle = w.colour; ctx.globalAlpha = 1 - age; ctx.lineWidth = w.knock ? 3 : 5;
    ctx.beginPath(); ctx.arc(w.x, w.y, w.knock ? R_AV + 6 + age * 40 : R_AV + age * (T.knockRange + 10), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }

  // avatars
  const names = new Map<number, Slot>((net.slots ?? []).map((s) => [s.slot, s]));
  // `mine`: the body whose view this is: my own, or the player a watcher follows (named, never "You").
  const list: { slot: number; seat: number | null; x: number; y: number; bot: boolean; name: string; mine: boolean }[] = [];
  const isView = (seat: number | null, bot: boolean): boolean => !bot && seat !== null && seat === view;
    for (const d of drawn.values()) {
      const own = !net.watching && d.seat >= 0 && d.seat === net.seat;
      const s = names.get(d.slot);
      list.push({ slot: d.slot, seat: d.seat >= 0 ? d.seat : null, x: own && me.has ? me.x : d.x, y: own && me.has ? me.y : d.y, bot: d.seat < 0, name: s?.name ?? (d.seat >= 0 ? `Player ${d.seat + 1}` : botName(d.slot)), mine: isView(d.seat >= 0 ? d.seat : null, d.seat < 0) });
    }
  // Names go on after the arena, on the screen, so they read at one size on any screen and never pile up.
  const fs = Math.round(Math.max(15, Math.min(22, (15 * Math.min(cw, ch)) / 720)));
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  const tags: LabelIn[] = [];
  const heads = new Map<number, { x: number; y: number; seat: number; mine: boolean }>();
  const viewAt = list.find((a) => a.mine) ?? null;
  for (const a of list) {
    const colour = colourOf(a.slot, a.bot ? null : a.seat);
    const fx = bodyFx(a.slot, t);
    ctx.save();
    ctx.translate(a.x + fx.ox, a.y + fx.oy); ctx.rotate(fx.ang); ctx.scale(fx.sx, fx.sy); ctx.rotate(-fx.ang);
    ctx.globalAlpha = a.bot ? 0.62 : 1;
    ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(0, 0, R_AV, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(0, 0, R_AV * 0.45, 0, Math.PI * 2); ctx.fill();
    if (fx.flash > 0) { ctx.globalAlpha = fx.flash; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, R_AV, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    if (a.mine) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(a.x, a.y, R_AV + 7, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
    const text = a.mine && !net.watching ? 'You' : label(a.name, a.bot);
    const sx = cw / 2 + (a.x - cam.x) * scale; const sy = ch / 2 + (a.y - cam.y) * scale; const r = (R_AV + (a.mine ? 7 : 0)) * scale;
    if (sx + r < 0 || sx - r > cw || sy + r < 0 || sy - r > ch) continue; // off screen: no name at the edge
    if (a.seat !== null && !a.bot) heads.set(a.slot, { x: sx, y: sy - r - 5, seat: a.seat, mine: a.mine });
    // People before bots, nearer the view's body first; each keeps off the others' bodies when it can.
    tags.push({ key: a.slot, text, x: sx, y: sy - r - 5, w: ctx.measureText(text).width, h: fs * 1.2, below: sy + r + 4 + fs * 1.2, body: { left: sx - r, top: sy - r, right: sx + r, bottom: sy + r }, self: a.mine, rank: (a.bot ? 10_000 : 0) + (viewAt ? Math.hypot(a.x - viewAt.x, a.y - viewAt.y) : 0) });
  }
  drawSparks(t, scale);
  lab.draw(ctx, scale);
  ctx.restore();
  shownLabels = labels.place(tags, Math.min(0.1, (t - (lastDraw || t)) / 1000));
  lastDraw = t;
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const l of [...shownLabels].sort((x, y) => Number(Boolean(x.self)) - Number(Boolean(y.self)))) {
    if (l.alpha <= 0) continue;
    ctx.globalAlpha = l.alpha;
    if (l.moved) {
      // Off its own spot: a thin line to its body says whose it is.
      const under = l.top > l.y;
      ctx.strokeStyle = 'rgba(232,236,245,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(l.cx, under ? l.top : l.bottom); ctx.lineTo(l.x, under ? (l.body?.bottom ?? l.top - 6) : l.y + 2); ctx.stroke();
    }
    if (l.self) { ctx.fillStyle = 'rgba(6,10,20,0.7)'; ctx.beginPath(); ctx.roundRect(l.left - 5, l.top - 1, l.right - l.left + 10, l.bottom - l.top + 2, 6); ctx.fill(); }
    else { ctx.strokeStyle = 'rgba(4,6,12,0.85)'; ctx.lineWidth = 3; ctx.strokeText(l.text, l.cx, l.cy); }
    ctx.fillStyle = l.self ? '#ffffff' : 'rgba(232,236,245,0.85)';
    ctx.fillText(l.text, l.cx, l.cy);
  }
  ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
  // Speech bubbles (room chat): over each speaker's name, the view's own player first.
  if (bubbles.size) {
    const anchors: BubbleIn[] = [];
    for (const [slot, h] of heads) {
      const l = shownLabels.find((x) => x.key === slot && x.alpha > 0 && !x.moved);
      anchors.push({ key: h.seat, x: l ? l.cx : h.x, y: l ? l.top - 1 : h.y, self: h.mine });
    }
    shownBubbles = bubbles.place(anchors);
    paintBubbles(ctx, shownBubbles);
  } else shownBubbles = [];

  hud(cw, ch, phone, list);
  if (stick.active) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(stick.ox, stick.oy, 56, 0, Math.PI * 2); ctx.stroke();
    const dx = stick.x - stick.ox; const dy = stick.y - stick.oy; const len = Math.hypot(dx, dy); const m = len > 56 ? 56 / len : 1;
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(stick.ox + dx * m, stick.oy + dy * m, 24, 0, Math.PI * 2); ctx.fill();
  }
}

function hud(cw: number, ch: number, phone: boolean, list: { slot: number; name: string; bot: boolean; mine: boolean }[]): void {
  const pad = phone ? 14 : 20;
  const debugStrip = new URLSearchParams(location.search).get('debug') === '1' || (window as unknown as { HOMIE_NET?: { debug?: boolean } }).HOMIE_NET?.debug;
  const top = pad + (debugStrip ? (phone ? 50 : 26) : 0);
  const now = net.now();
  const r = round;
  ctx.textAlign = 'left'; ctx.fillStyle = '#e8ecf5';
  ctx.font = `700 ${phone ? 20 : 24}px ui-sans-serif, system-ui, sans-serif`;
  const left = r ? Math.max(0, Math.ceil((r.endsAt - now) / 1000)) : 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  ctx.fillText(r ? (r.phase === 'live' ? `Round ${r.n} · ${clock}` : `Next round in ${left}`) : 'Joining…', pad, top + 18);
  // scores
  const scores = new Map<number, number>();
  for (const d of drawn.values()) scores.set(d.slot, d.score);
  const rows = [...list].sort((a, b) => (scores.get(b.slot) ?? 0) - (scores.get(a.slot) ?? 0)).slice(0, phone ? 4 : 6);
  ctx.font = `600 ${phone ? 14 : 16}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'right';
  // The play page's room button (and a server's pill beside it) sit at the top right (game.json screen.share's
  // default): the scores start under that band, so the buttons never cover a score.
  const board = top + 18 + 44;
  rows.forEach((a, i) => {
    ctx.fillStyle = a.mine ? '#ffffff' : a.bot ? 'rgba(232,236,245,0.55)' : 'rgba(232,236,245,0.85)';
    ctx.fillText(`${a.mine && !net.watching ? 'You' : label(a.name, a.bot)}  ${scores.get(a.slot) ?? 0}`, cw - pad, board + i * (phone ? 20 : 22));
  });
  // role badge
  ctx.textAlign = 'left'; ctx.font = '600 11px ui-monospace, Menlo, monospace'; ctx.fillStyle = 'rgba(125,240,255,0.7)';
  ctx.fillText(net.offline ? 'OFFLINE HOST' : net.watching ? 'WATCHING' : net.role.toUpperCase(), pad, ch - pad);
  if (r && r.phase === 'over' && r.results) {
    const w = Math.min(360, cw - 40); const h = 44 + Math.min(6, r.results.length) * 26;
    const x = (cw - w) / 2; const y = (ch - h) / 2;
    ctx.fillStyle = 'rgba(6,10,20,0.86)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(125,240,255,0.5)'; ctx.strokeRect(x, y, w, h);
    ctx.textAlign = 'center'; ctx.fillStyle = '#7df0ff'; ctx.font = '700 18px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`Round ${r.n} results`, cw / 2, y + 28);
    ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
    const view = viewSeat();
    r.results.slice(0, 6).forEach((row, i) => {
      const mine = !row.bot && row.seat !== null && row.seat === view;
      ctx.fillStyle = mine ? '#ffffff' : row.bot ? 'rgba(232,236,245,0.6)' : '#e8ecf5';
      ctx.fillText(`${row.place}. ${mine && !net.watching ? 'You' : label(row.name, row.bot)}${mine && net.watching ? ' ◂' : ''} — ${row.score}`, cw / 2, y + 56 + i * 26);
    });
  }
  // Only a browser that WAS in its room is reconnecting; one still joining, or stopped for good, is not (section 22).
  if (net.link === 'reconnecting' && net.role !== 'host') {
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffd166'; ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('Reconnecting…', cw / 2, ch - pad);
  }
  if (frames < 240 && mySeat() !== null) {
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(232,236,245,0.7)'; ctx.font = '500 14px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(phone ? 'Drag to move · second finger bumps' : 'WASD / arrows to move · Space bumps', cw / 2, ch - pad - 18);
  }
}

function frame(t: number): void {
  const dt = lab.time.dt(t, 0.05);
  updateView();
  if (lab.on) labReport(dt);
  draw(t); frames++; requestAnimationFrame(frame);
}
room.probe({ frames: () => frames, waves: () => wavesSeen, knocks: () => knocksSeen, zone: () => zone,
  camera: () => ({ ...cam, view: viewSeat() }),
  labels: () => shownLabels.map(l => ({ self: Boolean(l.self), alpha: l.alpha, moved: l.moved, left: Math.round(l.left), top: Math.round(l.top), right: Math.round(l.right), bottom: Math.round(l.bottom) })),
  bubbles: () => shownBubbles.map(b => ({ seat: b.key, text: b.lines.join(' '), alpha: b.alpha })) });
requestAnimationFrame(frame);
