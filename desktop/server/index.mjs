#!/usr/bin/env node
/**
 * Homie for the Claude desktop app (a Desktop Extension, .mcpb): Homie's studio toolkit, @homie-rocks/studio, bundled
 * beside this file in studio/, as a local MCP server (studio/lib/mcp.mjs), with Homie's guides (the plugin's skills)
 * in skills/. The same chat that shows Homie's cards makes the studio, its games, the checks and the deploys, on this
 * computer: no terminal and no second session.
 *
 * The app passes the person's studios folder (the extension's one setting) as --studios; its default arrives as the
 * text `${HOME}/Studios`, which the server expands. The setting is not required, so the app turns the extension on as
 * it installs it; when the app passes no folder (an empty value, or its placeholder left as written), the default is
 * used.
 */
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_STUDIOS = '${HOME}/Studios';
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

/** The folder the app passed, or null: none, an empty value, or a placeholder the app did not fill in. */
function studiosArg(list) {
  const at = list.indexOf('--studios');
  const value = at >= 0 ? String(list[at + 1] ?? '').trim() : '';
  if (!value || value.startsWith('--') || /\$\{user_config\.[^}]*\}/.test(value)) return null;
  return value;
}

const studios = studiosArg(args) || process.env.HOMIE_STUDIOS || DEFAULT_STUDIOS;
const { serveMcp } = await import('./studio/lib/mcp.mjs');
await serveMcp({ studios, skills: join(here, 'skills'), cwd: homedir(), install: !args.includes('--no-install') });
