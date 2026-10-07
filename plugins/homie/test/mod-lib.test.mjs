/**
 * The Homie mod's plain parts, in Node (the hooks module's own tests are `claude plugin test`, test/mod/*.test.ts):
 * - the secret patterns, on real shapes of each key and on code that only names one;
 * - the shell readers: which commands are a deploy, a paid call, a homie-studio command; protect globs;
 * - the diffs drawn above the question dialog parse as unified hunks even when cut short;
 * - the result readers agree with the studio's own formatters (the setup status from lib/doctor.mjs) and with the
 *   CLI's own print templates, so a change there fails here;
 * - the game bridge's PNG decoder and cell packer, against a PNG Node writes;
 * - art direction: the Art tab's reader keeps every field the toolkit's own latest.json writer puts there, the lock
 *   guard reads a real decisions.json, the licence guard knows every licence kind the toolkit knows, and the shell
 *   readers find `git add` / `git commit` and the models skill's paid calls.
 *
 * Run: node --test plugins/homie/test/mod-lib.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { artFor, artSummaryOf, budgetWords, charactersText, clipsText, decisionsFileOf, licenceIssues, lockedChanges, lookText, phaseStrip, publicGame } from '../hooks/lib/art.mjs';
import { cloudflareChangeOf, cloudflareMcpChangeOf, deployOf, gitStagesOf, globMatch, modelPullOf, paidMcpOf, paidOf, programOf, protectedBy, readOnlySql, studioCalls } from '../hooks/lib/commands.mjs';
import { applyEdit, unifiedDiff } from '../hooks/lib/diff.mjs';
import { summarize } from '../hooks/lib/feed.mjs';
import { redact, redactText } from '../hooks/lib/redact.mjs';
import { parseCheck, parseDeploy, parsePortCheck, parseSetupStatus, readResult } from '../hooks/lib/results.mjs';
import { summarizeCodex } from '../hooks/lib/codex.mjs';
import { cellsOf, decodePng } from '../mod/bridge.mjs';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = join(PLUGIN, '..', '..', 'packages', 'studio');

test('secrets: every kind is hidden, its public part kept, and code that names a key is not touched', () => {
  // Made-up values, built here so no key-shaped string sits in this file (the repository's leak audit reads it).
  const hsk = `hsk_${'ab12'.repeat(12)}`;
  const j = (...parts) => parts.join('');
  const cases = [
    [`Office key (until 12:00): ${hsk}`, 'office key'],
    [`write key hbk_${'0f'.repeat(24)}`, 'progress key'],
    [`pass hap_0123456789_${'Zz9_-'.repeat(8)}`, 'agent pass'],
    [j('ANTHROPIC_API_KEY=sk', '-ant-api03-', 'x'.repeat(30)), 'Anthropic key'],
    [`sk_${'1a'.repeat(24)}`, 'ElevenLabs key'],
    [j('0'.repeat(8), '-', '1'.repeat(4), '-', '2'.repeat(4), '-', '3'.repeat(4), '-', '4'.repeat(12), ':', 'f'.repeat(32)), 'fal key'],
    [`ghp_${'A1'.repeat(18)}`, 'GitHub token'],
    [j('AKIA', 'Q'.repeat(16)), 'AWS key'],
    [j('Authorization: Bear', 'er ', 'z'.repeat(30)), 'token'],
    [j('CLOUDFLARE_API_TOKEN=', 'Ab1'.repeat(12)), 'secret'],
    [j('-----BEGIN ', 'PRIVATE KEY-----\nMIIE\n-----END ', 'PRIVATE KEY-----'), 'private key'],
  ];
  for (const [text, kind] of cases) {
    const r = redactText(text);
    assert.ok(r.hits.includes(kind), `${kind}: ${text} -> ${r.text}`);
  }
  assert.match(redactText(`hap_0123456789_${'A'.repeat(40)}`).text, /^hap_0123456789_\[agent pass hidden by Homie\]$/);
  for (const code of ['const FAL_KEY = process.env.FAL_KEY', 'ELEVENLABS_API_KEY=${ELEVENLABS_API_KEY}', 'API_TOKEN=<your token>', 'export const SECRET_KEY_LENGTH = 32', 'see hsk_ keys in lib/stats.mjs']) {
    assert.equal(redactText(code).text, code, `left alone: ${code}`);
  }
});

test('secrets: a link that carries a key goes to the person whole, and objects are walked', () => {
  const link = `https://studio.example/_studio/signin?k=hsk_${'c'.repeat(48)}&to=%2F_studio%2Foffice`;
  const r = redact({ stdout: `One-time link: ${link}.`, nested: [{ a: 'nothing here' }] });
  assert.deepEqual(r.links, [link]);
  assert.match(r.value.stdout, /^One-time link: \[one-time owner link: .*Claude never sees it\]\.$/);
  assert.equal(r.value.nested, r.value.nested, 'untouched parts keep their identity');
  const same = { a: 'plain' };
  assert.equal(redact(same).value, same);
});

test('commands: homie-studio calls, through npx, npm run and a cd', () => {
  assert.equal(studioCalls('npx --no-install homie-studio check owl-rush --url http://127.0.0.1:8787')[0].sub, 'check');
  assert.equal(studioCalls('cd games && npx homie-studio port check owl-rush')[0].sub, 'port check');
  assert.equal(studioCalls('npm run deploy')[0].sub, 'deploy');
  assert.equal(studioCalls('node node_modules/@homie-rocks/studio/bin/homie-studio.mjs office kick owl-rush pub-3 2')[0].sub, 'office kick');
  assert.equal(studioCalls('npx --no-install homie-studio codex owl-rush')[0].sub, 'codex');
  // A standalone build is a command of its own words, and never a deploy: it uploads nothing.
  assert.equal(studioCalls('npx --no-install homie-studio standalone build owl-rush --for mac --release')[0].sub, 'standalone build');
  assert.deepEqual(studioCalls('npx --no-install homie-studio standalone build owl-rush --release --for mac')[0].pos, ['standalone', 'build', 'owl-rush']);
  // A run onto a real phone: --device is a switch of its own (the person's yes), never a word that swallows the next one.
  const onPhone = studioCalls('npx --no-install homie-studio standalone run owl-rush --device --for ios')[0];
  assert.deepEqual([onPhone.sub, onPhone.flags.get('device'), onPhone.flags.get('for'), onPhone.pos], ['standalone run', true, 'ios', ['standalone', 'run', 'owl-rush']]);
  assert.equal(deployOf('npx --no-install homie-studio standalone run owl-rush --for ios --device'), null, 'it deploys nothing');
  assert.equal(studioCalls('npx --no-install homie-studio setup status')[0].sub, 'setup status');
  assert.deepEqual(studioCalls('ls -la && git status'), []);
});

test('commands: deploys, and what is not one', () => {
  for (const c of ['npm run deploy', 'npx --no-install homie-studio deploy', 'cd night-owls && npx wrangler deploy', 'wrangler deploy', 'node skills/music/scripts/music.mjs publish theme', 'node x/video.mjs publish trailer']) assert.ok(deployOf(c), c);
  for (const c of ['npx --no-install homie-studio deploy --plan', 'npm run deploy -- --help', 'node x/video.mjs publish trailer --no-deploy', 'echo deploy', 'npm run build']) assert.equal(deployOf(c), null, c);
  assert.equal(deployOf('cd night-owls && npm run deploy').dir, 'night-owls');
});

test('commands: paid calls, priced by the skill\'s own --dry-run', () => {
  const art = paidOf('node /p/skills/art/scripts/art.mjs gen cover --model fal-ai/flux/dev --input in.json --out cover.png --yes');
  assert.equal(art.provider, 'fal');
  assert.equal(art.slug, 'cover');
  assert.deepEqual(art.dryRun, ['node', '/p/skills/art/scripts/art.mjs', 'gen', 'cover', '--model', 'fal-ai/flux/dev', '--input', 'in.json', '--out', 'cover.png', '--dry-run', '--json']);
  assert.equal(paidOf('node skills/music/scripts/music.mjs render theme --yes').provider, 'ElevenLabs');
  assert.equal(paidOf('node skills/music/scripts/music.mjs render theme'), null, 'without --yes it only prices');
  assert.equal(paidOf('node skills/art/scripts/art.mjs gen cover --yes --dry-run'), null);
  assert.ok(paidOf('curl -X POST https://queue.fal.run/fal-ai/flux -d @x.json').raw);
  assert.ok(paidOf('curl https://api.elevenlabs.io/v1/music').raw);
  assert.equal(paidOf('curl https://example.com'), null);
  assert.equal(paidMcpOf('mcp__fal__generate_image').provider, 'fal');
  assert.equal(paidMcpOf('mcp__elevenlabs__get_voices'), null);
  assert.equal(paidMcpOf('mcp__github__create_issue'), null);
});

test('commands: the providers\' own CLIs, where a command spends; help, dry runs, sign-ins and listings are free', () => {
  assert.deepEqual(programOf(['npx', '-y', '@elevenlabs/cli@1.4.0', 'music', 'compose']), { prog: 'elevenlabs', args: ['music', 'compose'] });
  assert.deepEqual(programOf(['npm', 'exec', '--', 'wrangler', 'whoami']), { prog: 'wrangler', args: ['whoami'] });
  assert.equal(programOf(['pnpm', 'dlx', 'tripo-cli', 'make']).prog, 'tripo');
  const paid = {
    'elevenlabs music compose --format json --json -': ['ElevenLabs', 'credits', 'elevenlabs music compose'],
    'elevenlabs music compose_detailed --output-format mp3_44100_128 --json -': ['ElevenLabs', 'credits', 'elevenlabs music compose_detailed'],
    'npx -y @elevenlabs/cli text-to-speech convert --voice-id x --text hi': ['ElevenLabs', 'credits', 'elevenlabs text-to-speech convert'],
    'elevenlabs speech-to-text convert --model-id scribe_v2 --file song.mp3': ['ElevenLabs', 'credits', 'elevenlabs speech-to-text convert'],
    'elevenlabs text-to-sound-effects convert --text "a door"': ['ElevenLabs', 'credits', 'elevenlabs text-to-sound-effects convert'],
    'elevenlabs say "hoot"': ['ElevenLabs', 'credits', 'elevenlabs say'],
    'fal api fal-ai/flux/dev prompt="an owl"': ['fal', 'usd', 'fal api'],
    'genmedia run fal-ai/flux/dev --prompt owl': ['fal', 'usd', 'genmedia run'],
    'tripo make "a brass lantern"': ['Tripo', 'usd', 'tripo make'],
  };
  for (const [c, [provider, unit, tool]] of Object.entries(paid)) {
    const p = paidOf(c);
    assert.deepEqual([p?.provider, p?.unit, p?.tool, p?.raw], [provider, unit, tool, true], c);
  }
  for (const free of ['elevenlabs auth login', 'elevenlabs auth status --format json', 'elevenlabs user subscription get --format json', 'elevenlabs music compose --dry-run --json -',
    'elevenlabs music compose --help', 'elevenlabs music --schema', 'elevenlabs music finetunes list', 'elevenlabs voices search --search owl', 'elevenlabs dubbing get abc', 'elevenlabs generate-skills',
    'elevenlabs --version', 'fal auth login', 'fal keys create --scope API', 'genmedia pricing fal-ai/flux/dev', 'genmedia schema fal-ai/flux/dev', 'tripo balance', 'tripo login', 'tripo --help', 'brew install elevenlabs/tap/elevenlabs']) {
    assert.equal(paidOf(free), null, free);
  }
});

test('commands: changes to the Cloudflare account outside the studio\'s deploy, by Wrangler or an MCP tool', () => {
  const held = {
    'npx wrangler d1 delete night-owls-db': ['delete', 'wrangler d1 delete', ['night-owls-db']],
    'cd night-owls && npx wrangler r2 bucket delete night-owls-media': ['delete', 'wrangler r2 bucket delete', ['night-owls-media']],
    'wrangler r2 object delete night-owls-media/videos/trailer.mp4 --remote': ['delete', 'wrangler r2 object delete', ['night-owls-media/videos/trailer.mp4']],
    'wrangler delete': ['delete', 'wrangler delete', []],
    'wrangler kv key delete --binding CACHE k --remote': ['delete', 'wrangler kv key delete', ['k']],
    'npx wrangler secret put STRIPE_KEY': ['secret', 'wrangler secret put', ['STRIPE_KEY']],
    'wrangler versions secret bulk secrets.json': ['secret', 'wrangler versions secret bulk', ['secrets.json']],
    'wrangler versions deploy': ['deploy', 'wrangler versions deploy', []],
    'wrangler rollback': ['deploy', 'wrangler rollback', []],
    'npx wrangler d1 migrations apply night-owls-db --remote': ['schema', 'wrangler d1 migrations apply', ['night-owls-db']],
    'npx wrangler d1 execute night-owls-db --remote --command "DELETE FROM rounds"': ['data', 'wrangler d1 execute', ['night-owls-db']],
    'npx wrangler d1 execute night-owls-db --remote --file wipe.sql': ['data', 'wrangler d1 execute', ['night-owls-db']],
  };
  for (const [c, [kind, what, names]] of Object.entries(held)) {
    const r = cloudflareChangeOf(c);
    assert.deepEqual([r?.kind, r?.what, r?.names], [kind, what, names], c);
  }
  assert.equal(cloudflareChangeOf('cd night-owls && npx wrangler d1 delete db').dir, 'night-owls');
  for (const free of ['npx wrangler whoami --json', 'npx wrangler deploy', 'npx wrangler d1 create night-owls-db', 'npx wrangler r2 bucket create night-owls-media', 'npx wrangler d1 migrations apply db --local',
    'npx wrangler d1 execute db --remote --command "SELECT count(*) FROM rounds"', 'npx wrangler d1 execute db --local --command "DELETE FROM rounds"', 'npx wrangler d1 delete db --help',
    'npx wrangler ai models list --json', 'npx wrangler r2 object get b/k --remote --pipe', 'npx wrangler login --device', 'npx wrangler tail', 'npx wrangler secret list']) {
    assert.equal(cloudflareChangeOf(free), null, free);
  }
  assert.ok(readOnlySql('SELECT 1; PRAGMA table_list'));
  assert.ok(!readOnlySql('SELECT 1; DROP TABLE rounds'));
  assert.ok(!readOnlySql(''));
  // Cloudflare's own MCP servers: the API server's execute, and the bindings tools (also the claude.ai connector's).
  const exec = (code) => cloudflareMcpChangeOf('mcp__plugin_cloudflare_cloudflare__execute', { code });
  assert.equal(exec('async () => cloudflare.request({ method: "DELETE", path: `/accounts/${a}/d1/database/${id}` })').kind, 'delete');
  assert.equal(exec('async () => cloudflare.request({ method: "PUT", path: `/accounts/${a}/workers/scripts/x` })').kind, 'change');
  assert.equal(exec('async () => cloudflare.request({ method: "GET", path: `/accounts/${a}/workers/scripts` })'), null);
  assert.equal(exec('async () => cloudflare.request({ method: "POST", path: "/graphql", body: { query } })'), null, 'a GraphQL read is a POST');
  assert.equal(cloudflareMcpChangeOf('mcp__plugin_cloudflare_cloudflare__search', { code: 'spec.paths' }), null);
  const del = cloudflareMcpChangeOf('mcp__claude_ai_Cloudflare_Developer_Platform__d1_database_delete', { database_id: 'night-owls-db' });
  assert.deepEqual([del.kind, del.what, del.names], ['delete', 'd1_database_delete', ['night-owls-db']]);
  assert.equal(cloudflareMcpChangeOf('mcp__cloudflare-bindings__r2_bucket_delete', { name: 'b' }).kind, 'delete');
  assert.equal(cloudflareMcpChangeOf('mcp__cloudflare-bindings__kv_namespace_update', { namespace_id: 'x', title: 'y' }).kind, 'change');
  assert.equal(cloudflareMcpChangeOf('mcp__cloudflare-bindings__d1_database_query', { database_id: 'x', sql: 'UPDATE rounds SET x = 1' }).kind, 'data');
  for (const [tool, input] of [['mcp__cloudflare-bindings__d1_database_query', { sql: 'SELECT 1' }], ['mcp__cloudflare-bindings__r2_bucket_create', { name: 'b' }],
    ['mcp__cloudflare-bindings__set_active_account', { activeAccountId: 'x' }], ['mcp__cloudflare-bindings__workers_list', {}], ['mcp__cloudflare-docs__search_cloudflare_documentation', { query: 'd1 limits' }],
    ['mcp__github__delete_file', {}]]) {
    assert.equal(cloudflareMcpChangeOf(tool, input), null, tool);
  }
});

test('commands: a Clef model downloaded by Ollama, with its size; other models and other commands are not read', () => {
  const held = {
    'ollama pull clef-flash': ['pull', 'clef-flash', null, 'about 11 GB'],
    'ollama pull clef': ['pull', 'clef', null, 'about 18 GB'],
    'ollama pull --insecure clef-flash:9b': ['pull', 'clef-flash', '9b', 'about 11 GB'],
    'ollama pull registry.ollama.ai/library/clef-flash:latest': ['pull', 'clef-flash', 'latest', 'about 11 GB'],
    'cd night-owls && ollama run --verbose clef-flash "hello"': ['run', 'clef-flash', null, 'about 11 GB'],
    'ollama run clef:27b --format json': ['run', 'clef', '27b', 'about 18 GB'],
    'OLLAMA_HOST=127.0.0.1:11500 ollama pull clef-flash': ['pull', 'clef-flash', null, 'about 11 GB'],
    'curl -s http://127.0.0.1:11434/api/pull -d \'{"model": "clef-flash"}\'': ['api', 'clef-flash', null, 'about 11 GB'],
    'curl http://localhost:11434/api/pull -d "{\\"name\\":\\"clef\\"}"': ['api', 'clef', null, 'about 18 GB'],
  };
  for (const [c, [verb, model, tag, size]] of Object.entries(held)) {
    const r = modelPullOf(c);
    assert.deepEqual([r?.verb, r?.model, r?.tag, r?.size], [verb, model, tag, size], c);
  }
  assert.equal(modelPullOf('OLLAMA_HOST=127.0.0.1:11500 ollama pull clef-flash').host, '127.0.0.1:11500');
  assert.equal(modelPullOf('cd night-owls && ollama run clef-flash').dir, 'night-owls');
  for (const free of ['ollama list', 'ollama ps', 'ollama show clef-flash', 'ollama rm clef-flash', 'ollama cp clef-flash mine', 'ollama serve', 'ollama --version',
    'ollama pull llama3.2', 'ollama run clefable', 'ollama pull clef-flash --help', 'ollama pull -h clef', 'curl -s http://127.0.0.1:11434/api/tags', 'curl -s http://127.0.0.1:11434/api/pull -d \'{"model":"llama3.2"}\'',
    'brew install ollama', 'none']) {
    assert.equal(modelPullOf(free), null, free);
  }
});

test('commands: the providers\' own MCP servers, generating tools held, listing, pricing and estimates free', () => {
  for (const t of ['mcp__fal__run_model', 'mcp__fal__submit_job', 'mcp__plugin_elevenlabs_elevenlabs__creative_generate_speech', 'mcp__elevenlabs__text_to_speech', 'mcp__tripo__generate_model']) {
    assert.ok(paidMcpOf(t, {})?.raw, t);
  }
  assert.equal(paidMcpOf('mcp__tripo__generate_model').provider, 'Tripo');
  for (const t of ['mcp__fal__search_models', 'mcp__fal__get_model_schema', 'mcp__fal__get_pricing', 'mcp__fal__recommend_model', 'mcp__fal__check_job', 'mcp__fal__get_job_result', 'mcp__fal__upload_file',
    'mcp__fal__cancel_job', 'mcp__fal__search_docs', 'mcp__plugin_elevenlabs_elevenlabs__creative_list_voices', 'mcp__plugin_elevenlabs_elevenlabs__create_agent', 'mcp__tripo__balance']) {
    assert.equal(paidMcpOf(t, {}), null, t);
  }
  assert.equal(paidMcpOf('mcp__plugin_elevenlabs_elevenlabs__creative_generate_speech', { estimate_only: true }), null, 'an estimate makes nothing');
});

test('commands: the models skill\'s prop and mood are fal calls, capped per game in art/<game>-models', () => {
  const prop = paidOf('node /p/skills/models/scripts/models.mjs prop owl-rush lantern --card "Items/Lantern" --what "a brass lantern" --mesh --yes --json');
  assert.deepEqual([prop.provider, prop.unit, prop.script, prop.verb, prop.kind, prop.slug], ['fal', 'usd', 'models', 'prop', 'art', 'owl-rush-models']);
  assert.deepEqual(prop.dryRun, ['node', '/p/skills/models/scripts/models.mjs', 'prop', 'owl-rush', 'lantern', '--card', 'Items/Lantern', '--what', 'a brass lantern', '--mesh', '--dry-run', '--json']);
  const mood = paidOf('cd studio && node skills/models/scripts/models.mjs mood owl-rush all --yes');
  assert.deepEqual([mood.verb, mood.slug, mood.dir], ['mood', 'owl-rush-models', 'studio']);
  for (const free of ['node skills/models/scripts/models.mjs prop owl-rush lantern --what x', 'node skills/models/scripts/models.mjs mood owl-rush all --yes --dry-run', 'node skills/models/scripts/models.mjs quote owl-rush --yes', 'node skills/models/scripts/models.mjs budget owl-rush --cap 5 --yes', 'node skills/models/scripts/models.mjs registry --write --yes']) {
    assert.equal(paidOf(free), null, free);
  }
  assert.equal(paidOf('node skills/art/scripts/art.mjs gen cover --yes').script, 'art', 'the art skill is still the art skill');
  const character = paidOf('node /p/skills/models/scripts/models.mjs character owl-rush ranger --mesh --yes');
  assert.deepEqual([character.verb, character.slug, character.tool], ['character', 'owl-rush-models', 'models character']);
  assert.equal(paidOf('node /p/skills/models/scripts/models.mjs character owl-rush ranger --what x --dry-run'), null);
});

test('art: the characters and their clips in latest.json, cleaned; /cast and /clips in words', () => {
  const a = artSummaryOf({
    v: 1, game: 'g', at: '2026-10-02T10:00:00.000Z', phases: [], decisions: [], cast: [],
    need: ['idle', 'jump', 'Bad Verb', 7],
    characters: [{ id: 'knight', kind: 'character', route: 'library', family: 'humanoid', skeleton: 'humanoid-7a503a', bones: 23, verbs: ['idle', 'jump\u001b[2J'], missing: ['attack'], retargeted: 0, animsKB: 83 }, { id: '../x', verbs: [] }, { id: 'ok', route: 'teleported', bones: -1 }],
    skinning: { players: 8, vertices: 40000, bones: 184, budget: { vertices: 60000, bones: 1200 } },
  }, 'g');
  assert.deepEqual(a.need, ['idle', 'jump']);
  assert.deepEqual(a.characters.map((c) => c.id), ['knight', 'ok']);
  assert.deepEqual(a.characters[0].verbs, ['idle'], 'a verb with a terminal escape is dropped');
  assert.equal(a.characters[1].route, 'unknown');
  assert.equal(a.characters[1].bones, null);
  assert.match(charactersText(a, 'Heroes'), /^Heroes \(g\): 2 characters; the game needs idle, jump/);
  assert.match(charactersText(a, 'Heroes'), /skinning a room of 8: 40,000\/60,000 vertices/);
  assert.match(clipsText(a, 'Heroes'), /missing attack \(homie-studio anim add g knight --verbs attack\)/);
  assert.match(charactersText({ ...a, characters: [] }, 'Heroes'), /no characters with a rig yet/);
});

test('commands: git add and git commit, with their folder, paths and flags', () => {
  const one = (c) => gitStagesOf(c)[0];
  assert.deepEqual(one('git add games/owl-rush/raw/owl.glb'), { verb: 'add', dir: null, paths: ['games/owl-rush/raw/owl.glb'], all: null });
  assert.deepEqual(one('cd games && git add .'), { verb: 'add', dir: 'games', paths: ['.'], all: null });
  assert.deepEqual(one('git -C games/owl-rush add -A'), { verb: 'add', dir: 'games/owl-rush', paths: [], all: 'all' });
  assert.deepEqual(one('git add -u -- "games/my owl"'), { verb: 'add', dir: null, paths: ['games/my owl'], all: 'tracked' });
  assert.deepEqual(one('git commit -m "games/owl.glb is in"'), { verb: 'commit', dir: null, paths: [], all: null });
  assert.deepEqual(one('git commit -am "all of it" games/a.glb'), { verb: 'commit', dir: null, paths: ['games/a.glb'], all: 'tracked' });
  assert.deepEqual(one('git commit -ma'), { verb: 'commit', dir: null, paths: [], all: null }, '-ma is the message "a"');
  assert.deepEqual(one('git -c user.name=x --no-pager commit --all --author "a friend" -F msg.txt'), { verb: 'commit', dir: null, paths: [], all: 'tracked' });
  assert.deepEqual(gitStagesOf('git add -A && git commit -m x').map((x) => x.verb), ['add', 'commit']);
  for (const c of ['git status', 'git push', 'git log -- games', 'echo git add x', 'npm run build']) assert.deepEqual(gitStagesOf(c), [], c);
});

test('commands: protect globs', () => {
  assert.ok(globMatch('games/*/game.json', 'games/owl-rush/game.json'));
  assert.ok(!globMatch('games/*/game.json', 'games/owl-rush/src/game.json'));
  assert.ok(globMatch('games/**/levels/*.json', 'games/owl-rush/src/levels/1.json'));
  assert.ok(globMatch('site/', 'site/theme.json'));
  assert.ok(globMatch('site', 'site/pages/index.html'));
  assert.ok(globMatch('studio.json', 'studio.json'));
  assert.ok(!globMatch('studio.json', 'studio.json.bak'));
  assert.equal(protectedBy(['a/*.md', 'games/*/game.json'], 'games/x/game.json'), 'games/*/game.json');
  assert.equal(protectedBy(null, 'x'), null);
});

