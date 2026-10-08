import { describe, expect, test } from 'vitest'
import {
  projectVitals,
  readyToDispatch,
  recentMovement,
  reportWorkEvidence,
  runAge,
  runRowState as evaluateRunRowState,
  threadsForProject,
  waitingOnYou
} from '../roadmap'
import type { QaSnapshot } from '../../../../shared/ipc'
import { ALL_PROJECTS } from '../../../../shared/windowScope'
import type {
  DecisionAnswer,
  FlagEntry,
  Observation,
  QaReport,
  QuoteEntry,
  ReportItem,
  RequestMode,
  RunStatus,
  SectionMark,
  Thread
} from '../../../../main/qa/types'

const NOW = new Date('2026-07-25T00:00:00.000Z')

describe('threadsForProject', () => {
  test('puts projectless threads only in _unfiled', () => {
    const unfiled = thread({ id: 'unfiled' })
    const rivermill = thread({ id: 'rivermill', projects: ['rivermill'] })

    expect(threadsForProject([unfiled, rivermill], '_unfiled').map((item) => item.id)).toEqual([
      'unfiled'
    ])
    expect(threadsForProject([unfiled, rivermill], 'rivermill').map((item) => item.id)).toEqual([
      'rivermill'
    ])
    expect(threadsForProject([unfiled, rivermill], 'windmill')).toEqual([])
  })

  test('excludes retired threads from an app', () => {
    const open = thread({ id: 'open', projects: ['rivermill'] })
    const retired = thread({ id: 'retired', projects: ['rivermill'], state: 'retired' })

    expect(threadsForProject([open, retired], 'rivermill').map((item) => item.id)).toEqual(['open'])
  })

  test('orders the most recently moved thread first', () => {
    const older = thread({
      id: 'older',
      projects: ['rivermill'],
      lastAt: '2026-08-05T09:00:00.000Z'
    })
    const newer = thread({
      id: 'newer',
      projects: ['rivermill'],
      lastAt: '2026-08-06T09:00:00.000Z'
    })

    expect(threadsForProject([older, newer], 'rivermill').map((item) => item.id)).toEqual([
      'newer',
      'older'
    ])
  })
})

const REPORT_ITEM_KEYS = {
  id: 'id',
  title: 'title',
  status: 'status',
  comment: 'comment',
  flagged: 'flagged',
  quotes: 'quotes',
  screenshots: 'screenshots',
  sectionMarks: 'sectionMarks',
  decisions: 'decisions',
  markups: 'markups',
  removed: 'removed'
} as const satisfies { [Key in keyof ReportItem]-?: Key }

const QA_REPORT_KEYS = {
  id: 'id',
  title: 'title',
  app: 'app',
  version: 'version',
  build: 'build',
  startedAt: 'startedAt',
  completedAt: 'completedAt',
  noteFiles: 'noteFiles',
  mode: 'mode',
  observations: 'observations',
  observationSeq: 'observationSeq',
  items: 'items'
} as const satisfies { [Key in keyof QaReport]-?: Key }

const FLAG_ENTRY_KEYS = {
  expectedIndex: 'expectedIndex',
  text: 'text',
  comment: 'comment'
} as const satisfies { [Key in keyof FlagEntry]-?: Key }

const QUOTE_ENTRY_KEYS = {
  text: 'text',
  comment: 'comment',
  section: 'section',
  number: 'number'
} as const satisfies { [Key in keyof QuoteEntry]-?: Key }

const SECTION_MARK_KEYS = {
  section: 'section',
  comment: 'comment'
} as const satisfies { [Key in keyof SectionMark]-?: Key }

const DECISION_ANSWER_KEYS = {
  id: 'id',
  question: 'question',
  choice: 'choice',
  comment: 'comment',
  markups: 'markups'
} as const satisfies { [Key in keyof DecisionAnswer]-?: Key }

