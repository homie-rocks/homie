/**
 * A studio as the Homie mod sees it, for `claude plugin test`: its files, its sites' answers, the studio CLI's JSON,
 * and stubs for every mods API call the mod makes. Nothing runs and nothing reaches a network.
 */
import { mock } from 'claude-code/testing'

export const ROOT = '/work/night-owls'
export const LIVE = 'https://night-owls.example'
export const DEV = 'http://127.0.0.1:8787'
export const BUILD = '20261002t100000-abc123'

// A 4x2 RGB picture: what @homie-rocks/studio 0.21.0 keeps beside a feed for the mod.
const RGB = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 10, 10, 10, 200, 200, 200, 0, 255, 255, 255, 0, 255])
const b64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s) }

export function feedDoc(over: Record<string, unknown> = {}) {
  return {
    v: 1, kind: 'homie-studio-progress', build: BUILD, what: 'game', id: 'owl-rush', title: 'Owl Rush: faster rounds', studio: 'Night Owls',
    state: 'running', stage: 'checks', startedAt: '2026-10-02T10:00:00.000Z', updatedAt: '2026-10-02T10:03:00.000Z', endedAt: null,
    stages: [
      { id: 'plan', label: 'Plan', state: 'done', note: '' }, { id: 'build', label: 'Build', state: 'done', note: '' },
      { id: 'checks', label: 'Checks', state: 'running', note: '' }, { id: 'deploy', label: 'Deploy', state: 'pending', note: '' },
    ],
    checks: [
      { id: 'computer-seated', label: 'Computer seated', stage: 'checks', state: 'pass', ms: 2100, note: 'seat 0, host' },
      { id: 'phone-seated', label: 'Phone seated', stage: 'checks', state: 'pass', ms: 2400, note: '' },
      { id: 'round', label: 'A round finished', stage: 'checks', state: 'running', ms: null, note: '' },
    ],
    preview: { url: `${DEV}/owl-rush/play`, image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', caption: 'Round 1', at: '2026-10-02T10:02:30.000Z' },
    spend: { unit: 'usd', used: 0.4, budget: 2, items: [] }, stop: { requested: false, at: null, by: null },
    log: [{ at: '2026-10-02T10:02:00.000Z', text: 'Checks: running' }], error: null,
    ...over,
  }
}

export const STUDIO = {
  name: 'Night Owls', slug: 'night-owls',
  cloudflare: { worker: 'night-owls', d1: 'night-owls-db', domain: 'night-owls.example', created: ['worker:night-owls', 'd1:night-owls-db'] },
  protect: ['games/*/game.json', 'site/theme.json'], budget: { usd: 1, credits: 500 },
}

export const ROOMS = {
  ok: true, playing: 3,
  rooms: [{ game: 'owl-rush', name: 'Owl Rush', label: 'Room 3', room: 'pub-3', players: 3, max: 8, play: '/owl-rush/play?room=pub-3', watch: '/owl-rush/watch?room=pub-3', ai: 1, server: null, policy: 'open' }],
}

export const OFFICE = {
  ok: true, command: 'office', studio: 'Night Owls', site: LIVE, playing: 3,
  games: [{ id: 'owl-rush', name: 'Owl Rush', launch: 'public', maxPlayers: 8, rooms: [{ room: 'pub-3', label: 'Room 3', public: true, players: 3, max: 8, bots: 4, clients: [
    { id: 'c1', seat: 0, name: 'Mika', device: 'phone', role: 'host', as: 'guest', muted: false, joinedAt: 0 },
    { id: 'c2', seat: 1, name: 'Owlbert', device: 'computer', role: 'replica', as: 'guest', muted: false, joinedAt: 0 },
  ] }] }],
}

export const CODEX = `---
tagline: "Swoop, grab, get knocked off."
---

# Owl Rush

A night-time gem scramble for up to eight owls.

## Latest

- 2026-10-02: faster rounds

## Concept

Swoop and grab moonstones.

## Art direction

## Open questions

- Should a knocked owl drop every stone?

## Milestones

- [x] Step 1: a working copy
- [ ] Step 2: one small change
`

export type World = { clock: ReturnType<typeof mock.clock>; log: Record<string, any[]>; files: Map<string, string>; store: Map<string, unknown> }

export function world(on: any, opts: {
  surfaces?: string[]; cwd?: string; inStudio?: boolean; feed?: Record<string, unknown> | null; files?: Record<string, string>;
  run?: (argv: readonly string[], init?: any) => { exitCode: number; stdout: string; stderr: string } | null;
  ask?: string | null; tool?: (e: any) => any; agents?: any[]; panes?: any[] | null; http?: Record<string, unknown>; options?: Record<string, unknown>;
  spawn?: (req: any) => AsyncGenerator<any, any, any>; register?: (e: any) => void; open?: (e: any) => any;
  sizes?: Record<string, number>;
} = {}): World {
  const clock = mock.clock(on)
  const log: Record<string, any[]> = { toasts: [], logs: [], opened: [], closed: [], asked: [], blits: [], fetched: [], posted: [], ran: [], spawned: [], stored: [], tools: [], filled: [] }
  const files = new Map<string, string>()
  const bytes = new Map<string, string>()
  const store = new Map<string, unknown>()
  const inStudio = opts.inStudio !== false
  if (inStudio) {
    files.set(`${ROOT}/studio.json`, JSON.stringify(STUDIO))
    files.set(`${ROOT}/.studio/local.json`, JSON.stringify({ deployedAt: '2026-10-01T10:00:00.000Z' }))
    files.set(`${ROOT}/node_modules/@homie-rocks/studio/bin/homie-studio.mjs`, '// the toolkit')
    files.set(`${ROOT}/.wrangler/homie-dev.json`, JSON.stringify({ port: 8787, pid: 1 }))
    files.set(`${ROOT}/games/owl-rush/game.json`, JSON.stringify({ id: 'owl-rush', name: 'Owl Rush', blurb: 'Swoop, grab, get knocked off.' }))
    files.set(`${ROOT}/games/owl-rush/CODEX.md`, CODEX)
    files.set(`${ROOT}/art/cover/budget.json`, JSON.stringify({ provider: 'fal', unit: 'usd', cap: 0.5, spent: 0.3, calls: [] }))
    if (opts.feed !== null) {
      files.set(`${ROOT}/.studio/progress/current`, `${BUILD}\n`)
      files.set(`${ROOT}/.studio/progress/${BUILD}.json`, JSON.stringify(feedDoc(opts.feed ?? {})))
      bytes.set(`${ROOT}/.studio/progress/${BUILD}.preview.4x2.rgb`, b64(RGB))
    }
  }
  for (const [k, v] of Object.entries(opts.files ?? {})) files.set(k, v)
  const dirOf = (p: string) => {
    const kids = new Map<string, any>()
    for (const f of [...files.keys(), ...bytes.keys()]) {
      if (!f.startsWith(`${p}/`)) continue
      const rest = f.slice(p.length + 1)
      const name = rest.split('/')[0]
      kids.set(name, { name, kind: rest.includes('/') ? 'dir' : 'file', size: 1, mtimeMs: 1000, isLink: false })
    }
    return kids.size ? [...kids.values()] : null
  }
  const http: Record<string, unknown> = {
    [`${LIVE}/api/rooms`]: ROOMS, [`${LIVE}/api/games`]: { games: [{ id: 'owl-rush' }] },
    [`${DEV}/api/games`]: { games: [{ id: 'owl-rush' }] }, [`${DEV}/api/rooms`]: { ok: true, playing: 0, rooms: [] },
    'https://arcade.homie.rocks/api/games': { games: [{ id: 'bone-burglar', name: 'Bone Burglar' }, { id: '2048-race', name: '2048 Race' }] },
    ...(opts.http ?? {}),
  }
  const cwd = opts.cwd ?? (inStudio ? ROOT : '/work/elsewhere')
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', ($: any, e: any) => { opts.register?.(e); return { value: { command: e.name } } })
  on('session.cwd', () => ({ value: cwd }))
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('fs.exists', ($: any, e: any) => ({ value: files.has(e.path) || bytes.has(e.path) || Boolean(dirOf(e.path)) }))
  on('fs.read', ($: any, e: any) => {
    if (e.as === 'bytes' && bytes.has(e.path)) return { value: { base64: bytes.get(e.path) } }
    if (files.has(e.path)) return { value: files.get(e.path) }
    return { deny: `ENOENT: ${e.path}` }
  })
  on('fs.list', ($: any, e: any) => { const d = dirOf(e.path); return d ? { value: d } : { deny: `ENOENT: ${e.path}` } })
  // A file's size is 1 byte unless `sizes` says otherwise (a big model, for the raw-file guard).
  on('fs.stat', ($: any, e: any) => (files.has(e.path) || bytes.has(e.path) ? { value: { kind: 'file', size: opts.sizes?.[e.path] ?? 1, mtimeMs: 2000, isLink: false, ...(e.resolve ? { realPath: e.path } : {}) } } : { deny: 'ENOENT' }))
  on('http.fetch', ($: any, e: any) => {
    log.fetched.push(e.init?.socketPath ? `${e.url} via ${e.init.socketPath} ${e.init.body ?? ''}` : e.url)
    if (e.init?.method === 'POST' && !e.init?.socketPath) log.posted.push({ url: e.url, body: JSON.parse(e.init.body ?? 'null'), headers: e.init.headers })
    if (e.init?.socketPath) return { value: { status: 200, ok: true, headers: {}, text: '{"ok":true}' } }
    const h = http[e.url]
    return h ? { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(h) } } : { value: { status: 404, ok: false, headers: {}, text: 'not found' } }
  })
  on('process.run', ($: any, e: any) => {
    log.ran.push([...e.argv])
    const r = opts.run?.(e.argv, e.init)
    if (r) return { value: r }
    const a = e.argv.join(' ')
    if (/ office kick /.test(a)) return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true, command: 'office kick', asked: true, what: 'Kick Owlbert from Owl Rush Room 3 for 10 minutes.', link: `${LIVE}/_studio/signin?k=hsk_${'a'.repeat(48)}&to=%2F_studio%2Fconfirm%2Fask_0123456789abcdef` }), stderr: '' } }
    if (/ office mute /.test(a)) return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true, command: 'office mute', asked: true, what: 'Mute Mika in Owl Rush Room 3 for 10 minutes.', link: `${LIVE}/_studio/signin?k=hsk_${'b'.repeat(48)}` }), stderr: '' } }
    if (/ office launch /.test(a)) return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true, command: 'office launch', asked: true, what: 'Make Owl Rush an invite-only beta.', link: `${LIVE}/_studio/signin?k=hsk_${'c'.repeat(48)}` }), stderr: '' } }
    if (/ office announce /.test(a)) return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true, command: 'office announce', people: 3, rooms: 1 }), stderr: '' } }
    if (/ office --json$/.test(a)) return { value: { exitCode: 0, stdout: JSON.stringify(OFFICE), stderr: '' } }
    if (/ stats /.test(a)) return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true, command: 'stats', totals: { visits: 120, plays: 48, rooms: 9, rounds: 30, peakPlayers: 6, playingNow: 3 }, days: [{ plays: 1, visits: 4 }, { plays: 9, visits: 20 }], games: [{ id: 'owl-rush', plays: 48, rounds: 30, peakPlayers: 6, playingNow: 3, visits: 100, rooms: 9 }], crossings: { fromHub: 12, fromStudios: 2, fromSearch: 1, fromWeb: 5 }, referrers: [] }), stderr: '' } }
    if (/ codex link /.test(a)) return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true, command: 'codex link', link: `${LIVE}/_studio/signin?k=hsk_${'d'.repeat(48)}&to=%2F_studio%2Fcodex%2Fowl-rush%2F` }), stderr: '' } }
    if (/ progress stop /.test(a)) return { value: { exitCode: 0, stdout: '{"ok":true}', stderr: '' } }
    if (e.argv[0] === 'git') {
      if (e.argv.includes('rev-parse')) return { value: { exitCode: 0, stdout: 'f00dfeed\n', stderr: '' } }
      if (e.argv.includes('log')) return { value: { exitCode: 0, stdout: 'abc1234 Faster rounds\ndef5678 A new owl\n', stderr: '' } }
      if (e.argv.includes('status')) return { value: { exitCode: 0, stdout: ' M games/owl-rush/src/main.ts\n', stderr: '' } }
      if (e.argv.includes('diff')) return { value: { exitCode: 0, stdout: ' 3 files changed, 40 insertions(+), 5 deletions(-)\n', stderr: '' } }
    }
    if (/art\.mjs gen .*--dry-run/.test(a)) return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true, command: 'gen', dryRun: true, price: { usd: 0.25, basis: '1 image at $0.25' } }), stderr: '' } }
    return { value: { exitCode: 0, stdout: '{}', stderr: '' } }
  })
  on('process.spawn', opts.spawn ?? (async function* ($: any, e: any) { log.spawned.push(e.argv); return { code: 0, signal: null } }))
  on('store.get', ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: any) => { store.set(e.key, e.value); log.stored.push(e.key); return { value: undefined } })
  on('ui.toast', ($: any, e: any) => { log.toasts.push(e.text); return { value: undefined } })
  on('ui.log', ($: any, e: any) => { log.logs.push(e.text); return { value: undefined } })
  on('ui.open', ($: any, e: any) => { log.opened.push(e.id); return { value: opts.open?.(e) ?? { isPlaced: true } } })
  on('ui.close', ($: any, e: any) => { log.closed.push(e.id); return { value: undefined } })
  if (opts.panes !== null) on('ui.panes', () => ({ value: opts.panes ?? log.opened.map((id) => ({ id, title: id, isShown: true, isFocused: true, isPlaced: true })) }))
  on('ui.blit', ($: any, e: any) => { log.blits.push(e); return { value: {} } })
  on('agent.list', () => ({ value: opts.agents ?? [] }))
  on('prompt.fill', ($: any, e: any) => { log.filled.push(e.text); return { isFilled: true, box: { text: e.text, cursor: e.text.length } } })
  on('tool.call', ($: any, e: any) => {
    log.tools.push(e.tool)
    if (e.tool === 'AskUserQuestion') {
      const q = e.questions[0].question
      log.asked.push(q)
      if (opts.ask === null) return { deny: 'dismissed' }
      return { result: { answers: { [q]: opts.ask ?? 'Proceed' } } }
    }
    return opts.tool ? opts.tool(e) : { result: { stdout: 'ran', stderr: '', interrupted: false } }
  })
  // What Claude Code draws at a site the mod passes on; its question dialog is an engine node the mod must keep.
  on('ui.render', ($: any, e: any) => (e.component === 'AskUserQuestion' ? { type: 'engine', ref: 1 } : { type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  return { clock, log, files, store }
}

/** Fire session.start the way Claude Code does at launch. */
export async function start($: any, { surface = 'terminal', interactive = true, cwd = ROOT } = {}) {
  await $.session.start({ surface, isInteractive: interactive, cwd })
}

export const pane = (requestId: string, surface: 'terminal' | 'desktop', bodyColumns = 90) => ({
  plugin: 'homie', component: 'Pane', requestId, surface, viewport: { columns: 160, rows: 48, isFullscreen: true },
  props: { title: requestId, isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 44 }, view: {} },
}) as const

export const bandSite = (surface: 'terminal' | 'desktop', bodyColumns = 140) => ({
  plugin: 'homie', component: 'AbovePrompt', requestId: 'band', surface, viewport: { columns: 160, rows: 48, isFullscreen: false },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
}) as const

/** Every string in a drawn tree, joined: what a person would read. */
export function textOf(node: any): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  const own = node.props?.label && node.type !== 'Link' ? `[${node.props.label}]` : node.type === 'Link' ? `${node.props?.label ?? ''}<${node.props?.href}>` : ''
  return own + textOf(node.children ?? [])
}
