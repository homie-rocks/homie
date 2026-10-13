import {defineRules,f} from '@homie-rocks/studio/rules';
import {move} from './move';
export default defineRules({contract:2,space:{dims:3},move,
  entities:{runner:{player:true,tick(w,s){if(s.seat===0)w.physics.step(w.dt);},input:{ax:f.held(),ay:f.held(),jump:f.press()},body:{shape:'capsule',radius:.35,height:1.35,maxSpeed:30}}},
  room:{bots:{keep:0},join(c,p){return{kind:'runner',at:{x:-8+p.seat*2,y:0,z:8}};}}
});
