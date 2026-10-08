import { afterEach, describe, expect, test, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { QaService } from '../qaService'
import { atomicWrite } from '../qa/atomicWrite'
import type { QaSnapshot } from '../../shared/ipc'
import { InboxStateStore } from '../inboxState'
import { TicksStore } from '../ticks'
import { pruneUserDataForSnapshot } from '../snapshotState'

const REQ = `---
id: t1
title: T1
---
## A
**Steps**
- s
**Expected**
- e
`

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) {
    await settle(0)
  }
  expect(predicate()).toBe(true)
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-svc-'))
  await mkdir(path.join(root, 'tangram/0.4-cover-pages'), { recursive: true })
  await mkdir(path.join(root, 'tangram/handoffs'), { recursive: true })
  await mkdir(path.join(root, 'pinboard'), { recursive: true })
  await writeFile(path.join(root, 'tangram/0.4-cover-pages/2026-01-18-spacing.md'), REQ)
  await writeFile(path.join(root, 'pinboard/2026-07-16-smoke.md'), REQ)
  await writeFile(
    path.join(root, 'pinboard/2026-07-16-smoke.report.json'),
    JSON.stringify({
      id: 't1',
      title: 'T1',
      startedAt: 'x',
      completedAt: 'y',
      noteFiles: [],
      items: []
    })
  )
  await writeFile(
    path.join(root, 'tangram/handoffs/2026-07-30-tangram-handoff.md'),
    '# Tangram handoff\n'
  )
  return root
}

const services: QaService[] = []
function track(svc: QaService): QaService {
  services.push(svc)
  return svc
}
afterEach(() => {
  for (const svc of services.splice(0)) void svc.stop()
})

