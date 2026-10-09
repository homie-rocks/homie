/**
 * `homie-studio mcp` — the studio toolkit as a LOCAL MCP server (stdio), so the chat that shows Homie's cards also
 * does the building: in the Claude desktop app through the Homie extension (.mcpb, desktop/ in this repository), in
 * Claude Code, Codex or any MCP client. The remote Homie MCP (homie.rocks/mcp) coordinates (directory, hub,
 * progress relay for phones); this one does the work on this computer: studios, games, builds, checks with real
 * browsers, deploys. Tools that overlap the remote ones keep their names and input shapes (lib/mcp-tools.mjs).
 *
 *   homie-studio mcp [--studios <folder>] [--skills <folder>]
 *     --studios   the folder the person's studios live in (the extension's setting; `${HOME}/Studios` is expanded);
 *                 without it, the studio the server was started in (the working directory, or one above it)
 *     --skills    Homie's guides (the plugin's skills folder): studio_guide and the media tools read them
 *     --no-install never run npm install in a studio (tests, and a studio whose node_modules are linked by hand)
 *     --homie     the directory a new studio names (default https://homie.rocks)
 *
 * HOMIE_STUDIO_EXTENSION=1 (the desktop extension's manifest sets it) says the server runs in the Claude desktop app,
 * which asks the person before every tool call: only there, the model is told to say so once (DESKTOP_APPROVALS).
 *
 * The transport is the MCP stdio transport: one JSON-RPC 2.0 message per line on stdin and stdout; logs go to
 * stderr. No SDK. MCP Apps cards (spec 2026-01-26, `text/html;profile=mcp-app`) are served as ui:// resources from
 * mcp/ui/ (real files, read as they are: a card's script is never built from a function's source), and every tool
 * also answers in plain text for a host without cards.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from './studio.mjs';
import { DESKTOP_APPROVALS, StudioContext, UI, availability, inDesktopApp, toolDefs } from './mcp-tools.mjs';
import { stopAllJobs, toolPath } from './jobs.mjs';
import { shrinkPictureData } from './pictures.mjs';
import { STUDIO_VERSION } from './version.mjs';

export const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const MCP_APP_MIME = 'text/html;profile=mcp-app';

export const INSTRUCTIONS = `Homie Studio, on this computer: make game studios and their multiplayer web games, music and videos, run them here, and put them online on the studio's own Cloudflare. (It is not the Homie house app: that app's own server, with its room and TV tools, is a different one.) These tools do the work in this chat; the person never types a command and never needs a terminal. A studio is a folder in the studios folder; the file tools (file_list, file_read, file_edit, file_write, file_search) work inside it.

A new studio follows one checklist, in order and never ahead. Show it in your first reply and again, ticked, as each step ends:
0. Setup status (setup_status; for a studio that is not made yet, pass its name as studio, so the checklist is the new studio's and never another's): what this computer and their accounts have; optional rows never block.
1. The studio (studio_scaffold): it has NO game; its home page says "First game coming soon".
2. See a working game (game_demo): a live game on Homie Arcade with its Play link, nothing copied in. Copy a starter in (game_make) only if they ask.
3. One small change from one sentence of theirs: to the copied game, or to the studio's home (site/theme.json colours, a tagline in studio.json, a first post in posts/). Then build and preview_run, and they reload.
4. Plan their game (game_plan): a short interview, two or three questions a message with options and your pick; then fill games/<id>/CODEX.md and show it (game_codex). Look for pieces first: the @homie-rocks/* packages for general mechanisms, and parts_find for pieces other studios shared (part_add brings one in).
5. Build it: build_open, then game_make under the planned id (the codex stays), file edits (few and large: one file_edit carries every change to a file in its edits list, never a call per change), build, preview_run, check. The card follows every build.
For a shop: stripe_login (shop connect) syncs Products, Prices, Payment Links and the webhook through Stripe CLI browser approval. Follow studio_job. Default is keyless: no API key in the Worker, no human-handled key. Rerun after shop.json changes. Never expose CLI credentials or webhook secrets. Follow the single next step, verify purchase/webhook/grant and a refund in Stripe or through the connected AI. An existing Worker key selects fuller carts, caps, expiry, automatic recovery and office refunds; explain that only when requested. Never choose manual automatically. Lost webhook: resend from Stripe, never grant from the return URL. Live only when requested.
6. Playtest it (playtest), then put it online: studio_deploy with plan: true first (say what it creates and costs, free), cloudflare_login when not signed in (they approve once in their browser), studio_deploy, then studio_publish.
If they ask for everything at once, show the list, make your own choices for steps 2 to 4 in one line each, and go on.

If studio_scaffold finds an earlier folder of the studio's name that is not a studio, ask the person whether to fold its premise in (studio_fold), and remove it only with a second yes.

A studio made elsewhere (on a phone, with Deploy to Cloudflare, so it lives on GitHub): studio_open with its repo clones it into the studios folder with this computer's own GitHub sign-in; github_login signs the computer in with GitHub's one-time code. Never ask for a token.

Links are the person's to open: give them in your reply (the cards have their own buttons). Never open a browser or run a command such as open to open one yourself.

To make one mechanic of a game feel better (a jump, a hit, a dash), game_lab opens the Game Lab: New beside Today, one take, its phases and sliders (studio_guide { "topic": "lab" }).

A game's look is a set of decisions (render style, palette, light, camera, fonts, the cast and its budgets), automatic from the person's words until they steer or lock one (studio_guide { "topic": "style" }). style_explore draws three directions with the game engine for free; decision_set picks, steers and locks; assets_find searches the free CC0 starter library and asset_add copies a model in with its licence; asset_make makes a prop on the person's own fal account only after they agreed to its price; asset_check, asset_lineup and asset_rights keep it one game, phone-sized and properly licensed (studio_guide { "topic": "models" }).

A game as an app of its own (a desktop app for macOS, Windows and Linux; an iPhone or Android app): game_standalone, with plan: true first. It is the same web game in a thin shell and still plays through the studio's own site. Say plainly what its plan says a standalone copy does not have (no accounts, cloud saves, shop or chat), that a build is the kind of file Steam or a store accepts for upload and never a promise it is accepted, that nothing is uploaded for them, and what its result says was started and what was only built (studio_guide { "topic": "standalone" }).

Telling Homie (homie_feedback): when the person is stuck, confused or frustrated, after an error you could not fix, or at the end of their first studio setup or first publish, you may OFFER, once a session, to send the people who make Homie a short note about it. Draft it in plain words from what happened (it sends nothing), show it exactly as it would go (its card has Send, Edit and Don't send), and send only after they say yes. Never nag: a no is final for the session. When they ask to tell Homie something, draft it with offered: false.

Long work (npm install, check, playtest, deploy, renders) runs in the background: the tool answers at once with a card that follows it, and build_progress or studio_job reads where it is. studio_guide has Homie's full guide for each job (game, plan, port, playtest, publish, music, sound, art, video). Never put a key or password in a file or the chat. If Homie's homie.rocks connector is connected too, its tools of the same names say what to run; these run it.`;

/** What the server tells the model as it connects: the checklist, and in the Claude desktop app what it asks the person. */
export const instructionsFor = ({ desktop = false } = {}) => (desktop ? `${INSTRUCTIONS}\n\n${DESKTOP_APPROVALS}` : INSTRUCTIONS);