/** A minimal unified-diff parser: the counts in each header must match the lines under it (as Claude Code checks). */
function hunksValid(source) {
  if (source === '') return true;
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(lines[i]);
    if (!h) return false;
    let a = 0; let b = 0; let j = i + 1;
    for (; j < lines.length && !lines[j].startsWith('@@'); j++) { const op = lines[j][0]; if (op !== '+') a++; if (op !== '-') b++; }
    if (a !== Number(h[2]) || b !== Number(h[4])) return false;
    i = j - 1;
  }
  return true;
}

test('diffs: hunks parse whole and cut short, lines are cut, edits apply', () => {
  const before = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
  const after = before.replace('line 5', 'LINE FIVE').replace('line 40', 'LINE FORTY') + '\nlast';
  for (const opts of [{}, { maxLines: 3 }, { maxLines: 4, context: 0 }, { maxLines: 9 }, { lineWidth: 6 }]) {
    const d = unifiedDiff(before, after, opts);
    assert.ok(hunksValid(d.source), `${JSON.stringify(opts)}\n${d.source}`);
    assert.equal(d.added, 3);
    assert.equal(d.removed, 2);
  }
  assert.equal(unifiedDiff('', 'a\nb\n').source, '@@ -0,0 +1,2 @@\n+a\n+b');
  assert.equal(applyEdit('Edit', 'a b a', { old_string: 'a', new_string: 'c' }), 'c b a');
  assert.equal(applyEdit('Edit', 'a b a', { old_string: 'a', new_string: 'c', replace_all: true }), 'c b c');
  assert.equal(applyEdit('MultiEdit', 'x y', { edits: [{ old_string: 'x', new_string: 'z' }, { old_string: 'y', new_string: 'w' }] }), 'z w');
  assert.equal(applyEdit('Edit', 'x', { old_string: 'nope', new_string: 'y' }), null);
});

