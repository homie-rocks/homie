/**
 * SECRETS OUT OF TOOL OUTPUT. The Homie mod runs every tool result through `redact` before Claude reads it or the
 * transcript keeps it. It only matches text: it never opens a key file, the keychain or the environment.
 *
 * What it hides: the studio's own one-time and owner keys (office and stats keys `hsk_`, progress write keys `hbk_`,
 * agent passes `hap_…`, whose public id part stays), Cloudflare API tokens and global keys, provider keys (fal,
 * ElevenLabs, Anthropic, OpenAI, GitHub, npm, Stripe keys and webhook secrets, AWS, Google), bearer tokens, private key blocks, and the value
 * of any `NAME=value` whose name says key, token or secret.
 *
 * A link that carries one (the owner's one-time sign-in link, a confirm link, a player-owner link) is a link for the
 * person, not for Claude: it is taken out whole and handed back in `links`, so the mod can show it to the person in
 * its pane, and Claude reads that it is there.
 */

const HIDE = (kind) => `[${kind} hidden by Homie]`;

/** Each rule: what it is, the pattern, and how to write what replaces a match (the default hides the whole match). */
export const RULES = [
  { kind: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'office key', re: /\bhsk_[a-f0-9]{48}\b/g },
  { kind: 'progress key', re: /\bhbk_[a-f0-9]{48}\b/g },
  // An agent pass: its id (hap_ and ten hex digits) is public and stays; the secret after it goes.
  { kind: 'agent pass', re: /\b(hap_[a-f0-9]{10})_[A-Za-z0-9_-]{40}(?![A-Za-z0-9_-])/g, to: (m, id) => `${id}_${HIDE('agent pass')}` },
  { kind: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'OpenAI key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g },
  { kind: 'ElevenLabs key', re: /\bsk_[a-f0-9]{48}\b/g },
  { kind: 'Stripe key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  // A webhook signing secret has no live/test part: whsec_ and the secret itself.
  { kind: 'Stripe webhook secret', re: /\bwhsec_[A-Za-z0-9+/=_-]{16,}/g },
  { kind: 'fal key', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}\b/g },
  { kind: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { kind: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: 'AWS key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'Google key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'Cloudflare key', re: /(X-Auth-Key["']?\s*[:=]\s*["']?)([a-f0-9]{37})\b/gi, to: (m, head) => `${head}${HIDE('Cloudflare key')}` },
  { kind: 'token', re: /(\b[Bb]earer\s+)([A-Za-z0-9_\-.~+/]{24,}=*)/g, to: (m, head) => `${head}${HIDE('token')}` },
  // NAME=value (or NAME: value) where the name says what it is: CLOUDFLARE_API_TOKEN, FAL_KEY, ELEVENLABS_API_KEY ...
  // Only a value that looks like a key (16+ characters of letters AND digits, no dots or brackets), so source code
  // that names a key (`const FAL_KEY = process.env.FAL_KEY`) is never changed under Claude's eyes.
  {
    kind: 'secret',
    re: /\b([A-Z][A-Z0-9_]*(?:API_KEY|API_TOKEN|_TOKEN|_SECRET|SECRET_KEY|_KEY|PASSWORD)\b["']?\s*[=:]\s*["']?)([A-Za-z0-9_\-+/=:]{16,})(?![A-Za-z0-9_.(])/g,
    to: (m, head, value) => (/[A-Za-z]/.test(value) && /[0-9]/.test(value) ? `${head}${HIDE('secret')}` : m),
  },
];

const URL_RE = /https?:\/\/[^\s"'<>`)\]]+/g;
const LINK_SECRET = /\b(?:hsk|hbk)_[a-f0-9]{48}\b|\bhap_[a-f0-9]{10}_[A-Za-z0-9_-]{40}/;
export const LINK_NOTE = '[one-time owner link: the Homie mod showed it to the person in its Studio pane; Claude never sees it]';

/** Redact one string: { text, hits: [kinds], links: [urls] }. Unchanged text keeps its identity. */
export function redactText(text) {
  if (typeof text !== 'string' || text.length < 8) return { text, hits: [], links: [] };
  const hits = [];
  const links = [];
  let out = text.replace(URL_RE, (url) => {
    if (!LINK_SECRET.test(url)) return url;
    links.push(url.replace(/[.,;:]+$/, ''));
    hits.push('owner link');
    return LINK_NOTE + url.slice(url.replace(/[.,;:]+$/, '').length);
  });
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, (...m) => {
      const replaced = rule.to ? rule.to(...m) : HIDE(rule.kind);
      if (replaced !== m[0]) hits.push(rule.kind);
      return replaced;
    });
  }
  return hits.length ? { text: out, hits, links } : { text, hits, links };
}

/**
 * Redact every string inside a value (a tool's result record, an MCP result, a string), at most 12 levels deep.
 * Returns { value, hits, links }; `value` is the same object when nothing was hidden.
 */
export function redact(value) {
  const hits = [];
  const links = [];
  const walk = (v, depth) => {
    if (typeof v === 'string') {
      const r = redactText(v);
      if (r.hits.length) { hits.push(...r.hits); links.push(...r.links); }
      return r.text;
    }
    if (depth > 12 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      let changed = false;
      const next = v.map((x) => { const y = walk(x, depth + 1); if (y !== x) changed = true; return y; });
      return changed ? next : v;
    }
    let changed = false;
    const next = {};
    for (const [k, x] of Object.entries(v)) { const y = walk(x, depth + 1); if (y !== x) changed = true; next[k] = y; }
    return changed ? next : v;
  };
  const out = walk(value, 0);
  return { value: out, hits: [...new Set(hits)], links: [...new Set(links)] };
}
