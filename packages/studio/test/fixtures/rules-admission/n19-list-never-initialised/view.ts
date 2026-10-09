import { openRoom } from '@homie-rocks/studio/rules/view';
import type rules from './rules';

const room = openRoom<typeof rules>();
const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d') as CanvasRenderingContext2D;
const keys = new Set<string>();
addEventListener('keydown', (e) => { keys.add(e.code); });
addEventListener('keyup', (e) => { keys.delete(e.code); });
let lastPost = -1;
room.on('post', (e) => { lastPost = e.n; });
const px = (x: number): number => 320 + x * 24;
const py = (y: number): number => 200 - y * 24;
function frame(): void {
  room.input({ ax: (keys.has('KeyD') ? 127 : 0) - (keys.has('KeyA') ? 127 : 0), ay: (keys.has('KeyW') ? 127 : 0) - (keys.has('KeyS') ? 127 : 0) });
  g.clearRect(0, 0, canvas.width, canvas.height);
  const laps = room.shared.laps;
  g.fillText(`Laps ${laps[0] ?? 0} : ${laps[1] ?? 0}  last post ${lastPost}  last lap by team ${room.shared.last.team}`, 20, 20);
  room.each('runner', (r) => {
    g.fillStyle = r.team === 0 ? '#e33' : '#36e';
    g.beginPath(); g.arc(px(r.pos.x), py(r.pos.y), r.baton ? 13 : 9, 0, Math.PI * 2); g.fill();
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
