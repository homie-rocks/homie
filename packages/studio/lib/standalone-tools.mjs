/**
 * STANDALONE COPIES AS A CHAT TOOL (standalone/STANDALONE.md): game_standalone, one tool. With plan: true it reads
 * and answers at once (what would be built, what each target still needs here, what a standalone copy does not
 * have); without, it builds, which takes minutes, so it runs as a job that studio_job follows.
 *
 * WHICH TOOLKIT RUNS IT. The chat tools run a studio's own pinned toolkit, and one from before 0.32.0 has no
 * `standalone` command. So the plan is made here, by this toolkit; and the build is run by this toolkit's own
 * command when the studio pins an older one, as an upgrade is (lib/mcp-tools.mjs studio_run). The result says so,
 * because that studio's live site cannot answer a standalone copy yet: it must upgrade and deploy first.
 *
 * Nothing is ever uploaded to Steam or a store from here, and no signing key is taken in chat: a release reads the
 * environment only. What the standalone game does not have is said to the person as it is, every time.
 */
import { join } from 'node:path';
import { SAY_MISSING, standaloneLines } from './standalone-cli.mjs';
import { STANDALONE_SINCE, standalonePlan, toolkitNote } from './standalone.mjs';
import { TARGETS } from './standalone-files.mjs';
import { PACKAGE_ROOT } from './studio.mjs';

export { SAY_MISSING };

export function standaloneToolDefs(ctx, h) {
  const { ok, fail, cli, stillRunning, whyOf, needsInstall, str, STUDIO_ARG } = h;
  return [
    {
      name: 'game_standalone', title: 'Make a standalone game',
      description: `Make one of the studio's games into an app of its own: a desktop app for macOS, Windows and Linux (the kind of build Steam accepts for upload) and a phone app for iOS and Android (the files the App Store and Google Play accept for upload; each store's review, fees and rules are its own, and nothing here makes an app pass). It is the same web build of the game in a thin shell (Electron on computers, Capacitor on phones); multiplayer still goes through the studio's own deployed site, and with no connection the game plays offline with its bots. Use it when the person asks for a Steam build, a desktop app, a download, an iPhone or Android app, or "a standalone version". ALWAYS call it with plan: true first and tell the person what it says: which targets this computer can build and what the others need, the address that gets built into every copy, and what a standalone copy does NOT have in this version (no player accounts, no cloud saves: saves stay on the device and are lost when the app is uninstalled, no shop, no chat). Then, when they say go, call it again without plan: it builds as a background job that takes minutes (the first build downloads the wrapper tools into the studio's .studio/ folder): it answers with a job, and studio_job { "job": … } gives the result in words when it is done; read that result to the person, including its list of what the standalone game does not have. A target whose tool is missing on this computer is skipped with its fix and the others still build; only the desktop build for this computer's own system is started once to see that the game loads, and every other build says "built, not started on this computer". It never uploads anything and never signs with a key from the chat: a release (release: true) signs from environment variables the person sets themselves, needs the app's id written in game.json first (the tool gives the exact lines), and says UNSIGNED when it could not sign. The studio must be on @homie-rocks/studio ${STANDALONE_SINCE} or later AND deployed before a copy can find rooms.`,
      inputSchema: {
        type: 'object',
        properties: {
          game: str('The game\'s id (its folder in games/)'),
          for: { type: 'array', items: { type: 'string', enum: [...TARGETS] }, description: 'Which to build (default: every one this computer can make)' },
          plan: { type: 'boolean', description: 'Only say what would be built and what is missing; build nothing, install nothing. Do this first' },
          release: { type: 'boolean', description: 'A build for a store or Steam: needs "standalone.appId" in the game\'s game.json, and signs from the environment. Only when the person asked for a release' },
          ...STUDIO_ARG,
        },
        required: ['game'],
      },
      annotations: { title: 'Make a standalone game', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const game = String(a.game ?? '');
        const only = Array.isArray(a.for) && a.for.length ? a.for.map(String).join(',') : null;
        // A studio whose own toolkit is from before standalone copies has no such command: this toolkit's runs.
        const old = toolkitNote(root);
        if (a.plan === true) {
          const r = await standalonePlan(root, game, { for: only, release: a.release === true, ...(ctx.standalone ?? {}) });
          const text = [...standaloneLines(r), ...(r.missing ? ['', SAY_MISSING] : [])].join('\n').trim();
          return r.ok ? ok(text, { kind: 'standalone-plan', ...r }) : fail(text, { kind: 'standalone-plan', ...r });
        }
        const need = needsInstall(ctx, root);
        if (need) return need;
        const args = ['standalone', 'build', game, ...(only ? ['--for', only] : []), ...(a.release === true ? ['--release'] : [])];
        const r = await cli(ctx, root, `standalone build ${game}`, args, old ? { cli: join(PACKAGE_ROOT, 'bin', 'homie-studio.mjs') } : {});
        // The words are in the result itself (`say`), so studio_job says them too when the build outlasts this call.
        if (!r.ended) return stillRunning(r.job, `The standalone build of ${game} (it takes minutes; its last lines say where it is)`);
        if (!r.result?.targets) return fail(`Not built: ${whyOf(r.job)}${r.result?.instead ? `\n\n${r.result.instead}` : ''}`, r.result ? { kind: 'standalone', ...r.result } : undefined);
        const text = (r.result.say ?? [...standaloneLines(r.result), '', SAY_MISSING]).join('\n');
        return r.result.ok ? ok(text, { kind: 'standalone', ...r.result }) : fail(text, { kind: 'standalone', ...r.result });
      },
    },
  ];
}
