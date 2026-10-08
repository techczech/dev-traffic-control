// The read helper against a real file system and a real process: what the host's test sandbox
// cannot give. Run with `npm test` (vitest), never by `claude plugin test`.

import { execFile, execFileSync, spawn } from 'node:child_process'
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { BOUND_READ_PROGRAM, BOUND_READ_SCRIPT, boundReadVia } from '../hooks/bound-read'
import type { RunResult } from '../hooks/bound-read'
import { MAX_FILE_BYTES, confinedTo } from '../hooks/guard'
import type { ConfineStat } from '../hooks/guard'

const hasHelper = process.platform !== 'win32' && existsSync(BOUND_READ_PROGRAM)

/** `$.process.run`, as the host runs it: no shell, the output captured. */
const run = (argv: string[], timeoutMs: number): Promise<RunResult> =>
  new Promise(resolve => {
    const [program, ...args] = argv as [string, ...string[]]
    execFile(program, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      const code = err === null ? 0 : typeof err.code === 'number' ? err.code : 1
      resolve({ exitCode: code, stdout, isStdoutTruncated: false })
    })
  })

/** `$.fs.stat(path, { resolve: true })`, as the host answers it. */
const stat = async (path: string): Promise<ConfineStat | null> => {
  try {
    const own = lstatSync(path)
    const target = statSync(path)
    return { kind: target.isFile() ? 'file' : target.isDirectory() ? 'dir' : 'other', size: target.size, isLink: own.isSymbolicLink(), realPath: realpathSync(path) }
  } catch {
    return null
  }
}

