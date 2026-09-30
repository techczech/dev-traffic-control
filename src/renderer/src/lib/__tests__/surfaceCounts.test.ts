import { expect, test } from 'vitest'
import type { QaSnapshot } from '../../../../shared/ipc'
import { surfaceCounts } from '../surfaceCounts'

function snapshot(): QaSnapshot {
  return {
    root: '/r',
    projects: ['tw', 'rf'],
    runs: [],
    notes: [],
    threads: [],
    entries: [],
    handoffs: [
      {
        path: '/r/tw/handoffs/a-handoff.md',
        project: 'tw',
        state: 'live',
        history: { kind: 'never-picked-up' },
        updated: '2026-09-20'
      },
      {
        path: '/r/tw/handoffs/b-handoff.md',
        project: 'tw',
        state: 'live',
        history: { kind: 'picked-up', at: '2026-09-21' },
        updated: '2026-09-20'
      }
    ],
    pools: [
      {
        project: 'tw',
        ideas: [
          { id: 'a', state: 'pool' },
          { id: 'b', state: 'pool' },
          { id: 'c', state: 'setaside' }
        ]
      }
    ],
    releases: []
  } as unknown as QaSnapshot
}

test('inside a project each tab counts what it holds; empty reads as zero', () => {
  const counts = surfaceCounts(snapshot(), { kind: 'project', slug: 'tw' }, new Set(), new Set())
  expect(counts).toEqual({ inbox: 0, releases: 0, roadmap: 2, handoffs: 1 })
  const other = surfaceCounts(snapshot(), { kind: 'project', slug: 'rf' }, new Set(), new Set())
  expect(other).toEqual({ inbox: 0, releases: 0, roadmap: 0, handoffs: 0 })
})

test('under All projects only the Inbox is counted', () => {
  expect(surfaceCounts(snapshot(), { kind: 'all' }, new Set(), new Set())).toEqual({ inbox: 0 })
})
