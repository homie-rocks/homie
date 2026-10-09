/** Hero Rush 3D: server rules, predicted jumps, and the original meadow and heroes. */
import {
  AmbientLight, Box3, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, CylinderGeometry,
  DodecahedronGeometry, IcosahedronGeometry,
  DirectionalLight, DoubleSide, DynamicDrawUsage, Euler, ExtrudeGeometry, Fog, Group, HemisphereLight, InstancedMesh, LineBasicMaterial,
  LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, NoToneMapping, Object3D, Path,
  PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Quaternion, RingGeometry, Scene, Shape, SRGBColorSpace, Vector3, WebGLRenderer,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
// The one model loader every studio game uses: checks each file, decodes meshopt and WebP, copies for placing.
import { createModels, instancedCopies, placeCopy, repaint, stylize, type Copies } from '@homie-rocks/studio/assets';
// Characters that move well: clips from the skeleton's clip library, blended, layered and tuned (Game Lab tunables).
import { crowd, loadCharacter, type Character } from '@homie-rocks/studio/animate';
import { guardGestures, PALETTE, AI_MARK, type RoundInfo, type Slot } from '@homie-rocks/studio/netplay';
// The port toolkit: its probe (what `homie-studio port check` and `perf` read, and sandbox + audio shims), and name
// labels that never pile up (port/view.ts).
import { createBubbles, createLabels, exposePort, paintBubbles, type BubbleIn, type BubbleOut, type LabelIn, type LabelOut } from '@homie-rocks/studio/port';
// The Game Lab: tunables, phases, tracks and overlays (no-ops outside the lab).
import { lab } from '@homie-rocks/studio/lab';
import { openRoom, type Entity } from '@homie-rocks/studio/rules/view';
import type rules from './rules';
const room = openRoom<typeof rules>({ net: { game: 'hero-rush-3d', arrival: 'game' } });
const net = room.net;
guardGestures({ touch: 'canvas' });
import styleFile from '../style.json';
import gameFile from '../game.json';

const W = 26;
const H = 16;
const R_AV = 0.44;
/**
 * The clearing's own features, solid (rules coordinates, metres): bodies slide round them, gems never land in them.
 * Away from the middle row, where bodies start and the Game Lab stages its knock.
 */
const OBSTACLES: readonly { x: number; y: number; r: number; kind: 'camp' | 'bush' | 'rock' | 'stone' | 'tree' }[] = [
  // The clearing's heart: a campfire ring with log seats (a game makes it its den, its camp, its well).
  { x: 13.0, y: 4.0, r: 1.05, kind: 'camp' },
  { x: 4.6, y: 3.8, r: 0.75, kind: 'bush' }, { x: 21.4, y: 4.6, r: 0.55, kind: 'rock' }, { x: 6.0, y: 12.6, r: 0.5, kind: 'rock' },
  { x: 20.2, y: 12.2, r: 0.75, kind: 'bush' }, { x: 9.6, y: 13.4, r: 0.45, kind: 'stone' }, { x: 23.6, y: 2.0, r: 0.5, kind: 'tree' },
];
const R_GEM = 0.3;
const SPEED = 6.2;
const BOT_SPEED = 5;
const ROUND_MS = 60_000;
const BREAK_MS = 7_000;
const GEM_COUNT = 14;
const MIN_SLOTS = 3; // 1 human + 2 bots from the first frame
const MAX_SLOTS = 8;
/** The knock's numbers (tunables.json): the file's values, or the Game Lab's sliders while it plays a take. */
const T = room.tune as Record<string, number>;
const ZONE_MS = 12_000;
/** The contract's 12 colours (PALETTE, NETPLAY.md section 3): a person wears their seat's, so the watch page's strip matches. */
const colourOf = (slot: number, seat: number | null): string => PALETTE[(seat ?? slot) % PALETTE.length] as string;
const BOT_NAMES = ['Rook', 'Vex', 'Moth', 'Kilo', 'Juno', 'Pike', 'Nyx', 'Ash'];
const botName = (slot: number): string => BOT_NAMES[slot % BOT_NAMES.length] as string;
/** An AI's name already ends in " · AI" (the relay sees to it); a plain bot says bot. */
const label = (name: string, bot: boolean): string => (name.endsWith(AI_MARK) ? name : bot ? `${name} · bot` : name);

const jumpSpeed = (): number => 2 * T.jumpHeight / T.jumpRise;
const mySeat = (): number | null => room.seat;
const viewSeat = (): number | null => net.viewSeat;
const me = { x: 13, y: 8, h: 0, vh: 0, has: false };
const poses = new Map<number, Entity>();
const drawn = new Map<number, { x: number; y: number; h: number; seat: number; score: number; slot: number }>();
const waves: { x: number; y: number; at: number; colour: string; knock?: boolean; fa?: number; slot?: number }[] = [];
let wavesSeen = 0, knocksSeen = 0, frames = 0, jumpsSeen = 0, dodgesSeen = 0;
let firstStateAt = 0, firstSnapAt = 0;
let gems: { x: number; y: number; id: number }[] = [];
let round: RoundInfo | null = null;
let zone: { x: number; y: number; r: number } | null = null;
const slotOf = (e: Entity): number => e.kind === 'runner' ? e.seat ?? 0 : 0;
function updateView(): void {
  const v = moveVector(); room.input({ ax: Math.round(v.x * 127), ay: Math.round(v.y * 127) });
  const own = room.me; me.has = Boolean(own);
  if (own) { me.x = own.pos.x; me.y = own.pos.y; me.h = own.pos.z; me.vh = own.vel.z; }
  drawn.clear(); poses.clear(); room.each('runner', e => poses.set(slotOf(e), e));
  room.each('runner', e => drawn.set(slotOf(e), { slot: slotOf(e), seat: e.driver === 'bot' ? -1 : e.seat ?? -1, x: e.pos.x, y: e.pos.y, h: e.pos.z, score: Number(e.score) }));
  gems = []; room.each('gem', e => gems.push({ id: Number(e.serial), x: e.pos.x, y: e.pos.y }));
  const z = room.shared.zone as { x: number; y: number } | undefined;
  zone = z ? { x: z.x, y: z.y, r: 3 } : null;
  if (own && !firstSnapAt) firstSnapAt = performance.now();
  if (z && !firstStateAt) firstStateAt = performance.now();
  const r = room.round;
  round = r ? { ...r, startedAt: 0, endsAt: net.now() + r.secondsLeft * 1000 } : null;
}
function effect(name: 'swing' | 'knock', e: { id?: string; at?: { x: number; y: number } | null; dir?: { x: number; y: number }; by?: string }): void {
  const body = e.id ? room.get(e.id) : null;
  if (!body || body.kind !== 'runner' || !e.at) return;
  const slot = slotOf(body), at = { x: body.pos.x, y: body.pos.y }, now = performance.now();
  waves.push({ ...at, at: now, colour: name === 'knock' ? '#ffffff' : colourOf(slot, body.seat ?? null), knock: name === 'knock', slot, fa: e.dir ? Math.atan2(e.dir.x, e.dir.y) : 0 });
  if (name === 'swing') { net.spotlight(body.driver === 'person' ? body.seat ?? null : null); wavesSeen++; swung(slot); }
  else if (e.dir) {
    const by = e.by ? room.get(e.by) : null;
    knocksSeen++; bumped({ slot, dx: e.dir.x, dy: e.dir.y, by: by?.kind === 'runner' ? by.seat : undefined }, at);
    if (lab.on) Object.assign(subject, { slot, at: net.now(), x0: at.x, y0: at.y, px: at.x, py: at.y, has: true });
  }
}
room.on('swing', e => effect('swing', e));
room.on('knock', e => effect('knock', e));
room.on('jump', e => { const b = e.id ? room.get(e.id) : null; if (b) jumped(slotOf(b)); });
room.on('dodge', e => { const b = e.id ? room.get(e.id) : null; if (b) dodged(slotOf(b)); });
/* ----------------------------------------------------------------- input */
// The camera looks across the meadow from its near edge, square to it: screen right is +x and screen down is +y, so
// keys and the stick move a body exactly as in Gem Rush. Space jumps; F (or J, Enter, a click) swings. On a phone the
// first finger anywhere is the stick, and two buttons at the bottom right jump and swing (a second finger anywhere
// else swings too).
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyF', 'KeyJ', 'Enter'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' && !keys.has('Space')) jump();
  if (['KeyF', 'KeyJ', 'Enter'].includes(e.code) && !keys.has(e.code)) swing();
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0, active: false };
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hudCanvas = document.getElementById('hud') as HTMLCanvasElement;
const ctx = hudCanvas.getContext('2d') as CanvasRenderingContext2D;
/** The touch buttons (CSS px, set by the HUD each frame); shown once a finger has touched the screen. */
const buttons: { id: 'jump' | 'swing'; x: number; y: number; r: number; at: number }[] = [];
let touched = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } })();
const buttonAt = (x: number, y: number): (typeof buttons)[number] | null => buttons.find((b) => Math.hypot(x - b.x, y - b.y) <= b.r * 1.15) ?? null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') { if (e.button === 0) swing(); return; }
  touched = true;
  const b = buttonAt(e.clientX, e.clientY);
  if (b) { b.at = performance.now(); if (b.id === 'jump') jump(); else swing(); return; }
  if (stick.active && e.pointerId !== stick.id) { swing(); return; } // a second finger swings
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
  if (len > 1) { x /= len; y /= len; }
  const c = Math.cos(view3.yaw), s = Math.sin(view3.yaw);
  return { x: x * c + y * s, y: -x * s + y * c };
}

function jump(): void { const v = moveVector(); room.input({ ax: Math.round(v.x * 127), ay: Math.round(v.y * 127), jump: true }); }
function swing(): void { const v = moveVector(); room.input({ ax: Math.round(v.x * 127), ay: Math.round(v.y * 127), swing: true }); }
const bumps = new Map<number, { at: number; dx: number; dy: number }>();
const pushes = new Map<number, number>();
const sparks: { x: number; y: number; h: number; vx: number; vy: number; vh: number; at: number; life: number; gold?: boolean }[] = [];
let kickAt = -1e9;
function bumped(d: { slot: number; dx?: number; dy?: number; by?: number }, at: { x: number; y: number }): void {
  const now = performance.now();
  const dx = Number(d.dx) || 0; const dy = Number(d.dy) || 0;
  bumps.set(d.slot, { at: now, dx, dy });
  const base = Math.atan2(dy, dx);
  for (let i = 0; i < T.sparks; i += 1) {
    const a = base + (lab.random() - 0.5) * 1.6;
    const v = 8.4 + lab.random() * 10.4;
    sparks.push({ x: at.x - dx * R_AV * 0.6, y: at.y - dy * R_AV * 0.6, h: 0.45, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: 1 + lab.random() * 3, at: now, life: 170 + lab.random() * 170 });
  }
  if (sparks.length > 160) sparks.splice(0, sparks.length - 160);
  // The camera kicks for whoever was in it: the body bumped, or the one who waved.
  const mine = [...drawn.values()].find((x) => x.seat === net.seat)?.slot;
  if (mine !== undefined && (d.slot === mine || d.by === mine)) kickAt = now;
  const hero = heroes.get(d.slot)?.char;
  if (hero) hero.hit(dx, dy, 1);
}
/** A swing started: its hero plays its action (the mage casts, the rest strike). */
function swung(slot: number): void {
  const h = heroes.get(slot);
  if (!h?.char) return;
  h.char.act(h.char.has(HERO_ACTION[h.kind] ?? 'attack') ? (HERO_ACTION[h.kind] ?? 'attack') : 'attack', { from: T.swingSkip });
  labSwing(slot);
}
/** Count authoritative jumps; the clip starts with the drawn takeoff, including prediction. */
function jumped(slot: number): void {
  jumpsSeen += 1;
}
/** A swing passed under a jumper: a word pops over it. */
const pops: { slot: number; at: number; text: string }[] = [];
function dodged(slot: number): void {
  dodgesSeen += 1;
  pops.push({ slot, at: performance.now(), text: 'Dodged!' });
  if (pops.length > 12) pops.shift();
}
/** A gem taken: a little gold burst where it was (drawn on every screen from the gem list; the rules never see it). */
function sparkle(x: number, y: number): void {
  const now = performance.now();
  for (let i = 0; i < 7; i += 1) {
    const a = lab.random() * Math.PI * 2; const v = 1.5 + lab.random() * 2.5;
    sparks.push({ x, y, h: 0.35, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: 3 + lab.random() * 3, at: now, life: 260 + lab.random() * 200, gold: true });
  }
  if (sparks.length > 160) sparks.splice(0, sparks.length - 160);
}
/**
 * A body's look this frame: offset (m), stretch along the hit (sx) and across it (sy), height (up), the hit's angle
 * on the ground, and how white it flashes.
 */
function bodyFx(slot: number, t: number): { ox: number; oy: number; sx: number; sy: number; up: number; ang: number; flash: number } {
  const out = { ox: 0, oy: 0, sx: 1, sy: 1, up: 1, ang: 0, flash: 0 };
  const p = pushes.get(slot);
  if (p !== undefined) { const u = (t - p) / 170; if (u >= 0 && u < 1) { const k = 0.14 * Math.sin(Math.PI * u); out.sx = 1 + k; out.sy = 1 + k; out.up = 1 + k; } }
  const b = bumps.get(slot);
  if (!b) return out;
  const age = t - b.at;
  const hs = T.hitStopMs; const end = hs + T.knockMs;
  if (age > end + T.settleMs + 200) { bumps.delete(slot); return out; }
  out.ang = Math.atan2(b.dy, b.dx);
  out.flash = T.flashMs > 0 ? Math.max(0, 1 - age / T.flashMs) : 0;
  let k = 0;
  if (age < hs) { k = -T.squash * 0.45; out.ox = Math.sin(age * 0.9) * 0.06; out.oy = Math.cos(age * 1.3) * 0.06; }
  else if (age < end) k = T.squash * (1 - (age - hs) / T.knockMs) ** Math.max(0, T.knockEase - 1);
  else if (T.settleMs > 0 && age < end + T.settleMs) { const w = (age - end) / T.settleMs; k = -T.squash * 0.8 * Math.exp(-3 * w) * Math.sin(2.5 * Math.PI * w); }
  out.sx *= 1 + k; out.sy *= 1 / (1 + k); out.up *= 1 / Math.sqrt(Math.max(0.2, 1 + k));
  return out;
}

