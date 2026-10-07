/**
 * What a shell command Claude is about to run means for a studio: a `homie-studio` command (and which), a production
 * deploy, a paid media call (fal, ElevenLabs, Tripo; through Homie's skills, the providers' own CLIs or their APIs),
 * or a change to the Cloudflare account outside the studio's deploy. It reads the command's text only; it never runs
 * anything.
 *
 * Like any reading of shell text it is a net, not a sandbox: `$(...)`, aliases, `eval`, `bash -c "..."` and scripts
 * that call these commands are not seen. The plugin README says so.
 */

/** Splits one shell segment into words, honouring quotes. Good enough to read commands, flags and paths. */
export function tokenize(text) {
  const words = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text))) !== null) words.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3]);
  return words;
}

/** The segments of a command line, each with the folder a `cd dir &&` before it moved to (null: the session's). */
export function segments(command) {
  const out = [];
  let dir = null;
  for (const raw of String(command ?? '').split(/&&|\|\||;|\||\n/)) {
    let words = tokenize(raw.trim().replace(/^[({]+\s*/, '').replace(/\s*[)}]+$/, ''));
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words = words.slice(1);
    while (words.length && ['command', 'exec', 'env', 'nohup', 'time', 'sudo'].includes(words[0])) words = words.slice(1);
    if (!words.length) continue;
    if (words[0] === 'cd') { dir = words[1] && words[1] !== '-' ? (dir && !words[1].startsWith('/') && !words[1].startsWith('~') ? `${dir}/${words[1]}` : words[1]) : dir; continue; }
    out.push({ words, dir, text: raw.trim() });
  }
  return out;
}

const FLAG = /^--?[A-Za-z]/;

/** Flags of a word list: Map name → value (true for a bare flag), and the positional words. */
export function flagsOf(words, bools = []) {
  const flags = new Map();
  const pos = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.startsWith('--')) {
      const [k, v] = w.slice(2).split(/=(.*)/s, 2);
      if (v !== undefined) flags.set(k, v);
      else if (words[i + 1] !== undefined && !FLAG.test(words[i + 1]) && !bools.includes(k)) flags.set(k, words[++i]);
      else flags.set(k, true);
    } else pos.push(w);
  }
  return { flags, pos };
}

const NPM_SCRIPTS = { dev: 'dev', build: 'build', deploy: 'deploy', check: 'check', studio: null };
/** The two-word commands of homie-studio (bin/homie-studio.mjs). */
const TWO = {
  port: ['plan', 'import', 'check'], setup: ['status', 'attach'], office: ['link', 'key', 'announce', 'invite', 'launch', 'kick', 'mute', 'close', 'revoke'],
  stats: ['key', 'link', 'revoke', 'share'], game: ['new'], codex: ['new', 'link'], perf: ['sizes', 'compare'],
  progress: ['start', 'stage', 'check', 'preview', 'spend', 'shot', 'song', 'log', 'stop', 'end', 'attach', 'change', 'pr', 'show'],
  agents: ['pass', 'passes', 'revoke', 'brain', 'sit'], servers: ['new', 'set', 'close', 'level', 'member'], media: ['list', 'move', 'put'],
  players: ['owner'], storage: ['add'], statusline: [], chrome: ['install'],
  // A game as an app of its own: it builds on this computer and uploads nothing, so none of these is held.
  standalone: ['plan', 'build', 'run', 'steam', 'ci'],
};

/**
 * A `homie-studio` invocation in a command line: { sub, args, flags, pos, dir, text } where `sub` is the first one or
 * two words ('check', 'port check', 'setup status', 'office kick', ...). `npm run deploy` reads as `deploy`.
 */
