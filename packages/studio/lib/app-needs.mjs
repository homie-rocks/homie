import {actInApp,waitInApp} from './app-ready.mjs';
/** Opt-in acceptance evidence, sourced from the person's Codex, not starter labels. */
import { existsSync, readFileSync, mkdirSync, writeFileSync, copyFileSync, realpathSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, basename } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';

export function readAppNeeds(root, id) {
  if (!root) return null;
  const file = join(root, 'apps', id, 'CODEX.md');
  if (!existsSync(file)) return null;
  const source = readFileSync(file, 'utf8');
  const block = /^```needs\s*\n([\s\S]*?)^```/m.exec(source);
  if (!block) return null; // An existing prose Codex has not opted into executable needs.
  const needs = JSON.parse(block[1]);
  if (!Array.isArray(needs) || !needs.length) throw new Error('App Codex has no demonstrable needs yet');
  const ids = new Set();
  for (const n of needs) {
    if (!n || !/^[a-zA-Z0-9_-]+$/.test(n.id ?? '') || ids.has(n.id) || typeof n.statement !== 'string' || !n.statement.trim()) throw new Error('Each Codex need requires a unique id and a statement from the request');
    ids.add(n.id);
  }
  return { needs, hash: createHash('sha256').update(source).digest('hex') };
}