test('results: the setup status reader agrees with the studio\'s own formatter', async () => {
  const { formatStatus } = await import(join(STUDIO, 'lib', 'doctor.mjs'));
  const text = formatStatus({
    studio: { name: 'Night Owls' },
    rows: [
      { id: 'node', state: 'ok', label: 'Node', need: 'required', detail: 'v22.22.2, with npm', unlocks: 'everything', fix: null },
      { id: 'cf', state: 'act', label: 'Cloudflare', need: 'required', detail: 'not signed in', unlocks: 'going online', fix: { run: 'npx wrangler login', say: 'approve once' } },
      { id: 'gh', state: 'missing', label: 'Claude\'s GitHub app', need: 'recommended', detail: 'not installed', unlocks: 'pull requests', fix: { open: 'https://github.com/apps/claude', say: 'install it' } },
      { id: 'el', state: 'optional', label: 'ElevenLabs', need: 'optional', detail: 'not connected', unlocks: 'songs', fix: null },
    ],
    features: [{ feature: 'Games', state: 'ready' }, { feature: 'Online', state: 'later' }],
    next: [{ run: 'npx wrangler login', say: 'sign in' }], meanwhile: [], note: 'Read only.',
  });
  const d = parseSetupStatus(text);
  assert.equal(d.title, 'Setup status for Night Owls');
  assert.deepEqual(d.rows.map((r) => [r.state, r.label, r.need]), [['ok', 'Node', 'required'], ['act', 'Cloudflare', 'required'], ['missing', 'Claude\'s GitHub app', 'recommended'], ['optional', 'ElevenLabs', 'optional']]);
  assert.match(d.rows[1].fix, /^npx wrangler login/);
  assert.deepEqual(d.ready, [{ feature: 'Games', state: 'ready' }, { feature: 'Online', state: 'later' }]);
  assert.deepEqual(d.next, ['npx wrangler login  sign in']);
});

