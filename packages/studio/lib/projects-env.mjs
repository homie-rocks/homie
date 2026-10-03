/**
 * The credentials Stripe Projects keeps for a studio (`homie-studio setup --via stripe-projects`, 0.24.3), read only
 * where they are used and never printed, returned to a person, or written anywhere else.
 *
 * Stripe Projects keeps them encrypted in its vault and syncs them to the project's output file (`.env` unless the
 * environment names another), which it creates readable by this user only and git-ignores. Wrangler then deploys with
 * the Cloudflare token from that file instead of a `wrangler login`; the music skill reads the ElevenLabs key the same
 * way. studio.json says which (never a value): `cloudflare.auth: "stripe-projects"`, `providers.elevenlabs.via`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, sep } from 'node:path';

/** The output file inside the studio (`.env` by default); null for anything outside it. */
export function envFileOf(root, name = '.env') {
  const n = normalize(String(name || '.env'));
  if (isAbsolute(n) || n === '..' || n.startsWith(`..${sep}`)) return null;
  return join(root, n);
}

const unquote = (v) => {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
};

/** A dotenv file as { NAME: value } (KEY=value lines; `export ` and comments allowed). {} when absent. */
export function readDotenv(file) {
  const out = {};
  if (!file || !existsSync(file)) return out;
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().replace(/^export\s+/, '');
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    out[k] = unquote(t.slice(i + 1).trim());
  }
  return out;
}

function studioOf(root) {
  try { return JSON.parse(readFileSync(join(root, 'studio.json'), 'utf8')); } catch { return null; }
}

/**
 * The environment Wrangler gets for a studio whose Cloudflare came through Stripe Projects: CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ACCOUNT_ID from the Projects output file. {} for every other studio (the default: `wrangler login`).
 */
export function projectsCloudflareEnv(root, studio = studioOf(root)) {
  const cf = studio?.cloudflare;
  if (!root || cf?.auth !== 'stripe-projects') return {};
  const vars = readDotenv(envFileOf(root, cf.envFile));
  return {
    ...(vars.CLOUDFLARE_API_TOKEN ? { CLOUDFLARE_API_TOKEN: vars.CLOUDFLARE_API_TOKEN } : {}),
    ...(vars.CLOUDFLARE_ACCOUNT_ID ? { CLOUDFLARE_ACCOUNT_ID: vars.CLOUDFLARE_ACCOUNT_ID } : {}),
  };
}

/** Whether Stripe Projects holds this studio's ElevenLabs key (studio.json `providers.elevenlabs`); never the key. */
export function projectsElevenLabs(root, studio = studioOf(root)) {
  const p = studio?.providers?.elevenlabs;
  if (!root || p?.via !== 'stripe-projects') return false;
  const name = /^[A-Z][A-Z0-9_]{2,}$/.test(String(p.envKey ?? '')) ? p.envKey : 'ELEVENLABS_API_KEY';
  return Boolean(readDotenv(envFileOf(root, p.envFile))[name]);
}
