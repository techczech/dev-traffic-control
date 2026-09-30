import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { ReadingProgressStore } from '../readingProgress'

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dtc-reading-progress-'))
  return path.join(dir, 'reading-progress.json')
}

describe('ReadingProgressStore', () => {
  test('starts empty when the file is missing', async () => {
    const store = new ReadingProgressStore(await tmp())

    expect(store.getAll()).toEqual({})
    expect(store.get('redforge/review.md')).toBeNull()
  })

  test('persists the last reached section across reconstruction', async () => {
    const file = await tmp()
    const store = new ReadingProgressStore(file, () => '2026-08-07T01:30:00.000Z')

    store.set('redforge/review.md', {
      sectionSlug: 'journey-2',
      sectionIndex: 2,
      sectionCount: 7
    })
    await store.flush()

    const reopened = new ReadingProgressStore(file)
    expect(reopened.get('redforge/review.md')).toEqual({
      sectionSlug: 'journey-2',
      sectionIndex: 2,
      sectionCount: 7,
      updatedAt: '2026-08-07T01:30:00.000Z'
    })
  })

  test('keeps same-basename requests in different projects independent', async () => {
    const store = new ReadingProgressStore(await tmp(), () => '2026-08-07T01:30:00.000Z')

    store.set('alpha/review.md', { sectionSlug: 'one', sectionIndex: 0, sectionCount: 2 })
    store.set('beta/review.md', { sectionSlug: 'two', sectionIndex: 1, sectionCount: 3 })

    expect(store.get('alpha/review.md')?.sectionSlug).toBe('one')
    expect(store.get('beta/review.md')?.sectionSlug).toBe('two')
  })

  test('a corrupt file falls back to empty without throwing', async () => {
    const file = await tmp()
    await writeFile(file, '{ not json', 'utf8')

    expect(new ReadingProgressStore(file).getAll()).toEqual({})
  })
})
