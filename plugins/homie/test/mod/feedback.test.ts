/**
 * Tell Homie in Claude Code: /feedback and the Studio pane's Tell Homie show a note exactly as it would go and send it
 * only on the person's own Send; a homie_feedback send from Claude waits for Send in Claude Code's own question, with
 * the note's words; Don't send, a dismissed question and `claude -p` send nothing; an offer after the person already
 * answered one this session is refused.
 */
import { describe, expect, test } from 'claude-code/testing'
import { ROOT, pane, start, textOf, world } from './world.ts'

const TELL = 'https://homie.rocks/api/feedback/tell'
// Made-up values built at run time.
const REF = ['0f0e0d0c', '0001', '4000', '8000', '0'.repeat(12)].join('-')
const HOME = ['', 'Users', 'someone'].join('/')
const MAIL = ['me', 'example.org'].join('@')
const SENT = { [TELL]: { ok: true, reference: REF } }
const run = ($: any, args = '', kind = 'composer') => $.command.run({ command: 'feedback', args, origin: { kind } })
const PIN = { [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { '@homie-rocks/studio': '0.27.0' } }) }
const tellPane = (surface: 'terminal' | 'desktop' = 'terminal') => ({ ...pane('homie-tell', surface), props: { ...pane('homie-tell', surface).props, title: 'Tell Homie' } })

describe('/feedback', () => {
  test('the person\'s own words open the Tell Homie pane with the exact note; nothing is sent', async ($, on) => {
    const w = world(on, { feed: null, files: PIN, http: SENT })
    await start($)
    const r = await run($, `I was confused by the workers.dev subdomain question in ${HOME}/Studios/owls`)
    expect(r.text).toBeUndefined()
    expect(w.log.opened).toEqual(['homie-tell'])
    const ui = await $.ui.mount(tellPane())
    const text = textOf(await ui.drawn())
    expect(text).toContain('This is exactly what would go:')
    expect(text).toContain(`I was confused by the workers.dev subdomain question in ${'~'}/Studios/owls`)
    expect(text).toContain('Confusing')
    expect(text).toContain('studio 0.27.0')
    expect(text).toContain('Homie took out a home folder.')
    expect(text).toContain('Nothing is sent until you press Send')
    expect(w.log.posted).toEqual([])
  })

  test('Send in the pane sends exactly the shown note, once, to homie.rocks', async ($, on) => {
    const w = world(on, { feed: null, files: PIN, http: SENT })
    await start($)
    await run($, 'The deploy step was confusing')
    const ui = await $.ui.mount(tellPane())
    await ui.input({ key: 'tell-email', text: MAIL })
    await ui.press({ key: 'tell-send' })
    expect(w.log.posted.length).toBe(1)
    const p = w.log.posted[0]
    expect(p.url).toBe(TELL)
    const { pluginVersion: _plugin, ...rest } = p.body
    expect(rest).toEqual({ kind: 'confusing', text: 'The deploy step was confusing', source: 'mod', consent: 'pane', offered: false, app: 'claude-code', studioVersion: '0.27.0', email: MAIL })
    expect(textOf(await ui.drawn())).toContain('Sent to Homie. Thank you. (ref 0f0e0d0c)')
    await ui.press({ key: 'tell-close' })
    expect(w.log.posted.length).toBe(1)
  })

  test('Don\'t send sends nothing; changing the words drafts them again', async ($, on) => {
    const w = world(on, { feed: null, files: PIN, http: SENT })
    await start($)
    await run($, 'first try')
    const ui = await $.ui.mount(tellPane())
    await ui.input({ key: 'tell-words', text: 'The playtest never finished on the phone and I could not tell why.' })
    await ui.select({ key: 'tell-kind', value: 'stuck' })
    const text = textOf(await ui.drawn())
    expect(text).toContain('The playtest never finished on the phone')
    expect(text).toContain('Stuck')
    await ui.press({ key: 'tell-no' })
    expect(textOf(await ui.drawn())).toContain('Not sent. Nothing left this computer.')
    expect(w.log.posted).toEqual([])
  })

  test('where nothing draws, the note is text, and only the person\'s own /feedback send sends it', async ($, on) => {
    const w = world(on, { feed: null, files: PIN, http: SENT, surfaces: [] })
    await start($, { interactive: false })
    const r = await run($, 'Love the setup card!')
    expect(r.text).toContain('Not sent yet. This is exactly what would go')
    expect(r.text).toContain('Love the setup card!')
    expect(r.text).toContain('/feedback send')
    expect((await run($, 'send', 'plugin')).text).toContain('Only the person sends a note')
    expect(w.log.posted).toEqual([])
    const sent = await run($, 'send')
    expect(sent.text).toContain('Sent to Homie')
    expect(w.log.posted.length).toBe(1)
    expect(w.log.posted[0].body.kind).toBe('praise')
    expect(w.log.posted[0].body.consent).toBe('chat')
  })

  test('a refusal from Homie is said plainly, and the note stays to send later', async ($, on) => {
    const w = world(on, { feed: null, files: PIN })
    await start($)
    await run($, 'something')
    const ui = await $.ui.mount(tellPane())
    await ui.press({ key: 'tell-send' })
    expect(w.log.posted.length).toBe(1)
    const text = textOf(await ui.drawn())
    expect(text).toContain('Nothing was sent')
    expect(text).toContain('[Send]')
  })

  test('/feedback alone opens the pane to write one, or puts an ask for Claude in the prompt box for the person to send', async ($, on) => {
    const w = world(on, { feed: null, files: PIN, http: SENT })
    await start($)
    await run($)
    const ui = await $.ui.mount(tellPane())
    expect(textOf(await ui.drawn())).toContain('Ask Claude to draft it from this session')
    await ui.press({ key: 'tell-draft' })
    expect(w.log.filled.length).toBe(1)
    expect(w.log.filled[0]).toContain('homie_feedback with offered: false')
    expect(w.log.filled[0]).toContain('send nothing until I say yes')
    expect(w.log.closed).toContain('homie-tell')
    expect(w.log.posted).toEqual([])
  })

  test('the Studio pane has a Tell Homie button that opens it', async ($, on) => {
    const w = world(on, { feed: null, files: PIN })
    await start($)
    await $.command.run({ command: 'studio', args: '', origin: { kind: 'composer' } })
    const ui = await $.ui.mount(pane('homie-studio', 'terminal'))
    expect(await ui.find({ key: 'tell-homie' })).toBeDefined()
    await ui.press({ key: 'tell-homie' })
    expect(w.log.opened).toContain('homie-tell')
  })
})

