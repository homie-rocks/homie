import { openRoom } from '@homie-rocks/studio/rules/view';
const room = openRoom();
const canvas = document.createElement('canvas');
canvas.width = 720;
canvas.height = 480;
canvas.style.width = 'min(100%,720px)';
document.body.append(canvas);
const ctx = canvas.getContext('2d')!;
const keys = new Set<string>();
let flash = 0;
room.on('coin', effect => {
  flash = 20;
});
function controls() {
  room.input({
    ax: (keys.has('ArrowRight') ? 127 : 0) - (keys.has('ArrowLeft') ? 127 : 0),
    ay: (keys.has('ArrowDown') ? 127 : 0) - (keys.has('ArrowUp') ? 127 : 0)
  });
}
window.addEventListener('keydown', e => {
  if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
  keys.add(e.key);
  controls();
});
window.addEventListener('keyup', e => {
  keys.delete(e.key);
  controls();
});
window.addEventListener('blur', () => {
  keys.clear();
  controls();
});
const buttons = document.createElement('div');
document.body.append(buttons);
let shownButtons = '';
function draw() {
  const offered: { id: string; k: string; args: Record<string, unknown>; text: string }[] = [];
  room.each('miner', entity => {
    if (entity.driver === 'ai') for (const button of room.askButtons(entity.id)) offered.push({ id: entity.id, ...button });
  });
  const signature = JSON.stringify(offered);
  if (signature !== shownButtons) {
    shownButtons = signature;
    buttons.replaceChildren(...offered.map(offer => {
      const button = document.createElement('button');
      button.textContent = offer.text;
      button.onclick = () => room.ask(offer.id, offer.k, offer.args);
      return button;
    }));
  }
  ctx.fillStyle = flash > 0 ? '#26364a' : '#101a2c';
  ctx.fillRect(0, 0, 720, 480);
  flash = Math.max(0, flash - 1);
  ctx.font = '13px sans-serif';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#d6edff';
  ctx.fillText('collect · ' + (room.round?.secondsLeft ?? 0) + ' seconds · ' + room.status, 16, 24);
  ctx.fillStyle = '#465269';
  for (const b of room.map.boxes) ctx.fillRect(360 + b.min.x * 25, 240 + b.min.y * 25, (b.max.x - b.min.x) * 25, (b.max.y - b.min.y) * 25);
  for (const c of room.map.circles) {
    ctx.beginPath();
    ctx.arc(360 + c.at.x * 25, 240 + c.at.y * 25, c.r * 25, 0, Math.PI * 2);
    ctx.fill();
  }
  room.each('miner', e => {
    ctx.fillStyle = e.mine ? '#ffd35b' : '#78debc';
    ctx.beginPath();
    ctx.arc(360 + e.pos.x * 25, 240 + e.pos.y * 25, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(String(e.score), 350 + e.pos.x * 25, 220 + e.pos.y * 25);
  });
  room.each('gem', e => {
    ctx.fillStyle = '#a9f5ef';
    ctx.beginPath();
    ctx.moveTo(360 + e.pos.x * 25, 230 + e.pos.y * 25);
    ctx.lineTo(370 + e.pos.x * 25, 240 + e.pos.y * 25);
    ctx.lineTo(360 + e.pos.x * 25, 250 + e.pos.y * 25);
    ctx.lineTo(350 + e.pos.x * 25, 240 + e.pos.y * 25);
    ctx.fill();
  });
  ctx.fillText('Arrows: race for the diamonds. They appear after two seconds.', 16, 460);
  requestAnimationFrame(draw);
}
draw();
