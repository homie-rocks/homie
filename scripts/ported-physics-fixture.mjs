/** Shared preliminary probe; callers initialize the package's engine first. */
import { createWorld } from '@homie-rocks/physics/World.js';

export async function physicsFixture(mesh) {
  const options={up:'z',fixedDt:1/300,maxSubsteps:15,bounds:null};
  const world=createWorld(options);
  let restored;
  const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  try {
    world.createBody({type:'static',colliders:[{shape:{kind:'mesh',vertices:Float32Array.from(mesh.vertices),indices:Uint32Array.from(mesh.indices)}}]});
    const characters=Array.from({length:8},(_,i)=>world.createCharacter({
      position:{x:-8+i*2,y:0,z:8},radius:.35,height:1.35,stepHeight:0,
      stepMinWidth:.2,snapDistance:0,gravity:30,slopeLimit:1.4,offset:.001,jumpSpeed:10,
    }));
    const hashes=[];
    for(let tick=0;tick<200;tick++) {
      const input={x:tick%100<50?1:-1,y:0};
      for(const id of characters)world.controlCharacter(id,input);
      world.step(.05);
      const snapshot=world.snapshot();
      hashes.push(await hash(snapshot));
      if(restored) {
        for(const id of characters)restored.controlCharacter(id,input);
        restored.step(.05);
        const copy=restored.snapshot();
        if(copy.length!==snapshot.length || copy.some((n,i)=>n!==snapshot[i]))throw new Error(`restore differs at tick ${tick}`);
      }
      if(tick===3) {
        if(!characters.every(id=>world.characterState(id).verticalVelocity<0&&!world.characterState(id).grounded))throw new Error('checkpoint is not mid-fall');
        restored=createWorld(options);restored.restore(snapshot);
      }
    }
    return {hashes,snapshotBytes:world.snapshot().byteLength,positions:characters.map(id=>world.bodyState(world.characterState(id).body).position)};
  } finally {restored?.dispose();world.dispose();}
}