const OBSERVATION_KEYS = {
  id: 'id',
  text: 'text',
  screenshots: 'screenshots',
  markups: 'markups'
} as const satisfies { [Key in keyof Observation]-?: Key }

function thread(p: Partial<Thread> & { id: string }): Thread {
  return {
    title: p.title ?? p.id,
    projects: p.projects ?? [],
    parents: [],
    move: p.move ?? 'nobody',
    form: p.form ?? 'idea',
    state: p.state ?? 'open',
    entries: p.entries ?? [],
    firstAt: p.firstAt ?? '2026-07-20T00:00:00.000Z',
    lastAt: p.lastAt ?? '2026-07-20T00:00:00.000Z',
    ageDays: p.ageDays ?? 0,
    cold: p.cold ?? false,
    dictated: false,
    ...p
  }
}

function snap(
  threads: Thread[],
  runs: QaSnapshot['runs'] = [],
  projects: string[] = []
): QaSnapshot {
  return {
    root: '/qa',
    rootMissing: false,
    runs,
    notes: [],
    entries: [],
    threads,
    handoffs: [],
    releases: [],
    pools: [],
    projects,
    scannedAt: ''
  }
}

function run(opts: {
  path: string
  mode?: RequestMode
  labels?: Record<string, string>
  status?: RunStatus
  itemIds?: string[]
  report?: QaReport | null
  project?: string
}): QaSnapshot['runs'][number] {
  return {
    request: {
      id: 'request',
      title: 'Request',
      labels: opts.labels ?? {},
      mode: opts.mode ?? 'test',
      items: (opts.itemIds ?? ['one', 'two']).map((id) => ({
        id,
        title: id,
        steps: [],
        expected: [],
        notes: []
      })),
      parked: [],
      degraded: false,
      raw: '',
      path: opts.path
    },
    report: opts.report ?? null,
    status:
      opts.status ?? (opts.report?.completedAt ? 'done' : opts.report ? 'in-progress' : 'waiting'),
    project: opts.project ?? 'dev-traffic-control',
    round: null
  }
}

function runRowState(
  candidate: QaSnapshot['runs'][number],
  seen: ReadonlySet<string>,
  seenLoaded = true
): ReturnType<typeof evaluateRunRowState> {
  return evaluateRunRowState(candidate, seen, seenLoaded, {
    root: '/qa',
    runs: [candidate]
  })
}

function report(
  statuses: Array<{ id: string; status: QaReport['items'][number]['status'] }>,
  options: { completedAt?: string; mode?: 'light' } = {}
): QaReport {
  return {
    id: 'request',
    title: 'Request',
    startedAt: '2026-07-27T08:00:00.000Z',
    completedAt: options.completedAt,
    mode: options.mode,
    noteFiles: [],
    items: statuses.map(({ id, status }) => ({
      id,
      title: id,
      status,
      comment: '',
      flagged: [],
      quotes: [],
      screenshots: []
    }))
  }
}

function evidenceReport(
  item: Partial<ReportItem> = {},
  reportOverrides: Partial<QaReport> = {}
): QaReport {
  return {
    ...report([{ id: 'one', status: 'unanswered' }]),
    ...reportOverrides,
    items: [
      {
        ...report([{ id: 'one', status: 'unanswered' }]).items[0],
        ...item
      }
    ]
  }
}

function reviewRowState(
  status: QaReport['items'][number]['status'],
  withNote: boolean
): ReturnType<typeof runRowState> {
  const reviewReport = report([{ id: 'document', status }])
  if (withNote) {
    reviewReport.items[0].quotes = [{ text: 'Quoted line', comment: 'Change this' }]
  }
  return runRowState(
    run({
      path: '/qa/dev-traffic-control/2026-07-27-review.md',
      mode: 'doc-review',
      labels: { kind: 'Doc-Review' },
      itemIds: [],
      report: reviewReport
    }),
    new Set()
  )
}

