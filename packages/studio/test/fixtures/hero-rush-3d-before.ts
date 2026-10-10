// Original hero-rush-3d simulation at 60 frames/s, extracted unchanged from the slice 6 starter.
// Only networking, rendering and Lab callbacks are inert. Used for migration feel comparisons.
const T={"windupMs":240,"swingSkip":0.15,"swingRestMs":260,"knockRange":2.1,"swingArc":200,"hitStopMs":70,"knockDistance":3.4,"knockMs":420,"knockEase":4,"squash":0.3,"settleMs":260,"flashMs":110,"shake":0.16,"sparks":9,"ringMs":520,"jumpHeight":1.05,"jumpRise":0.3,"fallFaster":2.1,"fade":0.14,"walkSpeed":1.7,"runSpeed":4.6,"runFrom":2.6,"actSpeed":1.9,"jumpStretch":0.22,"landSquash":0.28,"squashHz":5.5,"lean":0.22,"flinch":0.6,"lookAt":0.7,"spring":0.5};let time=0;const fair={level:3,reactionMs:250,aimNoise:.15,aggression:.5,positioning:.5};
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
const R_GEM = 0.3;
const SPEED = 6.2;
const BOT_SPEED = 4.2;
const CLEAR_M = 0.3;
const MAX_SLOTS = 8;
const jumpGravity = (): number => (2 * T.jumpHeight) / Math.max(0.05, T.jumpRise) ** 2;
const jumpSpeed = (): number => jumpGravity() * Math.max(0.05, T.jumpRise);
function fall(o: { h: number; vh: number }, dt: number): boolean {
  if (o.h <= 0 && o.vh <= 0) { o.h = 0; o.vh = 0; return false; }
  const g = jumpGravity() * (o.vh < 0 ? T.fallFaster : 1);
  o.vh -= g * dt; o.h += o.vh * dt;
  if (o.h <= 0) { o.h = 0; o.vh = 0; return true; } // landed this step
  return false;
}
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
  return { slot: slot.slot, seat: slot.seat, name: slot.name, bot: slot.bot, x: sp.x, y: sp.y, vx: 0, vy: 0, h: 0, vh: 0, fa: 0, score: 0, tx: sp.x, ty: sp.y, kvx: 0, kvy: 0, kx: sp.x, ky: sp.y, kat: 0, knockUntil: 0 };
}
function newZone(n: number): Zone {
  return { n, x: rnd(4.4, W - 4.4), y: rnd(4, H - 4), r: 3, until: net.now() + ZONE_MS };
}
const swings: { slot: number; at: number }[] = [];
const swingReady = new Map<number, number>();
function startSwing(from: Body): void {
  const now = net.now();
  if ((swingReady.get(from.slot) ?? 0) > now || from.knockUntil > now) return;
  swingReady.set(from.slot, now + T.windupMs + T.swingRestMs);
  const d = { slot: from.slot, fa: q(from.fa, 2) };
  addWave(d); net.send('swing', d);
  swings.push({ slot: from.slot, at: now + T.windupMs });
  botsSee(from);
}
function landSwings(): void {
  const now = net.now();
  for (let i = swings.length - 1; i >= 0; i -= 1) {
    const s = swings[i] as (typeof swings)[number];
    if (now < s.at) continue;
    swings.splice(i, 1);
    const from = bodies.get(s.slot);
    if (!from || from.knockUntil > now) continue;
    const half = (T.swingArc * Math.PI) / 360;
    for (const b of bodies.values()) {
      if (b === from) continue;
      const dx = b.x - from.x; const dy = b.y - from.y; const d = Math.hypot(dx, dy);
      if (d > T.knockRange) continue;
      let off = Math.atan2(dx, dy) - from.fa; off = Math.atan2(Math.sin(off), Math.cos(off));
      if (d > R_AV * 1.5 && Math.abs(off) > half) continue;
      const h = !b.bot && b.seat !== null && b.seat === mySeat() ? me.h : b.h;
      if (h >= CLEAR_M) { dodged(b.slot); net.send('dodge', { slot: b.slot }); continue; }
      knock(b, from.x, from.y, from.slot);
    }
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
function faceOf(o: { vx: number; vy: number; fa: number; knockUntil: number }, now: number): void {
  if (o.knockUntil > now) return;
  if (Math.hypot(o.vx, o.vy) > 0.6) o.fa = Math.atan2(o.vx, o.vy);
}
function stepKnocked(b: Body, dt: number): void { slide(b, net.now(), dt); }
const sight = new Map<number, { at: number; tx: number; ty: number; arrived?: boolean; near?: number }>();
const LEAD = [-1, 1, 2, 5, Infinity] as const;
const LEAD_BAND = 2;
let firstRound = new Map<number, number>();
const botPlay = new Map<number, { level: number; soft: number }>();
function people(): Body[] {
  return [...bodies.values()].filter((b) => !b.bot && b.seat !== null && !b.name.endsWith(AI_MARK) && !roster.slots.find((x) => x.slot === b.slot)?.agent);
}
function newcomerRound(folk: Body[]): boolean {
  return Boolean(round) && folk.some((b) => (firstRound.get(b.seat as number) ?? 0) >= (round as RoundInfo).n);
}
function dialOf(slot: number, easy: boolean): Skill {
  const s: Skill = net.skillOf(slot); // Fair when nobody set a dial
  return easy && !net.policy.by && s.level > 1 ? skillPreset(s.level - 1, net.policy.kids) : s;
}
function softness(b: Body, s: Skill, best: number | null): number {
  const allowed = LEAD[Math.max(1, Math.min(5, s.level)) - 1] as number;
  if (best === null || !Number.isFinite(allowed)) return 0;
  return Math.max(0, Math.min(1, (b.score - best - allowed) / LEAD_BAND));
}
function nearestOf(list: Body[], b: Body): Body | null {
  let best: Body | null = null; let bd = Infinity;
  for (const o of list) { const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < bd) { bd = d; best = o; } }
  return best;
}
function beside(b: Body, p: Body): { x: number; y: number } {
  const clear = R_AV + R_GEM + 0.15;
  let spot = { x: b.x, y: b.y };
  for (let i = 0; i < 6; i += 1) {
    let a = Math.atan2(Math.min(b.y - p.y, -0.6), b.x - p.x) + (Math.random() - 0.5) * (1.2 + i * 0.5);
    a = Math.max(-Math.PI + 0.7, Math.min(-0.7, a));
    const r = 2.2 + Math.random() * 0.8;
    spot = bound(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
    const dx = spot.x - b.x; const dy = spot.y - b.y; const len2 = dx * dx + dy * dy || 1;
    // The nearest point of the walk to each coin: none closer than a pickup.
    if (!gems.some((g) => { const u = Math.max(0, Math.min(1, ((g.x - b.x) * dx + (g.y - b.y) * dy) / len2)); return Math.hypot(b.x + dx * u - g.x, b.y + dy * u - g.y) < clear; })) break;
  }
  return spot;
}
function stepBots(dt: number): void {
  const taken = new Set<number>();
  const now = net.now();
  const folk = people();
  const best = folk.length ? Math.max(...folk.map((p) => p.score)) : null;
  const easy = newcomerRound(folk);
  for (const b of bodies.values()) {
    if (!b.bot) continue;
    fall(b, dt);
    const leap = dodgeAt.get(b.slot);
    if (leap !== undefined && now >= leap) { dodgeAt.delete(b.slot); if (b.h <= 0 && b.knockUntil <= now) { b.vh = jumpSpeed(); b.h = 1e-3; jumped(b.slot); net.send('jump', { slot: b.slot }); } }
    if (b.knockUntil > now) { stepKnocked(b, dt); continue; }
    landed(b);
    if (lab.stage === 'dummy' || lab.stage === 'jump') { standStill(b, dt); continue; }
    const s = dialOf(b.slot, easy);
    const soft = softness(b, s, best); // THE RUBBER BAND
    botPlay.set(b.slot, { level: s.level, soft });
    let eye = sight.get(b.slot);
    // REACTION TIME: later when soft (it notices coins late); all the way soft it only keeps up with its person.
    if (!eye || now - eye.at >= s.reactionMs * (soft >= 1 ? 1 : 1 + 2.5 * soft)) {
      const near = soft > 0 ? nearestOf(folk, b) : null;
      let g: Gem | null = null;
      let tx = b.tx; let ty = b.ty;
      if (near && soft >= 1) { const at = beside(b, near); tx = at.x; ty = at.y; } // all the way soft: no coin, near them
      else {
        g = pickGem(b, taken, s, near, soft); // POSITIONING (soft: the coins near the nearest person)
        const miss = 4 * s.aimNoise; // AIM NOISE: up to 4 m off at 1
        if (g) { tx = g.x + (Math.random() - 0.5) * miss; ty = g.y + (Math.random() - 0.5) * miss; }
      }
      eye = { at: now, tx, ty, ...(near && soft >= 1 ? { near: near.slot } : {}) };
      sight.set(b.slot, eye);
      if (g) taken.add(g.id);
    }
    b.tx = eye.tx; b.ty = eye.ty;
    const rival = nearestBody(b, T.knockRange * 0.9); // AGGRESSION: swings at a rival in reach, turning to it (less when soft)
    if (rival && round?.phase === 'live' && Math.random() < s.aggression * (1 - 0.75 * soft) * 0.8 * dt) { b.fa = Math.atan2(rival.x - b.x, rival.y - b.y); startSwing(b); }
    const dx = b.tx - b.x; const dy = b.ty - b.y; const dist = Math.hypot(dx, dy);
    const len = dist || 1;
    // Arrived where it aimed: it stands there, and notices what it missed only a reaction later.
    if (dist < 0.12 && !eye.arrived) { eye.arrived = true; eye.at = now; }
    // Soft: down to a walk; all the way soft it jogs back to its person when they have run off (a rival in view).
    const kept = eye.near !== undefined ? bodies.get(eye.near) : undefined;
    const far = kept ? Math.hypot(kept.x - b.x, kept.y - b.y) > 3.5 : false;
    const speed = dist < 0.12 ? 0 : BOT_SPEED * (far ? 1 : 1 - 0.5 * soft);
    const k = Math.min(1, dt * 5);
    b.vx += ((dx / len) * speed - b.vx) * k;
    b.vy += ((dy / len) * speed - b.vy) * k;
    // All the way soft it steps round a coin in its way (turning a little, or a lot, or it waits): it leaves them to
    // the people. It still takes one it is knocked onto, or one that lands under it: the rules' pickups are anyone's.
    if (kept) sidestep(b, dt);
    const p = bound(b.x + b.vx * dt, b.y + b.vy * dt);
    b.x = p.x; b.y = p.y;
    faceOf(b, now);
  }
}
function sidestep(b: Body, dt: number): void {
  const reach = R_AV + R_GEM + 0.06;
  const look = Math.max(0.25, Math.hypot(b.vx, b.vy) * dt * 4); // a few frames ahead
  const touches = (vx: number, vy: number): boolean => {
    const sp = Math.hypot(vx, vy) || 1; const x = b.x + (vx / sp) * look; const y = b.y + (vy / sp) * look;
    return gems.some((g) => Math.hypot(g.x - x, g.y - y) < reach && Math.hypot(g.x - x, g.y - y) < Math.hypot(g.x - b.x, g.y - b.y));
  };
  if (Math.hypot(b.vx, b.vy) < 0.05 || !touches(b.vx, b.vy)) return;
  for (const a of [1.05, -1.05, 2.1, -2.1]) {
    const c = Math.cos(a); const sn = Math.sin(a);
    const vx = b.vx * c - b.vy * sn; const vy = b.vx * sn + b.vy * c;
    if (!touches(vx, vy)) { b.vx = vx; b.vy = vy; return; }
  }
  b.vx = 0; b.vy = 0;
}
const dodgeAt = new Map<number, number>();
function botsSee(from: Body): void {
  const easy = newcomerRound(people());
  for (const b of bodies.values()) {
    if (!b.bot || b === from || lab.stage === 'dummy' || lab.stage === 'jump') continue;
    if (Math.hypot(b.x - from.x, b.y - from.y) > T.knockRange + 0.6) continue;
    const s = dialOf(b.slot, easy);
    const soft = botPlay.get(b.slot)?.soft ?? 0;
    if (Math.random() < (0.15 + 0.6 * (1 - s.aimNoise)) * (1 - 0.5 * soft)) dodgeAt.set(b.slot, net.now() + Math.max(40, s.reactionMs * 0.5 - 60));
  }
}
function pickGem(b: Body, taken: Set<number>, s: Skill, near: Body | null = null, pull = 0): Gem | null {
  let best: Gem | null = null; let bd = Infinity;
  for (const g of gems) {
    if (taken.has(g.id)) continue;
    const hot = zone !== null && Math.hypot(g.x - zone.x, g.y - zone.y) < zone.r;
    const d = Math.hypot(g.x - b.x, g.y - b.y) * (hot ? 1.5 - s.positioning : 1) + (near ? 2 * pull * Math.hypot(g.x - near.x, g.y - near.y) : 0);
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
for(let set=0;set<sets;set++){let total=0;for(let r=0;r<20;r++){time=0;bodies.clear();sight.clear();swings.length=0;swingReady.clear();dodgeAt.clear();firstRound.clear();botPlay.clear();
for(let i=0;i<3;i++)bodies.set(i,bodyFor({slot:i,seat:null,name:'Bot',bot:true}));gems=Array.from({length:14},newGem);zone=newZone(1);
for(let frame=0;frame<3600;frame++){time=frame*1000/60;if(time>=zone.until)zone=newZone(zone.n+1);stepBots(1/60);landSwings();for(const b of bodies.values())for(let i=0;i<gems.length;i++){const g=gems[i];if(Math.hypot(g.x-b.x,g.y-b.y)<R_AV+R_GEM){const points=Math.hypot(g.x-zone.x,g.y-zone.y)<zone.r?2:1;total+=points;b.score+=points;gems[i]=newGem();}}}
}totals.push(total);}const b={x:R_AV,y:8,vx:0,vy:0};let frames=0;while(b.x<W-R_AV && frames<600){integrate(b,1,0,1/60);frames++;}return {totals,crossingSeconds:frames/60};}finally{Math.random=original;}}
