/** A published part release is one purchasable resource kind. */
import { quoteHash, legalTerms, coversRelease, compareVersions, saleProblems, objectKey, releaseKey } from "./parts-sale.mjs";
export const partResource = Object.freeze({
  async list(env, origin) {
    const response = await env.ASSETS.fetch(new Request(`${origin}/parts/index.json`));
    if (!response.ok) return [];
    return ((await response.json()).parts ?? []).flatMap((p) => (p.releases ?? []).filter((r) => r.onSale && r.offer).map((r) => ({ id:p.id, name:p.name, version:r.version, offer:r.offer, offerVersion:r.offerVersion })));
  },
  async get(env, id, version) {
    const object = await env.PURCHASE_MEDIA?.get(releaseKey(id,version));
    return object ? object.json() : null;
  },
  quote: quoteHash,
  terms: legalTerms,
  validate(resource, selection) {
    const errors = saleProblems(resource);
    if (!selection) return errors;
    const { quantity, game } = selection;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(quantity * resource.sale.amount)) errors.push('Invalid quantity');
    if ((resource.sale.scope === 'game' && !/^[a-z0-9][a-z0-9-]{0,47}$/.test(game ?? '')) || (resource.sale.scope !== 'game' && game != null)) errors.push('Invalid game scope');
    return errors;
  },
  termsUrl: (resource) => `/parts/${encodeURIComponent(resource.id)}/${encodeURIComponent(resource.version)}/${resource.licenseTerms.split('/').map(encodeURIComponent).join('/')}`,
  readFile: (env,file,{head=false}={}) => head && env.PURCHASE_MEDIA?.head ? env.PURCHASE_MEDIA.head(objectKey(file.sha256)) : env.PURCHASE_MEDIA?.get(objectKey(file.sha256)),
  async covers(env,origin,bought,wanted) {
    if (coversRelease(bought,wanted)) return true;
    const response = await env.ASSETS.fetch(new Request(`${origin}/parts/index.json`));
    if (!response.ok) return false;
    const release = (await response.json()).parts?.find((p)=>p.id===wanted.id)?.releases?.find((r)=>r.version===wanted.version);
    return compareVersions(wanted.version,bought.version)>=0 && release?.upgrade==='included';
  },
});
