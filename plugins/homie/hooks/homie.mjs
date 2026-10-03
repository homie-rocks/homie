/**
 * THE HOMIE STUDIO MOD (Claude Code 2.1.287 and later; the CLI and the desktop app's Code tab).
 *
 * Inside a Homie studio (a folder with studio.json at or above the session's), it draws:
 * - the band above the prompt: studio · game · build step and % · ▶ Play · N playing now;
 * - the Studio pane (/studio): Build (the progress feed, stages going green, the latest check frame, a live Watch),
 *   Rooms (live rooms with players and AI, Watch/Join links, Announce, Kick and Mute through the studio's own back
 *   office, which only ASKS for a kick or a mute: the owner confirms each with one tap in their own browser),
 *   Games (launch state and the remix switch, asked for the same way), Stats, Codex, Lab, Parts (the parallel skill's
 *   agents) and Art (art direction: the phase strip, the look, each decision with Lock and Unlock, the cast, the scene
 *   budgets, the spend and the licences); it opens by itself when a build starts, where the terminal is wide enough
 *   for a pane nobody asked for;
 * - the arcade (/arcade): a real seat in a public room of a live Homie game, played in the pane while Claude works;
 * - Homie's tool results as checklists, check rows, verdicts and live links (and the commands' rows in words).
 * Instant commands, no Claude turn: /studio /play /watch /rooms /build /codex /deploy-status /perf-numbers /parts
 * /arcade /look /lock /assets /lineup /rights.
 * Guards on tool calls: an edit to a file studio.json "protect" lists, a production deploy, a paid media call past
 * the studio's budget, and a Clef model download through Ollama (about 11 GB) are held with what would change and
 * Proceed / Cancel. Refused outright: a change to a
 * decision the person locked (games/<id>/codex/decisions.json), a deploy that ships an asset with no allowed licence
 * in a public game, a `git add` or `git commit` that would put a file over 5 MB under games/ into git, and a write
 * through Stripe's MCP whose answer would carry a webhook's signing secret into the conversation. Secrets are taken
 * out of every tool result before Claude reads it.
 *
 * WHAT IT REACHES. Files: the studio's own (studio.json, .studio/, games/*, budgets, CODEX.md, .perf/), the file a
 * held edit names, and the size of a file a `git add` or `git commit` would stage. Network ($.http.fetch): only the
 * studio's own site (its live address or this computer's dev site), *.homie.rocks (the Homie Arcade game list), its
 * own game bridge over a private Unix socket, and Ollama's list of models on this computer (loopback, before a Clef
 * model would be downloaded). Processes: `git` (read-only), the studio's own pinned
 * `homie-studio` (office, stats, codex link, progress stop, style lock / unlock / blast; each with --json), a media
 * skill's own `--dry-run` price, and the plugin's game bridge (mod/bridge.mjs: a headless Chrome seat, only while the
 * arcade or a live Watch is open). It never reads a key file, the keychain or the environment, never approves a
 * permission, never opens a browser, and never sends anything to a model.
 *
 * Mods have strict rules for the mods API (the README's "What the Homie mod does"): every call is spelled
 * `$.namespace.method(...)` here, and a helper that takes `$` is a function declared at the top of this file.
 */
import { GAME_ID, artFor, artSummaryOf, castText, charactersText, clipsText, lineupText, lookText, rightsText, usd } from './lib/art.mjs';
import { summarizeCodex } from './lib/codex.mjs';
import { studioCalls } from './lib/commands.mjs';
import { ago, feedOf, summarize } from './lib/feed.mjs';
import { claudeEditOf, cloudflareMcpDecision, deployFacts, editDecision, holdText, liveSite, mcpDeployDecision, paidMcpDecision, shellDecision, stripeDecision } from './lib/holds.mjs';
import { redact } from './lib/redact.mjs';
import { readResult } from './lib/results.mjs';
import {
  arcadeView, artTab, band, buildCard, buildTab, checksCard, codexTab, deployCard, gamesTab, guardPanel, holdPane, labTab, partsView, linkable,
  paneFrame, roomsTab, setupCard, statsTab, studioCard, toolUseRow,
} from './lib/views.mjs';

const PANE = 'homie-studio';
const PARTS = 'homie-parts';
const ARCADE = 'homie-arcade';
const HOLD = 'homie-hold';
const ARCADE_HOME = 'https://arcade.homie.rocks';
const TICK_MS = 2000;
const RECENT_MS = 10 * 60_000;

const DEFAULTS = Object.freeze({
  paneAutoOpen: true, band: true, guardFiles: true, guardDeploys: true, guardSpend: true, redactSecrets: true,
  renderResults: true, arcade: true, pictures: 'blocks',
});
let OPT = { ...DEFAULTS };

const LABELS = {
  'setup status': 'Setup status', doctor: 'Setup status', 'setup attach': 'Attach the setup card', check: 'Two-browser check',
  'port check': 'Port check', 'port plan': 'Port plan', 'port import': 'Port import', deploy: 'Deploy', 'wrangler deploy': 'Deploy (Wrangler)',
  build: 'Build the site', dev: 'Dev site', publish: 'List in the directory', 'progress start': 'Start a build', 'progress attach': 'Take the build',
  'progress stage': 'Build stage', 'progress check': 'Build check', 'progress end': 'End the build', 'progress preview': 'Build preview',
  'progress spend': 'Spend on the build', 'progress show': 'The build', 'progress stop': 'Stop the build', office: 'Back office',
  'office announce': 'Announce', 'office kick': 'Kick (asks the owner)', 'office mute': 'Mute (asks the owner)', 'office close': 'Close a room (asks the owner)',
  'office launch': 'Launch state (asks the owner)', 'office invite': 'Invites', 'office link': 'Owner link', stats: 'Stats', codex: 'Game Codex',
  'codex new': 'New Game Codex', 'codex link': 'Codex link', perf: 'Performance run', 'perf compare': 'Performance compare', 'perf sizes': 'Download sizes',
  'game new': 'New game', 'game remix': 'Remix a game', games: 'Games', status: 'Studio status', upgrade: 'Upgrade the studio', look: 'Look at the site',
  servers: 'Servers', 'servers new': 'New server', 'agents pass': 'Agent pass', demo: 'A working game', new: 'New studio',
  style: 'Art direction', assets: 'Game assets',
};

const idleBridge = () => ({ state: 'idle', sock: null, status: null, pic: null, why: null, fps: 0, frames: [], n: 0 });

/** Everything the mod knows, rebuilt from the studio's files on a timer; module variables (a reload starts afresh). */
const S = {
  surfaces: [], interactive: false, cwd: null,
  root: null, studio: null, name: null, local: {}, toolkit: false, games: [], live: null, dev: null,
  feedId: null, feed: null, feedMtime: 0, last: null, autoOpened: new Set(),
  preview: null, rooms: { live: null, dev: null, games: null, at: 0 }, office: null, stats: null,
  busy: {}, why: {}, asks: [], forYou: [], codexes: [], codexLinks: {}, lab: { url: null, checks: [] }, art: [],
  tab: 'build', tickN: 0, ticking: false, drawn: '',
  calls: new Map(), parts: new Map(), partsAutoOpened: false, agentsAt: 0,
  guards: new Map(), guardN: 0, held: null,
  arcade: { ...idleBridge(), pick: null, game: null }, watch: idleBridge(), arcadeGames: [], arcadeGamesAt: 0,
};

/* ================================================================== register */