type Pose = { x: number; y: number; sx?: number; sy?: number; a?: number };
const subject = { slot: -1, at: 0, x0: 0, y0: 0, px: 0, py: 0, has: false };
const swinger = { slot: -1, at: 0 };
function labSwing(slot: number): void { if (lab.on) { swinger.slot = slot; swinger.at = net.now(); } }
function subjectAt(): Pose | null { return subject.has ? drawn.get(subject.slot) ?? null : null; }
let apex = 0;
function labReport(dt: number): void {
  if (dt <= 0) return;
  if (lab.stage === 'jump') {
    const hero = [...heroes.values()].find((x) => x.mine)?.char ?? null;
    lab.track('height', me.h, 'm');
    lab.track('stretch', hero ? (hero.root.children[0]?.scale.y ?? 1) * 100 - 100 : 0, '%');
    if (room.me?.grounded) { lab.phase(hero?.state === 'LAND' ? 'LAND' : null, 'Squash on touch-down, then back to the run'); apex = 0; }
    else if (me.vh > jumpSpeed() * 0.55) lab.phase('TAKE-OFF', 'Leaves fast and stretched');
    else if (me.vh > jumpSpeed() * 0.15) lab.phase('RISE', 'Slows as it climbs');
    else if (me.vh > -jumpSpeed() * 0.25) { lab.phase('HANG', 'A moment at the top to read it'); apex = Math.max(apex, me.h); }
    else lab.phase('FALL', `Down ${T.fallFaster.toFixed(1)}x harder than up: weight`);
    lab.pose('subject', { x: me.x, y: me.y - me.h, sx: 1, sy: 1, a: 0 });
    return;
  }
  const at = subjectAt();
  const sinceSwing = net.now() - swinger.at;
  if (swinger.slot >= 0 && sinceSwing < T.windupMs && (!at || net.now() - subject.at > T.hitStopMs + T.knockMs + T.settleMs)) {
    lab.phase('WINDUP', 'The swing gathers: what you see before it lands');
    lab.track('speed', 0, 'm/s');
    return;
  }
  if (!at) { lab.phase(null); return; }
  const age = net.now() - subject.at;
  lab.track('speed', Math.hypot(at.x - subject.px, at.y - subject.py) / dt, 'm/s');
  lab.track('distance', Math.hypot(at.x - subject.x0, at.y - subject.y0), 'm');
  subject.px = at.x; subject.py = at.y;
  const fx = bodyFx(subject.slot, performance.now());
  lab.track('stretch', (fx.sx - 1) * 100, '%');
  if (age < T.hitStopMs) lab.phase('HIT-STOP', 'The hit lands: hold, flash, flinch');
  else if (age < T.hitStopMs + T.knockMs * 0.3) lab.phase('LAUNCH', 'Leaves fast, stretched along the hit');
  else if (age < T.hitStopMs + T.knockMs) lab.phase('SLIDE', 'Eases into the stop: no creep, no pop');
  else if (age < T.hitStopMs + T.knockMs + T.settleMs) lab.phase('SETTLE', 'Squash on the stop, overlap on the way out');
  else lab.phase(null);
  lab.pose('subject', { x: at.x, y: at.y, sx: fx.sx, sy: fx.sy, a: fx.ang });
}
/** The lab's views: the game's own camera, close on the action, the whole arena. */
const labView = lab.camera<{ zoom?: number; whole?: boolean } | null>({ game: null, close: { zoom: 2.4 }, arena: { whole: true } });

/* ================================================================== THE LOOK */

/* ------------------------------------------------------------------ style.json */
interface StyleTokens {
  palette: { bg: string; ink: string; accent: string; accent2: string; danger: string; good: string; gold: string; ramp?: string[] };
  fonts?: { display?: string; body?: string } | null;
  light?: { time?: string; key?: number[]; intensity?: number; hardness?: number; sky?: string; ground?: string; fog?: number } | null;
  camera?: { pitch?: number; distance?: number; fov?: number } | null;
  render?: string;
  materials?: { model?: string; outline?: boolean } | null;
}
const STYLE = styleFile as unknown as StyleTokens & { materials?: { model?: string; outline?: boolean } };
/**
 * How the room scores (game.json "scoring"): "rivals" (the default: a ranking, a winner) or "together" (one total the
 * whole room fills, each player's share shown without places: a cozy game's room works as one). The rules are the
 * same; only what the HUD and the results card say changes.
 */
