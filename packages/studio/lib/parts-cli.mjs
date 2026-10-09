import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPart, partDir } from './parts.mjs';
import { saleProblems } from "../worker/parts-sale.mjs";
import { purchasePortal, prepareRecovery } from './parts-purchase.mjs';
/**
 * `homie-studio parts …`: the plumbing behind the four chat tools (lib/parts-tools.mjs; parts/PARTS.md). A creator
 * works in chat and never types these; an agent with a shell and no MCP connection may.
 *
 *   parts find <words> [--kind <kind>] [--tag <tag>] [--license <SPDX>] [--builds <package or rig>]
 *   parts new <id> [--kind <kind>] [--name "<Name>"] [--from <game> <paths in the game…>]
 *   parts add <host>/<id>[@<version>] [--game <id>] [--overwrite] [--no-install]     (again: the newer version)
 *       --no-install: bring the part in and install nothing. package.json and package-lock.json are not touched and
 *       npm is only asked what the studio has (`npm ls`). Each package the part builds on that is missing is named
 *       "NOT INSTALLED" with the one npm command that installs it. The part will not build until that is run.
 *   parts share <id>      parts unshare <id>      (live after the studio's next deploy)
 *   parts check [<id>]                             (what stands in the way of sharing; rewrites the hashes)
 */
import { newPart } from './parts.mjs';
import { addPart, checkParts, findParts, sharePart } from './parts-store.mjs';

export const PARTS_VERBS = ['find', 'new', 'add', 'share', 'unshare', 'check', 'manage', 'recover', 'reissue', 'keys', 'offer', 'refund', 'retire', 'test-access'];

/**
 * What `parts add` takes, in the words the command prints when it is not given a part. `--no-install` is said as
 * what it does: nothing is installed and package.json is not written (npm writes it, when npm installs). A test
 * runs the flag through the real command and holds these words to what happened.
 */
export const PARTS_ADD_USAGE = 'homie-studio parts add <studio site>/<part id>[@<version>] [--game <id>] [--overwrite] [--no-install]\n  --no-install: install nothing and leave package.json as it is; a package the part builds on that this studio does not have is named NOT INSTALLED with the npm command that installs it (the part will not build until then).';

export async function partsCommand(root, sub, positional, flags, { log = () => {}, fetch, npm } = {}) {
  const arg = positional[2];
  const str = (k) => (typeof flags.get(k) === 'string' ? flags.get(k) : null);
  switch (sub ?? 'find') {
    case 'find': return findParts(root, positional.slice(2).join(' '), { kind: str('kind'), tag: str('tag'), license: str('license'), builds: str('builds'), fetch, hub: str('hub') });
    case 'new': return newPart(root, arg, { kind: str('kind') ?? 'mechanic', name: str('name'), from: str('from'), paths: positional.slice(3), uses: str('uses')?.split(',') });
    case 'check': return checkParts(root, arg ?? null, { write: true });
    case 'share': return arg ? sharePart(root, arg, true) : { ok: false, command: 'parts share', why: 'name the part to share' };
    case 'unshare': return arg ? sharePart(root, arg, false) : { ok: false, command: 'parts unshare', why: 'name the part to stop sharing' };
    case 'offer': {
      const p = readPart(partDir(root, arg)); const version = str('release');
      if (str('upgrade') && (!version || !['included', 'paid'].includes(str('upgrade')))) throw new Error('--upgrade included|paid requires --release');
      if (flags.has('keep-on-sale') && !version) throw new Error('--keep-on-sale requires --release');
      const file = join(root, 'parts', 'offers.json'); const offers = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
      const old = offers[arg] ?? {};
      const price = { ...old.price, ...(str('amount') ? { amount: Number(str('amount')) } : {}) };
      const problems = saleProblems({ ...p, sale: { ...p.sale, ...price } });
      if (problems.length) throw new Error(problems.join('; '));
      offers[arg] = { price, active: !version && flags.has('withdraw') ? false : flags.has('on-sale') ? true : old.active !== false, releases: { ...old.releases } };
      if (version) offers[arg].releases[version] = { ...old.releases?.[version], ...(flags.has('withdraw') ? { active: false } : flags.has('on-sale') ? { active: true } : {}), ...(flags.has('keep-on-sale') ? { keepOnSale: true } : {}), ...(str('upgrade') ? { upgrade: str('upgrade') } : {}) };
      writeFileSync(file, JSON.stringify(offers, null, 2) + '\n');
      return { ok: true, command: 'parts offer', message: 'Offer updated. Deploy to publish it. Existing purchase terms stay unchanged.' };
    }
    case 'test-access': {
      const { withKey } = await import('./office.mjs');
      return withKey(root, null, (call) => call('/_studio/api/shop/test-access', { order: arg }));
    }
    case 'recover': return prepareRecovery(root, arg, str('order'), str('game'));
    case 'reissue': {
      const { withKey } = await import('./office.mjs');
      return withKey(root, null, (call) => call('/_studio/api/shop/reissue', { order: arg, claimHash: str('claim-hash'), receiptVerified: flags.has('receipt-verified'), ...(str('buyer') ? { buyer: str('buyer') } : {}) }));
    }
    case 'keys': {
      const { generateKeyPair, exportJWK } = await import('jose');
      const { runner } = await import('./cloudflare.mjs');
      const { siteUrl } = await import('./studio.mjs');
      const url = siteUrl(root);
      let old = [];
      try { const r = await (fetch ?? globalThis.fetch)(`${url}/purchases/keys.json`); if (r.ok) old = (await r.json()).keys; else if (r.status !== 404 || !flags.has('initialize')) throw new Error('Cannot read keys; only an explicit --initialize accepts a missing endpoint'); } catch { throw new Error('Cannot read the current public key ring; restore connectivity before rotating'); }
      if (!Array.isArray(old) || old.length >= 32) throw new Error('Retain the existing ring. Its 32-key protocol limit requires an explicit key retirement before rotating again');
      const pair = await generateKeyPair('Ed25519', { extractable: true });
      const ring = [await exportJWK(pair.privateKey), ...old.map(({ kty, crv, x }) => ({ kty, crv, x }))];
      const r = runner(root)(['secret', 'put', 'PURCHASE_SIGNING_KEYS'], { input: JSON.stringify(ring) + '\n' });
      return { ok: r.code === 0, command: 'parts keys', message: 'The parts signing key is a Worker secret. Retained public keys verify earlier purchases.' };
    }
    case 'refund': return purchasePortal(root, arg, { game: str('game'), fetch, action: 'refund' });
    case 'retire': {
      const { withKey } = await import('./office.mjs');
      const result = await withKey(root, null, (call) => call('/_studio/api/shop/retire', { kind: 'part', resource: arg }));
      if (result.ok) sharePart(root, arg, false);
      return { ...result, command: 'parts retire' };
    }
    case 'manage': return purchasePortal(root, arg, { game: str('game'), fetch });
    case 'add': return arg ? addPart(root, arg, { fetch, ...(npm ? { npm } : {}), install: !flags.has('no-install'), approve: str('approve'), wallet: str('wallet'), quantity: str('quantity') ? Number(str('quantity')) : 1, offline: flags.has('offline'), say: log, game: str('game'), overwrite: flags.has('overwrite') }) : { ok: false, command: 'parts add', why: `name the part: "<studio site>/<part id>"\n${PARTS_ADD_USAGE}` };
    default: return { ok: false, command: 'parts', why: `"${sub}" is not a parts command: ${PARTS_VERBS.join(', ')}` };
  }
}

