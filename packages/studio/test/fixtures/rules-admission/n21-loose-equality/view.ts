import { openRoom } from '@homie-rocks/studio/rules/view';
import type rules from './rules';

const room = openRoom<typeof rules>();
const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d') as CanvasRenderingContext2D;
const keys = new Set<string>();
addEventListener('keydown', (e) => { keys.add(e.code); });
addEventListener('keyup', (e) => { keys.delete(e.code); });
const cheers: { x: number; y: number; team: number }[] = [];
room.on('cheer', (e) => { if (e.at) cheers.push({ x: e.at.x, y: e.at.y, team: e.team }); });
const px = (x: number): number => 320 + x * 24;
const py = (y: number): number => 200 - y * 24;
function frame(): void {
  room.input({ ax: (keys.has('KeyD') ? 127 : 0) - (keys.has('KeyA') ? 127 : 0), ay: (keys.has('KeyW') ? 127 : 0) - (keys.has('KeyS') ? 127 : 0) });
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillText(`Red ${room.shared.red}  Blue ${room.shared.blue}`, 20, 20);
  room.each('flag', (flag) => { g.fillStyle = flag.team === 0 ? '#e33' : '#36e'; g.fillRect(px(flag.pos.x) - 4, py(flag.pos.y) - 12, 8, 12); });
  room.each('runner', (r) => {
    g.fillStyle = r.team === 0 ? '#e33' : '#36e';
    g.beginPath(); g.arc(px(r.pos.x), py(r.pos.y), 10, 0, Math.PI * 2); g.fill();
    if (r.mine) g.strokeRect(px(r.pos.x) - 12, py(r.pos.y) - 12, 24, 24);
    g.fillText(String(r.score), px(r.pos.x) - 3, py(r.pos.y) - 14);
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