describe('runRowState', () => {
  test('surfaces an invalid report as a stable error state instead of reading its items', () => {
    const candidate = run({ path: '/qa/dev-traffic-control/invalid.md' })
    candidate.reportError = 'Invalid report: items must be an array'

    expect(runRowState(candidate, new Set())).toMatchObject({
      state: 'report-error',
      answered: 0,
      completedAt: null
    })
  })

  test('is unknown until the renderer has loaded inbox state', () => {
    const state = runRowState(
      run({ path: '/qa/dev-traffic-control/2026-07-27-loading.md' }),
      new Set(),
      false
    )
    expect(state).toEqual({
      state: 'unknown',
      answered: 0,
      total: 2,
      completedAt: null
    })
  })

  test('is never opened when there is no report and its basename is not seen', () => {
    const state = runRowState(run({ path: '/qa/dev-traffic-control/2026-07-27-new.md' }), new Set())
    expect(state).toEqual({
      state: 'never-opened',
      answered: 0,
      total: 2,
      completedAt: null
    })
  })

  test('is opened when it is seen but nothing is answered', () => {
    const state = runRowState(
      run({ path: '/qa/dev-traffic-control/2026-07-27-opened.md' }),
      new Set(['2026-07-27-opened'])
    )
    expect(state).toEqual({ state: 'opened', answered: 0, total: 2, completedAt: null })
  })

  test('is part answered with check counts while the run is unfinished', () => {
    const state = runRowState(
      run({
        path: '/qa/dev-traffic-control/2026-07-27-part.md',
        report: report([
          { id: 'one', status: 'pass' },
          { id: 'two', status: 'unanswered' }
        ])
      }),
      new Set(['2026-07-27-part'])
    )
    expect(state).toEqual({
      state: 'part-answered',
      answered: 1,
      total: 2,
      completedAt: null
    })
  })

  test('is all answered with Finish still outstanding when every required check has an answer', () => {
    const state = runRowState(
      run({
        path: '/qa/dev-traffic-control/2026-07-27-all-answered.md',
        report: report([
          { id: 'one', status: 'pass' },
          { id: 'two', status: 'fail' }
        ])
      }),
      new Set(['2026-07-27-all-answered'])
    )

    expect(state).toEqual({
      state: 'all-answered',
      answered: 2,
      total: 2,
      completedAt: null
    })
  })

  test('stays all answered when an answered parked item is materialised outside the denominator', () => {
    const withParkedAnswer = run({
      path: '/qa/dev-traffic-control/2026-07-27-all-answered-with-parked.md',
      report: report([
        { id: 'one', status: 'pass' },
        { id: 'two', status: 'pass' },
        { id: 'also-export', status: 'fail' }
      ])
    })
    withParkedAnswer.request.parked = [{ id: 'also-export', text: 'Try the export sheet' }]

    expect(runRowState(withParkedAnswer, new Set())).toEqual({
      state: 'all-answered',
      answered: 2,
      total: 2,
      completedAt: null,
      evidence: expect.objectContaining({ hasWork: true, statuses: 3 })
    })
  })

  test('is finished and carries the completion time', () => {
    const completedAt = '2026-07-27T09:12:00.000Z'
    const state = runRowState(
      run({
        path: '/qa/dev-traffic-control/2026-07-27-finished.md',
        report: report([{ id: 'one', status: 'pass' }], { completedAt })
      }),
      new Set()
    )
    expect(state).toEqual({ state: 'finished', answered: 1, total: 2, completedAt })
  })

  test('does not count parked answers in the denominator but does recognise the work', () => {
    const state = runRowState(
      run({
        path: '/qa/dev-traffic-control/2026-07-27-parked.md',
        report: report([
          { id: 'one', status: 'unanswered' },
          { id: 'two', status: 'unanswered' },
          { id: 'also-optional', status: 'pass' }
        ])
      }),
      new Set(['2026-07-27-parked'])
    )
    expect(state).toEqual({
      state: 'part-answered',
      answered: 0,
      total: 2,
      completedAt: null,
      evidence: expect.objectContaining({ hasWork: true, statuses: 1 })
    })
  })

  test('derives progress from a light report without changing the state vocabulary', () => {
    const state = runRowState(
      run({
        path: '/qa/dev-traffic-control/2026-07-27-light.md',
        mode: 'light',
        report: report(
          [
            { id: 'one', status: 'fail' },
            { id: 'two', status: 'unanswered' }
          ],
          { mode: 'light' }
        )
      }),
      new Set(['2026-07-27-light'])
    )
    expect(state).toEqual({
      state: 'part-answered',
      answered: 1,
      total: 2,
      completedAt: null
    })
  })

  test('counts substantive review work without inventing a heading denominator', () => {
    const reviewReport = report([{ id: 'document', status: 'unanswered' }])
    reviewReport.items[0] = {
      ...reviewReport.items[0],
      comment: 'Overall note',
      quotes: [{ text: 'Quoted line', comment: 'Change this' }],
      sectionMarks: [{ section: 'scope', comment: 'Rework this section' }],
      decisions: [
        { id: 'shape', question: 'Which shape?', choice: 'Option B' },
        { id: 'empty', question: 'Unanswered decision', choice: '' }
      ]
    }

    const state = runRowState(
      run({
        path: '/qa/dev-traffic-control/2026-07-27-review.md',
        mode: 'doc-review',
        labels: { kind: 'Doc-Review' },
        itemIds: [],
        report: reviewReport
      }),
      new Set()
    )

    expect(state).toEqual({
      state: 'part-answered',
      answered: 0,
      total: 1,
      completedAt: null,
      evidence: {
        hasWork: true,
        statuses: 0,
        comments: 3,
        flags: 0,
        quotes: 1,
        sectionMarks: 1,
        decisions: 1,
        screenshots: 0,
        observations: 0,
        noteFiles: 0
      }
    })
  })

  test('a review with only a disposition is all answered with Finish outstanding', () => {
    expect(reviewRowState('partial', false)).toEqual({
      state: 'all-answered',
      answered: 1,
      total: 1,
      completedAt: null,
      reviewDisposition: 'partial'
    })
  })

  test('a review with only notes is part answered without inventing a disposition', () => {
    expect(reviewRowState('unanswered', true)).toEqual({
      state: 'part-answered',
      answered: 0,
      total: 1,
      completedAt: null,
      evidence: expect.objectContaining({ comments: 1, quotes: 1 })
    })
  })

  test('an all-answered review with notes carries both facts', () => {
    expect(reviewRowState('partial', true)).toEqual({
      state: 'all-answered',
      answered: 1,
      total: 1,
      completedAt: null,
      evidence: expect.objectContaining({ comments: 1, quotes: 1 }),
      reviewDisposition: 'partial'
    })
  })

  test('a review with neither a disposition nor notes is only opened', () => {
    expect(reviewRowState('unanswered', false)).toEqual({
      state: 'opened',
      answered: 0,
      total: 1,
      completedAt: null
    })
  })

  test('composes degraded and parked-only shapes with openedness and work history', () => {
    const degraded = run({
      path: '/qa/dev-traffic-control/2026-07-27-degraded.md',
      itemIds: []
    })
    degraded.request.degraded = true

    const degradedWithWork = run({
      path: '/qa/dev-traffic-control/2026-07-27-degraded-work.md',
      itemIds: [],
      report: {
        ...report([]),
        items: [],
        observations: [
          { id: 'obs-1', text: 'First observation', screenshots: [] },
          { id: 'obs-2', text: 'Second observation', screenshots: [] },
          { id: 'obs-3', text: 'Third observation', screenshots: [] }
        ]
      }
    })
    degradedWithWork.request.degraded = true

    const parkedOnly = run({
      path: '/qa/dev-traffic-control/2026-07-27-parked-only.md',
      itemIds: [],
      report: report([{ id: 'also-export', status: 'pass' }])
    })
    parkedOnly.request.parked = [{ id: 'also-export', text: 'Try the export sheet' }]

    expect(runRowState(degraded, new Set())).toEqual({
      state: 'never-opened',
      shape: 'degraded',
      answered: 0,
      total: 0,
      completedAt: null
    })
    expect(runRowState(degraded, new Set(['2026-07-27-degraded']))).toEqual({
      state: 'opened',
      shape: 'degraded',
      answered: 0,
      total: 0,
      completedAt: null
    })
    expect(runRowState(degradedWithWork, new Set())).toEqual({
      state: 'part-answered',
      shape: 'degraded',
      answered: 0,
      total: 0,
      completedAt: null,
      evidence: expect.objectContaining({ observations: 3 })
    })
    const parkedState = runRowState(parkedOnly, new Set(['2026-07-27-parked-only']))
    expect(parkedState.state).toBe('part-answered')
    expect(parkedState.shape).toBe('parked-only')
    expect(parkedState.evidence?.statuses).toBe(1)

    const unopenedParked = run({
      path: '/qa/dev-traffic-control/2026-07-27-unopened-parked.md',
      itemIds: []
    })
    unopenedParked.request.parked = [{ id: 'also-export', text: 'Try the export sheet' }]
    expect(runRowState(unopenedParked, new Set())).toEqual({
      state: 'never-opened',
      shape: 'parked-only',
      answered: 0,
      total: 0,
      completedAt: null
    })
  })
})

