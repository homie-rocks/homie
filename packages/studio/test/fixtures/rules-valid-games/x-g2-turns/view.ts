import { openRoom } from "@homie-rocks/studio/rules/view";
import type rules from "./rules";

const room = openRoom<typeof rules>();
const canvas = document.getElementById("c") as HTMLCanvasElement;
const g = canvas.getContext("2d") as CanvasRenderingContext2D;
const keys = new Set<string>();
addEventListener("keydown", (e) => { keys.add(e.code); });
addEventListener("keyup", (e) => { keys.delete(e.code); });
addEventListener('keydown', (e) => { if (e.code === 'Space') room.command('roll', {}); });
room.on('dice', (e) => { g.fillText(String(e.face), 20, 20); });
function frame(): void {
  room.input({ ax: (keys.has('KeyD') ? 127 : 0) - (keys.has('KeyA') ? 127 : 0), ay: (keys.has('KeyW') ? 127 : 0) - (keys.has('KeyS') ? 127 : 0) });
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillText(String(room.shared.banner), 20, 40);
  room.each('guest', (p) => { g.fillRect(p.pos.x * 20 + 300, 200 - p.pos.y * 20, 12, 12); g.fillText(String(p.score), p.pos.x * 20 + 300, 190 - p.pos.y * 20); });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
