import { openRoom } from '@homie-rocks/studio/rules/view';
const room = openRoom();
const out = document.createElement('pre'); document.body.append(out);
let pops = 0;
room.on('pop', () => { pops += 1; });
const keys = new Set<string>();
const send = () => room.input({ ax: (keys.has('d') ? 127 : 0) - (keys.has('a') ? 127 : 0), ay: (keys.has('s') ? 127 : 0) - (keys.has('w') ? 127 : 0) });
addEventListener('keydown', (e) => { keys.add(e.key); send(); });
addEventListener('keyup', (e) => { keys.delete(e.key); send(); });
function draw() {
  const lines: string[] = [`haul ${room.shared.haul}  opens ${room.shared.opens}  pops ${pops}`];
  room.each('crate', (c) => { lines.push(`crate ${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)} ${['closed', 'open', 'empty'][c.state] ?? '?'}`); });
  room.each('runner', (r) => { lines.push(`${r.mine ? '> ' : '  '}seat ${r.seat}: ${r.score}`); });
  out.textContent = lines.join('\n');
  requestAnimationFrame(draw);
}
draw();
