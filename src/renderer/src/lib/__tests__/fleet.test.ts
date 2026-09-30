import { describe, expect, test } from 'vitest'
import type { QaSnapshot, SerializableRun } from '../../../../shared/ipc'
import type { Handoff } from '../../../../main/qa/handoffs'
import type { ProjectRelease, ReleaseFeature } from '../../../../main/qa/releaseRecords'
import type { Thread } from '../../../../main/qa/types'
import { ALL_PROJECTS } from '../../../../shared/windowScope'
import { projectRail } from '../projectStanding'
import {
  FLEET_SORTS,
  HANDOFF_PANEL_LIMIT,
  countInWords,
  handoffPanel,
  fleetInbox,
  fleetOverview,
  readFleetInboxSort,
  readFleetSort,
  writeFleetSort,
  FLEET_SORT_STORAGE_KEY
} from '../fleet'
import { requestIdentity } from '../../../../shared/requestIdentity'

/**
 * Ticket 08 — *All projects* is a place. The seam is the cross-project rollup
 * as a pure function of the snapshot, and the law it has to keep: the tiles and
 * rows on the fleet Overview come from the same reading as the rail beside
 * them, so the two can never disagree about the same project.
 */

const NOW = new Date('2026-09-19T12:00:00.000Z')
const NOW_ISH = '2026-09-19T11:59:40.000Z'
const TODAY = '2026-09-19T09:00:00.000Z'
const YESTERDAY = '2026-09-18T09:00:00.000Z'
const THREE_DAYS = '2026-09-16T09:00:00.000Z'
const FIVE_DAYS = '2026-09-14T09:00:00.000Z'
const A_MONTH = '2026-08-14T09:00:00.000Z'
const LAST_YEAR = '2025-12-03T09:00:00.000Z'

describe('Where each project stands', () => {
  test('one line per project: its release, what it owes, and when it last moved', () => {
    const { rows } = fleetOverview(fleet(), NOW)
    const bySlug = new Map(rows.map((row) => [row.slug, row]))

    expect(rows).toHaveLength(7)
    expect(bySlug.get('wordforge')).toMatchObject({
      name: 'WordForge',
      release: '0.21.0',
      owes: '2 waiting on you',
      last: expect.stringMatching(/^\d\d:\d\d$/)
    })
    expect(bySlug.get('tallyboard')).toMatchObject({ owes: '4 decisions owed', last: 'yesterday' })
    expect(bySlug.get('redforge')).toMatchObject({ release: '0.8.0', owes: 'handoff ready' })
    expect(bySlug.get('dtc')).toMatchObject({ release: '0.20.0', owes: 'nothing owed' })
    expect(bySlug.get('pebbles')).toMatchObject({ owes: '1 being built' })
    expect(bySlug.get('rootsync')).toMatchObject({ release: '', owes: '1 thread open' })
    expect(bySlug.get('meadowrunbook')).toMatchObject({ last: '3 Dec 2025' })
  })

  test('a project with nothing but ranked ideas says so', () => {
    const s = snapshot({ projects: ['saltwater'] })
    s.pools = [
      {
        project: 'saltwater',
        directory: '/record/saltwater/roadmap',
        degradedOrder: false,
        ideas: [
          { state: 'pool' } as QaSnapshot['pools'][number]['ideas'][number],
          { state: 'promoted' } as QaSnapshot['pools'][number]['ideas'][number]
        ]
      }
    ]
    expect(fleetOverview(s, NOW).rows[0].owes).toBe('1 idea ranked')
  })

  test('what it owes is the rail’s definition — a handoff in hand is not owed', () => {
    const inHand = snapshot({
      projects: ['redforge'],
      handoffs: [handoff('redforge', { at: YESTERDAY, pickedUp: true })]
    })
    const [row] = fleetOverview(inHand, NOW).rows
    expect(row.needsYou).toBe(false)
    expect(row.owes).toBe('nothing owed')
    expect(fleetOverview(inHand, NOW).tiles.handoffsReady).toBe(0)
  })

  test('Needs you first is the rail’s order, group by group', () => {
    const rail = projectRail(fleet(), ALL_PROJECTS, NOW)
    const railOrder = rail.sections.flatMap((section) => section.rows.map((row) => row.slug))

    expect(fleetOverview(fleet(), NOW, 'needs-you').rows.map((row) => row.slug)).toEqual(railOrder)
  })

  test('the default order is newest first, whatever a project owes (drawing Y)', () => {
    expect(fleetOverview(fleet(), NOW).rows.map((row) => row.slug)).toEqual(
      fleetOverview(fleet(), NOW, 'last-moved').rows.map((row) => row.slug)
    )
    expect(
      fleetOverview(fleet(), NOW)
        .rows.slice(0, 2)
        .map((row) => row.slug)
    ).toEqual(['wordforge', 'dtc'])
  })

  test('the ordering is his to change', () => {
    const order = (sort: Parameters<typeof fleetOverview>[2]): string[] =>
      fleetOverview(fleet(), NOW, sort).rows.map((row) => row.slug)

    expect(order('name')).toEqual([
      'dtc',
      'meadowrunbook',
      'pebbles',
      'redforge',
      'rootsync',
      'tallyboard',
      'wordforge'
    ])
    expect(order('last-moved').slice(0, 2)).toEqual(['wordforge', 'dtc'])
    expect(order('last-moved').at(-1)).toBe('meadowrunbook')
    expect(order('most-owed').slice(0, 3)).toEqual(['tallyboard', 'wordforge', 'redforge'])
    expect(order('release').slice(0, 2)).toEqual(['tallyboard', 'wordforge'])
    expect(order('release').slice(-2)).toEqual(['meadowrunbook', 'rootsync'])
  })
})

