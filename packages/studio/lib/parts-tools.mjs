import { purchasePortal } from './parts-purchase.mjs';
/**
 * GAME PARTS AS CHAT TOOLS (parts/PARTS.md): parts_find, part_add, part_new and part_share, named and worded like
 * the asset tools beside them (assets_find, asset_add). Four tools are the whole surface: a newer version of a part
 * is part_add again, stopping is part_share with share false, and checking is part_share with nothing to change.
 *
 * The person never types a command: every result here says what happened and what to do next in words, and names a
 * tool, never a terminal line. Tests pass `ctx.partsNet = { fetch, npm }` so nothing reaches the network or npm.
 */
import { PART_KINDS, newPart, partDir, readPart, writePart } from './parts.mjs';
import { addPart, checkParts, findParts, sharePart } from './parts-store.mjs';
import { partsLines } from './parts-cli.mjs';

/** What the planning and game-making tools say about parts, in one place so a test can hold them to it. */
export const PARTS_FIRST = 'Before writing any system from scratch (camera, movement, bots, pickups, effects, sound, UI, environment), look for what exists, two different things: (1) the @homie-rocks/* packages on npm have the general mechanism (camera, input, audio, effects): use them; (2) `parts find` (the parts_find tool) searches the pieces of real games other studios shared: a creature from one game, a level from another, a bot brain from a third, each brought in with part_add. Record in the game\'s CODEX what came from where: which packages, which parts and the game and studio each came from, and what was written here and why. After building a piece another game could use, offer the person to make it a part (part_new lifts it out of the game) and, only if they ask, to share it (part_share).';

/** A fix-it line that names the plumbing, said as the chat tool that does the same. */
export const inChat = (t) => String(t).replace(/homie-studio parts add (\S+?)(?:@(\S+))?(?: --game (\S+))?(?=[\s).,;]|$)/g, (m, ref, v, g) => `part_add { "part": "${ref}${v ? `@${v}` : ''}"${g ? `, "game": "${g}"` : ''} }`);
const text = (r) => inChat(partsLines(r).join('\n'));

