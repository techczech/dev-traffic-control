import { describe, expect, mock, test } from 'claude-code/testing'

import { BOUND_READ_MARK, BOUND_READ_PROGRAM, BOUND_READ_SCRIPT } from './bound-read'
import { lightReport } from './fixtures'
import { DATA_BEGIN, DATA_END, DATA_PREAMBLE } from './sanitise'

// The mod loaded by the engine, over a records folder held in memory. The session files a request
// (a Write), the finished report appears, the turn ends and the timers run. Whatever reaches the
// host's prompt-submit call is what the mod submitted on its own, and it must be nothing.

const HOME = '/h'
const ROOT = `${HOME}/Documents/Dev Traffic Control`
const CWD = `${HOME}/code/example-app`
const REQUEST = `${ROOT}/example-app/2026-01-15-check.md`
const REPORT = `${ROOT}/example-app/2026-01-15-check.report.json`
const FILED = Date.parse('2026-01-15T09:00:00Z')

type Any = any

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

/** `helper`: what running the read helper does on this machine. `missing`: there is no such program. `link`: every file it is asked for turns out to be a symbolic link. */
function world(on: Any, start: Record<string, string>, helper: 'works' | 'missing' | 'link' = 'works') {
  const files: Record<string, string> = { ...start }
  /** Every prompt submitted through the host while the mod was loaded. */
  const submitted: string[] = []
  /** Every program the mod ran, by its first argument. */
  const ran: string[] = []
  const clock = mock.clock(on, { now: FILED })
  mock.store(on)
  mock.env(on, { HOME })
  const isDir = (path: string) => Object.keys(files).some(p => p.startsWith(`${path}/`))
  // What the engine itself would answer, for the events and calls the mod makes.
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: 's1' }))
  on('session.messages', () => ({ value: [] }))
  on('session.start', (_$: Any, e: Any) => ({ cwd: e.cwd }))
  on('turn.start', (_$: Any, e: Any) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: Any, e: Any) => ({ text: e.answer }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.stat', (_$: Any, e: Any) => {
    const text = files[e.path]
    if (text === undefined && !isDir(e.path)) throw new Error('ENOENT')
    return { value: { kind: text === undefined ? 'dir' : 'file', size: text?.length ?? 0, mtimeMs: clock.now(), isLink: false, ...(e.resolve ? { realPath: e.path } : {}) } }
  })
  on('fs.list', (_$: Any, e: Any) => {
    const seen = new Map<string, Any>()
    for (const [path, text] of Object.entries(files)) {
      if (!path.startsWith(`${e.path}/`)) continue
      const rest = path.slice(e.path.length + 1)
      const slash = rest.indexOf('/')
      const name = slash < 0 ? rest : rest.slice(0, slash)
      seen.set(name, { name, kind: slash < 0 ? 'file' : 'dir', size: slash < 0 ? text.length : 0, mtimeMs: slash < 0 ? 1 : 0, isLink: false })
    }
    return { value: [...seen.values()] }
  })
  // The mod reads no record by pathname: any $.fs.read under the records folder fails the test.
  on('fs.read', (_$: Any, e: Any) => {
    if (String(e.path).startsWith(ROOT)) throw new Error(`a record was read by pathname: ${e.path}`)
    throw new Error('ENOENT')
  })
  // The read helper, answered as the real one answers for a regular file that nothing touched.
  on('process.run', (_$: Any, e: Any) => {
    const [program, flag, script, dashes, root, parent, name, max, want] = e.argv as string[]
    ran.push(String(program))
    if (helper === 'missing') throw new Error('failed to start: ENOENT')
    if (program !== BOUND_READ_PROGRAM || flag !== '-e' || script !== BOUND_READ_SCRIPT || dashes !== '--' || e.argv.length !== 9) throw new Error(`unexpected program: ${String(program)}`)
    const text = files[`${parent}/${name}`]
    if (text === undefined || helper === 'link') return { value: { exitCode: 4, stdout: '', stderr: '', isStdoutTruncated: false } }
    const size = new TextEncoder().encode(text).length
    const reads = want === '1' && size <= Number(max)
    const lines = [BOUND_READ_MARK, b64(String(root)), b64(String(parent)), `file 1 ${size + 1000} ${size} 1`, `${reads ? size : 0} ${reads ? 1 : 0}`, `p ${b64(String(root))}`, `p ${b64(String(parent))}`, `file 1 ${size + 1000}`, reads ? b64(text) : '']
    return { value: { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '', isStdoutTruncated: false } }
  })
  on('tool.call', { tool: 'Write' }, (_$: Any, e: Any) => {
    files[e.file_path] = e.content
    return { result: 'written' }
  })
  on('prompt.submit', (_$: Any, e: Any) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  return { files, submitted, clock, ran }
}

