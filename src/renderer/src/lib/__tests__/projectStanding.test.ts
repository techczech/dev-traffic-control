import { describe, expect, test } from 'vitest'
import type { QaSnapshot, SerializableRun } from '../../../../shared/ipc'
import type { Handoff } from '../../../../main/qa/handoffs'
import type { ProjectRelease, ReleaseFeature } from '../../../../main/qa/releaseRecords'
import type { Thread } from '../../../../main/qa/types'
import { ALL_PROJECTS, type WindowScope } from '../../../../shared/windowScope'
import { projectRail, projectStandings } from '../projectStanding'

const NOW = new Date('2026-09-19T12:00:00.000Z')
const TODAY = '2026-09-19T09:00:00.000Z'
const YESTERDAY = '2026-09-18T09:00:00.000Z'
const THREE_DAYS = '2026-09-16T09:00:00.000Z'
const FIVE_DAYS = '2026-09-14T09:00:00.000Z'
const A_MONTH = '2026-08-14T09:00:00.000Z'
const LAST_YEAR = '2025-12-03T09:00:00.000Z'

describe('what counts as a project needing him (ADR-0016 § 4)', () => {
  test('an unanswered request puts a project in Needs you', () => {
    const [standing] = projectStandings(
      snapshot({ projects: ['wordforge'], runs: [run('wordforge', { at: YESTERDAY })] }),
      NOW
    )

    expect(standing.group).toBe('needs-you')
    expect(standing.owed).toMatchObject({ requests: 1, total: 1 })
  })

  test('a feature waiting on him puts a project in Needs you', () => {
    const [standing] = projectStandings(
      snapshot({
        projects: ['wordforge'],
        releases: [release('wordforge', '0.21.0', [feature('bar', 'you'), feature('sp', 'built')])]
      }),
      NOW
    )

    expect(standing.group).toBe('needs-you')
    expect(standing.owed).toMatchObject({ features: 1, total: 1 })
    expect(standing.building).toBe(1)
  })

  test('a handoff sitting ready puts a project in Needs you', () => {
    const [standing] = projectStandings(
      snapshot({ projects: ['redforge'], handoffs: [handoff('redforge', { at: YESTERDAY })] }),
      NOW
    )

    expect(standing.group).toBe('needs-you')
    expect(standing.owed).toMatchObject({ handoffs: 1, total: 1 })
  })

  test('a thread whose move is his puts a project in Needs you', () => {
    const [standing] = projectStandings(
      snapshot({ projects: ['tallyboard'], threads: [thread('tallyboard', { move: 'me' })] }),
      NOW
    )

    expect(standing.group).toBe('needs-you')
    expect(standing.owed).toMatchObject({ decisions: 1, total: 1 })
  })

  test('nothing else qualifies — finished work, work in hand, and work moving do not', () => {
    const quiet = snapshot({
      projects: ['bramble'],
      runs: [
        run('bramble', { at: YESTERDAY, status: 'done' }),
        run('bramble', { at: YESTERDAY, resolved: true })
      ],
      threads: [thread('bramble', { move: 'agent' })],
      handoffs: [
        handoff('bramble', { at: YESTERDAY, pickedUp: true }),
        handoff('bramble', { at: YESTERDAY, state: 'done' }),
        handoff('bramble', { at: YESTERDAY, state: 'superseded' })
      ],
      releases: [release('bramble', '0.4.0', [feature('one', 'building'), feature('two', 'done')])]
    })

    const [standing] = projectStandings(quiet, NOW)

    expect(standing.owed.total).toBe(0)
    expect(standing.needsYou).toBe(false)
    expect(standing.group).not.toBe('needs-you')
  })

  test('work moving without him is Ticking along, and a cold project is Quiet', () => {
    const both = snapshot({
      projects: ['pebbles', 'meadowrunbook'],
      releases: [release('pebbles', '0.9.0', [feature('one', 'building')], A_MONTH)],
      threads: [thread('meadowrunbook', { move: 'agent', at: LAST_YEAR })]
    })

    const byProject = new Map(projectStandings(both, NOW).map((s) => [s.slug, s]))

    expect(byProject.get('pebbles')?.group).toBe('ticking-along')
    expect(byProject.get('meadowrunbook')?.group).toBe('quiet')
  })

  test('recent movement with nothing owed is Ticking along', () => {
    const [standing] = projectStandings(
      snapshot({ projects: ['dtc'], threads: [thread('dtc', { move: 'agent', at: TODAY })] }),
      NOW
    )

    expect(standing.group).toBe('ticking-along')
  })
})

