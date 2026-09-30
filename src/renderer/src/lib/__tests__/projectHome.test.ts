import { describe, expect, test } from 'vitest'
import type { QaSnapshot, SerializableRun } from '../../../../shared/ipc'
import type { Handoff } from '../../../../main/qa/handoffs'
import type { NoteRef } from '../../../../main/qa/scan'
import type { PoolIdea, PoolTier, ProjectPool } from '../../../../main/qa/pool'
import type { ProjectRelease, ReleaseFeature } from '../../../../main/qa/releaseRecords'
import type { Thread } from '../../../../main/qa/types'
import { projectStandings } from '../projectStanding'
import { requestIdentity } from '../../../../shared/requestIdentity'
import {
  HOME_FEATURE_LIMIT,
  HOME_LIST_LIMIT,
  HOME_QUESTION_LIMIT,
  homeReadingOrder,
  projectHome
} from '../projectHome'

/**
 * Ticket 05 — the project home. The seam is the function assembling a
 * project's home from a snapshot, including its two degenerate shapes: a
 * project with no release record (most of them), and a folder with nothing in
 * it at all. The law it keeps: *Waiting on you* is exactly what the rail counts,
 * item for item, so the home and the rail beside it cannot disagree.
 */

const NOW = new Date('2026-09-19T12:00:00.000Z')
const HOURS_AGO = '2026-09-19T07:00:00.000Z'
const YESTERDAY = '2026-09-18T09:00:00.000Z'
const THREE_DAYS = '2026-09-16T09:00:00.000Z'
const A_MONTH = '2026-08-14T09:00:00.000Z'
const LAST_YEAR = '2025-12-03T09:00:00.000Z'

describe('the full home (state 9)', () => {
  const home = (): NonNullable<ReturnType<typeof projectHome>> =>
    projectHome(wordforge(), 'wordforge', NOW)!

  test('names the project once, from its release record', () => {
    expect(home().name).toBe('WordForge')
    expect(home().empty).toBe(false)
  })

  test('waiting on you lists what is owed, newest first, each a way in', () => {
    const { waiting } = home()
    expect(waiting.total).toBe(3)
    expect(waiting.shown.map((row) => [row.title, row.age])).toEqual([
      ['Action bar placement', expect.stringMatching(/^\d\d:\d\d$/)],
      ['Collections as unwritten pieces', 'yesterday'],
      ['Export block model', '16 Sep']
    ])
    expect(waiting.shown.map((row) => row.target.kind)).toEqual(['runner', 'thread', 'surface'])
    expect(waiting.moreLabel).toBe('')
  })

  test('the release in flight names its features in the fixed words, what needs him first', () => {
    const { release, releaseCall } = home()
    expect(releaseCall).toBeNull()
    expect(release.kind).toBe('in-flight')
    if (release.kind === 'none') throw new Error('expected a release')
    expect(release.version).toBe('0.21.0')
    expect(release.features.shown.map((row) => [row.title, row.state])).toEqual([
      ['Export block model', 'Being built'],
      ['Batch prepare polish', 'Built and tested'],
      ['Vault scale guard', 'Not started'],
      ['Reading Room citations', 'Done']
    ])
  })

  test('the three roadmap lanes count ranked ideas only, in his words', () => {
    expect(home().roadmap).toEqual({
      total: 3,
      lanes: [
        { tier: 'functionality', label: 'Functionality', count: 2 },
        { tier: 'quality-of-life', label: 'Quality of life', count: 0 },
        { tier: 'delight', label: 'Delight', count: 1 }
      ]
    })
  })

  test('requests, notes, threads, handoffs and specs each list their own records', () => {
    const model = home()
    // Every request, answered or not — a review of a document included.
    expect(model.requests.shown.map((row) => row.title)).toEqual([
      'Action bar placement',
      'Heading spacing at Calm',
      'HTML export front page',
      'HTML export as a document'
    ])
    // Notes carry their date in the file name; a previous year keeps its year.
    expect(model.notes.shown.map((row) => [row.title, row.age])).toEqual([
      ['A line is a block', '9 Sep'],
      ['Folio naming, first pass', '3 Dec 2025']
    ])
    expect(model.notes.shown[0].target).toEqual({
      kind: 'note',
      path: '/record/wordforge/2026-09-09-note-a-line-is-a-block.md'
    })
    expect(model.threads.shown.map((row) => row.title)).toEqual([
      'Collections as unwritten pieces',
      'Export model as an option'
    ])
    expect(model.handoffs.shown.map((row) => row.title)).toEqual(['Export block model'])
    expect(model.specs.shown.map((row) => row.title)).toEqual(['HTML export as a document'])
    expect(model.specs.shown[0].target.kind).toBe('runner')
  })

  test('nothing from another project reaches this one', () => {
    const model = home()
    const titles = [
      ...model.waiting.shown,
      ...model.requests.shown,
      ...model.threads.shown,
      ...model.handoffs.shown,
      ...model.notes.shown
    ].map((row) => row.title)
    expect(titles).not.toContain('RedForge request')
    expect(titles).not.toContain('RedForge handoff')
  })

  test('the keyboard walks the page in reading order: wide column, then narrow', () => {
    const order = homeReadingOrder(home())
    expect(order[0]).toMatch(/^waiting:/)
    expect(order.indexOf('lane:functionality')).toBeGreaterThan(
      order.findIndex((key) => key.startsWith('note:'))
    )
    expect(new Set(order).size).toBe(order.length)
  })
})

