import { openRoom } from '@homie-rocks/studio/rules/view';
import type rules from './rules';

const room = openRoom<typeof rules>();
const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d') as CanvasRenderingContext2D;
const keys = new Set<string>();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'KeyQ') room.command('shout'); });
addEventListener('keyup', (e) => { keys.delete(e.code); });
let flash = 0;
room.on('crown', () => { flash = 20; });
const px = (x: number): number => 320 + x * 24;
const py = (y: number): number => 200 - y * 24;
function frame(): void {
  room.input({ ax: (keys.has('KeyD') ? 127 : 0) - (keys.has('KeyA') ? 127 : 0), ay: (keys.has('KeyW') ? 127 : 0) - (keys.has('KeyS') ? 127 : 0), shove: keys.has('Space') });
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillText(`Best ${room.shared.best}`, 20, 20);
  room.each('hill', (h) => { g.fillStyle = flash > 0 ? '#fd6' : '#553'; g.beginPath(); g.arc(px(h.pos.x), py(h.pos.y), 48, 0, Math.PI * 2); g.fill(); });
  if (flash > 0) flash -= 1;
  room.each('runner', (r) => {
    g.fillStyle = r.id === room.shared.leader ? '#fd6' : '#9cf';
    g.beginPath(); g.arc(px(r.pos.x), py(r.pos.y), 10, 0, Math.PI * 2); g.fill();
    g.fillText(String(r.points), px(r.pos.x) - 3, py(r.pos.y) - 14);
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
