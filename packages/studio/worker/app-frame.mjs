/** Opaque frames retain their isolation. Unavailable Web Storage falls back to frame-local memory. */
export const APP_STORAGE_JS=String.raw`(()=>{
 for(const name of ['localStorage','sessionStorage']) {
  try {const storage=window[name];const probe='homie-storage-probe';storage.setItem(probe,'1');storage.removeItem(probe);continue;}catch{}
  const data=new Map();const methods={getItem:k=>data.get(String(k))??null,setItem:(k,v)=>{data.set(String(k),String(v));},removeItem:k=>{data.delete(String(k));},clear:()=>data.clear(),key:i=>[...data.keys()][Number(i)]??null};
  const storage=new Proxy(methods,{get:(target,key)=>key==='length'?data.size:key in target?target[key]:data.get(String(key)),set:(_,key,value)=>{data.set(String(key),String(value));return true;},deleteProperty:(_,key)=>data.delete(String(key)),ownKeys:()=>[...data.keys()],getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});
  Object.defineProperty(window,name,{value:storage,configurable:true});
 }
})();`;