describe('the release needs him (state 10)', () => {
  const tallyboard = (): QaSnapshot =>
    snapshot({
      projects: ['tallyboard'],
      runs: [run('tallyboard', { at: HOURS_AGO, title: 'Poll rendering preview' })],
      releases: [
        release(
          'tallyboard',
          '0.31.0',
          [
            {
              ...feature('divider', 'you', 'Divider inference'),
              howToCheck: 'Should divider inference ever override a token the author typed?'
            },
            {
              ...feature('title', 'you', 'Title regime'),
              prose: 'Which regime survives?\n\nMore.'
            },
            feature('poll', 'you', 'Poll rendering'),
            feature('diagram', 'building', 'Diagram family')
          ],
          '2026-09-11',
          'TallyBoard'
        )
      ]
    })

  test('the block leads with each feature title, never its how-to-check steps', () => {
    const { releaseCall } = projectHome(tallyboard(), 'tallyboard', NOW)!
    expect(releaseCall).toMatchObject({
      version: '0.31.0',
      heading: '0.31.0 is stopped on three verdicts',
      since: 'waiting since 11 Sep'
    })
    expect(
      releaseCall!.questions.shown.map((question) => [question.title, question.detail])
    ).toEqual([
      ['Divider inference', ''],
      ['Title regime', 'Which regime survives?'],
      ['Poll rendering', '']
    ])
    // A detail line takes the full form of the date.
    expect(releaseCall!.questions.shown[0].asked).toBe('asked Fri 11 Sep')
  })

  test('the features it names are not said again in waiting on you', () => {
    const model = projectHome(tallyboard(), 'tallyboard', NOW)!
    expect(model.waiting.shown.map((row) => row.title)).toEqual(['Poll rendering preview'])
    // Still the rail's count, split between the block and the list.
    expect(model.waiting.total + model.releaseCall!.questions.total).toBe(model.standing.owed.total)
  })

  test('the block leads the keyboard order', () => {
    expect(homeReadingOrder(projectHome(tallyboard(), 'tallyboard', NOW)!).slice(0, 3)).toEqual([
      'call:divider',
      'call:title',
      'call:poll'
    ])
  })

  test('every waiting question is stated, the first few drawn and the rest counted', () => {
    const many = snapshot({
      projects: ['tallyboard'],
      releases: [
        release(
          'tallyboard',
          '0.31.0',
          Array.from({ length: 6 }, (_, i) => feature(`q${i}`, 'you', `Question ${i}`)),
          '2026-09-11',
          'TallyBoard'
        )
      ]
    })
    const { questions, heading } = projectHome(many, 'tallyboard', NOW)!.releaseCall!
    expect(heading).toBe('0.31.0 is stopped on six verdicts')
    expect(questions.total).toBe(6)
    expect(questions.shown.map((question) => question.title)).toEqual(
      Array.from({ length: HOME_QUESTION_LIMIT }, (_, i) => `Question ${i}`)
    )
    expect(questions.moreLabel).toBe('2 more waiting on your verdict')
  })

  test('a shipped release does not stop anything, but what it still asks is owed', () => {
    const shipped = snapshot({
      projects: ['dtc'],
      releases: [
        release('dtc', '0.20.0', [feature('left', 'you', 'Left behind')], YESTERDAY, undefined, {
          shipped: true
        })
      ]
    })
    const model = projectHome(shipped, 'dtc', NOW)!
    expect(model.releaseCall).toBeNull()
    expect(model.release.kind).toBe('shipped')
    expect(model.waiting.shown.map((row) => [row.title, row.target])).toEqual([
      ['Left behind', { kind: 'surface', surface: 'releases' }]
    ])
  })
})