describe('the tiles and the rail cannot disagree', () => {
  const cases: Array<[string, () => QaSnapshot]> = [
    ['the seven-project fleet', fleet],
    ['an empty record', () => snapshot({})],
    ['a generated fleet', () => generated(1)],
    ['another generated fleet', () => generated(7)],
    ['a third generated fleet', () => generated(23)]
  ]

  test.each(cases)('%s: waiting on you is the rail’s All projects count', (_, make) => {
    const s = make()
    expect(fleetOverview(s, NOW).tiles.waiting).toBe(projectRail(s, ALL_PROJECTS, NOW).all.waiting)
  })

  test.each(cases)('%s: the projects that owe are the rail’s Needs you group', (_, make) => {
    const s = make()
    const rail = projectRail(s, ALL_PROJECTS, NOW)
    const railNeedsYou = (
      rail.sections.find((section) => section.group === 'needs-you')?.rows ?? []
    ).map((row) => row.slug)
    const overview = fleetOverview(s, NOW, 'needs-you')
    const owing = overview.rows.filter((row) => row.needsYou).map((row) => row.slug)

    for (const sort of FLEET_SORTS) {
      const rows = fleetOverview(s, NOW, sort).rows
      expect(new Set(rows.filter((row) => row.needsYou).map((row) => row.slug))).toEqual(
        new Set(railNeedsYou)
      )
    }
    expect(owing).toEqual(railNeedsYou)
    expect(overview.tiles.needsYou).toBe(railNeedsYou.length)
    expect(overview.tiles.projects).toBe(rail.projectCount)
  })

  test.each(cases)('%s: the handoffs panel is given exactly the tile’s number', (_, make) => {
    const overview = fleetOverview(make(), NOW)
    // The full list the panel is given is the tile's number; what it draws is
    // capped, and drawn plus hidden is the whole list again.
    expect(overview.handoffs).toHaveLength(overview.tiles.handoffsReady)
    const panel = handoffPanel(overview.handoffs)
    expect(panel.shown.length).toBe(Math.min(HANDOFF_PANEL_LIMIT, overview.tiles.handoffsReady))
    expect(panel.shown.length + panel.hidden).toBe(overview.tiles.handoffsReady)
  })

  test('the fleet tiles for the drawn fleet', () => {
    expect(fleetOverview(fleet(), NOW).tiles).toMatchObject({
      waiting: 7,
      releasesInFlight: 4,
      handoffsReady: 1,
      projects: 7,
      synced: expect.stringMatching(/^\d\d:\d\d$/)
    })
  })
})

