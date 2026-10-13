/** Periodic coordinates. Half-period ties consistently choose the negative way. */
export const wrapValue = (value, range) => range ? range[0] + ((value - range[0]) % (range[1] - range[0]) + range[1] - range[0]) % (range[1] - range[0]) : value;
export const periodicDelta = (a, b, range) => range ? wrapValue(b - a, [-(range[1] - range[0]) / 2, (range[1] - range[0]) / 2]) : b - a;
export const wrapPoint = (p, wrap) => wrap ? {x: wrapValue(p.x, wrap.x), y: wrapValue(p.y, wrap.y), z: wrapValue(p.z ?? 0, wrap.z)} : p;
export const relativePoint = (p, at, wrap) => wrap ? {x:at.x+periodicDelta(at.x,p.x,wrap.x),y:at.y+periodicDelta(at.y,p.y,wrap.y),z:(at.z??0)+periodicDelta(at.z??0,p.z??0,wrap.z)} : p;
export const blendPosition = (a,b,t,wrap) => ({x:wrapValue(a.x+periodicDelta(a.x,b.x,wrap?.x)*t,wrap?.x),y:wrapValue(a.y+periodicDelta(a.y,b.y,wrap?.y)*t,wrap?.y),z:wrapValue(a.z+periodicDelta(a.z,b.z,wrap?.z)*t,wrap?.z)});
export function boundPosition(p, map, radius, height, dims) {
  const b=map.bounds,w=map.wrap;
  return {x:w?.x?wrapValue(p.x,w.x):Math.max(b.min.x+radius,Math.min(b.max.x-radius,p.x)),y:w?.y?wrapValue(p.y,w.y):Math.max(b.min.y+radius,Math.min(b.max.y-radius,p.y)),z:dims===3?(w?.z?wrapValue(p.z,w.z):Math.max(b.min.z,Math.min(b.max.z-height,p.z))):0};
}
/** Stream periodic images intersecting a query's swept bounds; callers meter each image. */
export function* imageOffsets(bounds, wrap, p, d, radius, height, dims=3) {
  const ranges=['x','y','z'].map(k=>{
    if(!wrap?.[k] || k==='z'&&dims===2)return [0,0,0];
    const period=wrap[k][1]-wrap[k][0];
    const lo=Math.min(p[k],p[k]+d[k])-(k==='z'?0:radius),hi=Math.max(p[k],p[k]+d[k])+(k==='z'?height:radius);
    const first=Math.ceil((lo-bounds.max[k])/period),last=Math.floor((hi-bounds.min[k])/period);
    if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last))throw new RangeError('periodic query exceeds exact integer coordinates');
    return [first,last,period];
  });
  for(let x=ranges[0][0];x<=ranges[0][1];x++)for(let y=ranges[1][0];y<=ranges[1][1];y++)for(let z=ranges[2][0];z<=ranges[2][1];z++)yield {x:x*ranges[0][2],y:y*ranges[1][2],z:z*ranges[2][2]};
}
