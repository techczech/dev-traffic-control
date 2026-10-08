import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { QaSnapshot, SerializableRun } from '../../shared/ipc'
import { InboxStateStore } from '../inboxState'
import { pruneUserDataForSnapshot } from '../snapshotState'
import { TicksStore } from '../ticks'

const temporaryDirectories: string[] = []

function snapshot(requestPaths: string[]): QaSnapshot {
  return {
    root: '/tmp/records',
    rootMissing: false,
    runs: requestPaths.map(
      (requestPath) =>
        ({
          request: { path: requestPath }
        }) as SerializableRun
    ),
    notes: [],
    entries: [],
    threads: [],
    handoffs: [],
    releases: [],
    pools: [],
    projects: [],
    scannedAt: '2026-07-29T00:00:00.000Z'
  }
}

async function stores(): Promise<{
  ticksFile: string
  inboxFile: string
  ticksStore: TicksStore
  inboxStore: InboxStateStore
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dtc-snapshot-state-'))
  temporaryDirectories.push(dir)
  const ticksFile = path.join(dir, 'ticks.json')
  const inboxFile = path.join(dir, 'inbox-state.json')
  return {
    ticksFile,
    inboxFile,
    ticksStore: new TicksStore(ticksFile),
    inboxStore: new InboxStateStore(inboxFile)
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

describe('pruneUserDataForSnapshot', () => {
  test('a zero-run snapshot preserves tick, seen, and archived state on disk', async () => {
    const state = await stores()
    state.ticksStore.setItem('run-one', 'check-one', { steps: [0], expected: [1] })
    state.inboxStore.markSeen('run-one')
    state.inboxStore.archive('run-old')
    await Promise.all([state.ticksStore.pendingWrite, state.inboxStore.pendingWrite])

    pruneUserDataForSnapshot(snapshot([]), state.ticksStore, state.inboxStore)
    await Promise.all([state.ticksStore.pendingWrite, state.inboxStore.pendingWrite])

    expect(JSON.parse(await readFile(state.ticksFile, 'utf8'))).toEqual({
      'run-one': { 'check-one': { steps: [0], expected: [1] } }
    })
    expect(JSON.parse(await readFile(state.inboxFile, 'utf8'))).toEqual({
      seen: ['run-one'],
      archived: ['run-old']
    })
    expect(new TicksStore(state.ticksFile).get('run-one')).toEqual({
      'check-one': { steps: [0], expected: [1] }
    })
    expect(new InboxStateStore(state.inboxFile).get()).toEqual({
      seen: ['run-one'],
      archived: ['run-old']
    })
  })

  test('a non-empty snapshot still prunes entries for vanished requests', async () => {
    const state = await stores()
    state.ticksStore.setItem('kept', 'check-one', { steps: [0], expected: [] })
    state.ticksStore.setItem('gone', 'check-two', { steps: [1], expected: [] })
    state.inboxStore.markSeen('kept')
    state.inboxStore.markSeen('gone')
    state.inboxStore.archive('kept')
    state.inboxStore.archive('gone')
    await Promise.all([state.ticksStore.pendingWrite, state.inboxStore.pendingWrite])

    pruneUserDataForSnapshot(
      snapshot(['/tmp/records/project/kept.md']),
      state.ticksStore,
      state.inboxStore
    )
    await Promise.all([state.ticksStore.pendingWrite, state.inboxStore.pendingWrite])

    expect(new TicksStore(state.ticksFile).get('project/kept.md')).toEqual({
      'check-one': { steps: [0], expected: [] }
    })
    expect(new TicksStore(state.ticksFile).get('gone')).toEqual({})
    expect(new InboxStateStore(state.inboxFile).get()).toEqual({
      seen: ['project/kept.md'],
      archived: ['project/kept.md']
    })
  })

  test('withholds a prune that would remove most of a non-trivial store', async () => {
    const state = await stores()
    for (let index = 0; index < 10; index += 1) {
      const basename = `run-${index}`
      state.ticksStore.setItem(basename, 'check', { steps: [0], expected: [] })
      state.inboxStore.markSeen(basename)
      state.inboxStore.archive(basename)
    }
    await Promise.all([state.ticksStore.pendingWrite, state.inboxStore.pendingWrite])
    const logger = vi.fn()

    pruneUserDataForSnapshot(
      snapshot(['/tmp/records/project/run-0.md', '/tmp/records/project/run-1.md']),
      state.ticksStore,
      state.inboxStore,
      logger
    )
    await Promise.all([state.ticksStore.pendingWrite, state.inboxStore.pendingWrite])

    expect(state.ticksStore.keys()).toHaveLength(10)
    const migratedWithheld = [
      ...Array.from({ length: 8 }, (_, index) => `run-${index + 2}`),
      'project/run-0.md',
      'project/run-1.md'
    ]
    expect(new InboxStateStore(state.inboxFile).get()).toEqual({
      seen: migratedWithheld,
      archived: migratedWithheld
    })
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('withheld removal of 8 of 10 saved request identities')
    )
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('run-2'))
  })

  test('permits a small prune from a non-trivial store', async () => {
    const state = await stores()
    for (let index = 0; index < 10; index += 1) {
      const basename = `run-${index}`
      state.ticksStore.setItem(basename, 'check', { steps: [0], expected: [] })
      state.inboxStore.markSeen(basename)
    }
    await Promise.all([state.ticksStore.pendingWrite, state.inboxStore.pendingWrite])
    const livePaths = Array.from(
      { length: 8 },
      (_, index) => `/tmp/records/project/run-${index}.md`
    )
    const logger = vi.fn()

    pruneUserDataForSnapshot(snapshot(livePaths), state.ticksStore, state.inboxStore, logger)
    await Promise.all([state.ticksStore.pendingWrite, state.inboxStore.pendingWrite])

    expect(state.ticksStore.keys()).toEqual(
      Array.from({ length: 8 }, (_, index) => `project/run-${index}.md`)
    )
    expect(new InboxStateStore(state.inboxFile).get().seen).toEqual(
      Array.from({ length: 8 }, (_, index) => `project/run-${index}.md`)
    )
    expect(logger).not.toHaveBeenCalled()
  })

  test('the backstop excludes protected legacy keys just as both stores do', async () => {
    const state = await stores()
    state.ticksStore.setItem('shared', 'check', { steps: [0], expected: [] })
    state.inboxStore.markSeen('shared')
    for (let index = 0; index < 4; index += 1) {
      state.ticksStore.setItem(`kept-${index}`, 'check', { steps: [0], expected: [] })
      state.inboxStore.markSeen(`kept-${index}`)
    }
    for (let index = 0; index < 5; index += 1) {
      state.ticksStore.setItem(`gone-${index}`, 'check', { steps: [0], expected: [] })
      state.inboxStore.markSeen(`gone-${index}`)
    }
    const ambiguousOwners = ['one/shared.md', 'two/shared.md']
    state.ticksStore.migrateRequestKeys(ambiguousOwners)
    state.inboxStore.migrateRequestKeys(ambiguousOwners)
    await Promise.all([state.ticksStore.pendingWrite, state.inboxStore.pendingWrite])
    const logger = vi.fn()
    const live = Array.from({ length: 4 }, (_, index) => `/tmp/records/project/kept-${index}.md`)

    pruneUserDataForSnapshot(snapshot(live), state.ticksStore, state.inboxStore, logger)
    await Promise.all([state.ticksStore.pendingWrite, state.inboxStore.pendingWrite])

    expect(logger).not.toHaveBeenCalled()
    expect(state.ticksStore.keys()).toEqual([
      'shared',
      ...Array.from({ length: 4 }, (_, index) => `project/kept-${index}.md`)
    ])
  })
})
