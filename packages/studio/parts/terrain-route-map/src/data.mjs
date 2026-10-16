export function validateMap(data, {baseURL = globalThis.location?.href, allowedOrigins = []} = {}) {
  validateHeightmapURL(data.heightmap, {baseURL, allowedOrigins});
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

/** PNG only: verify signature and IHDR dimensions before invoking an image decoder. */
export function heightmapDimensions(bytes) {
  const signature = [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82];
  if (bytes.length < 24 || signature.some((value,i) => bytes[i] !== value)) throw new Error('Expected a PNG heightmap');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (width < 2 || height < 2 || width > 2048 || height > 2048) throw new Error('Heightmap dimensions must be 2–2048 pixels');
  return {width, height};
}
export function validateHeightmapURL(value, {baseURL, allowedOrigins = []} = {}) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid heightmap URL');
  // Without a browser origin, validation permits relative paths only by default.
  const base = new URL(baseURL || 'https://relative.invalid/');
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !/\.png$/i.test(url.pathname) ||
      (url.origin !== base.origin && !allowedOrigins.includes(url.origin)) ||
      (!baseURL && /^(?:[a-z][a-z0-9+.-]*:|[\/\\]{2})/i.test(value) && !allowedOrigins.includes(url.origin))) throw new Error('Heightmap must be a same-origin or explicitly allowed PNG URL');
  return url.href;
}
export async function loadHeightmap(value, options = {}) {
  const url = validateHeightmapURL(value, options);
  const response = await fetch(url, {redirect:'error', credentials:'same-origin'});
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim() !== 'image/png') throw new Error('Expected a PNG response');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const {done, value:chunk} = await reader.read(); if (done) break;
      size += chunk.byteLength;
      if (size > 16 * 1024 * 1024) throw new Error('Heightmap exceeds download budget');
      chunks.push(chunk);
    }
  } catch (error) {await reader.cancel(); throw error;}
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk,offset); offset += chunk.length;}
  const {width,height} = heightmapDimensions(bytes);
  return createImageBitmap(new Blob([bytes], {type:'image/png'}), {resizeWidth:width, resizeHeight:height});
}
