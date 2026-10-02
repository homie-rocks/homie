/**
 * Homie's tool results drawn natively, on both surfaces: the setup status as a checklist, a check's rows, a
 * playtest's verdicts, a deploy's live links, the Homie MCP's cards, and Homie commands named in words. Anything
 * else (and anything the mod cannot read) stays Claude Code's own drawing.
 */
import { describe, expect, test } from 'claude-code/testing'
import { DEV, LIVE, feedDoc, start, textOf, world } from './world.ts'

// What `homie-studio setup status` prints (lib/doctor.mjs formatStatus; test/mod-lib.test.mjs checks the reader
// against the formatter itself).
const SETUP = `Setup status for Night Owls

  ✓ Node        v22.22.2, with npm
                unlocks everything
  → Cloudflare  not signed in
                unlocks putting the studio online
                fix: npx wrangler login  opens Cloudflare in your browser; approve once
  ✓ Chrome      (recommended) Google Chrome 141
                unlocks checks and playtests
  ○ ElevenLabs  (optional) not connected
                unlocks songs and scores

Ready: Games ✓ · Online … · Songs ○

Do this now:
  → npx wrangler login  sign in to Cloudflare
`
const CHECK = `PASS: two fresh browsers in room pub-7 finished round 2 (2 humans, 1 bots) in 41 s.
  computer: seat 0 (host), seated in 2.1 s
  phone: seat 1 (replica), seated in 2.4 s
  computer drew 60 fps on Apple M4
`
const PORT = `NOT YET: owl-rush at ${DEV} (88 s)
  ok    owner-desk
  FAIL  owner-phone
  skip  tv

Receipt and screenshots: games/owl-rush/.port/check-1
`
const PLAYTEST = `game: owl-rush
out: /work/night-owls/.playtest/owl-rush/1
report: /work/night-owls/.playtest/owl-rush/1/REPORT.md
seconds: 212
rows:
  PASS    first computer
  FAIL    sound: 12 clipped samples: it distorts
  WARN    look phone: the HUD covers 31% of the screen
weak:
  FAIL sound: 12 clipped samples: it distorts
next: node playtest.mjs review .playtest/owl-rush/1
`
const DEPLOY = `Live: ${LIVE}
  owl-rush: ${LIVE}/owl-rush/play

Cloudflare: Worker night-owls, D1 night-owls-db, Durable Objects Table + Lobby. All on the free Workers plan.
The site claimed itself in the directory: list the games with the Homie MCP tool studio_publish, or: npx --no-install homie-studio publish
`

const result = (surface: 'terminal' | 'desktop', tool: string, output: unknown, id = 't1') => ({
  plugin: 'homie', component: 'ToolResult', requestId: id, surface, viewport: { columns: 120, rows: 40, isFullscreen: false },
  props: { tool_use_id: id, tool, output, isErrored: false },
}) as const

const bash = (stdout: string) => ({ stdout, stderr: '', interrupted: false, isImage: false })

// A Homie command's row, once it answered: its words, the command, and the result drawn under it.
const use = (surface: 'terminal' | 'desktop', command: string, output: unknown, id: string) => ({
  plugin: 'homie', component: 'ToolUse', requestId: id, surface, viewport: { columns: 120, rows: 40, isFullscreen: false },
  props: { tool_use_id: id, tool: 'Bash', input: { command }, isRunning: false, isErrored: false, isInterrupted: false, output },
}) as const