export function studioCalls(command) {
  const calls = [];
  for (const seg of segments(command)) {
    const w = seg.words;
    let at = -1;
    for (let i = 0; i < w.length; i++) {
      if (/(^|\/)homie-studio(\.mjs)?$/.test(w[i])) { at = i; break; }
    }
    let rest = null;
    if (at >= 0) rest = w.slice(at + 1);
    else if (w[0] === 'npm' && w[1] === 'run' && w[2] in NPM_SCRIPTS) {
      const script = NPM_SCRIPTS[w[2]];
      const extra = w.slice(3).filter((x) => x !== '--');
      rest = script ? [script, ...extra] : extra;
    } else if ((w[0] === 'npx' || w[0] === 'bunx' || w[0] === 'pnpm') && w.some((x) => /^wrangler$/.test(x)) && w.includes('deploy')) {
      calls.push({ sub: 'wrangler deploy', args: w, flags: new Map(), pos: [], dir: seg.dir, text: seg.text });
      continue;
    } else if (/(^|\/)wrangler$/.test(w[0]) && w[1] === 'deploy') {
      calls.push({ sub: 'wrangler deploy', args: w, flags: new Map(), pos: [], dir: seg.dir, text: seg.text });
      continue;
    }
    if (!rest) continue;
    const { flags, pos } = flagsOf(rest, ['json', 'plan', 'yes', 'dry-run', 'apply', 'share', 'stop', 'install', 'remove', 'reopen', 'off', 'revoke', 'release', 'device']);
    const second = TWO[pos[0]];
    const sub = !pos.length ? 'help' : second && second.includes(pos[1]) ? `${pos[0]} ${pos[1]}` : pos[0];
    calls.push({ sub, args: rest, flags, pos, dir: seg.dir, text: seg.text });
  }
  return calls;
}

/** A production deploy in this command line: { what, dir } or null (`--plan`, `--help` and `--dry-run` are not). */
export function deployOf(command) {
  for (const c of studioCalls(command)) {
    if (c.flags.has('plan') || c.flags.has('help') || c.flags.has('dry-run')) continue;
    if (c.sub === 'deploy') return { what: 'homie-studio deploy', dir: c.dir, ci: c.flags.has('ci') };
    if (c.sub === 'wrangler deploy') return { what: 'wrangler deploy', dir: c.dir };
  }
  // The music and video skills publish by rebuilding and redeploying the site.
  for (const seg of segments(command)) {
    const i = seg.words.findIndex((x) => /(^|\/)(music|video)\.mjs$/.test(x));
    if (i < 0 || seg.words[i + 1] !== 'publish') continue;
    const { flags, pos } = flagsOf(seg.words.slice(i + 2), ['no-deploy', 'json']);
    if (flags.has('no-deploy')) continue;
    const kind = /music\.mjs$/.test(seg.words[i]) ? 'song' : 'video';
    return { what: `publish the ${kind} ${pos[0] ?? ''}`.trim(), dir: seg.dir, media: { kind, slug: pos[0] ?? null } };
  }
  return null;
}

const PAID_HOSTS = [
  [/\b(?:queue\.)?fal\.run\b|\bfal\.ai\/(?:api|v1)\b|\brest\.alpha\.fal\.ai\b/, 'fal', 'usd'],
  [/\bapi\.elevenlabs\.io\b|\bapi\.us\.elevenlabs\.io\b/, 'ElevenLabs', 'credits'],
];

/**
 * A paid media call in this command line, or null:
 *   { provider: 'fal', unit: 'usd', script: 'art'|'video'|'models', kind: 'art'|'videos', slug, words, i, dir, dryRun: [argv] }
 *   { provider: 'ElevenLabs', unit: 'credits', script: 'music', kind: 'music', slug, ... }
 *   { provider, unit, raw: true }   a request straight at the provider: its cost cannot be read first
 * A skill's call without `--yes` only prices or asks, so it is free and not held. The models skill's `prop`,
 * `character` and `mood` are one fal call each; every model of a game shares one cap, `art/<game>-models/budget.json`.
 */