export function register(on, options) {
  OPT = optionsOf(options);

  on('session.start', async ($, e, next) => {
    const started = await next(e);
    S.interactive = Boolean(e.isInteractive);
    S.cwd = e.cwd;
    try { S.surfaces = [...(await $.session.surfaces())]; } catch { S.surfaces = []; }
    await findStudio($);
    if (S.root) { await readStudio($); await readFeed($); }
    for (const [name, description, argumentHint] of COMMANDS) {
      try { await $.command.register({ name, description, ...(argumentHint ? { argumentHint } : {}), immediate: true }); } catch (error) { $.ui.log(`/${name} is taken here (${String(error?.message ?? error).slice(0, 80)})`, { to: 'debug' }); }
    }
    $.clock.every(TICK_MS, () => tick($));
    return started;
  });

  on('session.end', async ($, e, next) => {
    stopBridge($, 'arcade');
    stopBridge($, 'watch');
    return next(e);
  });

  /* ------------------------------------------------------------ commands */

  on('command.run', { command: 'studio' }, async ($, e) => {
    const tab = String(e.args ?? '').trim().toLowerCase();
    if (['build', 'rooms', 'games', 'stats', 'codex', 'lab', 'parts', 'art'].includes(tab)) S.tab = tab;
    if (!S.root) return { text: 'Not inside a Homie studio (no studio.json here or above). /arcade plays a Homie game meanwhile; ask Claude to set up a studio to get the rest.' };
    await tick($, { force: true });
    if (S.tab === 'rooms') void loadRooms($);
    if (S.tab === 'lab') void readLab($);
    if (S.tab === 'art') await readArt($);
    if (!(await openPane($, PANE, `◆ ${S.name}`))) return { text: S.tab === 'art' ? artText('look', '') : studioText() };
    return {};
  });

  on('command.run', { command: 'build' }, async ($) => {
    if (!S.root) return { text: 'Not inside a Homie studio.' };
    S.tab = 'build';
    await tick($, { force: true });
    await openPane($, PANE, `◆ ${S.name}`);
    return { text: buildText() };
  });

  on('command.run', { command: 'rooms' }, async ($) => {
    if (!S.root) return { text: 'Not inside a Homie studio. /arcade lists Homie Arcade\'s rooms.' };
    S.tab = 'rooms';
    await loadRooms($);
    await openPane($, PANE, `◆ ${S.name}`);
    return { text: roomsText() };
  });

  on('command.run', { command: 'play' }, async ($, e) => {
    if (!S.root) {
      await loadArcadeGames($);
      return { text: ['Not inside a studio. Homie Arcade, live now (you open these):', ...S.arcadeGames.filter((g) => g.studio === 'Homie Arcade').map((g) => `  ▶ ${g.name}: ${g.base}/${g.id}/play`)].join('\n') };
    }
    const want = String(e.args ?? '').trim();
    const games = want ? S.games.filter((g) => g.id === want || String(g.name ?? '').toLowerCase() === want.toLowerCase()) : S.games;
    if (!games.length) return { text: want ? `No game "${want}" in ${S.name} (games: ${S.games.map((g) => g.id).join(', ') || 'none yet'}).` : `${S.name} has no game yet.` };
    const lines = [`${S.name}: Play (open these yourself; nothing is opened for you)`];
    for (const g of games) {
      const at = [S.live ? `${S.live}/${g.id}/play` : null, S.dev ? `${linkable(S.dev)}/${g.id}/play (this computer)` : null].filter(Boolean);
      lines.push(`  ▶ ${g.name ?? g.id}: ${at.join('  ·  ') || 'not running anywhere yet: deploy it, or start the dev site'}`);
    }
    return { text: lines.join('\n') };
  });

  on('command.run', { command: 'watch' }, async ($, e) => {
    if (!S.root) return { text: 'Not inside a Homie studio. /arcade watches or plays a Homie Arcade room in a pane.' };
    await loadRooms($);
    const want = String(e.args ?? '').trim().toLowerCase();
    const all = roomList().filter((r) => !want || r.room.toLowerCase() === want || r.room.toLowerCase() === `pub-${want}` || r.game === want || r.label.toLowerCase() === want);
    if (!all.length) return { text: want ? `No live room "${want}" right now.${S.games.length ? ' A room exists while someone plays: open a game\'s Play page, and it can be watched from then on.' : ''}` : 'No live rooms right now. A room exists while someone plays; /play gives the Play links.' };
    return { text: ['Watch (open these yourself):', ...all.filter((r) => r.watch).map((r) => `  ◉ ${r.name} · ${r.label}: ${linkable(new URL(r.watch, r.base).href)}  (${r.players}/${r.max} players${r.ai ? `, ${r.ai} AI` : ''})`), 'Or watch one in the Studio pane: /rooms, then "Watch in the pane".'].join('\n') };
  });

  on('command.run', { command: 'codex' }, async ($, e) => {
    if (!S.root) return { text: 'Not inside a Homie studio.' };
    await readCodexes($);
    S.tab = 'codex';
    const want = String(e.args ?? '').trim();
    await openPane($, PANE, `◆ ${S.name}`);
    const list = want ? S.codexes.filter((c) => c.id === want) : S.codexes;
    if (!list.length) return { text: want ? `games/${want}/CODEX.md does not exist yet: ask Claude to plan ${want}.` : 'No Game Codex yet: ask Claude to plan a game; a short interview becomes games/<id>/CODEX.md.' };
    return { text: list.map((c) => `${c.title ?? c.id} (games/${c.id}/CODEX.md): ${c.sections.filter((x) => x.filled && x.key).length} sections filled${c.missing.length ? `, not decided yet: ${c.missing.join(', ')}` : ''}; ${c.openQuestions} open question${c.openQuestions === 1 ? '' : 's'}. The page: .studio/codex/${c.id}.html (npx --no-install homie-studio codex ${c.id})${S.codexLinks[c.id] ? '; a private link is in the Studio pane' : ''}.`).join('\n') };
  });

  on('command.run', { command: 'deploy-status' }, async ($) => {
    if (!S.root) return { text: 'Not inside a Homie studio.' };
    await readStudio($);
    await readFeed($);
    await loadRooms($);
    const d = await deployFacts(ioOf($), S.root, { studio: S.studio, local: S.local, feed: S.feed, last: S.last, ...(await deployKnown($, S.root)) });
    return { text: deployText(d) };
  });

  on('command.run', { command: 'perf-numbers' }, async ($, e) => {
    if (!S.root) return { text: 'Not inside a Homie studio.' };
    return { text: await perfText($, String(e.args ?? '').trim()) };
  });

  on('command.run', { command: 'parts' }, async ($) => {
    await readParts($, { force: true });
    if (!(await openPane($, PARTS, 'Parts'))) return { text: partsText() };
    return {};
  });

  on('command.run', { command: 'arcade' }, async ($, e) => {
    if (!OPT.arcade) return { text: 'The arcade is turned off in this plugin\'s settings (/config: Homie, arcade).' };
    await loadArcadeGames($);
    const want = String(e.args ?? '').trim().toLowerCase();
    if (want) {
      const g = S.arcadeGames.find((x) => x.id === want || x.key === want || x.name.toLowerCase() === want);
      if (g) S.arcade.pick = g.key;
    }
    const opened = await openPane($, ARCADE, 'Arcade', { focus: true, rows: 30 });
    if (want && S.arcade.pick && opened) await startArcade($);
    if (!opened) return { text: ['The arcade draws in a pane, which this app does not show. Play in a browser instead (you open these):', ...S.arcadeGames.slice(0, 8).map((g) => `  ▶ ${g.name} · ${g.studio}: ${g.base}/${g.id}/play`)].join('\n') };
    return {};
  });

  // Art direction (the style and models skills; .studio/art/<game>/latest.json). /style is the style skill's own
  // (plugin skills answer to their bare names), so the Art tab's command is /look.
  on('command.run', { command: 'look' }, async ($, e) => {
    if (!S.root) return { text: 'Not inside a Homie studio.' };
    await readArt($);
    S.tab = 'art';
    await openPane($, PANE, `◆ ${S.name}`);
    return { text: artText('look', String(e.args ?? '').trim()) };
  });

  on('command.run', { command: 'lock' }, async ($, e) => {
    if (!S.root) return { text: 'Not inside a Homie studio.' };
    return { text: await lockCommand($, String(e.args ?? '').trim()) };
  });

  on('command.run', { command: 'assets' }, async ($, e) => {
    if (!S.root) return { text: 'Not inside a Homie studio.' };
    await readArt($);
    return { text: artText('assets', String(e.args ?? '').trim()) };
  });

  on('command.run', { command: 'cast' }, async ($, e) => {
    if (!S.root) return { text: 'Not inside a Homie studio.' };
    await readArt($);
    // The characters are in the Art tab: it opens, as /look opens it.
    S.tab = 'art';
    await openPane($, PANE, `◆ ${S.name}`);
    return { text: artText('cast', String(e.args ?? '').trim()) };
  });

  on('command.run', { command: 'clips' }, async ($, e) => {
    if (!S.root) return { text: 'Not inside a Homie studio.' };
    await readArt($);
    return { text: artText('clips', String(e.args ?? '').trim()) };
  });

  on('command.run', { command: 'lineup' }, async ($, e) => {
    if (!S.root) return { text: 'Not inside a Homie studio.' };
    await readArt($);
    return { text: artText('lineup', String(e.args ?? '').trim()) };
  });

  on('command.run', { command: 'rights' }, async ($, e) => {
    if (!S.root) return { text: 'Not inside a Homie studio.' };
    await readArt($);
    const picked = artFor(S.art, String(e.args ?? '').trim());
    if (!picked.list) return { text: picked.why };
    const out = [];
    for (const a of picked.list) out.push(rightsText(a, gameName(a.game), await $.fs.exists(`${S.root}/games/${a.game}/assets/RIGHTS.md`)));
    return { text: out.join('\n') };
  });

  /* ------------------------------------------------------------ tool calls */

  // Outermost: every tool call's result has its secrets taken out (after the guards below have decided), and the
  // Studio pane learns what Homie command ran and which part ran it.
  on('tool.call', async ($, e, next) => {
    noteCall(e);
    const result = await next(e);
    afterCall($, e, result);
    if (!OPT.redactSecrets) return result;
    return redactResult(result);
  }).catch(async ($, e, next) => (next.called ? { deny: 'The Homie mod could not check this result for secrets, so it was withheld. Run it again, or turn off the mod\'s secret redaction (/config).' } : next(e)));

  // The guards: what each one means is decided in lib/holds.mjs (Codex's hooks share it); `settle` asks the person.
  on('tool.call', { tool: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] }, async ($, e, next) => {
    if (!OPT.guardFiles) return next(e);
    // A decision the person locked is refused outright (nobody is asked: the person's lock is the answer); a file the
    // studio protects is held with its diff.
    const edit = { ...claudeEditOf(e.tool, e), by: e.agentId ? 'a subagent' : 'Claude', byLong: e.agentId ? `a subagent (${partName(e.agentId)})` : 'Claude' };
    const held = await settle($, await editDecision(ioOf($), holdCtx(), edit));
    return held ?? next(e);
  }).catch(async ($, e, next) => (next.called ? { deny: 'The Homie mod failed after this edit ran.' } : { deny: 'The Homie mod could not check this edit against the studio\'s protected files (studio.json "protect") and locked art decisions, so it was not made. Ask the person, or try again.' }));

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const { decision, deploy } = await shellDecision(ioOf($), holdCtx(), e.command, (root) => deployKnown($, root));
    const held = await settle($, decision);
    if (held) return held;
    const result = await next(e);
    if (deploy) await afterDeploy($, deploy.root, result);
    return result;
  }).catch(async ($, e, next) => (next.called ? { deny: 'The Homie mod failed after this command ran.' } : { deny: 'The Homie mod could not check this command (a deploy, a Cloudflare change, a paid media call, a model download, or big files into git), so it was not run. Ask the person, or try again.' }));

  on('tool.call', { tool: /^mcp__.+__studio_deploy$/ }, async ($, e, next) => {
    const decision = await mcpDeployDecision(ioOf($), holdCtx(), S.root ? await deployKnown($, S.root) : {});
    if (!decision) return next(e);
    const held = await settle($, decision);
    if (held) return held;
    const result = await next(e);
    await afterDeploy($, S.root, result);
    return result;
  }).catch(async ($, e, next) => (next.called ? { deny: 'The Homie mod failed after this deploy ran.' } : { deny: 'The Homie mod could not summarise this deploy, so it was not run. Ask the person, or try again.' }));

  // Stripe's MCP: a write whose answer would carry a webhook's signing secret into the conversation is refused, always
  // (the shop's own page makes the webhook, and the secret goes straight to the Worker).
  on('tool.call', { tool: /^mcp__.*stripe.*__stripe_api_write$/i }, async ($, e, next) => {
    const refused = stripeDecision(e.tool, e);
    return refused ?? next(e);
  }).catch(async ($, e, next) => (next.called ? { deny: 'The Homie mod failed after this Stripe call ran.' } : { deny: 'The Homie mod could not check this Stripe write for a secret in its answer, so it was not made. Ask the person, or make it in Stripe\'s Dashboard.' }));

  on('tool.call', { tool: /^mcp__.*(?:fal|eleven|tripo).*__/i }, async ($, e, next) => {
    const held = await settle($, await paidMcpDecision(ioOf($), holdCtx(), e.tool, e));
    return held ?? next(e);
  }).catch(async ($, e, next) => (next.called ? { deny: 'The Homie mod failed after this call ran.' } : { deny: 'The Homie mod could not check this paid call against the studio\'s budget, so it was not made. Ask the person.' }));

  // Cloudflare's own MCP servers (and a claude.ai Cloudflare connector), inside a studio: a tool that deletes or changes
  // something on the account goes around the studio's deploy and its record of what it created, so it is held.
  on('tool.call', { tool: /^mcp__.*cloudflare.*__/i }, async ($, e, next) => {
    const held = await settle($, await cloudflareMcpDecision(ioOf($), holdCtx(), e.tool, e));
    return held ?? next(e);
  }).catch(async ($, e, next) => (next.called ? { deny: 'The Homie mod failed after this call ran.' } : { deny: 'The Homie mod could not check this change to the Cloudflare account, so it was not made. Ask the person.' }));

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (e.agentId && S.parts.has(e.agentId)) { const l = S.parts.get(e.agentId); l.endedAt = Date.now(); l.status = e.isAborted ? 'killed' : 'completed'; redraw($); }
    else if (!e.agentId) void tick($, { force: true });
    return result;
  });

  /* ------------------------------------------------------------ drawing */

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!OPT.band || !S.root || e.props.hasSurvey) return next(e);
    const t = $.ui.resolve(e);
    const ours = band(t, bandData(), e.props.bodyColumns);
    if (!ours) return next(e);
    const theirs = await next(e);
    return t.Box({ flexDirection: 'column', children: [ours, theirs] });
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE && e.requestId !== PARTS && e.requestId !== ARCADE && e.requestId !== HOLD) return next(e);
    const t = $.ui.resolve(e);
    const columns = Math.max(30, e.props.bodyColumns ?? 80);
    const now = Date.now();
    if (e.requestId === HOLD) return holdPane(t, S.held);
    if (e.requestId === PARTS) return partsView(t, { parts: partList(), checks: S.feed ? summarize(S.feed).checks : [], columns, now });
    if (e.requestId === ARCADE) {
      const size = arcadeSize(columns, e.props.scroll?.bodyRows ?? 30);
      if (S.arcade.state !== 'idle' && S.arcade.sock && (size.cols !== S.arcade.cols || size.rows !== S.arcade.rows)) { S.arcade.cols = size.cols; S.arcade.rows = size.rows; void bridgePost($, S.arcade, '/size', size); }
      return arcadeView(t, {
        surface: e.surface, a: arcadeData(), games: S.arcadeGames, columns,
        on: {
          pick: (v) => { S.arcade.pick = v; $.ui.invalidate('ui.render'); },
          play: () => startArcade($),
          leave: () => { stopBridge($, 'arcade'); $.ui.invalidate('ui.render'); },
          key: (k) => arcadeKey($, k),
        },
      });
    }
    if (!S.root) return t.Text({ dimColor: true, children: ['Not inside a Homie studio any more.'] });
    const s = paneStudio();
    const tabs = {
      build: () => {
        const b = S.feed ? summarize(S.feed) : null;
        const watchSize = { cols: Math.min(columns - 2, 72), rows: Math.max(6, Math.round((Math.min(columns - 2, 72) * 9) / 32)) };
        if (S.watch.state !== 'idle' && S.watch.sock && (watchSize.cols !== S.watch.cols || watchSize.rows !== S.watch.rows)) { S.watch.cols = watchSize.cols; S.watch.rows = watchSize.rows; void bridgePost($, S.watch, '/size', watchSize); }
        return buildTab(t, {
          surface: e.surface, s, b, last: S.last ? summarize(S.last) : null, columns, now, pic: previewPicture(e.surface, columns, b),
          watch: watchData(b),
          on: { watch: () => startWatch($, b?.id ?? null), unwatch: () => { stopBridge($, 'watch'); $.ui.invalidate('ui.render'); }, stop: () => stopBuild($) },
        });
      },
      rooms: () => roomsTab(t, {
        s, rooms: S.rooms, office: S.office, asks: S.asks, forYou: S.forYou, columns, now, busy: S.busy.rooms, why: S.why.rooms,
        on: {
          refresh: () => loadRooms($, { force: true }),
          owner: () => loadOffice($),
          watchHere: (r) => watchRoom($, r),
          kick: (r, c) => officeAct($, 'kick', r, c),
          mute: (r, c) => officeAct($, c.muted ? 'unmute' : 'mute', r, c),
          announce: (r, text) => announce($, r, text),
        },
      }),
      games: () => gamesTab(t, { s, rooms: S.rooms, office: S.office, columns, on: { launch: (g, v) => launchState($, g, v, null), remix: (g, v) => launchState($, g, null, v) } }),
      stats: () => statsTab(t, { s, stats: S.stats, columns, now, busy: S.busy.stats, why: S.why.stats, on: { refresh: () => loadStats($) } }),
      codex: () => codexTab(t, { s, codexes: S.codexes, links: S.codexLinks, columns, busy: S.busy.codex, on: { link: (c) => codexLink($, c) } }),
      lab: () => labTab(t, { lab: S.lab, games: S.games, columns, now }),
      parts: () => partsView(t, { parts: partList(), checks: S.feed ? summarize(S.feed).checks : [], columns, now }),
      art: () => artTab(t, { art: S.art, games: S.games, columns, now, busy: S.busy.art, why: S.why.art, on: { lock: (game, d) => artLock($, game, d), unlock: (game, d) => artUnlock($, game, d) } }),
    };
    return paneFrame(t, {
      s, tab: S.tab, columns,
      onTab: (id) => { S.tab = id; if (id === 'rooms') void loadRooms($); if (id === 'codex') void readCodexes($); if (id === 'lab') void readLab($); if (id === 'art') void readArt($); $.ui.invalidate('ui.render'); },
      body: (tabs[S.tab] ?? tabs.build)(),
    });
  });

  // A held tool call's question: what would change, drawn above Claude Code's own dialog (the dialog stays whole).
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const q = e.props.questions?.[0]?.question;
    const g = typeof q === 'string' ? S.guards.get(q) : null;
    if (!g) return next(e);
    const t = $.ui.resolve(e);
    const theirs = await next(e);
    return t.Box({ flexDirection: 'column', children: [guardPanel(t, g), theirs] });
  });

  // A Homie command's row: what it is in words (the command itself beside it, dim) and, once it has answered, its
  // result as a checklist, rows or live links, drawn right under it, whether the row stands alone or sits in a group
  // Claude Code has unfolded (below). The standalone result block then draws nothing of its own.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!OPT.renderResults || e.props.tool !== 'Bash') return next(e);
    const call = S.calls.get(e.requestId) ?? callOf(e.props.input?.command);
    if (!call?.homie || !call.label) return next(e);
    const t = $.ui.resolve(e);
    const row = toolUseRow(t, { label: call.label, command: String(e.props.input?.command ?? '').replace(/\s+/g, ' ').slice(0, 300), state: e.props.isRunning ? 'running' : e.props.isErrored ? 'error' : 'done' });
    const card = !e.props.isRunning && !e.props.isErrored && e.props.output !== undefined ? resultCard(t, e.props.tool, call, e.props.output, e.viewport) : null;
    return card ? t.Box({ flexDirection: 'column', children: [row, t.Box({ paddingLeft: 2, children: [card] })] }) : row;
  });

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!OPT.renderResults || e.props.isErrored) return next(e);
    const tool = e.props.tool;
    if (tool !== 'Bash' && !/^mcp__.*homie.*__/i.test(tool)) return next(e);
    const call = S.calls.get(e.requestId) ?? null;
    // A command this session saw that was not Homie's stays Claude Code's; one from before a reload is read by its text.
    if (tool === 'Bash' && call && !call.homie) return next(e);
    const t = $.ui.resolve(e);
    const card = resultCard(t, tool, call, e.props.output, e.viewport);
    if (!card) return next(e);
    // The command's own row (ToolUse, above) already drew this card.
    if (tool === 'Bash' && call?.homie && call.label) return t.Text({ children: [''] });
    return card;
  });

  // A group of calls Claude Code folds into one line ("Ran 3 shell commands") is unfolded when a Homie command is in
  // it, so its result shows.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!OPT.renderResults || e.props.isExpanded) return next(e);
    const homie = (e.props.calls ?? []).some((c) => c.tool === 'Bash' && callOf(c.input?.command)?.homie);
    return homie ? next({ ...e, props: { ...e.props, isExpanded: true } }) : next(e);
  });

  // The arcade's pad (a Client region) posts the keys it took.
  on('ui.message', async ($, e, next) => {
    const d = e.data ?? {};
    if (typeof d.key === 'string') await arcadeKey($, d.key);
    return next(e);
  });

  on('ui.close', async ($, e, next) => {
    if (e.id === ARCADE) stopBridge($, 'arcade');
    if (e.id === PANE) stopBridge($, 'watch');
    return next(e);
  });
}

