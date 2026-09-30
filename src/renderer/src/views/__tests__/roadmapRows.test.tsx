import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { QaSnapshot } from '../../../../shared/ipc'

const app = vi.hoisted(() => ({
  snapshot: null as QaSnapshot | null,
  navigate: vi.fn(),
  helpOpen: false,
  switcherOpen: false,
  seen: new Set<string>() as ReadonlySet<string>,
  seenLoaded: true,
  markSeen: vi.fn(),
  back: vi.fn(),
  showToast: vi.fn(),
  runnerMode: 'focus' as 'focus' | 'list',
  setRunnerMode: vi.fn(),
  // The project these fixtures live in: the rows under test belong to the
  // per-project Overview and Inbox (under All projects both are the fleet's).
  scope: { kind: 'project', slug: 'dev-traffic-control' } as
    { kind: 'all' } | { kind: 'project'; slug: string }
}))

vi.mock('../../state/app', () => ({
  useApp: () => app
}))

import { RunRowProgress as ActualRunRowProgress } from '../Dashboard'
import type { ReportWorkEvidence } from '../../lib/roadmap'

const ROW_NOW = new Date('2026-07-27T12:00:00')

function RunRowProgress(
  props: Omit<React.ComponentProps<typeof ActualRunRowProgress>, 'now'>
): React.JSX.Element {
  return <ActualRunRowProgress {...props} now={ROW_NOW} />
}

function evidence(overrides: Partial<ReportWorkEvidence> = {}): ReportWorkEvidence {
  return {
    hasWork: true,
    statuses: 0,
    comments: 0,
    flags: 0,
    quotes: 0,
    sectionMarks: 0,
    decisions: 0,
    screenshots: 0,
    observations: 0,
    noteFiles: 0,
    ...overrides
  }
}

