/**
 * What a shell command Claude is about to run means for a studio: a `homie-studio` command (and which), a production
 * deploy, or a paid media call (fal, ElevenLabs). It reads the command's text only; it never runs anything.
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
  stats: ['key', 'link', 'revoke', 'share'], game: ['new', 'remix'], codex: ['new', 'link'], perf: ['sizes', 'compare'],
  progress: ['start', 'stage', 'check', 'preview', 'spend', 'shot', 'song', 'log', 'stop', 'end', 'attach', 'change', 'pr', 'show'],
  agents: ['pass', 'passes', 'revoke', 'brain', 'sit'], servers: ['new', 'set', 'close', 'level', 'member'], media: ['list', 'move', 'put'],
  players: ['owner'], storage: ['add'], statusline: [], chrome: ['install'],
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
    const { flags, pos } = flagsOf(rest, ['json', 'plan', 'yes', 'dry-run', 'apply', 'share', 'stop', 'install', 'remove', 'reopen', 'off', 'revoke']);
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
 * A skill's call without `--yes` only prices or asks, so it is free and not held. The models skill's `prop` and
 * `mood` are one fal call each; every model of a game shares one cap, `art/<game>-models/budget.json`.
 */
export function paidOf(command) {
  for (const seg of segments(command)) {
    const w = seg.words;
    const i = w.findIndex((x) => /(^|\/)(art|video|music|models)\.mjs$/.test(x));
    if (i >= 0) {
      const script = /(^|\/)art\.mjs$/.test(w[i]) ? 'art' : /video\.mjs$/.test(w[i]) ? 'video' : /models\.mjs$/.test(w[i]) ? 'models' : 'music';
      const { flags, pos } = flagsOf(w.slice(i + 1), ['yes', 'dry-run', 'json', 'vocals', 'no-deploy', 'mesh', 'concept-again']);
      const verb = pos[0];
      const paid = script === 'music' ? ['render', 'stems'].includes(verb) : script === 'models' ? ['prop', 'mood'].includes(verb) : verb === 'gen';
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
  }
  return null;
}

/** An MCP tool that spends money at a media provider (a fal or ElevenLabs connector's generating tool), or null. */
export function paidMcpOf(tool) {
  const m = /^mcp__(.+?)__(.+)$/.exec(String(tool ?? ''));
  if (!m) return null;
  const [, server, name] = m;
  const provider = /fal/i.test(server) ? 'fal' : /eleven/i.test(server) ? 'ElevenLabs' : null;
  if (!provider) return null;
  if (/^(list|get|search|check|status|describe|read|find|voices?|models?|usage|balance|price|quote)/i.test(name)) return null;
  return { provider, unit: provider === 'fal' ? 'usd' : 'credits', raw: true, tool: name };
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
