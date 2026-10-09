/**
 * The guards: a protected file, a production deploy, a paid media call and a Clef model download are held in Claude Code's own question
 * dialog, with what would change drawn above it, until the person says Proceed; Cancel, a dismissed question and a
 * `claude -p` run (nobody to ask) all refuse. And secrets come out of every tool result before Claude reads it.
 */
import { describe, expect, test } from 'claude-code/testing'
import { LIVE, ROOT, pane, start, textOf, world } from './world.ts'

const GAME_JSON = `${ROOT}/games/owl-rush/game.json`
const edit = (over: Record<string, unknown> = {}) => ({ tool: 'Edit', file_path: GAME_JSON, old_string: '"name":"Owl Rush"', new_string: '"name":"Owl Rush Deluxe"', ...over })

describe('protected files (studio.json "protect")', () => {
  test('an edit to a protected file is held with its diff; Proceed lets it through', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    const r = await $.tool.call(edit())
    expect(w.log.asked[0]).toContain('Change games/owl-rush/game.json, which the studio protects?')
    expect(w.log.tools).toEqual(['AskUserQuestion', 'Edit'])
    expect(r.result).toBeDefined()
  })

  test('Cancel refuses it with a reason Claude can act on, and the edit never runs', async ($, on) => {
    const w = world(on, { feed: null, ask: 'Cancel' })
    await start($)
    const r = await $.tool.call(edit())
    expect(r.deny).toContain('The person said no to this change to games/owl-rush/game.json')
    expect(w.log.tools).toEqual(['AskUserQuestion'])
  })

  test('a dismissed question (or a claude -p run) refuses it too', async ($, on) => {
    const w = world(on, { feed: null, ask: null })
    await start($)
    const r = await $.tool.call(edit())
    expect(r.deny).toContain('nobody could be asked here')
    expect(w.log.tools).toEqual(['AskUserQuestion'])
  })

  test('Write, MultiEdit and a folder glob are held as well', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/site/theme.json`, content: '{"accent":"#fff"}' })
    await $.tool.call({ tool: 'MultiEdit', file_path: GAME_JSON, edits: [{ old_string: 'Owl', new_string: 'Bat' }] })
    expect(w.log.asked.length).toBe(2)
  })

  test('an unprotected file is not held', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await $.tool.call(edit({ file_path: `${ROOT}/games/owl-rush/src/main.ts` }))
    expect(w.log.asked).toEqual([])
  })

  test('guardFiles: false holds nothing', { options: { guardFiles: false } }, async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await $.tool.call(edit())
    expect(w.log.asked).toEqual([])
  })

  test('the dialog shows the diff, the rule and who asked, above Claude Code\'s own question', async ($, on) => {
    let release: (v: unknown) => void = () => {}
    const asked: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => new Promise((resolve) => { asked.push(e.questions[0].question); release = () => resolve({ result: { answers: { [e.questions[0].question]: 'Cancel' } } }) }))
    world(on, { feed: null, tool: () => ({ result: { stdout: '' } }) })
    await start($)
    const held = $.tool.call(edit())
    for (let i = 0; i < 20 && !asked.length; i++) await new Promise((r) => setTimeout(r, 5))
    const ui = await $.ui.mount({ plugin: 'homie', component: 'AskUserQuestion', requestId: 'q1', surface: 'terminal', viewport: { columns: 120, rows: 40, isFullscreen: false }, props: { tool: 'AskUserQuestion', questions: [{ question: asked[0], header: 'Homie', options: [{ label: 'Proceed' }, { label: 'Cancel' }], multiSelect: false }] } })
    const text = textOf(await ui.drawn())
    expect(text).toContain('⚠ Protected: owl-rush/game.json')
    expect(text).toContain('games/*/game.json')
    expect(text).toContain('+1 −1 lines by Claude')
    expect(JSON.stringify(await ui.drawn())).toContain('"type":"engine"')
    expect(await ui.find({ type: 'Code' })).toBeDefined()
    release(null)
    expect((await held).deny).toContain('said no')
  })
})

describe('deploys', () => {
  const live = { result: { stdout: `Live: ${LIVE}\n  owl-rush: ${LIVE}/owl-rush/play\n\nCloudflare: Worker night-owls, D1 night-owls-db, Durable Objects Table + Lobby.\n`, stderr: '', interrupted: false } }

  test('npm run deploy is held with what will change; Proceed deploys and remembers the commit', async ($, on) => {
    const w = world(on, { tool: () => live })
    await start($)
    const r = await $.tool.call({ tool: 'Bash', command: 'npm run deploy' })
    expect(w.log.asked[0]).toContain('Deploy Night Owls to production?')
    expect(w.log.tools).toEqual(['AskUserQuestion', 'Bash'])
    expect(r.result.stdout).toContain('Live:')
    expect(w.store.get(`deployed:${ROOT}`)).toEqual({ commit: 'f00dfeed', at: expect.any(String) } as any)
  })

  test('npx homie-studio deploy, wrangler deploy and a media publish are held; deploy --plan is not', async ($, on) => {
    const w = world(on, { tool: () => live })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'npx --no-install homie-studio deploy' })
    await $.tool.call({ tool: 'Bash', command: 'npx wrangler deploy' })
    await $.tool.call({ tool: 'Bash', command: 'node skills/music/scripts/music.mjs publish night-theme' })
    await $.tool.call({ tool: 'Bash', command: 'npx --no-install homie-studio deploy --plan' })
    await $.tool.call({ tool: 'Bash', command: 'node skills/video/scripts/video.mjs publish trailer --no-deploy' })
    expect(w.log.asked.length).toBe(3)
  })

  test('Cancel stops it here', async ($, on) => {
    const w = world(on, { ask: 'Cancel' })
    await start($)
    const r = await $.tool.call({ tool: 'Bash', command: 'cd . && npm run deploy' })
    expect(r.deny).toContain('The person cancelled this deploy')
    expect(w.log.tools).toEqual(['AskUserQuestion'])
  })

  test('the Homie MCP\'s studio_deploy is held too', async ($, on) => {
    const w = world(on, { ask: 'Cancel' })
    await start($)
    const r = await $.tool.call({ tool: 'mcp__plugin_homie_homie__studio_deploy', studio: 'night-owls' })
    expect(r.deny).toContain('cancelled')
  })

  test('the summary: where, last deploy, commits, files, uncommitted, checks, who is playing', async ($, on) => {
    let release: (v: unknown) => void = () => {}
    const asked: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => new Promise((resolve) => { asked.push(e.questions[0].question); release = () => resolve({ result: { answers: { [e.questions[0].question]: 'Proceed' } } }) }))
    world(on, { tool: () => live })
    await start($)
    await $.command.run({ command: 'rooms', args: '', origin: { kind: 'composer' } })
    const held = $.tool.call({ tool: 'Bash', command: 'npm run deploy' })
    for (let i = 0; i < 40 && !asked.length; i++) await new Promise((r) => setTimeout(r, 5))
    const ui = await $.ui.mount({ plugin: 'homie', component: 'AskUserQuestion', requestId: 'q2', surface: 'desktop', viewport: { columns: 120, rows: 40 }, props: { tool: 'AskUserQuestion', questions: [{ question: asked[0], header: 'Homie', options: [{ label: 'Proceed' }, { label: 'Cancel' }], multiSelect: false }] } })
    const text = textOf(await ui.drawn())
    expect(text).toContain('night-owls.example')
    expect(text).toContain('2 since')
    expect(text).toContain('Uncommitted 1 file')
    expect(text).toContain('2/3 passed')
    expect(text).toContain('3 people now')
    // The whole story is in the Hold pane while the question waits.
    const hold = await $.ui.mount(pane('homie-hold', 'desktop'))
    const full = textOf(await hold.drawn())
    expect(full).toContain('2 since then: Faster rounds · A new owl')
    expect(full).toContain('1 file changed and not committed')
    expect(full).toContain('Owl Rush: faster rounds: 2/3 passed')
    release(null)
    await held
  })

  test('guardDeploys: false holds nothing', { options: { guardDeploys: false } }, async ($, on) => {
    const w = world(on, { tool: () => live })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'npm run deploy' })
    expect(w.log.asked).toEqual([])
  })
})

describe('paid media calls', () => {
  test('a fal call past the job\'s cap is held with its estimated cost (from the skill\'s own --dry-run)', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'node skills/art/scripts/art.mjs gen cover --model fal-ai/flux/dev --input in.json --out cover.png --yes' })
    const dry = w.log.ran.find((a) => a.includes('--dry-run'))
    expect(dry).toContain('gen')
    expect(dry).not.toContain('--yes')
    expect(w.log.asked[0]).toContain('Spend about $0.25 at fal, past the budget?')
  })

  test('a call inside every budget goes through, and says what it costs', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'node skills/art/scripts/art.mjs gen skyline --model fal-ai/flux/dev --input in.json --out sky.png --yes' })
    expect(w.log.asked).toEqual([])
    expect(w.log.toasts.join(' ')).toContain('fal: about $0.25')
  })

  test('a request straight at a provider cannot be priced first, so it is held', async ($, on) => {
    const w = world(on, { feed: null, ask: 'Cancel' })
    await start($)
    const r = await $.tool.call({ tool: 'Bash', command: 'curl -X POST https://queue.fal.run/fal-ai/flux/dev -H "Authorization: Key $FAL_KEY" -d @in.json' })
    expect(w.log.asked[0]).toContain('whose cost could not be read first')
    expect(r.deny).toContain('The person said no')
  })

  test('a fal or ElevenLabs connector\'s generating tool is held; its listing tools are not', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await $.tool.call({ tool: 'mcp__fal__generate_image', prompt: 'an owl' })
    await $.tool.call({ tool: 'mcp__elevenlabs__text_to_speech', text: 'hoot' })
    await $.tool.call({ tool: 'mcp__fal__list_models' })
    expect(w.log.asked.length).toBe(2)
  })

  test('a skill call without --yes only prices, so it is free and not held', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'node skills/music/scripts/music.mjs render night-theme' })
    expect(w.log.asked).toEqual([])
  })
})

describe('the providers\' own tools', () => {
  test('a paid call through a provider\'s own CLI cannot be priced first, so it is held; their free commands are not', async ($, on) => {
    const w = world(on, { feed: null, ask: 'Cancel' })
    await start($)
    const r = await $.tool.call({ tool: 'Bash', command: 'elevenlabs music compose --format json --json - < music/theme/body.json' })
    expect(w.log.asked[0]).toContain('Make a paid ElevenLabs call whose cost could not be read first?')
    expect(r.deny).toContain('The person said no')
    await $.tool.call({ tool: 'Bash', command: 'fal api fal-ai/flux/dev prompt="an owl"' })
    await $.tool.call({ tool: 'Bash', command: 'tripo make "a brass lantern"' })
    await $.tool.call({ tool: 'Bash', command: 'elevenlabs auth status --format json' })
    await $.tool.call({ tool: 'Bash', command: 'elevenlabs music compose --dry-run --json -' })
    await $.tool.call({ tool: 'Bash', command: 'genmedia pricing fal-ai/flux/dev' })
    expect(w.log.asked.length).toBe(3)
    expect(w.log.tools).toEqual(['AskUserQuestion', 'AskUserQuestion', 'AskUserQuestion', 'Bash', 'Bash', 'Bash'])
  })

  test('fal\'s and ElevenLabs\' own MCP servers: a run is held, finding a model, its price or an estimate is not; Tripo\'s too', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await $.tool.call({ tool: 'mcp__fal__run_model', endpoint_id: 'fal-ai/flux/dev', input: { prompt: 'an owl' } })
    await $.tool.call({ tool: 'mcp__plugin_elevenlabs_elevenlabs__creative_generate_speech', text: 'hoot' })
    await $.tool.call({ tool: 'mcp__tripo__generate_model', prompt: 'a lantern' })
    await $.tool.call({ tool: 'mcp__fal__get_pricing', endpoint_id: 'fal-ai/flux/dev' })
    await $.tool.call({ tool: 'mcp__fal__recommend_model', task: 'a cover' })
    await $.tool.call({ tool: 'mcp__plugin_elevenlabs_elevenlabs__creative_generate_speech', text: 'hoot', estimate_only: true })
    expect(w.log.asked.length).toBe(3)
  })
})

describe('a Clef model download (Ollama)', () => {
  const TAGS = 'http://127.0.0.1:11434/api/tags'

  test('ollama pull clef-flash is held with its size; Cancel refuses it with a reason, and it never runs', async ($, on) => {
    const w = world(on, { feed: null, ask: 'Cancel' })
    await start($)
    const r = await $.tool.call({ tool: 'Bash', command: 'ollama pull clef-flash' })
    expect(w.log.asked[0]).toContain('Download clef-flash (about 11 GB) to this computer with Ollama?')
    expect(r.deny).toContain('The person said no to downloading clef-flash (about 11 GB)')
    expect(w.log.tools).toEqual(['AskUserQuestion'])
  })

  test('Proceed lets the download through', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'ollama pull clef-flash' })
    expect(w.log.tools).toEqual(['AskUserQuestion', 'Bash'])
  })

  test('a dismissed question (or claude -p, nobody to ask) refuses it, and says to name the size', async ($, on) => {
    const w = world(on, { feed: null, ask: null })
    await start($)
    const r = await $.tool.call({ tool: 'Bash', command: 'ollama pull clef' })
    expect(w.log.asked[0]).toContain('Download clef (about 18 GB)')
    expect(r.deny).toContain('nobody could be asked here')
    expect(r.deny).toContain('say the size')
    expect(w.log.tools).toEqual(['AskUserQuestion'])
  })

  test('ollama run is held only when Ollama does not have the model; other models and other commands are not', async ($, on) => {
    const w = world(on, { feed: null, http: { [TAGS]: { models: [{ name: 'clef-flash:latest' }, { name: 'llama3.2:latest' }] } } })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'ollama run clef-flash "hello"' })
    expect(w.log.fetched).toContain(TAGS)
    expect(w.log.asked).toEqual([])
    await $.tool.call({ tool: 'Bash', command: 'ollama run clef:27b' })
    await $.tool.call({ tool: 'Bash', command: 'curl -s http://127.0.0.1:11434/api/pull -d \'{"model": "clef-flash"}\'' })
    expect(w.log.asked.length).toBe(2)
    for (const command of ['ollama list', 'ollama show clef-flash', 'ollama rm clef', 'ollama pull llama3.2', 'ollama pull --help', 'curl -s http://127.0.0.1:11434/api/tags']) {
      await $.tool.call({ tool: 'Bash', command })
    }
    expect(w.log.asked.length).toBe(2)
  })

  test('a pull is held even when the model is here (it fetches a newer copy), and the dialog says so', async ($, on) => {
    let release: (v: unknown) => void = () => {}
    const asked: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => new Promise((resolve) => { asked.push(e.questions[0].question); release = () => resolve({ result: { answers: { [e.questions[0].question]: 'Cancel' } } }) }))
    world(on, { feed: null, http: { [TAGS]: { models: [{ name: 'clef-flash:latest' }] } }, tool: () => ({ result: { stdout: '' } }) })
    await start($)
    const held = $.tool.call({ tool: 'Bash', command: 'ollama pull clef-flash' })
    for (let i = 0; i < 20 && !asked.length; i++) await new Promise((r) => setTimeout(r, 5))
    const ui = await $.ui.mount({ plugin: 'homie', component: 'AskUserQuestion', requestId: 'q1', surface: 'terminal', viewport: { columns: 120, rows: 40, isFullscreen: false }, props: { tool: 'AskUserQuestion', questions: [{ question: asked[0], header: 'Homie', options: [{ label: 'Proceed' }, { label: 'Cancel' }], multiSelect: false }] } })
    const text = textOf(await ui.drawn())
    expect(text).toContain('Download clef-flash, ~11 GB')
    expect(text).toContain('Size about 11 GB')
    expect(text).toContain('already on this computer')
    // The whole story is in the Hold pane while the question waits.
    const hold = await $.ui.mount(pane('homie-hold', 'terminal'))
    const full = textOf(await hold.drawn())
    expect(full).toContain('Cloudflare\'s Clef decision model, the 9B, through Ollama')
    expect(full).toContain('Homie never downloads a model by itself')
    release(null)
    expect((await held).deny).toContain('said no')
  })

  test('guardSpend: false holds no download', { options: { guardSpend: false } }, async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'ollama pull clef-flash' })
    expect(w.log.asked).toEqual([])
  })
})

describe('Cloudflare changes outside the studio\'s deploy', () => {
  test('Wrangler deleting the studio\'s own database is held; Cancel refuses it with a reason', async ($, on) => {
    const w = world(on, { feed: null, ask: 'Cancel' })
    await start($)
    const r = await $.tool.call({ tool: 'Bash', command: 'npx wrangler d1 delete night-owls-db' })
    expect(w.log.asked[0]).toContain('Delete something on Cloudflare for Night Owls, outside the studio\'s deploy?')
    expect(r.deny).toContain('The person said no to this Cloudflare change (wrangler d1 delete)')
    expect(w.log.tools).toEqual(['AskUserQuestion'])
  })

  test('the dialog names the change and the studio\'s own database, above Claude Code\'s own question', async ($, on) => {
    let release: (v: unknown) => void = () => {}
    const asked: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => new Promise((resolve) => { asked.push(e.questions[0].question); release = () => resolve({ result: { answers: { [e.questions[0].question]: 'Cancel' } } }) }))
    world(on, { feed: null, tool: () => ({ result: { stdout: '' } }) })
    await start($)
    const held = $.tool.call({ tool: 'Bash', command: 'npx wrangler d1 delete night-owls-db' })
    for (let i = 0; i < 20 && !asked.length; i++) await new Promise((r) => setTimeout(r, 5))
    const ui = await $.ui.mount({ plugin: 'homie', component: 'AskUserQuestion', requestId: 'q1', surface: 'terminal', viewport: { columns: 120, rows: 40, isFullscreen: false }, props: { tool: 'AskUserQuestion', questions: [{ question: asked[0], header: 'Homie', options: [{ label: 'Proceed' }, { label: 'Cancel' }], multiSelect: false }] } })
    const text = textOf(await ui.drawn())
    expect(text).toContain('Cloudflare: wrangler d1 delete')
    expect(text).toContain('its own D1 night-owls-db')
    release(null)
    expect((await held).deny).toContain('said no')
  })

  test('a secret put, a hand rollout, a remote migration and a writing query are held; reads, creates and --local are not', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    for (const command of ['npx wrangler secret put STRIPE_KEY', 'npx wrangler versions deploy', 'npx wrangler d1 migrations apply night-owls-db --remote', 'npx wrangler d1 execute night-owls-db --remote --command "DELETE FROM rounds"']) {
      await $.tool.call({ tool: 'Bash', command })
    }
    expect(w.log.asked.length).toBe(4)
    for (const command of ['npx wrangler whoami --json', 'npx wrangler d1 execute night-owls-db --remote --command "SELECT count(*) FROM rounds"', 'npx wrangler r2 bucket create night-owls-media', 'npx wrangler d1 migrations apply night-owls-db --local', 'npx wrangler ai models list --json']) {
      await $.tool.call({ tool: 'Bash', command })
    }
    expect(w.log.asked.length).toBe(4)
  })

  test('Cloudflare\'s own MCP servers and the claude.ai connector: a delete or a write is held, a read is not', async ($, on) => {
    const w = world(on, { feed: null, ask: 'Cancel' })
    await start($)
    const r = await $.tool.call({ tool: 'mcp__plugin_cloudflare_cloudflare__execute', code: 'async () => cloudflare.request({ method: "DELETE", path: `/accounts/${id}/workers/scripts/night-owls` })' })
    expect(r.deny).toContain('The person said no to this Cloudflare change')
    await $.tool.call({ tool: 'mcp__claude_ai_Cloudflare_Developer_Platform__d1_database_delete', database_id: 'night-owls-db' })
    await $.tool.call({ tool: 'mcp__plugin_cloudflare_cloudflare__execute', code: 'async () => cloudflare.request({ method: "GET", path: `/accounts/${id}/workers/scripts` })' })
    await $.tool.call({ tool: 'mcp__claude_ai_Cloudflare_Developer_Platform__workers_list' })
    await $.tool.call({ tool: 'mcp__cloudflare-docs__search_cloudflare_documentation', query: 'D1 free plan limits' })
    expect(w.log.asked.length).toBe(2)
  })

  test('guardDeploys: false holds none of it', { options: { guardDeploys: false } }, async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'npx wrangler d1 delete night-owls-db' })
    await $.tool.call({ tool: 'mcp__plugin_cloudflare_cloudflare__execute', code: 'cloudflare.request({ method: "DELETE", path: "/x" })' })
    expect(w.log.asked).toEqual([])
  })
})

describe('Stripe\'s MCP (the shop)', () => {
  const WRITE = 'mcp__plugin_stripe_stripe__stripe_api_write'

  test('a write whose answer would carry a webhook\'s signing secret is refused, and never runs', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    const r = await $.tool.call({ tool: WRITE, method: 'POST', path: '/v1/webhook_endpoints', params: { url: `${LIVE}/api/shop/hook`, enabled_events: ['checkout.session.completed'] } })
    expect(r.deny).toContain('homie-studio shop connect')
    expect(w.log.tools).toEqual([])
    const d = await $.tool.call({ tool: 'mcp__stripe__stripe_api_write', path: '/v2/core/event_destinations', body: { include: ['webhook_endpoint.signing_secret'] } })
    expect(d.deny).toContain('signing secret')
  })

  test('the catalog\'s writes, turning an endpoint off and every read go through, unasked', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await $.tool.call({ tool: WRITE, method: 'POST', path: '/v1/products', params: { id: 'homie_night_owls_supporter', name: 'Supporter' } })
    await $.tool.call({ tool: WRITE, method: 'POST', path: '/v1/webhook_endpoints/we_1AbCdEfGh', params: { disabled: true } })
    await $.tool.call({ tool: 'mcp__plugin_stripe_stripe__stripe_api_read', method: 'GET', path: '/v1/webhook_endpoints' })
    expect(w.log.tools).toEqual([WRITE, WRITE, 'mcp__plugin_stripe_stripe__stripe_api_read'])
    expect(w.log.asked).toEqual([])
  })
})

describe('secrets in tool output', () => {
  const KEY = `hsk_${'0123456789abcdef'.repeat(3)}`
  const PASS = `hap_0123456789_${'A'.repeat(40)}`
  // Made-up, and built here so no key-shaped string sits in this file.
  const FAL = ['0'.repeat(8), '1'.repeat(4), '2'.repeat(4), '3'.repeat(4), '4'.repeat(12)].join('-') + ':' + 'f'.repeat(32)

  test('office keys, agent passes and provider keys are hidden; Claude reads why', async ($, on) => {
    world(on, { feed: null, tool: () => ({ result: { stdout: `Office key (until 12:00): ${KEY}\npass ${PASS}\nFAL_KEY=${FAL}\nCLOUDFLARE_API_TOKEN=${'abcDEF12'.repeat(4)}\n`, stderr: '' } }) })
    await start($)
    const r = await $.tool.call({ tool: 'Bash', command: 'npx --no-install homie-studio office key' })
    const all = JSON.stringify(r)
    expect(all).not.toContain(KEY)
    expect(all).not.toContain('A'.repeat(40))
    expect(all).not.toContain(FAL)
    expect(all).not.toContain('abcDEF12abcDEF12')
    expect(r.result.stdout).toContain('hap_0123456789_[agent pass hidden by Homie]')
    expect(r.result.stdout).toContain('CLOUDFLARE_API_TOKEN=[secret hidden by Homie]')
    expect(r.context.join(' ')).toContain('took secrets')
  })

  test('a one-time owner link goes to the person, in the Studio pane, never to Claude', async ($, on) => {
    const link = `${LIVE}/_studio/signin?k=${KEY}&to=%2F_studio%2Foffice`
    world(on, { feed: null, tool: () => ({ result: { stdout: `One-time link (until 12:30): ${link}\nGive this link to the studio's owner.`, stderr: '' } }) })
    await start($)
    const r = await $.tool.call({ tool: 'Bash', command: 'npx --no-install homie-studio office link' })
    expect(r.result.stdout).not.toContain('signin')
    expect(r.result.stdout).toContain('[one-time owner link')
    await $.command.run({ command: 'studio', args: 'rooms', origin: { kind: 'composer' } })
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    expect(textOf(await ui.drawn())).toContain(`one-time owner link ↗<${link}>`)
  })

  test('source code that names a key is left alone', async ($, on) => {
    const code = 'const FAL_KEY = process.env.FAL_KEY\nconst headers = { Authorization: `Key ${FAL_KEY}` }'
    world(on, { feed: null, tool: () => ({ result: { type: 'text', file: { filePath: `${ROOT}/x.mjs`, content: code, numLines: 2, startLine: 1, totalLines: 2 } } }) })
    await start($)
    const r = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/x.mjs` })
    expect(r.result.file.content).toBe(code)
  })

  test('a failed command\'s output is redacted too', async ($, on) => {
    world(on, { feed: null, tool: () => ({ result: { stdout: '', stderr: `failed with ghp_${'x'.repeat(36)}` }, isError: true }) })
    await start($)
    const r = await $.tool.call({ tool: 'Bash', command: 'gh auth status' })
    expect(JSON.stringify(r)).not.toContain('x'.repeat(36))
    expect(JSON.stringify(r)).toContain('[GitHub token hidden by Homie]')
  })

  test('redactSecrets: false leaves output as it is', { options: { redactSecrets: false } }, async ($, on) => {
    world(on, { feed: null, tool: () => ({ result: { stdout: `key ${KEY}`, stderr: '' } }) })
    await start($)
    const r = await $.tool.call({ tool: 'Bash', command: 'npx --no-install homie-studio office key' })
    expect(r.result.stdout).toContain(KEY)
  })
})
