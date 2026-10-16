// Original analytic elevation data. No imagery, survey data or tile provider.
import sharp from 'sharp';
import {createNoise2D} from 'simplex-noise';
let seed=161;const noise=createNoise2D(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;});
const size=512,bytes=new Uint8Array(size*size);
const gauss=(x,z,cx,cz,sx,sz)=>Math.exp(-(((x-cx)/sx)**2+((z-cz)/sz)**2));
for(let j=0;j<size;j++)for(let i=0;i<size;i++){
 const x=i/(size-1)*100,z=j/(size-1)*100;
 const dx=(x-50)/45,dz=(z-52)/48,a=Math.atan2(dz,dx);
 const coast=Math.max(0,1-Math.hypot(dx,dz)/(1+.12*Math.sin(a*3)+.07*Math.sin(a*7)));
 const base=coast*9;
 const ridge=25*gauss(x,z,46,45,15,21)+20*gauss(x,z,65,30,14,13)+9*gauss(x,z,33,62,13,17);
 const detail=1+.13*noise(x*.09,z*.09)+.045*noise(x*.22,z*.22)+.012*noise(x*.55,z*.55);
 const h=Math.min(42,Math.max(0,base+ridge*detail)*Math.min(1,coast*8));
 bytes[j*size+i]=Math.round(h/42*255);
}
await sharp(bytes,{raw:{width:size,height:size,channels:1}}).png().toFile('packages/studio/parts/terrain-route-map/preview/heightmap.png');
