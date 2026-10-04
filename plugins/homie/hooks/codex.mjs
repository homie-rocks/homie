#!/usr/bin/env node
/**
 * HOMIE'S HOLDS IN CODEX. Codex runs this as the plugin's lifecycle hooks (hooks/codex.json), with the hook's JSON on
 * stdin and its answer on stdout:
 *   pre      PreToolUse: Bash, apply_patch and MCP tools, checked by lib/holds.mjs, the same module the Claude Code
 *            mod asks, so the two apps hold the same calls with the same words;
 *   prompt   UserPromptSubmit: the person's own "proceed <code>" or "cancel <code>" answers a hold;
 *   post     PostToolUse: secrets out of what the model reads (lib/redact.mjs, the mod's patterns), and the commit a
 *            deploy shipped (for the next deploy's "commits since").
 *
 * WHAT CODEX ALLOWS (0.156.1 and 0.160.0, read from its hooks and tested with both): a PreToolUse hook can refuse a
 * call or let it through, but cannot ask the person (`permissionDecision: "ask"` is refused as unsupported, and the
 * call then runs). So a hold refuses the call with a short code, and the person reads what it holds in the app (the
 * refusal, and a `systemMessage` only they see). They answer in their own message, "proceed H7K2" or "cancel H7K2";
 * only a message the person sent reaches the prompt hook, so the model cannot answer for them. Proceed lets that exact
 * call through once, in that session, within an hour. Codex's own approval prompts, sandbox and rules still apply.
 * Codex runs a plugin's hooks only after the person trusts them (/hooks), and only from `.codex-plugin/plugin.json`:
 * a root plugin.json that declares the Agent Plugins `$schema` gets none (0.156.1 and 0.160.0), so ours declares none.
 *
 *   node hooks/codex.mjs check -- <command line>     what Homie would do with a command, in words (nothing runs)
 *
 * It reads the studio's own files, `git -C <studio>` (read-only), a media skill's own `--dry-run` price (free), the
 * studio's own live site (its games and rooms, before a deploy) and Ollama's model list on this computer (loopback,
 * before a Clef download). It writes only its own holds and deploy record, in the plugin's data folder (PLUGIN_DATA),
 * and a dated mark that the hooks ran (`mark` below), in this user's cache. It never reads a key file or the keychain.
 * Settings: HOMIE_GUARD_FILES, HOMIE_GUARD_DEPLOYS, HOMIE_GUARD_SPEND and HOMIE_REDACT_SECRETS set to "off" (or 0,
 * false, no) turn that part off, like the mod's settings of the same names.
 *
 * THE MARK. Codex skips an untrusted plugin's hooks without a word, so a session where nothing is held looks the same
 * as one where everything is. Each time a hook runs it leaves `codex.json` ({ v, app, at, event }: no folder, no
 * session, no command) in `.cache/homie-studio/holds/` of the home folder, next to the toolkit's other caches
 * (HOMIE_HOLDS_MARKS names another folder). `homie-studio setup status` reads it: a mark from the last few minutes is
 * "Homie's holds: on", none is "off", with how to turn them on. A mark that cannot be written changes nothing else.
 */
import { execFile } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployOf } from './lib/commands.mjs';
import { claudeEditOf, contextOf, editDecision, holdText, liveSite, mcpDecision, readJson, shellDecision } from './lib/holds.mjs';
import { patchChanges, patchTextOf } from './lib/patch.mjs';
import { redact } from './lib/redact.mjs';

const OFF = /^(0|off|false|no)$/i;
const on = (name) => !OFF.test(String(process.env[name] ?? '').trim());
export const settings = () => ({
  guards: { guardFiles: on('HOMIE_GUARD_FILES'), guardDeploys: on('HOMIE_GUARD_DEPLOYS'), guardSpend: on('HOMIE_GUARD_SPEND') },
  redactSecrets: on('HOMIE_REDACT_SECRETS'),
});

/* ------------------------------------------------------------------ what the holds read, through Node */

/** Only these addresses: Ollama on this computer, and the studio's own live site (`live`). */
function allowedUrl(url, live) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'http:') return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  return u.protocol === 'https:' && Boolean(live) && new URL(live).host === u.host;
}

