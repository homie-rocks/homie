import { openRoom } from '@homie-rocks/studio/rules/view';
import type rules from './rules';

const room = openRoom<typeof rules>();
const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d') as CanvasRenderingContext2D;
addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= 9) room.command('pick', { n });
});
let banner = '';
room.on('reveal', (e) => { banner = e.winner === '' ? 'Nobody' : `${e.winner} wins with ${e.n}`; });
function frame(): void {
  room.input({ ax: 0, ay: 0 });
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillText(`Turn ${room.shared.turn} ${room.shared.phase === 1 ? 'pick 1 to 9' : banner}`, 20, 20);
  g.fillText(`${Object.keys(room.shared.picks).length} of ${room.shared.order.length} have picked`, 20, 40);
  let y = 70;
  room.each('guest', (p) => { g.fillText(`${p.mine ? 'You' : p.id}: ${p.score}`, 20, y); y += 18; });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
