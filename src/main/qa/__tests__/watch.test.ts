import { expect, test, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const probeWriteControl = vi.hoisted(() => ({
  block: false,
  started: null as null | (() => void),
  release: null as null | (() => void)
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    // The probe is written through its open descriptor, so the write is held
    // at the descriptor's close: the bytes are down, the call has not returned.
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      if (!String(args[0]).includes('.dtc-watch-ready-')) return handle
      const close = handle.close.bind(handle)
      handle.close = async (): Promise<void> => {
        await close()
        if (!probeWriteControl.block) return
        probeWriteControl.started?.()
        await new Promise<void>((resolve) => {
          probeWriteControl.release = resolve
        })
      }
      return handle
    }
  }
})

import { watchQaRepo, writeProbeToleratingEnoent } from '../watch'

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

test('coalesces a burst of writes into one onChange; stop() silences it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-watch-'))
  await mkdir(path.join(root, 'tangram'), { recursive: true })
  const onChange = vi.fn()
  const watcher = watchQaRepo(root, onChange)
  await watcher.ready

  await writeFile(path.join(root, 'tangram/2026-07-18-a.md'), 'x')
  await writeFile(path.join(root, 'tangram/2026-07-18-a.report.json'), '{}')
  await settle(700)
  expect(onChange).toHaveBeenCalledTimes(1)

  watcher.stop()
  await writeFile(path.join(root, 'tangram/2026-07-18-b.md'), 'y')
  await settle(700)
  expect(onChange).toHaveBeenCalledTimes(1)
}, 10000)

test('the record watcher includes release answers sidecars', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-watch-releases-'))
  await mkdir(path.join(root, 'tangram', 'releases'), { recursive: true })
  const onChange = vi.fn()
  const watcher = watchQaRepo(root, onChange)
  await watcher.ready

  await writeFile(path.join(root, 'tangram/releases/0.11.0.answers.json'), '{}')
  await settle(700)

  expect(onChange).toHaveBeenCalledTimes(1)
  watcher.stop()
}, 10000)

test('the record watcher observes handoff Markdown and its state sidecar', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-watch-handoffs-'))
  await mkdir(path.join(root, 'dev-traffic-control', 'handoffs'), { recursive: true })
  const onChange = vi.fn()
  const watcher = watchQaRepo(root, onChange)
  await watcher.ready

  await writeFile(
    path.join(root, 'dev-traffic-control/handoffs/2026-07-30-example-handoff.md'),
    '# Handoff'
  )
  await settle(700)
  expect(onChange).toHaveBeenCalledTimes(1)

  await writeFile(
    path.join(root, 'dev-traffic-control/handoffs/2026-07-30-example-handoff.state.json'),
    '{"pickedUpAt":null,"archivedAt":null}'
  )
  await settle(700)

  expect(onChange).toHaveBeenCalledTimes(2)
  watcher.stop()
}, 10000)

test('a sentinel write failure degrades to polling without rejecting readiness', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-watch-read-only-'))
  const onChange = vi.fn()
  await chmod(root, 0o500)
  const watcher = watchQaRepo(root, onChange)

  try {
    await expect(watcher.ready).resolves.toBeUndefined()
  } finally {
    await watcher.stop()
    await chmod(root, 0o700)
  }
}, 10000)

test('an ENOENT probe write is tolerated so the arming loop can retry', async () => {
  const missing = Object.assign(new Error('vanished'), { code: 'ENOENT' })
  const writer = vi.fn().mockRejectedValueOnce(missing).mockResolvedValueOnce(undefined)

  await expect(writeProbeToleratingEnoent('/probe', '0\n', writer)).resolves.toBe(false)
  await expect(writeProbeToleratingEnoent('/probe', '1\n', writer)).resolves.toBe(true)
  expect(writer).toHaveBeenCalledTimes(2)
})

test('a non-ENOENT probe write failure still triggers degraded watcher handling', async () => {
  const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
  await expect(
    writeProbeToleratingEnoent('/probe', '0\n', vi.fn().mockRejectedValue(denied))
  ).rejects.toBe(denied)
})

test('watcher startup removes stale arming sentinels from prior processes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-watch-stale-sentinel-'))
  await writeFile(path.join(root, '.dtc-watch-ready-111-dead.state.json'), 'stale\n')
  await writeFile(path.join(root, '.dtc-watch-ready-222-dead.state.json'), 'stale\n')
  const watcher = watchQaRepo(root, vi.fn())

  await watcher.ready
  expect((await readdir(root)).filter((name) => name.startsWith('.dtc-watch-ready-'))).toEqual([])
  await watcher.stop()
}, 10000)

test('readiness waits for the in-flight probe write and final sentinel removal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-watch-probe-settle-'))
  let markProbeStarted!: () => void
  const probeStarted = new Promise<void>((resolve) => {
    markProbeStarted = resolve
  })
  probeWriteControl.block = true
  probeWriteControl.started = markProbeStarted
  const watcher = watchQaRepo(root, vi.fn())
  const readyResolved = vi.fn()
  void watcher.ready.then(readyResolved)

  await probeStarted
  await settle(20)
  expect(readyResolved).not.toHaveBeenCalled()

  probeWriteControl.release?.()
  await watcher.ready
  expect((await readdir(root)).filter((name) => name.startsWith('.dtc-watch-ready-'))).toEqual([])
  await watcher.stop()
  probeWriteControl.block = false
  probeWriteControl.started = null
  probeWriteControl.release = null
}, 10000)
