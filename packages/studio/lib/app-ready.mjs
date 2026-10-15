/** One arrival barrier for baseline proof, needs reloads and rebuilt frames. */
export async function appReady(surface, {timeout=60000}={}) {
  await surface.page.bringToFront?.();
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

/** Retry reads after navigation; never repeat a dispatched click or record mutation. */
export async function waitInApp(surface,label,read,{ready=appReady,timeout=60000}={}) {
 const end=Date.now()+timeout;
 for(;;) {
  try {return await read(surface.frame);}
  catch(error) {
   if(Date.now()>=end||!/context.*destroy|detach|navigat|cannot find context/i.test(error.message))throw new Error(`${surface.name}: waiting for ${label}: ${error.message}`);
   await ready(surface,{timeout:Math.max(1,end-Date.now())});
  }
 }
}
export function answerDialogs(page,surface,dialogs,report) {
 page.on('dialog',async dialog=>{
  const item={surface,type:dialog.type(),message:dialog.message(),answer:'accepted'};dialogs.push(item);
  report?.check?.('dialog-'+dialogs.length,'pass',{note:`${surface}: automatically accepted ${item.type}: ${item.message}`});
  await dialog.accept().catch(()=>{});
 });
}

/** Retry only errors identifying a detached element, never an ambiguous navigation after dispatch. */
export async function actInApp(surface, selector, action, {ready=appReady,timeout=10000}={}) {
  const end=Date.now()+timeout;
  let stale;
  for (;;) {
    try {
      await waitInApp(surface,selector,frame=>frame.waitForSelector(selector,{visible:true,timeout:Math.max(1,end-Date.now())}),{ready,timeout:Math.max(1,end-Date.now())});
      return await action(surface.frame);
    } catch(error) {
      if(!/node is detached|element.*(?:detach|stale)|stale.*element/i.test(error.message)) {
        if(stale && Date.now()>=end)throw new Error(`${surface.name}: stale element ${selector} never settled within ${timeout}ms: ${error.message}`);
        throw error;
      }
      stale=error;
      if(Date.now()>=end)throw new Error(`${surface.name}: stale element ${selector} never settled within ${timeout}ms: ${error.message}`);
      await new Promise(resolve=>setTimeout(resolve,Math.min(50,Math.max(1,end-Date.now()))));
      await ready(surface,{timeout:Math.max(1,end-Date.now())});
    }
  }
}
