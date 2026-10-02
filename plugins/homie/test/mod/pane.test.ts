/**
 * The Studio pane on both surfaces (the terminal and the desktop app's Code tab), every tab, and the band above the
 * prompt. The back office's buttons only ever run the studio's own CLI, which ASKS: the person gets the owner's
 * one-tap link and nothing is confirmed here.
 */
import { describe, expect, test } from 'claude-code/testing'
import { DEV, LIVE, ROOT, bandSite, pane, start, textOf, world } from './world.ts'

const SURFACES = ['terminal', 'desktop'] as const
const run = ($: any, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' } })

describe('the band above the prompt', () => {
  for (const surface of SURFACES) {
    test(`${surface}: studio · game · build step and % · ▶ Play · N playing now`, async ($, on) => {
      world(on, { surfaces: [surface] })
      await start($, { surface })
      await run($, 'rooms')
      const ui = await $.ui.mount(bandSite(surface))
      const text = textOf(await ui.drawn())
      expect(text).toContain('◆ Night Owls')
      expect(text).toContain('Owl Rush')
      expect(text).toContain('Checks')
      expect(text).toMatch(/\d+%/)
      expect(text).toContain('▶ Play<http://localhost:8787/owl-rush/play>')
      expect(text).toContain('3 playing now')
      await ui.unmount()
    })
  }

  test('shows nothing outside a studio', async ($, on) => {
    world(on, { inStudio: false })
    await start($, { cwd: '/work/elsewhere' })
    const ui = await $.ui.mount(bandSite('terminal'))
    expect(textOf(await ui.drawn())).toBe('drawn by Claude Code')
  })

  test('drops parts from the end to fit a narrow terminal', async ($, on) => {
    world(on)
    await start($)
    await run($, 'rooms')
    const ui = await $.ui.mount(bandSite('terminal', 40))
    const text = textOf(await ui.drawn())
    expect(text).toContain('◆ Night Owls')
    expect(text).not.toContain('playing now')
  })

  test('is off with band: false', { options: { band: false } }, async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount(bandSite('terminal'))
    expect(textOf(await ui.drawn())).toBe('drawn by Claude Code')
  })
})