export function paidOf(command) {
  for (const seg of segments(command)) {
    const w = seg.words;
    const i = w.findIndex((x) => /(^|\/)(art|video|music|models)\.mjs$/.test(x));
    if (i >= 0) {
      const script = /(^|\/)art\.mjs$/.test(w[i]) ? 'art' : /video\.mjs$/.test(w[i]) ? 'video' : /models\.mjs$/.test(w[i]) ? 'models' : 'music';
      const { flags, pos } = flagsOf(w.slice(i + 1), ['yes', 'dry-run', 'json', 'vocals', 'no-deploy', 'mesh', 'concept-again']);
      const verb = pos[0];
      const paid = script === 'music' ? ['render', 'stems'].includes(verb) : script === 'models' ? ['prop', 'mood', 'character'].includes(verb) : verb === 'gen';
      if (!paid || !flags.has('yes') || flags.has('dry-run')) continue;
      // The same call priced and not made: the skill's own --dry-run (free; it asks the provider's price list).
      const head = /(^|\/)node$/.test(w[0]) ? w.slice(0, i) : ['node'];
      const dryRun = [...head, w[i], ...w.slice(i + 1).filter((x) => x !== '--yes' && x !== '--json'), '--dry-run', '--json'];
      return {
        provider: script === 'music' ? 'ElevenLabs' : 'fal', unit: script === 'music' ? 'credits' : 'usd', script, verb,
        kind: script === 'video' ? 'videos' : script === 'music' ? 'music' : 'art',
        slug: script === 'models' ? (pos[1] ? `${pos[1]}-models` : null) : pos[1] ?? null, model: flags.get('model') ?? null,
        ...(script === 'models' ? { tool: `models ${verb}` } : {}), dir: seg.dir, dryRun, text: seg.text,
      };
    }
    if (['curl', 'wget', 'http', 'xh'].includes(w[0].split('/').pop())) {
      for (const [re, provider, unit] of PAID_HOSTS) if (re.test(seg.text)) return { provider, unit, raw: true, dir: seg.dir, text: seg.text };
    }
    const cli = providerCliOf(w);
    if (cli) return { ...cli, raw: true, dir: seg.dir, text: seg.text };
  }
  return null;
}

/*
 * THE PROVIDERS' OWN CLIs, where a command spends (read from each one's --help on 2026-10-03). A call made with one of
 * them goes straight at the provider and its cost cannot be read first, so it is held like a request at their API.
 * Help, a schema, a dry run, a sign-in and a listing are free and never held.
 *   elevenlabs   ElevenLabs' CLI (brew elevenlabs/tap/elevenlabs, npm @elevenlabs/cli): its generating groups
 *   fal          fal's CLI (pip install fal): `fal api <model>` runs a hosted model, `fal run` runs an app on fal
 *   genmedia     fal's genmedia CLI: `genmedia run <model>`
 *   tripo        Tripo's CLI (npm tripo-cli): everything but its sign-in, balance, usage, status and docs
 *   stripe       Stripe's CLI, its Projects plugin only: `stripe projects upgrade`, `billing add` / `billing update`
 *                (a payment method or a spend limit) and anything with --confirm-paid-service; the rest (status,
 *                catalog, search, a free add, link, env) spends nothing
 */
const LAUNCHERS = new Set(['npx', 'bunx', 'pnpx', 'uvx']);
const CLI_PACKAGES = { '@elevenlabs/cli': 'elevenlabs', 'tripo-cli': 'tripo' };
const CLI_FREE_FLAGS = ['--help', '-h', '--dry-run', '--schema', '--spec', '--spec-raw', '--version', '-V', '-v'];
const ELEVEN_SPENDS = new Set(['music', 'text-to-speech', 'text-to-sound-effects', 'text-to-dialogue', 'text-to-voice', 'speech-to-speech',
  'speech-to-text', 'audio-isolation', 'dubbing', 'forced-alignment', 'flows', 'say', 'studio', 'productions', 'speech-engine']);
const ELEVEN_FREE_VERB = /^(list|get|delete|help|status|search|show|upload)$/;
const TRIPO_FREE = new Set(['login', 'logout', 'whoami', 'balance', 'usage', 'status', 'docs', 'mcp', 'help', 'config', 'list', 'get', 'download', 'models', 'version']);
const CLI_BOOLS = ['dry-run', 'human', 'quiet', 'debug', 'help', 'schema', 'spec', 'spec-raw', 'version', 'json', 'yes', 'no-browser', 'remote', 'local', 'force'];