describe('the Handoffs ready panel stays short enough to leave Latest in view', () => {
  function manyHandoffs(count: number): QaSnapshot {
    const ages = [NOW_ISH, TODAY, YESTERDAY, THREE_DAYS, FIVE_DAYS, A_MONTH, LAST_YEAR]
    return snapshot({
      projects: ['redforge', 'wordforge', 'tallyboard'],
      handoffs: Array.from({ length: count }, (_, index) =>
        handoff(['redforge', 'wordforge', 'tallyboard'][index % 3], {
          at: ages[index % ages.length],
          title: `Handoff ${index}`
        })
      )
    })
  }

  test('twenty-one ready: the four newest are drawn, then one row for the rest', () => {
    const overview = fleetOverview(manyHandoffs(21), NOW)
    const panel = handoffPanel(overview.handoffs)

    expect(overview.tiles.handoffsReady).toBe(21)
    expect(overview.handoffs).toHaveLength(21)
    expect(panel.shown).toEqual(overview.handoffs.slice(0, 4))
    expect(panel.shown.map((handoff) => handoff.at)).toEqual([NOW_ISH, NOW_ISH, NOW_ISH, TODAY])
    expect(panel.hidden).toBe(17)
    expect(panel.moreLabel).toBe('17 more handoffs ready')
  })

  test('the closing row is singular for one, and absent when nothing is hidden', () => {
    expect(handoffPanel(fleetOverview(manyHandoffs(5), NOW).handoffs).moreLabel).toBe(
      '1 more handoff ready'
    )
    for (const count of [0, 1, 4]) {
      const panel = handoffPanel(fleetOverview(manyHandoffs(count), NOW).handoffs)
      expect(panel.shown).toHaveLength(count)
      expect(panel.hidden).toBe(0)
      expect(panel.moreLabel).toBe('')
    }
  })
})

describe('Latest across the fleet', () => {
  test('requests landing, handoffs written and releases shipped, newest first', () => {
    const s = snapshot({
      projects: ['tallyboard', 'redforge', 'wordforge'],
      runs: [run('tallyboard', { at: NOW_ISH, title: 'Divider inference' })],
      handoffs: [handoff('redforge', { at: TODAY, title: 'Streaming prepare' })],
      releases: [release('wordforge', '0.20.0', [], FIVE_DAYS, { shipped: true })]
    })
    const latest = fleetOverview(s, NOW).latest

    expect(latest.map((event) => `${event.name} · ${event.text} · ${event.age}`)).toEqual([
      expect.stringMatching(/^Tallyboard · Divider inference — request landed · \d\d:\d\d$/),
      expect.stringMatching(/^Redforge · Streaming prepare — handoff written · \d\d:\d\d$/),
      'WordForge · 0.20.0 shipped · 14 Sep'
    ])
  })
})

describe('Inbox under All projects', () => {
  test('every open request across projects, newest first, each naming its project', () => {
    const s = snapshot({
      projects: ['wordforge', 'redforge'],
      runs: [
        run('wordforge', { at: FIVE_DAYS, title: 'Old' }),
        run('redforge', { at: TODAY, title: 'Newest' }),
        run('wordforge', { at: YESTERDAY, title: 'Middle' }),
        run('redforge', { at: TODAY, title: 'Resolved', resolved: true })
      ],
      releases: [release('wordforge', '0.21.0', [feature('x', 'building')])]
    })
    const { rows, projectCount } = fleetInbox(s)

    expect(rows.map((row) => `${row.name} · ${row.title}`)).toEqual([
      'Redforge · Newest',
      'WordForge · Middle',
      'WordForge · Old'
    ])
    expect(projectCount).toBe(2)
  })

  test('a finished request stays until collected and reads as the agent’s move', () => {
    const s = snapshot({
      projects: ['p'],
      runs: [
        run('p', { at: TODAY, title: 'Still to answer' }),
        run('p', { at: YESTERDAY, status: 'done' })
      ]
    })
    const model = fleetInbox(s)
    expect(model.rows.map((row) => row.state)).toEqual(['waiting', 'building'])
    expect(model.counts).toEqual({ everything: 2, waiting: 1, building: 1 })
    expect(fleetInbox(s, {}, { filter: 'building' }).rows).toHaveLength(1)
    expect(fleetInbox(s, {}, { filter: 'waiting' }).rows[0].title).toBe('Still to answer')
  })

  test('sortable, searchable, and archived requests are left out', () => {
    const a = run('alpha', { at: FIVE_DAYS, title: 'Alpha thing' })
    const b = run('beta', { at: TODAY, title: 'Beta thing' })
    const s = snapshot({ projects: ['alpha', 'beta'], runs: [a, b] })

    expect(fleetInbox(s, {}, { sort: 'oldest' }).rows.map((row) => row.slug)).toEqual([
      'alpha',
      'beta'
    ])
    expect(fleetInbox(s, {}, { sort: 'project' }).rows.map((row) => row.slug)).toEqual([
      'alpha',
      'beta'
    ])
    expect(fleetInbox(s, {}, { query: 'beta' }).rows.map((row) => row.slug)).toEqual(['beta'])
    const archived = new Set([requestIdentity(s.root, b.request.path)])
    expect(fleetInbox(s, { archived }).rows.map((row) => row.slug)).toEqual(['alpha'])
  })

  test('the heading counts projects in words', () => {
    expect(countInWords(7, 'project')).toBe('seven projects')
    expect(countInWords(1, 'project')).toBe('one project')
    expect(countInWords(14, 'project')).toBe('14 projects')
  })
})