test('results: the check, port check and deploy readers match the CLI\'s own print templates', () => {
  const bin = readFileSync(join(STUDIO, 'bin', 'homie-studio.mjs'), 'utf8');
  // The templates these readers read, as bin/homie-studio.mjs prints them.
  assert.ok(bin.includes('`PASS: two fresh browsers in room ${result.room} finished round ${result.round.n} (${result.round.humans} humans, ${result.round.bots} bots) in ${Math.round(result.totalMs / 1000)} s.`'));
  assert.ok(bin.includes('`${result.ok ? \'PASS\' : \'NOT YET\'}: ${result.game} at ${result.url} (${Math.round(result.totalMs / 1000)} s)`'));
  assert.ok(bin.includes('`Live: ${result.url}`'));
  assert.ok(bin.includes('...result.passed.map((p) => `  ok    ${p}`), ...result.failed.map((f) => `  FAIL  ${f}`), ...result.skipped.map((f) => `  skip  ${f}`)'));
  const c = parseCheck('PASS: two fresh browsers in room pub-2 finished round 1 (1 humans, 2 bots) in 33 s.\n  computer: seat 0 (host), seated in 1.9 s\n');
  assert.equal(c.ok, true);
  assert.equal(c.rows.length, 4);
  assert.equal(parseCheck('homie-studio: no Chrome found', { known: true }).ok, false);
  assert.equal(parseCheck('homie-studio: no Chrome found'), null, 'an error alone is only read for a call known to be a check');
  const p = parsePortCheck('PASS: owl at http://127.0.0.1:8787 (20 s)\n  ok    round\n  skip  tv\n\nReceipt and screenshots: x\n');
  assert.deepEqual(p.rows.map((r) => r.state), ['pass', 'skip']);
  const dep = parseDeploy('Live: https://x.example\n  also at https://x.example.net\n  owl: https://x.example/owl/play\n  song theme: https://x.example/music/theme/\n');
  assert.equal(dep.url, 'https://x.example');
  assert.deepEqual(dep.games, [{ id: 'owl', play: 'https://x.example/owl/play' }]);
  assert.deepEqual(dep.media, [{ kind: 'song', slug: 'theme', page: 'https://x.example/music/theme/' }]);
  assert.equal(readResult({ tool: 'Bash', call: null, output: { stdout: 'total 0' } }), null);
});