describe('the rail: grouped, ordered rows', () => {
  test('the three groups appear in their fixed order, and an empty group is omitted', () => {
    const rail = projectRail(fleet(), ALL_PROJECTS, NOW)

    expect(rail.sections.map((section) => section.label)).toEqual([
      'Needs you',
      'Ticking along',
      'Quiet'
    ])

    const onlyQuiet = projectRail(
      snapshot({
        projects: ['meadowrunbook'],
        threads: [thread('meadowrunbook', { at: LAST_YEAR })]
      }),
      ALL_PROJECTS,
      NOW
    )
    expect(onlyQuiet.sections.map((section) => section.group)).toEqual(['quiet'])
  })

  test('Needs you is ordered stalest first, not by volume', () => {
    const rail = projectRail(fleet(), ALL_PROJECTS, NOW)
    const needsYou = rail.sections[0]

    // TallyBoard owes four decisions and RedForge one handoff; RedForge's is
    // older, so volume does not move it down the list. WordForge moved most
    // recently of the three and still sits between them.
    expect(needsYou.rows.map((row) => row.slug)).toEqual(['redforge', 'wordforge', 'tallyboard'])
  })

  test('the other two groups are ordered by most recent movement', () => {
    const rail = projectRail(fleet(), ALL_PROJECTS, NOW)

    expect(rail.sections[1].rows.map((row) => row.slug)).toEqual(['dtc', 'pebbles'])
    expect(rail.sections[2].rows.map((row) => row.slug)).toEqual(['rootsync', 'meadowrunbook'])
  })

  test('every row carries what its project owes, never a bare name', () => {
    const rail = projectRail(fleet(), ALL_PROJECTS, NOW)
    const rows = rail.sections.flatMap((section) => section.rows)

    for (const row of rows) expect(row.lead).not.toBe('')

    const byProject = new Map(rows.map((row) => [row.slug, row]))
    expect(byProject.get('wordforge')).toMatchObject({
      lead: '0.21.0',
      owes: '2 waiting on you'
    })
    expect(byProject.get('redforge')?.owes).toBe('handoff ready')
    expect(byProject.get('tallyboard')?.owes).toBe('4 decisions')
    expect(byProject.get('pebbles')?.lead).toBe('0.9.0 · 1 being built')
    expect(byProject.get('dtc')?.lead).toMatch(/^0\.20\.0 shipped · \d\d:\d\d$/)
  })

  test('a quiet row gives a date in the dense form and stops talking', () => {
    const rail = projectRail(fleet(), ALL_PROJECTS, NOW)
    const quiet = new Map(rail.sections[2].rows.map((row) => [row.slug, row]))

    expect(quiet.get('rootsync')?.lead).toBe('1 thread · 14 Aug')
    expect(quiet.get('meadowrunbook')?.lead).toBe('nothing since 3 Dec 2025')
    for (const row of rail.sections[2].rows) expect(row.owes).toBeUndefined()
  })

  test('no rail row ever reads as a relative age at two days or older', () => {
    const rail = projectRail(fleet(), ALL_PROJECTS, NOW)
    const lines = rail.sections.flatMap((section) =>
      section.rows.map((row) => `${row.lead} ${row.owes ?? ''}`)
    )

    for (const line of [...lines, `Synced ${rail.synced}`]) {
      expect(line).not.toMatch(/\bdays? ago\b/)
      expect(line).not.toMatch(/\b\d+\s?d\b/)
    }
  })

  test('All projects is pinned above the groups and counts the whole fleet', () => {
    const rail = projectRail(fleet(), ALL_PROJECTS, NOW)

    // 2 features + 1 handoff + 4 decisions.
    expect(rail.all.waiting).toBe(7)
    expect(rail.all.current).toBe(true)
    expect(rail.projectCount).toBe(7)
  })

  test('the fleet count is the sum of what the rows say is owed', () => {
    const standings = projectStandings(fleet(), NOW)
    const rail = projectRail(fleet(), ALL_PROJECTS, NOW)

    expect(rail.all.waiting).toBe(
      standings.reduce((total, standing) => total + standing.owed.total, 0)
    )
  })

  test('the current scope is marked, and only it', () => {
    const scope: WindowScope = { kind: 'project', slug: 'tallyboard' }
    const rail = projectRail(fleet(), scope, NOW)
    const marked = rail.sections
      .flatMap((section) => section.rows)
      .filter((row) => row.current)
      .map((row) => row.slug)

    expect(marked).toEqual(['tallyboard'])
    expect(rail.all.current).toBe(false)
  })

  test('the filter narrows the rail without moving All projects', () => {
    const rail = projectRail(fleet(), ALL_PROJECTS, NOW, 'forge')

    expect(rail.sections.flatMap((section) => section.rows).map((row) => row.slug)).toEqual([
      'redforge',
      'wordforge'
    ])
    expect(rail.matched).toBe(2)
    expect(rail.projectCount).toBe(7)
    expect(rail.all.waiting).toBe(7)
  })

  test('a filter matching nothing leaves no group headings behind', () => {
    const rail = projectRail(fleet(), ALL_PROJECTS, NOW, 'nothing here')

    expect(rail.sections).toEqual([])
    expect(rail.matched).toBe(0)
  })

  test('a project is named by its release record, so the rail and the titlebar agree', () => {
    const rail = projectRail(fleet(), ALL_PROJECTS, NOW)
    const rows = new Map(rail.sections.flatMap((section) => section.rows).map((r) => [r.slug, r]))

    expect(rows.get('wordforge')?.name).toBe('WordForge')
    expect(rows.get('rootsync')?.name).toBe('Rootsync')
  })

  test('no snapshot yet is an empty rail, not a crash', () => {
    expect(projectRail(null, ALL_PROJECTS, NOW)).toMatchObject({
      sections: [],
      projectCount: 0,
      all: { waiting: 0 }
    })
  })
})

