import { openRoom } from '@homie-rocks/studio/rules/view';
import type rules from './rules';

const room = openRoom<typeof rules>();
const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d') as CanvasRenderingContext2D;
const keys = new Set<string>();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'KeyT') room.command('taunt', { emoji: 2 }); });
addEventListener('keyup', (e) => { keys.delete(e.code); });
const taunts: { id: string; emoji: number }[] = [];
room.on('taunt', (e) => { if (e.id) taunts.push({ id: e.id, emoji: e.emoji }); });
const px = (x: number): number => 320 + x * 24;
const py = (y: number): number => 200 - y * 24;
function frame(): void {
  room.input({ ax: (keys.has('KeyD') ? 127 : 0) - (keys.has('KeyA') ? 127 : 0), ay: (keys.has('KeyW') ? 127 : 0) - (keys.has('KeyS') ? 127 : 0), dash: keys.has('Space') });
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.strokeStyle = '#f66'; g.beginPath(); g.arc(px(0), py(0), room.shared.radius * 24, 0, Math.PI * 2); g.stroke();
  g.fillText(`${room.shared.left} left, speed ${room.tune.speed}`, 20, 20);
  room.each('fighter', (r) => {
    g.globalAlpha = r.motion.out ? 0.3 : 1;
    g.beginPath(); g.arc(px(r.pos.x), py(r.pos.y), 10, 0, Math.PI * 2); g.fill();
    g.fillText('♥'.repeat(r.hearts), px(r.pos.x) - 10, py(r.pos.y) - 14);
  });
  g.globalAlpha = 1;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