/* ================================================================== options and commands */

const COMMANDS = [
  ['studio', 'Homie: the Studio pane (build, rooms, games, stats, codex, lab, parts, art)', '[build|rooms|games|stats|codex|lab|parts|art]'],
  ['play', 'Homie: Play links for this studio\'s games', '[game]'],
  ['watch', 'Homie: Watch links for the rooms playing now', '[room|game]'],
  ['rooms', 'Homie: live rooms with players and AI, and the back office', null],
  ['build', 'Homie: the current build, step by step', null],
  ['codex', 'Homie: the Game Codex, at a glance', '[game]'],
  ['deploy-status', 'Homie: what is live, and what changed since the last deploy', null],
  // /perf is the perf skill's own (plugin skills answer to their bare names), so the numbers are /perf-numbers.
  ['perf-numbers', 'Homie: the latest performance run\'s numbers', '[game]'],
  ['parts', 'Homie: the parallel agents building now', null],
  ['arcade', 'Homie: play a live Homie game with strangers while Claude works', '[game]'],
  // /style is the style skill's own, so the art direction at a glance is /look.
  ['look', 'Homie: the game\'s look: its art direction, decision by decision (the Studio pane\'s Art tab)', '[game]'],
  ['lock', 'Homie: lock one art decision, in your own words (unlocking is asked for in the Art tab)', '<decision> [game]'],
  ['assets', 'Homie: the game\'s cast: routes, licences, costs, and what is stale', '[game]'],
  ['cast', 'Homie: the game\'s characters: skeleton, bones, source and clips', '[game]'],
  ['clips', 'Homie: each character\'s clips against the verbs the game needs', '[game]'],
  ['lineup', 'Homie: the last asset lineup: what it flagged, and where its pictures are', '[game]'],
  ['rights', 'Homie: licence problems with their fixes, and the game\'s RIGHTS.md', '[game]'],
];

/** The plugin's userConfig values, with defaults for anything unset. */
function optionsOf(options) {
  const o = { ...DEFAULTS };
  for (const [k, v] of Object.entries(options ?? {})) {
    if (!(k in DEFAULTS)) continue;
    if (typeof DEFAULTS[k] === 'boolean') o[k] = v === true || v === 'true';
    else if (k === 'pictures') o[k] = v === 'image' ? 'image' : 'blocks';
  }
  return o;
}

/* ================================================================== the studio, from its files */

