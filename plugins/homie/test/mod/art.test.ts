/**
 * Art direction in the mod: the Studio pane's Art tab (drawn from .studio/art/<game>/latest.json, which the studio
 * toolkit writes; a malformed one is ignored), Lock (the person's press) and Unlock (asked first, with the blast
 * radius), the instant commands /look /lock /assets /lineup /rights, and the art guards: a locked decision, a deploy
 * shipping an unlicensed asset, a big file into git, and the models skill's paid calls.
 */
import { describe, expect, test } from 'claude-code/testing'
import { ROOT, pane, start, textOf, world } from './world.ts'

const SURFACES = ['terminal', 'desktop'] as const
const run = ($: any, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' } })
const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms))

/** A latest.json as `homie-studio style` / `assets` write it (a small copy of a real one, for Owl Rush). */
export const ART = {
  v: 1, game: 'owl-rush', at: '2026-10-02T10:01:00.000Z', path: 'automatic',
  line: 'Look: toon / cel, autumn grove palette, soft morning, high three-quarter camera, Lilita One and Nunito',
  phases: [
    { id: 'style', label: 'Style', total: 3, settled: 3, locked: 1 },
    { id: 'cast', label: 'Cast', total: 7, settled: 3, locked: 0 },
    { id: 'rigs', label: 'Rigs', total: 5, settled: 0, locked: 0 },
    { id: 'animations', label: 'Animations', total: 6, settled: 0, locked: 0 },
    { id: 'game', label: 'In game', total: 4, settled: 0, locked: 0 },
  ],
  decisions: [
    { phase: 'style', label: 'Style', rows: [
      { id: 'style.render', name: 'render style', label: 'Toon / cel', state: 'pinned', by: 'use', colours: null },
      { id: 'style.palette', name: 'palette', label: 'Autumn grove', state: 'locked', by: 'person', colours: ['#202a1f', '#f6ebd9', '#e98d3a'] },
      { id: 'style.camera', name: 'camera', label: 'High three-quarter\u001b[31m', state: 'steered', by: 'person', colours: null },
      // Not a state the toolkit writes: the row is dropped, the rest of the file is kept.
      { id: 'style.frozen', name: 'frozen thing', label: 'never drawn', state: 'frozen', by: 'ai', colours: null },
    ] },
    { phase: 'cast', label: 'Cast', rows: [
      { id: 'cast.list', name: 'cast', label: '7 assets', state: 'auto', by: 'ai', colours: null },
      { id: 'cast.scale', name: 'scale', label: '1 unit = 1 m', state: 'pinned', by: 'use', colours: null },
    ] },
  ],
  cast: [
    { id: 'lantern', kind: 'prop', route: 'generated', tier: 'prop', license: 'generated', state: 'approved', usd: 0.54 },
    { id: 'owl', kind: 'character', route: 'library', tier: 'hero', license: 'cc0', state: 'auto', usd: 0 },
    { id: 'moonstone', kind: 'prop', route: 'imported', tier: 'prop', license: null, state: 'auto', usd: 0 },
  ],
  stale: ['owl'],
  licence: [{ asset: 'moonstone', level: 'refuse', problem: 'no licence record', fix: 'record its licence: homie-studio assets add owl-rush --file … --license <cc0|cc-by-4.0|own|…>' }],
  spend: { used: 0.54, cap: 2, items: [{ what: 'lantern: concept', usd: 0.04, receipt: 'art/lantern/concept.png.json' }, { what: 'lantern: mesh', usd: 0.5, receipt: 'art/lantern/raw/mesh.glb.json' }] },
  check: { ok: false, at: '2026-10-02T10:00:30.000Z', totals: { assets: 3, triangles: 2400, drawCalls: 120, textureMB: 2.7, firstPlayMB: null }, budgets: { drawCalls: 100, triangles: 150000, textureMB: 48, firstPlayMB: 5 }, failing: ['owl'] },
  lineup: { at: '2026-10-02T09:59:00.000Z', flagged: 1, images: { front: '.studio/art/owl-rush/lineup-front.jpg', quarter: '.studio/art/owl-rush/lineup-quarter.jpg', silhouettes: '/etc/passwd' } },
  board: { chosen: 'b', directions: [{ id: 'a', label: 'Toon / cel · Autumn grove', swatch: 'codex/board/a-swatch.jpg', mood: null }, { id: 'b', label: 'Flat low-poly · Meadow morning', swatch: 'codex/board/b-swatch.jpg', mood: null }] },
  need: ['idle', 'run', 'jump', 'attack'],
  characters: [
    { id: 'owl', kind: 'character', route: 'library', family: 'humanoid', skeleton: 'humanoid-7a503a', bones: 23, verbs: ['idle', 'run', 'jump'], missing: ['attack'], retargeted: 0, animsKB: 83 },
    { id: 'ranger', kind: 'character', route: 'generated', family: 'humanoid', skeleton: 'humanoid-5cc359', bones: 24, verbs: ['idle', 'run', 'jump', 'attack'], missing: [], retargeted: 4, animsKB: 91 },
    { id: '../evil', kind: 'character', route: 'library', verbs: ['idle'], missing: [] },
  ],
  skinning: { players: 8, vertices: 73312, bones: 192, budget: { vertices: 60000, bones: 1200 } },
}

