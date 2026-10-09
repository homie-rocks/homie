import { payWithWallet } from './purchase-wallet.mjs';
/** Buyer purchase records and pristine backups never belong in public source or game bundles. */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest, manifestHash, verifyGrant } from "../worker/purchase-crypto.mjs";
import { priceWords } from "../worker/purchase-pricing.mjs";
import { quoteHash } from "../worker/parts-sale.mjs";
import { checkPart, parseRef, sha256 } from './parts.mjs';

const directory = (root) => join(root, '.homie', 'paid-parts');
const recordName = (ref, game) => sha256(`${ref}\n${game ?? ''}`);
function privateWrite(root, path, value) {
  mkdirSync(directory(root), { recursive: true, mode: 0o700 });
  const ignore = join(root, '.gitignore');
  const text = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
  if (!text.split('\n').includes('/.homie/paid-parts/')) writeFileSync(ignore, `${text}${text && !text.endsWith('\n') ? '\n' : ''}/.homie/paid-parts/\n`);
  writeFileSync(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 }); chmodSync(`${path}.tmp`, 0o600); renameSync(`${path}.tmp`, path);
}
function read(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
const recordPath = (root, ref, game) => join(directory(root), `${recordName(ref, game)}.json`);
export async function purchaseFetch(url, { fetch: f = globalThis.fetch, method = 'GET', body, authorization, max = 1024 * 1024 } = {}) {
  const r = await f(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(authorization ? { authorization: `Bearer ${authorization}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const reader = r.body?.getReader(); let count = 0; const chunks = [];
  if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; count += value.length; if (count > max) { await reader.cancel(); throw new Error('Purchase response exceeds its size limit'); } chunks.push(value); }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new Error(`Purchase service answered ${r.status} without JSON`); }
  return { status: r.status, data };
}
function purchaseNeeded(purchase) {
  const error = new Error(purchase.message); error.purchase = purchase; throw error;
}

/** Request payment from the existing wallet only for the approved immutable quote. */
export async function paidAccess(root, ref, part, { game = null, quantity = 1, approve = null, fetch, offer = part.sale, wallet, walletPay = payWithWallet } = {}) {
  game = offer.scope === 'game' ? game : null;
  const origin = `https://${ref.host}`; const hash = await manifestHash(part); const quote = await quoteHash(part, quantity, game, offer); const path = recordPath(root, ref.ref, game);
  let record = read(path);
  let exchange;
  if (record?.recovery) {
    const recovered = await purchaseFetch(`${origin}/api/purchases/recover`, { fetch, method: 'POST', authorization: record.claim, body: {} });
    if (!recovered.data.ok || recovered.data.order !== record.order) throw new Error('Seller has not reissued this purchase yet');
    const r = recovered.data;
    record = { ...record, recovery: false, buyer: r.buyer, quantity: r.quantity, game: r.game, version: r.manifest.version, manifestHash: await manifestHash(r.manifest), quote: await quoteHash(r.manifest, r.quantity, r.game), price: priceWords(r.manifest.sale, r.quantity) };
    privateWrite(root, recordPath(root, ref.ref, r.game), record);
  }
  if (!record) {
    if (approve !== quote) purchaseNeeded({ required: true, quote, part: ref.ref, version: part.version, price: priceWords(offer, quantity), sale: offer, licence: part.license, terms: `${origin}/parts/${ref.id}/${part.version}/${part.licenseTerms}`, quantity, game, message: `Ask first: ${part.name} from ${ref.host}, ${priceWords(offer, quantity)}. Show the licence, refund and recurring terms. Only authority for this exact price permits requesting payment through the person’s wallet; Checkout is the fallback.` });
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Quantity must be a positive whole number');
    if (offer.scope === 'game' && !game) throw new Error('This licence needs the game being licensed');
    const identityPath = join(directory(root), 'identity.json'); let identity = read(identityPath);
    if (!identity) { identity = { buyer: randomBytes(32).toString('hex') }; privateWrite(root, identityPath, identity); }
    record = { createdAt: Date.now(), buyer: identity.buyer, buyerName: String(read(join(root, 'studio.json'))?.name ?? 'Buying studio').slice(0, 80), claim: randomBytes(32).toString('hex'), quote, manifestHash: hash, version: part.version, price: priceWords(offer, quantity), quantity, game, origin, ref: ref.ref };
    privateWrite(root, path, record);
  }
  if (!record.order) {
    // A retry of a previously approved intent is bound to its original quote and quantity.
    if ((record.quote !== quote || record.quantity !== quantity) && approve === quote) { privateWrite(root, path, null); return paidAccess(root, ref, part, { game, quantity, approve, fetch, offer, wallet, walletPay }); }
    if (record.quote !== quote || record.quantity !== quantity) purchaseNeeded({ required: true, quote, price: priceWords(offer, quantity), message: 'Price, terms or quantity changed. Approve the new quote with a new purchase record.' });
    if (offer.billing === 'one-time' && offer.currency === 'usd' && !offer.automaticTax && offer.taxBehavior !== 'exclusive' && (wallet || process.env.HOMIE_PARTS_WALLET)) {
      const paid = await walletPay(`${origin}/api/purchases/resource`, { kind: 'part', resource: part.id, version: part.version, buyer: record.buyer, claim: record.claim, quote, quantity, game, amount: offer.amount * quantity }, { client: wallet, pending: record.walletPending });
      if (paid?.pending) {
        record.walletPending = paid.pending; privateWrite(root, path, record);
        purchaseNeeded({ required: true, wallet: paid.approval, quote, price: priceWords(offer, quantity), message: 'Approve this spend in your wallet app, then call part_add again. The wallet controls authority and limits.' });
      }
      record.walletPending = null;
      privateWrite(root, path, record);
      if (paid?.data?.order) {
        exchange = paid.data;
        record.order = paid.data.order; privateWrite(root, path, record);
      } else {
        const reason = paid?.data?.detail ?? paid?.data?.message ?? 'The wallet could not complete this payment';
        if (paid?.uncertain || /Settlement|recording|processing|do not pay again/i.test(reason)) throw new Error(reason);
        record.walletUnavailable = reason;
        // Retain this private claim so a corrected wallet can retry it.
        privateWrite(root, path, record);
        if (!paid?.data?.checkout) purchaseNeeded({ required: true, quote, price: priceWords(offer, quantity), walletUnavailable: reason, machine: `${origin}/api/purchases/resource`, message: `${reason}. Retry part_add with the corrected wallet, or omit wallet to choose the hosted Checkout fallback. No payment was confirmed.` });
      }
    }
    if (!record.order) {
    if (record.walletUnavailable) { record.claim = randomBytes(32).toString('hex'); privateWrite(root, path, record); }
    const { status, data } = await purchaseFetch(`${origin}/api/purchases/intent`, { fetch, method: 'POST', body: { kind: 'part', resource: part.id, version: part.version, buyer: record.buyer, buyerName: record.buyerName, claimHash: await digest(record.claim), quote, quantity: record.quantity, game } });
    if (status !== 200 || !data.ok) throw new Error(data.message ?? 'Purchase could not be prepared');
    if (new URL(data.url).origin !== origin) throw new Error('Purchase URL is not on the seller origin');
    record.order = data.order; record.url = data.url; privateWrite(root, path, record);
    purchaseNeeded({ required: true, checkout: record.url, price: priceWords(offer, quantity), message: `${record.walletUnavailable ? record.walletUnavailable + ". " : ""}Machine payments are also available: name link-cli or purl as the wallet before starting Checkout. Hosted Checkout fallback: the person opens ${record.url}, reads the licence and pays on Stripe. Then call part_add again. Nothing has been charged by the assistant.` });
    }
  }
  const { status, data } = exchange ? { status: 200, data: exchange } : await purchaseFetch(`${origin}/api/purchases/grant`, { fetch, method: 'POST', authorization: record.claim, body: { version: part.version } });
  if (status !== 200 || !data.ok) {
    if (status === 401 && record.createdAt && Date.now() - record.createdAt > (offer.intentMinutes ?? 30) * 60000) data.status = 'expired';
    if (approve === quote && ((status === 401 && quote !== record.quote) || (status === 403 && quote !== record.quote) || ['expired', 'failed', 'refunded', 'lost'].includes(data.status))) {
      privateWrite(root, join(directory(root), `${recordName(ref.ref, game)}-${record.order}.purchase.json`), record);
      privateWrite(root, path, null);
      return paidAccess(root, ref, part, { game, quantity, approve, fetch, offer, wallet, walletPay });
    }
    if (data.status) record.status = data.status;
    if (data.paidUntil !== undefined) record.paidUntil = data.paidUntil;
    record.checkedAt = new Date().toISOString(); privateWrite(root, path, record);
    purchaseNeeded({ required: true, checkout: record.url, status: record.status, quote, price: priceWords(offer, quantity), sale: offer, licence: part.license, terms: `${origin}/parts/${ref.id}/${part.version}/${part.licenseTerms}`, message: data.message ?? 'Finish the purchase on Stripe, then call part_add again' });
  }
  const { calculateJwkThumbprint, decodeProtectedHeader } = await import('jose');
  let jwk = record.jwk;
  if (!jwk || decodeProtectedHeader(data.token).kid !== await calculateJwkThumbprint(jwk)) {
    const keys = await purchaseFetch(`${origin}/purchases/keys.json`, { fetch });
    if (keys.status !== 200 || !Array.isArray(keys.data.keys) || !keys.data.keys.length) throw new Error('The seller supplied no unambiguous signing key');
    jwk = keys.data.keys.find((k) => k.kid === decodeProtectedHeader(data.token).kid);
    if (!jwk) throw new Error('Seller key is not in its HTTPS key ring');
  }
  const claims = await verifyGrant(data.token, jwk, { issuer: origin, subject: record.buyer, kind: 'part', resource: part.id, version: part.version });
  if (claims.manifest !== hash || await manifestHash(data.manifest) !== hash || (part.version === record.version && hash !== record.manifestHash) || claims.jti !== record.order || (claims.quantity !== record.quantity && claims.billing === 'one-time') || claims.game !== record.game || (record.mode && record.mode !== claims.mode)) throw new Error('The signed licence differs from the approved purchase');
  const evidence = await verifyGrant(data.proof, jwk, { proof: true, issuer: origin, subject: record.buyer, kind: 'part', resource: part.id, version: part.version });
  if (evidence.manifest !== claims.manifest || evidence.jti !== claims.jti) throw new Error('Purchase evidence does not match the download');
  record = { ...record, trustedKeys: [...new Map([...(record.trustedKeys ?? []), ...(record.jwk ? [record.jwk] : []), jwk].map((k) => [k.x, k])).values()], quantity: claims.quantity, paidUntil: claims.paidUntil, jwk, token: data.token, proof: data.proof, mode: claims.mode, status: 'paid', checkedAt: new Date().toISOString() }; privateWrite(root, path, record);
  return { token: data.token, proof: data.proof, claims, jwk, record, files: exchange?.files };
}

export function savePurchaseBackup(root, got, access, game) {
  game = access.claims.game;
  const path = recordPath(root, got.ref.ref, game); const record = read(path);
  // One JSON archive retains exact bytes, including files the buyer later edits. Its token is private.
  const archive = { ref: got.ref, part: got.part, entry: got.entry, base: got.base, version: got.version, versions: got.versions, token: access.proof, jwk: access.jwk, buyer: record.buyer, files: [...got.files].map(([path, bytes]) => [path, bytes.toString('base64')]) };
  const name = `${recordName(got.ref.ref, game)}-${got.version}.backup.json`;
  privateWrite(root, join(directory(root), name), archive);
  record.backup = name; privateWrite(root, path, record);
}
export async function offlinePurchase(root, refText, game) {
  const ref = parseRef(refText); if (!ref) throw new Error('Name a part');
  const record = read(recordPath(root, ref.ref, game)) ?? read(recordPath(root, ref.ref, null));
  game = record?.game;
  const name = ref.version ? `${recordName(ref.ref, game)}-${ref.version}.backup.json` : record?.backup;
  const backup = name ? read(join(directory(root), name)) : null;
  if (!backup) throw new Error('No private purchase backup for this part and game');
  if (backup.ref?.ref !== ref.ref || backup.ref?.host !== ref.host || backup.ref?.id !== ref.id || backup.version !== backup.part?.version || backup.base !== record.origin) throw new Error('Purchase backup identifies another release');
  if (![...(record.trustedKeys ?? []), record.jwk].some((key) => key?.x === backup.jwk?.x)) throw new Error('Archive key is not a pinned seller key');
  const claims = await verifyGrant(backup.token, backup.jwk, { proof: true, issuer: backup.base, subject: backup.buyer, kind: 'part', resource: ref.id, version: backup.version });
  if (!checkPart(backup.part).ok || claims.manifest !== await manifestHash(backup.part)) throw new Error('Purchase backup manifest failed verification');
  if (record.status === 'refunded' || record.status === 'lost') { if (claims.onRefund === 'terminate') throw new Error('This purchase was revoked under its refund terms'); }
  if (claims.paidUntil && claims.paidUntil <= Date.now() && claims.onExpiry === 'terminate') throw new Error('This subscription licence has expired');
  const files = new Map(backup.files.map(([path, bytes]) => [path, Buffer.from(bytes, 'base64')]));
  if (files.size !== backup.part.files.length || files.size !== backup.files.length) throw new Error('Purchase backup contains unlisted files');
  for (const f of backup.part.files) if (!files.has(f.path) || files.get(f.path).length !== f.bytes || sha256(files.get(f.path)) !== f.sha256) throw new Error('Purchase backup files failed verification');
  return { ...backup, files, purchase: { version: claims.version, mode: claims.mode, scope: claims.terms.scope, game: claims.game, quantity: claims.quantity, paidUntil: claims.paidUntil, onExpiry: claims.onExpiry, onRefund: claims.onRefund, checkedAt: record.checkedAt, offline: true, status: record.status } };
}
export async function purchasePortal(root, refText, { game = null, fetch, action = 'portal' } = {}) {
  const ref = parseRef(refText); const record = ref && (read(recordPath(root, ref.ref, game)) ?? read(recordPath(root, ref.ref, null)));
  if (!record?.order && action === 'portal' && ref) {
    const { status, data } = await purchaseFetch(`https://${ref.host}/api/purchases/portal-login`, { fetch });
    if (status !== 200) throw new Error(data.message);
    return { ...data, command: 'parts manage' };
  }
  if (!record?.order) throw new Error('No purchase here to manage');
  const { status, data } = await purchaseFetch(`${record.origin}/api/purchases/${action}`, { fetch, method: 'POST', authorization: record.claim, body: {} });
  if (status !== 200) throw new Error(data.message ?? 'Stripe portal unavailable');
  if (action === 'refund') return { ...data, command: 'parts refund' };
  return { ok: true, command: 'parts manage', url: data.url, message: `Open ${data.url} to manage or cancel this subscription in Stripe.` };
}

/** Last checked state for publish reports; private credentials never leave this module. */
export function purchaseFacts(root, ref, game) {
  const r = read(recordPath(root, ref, game)) ?? read(recordPath(root, ref, null));
  return r ? { status: r.status, paidUntil: r.paidUntil, checkedAt: r.checkedAt } : {};
}

/** Prepare a recovery request without giving the seller the new claim secret. */
export function prepareRecovery(root, refText, order, game = null) {
  const ref = parseRef(refText);
  if (!ref || !/^ord_[A-Za-z0-9]{20}$/.test(order ?? '')) throw new Error('Supply the part and order from the receipt or seller');
  const existing = read(recordPath(root, ref.ref, game)) ?? read(recordPath(root, ref.ref, null));
  if (existing?.claim && !existing.recovery) return { ok: false, command: 'parts recover', message: 'A healthy purchase claim already exists; keep it and run parts add' };
  const claim = randomBytes(32).toString('hex');
  privateWrite(root, recordPath(root, ref.ref, game), { claim, order, origin: `https://${ref.host}`, ref: ref.ref, game, recovery: true });
  return digest(claim).then((claimHash) => ({ ok: true, command: 'parts recover', order, claimHash, message: 'Give the seller this order and claimHash with your Stripe receipt. After reissue, run parts add again. Keep this private purchase folder.' }));
}