/* ------------------------------------------------------------------ plain lines */

const costWords = (c) => { const b = []; if (Number.isFinite(c?.bytes)) b.push(`${Math.max(1, Math.round(c.bytes / 1024))} KB`); if (Number.isFinite(c?.triangles)) b.push(`${c.triangles} triangles`); if (Number.isFinite(c?.drawCalls)) b.push(`${c.drawCalls} draws`); if (Number.isFinite(c?.textureMB)) b.push(`${c.textureMB} MB textures`); return b.join(', '); };
const buildsWords = (r) => [...Object.keys(r?.packages && typeof r.packages === 'object' ? r.packages : {}), ...(Array.isArray(r?.parts) ? r.parts.map((x) => `the part ${x}`) : [])].join(', ');
const issueLines = (issues) => issues.map((i) => `  ${i.level === 'conflict' ? 'CANNOT BE COMBINED' : i.level === 'warn' ? 'look' : 'note'} ${i.parts.join(' + ')}: ${i.problem}${i.fix ? `\n      ${i.fix}` : ''}`);
const packageLines = (rows) => rows.filter((p) => p.state !== 'ok').map((p) => (p.state === 'installed' ? `  npm installed ${p.name}@${p.range}, for ${p.by}` : p.state === 'missing' ? `  NOT INSTALLED ${p.name}@${p.range}: ${p.why} npm installs it with: ${p.command}` : `  ${p.state === 'pinned' ? 'PACKAGE DOES NOT FIT' : 'NPM FAILED'}: ${p.why}`));