/** Run real UI actions. A failed or absent flow stays visible; continue collecting other needs. */
export async function proveAppNeeds({ plan, surfaces, shots, report, ready = async () => {}, root, headless, restart }) {
  const results = [];
  const appBarrier=ready;
  ready=async (s,options)=>{await s.page.bringToFront?.();if(s.external){s.frame=s.page.mainFrame();return;}await appBarrier(s,options);};
  let activeRole, primarySurface;
  const surface = name => { const s = surfaces.find(s => s.name === name && (name!==primarySurface || !activeRole || s.role === activeRole)) ?? surfaces.find(s => s.name === name); if (!s) throw new Error(`unknown surface ${name}`); return s; };
  for (const need of plan.needs) {
    activeRole = need.role;
    primarySurface = need.surface ?? needSteps(need.steps).find(s=>s.surface)?.surface ?? need.assertions?.find(s=>s.surface)?.surface;
    const names = [...new Set([...needSteps(need.steps), ...(need.assertions ?? [])].map(s => s.surface).filter(Boolean))];
    const saved = new Map();
    const run = async item => { if (!headless) throw new Error('headless MCP proof requires local dev and its test credential'); return headless(item,item.role ?? need.role); };
    let waiting = 'validating assertions';
    const result = { id: need.id, statement: need.statement, status: 'not', captures: [] };
    try {
      if (!Array.isArray(need.assertions) || !need.assertions.length) throw new Error('need requires at least one assertion (UI, result, records or file)');
      const popupNames=new Set((need.steps??[]).map(s=>s.popup).filter(Boolean));
      for (const name of names) { if(popupNames.has(name))continue; const s = surface(name); if (name===primarySurface && need.role && s.role !== need.role) throw new Error(`${name} requires role ${need.role}, got ${s.role ?? 'unspecified'}`); }
      for (const name of new Set(need.assertions.filter(a => a.effect).map(a => a.surface))) await surface(name).frame.evaluate(() => { window.__homieNeedsEffects = []; });
      const perform = async rawStep => {
        const step=resolveNeedResults(rawStep,saved);
        if(step.concurrent){
          if(!Array.isArray(step.concurrent)||step.concurrent.length<2)throw new Error('concurrent needs at least two steps');
          if(needSteps(step.concurrent).some(s=>s.restart||s.capabilities))throw new Error('Restart and capabilities changes must be outside a race');
          const results=await Promise.allSettled(step.concurrent.map(perform));
          const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;return;
        }
        if(step.restart){if(!restart)throw new Error('Restart requires the local dev controller');await restart();for(const s of surfaces)await ready(s);return;}

        if (step.mcp || step.schedule) {
          waiting = step.mcp ? `MCP ${step.mcp.tool ?? step.mcp.method} as ${step.role ?? need.role ?? 'unspecified'}` : `schedule ${step.schedule.name}`;
          const value = await run(step);
          if (step.save) { if(saved.has(step.save))throw new Error(`duplicate saved result ${step.save}`); saved.set(step.save,value); }
          return;
        }
        const target=surface(step.surface);
        if(!step.reload)await ready(target);
        const { page } = target;
        if(step.capabilities){
          if(typeof step.capabilities.webgl!=='boolean')throw new Error('capabilities.webgl must be boolean');
          await page.evaluateOnNewDocument(configureWebGL,step.capabilities.webgl);
          await page.reload({waitUntil:'domcontentloaded'});await ready(target);return;
        }
        if(Object.hasOwn(step,'clock')){await page.evaluate(value=>window.homieApp.setTestClock(value),step.clock);return;}

        waiting = `${step.surface}: ${step.reload ? 'reload and arrival readiness' : step.selector}`;
        if (step.reload) { await page.reload({ waitUntil: 'domcontentloaded' }); await ready(surface(step.surface)); return; }
        const act = fn => actInApp(target,step.selector,fn,{ready});
        if (step.click && step.popup) {
          let listener,timer;
          const opened=new Promise((resolve,reject)=>{
            listener=popup=>resolve(popup);page.once('popup',listener);
            timer=setTimeout(()=>reject(new Error('payment popup did not open')),10000);
          });
          try {
            const [popup]=await Promise.all([opened,act(frame=>frame.click(step.selector))]);
            surfaces.push({name:step.popup,page:popup,frame:popup.mainFrame(),external:true,role:target.role});
            await page.bringToFront();
          } finally {clearTimeout(timer);page.off('popup',listener);}
        }
        else if(step.forceClick){await act(frame=>frame.$eval(step.selector,el=>{
          const disabled=el.disabled;try{el.disabled=false;el.click();}finally{el.disabled=disabled;}
        }));}
        else if (step.click) {await act(frame=>frame.click(step.selector));await page.bringToFront?.();}
        else if (step.fill !== undefined) { await act(async frame=>{ await frame.$eval(step.selector, el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }); await frame.type(step.selector, String(step.fill)); }); }
        else if (step.select !== undefined) await act(frame=>frame.select(step.selector, String(step.select)));
        else throw new Error('step needs click, fill, select or reload');
      };
      for(const step of need.steps??[])await perform(step);
      for (const rawAssertion of need.assertions) {
        const assertion=resolveNeedResults(rawAssertion,saved);
        if (assertion.result || assertion.records || assertion.file || assertion.mcp) {
          waiting = assertion.file ? `file ${assertion.file}` : assertion.result ? `result ${assertion.result}${assertion.path ? '.'+assertion.path : ''}` : assertion.records ? `records ${assertion.records.collection}` : `MCP ${assertion.mcp.tool ?? assertion.mcp.method}`;
          let value;
          if (assertion.file) {
            if (!root) throw new Error('file proof requires the studio root');
            const file=resolve(root,assertion.file), rel=relative(resolve(root),file);
            if(rel.startsWith('..') || isAbsolute(rel))throw new Error('handover file must be inside the studio');
            value=readFileSync(file,'utf8');
          } else if (assertion.result) {
            if(!saved.has(assertion.result))throw new Error(`no saved result ${assertion.result}; add save to its step`);
            value=saved.get(assertion.result);
          } else {
            const waitMs=assertion.waitMs??0;
            if(!Number.isInteger(waitMs)||waitMs<0||waitMs>10000)throw new Error('waitMs must be an integer from 0 to 10000');
            const end=Date.now()+waitMs;
            for(;;) {
              value=await run(assertion);
              try {assertNeedValue(value,assertion);break;}
              catch(error){if(Date.now()>=end)throw error;await new Promise(resolve=>setTimeout(resolve,100));}
            }
          }
          assertNeedValue(value,assertion);
          continue;
        }
        waiting = `${assertion.surface}: ${assertion.effect ? assertion.effect + ' ' + (assertion.name ?? '') : assertion.selector + (assertion.text === undefined ? '' : ' containing ' + JSON.stringify(assertion.text))}`;
        const target=surface(assertion.surface);
        await ready(target);
        await waitInApp(target,waiting,async frame=>{
        if (assertion.effect) {
          if (!['sound', 'haptic', 'notification'].includes(assertion.effect)) throw new Error('unknown effect');
          await frame.waitForFunction((effect, name) => window.__homieNeedsEffects?.some(e => e.effect === effect && (name === null || e.name === name)), { timeout: 10000 }, assertion.effect, assertion.name ?? null);
          return;
        }
        await frame.waitForSelector(assertion.selector, { visible: true, timeout: 10000 });
        if (assertion.text !== undefined) await frame.waitForFunction((selector, text) => document.querySelector(selector)?.textContent.includes(text), { timeout: 10000 }, assertion.selector, String(assertion.text));
        },{ready});
      }
      result.status = 'met';
      result.why = 'Assertions passed';
    } catch (error) { result.why = `Waiting for ${waiting}: ${error.message}`; }
    if (!shots) for (const name of names) result.why += `; ${name} capture not requested: rerun check with --shots .checks and inspect the scene`;
    if (shots) for (const name of names) {
      const file = join(shots, `${need.id}-${name}.jpg`);
      try { mkdirSync(shots,{recursive:true}); await ready(surface(name)); await surface(name).page.screenshot({ path: file, type: 'jpeg', quality: 85 }); result.captures.push(file); }
      catch (error) { result.why += `; ${name} capture failed: ${error.message}. Resolve this capture error and rerun check with --shots .checks`;  }
    }
    report?.check?.(`need-${need.id}`, result.status === 'met' ? 'pass' : 'fail', { label: need.statement, note: result.why });
    results.push(result);
  }
  return results;
}

