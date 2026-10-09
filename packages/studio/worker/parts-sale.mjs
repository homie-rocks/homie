import { amountError } from './shop-rules.mjs';
import { digest, manifestHash } from "./purchase-crypto.mjs";
/** Paid-part metadata shared by the builder, buyer and Worker. No payment policy ceilings. */
import { canonicalJson } from './referrals.mjs';

export const quoteHash = async (part, quantity = 1, game = null, offer = part.sale) => digest(canonicalJson({ manifest: await manifestHash(part), part: part.id, release: part.version, scope: offer.scope, quantity, game, interval: offer.billing, currency: offer.currency, amount: offer.amount * quantity, offer }));
export const legalTerms = (p) => ({ license: p.license, terms: p.files?.find((f) => f.path === p.licenseTerms)?.sha256, scope: p.sale?.scope, source: p.sale?.source, commercialUse: p.sale?.commercialUse, transferable: p.sale?.transferable, onRefund: p.sale?.onRefund, onExpiry: p.sale?.onExpiry, refund: p.sale?.refund, updates: p.sale?.updates });
export const sameTerms = (a, b) => canonicalJson(legalTerms(a)) === canonicalJson(legalTerms(b));
export const publicFiles = (p) => new Set([p.preview?.page, p.preview?.image, p.licenseTerms, ...(p.files ?? []).filter((f) => /^LICENSES\/[^/]+\.txt$/.test(f.path)).map((f) => f.path), ...(p.sale?.publicFiles ?? [])].filter(Boolean));
export const objectKey = (hash) => `paid-parts/files/${hash}`;
export const releaseKey = (id, version) => `paid-parts/releases/${id}/${version}.json`;

export function saleProblems(p) {
  if (p.sale === undefined) return [];
  const s = p.sale; const errors = [];
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['sale must be an object'];
  const invalidAmount = amountError(s.amount, s.currency);
  if (invalidAmount) errors.push(invalidAmount);
  if (!Intl.supportedValuesOf('currency').map((v) => v.toLowerCase()).includes(s.currency) || /^(xau|xag|xpt|xpd|xxx|xts)$/.test(s.currency)) errors.push('currency must be a lower-case ISO currency code');
  if (s.taxBehavior !== undefined && !['inclusive', 'exclusive', 'unspecified'].includes(s.taxBehavior)) errors.push('taxBehavior must be inclusive, exclusive or unspecified');
  for (const key of ['immediateDelivery', 'automaticTax', 'adaptivePricing', 'promotionCodes', 'refundEndsSubscription', 'invoiceCreation', 'customerCreation', 'taxIdCollection']) if (s[key] !== undefined && typeof s[key] !== 'boolean') errors.push(`${key} must be true or false`);
  if (s.refundWindowDays !== undefined && (!Number.isFinite(s.refundWindowDays) || s.refundWindowDays < 0)) errors.push('refundWindowDays must be a non-negative finite number');
  if (s.renewalGraceMinutes !== undefined && (!Number.isFinite(s.renewalGraceMinutes) || s.renewalGraceMinutes < 0)) errors.push('renewalGraceMinutes must be a non-negative finite number');
  if (s.intentMinutes !== undefined && (!Number.isFinite(s.intentMinutes) || s.intentMinutes <= 0)) errors.push('intentMinutes must be a positive finite number');
  for (const [key, values] of Object.entries({ billing: ['one-time', 'day', 'week', 'month', 'year'], updates: ['none', 'major', 'all'], onRefund: ['retain', 'terminate'], onExpiry: ['retain', 'terminate'] })) if (!values.includes(s[key])) errors.push(`${key} must be ${values.join(', ')}`);
  if (typeof s.scope !== 'string' || !s.scope.trim()) errors.push('scope must describe the licensed use');
  for (const key of ['source', 'commercialUse', 'transferable']) if (typeof s[key] !== 'boolean') errors.push(`${key} must be true or false`);
  if (typeof s.refund !== 'string' || !s.refund.trim()) errors.push('refund must state the seller refund terms');
  if ((s.taxCode !== undefined || s.automaticTax === true) && !/^txcd_\d{8}$/.test(s.taxCode ?? '')) errors.push('taxCode must name the Stripe product tax code');
  if (!p.licenseTerms || !p.files?.some((f) => f.path === p.licenseTerms)) errors.push('licenseTerms must name a hashed file containing the full licence');
  if (s.publicFiles !== undefined && (!Array.isArray(s.publicFiles) || s.publicFiles.some((path) => !p.files?.some((f) => f.path === path)))) errors.push('publicFiles must list only hashed files deliberately offered before purchase');
  return errors;
}

export function coversRelease(bought, wanted) {
  if (bought.id !== wanted.id) return false;
  if (bought.version === wanted.version) return true;
  if (bought.version.includes('-') || wanted.version.includes('-')) return false;
  if (compareVersions(wanted.version, bought.version) < 0) return false;
  return bought.sale.updates === 'all' || (bought.sale.updates === 'major' && wanted.version.split('.')[0] === bought.version.split('.')[0]);
}

/** Semver precedence, including numeric versus text prerelease identifiers. */
export function compareVersions(a, b) {
  const parse = (v) => { const dash = v.indexOf('-'); const core = dash < 0 ? v : v.slice(0, dash); const pre = dash < 0 ? undefined : v.slice(dash + 1); return { core: core.split('.').map(Number), pre: pre?.split('.') }; };
  const left = parse(a); const right = parse(b);
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1;
  if (!left.pre || !right.pre) return left.pre ? -1 : right.pre ? 1 : 0;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i]; const y = right.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x); const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
