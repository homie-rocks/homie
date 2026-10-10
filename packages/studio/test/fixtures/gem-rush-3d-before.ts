// Original gem-rush-3d simulation at 60 frames/s, extracted unchanged from the slice 6 starter.
// Only networking, rendering and Lab callbacks are inert. Used for migration feel comparisons.
const T={"knockRange":2.2,"hitStopMs":70,"knockDistance":3.7,"knockMs":420,"knockEase":4,"squash":0.35,"settleMs":260,"flashMs":110,"shake":0.16,"sparks":9,"ringMs":900};let time=0;const fair={level:3,reactionMs:250,aimNoise:.15,aggression:.5,positioning:.5};
const net={now:()=>time,skillOf:()=>fair,policy:{},send:()=>{},take:()=>{}};const lab={stage:''};const mySeat=()=>null;const me={};const labKnock=()=>{},addWave=()=>{},jumped=()=>{},dodged=()=>{},q=n=>n;
const standStill=()=>{}; const bodies=new Map();let gems=[],gemSeq=0,zone=null,round={n:1,phase:'live'}; const AI_MARK=' · AI',roster={slots:[]};
const W = 26;
const H = 16;
const R_AV = 0.44;
const OBSTACLES: readonly { x: number; y: number; r: number; kind: 'camp' | 'bush' | 'rock' | 'stone' | 'tree' }[] = [
  // The clearing's heart: a campfire ring with log seats (a game makes it its den, its camp, its well).
  { x: 13.0, y: 4.0, r: 1.05, kind: 'camp' },
  { x: 4.6, y: 3.8, r: 0.75, kind: 'bush' }, { x: 21.4, y: 4.6, r: 0.55, kind: 'rock' }, { x: 6.0, y: 12.6, r: 0.5, kind: 'rock' },
  { x: 20.2, y: 12.2, r: 0.75, kind: 'bush' }, { x: 9.6, y: 13.4, r: 0.45, kind: 'stone' }, { x: 23.6, y: 2.0, r: 0.5, kind: 'tree' },
];
function bound(x: number, y: number): { x: number; y: number } {
  x = Math.max(R_AV, Math.min(W - R_AV, x)); y = Math.max(R_AV, Math.min(H - R_AV, y));
  for (const o of OBSTACLES) {
    const dx = x - o.x; const dy = y - o.y; const d = Math.hypot(dx, dy); const min = o.r + R_AV;
    if (d >= min) continue;
    if (d > 1e-6) { x = o.x + (dx / d) * min; y = o.y + (dy / d) * min; } else x = o.x + min;
  }
  return { x, y };
}
const R_GEM = 0.26;
const SPEED = 6.8;
const BOT_SPEED = 5;
const MAX_SLOTS = 8;
const ZONE_MS = 12_000;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const spawnPoint = (i: number): { x: number; y: number } => {
  const a = (i / MAX_SLOTS) * Math.PI * 2;
  return { x: W / 2 + Math.cos(a) * 6.6, y: H / 2 + Math.sin(a) * 5 };
};
const newGem = (): Gem => {
  let x = rnd(1.2, W - 1.2); let y = rnd(1.2, H - 1.2);
  for (let i = 0; i < 12 && OBSTACLES.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + 0.7); i += 1) { x = rnd(1.2, W - 1.2); y = rnd(1.2, H - 1.2); }
  return { id: ++gemSeq, x, y };
};
function bodyFor(slot: Slot): Body {
  const sp = spawnPoint(slot.slot);
  return { slot: slot.slot, seat: slot.seat, name: slot.name, bot: slot.bot, x: sp.x, y: sp.y, vx: 0, vy: 0, score: 0, tx: sp.x, ty: sp.y, kvx: 0, kvy: 0, kx: sp.x, ky: sp.y, kat: 0, knockUntil: 0 };
}
function newZone(n: number): Zone {
  return { n, x: rnd(4.4, W - 4.4), y: rnd(4, H - 4), r: 3, until: net.now() + ZONE_MS };
}
function hostWave(from: Body): void {
  addWave({ slot: from.slot }); net.send('wave', { slot: from.slot });
  for (const b of bodies.values()) {
    if (b === from || Math.hypot(b.x - from.x, b.y - from.y) > T.knockRange) continue;
    knock(b, from.x, from.y, from.slot);
  }
}
function knock(b: Body, fx: number, fy: number, by: number): void {
  let dx = b.x - fx; let dy = b.y - fy;
  const len = Math.hypot(dx, dy);
  if (len < 0.02) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); } else { dx /= len; dy /= len; }
  const at = net.now() + T.hitStopMs;
  const o: Knock & { x: number; y: number } = !b.bot && b.seat !== null && b.seat === mySeat() ? me : b;
  o.kvx = dx; o.kvy = dy; o.kx = o.x; o.ky = o.y; o.kat = at; o.knockUntil = at + T.knockMs;
  if (o === b && !b.bot && b.seat !== null) net.take(b.seat, T.hitStopMs + T.knockMs);
  labKnock(b);
  const d = { slot: b.slot, dx: q(dx, 2), dy: q(dy, 2), by };
  addWave(d, true); net.send('knock', d);
}
function slide(o: Knock & { x: number; y: number; vx: number; vy: number }, now: number, dt: number): void {
  const u = Number.isFinite(o.kat) ? Math.max(0, Math.min(1, (now - o.kat) / Math.max(1, T.knockMs))) : 1;
  const e = 1 - (1 - u) ** Math.max(1, T.knockEase);
  const { x, y } = bound(o.kx + o.kvx * T.knockDistance * e, o.ky + o.kvy * T.knockDistance * e);
  if (u >= 1) { o.vx = 0; o.vy = 0; } else if (dt > 0) { o.vx = (x - o.x) / dt; o.vy = (y - o.y) / dt; }
  o.x = x; o.y = y;
}
function landed(o: Knock & { x: number; y: number; vx: number; vy: number }): void {
  if (!o.kat) return;
  slide(o, o.kat + T.knockMs, 0);
  o.kat = 0;
}
function integrate(o: { x: number; y: number; vx: number; vy: number }, mx: number, my: number, dt: number): void {
  mx = Number(mx) || 0; my = Number(my) || 0;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; } // an intent is at most full stick: no speed hack through intents
  const k = Math.min(1, dt * 14);
  o.vx += (mx * SPEED - o.vx) * k;
  o.vy += (my * SPEED - o.vy) * k;
  const p = bound(o.x + o.vx * dt, o.y + o.vy * dt);
  o.x = p.x; o.y = p.y;
}
function stepKnocked(b: Body, dt: number): void { slide(b, net.now(), dt); }
const sight = new Map<number, { at: number; tx: number; ty: number; arrived?: boolean }>();
function stepBots(dt: number): void {
  const taken = new Set<number>();
  const now = net.now();
  for (const b of bodies.values()) {
    if (!b.bot) continue;
    if (b.knockUntil > now) { stepKnocked(b, dt); continue; }
    landed(b);
    if (lab.stage === 'dummy') { standStill(b, dt); continue; }
    const s: Skill = net.skillOf(b.slot); // Fair when nobody set a dial
    let eye = sight.get(b.slot);
    if (!eye || now - eye.at >= s.reactionMs) { // REACTION TIME
      const g = pickGem(b, taken, s); // POSITIONING
      const miss = 4 * s.aimNoise; // AIM NOISE: up to 4 m off at 1
      eye = { at: now, tx: g ? g.x + (Math.random() - 0.5) * miss : b.tx, ty: g ? g.y + (Math.random() - 0.5) * miss : b.ty };
      sight.set(b.slot, eye);
      if (g) taken.add(g.id);
    }
    b.tx = eye.tx; b.ty = eye.ty;
    const rival = nearestBody(b, T.knockRange); // AGGRESSION: waves at a rival in reach
    if (rival && round?.phase === 'live' && Math.random() < s.aggression * 0.8 * dt) hostWave(b);
    const dx = b.tx - b.x; const dy = b.ty - b.y; const dist = Math.hypot(dx, dy);
    const len = dist || 1;
    // Arrived where it aimed: it stands there, and notices what it missed only a reaction later.
    if (dist < 0.12 && !eye.arrived) { eye.arrived = true; eye.at = now; }
    const speed = dist < 0.12 ? 0 : BOT_SPEED;
    const k = Math.min(1, dt * 5);
    b.vx += ((dx / len) * speed - b.vx) * k;
    b.vy += ((dy / len) * speed - b.vy) * k;
    const p = bound(b.x + b.vx * dt, b.y + b.vy * dt);
    b.x = p.x; b.y = p.y;
  }
}
function pickGem(b: Body, taken: Set<number>, s: Skill): Gem | null {
  let best: Gem | null = null; let bd = Infinity;
  for (const g of gems) {
    if (taken.has(g.id)) continue;
    const hot = zone !== null && Math.hypot(g.x - zone.x, g.y - zone.y) < zone.r;
    const d = Math.hypot(g.x - b.x, g.y - b.y) * (hot ? 1.5 - s.positioning : 1);
    if (d < bd) { bd = d; best = g; }
  }
  return best;
}
function nearestBody(b: Body, range: number): Body | null {
  let best: Body | null = null; let bd = range;
  for (const o of bodies.values()) {
    if (o === b) continue;
    const d = Math.hypot(o.x - b.x, o.y - b.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
export function baseline(sets=5) {const totals=[];const original=Math.random;let seed=1977;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};try{
for(let set=0;set<sets;set++){let total=0;for(let r=0;r<20;r++){time=0;bodies.clear();sight.clear();
for(let i=0;i<3;i++)bodies.set(i,bodyFor({slot:i,seat:null,name:'Bot',bot:true}));gems=Array.from({length:14},newGem);zone=newZone(1);
for(let frame=0;frame<3600;frame++){time=frame*1000/60;if(time>=zone.until)zone=newZone(zone.n+1);stepBots(1/60);for(const b of bodies.values())for(let i=0;i<gems.length;i++){const g=gems[i];if(Math.hypot(g.x-b.x,g.y-b.y)<R_AV+R_GEM){const points=Math.hypot(g.x-zone.x,g.y-zone.y)<zone.r?2:1;total+=points;b.score+=points;gems[i]=newGem();}}}
}totals.push(total);}const b={x:R_AV,y:8,vx:0,vy:0};let frames=0;while(b.x<W-R_AV && frames<600){integrate(b,1,0,1/60);frames++;}return {totals,crossingSeconds:frames/60};}finally{Math.random=original;}}
