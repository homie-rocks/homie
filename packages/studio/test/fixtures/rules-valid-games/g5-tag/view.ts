import { openRoom } from "@homie-rocks/studio/rules/view";
import type rules from "./rules";

const room = openRoom<typeof rules>();
const canvas = document.getElementById("c") as HTMLCanvasElement;
const g = canvas.getContext("2d") as CanvasRenderingContext2D;
const keys = new Set<string>();
addEventListener("keydown", (e) => { keys.add(e.code); });
addEventListener("keyup", (e) => { keys.delete(e.code); });
function frame(): void {
  room.input({ ax: (keys.has('KeyD') ? 127 : 0) - (keys.has('KeyA') ? 127 : 0), ay: (keys.has('KeyW') ? 127 : 0) - (keys.has('KeyS') ? 127 : 0) });
  g.clearRect(0, 0, canvas.width, canvas.height);
  room.each('runner', (r) => { g.fillStyle = r.isIt ? '#f33' : '#3c6'; g.fillRect(r.pos.x * 20 + 300, 200 - r.pos.y * 20, 12, 12); });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
