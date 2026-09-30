import { describe, expect, test } from 'vitest'
import { isReviewRun, reviewOutcomeLabel } from '../format'
import { miniSpineCells } from '../inbox'
import { projectRounds } from '../project'
import type { SerializableRun, QaSnapshot } from '../../../../shared/ipc'
import type { ItemStatus, QaReport, RunStatus } from '../../../../main/qa/types'

function reviewReport(status: ItemStatus, completedAt?: string): QaReport {
  return {
    id: 'r',
    title: 'PRD review',
    startedAt: '2026-07-20T09:00:00.000Z',
    completedAt,
    noteFiles: [],
    items: [
      {
        id: 'document',
        title: 'PRD review',
        status,
        comment: '',
        flagged: [],
        quotes: [],
        screenshots: []
      }
    ]
  }
}

function reviewRun(opts: {
  path?: string
  status?: RunStatus
  report?: QaReport | null
  gate?: string
}): SerializableRun {
  return {
    request: {
      id: 'r',
      title: 'PRD review',
      labels: { kind: 'doc-review', ...(opts.gate ? { gate: opts.gate } : {}) },
      mode: 'doc-review',
      items: [], // a doc-review request never has items (ADR-0007 §4)
      parked: [],
      degraded: false,
      document: { headings: [], bodyMarkdown: '' },
      raw: '',
      path: opts.path ?? '/qa/tallyboard/2026-07-20-review-prd.md'
    },
    report: opts.report ?? null,
    status: opts.status ?? 'waiting',
    project: 'tallyboard',
    round: null
  }
}

function snapshot(runs: SerializableRun[]): QaSnapshot {
  return {
    root: '/qa',
    rootMissing: false,
    runs,
    notes: [],
    entries: [],
    threads: [],
    handoffs: [],
    releases: [],
    pools: [],
    projects: [],
    scannedAt: ''
  }
}

describe('reviewOutcomeLabel — done-review display (never the wire enum)', () => {
  test('maps every disposition to its outcome wording', () => {
    expect(reviewOutcomeLabel('pass')).toBe('Approved')
    expect(reviewOutcomeLabel('partial')).toBe('Approved with changes')
    expect(reviewOutcomeLabel('fail')).toBe('Needs rework')
    expect(reviewOutcomeLabel('skip')).toBe('Not reviewed')
    expect(reviewOutcomeLabel('unanswered')).toBe('Not reviewed')
  })
})

describe('isReviewRun', () => {
  test('normalised mode is the review switch, independent of the raw kind label', () => {
    expect(isReviewRun(reviewRun({}))).toBe(true)
    const mixedCase = reviewRun({})
    mixedCase.request.labels.kind = 'Doc-Review'
    expect(isReviewRun(mixedCase)).toBe(true)
    const testRun = reviewRun({})
    testRun.request.mode = 'test'
    expect(isReviewRun(testRun)).toBe(false)
  })
})

describe('miniSpineCells for reviews — one document, one cell', () => {
  test('no report yet → a single unanswered cell (not an empty spine)', () => {
    expect(miniSpineCells(reviewRun({}))).toEqual(['unanswered'])
  })

  test('the cell is the disposition once a report exists', () => {
    expect(miniSpineCells(reviewRun({ report: reviewReport('partial') }))).toEqual(['partial'])
  })
})

describe('round rollups treat reviews as runs, partial as today (ADR-0007 §2)', () => {
  test('reviews count in run totals and done counts', () => {
    const s = snapshot([
      reviewRun({ status: 'done', report: reviewReport('pass', '2026-07-20T10:00:00.000Z') })
    ])
    const rounds = projectRounds(s, 'tallyboard')
    expect(rounds[0].rollup.runs).toBe(1)
    expect(rounds[0].rollup.done).toBe(1)
  })

  test('a stamped approved-with-changes review passes its gate — no special case', () => {
    const s = snapshot([
      reviewRun({
        status: 'done',
        gate: '4',
        report: reviewReport('partial', '2026-07-20T10:00:00.000Z')
      })
    ])
    expect(projectRounds(s, 'tallyboard')[0].rollup.gates).toEqual([{ label: '4', passed: true }])
  })

  test('a needs-rework review fails its gate exactly like a fail verdict', () => {
    const s = snapshot([
      reviewRun({
        status: 'done',
        gate: '4',
        report: reviewReport('fail', '2026-07-20T10:00:00.000Z')
      })
    ])
    expect(projectRounds(s, 'tallyboard')[0].rollup.gates).toEqual([{ label: '4', passed: false }])
  })
})