function addLines(r) {
  const L = [];
  if (r.purchase?.offline) L.push('Restored from the verified private backup. Refund status is only last known; the seller was not contacted.');
  if (r.purchase?.mode === 'test') L.push('TEST purchase: this is not proof of a live payment.');
  if (r.was && r.same) L.push(`${r.ref} ${r.version} is already here and unchanged.`);
  else if (r.was) L.push(`${r.ref}: ${r.was} → ${r.version}. ${[r.changes.changed.length ? `changed: ${r.changes.changed.join(', ')}` : '', r.changes.added.length ? `new: ${r.changes.added.join(', ')}` : '', r.changes.removed.length ? `gone: ${r.changes.removed.join(', ')}` : ''].filter(Boolean).join('; ') || 'the same files'}. Your tuning.json was kept${r.replaced?.length ? `; REPLACED your edited ${r.replaced.join(', ')} as asked` : ''}.`);
  else L.push(`${r.name} ${r.version} (${r.kind}) from ${r.host} is in ${r.dir}: ${r.files} files, every one checked against its SHA-256. It is this studio's to tune now.`);
  if (r.from?.name || (r.from?.game ?? r.from?.app)) L.push(`  It came out of ${r.from.name ?? (r.from.game ?? r.from.app)}${r.from.studio ? ` by ${r.from.studio}` : ''}.`);
  L.push(`  Licence: ${r.license ?? 'NONE NAMED'} (asks ${r.asks ?? 'unknown'})${r.attribution ? `; credit: ${r.attribution}` : ''}`);
  if (r.credits?.length) L.push(`  Credited in ${r.credits.join(', ')}.`);
  else if (!r.game) L.push('  It is credited in a game\'s credits when that game imports it (the build does it).');
  if (r.import) L.push(`  Use it: import … from '${r.import}'`);
  L.push(...packageLines(r.packages ?? []));
  for (const n of r.needs ?? []) L.push(`  It needs another part, ${n.ref}: ${n.add}`);
  L.push(...issueLines(r.licences ?? []));
  return L;
}

export function partsLines(r) {
  const L = [];
  switch (r.command) {
    case 'parts find': {
      if (!r.hub.ok) L.push(r.hub.why, '');
      if (!r.results.length) L.push(r.hub.ok ? `No shared part matches${r.query ? ` "${r.query}"` : ''} (${r.searched.hub} in the catalogue, ${r.searched.here} in this studio). Write it; if it turns out reusable, it can become a part.` : 'Nothing in this studio matches.');
      for (const p of r.results) {
        L.push(`${p.name} (${p.kind}) ${p.version ?? ''} · ${p.license ?? 'no licence named'} · ${p.price ?? 'Free'} · ${p.where === 'hub' ? p.ref : p.where === 'here' ? `${p.ref} (already here)` : `${p.id} (this studio's own${p.share ? ', shared' : ', private'})`}`);
        if (p.summary) L.push(`  ${p.summary}`);
        if (p.from?.name || (p.from?.game ?? p.from?.app)) L.push(`  from ${p.from.name ?? (p.from.game ?? p.from.app)}${p.from.studio ? ` by ${p.from.studio}` : ''}`);
        const bits = [costWords(p.cost) && `costs ${costWords(p.cost)}`, buildsWords(p.requires) && `builds on ${buildsWords(p.requires)}`, p.rig && `rig ${p.rig}`, p.netplay && `in a room: ${p.netplay}`].filter(Boolean);
        if (bits.length) L.push(`  ${bits.join(' · ')}`);
        L.push(`  ${p.say}`);
      }
      break;
    }
    case 'parts new':
      L.push(`parts/${r.id} is a new ${r.kind} part (private).${r.lifted ? ` Lifted out of games/${r.from}: ${r.lifted.moved.length} module(s) moved${r.lifted.copied.length ? `, ${r.lifted.copied.length} other file(s) copied` : ''}.` : ''}`, ...r.next.map((n) => `  ${n}`));
      break;
    case 'parts check':
      for (const row of r.rows) {
        L.push(`${row.id}${row.version ? ` ${row.version}` : ''}: ${row.ok ? 'reads fine' : 'NOT A PART YET'}${row.share ? ', shared' : row.shareable ? ', could be shared' : ', private'}`);
        for (const p of row.problems) L.push(`  ${p.level === 'refuse' ? 'FIX ' : 'look'} ${p.field}: ${p.problem}${p.fix ? `\n      ${p.fix}` : ''}`);
        if (!row.shareable) { L.push('  Before it can be shared:'); for (const p of row.sharing) L.push(`    ${p.field}: ${p.problem}${p.fix ? `\n        ${p.fix}` : ''}`); }
      }
      for (const b of r.brought) L.push(`${b.ref}${b.version ? ` ${b.version}` : ''}: ${b.ok ? (b.edited.length ? `edited here (${b.edited.join(', ')}); a newer version will not replace them without being told to` : 'as fetched') : b.problem ?? `missing ${b.missing.join(', ')}`}${b.fix ? `\n      ${b.fix}` : ''}`);
      if (!r.rows.length && !r.brought.length) L.push('No parts here yet.');
      break;
    case 'parts share':
      L.push(`parts/${r.id} ${r.version} is shared under ${r.license} (asks ${r.asks}).`, r.effect);
      break;
    case 'parts unshare':
      L.push(`parts/${r.id} is private.`, r.effect);
      break;
    case 'parts add':
      L.push(...addLines(r));
      break;
    default:
      L.push(JSON.stringify(r));
  }
  return L;
}
