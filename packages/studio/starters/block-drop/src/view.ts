import { openRoom } from '@homie-rocks/studio/rules/view';
import { guardGestures } from '@homie-rocks/studio/netplay';
import type rules from './rules';
import { cells, fits } from './pieces';

const room = openRoom<typeof rules>();
room.probe({
  alive: () => !!room.me && !room.me.dead,
  busy: () => !room.me || room.me.dead || room.round?.phase !== 'live',
  pieceX: () => room.me?.x, pieceY: () => room.me?.y, piece: () => room.me?.piece,
  rotation: () => room.me?.rotation, lines: () => room.me?.lines,
  lockedCells: () => room.me?.grid.filter(Boolean).length,
});
const canvas = document.querySelector('canvas')!;
const g = canvas.getContext('2d')!;
guardGestures({ touch: 'canvas' });
const COLORS = ['#152038','#40dcf0','#ffd75b','#b78aff','#65e6ab','#ff6f91','#6d9eff','#ffa465'];
const keys = new Set<string>();
let rotate = false, drop = false, touchDx = 0, soft = false;
let audio: AudioContext | null = null;
let muted = false, note = 0, nextNote = 0;
const melody = [659,494,523,587,523,494,440,440,523,659,587,523,494,523,587,659,523,440,440,0,587,698,880,784,698,659,523,659,587,523,494,494];
function unlock(): void { audio ??= new AudioContext(); void audio.resume(); }
function tone(hz: number, seconds = 0.055, volume = 0.055): void {
  if (!audio || audio.state !== 'running' || muted) return;
  const o = audio.createOscillator(), gain = audio.createGain();
  o.type = 'triangle'; o.frequency.value = hz;
  gain.gain.setValueAtTime(volume * 3, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + seconds);
  o.connect(gain).connect(audio.destination); o.start(); o.stop(audio.currentTime + seconds);
}
room.on('moved', e => { if (e.id === room.me?.id) tone(180, 0.04, 0.035); });
room.on('turned', e => { if (e.id === room.me?.id) tone(330); });
room.on('placed', e => { if (e.id === room.me?.id) { tone(e.rows ? 660 : 120, e.rows ? 0.23 : 0.09, 0.08); if (e.rows) navigator.vibrate?.(25); } });
addEventListener('keydown', e => {
  if ((e.target as HTMLElement)?.closest('input,textarea,[contenteditable]')) return;
  if (!['ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Space','KeyA','KeyD','KeyS','KeyW','KeyX'].includes(e.code)) return;
  e.preventDefault(); unlock(); keys.add(e.code);
  if (!e.repeat && ['ArrowUp','KeyW','KeyX'].includes(e.code)) rotate = true;
  if (!e.repeat && e.code === 'Space') drop = true;
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); touchDx = 0; soft = false; });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action]')) {
  const action = button.dataset.action;
  button.addEventListener('pointerdown', e => {
    e.preventDefault(); unlock(); button.setPointerCapture(e.pointerId); button.classList.add('pressed');
    if (action === 'left') touchDx = -1;
    if (action === 'right') touchDx = 1;
    if (action === 'soft') soft = true;
    if (action === 'rotate') rotate = true;
    if (action === 'drop') drop = true;
    if (action === 'audio') { muted = !muted; button.textContent = muted ? '×♪' : '♪'; button.setAttribute('aria-pressed', String(!muted)); }
  });
  button.addEventListener('pointermove', e => {
    if (!button.hasPointerCapture(e.pointerId) || !['left','right','soft'].includes(action ?? '')) return;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLButtonElement>('[data-action]');
    const next = target?.dataset.action;
    touchDx = next === 'left' ? -1 : next === 'right' ? 1 : 0; soft = next === 'soft';
    for (const control of document.querySelectorAll<HTMLButtonElement>('[data-action]'))
      control.classList.toggle('pressed', control === target && ['left','right','soft'].includes(next ?? ''));
  });
  const release = (): void => { for (const control of document.querySelectorAll('[data-action]')) control.classList.remove('pressed'); if (['left','right','soft'].includes(action ?? '')) { touchDx = 0; soft = false; } };
  button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release);
  // Keyboard activation for focused native buttons; pointer input is handled above.
  button.addEventListener('click', e => { if (e.detail === 0) { unlock(); if (action === 'rotate') rotate = true; if (action === 'drop') drop = true; } });
}
let w = innerWidth, h = innerHeight;
function size(): void { w = innerWidth; h = innerHeight; const dpr = Math.min(2, devicePixelRatio || 1); canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); }
addEventListener('resize', size); size();
type Board = NonNullable<typeof room.me>;
function block(x: number, y: number, s: number, kind: number, ghost = false): void {
  const gap = Math.max(1, s * 0.055);
  g.fillStyle = ghost ? '#c6dcff12' : COLORS[kind];
  g.fillRect(x + gap, y + gap, s - gap * 2, s - gap * 2);
  g.strokeStyle = ghost ? '#b8d5ff72' : '#ffffff55'; g.lineWidth = 1;
  g.strokeRect(x + gap + 0.5, y + gap + 0.5, s - gap * 2 - 1, s - gap * 2 - 1);
  if (!ghost && s > 12) { g.fillStyle = '#ffffff30'; g.fillRect(x + gap + 1, y + gap + 1, s - gap * 2 - 2, s * 0.13); g.fillStyle = '#09101c25'; g.fillRect(x + gap + 1, y + s * 0.77, s - gap * 2 - 2, s * 0.15); }
}
function piece(b: Board, ox: number, oy: number, s: number, py: number, ghost = false): void {
  for (const cell of cells(b.piece, b.rotation)) { const x = b.x + cell % 4, y = py + Math.floor(cell / 4); if (y >= 0 && y < 20) block(ox + x * s, oy + y * s, s, b.piece, ghost); }
}
function well(b: Board, x: number, y: number, s: number, own: boolean): void {
  g.fillStyle = '#060d1a'; g.fillRect(x, y, 10 * s, 20 * s);
  g.strokeStyle = own ? '#71e9e099' : '#7990b64d'; g.lineWidth = own ? 2 : 1; g.strokeRect(x - 1, y - 1, 10 * s + 2, 20 * s + 2);
  g.strokeStyle = '#91b6ff0c'; g.lineWidth = 1;
  for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(x + i * s, y); g.lineTo(x + i * s, y + 20 * s); g.stroke(); }
  for (let i = 1; i < 20; i++) { g.beginPath(); g.moveTo(x, y + i * s); g.lineTo(x + 10 * s, y + i * s); g.stroke(); }
  for (let i = 0; i < b.grid.length; i++) if (b.grid[i]) block(x + i % 10 * s, y + Math.floor(i / 10) * s, s, b.grid[i]);
  if (!b.dead && b.piece) {
    let ghostY = b.y; for (let i = 0; i < 22; i++) { if (!fits(b.grid, b.piece, b.rotation, b.x, ghostY + 1)) break; ghostY++; }
    piece(b, x, y, s, ghostY, true); piece(b, x, y, s, b.y);
  }
  if (b.dead) { g.fillStyle = '#060d1acb'; g.fillRect(x, y + 8 * s, 10 * s, 4 * s); g.fillStyle = '#ffabc0'; g.font = `700 ${Math.max(10, s * 0.65)}px system-ui`; g.textAlign = 'center'; g.fillText('TOP OUT', x + 5 * s, y + 10 * s); g.textAlign = 'left'; }
}
function text(value: string, x: number, y: number, size = 13, colour = '#a7b8d5'): void { g.fillStyle = colour; g.font = `600 ${size}px system-ui`; g.fillText(value, x, y); }
function frame(): void {
  const now = performance.now();
  if (audio?.state === 'running' && now >= nextNote) { const hz = melody[note++ % melody.length]; if (hz) tone(hz, 0.21, 0.075); nextNote = now + 250; }
  room.input({ dx: touchDx || (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0), soft: soft || keys.has('ArrowDown') || keys.has('KeyS'), rotate, drop }); rotate = false; drop = false;
  const bg = g.createRadialGradient(w * 0.5, h * 0.3, 10, w * 0.5, h * 0.5, Math.max(w, h)); bg.addColorStop(0, '#172747'); bg.addColorStop(1, '#060b16'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  text(document.title.toUpperCase(), 20, 61, 18, '#eef6ff');
  const round = room.round;
  text(round?.phase === 'over' ? `Next round in ${Math.ceil(round.secondsLeft)}` : round ? `${Math.ceil(round.secondsLeft)}s` : 'Joining…', 20, 80, 12);
  const boards: Board[] = []; room.each('board', b => boards.push(b));
  const me = room.me; const focus = me ?? boards[0];
  if (focus) {
    const compact = w < 640, landscape = w >= 640 && h <= 460, top = landscape ? 58 : 108, bottom = compact ? 174 : landscape ? 18 : 110;
    const s = Math.max(5, Math.min(32, (h - top - bottom) / 20, (w - (compact ? 116 : 330)) / 10));
    const total = 10 * s + 98 + (!compact && !landscape && boards.length > 1 ? 150 : 0);
    const x = Math.max(12, (w - total) / 2), y = top;
    const roster = room.roster.find(r => r.seat === focus.seat);
    text(me ? 'YOUR WELL' : (roster?.name ?? 'WATCHING'), x, y - 13, 11, '#7aeee1');
    well(focus, x, y, s, !!me);
    const side = x + 10 * s + 18;
    text('NEXT', side, y + 12, 10);
    const preview = Math.min(17, s);
    for (const cell of cells(focus.next || 1, 0)) block(side + cell % 4 * preview, y + 26 + Math.floor(cell / 4) * preview, preview, focus.next || 1);
    text('SCORE', side, y + 110, 10); text(String(focus.score), side, y + 136, 21, '#f5f8ff');
    if (h >= 350) { text('LINES', side, y + 170, 10); text(String(focus.lines), side, y + 194, 19, '#f5f8ff'); }
    if (20 * s > 260) { text('LEVEL', side, y + 230, 10); text(String(1 + Math.floor(focus.lines / 10)), side, y + 254, 19, '#f5f8ff'); }
    if (!compact && !landscape) {
      let ry = y;
      for (const rival of boards.filter(b => b.id !== focus.id).slice(0, 3)) {
        const mini = Math.min(6, s * 0.25), rx = side + 112;
        const r = room.roster.find(r => r.seat === rival.seat);
        text(`${r?.driver === 'bot' ? 'BOT · ' : ''}${r?.name ?? 'Player'}`, rx, ry - 10, 10);
        well(rival, rx, ry, mini, false); text(String(rival.score), rx + 10 * mini + 9, ry + 14, 12, '#eef6ff'); ry += 20 * mini + 38;
      }
    }
    const ranked = boards.slice().sort((a, b) => b.score - a.score || a.seat - b.seat);
    const nameOf = (b: Board): string => { const r = room.roster.find(r => r.seat === b.seat); return b.id === me?.id ? 'YOU' : `${r?.driver === 'bot' ? 'BOT ' : ''}${r?.name ?? 'Player'}`; };
    const rank = ranked.findIndex(b => b.id === focus.id) + 1;
    if (compact) {
      text(`RANK ${rank}/${ranked.length} · LEADER ${ranked[0]?.score ?? 0}`, 16, h - 155, 12, '#7aeee1');
      ranked.slice(0, 4).forEach((b, i) => text(`${i + 1}. ${nameOf(b).slice(0, 12)}  ${b.score}`, 16 + (i % 2) * (w / 2), h - 132 + Math.floor(i / 2) * 19, 11, b.id === me?.id ? '#f5f8ff' : '#a7b8d5'));
    } else if (landscape) {
      text(`RANK ${rank}/${ranked.length}`, side + 112, y + 142, 12, '#7aeee1');
      ranked.slice(0, 4).forEach((b, i) => text(`${i + 1}. ${nameOf(b).slice(0, 10)} ${b.score}`, side + 112, y + 15 + i * 24, 12, b.id === me?.id ? '#f5f8ff' : '#a7b8d5'));
    }
    if (round?.phase === 'over') {
      const results = round.results?.length ? round.results : ranked.map((b, i) => ({ name: nameOf(b), score: b.score, seat: b.seat, place: i + 1 }));
      const pw = Math.min(340, w - 32), ph = 110 + results.length * 27, px = (w - pw) / 2, py = Math.max(42, (h - ph) / 2);
      g.fillStyle = '#081329f5'; g.fillRect(px, py, pw, ph); g.strokeStyle = '#71e9e0'; g.strokeRect(px, py, pw, ph);
      text(`${results[0]?.name ?? 'Player'} WINS`, px + 16, py + 30, 18, '#ffd75b');
      text('FINAL SCORES', px + 16, py + 55, 11);
      results.forEach((r, i) => text(`${r.place}. ${r.name.slice(0, 18)}${r.seat === me?.seat ? ' (YOU)' : ''}  ${r.score}`, px + 16, py + 82 + i * 27, 13, '#f5f8ff'));
      text(`Next round in ${Math.ceil(round.secondsLeft)}s`, px + 16, py + ph - 15, 11);
    }
  } else text('Finding your seat…', Math.max(20, w / 2 - 70), h / 2, 15);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
