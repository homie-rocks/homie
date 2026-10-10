// Presentation only: openRoom gives predicted own movement and interpolated other bodies.
// Send intent; rules decide outcomes. Keep rendered obstacles aligned with room.map.
/** Gem Rush 3D: the room runs the rules; this view draws the meadow and its animals. */
import {
  AmbientLight, AnimationClip, AnimationMixer, Box3, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, CylinderGeometry,
  DodecahedronGeometry, IcosahedronGeometry, OctahedronGeometry,
  DirectionalLight, DynamicDrawUsage, Euler, ExtrudeGeometry, Fog, Group, HemisphereLight, InstancedMesh, LineBasicMaterial,
  LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, NoToneMapping, Object3D, Path,
  PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Quaternion, RingGeometry, Scene, Shape, SRGBColorSpace, Vector3, WebGLRenderer,
  type AnimationAction, type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
// The one model loader every studio game uses: checks each file, decodes meshopt and WebP, copies for placing.
import { createModels, instancedCopies, placeCopy, repaint, stylize, type Copies } from '@homie-rocks/studio/assets';
import { guardGestures, PALETTE, AI_MARK, type RoundInfo, type Slot } from '@homie-rocks/studio/netplay';
// The port toolkit: its probe (what `homie-studio port check` and `perf` read, and sandbox + audio shims), and name
// labels that never pile up (port/view.ts).
import { createBubbles, createLabels, exposePort, paintBubbles, type BubbleIn, type BubbleOut, type LabelIn, type LabelOut } from '@homie-rocks/studio/port';
// The Game Lab: tunables, phases, tracks and overlays (no-ops outside the lab).
import { lab } from '@homie-rocks/studio/lab';
import { openRoom, type Entity } from '@homie-rocks/studio/rules/view';
import type rules from './rules';
const room = openRoom<typeof rules>();
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
const R_GEM = 0.26;
const SPEED = 6.8;
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

const mySeat = (): number | null => room.seat;
const viewSeat = (): number | null => net.viewSeat;
const me = { x: 13, y: 8, has: false };
const poses = new Map<number, Entity>();
const drawn = new Map<number, { x: number; y: number; seat: number; score: number; slot: number }>();
const waves: { x: number; y: number; at: number; colour: string; knock?: boolean }[] = [];
let wavesSeen = 0, knocksSeen = 0, frames = 0;
let firstStateAt = 0, firstSnapAt = 0;
let gems: { x: number; y: number; id: number }[] = [];
let round: RoundInfo | null = null;
let zone: { x: number; y: number; r: number } | null = null;
const slotOf = (e: Entity): number => e.kind === 'runner' ? e.seat ?? 0 : 0;
function updateView(): void {
  const v = moveVector(); room.input({ ax: Math.round(v.x * 127), ay: Math.round(v.y * 127) });
  const own = room.me; me.has = Boolean(own);
  if (own) { me.x = own.pos.x; me.y = own.pos.y; }
  drawn.clear(); poses.clear(); room.each('runner', e => poses.set(slotOf(e), e));
  room.each('runner', e => drawn.set(slotOf(e), { slot: slotOf(e), seat: e.driver === 'bot' ? -1 : e.seat ?? -1, x: e.pos.x, y: e.pos.y, score: Number(e.score) }));
  gems = []; room.each('gem', e => gems.push({ id: Number(e.serial), x: e.pos.x, y: e.pos.y }));
  const z = room.shared.zone as { x: number; y: number } | undefined;
  zone = z ? { x: z.x, y: z.y, r: 3 } : null;
  if (own && !firstSnapAt) firstSnapAt = performance.now();
  if (z && !firstStateAt) firstStateAt = performance.now();
  const r = room.round;
  round = r ? { ...r, startedAt: 0, endsAt: net.now() + r.secondsLeft * 1000 } : null;
}
function effect(name: 'wave' | 'knock', e: { id?: string; at?: { x: number; y: number } | null; dir?: { x: number; y: number }; by?: string }): void {
  const body = e.id ? room.get(e.id) : null;
  if (!body || body.kind !== 'runner' || !e.at) return;
  const slot = slotOf(body), at = { x: body.pos.x, y: body.pos.y }, now = performance.now();
  waves.push({ ...at, at: now, colour: name === 'knock' ? '#ffffff' : colourOf(slot, body.seat ?? null), knock: name === 'knock' });
  if (name === 'wave') { net.spotlight(body.driver === 'person' ? body.seat ?? null : null); wavesSeen++; pushes.set(slot, now); }
  else if (e.dir) {
    const by = e.by ? room.get(e.by) : null;
    knocksSeen++; bumped({ slot, dx: e.dir.x, dy: e.dir.y, by: by?.kind === 'runner' ? by.seat : undefined }, at);
    if (lab.on) Object.assign(subject, { slot, at: net.now(), x0: at.x, y0: at.y, px: at.x, py: at.y, has: true });
  }
}
room.on('wave', e => effect('wave', e));
room.on('knock', e => effect('knock', e));
/* ----------------------------------------------------------------- input */
// The camera looks across the meadow from its near edge, square to it: screen right is +x and screen down is +y, so
// keys and the stick move a body exactly as in Gem Rush.
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
const hudCanvas = document.getElementById('hud') as HTMLCanvasElement;
const ctx = hudCanvas.getContext('2d') as CanvasRenderingContext2D;
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
  if (len > 1) { x /= len; y /= len; }
  const c = Math.cos(view3.yaw), s = Math.sin(view3.yaw);
  return { x: x * c + y * s, y: -x * s + y * c };
}

function wave(): void {
  const v = moveVector(); room.input({ ax: Math.round(v.x * 127), ay: Math.round(v.y * 127), wave: true });
}
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