describe.skipIf(!hasHelper)('the read helper on a real disk', () => {
  let base = ''
  let root = ''
  let outside = ''
  const confined = () => confinedTo(root, { stat, bound: boundReadVia(run) })

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'dtc-inbox-bound-'))
    root = join(base, 'records')
    outside = join(base, 'outside')
    mkdirSync(join(root, 'example-app', 'round-1'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(join(root, 'example-app', 'a.report.json'), '{"title":"Příklad"}')
    writeFileSync(join(root, 'example-app', 'round-1', 'b.report.json'), '{"ok":2}')
    writeFileSync(join(root, 'example-app', 'empty.md'), '')
    writeFileSync(join(outside, 'secret.json'), 'SECRET')
    writeFileSync(join(outside, 'a.report.json'), 'SECRET')
  })
  afterAll(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

  test('a regular file inside the folder reads, as UTF-8; an empty one reads as empty', async () => {
    const c = confined()
    expect(await c.read(join(root, 'example-app', 'a.report.json'))).toBe('{"title":"Příklad"}')
    expect(await c.read(join(root, 'example-app', 'round-1', 'b.report.json'))).toBe('{"ok":2}')
    expect(await c.read(join(root, 'example-app', 'empty.md'))).toBe('')
    expect(await c.isFile(join(root, 'example-app', 'a.report.json'))).toBe(true)
  })

  test('a link at the leaf is not opened, wherever it points', async () => {
    symlinkSync(join(outside, 'secret.json'), join(root, 'example-app', 'out.report.json'))
    symlinkSync(join(root, 'example-app', 'a.report.json'), join(root, 'example-app', 'in.report.json'))
    const c = confined()
    // A read by pathname would follow it.
    expect(readFileSync(join(root, 'example-app', 'out.report.json'), 'utf8')).toBe('SECRET')
    expect(await c.read(join(root, 'example-app', 'out.report.json'))).toBe(null)
    expect(await c.isFile(join(root, 'example-app', 'out.report.json'))).toBe(false)
    expect(await c.read(join(root, 'example-app', 'in.report.json'))).toBe(null)
  })

  test('a folder that is a link is not read through, out of the root or inside it', async () => {
    symlinkSync(outside, join(root, 'linked-out'))
    symlinkSync(join(root, 'example-app'), join(root, 'linked-in'))
    const c = confined()
    expect(readFileSync(join(root, 'linked-out', 'secret.json'), 'utf8')).toBe('SECRET')
    expect(await c.read(join(root, 'linked-out', 'secret.json'))).toBe(null)
    expect(await c.isFile(join(root, 'linked-out', 'secret.json'))).toBe(false)
    expect(await c.read(join(root, 'linked-in', 'a.report.json'))).toBe(null)
  })

  test('a hard link is not read: a second name for an outside file, and a record with a second name', async () => {
    const dir = join(root, 'example-app')
    linkSync(join(outside, 'secret.json'), join(dir, 'hard.report.json'))
    writeFileSync(join(dir, 'twice.report.json'), '{"ok":3}')
    const c = confined()
    // It is a regular file to every ordinary check, and a read by pathname returns the outside content.
    expect(lstatSync(join(dir, 'hard.report.json')).isFile()).toBe(true)
    expect(readFileSync(join(dir, 'hard.report.json'), 'utf8')).toBe('SECRET')
    expect(await c.read(join(dir, 'hard.report.json'))).toBe(null)
    expect(await c.isFile(join(dir, 'hard.report.json'))).toBe(false)
    // The helper itself hands no content over for it.
    const raw = await run([BOUND_READ_PROGRAM, '-e', BOUND_READ_SCRIPT, '--', root, dir, 'hard.report.json', '4096', '1'], 5000)
    expect(String(raw.stdout)).not.toContain(Buffer.from('SECRET').toString('base64'))
    expect(await c.read(join(dir, 'twice.report.json'))).toBe('{"ok":3}')
    linkSync(join(dir, 'twice.report.json'), join(dir, 'twice-again.report.json'))
    expect(await c.read(join(dir, 'twice.report.json'))).toBe(null)
    expect(await c.read(join(dir, 'twice-again.report.json'))).toBe(null)
  })

  test('the root itself may be a link', async () => {
    const alias = join(base, 'records-alias')
    symlinkSync(root, alias)
    const c = confinedTo(alias, { stat, bound: boundReadVia(run) })
    expect(await c.read(join(alias, 'example-app', 'a.report.json'))).toBe('{"title":"Příklad"}')
  })

  test('a file over the cap, a folder, a missing file and a named pipe read nothing, and the pipe does not hold the read', async () => {
    writeFileSync(join(root, 'example-app', 'big.report.json'), 'x'.repeat(5000))
    execFileSync('mkfifo', [join(root, 'example-app', 'pipe.report.json')])
    const c = confined()
    expect(await c.read(join(root, 'example-app', 'big.report.json'), 4999)).toBe(null)
    expect(await c.read(join(root, 'example-app', 'big.report.json'), 5000)).toHaveLength(5000)
    expect(await c.read(join(root, 'example-app', 'round-1'))).toBe(null)
    expect(await c.read(join(root, 'example-app', 'missing.md'))).toBe(null)
    const started = Date.now()
    expect(await c.read(join(root, 'example-app', 'pipe.report.json'))).toBe(null)
    expect(await c.isFile(join(root, 'example-app', 'pipe.report.json'))).toBe(false)
    expect(Date.now() - started).toBeLessThan(4000)
  })

  test('the largest file the mod reads comes back whole', async () => {
    writeFileSync(join(root, 'example-app', 'max.report.json'), 'y'.repeat(MAX_FILE_BYTES))
    expect(await confined().read(join(root, 'example-app', 'max.report.json'))).toHaveLength(MAX_FILE_BYTES)
  })

  /** Runs a shell loop that keeps swapping things for `ms`, while `read` is called over and over; answers every result. */
  async function underSwapping(script: string, cwd: string, ms: number, read: () => Promise<string | null>): Promise<Array<string | null>> {
    const swapper = spawn('/bin/sh', ['-c', script], { cwd, stdio: 'ignore' })
    const results: Array<string | null> = []
    try {
      const until = Date.now() + ms
      while (Date.now() < until) results.push(...(await Promise.all([read(), read(), read()])))
    } finally {
      const gone = new Promise<void>(resolve => void swapper.once('exit', () => resolve()))
      swapper.kill('SIGKILL')
      await gone
      // Whatever the loop had started when it was stopped finishes within a moment.
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    return results
  }

  test('a process swapping the report for a link to an outside file, as fast as it can: the outside content never comes back', async () => {
    const dir = join(root, 'example-app')
    writeFileSync(join(dir, 'good.json'), '{"ok":1}')
    writeFileSync(join(dir, 'race.report.json'), '{"ok":1}')
    const script = `while :; do ln -s "${join(outside, 'secret.json')}" race.tmp && mv -f race.tmp race.report.json; cp good.json race.tmp && mv -f race.tmp race.report.json; done`
    const c = confined()
    const results = await underSwapping(script, dir, 1500, () => c.read(join(dir, 'race.report.json')))
    expect(results.length).toBeGreaterThan(10)
    expect(results.filter(r => r !== null && r !== '{"ok":1}')).toEqual([])
  }, 20_000)

  test('a process swapping the project folder for a link to an outside folder, as fast as it can: the outside content never comes back', async () => {
    mkdirSync(join(root, 'swapped'))
    writeFileSync(join(root, 'swapped', 'a.report.json'), '{"ok":1}')
    const script = `while :; do mv swapped swapped-real && ln -s "${outside}" swapped; rm swapped && mv swapped-real swapped; done`
    const c = confined()
    const results = await underSwapping(script, root, 1500, () => c.read(join(root, 'swapped', 'a.report.json')))
    expect(results.length).toBeGreaterThan(10)
    expect(results.filter(r => r !== null && r !== '{"ok":1}')).toEqual([])
  }, 20_000)
})