describe('no release record (state 11)', () => {
  const tidewatch = (): QaSnapshot =>
    snapshot({
      projects: ['tidewatch'],
      runs: [run('tidewatch', { at: HOURS_AGO, title: 'Sweep triage shell' })],
      threads: [thread('tidewatch', { title: 'Which connector comes first', at: A_MONTH })],
      notes: [note('tidewatch', '2026-09-06-note-gate-3a.md', 'Gate 3a design lock')]
    })

  test('says plainly that nobody has declared what it is working towards', () => {
    const model = projectHome(tidewatch(), 'tidewatch', NOW)!
    expect(model.release).toEqual({
      kind: 'none',
      sentence: 'Nobody has declared what Tidewatch is working towards.'
    })
    expect(model.releaseCall).toBeNull()
  })

  test('and keeps everything else it has, at normal weight', () => {
    const model = projectHome(tidewatch(), 'tidewatch', NOW)!
    expect(model.empty).toBe(false)
    expect(model.requests.shown.map((row) => row.title)).toEqual(['Sweep triage shell'])
    expect(model.threads.shown.map((row) => row.title)).toEqual(['Which connector comes first'])
    expect(model.notes.shown.map((row) => row.title)).toEqual(['Gate 3a design lock'])
    // An unanswered request is a verdict owed, release record or not.
    expect(model.waiting.total).toBe(1)
    expect(model.handoffs.total).toBe(0)
  })
})

describe('an empty project (state 12)', () => {
  test('a folder holding nothing is empty', () => {
    const model = projectHome(snapshot({ projects: ['meadowrunbook'] }), 'meadowrunbook', NOW)!
    expect(model.empty).toBe(true)
    expect(model.release.kind).toBe('none')
    expect(model.waiting.total).toBe(0)
    expect(model.roadmap.total).toBe(0)
  })

  test('any one record, even a retired thread or a set-aside idea, means it is not', () => {
    const retired = { ...thread('meadowrunbook', {}), state: 'retired' as const }
    expect(
      projectHome(
        snapshot({ projects: ['meadowrunbook'], threads: [retired] }),
        'meadowrunbook',
        NOW
      )!.empty
    ).toBe(false)
    const setAside = snapshot({ projects: ['meadowrunbook'] })
    setAside.pools = [pool('meadowrunbook', [['functionality', 'setaside']])]
    expect(projectHome(setAside, 'meadowrunbook', NOW)!.empty).toBe(false)
    expect(
      projectHome(
        snapshot({ projects: ['meadowrunbook'], notes: [note('meadowrunbook', 'n.md', 'N')] }),
        'meadowrunbook',
        NOW
      )!.empty
    ).toBe(false)
  })

  test('a project the record does not have has no home', () => {
    expect(projectHome(snapshot({ projects: ['wordforge'] }), 'nowhere', NOW)).toBeNull()
  })
})