const ART_FILE = `${ROOT}/.studio/art/owl-rush/latest.json`
const DECISIONS = `${ROOT}/games/owl-rush/codex/decisions.json`
const MANIFEST = `${ROOT}/games/owl-rush/assets/manifest.json`

const BLAST = {
  ok: true, command: 'style blast', id: 'owl-rush',
  blast: {
    decision: 'style.palette', name: 'palette', from: 'Autumn grove', to: null, state: 'locked',
    assets: [
      { id: 'lantern', kind: 'prop', route: 'generated', card: 'Items/Lantern', why: 'palette, its concept prompt', remake: { usd: 0.54, how: '2 paid steps again (concept + mesh)' }, free: null },
      { id: 'owl', kind: 'character', route: 'library', card: 'Characters/Owl', why: 'palette', remake: { usd: 0, how: 'free' }, free: 'a palette re-tint (no model call, free)' },
    ],
    totals: { assets: 2, usd: 0.54, usdIfAllRemade: 0.54, free: 1 }, decisions: ['style.light'], note: 'Nothing is remade by itself: the person approves the list, under the budget.',
  },
}

/** The studio's CLI answering the art commands (everything else falls through to the world's own answers). */
const cli = (argv: readonly string[]) => {
  const a = argv.join(' ')
  const out = (j: unknown) => ({ exitCode: 0, stdout: JSON.stringify(j), stderr: '' })
  if (/ style blast /.test(a)) return out(BLAST)
  if (/ style unlock /.test(a)) return out({ ok: true, command: 'style unlock', id: 'owl-rush', decision: 'style.palette', record: { state: 'steered' } })
  if (/ style lock owl-rush style\.palette /.test(a)) return out({ ok: true, command: 'style lock', id: 'owl-rush', locked: [], already: ['style.palette'] })
  if (/ style lock owl-rush style\.nope /.test(a)) return { exitCode: 1, stdout: JSON.stringify({ ok: false, why: 'no decision "style.nope"' }), stderr: '' }
  if (/ style lock /.test(a)) return out({ ok: true, command: 'style lock', id: 'owl-rush', locked: ['style.camera'], already: [] })
  return null
}

const artWorld = (on: any, over: Record<string, any> = {}) => world(on, { feed: null, run: cli, ...over, files: { [ART_FILE]: JSON.stringify(ART), ...(over.files ?? {}) } })

