/**
 * The arcade: a real seat in a public room of a live Homie game, through the plugin's game bridge (mod/bridge.mjs,
 * a headless Chrome on the person's computer). Here the bridge is a stub that speaks its JSON lines; the pane draws
 * its frames as a Raster in the terminal and an Svg on the desktop, the pad's keys reach the bridge over its private
 * socket, and leaving (or closing the pane) ends it.
 */
import { describe, expect, test } from 'claude-code/testing'
import { DEV, ROOT, pane, start, textOf, world } from './world.ts'

const run = ($: any, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' } })
const cells = (cols: number, rows: number) => { const n = new Uint32Array(cols * rows * 3); for (let i = 0; i < cols * rows; i++) { n[i * 3] = 0x2580; n[i * 3 + 1] = 0x33aa33; n[i * 3 + 2] = 0x112211 } let s = ''; for (const b of new Uint8Array(n.buffer)) s += String.fromCharCode(b); return btoa(s) }

/** A bridge that is ready, seated (room 23, seat 1, host, 3 bots) and sends one frame; it runs until `stop()`. */
function bridge(log: any[], { format = 'cells' } = {}) {
  let stop: () => void = () => {}
  const ended = new Promise<void>((r) => { stop = r })
  const gen = async function* ($: any, e: any) {
    log.push(e.argv)
    const cols = Number(e.argv[e.argv.indexOf('--cols') + 1]); const rows = Number(e.argv[e.argv.indexOf('--rows') + 1])
    yield { stream: 'stdout', text: `${JSON.stringify({ t: 'ready', sock: '/tmp/homie-mod-x/b.sock' })}\n` }
    yield { stream: 'stdout', text: `${JSON.stringify({ t: 'status', room: 'pub-23', seat: 0, role: 'host', players: 1, bots: 3, ai: 0 })}\n` }
    if (format === 'cells') yield { stream: 'stdout', text: `${JSON.stringify({ t: 'frame', n: 1, cols, rows, cells: cells(cols, rows) })}\n` }
    else yield { stream: 'stdout', text: `${JSON.stringify({ t: 'frame', n: 1, jpeg: '/9j/4AAQ', width: 480, height: 270 })}\n` }
    await ended
    return { code: 0, signal: null }
  }
  return { gen, stop: () => stop() }
}

describe('the arcade', () => {
  test('/arcade opens its pane with Homie Arcade\'s games and the studio\'s own', async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    await run($, 'arcade')
    expect(w.log.opened).toContain('homie-arcade')
    expect(w.log.fetched).toContain('https://arcade.homie.rocks/api/games')
    const ui = await $.ui.mount(pane('homie-arcade', 'terminal'))
    const select = await ui.find({ type: 'Select', key: 'arcade-game' })
    expect(JSON.stringify(select)).toContain('Bone Burglar · Homie Arcade')
    expect(JSON.stringify(select)).toContain('Owl Rush · Night Owls')
  })

  test('terminal: Play takes a real seat through the bridge and draws its frames as a Raster', async ($, on) => {
    const spawned: any[] = []
    const b = bridge(spawned)
    const w = world(on, { feed: null, spawn: b.gen })
    await start($)
    await run($, 'arcade')
    const ui = await $.ui.mount(pane('homie-arcade', 'terminal'))
    await ui.press({ key: 'arcade-play' })
    for (let i = 0; i < 40 && !spawned.length; i++) await new Promise((r) => setTimeout(r, 5))
    expect(spawned[0].slice(0, 2)).toEqual(['node', expect.stringMatching(/\/mod\/bridge\.mjs$/)] as any)
    expect(spawned[0]).toContain('https://arcade.homie.rocks/bone-burglar/play')
    expect(spawned[0][spawned[0].indexOf('--format') + 1]).toBe('cells')
    await new Promise((r) => setTimeout(r, 20))
    const text = textOf(await ui.drawn())
    expect(text).toContain('Bone Burglar')
    expect(text).toContain('room 23')
    expect(text).toContain('seat 1 · host')
    expect(text).toContain('1 person + 3 bots')
    expect(await ui.find({ type: 'Raster', key: 'screen' })).toBeDefined()
    expect(await ui.find({ type: 'Client', key: 'pad' })).toBeDefined()
    // The pad's keys, and the w/a/s/d buttons, go to the bridge over its private socket.
    await ui.post({ key: 'up' })
    await ui.press({ key: 'k-d' })
    expect(w.log.fetched.filter((f) => f.includes('/key'))).toEqual([
      'http://bridge/key via /tmp/homie-mod-x/b.sock {"key":"up","hold":300}',
      'http://bridge/key via /tmp/homie-mod-x/b.sock {"key":"right","hold":300}',
    ])
    await ui.press({ key: 'arcade-leave' })
    expect(w.log.fetched.some((f) => f.startsWith('http://bridge/quit'))).toBe(true)
    b.stop()
  })

  test('the pad draws its hint and posts the arrow keys it takes', async ($, on) => {
    const spawned: any[] = []
    const b = bridge(spawned)
    const w = world(on, { feed: null, spawn: b.gen })
    await start($)
    await run($, 'arcade')
    const ui = await $.ui.mount(pane('homie-arcade', 'terminal'))
    await ui.press({ key: 'arcade-play' })
    for (let i = 0; i < 40 && !spawned.length; i++) await new Promise((r) => setTimeout(r, 5))
    await new Promise((r) => setTimeout(r, 20))
    expect(textOf(await ui.drawn({ in: 'pad' }))).toContain('Click here to play')
    await ui.key({ key: 'left', in: 'pad' })
    expect(textOf(await ui.drawn({ in: 'pad' }))).toContain('● playing  ←')
    expect(w.log.fetched.some((f) => f.includes('{"key":"left"'))).toBe(true)
    b.stop()
  })

  test('desktop: the frames are an Svg', async ($, on) => {
    const spawned: any[] = []
    const b = bridge(spawned, { format: 'jpeg' })
    world(on, { feed: null, spawn: b.gen, surfaces: ['desktop'] })
    await start($, { surface: 'desktop' })
    await run($, 'arcade')
    const ui = await $.ui.mount(pane('homie-arcade', 'desktop'))
    await ui.press({ key: 'arcade-play' })
    for (let i = 0; i < 40 && !spawned.length; i++) await new Promise((r) => setTimeout(r, 5))
    await new Promise((r) => setTimeout(r, 20))
    expect(spawned[0][spawned[0].indexOf('--format') + 1]).toBe('jpeg')
    const svg = await ui.find({ type: 'Svg' })
    expect(JSON.stringify(svg)).toContain('data:image/jpeg;base64')
    b.stop()
  })

  test('a bridge whose pane is gone (closed by the person) is ended at the next tick; a hidden one is paused', async ($, on) => {
    const spawned: any[] = []
    const b = bridge(spawned)
    let panes: any[] = [{ id: 'homie-arcade', title: 'Arcade', isShown: false, isFocused: false, isPlaced: true }]
    const w = world(on, { feed: null, spawn: b.gen, panes: null })
    on('ui.panes', () => ({ value: panes }))
    await start($)
    await run($, 'arcade', 'bone-burglar')
    for (let i = 0; i < 40 && !spawned.length; i++) await new Promise((r) => setTimeout(r, 5))
    await new Promise((r) => setTimeout(r, 20))
    await w.clock.advance(2000)
    await new Promise((r) => setTimeout(r, 20))
    expect(w.log.fetched.some((f) => f.startsWith('http://bridge/pause'))).toBe(true)
    panes = []
    await w.clock.advance(2000)
    await new Promise((r) => setTimeout(r, 20))
    expect(w.log.fetched.some((f) => f.startsWith('http://bridge/quit'))).toBe(true)
    b.stop()
  })

  test('Rooms: "Watch in the pane" watches a live room through the bridge, as a watcher (no keys)', async ($, on) => {
    const spawned: any[] = []
    const b = bridge(spawned)
    world(on, { feed: null, spawn: b.gen })
    await start($)
    await run($, 'rooms')
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    await ui.press({ key: 'watch-here-live-owl-rush-pub-3' })
    for (let i = 0; i < 40 && !spawned.length; i++) await new Promise((r) => setTimeout(r, 5))
    expect(spawned[0]).toContain('https://night-owls.example/owl-rush/watch?room=pub-3')
    await new Promise((r) => setTimeout(r, 20))
    const arcade = await $.ui.mount(pane('homie-arcade', 'terminal'))
    const text = textOf(await arcade.drawn())
    expect(text).toContain('Stop watching')
    expect(await arcade.find({ type: 'Client' })).toBeUndefined()
    b.stop()
  })

  test('Build: a live room of the game being built can be watched in the Build tab', async ($, on) => {
    const spawned: any[] = []
    const b = bridge(spawned)
    world(on, { spawn: b.gen, http: { [`${DEV}/api/rooms`]: { ok: true, playing: 2, rooms: [{ game: 'owl-rush', name: 'Owl Rush', label: 'Room 1', room: 'pub-1', players: 2, max: 8, play: '/owl-rush/play?room=pub-1', watch: '/owl-rush/watch?room=pub-1', ai: 0 }] } } })
    await start($)
    await run($, 'rooms')
    await run($, 'build')
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    await ui.press({ key: 'watch-live' })
    for (let i = 0; i < 40 && !spawned.length; i++) await new Promise((r) => setTimeout(r, 5))
    await new Promise((r) => setTimeout(r, 20))
    expect(spawned[0].join(' ')).toMatch(/watch\?room=pub-(1|3)/)
    const text = textOf(await ui.drawn())
    expect(text).toContain('● live')
    expect(await ui.find({ type: 'Raster', key: 'watch' })).toBeDefined()
    b.stop()
  })

  test('with arcade: false, /arcade says it is off', { options: { arcade: false } }, async ($, on) => {
    const w = world(on, { feed: null })
    await start($)
    expect((await run($, 'arcade')).text).toContain('turned off')
    expect(w.log.opened).toEqual([])
  })

  test('the bridge is only ever the plugin\'s own script, and only for a studio site or *.homie.rocks', async ($, on) => {
    const spawned: any[] = []
    const b = bridge(spawned)
    world(on, { feed: null, spawn: b.gen })
    await start($)
    await run($, 'arcade', '2048-race')
    for (let i = 0; i < 40 && !spawned.length; i++) await new Promise((r) => setTimeout(r, 5))
    expect(spawned[0][1]).toMatch(/mod\/bridge\.mjs$/)
    expect(spawned[0][3]).toBe('https://arcade.homie.rocks/2048-race/play')
    expect(ROOT).toBe('/work/night-owls')
    b.stop()
  })
})