/* -------------------------------------------------------------- the Game Lab */
/*
 * What the lab shows of a knock (lab.json's take "knock"): the body bumped last is the subject. Every frame its phase,
 * its speed and its distance from where it was hit go to the lab, and its pose feeds the onion skin and the spacing
 * arc (dots far apart: fast; close together: slow), drawn as lines on the meadow. Only in the lab: outside it,
 * labKnock and labReport never run.
 */
type Pose = { x: number; y: number; sx?: number; sy?: number; a?: number };
const subject = { slot: -1, at: 0, x0: 0, y0: 0, px: 0, py: 0, has: false };
function subjectAt(): Pose | null { return subject.has ? drawn.get(subject.slot) ?? null : null; }
function labReport(dt: number): void {
  const at = subjectAt();
  if (!at || dt <= 0) { lab.phase(null); return; }
  const age = net.now() - subject.at;
  lab.track('speed', Math.hypot(at.x - subject.px, at.y - subject.py) / dt, 'm/s');
  lab.track('distance', Math.hypot(at.x - subject.x0, at.y - subject.y0), 'm');
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
const models = createModels();
const ANIMALS = ['fox', 'chick', 'crab', 'elephant', 'cat', 'panda', 'caterpillar', 'pig'] as const;
const ANIMAL_M = 0.8;
/** Each seat is its own animal, and wears its seat's colour as a ring (the same key as its colour). */
const animalOf = (slot: number, seat: number | null): number => (seat ?? slot) % ANIMALS.length;
const animalUrl = (k: number): string => `./models/animal-${ANIMALS[k % ANIMALS.length]}.glb`;

/** Colour families a flat-coloured pack paints with: leaves, wood and earth, pale stone, and petals. */
type Family = 'leaf' | 'wood' | 'pale' | 'red' | 'yellow' | 'purple';
type RGB = [number, number, number];
function hslOf(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255; const G = g / 255; const B = b / 255;
  const mx = Math.max(R, G, B); const mn = Math.min(R, G, B); const l = (mx + mn) / 2; const d = mx - mn;
  if (d < 1e-6) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === R ? ((G - B) / d + 6) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}
function rgbOf(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function familyOf(h: number, s: number, l: number): Family | null {
  if (l > 0.78 || s < 0.12) return 'pale';
  if (h >= 140 && h <= 205) return 'leaf';
  if (h >= 6 && h < 28) return 'wood';
  if (h >= 28 && h < 70) return 'yellow';
  if (h >= 225 && h < 300) return 'purple';
  if (h >= 320 || h < 6) return 'red';
  return null;
}
/** How light each family usually is in a pack: a pixel lighter or darker than that stays as much lighter or darker. */
const FAMILY_L: Record<Family, number> = { leaf: 0.48, wood: 0.6, pale: 0.86, red: 0.6, yellow: 0.63, purple: 0.75 };
/** A palette swap: each colour family to one colour of style.json's palette, keeping the pack's own shading. */
function swapTo(to: Partial<Record<Family, string>>): (r: number, g: number, b: number) => RGB | null {
  const want = Object.fromEntries(Object.entries(to).map(([k, hex]) => { const c = new Color(hex).getHex(); return [k, hslOf((c >> 16) & 255, (c >> 8) & 255, c & 255)]; })) as Partial<Record<Family, [number, number, number]>>;
  return (r, g, b) => {
    const [h, s, l] = hslOf(r, g, b);
    const f = familyOf(h, s, l);
    const t = f ? want[f] : undefined;
    if (!f || !t) return null;
    return rgbOf(t[0], t[1], Math.max(0.04, Math.min(0.96, t[2] + (l - FAMILY_L[f]) * 0.6)));
  };
}
const nearestHue = (hue: number, fallback: string): string => (PAL.ramp ?? []).map((hex) => { const c = new Color(hex).getHex(); const [h, s] = hslOf((c >> 16) & 255, (c >> 8) & 255, c & 255); return { hex, d: s > 0.25 ? Math.abs(h - hue) : 999 }; }).sort((x, y) => x.d - y.d).find((x) => x.d < 40)?.hex ?? fallback;
const PAINT = {
  leaf: mixHex(PAL.good, PAL.ink, 0.25), leafLight: mixHex(mixHex(PAL.good, PAL.ink, 0.25), PAL.gold, 0.22), needle: mixHex(PAL.good, PAL.ink, 0.45),
  wood: mixHex(PAL.accent, PAL.ink, 0.45), earth: mixHex(mixHex(PAL.accent, PAL.ink, 0.4), mixHex(PAL.bg, PAL.ink, 0.12), 0.35), blade: mixHex(PAL.good, PAL.accent2, 0.5),
  stone: mixHex(mixHex(PAL.bg, PAL.ink, 0.5), '#8c8f96', 0.35), cream: mixHex(PAL.gold, '#ffffff', 0.8), purple: nearestHue(270, '#b07ad9'),
};
const SWAPS = {
  tree: swapTo({ leaf: PAINT.leaf, wood: PAINT.wood }),
  treeLight: swapTo({ leaf: PAINT.leafLight, wood: PAINT.wood }),
  pine: swapTo({ leaf: PAINT.needle, wood: mixHex(PAINT.wood, PAL.ink, 0.3) }),
  bush: swapTo({ leaf: PAINT.leaf, wood: PAINT.wood }),
  blade: swapTo({ leaf: PAINT.blade }),
  flower: swapTo({ leaf: PAINT.leaf, red: PAL.danger, yellow: PAL.gold, purple: PAINT.purple }),
  mushroom: swapTo({ pale: PAINT.cream, red: PAL.danger }),
  rock: swapTo({ wood: PAINT.earth, leaf: mixHex(PAL.good, PAL.gold, 0.2), pale: PAINT.stone }),
  stone: swapTo({ pale: PAINT.stone }),
  gem: swapTo({ pale: PAL.gold, yellow: PAL.gold, purple: PAL.gold }),
  fence: swapTo({ wood: PAINT.wood }),
};

/**
 * The animals keep their own painted colours (a fox stays a fox) pulled a third of the way to the palette's nearest, so
 * they sit in this world rather than on top of it (assets/manifest.json says so: `inGame.pull`, the lineup draws it).
 */
const PULL_TO: RGB[] = [...new Set([...(PAL.ramp ?? []), PAL.accent, PAL.accent2, PAL.gold, PAL.good, PAL.danger, PAL.ink])].map((hex) => { const c = new Color(hex).getHex(); return [(c >> 16) & 255, (c >> 8) & 255, c & 255] as RGB; });
function pullToPalette(k: number): (r: number, g: number, b: number) => RGB {
  return (r, g, b) => {
    let best = PULL_TO[0] as RGB; let bd = Infinity;
    for (const p of PULL_TO) { const d = 0.3 * (p[0] - r) ** 2 + 0.59 * (p[1] - g) ** 2 + 0.11 * (p[2] - b) ** 2; if (d < bd) { bd = d; best = p; } }
    return [Math.round(r + (best[0] - r) * k), Math.round(g + (best[1] - g) * k), Math.round(b + (best[2] - b) * k)];
  };
}
const ANIMAL_PULL = pullToPalette(0.35);

/** Stand-ins, drawn in the same colours when a model is not there: low-poly shapes, one draw call each. */
type Stand = 'gem' | 'tree' | 'pine' | 'bush' | 'rock' | 'stone' | 'fence' | 'critter';
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
  if (kind === 'gem') add(new OctahedronGeometry(0.2, 0), PAL.gold, 0, 0.28, 0, 1, 1.4, 1);
  if (kind === 'tree') { add(new CylinderGeometry(0.12, 0.17, 1.5, 6), PAINT.wood, 0, 0.75, 0); add(new IcosahedronGeometry(1.05, 0), PAINT.leaf, 0, 2.45, 0); }
  if (kind === 'pine') { add(new CylinderGeometry(0.1, 0.14, 0.9, 6), PAINT.wood, 0, 0.45, 0); add(new ConeGeometry(1, 2.2, 7), PAINT.needle, 0, 1.9, 0); add(new ConeGeometry(0.72, 1.6, 7), PAINT.needle, 0, 2.95, 0); }
  if (kind === 'bush') add(new IcosahedronGeometry(0.55, 0), PAINT.leaf, 0, 0.42, 0, 1.2, 0.8, 1.1);
  if (kind === 'rock') add(new DodecahedronGeometry(0.5, 0), PAINT.stone, 0, 0.3, 0, 1.3, 0.75, 1.1);
  if (kind === 'stone') add(new CylinderGeometry(0.3, 0.45, 1, 5), PAINT.stone, 0, 0.5, 0);
  if (kind === 'fence') { for (const x of [-0.96, 0.96]) add(new BoxGeometry(0.1, 0.7, 0.1), PAINT.wood, x, 0.35, 0); for (const y of [0.3, 0.55]) add(new BoxGeometry(2.03, 0.08, 0.05), PAINT.wood, 0, y, 0); }
  if (kind === 'critter') {
    // A cube animal in its seat's colour: ears, eyes and feet, facing +z like the models.
    add(new BoxGeometry(0.62, 0.5, 0.62), colour, 0, 0.36, 0);
    for (const x of [-0.18, 0.18]) { add(new BoxGeometry(0.14, 0.16, 0.1), colour, x, 0.69, -0.05); add(new BoxGeometry(0.13, 0.15, 0.02), '#ffffff', x * 0.8, 0.42, 0.315); add(new BoxGeometry(0.06, 0.08, 0.02), PAL.ink, x * 0.8, 0.41, 0.33); }
    for (const x of [-0.18, 0.18]) for (const z of [-0.18, 0.18]) add(new BoxGeometry(0.15, 0.12, 0.15), mixHex(colour, PAL.ink, 0.35), x, 0.06, z);
  }
  const mesh = new Mesh(mergeGeometries(parts) as BufferGeometry, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.name = 'stand-in';
  return mesh;
}

/** One colour for a whole model, its picture dropped: its faces keep their shading from the light. */
function paintAll(model: Object3D, hex: string): void {
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const mat of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshStandardMaterial[]) { mat.map = null; mat.color = new Color(hex); mat.needsUpdate = true; }
  });
}
/** Every model the game draws: its file, how tall it stands, its palette swap and its stand-in. */
interface Spec { url: string; m: number; swap: ((r: number, g: number, b: number) => RGB | null) | null; stand: Stand | null; tint?: string; px?: number }
// The gem is one colour, the palette's gold (its pack paints it from a picture atlas: the tint replaces that).
const GEM: Spec = { url: './models/gem.glb', m: 0.42, swap: SWAPS.gem, stand: 'gem', tint: PAL.gold };
const FENCE: Spec = { url: './models/fence.glb', m: 0.7, swap: SWAPS.fence, stand: 'fence' };
// The camp at the clearing's heart: a ring of stones round its logs, two logs to sit on, and a flame made here.
const CAMPFIRE: Spec = { url: './models/campfire.glb', m: 0.16, swap: swapTo({ pale: PAINT.stone, wood: PAINT.wood }), stand: 'rock' };
const LOG: Spec = { url: './models/log.glb', m: 0.42, swap: swapTo({ wood: PAINT.wood, pale: mixHex(PAINT.wood, PAL.ink, 0.45) }), stand: null };
const FIREWOOD: Spec = { url: './models/firewood.glb', m: 0.14, swap: swapTo({ wood: mixHex(PAINT.wood, PAL.bg, 0.25) }), stand: null };
/** The dressing: how many, where, its footprint in metres (for spacing), its shadow's radius and its size range. */
type Where = 'far' | 'any' | 'low' | 'inside' | 'edge';
const DRESSING: (Spec & { count: number; where: Where; foot: number; shadow: number; scale: [number, number] })[] = [
  { url: './models/tree-oak.glb', m: 3.6, swap: SWAPS.tree, stand: 'tree', count: 14, where: 'far', foot: 2.1, shadow: 1.3, scale: [0.85, 1.2] },
  { url: './models/tree-round.glb', m: 3.2, swap: SWAPS.treeLight, stand: 'tree', count: 14, where: 'far', foot: 1.4, shadow: 1.0, scale: [0.85, 1.25] },
  { url: './models/tree-pine.glb', m: 4, swap: SWAPS.pine, stand: 'pine', count: 16, where: 'far', foot: 2.1, shadow: 1.2, scale: [0.8, 1.3] },
  { url: './models/stone.glb', m: 1, swap: SWAPS.stone, stand: 'stone', count: 6, where: 'far', foot: 1, shadow: 0.6, scale: [0.8, 1.3] },
  { url: './models/bush.glb', m: 1.1, swap: SWAPS.bush, stand: 'bush', count: 22, where: 'any', foot: 1.4, shadow: 0.75, scale: [0.7, 1.15] },
  { url: './models/rock.glb', m: 0.75, swap: SWAPS.rock, stand: 'rock', count: 12, where: 'any', foot: 1.4, shadow: 0.75, scale: [0.6, 1.1] },
  { url: './models/flower-red.glb', m: 0.4, swap: SWAPS.flower, stand: null, count: 30, where: 'low', foot: 0.3, shadow: 0, scale: [0.9, 1.5] },
  { url: './models/flower-yellow.glb', m: 0.4, swap: SWAPS.flower, stand: null, count: 30, where: 'low', foot: 0.4, shadow: 0, scale: [0.9, 1.5] },
  { url: './models/flower-purple.glb', m: 0.4, swap: SWAPS.flower, stand: null, count: 30, where: 'low', foot: 0.3, shadow: 0, scale: [0.9, 1.5] },
  { url: './models/mushrooms.glb', m: 0.45, swap: SWAPS.mushroom, stand: null, count: 12, where: 'any', foot: 0.5, shadow: 0, scale: [0.8, 1.3] },
  // The clearing's edge, when it has no fence: bushes and rocks just outside it (never on the camera's side).
  { url: './models/bush.glb', m: 1.1, swap: SWAPS.bush, stand: 'bush', count: FENCED ? 0 : 26, where: 'edge', foot: 1.2, shadow: 0.7, scale: [0.75, 1.15] },
  { url: './models/rock.glb', m: 0.75, swap: SWAPS.rock, stand: 'rock', count: FENCED ? 0 : 10, where: 'edge', foot: 1.1, shadow: 0.6, scale: [0.6, 1] },
  // Tufts of grass in and around the clearing: the lawn is a meadow, never a bare board (they never block a move).
  { url: './models/grass.glb', m: 0.18, swap: SWAPS.blade, stand: null, count: 36, where: 'inside', foot: 0.9, shadow: 0, scale: [0.7, 1.1] },
  { url: './models/grass.glb', m: 0.18, swap: SWAPS.blade, stand: null, count: 36, where: 'low', foot: 0.6, shadow: 0, scale: [0.8, 1.2] },
  { url: './models/flower-red.glb', m: 0.4, swap: SWAPS.flower, stand: null, count: 22, where: 'inside', foot: 0.9, shadow: 0, scale: [0.55, 0.8] },
  { url: './models/flower-purple.glb', m: 0.4, swap: SWAPS.flower, stand: null, count: 22, where: 'inside', foot: 0.9, shadow: 0, scale: [0.55, 0.8] },
];

