/**
 * THE STRUCTURED-DATA CHECK (0.27.0): every `<script type="application/ld+json">` block of a page, read the way a
 * search engine reads it, and held to two bars.
 *
 *   errors   the block is not valid JSON, has no schema.org @context, names a type or a property schema.org does
 *            not have (schema-vocab.json, written from schema.org's own release file by scripts/schema-vocab.mjs),
 *            puts a property on a type it is not for, or gives a value of the wrong kind (a date that is not ISO
 *            8601, a duration that is not PT…, a type the property does not take, an enumeration member that is not
 *            one of its enumeration's).
 *   google   what Google Search Central documents as required for the result each type can get: VideoGame (as a
 *            Software App: name and offers.price, co-typed with another app type), VideoObject (name, thumbnailUrl,
 *            uploadDate), BreadcrumbList (each ListItem's position and name, and its item except the last's),
 *            ItemList (each ListItem's position and url), and the fields Homie holds itself to where Google requires
 *            none (BlogPosting and every other Article: headline, datePublished, author.name; Organization: name, url;
 *            MusicRecording: name, url, byArtist).
 *   notes    what is true and not a fault: a Software App is shown as a rich result only with ratings or reviews,
 *            which Homie never invents.
 *
 *   import { checkHtml, checkJsonLd } from '@homie-rocks/studio/lib/schema-check.mjs'  (or a relative path)
 *   checkHtml(html) -> { blocks, errors, google, notes }
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let vocabulary = null;
/** schema.org's vocabulary, as scripts/schema-vocab.mjs wrote it beside this file. */
export function vocab() {
  vocabulary ??= JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema-vocab.json'), 'utf8'));
  return vocabulary;
}

