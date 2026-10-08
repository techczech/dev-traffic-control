import { describe, expect, test } from 'claude-code/testing'

import { BOUND_READ_MARK, BOUND_READ_PROGRAM, BOUND_READ_SCRIPT, BOUND_READ_TIMEOUT_MS, boundReadArgv, boundReadVia, parseBoundFacts } from './bound-read'
import { confinedTo } from './guard'

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

/** The helper's nine lines for a file it found untouched. */
const answer = (over: Partial<Record<'mark' | 'root' | 'parent' | 'opened' | 'read' | 'rootAfter' | 'parentAfter' | 'leaf' | 'text', string>> = {}) =>
  [
    over.mark ?? BOUND_READ_MARK,
    over.root ?? b64('/real/records'),
    over.parent ?? b64('/real/records/příklad'),
    over.opened ?? 'file 16777233 4242 9 1',
    over.read ?? '9 1',
    over.rootAfter ?? `p ${b64('/real/records')}`,
    over.parentAfter ?? `p ${b64('/real/records/příklad')}`,
    over.leaf ?? 'file 16777233 4242',
    over.text ?? b64('{"ok":1}'),
  ].join('\n') + '\n'

describe('the helper\'s answer is read strictly', () => {
  test('an untouched file: every fact, paths and content decoded as UTF-8', () => {
    expect(parseBoundFacts(answer())).toEqual({
      rootBefore: '/real/records',
      parentBefore: '/real/records/příklad',
      opened: { kind: 'file', dev: '16777233', ino: '4242', size: 9, nlink: 1 },
      bytes: 9,
      text: '{"ok":1}',
      rootAfter: '/real/records',
      parentAfter: '/real/records/příklad',
      leaf: { kind: 'file', dev: '16777233', ino: '4242' },
    })
  })
  test('no content asked for or none allowed, a path that no longer resolves, a leaf that is gone or a link', () => {
    expect(parseBoundFacts(answer({ read: '0 0', text: '' }))?.text).toBe(null)
    expect(parseBoundFacts(answer({ read: '0 1', text: '' }))?.text).toBe('')
    expect(parseBoundFacts(answer({ parentAfter: 'gone' }))?.parentAfter).toBe(null)
    expect(parseBoundFacts(answer({ rootAfter: 'gone' }))?.rootAfter).toBe(null)
    expect(parseBoundFacts(answer({ leaf: 'gone' }))?.leaf).toBe(null)
    expect(parseBoundFacts(answer({ leaf: 'link 1 2' }))?.leaf).toEqual({ kind: 'link', dev: '1', ino: '2' })
    expect(parseBoundFacts(answer({ opened: 'other 1 2 0 1', read: '0 0', text: '' }))?.opened.kind).toBe('other')
    expect(parseBoundFacts(answer({ opened: 'file 1 2 9 2', read: '0 0', text: '' }))?.opened.nlink).toBe(2)
  })
  test('anything else is not an answer', () => {
    const bad = [
      undefined,
      null,
      7,
      '',
      'SECRET',
      answer().trimEnd(),
      `${answer()}extra\n`,
      answer({ mark: 'dtc-inbox-bound-read 1' }),
      answer({ opened: 'file 16777233 4242 9' }),
      answer({ opened: 'file 1 2 3 x' }),
      answer({ root: 'not base64!' }),
      answer({ root: '' }),
      answer({ parent: b64('') }),
      answer({ opened: 'file 1 2' }),
      answer({ opened: 'file 1 2 3 4 5' }),
      answer({ opened: 'link 1 2 3 1' }),
      answer({ opened: 'file -1 2 3 1' }),
      answer({ opened: 'file 1 2 1e3 1' }),
      answer({ read: '9' }),
      answer({ read: '9 2' }),
      answer({ read: 'x 1' }),
      answer({ rootAfter: b64('/real/records') }),
      answer({ parentAfter: 'p ???' }),
      answer({ leaf: 'file 1' }),
      answer({ leaf: 'socket 1 2' }),
      answer({ read: '0 0' }),
      answer({ text: '%%%' }),
    ]
    for (const out of bad) expect(parseBoundFacts(out)).toBe(null)
  })
})

