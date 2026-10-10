// Original Ember Vale simulation from slice 6 at 60 frames/s. Networking, AI (floor chase), rendering and Lab callbacks are inert.
const T={"strikeRange":96,"strikeMs":380,"flashMs":200,"swingMs":150,"hitStopMs":60,"slimePush":14,"lunge":14,"pushMs":220,"wobble":0.3,"wobbleMs":420,"shake":4};let time=0;const fair={level:3,reactionMs:250,aimNoise:.15,aggression:.5,positioning:.5};
const net={now:()=>time,state:()=>{}};const lab={stage:'',on:false};const room={bodies:new Map(),round:{phase:'live'},mySeat:()=>null,skillOf:()=>fair,moved:()=>{},update:()=>{},send:()=>{}};
const director={tactic:'chase',pressure:2,waveLeft:0};const stepDirector=()=>{},openQuests=()=>[],tell=()=>{};const jitter=(s,n)=>(Math.random()-.5)*2*n*s.aimNoise,standoff=(s,near,far)=>far+(near-far)*s.positioning;
const W = 1600;
const H = 1000;
const R = 22;
const SPEED = 300;
const DOWN_MS = 4000;
const DOWN = 1;
const STRIKING = 2;
const SPREAD = [0, 4, 2, 6, 1, 5, 3, 7];
const maxHpOf = (level: number): number => 60 + level * 12;
const damageOf = (level: number): number => 10 + level * 3;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
let slimes: Slime[] = [];
let slimeSeq = 0;
let spawnAt = 0;
let kingAt = 0;
let kingSlainAt = 0;
function strike(b: Body, now: number): void {
  b.atkAt = now; b.strikeAt = now;
  const hits: Slime[] = [];
  for (const s of slimes) {
    if (s.hp <= 0 || Math.hypot(s.x - b.x, s.y - b.y) > T.strikeRange + s.size * 10) continue;
    s.hp -= damageOf(b.level);
    s.lastHit = b.slot;
    // The hit lands, then pushes: the slime holds for the hit-stop, then eases back along the strike.
    const d = Math.hypot(s.x - b.x, s.y - b.y) || 1;
    s.kx = s.x; s.ky = s.y; s.kdx = (s.x - b.x) / d; s.kdy = (s.y - b.y) / d; s.kat = now + T.hitStopMs;
    hits.push(s);
    if (s.hp <= 0) {
      const xp = s.size === 3 ? 60 : 6 * s.size;
      const gold = s.size === 3 ? 50 : 2 + Math.floor(Math.random() * 4) * s.size;
      b.score += xp;
      if (s.size === 3) kingSlainAt = now;
      tell(b, 'loot', { xp, gold });
      // Everyone hears who slew it (a watcher on Auto cuts to them); the loot itself is the slayer's alone.
      if (!b.bot && b.seat !== null) room.send('slain', { seat: b.seat });
    }
  }
  if (lab.on && b.seat !== null && b.seat === room.mySeat()) labStrike(b, now, hits);
  slimes = slimes.filter((s) => s.hp > 0);
}
function down(b: Body, now: number, cause: string): void {
  b.flags = DOWN; b.hp = 0; b.downUntil = now + DOWN_MS;
  tell(b, 'down', { cause });
}
function stepHost(dt: number): void {
  const now = net.now();
  const live = room.round?.phase === 'live';
  const myS = room.mySeat();
  for (const b of room.bodies.values()) {
    if (b.flags & DOWN) {
      if (now >= b.downUntil) { b.flags = 0; b.hp = b.maxHp; b.x = W / 2 + (Math.random() - 0.5) * 300; b.y = H / 2 + (Math.random() - 0.5) * 200; room.moved(b); }
      continue;
    }
    let wants = false;
    const guide = b.bot && b.agent?.role === 'guide' ? agents.goalOf(b.slot) : null;
    if (guide) wants = stepGuide(b, guide, room.skillOf(b), dt, now);
    else if (b.bot && lab.stage === 'dummy') wants = false; // the lab's training stage: bots stand by
    else if (b.bot) {
      // Bots are company, not carries: they hunt only what is near them, and strike slower than a person. At the
      // room's dial (section 17): they notice a slime `reactionMs` late, hunt farther afield the more they lean to
      // the front (positioning), aim a little off (aimNoise), and strike sooner the more aggressive they are.
      const s = room.skillOf(b);
      const near = nearestSlime(b.x, b.y);
      const reach = standoff(s, 460, 220);
      if (!b.seenAt || now - b.seenAt >= s.reactionMs) {
        b.seenAt = now;
        const t0 = near && Math.hypot(near.x - b.x, near.y - b.y) < reach ? near : null;
        b.ax = t0 ? t0.x + jitter(s, 40) : undefined; b.ay = t0 ? t0.y + jitter(s, 40) : undefined;
      }
      const t = b.ax !== undefined && b.ay !== undefined ? { x: b.ax, y: b.ay } : null;
      const tx = t ? t.x : b.tx; const ty = t ? t.y : b.ty;
      if (!t && Math.hypot(b.tx - b.x, b.ty - b.y) < 30) { b.tx = 200 + Math.random() * (W - 400); b.ty = 150 + Math.random() * (H - 300); }
      const dx = tx - b.x; const dy = ty - b.y; const dist = Math.hypot(dx, dy) || 1;
      if (dist > 60) { b.x += (dx / dist) * SPEED * 0.75 * dt; b.y += (dy / dist) * SPEED * 0.75 * dt; b.face = Math.atan2(dy, dx); }
      wants = Boolean(t && dist < T.strikeRange && now - b.atkAt > 1400 - 900 * s.aggression);
    } else if (b.seat === myS) {
      b.x = me.x; b.y = me.y; b.face = me.face; b.level = myLevel(); b.maxHp = maxHpOf(b.level);
      wants = me.strikes > 0; me.strikes = 0;
    } else {
      const a = room.avatar(b);
      if (a) {
        room.bound(b, { x: Number(a[0]), y: Number(a[1]) }, SPEED, dt);
        b.face = Number(a[2]) || 0;
        // The hero's level comes from its own browser (it owns the save). A game with stakes would check it.
        b.level = clamp(Math.floor(Number(a[3]) || 1), 1, 99); b.maxHp = maxHpOf(b.level);
      }
      wants = Boolean(room.presses(b)['strike']);
    }
    b.hp = Math.min(b.hp, b.maxHp);
    b.flags = now - b.strikeAt < T.flashMs ? STRIKING : 0;
    if (wants && live && now - b.atkAt > T.strikeMs) strike(b, now);
  }
  if (live) { stepDirector(now); stepSlimes(dt, now); }
  // Every browser's ask buttons offer the quests open now (slow keyed state: sent only when it changes).
  net.state('quests', openQuests());
  room.update();
}
const SPAWN_MS = [1900, 1450, 1100, 850, 700];
function nearestSlime(x: number, y: number): Slime | null {
  let best: Slime | null = null; let bd = Infinity;
  for (const s of slimes) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } }
  return best;
}
function pushed(s: Slime, now: number): boolean {
  if (s.kat === undefined || s.kx === undefined || s.ky === undefined) return false;
  if (now < s.kat) return true;
  const u = Math.min(1, (now - s.kat) / Math.max(1, T.pushMs));
  const e = 1 - (1 - u) ** 3;
  s.x = clamp(s.kx + (s.kdx ?? 0) * T.slimePush * e, 20, W - 20); s.y = clamp(s.ky + (s.kdy ?? 0) * T.slimePush * e, 20, H - 20);
  // The push ends exactly where it should, at any frame rate; then the slime chases again.
  if (u >= 1) { delete s.kat; return false; }
  return true;
}
function stepSlimes(dt: number, now: number): void {
  const struck = new Set(slimes.filter((s) => pushed(s, now)).map((s) => s.id));
  if (lab.stage === 'dummy') return; // the lab's training slime stands still and never bites
  const bodies = [...room.bodies.values()].filter((b) => !(b.flags & DOWN));
  const people = bodies.filter((b) => !b.bot).length;
  // The director's pressure (0 a breather .. 4 fierce; 2 is how the vale always played) sets how fast and how many.
  const cap = Math.max(4, 6 + people * 2 + (director.pressure - 2) * 2) + (director.waveLeft > 0 ? 3 : 0);
  if ((now >= spawnAt || director.waveLeft > 0) && slimes.length < cap) {
    spawnAt = now + SPAWN_MS[director.pressure]!;
    if (director.waveLeft > 0) director.waveLeft -= 1;
    const edge = Math.floor(Math.random() * 4);
    const x = edge === 0 ? 30 : edge === 1 ? W - 30 : Math.random() * W;
    const y = edge === 2 ? 30 : edge === 3 ? H - 30 : Math.random() * H;
    const size = Math.random() < 0.25 ? 2 : 1;
    slimes.push({ id: ++slimeSeq, x, y, hp: 18 * size, maxHp: 18 * size, size, hitAt: 0, lastHit: -1 });
  }
  if (now >= kingAt && !slimes.some((s) => s.size === 3)) {
    kingAt = now + 60_000;
    slimes.push({ id: ++slimeSeq, x: W / 2, y: 40, hp: 160, maxHp: 160, size: 3, hitAt: 0, lastHit: -1 });
    room.send('king', {});
  }
  // Slimes hunt heroes: the nearest person, and a bot only when no person is up.
  const prey = bodies.some((b) => !b.bot) ? bodies.filter((b) => !b.bot) : bodies;
  for (const s of slimes) {
    if (struck.has(s.id)) continue;
    let target: Body | null = null; let bd = Infinity;
    for (const b of prey) { const d = Math.hypot(b.x - s.x, b.y - s.y); if (d < bd) { bd = d; target = b; } }
    // The director's tactic (section 20; chase is how the vale always played): the most hurt hero, a ring round the
    // nearest, or back to the King to gather (a hero close by is still bitten).
    if (director.tactic === 'weakest' && prey.length > 1) target = prey.reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a));
    const speed = s.size === 3 ? 70 : 95 - s.size * 10;
    if (target) {
      let gx = target.x; let gy = target.y;
      const king = slimes.find((o) => o.size === 3);
      if (director.tactic === 'surround' && bd > 90) { const a = s.id * 2.39996; gx += Math.cos(a) * 80; gy += Math.sin(a) * 80; }
      if (director.tactic === 'regroup' && king && s !== king && bd > 140) { gx = king.x + Math.cos(s.id) * 70; gy = king.y + Math.sin(s.id) * 70; }
      const dx = gx - s.x; const dy = gy - s.y; const dist = Math.hypot(target.x - s.x, target.y - s.y) || 1;
      const step = Math.hypot(dx, dy) || 1;
      if (step > 4) { s.x += (dx / step) * speed * dt; s.y += (dy / step) * speed * dt; }
      if (dist < R + 10 + s.size * 10 && now - s.hitAt > 800) {
        s.hitAt = now;
        target.hp -= 5 * s.size + (s.size === 3 ? 10 : 0);
        if (target.hp <= 0) down(target, now, s.size === 3 ? 'the King Slime' : s.size === 2 ? 'a big slime' : 'a slime');
      }
    } else { s.x += Math.sin(now / 900 + s.id) * 20 * dt; s.y += Math.cos(now / 1100 + s.id) * 20 * dt; }
    s.x = clamp(s.x, 20, W - 20); s.y = clamp(s.y, 20, H - 20);
  }
}
export function baseline(sets=5){const totals=[];const original=Math.random;let seed=1977;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};try{for(let set=0;set<sets;set++){let total=0;for(let r=0;r<20;r++){time=0;room.bodies.clear();slimes=[];spawnAt=0;kingAt=45000;
for(let i=0;i<3;i++){const a=SPREAD[i]/SPREAD.length*Math.PI*2,level=1+i%4,x=W/2+Math.cos(a)*160,y=H/2+Math.sin(a)*120;room.bodies.set(i,{slot:i,seat:null,bot:true,score:0,x,y,hp:maxHpOf(level),maxHp:maxHpOf(level),level,face:a,flags:0,downUntil:0,atkAt:0,strikeAt:0,tx:x,ty:y});}
for(let frame=0;frame<5400;frame++){time=frame*1000/60;stepHost(1/60);}total+=[...room.bodies.values()].reduce((sum,b)=>sum+b.score,0);}totals.push(total);}return {totals,crossingSeconds:(W-2*R)/SPEED};}finally{Math.random=original;}}
