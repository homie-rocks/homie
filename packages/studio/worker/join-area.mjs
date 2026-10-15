/** The shell owns these measurements; sandboxed views receive only geometry. */
export function joinAreaShell() {
 const frame=document.querySelector('iframe.game');
 const update=()=>{
  const card=document.querySelector('[data-join]');
  const r=card?.getBoundingClientRect();
  const visible=!!(r?.width&&r.height&&getComputedStyle(card).visibility!=='hidden'&&getComputedStyle(card).display!=='none');
  const corner=card?.className??'';
  const box=visible?{x:r.x,y:r.y,width:r.width,height:r.height,top:corner.includes('top')?r.bottom:0,bottom:corner.includes('top')?0:innerHeight-r.top,left:corner.includes('left')?r.right:0,right:corner.includes('left')?0:innerWidth-r.left}:{};
  document.body.classList.toggle('homie-join-visible',visible);
  for(const k of ['top','bottom','left','right'])document.documentElement.style.setProperty('--homie-join-inset-'+k,(box[k]??0)+'px');
  for(const k of ['x','y','width','height'])document.documentElement.style.setProperty('--homie-join-'+k,(box[k]??0)+'px');
  frame?.contentWindow?.postMessage({type:'homie-join-area',visible,box},'*');
 };
 new ResizeObserver(update).observe(document.body);
 const card=document.querySelector('[data-join]');if(card)new ResizeObserver(update).observe(card);
 new MutationObserver(update).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class']});
 frame?.addEventListener('load',update);addEventListener('resize',update);
 addEventListener('message',e=>{if(e.source===frame?.contentWindow&&e.data?.type==='homie-join-ready')update();});
 update();
}
export function joinAreaFrame() {
 addEventListener('message',e=>{
  if(e.source!==parent||e.data?.type!=='homie-join-area')return;
  const {box,visible}=e.data;
  document.body?.classList.toggle('homie-join-visible',!!visible);
  for(const k of ['top','bottom','left','right','x','y','width','height']) {
   const v=box?.[k];if(v!==undefined&&(!Number.isFinite(v)||v<0))return;
   document.documentElement.style.setProperty('--homie-join-'+(['top','bottom','left','right'].includes(k)?'inset-':'')+k,(v??0)+'px');
  }
 });
 addEventListener('DOMContentLoaded',()=>parent.postMessage({type:'homie-join-ready'},'*'));
}
export const JOIN_AREA_SHELL_JS=`(${joinAreaShell.toString()})();`;
export const JOIN_AREA_FRAME_JS=`(${joinAreaFrame.toString()})();`;
