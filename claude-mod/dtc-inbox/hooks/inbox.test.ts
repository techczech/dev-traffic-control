import { describe, expect, test } from 'claude-code/testing'

import { bandCount, openedNotFinished, recordFiling, recordLocalFiling, unreadableSet, waitingSet } from './inbox'
import type { ScanEntry } from './scan'


const entry = (project: string, name: string, over: Partial<ScanEntry> = {}): ScanEntry => ({
  project,
  rel: `${name}.md`,
  state: 'waiting',
  title: name,
  completedAt: '2026-10-01T07:00:00.000Z',
  counts: { pass: 1, partial: 0, fail: 0, skip: 0, unanswered: 0 },
  decisions: { answered: 0, total: 0 },
  ...over,
})

const entries = [
  entry('appx', '2026-01-01-a', { completedAt: '2026-10-01T07:00:00.000Z' }),
  entry('appx', '2026-01-02-b', { completedAt: '2026-10-02T07:00:00.000Z' }),
  entry('other', '2026-01-03-c', { completedAt: '2026-10-02T09:00:00.000Z' }),
  entry('appx', '2026-01-04-d', { state: 'opened', completedAt: null }),
  entry('other', '2026-01-05-e', { state: 'in-progress', completedAt: null }),
]

describe('scope', () => {
  test('hub sees all projects, newest first', () => {
    expect(waitingSet(entries, { kind: 'hub' }).map(e => e.rel)).toEqual(['2026-01-03-c.md', '2026-01-02-b.md', '2026-01-01-a.md'])
  })
  test('a project session sees only its own', () => {
    expect(waitingSet(entries, { kind: 'project', project: 'appx' }).map(e => e.project)).toEqual(['appx', 'appx'])
    expect(waitingSet(entries, { kind: 'project', project: 'none' })).toEqual([])
  })
  test('opened-not-finished covers opened and in-progress, in scope', () => {
    expect(openedNotFinished(entries, { kind: 'hub' }).map(e => e.state)).toEqual(['opened', 'in-progress'])
    expect(openedNotFinished(entries, { kind: 'project', project: 'appx' }).map(e => e.rel)).toEqual(['2026-01-04-d.md'])
  })
})

describe('band count', () => {
  test('counts the answers waiting in scope; opened, in-progress and unreadable never count', () => {
    const withBad = [...entries, entry('appx', '2026-01-06-f', { state: 'malformed', completedAt: null })]
    expect(bandCount(withBad, { kind: 'project', project: 'appx' })).toBe(2)
    expect(bandCount(withBad, { kind: 'hub' })).toBe(3)
    expect(bandCount(withBad, { kind: 'project', project: 'none' })).toBe(0)
    expect(unreadableSet(withBad, { kind: 'hub' }).map(e => e.rel)).toEqual(['2026-01-06-f.md'])
  })
})

describe('filing registry and local filings', () => {
  test('re-filing the same path updates the shared entry', () => {
    const a = recordFiling({}, { path: '/x', sessionId: 's1', project: 'p', filedAt: 1 })
    const b = recordFiling(a, { path: '/x', sessionId: 's2', project: 'p', filedAt: 2 })
    expect(Object.keys(b)).toEqual(['/x'])
    expect(b['/x']?.sessionId).toBe('s2')
  })
  test('the local record keeps the first filing time', () => {
    const a = recordLocalFiling({}, '/x', { project: 'p', filedAt: 5 })
    const b = recordLocalFiling(a, '/x', { project: 'p', filedAt: 9 })
    expect(b).toEqual({ '/x': { project: 'p', filedAt: 5, lastAt: 9 } })
  })
})
