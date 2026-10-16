export function validateMap(data) {
  const {bounds, route, markers = [], height = 28, seaLevel = 6} = data;
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) throw new Error('bounds must be [minX,minZ,maxX,maxZ]');
  const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0]>=bounds[0] && p[0]<=bounds[2] && p[1]>=bounds[1] && p[1]<=bounds[3];
  if (route?.type !== 'LineString' || !Array.isArray(route.coordinates) || route.coordinates.length < 2 || route.coordinates.length > 2048 || !route.coordinates.every(point)) throw new Error('route must be a bounded LineString of 2–2048 points');
  if (route.coordinates.some((p,i,a)=> i && p[0]===a[i-1][0] && p[1]===a[i-1][1])) throw new Error('Consecutive route points must differ');
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(seaLevel) || seaLevel < 0 || seaLevel >= height) throw new Error('Invalid height or sea level');
  if (!Array.isArray(markers) || markers.length > 32 || markers.some(m=>!point(m.coordinates)||typeof m.label!=='string'||!m.label.trim()||m.label.length>80)) throw new Error('Invalid markers (maximum 32)');
  return {...data, markers, height, seaLevel};
}
/** Red channel, row zero = minZ. Bilinear interpolation; pixel endpoints span bounds. */
export function heightSampler({width, height, data}, bounds, amplitude) {
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||data.length!==width*height*4) throw new Error('Invalid RGBA heightmap');
  return (x,z) => {
    const u=Math.max(0,Math.min(1,(x-bounds[0])/(bounds[2]-bounds[0])))*(width-1);
    const v=Math.max(0,Math.min(1,(z-bounds[1])/(bounds[3]-bounds[1])))*(height-1);
    const a=Math.floor(u), b=Math.floor(v), fx=u-a, fz=v-b;
    const sample=(i,j)=>data[(Math.min(j,height-1)*width+Math.min(i,width-1))*4]/255*amplitude;
    return (sample(a,b)*(1-fx)+sample(a+1,b)*fx)*(1-fz)+(sample(a,b+1)*(1-fx)+sample(a+1,b+1)*fx)*fz;
  };
}

/** Stable screen-space packing. Hidden overflow remains in the accessible marker list. */
export function placeLabels(points, width, height) {
  const placed=[];
  return points.map(({x,y,w,h})=>{
    const left=Math.max(8,Math.min(width-w-8,x-w/2));
    for(let step=0;step<height;step+=h+8){
      for(const sign of [-1,1]){
        const top=Math.max(8,Math.min(height-h-112,y-72+step*sign));
        if(top<8 || placed.some(b=>left<b.x+b.w+8&&left+w+8>b.x&&top<b.y+b.h+8&&top+h+8>b.y))continue;
        const box={x:left,y:top,w,h};placed.push(box);return box;
      }
    }
    return null;
  });
}
/** Ignore startup/hidden gaps; sustained slow frames reduce the GPU budget once. */
export function qualityMonitor({threshold=28,samples=90}={}) {
  let count=0,slow=0;
  return dt=>{if(dt<=0||dt>250)return false;count++;if(dt>threshold)slow++;return count>=samples&&slow/count>.25;};
}