export function saveAppNeeds(root, id, plan, needs) {
  if (!root) return;
  const dir = join(root, '.studio', 'checks'); mkdirSync(dir, { recursive: true });
  needs=needs.map(need=>({...need,captures:(need.captures??[]).map(file=>{
    const source=realpathSync(resolve(root,file)),rel=relative(realpathSync(root),source);
    if(!rel.startsWith('..')&&!isAbsolute(rel))return rel;
    const target=join(dir,`${id}-${createHash('sha256').update(source).digest('hex').slice(0,12)}-${basename(source)}`);
    copyFileSync(source,target);return relative(root,target);
  })}));
  writeFileSync(join(dir, `${id}-needs.json`), JSON.stringify({ at: new Date().toISOString(), codexHash: plan.hash, needs }, null, 2));
}

/** Partial structured matching: object keys must match; each expected array entry must occur. */
export function containsValue(actual, expected) {
  if (typeof expected === 'string') return typeof actual === 'string' && actual.includes(expected);
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every(e=>actual.some(a=>containsValue(a,e)));
  if (expected && typeof expected === 'object') return actual !== null && typeof actual === 'object' && Object.entries(expected).every(([k,v])=>Object.hasOwn(actual,k)&&containsValue(actual[k],v));
  return isDeepStrictEqual(actual,expected);
}
export function assertNeedValue(value, assertion) {
  if(assertion.path) for(const key of assertion.path.split('.')) value=value!=null&&Object.hasOwn(Object(value),key)?value[key]:undefined;
  if(value === undefined)throw new Error('value does not exist');
  if(Object.hasOwn(assertion,'equals')&&!isDeepStrictEqual(value,assertion.equals))throw new Error(`expected equals ${JSON.stringify(assertion.equals)}; got ${JSON.stringify(value)}`);
  if(Object.hasOwn(assertion,'contains')&&!containsValue(value,assertion.contains))throw new Error(`expected contains ${JSON.stringify(assertion.contains)}; got ${JSON.stringify(value)}`);
  if(assertion.text!==undefined)for(const text of [].concat(assertion.text))if(typeof value!=='string'||!value.includes(String(text)))throw new Error(`expected text ${JSON.stringify(text)}`);
  if(!assertion.file&&!Object.hasOwn(assertion,'equals')&&!Object.hasOwn(assertion,'contains')&&assertion.text===undefined)throw new Error('result/records assertion requires equals, contains or text');
}

/** Explicit result references never evaluate code or interpolate arbitrary strings. */
export function resolveNeedResults(value,saved) {
  if(Array.isArray(value))return value.map(v=>resolveNeedResults(v,saved));
  if(value && typeof value==='object') {
    if(Object.keys(value).length===1 && typeof value.$result==='string') {
      const [name,...path]=value.$result.split('.');
      if(!saved.has(name))throw new Error(`no saved result ${name}`);
      let result=saved.get(name);
      for(const key of path)result=result!=null&&Object.hasOwn(Object(result),key)?result[key]:undefined;
      if(result===undefined)throw new Error(`saved result path ${value.$result} does not exist`);
      return result;
    }
    return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,resolveNeedResults(v,saved)]));
  }
  return value;
}

/** Flatten only action groups; used for browser/role discovery before a race starts. */
export function needSteps(steps = []) { return steps.flatMap(s => s.concurrent ? needSteps(s.concurrent) : [s]); }
export function configureWebGL(enabled) {
  window.__homieWebGLDisabled = !enabled;
  if(window.__homieWebGLWrapped)return;
  window.__homieWebGLWrapped = true;
  for(const proto of [globalThis.HTMLCanvasElement?.prototype,globalThis.OffscreenCanvas?.prototype]) {
    if(!proto)continue;
    const original = proto.getContext;
    proto.getContext = function(kind, ...args) {
      if(window.__homieWebGLDisabled && /^(webgl2?|experimental-webgl)$/.test(kind))return null;
      return Reflect.apply(original,this,[kind,...args]);
    };
  }
}