/** A model loaded once, repainted and measured: `fit` scales it to its height, `size` is its box at that height. */
interface Ready { scene: Object3D; fit: number; size: Vector3 }
const ready = new Map<string, Promise<Ready | null>>();
const standIns = new Set<string>();
function prepare(spec: Pick<Spec, 'url' | 'm' | 'swap' | 'tint' | 'px'>): Promise<Ready | null> {
  let p = ready.get(spec.url);
  if (!p) {
    p = models.load(spec.url).then((m) => {
      if (spec.swap) repaint(m.scene, spec.swap, spec.px ? { maxPx: spec.px } : undefined);
      if (spec.tint) paintAll(m.scene, spec.tint);
      const size = new Box3().setFromObject(m.scene).getSize(new Vector3());
      const fit = size.y > 1e-3 ? spec.m / size.y : 1;
      // The art direction's material model and ink line (style.json), as the style board drew them.
      stylize(m.scene, STYLE, { scale: fit });
      return { scene: m.scene, fit, size: size.multiplyScalar(fit) };
    }, () => { standIns.add(spec.url); return null; });
    ready.set(spec.url, p);
  }
  return p;
}
// The Game Lab plays a take only once the models have settled (loaded or not there), so both builds start alike.
lab.hold();
void Promise.all([...ANIMALS.map((_, i) => prepare({ url: animalUrl(i), m: ANIMAL_M, swap: ANIMAL_PULL, px: 512 })), prepare(GEM), ...(FENCED ? [prepare(FENCE)] : []), prepare(CAMPFIRE), prepare(FIREWOOD), prepare(LOG), ...DRESSING.map(prepare)]).then(() => lab.ready());

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
function spotFor(roll: () => number, where: Where, r: number): { x: number; z: number } | null {
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
  const [lo, hi] = where === 'edge' ? [0.15, 1.4] : where === 'low' ? [1.2, 7] : where === 'any' ? [1.5, 9] : [1.8, 16];
  for (let tries = 0; tries < 60; tries += 1) {
    const out = lo + (hi - lo) * roll() ** 1.5;
    const hw = W / 2 + EDGE + out; const hh = H / 2 + EDGE + out;
    let u = roll() * (4 * hw + 4 * hh); let x: number; let z: number;
    if (u < 2 * hw) { x = -hw + u; z = -hh; } else if ((u -= 2 * hw) < 2 * hh) { x = hw; z = -hh + u; } else if ((u -= 2 * hh) < 2 * hw) { x = hw - u; z = hh; } else { u -= 2 * hw; x = -hw; z = hh - u; }
    if (where === 'far' && z > 0) continue;
    if (where === 'edge' && z > H / 2) continue; // the near side stays open to the camera
    if (where === 'any' && z > H / 2 && out > 4) continue; // little on the camera's side
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r)) continue;
    placed.push({ x, z, r });
    return { x, z };
  }
  return null;
}
const shadowSpots: { x: number; z: number; r: number }[] = [];
/** The flame at the camp's heart (flickered in draw): two cones in the palette's gold and accent, and its glow. */
let flame: Object3D | null = null;
async function buildCamp(o: { x: number; y: number; r: number }): Promise<void> {
  const [x, z] = XZ(o.x, o.y);
  const camp = new Group(); camp.position.set(x, 0, z); scene.add(camp);
  const ring = await prepare(CAMPFIRE);
  if (ring) {
    const obj = ring.scene.clone(true);
    const wide = Math.max(ring.size.x, ring.size.z) || 1;
    obj.scale.setScalar(ring.fit * (1.5 / wide));
    camp.add(obj);
  }
  const wood = await prepare(FIREWOOD);
  if (wood) {
    const obj = wood.scene.clone(true);
    obj.scale.setScalar(wood.fit * (0.85 / (Math.max(wood.size.x, wood.size.z) || 1)));
    camp.add(obj);
  }
  const log = await prepare(LOG);
  if (log) for (const [lx, lz, rot] of [[-1.55, 0.25, 0.2], [1.5, -0.35, -0.25]] as [number, number, number][]) {
    const l = log.scene.clone(true); l.position.set(lx, 0, lz); l.rotation.y = Math.PI / 2 + rot; l.scale.setScalar(log.fit); camp.add(l);
  }
  const f = new Group();
  const outer = new Mesh(new ConeGeometry(0.26, 0.75, 6), new MeshBasicMaterial({ color: PAL.accent }));
  const inner = new Mesh(new ConeGeometry(0.15, 0.5, 6), new MeshBasicMaterial({ color: PAL.gold }));
  outer.position.y = 0.42; inner.position.y = 0.32; f.add(outer, inner);
  const glow = new Mesh(new CircleGeometry(1.3, 24), new MeshBasicMaterial({ map: discTexture, color: PAL.gold, transparent: true, opacity: 0.45, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.02; f.add(glow);
  camp.add(f); flame = f;
  if (REAL_SHADOWS) camp.traverse((n) => { const mm = n as Mesh; if (mm.isMesh && mm.name !== 'hull' && n !== glow) mm.castShadow = true; });
}

/** The clearing's solid features (OBSTACLES), drawn with the dressing's own models. */
const OBSTACLE_SPEC = {
  camp: null,
  bush: DRESSING.find((d) => d.url.endsWith('/bush.glb')),
  rock: DRESSING.find((d) => d.url.endsWith('/rock.glb')),
  stone: DRESSING.find((d) => d.url.endsWith('/stone.glb')),
  tree: DRESSING.find((d) => d.url.endsWith('/tree-round.glb')),
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
      const at = spotFor(roll, d.where, d.foot * 0.5 * sc + 0.15);
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
    obj.scale.setScalar((r?.fit ?? 1) * (o.kind === 'tree' ? 0.8 : 1.1));
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
void dressMeadow();
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

/** Sparks: little bars flying off a hit (white, then gold) and up off a taken gem; one draw call. */
const sparkMesh = new InstancedMesh(new BoxGeometry(1, 0.07, 0.07), new MeshBasicMaterial({ color: 0xffffff }), 160);
sparkMesh.frustumCulled = false; sparkMesh.count = 0; sparkMesh.instanceMatrix.setUsage(DynamicDrawUsage);
sparkMesh.setColorAt(0, new Color(0xffffff));
scene.add(sparkMesh);

/* ------------------------------------------------------------------ the animals */
interface Animal {
  slot: number; kind: number;
  root: Group; tilt: Group; squash: Group; untilt: Group; turn: Group;
  model: Object3D | null; mixer: AnimationMixer | null; actions: Map<string, AnimationAction>; clip: string;
  mats: { emissive: Color; dispose(): void }[]; yaw: number; px: number; py: number; speed: number; seen: number;
}
const animals = new Map<number, Animal>();
function animalFor(slot: number, kind: number, colour: string): Animal {
  let a = animals.get(slot);
  if (a && a.kind === kind) return a;
  if (!a) {
    // root (where) > tilt (the hit's angle) > squash (stretch along the hit) > untilt > turn (which way it faces) > model
    const root = new Group(); const tilt = new Group(); const squash = new Group(); const untilt = new Group(); const turn = new Group();
    root.add(tilt); tilt.add(squash); squash.add(untilt); untilt.add(turn);
    scene.add(root);
    a = { slot, kind, root, tilt, squash, untilt, turn, model: null, mixer: null, actions: new Map(), clip: '', mats: [], yaw: 0, px: NaN, py: NaN, speed: 0, seen: 0 };
    animals.set(slot, a);
  }
  a.kind = kind;
  dressAnimal(a, colour);
  return a;
}
function clearModel(a: Animal): void {
  if (a.model) a.turn.remove(a.model);
  if (a.model?.name === 'stand-in') (a.model as Mesh).geometry.dispose();
  a.mixer?.stopAllAction();
  for (const m of a.mats) m.dispose();
  a.model = null; a.mixer = null; a.actions = new Map(); a.clip = ''; a.mats = [];
}
/** The animal's model: a stand-in in its seat's colour at once (a round never waits), then its own copy when the file is in. */
function dressAnimal(a: Animal, colour: string): void {
  clearModel(a);
  const critter = standIn('critter', colour);
  a.model = critter; a.turn.add(critter); a.mats = [critter.material as MeshLambertMaterial];
  const want = a.kind;
  const url = animalUrl(want);
  void models.instance(url).then(async (obj) => {
    if (a.kind !== want || animals.get(a.slot) !== a) return; // it changed while loading
    const clips = (await models.load(url)).animations;
    const fit = (await prepare({ url, m: ANIMAL_M, swap: ANIMAL_PULL, px: 512 }))?.fit ?? 1;
    if (a.kind !== want || animals.get(a.slot) !== a) return;
    clearModel(a);
    obj.scale.setScalar(fit);
    // Its own materials (the copy shares the file's), so a hit can flash this one animal.
    const own = new Map<Material, MeshStandardMaterial>();
    obj.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || mesh.name === 'hull') return;
      const m = mesh.material as MeshStandardMaterial;
      let c = own.get(m);
      if (!c) { c = m.clone(); own.set(m, c); a.mats.push(c); }
      mesh.material = c;
    });
    if (REAL_SHADOWS) obj.traverse((o) => { const mm = o as Mesh; if (mm.isMesh && mm.name !== 'hull') mm.castShadow = true; });
    a.model = obj; a.turn.add(obj);
    a.mixer = new AnimationMixer(obj);
    for (const name of ['idle', 'walk', 'run', 'dance']) { const clip = AnimationClip.findByName(clips, name); if (clip) a.actions.set(name, a.mixer.clipAction(clip)); }
    play(a, 'idle');
  }, () => { /* refused or missing: the stand-in stays (models.stats() says why) */ });
}
function play(a: Animal, name: string, rate = 1): void {
  const next = a.actions.get(name);
  if (!next) return;
  next.timeScale = rate;
  if (a.clip === name) return;
  const prev = a.actions.get(a.clip);
  next.reset().setEffectiveWeight(1).fadeIn(0.12).play();
  prev?.fadeOut(0.12);
  a.clip = name;
}
/** Place, turn, squash, flash and animate one animal this frame. */
function poseAnimal(a: Animal, at: { x: number; y: number }, t: number, dt: number, fx: ReturnType<typeof bodyFx>, place: number | null): void {
  const [x, z] = XZ(at.x + fx.ox, at.y + fx.oy);
  a.root.position.set(x, 0, z);
  // How fast it moves, from where it is drawn (the same for its owner, the host and every replica).
  const dx = at.x - a.px; const dy = at.y - a.py; const step = Math.hypot(dx, dy);
  const sp = !Number.isFinite(step) || step > 2 || dt <= 0 ? 0 : step / dt; // a jump (a new round, a takeover) is not a run
  a.speed += (Math.min(sp, 12) - a.speed) * Math.min(1, dt * 10);
  a.px = at.x; a.py = at.y;
  // It faces where it goes, but not while flying from a bump (it is knocked backwards, not turned round).
  const pose = poses.get(a.slot);
  if (pose) {
    const want = Math.atan2(pose.heading.x, pose.heading.y);
    let d = want - a.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    a.yaw += d * Math.min(1, dt * 14);
  }
  a.turn.rotation.y = a.yaw;
  // Squash and stretch along the hit: rotate to its angle on the ground, scale, rotate back.
  a.tilt.rotation.y = -fx.ang; a.untilt.rotation.y = fx.ang;
  a.squash.scale.set(fx.sx, fx.up, fx.sy);
  for (const m of a.mats) { m.emissive.setScalar(fx.flash); }
  if (!a.mixer) return;
  if (round?.phase === 'over' && place === 1) play(a, 'dance');
  else if (a.speed < 0.5) play(a, 'idle');
  else if (a.speed < 4.2) play(a, 'walk', Math.max(0.6, Math.min(1.6, a.speed / 2.2)));
  else play(a, 'run', Math.max(0.7, Math.min(1.4, a.speed / 6)));
  a.mixer.update(dt);
}

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
 * a phone (style.json's distance scales both: 22 is these), so an animal reads at about the same size in the hand.
 * It follows the body whose view this is and never looks past the arena's edge (beyond the path and the fence, as
 * far as the perspective allows); following nobody, it frames the whole arena (turned on a tall screen, so the
 * arena's long side runs up it).
 */
const PITCH0 = (CAM.pitch * Math.PI) / 180;
const HALF = (CAM.fov * Math.PI) / 360;
/*
 * A phone held upright sees the ground through a slit: its width is the short side. Followed from style.json's pitch
 * and distance it shows a long strip of mostly empty grass with a small animal in it. So, like the port kit's fitView
 * (fill a phone held upright and follow the player), it frames the action instead: closer (about 7 m across at the
 * player, an animal a fifth of the screen's width) at 44 to 50 degrees, the player in the lower half and what is
 * around and ahead of it filling the rest, the woods' edge at the top (never a wall of canopy).
 */
const UPRIGHT_PITCH = Math.max((44 * Math.PI) / 180, Math.min((50 * Math.PI) / 180, PITCH0 + (6 * Math.PI) / 180));
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
  // style.json's distance scales the view (22 is these spans); an upright phone's stays near 5.5 m whatever it says,
  // or a close camera would show one animal and nothing round it.
  const k = (CAM.distance ?? 22) / 22;
  const span = upright ? 7 * Math.max(0.9, Math.min(1.3, k)) : (phone ? 9.5 : 13.5) * k;
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
  if (upright && focus) return { x: focus.x, y: focus.y - d * 0.18 };
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
function placeCamera(want: { x: number; y: number; dist: number; yaw: number }, dt: number, kick: number): void {
  if (!view3.dist) Object.assign(view3, want);
  // A watcher's switch glides, never a cut; the zoom and the turn ease a little slower than the pan.
  const kp = 1 - Math.exp(-dt * 12); const kd = 1 - Math.exp(-dt * 7);
  view3.x += (want.x - view3.x) * kp; view3.y += (want.y - view3.y) * kp; view3.dist += (want.dist - view3.dist) * kd; view3.yaw += (want.yaw - view3.yaw) * kd;
  const [tx, tz] = XZ(view3.x, view3.y);
  const kx = kick ? (lab.random() - 0.5) * 2 * kick : 0; const kz = kick ? (lab.random() - 0.5) * 2 * kick : 0;
  const back = Math.cos(PITCH) * view3.dist;
  camera.position.set(tx + kx + Math.sin(view3.yaw) * back, Math.sin(PITCH) * view3.dist, tz + kz + Math.cos(view3.yaw) * back);
  camera.lookAt(tx + kx, 0, tz + kz);
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
// Room chat (NETPLAY.md section 19): what a player says in the room's chat shows over their animal for a few seconds,
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
  placeCamera({ ...aim, dist, yaw: turned ? -Math.PI / 2 : 0 }, dt, kick);
  if (flame) { const k = 1 + 0.12 * Math.sin(t / 95) + 0.06 * Math.sin(t / 37); flame.children[0]?.scale.set(1, k, 1); flame.children[1]?.scale.set(1, 2 - k, 1); }

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
    mtx.compose(vpos.set(gx, 0.1 + 0.16 * bob, gz), quat.setFromEuler(eul.set(0, t / 500 + g.id, 0)), vscl.setScalar(sc * GEM_DRAWN * gemFit));
    for (const c of gemParts) placeCopy(c, i, mtx);
    glows.setMatrixAt(i, mtx.compose(vpos.set(gx, 0, gz), quat.identity(), vscl.set(0.75 + 0.1 * bob, 1, 0.75 + 0.1 * bob)));
    blobs.setMatrixAt(nb++, mtx.compose(vpos.set(gx, 0, gz), quat.identity(), vscl.set(0.32 - 0.06 * bob, 1, 0.32 - 0.06 * bob)));
  }
  const ng = Math.min(gemList.length, GEM_CAP);
  for (const { mesh: im } of gemParts) { im.count = ng; im.instanceMatrix.needsUpdate = true; }
  glows.count = ng; glows.instanceMatrix.needsUpdate = true;

  // waves
  let nw = 0;
  for (let i = waves.length - 1; i >= 0; i -= 1) {
    const w = waves[i] as (typeof waves)[number];
    const age = (t - w.at) / T.ringMs;
    if (age > 1) { waves.splice(i, 1); continue; }
    const m = waveMesh(nw++);
    const r = w.knock ? R_AV + 0.12 + age * 0.8 : R_AV + age * (T.knockRange + 0.2);
    const [wx, wz] = XZ(w.x, w.y);
    m.visible = true; m.position.set(wx, 0.03, wz); m.scale.set(r, 1, r);
    const mat = m.material as MeshBasicMaterial; mat.color.set(w.colour); mat.opacity = 1 - age;
  }
  for (let i = nw; i < wavePool.length; i += 1) (wavePool[i] as Mesh).visible = false;

  // the animals
  const names = new Map<number, Slot>((net.slots ?? []).map((s) => [s.slot, s]));
  // `mine`: the body whose view this is: my own, or the player a watcher follows (named, never "You").
  const list: { slot: number; seat: number | null; x: number; y: number; bot: boolean; name: string; mine: boolean }[] = [];
  const isView = (seat: number | null, bot: boolean): boolean => !bot && seat !== null && seat === view;
  {
    for (const d of drawn.values()) {
      const own = !net.watching && d.seat >= 0 && d.seat === net.seat;
      const s = names.get(d.slot);
      list.push({ slot: d.slot, seat: d.seat >= 0 ? d.seat : null, x: own && me.has ? me.x : d.x, y: own && me.has ? me.y : d.y, bot: d.seat < 0, name: s?.name ?? (d.seat >= 0 ? `Player ${d.seat + 1}` : botName(d.slot)), mine: isView(d.seat >= 0 ? d.seat : null, d.seat < 0) });
    }
  }
  const places = new Map<number, number>((round?.phase === 'over' ? round.results ?? [] : []).map((r) => [r.slot, r.place]));
  let nr = 0;
  youRing.visible = false;
  for (const a of list) {
    const colour = colourOf(a.slot, a.bot ? null : a.seat);
    const fx = bodyFx(a.slot, t);
    const an = animalFor(a.slot, animalOf(a.slot, a.bot ? null : a.seat), colour);
    an.seen = frames;
    poseAnimal(an, a, t, dt, fx, places.get(a.slot) ?? null);
    const [bx, bz] = XZ(a.x + fx.ox, a.y + fx.oy);
    seatRings.setMatrixAt(nr, mtx.compose(vpos.set(bx, 0, bz), quat.identity(), vscl.setScalar(1)));
    seatEdges.setMatrixAt(nr, mtx);
    seatRings.setColorAt(nr, tint.set(a.bot ? mixHex(colour, '#9aa3ad', 0.55) : colour));
    nr += 1;
    blobs.setMatrixAt(nb++, mtx.compose(vpos.set(bx, 0, bz), quat.identity(), vscl.set(0.5 * fx.sx, 1, 0.5 * fx.sy)));
    if (a.mine) { youRing.visible = true; youRing.position.set(bx, 0.024, bz); youRing.scale.setScalar(1 + 0.05 * Math.sin(t / 220)); }
  }
  // Bodies that left: their animals go.
  for (const [slot, an] of animals) if (an.seen !== frames) { clearModel(an); scene.remove(an.root); animals.delete(slot); }
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

  // ---- the HUD, over the world
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  // the hot zone's "×2", on the screen over its middle
  zoneMark = null;
  if (zone) {
    const z = onScreen(zone.x, zone.y, 0, cw, ch);
    const size = phone ? 20 : 24;
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
    const text = a.mine && !net.watching ? 'You' : label(a.name, a.bot);
    const head = onScreen(a.x, a.y, 0.98, cw, ch);
    const mid = onScreen(a.x, a.y, 0.35, cw, ch);
    const side = onScreen(a.x + R_AV, a.y, 0.35, cw, ch);
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

  hud(cw, ch, phone, list);
  if (stick.active) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(stick.ox, stick.oy, 56, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(29,43,58,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(stick.ox, stick.oy, 58, 0, Math.PI * 2); ctx.stroke();
    const dx = stick.x - stick.ox; const dy = stick.y - stick.oy; const len = Math.hypot(dx, dy); const m = len > 56 ? 56 / len : 1;
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.arc(stick.ox + dx * m, stick.oy + dy * m, 24, 0, Math.PI * 2); ctx.fill();
  }
}

/** A rounded panel behind HUD text (style.json's "chips"): the palette's ink, a little see-through. */
function chip(x: number, y: number, w: number, h: number, alpha = 0.88): void {
  ctx.fillStyle = PAPER; ctx.globalAlpha = Math.max(alpha, 0.82);
  ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(12, h / 2)); ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * The game's own first screen: its name and one line, on a card in the palette, for the first few seconds (it never
 * waits for a press and never takes one: the round is already on underneath). game.json's name and the first sentence
 * of its blurb.
 */
const BOOT_AT = performance.now();
const TITLE = String((gameFile as { name?: string }).name ?? document.title).slice(0, 40);
const TAGLINE = String((gameFile as { blurb?: string }).blurb ?? '').split(/(?<=[.!?])\s/)[0]?.slice(0, 90) ?? '';
function titleCard(cw: number, ch: number, phone: boolean): void {
  const since = performance.now() - BOOT_AT;
  if (since > 4600) return;
  const a = since < 3400 ? 1 : 1 - (since - 3400) / 1200;
  const w = Math.min(cw - 32, phone ? 340 : 460);
  ctx.save();
  ctx.globalAlpha = Math.max(0, a);
  ctx.font = `700 ${phone ? 15 : 17}px ${FONT_BODY}`;
  const words = TAGLINE.split(' '); const lines: string[] = []; let line = '';
  for (const word of words) { const next = line ? `${line} ${word}` : word; if (ctx.measureText(next).width > w - 40 && line) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line);
  const titleSize = phone ? 34 : 44; const lineH = phone ? 21 : 24;
  const h = 34 + titleSize + (lines.length ? 14 + lines.length * lineH : 0) + 26;
  const x = (cw - w) / 2; const y = phone ? ch * 0.3 - h / 2 : (ch - h) / 2;
  ctx.fillStyle = mixHex(PAPER, '#ffffff', 0.35);
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  ctx.beginPath();
  const rr = (ctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect;
  if (rr) rr.call(ctx, x, y, w, h, 18); else ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = HOT; ctx.font = `700 ${titleSize}px ${FONT_DISPLAY}`;
  ctx.fillText(TITLE, cw / 2, y + 30 + titleSize / 2);
  ctx.fillStyle = TEXT; ctx.font = `600 ${phone ? 15 : 17}px ${FONT_BODY}`;
  lines.forEach((l, i) => ctx.fillText(l, cw / 2, y + 30 + titleSize + 14 + lineH * i + lineH / 2));
  ctx.restore();
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
  // A phone's board is compact (the top three, names without " · bot": a bot's dot is hollow), so a game's own HUD at
  // the top left (a basket, a timer) has room beside it.
  const rows = [...list].sort((a, b) => (scores.get(b.slot) ?? 0) - (scores.get(a.slot) ?? 0)).slice(0, phone ? 3 : 6);
  ctx.font = `700 ${phone ? 13 : 16}px ${FONT_BODY}`;
  const rowH = phone ? 20 : 25;
  const fit = (t: string, max: number): string => { let x = t; while (x.length > 3 && ctx.measureText(x).width > max) x = `${x.slice(0, -2)}…`; return x; };
  const texts = rows.map((a) => (a.mine && !net.watching ? 'You' : phone ? fit(a.name.replace(AI_MARK, '').trim(), 104) : label(a.name, a.bot)));
  const nameW = Math.max(0, ...texts.map((x) => ctx.measureText(x).width));
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
  titleCard(cw, ch, phone);
  if (frames < 240 && mySeat() !== null) {
    ctx.textAlign = 'center'; ctx.font = `700 14px ${FONT_BODY}`;
    const text = phone ? 'Drag to move · second finger bumps' : 'WASD / arrows to move · Space bumps';
    const tw = ctx.measureText(text).width;
    chip(cw / 2 - tw / 2 - 12, ch - pad - 56, tw + 24, 26, 0.6);
    ctx.fillStyle = TEXT; ctx.fillText(text, cw / 2, ch - pad - 42);
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
  self: () => (me.has ? { x: me.x, y: me.y } : null),
  peer: (seat: number) => {
    const d = [...drawn.values()].find((x) => x.seat === seat);
    return d ? { x: d.x, y: d.y } : null;
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
  models: () => ({ ...models.stats(), standIns: [...standIns], animals: [...animals.values()].map((a) => ({ slot: a.slot, animal: ANIMALS[a.kind], standIn: a.model?.name === 'stand-in' })) }),

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
