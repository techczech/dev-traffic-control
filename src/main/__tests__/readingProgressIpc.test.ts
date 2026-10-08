import { expect, test, vi } from 'vitest'
import type { ReadingProgress, ReadingProgressState } from '../../shared/ipc'
import { createReadingProgressHandlers } from '../readingProgressIpc'

test('reading-progress IPC exposes the authoritative store through get and set', () => {
  const state: ReadingProgressState = {}
  const store = {
    getAll: vi.fn(() => ({ ...state })),
    set: vi.fn((requestPath: string, progress: Omit<ReadingProgress, 'updatedAt'>) => {
      state[requestPath] = { ...progress, updatedAt: '2026-08-07T01:45:00.000Z' }
    })
  }
  const handlers = createReadingProgressHandlers(store)

  expect(handlers.get()).toEqual({})
  expect(
    handlers.set('rivermill/review.md', {
      sectionSlug: 'journey-2',
      sectionIndex: 1,
      sectionCount: 4
    })
  ).toEqual({
    sectionSlug: 'journey-2',
    sectionIndex: 1,
    sectionCount: 4,
    updatedAt: '2026-08-07T01:45:00.000Z'
  })
  expect(store.set).toHaveBeenCalledWith('rivermill/review.md', {
    sectionSlug: 'journey-2',
    sectionIndex: 1,
    sectionCount: 4
  })
})
