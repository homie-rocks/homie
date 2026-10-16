import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {validateMap, loadHeightmap, heightSampler, placeLabels, qualityMonitor} from './data.mjs';
/** Owns only its canvas, controls and GPU resources. Call dispose when leaving the view. */
export async function mountTerrainMap(root, input, {segments=192, pixelRatio=1.5, quality='auto', allowedOrigins=[]}={}) {
  if(!['auto','full','lite'].includes(quality))throw new Error('Invalid quality');
  const imageOptions={baseURL:location.href, allowedOrigins};
  const data=validateMap(input,imageOptions);
  if (!Number.isInteger(segments)||segments<8||segments>256||!Number.isFinite(pixelRatio)||pixelRatio<.5||pixelRatio>2) throw new Error('Invalid rendering budget');
  const spanBudget=Math.max(data.bounds[2]-data.bounds[0],data.bounds[3]-data.bounds[1]);
  const estimatedPoints=data.route.coordinates.slice(1).reduce((sum,b,i)=>{const a=data.route.coordinates[i];return sum+Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/(spanBudget/segments/2)));},1);
  if(estimatedPoints>8192) throw new Error('Route exceeds rendering budget');
  const image = await loadHeightmap(data.heightmap,imageOptions);
  const sampling=document.createElement('canvas'); sampling.width=image.width; sampling.height=image.height;
  const context=sampling.getContext('2d',{willReadFrequently:true}); context.drawImage(image,0,0);
  image.close();
  const rawSample=heightSampler(context.getImageData(0,0,image.width,image.height),data.bounds,data.height);
  const sample=(x,z)=>(rawSample(x,z)*4+rawSample(x-.5,z)+rawSample(x+.5,z)+rawSample(x,z-.5)+rawSample(x,z+.5))/8;
  const [x0,z0,x1,z1]=data.bounds, width=x1-x0, depth=z1-z0, span=Math.max(width,depth);
  const scene=new THREE.Scene(); scene.background=new THREE.Color('#9ebbc5'); scene.fog=new THREE.FogExp2('#9ebbc5',.0009);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lite=quality==='lite', intro=!reduced; const monitor=qualityMonitor();
  const camera=new THREE.PerspectiveCamera(40,1,span/1000,span*12);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false}); renderer.setPixelRatio(Math.min(devicePixelRatio,pixelRatio));
  renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.15;
  const canvas=renderer.domElement; canvas.tabIndex=0; canvas.setAttribute('role','img'); canvas.setAttribute('aria-label','Terrain map. Drag to orbit, pinch to zoom. Arrow keys rotate, plus and minus zoom, Home resets.');
  root.classList.add('terrain-map'); root.append(canvas);
  const controls=new OrbitControls(camera,canvas); controls.enableDamping=false; controls.enablePan=false; controls.minDistance=span*.3; controls.maxDistance=span*3; controls.maxPolarAngle=Math.PI*.46;
  controls.target.set((x0+x1)/2,data.seaLevel,(z0+z1)/2);
  function reset(){const fit=Math.max(1,1/Math.max(.35,camera.aspect));camera.position.set((x0+x1)/2+span*.48*fit,span*.65*fit,(z0+z1)/2+span*.78*fit); controls.update();}
  reset();
  scene.add(new THREE.HemisphereLight('#bce2ff','#293d32',1.7));
  const sun=new THREE.DirectionalLight('#ffe2ad',3.1); sun.position.set(-span,span*.9,span); scene.add(sun);
  const sky=new THREE.Mesh(new THREE.SphereGeometry(span*5,16,12),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{},vertexShader:`varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`varying vec3 direction;void main(){float h=smoothstep(-.1,.7,normalize(direction).y);gl_FragColor=vec4(mix(vec3(.62,.73,.77),vec3(.12,.32,.49),h),1.);}`}));sky.position.copy(controls.target);scene.add(sky);
  const geometry=new THREE.PlaneGeometry(width,depth,segments,segments); geometry.rotateX(-Math.PI/2); geometry.translate((x0+x1)/2,0,(z0+z1)/2);
  const positions=geometry.attributes.position; const colors=[];
  for(let i=0;i<positions.count;i++) {
    const y=sample(positions.getX(i),positions.getZ(i)); positions.setY(i,y);
    const x=positions.getX(i),z=positions.getZ(i);
    const slope=Math.hypot(sample(x+1,z)-sample(x-1,z),sample(x,z+1)-sample(x,z-1));
    const color=new THREE.Color('#3e6951').lerp(new THREE.Color('#a2a493'),Math.min(1,Math.max(slope*.35,(y/data.height-.5)*2)));
    color.lerp(new THREE.Color('#d7c99d'),1-THREE.MathUtils.smoothstep(y,data.seaLevel+.2,data.seaLevel+2.5));
    const cavity=Math.max(0,(sample(x+3,z)+sample(x-3,z)+sample(x,z+3)+sample(x,z-3))/4-y);
    color.multiplyScalar((.96+.04*Math.sin(x*.7+Math.sin(z*.3))*Math.cos(z*.8))*(1-Math.min(.3,cavity*.16))); colors.push(color.r,color.g,color.b);
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3)); geometry.computeVertexNormals();
  function useLite(){lite=true;renderer.setPixelRatio(Math.min(1,pixelRatio));renderer.setSize(root.clientWidth,root.clientHeight,false);
    // Reuse the vertex buffer, drawing every second grid cell. No second mesh allocation.
    if(segments%2===0){const indices=[];for(let z=0;z<segments;z+=2)for(let x=0;x<segments;x+=2){const a=z*(segments+1)+x,b=a+2,c=a+2*(segments+1),d=c+2;indices.push(a,c,b,b,c,d);}geometry.setIndex(indices);}
  }
  if(lite)useLite();
  scene.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:false})));
  const heightTexture=new THREE.CanvasTexture(sampling); heightTexture.flipY=false;
  const waterMaterial=new THREE.ShaderMaterial({uniforms:{time:{value:0},heights:{value:heightTexture},bounds:{value:new THREE.Vector4(x0,z0,width,depth)},amplitude:{value:data.height},sea:{value:data.seaLevel},lite:{value:lite?1:0}},
    vertexShader:`varying vec3 world; void main(){world=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`,
    fragmentShader:`precision highp float; varying vec3 world; uniform sampler2D heights; uniform vec4 bounds; uniform float amplitude,sea,time,lite;
    void main(){vec2 uv=(world.xz-bounds.xy)/bounds.zw;float inside=smoothstep(0.,.08,uv.x)*smoothstep(0.,.08,uv.y)*(1.-smoothstep(.92,1.,uv.x))*(1.-smoothstep(.92,1.,uv.y));
    float depth=max(0.,sea-texture2D(heights,clamp(uv,0.,1.)).r*amplitude*inside);
    vec3 col=mix(vec3(.14,.58,.56),vec3(.025,.18,.27),smoothstep(0.,3.5,depth));
    float wave=sin(world.x*.7+world.z*.55+sin(world.z*.13)*2.-time*1.1)+sin(world.z*1.3-world.x*.4+sin(world.x*.17)*3.+time*.8);
    float foam=(1.-smoothstep(.12,1.1,depth))*(.55+.45*sin(depth*15.-time*2.+wave*.5));
    col=mix(col,vec3(.84,.93,.83),foam*.8);col+=pow(max(0.,wave*.5),12.)*.035*(1.-lite*.7);
    float haze=1.-exp(-distance(cameraPosition,world)*.0009);col=mix(col,vec3(.35,.52,.60),haze);
    gl_FragColor=vec4(col,1.); #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`.replace(' #include','\n#include')});
  const water=new THREE.Mesh(new THREE.PlaneGeometry(width*12,depth*12),waterMaterial); water.rotation.x=-Math.PI/2; water.position.set((x0+x1)/2,data.seaLevel,(z0+z1)/2); scene.add(water);
  // Densify straight segments before draping: avoids spline overshoot and tubes cutting hills.
  const points=[];
  for(let i=1;i<data.route.coordinates.length;i++) {
    const a=data.route.coordinates[i-1],b=data.route.coordinates[i];
    const steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/(span/segments/2)));
    for(let j=0;j<steps;j++){const t=j/steps,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;points.push(new THREE.Vector3(x,Math.max(sample(x,z),data.seaLevel)+span*.008,z));}
  }
  const last=data.route.coordinates.at(-1); points.push(new THREE.Vector3(last[0],Math.max(sample(...last),data.seaLevel)+span*.008,last[1]));
  const path=new THREE.CurvePath(); for(let i=1;i<points.length;i++)path.add(new THREE.LineCurve3(points[i-1],points[i]));
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(path,Math.min(4096,points.length*2),span*.003,5,false),new THREE.MeshBasicMaterial({color:'#ffcd61'})));
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(path,Math.min(4096,points.length*2),span*.006,5,false),new THREE.MeshBasicMaterial({color:'#ffcc65',transparent:true,opacity:.12,depthWrite:false})));
  const flowGeometry=new THREE.SphereGeometry(span*.004,6,4);
  const flow=new THREE.InstancedMesh(flowGeometry,new THREE.MeshBasicMaterial({color:'#ffffff'}),12);scene.add(flow);
  const flowMatrix=new THREE.Matrix4();
  const labels=document.createElement('div');labels.className='terrain-labels';root.append(labels);
  const labelPoints=data.markers.map((marker,index)=>{
    const [x,z]=marker.coordinates,y=Math.max(sample(x,z),data.seaLevel);
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(span*.003,span*.003,span*.035,8),new THREE.MeshBasicMaterial({color:'#fff2c4'}));mesh.position.set(x,y+span*.0175,z);scene.add(mesh);
    const line=document.createElement('i');line.setAttribute('aria-hidden','true');labels.append(line);
    const label=document.createElement('span');label.textContent=`${String(index+1).padStart(2,'0')}  ${marker.label}`;labels.append(label);
    return {label,line,position:new THREE.Vector3(x,y+span*.04,z)};
  });
  const accessible=document.createElement('ul');accessible.className='terrain-accessible';
  for(const m of data.markers){const li=document.createElement('li');li.textContent=m.label;accessible.append(li);}root.append(accessible);
  labels.setAttribute('aria-hidden','true');
  let scheduled=0,disposed=false,visible=true,previous=0,start=0;
  const projected=new THREE.Vector3();
  function render(now){scheduled=0;if(disposed||!visible||document.hidden){previous=0;return;}
    if(!start)start=now; const elapsed=(now-start)/1000;
    if(quality==='auto'&&!lite&&previous&&elapsed>2&&monitor(now-previous)){useLite();waterMaterial.uniforms.lite.value=1;}
    previous=now;waterMaterial.uniforms.time.value=reduced?0:elapsed;
    if(intro){const t=Math.min(1,elapsed/2.2);reset();const offset=camera.position.clone().sub(controls.target);offset.applyAxisAngle(new THREE.Vector3(0,1,0),.15*(1-t)*(1-t));camera.position.copy(controls.target).add(offset);controls.update();if(t===1)intro=false;}
    for(let i=0;i<12;i++){const p=path.getPoint(((reduced?0:elapsed*.035)+i/12)%1);flowMatrix.makeTranslation(p.x,p.y,p.z);flow.setMatrixAt(i,flowMatrix);}flow.instanceMatrix.needsUpdate=true;
    renderer.render(scene,camera);
    const projectedLabels=labelPoints.map(({label,position})=>{projected.copy(position).project(camera);return {x:(projected.x*.5+.5)*canvas.clientWidth,y:(-projected.y*.5+.5)*canvas.clientHeight,w:label.offsetWidth,h:label.offsetHeight,visible:projected.z<=1&&projected.z>=-1};});
    const boxes=placeLabels(projectedLabels,canvas.clientWidth,canvas.clientHeight);
    labelPoints.forEach(({label,line},i)=>{const box=boxes[i],p=projectedLabels[i];label.style.visibility=line.style.visibility=box&&p.visible?'visible':'hidden';if(!box)return;
      label.style.transform=`translate(${box.x}px,${box.y}px)`;
      const dx=box.x+box.w/2-p.x,dy=box.y+box.h-p.y;line.style.width=`${Math.hypot(dx,dy)}px`;line.style.transform=`translate(${p.x}px,${p.y}px) rotate(${Math.atan2(dy,dx)}rad)`;
    });
    if(!reduced)invalidate();
  }
  function invalidate(){if(!scheduled&&!disposed)scheduled=requestAnimationFrame(render);}
  controls.addEventListener('start',()=>{intro=false;});
  controls.addEventListener('change',invalidate);
  let initialSize=true;
  const resize=new ResizeObserver(()=>{const w=root.clientWidth,h=root.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(initialSize){initialSize=false;reset();}invalidate();});resize.observe(root);
  const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)invalidate();});intersection.observe(root);
  document.addEventListener('visibilitychange',invalidate);
  function command(action){
    intro=false;
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
  return {camera,renderer,command,get quality(){return lite?'lite':'full';},render:invalidate,dispose(){disposed=true;cancelAnimationFrame(scheduled);resize.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',invalidate);canvas.removeEventListener('keydown',keydown);controls.dispose();scene.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});heightTexture.dispose();renderer.dispose();canvas.remove();labels.remove();accessible.remove();toolbar.remove();}};
}