const DATATYPES = new Set(['Text', 'URL', 'Number', 'Integer', 'Float', 'Boolean', 'Date', 'DateTime', 'Time', 'CssSelectorType', 'XPathType', 'PronounceableText', 'Duration', 'DataType']);
const ISO_DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DURATION = /^P(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;
const ABS_URL = /^https?:\/\/[^\s<>"]+$/i;
const SCHEMA = /^https?:\/\/schema\.org\/?$/;

/** The JSON-LD blocks of a page: [{ text, value }] (value undefined when the block is not JSON). */
export function jsonLdBlocks(html) {
  const out = [];
  const re = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(String(html ?? '')); m; m = re.exec(String(html ?? ''))) {
    let value;
    try { value = JSON.parse(m[1]); } catch { value = undefined; }
    out.push({ text: m[1], value });
  }
  return out;
}

const typesOf = (node) => (Array.isArray(node['@type']) ? node['@type'] : node['@type'] ? [node['@type']] : []).map((t) => String(t).replace(/^https?:\/\/schema\.org\//, '').replace(/^schema:/, ''));

/** A type and every type above it. */
function lineage(type, v = vocab()) {
  const seen = new Set();
  const walk = (t) => { if (seen.has(t)) return; seen.add(t); for (const p of v.types[t] ?? []) walk(p); };
  walk(type);
  return seen;
}
const isA = (type, want, v) => lineage(type, v).has(want);

function checkValue(prop, value, ranges, at, errors, v) {
  if (value === null || value === undefined) { errors.push(`${at}: ${prop} is empty`); return; }
  const allowsText = ranges.some((r) => r === 'Text' || r === 'PronounceableText' || r === 'CssSelectorType' || r === 'XPathType');
  const numeric = ranges.some((r) => r === 'Number' || r === 'Integer' || r === 'Float');
  const onlyData = ranges.every((r) => DATATYPES.has(r));
  const want = ranges.join(' or ');
  if (typeof value === 'object') {
    const types = typesOf(value);
    if (!types.length) {
      if (!value['@id']) errors.push(`${at}: ${prop} is an object with no @type`);
      return;
    }
    if (onlyData) { errors.push(`${at}: ${prop} takes ${want}, not a ${types.join('/')}`); return; }
    if (!types.some((t) => ranges.some((r) => r === 'Thing' || isA(t, r, v)))) errors.push(`${at}: ${prop} takes ${want}, not a ${types.join('/')}`);
    return;
  }
  if (typeof value === 'boolean') {
    if (!ranges.includes('Boolean')) errors.push(`${at}: ${prop} takes ${want}, not true or false`);
    return;
  }
  if (typeof value === 'number') {
    if (!numeric && !ranges.includes('QuantitativeValue')) errors.push(`${at}: ${prop} takes ${want}, not a number`);
    else if (ranges.includes('Integer') && !ranges.includes('Number') && !Number.isInteger(value)) errors.push(`${at}: ${prop} is a whole number`);
    return;
  }
  const s = String(value);
  // An enumeration's member, by its schema.org address.
  const enums = ranges.filter((r) => v.types[r] && isA(r, 'Enumeration', v));
  const member = /^https?:\/\/schema\.org\/([A-Za-z0-9]+)$/.exec(s)?.[1];
  if (enums.length && member && v.members[member]) {
    if (!v.members[member].some((e) => enums.some((r) => isA(e, r, v)))) errors.push(`${at}: ${prop} "${s}" is not one of ${enums.join(' or ')}`);
    return;
  }
  if (ranges.includes('DateTime') || ranges.includes('Date')) {
    if (ISO_DATE.test(s) || ISO_DATETIME.test(s)) return;
    if (!allowsText) { errors.push(`${at}: ${prop} "${s.slice(0, 40)}" is not an ISO 8601 date`); return; }
  }
  if (ranges.includes('Duration')) {
    if (ISO_DURATION.test(s)) return;
    if (!allowsText) { errors.push(`${at}: ${prop} "${s.slice(0, 40)}" is not an ISO 8601 duration (PT1M5S)`); return; }
  }
  if (numeric && /^-?\d+(?:\.\d+)?$/.test(s)) return;
  if (allowsText) return;
  // A URL, or a thing given by its address.
  if (ABS_URL.test(s)) return;
  if (enums.length) { errors.push(`${at}: ${prop} "${s.slice(0, 60)}" is not a member of ${enums.join(' or ')} (https://schema.org/<Member>)`); return; }
  errors.push(`${at}: ${prop} takes ${want}, not "${s.slice(0, 60)}"`);
}

/** Every node, depth first, with where it is: [{ node, at, depth, via }]. */
function nodesOf(value, at = '$', depth = 0, via = null, out = []) {
  if (Array.isArray(value)) { value.forEach((x, i) => nodesOf(x, `${at}[${i}]`, depth, via, out)); return out; }
  if (!value || typeof value !== 'object') return out;
  out.push({ node: value, at, depth, via });
  for (const [k, x] of Object.entries(value)) {
    if (k === '@context') continue;
    if (k === '@graph') { nodesOf(x, `${at}.@graph`, depth, null, out); continue; }
    if (x && typeof x === 'object') nodesOf(x, `${at}.${k}`, depth + 1, k, out);
  }
  return out;
}

/** One block's value: { errors, google, notes }. */
export function checkJsonLd(value) {
  const v = vocab();
  const errors = [];
  const google = [];
  const notes = [];
  const tops = Array.isArray(value) ? value : [value];
  for (const top of tops) {
    if (!top || typeof top !== 'object') { errors.push('$: a block is a JSON object (or a list of them)'); continue; }
    if (!SCHEMA.test(String(top['@context'] ?? ''))) errors.push(`$: @context is "https://schema.org" (it is ${JSON.stringify(top['@context'] ?? null)})`);
  }
  for (const { node, at, depth, via } of tops.flatMap((t) => nodesOf(t))) {
    const types = typesOf(node);
    if (node['@id'] !== undefined && !(typeof node['@id'] === 'string' && (ABS_URL.test(node['@id']) || node['@id'].startsWith('#')))) errors.push(`${at}: @id is an absolute URL`);
    const keys = Object.keys(node).filter((k) => !k.startsWith('@'));
    if (!types.length) {
      if (keys.length && !node['@graph'] && !node['@id']) errors.push(`${at}: an object with properties has a @type`);
      if (!keys.length) continue;
    }
    for (const t of types) if (!v.types[t]) errors.push(`${at}: "${t}" is not a schema.org type`);
    const known = types.filter((t) => v.types[t]);
    const lines = new Set(known.flatMap((t) => [...lineage(t, v)]));
    for (const k of keys) {
      const p = v.props[k];
      if (!p) { errors.push(`${at}: "${k}" is not a schema.org property`); continue; }
      const [domains, ranges, superseded] = p;
      if (known.length && !domains.some((d) => lines.has(d))) errors.push(`${at}: "${k}" is not a property of ${known.join('/')} (it is for ${domains.join(', ')})`);
      if (superseded) errors.push(`${at}: "${k}" is superseded by "${superseded}"`);
      for (const x of Array.isArray(node[k]) ? node[k] : [node[k]]) checkValue(k, x, ranges, at, errors, v);
    }
    // Google's bar: what the result each type can get requires. Top-level nodes, and every video.
    const top = depth === 0;
    const has = (k) => node[k] !== undefined && node[k] !== null && node[k] !== '' && !(Array.isArray(node[k]) && !node[k].length);
    if (top && known.some((t) => isA(t, 'SoftwareApplication', v))) {
      if (!has('name')) google.push(`${at}: a ${known.join('/')} has a name`);
      const offers = Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : [];
      if (!offers.length || offers.some((o) => o.price === undefined)) google.push(`${at}: a ${known.join('/')} has offers.price (0 when it is free)`);
      if (known.includes('VideoGame') && known.length < 2) google.push(`${at}: Google shows no Software App result for a bare VideoGame; co-type it (["VideoGame", "WebApplication"])`);
      if (!has('aggregateRating') && !has('review')) notes.push(`${at}: a Software App is shown as a rich result only with aggregateRating or review; none is given (Homie never invents one)`);
    }
    if (known.some((t) => isA(t, 'VideoObject', v)) && (top || via === 'trailer' || via === 'video')) {
      for (const k of ['name', 'thumbnailUrl', 'uploadDate']) if (!has(k)) google.push(`${at}: a VideoObject has ${k}`);
      if (has('uploadDate') && /T\d/.test(node.uploadDate) && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(node.uploadDate)) google.push(`${at}: uploadDate has a time zone`);
    }
    if (top && known.some((t) => isA(t, 'BreadcrumbList', v))) {
      const items = node.itemListElement ?? [];
      if (!items.length) google.push(`${at}: a BreadcrumbList has itemListElement`);
      items.forEach((li, i) => {
        if (li?.position !== i + 1) google.push(`${at}.itemListElement[${i}]: position is ${i + 1}`);
        if (!li?.name) google.push(`${at}.itemListElement[${i}]: a breadcrumb has a name`);
        if (i < items.length - 1 && !li?.item) google.push(`${at}.itemListElement[${i}]: a breadcrumb before the last has an item`);
      });
    }
    if (top && known.some((t) => isA(t, 'ItemList', v) && !isA(t, 'BreadcrumbList', v))) {
      (node.itemListElement ?? []).forEach((li, i) => {
        if (li?.position !== i + 1) google.push(`${at}.itemListElement[${i}]: position is ${i + 1}`);
        if (!li?.url && !li?.item) google.push(`${at}.itemListElement[${i}]: a list item has a url`);
      });
    }
    if (top && known.some((t) => isA(t, 'Article', v))) {
      if (!has('headline')) google.push(`${at}: an article has a headline`);
      if (has('headline') && String(node.headline).length > 110) google.push(`${at}: a headline is at most 110 characters`);
      if (!has('datePublished')) google.push(`${at}: an article has datePublished`);
      const authors = Array.isArray(node.author) ? node.author : node.author ? [node.author] : [];
      if (!authors.length || authors.some((a) => !a?.name)) google.push(`${at}: an article's author has a name`);
    }
    if (top && known.some((t) => t === 'Organization' || isA(t, 'Organization', v)) && !known.some((t) => isA(t, 'CreativeWork', v))) {
      if (!has('name')) google.push(`${at}: an Organization has a name`);
      if (!has('url')) google.push(`${at}: an Organization has a url`);
    }
    if (top && known.some((t) => isA(t, 'MusicRecording', v))) {
      for (const k of ['name', 'url', 'byArtist']) if (!has(k)) google.push(`${at}: a MusicRecording has ${k}`);
    }
  }
  return { errors, google, notes };
}

/** Every JSON-LD block of a page, checked. */
export function checkHtml(html) {
  const blocks = jsonLdBlocks(html);
  const errors = [];
  const google = [];
  const notes = [];
  blocks.forEach((b, i) => {
    if (b.value === undefined) { errors.push(`block ${i + 1}: not valid JSON`); return; }
    const r = checkJsonLd(b.value);
    errors.push(...r.errors.map((e) => `block ${i + 1} ${e}`));
    google.push(...r.google.map((e) => `block ${i + 1} ${e}`));
    notes.push(...r.notes.map((e) => `block ${i + 1} ${e}`));
  });
  return { blocks: blocks.map((b) => b.value), errors, google, notes };
}

/** The types a page's blocks declare, top-level graph nodes only, in order: ["Organization", "WebSite"]. */
export function typesOnPage(html) {
  const out = [];
  for (const b of jsonLdBlocks(html)) {
    const v = b.value;
    const tops = Array.isArray(v) ? v : v?.['@graph'] ?? (v ? [v] : []);
    for (const n of tops) out.push(...typesOf(n));
  }
  return out;
}