describe('reportWorkEvidence', () => {
  test('the explicit top-level and nested key lists are exhaustive type contracts', () => {
    expect(Object.keys(REPORT_ITEM_KEYS)).toEqual([
      'id',
      'title',
      'status',
      'comment',
      'flagged',
      'quotes',
      'screenshots',
      'sectionMarks',
      'decisions',
      'markups',
      'removed'
    ])
    expect(Object.keys(QA_REPORT_KEYS)).toEqual([
      'id',
      'title',
      'app',
      'version',
      'build',
      'startedAt',
      'completedAt',
      'noteFiles',
      'mode',
      'observations',
      'observationSeq',
      'items'
    ])
    expect(Object.keys(FLAG_ENTRY_KEYS)).toEqual(['expectedIndex', 'text', 'comment'])
    expect(Object.keys(QUOTE_ENTRY_KEYS)).toEqual(['text', 'comment', 'section', 'number'])
    expect(Object.keys(SECTION_MARK_KEYS)).toEqual(['section', 'comment'])
    expect(Object.keys(DECISION_ANSWER_KEYS)).toEqual([
      'id',
      'question',
      'choice',
      'comment',
      'markups'
    ])
    expect(Object.keys(OBSERVATION_KEYS)).toEqual(['id', 'text', 'screenshots', 'markups'])
  })

  test.each([
    ['no report', null, false],
    ['empty report', { ...report([]), items: [] }, false],
    ['status only', evidenceReport({ status: 'pass' }), true],
    ['comment only', evidenceReport({ comment: 'The row shifts.' }), true],
    [
      'flagged only',
      evidenceReport({ flagged: [{ expectedIndex: 0, text: 'Aligned', comment: '' }] }),
      true
    ],
    ['quotes only', evidenceReport({ quotes: [{ text: 'Quoted line', comment: '' }] }), true],
    [
      'section marks only',
      evidenceReport({ sectionMarks: [{ section: 'scope', comment: '' }] }),
      true
    ],
    [
      'answered decisions only',
      evidenceReport({
        decisions: [{ id: 'shape', question: 'Which shape?', choice: 'Ledger' }]
      }),
      true
    ],
    [
      'parked decisions only',
      evidenceReport({
        decisions: [{ id: 'shape', question: 'Which shape?', choice: '' }]
      }),
      false
    ],
    ['screenshots only', evidenceReport({ screenshots: ['request.shots/one-1.png'] }), true],
    [
      'observations only',
      evidenceReport(
        {},
        {
          observations: [{ id: 'obs-1', text: 'The tray flickers.', screenshots: [] }]
        }
      ),
      true
    ],
    ['linked note files only', evidenceReport({}, { noteFiles: ['2026-07-27-note.md'] }), true],
    ['disposition only', evidenceReport({ id: 'document', status: 'partial' }), true],
    ['removed item work', evidenceReport({ status: 'fail', removed: true }), true],
    ['light report work', evidenceReport({ status: 'pass' }, { mode: 'light' }), true],
    ['document-review work', evidenceReport({ id: 'document', comment: 'Tighten this.' }), true],
    ['finished stamp only', evidenceReport({}, { completedAt: '2026-07-27T12:00:00.000Z' }), false],
    ['reopened work', evidenceReport({ status: 'pass' }, { completedAt: undefined }), true]
  ])('%s is classified without a mode-specific predicate', (_name, value, expected) => {
    expect(reportWorkEvidence(value).hasWork).toBe(expected)
  })

  test('counts decision picks separately from actual comments', () => {
    const evidence = reportWorkEvidence(
      evidenceReport({
        decisions: [
          { id: 'one', question: 'First?', choice: 'A' },
          { id: 'two', question: 'Second?', choice: 'B' }
        ]
      })
    )

    expect(evidence.decisions).toBe(2)
    expect(evidence.comments).toBe(0)
  })
})