describe('the Art tab', () => {
  for (const surface of SURFACES) {
    test(`${surface}: the phase strip, the look, each decision with Lock or Unlock, the cast, the budgets, the spend and the licences`, async ($, on) => {
      const w = artWorld(on, { surfaces: [surface] })
      await start($, { surface })
      const r = await run($, 'studio', 'art')
      expect(r.text).toBeUndefined()
      expect(w.log.opened).toEqual(['homie-studio'])
      const ui = await $.ui.mount(pane('homie-studio', surface, 110))
      const text = textOf(await ui.drawn())
      expect(text).toContain('[Art]')
      expect(text).toContain('Owl Rush')
      expect(text).toContain('Style ✓→Cast 3/7→Rigs→Animations→In game')
      expect(text).toContain('Look: toon / cel, autumn grove palette')
      expect(text).toContain('style board: B chosen (Flat low-poly · Meadow morning)')
      expect(text).toContain('■palette')
      expect(text).toContain('Autumn grove')
      expect(text).toContain('██')
      expect(text).toContain('●render style')
      expect(text).toContain('~camera')
      expect(text).toContain('the person')
      expect(text).toContain('by use')
      expect(text).not.toContain('frozen')
      expect(text).not.toContain('\u001b')
      expect(await ui.find({ key: 'art-unlock-owl-rush-style.palette' })).toBeDefined()
      expect(await ui.find({ key: 'art-lock-owl-rush-style.camera' })).toBeDefined()
      expect(text).toContain('+ 2 more decisions in Cast (/look owl-rush)')
      expect(text).toContain('Cast · 3 assets · 1 stale')
      expect(text).toContain('lantern')
      expect(text).toContain('$0.54')
      expect(text).toContain('no licence')
      expect(text).toContain('STALE')
      expect(text).toContain('Scene budgets')
      expect(text).toContain('✗ over')
      expect(text).toContain('120 / 100')
      expect(text).toContain('2,400 / 150,000')
      expect(text).toContain('2.7 / 48 MB')
      expect(text).toContain('not measured / 5 MB')
      expect(text).toContain('over its own budget: owl')
      expect(text).toContain('$0.54 of $2.00')
      expect(text).toContain('2 paid steps')
      expect(text).toContain('lineup')
      expect(text).toContain('1 flagged')
      expect(text).toContain('Licences: 1 to fix before a public deploy')
      expect(text).toContain('✗ moonstone: no licence record')
      expect(text).toContain('→ record its licence')
      expect(text).toContain('■ locked by the person')
    })
  }

  test('a latest.json that is not one (another version, not JSON, a stranger game id) is ignored', async ($, on) => {
    artWorld(on, {
      files: {
        [`${ROOT}/.studio/art/bat-blitz/latest.json`]: JSON.stringify({ ...ART, v: 2, game: 'bat-blitz', line: 'Look: bats' }),
        [`${ROOT}/.studio/art/moth-mania/latest.json`]: '{ not json',
        [`${ROOT}/.studio/art/fox-den/latest.json`]: JSON.stringify({ ...ART, game: 'someone-else', line: 'Look: foxes' }),
        [`${ROOT}/.studio/art/Bad Name/latest.json`]: JSON.stringify({ ...ART, game: 'Bad Name', line: 'Look: bad' }),
      },
    })
    await start($)
    await run($, 'studio', 'art')
    const text = textOf(await (await $.ui.mount(pane('homie-studio', 'terminal'))).drawn())
    expect(text).toContain('Look: toon / cel')
    for (const no of ['bats', 'moth-mania', 'foxes', 'Look: bad']) expect(text).not.toContain(no)
  })

  test('with no art direction it says how to get one', async ($, on) => {
    world(on, { feed: null, files: { [ART_FILE]: '[]' } })
    await start($)
    await run($, 'studio', 'art')
    expect(textOf(await (await $.ui.mount(pane('homie-studio', 'desktop'))).drawn())).toContain('No art direction yet')
  })

  test('Lock is the person\'s press, recorded as their words', async ($, on) => {
    const w = artWorld(on)
    await start($)
    await run($, 'studio', 'art')
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    await ui.press({ key: 'art-lock-owl-rush-style.camera' })
    expect(w.log.ran.find((a) => a.includes('lock')).slice(-7)).toEqual(['style', 'lock', 'owl-rush', 'style.camera', '--words', 'pressed Lock in the Studio pane', '--json'])
    expect(w.log.toasts.join(' ')).toContain('Locked: camera')
    expect(w.log.asked).toEqual([])
  })

  test('Unlock asks first with the blast radius (style blast), and runs only on Proceed', async ($, on) => {
    const w = artWorld(on)
    await start($)
    await run($, 'studio', 'art')
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    await ui.press({ key: 'art-unlock-owl-rush-style.palette' })
    const ran = w.log.ran.map((a) => a.join(' '))
    const blast = ran.findIndex((a) => a.includes('style blast owl-rush style.palette --json'))
    const unlock = ran.findIndex((a) => a.includes('style unlock owl-rush style.palette --reason pressed Unlock in the Studio pane --json'))
    expect(blast).toBeGreaterThanOrEqual(0)
    expect(unlock).toBeGreaterThan(blast)
    expect(w.log.asked[0]).toContain('Unlock palette in Owl Rush?')
    expect(w.log.toasts.join(' ')).toContain('Unlocked palette')
  })

  test('Cancel (or nobody to ask) leaves it locked: unlock never runs', async ($, on) => {
    const w = artWorld(on, { ask: 'Cancel' })
    await start($)
    await run($, 'studio', 'art')
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    await ui.press({ key: 'art-unlock-owl-rush-style.palette' })
    expect(w.log.asked.length).toBe(1)
    expect(w.log.ran.some((a) => a.includes('unlock'))).toBe(false)
    expect(w.log.toasts.join(' ')).toContain('palette stays locked')
  })

  test('the question shows what goes stale and what remaking costs; the Hold pane has every asset', async ($, on) => {
    let release: (v: unknown) => void = () => {}
    const asked: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => new Promise((resolve) => { asked.push(e.questions[0].question); release = () => resolve({ result: { answers: { [e.questions[0].question]: 'Cancel' } } }) }))
    const w = artWorld(on)
    await start($)
    await run($, 'studio', 'art')
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    const pressing = ui.press({ key: 'art-unlock-owl-rush-style.palette' })
    for (let i = 0; i < 40 && !asked.length; i++) await wait(5)
    const dialog = await $.ui.mount({ plugin: 'homie', component: 'AskUserQuestion', requestId: 'q-art', surface: 'terminal', viewport: { columns: 120, rows: 40, isFullscreen: false }, props: { tool: 'AskUserQuestion', questions: [{ question: asked[0], header: 'Homie', options: [{ label: 'Proceed' }, { label: 'Cancel' }], multiSelect: false }] } })
    const short = textOf(await dialog.drawn())
    expect(short).toContain('⚠ Unlock palette')
    expect(short).toContain('2 assets if it changes')
    expect(short).toContain('about $0.54 (1 paid)')
    const hold = textOf(await (await $.ui.mount(pane('homie-hold', 'terminal'))).drawn())
    expect(hold).toContain('lantern')
    expect(hold).toContain('2 paid steps again (concept + mesh), about $0.54')
    expect(hold).toContain('a palette re-tint (no model call, free)')
    expect(hold).toContain('style.light')
    expect(textOf(await ui.drawn())).toContain('waiting for your answer: unlock palette?')
    release(null)
    await pressing
    expect(w.log.ran.some((a) => a.includes('unlock'))).toBe(false)
  })

  test('the tab rereads its files on the timer while it is open', async ($, on) => {
    const w = artWorld(on)
    await start($)
    await run($, 'studio', 'art')
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    expect(textOf(await ui.drawn())).toContain('Look: toon / cel')
    w.files.set(ART_FILE, JSON.stringify({ ...ART, at: '2026-10-02T10:05:00.000Z', line: 'Look: flat low-poly, meadow morning' }))
    await w.clock.advance(10_000)
    await wait(20)
    expect(textOf(await ui.drawn())).toContain('Look: flat low-poly, meadow morning')
  })

  test('in a claude -p run (nothing draws) /studio art prints the look instead', async ($, on) => {
    const w = artWorld(on, { surfaces: [] })
    await start($, { surface: null as any, interactive: false })
    const r = await run($, 'studio', 'art')
    expect(r.text).toContain('Owl Rush (owl-rush): Look: toon / cel')
    expect(w.log.opened).toEqual([])
  })
})

