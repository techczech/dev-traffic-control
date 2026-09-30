import { describe, expect, test } from 'vitest'
import { archivedRows, inboxCounts, inboxRows, miniSpineCells, requestKey } from '../inbox'
import type { SerializableRun, QaSnapshot } from '../../../../shared/ipc'
import type { QaReport, QaRequest, RunStatus } from '../../../../main/qa/types'
import { ALL_PROJECTS } from '../../../../shared/windowScope'

function request(partial: Partial<QaRequest> & { path: string }): QaRequest {
  return {
    id: partial.id ?? 'id',
    title: partial.title ?? 'Title',
    labels: partial.labels ?? {},
    mode: partial.mode ?? 'test',
    items: partial.items ?? [],
    parked: partial.parked ?? [],
    degraded: partial.degraded ?? false,
    raw: '',
    ...partial
  }
}

function run(opts: {
  project: string
  path: string
  status?: RunStatus
  date?: string
  items?: { id: string; title: string }[]
  report?: QaReport | null
  title?: string
  requestMtime?: string
}): SerializableRun {
  return {
    request: request({
      path: opts.path,
      title: opts.title,
      date: opts.date,
      items: (opts.items ?? []).map((i) => ({ ...i, steps: [], expected: [], notes: [] }))
    }),
    report: opts.report ?? null,
    status: opts.status ?? 'waiting',
    project: opts.project,
    round: null,
    requestMtime: opts.requestMtime
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

function reportForAge(startedAt: string): QaReport {
  return {
    id: 'id',
    title: 'Title',
    startedAt,
    noteFiles: [],
    items: []
  }
}

describe('inboxRows', () => {
  test('keeps finished runs in the queue so collection is visible', () => {
    const s = snapshot([
      run({ project: 'tallyboard', path: '/qa/tallyboard/2026-07-18-a.md' }),
      run({ project: 'pebbles', path: '/qa/pebbles/2026-07-16-b.md' }),
      run({ project: 'tallyboard', path: '/qa/tallyboard/2026-07-10-old.md', status: 'done' })
    ])
    const groups = inboxRows(s, ALL_PROJECTS)
    const projects = groups.map((g) => g.project).sort()
    expect(projects).toEqual(['pebbles', 'tallyboard'])
    const tw = groups.find((g) => g.project === 'tallyboard')!
    expect(tw.rows).toHaveLength(2)
  })

  test('orders newest first within a group by request date prefix', () => {
    const s = snapshot([
      run({ project: 'tallyboard', path: '/qa/tallyboard/2026-07-10-old.md' }),
      run({ project: 'tallyboard', path: '/qa/tallyboard/2026-07-18-new.md' }),
      run({ project: 'tallyboard', path: '/qa/tallyboard/2026-07-14-mid.md' })
    ])
    const tw = inboxRows(s, ALL_PROJECTS).find((g) => g.project === 'tallyboard')!
    expect(tw.rows.map((r) => r.run.request.path)).toEqual([
      '/qa/tallyboard/2026-07-18-new.md',
      '/qa/tallyboard/2026-07-14-mid.md',
      '/qa/tallyboard/2026-07-10-old.md'
    ])
  })

  test('ageSource prefers report start and request mtime before day-granular dates', () => {
    const started = reportForAge('2026-07-27T11:58:00.000Z')
    const s = snapshot([
      run({
        project: 'p',
        path: '/qa/p/2026-07-01-x.md',
        date: '2026-07-18',
        requestMtime: '2026-07-27T11:55:00.000Z',
        report: started
      }),
      run({
        project: 'p',
        path: '/qa/p/2026-07-02-y.md',
        date: '2026-07-18',
        requestMtime: '2026-07-27T11:54:00.000Z'
      }),
      run({ project: 'p', path: '/qa/p/2026-07-03-z.md', date: '2026-07-18' })
    ])
    const rows = inboxRows(s, ALL_PROJECTS)[0].rows
    const x = rows.find((r) => r.run.request.path.endsWith('x.md'))!
    const y = rows.find((r) => r.run.request.path.endsWith('y.md'))!
    const z = rows.find((r) => r.run.request.path.endsWith('z.md'))!
    expect(x.ageSource).toBe('2026-07-27T11:58:00.000Z')
    expect(y.ageSource).toBe('2026-07-27T11:54:00.000Z')
    expect(z.ageSource).toBe('2026-07-18')
  })

  // Relief pass R4 -----------------------------------------------------------

  test('a run is NEW until its basename is in the seen set', () => {
    const s = snapshot([
      run({ project: 'p', path: '/qa/p/2026-07-18-a.md' }),
      run({ project: 'p', path: '/qa/p/2026-07-17-b.md' })
    ])
    const rows = inboxRows(s, ALL_PROJECTS, new Set(['2026-07-18-a'])).flatMap((g) => g.rows)
    const a = rows.find((r) => r.run.request.path.endsWith('a.md'))!
    const b = rows.find((r) => r.run.request.path.endsWith('b.md'))!
    expect(a.isNew).toBe(false) // seen
    expect(b.isNew).toBe(true) // never opened
  })

  test('same-basename requests use independent repository-relative identities', () => {
    const s = snapshot([
      run({ project: 'alpha', path: '/qa/alpha/shared.md' }),
      run({ project: 'beta', path: '/qa/beta/shared.md' })
    ])

    const rows = inboxRows(s, ALL_PROJECTS, new Set(['alpha/shared.md'])).flatMap(
      (group) => group.rows
    )
    expect(rows.find((row) => row.run.project === 'alpha')?.isNew).toBe(false)
    expect(rows.find((row) => row.run.project === 'beta')?.isNew).toBe(true)
  })

  test('an ambiguous legacy basename resolves to neither matching request', () => {
    const s = snapshot([
      run({ project: 'alpha', path: '/qa/alpha/shared.md' }),
      run({ project: 'beta', path: '/qa/beta/shared.md' })
    ])

    const rows = inboxRows(s, ALL_PROJECTS, new Set(['shared'])).flatMap((group) => group.rows)
    expect(rows.every((row) => row.isNew)).toBe(true)
  })

  test('round and threads paths retain their full repository-relative identity', () => {
    expect(requestKey('/qa', '/qa/tallyboard/round-a/shared.md')).toBe(
      'tallyboard/round-a/shared.md'
    )
    expect(requestKey('/qa', '/qa/tallyboard/threads/shared.md')).toBe(
      'tallyboard/threads/shared.md'
    )
  })

  test('archived requests drop out of the inbox but stay recoverable', () => {
    const s = snapshot([
      run({ project: 'p', path: '/qa/p/2026-07-18-a.md' }),
      run({ project: 'p', path: '/qa/p/2026-07-17-b.md' })
    ])
    const archived = new Set(['2026-07-17-b'])
    const inbox = inboxRows(s, ALL_PROJECTS, new Set(), archived).flatMap((g) => g.rows)
    expect(inbox.map((r) => r.run.request.path)).toEqual(['/qa/p/2026-07-18-a.md'])
    const bin = archivedRows(s, ALL_PROJECTS, archived)
    expect(bin.map((r) => r.run.request.path)).toEqual(['/qa/p/2026-07-17-b.md'])
  })

  test('inboxCounts reports total visible requests and how many are new', () => {
    const s = snapshot([
      run({ project: 'p', path: '/qa/p/2026-07-18-a.md' }),
      run({ project: 'p', path: '/qa/p/2026-07-17-b.md' }),
      run({ project: 'p', path: '/qa/p/2026-07-16-c.md' }),
      run({ project: 'p', path: '/qa/p/2026-07-10-done.md', status: 'done' })
    ])
    const counts = inboxCounts(
      s,
      ALL_PROJECTS,
      new Set(['2026-07-18-a']),
      new Set(['2026-07-16-c'])
    )
    expect(counts.total).toBe(3) // a + b + done (c archived)
    expect(counts.fresh).toBe(2) // b + done are unseen among the visible three
  })

  test('inboxRows treats unknown seen state as NEW so no request is lost', () => {
    const s = snapshot([
      run({ project: 'p', path: '/qa/p/2026-07-18-a.md' }),
      run({ project: 'p', path: '/qa/p/2026-07-17-b.md' })
    ])

    const rows = inboxRows(s, ALL_PROJECTS, new Set(), new Set(), false).flatMap(
      (group) => group.rows
    )

    expect(rows.map((row) => row.isNew)).toEqual([true, true])
  })

  test('inboxCounts treats unknown seen state as fresh instead of asserting zero', () => {
    const s = snapshot([
      run({ project: 'p', path: '/qa/p/2026-07-18-a.md' }),
      run({ project: 'p', path: '/qa/p/2026-07-17-b.md' })
    ])

    expect(inboxCounts(s, ALL_PROJECTS, new Set(), new Set(), false)).toEqual({
      total: 2,
      fresh: 2
    })
  })

  test('requestKey keeps the repository-relative request path', () => {
    expect(requestKey('/qa', '/qa/tallyboard/2026-07-18-a.md')).toBe('tallyboard/2026-07-18-a.md')
  })
})

describe('miniSpineCells', () => {
  test('all unanswered when there is no report', () => {
    const r = run({
      project: 'p',
      path: '/qa/p/2026-07-18-a.md',
      items: [
        { id: 'one', title: 'One' },
        { id: 'two', title: 'Two' }
      ]
    })
    expect(miniSpineCells(r)).toEqual(['unanswered', 'unanswered'])
  })

  test('reads per-item status from the report by id', () => {
    const report: QaReport = {
      id: 'id',
      title: 'Title',
      startedAt: '',
      noteFiles: [],
      items: [
        {
          id: 'one',
          title: 'One',
          status: 'pass',
          comment: '',
          flagged: [],
          quotes: [],
          screenshots: []
        },
        {
          id: 'two',
          title: 'Two',
          status: 'fail',
          comment: '',
          flagged: [],
          quotes: [],
          screenshots: []
        }
      ]
    }
    const r = run({
      project: 'p',
      path: '/qa/p/2026-07-18-a.md',
      status: 'in-progress',
      report,
      items: [
        { id: 'one', title: 'One' },
        { id: 'two', title: 'Two' },
        { id: 'three', title: 'Three' } // no report entry → unanswered
      ]
    })
    expect(miniSpineCells(r)).toEqual(['pass', 'fail', 'unanswered'])
  })
})

// Ticket 13: the Inbox never read the window scope, so picking a project left
// every project's requests on screen. The scope arrives as an argument, so the
// scoping is asserted here without rendering the surface.
describe('the window scope decides which requests the Inbox shows', () => {
  const WORDFORGE = { kind: 'project', slug: 'wordforge' } as const

  const fleet = (): QaSnapshot =>
    snapshot([
      run({ project: 'wordforge', path: '/qa/wordforge/2026-07-20-a.md' }),
      run({ project: 'redforge', path: '/qa/redforge/2026-07-21-b.md' })
    ])

  test('All projects groups every project; a project scope groups only its own', () => {
    expect(
      inboxRows(fleet(), ALL_PROJECTS)
        .map((group) => group.project)
        .sort()
    ).toEqual(['redforge', 'wordforge'])
    expect(inboxRows(fleet(), WORDFORGE).map((group) => group.project)).toEqual(['wordforge'])
  })

  test('the waiting count agrees with the rows the scope shows', () => {
    expect(inboxCounts(fleet(), ALL_PROJECTS, new Set(), new Set())).toEqual({
      total: 2,
      fresh: 2
    })
    expect(inboxCounts(fleet(), WORDFORGE, new Set(), new Set())).toEqual({ total: 1, fresh: 1 })
  })

  test('the archive bin is scoped too, so restoring cannot surface another project', () => {
    const archived = new Set(['wordforge/2026-07-20-a.md', 'redforge/2026-07-21-b.md'])
    expect(archivedRows(fleet(), ALL_PROJECTS, archived)).toHaveLength(2)
    expect(archivedRows(fleet(), WORDFORGE, archived).map((row) => row.run.project)).toEqual([
      'wordforge'
    ])
  })
})