const CARD_FILES = { [UI.setup]: 'setup.js', [UI.build]: 'build.js', [UI.studio]: 'studio.js', [UI.codex]: 'codex.js', [UI.lab]: 'lab.js', [UI.style]: 'style.js', [UI.decision]: 'decision.js', [UI.cast]: 'cast.js', [UI.lineup]: 'lineup.js', [UI.rights]: 'rights.js', [UI.animation]: 'animation.js', [UI.feedback]: 'feedback.js' };
const CARD_TITLES = { [UI.setup]: 'Studio setup', [UI.build]: 'Build progress', [UI.studio]: 'Studio', [UI.codex]: 'Game Codex', [UI.lab]: 'Game Lab', [UI.style]: 'Style board', [UI.decision]: 'Look decision', [UI.cast]: 'Cast', [UI.lineup]: 'Lineup', [UI.rights]: 'Rights', [UI.animation]: 'Clips', [UI.feedback]: 'Tell Homie' };
const UI_DIR = join(PACKAGE_ROOT, 'mcp', 'ui');

/** One card's whole document: the shared look and bridge, and the card's own script, as the files are. */
export function cardHtml(uri) {
  const own = CARD_FILES[uri];
  if (!own) return null;
  const css = readFileSync(join(UI_DIR, 'card.css'), 'utf8');
  const bridge = readFileSync(join(UI_DIR, 'bridge.js'), 'utf8');
  const script = readFileSync(join(UI_DIR, own), 'utf8');
  const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${CARD_TITLES[uri]} · Homie</title><style>${safe(css)}</style></head><body><main id="root" class="card" aria-live="polite"><div class="skel"></div><div class="skel"></div></main><script>${safe(bridge)}\n${safe(script)}</script></body></html>`;
}

/** What a card may load: nothing from the network, except the codex page's Google Fonts. */
export function cardCsp(uri) {
  // The codex page, and the style board's type samples in each direction's fonts: Google Fonts only.
  if (uri === UI.codex || uri === UI.style) return { connectDomains: [], resourceDomains: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'] };
  return { connectDomains: [], resourceDomains: [] };
}

/*
 * ONE ANSWER, AT MOST RESULT_MAX. The Claude desktop app refuses a tool result over 1 MB. Every tools/call answer goes
 * through fitResult on its way out: pictures first (a smaller copy, else left out), then the card's pictures, then the
 * text (cut, and saying so), and last the card's data itself. What was left out is said in the answer's text.
 */
export const RESULT_MAX = 900_000;
const sizeOf = (r) => JSON.stringify(r).length;

/** Every data: URL in a card's data (a feed's preview, a codex's art, a studio's covers) taken out. */
function withoutDataUrls(v) {
  if (typeof v === 'string') return v.startsWith('data:') && v.length > 1024 ? null : v;
  if (Array.isArray(v)) return v.map(withoutDataUrls);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutDataUrls(x)]));
  return v;
}

export function fitResult(result, { max = RESULT_MAX, shrink = shrinkPictureData } = {}) {
  if (!result || typeof result !== 'object' || sizeOf(result) <= max) return result;
  const r = JSON.parse(JSON.stringify(result));
  const said = [];
  const content = Array.isArray(r.content) ? r.content : (r.content = []);
  for (let i = 0; i < content.length && sizeOf(r) > max; i++) {
    const c = content[i];
    if (c?.type !== 'image') continue;
    const small = shrink(c.data, c.mimeType);
    if (small && small.data.length < c.data.length) { content[i] = { ...c, ...small }; said.push('a picture went as a smaller copy'); }
    else { content[i] = { type: 'text', text: '(A picture was left out: too big for one answer.)' }; said.push('a picture was left out'); }
  }
  if (sizeOf(r) > max && r.structuredContent) { r.structuredContent = withoutDataUrls(r.structuredContent); said.push('the card shows no pictures this time'); }
  if (sizeOf(r) > max) {
    // The longest text goes down to what fits, cut at a line's end.
    const texts = content.filter((c) => c?.type === 'text' && typeof c.text === 'string').sort((a, b) => b.text.length - a.text.length);
    for (const t of texts) {
      const over = sizeOf(r) - max;
      if (over <= 0) break;
      const keep = Math.max(0, t.text.length - over - 400);
      const cut = t.text.slice(0, keep);
      t.text = `${cut.slice(0, Math.max(cut.lastIndexOf('\n'), Math.floor(keep * 0.9)))}\n…`;
      said.push('the text was cut');
    }
  }
  if (sizeOf(r) > max && r.structuredContent) { delete r.structuredContent; said.push('the card had no room for its data'); }
  if (said.length) content.push({ type: 'text', text: `(This answer was over ${Math.round(max / 1000)} KB, the most one answer may be here: ${[...new Set(said)].join('; ')}.)` });
  return r;
}

export const PROMPTS = [
  { name: 'new-studio', title: 'Set up a game studio', description: 'Make a game studio on this computer and go through Homie\'s new-studio checklist.', arguments: [{ name: 'name', description: 'The studio\'s name', required: false }] },
  { name: 'make-multiplayer', title: 'Make my game multiplayer', description: 'Port an existing single-player web game on this computer into a studio.', arguments: [{ name: 'folder', description: 'The game\'s folder', required: true }] },
];

function promptText(name, args = {}) {
  if (name === 'new-studio') return `Set up a game studio${args.name ? ` called ${String(args.name).slice(0, 60)}` : ''} with Homie, step by step.`;
  if (name === 'make-multiplayer') return `Make the game in ${String(args.folder ?? '').slice(0, 200)} multiplayer on my Homie studio.`;
  return null;
}

/**
 * The server. `input`/`output` are streams (stdin/stdout by default). Returns a promise that ends with the input.
 */
export async function serveMcp({ studios = null, skills = null, cwd = process.cwd(), input = process.stdin, output = process.stdout, waitMs, directory = null, install = true, desktop = inDesktopApp(), log = (line) => process.stderr.write(`[homie-studio mcp] ${line}\n`) } = {}) {
  // A GUI app starts this with a short PATH: everything it runs sees the usual places Node, npm and ffmpeg live.
  process.env.PATH = toolPath();
  const skillsDir = skills ?? [join(PACKAGE_ROOT, '..', '..', 'plugins', 'homie', 'skills'), join(PACKAGE_ROOT, '..', 'skills')].find((d) => existsSync(join(d, 'studio-setup', 'SKILL.md'))) ?? null;
  const ctx = new StudioContext({ studiosDir: studios, cwd, skillsDir, waitMs: waitMs ?? Number(process.env.HOMIE_MCP_WAIT_MS || 40_000), directory, install, desktop });
  let avail = availability();
  let names = '';
  const send = (message) => output.write(`${JSON.stringify(message)}\n`);
  const tools = () => {
    const list = toolDefs(ctx, avail);
    const now = list.map((t) => t.name).join(',');
    names = now;
    return list;
  };
  tools();
  log(`ready: toolkit ${STUDIO_VERSION}, studios ${ctx.studiosDir ?? '(none set)'}${ctx.cwdStudio ? `, started in ${ctx.cwdStudio}` : ''}${skillsDir ? ', guides on' : ''}`);

  async function handle(message) {
    const { id, method, params } = message ?? {};
    const isRequest = message && Object.hasOwn(message, 'id') && id !== null && id !== undefined;
    const reply = (result) => { if (isRequest) send({ jsonrpc: '2.0', id, result }); };
    const error = (code, text) => { if (isRequest) send({ jsonrpc: '2.0', id, error: { code, message: text } }); };
    try {
      switch (method) {
        case 'initialize': {
          const asked = params?.protocolVersion;
          // Which app this is (Claude Code, Codex, the Claude desktop app): a note to Homie says so, and nothing more.
          ctx.client = params?.clientInfo ?? null;
          return reply({
            protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
            capabilities: { tools: { listChanged: true }, resources: { listChanged: false }, prompts: { listChanged: false } },
            serverInfo: { name: 'homie-studio', title: 'Homie Studio', version: STUDIO_VERSION },
            instructions: instructionsFor({ desktop: ctx.desktop }),
          });
        }
        case 'ping': return reply({});
        case 'tools/list':
          return reply({ tools: tools().map(({ run, ...t }) => t) });
        case 'tools/call': {
          const name = params?.name;
          const tool = tools().find((t) => t.name === name);
          if (!tool) return reply({ content: [{ type: 'text', text: `No tool ${name} here.` }], isError: true });
          const t0 = Date.now();
          let result;
          try { result = await tool.run(params?.arguments ?? {}); } catch (e) { result = { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true }; }
          log(`${name} ${result?.isError ? 'failed' : 'ok'} in ${Date.now() - t0} ms`);
          reply(fitResult(result));
          // A media provider set up meanwhile adds its tool.
          const before = names;
          avail = availability();
          tools();
          if (names !== before) send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
          return undefined;
        }
        case 'resources/list':
          return reply({ resources: Object.values(UI).map((uri) => ({ uri, name: uri.split('/').pop(), title: CARD_TITLES[uri], mimeType: MCP_APP_MIME })) });
        case 'resources/templates/list': return reply({ resourceTemplates: [] });
        case 'resources/read': {
          const uri = String(params?.uri ?? '');
          const html = cardHtml(uri);
          if (!html) return error(-32002, `no resource ${uri}`);
          return reply({ contents: [{ uri, mimeType: MCP_APP_MIME, text: html, _meta: { ui: { csp: cardCsp(uri), prefersBorder: false } } }] });
        }
        case 'prompts/list': return reply({ prompts: PROMPTS });
        case 'prompts/get': {
          const p = PROMPTS.find((x) => x.name === params?.name);
          if (!p) return error(-32602, `no prompt ${params?.name}`);
          return reply({ description: p.description, messages: [{ role: 'user', content: { type: 'text', text: promptText(p.name, params?.arguments) } }] });
        }
        case 'logging/setLevel': return reply({});
        default:
          if (!isRequest) return undefined; // notifications/initialized, notifications/cancelled, …
          return error(-32601, `method not found: ${method}`);
      }
    } catch (e) {
      return error(-32603, e instanceof Error ? e.message : String(e));
    }
  }

  let buffer = '';
  const pending = new Set();
  await new Promise((done) => {
    input.setEncoding?.('utf8');
    input.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); continue; }
        const p = handle(msg).finally(() => pending.delete(p));
        pending.add(p);
      }
    });
    input.on('end', done);
    input.on('close', done);
  });
  await Promise.allSettled([...pending]);
  stopAllJobs();
}
