import { expect, test } from 'vitest'
import type { QaSnapshot } from '../../../../shared/ipc'
import { surfaceCounts } from '../surfaceCounts'

function snapshot(): QaSnapshot {
  return {
    root: '/r',
    projects: ['sketchpad', 'harbour'],
    runs: [],
    notes: [],
    threads: [],
    entries: [],
    handoffs: [
      {
        path: '/r/sketchpad/handoffs/a-handoff.md',
        project: 'sketchpad',
        state: 'live',
        history: { kind: 'never-picked-up' },
        updated: '2026-09-20'
      },
      {
        path: '/r/sketchpad/handoffs/b-handoff.md',
        project: 'sketchpad',
        state: 'live',
        history: { kind: 'picked-up', at: '2026-09-21' },
        updated: '2026-09-20'
      }
    ],
    pools: [
      {
        project: 'sketchpad',
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
  const counts = surfaceCounts(
    snapshot(),
    { kind: 'project', slug: 'sketchpad' },
    new Set(),
    new Set()
  )
  expect(counts).toEqual({ inbox: 0, requests: 0, releases: 0, roadmap: 2, handoffs: 1 })
  const other = surfaceCounts(
    snapshot(),
    { kind: 'project', slug: 'harbour' },
    new Set(),
    new Set()
  )
  expect(other).toEqual({ inbox: 0, requests: 0, releases: 0, roadmap: 0, handoffs: 0 })
})

test('under All projects the Inbox and Feature requests are counted', () => {
  expect(surfaceCounts(snapshot(), { kind: 'all' }, new Set(), new Set())).toEqual({
    inbox: 0,
    requests: 0
  })
})
