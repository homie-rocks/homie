/**
 * A GAME'S SOURCE LICENCE AND LINEAGE, shared by the site Worker (worker/index.mjs, worker/site.mjs) and the CLI
 * (lib/build.mjs, lib/studio.mjs).
 *
 * The licence is the owner's pick (game.json `"license"`), carried in the game's source.json beside who made it
 * (`credit`: studio, game, page), so a remix knows what it may do and whom to credit:
 *
 *   "remix-with-credit"  the default: remix it, and the remix says "Remix of <game> by <studio>" with a link back
 *   "remix-freely"       remix it; the credit is welcome, not asked for (the remix flow still writes it)
 *   "no-remix"           the source can be read, not remixed: the remix flow refuses
 *
 * Either the word, or { "kind": "<word>", "spdx": "<SPDX id>" } to name a licence too (e.g. "MIT", "CC-BY-4.0"); a
 * bare SPDX id ("MIT") is the default kind with that id. Anything else is the default.
 *
 * A remix's game.json `remixOf` (written by `homie-studio game remix`) is its lineage: the original's name, studio
 * and page, shown on the remix's landing ("Remix of <game> by <studio>") and in its credits.
 */
export const LICENSE_KINDS = Object.freeze({
  'remix-with-credit': 'Remix with credit',
  'remix-freely': 'Remix freely',
  'no-remix': 'Not for remixing',
});
export const DEFAULT_LICENSE = 'remix-with-credit';
const SPDX = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;

/** { kind, spdx } from what game.json (or a source.json) says. */
export function licenseOf(value) {
  const v = typeof value === 'string'
    ? (Object.hasOwn(LICENSE_KINDS, value.trim()) ? { kind: value.trim() } : { spdx: value })
    : value && typeof value === 'object' ? value : {};
  const kind = Object.hasOwn(LICENSE_KINDS, v.kind) ? v.kind : DEFAULT_LICENSE;
  const spdx = typeof v.spdx === 'string' && SPDX.test(v.spdx.trim()) ? v.spdx.trim() : null;
  return { kind, spdx };
}

/** "Remix with credit (MIT)". */
export function licenseLabel(value) {
  const l = licenseOf(value);
  return `${LICENSE_KINDS[l.kind]}${l.spdx ? ` (${l.spdx})` : ''}`;
}

/** Whether the owner lets the game be remixed. */
export const remixAllowed = (value) => licenseOf(value).kind !== 'no-remix';

const line = (v, max) => (typeof v === 'string' && v.trim() ? v.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max) : null);
/** An https address, else null. */
export function httpsPage(v) {
  try { const u = new URL(String(v ?? '')); return u.protocol === 'https:' ? u.href : null; } catch { return null; }
}

/** A game's page from its source address: https://<site>/games/<id>/source.json is https://<site>/<id>/. */
export function pageOfSource(source) {
  try {
    const u = new URL(String(source ?? ''));
    const m = /^\/games\/([a-z0-9][a-z0-9-]{0,39})\/source\.json$/.exec(u.pathname);
    return u.protocol === 'https:' && m ? `${u.origin}/${m[1]}/` : null;
  } catch { return null; }
}

/**
 * What a game.json `remixOf` may show: the original's name, studio and page (an https link; a remix made before
 * 0.14.4 has only its source address, which names the page too), plain text only.
 */
export function remixRow(r) {
  if (!r || typeof r !== 'object') return null;
  const name = line(r.name, 80);
  return name ? { name, studio: line(r.studio, 80), page: httpsPage(r.page) ?? pageOfSource(r.source) } : null;
}

/** "Remix of Gem Rush by Night Owl Games" (the studio left out when the source named none). */
export function remixCredit(r) {
  const row = remixRow(r);
  return row ? `Remix of ${row.name}${row.studio ? ` by ${row.studio}` : ''}` : null;
}