describe('tool results', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: the setup status is a checklist with what to do now`, async ($, on) => {
      world(on, { surfaces: [surface], tool: () => ({ result: bash(SETUP) }) })
      await start($, { surface })
      await $.tool.call({ tool: 'Bash', command: 'npx --no-install homie-studio setup status', tool_use_id: 'u1' })
      const ui = await $.ui.mount(use(surface, 'npx --no-install homie-studio setup status', bash(SETUP), 'u1'))
      const text = textOf(await ui.drawn())
      expect(text).toContain('◆ Setup status for Night Owls')
      expect(text).toContain(' ✓ Node')
      expect(text).toContain(' → Cloudflare')
      expect(text).toContain('→ npx wrangler login')
      expect(text).toContain('✓ Games')
    })

    test(`${surface}: a check is ✓ rows`, async ($, on) => {
      world(on, { surfaces: [surface], tool: () => ({ result: bash(CHECK) }) })
      await start($, { surface })
      await $.tool.call({ tool: 'Bash', command: 'npx --no-install homie-studio check owl-rush --url http://127.0.0.1:8787', tool_use_id: 'u2' })
      const ui = await $.ui.mount(use(surface, 'npx --no-install homie-studio check owl-rush --url http://127.0.0.1:8787', bash(CHECK), 'u2'))
      const text = textOf(await ui.drawn())
      expect(text).toContain('✓ Two browsers finished a round in 41 s')
      expect(text).toContain('Same room (pub-7)')
      expect(text).toContain('60 fps on Apple M4')
    })

    test(`${surface}: a port check is ✓ and ✗ rows`, async ($, on) => {
      world(on, { surfaces: [surface] })
      await start($, { surface })
      await $.tool.call({ tool: 'Bash', command: `npx --no-install homie-studio port check owl-rush --url ${DEV}`, tool_use_id: 'u3' })
      const ui = await $.ui.mount(use(surface, `npx --no-install homie-studio port check owl-rush --url ${DEV}`, bash(PORT), 'u3'))
      const text = textOf(await ui.drawn())
      expect(text).toContain('✗ Not yet: owl-rush (88 s)')
      expect(text).toContain(' ✓ owner-desk')
      expect(text).toContain(' ✗ owner-phone')
    })

    test(`${surface}: a playtest's verdicts, with the weakest first`, async ($, on) => {
      world(on, { surfaces: [surface] })
      await start($, { surface })
      await $.tool.call({ tool: 'Bash', command: 'node skills/playtest/scripts/playtest.mjs run owl-rush --url http://127.0.0.1:8787', tool_use_id: 'u4' })
      const ui = await $.ui.mount(use(surface, 'node skills/playtest/scripts/playtest.mjs run owl-rush --url http://127.0.0.1:8787', bash(PLAYTEST), 'u4'))
      const text = textOf(await ui.drawn())
      expect(text).toContain('✗ 1 pass · 1 fail · 1 warn')
      expect(text).toContain('weakest: FAIL sound')
      expect(text).toContain('REPORT.md')
    })

    test(`${surface}: a deploy is the live link and each game's Play`, async ($, on) => {
      world(on, { surfaces: [surface] })
      await start($, { surface })
      const ui = await $.ui.mount(result(surface, 'Bash', bash(DEPLOY)))
      const text = textOf(await ui.drawn())
      expect(text).toContain(`✓ Live at ${LIVE}<${LIVE}/>`)
      expect(text).toContain(`<${LIVE}/owl-rush/play>`)
      expect(text).toContain('claimed in the homie.rocks directory')
    })

    test(`${surface}: the Homie MCP's build card (structuredContent) is a build summary`, async ($, on) => {
      world(on, { surfaces: [surface] })
      await start($, { surface })
      const out = { content: [{ type: 'text', text: 'Owl Rush: running: Checks.' }], isError: false, structuredContent: { kind: 'build', build: 'b', feed: feedDoc() } }
      const ui = await $.ui.mount(result(surface, 'mcp__plugin_homie_homie__build_progress', out))
      const text = textOf(await ui.drawn())
      expect(text).toContain('Owl Rush: faster rounds')
      expect(text).toContain('● Checks')
    })
  }

  test('the Homie MCP\'s setup card is the checklist and the status rows', async ($, on) => {
    world(on)
    await start($)
    const out = { content: [{ type: 'text', text: 'Studio: Night Owls' }], isError: false, structuredContent: { kind: 'setup', current: { name: 'Night Owls' }, checklist: [{ n: 0, label: 'Setup status', state: 'done' }, { n: 1, label: 'The studio', state: 'now' }], status: { rows: [{ state: 'missing', label: 'Cloudflare', need: 'required', detail: 'not signed in', fix: { run: 'npx wrangler login' } }], features: [{ feature: 'Games', state: 'ready' }], next: [] } } }
    const ui = await $.ui.mount(result('terminal', 'mcp__plugin_homie_homie__setup_status', out))
    const text = textOf(await ui.drawn())
    expect(text).toContain('Setting up Night Owls')
    expect(text).toContain(' → The studio')
    expect(text).toContain(' ✗ Cloudflare')
  })

  test('a Homie command\'s own result block draws nothing more: its row already drew the card', async ($, on) => {
    world(on, { tool: () => ({ result: bash(CHECK) }) })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'npx --no-install homie-studio check owl-rush', tool_use_id: 'u5' })
    const ui = await $.ui.mount(result('terminal', 'Bash', bash(CHECK), 'u5'))
    expect(textOf(await ui.drawn())).toBe('')
  })

  test('a folded group of calls holding a Homie command is unfolded, so its result shows', async ($, on) => {
    let seen: any = null
    on('ui.render', { component: 'ToolGroup' }, ($: any, e: any) => { seen = e.props; return { type: 'Text', props: {}, children: ['drawn by Claude Code'] } })
    world(on)
    await start($)
    const group = (command: string, id: string) => ({ plugin: 'homie', component: 'ToolGroup', requestId: id, surface: 'terminal', viewport: { columns: 120, rows: 40 }, props: { calls: [{ tool: 'Bash', input: { command }, isRunning: false, isErrored: false, isInterrupted: false }], isActive: false, isExpanded: false } }) as any
    await $.ui.mount(group('npx --no-install homie-studio check owl-rush', 'g1'))
    expect(seen.isExpanded).toBe(true)
    await $.ui.mount(group('ls -la', 'g2'))
    expect(seen.isExpanded).toBe(false)
  })

  test('any other command\'s result is Claude Code\'s own', async ($, on) => {
    world(on)
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'ls -la', tool_use_id: 'u9' })
    const ui = await $.ui.mount(result('terminal', 'Bash', bash('total 0'), 'u9'))
    expect(textOf(await ui.drawn())).toBe('drawn by Claude Code')
  })

  test('an errored result is Claude Code\'s own', async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount({ ...result('terminal', 'Bash', bash(DEPLOY)), props: { tool_use_id: 't1', tool: 'Bash', output: bash(DEPLOY), isErrored: true } } as any)
    expect(textOf(await ui.drawn())).toBe('drawn by Claude Code')
  })

  test('renderResults: false leaves every result to Claude Code', { options: { renderResults: false } }, async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount(result('terminal', 'Bash', bash(DEPLOY)))
    expect(textOf(await ui.drawn())).toBe('drawn by Claude Code')
  })

  test('a Homie command\'s row says what it is in words, with the command itself beside it', async ($, on) => {
    world(on)
    await start($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'homie', component: 'ToolUse', requestId: 'x1', surface, viewport: { columns: 120, rows: 40 }, props: { tool_use_id: 'x1', tool: 'Bash', input: { command: 'npx --no-install homie-studio check owl-rush --url http://127.0.0.1:8787' }, isRunning: false, isErrored: false, isInterrupted: false } } as any)
      const text = textOf(await ui.drawn())
      expect(text).toContain('Homie · Two-browser check')
      expect(text).toContain('homie-studio check owl-rush')
    }
  })
})