beforeEach(() => {
  app.snapshot = null
  app.navigate.mockReset()
  app.seen = new Set()
  app.seenLoaded = true
  app.markSeen.mockReset()
  app.back.mockReset()
  app.showToast.mockReset()
  app.runnerMode = 'focus'
  app.setRunnerMode.mockReset()
  class TestResizeObserver {
    observe(): void {
      return
    }

    disconnect(): void {
      return
    }

    unobserve(): void {
      return
    }
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('RunRowProgress', () => {
  test('separates the rectangular type badge from the filled status pill', () => {
    const { container } = render(
      <RunRowProgress
        typeLabel="Test request"
        state={{ state: 'never-opened', answered: 0, total: 4, completedAt: null }}
        cells={['unanswered', 'unanswered', 'unanswered', 'unanswered']}
      />
    )

    const type = container.querySelector('.drow2-type')!
    const status = container.querySelector('.drow2-status')!
    expect(type.textContent).toBe('Test')
    expect(status.textContent).toBe('Not opened yet')
    expect(type.classList.contains('drow2-type')).toBe(true)
    expect(type.classList.contains('status-chip')).toBe(false)
    expect(status.classList.contains('status-chip')).toBe(true)
    expect(status.classList.contains('status-inactive')).toBe(true)
    expect(container.querySelector('.status-text')).toBeNull()
  })

  test('phrases the run histories that can appear in Waiting on you', () => {
    const { rerender } = render(
      <RunRowProgress
        typeLabel="Test request"
        state={{ state: 'never-opened', answered: 0, total: 4, completedAt: null }}
        cells={['unanswered', 'unanswered', 'unanswered', 'unanswered']}
      />
    )
    expect(screen.getByText('Test request · Not opened yet')).toBeTruthy()

    rerender(
      <RunRowProgress
        typeLabel="Document review"
        state={{ state: 'opened', answered: 0, total: 1, completedAt: null }}
        cells={['unanswered']}
      />
    )
    expect(screen.getByText('Document review · Opened — nothing noted yet')).toBeTruthy()

    rerender(
      <RunRowProgress
        typeLabel="Document review"
        state={{
          state: 'part-answered',
          answered: 0,
          total: 1,
          completedAt: null,
          evidence: evidence({ comments: 1, quotes: 1, sectionMarks: 1, decisions: 1 })
        }}
        cells={['unanswered']}
      />
    )
    expect(screen.getByText('Document review · Work noted')).toBeTruthy()

    rerender(
      <RunRowProgress
        typeLabel="Document review"
        state={{
          state: 'all-answered',
          answered: 1,
          total: 1,
          completedAt: null,
          reviewDisposition: 'partial'
        }}
        cells={['partial']}
      />
    )
    expect(
      screen.getByText('Document review · Approve with changes · Finish outstanding')
    ).toBeTruthy()

    rerender(
      <RunRowProgress
        typeLabel="Document review"
        state={{
          state: 'all-answered',
          answered: 1,
          total: 1,
          completedAt: null,
          evidence: evidence({ comments: 1, quotes: 1 }),
          reviewDisposition: 'partial'
        }}
        cells={['partial']}
      />
    )
    expect(
      screen.getByText('Document review · Approve with changes · Finish outstanding · work noted')
    ).toBeTruthy()

    rerender(
      <RunRowProgress
        typeLabel="Test request"
        state={{ state: 'part-answered', answered: 2, total: 4, completedAt: null }}
        cells={['pass', 'fail', 'unanswered', 'unanswered']}
      />
    )
    expect(screen.getByText('Test request · 2 of 4 answered')).toBeTruthy()
  })

  test('names Finish as the outstanding action when every required check is answered', () => {
    render(
      <RunRowProgress
        typeLabel="Test request"
        state={{ state: 'all-answered', answered: 9, total: 9, completedAt: null }}
        cells={Array.from({ length: 9 }, () => 'pass')}
      />
    )

    expect(screen.getByText('Test request · 9 of 9 answered · Finish outstanding')).toBeTruthy()
  })

  test('never calls decision picks comments', () => {
    render(
      <RunRowProgress
        typeLabel="Document review"
        state={{
          state: 'part-answered',
          answered: 0,
          total: 1,
          completedAt: null,
          evidence: evidence({ decisions: 2 })
        }}
        cells={['unanswered']}
      />
    )
    expect(screen.getByText('Document review · 2 decisions answered')).toBeTruthy()
    expect(screen.queryByText(/comment/i)).toBeNull()
  })

  test('phrases a skip disposition as an action instead of denying progress', () => {
    render(
      <RunRowProgress
        typeLabel="Document review"
        state={{
          state: 'all-answered',
          answered: 1,
          total: 1,
          completedAt: null,
          reviewDisposition: 'skip'
        }}
        cells={['skip']}
      />
    )
    expect(
      screen.getByText('Document review · Marked not reviewed · Finish outstanding')
    ).toBeTruthy()
  })

  test('composes degraded and parked-only request shapes with their history', () => {
    const { rerender } = render(
      <RunRowProgress
        typeLabel="Test request"
        state={{
          state: 'never-opened',
          shape: 'degraded',
          answered: 0,
          total: 0,
          completedAt: null
        }}
        cells={[]}
      />
    )
    expect(
      screen.getByText('Test request · Plain request — no checks to answer · Not opened yet')
    ).toBeTruthy()

    rerender(
      <RunRowProgress
        typeLabel="Test request"
        state={{
          state: 'part-answered',
          shape: 'degraded',
          answered: 0,
          total: 0,
          completedAt: null,
          evidence: evidence({ observations: 3 })
        }}
        cells={[]}
      />
    )
    expect(
      screen.getByText('Test request · Plain request — no checks to answer · 3 observations')
    ).toBeTruthy()

    rerender(
      <RunRowProgress
        typeLabel="Test request"
        state={{
          state: 'opened',
          shape: 'parked-only',
          answered: 0,
          total: 0,
          completedAt: null
        }}
        cells={[]}
      />
    )
    expect(
      screen.getByText('Test request · Optional checks only · Opened — no work noted yet')
    ).toBeTruthy()

    rerender(
      <RunRowProgress
        typeLabel="Test request"
        state={{
          state: 'part-answered',
          shape: 'parked-only',
          answered: 0,
          total: 0,
          completedAt: null,
          evidence: evidence({ statuses: 1 })
        }}
        cells={[]}
      />
    )
    expect(screen.getByText('Test request · Optional checks only · 1 answered')).toBeTruthy()
  })

  test('shows non-verdict test work without pretending nothing was answered', () => {
    render(
      <RunRowProgress
        typeLabel="Test request"
        state={{
          state: 'part-answered',
          answered: 0,
          total: 2,
          completedAt: null,
          evidence: evidence({ observations: 1 })
        }}
        cells={['unanswered', 'unanswered']}
      />
    )

    expect(screen.getByText('Test request · Work noted · 0 of 2 answered')).toBeTruthy()
  })

  test('says nothing about openedness while inbox state is unknown', () => {
    render(
      <RunRowProgress
        typeLabel="Test request"
        state={{ state: 'unknown', answered: 0, total: 4, completedAt: null }}
        cells={['unanswered', 'unanswered', 'unanswered', 'unanswered']}
      />
    )

    expect(screen.getByText('Test request')).toBeTruthy()
    expect(screen.queryByText(/opened/i)).toBeNull()
  })

  test('renders one scoped mini-spine cell per request check', () => {
    const { container } = render(
      <RunRowProgress
        typeLabel="Test request"
        state={{ state: 'part-answered', answered: 2, total: 3, completedAt: null }}
        cells={['pass', 'fail', 'unanswered']}
      />
    )

    expect(container.querySelectorAll('.drow2-progress .mini i')).toHaveLength(3)
  })

  test('puts the status pill on its own line below the progress bar', () => {
    const { container } = render(
      <RunRowProgress
        typeLabel="Test request"
        state={{ state: 'part-answered', answered: 1, total: 3, completedAt: null }}
        cells={['pass', 'unanswered', 'unanswered']}
      />
    )

    const progress = container.querySelector('.drow2-progress')!
    const bar = progress.querySelector(':scope > .drow2-progress-bar')!
    const status = progress.querySelector(':scope > .drow2-status')!

    expect(bar).toBeTruthy()
    expect(bar.querySelector('.mini')).toBeTruthy()
    expect(status.textContent).toBe('1 of 3 answered')
    expect([...progress.children]).toEqual([bar, status])
  })
})