describe('the art commands', () => {
  test('/look opens the Art tab and prints the look line and the style decisions', async ($, on) => {
    const w = artWorld(on)
    await start($)
    const r = await run($, 'look')
    expect(w.log.opened).toEqual(['homie-studio'])
    expect(r.text).toContain('Owl Rush (owl-rush): Look: toon / cel, autumn grove palette')
    expect(r.text).toContain('Style ✓ → Cast 3/7 → Rigs → Animations → In game · automatic')
    expect(r.text).toContain('■ palette       Autumn grove  (locked, the person)')
    expect(r.text).toContain('· ')
    expect(r.text).toContain('+ 2 more decisions in Cast: npx --no-install homie-studio style owl-rush')
    expect(r.text).toContain('/lock <decision> locks one')
    expect(textOf(await (await $.ui.mount(pane('homie-studio', 'terminal'))).drawn())).toContain('Scene budgets')
  })

  test('/look with no art direction, and for a game without one', async ($, on) => {
    world(on, { feed: null })
    await start($)
    expect((await run($, 'look')).text).toContain('No art direction yet: ask Claude for a look')
  })

  test('/look <game> names a game that has none', async ($, on) => {
    artWorld(on)
    await start($)
    expect((await run($, 'look', 'bat-blitz')).text).toContain('bat-blitz has no art direction yet (games with one: owl-rush)')
  })

  test('/lock <decision> locks it in the only game with art direction, as the person\'s typed words', async ($, on) => {
    const w = artWorld(on)
    await start($)
    const r = await run($, 'lock', 'style.camera')
    expect(w.log.ran.find((a) => a.includes('lock')).slice(-7)).toEqual(['style', 'lock', 'owl-rush', 'style.camera', '--words', '/lock style.camera', '--json'])
    expect(r.text).toContain('Locked in Owl Rush: camera (High three-quarter)')
    expect(r.text).toContain('unlocking is asked for in the Studio pane')
  })

  test('/lock says why not: no decision named, a decision the toolkit does not know, one locked already, two games', async ($, on) => {
    const w = artWorld(on, { files: { [`${ROOT}/.studio/art/bat-blitz/latest.json`]: JSON.stringify({ ...ART, game: 'bat-blitz' }) } })
    await start($)
    expect((await run($, 'lock')).text).toContain('Usage: /lock <decision> [game]')
    expect((await run($, 'lock', 'style.palette')).text).toContain('Several games have art direction (')
    expect((await run($, 'lock', 'style.palette owl-rush')).text).toContain('Nothing new to lock in Owl Rush')
    expect((await run($, 'lock', 'style.palette owl-rush')).text).toContain('already locked: style.palette')
    expect((await run($, 'lock', 'style.nope owl-rush')).text).toContain('Not locked: no decision "style.nope"')
    expect((await run($, 'lock', 'Style.Palette;rm owl-rush')).text).toContain('Usage')
    expect(w.log.ran.filter((a) => a.includes('lock')).length).toBe(3)
  })

  test('/assets prints the cast with spend and licence problems', async ($, on) => {
    artWorld(on)
    await start($)
    const r = await run($, 'assets')
    expect(r.text).toContain('Owl Rush (owl-rush): 3 assets')
    expect(r.text).toContain('lantern    prop · generated · generated · approved · $0.54')
    expect(r.text).toContain('owl        character · library · cc0 · auto · free  STALE')
    expect(r.text).toContain('moonstone  prop · imported · NO LICENCE · auto · free')
    expect(r.text).toContain('spent $0.54 of $2.00 on 2 paid steps')
    expect(r.text).toContain('120/100 draw calls (OVER)')
    expect(r.text).toContain('licences: 1 to fix before a public deploy (/rights owl-rush)')
  })

  test('/cast prints the characters with their skeletons and clips; /clips what each lacks', async ($, on) => {
    artWorld(on)
    await start($)
    const cast = (await run($, 'cast')).text
    expect(cast).toContain('Owl Rush (owl-rush): 2 characters; the game needs idle, run, jump, attack')
    expect(cast).toContain('owl     character · library · humanoid skeleton · 23 bones · 3 clips  MISSING attack')
    expect(cast).toContain('ranger  character · generated · humanoid skeleton · 24 bones · 4 clips (4 retargeted)')
    expect(cast).toContain('skinning a room of 8: 73,312/60,000 vertices, 192/1,200 bones a frame on a phone (OVER')
    expect(cast).not.toContain('evil')
    const clips = (await run($, 'clips')).text
    expect(clips).toContain('missing attack (homie-studio anim add owl-rush owl --verbs attack)')
    expect(textOf(await (await $.ui.mount(pane('homie-studio', 'terminal'))).drawn())).toContain('Characters · 2')
  })

  test('/lineup prints the last lineup\'s flags and its pictures; it never renders one', async ($, on) => {
    const w = artWorld(on)
    await start($)
    const r = await run($, 'lineup')
    expect(r.text).toContain('Owl Rush (owl-rush): last lineup')
    expect(r.text).toContain('1 asset flagged')
    expect(r.text).toContain('front: .studio/art/owl-rush/lineup-front.jpg')
    expect(r.text).not.toContain('/etc/passwd')
    expect(w.log.ran.length).toBe(0)
    expect(w.log.spawned.length).toBe(0)
  })

  test('/lineup with none yet says to ask Claude', async ($, on) => {
    world(on, { feed: null, files: { [ART_FILE]: JSON.stringify({ ...ART, lineup: null }) } })
    await start($)
    expect((await run($, 'lineup')).text).toContain('no lineup yet: ask Claude for one')
  })

  test('/rights prints each licence problem with its fix, and where RIGHTS.md is', async ($, on) => {
    artWorld(on, { files: { [`${ROOT}/games/owl-rush/assets/RIGHTS.md`]: '# Rights' } })
    await start($)
    const r = await run($, 'rights')
    expect(r.text).toContain('Owl Rush (owl-rush): 1 licence problem')
    expect(r.text).toContain('✗ moonstone: no licence record')
    expect(r.text).toContain('→ record its licence: homie-studio assets add owl-rush')
    expect(r.text).toContain('  games/owl-rush/assets/RIGHTS.md')
  })

  test('/rights before RIGHTS.md exists says how to write it', async ($, on) => {
    artWorld(on)
    await start($)
    expect((await run($, 'rights')).text).toContain('games/owl-rush/assets/RIGHTS.md is not written yet: npx --no-install homie-studio assets rights owl-rush')
  })

  test('outside a studio they say so', async ($, on) => {
    world(on, { inStudio: false })
    await start($, { cwd: '/work/elsewhere' })
    for (const c of ['look', 'lock', 'assets', 'lineup', 'rights']) expect((await run($, c, 'style.palette')).text).toContain('Not inside a Homie studio')
  })
})