async function findStudio($) {
  let cwd = S.cwd;
  try { cwd = await $.session.cwd(); } catch { /* keep the last */ }
  S.cwd = cwd;
  let at = String(cwd ?? '').replace(/\/+$/, '');
  const before = S.root;
  S.root = null;
  for (let i = 0; i < 24 && at; i++) {
    if (await $.fs.exists(`${at}/studio.json`)) { S.root = at; break; }
    const up = at.slice(0, at.lastIndexOf('/'));
    if (up === at) break;
    at = up;
  }
  if (S.root !== before) { S.studio = null; S.feed = null; S.feedId = null; S.last = null; S.rooms = { live: null, dev: null, games: null, at: 0 }; S.office = null; S.stats = null; S.codexes = []; S.lab = { url: null, checks: [] }; S.art = []; }
}

async function readJsonFile($, path) {
  try { return JSON.parse(await $.fs.read(path)); } catch { return null; }
}

async function readStudio($) {
  const root = S.root;
  if (!root) return;
  const studio = (await readJsonFile($, `${root}/studio.json`)) ?? {};
  S.studio = studio;
  S.name = String(studio.name ?? root.split('/').pop()).slice(0, 60);
  S.local = (await readJsonFile($, `${root}/.studio/local.json`)) ?? {};
  S.toolkit = await $.fs.exists(`${root}/node_modules/@homie-rocks/studio/bin/homie-studio.mjs`);
  S.live = liveSite(studio, S.local);
  // The dev site (`homie-studio dev`) records its port next to the Worker's config.
  S.dev = null;
  for (const dir of [root, `${root}/site`]) {
    const rec = await readJsonFile($, `${dir}/.wrangler/homie-dev.json`);
    if (rec && Number(rec.port) > 0) {
      const url = `http://127.0.0.1:${Number(rec.port)}`;
      const r = await fetchJson($, `${url}/api/games`, { timeoutMs: 1500 });
      if (r) { S.dev = url; S.rooms.games = S.rooms.games ?? r.games ?? null; }
      break;
    }
  }
  const games = [];
  try {
    for (const d of await $.fs.list(`${root}/games`)) {
      if (d.kind !== 'directory' && d.kind !== 'dir' && !(d.kind === 'other' && d.isLink)) continue;
      const meta = await readJsonFile($, `${root}/games/${d.name}/game.json`);
      if (meta) games.push({ id: meta.id ?? d.name, name: meta.name ?? d.name, blurb: meta.blurb ?? '', launch: meta.launch ?? null, remix: meta.share?.source !== false, hasCodex: await $.fs.exists(`${root}/games/${d.name}/CODEX.md`) });
      else if (await $.fs.exists(`${root}/games/${d.name}/CODEX.md`)) games.push({ id: d.name, name: d.name, blurb: '(planned: its Game Codex, no game yet)', planned: true, hasCodex: true });
    }
  } catch { /* no games folder */ }
  S.games = games.sort((a, b) => a.id.localeCompare(b.id));
}

/** Only these addresses: the studio's own live site, this computer's dev site, and Homie's own *.homie.rocks. */
function allowedUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'http:') return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (u.protocol !== 'https:') return false;
  if (/(^|\.)homie\.rocks$/.test(u.hostname)) return true;
  return Boolean(S.live && new URL(S.live).host === u.host);
}

async function fetchJson($, url, { timeoutMs = 6000 } = {}) {
  if (!allowedUrl(url)) return null;
  try {
    const res = await $.http.fetch(url, { headers: { accept: 'application/json', 'user-agent': 'homie-claude-code-mod' } });
    if (!res.ok) return null;
    return JSON.parse(res.text);
  } catch { return null; }
}

/* ------------------------------------------------------------------ the progress feed */

async function readFeed($) {
  const dir = `${S.root}/.studio/progress`;
  let id = null;
  try { id = String(await $.fs.read(`${dir}/current`)).trim(); } catch { id = null; }
  if (id && !/^[a-z0-9][a-z0-9-]{5,63}$/.test(id)) id = null;
  let changed = false;
  if (id) {
    let mtime = 0;
    try { mtime = (await $.fs.stat(`${dir}/${id}.json`)).mtimeMs; } catch { mtime = 0; }
    if (id !== S.feedId || mtime !== S.feedMtime) {
      const doc = feedOf(await readText($, `${dir}/${id}.json`));
      if (doc && doc.state === 'running') {
        const fresh = id !== S.feedId;
        S.feed = doc; S.feedId = id; S.feedMtime = mtime; changed = true;
        if (fresh) await autoOpen($, id);
        await readPreview($, dir, doc);
      } else if (doc) { S.last = doc; S.feed = null; S.feedId = null; changed = true; }
    }
  } else if (S.feedId) {
    // The open build ended: its feed is the last build now.
    const doc = feedOf(await readText($, `${dir}/${S.feedId}.json`));
    S.last = doc ?? S.feed; S.feed = null; S.feedId = null; changed = true;
  } else if (!S.last && S.tickN % 15 === 3) {
    S.last = await newestFeed($, dir);
    if (S.last) changed = true;
  }
  return changed;
}

async function readText($, path) {
  try { return await $.fs.read(path); } catch { return null; }
}

async function newestFeed($, dir) {
  let best = null;
  try {
    const files = (await $.fs.list(dir)).filter((f) => f.name.endsWith('.json')).sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0)).slice(0, 3);
    for (const f of files) { const d = feedOf(await readText($, `${dir}/${f.name}`)); if (d && (!best || String(d.updatedAt) > String(best.updatedAt))) best = d; }
  } catch { /* no feeds */ }
  return best;
}

/**
 * The latest check frame. @homie-rocks/studio 0.21.0 keeps a small raw RGB copy beside the feed
 * (`<build>.preview.<w>x<h>.rgb`) for this pane; the feed itself carries the JPEG the Claude app's card shows.
 */
async function readPreview($, dir, doc) {
  const at = doc.preview?.at ?? null;
  if (!doc.preview || (S.preview && S.preview.build === doc.build && S.preview.at === at)) return;
  let rgb = null;
  try {
    const f = (await $.fs.list(dir)).find((x) => x.name.startsWith(`${doc.build}.preview.`) && x.name.endsWith('.rgb'));
    const m = f ? /\.preview\.(\d+)x(\d+)\.rgb$/.exec(f.name) : null;
    if (m) {
      const { base64 } = await $.fs.read(`${dir}/${f.name}`, { as: 'bytes' });
      rgb = { w: Number(m[1]), h: Number(m[2]), data: bytesOf(base64), file: `${dir}/${f.name}` };
      if (rgb.data.length < rgb.w * rgb.h * 3) rgb = null;
    }
  } catch { rgb = null; }
  S.preview = { build: doc.build, at, rgb, jpeg: typeof doc.preview.image === 'string' ? doc.preview.image : null, memo: null };
}