describe('the Studio pane', () => {
  for (const surface of SURFACES) {
    test(`${surface}: Build shows the stages, the checks, the latest frame and Play`, async ($, on) => {
      world(on, { surfaces: [surface] })
      await start($, { surface })
      const ui = await $.ui.mount(pane('homie-studio', surface))
      const text = textOf(await ui.drawn())
      expect(text).toContain('Owl Rush: faster rounds')
      expect(text).toContain('✓ Plan')
      expect(text).toContain('● Checks')
      expect(text).toContain('Computer seated')
      expect(text).toContain('▶ Play<http://localhost:8787/owl-rush/play>')
      if (surface === 'terminal') expect(await ui.find({ type: 'Raster', key: 'preview' })).toBeDefined()
      else expect(await ui.find({ type: 'Svg' })).toBeDefined()
      await ui.unmount()
    })

    test(`${surface}: Rooms lists live rooms with Watch and Join; the owner view runs the office`, async ($, on) => {
      const w = world(on, { surfaces: [surface] })
      await start($, { surface })
      await run($, 'rooms')
      const ui = await $.ui.mount(pane('homie-studio', surface))
      let text = textOf(await ui.drawn())
      expect(text).toContain('3 playing in 1 room')
      expect(text).toContain(`◉ Watch<${LIVE}/owl-rush/watch?room=pub-3>`)
      expect(text).toContain(`▶ Join<${LIVE}/owl-rush/play?room=pub-3>`)
      expect(text).toContain('1 AI')
      await ui.press({ key: 'rooms-owner' })
      expect(w.log.ran.some((a) => a.join(' ').endsWith('homie-studio.mjs office --json'))).toBe(true)
      text = textOf(await ui.drawn())
      expect(text).toContain('Mika')
      expect(text).toContain('Owlbert')
      await ui.unmount()
    })
  }

  test('Kick asks the office, and the person gets the one-tap link: nothing is confirmed by the mod', async ($, on) => {
    const w = world(on)
    await start($)
    await run($, 'rooms')
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    await ui.press({ key: 'rooms-owner' })
    await ui.press({ key: 'kick-owl-rush-pub-3-1' })
    const kick = w.log.ran.find((a) => a.includes('kick'))
    expect(kick.slice(-6)).toEqual(['office', 'kick', 'owl-rush', 'pub-3', '2', '--json'])
    expect(w.log.ran.some((a) => /confirm/.test(a.join(' ')))).toBe(false)
    const text = textOf(await ui.drawn())
    expect(text).toContain('Waiting for your tap')
    expect(text).toContain('Kick Owlbert from Owl Rush Room 3')
    expect(text).toContain('Open ↗<https://night-owls.example/_studio/signin?k=hsk_')
    expect(w.log.toasts.join(' ')).toContain('Waiting for your tap')
  })

  test('Mute asks the office the same way', async ($, on) => {
    const w = world(on)
    await start($)
    await run($, 'rooms')
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    await ui.press({ key: 'rooms-owner' })
    await ui.press({ key: 'mute-owl-rush-pub-3-0' })
    expect(w.log.ran.find((a) => a.includes('mute')).slice(-6)).toEqual(['office', 'mute', 'owl-rush', 'pub-3', '1', '--json'])
    expect(textOf(await ui.drawn())).toContain('Mute Mika in Owl Rush Room 3')
  })

  test('Announce sends one line to a room at once', async ($, on) => {
    const w = world(on)
    await start($)
    await run($, 'rooms')
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    await ui.press({ key: 'rooms-owner' })
    await ui.input({ key: 'announce-live-owl-rush-pub-3', text: 'Last round before the update!' })
    expect(w.log.ran.find((a) => a.includes('announce'))).toContain('Last round before the update!')
    expect(w.log.toasts.join(' ')).toContain('to 3 people')
  })

  test('Games: the launch state and the remix switch are asked for', async ($, on) => {
    const w = world(on)
    await start($)
    await run($, 'studio', 'games')
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    expect(textOf(await ui.drawn())).toContain('remixable')
    await ui.select({ key: 'launch-owl-rush', value: 'invite' })
    expect(w.log.ran.find((a) => a.includes('launch')).slice(-5)).toEqual(['office', 'launch', 'owl-rush', 'invite', '--json'])
    await ui.press({ key: 'remix-owl-rush' })
    expect(w.log.ran.filter((a) => a.includes('launch')).pop()).toContain('--remixable')
  })

  for (const surface of SURFACES) {
    test(`${surface}: Stats reads the numbers on request, with a sparkline`, async ($, on) => {
      const w = world(on, { surfaces: [surface] })
      await start($, { surface })
      await run($, 'studio', 'stats')
      const ui = await $.ui.mount(pane('homie-studio', surface))
      await ui.press({ key: 'stats-refresh' })
      expect(w.log.ran.some((a) => a.join(' ').includes('stats --range 7d --json'))).toBe(true)
      const text = textOf(await ui.drawn())
      expect(text).toContain('120')
      expect(text).toContain('plays')
      expect(text).toMatch(/[▁▂▃▄▅▆▇█]{2}/)
    })

    test(`${surface}: Codex summarises the codex and gets a private link on request`, async ($, on) => {
      const w = world(on, { surfaces: [surface] })
      await start($, { surface })
      await run($, 'codex')
      const ui = await $.ui.mount(pane('homie-studio', surface))
      let text = textOf(await ui.drawn())
      expect(text).toContain('Owl Rush')
      expect(text).toContain('✓ Concept')
      expect(text).toContain('○ Art direction')
      expect(text).toContain('Should a knocked owl drop every stone?')
      expect(text).toContain('■□')
      await ui.press({ key: 'codex-link-owl-rush' })
      expect(w.log.ran.some((a) => a.join(' ').includes('codex link owl-rush --json'))).toBe(true)
      text = textOf(await ui.drawn())
      expect(text).toContain('Open the codex ↗<https://night-owls.example/_studio/signin')
    })
  }

  test('tabs switch with their buttons', async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    await ui.press({ key: 'tab-codex' })
    expect(textOf(await ui.drawn())).toContain('games/owl-rush/CODEX.md')
    await ui.press({ key: 'tab-parts' })
    expect(textOf(await ui.drawn())).toContain('No parts yet')
  })

  const LAB_CHECK = {
    v: 1, at: '2026-10-02T09:58:00.000Z', game: 'owl-rush', take: 'swoop', frames: 90, fps: 60, device: 'desk',
    out: '.studio/lab/owl-rush/check-20261002-0958', report: '.studio/lab/owl-rush/check-20261002-0958/REPORT.md',
    sheet: 'x/sheet.png', still: 'x/still.jpg', page: 'x/page.jpg', today: 'abc1234', deterministic: { new: null, today: 41 },
    timeline: { new: [{ name: 'dive', from: 1, to: 12 }, { name: 'grab', from: 13, to: 18 }], today: [{ name: 'dive', from: 1, to: 20 }, { name: 'grab', from: 21, to: 26 }] },
    cost: { new: { mean: 0.42, median: 0.4, p95: 0.6, max: 1 }, today: { mean: 0.4, median: 0.4, p95: 0.5, max: 0.9 } },
  }

  test('Lab: the Game Lab\'s last check per game, and the running lab\'s link', async ($, on) => {
    const w = world(on, {
      files: { [`${ROOT}/.studio/lab/server.json`]: JSON.stringify({ pid: 1, port: 8790, at: '2026-10-02T09:50:00.000Z' }), [`${ROOT}/.studio/lab/owl-rush/latest.json`]: JSON.stringify(LAB_CHECK) },
      http: { 'http://127.0.0.1:8790/_lab/health': { ok: true, studio: 'Night Owls', games: ['owl-rush'] } },
    })
    await start($)
    await $.command.run({ command: 'studio', args: 'lab', origin: { kind: 'composer' } })
    await new Promise((r) => setTimeout(r, 10))
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    const text = textOf(await ui.drawn())
    expect(w.log.fetched).toContain('http://127.0.0.1:8790/_lab/health')
    expect(text).toContain('The Game Lab is running')
    expect(text).toContain('Open the lab ↗<http://localhost:8790/>')
    expect(text).toContain('Owl Rush')
    expect(text).toContain('take "swoop"')
    expect(text).toContain('90 frames at 60 fps · desk · Today is abc1234')
    expect(text).toContain('dive 12f → grab 6f')
    expect(text).toContain('dive 20f → grab 6f')
    expect(text).toContain('✓ New replays the same frames')
    expect(text).toContain('✗ Today drifts from frame 41')
    expect(text).toContain('JavaScript per frame: New 0.42 ms · Today 0.4 ms')
    expect(text).toContain('Open Owl Rush in the lab ↗<http://localhost:8790/owl-rush/>')
  })

  test('Lab: a lab that does not answer is not running, and no check says how to start one', async ($, on) => {
    world(on, { files: { [`${ROOT}/.studio/lab/server.json`]: JSON.stringify({ pid: 1, port: 8790 }) } })
    await start($)
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    await ui.press({ key: 'tab-lab' })
    await new Promise((r) => setTimeout(r, 10))
    const text = textOf(await ui.drawn())
    expect(text).toContain('The Game Lab is not running')
    expect(text).toContain('No lab check yet')
    expect(text).not.toContain('localhost:8790')
  })

  test('Stop the build asks the studio\'s own progress stop', async ($, on) => {
    const w = world(on)
    await start($)
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    await ui.press({ key: 'stop-build' })
    expect(w.log.ran.some((a) => a.join(' ').includes('progress stop --json'))).toBe(true)
  })

  test('with no build running, Build says how to start one', async ($, on) => {
    world(on, { feed: null })
    await start($)
    const ui = await $.ui.mount(pane('homie-studio', 'desktop'))
    expect(textOf(await ui.drawn())).toContain('No build is running')
  })

  test('it reaches only the studio\'s own sites and homie.rocks', async ($, on) => {
    const w = world(on)
    await start($)
    await run($, 'rooms')
    await run($, 'arcade')
    for (const url of w.log.fetched) expect(url).toMatch(/^(https:\/\/night-owls\.example\/|http:\/\/127\.0\.0\.1:8787\/|https:\/\/arcade\.homie\.rocks\/)/)
    expect(w.log.fetched).toContain(`${DEV}/api/games`)
    expect(w.log.fetched.length).toBeGreaterThan(2)
  })
})

describe('the parts pane', () => {
  for (const surface of SURFACES) {
    test(`${surface}: each agent with its tools, files and last step; it opens by itself for two`, async ($, on) => {
      const agents = [
        { id: 'a1', description: 'Game logic and netcode', type: 'general-purpose', status: 'running' },
        { id: 'a2', description: 'Art', type: 'general-purpose', status: 'running' },
      ]
      const w = world(on, { surfaces: [surface], agents, feed: null })
      await start($, { surface })
      await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/games/owl-rush/src/net.ts`, old_string: 'a', new_string: 'b', agentId: 'a1' })
      await $.tool.call({ tool: 'Read', file_path: `${ROOT}/games/owl-rush/CODEX.md`, agentId: 'a2' })
      await w.clock.advance(2000)
      await new Promise((r) => setTimeout(r, 30))
      expect(w.log.opened).toContain('homie-parts')
      const ui = await $.ui.mount(pane('homie-parts', surface))
      const text = textOf(await ui.drawn())
      expect(text).toContain('2 running')
      expect(text).toContain('Game logic and netcode')
      expect(text).toContain('Edit games/owl-rush/src/net.ts')
      expect(text).toContain('1 file')
    })
  }
})
