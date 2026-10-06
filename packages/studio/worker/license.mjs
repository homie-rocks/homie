/**
 * A GAME'S OWN LICENCE AND THE CREDIT IT OWES, shared by the site Worker (worker/site.mjs, worker/schema.mjs,
 * worker/discover.mjs) and the CLI (lib/build.mjs).
 *
 * The licence is a statement of rights the owner may make about the game: game.json `"license"` names an SPDX
 * identifier ("MIT", "CC-BY-4.0"), as the word or as { "spdx": "<id>" }. The game's page, its structured data and
 * /llms.txt say it. A game that names none says nothing: no licence is granted, and no page pretends otherwise.
 *
 * REMIX WAS RETIRED. A game used to be handed over whole (its source at /games/<id>/source.json, brought in with
 * `game remix`), and `"license"` also took three words about that: "remix-with-credit", "remix-freely" and
 * "no-remix". Games now build on each other through parts, pieces a studio chooses to share (parts/PARTS.md), each
 * under its own SPDX licence. Nothing here grants or refuses a remix any more:
 *
 *   - the three words, and `"kind"` in the object form, are read as no licence named (an SPDX id beside them stays);
 *   - game.json `"remix"`, `"share"` and `landing.make` are ignored; retiredKeys() names the ones a game still
 *     carries, so the build can say so once;
 *   - `"remixOf"`, which `game remix` wrote into a game it made, is still read: it is a credit that game owes its
 *     original, and its landing and credits keep showing it ("Based on <game> by <studio>", basedOnRow()).
 */
const SPDX = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;
/** The three words `"license"` took while a game could be handed over whole: none of them is a licence. */
const RETIRED_KINDS = new Set(['remix-with-credit', 'remix-freely', 'no-remix']);

/** { spdx } from what game.json (or a built catalogue row) says, or null when it names no licence. */
export function licenseOf(value) {
  const v = typeof value === 'string' ? value : value && typeof value === 'object' ? value.spdx : null;
  const spdx = typeof v === 'string' && SPDX.test(v.trim()) && !RETIRED_KINDS.has(v.trim()) ? v.trim() : null;
  return spdx ? { spdx } : null;
}

/** "MIT", or null for a game that names no licence. */
export const licenseLabel = (value) => licenseOf(value)?.spdx ?? null;

/**
 * The retired settings a game.json still carries, as the words to print: `"remix"`, `"share"`, `landing.make`, and
 * a `"license"` that is one of the three old words (or has a `"kind"`). `"remixOf"` is not one: it is still read.
 */
export function retiredKeys(g) {
  const out = [];
  if (g?.remix !== undefined) out.push('"remix"');
  if (g?.share !== undefined) out.push('"share"');
  const lic = g?.license;
  if ((typeof lic === 'string' && RETIRED_KINDS.has(lic.trim())) || (lic && typeof lic === 'object' && lic.kind !== undefined)) out.push(`"license": ${JSON.stringify(typeof lic === 'string' ? lic.trim() : String(lic.kind)).slice(0, 40)}`);
  if (g?.landing && typeof g.landing === 'object' && g.landing.make !== undefined) out.push('landing.make');
  return out;
}

const line = (v, max) => (typeof v === 'string' && v.trim() ? v.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max) : null);
/** An https address, else null. */
export function httpsPage(v) {
  try { const u = new URL(String(v ?? '')); return u.protocol === 'https:' ? u.href : null; } catch { return null; }
}

/** A game's page from the address its source once had: https://<site>/games/<id>/source.json is https://<site>/<id>/. */
function pageOfSource(source) {
  try {
    const u = new URL(String(source ?? ''));
    const m = /^\/games\/([a-z0-9][a-z0-9-]{0,39})\/source\.json$/.exec(u.pathname);
    return u.protocol === 'https:' && m ? `${u.origin}/${m[1]}/` : null;
  } catch { return null; }
}

/**
 * The credit a game owes the game it was made from, as it may be shown: the original's name, studio and page (an
 * https link), plain text only. Read from game.json `"remixOf"` (what `game remix` wrote; one made before 0.14.4
 * has only the original's source address, which names its page too) or from a built catalogue row's `basedOn`.
 */
export function basedOnRow(r) {
  if (!r || typeof r !== 'object') return null;
  const name = line(r.name, 80);
  return name ? { name, studio: line(r.studio, 80), page: httpsPage(r.page) ?? pageOfSource(r.source) } : null;
}

/** "Based on Gem Rush by Night Owl Games" (the studio left out when the record named none). */
export function basedOnCredit(r) {
  const row = basedOnRow(r);
  return row ? `Based on ${row.name}${row.studio ? ` by ${row.studio}` : ''}` : null;
}