/** The program a command line runs, past `npx -y`, `bunx`, `pnpm dlx`, `npm exec --` and `uvx`: { prog, args } or null. */
export function programOf(words) {
  let i = 0;
  const bare = (x) => String(x ?? '').replace(/^(@[^/@]+\/[^@]+|[^@]+)@.*$/, '$1');
  for (let guard = 0; guard < 4 && i < words.length; guard++) {
    const n = words[i].split('/').pop();
    if (LAUNCHERS.has(n)) i += 1;
    else if ((n === 'pnpm' && ['dlx', 'exec'].includes(words[i + 1])) || (n === 'npm' && words[i + 1] === 'exec')) i += 2;
    else break;
    while (i < words.length && words[i].startsWith('-')) i += words[i] === '-p' || words[i] === '--package' ? 2 : 1;
  }
  if (i >= words.length) return null;
  const word = bare(words[i]);
  const prog = CLI_PACKAGES[word] ?? word.split('/').pop();
  return { prog, args: words.slice(i + 1) };
}

/** A paid call through a provider's own CLI: { provider, unit, tool } or null. */
export function providerCliOf(words) {
  const p = programOf(words);
  if (!p || !['elevenlabs', 'fal', 'genmedia', 'tripo', 'stripe'].includes(p.prog)) return null;
  if (p.args.some((a) => CLI_FREE_FLAGS.includes(a))) return null;
  const { pos } = flagsOf(p.args, CLI_BOOLS);
  if (!pos.length) return null;
  const tool = `${p.prog} ${pos.slice(0, p.prog === 'elevenlabs' && pos[0] !== 'say' ? 2 : 1).join(' ')}`;
  if (p.prog === 'elevenlabs') {
    if (!ELEVEN_SPENDS.has(pos[0])) return null;
    if (pos[0] !== 'say' && pos.slice(1).some((x) => ELEVEN_FREE_VERB.test(x))) return null;
    if (pos[0] !== 'say' && pos.length < 2) return null;
    return { provider: 'ElevenLabs', unit: 'credits', tool };
  }
  if (p.prog === 'fal') return ['api', 'run'].includes(pos[0]) ? { provider: 'fal', unit: 'usd', tool } : null;
  if (p.prog === 'genmedia') return pos[0] === 'run' ? { provider: 'fal', unit: 'usd', tool } : null;
  if (p.prog === 'stripe') {
    if (pos[0] !== 'projects') return null;
    const paid = pos[1] === 'upgrade' || (pos[1] === 'billing' && ['add', 'update'].includes(pos[2])) || p.args.includes('--confirm-paid-service');
    return paid ? { provider: 'Stripe Projects', unit: 'usd', tool: `stripe projects ${pos.slice(1, pos[1] === 'billing' ? 3 : 2).join(' ')}` } : null;
  }
  return TRIPO_FREE.has(pos[0]) ? null : { provider: 'Tripo', unit: 'usd', tool };
}

/*
 * A CLEF MODEL DOWNLOADED BY OLLAMA. @homie-rocks/studio 0.24.4 runs Cloudflare's Clef decision model on the person's
 * own computer when Ollama has it, and nothing in Homie downloads one by itself: `ollama pull clef-flash` is about
 * 11 GB (`clef`, the 27B, about 18 GB), so the person says yes to the size first. What is read here:
 *   ollama pull <clef model>       always a download (or a check for a newer copy)
 *   ollama run <clef model>        a download when Ollama does not have that model yet (the mod asks Ollama's own list)
 *   a request at Ollama's /api/pull naming a Clef model (curl, wget and the like)
 * Listing, showing, copying or removing a model, `ollama serve`, `--help`, and any other model are not read.
 */
const CLEF_MODELS = { 'clef-flash': { size: 'about 11 GB', params: '9B' }, clef: { size: 'about 18 GB', params: '27B' } };
const OLLAMA_BOOLS = ['help', 'insecure', 'verbose', 'nowordwrap', 'hidethinking', 'think'];

/** A model reference (`clef-flash`, `clef:27b`, `registry.ollama.ai/library/clef-flash:latest`) → { model, tag } or null. */
function clefRef(ref) {
  const m = /^(clef(?:-flash)?)(?::([A-Za-z0-9._-]+))?$/.exec(String(ref ?? '').split('/').pop());
  return m ? { model: m[1], tag: m[2] ?? null } : null;
}

