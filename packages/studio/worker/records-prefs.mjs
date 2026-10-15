/** The records-only shell keeps net.prefs outside its opaque app frame. */
export const RECORDS_PREFS_JS=String.raw`(()=>{
 const boot=window.__HOMIE_APP,frame=document.querySelector('iframe.game');
 const storageKey='homie-prefs.'+boot.game;let memory=null;
 function read(){if(memory)return memory;try{const v=JSON.parse(localStorage.getItem(storageKey)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return memory={};}}
 addEventListener('message',e=>{
  const m=e.data;if(e.source!==frame.contentWindow||m?.t!=='homie-net'||m.what!=='prefs')return;
  const result={t:'homie-prefs',n:m.n,ok:false};
  try{
   const all=read(),key=m.k;
   if(m.op==='all'){result.ok=true;result.all=all;}
   else if(typeof key!=='string'||!key.length||key.length>64||key==='__proto__')result.why='key';
   else if(m.op==='set'||m.op==='del'){
    const next=Object.fromEntries(Object.entries(all).filter(([k])=>k!==key));
    if(m.op==='set'&&m.v!=null)next[key]=m.v;
    const text=JSON.stringify(next);
    if(text.length>16384||Object.keys(next).length>32)result.why='too-large';
    else if(typeof m.v==='number'&&!Number.isFinite(m.v))result.why='value';
    else{result.ok=true;result.kept='kept';try{if(memory)throw Error('memory');localStorage.setItem(storageKey,text);}catch{memory=next;result.kept='memory';}}
   }else result.why='op';
  }catch{result.why='error';}
  e.source.postMessage(result,'*');
 });
})();`;