describe('real volumes', () => {
  // Wordforge Desktop on his record root: 15 requests waiting and 9 handoffs
  // ready. Dev Traffic Control: 38 runs. The drawing shows two or three rows.
  const busy = (): QaSnapshot => {
    const runs: SerializableRun[] = []
    for (let i = 0; i < 15; i += 1) {
      runs.push(run('wordforge', { at: day(i), title: `Waiting ${i}` }))
    }
    for (let i = 0; i < 23; i += 1) {
      runs.push(run('wordforge', { at: day(20 + i), title: `Done ${i}`, status: 'done' }))
    }
    const handoffs = Array.from({ length: 9 }, (_, i) =>
      handoff('wordforge', { at: day(3 * i + 1), title: `Handoff ${i}` })
    )
    const features = Array.from({ length: 12 }, (_, i) =>
      feature(`f${i}`, i === 0 ? 'building' : 'done', `Feature ${i}`)
    )
    return snapshot({
      projects: ['wordforge'],
      runs,
      handoffs,
      releases: [release('wordforge', '0.21.0', features)]
    })
  }

  test('every list draws the newest few and counts the rest; headers keep the whole number', () => {
    const model = projectHome(busy(), 'wordforge', NOW)!
    expect(model.waiting.total).toBe(24)
    expect(model.waiting.shown).toHaveLength(HOME_LIST_LIMIT)
    expect(model.waiting.moreLabel).toBe('20 more waiting on you')
    // Requests and handoffs interleave by date: one list, newest first.
    expect(model.waiting.shown.map((row) => row.title)).toEqual([
      'Waiting 0',
      'Handoff 0',
      'Waiting 1',
      'Waiting 2'
    ])

    expect(model.requests.total).toBe(38)
    expect(model.requests.shown).toHaveLength(HOME_LIST_LIMIT)
    expect(model.requests.moreLabel).toBe('34 more requests')

    expect(model.handoffs.total).toBe(9)
    expect(model.handoffs.moreLabel).toBe('5 more handoffs ready')

    if (model.release.kind === 'none') throw new Error('expected a release')
    expect(model.release.features.total).toBe(12)
    expect(model.release.features.shown).toHaveLength(HOME_FEATURE_LIMIT)
    expect(model.release.features.moreLabel).toBe('4 more features')
    expect(model.release.features.shown[0].state).toBe('Being built')
  })

  test('a list at or under the limit has no closing row', () => {
    const model = projectHome(wordforge(), 'wordforge', NOW)!
    for (const list of [model.waiting, model.requests, model.notes, model.threads]) {
      expect(list.hidden).toBe(0)
      expect(list.moreLabel).toBe('')
    }
  })
})

/**
 * Ticket 12. The retired project view grouped a project's records by round —
 * its round subfolders — and summed each round in a line. The home keeps that
 * grouping as one more capped list, entered at each round's newest record.
 */