/**
 * A Clef model download in this command line, or null:
 *   { verb: 'pull'|'run'|'api', model: 'clef-flash'|'clef', tag, ref, size: 'about 11 GB', params, host, dir, text }
 * `host` is an OLLAMA_HOST the command sets, as written (the mod asks only a loopback one).
 */
export function modelPullOf(command) {
  for (const seg of segments(command)) {
    const host = /(?:^|\s)OLLAMA_HOST=("[^"]*"|'[^']*'|\S+)/.exec(seg.text)?.[1]?.replace(/^["']|["']$/g, '') ?? null;
    const w = seg.words;
    if (['curl', 'wget', 'http', 'xh'].includes(w[0].split('/').pop())) {
      if (!/\/api\/pull\b/.test(seg.text)) continue;
      const named = /\b(?:model|name)\\?["']?\s*[:=]\s*\\?["']?([A-Za-z0-9._:/-]+)/.exec(seg.text);
      const r = named ? clefRef(named[1]) : null;
      if (r) return { verb: 'api', ...r, ref: named[1], ...CLEF_MODELS[r.model], host, dir: seg.dir, text: seg.text };
      continue;
    }
    const p = programOf(w);
    if (!p || p.prog !== 'ollama' || p.args.includes('-h')) continue;
    const { flags, pos } = flagsOf(p.args, OLLAMA_BOOLS);
    if (flags.has('help') || !['pull', 'run'].includes(pos[0])) continue;
    const r = clefRef(pos[1]);
    if (r) return { verb: pos[0], ...r, ref: pos[1], ...CLEF_MODELS[r.model], host, dir: seg.dir, text: seg.text };
  }
  return null;
}

/**
 * An MCP tool that spends money at a media provider (a fal, ElevenLabs or Tripo connector's generating tool), or null.
 * Their own servers' listing, schema, pricing and job-status tools are free, and so is ElevenLabs' `estimate_only`
 * (it prices a call and makes nothing); its agent-building tools spend nothing by themselves.
 */
export function paidMcpOf(tool, input = {}) {
  const m = /^mcp__(.+?)__(.+)$/.exec(String(tool ?? ''));
  if (!m) return null;
  const [, server, full] = m;
  const provider = /fal/i.test(server) ? 'fal' : /eleven/i.test(server) ? 'ElevenLabs' : /tripo/i.test(server) ? 'Tripo' : null;
  if (!provider) return null;
  const name = full.replace(/^creative_/i, '');
  if (/^(list|get|search|check|status|describe|read|find|voices?|models?|usage|balance|price|pricing|quote|recommend|cancel|upload|estimate|schema|docs?)/i.test(name)) return null;
  if (provider === 'ElevenLabs' && (input?.estimate_only === true || /agent|knowledge|widget|conversation|webhook|workspace/i.test(name))) return null;
  return { provider, unit: provider === 'ElevenLabs' ? 'credits' : 'usd', raw: true, tool: full };
}

/*
 * A CHANGE TO A CLOUDFLARE ACCOUNT OUTSIDE THE STUDIO'S OWN DEPLOY. `npm run deploy` (homie-studio deploy) records
 * what it creates in studio.json and never touches what it did not create; Wrangler run by hand, and the tools of
 * Cloudflare's own MCP servers, go around that record. What is held (inside a studio, with guardDeploys on):
 *   anything deleted (a Worker, a D1 database, an R2 bucket or object, a KV namespace or key, a queue, a secret);
 *   a secret put (Cloudflare: a secret put is itself a deployment), a version rolled out or rolled back by hand;
 *   a migration applied to the live database, and SQL that writes to it;
 *   through an MCP server: a delete, update, edit, put, deploy or rollback tool, a live-database query that writes,
 *   and an `execute` (Cloudflare's API server) whose code sends anything but GET (a GraphQL read is a POST and is free).
 * Creating something new and reading anything are not held. `--local` never touches the account.
 */