describe('runAge', () => {
  test('prefers report startedAt, then request mtime, before the day-granular request date', () => {
    const withReport = run({
      path: '/qa/dev-traffic-control/2026-07-27-age.md',
      report: report([])
    })
    withReport.request.date = '2026-07-01'
    withReport.requestMtime = '2026-07-27T11:55:00.000Z'
    withReport.report!.startedAt = '2026-07-27T11:58:00.000Z'

    expect(runAge(withReport)).toBe('2026-07-27T11:58:00.000Z')

    withReport.report = null
    expect(runAge(withReport)).toBe('2026-07-27T11:55:00.000Z')

    withReport.requestMtime = undefined
    expect(runAge(withReport)).toBe('2026-07-01')
  })
})

describe('waitingOnYou', () => {
  test('includes move:me threads and open runs, oldest first, excludes retired', () => {
    const s = snap(
      [
        thread({ id: 'fresh', move: 'me', lastAt: '2026-07-24T00:00:00.000Z' }),
        thread({ id: 'stale', move: 'me', lastAt: '2026-07-11T00:00:00.000Z', cold: true }),
        thread({ id: 'agents', move: 'agent', lastAt: '2026-07-24T00:00:00.000Z' }),
        thread({ id: 'gone', move: 'me', state: 'retired', lastAt: '2026-07-24T00:00:00.000Z' })
      ],
      [
        {
          request: {
            id: 'r',
            title: 'Test me',
            labels: {},
            mode: 'test',
            items: [],
            parked: [],
            degraded: false,
            raw: '',
            path: '/qa/p/2026-07-20-r.md'
          },
          report: null,
          status: 'waiting',
          project: 'p',
          round: null
        }
      ]
    )
    const items = waitingOnYou(s, ALL_PROJECTS, NOW)
    const keys = items.map((i) => i.key)
    expect(keys).toContain('thread:stale')
    expect(keys).toContain('thread:fresh')
    expect(keys).toContain('run:/qa/p/2026-07-20-r.md')
    expect(keys).not.toContain('thread:agents') // agent's move
    expect(keys).not.toContain('thread:gone') // retired
    // Oldest first: the cold 07-11 thread precedes the 07-24 thread.
    expect(keys.indexOf('thread:stale')).toBeLessThan(keys.indexOf('thread:fresh'))
  })

  test('carries run history and check cells into a queue row', () => {
    const requestPath = '/qa/dev-traffic-control/2026-07-27-progress.md'
    const s = snap(
      [],
      [
        run({
          path: requestPath,
          report: report([
            { id: 'one', status: 'pass' },
            { id: 'two', status: 'unanswered' }
          ])
        })
      ]
    )

    const item = waitingOnYou(s, ALL_PROJECTS, NOW, new Set(['2026-07-27-progress']))[0]
    expect(item.runState).toEqual({
      state: 'part-answered',
      answered: 1,
      total: 2,
      completedAt: null
    })
    expect(item.runCells).toEqual(['pass', 'unanswered'])
  })

  test('passes the loaded seen set through to a reportless queue row', () => {
    const requestPath = '/qa/dev-traffic-control/2026-07-27-seen.md'
    const item = waitingOnYou(
      snap([], [run({ path: requestPath })]),
      ALL_PROJECTS,
      NOW,
      new Set(['2026-07-27-seen'])
    )[0]

    expect(item.runState?.state).toBe('opened')
  })

  test('uses normalised mode for review labels and the one-cell document spine', () => {
    const review = run({
      path: '/qa/dev-traffic-control/2026-07-27-review.md',
      mode: 'doc-review',
      labels: { kind: 'Doc-Review' },
      itemIds: []
    })

    const item = waitingOnYou(snap([], [review]), ALL_PROJECTS, NOW, new Set())
    expect(item[0].formLabel).toBe('Review')
    expect(item[0].runCells).toEqual(['unanswered'])
  })
})