describe('his ordering is remembered, and a broken store costs nothing else', () => {
  test('a stored order is read back, an unknown one falls back to the drawn default', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value)
    }
    expect(readFleetSort(storage)).toBe('last-moved')
    writeFleetSort(FLEET_SORT_STORAGE_KEY, 'name', storage)
    expect(readFleetSort(storage)).toBe('name')
    store.set(FLEET_SORT_STORAGE_KEY, 'nonsense')
    expect(readFleetSort(storage)).toBe('last-moved')
  })

  test('a store that throws reads as the default and swallows the write', () => {
    const throwing = {
      getItem: (): string | null => {
        throw new Error('blocked')
      },
      setItem: (): void => {
        throw new Error('blocked')
      }
    }
    expect(readFleetSort(throwing)).toBe('last-moved')
    expect(readFleetInboxSort(throwing)).toBe('newest')
    expect(() => writeFleetSort(FLEET_SORT_STORAGE_KEY, 'name', throwing)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------

/** Seven projects across the three groups — the shape of mockup state 17. */
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
      run('wordforge', { at: '2026-09-19T07:00:00.000Z', status: 'done' })
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
      release('tallyboard', '0.31.0', [feature('diagram', 'building')], A_MONTH),
      release('pebbles', '0.9.0', [feature('auth', 'building')], YESTERDAY),
      release('dtc', '0.20.0', [feature('scope', 'done')], '2026-09-19T06:00:00.000Z', {
        shipped: true
      })
    ],
    scannedAt: TODAY
  })
}

/** A deterministic pseudo-random fleet, so the agreement is not one fixture deep. */
function generated(seed: number): QaSnapshot {
  let state = seed
  const next = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]
  const ages = [NOW_ISH, TODAY, YESTERDAY, THREE_DAYS, FIVE_DAYS, A_MONTH, LAST_YEAR]
  const projects = Array.from({ length: 12 }, (_, index) => `p${index}`)
  const runs: SerializableRun[] = []
  const threads: Thread[] = []
  const handoffs: Handoff[] = []
  const releases: ProjectRelease[] = []
  for (const project of projects) {
    for (let i = Math.floor(next() * 4); i > 0; i -= 1) {
      runs.push(
        run(pick([...projects, 'stray']), {
          at: pick(ages),
          status: pick(['waiting', 'done'] as const),
          resolved: next() < 0.2
        })
      )
    }
    for (let i = Math.floor(next() * 3); i > 0; i -= 1) {
      threads.push(
        thread(project, { move: pick(['me', 'agent', 'nobody'] as const), at: pick(ages) })
      )
    }
    for (let i = Math.floor(next() * 3); i > 0; i -= 1) {
      handoffs.push(
        handoff(pick([project, '_unfiled']), {
          at: pick(ages),
          pickedUp: next() < 0.4,
          state: pick(['live', 'live', 'done', 'superseded'] as const)
        })
      )
    }
    if (next() < 0.6) {
      releases.push(
        release(
          project,
          `0.${Math.floor(next() * 30)}.0`,
          [feature('a', pick(['you', 'building', 'built', 'done', 'notstarted'] as const))],
          pick(ages),
          { shipped: next() < 0.3 }
        )
      )
    }
  }
  return snapshot({ projects, runs, threads, handoffs, releases, scannedAt: TODAY })
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
