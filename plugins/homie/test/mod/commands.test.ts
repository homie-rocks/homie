/**
 * The instant commands: each runs with no Claude turn, prints links or opens its pane, and says plainly what it
 * can where nothing draws (a `claude -p` run has no surface).
 */
import { describe, expect, test } from 'claude-code/testing'
import { LIVE, ROOT, start, world } from './world.ts'

const run = ($: any, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' } })

describe('commands', () => {
  test('session.start registers all eighteen, each to run at once (immediate)', async ($, on) => {
    const seen: any[] = []
    world(on, { register: (e) => seen.push(e) })
    await start($)
    // /style is the style skill's own (plugin skills answer to their bare names), so the Art tab's command is /look.
    expect(seen.map((c) => c.name)).toEqual(['studio', 'play', 'watch', 'rooms', 'build', 'codex', 'deploy-status', 'perf-numbers', 'parts', 'arcade', 'look', 'lock', 'assets', 'cast', 'clips', 'lineup', 'rights', 'feedback'])
    expect(seen.every((c) => c.immediate === true)).toBe(true)
  })

  test('/studio opens the Studio pane and prints nothing', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    const r = await run($, 'studio')
    expect(w.log.opened).toEqual(['homie-studio'])
    expect(r.text).toBeUndefined()
  })

  test('/studio outside a studio says so and opens nothing', async ($, on) => {
    const w = world(on, { inStudio: false })
    await start($, { cwd: '/work/elsewhere' })
    const r = await run($, 'studio')
    expect(r.text).toContain('Not inside a Homie studio')
    expect(w.log.opened).toEqual([])
  })

  test('/play prints each game\'s Play links, live and on this computer', async ($, on) => {
    world(on)
    await start($)
    const r = await run($, 'play')
    expect(r.text).toContain(`${LIVE}/owl-rush/play`)
    expect(r.text).toContain('http://localhost:8787/owl-rush/play (this computer)')
    expect(r.text).toContain('nothing is opened for you')
  })

  test('/play outside a studio lists Homie Arcade', async ($, on) => {
    world(on, { inStudio: false })
    await start($, { cwd: '/work/elsewhere' })
    const r = await run($, 'play')
    expect(r.text).toContain('https://arcade.homie.rocks/bone-burglar/play')
  })

  test('/watch prints the Watch link of each live room, and one room by its number', async ($, on) => {
    world(on)
    await start($)
    expect((await run($, 'watch')).text).toContain(`${LIVE}/owl-rush/watch?room=pub-3`)
    expect((await run($, 'watch', '3')).text).toContain('Owl Rush · Room 3')
    expect((await run($, 'watch', '9')).text).toContain('No live room "9"')
  })

  test('/rooms opens the pane on Rooms and prints who is playing', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    const r = await run($, 'rooms')
    expect(w.log.opened).toEqual(['homie-studio'])
    expect(r.text).toContain('3 playing in 1 room')
    expect(r.text).toContain('3/8, 1 AI')
  })

  test('/build prints the build step by step', async ($, on) => {
    world(on)
    await start($)
    const r = await run($, 'build')
    expect(r.text).toContain('Owl Rush: faster rounds: running (Checks')
    expect(r.text).toContain('✓ Plan → ✓ Build → ● Checks → ○ Deploy')
    expect(r.text).toContain('✓ Computer seated')
  })

  test('/codex summarises the Game Codex', async ($, on) => {
    world(on)
    await start($)
    const r = await run($, 'codex')
    expect(r.text).toContain('Owl Rush (games/owl-rush/CODEX.md)')
    expect(r.text).toContain('1 open question')
    expect(r.text).toContain('not decided yet:')
  })

  test('/deploy-status: live address, last deploy, commits since, uncommitted changes, checks', async ($, on) => {
    world(on)
    await start($)
    const r = await run($, 'deploy-status')
    expect(r.text).toContain(`live at ${LIVE}`)
    expect(r.text).toContain('2 commits since: Faster rounds · A new owl')
    expect(r.text).toContain('1 uncommitted change')
    expect(r.text).toContain('checks: Owl Rush: faster rounds: 2/3 passed')
  })

  test('/perf-numbers reads the latest run\'s medians', async ($, on) => {
    world(on, {
      files: {
        [`${ROOT}/.perf/owl-rush/20261002-1000/summary.json`]: JSON.stringify({ runs: 2, counted: 2, devices: ['phone'], renderers: ['Apple M4'], metrics: { 'phone.host.frame.p50': { median: 16.7 }, 'phone.host.frame.p95': { median: 21 }, 'phone.host.work.p50': { median: 2.1 }, 'phone.host.busy': { median: 4.2 }, 'phone.host.load.playable': { median: 1325 } } }),
      },
    })
    await start($)
    const r = await run($, 'perf-numbers')
    expect(r.text).toContain('owl-rush: 2/2 runs counted')
    expect(r.text).toContain('phone host: frames 16.7 ms median, 21 ms p95')
  })

  test('/perf-numbers with no runs says how to get one', async ($, on) => {
    world(on)
    await start($)
    expect((await run($, 'perf-numbers')).text).toContain('No performance runs yet')
  })

  test('/parts opens the parts pane', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await run($, 'parts')
    expect(w.log.opened).toEqual(['homie-parts'])
  })

  test('a running build opens the Studio pane by itself (unasked: the surface places it only where it is wide enough)', async ($, on) => {
    const w = world(on)
    await start($)
    expect(w.log.opened).toEqual(['homie-studio'])
  })

  test('with paneAutoOpen off, a running build opens nothing', { options: { paneAutoOpen: false } }, async ($, on) => {
    const w = world(on)
    await start($)
    expect(w.log.opened).toEqual([])
  })

  test('a pane that waits for a wider terminal is said in a toast', async ($, on) => {
    const w = world(on, { open: () => ({ isPlaced: false, reason: 'narrow' }) })
    await start($)
    expect(w.log.toasts.join(' ')).toContain('/studio shows it')
  })

  test('in a claude -p run (nothing draws) the pane commands print text instead', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await start($, { surface: null as any, interactive: false })
    const studio = await run($, 'studio')
    expect(studio.text).toContain('Owl Rush: faster rounds: running')
    const parts = await run($, 'parts')
    expect(parts.text).toContain('No parts')
    const arcade = await run($, 'arcade')
    expect(arcade.text).toContain('Play in a browser instead')
    expect(w.log.opened).toEqual([])
  })
})