/** Seven projects across the three groups — the shape of mockup states 7 and 8. */
function fleet(): QaSnapshot {
  return snapshot({
    projects: [
      'wordforge',
      'redforge',
      'tallyboard',
      'dtc',
      'pebbles',
      'rootsync',
      'meadowrunbook'
    ],
    runs: [
      run('meadowrunbook', { at: LAST_YEAR, status: 'done' }),
      // Movement without anything owed: WordForge moved most recently and is
      // still not the first row, because the rail ranks by what is owed.
      run('wordforge', { at: TODAY, status: 'done' })
    ],
    threads: [
      thread('tallyboard', { move: 'me', at: YESTERDAY }),
      thread('tallyboard', { move: 'me', at: YESTERDAY }),
      thread('tallyboard', { move: 'me', at: YESTERDAY }),
      thread('tallyboard', { move: 'me', at: YESTERDAY }),
      thread('rootsync', { move: 'agent', at: A_MONTH })
    ],
    handoffs: [handoff('redforge', { at: FIVE_DAYS })],
    releases: [
      release(
        'wordforge',
        '0.21.0',
        [feature('bar', 'you'), feature('spacing', 'you'), feature('export', 'building')],
        THREE_DAYS
      ),
      release('redforge', '0.8.0', [feature('stream', 'building')], FIVE_DAYS),
      release('tallyboard', '0.31.0', [feature('diagram', 'building')]),
      release('pebbles', '0.9.0', [feature('auth', 'building')], YESTERDAY),
      release('dtc', '0.20.0', [feature('scope', 'done')], TODAY, { shipped: true })
    ],
    scannedAt: TODAY
  })
}

interface SnapshotParts {
  projects?: string[]
  runs?: SerializableRun[]
  threads?: Thread[]
  handoffs?: Handoff[]
  releases?: ProjectRelease[]
  scannedAt?: string
}

function snapshot(parts: SnapshotParts): QaSnapshot {
  return {
    root: '/record',
    rootMissing: false,
    runs: parts.runs ?? [],
    notes: [],
    entries: [],
    threads: parts.threads ?? [],
    handoffs: parts.handoffs ?? [],
    releases: parts.releases ?? [],
    pools: [],
    projects: parts.projects ?? [],
    scannedAt: parts.scannedAt ?? TODAY
  }
}

let runSeq = 0
function run(
  project: string,
  options: { at: string; status?: 'waiting' | 'done'; resolved?: boolean }
): SerializableRun {
  const path = `/record/${project}/requests/${(runSeq += 1)}.md`
  return {
    request: {
      id: `r${runSeq}`,
      title: `Request ${runSeq}`,
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

let threadSeq = 0
function thread(
  project: string,
  options: { move?: 'me' | 'agent' | 'nobody'; at?: string } = {}
): Thread {
  const at = options.at ?? YESTERDAY
  const id = `t${(threadSeq += 1)}`
  return {
    id,
    title: `Thread ${id}`,
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
  options: { at: string; pickedUp?: boolean; state?: 'live' | 'done' | 'superseded' }
): Handoff {
  const file = `${(handoffSeq += 1)}.md`
  return {
    path: `/record/${project}/handoffs/${file}`,
    file,
    title: `Handoff ${file}`,
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

function feature(id: string, status: ReleaseFeature['status']): ReleaseFeature {
  return { id, title: id, kind: 'feature', status }
}

function release(
  project: string,
  version: string,
  features: ReleaseFeature[],
  updated = YESTERDAY,
  options: { shipped?: boolean } = {}
): ProjectRelease {
  const record = {
    path: `/record/${project}/releases/${version}.md`,
    version,
    app: project === 'wordforge' ? 'WordForge' : project,
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
