import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ItemStatus, QaReport, QaRequest, ReportItem } from '../../../../main/qa/types'
import type { QaSnapshot, SerializableRun } from '../../../../shared/ipc'
import { runRowState } from '../../lib/roadmap'

/**
 * What a review row says in each state, plus the row-honesty claims that ride
 * with it: no wire enum in a label, finished runs still visible, and no progress
 * claim on a request that has no checks.
 */

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

import { RunRowProgress } from '../Dashboard'

const ROW_NOW = new Date('2026-07-27T12:00:00')

const REVIEW_PATH = '/qa/dev-traffic-control/2026-01-20-review-export-build-plan.md'
const DISPOSITIONS: ItemStatus[] = ['pass', 'partial', 'fail', 'skip']
/** The on-disk enum — none of it may ever reach a row. */
const WIRE_ENUM = /\b(pass|partial|fail|skip|unanswered)\b/i

function reviewRequest(overrides: Partial<QaRequest> = {}): QaRequest {
  return {
    id: 'review-export-build-plan',
    title: 'Review — export build plan',
    labels: { kind: 'Doc-Review' },
    mode: 'doc-review',
    items: [],
    parked: [],
    degraded: false,
    raw: '',
    path: REVIEW_PATH,
    document: { headings: [], bodyMarkdown: '' },
    ...overrides
  }
}

function documentItem(status: ItemStatus, overrides: Partial<ReportItem> = {}): ReportItem {
  return {
    id: 'document',
    title: 'Review — export build plan',
    status,
    comment: '',
    flagged: [],
    quotes: [],
    screenshots: [],
    ...overrides
  }
}

function reviewReport(item: ReportItem, overrides: Partial<QaReport> = {}): QaReport {
  return {
    id: 'review-export-build-plan',
    title: 'Review — export build plan',
    startedAt: '2026-07-20T09:00:00',
    noteFiles: [],
    items: [item],
    ...overrides
  }
}

function run(request: QaRequest, report: QaReport | null): SerializableRun {
  return {
    request,
    report,
    status: report ? (report.completedAt ? 'done' : 'in-progress') : 'waiting',
    project: 'dev-traffic-control',
    round: null
  }
}

/** The whole label a row shows, derived through the real state machine. */
function rowLabel(
  candidate: SerializableRun,
  seen: ReadonlySet<string> = new Set(),
  seenLoaded = true
): string {
  const state = runRowState(candidate, seen, seenLoaded, { root: '/qa', runs: [candidate] })
  const { container, unmount } = render(
    <RunRowProgress
      typeLabel={candidate.request.mode === 'doc-review' ? 'Document review' : 'Test request'}
      state={state}
      cells={[]}
      now={ROW_NOW}
    />
  )
  const text = container.querySelector('.drow2-history')?.textContent ?? ''
  unmount()
  return text
}