/** The session files the request, the reviewer finishes the report, the turn ends, and two minutes of timers run. */
async function fileAndAnswer($: Any, w: ReturnType<typeof world>): Promise<void> {
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'file a check', turnId: 't1' })
  await $.tool.call({ tool: 'Write', file_path: REQUEST, content: '# Check the export button\n' })
  await w.clock.advance(60_000)
  w.files[REPORT] = lightReport.replace('2026-01-15T09:11:31.520Z', new Date(w.clock.now() - 1000).toISOString())
  await $.turn.complete({ reason: 'answer', answer: 'Filed dtc://open/example-app/2026-01-15-check', durationMs: 60_000, isAborted: false, turnId: 't1' })
  await w.clock.advance(120_000)
}

describe('the mod never submits a prompt', () => {
  test('a whole session (filed, answered, turn ended, ten minutes of timers, the tool called): nothing reaches prompt.submit, and the band counts the answer', async ($: Any, on: Any) => {
    const w = world(on, {})
    await fileAndAnswer($, w)
    await w.clock.advance(600_000)
    expect(w.submitted).toEqual([])
    const ui = await $.ui.mount({ plugin: 'dtc-inbox', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } })
    expect((await ui.find({ type: 'Text', text: /answer/ }))?.text).toBe('DTC — 1 answer waiting · /dtc to list')
    await ui.unmount()
    await $.tool.call({ tool: 'mcp__dtc-inbox__dtc_answers', request: 'dtc://open/example-app/2026-01-15-check' })
    await w.clock.advance(600_000)
    expect(w.submitted).toEqual([])
  })

  test('an option the mod does not have, such as a delivery setting, changes nothing: still nothing is submitted', { options: { delivery: 'auto', livePollSeconds: 5 } }, async ($: Any, on: Any) => {
    const w = world(on, {})
    await fileAndAnswer($, w)
    await w.clock.advance(600_000)
    expect(w.submitted).toEqual([])
  })

  test('the agent reads the answer when it calls dtc_answers, as quoted data', async ($: Any, on: Any) => {
    const w = world(on, {})
    await fileAndAnswer($, w)
    const out = await $.tool.call({ tool: 'mcp__dtc-inbox__dtc_answers', request: 'dtc://open/example-app/2026-01-15-check' })
    const text = String(out.result ?? out.text ?? '')
    expect(text.startsWith(DATA_PREAMBLE)).toBe(true)
    expect(text).toContain(DATA_BEGIN)
    expect(text.trimEnd().endsWith(DATA_END)).toBe(true)
    expect(text).toContain('Slow first open')
    expect(w.submitted).toEqual([])
  })
})

describe('every record is read through the helper, and nothing is read without it', () => {
  test('the only program run to read is the fixed helper', async ($: Any, on: Any) => {
    const w = world(on, {})
    await fileAndAnswer($, w)
    await $.tool.call({ tool: 'mcp__dtc-inbox__dtc_answers', request: 'dtc://open/example-app/2026-01-15-check' })
    expect(w.ran.length).toBeGreaterThan(0)
    expect(new Set(w.ran)).toEqual(new Set([BOUND_READ_PROGRAM]))
  })

  test('no helper on this machine: the answer is not counted, and dtc_answers says it could not be read', async ($: Any, on: Any) => {
    const w = world(on, {}, 'missing')
    await fileAndAnswer($, w)
    const ui = await $.ui.mount({ plugin: 'dtc-inbox', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } }).catch(() => null)
    expect(ui === null ? undefined : (await ui.find({ type: 'Text', text: /answer/ }))?.text).toBe(undefined)
    await ui?.unmount()
    const out = await $.tool.call({ tool: 'mcp__dtc-inbox__dtc_answers', request: 'dtc://open/example-app/2026-01-15-check' })
    expect(JSON.stringify(out)).toContain('could not be read')
    expect(JSON.stringify(out)).not.toContain('Slow first open')
    expect(w.submitted).toEqual([])
  })

  test('the report turns out to be a link: nothing is read', async ($: Any, on: Any) => {
    const w = world(on, {}, 'link')
    await fileAndAnswer($, w)
    const out = await $.tool.call({ tool: 'mcp__dtc-inbox__dtc_answers', request: 'dtc://open/example-app/2026-01-15-check' })
    expect(JSON.stringify(out)).not.toContain('Slow first open')
    expect(w.submitted).toEqual([])
  })
})

describe('a scan is not repeated for files that did not change', () => {
  test('refresh after refresh of an unchanged folder runs the helper no more', async ($: Any, on: Any) => {
    const w = world(on, {})
    await fileAndAnswer($, w)
    const before = w.ran.length
    expect(before).toBeGreaterThan(0)
    // Ten minutes of band refreshes.
    await w.clock.advance(600_000)
    expect(w.ran.length).toBe(before)
    // The report changes (another size): it is read once more, and then no more.
    w.files[REPORT] = `${w.files[REPORT] as string}\n`
    await w.clock.advance(120_000)
    const after = w.ran.length
    expect(after).toBe(before + 1)
    await w.clock.advance(600_000)
    expect(w.ran.length).toBe(after)
  })
})
