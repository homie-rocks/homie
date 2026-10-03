#!/usr/bin/env node
/**
 * Writes packages/studio/lib/schema-vocab.json, the schema.org vocabulary the structured-data check reads
 * (packages/studio/lib/schema-check.mjs): every type with its parents, every property with the types it is for
 * (domainIncludes) and the types its value may be (rangeIncludes), and every enumeration member with its
 * enumeration. From schema.org's own release file, so the check never guesses:
 *
 *   node scripts/schema-vocab.mjs                    fetch https://schema.org/version/latest/schemaorg-current-https.jsonld
 *   node scripts/schema-vocab.mjs <file.jsonld>      from a copy on this computer
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages', 'studio', 'lib', 'schema-vocab.json');
const SOURCE = 'https://schema.org/version/latest/schemaorg-current-https.jsonld';

const file = process.argv[2];
const doc = file ? JSON.parse(readFileSync(file, 'utf8')) : await (await fetch(SOURCE)).json();
const id = (x) => String(x).replace(/^schema:/, '');
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const types = {};
const props = {};
const members = {};
for (const n of doc['@graph'] ?? []) {
  const kinds = list(n['@type']);
  const name = id(n['@id']);
  if (kinds.includes('rdfs:Class')) types[name] = list(n['rdfs:subClassOf']).map((x) => id(x['@id'])).filter((x) => !x.includes(':'));
  else if (kinds.includes('rdf:Property')) {
    props[name] = [list(n['schema:domainIncludes']).map((x) => id(x['@id'])), list(n['schema:rangeIncludes']).map((x) => id(x['@id'])), ...(n['schema:supersededBy'] ? [id(list(n['schema:supersededBy'])[0]['@id'])] : [])];
  } else {
    const of = kinds.map(id).filter((k) => !k.includes(':'));
    if (of.length) members[name] = of;
  }
}
const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const out = { source: SOURCE, at: new Date().toISOString().slice(0, 10), types: sorted(types), props: sorted(props), members: sorted(members) };
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`${Object.keys(types).length} types, ${Object.keys(props).length} properties, ${Object.keys(members).length} enumeration members -> ${OUT}`);