describe('QaService', () => {
  test('a stale scan cannot overwrite a newer completed-report snapshot', async () => {
    const root = await fixture()
    const svc = track(new QaService(root))
    const stale = {
      root,
      rootMissing: false,
      runs: [],
      notes: [],
      entries: [],
      threads: [],
      handoffs: [],
      releases: [],
      pools: [],
      projects: [],
      scannedAt: 'stale'
    } satisfies QaSnapshot
    const fresh = { ...stale, scannedAt: 'fresh' } satisfies QaSnapshot
    let releaseFirst!: () => void
    const firstScanBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let scanCount = 0
    const internals = svc as unknown as {
      scan: () => Promise<QaSnapshot>
    }
    vi.spyOn(internals, 'scan').mockImplementation(async () => {
      scanCount += 1
      if (scanCount === 1) {
        await firstScanBlocked
        return stale
      }
      return fresh
    })
    const published: QaSnapshot[] = []

    const olderRefresh = svc.start((snapshot) => published.push(snapshot))
    await waitUntil(() => scanCount === 1)
    const newerRefresh = svc.start((snapshot) => published.push(snapshot))
    await Promise.resolve()
    releaseFirst()
    await Promise.all([olderRefresh, newerRefresh])

    expect(svc.snapshot()?.scannedAt).toBe('fresh')
    expect(published.at(-1)?.scannedAt).toBe('fresh')
  })

  test('the initial emit carries runs and projects', async () => {
    const root = await fixture()
    const svc = track(new QaService(root))
    const emitted: QaSnapshot[] = []
    await svc.start((s) => emitted.push(s))
    expect(emitted).toHaveLength(1)
    expect(emitted[0].rootMissing).toBe(false)
    expect(emitted[0].projects.sort()).toEqual(['pinboard', 'tangram'])
    expect(emitted[0].runs).toHaveLength(2)
    expect(emitted[0].handoffs).toHaveLength(1)
    expect(emitted[0].handoffs[0].project).toBe('tangram')
    expect(svc.snapshot()).toEqual(emitted[0])
  })

  test('a read-only record root still starts and publishes its authoritative scan', async () => {
    const root = await fixture()
    const svc = track(new QaService(root))
    const emitted: QaSnapshot[] = []
    await chmod(root, 0o500)

    try {
      await expect(svc.start((snapshot) => emitted.push(snapshot))).resolves.toBeUndefined()
      expect(emitted.at(-1)?.runs).toHaveLength(2)
    } finally {
      await svc.stop()
      await chmod(root, 0o700)
    }
  }, 10000)

  test('a missing root emits rootMissing without watching or crashing', async () => {
    const svc = track(new QaService(path.join(tmpdir(), 'qa-does-not-exist-' + Date.now())))
    const emitted: QaSnapshot[] = []
    await svc.start((s) => emitted.push(s))
    expect(emitted).toHaveLength(1)
    expect(emitted[0].rootMissing).toBe(true)
    expect(emitted[0].runs).toEqual([])
    expect(emitted[0].handoffs).toEqual([])
    expect(emitted[0].projects).toEqual([])
  })

  test('touching a request file re-emits a fresh snapshot', async () => {
    const root = await fixture()
    const svc = track(new QaService(root))
    const cb = vi.fn()
    await svc.start(cb)
    expect(cb).toHaveBeenCalledTimes(1)
    await settle(400) // let the watcher become ready

    await writeFile(path.join(root, 'tangram/0.4-cover-pages/2026-07-18-second.md'), REQ)
    await settle(800)
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(svc.snapshot()?.runs).toHaveLength(3)
  }, 10000)

  test('an atomic report write after watcher readiness publishes Done', async () => {
    const root = await fixture()
    const svc = track(new QaService(root))
    const cb = vi.fn()
    await svc.start(cb)
    const reportPath = path.join(root, 'tangram/0.4-cover-pages/2026-01-18-spacing.report.json')

    await atomicWrite(
      reportPath,
      JSON.stringify({
        id: 't1',
        title: 'T1',
        startedAt: '2026-08-01T13:27:00.000Z',
        completedAt: '2026-08-01T13:27:30.000Z',
        noteFiles: [],
        items: [
          {
            id: 'a',
            title: 'A',
            status: 'pass',
            comment: '',
            flagged: [],
            quotes: [],
            screenshots: []
          }
        ]
      }) + '\n'
    )
    await settle(1200)

    const run = svc
      .snapshot()
      ?.runs.find((candidate) => candidate.request.path.endsWith('2026-01-18-spacing.md'))
    expect(run?.status).toBe('done')
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(2)
  }, 10000)

  test('stop waits for an in-flight scan and the instance never publishes afterwards', async () => {
    const root = await fixture()
    const svc = track(new QaService(root))
    const cb = vi.fn()
    let releaseScan!: () => void
    const blocked = new Promise<void>((resolve) => (releaseScan = resolve))
    const internals = svc as unknown as { scan: () => Promise<QaSnapshot> }
    const realScan = internals.scan.bind(svc)
    vi.spyOn(internals, 'scan').mockImplementation(async () => {
      await blocked
      return realScan()
    })

    const starting = svc.start(cb)
    await Promise.resolve()
    const stopping = svc.stop()
    releaseScan()
    await Promise.all([starting, stopping])

    expect(cb).not.toHaveBeenCalled()
    await svc.refresh()
    expect(cb).not.toHaveBeenCalled()
  }, 10000)

  test('an interleaved old-root scan cannot prune new-root archive state after restart', async () => {
    const oldRoot = await fixture()
    const newRoot = await fixture()
    const stateDir = await mkdtemp(path.join(tmpdir(), 'qa-service-state-'))
    const ticks = new TicksStore(path.join(stateDir, 'ticks.json'))
    const inbox = new InboxStateStore(path.join(stateDir, 'inbox.json'))
    const newPaths = Array.from({ length: 6 }, (_, index) => `${newRoot}/new/run-${index}.md`)
    for (const requestPath of newPaths) inbox.archive(`new/${path.basename(requestPath)}`)
    await inbox.pendingWrite

    const makeSnapshot = (root: string, paths: string[]): QaSnapshot =>
      ({
        root,
        rootMissing: false,
        runs: paths.map((requestPath) => ({ request: { path: requestPath } })),
        notes: [],
        entries: [],
        threads: [],
        handoffs: [],
        projects: [],
        scannedAt: root
      }) as unknown as QaSnapshot
    const stale = makeSnapshot(
      oldRoot,
      Array.from({ length: 6 }, (_, index) => `${oldRoot}/old/run-${index}.md`)
    )
    const fresh = makeSnapshot(newRoot, newPaths)
    let releaseOld!: () => void
    const oldBlocked = new Promise<void>((resolve) => (releaseOld = resolve))
    const old = track(new QaService(oldRoot))
    vi.spyOn(old as unknown as { scan: () => Promise<QaSnapshot> }, 'scan').mockImplementation(
      async () => {
        await oldBlocked
        return stale
      }
    )
    const published: QaSnapshot[] = []
    const publish = (snapshot: QaSnapshot): void => {
      published.push(snapshot)
      pruneUserDataForSnapshot(snapshot, ticks, inbox)
    }
    const oldStart = old.start(publish)
    await Promise.resolve()
    const oldStop = old.stop()

    const current = track(new QaService(newRoot))
    vi.spyOn(current as unknown as { scan: () => Promise<QaSnapshot> }, 'scan').mockResolvedValue(
      fresh
    )
    await current.start(publish)
    releaseOld()
    await Promise.all([oldStart, oldStop])
    await inbox.pendingWrite

    expect(published.at(-1)?.root).toBe(newRoot)
    expect(inbox.get().archived).toEqual(newPaths.map((p) => `new/${path.basename(p)}`))
  }, 10000)

  test('badgeCount counts only waiting runs', async () => {
    const root = await fixture()
    const svc = track(new QaService(root))
    await svc.start(() => {})
    const snap = svc.snapshot()!
    // pinboard is done, tangram padding is waiting → one waiting.
    expect(svc.badgeCount(snap)).toBe(1)
  })

  test('badgeCount excludes runs whose report is corrupt', () => {
    const svc = track(new QaService('/records'))
    const snap = {
      root: '/records',
      rootMissing: false,
      runs: [
        { status: 'waiting', reportError: 'invalid JSON', resolvedAt: undefined },
        { status: 'waiting', resolvedAt: undefined }
      ],
      notes: [],
      entries: [],
      threads: [],
      handoffs: [],
      projects: [],
      scannedAt: ''
    } as unknown as QaSnapshot
    expect(svc.badgeCount(snap)).toBe(1)
  })

  test('a malformed report is surfaced in the snapshot without aborting the view model', async () => {
    const root = await fixture()
    await writeFile(
      path.join(root, 'tangram/0.4-cover-pages/2026-01-18-spacing.report.json'),
      JSON.stringify({ id: 't1', title: 'Missing items', startedAt: 'now', noteFiles: [] })
    )
    const svc = track(new QaService(root))

    await svc.start(() => {})

    const run = svc
      .snapshot()
      ?.runs.find((candidate) => candidate.request.path.endsWith('2026-01-18-spacing.md'))
    expect(run?.report).toBeNull()
    expect(run?.reportError).toMatch(/items/i)
  })
})