function bytesOf(base64) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(base64);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The preview as the surface draws it: Raster cells (or an Image) in the terminal, an Svg on the desktop. */
function previewPicture(surface, columns, b) {
  const p = S.preview;
  if (!p || !b || p.build !== b.build) return null;
  if (surface === 'terminal') {
    if (!p.rgb) return null;
    // At most 14 rows: a glance at the frame, not the whole pane.
    let cols = Math.max(16, Math.min(columns - 2, 64));
    let rows = Math.max(4, Math.round((cols * p.rgb.h) / p.rgb.w / 2));
    if (rows > 14) { rows = 14; cols = Math.max(16, Math.round((rows * 2 * p.rgb.w) / p.rgb.h)); }
    if (OPT.pictures === 'image') return { key: 'preview', image: { file: p.rgb.file, format: 'rgb', width: p.rgb.w, height: p.rgb.h, generation: Date.parse(p.at ?? '') || 0 }, columns: cols, rows };
    if (!p.memo || p.memo.cols !== cols) p.memo = { cols, rows, cells: cellsFromRgb(p.rgb, cols, rows) };
    return { key: 'preview', cells: p.memo.cells, columns: cols, rows };
  }
  if (!p.jpeg || p.jpeg.length > 120_000) return null;
  const w = p.rgb?.w ?? 480; const h = p.rgb?.h ?? 300;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><image href="${p.jpeg}" width="${w}" height="${h}"/></svg>`, width: Math.min(480, columns * 7), height: Math.round((Math.min(480, columns * 7) * h) / w) };
}

/** RGB pixels as Raster cells: '▀' per cell, the averaged colour of the pixels above (fg) and below (bg). */
function cellsFromRgb(img, cols, rows) {
  const nums = new Uint32Array(cols * rows * 3);
  const avg = (x0, y0, x1, y1) => {
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * img.w + x) * 3; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++; }
    return n ? ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)) >>> 0 : 0;
  };
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * img.w) / cols); const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * img.w) / cols));
      const ya = Math.floor((cy * 2 * img.h) / (rows * 2)); const yb = Math.max(ya + 1, Math.floor(((cy * 2 + 1) * img.h) / (rows * 2))); const yc = Math.max(yb + 1, Math.floor(((cy * 2 + 2) * img.h) / (rows * 2)));
      const k = (cy * cols + cx) * 3;
      nums[k] = 0x2580; nums[k + 1] = avg(x0, ya, x1, Math.min(img.h, yb)); nums[k + 2] = avg(x0, Math.min(img.h - 1, yb), x1, Math.min(img.h, yc));
    }
  }
  return new Uint8Array(nums.buffer).toBase64();
}

/** A build that starts opens the Studio pane, where the terminal is wide enough for a pane nobody asked for. */
async function autoOpen($, id) {
  if (!OPT.paneAutoOpen || !S.interactive || S.autoOpened.has(id) || !S.surfaces.length) return;
  S.autoOpened.add(id);
  S.tab = 'build';
  try {
    const r = await $.ui.open({ id: PANE, title: `◆ ${S.name}` });
    if (!r.isPlaced) $.ui.toast(`${S.name}: a build started. /studio shows it (the pane waits for a wider terminal).`);
  } catch { /* the pane is up already */ }
}

/* ------------------------------------------------------------------ rooms, office, stats */

function roomList() {
  return [...(S.rooms.live?.rooms ?? []).map((r) => ({ ...r, where: 'live', base: S.live })), ...(S.rooms.dev?.rooms ?? []).map((r) => ({ ...r, where: 'here', base: S.dev }))];
}

async function loadRooms($, { force = false } = {}) {
  if (!S.root) return;
  if (!force && Date.now() - S.rooms.at < 10_000) return;
  S.busy.rooms = force ? 'reading the rooms' : null;
  const [live, dev, games] = await Promise.all([
    S.live ? fetchJson($, `${S.live}/api/rooms`) : null,
    S.dev ? fetchJson($, `${S.dev}/api/rooms`, { timeoutMs: 2000 }) : null,
    S.live ? fetchJson($, `${S.live}/api/games`) : null,
  ]);
  S.rooms = { live, dev, games: games?.games ?? S.rooms.games ?? null, at: Date.now() };
  S.busy.rooms = null;
  redraw($);
}

/**
 * The studio's own CLI, from its pinned toolkit, with --json. The owner's actions go through it so they keep the
 * office's rules: its key is minted with the studio's own Cloudflare login and dropped after; kick, mute, close and
 * launch only ASK, and the owner confirms in their own browser. Nothing here can confirm an ask.
 */
async function studioCli($, args, { timeoutMs = 120_000 } = {}) {
  if (!S.root || !S.toolkit) return { ok: false, why: 'the studio\'s toolkit is not installed here: npm install in the studio folder first' };
  try {
    // A studio that is not online yet runs its office on this computer's dev site (its local database).
    const site = !S.live && S.dev && /^(office|stats|codex link|players)/.test(args.join(' ')) ? ['--url', S.dev] : [];
    const r = await $.process.run(['node', `${S.root}/node_modules/@homie-rocks/studio/bin/homie-studio.mjs`, ...args, ...site, '--json'], { cwd: S.root, timeoutMs });
    const text = String(r.stdout ?? '').trim();
    try { return JSON.parse(text.slice(text.indexOf('{'))); } catch { return { ok: false, why: (r.stderr || text || `exited ${r.exitCode}`).trim().split('\n').slice(-2).join(' ').slice(0, 300) }; }
  } catch (error) {
    return { ok: false, why: `could not run homie-studio: ${String(error?.message ?? error).slice(0, 200)}` };
  }
}

async function loadOffice($) {
  if (S.busy.rooms) return;
  S.busy.rooms = 'reading the back office (a 10-minute key, minted with the studio\'s own Cloudflare login, dropped after)';
  S.why.rooms = null;
  redraw($);
  const r = await studioCli($, ['office']);
  S.busy.rooms = null;
  if (r.ok) S.office = { at: Date.now(), data: r };
  else S.why.rooms = `The back office did not answer: ${r.why ?? r.message ?? 'no reason given'}`;
  redraw($);
}

/** Kick, mute and unmute through the office: ASKED, never done here; the person gets the owner's one-tap link. */
async function officeAct($, op, room, client) {
  if (S.busy.rooms) return;
  const seat = String(client.seat + 1);
  const args = op === 'kick' ? ['office', 'kick', room.game, room.room, seat] : ['office', 'mute', room.game, room.room, seat, ...(op === 'unmute' ? ['--off'] : [])];
  S.busy.rooms = `${op === 'kick' ? 'asking to kick' : op === 'mute' ? 'asking to mute' : 'asking to unmute'} ${client.name}`;
  redraw($);
  const r = await studioCli($, args);
  S.busy.rooms = null;
  noteAsk($, r, `${op} ${client.name} in ${room.name} · ${room.label}`);
  void loadOffice($);
}

function noteAsk($, r, fallback) {
  if (!r.ok) { S.why.rooms = `Not asked: ${r.why ?? r.message ?? 'no reason given'}`; redraw($); return; }
  if (r.asked) {
    S.asks.push({ what: r.what ?? fallback, link: r.link ?? null, at: Date.now() });
    S.asks = S.asks.slice(-8);
    $.ui.toast(`Waiting for your tap: ${r.what ?? fallback}. The link is in the Studio pane (Rooms).`, { timeoutMs: 8000 });
  } else $.ui.toast(r.message ?? 'Done.');
  redraw($);
}

async function announce($, room, text) {
  const line = String(text ?? '').trim();
  if (!line) return;
  S.busy.rooms = 'announcing';
  redraw($);
  const r = await studioCli($, ['office', 'announce', line, '--game', room.game, '--room', room.room]);
  S.busy.rooms = null;
  if (r.ok) $.ui.toast(`Announced in ${room.name} · ${room.label}${r.people !== undefined ? ` to ${r.people} ${r.people === 1 ? 'person' : 'people'}` : ''}.`);
  else S.why.rooms = `Not announced: ${r.why ?? r.message}`;
  redraw($);
}

async function launchState($, game, launch, remix) {
  S.busy.rooms = 'asking the office';
  redraw($);
  const r = await studioCli($, ['office', 'launch', game.id, ...(launch ? [launch] : []), ...(remix === null ? [] : ['--remixable', remix ? 'on' : 'off'])]);
  S.busy.rooms = null;
  noteAsk($, r, `${game.name}: ${launch ? `launch ${launch}` : `remix ${remix ? 'on' : 'off'}`}`);
}

async function loadStats($) {
  if (S.busy.stats) return;
  S.busy.stats = 'reading the studio\'s numbers (a 10-minute key, dropped after)';
  S.why.stats = null;
  redraw($);
  const r = await studioCli($, ['stats', '--range', '7d']);
  S.busy.stats = null;
  if (r.ok !== false && r.totals) S.stats = { at: Date.now(), data: r };
  else S.why.stats = `No numbers: ${r.why ?? r.message ?? 'the site did not answer'}`;
  redraw($);
}

async function readCodexes($) {
  if (!S.root) return;
  const out = [];
  for (const g of S.games.filter((x) => x.hasCodex)) {
    const text = await readText($, `${S.root}/games/${g.id}/CODEX.md`);
    if (text) out.push({ id: g.id, ...summarizeCodex(text) });
  }
  S.codexes = out;
  redraw($);
}

/**
 * The Game Lab's files (studio 0.20.0 and later): .studio/lab/server.json says which port its page is on (it counts
 * as running only when its /_lab/health answers), and .studio/lab/<game>/latest.json holds each game's last lab check.
 */
async function readLab($) {
  if (!S.root) return;
  const dir = `${S.root}/.studio/lab`;
  const server = await readJsonFile($, `${dir}/server.json`);
  let url = null;
  if (Number.isInteger(server?.port) && server.port > 0 && server.port < 65536) {
    const base = `http://127.0.0.1:${server.port}`;
    if ((await fetchJson($, `${base}/_lab/health`, { timeoutMs: 1500 }))?.ok === true) url = base;
  }
  let names = [];
  try { names = (await $.fs.list(dir)).filter((d) => d.kind !== 'file' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(d.name)).map((d) => d.name); } catch { names = []; }
  const checks = [];
  for (const id of names.slice(0, 16)) {
    const c = labCheckOf(await readJsonFile($, `${dir}/${id}/latest.json`), id);
    if (c) checks.push(c);
  }
  S.lab = { url, checks: checks.sort((a, b) => String(b.at).localeCompare(String(a.at))) };
  redraw($);
}

/** One latest.json as the Lab tab shows it, its fields checked (a file the mod did not write). */
function labCheckOf(l, id) {
  if (!l || l.v !== 1 || typeof l.at !== 'string') return null;
  const num = (v) => (Number.isFinite(v) ? v : null);
  const str = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : null);
  const phases = (ps) => (Array.isArray(ps) ? ps.slice(0, 12).filter((p) => typeof p?.name === 'string' && Number.isFinite(p.from) && Number.isFinite(p.to)).map((p) => ({ name: p.name.slice(0, 24), from: p.from, to: p.to })) : null);
  const mean = (c) => num(c?.mean);
  const drift = (v) => (Number.isInteger(v) ? v : null);
  return {
    game: id, at: l.at, take: str(l.take, 40), frames: num(l.frames), fps: num(l.fps), device: str(l.device, 16),
    today: str(l.today, 16), report: str(l.report, 200),
    timeline: { new: phases(l.timeline?.new) ?? [], today: phases(l.timeline?.today) },
    deterministic: { new: drift(l.deterministic?.new), today: drift(l.deterministic?.today) },
    cost: { new: mean(l.cost?.new), today: mean(l.cost?.today) },
  };
}

/**
 * Art direction (the style and models skills): .studio/art/<game>/latest.json, which the studio toolkit writes after
 * every `style` and `assets` command. Read with every field checked (lib/art.mjs); newest first.
 */
async function readArt($) {
  if (!S.root) return;
  const dir = `${S.root}/.studio/art`;
  let names = [];
  try { names = (await $.fs.list(dir)).filter((d) => d.kind !== 'file' && GAME_ID.test(d.name)).map((d) => d.name); } catch { names = []; }
  const out = [];
  for (const id of names.slice(0, 16)) {
    const a = artSummaryOf(await readJsonFile($, `${dir}/${id}/latest.json`), id);
    if (a) out.push(a);
  }
  S.art = out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  redraw($);
}

function gameName(id) { return S.games.find((g) => g.id === id)?.name ?? id; }

/** Lock, from the Art tab: the person's press, recorded as their words. Only the person locks. */
async function artLock($, game, d) {
  if (S.busy.art) return;
  S.busy.art = `locking ${d.name}`;
  S.why.art = null;
  redraw($);
  try {
    const r = await studioCli($, ['style', 'lock', game, d.id, '--words', 'pressed Lock in the Studio pane']);
    if (r.ok) $.ui.toast(r.locked?.length ? `Locked: ${d.name} (${d.label}).` : `${d.name} was locked already.`);
    else S.why.art = `Not locked: ${r.why ?? r.message ?? 'no reason given'}`;
  } finally { S.busy.art = null; }
  await readArt($);
}

/**
 * Unlock, from the Art tab: asked first, with the blast radius (`style blast`: the assets that go stale, what remaking
 * them costs, what is free), and only on Proceed run with the person's press as the reason.
 */
