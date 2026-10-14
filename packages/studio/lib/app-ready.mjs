/** One arrival barrier for baseline proof, needs reloads and rebuilt frames. */
export async function appReady(surface, {timeout=60000}={}) {
  const end=Date.now()+timeout;
  let error;
  do {
    try {
      await surface.page.waitForFunction(() => {
        const cover=document.querySelector('[data-arrive]');
        return window.__shell?.link?.state==='online' && window.__shell?.arrival?.phase==='done' && (!cover || (getComputedStyle(cover).opacity==='0' && getComputedStyle(cover).visibility==='hidden'));
      },{timeout:Math.max(1,end-Date.now())});
      const frame=surface.page.frames().find(f=>/\/__game\//.test(f.url()));
      if(!frame)throw new Error('app frame missing');
      await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      surface.frame=frame;return;
    } catch(e) {error=e;if(!/context|detach|navigat|frame missing/i.test(e.message))break;}
  } while(Date.now()<end);
  throw new Error(`${surface.name}: waiting for online app, arrival phase done, hidden [data-arrive], and two frames: ${error?.message}`);
}
/** Installed before any app script. Observes actual platform calls, without faking their outcome. */
export function observeEffects() {
  window.__homieNeedsEffects=[];
  const record=(effect,name)=>window.__homieNeedsEffects.push({effect,name});
  addEventListener('homie-effect',e=>{if(e.detail?.effect)record(e.detail.effect,e.detail.name);});
  const wrap=(obj,key,effect,name)=>{const original=obj?.[key];if(typeof original!=='function')return;try{obj[key]=function(...args){record(effect,typeof name==='function'?name(args):name);return Reflect.apply(original,this,args);};}catch{}};
  wrap(globalThis.AudioScheduledSourceNode?.prototype,'start','sound','audio');
  wrap(globalThis.HTMLMediaElement?.prototype,'play','sound','media');
  wrap(navigator,'vibrate','haptic','vibrate');
  if(globalThis.Notification) {const Original=Notification;globalThis.Notification=new Proxy(Original,{construct(target,args){record('notification',String(args[0]));return Reflect.construct(target,args);}});}
  wrap(globalThis.ServiceWorkerRegistration?.prototype,'showNotification','notification',args=>String(args[0]));
}