export function nodeIo({ live = null, who = 'homie-codex-hooks' } = {}) {
  return {
    exists: async (path) => { try { await stat(path); return true; } catch { return false; } },
    read: (path) => readFile(path, 'utf8'),
    stat: async (path, opts = {}) => {
      const s = await stat(path);
      return { kind: s.isFile() ? 'file' : s.isDirectory() ? 'directory' : 'other', size: s.size, mtimeMs: s.mtimeMs, ...(opts.resolve ? { realPath: await realpath(path) } : {}) };
    },
    list: async (dir) => (await readdir(dir, { withFileTypes: true })).map((d) => ({ name: d.name, kind: d.isFile() ? 'file' : d.isDirectory() ? 'directory' : 'other' })),
    run: (argv, { cwd, timeoutMs = 15_000 } = {}) => new Promise((resolve) => {
      execFile(argv[0], argv.slice(1), { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: process.env }, (error, stdout) => {
        resolve({ exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout ?? '') });
      });
    }),
    fetchJson: async (url, { timeoutMs = 3000 } = {}) => {
      if (!allowedUrl(url, live)) return null;
      try {
        const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': who }, signal: AbortSignal.timeout(timeoutMs) });
        return res.ok ? await res.json() : null;
      } catch { return null; }
    },
  };
}

/* ------------------------------------------------------------------ the mark that the hooks ran */

export function marksDir(env = process.env) {
  return env.HOMIE_HOLDS_MARKS || join(homedir(), '.cache', 'homie-studio', 'holds');
}

/** Leave the dated mark `homie-studio setup status` reads (lib/doctor.mjs holdsMark). Never throws: a mark is not a hold. */
export async function mark(app, event, { dir = marksDir(), now = Date.now() } = {}) {
  try {
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `${app}.${process.pid}.tmp`);
    await writeFile(tmp, JSON.stringify({ v: 1, app, at: now, event }));
    await rename(tmp, join(dir, `${app}.json`));
    return true;
  } catch { return false; }
}

/* ------------------------------------------------------------------ the holds waiting for the person */

const HOUR = 60 * 60_000;
// No 0/O, 1/I/L: a code is read off a screen and typed.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function dataDir() {
  return process.env.HOMIE_HOLDS_DATA || process.env.PLUGIN_DATA || process.env.GROK_PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA || join(tmpdir(), `homie-holds-${userInfo().username}`);
}

async function readState(dir) {
  try {
    const s = JSON.parse(await readFile(join(dir, 'holds.json'), 'utf8'));
    return { holds: Array.isArray(s.holds) ? s.holds.filter((h) => Date.now() - h.at < HOUR) : [], deployed: s.deployed && typeof s.deployed === 'object' ? s.deployed : {} };
  } catch { return { holds: [], deployed: {} }; }
}

