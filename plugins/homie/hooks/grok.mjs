#!/usr/bin/env node
/**
 * HOMIE'S HOLDS IN GROK. Grok Build runs this as the plugin's lifecycle hooks (hooks/grok.json), with the hook's
 * JSON on stdin and its answer on stdout. The decision is Codex's (hooks/codex.mjs), which asks lib/holds.mjs, the
 * same module the Claude Code mod asks, so the three apps hold the same calls with the same words. Only the envelope
 * is Grok's: its tool names (run_terminal_command, search_replace, server__tool) and its answers ({ decision, reason }).
 *
 * Grok's documented PreToolUse answers are allow and deny (a crash fail-opens, so a hold that cannot be checked is
 * denied here, as the mod denies). A hold denies the call with a short code. The person answers in their own message,
 * "proceed H7K2" or "cancel H7K2"; UserPromptSubmit records it, and the same call then goes through once. Grok's own
 * approval prompts still apply. PostToolUse takes secrets out of what the model reads (lib/redact.mjs).
 *
 *   node hooks/grok.mjs check -- <command line>     what Homie would do with a command, in words (nothing runs)
 *
 * It writes only its own holds, in GROK_PLUGIN_DATA (or HOMIE_HOLDS_DATA). It never reads a key file.
 */
import { realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, post, pre, prompt } from './codex.mjs';
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
    session_id: String(p.session_id ?? p.sessionId ?? ''),
    prompt: p.prompt ?? p.user_prompt ?? p.userPrompt ?? p.message ?? '',
    tool_response: p.tool_response ?? p.toolResponse ?? p.tool_output ?? p.toolOutput,
  };
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
  if (mode === 'prompt') return out;
  const text = String(out.reason ?? out.stopReason ?? '');
  return {
    decision: 'block',
    reason: text,
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text, updatedToolOutput: text },
  };
}

export async function grokPre(p, opts = {}) {
  const call = asCodex(p);
  if (!call) return { decision: 'allow' };
  return toGrok('pre', await pre(call, { ...opts, ...GROK }));
}

export async function grokPrompt(p, opts = {}) {
  const call = asCodex(p) ?? { prompt: p.prompt ?? p.userPrompt ?? '', session_id: String(p.session_id ?? p.sessionId ?? '') };
  return toGrok('prompt', await prompt({ ...call, prompt: call.prompt }, opts));
}

export async function grokPost(p, opts = {}) {
  const call = asCodex(p);
  if (!call) return null;
  const out = await post(call, opts);
  if (!out) return null;
  const grok = toGrok('post', out);
  const tool = String(call.tool_name ?? '');
  if (tool.startsWith('mcp__')) {
    grok.hookSpecificOutput = { hookEventName: 'PostToolUse', additionalContext: grok.reason, updatedMCPToolOutput: grok.reason };
  }
  return grok;
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
  try {
    const p = await stdinJson();
    if (mode === 'pre') out = await grokPre(p);
    else if (mode === 'prompt') out = await grokPrompt(p);
    else if (mode === 'post') out = await grokPost(p);
  } catch (error) {
    const why = String(error?.message ?? error).slice(0, 200);
    if (mode === 'pre') out = { decision: 'deny', reason: `The Homie hooks could not check this call (${why}), so it was not made. Ask the person, or try again.` };
    else if (mode === 'post') out = { decision: 'block', reason: `The Homie hooks could not check this output for secrets (${why}), so it was withheld. Run it again, or ask the person to read it on their screen.` };
  }
  if (out) process.stdout.write(JSON.stringify(out));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await realpath(process.argv[1]).catch(() => process.argv[1]))) {
  await main(process.argv[2]);
}