/* ------------------------------------------------------------------ guards */

const decisions = (over: Record<string, unknown> = {}) => ({
  v: 1, scope: 'game', game: 'owl-rush', path: 'automatic',
  decisions: {
    'style.palette': { phase: 'style', state: 'locked', by: 'person', rev: 2, label: 'Autumn grove', value: { name: 'autumn-grove', bg: '#202a1f', accent: '#e98d3a' } },
    'style.camera': { phase: 'style', state: 'steered', by: 'person', rev: 2, label: 'High three-quarter', value: { angle: 'high-3/4', pitch: 52 } },
    ...over,
  },
})
const DECISIONS_TEXT = `${JSON.stringify(decisions(), null, 2)}\n`

describe('the lock guard (a decision the person locked)', () => {
  test('an Edit that changes a locked value is refused, nobody asked, the edit never runs', async ($, on) => {
    const w = world(on, { feed: null, files: { [DECISIONS]: DECISIONS_TEXT } })
    await start($)
    const r = await $.tool.call({ tool: 'Edit', file_path: DECISIONS, old_string: '"accent": "#e98d3a"', new_string: '"accent": "#ff0000"' })
    expect(r.deny).toContain('style.palette is locked by the person; change it with homie-studio style set owl-rush style.palette <value> --unlock --reason')
    expect(r.deny).toContain('homie-studio style blast owl-rush style.palette')
    expect(w.log.tools).toEqual([])
    expect(w.log.asked).toEqual([])
  })

  test('a Write that unlocks it (locked → steered) or drops it is refused too', async ($, on) => {
    const w = world(on, { feed: null, files: { [DECISIONS]: DECISIONS_TEXT } })
    await start($)
    const steered = decisions({ 'style.palette': { ...decisions().decisions['style.palette'], state: 'steered' } })
    expect((await $.tool.call({ tool: 'Write', file_path: DECISIONS, content: JSON.stringify(steered) })).deny).toContain('style.palette is locked')
    const { 'style.palette': _, ...rest } = decisions().decisions
    expect((await $.tool.call({ tool: 'Write', file_path: DECISIONS, content: JSON.stringify({ ...decisions(), decisions: rest }) })).deny).toContain('style.palette is locked')
    expect((await $.tool.call({ tool: 'MultiEdit', file_path: DECISIONS, edits: [{ old_string: '"pitch": 52', new_string: '"pitch": 40' }, { old_string: '"bg": "#202a1f"', new_string: '"bg": "#000000"' }] })).deny).toContain('style.palette is locked')
    expect(w.log.tools).toEqual([])
  })

  test('an edit that leaves the file unreadable is refused while anything is locked', async ($, on) => {
    world(on, { feed: null, files: { [DECISIONS]: DECISIONS_TEXT } })
    await start($)
    const r = await $.tool.call({ tool: 'Edit', file_path: DECISIONS, old_string: '"v": 1,', new_string: '"v": 1,,' })
    expect(r.deny).toContain('would leave it unreadable (not JSON)')
  })

  test('other edits pass: an unlocked decision, a label, the same value written in another order', async ($, on) => {
    const w = world(on, { feed: null, files: { [DECISIONS]: DECISIONS_TEXT } })
    await start($)
    const a = await $.tool.call({ tool: 'Edit', file_path: DECISIONS, old_string: '"pitch": 52', new_string: '"pitch": 40' })
    const b = await $.tool.call({ tool: 'Edit', file_path: DECISIONS, old_string: '"label": "Autumn grove"', new_string: '"label": "Autumn grove (warm)"' })
    const reordered = decisions({ 'style.palette': { label: 'Autumn grove', rev: 2, by: 'person', state: 'locked', phase: 'style', value: { accent: '#e98d3a', bg: '#202a1f', name: 'autumn-grove' } } })
    const c = await $.tool.call({ tool: 'Write', file_path: DECISIONS, content: JSON.stringify(reordered) })
    for (const r of [a, b, c]) expect(r.deny).toBeUndefined()
    expect(w.log.tools).toEqual(['Edit', 'Edit', 'Write'])
    expect(w.log.asked).toEqual([])
  })

  test('a decisions.json with nothing locked, and the same name elsewhere, are not guarded', async ($, on) => {
    const w = world(on, { feed: null, files: { [DECISIONS]: JSON.stringify(decisions({ 'style.palette': { phase: 'style', state: 'pinned', by: 'use', rev: 1, value: { bg: '#000' } } })), [`${ROOT}/notes/decisions.json`]: DECISIONS_TEXT } })
    await start($)
    await $.tool.call({ tool: 'Write', file_path: DECISIONS, content: 'not json' })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/notes/decisions.json`, content: '{}' })
    expect(w.log.tools).toEqual(['Write', 'Write'])
  })

  test('guardFiles: false leaves it alone', { options: { guardFiles: false } }, async ($, on) => {
    const w = world(on, { feed: null, files: { [DECISIONS]: DECISIONS_TEXT } })
    await start($)
    await $.tool.call({ tool: 'Write', file_path: DECISIONS, content: '{}' })
    expect(w.log.tools).toEqual(['Write'])
  })
})

describe('the licence guard (a deploy of a public game)', () => {
  const live = { result: { stdout: 'Live: https://night-owls.example\n', stderr: '', interrupted: false } }
  const manifest = (assets: unknown[]) => JSON.stringify({ v: 1, assets })
  const cc0 = { id: 'owl', kind: 'character', route: 'library', license: { kind: 'cc0', remix: 'include', attribution: null } }

  test('an asset with no licence refuses the deploy, before anyone is asked, with the list and the fix', async ($, on) => {
    const w = world(on, { feed: null, tool: () => live, files: { [MANIFEST]: manifest([cc0, { id: 'moonstone', kind: 'prop', route: 'imported', license: { kind: null } }]) } })
    await start($)
    const r = await $.tool.call({ tool: 'Bash', command: 'npm run deploy' })
    expect(r.deny).toContain('Not deployed: 1 asset in a public game has no allowed licence: owl-rush/moonstone: no licence recorded')
    expect(r.deny).toContain('homie-studio assets check owl-rush')
    expect(w.log.asked).toEqual([])
    expect(w.log.tools).toEqual([])
  })

  test('TurboSquid, CC BY without credit, an unknown kind, and a closed licence handed to remixers are refused', async ($, on) => {
    const assets = [
      { id: 'a-ts', license: { kind: 'eula:turbosquid', remix: 'none' } },
      { id: 'b-by', license: { kind: 'cc-by-4.0', remix: 'include', attribution: '' } },
      { id: 'c-what', license: { kind: 'wtfpl', remix: 'include' } },
      { id: 'd-qal', license: { kind: 'qal', remix: 'include' } },
      { id: 'e-market', license: { kind: 'market:fab-123', remix: 'none' } },
      { id: 'f-by', license: { kind: 'cc-by-3.0', remix: 'include', attribution: 'Owl by a friend (example.org)' } },
    ]
    world(on, { feed: null, files: { [MANIFEST]: manifest(assets) } })
    await start($)
    const r = await $.tool.call({ tool: 'mcp__plugin_homie_homie__studio_deploy', studio: 'night-owls' })
    expect(r.deny).toContain('4 assets in a public game have no allowed licence')
    for (const id of ['a-ts', 'b-by', 'c-what', 'd-qal']) expect(r.deny).toContain(`owl-rush/${id}:`)
    for (const id of ['e-market', 'f-by']) expect(r.deny).not.toContain(`owl-rush/${id}:`)
  })

  test('a private game, or one whose source is closed, is not read; a public one all licensed adds a Licences line to the hold', async ($, on) => {
    let release: (v: unknown) => void = () => {}
    const asked: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => new Promise((resolve) => { asked.push(e.questions[0].question); release = () => resolve({ result: { answers: { [e.questions[0].question]: 'Proceed' } } }) }))
    world(on, {
      feed: null, tool: () => live,
      files: {
        [MANIFEST]: manifest([cc0, { ...cc0, id: 'moon' }]),
        [`${ROOT}/games/bat-blitz/game.json`]: JSON.stringify({ id: 'bat-blitz', name: 'Bat Blitz', launch: 'private' }),
        [`${ROOT}/games/bat-blitz/assets/manifest.json`]: manifest([{ id: 'bat', license: {} }]),
        [`${ROOT}/games/moth-mania/game.json`]: JSON.stringify({ id: 'moth-mania', name: 'Moth Mania', share: { source: false } }),
        [`${ROOT}/games/moth-mania/assets/manifest.json`]: manifest([{ id: 'moth', license: {} }]),
      },
    })
    await start($)
    const held = $.tool.call({ tool: 'Bash', command: 'npm run deploy' })
    for (let i = 0; i < 40 && !asked.length; i++) await wait(5)
    expect(asked[0]).toContain('Deploy Night Owls to production?')
    const hold = textOf(await (await $.ui.mount(pane('homie-hold', 'terminal'))).drawn())
    expect(hold).toContain('Licences  2 assets, all licensed (assets/manifest.json of 1 public game)')
    release(null)
    expect((await held).deny).toBeUndefined()
  })

  test('guardDeploys: false reads no licence', { options: { guardDeploys: false } }, async ($, on) => {
    const w = world(on, { feed: null, tool: () => live, files: { [MANIFEST]: manifest([{ id: 'moonstone', license: {} }]) } })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'npm run deploy' })
    expect(w.log.tools).toEqual(['Bash'])
  })
})

describe('the raw-file guard (a file over 5 MB under games/ into git)', () => {
  const BIG = `${ROOT}/games/owl-rush/raw/owl-hd.glb`
  const SMALL = `${ROOT}/games/owl-rush/public/models/owl.glb`
  const MB = 1024 * 1024
  const files = { [BIG]: 'glb', [SMALL]: 'glb', [`${ROOT}/art/owl/raw/owl.fbx`]: 'fbx' }
  const sizes = { [BIG]: 6 * MB, [SMALL]: 300 * 1024, [`${ROOT}/art/owl/raw/owl.fbx`]: 40 * MB }
  const git = (answers: Record<string, string>) => (argv: readonly string[]) => {
    if (argv[0] !== 'git') return null
    const a = argv.join(' ')
    if (a.includes('--show-prefix')) return { exitCode: 0, stdout: '\n', stderr: '' }
    for (const [k, v] of Object.entries(answers)) if (a.includes(k)) return { exitCode: 0, stdout: v, stderr: '' }
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  test('git commit refuses a staged 6 MB file, naming it and its size, with the R2 route', async ($, on) => {
    const w = world(on, { feed: null, files, sizes, run: git({ 'diff --cached --name-only -z': 'games/owl-rush/raw/owl-hd.glb\0games/owl-rush/public/models/owl.glb\0' }) })
    await start($)
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m "the owl, in HD"' })
    expect(r.deny).toContain('games/owl-rush/raw/owl-hd.glb (6.0 MB)')
    expect(r.deny).not.toContain('owl.glb (')
    expect(r.deny).toContain('homie-studio storage add, then media move')
    expect(r.deny).toContain('art/<slug>/raw/ (git-ignored)')
    expect(r.deny).toContain('homie-studio assets optimise')
    expect(w.log.tools).toEqual([])
    expect(w.log.ran.every((a) => a[0] === 'git' && ['rev-parse', 'diff', 'status'].includes(a[3]))).toBe(true)
  })

  test('git add of a named file, of a folder, and -A are read the same way', async ($, on) => {
    const w = world(on, { feed: null, files, sizes, run: git({ 'status --porcelain -z --untracked-files=all': '?? games/owl-rush/raw/owl-hd.glb\0 M games/owl-rush/game.json\0' }) })
    await start($)
    expect((await $.tool.call({ tool: 'Bash', command: 'git add games/owl-rush/raw/owl-hd.glb' })).deny).toContain('owl-hd.glb (6.0 MB)')
    expect((await $.tool.call({ tool: 'Bash', command: 'cd games && git add owl-rush' })).deny).toContain('owl-hd.glb (6.0 MB)')
    expect((await $.tool.call({ tool: 'Bash', command: 'git add -A && git commit -m "all of it"' })).deny).toContain('owl-hd.glb (6.0 MB)')
    expect(w.log.tools).toEqual([])
  })

  test('small files under games/, and big ones outside it, pass', async ($, on) => {
    const w = world(on, { feed: null, files, sizes, run: git({ 'diff --cached --name-only -z': 'games/owl-rush/public/models/owl.glb\0art/owl/raw/owl.fbx\0' }) })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'git add games/owl-rush/public/models/owl.glb && git commit -m "a phone-sized owl"' })
    expect(w.log.tools).toEqual(['Bash'])
  })

  test('guardFiles: false runs nothing', { options: { guardFiles: false } }, async ($, on) => {
    const w = world(on, { feed: null, files, sizes, run: git({ 'diff --cached --name-only -z': 'games/owl-rush/raw/owl-hd.glb\0' }) })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.log.tools).toEqual(['Bash'])
    expect(w.log.ran).toEqual([])
  })
})

describe('the models skill\'s paid calls (the spend guard)', () => {
  const priced = (argv: readonly string[]) => {
    const a = argv.join(' ')
    if (/models\.mjs prop .*--dry-run --json$/.test(a)) return { exitCode: 0, stdout: JSON.stringify({ ok: true, dryRun: true, price: { usd: 0.5, basis: 'Tripo P1, 1 generation' }, command: 'prop', step: 'mesh' }), stderr: '' }
    if (/models\.mjs mood .*--dry-run --json$/.test(a)) return { exitCode: 0, stdout: JSON.stringify({ ok: true, command: 'mood', images: [{ direction: 'a', ok: true, dryRun: true, price: { usd: 0.04 } }, { direction: 'b', ok: true, dryRun: true, price: { usd: 0.04 } }, { direction: 'c', ok: true, dryRun: true, price: { usd: 0.04 } }] }), stderr: '' }
    return null
  }

  test('prop … --yes past the game\'s model cap (art/<game>-models/budget.json) is held with the dry run\'s price', async ($, on) => {
    const w = world(on, { feed: null, run: priced, files: { [`${ROOT}/art/owl-rush-models/budget.json`]: JSON.stringify({ provider: 'fal', unit: 'usd', cap: 1, spent: 0.6 }) } })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'node /p/skills/models/scripts/models.mjs prop owl-rush lantern --mesh --yes' })
    const dry = w.log.ran.find((a) => a.includes('--dry-run'))
    expect(dry).toEqual(['node', '/p/skills/models/scripts/models.mjs', 'prop', 'owl-rush', 'lantern', '--mesh', '--dry-run', '--json'])
    expect(w.log.asked[0]).toContain('Spend about $0.50 at fal, past the budget?')
  })

  test('mood … --yes is priced as the sum of its images, and within every budget it goes through', async ($, on) => {
    const w = world(on, { feed: null, run: priced })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'node skills/models/scripts/models.mjs mood owl-rush all --yes' })
    expect(w.log.asked).toEqual([])
    expect(w.log.toasts.join(' ')).toContain('fal: about $0.12')
    expect(w.log.tools).toEqual(['Bash'])
  })

  test('without --yes, or with --dry-run, it only prices: not held', async ($, on) => {
    const w = world(on, { feed: null, run: priced })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'node skills/models/scripts/models.mjs prop owl-rush lantern --what "a lantern"' })
    await $.tool.call({ tool: 'Bash', command: 'node skills/models/scripts/models.mjs mood owl-rush all --dry-run --json' })
    await $.tool.call({ tool: 'Bash', command: 'node skills/models/scripts/models.mjs quote owl-rush --yes' })
    expect(w.log.ran).toEqual([])
    expect(w.log.asked).toEqual([])
  })
})
