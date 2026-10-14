/** Opt-in acceptance evidence, sourced from the person's Codex, not starter labels. */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
export async function proveAppNeeds({ plan, surfaces, shots, report, ready = async () => {} }) {
  const results = [];
  let activeRole;
  const surface = name => { const s = surfaces.find(s => s.name === name && (!activeRole || s.role === activeRole)) ?? surfaces.find(s => s.name === name); if (!s) throw new Error(`unknown surface ${name}`); return s; };
  for (const need of plan.needs) {
    activeRole = need.role;
    const names = [...new Set([...(need.steps ?? []), ...(need.assertions ?? [])].map(s => s.surface))];
    let waiting = 'validating assertions';
    const result = { id: need.id, statement: need.statement, status: 'not', captures: [] };
    try {
      if (!Array.isArray(need.assertions) || !need.assertions.length) throw new Error('need requires assertions on its named surfaces');
      for (const name of names) { const s = surface(name); if (need.role && s.role !== need.role) throw new Error(`${name} requires role ${need.role}, got ${s.role ?? 'unspecified'}`); }
      for (const name of new Set(need.assertions.filter(a => a.effect).map(a => a.surface))) await surface(name).frame.evaluate(() => { window.__homieNeedsEffects = []; });
      for (const step of need.steps ?? []) {
        const { frame, page } = surface(step.surface);
        waiting = `${step.surface}: ${step.reload ? 'reload and arrival readiness' : step.selector}`;
        if (step.reload) { await page.reload({ waitUntil: 'domcontentloaded' }); await ready(surface(step.surface)); continue; }
        await frame.waitForSelector(step.selector, { visible: true });
        if (step.click) await frame.click(step.selector);
        else if (step.fill !== undefined) { await frame.$eval(step.selector, el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }); await frame.type(step.selector, String(step.fill)); }
        else if (step.select !== undefined) await frame.select(step.selector, String(step.select));
        else throw new Error('step needs click, fill, select or reload');
      }
      for (const assertion of need.assertions) {
        waiting = `${assertion.surface}: ${assertion.effect ? assertion.effect + ' ' + (assertion.name ?? '') : assertion.selector + (assertion.text === undefined ? '' : ' containing ' + JSON.stringify(assertion.text))}`;
        const { frame } = surface(assertion.surface);
        if (assertion.effect) {
          if (!['sound', 'haptic', 'notification'].includes(assertion.effect)) throw new Error('unknown effect');
          await frame.waitForFunction((effect, name) => window.__homieNeedsEffects?.some(e => e.effect === effect && (name === null || e.name === name)), { timeout: 10000 }, assertion.effect, assertion.name ?? null);
          continue;
        }
        await frame.waitForSelector(assertion.selector, { visible: true, timeout: 10000 });
        if (assertion.text !== undefined) await frame.waitForFunction((selector, text) => document.querySelector(selector)?.textContent.includes(text), { timeout: 10000 }, assertion.selector, String(assertion.text));
      }
      result.status = shots ? 'met' : 'partly';
      result.why = shots ? 'UI assertions passed; inspect captures against the pictured scene' : 'Assertions passed but no captures saved';
    } catch (error) { result.why = `Waiting for ${waiting}: ${error.message}`; }
    if (shots) for (const name of names) {
      const file = join(shots, `${need.id}-${name}.jpg`);
      try { await surface(name).page.screenshot({ path: file, type: 'jpeg', quality: 85 }); result.captures.push(file); }
      catch (error) { if (result.status === 'met') result.status = 'partly'; result.why += `; capture failed: ${error.message}`; }
    }
    report?.check?.(`need-${need.id}`, result.status === 'met' ? 'pass' : 'fail', { label: need.statement, note: result.why });
    results.push(result);
  }
  return results;
}

export function saveAppNeeds(root, id, plan, needs) {
  if (!root) return;
  const dir = join(root, '.studio', 'checks'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}-needs.json`), JSON.stringify({ at: new Date().toISOString(), codexHash: plan.hash, needs }, null, 2));
}