const READ_SQL = /^\s*(select|pragma|explain|with\b[\s\S]*\bselect)\b/i;
export function readOnlySql(sql) {
  const parts = String(sql ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((s) => READ_SQL.test(s) && !/\b(insert|update|delete|drop|alter|create|replace)\b/i.test(s));
}

/** Wrangler, run by hand, changing the account: { what, kind, names, dir, text } or null. */
export function cloudflareChangeOf(command) {
  for (const seg of segments(command)) {
    const p = programOf(seg.words);
    if (!p || p.prog !== 'wrangler') continue;
    if (p.args.some((a) => a === '--help' || a === '-h' || a === '--local' || a === '--dry-run')) continue;
    const { flags, pos } = flagsOf(p.args, CLI_BOOLS);
    const at = (kind, n) => ({ what: `wrangler ${pos.slice(0, n).join(' ')}`.trim(), kind, names: pos.slice(n), dir: seg.dir, text: seg.text });
    const del = pos.indexOf('delete');
    if (del >= 0 && del <= 2) return at('delete', del + 1);
    if ((pos[0] === 'secret' && ['put', 'bulk'].includes(pos[1])) || (pos[0] === 'versions' && pos[1] === 'secret' && ['put', 'bulk'].includes(pos[2]))) return at('secret', pos[0] === 'versions' ? 3 : 2);
    if ((pos[0] === 'versions' && pos[1] === 'deploy') || pos[0] === 'rollback' || (pos[0] === 'deployments' && pos[1] === 'rollback')) return at('deploy', pos[0] === 'rollback' ? 1 : 2);
    if (pos[0] === 'd1' && pos[1] === 'migrations' && pos[2] === 'apply' && flags.has('remote')) return at('schema', 3);
    if (pos[0] === 'd1' && pos[1] === 'execute' && flags.has('remote') && (flags.has('file') || !readOnlySql(flags.get('command')))) return at('data', 2);
  }
  return null;
}

/** A tool of a Cloudflare MCP server (Cloudflare's own, or a claude.ai connector) changing the account, or null. */
export function cloudflareMcpChangeOf(tool, input = {}) {
  const m = /^mcp__(.+?)__(.+)$/.exec(String(tool ?? ''));
  if (!m || !/cloudflare/i.test(m[1])) return null;
  const name = m[2];
  const names = Object.entries(input ?? {}).filter(([k, v]) => typeof v === 'string' && /(^|_)(name|id|bucket|database|script)/i.test(k)).map(([, v]) => v);
  if (name === 'execute') {
    const code = String(input?.code ?? '');
    const methods = [...code.matchAll(/\bmethod\s*:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/gi)].map((x) => x[1].toUpperCase());
    const writes = [...new Set(methods.filter((x) => x !== 'POST' || !/graphql/i.test(code)))];
    if (!writes.length) return null;
    return { what: `Cloudflare's API (${writes.join(', ')}) through its MCP`, kind: writes.includes('DELETE') ? 'delete' : 'change', names: [], code, text: code.slice(0, 300) };
  }
  if (/(^|_)(delete|remove|destroy|purge)(_|$)/i.test(name)) return { what: name, kind: 'delete', names, text: name };
  if (/(^|_)(update|edit|put|deploy|rollback)(_|$)/i.test(name)) return { what: name, kind: 'change', names, text: name };
  if (/(^|_)query$/i.test(name) && !readOnlySql(input?.sql ?? input?.query)) return { what: name, kind: 'data', names, text: String(input?.sql ?? input?.query ?? '').slice(0, 300) };
  return null;
}

/**
 * A write through Stripe's MCP server whose answer would carry a secret into the conversation, or null. Stripe hands a
 * new webhook endpoint's signing secret back once, in the create call's answer (and an event destination's, when asked
 * to include it). The shop's webhook is made on the owner's computer instead (`homie-studio shop connect`), where
 * the secret goes straight to the studio's Worker. An update of an existing endpoint (we_…) carries no secret.
 */
export function stripeSecretWriteOf(tool, input) {
  if (!/^mcp__.*stripe.*__stripe_api_write$/i.test(String(tool ?? ''))) return null;
  let text = '';
  try { text = JSON.stringify(input ?? {}); } catch { text = String(input ?? ''); }
  // A path (/v1/webhook_endpoints), an operation's name (PostWebhookEndpoints) or a resource word: all the same here.
  const flat = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const newEndpoint = flat.includes('webhookendpoint') && !flat.includes('eventdestination') && !/\bwe_[A-Za-z0-9]{6,}/.test(text);
  const destinationSecret = flat.includes('eventdestination') && flat.includes('signingsecret');
  if (!newEndpoint && !destinationSecret) return null;
  return 'Refused by the Homie mod: Stripe answers a new webhook\'s signing secret in this call, and it would land in the conversation. A studio\'s shop webhook is made on the owner\'s computer instead: run `npx --no-install homie-studio shop connect` and give the owner the 127.0.0.1 link; the page makes the webhook with the shop\'s key and the secret goes straight to the Worker. (Reading or turning off an existing endpoint through Stripe\'s MCP is fine.)';
}

// git's own options before the subcommand that take a value, and the subcommands' (a value is never a path).
const GIT_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const STAGE_VALUE = {
  add: new Set(['--chmod', '--pathspec-from-file']),
  commit: new Set(['-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c', '--reedit-message', '--author', '--date', '-t', '--template', '--fixup', '--squash', '--cleanup', '--pathspec-from-file', '--trailer']),
};

/**
 * Each `git add` and `git commit` in a command line: { verb, dir, paths, all } where `dir` is the folder git runs in
 * (a `cd` before it, or `git -C <dir>`; null: the session's), `paths` the paths it names, and `all` what a flag adds
 * besides: 'all' (`add -A`), 'tracked' (`add -u`, `commit -a`) or null. What gets staged is read from git itself.
 */
export function gitStagesOf(command) {
  const out = [];
  for (const seg of segments(command)) {
    const w = seg.words;
    if (!/(^|\/)git$/.test(w[0])) continue;
    let dir = seg.dir;
    let i = 1;
    while (i < w.length && w[i].startsWith('-')) {
      if (w[i] === '-C' && w[i + 1]) { const d = w[i + 1]; dir = d.startsWith('/') || !dir ? d : `${dir}/${d}`; i += 2; }
      else if (GIT_VALUE.has(w[i])) i += 2;
      else i++;
    }
    const verb = w[i];
    if (verb !== 'add' && verb !== 'commit') continue;
    const values = STAGE_VALUE[verb];
    const paths = [];
    let all = null;
    let rest = false;
    for (let k = i + 1; k < w.length; k++) {
      const x = w[k];
      if (rest || x === '-' || !x.startsWith('-')) { paths.push(x); continue; }
      if (x === '--') { rest = true; continue; }
      if (x.startsWith('--')) {
        const name = x.split('=')[0];
        if (verb === 'add' && ['--all', '--no-ignore-removal'].includes(name)) all = 'all';
        else if ((verb === 'add' && name === '--update') || (verb === 'commit' && name === '--all')) all = all ?? 'tracked';
        if (values.has(name) && !x.includes('=')) k++;
        continue;
      }
      // Short flags, perhaps bundled ("-am msg"): a flag that takes a value takes the next word when it ends the bundle.
      const letters = x.slice(1);
      if (verb === 'add' && letters.includes('A')) all = 'all';
      else if ((verb === 'add' && letters.includes('u')) || (verb === 'commit' && /^[^mFCct]*a/.test(letters))) all = all ?? 'tracked';
      const at = [...letters].findIndex((ch) => values.has(`-${ch}`));
      if (at === letters.length - 1) k++;
    }
    out.push({ verb, dir, paths, all });
  }
  return out;
}

/** A path inside a folder? Both absolute; forward slashes. */
export function inside(root, path) {
  const r = String(root).replace(/\/+$/, '');
  return path === r || String(path).startsWith(`${r}/`);
}

/** A studio-relative path matched against `protect` globs (`*` within a folder, `**` across, `?` one character). */
export function globMatch(glob, rel) {
  const g = String(glob).replace(/^\.?\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*' && g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 2 : 1; }
    else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // A folder glob ("site/" or "site") protects what is under it too.
  return new RegExp(`^${re}${g.endsWith('/') ? '.*' : '(?:/.*)?'}$`).test(rel);
}

/** The first `protect` glob a studio-relative path matches, or null. */
export function protectedBy(globs, rel) {
  for (const g of Array.isArray(globs) ? globs : []) if (typeof g === 'string' && g.trim() && globMatch(g.trim(), rel)) return g.trim();
  return null;
}
