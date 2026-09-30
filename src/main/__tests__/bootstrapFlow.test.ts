import { expect, test, vi } from 'vitest'
import { bootstrapRecordRoot } from '../bootstrapFlow'

test('folder bootstrap commits settings only after the root and watcher are ready', async () => {
  const calls: string[] = []
  const result = await bootstrapRecordRoot('/new', '/old', true, {
    ensureRoot: async () => {
      calls.push('ensure')
    },
    restartService: async (root) => {
      calls.push(`restart:${root}`)
    },
    persistRoot: async (root) => {
      calls.push(`persist:${root}`)
      return { qaRepoPath: root }
    }
  })

  expect(calls).toEqual(['ensure', 'restart:/new', 'persist:/new'])
  expect(result.qaRepoPath).toBe('/new')
})

test('folder bootstrap never persists when root preparation or watcher restart fails', async () => {
  const persistRoot = vi.fn()
  await expect(
    bootstrapRecordRoot('/new', '/old', true, {
      ensureRoot: async () => {
        throw new Error('unreadable')
      },
      restartService: vi.fn(),
      persistRoot
    })
  ).rejects.toThrow('unreadable')
  expect(persistRoot).not.toHaveBeenCalled()

  const restartService = vi.fn(async (root: string) => {
    if (root === '/new') throw new Error('watch failed')
  })
  await expect(
    bootstrapRecordRoot('/new', '/old', true, {
      ensureRoot: vi.fn(),
      restartService,
      persistRoot
    })
  ).rejects.toThrow('watch failed')
  expect(persistRoot).not.toHaveBeenCalled()
  expect(restartService.mock.calls).toEqual([['/new'], ['/old']])
})

test('a failed settings commit restores the previous watcher before rejecting', async () => {
  const restartService = vi.fn(async () => {})

  await expect(
    bootstrapRecordRoot('/new', '/old', true, {
      ensureRoot: vi.fn(),
      restartService,
      persistRoot: async () => {
        throw new Error('settings write failed')
      }
    })
  ).rejects.toThrow('settings write failed')

  expect(restartService.mock.calls).toEqual([['/new'], ['/old']])
})