async function artUnlock($, game, d) {
  if (S.busy.art) return;
  S.busy.art = `reading what unlocking ${d.name} would make stale`;
  S.why.art = null;
  redraw($);
  try {
    const r = await studioCli($, ['style', 'blast', game, d.id]);
    const b = r.ok && r.blast && typeof r.blast === 'object' ? r.blast : null;
    if (!b || !Array.isArray(b.assets)) {
      S.why.art = `Not unlocked: the blast radius could not be read (${r.why ?? r.message ?? 'no answer'}), and nothing is unlocked without it.`;
      return;
    }
    const assets = b.assets.filter((a) => a && typeof a === 'object').slice(0, 40);
    const paid = assets.filter((a) => !a.free && Number(a.remake?.usd) > 0);
    const cost = Number(b.totals?.usd) || 0;
    S.busy.art = `waiting for your answer: unlock ${d.name}?`;
    redraw($);
    const answer = await ask($, {
      question: `Unlock ${d.name} in ${gameName(game)}?`,
      title: `Unlock ${d.name}`,
      lines: [
        { k: 'Now', v: String(b.from ?? d.label) },
        { k: 'Stale', v: assets.length ? `${assets.length} asset${assets.length === 1 ? '' : 's'} if it changes` : 'nothing made under it', ...(assets.length ? { style: { color: 'yellow' } } : {}) },
        { k: 'Remake', v: cost ? `about ${usd(cost)} (${paid.length} paid)` : 'free', ...(cost ? { style: { color: 'yellow', bold: true } } : {}) },
        ...(Number(b.totals?.free) > 0 ? [{ k: 'Free', v: `${Number(b.totals.free)} by a re-tint or the library` }] : []),
      ],
      detail: {
        lines: [
          { k: 'Decision', v: `${d.id} (${d.name}), locked by the person: ${b.from ?? d.label}` },
          ...(Array.isArray(b.decisions) && b.decisions.length ? [{ k: 'Also moves', v: b.decisions.map(String).join(', ') }] : []),
          ...assets.map((a) => ({ k: String(a.id), v: `${a.kind ?? 'asset'}, ${a.route ?? '?'}: ${a.free ?? `${a.remake?.how ?? 'remade'}${Number(a.remake?.usd) > 0 ? `, about ${usd(a.remake.usd)}` : ''}`}` })),
          { k: 'Remaking all', v: cost ? `about ${usd(cost)}, under the game's art budget` : 'costs nothing', style: { bold: true } },
          String(b.note ?? 'Nothing is remade by itself.'),
          'Proceed unlocks it (your press is recorded as the reason). It stays as it is until you or Claude change it.',
        ],
      },
    });
    if (answer !== 'Proceed') { $.ui.toast(`${d.name} stays locked.`); return; }
    S.busy.art = `unlocking ${d.name}`;
    redraw($);
    const u = await studioCli($, ['style', 'unlock', game, d.id, '--reason', 'pressed Unlock in the Studio pane']);
    if (u.ok) $.ui.toast(u.already ? `${d.name} was not locked.` : `Unlocked ${d.name} (now steered: Claude may change it with you).`);
    else S.why.art = `Not unlocked: ${u.why ?? u.message ?? 'no reason given'}`;
  } finally {
    S.busy.art = null;
    await readArt($);
  }
}

/** `/lock <decision> [game]`: the person typed it, so it is their word. */
async function lockCommand($, args) {
  const [did, want] = args.split(/\s+/).filter(Boolean);
  if (!did || !/^[a-z]+(?:\.[a-z0-9-]{1,40}){0,2}$/.test(did)) return 'Usage: /lock <decision> [game], for example /lock style.palette (or /lock style for the whole style phase). /look lists the decisions.';
  if (want && !GAME_ID.test(want)) return `"${want.slice(0, 40)}" is not a game id.`;
  await readArt($);
  const picked = artFor(S.art, want);
  if (!picked.list) return picked.why;
  if (picked.list.length > 1) return `Several games have art direction (${picked.list.map((a) => a.game).join(', ')}): /lock ${did} <game>.`;
  const game = picked.list[0].game;
  const r = await studioCli($, ['style', 'lock', game, did, '--words', `/lock ${did}`]);
  await readArt($);
  if (!r.ok) return `Not locked: ${r.why ?? r.message ?? 'no reason given'}`;
  const all = (S.art.find((a) => a.game === game)?.decisions ?? []).flatMap((p) => p.rows);
  const words = (id) => { const x = all.find((y) => y.id === id); return x ? `${x.name} (${x.label})` : id; };
  return [
    r.locked?.length ? `Locked in ${gameName(game)}: ${r.locked.map(words).join('; ')}.` : `Nothing new to lock in ${gameName(game)}.`,
    ...(r.already?.length ? [`  already locked: ${r.already.join(', ')}`] : []),
    '  Claude cannot change a locked decision; unlocking is asked for in the Studio pane (/look, then Unlock), with what goes stale.',
  ].join('\n');
}

async function codexLink($, c) {
  S.busy.codex = `a private link to ${c.title ?? c.id}`;
  redraw($);
  const r = await studioCli($, ['codex', 'link', c.id]);
  S.busy.codex = null;
  if (r.ok && r.link) S.codexLinks[c.id] = r.link;
  else $.ui.toast(`No link: ${r.why ?? r.message ?? 'the site did not answer'}`);
  redraw($);
}

async function stopBuild($) {
  const r = await studioCli($, ['progress', 'stop']);
  $.ui.toast(r.ok === false ? `Could not ask the build to stop: ${r.why}` : 'The build stops at its next safe point.');
  void tick($, { force: true });
}

/* ------------------------------------------------------------------ the timer */

async function tick($, { force = false } = {}) {
  if (S.ticking) return;
  S.ticking = true;
  let changed = false;
  try {
    S.tickN++;
    if (!S.root || S.tickN % 5 === 0) { const before = S.root; await findStudio($); if (S.root !== before) { changed = true; if (S.root) await readStudio($); } }
    if (S.root) {
      if (S.tickN % 15 === 1 || force) { await readStudio($); changed = true; }
      if (await readFeed($)) changed = true;
      if (S.tickN % 15 === 2 || (force && Date.now() - S.rooms.at > 5000)) { await loadRooms($); changed = true; }
      if (S.tab === 'codex' && S.tickN % 15 === 4) await readCodexes($);
      if (S.tab === 'lab' && S.tickN % 5 === 3) await readLab($);
      if (S.tab === 'art' && S.tickN % 5 === 3) await readArt($);
    }
    if (await readParts($)) changed = true;
    await keepBridges($);
  } catch (error) {
    $.ui.log(`homie tick: ${String(error?.message ?? error).slice(0, 200)}`, { to: 'debug' });
  } finally { S.ticking = false; }
  if (changed) redraw($);
}

/** Ask for a redraw only when what is drawn could have changed. */
function redraw($) { $.ui.invalidate('ui.render'); }

async function openPane($, id, title, extra = {}) {
  if (!S.surfaces.length) { try { S.surfaces = [...(await $.session.surfaces())]; } catch { S.surfaces = []; } }
  if (!S.surfaces.length) return false;
  try {
    const r = await $.ui.open({ id, title, focus: true, closeOnEscape: true, ...extra });
    redraw($);
    return r.isPlaced !== false;
  } catch { return false; }
}

/* ------------------------------------------------------------------ what each tool call was */

function callOf(command) {
  const c = studioCalls(command)[0];
  if (c) return { homie: true, sub: c.sub, label: LABELS[c.sub] ?? `homie-studio ${c.sub}` };
  const m = /(?:^|\/)(playtest|art|music|video|sound|perf)\.mjs\s+(\w+)/.exec(String(command ?? ''));
  if (m && /skills\//.test(String(command))) return { homie: true, sub: `${m[1]} ${m[2]}`, playtest: m[1] === 'playtest', label: `${m[1][0].toUpperCase()}${m[1].slice(1)} · ${m[2]}` };
  return null;
}

function noteCall(e) {
  try {
    if (e.tool === 'Bash') {
      const c = callOf(e.command);
      if (c) { S.calls.set(e.tool_use_id, c); if (S.calls.size > 300) S.calls.delete(S.calls.keys().next().value); }
    }
    if (e.agentId) {
      const l = S.parts.get(e.agentId) ?? { id: e.agentId, description: '', type: '', status: 'running', startedAt: Date.now(), endedAt: null, tools: 0, files: new Set(), last: '' };
      l.tools++;
      const target = e.file_path ?? e.notebook_path ?? e.path ?? e.pattern ?? e.command ?? e.url ?? '';
      const rel = S.root && typeof target === 'string' ? target.replace(`${S.root}/`, '') : String(target);
      l.last = `${e.tool}${rel ? ` ${String(rel).replace(/\s+/g, ' ').slice(0, 90)}` : ''}`;
      if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(e.tool) && typeof target === 'string') l.files.add(rel);
      l.lastAt = Date.now();
      S.parts.set(e.agentId, l);
    }
  } catch { /* tracking never stops a call */ }
}

function afterCall($, e, result) {
  try {
    if (e.tool === 'Bash') {
      const c = S.calls.get(e.tool_use_id);
      if (c?.homie && /^(progress|check|port check|build|deploy|dev|game|codex|office|stats)/.test(c.sub)) void tick($, { force: true });
      // A style or assets command rewrites .studio/art/<game>/latest.json: the open Art tab shows it now, not in 10 s.
      if (c?.homie && /^(style|assets)\b/.test(c.sub) && S.tab === 'art') void readArt($);
    }
    if (e.tool === 'Agent' || e.tool === 'Task') void readParts($, { force: true });
  } catch { /* never */ }
}

function redactResult(result) {
  if (!result || result.deny || result.result === undefined) {
    if (result?.isError && typeof result.text === 'string') {
      const r = redact(result.text);
      if (r.hits.length) { keepLinks(r.links); return { deny: r.value }; }
    }
    return result;
  }
  const r = redact(result.result);
  if (!r.hits.length) return result;
  keepLinks(r.links);
  const note = `The Homie mod took ${r.hits.length === 1 ? 'a secret' : 'secrets'} (${r.hits.join(', ')}) out of this output before you read it.${r.links.length ? ' A one-time owner link is in the person\'s Homie Studio pane (Rooms): tell them it is there; you never see it.' : ''} In this app, the studio's own commands (npx --no-install homie-studio office …, stats, agents sit) use their keys themselves.`;
  return { result: r.value, context: [...(result.context ?? []), note] };
}

function keepLinks(links) {
  for (const link of links) S.forYou.push({ link, at: Date.now() });
  S.forYou = S.forYou.slice(-6);
}

/* ------------------------------------------------------------------ guards */

// What each hold means is decided in lib/holds.mjs, which Codex's hooks (hooks/codex.mjs) share; here a hold is asked
// in Claude Code's own question dialog, with its whole story in the Hold pane.

/** The files, processes and addresses lib/holds.mjs reads through: the mod's own calls. */
function ioOf($) {
  return {
    exists: (path) => $.fs.exists(path),
    read: (path) => $.fs.read(path),
    stat: (path, opts) => $.fs.stat(path, opts),
    list: (path) => $.fs.list(path),
    run: (argv, opts) => $.process.run(argv, opts),
    fetchJson: (url) => fetchJson($, url),
  };
}

/** What lib/holds.mjs knows about this session: the studio the mod keeps, and the mod's settings. */
function holdCtx() {
  return {
    app: 'claude', cwd: S.cwd, root: S.root, studio: S.studio, local: S.local, name: S.name, feed: S.feed, last: S.last,
    guards: { guardFiles: OPT.guardFiles, guardDeploys: OPT.guardDeploys, guardSpend: OPT.guardSpend },
  };
}

/** What only the mod knows about a deploy: its record of the last one, the live site's games and who is playing. */
async function deployKnown($, root) {
  const own = root === S.root;
  return {
    by: 'Claude', stored: await $.store.get(`deployed:${root}`),
    ...(own ? { live: S.live, liveIds: (S.rooms.games ?? []).map((g) => g.id), games: S.games, playing: S.rooms.live?.playing ?? 0 } : {}),
  };
}