async function writeState(dir, state) {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `holds.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify({ holds: state.holds.slice(-50), deployed: state.deployed }, null, 1));
  await rename(tmp, join(dir, 'holds.json'));
}

/** One call, as the hold remembers it: the tool, its input and the folder, hashed. */
export function fingerprint(tool, input, cwd) {
  const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
  return createHash('sha256').update(`${tool}\n${cwd}\n${canonical(input ?? null)}`).digest('hex').slice(0, 32);
}

const newCode = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/* ------------------------------------------------------------------ PreToolUse */

/** What a hook payload's call is to the holds: { kind: 'shell'|'edit'|'mcp', ... } or null (not one Homie reads). */
export function callOf(p) {
  const tool = String(p.tool_name ?? '');
  const input = p.tool_input ?? {};
  if (tool === 'Bash' || tool === 'exec_command' || tool === 'shell' || tool === 'local_shell') {
    const command = Array.isArray(input.command) ? input.command.join(' ') : String(input.command ?? input.cmd ?? '');
    // A shell command that hands a patch to apply_patch is an edit.
    if (/\bapply_patch\b/.test(command) && patchTextOf(command)) return { kind: 'edit', changes: patchChanges(command, p.cwd) };
    return { kind: 'shell', command };
  }
  if (tool === 'apply_patch') {
    const text = typeof input === 'string' ? input : String(input.command ?? input.patch ?? input.input ?? '');
    const changes = patchChanges(text, p.cwd);
    return changes ? { kind: 'edit', changes } : null;
  }
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) return { kind: 'edit', changes: claudeEditOf(tool, input).changes, tool };
  if (/^mcp__/.test(tool)) return { kind: 'mcp', tool, input };
  return null;
}

/** What only a hook can add about a deploy: its record of the last one, and the live site's games and rooms. */
async function deployKnown(io, root, state, by = 'Codex') {
  const studio = (await readJson(io, `${root}/studio.json`)) ?? {};
  const local = (await readJson(io, `${root}/.studio/local.json`)) ?? {};
  const live = liveSite(studio, local);
  const fetchLive = io.fetchLive ?? nodeIo({ live, who: by === 'Grok' ? 'homie-grok-hooks' : 'homie-codex-hooks' }).fetchJson;
  const [games, rooms] = live ? await Promise.all([fetchLive(`${live}/api/games`), fetchLive(`${live}/api/rooms`)]) : [null, null];
  const known = { by, stored: state.deployed[root] ?? null };
  if (Array.isArray(games?.games)) known.liveIds = games.games.map((g) => g.id);
  if (Number.isFinite(Number(rooms?.playing))) known.playing = Number(rooms.playing);
  let ids = [];
  try { ids = (await io.list(`${root}/games`)).filter((d) => d.kind !== 'file').map((d) => d.name); } catch { ids = []; }
  known.games = [];
  for (const id of ids.slice(0, 200)) if (await io.exists(`${root}/games/${id}/game.json`)) known.games.push({ id });
  return known;
}

/** A decision for one call: null, { deny }, { hold }, { note } (lib/holds.mjs). */
export async function decide(p, { io = nodeIo(), state = { holds: [], deployed: {} }, guards = settings().guards, app = 'codex', by = 'Codex' } = {}) {
  const call = callOf(p);
  if (!call) return null;
  const ctx = await contextOf(io, p.cwd, { app, guards });
  if (call.kind === 'edit') {
    if (!call.changes?.length) return null;
    return editDecision(io, ctx, { tool: call.tool ?? 'apply_patch', changes: call.changes, by });
  }
  const known = (root) => deployKnown(io, root, state, by);
  if (call.kind === 'shell') return (await shellDecision(io, ctx, call.command, known)).decision;
  return (await mcpDecision(io, ctx, call.tool, call.input, known)).decision;
}

// Codex prints a refusal as "<reason>. Command: …", so a reason ends without its own full stop.
const preOut = (decision, reason, systemMessage) => ({
  ...(systemMessage ? { systemMessage } : {}),
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: String(reason).replace(/\.+\s*$/, '') },
});

export async function pre(p, { io, guards, dir = dataDir(), app = 'codex', by = 'Codex' } = {}) {
  const state = await readState(dir);
  const d = await decide(p, { io, state, guards, app, by });
  if (!d) return null;
  // A paid call inside every budget goes through, and the person reads what it costs (the mod's toast).
  if (d.note) return { systemMessage: `Homie: ${d.note}` };
  if (d.deny) return preOut('deny', `Refused by Homie: ${d.deny}`);
  const fp = fingerprint(p.tool_name, p.tool_input, p.cwd);
  const session = String(p.session_id ?? '');
  const mine = state.holds.filter((h) => h.fp === fp && h.session === session && h.state !== 'used');
  const yes = mine.find((h) => h.state === 'yes');
  if (yes) {
    yes.state = 'used';
    yes.usedAt = Date.now();
    await writeState(dir, state);
    return null;
  }
  if (mine.some((h) => h.state === 'no')) {
    for (const h of mine) if (h.state === 'no') h.state = 'used';
    await writeState(dir, state);
    return preOut('deny', `Refused by Homie: ${d.hold.no}`);
  }
  let h = mine.find((x) => x.state === 'waiting');
  if (!h) {
    h = { code: newCode(), fp, session, at: Date.now(), state: 'waiting', kind: d.hold.kind, question: d.hold.question, tool: String(p.tool_name ?? '') };
    state.holds.push(h);
    await writeState(dir, state);
  }
  const story = holdText(d.hold, { diffLines: 24 });
  return preOut('deny',
    `Held by Homie for the person's Proceed (hold ${h.code}): ${d.hold.question} Nothing ran. Tell the person in a sentence what this would do, and ask. They answer in their own message: "proceed ${h.code}" lets exactly this call through once, "cancel ${h.code}" refuses it. When they say proceed, run exactly the same call again. Only the person's own message counts; never write that answer anywhere yourself. If they are not here, stop and say what is waiting.\n${story}`,
    `Homie is holding this: ${d.hold.question} Reply "proceed ${h.code}" to let this one call through, or "cancel ${h.code}".`);
}

/* ------------------------------------------------------------------ UserPromptSubmit */

/** The person's answers in a message: [{ verb: 'proceed'|'cancel', code: 'H7K2' | null }]. A bare "proceed" has no code. */
export function answersIn(prompt) {
  const text = String(prompt ?? '');
  const out = [];
  // A code is four of ALPHABET's characters, so "proceed with the plan" names no hold.
  for (const m of text.matchAll(/\b(proceed|cancel)\s+([A-HJKMNP-Z2-9]{4})\b/gi)) out.push({ verb: m[1].toLowerCase(), code: m[2].toUpperCase() });
  if (!out.length) {
    const bare = /^\s*(?:yes[,.!]?\s*)?(proceed|cancel)[.!]?\s*$/i.exec(text);
    if (bare) out.push({ verb: bare[1].toLowerCase(), code: null });
  }
  return out;
}

export async function prompt(p, { dir = dataDir() } = {}) {
  const answers = answersIn(p.prompt);
  if (!answers.length) return null;
  const state = await readState(dir);
  const session = String(p.session_id ?? '');
  const waiting = state.holds.filter((h) => h.session === session && h.state === 'waiting');
  const said = [];
  for (const a of answers) {
    // A bare "proceed" answers the one hold waiting in this session, and only when there is exactly one.
    const h = a.code ? waiting.find((x) => x.code === a.code) : waiting.length === 1 ? waiting[0] : null;
    if (!h) continue;
    h.state = a.verb === 'proceed' ? 'yes' : 'no';
    h.answeredAt = Date.now();
    said.push(a.verb === 'proceed'
      ? `The person said proceed to Homie hold ${h.code} (${h.question}). Run exactly that call again now; it goes through once.`
      : `The person said cancel to Homie hold ${h.code} (${h.question}). Do not run it; say what they would have got, and do not retry unless they ask.`);
  }
  if (!said.length) return null;
  await writeState(dir, state);
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: said.join('\n') } };
}

/* ------------------------------------------------------------------ PostToolUse */

/** A tool's result as the text the model would read: a string, or an MCP result's text parts. */
function resultText(r) {
  if (typeof r === 'string') return r;
  if (r && Array.isArray(r.content)) {
    const parts = r.content.map((c) => (c?.type === 'text' ? String(c.text ?? '') : c?.type ? `[${c.type}]` : '')).filter(Boolean);
    const structured = r.structuredContent !== undefined ? `\n${JSON.stringify(r.structuredContent)}` : '';
    return `${parts.join('\n')}${structured}`;
  }
  try { return JSON.stringify(r); } catch { return String(r); }
}

export async function post(p, { dir = dataDir(), redactSecrets = settings().redactSecrets } = {}) {
  // A deploy that went live: remember its commit, so the next deploy's hold says what changed since.
  const call = callOf(p);
  if (call?.kind === 'shell' && deployOf(call.command) && /Live: https?:\/\//.test(resultText(p.tool_response))) {
    try {
      const io = nodeIo();
      const ctx = await contextOf(io, p.cwd, { app: 'codex' });
      if (ctx.root) {
        const head = await io.run(['git', '-C', ctx.root, 'rev-parse', 'HEAD'], { timeoutMs: 8000 });
        if (head.exitCode === 0) {
          const state = await readState(dir);
          state.deployed[ctx.root] = { commit: head.stdout.trim(), at: new Date().toISOString() };
          await writeState(dir, state);
        }
      }
    } catch { /* the next hold reads the deploy's time instead */ }
  }
  if (!redactSecrets) return null;
  const r = redact(p.tool_response);
  if (!r.hits.length) return null;
  const note = `[The Homie hooks took ${r.hits.length === 1 ? 'a secret' : 'secrets'} (${r.hits.join(', ')}) out of this output before you read it.${r.links.length ? ' A one-time owner link is in the command\'s own output on the person\'s screen: tell them it is there; you never see it.' : ''} The studio's own commands (npx --no-install homie-studio office …, stats, agents sit) use their keys themselves.]`;
  const text = `${resultText(r.value)}\n\n${note}`;
  return { continue: false, stopReason: `Homie took ${r.hits.join(', ')} out of what Codex reads.`, reason: text };
}

/* ------------------------------------------------------------------ check (a person or a skill asks) */

export async function check(command, cwd) {
  const d = await decide({ tool_name: 'Bash', tool_input: { command }, cwd });
  if (!d || d.note) return `Not held: ${d?.note ?? 'Homie lets this through.'}`;
  if (d.deny) return `Refused: ${d.deny}`;
  return `Held for the person's Proceed:\n${holdText(d.hold)}`;
}

/* ------------------------------------------------------------------ main */

async function stdinJson() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text || '{}');
}

