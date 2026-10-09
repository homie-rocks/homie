import { openRoom } from '@homie-rocks/studio/rules/view';
const room = openRoom();
const out = document.createElement('pre'); document.body.append(out);
function draw() {
  const s = room.shared;
  const lines: string[] = [`beat ${s.beat} at ${s.stall}`, `first ${s.first} last ${s.last} best ${s.best} quiet ${s.quiet} total ${s.total}`];
  for (const [name, count] of Object.entries(s.sales)) lines.push(`${name.padEnd(8)} ${'#'.repeat(Math.min(40, count))}`);
  lines.push(`first stall on the board: ${Object.keys(s.sales)[0] ?? '-'}`);
  for (const seat of Object.keys(s.bySeat)) lines.push(`seat ${seat}: ${s.bySeat[seat] ?? 0}`);
  room.each('drummer', (d) => { lines.push(`${d.seat} likes ${d.favourite} (${Object.keys(d.mine).length} stalls, ${Object.values(d.mine).reduce((a, b) => a + b, 0)} sales)`); });
  out.textContent = lines.join('\n');
  requestAnimationFrame(draw);
}
draw();
addEventListener('keydown', (e) => { if (e.key === ' ') room.command('tap'); });