const TOOL = 'mcp__plugin_homie_homie__homie_feedback'
const note = { kind: 'confusing', text: 'The deploy asked for a workers.dev subdomain and I did not know what that was.', step: 'studio-setup: put it online', offered: true }
const answered = (e: any) => (e.tool === TOOL ? { result: { content: [{ type: 'text', text: e.action === 'send' ? 'Sent to Homie' : 'Nothing has been sent' }], structuredContent: { kind: 'feedback', state: e.action === 'send' ? 'sent' : 'draft', draft: 'fd_0123456789abcdef01234567', note: { ...note, studioVersion: e.studioVersion, pluginVersion: e.pluginVersion, app: e.app, email: null } } } } : { result: { stdout: '' } })

describe('homie_feedback from Claude', () => {
  test('a draft gets the studio\'s facts and the word that Claude Code will ask; nothing is asked yet', async ($, on) => {
    const seen: any[] = []
    const w = world(on, { feed: null, files: PIN, tool: (e) => { seen.push(e); return answered(e) } })
    await start($)
    const r = await $.tool.call({ tool: TOOL, ...note })
    expect(seen[0].studioVersion).toBe('0.27.0')
    expect(seen[0].app).toBe('claude-code')
    expect(r.context.join(' ')).toContain('Claude Code shows them the exact note with Send and Don')
    expect(w.log.asked).toEqual([])
  })

  test('a send waits for Send in Claude Code\'s own question, with the note\'s words; Send lets it through', async ($, on) => {
    const seen: any[] = []
    const w = world(on, { feed: null, files: PIN, ask: 'Send', tool: (e) => { seen.push(e); return answered(e) } })
    await start($)
    await $.tool.call({ tool: TOOL, ...note })
    const r = await $.tool.call({ tool: TOOL, ...note, action: 'send', draft: 'fd_0123456789abcdef01234567' })
    expect(w.log.asked[0]).toContain('Send this note to Homie?')
    expect(seen.length).toBe(2)
    expect(seen[1].by).toBe('dialog')
    expect(seen[1].studioVersion).toBe('0.27.0')
    expect(r.result).toBeDefined()
    // Answered once: another offer in this session is refused before it reaches the tool.
    const again = await $.tool.call({ tool: TOOL, ...note, text: 'Another thing.' })
    expect(again.deny).toContain('at most once a session')
    expect(seen.length).toBe(2)
    // The person asking themselves is not an offer.
    await $.tool.call({ tool: TOOL, ...note, text: 'Another thing.', offered: false })
    expect(seen.length).toBe(3)
  })

  for (const ask of ['Don’t send', null, 'make it shorter']) {
    test(`${ask === null ? 'a dismissed question (or nobody to ask)' : `"${ask}"`} sends nothing`, async ($, on) => {
      const seen: any[] = []
      const w = world(on, { feed: null, files: PIN, ask, tool: (e) => { seen.push(e); return answered(e) } })
      await start($)
      const r = await $.tool.call({ tool: TOOL, ...note, action: 'send', draft: 'fd_0123456789abcdef01234567' })
      expect(r.deny).toContain('Nothing was sent')
      expect(seen.length).toBe(0)
      expect(w.log.asked.length).toBe(1)
      if (ask === 'make it shorter') expect(r.deny).toContain('they wrote: "make it shorter"')
    })
  }

  test('an offer nobody answered is reworded a few times, then no more', async ($, on) => {
    const seen: any[] = []
    world(on, { feed: null, files: PIN, tool: (e) => { seen.push(e); return answered(e) } })
    await start($)
    for (const text of ['One.', 'Two.', 'Three.']) expect((await $.tool.call({ tool: TOOL, ...note, text })).result).toBeDefined()
    const fourth = await $.tool.call({ tool: TOOL, ...note, text: 'Four.' })
    expect(fourth.deny).toContain('offered several times')
    expect(seen.length).toBe(3)
    expect((await $.tool.call({ tool: TOOL, ...note, text: 'Mine.', offered: false })).result).toBeDefined()
  })

  test('the question shows the note above Claude Code\'s dialog', async ($, on) => {
    let release: (v: unknown) => void = () => {}
    const asked: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => new Promise((resolve) => { asked.push(e.questions[0].question); release = () => resolve({ result: { answers: { [e.questions[0].question]: 'Don’t send' } } }) }))
    world(on, { feed: null, files: PIN, tool: answered })
    await start($)
    const held = $.tool.call({ tool: TOOL, ...note, action: 'send', draft: 'fd_0123456789abcdef01234567' })
    for (let i = 0; i < 20 && !asked.length; i++) await new Promise((r) => setTimeout(r, 5))
    const ui = await $.ui.mount({ plugin: 'homie', component: 'AskUserQuestion', requestId: 'q1', surface: 'terminal', viewport: { columns: 120, rows: 40, isFullscreen: false }, props: { tool: 'AskUserQuestion', questions: [{ question: asked[0], header: 'Homie', options: [{ label: 'Send' }, { label: 'Don’t send' }], multiSelect: false }] } })
    const text = textOf(await ui.drawn())
    expect(text).toContain('Tell Homie: send this note?')
    expect(text).toContain('The deploy asked for a worke')
    release(null)
    expect((await held).deny).toContain('Nothing was sent')
  })

  test('the result is drawn as the note, natively', async ($, on) => {
    world(on, { feed: null, files: PIN })
    await start($)
    const ui = await $.ui.mount({ plugin: 'homie', component: 'ToolResult', requestId: 't1', surface: 'terminal', viewport: { columns: 120, rows: 40, isFullscreen: false }, props: { tool: TOOL, isErrored: false, output: { structuredContent: { kind: 'feedback', state: 'draft', draft: 'fd_x', note: { ...note, app: 'claude-code' }, with: 'the step (studio-setup: put it online) · Claude Code · that Claude offered it. No reply address.' } } } })
    const text = textOf(await ui.drawn())
    expect(text).toContain('A note to Homie (not sent yet)')
    expect(text).toContain('workers.dev subdomain')
    expect(text).toContain('Claude Code asks you')
  })
})
