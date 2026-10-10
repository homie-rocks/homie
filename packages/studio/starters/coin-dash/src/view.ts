// Presentation only: openRoom gives predicted own movement and interpolated other bodies.
// Send intent; rules decide outcomes. Keep rendered obstacles aligned with room.map.
/*
 * COIN DASH — the view: what a player sees, and what they press.
 *
 * The view draws the room it is told about and sends input. It decides nothing: the coins, the scores and the rounds
 * are the rules' (src/rules.ts), which run on the server. `openRoom()` joins the room the play page names; `room.me`
 * is the player's own runner, `room.each` every entity at render time, `room.on` the effects the rules emit.
 *
 * Canvas 2D on purpose: the point is the two halves, in a page of code each.
 */
import { openRoom } from '@homie-rocks/studio/rules/view';
import { PALETTE, guardGestures } from '@homie-rocks/studio/netplay';
import type rules from './rules';

const room = openRoom<typeof rules>();
const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d') as CanvasRenderingContext2D;
guardGestures();

/* ------------------------------------------------------------------ input: keys, or a thumb dragged from where it landed */
const keys = new Set<string>();
addEventListener('keydown', (e) => { keys.add(e.code); });
addEventListener('keyup', (e) => { keys.delete(e.code); });
addEventListener('blur', () => keys.clear());
let thumb: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { if (!thumb) thumb = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY }; });
addEventListener('pointermove', (e) => { if (thumb && e.pointerId === thumb.id) { thumb.x = e.clientX; thumb.y = e.clientY; } });
const lift = (e: PointerEvent): void => { if (thumb && e.pointerId === thumb.id) thumb = null; };
addEventListener('pointerup', lift);
addEventListener('pointercancel', lift);

function stick(): { ax: number; ay: number } {
  let x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  let y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  if (thumb) { x = (thumb.x - thumb.x0) / 48; y = -(thumb.y - thumb.y0) / 48; }
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return { ax: Math.round(x * 127), ay: Math.round(y * 127) };
}

/* ------------------------------------------------------------------ effects the rules emit */
const dings: { x: number; y: number; at: number }[] = [];
room.on('ding', (e) => { if (e.at) dings.push({ x: e.at.x, y: e.at.y, at: performance.now() }); });

/* ------------------------------------------------------------------ drawing: metres to pixels, y up */
const map = room.map;
const W = map.bounds.max.x - map.bounds.min.x;
const H = map.bounds.max.y - map.bounds.min.y;
let scale = 1; let ox = 0; let oy = 0;
const px = (x: number): number => ox + (x - map.bounds.min.x) * scale;
const py = (y: number): number => oy + (map.bounds.max.y - y) * scale;

function fit(): void {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  scale = Math.min(canvas.width / (W + 1), canvas.height / (H + 3));
  ox = (canvas.width - W * scale) / 2; oy = (canvas.height - H * scale) / 2 + scale * 0.6;
}
addEventListener('resize', fit);
fit();

function frame(): void {
  room.input(stick());
  g.fillStyle = '#0b1020'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#141b33'; g.fillRect(px(map.bounds.min.x), py(map.bounds.max.y), W * scale, H * scale);
  g.fillStyle = '#2a3560';
  for (const b of map.boxes) g.fillRect(px(b.min.x), py(b.max.y), (b.max.x - b.min.x) * scale, (b.max.y - b.min.y) * scale);
  for (const c of map.circles) { g.beginPath(); g.arc(px(c.at.x), py(c.at.y), c.r * scale, 0, Math.PI * 2); g.fill(); }

  room.each('coin', (c) => {
    g.fillStyle = '#ffd166'; g.beginPath(); g.arc(px(c.pos.x), py(c.pos.y), 0.28 * scale, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(px(c.pos.x) - 0.08 * scale, py(c.pos.y) - 0.08 * scale, 0.09 * scale, 0, Math.PI * 2); g.fill();
  });
  const now = performance.now();
  for (let i = dings.length - 1; i >= 0; i -= 1) {
    const t = (now - dings[i].at) / 450;
    if (t >= 1) { dings.splice(i, 1); continue; }
    g.strokeStyle = `rgba(255, 209, 102, ${1 - t})`; g.lineWidth = 0.08 * scale;
    g.beginPath(); g.arc(px(dings[i].x), py(dings[i].y), (0.3 + t * 0.9) * scale, 0, Math.PI * 2); g.stroke();
  }
  const names = new Map(room.roster.map((r) => [r.seat, r]));
  g.textAlign = 'center'; g.font = `${Math.round(0.42 * scale)}px system-ui, sans-serif`;
  room.each('runner', (r) => {
    const x = px(r.pos.x); const y = py(r.pos.y);
    g.fillStyle = PALETTE[(r.seat ?? 0) % PALETTE.length];
    g.beginPath(); g.arc(x, y, 0.5 * scale, 0, Math.PI * 2); g.fill();
    // A dot where the runner faces.
    g.fillStyle = '#0b1020'; g.beginPath(); g.arc(x + r.heading.x * 0.28 * scale, y - r.heading.y * 0.28 * scale, 0.11 * scale, 0, Math.PI * 2); g.fill();
    if (r.mine) { g.strokeStyle = '#ffffff'; g.lineWidth = 0.07 * scale; g.beginPath(); g.arc(x, y, 0.58 * scale, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = r.away ? '#7c86a8' : '#e8ecff';
    g.fillText(names.get(r.seat ?? -1)?.name ?? '', x, y - 0.75 * scale);
  });

  // The HUD: the clock (from the room's own), and the board (from the room's roster).
  const round = room.round;
  g.fillStyle = '#e8ecff'; g.font = `600 ${Math.round(0.7 * scale)}px system-ui, sans-serif`;
  const top = oy - 0.5 * scale;
  if (room.status !== 'playing') g.fillText(room.status === 'connecting' ? 'Joining the room…' : 'Coin Dash needs a connection to its room', canvas.width / 2, top);
  else if (round) g.fillText(round.phase === 'live' ? `Round ${round.n}   ${Math.ceil(round.secondsLeft)}` : `Round ${round.n} is over. Next in ${Math.ceil(round.secondsLeft)}`, canvas.width / 2, top);
  g.textAlign = 'left'; g.font = `${Math.round(0.42 * scale)}px system-ui, sans-serif`;
  [...room.roster].sort((a, b) => b.score - a.score || a.seat - b.seat).forEach((r, i) => {
    g.fillStyle = PALETTE[r.seat % PALETTE.length];
    g.fillText(`${r.score}  ${r.name}${r.me ? '  (you)' : ''}`, ox + 0.3 * scale, oy + (0.6 + i * 0.55) * scale);
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