describe('the rounds grouping (ticket 12)', () => {
  const inRound = (
    round: string,
    file: string,
    options: { status?: 'waiting' | 'done'; gate?: string } = {}
  ): SerializableRun => {
    const base = run('dtc', { at: HOURS_AGO, status: options.status })
    return {
      ...base,
      round,
      request: {
        ...base.request,
        path: `/record/dtc/${round}/${file}`,
        labels: options.gate ? { gate: options.gate } : {}
      }
    }
  }
  const noteIn = (round: string, file: string): NoteRef => ({
    ...note('dtc', `${round}/${file}`, file),
    round
  })

  test('lists named rounds only, newest first, each with its rollup', () => {
    const model = projectHome(
      snapshot({
        projects: ['dtc'],
        runs: [
          inRound('v1.1-review', '2026-08-02-a.md', { gate: '4' }),
          inRound('v1.1-review', '2026-08-03-b.md'),
          inRound('0.9-shell', '2026-07-18-c.md'),
          run('dtc', { at: HOURS_AGO, title: 'Loose request' })
        ],
        notes: [noteIn('v1.1-review', '2026-08-04-note.md')]
      }),
      'dtc',
      NOW
    )!
    expect(model.rounds.total).toBe(2)
    expect(model.rounds.shown.map((row) => [row.title, row.detail, row.age])).toEqual([
      ['v1.1-review', '2 runs · Gate 4 in progress · 1 note', '4 Aug'],
      ['0.9-shell', '1 run · no notes', '18 Jul']
    ])
    // The loose request is in the requests list, not a round of its own.
    expect(model.requests.shown.map((row) => row.title)).toContain('Loose request')
  })

  test('a round is entered at its newest request, else its newest note', () => {
    const model = projectHome(
      snapshot({
        projects: ['dtc'],
        runs: [
          inRound('v1.1-review', '2026-08-02-a.md'),
          inRound('v1.1-review', '2026-08-03-b.md')
        ],
        notes: [
          noteIn('notes-only', '2026-08-01-first.md'),
          noteIn('notes-only', '2026-08-05-last.md')
        ]
      }),
      'dtc',
      NOW
    )!
    const targets = Object.fromEntries(model.rounds.shown.map((row) => [row.title, row.target]))
    expect(targets['v1.1-review']).toEqual({
      kind: 'runner',
      path: '/record/dtc/v1.1-review/2026-08-03-b.md'
    })
    expect(targets['notes-only']).toEqual({
      kind: 'note',
      path: '/record/dtc/notes-only/2026-08-05-last.md'
    })
  })

  test('a project with no round subfolders has no rounds, so its home is as drawn', () => {
    expect(projectHome(wordforge(), 'wordforge', NOW)!.rounds.total).toBe(0)
  })

  test('at real volumes it draws the newest few rounds and counts the rest', () => {
    const runs = Array.from({ length: 7 }, (_, i) =>
      inRound(`round-${i}`, `2026-08-${String(10 + i).padStart(2, '0')}-r.md`)
    )
    const model = projectHome(snapshot({ projects: ['dtc'], runs }), 'dtc', NOW)!
    expect(model.rounds.total).toBe(7)
    expect(model.rounds.shown.map((row) => row.title)).toEqual([
      'round-6',
      'round-5',
      'round-4',
      'round-3'
    ])
    expect(model.rounds.moreLabel).toBe('3 more rounds')
  })

  test('the keyboard reaches the rounds last, after the narrow column', () => {
    const model = projectHome(
      snapshot({ projects: ['dtc'], runs: [inRound('v1.1-review', '2026-08-02-a.md')] }),
      'dtc',
      NOW
    )!
    const order = homeReadingOrder(model)
    expect(order[order.length - 1]).toBe('round:v1.1-review')
  })
})

describe('waiting on you is the rail’s count, item for item', () => {
  const cases: Array<[string, () => QaSnapshot]> = [
    ['WordForge', wordforge],
    ['a generated record', () => generated(3)],
    ['another generated record', () => generated(11)],
    ['a third generated record', () => generated(29)]
  ]

  test.each(cases)('%s', (_label, make) => {
    const s = make()
    for (const standing of projectStandings(s, NOW)) {
      const model = projectHome(s, standing.slug, NOW)!
      expect(model.waiting.total + (model.releaseCall?.questions.total ?? 0), standing.slug).toBe(
        standing.owed.total
      )
    }
  })
})

