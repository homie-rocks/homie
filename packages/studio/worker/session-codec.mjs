/** Explicit containers keep user checkpoint keys from colliding with type tags. */
function pack(value) {
  if(value===undefined)return ['u'];
  if(typeof value==='number'&&!Number.isFinite(value))return ['n',String(value)];
  if(value===null||typeof value!=='object')return ['v',value];
  if(value instanceof Map)return ['m',[...value].map(([key,item])=>[pack(key),pack(item)])];
  if(value instanceof Set)return ['s',[...value].map(pack)];
  if(Array.isArray(value))return ['a',value.map(pack)];
  return ['o',Object.entries(value).filter(([,item])=>typeof item!=='function').map(([key,item])=>[key,pack(item)])];
}
function unpack([type,value]) {
  switch(type) {
    case 'u':return undefined;
    case 'n':return Number(value);
    case 'v':return value;
    case 'm':return new Map(value.map(([key,item])=>[unpack(key),unpack(item)]));
    case 's':return new Set(value.map(unpack));
    case 'a':return value.map(unpack);
    case 'o':return Object.fromEntries(value.map(([key,item])=>[key,unpack(item)]));
    default:throw new Error('Invalid room session value');
  }
}
export const encodeSession=value=>JSON.stringify(pack(value));
export const decodeSession=value=>unpack(JSON.parse(value));
