#!/usr/bin/env node
/**
 * Homie for the Claude desktop app (a Desktop Extension, .mcpb): Homie's studio toolkit, @homie-rocks/studio, bundled
 * beside this file in studio/, as a local MCP server (studio/lib/mcp.mjs), with Homie's guides (the plugin's skills)
 * in skills/. The same chat that shows Homie's cards makes the studio, its games, the checks and the deploys, on this
 * computer: no terminal and no second session.
 *
 * The app passes the person's studios folder (the extension's one setting) as --studios; its default arrives as the
 * text `${HOME}/Studios`, which the server expands.
 */
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf('--studios');
const studios = (at >= 0 ? args[at + 1] : null) || process.env.HOMIE_STUDIOS || '${HOME}/Studios';
const { serveMcp } = await import('./studio/lib/mcp.mjs');
await serveMcp({ studios, skills: join(here, 'skills'), cwd: homedir(), install: !args.includes('--no-install') });
