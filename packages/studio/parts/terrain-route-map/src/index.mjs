import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {validateMap, heightSampler} from './data.mjs';
/** Owns only its canvas, controls and GPU resources. Call dispose when leaving the view. */
export async function mountTerrainMap(root, input, {segments=80, pixelRatio=1.5}={}) {
  const data=validateMap(input);
  if (!Number.isInteger(segments)||segments<8||segments>128||!Number.isFinite(pixelRatio)||pixelRatio<.5||pixelRatio>2) throw new Error('Invalid rendering budget');
  const spanBudget=Math.max(data.bounds[2]-data.bounds[0],data.bounds[3]-data.bounds[1]);
  const estimatedPoints=data.route.coordinates.slice(1).reduce((sum,b,i)=>{const a=data.route.coordinates[i];return sum+Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/(spanBudget/segments/2)));},1);
  if(estimatedPoints>8192) throw new Error('Route exceeds rendering budget');
  const image = new Image(); image.crossOrigin='anonymous'; image.src=data.heightmap;
  await image.decode();
  if(image.width>2048||image.height>2048) throw new Error('Heightmap exceeds 2048 pixels');
  const sampling=document.createElement('canvas'); sampling.width=image.width; sampling.height=image.height;
  const context=sampling.getContext('2d',{willReadFrequently:true}); context.drawImage(image,0,0);
  const sample=heightSampler(context.getImageData(0,0,image.width,image.height),data.bounds,data.height);
  const [x0,z0,x1,z1]=data.bounds, width=x1-x0, depth=z1-z0, span=Math.max(width,depth);
  const scene=new THREE.Scene(); scene.background=new THREE.Color('#102d39');
  const camera=new THREE.PerspectiveCamera(40,1,span/1000,span*12);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false}); renderer.setPixelRatio(Math.min(devicePixelRatio,pixelRatio));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  const canvas=renderer.domElement; canvas.tabIndex=0; canvas.setAttribute('role','img'); canvas.setAttribute('aria-label','Terrain map. Drag to orbit, pinch to zoom. Arrow keys rotate, plus and minus zoom, Home resets.');
  root.classList.add('terrain-map'); root.append(canvas);
  const controls=new OrbitControls(camera,canvas); controls.enableDamping=false; controls.enablePan=false; controls.minDistance=span*.3; controls.maxDistance=span*3; controls.maxPolarAngle=Math.PI*.46;
  controls.target.set((x0+x1)/2,data.seaLevel,(z0+z1)/2);
  function reset(){const fit=Math.max(1,1/Math.max(.35,camera.aspect));camera.position.set((x0+x1)/2+span*.65*fit,span*.8*fit,(z0+z1)/2+span*.85*fit); controls.update();}
  reset();
  scene.add(new THREE.HemisphereLight('#e7f5ff','#405448',2.4));
  const sun=new THREE.DirectionalLight('#fff3cc',2); sun.position.set(-span,span*2,span); scene.add(sun);
  const geometry=new THREE.PlaneGeometry(width,depth,segments,segments); geometry.rotateX(-Math.PI/2); geometry.translate((x0+x1)/2,0,(z0+z1)/2);
  const positions=geometry.attributes.position; const colors=[];
  for(let i=0;i<positions.count;i++) {
    const y=sample(positions.getX(i),positions.getZ(i)); positions.setY(i,y);
    const color=new THREE.Color(y<data.seaLevel+1.1?'#cabd89':y>data.height*.73?'#b0b4a0':y>data.height*.45?'#718b63':'#3f745d'); colors.push(color.r,color.g,color.b);
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3)); geometry.computeVertexNormals();
  scene.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true})));
  const water=new THREE.Mesh(new THREE.PlaneGeometry(width*12,depth*12),new THREE.MeshBasicMaterial({color:'#24576a'})); water.rotation.x=-Math.PI/2; water.position.set((x0+x1)/2,data.seaLevel,(z0+z1)/2); scene.add(water);
  // Densify straight segments before draping: avoids spline overshoot and tubes cutting hills.
  const points=[];
  for(let i=1;i<data.route.coordinates.length;i++) {
    const a=data.route.coordinates[i-1],b=data.route.coordinates[i];
    const steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/(span/segments/2)));
    for(let j=0;j<steps;j++){const t=j/steps,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;points.push(new THREE.Vector3(x,Math.max(sample(x,z),data.seaLevel)+span*.008,z));}
  }
  const last=data.route.coordinates.at(-1); points.push(new THREE.Vector3(last[0],Math.max(sample(...last),data.seaLevel)+span*.008,last[1]));
  const path=new THREE.CurvePath(); for(let i=1;i<points.length;i++)path.add(new THREE.LineCurve3(points[i-1],points[i]));
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(path,Math.min(4096,points.length*2),span*.003,5,false),new THREE.MeshBasicMaterial({color:'#f4d47b'})));
  const labels=document.createElement('div');labels.className='terrain-labels';root.append(labels);
  const labelPoints=data.markers.map(marker=>{
    const [x,z]=marker.coordinates,y=Math.max(sample(x,z),data.seaLevel);
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(span*.004,span*.004,span*.04,8),new THREE.MeshBasicMaterial({color:'#fff2c4'}));mesh.position.set(x,y+span*.02,z);scene.add(mesh);
    const label=document.createElement('span');label.textContent=marker.label;labels.append(label);
    return {label,position:new THREE.Vector3(x,y+span*.055,z)};
  });
  let scheduled=0,disposed=false,visible=true;
  const projected=new THREE.Vector3();
  function render(){scheduled=0;if(disposed||!visible||document.hidden)return; renderer.render(scene,camera);for(const {label,position} of labelPoints){projected.copy(position).project(camera);label.hidden=projected.z>1||projected.z< -1;label.style.transform=`translate(${(projected.x*.5+.5)*canvas.clientWidth}px,${(-projected.y*.5+.5)*canvas.clientHeight}px) translate(-50%,-100%)`;}}
  function invalidate(){if(!scheduled&&!disposed)scheduled=requestAnimationFrame(render);}
  controls.addEventListener('change',invalidate);
  let initialSize=true;
  const resize=new ResizeObserver(()=>{const w=root.clientWidth,h=root.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(initialSize){initialSize=false;reset();}invalidate();});resize.observe(root);
  const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)invalidate();});intersection.observe(root);
  document.addEventListener('visibilitychange',invalidate);
  function command(action){
    const offset=camera.position.clone().sub(controls.target),s=new THREE.Spherical().setFromVector3(offset);
    if(action==='left')s.theta-=.15; if(action==='right')s.theta+=.15;
    if(action==='up')s.phi=Math.max(.15,s.phi-.1);if(action==='down')s.phi=Math.min(controls.maxPolarAngle,s.phi+.1);
    if(action==='in')s.radius=Math.max(controls.minDistance,s.radius*.85);if(action==='out')s.radius=Math.min(controls.maxDistance,s.radius/ .85);
    if(action==='reset')reset();else {camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));controls.update();}invalidate();
  }
  const keyActions={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down','+':'in','=':'in','-':'out',Home:'reset'};
  function keydown(e){if(keyActions[e.key]){e.preventDefault();command(keyActions[e.key]);}}canvas.addEventListener('keydown',keydown);
  const toolbar=document.createElement('div');toolbar.className='terrain-controls';toolbar.setAttribute('aria-label','Map camera');
  for(const [action,label] of [['left','Rotate left'],['right','Rotate right'],['in','Zoom in'],['out','Zoom out'],['reset','Reset view']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>command(action);toolbar.append(button);}root.append(toolbar);
  invalidate();
  return {camera,renderer,command,render:invalidate,dispose(){disposed=true;cancelAnimationFrame(scheduled);resize.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',invalidate);canvas.removeEventListener('keydown',keydown);controls.dispose();scene.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});renderer.dispose();canvas.remove();labels.remove();toolbar.remove();}};
}
