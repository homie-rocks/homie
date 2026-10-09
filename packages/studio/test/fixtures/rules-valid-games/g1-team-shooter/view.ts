import { openRoom } from "@homie-rocks/studio/rules/view";
import type rules from "./rules";

const room = openRoom<typeof rules>();
const canvas = document.getElementById("c") as HTMLCanvasElement;
const g = canvas.getContext("2d") as CanvasRenderingContext2D;
const keys = new Set<string>();
addEventListener("keydown", (e) => { keys.add(e.code); });
addEventListener("keyup", (e) => { keys.delete(e.code); });
room.on('bang', () => {});
function frame(): void {
  const x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const y = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  room.input({ ax: x * 127, ay: y * 127, aimx: x * 127, aimy: y * 127, fire: keys.has('Space') });
  g.clearRect(0, 0, canvas.width, canvas.height);
  room.each('soldier', (s) => { g.fillStyle = s.team === 0 ? '#e33' : '#36f'; g.fillRect(s.pos.x * 20 + 300, 200 - s.pos.y * 20, 12, 12); });
  room.each('bullet', (b) => { g.fillStyle = '#fff'; g.fillRect(b.pos.x * 20 + 300, 200 - b.pos.y * 20, 3, 3); });
  if (keys.has('KeyT')) room.command('taunt', {});
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
