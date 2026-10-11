#!/usr/bin/env node
/**
 * HOMIE'S HOLDS IN GROK. Grok Build runs this as the plugin's lifecycle hooks (hooks/grok.json), with the hook's
 * JSON on stdin and its answer on stdout. The decision is Codex's (hooks/codex.mjs), which asks lib/holds.mjs, the
 * same module the Claude Code mod asks, so the three apps hold the same calls with the same words. Only the envelope
 * is Grok's: its tool names (run_terminal_command, search_replace, server__tool) and its answers ({ decision, reason }).
 *
 * WHAT GROK GIVES AND TAKES (its own hooks guide, read at Grok 1.0.46). The event arrives on stdin in camelCase:
 * `toolName`, `toolInput`, `sessionId`, `cwd`, `workspaceRoot`, and after a tool `toolResult` (with a `tool_response`
 * copy). An MCP tool's name is `server__tool`. A PreToolUse hook answers { decision: "allow" | "deny", reason } on
 * stdout; a hook that crashes, times out (5 s unless the hooks file says more, and ours does) or prints something
 * else FAILS OPEN, so a call that cannot be checked is answered with an explicit deny here, as the mod denies. A hold
 * denies the call with a short code. The person answers in their own message, "proceed H7K2" or "cancel H7K2";
 * UserPromptSubmit records it (Grok discards what an allowing prompt hook prints, so nothing is printed), and the
 * same call then goes through once. Grok also has an "ask" answer that raises its own permission prompt; a client
 * that approves every prompt would approve that too, so a hold stays a deny that only the person's own message
 * lifts. Grok's own approval prompts still apply. PostToolUse cannot stop anything, but it replaces what the model
 * reads: `hookSpecificOutput.updatedToolOutput` as a string is the model's copy of the result (lib/redact.mjs takes
 * the secrets out of it); the person's scrollback keeps the original.
 *
 * WHERE GROK FINDS THESE HOOKS. Grok reads the hooks file a plugin's ROOT plugin.json names, and with none named it
 * loads hooks/hooks.json. Ours is the Claude Code mod's file (modules, no "hooks" object), so until the root
 * plugin.json named hooks/grok.json Grok registered nothing from this plugin: its log said "total_hooks=0", a deploy
 * ran unheld, and 0.30.2 wrongly concluded that Grok runs no plugin's hooks. It does, once the plugin is trusted
 * (`grok plugin install … --trust`). test/manifests.test.mjs keeps the root manifest pointing here.
 *
 *   node hooks/grok.mjs check -- <command line>     what Homie would do with a command, in words (nothing runs)
 *
 * It writes only its own holds, in GROK_PLUGIN_DATA (or HOMIE_HOLDS_DATA), and the dated mark that the hooks ran
 * (hooks/codex.mjs `mark`: `grok.json` in this user's cache), which `homie-studio setup status --client grok` reads to
 * say whether Homie's holds are on. It never reads a key file.
 */
import { realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, mark, post, pre, prompt } from './codex.mjs';
import { holdText } from './lib/holds.mjs';

const SHELL = new Set(['bash', 'run_terminal_cmd', 'run_terminal_command', 'exec_command', 'shell', 'local_shell']);
const EDIT = new Set(['edit', 'search_replace', 'strreplace', 'multiedit', 'multi_edit']);
const WRITE = new Set(['write', 'write_file', 'create_file']);

/** A Grok hook payload as the Codex hooks read it, or null when it is not a call Homie looks at. */
export function asCodex(p) {
  const raw = String(p.tool_name ?? p.toolName ?? '');
  const key = raw.toLowerCase();
  const cwd = p.cwd ?? p.workspaceRoot ?? process.cwd();
  const abs = (path) => (!path || isAbsolute(path) ? path : join(cwd, path));
  let tool = raw;
  let input = p.tool_input ?? p.toolInput ?? {};
  if (input && typeof input === 'object' && !Array.isArray(input)) input = { ...input };
  if (SHELL.has(key)) tool = 'Bash';
  else if (EDIT.has(key) || key === 'notebookedit') {
    tool = key === 'notebookedit' ? 'NotebookEdit' : key.includes('multi') ? 'MultiEdit' : 'Edit';
    if (input && !input.file_path) input.file_path = input.path ?? input.target_file ?? input.notebook_path ?? '';
    if (input?.file_path) input.file_path = abs(input.file_path);
    if (input?.notebook_path) input.notebook_path = abs(input.notebook_path);
  } else if (WRITE.has(key)) {
    tool = 'Write';
    if (input && input.content === undefined) input.content = input.contents ?? input.text ?? '';
    if (input && !input.file_path) input.file_path = input.path ?? input.target_file ?? '';
    if (input?.file_path) input.file_path = abs(input.file_path);
  } else if (key === 'apply_patch') tool = 'apply_patch';
  else if (raw.startsWith('mcp__') || raw.includes('__')) tool = raw.startsWith('mcp__') ? raw : `mcp__${raw}`;
  else return null;
  return {
    tool_name: tool,
    tool_input: input,
    cwd,
    session_id: sessionOf(p),
    prompt: p.prompt ?? p.user_prompt ?? p.userPrompt ?? p.message ?? '',
    tool_response: p.toolResult ?? p.tool_response ?? p.toolResponse ?? p.tool_output ?? p.toolOutput,
  };
}