test('feed: the summary agrees with the studio\'s own (lib/feed-summary.mjs)', async () => {
  const { summarize: theirs } = await import(join(STUDIO, 'lib', 'feed-summary.mjs'));
  const doc = {
    kind: 'homie-studio-progress', build: 'b', what: 'game', id: 'g', title: 'G', state: 'running', stage: 'checks',
    stages: [{ id: 'plan', label: 'Plan', state: 'done' }, { id: 'build', label: 'Build', state: 'done' }, { id: 'checks', label: 'Checks', state: 'running' }, { id: 'deploy', label: 'Deploy', state: 'pending' }],
    checks: [{ id: 'a', label: 'A', stage: 'checks', state: 'pass' }, { id: 'b', label: 'B', stage: 'checks', state: 'running' }], spend: { unit: 'usd', used: 0.4, budget: 2 },
  };
  const ours = summarize(doc);
  const ref = theirs(doc);
  assert.equal(ours.percent, ref.percent);
  assert.equal(ours.spend.text, ref.spend.text);
  assert.deepEqual([ours.counts.pass, ours.counts.total], [ref.checks.pass, ref.checks.total]);
});

test('codex: title, sections filled, open questions, milestones', () => {
  const c = summarizeCodex('# Owl Rush\n\nA pitch.\n\n## Concept\n\nSwoop.\n\n## Art direction\n\n<!-- later -->\n\n## Open questions\n\n- Drop one stone?\n\n## Milestones\n\n- [x] one\n- [ ] two\n');
  assert.equal(c.title, 'Owl Rush');
  assert.equal(c.pitch, 'A pitch.');
  assert.deepEqual(c.sections.filter((s) => s.filled).map((s) => s.key), ['concept', 'questions', 'milestones']);
  assert.ok(c.missing.includes('Art direction'));
  assert.deepEqual(c.questions, ['Drop one stone?']);
  assert.deepEqual(c.milestones, [{ done: true, text: 'one' }, { done: false, text: 'two' }]);
});

