// Original Gem Rush simulation from the slice 3 base, at 60 frames/second.
// Kept for the conversion feel check; networking and drawing are replaced by inert callbacks.
const W=1600,H=1000,R_AV=22,R_GEM=13,SPEED=340,BOT_SPEED=250;
const T={hitStopMs:70,knockMs:420,knockRange:110,knockDistance:185,knockEase:4};
let time=0; const net={now:()=>time, skillOf:()=>({reactionMs:250,aimNoise:0.15,aggression:0.5,positioning:0.5}),send:()=>{},take:()=>{}};
const lab={stage:''}; const mySeat=()=>null; const me={}; const labKnock=()=>{},addWave=()=>{},q=(n)=>n;
function stepKnocked(b,dt){slide(b,time,dt);}
const standStill=()=>{}; const bodies=new Map(); let gems=[]; let zone=null; let round={phase:'live'};
function slide(o: Knock & { x: number; y: number; vx: number; vy: number }, now: number, dt: number): void {
  const u = Number.isFinite(o.kat) ? Math.max(0, Math.min(1, (now - o.kat) / Math.max(1, T.knockMs))) : 1;
  const e = 1 - (1 - u) ** Math.max(1, T.knockEase);
  const x = Math.max(R_AV, Math.min(W - R_AV, o.kx + o.kvx * T.knockDistance * e));
  const y = Math.max(R_AV, Math.min(H - R_AV, o.ky + o.kvy * T.knockDistance * e));
  if (u >= 1) { o.vx = 0; o.vy = 0; } else if (dt > 0) { o.vx = (x - o.x) / dt; o.vy = (y - o.y) / dt; }
  o.x = x; o.y = y;
}
/** The frame a bump is over: the body lands exactly where its slide ends, at rest (at 12 fps the last step is long). */
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
  o.x = Math.max(R_AV, Math.min(W - R_AV, o.x + o.vx * dt));
  o.y = Math.max(R_AV, Math.min(H - R_AV, o.y + o.vy * dt));
}

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
      const miss = 200 * s.aimNoise; // AIM NOISE: up to 200 px off at 1
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
    if (dist < 6 && !eye.arrived) { eye.arrived = true; eye.at = now; }
    const speed = dist < 6 ? 0 : BOT_SPEED;
    const k = Math.min(1, dt * 5);
    b.vx += ((dx / len) * speed - b.vx) * k;
    b.vy += ((dy / len) * speed - b.vy) * k;
    b.x = Math.max(R_AV, Math.min(W - R_AV, b.x + b.vx * dt));
    b.y = Math.max(R_AV, Math.min(H - R_AV, b.y + b.vy * dt));
  }
}

/** Positioning: 0 leaves the hot zone to the people, 1 fights for it. */
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

/** The nearest other body within `range` (a bot's rival), or null. */
function nearestBody(b: Body, range: number): Body | null {
  let best: Body | null = null; let bd = range;
  for (const o of bodies.values()) {
    if (o === b) continue;
    const d = Math.hypot(o.x - b.x, o.y - b.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function hostWave(from: Body): void {
  addWave({ slot: from.slot }); net.send('wave', { slot: from.slot });
  for (const b of bodies.values()) {
    if (b === from || Math.hypot(b.x - from.x, b.y - from.y) > T.knockRange) continue;
    knock(b, from.x, from.y, from.slot);
  }
}
/**
 * Host: knock a body back. The hit LANDS first: for T.hitStopMs the body holds where it was hit (it flashes, squashes
 * and shakes on every screen), then it SLIDES T.knockDistance along the hit, fast at first and easing into the stop
 * (T.knockEase), so it arrives at rest, the same distance at any frame rate, and its owner steers again with no pop.
 * A replica's body is TAKEN for the whole bump (its owner's avatar frames are ignored; the host drives it; the owner
 * draws its body from snapshots), then the helper GIVES it back with a reset, so the owner stands where it ended.
 */
function knock(b: Body, fx: number, fy: number, by: number): void {
  let dx = b.x - fx; let dy = b.y - fy;
  const len = Math.hypot(dx, dy);
  if (len < 1) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); } else { dx /= len; dy /= len; }
  const at = net.now() + T.hitStopMs;
  const o: Knock & { x: number; y: number } = !b.bot && b.seat !== null && b.seat === mySeat() ? me : b;
  o.kvx = dx; o.kvy = dy; o.kx = o.x; o.ky = o.y; o.kat = at; o.knockUntil = at + T.knockMs;
  if (o === b && !b.bot && b.seat !== null) net.take(b.seat, T.hitStopMs + T.knockMs);
  labKnock(b);
  const d = { slot: b.slot, dx: q(dx, 2), dy: q(dy, 2), by };
  addWave(d, true); net.send('knock', d);
}


export function baseline(sets=5) {
 const totals=[];
 for(let set=0;set<sets;set++) {
  let total=0;
  for(let r=0;r<20;r++) {
   time=0; bodies.clear(); sight.clear();
   for(let i=0;i<3;i++) {const a=i/8*Math.PI*2; bodies.set(i,{slot:i,seat:null,bot:true,x:800+Math.cos(a)*330,y:500+Math.sin(a)*250,vx:0,vy:0,tx:800,ty:500,kat:0,knockUntil:0});}
   const gem=()=>({id:Math.random(),x:60+Math.random()*1480,y:60+Math.random()*880});
   gems=Array.from({length:14},gem);
   const zoneNew=()=>({x:220+Math.random()*1160,y:200+Math.random()*600,r:150}); zone=zoneNew();
   for(let frame=0;frame<3600;frame++) {
    time=frame*1000/60; if(frame && frame%720===0) zone=zoneNew(); stepBots(1/60);
    for(const b of bodies.values()) for(let i=0;i<gems.length;i++) {const g=gems[i];if(Math.hypot(g.x-b.x,g.y-b.y)<35){total+=Math.hypot(g.x-zone.x,g.y-zone.y)<150?2:1;gems[i]=gem();}}
   }
  }
  totals.push(total);
 }
 const body={x:22,y:500,vx:0,vy:0}; let frames=0; while(body.x<1578){integrate(body,1,0,1/60);frames++;}
 return {totals,crossingSeconds:frames/60};
}
