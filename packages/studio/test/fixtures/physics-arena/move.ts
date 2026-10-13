import {defineMove} from '@homie-rocks/studio/rules';
export const move = defineMove({runner(b,i,c) {
  c.substeps(b,300,s=>{
    if(s.first && i.jump && b.grounded) b.vel={x:b.vel.x,y:b.vel.y,z:10};
    b.vel={x:i.ax*5,y:i.ay*5,z:b.vel.z-30*s.dt};
    c.physics.sweep(b,{x:b.vel.x*s.dt,y:b.vel.y*s.dt,z:b.vel.z*s.dt},.35,1.35);
  });
}});