describe('recentMovement', () => {
  test('keeps a just-finished run reachable with its finished row state', () => {
    const completedAt = '2026-07-27T09:12:00.000Z'
    const requestPath = '/qa/dev-traffic-control/2026-07-27-finished.md'
    const s = snap(
      [],
      [
        run({
          path: requestPath,
          report: report(
            [
              { id: 'one', status: 'pass' },
              { id: 'two', status: 'fail' }
            ],
            { completedAt }
          )
        })
      ]
    )

    expect(recentMovement(s, ALL_PROJECTS)).toEqual([
      expect.objectContaining({
        key: `done:${requestPath}`,
        at: completedAt,
        target: { kind: 'runner', path: requestPath },
        runState: {
          state: 'finished',
          answered: 2,
          total: 2,
          completedAt
        },
        runCells: ['pass', 'fail']
      })
    ])
  })
})

describe('projectVitals', () => {
  test('counts you/agents per project across threads', () => {
    const s = snap(
      [
        thread({ id: 'a', move: 'me', projects: ['dev-traffic-control'] }),
        thread({ id: 'b', move: 'agent', projects: ['dev-traffic-control'] }),
        thread({ id: 'c', move: 'agent', projects: ['beacon'] })
      ],
      [],
      ['dev-traffic-control', 'beacon']
    )
    const v = projectVitals(s, ALL_PROJECTS, NOW)
    const qa = v.find((x) => x.project === 'dev-traffic-control')!
    expect(qa.you).toBe(1)
    expect(qa.agents).toBe(1)
    expect(qa.openThreads).toBe(2)
  })
})

