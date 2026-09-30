import { describe, expect, test } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TicksStore } from '../ticks'

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-ticks-'))
  return path.join(dir, 'ticks.json')
}

describe('TicksStore', () => {
  test('exposes the pending write through flush', async () => {
    const store = new TicksStore(await tmp())
    store.setItem('run', 'item', { steps: [0], expected: [] })
    const flush = (store as unknown as { flush?: () => Promise<void> }).flush

    expect(typeof flush).toBe('function')
    await flush?.call(store)
    expect(store.get('run')).toEqual({ item: { steps: [0], expected: [] } })
  })

  test('empty for an unknown report; missing file is fine', async () => {
    const store = new TicksStore(await tmp())
    expect(store.get('2026-07-20-anything')).toEqual({})
  })

  test('setItem round-trips across a second construct (atomic write)', async () => {
    const file = await tmp()
    const store = new TicksStore(file)
    store.setItem('2026-07-20-run', 'item-a', { steps: [0, 2], expected: [1] })
    await store.pendingWrite

    const reopened = new TicksStore(file)
    expect(reopened.get('2026-07-20-run')).toEqual({
      'item-a': { steps: [0, 2], expected: [1] }
    })
  })

  test('stored arrays keep tick order — never re-sorted', async () => {
    const file = await tmp()
    const store = new TicksStore(file)
    store.setItem('run', 'a', { steps: [3, 0, 1], expected: [] })
    await store.pendingWrite
    expect(new TicksStore(file).get('run').a.steps).toEqual([3, 0, 1])
  })

  test('an item unticked back to empty leaves no residue in the file', async () => {
    const file = await tmp()
    const store = new TicksStore(file)
    store.setItem('run', 'a', { steps: [0], expected: [] })
    store.setItem('run', 'a', { steps: [], expected: [] })
    await store.pendingWrite
    expect(store.get('run')).toEqual({})
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({})
  })

  test('clear drops one report and leaves the others (reopen semantics)', async () => {
    const file = await tmp()
    const store = new TicksStore(file)
    store.setItem('run-a', 'x', { steps: [0], expected: [] })
    store.setItem('run-b', 'y', { steps: [], expected: [0] })
    store.clear('run-a')
    await store.pendingWrite
    expect(store.get('run-a')).toEqual({})
    expect(store.get('run-b')).toEqual({ y: { steps: [], expected: [0] } })
  })

  test('prune keeps live basenames and drops vanished ones', async () => {
    const file = await tmp()
    const store = new TicksStore(file)
    store.setItem('kept', 'x', { steps: [0], expected: [] })
    store.setItem('gone', 'y', { steps: [1], expected: [] })
    store.prune(new Set(['kept', 'unrelated']))
    await store.pendingWrite
    expect(store.get('kept')).toEqual({ x: { steps: [0], expected: [] } })
    expect(store.get('gone')).toEqual({})

    const reopened = new TicksStore(file)
    expect(reopened.get('gone')).toEqual({})
  })

  test('prune with nothing to drop writes nothing', async () => {
    const file = await tmp()
    const store = new TicksStore(file)
    store.setItem('kept', 'x', { steps: [0], expected: [] })
    await store.pendingWrite
    const before = await readFile(file, 'utf8')
    store.prune(new Set(['kept']))
    await store.pendingWrite
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  test('a corrupt file falls back to empty without throwing', async () => {
    const file = await tmp()
    await writeFile(file, '{ not json', 'utf8')
    const store = new TicksStore(file)
    expect(store.get('anything')).toEqual({})
  })

  test('get returns a copy — mutating it never leaks into the store', async () => {
    const store = new TicksStore(await tmp())
    store.setItem('run', 'a', { steps: [0], expected: [] })
    const leaked = store.get('run')
    leaked.a.steps.push(99)
    expect(store.get('run').a.steps).toEqual([0])
  })

  test('migrates an unambiguous basename key to the repository-relative request key', async () => {
    const file = await tmp()
    await writeFile(
      file,
      JSON.stringify({ legacy: { a: { steps: [0], expected: [] } } }) + '\n',
      'utf8'
    )
    const store = new TicksStore(file)

    store.migrateRequestKeys(['alpha/legacy.md'])
    await store.pendingWrite

    expect(store.keys()).toEqual(['alpha/legacy.md'])
    expect(store.get('alpha/legacy.md')).toEqual({ a: { steps: [0], expected: [] } })
  })

  test('ambiguous legacy data is shown on neither row and is never migrated to a survivor', async () => {
    const file = await tmp()
    await writeFile(
      file,
      JSON.stringify({ shared: { old: { steps: [0], expected: [] } } }) + '\n',
      'utf8'
    )
    const store = new TicksStore(file)
    store.migrateRequestKeys(['alpha/shared.md', 'beta/shared.md'])

    expect(store.keys()).toEqual(['shared'])
    expect(store.get('alpha/shared.md')).toEqual({})
    expect(store.get('beta/shared.md')).toEqual({})

    store.migrateRequestKeys(['beta/shared.md'])
    await store.pendingWrite
    expect(store.keys()).toEqual(['shared'])
    expect(store.get('beta/shared.md')).toEqual({ old: { steps: [0], expected: [] } })

    store.setItem('alpha/shared.md', 'alpha-only', { steps: [1], expected: [] })
    store.setItem('beta/shared.md', 'beta-only', { steps: [], expected: [2] })
    await store.pendingWrite

    expect(store.get('alpha/shared.md')).toHaveProperty('alpha-only')
    expect(store.get('alpha/shared.md')).not.toHaveProperty('beta-only')
    expect(store.get('beta/shared.md')).toHaveProperty('beta-only')
    expect(store.get('beta/shared.md')).not.toHaveProperty('alpha-only')
  })

  test('migration is idempotent and a missing ambiguous owner never prunes its legacy key', async () => {
    const file = await tmp()
    await writeFile(file, JSON.stringify({ shared: { old: { steps: [0], expected: [] } } }))
    const store = new TicksStore(file)
    store.migrateRequestKeys(['alpha/shared.md', 'beta/shared.md'])
    store.migrateRequestKeys(['alpha/shared.md', 'beta/shared.md'])
    store.prune(new Set(['alpha/other.md']))
    await store.pendingWrite

    expect(store.keys()).toEqual(['shared'])
  })

  test('a renamed request never inherits the old path identity', async () => {
    const store = new TicksStore(await tmp())
    store.setItem('alpha/old-name.md', 'old', { steps: [0], expected: [] })
    store.migrateRequestKeys(['alpha/new-name.md'])

    expect(store.get('alpha/new-name.md')).toEqual({})
  })
})