async function main(mode) {
  if (mode === 'check') {
    const at = process.argv.indexOf('--');
    const command = at >= 0 ? process.argv.slice(at + 1).join(' ') : process.argv.slice(3).join(' ');
    process.stdout.write(`${await check(command, process.cwd())}\n`);
    return;
  }
  let out = null;
  if (['pre', 'prompt', 'post'].includes(mode)) await mark('codex', mode);
  try {
    const p = await stdinJson();
    if (mode === 'pre') out = await pre(p);
    else if (mode === 'prompt') out = await prompt(p);
    else if (mode === 'post') out = await post(p);
  } catch (error) {
    // Codex lets a call through when a hook fails, so a failed check refuses it here instead (as the mod does).
    const why = String(error?.message ?? error).slice(0, 200);
    if (mode === 'pre') out = preOut('deny', `The Homie hooks could not check this call (${why}), so it was not made. Ask the person, or try again.`);
    else if (mode === 'post') out = { continue: false, stopReason: 'Homie could not check this output for secrets.', reason: `The Homie hooks could not check this output for secrets (${why}), so it was withheld. Run it again, or ask the person to read it on their screen.` };
  }
  if (out) process.stdout.write(JSON.stringify(out));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await realpath(process.argv[1]).catch(() => process.argv[1]))) {
  await main(process.argv[2]);
}