/** A PNG of `w` by `h` RGB pixels (filter 1 on odd rows, to exercise the unfiltering). */
function png(w, h, at) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const f = y % 2;
    raw[y * (w * 3 + 1)] = f;
    for (let x = 0; x < w; x++) {
      const px = at(x, y);
      for (let c = 0; c < 3; c++) {
        const o = y * (w * 3 + 1) + 1 + x * 3 + c;
        raw[o] = f === 1 ? (px[c] - (x ? at(x - 1, y)[c] : 0) + 256) & 255 : px[c];
      }
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let x = 0xffffffff; for (const v of b) x = crcT[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('bridge: a PNG decodes, and a picture packs into Raster cells (▀, the pixel above and the one below)', () => {
  const img = decodePng(png(8, 4, (x, y) => (y < 2 ? [255, 0, 0] : [0, 0, 255])));
  assert.deepEqual([img.w, img.h], [8, 4]);
  assert.deepEqual([...img.rgba.subarray(0, 4)], [255, 0, 0, 255]);
  const cells = new Uint32Array(Uint8Array.from(Buffer.from(cellsOf(img, 4, 1), 'base64')).buffer);
  assert.equal(cells.length, 12);
  assert.deepEqual([cells[0], cells[1], cells[2]], [0x2580, 0xff0000, 0x0000ff]);
});

/** A studio on disk with one game whose style the toolkit decided, its palette locked by the person. */
async function artStudio() {
  const { initDecisions, lockDecision } = await import(join(STUDIO, 'lib', 'decisions.mjs'));
  const root = mkdtempSync(join(tmpdir(), 'homie-mod-art-'));
  writeFileSync(join(root, 'studio.json'), '{"name":"Fox Den"}');
  mkdirSync(join(root, 'games', 'fox-grove'), { recursive: true });
  writeFileSync(join(root, 'games', 'fox-grove', 'game.json'), '{"id":"fox-grove","name":"Fox Grove"}');
  initDecisions(root, 'fox-grove', { prompt: 'a cozy low-poly game where foxes gather berries' });
  lockDecision(root, 'fox-grove', 'style.palette', { words: 'keep that palette' });
  return root;
}

test('art: the Art tab\'s reader keeps every field the toolkit\'s own latest.json carries (lib/art-cli.mjs)', async () => {
  const { writeArtSummary } = await import(join(STUDIO, 'lib', 'art-cli.mjs'));
  const root = await artStudio();
  try {
    const theirs = writeArtSummary(root, 'fox-grove');
    assert.ok(theirs, 'the toolkit wrote a summary');
    const file = JSON.parse(readFileSync(join(root, '.studio', 'art', 'fox-grove', 'latest.json'), 'utf8'));
    const ours = artSummaryOf(file, 'fox-grove');
    assert.ok(ours, 'the mod reads it');
    assert.equal(ours.line, theirs.line);
    assert.deepEqual(ours.phases.map((p) => [p.id, p.total, p.settled]), theirs.phases.map((p) => [p.id, p.total, p.settled]));
    assert.deepEqual(ours.decisions.flatMap((p) => p.rows.map((r) => `${r.id}:${r.state}:${r.by}`)), theirs.decisions.flatMap((p) => p.rows.map((r) => `${r.id}:${r.state}:${r.by}`)), 'every decision is kept');
    const palette = ours.decisions[0].rows.find((r) => r.id === 'style.palette');
    assert.equal(palette.state, 'locked');
    assert.ok(palette.colours.length >= 3);
    assert.match(phaseStrip(ours.phases), /^Style 1\/10 → Cast → Rigs → Animations → In game$/);
    assert.match(lookText(ours, 'Fox Grove', Date.now()), /^Fox Grove \(fox-grove\): Look: /);
    assert.ok(lookText(ours, 'Fox Grove', Date.now()).includes('■ palette'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('art: a latest.json that is not one is ignored, and what it carries is cleaned', () => {
  const ok = { v: 1, game: 'g', at: '2026-10-02T10:00:00.000Z', phases: [], decisions: [], cast: [] };
  assert.ok(artSummaryOf(ok, 'g'));
  for (const bad of [null, [], 'x', { ...ok, v: 2 }, { ...ok, at: 'yesterday' }, { ...ok, at: 5 }, { ...ok, game: 'other' }]) assert.equal(artSummaryOf(bad, 'g'), null, JSON.stringify(bad));
  assert.equal(artSummaryOf(ok, '../etc'), null);
  const a = artSummaryOf({
    ...ok,
    line: 'Look: \u001b[2Jcleared',
    phases: [{ id: 'style', label: 'Style', total: 2, settled: 3 }, { id: 'rigs', label: 'Rigs', total: 2, settled: 2 }, { id: 'nope', total: 1, settled: 0 }],
    decisions: [{ phase: 'style', label: 'Style', rows: [{ id: 'style.palette', name: 'palette', label: 'P', state: 'locked', by: 'person', colours: ['#ffffff', 'red', '#12345'] }, { id: 'Style Palette', state: 'auto' }, { id: 'style.light', state: 'sideways' }] }],
    cast: [{ id: 'ok-1', route: 'teleported', usd: -3 }, { id: '../x' }],
    licence: [{ asset: 'a', level: 'refuse', problem: 'no licence record', fix: 'add one' }, { asset: 'b', level: 'panic', problem: 'x' }],
    spend: { used: 'lots', cap: -1, items: [{ what: 'w', usd: 1 }, { what: 'x' }] },
    check: { ok: 'yes' },
    lineup: { at: '2026-10-02T10:00:00.000Z', flagged: 2, images: { front: '../../secret.jpg', quarter: 'a/b.jpg', silhouettes: '/abs.jpg' } },
  }, 'g');
  assert.equal(a.line, 'Look: cleared');
  assert.deepEqual(a.phases.map((p) => p.id), ['rigs']);
  assert.deepEqual(a.decisions[0].rows.map((r) => r.id), ['style.palette']);
  assert.deepEqual(a.decisions[0].rows[0].colours, ['#ffffff']);
  assert.deepEqual(a.cast, [{ id: 'ok-1', kind: 'asset', route: 'unknown', tier: null, license: null, state: 'auto', usd: 0 }]);
  assert.deepEqual(a.licence.map((x) => x.asset), ['a']);
  assert.deepEqual(a.spend, { used: 0, cap: null, items: [{ what: 'w', usd: 1 }] });
  assert.equal(a.check, null);
  assert.deepEqual(a.lineup.images, { front: null, quarter: 'a/b.jpg', silhouettes: null });
  assert.equal(budgetWords({ ok: false, totals: { drawCalls: 120, triangles: 900, textureMB: 2.66, firstPlayMB: null }, budgets: { drawCalls: 100, triangles: 150000, textureMB: 48, firstPlayMB: 5 } }), '120/100 draw calls (OVER), 900/150,000 triangles, 2.7/48 MB picture memory, ?/5 MB shipped payload');
  assert.match(artFor([], '').why, /^No art direction yet/);
  assert.match(artFor([a], 'h').why, /^h has no art direction yet \(games with one: g\)/);
});

test('art: the lock guard, on the toolkit\'s own decisions.json', async () => {
  const root = await artStudio();
  try {
    const rel = 'games/fox-grove/codex/decisions.json';
    assert.equal(decisionsFileOf(rel), 'fox-grove');
    for (const not of ['games/fox-grove/decisions.json', 'games/fox-grove/codex/decisions.json.bak', 'x/games/a/codex/decisions.json', 'games/../codex/decisions.json']) assert.equal(decisionsFileOf(not), null, not);
    const text = readFileSync(join(root, rel), 'utf8');
    const doc = JSON.parse(text);
    const edit = (fn) => { const d = structuredClone(doc); fn(d.decisions); return JSON.stringify(d, null, 2); };
    assert.deepEqual(lockedChanges(text, edit((d) => { d['style.palette'].value.bg = '#000000'; })), ['style.palette']);
    assert.deepEqual(lockedChanges(text, edit((d) => { d['style.palette'].state = 'steered'; })), ['style.palette']);
    assert.deepEqual(lockedChanges(text, edit((d) => { delete d['style.palette']; })), ['style.palette']);
    assert.deepEqual(lockedChanges(text, edit((d) => { d['style.camera'].value = 'top-down'; d['style.palette'].label = 'Renamed'; d['style.palette'].why = 'x'; })), []);
    assert.deepEqual(lockedChanges(text, JSON.stringify(JSON.parse(text))), [], 'the same file, other spacing');
    assert.equal(lockedChanges(text, `${text},`), null, 'not JSON while something is locked');
    assert.deepEqual(lockedChanges('{"decisions":{}}', 'not json'), [], 'nothing locked: nothing to guard');
    assert.deepEqual(lockedChanges('not json', '{}'), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('art: the licence guard knows every licence kind the toolkit knows (lib/asset-manifest.mjs)', async () => {
  const { LICENSES, licenseInfo } = await import(join(STUDIO, 'lib', 'asset-manifest.mjs'));
  for (const [kind, info] of Object.entries(LICENSES)) {
    const ok = licenceIssues({ assets: [{ id: 'a', license: { kind, attribution: info.attribution ? 'A friend, example.org' : null } }] });
    assert.deepEqual(ok, { count: 1, problems: [] }, `${kind} with its credit`);
    assert.ok(!('remix' in info), `${kind}: the toolkit's licence table has no word about remixing`);
  }
  for (const kind of ['eula:unity', 'market:fab-1234']) {
    assert.equal(licenseInfo(kind).redistribute, false);
    // A game serves its files to its players only, so a licence that forbids handing the file on is no problem for
    // a deploy; a record an older toolkit wrote (`remix`, whatever it says) reads the same.
    for (const license of [{ kind }, { kind, remix: 'none' }, { kind, remix: 'include' }]) assert.equal(licenceIssues({ assets: [{ id: 'a', license }] }).problems.length, 0, JSON.stringify(license));
  }
  assert.equal(licenseInfo('eula:turbosquid').web, false);
  const refused = licenceIssues({ assets: [
    { id: 'none', license: {} }, { id: 'null-licence', license: null }, { id: 'ts', license: { kind: 'eula:turbosquid', remix: 'none' } },
    { id: 'by', license: { kind: 'cc-by-4.0', remix: 'include', attribution: '  ' } }, { id: 'odd', license: { kind: 'CC0' } },
    { id: 'mixamo', license: { kind: 'mixamo', remix: 'include' } }, { id: 'qal', license: { kind: 'qal' } },
  ] });
  assert.deepEqual(refused.problems.map((p) => p.asset), ['none', 'null-licence', 'ts', 'by', 'odd']);
  assert.equal(licenceIssues({ v: 1 }).problems.length, 1, 'a manifest with no assets list is not one the toolkit wrote');
  assert.equal(licenceIssues(null).problems.length, 1);
  assert.ok(publicGame({ id: 'g' }));
  assert.ok(publicGame({ launch: 'public' }));
  assert.ok(publicGame({ share: { source: false } }), 'the retired key changes nothing: the game is public, and its players are served its files');
  for (const not of [null, { launch: 'private' }, { launch: 'invite' }]) assert.equal(publicGame(not), false, JSON.stringify(not));
});

test('the mod\'s hooks module calls only what the README lists', () => {
  // The code, without its comments (which name calls in prose).
  const src = readFileSync(join(PLUGIN, 'hooks', 'homie.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const calls = [...new Set([...src.matchAll(/\$\.([a-z]+)\.([a-zA-Z]+)\(/g)].map((m) => `$.${m[1]}.${m[2]}`))].sort();
  assert.ok(calls.length > 10);
  const readme = readFileSync(join(PLUGIN, 'README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('## What the Homie mod does'));
  for (const c of calls) assert.ok(section.includes(c), `README's "What the Homie mod does" names ${c}`);
  assert.ok(!/\$\.env\.|\$\.settings\.|\$\.model\.|\$\.prompt\.submit|\$\.session\.send|tool\.check|\$\.fs\.write/.test(src), 'no environment, settings, model, prompt, messaging, permission or file-writing calls');
});

test('the README names every hook and every command the hooks module has', () => {
  const src = readFileSync(join(PLUGIN, 'hooks', 'homie.mjs'), 'utf8');
  const readme = readFileSync(join(PLUGIN, 'README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('## What the Homie mod does'));
  const mod = readme.slice(readme.indexOf('## The Homie mod'), readme.indexOf('## What the Homie mod does'));
  // Every command it registers: in COMMANDS, handled by its own command.run hook, in the README's commands and in the
  // validate listing ("command.run{command=<name>}").
  const commands = [...src.slice(src.indexOf('const COMMANDS = ['), src.indexOf('];', src.indexOf('const COMMANDS = ['))).matchAll(/^\s*\['([a-z-]+)', '/gm)].map((m) => m[1]);
  assert.ok(commands.length >= 15, commands.join(' '));
  for (const c of commands) {
    assert.ok(src.includes(`on('command.run', { command: '${c}' }`), `a command.run hook for /${c}`);
    assert.ok(mod.includes(`\`/${c}`), `"The Homie mod" names /${c}`);
    assert.ok(section.includes(`command.run{command=${c}}`), `"What the Homie mod does" lists command.run{command=${c}}`);
  }
  const handled = [...src.matchAll(/on\('command\.run', \{ command: '([a-z-]+)' \}/g)].map((m) => m[1]);
  assert.deepEqual([...handled].sort(), [...commands].sort(), 'every command.run hook is a registered command');
  assert.ok(section.includes(`its ${['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'][commands.length]} commands only`), 'the events list counts the commands');
  // Every event it handles.
  for (const ev of new Set([...src.matchAll(/\bon\('([a-z]+\.[a-z]+)'/g)].map((m) => m[1]))) assert.ok(section.includes(`\`${ev}\``), `"What the Homie mod does" names ${ev}`);
});
