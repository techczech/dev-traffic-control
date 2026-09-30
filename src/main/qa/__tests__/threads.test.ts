import { describe, expect, test } from 'vitest'
import { deriveThreads, rankFor } from '../threads'
import type { ThreadEntry } from '../types'

function entry(
  p: Partial<ThreadEntry> & { thread: string; at: string; path: string }
): ThreadEntry {
  return {
    by: 'agent',
    writtenBy: 'agent',
    projects: [],
    parents: [],
    dictation: false,
    body: '',
    labels: {},
    ...p
  }
}

const NOW = '2026-07-25T00:00:00.000Z'

describe('deriveThreads', () => {
  test('latest asserting entry wins per field; a silent later entry changes nothing', () => {
    const threads = deriveThreads(
      [
        entry({
          thread: 't',
          at: '2026-07-20T00:00:00.000Z',
          path: '/a',
          move: 'me',
          form: 'idea',
          title: 'First'
        }),
        entry({ thread: 't', at: '2026-07-21T00:00:00.000Z', path: '/b', move: 'agent' }),
        entry({ thread: 't', at: '2026-07-22T00:00:00.000Z', path: '/c', body: 'no assertions' })
      ],
      NOW
    )
    expect(threads).toHaveLength(1)
    const t = threads[0]
    expect(t.move).toBe('agent') // latest asserting entry (b), not the silent c
    expect(t.form).toBe('idea') // only a asserted it
    expect(t.title).toBe('First')
    expect(t.entries.map((e) => e.path)).toEqual(['/a', '/b', '/c']) // chronological
  })

  test('projects and parents union across entries in first-assertion order', () => {
    const t = deriveThreads(
      [
        entry({
          thread: 't',
          at: '2026-07-20T00:00:00.000Z',
          path: '/a',
          projects: ['dev-traffic-control']
        }),
        entry({
          thread: 't',
          at: '2026-07-21T00:00:00.000Z',
          path: '/b',
          projects: ['bramble', 'dev-traffic-control']
        })
      ],
      NOW
    )[0]
    expect(t.projects).toEqual(['dev-traffic-control', 'bramble'])
  })

  test('retire then reopen: latest state wins', () => {
    const t = deriveThreads(
      [
        entry({
          thread: 't',
          at: '2026-07-20T00:00:00.000Z',
          path: '/a',
          state: 'retired',
          outcome: 'delivered'
        }),
        entry({ thread: 't', at: '2026-07-21T00:00:00.000Z', path: '/b', state: 'open' })
      ],
      NOW
    )[0]
    expect(t.state).toBe('open')
  })

  test('cold at exactly 7 days since the last entry', () => {
    const seven = deriveThreads(
      [entry({ thread: 't', at: '2026-07-18T00:00:00.000Z', path: '/a' })],
      NOW
    )[0]
    expect(seven.ageDays).toBe(7)
    expect(seven.cold).toBe(true)
    const six = deriveThreads(
      [entry({ thread: 't', at: '2026-07-19T12:00:00.000Z', path: '/a' })],
      NOW
    )[0]
    expect(six.cold).toBe(false)
  })

  test('title falls back to the first body line when never asserted', () => {
    const t = deriveThreads(
      [
        entry({
          thread: 't',
          at: '2026-07-20T00:00:00.000Z',
          path: '/a',
          body: '\n  Use Dev Traffic Control for roadmaps.  \nmore'
        })
      ],
      NOW
    )[0]
    expect(t.title).toBe('Use Dev Traffic Control for roadmaps.')
  })
})

describe('rankFor', () => {
  test('uses the latest order entry; unlisted threads sort after by recency', () => {
    const entries = [
      entry({ thread: 'a', at: '2026-07-20T00:00:00.000Z', path: '/a', projects: ['p'] }),
      entry({ thread: 'b', at: '2026-07-24T00:00:00.000Z', path: '/b', projects: ['p'] }),
      entry({ thread: 'c', at: '2026-07-22T00:00:00.000Z', path: '/c', projects: ['p'] }),
      entry({
        thread: 'ord',
        at: '2026-07-19T00:00:00.000Z',
        path: '/o1',
        order: { project: 'p', threads: ['a'] }
      }),
      entry({
        thread: 'ord',
        at: '2026-07-25T00:00:00.000Z',
        path: '/o2',
        order: { project: 'p', threads: ['b', 'a'] }
      })
    ]
    const threads = deriveThreads(entries, NOW)
    const rank = rankFor('p', threads, entries)
    expect(rank.get('b')).toBe(0) // latest order: b first
    expect(rank.get('a')).toBe(1) // then a
    // c is not in the order → ranks after the ordered ones, by recency
    expect(rank.get('c')).toBe(2)
  })
})