// Ticket 22: what he archives stops counting as owed, everywhere at once.
describe('archived items are not owed', () => {
  test('archiving a request and a decision drops both from the rail and the home, which still agree', () => {
    const s = wordforge()
    const before = projectStandings(s, NOW).find((standing) => standing.slug === 'wordforge')!
    const owedRun = s.runs.find(
      (r) => r.project === 'wordforge' && r.status !== 'done' && !r.resolvedAt
    )!
    const owedThread = s.threads.find(
      (t) => t.projects.includes('wordforge') && t.state !== 'retired' && t.move === 'me'
    )!
    expect(owedRun).toBeTruthy()
    expect(owedThread).toBeTruthy()
    const housekeeping = {
      root: s.root,
      requests: new Set([requestIdentity(s.root, owedRun.request.path)]),
      threads: new Set([owedThread.id])
    }
    const after = projectStandings(s, NOW, housekeeping).find(
      (standing) => standing.slug === 'wordforge'
    )!
    expect(after.owed.total).toBe(before.owed.total - 2)
    const model = projectHome(s, 'wordforge', NOW, undefined, housekeeping)!
    expect(model.waiting.total + (model.releaseCall?.questions.total ?? 0)).toBe(after.owed.total)
  })
})

// ---------------------------------------------------------------------------

function wordforge(): QaSnapshot {
  const s = snapshot({
    projects: ['wordforge', 'redforge'],
    runs: [
      run('wordforge', { at: HOURS_AGO, title: 'Action bar placement' }),
      run('wordforge', { at: YESTERDAY, title: 'Heading spacing at Calm', status: 'done' }),
      run('wordforge', { at: A_MONTH, title: 'HTML export front page', status: 'done' }),
      spec('wordforge', 'HTML export as a document', A_MONTH),
      run('redforge', { at: HOURS_AGO, title: 'RedForge request' })
    ],
    threads: [
      thread('wordforge', { title: 'Collections as unwritten pieces', move: 'me', at: YESTERDAY }),
      thread('wordforge', { title: 'Export model as an option', at: THREE_DAYS }),
      { ...thread('wordforge', { title: 'Retired one' }), state: 'retired' }
    ],
    handoffs: [
      handoff('wordforge', { at: THREE_DAYS, title: 'Export block model' }),
      handoff('wordforge', { at: YESTERDAY, title: 'Picked up', pickedUp: true }),
      handoff('redforge', { at: HOURS_AGO, title: 'RedForge handoff' })
    ],
    notes: [
      note('wordforge', '2025-12-03-note-folio-naming.md', 'Folio naming, first pass'),
      note('wordforge', '2026-09-09-note-a-line-is-a-block.md', 'A line is a block')
    ],
    releases: [
      release(
        'wordforge',
        '0.21.0',
        [
          feature('reading', 'done', 'Reading Room citations'),
          feature('export', 'building', 'Export block model'),
          feature('vault', 'notstarted', 'Vault scale guard'),
          feature('batch', 'built', 'Batch prepare polish'),
          { id: 'g', title: 'Groundwork', kind: 'groundwork' }
        ],
        YESTERDAY,
        'WordForge'
      )
    ]
  })
  s.pools = [
    pool('wordforge', [
      ['functionality', 'pool'],
      ['functionality', 'pool'],
      ['delight', 'pool'],
      ['quality-of-life', 'setaside']
    ])
  ]
  return s
}

/** A deterministic mixed record: every kind of owed thing, in every project. */
function generated(seed: number): QaSnapshot {
  let state = seed
  const next = (): number => {
    state = (state * 9301 + 49297) % 233280
    return state / 233280
  }
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]
  const ages = [HOURS_AGO, YESTERDAY, THREE_DAYS, A_MONTH, LAST_YEAR]
  const projects = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
  const runs: SerializableRun[] = []
  const threads: Thread[] = []
  const handoffs: Handoff[] = []
  const releases: ProjectRelease[] = []
  for (const project of projects) {
    for (let i = Math.floor(next() * 6); i > 0; i -= 1) {
      runs.push(
        run(project, {
          at: pick(ages),
          status: pick(['waiting', 'done'] as const),
          resolved: next() < 0.2
        })
      )
    }
    for (let i = Math.floor(next() * 4); i > 0; i -= 1) {
      const t = thread(project, { move: pick(['me', 'agent', 'nobody'] as const), at: pick(ages) })
      threads.push(next() < 0.2 ? { ...t, state: 'retired' } : t)
    }
    for (let i = Math.floor(next() * 4); i > 0; i -= 1) {
      handoffs.push(
        handoff(project, {
          at: pick(ages),
          pickedUp: next() < 0.4,
          state: pick(['live', 'live', 'done', 'superseded'] as const)
        })
      )
    }
    if (next() < 0.7) {
      releases.push(
        release(
          project,
          `0.${Math.floor(next() * 30)}.0`,
          Array.from({ length: 1 + Math.floor(next() * 4) }, (_, i) =>
            feature(
              `${project}-${i}`,
              pick(['you', 'building', 'built', 'done', 'notstarted'] as const)
            )
          ),
          pick(ages),
          undefined,
          { shipped: next() < 0.3 }
        )
      )
    }
  }
  return snapshot({ projects, runs, threads, handoffs, releases })
}