/** A decision from lib/holds.mjs, settled here: a refusal as it is, a note as a toast, a hold asked. */
async function settle($, d) {
  if (!d) return null;
  if (d.deny) return { deny: d.deny };
  if (d.note) { $.ui.toast(d.note); return null; }
  const answer = await ask($, d.hold);
  if (answer === 'Proceed') return null;
  return { deny: answer === null ? d.hold.nobody : d.hold.no };
}

async function ask($, g) {
  S.guardN++;
  const q = `${g.question} (Homie hold #${S.guardN})`;
  S.guards.set(q, g);
  // The dialog's panel is short (Claude Code allows 12 rows around it): the whole story is in the Hold pane while the
  // question waits, or, where no pane can be placed (a narrow terminal), in dim lines above the dialog.
  if (g.detail && S.surfaces.length) {
    S.held = g;
    let placed = false;
    try { placed = (await $.ui.open({ id: HOLD, title: 'Homie · hold' })).isPlaced !== false; } catch { placed = false; }
    if (!placed) $.ui.log(holdText(g).slice(0, 4000));
  }
  try {
    return await $.ui.ask(q, { options: ['Proceed', 'Cancel'], header: 'Homie' });
  } catch { return null; } finally {
    S.guards.delete(q);
    if (S.held === g) { S.held = null; try { await $.ui.close({ id: HOLD }); } catch { /* closed */ } }
  }
}

async function afterDeploy($, root, result) {
  try {
    const out = typeof result?.result?.stdout === 'string' ? result.result.stdout : typeof result?.text === 'string' ? result.text : '';
    if (result?.deny || result?.isError || !/Live: https?:\/\//.test(out)) return;
    const head = await $.process.run(['git', '-C', root, 'rev-parse', 'HEAD'], { timeoutMs: 8000 });
    if (head.exitCode === 0) await $.store.set(`deployed:${root}`, { commit: head.stdout.trim(), at: new Date().toISOString() });
    void tick($, { force: true });
  } catch { /* the next deploy summary reads the time instead */ }
}

/* ------------------------------------------------------------------ parts */

async function readParts($, { force = false } = {}) {
  const running = [...S.parts.values()].some((l) => l.status === 'running');
  if (!force && !running && Date.now() - S.agentsAt < 30_000) return false;
  S.agentsAt = Date.now();
  let list = [];
  try { list = await $.agent.list(); } catch { return false; }
  let changed = false;
  for (const a of list) {
    if (a.parentId && !S.parts.has(a.id)) continue;
    const l = S.parts.get(a.id) ?? { id: a.id, startedAt: Date.now(), endedAt: null, tools: 0, files: new Set(), last: '' };
    if (l.status !== a.status || l.description !== a.description) changed = true;
    l.description = a.description; l.type = a.type; l.status = a.status;
    if (a.status !== 'running' && !l.endedAt) l.endedAt = l.lastAt ?? Date.now();
    S.parts.set(a.id, l);
  }
  const now = partList().filter((l) => l.status === 'running').length;
  if (now >= 2 && !S.partsAutoOpened && S.root && OPT.paneAutoOpen && S.interactive && S.surfaces.length) {
    S.partsAutoOpened = true;
    try { const r = await $.ui.open({ id: PARTS, title: 'Parts' }); if (!r.isPlaced) $.ui.toast(`${now} agents are building in parallel: /parts shows each one.`); } catch { /* open already */ }
  }
  if (now === 0) S.partsAutoOpened = false;
  return changed;
}

function partList() {
  return [...S.parts.values()].filter((l) => l.description || l.tools).slice(-12).map((l) => ({ ...l, edits: l.files?.size ?? 0 }));
}

function partName(id) { return S.parts.get(id)?.description || 'a part'; }

/* ------------------------------------------------------------------ the game bridge: the arcade and a live Watch */

async function loadArcadeGames($) {
  if (Date.now() - S.arcadeGamesAt < 10 * 60_000 && S.arcadeGames.length) return;
  const list = [];
  if (S.root) {
    const base = S.live ?? S.dev;
    if (base) for (const g of S.games.filter((x) => !x.planned)) list.push({ key: `studio:${g.id}`, id: g.id, name: g.name ?? g.id, studio: S.name, base });
  }
  const arcade = await fetchJson($, `${ARCADE_HOME}/api/games`);
  for (const g of arcade?.games ?? []) list.push({ key: `arcade:${g.id}`, id: g.id, name: String(g.name ?? g.id).slice(0, 40), studio: 'Homie Arcade', base: ARCADE_HOME });
  S.arcadeGames = list;
  S.arcadeGamesAt = Date.now();
  if (!S.arcade.pick && list.length) S.arcade.pick = (list.find((g) => g.id === 'bone-burglar') ?? list[0]).key;
  redraw($);
}

/** The arcade's picture: as wide as the pane, and as tall as the pane leaves room for (the page is laid out to it). */
function arcadeSize(columns, bodyRows) {
  const cols = Math.max(24, Math.min(columns - 2, 120));
  const rows = Math.max(8, Math.min(Math.max(8, bodyRows - 6), Math.round(cols * 0.6)));
  return { cols, rows };
}

function pictureFormat() {
  const terminal = S.surfaces.includes('terminal');
  if (!terminal) return 'jpeg';
  return OPT.pictures === 'image' ? 'png' : 'cells';
}

async function startArcade($) {
  const g = S.arcadeGames.find((x) => x.key === S.arcade.pick);
  if (!g) return;
  const size = arcadeSize(80, 30);
  S.arcade.game = { ...g, hint: g.id === '2048-race' ? 'arrows slide the tiles' : '' };
  await startBridge($, 'arcade', { url: `${g.base}/${g.id}/play`, ...size, fps: pictureFormat() === 'jpeg' ? 4 : 8, mode: 'playing', pane: ARCADE });
}

/** Watch the room of the game being built (its dev site first): the Build tab's live picture. */
async function startWatch($, gameId) {
  await loadRooms($, { force: true });
  const r = roomList().find((x) => x.watch && (!gameId || x.game === gameId));
  if (!r) { $.ui.toast('No live room of this game right now: a room exists while someone plays.'); return; }
  await startBridge($, 'watch', { url: new URL(r.watch, r.base).href, cols: 64, rows: 18, fps: pictureFormat() === 'jpeg' ? 3 : 6, mode: 'watching', pane: PANE, label: `${r.name} · ${r.label}` });
}

async function watchRoom($, r) {
  if (!r.watch || !r.base) return;
  S.arcade.game = { key: `${r.where}:${r.game}`, id: r.game, name: r.name, studio: S.name, base: r.base };
  await openPane($, ARCADE, 'Arcade', { focus: true, rows: 30 });
  await startBridge($, 'arcade', { url: new URL(r.watch, r.base).href, ...arcadeSize(80, 30), fps: pictureFormat() === 'jpeg' ? 4 : 8, mode: 'watching', pane: ARCADE });
}

async function startBridge($, which, { url, cols, rows, fps, mode, pane, label }) {
  stopBridge($, which);
  const format = pictureFormat();
  const b = { ...idleBridge(), state: 'starting', url, cols, rows, format, mode, pane, label, startedAt: Date.now(), lastPing: Date.now(), paused: false };
  if (which === 'arcade') { b.pick = S.arcade.pick; b.game = S.arcade.game; }
  S[which] = b;
  redraw($);
  void (async () => {
    try {
      const stream = $.process.spawn({ argv: ['node', `${$.plugin.root}/mod/bridge.mjs`, '--url', url, '--cols', String(cols), '--rows', String(rows), '--fps', String(fps), '--format', format] });
      b.stream = stream;
      let buf = '';
      for await (const piece of stream) {
        if (S[which] !== b || b.stopping) break;
        if (piece.stream !== 'stdout') continue;
        buf += piece.text;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const text = buf.slice(0, i); buf = buf.slice(i + 1); bridgeLine($, b, text); }
        if (buf.length > 4_000_000) buf = '';
      }
    } catch (error) {
      b.why = `The game bridge stopped: ${String(error?.message ?? error).slice(0, 160)}`;
    }
    if (S[which] === b) { b.state = b.stopping ? 'idle' : 'ended'; b.sock = null; }
    redraw($);
  })();
}

function bridgeLine($, b, text) {
  let m;
  try { m = JSON.parse(text); } catch { return; }
  if (m.t === 'ready') { b.sock = m.sock; return; }
  if (m.t === 'status') {
    const before = JSON.stringify([b.status?.room, b.status?.seat, b.status?.players, b.status?.bots, b.state]);
    b.status = m;
    if (b.state === 'starting' && (m.room || m.seat !== null)) b.state = b.mode;
    if (before !== JSON.stringify([m.room, m.seat, m.players, m.bots, b.state])) redraw($);
    return;
  }
  if (m.t === 'frame') {
    const now = Date.now();
    b.frames = [...b.frames.filter((x) => now - x < 3000), now];
    b.fps = Math.round(b.frames.length / 3);
    if (b.state === 'starting') b.state = b.mode;
    const key = b.pane === PANE ? 'watch' : 'screen';
    if (m.cells) {
      const fresh = !b.pic || b.pic.columns !== m.cols || b.pic.rows !== m.rows;
      b.pic = { key, cells: m.cells, columns: m.cols, rows: m.rows };
      if (fresh) redraw($);
      else $.ui.blit({ requestId: b.pane, key, columns: m.cols, rows: m.rows, cells: m.cells }).then((r) => { if (r?.deny) redraw($); }).catch(() => {});
    } else if (m.png) {
      const rows = Math.max(6, Math.round((b.cols * m.height) / m.width / 2));
      const fresh = !b.pic || b.pic.columns !== b.cols || b.pic.rows !== rows;
      b.pic = { key, image: { png: m.png }, columns: b.cols, rows };
      if (fresh) redraw($);
      else $.ui.blit({ requestId: b.pane, key, source: { png: m.png }, columns: b.cols, rows }).then((r) => { if (r?.deny) redraw($); }).catch(() => {});
    } else if (m.jpeg) {
      b.pic = { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.width} ${m.height}"><image href="data:image/jpeg;base64,${m.jpeg}" width="${m.width}" height="${m.height}"/></svg>`, width: Math.min(640, m.width * 1.3), height: Math.round(Math.min(640, m.width * 1.3) * (m.height / m.width)) };
      redraw($);
    }
    return;
  }
  if (m.t === 'error') { b.why = m.message; redraw($); return; }
  if (m.t === 'bye') { b.state = b.stopping ? 'idle' : 'ended'; if (m.why === 'no-chrome') b.why = 'No Chrome on this computer: the arcade needs Google Chrome (or CHROME_PATH).'; redraw($); }
}

