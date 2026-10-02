import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { QaSnapshot, SerializableRun } from '../../../../shared/ipc'
import type { Thread, ThreadEntry } from '../../../../main/qa/types'

/**
 * Ticket 37: the discussion view. A record named in an entry is a chip with
 * its title and state, and opens it; when the thread waits on him the latest
 * entry whose move is his is marked "Asks you".
 */

const app = vi.hoisted(() => ({
  snapshot: null as QaSnapshot | null,
  navigate: vi.fn(),
  markSeen: vi.fn(),
  housekeeping: undefined
}))
vi.mock('../../state/app', () => ({ useApp: () => app }))

import { ThreadView } from '../Dashboard'

beforeEach(() => {
  app.navigate.mockReset()
  app.markSeen.mockReset()
  app.snapshot = snapshot('me')
})
afterEach(cleanup)

test('a record named in an entry is a chip with its title and state, and opens it', () => {
  render(<ThreadView threadId="saved-views" />)
  const chip = screen.getByRole('button', {
    name: /Lock the design\s*Waiting on you · 1 decision, 0 decided/
  })
  fireEvent.click(chip)
  expect(app.markSeen).toHaveBeenCalled()
  expect(app.navigate).toHaveBeenCalledWith({
    kind: 'runner',
    path: '/record/example-app/2026-09-29-lock.md'
  })
  // A bare file name resolves too, and the parent is a chip, not a bold name.
  expect(screen.getAllByRole('button', { name: /First round\s*Answered 29 Sep/ }).length).toBe(2)
})

test('the latest entry that asks him is marked, and only when the thread waits on him', () => {
  const { container } = render(<ThreadView threadId="saved-views" />)
  const marked = container.querySelectorAll('article.entry.asks')
  expect(marked).toHaveLength(1)
  expect(within(marked[0] as HTMLElement).getByText('Asks you')).toBeTruthy()
  expect(marked[0].textContent).toContain('Latest ask')
  expect(screen.getByText(/This thread waits on you/)).toBeTruthy()

  cleanup()
  app.snapshot = snapshot('agent')
  const agents = render(<ThreadView threadId="saved-views" />)
  expect(agents.container.querySelector('.asks')).toBeNull()
  expect(screen.queryByText(/This thread waits on you/)).toBeNull()
})

function entry(
  name: string,
  at: string,
  body: string,
  extra: Partial<ThreadEntry> = {}
): ThreadEntry {
  return {
    path: `/record/example-app/threads/${name}.md`,
    thread: 'saved-views',
    by: 'agent',
    writtenBy: 'agent',
    at,
    projects: ['example-app'],
    parents: [],
    dictation: false,
    body,
    labels: {},
    ...extra
  } as ThreadEntry
}

function run(
  name: string,
  title: string,
  extra: Partial<SerializableRun> & { body?: string } = {}
): SerializableRun {
  const mode = extra.body ? 'doc-review' : 'test'
  return {
    request: {
      id: name,
      title,
      labels: {},
      mode,
      items: [],
      parked: [],
      degraded: false,
      raw: extra.body ?? '',
      path: `/record/example-app/${name}.md`,
      ...(extra.body ? { document: { headings: [], bodyMarkdown: extra.body } } : {})
    },
    requestMtime: '2026-09-29T09:00:00.000Z',
    report: null,
    status: 'waiting',
    project: 'example-app',
    round: null,
    ...extra
  } as SerializableRun
}

function snapshot(move: 'me' | 'agent'): QaSnapshot {
  const entries = [
    entry('1', '2026-09-28T17:25:00.000Z', 'Round one is drawn: 2026-09-28-first-round.', {
      move: 'agent'
    }),
    entry(
      '2',
      '2026-09-29T15:20:00.000Z',
      'Latest ask: [the review](dtc://open/example-app/2026-09-29-lock.md) is open.',
      { move, parents: ['2026-09-28-first-round'] }
    )
  ]
  const thread = {
    id: 'saved-views',
    title: 'Saved views and filters',
    projects: ['example-app'],
    parents: ['2026-09-28-first-round'],
    move,
    form: 'idea',
    state: 'open',
    entries,
    firstAt: entries[0].at,
    lastAt: entries[1].at,
    ageDays: 2,
    cold: false,
    dictated: false
  } as unknown as Thread
  return {
    root: '/record',
    rootMissing: false,
    runs: [
      run('2026-09-28-first-round', 'First round', {
        status: 'done',
        report: {
          id: 'x',
          title: 'First round',
          startedAt: '',
          completedAt: '2026-09-29T10:00:00.000Z',
          items: []
        } as unknown as SerializableRun['report']
      }),
      run('2026-09-29-lock', 'Lock the design', { body: '```decision\nLock?\n- Yes\n```' })
    ],
    notes: [],
    entries,
    threads: [thread],
    handoffs: [],
    releases: [],
    pools: [],
    projects: ['example-app'],
    scannedAt: '2026-10-01T09:00:00.000Z'
  }
}