function day(offset: number): string {
  return new Date(NOW.getTime() - (offset + 1) * 3_600_000 * 5).toISOString()
}

interface SnapshotParts {
  projects?: string[]
  runs?: SerializableRun[]
  threads?: Thread[]
  handoffs?: Handoff[]
  releases?: ProjectRelease[]
  notes?: NoteRef[]
}

function snapshot(parts: SnapshotParts): QaSnapshot {
  return {
    root: '/record',
    rootMissing: false,
    runs: parts.runs ?? [],
    notes: parts.notes ?? [],
    entries: [],
    threads: parts.threads ?? [],
    handoffs: parts.handoffs ?? [],
    releases: parts.releases ?? [],
    pools: [],
    projects: parts.projects ?? [],
    scannedAt: HOURS_AGO
  }
}

let runSeq = 0
function run(
  project: string,
  options: { at: string; status?: 'waiting' | 'done'; resolved?: boolean; title?: string }
): SerializableRun {
  const path = `/record/${project}/requests/${(runSeq += 1)}.md`
  return {
    request: {
      id: `r${runSeq}`,
      title: options.title ?? `Request ${runSeq}`,
      labels: {},
      mode: 'test',
      items: [],
      parked: [],
      degraded: false,
      raw: '',
      path
    },
    requestMtime: options.at,
    report: null,
    status: options.status ?? 'waiting',
    project,
    round: null,
    ...(options.resolved ? { resolvedAt: options.at } : {})
  }
}

/** A finished review of a written document: a spec, owing nothing. */
function spec(project: string, title: string, at: string): SerializableRun {
  const base = run(project, { at, title, status: 'done' })
  return {
    ...base,
    request: {
      ...base.request,
      mode: 'doc-review',
      document: { headings: [], bodyMarkdown: '# A document\n\nIts text.' }
    }
  }
}

let threadSeq = 0
function thread(
  project: string,
  options: { move?: 'me' | 'agent' | 'nobody'; at?: string; title?: string }
): Thread {
  const at = options.at ?? YESTERDAY
  const id = `t${(threadSeq += 1)}`
  return {
    id,
    title: options.title ?? `Thread ${id}`,
    projects: [project],
    parents: [],
    move: options.move ?? 'nobody',
    form: 'idea',
    state: 'open',
    entries: [],
    firstAt: at,
    lastAt: at,
    ageDays: 0,
    cold: false,
    dictated: false
  }
}

let handoffSeq = 0
function handoff(
  project: string,
  options: {
    at: string
    pickedUp?: boolean
    state?: 'live' | 'done' | 'superseded'
    title?: string
  }
): Handoff {
  const file = `${(handoffSeq += 1)}.md`
  return {
    path: `/record/${project}/handoffs/${file}`,
    file,
    title: options.title ?? `Handoff ${file}`,
    domain: project,
    project,
    move: 'agent',
    state: options.state ?? 'live',
    updated: options.at,
    bodyMarkdown: '',
    raw: '',
    relaunchPrompt: '',
    sidecar: { pickedUpAt: options.pickedUp ? options.at : null, archivedAt: null },
    history: options.pickedUp ? { kind: 'picked-up', at: options.at } : { kind: 'never-picked-up' },
    ageDays: 0,
    stale: false,
    frontmatterMalformed: false
  }
}

