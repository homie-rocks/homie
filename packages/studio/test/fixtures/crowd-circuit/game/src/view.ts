// Presentation only: openRoom gives predicted own movement and interpolated other bodies.
// Send intent; rules decide outcomes. Keep rendered obstacles aligned with room.map.
import { openRoom } from '@homie-rocks/studio/rules/view';
import { PALETTE, guardGestures } from '@homie-rocks/studio/netplay';
import type rules from './rules';

const room = openRoom<typeof rules>();
const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d') as CanvasRenderingContext2D;
guardGestures();

/* ------------------------------------------------------------------ input: keys, or a thumb dragged from where it landed */
const keys = new Set<string>();
addEventListener('keydown', (e) => { keys.add(e.code); });
addEventListener('keyup', (e) => { keys.delete(e.code); });
addEventListener('blur', () => keys.clear());
let thumb: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { if (!thumb) thumb = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY }; });
addEventListener('pointermove', (e) => { if (thumb && e.pointerId === thumb.id) { thumb.x = e.clientX; thumb.y = e.clientY; } });
const lift = (e: PointerEvent): void => { if (thumb && e.pointerId === thumb.id) thumb = null; };
addEventListener('pointerup', lift);
addEventListener('pointercancel', lift);

function stick(): { ax: number; ay: number } {
  let x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  let y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  if (thumb) { x = (thumb.x - thumb.x0) / 48; y = -(thumb.y - thumb.y0) / 48; }
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return { ax: Math.round(x * 127), ay: Math.round(y * 127) };
}

// A short local tone follows an authoritative score change; sound unlocks on interaction.
let audio: AudioContext | null = null;
function unlock(): void { audio ??= new AudioContext(); void audio.resume(); }
addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
function ding(): void {
  if (!audio || audio.state !== 'running') return;
  const osc = audio.createOscillator(), gain = audio.createGain();
  osc.frequency.setValueAtTime(660, audio.currentTime);
  osc.frequency.exponentialRampToValueAtTime(990, audio.currentTime + .09);
  gain.gain.setValueAtTime(.045, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .14);
  osc.connect(gain).connect(audio.destination); osc.start(); osc.stop(audio.currentTime + .15);
}
const hud = document.getElementById('hud')!;
const map = room.map;
let lastScore = 0;
function frame(): void {
  room.input(stick());
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(innerWidth*dpr) || canvas.height !== Math.round(innerHeight*dpr)) {
    canvas.width = Math.round(innerWidth*dpr); canvas.height = Math.round(innerHeight*dpr);
  }
  const followed = room.net.viewSeat;
  let focus = room.me?.pos ?? {x: 0, y: 0};
  room.each('runner', r => { if (r.seat === followed) focus = r.pos; });
  const overview = room.net.watching && followed === null;
  const scale = overview ? Math.min(canvas.width/42, canvas.height/124) : Math.min(canvas.width/26, canvas.height/26);
  if (overview) focus = {x:0,y:0};
  else {
    const hx=Math.min(20,canvas.width/(2*scale)), hy=Math.min(60,canvas.height/(2*scale));
    focus={x:Math.max(-20+hx,Math.min(20-hx,focus.x)),y:Math.max(-60+hy,Math.min(60-hy,focus.y))};
  }
  const px = (x: number) => canvas.width/2+(x-focus.x)*scale;
  const py = (y: number) => canvas.height/2-(y-focus.y)*scale;
  g.fillStyle='#080e19'; g.fillRect(0,0,canvas.width,canvas.height);
  g.fillStyle='#132639'; g.fillRect(px(-20),py(60),40*scale,120*scale);
  g.strokeStyle='#203f53'; g.lineWidth=1;
  for (let y=-60; y<=60; y+=4) {g.beginPath();g.moveTo(px(-20),py(y));g.lineTo(px(20),py(y));g.stroke();}
  for (const x of [-8,8]) {
    g.fillStyle=x===8?'#63efd0':'#ffc475';g.fillRect(px(x)-.08*scale,py(60),.16*scale,120*scale);
  }
  let visible=0;
  room.each('runner', r => {
    visible++;
    g.fillStyle=PALETTE[(r.seat??0)%PALETTE.length];g.beginPath();g.arc(px(r.pos.x),py(r.pos.y),.35*scale,0,Math.PI*2);g.fill();
    if(r.mine) {g.strokeStyle='#fff';g.lineWidth=2*dpr;g.stroke();}
    g.fillStyle='#fff';g.font=`${12*dpr}px system-ui`;g.textAlign='center';
    if(r.mine || overview) g.fillText(r.mine?'YOU':String(r.seat),px(r.pos.x),py(r.pos.y)-.65*scale);
  });
  const me=room.me, round=room.round;
  if(me && me.score>lastScore) {ding();room.net.spotlight(me.seat);}
  lastScore=me?.score??0;
  const leaders=[...room.roster].sort((a,b)=>b.score-a.score).slice(0,3);
  hud.textContent = `CROWD CIRCUIT  ·  ${round?.phase==='live'?Math.ceil(round.secondsLeft)+'s':'Next round '+Math.ceil(round?.secondsLeft??0)+'s'}\n`+
    `${room.status} · ${room.roster.length} runners · ${visible} nearby\n`+
    (me?`Score ${me.score}  ·  Cross the ${me.east?'RIGHT →':'← LEFT'} line`:'Watching the circuit')+
    `\n${leaders.map(r=>`${r.name}${r.driver!=='person'?' [bot]':''} ${r.score}`).join('  ·  ')}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
