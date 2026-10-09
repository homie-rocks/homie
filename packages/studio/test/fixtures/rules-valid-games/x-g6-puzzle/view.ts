import { openRoom } from "@homie-rocks/studio/rules/view";
import type rules from "./rules";

const room = openRoom<typeof rules>();
const row = document.getElementById("row") as HTMLDivElement;
row.addEventListener('click', (e) => {
  const at = Number((e.target as HTMLElement).dataset.at);
  if (Number.isInteger(at)) room.command('swap', { at });
});
room.on('fanfare', (e) => { document.title = 'Seat ' + String(e.seat) + ' is home'; });
function frame(): void {
  room.input({ ax: 0, ay: 0 });
  const me = room.me;
  if (me) row.textContent = (me.board as number[]).join(' ');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
