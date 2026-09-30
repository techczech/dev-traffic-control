import { describe, expect, test } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { InboxStateStore } from '../inboxState'

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-inbox-'))
  return path.join(dir, 'inbox-state.json')
}

describe('InboxStateStore', () => {
  test('exposes the pending write through flush', async () => {
    const store = new InboxStateStore(await tmp())
    store.markSeen('run')
    const flush = (store as unknown as { flush?: () => Promise<void> }).flush

    expect(typeof flush).toBe('function')
    await flush?.call(store)
  })

  test('starts empty when the file is missing', async () => {
    const store = new InboxStateStore(await tmp())
    expect(store.get()).toEqual({ seen: [], archived: [] })
  })

  test('markSeen and archive persist across a reconstruct', async () => {
    const file = await tmp()
    const store = new InboxStateStore(file)
    store.markSeen('2026-07-18-a')
    store.archive('2026-07-17-b')
    await store.pendingWrite

    const reopened = new InboxStateStore(file)
    expect(reopened.get().seen).toEqual(['2026-07-18-a'])
    expect(reopened.get().archived).toEqual(['2026-07-17-b'])
  })

  test('markSeen is idempotent (no duplicates)', async () => {
    const store = new InboxStateStore(await tmp())
    store.markSeen('x')
    store.markSeen('x')
    expect(store.get().seen).toEqual(['x'])
  })

  test('unarchive removes only that entry', async () => {
    const store = new InboxStateStore(await tmp())
    store.archive('a')
    store.archive('b')
    store.unarchive('a')
    expect(store.get().archived).toEqual(['b'])
  })

  test('prune drops seen and archived entries whose request has vanished', async () => {
    const store = new InboxStateStore(await tmp())
    store.markSeen('gone')
    store.markSeen('kept')
    store.archive('gone-too')
    store.archive('kept-arch')
    store.prune(new Set(['kept', 'kept-arch']))
    expect(store.get()).toEqual({ seen: ['kept'], archived: ['kept-arch'] })
  })

  test('a corrupt file falls back to empty without throwing', async () => {
    const file = await tmp()
    await writeFile(file, '{ not json', 'utf8')
    const store = new InboxStateStore(file)
    expect(store.get()).toEqual({ seen: [], archived: [] })
  })

  test('migrates unambiguous legacy keys and retains ambiguous read fallback', async () => {
    const file = await tmp()
    await writeFile(
      file,
      JSON.stringify({ seen: ['unique', 'shared'], archived: ['unique', 'shared'] }) + '\n',
      'utf8'
    )
    const store = new InboxStateStore(file)

    store.migrateRequestKeys(['alpha/unique.md', 'alpha/shared.md', 'beta/shared.md'])
    await store.pendingWrite

    expect(store.get()).toEqual({
      seen: ['shared', 'alpha/unique.md'],
      archived: ['shared', 'alpha/unique.md']
    })

    store.migrateRequestKeys(['alpha/shared.md'])
    store.prune(new Set(['alpha/other.md']))
    await store.pendingWrite
    expect(store.get()).toEqual({ seen: ['shared'], archived: ['shared'] })
  })

  test('relative keys keep same-basename projects independent for new writes', async () => {
    const store = new InboxStateStore(await tmp())
    store.markSeen('alpha/shared.md')
    store.archive('beta/shared.md')

    expect(store.get()).toEqual({
      seen: ['alpha/shared.md'],
      archived: ['beta/shared.md']
    })
  })
})

// Ticket 22, archive old: many requests and decisions in one change.
describe('archiving old items in bulk', () => {
  test('requests and decisions archive together and survive a reconstruct', async () => {
    const file = await tmp()
    const store = new InboxStateStore(file)
    store.archive('tallyboard/2026-08-01-old.md')
    store.archiveMany(
      ['redforge/2026-08-02-older.md', 'tallyboard/2026-08-01-old.md'],
      ['thread-a', 'thread-b']
    )
    await store.flush()
    const again = new InboxStateStore(file)
    expect(new Set(again.get().archived)).toEqual(
      new Set(['tallyboard/2026-08-01-old.md', 'redforge/2026-08-02-older.md'])
    )
    expect(new Set(again.get().archivedThreads)).toEqual(new Set(['thread-a', 'thread-b']))
  })

  test('a decision can be restored on its own', async () => {
    const file = await tmp()
    const store = new InboxStateStore(file)
    store.archiveMany([], ['thread-a', 'thread-b'])
    store.unarchiveThread('thread-a')
    await store.flush()
    expect(new InboxStateStore(file).get().archivedThreads).toEqual(['thread-b'])
  })

  test('archiving nothing new writes nothing', async () => {
    const file = await tmp()
    const store = new InboxStateStore(file)
    store.archiveMany([], [])
    await store.flush()
    expect(store.get()).toEqual({ seen: [], archived: [] })
  })
})