function note(project: string, file: string, title: string): NoteRef {
  return { path: `/record/${project}/${file}`, title, status: 'draft', project, round: null }
}

function pool(project: string, ideas: Array<[PoolTier, PoolIdea['state']]>): ProjectPool {
  return {
    project,
    directory: `/record/${project}/roadmap`,
    degradedOrder: false,
    ideas: ideas.map(([tier, state], index): PoolIdea => ({
      path: `/record/${project}/roadmap/${index}.md`,
      id: `i${index}`,
      title: `Idea ${index}`,
      tier,
      bodyMarkdown: '',
      position: index,
      state,
      isNew: false
    }))
  }
}

function feature(id: string, status: ReleaseFeature['status'], title = id): ReleaseFeature {
  return { id, title, kind: 'feature', status }
}

function release(
  project: string,
  version: string,
  features: ReleaseFeature[],
  updated = YESTERDAY,
  app?: string,
  options: { shipped?: boolean } = {}
): ProjectRelease {
  const record = {
    path: `/record/${project}/releases/${version}.md`,
    version,
    app: app ?? project,
    release: version,
    repo: `apps/${project}`,
    updated,
    features,
    answers: [],
    degraded: false
  }
  return {
    kind: 'recorded',
    project,
    record,
    versions: [
      {
        version,
        record,
        ...(options.shipped
          ? {
              shipment: {
                app: record.app,
                release: version,
                notes: '',
                shippedAt: updated,
                returnedFeatureIds: []
              }
            }
          : {})
      }
    ],
    ...(options.shipped ? {} : { inFlightVersion: version })
  }
}

// 2026-09-27: "no status on lots of items" — finished requests looked like waiting ones.
test('each request row says whether it is waiting, started or finished', async () => {
  const { requestState } = await import('../projectHome')
  const base = { request: { path: '/r/p/x.md' } } as unknown as SerializableRun
  expect(requestState({ ...base, status: 'waiting' } as SerializableRun)).toEqual({
    label: 'Waiting on you',
    tone: 'you'
  })
  expect(requestState({ ...base, status: 'in-progress' } as SerializableRun).label).toBe('Started')
  expect(requestState({ ...base, status: 'done' } as SerializableRun).label).toBe('Finished')
  expect(
    requestState({ ...base, status: 'waiting', resolvedAt: '2026-09-26' } as SerializableRun).label
  ).toBe('Finished')
})

// Ticket 25: each release row says when the feature reached its state.
test('a release row is dated by since, else by its answer, else not at all', () => {
  const home = projectHome(
    snapshot({
      projects: ['dtc'],
      releases: [
        release(
          'dtc',
          '0.21.0',
          [
            { ...feature('links', 'you', 'Links open'), since: '2026-09-17' },
            { ...feature('today', 'built', 'Built today'), since: '2026-09-19' },
            {
              ...feature('answered', 'done', 'Answered'),
              answer: { id: 'answered', verdict: 'works', comment: '', at: HOURS_AGO }
            },
            feature('bare', 'notstarted', 'No date')
          ],
          // The ledger's own date never stands in for a feature's.
          A_MONTH
        )
      ]
    }),
    'dtc',
    NOW
  )!
  if (home.release.kind === 'none') throw new Error('fixture')
  const byId = Object.fromEntries(home.release.features.shown.map((row) => [row.id, row]))
  expect(byId.links).toMatchObject({ at: '2026-09-17', age: '17 Sep' })
  expect(byId.today).toMatchObject({ at: '2026-09-19', age: 'today' })
  expect(byId.answered.at).toBe(HOURS_AGO)
  expect(byId.answered.age).toMatch(/^\d\d:\d\d$/)
  expect(byId.bare).toMatchObject({ at: '', age: '' })
})
