/** Place already downloaded official MCP outputs. No provider networking, credentials or generation. */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
function inside(root, name) {
  const path = resolve(root, name), rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('asset paths must stay inside the studio');
  let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const actual = relative(realpathSync(root), realpathSync(ancestor));
  if (isAbsolute(actual) || actual === '..' || actual.startsWith(`..${sep}`)) throw new Error('symlink leaves studio');
  return path;
}
export function importMedia(root, { file, receipt, out, usedBy }) {
  if (!existsSync(resolve(root, 'studio.json'))) throw new Error('not a studio');
  const r = typeof receipt === 'string' ? JSON.parse(readFileSync(receipt, 'utf8')) : receipt;
  for (const key of ['provider','tool','model','requestId','prompt','styleRevision','rights','cost']) if (r?.[key] === undefined) throw new Error(`receipt needs ${key}`);
  if (!['fal','elevenlabs'].includes(r.provider) || !r.requestId || !r.tool || !r.model || !r.prompt) throw new Error('incomplete official MCP provenance');
  if (!r.rights?.source || !r.rights?.checkedAt || typeof r.rights?.commercial !== 'boolean') throw new Error('record rights source, date and commercial permission');
  if (!['estimate','actual','unknown'].includes(r.cost?.status) || (r.cost.status !== 'unknown' && !(Number.isFinite(r.cost.amount) && r.cost.amount >= 0 && r.cost.unit))) throw new Error('cost must be actual, estimate or explicitly unknown');
  const target = inside(root, out), use = inside(root, usedBy);
  const bytes = readFileSync(file);
  if (!bytes.length) throw new Error('empty asset');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const registry = inside(root, 'media/provenance.json');
  const records = existsSync(registry) ? JSON.parse(readFileSync(registry,'utf8')) : [];
  const previous = records.find(x => x.provider === r.provider && x.requestId === r.requestId && x.output === out);
  if (previous && previous.sha256 !== hash) throw new Error('same output identity has different bytes');
  if (existsSync(target) && createHash('sha256').update(readFileSync(target)).digest('hex') !== hash) throw new Error('destination already contains a different asset');
  // Store only allowlisted provenance; raw tool responses may contain temporary signed URLs.
  const record = { provider:r.provider, tool:r.tool, model:r.model, requestId:r.requestId, prompt:r.prompt, styleRevision:r.styleRevision,
    rights:{ source:r.rights.source, checkedAt:r.rights.checkedAt, commercial:r.rights.commercial, note:r.rights.note ?? null },
    cost:{ status:r.cost.status, amount:r.cost.amount ?? null, unit:r.cost.unit ?? null }, fixture:r.fixture === true,
    output:out, usedBy, sha256:hash, bytes:bytes.length };
  // Static reference evidence is not a runtime claim. Skills must also inspect the running scene.
  const reference = relative(dirname(use), target).split(sep).join('/');
  if (!readFileSync(use,'utf8').includes(reference)) throw new Error(`consumer does not reference ${reference}`);
  mkdirSync(dirname(target),{recursive:true}); copyFileSync(file,target);
  if (!previous) { records.push(record); mkdirSync(dirname(registry),{recursive:true}); writeFileSync(registry,JSON.stringify(records,null,2)+'\n'); }
  return { ok:true, command:'media import', artifact:out, provenance:'media/provenance.json', sha256:hash, already:Boolean(previous), usage:'static reference verified; inspect the running scene' };
}
