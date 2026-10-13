/** Seeded virtual ticks, shared verbatim by Node, Chrome and workerd. */
export async function physicsRulesFixture(L, mesh) {
  const map=L.R.compileMap({bounds:{min:[-100,-100,-100],max:[100,100,100]},physics:mesh});
  const compiled=L.R.compileRules(L.def,{map,seats:8});
  const a=L.C.createCore(compiled,{seed:480}),hashes=[];
  let b=null,midFall=false,seed=480;
  for(let seat=0;seat<8;seat++)a.seatJoin({seat,driver:'person',owner:'player'+seat});
  const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),v=>v.toString(16).padStart(2,'0')).join('');
  for(let tick=0;tick<220;tick++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const inputs=new Map(Array.from({length:8},(_,seat)=>[seat,{values:{ax:tick<150?((seed>>>seat)&1)*2-1:0,ay:0,jump:tick%43===0}}]));
    a.step(inputs);const saved=a.save();
    if(b){b.step(inputs);if(JSON.stringify(b.save())!==JSON.stringify(saved))throw Error('physics restore diverged at '+tick);}
    if(tick===3){midFall=saved.ents.every(e=>e[8][2]<0&&!e[10]);if(!midFall)throw Error('checkpoint is not mid-fall');b=L.C.createCore(compiled,{restore:JSON.parse(JSON.stringify(saved))});}
    hashes.push(await hash(saved));
  }
  if(a.stats.errors||a.stats.budgetStops||a.stats.ticksCut)throw Error(JSON.stringify(a.stats));
  a.dispose(); b?.dispose();
  return {hashes,midFall,restoredTicks:216,stats:a.stats,triangles:mesh.indices.length/3};
}
