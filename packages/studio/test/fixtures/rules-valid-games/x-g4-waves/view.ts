import { openRoom } from "@homie-rocks/studio/rules/view";
import type rules from "./rules";

const room = openRoom<typeof rules>();
const canvas = document.getElementById("c") as HTMLCanvasElement;
const g = canvas.getContext("2d") as CanvasRenderingContext2D;
const keys = new Set<string>();
addEventListener("keydown", (e) => { keys.add(e.code); });
addEventListener("keyup", (e) => { keys.delete(e.code); });
room.on('zap', (e) => { g.strokeRect(e.to.x, e.to.y, 2, 2); });
function frame(): void {
  room.input({ ax: (keys.has('KeyD') ? 127 : 0) - (keys.has('KeyA') ? 127 : 0), ay: (keys.has('KeyW') ? 127 : 0) - (keys.has('KeyS') ? 127 : 0) });
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillText('wave ' + String(room.shared.wave) + ' well ' + String(room.shared.wellHp), 20, 20);
  room.each('hero', (h) => { g.fillRect(h.pos.x * 20 + 300, 200 - h.pos.y * 20, 12, 12); });
  room.each('slime', (s) => { g.fillRect(s.pos.x * 20 + 300, 200 - s.pos.y * 20, 8, 8); });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
