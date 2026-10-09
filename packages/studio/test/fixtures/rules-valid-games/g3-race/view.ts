import { openRoom } from "@homie-rocks/studio/rules/view";
import type rules from "./rules";

const room = openRoom<typeof rules>();
const canvas = document.getElementById("c") as HTMLCanvasElement;
const g = canvas.getContext("2d") as CanvasRenderingContext2D;
const keys = new Set<string>();
addEventListener("keydown", (e) => { keys.add(e.code); });
addEventListener("keyup", (e) => { keys.delete(e.code); });
addEventListener('keydown', (e) => { if (e.code === 'KeyH') room.command('honk', {}); });
function frame(): void {
  room.input({ steer: (keys.has('KeyA') ? 127 : 0) - (keys.has('KeyD') ? 127 : 0), gas: keys.has('KeyW'), brake: keys.has('KeyS') });
  g.clearRect(0, 0, canvas.width, canvas.height);
  room.each('kart', (k) => { g.fillRect(k.pos.x * 12 + 300, 200 - k.pos.y * 12, 10, 10); g.fillText(String(k.lap), k.pos.x * 12 + 300, 190 - k.pos.y * 12); });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