const TOGETHER = (gameFile as { scoring?: string }).scoring === 'together';
const PAL = STYLE.palette;
const LIGHT = { key: [-0.5, -1, -0.35], intensity: 2.2, hardness: 0.35, sky: PAL.bg, ground: PAL.accent2, fog: 0.35, ...(STYLE.light ?? {}) };
const CAM = { pitch: 52, distance: 22, fov: 38, ...(STYLE.camera ?? {}) };
/** Two colours mixed in sRGB (k = 0: a, 1: b), as a hex string. */
function mixHex(a: string, b: string, k: number): string {
  const pa = new Color(a).getHex(); const pb = new Color(b).getHex();
  const ch = (v: number, s: number): number => (v >> s) & 255;
  const m = (s: number): number => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * k);
  return `#${((m(16) << 16) | (m(8) << 8) | m(0)).toString(16).padStart(6, '0')}`;
}
/** sRGB luminance, 0 to 1. */
function lumOf(hex: string): number { const c = new Color(hex).getHex(); return (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255; }
/**
 * The HUD's paper and its text: the palette's light colour as paper (cream cards, like the title card) and its dark
 * one as text, whichever way round the palette has them, so every chip and card reads and they are one UI.
 */
const PAPER = lumOf(PAL.ink) >= lumOf(PAL.bg) ? PAL.ink : PAL.bg;
const TEXT = lumOf(PAL.ink) >= lumOf(PAL.bg) ? mixHex(PAL.bg, '#000000', 0.25) : PAL.ink;
const HOT = lumOf(PAL.accent) > 0.62 ? mixHex(PAL.accent, TEXT, 0.35) : PAL.accent;
/** A night light (style.json light.time): the grass goes dark with it. */
const NIGHT = LIGHT.time === 'night';
/** The world's own colours, all from the palette: so a new style.json repaints everything the code draws. */
const COL = {
  sky: LIGHT.sky ?? PAL.bg,
  // The ground of the style board when the light names one (a night grove is dark grass), else the palette's greens.
  // Grass is the palette's greens, a little shaded, tinted by the light's ground colour (a night grove is darker, a
  // golden hour warmer): never the light's ground alone, which can be mud.
  meadow: mixHex(mixHex(mixHex(PAL.good, PAL.accent2, 0.55), PAL.bg, NIGHT ? 0.55 : 0.08), STYLE.light?.ground ?? PAL.accent2, NIGHT ? 0.3 : 0.06),
  meadowSpot: mixHex(mixHex(mixHex(PAL.good, PAL.accent2, 0.55), NIGHT ? PAL.bg : PAL.gold, NIGHT ? 0.45 : 0.14), STYLE.light?.ground ?? PAL.accent2, NIGHT ? 0.25 : 0.1),
  floor: mixHex(mixHex(mixHex(PAL.good, PAL.accent2, 0.4), NIGHT ? PAL.bg : PAL.gold, NIGHT ? 0.45 : 0.12), STYLE.light?.ground ?? PAL.good, STYLE.light?.ground ? 0.2 : 0),
  floorStripe: mixHex(mixHex(mixHex(mixHex(PAL.good, PAL.accent2, 0.4), NIGHT ? PAL.bg : PAL.gold, NIGHT ? 0.45 : 0.12), STYLE.light?.ground ?? PAL.good, STYLE.light?.ground ? 0.2 : 0), PAL.bg, 0.08),
  // The arena's edge: a worn earth-and-moss path, a step from the grass, never a painted stripe.
  path: mixHex(mixHex(PAL.good, PAL.accent2, 0.5), mixHex(PAL.accent, PAL.ink, 0.55), 0.38),
  shadow: mixHex(PAL.ink, PAL.accent2, 0.25),
  zone: PAL.accent,
  gem: PAL.gold,
};
const fontStack = (f: string | undefined, rest: string): string => (f && /^[A-Za-z0-9 ]{1,40}$/.test(f) ? `"${f}", ${rest}` : rest);
const FONT_DISPLAY = fontStack(STYLE.fonts?.display, 'ui-rounded, system-ui, sans-serif');
const FONT_BODY = fontStack(STYLE.fonts?.body, 'ui-rounded, system-ui, sans-serif');
/**
 * style.json's fonts are Google Fonts (OFL): asked for once, without waiting. Until they arrive (or if they never do,
 * offline or blocked) the HUD draws in the system's rounded face; nothing in a round waits on a font.
 */
function loadFonts(): void {
  const fams = [STYLE.fonts?.display, STYLE.fonts?.body].filter((f): f is string => typeof f === 'string' && /^[A-Za-z0-9 ]{1,40}$/.test(f));
  if (!fams.length) return;
  try {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?${[...new Set(fams)].map((f) => `family=${f.replace(/ /g, '+')}:wght@600;700`).join('&')}&display=swap`;
    document.head.appendChild(l);
  } catch { /* the system's face, then */ }
}
loadFonts();

/* ------------------------------------------------------------------ the characters, asked for first */
/*
 * THE CHARACTERS, your own first: the play page's arrival card waits for your own hero's real model (THE ARRIVAL,
 * below), and your seat (so your hero's kind) is known at the welcome, so the moment it comes your own hero is asked for
 * alone, followed by its skeleton's clip library; then the other heroes. The bots' skeletons (drawn as stand-ins until
 * they are in) come after the heroes, or after 4 s at most, so on a slow phone they never share the line with your own
 * hero. A watcher asks for every hero at once. About 0.67 MB for the heroes and their clips, 0.47 MB for the skeletons
 * and theirs, 0.15 MB for the meadow's props: the same files as ever, in this order.
 */
const models = createModels();
/**
 * The heroes people play (one a seat, in turn) and the skeletons bots play (one a slot): KayKit's adventurers and
 * skeletons, one rig family, so one clip library each and one look. Each is drawn HERO_M tall (`game new` made them so).
 */
const HEROES = ['knight', 'barbarian', 'mage', 'rogue', 'rogue-hooded'] as const;
const SKELETONS = ['skeleton-minion', 'skeleton-warrior', 'skeleton-rogue', 'skeleton-mage'] as const;
const HERO_BUDGET = { triangles: 8000, texturePx: 1024, materials: 2, bytes: 1536 * 1024 };
const heroUrl = (kind: string): string => `./models/${kind}.glb`;
/** Models that are not there (refused or missing): drawn as stand-ins. */
const standIns = new Set<string>();
/** THE ARRIVAL's progress line: the files asked for while the game loads, and how many have come (or failed). */
const loads = { all: 0, done: 0, heroes: 0, heroesDone: 0, said: 0 };
function sayLoading(): void {
  loads.said = Math.max(loads.said, loads.all ? loads.done / loads.all : 0);
  net.loading(loads.said, loads.heroesDone < loads.heroes ? 'the heroes' : 'the clearing');
}
/** One more file on the line (`hero`: a character or its clips); the function it returns says it came or failed. */
function expect(hero: boolean): () => void {
  loads.all += 1; if (hero) loads.heroes += 1;
  let settled = false;
  return () => { if (settled) return; settled = true; loads.done += 1; if (hero) loads.heroesDone += 1; sayLoading(); };
}
function track<T>(p: Promise<T>, hero: boolean): Promise<T> { const done = expect(hero); p.then(done, done); return p; }
/** Each kind's model and its clip library, loaded once (loadCharacter finds both in hand); copies are made per body. */
const heroLoads = new Map<string, Promise<boolean>>();
const clipLoads = new Map<string, Promise<unknown>>();
let heroesIn = (): void => {};
const afterHeroes = new Promise<void>((done) => { heroesIn = done; setTimeout(done, 4000); });
function loadHero(kind: string): Promise<boolean> {
  let p = heroLoads.get(kind);
  if (!p) {
    const url = heroUrl(kind);
    const came = expect(true);
    const go = (): Promise<boolean> => models.load(url, { budget: HERO_BUDGET }).then((m) => {
      came();
      // Its skeleton's clip library at once (the model names it), at loadCharacter's own address and budget.
      const named = (m.scene.userData?.homie as { anims?: string } | undefined)?.anims;
      if (!named) return true;
      const href = new URL(named, new URL(url, location.href)).href;
      let clips = clipLoads.get(href);
      if (!clips) { clips = track(models.load(href, { budget: { triangles: 0, bytes: 3 * 1024 * 1024 } }), true).catch(() => null); clipLoads.set(href, clips); }
      return clips.then(() => true);
    }, () => { came(); standIns.add(url); return false; });
    p = (SKELETONS as readonly string[]).includes(kind) ? afterHeroes.then(go) : go();
    heroLoads.set(kind, p);
  }
  return p;
}
/** Every hero in (your own first, at the welcome): the skeletons wait for it, and so does the Game Lab. */
const allHeroes: Promise<boolean[]> = net.ready.then(() => {
  const seat = mySeat();
  const own = seat !== null && !net.watching ? (HEROES[seat % HEROES.length] as string) : null;
  return (own ? loadHero(own) : Promise.resolve(true)).then(() => Promise.all(HEROES.map(loadHero)));
});
void allHeroes.then(() => heroesIn());
sayLoading();
for (const k of SKELETONS) void loadHero(k);

/* ------------------------------------------------------------------ renderer, scene, light */
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// Flat low-poly colours read true without a film curve (the style board renders the same way).
renderer.toneMapping = NoToneMapping;
const scene = new Scene();
scene.background = new Color(COL.sky);
scene.fog = new Fog(COL.sky, 40, 90);
const camera = new PerspectiveCamera(CAM.fov, 1, 1, 320);
// The light of the style board (assets/render-page.ts): a sun along style.json's key, a sky-to-ground fill, a little ambient.
/*
 * Shadows: real ones on a computer (a sun's shadow map that follows the camera, as the style board draws them), soft
 * discs under things on a phone (the phone budgets: one less pass). Decided once, by the screen the game opens on.
 */
const REAL_SHADOWS = Math.min(innerWidth, innerHeight) > 540;
if (REAL_SHADOWS) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFSoftShadowMap; }
const SUN_DIR = new Vector3(-(LIGHT.key[0] ?? -0.5), -(LIGHT.key[1] ?? -1), -(LIGHT.key[2] ?? -0.35)).normalize();
let sun: DirectionalLight;
{
  const night = LIGHT.time === 'night';
  sun = new DirectionalLight(night ? mixHex(PAL.accent2, '#ffffff', 0.55) : LIGHT.time === 'golden' ? mixHex(PAL.gold, '#ffffff', 0.62) : '#ffffff', (LIGHT.intensity ?? 2.2) * 1.05);
  sun.position.copy(SUN_DIR).multiplyScalar(30);
  if (REAL_SHADOWS) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
    scene.add(sun.target);
  }
  scene.add(sun, new HemisphereLight(new Color(night ? mixHex(LIGHT.sky ?? PAL.bg, '#9fb4ff', 0.5) : LIGHT.sky), new Color(LIGHT.ground), night ? 1.6 : 1.3), new AmbientLight(0xffffff, night ? 0.35 : 0.25));
}
const XZ = (x: number, y: number): [number, number] => [x - W / 2, y - H / 2]; // rules (x, y) to three.js (x, z)
const EDGE = 0.55; // the path around the arena, metres
/**
 * A clearing (false: the meadow runs on, a ring of bushes and rocks marks the edge) or a fenced, mown pitch (true: the
 * fence, the striped lawn and the path round it). A cozy game is a clearing; a sport is a pitch.
 */
const FENCED = false;

/* ------------------------------------------------------------------ the meadow and the arena (procedural) */
/** A small seeded dice for the dressing: never Math.random (the world's dice, which the Game Lab keeps the same in both builds). */
function dice(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvasTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d') as CanvasRenderingContext2D);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}
/**
 * The ground is faceted low poly, like everything standing on it: every triangle its own shade of the palette's greens,
 * crisp at any distance (no blurred texture). Inside the arena it is flat and mown in broad stripes, so it reads as a
 * pitch; outside it rolls a little, more the farther it is. heightAt is the one place the ground's height comes from,
 * so the trees, rocks and shadows stand on it.
 */
const FLAT = EDGE + 5; // metres past the arena's edge that stay flat: the path, the fence, the flowers
function heightAt(x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x) - (W / 2 + FLAT)); const dz = Math.max(0, Math.abs(z) - (H / 2 + FLAT));
  const away = Math.min(1, Math.hypot(dx, dz) / 14);
  return away * 0.55 * (0.5 + 0.5 * Math.sin(x * 0.23 + z * 0.11) * Math.cos(z * 0.19 - x * 0.08));
}
/** A non-indexed triangle list, one colour per triangle (flat faces: each its own normal). */
function facets(tris: number[][], colours: string[]): BufferGeometry {
  const pos = new Float32Array(tris.length * 9); const col = new Float32Array(tris.length * 9); const c = new Color();
  tris.forEach((t, i) => { pos.set(t, i * 9); c.set(colours[i] as string); for (let k = 0; k < 3; k += 1) col.set([c.r, c.g, c.b], i * 9 + k * 3); });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3)); g.setAttribute('color', new BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
{
  // The meadow: a jittered 2.2 m grid, gently rolling away from the arena.
  const roll = dice(11);
  const cell = 2.2; const x0 = -110; const z0 = -120; const nx = 100; const nz = 82;
  const vx: number[] = []; const vz: number[] = [];
  for (let j = 0; j <= nz; j += 1) for (let i = 0; i <= nx; i += 1) {
    const edge = i === 0 || j === 0 || i === nx || j === nz;
    vx.push(x0 + i * cell + (edge ? 0 : (roll() - 0.5) * cell * 0.6)); vz.push(z0 + j * cell + (edge ? 0 : (roll() - 0.5) * cell * 0.6));
  }
  const at = (i: number, j: number): [number, number, number] => { const k = j * (nx + 1) + i; const x = vx[k] as number; const z = vz[k] as number; return [x, heightAt(x, z) - 0.01, z]; };
  // Shades a step apart, never a patchwork: the faces read as facets, not as tiles.
  const tones = [COL.meadow, COL.meadow, mixHex(COL.meadow, mixHex(PAL.good, PAL.ink, 0.25), 0.18), mixHex(COL.meadow, COL.meadowSpot, 0.3), mixHex(COL.meadow, PAL.ink, 0.04), mixHex(COL.meadow, PAL.bg, 0.07)];
  const tris: number[][] = []; const cols: string[] = [];
  for (let j = 0; j < nz; j += 1) for (let i = 0; i < nx; i += 1) {
    const a = at(i, j); const b = at(i + 1, j); const c = at(i + 1, j + 1); const d = at(i, j + 1);
    const flip = roll() < 0.5;
    for (const t of flip ? [[a, d, b], [b, d, c]] : [[a, d, c], [a, c, b]]) { tris.push(t.flat()); cols.push(tones[Math.floor(roll() * tones.length)] as string); }
  }
  const meadow = new Mesh(facets(tris, cols), new MeshLambertMaterial({ vertexColors: true }));
  meadow.receiveShadow = REAL_SHADOWS;
  stylize(meadow, STYLE);
  scene.add(meadow);
  // The arena: a mown lawn, stripes 4 m wide so it reads as a pitch at a glance, faceted in 1 m triangles whose
  // shades differ a little (the same hand as the meadow, never a painted texture).
  const lawn = dice(5);
  const ltris: number[][] = []; const lcols: string[] = [];
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) {
    const [ax, az] = XZ(i, j); const y = 0.004;
    const a = [ax, y, az]; const b = [ax + 1, y, az]; const c = [ax + 1, y, az + 1]; const d = [ax, y, az + 1];
    const base = Math.floor(i / 4) % 2 ? COL.floorStripe : COL.floor;
    for (const t of lawn() < 0.5 ? [[a, d, b], [b, d, c]] : [[a, d, c], [a, c, b]]) {
      ltris.push(t.flat());
      const r = lawn();
      lcols.push(r < 0.3 ? mixHex(base, PAL.ink, 0.035) : r < 0.6 ? mixHex(base, PAL.bg, 0.04) : base);
    }
  }
  const floor = new Mesh(facets(ltris, lcols), new MeshLambertMaterial({ vertexColors: true }));
  floor.receiveShadow = REAL_SHADOWS;
  stylize(floor, STYLE);
  if (FENCED) scene.add(floor);
  // Its edge: a pale path, a hand's height above the grass (inked like the models when the style draws lines).
  const outer = new Shape();
  outer.moveTo(-W / 2 - EDGE, -H / 2 - EDGE); outer.lineTo(W / 2 + EDGE, -H / 2 - EDGE); outer.lineTo(W / 2 + EDGE, H / 2 + EDGE); outer.lineTo(-W / 2 - EDGE, H / 2 + EDGE); outer.closePath();
  const hole = new Path();
  hole.moveTo(-W / 2, -H / 2); hole.lineTo(-W / 2, H / 2); hole.lineTo(W / 2, H / 2); hole.lineTo(W / 2, -H / 2); hole.closePath();
  outer.holes.push(hole);
  const path = new Mesh(new ExtrudeGeometry(outer, { depth: 0.07, bevelEnabled: false }), new MeshLambertMaterial({ color: COL.path }));
  path.rotation.x = -Math.PI / 2;
  stylize(path, STYLE);
  if (FENCED) scene.add(path);
}

/* ------------------------------------------------------------------ models */
/*
 * THE MODELS come from the Homie starter library: `game new` copied each into public/models/ (assets/manifest.json
 * names the library item, its SHA-256 and its CC0 licence). The library keeps each at its own size and in its pack's
 * colours, so the game decides here how tall each stands (metres) and repaints the flat-coloured ones into style.json's
 * palette (repaint: a palette swap by colour family). A model that is not there (no library when the game was made, a
 * refused file) is drawn as a stand-in made here in the same colours, or left out when it is only a flower or a tuft of
 * grass: a round never waits on, or breaks for, a model.
 */
// `models`, HEROES and SKELETONS are above (the characters, asked for first).
/** The verb a hero's swing plays: a mage casts; everyone else strikes. */
const HERO_ACTION: Record<string, string> = { mage: 'cast', 'skeleton-mage': 'cast' };
/** What your own name chip says you are ("You · Mage"): which hero is yours reads at a glance, even from above. */
const HERO_NAME: Record<string, string> = { knight: 'Knight', barbarian: 'Barbarian', mage: 'Mage', rogue: 'Rogue', 'rogue-hooded': 'Rogue' };
const heroName = (kind: string): string => HERO_NAME[kind] ?? kind.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
const HERO_M = 1.45;
const heroKind = (slot: number, seat: number | null, bot: boolean): string => (bot ? SKELETONS[slot % SKELETONS.length] : HEROES[(seat ?? slot) % HEROES.length]) as string;

type RGB = [number, number, number];
const PAINT = {
  leaf: mixHex(PAL.good, PAL.ink, 0.25), wood: mixHex(PAL.accent, PAL.ink, 0.45), blade: mixHex(PAL.good, PAL.accent2, 0.5),
  stone: mixHex(mixHex(PAL.bg, PAL.ink, 0.5), '#8c8f96', 0.35),
};

/** Stand-ins, drawn in the same colours when a model is not there: low-poly shapes, one draw call each. */
type Stand = 'gem' | 'tree' | 'pine' | 'bush' | 'rock' | 'stone' | 'fence' | 'hero' | 'chest';
function standIn(kind: Stand, colour = PAL.accent): Mesh {
  const parts: BufferGeometry[] = [];
  const add = (geo: BufferGeometry, hex: string, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): void => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.scale(sx, sy, sz); g.translate(x, y, z);
    const c = new Color(hex); const n = (g.attributes.position as BufferAttribute).count; const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new BufferAttribute(col, 3));
    parts.push(g);
  };
  if (kind === 'gem') add(new CylinderGeometry(0.22, 0.22, 0.06, 10), PAL.gold, 0, 0.28, 0);
  if (kind === 'tree') { add(new CylinderGeometry(0.12, 0.17, 1.5, 6), PAINT.wood, 0, 0.75, 0); add(new IcosahedronGeometry(1.05, 0), PAINT.leaf, 0, 2.45, 0); }
  if (kind === 'pine') { add(new CylinderGeometry(0.1, 0.14, 0.9, 6), PAINT.wood, 0, 0.45, 0); add(new ConeGeometry(1, 2.2, 7), PAINT.leaf, 0, 1.9, 0); add(new ConeGeometry(0.72, 1.6, 7), PAINT.leaf, 0, 2.95, 0); }
  if (kind === 'bush') add(new CylinderGeometry(0.42, 0.38, 0.8, 8), PAINT.wood, 0, 0.4, 0);
  if (kind === 'rock') add(new DodecahedronGeometry(0.5, 0), PAINT.stone, 0, 0.3, 0, 1.3, 0.75, 1.1);
  if (kind === 'stone') add(new BoxGeometry(0.9, 0.55, 0.7), PAINT.stone, 0, 0.27, 0);
  if (kind === 'fence') { for (const x of [-0.96, 0.96]) add(new BoxGeometry(0.1, 0.7, 0.1), PAINT.wood, x, 0.35, 0); for (const y of [0.3, 0.55]) add(new BoxGeometry(2.03, 0.08, 0.05), PAINT.wood, 0, y, 0); }
  if (kind === 'chest') { add(new BoxGeometry(1.1, 0.6, 0.7), PAINT.wood, 0, 0.3, 0); add(new BoxGeometry(1.12, 0.12, 0.72), PAL.gold, 0, 0.62, 0); }
  if (kind === 'hero') {
    // A hero-shaped stand-in in its seat's colour while its model loads: a body, a head, a sword arm.
    add(new CylinderGeometry(0.26, 0.3, 0.62, 8), colour, 0, 0.46, 0);
    add(new IcosahedronGeometry(0.3, 1), mixHex(colour, '#ffffff', 0.35), 0, 1.02, 0);
    for (const x of [-0.17, 0.17]) add(new BoxGeometry(0.16, 0.2, 0.18), mixHex(colour, PAL.ink, 0.4), x, 0.1, 0);
    add(new BoxGeometry(0.07, 0.62, 0.07), PAINT.stone, 0.42, 0.62, 0.12);
  }
  const mesh = new Mesh(mergeGeometries(parts) as BufferGeometry, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.name = 'stand-in';
  return mesh;
}

/** Every model the game draws: its file, how big it is drawn (m: its height, or its width with `wide`) and its stand-in. */
interface Spec { url: string; m: number; swap: ((r: number, g: number, b: number) => RGB | null) | null; stand: Stand | null; tint?: string; px?: number; wide?: boolean }
// The coin: KayKit's gold coin, drawn standing on its edge and spinning (its width is its size).
const GEM: Spec = { url: './models/coin.glb', m: 0.56, swap: null, stand: 'gem', wide: true };
const FENCE: Spec = { url: './models/fence.glb', m: 0.7, swap: null, stand: 'fence' };
// The clearing's heart: the treasure chest, two lit torches beside it, barrels and crates round it.
const CHEST: Spec = { url: './models/chest.glb', m: 0.95, swap: null, stand: 'chest' };
const TORCH: Spec = { url: './models/torch.glb', m: 1.6, swap: null, stand: null };
const BARREL: Spec = { url: './models/barrel.glb', m: 0.8, swap: null, stand: 'bush' };
const CRATE: Spec = { url: './models/crate.glb', m: 0.72, swap: null, stand: 'stone' };
/** The dressing: how many, where, its footprint in metres (for spacing), its shadow's radius and its size range. */
type Where = 'far' | 'any' | 'low' | 'inside' | 'edge';
const DRESSING: (Spec & { count: number; where: Where; foot: number; shadow: number; scale: [number, number] })[] = [
  { url: './models/pine.glb', m: 3.8, swap: null, stand: 'pine', count: 22, where: 'far', foot: 1.6, shadow: 1.0, scale: [0.8, 1.3] },
  { url: './models/pine-round.glb', m: 3.3, swap: null, stand: 'tree', count: 18, where: 'far', foot: 1.6, shadow: 1.0, scale: [0.8, 1.25] },
  { url: './models/grove.glb', m: 3.4, swap: null, stand: 'pine', count: 7, where: 'far', foot: 4.2, shadow: 2.4, scale: [0.9, 1.2] },
  { url: './models/rock.glb', m: 0.75, swap: null, stand: 'rock', count: 14, where: 'any', foot: 1.3, shadow: 0.7, scale: [0.6, 1.15] },
  { url: './models/rocks.glb', m: 0.55, swap: null, stand: 'rock', count: 10, where: 'any', foot: 1.2, shadow: 0.6, scale: [0.7, 1.2] },
  { url: './models/pine.glb', m: 3.8, swap: null, stand: 'pine', count: 8, where: 'any', foot: 1.6, shadow: 1.0, scale: [0.55, 0.85] },
  // The clearing's edge: rocks, barrels and crates just outside it (never on the camera's side).
  { url: './models/rock.glb', m: 0.75, swap: null, stand: 'rock', count: FENCED ? 0 : 12, where: 'edge', foot: 1.1, shadow: 0.6, scale: [0.6, 1] },
  { url: './models/barrel.glb', m: 0.8, swap: null, stand: 'bush', count: FENCED ? 0 : 6, where: 'edge', foot: 0.9, shadow: 0.45, scale: [0.9, 1.1] },
  { url: './models/crate.glb', m: 0.72, swap: null, stand: 'stone', count: FENCED ? 0 : 5, where: 'edge', foot: 1, shadow: 0.5, scale: [0.85, 1.15] },
];

/** A model loaded once, repainted and measured: `fit` scales it to its height, `size` is its box at that height. */
interface Ready { scene: Object3D; fit: number; size: Vector3 }
const ready = new Map<string, Promise<Ready | null>>();
function prepare(spec: Pick<Spec, 'url' | 'm' | 'swap' | 'tint' | 'px' | 'wide'>): Promise<Ready | null> {
  let p = ready.get(spec.url);
  if (!p) {
    p = track(models.load(spec.url), false).then((m) => {
      if (spec.swap) repaint(m.scene, spec.swap, spec.px ? { maxPx: spec.px } : undefined);
      const size = new Box3().setFromObject(m.scene).getSize(new Vector3());
      const along = spec.wide ? Math.max(size.x, size.z) : size.y;
      const fit = along > 1e-3 ? spec.m / along : 1;
      // The art direction's material model and ink line (style.json), as the style board drew them.
      stylize(m.scene, STYLE, { scale: fit });
      return { scene: m.scene, fit, size: size.multiplyScalar(fit) };
    }, () => { standIns.add(spec.url); return null; });
    ready.set(spec.url, p);
  }
  return p;
}
// The Game Lab plays a take only once the models have settled (loaded or not there), so both builds start alike:
// held here, released below once every model (the heroes too) has loaded or failed.
lab.hold();

/**
 * A model as instanced copies (instancedCopies: one InstancedMesh per mesh, placed with placeCopy, never by baking into
 * the file's geometry), and the scale that makes it its height; its stand-in when it is not there, or nothing.
 */
async function instancedFrom(spec: Spec, count: number): Promise<{ parts: Copies[]; fit: number; size: Vector3 | null }> {
  const r = await prepare(spec);
  if (r) return { parts: instancedCopies(r.scene, count), fit: r.fit, size: r.size };
  return { parts: spec.stand ? instancedCopies(standIn(spec.stand), count) : [], fit: 1, size: null };
}

/* ------------------------------------------------------------------ soft discs: shadows, glows */
const discTexture = canvasTexture(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});
const flatDisc = (): PlaneGeometry => { const g = new PlaneGeometry(2, 2); g.rotateX(-Math.PI / 2); return g; };
const shadowMaterial = new MeshBasicMaterial({ map: discTexture, color: COL.shadow, transparent: true, opacity: 0.32, depthWrite: false });
/** Shadows that move: one disc per body and per gem. */
const blobs = new InstancedMesh(flatDisc(), shadowMaterial, MAX_SLOTS + 40);
blobs.frustumCulled = false; blobs.count = 0; blobs.position.y = 0.012;
scene.add(blobs);
/** The glow under each gem: it says "take me" before the gem is near. */
const glows = new InstancedMesh(flatDisc(), new MeshBasicMaterial({ map: discTexture, color: COL.gem, transparent: true, opacity: 0.32, depthWrite: false }), 40);
glows.frustumCulled = false; glows.count = 0; glows.position.y = 0.016;
scene.add(glows);

/* ------------------------------------------------------------------ the dressing around the arena */
const placed: { x: number; z: number; r: number }[] = [];
/**
 * A spot for a piece of dressing (three.js x, z): on a band round the arena, `out` metres past its path, most of them
 * near the fence (where the camera sees them), clear of the others. Trees and standing stones only behind the arena
 * and beside its far half: never between the camera and the play.
 */
function spotFor(roll: () => number, where: Where, r: number, tall = false): { x: number; z: number } | null {
  if (where === 'inside') {
    // A few small flowers on the lawn itself, so a phone's close view is never bare grass (they never block a move).
    for (let tries = 0; tries < 60; tries += 1) {
      const x = (roll() - 0.5) * (W - 1.6); const z = (roll() - 0.5) * (H - 1.6);
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r)) continue;
      placed.push({ x, z, r });
      return { x, z };
    }
    return null;
  }
  const [lo, hi] = where === 'edge' ? [0.5, 1.6] : where === 'low' ? [1.2, 7] : where === 'any' ? [1.5, 9] : [1.8, 16];
  for (let tries = 0; tries < 60; tries += 1) {
    const out = lo + (hi - lo) * roll() ** 1.5;
    const hw = W / 2 + EDGE + out; const hh = H / 2 + EDGE + out;
    let u = roll() * (4 * hw + 4 * hh); let x: number; let z: number;
    if (u < 2 * hw) { x = -hw + u; z = -hh; } else if ((u -= 2 * hw) < 2 * hh) { x = hw; z = -hh + u; } else if ((u -= 2 * hh) < 2 * hw) { x = hw - u; z = hh; } else { u -= 2 * hw; x = -hw; z = hh - u; }
    if (where === 'far' && z > 0) continue;
    if (where === 'edge' && z > H / 2) continue; // the near side stays open to the camera
    if (where === 'any' && z > H / 2 && (out > 4 || tall)) continue; // little on the camera's side, and nothing tall:
    // a tree there would stand between a phone's close camera and its hero
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r)) continue;
    placed.push({ x, z, r });
    return { x, z };
  }
  return null;
}
const shadowSpots: { x: number; z: number; r: number }[] = [];
/** The torches' flames at the clearing's heart (flickered in draw): two cones in the palette's gold and accent, a glow. */
const flames: Object3D[] = [];
async function buildCamp(o: { x: number; y: number; r: number }): Promise<void> {
  const [x, z] = XZ(o.x, o.y);
  const camp = new Group(); camp.position.set(x, 0, z); scene.add(camp);
  const chest = await prepare(CHEST);
  const box = chest ? chest.scene.clone(true) : standIn('chest');
  if (chest) box.scale.setScalar(chest.fit);
  box.rotation.y = 0.15; // turned a little toward the camera's side
  camp.add(box);
  const torch = await prepare(TORCH);
  for (const [tx, tz] of [[-1.05, -0.35], [1.05, -0.3]] as [number, number][]) {
    const t = new Group(); t.position.set(tx, 0, tz); camp.add(t);
    if (torch) { const obj = torch.scene.clone(true); obj.scale.setScalar(torch.fit); t.add(obj); }
    else { const pole = new Mesh(new CylinderGeometry(0.05, 0.06, 1.5, 6), new MeshLambertMaterial({ color: PAINT.wood })); pole.position.y = 0.75; t.add(pole); }
    const f = new Group(); f.position.y = TORCH.m * 0.92;
    const outer = new Mesh(new ConeGeometry(0.13, 0.42, 6), new MeshBasicMaterial({ color: PAL.accent }));
    const inner = new Mesh(new ConeGeometry(0.08, 0.28, 6), new MeshBasicMaterial({ color: PAL.gold }));
    outer.position.y = 0.2; inner.position.y = 0.15; f.add(outer, inner);
    t.add(f); flames.push(f);
  }
  const glow = new Mesh(new CircleGeometry(2.2, 28), new MeshBasicMaterial({ map: discTexture, color: PAL.gold, transparent: true, opacity: 0.3, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.02; camp.add(glow);
  for (const [spec, bx, bz, rot] of [[BARREL, -1.55, 0.55, 0.3], [CRATE, 1.6, 0.6, -0.4], [BARREL, 1.95, -0.25, 1]] as [Spec, number, number, number][]) {
    const r = await prepare(spec);
    const obj = r ? r.scene.clone(true) : spec.stand ? standIn(spec.stand) : null;
    if (!obj) continue;
    if (r) obj.scale.setScalar(r.fit * 0.85);
    obj.position.set(bx, 0, bz); obj.rotation.y = rot; camp.add(obj);
  }
  if (REAL_SHADOWS) camp.traverse((n) => { const mm = n as Mesh; if (mm.isMesh && mm.name !== 'hull' && n !== glow && !flames.some((f) => f.children.includes(n))) mm.castShadow = true; });
}

/** The clearing's solid features (OBSTACLES), drawn with the dressing's own models. */
const OBSTACLE_SPEC = {
  camp: null,
  bush: BARREL,
  rock: DRESSING.find((d) => d.url.endsWith('/rock.glb')),
  stone: CRATE,
  tree: DRESSING.find((d) => d.url.endsWith('/pine-round.glb')),
} as const;
async function dressMeadow(): Promise<void> {
  const roll = dice(2024);
  const m = new Matrix4(); const qt = new Quaternion(); const e = new Euler(); const p = new Vector3(); const s = new Vector3();
  // The clearing's features first: the dressing keeps clear of them, and each gets its shadow.
  for (const o of OBSTACLES) { const [x, z] = XZ(o.x, o.y); placed.push({ x, z, r: o.r + 0.3 }); shadowSpots.push({ x, z, r: o.r * 1.4 }); }
  // Decided before any model arrives, so the meadow is the same on every screen whatever loads first.
  const plans = DRESSING.map((d) => {
    const spots: { x: number; z: number; rot: number; sc: number }[] = [];
    for (let i = 0; i < d.count; i += 1) {
      const sc = d.scale[0] + roll() * (d.scale[1] - d.scale[0]);
      const at = spotFor(roll, d.where, d.foot * 0.5 * sc + 0.15, d.m * sc > 1.6);
      if (at) spots.push({ ...at, rot: roll() * Math.PI * 2, sc });
    }
    return { d, spots };
  });
  for (const { d, spots } of plans) if (d.shadow) for (const sp of spots) shadowSpots.push({ x: sp.x, z: sp.z, r: d.shadow * sp.sc });
  // Their shadows: one draw call for the lot.
  const still = new InstancedMesh(flatDisc(), shadowMaterial, shadowSpots.length || 1);
  shadowSpots.forEach((sp, i) => still.setMatrixAt(i, m.compose(p.set(sp.x, heightAt(sp.x, sp.z) + 0.008, sp.z), qt.identity(), s.set(sp.r, 1, sp.r))));
  still.count = shadowSpots.length;
  still.computeBoundingSphere();
  still.visible = !REAL_SHADOWS; // a computer draws the real shadows
  scene.add(still);
  await Promise.all(plans.map(async ({ d, spots }) => {
    const { parts, fit } = await instancedFrom(d, Math.max(1, spots.length));
    for (const c of parts) {
      spots.forEach((sp, i) => placeCopy(c, i, m.compose(p.set(sp.x, heightAt(sp.x, sp.z) - 0.02, sp.z), qt.setFromEuler(e.set(0, sp.rot, 0)), s.setScalar(sp.sc * fit))));
      c.mesh.count = spots.length;
      c.mesh.computeBoundingSphere();
      c.mesh.castShadow = REAL_SHADOWS && c.mesh.name !== 'hull'; c.mesh.receiveShadow = REAL_SHADOWS;
      scene.add(c.mesh);
    }
  }));
  // The features themselves: a copy of each model (or its stand-in) where the rules put it.
  const turn = dice(77);
  await Promise.all(OBSTACLES.map(async (o) => {
    if (o.kind === 'camp') { await buildCamp(o); return; }
    const spec = OBSTACLE_SPEC[o.kind];
    if (!spec) return;
    const r = await prepare(spec);
    const obj = r ? r.scene.clone(true) : spec.stand ? standIn(spec.stand) : null;
    if (!obj) return;
    const [x, z] = XZ(o.x, o.y);
    obj.position.set(x, 0, z); obj.rotation.y = turn() * Math.PI * 2;
    // Drawn as wide as it is solid (its footprint a little over o.r), so a hero stops at what it sees, never inside it.
    const half = r ? Math.max(r.size.x, r.size.z) / 2 : 0;
    const k = o.kind === 'tree' || !half ? (o.kind === 'tree' ? 0.8 : 1.1) : Math.max(0.6, Math.min(1.6, (o.r + 0.08) / half));
    obj.scale.setScalar((r?.fit ?? 1) * k);
    if (REAL_SHADOWS) obj.traverse((n) => { const mm = n as Mesh; if (mm.isMesh && mm.name !== 'hull') mm.castShadow = true; });
    scene.add(obj);
  }));
}
/** The fence just outside the path: a ring of the same piece, each stretched a little to fit its side; one draw call. */
async function buildFence(): Promise<void> {
  const { parts, fit, size } = await instancedFrom(FENCE, 120);
  const piece = size?.x ?? 2.03; // metres along x at its height (the stand-in's is 2.03)
  const runs: { x: number; z: number; rot: number; stretch: number }[] = [];
  const nx = Math.ceil((W + 2 * EDGE) / piece); const nz = Math.ceil((H + 2 * EDGE) / piece);
  const sx = (W + 2 * EDGE) / nx; const sz = (H + 2 * EDGE) / nz;
  const off = 0.18;
  for (let i = 0; i < nx; i += 1) {
    const x = -W / 2 - EDGE + (i + 0.5) * sx;
    runs.push({ x, z: -H / 2 - EDGE - off, rot: 0, stretch: sx / piece }, { x, z: H / 2 + EDGE + off, rot: Math.PI, stretch: sx / piece });
  }
  for (let i = 0; i < nz; i += 1) {
    const z = -H / 2 - EDGE + (i + 0.5) * sz;
    runs.push({ x: -W / 2 - EDGE - off, z, rot: Math.PI / 2, stretch: sz / piece }, { x: W / 2 + EDGE + off, z, rot: -Math.PI / 2, stretch: sz / piece });
  }
  const m = new Matrix4(); const qt = new Quaternion(); const e = new Euler(); const p = new Vector3(); const s = new Vector3();
  for (const c of parts) {
    runs.forEach((r, i) => placeCopy(c, i, m.compose(p.set(r.x, 0, r.z), qt.setFromEuler(e.set(0, r.rot, 0)), s.set(r.stretch * fit, fit, fit))));
    c.mesh.count = runs.length;
    c.mesh.computeBoundingSphere();
    c.mesh.castShadow = REAL_SHADOWS;
    scene.add(c.mesh);
  }
}
/**
 * Tufts of grass in and around the clearing, made here (procedural, free): three thin blades in the palette's greens,
 * one InstancedMesh for all of them, so a phone's close view is never a bare board (they never block a move).
 */
function grassTufts(): void {
  const roll = dice(311);
  const blades: BufferGeometry[] = [];
  for (let i = 0; i < 3; i += 1) {
    const g = new ConeGeometry(0.035, 0.26 + i * 0.05, 3); g.translate(0, 0.13 + i * 0.025, 0);
    g.rotateZ((i - 1) * 0.35); g.rotateY(i * 2.1); g.translate((i - 1) * 0.05, 0, (i % 2) * 0.04);
    blades.push(g.toNonIndexed());
  }
  const geo = mergeGeometries(blades) as BufferGeometry;
  const tufts = new InstancedMesh(geo, new MeshLambertMaterial({ color: PAINT.blade, flatShading: true }), 220);
  const m = new Matrix4(); const qt = new Quaternion(); const e = new Euler(); const p = new Vector3(); const sc = new Vector3();
  let n = 0;
  for (let i = 0; i < 220; i += 1) {
    const inside = i < 110;
    const x = inside ? (roll() - 0.5) * (W - 1) : (roll() - 0.5) * (W + 16); const z = inside ? (roll() - 0.5) * (H - 1) : -H / 2 - roll() * 9 + (roll() < 0.3 ? H + 4 : 0);
    if (OBSTACLES.some((o) => { const [ox, oz] = XZ(o.x, o.y); return Math.hypot(ox - x, oz - z) < o.r + 0.3; })) continue;
    const k = 0.8 + roll() * 0.8;
    tufts.setMatrixAt(n, m.compose(p.set(x, heightAt(x, z) - 0.01, z), qt.setFromEuler(e.set(0, roll() * Math.PI * 2, 0)), sc.set(k, k * (0.8 + roll() * 0.5), k)));
    tufts.setColorAt(n, new Color(mixHex(PAINT.blade, roll() < 0.5 ? PAL.good : PAL.gold, roll() * 0.25)));
    n += 1;
  }
  tufts.count = n; tufts.computeBoundingSphere();
  tufts.receiveShadow = REAL_SHADOWS;
  scene.add(tufts);
}
void dressMeadow();
grassTufts();
if (FENCED) void buildFence();

/* ------------------------------------------------------------------ gems */
const GEM_CAP = 40;
/** Gems are drawn a third bigger than the model's 0.42 m, so they read on a phone; picking one up is the rules' R_GEM. */
const GEM_DRAWN = 1.35;
let gemParts: Copies[] = [];
let gemFit = 1;
function setGemParts(parts: Copies[], fit = 1): void {
  for (const c of gemParts) scene.remove(c.mesh);
  gemParts = parts; gemFit = fit;
  for (const { mesh: im } of parts) {
    im.frustumCulled = false; im.count = 0;
    im.instanceMatrix.setUsage(DynamicDrawUsage);
    // A little light of their own (a copy of the file's material), so gems read as treasure in any light.
    const own = (im.material as MeshStandardMaterial).clone();
    if (own.emissive) { own.emissive = new Color(COL.gem); own.emissiveIntensity = 0.3; }
    im.material = own;
    scene.add(im);
  }
}
{
  // Until the gem arrives (a few hundred ms) its stand-in, which stays if it never does: the round has already started.
  setGemParts(instancedCopies(standIn('gem'), GEM_CAP));
  void prepare(GEM).then((r) => { if (r) setGemParts(instancedCopies(r.scene, GEM_CAP), r.fit); });
}
const lastGems = new Map<number, { x: number; y: number }>();
let lastGemRound = -1;

/* ------------------------------------------------------------------ the hot zone, rings, waves, sparks */
const zoneFill = new Mesh(new CircleGeometry(1, 48), new MeshBasicMaterial({ color: COL.zone, transparent: true, opacity: 0.16, depthWrite: false }));
zoneFill.rotation.x = -Math.PI / 2; zoneFill.position.y = 0.014; zoneFill.visible = false;
const zoneRing = (() => {
  // A dashed ring, as Gem Rush draws it: 18 dashes in one geometry.
  const dashes: BufferGeometry[] = [];
  for (let i = 0; i < 18; i += 1) dashes.push(new RingGeometry(0.93, 1, 6, 1, (i / 18) * Math.PI * 2, (Math.PI * 2) / 18 * 0.6));
  const g = mergeGeometries(dashes) as BufferGeometry; g.rotateX(-Math.PI / 2);
  return new Mesh(g, new MeshBasicMaterial({ color: COL.zone, transparent: true, opacity: 0.9, depthWrite: false }));
})();
zoneRing.position.y = 0.02; zoneRing.visible = false;
scene.add(zoneFill, zoneRing);

/** Every body's seat colour, a ring on the grass under it (people bright; bots greyed, as Gem Rush dims them). */
const ringGeo = new RingGeometry(R_AV + 0.02, R_AV + 0.14, 40); ringGeo.rotateX(-Math.PI / 2);
const seatRings = new InstancedMesh(ringGeo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }), MAX_SLOTS + 4);
seatRings.frustumCulled = false; seatRings.count = 0; seatRings.position.y = 0.022;
seatRings.setColorAt(0, new Color(0xffffff));
const edgeGeo = new RingGeometry(R_AV - 0.02, R_AV + 0.18, 40); edgeGeo.rotateX(-Math.PI / 2);
const seatEdges = new InstancedMesh(edgeGeo, new MeshBasicMaterial({ color: COL.shadow, transparent: true, opacity: 0.4, depthWrite: false }), MAX_SLOTS + 4);
seatEdges.frustumCulled = false; seatEdges.count = 0; seatEdges.position.y = 0.018;
scene.add(seatEdges, seatRings);
/** The ring that says "you" (or the player a watcher follows). */
const youGeo = new RingGeometry(R_AV + 0.2, R_AV + 0.3, 48); youGeo.rotateX(-Math.PI / 2);
const youRing = new Mesh(youGeo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
youRing.position.y = 0.024; youRing.visible = false;
scene.add(youRing);

const waveGeo = new RingGeometry(0.9, 1, 48); waveGeo.rotateX(-Math.PI / 2);
const wavePool: Mesh[] = [];
function waveMesh(i: number): Mesh {
  let w = wavePool[i];
  if (!w) { w = new Mesh(waveGeo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false })); w.position.y = 0.03; scene.add(w); wavePool[i] = w; }
  return w;
}

/**
 * A swing's slash: a flat band of T.swingArc degrees in front of the swinger at waist height, sweeping out to its reach
 * (what a swing can hit, drawn). Its geometry follows the tunable (the Game Lab's slider redraws it).
 */
let slashArc = -1;
let slashGeo = new BufferGeometry();
const slashPool: Mesh[] = [];
function slashMesh(i: number): Mesh {
  if (slashArc !== T.swingArc) {
    slashArc = T.swingArc;
    const half = (Math.min(359, Math.max(10, T.swingArc)) * Math.PI) / 360;
    const g = new RingGeometry(0.82, 1, 28, 1, -Math.PI / 2 - half, half * 2); g.rotateX(-Math.PI / 2);
    slashGeo.dispose(); slashGeo = g;
    for (const m of slashPool) m.geometry = g;
  }
  let w = slashPool[i];
  if (!w) { w = new Mesh(slashGeo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: DoubleSide })); scene.add(w); slashPool[i] = w; }
  return w;
}

/** Sparks: little bars flying off a hit (white, then gold) and up off a taken gem; one draw call. */
const sparkMesh = new InstancedMesh(new BoxGeometry(1, 0.07, 0.07), new MeshBasicMaterial({ color: 0xffffff }), 160);
sparkMesh.frustumCulled = false; sparkMesh.count = 0; sparkMesh.instanceMatrix.setUsage(DynamicDrawUsage);
sparkMesh.setColorAt(0, new Color(0xffffff));
scene.add(sparkMesh);

/* ------------------------------------------------------------------ the heroes */
/*
 * Each body is a hero (people) or a skeleton (bots): its model and its clips come through @homie-rocks/studio/animate
 * (loadCharacter finds the clip library the model names). The game moves the body; the character only shows it: it
 * faces where it goes, blends idle, walk and run by its speed, plays the swing, the jump and the hit from the same
 * events every screen gets, flashes white when hit, and cheers when it won the round.
 *
 *   root (where, and how high it jumped) > tilt (the hit's angle) > squash (stretch along the hit) > untilt > character
 */
interface Hero {
  slot: number; kind: string; mine: boolean;
  root: Group; tilt: Group; squash: Group; untilt: Group;
  char: Character | null; stand: Mesh | null; mats: MeshStandardMaterial[];
  px: number; py: number; ph: number; grounded: boolean; speed: number; seen: number; yaw: number; held: string | null;
}
const heroes = new Map<number, Hero>();
function heroFor(slot: number, kind: string, colour: string): Hero {
  let h = heroes.get(slot);
  if (h && h.kind === kind) return h;
  if (!h) {
    const root = new Group(); const tilt = new Group(); const squash = new Group(); const untilt = new Group();
    root.add(tilt); tilt.add(squash); squash.add(untilt);
    scene.add(root);
    h = { slot, kind, mine: false, root, tilt, squash, untilt, char: null, stand: null, mats: [], px: NaN, py: NaN, ph: 0, grounded: true, speed: 0, seen: 0, yaw: 0, held: null };
    heroes.set(slot, h);
  }
  h.kind = kind;
  dressHero(h, colour);
  return h;
}
function clearHero(h: Hero): void {
  if (h.char) { h.char.dispose(); h.char = null; }
  if (h.stand) { h.untilt.remove(h.stand); h.stand.geometry.dispose(); h.stand = null; }
  for (const m of h.mats) m.dispose();
  h.mats = []; h.held = null;
}
/** The hero's model: a stand-in in its seat's colour at once (a round never waits), then its own character when it is in. */
function dressHero(h: Hero, colour: string): void {
  clearHero(h);
  h.stand = standIn('hero', colour);
  h.untilt.add(h.stand);
  const want = h.kind;
  void loadHero(want).then(async (ok) => {
    if (!ok || h.kind !== want || heroes.get(h.slot) !== h) return;
    const char = await loadCharacter(models, heroUrl(want), { tune: T }).catch(() => null);
    if (!char || h.kind !== want || heroes.get(h.slot) !== h) { char?.dispose(); return; }
    clearHero(h);
    // Its own materials (a copy shares the file's), so a hit flashes this one hero; the art direction's material model.
    const own = new Map<Material, MeshStandardMaterial>();
    char.model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as MeshStandardMaterial;
      let c = own.get(m);
      if (!c) { c = m.clone(); own.set(m, c); h.mats.push(c); }
      mesh.material = c;
      mesh.castShadow = REAL_SHADOWS;
      // A skinned body moves out of its bind-pose box: never culled by it.
      mesh.frustumCulled = false;
    });
    char.root.rotation.y = h.yaw;
    h.char = char;
    h.untilt.add(char.root);
  });
}
/** Place, turn, squash, flash and animate one hero this frame. */
function poseHero(h: Hero, at: { x: number; y: number; h: number }, t: number, dt: number, fx: ReturnType<typeof bodyFx>, place: number | null, over: boolean): void {
  const [x, z] = XZ(at.x + fx.ox, at.y + fx.oy);
  h.root.position.set(x, at.h, z);
  // How fast it moves, from where it is drawn (the same for its owner, the host and every replica).
  const dx = at.x - h.px; const dy = at.y - h.py; const step = Math.hypot(dx, dy);
  const sp = !Number.isFinite(step) || step > 2 || dt <= 0 ? 0 : step / dt; // a jump in place (a new round, a takeover) is not a run
  h.speed += (Math.min(sp, 12) - h.speed) * Math.min(1, dt * 10);
  const vh = dt > 0 ? (at.h - h.ph) / dt : 0;
  h.px = at.x; h.py = at.y; h.ph = at.h;
  // It faces where it goes, but not while flying from a bump (it is knocked backwards, not turned round).
  const pose = poses.get(h.slot);
  if (pose) h.yaw = Math.atan2(pose.heading.x, pose.heading.y);
  h.tilt.rotation.y = -fx.ang; h.untilt.rotation.y = fx.ang;
  h.squash.scale.set(fx.sx, fx.up, fx.sy);
  for (const m of h.mats) if (m.emissive) m.emissive.setScalar(fx.flash * 0.9);
  const c = h.char;
  if (!c) { if (h.stand) h.stand.rotation.y = h.yaw; return; }
  c.face(h.yaw, dt);
  c.move(bumps.has(h.slot) ? 0 : h.speed);
  const grounded = pose?.grounded ?? at.h <= 0.002, vertical = pose?.vel.z ?? vh;
  if (h.grounded && !grounded && vertical > 0) c.jump();
  c.air(grounded, vertical); h.grounded = grounded;
  // The round's end: its winner cheers (held until the next round), everyone else stands.
  const want = over && place === 1 ? 'win' : null;
  if (want !== h.held) { if (want) c.hold(want); else if (h.held) c.hold(''); h.held = want; }
  c.update(dt);
}

// The Game Lab starts its take once everything is in (the heroes in their order above: never all at once at boot).
void Promise.all([allHeroes, ...SKELETONS.map((k) => loadHero(k)), prepare(GEM), ...(FENCED ? [prepare(FENCE)] : []), prepare(CHEST), prepare(TORCH), prepare(BARREL), prepare(CRATE), ...DRESSING.map(prepare)]).then(() => lab.ready());

/* ------------------------------------------------------------------ the Game Lab's overlays, as lines on the meadow */
const pen = (() => {
  const cap = 6000;
  const pos = new Float32Array(cap * 3); const col = new Float32Array(cap * 3);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage));
  geo.setAttribute('color', new BufferAttribute(col, 3).setUsage(DynamicDrawUsage));
  const lines = new LineSegments(geo, new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
  lines.frustumCulled = false; lines.renderOrder = 10; lines.visible = false;
  if (lab.on) scene.add(lines);
  let n = 0; const c = new Color();
  const put = (x: number, y: number, hex: string): void => { const [px, pz] = XZ(x, y); pos.set([px, 0.06, pz], n * 3); c.set(hex); col.set([c.r, c.g, c.b], n * 3); n += 1; };
  return {
    begin(): void { n = 0; },
    seg(x1: number, y1: number, x2: number, y2: number, hex: string): void { if (n + 2 > cap) return; put(x1, y1, hex); put(x2, y2, hex); },
    ellipse(x: number, y: number, rx: number, ry: number, a: number, hex: string, dashed = false): void {
      const N = 32; const ca = Math.cos(a); const sa = Math.sin(a);
      const at = (i: number): [number, number] => { const th = (i / N) * Math.PI * 2; const ex = Math.cos(th) * rx; const ey = Math.sin(th) * ry; return [x + ex * ca - ey * sa, y + ex * sa + ey * ca]; };
      for (let i = 0; i < N; i += 1) { if (dashed && i % 2) continue; const [x1, y1] = at(i); const [x2, y2] = at(i + 1); this.seg(x1, y1, x2, y2, hex); }
    },
    end(): void {
      geo.setDrawRange(0, n);
      (geo.attributes.position as BufferAttribute).needsUpdate = true; (geo.attributes.color as BufferAttribute).needsUpdate = true;
      lines.visible = n > 0;
    },
  };
})();
type Pen = typeof pen;
lab.overlay('onion', (c) => {
  const g = c as Pen;
  const ghosts = lab.past<Pose>('subject', 8, 3);
  ghosts.forEach((p) => g.ellipse(p.x, p.y, R_AV * (p.sx ?? 1), R_AV * (p.sy ?? 1), p.a ?? 0, '#ffad3b'));
});
lab.overlay('arcs', (c) => {
  const g = c as Pen;
  const pts = lab.past<Pose>('subject', 90, 1);
  for (let i = 1; i < pts.length; i += 1) { const a = pts[i - 1] as Pose; const b = pts[i] as Pose; g.seg(a.x, a.y, b.x, b.y, '#7cc4ff'); }
  for (const p of pts) { g.seg(p.x - 0.05, p.y, p.x + 0.05, p.y, '#7cc4ff'); g.seg(p.x, p.y - 0.05, p.x, p.y + 0.05, '#7cc4ff'); }
});
lab.overlay('reach', (c) => {
  if (!me.has) return;
  (c as Pen).ellipse(me.x, me.y, T.knockRange, T.knockRange, 0, '#ffffff', true);
});

/* ------------------------------------------------------------------ the camera */
/*
 * style.json's camera: high three-quarter (its pitch and field of view), square to the arena so the stick's up is
 * the screen's up. How close: the screen's short side about 13.5 m of meadow at the player on a computer and 9.5 m on
 * a phone (style.json's distance scales both: 22 is these), so a hero reads at about the same size in the hand.
 * It follows the body whose view this is and never looks past the arena's edge (beyond the path and the fence, as
 * far as the perspective allows); following nobody, it frames the whole arena (turned on a tall screen, so the
 * arena's long side runs up it).
 */
const PITCH0 = (CAM.pitch * Math.PI) / 180;
const HALF = (CAM.fov * Math.PI) / 360;
/*
 * A phone held upright sees the ground through a slit: its width is the short side. Followed from style.json's pitch
 * and distance it shows a long strip of mostly empty grass with a small hero in it. So, like the port kit's fitView
 * (fill a phone held upright and follow the player), it frames the action instead: closer (about 5.5 m across at the
 * player, a hero a quarter of the screen's width) and LOWER, 28 to 32 degrees (8 under style.json's pitch): from the
 * 40 it once was, a hero is the top of its hat (a mage's brim hides the whole mage), and its legs, so its run, never
 * show. At 30 the face, the body and the legs read on every kind, and the far side of the clearing and the woods fill
 * the top of the screen, where the rivals ahead are. The player stands in the lower half. No tall dressing stands on
 * the camera's side, so nothing comes between the camera and its hero.
 */
const UPRIGHT_PITCH = Math.max((28 * Math.PI) / 180, Math.min((32 * Math.PI) / 180, PITCH0 - (8 * Math.PI) / 180));
let PITCH = PITCH0;
const MARGIN = EDGE + 3; // how far past the arena's near side and ends the camera may look: the path, the fence, the flowers
// Past its far side it may look into the woods (the trees stand 3 to 18 m out): the clearing reads as a place.
const MARGIN_FAR = EDGE + 18;
const WHOLE_MARGIN = EDGE + 1.2; // the whole arena: the path and the fence round it
const view3 = { x: W / 2, y: H / 2, dist: 0, yaw: 0 };
/** Ground reach from the point looked at, toward the camera (near, the screen's bottom) and away (far, its top), per metre of distance. */
let NEAR_K = 0; let FAR_K = 0;
/** The pitch this frame looks down at (style.json's, or an upright phone's steeper one), and the ground reach it gives. */
function setPitch(p: number): void {
  if (p === PITCH && NEAR_K) return;
  PITCH = p;
  NEAR_K = Math.cos(PITCH) - Math.sin(PITCH) / Math.tan(PITCH + HALF);
  FAR_K = PITCH > HALF + 0.05 ? Math.sin(PITCH) / Math.tan(PITCH - HALF) - Math.cos(PITCH) : 4;
}
setPitch(PITCH0);
function followDistance(cw: number, ch: number, phone: boolean, upright = false): number {
  // style.json's distance scales the view (22 is these spans); an upright phone's stays between 5.5 and 8 m whatever
  // it says, or a close camera would show one hero and nothing round it.
  const k = (CAM.distance ?? 22) / 22;
  const span = upright ? 6.1 * Math.max(0.9, Math.min(1.3, k)) : (phone ? 9.5 : 13.5) * k;
  return span / (2 * Math.tan(HALF) * Math.min(1, cw / ch));
}
/** How far away the whole arena fits; `turned`: seen from its side, its 32 m running up the screen (a tall screen). */
function wholeDistance(cw: number, ch: number, turned: boolean): number {
  const aspect = cw / ch;
  const deep = turned ? W : H; const wide = turned ? H : W;
  const byDepth = (deep + 2 * WHOLE_MARGIN) / (NEAR_K + FAR_K);
  // The arena's near edge is the narrowest part of the view: it has to fit there.
  const byWidth = (wide / 2 + WHOLE_MARGIN) * Math.sin(PITCH + HALF) / (Math.sin(PITCH) * Math.cos(HALF) * Math.tan(HALF) * aspect);
  return Math.max(byDepth, byWidth);
}
/** How far from its far edge to look so a `deep` metres arena sits in the middle of the screen (on the screen, not in metres). */
function middleOf(deep: number, d: number): number {
  let a = -20; let b = deep + 20;
  for (let i = 0; i < 30; i += 1) { const m = (a + b) / 2; if (screenY(deep - m, d) + screenY(-m, d) < 0) a = m; else b = m; }
  return (a + b) / 2;
}
/** How high on the screen (-1 bottom, 1 top) a ground point `s` metres nearer the camera than the point looked at sits. */
function screenY(s: number, d: number): number {
  const along = d * Math.cos(PITCH) - s;
  return along <= 0 ? -1e3 : Math.tan(Math.atan2(d * Math.sin(PITCH), along) * -1 + PITCH) / Math.tan(HALF);
}
/**
 * Where to look (rules coordinates) at distance d, following `focus`, kept from looking past the arena (its path,
 * fence and a strip of meadow). Where the view is deeper than all that, the arena sits in the middle of the screen:
 * its near and far edges equally far from the screen's bottom and top (on the screen, not in metres: the near side of
 * a three-quarter view is the bigger).
 */
function aimAt(focus: { x: number; y: number } | null, d: number, cw: number, ch: number, whole: boolean, turned = false, upright = false): { x: number; y: number } {
  // Turned (the whole arena on a tall screen, seen from its left side): its far edge is x = W.
  if (turned) return { x: W - middleOf(W, d), y: H / 2 };
  // An upright phone follows its player everywhere (past the edge it sees the fence and the woods), looking a little
  // ahead so the player stands in the lower half and what is coming fills the top.
  if (upright && focus) return { x: focus.x, y: focus.y - d * 0.27 };
  const loY = FAR_K * d - MARGIN_FAR; const hiY = H + MARGIN - NEAR_K * d;
  let y: number;
  if (whole || loY > hiY) y = middleOf(H, d);
  // Following: a little ahead of the player, so it stands below the middle and the clearing and the woods it is
  // heading into fill the top.
  else y = !focus ? (loY + hiY) / 2 : Math.max(loY, Math.min(hiY, focus.y - d * 0.12));
  const hw = d * Math.tan(HALF) * (cw / ch); // half the view's width where it looks
  const loX = hw - MARGIN; const hiX = W - hw + MARGIN;
  const x = whole || !focus || loX > hiX ? W / 2 : Math.max(loX, Math.min(hiX, focus.x));
  return { x, y };
}
function placeCamera(want: { x: number; y: number; dist: number; yaw: number; lift?: number }, dt: number, kick: number): void {
  if (!view3.dist) Object.assign(view3, want);
  // A watcher's switch glides, never a cut; the zoom and the turn ease a little slower than the pan.
  const kp = 1 - Math.exp(-dt * 12); const kd = 1 - Math.exp(-dt * 7);
  view3.x += (want.x - view3.x) * kp; view3.y += (want.y - view3.y) * kp; view3.dist += (want.dist - view3.dist) * kd; view3.yaw += (want.yaw - view3.yaw) * kd;
  const [tx, tz] = XZ(view3.x, view3.y);
  const kx = kick ? (lab.random() - 0.5) * 2 * kick : 0; const kz = kick ? (lab.random() - 0.5) * 2 * kick : 0;
  const back = Math.cos(PITCH) * view3.dist;
  // `lift`: the point looked at stands this high (the hero intro looks at a hero's chest, not its feet).
  const lift = want.lift ?? 0;
  camera.position.set(tx + kx + Math.sin(view3.yaw) * back, Math.sin(PITCH) * view3.dist + lift, tz + kz + Math.cos(view3.yaw) * back);
  camera.lookAt(tx + kx, lift, tz + kz);
  camera.updateMatrixWorld();
  // The sun's shadow box follows what the camera looks at (a little toward the far side, where the view widens).
  if (REAL_SHADOWS) { sun.target.position.set(tx, 0, tz - view3.dist * 0.25); sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 40); }
  const fog = LIGHT.fog ?? 0.35;
  const f = scene.fog as Fog;
  // A light haze far off only: the woods beyond the clearing stay clear.
  f.near = view3.dist * (2.6 - fog * 0.6); f.far = view3.dist * (6 - fog * 1.5);
}

/* ------------------------------------------------------------------ size */
let dpr = 1;
function resize(): void {
  const phone = Math.min(innerWidth, innerHeight) <= 540;
  // Pixel budgets: 1.5 on a phone, 2 on a computer; the HUD's text stays sharp at the screen's own.
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, phone ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / Math.max(1, innerHeight); camera.updateProjectionMatrix();
  dpr = Math.min(2, devicePixelRatio || 1);
  hudCanvas.width = Math.round(innerWidth * dpr); hudCanvas.height = Math.round(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

/* ------------------------------------------------------------------ draw */
/** Where the hot zone's "×2" sits on the screen this frame: names keep off it. */
let zoneMark: { left: number; top: number; right: number; bottom: number } | null = null;
const labels = createLabels({ screen: () => ({ w: innerWidth, h: innerHeight }), avoid: () => (zoneMark ? [zoneMark] : []) });
let shownLabels: LabelOut[] = [];
// Room chat (NETPLAY.md section 19): what a player says in the room's chat shows over their hero for a few seconds,
// on the HUD's own paper (one UI with the names, the clock and the board). The studio taking a message down takes it too.
const BUBBLE_TYPE = `600 14px ${FONT_BODY}`;
const bubbles = createBubbles({ measure: (t) => { ctx.font = BUBBLE_TYPE; return ctx.measureText(t).width; }, screen: () => ({ w: innerWidth, h: innerHeight }), avoid: () => (zoneMark ? [zoneMark] : []) });
net.on('say', (s) => bubbles.say(s.seat, s.text, { id: s.id, kind: s.kind }));
net.on('unchat', (e) => { for (const id of e.ids) bubbles.remove(id); });
let shownBubbles: BubbleOut[] = [];
let lastDraw = 0;
/** Where a seat's body is drawn now (host: the real body; replica: interpolated), or null. */
function seatPos(seat: number): { x: number; y: number } | null {
  if (seat === mySeat() && me.has && !net.watching) return me;
  const d = [...drawn.values()].find((x) => x.seat === seat);
  return d ? { x: d.x, y: d.y } : null;
}
/** The hero intro: how long, and how close it starts (a share of the game's own distance). */
const INTRO_MS = 2600;
const INTRO_CLOSE = 0.38;
const INTRO_PITCH = (24 * Math.PI) / 180;
let introAt = 0;
const v3 = new Vector3();
/** A point on the meadow (rules x, y, h metres up) on the screen, CSS px. */
function onScreen(x: number, y: number, h: number, cw: number, ch: number): { x: number; y: number; ok: boolean } {
  const [px, pz] = XZ(x, y);
  v3.set(px, h, pz).project(camera);
  return { x: ((v3.x + 1) / 2) * cw, y: ((1 - v3.y) / 2) * ch, ok: v3.z < 1 };
}
const mtx = new Matrix4(); const quat = new Quaternion(); const eul = new Euler(); const vpos = new Vector3(); const vscl = new Vector3(); const tint = new Color();

function draw(t: number, dt: number): void {
  const cw = innerWidth; const ch = innerHeight;
  const phone = Math.min(cw, ch) <= 540;
  // The view: my own body, or (a watcher) the followed player's, drawn exactly as their own browser frames it.
  const view = viewSeat();
  const followed = net.watching && view !== null ? seatPos(view) : null;
  const overview = net.watching ? !followed : mySeat() === null;
  const focus = net.watching ? followed : overview || !me.has ? null : me;
  // The Game Lab's views (outside the lab: the game's own camera, always).
  const lv = labView();
  const whole = overview || Boolean(lv?.whole);
  // Only a watcher's overview on a tall screen turns (nobody steers there): the arena's long side runs up the screen.
  const turned = overview && ch > cw * 1.15;
  // A player's own phone held upright: steeper and closer, so the action fills it (the overview keeps style.json's).
  const upright = phone && !whole && ch > cw * 1.15;
  setPitch(upright ? UPRIGHT_PITCH : PITCH0);
  const dist = whole ? wholeDistance(cw, ch, turned) : followDistance(cw, ch, phone, upright) / (lv?.zoom ?? 1);
  const aim = aimAt(lv?.zoom ? subjectAt() ?? focus : focus, dist, cw, ch, whole, turned, upright);
  // The camera's kick (a bump you were in): a few centimetres, gone in a fifth of a second.
  const kick = t - kickAt < 200 ? T.shake * (1 - (t - kickAt) / 200) ** 2 : 0;
  // A seat taken: the camera opens close on your own hero (its idle, its face, the clip library at work) and pulls
  // back to the game's view over INTRO_MS. Never in the Game Lab, never for a watcher.
  let want: { x: number; y: number; dist: number; lift?: number } = { ...aim, dist };
  if (focus && !net.watching && !lab.on) {
    // It starts with a live round (a seat taken during the results waits for the next one, under the results card)
    // the moment the game is playable: the arrival card lifts on the hero's own model (its stand-in only when the model
    // is still not in after about five seconds), so the close-up is the first thing the player sees.
    if (!introAt && round?.phase === 'live' && playableAt) introAt = t;
    const u = introAt ? Math.min(1, (t - introAt) / INTRO_MS) : 1;
    if (u < 1) {
      const e = u < 0.35 ? 0 : (u - 0.35) / 0.65; const k = e * e * (3 - 2 * e);
      // Looking at the hero's chest: the whole hero, head to feet, in the middle of the screen.
      const fy = focus.y - 0.2;
      want = { x: focus.x + (aim.x - focus.x) * k, y: fy + (aim.y - fy) * k, dist: dist * (INTRO_CLOSE + (1 - INTRO_CLOSE) * k), lift: HERO_M * 0.55 * (1 - k) };
      // Lower too, at first: its face, not the top of its hat.
      setPitch(PITCH + (INTRO_PITCH - PITCH) * (1 - k));
      if (u === 0 || !view3.dist) Object.assign(view3, want, { yaw: 0 });
    }
  } else if (!focus) introAt = 0;
  placeCamera({ ...want, yaw: turned ? -Math.PI / 2 : 0 }, dt, kick);
  flames.forEach((f, i) => { const k = 1 + 0.14 * Math.sin(t / 95 + i * 2) + 0.06 * Math.sin(t / 37 + i); f.children[0]?.scale.set(1, k, 1); f.children[1]?.scale.set(1, 2 - k, 1); });

  // hot zone (keyed state): gems inside score double
  zoneFill.visible = zoneRing.visible = Boolean(zone);
  if (zone) {
    const pulse = 0.5 + 0.5 * Math.sin(t / 300);
    const [zx, zz] = XZ(zone.x, zone.y);
    zoneFill.position.set(zx, 0.014, zz); zoneFill.scale.setScalar(zone.r);
    (zoneFill.material as MeshBasicMaterial).opacity = 0.14 + 0.1 * pulse;
    zoneRing.position.set(zx, 0.02, zz); zoneRing.scale.setScalar(zone.r); zoneRing.rotation.y = t / 4000;
  }

  // gems: spinning, bobbing, glowing; a taken one bursts into gold where it was
  const gemList: { x: number; y: number; id: number }[] = gems;
  const rn = round?.n ?? -1;
  const seenNow = new Set<number>();
  let nb = 0;
  for (const g of gemList) seenNow.add(g.id);
  if (rn === lastGemRound) for (const [id, p] of lastGems) if (!seenNow.has(id)) sparkle(p.x, p.y);
  lastGems.clear(); lastGemRound = rn;
  for (let i = 0; i < Math.min(gemList.length, GEM_CAP); i += 1) {
    const g = gemList[i] as { x: number; y: number; id: number };
    lastGems.set(g.id, { x: g.x, y: g.y });
    const [gx, gz] = XZ(g.x, g.y);
    const bob = 0.5 + 0.5 * Math.sin(t / 300 + g.id);
    const sc = 1 + 0.12 * Math.sin(t / 200 + g.id);
    // A coin stands on its edge and spins (the model lies flat: up on its edge first, then turned about the up axis).
    mtx.compose(vpos.set(gx, 0.42 + 0.14 * bob, gz), quat.setFromEuler(eul.set(Math.PI / 2, t / 420 + g.id, 0, 'YXZ')), vscl.setScalar(sc * GEM_DRAWN * gemFit));
    for (const c of gemParts) placeCopy(c, i, mtx);
    glows.setMatrixAt(i, mtx.compose(vpos.set(gx, 0, gz), quat.identity(), vscl.set(0.75 + 0.1 * bob, 1, 0.75 + 0.1 * bob)));
    blobs.setMatrixAt(nb++, mtx.compose(vpos.set(gx, 0, gz), quat.identity(), vscl.set(0.32 - 0.06 * bob, 1, 0.32 - 0.06 * bob)));
  }
  const ng = Math.min(gemList.length, GEM_CAP);
  for (const { mesh: im } of gemParts) { im.count = ng; im.instanceMatrix.needsUpdate = true; }
  glows.count = ng; glows.instanceMatrix.needsUpdate = true;

  // swings: a slash arcs in front of the swinger as the swing lands (after its windup); a hit rings white
  let nw = 0; let ns2 = 0;
  for (let i = waves.length - 1; i >= 0; i -= 1) {
    const w = waves[i] as (typeof waves)[number];
    const lead = w.knock ? 0 : T.windupMs * 0.75;
    const age = (t - w.at - lead) / T.ringMs;
    if (age > 1) { waves.splice(i, 1); continue; }
    if (age < 0) continue;
    const [wx, wz] = XZ(w.x, w.y);
    if (w.knock) {
      const m = waveMesh(nw++);
      const r = R_AV + 0.12 + age * 0.8;
      m.visible = true; m.position.set(wx, 0.03, wz); m.scale.set(r, 1, r);
      const mat = m.material as MeshBasicMaterial; mat.color.set(w.colour); mat.opacity = 1 - age;
    } else {
      const m = slashMesh(ns2++);
      const fa = w.fa ?? 0;
      const r = 0.55 + Math.min(1, age * 2.2) * (T.knockRange - 0.55);
      m.visible = true; m.position.set(wx, 0.55, wz); m.rotation.set(0, fa, 0); m.scale.set(r, 1, r);
      const mat = m.material as MeshBasicMaterial; mat.color.set(w.colour); mat.opacity = 0.85 * (1 - age) ** 1.5;
    }
  }
  for (let i = nw; i < wavePool.length; i += 1) (wavePool[i] as Mesh).visible = false;
  for (let i = ns2; i < slashPool.length; i += 1) (slashPool[i] as Mesh).visible = false;

  // the heroes
  const names = new Map<number, Slot>((net.slots ?? []).map((s) => [s.slot, s]));
  // `mine`: the body whose view this is: my own, or the player a watcher follows (named, never "You").
  const list: { slot: number; seat: number | null; x: number; y: number; h: number; bot: boolean; name: string; mine: boolean }[] = [];
  const isView = (seat: number | null, bot: boolean): boolean => !bot && seat !== null && seat === view;
  {
    for (const d of drawn.values()) {
      const own = !net.watching && d.seat >= 0 && d.seat === net.seat;
      const s = names.get(d.slot);
      list.push({ slot: d.slot, seat: d.seat >= 0 ? d.seat : null, x: own && me.has ? me.x : d.x, y: own && me.has ? me.y : d.y, h: own && me.has ? me.h : d.h, bot: d.seat < 0, name: s?.name ?? (d.seat >= 0 ? `Player ${d.seat + 1}` : botName(d.slot)), mine: isView(d.seat >= 0 ? d.seat : null, d.seat < 0) });
    }
  }
  const over = round?.phase === 'over';
  const places = new Map<number, number>((over ? round?.results ?? [] : []).map((r) => [r.slot, r.place]));
  let nr = 0;
  youRing.visible = false;
  for (const a of list) {
    const colour = colourOf(a.slot, a.bot ? null : a.seat);
    const fx = bodyFx(a.slot, t);
    const hero = heroFor(a.slot, heroKind(a.slot, a.seat, a.bot), colour);
    hero.seen = frames; hero.mine = a.mine;
    poseHero(hero, a, t, dt, fx, places.get(a.slot) ?? null, over);
    const [bx, bz] = XZ(a.x + fx.ox, a.y + fx.oy);
    seatRings.setMatrixAt(nr, mtx.compose(vpos.set(bx, 0, bz), quat.identity(), vscl.setScalar(1)));
    seatEdges.setMatrixAt(nr, mtx);
    seatRings.setColorAt(nr, tint.set(a.bot ? mixHex(colour, '#9aa3ad', 0.55) : colour));
    nr += 1;
    // The shadow stays on the ground and shrinks as the hero rises.
    const lift = Math.max(0.45, 1 - a.h * 0.45);
    blobs.setMatrixAt(nb++, mtx.compose(vpos.set(bx, 0, bz), quat.identity(), vscl.set(0.55 * fx.sx * lift, 1, 0.55 * fx.sy * lift)));
    if (a.mine) { youRing.visible = true; youRing.position.set(bx, 0.024, bz); youRing.scale.setScalar(1 + 0.05 * Math.sin(t / 220)); }
  }
  // Far and off-screen heroes pose less often (a room of many on a phone).
  crowd([...heroes.values()].map((x) => x.char).filter((c): c is Character => Boolean(c)), camera, { near: 16, far: 30 });
  // Bodies that left: their heroes go.
  for (const [slot, hero] of heroes) if (hero.seen !== frames) { clearHero(hero); scene.remove(hero.root); heroes.delete(slot); }
  seatRings.count = nr; seatRings.instanceMatrix.needsUpdate = true; seatEdges.count = nr; seatEdges.instanceMatrix.needsUpdate = true; if (seatRings.instanceColor) seatRings.instanceColor.needsUpdate = true;
  blobs.count = nb; blobs.instanceMatrix.needsUpdate = true;

  // sparks
  let ns = 0;
  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const sp = sparks[i] as (typeof sparks)[number];
    const age = t - sp.at;
    if (age > sp.life) { sparks.splice(i, 1); continue; }
    if (!sp.gold && age < T.hitStopMs * 0.5) continue;
    const u = age / sp.life; const s = (age / 1000) * (1 - u * 0.5);
    const [sx, sz] = XZ(sp.x + sp.vx * s, sp.y + sp.vy * s);
    const h = sp.h + sp.vh * s - 4.9 * s * s;
    const len = Math.hypot(sp.vx, sp.vy) * 0.022 * (1 - u) + 0.05;
    mtx.compose(vpos.set(sx, Math.max(0.05, h), sz), quat.setFromEuler(eul.set(0, Math.atan2(-sp.vy, sp.vx), 0)), vscl.set(len, 1.6 * (1 - u) + 0.3, 1.6 * (1 - u) + 0.3));
    sparkMesh.setMatrixAt(ns, mtx);
    sparkMesh.setColorAt(ns, tint.set(sp.gold ? (u < 0.3 ? '#ffffff' : COL.gem) : u < 0.4 ? '#ffffff' : '#ffd166'));
    ns += 1;
    if (ns >= 160) break;
  }
  sparkMesh.count = ns; sparkMesh.instanceMatrix.needsUpdate = true; if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;

  if (lab.on) { pen.begin(); lab.draw(pen); pen.end(); }
  renderer.render(scene, camera);
  arrival(t);

  // ---- the HUD, over the world
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  // the hot zone's "×2", on the screen over its middle; over its far or near edge instead when the hero whose view
  // this is stands under its middle (the mark never covers your own hero)
  zoneMark = null;
  if (zone) {
    const size = phone ? 20 : 24;
    const own = list.find((a) => a.mine);
    const covers = (p: { x: number; y: number }): boolean => {
      if (!own) return false;
      const head = onScreen(own.x, own.y, HERO_M + own.h, cw, ch); const foot = onScreen(own.x, own.y, 0, cw, ch);
      const r = Math.max(14, Math.abs(onScreen(own.x + 0.5, own.y, 0, cw, ch).x - foot.x));
      return Math.abs(p.x - foot.x) < r + size && p.y > head.y - size && p.y < foot.y + size;
    };
    let z = onScreen(zone.x, zone.y, 0, cw, ch);
    for (const dy of [-0.72, 0.72]) { if (!covers(z)) break; z = onScreen(zone.x, zone.y + dy * zone.r, 0, cw, ch); }
    if (z.ok) {
      ctx.font = `700 ${size}px ${FONT_DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.strokeText('×2', z.x, z.y); ctx.fillStyle = PAL.accent; ctx.fillText('×2', z.x, z.y);
      const half = ctx.measureText('×2').width / 2 + 3;
      zoneMark = { left: z.x - half, top: z.y - size * 0.6, right: z.x + half, bottom: z.y + size * 0.6 };
    }
  }
  // Names go on the screen, so they read at one size on any screen and never pile up.
  const fs = Math.round(Math.max(15, Math.min(22, (15 * Math.min(cw, ch)) / 720)));
  ctx.font = `700 ${fs}px ${FONT_BODY}`;
  const tags: LabelIn[] = [];
  const heads = new Map<number, { x: number; y: number; seat: number; mine: boolean }>();
  const viewAt = list.find((a) => a.mine) ?? null;
  for (const a of list) {
    const text = a.mine && !net.watching ? `You · ${heroName(heroKind(a.slot, a.seat, a.bot))}` : label(a.name, a.bot);
    const head = onScreen(a.x, a.y, HERO_M + 0.12 + a.h, cw, ch);
    const mid = onScreen(a.x, a.y, HERO_M * 0.45 + a.h, cw, ch);
    const side = onScreen(a.x + R_AV, a.y, HERO_M * 0.45 + a.h, cw, ch);
    if (!head.ok) continue;
    const r = Math.max(6, Math.hypot(side.x - mid.x, side.y - mid.y));
    if (mid.x + r < 0 || mid.x - r > cw || head.y > ch || mid.y + r < 0) continue; // off screen: no name at the edge
    const foot = onScreen(a.x, a.y, 0, cw, ch);
    if (a.seat !== null && !a.bot) heads.set(a.slot, { x: head.x, y: head.y - 3, seat: a.seat, mine: a.mine });
    // People before bots, nearer the view's body first; each keeps off the others' bodies when it can.
    tags.push({ key: a.slot, text, x: head.x, y: head.y - 3, w: ctx.measureText(text).width, h: fs * 1.2, below: foot.y + r * 0.6 + 4 + fs * 1.2, body: { left: mid.x - r, top: head.y, right: mid.x + r, bottom: foot.y + r * 0.4 }, self: a.mine, rank: (a.bot ? 10_000 : 0) + (viewAt ? Math.hypot(a.x - viewAt.x, a.y - viewAt.y) * 50 : 0) });
  }
  shownLabels = labels.place(tags, Math.min(0.1, (t - (lastDraw || t)) / 1000));
  lastDraw = t;
  ctx.font = `700 ${fs}px ${FONT_BODY}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const l of [...shownLabels].sort((x, y) => Number(Boolean(x.self)) - Number(Boolean(y.self)))) {
    if (l.alpha <= 0) continue;
    ctx.globalAlpha = l.alpha;
    if (l.moved) {
      // Off its own spot: a thin line to its body says whose it is.
      const under = l.top > l.y;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(l.cx, under ? l.top : l.bottom); ctx.lineTo(l.x, under ? (l.body?.bottom ?? l.top - 6) : l.y + 2); ctx.stroke();
    }
    // Every name on the HUD's paper (yours fuller, a bot's fainter): one UI with the clock and the board.
    ctx.fillStyle = PAPER; ctx.globalAlpha = l.alpha * (l.self ? 0.94 : 0.8); ctx.beginPath(); ctx.roundRect(l.left - 6, l.top - 1, l.right - l.left + 12, l.bottom - l.top + 2, 8); ctx.fill(); ctx.globalAlpha = l.alpha;
    ctx.fillStyle = l.self ? TEXT : mixHex(TEXT, PAPER, 0.25);
    ctx.fillText(l.text, l.cx, l.cy);
  }
  ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
  // Speech bubbles (room chat): over each speaker's name pill, the view's own player first.
  if (bubbles.size) {
    const anchors: BubbleIn[] = [];
    for (const [slot, h] of heads) {
      const l = shownLabels.find((x) => x.key === slot && x.alpha > 0 && !x.moved);
      anchors.push({ key: h.seat, x: l ? l.cx : h.x, y: l ? l.top - 3 : h.y, self: h.mine });
    }
    shownBubbles = bubbles.place(anchors);
    paintBubbles(ctx, shownBubbles, { font: BUBBLE_TYPE, paper: PAPER, ink: TEXT, edge: mixHex(TEXT, PAPER, 0.7) });
  } else shownBubbles = [];

  // A dodge pops a word over the jumper, rising and fading.
  for (let i = pops.length - 1; i >= 0; i -= 1) {
    const pp = pops[i] as (typeof pops)[number];
    const age = (t - pp.at) / 900;
    if (age > 1) { pops.splice(i, 1); continue; }
    const who = list.find((x) => x.slot === pp.slot);
    if (!who) continue;
    const at = onScreen(who.x, who.y, HERO_M + 0.6 + who.h + age * 0.6, cw, ch);
    if (!at.ok) continue;
    ctx.globalAlpha = Math.min(1, (1 - age) * 2);
    ctx.font = `700 ${phone ? 18 : 22}px ${FONT_DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(pp.text, at.x, at.y); ctx.fillStyle = PAL.accent2; ctx.fillText(pp.text, at.x, at.y);
    ctx.globalAlpha = 1;
  }
  // A big screen's HUD is drawn larger (up to 1.35 times at 840 px and taller), so it reads from the sofa as well.
  const ui = phone ? 1 : Math.max(1, Math.min(1.35, Math.min(cw, ch) / 620));
  ctx.save(); ctx.scale(ui, ui);
  hud(cw / ui, ch / ui, phone, list);
  ctx.restore();
  // The touch buttons, bottom right: Jump (the bigger, nearer the thumb) and Swing. Only on a touch screen.
  buttons.length = 0;
  if (touched && mySeat() !== null && !net.watching) {
    const r = phone ? 34 : 40; const pad = phone ? 18 : 26;
    const jx = cw - pad - r; const jy = ch - pad - r - 6;
    const sx = jx - r * 2.3; const sy = jy - r * 0.55;
    for (const b of [{ id: 'jump' as const, x: jx, y: jy, r, label: 'Jump' }, { id: 'swing' as const, x: sx, y: sy, r: r * 0.92, label: 'Swing' }]) {
      const pressed = t - (prevButtons.get(b.id) ?? -1e9) < 160;
      ctx.globalAlpha = pressed ? 0.95 : 0.78;
      ctx.fillStyle = b.id === 'jump' ? PAPER : HOT;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (pressed ? 0.92 : 1), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = b.id === 'jump' ? TEXT : '#ffffff'; ctx.font = `700 ${phone ? 14 : 16}px ${FONT_BODY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x, b.y + 1);
      buttons.push({ id: b.id, x: b.x, y: b.y, r: b.r, at: prevButtons.get(b.id) ?? 0 });
    }
  }
  if (stick.active) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(stick.ox, stick.oy, 56, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(29,43,58,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(stick.ox, stick.oy, 58, 0, Math.PI * 2); ctx.stroke();
    const dx = stick.x - stick.ox; const dy = stick.y - stick.oy; const len = Math.hypot(dx, dy); const m = len > 56 ? 56 / len : 1;
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.arc(stick.ox + dx * m, stick.oy + dy * m, 24, 0, Math.PI * 2); ctx.fill();
  }
}

/** When each touch button was last pressed (for its press look). */
const prevButtons = new Map<string, number>();
canvas.addEventListener('pointerdown', (e) => { const b = buttonAt(e.clientX, e.clientY); if (b) prevButtons.set(b.id, performance.now()); });
/** A rounded panel behind HUD text (style.json's "chips"): the palette's ink, a little see-through. */
function chip(x: number, y: number, w: number, h: number, alpha = 0.88): void {
  ctx.fillStyle = PAPER; ctx.globalAlpha = Math.max(alpha, 0.82);
  ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(12, h / 2)); ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * THE ARRIVAL (NETPLAY.md section 21; createNetplay's `arrival: 'game'`). Until this game says it is playable, the play
 * page shows its arrival card: the game's title and art, and a progress line this game feeds (`net.loading`: the
 * characters first, "the heroes", then "the clearing"). It is playable once the round's state is in (a host has its
 * round; anyone else has drawn a snapshot) and the hero whose view this is stands there in its real model, drawn this
 * frame; or, when its model is still not in after about five seconds, with its stand-in. A watcher's overview waits for
 * every hero in view instead. Then `net.playable()`, once, and the hero intro starts under the lifting card.
 * The game drew its own title card at a round's start before the page had one: the arrival card is that title now, so
 * the round opens on the hero, with nothing over it. performance marks `hero:model` (your hero's real model first drawn)
 * and `hero:playable` say when, for a harness.
 */
const BOOT_AT = performance.now();
let playableAt = 0;
let modelAt = 0;
function arrival(t: number): void {
  const view = [...heroes.values()].find((h) => h.mine) ?? null;
  if (!modelAt && view?.char && !net.watching) { modelAt = t; try { performance.mark('hero:model'); } catch { /* old browser */ } }
  if (playableAt) return;
  const stateIn = Boolean(round) && (drawn.size > 0);
  const dressed = view ? Boolean(view.char) : heroes.size > 0 && [...heroes.values()].every((h) => h.char);
  if (!stateIn || (!dressed && performance.now() - BOOT_AT < 5000)) return;
  playableAt = t;
  try { performance.mark('hero:playable'); } catch { /* old browser */ }
  net.playable();
}

function hud(cw: number, ch: number, phone: boolean, list: { slot: number; seat: number | null; name: string; bot: boolean; mine: boolean }[]): void {
  const pad = phone ? 12 : 18;
  const debugStrip = new URLSearchParams(location.search).get('debug') === '1' || (window as unknown as { HOMIE_NET?: { debug?: boolean } }).HOMIE_NET?.debug;
  const top = pad + (debugStrip ? (phone ? 50 : 26) : 0);
  const now = net.now();
  const r = round;
  // the clock
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = `700 ${phone ? 19 : 22}px ${FONT_DISPLAY}`;
  const left = r ? Math.max(0, Math.ceil((r.endsAt - now) / 1000)) : 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const said = r ? (r.phase === 'live' ? `Round ${r.n} · ${clock}` : `Next round in ${left}`) : 'Joining…';
  const cwid = ctx.measureText(said).width;
  const chH = phone ? 34 : 40;
  chip(pad, top, cwid + 26, chH);
  ctx.fillStyle = r?.phase === 'live' && left <= 10 ? PAL.danger : TEXT;
  ctx.fillText(said, pad + 13, top + chH / 2 + 1);
  // scores: the play page's room button (and a server's pill beside it) sit at the top right (game.json screen.share's
  // default): the scores start under that band, so the buttons never cover a score.
  const scores = new Map<number, number>();
  for (const d of drawn.values()) scores.set(d.slot, d.score);
  // A phone's board is compact (the top three, a short name and a small "bot" or "AI" tag after it; a bot's dot is
  // hollow), so a game's own HUD at the top left (a basket, a timer) has room beside it. Every bot and AI says so.
  const rows = [...list].sort((a, b) => (scores.get(b.slot) ?? 0) - (scores.get(a.slot) ?? 0)).slice(0, phone ? 3 : 6);
  const TAG_FONT = `800 10px ${FONT_BODY}`;
  ctx.font = TAG_FONT;
  const marks = rows.map((a) => (!phone || (a.mine && !net.watching) ? '' : a.name.endsWith(AI_MARK) ? 'AI' : a.bot ? 'bot' : ''));
  const markW = marks.map((m) => (m ? ctx.measureText(m).width + 10 : 0));
  ctx.font = `700 ${phone ? 13 : 16}px ${FONT_BODY}`;
  const rowH = phone ? 20 : 25;
  const fit = (t: string, max: number): string => { let x = t; while (x.length > 3 && ctx.measureText(x).width > max) x = `${x.slice(0, -2)}…`; return x; };
  const texts = rows.map((a, i) => (a.mine && !net.watching ? 'You' : phone ? fit(a.name.replace(AI_MARK, '').trim(), 104 - (markW[i] ? (markW[i] as number) + 5 : 0)) : label(a.name, a.bot)));
  const nameW = Math.max(0, ...texts.map((x, i) => ctx.measureText(x).width + (markW[i] ? (markW[i] as number) + 5 : 0)));
  const boardW = nameW + (phone ? 56 : 74);
  // Together: the room's total heads the board, which moves down by a row so it stays under the room buttons.
  const board = top + 18 + 44 - rowH / 2 + (TOGETHER ? rowH + 6 : 0);
  if (TOGETHER) {
    // One total for the room, then each share (no places): a cozy room works as one.
    const total = [...scores.values()].reduce((n, v) => n + v, 0);
    const head = `Together · ${total}`;
    ctx.font = `700 ${phone ? 15 : 17}px ${FONT_DISPLAY}`;
    const hw = Math.max(boardW, ctx.measureText(head).width + 28);
    chip(cw - pad - hw, board - 6 - (rowH + 6), hw, rowH + 6 + rows.length * rowH + 12, 0.7);
    ctx.textAlign = 'left'; ctx.fillStyle = HOT;
    ctx.fillText(head, cw - pad - hw + 14, board - rowH / 2 + 1);
    ctx.font = `700 ${phone ? 13 : 16}px ${FONT_BODY}`;
  } else if (rows.length) chip(cw - pad - boardW, board - 6, boardW, rows.length * rowH + 12, 0.7);
  rows.forEach((a, i) => {
    const y = board + i * rowH + rowH / 2;
    const colour = colourOf(a.slot, a.bot ? null : a.seat);
    ctx.fillStyle = a.bot ? mixHex(colour, '#9aa3ad', 0.55) : colour;
    ctx.beginPath(); ctx.arc(cw - pad - boardW + 14, y, 5, 0, Math.PI * 2);
    if (a.bot && phone) { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2; ctx.stroke(); } else ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = a.mine ? TEXT : mixHex(TEXT, PAPER, a.bot ? 0.42 : 0.15);
    ctx.fillText(texts[i] as string, cw - pad - boardW + 26, y + 1);
    const mark = marks[i];
    if (mark) {
      // The tag: a small pill after the name, the HUD's ink on its paper.
      const mx = cw - pad - boardW + 26 + ctx.measureText(texts[i] as string).width + 5; const mw = markW[i] as number;
      ctx.fillStyle = mixHex(TEXT, PAPER, 0.8); ctx.beginPath(); ctx.roundRect(mx, y - 7, mw, 14, 7); ctx.fill();
      ctx.font = TAG_FONT; ctx.fillStyle = mixHex(TEXT, PAPER, 0.15); ctx.fillText(mark, mx + 5, y + 1);
      ctx.font = `700 ${phone ? 13 : 16}px ${FONT_BODY}`;
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = a.mine ? HOT : TEXT;
    ctx.fillText(String(scores.get(a.slot) ?? 0), cw - pad - 12, y + 1);
  });
  // The role badge (host, replica, watching): a debugging aid, only with ?debug=1 (a player never needs it).
  if (debugStrip) {
    ctx.textAlign = 'left'; ctx.font = '600 11px ui-monospace, Menlo, monospace';
    const badge = net.offline ? 'OFFLINE HOST' : net.watching ? 'WATCHING' : net.role.toUpperCase();
    chip(pad - 4, ch - pad - 16, ctx.measureText(badge).width + 12, 20, 0.55);
    ctx.fillStyle = mixHex(TEXT, PAPER, 0.2);
    ctx.fillText(badge, pad + 2, ch - pad - 5);
  }
  if (r && r.phase === 'over' && r.results) {
    // The results card: the palette's own paper and ink, the winner in gold.
    const w = Math.min(380, cw - 32); const h = 64 + Math.min(6, r.results.length) * 30;
    const x = (cw - w) / 2; const y = (ch - h) / 2;
    ctx.fillStyle = mixHex(PAPER, '#ffffff', 0.35); ctx.globalAlpha = 0.96;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 18); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = TEXT; ctx.globalAlpha = 0.12; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.fillStyle = HOT; ctx.font = `700 ${phone ? 20 : 22}px ${FONT_DISPLAY}`;
    const sum = r.results.reduce((n, row) => n + row.score, 0);
    ctx.fillText(TOGETHER ? `Together: ${sum}` : `Round ${r.n} results`, cw / 2, y + 32);
    ctx.font = `700 ${phone ? 15 : 16}px ${FONT_BODY}`;
    const view = viewSeat();
    r.results.slice(0, 6).forEach((row, i) => {
      const mine = !row.bot && row.seat !== null && row.seat === view;
      const ry = y + 66 + i * 30;
      if (mine) { ctx.fillStyle = PAL.gold; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.roundRect(x + 14, ry - 13, w - 28, 26, 10); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.fillStyle = row.bot ? mixHex(TEXT, PAPER, 0.4) : TEXT;
      ctx.fillText(`${TOGETHER ? '' : `${row.place}. `}${mine && !net.watching ? 'You' : label(row.name, row.bot)}${mine && net.watching ? ' ◂' : ''} — ${row.score}`, cw / 2, ry + 1);
    });
  }
  // Only a browser that WAS in its room is reconnecting; one still joining, or stopped for good, is not (section 22).
  if (net.link === 'reconnecting' && net.role !== 'host') {
    ctx.textAlign = 'center'; ctx.font = `700 15px ${FONT_BODY}`;
    const text = 'Reconnecting…'; const tw = ctx.measureText(text).width;
    chip(cw / 2 - tw / 2 - 12, ch - pad - 24, tw + 24, 26);
    ctx.fillStyle = HOT; ctx.fillText(text, cw / 2, ch - pad - 10);
  }
  // The controls, for the first eight seconds of play (from the moment the arrival card lifts), above the touch
  // buttons when there are some, never under them.
  if (playableAt && performance.now() - playableAt < 8000 && mySeat() !== null && !net.watching) {
    ctx.textAlign = 'center'; ctx.font = `700 ${phone ? 14 : 16}px ${FONT_BODY}`;
    const text = phone ? 'Drag to move · Jump and Swing on the right' : 'WASD to move · Space jumps · F or click swings';
    const tw = ctx.measureText(text).width;
    const y = ch - pad - 56 - (touched ? (phone ? 96 : 110) : 0);
    chip(cw / 2 - tw / 2 - 12, y, tw + 24, 26, 0.6);
    ctx.fillStyle = TEXT; ctx.fillText(text, cw / 2, y + 14);
  }
  ctx.textBaseline = 'alphabetic';
}

/* ------------------------------------------------------------------ loop */
let lastT = -1;
function frame(t: number): void {
  const dt = lab.time.dt(t, 0.05);
  // The look's own clock (the animals' clips): real seconds, at most a tenth, whatever the rules' step.
  const ddt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, (t - lastT) / 1000)); lastT = t;
  updateView();
  if (lab.on) labReport(dt);
  draw(t, lab.on ? dt : ddt);
  frames += 1;
  requestAnimationFrame(frame);
}

net.expose({
  // Room chat's bubbles on this screen now: whose, what, and where (an end-to-end test reads them).
  bubbles: () => shownBubbles.map((b) => ({ seat: b.key, text: b.lines.join(' '), alpha: b.alpha, left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) })),
  self: () => (me.has ? { x: me.x, y: me.y, z: me.h } : null),
  peer: (seat: number) => {
    const d = [...drawn.values()].find((x) => x.seat === seat);
    return d ? { x: d.x, y: d.y, z: d.h } : null;
  },
  frames: () => frames,
  scores: () => [...drawn.values()].map(d => ({ slot: d.slot, seat: d.seat >= 0 ? d.seat : null, bot: d.seat < 0, score: d.score })),
  pickups: () => { const slots: unknown[] = []; room.each('runner', e => slots.push({ slot: e.seat, bot: e.driver === 'bot', gems: e.pickups })); return { round, slots }; },
  waves: () => wavesSeen,
  knocks: () => knocksSeen,
  zone: () => zone,
  movement: () => 'server',
  /** Where the camera looks (rules metres), how far away it is, its turn, and whose view it is. */
  camera: () => ({ x: view3.x, y: view3.y, dist: view3.dist, yaw: view3.yaw, view: viewSeat() }),
  /** The names as drawn (boxes, never the text): the e2e probe counts overlaps and checks your own. */
  labels: () => shownLabels.map((l) => ({ self: Boolean(l.self), alpha: l.alpha, moved: l.moved, left: Math.round(l.left), top: Math.round(l.top), right: Math.round(l.right), bottom: Math.round(l.bottom) })),
  /** performance.now() of the first keyed-state value and the first live snapshot this browser received. */
  arrivals: () => ({ firstStateAt, firstSnapAt }),
  /** The last frame's draw calls and triangles (renderer.info), against the phone budgets (100 and 150k). */
  drawCalls: () => renderer.info.render.calls,
  triangles: () => renderer.info.render.triangles,
  /** The models: how many loaded, their triangles, texture memory and bytes, and any refused (with why). */
  models: () => ({ ...models.stats(), standIns: [...standIns], heroes: [...heroes.values()].map(h => ({ slot: h.slot, state: h.char?.state })) }),

  heroes: () => [...heroes.values()].map((h) => ({ slot: h.slot, hero: h.kind, state: h.char?.state ?? 'LOADING', verbs: h.char?.verbs ?? [], lod: h.char?.lod ?? null, family: h.char?.family ?? null })),
  jumps: () => jumpsSeen,
  dodges: () => dodgesSeen,
  /** Harness hooks for this screen's own player: jump, swing. */
  debugJump: () => { const accepted = Boolean(room.me?.grounded); jump(); return accepted; },
  debugSwing: () => { swing(); return true; },

});

exposePort(net, {
  view: 'top',
  self: () => (me.has && mySeat() !== null ? { x: me.x, y: me.y } : null),
  size: R_AV,
  score: () => { const seat = mySeat(); const b = [...drawn.values()].find((x) => x.seat === seat); return b ? b.score : null; },
  // The renderer's own counters, by the names `homie-studio perf` and the playtest read on the port probe (measured
  // scene cost while playing; port/probe.ts PortExtra). Nobody dies in this game, so there is no `alive` to say.
  extra: { drawCalls: () => renderer.info.render.calls, triangles: () => renderer.info.render.triangles },
});

requestAnimationFrame(frame);
