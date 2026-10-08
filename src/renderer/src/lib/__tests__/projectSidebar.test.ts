import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { RETIRED_PROJECT_SELECTION_KEYS, forgetRetiredProjectSelections } from '../projectSidebar'

/** Every renderer file that must not keep a project of its own. */
const SURFACES = [
  '../releaseSidebar.ts',
  '../roadmapSidebar.ts',
  '../handoffSelection.ts',
  '../../views/Releases.tsx',
  '../../views/RoadmapPool.tsx',
  '../../views/Handoffs.tsx'
]

beforeEach(() => localStorage.clear())

test('the three per-surface project selections are cleared, not migrated', () => {
  for (const key of RETIRED_PROJECT_SELECTION_KEYS) localStorage.setItem(key, 'windmill')

  forgetRetiredProjectSelections()

  for (const key of RETIRED_PROJECT_SELECTION_KEYS) {
    expect(localStorage.getItem(key)).toBeNull()
  }
})

test('a blocked local store does not stop the app starting', () => {
  expect(() =>
    forgetRetiredProjectSelections({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('storage blocked')
      }
    })
  ).not.toThrow()
})

test('no surface reads or writes a retired project key any more', () => {
  for (const file of SURFACES) {
    const source = readFileSync(path.resolve(__dirname, file), 'utf8')
    for (const key of RETIRED_PROJECT_SELECTION_KEYS) {
      expect(source, `${file} still names ${key}`).not.toContain(key)
    }
  }
})