/** The session a payload belongs to: its own `sessionId`, else the one Grok sets for every hook process. */
function sessionOf(p) {
  return String(p.sessionId ?? p.session_id ?? process.env.GROK_SESSION_ID ?? '');
}

const GROK = { app: 'grok', by: 'Grok' };

function reasonOf(out) {
  return out?.hookSpecificOutput?.permissionDecisionReason ?? out?.systemMessage ?? '';
}

/** Codex's answer as Grok's: allow, or deny with the reason the model and the person both read. */
export function toGrok(mode, out) {
  if (!out) return mode === 'pre' ? { decision: 'allow' } : null;
  if (mode === 'pre') {
    const denied = out.hookSpecificOutput?.permissionDecision === 'deny';
    if (!denied) {
      const note = out.systemMessage;
      return note
        ? { decision: 'allow', hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: note } }
        : { decision: 'allow' };
    }
    const reason = reasonOf(out);
    const seen = out.systemMessage && !reason.includes(out.systemMessage) ? `${out.systemMessage} ${reason}` : reason;
    return { decision: 'deny', reason: seen };
  }
  // Grok discards what an allowing UserPromptSubmit hook prints, and reads { decision: "block" } as "refuse this
  // prompt": the person's answer is recorded and nothing is printed.
  if (mode === 'prompt') return null;
  return withheld(String(out.reason ?? ''), String(out.stopReason ?? '').replace(/Codex/g, 'Grok'));
}

/**
 * A PostToolUse answer that replaces what the model reads with `text` (a string is taken verbatim for every tool) and
 * tells it why in a line. `mcp` adds the MCP-only spelling of the same key.
 */
export function withheld(text, why, { mcp = false } = {}) {
  return {
    hookSpecificOutput: { hookEventName: 'PostToolUse', ...(why ? { additionalContext: why } : {}), updatedToolOutput: text, ...(mcp ? { updatedMCPToolOutput: text } : {}) },
  };
}

export async function grokPre(p, opts = {}) {
  const call = asCodex(p);
  if (!call) return { decision: 'allow' };
  return toGrok('pre', await pre(call, { ...opts, ...GROK }));
}

/** The person's own "proceed <code>" or "cancel <code>": recorded, and nothing is printed. `said` is what it answered (tests). */
export async function grokPrompt(p, opts = {}) {
  const call = { cwd: p.cwd ?? p.working_directory, prompt: p.prompt ?? p.userPrompt ?? p.user_prompt ?? p.message ?? '', session_id: sessionOf(p) };
  const out = await prompt(call, opts);
  return out ? { said: out.hookSpecificOutput?.additionalContext ?? '' } : null;
}

export async function grokPost(p, opts = {}) {
  const call = asCodex(p);
  if (!call) return null;
  const out = await post(call, opts);
  if (!out) return null;
  return withheld(String(out.reason ?? ''), String(out.stopReason ?? '').replace(/Codex/g, 'Grok'), { mcp: String(call.tool_name ?? '').startsWith('mcp__') });
}

async function stdinJson() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text || '{}');
}

async function main(mode) {
  if (mode === 'check') {
    const at = process.argv.indexOf('--');
    const command = at >= 0 ? process.argv.slice(at + 1).join(' ') : process.argv.slice(3).join(' ');
    const d = await decide({ tool_name: 'Bash', tool_input: { command }, cwd: process.cwd() }, GROK);
    const text = !d || d.note ? `Not held: ${d?.note ?? 'Homie lets this through.'}` : d.deny ? `Refused: ${d.deny}` : `Held for the person's Proceed:\n${holdText(d.hold)}`;
    process.stdout.write(`${text}\n`);
    return;
  }
  let out = null;
  if (['pre', 'prompt', 'post'].includes(mode)) await mark('grok', mode);
  try {
    const p = await stdinJson();
    if (mode === 'pre') out = await grokPre(p);
    else if (mode === 'prompt') await grokPrompt(p);
    else if (mode === 'post') out = await grokPost(p);
  } catch (error) {
    const why = String(error?.message ?? error).slice(0, 200);
    if (mode === 'pre') out = { decision: 'deny', reason: `The Homie hooks could not check this call (${why}), so it was not made. Ask the person, or try again.` };
    // A block here would only add a line beside the output; replacing the output is what withholds it.
    else if (mode === 'post') out = withheld(`The Homie hooks could not check this output for secrets (${why}), so it was withheld. Run it again, or ask the person to read it on their screen.`, 'Homie could not check this output for secrets.', { mcp: true });
  }
  if (out) process.stdout.write(JSON.stringify(out));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await realpath(process.argv[1]).catch(() => process.argv[1]))) {
  await main(process.argv[2]);
}