async function bridgePost($, b, path, body = {}) {
  if (!b?.sock) return null;
  try {
    const res = await $.http.fetch(`http://bridge${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), socketPath: b.sock });
    return res.ok ? JSON.parse(res.text) : null;
  } catch { return null; }
}

function stopBridge($, which) {
  const b = S[which];
  if (!b || b.state === 'idle') return;
  b.stopping = true;
  if (b.sock) void bridgePost($, b, '/quit');
  try { void b.stream?.return?.(); } catch { /* ended */ }
  S[which] = which === 'arcade' ? { ...idleBridge(), pick: S.arcade.pick, game: null } : idleBridge();
}

async function arcadeKey($, key) {
  const b = S.arcade;
  if (!b.sock || b.mode !== 'playing') return;
  await bridgePost($, b, '/key', { key, hold: b.game?.id === '2048-race' ? 90 : 300 });
}

/** Keep each bridge alive while its pane shows it, paused while hidden, and gone when its pane is closed. */
async function keepBridges($) {
  const live = ['arcade', 'watch'].filter((w) => S[w].state !== 'idle' && S[w].state !== 'ended' && S[w].sock);
  if (!live.length) return;
  let panes = [];
  try { panes = await $.ui.panes(); } catch { panes = []; }
  for (const which of live) {
    const b = S[which];
    const p = panes.find((x) => x.id === b.pane);
    if (!p) { stopBridge($, which); redraw($); continue; }
    const shown = p.isShown && p.isPlaced && (which === 'arcade' || S.tab === 'build');
    if (!shown && !b.paused) { b.paused = true; await bridgePost($, b, '/pause'); }
    else if (shown && b.paused) { b.paused = false; await bridgePost($, b, '/resume'); }
    if (Date.now() - b.lastPing > 10_000) { b.lastPing = Date.now(); await bridgePost($, b, '/alive'); }
  }
}

function arcadeData() {
  const a = S.arcade;
  return { state: a.state, game: a.game, pick: a.pick, status: a.status, pic: a.pic, fps: a.fps, why: a.why };
}

function watchData(b) {
  const w = S.watch;
  const rooms = roomList().filter((r) => r.watch && (!b?.id || r.game === b.id));
  return { live: w.state === 'watching' || w.state === 'starting', label: w.label, fps: w.fps, pic: w.pic, room: rooms[0] ?? null, url: rooms[0] ? new URL(rooms[0].watch, rooms[0].base).href : null };
}

/* ------------------------------------------------------------------ data for the drawings */

function paneStudio() {
  return { name: S.name, live: S.live, dev: S.dev, games: S.games, toolkit: S.toolkit, root: S.root };
}

function bandData() {
  const doc = S.feed ?? (S.last && Date.now() - Date.parse(S.last.endedAt ?? S.last.updatedAt ?? 0) < RECENT_MS ? S.last : null);
  const b = doc ? summarize(doc) : null;
  const gameId = b?.id ?? (S.games.filter((g) => !g.planned).length === 1 ? S.games.find((g) => !g.planned).id : null);
  const game = gameId ? S.games.find((g) => g.id === gameId) : null;
  const base = S.dev ?? S.live;
  const playing = S.rooms.at ? (S.rooms.live?.playing ?? 0) + (S.rooms.dev?.playing ?? 0) : null;
  return {
    name: S.name,
    game: game?.name ?? b?.title ?? null,
    build: b ? { state: b.state, percent: b.percent, stage: b.stage?.label ?? null, stopping: b.stopping, checks: b.counts.total ? `${b.counts.pass}/${b.counts.total} checks` : '', failing: b.counts.fail > 0 } : null,
    play: b?.preview ? linkable(b.preview) : gameId && base ? linkable(`${base}/${gameId}/play`) : null,
    playing,
  };
}

/** A Homie result as a card (a checklist, rows, live links, a build or studio card), or null when it is not one. */
function resultCard(t, tool, call, output, viewport) {
  const read = readResult({ tool, call, output });
  if (!read) return null;
  const columns = Math.max(30, Math.min(120, (viewport?.columns ?? 100) - 8));
  if (read.kind === 'setup') return setupCard(t, read.data, columns);
  if (read.kind === 'checks') return checksCard(t, read.data, columns);
  if (read.kind === 'deploy') return deployCard(t, read.data, columns);
  if (read.kind === 'card:setup') return setupFromCard(t, read.data, columns);
  if (read.kind === 'card:build') return read.data.feed ? buildCard(t, summarize(read.data.feed), columns) : null;
  if (read.kind === 'card:studio') return studioCard(t, read.data, columns);
  return null;
}

function setupFromCard(t, d, columns) {
  const rows = (d.status?.rows ?? []).map((r) => ({ state: r.state, label: r.label, need: r.need ?? 'required', detail: r.detail ?? '', fix: r.fix?.run ?? r.fix?.open ?? '' }));
  const steps = (d.checklist ?? []).map((s) => ({ state: s.state === 'done' ? 'ok' : s.state === 'now' ? 'act' : 'optional', label: s.label, need: 'required', detail: '', fix: '' }));
  return setupCard(t, { title: d.current ? `Setting up ${d.current.name}` : 'Setup status', rows: [...steps, ...rows], ready: (d.status?.features ?? []).map((f) => ({ feature: f.feature, state: f.state })), next: (d.status?.next ?? []).map((n) => n.run ?? n.open ?? n.say).filter(Boolean), updates: typeof d.updates === 'string' ? d.updates : null }, columns);
}

/* ------------------------------------------------------------------ text, for commands (and where nothing draws) */

function studioText() {
  return [buildText(), roomsText()].join('\n');
}

function buildText() {
  const doc = S.feed ?? S.last;
  if (!doc) return `${S.name}: no build yet.`;
  const b = summarize(doc);
  return [
    `${b.title}: ${b.state}${b.state === 'running' ? ` (${b.stage?.label ?? ''}, ${b.percent}%)` : ` ${ago(b.endedAt ?? b.updatedAt, Date.now())}`}`,
    `  ${b.stages.map((s) => `${s.state === 'done' ? '✓' : s.state === 'running' ? '●' : s.state === 'failed' ? '✗' : '○'} ${s.label}`).join(' → ')}`,
    ...b.checks.slice(-8).map((c) => `    ${c.state === 'pass' ? '✓' : c.state === 'fail' ? '✗' : c.state === 'running' ? '●' : '○'} ${c.label}${c.note ? `: ${c.note}` : ''}`),
    ...(b.preview ? [`  ▶ Play: ${linkable(b.preview)}`] : []),
    ...(b.spend.text ? [`  spent ${b.spend.text}`] : []),
  ].join('\n');
}

function roomsText() {
  const all = roomList();
  if (!all.length) return `${S.name}: no live rooms right now${S.live || S.dev ? '' : ' (not online yet)'}.`;
  return [`${S.name}: ${all.reduce((n, r) => n + r.players, 0)} playing in ${all.length} room${all.length === 1 ? '' : 's'}`,
    ...all.map((r) => `  ${r.name} · ${r.label}: ${r.players}/${r.max}${r.ai ? `, ${r.ai} AI` : ''}${r.where === 'here' ? ' (this computer)' : ''}${r.watch ? `  ◉ ${linkable(new URL(r.watch, r.base).href)}` : ''}`)].join('\n');
}

function partsText() {
  const parts = partList();
  if (!parts.length) return 'No parts: nothing is building in parallel now.';
  return parts.map((l) => `${l.status === 'running' ? '●' : l.status === 'completed' ? '✓' : '✗'} ${l.description || l.id}: ${l.tools} tools, ${l.edits} files${l.last ? ` · ${l.last}` : ''}`).join('\n');
}

/** The art commands' words: the look (/look), the assets (/assets), the characters (/cast), their clips (/clips) or
 * the lineup (/lineup), for the game named or each. */
function artText(what, want) {
  const picked = artFor(S.art, want);
  if (!picked.list) return picked.why;
  const now = Date.now();
  return picked.list.slice(0, 6).map((a) => (what === 'assets' ? castText(a, gameName(a.game)) : what === 'cast' ? charactersText(a, gameName(a.game)) : what === 'clips' ? clipsText(a, gameName(a.game)) : what === 'lineup' ? lineupText(a, gameName(a.game), now) : lookText(a, gameName(a.game), now))).join('\n\n');
}

function deployText(d) {
  return [
    `${S.name}: ${d.live ? `live at ${d.live}` : 'not online yet'}`,
    `  last deploy: ${d.lastDeploy}`,
    ...(d.commitCount ? [`  ${d.commitCount} commit${d.commitCount === 1 ? '' : 's'} since: ${d.commits.slice(0, 5).join(' · ')}`] : ['  no commits since the last deploy on record']),
    ...(d.diffstat ? [`  ${d.diffstat}`] : []),
    ...(d.uncommitted ? [`  ${d.uncommitted} uncommitted change${d.uncommitted === 1 ? '' : 's'} (a deploy ships them as they are)`] : []),
    ...(d.newGames.length ? [`  not live yet: ${d.newGames.join(', ')}`] : []),
    `  checks: ${d.checks}`,
    ...(d.playing ? [`  ${d.playing} playing now`] : []),
  ].join('\n');
}

async function perfText($, want) {
  const base = `${S.root}/.perf`;
  let games = [];
  try { games = (await $.fs.list(base)).map((d) => d.name).filter((n) => !want || n === want); } catch { games = []; }
  if (!games.length) return want ? `No performance runs of ${want} yet: ask Claude to measure it (the perf skill), or run npx --no-install homie-studio perf ${want} --url <site>.` : 'No performance runs yet: ask Claude to make a game faster (the perf skill), which measures first.';
  const out = [];
  for (const g of games.slice(0, 4)) {
    let runs = [];
    try { runs = (await $.fs.list(`${base}/${g}`)).map((d) => d.name).filter((n) => /^\d/.test(n)).sort(); } catch { runs = []; }
    const last = runs[runs.length - 1];
    const sum = last ? await readJsonFile($, `${base}/${g}/${last}/summary.json`) : null;
    if (!sum?.metrics) { out.push(`${g}: no finished run`); continue; }
    out.push(`${g}: ${sum.counted}/${sum.runs} runs counted (${last}, ${sum.renderers?.join(', ') || 'renderer unknown'})`);
    for (const device of sum.devices ?? []) {
      for (const role of ['host', 'replica']) {
        const m = (k) => sum.metrics[`${device}.${role}.${k}`]?.median;
        if (m('frame.p50') === undefined) continue;
        out.push(`  ${device} ${role}: frames ${m('frame.p50')} ms median, ${m('frame.p95')} ms p95 · game JS ${m('work.p50')} ms · main thread ${m('busy')} ms · playable at ${m('load.playable') ?? '?'} ms`);
      }
    }
    if (await $.fs.exists(`${S.root}/perf/${g}/README.md`)) out.push(`  the perf loop's report: perf/${g}/README.md`);
  }
  return out.join('\n');
}
