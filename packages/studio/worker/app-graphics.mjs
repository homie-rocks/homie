export function appGraphicsFallback(text='This device cannot display the 3D scene. Use the text controls to continue.') {
 if(!document.querySelector('canvas')||document.querySelector('[data-webgl-fallback]'))return;
 try{const c=document.createElement('canvas');if(c.getContext('webgl2'))return;}catch{/* Context creation can throw when graphics are unavailable; show the fallback. */}
 const p=document.createElement('p');p.dataset.webglFallback='';p.setAttribute('role','status');p.textContent=text;
 p.style.cssText='position:static;pointer-events:none;padding:12px;background:#fff;color:#222;font:16px system-ui;border-radius:12px';
 const canvas=document.querySelector('canvas');
 canvas.insertAdjacentElement('afterend',p);
}