beforeEach(() => {
  app.snapshot = null
  app.navigate.mockReset()
  app.seen = new Set()
  app.seenLoaded = true
  app.markSeen.mockReset()
  app.back.mockReset()
  app.showToast.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('row labels (a) — what a review row says in each state', () => {
  test('the five row states read as history, never as a fraction of items', () => {
    const waiting = run(reviewRequest(), null)
    expect(rowLabel(waiting)).toBe('Document review · Not opened yet')
    expect(rowLabel(waiting, new Set(['2026-01-20-review-export-build-plan']))).toBe(
      'Document review · Opened — nothing noted yet'
    )
    expect(rowLabel(waiting, new Set(), false)).toBe('Document review')

    const opened = run(reviewRequest(), reviewReport(documentItem('unanswered')))
    expect(rowLabel(opened)).toBe('Document review · Opened — nothing noted yet')

    const commented = run(
      reviewRequest(),
      reviewReport(documentItem('unanswered', { comment: 'The plan needs a gate.' }))
    )
    expect(rowLabel(commented)).toBe('Document review · 1 comment')

    const disposed = run(reviewRequest(), reviewReport(documentItem('partial')))
    expect(rowLabel(disposed)).toBe('Document review · Approve with changes · Finish outstanding')

    const finished = run(
      reviewRequest(),
      reviewReport(documentItem('partial'), { completedAt: '2026-07-20T10:12:00' })
    )
    expect(rowLabel(finished)).toBe('Document review · Approved with changes')

    // No state anywhere produced an "N of M items" fraction.
    for (const candidate of [waiting, opened, commented, disposed, finished]) {
      expect(rowLabel(candidate)).not.toMatch(/\d+\s*(of|\/)\s*\d+/)
      expect(rowLabel(candidate)).not.toMatch(/item/i)
    }
  })
})

describe('row labels (b) — no wire enum can reach a row label', () => {
  test('every reachable review state and disposition reads as prose', () => {
    const seenKeys = new Set(['2026-01-20-review-export-build-plan'])
    const cases: SerializableRun[] = [
      run(reviewRequest(), null),
      run(reviewRequest(), reviewReport(documentItem('unanswered'))),
      run(reviewRequest(), reviewReport(documentItem('unanswered', { comment: 'note' })))
    ]
    for (const disposition of DISPOSITIONS) {
      cases.push(run(reviewRequest(), reviewReport(documentItem(disposition))))
      cases.push(
        run(
          reviewRequest(),
          reviewReport(documentItem(disposition), { completedAt: '2026-07-20T10:12:00' })
        )
      )
      cases.push(
        run(
          reviewRequest(),
          reviewReport(documentItem(disposition, { comment: 'note' }), {
            completedAt: '2026-07-20T10:12:00'
          })
        )
      )
    }

    const labels: string[] = []
    for (const candidate of cases) {
      for (const seen of [new Set<string>(), seenKeys]) {
        for (const seenLoaded of [true, false]) {
          const label = rowLabel(candidate, seen, seenLoaded)
          labels.push(label)
          expect(label, `wire enum leaked into: ${label}`).not.toMatch(WIRE_ENUM)
        }
      }
    }
    // Liveness: the sweep really rendered every case, so the absence above is
    // not the absence of any label at all.
    expect(labels).toHaveLength(cases.length * 4)
    expect(labels.every((label) => label.startsWith('Document review'))).toBe(true)
    expect(new Set(labels).size).toBeGreaterThan(4)
  })

  test('a test request never leaks the enum either, fraction or not', () => {
    const testRequest: QaRequest = {
      id: 'checks',
      title: 'Two checks',
      labels: {},
      mode: 'test',
      items: [
        { id: 'one', title: 'One', steps: [], expected: [], notes: [] },
        { id: 'two', title: 'Two', steps: [], expected: [], notes: [] }
      ],
      parked: [],
      degraded: false,
      raw: '',
      path: '/qa/dev-traffic-control/2026-07-20-two-checks.md'
    }
    const seen: string[] = []
    for (const first of DISPOSITIONS) {
      for (const second of [...DISPOSITIONS, 'unanswered' as ItemStatus]) {
        const report: QaReport = {
          id: 'checks',
          title: 'Two checks',
          startedAt: '2026-07-20T09:00:00',
          noteFiles: [],
          items: [
            { ...documentItem(first), id: 'one', title: 'One' },
            { ...documentItem(second), id: 'two', title: 'Two' }
          ]
        }
        const label = rowLabel(run(testRequest, report))
        seen.push(label)
        expect(label, `wire enum leaked into: ${label}`).not.toMatch(WIRE_ENUM)
      }
    }
    // Liveness: the sweep produced the real fraction labels, so the enum's
    // absence above is the absence of an enum, not of a label.
    expect(seen).toHaveLength(20)
    expect(seen).toContain('Test request · 2 of 2 answered · Finish outstanding')
    expect(seen).toContain('Test request · 1 of 2 answered')
  })
})

describe('a request with no checks makes no progress claim', () => {
  test('degraded and parked-only rows never state a fraction or a denominator', () => {
    const base: Omit<QaRequest, 'id' | 'title' | 'path'> = {
      labels: {},
      mode: 'test',
      items: [],
      parked: [],
      degraded: false,
      raw: 'Plain body.',
      notes: undefined
    } as unknown as Omit<QaRequest, 'id' | 'title' | 'path'>

    const degraded = run(
      {
        ...base,
        id: 'broken',
        title: 'Broken request',
        degraded: true,
        path: '/qa/dev-traffic-control/2026-07-20-broken.md'
      } as QaRequest,
      null
    )
    const parkedOnly = run(
      {
        ...base,
        id: 'optional',
        title: 'Optional only',
        parked: [{ id: 'also-export', text: 'Try the export sheet' }],
        path: '/qa/dev-traffic-control/2026-07-20-optional.md'
      } as QaRequest,
      null
    )
    const degradedWithWork = run(
      { ...(degraded.request as QaRequest) },
      {
        id: 'broken',
        title: 'Broken request',
        startedAt: '2026-07-20T09:00:00',
        noteFiles: [],
        items: [],
        observations: [{ id: 'obs-1', text: 'The header clips.', screenshots: [] }]
      }
    )

    for (const candidate of [degraded, parkedOnly, degradedWithWork]) {
      const label = rowLabel(candidate)
      expect(label, label).not.toMatch(/\d+\s*(of|\/)\s*\d+/)
      expect(label, label).not.toMatch(/\b0\b/)
      expect(label, label).not.toMatch(WIRE_ENUM)
    }
    expect(rowLabel(degraded)).toBe(
      'Test request · Plain request — no checks to answer · Not opened yet'
    )
    expect(rowLabel(parkedOnly)).toBe('Test request · Optional checks only · Not opened yet')
    expect(rowLabel(degradedWithWork)).toBe(
      'Test request · Plain request — no checks to answer · 1 observation'
    )
  })
})