export function partsToolDefs(ctx, h) {
  const { ok, fail, str, STUDIO_ARG, RO, RW } = h;
  const net = () => ctx.partsNet ?? {};
  return [
    {
      name: 'parts_find', title: 'Find game parts',
      description: 'Search the pieces of real games that studios shared (a creature, a level generator, a chase camera, a bot brain, a pickup mechanic, an audio pack), and this studio\'s own parts. The first move when planning or building a game: run it for each system the game needs before writing one from scratch, so a new game can be made with parts from several games. Each result has its licence, the game and studio it came from, its costs, what it builds on and what part_add takes. If the catalogue cannot be reached it says so (that is not "nothing exists"). Homie\'s @homie-rocks/* packages are not parts and are not listed here: they come from npm.',
      inputSchema: { type: 'object', properties: { query: str('Words for what the game needs: "chase camera", "pickups", "cave"'), kind: { type: 'string', description: 'Only this kind of part' }, tag: str('Only parts with this tag'), license: str('Only this licence (an SPDX identifier, e.g. CC0-1.0)'), builds: str('Only parts that build on this: a package ("@homie-rocks/camera") or a skeleton ("humanoid-v1")'), ...STUDIO_ARG } },
      annotations: { title: 'Find game parts', ...RO, openWorldHint: true },
      run: async (a) => {
        const root = ctx.root(a.studio, { need: false });
        const r = await findParts(root, String(a.query ?? ''), { kind: a.kind ?? null, tag: a.tag ?? null, license: a.license ?? null, builds: a.builds ?? null, fetch: net().fetch, hub: ctx.directory ?? null });
        return ok([text(r), '', r.results.length ? 'Tell the person what you found and which game each piece is from, with your pick; part_add brings one in. Write in the game\'s CODEX which parts it uses and what you wrote yourself and why.' : 'Nothing fits: write it, and say so in the game\'s CODEX. If it turns out reusable, offer to make it a part (part_new).'].join('\n'), { kind: 'parts', ...r });
      },
    },
    {
      name: 'part_add', title: 'Add a game part',
      description: 'Bring a part another studio shared into this studio, for a game: one exact version is fetched (the latest unless the part names one, "<studio site>/<part id>@1.2.0"), every file is checked against its SHA-256, and it is copied into parts/ where the studio owns and tunes it. The game credits it (its licence and who made it, on the game\'s credits page), and the packages it builds on are installed by npm. For a part that is already here it brings the newer version: what changed is shown, the studio\'s tuning is kept, and a file the studio edited is never replaced unless overwrite is true (ask the person first). The result says plainly when the licences of the game\'s parts cannot be combined, and gives the one import line.',
      inputSchema: { type: 'object', properties: { part: str('"<studio site>/<part id>", as parts_find gives it; "@<version>" for one version'), game: str('The game that will use it (its credits get the line)'), approve: str('The exact quote hash returned by part_add, ONLY after a clear yes showing its price, currency, quantity, recurrence and terms'), wallet: { type: 'string', enum: ['link-cli', 'tempo', 'purl'], description: 'The person’s installed wallet client; its authority and limits govern payment' }, quantity: { type: 'integer', minimum: 1, description: 'Number of seats; one for a studio or game licence' }, offline: { type: 'boolean', description: 'Restore the verified private purchase backup without the seller; revocation status is only last known' }, manage: { type: 'boolean', description: 'Return the purchase Stripe portal link to manage or cancel a subscription' }, overwrite: { type: 'boolean', description: 'For a newer version: also replace files this studio edited. Only after the person agreed' }, ...STUDIO_ARG }, required: ['part'] },
      annotations: { title: 'Add a game part', ...RW, openWorldHint: true },
      run: async (a) => {
        const root = ctx.root(a.studio);
        if (a.manage) { const r = await purchasePortal(root, String(a.part ?? ''), { game: a.game ?? null, ...net() }); return ok(r.message, { kind: 'part', ...r }); }
        const said = [];
        const r = await addPart(root, String(a.part ?? ''), { game: a.game ? String(a.game) : null, overwrite: a.overwrite === true, approve: a.approve ?? null, quantity: a.quantity ?? 1, offline: a.offline === true, wallet: a.wallet, say: (l) => said.push(l), ...net() });
        if (!r.ok && r.purchase) return ok(r.why, { kind: 'part', ...r, awaitingPurchase: true });
        if (!r.ok) return fail(`Not added: ${inChat(r.why)}`, { kind: 'part', ...r });
        const next = [];
        if (r.import) next.push(`In the game: import … from '${r.import}', then build. Its part.json says what it takes ("contract") and its tuning.json holds the values to tune.`);
        for (const n of r.needs) next.push(`It needs another part, ${n.ref}: part_add { "part": "${n.ref}"${a.game ? `, "game": "${a.game}"` : ''} }.`);
        if (r.licences.some((c) => c.level === 'conflict')) next.push('The licences cannot be combined (above): tell the person plainly before building on it.');
        if (r.packages.some((p) => p.state === 'pinned' || p.state === 'failed')) next.push('A package it builds on is not in place (above): the part will not build until it is.');
        return ok([...said, text(r), ...next, 'Write in the game\'s CODEX that it uses this part and which game and studio it came from.'].join('\n'), { kind: 'part', ...r });
      },
    },
    {
      name: 'part_new', title: 'Make a shared part',
      description: 'Make a part of this studio: a reusable piece of a game, app, music or video. With from (a game\'s id) and files (paths inside that game: a module or a folder), the files are LIFTED out of the game into parts/<id>/ and the game imports them from there, so it builds and behaves as before; a file that still reaches into the rest of the game is refused by name (pass what it needs in as an argument first). Without from, an empty part to write. A part is a reusable piece, never an entire experience, in whatever form suits it (code, assets, data, a tuned config). A new part is private. Offer this after building something reusable.',
      inputSchema: { type: 'object', properties: { id: str('The part\'s id (lowercase, digits, hyphens): "chase-camera"'), kind: { type: 'string', description: 'What kind of part (default mechanic)' }, name: str('Its name'), uses: { type: 'array', items: { type: 'string', enum: ['game', 'app', 'venue', 'cause', 'music', 'video'] } }, from: str('The game to lift it out of'), files: { type: 'array', items: { type: 'string' }, description: 'With from: paths inside games/<from>/ that become the part ("src/creature.ts", "src/cave")' }, ...STUDIO_ARG }, required: ['id'] },
      annotations: { title: 'Make a shared part', ...RW },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const r = newPart(root, String(a.id ?? ''), { kind: a.kind ?? 'mechanic', uses: a.uses, name: a.name ?? null, from: a.from ? String(a.from) : null, paths: Array.isArray(a.files) ? a.files.map(String) : [] });
        if (!r.ok) return fail(`No part was made: ${r.why}`, { kind: 'part', ...r });
        return ok([text(r), r.lifted ? `Build ${r.from} now and check it still plays the same.` : '', 'Fill in parts/' + r.id + '/part.json: a one-sentence summary, what it takes from a game ("contract"), and its costs if measured. It stays private until the person asks to share it (part_share).'].filter(Boolean).join('\n'), { kind: 'part', ...r });
      },
    },
    {
      name: 'part_share', title: 'Share a part',
      description: 'Share one of this studio\'s parts with other studios, or stop sharing it. Only when the person asked: a part is private until they say otherwise. It needs a licence the person picked (an SPDX identifier: CC0-1.0, CC-BY-4.0, MIT…; with license it is set here), who to credit when the licence asks, and optional sale and licenseTerms fields in part.json for a paid licence, and known rights to every file: anything in the way is listed in plain words and nothing is shared. It is live after the studio\'s next deploy (studio_deploy), not before; stopping takes effect then too. With share left out it only checks and reports.',
      inputSchema: { type: 'object', properties: { id: str('The part\'s id'), share: { type: 'boolean', description: 'true: share it; false: stop sharing it; left out: only check what stands in the way' }, license: str('The licence the person picked, an SPDX identifier (set before sharing)'), attribution: str('Who a game using it should credit'), ...STUDIO_ARG }, required: ['id'] },
      annotations: { title: 'Share a part', ...RW },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const id = String(a.id ?? '');
        if (a.license !== undefined || a.attribution !== undefined) {
          let part;
          try { part = readPart(partDir(root, id)); } catch { return fail(`There is no part "${id}" in this studio.`); }
          if (a.license !== undefined) part.license = String(a.license).trim();
          if (a.attribution !== undefined) part.attribution = String(a.attribution).slice(0, 200);
          writePart(partDir(root, id), part);
        }
        if (a.share === undefined) {
          const r = checkParts(root, id, { write: true });
          if (!r.rows?.length) return fail(r.why ?? `There is no part "${id}" in this studio.`);
          const row = r.rows[0];
          return ok([text(r), row.shareable ? 'Nothing stands in the way. It is still private: share it only when the person asks (part_share with share: true).' : 'It cannot be shared until those are settled. It is private.'].join('\n'), { kind: 'part', ...r });
        }
        const r = sharePart(root, id, a.share === true);
        if (!r.ok) return fail(`Not shared: ${inChat(r.why)}`, { kind: 'part', ...r });
        return ok([text(r), a.share === true ? 'Tell the person it is live after the studio\'s next deploy (studio_deploy), and under which licence.' : ''].filter(Boolean).join('\n'), { kind: 'part', ...r });
      },
    },
  ];
}
