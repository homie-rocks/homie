import { openRoom } from '@homie-rocks/studio/rules/view';
const room = openRoom();
const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 420; document.body.append(canvas);
const g = canvas.getContext('2d')!;
let flare = 0;
room.on('flare', (e) => { flare = e.value; });
const keys = new Set<string>();
const send = () => room.input({ ax: (keys.has('d') ? 127 : 0) - (keys.has('a') ? 127 : 0), ay: (keys.has('s') ? 127 : 0) - (keys.has('w') ? 127 : 0) });
addEventListener('keydown', (e) => { keys.add(e.key); send(); if (e.key === 'c') room.command('cheer'); });
addEventListener('keyup', (e) => { keys.delete(e.key); send(); });
function draw() {
  g.clearRect(0, 0, 720, 420);
  room.each('lamp', (lamp) => { g.fillStyle = lamp.on ? 'gold' : 'gray'; g.fillRect(360 + lamp.pos.x * 30 - 5, 210 + lamp.pos.y * 30 - 5, 10, 10); });
  room.each('keeper', (k) => { g.fillStyle = k.mine ? 'white' : 'teal'; g.beginPath(); g.arc(360 + k.pos.x * 30, 210 + k.pos.y * 30, 12, 0, 7); g.fill(); g.fillText(String(k.score), 360 + k.pos.x * 30, 190 + k.pos.y * 30); });
  g.fillText(`pace ${room.shared.pace} bonus ${room.shared.bonus} lit ${room.shared.lit} flare ${flare}`, 10, 14);
  requestAnimationFrame(draw);
}
draw();
