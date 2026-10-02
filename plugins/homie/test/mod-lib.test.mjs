/**
 * The Homie mod's plain parts, in Node (the hooks module's own tests are `claude plugin test`, test/mod/*.test.ts):
 * - the secret patterns, on real shapes of each key and on code that only names one;
 * - the shell readers: which commands are a deploy, a paid call, a homie-studio command; protect globs;
 * - the diffs drawn above the question dialog parse as unified hunks even when cut short;
 * - the result readers agree with the studio's own formatters (the setup status from lib/doctor.mjs) and with the
 *   CLI's own print templates, so a change there fails here;
 * - the game bridge's PNG decoder and cell packer, against a PNG Node writes.
 *
 * Run: node --test plugins/homie/test/mod-lib.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { deployOf, globMatch, paidMcpOf, paidOf, protectedBy, studioCalls } from '../hooks/lib/commands.mjs';
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
