/**
 * Which chat is building the studio. Named only when the session says so (`--client`, or HOMIE_CLIENT).
 * Anything else is "the chat": never a guess that it is Claude. Grok has no Cloudflare connector and no
 * Claude Code window; `--client grok` is how a Grok Bot checks a repository in.
 */
const KNOWN = {
  claude: { id: 'claude', card: "the Claude app's card", connect: 'Connect this chat' },
  codex: { id: 'codex', card: "Codex's card", connect: 'Connect this chat' },
  grok: { id: 'grok', card: "Grok's card", connect: 'Connect this chat' },
  chat: { id: 'chat', card: 'the setup card', connect: 'Connect this chat' },
};
const ALIAS = { 'claude-code': 'claude', 'claude-app': 'claude', 'grok-bot': 'grok', grokbot: 'grok' };

/** @param {string | null | undefined} input  `--client`, or null to read HOMIE_CLIENT */
export function studioClient(input, env = process.env) {
  const raw = String(input ?? env.HOMIE_CLIENT ?? '').trim().toLowerCase();
  const id = ALIAS[raw] ?? raw;
  return KNOWN[id] ?? KNOWN.chat;
}