describe('readyToDispatch', () => {
  test('is the agent-move, non-retired threads', () => {
    const s = snap([
      thread({ id: 'a', move: 'agent' }),
      thread({ id: 'b', move: 'me' }),
      thread({ id: 'c', move: 'agent', state: 'retired' })
    ])
    expect(readyToDispatch(s, ALL_PROJECTS).map((t) => t.id)).toEqual(['a'])
  })
})

// ---------------------------------------------------------------------------
// Dashboard is the landing surface, and it never read the scope, so
// picking a project in the rail changed the titlebar and nothing else. Every
// section is built from the scope passed in as an argument — no context, no
// rendering, so the scoping itself is what these assert.

const WINDMILL = { kind: 'project', slug: 'windmill' } as const

describe('the window scope decides what the Dashboard shows', () => {
  function fleet(): QaSnapshot {
    return snap(
      [
        thread({
          id: 'wf-owed',
          move: 'me',
          projects: ['windmill'],
          lastAt: '2026-07-24T00:00:00.000Z',
          entries: [
            {
              path: '/qa/windmill/entry.md',
              thread: 'wf-owed',
              at: '2026-07-24T00:00:00.000Z',
              by: 'agent',
              writtenBy: 'agent',
              projects: ['windmill'],
              labels: {},
              body: 'moved',
              parents: [],
              dictation: false
            }
          ]
        }),
        thread({
          id: 'rf-owed',
          move: 'me',
          projects: ['rivermill'],
          lastAt: '2026-07-23T00:00:00.000Z',
          entries: [
            {
              path: '/qa/rivermill/entry.md',
              thread: 'rf-owed',
              at: '2026-07-23T00:00:00.000Z',
              by: 'agent',
              writtenBy: 'agent',
              projects: ['rivermill'],
              labels: {},
              body: 'moved',
              parents: [],
              dictation: false
            }
          ]
        }),
        thread({ id: 'wf-agent', move: 'agent', projects: ['windmill'] }),
        thread({ id: 'rf-agent', move: 'agent', projects: ['rivermill'] })
      ],
      [
        run({ path: '/qa/windmill/2026-07-20-a.md', project: 'windmill' }),
        run({ path: '/qa/rivermill/2026-07-21-b.md', project: 'rivermill' })
      ],
      ['windmill', 'rivermill']
    )
  }

  test('Waiting on you keeps every project under All projects', () => {
    expect(
      waitingOnYou(fleet(), ALL_PROJECTS, NOW)
        .map((item) => item.key)
        .sort()
    ).toEqual([
      'run:/qa/rivermill/2026-07-21-b.md',
      'run:/qa/windmill/2026-07-20-a.md',
      'thread:rf-owed',
      'thread:wf-owed'
    ])
  })

  test('Waiting on you keeps only the project in scope', () => {
    expect(
      waitingOnYou(fleet(), WINDMILL, NOW)
        .map((item) => item.key)
        .sort()
    ).toEqual(['run:/qa/windmill/2026-07-20-a.md', 'thread:wf-owed'])
  })

  test('Project vitals lists one project in a project scope and all of them under All projects', () => {
    expect(
      projectVitals(fleet(), ALL_PROJECTS, NOW)
        .map((v) => v.project)
        .sort()
    ).toEqual(['rivermill', 'windmill'])
    expect(projectVitals(fleet(), WINDMILL, NOW).map((v) => v.project)).toEqual(['windmill'])
  })

  test('Ready to dispatch follows the scope', () => {
    expect(
      readyToDispatch(fleet(), ALL_PROJECTS)
        .map((t) => t.id)
        .sort()
    ).toEqual(['rf-agent', 'wf-agent'])
    expect(readyToDispatch(fleet(), WINDMILL).map((t) => t.id)).toEqual(['wf-agent'])
  })

  test('Recent movement follows the scope', () => {
    expect(
      recentMovement(fleet(), ALL_PROJECTS)
        .map((m) => m.key)
        .sort()
    ).toEqual(['entry:/qa/rivermill/entry.md', 'entry:/qa/windmill/entry.md'])
    expect(recentMovement(fleet(), WINDMILL).map((m) => m.key)).toEqual([
      'entry:/qa/windmill/entry.md'
    ])
  })

  test('a thread filed under no project shows only under All projects', () => {
    const s = snap([thread({ id: 'loose', move: 'me', lastAt: '2026-07-24T00:00:00.000Z' })])
    expect(waitingOnYou(s, ALL_PROJECTS, NOW).map((item) => item.key)).toEqual(['thread:loose'])
    expect(waitingOnYou(s, WINDMILL, NOW)).toEqual([])
  })
})