describe('how the helper is run', () => {
  const req = { root: '/h/records', parent: '/h/records/example-app', name: '2026-01-15-check.report.json', maxBytes: 4096, wantText: true }
  test('one fixed program by absolute path, the fixed script, then the request as plain arguments', () => {
    expect(boundReadArgv(req)).toEqual([BOUND_READ_PROGRAM, '-e', BOUND_READ_SCRIPT, '--', '/h/records', '/h/records/example-app', '2026-01-15-check.report.json', '4096', '1'])
    expect(BOUND_READ_PROGRAM).toBe('/usr/bin/perl')
    expect(boundReadArgv({ ...req, maxBytes: Number.NaN, wantText: false }).slice(-2)).toEqual(['0', '0'])
    expect(boundReadArgv({ ...req, maxBytes: 10.9 }).slice(-2)).toEqual(['10', '1'])
  })
  test('the script takes no text from the request: it opens no-follow and reads the descriptor', () => {
    expect(BOUND_READ_SCRIPT).toContain('O_NOFOLLOW')
    expect(BOUND_READ_SCRIPT).toContain('sysopen(my $fh, $path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)')
    expect(BOUND_READ_SCRIPT).toContain('stat($fh)')
    expect(BOUND_READ_SCRIPT).toContain('sysread($fh')
    expect(BOUND_READ_SCRIPT).toContain('lstat($path)')
    // Content is read only from a file with one name.
    expect(BOUND_READ_SCRIPT).toContain('$s[3] == 1')
    expect(BOUND_READ_SCRIPT).not.toContain(req.root)
  })
  test('a clean exit with the helper\'s answer gives facts; anything else gives none', async () => {
    const seen: Array<{ argv: string[]; timeoutMs: number }> = []
    const ok = boundReadVia(async (argv, timeoutMs) => {
      seen.push({ argv, timeoutMs })
      return { exitCode: 0, stdout: answer(), stderr: '', isStdoutTruncated: false }
    })
    expect((await ok(req))?.text).toBe('{"ok":1}')
    expect(seen).toEqual([{ argv: boundReadArgv(req), timeoutMs: BOUND_READ_TIMEOUT_MS }])
    const none = [
      async () => ({ exitCode: 4, stdout: '' }),
      async () => ({ exitCode: 0, stdout: answer(), isStdoutTruncated: true }),
      async () => ({ exitCode: 0, stdout: 'something else' }),
      async () => ({ stdout: answer() }),
      async () => null as never,
      async () => Promise.reject(new Error('failed to start: ENOENT')),
    ]
    for (const run of none) expect(await boundReadVia(run)(req)).toBe(null)
  })
  test('no helper on this machine: every confined read is "could not read"', async () => {
    const missing = boundReadVia(async () => Promise.reject(new Error('failed to start: ENOENT')))
    const c = confinedTo('/h/records', { stat: async () => ({ kind: 'dir', realPath: '/h/records' }), bound: missing })
    expect(await c.read('/h/records/example-app/2026-01-15-check.report.json')).toBe(null)
    expect(await c.isFile('/h/records/example-app/2026-01-15-check.report.json')).toBe(false)
  })
  test('facts from the helper are still judged: a folder that resolved elsewhere reads nothing', async () => {
    const elsewhere = boundReadVia(async () => ({ exitCode: 0, stdout: answer({ root: b64('/h/records'), rootAfter: `p ${b64('/h/records')}`, parent: b64('/Users/someone'), parentAfter: `p ${b64('/Users/someone')}` }) }))
    const c = confinedTo('/h/records', { stat: async () => null, bound: elsewhere })
    expect(await c.read('/h/records/example-app/a.report.json')).toBe(null)
    const inside = boundReadVia(async () => ({ exitCode: 0, stdout: answer({ root: b64('/h/records'), rootAfter: `p ${b64('/h/records')}`, parent: b64('/h/records/example-app'), parentAfter: `p ${b64('/h/records/example-app')}` }) }))
    expect(await confinedTo('/h/records', { stat: async () => null, bound: inside }).read('/h/records/example-app/a.report.json')).toBe('{"ok":1}')
  })
  test('a file the helper reports with two names is refused, even when the helper handed content over', async () => {
    const here = { root: b64('/h/records'), rootAfter: `p ${b64('/h/records')}`, parent: b64('/h/records/example-app'), parentAfter: `p ${b64('/h/records/example-app')}` }
    const linked = boundReadVia(async () => ({ exitCode: 0, stdout: answer({ ...here, opened: 'file 16777233 4242 9 2' }) }))
    const c = confinedTo('/h/records', { stat: async () => null, bound: linked })
    expect(await c.read('/h/records/example-app/a.report.json')).toBe(null)
    expect(await c.isFile('/h/records/example-app/a.report.json')).toBe(false)
  })
})
